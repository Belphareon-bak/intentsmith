// C.3 v57.0 — Notification Service Tests
// ══════════════════════════════════════════════════════════════════════════════

import { NotificationRouter } from '../src/notifications/service.js';
import { NotificationChannel } from '../src/notifications/channels/base.js';
import { TelegramChannel } from '../src/notifications/channels/telegram.js';
import { EmailChannel } from '../src/notifications/channels/email.js';
import { toHTML, toMarkdown, toPlainText } from '../src/notifications/templates/default.js';

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
const router = new NotificationRouter();
assert(router instanceof NotificationRouter, 'Router instantiates');
assert(router.channels instanceof Map, 'Router has channels map');
assert(router.getAvailableChannels().length === 0, 'No channels initially');

// 1.2 Register channels
class MockChannel extends NotificationChannel {
  get name() { return 'mock'; }
  async send(n) { return { delivered: true, messageId: 'mock-123' }; }
  async verify() { return { ok: true }; }
}

class FailChannel extends NotificationChannel {
  get name() { return 'fail'; }
  async send(n) { return { delivered: false, error: 'simulated failure' }; }
  async verify() { return { ok: false, error: 'not configured' }; }
}

router.registerChannel(new MockChannel());
router.registerChannel(new FailChannel());
assert(router.getAvailableChannels().length === 2, 'Two channels registered');
assert(router.getAvailableChannels().includes('mock'), 'Mock channel available');
assert(router.getAvailableChannels().includes('fail'), 'Fail channel available');

// 1.3 Send via mock channel
const mockResult = await router.send({
  channel: 'mock',
  recipient: 'test@test.com',
  title: 'Test',
  body: 'Test body',
  priority: 'normal',
  agentId: 'test-agent',
});
assert(mockResult.delivered === true, 'Mock delivery succeeds');
assert(mockResult.channel === 'mock', 'Correct channel name in result');
assert(mockResult.messageId === 'mock-123', 'Message ID returned');

// 1.4 Send via fail channel
const failResult = await router.send({
  channel: 'fail',
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
assert(noChannelResult.error.includes('not registered'), 'Error mentions registration');

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
const testOk = await router.testChannel('mock', 'recipient');
assert(testOk.ok === true, 'Test channel succeeds for mock');

const testFail = await router.testChannel('fail', 'recipient');
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
const tg = new TelegramChannel({ logger: { info: () => {}, error: () => {}, warn: () => {} } });
assert(tg.name === 'telegram', 'Telegram channel name correct');

const tgVerify = await tg.verify();
assert(tgVerify.ok === false, 'Telegram verify fails without token');

const tgSend = await tg.send({ recipient: '123', title: 'X', body: 'Y', priority: 'low', agentId: 'z' });
assert(tgSend.delivered === false, 'Telegram send fails without token');

// 3.2 EmailChannel without config
const email = new EmailChannel({ logger: { info: () => {}, error: () => {}, warn: () => {} } });
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
