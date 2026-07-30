// tests/e2e/16-setup-wizard.e2e.js — Setup wizard flow
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Status ──────────────────────────────────────────────────────────────────
suite('GET /api/setup/status');

await testAsync('returns setup status', async () => {
  const { status, data } = await api('GET', '/api/setup/status');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'status must be object');
});

// ── Steps (validation only — don't actually complete setup) ─────────────────
suite('Setup Steps — Validation');

await testAsync('POST /api/setup/ollama validates Ollama connection', async () => {
  const { status } = await api('POST', '/api/setup/ollama', {
    url: 'http://127.0.0.1:11434'
  });
  // 200 if Ollama reachable, 400/502 if not
  assert(status === 200 || status === 400 || status === 502, `expected 200/400/502, got ${status}`);
});

await testAsync('POST /api/setup/language sets language', async () => {
  const { status } = await api('POST', '/api/setup/language', { language: 'cs' });
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

await testAsync('POST /api/setup/notifications validates config', async () => {
  const { status } = await api('POST', '/api/setup/notifications', { enabled: false });
  assert(status === 200 || status === 204 || status === 400, `expected 200/204/400, got ${status}`);
});

await testAsync('POST /api/setup/license checks license', async () => {
  const { status } = await api('POST', '/api/setup/license', { key: '' });
  assert(status === 200 || status === 400 || status === 204, `expected 200/400/204, got ${status}`);
});

// ── License Status ──────────────────────────────────────────────────────────
suite('License Status');

await testAsync('GET /api/license/status returns shape', async () => {
  const { status, data } = await api('GET', '/api/license/status');
  assertEqual(status, 200);
  assert(data.tier, 'tier required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
