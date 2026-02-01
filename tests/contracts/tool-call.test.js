// Tool Call Contract Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Valid payload passes
// - 3 invalid payloads fail (missing field, wrong pattern, wrong type)
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
console.log('  Tool Call Contract Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Valid Payloads
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Valid Payloads');

test('web.search tool call passes', () => {
  const payload = {
    tool: 'web.search',
    args: { query: 'test query', maxResults: 10 }
  };

  const result = validate('tool-call', payload);
  assertTrue(result.valid, 'Should be valid');
  assertEqual(result.errors.length, 0, 'No errors');
});

test('fs.read tool call passes', () => {
  const payload = {
    tool: 'fs.read',
    args: { path: '/tmp/test.txt' }
  };

  const result = validate('tool-call', payload);
  assertTrue(result.valid, 'Should be valid');
});

test('data.parse tool call passes', () => {
  const payload = {
    tool: 'data.parse',
    args: { input: '{"key": "value"}', format: 'json' }
  };

  const result = validate('tool-call', payload);
  assertTrue(result.valid, 'Should be valid');
});

test('empty args is valid', () => {
  const payload = {
    tool: 'memory.recall',
    args: {}
  };

  const result = validate('tool-call', payload);
  assertTrue(result.valid, 'Should be valid');
});

// ────────────────────────────────────────────────────────────────────────────
// Invalid Payloads
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Invalid Payloads');

test('INVALID: missing tool field', () => {
  const payload = {
    // tool: MISSING
    args: { query: 'test' }
  };

  const result = validate('tool-call', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('tool')), 'Error should mention tool');
});

test('INVALID: missing args field', () => {
  const payload = {
    tool: 'web.search'
    // args: MISSING
  };

  const result = validate('tool-call', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('args')), 'Error should mention args');
});

test('INVALID: tool without namespace (no dot)', () => {
  const payload = {
    tool: 'search', // should be 'web.search'
    args: {}
  };

  const result = validate('tool-call', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('pattern')), 'Error should mention pattern');
});

test('INVALID: tool with numbers starting namespace', () => {
  const payload = {
    tool: '1web.search', // should start with letter
    args: {}
  };

  const result = validate('tool-call', payload);
  assertTrue(!result.valid, 'Should be invalid');
});

test('INVALID: args as array instead of object', () => {
  const payload = {
    tool: 'web.search',
    args: ['test', 'query'] // should be object
  };

  const result = validate('tool-call', payload);
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.errors.some(e => e.includes('args')), 'Error should mention args');
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
