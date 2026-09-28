import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { suite, test, testAsync, summary } from './harness.js';
import { SemanticEvaluationJudge, parseSemanticJudgement, semanticTask, calibrationProbeMetrics } from '../src/eval/semantic-evaluation-judge.js';
import { SEMANTIC_ROLE_SUITES } from '../src/eval/semantic-role-suites.js';
import { ModelEvaluationRunner } from '../src/eval/model-evaluation-runner.js';
import { RoleQualityEvaluationRunner } from '../src/eval/role-quality-suites.js';
import { hash, judgeMessages, parseJudge, referenceErrors, assertNotSelf, assertJudgeFamily, panelJobs, verifyPanelReceipt, EVIDENCE_FIRST, EVIDENCE_CHECKED, declaredEvidenceScores, checkPower } from '../scripts/manual/judge-panel-protocol.mjs';
import { assertResumableReceipt, finalizeJudgePanel } from '../scripts/manual/judge-panel-lifecycle.mjs';

const artifact={modelName:'fixture:latest',digestSha256:'a'.repeat(64),providerVersion:'test-provider'};
const proof={done:true,digestSha256:artifact.digestSha256,providerVersion:artifact.providerVersion};
const answerArtifact={...artifact,digestSha256:'b'.repeat(64)};
const task=semanticTask({name:'fixture',role:'D1',prompt:'A task',independenceGroup:'fixture',reference:{
  gold:'correct',alternative:'equivalent',criteria:['Respond correctly','Explain the cause'],
  controls:{'keyword-stuffing':'stuff','negated-facts':'negation','confident-wrong':'wrong'},
}});
const rows=(score)=>[1,2].map(criterion=>({criterion,score,evidence:score?'supported fact':'missing fact'}));
const goodCall=async(_model,messages)=>{
  const p=JSON.parse(messages[1].content);
  const value=answer=>['correct','equivalent'].includes(answer)?1:0;
  return {...proof,content:JSON.stringify({a:rows(value(p.a)),b:rows(value(p.b))}),doneReason:'stop'};
};

suite('semantic evaluation protocol and invalid-evidence propagation');
test('calibration error rates retain invalid and missing probes outside explicit valid denominators',()=>{
  const probes = { gold:{valid:true,score:1}, alternative:{valid:true,score:0.5},
    empty:{valid:true,score:0}, 'confident-wrong':{valid:true,score:0.8},
    'keyword-stuffing':{valid:false,score:null}, 'prompt-echo':{valid:true,score:0} };
  const metrics = calibrationProbeMetrics(probes);
  assert.deepEqual(metrics.positive,{expected:2,valid:2,invalid:0,wrong:1});
  assert.deepEqual(metrics.negative,{expected:5,valid:3,invalid:2,wrong:1});
  assert.equal(metrics.falseAcceptRate,1/3); assert.equal(metrics.falseRejectRate,0.5);
  assert.equal(metrics.complete,false);
  assert.equal(calibrationProbeMetrics({}).falseAcceptRate,null);
  assert.equal(calibrationProbeMetrics({}).falseRejectRate,null);
});
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
test('current analytic rubrics contain neither instruction points nor duplicate criteria',()=>{
  for (const role of ['D1','D2','R1','R2','CHAT']) for (const t of SEMANTIC_ROLE_SUITES[role].tests.filter(t=>t.tier==='T4')) {
    const ref=t.semanticReference;
    assert.equal(ref.rubricPolicy.revision,'content-rubric.5');
    assert.equal(ref.criterionIds.length,ref.criteria.length);
    assert.equal(new Set(ref.criterionIds).size,ref.criteria.length);
    assert.ok(ref.criteria.every(c=>!c.startsWith('Answers the request') && !c.startsWith('Answers the requested role')));
  }
  for (const t of SEMANTIC_ROLE_SUITES.R2.tests) {
    assert.equal(t.semanticReference.criteria.length,1,'finding and its reproduction must not count the same causal error twice');
  }
});
test('content calibration distinguishes a substantive wrong attempt from accepting it as correct',()=>{
  const probes=Object.fromEntries(['gold','alternative','empty','prompt-echo','keyword-stuffing','negated-facts','confident-wrong']
    .map(kind=>[kind,{valid:true,score:['gold','alternative'].includes(kind)?1:['negated-facts','confident-wrong'].includes(kind)?.25:0}]));
  assert.equal(calibrationProbeMetrics(probes,{contentPolicy:true}).falseAcceptRate,0);
  probes['confident-wrong'].score=.75;
  assert.equal(calibrationProbeMetrics(probes,{contentPolicy:true}).falseAcceptRate,.2);
  probes.empty.score=.25;
  assert.equal(calibrationProbeMetrics(probes,{contentPolicy:true}).falseAcceptRate,.4);
});
await testAsync('analytic rubric keeps independent credit after a failed first criterion and supports an ungradable response',async()=>{
  const current=semanticTask({name:'analytic',role:'D2',prompt:'A task',reference:{
    ...task.semanticReference,rubricPolicy:{revision:'content-rubric.5',instructions:['No global prerequisite.']},
  }});
  let format;
  const judge=new SemanticEvaluationJudge({artifact,call:async(_model,messages,options)=>{
    format=options.format;const data=JSON.parse(messages[1].content),target=rows(0);target[1].score=1;
    return {...proof,doneReason:'stop',content:JSON.stringify(data.a==='partial'?{a:target,b:rows(1)}:{a:rows(1),b:target})};
  }});
  const result=await judge.grade(current,'partial',{calibration:true});
  assert.equal(result.score,0.5);assert.equal(result.detail.parts[1].score,1);
  assert.deepEqual(format.anyOf[1].required,['ungradable','reason']);
  for(const score of [0.25,0.75]) assert.ok(parseSemanticJudgement(JSON.stringify({a:rows(score),b:rows(1)}),2));
  judge.call=async()=>({...proof,doneReason:'stop',content:JSON.stringify({ungradable:true,reason:'Caller contract absent'})});
  const missing=await judge.grade(current,'partial',{calibration:true});
  assert.equal(missing.valid,false);assert.equal(missing.score,null);
});
await testAsync('unqualified open answers have no score, including empty output',async()=>{
  const judge=new SemanticEvaluationJudge({call:goodCall,artifact});
  for(const answer of ['','correct']) {
    const r=await judge.grade(task,answer,{artifact:answerArtifact});assert.equal(r.valid,false);assert.equal(r.score,null);
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
  assert.equal((await judge.grade(task,'equivalent',{artifact:answerArtifact})).score,1);
  assert.equal((await judge.grade(task,'wrong',{artifact:answerArtifact})).score,0);
  assert.ok(receipts.every(r=>r.inputSha256.length===64 && r.artifact.digestSha256===artifact.digestSha256));
});
await testAsync('one admitted wrong answer prevents qualification; an editable score flag is not a bypass',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async()=>({...proof,doneReason:'stop',content:JSON.stringify({a:rows(1),b:rows(1)})})});
  assert.equal((await judge.qualify(task)).status,'FAIL');
  assert.equal((await judge.grade(task,'correct',{artifact:answerArtifact})).score,null);
});
await testAsync('a judge that rejects a correct alternative is not qualified',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async(model,messages)=>{
    const data=JSON.parse(messages[1].content);data.a=data.a==='equivalent'?'wrong':data.a;data.b=data.b==='equivalent'?'wrong':data.b;
    return goodCall(model,[messages[0],{content:JSON.stringify(data)}]);
  }});
  const c=await judge.qualify(task);assert.equal(c.status,'FAIL');assert.equal(c.probes.alternative.accepted,false);
});
await testAsync('position bias is missing evidence, not averaged model quality',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async()=>({...proof,doneReason:'stop',content:JSON.stringify({a:rows(1),b:rows(0)})})});
  const r=await judge.grade(task,'wrong',{calibration:true});assert.equal(r.valid,false);assert.equal(r.score,null);
});
await testAsync('agreed prerequisite failure keeps zero credit while preserving raw subordinate order drift',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async(_model,messages)=>{
    const data=JSON.parse(messages[1].content);
    const target=rows(0);target[1].score=data.a==='wrong'?0:1;
    return {...proof,doneReason:'stop',content:JSON.stringify(data.a==='wrong'?{a:target,b:rows(1)}:{a:rows(1),b:target})};
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
    return {...proof,doneReason:'stop',content:JSON.stringify(data.a==='wrong'?{a:target,b:rows(1)}:{a:rows(1),b:target})};
  }});
  const r=await judge.grade(task,'wrong',{calibration:true});
  assert.equal(r.valid,false);assert.equal(r.score,null);assert.equal(r.detail.reason,'SEMANTIC_ORDER_UNSTABLE');
});
await testAsync('truncated judge generation is invalid even with parseable JSON',async()=>{
  const judge=new SemanticEvaluationJudge({artifact,call:async()=>({...proof,doneReason:'length',content:JSON.stringify({a:rows(1),b:rows(1)})})});
  assert.equal((await judge.grade(task,'correct',{calibration:true})).detail.reason,'SEMANTIC_JUDGE_RESPONSE_INVALID');
});
await testAsync('confirmed target output-budget exhaustion is an operational failure, not a high-scoring answer prefix',async()=>{
  const definition={name:'bounded',prompt:()=>'',rubric:[],options:{num_predict:128},
    grade:()=>assert.fail('unfinished answer must not receive a content score')};
  for(const runner of [new ModelEvaluationRunner(''),new RoleQualityEvaluationRunner('')]) {
    runner._callModel=async()=>({content:'An apparently correct prefix',done:true,doneReason:'length',
      evalCount:128,promptEvalCount:20,durationMs:1,digestSha256:artifact.digestSha256,providerVersion:artifact.providerVersion});
    const result=runner instanceof RoleQualityEvaluationRunner
      ?await runner._runRoleTest(definition,artifact.modelName,artifact)
      :await runner._runTest(definition,artifact.modelName,artifact);
    assert.equal(result.outcome,'OPERATIONAL_FAILURE');assert.equal(result.valid,true);assert.equal(result.score,0);
    assert.equal(result.detail.reason,'MODEL_OUTPUT_BUDGET_EXHAUSTED');assert.equal(result.detail.outputTokenBudget,128);
    assert.equal(result.response,'An apparently correct prefix');assert.equal(result.artifact.digestSha256,artifact.digestSha256);
  }
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
suite('exploratory judge panel boundaries');
test('judge payload excludes identities, other grades and source metadata',()=>{
  const item={role:'CHAT',question:'Task',response:'Answer',rubric:['A','B'],model:'secret-model',answerDigest:'secret-digest',first:[.1,.2],second:[.3,.4]};
  const normal=judgeMessages(item),reverse=judgeMessages(item,true);
  assert.ok(!JSON.stringify(normal).includes('secret'));
  assert.deepEqual(Object.keys(JSON.parse(normal[1].content)),['role','question','criteria','context','answer']);
  assert.deepEqual(JSON.parse(reverse[1].content).criteria.map(x=>x.criterion),[2,1]);
});
test('incomplete generation, duplicate IDs, nonfinite scores and missing evidence never become grades',()=>{
  const result={done:true,doneReason:'stop',content:JSON.stringify({criteria:rows(.5)})};
  assert.equal(parseJudge(result,2).valid,true);
  for(const broken of [{...result,doneReason:'length'},{...result,content:JSON.stringify({criteria:[rows(1)[0],rows(1)[0]]})},
    {...result,content:JSON.stringify({criteria:rows(1).map(r=>({...r,score:null}))})},
    {...result,content:JSON.stringify({criteria:rows(1).map(r=>({...r,evidence:''}))})}])assert.equal(parseJudge(broken,2).valid,false);
});
test('unresolved reference disagreements remain separate and never manufacture a gold average',()=>{
  const r=referenceErrors(.5,0,1);assert.equal(r.referenceDispute,true);assert.equal(r.outsideBand,0);
  assert.equal(r.exactAnchor,false);assert.equal(r.anchorError,null);assert.equal(r.first,.5);assert.equal(r.second,.5);
  assert.equal(referenceErrors(.9,0,.25).falseAccept,true);assert.equal(referenceErrors(null,0,0),null);
});
test('self grading and full power both stop exploratory inference',()=>{
  assert.throws(()=>assertNotSelf({artifact},{answerDigest:artifact.digestSha256}),/SELF_GRADING/);
  assert.doesNotThrow(()=>assertNotSelf({artifact},{answerDigest:answerArtifact.digestSha256}));
  assert.throws(()=>checkPower({limitWatts:350}),/QUIET_POWER/);assert.throws(()=>checkPower({}),/QUIET_POWER/);
  assert.doesNotThrow(()=>checkPower({limitWatts:175}));
});
test('resume refuses a captured response without its matching post-call environmental receipt',()=>{
  const expected={planSha256:'plan-a',key:'job-a'},receipt={planSha256:'plan-a',judge:{digestSha256:'digest'}};
  const post={...expected,after:{placement:[{digest:'digest'}]},afterPower:{limitWatts:175}};
  assert.throws(()=>assertResumableReceipt(receipt,null,expected),/POSTCHECK_MISSING/);
  assert.throws(()=>assertResumableReceipt(receipt,{...expected,key:'job-b'},expected),/POSTCHECK_MISMATCH/);
  assert.throws(()=>assertResumableReceipt({planSha256:'plan-b'},expected,expected),/PLAN_MIX/);
  assert.throws(()=>assertResumableReceipt(receipt,expected,expected),/POSTCHECK_INCOMPLETE/);
  assert.doesNotThrow(()=>assertResumableReceipt(receipt,post,expected));
});
await testAsync('cleanup failures preserve the collection error and always write the final blocked checkpoint',async()=>{
  const events=[];
  const result=await finalizeJudgePanel({status:'COMPLETE',failure:new Error('ownership query failed'),
    close:async()=>{events.push('close');throw Error('provider unavailable');},
    release:()=>{events.push('release');throw Error('lock release failed');},
    checkpoint:r=>{events.push('checkpoint');assert.equal(r.status,'BLOCKED');assert.equal(r.failures.length,3);}});
  assert.deepEqual(events,['close','release','checkpoint']);
  assert.deepEqual(result.failures.map(f=>f.stage),['collection','provider-close','lease-release']);
  assert.equal(result.failures[0].message,'ownership query failed');
});
await testAsync('normal finalization preserves complete and budget-stop states',async()=>{
  for(const status of ['COMPLETE','BUDGET_STOP']){
    let saved;
    const result=await finalizeJudgePanel({status,close:async()=>{},release:()=>{},checkpoint:r=>{saved=r;}});
    assert.equal(saved.status,status);assert.equal(result,saved);assert.deepEqual(result.failures,[]);
  }
});
test('the collector CLI rejects an orphan receipt before probing or leasing any GPU',()=>{
  const directory=mkdtempSync(join(tmpdir(),'judge-orphan-'));
  try {
    mkdirSync(join(directory,'receipts'));mkdirSync(join(directory,'restricted'));
    writeFileSync(join(directory,'inputs.json'),'[]');writeFileSync(join(directory,'restricted/references.json'),'{}');
    const plan=JSON.stringify({models:[],sourceHashes:{},inputsSha256:hash('[]'),referencesSha256:hash('{}')});
    writeFileSync(join(directory,'plan.json'),plan);
    writeFileSync(join(directory,'receipts/orphan.json'),JSON.stringify({planSha256:hash(plan)}));
    const run=spawnSync(process.execPath,[new URL('../scripts/manual/run-judge-panel.mjs',import.meta.url).pathname,
      '--out='+directory,'--stage=screen','--expected-plan='+hash(plan)],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:''}});
    assert.equal(run.status,1);assert.match(run.stderr,/JUDGE_RECEIPT_POSTCHECK_MISSING:orphan/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('evidence-first profile preserves task data and requires evidence before the numerical score',()=>{
  const item={role:'CHAT',question:'Task',response:'Answer',rubric:['Check facts']};
  const before=judgeMessages(item),after=judgeMessages(item,false,EVIDENCE_FIRST);
  assert.equal(before[1].content,after[1].content);
  assert.match(after[0].content,/evidence BEFORE score/);
  const response=criteria=>({done:true,doneReason:'stop',content:JSON.stringify({criteria})});
  assert.equal(parseJudge(response([{criterion:1,evidence:'Verified',score:1}]),1,EVIDENCE_FIRST).valid,true);
  assert.equal(parseJudge(response([{criterion:1,score:1,evidence:'Verified'}]),1,EVIDENCE_FIRST).valid,false);
  assert.throws(()=>judgeMessages(item,false,'unknown'),/UNKNOWN_JUDGE_PROFILE/);
});
test('family exclusions block related authors and absent provenance independently of exact digest',()=>{
  assert.throws(()=>assertJudgeFamily({family:'qwen'},{answerFamily:'qwen'},'exclude-author-family'),/RELATED_AUTHOR/);
  assert.throws(()=>assertJudgeFamily({family:'mistral'},{},'exclude-author-family'),/FAMILY_UNKNOWN/);
  assert.doesNotThrow(()=>assertJudgeFamily({family:'mistral'},{answerFamily:'qwen'},'exclude-author-family'));
});
test('sensitivity audit retains missing low grades and separates author residual from raw grade',()=>{
  const script=`import importlib.util
s=importlib.util.spec_from_file_location('audit','scripts/manual/audit-judge-sensitivity.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=dict(group='g',task='t',caseId='c',criterion=1,first=.25,second=.5,author='a',score=None,model='j1')
x=m.summarize([base,dict(base,criterion=2,first=1,second=1,score=1)])
assert x['lowTotal']==1 and x['lowCaught']==0 and x['lowInvalid']==1
assert x['groupMAE']==0 and x['alwaysOneGroupMAEMatched']==0 and x['alwaysOneGroupMAEFull']>0
rows=[dict(base,score=.5),dict(base,model='j2',score=1)]
p=m.pair_summaries(rows)[0]
assert p['caughtEither']==1 and p['onlyA']==1 and p['onlyB']==0
boundary=[dict(base,first=.54,second=.29,score=.54)]
assert m.summarize(boundary)['groupMAE'] is not None
`;
  const result=spawnSync('python3',['-c',script],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('broad panels record family exclusions instead of silently grading self or counting missing scores',()=>{
  const models=[{name:'q1',family:'q',artifact:{digestSha256:'a'}},{name:'m1',family:'m',artifact:{digestSha256:'b'}}];
  const inputs=[{id:'x',role:'CHAT',reverse:true},{id:'y',role:'D2',reverse:false}];
  const refs={x:{answerDigest:'a',answerFamily:'q'},y:{answerDigest:'c',answerFamily:'q'}};
  const p=panelJobs(models,inputs,refs,'plan','exclude-author-family-recorded');
  assert.equal(p.jobs.length,3);assert.equal(new Set(p.jobs.map(j=>j.key)).size,3);
  assert.deepEqual(p.exclusions.map(e=>e.reason),['SELF_ARTIFACT','RELATED_AUTHOR_FAMILY']);
  assert.ok(p.jobs.every(j=>j.model.name==='m1'));
  assert.throws(()=>panelJobs(models,inputs,{...refs,y:{answerDigest:'c'}},'plan','exclude-author-family-recorded'),/FAMILY_UNKNOWN/);
  assert.throws(()=>panelJobs(models,inputs,refs,'plan','unrecognized'),/UNKNOWN_FAMILY_POLICY/);
  assert.throws(()=>panelJobs(models,inputs,{},'plan','exact-digest'),/IDENTITY_MISSING/);
});
test('archived judge scores are checked against raw output, full task payload and exact artifact',()=>{
  const model={name:'fixture',family:'test',artifact};
  const item={id:'case',role:'CHAT',stage:'screen',question:'What is 2+2?',response:'4',rubric:['Correct sum']};
  const job=panelJobs([model],[item],{case:{answerDigest:'other'}},'plan').jobs[0];
  const plan={maxPowerWatts:175,judgeProfile:EVIDENCE_FIRST};
  const messages=judgeMessages(item,false,EVIDENCE_FIRST);
  const result={...proof,doneReason:'stop',content:JSON.stringify({criteria:[{criterion:1,evidence:'2+2=4',score:1}]})};
  const receipt={planSha256:'plan',caseId:'case',stage:'screen',reverse:false,judge:artifact,messages,inputSha256:hash(messages),simulation:false,decisionAuthority:false,
    beforePower:{limitWatts:175},result,parsed:parseJudge(result,1,EVIDENCE_FIRST)};
  const post={planSha256:'plan',key:job.key,afterPower:{limitWatts:175},after:{placement:[{digest:artifact.digestSha256,size:1,size_vram:1,context_length:16384}]}};
  assert.equal(verifyPanelReceipt(receipt,post,job,plan,'plan').valid,true);
  const changed=structuredClone(receipt);changed.parsed.rows[0].score=0;
  assert.throws(()=>verifyPanelReceipt(changed,post,job,plan,'plan'),/STORED_GRADE/);
  assert.throws(()=>verifyPanelReceipt({...receipt,messages:[]},post,job,plan,'plan'),/CONTENT_MISMATCH/);
  assert.throws(()=>verifyPanelReceipt({...receipt,beforePower:{limitWatts:250}},post,job,plan,'plan'),/QUIET_POWER/);
  assert.throws(()=>verifyPanelReceipt({...receipt,result:{...result,digestSha256:'wrong'}},post,job,plan,'plan'),/ARTIFACT/);
});
test('authored technical controls reproduce executable facts and retain partial-credit cases',()=>{
  const controls=JSON.parse(readFileSync(new URL('../scripts/manual/judge-controls-20260928.json',import.meta.url),'utf8'));
  assert.equal(controls.length,12);assert.equal(new Set(controls.map(c=>c.group)).size,12);
  for(const c of controls){
    assert.equal(c.rubric.length,2);assert.deepEqual(c.variants.map(v=>v.expected),[[1,1],[1,0],[0,0]]);
    const r=spawnSync(process.execPath,['--input-type=module','-e',c.verification.script],{encoding:'utf8',timeout:5000});
    assert.equal(r.status,0,c.group+': '+r.stderr);assert.equal(r.stdout.trim(),c.verification.expectedStdout,c.group);
  }
});
test('v3 rejects contradictory explicit numeric verdicts without grading prose by keywords',()=>{
  const response=(evidence,score)=>({done:true,doneReason:'stop',content:JSON.stringify({criteria:[{criterion:1,evidence,score}]})});
  for(const evidence of ['No error. Score 1.0','Failure. Final score: 100%','Chybně. Známka: 0,75'])
    assert.match(parseJudge(response(evidence,0),1,EVIDENCE_CHECKED).reason,/CONTRADICTORY_DECLARED_SCORE/);
  for(const evidence of ['Checked. Score: 0.75','The answer says "Score 1.0". It is wrong.',
      '2 + 2 = 4; 75% of items were valid.','Not a score of 1.0: one requirement fails.','An unearned score 1.0 is inappropriate.'])
    assert.equal(parseJudge(response(evidence,.75),1,EVIDENCE_CHECKED).valid,true,evidence);
  assert.deepEqual(declaredEvidenceScores('Evidence. Score 0.75 because of a missing fact.'),[]);
  assert.deepEqual(declaredEvidenceScores('Evidence. Score 0.75.'),[.75]);
  assert.equal(parseJudge(response('Wrong. Score 1.0',0),1,EVIDENCE_FIRST).valid,true,'Archived v2 semantics unchanged');
  const item={role:'CHAT',question:'Task',response:'Answer',rubric:['Correctness']};
  assert.equal(judgeMessages(item,false,EVIDENCE_CHECKED)[1].content,judgeMessages(item,false,EVIDENCE_FIRST)[1].content);
});
test('pilot gate stops low-recall, incomplete and all-zero judges; author-gap filter is binding',()=>{
  const script=`import importlib.util
s=importlib.util.spec_from_file_location('pilot','scripts/manual/pilot-judge-gate.py');p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
rows=[]
for g in range(4):
 for i in range(8):
  low=i<3
  rows.append(dict(group=str(g),task=str(g),caseId=str(g),criterion=i,model='judge',author='a',first=0 if low else 1,second=0 if low else 1,score=0 if low else 1))
assert p.metrics_gate(rows,True,p.POLICY)['passed']
assert not p.metrics_gate(rows,False,p.POLICY)['passed']
assert not p.metrics_gate([dict(r,score=1) for r in rows],True,p.POLICY)['passed']
assert not p.metrics_gate([dict(r,score=0) for r in rows],True,p.POLICY)['passed']
assert not p.metrics_gate([dict(r,score=None) for r in rows],True,p.POLICY)['passed']
policy=dict(authors=['a','b'],maximumAbsoluteDistortion=.02,minimumGroups=4)
paired=[]
for r in rows:
 for a in ['a','b']:paired.append(dict(r,author=a,first=.75,second=.75,score=.77 if a=='a' else .75))
f=p.audit.author_gap_filter
assert f(paired,policy)['passed'],f(paired,policy)
assert not f([dict(r,score=.78 if r['author']=='a' else r['score']) for r in paired],policy)['passed']
assert not f([dict(r,score=None) if i==0 else r for i,r in enumerate(paired)],policy)['passed']
conflict=[dict(r,second=.8 if r['author']=='a' else .75) for r in paired]
assert 'AUTHOR_GAP_REFERENCE_ARBITRATION_REQUIRED' in f(conflict,policy)['reasons']
assert not f([r for r in paired if r['group']=='0'],policy)['passed']
`;
  const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('large CHAT collector is blocked before GPU use without a verified pilot',()=>{
  const directory=mkdtempSync(join(tmpdir(),'judge-pilot-gate-'));
  try {
    mkdirSync(join(directory,'receipts'));mkdirSync(join(directory,'restricted'));
    const inputs=JSON.stringify([{id:'c',stage:'screen',role:'CHAT',dataset:'chat-context-fixed'}]);
    const refs=JSON.stringify({c:{answerDigest:'other',answerFamily:'qwen'}});
    writeFileSync(join(directory,'inputs.json'),inputs);writeFileSync(join(directory,'restricted/references.json'),refs);
    const plan=JSON.stringify({models:[{name:'j',family:'other',artifact:{digestSha256:'judge'}}],sourceHashes:{},inputsSha256:hash(inputs),referencesSha256:hash(refs),judgeProfile:EVIDENCE_CHECKED});
    writeFileSync(join(directory,'plan.json'),plan);
    const run=spawnSync(process.execPath,[new URL('../scripts/manual/run-judge-panel.mjs',import.meta.url).pathname,
      '--out='+directory,'--stage=screen','--expected-plan='+hash(plan)],{encoding:'utf8',timeout:10000});
    assert.equal(run.status,1);assert.match(run.stderr,/CHAT_PILOT_REQUIRED/);assert.doesNotMatch(run.stderr,/QUIET_POWER_LIMIT_REQUIRED/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
summary();
