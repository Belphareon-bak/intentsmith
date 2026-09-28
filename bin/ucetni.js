#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {AccountingStore,privateDir,atomicWrite,readRegular,hash} from '../src/accounting/store.js';
import {importPaths,answer,reviewDocument,splitSource,recordFiling,compute,exportCase,todayCZ} from '../src/accounting/service.js';
import {cents,money} from '../specialists/accountant-cz/workflow/common.js';
import {report} from '../specialists/accountant-cz/workflow/report.js';
import {previewCase} from '../src/accounting/preview.js';
import {comparison} from '../specialists/accountant-cz/workflow/comparison.js';
import {deadlines} from '../specialists/accountant-cz/workflow/deadlines.js';
const execute=promisify(execFile),entry=fileURLToPath(import.meta.url);
const store=new AccountingStore(process.env.UCETNI_STATE_DIR??path.join(os.homedir(),'.local/state/ucetni'));
const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());
const HELP=`Účetní — lokální podklady, měsíční DPH/KH a roční OSVČ

  ucetni                               menu
  ucetni mesic 2026-05 [soubor/složka…] založit měsíc a importovat doklady
  ucetni rok 2025 [složka…]             založit roční evidenci
  ucetni seznam                        otevřená období
  ucetni import ID soubor/složka…       přidat podklady (PDF, HEIC, obrázky, ZIP)
  ucetni vzor ID soubor.zip             uložit výstupy účetní pro srovnání
  ucetni stav ID                       výpočty, chybějící podklady, termíny
  ucetni pruvodce ID                   doplnit profil, doklady, úhrady a slevy
  ucetni nahled ID                     soukromý HTML náhled dokladů vedle údajů
  ucetni srovnej ID                    porovnání výpočtu se vzorem účetní
  ucetni doklad ID DOKLAD              kontrola jednoho dokladu
  ucetni rozdel ID ZDROJ 3x2           upravit rozdělení fotografie
  ucetni odpoved ID KLIC HODNOTA       zapsat jednotlivou odpověď
  ucetni export ID                     vytvořit validovaná XML a ZIP
  ucetni export ID --navrh             pracovní ZIP se seznamem požadavků
  ucetni terminy [ID]                  termíny a evidovaná podání/platby
  ucetni podano ID TYP YYYY-MM-DD DOKLAD potvrzení skutečného podání/platby
  ucetni hlidat start|stop|jednou       místní denní upozornění

ID např. dph-2026-05 nebo dan-2025. Podklady zůstávají zde:
${store.root}
Roční výpočet: rok 2025, tuzemská hlavní OSVČ po celý rok, paušální výdaje,
OZP. Jiné režimy se zastaví s vysvětlením. Měsíční DPH: běžná tuzemská
plnění, sazby 21/12 %, plné odpočty. Podání úřadům se neodesílá.
Průvodce dovoluje odpověď „nevím“ a pokračuje dalšími údaji.`;
const bool=s=>{if(['ano','a','true'].includes(s.toLowerCase()))return true;if(['ne','n','false'].includes(s.toLowerCase()))return false;throw new Error('Zadej ano nebo ne.');};
const months=s=>s.trim()==='1-12'?Array.from({length:12},(_,i)=>i+1):s.split(',').filter(Boolean).map(Number);
function valueFor(type,s){if(type==='boolean')return bool(s);if(type==='money')return cents(s);if(['rate','integer'].includes(type))return Number(s);if(['children','spouse'].includes(type))return JSON.parse(s);return s;}
async function prompt(rl,title,current){const s=(await rl.question(title+(current!==undefined&&current!==null?` [${current}]`:'')+': ')).trim();return s||current;}
function terminal(){if(!process.stdin.isTTY)throw new Error('Průvodce potřebuje interaktivní terminál. Použij ucetni stav nebo ucetni odpoved.');return createInterface({input:process.stdin,output:process.stdout});}
async function chooseEvidence(rl,c,title){
  const docs=c.documents.filter(d=>d.kind==='support'&&d.status==='approved');console.log(title);
  if(!docs.length){console.log('Nejprve importuj potvrzení/výpis a schval jej jako podpůrný podklad.');return undefined;}
  docs.forEach((d,i)=>console.log(`${i+1}: ${d.id} — ${d.label}`));const v=await prompt(rl,'Číslo podkladu (nebo nevím)');if(v==='nevím'||!v)return undefined;const d=docs[Number(v)-1];if(!d)throw new Error('Neplatná volba.');return d.id;
}
async function documentWizard(id,docId,rl){
  const c=await store.read(id),d=c.documents.find(d=>d.id===docId);if(!d)throw new Error('Doklad neexistuje.');
  console.log(`\n${d.id}: ${d.label}\n${d.text?.slice(0,6000)??''}\n\nRozpoznané údaje:\n${JSON.stringify(d.fields,null,2)}`);
  const action=await prompt(rl,'Potvrdit, upravit, vyřadit, nebo nevím?','nevím');
  if(action==='nevím')return;
  if(action==='vyřadit'){const reason=await prompt(rl,'Důvod vyřazení');await reviewDocument(store,id,docId,{status:'excluded',exclusionReason:reason});return;}
  if(!['potvrdit','upravit'].includes(action))throw new Error('Použij potvrdit, upravit, vyřadit, nevím.');
  const fields=structuredClone(d.fields??{});let kind=d.kind;
  if(action==='upravit'||kind==='unknown'){
    kind=await prompt(rl,'Druh: invoice=faktura, receipt=účtenka, support=potvrzení/výpis, reference=výstup účetní',kind==='unknown'?'support':kind);
    if(['invoice','receipt'].includes(kind)){
      for(const[k,label]of Object.entries({number:'Číslo dokladu',date:'Datum vystavení YYYY-MM-DD',vatDate:'DUZP YYYY-MM-DD',supplierDic:'DIČ dodavatele',customerDic:'DIČ odběratele',direction:'Směr income=vydaný, expense=přijatý',currency:'Měna'}))fields[k]=await prompt(rl,label,fields[k]??(k==='currency'?'CZK':undefined));
      fields.totalCents=cents(await prompt(rl,'Celkem včetně DPH v Kč',Number.isSafeInteger(fields.totalCents)?money(fields.totalCents):undefined));
      const rates=(await prompt(rl,'Sazby DPH oddělené čárkou (0, 12, 21)',(fields.rows??[]).map(r=>r.rate).join(',')||'21')).split(',').map(Number),rows=[];
      for(const rate of rates){const old=fields.rows?.find(r=>r.rate===rate);rows.push({rate,baseCents:cents(await prompt(rl,`Základ ${rate} % v Kč`,old?money(old.baseCents):undefined)),vatCents:cents(await prompt(rl,`Daň ${rate} % v Kč`,old?money(old.vatCents):undefined))});}fields.rows=rows;
    }
  }
  if(['invoice','receipt'].includes(kind)&&c.kind==='monthly'){
    if(fields.direction==='income')fields.customerVatPayer=bool(await prompt(rl,'Je odběratel tuzemský plátce DPH?',fields.customerVatPayer===true?'ano':fields.customerVatPayer===false?'ne':undefined));
    if(fields.direction==='expense'){
      fields.receivedDate=await prompt(rl,'Datum přijetí dokladu YYYY-MM-DD',fields.receivedDate);
      fields.claimVat=bool(await prompt(rl,'Uplatnit odpočet v plné výši? (potvrď podnikatelský účel a nárok)',fields.claimVat===true?'ano':fields.claimVat===false?'ne':undefined));
      if(!fields.claimVat)fields.vatDecisionReason=await prompt(rl,'Důvod neuplatnění odpočtu',fields.vatDecisionReason);
    }
  }
  await reviewDocument(store,id,docId,{kind,fields,status:'approved'});
}
async function paymentWizard(id,docId,rl){
  const c=await store.read(id),d=c.documents.find(d=>d.id===docId);console.log(`${d.label}; celkem ${money(d.fields.totalCents)} Kč.`);
  const status=await prompt(rl,'Stav paid=uhrazeno, unpaid=neuhrazeno, partial=částečně, nebo nevím',d.fields.paymentStatus==='unknown'?'nevím':d.fields.paymentStatus);if(status==='nevím')return;
  const payments=[];
  if(status!=='unpaid'){
    const count=Number(await prompt(rl,'Kolik plateb doklad uhradilo?',1));if(!Number.isInteger(count)||count<1||count>30)throw new Error('Neplatný počet plateb.');
    for(let i=0;i<count;i++){const date=await prompt(rl,`Datum připsání platby ${i+1} YYYY-MM-DD`),amountCents=cents(await prompt(rl,'Přijatá částka včetně DPH v Kč',count===1?money(d.fields.totalCents):undefined)),evidenceId=await chooseEvidence(rl,c,'Podklad pro úhradu');if(!evidenceId)return;payments.push({date,amountCents,evidenceId});}
  }
  await reviewDocument(store,id,docId,{fields:{paymentStatus:status,payments}});
}
async function childrenWizard(rl){
  const count=Number(await prompt(rl,'Počet vyživovaných dětí (0 = žádné)'));if(!Number.isInteger(count)||count<0||count>15)throw new Error('Neplatný počet dětí.');const children=[];
  for(let i=0;i<count;i++){
    console.log('Dítě '+(i+1));const ch={};for(const[k,label]of Object.entries({firstName:'Jméno',lastName:'Příjmení',birthNumber:'Rodné číslo',birthDate:'Datum narození YYYY-MM-DD'}))ch[k]=await prompt(rl,label);
    ch.ztpP=bool(await prompt(rl,'Je dítě držitelem průkazu ZTP/P?'));
    ch.householdMonths=months(await prompt(rl,'Měsíce společné domácnosti: např. 1,2,3 nebo 1-12'));
    const claims=months(await prompt(rl,'Měsíce, za které uplatňuješ zvýhodnění ty (druhý rodič je současně neuplatňuje); prázdné = žádné',''));
    ch.claims=[];for(const month of claims)ch.claims.push({month,order:Number(await prompt(rl,`Pořadí dítěte v měsíci ${month}: 1, 2, nebo 3 (třetí a další)`))});children.push(ch);
  }return children;
}
async function spouseWizard(rl){const s={};for(const[k,label]of Object.entries({firstName:'Jméno manžela/manželky',lastName:'Příjmení',birthNumber:'Rodné číslo',marriedSince:'Datum sňatku YYYY-MM-DD'}))s[k]=await prompt(rl,label);s.ztpP=bool(await prompt(rl,'Je manžel/ka držitelem průkazu ZTP/P?'));s.householdMonths=months(await prompt(rl,'Měsíce společné domácnosti: 1,2,… nebo 1-12'));s.annualIncomeCents=cents(await prompt(rl,'Vlastní příjem za CELÝ rok v Kč: včetně mzdy, PPM atd.; bez rodičovského příspěvku'));return s;}
async function guide(id){
  const rl=terminal(),visited=new Set();try{
    for(let step=0;step<250;step++){
      const c=await store.read(id),r=compute(c),q=r.questions.find(q=>!visited.has(q.key));if(!q)break;visited.add(q.key);
      try{
        if(q.type==='document'){await documentWizard(id,q.key.replace(/^(?:document|duplicate)\./,''),rl);continue;}
        if(q.type==='payment'){await paymentWizard(id,q.key.slice(8),rl);continue;}
        if(['material','unsupported'].includes(q.type)){console.log('\n'+q.title);continue;}
        if(q.key==='profile.confirmed')console.log('Profil:\n'+JSON.stringify(c.profile,null,2));
        let value;
        if(q.type==='evidence')value=await chooseEvidence(rl,c,q.title);
        else if(['children','spouse'].includes(q.type)){const proceed=await prompt(rl,q.title+' — vyplnit nyní? ano / nevím','nevím');if(proceed==='ano')value=q.type==='children'?await childrenWizard(rl):await spouseWizard(rl);}
        else {let title=q.title;if(q.type==='filingMode')title+=' Zadej basic / electronic / advisor';if(q.type==='housing')title+=' Zadej before2021 / from2021';const s=await prompt(rl,title+' (nebo nevím)');if(s&&s!=='nevím')value=valueFor(q.type,s);}
        if(value!==undefined)await answer(store,id,q.key,value);
      }catch(e){console.error('Neuloženo: '+e.message);}
    }
    const c=await store.read(id);console.log('\n'+report(c,compute(c),todayCZ()));
  }finally{rl.close();}
}
const unitQuote=s=>{if(/[\r\n\0]/.test(s))throw new Error('Neplatná cesta pro časovač.');return '"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$','$$')+'"';};
async function watchOnce(scheduled=false){
  await privateDir(store.root);const file=path.join(store.root,'watch.json');let state={enabled:false,last:{}};try{state=JSON.parse(await readRegular(file,1024*1024,true));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(scheduled&&!state.enabled)return;
  const alerts=[];
  for(const id of await store.list()){
    const c=await store.read(id),r=compute(c),due=deadlines(c,todayCZ()).filter(d=>['OVERDUE','DUE_SOON'].includes(d.status));
    if(!due.length&&!r.questions.length)continue;
    const text=`${id}: ${r.questions.length} chybějících podkladů/rozhodnutí; ${due.length} blízkých/prošlých termínů bez záznamu o splnění. Spusť ucetni stav ${id}.`,key=hash(text+todayCZ());alerts.push({id,text,due,questionKeys:r.questions.map(q=>q.key),at:new Date().toISOString()});
    if(scheduled&&state.last[id]!==key){try{await execute('notify-send',['Účetní — podklady a termíny',text],{timeout:5000});state.last[id]=key;}catch{console.error('Desktopové oznámení není dostupné; upozornění zůstalo v účetním.');}}
    console.log(text);
  }
  await atomicWrite(path.join(store.root,'alerts.json'),JSON.stringify(alerts,null,2));await atomicWrite(file,JSON.stringify(state,null,2));
}
async function watch(action){
  if(action==='jednou')return watchOnce();if(!['start','stop'].includes(action))throw new Error('Použij hlidat start|stop|jednou.');
  await privateDir(store.root);const config=path.join(store.root,'watch.json');
  if(action==='stop'){await atomicWrite(config,JSON.stringify({enabled:false,last:{}}));await execute('systemctl',['--user','disable','--now','ucetni-watch.timer'],{timeout:10000});return;}
  const dir=path.join(os.homedir(),'.config/systemd/user');await fs.mkdir(dir,{recursive:true});const marker='# Managed by IntentSmith ucetni CLI\n';
  const service=marker+`[Unit]\nDescription=Účetní: kontrola podkladů a termínů\n[Service]\nType=oneshot\nExecStart=${unitQuote(process.execPath)} ${unitQuote(entry)} --scheduled\nEnvironment=${unitQuote('UCETNI_STATE_DIR='+store.root)}\nUMask=0077\nNoNewPrivileges=true\nTimeoutStartSec=45\nMemoryMax=256M\n`;
  const timer=marker+'[Unit]\nDescription=Účetní: denní připomenutí\n[Timer]\nOnCalendar=*-*-* 09:00:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n';
  for(const[name,content]of [['ucetni-watch.service',service],['ucetni-watch.timer',timer]]){const file=path.join(dir,name);try{if(!(await readRegular(file,20000)).toString().startsWith(marker))throw new Error('Cizí systemd jednotku nepřepisuji.');}catch(e){if(e.code!=='ENOENT')throw e;}await atomicWrite(file,content);}
  await atomicWrite(config,JSON.stringify({enabled:true,last:{}}));await execute('systemctl',['--user','daemon-reload'],{timeout:10000});await execute('systemctl',['--user','enable','--now','ucetni-watch.timer'],{timeout:10000});console.log('Místní hlídání zapnuto: každý den v 9:00.');
}
async function main(args){
  let command=args.shift();
  if(!command){if(!process.stdin.isTTY){console.log(HELP);return;}const rl=terminal();try{const ids=await store.list();console.log(ids.length?ids.join('\n'):'Zatím žádné období.');console.log('1 — stav období\n2 — průvodce\n3 — založit měsíc\n4 — založit rok\n0 — konec');const choice=await prompt(rl,'Volba');if(choice==='0')return;if(['1','2'].includes(choice)){const id=await prompt(rl,'ID období',ids.at(-1));rl.close();return main([choice==='1'?'stav':'pruvodce',id]);}if(['3','4'].includes(choice)){const period=await prompt(rl,choice==='3'?'Měsíc YYYY-MM':'Rok YYYY');rl.close();return main([choice==='3'?'mesic':'rok',period]);}console.log(HELP);return;}finally{rl.close();}}
  if(['help','--help'].includes(command)){console.log(HELP);return;}
  if(command==='--scheduled')return watchOnce(true);
  if(command==='hlidat'&&args.length===1)return watch(args[0]);
  if(command==='seznam'&&!args.length){for(const id of await store.list()){const c=await store.read(id),r=compute(c);console.log(`${id}: ${r.status}; ${c.documents.length} dokladů, ${r.questions.length} požadavků; revize ${c.revision}`);}return;}
  if(['mesic','rok'].includes(command)){
    const period=args.shift();if(command==='mesic'&&!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(period??'')||command==='rok'&&!/^20\d{2}$/.test(period??''))throw new Error('Zadej YYYY-MM nebo YYYY.');
    const id=(command==='mesic'?'dph-':'dan-')+period;try{await store.create({id,kind:command==='mesic'?'monthly':'annual',year:Number(period.slice(0,4)),month:command==='mesic'?Number(period.slice(5)):undefined});}catch(e){if(e.code!=='EEXIST')throw e;}
    if(args.length){console.log('Lokálně zpracovávám dokumenty…');const result=await importPaths(store,id,args,{signal:controller.signal});console.log(result.result);}
    console.log(`Evidence ${id} připravena. Pokračuj: ucetni pruvodce ${id}`);return;
  }
  if(['import','vzor'].includes(command)&&args.length>=2){const id=args.shift();console.log('Lokálně zpracovávám dokumenty…');const r=await importPaths(store,id,args,{reference:command==='vzor',signal:controller.signal});console.log(`Přidáno ${r.result.added} zdrojů a ${r.result.documents} návrhů; ${r.result.duplicates} duplicit přeskočeno.`);return;}
  if(command==='nahled'&&args.length===1){console.log(await previewCase(store,args[0]));return;}
  if(command==='srovnej'&&args.length===1){const c=await store.read(args[0]),r=compute(c),rows=comparison(c,r);console.log('Srovnání se vzorem: '+r.status+'. Shoda částek sama nepotvrzuje úplnost podkladů ani správnost nároku.');for(const x of rows)console.log(`${x.label}: vzor ${x.reference} Kč | evidence ${x.current} Kč | rozdíl ${x.difference} Kč`);if(!rows.length)console.log('Chybí rozpoznaný XML vzor pro stejné období.');return;}
  if(command==='pruvodce'&&args.length===1)return guide(args[0]);
  if(command==='doklad'&&args.length===2){const rl=terminal();try{return await documentWizard(args[0],args[1],rl);}finally{rl.close();}}
  if(command==='odpoved'&&args.length>=3){const[id,key,...text]=args,c=await store.read(id);const q=compute(c).questions.find(q=>q.key===key);let type=q?.type??(key.startsWith('profile.')?'text':'boolean');if(['profile.confirmed','profile.vatPayer'].includes(key))type='boolean';if(key==='mortgageMonths')type='integer';if(key==='housingNeedAcquired')type='housing';if(key.endsWith('Evidence'))type='evidence';if(key.endsWith('Amount')||key.endsWith('Advances'))type='money';if(['children','spouse','expenseRate','filingMode'].includes(key))type={children:'children',spouse:'spouse',expenseRate:'rate',filingMode:'filingMode'}[key];await answer(store,id,key,valueFor(type,text.join(' ')));console.log('Uloženo.');return;}
  if(command==='rozdel'&&args.length===3){const m=args[2].match(/^([1-6])x([1-6])$/);if(!m)throw new Error('Rozložení např. 3x2.');await splitSource(store,args[0],args[1],[Number(m[1]),Number(m[2])]);console.log('Návrhy oblastí obnoveny; zkontroluj úplnost fotografie.');return;}
  if(command==='podano'&&args.length===4){await recordFiling(store,...args);console.log('Skutečné podání/platba zapsána s potvrzením.');return;}
  if(command==='export'&&(args.length===1||args.length===2&&args[1]==='--navrh')){const result=await exportCase(store,args[0],{draft:args[1]==='--navrh'});console.log(`${result.manifest.status}\n${result.zipPath}`);return;}
  if(command==='stav'&&args.length===1){const c=await store.read(args[0]);console.log(report(c,compute(c),todayCZ()));return;}
  if(command==='terminy'&&args.length<=1){for(const id of args.length?args:await store.list()){const c=await store.read(id);for(const d of deadlines(c,todayCZ()))console.log(`${id} | ${d.due} | ${d.title} | ${d.status}${d.condition?' | '+d.condition:''}`);}return;}
  throw new Error('Neznámý příkaz. Použij ucetni --help.');
}
main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
