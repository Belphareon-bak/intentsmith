// Synthetic fixtures for the isolated lifecycle simulation only.
// No inference, real acceptance, production database or model selection occurs.
// Based on the independently exercised evaluation-grading-acceptance fixtures;
// fabricated evidence is restricted to a newly created simulation database.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { up } from '../../src/db/migrations/2026_09_19_116_model_evaluation_acceptance.js';
import { up as upReviews } from '../../src/db/migrations/2026_09_24_118_model_evaluation_grader_reviews.js';
import { up as upAdjudications } from '../../src/db/migrations/2026_09_25_119_model_evaluation_adjudications.js';
import { ModelEvaluationAcceptanceStore, acceptanceHash } from '../../src/upgrade/model-evaluation-acceptance.js';
import { ModelEvaluationHistory, suiteContract } from '../../src/upgrade/model-evaluation-history.js';
import { createRoleEvaluationPlans } from '../../src/eval/role-evaluation-plan.js';
import { semanticAcceptancePlanHash, semanticGraderContract } from '../../src/eval/semantic-grader-acceptance.js';
import { codePilotPlanHash } from '../../src/eval/code-pilot-decision.js';
const A='a'.repeat(64), B='b'.repeat(64), H='c'.repeat(64), J='d'.repeat(64), K='e'.repeat(64);
const provider='0.0.0-simulation-no-inference', judgeArtifact={modelName:'qwen2.5:simulation-judge-a',digestSha256:J,providerVersion:provider};
const secondJudgeArtifact={modelName:'gemma2:simulation-judge-b',digestSha256:K,providerVersion:provider};
const review={reviewer:'SIMULATED operator, not a human review',reference:'fixture://not-a-real-acceptance',reason:'authority regression test',
  reviewedAt:'2026-09-21T01:00:00Z',decision:'ACCEPTED'};
const envelope=(kind,evidence)=>({schemaVersion:1,kind,role:evidence.role,contractSha256:evidence.contractSha256,evidence,
  review:{...review,evidenceSha256:acceptanceHash(evidence)}});
function fixture(role='D1', databasePath=':memory:', customSuite=null, repeats=1) {
  const db=new Database(databasePath);up(db);
  db.exec(`CREATE TABLE model_evaluation_runs (run_id TEXT PRIMARY KEY,model_name TEXT,model_canonical_name TEXT,
    model_digest_sha256 TEXT,suite_name TEXT,suite_version TEXT,suite_contract_sha256 TEXT,role TEXT,status TEXT,
    score REAL,passed INTEGER,total INTEGER,repeats INTEGER,duration_ms INTEGER,tokens_per_second REAL,vram_bytes INTEGER,
    task_results_json TEXT,hardware_json TEXT,metadata_json TEXT,error_code TEXT,error_message TEXT,started_at TEXT,completed_at TEXT);
    CREATE TRIGGER keep_runs BEFORE UPDATE ON model_evaluation_runs BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  upReviews(db);upAdjudications(db);
  const basePlan=createRoleEvaluationPlans({db,codeRuntimeAvailability:{ready:true}})[role];
  const store=new ModelEvaluationAcceptanceStore(db), history=new ModelEvaluationHistory(db);history.setProviderVersion(provider);
  let plan=basePlan;
  if(customSuite) {
    const contract=suiteContract(customSuite,{version:customSuite.version,repeats,
      extra:{simulation:true,runtimeSha256:basePlan.qualificationRuntimeSha256}});
    const identity={role,suiteContractSha256:contract.sha256,taskNames:customSuite.tests.map(t=>t.name),
      runtimeSha256:basePlan.qualificationRuntimeSha256};
    plan={...basePlan,suite:customSuite,suiteName:customSuite.name,suiteVersion:customSuite.version,
      suiteContractSha256:contract.sha256,repeats,taskCount:customSuite.tests.length,collectionOnly:true,measurementReady:true,
      get acceptance(){return store.resolve(identity);},
      get decisionReady(){return this.acceptance.ready;},
      qualificationForRuns(ids){return this.decisionReady?store.forRuns(this,ids):null;}};
  }
  const base={role,contractSha256:plan.suiteContractSha256,runtimeSha256:plan.qualificationRuntimeSha256,
    ...(customSuite?{suiteName:customSuite.name}:{}),
    archiveSha256:H,status:'PASS',completedAt:'2026-09-21T00:30:00Z'};
  const tasks=plan.suite.tests.map(t=>({name:t.name,tier:t.tier || (role==='CODE'?'T1':'T2'),
    taskType:role,criterionCount:t.semanticReference?.criteria.length || t.rubric?.length,floor:t.tier==='T4'?.25:0,
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
  const collect=(contractSha256=plan.suiteContractSha256, artifact={modelName:'sim-answer:fixture',digestSha256:A}, response=()=> 'synthetic response')=>{
    const n=plan.taskCount*plan.repeats;
    return history.recordCollection({artifact,role,
      suiteName:plan.suiteName,suiteVersion:plan.suiteVersion,contractSha256,
      summary:{score:null,runs:plan.repeats,startedAt:'2026-09-21T00:00:00Z',completedAt:'2026-09-21T00:01:00Z',
        collection:{status:'AWAITING_REVIEW',planned:n,observed:n,captured:n,budgetExhausted:0,invalid:0},
        tasks:plan.suite.tests.map(t=>({name:t.name,input:t.prompt(),options:t.options,mean:null,scores:[],responses:Array.from({length:plan.repeats},(_,i)=>response(t,i)),
          details:Array.from({length:plan.repeats},(_,i)=>{
            const turns=t.prompt().conversationTurns;
            const transcript=turns?.flatMap(turn=>[turn,{role:'assistant',content:response(t,i)}]);
            return {repeat:i+1,captureStatus:'CAPTURED',gradingStatus:'NOT_GRADED',
              artifact:{digestSha256:artifact.digestSha256,providerVersion:provider},
              ...(transcript?{conversation:{status:'CAPTURED',plannedTurns:turns.length,completedTurns:turns.length,transcript,
                transcriptSha256:createHash('sha256').update(JSON.stringify(transcript)).digest('hex')}}:{})};
          })}))}});
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

export {fixture, operation, envelope, resign, provider, judgeArtifact, secondJudgeArtifact, A, B, H, J, K};
