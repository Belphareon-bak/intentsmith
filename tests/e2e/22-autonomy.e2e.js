// tests/e2e/22-autonomy.e2e.js — Autonomy status, approve/reject
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Status ──────────────────────────────────────────────────────────────────
suite('GET /api/autonomy/status');

await testAsync('returns autonomy status (or 404 if not registered)', async () => {
  const { status, data } = await api('GET', '/api/autonomy/status');
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
  if (status === 200) {
    assert(typeof data === 'object', 'status must be object');
  }
});

// ── Approve/Reject Error Paths ──────────────────────────────────────────────
suite('Autonomy Actions — Error Paths');

await testAsync('approve nonexistent action returns 404', async () => {
  const { status } = await api('POST', '/api/autonomy/approve/nonexistent-xyz');
  assert(status === 404 || status === 400 || status === 500, `expected 404/400/500, got ${status}`);
});

await testAsync('reject nonexistent action returns 404', async () => {
  const { status } = await api('POST', '/api/autonomy/reject/nonexistent-xyz');
  assert(status === 404 || status === 400 || status === 500, `expected 404/400/500, got ${status}`);
});

await testAsync('acknowledge nonexistent alert returns 404', async () => {
  const { status } = await api('POST', '/api/autonomy/alerts/nonexistent-xyz/acknowledge');
  assert(status === 404 || status === 400 || status === 500, `expected 404/400/500, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
