// Migration 051 — close manual binding runtime-generation ambiguity.
//
// Application outcomes need to distinguish a real runtime mutation from an
// already-reconciled no-op. The distinction keeps rollback history truthful
// and lets the runtime coordinator compensate without inventing an effect.

export const version = '2026_08_09_051_model_binding_runtime_generation';
export const description = 'Pin manual binding runtime generations and changed effects';

export function up(db) {
  const columns = db.prepare(
    "PRAGMA table_info('model_binding_application_attempts')",
  ).all().map(column => column.name).sort();
  const expectedColumns = [
    'attempt_kind',
    'attempt_revision',
    'created_at_ms',
    'failure_code',
    'observed_canonical_name',
    'observed_digest_sha256',
    'observed_model_name',
    'operation_id',
    'outcome',
    'retryable',
    'seq',
    'verification_method',
  ];
  if (JSON.stringify(columns) !== JSON.stringify(expectedColumns)) {
    throw new Error('model_binding_application_attempts is not the expected pre-051 shape');
  }

  const appendTrigger = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name = 'trg_model_binding_application_append_only_update'
  `).get();
  if (!appendTrigger?.sql) {
    throw new Error('application attempt append-only update guard is missing before 051');
  }

  db.exec(`
    DROP TRIGGER trg_model_binding_application_append_only_update;

    ALTER TABLE model_binding_application_attempts
      ADD COLUMN runtime_changed INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(runtime_changed) = 'integer' AND runtime_changed IN (0, 1));

    UPDATE model_binding_application_attempts
    SET runtime_changed = 1
    WHERE attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
      AND outcome = 'SUCCEEDED';

    CREATE TRIGGER trg_model_binding_application_append_only_update
    BEFORE UPDATE ON model_binding_application_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_application_attempts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_application_runtime_changed_shape
    BEFORE INSERT ON model_binding_application_attempts
    WHEN (
      NEW.runtime_changed = 1
      AND NOT (
        NEW.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        AND NEW.outcome = 'SUCCEEDED'
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_CHANGED_INVALID: only successful runtime outcomes may claim a mutation');
    END;

    CREATE TRIGGER trg_model_binding_application_runtime_apply_after_rehydrate
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind = 'RUNTIME_APPLY' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts rehydrated
      WHERE rehydrated.operation_id = NEW.operation_id
        AND rehydrated.attempt_kind = 'STARTUP_REHYDRATE'
        AND rehydrated.outcome = 'SUCCEEDED'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_GENERATION_CLOSED: runtime apply cannot follow startup rehydrate');
    END;

    CREATE TRIGGER trg_model_binding_application_nonretryable_runtime_terminal
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
      AND EXISTS (
        SELECT 1
        FROM model_binding_application_attempts failed
        WHERE failed.operation_id = NEW.operation_id
          AND failed.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
          AND failed.outcome = 'FAILED'
          AND failed.retryable = 0
          AND failed.attempt_revision > COALESCE((
            SELECT MAX(applied.attempt_revision)
            FROM model_binding_application_attempts applied
            WHERE applied.operation_id = NEW.operation_id
              AND applied.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
              AND applied.outcome = 'SUCCEEDED'
          ), 0)
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL: no later runtime attempt is allowed without a new user operation');
    END;
  `);
}
