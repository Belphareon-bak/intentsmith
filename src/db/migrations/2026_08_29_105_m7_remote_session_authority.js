import { createHash } from 'node:crypto';

import { registerM7SessionAuthorityFunctions } from '../../remote/m7-session-authority-validation.js';

export const version = '2026_08_29_105_m7_remote_session_authority';
export const description = 'Add durable M7 pairing, session, replay and audit authority';

export const EXPECTED_M7_REMOTE_SESSION_AUTHORITY_FINGERPRINT_V105 =
  '0669d7418c6a57943503f109037e4cd1e96305cf149efc104f90be1275d16a60';

const OBJECT_NAMES = Object.freeze([
  'm7_remote_pairing_claims',
  'm7_remote_pairings',
  'm7_remote_session_challenges',
  'm7_remote_sessions',
  'm7_remote_invocation_nonces',
  'm7_remote_session_audit_events',
  'idx_m7_remote_pairing_claim_expiry',
  'idx_m7_remote_pairing_device',
  'idx_m7_remote_session_challenge_lookup',
  'idx_m7_remote_session_current',
  'idx_m7_remote_session_audit_identity',
  'trg_m7_remote_pairing_claim_update',
  'trg_m7_remote_pairing_claim_no_delete',
  'trg_m7_remote_pairing_update',
  'trg_m7_remote_pairing_no_delete',
  'trg_m7_remote_session_challenge_update',
  'trg_m7_remote_session_challenge_no_delete',
  'trg_m7_remote_session_update',
  'trg_m7_remote_session_no_delete',
  'trg_m7_remote_invocation_nonce_no_update',
  'trg_m7_remote_invocation_nonce_no_delete',
  'trg_m7_remote_session_audit_exact',
  'trg_m7_remote_session_audit_no_update',
  'trg_m7_remote_session_audit_no_delete',
]);

export function computeM7RemoteSessionAuthorityFingerprintV105(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/gu, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function install(db) {
  db.exec(`
    CREATE TABLE m7_remote_pairing_claims (
      claim_id TEXT PRIMARY KEY CHECK (length(claim_id) BETWEEN 1 AND 128),
      claim_digest TEXT NOT NULL UNIQUE CHECK (
        length(claim_digest) = 71
        AND substr(claim_digest, 1, 7) = 'sha256:'
        AND substr(claim_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      scopes_json BLOB NOT NULL CHECK (
        typeof(scopes_json) = 'blob' AND json_valid(scopes_json)
        AND json_type(scopes_json) = 'array'
      ),
      issued_by TEXT NOT NULL CHECK (length(issued_by) BETWEEN 1 AND 128),
      issued_at_ms INTEGER NOT NULL CHECK (typeof(issued_at_ms) = 'integer' AND issued_at_ms > 0),
      expires_at_ms INTEGER NOT NULL CHECK (
        typeof(expires_at_ms) = 'integer'
        AND expires_at_ms > issued_at_ms
        AND expires_at_ms - issued_at_ms <= 300000
      ),
      consumed_at_ms INTEGER CHECK (
        consumed_at_ms IS NULL OR (
          typeof(consumed_at_ms) = 'integer'
          AND consumed_at_ms >= issued_at_ms
          AND consumed_at_ms <= expires_at_ms
        )
      ),
      revoked_at_ms INTEGER CHECK (
        revoked_at_ms IS NULL OR (
          typeof(revoked_at_ms) = 'integer' AND revoked_at_ms >= issued_at_ms
        )
      ),
      CHECK (consumed_at_ms IS NULL OR revoked_at_ms IS NULL)
    );

    CREATE INDEX idx_m7_remote_pairing_claim_expiry
      ON m7_remote_pairing_claims(expires_at_ms, consumed_at_ms, revoked_at_ms);

    CREATE TABLE m7_remote_pairings (
      pairing_revision TEXT PRIMARY KEY CHECK (length(pairing_revision) BETWEEN 1 AND 128),
      device_id TEXT NOT NULL UNIQUE CHECK (length(device_id) BETWEEN 1 AND 128),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      device_key_id TEXT NOT NULL CHECK (length(device_key_id) BETWEEN 8 AND 128),
      device_public_key BLOB NOT NULL CHECK (
        typeof(device_public_key) = 'blob' AND length(device_public_key) = 32
      ),
      scopes_json BLOB NOT NULL CHECK (
        typeof(scopes_json) = 'blob' AND json_valid(scopes_json)
        AND json_type(scopes_json) = 'array'
      ),
      claim_id TEXT NOT NULL UNIQUE REFERENCES m7_remote_pairing_claims(claim_id),
      paired_at_ms INTEGER NOT NULL CHECK (typeof(paired_at_ms) = 'integer' AND paired_at_ms > 0),
      state TEXT NOT NULL CHECK (state IN ('PAIRED', 'REVOKED')),
      revoked_at_ms INTEGER CHECK (
        revoked_at_ms IS NULL OR (
          typeof(revoked_at_ms) = 'integer' AND revoked_at_ms >= paired_at_ms
        )
      ),
      CHECK (
        (state = 'PAIRED' AND revoked_at_ms IS NULL)
        OR (state = 'REVOKED' AND revoked_at_ms IS NOT NULL)
      )
    );

    CREATE INDEX idx_m7_remote_pairing_device
      ON m7_remote_pairings(device_id, pairing_revision, subject_id, state);

    CREATE TABLE m7_remote_session_challenges (
      challenge_id TEXT PRIMARY KEY CHECK (length(challenge_id) BETWEEN 1 AND 128),
      nonce_digest TEXT NOT NULL UNIQUE CHECK (
        length(nonce_digest) = 71
        AND substr(nonce_digest, 1, 7) = 'sha256:'
        AND substr(nonce_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      purpose TEXT NOT NULL CHECK (purpose IN ('OPEN', 'REFRESH')),
      device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
      pairing_revision TEXT NOT NULL REFERENCES m7_remote_pairings(pairing_revision),
      session_id TEXT CHECK (session_id IS NULL OR length(session_id) BETWEEN 1 AND 128),
      session_revision TEXT CHECK (
        session_revision IS NULL OR length(session_revision) BETWEEN 1 AND 128
      ),
      issued_at_ms INTEGER NOT NULL CHECK (typeof(issued_at_ms) = 'integer' AND issued_at_ms > 0),
      expires_at_ms INTEGER NOT NULL CHECK (
        typeof(expires_at_ms) = 'integer'
        AND expires_at_ms > issued_at_ms
        AND expires_at_ms - issued_at_ms <= 60000
      ),
      consumed_at_ms INTEGER CHECK (
        consumed_at_ms IS NULL OR (
          typeof(consumed_at_ms) = 'integer'
          AND consumed_at_ms >= issued_at_ms
          AND consumed_at_ms <= expires_at_ms
        )
      ),
      CHECK (
        (purpose = 'OPEN' AND session_id IS NULL AND session_revision IS NULL)
        OR (purpose = 'REFRESH' AND session_id IS NOT NULL AND session_revision IS NOT NULL)
      )
    );

    CREATE INDEX idx_m7_remote_session_challenge_lookup
      ON m7_remote_session_challenges(
        device_id, pairing_revision, purpose, expires_at_ms, consumed_at_ms
      );

    CREATE TABLE m7_remote_sessions (
      session_revision TEXT PRIMARY KEY CHECK (length(session_revision) BETWEEN 1 AND 128),
      session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
      generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation >= 1),
      device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      pairing_revision TEXT NOT NULL REFERENCES m7_remote_pairings(pairing_revision),
      device_key_id TEXT NOT NULL CHECK (length(device_key_id) BETWEEN 8 AND 128),
      scopes_json BLOB NOT NULL CHECK (
        typeof(scopes_json) = 'blob' AND json_valid(scopes_json)
        AND json_type(scopes_json) = 'array'
      ),
      client_build TEXT NOT NULL CHECK (length(client_build) BETWEEN 1 AND 256),
      server_origin TEXT NOT NULL CHECK (length(server_origin) BETWEEN 1 AND 512),
      server_identity_pin TEXT NOT NULL CHECK (length(server_identity_pin) = 71),
      adapter_manifest_digest TEXT NOT NULL CHECK (length(adapter_manifest_digest) = 71),
      issued_at_ms INTEGER NOT NULL CHECK (typeof(issued_at_ms) = 'integer' AND issued_at_ms > 0),
      expires_at_ms INTEGER NOT NULL CHECK (
        typeof(expires_at_ms) = 'integer'
        AND expires_at_ms > issued_at_ms
        AND expires_at_ms - issued_at_ms <= 900000
      ),
      last_client_counter INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(last_client_counter) = 'integer' AND last_client_counter >= 0
      ),
      state TEXT NOT NULL CHECK (state IN ('ACTIVE', 'REFRESHED', 'REVOKED', 'EXPIRED')),
      terminal_at_ms INTEGER CHECK (
        terminal_at_ms IS NULL OR (
          typeof(terminal_at_ms) = 'integer' AND terminal_at_ms >= issued_at_ms
        )
      ),
      CHECK (
        (state = 'ACTIVE' AND terminal_at_ms IS NULL)
        OR (state != 'ACTIVE' AND terminal_at_ms IS NOT NULL)
      ),
      UNIQUE(session_id, generation),
      UNIQUE(session_id, session_revision)
    );

    CREATE INDEX idx_m7_remote_session_current
      ON m7_remote_sessions(session_id, generation DESC, state, expires_at_ms);

    CREATE TABLE m7_remote_invocation_nonces (
      nonce_revision INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
      session_revision TEXT NOT NULL REFERENCES m7_remote_sessions(session_revision),
      nonce_digest TEXT NOT NULL CHECK (
        length(nonce_digest) = 71
        AND substr(nonce_digest, 1, 7) = 'sha256:'
        AND substr(nonce_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      client_counter INTEGER NOT NULL CHECK (
        typeof(client_counter) = 'integer' AND client_counter >= 1
      ),
      accepted_at_ms INTEGER NOT NULL CHECK (
        typeof(accepted_at_ms) = 'integer' AND accepted_at_ms > 0
      ),
      UNIQUE(session_id, nonce_digest),
      UNIQUE(session_id, client_counter)
    );

    CREATE TABLE m7_remote_session_audit_events (
      audit_revision INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 64),
      device_id TEXT,
      subject_id TEXT,
      session_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED')),
      recorded_at_ms INTEGER NOT NULL CHECK (
        typeof(recorded_at_ms) = 'integer' AND recorded_at_ms > 0
      ),
      record_json BLOB NOT NULL UNIQUE CHECK (
        typeof(record_json) = 'blob' AND length(record_json) BETWEEN 1 AND 65536
      )
    );

    CREATE INDEX idx_m7_remote_session_audit_identity
      ON m7_remote_session_audit_events(
        device_id, subject_id, session_id, audit_revision
      );

    CREATE TRIGGER trg_m7_remote_pairing_claim_update
    BEFORE UPDATE ON m7_remote_pairing_claims
    WHEN OLD.claim_id IS NOT NEW.claim_id
      OR OLD.claim_digest IS NOT NEW.claim_digest
      OR OLD.subject_id IS NOT NEW.subject_id
      OR OLD.scopes_json IS NOT NEW.scopes_json
      OR OLD.issued_by IS NOT NEW.issued_by
      OR OLD.issued_at_ms IS NOT NEW.issued_at_ms
      OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
      OR (OLD.consumed_at_ms IS NOT NULL AND OLD.consumed_at_ms IS NOT NEW.consumed_at_ms)
      OR (OLD.revoked_at_ms IS NOT NULL AND OLD.revoked_at_ms IS NOT NEW.revoked_at_ms)
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_pairing_claims authority violation');
    END;

    CREATE TRIGGER trg_m7_remote_pairing_claim_no_delete
    BEFORE DELETE ON m7_remote_pairing_claims
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_pairing_claims is retention-protected');
    END;

    CREATE TRIGGER trg_m7_remote_pairing_update
    BEFORE UPDATE ON m7_remote_pairings
    WHEN OLD.pairing_revision IS NOT NEW.pairing_revision
      OR OLD.device_id IS NOT NEW.device_id
      OR OLD.subject_id IS NOT NEW.subject_id
      OR OLD.device_key_id IS NOT NEW.device_key_id
      OR OLD.device_public_key IS NOT NEW.device_public_key
      OR OLD.scopes_json IS NOT NEW.scopes_json
      OR OLD.claim_id IS NOT NEW.claim_id
      OR OLD.paired_at_ms IS NOT NEW.paired_at_ms
      OR OLD.state != 'PAIRED'
      OR NEW.state != 'REVOKED'
      OR OLD.revoked_at_ms IS NOT NULL
      OR NEW.revoked_at_ms IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_pairings authority violation');
    END;

    CREATE TRIGGER trg_m7_remote_pairing_no_delete
    BEFORE DELETE ON m7_remote_pairings
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_pairings is retention-protected');
    END;

    CREATE TRIGGER trg_m7_remote_session_challenge_update
    BEFORE UPDATE ON m7_remote_session_challenges
    WHEN OLD.challenge_id IS NOT NEW.challenge_id
      OR OLD.nonce_digest IS NOT NEW.nonce_digest
      OR OLD.purpose IS NOT NEW.purpose
      OR OLD.device_id IS NOT NEW.device_id
      OR OLD.pairing_revision IS NOT NEW.pairing_revision
      OR OLD.session_id IS NOT NEW.session_id
      OR OLD.session_revision IS NOT NEW.session_revision
      OR OLD.issued_at_ms IS NOT NEW.issued_at_ms
      OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
      OR OLD.consumed_at_ms IS NOT NULL
      OR NEW.consumed_at_ms IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_session_challenges authority violation');
    END;

    CREATE TRIGGER trg_m7_remote_session_challenge_no_delete
    BEFORE DELETE ON m7_remote_session_challenges
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_session_challenges is retention-protected');
    END;

    CREATE TRIGGER trg_m7_remote_session_update
    BEFORE UPDATE ON m7_remote_sessions
    WHEN OLD.session_revision IS NOT NEW.session_revision
      OR OLD.session_id IS NOT NEW.session_id
      OR OLD.generation IS NOT NEW.generation
      OR OLD.device_id IS NOT NEW.device_id
      OR OLD.subject_id IS NOT NEW.subject_id
      OR OLD.pairing_revision IS NOT NEW.pairing_revision
      OR OLD.device_key_id IS NOT NEW.device_key_id
      OR OLD.scopes_json IS NOT NEW.scopes_json
      OR OLD.client_build IS NOT NEW.client_build
      OR OLD.server_origin IS NOT NEW.server_origin
      OR OLD.server_identity_pin IS NOT NEW.server_identity_pin
      OR OLD.adapter_manifest_digest IS NOT NEW.adapter_manifest_digest
      OR OLD.issued_at_ms IS NOT NEW.issued_at_ms
      OR OLD.expires_at_ms IS NOT NEW.expires_at_ms
      OR NEW.last_client_counter < OLD.last_client_counter
      OR OLD.state != 'ACTIVE'
      OR NEW.state NOT IN ('ACTIVE', 'REFRESHED', 'REVOKED', 'EXPIRED')
      OR (NEW.state = 'ACTIVE' AND NEW.terminal_at_ms IS NOT NULL)
      OR (NEW.state != 'ACTIVE' AND NEW.terminal_at_ms IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_sessions authority violation');
    END;

    CREATE TRIGGER trg_m7_remote_session_no_delete
    BEFORE DELETE ON m7_remote_sessions
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_sessions is retention-protected');
    END;

    CREATE TRIGGER trg_m7_remote_invocation_nonce_no_update
    BEFORE UPDATE ON m7_remote_invocation_nonces
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_invocation_nonces is append-only');
    END;

    CREATE TRIGGER trg_m7_remote_invocation_nonce_no_delete
    BEFORE DELETE ON m7_remote_invocation_nonces
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_invocation_nonces is append-only');
    END;

    CREATE TRIGGER trg_m7_remote_session_audit_exact
    BEFORE INSERT ON m7_remote_session_audit_events
    WHEN m7_remote_session_audit_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.action') IS NOT NEW.action
      OR json_extract(NEW.record_json, '$.deviceId') IS NOT NEW.device_id
      OR json_extract(NEW.record_json, '$.subjectId') IS NOT NEW.subject_id
      OR json_extract(NEW.record_json, '$.sessionId') IS NOT NEW.session_id
      OR json_extract(NEW.record_json, '$.outcome') IS NOT NEW.outcome
      OR json_extract(NEW.record_json, '$.recordedAtMs') IS NOT NEW.recorded_at_ms
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_SESSION_AUDIT_EXACT_MISMATCH');
    END;

    CREATE TRIGGER trg_m7_remote_session_audit_no_update
    BEFORE UPDATE ON m7_remote_session_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_session_audit_events is append-only');
    END;

    CREATE TRIGGER trg_m7_remote_session_audit_no_delete
    BEFORE DELETE ON m7_remote_session_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_session_audit_events is append-only');
    END;
  `);
}

export function up(db) {
  registerM7SessionAuthorityFunctions(db);
  const current = computeM7RemoteSessionAuthorityFingerprintV105(db);
  if (current === EXPECTED_M7_REMOTE_SESSION_AUTHORITY_FINGERPRINT_V105) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_REMOTE_SESSION_AUTHORITY_105_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7RemoteSessionAuthorityFingerprintV105(db);
  if (installed !== EXPECTED_M7_REMOTE_SESSION_AUTHORITY_FINGERPRINT_V105) {
    throw new Error(`M7_REMOTE_SESSION_AUTHORITY_105_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
