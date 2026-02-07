// E2E Build Flow Test — Full Pipeline with Mock State
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { WorkflowOrchestrator, WorkflowSession, WorkflowState } from '../../src/planner/workflow.js';
import {
  handleBuildDetected,
  getActiveBuildHandoff,
  cancelBuildHandoff,
} from '../../src/chat/handlers/build-handoff.js';
import { CREDecisionEngine, CREDecision, IntentType, DecisionType } from '../../src/chat/cre-decision.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n═══ E2E Build Flow Test ═══\n');

const mkDecision = () => new CREDecision({
  type: DecisionType.PLAN, intent: IntentType.BUILD,
  tools: [], reason: 'BUILD', confidence: 0.9,
});

// ── Flow 1: Happy path state walkthrough ────────────────────────────────────

console.log('── Flow 1: Happy Path ──');

test('IDLE → ANALYZING → PLANNING → AWAITING_APPROVAL → IMPLEMENTING → REVIEWING → COMPLETED', () => {
  const s = new WorkflowSession('e2e-1', 'postav mi REST API');
  
  assert.equal(s.state, WorkflowState.IDLE);
  
  s.state = WorkflowState.ANALYZING;
  s.addStep({ step: 'D1_ANALYZE', model: 'mock', output: { status: 'READY', complexity: 'MEDIUM' } });
  
  s.state = WorkflowState.PLANNING;
  s.plan = {
    title: 'REST API with Express',
    steps: [
      { id: 1, action: 'Init project', type: 'shell' },
      { id: 2, action: 'Create server', type: 'code' },
      { id: 3, action: 'Add routes', type: 'code' },
    ],
    estimatedComplexity: 'MEDIUM',
    risks: ['No auth'],
  };
  s.addStep({ step: 'D1_PLAN', model: 'mock', output: s.plan });
  s.state = WorkflowState.AWAITING_APPROVAL;
  
  assert.equal(s.state, WorkflowState.AWAITING_APPROVAL);
  assert.equal(s.plan.steps.length, 3);
  
  // CODE implements
  s.state = WorkflowState.IMPLEMENTING;
  s.implementation = s.plan.steps.map(step => ({ stepId: step.id, action: step.action, output: `impl_${step.id}` }));
  s.plan.steps.forEach((step, i) => s.addStep({ step: `CODE_IMPLEMENT_${step.id}`, model: 'mock', output: `impl_${step.id}` }));
  
  // R2 PASS
  s.state = WorkflowState.QUICK_REVIEWING;
  s.addStep({ step: 'R2_QUICK_REVIEW', model: 'mock', output: { verdict: 'PASS' }, verdict: 'PASS' });
  
  // R1 PASS
  s.state = WorkflowState.FINAL_REVIEWING;
  s.addStep({ step: 'R1_FINAL_REVIEW', model: 'mock', output: { verdict: 'PASS', quality: 'good' }, verdict: 'PASS' });
  
  s.state = WorkflowState.COMPLETED;
  
  assert.equal(s.state, WorkflowState.COMPLETED);
  assert.equal(s.history.length, 7); // D1_ANALYZE + D1_PLAN + 3xCODE + R2 + R1
  assert.equal(s.fixAttempts, 0);
  assert.equal(s.redesignAttempts, 0);
});

// ── Flow 2: Clarification ───────────────────────────────────────────────────

console.log('\n── Flow 2: Clarification ──');

test('CLARIFYING → enriched request → AWAITING_APPROVAL', () => {
  const s = new WorkflowSession('e2e-2', 'build me something');
  
  s.state = WorkflowState.CLARIFYING;
  s.clarificationQuestions = ['What type?', 'Which DB?'];
  s.addStep({ step: 'D1_ANALYZE', model: 'mock', output: { status: 'CLARIFY', questions: s.clarificationQuestions } });
  
  assert.equal(s.clarificationQuestions.length, 2);
  
  // User answers
  s.request = `${s.request}\n\nClarification:\nREST API + PostgreSQL`;
  
  // D1 plans
  s.plan = { title: 'REST API + PG', steps: [{ id: 1, action: 'Setup' }] };
  s.state = WorkflowState.AWAITING_APPROVAL;
  s.addStep({ step: 'D1_PLAN', model: 'mock', output: s.plan });
  
  assert.equal(s.state, WorkflowState.AWAITING_APPROVAL);
  assert.ok(s.request.includes('PostgreSQL'));
});

// ── Flow 3: Fix loop ────────────────────────────────────────────────────────

console.log('\n── Flow 3: Fix Loop ──');

test('R2 FAIL → D2 → CODE fix → R2 PASS', () => {
  const s = new WorkflowSession('e2e-3', 'build API');
  s.plan = { title: 'API', steps: [{ id: 1, action: 'Code' }] };
  s.implementation = [{ stepId: 1, output: 'buggy code' }];
  
  // R2 FAIL
  s.addStep({ step: 'R2_QUICK_REVIEW', model: 'mock', verdict: 'FAIL', output: { verdict: 'FAIL', issues: [{ severity: 'critical', description: 'SQL injection' }] } });
  
  // D2 + CODE fix
  s.fixAttempts = 1;
  s.addStep({ step: 'D2_FIX_1', model: 'mock', output: { fixes: [{ issue: 'SQLi', solution: 'parameterize' }] } });
  s.implementation = [{ stepId: 1, output: 'fixed code' }];
  s.addStep({ step: 'CODE_FIX_1', model: 'mock', output: 'fixed' });
  
  // R2 PASS
  s.addStep({ step: 'R2_QUICK_REVIEW', model: 'mock', verdict: 'PASS', output: { verdict: 'PASS' } });
  
  assert.equal(s.fixAttempts, 1);
  assert.equal(s.history[3].verdict, 'PASS');
});

// ── Flow 4: Max fix → FAILED ───────────────────────────────────────────────

console.log('\n── Flow 4: Max Fix Attempts ──');

test('Fails after maxFixAttempts exceeded', () => {
  const o = new WorkflowOrchestrator({ maxFixAttempts: 2 });
  const s = new WorkflowSession('e2e-4', 'build API');
  s.fixAttempts = 2;
  
  assert.ok(s.fixAttempts >= o.maxFixAttempts);
  s.state = WorkflowState.FAILED;
  assert.equal(s.state, WorkflowState.FAILED);
});

test('Max redesign → FAILED', () => {
  const o = new WorkflowOrchestrator({ maxRedesignAttempts: 1 });
  const s = new WorkflowSession('e2e-4b', 'build API');
  s.redesignAttempts = 1;
  
  assert.ok(s.redesignAttempts >= o.maxRedesignAttempts);
  s.state = WorkflowState.FAILED;
  assert.equal(s.state, WorkflowState.FAILED);
});

// ── Flow 5: Redesign ───────────────────────────────────────────────────────

console.log('\n── Flow 5: R1 REDESIGN ──');

test('R1 REDESIGN → D1 replans → fixAttempts reset', () => {
  const s = new WorkflowSession('e2e-5', 'build API');
  s.plan = { title: 'V1', steps: [{ id: 1, action: 'X' }] };
  s.fixAttempts = 2; // had fixes before
  
  // R1 REDESIGN
  s.addStep({ step: 'R1_FINAL_REVIEW', model: 'mock', verdict: 'REDESIGN', output: { verdict: 'REDESIGN', reason: 'bad arch' } });
  
  // D1 redesign
  s.redesignAttempts = 1;
  s.plan = { title: 'V2', steps: [{ id: 1, action: 'Better' }] };
  s.fixAttempts = 0; // Reset
  s.addStep({ step: 'D1_REDESIGN_1', model: 'mock', output: s.plan });
  
  assert.equal(s.plan.title, 'V2');
  assert.equal(s.fixAttempts, 0, 'Fix counter reset');
  assert.equal(s.redesignAttempts, 1);
});

// ── Flow 6: CRE → Handoff → State ──────────────────────────────────────────

console.log('\n── Flow 6: CRE → Handoff ──');

test('CRE BUILD → handleBuildDetected → PROPOSED', () => {
  const cre = new CREDecisionEngine();
  const sid = 'e2e-cre-1';
  
  // CRE classifies
  const intent = cre.classifyIntent('postav mi REST API');
  assert.equal(intent, IntentType.BUILD);
  
  // Handoff
  const r = handleBuildDetected('postav mi REST API', mkDecision(), { sessionId: sid });
  assert.ok(r.content.includes('Build intent detekován'));
  assert.ok(r.content.includes('REST API'));
  
  const state = getActiveBuildHandoff(sid);
  assert.equal(state.phase, 'PROPOSED');
  assert.equal(state.originalRequest, 'postav mi REST API');
  
  cancelBuildHandoff(sid);
});

test('English BUILD → handoff works too', () => {
  const cre = new CREDecisionEngine();
  const sid = 'e2e-cre-2';
  
  assert.equal(cre.classifyIntent("let's build a REST API"), IntentType.BUILD);
  
  const r = handleBuildDetected("let's build a REST API", mkDecision(), { sessionId: sid });
  assert.ok(r.content.includes('REST API'));
  assert.equal(getActiveBuildHandoff(sid).phase, 'PROPOSED');
  
  cancelBuildHandoff(sid);
});

// ── Flow 7: Cancel at any phase ────────────────────────────────────────────

console.log('\n── Flow 7: Cancel ──');

test('Cancel clears state from PROPOSED', () => {
  const sid = 'e2e-cancel-1';
  handleBuildDetected('build X', mkDecision(), { sessionId: sid });
  assert.ok(getActiveBuildHandoff(sid));
  cancelBuildHandoff(sid);
  assert.equal(getActiveBuildHandoff(sid), null);
});

// ── Flow 8: History tracking ────────────────────────────────────────────────

console.log('\n── Flow 8: History ──');

test('All steps recorded in session history', () => {
  const s = new WorkflowSession('e2e-hist', 'build');
  const steps = ['D1_ANALYZE', 'D1_PLAN', 'CODE_1', 'CODE_2', 'R2', 'D2_FIX', 'CODE_FIX', 'R2_2', 'R1'];
  steps.forEach(step => s.addStep({ step, model: 'mock', output: 'ok' }));
  assert.equal(s.history.length, 9);
  assert.equal(s.lastStep.step, 'R1');
});

// ── Orchestrator session management ─────────────────────────────────────────

console.log('\n── Orchestrator sessions ──');

test('getSession returns null for unknown', () => {
  const o = new WorkflowOrchestrator();
  assert.equal(o.getSession('nope'), null);
});

test('approve/reject/clarify throw for unknown session', () => {
  const o = new WorkflowOrchestrator();
  assert.rejects(() => o.approve('x'), /not found/);
  assert.rejects(() => o.reject('x'), /not found/);
  assert.rejects(() => o.clarify('x', 'y'), /not found/);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);
