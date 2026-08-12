// Migration 058 — per-device read receipts for the mobile inbox (F-112)
// ==============================================================================
//
// `F-112` is an open **HIGH** finding and the narrow ACK child of `F-011` and
// `F-015`.  Reading the inbox was already scoped correctly: a device sees
// broadcasts plus the rows addressed to it, and never another device's.
// Acknowledging was not.  `POST /m1/notifications/ack` handed the handler a
// list of ids and nothing else, and the SQL updated `read_at` **by id alone**:
//
//   UPDATE mobile_notifications SET read_at = ... WHERE id IN (...)
//
// Two consequences, both reachable from a device that is behaving normally
// apart from guessing an identifier:
//
//   1. a device could acknowledge a *targeted* row belonging to another device
//      — a row it is not allowed to read, whose existence it can nevertheless
//      change;
//   2. a broadcast has exactly one `read_at` for everybody, so the first phone
//      to open the inbox marks it read on every other phone.
//
// Neither is fixable by scoping the UPDATE alone.  A device predicate closes
// (1), but (2) is a modelling error: read state belongs to a *pair* of
// (notification, device), and one column on a shared row cannot hold it.
//
// `DR-012` A — accepted by `PRODUCT_OWNER` together with `DR-003` A — makes the
// per-device receipt table the target contract.  This migration is that table.
//
// ── What happens to the read state that already exists ─────────────────────
//
// A *targeted* row's `read_at` is unambiguous: exactly one device could have
// set it, and the row names that device.  Those are backfilled into receipts
// with their original timestamp, so nothing that was read becomes unread.
//
// A *broadcast* row's `read_at` is the bug itself.  It records that *somebody*
// read it, and there is no way to learn who.  It is therefore **not**
// backfilled: those broadcasts come back as unread for every device.  The
// alternative — attributing the receipt to every paired device — would fabricate
// a fact about devices that may never have been awake, which is the failure this
// migration exists to end, written into the fix.  Showing an already-read
// broadcast once more is a smaller harm than claiming it was read.
//
// `mobile_notifications.read_at` is left in place but stops being authority:
// SQLite cannot drop a column without rebuilding the table, and rebuilding the
// inbox to remove a column that is simply no longer consulted is not a trade
// worth making.  Reads answer from the receipt table only, so a stale value in
// that column cannot resurrect a read state.
//
// ==============================================================================

import { hasTable } from '../migrate.js';

export const version = '2026_08_09_058_mobile_notification_receipts';
export const description = 'Per-device read receipts for the mobile inbox (F-112, DR-012 A)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_notification_receipts (
      notification_id TEXT NOT NULL,
      device_id       TEXT NOT NULL,
      read_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, device_id)
    )
  `);
  // The read path asks "has *this* device read these rows", so the composite
  // primary key already serves it; this index serves the reverse question a
  // per-device wipe would ask.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mobile_receipts_device
      ON mobile_notification_receipts(device_id)
  `);

  if (!hasTable(db, 'mobile_notifications')) return;

  // Targeted rows only, and their original timestamp rather than "now": a
  // receipt is a record of when something was read, and rewriting that to the
  // migration's own clock would make every historical read look simultaneous.
  db.exec(`
    INSERT OR IGNORE INTO mobile_notification_receipts (notification_id, device_id, read_at)
    SELECT id, device_id, read_at
      FROM mobile_notifications
     WHERE read_at IS NOT NULL
       AND device_id IS NOT NULL
  `);
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS mobile_notification_receipts');
}
