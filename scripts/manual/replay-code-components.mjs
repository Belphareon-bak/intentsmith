// Offline execution of immutable CODE answers. No provider, DB or activation.
import { readFileSync, writeFileSync, renameSync, statfsSync } from 'node:fs';
import { isAbsolute, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildTests, loadFixtureTasks } from '../../src/eval/code-patch-suite.js';
import { collectionSuite } from '../../src/eval/role-collection-profile.js';
import { CODE_TECHNICAL_PROFILE } from '../../src/eval/code-technical-projection.js';
import { assessExecutable, verifyExecutableTask, summarizeExecutable } from '../../src/eval/code-technical-replay.js';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Plan: resource preflight → component controls → optional replay → separate component report. No GPU/DB.\n'
    + 'Usage: --verify-only --out /new/report.json OR --run --answers /answers.json --identities /key.json --out /new/report.json');
  process.exit(0);
}
const mode = args.shift(), options = {};
if (!['--verify-only','--run'].includes(mode) || args.length % 2) throw Error('INVALID_ARGUMENTS');
for (let n=0;n<args.length;n+=2) {
  const key=args[n].slice(2);
  if (!['out','answers','identities'].includes(key) || options[key] || !isAbsolute(args[n+1])) throw Error('INVALID_ARGUMENTS');
  options[key]=args[n+1];
}
if (!options.out || (mode==='--run' && (!options.answers || !options.identities))) throw Error('INVALID_ARGUMENTS');
const root=fileURLToPath(new URL('../../', import.meta.url));
const hash=x=>createHash('sha256').update(x).digest('hex');
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const sources={};
function input(key) { const raw=readFileSync(options[key]); sources[key]={path:options[key],sha256:hash(raw)};return JSON.parse(raw); }
const fixture=buildTests(root,loadFixtureTasks(root));
const promptDefs=collectionSuite('CODE',{tests:fixture}).tests;
const answers=mode==='--run'?input('answers'):null, identities=mode==='--run'?input('identities'):null;
const rows=answers?.items.filter(r=>r.role==='CODE') || [];
if (answers) {
  if (!rows.length || new Set(rows.map(r=>r.id)).size!==rows.length) throw Error('INVALID_INPUT_IDS');
  const expected=fixture.map(t=>t.name).sort().join('|');
  for (const row of rows) {
    const def=promptDefs.find(t=>t.name===row.task), id=identities[row.id], raw=answers.inputs[row.inputKey];
    if (!def || !id?.model || !/^[a-f0-9]{64}$/.test(id.artifact?.digestSha256 || '')
      || hash(row.response)!==row.responseSha256 || row.inputKey!==`CODE/${row.task}`
      || JSON.stringify(raw?.messages)!==JSON.stringify([{role:'user',content:def.prompt().text}])
      || JSON.stringify(raw.options)!==JSON.stringify(def.options) || raw.think!==false || raw.tools.length!==0)
      throw Error('INPUT_IDENTITY_OR_PROMPT_MISMATCH:'+row.id);
  }
  for (const model of new Set(rows.map(r=>identities[r.id].model))) {
    const selected=rows.filter(r=>identities[r.id].model===model);
    if ([...new Set(selected.map(r=>r.task))].sort().join('|')!==expected) throw Error('INCOMPLETE_TASK_GRID');
    if (new Set(selected.map(r=>identities[r.id].artifact.digestSha256)).size!==1) throw Error('MODEL_DIGEST_MIXED');
    for (const task of fixture) if(selected.filter(r=>r.task===task.name).map(r=>r.repeat).sort().join(',')!=='1,2,3') throw Error('INCOMPLETE_REPEAT_GRID');
  }
}
const sourceFiles=['scripts/manual/replay-code-components.mjs','src/eval/code-technical-replay.js',
  'src/eval/code-technical-projection.js','src/eval/code-patch-runner.js','src/eval/code-patch-suite.js',
  'src/eval/code-contract-check.mjs','src/eval/code-suite-tasks.json','src/eval/function-span.js',
  'src/eval/code-task-extractor.js','src/eval/role-collection-profile.js','package-lock.json'];
const report={schemaVersion:1,status:'RUNNING',profile:CODE_TECHNICAL_PROFILE,startedAt:new Date().toISOString(),
  sourceRevision:git('rev-parse','HEAD'),workingTreeDirty:!!git('status','--porcelain'),
  sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,hash(readFileSync(root+p))])),sources,
  inference:false,productionImported:false,decisionAuthority:false,fullOracleAccepted:false,
  expectedAttempts:rows.length,acceptance:[],items:[],summaries:[],
  limitations:['Executable component only; full CODE correctness remains ungraded.',
    'Author-written controls are not independent acceptance or operational qualification.',
    'These are known development scenarios, not a fresh holdout.']};
writeFileSync(options.out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const flush=()=>{writeFileSync(options.out+'.tmp',JSON.stringify(report,null,2)+'\n');renameSync(options.out+'.tmp',options.out);};
function resources() {
  const free=p=>{const s=statfsSync(p);return s.bavail*s.bsize;};
  const ram=Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo','utf8'))?.[1])*1024;
  if (!(ram>6*2**30) || free(tmpdir())<2*2**30 || free(root)<20*2**30 || free(dirname(options.out))<5*2**30) throw Error('RESOURCE_RESERVE_REQUIRED');
}
try {
  const prepared=new Map();
  for(const def of fixture) {
    resources();const task=def.prepare();prepared.set(def.name,task);
    const acceptance=verifyExecutableTask(root,task,resources);
    report.acceptance.push({task:def.name,independenceGroup:task.oracleAcceptance.independenceGroup,...acceptance});flush();
    console.log(def.name,acceptance.status,acceptance.controls.length);
    if(acceptance.status!=='COMPONENT_CONTROLS_PASS')throw Error('COMPONENT_ACCEPTANCE_FAILED');
  }
  for (const row of rows) {
    resources();const started=Date.now();
    const assessment=assessExecutable(root,prepared.get(row.task),row.response);
    if(row.status!=='CAPTURED') {
      assessment.technical={...assessment.technical,contentExecution:assessment.technical,
        valid:row.status==='OUTPUT_BUDGET_EXHAUSTED',score:row.status==='OUTPUT_BUDGET_EXHAUSTED'?0:null,
        passed:false,outcome:row.status,reason:'Capture did not finish normally; executed fragment is diagnostic only.'};
    }
    report.items.push({id:row.id,role:row.role,task:row.task,repeat:row.repeat,responseSha256:row.responseSha256,
      inputSha256:hash(JSON.stringify(answers.inputs[row.inputKey])),model:identities[row.id].model,
      artifact:identities[row.id].artifact,collectionStatus:row.status,durationMs:Date.now()-started,assessment});
    flush();if(report.items.length%10===0)console.log('Replay',report.items.length,'/',rows.length);
  }
  for(const [p,sha] of Object.entries(report.sourceHashes))if(hash(readFileSync(root+p))!==sha)throw Error('REPLAY_SOURCE_CHANGED');
  report.summaries=summarizeExecutable(report.items);
  report.status=mode==='--verify-only'?'COMPONENT_CONTROLS_PASS':report.items.some(r=>!r.assessment.technical.valid)?'REPLAY_WITH_UNRESOLVED_COMPONENTS':'EXECUTABLE_COMPONENT_REPLAY_COMPLETE';
} catch(error) {report.status='BLOCKED';report.error=error.message;process.exitCode=1;}
report.finishedAt=new Date().toISOString();flush();console.log(report.status);
