// C.3 Phase B — E2E Notification Verification (B0)
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests REAL notification delivery through email, telegram, and full pipeline.
// Requires environment variables to be set — tests skip gracefully if not configured.
// WP026 compatibility note: this external program is NOT RUN / BLOCKED for the
// secret-storage subject; this file receives source-contract alignment only.
//
// Run: node tests/e2e-notifications.test.js
//
// Required env vars:
//   C3_ENABLE_NOTIFICATION_EMAIL=true and/or C3_ENABLE_NOTIFICATION_TELEGRAM=true
//   C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
//   C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID
// ══════════════════════════════════════════════════════════════════════════════

import { EmailChannel } from '../src/notifications/channels/email.js';
import { TelegramChannel } from '../src/notifications/channels/telegram.js';
import { createNotificationRouter, createNotificationPipeline } from '../src/notifications/index.js';
import {
  notificationEnvironmentAuthority,
  requireNotificationEnvironmentAuthority,
  webhookSecretAuthority,
  requireWebhookSecretAuthority,
} from '../src/runtime-environment.js';

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

const notificationChannelDeps = {
  logger,
  notificationEnvironmentAuthority,
  requireNotificationEnvironmentAuthority,
};
const notificationFactoryDeps = {
  ...notificationChannelDeps,
  webhookSecretAuthority,
  requireWebhookSecretAuthority,
};

const testNotification = {
  title: 'C3 E2E Test',
  body: `Toto je testovaci notifikace z C3 E2E testu.\nCas: ${new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}`,
  priority: 'normal',
  agentId: 'e2e-test',
};

const notificationSources = notificationEnvironmentAuthority.status();
const emailOptedIn = process.env.C3_ENABLE_NOTIFICATION_EMAIL === 'true';
const telegramOptedIn = process.env.C3_ENABLE_NOTIFICATION_TELEGRAM === 'true';
const hasSmtp = emailOptedIn
  && notificationSources.C3_SMTP_HOST.configured
  && notificationSources.C3_SMTP_USER.configured
  && notificationSources.C3_SMTP_PASS.configured;
const hasTelegram = telegramOptedIn
  && notificationSources.C3_TELEGRAM_BOT_TOKEN.configured
  && notificationSources.C3_TELEGRAM_CHAT_ID.configured;
const emailRecipient = notificationEnvironmentAuthority.value('C3_SMTP_FROM')
  || notificationEnvironmentAuthority.value('C3_SMTP_USER');
const telegramRecipient = notificationEnvironmentAuthority.value('C3_TELEGRAM_CHAT_ID');

console.log('\n══════ B0: E2E Notification Verification ══════');
console.log(`  SMTP E2E eligible (opt-in + key presence): ${hasSmtp ? 'YES' : 'NO'}`);
console.log(`  Telegram E2E eligible (opt-in + key presence): ${hasTelegram ? 'YES' : 'NO'}\n`);

// ══════════════════════════════════════════════════════════════════════════════
console.log('── 1. Email Channel ──');

if (hasSmtp) {
  const email = new EmailChannel(notificationChannelDeps);

  // 1.1 Verify SMTP connection
  try {
    const verifyResult = await email.verify();
    assert(verifyResult.ok === true, 'Email verify() succeeds', `ok=${verifyResult.ok}, error=${verifyResult.error}`);
  } catch (err) {
    fail('Email verify() succeeds', `threw: ${err.message}`);
  }

  // 1.2 Send real email
  try {
    const sendResult = await email.send({ ...testNotification, recipient: emailRecipient });
    assert(sendResult.delivered === true, 'Email send() delivers', `delivered=${sendResult.delivered}, error=${sendResult.error}`);
    if (sendResult.delivered) {
      console.log(`    → Sent to caller-supplied recipient, messageId: ${sendResult.messageId}`);
    }
  } catch (err) {
    fail('Email send() delivers', `threw: ${err.message}`);
  }
} else {
  skip('Email verify()', 'email opt-in or required C3_SMTP_* presence missing');
  skip('Email send()', 'email opt-in or required C3_SMTP_* presence missing');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 2. Telegram Channel ──');

if (hasTelegram) {
  const telegram = new TelegramChannel(notificationChannelDeps);

  // 2.1 Verify bot token
  try {
    const verifyResult = await telegram.verify();
    assert(verifyResult.ok === true, 'Telegram verify() succeeds', `ok=${verifyResult.ok}, error=${verifyResult.error}`);
  } catch (err) {
    fail('Telegram verify() succeeds', `threw: ${err.message}`);
  }

  // 2.2 Send real Telegram message
  try {
    const sendResult = await telegram.send({ ...testNotification, recipient: telegramRecipient });
    assert(sendResult.delivered === true, 'Telegram send() delivers', `delivered=${sendResult.delivered}, error=${sendResult.error}`);
    if (sendResult.delivered) {
      console.log(`    → Sent to caller-supplied chat, messageId: ${sendResult.messageId}`);
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
      recipient: telegramRecipient,
    };
    const sendResult = await telegram.send(specialNotification);
    assert(sendResult.delivered === true, 'Telegram send() handles special chars', `delivered=${sendResult.delivered}, error=${sendResult.error}`);
  } catch (err) {
    fail('Telegram send() handles special chars', `threw: ${err.message}`);
  }
} else {
  skip('Telegram verify()', 'Telegram opt-in or required canonical key presence missing');
  skip('Telegram send()', 'Telegram opt-in or required canonical key presence missing');
  skip('Telegram special chars', 'Telegram opt-in or required canonical key presence missing');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 3. Notification Router ──');

{
  const router = createNotificationRouter(notificationFactoryDeps);
  const channels = router.getAvailableChannels();
  assert(channels.includes('email') === emailOptedIn, 'Router email registration matches opt-in');
  assert(channels.includes('telegram') === telegramOptedIn, 'Router Telegram registration matches opt-in');

  // 3.1 testChannel for telegram
  if (hasTelegram) {
    try {
      const result = await router.testChannel('telegram', telegramRecipient);
      assert(result.ok === true || result.delivered === true, 'Router testChannel(telegram) succeeds', `result=${JSON.stringify(result)}`);
    } catch (err) {
      fail('Router testChannel(telegram)', `threw: ${err.message}`);
    }
  } else {
    skip('Router testChannel(telegram)', 'Telegram opt-in or canonical key presence missing');
  }

  // 3.2 testChannel for email
  if (hasSmtp) {
    try {
      const result = await router.testChannel('email', emailRecipient);
      assert(result.ok === true || result.delivered === true, 'Router testChannel(email) succeeds', `result=${JSON.stringify(result)}`);
    } catch (err) {
      fail('Router testChannel(email)', `threw: ${err.message}`);
    }
  } else {
    skip('Router testChannel(email)', 'email opt-in or canonical key presence missing');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 4. Full Pipeline (Telegram) ──');

if (hasTelegram) {
  try {
    const { pipeline } = createNotificationPipeline(notificationFactoryDeps);

    const ctx = {
      agent_id: 'e2e-pipeline-test',
      channel: 'telegram',
      recipient: telegramRecipient,
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
  skip('Pipeline E2E (telegram)', 'Telegram opt-in or canonical key presence missing');
  skip('Pipeline decision check', 'Telegram opt-in or canonical key presence missing');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── 5. Full Pipeline (Email) ──');

if (hasSmtp) {
  try {
    const { pipeline } = createNotificationPipeline(notificationFactoryDeps);

    const ctx = {
      agent_id: 'e2e-pipeline-email',
      channel: 'email',
      recipient: emailRecipient,
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
  skip('Pipeline E2E (email)', 'email opt-in or canonical key presence missing');
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
const allSkipped = skipped > 0 && passed === 0 && failed === 0;
if (allSkipped) {
  console.log('\n⚠️  All tests skipped. Set environment variables to run E2E tests.');
  console.log('   C3_ENABLE_NOTIFICATION_EMAIL=true and/or C3_ENABLE_NOTIFICATION_TELEGRAM=true');
  console.log('   C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS');
  console.log('   C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID');
}
console.log('');

process.exit(failed > 0 ? 1 : skipped > 0 ? 2 : 0);
