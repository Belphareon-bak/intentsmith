// Migration 057 — which gateway process owns an open operation
// ==============================================================================
//
// Added because `sweepInterrupted()` was unscoped.  It ran
// `UPDATE mobile_operations SET state='UNKNOWN' WHERE state='PENDING'` over the
// whole table at start-up, on the assumption that at start-up nothing is
// legitimately in flight.  That assumption holds for *one* process and fails for
// two: a second gateway opened against the same database would relabel the first
// one's live, in-flight operations as `process_terminated` — the exact lie the
// UNKNOWN vocabulary exists to prevent, told about operations that were fine.
//
// Port binding does not rescue it.  The sweep runs *before* `listen()`, so the
// second process performs the damage and only then discovers the port is taken.
// Exclusion after the fact is not exclusion.
//
// So ownership becomes explicit and the sweep becomes a scoped statement:
//
//   mobile_operations.owner_instance   which gateway instance opened this row.
//                                      NULL means "written before this migration
//                                      existed, or by a journal not bound to a
//                                      registered instance" — unowned, and
//                                      therefore sweepable, which is exactly the
//                                      pre-057 behaviour for pre-057 rows.
//
//   mobile_gateway_instances           the liveness record a sweep consults, so
//                                      "that process is gone" is a fact read
//                                      from the database and a live PID, not an
//                                      assumption made by whoever booted last.
//
// Kept separate from 055 (`mobile_gateway`) on purpose, and for the same reason
// 056 was: 055 has already been applied in existing databases.  An applied
// migration never runs
// again, so amending it in place would upgrade only freshly created databases
// and silently leave every existing one without the column.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_09_057_mobile_gateway_instances';
export const description = 'Bind open mobile operations to the gateway instance that owns them';

export function up(db) {
  // The registry is created unconditionally: it is this migration's own table
  // and has no dependency on the mobile gateway tables existing yet.
  //
  // `host_identity` is hostname + boot id rather than hostname alone, so a PID
  // recorded before a reboot is never mistaken for a live process after one.
  // `released_at` is a state, not a deletion — the same reason api_tokens keeps
  // `revoked_at` (055): a row that is gone cannot answer "was it a clean stop
  // or a crash?", and that answer is what decides whether a sweep is honest.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_gateway_instances (
      instance_id    TEXT PRIMARY KEY,
      pid            INTEGER NOT NULL,
      host_identity  TEXT NOT NULL,
      started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      heartbeat_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      released_at    DATETIME,
      release_reason TEXT
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mobile_instances_live
      ON mobile_gateway_instances(released_at, heartbeat_at)
  `);

  if (!hasTable(db, 'mobile_operations')) return;

  if (!hasColumn(db, 'mobile_operations', 'owner_instance')) {
    // No NOT NULL and no default: existing rows must stay distinguishable as
    // unowned.  Backfilling them with the current instance would claim this
    // process opened operations it has never seen, and the sweep would then
    // protect rows whose real owner died — the failure this migration exists to
    // remove, reintroduced by a convenience default.
    db.exec(`ALTER TABLE mobile_operations ADD COLUMN owner_instance TEXT`);
  }

  // The sweep's WHERE clause is (state, owner_instance); the open-operation cap
  // reads (device_id, state) and is already indexed by 055.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mobile_ops_owner
      ON mobile_operations(state, owner_instance)
  `);
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS mobile_gateway_instances');
  // mobile_operations.owner_instance is left in place: SQLite cannot drop a
  // column without rebuilding the table, and rebuilding it would put the
  // journal — the one record that must survive a crash — at risk to undo a
  // column that is harmless when unused.
}
