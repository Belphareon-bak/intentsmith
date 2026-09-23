#!/usr/bin/env node
// Explicit local developmental capture; no grading or production activation.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createStage, readStage, runStageWindow, stageSummary, stageHash, stageAttempts, recordedStageAnswer } from '../../src/eval/collection-stage.js';
import { installedStageModels, createStageProvider, stageResources } from '../../src/eval/collection-stage-provider.js';
import { chatConversationDraft as suite, chatConversationDraftSha256 } from '../../src/eval/chat-conversation-suite.js';
import { EVALUATION_PROVIDER_BUILD } from '../../src/eval/evaluation-provider-build.js';
import { holdGpuEvaluationLock } from '../../src/upgrade/gpu-evaluation-lock.js';
import { createBlindAnswerReview } from '../../src/eval/model-answer-review.js';

const args=process.argv.slice(2), modes=['prepare','run','status','export'];
if(!args.length || args.includes('--help')) {
  console.log('CHAT capture without grading.\n--prepare --proposal=/abs/plan.json --stage=quick|full --out=/new/directory\n--status --out=/stage\n--run --out=/stage --expected-plan=SHA256 --window=unique-id --hours=4 --calls=64 --tokens=131072 [--report=/report.json]\n--export --out=/stage --review-out=/new/review/directory\nRun through scripts/run-model-hunt-provider.js --collection-stage. Each run explicitly allocates one window within the frozen cumulative budget.');process.exit(0);
}
const allowed=new Set([...modes,'proposal','stage','out','expected-plan','window','hours','calls','tokens','report','review-out']);
const options={};
for(const arg of args) { const m=/^--([^=]+)(?:=(.*))?$/.exec(arg);
  if(!m || !allowed.has(m[1]) || Object.hasOwn(options,m[1]) || (modes.includes(m[1])?m[2]!==undefined:!m[2]))throw Error('STAGE_ARGUMENTS_INVALID');
  options[m[1]]=m[2] ?? true;
}
if(modes.filter(m=>options[m]).length!==1 || !isAbsolute(options.out || ''))throw Error('STAGE_ARGUMENTS_INVALID');
const root=fileURLToPath(new URL('../../',import.meta.url));
const sourceFiles=['scripts/manual/collect-chat-conversation.mjs','scripts/run-model-hunt-provider.js',
  'src/eval/collection-stage.js','src/eval/collection-stage-provider.js','src/eval/conversation-capture.js',
  'src/eval/chat-conversation-suite.js','src/eval/fixtures/chat-conversation-draft.json',
  'src/eval/model-evaluation-runner.js','src/eval/grading-provider-guard.js','src/eval/evaluation-provider-build.js',
  'src/upgrade/gpu-evaluation-lock.js','src/upgrade/model-identity.js','src/upgrade/model-use-authority.js'];
const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,stageHash(readFileSync(join(root,f),'utf8'))]));
const sourceContractSha256=stageHash(sourceHashes);
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
if(options.prepare) {
  if(!isAbsolute(options.proposal || '') || !['quick','full'].includes(options.stage))throw Error('STAGE_ARGUMENTS_INVALID');
  const proposal=JSON.parse(readFileSync(options.proposal,'utf8'));
  if(proposal.fixtureSha256!==chatConversationDraftSha256)throw Error('STAGE_FIXTURE_CHANGED');
  const selected=proposal[options.stage];
  const models=await installedStageModels(selected.models.map(m=>m.name),undefined,EVALUATION_PROVIDER_BUILD.version);
  const tasks=suite.tests.filter(t=>selected.groups.includes(t.independenceGroup)).map(t=>({name:t.name,role:'CHAT',
    language:t.language,independenceGroup:t.independenceGroup,turns:t.prompt().conversationTurns,
    rubric:t.rubric,formatRubric:t.formatRubric,contractMaterial:t.contractMaterial,options:t.options}));
  const plan={schemaVersion:1,decisionAuthority:false,notAHoldout:true,stage:options.stage,
    preparedAt:new Date().toISOString(),sourceRevision:git('rev-parse','HEAD'),sourceContractSha256,sourceHashes,
    fixtureSha256:chatConversationDraftSha256,models,tasks,repeats:selected.repeats,
    budget:{calls:selected.providerCalls,outputTokens:selected.maximumOutputTokens},resourceFloors:selected.resourceFloors,
    proposedInitialWindowHours:selected.proposedWallClockStopHours,
    reviewStatus:'OPERATOR_REVIEW_REQUIRED',providerBuild:EVALUATION_PROVIDER_BUILD};
  stageResources(dirname(options.out),plan.resourceFloors);
  createStage(options.out,plan);
  console.log(JSON.stringify({status:'PREPARED',planSha256:stageHash(plan),budget:plan.budget,inference:false}));
} else if(options.status) console.log(JSON.stringify(stageSummary(readStage(options.out)),null,2));
else if(options.export) {
  if(!isAbsolute(options['review-out'] || ''))throw Error('STAGE_ARGUMENTS_INVALID');
  const stage=readStage(options.out),attempts=stageAttempts(stage),runs=[];
  for(const model of stage.plan.models) {
    const tasks=[];
    for(const t of stage.plan.tasks) {
      const answers=attempts.filter(a=>a.model.name===model.name&&a.task.name===t.name).map(a=>recordedStageAnswer(stage,a.id)).filter(Boolean);
      if(!answers.length)continue;
      tasks.push({name:t.name,independenceGroup:t.independenceGroup,input:{conversationTurns:t.turns},rubric:t.rubric,
        responses:answers.map(a=>a.response),details:answers.map(a=>({...a,reason:a.error}))});
    }
    runs.push({runId:stage.sha256+':'+model.name,role:'CHAT',model:model.name,...model.artifact,
      suiteContractSha256:stage.plan.fixtureSha256,status:'COLLECTION_PARTIAL',collection:true,tasks});
  }
  const review=createBlindAnswerReview(runs),out=options['review-out'];
  for(const item of review.review.items) {
    const task=stage.plan.tasks.find(t=>t.name===item.task);
    item.formatCriteria=task.formatRubric || [];
    item.gradingContext=task.contractMaterial?.gradingInputs || null;
  }
  review.review.instructions+=' Evaluate the entire transcript. PARTIAL, transport failures and output limits are visible but do not obtain a content zero. Source contract and incomplete coverage remain in coverage.json.';
  mkdirSync(out,{mode:0o700});
  for(const [file,value] of [['review.json',review.review],['PRIVATE-identity-key.json',review.identityKey],['coverage.json',stageSummary(stage)]])
    writeFileSync(join(out,file),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'EXPORTED_NOT_GRADED',items:review.review.items.length,directory:out}));
} else {
  const stage=readStage(options.out);
  if(options['expected-plan']!==stage.sha256)throw Error('STAGE_EXPLICIT_PLAN_REQUIRED');
  if(git('status','--porcelain'))throw Error('STAGE_CLEAN_SOURCE_REQUIRED');
  const hours=Number(options.hours);
  if(!(hours>0&&hours<=24))throw Error('STAGE_WINDOW_HOURS_INVALID');
  const lease=holdGpuEvaluationLock({command:'CHAT stage '+stage.sha256});
  const cancel=new AbortController();
  process.once('SIGINT',()=>cancel.abort());process.once('SIGTERM',()=>cancel.abort());
  let provider;
  try {
    provider=createStageProvider({plan:stage.plan,directory:options.out});
    const result=await runStageWindow({directory:options.out,windowId:options.window,
      budget:{calls:Number(options.calls),outputTokens:Number(options.tokens),wallMs:hours*3600000},
      sourceContractSha256,signal:cancel.signal,...provider,
      onProgress:p=>console.log(JSON.stringify({event:'progress',...p,windows:undefined}))});
    writeFileSync(join(options.out,'summary.json'),JSON.stringify(result.summary,null,2)+'\n',{mode:0o600});
    if(options.report)writeFileSync(options.report,JSON.stringify(result.summary,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify(result.summary));
    if(result.summary.status==='PARTIAL')process.exitCode=2;
  } finally {try{await provider?.close();}finally{lease.release();}}
}
