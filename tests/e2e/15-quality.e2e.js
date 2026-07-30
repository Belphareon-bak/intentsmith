// tests/e2e/15-quality.e2e.js — Quality metrics API
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Summary ─────────────────────────────────────────────────────────────────
suite('GET /api/quality/summary');

await testAsync('returns quality summary', async () => {
  const { status, data } = await api('GET', '/api/quality/summary');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'summary must be object');
});

// ── Distribution ────────────────────────────────────────────────────────────
suite('GET /api/quality/distribution');

await testAsync('returns quality distribution', async () => {
  const { status, data } = await api('GET', '/api/quality/distribution');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'distribution must be object');
});

// ── Project Quality ─────────────────────────────────────────────────────────
suite('GET /api/quality/project/:id');

await testAsync('nonexistent project returns 404 or empty', async () => {
  const { status, data } = await api('GET', '/api/quality/project/nonexistent-xyz');
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

// ── Volatility ──────────────────────────────────────────────────────────────
suite('GET /api/quality/volatility/:id');

await testAsync('nonexistent project returns 404 or empty', async () => {
  const { status } = await api('GET', '/api/quality/volatility/nonexistent-xyz');
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

// ── Report ──────────────────────────────────────────────────────────────────
suite('GET /api/quality/report');

await testAsync('returns text report', async () => {
  const { status, data } = await api('GET', '/api/quality/report');
  assertEqual(status, 200);
  assert(typeof data === 'object' || typeof data === 'string', 'report must be object or string');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
