// Notification Routes — channel management, config, test, log
// ==============================================================================

import { logger } from '../core/logger.js';

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
      try {
        const body = await parseBody(req);

        // Validate email format
        if (body.emailRecipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.emailRecipient)) {
          return sendJSON(res, 400, { error: 'Invalid email recipient format' });
        }
        if (body.smtpPort && (body.smtpPort < 1 || body.smtpPort > 65535)) {
          return sendJSON(res, 400, { error: 'SMTP port must be 1-65535' });
        }

        // Merge into user_settings atomically
        rawDb.exec(`CREATE TABLE IF NOT EXISTS user_settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        const existing = rawDb.prepare('SELECT data FROM user_settings WHERE id = 1').get();
        const current = existing ? JSON.parse(existing.data) : {};

        const settingsMap = {
          emailEnabled: 'c3.notif.emailEnabled',
          smtpHost: 'c3.notif.smtpHost',
          smtpPort: 'c3.notif.smtpPort',
          smtpUser: 'c3.notif.smtpUser',
          smtpPass: 'c3.notif.smtpPass',
          smtpFrom: 'c3.notif.smtpFrom',
          emailRecipient: 'c3.notif.emailRecipient',
          emailOnLifecycle: 'c3.notif.emailOnLifecycle',
          emailOnWorker: 'c3.notif.emailOnWorker',
        };

        for (const [key, settingKey] of Object.entries(settingsMap)) {
          if (key in body && body[key] !== '*****') {
            current[settingKey] = body[key];
          }
        }

        rawDb.prepare('INSERT OR REPLACE INTO user_settings (id, data, updated_at) VALUES (1, ?, datetime(\'now\'))').run(JSON.stringify(current));

        // Update channel config at runtime
        if (body.smtpHost) {
          notificationRouter.updateChannelConfig('email', {
            host: body.smtpHost,
            port: body.smtpPort,
            user: body.smtpUser,
            pass: body.smtpPass !== '*****' ? body.smtpPass : undefined,
            from: body.smtpFrom,
          });
        }
        if (notificationEmitter) notificationEmitter.invalidateCache();

        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, { error: `Config save failed: ${err.message}` });
      }
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
