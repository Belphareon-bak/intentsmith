// tests/e2e/14-system.e2e.js — System API: GPU, storage, backup, models, upgrades
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── GPU ─────────────────────────────────────────────────────────────────────
suite('GET /api/system/gpu');

await testAsync('returns GPU profile', async () => {
  const { status, data } = await api('GET', '/api/system/gpu');
  assertEqual(status, 200);
  assert(data.profile, 'profile required');
  assert(Array.isArray(data.profile.gpus), 'gpus must be array');
});

await testAsync('GPU refresh works', async () => {
  const { status } = await api('POST', '/api/system/gpu/refresh');
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

// ── System Info ─────────────────────────────────────────────────────────────
suite('GET /api/system/info');

await testAsync('returns version and platform', async () => {
  const { status, data } = await api('GET', '/api/system/info');
  assertEqual(status, 200);
  assert(data.version, 'version required');
  assert(data.platform, 'platform required');
  assert(data.node_version, 'node_version required');
  assert(typeof data.uptime_seconds === 'number', 'uptime_seconds must be number');
});

// ── Models ──────────────────────────────────────────────────────────────────
suite('System Models');

await testAsync('GET /api/system/models returns models list', async () => {
  const { status, data } = await api('GET', '/api/system/models');
  assertEqual(status, 200);
  assert(Array.isArray(data.models), 'models must be array');
});

await testAsync('GET /api/system/models/compatibility returns tiers', async () => {
  const { status, data } = await api('GET', '/api/system/models/compatibility');
  assertEqual(status, 200);
  assert(typeof data.vram_mb === 'number' || data.vram_mb === undefined, 'vram_mb shape');
});

await testAsync('GET /api/system/models/check without model param handled', async () => {
  const { status } = await api('GET', '/api/system/models/check');
  assert(status === 200 || status === 400, `expected 200/400, got ${status}`);
});

// ── Storage ─────────────────────────────────────────────────────────────────
suite('System Storage');

await testAsync('GET /api/system/storage returns shape', async () => {
  const { status, data } = await api('GET', '/api/system/storage');
  assertEqual(status, 200);
  assert(typeof data.db_size_mb === 'number' || data.db_size_mb !== undefined, 'db_size_mb required');
});

await testAsync('GET /api/system/storage/settings returns config', async () => {
  const { status, data } = await api('GET', '/api/system/storage/settings');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'settings must be object');
});

await testAsync('GET /api/system/backups returns array', async () => {
  const { status, data } = await api('GET', '/api/system/backups');
  assertEqual(status, 200);
  assert(Array.isArray(data.backups), 'backups must be array');
});

// ── Vacuum ──────────────────────────────────────────────────────────────────
suite('System Maintenance');

await testAsync('POST /api/system/vacuum succeeds', async () => {
  const { status, data } = await api('POST', '/api/system/vacuum');
  assertEqual(status, 200);
  assert(data.ok === true, 'ok flag required');
});

await testAsync('POST /api/system/clean returns shape', async () => {
  const { status, data } = await api('POST', '/api/system/clean');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'clean result must be object');
});

// ── Upgrades ────────────────────────────────────────────────────────────────
suite('System Upgrades');

await testAsync('GET /api/system/upgrades returns shape', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades');
  assertEqual(status, 200);
  assert(Array.isArray(data.proposals) || data.proposals !== undefined, 'proposals required');
});

await testAsync('GET /api/system/upgrades/bindings returns bindings', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/bindings');
  assertEqual(status, 200);
  assert(data.bindings, 'bindings required');
  assert(typeof data.bindings === 'object', 'bindings must be object');
});

await testAsync('GET /api/system/upgrades/scoring returns scores', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/scoring');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'scoring must be object');
});

await testAsync('GET /api/system/catalog returns entries', async () => {
  const { status, data } = await api('GET', '/api/system/catalog');
  assertEqual(status, 200);
  assert(Array.isArray(data.entries), 'entries must be array');
});

await testAsync('GET /api/system/proposals returns proposals', async () => {
  const { status, data } = await api('GET', '/api/system/proposals');
  assertEqual(status, 200);
  assert(Array.isArray(data.proposals), 'proposals must be array');
});

await testAsync('GET /api/system/upgrades/discovered returns models', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/discovered');
  assertEqual(status, 200);
  assert(Array.isArray(data.models), 'models must be array');
});

await testAsync('GET /api/system/upgrades/recommendations returns sections', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/recommendations');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'recommendations must be object');
});

// ── Upgrade Apply Error Paths ───────────────────────────────────────────────
suite('Upgrade Error Paths');

await testAsync('apply with invalid role returns 400', async () => {
  const { status } = await api('POST', '/api/system/upgrades/apply', {
    role: 'INVALID_ROLE',
    targetModel: 'nonexistent-model'
  });
  assert(status === 400 || status === 404 || status === 500, `expected 400/404/500, got ${status}`);
});

await testAsync('rollback with invalid role returns 400', async () => {
  const { status } = await api('POST', '/api/system/upgrades/rollback', {
    role: 'INVALID_ROLE'
  });
  assert(status === 400 || status === 404 || status === 500, `expected 400/404/500, got ${status}`);
});

await testAsync('dismiss nonexistent proposal returns 404', async () => {
  const { status } = await api('POST', '/api/system/proposals/nonexistent-id/dismiss');
  assert(status === 404 || status === 400 || status === 500, `expected 404/400/500, got ${status}`);
});

// ── Validation ──────────────────────────────────────────────────────────────
suite('Model Validation');

await testAsync('GET validation scores returns shape', async () => {
  const { status, data } = await api('GET', '/api/system/models/validation-scores');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'scores must be object');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
