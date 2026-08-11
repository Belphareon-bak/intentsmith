// C.3 Phase B — Push Channel (ntfy.sh) Tests (B4)
// ══════════════════════════════════════════════════════════════════════════════
//
// Unit tests with mocked fetch + E2E test with real ntfy.sh (if configured).
// WP026 compatibility note: the external E2E section is NOT RUN / BLOCKED for
// the secret-storage subject; this file receives source-contract alignment only.
//
// Run: node tests/push-channel.test.js
//
// For E2E: set C3_ENABLE_NOTIFICATION_PUSH=true and C3_NTFY_TOPIC=your-topic
// ══════════════════════════════════════════════════════════════════════════════

import { PushChannel } from '../src/notifications/channels/push.js';
import { createNotificationRouter } from '../src/notifications/index.js';
import {
  notificationEnvironmentAuthority,
  requireNotificationEnvironmentAuthority,
} from '../src/runtime-environment.js';

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
const testNotificationAuthorities = new WeakSet();

function createTestNotificationAuthority(values = {}) {
  const selected = new Map(NOTIFICATION_ENV_KEYS.map(key => [key, values[key] ?? '']));
  const sources = Object.freeze(Object.fromEntries(
    NOTIFICATION_ENV_KEYS.map(key => [key, Object.freeze({
      configured: selected.get(key).length > 0,
      source: 'PROCESS_ENV',
    })]),
  ));
  const authority = Object.create(null);
  Object.defineProperties(authority, {
    status: { value: () => sources },
    value: { value: key => selected.get(key) },
  });
  Object.freeze(authority);
  testNotificationAuthorities.add(authority);
  return authority;
}

function requireTestNotificationAuthority(authority) {
  if (!testNotificationAuthorities.has(authority)) {
    throw new TypeError('NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID');
  }
  return authority;
}

function pushChannel(values = {}) {
  return new PushChannel({
    logger,
    notificationEnvironmentAuthority: createTestNotificationAuthority(values),
    requireNotificationEnvironmentAuthority: requireTestNotificationAuthority,
  });
}

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function skip(name, reason) {
  console.log(`  ⏭️  ${name}: SKIPPED (${reason})`);
  skipped++;
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ B4: Push Channel (ntfy.sh) Tests ══════');

// ── 1. Unit Tests (mocked fetch) ──
console.log('\n── 1. Unit Tests ──');

// Save original fetch
const originalFetch = globalThis.fetch;

// 1.1 Constructor defaults
{
  let capturedUrl = '';
  globalThis.fetch = async url => {
    capturedUrl = url;
    return { ok: true };
  };

  const ch = pushChannel();
  const verifyResult = await ch.verify('caller-topic');
  assert(ch.name === 'push', 'Channel name is "push"');
  assert(capturedUrl === 'https://ntfy.sh/v1/health', 'Default server is ntfy.sh');
  assert(verifyResult.ok === true, 'Caller-supplied topic works without a default');
  globalThis.fetch = originalFetch;
}

// 1.2 Constructor with injected canonical values
{
  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 'injected' }) };
  };

  const ch = pushChannel({
    C3_NTFY_SERVER: 'https://my-ntfy.example.com/',
    C3_NTFY_TOPIC: 'my-topic',
    C3_NTFY_TOKEN: 'tk_secret123',
  });
  await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });
  assert(capturedUrl === 'https://my-ntfy.example.com', 'Custom canonical server URL is used');
  assert(capturedBody.topic === 'my-topic', 'Injected canonical topic is used');
  assert(capturedHeaders.Authorization === 'Bearer tk_secret123', 'Injected auth token is used');
  globalThis.fetch = originalFetch;
}

// 1.3 send() without topic returns error
{
  const ch = pushChannel();
  const result = await ch.send({ title: 'Test', body: 'Body', priority: 'normal', agentId: 'test' });
  assert(result.delivered === false, 'send() fails without topic');
  assert(result.error.includes('No topic'), 'Error mentions missing topic');
}

// 1.4 send() with mocked successful response
{
  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ id: 'ntfy-msg-42' }),
    };
  };

  const ch = pushChannel({ C3_NTFY_TOPIC: 'test-topic' });
  const result = await ch.send({
    title: 'Alert Title',
    body: 'Alert body text',
    priority: 'high',
    agentId: 'weather-monitor',
  });

  assert(result.delivered === true, 'send() succeeds with mock');
  assert(result.messageId === 'ntfy-msg-42', 'Returns message ID');
  // JSON body format: topic, title, message, priority, tags are in body (not URL/headers)
  assert(capturedBody.topic === 'test-topic', 'Sends to correct topic via JSON body');
  assert(capturedBody.title === 'Alert Title', 'Title in JSON body');
  assert(capturedBody.priority === 4, 'High priority maps to 4');
  assert(capturedBody.tags.includes('warning'), 'High priority tag is warning');
  assert(!capturedHeaders['Authorization'], 'No auth header without token');
  assert(capturedBody.message === 'Alert body text', 'Body in JSON message field');

  // Restore
  globalThis.fetch = originalFetch;
}

// 1.5 send() with recipient overrides default topic
{
  let capturedBody5 = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody5 = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 'x' }) };
  };

  const ch = pushChannel({ C3_NTFY_TOPIC: 'default-topic' });
  await ch.send({
    recipient: 'custom-topic',
    title: 'Test',
    body: 'Body',
    priority: 'normal',
    agentId: 'test',
  });

  assert(capturedBody5.topic === 'custom-topic', 'Recipient overrides default topic');

  globalThis.fetch = originalFetch;
}

// 1.6 send() with auth token
{
  let capturedHeaders = {};
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, json: async () => ({ id: 'y' }) };
  };

  const ch = pushChannel({
    C3_NTFY_TOPIC: 'test',
    C3_NTFY_TOKEN: 'tk_mytoken',
  });
  await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });

  assert(capturedHeaders['Authorization'] === 'Bearer tk_mytoken', 'Auth header includes token');

  globalThis.fetch = originalFetch;
}

// 1.7 send() handles server error
{
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limited',
  });

  const ch = pushChannel({ C3_NTFY_TOPIC: 'test' });
  const result = await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });
  assert(result.delivered === false, 'send() reports failure on 429');
  assert(result.error.includes('429'), 'Error includes status code');

  globalThis.fetch = originalFetch;
}

// 1.8 send() handles network error
{
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

  const ch = pushChannel({ C3_NTFY_TOPIC: 'test' });
  const result = await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });
  assert(result.delivered === false, 'send() reports failure on network error');
  assert(result.error.includes('ECONNREFUSED'), 'Error includes network error');

  globalThis.fetch = originalFetch;
}

// 1.9 Priority mapping (JSON body format)
{
  const results = {};
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    results[body.priority] = body.tags;
    return { ok: true, json: async () => ({ id: 'z' }) };
  };

  const ch = pushChannel({ C3_NTFY_TOPIC: 'test' });
  for (const p of ['low', 'normal', 'high', 'critical']) {
    await ch.send({ title: 'T', body: 'B', priority: p, agentId: 'a' });
  }

  assert(results[2]?.includes('information_source'), 'low → priority 2, tag information_source');
  assert(results[3]?.includes('robot'), 'normal → priority 3, tag robot');
  assert(results[4]?.includes('warning'), 'high → priority 4, tag warning');
  assert(results[5]?.includes('rotating_light'), 'critical → priority 5, tag rotating_light');

  globalThis.fetch = originalFetch;
}

// 1.10 verify() without topic
{
  const ch = pushChannel();
  const result = await ch.verify();
  assert(result.ok === false, 'verify() fails without topic');
}

// 1.11 verify() with healthy server
{
  globalThis.fetch = async () => ({ ok: true });

  const ch = pushChannel({ C3_NTFY_TOPIC: 'test' });
  const result = await ch.verify();
  assert(result.ok === true, 'verify() succeeds with healthy server');

  globalThis.fetch = originalFetch;
}

// ── 2. Router Registration ──
console.log('\n── 2. Router Registration ──');

{
  const routerAuthority = createTestNotificationAuthority();
  const router = createNotificationRouter({
    env: {
      C3_ENABLE_NOTIFICATION_EMAIL: 'true',
      C3_ENABLE_NOTIFICATION_TELEGRAM: 'true',
      C3_ENABLE_NOTIFICATION_PUSH: 'true',
    },
    notificationEnvironmentAuthority: routerAuthority,
    requireNotificationEnvironmentAuthority: requireTestNotificationAuthority,
  });
  const channels = router.getAvailableChannels();
  assert(channels.includes('push'), 'Push channel registered in router');
  assert(channels.includes('email'), 'Email channel still registered');
  assert(channels.includes('telegram'), 'Telegram channel still registered');
}

// ── 3. E2E Test (real ntfy.sh) ──
console.log('\n── 3. E2E Test ──');

const hasNtfy = process.env.C3_ENABLE_NOTIFICATION_PUSH === 'true'
  && notificationEnvironmentAuthority.status().C3_NTFY_TOPIC.configured;

if (hasNtfy) {
  const ch = new PushChannel({
    logger,
    notificationEnvironmentAuthority,
    requireNotificationEnvironmentAuthority,
  });

  // 3.1 Verify server
  try {
    const result = await ch.verify();
    assert(result.ok === true, 'E2E verify() succeeds', `error=${result.error}`);
  } catch (err) {
    fail('E2E verify()', err.message);
  }

  // 3.2 Send real notification
  try {
    const result = await ch.send({
      title: 'C3 Push Test',
      body: `Testovaci push notifikace z C3.\nCas: ${new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}`,
      priority: 'normal',
      agentId: 'e2e-push-test',
    });
    assert(result.delivered === true, 'E2E send() delivers', `error=${result.error}`);
    if (result.delivered) {
      console.log(`    → Sent to configured topic, id: ${result.messageId}`);
    }
  } catch (err) {
    fail('E2E send()', err.message);
  }

  // 3.3 Send high priority
  try {
    const result = await ch.send({
      title: 'C3 High Priority Test',
      body: 'Tato zprava ma vysokou prioritu.',
      priority: 'high',
      agentId: 'e2e-push-test',
    });
    assert(result.delivered === true, 'E2E high priority delivers', `error=${result.error}`);
  } catch (err) {
    fail('E2E high priority', err.message);
  }
} else {
  skip('E2E verify()', 'push opt-in or C3_NTFY_TOPIC not set');
  skip('E2E send()', 'push opt-in or C3_NTFY_TOPIC not set');
  skip('E2E high priority', 'push opt-in or C3_NTFY_TOPIC not set');
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`Push Channel Tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}
console.log('');

process.exit(failed > 0 ? 1 : skipped > 0 ? 2 : 0);
