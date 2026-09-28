// Migration 067 — decision 015: bind a PASS proof to its immutable artifacts
// and make the expiry edge strict.
//
// Two separate corrections, both named by the accepted decision block:
//
// 015-storage: content-addressed
//   The proof table alone was never sufficient authority. It carried neither
//   the measurement artifact hash, the parent acceptance hash, nor the source
//   revision the run came from, so a synthetic row looked exactly like a real
//   one. A proof without its artifacts is now impossible; an orphan artifact
//   stays acceptable, because the artifact is written first.
//
// 015-expiry-edge: NEW-ADDITIVE-MIGRATION-STRICT-LESS-THAN
//   Migration 046 compares `proof.expires_at_ms >= <event time>` in four
//   places, while the accepted meaning is `now < expiresAt`. The difference is
//   one millisecond — the millisecond in which an expired proof could still
//   authorise an activation. The four triggers are recreated here with the
//   strict comparison and are otherwise byte-identical to 046.
//
// This migration does NOT enable issuance. Thresholds, TTL and terminal
// activation remain where decision 015 left them.

export const version = '2026_08_22_067_model_failover_proof_artifacts';
export const description = 'Bind failover proofs to content-addressed artifacts and strict expiry';

const ARTIFACT_KINDS = "'MEASUREMENT','PARENT_ACCEPTANCE'";

export function up(db) {
  const columns = db.prepare('PRAGMA table_info(model_failover_proofs)').all();
  if (columns.length === 0) return;
  const existing = new Set(columns.map(column => column.name));

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_failover_proof_artifacts (
      artifact_sha256 TEXT PRIMARY KEY
        CHECK (
          length(artifact_sha256) = 64
          AND artifact_sha256 = lower(artifact_sha256)
          AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      kind TEXT NOT NULL CHECK (kind IN (${ARTIFACT_KINDS})),
      byte_length INTEGER NOT NULL
        CHECK (typeof(byte_length) = 'integer' AND byte_length > 0),
      source_revision TEXT NOT NULL
        CHECK (length(trim(source_revision)) BETWEEN 7 AND 64),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0)
    );

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_proof_artifacts_append_only_update
    BEFORE UPDATE ON model_failover_proof_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proof_artifacts is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_proof_artifacts_append_only_delete
    BEFORE DELETE ON model_failover_proof_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proof_artifacts is append-only');
    END;
  `);

  // Additive columns. Existing rows are historical diagnostics and keep NULL —
  // the trigger below rejects new proofs that leave them empty, so no old row
  // is retroactively promoted into a qualified proof.
  if (!existing.has('measurement_artifact_sha256')) {
    db.exec('ALTER TABLE model_failover_proofs ADD COLUMN measurement_artifact_sha256 TEXT');
  }
  if (!existing.has('acceptance_artifact_sha256')) {
    db.exec('ALTER TABLE model_failover_proofs ADD COLUMN acceptance_artifact_sha256 TEXT');
  }
  if (!existing.has('source_revision')) {
    db.exec('ALTER TABLE model_failover_proofs ADD COLUMN source_revision TEXT');
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_model_failover_proofs_require_artifacts
    BEFORE INSERT ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'proof requires a durable measurement artifact')
      WHERE NEW.measurement_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.kind = 'MEASUREMENT'
        );
      SELECT RAISE(ABORT, 'proof requires a durable parent acceptance artifact')
      WHERE NEW.acceptance_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.kind = 'PARENT_ACCEPTANCE'
        );
      SELECT RAISE(ABORT, 'proof requires the source revision of both artifacts')
      WHERE NEW.source_revision IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        )
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        );
    END;
  `);

  // ── Strict expiry edge ───────────────────────────────────────────────────
  db.exec(`
    DROP TRIGGER IF EXISTS trg_model_failover_events_fallback_proof;
    DROP TRIGGER IF EXISTS trg_model_failover_events_restore_proof;
    DROP TRIGGER IF EXISTS trg_model_failover_state_active_proof_insert;
    DROP TRIGGER IF EXISTS trg_model_failover_state_active_proof_update;

    CREATE TRIGGER trg_model_failover_events_fallback_proof
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type IN ('ACTIVATED','REAPPLIED') AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.binding_revision
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'verified fallback event requires matching fresh proof');
    END;

    CREATE TRIGGER trg_model_failover_events_restore_proof
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type = 'RESTORED' AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.binding_revision
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = desired.canonical_name
        AND proof.model_digest_sha256 = desired.digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'verified restore event requires matching fresh desired proof');
    END;

    CREATE TRIGGER trg_model_failover_state_active_proof_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms > NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;

    CREATE TRIGGER trg_model_failover_state_active_proof_update
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms > NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;
  `);
}

export default { version, description, up };
