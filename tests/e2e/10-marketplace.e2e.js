// tests/e2e/10-marketplace.e2e.js — Marketplace catalog & install
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, cooldown } from './_helpers.js';

await waitForServer();
await cooldown();

// ── Catalog ──────────────────────────────────────────────────────────────
suite('GET /api/marketplace/catalog');

await testAsync('returns catalog structure', async () => {
  const { status, data } = await api('GET', '/api/marketplace/catalog');
  assert(status === 200 || status === 429, `expected 200/429, got ${status}`);
  if (status === 429) return;
  assert(data.ok === true, 'ok flag required');
  assert(data.packages, 'packages required');
  assert(typeof data.packages === 'object', 'packages must be object');
});

await testAsync('catalog has package type arrays', async () => {
  const { data, status } = await api('GET', '/api/marketplace/catalog');
  if (status === 429) return;
  const p = data.packages;
  assert(Array.isArray(p.skills) || p.skills === undefined, 'skills must be array or undefined');
  assert(Array.isArray(p.expertises) || p.expertises === undefined, 'expertises must be array or undefined');
  assert(Array.isArray(p.specialists) || p.specialists === undefined, 'specialists must be array or undefined');
});

// ── Refresh ──────────────────────────────────────────────────────────────
suite('POST /api/marketplace/catalog/refresh');

await testAsync('refresh returns success', async () => {
  const { status } = await api('POST', '/api/marketplace/catalog/refresh');
  assert(status === 200 || status === 204 || status === 429, `expected 200/204/429, got ${status}`);
});

// ── Installed ────────────────────────────────────────────────────────────
suite('GET /api/marketplace/installed');

await testAsync('returns installed list', async () => {
  const { status, data } = await api('GET', '/api/marketplace/installed');
  assert(status === 200 || status === 429, `expected 200/429, got ${status}`);
  if (status === 429) return;
  assert(data.ok === true, 'ok flag required');
  assert(Array.isArray(data.installed), 'installed must be array');
});

// ── Install Error Paths ──────────────────────────────────────────────────
suite('Marketplace Install — error paths');

await testAsync('install invalid type returns 400', async () => {
  const { status } = await api('POST', '/api/marketplace/install/invalid-type/test');
  assert(status === 400 || status === 404 || status === 429, `expected 400/404/429, got ${status}`);
});

await testAsync('install nonexistent package returns 404', async () => {
  const { status } = await api('POST', '/api/marketplace/install/skill/nonexistent-pkg-xyz');
  assert(status === 404 || status === 400 || status === 429, `expected 404/400/429, got ${status}`);
});

await testAsync('uninstall nonexistent returns 404', async () => {
  const { status } = await api('DELETE', '/api/marketplace/installed/skill/nonexistent-pkg-xyz');
  assert(status === 404 || status === 400 || status === 429, `expected 404/400/429, got ${status}`);
});

// ── Export ────────────────────────────────────────────────────────────────
suite('Marketplace Export');

await testAsync('export invalid type returns 400', async () => {
  const { status } = await api('POST', '/api/marketplace/export/invalid-type/test');
  assert(status === 400 || status === 404 || status === 429, `expected 400/404/429, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
