import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { suite, test, testAsync, summary } from './harness.js';
import { SemanticEvaluationJudge, parseSemanticJudgement, semanticTask } from '../src/eval/semantic-evaluation-judge.js';
import { SEMANTIC_ROLE_SUITES } from '../src/eval/semantic-role-suites.js';
import { ModelEvaluationRunner } from '../src/eval/model-evaluation-runner.js';
import { RoleQualityEvaluationRunner } from '../src/eval/role-quality-suites.js';

const artifact={modelName:'fixture:latest',digestSha256:'a'.repeat(64),providerVersion:'test-provider'};
const task=semanticTask({name:'fixture',role:'D1',prompt:'A task',independenceGroup:'fixture',reference:{
  gold:'correct',alternative:'equivalent',criteria:['Respond correctly','Explain the cause'],
  controls:{'keyword-stuffing':'stuff','negated-facts':'negation','confident-wrong':'wrong'},
}});
const rows=(score)=>[1,2].map(criterion=>({criterion,score,evidence:score?'supported fact':'missing fact'}));
const goodCall=async(_model,messages)=>{
  const p=JSON.parse(messages[1].content);
  const value=answer=>['correct','equivalent'].includes(answer)?1:0;
  return {content:JSON.stringify({a:rows(value(p.a)),b:rows(value(p.b))}),doneReason:'stop'};
};

suite('semantic evaluation protocol and invalid-evidence propagation');
test('role inputs are different assignments, with pinned sources and explicit development status',()=>{
  for(const role of ['D1','D2','R1','R2']) {
    const s=SEMANTIC_ROLE_SUITES[role];assert.equal(s.tests.length,8);assert.equal(s.notAHoldout,true);
    assert.equal(new Set(s.tests.map(t=>t.independenceGroup)).size,8);
    assert.ok(s.tests.every(t=>t.tier==='T4' && t.contractMaterial.gradingInputs.provenance.fileSha256.length===64));
  }
  for(let i=0;i<8;i++) {
    assert.equal(new Set(['D1','D2','R1','R2'].map(r=>SEMANTIC_ROLE_SUITES[r].tests[i].promptText)).size,4);
    assert.match(SEMANTIC_ROLE_SUITES.R1.tests[i].promptText,/^--- a\//m);
    assert.match(SEMANTIC_ROLE_SUITES.R1.tests[i].promptText,/^\+\+\+ b\//m);
  }
  const chat=SEMANTIC_ROLE_SUITES.CHAT.tests;
  assert.equal(chat.length,40);assert.equal(chat.filter(t=>t.language==='en').length,24);
  assert.equal(chat.filter(t=>t.language==='cs').length,16);
});
test('malformed, partial, extra, reordered and out-of-range judgements fail closed',()=>{
  const valid={a:rows(1),b:rows(0)};
  assert.ok(parseSemanticJudgement(JSON.stringify(valid),2));
  for(const bad of ['', '{}', JSON.stringify({...valid,c:[]}),
    JSON.stringify({...valid,a:[rows(1)[0]]}),JSON.stringify({...valid,a:rows(1).reverse()}),
    JSON.stringify({...valid,a:rows(0.9)}),JSON.stringify({...valid,b:[{criterion:1,score:1,evidence:''},rows(1)[1]]})])
    assert.equal(parseSemanticJudgement(bad,2),null);
});
await testAsync('unqualified open answers have no score, including empty output',async()=>{
  const judge=new SemanticEvaluationJudge({call:goodCall,artifact});
  for(const answer of ['','correct']) {
    const r=await judge.grade(task,answer);assert.equal(r.valid,false);assert.equal(r.score,null);
    assert.equal(r.detail.reason,'SEMANTIC_JUDGE_NOT_QUALIFIED');
  }
  assert.equal((await task.grade('correct',{})).score,null);
});
await testAsync('all seven adversarial probes are checked in both orders before grading',async()=>{
  const receipts=[];
  const judge=new SemanticEvaluationJudge({call:goodCall,artifact,onReceipt:r=>receipts.push(r)});
  const calibration=await judge.qualify(task);
  assert.equal(calibration.status,'PASS');assert.equal(calibration.decisionAccepted,false);
  assert.equal(receipts.length,14);assert.equal(receipts.filter(r=>r.reverse).length,7);
  assert.equal((await judge.grade(task,'equivalent')).score,1);
  assert.equal((await judge.grade(task,'wrong')).score,0);
  assert.ok(receipts.every(r=>r.inputSha256.length===64 && r.artifact.digestSha256===artifact.digestSha256));
});
await testAsync('one admitted wrong answer prevents qualification; an editable score flag is not a bypass',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async()=>({doneReason:'stop',content:JSON.stringify({a:rows(1),b:rows(1)})})});
  assert.equal((await judge.qualify(task)).status,'FAIL');
  assert.equal((await judge.grade(task,'correct')).score,null);
});
await testAsync('a judge that rejects a correct alternative is not qualified',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async(model,messages)=>{
    const data=JSON.parse(messages[1].content);data.a=data.a==='equivalent'?'wrong':data.a;data.b=data.b==='equivalent'?'wrong':data.b;
    return goodCall(model,[messages[0],{content:JSON.stringify(data)}]);
  }});
  const c=await judge.qualify(task);assert.equal(c.status,'FAIL');assert.equal(c.probes.alternative.accepted,false);
});
await testAsync('position bias is missing evidence, not averaged model quality',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async()=>({doneReason:'stop',content:JSON.stringify({a:rows(1),b:rows(0)})})});
  const r=await judge.grade(task,'wrong',{calibration:true});assert.equal(r.valid,false);assert.equal(r.score,null);
});
await testAsync('agreed prerequisite failure keeps zero credit while preserving raw subordinate order drift',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async(_model,messages)=>{
    const data=JSON.parse(messages[1].content);
    const target=rows(0);target[1].score=data.a==='wrong'?0:1;
    return {doneReason:'stop',content:JSON.stringify(data.a==='wrong'?{a:target,b:rows(1)}:{a:rows(1),b:target})};
  }});
  const r=await judge.grade(task,'wrong',{calibration:true});
  assert.equal(r.valid,true);assert.equal(r.score,0);assert.equal(r.detail.disagreement,0);
  assert.equal(r.detail.rawDisagreement,1);assert.deepEqual(r.detail.parts[1].rawScores,[0,1]);
  assert.ok(r.detail.parts.every(p=>p.score===0));
});
await testAsync('disagreement on the prerequisite itself still blocks a superficially stable average',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async(_model,messages)=>{
    const data=JSON.parse(messages[1].content),target=rows(0);
    target[0].score=data.a==='wrong'?0:1;
    return {doneReason:'stop',content:JSON.stringify(data.a==='wrong'?{a:target,b:rows(1)}:{a:rows(1),b:target})};
  }});
  const r=await judge.grade(task,'wrong',{calibration:true});
  assert.equal(r.valid,false);assert.equal(r.score,null);assert.equal(r.detail.reason,'SEMANTIC_ORDER_UNSTABLE');
});
await testAsync('truncated judge generation is invalid even with parseable JSON',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async()=>({doneReason:'length',content:JSON.stringify({a:rows(1),b:rows(1)})})});
  assert.equal((await judge.grade(task,'correct',{calibration:true})).detail.reason,'SEMANTIC_JUDGE_RESPONSE_INVALID');
});
await testAsync('generic and production role runner preserve invalid/null and complete answer archives',async()=>{
  const answer='x'.repeat(8000);
  const invalidTask={name:'invalid',prompt:()=>'',rubric:[],grade:async()=>({valid:false,score:null,passed:false,detail:{reason:'UNKNOWN'}})};
  const s={name:'fixture',tests:[invalidTask]};
  for(const runner of [new ModelEvaluationRunner('',{suites:{fixture:s}}),new RoleQualityEvaluationRunner('',{roleSuites:{fixture:s}})]) {
    runner._callModel=async()=>({content:answer,evalCount:20,promptEvalCount:10,durationMs:1,doneReason:'stop'});
    const result=await runner.runSuite('fixture','fixture');
    assert.equal(result.valid,false);assert.equal(result.score,null);assert.equal(result.tests[0].score,null);
    assert.equal(result.tests[0].response,answer);assert.equal(result.tests[0].detail.reason,'UNKNOWN');
  }
});
await testAsync('judge requests a complete structured shape and HTTP runner transmits it only when requested',async()=>{
  let format;
  const judge=new SemanticEvaluationJudge({artifact,call:async(model,messages,options)=>{
    format=options.format;return goodCall(model,messages);
  }});
  assert.equal((await judge.qualify(task)).status,'PASS');
  assert.deepEqual(format.required,['a','b']);assert.equal(format.properties.a.minItems,2);
  const seen=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;seen.push(JSON.parse(body));
    res.setHeader('content-type','application/json');res.end(JSON.stringify({model:artifact.modelName,
      digest:artifact.digestSha256,provider_version:artifact.providerVersion,done:true,done_reason:'stop',message:{content:'{}'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const runner=new ModelEvaluationRunner('http://127.0.0.1:'+server.address().port);
    await runner._callModel(artifact.modelName,[],{format},artifact);
    await runner._callModel(artifact.modelName,[],{},artifact);
    assert.deepEqual(seen[0].format,format);assert.ok(!('format' in seen[1]));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
await testAsync('transport errors remain distinct from incorrect answers',async()=>{
  const runner=new ModelEvaluationRunner('');runner._callModel=async()=>({error:'ECONNRESET',durationMs:1});
  const row=await runner._runTest({name:'network',prompt:()=>'',grade:()=>{throw new Error('Must not grade');}},'fixture');
  assert.equal(row.valid,false);assert.equal(row.score,null);assert.equal(row.error,'ECONNRESET');
});
summary();
