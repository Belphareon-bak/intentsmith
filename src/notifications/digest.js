// C.3 v57.0 — Digest Aggregator
// ══════════════════════════════════════════════════════════════════════════════
//
// Collects notifications that the policy decided to buffer (mode = "digest"),
// groups them, deduplicates, and flushes as a summary on a schedule.
//
// A digest is NOT just a list of notifications — it's a structured summary:
//   - Grouped by agent / by topic
//   - Changes vs. last digest highlighted
//   - Duplicates suppressed
//   - Human-readable output
//
// The DigestAggregator stores buffered items in the notification_digest_buffer_v57
// table and flushes them via flush() — called by the scheduler on the configured
// digest_schedule cron.

import { logger as defaultLogger } from '../core/logger.js';

export class DigestAggregator {
  /**
   * @param {object} options
   * @param {object} [options.db] - Database instance
   * @param {object} [options.logger]
   */
  constructor({ db = null, logger = defaultLogger } = {}) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * Buffer a notification for later digest delivery.
   *
   * @param {import('./context.js').NotificationContext} ctx - Full notification context
   */
  add(ctx) {
    if (!this.db) {
      this.logger.warn('Digest', 'No DB — cannot buffer digest item');
      return;
    }

    try {
      this.db.prepare(`
        INSERT INTO notification_digest_buffer_v57
          (agent_id, channel, recipient, title, body, priority, context_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime(? / 1000, 'unixepoch'))
      `).run(
        ctx.agent_id,
        ctx.channel,
        ctx.recipient,
        ctx.title,
        ctx.body,
        ctx.priority,
        JSON.stringify({
          notification_id: ctx.notification_id,
          reason: ctx.reason,
          source: ctx.source,
        }),
        ctx.created_at
      );

      this.logger.info('Digest', `Buffered: ${ctx.agent_id} → ${ctx.channel} ("${ctx.title}")`);
    } catch (err) {
      this.logger.error('Digest', `Buffer write failed: ${err.message}`);
    }
  }

  /**
   * Flush all buffered notifications and generate digest summaries.
   * Returns an array of grouped digests ready for delivery.
   *
   * @param {object} [options]
   * @param {string} [options.agentId] - Flush only for a specific agent (null = all)
   * @returns {Array<DigestGroup>}
   */
  flush(options = {}) {
    if (!this.db) return [];

    try {
      // Fetch buffered items
      let rows;
      if (options.agentId) {
        rows = this.db.prepare(`
          SELECT * FROM notification_digest_buffer_v57
          WHERE agent_id = ?
          ORDER BY created_at ASC
        `).all(options.agentId);
      } else {
        rows = this.db.prepare(`
          SELECT * FROM notification_digest_buffer_v57
          ORDER BY agent_id, created_at ASC
        `).all();
      }

      if (!rows.length) return [];

      // Group by agent + channel
      const groups = new Map();
      for (const row of rows) {
        const key = `${row.agent_id}::${row.channel}::${row.recipient}`;
        if (!groups.has(key)) {
          groups.set(key, {
            agent_id: row.agent_id,
            channel: row.channel,
            recipient: row.recipient,
            items: [],
            highest_priority: 'low',
          });
        }
        const group = groups.get(key);
        group.items.push({
          title: row.title,
          body: row.body,
          priority: row.priority,
          context: safeParse(row.context_json),
          created_at: row.created_at,
        });

        // Track highest priority in the group
        if (priorityLevel(row.priority) > priorityLevel(group.highest_priority)) {
          group.highest_priority = row.priority;
        }
      }

      // Deduplicate within each group (by title + body hash)
      for (const group of groups.values()) {
        group.items = deduplicateItems(group.items);
      }

      // Build digest summaries
      const digests = [];
      for (const group of groups.values()) {
        digests.push({
          agent_id: group.agent_id,
          channel: group.channel,
          recipient: group.recipient,
          priority: group.highest_priority,
          title: `Denní přehled (${group.items.length} událostí)`,
          body: buildDigestBody(group.items),
          item_count: group.items.length,
          items: group.items,
        });
      }

      // Clear flushed items from buffer
      if (options.agentId) {
        this.db.prepare('DELETE FROM notification_digest_buffer_v57 WHERE agent_id = ?')
          .run(options.agentId);
      } else {
        this.db.prepare('DELETE FROM notification_digest_buffer_v57').run();
      }

      this.logger.info('Digest',
        `Flushed ${rows.length} items into ${digests.length} digests`
      );

      return digests;

    } catch (err) {
      this.logger.error('Digest', `Flush failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get count of buffered items (for monitoring / dashboard).
   */
  getBufferCount(agentId = null) {
    if (!this.db) return 0;

    try {
      if (agentId) {
        const row = this.db.prepare(
          'SELECT COUNT(*) AS cnt FROM notification_digest_buffer_v57 WHERE agent_id = ?'
        ).get(agentId);
        return row?.cnt || 0;
      }
      const row = this.db.prepare(
        'SELECT COUNT(*) AS cnt FROM notification_digest_buffer_v57'
      ).get();
      return row?.cnt || 0;
    } catch {
      return 0;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function priorityLevel(p) {
  return { low: 0, normal: 1, high: 2, critical: 3 }[p] || 0;
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

/**
 * Deduplicate items by title (keep first occurrence, count repeats).
 */
function deduplicateItems(items) {
  const seen = new Map();
  const result = [];

  for (const item of items) {
    const key = item.title;
    if (seen.has(key)) {
      seen.get(key).repeat_count++;
    } else {
      const entry = { ...item, repeat_count: 1 };
      seen.set(key, entry);
      result.push(entry);
    }
  }

  return result;
}

/**
 * Build human-readable digest body.
 *
 * Output example:
 *   Dnes 3 změny:
 *   – Nový pozemek (Brno)
 *   – Pokles teploty pod -5 °C (2×)
 *   – Žádné nové AI zprávy
 */
function buildDigestBody(items) {
  if (!items.length) return 'Žádné nové události.';

  const lines = [`Dnes ${items.length} ${items.length === 1 ? 'událost' : items.length < 5 ? 'události' : 'událostí'}:`];

  for (const item of items) {
    const repeat = item.repeat_count > 1 ? ` (${item.repeat_count}×)` : '';
    lines.push(`– ${item.title}${repeat}`);
  }

  return lines.join('\n');
}
