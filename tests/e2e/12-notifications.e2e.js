// tests/e2e/12-notifications.e2e.js — Notification channels, config, test send
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── Channels ────────────────────────────────────────────────────────────────
suite('GET /api/notifications/channels');

await testAsync('returns channels list', async () => {
  const { status, data } = await api('GET', '/api/notifications/channels');
  assertEqual(status, 200);
  assert(Array.isArray(data.channels), 'channels must be array');
  assert(data.channels.length > 0, 'registered notification channels required');
  for (const channel of data.channels) {
    assert(typeof channel.name === 'string' && channel.name.length > 0, 'channel name required');
    assert(typeof channel.configured === 'boolean', 'configured flag required');
  }
});

// ── Config ──────────────────────────────────────────────────────────────────
suite('Notification Config CRUD');

await testAsync('GET config returns shape', async () => {
  const { status, data } = await api('GET', '/api/notifications/config');
  assertEqual(status, 200);
  assert(typeof data.emailEnabled === 'boolean', 'emailEnabled must be boolean');
  assert(typeof data.smtpPort === 'number', 'smtpPort must be numeric');
});

await testAsync('POST config saves settings', async () => {
  const { status, data } = await api('POST', '/api/notifications/config', {
    emailEnabled: false,
    smtpPort: 2525,
    emailOnLifecycle: true,
    emailOnWorker: false,
  });
  assertEqual(status, 200);
  assertEqual(data.success, true);
});

await testAsync('saved notification config persists', async () => {
  const { status, data } = await api('GET', '/api/notifications/config');
  assertEqual(status, 200);
  assertEqual(data.emailEnabled, false);
  assertEqual(data.smtpPort, 2525);
  assertEqual(data.emailOnLifecycle, true);
  assertEqual(data.emailOnWorker, false);
});

// ── Test Send ───────────────────────────────────────────────────────────────
suite('Notification Test Send');

await testAsync('test send without channel returns 400', async () => {
  const { status, data } = await api('POST', '/api/notifications/test', {});
  assertEqual(status, 400);
  assert(typeof data.error === 'string' && data.error.length > 0, 'error required');
});

await testAsync('send without body returns 400', async () => {
  const { status, data } = await api('POST', '/api/notifications/send', {});
  assertEqual(status, 400);
  assert(typeof data.error === 'string' && data.error.length > 0, 'error required');
});

// ── Log ─────────────────────────────────────────────────────────────────────
suite('Notification Log');

await testAsync('GET log returns array', async () => {
  const { status, data } = await api('GET', '/api/notifications/log');
  assertEqual(status, 200);
  assert(Array.isArray(data.entries), 'entries must be array');
  assertEqual(data.count, data.entries.length);
});

// ── In-app Notifications ────────────────────────────────────────────────────
suite('In-app Notifications');

await testAsync('GET /api/notifications returns list', async () => {
  const { status, data } = await api('GET', '/api/notifications');
  assertEqual(status, 200);
  assert(Array.isArray(data.notifications), 'notifications must be array');
  assert(typeof data.unreadCount === 'number', 'unreadCount must be numeric');
});

await testAsync('POST /api/notifications/read-all succeeds', async () => {
  const { status, data } = await api('POST', '/api/notifications/read-all?agent=fixture-agent');
  assertEqual(status, 200);
  assertEqual(data.success, true);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
