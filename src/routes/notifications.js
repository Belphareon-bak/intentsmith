// Notification Routes — channel management, config, test, log
// ==============================================================================

import { logger } from '../core/logger.js';
import {
  NOTIFICATION_SETTING_FIELD_MAP,
  UserSettingsError,
  updateNotificationUserSettings,
} from '../db/user-settings.js';

const SMTP_RUNTIME_FIELDS = Object.freeze([
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpPass',
  'smtpFrom',
]);

/**
 * @param {{ notificationRouter: import('../notifications/service.js').NotificationRouter, db: import('better-sqlite3').Database, sendJSON: Function, parseBody: Function }} deps
 */
export function createNotificationRoutes({ notificationRouter, notificationEmitter, db, sendJSON, parseBody }) {
  const rawDb = db?.db || db;

  return {
    // ── v93: Get notification config (masks password) ─────────────────
    'GET /api/notifications/config': (req, res) => {
      try {
        const row = rawDb.prepare('SELECT data FROM user_settings WHERE id = 1').get();
        const s = row ? JSON.parse(row.data) : {};
        sendJSON(res, 200, {
          emailEnabled: s['c3.notif.emailEnabled'] || false,
          smtpHost: s['c3.notif.smtpHost'] || '',
          smtpPort: s['c3.notif.smtpPort'] || 587,
          smtpUser: s['c3.notif.smtpUser'] || '',
          smtpPass: s['c3.notif.smtpPass'] ? '*****' : '',
          smtpFrom: s['c3.notif.smtpFrom'] || '',
          emailRecipient: s['c3.notif.emailRecipient'] || '',
          emailOnLifecycle: s['c3.notif.emailOnLifecycle'] !== false,
          emailOnWorker: s['c3.notif.emailOnWorker'] !== false,
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to read notification config' });
      }
    },

    // ── v93: Save notification config ─────────────────────────────────
    'POST /api/notifications/config': async (req, res) => {
      let body;
      try {
        body = await parseBody(req);
      } catch (_) {
        return sendJSON(res, 400, {
          success: false,
          code: 'NOTIFICATION_SETTINGS_INPUT_INVALID',
        });
      }

      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return sendJSON(res, 400, {
          success: false,
          code: 'NOTIFICATION_SETTINGS_INPUT_INVALID',
        });
      }

      // Preserve the existing field contract while giving invalid input a
      // stable public code rather than exposing implementation error text.
      if (body.emailRecipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.emailRecipient)) {
        return sendJSON(res, 400, {
          success: false,
          code: 'NOTIFICATION_EMAIL_RECIPIENT_INVALID',
        });
      }
      if (body.smtpPort && (body.smtpPort < 1 || body.smtpPort > 65535)) {
        return sendJSON(res, 400, {
          success: false,
          code: 'NOTIFICATION_SMTP_PORT_INVALID',
        });
      }

      let committed;
      try {
        committed = updateNotificationUserSettings(rawDb, body);
      } catch (error) {
        const invalidInput = error instanceof UserSettingsError
          && error.code === 'NOTIFICATION_SETTINGS_INPUT_INVALID';
        return sendJSON(res, invalidInput ? 400 : 503, {
          success: false,
          code: invalidInput
            ? 'NOTIFICATION_SETTINGS_INPUT_INVALID'
            : 'NOTIFICATION_SETTINGS_STORAGE_FAILED',
        });
      }

      let runtimeApplied = true;
      const smtpRuntimeUpdateRequested = SMTP_RUNTIME_FIELDS.some(
        field => Object.hasOwn(body, field)
          && !(field === 'smtpPass' && body.smtpPass === '*****'),
      );
      try {
        // Runtime changes happen only after the durable transaction commits.
        if (smtpRuntimeUpdateRequested) {
          const runtimeConfig = {
            host: committed[NOTIFICATION_SETTING_FIELD_MAP.smtpHost],
            port: committed[NOTIFICATION_SETTING_FIELD_MAP.smtpPort],
            user: committed[NOTIFICATION_SETTING_FIELD_MAP.smtpUser],
            pass: committed[NOTIFICATION_SETTING_FIELD_MAP.smtpPass],
            from: committed[NOTIFICATION_SETTING_FIELD_MAP.smtpFrom],
          };
          if (runtimeConfig.host) {
            notificationRouter.updateChannelConfig('email', runtimeConfig);
          } else {
            // EmailChannel cannot apply an empty host today. Persistence is
            // still durable, so report the runtime divergence truthfully.
            runtimeApplied = false;
          }
        }
        if (notificationEmitter) notificationEmitter.invalidateCache();
      } catch (_) {
        runtimeApplied = false;
      }

      if (!runtimeApplied) {
        try {
          logger.warn('Notifications', 'Config committed but runtime apply failed');
        } catch (_) {
          // Diagnostics cannot change the durable outcome.
        }
        return sendJSON(res, 200, {
          success: true,
          runtimeApplied: false,
          runtimeErrorCode: 'NOTIFICATION_RUNTIME_APPLY_FAILED',
        });
      }

      return sendJSON(res, 200, {
        success: true,
        runtimeApplied: true,
        runtimeErrorCode: null,
      });
    },

    // ── List channels ────────────────────────────────────────────────────
    'GET /api/notifications/channels': (req, res) => {
      try {
        const channels = notificationRouter.getAvailableChannels();
        const channelInfo = channels.map(name => {
          const ch = notificationRouter.channels.get(name);
          return { name, configured: true };
        });

        // Add known but unregistered channels
        const knownChannels = ['email', 'telegram', 'ntfy', 'push', 'webhook', 'desktop'];
        for (const name of knownChannels) {
          if (!channels.includes(name)) {
            channelInfo.push({ name, configured: false });
          }
        }

        sendJSON(res, 200, { channels: channelInfo });
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to list channels' });
      }
    },

    // ── Test channel ─────────────────────────────────────────────────────
    'POST /api/notifications/test': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { channel, recipient } = body;

        if (!channel) {
          return sendJSON(res, 400, { error: 'Missing channel parameter' });
        }

        const result = await notificationRouter.testChannel(channel, recipient || 'test');
        sendJSON(res, result.ok ? 200 : 400, result);
      } catch (err) {
        sendJSON(res, 500, { error: `Test failed: ${err.message}` });
      }
    },

    // ── Verify channel config ────────────────────────────────────────────
    'POST /api/notifications/verify': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { channel } = body;

        if (!channel) {
          return sendJSON(res, 400, { error: 'Missing channel parameter' });
        }

        const ch = notificationRouter.channels.get(channel);
        if (!ch) {
          return sendJSON(res, 404, { error: `Channel '${channel}' not registered` });
        }

        const result = await ch.verify();
        sendJSON(res, result.ok ? 200 : 400, result);
      } catch (err) {
        sendJSON(res, 500, { error: `Verify failed: ${err.message}` });
      }
    },

    // ── Notification log (recent deliveries) ─────────────────────────────
    'GET /api/notifications/log': (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

        let entries = [];
        try {
          entries = rawDb.prepare(
            'SELECT * FROM notification_log_v57 ORDER BY created_at DESC LIMIT ?'
          ).all(limit);
        } catch (_) {
          // Table may not exist
        }

        sendJSON(res, 200, { entries, count: entries.length });
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to fetch notification log' });
      }
    },

    // ── Send manual notification (admin/test) ────────────────────────────
    'POST /api/notifications/send': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { channel, recipient, title, body: msgBody, priority } = body;

        if (!channel || !title) {
          return sendJSON(res, 400, { error: 'Missing channel or title' });
        }

        const result = await notificationRouter.send({
          channel,
          recipient: recipient || '',
          title,
          body: msgBody || '',
          priority: priority || 'normal',
          agentId: 'manual',
        });

        sendJSON(res, result.delivered ? 200 : 400, result);
      } catch (err) {
        sendJSON(res, 500, { error: `Send failed: ${err.message}` });
      }
    },
  };
}
