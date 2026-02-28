// Notification Routes — channel management, config, test, log
// ==============================================================================

import { logger } from '../core/logger.js';

/**
 * @param {{ notificationRouter: import('../notifications/service.js').NotificationRouter, db: import('better-sqlite3').Database, sendJSON: Function, parseBody: Function }} deps
 */
export function createNotificationRoutes({ notificationRouter, db, sendJSON, parseBody }) {
  return {
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

        const rawDb = db?.db || db;
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
