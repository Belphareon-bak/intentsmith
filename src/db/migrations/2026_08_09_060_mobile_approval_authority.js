// Migration 060 — an approval names what it authorises (F-100)
// ==============================================================================
//
// `F-100` blocks production and has four parts: no production producer, no TTL
// authority, no mandatory fingerprint, and no authoritative binding to the run,
// the operation and the normalised content.  `UI-DESIGN.md` §6.6 is explicit
// that none of them can be closed by editing the UI or the documentation.
//
// This migration is the storage half of the last one.  `mobile_approvals` could
// describe a request in prose — `subject_type`, `subject_id`, `title` — but
// nothing tied it to the thing it would authorise.  A row could therefore exist
// that a user can grant without the server being able to say *what* was
// granted, which is the shape of the finding.
//
//   origin         which side of `DR-011` this approval lives under, and
//                  therefore how long it may stand: local 5 minutes, remote 15.
//                  Nullable on purpose — see below.
//   run_id         the run the request belongs to.
//   operation_ref  the operation or effect it authorises.
//
// All three are nullable, and that is the point rather than a compromise.  Rows
// that predate this migration have no binding and no honest way to acquire one:
// inventing a `run_id` for them would manufacture exactly the authority the
// finding is about.  They stay unbound and become **undecidable** — the decide
// path refuses them by name.  A grant is the dangerous act, so that is where
// the binding is required.
//
// The queue keeps listing them.  Hiding a pending request would replace one
// lie with another: `SS-02` says "nic nečeká" is permission to put the phone
// down, and it has to remain true.
//
// `expires_at` deliberately gains no "extended_at", "renewed_by" or similar.
// `R-3`/`DR-011` make the window single-use and non-extendable, and the way to
// keep that true is for no column to exist that could record an extension.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_09_060_mobile_approval_authority';
export const description = 'Bind a mobile approval to its origin, run and operation (F-100, DR-011)';

export function up(db) {
  if (!hasTable(db, 'mobile_approvals')) return;

  for (const column of ['origin', 'run_id', 'operation_ref']) {
    if (!hasColumn(db, 'mobile_approvals', column)) {
      db.exec(`ALTER TABLE mobile_approvals ADD COLUMN ${column} TEXT`);
    }
  }

  // The queue reads open rows; this serves the reverse question — "what is open
  // for this run" — which is what a producer needs before minting another.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mobile_approvals_run
      ON mobile_approvals(run_id, decided_at)
  `);
}

export function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_mobile_approvals_run');
  // The columns stay: SQLite cannot drop one without rebuilding the table, and
  // rebuilding a table that holds granted decisions to remove three unused
  // columns is not a trade worth making.
}
