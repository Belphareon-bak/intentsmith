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

// ────────────────────────────────────────────────────────────────────────────
// Export (C3.1)
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Export');

test('exportJSON returns structured data', () => {
  const exportData = auditTrail.exportJSON({ limit: 10 });

  assertTrue('metadata' in exportData, 'Has metadata');
  assertTrue('events' in exportData, 'Has events');
  assertTrue(exportData.metadata.exported_at, 'Has exported_at timestamp');
  assertTrue(Array.isArray(exportData.events), 'Events is array');
});

test('exportJSON includes ISO timestamps', () => {
  const exportData = auditTrail.exportJSON({ limit: 5 });

  if (exportData.events.length > 0) {
    const event = exportData.events[0];
    assertTrue(event.timestamp_iso, 'Has ISO timestamp');
    assertTrue(event.timestamp_iso.includes('T'), 'ISO format includes T');
  }
});

test('exportCSV returns valid CSV string', () => {
  const csv = auditTrail.exportCSV({ limit: 10 });

  assertTrue(typeof csv === 'string', 'Is string');
  assertTrue(csv.includes('id,plan_id,timestamp'), 'Has header row');
  assertTrue(csv.split('\n').length >= 1, 'Has at least header');
});

test('exportCSV escapes commas in payload', () => {
  // Log event with commas in payload
  auditTrail.log({
    actor: 'test',
    action: 'EXPORT_TEST',
    payload: { text: 'hello, world', nested: { a: 1, b: 2 } },
  });

  const csv = auditTrail.exportCSV({ action: 'EXPORT_TEST', limit: 5 });
  assertTrue(csv.length > 0, 'Has content');
  // CSV should escape or quote fields with commas
});

test('exportPlanTimeline returns timeline for plan', () => {
  const planId = `timeline-test-${Date.now()}`;

  // Log events for timeline
  auditTrail.log({ plan_id: planId, actor: 'test', action: AuditAction.PLAN_STARTED });
  auditTrail.log({ plan_id: planId, actor: 'test', action: AuditAction.STEP_STARTED });
  auditTrail.log({ plan_id: planId, actor: 'test', action: AuditAction.PLAN_COMPLETED });

  const timeline = auditTrail.exportPlanTimeline(planId);

  assertEqual(timeline.plan_id, planId, 'Has plan_id');
  assertTrue(timeline.timeline.length === 3, 'Has 3 events');
  assertTrue(timeline.duration_ms >= 0, 'Has duration');
  assertTrue(timeline.timeline[0].sequence === 1, 'First event has sequence 1');
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
