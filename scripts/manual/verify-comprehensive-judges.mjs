#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {hash,panelJobs,verifyPanelReceipt} from './judge-panel-protocol.mjs';
const directory=process.argv[2];
if(!path.isAbsolute(directory||''))throw Error('ABSOLUTE_PANEL_PATH_REQUIRED');
const read=f=>JSON.parse(fs.readFileSync(path.join(directory,f),'utf8'));
const raw=fs.readFileSync(path.join(directory,'plan.json'),'utf8'),plan=JSON.parse(raw),planSha256=hash(raw);
for(const [file,expected] of [['inputs.json',plan.inputsSha256],['restricted/references.json',plan.referencesSha256]])
  if(hash(fs.readFileSync(path.join(directory,file),'utf8'))!==expected)throw Error('INPUT_CHANGED:'+file);
const {jobs,exclusions}=panelJobs(plan.models,read('inputs.json'),read('restricted/references.json'),planSha256,plan.familyPolicy);
const seen=new Map();let captured=0,valid=0;const pending=[],invalid=[],reverse=[];
for(const job of jobs){
  const file='receipts/'+job.key+'.json';
  if(!fs.existsSync(path.join(directory,file))){pending.push(job.key);continue;}
  const receipt=read(file),post=read('receipts/'+job.key+'.post.json');
  const parsed=verifyPanelReceipt(receipt,post,job,plan,planSha256);captured++;
  seen.set(job.key,receipt);
  if(parsed.valid)valid++;else invalid.push({key:job.key,model:job.model.name,caseId:job.item.id,reason:parsed.reason});
  if(job.reverse)reverse.push(job);
}
for(const f of fs.readdirSync(path.join(directory,'receipts')).filter(f=>f.endsWith('.json')&&!f.endsWith('.post.json')))
  if(!seen.has(f.slice(0,-5)))throw Error('UNPLANNED_RECEIPT:'+f);
const order=[];
for(const job of reverse){
  const forward=jobs.find(j=>j.item.id===job.item.id&&j.model.name===job.model.name&&!j.reverse);
  const a=seen.get(forward.key),b=seen.get(job.key);
  order.push({model:job.model.name,caseId:job.item.id,role:job.item.role,dataset:job.item.dataset,
    valid:!!(a?.parsed.valid&&b?.parsed.valid),
    differences:a?.parsed.valid&&b?.parsed.valid?a.parsed.rows.map((r,i)=>Math.abs(Math.round(r.score*100)-Math.round(b.parsed.rows[i].score*100))/100):null});
}
console.log(JSON.stringify({status:captured===jobs.length?'CAPTURE_COMPLETE':'CAPTURE_PARTIAL',decisionAuthority:false,simulation:false,planSha256,
  expected:jobs.length,captured,valid,invalid,pending,exclusions,order},null,2));
