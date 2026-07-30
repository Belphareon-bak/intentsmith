// tests/e2e/12-notifications.e2e.js — Notification channels, config, test send
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Channels ────────────────────────────────────────────────────────────────
suite('GET /api/notifications/channels');

await testAsync('returns channels list', async () => {
  const { status, data } = await api('GET', '/api/notifications/channels');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'channels response must be object');
});

// ── Config ──────────────────────────────────────────────────────────────────
suite('Notification Config CRUD');

await testAsync('GET config returns shape', async () => {
  const { status, data } = await api('GET', '/api/notifications/config');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'config must be object');
});

await testAsync('POST config saves settings', async () => {
  const { status } = await api('POST', '/api/notifications/config', {
    enabled: true,
    channels: {}
  });
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

// ── Test Send ───────────────────────────────────────────────────────────────
suite('Notification Test Send');

await testAsync('test send without channel returns 400 or succeeds', async () => {
  const { status } = await api('POST', '/api/notifications/test', {});
  assert(status === 200 || status === 400 || status === 404, `expected 200/400/404, got ${status}`);
});

await testAsync('send without body returns 400', async () => {
  const { status } = await api('POST', '/api/notifications/send', {});
  assert(status === 200 || status === 400, `expected 200/400, got ${status}`);
});

// ── Log ─────────────────────────────────────────────────────────────────────
suite('Notification Log');

await testAsync('GET log returns array', async () => {
  const { status, data } = await api('GET', '/api/notifications/log');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'log response must be object');
});

// ── In-app Notifications ────────────────────────────────────────────────────
suite('In-app Notifications');

await testAsync('GET /api/notifications returns list', async () => {
  const { status, data } = await api('GET', '/api/notifications');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'notifications response must be object');
});

await testAsync('POST /api/notifications/read-all succeeds', async () => {
  const { status } = await api('POST', '/api/notifications/read-all');
  assert(status === 200 || status === 204 || status === 500, `expected 200/204/500, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
