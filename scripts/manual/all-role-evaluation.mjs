#!/usr/bin/env node
// Bounded, reproducible measurement of all role tasks. No production DB writer,
// provider mutation, bindings, retention, scheduler or implicit acceptance.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ModelEvaluationRunner } from '../../src/eval/model-evaluation-runner.js';
import { CodePatchEvaluationRunner, codePatchSuite } from '../../src/eval/code-patch-suite.js';
import { visionV2Suite } from '../../src/eval/role-quality-suites.js';
import { SEMANTIC_ROLE_SUITES } from '../../src/eval/semantic-role-suites.js';
import { SemanticEvaluationJudge } from '../../src/eval/semantic-evaluation-judge.js';
import { qualificationRuntimeSha256 } from '../../src/upgrade/model-evaluation-acceptance.js';
import { suiteContract } from '../../src/upgrade/model-evaluation-history.js';
import { holdGpuEvaluationLock } from '../../src/upgrade/gpu-evaluation-lock.js';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback = null) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!args.length || flag('help')) {
  console.log('Usage: all-role-evaluation.mjs --prepare|--run --out=/absolute/new-directory [--model=qwen3.8:latest] [--judge=qwen3.8:latest] [--roles=D1,D2,CODE,R1,R2,CHAT,VISION] [--profile=full|smoke] [--calibrate-only] [--resume]');
  process.exit(0);
}
const allowed = /^(?:--(?:prepare|run|calibrate-only|resume)|--(?:out|model|judge|roles|profile|report|task)=.+)$/;
if (args.some(a => !allowed.test(a)) || flag('prepare') === flag('run')) throw new Error('Invalid measurement arguments');
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = option('out');
if (!out || !path.isAbsolute(out)) throw new Error('An absolute evidence directory is required');
const suites = { ...SEMANTIC_ROLE_SUITES, CODE: codePatchSuite, VISION: visionV2Suite };
const selected = option('roles', 'D1,D2,CODE,R1,R2,CHAT,VISION').split(',');
if (new Set(selected).size !== selected.length || selected.some(r => !suites[r])) throw new Error('Unknown or duplicate role');
const profile = option('profile', 'full');
if (!['full','smoke'].includes(profile)) throw new Error('Quick quality estimates require an accepted full profile; use smoke only for transport diagnostics');
const repeats = profile === 'full' ? 3 : 1;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const write = (name, value) => {
  const dest = path.join(out, name), temp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, dest);
};
const sourceRevision = execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const workingTreeDirty = !!execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim();
const runtimeSha256 = qualificationRuntimeSha256();
const plan = { schemaVersion: 1, sourceRevision, runtimeSha256, workingTreeDirty,
  runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  profile, repeats, model: option('model', 'qwen3.8:latest'), judge: option('judge', 'qwen3.8:latest'),
  calibratedOnly: flag('calibrate-only'), taskFilter: option('task'),
  roles: selected.map(role => ({ role, suite: suites[role].name,
    contractSha256: suiteContract(suites[role],{repeats}).sha256,
    tasks: suites[role].tests.filter(t => !option('task') || t.name === option('task')).map(t => ({ name: t.name,
      tier: t.tier || (role === 'CODE' ? 'T1' : 'T2'),
      independenceGroup: t.independenceGroup || t.contractMaterial?.gradingInputs?.oracleAcceptance?.independenceGroup || t.name,
      options: t.options })) })),
  notAHoldout: true, decisionAuthority: false,
  operationPolicy: { productionImported: false, applyBindings: false, removeModels: false, timer: false },
  limitations: ['Full means all tasks and three repetitions; it is not yet an accepted operational holdout.',
    'Semantic judge calibration uses authored adversarial probes, not an independently adjudicated acceptance set.',
    'Model names are blinded to the judge; self-judging bias remains when judge and target are the same artifact.'],
};
if (plan.roles.some(r => !r.tasks.length)) throw new Error('Task filter selected an empty role');
plan.sha256 = hash(plan);
let report;
if (flag('resume')) {
  const oldPlan = JSON.parse(fs.readFileSync(path.join(out,'plan.json'),'utf8'));
  if (oldPlan.sha256 !== plan.sha256) throw new Error('MEASUREMENT_PLAN_CHANGED');
  report = JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));
} else {
  fs.mkdirSync(out,{mode:0o700});
  write('plan.json',plan);
  report = { schemaVersion:1, planSha256:plan.sha256, startedAt:new Date().toISOString(), status:'PREPARED',
    phase:'prepared', calibrations:[], attempts:[], artifacts:null, inferenceCalls:0,
    verdict:'NEROZHODNUTO', decisionAuthority:false, operationPolicy:plan.operationPolicy };
}
const flush = () => {
  report.updatedAt = new Date().toISOString(); write('result.json',report);
  if (option('report')) fs.writeFileSync(option('report'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
};
flush();
if (flag('prepare')) { console.log(JSON.stringify({status:'PREPARED',planSha256:plan.sha256,roles:plan.roles})); process.exit(0); }
if (workingTreeDirty) throw new Error('MODEL_MEASUREMENT_REQUIRES_CLEAN_TRACKED_SOURCE');
let lease;
try { lease=holdGpuEvaluationLock({command:'all-role-evaluation '+plan.sha256}); }
catch(error) { report.status='BLOCKED';report.error=error.message;flush();process.exit(2); }
const endpoint=process.env.OLLAMA_URL;
if(endpoint!=='http://127.0.0.1:11435')throw new Error('Use the owned evaluation provider wrapper');
const get=async(route)=>{const r=await fetch(endpoint+route,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('PROVIDER_HTTP_'+r.status);return r.json();};
const compute=()=>execFileSync('nvidia-smi',['--query-compute-apps=pid,process_name','--format=csv,noheader'],{timeout:3000}).toString().trim();
const assertOwnership=()=>{
  const pgid=Number(process.env.INTENTSMITH_EVAL_PROVIDER_PID);
  if(!Number.isSafeInteger(pgid)||pgid<1)throw new Error('PROVIDER_OWNERSHIP_MISSING');
  for(const line of compute().split('\n').filter(Boolean)) {
    const pid=Number(line.split(',')[0]);
    let actual;try{actual=Number(execFileSync('ps',['-o','pgid=','-p',String(pid)],{timeout:1000}).toString().trim());}catch{continue;}
    if(actual!==pgid)throw new Error('GPU_FOREIGN_WORK_PRESENT');
  }
};
let cancelling=false, activeModel=null;
process.on('SIGTERM',()=>{cancelling=true;}); process.on('SIGINT',()=>{cancelling=true;});
const runner=new ModelEvaluationRunner(endpoint);
const unload=async()=>{
  if(!activeModel)return;
  assertOwnership();
  const r=await fetch(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:activeModel,keep_alive:0}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('OWNED_MODEL_UNLOAD_FAILED'); activeModel=null;
};
const call=async(model,messages,options,artifact)=>{
  if(cancelling)throw new Error('CANCELLED');
  assertOwnership();
  if(activeModel && activeModel!==model)await unload();
  activeModel=model;
  const result=await runner._callModel(model,messages,options,artifact);
  assertOwnership();
  const placement=(await get('/api/ps')).models?.find(m=>m.name===model);
  if(!result.error && (!placement || placement.size_vram<placement.size
    || placement.context_length!==options.num_ctx))throw new Error('MODEL_PROFILE_NOT_FULL_GPU');
  report.inferenceCalls++;
  const receipt={at:new Date().toISOString(),model,artifact,options,inputSha256:hash(messages),messages,result,placement};
  fs.appendFileSync(path.join(out,'calls.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600});
  flush();return result;
};
try {
  const systemPs=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
  if(systemPs.models?.length || (await get('/api/ps')).models?.length || compute())throw new Error('GPU_FOREIGN_WORK_PRESENT');
  const memory=Number(/^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync('/proc/meminfo','utf8'))?.[1])*1024;
  const disk=fs.statfsSync(out);if(memory<8*2**30 || disk.bavail*disk.bsize<2*2**30)throw new Error('HOST_HEADROOM_INSUFFICIENT');
  const provider=(await get('/api/version')).version;
  if(provider!=='0.34.0-intentsmith.2')throw new Error('PROVIDER_VERSION_UNEXPECTED');
  const tags=(await get('/api/tags')).models;
  const identify=name=>{
    const found=tags.find(t=>t.name===name);
    if(!found || !/^(sha256:)?[a-f0-9]{64}$/.test(found.digest))throw new Error('MODEL_NOT_INSTALLED:'+name);
    return {modelName:name,digestSha256:found.digest.replace(/^sha256:/,''),providerVersion:provider};
  };
  const artifacts={model:identify(plan.model),judge:identify(plan.judge)};
  if(report.artifacts && JSON.stringify(report.artifacts)!==JSON.stringify(artifacts))throw new Error('ARTIFACT_IDENTITY_CHANGED');
  report.artifacts=artifacts;report.status='RUNNING';flush();
  const judge=new SemanticEvaluationJudge({call,artifact:artifacts.judge,onReceipt:receipt=>
    fs.appendFileSync(path.join(out,'judgements.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600})});
  const textRunner=new ModelEvaluationRunner(endpoint,{semanticJudge:judge});textRunner._callModel=call;
  const codeRunner=new CodePatchEvaluationRunner(endpoint);codeRunner._callModel=call;
  const total=plan.roles.reduce((n,r)=>n+r.tasks.length*repeats,0);
  for(const rolePlan of plan.roles) {
    const suite=suites[rolePlan.role];
    for(const spec of rolePlan.tasks) {
      const task=suite.tests.find(t=>t.name===spec.name);
      if(cancelling)throw new Error('CANCELLED');
      report.phase='oracle';report.current={role:rolePlan.role,task:task.name};flush();
      let calibrated=true;
      if(task.tier==='T4') {
        // Re-run probes on resume; never trust an editable PASS flag as a
        // live qualified judge. Prior failures remain in the append-only log.
        const calibration=await judge.qualify(task);
        report.calibrations.push({role:rolePlan.role,...calibration});
        fs.appendFileSync(path.join(out,'calibrations.jsonl'),JSON.stringify(calibration)+'\n',{mode:0o600});
        calibrated=calibration.status==='PASS';flush();
      } else if(rolePlan.role==='CODE') {
        task.prepare();task.validateOracle();
      } else {
        const expected=task.contractMaterial.gradingInputs.expected;
        if(task.grade(JSON.stringify(expected)).score!==1 || task.grade('').score!==0)
          throw new Error('VISION_ORACLE_FAILED:'+task.name);
      }
      if(flag('calibrate-only'))continue;
      for(let repeat=1;repeat<=repeats;repeat++) {
        if(report.attempts.some(a=>a.role===rolePlan.role && a.task===task.name && a.repeat===repeat))continue;
        report.phase='measurement';report.current={role:rolePlan.role,task:task.name,repeat,
          completed:report.attempts.length,total};flush();
        console.log('ATTEMPT',report.attempts.length+1,'/',total,rolePlan.role,task.name,repeat);
        const startedAt=new Date().toISOString();
        const result=rolePlan.role==='CODE'?await codeRunner._runTest(task,plan.model,artifacts.model)
          :await textRunner._runTest(task,plan.model,artifacts.model);
        const attempt={role:rolePlan.role,task:task.name,repeat,startedAt,calibrated,
          independenceGroup:spec.independenceGroup,...result};
        report.attempts.push(attempt);
        fs.appendFileSync(path.join(out,'attempts.jsonl'),JSON.stringify(attempt)+'\n',{mode:0o600});flush();
      }
    }
  }
  report.status=report.calibrations.some(c=>c.status!=='PASS') || report.attempts.some(a=>a.valid===false)
    ? 'INCOMPLETE_EVIDENCE' : flag('calibrate-only')?'CALIBRATION_COMPLETE':'MEASUREMENT_COMPLETE';
} catch(error) {
  report.status=cancelling?'CANCELLED':'BLOCKED';report.error=error.message;process.exitCode=2;
} finally {
  try{await unload();}catch(error){report.cleanupError=error.message;report.status='CLEANUP_FAILED';process.exitCode=2;}
  report.finishedAt=new Date().toISOString();
  report.durationMs=Date.parse(report.finishedAt)-Date.parse(report.startedAt);
  report.roles=plan.roles.map(p=>{
    const rows=report.attempts.filter(a=>a.role===p.role);
    const valid=rows.length===p.tasks.length*repeats && rows.every(a=>a.valid!==false && Number.isFinite(a.score));
    return {role:p.role,expectedAttempts:p.tasks.length*repeats,attempted:rows.length,
      validAttempts:rows.filter(a=>a.valid!==false && Number.isFinite(a.score)).length,
      invalidAttempts:rows.filter(a=>a.valid===false).length,
      score:valid?rows.reduce((n,a)=>n+a.score,0)/rows.length:null,
      status:valid?'EXPLORATORY_MEASURED':'UNVERIFIED',contractSha256:p.contractSha256,
      declaredGroups:new Set(p.tasks.map(t=>t.independenceGroup)).size};
  });
  flush();lease.release();console.log(JSON.stringify({status:report.status,verdict:report.verdict,roles:report.roles}));
}
