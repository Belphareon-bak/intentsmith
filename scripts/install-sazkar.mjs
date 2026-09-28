#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(process.argv.slice(2).join(' ')!=='--install')throw new Error('Použití: node scripts/install-sazkar.mjs --install');
const dir=path.join(os.homedir(),'.local/bin'),file=path.join(dir,'sazkar'),aliases=path.join(os.homedir(),'.bash_aliases');
const marker='# IntentSmith sazkar launcher',begin='# BEGIN INTENTSMITH SAZKAR',end='# END INTENTSMITH SAZKAR';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const launcher='#!/bin/sh\n'+marker+'\nexec '+quote(process.execPath)+' '+quote(path.join(root,'bin/sazkar.js'))+' "$@"\n';
await fs.mkdir(dir,{recursive:true});
try{const st=await fs.lstat(file);if(st.isSymbolicLink()||!(await fs.readFile(file,'utf8')).includes(marker))throw new Error('Cizí příkaz sazkar již existuje; nebyl přepsán.');}catch(e){if(e.code!=='ENOENT')throw e;}
let prior='';try{const st=await fs.lstat(aliases);if(!st.isFile()||st.isSymbolicLink())throw new Error('Aliasový soubor není běžný soubor.');prior=await fs.readFile(aliases,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
const rest=prior.replace(/# BEGIN INTENTSMITH SAZKAR\n[\s\S]*?# END INTENTSMITH SAZKAR\n?/g,'');
const entries={sk:'',sk24:'hledej',sk72:'hledej --profil 72h',skstav:'stav',skhlidej:'hlidat start',skstop:'hlidat stop',skposledni:'posledni'};
for(const name of Object.keys(entries))if(new RegExp('(?:^|\\n)\\s*alias\\s+'+name+'=').test(rest))throw new Error('Cizí alias '+name+' již existuje; nebyl přepsán.');
if(prior)await fs.copyFile(aliases,aliases+'.sazkar-backup-'+Date.now());
await fs.writeFile(file+'.tmp',launcher,{mode:0o755,flag:'wx'});await fs.rename(file+'.tmp',file);
const block=begin+'\n'+Object.entries(entries).map(([k,v])=>'alias '+k+'='+quote(quote(file)+(v?' '+v:''))).join('\n')+'\n'+end+'\n';
await fs.writeFile(aliases+'.sazkar-tmp',rest+(rest&&!rest.endsWith('\n')?'\n':'')+block,{mode:0o600,flag:'wx'});await fs.rename(aliases+'.sazkar-tmp',aliases);
console.log('Nainstalován '+file+'\nAliasy: '+Object.keys(entries).join(', ')+'\nV otevřeném terminálu: source ~/.bash_aliases\nPříkaz sazkar funguje i bez načtení aliasů.');
