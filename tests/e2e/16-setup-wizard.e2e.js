// tests/e2e/16-setup-wizard.e2e.js — Setup wizard flow
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Status ──────────────────────────────────────────────────────────────────
suite('GET /api/setup/status');

await testAsync('returns setup status', async () => {
  const { status, data } = await api('GET', '/api/setup/status');
  assertEqual(status, 200);
  assert(typeof data.completed === 'boolean', 'completed must be boolean');
  assert(typeof data.ollamaUrl === 'string', 'ollamaUrl required');
  assert(typeof data.ollamaVerified === 'boolean', 'ollamaVerified must be boolean');
  assert(['cs', 'en'].includes(data.language), 'supported language required');
  assert(data.notifications && typeof data.notifications === 'object', 'notifications required');
  assert(data.license && typeof data.license.hasKey === 'boolean', 'license state required');
});

// ── Steps (validation only — don't actually complete setup) ─────────────────
suite('Setup Steps — Validation');

await testAsync('POST /api/setup/ollama validates Ollama connection', async () => {
  const { status, data } = await api('POST', '/api/setup/ollama', {
    url: 'http://127.0.0.1:11434'
  });
  assertEqual(status, 200);
  assertEqual(data.ok, true);
  assert(Array.isArray(data.models) && data.models.length > 0, 'installed models required');
  assert(Array.isArray(data.missing), 'missing-model list required');
  assertEqual(data.missing.length, 0);
});

await testAsync('POST /api/setup/language sets language', async () => {
  const { status, data } = await api('POST', '/api/setup/language', { language: 'cs' });
  assertEqual(status, 200);
  assertEqual(data.language, 'cs');
});

await testAsync('POST /api/setup/notifications stores a valid channel config', async () => {
  const { status, data } = await api('POST', '/api/setup/notifications', {
    channel: 'ntfy',
    config: { topic: 'gate0-notifications' },
  });
  assertEqual(status, 200);
  assertEqual(data.channel, 'ntfy');
  assertEqual(data.enabled, true);
});

await testAsync('POST /api/setup/license checks license', async () => {
  const { status, data } = await api('POST', '/api/setup/license', { key: '' });
  assertEqual(status, 200);
  assertEqual(data.hasKey, false);
});

await testAsync('GET /api/setup/status reflects prior steps', async () => {
  const { status, data } = await api('GET', '/api/setup/status');
  assertEqual(status, 200);
  assertEqual(data.ollamaVerified, true);
  assertEqual(data.language, 'cs');
  assertEqual(data.notifications.ntfy, true);
  assertEqual(data.license.hasKey, false);
});

// ── License Status ──────────────────────────────────────────────────────────
suite('License Status');

await testAsync('GET /api/license/status returns shape', async () => {
  const { status, data } = await api('GET', '/api/license/status');
  assertEqual(status, 200);
  assert(typeof data.tier === 'string' && data.tier.length > 0, 'tier required');
  assert(typeof data.valid === 'boolean', 'valid must be boolean');
  assert(data.features && typeof data.features === 'object', 'features map required');
  assert(Array.isArray(data.features.export), 'export feature list required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
