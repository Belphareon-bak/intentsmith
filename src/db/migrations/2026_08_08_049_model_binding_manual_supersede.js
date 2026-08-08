// Migration 049 — schema authority for atomic manual incident supersede.
//
// A USER_APPLY/USER_ROLLBACK operation may coexist with an open incident only
// when the same transaction appends an exact SUPERSEDED_BY_USER event and
// rebinds the incident projection to the new desired revision. A
// SUPERSEDED_BY_USER projection remains observable until a later repository
// operation retires it through the exact terminal audit event. RESTORED stays
// immutable and non-retirable in this checkpoint. No runtime effect is added.

export const version = '2026_08_08_049_model_binding_manual_supersede';
export const description = 'Require exact manual supersede and audited terminal retirement';

export function up(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_model_binding_operations_no_incident;
    DROP VIEW IF EXISTS model_failover_manual_supersede_eligible;

    CREATE VIEW model_failover_manual_supersede_eligible AS
    SELECT incident.role, incident.desired_revision, incident.episode_id,
      incident.row_version, incident.policy_version, incident.updated_at_ms,
      incident.last_event_id, origin.desired_model_name,
      origin.desired_digest_sha256
    FROM model_failover_state incident
    JOIN model_failover_events origin
      ON origin.event_type = 'DETECTED'
     AND origin.role = incident.role
     AND origin.binding_revision = incident.desired_revision
     AND origin.row_version = 1
     AND origin.episode_id = incident.episode_id
     AND origin.operation_id IS NULL
     AND origin.actor = 'system:binding-integrity'
     AND origin.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
     AND origin.policy_version = incident.policy_version
     AND origin.state_before IS NULL
     AND origin.state_after = 'DETECTED'
     AND origin.fallback_model_name IS NULL
     AND origin.fallback_canonical_name IS NULL
     AND origin.fallback_digest_sha256 IS NULL
     AND origin.proof_id IS NULL
     AND origin.verified = 0
     AND origin.failure_phase IS NULL
     AND origin.details_json = '{}'
     AND origin.created_at_ms = incident.detected_at_ms
    JOIN model_failover_events current
      ON current.event_id = incident.last_event_id
     AND current.role = incident.role
     AND current.binding_revision = incident.desired_revision
     AND current.row_version = incident.row_version
     AND current.episode_id = incident.episode_id
     AND current.actor = 'system:binding-integrity'
     AND current.policy_version = incident.policy_version
     AND current.state_after = 'DETECTED'
     AND current.desired_model_name = origin.desired_model_name
     AND current.desired_digest_sha256 = origin.desired_digest_sha256
     AND current.fallback_model_name IS NULL
     AND current.fallback_canonical_name IS NULL
     AND current.fallback_digest_sha256 IS NULL
     AND current.proof_id IS NULL
     AND current.verified = 0
     AND current.failure_phase IS NULL
     AND current.details_json = '{}'
     AND current.created_at_ms = incident.updated_at_ms
    WHERE incident.state = 'DETECTED'
      AND incident.active_failover = 0
      AND incident.policy_version = 'd-plus-v1'
      AND incident.actor = 'system:binding-integrity'
      AND incident.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
      AND incident.fallback_model_name IS NULL
      AND incident.fallback_canonical_name IS NULL
      AND incident.fallback_digest_sha256 IS NULL
      AND incident.proof_id IS NULL
      AND incident.active_event_id IS NULL
      AND incident.failure_phase IS NULL
      AND incident.proof_verified_at_ms IS NULL
      AND incident.activated_at_ms IS NULL
      AND incident.resolved_at_ms IS NULL
      AND 1 = (
        SELECT COUNT(*)
        FROM model_failover_events origin_count
        WHERE origin_count.event_type = 'DETECTED'
          AND origin_count.role = incident.role
          AND origin_count.binding_revision = incident.desired_revision
          AND origin_count.row_version = 1
          AND origin_count.episode_id = incident.episode_id
      )
      AND (
        (incident.claim_operation_id IS NULL
          AND incident.claim_token IS NULL
          AND incident.claim_kind IS NULL
          AND incident.claim_started_at_ms IS NULL
          AND incident.claim_expires_at_ms IS NULL
          AND incident.row_version = 1
          AND current.event_id = origin.event_id
          AND current.event_type = 'DETECTED'
          AND current.operation_id IS NULL
          AND current.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
          AND current.state_before IS NULL
          AND incident.updated_at_ms = incident.detected_at_ms)
        OR
        (incident.claim_operation_id IS NOT NULL
          AND incident.claim_token IS NOT NULL
          AND incident.claim_kind = 'ACTIVATE'
          AND incident.claim_started_at_ms IS NOT NULL
          AND incident.claim_expires_at_ms > incident.claim_started_at_ms
          AND current.event_type = 'ACTIVATION_CLAIMED'
          AND current.operation_id = incident.claim_operation_id
          AND current.reason_code = 'FAILOVER_OPERATION_CLAIMED'
          AND current.state_before = 'DETECTED'
          AND current.created_at_ms = incident.claim_started_at_ms)
        OR
        (incident.claim_operation_id IS NULL
          AND incident.claim_token IS NULL
          AND incident.claim_kind IS NULL
          AND incident.claim_started_at_ms IS NULL
          AND incident.claim_expires_at_ms IS NULL
          AND incident.row_version > 1
          AND current.event_type = 'CLAIM_EXPIRED'
          AND current.operation_id IS NOT NULL
          AND current.reason_code = 'EXPIRED_CLAIM_RELEASED'
          AND current.state_before = 'DETECTED'
          AND EXISTS (
            SELECT 1
            FROM model_failover_events claimed
            WHERE claimed.event_type = 'ACTIVATION_CLAIMED'
              AND claimed.operation_id = current.operation_id
              AND claimed.role = incident.role
              AND claimed.binding_revision = incident.desired_revision
              AND claimed.row_version = incident.row_version - 1
              AND claimed.episode_id = incident.episode_id
              AND claimed.actor = 'system:binding-integrity'
              AND claimed.reason_code = 'FAILOVER_OPERATION_CLAIMED'
              AND claimed.policy_version = incident.policy_version
              AND claimed.state_before = 'DETECTED'
              AND claimed.state_after = 'DETECTED'
              AND claimed.desired_model_name = origin.desired_model_name
              AND claimed.desired_digest_sha256 = origin.desired_digest_sha256
              AND claimed.fallback_model_name IS NULL
              AND claimed.fallback_canonical_name IS NULL
              AND claimed.fallback_digest_sha256 IS NULL
              AND claimed.proof_id IS NULL
              AND claimed.verified = 0
              AND claimed.failure_phase IS NULL
              AND claimed.details_json = '{}'
              AND claimed.created_at_ms < current.created_at_ms
          ))
      );

    CREATE TRIGGER trg_model_binding_operations_user_actor
    BEFORE INSERT ON model_binding_operations
    WHEN substr(NEW.actor, 1, 5) <> 'user:' OR length(NEW.actor) <= 5
      OR instr(NEW.actor, ' ') > 0 OR instr(NEW.actor, char(9)) > 0
      OR instr(NEW.actor, char(10)) > 0 OR instr(NEW.actor, char(11)) > 0
      OR instr(NEW.actor, char(12)) > 0 OR instr(NEW.actor, char(13)) > 0
      OR instr(NEW.actor, char(160)) > 0 OR instr(NEW.actor, char(5760)) > 0
      OR instr(NEW.actor, char(8192)) > 0 OR instr(NEW.actor, char(8193)) > 0
      OR instr(NEW.actor, char(8194)) > 0 OR instr(NEW.actor, char(8195)) > 0
      OR instr(NEW.actor, char(8196)) > 0 OR instr(NEW.actor, char(8197)) > 0
      OR instr(NEW.actor, char(8198)) > 0 OR instr(NEW.actor, char(8199)) > 0
      OR instr(NEW.actor, char(8200)) > 0 OR instr(NEW.actor, char(8201)) > 0
      OR instr(NEW.actor, char(8202)) > 0 OR instr(NEW.actor, char(8232)) > 0
      OR instr(NEW.actor, char(8233)) > 0 OR instr(NEW.actor, char(8239)) > 0
      OR instr(NEW.actor, char(8287)) > 0 OR instr(NEW.actor, char(12288)) > 0
      OR instr(NEW.actor, char(65279)) > 0
    BEGIN
      SELECT RAISE(ABORT, 'manual binding operation requires a user actor');
    END;

    CREATE TRIGGER trg_model_binding_operations_no_incident
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1
      FROM model_failover_state incident
      WHERE incident.role = NEW.role
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_failover_manual_supersede_eligible eligible
      JOIN model_desired_bindings desired
        ON desired.role = eligible.role
       AND desired.binding_revision = eligible.desired_revision
       AND desired.model_name = eligible.desired_model_name
       AND desired.digest_sha256 = eligible.desired_digest_sha256
      JOIN model_failover_events desired_event
        ON desired_event.event_id = NEW.desired_event_id
       AND desired_event.event_type = 'DESIRED_CHANGED'
       AND desired_event.operation_id = NEW.operation_id
       AND desired_event.role = NEW.role
       AND desired_event.binding_revision = NEW.committed_binding_revision
       AND desired_event.actor = NEW.actor
       AND desired_event.reason_code = NEW.reason_code
       AND desired_event.policy_version = NEW.policy_version
       AND desired_event.desired_model_name = NEW.target_model_name
       AND desired_event.desired_digest_sha256 = NEW.target_digest_sha256
       AND desired_event.verified = 0
       AND desired_event.created_at_ms = NEW.created_at_ms
      WHERE eligible.role = NEW.role
        AND eligible.desired_revision = NEW.expected_binding_revision
        AND eligible.policy_version = NEW.policy_version
        AND NEW.created_at_ms >= eligible.updated_at_ms
        AND desired.canonical_name = NEW.previous_canonical_name
        AND desired.model_name = NEW.previous_model_name
        AND desired.digest_sha256 = NEW.previous_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual binding operation requires exact atomic incident supersede');
    END;

    CREATE TRIGGER trg_model_failover_events_manual_supersede
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type = 'SUPERSEDED_BY_USER' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_failover_manual_supersede_eligible eligible
        ON eligible.role = operation.role
       AND eligible.desired_revision = operation.expected_binding_revision
       AND eligible.desired_model_name = operation.previous_model_name
       AND eligible.desired_digest_sha256 = operation.previous_digest_sha256
       AND eligible.policy_version = operation.policy_version
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
       AND desired.observed_at_ms = operation.created_at_ms
       AND desired.updated_at_ms = operation.created_at_ms
      WHERE operation.operation_id = NEW.operation_id
        AND operation.role = NEW.role
        AND operation.committed_binding_revision = NEW.binding_revision
        AND NEW.row_version = eligible.row_version + 1
        AND NEW.episode_id = eligible.episode_id
        AND NEW.actor = operation.actor
        AND NEW.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
        AND NEW.policy_version = operation.policy_version
        AND NEW.state_before = 'DETECTED'
        AND NEW.state_after = 'SUPERSEDED_BY_USER'
        AND NEW.desired_model_name = operation.target_model_name
        AND NEW.desired_digest_sha256 = operation.target_digest_sha256
        AND NEW.fallback_model_name IS NULL
        AND NEW.fallback_canonical_name IS NULL
        AND NEW.fallback_digest_sha256 IS NULL
        AND NEW.proof_id IS NULL
        AND NEW.verified = 0
        AND NEW.failure_phase IS NULL
        AND NEW.details_json = '{}'
        AND NEW.created_at_ms = operation.created_at_ms
        AND operation.created_at_ms >= eligible.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual supersede event requires exact operation, desired projection and incident');
    END;

    CREATE TRIGGER trg_model_failover_state_manual_supersede
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.state = 'SUPERSEDED_BY_USER' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_failover_manual_supersede_eligible eligible
        ON eligible.role = OLD.role
       AND eligible.desired_revision = OLD.desired_revision
       AND eligible.episode_id = OLD.episode_id
       AND eligible.row_version = OLD.row_version
       AND eligible.policy_version = OLD.policy_version
       AND eligible.updated_at_ms = OLD.updated_at_ms
       AND eligible.last_event_id = OLD.last_event_id
       AND eligible.desired_model_name = operation.previous_model_name
       AND eligible.desired_digest_sha256 = operation.previous_digest_sha256
      JOIN model_failover_events event
        ON event.event_type = 'SUPERSEDED_BY_USER'
       AND event.operation_id = operation.operation_id
       AND event.role = operation.role
       AND event.binding_revision = operation.committed_binding_revision
       AND event.row_version = NEW.row_version
       AND event.episode_id = NEW.episode_id
       AND event.actor = operation.actor
       AND event.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
       AND event.policy_version = operation.policy_version
       AND event.state_before = OLD.state
       AND event.state_after = 'SUPERSEDED_BY_USER'
       AND event.desired_model_name = operation.target_model_name
       AND event.desired_digest_sha256 = operation.target_digest_sha256
       AND event.fallback_model_name IS OLD.fallback_model_name
       AND event.fallback_canonical_name IS OLD.fallback_canonical_name
       AND event.fallback_digest_sha256 IS OLD.fallback_digest_sha256
       AND event.proof_id IS OLD.proof_id
       AND event.verified = 0
       AND event.failure_phase IS NULL
       AND event.details_json = '{}'
       AND event.created_at_ms = operation.created_at_ms
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
       AND desired.observed_at_ms = operation.created_at_ms
       AND desired.updated_at_ms = operation.created_at_ms
      WHERE operation.role = OLD.role
        AND operation.expected_binding_revision = OLD.desired_revision
        AND operation.committed_binding_revision = NEW.desired_revision
        AND operation.policy_version = OLD.policy_version
        AND operation.created_at_ms >= OLD.updated_at_ms
        AND NEW.desired_revision = OLD.desired_revision + 1
        AND OLD.state = 'DETECTED'
        AND OLD.active_failover = 0
        AND OLD.actor = 'system:binding-integrity'
        AND OLD.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
        AND OLD.fallback_model_name IS NULL
        AND OLD.fallback_canonical_name IS NULL
        AND OLD.fallback_digest_sha256 IS NULL
        AND OLD.proof_id IS NULL
        AND OLD.active_event_id IS NULL
        AND OLD.failure_phase IS NULL
        AND OLD.proof_verified_at_ms IS NULL
        AND OLD.activated_at_ms IS NULL
        AND OLD.resolved_at_ms IS NULL
        AND (
          (OLD.claim_operation_id IS NULL
            AND OLD.claim_token IS NULL
            AND OLD.claim_kind IS NULL
            AND OLD.claim_started_at_ms IS NULL
            AND OLD.claim_expires_at_ms IS NULL)
          OR
          (OLD.claim_operation_id IS NOT NULL
            AND OLD.claim_token IS NOT NULL
            AND OLD.claim_kind = 'ACTIVATE'
            AND OLD.claim_started_at_ms IS NOT NULL
            AND OLD.claim_expires_at_ms IS NOT NULL)
        )
        AND NEW.role = OLD.role
        AND NEW.episode_id = OLD.episode_id
        AND NEW.row_version = OLD.row_version + 1
        AND NEW.active_failover = 0
        AND NEW.fallback_model_name IS NULL
        AND NEW.fallback_canonical_name IS NULL
        AND NEW.fallback_digest_sha256 IS NULL
        AND NEW.proof_id IS NULL
        AND NEW.active_event_id IS NULL
        AND NEW.policy_version = OLD.policy_version
        AND NEW.actor = operation.actor
        AND NEW.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
        AND NEW.failure_phase IS NULL
        AND NEW.proof_verified_at_ms IS NULL
        AND NEW.claim_operation_id IS NULL
        AND NEW.claim_token IS NULL
        AND NEW.claim_kind IS NULL
        AND NEW.claim_started_at_ms IS NULL
        AND NEW.claim_expires_at_ms IS NULL
        AND NEW.detected_at_ms = OLD.detected_at_ms
        AND NEW.activated_at_ms IS OLD.activated_at_ms
        AND NEW.resolved_at_ms = operation.created_at_ms
        AND NEW.updated_at_ms = operation.created_at_ms
        AND NEW.last_event_id = event.event_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_BINDING_SUPERSEDE_STATE_LINEAGE_MISMATCH: manual incident supersede requires exact operation and audit lineage');
    END;

    CREATE TRIGGER trg_model_failover_state_manual_supersede_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.state = 'SUPERSEDED_BY_USER'
    BEGIN
      SELECT RAISE(ABORT, 'superseded incident must transition from an existing detected row');
    END;

    CREATE TRIGGER trg_model_failover_state_terminal_immutable
    BEFORE UPDATE ON model_failover_state
    WHEN OLD.state IN ('RESTORED','SUPERSEDED_BY_USER')
    BEGIN
      SELECT RAISE(ABORT, 'terminal failover state is immutable');
    END;

    CREATE TRIGGER trg_model_failover_state_delete_authority
    BEFORE DELETE ON model_failover_state
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = OLD.role
       AND desired.binding_revision = OLD.desired_revision
       AND desired.model_name = event.desired_model_name
       AND desired.digest_sha256 = event.desired_digest_sha256
      WHERE event.event_id = OLD.last_event_id
        AND event.role = OLD.role
        AND event.binding_revision = OLD.desired_revision
        AND event.row_version = OLD.row_version
        AND event.episode_id = OLD.episode_id
        AND event.state_after = OLD.state
        AND event.policy_version = OLD.policy_version
        AND event.actor = OLD.actor
        AND event.reason_code = OLD.reason_code
        AND event.created_at_ms = OLD.updated_at_ms
        AND event.failure_phase IS NULL
        AND OLD.state = 'SUPERSEDED_BY_USER'
        AND OLD.active_failover = 0
        AND OLD.claim_operation_id IS NULL
        AND OLD.claim_token IS NULL
        AND OLD.claim_kind IS NULL
        AND OLD.claim_started_at_ms IS NULL
        AND OLD.claim_expires_at_ms IS NULL
        AND OLD.resolved_at_ms IS NOT NULL
        AND event.event_type = 'SUPERSEDED_BY_USER'
        AND event.state_before = 'DETECTED'
        AND event.verified = 0
        AND event.proof_id IS NULL
        AND event.fallback_model_name IS NULL
        AND event.fallback_canonical_name IS NULL
        AND event.fallback_digest_sha256 IS NULL
        AND event.details_json = '{}'
        AND EXISTS (
          SELECT 1
          FROM model_binding_operations operation
          WHERE operation.operation_id = event.operation_id
            AND operation.role = OLD.role
            AND operation.committed_binding_revision = OLD.desired_revision
            AND operation.target_model_name = desired.model_name
            AND operation.target_canonical_name = desired.canonical_name
            AND operation.target_digest_sha256 = desired.digest_sha256
            AND operation.actor = event.actor
            AND operation.policy_version = event.policy_version
            AND operation.created_at_ms = event.created_at_ms
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover state cannot be deleted outside audited terminal retirement');
    END;
  `);
}
