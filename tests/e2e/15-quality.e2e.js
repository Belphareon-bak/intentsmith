// tests/e2e/15-quality.e2e.js — Quality metrics API
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Summary ─────────────────────────────────────────────────────────────────
suite('GET /api/quality/summary');

await testAsync('returns quality summary', async () => {
  const { status, data } = await api('GET', '/api/quality/summary');
  assertEqual(status, 200);
  assert(typeof data.projects_analyzed === 'number', 'projects_analyzed must be numeric');
  for (const field of ['mean', 'median', 'stddev', 'min', 'max']) {
    assert(typeof data[field] === 'number', `${field} must be numeric`);
  }
  assert(data.distribution && typeof data.distribution === 'object', 'distribution required');
  assert(data.per_type && typeof data.per_type === 'object', 'per_type required');
});

// ── Distribution ────────────────────────────────────────────────────────────
suite('GET /api/quality/distribution');

await testAsync('returns quality distribution', async () => {
  const { status, data } = await api('GET', '/api/quality/distribution');
  assertEqual(status, 200);
  assert(typeof data.total === 'number', 'total must be numeric');
  assert(data.buckets && typeof data.buckets === 'object', 'buckets required');
  assert(data.percentages && typeof data.percentages === 'object', 'percentages required');
});

// ── Project Quality ─────────────────────────────────────────────────────────
suite('GET /api/quality/project/:id');

await testAsync('nonexistent project returns an explicit empty report', async () => {
  const { status, data } = await api('GET', '/api/quality/project/nonexistent-xyz');
  assertEqual(status, 200);
  assertEqual(data.lifecycle_id, 'nonexistent-xyz');
  assertEqual(data.history.length, 0);
  assertEqual(Object.keys(data.latest).length, 0);
  assertEqual(Object.keys(data.trend).length, 0);
  assertEqual(data.volatility, 0);
});

// ── Volatility ──────────────────────────────────────────────────────────────
suite('GET /api/quality/volatility/:id');

await testAsync('nonexistent project returns zero volatility', async () => {
  const { status, data } = await api('GET', '/api/quality/volatility/nonexistent-xyz');
  assertEqual(status, 200);
  assertEqual(data.lifecycle_id, 'nonexistent-xyz');
  assertEqual(data.volatility, 0);
});

// ── Report ──────────────────────────────────────────────────────────────────
suite('GET /api/quality/report');

await testAsync('returns text report', async () => {
  const { status, data } = await api('GET', '/api/quality/report');
  assertEqual(status, 200);
  assert(typeof data === 'string' && data.includes('C3 Quality Score Report'), 'text report heading required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
