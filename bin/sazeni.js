#!/usr/bin/env node
// Local operator invocation. File access is intentionally outside the package.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runBetting, extractBettingInput } from '../specialists/sazeni/tools/betting-engine.js';
import { renderBettingResult, exportBettingCSV } from '../specialists/sazeni/presentation/report.js';
const args=process.argv.slice(2);
try {
 if(args.length<2||args.length>4||(args.length>2&&args[2]!=='--now')||args.length===3) throw new Error('Použití: node bin/sazeni.js vstup.json nový-výstupní-adresář [--now UTC]. --now slouží k reprodukci importu.');
 const [input,output]=args;
 const stat=await fs.stat(input);if(!stat.isFile()||stat.size>1_000_000) throw new Error('Vstup musí být JSON do 1 MB.');
 const content=await fs.readFile(input,'utf8'),params=extractBettingInput(content);
 const result=await runBetting(params,{now:args[3]??new Date().toISOString(),clock:()=>performance.now(),yieldTask:()=>new Promise(resolve=>setImmediate(resolve))});
 // Make all serialized exports first; publish them as one directory, never overwrite.
 const destination=path.resolve(output),parent=path.dirname(destination);
 try {await fs.lstat(destination);throw new Error('Výstupní cesta už existuje. Zvol nový adresář.');} catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=await fs.mkdtemp(path.join(parent,'.sazeni-'));
 try {
   await fs.writeFile(path.join(temporary,'input.json'),content,{mode:0o600});
   await fs.writeFile(path.join(temporary,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
   await fs.writeFile(path.join(temporary,'tickets.md'),renderBettingResult(result)+'\n',{mode:0o600});
   await fs.writeFile(path.join(temporary,'tickets.csv'),exportBettingCSV(result),{mode:0o600});
   // Link reservation blocks concurrent writers; rename follows within our own path.
   await fs.mkdir(destination,{mode:0o700});
   try { for(const file of ['input.json','result.json','tickets.md','tickets.csv']) await fs.rename(path.join(temporary,file),path.join(destination,file)); }
   catch(e) {throw new Error(`Export nebyl dokončen; částečný adresář ${destination} zachován. ${e.message}`);}
   await fs.rmdir(temporary);
 } catch(e) {await fs.rm(temporary,{recursive:true,force:true});throw e;}
 console.log(`${result.status}: ${result.tickets.length} tiketů. Výstup: ${destination}`);
 if(!['READY','NO_SOLUTION','SEARCH_LIMIT_REACHED'].includes(result.status)) process.exitCode=2;
} catch(error) { console.error(error.message);process.exitCode=1; }
