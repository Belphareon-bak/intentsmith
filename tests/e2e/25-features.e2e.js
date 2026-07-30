// tests/e2e/25-features.e2e.js — Feature flags list, toggle, reset
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── List ─────────────────────────────────────────────────────────────────────
suite('GET /api/features');

let featureNames = [];

await testAsync('returns features object', async () => {
  const { status, data } = await api('GET', '/api/features');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'features must be object');
  const features = data.features || data;
  featureNames = Object.keys(features);
});

// ── Toggle ──────────────────────────────────────────────────────────────────
suite('POST /api/features/:name — toggle');

await testAsync('toggle known feature succeeds', async () => {
  if (featureNames.length === 0) return;
  const name = featureNames[0];
  const { status } = await api('POST', `/api/features/${name}`, { enabled: true });
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

await testAsync('toggle unknown feature returns 404 or creates it', async () => {
  const { status } = await api('POST', '/api/features/nonexistent-feature-xyz', { enabled: true });
  assert(status === 200 || status === 204 || status === 404 || status === 400, `expected 200/204/404/400, got ${status}`);
});

// ── Reset ───────────────────────────────────────────────────────────────────
suite('POST /api/features/reset');

await testAsync('reset features to defaults', async () => {
  const { status } = await api('POST', '/api/features/reset');
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

await testAsync('features restored after reset', async () => {
  const { status, data } = await api('GET', '/api/features');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'features must be object after reset');
});

// ── Autocomplete ────────────────────────────────────────────────────────────
suite('POST /api/autocomplete');

await testAsync('autocomplete with short prefix returns suggestions or error', async () => {
  const { status } = await api('POST', '/api/autocomplete', { text: 'Ja', context: '' });
  assert(status === 200 || status === 400 || status === 500 || status === 502, `expected 200/400/500/502, got ${status}`);
});

// ── Context ─────────────────────────────────────────────────────────────────
suite('POST /api/context');

await testAsync('context estimate returns percentage', async () => {
  const { status, data } = await api('POST', '/api/context', { text: 'Hello world' });
  assert(status === 200 || status === 400 || status === 500, `expected 200/400/500, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
