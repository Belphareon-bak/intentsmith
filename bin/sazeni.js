#!/usr/bin/env node
// Local operator invocation. File access is intentionally outside the package.
import fs from 'node:fs/promises';
import path from 'node:path';
import { BettingDataStore } from '../src/betting/data-store.js';
import { createBettingDataHost } from '../src/betting/data-host.js';
import { runBetting, extractBettingInput } from '../specialists/sazeni/tools/betting-engine.js';
import { renderBettingResult, exportBettingCSV } from '../specialists/sazeni/presentation/report.js';
const args=process.argv.slice(2);
let bettingStore,bettingBridge,bettingToken;
const controller=new AbortController(),interrupt=()=>controller.abort();
try {
 if(args[0]==='--auto' ? args.length<3||args.length>4 : args.length<2||args.length>4||(args.length>2&&args[2]!=='--now')||args.length===3) throw new Error('Použití: node bin/sazeni.js --auto nový-výstupní-adresář „do 24 h, kurz od 1.5 do 3, úspěšnost alespoň 40 %“ [preferences.json] nebo vstup.json výstup [--now UTC].');
 const auto=args[0]==='--auto',output=args[1];
 const destination=path.resolve(output),parent=path.dirname(destination);
 try {await fs.lstat(destination);throw new Error('Výstupní cesta už existuje. Zvol nový adresář.');} catch(e){if(e.code!=='ENOENT')throw e;}
 let content,params;
 if(auto) {
   content=args[2];params=extractBettingInput(content);
   if(args[3]) {const stat=await fs.stat(args[3]);if(!stat.isFile()||stat.size>10000)throw new Error('Preference musí být JSON do 10 kB.');const preferences=JSON.parse(await fs.readFile(args[3],'utf8'));params.payload={preferences};content=JSON.stringify({preferences,text:args[2]},null,2);}
   bettingStore=new BettingDataStore(path.resolve('.intentsmith-artifacts/betting/analysis.sqlite'));
   bettingBridge=createBettingDataHost({store:bettingStore,oddsIOKey:process.env.INTENTSMITH_BETTING_ODDS_IO_API_KEY??null});
   bettingToken=bettingBridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true,signal:controller.signal});
 } else {const stat=await fs.stat(args[0]);if(!stat.isFile()||stat.size>1_000_000)throw new Error('Vstup musí být JSON do 1 MB.');content=await fs.readFile(args[0],'utf8');params=extractBettingInput(content);}
 process.once('SIGINT',interrupt);
 let result;
 try {result=await runBetting(params,{now:auto?new Date().toISOString():args[3]??new Date().toISOString(),signal:controller.signal,clock:()=>performance.now(),yieldTask:()=>new Promise(resolve=>setImmediate(resolve)),...(auto?{bettingData:bettingBridge.host.forTurn(bettingToken)}:{})});}
 finally {process.removeListener('SIGINT',interrupt);}
 // Make all serialized exports first; publish them as one directory, never overwrite.
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
finally {if(bettingToken)bettingBridge.host.closeInvocation(bettingToken);bettingStore?.close();}
