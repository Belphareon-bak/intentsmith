// Mobile notification channel — B6.
// ==============================================================================
//
// PLAN.md §6 asks for a channel "over broadcast()".  broadcast() alone is not
// enough to be a channel: it reaches only clients connected at that instant and
// keeps no record, so a phone that was asleep — the normal case — loses the
// notification with no way to discover it later.  PLAN.md §6 is explicit that
// background delivery is a *product limit*, not a bug; the honest way to honour
// that limit is to make the miss recoverable rather than silent.
//
// So delivery is two things:
//   1. a durable inbox row, which is the source of truth and survives sleep,
//      restart, and reconnect; and
//   2. a broadcast() hint, which is a latency optimisation for a foreground
//      client and is allowed to fail.
//
// The channel reports `delivered: true` on the inbox write, not on the
// broadcast.  Reporting delivery on a fire-and-forget send would be exactly the
// kind of unfalsifiable claim Gate 0 exists to catch.
//
// ==============================================================================

import { randomUUID } from 'node:crypto';
import { NotificationChannel } from './base.js';

export const MOBILE_NOTIFICATION_CHANNEL = 'mobile';

export class MobileChannel extends NotificationChannel {
  /**
   * @param {Object} options
   * @param {Object} options.db          raw better-sqlite3 handle
   * @param {Function} [options.broadcast] injected so tests need no WS server
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    super();
    this.db = options.db?.db || options.db || null;
    this.broadcast = options.broadcast || null;
    this.logger = options.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._enabled = process.env.C3_MOBILE_NOTIFICATIONS !== 'false';
  }

  get name() { return MOBILE_NOTIFICATION_CHANNEL; }

  async verify() {
    if (!this._enabled) return { ok: false, error: 'Mobile notifications disabled' };
    if (!this.db) return { ok: false, error: 'Mobile channel requires a database handle' };
    try {
      this.db.prepare('SELECT 1 FROM mobile_notifications LIMIT 1').get();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `Mobile inbox unavailable: ${error.message}` };
    }
  }

  async send(notification = {}) {
    if (!this._enabled) {
      return { delivered: false, error: 'Mobile notifications disabled', channel: this.name };
    }
    if (!this.db) {
      return { delivered: false, error: 'Mobile channel has no database', channel: this.name };
    }

    const id = randomUUID();
    // A monotonic per-row sequence is what lets a reconnecting client ask for
    // "everything after N" without relying on timestamps, which collide.
    const seqRow = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM mobile_notifications').get();
    const seq = (seqRow?.max || 0) + 1;

    try {
      this.db.prepare(`
        INSERT INTO mobile_notifications
          (id, device_id, kind, priority, title, body, data_json, seq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        notification.deviceId || null,
        notification.kind || 'agent',
        notification.priority || 'normal',
        notification.title || 'IntentSmith',
        notification.body || '',
        notification.data ? JSON.stringify(notification.data) : null,
        seq,
      );
    } catch (error) {
      return { delivered: false, error: `Inbox write failed: ${error.message}`, channel: this.name };
    }

    // Live hint.  Best effort by design: a failure here means a foreground
    // client learns a little later, not that the notification was lost.
    if (typeof this.broadcast === 'function') {
      try {
        this.broadcast('mobile', {
          type: 'notification',
          id,
          seq,
          kind: notification.kind || 'agent',
          priority: notification.priority || 'normal',
          title: notification.title || 'IntentSmith',
          body: notification.body || '',
        });
      } catch (error) {
        this.logger.warn?.('MobileChannel', `Live hint failed (inbox row ${id} stands): ${error.message}`);
      }
    }

    return { delivered: true, messageId: id, seq, channel: this.name };
  }
}

// ── Inbox reads, used by the /m1/notifications handler ──────────────────────

/**
 * @param {Object} rawDb
 * @param {{deviceId?: string, afterSeq?: number, limit?: number}} opts
 */
export function listMobileNotifications(rawDb, { deviceId = null, afterSeq = 0, limit = 50 } = {}) {
  const capped = Math.min(Math.max(1, limit), 200);
  // `device_id IS NULL` rows are broadcasts to every device; a device sees
  // those plus the ones addressed to it, and never another device's.
  return rawDb.prepare(`
    SELECT id, device_id, kind, priority, title, body, data_json, created_at, seq, read_at
      FROM mobile_notifications
     WHERE seq > ?
       AND (device_id IS NULL OR device_id = ?)
     ORDER BY seq ASC
     LIMIT ?
  `).all(afterSeq || 0, deviceId, capped + 1).map(row => ({
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    body: row.body,
    data: row.data_json ? safeParse(row.data_json) : null,
    createdAt: row.created_at,
    seq: row.seq,
    read: Boolean(row.read_at),
  }));
}

export function ackMobileNotifications(rawDb, ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return rawDb.prepare(`
    UPDATE mobile_notifications SET read_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders}) AND read_at IS NULL
  `).run(...ids).changes;
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

export default MobileChannel;
