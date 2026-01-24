// CRE v37.0 Planner Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Sequential plan execution
// - Dependency graph (mapInput)
// - Failure propagation (skip dependent steps)
// - Gate handling (pauses plan)
// - Resume after gate
// - E2E: multi-step search → filter plan
// - Plan validation
//
// ══════════════════════════════════════════════════════════════════════════════

import { planRunner } from '../planner/runner.js';
import { createStep, createPlan, StepStatus, PlanStatus } from '../planner/types.js';
import { plan, validateDecision, isPlan } from '../chat/cre-decision-types.js';
import { toolRegistry } from '../tools/registry.js';
import { humanGate } from '../gates/human-gate.js';

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

// ════════════════════════════════════════════════════════════════════════════
// MOCK FETCH
// ════════════════════════════════════════════════════════════════════════════

function mockFetch(responseBody, status = 200) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
    headers: { entries: () => [] },
  });
}

function restoreFetch() {
  delete global.fetch;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v37.0 Planner Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Plan Types
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Plan Types');

test('createStep creates a valid step', () => {
  const step = createStep({ id: 's1', tool: 'data.parse', params: { input: '{}' } });
  assertEqual(step.id, 's1', 'ID');
  assertEqual(step.tool, 'data.parse', 'Tool');
  assertEqual(step.status, StepStatus.PENDING, 'Status');
  assertTrue(Array.isArray(step.dependsOn), 'dependsOn is array');
  assertEqual(step.dependsOn.length, 0, 'No deps');
});

test('createPlan creates a valid plan', () => {
  const p = createPlan({
    goal: 'Test goal',
    steps: [createStep({ id: 's1', tool: 'data.parse', params: { input: '{}' } })],
  });
  assertEqual(p.goal, 'Test goal', 'Goal');
  assertEqual(p.steps.length, 1, 'Steps');
  assertEqual(p.status, PlanStatus.CREATED, 'Status');
});

test('PLAN decision type is valid', () => {
  const decision = plan('Find cars', [{ id: 's1', tool: 'web.search', params: { query: 'test' } }]);
  assertEqual(decision.type, 'PLAN', 'Type');
  assertTrue(isPlan(decision), 'isPlan');
  const v = validateDecision(decision);
  assertTrue(v.valid, `Validation: ${v.errors}`);
});

test('PLAN without goal is invalid', () => {
  const v = validateDecision({ type: 'PLAN', steps: [{ id: 's1' }] });
  assertTrue(!v.valid, 'Should be invalid');
  assertTrue(v.errors.some(e => e.includes('goal')), 'Should mention goal');
});

test('PLAN without steps is invalid', () => {
  const v = validateDecision({ type: 'PLAN', goal: 'test', steps: [] });
  assertTrue(!v.valid, 'Should be invalid');
});

// ────────────────────────────────────────────────────────────────────────────
// Sequential Execution
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Sequential Execution');

await asyncTest('Single-step plan executes successfully', async () => {
  const p = createPlan({
    goal: 'Parse JSON',
    steps: [createStep({ id: 's1', tool: 'data.parse', params: { input: '{"x":1}' } })],
  });

  const result = await planRunner.run(p, { internal: true });

  assertEqual(result.status, PlanStatus.COMPLETED, 'Plan status');
  assertEqual(p.steps[0].status, StepStatus.COMPLETED, 'Step status');
  assertEqual(p.results.s1.data.x, 1, 'Step result');
});

await asyncTest('Two-step sequential plan', async () => {
  const p = createPlan({
    goal: 'Parse and filter',
    steps: [
      createStep({ id: 'parse', tool: 'data.parse', params: { input: '[{"n":1},{"n":2},{"n":3}]' } }),
      createStep({
        id: 'filter',
        tool: 'data.filter',
        dependsOn: ['parse'],
        params: { criteria: { n: { max: 2 } } },
        mapInput: (deps) => ({ data: deps.parse.data }),
      }),
    ],
  });

  const result = await planRunner.run(p, { internal: true });

  assertEqual(result.status, PlanStatus.COMPLETED, 'Plan status');
  assertEqual(p.steps[0].status, StepStatus.COMPLETED, 'Parse step');
  assertEqual(p.steps[1].status, StepStatus.COMPLETED, 'Filter step');
  assertEqual(p.results.filter.count, 2, 'Filtered to 2 items');
});

// ────────────────────────────────────────────────────────────────────────────
// Failure Propagation
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Failure Propagation');

await asyncTest('Failed step causes dependent steps to be SKIPPED', async () => {
  const p = createPlan({
    goal: 'Fail test',
    steps: [
      createStep({ id: 'bad', tool: 'data.parse', params: { input: 'not json {{' } }),
      createStep({ id: 'after', tool: 'data.parse', params: { input: '{}' }, dependsOn: ['bad'] }),
    ],
  });

  const result = await planRunner.run(p, { internal: true });

  assertEqual(result.status, PlanStatus.FAILED, 'Plan should fail');
  assertEqual(p.steps[0].status, StepStatus.FAILED, 'First step failed');
  assertEqual(p.steps[1].status, StepStatus.SKIPPED, 'Second step skipped');
});

await asyncTest('Independent steps continue despite sibling failure', async () => {
  const p = createPlan({
    goal: 'Partial success',
    steps: [
      createStep({ id: 'bad', tool: 'data.parse', params: { input: 'broken' } }),
      createStep({ id: 'good', tool: 'data.parse', params: { input: '{"ok":true}' } }),
    ],
  });

  const result = await planRunner.run(p, { internal: true });

  // Both ran (no dependency), one failed
  assertEqual(p.steps[0].status, StepStatus.FAILED, 'Bad step failed');
  assertEqual(p.steps[1].status, StepStatus.COMPLETED, 'Good step completed');
  assertEqual(p.results.good.data.ok, true, 'Good step result');
});

// ────────────────────────────────────────────────────────────────────────────
// Gate Handling
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Gate Handling');

await asyncTest('Plan pauses on gated step', async () => {
  // Reset gate state
  humanGate.resetSession();

  const p = createPlan({
    goal: 'Write file (gated)',
    steps: [
      createStep({ id: 'parse', tool: 'data.parse', params: { input: '{"file":"test"}' } }),
      createStep({ id: 'write', tool: 'fs.write', params: { path: '/tmp/test.txt', content: 'hello' }, dependsOn: ['parse'] }),
    ],
  });

  // Don't pass internal: true — let the gate work
  const result = await planRunner.run(p);

  assertEqual(result.status, PlanStatus.GATED, 'Plan should be gated');
  assertTrue(result.gatedStep !== undefined, 'Should have gated step');
  assertEqual(result.gatedStep.tool, 'fs.write', 'Gated on fs.write');
  assertEqual(p.steps[0].status, StepStatus.COMPLETED, 'First step ran');
  assertEqual(p.steps[1].status, StepStatus.GATED, 'Second step gated');
});

await asyncTest('Plan resumes after gate confirmation', async () => {
  humanGate.resetSession();

  const p = createPlan({
    goal: 'Write after confirm',
    steps: [
      createStep({ id: 'parse', tool: 'data.parse', params: { input: '{"x":1}' } }),
      createStep({ id: 'write', tool: 'fs.write', params: { path: '/tmp/planner-test.txt', content: 'test' }, dependsOn: ['parse'] }),
    ],
  });

  // First run: gets gated
  const r1 = await planRunner.run(p);
  assertEqual(r1.status, PlanStatus.GATED, 'Should be gated first');

  // Resume: confirms fs.write
  const r2 = await planRunner.resume(p, 'fs.write', { internal: true });

  // fs.write will likely succeed or fail with FS error, but NOT be gated
  assertTrue(r2.status !== PlanStatus.GATED, 'Should not be gated after resume');
  assertTrue(p.steps[1].status !== StepStatus.GATED, 'Write step should have executed');
});

// ────────────────────────────────────────────────────────────────────────────
// E2E: Multi-step search plan
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 E2E: Multi-step Plan');

await asyncTest('E2E: search → parse results → filter', async () => {
  const searchResults = {
    items: [
      { title: 'Jimny 4x4', link: 'https://cars.cz/1', snippet: '189000 Kč' },
      { title: 'Duster 4x4', link: 'https://cars.cz/2', snippet: '175000 Kč' },
      { title: 'X5 4x4', link: 'https://cars.cz/3', snippet: '450000 Kč' },
    ]
  };

  mockFetch(searchResults);

  const p = createPlan({
    goal: 'Najdi auto 4x4 do 200k',
    steps: [
      createStep({
        id: 'search',
        tool: 'web.search',
        params: { query: 'auto 4x4 do 200000', language: 'cs' },
        label: 'Hledat auta',
      }),
      createStep({
        id: 'filter',
        tool: 'data.filter',
        dependsOn: ['search'],
        params: { criteria: { title: '4x4' } },
        mapInput: (deps) => ({ data: deps.search }),
        label: 'Filtrovat výsledky',
      }),
    ],
  });

  const result = await planRunner.run(p, { internal: true });

  assertEqual(result.status, PlanStatus.COMPLETED, 'Plan completed');
  assertEqual(p.steps[0].status, StepStatus.COMPLETED, 'Search completed');
  assertEqual(p.steps[1].status, StepStatus.COMPLETED, 'Filter completed');

  // Search should have returned 3 results
  assertTrue(Array.isArray(p.results.search), 'Search results is array');
  assertEqual(p.results.search.length, 3, 'Search found 3 results');

  // Filter should have found matches with '4x4' in title
  assertTrue(p.results.filter.count > 0, 'Filter found results');

  restoreFetch();
});

// ────────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Stats');

test('PlanRunner tracks execution history', () => {
  const stats = planRunner.getStats();
  assertTrue(stats.totalPlans > 0, 'Should have executed plans');
  assertTrue(typeof stats.successRate === 'number', 'Should have success rate');
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
  process.exit(1);
}
