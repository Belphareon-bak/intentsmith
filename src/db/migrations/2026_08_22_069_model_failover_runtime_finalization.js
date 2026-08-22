// Migration 069 — make automatic failover runtime finalization and proof
// expiry observable without rewriting the immutable incident journal.
//
// A successful ACTIVATE/REAPPLY/RESTORE event is the durable transition
// authority, but the in-process runtime CAS is finalized immediately after
// that transaction.  The append-only receipt below distinguishes a confirmed
// runtime transition from the crash-recovery window between those two steps.
//
// An active proof expiring never changes the binding.  A separate append-only
// health event records the accepted DEGRADED_PROOF_EXPIRED state once for the
// exact active event, without reopening or mutating the failover projection.

export const version = '2026_08_22_069_model_failover_runtime_finalization';
export const description = 'Add failover runtime finalize receipts and proof-expiry health events';

const ROLES = "'D1','D2','CODE','R1','R2','CHAT','VISION'";

export function up(db) {
  const failoverTables = db.prepare(`
    SELECT count(*) AS count
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('model_failover_events','model_failover_state','model_failover_proofs')
  `).get();
  if (failoverTables.count !== 3) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_failover_runtime_finalize_receipts (
      receipt_id TEXT PRIMARY KEY
        CHECK (length(trim(receipt_id)) BETWEEN 1 AND 128),
      operation_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(operation_id)) BETWEEN 1 AND 128),
      terminal_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN (${ROLES})),
      episode_id TEXT NOT NULL
        CHECK (length(trim(episode_id)) BETWEEN 1 AND 128),
      finalize_kind TEXT NOT NULL
        CHECK (finalize_kind IN ('DIRECT_CONFIRMED','RECOVERED_OBSERVED')),
      config_version INTEGER NOT NULL
        CHECK (typeof(config_version) = 'integer' AND config_version >= 0),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0)
    );

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_runtime_finalize_receipts_identity
    BEFORE INSERT ON model_failover_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      WHERE event.event_id = NEW.terminal_event_id
        AND event.operation_id = NEW.operation_id
        AND event.role = NEW.role
        AND event.episode_id = NEW.episode_id
        AND event.event_type IN ('ACTIVATED','REAPPLIED','RESTORED')
        AND event.verified = 1
        AND event.created_at_ms <= NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'runtime finalize receipt requires exact terminal event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_runtime_finalize_receipts_append_only_update
    BEFORE UPDATE ON model_failover_runtime_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_runtime_finalize_receipts is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_runtime_finalize_receipts_append_only_delete
    BEFORE DELETE ON model_failover_runtime_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_runtime_finalize_receipts is append-only');
    END;

    CREATE TABLE IF NOT EXISTS model_failover_health_events (
      health_event_id TEXT PRIMARY KEY
        CHECK (length(trim(health_event_id)) BETWEEN 1 AND 128),
      role TEXT NOT NULL CHECK (role IN (${ROLES})),
      episode_id TEXT NOT NULL
        CHECK (length(trim(episode_id)) BETWEEN 1 AND 128),
      active_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      proof_id TEXT NOT NULL
        REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      health_status TEXT NOT NULL CHECK (health_status = 'DEGRADED_PROOF_EXPIRED'),
      observed_at_ms INTEGER NOT NULL
        CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms > 0),
      UNIQUE(active_event_id, health_status)
    );

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_health_events_identity
    BEFORE INSERT ON model_failover_health_events
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_state state
      JOIN model_failover_events event
        ON event.event_id = state.active_event_id
      JOIN model_failover_proofs proof
        ON proof.proof_id = state.proof_id
      WHERE state.role = NEW.role
        AND state.episode_id = NEW.episode_id
        AND state.state = 'ACTIVATED'
        AND state.active_failover = 1
        AND state.active_event_id = NEW.active_event_id
        AND state.proof_id = NEW.proof_id
        AND event.event_type IN ('ACTIVATED','REAPPLIED')
        AND proof.expires_at_ms <= NEW.observed_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'proof-expiry health event requires exact expired active proof');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_health_events_append_only_update
    BEFORE UPDATE ON model_failover_health_events
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_health_events is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_health_events_append_only_delete
    BEFORE DELETE ON model_failover_health_events
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_health_events is append-only');
    END;
  `);
}
