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
    //
    // F-015: this used to be `SELECT MAX(seq)` followed by an `INSERT` with the
    // number computed in JavaScript.  Two writers — two gateway instances
    // against one database, or the backend and a gateway — could both read
    // before either wrote, and nothing rejected the duplicate.  A client asking
    // for "after N" then skipped one of the two rows for good.
    //
    // The read and the write are now a single statement, so SQLite's write lock
    // serialises them: no other writer can observe the maximum between them.
    // Migration 059's unique index is the second half of the fix — it is what
    // turns any future path that mints a sequence itself into a loud failure
    // rather than a lost row.
    let seq;
    try {
      this.db.prepare(`
        INSERT INTO mobile_notifications
          (id, device_id, kind, priority, title, body, data_json, seq)
        SELECT ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1
          FROM mobile_notifications
      `).run(
        id,
        notification.deviceId || null,
        notification.kind || 'agent',
        notification.priority || 'normal',
        notification.title || 'IntentSmith',
        notification.body || '',
        notification.data ? JSON.stringify(notification.data) : null,
      );
      // Read back rather than assume: the number the row actually carries is
      // the one a client will cursor against, and the statement above is the
      // only thing that decided it.
      seq = this.db.prepare('SELECT seq FROM mobile_notifications WHERE id = ?').get(id)?.seq ?? null;
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
  //
  // F-112 / DR-012 A: `read` comes from this device's own receipt, never from
  // `mobile_notifications.read_at`.  That column is a pre-058 leftover, and one
  // column on a shared broadcast row cannot hold a per-device fact — reading it
  // is what made one phone's ACK silence the inbox on every other phone.
  return rawDb.prepare(`
    SELECT n.id, n.device_id, n.kind, n.priority, n.title, n.body, n.data_json,
           n.created_at, n.seq,
           r.read_at AS receipt_at
      FROM mobile_notifications n
      LEFT JOIN mobile_notification_receipts r
        ON r.notification_id = n.id AND r.device_id = ?
     WHERE n.seq > ?
       AND (n.device_id IS NULL OR n.device_id = ?)
     ORDER BY n.seq ASC
     LIMIT ?
  `).all(deviceId, afterSeq || 0, deviceId, capped + 1).map(row => ({
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    body: row.body,
    data: row.data_json ? safeParse(row.data_json) : null,
    createdAt: row.created_at,
    seq: row.seq,
    read: Boolean(row.receipt_at),
  }));
}

/**
 * Acknowledge, for one device and no other (F-112, `DR-012` A).
 *
 * Two things had to change together, and neither is sufficient alone:
 *
 *   * the write is scoped to rows this device is **allowed to see**, so an id
 *     guessed from another device's inbox acknowledges nothing.  The predicate
 *     is the same one `listMobileNotifications` reads with, on purpose: "can
 *     acknowledge" must not be a wider set than "can read";
 *   * the receipt is a row per (notification, device) rather than a column on
 *     the notification, so a broadcast can be read by one phone without
 *     becoming read on the rest.
 *
 * `INSERT OR IGNORE` makes a repeat ACK mechanically idempotent and keeps the
 * *first* read time, which is the one that happened.  The count returned is the
 * number of rows this call actually newly acknowledged — a second identical ACK
 * reports 0 rather than claiming the work twice.
 *
 * @param {Object} rawDb
 * @param {string[]} ids
 * @param {{deviceId?: string|null}} options — a missing device acknowledges
 *   nothing at all, rather than falling back to the pre-058 global behaviour.
 */
export function ackMobileNotifications(rawDb, ids = [], { deviceId = null } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  if (!deviceId) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return rawDb.prepare(`
    INSERT OR IGNORE INTO mobile_notification_receipts (notification_id, device_id)
    SELECT id, ?
      FROM mobile_notifications
     WHERE id IN (${placeholders})
       AND (device_id IS NULL OR device_id = ?)
  `).run(deviceId, ...ids, deviceId).changes;
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

export default MobileChannel;
