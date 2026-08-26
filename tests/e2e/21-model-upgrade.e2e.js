// tests/e2e/21-model-upgrade.e2e.js — Manual binding application/rollback
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

await testAsync('rollback without exact recovery identity returns error', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/rollback', {
    role: 'CHAT'
  });
  assertEqual(status, 400);
  assert(data.error.includes('Missing required rollback identity'), 'exact-identity error required');
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

// ── Current evaluation read model ──────────────────────────────────────────
suite('Model Evaluation State');

await testAsync('GET evaluations exposes the current exact-contract authority', async () => {
  const { status, data } = await api('GET', '/api/system/models/evaluations');
  assertEqual(status, 200);
  assert(data.authority.tables.includes('model_evaluation_runs'), 'run authority required');
  assert(data.authority.tables.includes('model_evaluation_decisions'), 'decision authority required');
  assertEqual(data.authority.legacyFallback, false);
  assert(data.roles && data.roles.CODE && data.roles.CHAT, 'role contracts required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
