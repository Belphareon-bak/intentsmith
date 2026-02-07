// C3-Agent v57.2 — Trust Feedback Loop
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
// Every notification must answer: "Proč mě tím rušíš?"
// Trust loop ensures that unanswered question kills the notification stream.
//
// ARCHITECTURE:
//   User feedback (👍/👎)
//         ↓
//   notification_log_v57.useful = 1|0
//         ↓
//   TrustTracker.getMetrics(agentId)
//         ↓
//   Auto-degradation via NotificationPolicy
//
// THRESHOLDS:
//   useful_ratio ≥ 0.3  →  normal (immediate/digest per policy)
//   useful_ratio < 0.3  →  auto-degrade to digest mode
//   useful_ratio < 0.1  →  auto-mute + explanation notification
//
// INVARIANTS:
//   ❗ Auto-mute is NEVER silent — always sends explanation
//   ❗ Metrics are per-agent, rolling 30-day window
//   ❗ No feedback = neutral (doesn't count against or for)
//   ❗ User can always manually un-mute
//
// ADAPTED: sent_at → created_at, status='sent' → delivered=1,
//          added auto_mute_reason migration for notification_state_v57
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TRUST_CONFIG = {
  // Rolling window for metrics calculation
  windowDays: 30,

  // Minimum feedback count before auto-degradation kicks in
  // (prevents premature muting on 1 bad notification)
  minFeedbackCount: 5,

  // Thresholds
  degradeToDigestThreshold: 0.3,   // < 30% useful → digest mode
  autoMuteThreshold: 0.1,          // < 10% useful → auto-mute

  // Silence detection: if agent hasn't sent anything in N days, flag it
  silenceWarningDays: 14,
};

export { TRUST_CONFIG };

// ─────────────────────────────────────────────────────────────────────────────
// Trust Metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TrustMetrics
 * @property {string} agentId
 * @property {number} totalSent — notifications sent in window
 * @property {number} totalFeedback — notifications with feedback
 * @property {number} useful — count of 👍
 * @property {number} notUseful — count of 👎
 * @property {number} noFeedback — sent but no feedback
 * @property {number} usefulRatio — useful / totalFeedback (NaN if no feedback)
 * @property {string} trustLevel — 'healthy' | 'degraded' | 'critical' | 'insufficient_data'
 * @property {string|null} lastSentAt — ISO timestamp
 * @property {number} silenceDays — days since last notification
 * @property {boolean} shouldDegrade — recommend digest mode
 * @property {boolean} shouldMute — recommend auto-mute
 */

// ─────────────────────────────────────────────────────────────────────────────
// TrustTracker
// ─────────────────────────────────────────────────────────────────────────────

export class TrustTracker {
  #db;

  /**
   * @param {Object} db — Database instance (better-sqlite3)
   */
  constructor(db) {
    this.#db = db;
    this.#ensureSchema();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Schema
  // ─────────────────────────────────────────────────────────────────────────

  #ensureSchema() {
    // Add 'useful' column to notification_log if it doesn't exist
    try {
      this.#db.prepare(`
        ALTER TABLE notification_log_v57 ADD COLUMN useful INTEGER DEFAULT NULL
      `).run();
      logger.info('Trust', 'Added useful column to notification_log_v57');
    } catch (err) {
      // Column already exists — expected
      if (!err.message.includes('duplicate column')) {
        logger.warn('Trust', `Schema check: ${err.message}`);
      }
    }

    // Add feedback_at timestamp
    try {
      this.#db.prepare(`
        ALTER TABLE notification_log_v57 ADD COLUMN feedback_at TEXT DEFAULT NULL
      `).run();
      logger.info('Trust', 'Added feedback_at column to notification_log_v57');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        logger.warn('Trust', `Schema check: ${err.message}`);
      }
    }

    // Add auto_mute_reason to notification_state_v57
    try {
      this.#db.prepare(`
        ALTER TABLE notification_state_v57 ADD COLUMN auto_mute_reason TEXT DEFAULT NULL
      `).run();
      logger.info('Trust', 'Added auto_mute_reason column to notification_state_v57');
    } catch (err) {
      if (!err.message.includes('duplicate column')) {
        logger.warn('Trust', `Schema check: ${err.message}`);
      }
    }

    // Trust actions log — records auto-degradation/mute events
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS notification_trust_actions_v57 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        metrics_snapshot TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Index for fast metrics queries (uses created_at, not sent_at)
    try {
      this.#db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notif_log_agent_created
          ON notification_log_v57(agent_id, created_at)
      `);
      this.#db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notif_log_useful
          ON notification_log_v57(agent_id, useful)
          WHERE useful IS NOT NULL
      `);
    } catch (err) {
      // Indexes might already exist
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Record Feedback
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Record user feedback on a notification.
   *
   * @param {number} notificationId — ID from notification_log_v57
   * @param {boolean} isUseful — true = 👍, false = 👎
   * @returns {{ success: boolean, metrics?: TrustMetrics, action?: string }}
   */
  recordFeedback(notificationId, isUseful) {
    // Update the notification record
    const result = this.#db.prepare(`
      UPDATE notification_log_v57
      SET useful = ?, feedback_at = datetime('now')
      WHERE id = ?
    `).run(isUseful ? 1 : 0, notificationId);

    if (result.changes === 0) {
      logger.warn('Trust', `Notification ${notificationId} not found for feedback`);
      return { success: false };
    }

    // Get agent_id for this notification
    const row = this.#db.prepare(`
      SELECT agent_id FROM notification_log_v57 WHERE id = ?
    `).get(notificationId);

    if (!row) {
      return { success: false };
    }

    const agentId = row.agent_id;
    logger.info('Trust', `Feedback recorded: notification=${notificationId}, agent=${agentId}, useful=${isUseful}`);

    // Check if auto-degradation should trigger
    const metrics = this.getMetrics(agentId);
    const action = this.#evaluateAutoDegradation(agentId, metrics);

    return { success: true, metrics, action };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metrics Calculation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate trust metrics for an agent.
   *
   * @param {string} agentId
   * @returns {TrustMetrics}
   */
  getMetrics(agentId) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - TRUST_CONFIG.windowDays);
    const windowISO = windowStart.toISOString();

    // Aggregate stats from notification_log
    // ADAPTED: created_at instead of sent_at, delivered=1 instead of status='sent'
    const stats = this.#db.prepare(`
      SELECT
        COUNT(*) as total_sent,
        COUNT(CASE WHEN useful IS NOT NULL THEN 1 END) as total_feedback,
        COUNT(CASE WHEN useful = 1 THEN 1 END) as useful_count,
        COUNT(CASE WHEN useful = 0 THEN 1 END) as not_useful_count,
        MAX(created_at) as last_sent_at
      FROM notification_log_v57
      WHERE agent_id = ?
        AND created_at >= ?
        AND delivered = 1
    `).get(agentId, windowISO);

    const totalSent = stats?.total_sent || 0;
    const totalFeedback = stats?.total_feedback || 0;
    const useful = stats?.useful_count || 0;
    const notUseful = stats?.not_useful_count || 0;
    const noFeedback = totalSent - totalFeedback;
    const lastSentAt = stats?.last_sent_at || null;

    // Calculate ratio (only from notifications WITH feedback)
    const usefulRatio = totalFeedback > 0 ? useful / totalFeedback : NaN;

    // Silence detection
    let silenceDays = 0;
    if (lastSentAt) {
      const lastSent = new Date(lastSentAt);
      silenceDays = Math.floor((Date.now() - lastSent.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Determine trust level
    let trustLevel;
    let shouldDegrade = false;
    let shouldMute = false;

    if (totalFeedback < TRUST_CONFIG.minFeedbackCount) {
      trustLevel = 'insufficient_data';
    } else if (usefulRatio >= TRUST_CONFIG.degradeToDigestThreshold) {
      trustLevel = 'healthy';
    } else if (usefulRatio >= TRUST_CONFIG.autoMuteThreshold) {
      trustLevel = 'degraded';
      shouldDegrade = true;
    } else {
      trustLevel = 'critical';
      shouldMute = true;
    }

    return {
      agentId,
      totalSent,
      totalFeedback,
      useful,
      notUseful,
      noFeedback,
      usefulRatio,
      trustLevel,
      lastSentAt,
      silenceDays,
      shouldDegrade,
      shouldMute,
    };
  }

  /**
   * Get metrics for ALL agents (for dashboard).
   *
   * @returns {TrustMetrics[]}
   */
  getAllMetrics() {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - TRUST_CONFIG.windowDays);
    const windowISO = windowStart.toISOString();

    // ADAPTED: created_at instead of sent_at, delivered=1 instead of status='sent'
    const agents = this.#db.prepare(`
      SELECT DISTINCT agent_id
      FROM notification_log_v57
      WHERE created_at >= ?
        AND delivered = 1
    `).all(windowISO);

    return agents.map(row => this.getMetrics(row.agent_id));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-Degradation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluate if agent should be auto-degraded/muted.
   * Called after each feedback.
   *
   * @param {string} agentId
   * @param {TrustMetrics} metrics
   * @returns {string|null} — Action taken: 'degraded_to_digest' | 'auto_muted' | null
   * @private
   */
  #evaluateAutoDegradation(agentId, metrics) {
    if (metrics.trustLevel === 'insufficient_data') {
      return null;
    }

    // Check if already degraded/muted (avoid duplicate actions)
    const recentAction = this.#db.prepare(`
      SELECT action FROM notification_trust_actions_v57
      WHERE agent_id = ?
        AND created_at >= datetime('now', '-1 day')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(agentId);

    if (metrics.shouldMute) {
      if (recentAction?.action === 'auto_muted') return null; // Already muted today

      this.#logTrustAction(agentId, 'auto_muted', metrics);
      this.#setMuteState(agentId, 7); // Mute for 7 days

      logger.warn('Trust', `Agent ${agentId} AUTO-MUTED: useful_ratio=${metrics.usefulRatio.toFixed(2)}`);
      return 'auto_muted';
    }

    if (metrics.shouldDegrade) {
      if (recentAction?.action === 'degraded_to_digest') return null;

      this.#logTrustAction(agentId, 'degraded_to_digest', metrics);

      logger.warn('Trust', `Agent ${agentId} DEGRADED to digest: useful_ratio=${metrics.usefulRatio.toFixed(2)}`);
      return 'degraded_to_digest';
    }

    // Check if previously degraded and now recovered
    if (metrics.trustLevel === 'healthy' && recentAction?.action) {
      this.#logTrustAction(agentId, 'recovered', metrics);
      logger.info('Trust', `Agent ${agentId} RECOVERED: useful_ratio=${metrics.usefulRatio.toFixed(2)}`);
      return 'recovered';
    }

    return null;
  }

  /**
   * Set mute state for agent in notification_state_v57.
   * @param {string} agentId
   * @param {number} days — mute duration
   * @private
   */
  #setMuteState(agentId, days) {
    const mutedUntil = new Date();
    mutedUntil.setDate(mutedUntil.getDate() + days);

    try {
      this.#db.prepare(`
        INSERT INTO notification_state_v57 (agent_id, muted_until, auto_mute_reason)
        VALUES (?, ?, 'low_trust_ratio')
        ON CONFLICT(agent_id) DO UPDATE SET
          muted_until = excluded.muted_until,
          auto_mute_reason = excluded.auto_mute_reason
      `).run(agentId, mutedUntil.toISOString());
    } catch (err) {
      logger.error('Trust', `Failed to set mute state: ${err.message}`);
    }
  }

  /**
   * Log trust action for audit trail.
   * @private
   */
  #logTrustAction(agentId, action, metrics) {
    try {
      this.#db.prepare(`
        INSERT INTO notification_trust_actions_v57 (agent_id, action, reason, metrics_snapshot)
        VALUES (?, ?, ?, ?)
      `).run(
        agentId,
        action,
        `useful_ratio=${metrics.usefulRatio.toFixed(2)}, feedback=${metrics.totalFeedback}/${metrics.totalSent}`,
        JSON.stringify(metrics)
      );
    } catch (err) {
      logger.error('Trust', `Failed to log trust action: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query: Trust adjustment for Policy
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get trust-based policy override for an agent.
   * Called by NotificationPolicy.evaluate() to check if trust requires mode change.
   *
   * @param {string} agentId
   * @returns {{ override: string|null, reason: string|null }}
   *   override: 'digest' | 'drop' | null
   */
  getTrustOverride(agentId) {
    const metrics = this.getMetrics(agentId);

    if (metrics.shouldMute) {
      return {
        override: 'drop',
        reason: `Auto-muted: useful_ratio=${metrics.usefulRatio.toFixed(2)} (${metrics.useful}/${metrics.totalFeedback} useful in ${TRUST_CONFIG.windowDays}d)`,
      };
    }

    if (metrics.shouldDegrade) {
      return {
        override: 'digest',
        reason: `Degraded: useful_ratio=${metrics.usefulRatio.toFixed(2)} (${metrics.useful}/${metrics.totalFeedback} useful in ${TRUST_CONFIG.windowDays}d)`,
      };
    }

    return { override: null, reason: null };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Manual Controls
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Manually un-mute an agent (user override).
   * @param {string} agentId
   */
  unmute(agentId) {
    try {
      this.#db.prepare(`
        UPDATE notification_state_v57
        SET muted_until = NULL, auto_mute_reason = NULL
        WHERE agent_id = ?
      `).run(agentId);

      this.#logTrustAction(agentId, 'manual_unmute', this.getMetrics(agentId));
      logger.info('Trust', `Agent ${agentId} manually un-muted`);
    } catch (err) {
      logger.error('Trust', `Failed to unmute: ${err.message}`);
    }
  }

  /**
   * Reset trust metrics for an agent (clears all feedback).
   * Use with caution — mainly for testing.
   * @param {string} agentId
   */
  resetFeedback(agentId) {
    this.#db.prepare(`
      UPDATE notification_log_v57
      SET useful = NULL, feedback_at = NULL
      WHERE agent_id = ?
    `).run(agentId);

    this.#logTrustAction(agentId, 'feedback_reset', this.getMetrics(agentId));
    logger.info('Trust', `Feedback reset for agent ${agentId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-mute notification message builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the explanation message sent when an agent is auto-muted.
 * This is NOT optional — auto-mute must always be visible.
 *
 * @param {string} agentName — human-readable agent name
 * @param {TrustMetrics} metrics
 * @returns {{ title: string, body: string }}
 */
export function buildAutoMuteNotification(agentName, metrics) {
  const pct = (metrics.usefulRatio * 100).toFixed(0);
  const window = TRUST_CONFIG.windowDays;
  const muteStr = `7 dní`;

  return {
    title: `⏸ ${agentName} — automaticky utlumen`,
    body: [
      `Hlídač "${agentName}" byl automaticky utlumen na ${muteStr}.`,
      ``,
      `Důvod: ${metrics.notUseful} z posledních ${metrics.totalFeedback} notifikací bylo označeno jako neužitečné (${pct}% užitečnost za ${window} dní).`,
      ``,
      `Můžeš ho kdykoliv znovu zapnout v nastavení.`,
    ].join('\n'),
  };
}

/**
 * Build degradation notification (digest mode).
 */
export function buildDegradeNotification(agentName, metrics) {
  const pct = (metrics.usefulRatio * 100).toFixed(0);

  return {
    title: `📉 ${agentName} — přepnut na souhrn`,
    body: [
      `Hlídač "${agentName}" byl přepnut do souhrnného režimu.`,
      ``,
      `Důvod: užitečnost notifikací klesla na ${pct}% za posledních ${TRUST_CONFIG.windowDays} dní.`,
      `Notifikace budou doručovány v denním souhrnu místo okamžitě.`,
    ].join('\n'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * @param {Object} [db] — Pass DB on first call
 * @returns {TrustTracker}
 */
export function getTrustTracker(db = null) {
  if (!_instance && db) {
    _instance = new TrustTracker(db);
  }
  return _instance;
}

export function resetTrustTracker() {
  _instance = null;
}

export default {
  TrustTracker,
  getTrustTracker,
  resetTrustTracker,
  buildAutoMuteNotification,
  buildDegradeNotification,
  TRUST_CONFIG,
};
