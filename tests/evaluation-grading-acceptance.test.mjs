// Entirely synthetic authority tests. Nothing here is an acceptance of a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { up } from '../src/db/migrations/2026_09_19_116_model_evaluation_acceptance.js';
import { up as upReviews } from '../src/db/migrations/2026_09_24_117_model_evaluation_grader_reviews.js';
import { up as upAdjudications } from '../src/db/migrations/2026_09_25_118_model_evaluation_adjudications.js';
import { ModelEvaluationAcceptanceStore, acceptanceHash } from '../src/upgrade/model-evaluation-acceptance.js';
import { ModelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { semanticAcceptancePlanHash, semanticGraderContract, validateSemanticAcceptance } from '../src/eval/semantic-grader-acceptance.js';
import { SemanticEvaluationJudge } from '../src/eval/semantic-evaluation-judge.js';
import { gradeAnswerCollection, persistGradedCollection, gradeAcceptedCollection, collectionGradingOptions, persistAdjudicatedCollection } from '../src/eval/grade-answer-collection.js';
import { evaluationStateForArtifact } from '../src/upgrade/model-upgrade-prototype.js';
import { validStoredGradingPair } from '../src/eval/independent-grader-pair.js';
import { buildBlindAdjudicationPacket } from '../scripts/adjudicate-model-collection.mjs';
import { codePilotPlanHash } from '../src/eval/code-pilot-decision.js';
import { decideRoleOperational } from '../src/eval/role-operational-decision.js';
const A='a'.repeat(64), B='b'.repeat(64), H='c'.repeat(64), J='d'.repeat(64), K='e'.repeat(64);
const provider='0.34.2-intentsmith.1', judgeArtifact={modelName:'qwen3.8:latest',digestSha256:J,providerVersion:provider};
const secondJudgeArtifact={modelName:'gemma4:31b',digestSha256:K,providerVersion:provider};
const review={reviewer:'synthetic reviewer',reference:'fixture://not-a-real-acceptance',reason:'authority regression test',
  reviewedAt:'2026-09-21T01:00:00Z',decision:'ACCEPTED'};
const envelope=(kind,evidence)=>({schemaVersion:1,kind,role:evidence.role,contractSha256:evidence.contractSha256,evidence,
  review:{...review,evidenceSha256:acceptanceHash(evidence)}});
function fixture(role='D1') {
  const db=new Database(':memory:');up(db);
  db.exec(`CREATE TABLE model_evaluation_runs (run_id TEXT PRIMARY KEY,model_name TEXT,model_canonical_name TEXT,
    model_digest_sha256 TEXT,suite_name TEXT,suite_version TEXT,suite_contract_sha256 TEXT,role TEXT,status TEXT,
    score REAL,passed INTEGER,total INTEGER,repeats INTEGER,duration_ms INTEGER,tokens_per_second REAL,vram_bytes INTEGER,
    task_results_json TEXT,hardware_json TEXT,metadata_json TEXT,error_code TEXT,error_message TEXT,started_at TEXT,completed_at TEXT);
    CREATE TRIGGER keep_runs BEFORE UPDATE ON model_evaluation_runs BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  upReviews(db);upAdjudications(db);
  const plan=createRoleEvaluationPlans({db,codeRuntimeAvailability:{ready:true}})[role];
  const store=new ModelEvaluationAcceptanceStore(db), history=new ModelEvaluationHistory(db);history.setProviderVersion(provider);
  const base={role,contractSha256:plan.suiteContractSha256,runtimeSha256:plan.qualificationRuntimeSha256,
    archiveSha256:H,status:'PASS',completedAt:'2026-09-21T00:30:00Z'};
  const tasks=plan.suite.tests.map(t=>({name:t.name,tier:t.tier || (role==='CODE'?'T1':'T2'),
    taskType:role,criterionCount:t.semanticReference?.criteria.length,floor:t.tier==='T4'?.25:0,
    probes:Object.fromEntries(['empty','prompt-echo','keyword-stuffing','negated-facts','confident-wrong','gold','alternative']
      .map(name=>[name,{responseSha256:H,score:['gold','alternative'].includes(name)?1:0}]))}));
  const semanticTasks=tasks.filter(t=>t.tier==='T4');
  const cases=Array.from({length:Math.max(32,semanticTasks.length*4)},(_,i)=>{
    const t=semanticTasks[i%semanticTasks.length];
    return t && {id:`case-${i}`,task:t.name,type:t.taskType,independenceGroup:`unseen-${i}`,
      originSha256:acceptanceHash(['origin',i]),answerSha256:acceptanceHash(['answer',i]),answerArtifactDigestSha256:B,
      expectedScores:Array(t.criterionCount).fill(i%2?1:0)};
  }).filter(Boolean);
  const calibration={version:1,role,contractSha256:base.contractSha256,runtimeSha256:base.runtimeSha256,
    graderContractSha256:semanticGraderContract(),judge:judgeArtifact,lockedAt:'2026-09-21T00:01:00Z',
    labels:{blindToModel:true,blindToJudge:true,disputesResolved:true,reviewer:'independent fixture expert',
      reference:'fixture://human-labels',reviewedAt:'2026-09-21T00:00:00Z'},
    developmentGroups:['training-only'],developmentAnswerSha256:[H],cases,
    rule:{passThreshold:.7,minimumIndependentGroups:20,minimumPerClass:8,maxFalsePositiveRate:.1,
      maxFalseNegativeRate:.1,maxMeanAbsoluteError:.1,maxOrderDifference:.15}};
  const predictions=p=>p.cases.map(c=>({id:c.id,planSha256:p.planSha256,answerSha256:c.answerSha256,
    startedAt:'2026-09-21T00:02:00Z',completedAt:'2026-09-21T00:03:00Z',labelsSuppliedToJudge:false,
    ...Object.fromEntries(['forward','reverse'].map(order=>[order,{artifact:p.judge,inputSha256:acceptanceHash([order,c.id]),
      responseSha256:H,scores:[...c.expectedScores],referenceScores:c.expectedScores.map(()=>1),
      evidence:c.expectedScores.map(()=> 'synthetic explanatory fact')}]))}));
  calibration.planSha256=semanticAcceptancePlanHash(calibration);
  const grader=(judge=judgeArtifact)=>{
    const plan=structuredClone(calibration);plan.judge=judge;plan.planSha256=semanticAcceptancePlanHash(plan);
    return envelope('GRADER',{...base,tasks,...(semanticTasks.length?{
      semanticAcceptance:{plan,results:predictions(plan)}}:{})});
  };
  const revoke=id=>{const e={targetId:id};return store.record({schemaVersion:1,kind:'REVOKE',role,
    contractSha256:base.contractSha256,targetId:id,evidence:e,
    review:{...review,decision:'REVOKED',evidenceSha256:acceptanceHash(e)}});};
  const collect=()=>{
    const n=plan.taskCount*plan.repeats;
    return history.recordCollection({artifact:{modelName:'answer-model',digestSha256:A},role,
      suiteName:plan.suiteName,suiteVersion:plan.suiteVersion,contractSha256:plan.suiteContractSha256,
      summary:{score:null,runs:plan.repeats,startedAt:'2026-09-21T00:00:00Z',completedAt:'2026-09-21T00:01:00Z',
        collection:{status:'AWAITING_REVIEW',planned:n,observed:n,captured:n,budgetExhausted:0,invalid:0},
        tasks:plan.suite.tests.map(t=>({name:t.name,input:t.prompt(),options:t.options,mean:null,scores:[],responses:Array(plan.repeats).fill('synthetic response'),
          details:Array.from({length:plan.repeats},(_,i)=>({repeat:i+1,captureStatus:'CAPTURED',gradingStatus:'NOT_GRADED',
            artifact:{digestSha256:A,providerVersion:provider}}))}))}});
  };
  return {db,plan,store,history,base,grader,revoke,collect,predictions};
}
function operation(f,graderId,secondId=null) {
  const p={schemaVersion:1,role:f.plan.role,workflow:'intentsmith',evaluationContractSha256:f.base.contractSha256,
    runtimeSha256:f.base.runtimeSha256,developmentOnly:false,notAHoldout:false,holdoutSha256:H,
    metric:f.plan.role==='CODE'?'completed_without_repair_help':'completed_role_workflow_without_repair_help',
    lockedAt:'2026-09-21T00:00:00Z',repeats:1,budget:{attemptMs:1000,totalMs:100000},
    incumbent:{model:'old',digest:A},candidate:{model:'new',digest:B},
    profile:{numCtx:16384,numPredict:8192,temperature:.1,topP:.9,maxVramBytes:22000000000,providerVersion:provider},
    decision:{method:'hoeffding-kl-bounded-groups',alpha:.05,minimumBenefit:.05,nonInferiorityMargin:.05,
      minimumSpeedup:1.25,allowSpeedDecision:false},developmentGroups:['old-case'],
    roleWorkflow:{role:f.plan.role,name:'fixture full workflow',contractSha256:H,scope:'COMPLETE_ROLE_WORKFLOW',
      acceptanceChecks:['delivered'],regressionChecks:['no regression']},
    scenarios:Array.from({length:30},(_,i)=>({id:`s${i}`,independenceGroup:`g${i}`,groupRationale:'distinct synthetic case',
      originSha256:acceptanceHash(['history',i]),inputSha256:acceptanceHash(['input',i]),contentSha256:H}))};
  p.planSha256=codePilotPlanHash(p);
  const attempts=p.scenarios.flatMap(s=>['candidate','incumbent'].map(side=>({scenario:s.id,repeat:1,side,
    planSha256:p.planSha256,digest:p[side].digest,startedAt:'2026-09-21T00:02:00Z',durationMs:100,
    valid:true,repairHelp:0,score:side==='candidate'?1:0,outcome:side==='candidate'?'SUCCESS':'INCORRECT',
    workflowReceipt:{role:p.role,scope:p.roleWorkflow.scope,workflowContractSha256:H,inputSha256:s.inputSha256,
      finalStateSha256:H,traceSha256:H,environmentValid:true,independentVerification:true,repairHelp:0,
      checks:[{id:'delivered',passed:side==='candidate',evidenceSha256:H},{id:'no regression',passed:true,evidenceSha256:H}]}})));
  return envelope('OPERATIONAL',{...f.base,
    ...(f.plan.collectionOnly?{graderAcceptanceIds:[graderId,secondId]}:{graderAcceptanceId:graderId}),plan:p,attempts,
    hardware:{model:'fixture GPU',vramMb:24576},holdout:{independent:true,usedForDevelopment:false,manifestSha256:H},
    qualifications:Object.fromEntries(['candidate','incumbent'].map(side=>[side,{planSha256:p.planSha256,digest:p[side].digest,status:'QUALIFIED'}]))});
}
const resign=e=>{e.review.evidenceSha256=acceptanceHash(e.evidence);return e;};

for(const role of ['D1','D2','CODE','R1','R2','CHAT','VISION']) test(`${role}: real plans require both reviewed stages, preserve pair and close on revocation`,()=>{
  const f=fixture(role);try {
    assert.equal(f.plan.decisionReady,false);
    const g=f.store.record(f.grader()).id;assert.equal(f.plan.decisionReady,false);
    const second=f.plan.collectionOnly?f.store.record(f.grader(secondJudgeArtifact)).id:null;
    assert.equal(f.plan.decisionReady,false);
    const op=f.store.record(operation(f,g,second)).id;
    assert.equal(f.plan.decisionReady,true);assert.equal(f.plan.acceptance.qualifications[0].decision.verdict,'ZMENIT');
    f.revoke(op);assert.equal(f.plan.decisionReady,false);
  }finally{f.db.close();}
});
test('semantic acceptance rejects leaks, self-grading, missing answers, missing classes and split origins',()=>{
  const f=fixture();try {
    for(const change of [p=>p.cases[0].answerArtifactDigestSha256=J,p=>p.labels.blindToModel=false,
      p=>p.labels.disputesResolved=false,p=>p.developmentGroups.push(p.cases[0].independenceGroup),
      p=>p.developmentAnswerSha256.push(p.cases[0].answerSha256),
      p=>p.cases[1].originSha256=p.cases[0].originSha256,p=>p.cases.forEach(c=>c.expectedScores.fill(1)),
      p=>p.cases=p.cases.slice(0,8),p=>p.cases[0].type='easier',p=>p.rule.minimumIndependentGroups=1]) {
      const e=f.grader(),s=e.evidence.semanticAcceptance;change(s.plan);s.plan.planSha256=semanticAcceptancePlanHash(s.plan);
      s.results=f.predictions(s.plan);assert.throws(()=>f.store.record(resign(e)),/SEMANTIC_ACCEPTANCE_INVALID/);
    }
    const e=f.grader();e.evidence.semanticAcceptance.results.pop();assert.throws(()=>f.store.record(resign(e)),/complete sample/);
  }finally{f.db.close();}
});
test('acceptance recomputes per-type errors and order stability, ignoring claimed PASS',()=>{
  const f=fixture();try {
    for(const change of [r=>r.forward.scores.fill(1),r=>{r.forward.scores.fill(1);r.reverse.scores.fill(1);},
      r=>r.reverse.artifact={...judgeArtifact,digestSha256:A},r=>r.labelsSuppliedToJudge=true]) {
      const e=f.grader();e.evidence.semanticAcceptance.results.forEach(change);
      assert.throws(()=>f.store.record(resign(e)),/SEMANTIC_ACCEPTANCE_INVALID/);
    }
    const e=f.grader(),m=validateSemanticAcceptance(e.evidence.semanticAcceptance,e.evidence).metrics.D1;
    assert.equal(m.answers,32);assert.equal(m.independentGroups,32);assert.equal(m.falsePositiveRate,0);assert.equal(m.falseNegativeRate,0);
  }finally{f.db.close();}
});
test('non-CODE qualification rejects isolated answers, missing checks and success contradicting the final state',()=>{
  const f=fixture();try {
    const g=f.store.record(f.grader()).id, second=f.store.record(f.grader(secondJudgeArtifact)).id;
    for(const change of [p=>p.plan.roleWorkflow.scope='SINGLE_ANSWER',p=>p.attempts[0].workflowReceipt.checks.pop(),
      p=>p.attempts[0].workflowReceipt.checks[0].passed=false,p=>p.plan.developmentGroups.push('g0'),
      p=>p.plan.scenarios[1].originSha256=p.plan.scenarios[0].originSha256]) {
      const e=operation(f,g,second);change(e.evidence);e.evidence.plan.planSha256=codePilotPlanHash(e.evidence.plan);
      e.evidence.attempts.forEach(a=>a.planSha256=e.evidence.plan.planSha256);
      assert.throws(()=>f.store.record(resign(e)),/INVALID/);
    }
    const e=operation(f,g,second).evidence;e.attempts[0].valid=false;e.attempts[0].score=null;
    assert.equal(decideRoleOperational(e.plan,e.attempts,e.qualifications).reason,'INCOMPLETE_PAIRED_EVIDENCE');
  }finally{f.db.close();}
});
test('acceptance cannot hide opposing criterion flips in an unchanged mean or omit rejected references',()=>{
  const f=fixture();try {
    const e=f.grader(),s=e.evidence.semanticAcceptance;
    s.plan.cases[0].expectedScores[0]=.5;s.plan.cases[0].expectedScores[1]=.5;
    s.plan.planSha256=semanticAcceptancePlanHash(s.plan);s.results=f.predictions(s.plan);
    s.results[0].forward.scores[0]=1;s.results[0].forward.scores[1]=0;
    s.results[0].reverse.scores[0]=0;s.results[0].reverse.scores[1]=1;
    assert.throws(()=>f.store.record(resign(e)),/criterion order instability/);
    for (const change of [r=>r.forward.referenceScores.fill(0),r=>delete r.reverse.referenceScores]) {
      const v=f.grader();change(v.evidence.semanticAcceptance.results[0]);
      assert.throws(()=>f.store.record(resign(v)),/reference/);
    }
  }finally{f.db.close();}
});
const fakeCall=(onCall=()=>{})=>async(_model,messages,_options,artifact)=>{
  onCall();const count=JSON.parse(messages[1].content).criteria.length;
  const parts=Array.from({length:count},(_,i)=>({criterion:i+1,score:1,evidence:'synthetic correct result'}));
  return {done:true,doneReason:'stop',digestSha256:artifact.digestSha256,providerVersion:provider,content:JSON.stringify({a:parts,b:parts})};
};
const fakeJudge=(f,id,onCall=()=>{},artifact=judgeArtifact)=>new SemanticEvaluationJudge({artifact,
  isAccepted:()=>f.plan.acceptance.graderIds.includes(id),call:fakeCall(onCall)});
test('stored answers are graded without generation, persist new rows, retain source, and wait for operational acceptance',async()=>{
  const f=fixture();try {
    const id=f.store.record(f.grader()).id,source=f.collect(),before=JSON.stringify(source);let calls=0;
    const summary=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,judge:fakeJudge(f,id,()=>calls++)});
    assert.equal(calls,48);assert.equal(summary.score,1);assert.equal(summary.grading.observed,24);
    const first=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary});
    assert.equal(first.status,'BLOCKED');assert.equal(first.errorCode,'EVALUATION_REVIEW_PENDING_PAIR');
    assert.equal(f.history.getComplete({role:'D1',digestSha256:A,suiteName:f.plan.suiteName,
      suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256}),null);
    const second=f.store.record(f.grader(secondJudgeArtifact)).id;
    const secondSummary=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:second,
      judge:fakeJudge(f,second,()=>calls++,secondJudgeArtifact)});
    const saved=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:secondSummary});
    assert.equal(saved.status,'COMPLETE');assert.equal(saved.metadata.grading.version,2);
    assert.equal(saved.metadata.grading.graders.length,2);
    assert.equal(saved.metadata.grading.sourceCollectionRunId,source.runId);
    assert.equal(validStoredGradingPair(f.db,saved.metadata.grading,f.plan.acceptance.graders,
      A,f.plan.role,f.plan.suiteContractSha256,saved.score),true);
    assert.equal(validStoredGradingPair(f.db,saved.metadata.grading,f.plan.acceptance.graders,
      B,f.plan.role,f.plan.suiteContractSha256,saved.score),false,
      'a graded score cannot be reassigned to another answer artifact');
    assert.equal(validStoredGradingPair(f.db,{...saved.metadata.grading,
      graders:saved.metadata.grading.graders.map((g,i)=>i?{...g,reviewId:'missing'}:g)},
      f.plan.acceptance.graders,A,f.plan.role,f.plan.suiteContractSha256,saved.score),false);
    assert.equal(JSON.stringify(f.history.getRun(source.runId)),before);assert.equal(f.history.count(),3);
    assert.equal(f.plan.decisionReady,false);
  }finally{f.db.close();}
});
test('collection identity, same-artifact judging and revoked acceptance fail before inference',async()=>{
  const f=fixture();try {
    const id=f.store.record(f.grader()).id,source=f.collect(),judge=fakeJudge(f,id,()=>assert.fail('must not infer'));
    for(const change of [s=>s.contractSha256='unknown',s=>s.tasks[0].input='other prompt',s=>s.tasks[0].options.num_predict=1,
      s=>s.tasks.pop(),s=>s.tasks[0].details[0].artifact.digestSha256=B,
      s=>s.tasks[0].details.pop(),s=>s.tasks[0].details[1].repeat=1]) {
      const bad=structuredClone(source);change(bad);
      await assert.rejects(gradeAnswerCollection({plan:f.plan,collection:bad,graderAcceptanceId:id,judge}),/EVALUATION_COLLECTION/);
    }
    f.revoke(id);await assert.rejects(gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,judge}),/ACCEPTANCE_MISSING/);
  }finally{f.db.close();}
});
test('a lost judge response is missing evidence, never a low score; revocation during inference prevents persistence',async()=>{
  const f=fixture();try {
    const id=f.store.record(f.grader()).id,source=f.collect(),judge=fakeJudge(f,id);
    judge.call=async()=>({done:true,doneReason:'stop',digestSha256:J,providerVersion:provider,content:'unreadable'});
    const summary=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,judge});
    assert.equal(summary.score,null);assert.equal(summary.grading.invalid,24);
    const saved=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary});
    assert.equal(saved.status,'BLOCKED');assert.equal(saved.errorCode,'EVALUATION_GRADING_INCOMPLETE');
    let once=false;const revoked=fakeJudge(f,id,()=>{if(!once){once=true;f.revoke(id);}});
    await assert.rejects(gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,judge:revoked}),/ACCEPTANCE_MISSING/);
    assert.equal(f.history.count(),2);
  }finally{f.db.close();}
});

test('automatic hunt resumes pending grading after acceptance, reuses scores, and closes cache on revocation',async()=>{
  const f=fixture();try {
    const source=f.collect(), state=()=>evaluationStateForArtifact(source.artifact,['D1'],{D1:f.plan},f.history);
    assert.equal(state().perRole.D1,'awaiting-review');
    assert.equal(collectionGradingOptions(f.history,{D1:f.plan},source.runId).graders.length,0);
    assert.equal(await gradeAcceptedCollection({history:f.history,plan:f.plan,runId:source.runId}),null);
    const id=f.store.record(f.grader()).id;assert.equal(state().perRole.D1,'grading-pending');
    let prepared=0,finished=0,calls=0;
    const options={history:f.history,plan:f.plan,runId:source.runId,call:fakeCall(()=>calls++),
      prepareJudge:async()=>{prepared++;},finishJudge:async()=>{finished++;}};
    assert.equal(await gradeAcceptedCollection(options),null,'one judge cannot start an automatic final review');
    assert.equal(calls,0);
    const second=f.store.record(f.grader(secondJudgeArtifact)).id;
    const result=await gradeAcceptedCollection(options);
    assert.equal(result.score,1);assert.equal(prepared,2);assert.equal(finished,2);assert.equal(calls,96);
    assert.equal(state().perRole.D1,'scored');
    assert.equal((await gradeAcceptedCollection(options)).reused,true);assert.equal(calls,96);
    f.revoke(second);assert.equal(state().perRole.D1,'grading-pending');
    assert.equal(f.history.getRun(result.runId).score,1,'revocation preserves historical grades');
  }finally{f.db.close();}
});
test('same artifact and unproved provider cannot grade an answer even after authored probe qualification',async()=>{
  const f=fixture();try {
    const id=f.store.record(f.grader()).id,judge=fakeJudge(f,id,()=>assert.fail('self grade must not call provider'));
    const task=f.plan.suite.tests[0];
    assert.equal((await judge.grade(task,'answer',{artifact:judgeArtifact})).detail.reason,'SEMANTIC_SELF_GRADING_FORBIDDEN');
    assert.equal((await judge.grade(task,'answer')).detail.reason,'SEMANTIC_ANSWER_ARTIFACT_REQUIRED');
    const actual=fakeJudge(f,id),call=actual.call;
    actual.call=async(...args)=>({...await call(...args),digestSha256:A});
    assert.equal((await actual.grade(task,'answer',{artifact:{digestSha256:A}})).detail.reason,'SEMANTIC_JUDGE_RESPONSE_INVALID');
  }finally{f.db.close();}
});

test('grading refuses foreign GPU owners, unknown telemetry and malformed CLI flags before work',async()=>{
  const {assertGradingGpuOwnership}=await import('../src/eval/grading-provider-guard.js');
  const {main}=await import('../scripts/grade-model-collection.js');
  const probe={read:async()=>'/owned/ollama\0serve\0',request:async()=>({ok:true,json:async()=>({models:[]})}),
    run:async(command)=>({stdout:command==='nvidia-smi'?'42\n':'123\n'})};
  await assertGradingGpuOwnership(123,probe);
  await assert.rejects(assertGradingGpuOwnership(234,probe),/GPU_FOREIGN_WORK_PRESENT/);
  await assert.rejects(assertGradingGpuOwnership(123,{...probe,request:async()=>({ok:true,json:async()=>({models:[{}]})})}),/GPU_FOREIGN_WORK_PRESENT/);
  await assert.rejects(assertGradingGpuOwnership(123,{...probe,run:async()=>({stdout:'N/A'})}),/OWNERSHIP_UNVERIFIED/);
  await assert.rejects(assertGradingGpuOwnership(123,{...probe,read:async()=>'/unrelated/command'}),/OWNERSHIP_LOST/);
  for(const args of [['--run=false','--db=/not-opened','--run-id=eval_x','--grader-acceptance=accept_x'],
    ['--plan','--db','--run-id=eval_x','--grader-acceptance=accept_x'],['--run','--plan'],['--arbitrary=command']])
    await assert.rejects(main(args),/INVALID_GRADING_ARGUMENTS/);
});

test('two judges from the same model family never make an independent score',async()=>{
  const f=fixture();try {
    const source=f.collect(),first=f.store.record(f.grader()).id;
    const sameFamily={...secondJudgeArtifact,modelName:'qwen3.5:27b'};
    const second=f.store.record(f.grader(sameFamily)).id;
    for(const [id,artifact] of [[first,judgeArtifact],[second,sameFamily]]) {
      const summary=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,
        judge:fakeJudge(f,id,()=>{},artifact)});
      const saved=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary});
      assert.equal(saved.status,'BLOCKED');
    }
    assert.equal(f.history.getComplete({role:'D1',digestSha256:A,suiteName:f.plan.suiteName,
      suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256}),null);
    assert.equal(f.plan.acceptance.ready,false);
  }finally{f.db.close();}
});

test('equal total scores cannot hide opposing criterion grades',async()=>{
  const f=fixture();try {
    const source=f.collect(),first=f.store.record(f.grader()).id;
    const second=f.store.record(f.grader(secondJudgeArtifact)).id;
    const one=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:first,
      judge:fakeJudge(f,first)});
    persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:one});
    const two=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:second,
      judge:fakeJudge(f,second,()=>{},secondJudgeArtifact)});
    const part=two.tasks[0].details[0].parts[0];part.score=.5;part.rawScores=[.5,.5];
    assert.equal(two.score,one.score,'aggregate is unchanged');
    const saved=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:two});
    assert.equal(saved.status,'BLOCKED');assert.equal(saved.errorCode,'EVALUATION_GRADING_DISPUTE');
    assert.equal(saved.metadata.disputes[0].task,two.tasks[0].name);
    assert.equal(f.history.getComplete({role:'D1',digestSha256:A,suiteName:f.plan.suiteName,
      suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256}),null);
  }finally{f.db.close();}
});

test('a recorded first review is not repeated and immutable review rows cannot be rewritten',async()=>{
  const f=fixture();try {
    const source=f.collect(),id=f.store.record(f.grader()).id;let calls=0;
    const one=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,
      judge:fakeJudge(f,id)});
    const first=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:one});
    assert.equal(first.status,'BLOCKED');
    const second=f.store.record(f.grader(secondJudgeArtifact)).id;
    const options={history:f.history,plan:f.plan,runId:source.runId,call:fakeCall(()=>calls++),
      prepareJudge:async()=>{},finishJudge:async()=>{}};
    const completed=await gradeAcceptedCollection(options);
    assert.equal(completed.status,'COMPLETE');assert.equal(calls,48,'only the missing second judge ran');
    const again=await gradeAcceptedCollection(options);
    assert.equal(again.reused,true);assert.equal(calls,48);
    const row=f.db.prepare('SELECT review_id FROM model_evaluation_grader_reviews').get();
    assert.throws(()=>f.db.prepare('UPDATE model_evaluation_grader_reviews SET role=? WHERE review_id=?')
      .run('CHAT',row.review_id),/append-only/);
    assert.throws(()=>f.db.prepare('DELETE FROM model_evaluation_grader_reviews WHERE review_id=?')
      .run(row.review_id),/append-only/);
  }finally{f.db.close();}
});

test('persist rejects forged aggregate and swapped answer evidence before storing a review',async()=>{
  const f=fixture();try {
    const source=f.collect(),id=f.store.record(f.grader()).id;
    const genuine=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:id,
      judge:fakeJudge(f,id)});
    const badScore=structuredClone(genuine);badScore.score=.4;
    const badResponse=structuredClone(genuine);badResponse.tasks[0].responses[0]='forged';
    const badCriterion=structuredClone(genuine);badCriterion.tasks[0].scores[0]=0;
    for (const summary of [badScore,badResponse,badCriterion])
      assert.throws(()=>persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary}),
        /EVALUATION_GRADING_SUMMARY_INVALID/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM model_evaluation_grader_reviews').get().n,0);
    const saved=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:genuine});
    assert.equal(saved.errorCode,'EVALUATION_REVIEW_PENDING_PAIR');
  }finally{f.db.close();}
});

test('reviewed adjudication closes only exact criterion disputes and preserves both first reviews',async()=>{
  const f=fixture();try {
    const source=f.collect(),id=f.store.record(f.grader()).id;
    const second=f.store.record(f.grader(secondJudgeArtifact)).id;
    const firstGrade=await gradeAnswerCollection({plan:f.plan,collection:source,
      graderAcceptanceId:id,judge:fakeJudge(f,id)});
    persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:firstGrade});
    const differentCall=async(_model,messages,_options,artifact)=>{
      const data=JSON.parse(messages[1].content),count=data.criteria.length;
      const full=Array.from({length:count},(_,i)=>({criterion:i+1,score:1,evidence:'synthetic fact'}));
      const partial=full.map((row,i)=>({...row,score:i===0?.75:1}));
      const response=data.a==='synthetic response'?{a:partial,b:full}:{a:full,b:partial};
      return {done:true,doneReason:'stop',digestSha256:artifact.digestSha256,
        providerVersion:provider,content:JSON.stringify(response)};
    };
    const secondGrade=await gradeAnswerCollection({plan:f.plan,collection:source,
      graderAcceptanceId:second,
      judge:new SemanticEvaluationJudge({artifact:secondJudgeArtifact,
        isAccepted:()=>true,call:differentCall})});
    const disputed=persistGradedCollection({history:f.history,plan:f.plan,
      collection:source,summary:secondGrade});
    assert.equal(disputed.errorCode,'EVALUATION_GRADING_DISPUTE');
    const reviews=f.db.prepare('SELECT * FROM model_evaluation_grader_reviews ORDER BY recorded_at,review_id').all();
    const blind=buildBlindAdjudicationPacket(f.history,f.plan,source);
    assert.equal(blind.cases.length,disputed.metadata.disputes.length);
    assert.equal(blind.cases[0].response,'synthetic response');
    assert.equal(blind.decision.decisions[0].parts[0].score,null);
    assert.equal(JSON.stringify(blind).includes('qwen3.8'),false);
    assert.equal(JSON.stringify(blind).includes('gemma4'),false);
    const basis={schemaVersion:1,sourceRunId:source.runId,
      sourceSha256:disputed.metadata.grading?.sourceCollectionSha256
        || firstGrade.grading.sourceCollectionSha256,
      firstReviewId:reviews[0].review_id,secondReviewId:reviews[1].review_id,
      review:{reviewer:'Independent operator',reference:'fixture://human-evidence',
        reason:'Reviewed each contested criterion against the public task',
        reviewedAt:new Date().toISOString(),blindToModel:true,independent:true},
      decisions:disputed.metadata.disputes.map(d=>({
        task:d.task,repeat:d.repeat,
        parts:d.firstParts.map((part,i)=>({criterion:i+1,score:1,
          evidence:'Verified against the supplied task and captured response',
          reason:'The first judgement has direct supporting evidence'}))}))};
    const incomplete=structuredClone(basis);incomplete.decisions.pop();
    assert.throws(()=>persistAdjudicatedCollection({history:f.history,plan:f.plan,
      collection:source,decision:incomplete}),/EVALUATION_ADJUDICATION_INCOMPLETE/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM model_evaluation_grader_adjudications').get().n,0);
    const alteredConsensus=structuredClone(basis);
    alteredConsensus.decisions[0].parts[1].score=.75;
    assert.throws(()=>persistAdjudicatedCollection({history:f.history,plan:f.plan,
      collection:source,decision:alteredConsensus}),/EVALUATION_ADJUDICATION_CONSENSUS_CHANGED/);
    const saved=persistAdjudicatedCollection({history:f.history,plan:f.plan,
      collection:source,decision:basis});
    assert.equal(saved.status,'COMPLETE');assert.equal(saved.score,1);
    assert.equal(f.history.getComplete({role:'D1',digestSha256:A,suiteName:f.plan.suiteName,
      suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256})?.runId,saved.runId);
    assert.equal(saved.metadata.grading.adjudication.id.startsWith('adjudication_'),true);
    assert.equal(validStoredGradingPair(f.db,saved.metadata.grading,f.plan.acceptance.graders,
      A,f.plan.role,f.plan.suiteContractSha256,saved.score),true);
    assert.throws(()=>persistAdjudicatedCollection({history:f.history,plan:f.plan,
      collection:source,decision:basis}),/EVALUATION_ADJUDICATION_ALREADY_COMPLETE/);
    const row=f.db.prepare('SELECT adjudication_id FROM model_evaluation_grader_adjudications').get();
    assert.throws(()=>f.db.prepare('DELETE FROM model_evaluation_grader_adjudications WHERE adjudication_id=?')
      .run(row.adjudication_id),/append-only/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM model_evaluation_grader_reviews').get().n,2);
  }finally{f.db.close();}
});
