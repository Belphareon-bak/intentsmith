#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {BettingDataStore} from '../src/betting/data-store.js';
import {createBettingDataHost} from '../src/betting/data-host.js';
import {BettingWatchStore} from '../src/betting/watch-store.js';
import {scanBettingWatch} from '../src/betting/watch.js';
import {sendWatchMail,validateWatchMail,watchRecipientHash} from '../src/betting/watch-mail.js';
import {runBetting,extractBettingInput} from '../specialists/sazeni/tools/betting-engine.js';
import {renderBettingResult,exportBettingCSV} from '../specialists/sazeni/presentation/report.js';
import {WATCH_DEFAULTS,validateWatchPreferences,renderWatchSignal} from '../specialists/sazeni/engine/opportunities.js';

const execute=promisify(execFile),entry=fileURLToPath(import.meta.url),repo=path.dirname(path.dirname(entry));
const configDir=path.resolve(process.env.SAZKAR_CONFIG_DIR??path.join(os.homedir(),'.config/sazkar'));
const stateDir=path.resolve(process.env.SAZKAR_STATE_DIR??path.join(os.homedir(),'.local/state/sazkar'));
const configPath=path.join(configDir,'watch.json'),mailPath=path.join(configDir,'mail.json'),secretPath=path.join(configDir,'smtp-password');
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
const HELP=`Sázkař — veřejná Fortuna, bez účtu a datového API klíče

  sazkar                       jednoduché menu
  sazkar hledej                top 5 podle odhadu úspěšnosti, do 24 hodin
  sazkar hledej --profil 72h    top 5, 2–3 položky, kurz 2–4, rozestup ≤12 h
  sazkar hledej 'do 24 h, kurz od 2 do 4'
  sazkar hledej --top 10 'do 24 h, kurz od 2 do 4'
  sazkar posledni              poslední uložený report
  sazkar historie              posledních deset výpočtů
  sazkar stav                  stav sběru a odesílání
  sazkar hlidat jednou         jednorázové sledování změn
  sazkar hlidat start|stop     zapnutí / vypnutí vlastní user služby
  sazkar hlidat nastav --interval 15 --hodin 72 --zlepseni 5 --max-mailu 4
  sazkar upozorneni            poslední signály a stav doručení
  sazkar mail nastav           příjemce, SMTP a heslo zadávané skrytě
  sazkar mail test             vyžádaný test odeslání, bez sázkových tipů

První sběr založí výchozí stav. Nově zachycená nabídka není doložený opening;
lepší pozorovaná cena není důkaz +EV. Jedna kancelář, fotbal 1X2, pět lig.
E-mail posílá jen čerstvé signály zlepšení/nové nabídky, nejvýše 4 za 24 h.
Soukromá konfigurace: ${configDir}
Historie a výstupy: ${stateDir}`;

async function privateDirectory(dir){await fs.mkdir(dir,{recursive:true,mode:0o700});const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw new Error('Soukromý adresář musí patřit uživateli a mít práva 700: '+dir);}
async function writePrivate(file,text){const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,text,{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}
async function writeJSON(file,value){return writePrivate(file,JSON.stringify(value,null,2)+'\n');}
async function readPrivate(file){const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>16000)throw new Error('Neplatný nebo nesoukromý konfigurační soubor: '+file);return fs.readFile(file,'utf8');}
async function config(){
  try{const c=JSON.parse(await readPrivate(configPath));if(c.version!==1||typeof c.enabled!=='boolean'||Object.keys(c).sort().join(',')!=='enabled,preferences,version')throw new Error('WATCH_CONFIG_INVALID');return {...c,preferences:validateWatchPreferences(c.preferences)};}
  catch(e){if(e.code==='ENOENT')return {version:1,enabled:false,preferences:{...WATCH_DEFAULTS}};throw e;}
}
async function mail(){
  try{return {config:validateWatchMail(JSON.parse(await readPrivate(mailPath))),password:(await readPrivate(secretPath)).replace(/\r?\n$/,'')};}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function openStore(){
  await privateDirectory(stateDir);
  let bytes=0;for(const suffix of ['','-wal'])try{bytes+=(await fs.stat(path.join(stateDir,'analysis.sqlite'+suffix))).size;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(bytes>512*1024*1024)throw new Error('Databáze dosáhla limitu 512 MiB; sběr zastaven. Zálohuj historii před dalším provozem.');
  const store=new BettingDataStore(path.join(stateDir,'analysis.sqlite'));return {store,watch:new BettingWatchStore(store),bridge:createBettingDataHost({store})};
}
function option(args,name,fallback){const i=args.indexOf(name);if(i<0)return fallback;if(i===args.length-1)throw new Error('Chybí hodnota '+name);const value=args[i+1];args.splice(i,2);return value;}
async function search(args){
  const profile=option(args,'--profil','24h'),top=option(args,'--top','5');if(!/^(?:[1-9]|10)$/.test(top))throw new Error('--top musí být celé číslo od 1 do 10.');
  if(!['24h','72h'].includes(profile)||args.some(a=>a.startsWith('--')))throw new Error('Použij profil 24h nebo 72h; další omezení zadej česky.');
  const preferences=profile==='72h'?JSON.parse(await fs.readFile(path.join(repo,'specialists/sazeni/examples/fortuna-72h.json'),'utf8')):{};
  preferences.ticketCount=Number(top);
  const params=extractBettingInput(args.join(' ')||'Fortuna');params.payload={preferences};
  const {store,bridge}=await openStore();let token;
  try{
    console.log('Načítám veřejnou Fortunu a počítám návrhy…');
    token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.ticket_builder',operator:true,signal:controller.signal});
    const result=await runBetting(params,{now:new Date().toISOString(),bettingData:bridge.host.forTurn(token),signal:controller.signal,clock:()=>performance.now(),yieldTask:()=>new Promise(resolve=>setImmediate(resolve))});
    const parent=path.join(stateDir,'results');await fs.mkdir(parent,{recursive:true,mode:0o700});
    const destination=path.join(parent,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));await fs.mkdir(destination,{mode:0o700});
    await writeJSON(path.join(destination,'result.json'),result);await writeJSON(path.join(destination,'input.json'),{preferences,text:args.join(' ')});
    await fs.writeFile(path.join(destination,'tickets.md'),renderBettingResult(result)+'\n',{mode:0o600});await fs.writeFile(path.join(destination,'tickets.csv'),exportBettingCSV(result),{mode:0o600});
    console.log(renderBettingResult(result));console.log('\nUloženo: '+destination);
    if(!['READY','NO_SOLUTION','SEARCH_LIMIT_REACHED'].includes(result.status))process.exitCode=2;
  }finally{if(token)bridge.host.closeInvocation(token);store.close();}
}
async function results(){try{return (await fs.readdir(path.join(stateDir,'results'))).filter(s=>/^\d{4}-\d{2}-\d{2}T/.test(s)).sort().reverse();}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function status(){
  const c=await config(),m=await mail();console.log(`Sběr: ${c.enabled?'zapnutý':'vypnutý'}; interval ${c.preferences.intervalMinutes} min; okno ${c.preferences.horizonHours} h.\nMail: ${m?'nastavený, SMTP přijetí zatím není potvrzení doručení do schránky':'nenastavený — signály zůstávají lokálně'}.`);
  const {store,watch}=await openStore();try{const s=watch.status();console.log(s.lastScan?`Poslední úspěšný sběr: ${new Date(s.lastScan.at).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'})}; ${s.lastScan.quotes} výběrů, ${s.lastScan.signals} nových signálů.`:'Zatím neproběhl žádný úspěšný sběr.');console.log(`Uložených cenových pozorování: ${s.observations}.`);if(s.health?.success===0)console.log('Poslední pokus selhal: '+s.health.error_code);const labels={local:'lokální',pending:'čekající',sending:'odesílání',sent:'SMTP přijal',unknown:'nepotvrzené',expired:'prošlé'};console.log('Upozornění: '+(s.alerts.map(a=>`${labels[a.status]} ${a.count}`).join(', ')||'zatím žádná')+'.');}finally{store.close();}
  try{const r=await execute('systemctl',['--user','show','sazkar-watch.timer','--property=ActiveState','--value'],{timeout:5000});console.log('Plánovač: '+(r.stdout.trim()==='active'?'běží':'neběží')+'.');}catch{console.log('User timer není dostupný; lze spustit sazkar hlidat jednou.');}
}
const unitQuote=s=>{if(/[\r\n\0]/.test(s))throw new Error('SERVICE_PATH_INVALID');return '"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$','$$')+'"';};
async function installTimer(minutes){
  const dir=path.join(os.homedir(),'.config/systemd/user');await fs.mkdir(dir,{recursive:true});
  const marker='# Managed by IntentSmith sazkar CLI\n';
  const service=marker+`[Unit]\nDescription=Sázkař: veřejné kurzy a upozornění\n[Service]\nType=oneshot\nExecStart=${unitQuote(process.execPath)} ${unitQuote(entry)} hlidat jednou --scheduled\nEnvironment=${unitQuote('SAZKAR_CONFIG_DIR='+configDir)}\nEnvironment=${unitQuote('SAZKAR_STATE_DIR='+stateDir)}\nUMask=0077\nNoNewPrivileges=true\nTimeoutStartSec=150\nTimeoutStopSec=5\nKillMode=control-group\nMemoryMax=512M\nCPUQuota=25%\n`;
  const timer=marker+`[Unit]\nDescription=Sázkař: pravidelné pozorování Fortuny\n[Timer]\nOnActiveSec=30s\nOnUnitInactiveSec=${minutes}min\nAccuracySec=5s\nUnit=sazkar-watch.service\n[Install]\nWantedBy=timers.target\n`;
  for(const [name,content] of [['sazkar-watch.service',service],['sazkar-watch.timer',timer]]){
    const file=path.join(dir,name);try{const st=await fs.lstat(file);if(st.isSymbolicLink()||!(await fs.readFile(file,'utf8')).startsWith(marker))throw new Error('Odmítám přepsat cizí systemd jednotku: '+file);}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.writeFile(file,content,{mode:0o600});
  }
  await execute('systemctl',['--user','daemon-reload'],{timeout:10000});
}
async function tick(scheduled){
  const c=await config();if(scheduled&&!c.enabled){console.log('Sběr je vypnutý.');return;}
  const m=await mail(),{store,watch,bridge}=await openStore();let lease;
  try{
    const scan=await scanBettingWatch({bridge,watch,preferences:c.preferences,signal:controller.signal,recipientHash:c.enabled&&m?watchRecipientHash(m.config,c.preferences):null});lease=scan.lease;
    console.log(`Pozorování ${scan.scanId}: ${scan.quotes} výběrů, ${scan.signals.length} signálů.`);
    for(const s of scan.signals.slice(0,5))console.log('\n'+renderWatchSignal(s));
    // Re-read opt-in immediately before any delivery; stopping the watcher also
    // disables mail. A manual scan alone never enables background delivery.
    const deliveryConfig=await config(),deliveryMail=await mail();
    if(deliveryMail&&deliveryConfig.enabled&&!controller.signal.aborted){
      const item=watch.claimMail({token:lease,now:new Date().toISOString(),recipientHash:watchRecipientHash(deliveryMail.config,deliveryConfig.preferences),maxPerDay:deliveryConfig.preferences.maxAlertsPerDay});
      if(item){let outcome;try{outcome=await sendWatchMail({store,...deliveryMail,signal:item.signal});}catch{outcome={accepted:false,errorCode:'MAIL_SEND_NOT_CONFIRMED'};}watch.finishMail(item.id,outcome);console.log(outcome.accepted?'SMTP přijal upozornění.':'Odeslání nepotvrzeno; nebude automaticky opakováno.');}
    }else if(!m)console.log('E-mail není nastavený. Sběr a lokální signály fungují.');
  }finally{if(lease)watch.release(lease);store.close();}
}
async function watchCommand(args){
  const action=args.shift()??'stav';await privateDirectory(configDir);const c=await config();
  if(action==='stav')return status();
  if(action==='jednou'){if(args.some(a=>a!=='--scheduled')||args.length>1)throw new Error('Neplatný přepínač.');return tick(args.includes('--scheduled'));}
  if(action==='nastav'){
    const names={'--interval':'intervalMinutes','--hodin':'horizonHours','--zlepseni':'minImprovement','--max-mailu':'maxAlertsPerDay','--kurz-min':'minOdds','--kurz-max':'maxOdds','--uspesnost':'minProbability'};
    for(const [flag,k] of Object.entries(names)){const value=option(args,flag,null);if(value!==null)c.preferences[k]=Number(value.replace(',','.'))/(['minImprovement','minProbability'].includes(k)?100:1);}
    if(args.length)throw new Error('Neznámé nastavení '+args.join(' '));c.preferences=validateWatchPreferences(c.preferences);await writeJSON(configPath,c);
    if(c.enabled){await installTimer(c.preferences.intervalMinutes);await execute('systemctl',['--user','restart','sazkar-watch.timer'],{timeout:10000});}
    console.log('Nastavení uloženo. Změna filtrů založí novou výchozí sadu bez hromadného rozesílání.');return;
  }
  if(args.length||!['start','stop'].includes(action))throw new Error('Použij hlidat start, stop, stav, jednou nebo nastav.');
  if(action==='start'){await installTimer(c.preferences.intervalMinutes);await writeJSON(configPath,{...c,enabled:true});await execute('systemctl',['--user','enable','--now','sazkar-watch.timer'],{timeout:10000});console.log('Sběr zapnutý, první kontrola do 30 sekund. '+((await mail())?'Mail používá nastaveného příjemce.':'E-mail ještě není nastavený; historie se sbírá lokálně.'));}
  else{await writeJSON(configPath,{...c,enabled:false});await execute('systemctl',['--user','disable','--now','sazkar-watch.timer'],{timeout:10000});await execute('systemctl',['--user','stop','sazkar-watch.service'],{timeout:10000});console.log('Sběr a automatické odesílání vypnuté.');}
}
async function hiddenPassword(){
  if(!process.stdin.isTTY)throw new Error('Heslo lze zadat jen v interaktivním terminálu.');
  process.stdout.write('SMTP heslo / heslo aplikace (skrytě): ');process.stdin.setRawMode(true);process.stdin.resume();
  try{return await new Promise((resolve,reject)=>{let value='';const read=chunk=>{for(const c of chunk.toString()){if(c==='\r'||c==='\n'){process.stdin.off('data',read);resolve(value);return;}if(c==='\u0003'){process.stdin.off('data',read);reject(new Error('Zrušeno.'));return;}if(c==='\u007f'){value=value.slice(0,-1);continue;}if(c>=' '&&value.length<4096)value+=c;}};process.stdin.on('data',read);});}
  finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}
async function setupMail(){
  if(!process.stdin.isTTY)throw new Error('Spusť sazkar mail nastav v terminálu.');
  const rl=createInterface({input:process.stdin,output:process.stdout});let c;
  try{const host=(await rl.question('SMTP server (např. smtp.gmail.com nebo smtp.seznam.cz): ')).trim();const port=Number((await rl.question('TLS port [465]: ')).trim()||465);const user=(await rl.question('Přihlašovací jméno: ')).trim();const from=(await rl.question(`Odesílatel [${user}]: `)).trim()||user;const to=(await rl.question('E-mail pro upozornění: ')).trim();c=validateWatchMail({host,port,user,from,to});}finally{rl.close();}
  const password=await hiddenPassword();if(!password)throw new Error('Prázdné heslo nebylo uloženo.');
  await privateDirectory(configDir);await writePrivate(secretPath,password);await writeJSON(mailPath,c);console.log('SMTP nastavení uloženo soukromě. Další čerstvý signál může být odeslán, pokud je hlídání zapnuté. Doručení zatím neověřeno; vyzkoušej sazkar mail test.');
}
async function main(args){
  const command=args.shift();
  if(command==='--help'||command==='help'){console.log(HELP);return;}
  if(!command){
    if(!process.stdin.isTTY){console.log(HELP);return;}
    const rl=createInterface({input:process.stdin,output:process.stdout});
    try{console.log('Sázkař\n1 — hledat do 24 h\n2 — tikety do 3 dnů\n3 — vlastní zadání\n4 — poslední výsledek\n5 — stav hlídání\n6 — zapnout hlídání\n7 — vypnout hlídání\n8 — upozornění\n0 — konec');const choice=(await rl.question('Volba: ')).trim();const text=choice==='3'?await rl.question('Zadání: '):null;rl.close();const commands={'1':['hledej'],'2':['hledej','--profil','72h'],'3':['hledej',text],'4':['posledni'],'5':['stav'],'6':['hlidat','start'],'7':['hlidat','stop'],'8':['upozorneni'],'0':[]};if(!Object.hasOwn(commands,choice))throw new Error('Neplatná volba.');if(choice!=='0')return main(commands[choice]);}finally{rl.close();}return;
  }
  if(command==='hledej')return search(args);
  if(command==='hlidat')return watchCommand(args);
  if(command==='mail'&&args.length===1&&args[0]==='nastav')return setupMail();
  if(command==='mail'&&args.length===1&&args[0]==='test'){const m=await mail();if(!m)throw new Error('E-mail není nastavený. Spusť sazkar mail nastav.');const {store}=await openStore();try{const r=await sendWatchMail({store,...m,test:true});console.log(r.accepted?'SMTP přijal testovací zprávu; ověř ji ve schránce.':'Odeslání testu nepotvrzeno.');if(!r.accepted)process.exitCode=2;}finally{store.close();}return;}
  if(args.length)throw new Error('Neznámý příkaz. Použij sazkar --help.');
  if(command==='stav')return status();
  if(command==='historie'||command==='posledni'){
    const dirs=await results();if(!dirs.length){console.log('Zatím žádné výpočty. Spusť sazkar hledej.');return;}
    if(command==='posledni'){console.log('Uložený report — ceny mohou být již neplatné.\n'+await fs.readFile(path.join(stateDir,'results',dirs[0],'tickets.md'),'utf8'));return;}
    for(const d of dirs.slice(0,10)){const r=JSON.parse(await fs.readFile(path.join(stateDir,'results',d,'result.json'),'utf8'));console.log(`${r.generatedAt}  ${r.status}  ${r.tickets.length} tiketů  ${path.join(stateDir,'results',d)}`);}return;
  }
  if(command==='upozorneni'){const {store,watch}=await openStore();try{const rows=watch.alerts();console.log('Uložené signály — jejich ceny již mohou být neplatné.');if(!rows.length)console.log('Zatím žádné signály. První sběr neoznačuje stávající nabídku jako novou.');for(const a of rows)console.log(`[${a.status}] ${a.at}\n${renderWatchSignal(a.payload)}\n`);}finally{store.close();}return;}
  throw new Error('Neznámý příkaz. Použij sazkar --help.');
}
main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
