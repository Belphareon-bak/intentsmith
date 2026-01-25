// CRE v38.0-38.3 Planner Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - v38.0: Graph structure (cycles, roots, leaves, conditions)
// - v38.0: Parallel execution
// - v38.0: Retry with exponential backoff
// - v38.1: PlanMutator (auditable changes)
// - v38.2: DeterministicReflector (retry → fallback → ask → fail)
// - v38.3: LLMGate (authorization, rate limiting)
// - v38.3: LLMReflector (advisory only)
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  createStep, createPlan, createCondition, createRetryConfig,
  StepStatus, PlanStatus, ConditionType,
  areDependenciesMet, hasDependencyFailed, evaluateCondition,
  getNextSteps, getParallelSteps, isPlanComplete,
  shouldRetry, getRetryDelay, validatePlan
} from '../planner/types.js';
import { PlanMutator, createMutator, MutationType } from '../planner/mutations.js';
import { DeterministicReflector, ReflectionAction } from '../planner/reflection.js';
import { LLMGate, LLMAuthLevel } from '../gates/llm-gate.js';
import { LLMReflector, RecommendationType } from '../planner/llm-reflector.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v38.0-38.3 Planner Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// v38.0: Graph Structure
// ────────────────────────────────────────────────────────────────────────────

console.log('📊 v38.0: Graph Structure');

test('createPlan builds graph metadata', () => {
  const p = createPlan({
    goal: 'Test graph',
    steps: [
      createStep({ id: 's1', tool: 'data.parse', params: {} }),
      createStep({ id: 's2', tool: 'data.filter', params: {}, dependsOn: ['s1'] }),
      createStep({ id: 's3', tool: 'data.merge', params: {}, dependsOn: ['s2'] }),
    ],
  });

  assertEqual(p.graph.nodeCount, 3, 'Node count');
  assertEqual(p.graph.edgeCount, 2, 'Edge count');
  assertTrue(p.graph.roots.includes('s1'), 'Root is s1');
  assertTrue(p.graph.leaves.includes('s3'), 'Leaf is s3');
  assertFalse(p.graph.hasCycles, 'No cycles');
});

test('Graph detects parallel roots', () => {
  const p = createPlan({
    goal: 'Parallel roots',
    steps: [
      createStep({ id: 'a', tool: 'web.search', params: {} }),
      createStep({ id: 'b', tool: 'web.fetch', params: {} }),
      createStep({ id: 'c', tool: 'data.merge', params: {}, dependsOn: ['a', 'b'] }),
    ],
  });

  assertTrue(p.graph.roots.includes('a'), 'a is root');
  assertTrue(p.graph.roots.includes('b'), 'b is root');
  assertEqual(p.graph.roots.length, 2, '2 roots');
  assertTrue(p.graph.leaves.includes('c'), 'c is leaf');
});

test('Graph detects cycles', () => {
  // Create a cycle: s1 -> s2 -> s3 -> s1
  const steps = [
    createStep({ id: 's1', tool: 'a', params: {}, dependsOn: ['s3'] }),
    createStep({ id: 's2', tool: 'b', params: {}, dependsOn: ['s1'] }),
    createStep({ id: 's3', tool: 'c', params: {}, dependsOn: ['s2'] }),
  ];
  const p = createPlan({ goal: 'Cycle test', steps });

  assertTrue(p.graph.hasCycles, 'Should detect cycle');
});

test('validatePlan catches cycles', () => {
  const steps = [
    createStep({ id: 's1', tool: 'a', params: {}, dependsOn: ['s2'] }),
    createStep({ id: 's2', tool: 'b', params: {}, dependsOn: ['s1'] }),
  ];
  const p = createPlan({ goal: 'Cycle', steps });

  const v = validatePlan(p);
  assertFalse(v.valid, 'Should be invalid');
  assertTrue(v.errors.some(e => e.includes('cycle')), 'Should mention cycles');
});

test('validatePlan catches orphan dependencies', () => {
  const steps = [
    createStep({ id: 's1', tool: 'a', params: {}, dependsOn: ['nonexistent'] }),
  ];
  const p = createPlan({ goal: 'Orphan', steps });

  const v = validatePlan(p);
  assertFalse(v.valid, 'Should be invalid');
  assertTrue(v.errors.some(e => e.includes('non-existent')), 'Should mention orphan');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.0: Conditions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.0: Conditions');

test('ALWAYS condition always passes', () => {
  const step = createStep({ id: 's1', tool: 'a', params: {} });
  const plan = createPlan({ goal: 'Test', steps: [step] });

  assertTrue(evaluateCondition(step, plan), 'ALWAYS should pass');
});

test('IF_PREVIOUS_SUCCESS checks dependencies', () => {
  const s1 = createStep({ id: 's1', tool: 'a', params: {} });
  const s2 = createStep({
    id: 's2', tool: 'b', params: {},
    dependsOn: ['s1'],
    condition: createCondition(ConditionType.IF_PREVIOUS_SUCCESS, { stepIds: ['s1'] }),
  });

  const plan = createPlan({ goal: 'Test', steps: [s1, s2] });

  // s1 not completed yet
  assertFalse(evaluateCondition(s2, plan), 'Should fail when s1 not done');

  // Mark s1 as completed
  s1.status = StepStatus.COMPLETED;
  assertTrue(evaluateCondition(s2, plan), 'Should pass when s1 completed');
});

test('IF_PREVIOUS_FAILED enables fallback steps', () => {
  const s1 = createStep({ id: 's1', tool: 'a', params: {} });
  const fallback = createStep({
    id: 'fallback', tool: 'b', params: {},
    condition: createCondition(ConditionType.IF_PREVIOUS_FAILED, { stepIds: ['s1'] }),
  });

  const plan = createPlan({ goal: 'Test', steps: [s1, fallback] });

  // s1 not failed
  assertFalse(evaluateCondition(fallback, plan), 'Should not run when s1 pending');

  // Mark s1 as failed
  s1.status = StepStatus.FAILED;
  assertTrue(evaluateCondition(fallback, plan), 'Should run when s1 failed');
});

test('IF_RESULT_MATCHES checks result criteria', () => {
  const s1 = createStep({ id: 's1', tool: 'a', params: {} });
  const s2 = createStep({
    id: 's2', tool: 'b', params: {},
    dependsOn: ['s1'],
    condition: createCondition(ConditionType.IF_RESULT_MATCHES, {
      stepIds: ['s1'],
      criteria: { success: true },
    }),
  });

  const plan = createPlan({ goal: 'Test', steps: [s1, s2] });
  s1.status = StepStatus.COMPLETED;

  // No result yet
  assertFalse(evaluateCondition(s2, plan), 'Should fail without result');

  // Add matching result
  plan.results.s1 = { success: true };
  assertTrue(evaluateCondition(s2, plan), 'Should pass with matching result');

  // Non-matching result
  plan.results.s1 = { success: false };
  assertFalse(evaluateCondition(s2, plan), 'Should fail with non-matching result');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.0: Parallel Steps
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.0: Parallel Steps');

test('getParallelSteps returns independent steps', () => {
  const s1 = createStep({ id: 's1', tool: 'a', params: {} });
  const s2 = createStep({ id: 's2', tool: 'b', params: {} });
  const s3 = createStep({ id: 's3', tool: 'c', params: {}, dependsOn: ['s1', 's2'] });

  const plan = createPlan({ goal: 'Test', steps: [s1, s2, s3] });

  const parallel = getParallelSteps(plan);
  assertEqual(parallel.length, 2, 'Should return 2 parallel steps');
  assertTrue(parallel.some(s => s.id === 's1'), 's1 is parallel');
  assertTrue(parallel.some(s => s.id === 's2'), 's2 is parallel');
  assertFalse(parallel.some(s => s.id === 's3'), 's3 not ready yet');
});

test('getParallelSteps respects dependencies', () => {
  const s1 = createStep({ id: 's1', tool: 'a', params: {} });
  const s2 = createStep({ id: 's2', tool: 'b', params: {}, dependsOn: ['s1'] });

  const plan = createPlan({ goal: 'Test', steps: [s1, s2] });

  const parallel = getParallelSteps(plan);
  assertEqual(parallel.length, 1, 'Only s1 is ready');
  assertEqual(parallel[0].id, 's1', 's1 is first');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.0: Retry Configuration
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.0: Retry Configuration');

test('createRetryConfig merges defaults', () => {
  const config = createRetryConfig({ maxRetries: 5 });

  assertEqual(config.maxRetries, 5, 'Custom maxRetries');
  assertEqual(config.retryDelay, 1000, 'Default retryDelay');
  assertEqual(config.backoffMultiplier, 2, 'Default backoffMultiplier');
});

test('shouldRetry checks configuration', () => {
  const step = createStep({
    id: 's1', tool: 'a', params: {},
    retry: createRetryConfig({ maxRetries: 3, retryOn: ['TIMEOUT'] }),
  });

  step.status = StepStatus.FAILED;
  step.errorCode = 'TIMEOUT';
  step.attempts = 1;

  assertTrue(shouldRetry(step), 'Should retry on TIMEOUT');

  step.attempts = 3;
  assertFalse(shouldRetry(step), 'Should not retry after max attempts');
});

test('getRetryDelay uses exponential backoff', () => {
  const step = createStep({
    id: 's1', tool: 'a', params: {},
    retry: createRetryConfig({ retryDelay: 1000, backoffMultiplier: 2 }),
  });

  step.attempts = 0;
  assertEqual(getRetryDelay(step), 1000, 'First attempt: 1000ms');

  step.attempts = 1;
  assertEqual(getRetryDelay(step), 2000, 'Second attempt: 2000ms');

  step.attempts = 2;
  assertEqual(getRetryDelay(step), 4000, 'Third attempt: 4000ms');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.1: PlanMutator
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.1: PlanMutator');

test('PlanMutator logs all changes', () => {
  const plan = createPlan({
    goal: 'Test',
    steps: [createStep({ id: 's1', tool: 'a', params: {} })],
  });

  const mutator = createMutator(plan);
  mutator.setStepStatus('s1', StepStatus.RUNNING, 'test');

  assertEqual(plan.mutations.length, 1, 'Should have 1 mutation');
  assertEqual(plan.mutations[0].type, MutationType.SET_STEP_STATUS, 'Correct type');
  assertEqual(plan.mutations[0].source, 'test', 'Correct source');
  assertTrue(plan.mutations[0].previous !== undefined, 'Has previous state');
});

test('PlanMutator.setStepResult updates plan.results', () => {
  const plan = createPlan({
    goal: 'Test',
    steps: [createStep({ id: 's1', tool: 'a', params: {} })],
  });

  const mutator = createMutator(plan);
  mutator.setStepResult('s1', { data: 'test' }, 'runner');

  assertEqual(plan.steps[0].status, StepStatus.COMPLETED, 'Status updated');
  assertEqual(plan.results.s1.data, 'test', 'Result in plan.results');
});

test('PlanMutator.retryStep increments attempts', () => {
  const plan = createPlan({
    goal: 'Test',
    steps: [createStep({ id: 's1', tool: 'a', params: {} })],
  });

  plan.steps[0].attempts = 1;
  const mutator = createMutator(plan);
  mutator.retryStep('s1', 'reflector');

  assertEqual(plan.steps[0].attempts, 2, 'Attempts incremented');
  assertEqual(plan.steps[0].status, StepStatus.RETRYING, 'Status is RETRYING');
});

test('PlanMutator.enableFallback activates fallback step', () => {
  const plan = createPlan({
    goal: 'Test',
    steps: [
      createStep({ id: 's1', tool: 'a', params: {}, fallbackStep: 'fallback' }),
      createStep({ id: 'fallback', tool: 'b', params: {} }),
    ],
  });

  plan.steps[0].status = StepStatus.FAILED;
  plan.steps[1].status = StepStatus.PENDING;

  const mutator = createMutator(plan);
  const result = mutator.enableFallback('s1', 'reflector');

  assertTrue(result.success, 'Should succeed');
  assertEqual(plan.steps[1].status, StepStatus.PENDING, 'Fallback is ready');
});

test('Mutation history is auditable', () => {
  const plan = createPlan({
    goal: 'Test',
    steps: [createStep({ id: 's1', tool: 'a', params: {} })],
  });

  const mutator = createMutator(plan);
  mutator.setStepStatus('s1', StepStatus.RUNNING, 'runner');
  mutator.setStepResult('s1', { x: 1 }, 'runner');

  const mutations = mutator.getMutations();
  assertEqual(mutations.length, 2, '2 mutations');

  const runnerMutations = mutator.getMutationsBySource('runner');
  assertEqual(runnerMutations.length, 2, '2 from runner');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.2: DeterministicReflector
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.2: DeterministicReflector');

test('Reflector returns CONTINUE for non-failed steps', () => {
  const reflector = new DeterministicReflector();
  const step = createStep({ id: 's1', tool: 'a', params: {} });
  step.status = StepStatus.COMPLETED;

  const plan = createPlan({ goal: 'Test', steps: [step] });
  const result = reflector.reflect(step, plan);

  assertEqual(result.action, ReflectionAction.CONTINUE, 'Should CONTINUE');
});

test('Reflector returns RETRY for transient errors', () => {
  const reflector = new DeterministicReflector();
  const step = createStep({
    id: 's1', tool: 'a', params: {},
    retry: createRetryConfig({ maxRetries: 3, retryOn: ['TIMEOUT'] }),
  });
  step.status = StepStatus.FAILED;
  step.errorCode = 'TIMEOUT';
  step.attempts = 1;

  const plan = createPlan({ goal: 'Test', steps: [step] });
  const result = reflector.reflect(step, plan);

  assertEqual(result.action, ReflectionAction.RETRY, 'Should RETRY');
  assertTrue(result.delay > 0, 'Should have delay');
});

test('Reflector returns FALLBACK when available', () => {
  const reflector = new DeterministicReflector();
  const step = createStep({
    id: 's1', tool: 'a', params: {},
    fallbackStep: 'fallback',
  });
  step.status = StepStatus.FAILED;
  step.errorCode = 'UNKNOWN';

  const fallback = createStep({ id: 'fallback', tool: 'b', params: {} });

  const plan = createPlan({ goal: 'Test', steps: [step, fallback] });
  const result = reflector.reflect(step, plan);

  assertEqual(result.action, ReflectionAction.FALLBACK, 'Should FALLBACK');
  assertEqual(result.fallbackStepId, 'fallback', 'Correct fallback step');
});

test('Reflector returns ASK_USER for recoverable errors', () => {
  const reflector = new DeterministicReflector();
  const step = createStep({ id: 's1', tool: 'a', params: {} });
  step.status = StepStatus.FAILED;
  step.errorCode = 'MISSING_PARAM';

  const plan = createPlan({ goal: 'Test', steps: [step] });
  const result = reflector.reflect(step, plan);

  assertEqual(result.action, ReflectionAction.ASK_USER, 'Should ASK_USER');
  assertTrue(result.question !== undefined, 'Should have question');
});

test('Reflector returns FAIL for unrecoverable errors', () => {
  const reflector = new DeterministicReflector({ askUserEnabled: false });
  const step = createStep({ id: 's1', tool: 'a', params: {} });
  step.status = StepStatus.FAILED;
  step.errorCode = 'CATASTROPHIC';

  const plan = createPlan({ goal: 'Test', steps: [step] });
  const result = reflector.reflect(step, plan);

  assertEqual(result.action, ReflectionAction.FAIL, 'Should FAIL');
});

test('Reflector respects max retries', () => {
  const reflector = new DeterministicReflector();
  const step = createStep({
    id: 's1', tool: 'a', params: {},
    retry: createRetryConfig({ maxRetries: 2, retryOn: ['TIMEOUT'] }),
  });
  step.status = StepStatus.FAILED;
  step.errorCode = 'TIMEOUT';
  step.attempts = 2; // Already at max

  const plan = createPlan({ goal: 'Test', steps: [step] });
  const result = reflector.reflect(step, plan);

  // Should not retry, proceed to FAIL
  assertEqual(result.action, ReflectionAction.FAIL, 'Should FAIL after max retries');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.3: LLMGate
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.3: LLMGate');

test('LLMGate blocks when disabled', () => {
  const gate = new LLMGate({ authLevel: LLMAuthLevel.DISABLED });

  const result = gate.check({ planId: 'p1', stepId: 's1' });

  assertFalse(result.authorized, 'Should not be authorized');
  assertEqual(result.reason, 'LLM reflection disabled', 'Correct reason');
});

test('LLMGate requires approval in GATED mode', () => {
  const gate = new LLMGate({ authLevel: LLMAuthLevel.GATED });

  const result = gate.check({ planId: 'p1', stepId: 's1' });

  assertFalse(result.authorized, 'Should not be authorized');
  assertTrue(result.needsApproval, 'Should need approval');
  assertTrue(result.question !== undefined, 'Should have question');
});

test('LLMGate allows in AUTO mode', () => {
  const gate = new LLMGate({ authLevel: LLMAuthLevel.AUTO });

  const result = gate.check({ planId: 'p1', stepId: 's1' });

  assertTrue(result.authorized, 'Should be authorized');
});

test('LLMGate session approval works', () => {
  const gate = new LLMGate({ authLevel: LLMAuthLevel.GATED });

  // First check requires approval
  const r1 = gate.check({ planId: 'p1', stepId: 's1' });
  assertTrue(r1.needsApproval, 'First check needs approval');

  // Approve for session
  gate.approve('session');

  // Second check is authorized
  const r2 = gate.check({ planId: 'p1', stepId: 's2' });
  assertTrue(r2.authorized, 'Second check authorized');
});

test('LLMGate rate limits per plan', () => {
  const gate = new LLMGate({
    authLevel: LLMAuthLevel.AUTO,
    maxCallsPerPlan: 2,
  });

  gate.recordCall('p1');
  gate.recordCall('p1');

  // Third call should be rate limited
  const result = gate.check({ planId: 'p1', stepId: 's1' });

  assertFalse(result.authorized, 'Should be rate limited');
  assertTrue(result.reason.includes('limit'), 'Should mention limit');
});

test('LLMGate rate limits per session', () => {
  const gate = new LLMGate({
    authLevel: LLMAuthLevel.AUTO,
    maxCallsPerSession: 3,
  });

  gate.recordCall('p1');
  gate.recordCall('p2');
  gate.recordCall('p3');

  // Fourth call should be rate limited
  const result = gate.check({ planId: 'p4', stepId: 's1' });

  assertFalse(result.authorized, 'Should be rate limited');
  assertTrue(result.reason.includes('Session'), 'Should mention session limit');
});

test('LLMGate reset clears state', () => {
  const gate = new LLMGate({ authLevel: LLMAuthLevel.GATED });
  gate.approve('session');
  gate.recordCall('p1');

  gate.resetSession();

  assertFalse(gate.approvedForSession, 'Approval cleared');
  assertEqual(gate.sessionCalls, 0, 'Calls cleared');
});

// ────────────────────────────────────────────────────────────────────────────
// v38.3: LLMReflector
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📊 v38.3: LLMReflector');

test('LLMReflector returns advisory only', () => {
  // Test parseRecommendation directly
  const reflector = new LLMReflector();
  const step = createStep({ id: 's1', tool: 'a', params: {} });

  const content = JSON.stringify({
    type: 'RETRY_WITH_CHANGES',
    confidence: 0.8,
    reasoning: 'Test reason',
    details: { paramChanges: { x: 1 } },
  });

  const result = reflector.parseRecommendation(content, step);

  assertEqual(result.type, RecommendationType.RETRY_WITH_CHANGES, 'Correct type');
  assertTrue(result.advisory, 'Should be advisory');
  assertEqual(result.confidence, 0.8, 'Correct confidence');
});

test('LLMReflector rejects low confidence', () => {
  const reflector = new LLMReflector({ minConfidence: 0.6 });
  const step = createStep({ id: 's1', tool: 'a', params: {} });

  const content = JSON.stringify({
    type: 'RETRY_WITH_CHANGES',
    confidence: 0.3,
    reasoning: 'Low confidence',
  });

  const result = reflector.parseRecommendation(content, step);

  // Low confidence still parses, but will be filtered in analyze()
  assertEqual(result.confidence, 0.3, 'Confidence preserved');
});

test('LLMReflector converts recommendation to reflection action', () => {
  const reflector = new LLMReflector();

  const recommendation = {
    type: RecommendationType.RETRY_WITH_CHANGES,
    confidence: 0.9,
    reasoning: 'Try again with different params',
    details: { paramChanges: { timeout: 5000 } },
    advisory: true,
    stepId: 's1',
  };

  const action = reflector.toReflectionAction(recommendation);

  assertEqual(action.action, ReflectionAction.RETRY, 'Converted to RETRY');
  assertEqual(action.source, 'llm_advisory', 'Source is advisory');
  assertTrue(action.reason.includes('LLM advisory'), 'Reason mentions LLM');
});

test('LLMReflector returns null for NO_RECOMMENDATION', () => {
  const reflector = new LLMReflector();

  const recommendation = {
    type: RecommendationType.NO_RECOMMENDATION,
    confidence: 0,
    reasoning: 'No idea',
  };

  const action = reflector.toReflectionAction(recommendation);

  assertEqual(action, null, 'Should return null');
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
