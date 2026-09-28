// tests/e2e/01-health-smoke.e2e.js — Server health & system info
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, assertIncludes, assertMatch, summary, api, apiRaw, waitForServer, BASE_URL } from './_helpers.js';

await waitForServer();

// ── Health Endpoint ──────────────────────────────────────────────────────────
suite('GET /api/health');

await testAsync('returns 200 with status ok', async () => {
  const { status, data } = await api('GET', '/api/health');
  assertEqual(status, 200);
  assertEqual(data.status, 'ok');
});

await testAsync('has version in semver format', async () => {
  const { status, data } = await api('GET', '/api/health');
  assertEqual(status, 200);
  assert(typeof data.version === 'string', 'version must be string');
  assertMatch(data.version, /^\d+\.\d+\.\d+/, 'version should be semver-like');
});

// WP-M5-OBSERVE: public health exposes DB/recovery readiness; diagnostics are
// authenticated separately. Keep testing the actual accepted public contract.
await testAsync('has boolean readiness', async () => {
  const { status, data } = await api('GET', '/api/health');
  assertEqual(status, 200);
  assertEqual(data.ready, true);
});

await testAsync('reports database and completed lifecycle recovery', async () => {
  const { status, data } = await api('GET', '/api/health');
  assertEqual(status, 200);
  assertEqual(JSON.stringify(data.health), JSON.stringify({ database: true, lifecycleRecovery: true }));
});

await testAsync('does not expose process paths or provider details', async () => {
  const { status, data } = await api('GET', '/api/health');
  assertEqual(status, 200);
  for (const name of ['cwd', 'llm', 'databasePath', 'providerUrl']) {
    assertEqual(Object.hasOwn(data, name), false, `public health must not expose ${name}`);
  }
});

// ── System Info ──────────────────────────────────────────────────────────────
suite('GET /api/system/info');

await testAsync('returns system info with required fields', async () => {
  const { status, data } = await api('GET', '/api/system/info');
  assertEqual(status, 200);
  assert(typeof data.version === 'string', 'version required');
  assert(typeof data.platform === 'string', 'platform required');
  assert(typeof data.arch === 'string', 'arch required');
  assert(typeof data.node_version === 'string', 'node_version required');
  assert(typeof data.uptime_seconds === 'number', 'uptime_seconds required');
});

await testAsync('memory info present', async () => {
  const { status, data } = await api('GET', '/api/system/info');
  assertEqual(status, 200);
  assert(data.memory, 'memory object required');
  assert(typeof data.memory.total_mb === 'number', 'total_mb required');
  assert(typeof data.memory.process_mb === 'number', 'process_mb required');
});

await testAsync('db info present', async () => {
  const { status, data } = await api('GET', '/api/system/info');
  assertEqual(status, 200);
  assert(data.db, 'db object required');
  assert(typeof data.db.migrations === 'number', 'migrations should be number');
  assert(data.db.tables && typeof data.db.tables === 'object', 'should have tables object');
});

await testAsync('config present with chat_model', async () => {
  const { status, data } = await api('GET', '/api/system/info');
  assertEqual(status, 200);
  assert(data.config, 'config required');
  assert(typeof data.config.chat_model === 'string', 'chat_model required');
});

// ── 404 Handling ─────────────────────────────────────────────────────────────
suite('Error Handling');

await testAsync('unknown path returns 404', async () => {
  const { status, data } = await api('GET', '/api/nonexistent-route-xyz');
  assertEqual(status, 404);
  assertEqual(data.error, 'Not found');
});

await testAsync('response is JSON content-type', async () => {
  const res = await apiRaw('GET', '/api/health');
  assertEqual(res.status, 200);
  const ct = res.headers.get('content-type');
  assertIncludes(ct, 'application/json');
});

await testAsync('health responds quickly (< 500ms)', async () => {
  const start = Date.now();
  const response = await apiRaw('GET', '/api/health');
  assertEqual(response.status, 200);
  const elapsed = Date.now() - start;
  assert(elapsed < 500, `health took ${elapsed}ms, expected < 500ms`);
});

// ── License ──────────────────────────────────────────────────────────────────
suite('GET /api/license/status');

await testAsync('returns license info with tier', async () => {
  const { status, data } = await api('GET', '/api/license/status');
  assertEqual(status, 200);
  assert(typeof data.tier === 'string', 'tier required');
  assert(typeof data.valid === 'boolean', 'valid required');
  assert(data.features && typeof data.features === 'object', 'features required');
});

await testAsync('features has expected keys', async () => {
  const { status, data } = await api('GET', '/api/license/status');
  assertEqual(status, 200);
  const f = data.features;
  assert('maxProjects' in f, 'maxProjects required');
  assert('agents' in f, 'agents required');
  assert('export' in f, 'export required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
