// Operator repair request 2026-09-20: truthful test contracts and no fresh T5 scores.
import assert from 'node:assert/strict';
import {suite,test,testAsync,summary} from './harness.js';
import {SEMANTIC_ROLE_SUITES} from '../src/eval/semantic-role-suites.js';
import {gradeStructuredAnswer} from '../src/eval/structured-answer.js';
import {createRoleEvaluationPlans} from '../src/eval/role-evaluation-plan.js';
import {RoleQualityEvaluationRunner,visionV2Suite} from '../src/eval/role-quality-suites.js';
suite('reviewed evaluation repair');
test('structured content and strict JSON protocol are independent observations',()=>{
 const expected={total:12,known:false,missing:null};
 const fenced=gradeStructuredAnswer('```json\n'+JSON.stringify(expected)+'\n```',expected);
 assert.equal(fenced.score,1);assert.equal(fenced.detail.formatScore,0);assert.equal(fenced.passed,false);
 assert.equal(gradeStructuredAnswer(JSON.stringify({...expected,total:'12'}),expected).score,2/3);
 assert.equal(gradeStructuredAnswer('Everything passed '+JSON.stringify(expected),expected).score,0);
 assert.equal(gradeStructuredAnswer(JSON.stringify({...expected,invented:1}),expected).detail.formatScore,0);
 assert.equal(gradeStructuredAnswer(JSON.stringify(expected),expected).passed,true);
});
test('manual content rubrics cannot award or remove a content point for JSON wrapping',()=>{
 for(const t of SEMANTIC_ROLE_SUITES.CHAT.tests){
  assert.ok(Array.isArray(t.formatRubric),t.name);
  assert.ok(!t.rubric.some(c=>/no Markdown or prose|without removing a Markdown fence|exact three keys/.test(c)),t.name);
 }
 const grammar=SEMANTIC_ROLE_SUITES.CHAT.tests.find(t=>t.name==='cz_grammar_correction');
 assert.equal(grammar.rubric.length,5);assert.equal(grammar.formatRubric.length,1);
 assert.match(grammar.promptText,/následujících čtyřech větách/);
 const state=SEMANTIC_ROLE_SUITES.CHAT.tests.find(t=>t.name==='en_state_updates');
 assert.equal(state.rubric.length,2);assert.equal(state.formatRubric.length,1);
 const wrong=state.grade('{"open_ids":["B"],"open_points":13}');
 assert.equal(wrong.detail.contentScore,0);assert.equal(wrong.detail.formatScore,1);
 assert.equal(state.grade('').score,0);
});
test('ambiguous project fixture detects a swapped project total',()=>{
 const t=SEMANTIC_ROLE_SUITES.CHAT.tests.find(t=>t.name==='cz_ambiguity_clarification');
 assert.match(t.promptText,/\[B,Y,hotovo,7\]/);
 const correct={potrebuje_upresneni:true,varianty:{X:5,Y:7},zvoleny_projekt:null};
 assert.equal(t.grade(JSON.stringify(correct)).score,1);
 const swapped=t.grade(JSON.stringify({...correct,varianty:{X:7,Y:5}}));
 assert.equal(swapped.detail.criteria.find(c=>c.id==='varianty').score,0);
 assert.equal(swapped.passed,false);
});
test('assertion sets separate sentence punctuation from facts and do not invent ordering',()=>{
 const e={verified:['cache reset completed.','5 of 8 replay batches passed.']};
 const rules={verified:'literal-assertion-set'};
 const g=gradeStructuredAnswer(JSON.stringify({verified:['5 of 8 replay batches passed','cache reset completed']}),e,rules);
 assert.equal(g.score,1);assert.equal(g.detail.formatScore,0);assert.equal(g.passed,false);
 assert.equal(gradeStructuredAnswer(JSON.stringify({verified:[...e.verified].reverse()}),e,rules).passed,true);
 for(const verified of [['cache reset did NOT complete.','5 of 8 replay batches passed.'],['cache reset completed.'],['cache reset completed.','cache reset completed.']])
  assert.equal(gradeStructuredAnswer(JSON.stringify({verified}),e,rules).score,0);
});
test('closed weekday and mode labels do not acquire an unstated capitalization rule',()=>{
 for(const [name,field,correct,wrong] of [
  ['en_multi_correction','eu_day','THURSDAY','Tuesday'],
  ['en_multi_correction','us_day','wednesday','Thursday'],
  ['cz_exact_bullets','rezim','Automatický','ruční'],
  ['cz_context_correction','termin','Čtvrtek','středa'],
  ['cz_conditional_deadline','den','Středa','Úterý'],
 ]){
  const t=SEMANTIC_ROLE_SUITES.CHAT.tests.find(t=>t.name===name),e=t.contractMaterial.gradingInputs.expected;
  assert.equal(t.grade(JSON.stringify({...e,[field]:correct})).passed,true,name);
  for(const bad of [wrong,42,null])assert.ok(t.grade(JSON.stringify({...e,[field]:bad})).score<1,name);
 }
 const exact=SEMANTIC_ROLE_SUITES.CHAT.tests.find(t=>t.name==='cz_coherent_status_paragraph');
 const e=exact.contractMaterial.gradingInputs.expected;
 assert.ok(exact.grade(JSON.stringify({...e,dalsi_krok:'Opravit testy'})).score<1,'explicitly literal fields stay literal');
});
await testAsync('structured fields are exact while open grammar remains ungraded',async()=>{
 const tasks=SEMANTIC_ROLE_SUITES.CHAT.tests.filter(t=>t.tier==='T2');assert.equal(tasks.length,19);
 for(const t of tasks){
  const e=t.contractMaterial.gradingInputs.expected;
  assert.equal(t.grade(JSON.stringify(e)).passed,true,t.name);
  assert.equal(t.grade(JSON.stringify(Object.fromEntries(Object.entries(e).reverse()))).passed,true,t.name);
  for(const key of Object.keys(e))assert.ok(t.grade(JSON.stringify({...e,[key]:'__wrong__'})).score<1,t.name+'/'+key);
  assert.equal(t.grade(t.promptText).score,0,t.name);
 }
 const grammar=SEMANTIC_ROLE_SUITES.CHAT.tests.find(t=>t.name==='cz_grammar_correction');
 assert.equal(grammar.tier,'T4');
 const g=await grammar.grade(JSON.stringify({vety:['Dvě velká okna zůstala otevřena.','Tři nové kolegyně přišly včas.','Oba vedoucí byli připraveni.','Pět kontrol skončilo úspěšně.']}));
 assert.equal(g.valid,false);assert.equal(g.score,null);
});
test('reviewed missing context is delivered, not just kept in hidden metadata',()=>{
 for(const role of ['D1','D2','R1','R2'])for(const name of ['model_lease','model_cleanup','immutable_refinement','pairwise_confidence']){
  const t=SEMANTIC_ROLE_SUITES[role].tests.find(t=>t.name===role.toLowerCase()+'_'+name);
  const context=t.contractMaterial.gradingInputs.provenance.additionalContext;
  assert.ok(context.length);for(const file of context)assert.ok(t.promptText.includes(file.text));
 }
 const d2=SEMANTIC_ROLE_SUITES.D2.tests.find(t=>t.name==='d2_immutable_refinement');
 assert.match(d2.rubric[2],/separate finalContent/);assert.match(d2.rubric[3],/Any evidenced shortcut/);
});
test('VISION has broad image coverage and does not call partial JSON a complete pass',()=>{
 const images=visionV2Suite.tests.flatMap(t=>t.contractMaterial.prompt.imageDigests||[]);
 assert.equal(new Set(images).size,22);
 for(const t of visionV2Suite.tests){const e=t.contractMaterial.gradingInputs.expected;const g=t.grade(JSON.stringify(e));assert.equal(g.passed,true,t.name);
  assert.equal(t.grade('```json\n'+JSON.stringify(e)+'\n```').passed,false,t.name);
  const first=Object.keys(e)[0];assert.equal(t.grade(JSON.stringify({...e,[first]:'WRONG'})).passed,false,t.name);
 }
});
test('legacy T5 production plans cannot measure or decide, history is not rewritten',()=>{
 const plans=createRoleEvaluationPlans();for(const role of ['D1','D2','R1','R2','CHAT']){assert.equal(plans[role].measurementReady,false);assert.equal(plans[role].runtimeBlockCode,'EVALUATOR_T5_FORBIDDEN');assert.equal(plans[role].decisionReady,false);}
});
await testAsync('calling the production runner directly cannot bypass the legacy prohibition',async()=>{
 const r=new RoleQualityEvaluationRunner();let calls=0;r._callModel=()=>{calls++;throw Error('unexpected inference')};
 for(const name of ['chat_v3','reasoning_v2','review_v2'])await assert.rejects(()=>r.runSuite(name,'fixture'),e=>e.code==='EVALUATOR_T5_FORBIDDEN');assert.equal(calls,0);
});
summary();
