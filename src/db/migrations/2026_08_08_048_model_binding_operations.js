// Migration 048 — append-only manual model-binding lineage.
//
// This is storage authority only. It deliberately cannot mark a model verified
// or runtime-applied and does not write legacy model_overrides/upgrade_history.
// A later repository checkpoint will commit the audit event, operation journal
// and desired-binding projection in one IMMEDIATE transaction.

export const version = '2026_08_08_048_model_binding_operations';
export const description = 'Add append-only USER_APPLY and USER_ROLLBACK binding lineage';

const ROLES = `'D1','D2','CODE','R1','R2','CHAT','VISION'`;

export function up(db) {
  const operationTableExists = db.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'model_binding_operations'
  `).get();
  if (operationTableExists) {
    throw new Error('model_binding_operations pre-exists its migration authority');
  }
  const unjournaledManualProjection = db.prepare(`
    SELECT role, source
    FROM model_desired_bindings
    WHERE source IN ('USER_APPLY','USER_ROLLBACK')
    LIMIT 1
  `).get();
  if (unjournaledManualProjection) {
    throw new Error(
      `manual desired binding ${unjournaledManualProjection.role}/${unjournaledManualProjection.source} lacks operation lineage`,
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_binding_operations (
      operation_id TEXT PRIMARY KEY
        CHECK (length(trim(operation_id)) BETWEEN 16 AND 128),
      request_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(request_key)) BETWEEN 16 AND 128),
      role TEXT NOT NULL CHECK (role IN (${ROLES})),
      operation_kind TEXT NOT NULL
        CHECK (operation_kind IN ('USER_APPLY','USER_ROLLBACK')),
      expected_binding_revision INTEGER NOT NULL
        CHECK (
          typeof(expected_binding_revision) = 'integer'
          AND expected_binding_revision >= 1
        ),
      committed_binding_revision INTEGER NOT NULL
        CHECK (
          typeof(committed_binding_revision) = 'integer'
          AND committed_binding_revision = expected_binding_revision + 1
        ),
      previous_model_name TEXT NOT NULL
        CHECK (length(trim(previous_model_name)) BETWEEN 1 AND 512),
      previous_canonical_name TEXT NOT NULL
        CHECK (length(trim(previous_canonical_name)) BETWEEN 1 AND 512),
      previous_digest_sha256 TEXT NOT NULL
        CHECK (
          length(previous_digest_sha256) = 64
          AND previous_digest_sha256 = lower(previous_digest_sha256)
          AND previous_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      target_model_name TEXT NOT NULL
        CHECK (length(trim(target_model_name)) BETWEEN 1 AND 512),
      target_canonical_name TEXT NOT NULL
        CHECK (length(trim(target_canonical_name)) BETWEEN 1 AND 512),
      target_digest_sha256 TEXT NOT NULL
        CHECK (
          length(target_digest_sha256) = 64
          AND target_digest_sha256 = lower(target_digest_sha256)
          AND target_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      predecessor_operation_id TEXT
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      rollback_of_operation_id TEXT
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED'
        CHECK (verification_status = 'NOT_VERIFIED'),
      runtime_status TEXT NOT NULL DEFAULT 'NOT_APPLIED'
        CHECK (runtime_status = 'NOT_APPLIED'),
      desired_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(role, committed_binding_revision),
      CHECK (predecessor_operation_id IS NULL OR predecessor_operation_id <> operation_id),
      CHECK (rollback_of_operation_id IS NULL OR rollback_of_operation_id <> operation_id),
      CHECK (
        previous_model_name <> target_model_name
        OR previous_canonical_name <> target_canonical_name
        OR previous_digest_sha256 <> target_digest_sha256
      ),
      CHECK (
        (operation_kind = 'USER_APPLY' AND rollback_of_operation_id IS NULL)
        OR
        (operation_kind = 'USER_ROLLBACK'
          AND rollback_of_operation_id IS NOT NULL
          AND predecessor_operation_id = rollback_of_operation_id)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_model_binding_operations_role_revision
      ON model_binding_operations(role, committed_binding_revision DESC);
    CREATE INDEX IF NOT EXISTS idx_model_binding_operations_predecessor
      ON model_binding_operations(predecessor_operation_id)
      WHERE predecessor_operation_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_binding_operations_one_rollback
      ON model_binding_operations(rollback_of_operation_id)
      WHERE rollback_of_operation_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_current_projection
    BEFORE INSERT ON model_binding_operations
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_desired_bindings desired
      WHERE desired.role = NEW.role
        AND desired.binding_revision = NEW.expected_binding_revision
        AND desired.model_name = NEW.previous_model_name
        AND desired.canonical_name = NEW.previous_canonical_name
        AND desired.digest_sha256 = NEW.previous_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'binding operation requires matching current desired projection');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_audit_event
    BEFORE INSERT ON model_binding_operations
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      WHERE event.event_id = NEW.desired_event_id
        AND event.event_type = 'DESIRED_CHANGED'
        AND event.operation_id = NEW.operation_id
        AND event.role = NEW.role
        AND event.binding_revision = NEW.committed_binding_revision
        AND event.actor = NEW.actor
        AND event.reason_code = NEW.reason_code
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = NEW.target_model_name
        AND event.desired_digest_sha256 = NEW.target_digest_sha256
        AND event.row_version IS NULL
        AND event.episode_id IS NULL
        AND event.state_before IS NULL
        AND event.state_after IS NULL
        AND event.fallback_model_name IS NULL
        AND event.fallback_canonical_name IS NULL
        AND event.fallback_digest_sha256 IS NULL
        AND event.proof_id IS NULL
        AND event.verified = 0
        AND event.failure_phase IS NULL
        AND event.details_json = '{}'
        AND event.created_at_ms = NEW.created_at_ms
        AND (
          (NEW.operation_kind = 'USER_APPLY'
            AND NEW.reason_code = 'USER_MODEL_BINDING_APPLIED')
          OR
          (NEW.operation_kind = 'USER_ROLLBACK'
            AND NEW.reason_code = 'USER_MODEL_BINDING_ROLLED_BACK')
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'binding operation requires matching unverified audit event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_no_incident
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1
      FROM model_failover_state incident
      WHERE incident.role = NEW.role
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual binding operation requires atomic incident supersede seam');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_predecessor
    BEFORE INSERT ON model_binding_operations
    WHEN NEW.predecessor_operation_id IS NOT NULL
      AND NEW.operation_kind = 'USER_APPLY'
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_operations predecessor
        WHERE predecessor.operation_id = NEW.predecessor_operation_id
          AND predecessor.role = NEW.role
          AND predecessor.committed_binding_revision = NEW.expected_binding_revision
          AND predecessor.target_model_name = NEW.previous_model_name
          AND predecessor.target_canonical_name = NEW.previous_canonical_name
          AND predecessor.target_digest_sha256 = NEW.previous_digest_sha256
      )
    BEGIN
      SELECT RAISE(ABORT, 'binding apply predecessor does not match current revision');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_manual_predecessor
    BEFORE INSERT ON model_binding_operations
    WHEN NEW.operation_kind = 'USER_APPLY'
      AND EXISTS (
        SELECT 1
        FROM model_desired_bindings desired
        WHERE desired.role = NEW.role
          AND desired.binding_revision = NEW.expected_binding_revision
          AND desired.source IN ('USER_APPLY','USER_ROLLBACK')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_operations predecessor
        WHERE predecessor.operation_id = NEW.predecessor_operation_id
          AND predecessor.role = NEW.role
          AND predecessor.committed_binding_revision = NEW.expected_binding_revision
          AND predecessor.target_model_name = NEW.previous_model_name
          AND predecessor.target_canonical_name = NEW.previous_canonical_name
          AND predecessor.target_digest_sha256 = NEW.previous_digest_sha256
      )
    BEGIN
      SELECT RAISE(ABORT, 'binding apply after a manual revision requires its exact predecessor');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_rollback_lineage
    BEFORE INSERT ON model_binding_operations
    WHEN NEW.operation_kind = 'USER_ROLLBACK' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations applied
      WHERE applied.operation_id = NEW.rollback_of_operation_id
        AND applied.operation_id = NEW.predecessor_operation_id
        AND applied.operation_kind = 'USER_APPLY'
        AND applied.role = NEW.role
        AND applied.committed_binding_revision = NEW.expected_binding_revision
        AND applied.target_model_name = NEW.previous_model_name
        AND applied.target_canonical_name = NEW.previous_canonical_name
        AND applied.target_digest_sha256 = NEW.previous_digest_sha256
        AND applied.previous_model_name = NEW.target_model_name
        AND applied.previous_canonical_name = NEW.target_canonical_name
        AND applied.previous_digest_sha256 = NEW.target_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'binding rollback must append an exact reversal of its direct apply');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_manual_operation_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN NEW.source IN ('USER_APPLY','USER_ROLLBACK') AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.role = NEW.role
        AND operation.operation_kind = NEW.source
        AND operation.committed_binding_revision = NEW.binding_revision
        AND operation.target_model_name = NEW.model_name
        AND operation.target_canonical_name = NEW.canonical_name
        AND operation.target_digest_sha256 = NEW.digest_sha256
        AND operation.actor = NEW.actor
        AND operation.desired_event_id = NEW.last_event_id
        AND operation.created_at_ms = NEW.observed_at_ms
        AND operation.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection requires matching binding operation');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_manual_operation_update
    BEFORE UPDATE ON model_desired_bindings
    WHEN NEW.source IN ('USER_APPLY','USER_ROLLBACK') AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE OLD.role = NEW.role
        AND operation.role = NEW.role
        AND operation.operation_kind = NEW.source
        AND operation.expected_binding_revision = OLD.binding_revision
        AND operation.committed_binding_revision = NEW.binding_revision
        AND NEW.binding_revision = OLD.binding_revision + 1
        AND operation.previous_model_name = OLD.model_name
        AND operation.previous_canonical_name = OLD.canonical_name
        AND operation.previous_digest_sha256 = OLD.digest_sha256
        AND operation.target_model_name = NEW.model_name
        AND operation.target_canonical_name = NEW.canonical_name
        AND operation.target_digest_sha256 = NEW.digest_sha256
        AND operation.actor = NEW.actor
        AND operation.desired_event_id = NEW.last_event_id
        AND operation.created_at_ms = NEW.observed_at_ms
        AND operation.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection requires matching binding operation');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_manual_authority_update
    BEFORE UPDATE ON model_desired_bindings
    WHEN OLD.source IN ('USER_APPLY','USER_ROLLBACK')
      AND NEW.source NOT IN ('USER_APPLY','USER_ROLLBACK')
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection cannot leave operation authority');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_manual_authority_delete
    BEFORE DELETE ON model_desired_bindings
    WHEN OLD.source IN ('USER_APPLY','USER_ROLLBACK')
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection cannot be deleted without reconciliation');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_manual_authority_replace
    BEFORE INSERT ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_desired_bindings current
      WHERE current.role = NEW.role
        AND current.source IN ('USER_APPLY','USER_ROLLBACK')
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual desired projection cannot be replaced without reconciliation');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_append_only_update
    BEFORE UPDATE ON model_binding_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_operations is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_binding_operations_append_only_delete
    BEFORE DELETE ON model_binding_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_operations is append-only');
    END;
  `);
}
