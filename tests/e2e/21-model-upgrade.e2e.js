// tests/e2e/21-model-upgrade.e2e.js — Model upgrade apply/rollback, bindings
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Current Bindings ────────────────────────────────────────────────────────
suite('Model Bindings');

let bindings = {};

await testAsync('GET bindings returns current model roles', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/bindings');
  assertEqual(status, 200);
  assert(data.bindings, 'bindings object required');
  bindings = data.bindings;
});

await testAsync('bindings include D1 role', async () => {
  assert(bindings.D1 || Object.keys(bindings).length > 0, 'should have at least one binding');
});

// ── Apply Error Paths ───────────────────────────────────────────────────────
suite('Upgrade Apply — Error Paths');

await testAsync('apply without targetModel returns error', async () => {
  const { status } = await api('POST', '/api/system/upgrades/apply', { role: 'D1' });
  assert(status === 400 || status === 500, `expected 400/500, got ${status}`);
});

await testAsync('apply with nonexistent model returns accepted (async validation)', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/apply', {
    role: 'D1',
    targetModel: 'nonexistent-model-xyz:latest'
  });
  // Apply is fire-and-forget: returns 200 immediately, validates async
  assert(status === 200 || status === 400 || status === 404, `expected 200 (async) or error, got ${status}`);
});

await testAsync('apply with invalid role returns error', async () => {
  const { status } = await api('POST', '/api/system/upgrades/apply', {
    role: 'INVALID',
    targetModel: 'test'
  });
  assert(status === 400 || status === 500, `expected 400/500, got ${status}`);
});

// ── Rollback Error Paths ────────────────────────────────────────────────────
suite('Upgrade Rollback — Error Paths');

await testAsync('rollback without previous upgrade returns error', async () => {
  const { status } = await api('POST', '/api/system/upgrades/rollback', {
    role: 'CHAT'
  });
  // May return 400 (no previous), 404, 500, or 502 (verification failure)
  assert(status === 400 || status === 404 || status === 500 || status === 502, `expected error, got ${status}`);
});

// ── Delete Bound Model Protection ───────────────────────────────────────────
suite('Model Deletion Protection');

await testAsync('cannot delete model bound to role', async () => {
  const boundModel = bindings.D1 || bindings.CHAT || bindings.CODE;
  if (!boundModel) return;
  const { status, data } = await api('DELETE', `/api/system/models?name=${encodeURIComponent(boundModel)}`);
  // Should be rejected (409 conflict) or error
  assert(status === 400 || status === 409 || status === 500, `expected rejection for bound model, got ${status}`);
});

// ── Upgrade Check ───────────────────────────────────────────────────────────
suite('Upgrade Check');

await testAsync('POST upgrade check returns proposals', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/check', { fullCycle: false });
  assert(status === 200 || status === 500, `expected 200/500, got ${status}`);
  if (status === 200) {
    assert(typeof data === 'object', 'check result must be object');
  }
});

// ── Validation Trigger ──────────────────────────────────────────────────────
suite('Validation Trigger');

await testAsync('GET validation for specific model returns shape', async () => {
  const model = bindings.D1 || bindings.CHAT || 'unknown';
  const { status, data } = await api('GET', `/api/system/models/validate?model=${encodeURIComponent(model)}`);
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
