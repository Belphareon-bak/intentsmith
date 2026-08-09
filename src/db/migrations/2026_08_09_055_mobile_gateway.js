// Migration 055 — Mobile gateway state
// ==============================================================================
//
// Backing store for the requirements in docs/mobile/DATA-MODEL.md §8.  Each
// table exists because a requirement there is otherwise unsatisfiable:
//
//   api_tokens.revoked_at    §8.3 — "revoked" must be distinguishable from
//                            "invalid".  Deleting the row collapses both into
//                            one 401 and the client cannot tell the user why.
//   mobile_pairing_codes     S-5  — single use is enforced by a UNIQUE partial
//                            index plus a conditional UPDATE, not by a read.
//   mobile_operations        §8.8–8.11 — the (device_id, operation_id) dedup
//                            record.  It is a table and not a cache because
//                            §8.9 requires it to survive a server restart.
//   mobile_approvals         §8.4/§8.5 — payload fingerprint, own expiry, and
//                            single-use decision.
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_08_09_055_mobile_gateway';
export const description = 'Mobile gateway: revocation, pairing, operation journal, approvals';

export function up(db) {
  // ── §8.3 revocation is a state, not an absence ────────────────────────────
  //
  // Migration 024 creates api_tokens, so in a normal chain it exists by now.
  // The guard covers the abnormal chains — a rolled-back 024, or a
  // schema_migrations table that claims more than the schema actually has —
  // where an unguarded ALTER would abort the whole migration run and leave the
  // database half-upgraded.
  if (hasTable(db, 'api_tokens')) {
    if (!hasColumn(db, 'api_tokens', 'revoked_at')) {
      db.exec(`ALTER TABLE api_tokens ADD COLUMN revoked_at DATETIME`);
    }
    if (!hasColumn(db, 'api_tokens', 'device_id')) {
      db.exec(`ALTER TABLE api_tokens ADD COLUMN device_id TEXT`);
    }
    if (!hasColumn(db, 'api_tokens', 'kind')) {
      db.exec(`ALTER TABLE api_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'api'`);
    }
  }

  // ── Pairing codes (S-5) ───────────────────────────────────────────────────
  // The code itself is never stored: only its SHA-256.  A leaked database
  // therefore does not yield a usable pairing code.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_pairing_codes (
      id            TEXT PRIMARY KEY,
      code_hash     TEXT NOT NULL UNIQUE,
      scopes        TEXT NOT NULL DEFAULT '[]',
      label         TEXT,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at    DATETIME NOT NULL,
      claimed_at    DATETIME,
      claimed_by    TEXT,
      cancelled_at  DATETIME,
      attempt_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mobile_pairing_hash ON mobile_pairing_codes(code_hash)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mobile_pairing_expiry ON mobile_pairing_codes(expires_at)`);

  // ── Operation journal (MD-19, §8.8–8.11) ──────────────────────────────────
  // PRIMARY KEY (device_id, operation_id) is the dedup contract itself: a
  // second insert with the same key cannot succeed, so "same key, same
  // fingerprint returns the original result" and "same key, different payload
  // is a conflict" are both decided by the database rather than by a
  // read-then-write race in application code.
  //
  // request_fingerprint stores a hash only.  Per MD-19 the payload is never
  // journalled — that is what keeps the journal S1 instead of S2.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_operations (
      device_id           TEXT NOT NULL,
      operation_id        TEXT NOT NULL,
      operation_type      TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      state               TEXT NOT NULL DEFAULT 'PENDING',
      result_json         TEXT,
      error_code          TEXT,
      -- Why an attempt became UNKNOWN, when it became UNKNOWN, and when its
      -- state was last verified.  Without these the recovery screen can only
      -- say "we don't know", which gives the user nothing to act on, and the
      -- escalation ladder in UI-DESIGN §16 has no age to escalate by
      -- (UI-DESIGN §6.9 / B-17).  unknown_reason is always a code from the
      -- closed list in protocol.js, never free text.
      unknown_reason      TEXT,
      unknown_at          DATETIME,
      last_checked_at     DATETIME,
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at         DATETIME,
      PRIMARY KEY (device_id, operation_id)
    )
  `);
  // Databases that already applied this migration in its earlier form are
  // upgraded by migration 047, not here — an applied migration never runs
  // again, so patching it in place would leave those databases broken.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mobile_ops_open
      ON mobile_operations(device_id, state)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mobile_ops_created
      ON mobile_operations(device_id, created_at)
  `);

  // ── Approvals (§8.4, §8.5) ────────────────────────────────────────────────
  // payload_fingerprint binds the grant to exactly the payload it was shown
  // for; expires_at is the approval's own TTL, independent of token expiry.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_approvals (
      id                  TEXT PRIMARY KEY,
      subject_type        TEXT NOT NULL,
      subject_id          TEXT NOT NULL,
      title               TEXT NOT NULL,
      detail              TEXT,
      payload_fingerprint TEXT NOT NULL,
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at          DATETIME NOT NULL,
      decided_at          DATETIME,
      decision            TEXT,
      decided_by          TEXT,
      decision_operation  TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mobile_approvals_open ON mobile_approvals(decided_at, expires_at)`);

  // ── Mobile notification inbox (B6) ────────────────────────────────────────
  // broadcast() is fire-and-forget and reaches only currently connected
  // clients.  A phone that was asleep would silently lose notifications, so
  // delivery is backed by a readable inbox and broadcast is the live hint.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_notifications (
      id            TEXT PRIMARY KEY,
      device_id     TEXT,
      kind          TEXT NOT NULL,
      priority      TEXT NOT NULL DEFAULT 'normal',
      title         TEXT NOT NULL,
      body          TEXT,
      data_json     TEXT,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      seq           INTEGER,
      read_at       DATETIME
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_mobile_notif_seq ON mobile_notifications(seq)`);
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS mobile_notifications');
  db.exec('DROP TABLE IF EXISTS mobile_approvals');
  db.exec('DROP TABLE IF EXISTS mobile_operations');
  db.exec('DROP TABLE IF EXISTS mobile_pairing_codes');
  // api_tokens columns are left in place: SQLite cannot drop a column without
  // a table rebuild, and rebuilding would risk the existing token rows.
}
