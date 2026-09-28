// C.3 v57.0 — Notification Pipeline
// ══════════════════════════════════════════════════════════════════════════════
//
// High-level orchestrator that replaces direct Router.send() calls.
//
// Pipeline:
//   runner builds context object (plain data, no Builder class)
//     → Pipeline.process(ctx, policyConfig)
//       → Policy.evaluate(ctx, policyConfig)  [mute → escalation → suppress → mode]
//       → decision: immediate → Router.send() → Policy.recordSent()
//       → decision: digest    → Digest.add()
//       → decision: drop      → log only
//     → returns { delivered, decision, reason, ... }
//
// The Router stays as low-level channel send (also used by test-notify endpoint).
// Pipeline is what the runner calls.
//
// Context shape (typedef, not a class):
//   {
//     agent_id: string,
//     channel: string,
//     recipient: string,
//     title: string,
//     body: string,
//     priority: 'low'|'normal'|'high'|'critical',
//     created_at: number,  // Date.now()
//     reason: { trigger, condition, source_id, source_type, value },
//     data: any
//   }

import { logger as defaultLogger } from '../core/logger.js';

export class NotificationPipeline {
  /**
   * @param {object} options
   * @param {import('./service.js').NotificationRouter} options.router - Low-level channel router
   * @param {import('./policy.js').NotificationPolicy} options.policy - Policy engine
   * @param {import('./digest.js').DigestAggregator} options.digest - Digest aggregator
   * @param {object} [options.db] - Database for logging
   * @param {object} [options.logger]
   */
  constructor({ router, policy, digest, db = null, logger = defaultLogger }) {
    this.router = router;
    this.policy = policy;
    this.digest = digest;
    this.db = db;
    this.logger = logger;
  }

  /**
   * Process a notification event through the full pipeline.
   *
   * @param {object} ctx - Notification context (plain object)
   * @param {object} [policyConfig] - Per-agent notification_policy from agent definition
   * @returns {Promise<{ delivered: boolean, decision: string, reason: string, effectivePriority: string, escalated: boolean, error?: string }>}
   */
  async process(ctx, policyConfig = null) {
    // Ensure created_at
    if (!ctx.created_at) ctx.created_at = Date.now();

    // ─── Policy evaluation (mute → escalation → suppress → mode) ─────
    const policyResult = this.policy.evaluate(ctx, policyConfig);
    const { decision, effectivePriority, reason, escalated } = policyResult;

    this.logger.info('Pipeline',
      `${ctx.agent_id}: ${decision} (${reason})${escalated ? ' [ESCALATED]' : ''}`
    );

    // ─── Execute decision ─────────────────────────────────────────────
    let delivered = false;
    let error = null;

    switch (decision) {
      case 'immediate': {
        const result = await this.router.send({
          channel: ctx.channel,
          recipient: ctx.recipient,
          title: ctx.title,
          body: ctx.body,
          priority: effectivePriority,
          agentId: ctx.agent_id,
          data: ctx.data,
        });
        delivered = result.delivered;
        error = result.error || null;

        if (delivered) {
          this.policy.recordSent(ctx.agent_id, ctx);
        }
        break;
      }

      case 'digest': {
        this.digest.add(ctx);
        // Not "delivered" yet — will be delivered on digest flush
        delivered = false;
        break;
      }

      case 'drop':
      default:
        delivered = false;
        break;
    }

    // ─── Log to notification_log (with full context) ──────────────────
    this._log(ctx, decision, effectivePriority, delivered, error);

    return {
      delivered,
      decision,
      reason,
      effectivePriority,
      escalated,
      error,
    };
  }

  /**
   * Flush digest and deliver all buffered summaries.
   * Called by scheduler on digest_schedule cron.
   *
   * @param {object} [options]
   * @param {string} [options.agentId] - Flush only for one agent
   * @returns {Promise<Array<{ agent_id: string, delivered: boolean, item_count: number }>>}
   */
  async flushDigest(options = {}) {
    const digests = this.digest.flush(options);
    const results = [];

    for (const d of digests) {
      const result = await this.router.send({
        channel: d.channel,
        recipient: d.recipient,
        title: d.title,
        body: d.body,
        priority: d.priority,
        agentId: d.agent_id,
      });

      if (result.delivered) {
        this.policy.recordSent(d.agent_id, {
          body: d.body,
          priority: d.priority,
        });
      }

      this._log(
        { agent_id: d.agent_id, channel: d.channel, recipient: d.recipient, title: d.title, body: d.body },
        'digest_flush',
        d.priority,
        result.delivered,
        result.error
      );

      results.push({
        agent_id: d.agent_id,
        delivered: result.delivered,
        item_count: d.item_count,
        error: result.error,
      });
    }

    return results;
  }

  /**
   * Preview/dry-run: simulate the full pipeline without sending.
   *
   * @param {object} ctx - Notification context
   * @param {object} [policyConfig]
   * @returns {{ would_send: boolean, decision: string, reason: string, effectivePriority: string, escalated: boolean, digest_buffer_count?: number, next_scheduled_send?: string }}
   */
  preview(ctx, policyConfig = null) {
    if (!ctx.created_at) ctx.created_at = Date.now();

    const policyResult = this.policy.evaluate(
      { ...ctx },  // copy so we don't mutate original
      policyConfig
    );

    const result = {
      would_send: policyResult.decision === 'immediate',
      decision: policyResult.decision,
      reason: policyResult.reason,
      effectivePriority: policyResult.effectivePriority,
      escalated: policyResult.escalated,
    };

    if (policyResult.decision === 'digest') {
      result.digest_buffer_count = this.digest.getBufferCount(ctx.agent_id);
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Internal
  // ════════════════════════════════════════════════════════════════════════

  _log(ctx, decision, priority, delivered, error) {
    if (!this.db) return;

    const contextJson = JSON.stringify({
      reason: ctx.reason || null,
      source: ctx.source || null,
      data: ctx.data || null,
    });

    try {
      this.db.prepare(`
        INSERT INTO notification_log_v57
          (agent_id, channel, recipient, title, priority, delivered, policy_decision, error, context_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ctx.agent_id || null,
        ctx.channel || 'in_app',
        ctx.recipient || null,
        ctx.title || null,
        priority,
        delivered ? 1 : 0,
        decision,
        error || null,
        contextJson
      );
    } catch (err) {
      this.logger.debug('Pipeline', `Log write failed: ${err.message}`);
    }
  }
}
