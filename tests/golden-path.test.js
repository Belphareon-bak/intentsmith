// Golden Path Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Planner adapter returns valid structure
// - Schema validation passes for valid payloads
// - Executor receives exactly what it should
// - Output is deterministic
//
// Run: npm run test:golden
//
// ══════════════════════════════════════════════════════════════════════════════

import { adaptPlannerOutput } from '../src/golden/goldenPlannerAdapter.js';
import { executeGoldenPath } from '../src/golden/goldenExecutorAdapter.js';
import { validate, ValidationError } from '../src/contracts/validate.js';

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

function assertDeepEqual(actual, expected, msg = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Golden Path Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Planner Adapter Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Planner Adapter');

test('adaptPlannerOutput: valid JSON returns valid structure', () => {
  const rawLLM = JSON.stringify({
    goal: 'Search for information',
    steps: [
      { step_id: 'step_1', action: 'Search web', tool: 'web.search', args: { query: 'test' } }
    ],
    requires_approval: false,
    confidence: 0.9
  });

  const result = adaptPlannerOutput(rawLLM, 'Search for something');

  assertTrue(result.plan_id, 'Has plan_id');
  assertEqual(result.goal, 'Search for information', 'Goal');
  assertEqual(result.steps.length, 1, 'Steps count');
  assertEqual(result.requires_approval, false, 'requires_approval');
  assertEqual(result.confidence, 0.9, 'confidence');
});

test('adaptPlannerOutput: generates UUID if missing', () => {
  const rawLLM = JSON.stringify({
    goal: 'Test goal',
    steps: [],
    requires_approval: true,
    confidence: 0.5
  });

  const result = adaptPlannerOutput(rawLLM, 'Test');

  assertTrue(result.plan_id.length > 0, 'Generated plan_id');
});

test('adaptPlannerOutput: normalizes confidence from percentage', () => {
  const rawLLM = JSON.stringify({
    goal: 'Test',
    steps: [],
    requires_approval: true,
    confidence: 85 // percentage
  });

  const result = adaptPlannerOutput(rawLLM, 'Test');

  assertEqual(result.confidence, 0.85, 'Confidence normalized');
});

test('adaptPlannerOutput: handles alternative field names', () => {
  const rawLLM = JSON.stringify({
    objective: 'Alternative goal',
    plan: [
      { id: 's1', description: 'Do something', toolName: 'web.fetch', params: { url: 'http://example.com' } }
    ],
    needsApproval: true,
    certainty: 0.7
  });

  const result = adaptPlannerOutput(rawLLM, 'Original goal');

  assertEqual(result.goal, 'Alternative goal', 'Goal from objective');
  assertEqual(result.steps.length, 1, 'Steps from plan');
  assertEqual(result.steps[0].tool, 'web.fetch', 'Tool from toolName');
  assertEqual(result.requires_approval, true, 'requires_approval from needsApproval');
  assertEqual(result.confidence, 0.7, 'confidence from certainty');
});

test('adaptPlannerOutput: throws on invalid JSON', () => {
  let threw = false;
  try {
    adaptPlannerOutput('not valid json', 'Test');
  } catch (err) {
    threw = true;
    assertTrue(err instanceof ValidationError, 'Is ValidationError');
  }
  assertTrue(threw, 'Should throw on invalid JSON');
});

test('adaptPlannerOutput: handles JSON in markdown code block', () => {
  const rawLLM = `Here's the plan:
\`\`\`json
{
  "goal": "Test from markdown",
  "steps": [],
  "requires_approval": false,
  "confidence": 0.8
}
\`\`\``;

  const result = adaptPlannerOutput(rawLLM, 'Test');

  assertEqual(result.goal, 'Test from markdown', 'Extracted from markdown');
});

// ────────────────────────────────────────────────────────────────────────────
// Schema Validation Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Schema Validation');

test('validate: planner-output valid payload passes', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test goal',
    steps: [
      { step_id: 's1', action: 'Test action', tool: 'web.search', args: { query: 'test' } }
    ],
    requires_approval: true,
    confidence: 0.8
  };

  const result = validate('planner-output', payload);

  assertTrue(result.valid, 'Should be valid');
  assertEqual(result.errors.length, 0, 'No errors');
});

test('validate: planner-output missing required field fails', () => {
  const payload = {
    plan_id: 'test-123',
    // goal: missing
    steps: [],
    requires_approval: true,
    confidence: 0.8
  };

  const result = validate('planner-output', payload);

  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('goal')), 'Error mentions goal');
});

test('validate: planner-output confidence out of range fails', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test',
    steps: [],
    requires_approval: true,
    confidence: 1.5 // out of range
  };

  const result = validate('planner-output', payload);

  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('confidence')), 'Error mentions confidence');
});

test('validate: tool-call valid payload passes', () => {
  const payload = {
    tool: 'web.search',
    args: { query: 'test' }
  };

  const result = validate('tool-call', payload);

  assertTrue(result.valid, 'Should be valid');
});

test('validate: tool-call invalid tool format fails', () => {
  const payload = {
    tool: 'invalid', // should be namespace.action
    args: {}
  };

  const result = validate('tool-call', payload);

  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('pattern')), 'Error mentions pattern');
});

test('validate: execution-result valid payload passes', () => {
  const payload = {
    plan_id: 'test-123',
    status: 'completed',
    step_results: [
      { step_id: 's1', status: 'completed', duration_ms: 100, data: { result: 'ok' } }
    ],
    total_duration_ms: 150
  };

  const result = validate('execution-result', payload);

  assertTrue(result.valid, 'Should be valid');
});

test('validate: execution-result invalid status fails', () => {
  const payload = {
    plan_id: 'test-123',
    status: 'unknown', // invalid enum
    step_results: [],
    total_duration_ms: 100
  };

  const result = validate('execution-result', payload);

  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('status')), 'Error mentions status');
});

// ────────────────────────────────────────────────────────────────────────────
// Executor Adapter Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Executor Adapter');

asyncTest('executeGoldenPath: executes empty plan successfully', async () => {
  const plannerOutput = {
    plan_id: 'test-empty',
    goal: 'Empty plan',
    steps: [],
    requires_approval: false,
    confidence: 1.0
  };

  const result = await executeGoldenPath(plannerOutput);

  assertEqual(result.plan_id, 'test-empty', 'Plan ID');
  assertEqual(result.status, 'completed', 'Status');
  assertEqual(result.step_results.length, 0, 'No step results');
  assertTrue(result.total_duration_ms >= 0, 'Has duration');
});

asyncTest('executeGoldenPath: validates result against contract', async () => {
  const plannerOutput = {
    plan_id: 'test-validation',
    goal: 'Test validation',
    steps: [],
    requires_approval: false,
    confidence: 1.0
  };

  const result = await executeGoldenPath(plannerOutput);

  // Result should be valid against execution-result schema
  const validation = validate('execution-result', result);
  assertTrue(validation.valid, 'Result should match contract');
});

// ────────────────────────────────────────────────────────────────────────────
// Integration Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Integration');

test('full pipeline: adapter output validates against schema', () => {
  const rawLLM = JSON.stringify({
    goal: 'Integration test',
    steps: [
      { step_id: 'step_1', action: 'Search', tool: 'web.search', args: { query: 'test' } },
      { step_id: 'step_2', action: 'Parse', tool: 'data.parse', args: { input: '{}', format: 'json' } }
    ],
    requires_approval: false,
    confidence: 0.95
  });

  const adapterOutput = adaptPlannerOutput(rawLLM, 'Test integration');
  const validation = validate('planner-output', adapterOutput);

  assertTrue(validation.valid, 'Adapter output should be valid');
  assertEqual(adapterOutput.steps.length, 2, 'Has 2 steps');
});

test('determinism: same input produces same output', () => {
  const rawLLM = JSON.stringify({
    plan_id: 'fixed-id',
    goal: 'Determinism test',
    steps: [
      { step_id: 's1', action: 'Test', tool: 'web.fetch', args: { url: 'http://test.com' } }
    ],
    requires_approval: true,
    confidence: 0.75
  });

  const result1 = adaptPlannerOutput(rawLLM, 'Test');
  const result2 = adaptPlannerOutput(rawLLM, 'Test');

  // Core fields should be identical
  assertEqual(result1.plan_id, result2.plan_id, 'plan_id');
  assertEqual(result1.goal, result2.goal, 'goal');
  assertEqual(result1.confidence, result2.confidence, 'confidence');
  assertEqual(result1.requires_approval, result2.requires_approval, 'requires_approval');
  assertDeepEqual(result1.steps, result2.steps, 'steps');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
