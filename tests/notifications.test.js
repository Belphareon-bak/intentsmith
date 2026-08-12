// C.3 v57.0 — Notification Service Tests
// ══════════════════════════════════════════════════════════════════════════════

import { NotificationRouter } from '../src/notifications/service.js';
import { NotificationChannel } from '../src/notifications/channels/base.js';
import { TelegramChannel } from '../src/notifications/channels/telegram.js';
import { EmailChannel } from '../src/notifications/channels/email.js';
import { readNotificationChannelPolicy } from '../src/notifications/channel-policy.js';
import { toHTML, toMarkdown, toPlainText } from '../src/notifications/templates/default.js';

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

const emptyNotificationAuthority = createTestNotificationAuthority();
const enabledTestChannelPolicy = readNotificationChannelPolicy({
  C3_ENABLE_NOTIFICATION_EMAIL: 'true',
  C3_ENABLE_NOTIFICATION_TELEGRAM: 'true',
});

let passed = 0;
let failed = 0;
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

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 1. NotificationRouter ══════');

// 1.1 Constructor
const router = new NotificationRouter({ channelPolicy: enabledTestChannelPolicy });
assert(router instanceof NotificationRouter, 'Router instantiates');
assert(router.channels instanceof Map, 'Router has channels map');
assert(router.getAvailableChannels().length === 1, 'Only in_app is available initially');

// 1.2 Register channels
class MockChannel extends NotificationChannel {
  get name() { return 'email'; }
  async send(n) { return { delivered: true, messageId: 'mock-123' }; }
  async verify() { return { ok: true }; }
}

class FailChannel extends NotificationChannel {
  get name() { return 'telegram'; }
  async send(n) { return { delivered: false, error: 'simulated failure' }; }
  async verify() { return { ok: false, error: 'not configured' }; }
}

router.registerChannel(new MockChannel());
router.registerChannel(new FailChannel());
assert(router.getAvailableChannels().length === 3, 'in_app plus two channels registered');
assert(router.getAvailableChannels().includes('email'), 'Mock email channel available');
assert(router.getAvailableChannels().includes('telegram'), 'Failing Telegram channel available');

// 1.3 Send via mock channel
const mockResult = await router.send({
  channel: 'email',
  recipient: 'test@test.com',
  title: 'Test',
  body: 'Test body',
  priority: 'normal',
  agentId: 'test-agent',
});
assert(mockResult.delivered === true, 'Mock delivery succeeds');
assert(mockResult.channel === 'email', 'Correct channel name in result');
assert(mockResult.messageId === 'mock-123', 'Message ID returned');

// 1.4 Send via fail channel
const failResult = await router.send({
  channel: 'telegram',
  recipient: 'test@test.com',
  title: 'Test',
  body: 'Test body',
  priority: 'high',
  agentId: 'test-agent',
});
assert(failResult.delivered === false, 'Failed delivery reported');
assert(failResult.error === 'simulated failure', 'Error message propagated');

// 1.5 Send to non-existent channel
const noChannelResult = await router.send({
  channel: 'nonexistent',
  recipient: 'x',
  title: 'Test',
  body: 'Body',
  priority: 'low',
  agentId: 'test',
});
assert(noChannelResult.delivered === false, 'Non-existent channel fails gracefully');
assert(noChannelResult.code === 'NOTIFICATION_CHANNEL_UNSUPPORTED', 'Unsupported channel is typed');

// 1.6 in_app channel always succeeds
const inAppResult = await router.send({
  channel: 'in_app',
  recipient: '',
  title: 'Test',
  body: 'Body',
  priority: 'normal',
  agentId: 'test',
});
assert(inAppResult.delivered === true, 'in_app channel always delivered');
assert(inAppResult.channel === 'in_app', 'in_app channel name correct');

// 1.7 Test channel
const testOk = await router.testChannel('email', 'recipient');
assert(testOk.ok === true, 'Test channel succeeds for mock');

const testFail = await router.testChannel('telegram', 'recipient');
assert(testFail.ok === false, 'Test channel fails for fail channel');

const testMissing = await router.testChannel('nonexistent', 'x');
assert(testMissing.ok === false, 'Test non-existent channel fails');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 2. Templates ══════');

const notif = {
  title: 'Test Alert',
  body: 'Temperature dropped below 0°C',
  priority: 'high',
  agentId: 'weather-monitor',
};

// 2.1 HTML template
const html = toHTML(notif);
assert(html.includes('Test Alert'), 'HTML contains title');
assert(html.includes('Temperature dropped'), 'HTML contains body');
assert(html.includes('weather-monitor'), 'HTML contains agent ID');
assert(html.includes('<!DOCTYPE html>'), 'HTML is valid document');

// 2.2 Markdown template
const md = toMarkdown(notif);
assert(md.includes('Test Alert'), 'Markdown contains title');
assert(md.includes('Temperature dropped'), 'Markdown contains body');

// 2.3 Plain text template
const plain = toPlainText(notif);
assert(plain.includes('[HIGH]'), 'Plain text contains priority');
assert(plain.includes('Test Alert'), 'Plain text contains title');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 3. Channel Classes ══════');

// 3.1 TelegramChannel without config
const tg = new TelegramChannel({
  logger: { info: () => {}, error: () => {}, warn: () => {} },
  notificationEnvironmentAuthority: emptyNotificationAuthority,
  requireNotificationEnvironmentAuthority: requireTestNotificationAuthority,
});
assert(tg.name === 'telegram', 'Telegram channel name correct');

const tgVerify = await tg.verify();
assert(tgVerify.ok === false, 'Telegram verify fails without token');

const tgSend = await tg.send({ recipient: '123', title: 'X', body: 'Y', priority: 'low', agentId: 'z' });
assert(tgSend.delivered === false, 'Telegram send fails without token');

// 3.2 EmailChannel without config
const email = new EmailChannel({
  logger: { info: () => {}, error: () => {}, warn: () => {} },
  notificationEnvironmentAuthority: emptyNotificationAuthority,
  requireNotificationEnvironmentAuthority: requireTestNotificationAuthority,
});
assert(email.name === 'email', 'Email channel name correct');

const emailVerify = await email.verify();
assert(emailVerify.ok === false, 'Email verify fails without SMTP config');

const emailSend = await email.send({ recipient: 'a@b.c', title: 'X', body: 'Y', priority: 'normal', agentId: 'z' });
assert(emailSend.delivered === false, 'Email send fails without SMTP config');

// 3.3 Base class throws
const base = new NotificationChannel();
try {
  base.name;
  fail('Base.name throws', 'did not throw');
} catch {
  pass('Base.name throws');
}

try {
  await base.send({});
  fail('Base.send throws', 'did not throw');
} catch {
  pass('Base.send throws');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 4. NotificationPolicy ══════');

import { NotificationPolicy } from '../src/notifications/policy.js';

// 4.1 Default policy — immediate
{
  const policy = new NotificationPolicy();
  const ctx = { agent_id: 'test', body: 'hello', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx);
  assert(result.decision === 'immediate', 'Default policy is immediate');
  assert(result.escalated === false, 'No escalation by default');
  assert(result.effectivePriority === 'normal', 'Priority unchanged');
}

// 4.2 Digest mode
{
  const policy = new NotificationPolicy();
  const ctx = { agent_id: 'test', body: 'hello', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx, { mode: 'digest', digest_schedule: '0 18 * * *' });
  assert(result.decision === 'digest', 'Digest mode returns digest');
  assert(result.reason.includes('digest'), 'Reason mentions digest');
}

// 4.3 Auto mode — low priority + digest schedule → digest
{
  const policy = new NotificationPolicy();
  const ctx = { agent_id: 'test', body: 'hello', priority: 'low', created_at: Date.now() };
  const result = policy.evaluate(ctx, { mode: 'auto', digest_schedule: '0 18 * * *' });
  assert(result.decision === 'digest', 'Auto mode: low priority → digest');
}

// 4.4 Auto mode — high priority → immediate (even with digest schedule)
{
  const policy = new NotificationPolicy();
  const ctx = { agent_id: 'test', body: 'hello', priority: 'high', created_at: Date.now() };
  const result = policy.evaluate(ctx, { mode: 'auto', digest_schedule: '0 18 * * *' });
  assert(result.decision === 'immediate', 'Auto mode: high priority → immediate');
}

// 4.5 Suppress: cooldown
{
  const policy = new NotificationPolicy();
  // Mock state via overriding _getState
  policy._getState = () => ({
    muted_until: null,
    last_sent_at: new Date(Date.now() - 5 * 60000).toISOString(), // 5 min ago
    last_effective_priority: 'normal',
    last_body_hash: null,
  });
  const ctx = { agent_id: 'test', body: 'hello', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx, { suppress: { cooldown_minutes: 30 } });
  assert(result.decision === 'drop', 'Cooldown drops notification');
  assert(result.reason.includes('cooldown'), 'Reason mentions cooldown');
}

// 4.6 Suppress: cooldown expired → immediate
{
  const policy = new NotificationPolicy();
  policy._getState = () => ({
    muted_until: null,
    last_sent_at: new Date(Date.now() - 60 * 60000).toISOString(), // 60 min ago
    last_effective_priority: 'normal',
    last_body_hash: null,
  });
  const ctx = { agent_id: 'test', body: 'hello', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx, { suppress: { cooldown_minutes: 30 } });
  assert(result.decision === 'immediate', 'Expired cooldown allows immediate');
}

// 4.7 Suppress: if_unchanged
{
  const policy = new NotificationPolicy();
  // Compute hash of "same body" to simulate unchanged
  const bodyHash = (() => {
    let h = 0;
    for (let i = 0; i < 'same body'.length; i++) {
      h = ((h << 5) - h) + 'same body'.charCodeAt(i);
      h = h & h;
    }
    return h.toString(16);
  })();

  policy._getState = () => ({
    muted_until: null,
    last_sent_at: null,
    last_effective_priority: null,
    last_body_hash: bodyHash,
  });
  const ctx = { agent_id: 'test', body: 'same body', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx, { suppress: { if_unchanged: true } });
  assert(result.decision === 'drop', 'Unchanged content drops notification');
  assert(result.reason === 'content unchanged', 'Reason says content unchanged');
}

// 4.8 Suppress: changed content passes
{
  const policy = new NotificationPolicy();
  policy._getState = () => ({
    muted_until: null,
    last_sent_at: null,
    last_effective_priority: null,
    last_body_hash: 'old-hash-value',
  });
  const ctx = { agent_id: 'test', body: 'new content', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx, { suppress: { if_unchanged: true } });
  assert(result.decision === 'immediate', 'Changed content passes if_unchanged');
}

// 4.9 Mute state
{
  const policy = new NotificationPolicy();
  const futureTime = new Date(Date.now() + 3600000).toISOString();
  policy._getState = () => ({
    muted_until: futureTime,
    last_sent_at: null,
    last_effective_priority: null,
    last_body_hash: null,
  });
  const ctx = { agent_id: 'test', body: 'hello', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx);
  assert(result.decision === 'drop', 'Muted agent drops notification');
  assert(result.reason.includes('muted'), 'Reason mentions mute');
}

// 4.10 Critical bypasses mute
{
  const policy = new NotificationPolicy();
  const futureTime = new Date(Date.now() + 3600000).toISOString();
  policy._getState = () => ({
    muted_until: futureTime,
    last_sent_at: null,
    last_effective_priority: null,
    last_body_hash: null,
  });
  const ctx = { agent_id: 'test', body: 'emergency', priority: 'critical', created_at: Date.now() };
  const result = policy.evaluate(ctx);
  assert(result.decision === 'immediate', 'Critical priority bypasses mute');
}

// 4.11 Escalation (without DB, recentCount=0, no escalation)
{
  const policy = new NotificationPolicy();
  const ctx = { agent_id: 'test', body: 'hello', priority: 'low', created_at: Date.now() };
  const result = policy.evaluate(ctx, {
    escalation: { repeat_threshold: 3, window_minutes: 60, escalate_to: 'high' },
  });
  assert(result.escalated === false, 'No escalation when recentCount=0');
  assert(result.effectivePriority === 'low', 'Priority stays low');
}

// 4.12 Escalation with mocked count
{
  const policy = new NotificationPolicy();
  policy._countRecentDelivered = () => 5; // Simulate 5 recent deliveries
  const ctx = { agent_id: 'test', body: 'alert', priority: 'normal', created_at: Date.now() };
  const result = policy.evaluate(ctx, {
    escalation: { repeat_threshold: 3, window_minutes: 60, escalate_to: 'high' },
  });
  assert(result.escalated === true, 'Escalation fires when threshold exceeded');
  assert(result.effectivePriority === 'high', 'Priority escalated to high');
  assert(ctx.priority === 'high', 'Context priority mutated');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 5. NotificationPipeline ══════');

import { NotificationPipeline } from '../src/notifications/pipeline.js';
import { DigestAggregator } from '../src/notifications/digest.js';

// 5.1 Pipeline immediate delivery
{
  const mockRouter = new NotificationRouter({ channelPolicy: enabledTestChannelPolicy });
  mockRouter.registerChannel(new MockChannel());
  const policy = new NotificationPolicy();
  const digest = new DigestAggregator();
  const pipeline = new NotificationPipeline({ router: mockRouter, policy, digest });

  const result = await pipeline.process({
    agent_id: 'test',
    channel: 'email',
    recipient: 'x',
    title: 'Test',
    body: 'Hello',
    priority: 'normal',
  });
  assert(result.delivered === true, 'Pipeline immediate delivery works');
  assert(result.decision === 'immediate', 'Pipeline reports immediate decision');
  assert(result.escalated === false, 'No escalation in pipeline');
}

// 5.2 Pipeline digest buffering
{
  const mockRouter = new NotificationRouter({ channelPolicy: enabledTestChannelPolicy });
  mockRouter.registerChannel(new MockChannel());
  const policy = new NotificationPolicy();
  const digest = new DigestAggregator();
  const pipeline = new NotificationPipeline({ router: mockRouter, policy, digest });

  const result = await pipeline.process(
    { agent_id: 'test', channel: 'email', recipient: 'x', title: 'Test', body: 'Hello', priority: 'low' },
    { mode: 'digest', digest_schedule: '0 18 * * *' }
  );
  assert(result.delivered === false, 'Digest does not deliver immediately');
  assert(result.decision === 'digest', 'Pipeline reports digest decision');
}

// 5.3 Pipeline drop (muted)
{
  const mockRouter = new NotificationRouter();
  const policy = new NotificationPolicy();
  const futureTime = new Date(Date.now() + 3600000).toISOString();
  policy._getState = () => ({ muted_until: futureTime, last_sent_at: null, last_effective_priority: null, last_body_hash: null });
  const digest = new DigestAggregator();
  const pipeline = new NotificationPipeline({ router: mockRouter, policy, digest });

  const result = await pipeline.process({
    agent_id: 'test', channel: 'email', recipient: 'x', title: 'Test', body: 'Hello', priority: 'normal',
  });
  assert(result.delivered === false, 'Muted pipeline does not deliver');
  assert(result.decision === 'drop', 'Pipeline reports drop decision');
}

// 5.4 Pipeline preview (dry-run)
{
  const mockRouter = new NotificationRouter();
  const policy = new NotificationPolicy();
  const digest = new DigestAggregator();
  const pipeline = new NotificationPipeline({ router: mockRouter, policy, digest });

  const preview = pipeline.preview({
    agent_id: 'test', channel: 'email', recipient: 'x', title: 'Test', body: 'Hello', priority: 'normal',
  });
  assert(preview.would_send === true, 'Preview: would_send for immediate');
  assert(preview.decision === 'immediate', 'Preview: correct decision');
  assert(preview.escalated === false, 'Preview: no escalation');
}

// 5.5 Preview for digest
{
  const mockRouter = new NotificationRouter();
  const policy = new NotificationPolicy();
  const digest = new DigestAggregator();
  const pipeline = new NotificationPipeline({ router: mockRouter, policy, digest });

  const preview = pipeline.preview(
    { agent_id: 'test', channel: 'email', recipient: 'x', title: 'Test', body: 'Hello', priority: 'low' },
    { mode: 'digest', digest_schedule: '0 18 * * *' }
  );
  assert(preview.would_send === false, 'Preview: would_send false for digest');
  assert(preview.decision === 'digest', 'Preview: digest decision');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log('══════════════════════════════════════════');

if (failures.length) {
  console.log('\n🔴 FAILURES:');
  failures.forEach(f => {
    console.log(`  ${f.name}`);
    console.log(`    → ${f.msg}`);
  });
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
