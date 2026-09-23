import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { confidenceV2Task as task,confidenceV2Contract as contract,confidenceV2References as refs,
  confidenceV2Cases as cases,assessConfidenceV2Technical as assess,confidenceMeaningProbes as probes } from '../src/eval/code-confidence-v2.js';

test('new public task explicitly covers low-margin quality and invalid input domain, without disclosing references',()=>{
  assert.match(task.turns[0].content,/včetně ponechání pod prahem/);
  assert.match(contract.domain.excluded,/NaN/);assert.equal(task.independenceGroup,'pairwise-confidence');
  assert(!task.turns[0].content.includes('legacyDecision'));assert.equal(task.score,null);
  assert(cases.some(c=>c.comparison.margin===.01 && c.expected.confidence==='nízká (jediná úloha)'));
});
for(const [name,code] of Object.entries(refs)) test(`real isolated technical execution: ${name}`,()=>{
  const r=assess(code);
  assert.equal(r.technical.valid,true,JSON.stringify(r));
  assert.equal(r.technical.score,name==='broken'?4/24:1);
  assert.equal(r.score,null);assert.equal(r.passed,false);assert.equal(r.decisionAuthority,false);
});
test('below-threshold omission and incorrect confidence mapping fail executable checks',()=>{
  for(const code of [refs.gold.replace("if (result.basis === 'kvalita')", "if (result.basis === 'kvalita' && Math.abs(comparison.margin) >= threshold)"),
    refs.gold.replaceAll("'nízká (jediná úloha)'", "'vysoká'")]) {
    const r=assess(code);assert.equal(r.technical.valid,true,JSON.stringify(r));assert(r.technical.score<1);
  }
});
test('negated explanations remain unresolved despite full executable API score',()=>{
  const r=assess(refs.gold.replace("'; jistota rozhodnutí: ' + result.confidence", "'; neplatí jistota ' + result.confidence + '; skutečná jistota je jiná'"));
  assert.equal(r.technical.valid,true,JSON.stringify(r));assert.equal(r.technical.score,1);
  assert.equal(r.score,null);assert.equal(r.semantics.status,'REVIEW_REQUIRED');
});
test('development extraction probes cover negation, quotation and contradiction for each degree',()=>{
  assert.equal(probes.length,18);
  for(let i=0;i<3;i++){
    const p=probes.find(p=>p.id===`negation-${i}`);assert(p.text.includes('není'));assert(p.text.includes(p.expected.level));
    assert.equal(probes.find(p=>p.id===`contradiction-${i}`).expected.level,null);
    assert.equal(probes.find(p=>p.id===`unresolved-${i}`).expected.status,'UNRESOLVED');
  }
});
test('historical evidence fixture was not rewritten by execution',()=>{
  const bytes=readFileSync(new URL('../src/eval/code-suite-tasks.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'7faa4b7f1e7ea99c9e7c055b2df70031f63c1ab789c254823b247367a5eca95d');
});
