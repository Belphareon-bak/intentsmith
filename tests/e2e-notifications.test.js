// C.3 Phase B — E2E Notification Verification (B0)
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests REAL notification delivery through email, telegram, and full pipeline.
// Requires environment variables to be set — tests skip gracefully if not configured.
//
// Run: node tests/e2e-notifications.test.js
//
// Required env vars:
//   C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
//   C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID
// ══════════════════════════════════════════════════════════════════════════════

import { EmailChannel } from '../src/notifications/channels/email.js';
import { TelegramChannel } from '../src/notifications/channels/telegram.js';
import { createNotificationRouter, createNotificationPipeline } from '../src/notifications/index.js';

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

const testNotification = {
  title: 'C3 E2E Test',
  body: `Toto je testovaci notifikace z C3 E2E testu.\nCas: ${new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}`,
  priority: 'normal',
  agentId: 'e2e-test',
};

const hasSmtp = !!(process.env.C3_SMTP_HOST && process.env.C3_SMTP_USER && process.env.C3_SMTP_PASS);
const hasTelegram = !!(process.env.C3_TELEGRAM_BOT_TOKEN && process.env.C3_TELEGRAM_CHAT_ID);

console.log('\n══════ B0: E2E Notification Verification ══════');
console.log(`  SMTP configured: ${hasSmtp ? 'YES' : 'NO'}`);
console.log(`  Telegram configured: ${hasTelegram ? 'YES' : 'NO'}\n`);

// ══════════════════════════════════════════════════════════════════════════════
console.log('── 1. Email Channel ──');

if (hasSmtp) {
  const email = new EmailChannel({ logger });

  // 1.1 Verify SMTP connection
  try {
    const verifyResult = await email.verify();
    assert(verifyResult.ok === true, 'Email verify() succeeds', `ok=${verifyResult.ok}, error=${verifyResult.error}`);
  } catch (err) {
    fail('Email verify() succeeds', `threw: ${err.message}`);
  }

  // 1.2 Send real email
  try {
    const recipient = process.env.C3_SMTP_FROM || process.env.C3_SMTP_USER;
    const sendResult = await email.send({ ...testNotification, recipient });
    assert(sendResult.delivered === true, 'Email send() delivers', `delivered=${sendResult.delivered}, error=${sendResult.error}`);
    if (sendResult.delivered) {
      console.log(`    → Sent to: ${recipient}, messageId: ${sendResult.messageId}`);
    }
  } catch (err) {
    fail('Email send() delivers', `threw: ${err.message}`);
  }
} else {
  skip('Email verify()', 'C3_SMTP_* not set');
  skip('Email send()', 'C3_SMTP_* not set');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Telegram Channel ──');

if (hasTelegram) {
  const telegram = new TelegramChannel({ logger });

  // 2.1 Verify bot token
  try {
    const verifyResult = await telegram.verify();
    assert(verifyResult.ok === true, 'Telegram verify() succeeds', `ok=${verifyResult.ok}, error=${verifyResult.error}`);
  } catch (err) {
    fail('Telegram verify() succeeds', `threw: ${err.message}`);
  }

  // 2.2 Send real Telegram message
  try {
    const chatId = process.env.C3_TELEGRAM_CHAT_ID;
    const sendResult = await telegram.send({ ...testNotification, recipient: chatId });
    assert(sendResult.delivered === true, 'Telegram send() delivers', `delivered=${sendResult.delivered}, error=${sendResult.error}`);
    if (sendResult.delivered) {
      console.log(`    → Sent to chat: ${chatId}, messageId: ${sendResult.messageId}`);
    }
  } catch (err) {
    fail('Telegram send() delivers', `threw: ${err.message}`);
  }

  // 2.3 Test with special characters (MarkdownV2 stress test)
  try {
    const specialNotification = {
      title: 'Test: Specialni znaky & 100% OK!',
      body: 'Cena: 1.500 Kc (sleva -20%) [Praha].\nDalsi radek s ~tildem~ a `kodem`.',
      priority: 'high',
      agentId: 'e2e-markdown-test',
      recipient: process.env.C3_TELEGRAM_CHAT_ID,
    };
    const sendResult = await telegram.send(specialNotification);
    assert(sendResult.delivered === true, 'Telegram send() handles special chars', `delivered=${sendResult.delivered}, error=${sendResult.error}`);
  } catch (err) {
    fail('Telegram send() handles special chars', `threw: ${err.message}`);
  }
} else {
  skip('Telegram verify()', 'C3_TELEGRAM_* not set');
  skip('Telegram send()', 'C3_TELEGRAM_* not set');
  skip('Telegram special chars', 'C3_TELEGRAM_* not set');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Notification Router ──');

{
  const router = createNotificationRouter();
  const channels = router.getAvailableChannels();
  assert(channels.includes('email'), 'Router has email channel');
  assert(channels.includes('telegram'), 'Router has telegram channel');

  // 3.1 testChannel for telegram
  if (hasTelegram) {
    try {
      const result = await router.testChannel('telegram', process.env.C3_TELEGRAM_CHAT_ID);
      assert(result.ok === true || result.delivered === true, 'Router testChannel(telegram) succeeds', `result=${JSON.stringify(result)}`);
    } catch (err) {
      fail('Router testChannel(telegram)', `threw: ${err.message}`);
    }
  } else {
    skip('Router testChannel(telegram)', 'C3_TELEGRAM_* not set');
  }

  // 3.2 testChannel for email
  if (hasSmtp) {
    try {
      const recipient = process.env.C3_SMTP_FROM || process.env.C3_SMTP_USER;
      const result = await router.testChannel('email', recipient);
      assert(result.ok === true || result.delivered === true, 'Router testChannel(email) succeeds', `result=${JSON.stringify(result)}`);
    } catch (err) {
      fail('Router testChannel(email)', `threw: ${err.message}`);
    }
  } else {
    skip('Router testChannel(email)', 'C3_SMTP_* not set');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Full Pipeline (Telegram) ──');

if (hasTelegram) {
  try {
    const { pipeline } = createNotificationPipeline();

    const ctx = {
      agent_id: 'e2e-pipeline-test',
      channel: 'telegram',
      recipient: process.env.C3_TELEGRAM_CHAT_ID,
      title: 'Pipeline E2E Test',
      body: 'Tato zprava prosla celym pipeline: policy → router → telegram.',
      priority: 'normal',
      created_at: Date.now(),
      reason: { trigger: 'e2e-test', condition: null, source_id: null, source_type: null },
      data: null,
    };

    const result = await pipeline.process(ctx);
    assert(result.delivered === true, 'Pipeline delivers via telegram', `delivered=${result.delivered}, decision=${result.decision}, error=${result.error}`);
    assert(result.decision === 'immediate', 'Pipeline decision is immediate', `decision=${result.decision}`);
    if (result.delivered) {
      console.log(`    → Pipeline delivered: decision=${result.decision}, escalated=${result.escalated}`);
    }
  } catch (err) {
    fail('Pipeline E2E', `threw: ${err.message}`);
  }
} else {
  skip('Pipeline E2E (telegram)', 'C3_TELEGRAM_* not set');
  skip('Pipeline decision check', 'C3_TELEGRAM_* not set');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Full Pipeline (Email) ──');

if (hasSmtp) {
  try {
    const { pipeline } = createNotificationPipeline();
    const recipient = process.env.C3_SMTP_FROM || process.env.C3_SMTP_USER;

    const ctx = {
      agent_id: 'e2e-pipeline-email',
      channel: 'email',
      recipient,
      title: 'Pipeline E2E Email Test',
      body: 'Tato zprava prosla celym pipeline: policy → router → email channel.',
      priority: 'normal',
      created_at: Date.now(),
      reason: { trigger: 'e2e-test', condition: null, source_id: null, source_type: null },
      data: null,
    };

    const result = await pipeline.process(ctx);
    assert(result.delivered === true, 'Pipeline delivers via email', `delivered=${result.delivered}, decision=${result.decision}, error=${result.error}`);
  } catch (err) {
    fail('Pipeline E2E email', `threw: ${err.message}`);
  }
} else {
  skip('Pipeline E2E (email)', 'C3_SMTP_* not set');
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`E2E Notifications: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}
if (skipped > 0 && passed === 0 && failed === 0) {
  console.log('\n⚠️  All tests skipped. Set environment variables to run E2E tests.');
  console.log('   C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS');
  console.log('   C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID');
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
