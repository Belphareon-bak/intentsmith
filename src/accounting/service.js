import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {worker} from './worker.js';
import {hash,readRegular,privateDir,atomicWrite} from './store.js';
import {extractDocument,referenceProfile} from '../../specialists/accountant-cz/workflow/extraction.js';
import {computeMonthly} from '../../specialists/accountant-cz/workflow/monthly.js';
import {computeAnnual,ANNUAL_FACTS,DEDUCTIONS} from '../../specialists/accountant-cz/workflow/annual.js';
import {monthlyForms,annualForms,ozpPDFFields,xmlElement} from '../../specialists/accountant-cz/workflow/forms.js';
import {report,declaration} from '../../specialists/accountant-cz/workflow/report.js';
import {deadlines,calendar} from '../../specialists/accountant-cz/workflow/deadlines.js';
import {validateDocument,validDate,periodKey,rejectUnknownKeys} from '../../specialists/accountant-cz/workflow/common.js';

export const todayCZ=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());
export function compute(c){
  const r=c.kind==='monthly'?computeMonthly(c):computeAnnual(c,todayCZ());
  for(const s of c.sources)if(s.coverageReviewRequired&&c.answers['coverage.'+s.id]!==true)r.questions.push({key:'coverage.'+s.id,title:`${s.name}: ověř, že jsou naimportované všechny doklady z fotografie a žádný není rozdělený mezi oblasti.`,type:'boolean'});
  r.status=r.questions.length?'NEEDS_REVIEW':'READY_FOR_EXPORT';return r;
}
const invalidate=c=>{if(c.answers.monthComplete!==undefined)c.answers.monthComplete=false;if(c.answers.incomeComplete!==undefined)c.answers.incomeComplete=false;};
export async function inputFiles(input){
  const root=path.resolve(input),st=await fs.lstat(root);
  if(st.isSymbolicLink())throw new Error('Vstup nesmí být symbolický odkaz.');
  if(st.isFile())return [root];if(!st.isDirectory())throw new Error('Vstup není soubor ani složka.');
  const result=[];
  async function walk(dir,depth){for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(e.name.startsWith('.'))continue;if(e.isSymbolicLink())throw new Error('Složka obsahuje symbolický odkaz: '+e.name);
    const p=path.join(dir,e.name);if(e.isDirectory()){if(depth>=3)throw new Error('Složka je příliš hluboká.');await walk(p,depth+1);}else if(e.isFile()){result.push(p);if(result.length>100)throw new Error('Najednou lze importovat nejvýše 100 souborů.');}
  }}
  await walk(root,0);return result.sort();
}
export async function importPaths(store,id,inputs,{reference=false,signal}={}){
  const files=[];for(const input of inputs)files.push(...await inputFiles(input));
  const entries=[];for(const file of files)entries.push({name:path.basename(file),bytes:await readRegular(file)});
  return importEntries(store,id,entries,{reference,signal});
}
export async function importEntries(store,id,entries,{reference=false,signal}={}){
  return store.mutate(id,reference?'reference-import':'document-import',async c=>{
    const stats={added:0,duplicates:0,documents:0};let bytesTotal=0;
    async function add(name,bytes,parent=null,depth=0){
      if(signal?.aborted)throw new Error('Import zrušen.');bytesTotal+=bytes.length;if(bytesTotal>96*1024*1024)throw new Error('Import přesáhl 96 MiB.');
      const sha=hash(bytes);if(c.sources.some(s=>s.sha256===sha)){stats.duplicates++;return;}
      const decoded=await worker({operation:'decode',name,data:bytes.toString('base64')},{signal});
      await store.saveSource(id,bytes);
      const source={id:sha.slice(0,16),sha256:sha,name,type:decoded.type,parent,importedAt:new Date().toISOString(),coverageReviewRequired:!reference&&decoded.coverageReviewRequired===true};c.sources.push(source);stats.added++;
      if(decoded.type==='zip'){
        if(depth>0)throw new Error('Vnořené archivy nejsou podporované.');
        for(const member of decoded.members)await add(member.name,Buffer.from(member.data,'base64'),source.id,depth+1);return;
      }
      if(decoded.type==='xml'){
        if(!decoded.forms?.length)throw new Error('XML není rozpoznaný podporovaný účetní formulář.');
        c.references.push({sourceId:source.id,forms:decoded.forms});
        const proposal=referenceProfile(decoded.forms);
        for(const[k,v]of Object.entries(proposal.profile))if(!c.profile[k])c.profile[k]=v;
        c.profile.confirmed=false;
        for(const attachment of decoded.attachments??[])await add('Příloha z XML — '+attachment.name,Buffer.from(attachment.data,'base64'),source.id,depth+1);
        return;
      }
      if(reference){
        c.documents.push({id:'d-'+source.id,sourceId:source.id,label:name,kind:'reference',status:'approved',fields:{},text:decoded.pages.map(p=>p.text).join('\n'),sourceRef:{sourceId:source.id},provenance:{}});stats.documents++;return;
      }
      for(const [i,page]of decoded.pages.entries()){
        const document=extractDocument(page,source,c.profile);document.id='d-'+source.id+'-'+(i+1);document.sourceId=source.id;document.label=name+(decoded.pages.length>1?` — část ${i+1}`:'');
        c.documents.push(document);stats.documents++;
      }
      if(source.coverageReviewRequired)source.proposedGrid=decoded.proposedGrid;
    }
    for(const entry of entries)await add(entry.name,entry.bytes);
    if(signal?.aborted)throw new Error('Import zrušen.');
    if(stats.added)invalidate(c);return stats;
  });
}
export function validateAnswer(key,value){
  const profileKeys=['firstName','lastName','dic','birthNumber','taxOffice','taxOfficeBranch','street','houseNumber','orientationNumber','city','postalCode','nace','csszOffice','socialVariableSymbol','healthInsurer','ico','email','dataBox'];
  if(key.startsWith('profile.')){
    const field=key.slice(8);if(['confirmed','vatPayer'].includes(field)){if(typeof value!=='boolean')throw new Error('Odpověď musí být ano/ne.');}
    else if(!profileKeys.includes(field)||typeof value!=='string'||value.length>150||/[\r\n\0]/.test(value))throw new Error('Neplatné pole profilu.');
    return;
  }
  const facts=Object.fromEntries(ANNUAL_FACTS.map(([k,,t])=>[k,t]));
  Object.assign(facts,{domesticStandardOnly:'boolean',monthComplete:'boolean',spouse:'spouse',housingNeedAcquired:'housing',mortgageHouseholdAllocationConfirmed:'boolean',mortgageMonths:'integer'});
  for(const k of Object.keys(DEDUCTIONS)){facts[k+'Amount']='money';facts[k+'Evidence']='evidence';facts[k+'Eligible']='boolean';}
  for(const k of ['children','spouse','taxAdvances','socialAdvances','healthAdvances'])facts[k+'Evidence']='evidence';
  if(/^coverage\.[a-f0-9]{16}$/.test(key))facts[key]='boolean';
  const type=facts[key];if(!type)throw new Error('Neznámý účetní údaj: '+key);
  if(type==='boolean'&&typeof value!=='boolean')throw new Error('Odpověď musí být ano/ne.');
  if(type==='money'&&(!Number.isSafeInteger(value)||value<0))throw new Error('Částka musí být nezáporné celé haléře.');
  if(type==='rate'&&![30,40,60,80].includes(value))throw new Error('Neplatná sazba paušálu.');
  if(type==='integer'&&(!Number.isInteger(value)||value<1||value>12))throw new Error('Počet měsíců musí být 1–12.');
  if(type==='filingMode'&&!['basic','electronic','advisor'].includes(value))throw new Error('Neplatný způsob podání.');
  if(type==='housing'&&!['before2021','from2021'].includes(value))throw new Error('Neplatné období bytové potřeby.');
  if(type==='evidence'&&(typeof value!=='string'||!/^d-[a-f0-9]{16}(?:-\d+)?$/.test(value)))throw new Error('Potvrzení musí odkazovat na ID dodaného podkladu.');
  if(type==='children'){
    if(!Array.isArray(value)||value.length>15)throw new Error('Neplatný seznam dětí.');
    for(const ch of value){rejectUnknownKeys(ch,['firstName','lastName','birthNumber','birthDate','householdMonths','claims','ztpP']);if(!Array.isArray(ch.claims)||!Array.isArray(ch.householdMonths)||!validDate(ch.birthDate)||typeof ch.ztpP!=='boolean')throw new Error('Doplň datum, domácnost, ZTP/P a měsíce nároku.');for(const x of ch.claims)rejectUnknownKeys(x,['month','order']);}
  }
  if(type==='spouse'){rejectUnknownKeys(value,['firstName','lastName','birthNumber','marriedSince','householdMonths','annualIncomeCents','ztpP']);if(!validDate(value.marriedSince)||!Array.isArray(value.householdMonths)||!Number.isSafeInteger(value.annualIncomeCents)||value.annualIncomeCents<0||typeof value.ztpP!=='boolean')throw new Error('Doplň sňatek, měsíce domácnosti, ZTP/P a příjmy.');}
}
export async function answer(store,id,key,value){validateAnswer(key,value);return store.mutate(id,'answer:'+key,c=>{if(key.startsWith('profile.')){const field=key.slice(8);c.profile[field]=value;if(field!=='confirmed')c.profile.confirmed=false;}else c.answers[key]=value;});}
export async function reviewDocument(store,id,documentId,change){
  rejectUnknownKeys(change,['fields','kind','status','exclusionReason','label']);
  if(change.fields)rejectUnknownKeys(change.fields,['number','date','vatDate','receivedDate','direction','currency','totalCents','rows','supplierDic','customerDic','customerVatPayer','claimVat','vatDecisionReason','paymentStatus','payments']);
  return store.mutate(id,'document-review:'+documentId,c=>{
    const d=c.documents.find(d=>d.id===documentId);if(!d)throw new Error('Doklad neexistuje.');
    const next={...d,...change,fields:{...d.fields,...change.fields}};
    if(!['invoice','receipt','support','reference','unknown'].includes(next.kind)||!['draft','approved','excluded'].includes(next.status))throw new Error('Neplatný druh nebo stav dokladu.');
    if(next.status==='excluded'&&!next.exclusionReason?.trim())throw new Error('Vyřazení potřebuje důvod.');
    if(next.status==='approved'&&next.kind==='unknown')throw new Error('Nejdřív urči druh podkladu.');
    if(next.status==='approved'&&validateDocument(next).length)throw new Error(validateDocument(next).join('; '));
    if(next.fields.payments&&!Array.isArray(next.fields.payments))throw new Error('Platby musí být seznam.');
    for(const p of next.fields.payments??[]){rejectUnknownKeys(p,['date','amountCents','evidenceId']);if(!validDate(p.date)||!Number.isSafeInteger(p.amountCents)||p.amountCents<=0)throw new Error('Neplatná úhrada.');}
    const reviewedAt=new Date().toISOString();next.provenance={...d.provenance};
    for(const [key,value]of Object.entries(change.fields??{}))if(JSON.stringify(value)!==JSON.stringify(d.fields?.[key]))next.provenance[key]={...d.sourceRef,method:'operator-review',reviewedAt,previous:d.provenance?.[key]??null};
    Object.assign(d,next,{reviewedAt,reviewedBy:'operator'});invalidate(c);
  });
}
export async function splitSource(store,id,sourceId,grid){
  return store.mutate(id,'image-split:'+sourceId,async c=>{
    const s=c.sources.find(s=>s.id===sourceId&&s.type==='image');if(!s)throw new Error('Fotografie neexistuje.');
    if(c.documents.some(d=>d.sourceId===sourceId&&d.status!=='draft'))throw new Error('Zkontrolované doklady se novým rozdělením nepřepisují. Nejdřív je vrať do návrhu.');
    const decoded=await worker({operation:'decode',name:s.name,data:(await store.source(id,s.sha256)).toString('base64'),grid});
    c.documents=c.documents.filter(d=>d.sourceId!==sourceId);
    for(const[i,page]of decoded.pages.entries())c.documents.push({...extractDocument(page,s,c.profile),id:'d-'+sourceId+'-'+(i+1),sourceId,label:s.name+' — část '+(i+1)});
    s.proposedGrid=grid;c.answers['coverage.'+sourceId]=false;invalidate(c);
  });
}
export async function recordFiling(store,id,key,date,evidenceId){
  if((!['kh','vat','vatPayment','dpfo','taxPayment','cssz','csszPayment','health','healthPayment'].includes(key)&&! /^(cssz|health)Advance-2026-(0[1-9]|1[0-2])$|^taxAdvance-2026-(3|6|9|12)$/.test(key))||!validDate(date)||date>todayCZ())throw new Error('Neplatný druh nebo datum skutečného podání/platby.');
  return store.mutate(id,'filing-record:'+key,c=>{if(!c.documents.some(d=>d.id===evidenceId&&d.kind==='support'&&d.status==='approved'))throw new Error('Dodej potvrzení podání nebo připsání platby.');c.filings[key]={date,evidenceId,recordedAt:new Date().toISOString()};});
}
const encode=b=>Buffer.from(b).toString('base64');
export async function exportCase(store,id,{draft=false}={}){
  const c=await store.read(id),r=compute(c),today=todayCZ(),now=new Date().toISOString(),text=report(c,r,today),files=[],add=(name,bytes)=>files.push({name,data:encode(bytes)});
  if(r.status!=='READY_FOR_EXPORT'&&!draft)throw new Error('Nejsou doplněné podklady. Spusť ucetni pruvodce '+id+'; pracovní balíček lze uložit přepínačem --navrh.');
  for(const source of c.sources)await store.source(id,source.sha256);
  const forms=draft?[]:c.kind==='monthly'?monthlyForms(c,r,today):annualForms(c,r,today);
  // Attach the referenced, approved supporting PDFs to the DPFO itself, so the
  // XML is not silently missing the evidence listed beside it in the ZIP.
  const dpfoEvidence=new Map(),categories={pension:'potv_penpri',lifeInsurance:'potv_zivpoj',dip:'potv_inpr',longTermCare:'potv_pece',gifts:'doklad_dar',mortgage:'potv_uver'};
  for(const [key,category]of Object.entries(categories))if(r.claimed?.[key]>0&&c.answers[key+'Evidence'])dpfoEvidence.set(c.answers[key+'Evidence'],category);
  if(r.spouseCredit&&c.answers.spouseEvidence)dpfoEvidence.set(c.answers.spouseEvidence,'dal_prilohy');
  if(r.childCredit&&c.answers.childrenEvidence)dpfoEvidence.set(c.answers.childrenEvidence,'potv_dazvyh');
  const evidenceIds=[...new Set([...Object.entries(c.answers).filter(([k,v])=>k.endsWith('Evidence')&&typeof v==='string').map(([,v])=>v),...c.documents.flatMap(d=>(d.fields?.payments??[]).map(p=>p.evidenceId))])];
  const attachments=[],counts={priloha1:1};
  for(const docId of evidenceIds){
    const d=c.documents.find(d=>d.id===docId&&d.kind==='support'&&d.status==='approved'),s=c.sources.find(s=>s.id===d?.sourceId);if(!s)continue;
    const bytes=await store.source(id,s.sha256),ext=path.extname(s.name).toLowerCase()||'.bin';add(`podklady/${docId}${ext}`,bytes);
    if(!dpfoEvidence.has(docId))continue;
    let pdf=bytes;if(s.type!=='pdf'){const converted=await worker({operation:'source_pdf',name:s.name,type:s.type,data:bytes.toString('base64')});pdf=Buffer.from(converted.data,'base64');add(`podklady/${docId}-opis.pdf`,pdf);}
    const {pages}=await worker({operation:'pdf_pages',data:pdf.toString('base64')}),category=dpfoEvidence.get(docId);counts[category]=(counts[category]??0)+pages;
    attachments.push({name:docId+'.pdf',bytes:pdf});
  }
  if(forms.length&&c.kind==='annual'&&attachments.length){
    const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    const xml=attachments.map((x,i)=>`<ObecnaPriloha kodovani="base64" jm_souboru="${escape(x.name)}" nazev="Podklad ${i+1}" cislo="${i+1}">${x.bytes.toString('base64')}</ObecnaPriloha>`).join('');
    forms[0].xml=forms[0].xml.replace(/<VetaB[^>]*\/>/,xmlElement('VetaB',counts)).replace('</DPFDP7>',`<Prilohy>${xml}</Prilohy></DPFDP7>`);
  }
  const validation=forms.length?await worker({operation:'validate',forms}):[];
  if(validation.some(v=>!v.valid))throw new Error('XML neprošlo XSD validací: '+JSON.stringify(validation.filter(v=>!v.valid)));
  for(const f of forms)add(f.name,f.xml);
  add('Souhrn.txt',text);add('Terminy.ics',calendar(c,deadlines(c,today),now));
  const prefix=draft?'NAVRH-':'';
  const summaryPdf=await worker({operation:'pdf',title:prefix+'Přehled termínů a plateb',lines:text.split('\n')});add(prefix+'Přehled_termínů_plateb.pdf',Buffer.from(summaryPdf.data,'base64'));
  if(c.kind==='annual'){
    for(const[name,title,lines]of [
      ['Přiznání_DPFO.pdf','Přiznání DPFO — čitelný opis výpočtu',[`Rok ${c.year}; ${c.profile.firstName??''} ${c.profile.lastName??''}`,`DIČ ${c.profile.dic??''}`,`Základ §7 / ř. 37: ${r.base}`,`Odpočty / ř. 54: ${r.deductions}`,`Základ na sta Kč / ř. 56: ${r.roundedBase}`,`Daň před slevami / ř. 57: ${r.rawTax}`,`Poplatník: ${r.taxpayerCredit}; manžel/ka: ${r.spouseCredit}; děti: ${r.childCredit}`,`Daň: ${r.tax}; bonus: ${r.bonus}; zálohy: ${(c.answers.taxAdvances??0)/100}`,`Zbývá doplatit (+) / přeplatek (−): ${r.taxBalance}`]],
      ['Příloha_č._1_přiznání_DPFO.pdf','Příloha č. 1 DPFO — čitelný opis §7',[`Příjmy / ř. 101: ${r.income}`,`Výdaje / ř. 102: ${r.expenses}`,`Rozdíl / ř. 104: ${r.base}`,`Sazba paušálu: ${c.answers.expenseRate??'NEZADÁNO'} %`,...r.paymentRows.map(p=>`${p.date}: ${p.number}, příjem bez DPH ${(p.netCents/100).toFixed(2)} Kč`)]],
      ['Přehled_pro_OSSZ.pdf','Přehled ČSSZ — čitelný opis výpočtu',[`Rok ${c.year}; základ §7 na přehledu: ${r.insuranceTaxBase}`,`Vyměřovací základ: ${r.socialBase}`,`Pojistné: ${r.social}; zálohy: ${(c.answers.socialAdvances??0)/100}`,`Doplatek (+) / přeplatek (−): ${r.socialBalance}`,`Nová měsíční záloha: ${r.newSocial}`]],
    ]){const p=await worker({operation:'pdf',title:prefix+title,lines:[r.status,'Čitelný opis; pro elektronické podání slouží přiložené XML.',...lines]});add(prefix+name,Buffer.from(p.data,'base64'));}
    const declarationPdf=await worker({operation:'pdf',title:'Návrh čestného prohlášení',lines:declaration(c)});add('Cestne_prohlaseni-K_PODPISU.pdf',Buffer.from(declarationPdf.data,'base64'));
    if(!draft){const p=await worker({operation:'ozp_pdf',fields:ozpPDFFields(c,r,today)});add('Přehled_pro_OZP.pdf',Buffer.from(p.data,'base64'));}
  }
  const manifest={version:1,caseId:id,revision:c.revision,status:draft?'DRAFT_NOT_FOR_FILING':'XSD_VALIDATED_REVIEW_REQUIRED',createdAt:now,ruleset:r.ruleset,validation,sourceHashes:c.sources.map(s=>s.sha256),files:files.map(f=>({name:f.name,sha256:hash(Buffer.from(f.data,'base64'))})),submission:'NOT_SUBMITTED'};
  add('manifest.json',JSON.stringify(manifest,null,2));add('Vypocet.json',JSON.stringify(r,null,2));
  const zipped=await worker({operation:'zip',files});
  // A concurrent edit invalidates this export; never label stale data current.
  if((await store.read(id)).revision!==c.revision)throw new Error('Evidence se během exportu změnila. Zopakuj export.');
  const parent=path.join(store.dir(id),'exports');await privateDir(parent);const destination=path.join(parent,`${prefix}${periodKey(c)}-r${c.revision}-${randomUUID().slice(0,8)}`);await privateDir(destination);
  for(const f of files){const target=path.join(destination,f.name);await privateDir(path.dirname(target));await fs.writeFile(target,Buffer.from(f.data,'base64'),{mode:0o600,flag:'wx'});}
  const zipPath=destination+'.zip';await fs.writeFile(zipPath,Buffer.from(zipped.data,'base64'),{mode:0o600,flag:'wx'});
  await atomicWrite(path.join(parent,'last-export.json'),JSON.stringify({revision:c.revision,zipPath,destination,status:manifest.status}));
  return {zipPath,destination,manifest};
}
