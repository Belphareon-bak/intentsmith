// C3-Agent v57.2 — Trust Feedback API Routes
// ══════════════════════════════════════════════════════════════════════════════
//
// Integration points:
//   1. POST /api/notifications/:id/feedback — record 👍/👎
//   2. GET /api/trust/metrics — all agent trust metrics (dashboard)
//   3. GET /api/trust/metrics/:agentId — single agent metrics
//   4. POST /api/trust/:agentId/unmute — manual un-mute
//   5. POST /api/trust/:agentId/reset — reset feedback (dev/testing)
//
// Mount in server.js:
//   import { createTrustRoutes } from './notifications/trust-api.js';
//   const trustRoutes = createTrustRoutes({ db, notificationRouter });
//   Object.assign(routes, trustRoutes);
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { getTrustTracker } from './trust.js';
import { FeedbackHandler } from './feedback.js';

/**
 * Create trust feedback API routes.
 *
 * @param {Object} deps
 * @param {Object} deps.db — better-sqlite3 instance
 * @param {Object} [deps.notificationRouter] — for sending auto-mute explanations
 * @param {Function} deps.sendJSON — server's JSON response helper
 * @param {Function} deps.parseBody — server's body parser
 * @returns {Object} Route handlers keyed by "METHOD /path"
 */
export function createTrustRoutes({ db, notificationRouter = null, sendJSON, parseBody }) {
  // Initialize tracker (singleton, safe to call multiple times)
  const tracker = getTrustTracker(db);
  const feedbackHandler = new FeedbackHandler({ trustTracker: tracker, notificationRouter });

  return {
    // ─────────────────────────────────────────────────────────────────────
    // POST /api/notifications/:id/feedback
    // Body: { "useful": true|false }
    // ─────────────────────────────────────────────────────────────────────
    'POST /api/notifications/:id/feedback': async (req, res, params) => {
      try {
        const body = await parseBody(req);
        const notificationId = parseInt(params.id, 10);

        if (isNaN(notificationId)) {
          return sendJSON(res, 400, { error: 'Invalid notification ID' });
        }

        if (typeof body.useful !== 'boolean') {
          return sendJSON(res, 400, { error: 'Body must include "useful": true|false' });
        }

        const result = feedbackHandler.handleApiFeedback(notificationId, body.useful);

        if (!result.success) {
          return sendJSON(res, 404, { error: result.error || 'Notification not found' });
        }

        sendJSON(res, 200, {
          success: true,
          feedback: body.useful ? 'useful' : 'not_useful',
          metrics: result.metrics,
          action: result.action || null,
        });
      } catch (err) {
        logger.error('TrustAPI', `Feedback error: ${err.message}`);
        sendJSON(res, 500, { error: 'Internal error' });
      }
    },

    // ─────────────────────────────────────────────────────────────────────
    // GET /api/trust/metrics
    // Returns trust metrics for all agents
    // ─────────────────────────────────────────────────────────────────────
    'GET /api/trust/metrics': (req, res) => {
      try {
        const allMetrics = tracker.getAllMetrics();

        sendJSON(res, 200, {
          agents: allMetrics,
          summary: {
            total: allMetrics.length,
            healthy: allMetrics.filter(m => m.trustLevel === 'healthy').length,
            degraded: allMetrics.filter(m => m.trustLevel === 'degraded').length,
            critical: allMetrics.filter(m => m.trustLevel === 'critical').length,
            insufficient: allMetrics.filter(m => m.trustLevel === 'insufficient_data').length,
          },
        });
      } catch (err) {
        logger.error('TrustAPI', `Metrics error: ${err.message}`);
        sendJSON(res, 500, { error: 'Internal error' });
      }
    },

    // ─────────────────────────────────────────────────────────────────────
    // GET /api/trust/metrics/:agentId
    // Returns trust metrics for one agent
    // ─────────────────────────────────────────────────────────────────────
    'GET /api/trust/metrics/:agentId': (req, res, params) => {
      try {
        const metrics = tracker.getMetrics(params.agentId);
        sendJSON(res, 200, metrics);
      } catch (err) {
        logger.error('TrustAPI', `Metrics error: ${err.message}`);
        sendJSON(res, 500, { error: 'Internal error' });
      }
    },

    // ─────────────────────────────────────────────────────────────────────
    // POST /api/trust/:agentId/unmute
    // Manually un-mute an agent
    // ─────────────────────────────────────────────────────────────────────
    'POST /api/trust/:agentId/unmute': (req, res, params) => {
      try {
        tracker.unmute(params.agentId);

        sendJSON(res, 200, {
          success: true,
          agentId: params.agentId,
          message: `Agent ${params.agentId} un-muted`,
          metrics: tracker.getMetrics(params.agentId),
        });
      } catch (err) {
        logger.error('TrustAPI', `Unmute error: ${err.message}`);
        sendJSON(res, 500, { error: 'Internal error' });
      }
    },

    // ─────────────────────────────────────────────────────────────────────
    // POST /api/trust/:agentId/reset
    // Reset all feedback for an agent (dev/testing)
    // ─────────────────────────────────────────────────────────────────────
    'POST /api/trust/:agentId/reset': (req, res, params) => {
      try {
        tracker.resetFeedback(params.agentId);

        sendJSON(res, 200, {
          success: true,
          agentId: params.agentId,
          message: `Feedback reset for agent ${params.agentId}`,
        });
      } catch (err) {
        logger.error('TrustAPI', `Reset error: ${err.message}`);
        sendJSON(res, 500, { error: 'Internal error' });
      }
    },
  };
}

export default { createTrustRoutes };
