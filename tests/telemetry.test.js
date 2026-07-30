// Telemetry Layer Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for TurnTelemetry model — passive data collection for resilience
// observability. Validates all recording methods, finalization, idempotency,
// and safety guarantees (never throws).
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'node:assert';
import { TurnTelemetry } from '../src/telemetry/turn-telemetry.js';
import { aggregate } from '../src/autonomy/aggregator.js';
import { config } from '../src/config.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// I. CONSTRUCTOR & IDENTITY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ I. Constructor & Identity ═══');

test('I.1 — Constructor sets IDs correctly', () => {
  const t = new TurnTelemetry('t-001', 'session-abc', 'conv-xyz');
  assert.equal(t.turnId, 't-001');
  assert.equal(t.sessionId, 'session-abc');
  assert.equal(t.conversationId, 'conv-xyz');
});

test('I.2 — Fresh instance has null/empty defaults', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  assert.equal(t.classification.intent, null);
  assert.equal(t.classification.classifiedBy, null);
  assert.equal(t.classification.confidence, null);
  assert.equal(t.classification.overrideApplied, false);
  assert.equal(t.execution.status, null);
  assert.equal(t.execution.retryCount, 0);
  assert.equal(t.execution.wasCancelled, false);
  assert.deepEqual(t.execution.toolsInvoked, []);
  assert.deepEqual(t.circuit.states, []);
  assert.equal(t.circuit.anyOpened, false);
  assert.equal(t._finalized, false);
});

// ════════════════════════════════════════════════════════════════════════════
// II. CLASSIFICATION RECORDING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ II. Classification Recording ═══');

test('II.1 — recordClassification captures all fields', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordClassification({
    intent: 'SEARCH',
    classifiedBy: 'llm',
    confidence: 0.92,
    classificationTimeMs: 245,
  });
  assert.equal(t.classification.intent, 'SEARCH');
  assert.equal(t.classification.classifiedBy, 'llm');
  assert.equal(t.classification.confidence, 0.92);
  assert.equal(t.classification.classificationTimeMs, 245);
});

test('II.2 — recordClassification handles partial input', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordClassification({ intent: 'LOCAL' });
  assert.equal(t.classification.intent, 'LOCAL');
  assert.equal(t.classification.classifiedBy, null);
  assert.equal(t.classification.confidence, null);
});

test('II.3 — recordDecision captures timing and override', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordDecision({
    decideTimeMs: 312,
    overrideApplied: true,
    overrideSource: 'first_turn_vague_input',
  });
  assert.equal(t.decideTimeMs, 312);
  assert.equal(t.classification.overrideApplied, true);
  assert.equal(t.classification.overrideSource, 'first_turn_vague_input');
});

test('II.4 — recordDecision defaults overrideApplied to false', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordDecision({ decideTimeMs: 5 });
  assert.equal(t.classification.overrideApplied, false);
  assert.equal(t.classification.overrideSource, null);
});

test('II.5 — v2 snapshot emits serializable, whitelisted CRE diagnostics', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  const cyclicValue = {};
  cyclicValue.self = cyclicValue;
  const followUp = {
    rule: 'explicit-search',
    confidence: Infinity,
    type: cyclicValue,
    privateDetail: 'must-not-persist',
  };
  const overrides = ['explicit_search_override', cyclicValue, 42];
  t.recordClassification({
    intent: 'SEARCH',
    diag: {
      initialIntent: 'AMBIGUOUS',
      finalIntent: 'SEARCH',
      isIntentBreak: 'yes',
      lastIntent: cyclicValue,
      followUp,
      overrides,
      privateDetail: 'must-not-persist',
    },
  });
  followUp.rule = 'mutated-after-recording';
  overrides[0] = 'mutated_after_recording';

  const snap = t.finalize(Date.now());
  assert.equal(snap.version, 2);
  assert.deepEqual(snap.classification.diag, {
    initialIntent: 'AMBIGUOUS',
    finalIntent: 'SEARCH',
    isIntentBreak: false,
    lastIntent: null,
    followUp: {
      rule: 'explicit-search',
      confidence: null,
      type: null,
    },
    overrides: ['explicit_search_override'],
  });
  assert.ok(Object.isFrozen(snap.classification.diag));
  assert.ok(Object.isFrozen(snap.classification.diag.followUp));
  assert.ok(Object.isFrozen(snap.classification.diag.overrides));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(snap)));
});

// ════════════════════════════════════════════════════════════════════════════
// III. TOOL INVOCATION RECORDING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ III. Tool Invocation Recording ═══');

test('III.1 — recordToolInvocation accumulates multiple tools', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordToolInvocation({ tool: 'web.search', durationMs: 1200, success: true, retryCount: 0 });
  t.recordToolInvocation({ tool: 'web.scrape', durationMs: 800, success: false, retryCount: 1, errorType: 'TIMEOUT' });
  assert.equal(t.execution.toolsInvoked.length, 2);
  assert.equal(t.execution.toolsInvoked[0].tool, 'web.search');
  assert.equal(t.execution.toolsInvoked[0].success, true);
  assert.equal(t.execution.toolsInvoked[1].tool, 'web.scrape');
  assert.equal(t.execution.toolsInvoked[1].success, false);
  assert.equal(t.execution.toolsInvoked[1].errorType, 'TIMEOUT');
});

test('III.2 — retryCount accumulates globally', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordToolInvocation({ tool: 'search', retryCount: 1 });
  t.recordToolInvocation({ tool: 'scrape', retryCount: 2 });
  assert.equal(t.execution.retryCount, 3);
});

test('III.3 — recordToolInvocation with missing fields uses defaults', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordToolInvocation({});
  assert.equal(t.execution.toolsInvoked[0].tool, 'unknown');
  assert.equal(t.execution.toolsInvoked[0].durationMs, 0);
  assert.equal(t.execution.toolsInvoked[0].success, false);
  assert.equal(t.execution.toolsInvoked[0].retryCount, 0);
  assert.equal(t.execution.toolsInvoked[0].errorType, null);
});

// ════════════════════════════════════════════════════════════════════════════
// IV. CIRCUIT BREAKER RECORDING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ IV. Circuit Breaker Recording ═══');

test('IV.1 — recordCircuitState tracks before/after', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCircuitState({ tool: 'web.search', stateBefore: 'CLOSED', stateAfter: 'CLOSED' });
  assert.equal(t.circuit.states.length, 1);
  assert.equal(t.circuit.states[0].stateBefore, 'CLOSED');
  assert.equal(t.circuit.states[0].stateAfter, 'CLOSED');
  assert.equal(t.circuit.anyOpened, false);
});

test('IV.2 — anyOpened set inline when stateAfter is OPEN', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCircuitState({ tool: 'web.search', stateBefore: 'CLOSED', stateAfter: 'OPEN' });
  assert.equal(t.circuit.anyOpened, true);
});

test('IV.3 — anyOpened stays true after subsequent non-OPEN transitions', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCircuitState({ tool: 'search', stateBefore: 'CLOSED', stateAfter: 'OPEN' });
  t.recordCircuitState({ tool: 'scrape', stateBefore: 'CLOSED', stateAfter: 'CLOSED' });
  assert.equal(t.circuit.anyOpened, true);
  assert.equal(t.circuit.states.length, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// V. CANCEL RECORDING
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ V. Cancel Recording ═══');

test('V.1 — recordCancel sets wasCancelled and abortSource', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCancel('user');
  assert.equal(t.execution.wasCancelled, true);
  assert.equal(t.execution.abortSource, 'user');
});

test('V.2 — recordCancel with timeout source', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCancel('timeout');
  assert.equal(t.execution.wasCancelled, true);
  assert.equal(t.execution.abortSource, 'timeout');
});

test('V.3 — recordCancel with null source defaults to unknown', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCancel(null);
  assert.equal(t.execution.wasCancelled, true);
  assert.equal(t.execution.abortSource, 'unknown');
});

// ════════════════════════════════════════════════════════════════════════════
// VI. EXECUTION SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ VI. Execution Summary ═══');

test('VI.1 — recordExecution captures status and timing', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordExecution({ executionTimeMs: 2500, status: 'SUCCESS', partialFailure: false });
  assert.equal(t.execution.executionTimeMs, 2500);
  assert.equal(t.execution.status, 'SUCCESS');
  assert.equal(t.execution.partialFailure, false);
});

test('VI.2 — recordExecution with partial failure', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordExecution({ executionTimeMs: 3100, status: 'PARTIAL', partialFailure: true });
  assert.equal(t.execution.status, 'PARTIAL');
  assert.equal(t.execution.partialFailure, true);
});

// ════════════════════════════════════════════════════════════════════════════
// VII. FINALIZATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ VII. Finalization ═══');

test('VII.1 — finalize returns frozen snapshot with version', () => {
  const t = new TurnTelemetry('t-001', 'sess-1', 'conv-1');
  t.recordClassification({ intent: 'SEARCH', classifiedBy: 'llm', confidence: 0.9, classificationTimeMs: 200 });
  t.recordDecision({ decideTimeMs: 250, overrideApplied: false });
  t.recordToolInvocation({ tool: 'web.search', durationMs: 1000, success: true, retryCount: 0 });
  t.recordCircuitState({ tool: 'web.search', stateBefore: 'CLOSED', stateAfter: 'CLOSED' });
  t.recordExecution({ executionTimeMs: 1050, status: 'SUCCESS', partialFailure: false });

  const turnStart = Date.now() - 1500; // simulate 1.5s ago
  const snap = t.finalize(turnStart);

  assert.equal(snap.version, 2);
  assert.equal(snap.turnId, 't-001');
  assert.equal(snap.sessionId, 'sess-1');
  assert.equal(snap.conversationId, 'conv-1');

  // Timing
  assert.equal(snap.timing.classificationTimeMs, 200);
  assert.equal(snap.timing.decideTimeMs, 250);
  assert.equal(snap.timing.executionTimeMs, 1050);
  assert.ok(snap.timing.totalTurnTimeMs >= 1400, `totalTurnTimeMs should be >= 1400, got ${snap.timing.totalTurnTimeMs}`);

  // Classification
  assert.equal(snap.classification.intent, 'SEARCH');
  assert.equal(snap.classification.classifiedBy, 'llm');
  assert.equal(snap.classification.confidence, 0.9);
  assert.equal(snap.classification.overrideApplied, false);
  assert.equal(snap.classification.diag, null);

  // Execution
  assert.equal(snap.execution.toolsInvoked.length, 1);
  assert.equal(snap.execution.toolsInvoked[0].tool, 'web.search');
  assert.equal(snap.execution.status, 'SUCCESS');
  assert.equal(snap.execution.retryCount, 0);
  assert.equal(snap.execution.wasCancelled, false);

  // Circuit
  assert.equal(snap.circuit.states.length, 1);
  assert.equal(snap.circuit.anyOpened, false);
});

test('VII.2 — finalize freezes the snapshot', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  const snap = t.finalize(Date.now());
  assert.ok(Object.isFrozen(snap), 'Snapshot should be frozen');
  assert.ok(Object.isFrozen(snap.timing), 'timing should be frozen');
  assert.ok(Object.isFrozen(snap.classification), 'classification should be frozen');
  assert.ok(Object.isFrozen(snap.execution), 'execution should be frozen');
  assert.ok(Object.isFrozen(snap.circuit), 'circuit should be frozen');
});

test('VII.3 — finalize is idempotent (second call returns same snapshot)', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordClassification({ intent: 'LOCAL', classifiedBy: 'deterministic' });
  const snap1 = t.finalize(Date.now());

  // Try to modify after finalize
  t.recordClassification({ intent: 'SEARCH', classifiedBy: 'llm' });
  const snap2 = t.finalize(Date.now());

  assert.strictEqual(snap1, snap2, 'Second finalize should return same object');
  assert.equal(snap1.classification.intent, 'LOCAL', 'Intent should not change after finalize');
});

test('VII.4 — recording after finalize is a no-op', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.finalize(Date.now());

  // These should silently do nothing
  t.recordClassification({ intent: 'SEARCH' });
  t.recordDecision({ decideTimeMs: 999 });
  t.recordToolInvocation({ tool: 'test' });
  t.recordCircuitState({ tool: 'test', stateBefore: 'CLOSED', stateAfter: 'OPEN' });
  t.recordCancel('user');
  t.recordExecution({ executionTimeMs: 5000 });

  const snap = t.finalize(Date.now());
  assert.equal(snap.classification.intent, null, 'Intent should remain null');
  assert.equal(snap.execution.toolsInvoked.length, 0, 'No tools should be recorded');
  assert.equal(snap.circuit.anyOpened, false, 'Circuit should not show as opened');
  assert.equal(snap.execution.wasCancelled, false, 'Should not show as cancelled');
});

test('VII.5 — finalize with null turnStartTime produces null totalTurnTimeMs', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  const snap = t.finalize(null);
  assert.equal(snap.timing.totalTurnTimeMs, null);
});

// ════════════════════════════════════════════════════════════════════════════
// VIII. SAFETY GUARANTEES
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ VIII. Safety Guarantees ═══');

test('VIII.1 — recording methods do not throw on undefined input', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordClassification(undefined);
  t.recordDecision(undefined);
  t.recordToolInvocation(undefined);
  t.recordCircuitState(undefined);
  t.recordExecution(undefined);
  t.recordClassification(null);
  t.recordDecision(null);
  t.recordToolInvocation(null);
  t.recordCircuitState(null);
  t.recordExecution(null);
  assert.equal(t.classification.intent, null);
  assert.equal(t.execution.toolsInvoked.length, 2);
  assert.equal(t.circuit.states.length, 2);
});

test('VIII.2 — recordToolInvocation does not throw on empty object', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordToolInvocation({});
  assert.equal(t.execution.toolsInvoked.length, 1);
});

test('VIII.3 — recordCircuitState does not throw on empty object', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordCircuitState({});
  assert.equal(t.circuit.states.length, 1);
  assert.equal(t.circuit.states[0].tool, 'unknown');
});

test('VIII.4 — multiple recording methods can be chained without issues', () => {
  const t = new TurnTelemetry('t-001', 's', 'c');
  t.recordClassification({ intent: 'REPORT', classifiedBy: 'llm', confidence: 0.85, classificationTimeMs: 300 });
  t.recordDecision({ decideTimeMs: 350, overrideApplied: true, overrideSource: 'sticky_intent' });
  t.recordToolInvocation({ tool: 'web.search', durationMs: 900, success: true, retryCount: 0 });
  t.recordToolInvocation({ tool: 'web.scrape', durationMs: 1200, success: true, retryCount: 0 });
  t.recordCircuitState({ tool: 'web.search', stateBefore: 'CLOSED', stateAfter: 'CLOSED' });
  t.recordCircuitState({ tool: 'web.scrape', stateBefore: 'CLOSED', stateAfter: 'CLOSED' });
  t.recordExecution({ executionTimeMs: 2200, status: 'SUCCESS', partialFailure: false });

  const snap = t.finalize(Date.now() - 3000);

  assert.equal(snap.version, 2);
  assert.equal(snap.classification.intent, 'REPORT');
  assert.equal(snap.classification.overrideApplied, true);
  assert.equal(snap.classification.overrideSource, 'sticky_intent');
  assert.equal(snap.execution.toolsInvoked.length, 2);
  assert.equal(snap.execution.status, 'SUCCESS');
  assert.equal(snap.circuit.states.length, 2);
  assert.equal(snap.circuit.anyOpened, false);
  assert.ok(snap.timing.totalTurnTimeMs >= 2900);
});

// ════════════════════════════════════════════════════════════════════════════
// IX. FEATURE FLAG
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ IX. Feature Flag ═══');

test('IX.1 — config.features.telemetry exists and defaults to true', () => {
  assert.equal(typeof config.features.telemetry, 'boolean');
  // Default is true (unless C3_ENABLE_TELEMETRY is 'false')
  if (!process.env.C3_ENABLE_TELEMETRY) {
    assert.equal(config.features.telemetry, true);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// X. FULL TURN SIMULATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ X. Full Turn Simulation ═══');

test('X.1 — Full TOOL_CALL turn produces complete snapshot', () => {
  const turnStart = Date.now();
  const t = new TurnTelemetry('t-042', 'ws-session-7', 'conv-main');

  // CRE classification
  t.recordClassification({
    intent: 'SEARCH',
    classifiedBy: 'llm',
    confidence: 0.88,
    classificationTimeMs: 420,
  });
  t.recordDecision({ decideTimeMs: 480 });

  // Tool execution
  t.recordToolInvocation({
    tool: 'web.search',
    durationMs: 1100,
    success: true,
    retryCount: 0,
  });
  t.recordCircuitState({
    tool: 'web.search',
    stateBefore: 'CLOSED',
    stateAfter: 'CLOSED',
  });
  t.recordExecution({
    executionTimeMs: 1200,
    status: 'SUCCESS',
    partialFailure: false,
  });

  const snap = t.finalize(turnStart);

  // Verify full structure
  assert.equal(snap.version, 2);
  assert.equal(snap.turnId, 't-042');
  assert.equal(snap.sessionId, 'ws-session-7');
  assert.equal(snap.conversationId, 'conv-main');
  assert.ok(snap.timing.totalTurnTimeMs >= 0);
  assert.equal(snap.classification.intent, 'SEARCH');
  assert.equal(snap.execution.status, 'SUCCESS');
  assert.equal(snap.execution.wasCancelled, false);
  assert.equal(snap.circuit.anyOpened, false);
});

test('X.2 — Deterministic turn (no execution) produces minimal snapshot', () => {
  const t = new TurnTelemetry('t-043', 's', 'c');
  t.recordClassification({
    intent: 'LOCAL',
    classifiedBy: 'deterministic',
    confidence: 1.0,
    classificationTimeMs: 0,
  });
  t.recordDecision({ decideTimeMs: 1 });

  const snap = t.finalize(Date.now());
  assert.equal(snap.classification.classifiedBy, 'deterministic');
  assert.equal(snap.execution.status, null); // no execution happened
  assert.equal(snap.execution.toolsInvoked.length, 0);
});

test('X.3 — Cancelled turn records cancel correctly', () => {
  const t = new TurnTelemetry('t-044', 's', 'c');
  t.recordClassification({ intent: 'SEARCH', classifiedBy: 'llm' });
  t.recordToolInvocation({ tool: 'web.search', durationMs: 500, success: false, errorType: 'TIMEOUT' });
  t.recordCancel('user');

  const snap = t.finalize(Date.now() - 600);
  assert.equal(snap.execution.wasCancelled, true);
  assert.equal(snap.execution.abortSource, 'user');
  assert.equal(snap.execution.toolsInvoked[0].errorType, 'TIMEOUT');
});

test('X.4 — Partial failure turn with circuit breaker opening', () => {
  const t = new TurnTelemetry('t-045', 's', 'c');
  t.recordClassification({ intent: 'REPORT', classifiedBy: 'llm', confidence: 0.9 });
  t.recordDecision({ decideTimeMs: 300 });

  // Search succeeds
  t.recordToolInvocation({ tool: 'web.search', durationMs: 800, success: true, retryCount: 0 });
  t.recordCircuitState({ tool: 'web.search', stateBefore: 'CLOSED', stateAfter: 'CLOSED' });

  // Scrape fails and trips circuit breaker
  t.recordToolInvocation({ tool: 'web.scrape', durationMs: 30000, success: false, retryCount: 1, errorType: 'TIMEOUT' });
  t.recordCircuitState({ tool: 'web.scrape', stateBefore: 'CLOSED', stateAfter: 'OPEN' });

  t.recordExecution({ executionTimeMs: 31000, status: 'PARTIAL', partialFailure: true });

  const snap = t.finalize(Date.now() - 32000);
  assert.equal(snap.execution.status, 'PARTIAL');
  assert.equal(snap.execution.partialFailure, true);
  assert.equal(snap.execution.retryCount, 1);
  assert.equal(snap.circuit.anyOpened, true);
  assert.equal(snap.circuit.states.length, 2);
  assert.equal(snap.circuit.states[1].stateAfter, 'OPEN');
  assert.ok(snap.timing.totalTurnTimeMs >= 31000);
});

// ════════════════════════════════════════════════════════════════════════════
// XI. MIXED-VERSION AGGREGATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n═══ XI. Mixed-Version Aggregation ═══');

test('XI.1 — autonomy rates and volume use only eligible v2 diagnostics', () => {
  const rows = [
    { snapshot_json: JSON.stringify({ version: 1, classification: { diag: null } }) },
    { snapshot_json: JSON.stringify({
      version: 1,
      classification: {
        diag: { finalIntent: 'LOCAL', overrides: ['legacy_override'] },
      },
    }) },
    { snapshot_json: JSON.stringify({
      version: 2,
      classification: {
        diag: {
          initialIntent: 'AMBIGUOUS',
          finalIntent: 'AMBIGUOUS',
          isIntentBreak: false,
          followUp: null,
          overrides: null,
        },
      },
    }) },
    { snapshot_json: JSON.stringify({ version: 2, classification: { diag: null } }) },
    { snapshot_json: JSON.stringify({
      version: 2,
      classification: {
        diag: {
          initialIntent: 'LOCAL',
          finalIntent: 'LOCAL',
          isIntentBreak: 'false',
          followUp: null,
          overrides: [],
        },
      },
    }) },
    { snapshot_json: JSON.stringify({ version: 2, classification: { diag: 'malformed' } }) },
    { snapshot_json: '{' },
  ];
  let insertedMetrics = null;
  const result = aggregate({
    db: { prepare: () => ({ all: () => rows }) },
    telemetryMetrics: { add: { run: (...args) => { insertedMetrics = args; } } },
    telemetryAlerts: { add: { run: () => {} } },
    creEngine: { getOverrideThreshold: () => 0.7 },
    logger: { debug: () => {} },
  }, new Date('2026-07-30T00:15:00.000Z'));

  assert.equal(result.metrics.observedTurns, 7);
  assert.equal(result.metrics.totalTurns, 1);
  assert.equal(result.metrics.ambiguousCount, 1);
  assert.equal(result.metrics.askUserCount, 1);
  assert.equal(result.metrics.overrideCount, 0);
  assert.equal(insertedMetrics[2], 1, 'persisted denominator must count only eligible v2 diagnostics');
  assert.equal(result.lowVolume, 1 < config.autonomy.minTurnsPerWindow);
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
}
console.log('════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
