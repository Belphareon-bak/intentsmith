import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {suite,testAsync,summary} from './harness.js';
import {createAccountingChatHost,requestedPeriod} from '../src/accounting/chat-host.js';
import {AccountingStore,hash} from '../src/accounting/store.js';
import {worker} from '../src/accounting/worker.js';
import {importPaths,answer,reviewDocument,compute,exportCase} from '../src/accounting/service.js';
import {ANNUAL_FACTS} from '../specialists/accountant-cz/workflow/annual.js';

if(process.env.INTENTSMITH_PDF_PYTHON)process.env.UCETNI_RUNTIME_DIR=path.resolve(path.dirname(process.env.INTENTSMITH_PDF_PYTHON),'../..');
const execute=promisify(execFile),root=await fs.mkdtemp(path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR??os.tmpdir(),'accountant-journey-')),store=new AccountingStore(path.join(root,'state'));
const profile={firstName:'Test',lastName:'Příklad',dic:'7001010007',birthNumber:'7001010007',taxOffice:'451',taxOfficeBranch:'2001',street:'Testovací',houseNumber:'1',city:'Praha',postalCode:'11000',confirmed:true,vatPayer:true,nace:'620100',csszOffice:'101',socialVariableSymbol:'12345678',healthInsurer:'207'};
let invoiceId,supportId;
suite('Accountant local host and serialized exports');
await testAsync('CLI starts with no server and creates an isolated monthly case',async()=>{
  const r=await execute(process.execPath,['bin/ucetni.js','mesic','2026-05'],{env:{...process.env,UCETNI_STATE_DIR:store.root}});assert(r.stdout.includes('dph-2026-05'));assert.equal((await store.read('dph-2026-05')).revision,0);
});
await testAsync('PDF import, source hash, duplicate import, and review preserve exact amounts',async()=>{
  const p=await worker({operation:'pdf',title:'Faktura 2026-05',lines:['DIČ CZ7001010007 DIČ CZ12345679','Datum vystavení 28.05.2026','Datum zdan. plnění 28.05.2026','Celkem bez DPH 10 000,00 Kč','DPH 21 % 2 100,00 Kč','Celkem 12 100,00 Kč']});
  const file=path.join(root,'invoice.pdf');await fs.writeFile(file,Buffer.from(p.data,'base64'));
  await store.mutate('dph-2026-05','fixture-profile',c=>{c.profile=profile;});
  const imported=await importPaths(store,'dph-2026-05',[file]);assert.equal(imported.result.added,1);assert.equal(imported.result.documents,1);const c=imported.c,d=c.documents[0];invoiceId=d.id;
  assert.equal(d.status,'draft');assert.equal(d.fields.totalCents,1210000);assert.equal(hash(await fs.readFile(file)),c.sources[0].sha256);
  const dup=await importPaths(store,c.id,[file]);assert.equal(dup.result.duplicates,1);assert.equal(dup.c.revision,c.revision);
  await reviewDocument(store,c.id,d.id,{fields:{customerVatPayer:true},status:'approved'});await answer(store,c.id,'domesticStandardOnly',true);await answer(store,c.id,'monthComplete',true);
  assert.equal(compute(await store.read(c.id)).status,'READY_FOR_EXPORT');
});
await testAsync('monthly ZIP contains two validated XMLs with exact source revision, then edit invalidates readiness',async()=>{
  const e=await exportCase(store,'dph-2026-05');assert.equal(e.manifest.validation.length,2);assert(e.manifest.validation.every(x=>x.valid));
  const unpacked=await worker({operation:'decode',name:'output.zip',data:(await fs.readFile(e.zipPath)).toString('base64')});assert(unpacked.members.some(m=>m.name==='DPHKH-2026-05.xml'));assert(unpacked.members.some(m=>m.name==='DPHDP-2026-05.xml'));
  const xml=(await fs.readFile(path.join(e.destination,'DPHKH-2026-05.xml'))).toString();assert(xml.includes('dan1="2100.00"'));assert.equal((await fs.stat(e.zipPath)).mode&0o077,0);
  await reviewDocument(store,'dph-2026-05',invoiceId,{fields:{number:'corrected'}});await assert.rejects(()=>exportCase(store,'dph-2026-05'),/podklady/);
});
await testAsync('incomplete annual case creates a clearly marked draft without XML filings',async()=>{
  await store.create({kind:'annual',year:2025,id:'dan-2025'});const e=await exportCase(store,'dan-2025',{draft:true});assert.equal(e.manifest.status,'DRAFT_NOT_FOR_FILING');assert(e.manifest.files.every(x=>!x.name.endsWith('.xml')));assert((await fs.readFile(path.join(e.destination,'Souhrn.txt'))).toString().includes('ROZPRACOVÁNO'));
});
await testAsync('annual folder import + confirmed evidence produces valid DPFO, CSSZ, OZP and readable PDFs',async()=>{
  const dir=path.join(root,'annual-input');await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,'potvrzeni.txt'),'Potvrzení o úhradě faktury 2025-01 a zaplacených zálohách. Syntetický testovací podklad.');
  const p=await worker({operation:'pdf',title:'Faktura 2025-01',lines:['DIČ CZ7001010007 DIČ CZ12345679','Datum vystavení 05.01.2025','Datum zdan. plnění 05.01.2025','Celkem bez DPH 10 000,00 Kč','DPH 21 % 2 100,00 Kč','Celkem 12 100,00 Kč']});await fs.writeFile(path.join(dir,'invoice.pdf'),Buffer.from(p.data,'base64'));
  await store.mutate('dan-2025','fixture-profile',c=>{c.profile=profile;});await importPaths(store,'dan-2025',[dir]);
  let c=await store.read('dan-2025');const support=c.documents.find(d=>d.kind==='support'),invoice=c.documents.find(d=>d.kind==='invoice');supportId=support.id;
  await reviewDocument(store,c.id,support.id,{status:'approved'});await reviewDocument(store,c.id,invoice.id,{status:'approved',fields:{paymentStatus:'paid',payments:[{date:'2025-01-10',amountCents:1210000,evidenceId:support.id}]}});
  for(const[key,,type]of ANNUAL_FACTS){const value=type==='boolean'?['cashBasis','mainActivityAllYear','sameInsurerAllYear','sameMainActivity2026','czechTaxResident','onlyDomesticSelfEmployment','incomeComplete','boundaryInvoices'].includes(key):type==='money'?0:type==='rate'?60:type==='children'?[]:'basic';await answer(store,c.id,key,value);}
  for(const key of ['taxAdvancesEvidence','socialAdvancesEvidence','healthAdvancesEvidence'])await answer(store,c.id,key,support.id);
  for(const [key,value]of Object.entries({pension:true,pensionAmount:100000,pensionEligible:true,pensionEvidence:support.id}))await answer(store,c.id,key,value);
  c=await store.read(c.id);assert.equal(compute(c).status,'READY_FOR_EXPORT');const e=await exportCase(store,c.id);assert.equal(e.manifest.validation.length,3);assert(e.manifest.validation.every(v=>v.valid));
  for(const name of ['DPFO-2025.xml','PREHLOSVC-2025.xml','PREHLED-OZP-2025.xml','Přiznání_DPFO.pdf','Příloha_č._1_přiznání_DPFO.pdf','Přehled_pro_OSSZ.pdf','Přehled_pro_OZP.pdf'])assert((await fs.stat(path.join(e.destination,name))).size>100);
  const xml=await fs.readFile(path.join(e.destination,'DPFO-2025.xml'),'utf8');assert(xml.includes('potv_penpri="1"'));const decoded=await worker({operation:'decode',name:'return.xml',data:Buffer.from(xml).toString('base64')});assert.equal(decoded.attachments.length,1);assert(Buffer.from(decoded.attachments[0].data,'base64').toString('ascii',0,5)==='%PDF-');
  const text=await execute('pdftotext',[path.join(e.destination,'Přehled_pro_OZP.pdf'),'-']);assert(text.stdout.includes('Příklad'));assert(text.stdout.includes('4000'));assert(text.stdout.includes('-37712'));assert((text.stdout.match(/\bX\b/g)??[]).length>=3);
  await store.create({kind:'annual',year:2025,id:'dan-2025-copy'});const copied=await importPaths(store,'dan-2025-copy',[e.zipPath],{reference:true});assert.equal(copied.c.references.length,3);assert.equal(copied.c.profile.confirmed,false);assert(!copied.c.documents.some(d=>d.kind==='invoice'));assert.equal(compute(copied.c).income,0);
});
await testAsync('unknown answer keys, invalid money and unsupported document fields are rejected',async()=>{
  await assert.rejects(()=>answer(store,'dan-2025','randomCredit',123));await assert.rejects(()=>answer(store,'dan-2025','socialAdvances',-1));await assert.rejects(()=>reviewDocument(store,'dan-2025',supportId,{fields:{shellCommand:'anything'}}));
});
await testAsync('source symlinks, directory symlinks, ZIP traversal, XML entities and changed hashes fail closed',async()=>{
  const link=path.join(root,'link.pdf');await fs.symlink(path.join(root,'invoice.pdf'),link);await assert.rejects(()=>importPaths(store,'dan-2025',[link]));
  const data=Buffer.from('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><Pisemnost>&x;</Pisemnost>');await assert.rejects(()=>worker({operation:'decode',name:'bad.xml',data:data.toString('base64')}));
  await assert.rejects(()=>worker({operation:'zip',files:[{name:'../escape.txt',data:Buffer.from('x').toString('base64')}]}),/UNSAFE_PATH/);
  const traversal=await execute(process.env.INTENTSMITH_PDF_PYTHON??'python3',['-c',"import io,zipfile,base64; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('../escape.txt','x'); z.close(); print(base64.b64encode(b.getvalue()).decode())"]);await assert.rejects(()=>worker({operation:'decode',name:'bad.zip',data:traversal.stdout.trim()}),/UNSAFE_PATH/);
  const c=await store.read('dph-2026-05'),s=c.sources[0],file=path.join(store.dir(c.id),'sources',s.sha256);await fs.writeFile(file,'changed');await assert.rejects(()=>store.source(c.id,s.sha256),/SOURCE_HASH_CHANGED/);await assert.rejects(()=>exportCase(store,c.id,{draft:true}),/SOURCE_HASH_CHANGED/);
});
await testAsync('Studio inline PDF is persisted only within its conversation, remains draft, and replay deduplicates',async()=>{
  const host=createAccountingChatHost({root:path.join(root,'studio')});
  const pdf=await worker({operation:'pdf',title:'Faktura',lines:['Číslo 20260501','Celkem 12 100,00 Kč']});
  const attachments=[{name:'invoice-2026-05.pdf',type:'application/pdf',content:'data:application/pdf;base64,'+pdf.data}];
  const open=(conversationId,files=attachments)=>host.openInvocation({extensionId:'accountant-cz',toolId:'accountant.document_workflow',conversationId,userMessageId:123,attachments:files});
  const first=open('studio-a');const result=await first.run('připrav kontrolní hlášení za květen');first.close();
  assert.equal(result.caseId,'dph-2026-05');assert.equal(result.documentCount,1);assert.equal(result.status,'NEEDS_REVIEW');assert(result.text.includes('draft'));
  const again=open('studio-a');const replay=await again.run('stav');again.close();assert.equal(replay.documentCount,1);assert(replay.text.includes('již uložené: 1'));
  const other=open('studio-b',[]);assert.equal((await other.run('stav')).status,'NEEDS_INPUT');other.close();
  const expired=open('studio-a',[]);expired.close();await assert.rejects(()=>expired.run('stav'),/SCOPE_EXPIRED/);
  const once=open('studio-a',[]);await once.run('stav');await assert.rejects(()=>once.run('stav'),/ALREADY_USED/);once.close();
  assert.throws(()=>host.openInvocation({extensionId:'sazeni',toolId:'accountant.document_workflow',conversationId:'studio-a',userMessageId:123}),/AUTHORITY/);
  assert.throws(()=>open('studio-a',[{...attachments[0],path:'/etc/passwd'}]),/PATH_FORBIDDEN/);
  const cancelled=new AbortController();cancelled.abort();const turn=host.openInvocation({extensionId:'accountant-cz',toolId:'accountant.document_workflow',conversationId:'cancelled',userMessageId:1,signal:cancelled.signal});await assert.rejects(()=>turn.run('kontrolní hlášení za květen 2026'));turn.close();
  assert.equal(requestedPeriod('kontrolní hlášení za květen',[]),null);
});
console.log('Journey artifacts: '+root);
summary();
