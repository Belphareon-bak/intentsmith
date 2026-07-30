// C.3 Phase B — Push Channel (ntfy.sh) Tests (B4)
// ══════════════════════════════════════════════════════════════════════════════
//
// Unit tests with mocked fetch + E2E test with real ntfy.sh (if configured).
//
// Run: node tests/push-channel.test.js
//
// For E2E: set C3_NTFY_TOPIC=your-topic
// ══════════════════════════════════════════════════════════════════════════════

import { PushChannel } from '../src/notifications/channels/push.js';
import { createNotificationRouter } from '../src/notifications/index.js';

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
  const saved = { ...process.env };
  delete process.env.C3_NTFY_SERVER;
  delete process.env.C3_NTFY_TOPIC;
  delete process.env.C3_NTFY_TOKEN;

  const ch = new PushChannel({ logger });
  assert(ch.name === 'push', 'Channel name is "push"');
  assert(ch.serverUrl === 'https://ntfy.sh', 'Default server is ntfy.sh');
  assert(ch.defaultTopic === '', 'No default topic without env');

  Object.assign(process.env, saved);
}

// 1.2 Constructor with env vars
{
  const saved = {
    C3_NTFY_SERVER: process.env.C3_NTFY_SERVER,
    C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC,
    C3_NTFY_TOKEN: process.env.C3_NTFY_TOKEN,
  };

  process.env.C3_NTFY_SERVER = 'https://my-ntfy.example.com/';
  process.env.C3_NTFY_TOPIC = 'my-topic';
  process.env.C3_NTFY_TOKEN = 'tk_secret123';

  const ch = new PushChannel({ logger });
  assert(ch.serverUrl === 'https://my-ntfy.example.com', 'Custom server URL (trailing slash stripped)');
  assert(ch.defaultTopic === 'my-topic', 'Custom topic from env');
  assert(ch.token === 'tk_secret123', 'Auth token from env');

  // Restore
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// 1.3 send() without topic returns error
{
  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  delete process.env.C3_NTFY_TOPIC;

  const ch = new PushChannel({ logger });
  const result = await ch.send({ title: 'Test', body: 'Body', priority: 'normal', agentId: 'test' });
  assert(result.delivered === false, 'send() fails without topic');
  assert(result.error.includes('No topic'), 'Error mentions missing topic');

  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
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

  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC, C3_NTFY_TOKEN: process.env.C3_NTFY_TOKEN };
  process.env.C3_NTFY_TOPIC = 'test-topic';
  delete process.env.C3_NTFY_TOKEN;

  const ch = new PushChannel({ logger });
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
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// 1.5 send() with recipient overrides default topic
{
  let capturedBody5 = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody5 = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 'x' }) };
  };

  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  process.env.C3_NTFY_TOPIC = 'default-topic';

  const ch = new PushChannel({ logger });
  await ch.send({
    recipient: 'custom-topic',
    title: 'Test',
    body: 'Body',
    priority: 'normal',
    agentId: 'test',
  });

  assert(capturedBody5.topic === 'custom-topic', 'Recipient overrides default topic');

  globalThis.fetch = originalFetch;
  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
  else delete process.env.C3_NTFY_TOPIC;
}

// 1.6 send() with auth token
{
  let capturedHeaders = {};
  globalThis.fetch = async (url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, json: async () => ({ id: 'y' }) };
  };

  const saved = {
    C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC,
    C3_NTFY_TOKEN: process.env.C3_NTFY_TOKEN,
  };
  process.env.C3_NTFY_TOPIC = 'test';
  process.env.C3_NTFY_TOKEN = 'tk_mytoken';

  const ch = new PushChannel({ logger });
  await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });

  assert(capturedHeaders['Authorization'] === 'Bearer tk_mytoken', 'Auth header includes token');

  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// 1.7 send() handles server error
{
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limited',
  });

  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  process.env.C3_NTFY_TOPIC = 'test';

  const ch = new PushChannel({ logger });
  const result = await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });
  assert(result.delivered === false, 'send() reports failure on 429');
  assert(result.error.includes('429'), 'Error includes status code');

  globalThis.fetch = originalFetch;
  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
  else delete process.env.C3_NTFY_TOPIC;
}

// 1.8 send() handles network error
{
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  process.env.C3_NTFY_TOPIC = 'test';

  const ch = new PushChannel({ logger });
  const result = await ch.send({ title: 'T', body: 'B', priority: 'normal', agentId: 'a' });
  assert(result.delivered === false, 'send() reports failure on network error');
  assert(result.error.includes('ECONNREFUSED'), 'Error includes network error');

  globalThis.fetch = originalFetch;
  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
  else delete process.env.C3_NTFY_TOPIC;
}

// 1.9 Priority mapping (JSON body format)
{
  const results = {};
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    results[body.priority] = body.tags;
    return { ok: true, json: async () => ({ id: 'z' }) };
  };

  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  process.env.C3_NTFY_TOPIC = 'test';

  const ch = new PushChannel({ logger });
  for (const p of ['low', 'normal', 'high', 'critical']) {
    await ch.send({ title: 'T', body: 'B', priority: p, agentId: 'a' });
  }

  assert(results[2]?.includes('information_source'), 'low → priority 2, tag information_source');
  assert(results[3]?.includes('robot'), 'normal → priority 3, tag robot');
  assert(results[4]?.includes('warning'), 'high → priority 4, tag warning');
  assert(results[5]?.includes('rotating_light'), 'critical → priority 5, tag rotating_light');

  globalThis.fetch = originalFetch;
  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
  else delete process.env.C3_NTFY_TOPIC;
}

// 1.10 verify() without topic
{
  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  delete process.env.C3_NTFY_TOPIC;

  const ch = new PushChannel({ logger });
  const result = await ch.verify();
  assert(result.ok === false, 'verify() fails without topic');

  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
}

// 1.11 verify() with healthy server
{
  globalThis.fetch = async () => ({ ok: true });

  const saved = { C3_NTFY_TOPIC: process.env.C3_NTFY_TOPIC };
  process.env.C3_NTFY_TOPIC = 'test';

  const ch = new PushChannel({ logger });
  const result = await ch.verify();
  assert(result.ok === true, 'verify() succeeds with healthy server');

  globalThis.fetch = originalFetch;
  if (saved.C3_NTFY_TOPIC) process.env.C3_NTFY_TOPIC = saved.C3_NTFY_TOPIC;
  else delete process.env.C3_NTFY_TOPIC;
}

// ── 2. Router Registration ──
console.log('\n── 2. Router Registration ──');

{
  const router = createNotificationRouter();
  const channels = router.getAvailableChannels();
  assert(channels.includes('push'), 'Push channel registered in router');
  assert(channels.includes('email'), 'Email channel still registered');
  assert(channels.includes('telegram'), 'Telegram channel still registered');
}

// ── 3. E2E Test (real ntfy.sh) ──
console.log('\n── 3. E2E Test ──');

const hasNtfy = !!process.env.C3_NTFY_TOPIC;

if (hasNtfy) {
  const ch = new PushChannel({ logger });

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
      console.log(`    → Sent to topic: ${process.env.C3_NTFY_TOPIC}, id: ${result.messageId}`);
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
  skip('E2E verify()', 'C3_NTFY_TOPIC not set');
  skip('E2E send()', 'C3_NTFY_TOPIC not set');
  skip('E2E high priority', 'C3_NTFY_TOPIC not set');
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
