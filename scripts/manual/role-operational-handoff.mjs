#!/usr/bin/env node
// Bounded production role stages. Never binds, imports scores, or writes a product DB.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cases} from './code-operational-20260920-fixtures.mjs';
import {holdGpuEvaluationLock} from '../../src/upgrade/gpu-evaluation-lock.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),opt=n=>args.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
if(!args.length){console.log('role-operational-handoff.mjs --prepare|--run --out=/absolute/path --benchmark=/absolute/model-role-results.json [--report=/absolute/file]');process.exit(0);}
if(args.some(x=>!/^--(?:prepare|run)$|^--(?:out|benchmark|report|roles)=.+$/.test(x))||args.includes('--prepare')===args.includes('--run'))throw Error('INVALID_ARGUMENTS');
const out=opt('out');if(!path.isAbsolute(out||''))throw Error('ABSOLUTE_OUT_REQUIRED');
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const save=(name,x)=>{const dest=path.join(out,name);fs.writeFileSync(dest+'.tmp',JSON.stringify(x,null,2)+'\n',{mode:0o600});fs.renameSync(dest+'.tmp',dest);};
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:8e6}).trim();
process.env.INTENTSMITH_DB_PATH=path.join(out,'isolated-unused.db');process.env.INTENTSMITH_LOG_LEVEL='error';
const {WorkflowOrchestrator,WorkflowSession}=await import('../../src/planner/workflow.js');
const STOP=Symbol('handoff');
async function stage(spec,call){
 const w=new WorkflowOrchestrator(),s=new WorkflowSession('probe-'+spec.id,spec.requirement);
 // Never leak controller-only before/after labels into the review prompt.
 s.plan={title:spec.case,steps:[{id:1,action:spec.requirement,detail:spec.requirement}],risks:[]};s.implementation=spec.source;
 let downstream=null;
 w._callLLM=async(role,prompt,system)=>{
  if(role!==spec.role){downstream={role,prompt,system};throw STOP;}
  return call(prompt,system);
 };
 if(spec.role==='R2')w._finalReview=async()=>({handoff:'R1'});
 w._redesign=async()=>({handoff:'D1'});
 if(spec.role!=='D2')w._fixLoop=async()=>({handoff:'D2'});
 let result=null;
 try{
  if(spec.role==='D1')result=await w._createPlan(s,spec.requirement,'The request and source are supplied; prepare a bounded implementation plan.',{files:spec.source});
  if(spec.role==='D2')result=await w._fixLoop(s,[{description:spec.requirement}]);
  if(spec.role==='R1')result=await w._finalReview(s);
  if(spec.role==='R2')result=await w._reviewLoop(s);
 }catch(e){if(e!==STOP)throw e;}
 return {result,state:s.state,history:s.history,downstream};
}
if(args.includes('--prepare')){
 if(!path.isAbsolute(opt('benchmark')||''))throw Error('ABSOLUTE_BENCHMARK_REQUIRED');
 fs.mkdirSync(out,{mode:0o700});
 const benchmark=JSON.parse(fs.readFileSync(opt('benchmark'))),roles=(opt('roles')||'D1,D2,R1,R2').split(','),pairs={};
 if(!roles.length||new Set(roles).size!==roles.length||roles.some(r=>!['D1','D2','R1','R2'].includes(r)))throw Error('INVALID_ROLES');
 for(const role of roles){const rows=benchmark.rows.filter(x=>x.role===role).sort((a,b)=>b.utilityMean-a.utilityMean);pairs[role]=rows.slice(0,2).map(x=>({model:x.model,artifact:x.artifact,benchmarkScore:x.utilityMean}));}
 const selected=cases.filter(x=>['nonfinite-math','environment-prose','vat-migration-reentry','remote-package-integrity'].includes(x.id));
 const specs=[];
 for(const def of selected){
  const version=rev=>def.files.map(file=>({file,text:execFileSync('git',['-C','/home/belphareon/Projects/c3-agent-wip','show',rev+':'+file],{encoding:'utf8',maxBuffer:1e6})}));
  const before=version(def.fix+'^'),after=version(def.fix);
  for(const role of roles)for(const variant of ['D1','D2'].includes(role)?['before']:['before','after']){
   const spec={id:role+'-'+def.id+'-'+variant,role,case:def.id,group:def.group,variant,requirement:def.requirement,source:variant==='before'?before:after,expectedReview:['R1','R2'].includes(role)?variant==='before'?'REJECT':'ACCEPT_WITHIN_BOUNDED_CONTRACT':null,referenceAfter:after};
   let captured;
   await stage(spec,async(prompt,system)=>{captured={prompt,system};throw STOP;});
   spec.promptSha256=hash(captured);spec.prompt=captured;specs.push(spec);
  }
 }
 const sourceFiles=['src/planner/workflow.js','scripts/manual/role-operational-handoff.mjs','scripts/manual/code-operational-20260920-fixtures.mjs','src/eval/model-evaluation-runner.js'];
 const plan={status:'SEALED',createdAt:new Date().toISOString(),sourceRevision:git('rev-parse','HEAD'),workingTreeDirty:!!git('status','--porcelain'),sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])),benchmarkSha256:hash(fs.readFileSync(opt('benchmark'))),pairs,specs,profile:{num_ctx:16384,num_predict:4096,temperature:.1,top_p:.9,timeout:300000},repeats:1,budgetMs:90*60000,decisionAuthority:false,operationPolicy:{productionImported:false,bindings:false,deletion:false,timer:false},scope:'Actual WorkflowOrchestrator role stage and parser with owned attested transport. Stops at next role boundary; no downstream CODE execution for plans, no whole Studio journey. Four cases previously used only for CODE operational qualification, never in this role benchmark. Gold/reject review pairs are correlated within case; not eight independent cases. Not an accepted operational decision profile.',limitations:['R1 runner-up is below the operator 50% exploration threshold; diagnostic comparison only.','No proof of model-training exclusion.','No automatic semantic grader; manual review pending.','Profile checked on each request, not worst-case profile qualification.','CHAT/VISION are not exercised by this workflow-stage runner.']};
 plan.planSha256=hash(plan);save('plan.json',plan);console.log('SEALED',plan.planSha256,specs.length,'stage inputs',specs.length*2,'attempts');process.exit(0);
}
const plan=read('plan.json'),{planSha256,...material}=plan;if(hash(material)!==planSha256)throw Error('PLAN_CHANGED');
if(git('status','--porcelain'))throw Error('DIRTY_SOURCE');
for(const[f,h]of Object.entries(plan.sourceHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)throw Error('SOURCE_CHANGED:'+f);
if(fs.existsSync(path.join(out,'result.json')))throw Error('RESULT_EXISTS');
const endpoint=process.env.OLLAMA_URL;if(endpoint!=='http://127.0.0.1:11435')throw Error('OWNED_PROVIDER_REQUIRED');
const pgid=Number(process.env.INTENTSMITH_EVAL_PROVIDER_PID);if(!Number.isSafeInteger(pgid)||pgid<1)throw Error('PROVIDER_OWNERSHIP_MISSING');
const compute=()=>execFileSync('nvidia-smi',['--query-compute-apps=pid,process_name','--format=csv,noheader'],{encoding:'utf8',timeout:3000}).trim();
const owned=()=>{for(const line of compute().split('\n').filter(Boolean)){const pid=line.split(',')[0].trim();let p;try{p=Number(execFileSync('ps',['-o','pgid=','-p',pid],{encoding:'utf8',timeout:1000}).trim());}catch{continue;}if(p!==pgid)throw Error('FOREIGN_GPU_WORK');}};
const get=async p=>{const r=await fetch(endpoint+p,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('HTTP_'+r.status);return r.json();};
const report={status:'RUNNING',startedAt:new Date().toISOString(),sourceRevision:git('rev-parse','HEAD'),planSha256,attempts:[],decisionAuthority:false,operationPolicy:plan.operationPolicy};
const flush=()=>{save('result.json',report);if(opt('report'))fs.writeFileSync(opt('report'),JSON.stringify(report,null,2)+'\n');};
const lease=holdGpuEvaluationLock({command:'role-operational-handoff '+planSha256});let active=null,cancel=false;
process.on('SIGTERM',()=>{cancel=true;});process.on('SIGINT',()=>{cancel=true;});
const unload=async()=>{if(!active)return;owned();const r=await fetch(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:active,keep_alive:0}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('UNLOAD_FAILED');active=null;};
try{
 const system=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());if(system.models?.length||compute()||(await get('/api/ps')).models?.length)throw Error('GPU_BUSY');
 if((await get('/api/version')).version!=='0.34.2-intentsmith.1')throw Error('PROVIDER_VERSION_CHANGED');
 const {ModelEvaluationRunner}=await import('../../src/eval/model-evaluation-runner.js'),runner=new ModelEvaluationRunner(endpoint);
 const models=[...new Set(Object.values(plan.pairs).flat().map(x=>x.model))];
 // Model order fixed before inference; no target role rebinding.
 for(const model of models){
  for(const spec of plan.specs.filter(s=>plan.pairs[s.role].some(x=>x.model===model))){
   if(cancel||Date.now()-Date.parse(report.startedAt)>plan.budgetMs)throw Error(cancel?'CANCELLED':'TIME_BUDGET');
   owned();const identity=plan.pairs[spec.role].find(x=>x.model===model),tag=(await get('/api/tags')).models.find(x=>x.name===model);
   if(tag?.digest?.replace(/^sha256:/,'')!==identity.artifact.digestSha256)throw Error('ARTIFACT_CHANGED');
   const began=Date.now(),receipts=[];let result,error=null;active=model;
   try{result=await stage(spec,async(prompt,system)=>{
    if(hash({prompt,system})!==spec.promptSha256)throw Error('PROMPT_DRIFT');
    const messages=[{role:'system',content:system},{role:'user',content:prompt}];
    const gpuSamples=[];
    const sample=()=>{try{gpuSamples.push({at:new Date().toISOString(),values:execFileSync('nvidia-smi',['--query-gpu=memory.used,memory.total,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:2000}).trim()});}catch(e){gpuSamples.push({error:e.message});}};
    sample();const timer=setInterval(sample,1000);let response;
    try{response=await runner._callModel(model,messages,{...plan.profile,timeout:Math.min(plan.profile.timeout,plan.budgetMs-(Date.now()-Date.parse(report.startedAt)))},identity.artifact);}finally{clearInterval(timer);sample();}
    const placement=(await get('/api/ps')).models.find(x=>x.name===model);
    receipts.push({messages,response,placement,gpuSamples});
    if(response.error)throw Error(response.error);
    if(!placement||placement.size_vram<placement.size||placement.context_length!==plan.profile.num_ctx)throw Error('GPU_PROFILE_UNFIT');
    if(response.promptEvalCount+plan.profile.num_predict>plan.profile.num_ctx)throw Error('CONTEXT_HEADROOM_UNPROVEN');
    if(response.doneReason==='length')throw Error('OUTPUT_BUDGET_EXHAUSTED');
    return {content:response.content,model,duration:response.durationMs};
   });}catch(e){error=String(e.message||e);}
   const a={id:spec.id+'-'+hash(model).slice(0,8),role:spec.role,case:spec.case,group:spec.group,variant:spec.variant,model,artifact:identity.artifact,result,error,receipts,durationMs:Date.now()-began,gradingStatus:'NOT_GRADED'};
   save('attempt-'+a.id+'.json',a);report.attempts.push({id:a.id,role:a.role,model,error,durationMs:a.durationMs});flush();console.log(report.attempts.length,'/',plan.specs.length*2,a.role,a.case,a.variant,model,error||'CAPTURED');
   if(error==='GPU_PROFILE_UNFIT')throw Error(error);
  }
  await unload();
 }
 report.status='COLLECTION_COMPLETE';
}catch(e){report.status='BLOCKED';report.error=e.message||String(e);process.exitCode=2;}
finally{try{await unload();}catch(e){report.cleanupError=e.message;}lease.release();report.finishedAt=new Date().toISOString();flush();}
