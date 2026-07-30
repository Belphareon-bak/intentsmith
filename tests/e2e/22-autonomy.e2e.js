// tests/e2e/22-autonomy.e2e.js — Autonomy status, approve/reject
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Status ──────────────────────────────────────────────────────────────────
suite('GET /api/autonomy/status');

await testAsync('returns autonomy status when the owned server enables autonomy', async () => {
  const { status, data } = await api('GET', '/api/autonomy/status');
  assertEqual(status, 200);
  assert(typeof data.currentThreshold === 'number', 'currentThreshold must be numeric');
  assert(Number.isInteger(data.trustLevel), 'trustLevel integer required');
  assertEqual(typeof data.autoApplyEnabled, 'boolean');
  assert(Array.isArray(data.pendingProposals), 'pendingProposals array required');
  assert(Array.isArray(data.unacknowledgedAlerts), 'unacknowledgedAlerts array required');
});

// ── Approve/Reject Error Paths ──────────────────────────────────────────────
suite('Autonomy Actions — Error Paths');

await testAsync('approve nonexistent action returns 404', async () => {
  const { status, data } = await api('POST', '/api/autonomy/approve/2147483647');
  assertEqual(status, 404);
  assert(data.error.includes('not found'), 'missing-improvement error required');
});

await testAsync('reject nonexistent action returns 404', async () => {
  const { status, data } = await api('POST', '/api/autonomy/reject/2147483647');
  assertEqual(status, 404);
  assert(data.error.includes('not found'), 'missing-improvement error required');
});

await testAsync('acknowledge nonexistent alert returns 404', async () => {
  const { status, data } = await api('POST', '/api/autonomy/alerts/2147483647/acknowledge');
  assertEqual(status, 404);
  assert(data.error.includes('not found'), 'missing-alert error required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
