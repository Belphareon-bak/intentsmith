// C.3 v57.0 — Notification Policy Engine (includes escalation)
// ══════════════════════════════════════════════════════════════════════════════
//
// Single decision point for every notification event:
//   evaluate(context, policyConfig) → { decision, effectivePriority, reason }
//
// Decision flow (inside evaluate):
//   1. Check mute state (runtime, per-agent, DB-backed)
//   2. Count recent triggers → compute effectivePriority (escalation)
//   3. Check suppress rules (cooldown, if_unchanged)
//   4. Determine mode: immediate / digest / drop
//
// Policy config lives in agent definition:
//   {
//     "notification_policy": {
//       "mode": "immediate" | "digest" | "auto",
//       "digest_schedule": "0 18 * * *",
//       "suppress": { "if_unchanged": true, "cooldown_minutes": 30 },
//       "escalation": { "repeat_threshold": 3, "window_minutes": 60, "escalate_to": "high" }
//     }
//   }
//
// Runtime state lives in notification_state_v57 (separate from config):
//   { muted_until, last_sent_at, last_effective_priority, last_body_hash,
//     escalation_counter, escalation_window_start }

import { logger as defaultLogger } from '../core/logger.js';

/** @typedef {'immediate'|'digest'|'drop'} PolicyDecision */

const PRIORITY_ORDER = ['low', 'normal', 'high', 'critical'];

const DEFAULT_POLICY = {
  mode: 'immediate',
  suppress: { if_unchanged: false, cooldown_minutes: 0 },
  escalation: { repeat_threshold: 3, window_minutes: 60, escalate_to: 'high' },
};

export class NotificationPolicy {
  /**
   * @param {object} options
   * @param {object} [options.db] - better-sqlite3 instance
   * @param {object} [options.logger]
   */
  constructor({ db = null, logger = defaultLogger } = {}) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * Evaluate policy for a notification event.
   *
   * @param {object} ctx - Notification context (plain object from runner/pipeline)
   * @param {string} ctx.agent_id
   * @param {string} ctx.body
   * @param {string} ctx.priority - Original priority from action config
   * @param {number} ctx.created_at - Unix timestamp ms
   * @param {object} [policyConfig] - Per-agent policy config from agent definition
   * @returns {{ decision: PolicyDecision, effectivePriority: string, reason: string, escalated: boolean }}
   */
  evaluate(ctx, policyConfig = null) {
    const policy = mergePolicy(policyConfig);
    const state = this._getState(ctx.agent_id);

    // ─── 1. Mute check ────────────────────────────────────────────────
    if (state.muted_until) {
      const muteEnd = new Date(state.muted_until).getTime();
      if (ctx.created_at < muteEnd) {
        // Critical bypasses mute
        if (ctx.priority !== 'critical') {
          return {
            decision: 'drop',
            effectivePriority: ctx.priority,
            reason: `muted until ${state.muted_until}`,
            escalated: false,
          };
        }
        this.logger.info('Policy', `${ctx.agent_id}: critical bypasses mute`);
      }
    }

    // ─── 2. Escalation (priority upgrade based on repeat count) ───────
    const esc = policy.escalation;
    const recentCount = this._countRecentDelivered(ctx.agent_id, ctx.created_at - esc.window_minutes * 60 * 1000);
    let effectivePriority = ctx.priority;
    let escalated = false;

    if (recentCount >= esc.repeat_threshold) {
      const currentIdx = PRIORITY_ORDER.indexOf(ctx.priority);
      const targetIdx = PRIORITY_ORDER.indexOf(esc.escalate_to);
      if (targetIdx > currentIdx) {
        effectivePriority = esc.escalate_to;
        escalated = true;
        this.logger.info('Policy',
          `${ctx.agent_id}: escalated ${ctx.priority} → ${effectivePriority} (${recentCount} in ${esc.window_minutes}min)`
        );
      }
    }

    // Write back to context so downstream has effective priority
    ctx.priority = effectivePriority;

    // ─── 3. Suppress: cooldown ────────────────────────────────────────
    const suppress = policy.suppress;
    if (suppress.cooldown_minutes > 0 && state.last_sent_at) {
      const lastMs = new Date(state.last_sent_at).getTime();
      const cooldownMs = suppress.cooldown_minutes * 60 * 1000;
      const elapsed = ctx.created_at - lastMs;

      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
        return {
          decision: 'drop',
          effectivePriority,
          reason: `cooldown (${remaining}min remaining)`,
          escalated,
        };
      }
    }

    // ─── 4. Suppress: if_unchanged ────────────────────────────────────
    if (suppress.if_unchanged && state.last_body_hash) {
      const currentHash = hashBody(ctx.body);
      if (currentHash === state.last_body_hash) {
        return {
          decision: 'drop',
          effectivePriority,
          reason: 'content unchanged',
          escalated,
        };
      }
    }

    // ─── 5. Determine mode ────────────────────────────────────────────
    let mode = policy.mode || 'immediate';

    if (mode === 'auto') {
      // high/critical → immediate, rest → digest (if schedule exists)
      if (effectivePriority === 'high' || effectivePriority === 'critical') {
        mode = 'immediate';
      } else if (policy.digest_schedule) {
        mode = 'digest';
      } else {
        mode = 'immediate';
      }
    }

    const decision = mode === 'digest' ? 'digest' : 'immediate';
    const reason = decision === 'digest'
      ? `digest mode (schedule: ${policy.digest_schedule || 'default'})`
      : 'immediate delivery';

    return { decision, effectivePriority, reason, escalated };
  }

  /**
   * Record that a notification was successfully sent.
   * Updates runtime state (last_sent_at, last_body_hash, etc.)
   */
  recordSent(agentId, ctx) {
    if (!this.db) return;
    const bodyHash = hashBody(ctx.body);
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO notification_state_v57
          (agent_id, last_sent_at, last_effective_priority, last_body_hash, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          last_sent_at = excluded.last_sent_at,
          last_effective_priority = excluded.last_effective_priority,
          last_body_hash = excluded.last_body_hash,
          updated_at = excluded.updated_at
      `).run(agentId, now, ctx.priority, bodyHash, now);
    } catch (err) {
      this.logger.debug('Policy', `State write failed: ${err.message}`);
    }
  }

  /**
   * Mute notifications for an agent until a given time.
   */
  mute(agentId, untilISO) {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO notification_state_v57 (agent_id, muted_until, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(agent_id) DO UPDATE SET muted_until = excluded.muted_until, updated_at = datetime('now')
      `).run(agentId, untilISO);
    } catch (err) {
      this.logger.debug('Policy', `Mute write failed: ${err.message}`);
    }
  }

  /**
   * Unmute an agent.
   */
  unmute(agentId) {
    this.mute(agentId, null);
  }

  /**
   * Get the current runtime state for an agent (for dashboard / debugging).
   */
  getState(agentId) {
    return this._getState(agentId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Internal
  // ════════════════════════════════════════════════════════════════════════

  _getState(agentId) {
    const empty = {
      muted_until: null,
      last_sent_at: null,
      last_effective_priority: null,
      last_body_hash: null,
      escalation_counter: 0,
      escalation_window_start: null,
    };
    if (!this.db) return empty;

    try {
      return this.db.prepare(
        'SELECT * FROM notification_state_v57 WHERE agent_id = ?'
      ).get(agentId) || empty;
    } catch {
      return empty;
    }
  }

  /**
   * Count delivered notifications for an agent since windowStartMs.
   */
  _countRecentDelivered(agentId, windowStartMs) {
    if (!this.db) return 0;
    try {
      const windowISO = new Date(windowStartMs).toISOString();
      const row = this.db.prepare(`
        SELECT COUNT(*) AS cnt FROM notification_log_v57
        WHERE agent_id = ? AND created_at >= ? AND delivered = 1
      `).get(agentId, windowISO);
      return row?.cnt || 0;
    } catch {
      return 0;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function mergePolicy(config) {
  if (!config) return { ...DEFAULT_POLICY };
  return {
    mode: config.mode || DEFAULT_POLICY.mode,
    digest_schedule: config.digest_schedule || null,
    suppress: { ...DEFAULT_POLICY.suppress, ...config.suppress },
    escalation: { ...DEFAULT_POLICY.escalation, ...config.escalation },
  };
}

/**
 * Simple hash of body string for if_unchanged detection.
 */
function hashBody(body) {
  if (!body) return '0';
  let hash = 0;
  const str = String(body);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(16);
}
