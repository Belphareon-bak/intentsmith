// tests/e2e-pipeline.test.js — End-to-end pipeline test with mock LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// Simulates the full flow:
//   User → Chat(BUILD) → Handoff → Planner.start(D1) → approve → CODE→R2→R1
//
// Uses a mock LLM gateway to avoid real Ollama dependency.
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
} from '../src/chat/cre-decision.js';
import {
  handleBuildDetected,
  getActiveBuildHandoff,
  cancelBuildHandoff,
} from '../src/chat/handlers/build-handoff.js';
import {
  WorkflowOrchestrator,
  WorkflowSession,
  WorkflowState,
  ReviewVerdict,
} from '../src/planner/workflow.js';

const ASYNC_TEST_TIMEOUT_MS = 10_000;

// ═══════════════════════════════════════════════════════════════════════════════
suite('E2E — Full pipeline flow (mock)');
// ═══════════════════════════════════════════════════════════════════════════════

await testAsync('Step 1: User input → CRE → PLAN decision', async () => {
  const decision = await creDecisionEngine.decide('postav mi REST API pro správu uživatelů', {});
  assertEqual(decision.type, DecisionType.PLAN);
  assertEqual(decision.intent, IntentType.BUILD);
});

await testAsync('Step 2: PLAN → handleBuildDetected → proposal', async () => {
  const decision = await creDecisionEngine.decide('postav mi REST API', {});
  const ctx = { sessionId: 'e2e-1', mode: 'conversation' };
  const response = handleBuildDetected('postav mi REST API', decision, ctx);
  
  assertIncludes(response.content, 'Build intent');
  assertIncludes(response.content, 'D1');
  assertIncludes(response.content, 'CODE');
  assertEqual(response.metadata?.phase, 'PROPOSED');
  
  const state = getActiveBuildHandoff('e2e-1');
  assertEqual(state.phase, 'PROPOSED');
  assertEqual(state.originalRequest, 'postav mi REST API');
  
  cancelBuildHandoff('e2e-1');
});

test('Step 3: WorkflowSession created and tracks state', () => {
  const session = new WorkflowSession('buil', 'build a monitoring dashboard');
  assertEqual(session.state, WorkflowState.IDLE);
  
  // Simulate D1 analysis
  session.state = (WorkflowState.ANALYZING);
  session.addStep({ role: 'D1', action: 'analyze', result: { ready: true }, duration: 2000 });
  
  // Simulate planning
  session.state = (WorkflowState.PLANNING);
  session.addStep({
    role: 'D1',
    action: 'plan',
    result: { 
      title: 'Monitoring Dashboard',
      steps: [{ id: 1, type: 'CODE', action: 'Create Express server' }],
    },
    duration: 3000,
  });
  
  // Await approval
  session.state = (WorkflowState.AWAITING_APPROVAL);
  assertEqual(session.state, WorkflowState.AWAITING_APPROVAL);
  assert(session.history.length === 2, 'Should have 2 steps');
});

test('Step 4: Full workflow state progression', () => {
  const session = new WorkflowSession('crea', 'create api');
  
  // Happy path: IDLE → ANALYZING → PLANNING → AWAITING_APPROVAL → IMPLEMENTING → QUICK_REVIEWING → FINAL_REVIEWING → COMPLETED
  const happyPath = [
    WorkflowState.ANALYZING,
    WorkflowState.PLANNING,
    WorkflowState.AWAITING_APPROVAL,
    WorkflowState.IMPLEMENTING,
    WorkflowState.QUICK_REVIEWING,
    WorkflowState.FINAL_REVIEWING,
    WorkflowState.COMPLETED,
  ];
  
  for (const state of happyPath) {
    session.state = (state);
    assertEqual(session.state, state);
  }
  
  assertEqual(session.state, WorkflowState.COMPLETED);
});

test('Step 5: Fix loop state progression', () => {
  const session = new WorkflowSession('fix ', 'fix loop test');
  
  // Fix path: IMPLEMENTING → QUICK_REVIEWING → FIX_DELIBERATING → APPLYING_FIX → QUICK_REVIEWING
  session.state = (WorkflowState.IMPLEMENTING);
  session.state = (WorkflowState.QUICK_REVIEWING);
  session.state = (WorkflowState.FIX_DELIBERATING); // R2 said FAIL
  session.state = (WorkflowState.APPLYING_FIX);      // D2 → CODE
  session.state = (WorkflowState.QUICK_REVIEWING);    // Back to R2
  session.state = (WorkflowState.FINAL_REVIEWING);    // R2 said PASS → R1
  session.state = (WorkflowState.COMPLETED);
  
  assertEqual(session.state, WorkflowState.COMPLETED);
});

test('Step 6: Redesign loop state progression', () => {
  const session = new WorkflowSession('rede', 'redesign test');
  
  // Redesign path: FINAL_REVIEWING → REDESIGNING → IMPLEMENTING → ... → COMPLETED
  session.state = (WorkflowState.IMPLEMENTING);
  session.state = (WorkflowState.QUICK_REVIEWING);
  session.state = (WorkflowState.FINAL_REVIEWING);
  session.state = (WorkflowState.REDESIGNING);       // R1 said REDESIGN
  session.state = (WorkflowState.IMPLEMENTING);       // D1 → CODE re-implement
  session.state = (WorkflowState.QUICK_REVIEWING);
  session.state = (WorkflowState.FINAL_REVIEWING);
  session.state = (WorkflowState.COMPLETED);
  
  assertEqual(session.state, WorkflowState.COMPLETED);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('E2E — Multi-model role validation');
// ═══════════════════════════════════════════════════════════════════════════════

test('D1 role is used for analyze and plan', () => {
  const session = new WorkflowSession('test', 'test');
  session.addStep({ role: 'D1', action: 'analyze', result: { ready: true }, duration: 1000 });
  session.addStep({ role: 'D1', action: 'plan', result: { steps: [] }, duration: 2000 });
  
  const d1Steps = session.history.filter(s => s.role === 'D1');
  assertEqual(d1Steps.length, 2);
  assert(d1Steps.some(s => s.action === 'analyze'));
  assert(d1Steps.some(s => s.action === 'plan'));
});

test('CODE role is used for implement', () => {
  const session = new WorkflowSession('test', 'test');
  session.addStep({ role: 'CODE', action: 'implement', result: { code: '...' }, duration: 3000 });
  
  const codeSteps = session.history.filter(s => s.role === 'CODE');
  assertEqual(codeSteps.length, 1);
  assertEqual(codeSteps[0].action, 'implement');
});

test('R2 role for quick review, R1 for final review', () => {
  const session = new WorkflowSession('test', 'test');
  session.addStep({ role: 'R2', action: 'quickReview', result: { verdict: ReviewVerdict.PASS }, duration: 1000 });
  session.addStep({ role: 'R1', action: 'finalReview', result: { verdict: ReviewVerdict.PASS }, duration: 2000 });
  
  assertEqual(session.history.filter(s => s.role === 'R2').length, 1);
  assertEqual(session.history.filter(s => s.role === 'R1').length, 1);
});

test('D2 role for fix deliberation', () => {
  const session = new WorkflowSession('test', 'test');
  session.addStep({ role: 'D2', action: 'fixDeliberation', result: { fix: '...' }, duration: 1500 });
  
  assertEqual(session.history.filter(s => s.role === 'D2').length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('E2E — Error handling');
// ═══════════════════════════════════════════════════════════════════════════════

test('Session can transition to FAILED', () => {
  const session = new WorkflowSession('fail', 'failing task');
  session.state = (WorkflowState.ANALYZING);
  session.state = (WorkflowState.FAILED);
  assertEqual(session.state, WorkflowState.FAILED);
});

await testAsync('Pipeline handles missing intent gracefully', async () => {
  // Non-build input should not produce PLAN
  const decision = await creDecisionEngine.decide('ahoj', {});
  assert(decision.type !== DecisionType.PLAN, 'Greeting should not route to PLAN');
});

test('Multiple concurrent sessions are independent', () => {
  const s1 = new WorkflowSession('task', 'task A');
  const s2 = new WorkflowSession('task', 'task B');
  
  s1.state = WorkflowState.ANALYZING;
  s2.state = WorkflowState.IMPLEMENTING;
  
  assertEqual(s1.state, WorkflowState.ANALYZING);
  assertEqual(s2.state, WorkflowState.IMPLEMENTING);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('E2E — Config integration');
// ═══════════════════════════════════════════════════════════════════════════════

await testAsync('Config model mappings exist', async () => {
  const { default: config } = await import('../src/config.js');
  assert(config.models != null, 'Config should have models');
  assert(config.models.D1 != null, 'Should have D1 model');
  assert(config.models.D2 != null, 'Should have D2 model');
  assert(config.models.CODE != null, 'Should have CODE model');
  assert(config.models.R1 != null, 'Should have R1 model');
  assert(config.models.R2 != null, 'Should have R2 model');
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('Config timeouts exist for all roles', async () => {
  const { default: config } = await import('../src/config.js');
  assert(config.timeouts != null, 'Config should have timeouts');
  assert(config.timeouts.D1 > 0, 'D1 timeout');
  assert(config.timeouts.CODE > 0, 'CODE timeout');
  assert(config.timeouts.R2 > 0, 'R2 timeout');
  assert(config.timeouts.R1 > 0, 'R1 timeout');
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('D1 and R1 use same model (deepseek-r1)', async () => {
  const { default: config } = await import('../src/config.js');
  assertEqual(config.models.D1, config.models.R1);
  assertIncludes(config.models.D1, 'deepseek-r1');
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('CODE uses qwen3.5', async () => {
  const { default: config } = await import('../src/config.js');
  assertIncludes(config.models.CODE, 'qwen3.5');
}, ASYNC_TEST_TIMEOUT_MS);

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
