// tests/e2e/12-notifications.e2e.js — Notification channels, config, test send
// ══════════════════════════════════════════════════════════════════════════════
// WP026 source-contract update only. This program is explicitly NOT RUN / BLOCKED
// for the secret-storage subject; no external or full-product evidence is claimed.
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

const NOTIFICATION_ENV_KEYS = Object.freeze([
  'C3_SMTP_HOST',
  'C3_SMTP_PORT',
  'C3_SMTP_USER',
  'C3_SMTP_PASS',
  'C3_SMTP_FROM',
  'C3_TELEGRAM_BOT_TOKEN',
  'C3_TELEGRAM_CHAT_ID',
  'C3_NTFY_SERVER',
  'C3_NTFY_TOPIC',
  'C3_NTFY_TOKEN',
  'C3_WEBHOOK_URL',
  'C3_WEBHOOK_SECRET',
]);
let sourcesBeforeRejectedPost = null;

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

// ── Read-only credential source status ──────────────────────────────────────
suite('Notification Config Source Status');

await testAsync('GET config returns exact status-only 12-key shape', async () => {
  const { status, data } = await api('GET', '/api/notifications/config');
  assertEqual(status, 200);
  assertEqual(JSON.stringify(Object.keys(data)), JSON.stringify(['sources']));
  assertEqual(
    JSON.stringify(Object.keys(data.sources).sort()),
    JSON.stringify([...NOTIFICATION_ENV_KEYS].sort()),
  );
  for (const key of NOTIFICATION_ENV_KEYS) {
    const leaf = data.sources[key];
    assertEqual(JSON.stringify(Object.keys(leaf).sort()), JSON.stringify(['configured', 'source']));
    assert(typeof leaf.configured === 'boolean', `${key}.configured must be boolean`);
    assert(
      leaf.source === 'PROCESS_ENV' || leaf.source === 'ROOT_ENV_FILE',
      `${key}.source must be canonical`,
    );
  }
  sourcesBeforeRejectedPost = JSON.stringify(data.sources);
});

await testAsync('POST config is retired before mutation', async () => {
  const { status, data } = await api('POST', '/api/notifications/config', {
    emailEnabled: false,
    smtpPort: 2525,
    emailOnLifecycle: true,
    emailOnWorker: false,
  });
  assertEqual(status, 410);
  assertEqual(JSON.stringify(data), JSON.stringify({
    ok: false,
    code: 'CREDENTIAL_SOURCE_READ_ONLY',
  }));
});

await testAsync('rejected POST does not change source status', async () => {
  const { status, data } = await api('GET', '/api/notifications/config');
  assertEqual(status, 200);
  assertEqual(JSON.stringify(data.sources), sourcesBeforeRejectedPost);
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
