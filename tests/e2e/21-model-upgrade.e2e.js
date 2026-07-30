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
  assert(data.bindings && typeof data.bindings === 'object', 'bindings object required');
  assert(data.overrides && typeof data.overrides === 'object', 'overrides object required');
  assert(Number.isInteger(data.configVersion), 'configVersion integer required');
  bindings = data.bindings;
});

await testAsync('bindings include D1 role', async () => {
  assert(typeof bindings.D1 === 'string' && bindings.D1.length > 0, 'D1 binding required');
});

// ── Apply Error Paths ───────────────────────────────────────────────────────
suite('Upgrade Apply — Error Paths');

await testAsync('apply without targetModel returns error', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/apply', { role: 'D1' });
  assertEqual(status, 400);
  assert(data.error.includes('role, targetModel'), 'missing-field error required');
});

await testAsync('apply with invalid role returns error', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/apply', {
    role: 'INVALID',
    targetModel: 'test'
  });
  assertEqual(status, 400);
  assert(data.error.includes('Invalid role'), 'invalid-role error required');
});

// ── Rollback Error Paths ────────────────────────────────────────────────────
suite('Upgrade Rollback — Error Paths');

await testAsync('rollback without previous upgrade returns error', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/rollback', {
    role: 'CHAT'
  });
  assertEqual(status, 404);
  assert(data.error.includes('No override found'), 'missing-override error required');
});

await testAsync('rollback with invalid role is rejected before lookup', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/rollback', {
    role: 'INVALID',
  });
  assertEqual(status, 400);
  assert(data.error.includes('Invalid role'), 'invalid-role error required');
});

// ── Delete Bound Model Protection ───────────────────────────────────────────
suite('Model Deletion Protection');

await testAsync('cannot delete model bound to role', async () => {
  const boundModel = bindings.D1;
  const { status, data } = await api('DELETE', `/api/system/models?name=${encodeURIComponent(boundModel)}`);
  assertEqual(status, 409);
  assert(typeof data.error === 'string' && data.error.length > 0, 'bound-model error required');
});

// ── Validation Trigger ──────────────────────────────────────────────────────
suite('Validation Results');

await testAsync('GET validation requires a model', async () => {
  const { status, data } = await api('GET', '/api/system/models/validate');
  assertEqual(status, 400);
  assert(data.error.includes('Missing model'), 'missing-model error required');
});

await testAsync('GET validation returns an exact empty result for an unknown model', async () => {
  const model = 'nonexistent-model-xyz:latest';
  const { status, data } = await api('GET', `/api/system/models/validate?model=${encodeURIComponent(model)}`);
  assertEqual(status, 200);
  assertEqual(data.model, model);
  assertEqual(Object.keys(data.suites).length, 0);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
