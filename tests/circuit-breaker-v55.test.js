// Circuit Breaker Tests v55
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitState } from '../src/executor/circuit-breaker.js';
import { CircuitBreakerRegistry } from '../src/executor/circuit-breaker.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n═══ Circuit Breaker Tests ═══\n');

// ── Initial state ───────────────────────────────────────────────────────────

console.log('── Initial state ──');

test('Starts CLOSED', () => {
  const cb = new CircuitBreaker();
  assert.equal(cb.state, CircuitState.CLOSED);
});

test('Initially allows requests', () => {
  const cb = new CircuitBreaker();
  const r = cb.canProceed();
  assert.equal(r.allowed, true);
  assert.equal(r.state, CircuitState.CLOSED);
});

test('Metrics start at zero', () => {
  const cb = new CircuitBreaker();
  const m = cb.getMetrics();
  assert.equal(m.total_calls, 0);
  assert.equal(m.total_successes, 0);
  assert.equal(m.total_failures, 0);
});

// ── CLOSED → OPEN ───────────────────────────────────────────────────────────

console.log('\n── CLOSED → OPEN ──');

test('Opens after failureThreshold failures', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, failureWindow: 60000 });
  cb.recordFailure(new Error('fail 1'));
  cb.recordFailure(new Error('fail 2'));
  assert.equal(cb.state, CircuitState.CLOSED, 'Still closed after 2');
  cb.recordFailure(new Error('fail 3'));
  assert.equal(cb.state, CircuitState.OPEN, 'Opens after 3');
});

test('OPEN blocks requests', () => {
  const cb = new CircuitBreaker({ failureThreshold: 2 });
  cb.recordFailure(new Error('1'));
  cb.recordFailure(new Error('2'));
  const r = cb.canProceed();
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'Circuit open');
});

test('Records blocked count', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1 });
  cb.recordFailure(new Error('1'));
  cb.canProceed(); // blocked
  cb.canProceed(); // blocked
  assert.equal(cb.getMetrics().total_blocked, 2);
});

// ── OPEN → HALF_OPEN ────────────────────────────────────────────────────────

console.log('\n── OPEN → HALF_OPEN ──');

test('Transitions to HALF_OPEN after resetTimeout', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10 }); // 10ms
  cb.recordFailure(new Error('1'));
  assert.equal(cb.state, CircuitState.OPEN);
  // Force time forward by manipulating openedAt
  cb.openedAt = Date.now() - 20; // 20ms ago
  const r = cb.canProceed();
  assert.equal(r.allowed, true);
  assert.equal(cb.state, CircuitState.HALF_OPEN);
});

test('HALF_OPEN limits requests', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0, halfOpenMaxRequests: 2 });
  cb.recordFailure(new Error('1'));
  const r1 = cb.canProceed(); // transitions to HALF_OPEN (doesn't count as halfOpenRequest)
  assert.equal(r1.allowed, true);
  assert.equal(cb.state, CircuitState.HALF_OPEN);
  const r2 = cb.canProceed(); // halfOpenRequests: 1
  assert.equal(r2.allowed, true);
  const r3 = cb.canProceed(); // halfOpenRequests: 2 = limit
  assert.equal(r3.allowed, true);
  const r4 = cb.canProceed(); // halfOpenRequests: 3 > limit → blocked
  assert.equal(r4.allowed, false);
  assert.ok(r4.reason.includes('Half-open limit'));
});

// ── HALF_OPEN → CLOSED ──────────────────────────────────────────────────────

console.log('\n── HALF_OPEN → CLOSED ──');

test('Closes after successThreshold successes', () => {
  const cb = new CircuitBreaker({
    failureThreshold: 1, resetTimeout: 0, successThreshold: 2,
  });
  cb.recordFailure(new Error('1'));
  cb.canProceed(); // → HALF_OPEN
  cb.recordSuccess();
  assert.equal(cb.state, CircuitState.HALF_OPEN, 'Still half-open after 1 success');
  cb.recordSuccess();
  assert.equal(cb.state, CircuitState.CLOSED, 'Closed after 2 successes');
});

// ── HALF_OPEN → OPEN ────────────────────────────────────────────────────────

console.log('\n── HALF_OPEN → OPEN (failure) ──');

test('Re-opens on failure in HALF_OPEN', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0 });
  cb.recordFailure(new Error('1'));
  cb.canProceed(); // → HALF_OPEN
  cb.recordFailure(new Error('2'));
  assert.equal(cb.state, CircuitState.OPEN);
});

// ── Failure window cleanup ──────────────────────────────────────────────────

console.log('\n── Failure window ──');

test('Old failures outside window are cleaned', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, failureWindow: 100 }); // 100ms window
  cb.recordFailure(new Error('old'));
  cb.recordFailure(new Error('old'));
  // Backdate failures
  cb.failures.forEach(f => f.timestamp = Date.now() - 200);
  cb.recordFailure(new Error('new'));
  // After cleanup, only 1 failure in window
  assert.equal(cb.state, CircuitState.CLOSED, 'Old failures cleaned, stays closed');
});

// ── Force operations ────────────────────────────────────────────────────────

console.log('\n── Force operations ──');

test('forceOpen works', () => {
  const cb = new CircuitBreaker();
  cb.forceOpen();
  assert.equal(cb.state, CircuitState.OPEN);
});

test('forceClose works', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1 });
  cb.recordFailure(new Error('1'));
  assert.equal(cb.state, CircuitState.OPEN);
  cb.forceClose();
  assert.equal(cb.state, CircuitState.CLOSED);
  assert.deepEqual(cb.failures, []);
});

// ── State changes tracked ───────────────────────────────────────────────────

console.log('\n── Metrics tracking ──');

test('State changes recorded in metrics', () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0, successThreshold: 1 });
  cb.recordFailure(new Error('1'));  // CLOSED→OPEN
  cb.canProceed();                   // OPEN→HALF_OPEN
  cb.recordSuccess();                // HALF_OPEN→CLOSED
  const changes = cb.getMetrics().state_changes;
  assert.equal(changes.length, 3);
  assert.equal(changes[0].from, 'CLOSED');
  assert.equal(changes[0].to, 'OPEN');
  assert.equal(changes[1].to, 'HALF_OPEN');
  assert.equal(changes[2].to, 'CLOSED');
});

test('getStatus returns useful info', () => {
  const cb = new CircuitBreaker({ failureThreshold: 2 });
  cb.recordFailure(new Error('1'));
  const s = cb.getStatus();
  assert.equal(s.state, CircuitState.CLOSED);
  assert.equal(s.failures_in_window, 1);
  assert.equal(s.failure_threshold, 2);
  assert.ok(s.last_failure);
});

// ── Registry ────────────────────────────────────────────────────────────────

console.log('\n── CircuitBreakerRegistry ──');

test('Registry creates breakers on demand', () => {
  const reg = new CircuitBreakerRegistry({ failureThreshold: 3 });
  const b = reg.getBreaker('tool-A');
  assert.ok(b instanceof CircuitBreaker);
  assert.equal(reg.getBreaker('tool-A'), b, 'Same instance returned');
});

test('Registry canProceed delegates', () => {
  const reg = new CircuitBreakerRegistry({ failureThreshold: 1 });
  assert.equal(reg.canProceed('tool-B').allowed, true);
  reg.recordFailure('tool-B', new Error('x'));
  assert.equal(reg.canProceed('tool-B').allowed, false);
});

test('Registry tracks open circuits', () => {
  const reg = new CircuitBreakerRegistry({ failureThreshold: 1 });
  reg.recordFailure('tool-C', new Error('x'));
  const open = reg.getOpenCircuits();
  assert.ok(open.includes('tool-C'));
});

test('Registry resetAll closes all', () => {
  const reg = new CircuitBreakerRegistry({ failureThreshold: 1 });
  reg.recordFailure('t1', new Error('x'));
  reg.recordFailure('t2', new Error('x'));
  assert.equal(reg.getOpenCircuits().length, 2);
  reg.resetAll();
  assert.equal(reg.getOpenCircuits().length, 0);
});

test('getAllStatus returns per-tool status', () => {
  const reg = new CircuitBreakerRegistry();
  reg.getBreaker('alpha');
  reg.getBreaker('beta');
  const status = reg.getAllStatus();
  assert.ok('alpha' in status);
  assert.ok('beta' in status);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);
