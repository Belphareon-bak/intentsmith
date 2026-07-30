// tests/e2e/10-marketplace.e2e.js — Marketplace catalog & install
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, cooldown } from './_helpers.js';

await waitForServer();
await cooldown();

// ── Catalog ──────────────────────────────────────────────────────────────
suite('GET /api/marketplace/catalog');

await testAsync('returns catalog structure', async () => {
  const { status, data } = await api('GET', '/api/marketplace/catalog');
  assertEqual(status, 200);
  assertEqual(data.ok, true);
  assert(data.packages, 'packages required');
  assert(typeof data.packages === 'object', 'packages must be object');
});

await testAsync('catalog has package type arrays', async () => {
  const { data, status } = await api('GET', '/api/marketplace/catalog');
  assertEqual(status, 200);
  const p = data.packages;
  assert(Array.isArray(p.skills), 'skills must be array');
  assert(Array.isArray(p.expertises), 'expertises must be array');
  assert(Array.isArray(p.specialists), 'specialists must be array');
});

// ── Refresh ──────────────────────────────────────────────────────────────
suite('POST /api/marketplace/catalog/refresh');

await testAsync('refresh returns success', async () => {
  const { status, data } = await api('POST', '/api/marketplace/catalog/refresh');
  assertEqual(status, 200);
  assertEqual(data.ok, true);
  assert(data.packages && typeof data.packages === 'object', 'packages required');
});

// ── Installed ────────────────────────────────────────────────────────────
suite('GET /api/marketplace/installed');

await testAsync('returns installed list', async () => {
  const { status, data } = await api('GET', '/api/marketplace/installed');
  assertEqual(status, 200);
  assertEqual(data.ok, true);
  assert(Array.isArray(data.installed), 'installed must be array');
});

// ── Install Error Paths ──────────────────────────────────────────────────
suite('Marketplace Install — error paths');

await testAsync('install invalid type returns 400', async () => {
  const { status } = await api('POST', '/api/marketplace/install/invalid-type/test');
  assertEqual(status, 400);
});

await testAsync('install nonexistent package returns 404', async () => {
  const { status } = await api('POST', '/api/marketplace/install/skill/nonexistent-pkg-xyz');
  assertEqual(status, 404);
});

await testAsync('uninstall nonexistent returns 404', async () => {
  const { status } = await api('DELETE', '/api/marketplace/installed/skill/nonexistent-pkg-xyz');
  assertEqual(status, 404);
});

// ── Export ────────────────────────────────────────────────────────────────
suite('Marketplace Export');

await testAsync('export invalid type returns 400', async () => {
  const { status } = await api('POST', '/api/marketplace/export/invalid-type/test');
  assertEqual(status, 400);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
