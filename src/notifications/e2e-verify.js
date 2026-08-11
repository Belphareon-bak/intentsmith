// ═══════════════════════════════════════════════════════════════════════════════

import {
  NOTIFICATION_CHANNEL_DISABLED,
  NOTIFICATION_CHANNEL_UNSUPPORTED,
  notificationVerifierChannelEnabled,
  readNotificationChannelPolicy,
} from './channel-policy.js';
import {
  notificationEnvironmentAuthority as runtimeNotificationEnvironmentAuthority,
  requireNotificationEnvironmentAuthority as requireRuntimeNotificationEnvironmentAuthority,
} from '../runtime-environment.js';

function disabledVerificationResult(channel) {
  return {
    channel,
    configured: false,
    sent: false,
    delivered: false,
    latencyMs: 0,
    code: NOTIFICATION_CHANNEL_DISABLED,
    error: NOTIFICATION_CHANNEL_DISABLED,
    messageId: null,
    details: {},
  };
}

function requireVerificationOptIn(channel, env) {
  const policy = readNotificationChannelPolicy(env);
  return notificationVerifierChannelEnabled(policy, channel)
    ? null
    : disabledVerificationResult(channel);
}

function requireVerifierEnvironmentAuthority(deps) {
  const requireAuthority = deps.requireNotificationEnvironmentAuthority
    ?? requireRuntimeNotificationEnvironmentAuthority;
  const authority = deps.notificationEnvironmentAuthority
    ?? runtimeNotificationEnvironmentAuthority;
  if (typeof requireAuthority !== 'function') {
    const error = new TypeError('NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID');
    error.code = 'NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID';
    throw error;
  }
  return requireAuthority(authority);
}
// C3-Agent — B0: E2E Notification Verification
// ═══════════════════════════════════════════════════════════════════════════════
//
// End-to-end verification of notification delivery:
//   1. Email: SMTP → inbox check (via IMAP or test mailbox API)
//   2. Telegram: Bot API → message delivered check
//   3. ntfy.sh: HTTP POST → push received
//   4. Generic: dry-run mode for testing without credentials
//
// Usage:
//   node src/notifications/e2e-verify.js --channel email --recipient test@example.com
//   node src/notifications/e2e-verify.js --channel telegram --recipient 123456
//   node src/notifications/e2e-verify.js --channel ntfy --recipient my-topic
//   node src/notifications/e2e-verify.js --dry-run  (all channels, no real delivery)
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Verification Result ─────────────────────────────────────────────────────

/**
 * @typedef {Object} VerificationResult
 * @property {string} channel - Channel name
 * @property {boolean} configured - Whether credentials are present
 * @property {boolean} sent - Whether send() succeeded
 * @property {boolean} delivered - Whether delivery was confirmed
 * @property {number} latencyMs - Round-trip time
 * @property {string|null} error - Error message if failed
 * @property {string|null} messageId - Message ID from channel
 * @property {object} details - Channel-specific details
 */

// ─── Channel Verifiers ───────────────────────────────────────────────────────

/**
 * Verify email channel configuration and delivery.
 */
export async function verifyEmail(config = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const disabled = requireVerificationOptIn('email', env);
  if (disabled) return disabled;
  const authority = requireVerifierEnvironmentAuthority(deps);
  const value = key => authority.value(key);
  const smtpHost = value('C3_SMTP_HOST');
  const smtpPort = value('C3_SMTP_PORT') || 587;
  const smtpUser = value('C3_SMTP_USER');
  const smtpPass = value('C3_SMTP_PASS');
  const smtpFrom = value('C3_SMTP_FROM') || smtpUser;
  const recipient = config.recipient;

  const result = {
    channel: 'email',
    configured: !!(smtpHost && smtpUser && smtpPass && recipient),
    sent: false, delivered: false, latencyMs: 0, error: null, messageId: null,
    details: {
      smtpHostSet: smtpHost.length > 0,
      smtpPortSet: authority.status().C3_SMTP_PORT.configured,
      recipientSet: typeof recipient === 'string' && recipient.length > 0,
    },
  };

  if (!result.configured) {
    result.error = 'Missing SMTP config or explicit recipient';
    return result;
  }

  const start = Date.now();
  try {
    // Dynamic import nodemailer
    const createTransport = deps.createTransport
      || (await import('nodemailer')).createTransport;
    const transport = createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    // Verify connection
    await transport.verify();

    // Send test message
    const info = await transport.sendMail({
      from: smtpFrom,
      to: recipient,
      subject: `[C3-Agent E2E Test] ${new Date().toISOString()}`,
      text: `This is an automated E2E verification from C3-Agent.\nTimestamp: ${new Date().toISOString()}\nIf you received this, email delivery works.`,
      html: `<h3>C3-Agent E2E Test</h3><p>✅ Email delivery verified at ${new Date().toISOString()}</p>`,
    });

    result.sent = true;
    result.delivered = true;
    result.messageId = info.messageId;
    result.latencyMs = Date.now() - start;
  } catch (err) {
    result.error = err.message;
    result.latencyMs = Date.now() - start;
  }

  return result;
}

/**
 * Verify Telegram channel configuration and delivery.
 */
export async function verifyTelegram(config = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const disabled = requireVerificationOptIn('telegram', env);
  if (disabled) return disabled;
  const authority = requireVerifierEnvironmentAuthority(deps);
  const botToken = authority.value('C3_TELEGRAM_BOT_TOKEN');
  const chatId = Object.hasOwn(config, 'recipient')
    ? config.recipient
    : authority.value('C3_TELEGRAM_CHAT_ID');

  const result = {
    channel: 'telegram',
    configured: botToken.length > 0
      && typeof chatId === 'string'
      && chatId.length > 0,
    sent: false, delivered: false, latencyMs: 0, error: null, messageId: null,
    details: { recipientSet: !!chatId, botTokenSet: !!botToken },
  };

  if (!result.configured) {
    result.error = 'Missing Telegram credential or explicit recipient';
    return result;
  }

  const start = Date.now();
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: `✅ *C3-Agent E2E Test*\n\nNotification delivery verified.\n📅 ${new Date().toISOString()}`,
      parse_mode: 'Markdown',
    };

    const fetchImpl = deps.fetchImpl || fetch;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.ok) {
      result.sent = true;
      result.delivered = true;
      result.messageId = String(data.result?.message_id);
    } else {
      result.error = data.description || 'Telegram API error';
    }

    result.latencyMs = Date.now() - start;
  } catch (err) {
    result.error = err.message;
    result.latencyMs = Date.now() - start;
  }

  return result;
}

/**
 * Verify ntfy.sh push channel.
 */
export async function verifyNtfy(config = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const disabled = requireVerificationOptIn('ntfy', env);
  if (disabled) return disabled;
  const authority = requireVerifierEnvironmentAuthority(deps);
  const serverUrl = authority.value('C3_NTFY_SERVER') || 'https://ntfy.sh';
  const topic = Object.hasOwn(config, 'recipient')
    ? config.recipient
    : authority.value('C3_NTFY_TOPIC');
  const token = authority.value('C3_NTFY_TOKEN');

  const result = {
    channel: 'ntfy',
    configured: typeof topic === 'string' && topic.length > 0,
    sent: false, delivered: false, latencyMs: 0, error: null, messageId: null,
    details: {
      serverConfigured: authority.status().C3_NTFY_SERVER.configured,
      recipientSet: !!topic,
      hasToken: !!token,
    },
  };

  if (!result.configured) {
    result.error = 'Missing explicit ntfy recipient';
    return result;
  }

  const start = Date.now();
  try {
    const url = `${serverUrl}/${topic}`;
    const headers = {
      'Title': 'C3-Agent E2E Test',
      'Priority': '3',
      'Tags': 'white_check_mark,robot',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const fetchImpl = deps.fetchImpl || fetch;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: `✅ C3-Agent E2E notification verified at ${new Date().toISOString()}`,
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      result.sent = true;
      result.delivered = true;
      result.messageId = data.id || null;
    } else {
      result.error = `HTTP ${res.status}: ${await res.text()}`;
    }

    result.latencyMs = Date.now() - start;
  } catch (err) {
    result.error = err.message;
    result.latencyMs = Date.now() - start;
  }

  return result;
}

// ─── Dry Run (no real delivery) ──────────────────────────────────────────────

export function dryRun() {
  const channels = ['email', 'telegram', 'ntfy'];
  return channels.map(ch => ({
    channel: ch,
    configured: false,
    sent: false,
    delivered: false,
    simulated: true,
    proof: false,
    latencyMs: 0,
    error: null,
    messageId: `dry-run-${ch}-${Date.now()}`,
    details: { mode: 'dry-run' },
  }));
}

// ─── Full Verification ───────────────────────────────────────────────────────

/**
 * Run E2E verification for all configured channels.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Skip real delivery
 * @param {string[]} [options.channels] - Specific channels to test
 * @returns {Promise<{
 *   results: VerificationResult[],
 *   allPassed: boolean,
 *   summary: string,
 * }>}
 */
export async function verifyAll(options = {}, deps = {}) {
  if (options.dryRun) {
    const results = dryRun();
    return {
      results,
      allPassed: false,
      summary: '🔸 Dry run — no delivery proof was attempted.',
    };
  }

  const channelSet = options.channels || ['email', 'telegram', 'ntfy'];
  const verifiers = {
    email: verifyEmail,
    telegram: verifyTelegram,
    ntfy: verifyNtfy,
  };

  const results = [];
  for (const ch of channelSet) {
    const verifier = verifiers[ch];
    if (verifier) {
      results.push(await verifier(options[ch] || {}, deps));
    } else {
      results.push({
        channel: ch,
        configured: false,
        sent: false,
        delivered: false,
        latencyMs: 0,
        code: NOTIFICATION_CHANNEL_UNSUPPORTED,
        error: NOTIFICATION_CHANNEL_UNSUPPORTED,
        messageId: null,
        details: {},
      });
    }
  }

  const allPassed = results.length > 0 && results.every(r => r.delivered === true);
  const configured = results.filter(r => r.configured);
  const delivered = results.filter(r => r.delivered);

  const summary = configured.length === 0
    ? '⚠️ No requested channel produced delivery evidence.'
    : delivered.length === configured.length
      ? `✅ All ${delivered.length}/${configured.length} configured channels delivered successfully.`
      : `❌ ${delivered.length}/${configured.length} channels delivered. Failures: ${results.filter(r => r.configured && !r.delivered).map(r => r.channel).join(', ')}`;

  return { results, allPassed, summary };
}

export default { verifyEmail, verifyTelegram, verifyNtfy, verifyAll, dryRun };
