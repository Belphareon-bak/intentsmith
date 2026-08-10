// Migration 056 — why, and since when, an operation is UNKNOWN
// ==============================================================================
//
// Three columns the recovery screen cannot work without (UI-DESIGN §6.9 / B-17):
//
//   unknown_reason   *why* the server could not determine the operation's fate,
//                    always a code from the closed list in protocol.js — free
//                    text cannot be asserted on, translated, or trusted.
//   unknown_at       *when* it became UNKNOWN.  Age is measured from here, not
//                    from created_at: a request that ran for an hour and then
//                    lost its answer is not an hour-old unknown.
//   last_checked_at  when the state was last verified, so the screen can say
//                    "checked 2 minutes ago" instead of implying it is live.
//
// This is a separate migration rather than an edit to 055 (`mobile_gateway`)
// because 055 has already been applied in databases created before the column
// existed.  A migration that has run never runs again, so amending it in place
// would leave those databases without the column — and `markUnknown()` would throw
// on every ambiguous timeout, which is the one moment it must work.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_09_056_mobile_unknown_reason';
export const description = 'Record why, since when, and as of when a mobile operation is UNKNOWN';

export function up(db) {
  if (!hasTable(db, 'mobile_operations')) return;
  const columns = [
    ['unknown_reason', 'TEXT'],
    ['unknown_at', 'DATETIME'],
    ['last_checked_at', 'DATETIME'],
  ];
  for (const [name, type] of columns) {
    if (!hasColumn(db, 'mobile_operations', name)) {
      db.exec(`ALTER TABLE mobile_operations ADD COLUMN ${name} ${type}`);
    }
  }
}
