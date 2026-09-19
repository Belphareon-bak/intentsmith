import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAnswer, collectionSuite } from '../scripts/manual/role-collection-profile.mjs';
import { SEMANTIC_ROLE_SUITES } from '../src/eval/semantic-role-suites.js';
import { codePatchSuite } from '../src/eval/code-patch-suite.js';
import { visionV2Suite } from '../src/eval/role-quality-suites.js';
import { suiteContract } from '../src/upgrade/model-evaluation-history.js';

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
