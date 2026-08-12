// Migration 059 — the inbox sequence is unique (F-015)
// ==============================================================================
//
// `F-015` is an open root finding that survives independently of its ACK child
// `F-112`.  The channel minted a sequence number like this:
//
//   SELECT COALESCE(MAX(seq), 0) AS max FROM mobile_notifications   -- read
//   ...                                                             -- gap
//   INSERT INTO mobile_notifications (..., seq) VALUES (..., max+1) -- write
//
// Two writers — two gateway instances against one database, or the backend and
// a gateway — can both perform the read before either performs the write, and
// then both write the same number.  Nothing rejected it: `seq` carried an
// ordinary index and no uniqueness at all.
//
// What that costs is the one guarantee the column exists to give.  A client
// reconnects by asking for "everything after N", which is the whole reason the
// inbox is sequence-based rather than timestamp-based (timestamps collide).
// With two rows at N+1, "after N+1" silently skips one of them, and the phone
// never learns a notification existed.  A missed notification that the user can
// still discover later is the product limit PLAN.md §6 accepts; one that is
// unreachable by the documented recovery path is not.
//
// So uniqueness becomes a constraint the database enforces, rather than an
// invariant the caller is trusted to maintain.  The mint itself is repaired in
// the channel, where the read and the write become one statement; this index is
// what makes any future regression fail loudly instead of losing a row.
//
// ── Repairing what the race already wrote ──────────────────────────────────
//
// A unique index cannot be created over existing duplicates, and a database
// that ran the racy code may hold some.  Rows are therefore repaired first, and
// deliberately not by renumbering everything:
//
//   * a seq that is already unique is left exactly as it is, because live
//     clients hold `afterSeq` cursors against it and a wholesale renumber would
//     invalidate every one of them;
//   * only duplicates after the first, and rows with no seq at all, are given
//     fresh numbers above the current maximum, in creation order.
//
// A repaired row therefore moves *ahead* of cursors that had already passed it,
// so a client may see it a second time.  That is the safe direction: this
// migration exists because rows were being lost, and showing one twice is not
// the failure it is fixing.
//
// ==============================================================================

import { hasTable } from '../migrate.js';

export const version = '2026_08_09_059_mobile_notification_seq_unique';
export const description = 'Make the mobile inbox sequence unique and repair rows the race duplicated (F-015)';

export function up(db) {
  if (!hasTable(db, 'mobile_notifications')) return;

  // A row is broken if it has no sequence, or if it is not the first row to
  // hold the sequence it has.  "First" is by rowid, so the repair is stable and
  // rerunnable rather than dependent on scan order.
  const broken = db.prepare(`
    SELECT rowid AS rid
      FROM mobile_notifications AS n
     WHERE n.seq IS NULL
        OR n.rowid > (SELECT MIN(m.rowid) FROM mobile_notifications AS m WHERE m.seq = n.seq)
     ORDER BY n.created_at ASC, n.rowid ASC
  `).all();

  if (broken.length) {
    const renumber = db.prepare('UPDATE mobile_notifications SET seq = ? WHERE rowid = ?');
    let next = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM mobile_notifications').get()?.max || 0;
    db.transaction(rows => {
      for (const row of rows) renumber.run(++next, row.rid);
    })(broken);
  }

  // The plain index from 055 is now redundant: a unique index answers the same
  // range lookups, and keeping both would mean two structures maintained on
  // every insert for one column.
  db.exec('DROP INDEX IF EXISTS idx_mobile_notif_seq');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_notif_seq_unique
      ON mobile_notifications(seq)
  `);
}

export function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_mobile_notif_seq_unique');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mobile_notif_seq ON mobile_notifications(seq)');
}
