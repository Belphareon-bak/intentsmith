// Local document workflow host. The specialist receives a single-use closure,
// never a path, store, filesystem handle, or another conversation's case ID.
import path from 'node:path';
import os from 'node:os';
import {AccountingStore, hash, privateDir, atomicWrite, readRegular} from './store.js';
import {importEntries, compute, answer, reviewDocument, exportCase} from './service.js';
import {validateM1Attachments, createM1AttachmentLimits} from '../ws-bridge/m1-attachment-policy.js';
import {throwIfAborted} from '../core/abort-error.js';

const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const months=['leden','unor','brezen','duben','kveten','cerven','cervenec','srpen','zari','rijen','listopad','prosinec'];
export function requestedPeriod(input, attachments=[]) {
  const text=normalize(input.split('\n📎')[0]);
  const yearMatch=text.match(/\b(202[4-9]|2030)\b/);
  const named=months.findIndex(m=>new RegExp('\\b'+m+'\\b').test(text));
  const iso=text.match(/\b(202[4-9]|2030)-(0[1-9]|1[0-2])\b/);
  const numerical=text.match(/\b(0?[1-9]|1[0-2])[/.](202[4-9]|2030)\b/);
  let year=yearMatch?Number(yearMatch[1]):null;
  let month=iso?Number(iso[2]):numerical?Number(numerical[1]):named>=0?named+1:null;
  // The year from a filename is a proposed scope only; no document is approved.
  const years=[...new Set(attachments.flatMap(a=>[...a.name.matchAll(/\b(202[4-9]|2030)\b/g)].map(m=>Number(m[1]))))];
  if(!year&&years.length===1)year=years[0];
  const annual=/danove\s+priznani|rocni|\bdpfo\b/.test(text)&&!/\bdph\b|kontrolni/.test(text);
  if(!year||(!annual&&!month))return null;
  return {year,month:annual?null:month,kind:annual?'annual':'monthly',id:annual?`dan-${year}`:`dph-${year}-${String(month).padStart(2,'0')}`};
}
const clean = value => String(value??'—').replace(/[|\r\n]/g,' ');
export function renderAccountingCase(c,{allQuestions=false,note=''}={}) {
  const r=compute(c);
  const lines=[`Účetní — ${c.kind==='monthly'?'DPH a kontrolní hlášení':'Daňové přiznání'} ${c.year}${c.month?'-'+String(c.month).padStart(2,'0'):''}`,note,
    `Načteno ${c.sources.length} souborů, ${c.documents.length} návrhů dokladů. Revize ${c.revision}.`,
    'Rozpoznané údaje je potřeba zkontrolovat; žádný doklad se neschvaluje automaticky.', '',
    '| Doklad | Soubor | Číslo | Celkem Kč | Stav |','|---|---|---|---:|---|',
    ...c.documents.map(d=>`| ${d.id} | ${clean(d.label)} | ${clean(d.fields.number)} | ${Number.isSafeInteger(d.fields.totalCents)?(d.fields.totalCents/100).toFixed(2):'—'} | ${d.status} |`),
    '',r.status==='READY_FOR_EXPORT'?'Podklady jsou připravené k exportu.':'K dokončení potřebuji:',
    ...r.questions.slice(0,allQuestions?undefined:12).map(q=>`- ${q.title}`),
    !allQuestions&&r.questions.length>12?`Dalších ${r.questions.length-12} požadavků zobrazíš zprávou „podklady“.`:'',
    '', 'V této konverzaci můžeš pokračovat: „stav“, „podklady“, „doklady“, „export navrh“ nebo „export“.',
    'Napiš „pruvodce“ a postupně se zeptám na chybějící údaje. „Nápověda“ zobrazí také zadávání oprav dokladů.',
    'Export pro podání vznikne až po doplnění a kontrole požadovaných údajů.'
];
  return {text:lines.filter(x=>x!==null).join('\n'),caseId:c.id,status:r.status,sourceCount:c.sources.length,documentCount:c.documents.length,revision:c.revision};
}
export function createAccountingChatHost({root=process.env.INTENTSMITH_ACCOUNTING_STATE_DIR||path.join(os.homedir(),'.local/state/ucetni/studio'),limits=createM1AttachmentLimits()}={}) {
  return Object.freeze({openInvocation({extensionId,toolId,conversationId,projectId=null,userMessageId,attachments=[],signal}){
    if(!['accountant-cz','accountant'].includes(extensionId)||toolId!=='accountant.document_workflow'||typeof conversationId!=='string'||!conversationId.trim()||!userMessageId)throw new Error('ACCOUNTING_TURN_AUTHORITY_REQUIRED');
    const verdict=validateM1Attachments(attachments,limits);
    if(!verdict.ok)throw new Error(verdict.code);
    const selected=verdict.attachments;
    const key=hash(Buffer.from(JSON.stringify({conversationId,projectId}))).slice(0,40);
    const scopeRoot=path.join(root,key),store=new AccountingStore(scopeRoot);
    let active=true,used=false;
    const check=()=>{throwIfAborted(signal);if(!active)throw new Error('ACCOUNTING_SCOPE_EXPIRED');};
    return Object.freeze({close(){active=false;},async run(input){
      check();if(used)throw new Error('ACCOUNTING_TURN_ALREADY_USED');used=true;
      const period=requestedPeriod(input,selected);await privateDir(root);await privateDir(scopeRoot);
      const activeFile=path.join(scopeRoot,'active.json');let current;
      try{current=JSON.parse(await readRegular(activeFile,2048,true));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(period){
        try{await store.read(period.id);}catch(e){if(e.code!=='ENOENT')throw e;check();await store.create(period);}
        current={id:period.id};check();await atomicWrite(activeFile,JSON.stringify(current));
      }
      if(!current)return {status:'NEEDS_INPUT',text:'Napiš období včetně roku, například „kontrolní hlášení za květen 2026“, a připoj PDF nebo HEIC. Bez jednoznačného období dokumenty nezapisuji.'};
      let note='';
      if(selected.length){
        const entries=selected.map(a=>{
          const m=/^data:(application\/pdf|image\/(?:heic|heif|png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(a.content);
          if(!m)throw new Error('Účetní přijímá skutečné PDF nebo fotografie (HEIC, HEIF, PNG, JPEG, GIF, WebP).');
          const bytes=Buffer.from(m[2],'base64');if(!bytes.length)throw new Error('Příloha je prázdná.');
          return {name:path.basename(a.name),bytes};
        });
        check();const imported=await importEntries(store,current.id,entries,{signal});
        note=`Nové soubory: ${imported.result.added}; již uložené: ${imported.result.duplicates}. Zpracování proběhlo lokálně.`;
        await store.mutate(current.id,'studio-import',c=>{c.audit.push({event:'studio-source',userMessageId,at:new Date().toISOString()});});
      }
      check();const text=input.split('\n📎')[0].trim(),n=normalize(text);
      const a=text.match(/^odpov[eě][dď]\s+([A-Za-z0-9.]+)\s*=\s*([\s\S]+)$/i);
      const d=text.match(/^doklad\s+(d-[a-f0-9]{16}(?:-\d+)?)\s*=\s*([\s\S]+)$/i);
      if(n==='napoveda')return {text:'Přílohy přidávej přímo do této konverzace. „pruvodce“ se postupně ptá na údaje; „doklady“ zobrazí detaily. Pokročilá oprava: `doklad ID = {"fields":{"number":"202605"}}`. Po kontrole: `doklad ID = {"status":"approved"}`. Částky v tomto technickém vstupu jsou celé haléře. Údaj lze zadat také jako `odpoved profile.firstName = "Jan"`. „export navrh“ uloží pracovní balíček; „export“ vyžaduje úplnou zkontrolovanou evidenci.'};
      if(current.question && !selected.length && !period && !a && !d && !/^(stav|podklady|doklady|export(?: navrh)?|pruvodce)$/.test(n)){
        const q=current.question;
        const value=q.type==='boolean'?(/^(ano|true)$/.test(n)?true:/^(ne|false)$/.test(n)?false:null):text;
        if(value===null)return {text:q.title+' Odpověz ano nebo ne.'};
        check();await answer(store,current.id,q.key,value);current.question=null;
        await atomicWrite(activeFile,JSON.stringify(current));
      }
      if(n==='pruvodce'||current.guided){
        current.guided=true;const c=await store.read(current.id),r=compute(c);
        const q=r.questions.find(q=>q.type==='text'||q.type==='boolean');
        if(q){current.question={key:q.key,type:q.type,title:q.title};await atomicWrite(activeFile,JSON.stringify(current));
          if(!/^(stav|podklady|doklady|export(?: navrh)?)$/.test(n)&&!selected.length&&!a&&!d)return {status:r.status,text:(q.key==='profile.confirmed'?Object.entries(c.profile).filter(([k])=>k!=='confirmed').map(([k,v])=>k+': '+v).join('\n')+'\n\n':'')+q.title+(q.type==='boolean'?' Odpověz ano nebo ne.':'')};
        }else{current.question=null;current.guided=false;await atomicWrite(activeFile,JSON.stringify(current));}
      }
      if(a)await answer(store,current.id,a[1],JSON.parse(a[2]));
      if(d)await reviewDocument(store,current.id,d[1],JSON.parse(d[2]));
      if(/^doklady$/.test(n)){
        const c=await store.read(current.id);
        return {status:compute(c).status,text:c.documents.map(d=>`${d.id} — ${d.label}\n\n\`\`\`json\n${JSON.stringify({fields:d.fields,kind:d.kind,status:d.status},null,2)}\n\`\`\``).join('\n\n')||'Zatím nejsou vložené doklady.'};
      }
      if(/^export(?:\s+navrh)?$/.test(n)){
        check();const e=await exportCase(store,current.id,{draft:n.includes('navrh')});
        note=`${n.includes('navrh')?'Pracovní návrh, není určen k podání':'Validovaný balíček'} uložen lokálně: ${e.zipPath}`;
      }
      check();return renderAccountingCase(await store.read(current.id),{allQuestions:n==='podklady',note});
    }});
  }});
}
