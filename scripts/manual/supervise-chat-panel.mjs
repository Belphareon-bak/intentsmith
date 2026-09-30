#!/usr/bin/env node
// Resume a frozen, explicitly authorized capture after bounded GPU contention.
// No re-grading, retries of recorded calls, foreign-process control or new budget.
import {readFileSync,writeFileSync,renameSync,openSync,closeSync,appendFileSync,readlinkSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {readStage,stageSummary,stageHash} from '../../src/eval/collection-stage.js';
import {stageResources} from '../../src/eval/collection-stage-provider.js';
import {acquireGpuEvaluationLock} from '../../src/upgrade/gpu-evaluation-lock.js';

export function remainingWindowBudget(stage,ceilingMs) {
  const summary=stageSummary(stage);
  if(summary.windows.some(w=>!w.close))throw Error('SUPERVISOR_OPEN_WINDOW');
  if(summary.finishedConversations===summary.plannedConversations)return null;
  const wallMs=Math.floor((ceilingMs-summary.activeDurationMs)/1000)*1000;
  if(wallMs<=Math.max(...stage.plan.tasks.map(t=>t.options.timeout))||summary.remainingCalls<1
    ||summary.remainingOutputTokens<Math.max(...stage.plan.tasks.map(t=>t.options.num_predict)))throw Error('SUPERVISOR_BUDGET_EXHAUSTED');
  return {calls:summary.remainingCalls,outputTokens:summary.remainingOutputTokens,wallMs};
}

export async function waitForGpuIdle({probe,onProbe=()=>{},signal,now=Date.now,sleep=delay,timeoutMs=900000,intervalMs=5000,stableSamples=3}) {
  const deadline=now()+timeoutMs;let clear=0;
  while(now()<deadline) {
    if(signal?.aborted)throw Error('CANCELLED');
    const snapshot=await probe();
    if(typeof snapshot.idle!=='boolean')throw Error('GPU_PROBE_UNVERIFIED');
    clear=snapshot.idle?clear+1:0;onProbe(snapshot,clear);
    if(clear>=stableSamples)return snapshot;
    await sleep(intervalMs,undefined,{signal});
  }
  throw Error('GPU_WAIT_LIMIT');
}

export async function superviseCollection({snapshot,verify,waitUntilIdle,runWindow,exportWindow,publish,
  ceilingMs,firstWindow=4,maxResumes=3,signal}) {
  let resumes=0;
  for(let number=firstWindow;;number++) {
    if(signal?.aborted)throw Error('CANCELLED');
    await verify();
    const before=snapshot(),budget=remainingWindowBudget(before,ceilingMs);
    if(!budget){publish('COMPLETE',{resumes});return;}
    const windowId='full-'+String(number).padStart(2,'0');
    if(before.events.some(e=>e.type==='WINDOW_OPENED'&&e.windowId===windowId))throw Error('SUPERVISOR_WINDOW_ALREADY_EXISTS');
    publish('WAITING_GPU',{windowId,resumes,maxResumes,waitLimitMs:900000});
    await waitUntilIdle();
    if(signal?.aborted)throw Error('CANCELLED');
    await verify();
    publish('CAPTURING',{windowId,resumes,maxResumes,budget});
    await runWindow(windowId,budget);
    if(signal?.aborted)throw Error('CANCELLED');
    const after=snapshot(),summary=stageSummary(after);
    const last=summary.windows.at(-1);
    if(last?.windowId!==windowId||!last.close)throw Error('SUPERVISOR_WINDOW_DID_NOT_CLOSE');
    publish('EXPORTING',{windowId,reason:summary.stopReason});
    await exportWindow(windowId);
    if(summary.finishedConversations===summary.plannedConversations){publish('COMPLETE',{windowId,resumes});return;}
    // Only known GPU contention can resume. RAM, disk, identity, limits and
    // operator cancellation always stop. Recorded failed attempts stay visible.
    if(summary.stopReason!=='GPU_FOREIGN_WORK_PRESENT')throw Error(summary.stopReason||'SUPERVISOR_UNEXPLAINED_STOP');
    if(resumes>=maxResumes)throw Error('GPU_CONTENTION_RESUME_LIMIT');
    resumes++;
  }
}

export async function main(args=process.argv.slice(2)) {
  const options={};
  for(const value of args){const m=/^--(root|expected-plan|first-window|max-resumes)=(.+)$/.exec(value);
    if(!m||Object.hasOwn(options,m[1]))throw Error('SUPERVISOR_ARGUMENTS_INVALID');options[m[1]]=m[2];}
  const root=options.root,firstWindow=Number(options['first-window']||4),maxResumes=Number(options['max-resumes']||3);
  if(!isAbsolute(root||'')||!/^[a-f0-9]{64}$/.test(options['expected-plan']||'')||!Number.isInteger(firstWindow)||firstWindow<1
    ||!Number.isInteger(maxResumes)||maxResumes<0||maxResumes>3)throw Error('SUPERVISOR_ARGUMENTS_INVALID');
  const repo=fileURLToPath(new URL('../../',import.meta.url)),directory=join(root,'capture');
  const snapshot=()=>readStage(directory),initial=snapshot();
  if(initial.sha256!==options['expected-plan'])throw Error('SUPERVISOR_PLAN_CHANGED');
  const ceilingMs=initial.plan.proposedInitialWindowHours*3600000;
  if(!Number.isSafeInteger(ceilingMs)||ceilingMs<=0||ceilingMs>86400000)throw Error('SUPERVISOR_TIME_CEILING_INVALID');
  const lease=acquireGpuEvaluationLock({lockPath:join(root,'.supervisor-lock'),command:'bounded CHAT capture supervisor'});
  const cancel=new AbortController(),abort=()=>cancel.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const state={planSha256:initial.sha256,startedAt:new Date().toISOString(),decisionAuthority:false,maxResumes};
  const publish=(status,extra={})=>{
    Object.assign(state,extra,{status,updatedAt:new Date().toISOString()});
    const path=join(root,'supervisor-state.json');
    writeFileSync(path+'.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);
    appendFileSync(join(root,'supervisor-events.jsonl'),JSON.stringify(state)+'\n',{mode:0o600});
  };
  const run=promisify(execFile);
  async function gpuSnapshot() {
    const response=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('GPU_PROBE_UNVERIFIED');
    const body=await response.json();if(!Array.isArray(body.models))throw Error('GPU_PROBE_UNVERIFIED');
    const {stdout}=await run('nvidia-smi',['--query-compute-apps=pid,process_name,used_memory','--format=csv,noheader,nounits'],{timeout:5000,maxBuffer:16384});
    const processes=[];
    for(const row of stdout.trim().split('\n').filter(Boolean)){
      const [pidText,...fields]=row.split(',').map(v=>v.trim());if(!/^\d+$/.test(pidText))throw Error('GPU_PROBE_UNVERIFIED');
      const pid=Number(pidText);let executable=null,pgid=null;
      try{executable=readlinkSync('/proc/'+pid+'/exe');const stat=readFileSync('/proc/'+pid+'/stat','utf8');pgid=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[2]);}catch{}
      processes.push({pid,name:fields.slice(0,-1).join(','),memoryMiB:fields.at(-1),executable,pgid});
    }
    return {at:new Date().toISOString(),idle:processes.length===0&&body.models.length===0,processes,
      systemModels:body.models.map(m=>({name:m.name,digest:m.digest}))};
  }
  const verify=()=>{
    const stage=snapshot();if(stage.sha256!==initial.sha256)throw Error('SUPERVISOR_PLAN_CHANGED');
    if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('SUPERVISOR_DIRTY_SOURCE');
    for(const [path,hash] of Object.entries(stage.plan.sourceHashes))if(stageHash(readFileSync(join(repo,path),'utf8'))!==hash)throw Error('SUPERVISOR_SOURCE_CHANGED');
    stageResources(root,stage.plan.resourceFloors);
  };
  async function child(entry,args,log) {
    if(cancel.signal.aborted)throw Error('CANCELLED');
    const fd=openSync(join(root,log),'a',0o600);
    const p=spawn(process.execPath,[join(repo,entry),...args],{cwd:repo,env:{...process.env,
      OLLAMA_MODELS:'/mnt/vi7000/ollama/models',INTENTSMITH_HUNT_STATE_DIR:join(root,'provider-state')},stdio:['ignore',fd,fd]});
    closeSync(fd);const stop=()=>p.kill('SIGTERM');cancel.signal.addEventListener('abort',stop,{once:true});
    try{return await new Promise((ok,fail)=>{p.once('error',fail);p.once('exit',(code,signal)=>ok({code,signal}));});}
    finally{cancel.signal.removeEventListener('abort',stop);}
  }
  let diagnosticTimer,diagnosticBusy=false,lastGpu=null;
  try {
    await superviseCollection({snapshot,verify,ceilingMs,firstWindow,maxResumes,signal:cancel.signal,publish,
      waitUntilIdle:()=>waitForGpuIdle({signal:cancel.signal,probe:async()=>{stageResources(root,initial.plan.resourceFloors);return gpuSnapshot();},
        onProbe:(gpu,stableSamples)=>publish('WAITING_GPU',{gpu,stableSamples})}),
      runWindow:async(windowId,budget)=>{
        // Observation only: retain process identities to explain future stops.
        // The frozen collector remains the sole guard/dispatch authority.
        const observe=async()=>{if(diagnosticBusy)return;diagnosticBusy=true;try{
          const gpu=await gpuSnapshot(),key=JSON.stringify([gpu.processes,gpu.systemModels]);
          if(key!==lastGpu){appendFileSync(join(root,'gpu-process-observations.jsonl'),JSON.stringify({windowId,...gpu})+'\n',{mode:0o600});lastGpu=key;}
        }catch(e){appendFileSync(join(root,'gpu-process-observations.jsonl'),JSON.stringify({at:new Date().toISOString(),error:e.message})+'\n',{mode:0o600});}
        finally{diagnosticBusy=false;}};
        diagnosticTimer=setInterval(observe,1000);
        let result;
        try{result=await child('scripts/run-model-hunt-provider.js',['--collection-stage','--run','--out='+directory,
          '--expected-plan='+initial.sha256,'--window='+windowId,'--hours='+budget.wallMs/3600000,
          '--calls='+budget.calls,'--tokens='+budget.outputTokens,'--report='+join(root,windowId+'-summary.json')],'collection-'+windowId+'.log');}
        finally{clearInterval(diagnosticTimer);}
        writeFileSync(join(root,'run-'+windowId+'-exit.json'),JSON.stringify({...result,decisionAuthority:false})+'\n',{mode:0o600});
      },
      exportWindow:async(windowId)=>{
        const result=await child('scripts/manual/collect-chat-conversation.mjs',['--export','--out='+directory,
          '--review-out='+join(root,'review-'+windowId)],'export-'+windowId+'.log');
        writeFileSync(join(root,'export-'+windowId+'-exit.json'),JSON.stringify(result)+'\n',{mode:0o600});
        if(result.code!==0)throw Error('SUPERVISOR_EXPORT_FAILED');
      }});
  }catch(e){publish(cancel.signal.aborted?'CANCELLED':'STOPPED',{reason:e.code||e.message});process.exitCode=cancel.signal.aborted?0:2;}
  finally{clearInterval(diagnosticTimer);lease.release();process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
