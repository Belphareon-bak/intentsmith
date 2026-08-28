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
  const { status, data } = await api('POST', '/api/system/gpu/refresh');
  assertEqual(status, 200);
  assert(Array.isArray(data.profile?.gpus), 'refreshed profile.gpus must be array');
  assert(data.recommendation && typeof data.recommendation === 'object', 'recommendation required');
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
  assert(typeof data.ollama_url === 'string' && data.ollama_url.length > 0, 'ollama_url required');
  assert(typeof data.current_model === 'string' && data.current_model.length > 0, 'current_model required');
});

await testAsync('GET /api/system/models/compatibility returns tiers', async () => {
  const { status, data } = await api('GET', '/api/system/models/compatibility');
  assertEqual(status, 200);
  assert(typeof data.vram_mb === 'number', 'vram_mb must be numeric');
  assert(typeof data.is_igpu === 'boolean', 'is_igpu must be boolean');
  assert(Array.isArray(data.tiers), 'tiers must be array');
  assert(Array.isArray(data.recommendations), 'recommendations must be array');
});

await testAsync('GET /api/system/models/check without model param handled', async () => {
  const { status, data } = await api('GET', '/api/system/models/check');
  assertEqual(status, 400);
  assert(typeof data.error === 'string' && data.error.includes('model'), 'model error required');
});

// ── Storage ─────────────────────────────────────────────────────────────────
suite('System Storage');

await testAsync('GET /api/system/storage returns shape', async () => {
  const { status, data } = await api('GET', '/api/system/storage');
  assertEqual(status, 200);
  assert(typeof data.db_size_mb === 'number', 'db_size_mb must be numeric');
  assert(typeof data.messages_in_db === 'number', 'messages_in_db must be numeric');
  assert(data.history && typeof data.history.total_mb === 'number', 'history metrics required');
  assert(data.backups && typeof data.backups.count === 'number', 'backup metrics required');
});

await testAsync('GET /api/system/storage/settings returns config', async () => {
  const { status, data } = await api('GET', '/api/system/storage/settings');
  assertEqual(status, 200);
  assert(data.retention && typeof data.retention.conversations === 'number', 'retention config required');
  assert(data.backup && typeof data.backup.on_shutdown === 'boolean', 'backup config required');
  assert(data.drain && typeof data.drain.enabled === 'boolean', 'drain config required');
  assert(data.clean && typeof data.clean.enabled === 'boolean', 'clean config required');
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
  assert(typeof data.db_rows_pruned === 'number', 'db_rows_pruned must be numeric');
  assert(typeof data.history_files_pruned === 'number', 'history_files_pruned must be numeric');
  assert(typeof data.jsonl_cleaned === 'number', 'jsonl_cleaned must be numeric');
  assert(typeof data.pressure === 'string', 'pressure must be a string');
});

// ── Upgrades ────────────────────────────────────────────────────────────────
suite('System Upgrades');

await testAsync('GET /api/system/upgrades returns shape', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades');
  assertEqual(status, 200);
  assertEqual(data.authority.discoveryOnly, true);
  assertEqual(data.authority.qualityRecommendation, false);
  assert(Array.isArray(data.history), 'history must be array');
});

await testAsync('GET /api/system/upgrades/bindings returns bindings', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/bindings');
  assertEqual(status, 200);
  assert(data.bindings, 'bindings required');
  assert(typeof data.bindings === 'object', 'bindings must be object');
  assert(typeof data.overrides === 'object', 'overrides must be object');
  assert(typeof data.configVersion === 'number', 'configVersion must be numeric');
});

await testAsync('removed heuristic scoring endpoint stays absent', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/scoring');
  assertEqual(status, 404);
});

await testAsync('GET /api/system/catalog returns entries', async () => {
  const { status, data } = await api('GET', '/api/system/catalog');
  assertEqual(status, 200);
  assert(Array.isArray(data.entries), 'entries must be array');
  assertEqual(data.total, data.entries.length);
  assert(typeof data.catalogVersion === 'string', 'catalogVersion required');
  assert(typeof data.catalogHash === 'string', 'catalogHash required');
});

await testAsync('removed heuristic proposals endpoint stays absent', async () => {
  const { status, data } = await api('GET', '/api/system/proposals');
  assertEqual(status, 404);
});

await testAsync('GET /api/system/upgrades/discovered returns models', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/discovered');
  assertEqual(status, 200);
  assert(Array.isArray(data.models), 'models must be array');
  assertEqual(data.count, data.models.length);
});

await testAsync('GET /api/system/models/candidates is discovery-only', async () => {
  const { status, data } = await api('GET', '/api/system/models/candidates');
  assertEqual(status, 200);
  assert(Array.isArray(data.candidates), 'candidate inventory must be array');
  assertEqual(data.authority.discoveryOnly, true);
  assertEqual(data.authority.qualityRecommendation, false);
  assert(typeof data.gpuVramMb === 'number', 'gpuVramMb must be numeric');
});

// ── Upgrade Apply Error Paths ───────────────────────────────────────────────
suite('Upgrade Error Paths');

await testAsync('apply with invalid role returns 400', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/apply', {
    role: 'INVALID_ROLE',
    targetModel: 'nonexistent-model'
  });
  assertEqual(status, 400);
  assert(data.error.includes('Invalid role'), 'invalid-role error required');
});

await testAsync('rollback with invalid role returns 400', async () => {
  const { status, data } = await api('POST', '/api/system/upgrades/rollback', {
    role: 'INVALID_ROLE'
  });
  assertEqual(status, 400);
  assert(data.error.includes('Invalid role'), 'invalid-role error required');
});

await testAsync('removed proposal dismissal endpoint stays absent', async () => {
  const { status, data } = await api('POST', '/api/system/proposals/999999999/dismiss');
  assertEqual(status, 404);
});

// ── Model evaluations ──────────────────────────────────────────────────────
suite('Model Evaluations');

await testAsync('GET current evaluations returns authoritative shape', async () => {
  const { status, data } = await api('GET', '/api/system/models/evaluations');
  assertEqual(status, 200);
  assert(data.roles && typeof data.roles === 'object', 'role evaluations required');
  assertEqual(data.authority.currentContractOnly, true);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
