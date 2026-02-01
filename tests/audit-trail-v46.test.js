// Audit Trail v46.0 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for immutable audit trail:
// - Event logging
// - Integrity verification (SHA256 hash)
// - Query by plan_id, action, recent
// - Statistics
//
// ══════════════════════════════════════════════════════════════════════════════

import { auditTrail, AuditAction } from '../src/audit/trail.js';

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
console.log('  Audit Trail v46.0 Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Event Logging
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Event Logging');

test('log returns event metadata', () => {
  const result = auditTrail.log({
    plan_id: 'test-plan-1',
    actor: 'test',
    action: AuditAction.PLAN_STARTED,
    payload: { input: 'test input' },
  });

  assertTrue(result.id !== null, 'Has ID');
  assertTrue(result.timestamp > 0, 'Has timestamp');
  assertTrue(result.payload_hash, 'Has payload hash');
  assertEqual(result.payload_hash.length, 64, 'Hash is SHA256 (64 hex chars)');
});

test('log without plan_id is allowed', () => {
  const result = auditTrail.log({
    actor: 'system',
    action: AuditAction.SYSTEM_START,
    payload: {},
  });

  assertTrue(result.id !== null, 'Has ID');
});

test('log without payload uses empty object', () => {
  const result = auditTrail.log({
    actor: 'test',
    action: AuditAction.TOOL_CALLED,
  });

  assertTrue(result.id !== null, 'Has ID');
  assertTrue(result.payload_hash, 'Has hash for empty payload');
});

// ────────────────────────────────────────────────────────────────────────────
// Integrity Verification
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Integrity Verification');

test('verifyIntegrity returns true for valid event', () => {
  const logged = auditTrail.log({
    plan_id: 'integrity-test',
    actor: 'test',
    action: AuditAction.PLAN_COMPLETED,
    payload: { result: 'success' },
  });

  const verification = auditTrail.verifyIntegrity(logged.id);
  assertTrue(verification.valid, 'Should be valid');
  assertEqual(verification.expected, verification.actual, 'Hashes should match');
});

test('verifyIntegrity returns error for non-existent event', () => {
  const verification = auditTrail.verifyIntegrity(999999);
  assertTrue(!verification.valid, 'Should not be valid');
  assertTrue(verification.error, 'Should have error message');
});

// ────────────────────────────────────────────────────────────────────────────
// Query
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Query');

test('getByPlanId returns events for plan', () => {
  const planId = `query-test-${Date.now()}`;

  // Log multiple events for same plan
  auditTrail.log({ plan_id: planId, actor: 'test', action: AuditAction.PLAN_STARTED });
  auditTrail.log({ plan_id: planId, actor: 'test', action: AuditAction.STEP_STARTED });
  auditTrail.log({ plan_id: planId, actor: 'test', action: AuditAction.PLAN_COMPLETED });

  const events = auditTrail.getByPlanId(planId);
  assertEqual(events.length, 3, 'Should have 3 events');
  assertEqual(events[0].action, AuditAction.PLAN_STARTED, 'First event');
  assertEqual(events[2].action, AuditAction.PLAN_COMPLETED, 'Last event');
});

test('getByPlanId returns empty for unknown plan', () => {
  const events = auditTrail.getByPlanId('non-existent-plan');
  assertEqual(events.length, 0, 'Should be empty');
});

test('getByAction returns events of specific type', () => {
  const uniqueAction = `CUSTOM_${Date.now()}`;

  // Log some events with custom action
  auditTrail.log({ actor: 'test', action: uniqueAction, payload: { n: 1 } });
  auditTrail.log({ actor: 'test', action: uniqueAction, payload: { n: 2 } });

  const events = auditTrail.getByAction(uniqueAction);
  assertTrue(events.length >= 2, 'Should have at least 2 events');
  assertTrue(events.every(e => e.action === uniqueAction), 'All should have correct action');
});

test('getRecent returns recent events', () => {
  const events = auditTrail.getRecent({ limit: 5 });
  assertTrue(events.length <= 5, 'Should respect limit');
  assertTrue(Array.isArray(events), 'Should be array');
});

test('getRecent respects since parameter', () => {
  const now = Date.now();

  // Log an event
  auditTrail.log({ actor: 'test', action: AuditAction.TOOL_CALLED });

  // Query with since=now should include the event
  const events = auditTrail.getRecent({ since: now - 1000 });
  assertTrue(events.length > 0, 'Should have events since 1s ago');
});

// ────────────────────────────────────────────────────────────────────────────
// Statistics
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Statistics');

test('getStats returns statistics', () => {
  const stats = auditTrail.getStats();

  assertTrue('total_events' in stats, 'Has total_events');
  assertTrue('events_24h' in stats, 'Has events_24h');
  assertTrue('by_action' in stats, 'Has by_action breakdown');
  assertTrue(typeof stats.total_events === 'number', 'total_events is number');
});

test('getStats by_action includes logged actions', () => {
  // Log some events
  auditTrail.log({ actor: 'test', action: AuditAction.PLAN_STARTED });

  const stats = auditTrail.getStats();
  assertTrue(AuditAction.PLAN_STARTED in stats.by_action, 'Should have PLAN_STARTED in breakdown');
});

// ────────────────────────────────────────────────────────────────────────────
// AuditAction Enum
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 AuditAction Enum');

test('AuditAction has plan lifecycle events', () => {
  assertTrue(AuditAction.PLAN_STARTED, 'Has PLAN_STARTED');
  assertTrue(AuditAction.PLAN_COMPLETED, 'Has PLAN_COMPLETED');
  assertTrue(AuditAction.PLAN_FAILED, 'Has PLAN_FAILED');
});

test('AuditAction has step events', () => {
  assertTrue(AuditAction.STEP_STARTED, 'Has STEP_STARTED');
  assertTrue(AuditAction.STEP_COMPLETED, 'Has STEP_COMPLETED');
  assertTrue(AuditAction.STEP_FAILED, 'Has STEP_FAILED');
});

test('AuditAction has tool events', () => {
  assertTrue(AuditAction.TOOL_CALLED, 'Has TOOL_CALLED');
  assertTrue(AuditAction.TOOL_RESULT, 'Has TOOL_RESULT');
  assertTrue(AuditAction.TOOL_GATED, 'Has TOOL_GATED');
});

test('AuditAction has gate events', () => {
  assertTrue(AuditAction.GATE_REQUESTED, 'Has GATE_REQUESTED');
  assertTrue(AuditAction.GATE_APPROVED, 'Has GATE_APPROVED');
  assertTrue(AuditAction.GATE_DENIED, 'Has GATE_DENIED');
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
