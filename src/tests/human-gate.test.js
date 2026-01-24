// CRE v36.9.3 HumanGate Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - AUTO level: always allowed
// - CONFIRM_ONCE: gated first time, allowed after confirm()
// - ALWAYS_ASK: always gated
// - deny(): blocks for session
// - Unknown tools default to CONFIRM_ONCE
// - ToolExecutor integration: gated tools return GATED code
// - skipGate context bypasses gate
//
// ══════════════════════════════════════════════════════════════════════════════

import { HumanGate, GateLevel } from '../gates/human-gate.js';
import { toolExecutor } from '../tools/executor.js';
import { ToolError } from '../tools/executor.js';
import { toolCall } from '../chat/cre-decision-types.js';

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
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v36.9.3 HumanGate Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// AUTO Level
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 AUTO Level');

test('AUTO tools are always allowed', () => {
  const gate = new HumanGate();
  const result = gate.check('web.search', { query: 'test' });
  assertTrue(result.allowed, 'web.search should be AUTO');
});

test('web.fetch is AUTO', () => {
  const gate = new HumanGate();
  assertTrue(gate.check('web.fetch', { url: 'http://x.com' }).allowed, 'Should be allowed');
});

test('data.parse is AUTO', () => {
  const gate = new HumanGate();
  assertTrue(gate.check('data.parse', { input: '{}' }).allowed, 'Should be allowed');
});

test('fs.read is AUTO', () => {
  const gate = new HumanGate();
  assertTrue(gate.check('fs.read', { path: '/tmp/x' }).allowed, 'Should be allowed');
});

test('memory.store is AUTO', () => {
  const gate = new HumanGate();
  assertTrue(gate.check('memory.store', { key: 'x', value: 1 }).allowed, 'Should be allowed');
});

// ────────────────────────────────────────────────────────────────────────────
// CONFIRM_ONCE Level
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 CONFIRM_ONCE Level');

test('CONFIRM_ONCE: gated on first call', () => {
  const gate = new HumanGate();
  const result = gate.check('fs.write', { path: '/tmp/x', content: 'hi' });
  assertTrue(!result.allowed, 'Should be gated');
  assertTrue(result.gated, 'Should be marked as gated');
  assertEqual(result.reason, 'CONFIRM_REQUIRED', 'Reason');
  assertEqual(result.tool, 'fs.write', 'Tool name');
});

test('CONFIRM_ONCE: allowed after confirm()', () => {
  const gate = new HumanGate();

  // First: gated
  const r1 = gate.check('fs.write', { path: '/tmp/x' });
  assertTrue(!r1.allowed, 'Should be gated first time');

  // Confirm
  gate.confirm('fs.write');

  // Second: allowed
  const r2 = gate.check('fs.write', { path: '/tmp/y' });
  assertTrue(r2.allowed, 'Should be allowed after confirm');
});

test('CONFIRM_ONCE: git.commit is CONFIRM_ONCE', () => {
  const gate = new HumanGate();
  const r = gate.check('git.commit', { message: 'test' });
  assertTrue(!r.allowed, 'Should be gated');
  assertEqual(r.reason, 'CONFIRM_REQUIRED', 'Reason');
});

// ────────────────────────────────────────────────────────────────────────────
// ALWAYS_ASK Level
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 ALWAYS_ASK Level');

test('ALWAYS_ASK: gated every time, even after confirm', () => {
  const gate = new HumanGate();

  // shell.exec is ALWAYS_ASK
  const r1 = gate.check('shell.exec', { cmd: 'rm -rf /' });
  assertTrue(!r1.allowed, 'Should be gated');

  // Confirm it
  gate.confirm('shell.exec');

  // Still gated because ALWAYS_ASK
  const r2 = gate.check('shell.exec', { cmd: 'ls' });
  assertTrue(!r2.allowed, 'Should STILL be gated (ALWAYS_ASK)');
});

test('git.push is ALWAYS_ASK', () => {
  const gate = new HumanGate();
  assertTrue(!gate.check('git.push', {}).allowed, 'Should be gated');
});

test('fs.delete is ALWAYS_ASK', () => {
  const gate = new HumanGate();
  assertTrue(!gate.check('fs.delete', { path: '/important' }).allowed, 'Should be gated');
});

// ────────────────────────────────────────────────────────────────────────────
// Deny
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Deny');

test('deny() blocks tool for session', () => {
  const gate = new HumanGate();
  gate.deny('fs.write');
  const r = gate.check('fs.write', { path: '/tmp/x' });
  assertTrue(!r.allowed, 'Should be blocked');
  assertEqual(r.reason, 'DENIED_THIS_SESSION', 'Reason');
});

test('deny() overrides previous confirm', () => {
  const gate = new HumanGate();
  gate.confirm('fs.write');
  assertTrue(gate.check('fs.write', {}).allowed, 'Should be allowed after confirm');
  gate.deny('fs.write');
  assertTrue(!gate.check('fs.write', {}).allowed, 'Should be blocked after deny');
});

// ────────────────────────────────────────────────────────────────────────────
// Unknown Tools
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Unknown Tools');

test('Unknown tools default to CONFIRM_ONCE', () => {
  const gate = new HumanGate();
  const r = gate.check('some.unknown.tool', { x: 1 });
  assertTrue(!r.allowed, 'Unknown tool should be gated');
  assertEqual(r.reason, 'CONFIRM_REQUIRED', 'Should require confirmation');
});

// ────────────────────────────────────────────────────────────────────────────
// setLevel
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 setLevel');

test('setLevel changes tool policy', () => {
  const gate = new HumanGate();
  gate.setLevel('web.search', GateLevel.ALWAYS_ASK);
  assertTrue(!gate.check('web.search', {}).allowed, 'Should now be gated');
});

test('getLevel returns current policy', () => {
  const gate = new HumanGate();
  assertEqual(gate.getLevel('web.search'), GateLevel.AUTO, 'Default for web.search');
  assertEqual(gate.getLevel('fs.write'), GateLevel.CONFIRM_ONCE, 'Default for fs.write');
  assertEqual(gate.getLevel('shell.exec'), GateLevel.ALWAYS_ASK, 'Default for shell.exec');
});

// ────────────────────────────────────────────────────────────────────────────
// Reset Session
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Reset');

test('resetSession clears confirmations and denials', () => {
  const gate = new HumanGate();
  gate.confirm('fs.write');
  gate.deny('shell.exec');
  gate.resetSession();
  // fs.write should be gated again
  assertTrue(!gate.check('fs.write', {}).allowed, 'Should be gated after reset');
  // shell.exec should not be DENIED_THIS_SESSION but CONFIRM_REQUIRED
  assertEqual(gate.check('shell.exec', {}).reason, 'CONFIRM_REQUIRED', 'Should not be denied after reset');
});

// ────────────────────────────────────────────────────────────────────────────
// ToolExecutor Integration
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 ToolExecutor Integration');

await asyncTest('Gated tool returns GATED error from executor', async () => {
  // fs.write is CONFIRM_ONCE, not confirmed in this session
  const decision = toolCall('fs.write', { path: '/tmp/test.txt', content: 'hello' });
  const result = await toolExecutor.executeDecision(decision);

  assertTrue(!result.ok, 'Should not be ok');
  assertEqual(result.code, ToolError.GATED, 'Error code should be GATED');
  assertTrue(result.gated, 'Should be marked as gated');
  assertEqual(result.tool, 'fs.write', 'Should identify the tool');
});

await asyncTest('skipGate context bypasses gate', async () => {
  const decision = toolCall('fs.write', { path: '/tmp/gatetest.txt', content: 'bypass' });
  const result = await toolExecutor.execute(decision, { skipGate: true });

  // Will fail with FS error (path might not work), but NOT with GATED
  assertTrue(result.code !== ToolError.GATED, 'Should NOT be gated with skipGate');
});

await asyncTest('AUTO tools pass through gate in executor', async () => {
  const decision = toolCall('data.parse', { input: '{"test":true}' });
  const result = await toolExecutor.executeDecision(decision);

  assertTrue(result.ok, 'AUTO tool should pass through');
  assertEqual(result.data.data.test, true, 'Should parse correctly');
});

// ────────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Stats');

test('getStats returns confirmed and denied lists', () => {
  const gate = new HumanGate();
  gate.confirm('fs.write');
  gate.deny('shell.exec');
  const stats = gate.getStats();
  assertTrue(stats.confirmed.includes('fs.write'), 'Should list confirmed');
  assertTrue(stats.denied.includes('shell.exec'), 'Should list denied');
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
