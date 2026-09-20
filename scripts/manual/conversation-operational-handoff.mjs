#!/usr/bin/env node
// Production CHAT handler and VISION bridge in a disposable process, no product DB or role application.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2),opt=n=>args.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3),hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
if(!args.length){console.log('--prepare|--run --out=/absolute/path --tasks=/absolute/tasks.json --benchmark=/absolute/model-role-results.json [--report=/absolute/file]');process.exit(0);}
if(args.some(x=>!/^--(?:prepare|run)$|^--(?:out|tasks|benchmark|report)=.+$/.test(x))||args.includes('--prepare')===args.includes('--run'))throw Error('INVALID_ARGUMENTS');
const out=opt('out');if(!path.isAbsolute(out||''))throw Error('ABSOLUTE_OUT_REQUIRED');
const save=(n,x)=>{const p=path.join(out,n);fs.writeFileSync(p+'.tmp',JSON.stringify(x,null,2)+'\n',{mode:0o600});fs.renameSync(p+'.tmp',p);},git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8'}).trim();
const sourceFiles=['src/chat/handlers/decisions.js','src/llm/cre-bridge.js','src/llm/gateway.js','src/llm/client.js','src/llm/auth-types.js','scripts/manual/conversation-operational-handoff.mjs'];
if(args.includes('--prepare')){
 for(const key of ['tasks','benchmark'])if(!path.isAbsolute(opt(key)||''))throw Error('ABSOLUTE_'+key+'_REQUIRED');
 fs.mkdirSync(out,{mode:0o700});const tasks=JSON.parse(fs.readFileSync(opt('tasks'))),benchmark=JSON.parse(fs.readFileSync(opt('benchmark'))),pairs={};
 for(const role of ['CHAT','VISION'])pairs[role]=benchmark.rows.filter(x=>x.role===role).sort((a,b)=>b.utilityMean-a.utilityMean).slice(0,2).map(x=>({model:x.model,artifact:x.artifact,benchmarkScore:x.utilityMean}));
 for(const t of tasks){if(!['CHAT','VISION'].includes(t.role))throw Error('BAD_ROLE');if(t.image&&hash(fs.readFileSync(t.image))!==t.imageSha256)throw Error('IMAGE_DRIFT');}
 const plan={status:'SEALED',createdAt:new Date().toISOString(),sourceRevision:git('rev-parse','HEAD'),workingTreeDirty:!!git('status','--porcelain'),sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])),tasks,pairs,benchmarkSha256:hash(fs.readFileSync(opt('benchmark'))),taskFileSha256:hash(fs.readFileSync(opt('tasks'))),repeats:1,totalBudgetMs:30*60000,decisionAuthority:false,operationPolicy:{productionImported:false,bindings:false,deletion:false,timer:false},profile:{CHAT:'actual handler/gateway settings, model-context cache fixed to 8192 for both candidates',VISION:'actual analyzeImages /api/generate: context4096 output2048 temperature.3'},scope:'Actual answer handler including history, prompt, authorized gateway and output gates; actual vision bridge. Isolated configured model selection, no durable production binding and no whole Studio journey. Every provider response is captured passively; missing response digest blocks qualification rather than being replaced by inventory checks.',limitations:['No independently accepted semantic judge.','Clock context is supplied by the production bridge at call time and recorded.','A role stops on absent response attestation or CPU spill; remaining planned attempts stay explicitly unattempted.','Real report screenshots are controller-rendered documents, not live Studio captures.']};plan.planSha256=hash(plan);save('plan.json',plan);console.log('SEALED',plan.planSha256);process.exit(0);
}
const plan=JSON.parse(fs.readFileSync(path.join(out,'plan.json'))),{planSha256,...mat}=plan;if(hash(mat)!==planSha256)throw Error('PLAN_DRIFT');if(git('status','--porcelain'))throw Error('DIRTY_SOURCE');
for(const[f,h]of Object.entries(plan.sourceHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)throw Error('SOURCE_DRIFT:'+f);
if(fs.existsSync(path.join(out,'result.json')))throw Error('RESULT_EXISTS');
const endpoint=process.env.OLLAMA_URL;if(endpoint!=='http://127.0.0.1:11435')throw Error('OWNED_PROVIDER_REQUIRED');const pgid=Number(process.env.INTENTSMITH_EVAL_PROVIDER_PID);if(!Number.isSafeInteger(pgid)||pgid<1)throw Error('OWNERSHIP_REQUIRED');
const runtime=path.join(out,'.intentsmith-artifacts');fs.mkdirSync(runtime,{recursive:true});process.env.INTENTSMITH_DB_PATH=path.join(runtime,'disposable.db');process.env.INTENTSMITH_LOG_LEVEL='error';process.env.INTENTSMITH_ENABLE_ONLINE_DISCOVERY='false';
const {holdGpuEvaluationLock}=await import('../../src/upgrade/gpu-evaluation-lock.js'),lease=holdGpuEvaluationLock({command:'conversation-handoff '+planSha256});
const nativeFetch=globalThis.fetch,get=async p=>{const r=await nativeFetch(endpoint+p,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('HTTP_'+r.status);return r.json();};
const compute=()=>execFileSync('nvidia-smi',['--query-compute-apps=pid,process_name','--format=csv,noheader'],{encoding:'utf8',timeout:3000}).trim();
const owned=()=>{for(const line of compute().split('\n').filter(Boolean)){let group;try{group=Number(execFileSync('ps',['-o','pgid=','-p',line.split(',')[0].trim()],{encoding:'utf8',timeout:1000}).trim());}catch{continue;}if(group!==pgid)throw Error('FOREIGN_GPU');}};
let active=null,current=null,cancel=false;process.on('SIGTERM',()=>{cancel=true});process.on('SIGINT',()=>{cancel=true});
const report={status:'RUNNING',sourceRevision:git('rev-parse','HEAD'),planSha256,startedAt:new Date().toISOString(),attempts:[],unattempted:[],decisionAuthority:false,operationPolicy:plan.operationPolicy},flush=()=>{save('result.json',report);if(opt('report'))fs.writeFileSync(opt('report'),JSON.stringify(report,null,2)+'\n');};
const unload=async()=>{if(!active)return;owned();const r=await nativeFetch(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:active,keep_alive:0}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('UNLOAD_FAILED');active=null;};
try{
 const system=await nativeFetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());if(system.models?.length||compute()||(await get('/api/ps')).models?.length)throw Error('GPU_BUSY');if((await get('/api/version')).version!=='0.34.2-intentsmith.1')throw Error('PROVIDER_DRIFT');
 const {config}=await import('../../src/config.js');const{setNumCtx}=await import('../../src/llm/model-ctx.js');const{handleAnswerDecision}=await import('../../src/chat/handlers/decisions.js');const{analyzeImages}=await import('../../src/llm/cre-bridge.js');
 globalThis.fetch=async(url,init={})=>{
  if(!String(url).startsWith(endpoint+'/api/'))throw Error('UNEXPECTED_NETWORK:'+url);
  owned();if(cancel||Date.now()-Date.parse(report.startedAt)>plan.totalBudgetMs)throw Error('CANCELLED_OR_BUDGET');
  let body;try{body=JSON.parse(init.body)}catch{};
  const samples=[];const sample=()=>{try{samples.push(execFileSync('nvidia-smi',['--query-gpu=memory.used,memory.total,utilization.gpu','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:2000}).trim())}catch(e){samples.push({error:e.message})}};
  sample();const timer=setInterval(sample,1000),started=Date.now();
  try{const response=await nativeFetch(url,init);if(body?.model && /\/api\/(chat|generate)$/.test(String(url))){const data=await response.clone().json();const placement=(await get('/api/ps')).models.find(x=>x.name===body.model);current.receipts.push({url:String(url),body,data,placement,samples,durationMs:Date.now()-started});}return response;}
  catch(e){current.receipts.push({url:String(url),body,error:e.message,samples,durationMs:Date.now()-started});throw e;}finally{clearInterval(timer);sample();}
 };
 for(const role of ['CHAT','VISION']){
  let blocked=null;
  for(const pair of plan.pairs[role]){
   config.models[role]=pair.model;setNumCtx(pair.model,8192);
   const tag=(await get('/api/tags')).models.find(x=>x.name===pair.model);if(tag?.digest?.replace(/^sha256:/,'')!==pair.artifact.digestSha256)throw Error('ARTIFACT_CHANGED');
   for(const t of plan.tasks.filter(x=>x.role===role)){
    if(blocked){report.unattempted.push({role,id:t.id,model:pair.model,reason:blocked});continue;}
    if(cancel||Date.now()-Date.parse(report.startedAt)>plan.totalBudgetMs)throw Error('CANCELLED_OR_BUDGET');
    current={id:t.id+'-'+hash(pair.model).slice(0,8),role,task:t.id,model:pair.model,artifact:pair.artifact,receipts:[],startedAt:new Date().toISOString(),gradingStatus:'NOT_GRADED'};active=pair.model;
    try{if(role==='CHAT')current.result=await handleAnswerDecision(t.input,{intent:'CONVERSATIONAL',type:'ANSWER',toJSON(){return {intent:this.intent,type:this.type};}},{sessionId:current.id,history:t.history||[]});
     else {if(hash(fs.readFileSync(t.image))!==t.imageSha256)throw Error('IMAGE_DRIFT');current.result=await analyzeImages(t.input,[fs.readFileSync(t.image).toString('base64')]);}
    }catch(e){current.error=e.message;}
    const actual=current.receipts.filter(x=>x.body?.model);
    current.proof=actual.length&&actual.every(x=>(x.data?.digest||x.data?.model_digest_sha256||'').replace(/^sha256:/,'')===pair.artifact.digestSha256)?'RESPONSE_BOUND':'RESPONSE_UNVERIFIED';
    current.fullGpu=actual.length>0&&actual.every(x=>x.placement&&x.placement.size_vram>=x.placement.size);
    if(current.result?.tag?.metadata?.error)current.error='PRODUCTION_HANDLER_ERROR';
    if(actual.at(-1)?.data?.done_reason==='length')current.error='OUTPUT_BUDGET_EXHAUSTED';
    current.finishedAt=new Date().toISOString();current.status=current.error?'OPERATIONAL_FAILURE':current.proof==='RESPONSE_UNVERIFIED'?'BLOCKED':current.fullGpu?'CAPTURED':'BLOCKED';
    if(!current.fullGpu)blocked='PROFILE_GPU_UNFIT';if(current.proof==='RESPONSE_UNVERIFIED')blocked='RESPONSE_UNVERIFIED';
    save('attempt-'+current.id+'.json',current);report.attempts.push({id:current.id,role,model:pair.model,status:current.status,proof:current.proof,error:current.error||null});flush();console.log(current.role,current.task,current.model,current.status,current.proof);
   }
   await unload();
  }
 }
 report.status=report.unattempted.length||report.attempts.some(x=>x.status!=='CAPTURED')?'COLLECTION_PARTIAL':'COLLECTION_COMPLETE';
}catch(e){report.status='BLOCKED';report.error=e.message;process.exitCode=2;}
finally{globalThis.fetch=nativeFetch;try{await unload()}catch(e){report.cleanupError=e.message;}lease.release();report.finishedAt=new Date().toISOString();flush();}
