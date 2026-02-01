// Planner Output Contract Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Valid payload passes
// - 3 invalid payloads fail (missing field, wrong type, invalid nested)
//
// ══════════════════════════════════════════════════════════════════════════════

import { validate } from '../../src/contracts/validate.js';

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

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Planner Output Contract Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Valid Payloads
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Valid Payloads');

test('minimal valid payload passes', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test goal',
    steps: [],
    requires_approval: true,
    confidence: 0.5
  };

  const result = validate('planner-output', payload);
  assertTrue(result.valid, 'Should be valid');
  assertEqual(result.errors.length, 0, 'No errors');
});

test('full valid payload with steps passes', () => {
  const payload = {
    plan_id: 'uuid-format-12345',
    goal: 'Search for RTX 5090 prices and create a report',
    steps: [
      {
        step_id: 'step_1',
        action: 'Search web for RTX 5090 prices',
        tool: 'web.search',
        args: { query: 'RTX 5090 price', maxResults: 10 }
      },
      {
        step_id: 'step_2',
        action: 'Parse search results',
        tool: 'data.parse',
        args: { input: '{}', format: 'json' }
      }
    ],
    requires_approval: false,
    confidence: 0.85
  };

  const result = validate('planner-output', payload);
  assertTrue(result.valid, 'Should be valid');
});

// ────────────────────────────────────────────────────────────────────────────
// Invalid Payloads
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Invalid Payloads');

test('INVALID: missing required field (goal)', () => {
  const payload = {
    plan_id: 'test-123',
    // goal: MISSING
    steps: [],
    requires_approval: true,
    confidence: 0.5
  };

  const result = validate('planner-output', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('goal')), 'Error should mention goal');
});

test('INVALID: wrong type (confidence as string)', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test',
    steps: [],
    requires_approval: true,
    confidence: 'high' // should be number
  };

  const result = validate('planner-output', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('confidence')), 'Error should mention confidence');
});

test('INVALID: confidence out of range (negative)', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test',
    steps: [],
    requires_approval: true,
    confidence: -0.5 // must be >= 0
  };

  const result = validate('planner-output', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('confidence')), 'Error should mention confidence');
});

test('INVALID: step missing required field (tool)', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test',
    steps: [
      {
        step_id: 'step_1',
        action: 'Do something',
        // tool: MISSING
        args: {}
      }
    ],
    requires_approval: true,
    confidence: 0.5
  };

  const result = validate('planner-output', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('tool')), 'Error should mention tool');
});

test('INVALID: additional property (not allowed)', () => {
  const payload = {
    plan_id: 'test-123',
    goal: 'Test',
    steps: [],
    requires_approval: true,
    confidence: 0.5,
    extra_field: 'not allowed' // additionalProperties: false
  };

  const result = validate('planner-output', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('extra_field')), 'Error should mention extra_field');
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
  process.exit(1);
}
