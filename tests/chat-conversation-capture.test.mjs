import test from 'node:test';
import assert from 'node:assert/strict';
import { captureConversation } from '../src/eval/conversation-capture.js';
import { CHAT_CONVERSATION_FIXTURE as fixture, chatConversationDraft as suite, validateConversationFixture } from '../src/eval/chat-conversation-suite.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { ModelEvaluationHistory, suiteContract } from '../src/upgrade/model-evaluation-history.js';
import { ModelEvaluationReadModel } from '../src/upgrade/model-evaluation-read-model.js';
import { createHistoryCallbacks } from '../src/upgrade/model-upgrade-prototype.js';
import { collectRoleAnswers } from '../src/eval/model-answer-collection.js';
import { createBlindAnswerReview, renderConversationReview } from '../src/eval/model-answer-review.js';
import { prepareCollectionGrading } from '../src/eval/grade-answer-collection.js';

const artifact={digestSha256:'a'.repeat(64),providerVersion:'0.34.2-test'};
const turns=[{role:'user',content:'Initial question'},{role:'user',content:'Use your previous answer'}];
const reply=(content,rest={})=>({content,digestSha256:artifact.digestSha256,providerVersion:artifact.providerVersion,doneReason:'stop',...rest});

test('continuation receives the same candidate actual answer; another run starts clean',async()=>{
  const requests=[];
  for(const prefix of ['A','B']){
    const result=await captureConversation({turns,model:prefix,artifact,options:{},call:async(_m,m)=>{
      requests.push(structuredClone(m));return reply(prefix+' answer '+m.length);
    }});
    assert.equal(result.conversation.status,'CAPTURED');assert.equal(result.conversation.completedTurns,2);
    assert.equal(result.conversation.transcript[1].content,prefix+' answer 1');
    assert.equal(result.response,prefix+' answer 3');assert.equal(Object.hasOwn(result,'score'),false);
  }
  assert.deepEqual(requests[1],[turns[0],{role:'assistant',content:'A answer 1'},turns[1]]);
  assert.deepEqual(requests[2],[turns[0]]);
});
test('failed, truncated or identity-drifted intermediate turn stops before another provider call',async()=>{
  for(const bad of [reply('partial',{doneReason:'length'}),reply('untrusted',{digestSha256:'b'.repeat(64)}),reply('',{error:'timeout'})]){
    let calls=0;
    const r=await captureConversation({turns,model:'model',artifact,options:{},call:async()=>{calls++;return bad;}});
    assert.equal(calls,1);assert.equal(r.conversation.status,'PARTIAL');assert.notEqual(r.captureStatus,'CAPTURED');
    assert.equal(r.conversation.transcript.at(-1).content,bad.content);
  }
});
test('a later transport exception preserves earlier answers for review',async()=>{
  let calls=0;
  const r=await captureConversation({turns,model:'model',artifact,options:{},call:async()=>{
    if(++calls===2)throw Error('offline');return reply('first answer');
  }});
  assert.equal(r.captureStatus,'TRANSPORT_ERROR');assert.equal(r.conversation.completedTurns,1);
  assert.equal(r.conversation.transcript[1].content,'first answer');assert.equal(r.conversation.receipts[1].error,'offline');
});
test('rubrics, canned assistant replies and oversized conversations cannot reach the provider',async()=>{
  for(const bad of [[{role:'assistant',content:'gold'}],[{role:'user',content:'question',reference:'secret'}],Array(5).fill(turns[0])]){
    await assert.rejects(captureConversation({turns:bad,model:'model',artifact,options:{},call:()=>assert.fail('provider called')}),/CONVERSATION_INPUT_INVALID/);
  }
});
test('20 translations remain 20 groups and only one scenario requests strict JSON',()=>{
  assert.equal(suite.tests.length,40);assert.equal(new Set(suite.tests.map(t=>t.independenceGroup)).size,20);
  assert.equal(suite.tests.filter(t=>t.formatRubric.length).length,2);
  assert.equal(suite.tests.reduce((n,t)=>n+t.prompt().conversationTurns.length,0),116);
  for(const t of suite.tests){
    const payload=JSON.stringify(t.prompt());
    assert(!payload.includes('referenceChecks'));assert(!payload.includes('positiveExample'));
    assert.equal(t.grade().score,null);
  }
  assert.notEqual(createRoleEvaluationPlans().CHAT.suiteName,suite.name);
  assert.throws(()=>validateConversationFixture({...fixture,decisionReady:true}),/AUTHORITY/);
});
test('conversation survives actual DB/read-model/blind-export path, without becoming a last-answer-only grade',async()=>{
  const db=new Database(':memory:');await runMigrations(db);
  try {
    const selected={...suite,tests:suite.tests.slice(0,1)};
    const base=createRoleEvaluationPlans({db}).CHAT;
    // Explicit synthetic plan in an in-memory DB. The draft is not enabled in production.
    const plan={...base,suite:selected,suiteName:selected.name,suiteVersion:selected.version,
      suiteContractSha256:suiteContract(selected,{repeats:1}).sha256,taskCount:1,repeats:1};
    const history=new ModelEvaluationHistory(db);history.setProviderVersion(artifact.providerVersion);
    const inventory=[{name:'synthetic-model',digest:artifact.digestSha256,size:100,params:27}];
    let calls=0;
    const captured=await collectRoleAnswers({_callModel:async()=>reply('Answer '+(++calls))},'CHAT','synthetic-model',{
      ...createHistoryCallbacks({history,inventory}),evaluationPlan:plan});
    assert.equal(calls,3);assert.equal(captured.score,null);
    const detail=new ModelEvaluationReadModel(db,{plans:{CHAT:plan}}).readRun(captured.historyRunId);
    assert.equal(detail.tasks[0].details[0].conversation.transcript.length,6);
    const review=createBlindAnswerReview([detail]);
    assert.equal(review.review.items[0].conversation.transcript[1].content,'Answer 1');
    assert(!JSON.stringify(review.review).includes(artifact.digestSha256));
    assert(!JSON.stringify(review.review).includes('synthetic-model'));
    assert.equal(review.identityKey.identities[0].conversationReceipts.length,3);
    const collection=history.getRun(captured.historyRunId);
    const withConversationGrader={...plan,suite:{...plan.suite,tests:plan.suite.tests.map(t=>({...t,gradeConversation:()=>null}))},
      acceptance:{graders:[{id:'synthetic',judge:artifact}]}};
    assert.throws(()=>prepareCollectionGrading({plan:withConversationGrader,
      collection,graderAcceptanceId:'synthetic',judge:{artifact:{...artifact,digestSha256:'b'.repeat(64)}}}),/IDENTITY_MISMATCH/);
    const judge={...artifact,digestSha256:'b'.repeat(64)};
    assert.throws(()=>prepareCollectionGrading({plan:{...plan,acceptance:{graders:[{id:'synthetic',judge}]}},
      collection,graderAcceptanceId:'synthetic',judge:{artifact:judge}}),/CONVERSATION_GRADER_NOT_AVAILABLE/);
  } finally {db.close();}
});

test('review pages keep identity separate and preserve hostile text as inert data',()=>{
  const response='</script><img src=x onerror="alert(1)">';
  const review={items:[{id:'item',task:'cs_test',response,input:{conversationTurns:[]},criteria:[]}]};
  const identities={identities:[{id:'item',model:'secret-model',digestSha256:'b'.repeat(64)}]};
  const blind=renderConversationReview(review);const named=renderConversationReview(review,identities);
  assert(!blind.includes('secret-model'));assert(!blind.includes(response));
  const data=JSON.parse(/<script id="payload" type="application\/json">(.*?)<\/script>/s.exec(blind)[1]);
  assert.equal(data.items[0].response,response);assert.equal(data.identified,false);assert.equal(data.decisionAuthority,false);assert.match(data.reviewSha256,/^[a-f0-9]{64}$/);
  assert(named.includes('secret-model'));assert.throws(()=>renderConversationReview(review,{identities:[]}),/INPUT_INVALID/);
});
