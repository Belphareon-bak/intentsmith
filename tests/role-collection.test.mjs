import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAnswer, collectionSuite } from '../scripts/manual/role-collection-profile.mjs';
import { SEMANTIC_ROLE_SUITES } from '../src/eval/semantic-role-suites.js';
import { codePatchSuite } from '../src/eval/code-patch-suite.js';
import { visionV2Suite } from '../src/eval/role-quality-suites.js';
import { suiteContract } from '../src/upgrade/model-evaluation-history.js';
import Database from 'better-sqlite3';
import { ModelHuntState } from '../src/upgrade/model-hunt-state.js';
import { createBlindAnswerReview } from '../src/eval/model-answer-review.js';
import { runMigrations } from '../src/db/migrate.js';
import { ModelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { ModelEvaluationReadModel } from '../src/upgrade/model-evaluation-read-model.js';
import { createHistoryCallbacks, buildInstalledCandidateQueue } from '../src/upgrade/model-upgrade-prototype.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { collectRoleAnswers } from '../src/eval/model-answer-collection.js';

test('raw collection cannot grade, qualify or prepare a task; references never reach the model', async () => {
  const forbidden=()=>{throw new Error('grading side effect');};
  const task=collectionSuite('D1',{tests:[{name:'test',prompt:()=> 'actual input',
    options:{num_ctx:16384},grade:forbidden,prepare:forbidden,validateOracle:forbidden,
    semanticReference:{gold:'SECRET'}}]}).tests[0];
  let calls=0;
  const result=await collectAnswer(task,'model',{},async (_m,messages,options)=>{
    calls++;assert.deepEqual(messages,[{role:'user',content:'actual input'}]);
    assert.equal(options.num_predict,8192);
    return {content:'a response',doneReason:'stop',evalCount:12};
  });
  assert.equal(calls,1);assert.equal(result.captureStatus,'CAPTURED');
  assert.equal(result.gradingStatus,'NOT_GRADED');
  for(const k of ['score','passed','outcome','valid'])assert.equal(Object.hasOwn(result,k),false);
});
test('complete profile retains every task and hashes changed settings/prompts',()=>{
  const suites={...SEMANTIC_ROLE_SUITES,CODE:codePatchSuite,VISION:visionV2Suite};
  assert.equal(Object.values(suites).reduce((n,s)=>n+s.tests.length*3,0),306);
  for(const [role,suite] of Object.entries(suites)) {
    const profile=collectionSuite(role,suite);
    assert.deepEqual(profile.tests.map(t=>t.name),suite.tests.map(t=>t.name));
    assert.notEqual(suiteContract(profile,{repeats:3}).sha256,suiteContract(suite,{repeats:3}).sha256);
  }
});
test('confidence API and timeout preservation are explicit before capture, without changing old suites',()=>{
  const suite=collectionSuite('CODE',codePatchSuite);
  const confidence=suite.tests.find(t=>t.contractMaterial?.gradingInputs?.oracleCase==='f63d14d5eb61');
  assert.match(confidence.prompt().text,/řetězec, nikoli číslo/);
  assert.doesNotMatch(codePatchSuite.tests.find(t=>t.name===confidence.name).prompt().text,/řetězec, nikoli číslo/);
  assert.match(suite.tests.find(t=>t.name==='patch_adb1258cfec0').prompt().text,/před čtením response.json/);
});
test('images are sent as images and preserved without rubric leakage',async()=>{
  const task=collectionSuite('VISION',visionV2Suite).tests[0];
  await collectAnswer(task,'model',{},async (_m,messages)=>{
    assert.equal(messages.at(-1).images.length,1);
    assert.equal(messages.at(-1).content,task.prompt().text);
    assert.deepEqual(Object.keys(messages.at(-1)).sort(),['content','images','role']);
    return {content:'{}',doneReason:'stop'};
  });
});
test('length and transport failures retain evidence without inventing a score',async()=>{
  const task=collectionSuite('CHAT',SEMANTIC_ROLE_SUITES.CHAT).tests[0];
  for(const [raw,status] of [[{content:'partial',doneReason:'length'},'OUTPUT_BUDGET_EXHAUSTED'],
    [{content:'',error:'timeout',timedOut:true},'TRANSPORT_ERROR']]) {
    const row=await collectAnswer(task,'model',{},async()=>raw);
    assert.equal(row.captureStatus,status);assert.equal(row.response,raw.content);
    assert.equal(Object.hasOwn(row,'score'),false);
  }
});
test('artifact and provider failures propagate instead of becoming model grades',async()=>{
  const task=collectionSuite('CHAT',SEMANTIC_ROLE_SUITES.CHAT).tests[0];
  await assert.rejects(collectAnswer(task,'model',{},async()=>{throw new Error('ARTIFACT_DRIFT');}),/ARTIFACT_DRIFT/);
});

test('product collection is durable, inspectable, reusable and never score/decision evidence',async()=>{
  const db=new Database(':memory:');await runMigrations(db);
  try {
    const history=new ModelEvaluationHistory(db);history.setProviderVersion('0.34.2-intentsmith.1');
    const plans=createRoleEvaluationPlans({db});
    const source=plans.D1;
    const plan={...source, repeats:2, taskCount:2, suite:{...source.suite, tests:source.suite.tests.slice(0,2).map(t=>({...t,
      grade(){throw Error('judge must never execute');},prepare(){throw Error('oracle must never execute');}}))}};
    plan.suiteContractSha256=suiteContract(plan.suite,{repeats:2}).sha256;
    const inventory=[{name:'fixture:latest',digest:'a'.repeat(64),size:100,params:27}];
    const callbacks=createHistoryCallbacks({history,inventory});
    let calls=0;const events=[];
    const runner={async _callModel(model,messages,options,artifact){
      calls++;assert.equal(options.num_ctx,16384);assert.equal(options.num_predict,8192);
      assert.equal(messages.length,1);assert.equal(messages[0].role,'user');
      return {content:'answer '+calls,doneReason:calls===2?'length':'stop',
        digestSha256:artifact.digestSha256,providerVersion:artifact.providerVersion,durationMs:1,evalCount:3};
    }};
    const options={...callbacks,evaluationPlan:plan,onProgress:e=>events.push(e)};
    const result=await collectRoleAnswers(runner,'D1','fixture:latest',options);
    assert.equal(calls,4);assert.equal(history.count(),4);assert.equal(result.score,null);
    assert.equal(result.collection.status,'AWAITING_REVIEW');assert.equal(result.collection.budgetExhausted,1);
    assert.equal(events.at(-1).percent,100);
    const key={digestSha256:inventory[0].digest,role:'D1',suiteName:plan.suiteName,suiteVersion:plan.suiteVersion,contractSha256:plan.suiteContractSha256};
    assert.equal(history.getComplete(key),null);assert.equal(history.getTerminal(key),null);
    assert.equal(history.getCollection(key).runId,result.historyRunId);
    assert.equal(history.getCollection({...key,contractSha256:'b'.repeat(64)}),null);
    const readModel=new ModelEvaluationReadModel(db,{plans:{D1:plan}});
    const read=readModel.read({inventory,providerVersion:history.providerVersion});
    assert.equal(read.roles.D1.artifacts[0].status,'AWAITING_REVIEW');assert.equal(read.roles.D1.artifacts[0].score,null);
    assert.equal(read.history.length,1);assert.equal(read.roles.D1.decisionReady,false);
    const detail=readModel.readRun(result.historyRunId);
    const bundle=createBlindAnswerReview([detail]);
    assert.equal(bundle.review.items.length,4);assert.equal(bundle.identityKey.identities.length,4);
    assert(!JSON.stringify(bundle.review).includes('fixture:latest'));
    assert(!JSON.stringify(bundle.review).includes(inventory[0].digest));
    assert(bundle.review.items.every(i=>i.score===null && i.input.text && i.criteria.length));
    assert.throws(()=>createBlindAnswerReview([{...detail,status:'COMPLETE'}]),/ungraded/);
    assert.deepEqual(detail.tasks[0].responses,['answer 1','answer 3']);
    assert.equal(detail.tasks[0].input.text,plan.suite.tests[0].prompt().text);
    assert.equal(detail.tasks[1].details[0].captureStatus,'OUTPUT_BUDGET_EXHAUSTED');
    assert.equal(buildInstalledCandidateQueue({candidates:inventory,roles:['D1'],plans:{D1:plan},history,bindings:{}}).length,0);
    const scheduler=new ModelHuntState(db);
    const [candidate]=scheduler.observe([{name:'fixture:latest',roles:['D1'],artifact:{digestSha256:inventory[0].digest}}],{initialize:true});
    const evaluationKey=scheduler.evaluationKey(candidate,history.providerVersion,{D1:plan},{});
    scheduler.record(candidate,evaluationKey,{stage:'done',trials:[{role:'D1',evaluation:result}]});
    assert.equal(scheduler.pending(candidate,evaluationKey),false,'completed collection must not repeat every night');
    scheduler.record(candidate,'partial',{stage:'done',trials:[{role:'D1',evaluation:{...result,collection:{...result.collection,status:'COLLECTION_PARTIAL'}}}]},'2026-09-20T00:00:00Z');
    assert.equal(scheduler.pending(candidate,'partial',Date.parse('2026-09-22T00:00:00Z')),true);

    const reused=await collectRoleAnswers(runner,'D1','fixture:latest',options);
    assert.equal(reused.reused,true);assert.equal(calls,4);
    await collectRoleAnswers(runner,'D1','fixture:latest',{...options,fresh:true});assert.equal(calls,8);
    history.setProviderVersion('0.34.2-intentsmith.2');assert.equal(history.getCollection(key),null);
    assert.throws(()=>db.prepare('DELETE FROM model_evaluation_runs').run(),/append-only/);
  } finally {db.close();}
});

test('transport or digest failure preserves partial answers and cannot suppress a retry',async()=>{
  const db=new Database(':memory:');await runMigrations(db);
  try {
    const history=new ModelEvaluationHistory(db);history.setProviderVersion('0.34.2-intentsmith.1');
    const plan=createRoleEvaluationPlans({db}).D2;
    const inventory=[{name:'fixture',digest:'a'.repeat(64),params:27}];
    const callbacks=createHistoryCallbacks({history,inventory});let calls=0;
    const result=await collectRoleAnswers({async _callModel(_m,_messages,_options,a){
      if(++calls===2)throw Object.assign(Error('changed'),{code:'MODEL_EVALUATION_RESPONSE_ARTIFACT_DRIFT'});
      return {content:'preserved',doneReason:'stop',digestSha256:a.digestSha256,providerVersion:a.providerVersion};
    }},'D2','fixture',{...callbacks,evaluationPlan:plan});
    assert.equal(calls,2);assert.equal(result.collection.status,'COLLECTION_PARTIAL');assert.equal(result.collection.invalid,1);
    assert.equal(result.tasks[0].responses[0],'preserved');assert.equal(history.count(),2);
    assert.equal(await callbacks.loadCollection({role:'D2',artifact:{digestSha256:inventory[0].digest},suiteName:plan.suiteName,suiteVersion:plan.suiteVersion,suiteContractSha256:plan.suiteContractSha256}),null);
    assert.equal(buildInstalledCandidateQueue({candidates:inventory,roles:['D2'],plans:{D2:plan},history,bindings:{}}).length,1);
    const changed=structuredClone(result);changed.collection.status='AWAITING_REVIEW';
    assert.throws(()=>history.recordCollection({summary:changed,artifact:{modelName:'fixture',digestSha256:inventory[0].digest}}),/invalid/);
  }finally{db.close();}
});
