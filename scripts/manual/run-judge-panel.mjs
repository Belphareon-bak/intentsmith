#!/usr/bin/env node
// Bounded exploratory judge experiment. Does not call acceptance/import writers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { holdGpuEvaluationLock } from '../../src/upgrade/gpu-evaluation-lock.js';
import { createStageProvider } from '../../src/eval/collection-stage-provider.js';
import { hash, judgeMessages, parseJudge, assertNotSelf, assertJudgeFamily, checkPower, OPTIONS } from './judge-panel-protocol.mjs';
import { assertResumableReceipt, finalizeJudgePanel } from './judge-panel-lifecycle.mjs';

const opt=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(2,i),x.slice(i+1)];}));
if(!path.isAbsolute(opt.out || '') || !['screen','confirm'].includes(opt.stage) || !opt['expected-plan'])throw Error('JUDGE_PANEL_ARGUMENTS');
const root=fileURLToPath(new URL('../../',import.meta.url)),read=f=>JSON.parse(fs.readFileSync(path.join(opt.out,f),'utf8'));
const planRaw=fs.readFileSync(path.join(opt.out,'plan.json'),'utf8'),plan=JSON.parse(planRaw),planSha256=hash(planRaw);
if(planSha256!==opt['expected-plan'])throw Error('JUDGE_PANEL_PLAN_CHANGED');
for(const [f,expected] of Object.entries(plan.sourceHashes))if(hash(fs.readFileSync(path.join(root,f),'utf8'))!==expected)throw Error('JUDGE_PANEL_SOURCE_CHANGED:'+f);
for(const [f,expected] of [['inputs.json',plan.inputsSha256],['restricted/references.json',plan.referencesSha256]])
  if(hash(fs.readFileSync(path.join(opt.out,f),'utf8'))!==expected)throw Error('JUDGE_PANEL_INPUT_CHANGED');
const inputs=read('inputs.json'),references=read('restricted/references.json');
// Only identities are consulted by the collector; reference scores NEVER reach the provider.
let models=plan.models;
if(opt.stage==='confirm') {
  const s=read('shortlist.json');
  if(s.planSha256!==planSha256 || s.decisionAuthority!==false || s.models.length>4)throw Error('JUDGE_SHORTLIST_INVALID');
  models=s.models.map(n=>{const m=plan.models.find(m=>m.name===n);if(!m)throw Error('JUDGE_SHORTLIST_MODEL');return m;});
}
const jobs=[];
for(const model of models)for(const item of inputs.filter(x=>x.stage===opt.stage))for(const reverse of item.reverse?[false,true]:[false]){
  assertJudgeFamily(model,references[item.id],plan.familyPolicy);
  if(model.artifact.digestSha256===references[item.id].answerDigest)continue;
  jobs.push({model,item,reverse,key:hash([planSha256,model.artifact.digestSha256,item.id,reverse]).slice(0,32)});
}
const receiptPath=key=>path.join(opt.out,'receipts',key+'.json');
const prior=fs.readdirSync(path.join(opt.out,'receipts')).filter(f=>f.endsWith('.json')&&!f.endsWith('.post.json')).map(f=>{
  const receipt=read('receipts/'+f),key=f.slice(0,-5),postFile='receipts/'+key+'.post.json';
  const post=fs.existsSync(path.join(opt.out,postFile))?read(postFile):null;
  assertResumableReceipt(receipt,post,{planSha256,key});return receipt;
});
let totalTokens=prior.reduce((s,r)=>s+(r.result?.evalCount || 0),0),totalMs=prior.reduce((s,r)=>s+(r.result?.durationMs || 0),0),newCalls=0;
let done=jobs.filter(j=>fs.existsSync(receiptPath(j.key))).length;
const write=(file,obj)=>{const p=path.join(opt.out,file);fs.writeFileSync(p+'.tmp',JSON.stringify(obj,null,2)+'\n',{mode:0o600});fs.renameSync(p+'.tmp',p);};
const power=()=>{const [uuid,limit,draw,temp]=execFileSync('nvidia-smi',['--query-gpu=uuid,power.limit,power.draw,temperature.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:5000}).trim().split(',').map(s=>s.trim());
  const p={uuid,limitWatts:Number(limit),drawWatts:Number(draw),temperatureC:Number(temp)};checkPower(p,plan.maxPowerWatts);return p;};
power();
const lease=holdGpuEvaluationLock({command:'local judge panel '+planSha256});
const cancel=new AbortController();process.once('SIGINT',()=>cancel.abort());process.once('SIGTERM',()=>cancel.abort());
const provider=createStageProvider({plan,directory:opt.out});
let finalStatus='PARTIAL',failure=null,finalized=null;
const log=[];
const progress=extra=>{const value={status:'RUNNING',stage:opt.stage,planSha256,completed:done,total:jobs.length,percent:100*done/jobs.length,totalOutputTokens:totalTokens,
  updatedAt:new Date().toISOString(),...extra};write('progress.json',value);console.log(JSON.stringify(value));
  log.push(value);const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  fs.writeFileSync(path.join(opt.out,'progress.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Test místních hodnotitelů</title><style>body{font:18px system-ui;background:#16191d;color:#eee;max-width:1000px;margin:40px auto}progress{width:100%;height:32px}pre{white-space:pre-wrap;font-size:14px}</style><h1>Test místních hodnotitelů</h1><p>'+escape(extra.model || '')+' · '+escape(extra.task || '')+' · '+escape(extra.phase || '')+'</p><progress max="'+jobs.length+'" value="'+done+'"></progress><p>'+done+' / '+jobs.length+' volání v kole '+opt.stage+' · limit 175 W</p><p>Vývojové porovnání, bez přepínání rolí. Aktualizace '+escape(value.updatedAt)+'</p><pre>'+log.slice(-8).map(v=>escape(v.updatedAt+' '+v.model+' '+v.task+' '+v.order+' '+v.phase)).join('\n')+'</pre>',{mode:0o600});
};
try {
  for(const job of jobs) {
    if(fs.existsSync(receiptPath(job.key)))continue;
    if(cancel.signal.aborted){finalStatus='CANCELLED';break;}
    if(prior.length+newCalls>=plan.budget.maximumCalls || totalTokens+OPTIONS.num_predict>plan.budget.maximumOutputTokens
      || totalMs>=plan.budget.maximumHours*3600000){finalStatus='BUDGET_STOP';break;}
    const {model,item,reverse}=job,full={...item,answerDigest:references[item.id].answerDigest};
    assertNotSelf(model,full);
    const beforePower=power(),task={options:OPTIONS};
    progress({model:model.name,role:item.role,task:item.task,order:reverse?'reverse':'forward',phase:'guard'});
    const before=await provider.guard({model,task,phase:'before'});
    const messages=judgeMessages(item,reverse,plan.judgeProfile),startedAt=new Date().toISOString();
    progress({model:model.name,role:item.role,task:item.task,order:reverse?'reverse':'forward',phase:'inference'});
    const result=await provider.call(model.name,messages,{...OPTIONS,signal:cancel.signal},model.artifact);
    const parsed=parseJudge(result,item.rubric.length,plan.judgeProfile);
    // Attested provider result and complete JSON are both necessary. Truncation is never a grade.
    if(result.promptEvalCount>=OPTIONS.num_ctx-OPTIONS.num_predict){parsed.valid=false;parsed.reason='CONTEXT_LIMIT_RISK';}
    const receipt={schemaVersion:1,simulation:false,decisionAuthority:false,planSha256,stage:opt.stage,caseId:item.id,
      judge:model.artifact,reverse,startedAt,finishedAt:new Date().toISOString(),messages,inputSha256:hash(messages),
      result,parsed,beforePower,before};
    newCalls++;totalTokens+=result.evalCount || 0;totalMs+=result.durationMs || 0;
    fs.writeFileSync(receiptPath(job.key),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    // Preserve the response before checking post-call environmental failures.
    const after=await provider.guard({model,task,phase:'after'}),afterPower=power();
    write('receipts/'+job.key+'.post.json',{planSha256,key:job.key,after,afterPower});
    done++;
    progress({model:model.name,role:item.role,task:item.task,phase:'captured',valid:parsed.valid,reason:parsed.reason || null});
  }
  if(done===jobs.length)finalStatus='COMPLETE';
} catch(error) {
  finalStatus='BLOCKED';write('last-error.json',{at:new Date().toISOString(),code:error.code || null,error:error.message,stack:error.stack});
  failure=error;
} finally {
  finalized=await finalizeJudgePanel({status:finalStatus,failure,close:()=>provider.close(),release:()=>lease.release(),checkpoint:outcome=>{
  const result={...outcome,stage:opt.stage,planSha256,decisionAuthority:false,simulation:false,completed:done,total:jobs.length,totalOutputTokens:totalTokens,finishedAt:new Date().toISOString()};
  write('progress.json',result);write(opt.stage+'-result.json',result);
  fs.writeFileSync(path.join(opt.out,'progress.html'),'<!doctype html><meta charset="utf-8"><title>Test hodnotitelů</title><h1>'+result.status+'</h1><p>'+done+' / '+jobs.length+' volání · '+opt.stage+'</p><p>Výsledky: '+opt.stage+'-result.json. Ukončení: '+result.finishedAt+'</p>',{mode:0o600});
  if(opt.report)fs.writeFileSync(opt.report,JSON.stringify(result)+'\n');
  console.log(JSON.stringify(result));
  }});
}
if(failure)throw failure;
if(finalized.failures.length)throw Error('JUDGE_PANEL_CLEANUP_FAILED');
