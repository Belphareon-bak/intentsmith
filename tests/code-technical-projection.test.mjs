import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { projectConfidenceTests, executableComponent, CONFIDENCE_CASE } from '../src/eval/code-technical-projection.js';
import { summarizeExecutable } from '../src/eval/code-technical-replay.js';
import { applyAndTest } from '../src/eval/code-patch-runner.js';

test('projection removes only the four audited prose statements and preserves API assertions',()=>{
  const original=execFileSync('git',['show','f8ac2c31:tests/pairwise-trial.test.js'],{encoding:'utf8'});
  const result=projectConfidenceTests(original);
  assert.equal(result.deferredAssertions.length,4);
  assert(result.text.includes("assertEqual(two.confidence, 'střední')"));
  assert(result.text.includes("assertEqual(d.winner, 'candidate')"));
  assert.throws(()=>projectConfidenceTests(result.text),/SOURCE_DRIFT/);
  assert.throws(()=>projectConfidenceTests(original+result.deferredAssertions[0]),/SOURCE_DRIFT/);
});
test('a full technical score never authorizes a full task pass, including contradictory prose',()=>{
  const result=executableComponent({valid:true,score:1,passed:true},{oracleCase:CONFIDENCE_CASE});
  assert.equal(result.score,null);assert.equal(result.valid,false);assert.equal(result.passed,false);
  assert.equal(result.technical.score,1);assert.equal(result.semantics.status,'REVIEW_REQUIRED');
  assert.equal(result.decisionAuthority,false);
  assert.throws(()=>applyAndTest('.',{},[],{oracleProfile:'unknown'}),/PROFILE_UNKNOWN/);
});
test('an unmeasured component blocks the complete mean and remains in coverage',()=>{
  const items=[{model:'a',task:'x',assessment:executableComponent({score:1},{})},
    {model:'a',task:'x',assessment:executableComponent({score:null},{})},
    {model:'a',task:'y',assessment:executableComponent({score:0},{})}];
  const [summary]=summarizeExecutable(items);
  assert.equal(summary.technicalMean,null);assert.equal(summary.attempts,3);assert.equal(summary.missing,1);
  assert.equal(summary.fullTaskScore,null);assert.equal(summary.tasks[1].mean,0);
});
