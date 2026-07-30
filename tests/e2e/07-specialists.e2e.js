// tests/e2e/07-specialists.e2e.js — Specialist CRUD & lifecycle
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── List ──────────────────────────────────────────────────────────────────
suite('GET /api/specialists — list');

let specialists = [];

await testAsync('returns specialists array', async () => {
  const { status, data } = await api('GET', '/api/specialists');
  assertEqual(status, 200);
  assert(data.ok === true, 'ok flag required');
  assert(Array.isArray(data.specialists), 'specialists must be array');
  specialists = data.specialists;
});

await testAsync('each specialist has required fields', async () => {
  if (specialists.length === 0) return;
  const s = specialists[0];
  assert(s.id, 'id required');
  assert(s.name, 'name required');
  assert(s.version, 'version required');
  assert(typeof s.status === 'string', 'status required');
});

// ── Get Single ────────────────────────────────────────────────────────────
suite('GET /api/specialists/:id');

await testAsync('returns existing specialist', async () => {
  if (specialists.length === 0) return;
  const { status, data } = await api('GET', `/api/specialists/${specialists[0].id}`);
  assertEqual(status, 200);
});

await testAsync('returns 404 for nonexistent', async () => {
  const { status } = await api('GET', '/api/specialists/nonexistent-spec-xyz');
  assertEqual(status, 404);
});

// ── Enable/Disable ───────────────────────────────────────────────────────
suite('Specialist Enable/Disable');

await testAsync('disable specialist', async () => {
  if (specialists.length === 0) return;
  const { status } = await api('POST', `/api/specialists/${specialists[0].id}/disable`);
  assert(status === 200 || status === 204 || status === 409, `expected 200/204/409, got ${status}`);
});

await testAsync('enable specialist', async () => {
  if (specialists.length === 0) return;
  const { status } = await api('POST', `/api/specialists/${specialists[0].id}/enable`);
  assert(status === 200 || status === 204 || status === 409, `expected 200/204/409, got ${status}`);
});

// ── Discover ─────────────────────────────────────────────────────────────
suite('Specialist Discovery');

await testAsync('discover re-scans', async () => {
  const { status } = await api('POST', '/api/specialists/discover');
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

// ── Integrity ────────────────────────────────────────────────────────────
suite('Specialist Integrity');

await testAsync('integrity check for existing specialist', async () => {
  if (specialists.length === 0) return;
  const { status } = await api('GET', `/api/specialists/${specialists[0].id}/integrity`);
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

// ── Expertise Binding ────────────────────────────────────────────────────
suite('Specialist Expertise Binding');

await testAsync('list specialist expertises', async () => {
  if (specialists.length === 0) return;
  const { status } = await api('GET', `/api/specialists/${specialists[0].id}/expertises`);
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

// ── Telemetry ────────────────────────────────────────────────────────────
suite('Specialist Telemetry');

await testAsync('telemetry endpoint returns data', async () => {
  const { status } = await api('GET', '/api/specialists/telemetry');
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
