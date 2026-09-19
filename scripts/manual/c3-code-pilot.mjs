// Manual, bounded CODE acceptance. Reuses the archived C3 execution loop,
// IntentSmith response attestation and the existing exclusive GPU lease.
// No production DB writes, binding application, model pulls or removal.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {cases, c3Revision} from './c3-code-pilot-fixtures.mjs';
import {codePilotPlanHash, validateCodePilotPlan, decideCodePilot, classifyCodePilotOutcome} from '../../src/eval/code-pilot-decision.js';
import {holdGpuEvaluationLock} from '../../src/upgrade/gpu-evaluation-lock.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = key => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const mode = args[0], c3 = opt('c3'), out = opt('out');
const workflow = opt('workflow') || 'c3';
const development = workflow === 'intentsmith';
if (!args.length || mode === '--help') {
  console.log('Manual CODE pilot: --prepare|--seal|--run|--replay --c3=/absolute/c3 --out=/absolute/evidence.\nPrepare validates executable oracles without GPU; seal locks the plan; run requires the pinned sidecar.\n--workflow=intentsmith uses the current product loop for DEVELOPMENT ONLY. --replay --responses=/absolute/archive replays stored output without inference. Fresh development seal/run also require --development.');
  process.exit(0);
}
if (!['--prepare','--seal','--run','--replay'].includes(mode) || !['c3','intentsmith'].includes(workflow) || !path.isAbsolute(c3 || '') || !path.isAbsolute(out || '')) {
  console.error('Explicit mode, absolute --c3 and --out are required.'); process.exit(2);
}
if (development && ['--seal','--run'].includes(mode) && !args.includes('--development')) throw new Error('EXPLICIT_DEVELOPMENT_MODE_REQUIRED');
fs.mkdirSync(out,{recursive:true,mode:0o700});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtimeSources = () => Object.fromEntries(execFileSync('git',['-C',root,'ls-files','src','scripts/manual/c3-code-pilot.mjs',
  'scripts/manual/c3-code-pilot-fixtures.mjs','scripts/run-model-hunt-provider.js','package-lock.json'],{encoding:'utf8'})
  .trim().split('\n').filter(Boolean).map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const sourceState = () => ({revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  workingTreeDirty:!!execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim(),
  sourceHashes:runtimeSources()});
const save = (name, value) => fs.writeFileSync(path.join(out,name), JSON.stringify(value,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const git = (...xs) => execFileSync('git',['-C',c3,...xs],{maxBuffer:150*1024*1024}).toString();
const bindingAt = db => JSON.parse(execFileSync('python3',['-c',String.raw`import sqlite3,json,sys,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)
c.row_factory=sqlite3.Row
r=c.execute("SELECT role,model,model_digest_sha256,verification_status,binding_operation_id,applied_at FROM model_overrides WHERE role='CODE'").fetchone()
print(json.dumps(dict(r) if r else None))`,db]).toString());
const revision = git('rev-parse',c3Revision).trim();
if (git('rev-parse','HEAD').trim() !== revision || git('status','--porcelain').trim()) throw new Error('C3_REFERENCE_NOT_PINNED_CLEAN');
// C3's native-parser safety probe resolves modules from cwd. Match the
// frozen runtime so it cannot probe IntentSmith's dependencies by accident.
process.chdir(c3);
process.env.INTENTSMITH_MAX_LOOP_ITERATIONS = process.env.C3_MAX_LOOP_ITERATIONS = '3';
process.env.INTENTSMITH_DB_PATH = process.env.C3_DB_PATH = path.join(out,'unused-controller.db');
process.env.INTENTSMITH_LOG_LEVEL = process.env.C3_LOG_LEVEL = 'error';
const {ModelEvaluationRunner} = await import('../../src/eval/model-evaluation-runner.js');
const {runFixLoop} = await import(pathToFileURL(workflow === 'c3' ? path.join(c3,'src/planner/execution-loop.js') : path.join(root,'src/executor/execution-loop.js')));
const {parseLLMOutput} = await import(pathToFileURL(path.join(workflow === 'c3' ? c3 : root,'src/patch/patch-engine.js')));

function exportCase(def, work) {
  fs.mkdirSync(work,{recursive:true});
  // No git history, symlinks, reference patch or controller files inside work.
  const archive = execFileSync('git',['-C',c3,'archive',def.fix],{maxBuffer:150*1024*1024});
  execFileSync('python3',['-c',"import sys,tarfile,io; t=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read())); t.extractall(sys.argv[1],members=[m for m in t.getmembers() if (m.isfile() or m.isdir()) and not m.name.startswith(('.git','docs/','data/'))],filter='data')",work],{input:archive});
  fs.mkdirSync(path.join(work,'node_modules'),{recursive:true});
  if (def.testBody) fs.writeFileSync(path.join(work,'pilot-test.mjs'),def.testBody);
  if (def.id === 'manual-scheduler') {
    const file=path.join(work,def.test), original=fs.readFileSync(file,'utf8');
    if (!original.includes('process.exit(failed > 0 ? 1 : 0);')) throw new Error('SCHEDULER_TEST_ADAPTER_DRIFT');
    fs.writeFileSync(file,original.replace('process.exit(failed > 0 ? 1 : 0);','process.exitCode = failed > 0 ? 1 : 0;'));
  }
  // Completion receipt means an early process.exit(0) cannot pass the oracle.
  fs.writeFileSync(path.join(work,'pilot-check.mjs'),`import {execFileSync} from 'node:child_process';\nfor (const file of ${JSON.stringify(def.files)}) execFileSync('/runner-node', ['--check', '/work/' + file]);\nif (!process.argv.includes('--syntax')) await import('./${def.test || 'pilot-test.mjs'}');\nconsole.log('PILOT_MODULE_COMPLETED');\nprocess.exit(process.exitCode || 0);\n`);
}

async function check(work, timeout=45000, syntaxOnly=false) {
  const started=Date.now();
  const argv=['--unshare-all','--new-session','--die-with-parent','--ro-bind','/usr','/usr',
    '--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp',
    '--ro-bind',work,'/work','--ro-bind',path.join(c3,'node_modules'),'/work/node_modules',
    '--ro-bind',process.execPath,'/runner-node','--chdir','/work','--setenv','HOME','/tmp',
    '--setenv','C3_DB_PATH','/tmp/pilot.db','--setenv','C3_LOG_LEVEL','error','/runner-node','/work/pilot-check.mjs',...(syntaxOnly?['--syntax']:[])];
  return await new Promise(resolve => {
    const child=spawn('bwrap',argv,{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    child.stdout.on('data',v=>{stdout=(stdout+v).slice(-100000);});
    child.stderr.on('data',v=>{stderr=(stderr+v).slice(-100000);});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},Math.max(1,timeout));
    child.on('error',error=>{clearTimeout(timer);resolve({allPassed:false,environmentInvalid:true,error:error.message,stdout,stderr,durationMs:Date.now()-started});});
    child.on('close',code=>{clearTimeout(timer);resolve({allPassed:code===0 && stdout.includes('PILOT_MODULE_COMPLETED')
      && ![...stdout.matchAll(/\b(\d+) failed/g)].some(m=>Number(m[1])>0),code,timedOut,stdout,stderr,durationMs:Date.now()-started});});
  });
}

function sourceVersions(def) {
  const before=Object.fromEntries(def.files.map(f=>[f,git('show',`${def.fix}^:${f}`)]));
  const gold=Object.fromEntries(def.files.map(f=>[f,git('show',`${def.fix}:${f}`)]));
  const alternative={...gold};
  for (const [a,b] of def.alternative) {
    const file=def.files.find(f=>alternative[f].includes(a));
    if (!file) throw new Error(`ALTERNATIVE_DRIFT:${def.id}:${a}`);
    alternative[file]=alternative[file].replace(a,b);
  }
  return {before,gold,alternative};
}
const put = (work, sources) => {for(const [f,s] of Object.entries(sources)) fs.writeFileSync(path.join(work,f),s);};

// Controller-only diff construction for acceptance probes, never model input.
function semanticDiff(before, after) {
  return execFileSync('python3',['-c',String.raw`import sys,json,difflib
b,a=json.load(sys.stdin)
for f in b:
 old=b[f].splitlines(); new=a[f].splitlines()
 groups=list(difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(n=0))
 if not groups: continue
 print('--- '+f)
 spans=[]
 for group in groups:
  i,j=group[0][1],group[-1][2]; k,l=group[0][3],group[-1][4]
  while i>0 and (not old[i].strip() or sum(old[i].strip() in line for line in old)!=1): i-=1;k-=1
  if spans and i<spans[-1][1]:
   pi,pj,pk,pl=spans.pop();i,k=pi,pk
  spans.append((i,j,k,l))
 for i,j,k,l in spans:
  print('@@ line '+old[i].strip())
  for line in old[i:j]: print('-'+line)
  for line in new[k:l]: print('+'+line)
`],{input:JSON.stringify([before,after]),maxBuffer:2e6}).toString();
}

function contextFor(def, work) {
  // Locked source windows come from historical changed locations, not gold text.
  // Every attempt gets the same initial windows; subsequent iterations see only
  // their own changed source. This is localized repair, not repository discovery.
  let text='';
  for (const f of def.files) {
    const lines=fs.readFileSync(path.join(work,f),'utf8').split('\n');
    const diff=git('diff','--unified=35',`${def.fix}^`,def.fix,'--',f);
    const windows=[...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map(m=>[Math.max(0,+m[1]-1),+m[2]||1]);
    const seen=new Set();
    for (const [start,count] of windows) for(let i=start;i<Math.min(lines.length,start+count+60);i++) seen.add(i);
    text+=`\nFILE ${f} (numbered source windows; line numbers are not code)\n`;
    text+=[...seen].sort((a,b)=>a-b).map(i=>`${i+1}: ${lines[i]}`).join('\n');
  }
  if(text.length>38000) throw new Error('CONTEXT_WINDOW_TOO_LARGE');
  return text;
}

async function attempt(def, work, callModel, budgetMs=600000) {
  const started=Date.now(), initial=await check(work), calls=[];
  if(initial.allPassed || initial.environmentInvalid || initial.timedOut) return {valid:false,score:null,outcome:'ENVIRONMENT_INVALID',reason:'INITIAL_STATE_NOT_VERIFIED_BROKEN',initial,durationMs:Date.now()-started};
  let lastCheck=initial, failure=null, loop=null;
  const quality=()=>({passed:lastCheck.allPassed,results:lastCheck.allPassed?[]:[{file:def.files[0],passed:false,
    message:'AssertionError: Historical regression remains. '+(lastCheck.stderr||lastCheck.stdout).slice(-3000)}]});
  try {
    loop=await runFixLoop({lifecycle:{id:randomUUID(),projectId:'code-pilot',projectPath:work},
      milestone:{id:def.id,title:def.requirement,scope_files:def.files},testResults:initial,qualityGateResult:quality(),
      taskMemory:null,selfCritique:null,getGitDiff:async()=>'',
      callLLM:async(role,prompt)=>{
        const remaining=budgetMs-(Date.now()-started); if(remaining<=0) throw Object.assign(new Error('ATTEMPT_BUDGET'),{operational:true});
        const full=prompt+'\n\n## Complete task requirements\n'+def.requirement+'\nOnly these source files may change: '+def.files.join(', ')
          +'\nTests are immutable. Use semantic anchors and exact source text, not numeric diff hunks. Do not include markdown fences or unchanged fence comments in the raw diff.\n'+contextFor(def,work);
        const response=await callModel(full,Math.min(300000,remaining));
        calls.push({role,prompt:full,...response});
        if(response.error) throw Object.assign(new Error(response.error),{environmentInvalid:true});
        const patches=parseLLMOutput(response.content);
        if(patches.some(p=>!def.files.includes(p.file))) throw Object.assign(new Error('PATCH_OUTSIDE_LOCKED_SCOPE'),{incorrect:true});
        return response;
      },
      runTests:async()=>{if(Date.now()-started>=budgetMs) throw Object.assign(new Error('ATTEMPT_BUDGET'),{operational:true});lastCheck=await check(work,Math.min(45000,budgetMs-(Date.now()-started)));return lastCheck;},
      runQualityGate:async()=>{const r=await check(work,45000,true);return {passed:r.allPassed,results:r.allPassed?[]:[{file:def.files[0],passed:false,message:r.stderr||'SyntaxError'}]};},
    });
  } catch(error) {failure={message:error.message,environmentInvalid:!!error.environmentInvalid || (!error.operational && !error.incorrect),
    operational:!!error.operational,incorrect:!!error.incorrect};}
  // Final persisted state decides; the C3 loop's convergence prose does not.
  const final=await check(work),durationMs=Date.now()-started;
  const invalid=failure?.environmentInvalid || final.environmentInvalid;
  const success=!invalid && !failure && final.allPassed && durationMs<=budgetMs;
  const outputBudgetExhausted=calls.at(-1)?.doneReason==='length';
  return {...classifyCodePilotOutcome({invalid, success, loopReason:loop?.stopReason,
      operationalFailure:failure?.operational||final.timedOut||durationMs>budgetMs||outputBudgetExhausted}),
    responseBudgetExhausted:outputBudgetExhausted,
    reason:failure?.message||loop?.stopReason||null,repairHelp:0,durationMs,calls,initial,final,loop,
    finalSourceHashes:Object.fromEntries(def.files.map(f=>[f,hash(fs.readFileSync(path.join(work,f)))]))};
}

if(mode==='--replay') {
  if (!path.isAbsolute(opt('responses') || '')) throw new Error('ABSOLUTE_RESPONSE_ARCHIVE_REQUIRED');
  const report = {status:'RUNNING',workflow,newInference:false,developmentOnly:true,productionImported:false,
    historicalScoresChanged:false,modelOutcomeEligible:false,source:sourceState(),startedAt:new Date().toISOString(),attempts:[]};
  if (fs.existsSync(path.join(out,'replay.json'))) throw new Error('REPLAY_ALREADY_EXISTS');
  for (const file of fs.readdirSync(opt('responses')).filter(f => /^attempt-[a-z0-9-]+\.json$/.test(f)).sort()) {
    const bytes = fs.readFileSync(path.join(opt('responses'),file));
    const previous = JSON.parse(bytes), def = cases.find(c => c.id === previous.scenario);
    if (!def) throw new Error('UNKNOWN_REPLAY_SCENARIO');
    const work = path.join(out,'replay-work');
    try {
      exportCase(def,work);put(work,sourceVersions(def).before);
      let index=0;
      const result = await attempt(def,work,async()=> {
        const call=previous.calls[index++];
        if (!call) throw Object.assign(new Error('STORED_RESPONSES_EXHAUSTED'),{operational:true});
        return call;
      });
      // This is a transfer diagnostic, not a new model run: prompts may differ.
      report.attempts.push({file,originalSha256:hash(bytes),originalOutcome:previous.outcome,
        originalReason:previous.reason,replayAssessment:result.reason==='STORED_RESPONSES_EXHAUSTED'?'INCOMPLETE_ARCHIVE':result.score===1?'STATE_VERIFIED_FIXED':'STATE_NOT_FIXED',...result});
      save('replay.json',report);
      console.log(file,result.outcome,result.reason);
    } finally { fs.rmSync(work,{recursive:true,force:true}); }
  }
  report.status='REPLAY_COMPLETE';report.finishedAt=new Date().toISOString();save('replay.json',report);
} else if(mode==='--prepare') {
  const report={startedAt:new Date().toISOString(),c3Revision:revision,
    workflow,developmentOnly:development,source:sourceState(),
    fixturesSha256:hash(fs.readFileSync(new URL('./c3-code-pilot-fixtures.mjs',import.meta.url))),cases:[],status:'RUNNING'};
  for(const def of cases) {
    const dir=path.join(out,'oracles',def.id);exportCase(def,dir);
    const versions=sourceVersions(def), controls=[];
    for(const [name,sources,expected] of [['gold',versions.gold,true],['alternative',versions.alternative,true],['broken',versions.before,false]]) {
      console.log(def.id, 'oracle', name);put(dir,sources);const r=await check(dir);controls.push({name,expected,...r});
    }
    const runtimeControls=[];
    const runtimeSamples=[['gold',versions.gold,1],['alternative',versions.alternative,1],['alternative-repeated',versions.alternative,1],['empty',versions.before,0]];
    if(def.id==='search-report')runtimeSamples.push(['budget',versions.before,0],['transport-down',versions.before,null],['provider-incomplete',versions.before,null],['output-budget',versions.before,0]);
    for(const [name,sources,expected] of runtimeSamples) {
      console.log(def.id, 'runtime', name);put(dir,versions.before);
      const response=semanticDiff(versions.before,sources);
      const r=await attempt(def,dir,async()=>{
        if(name==='budget')throw Object.assign(new Error('VERIFIED_OPERATION_BUDGET_CONTROL'),{operational:true});
        if(name==='transport-down')throw Object.assign(new Error('PROVIDER_UNAVAILABLE_CONTROL'),{environmentInvalid:true});
        if(name==='provider-incomplete') {
          const original=globalThis.fetch;
          try {
            const digest='a'.repeat(64);
            globalThis.fetch=async()=>({ok:true,json:async()=>({model:'oracle',digest,done:false,message:{content:response}})});
            return await new ModelEvaluationRunner('http://oracle.invalid')._callModel('oracle',[],{}, {modelName:'oracle',digestSha256:digest});
          } finally {globalThis.fetch=original;}
        }
        return {content:name==='alternative-repeated'?[response,response].map(p=>'```diff\n'+p+'\n```').join('\n'):response,evalCount:0,model:'ORACLE_REPLAY',...(name==='output-budget'?{doneReason:'length'}:{})};
      });
      runtimeControls.push({name,expected,...r});
    }
    put(dir,versions.before);
    const manifest={id:def.id,fixCommit:git('rev-parse',def.fix).trim(),files:def.files,
      requirement:def.requirement,independenceGroup:def.group,
      groupRationale:def.group==='cre-routing'?'Shared CRE routing component: search and arbitration counted as one group.':def.group==='audit-c170'?'Different defects from one audit commit, conservatively one group.':'Distinct historical defect and subsystem; independence remains an assumption.',
      sourceHashes:Object.fromEntries(def.files.map(f=>[f,hash(versions.before[f])])),
      testSha256:hash(fs.readFileSync(path.join(dir,def.test||'pilot-test.mjs'))),
      bootstrapSha256:hash(fs.readFileSync(path.join(dir,'pilot-check.mjs'))),
      contextSha256:hash(contextFor(def,dir))};
    manifest.contentSha256=hash(JSON.stringify(manifest));
    report.cases.push({manifest,controls,runtimeControls,passed:controls.every(c=>c.allPassed===c.expected&&!c.timedOut&&!c.environmentInvalid)
      && runtimeControls.every(c=>c.valid===(c.expected!==null)&&c.score===c.expected
        && (c.name!=='output-budget'||c.outcome==='OPERATIONAL_FAILURE'))});
    save('oracle-acceptance.json',report);
    console.log(def.id,report.cases.at(-1).passed?'PASS':'FAIL');
  }
  report.status=report.cases.every(c=>c.passed)?'PASS':'FAIL';report.finishedAt=new Date().toISOString();
  save('oracle-acceptance.json',report);process.exitCode=report.status==='PASS'?0:1;
} else if(mode==='--seal') {
  if(fs.existsSync(path.join(out,'plan.json'))) throw new Error('PLAN_ALREADY_SEALED');
  const acceptance=read('oracle-acceptance.json');
  if(acceptance.status!=='PASS' || (acceptance.workflow || 'c3')!==workflow || acceptance.cases.length!==cases.length
    || acceptance.fixturesSha256!==hash(fs.readFileSync(new URL('./c3-code-pilot-fixtures.mjs',import.meta.url)))) throw new Error('ORACLES_NOT_ACCEPTED');
  if (development && JSON.stringify(acceptance.source?.sourceHashes)!==JSON.stringify(runtimeSources())) throw new Error('ACCEPTED_RUNTIME_SOURCE_DRIFT');
  if(!path.isAbsolute(opt('binding-db')||''))throw new Error('ABSOLUTE_BINDING_DB_REQUIRED');
  const binding=bindingAt(opt('binding-db'));
  if(binding?.model!=='qwen3.8:latest' || binding.model_digest_sha256!=='22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643'
    || binding.verification_status!=='VERIFIED')throw new Error('CURRENT_CODE_BINDING_CHANGED');
  const plan={schemaVersion:1,role:'CODE',workflow,developmentOnly:development,notAHoldout:development,metric:'completed_without_repair_help',lockedAt:new Date().toISOString(),
    bindingDb:opt('binding-db'),bindingAtLock:binding,predecessorPlanSha256:opt('supersedes')||null,
    c3Revision:revision,independenceStatus:'ASSUMED_GROUPS_NOT_PROVEN_INDEPENDENCE',
    scope:development?'Development replay with fresh model responses on eight already exposed cases, using the IntentSmith product loop. Not selection evidence.':'Localized historical C3 repair using its unchanged execution loop; no Studio journey or whole-project success claim.',
    incumbent:{model:'qwen3.8:latest',digest:'22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643'},
    candidate:{model:'devstral-small-2:latest',digest:'24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8'},
    candidateSelection:'Runner-up from closed exploratory series; incumbent verified from production model_overrides before lock.',
    repeats:development?1:3,budget:{attemptMs:600000,totalMs:(development?2:4)*60*60*1000,maxIterations:3},
    decision:{method:'hoeffding-kl-bounded-groups',alpha:.05,minimumBenefit:.05,
      nonInferiorityMargin:.05,minimumSpeedup:1.25,allowSpeedDecision:false},
    profile:{numCtx:16384,numPredict:4096,temperature:.1,topP:.9,callTimeoutMs:300000,
      providerVersion:'0.34.0-intentsmith.2',parallelism:1,maxVramBytes:22000000000,vramScope:'whole_device_including_desktop',
      minimumPromptTokens:10000,minimumGeneratedTokens:2048,samplingMs:250,requiredGpuPlacement:'size_vram >= size',
      nativeAst:'C3 built-in native safety fallback; every changed JS file additionally checked by Node 22 before all executable oracles.'},
    oracleAcceptanceSha256:hash(fs.readFileSync(path.join(out,'oracle-acceptance.json'))),
    sourceHashes:runtimeSources(),
    node:{version:process.version,sha256:hash(fs.readFileSync(process.execPath))},
    c3LockSha256:hash(fs.readFileSync(path.join(c3,'package-lock.json'))),
    scenarios:acceptance.cases.map(c=>c.manifest)};
  const lines=Array.from({length:350},(_,i)=>`Record ${i}: function item_${i}(value) { if (value === null) return 0; return value + ${i}; }`);
  const longPrompt='Memory qualification, not a scored task. Read all reference records below. Then write 600 numbered, detailed integration test cases, each at least 20 words. Continue until the response budget is exhausted; do not summarize.\n'+lines.join('\n')+'\nNow write the 600 detailed cases.';
  fs.writeFileSync(path.join(out,'profile-input.txt'),longPrompt);plan.profile.promptSha256=hash(longPrompt);
  plan.planSha256=codePilotPlanHash(plan);validateCodePilotPlan(plan);save('plan.json',plan);
  console.log('SEALED',plan.planSha256,'scenarios',plan.scenarios.length,'groups',new Set(plan.scenarios.map(s=>s.independenceGroup)).size);
} else if(mode==='--run') {
  const plan=read('plan.json');validateCodePilotPlan(plan);
  if ((plan.workflow || 'c3')!==workflow || !!plan.developmentOnly!==development) throw new Error('WORKFLOW_PLAN_MISMATCH');
  for(const [f,digest] of Object.entries(plan.sourceHashes)) if(hash(fs.readFileSync(path.join(root,f)))!==digest) throw new Error('SEALED_SOURCE_DRIFT:'+f);
  if(hash(fs.readFileSync(path.join(out,'oracle-acceptance.json')))!==plan.oracleAcceptanceSha256
    || hash(fs.readFileSync(path.join(c3,'package-lock.json')))!==plan.c3LockSha256
    || hash(fs.readFileSync(process.execPath))!==plan.node.sha256) throw new Error('SEALED_ENVIRONMENT_DRIFT');
  const sourceRevision=execFileSync('git',['-C',root,'rev-parse','HEAD']).toString().trim();
  if(execFileSync('git',['-C',root,'status','--porcelain']).toString().trim()) throw new Error('PILOT_SOURCE_DIRTY');
  if(fs.existsSync(path.join(out,'result.json'))) throw new Error('PILOT_RESULT_ALREADY_EXISTS');
  const endpoint=process.env.OLLAMA_URL;
  if(endpoint!=='http://127.0.0.1:11435') throw new Error('PINNED_SIDECAR_REQUIRED');
  const get=async suffix=>{const r=await fetch(endpoint+suffix,{signal:AbortSignal.timeout(2000)});if(!r.ok)throw new Error('PROVIDER_HTTP_'+r.status);return r.json();};
  const lease=holdGpuEvaluationLock(),runner=new ModelEvaluationRunner(endpoint),started=Date.now();
  const report={status:'RUNNING',sourceRevision,workflow,developmentOnly:development,notAHoldout:development,planSha256:plan.planSha256,startedAt:new Date().toISOString(),
    qualifications:{},attempts:[],decision:null,operationPolicy:{productionImported:false,applyBindings:false,removeModels:false}};
  const flush=()=>{save('result.json',report);if(opt('report'))fs.writeFileSync(opt('report'),JSON.stringify(report,null,2)+'\n');};
  const compute=()=>execFileSync('nvidia-smi',['--query-compute-apps=pid,process_name','--format=csv,noheader'],{timeout:3000}).toString().trim();
  const assertGpuOwnership=()=>{
    const pgid=Number(process.env.INTENTSMITH_EVAL_PROVIDER_PID);
    if(!Number.isSafeInteger(pgid)||pgid<1)throw new Error('PROVIDER_OWNERSHIP_MISSING');
    for(const line of compute().split('\n').filter(Boolean)) {
      const pid=Number(line.split(',')[0]);
      let actual;try{actual=Number(execFileSync('ps',['-o','pgid=','-p',String(pid)],{timeout:1000}).toString().trim());}
      catch{continue;} // process exited while being sampled
      if(actual!==pgid)throw new Error('GPU_FOREIGN_WORK_PRESENT');
    }
  };
  const unload=async model=>{const r=await fetch(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model,keep_alive:0}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('OWNED_MODEL_UNLOAD_FAILED');};
  const expected=side=>({modelName:plan[side].model,digestSha256:plan[side].digest,providerVersion:plan.profile.providerVersion});
  const options={num_ctx:plan.profile.numCtx,num_predict:plan.profile.numPredict,temperature:plan.profile.temperature,top_p:plan.profile.topP};
  const response=async(side,prompt,timeout)=>runner._callModel(plan[side].model,[{role:'user',content:prompt}],{...options,timeout},expected(side));
  try {
    report.bindingBefore=bindingAt(plan.bindingDb);
    if(JSON.stringify(report.bindingBefore)!==JSON.stringify(plan.bindingAtLock))throw new Error('CURRENT_CODE_BINDING_CHANGED');
    if((await get('/api/version')).version!==plan.profile.providerVersion) throw new Error('PROVIDER_VERSION_DRIFT');
    const systemPs=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());
    if(systemPs.models?.length || (await get('/api/ps')).models?.length || compute()) throw new Error('GPU_FOREIGN_WORK_PRESENT');
    const tags=await get('/api/tags');
    for(const side of ['incumbent','candidate']) if(!tags.models.some(m=>m.name===plan[side].model && m.digest.replace(/^sha256:/,'')===plan[side].digest)) throw new Error('MODEL_ARTIFACT_DRIFT');
    flush();
    for(const side of ['incumbent','candidate']) {
      console.log('QUALIFY',side,plan[side].model);
      const prompt=fs.readFileSync(path.join(out,'profile-input.txt'),'utf8');
      if(hash(prompt)!==plan.profile.promptSha256)throw new Error('PROFILE_INPUT_DRIFT');
      const samples=[],samplingErrors=[];let sampling=true;
      const monitor=(async()=>{while(sampling){try{
        assertGpuOwnership();
        const used=execFileSync('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{timeout:3000}).toString().trim().split('\n').map(Number);
        if(used.some(n=>!Number.isFinite(n)||n<0))throw new Error('GPU_MEMORY_SAMPLE_INVALID');
        const ps=await get('/api/ps');samples.push({at:new Date().toISOString(),usedBytes:used.map(n=>n*1024*1024),models:ps.models});
      }catch(e){samplingErrors.push(e.message);}await new Promise(r=>setTimeout(r,plan.profile.samplingMs));}})();
      let r;try{r=await response(side,prompt,plan.profile.callTimeoutMs);}finally{sampling=false;await monitor;}
      const placements=samples.flatMap(s=>s.models||[]).filter(m=>m.name===plan[side].model);
      const peakBytes=Math.max(0,...samples.flatMap(s=>s.usedBytes));
      const q={planSha256:plan.planSha256,digest:plan[side].digest,responseAttested:!r.error,
        promptTokens:r.promptEvalCount,generatedTokens:r.evalCount,durationMs:r.durationMs,peakBytes,samples:samples.length,
        samplingErrors,fullGpuPlacement:placements.length>0 && placements.every(m=>m.size_vram>=m.size && m.context_length===plan.profile.numCtx),
        status:'NOT_QUALIFIED'};
      if(!r.error && !samplingErrors.length && q.fullGpuPlacement && peakBytes<=plan.profile.maxVramBytes
        && r.promptEvalCount>=plan.profile.minimumPromptTokens && r.evalCount>=plan.profile.minimumGeneratedTokens) q.status='QUALIFIED';
      report.qualifications[side]=q;save(`qualification-${side}.json`,{...q,response:r,samples});flush();
      console.log('QUALIFIED_RESULT',side,JSON.stringify(q));await unload(plan[side].model);
    }
    if(Object.values(report.qualifications).some(q=>q.status!=='QUALIFIED')) {
      report.status='PROFILE_NOT_QUALIFIED';
    } else {
      // Same initial state per attempt; alternate order within every pair.
      measurement: for(let repeat=1;repeat<=plan.repeats;repeat++) for(let i=0;i<cases.length;i++) {
        if(Date.now()-started+plan.budget.attemptMs*2>plan.budget.totalMs) {report.status='BUDGET_EXHAUSTED';break measurement;}
        const def=cases[i],manifest=plan.scenarios[i];
        for(const side of (repeat+i)%2?['incumbent','candidate']:['candidate','incumbent']) {
          const name=`${def.id}-${repeat}-${side}`,work=path.join(out,'attempts',name);
          exportCase(def,work);put(work,sourceVersions(def).before);
          if(hash(contextFor(def,work))!==manifest.contextSha256
            || hash(fs.readFileSync(path.join(work,def.test||'pilot-test.mjs')))!==manifest.testSha256
            || hash(fs.readFileSync(path.join(work,'pilot-check.mjs')))!==manifest.bootstrapSha256) throw new Error('TASK_CONTEXT_DRIFT');
          assertGpuOwnership();
          const stamp=new Date().toISOString();
          console.log('ATTEMPT',report.attempts.length+1,'/',plan.scenarios.length*plan.repeats*2,name,stamp);
          const result=await attempt(def,work,async(prompt,timeout)=>{
            assertGpuOwnership();const r=await response(side,prompt,timeout);assertGpuOwnership();return r;
          },plan.budget.attemptMs);
          const row={scenario:def.id,repeat,side,model:plan[side].model,digest:plan[side].digest,startedAt:stamp,
            planSha256:plan.planSha256,...result};
          save(`attempt-${name}.json`,row);
          const {calls,initial,final,loop,...summary}=row;
          report.attempts.push({...summary,calls:calls?.length||0,evidence:`attempt-${name}.json`});flush();
          console.log('RESULT',name,result.outcome,result.score,'seconds',Math.round(result.durationMs/1000));
          await unload(plan[side].model);
        }
      }
      if(report.status==='RUNNING')report.status='COMPLETE';
    }
  } catch(error) {report.status='ENVIRONMENT_INVALID';report.error=error.message;process.exitCode=1;
  } finally {
    report.finishedAt=new Date().toISOString();report.durationMs=Date.now()-started;
    report.decision=development
      ? {verdict:'DEVELOPMENT_ONLY',reason:'EXPOSED_CASES_NOT_SELECTION_EVIDENCE',activationAuthorized:false,bindingAction:'UNCHANGED',
        completedAttempts:report.attempts.length,successes:report.attempts.filter(a=>a.outcome==='SUCCESS').length}
      : decideCodePilot(plan,report.attempts,report.qualifications);
    try {
      report.bindingAfter=bindingAt(plan.bindingDb);
      if(JSON.stringify(report.bindingAfter)!==JSON.stringify(plan.bindingAtLock))throw new Error('CURRENT_CODE_BINDING_CHANGED');
    } catch(error) {report.decision.verdict='NEROZHODNUTO';report.decision.reason=error.message;}
    flush();lease.release();
    console.log('DECISION',JSON.stringify(report.decision));
  }
}
