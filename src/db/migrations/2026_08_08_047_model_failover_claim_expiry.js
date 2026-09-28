// IntentSmith M1 — fail-closed audit authority for expired failover claims.

export const version = '2026_08_08_047_model_failover_claim_expiry';
export const description = 'Require every CLAIM_EXPIRED event to match a live expired claim';

export function up(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_model_failover_events_claim_expired
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type = 'CLAIM_EXPIRED' AND NOT EXISTS (
      SELECT 1
      FROM model_failover_state state
      JOIN model_desired_bindings desired
        ON desired.role = state.role
       AND desired.binding_revision = state.desired_revision
      WHERE state.role = NEW.role
        AND state.desired_revision = NEW.binding_revision
        AND state.episode_id = NEW.episode_id
        AND state.row_version + 1 = NEW.row_version
        AND state.claim_operation_id = NEW.operation_id
        AND state.claim_token IS NOT NULL
        AND state.claim_expires_at_ms < NEW.created_at_ms
        AND state.policy_version = NEW.policy_version
        AND NEW.actor = 'system:binding-integrity'
        AND NEW.reason_code = 'EXPIRED_CLAIM_RELEASED'
        AND NEW.state_before = state.state
        AND NEW.state_after = state.state
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND NEW.fallback_model_name IS NULL
        AND NEW.fallback_canonical_name IS NULL
        AND NEW.fallback_digest_sha256 IS NULL
        AND NEW.proof_id IS NULL
        AND NEW.verified = 0
        AND NEW.failure_phase IS NULL
        AND NEW.details_json = '{}'
    )
    BEGIN
      SELECT RAISE(ABORT, 'expired claim event requires matching expired claim');
    END;
  `);
}
