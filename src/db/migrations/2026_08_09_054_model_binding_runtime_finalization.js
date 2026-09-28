// Migration 054 — distinguish a durable runtime attempt from a confirmed
// in-process runtime finalize.
//
// A successful application attempt is committed before UpgradeManager clears
// its runtime token and advances the in-memory config generation.  This
// append-only receipt journal records the return of that synchronous finalize.
// Missing receipts are intentionally not backfilled: startup reconciliation
// must establish a new exact runtime generation and link older unknown
// generations to it.

import { createHash } from 'node:crypto';

export const version = '2026_08_09_054_model_binding_runtime_finalization';
export const description = 'Add append-only model binding runtime finalize receipts';

const EXPECTED_APPLICATION_COLUMNS = Object.freeze([
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
  'runtime_changed',
  'seq',
  'verification_method',
]);

const EXPECTED_APPLICATION_TRIGGERS = Object.freeze([
  'trg_model_binding_application_append_only_delete',
  'trg_model_binding_application_append_only_insert_conflict',
  'trg_model_binding_application_append_only_update',
  'trg_model_binding_application_current_desired',
  'trg_model_binding_application_nonretryable_runtime_terminal',
  'trg_model_binding_application_notification_once',
  'trg_model_binding_application_revision',
  'trg_model_binding_application_runtime_apply_after_rehydrate',
  'trg_model_binding_application_runtime_apply_once',
  'trg_model_binding_application_runtime_changed_shape',
  'trg_model_binding_application_runtime_prerequisite',
  'trg_model_binding_application_sequence_authority',
  'trg_model_binding_application_sequence_positive',
  'trg_model_binding_application_success_identity',
  'trg_model_binding_application_time_order',
  'trg_model_binding_application_verification_terminal',
]);

const EXPECTED_APPLICATION_TRIGGER_DIGEST =
  '886816c5064b5d5ea896c47a21dd879f113e75b228ff744204699ec5334dadcd';

export function up(db) {
  const preexistingTables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'model_binding_runtime_finalize_cutoffs',
        'model_binding_runtime_finalize_receipts'
      )
    ORDER BY name
  `).all().map(row => row.name);
  if (preexistingTables.length > 0) {
    throw new Error(
      `runtime finalize table(s) pre-exist migration authority: ${preexistingTables.join(',')}`,
    );
  }

  const applicationColumns = db.prepare(
    "PRAGMA table_info('model_binding_application_attempts')",
  ).all().map(column => column.name).sort();
  if (JSON.stringify(applicationColumns) !== JSON.stringify(EXPECTED_APPLICATION_COLUMNS)) {
    throw new Error('model_binding_application_attempts is not the expected pre-054 shape');
  }

  const applicationTriggers = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name = 'model_binding_application_attempts'
    ORDER BY name
  `).all();
  const applicationTriggerNames = applicationTriggers.map(row => row.name);
  if (JSON.stringify(applicationTriggerNames)
    !== JSON.stringify(EXPECTED_APPLICATION_TRIGGERS)) {
    throw new Error(
      'model binding application trigger set drifted before 054: '
      + `expected ${EXPECTED_APPLICATION_TRIGGERS.join(',')}; `
      + `got ${applicationTriggerNames.join(',')}`,
    );
  }
  const applicationTriggerDigest = createHash('sha256')
    .update(applicationTriggers.map(row => `${row.name}\0${row.sql}`).join('\0'))
    .digest('hex');
  if (applicationTriggerDigest !== EXPECTED_APPLICATION_TRIGGER_DIGEST) {
    throw new Error(
      'model binding application trigger SQL drifted before 054: '
      + `expected ${EXPECTED_APPLICATION_TRIGGER_DIGEST}; got ${applicationTriggerDigest}`,
    );
  }

  // Before 054 the repository wrote upgrade_history in the same transaction
  // as every changed RUNTIME_APPLY success.  The legacy table has no operation
  // id, so the exact tuple written by that repository is the strongest
  // available ownership proof.  Refuse missing or ambiguous evidence before
  // creating any 054 object instead of silently manufacturing audit lineage.
  const inconsistentLegacyHistory = db.prepare(`
    SELECT attempt.operation_id,
           attempt.attempt_revision,
           (
             SELECT COUNT(*)
             FROM upgrade_history history
             WHERE history.role = operation.role
               AND history.from_model = operation.previous_model_name
               AND history.to_model = operation.target_model_name
               AND history.score IS NULL
               AND history.action = CASE
                 WHEN operation.operation_kind = 'USER_ROLLBACK'
                   THEN 'rollback'
                 ELSE 'apply'
               END
               AND history.created_at = datetime(
                 attempt.created_at_ms / 1000,
                 'unixepoch'
               )
           ) AS matching_history_count
    FROM model_binding_application_attempts attempt
    JOIN model_binding_operations operation
      ON operation.operation_id = attempt.operation_id
    WHERE attempt.attempt_kind = 'RUNTIME_APPLY'
      AND attempt.outcome = 'SUCCEEDED'
      AND attempt.runtime_changed = 1
      AND (
        SELECT COUNT(*)
        FROM upgrade_history history
        WHERE history.role = operation.role
          AND history.from_model = operation.previous_model_name
          AND history.to_model = operation.target_model_name
          AND history.score IS NULL
          AND history.action = CASE
            WHEN operation.operation_kind = 'USER_ROLLBACK'
              THEN 'rollback'
            ELSE 'apply'
          END
          AND history.created_at = datetime(
            attempt.created_at_ms / 1000,
            'unixepoch'
          )
      ) <> 1
    ORDER BY attempt.operation_id, attempt.attempt_revision
  `).all();
  if (inconsistentLegacyHistory.length > 0) {
    throw new Error(
      'pre-054 changed runtime success lacks unique durable upgrade history: '
      + inconsistentLegacyHistory.map(row => (
        `${row.operation_id}@${row.attempt_revision}`
        + `(${row.matching_history_count})`
      )).join(','),
    );
  }

  db.exec(`
    CREATE TABLE model_binding_runtime_finalize_cutoffs (
      operation_id TEXT PRIMARY KEY,
      max_preexisting_runtime_attempt_revision INTEGER NOT NULL
        CHECK (
          typeof(max_preexisting_runtime_attempt_revision) = 'integer'
          AND max_preexisting_runtime_attempt_revision >= 0
        ),
      FOREIGN KEY (operation_id)
        REFERENCES model_binding_operations(operation_id)
        ON DELETE RESTRICT
    );

    INSERT INTO model_binding_runtime_finalize_cutoffs (
      operation_id, max_preexisting_runtime_attempt_revision
    )
    SELECT operation.operation_id,
           COALESCE(MAX(CASE
             WHEN attempt.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
               THEN attempt.attempt_revision
             ELSE NULL
           END), 0)
    FROM model_binding_operations operation
    LEFT JOIN model_binding_application_attempts attempt
      ON attempt.operation_id = operation.operation_id
    GROUP BY operation.operation_id;

    CREATE TABLE model_binding_runtime_finalize_receipts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      runtime_attempt_revision INTEGER NOT NULL
        CHECK (
          typeof(runtime_attempt_revision) = 'integer'
          AND runtime_attempt_revision >= 1
        ),
      finalization_kind TEXT NOT NULL
        CHECK (finalization_kind IN ('DIRECT_CONFIRMED','RECOVERED_BY')),
      config_version INTEGER
        CHECK (
          config_version IS NULL
          OR (typeof(config_version) = 'integer' AND config_version >= 0)
        ),
      recovered_by_attempt_revision INTEGER
        CHECK (
          recovered_by_attempt_revision IS NULL
          OR (
            typeof(recovered_by_attempt_revision) = 'integer'
            AND recovered_by_attempt_revision >= 1
          )
        ),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(operation_id, runtime_attempt_revision),
      FOREIGN KEY (operation_id, runtime_attempt_revision)
        REFERENCES model_binding_application_attempts(operation_id, attempt_revision)
        ON DELETE RESTRICT,
      FOREIGN KEY (operation_id, recovered_by_attempt_revision)
        REFERENCES model_binding_application_attempts(operation_id, attempt_revision)
        ON DELETE RESTRICT,
      CHECK (
        (finalization_kind = 'DIRECT_CONFIRMED'
          AND config_version IS NOT NULL
          AND recovered_by_attempt_revision IS NULL)
        OR
        (finalization_kind = 'RECOVERED_BY'
          AND config_version IS NULL
          AND recovered_by_attempt_revision > runtime_attempt_revision)
      )
    );

    CREATE INDEX idx_model_binding_runtime_finalize_operation
      ON model_binding_runtime_finalize_receipts(
        operation_id, runtime_attempt_revision, finalization_kind
      );

    CREATE TRIGGER trg_model_binding_runtime_finalize_cutoff_sealed_insert
    BEFORE INSERT ON model_binding_runtime_finalize_cutoffs
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_cutoffs is migration-sealed');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_cutoff_sealed_update
    BEFORE UPDATE ON model_binding_runtime_finalize_cutoffs
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_cutoffs is migration-sealed');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_cutoff_sealed_delete
    BEFORE DELETE ON model_binding_runtime_finalize_cutoffs
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_cutoffs is migration-sealed');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_sequence_authority
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.seq <> -1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_SEQUENCE_AUTHORITY: finalize sequence is database assigned');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_sequence_positive
    AFTER INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.seq <= 0
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_SEQUENCE_AUTHORITY: finalize sequence must be positive');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_identity_conflict
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_runtime_finalize_receipts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.runtime_attempt_revision = NEW.runtime_attempt_revision
         )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_IDENTITY_CONFLICT: finalize receipt is already committed');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_attempt_shape
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.operation_id
        AND attempt.attempt_revision = NEW.runtime_attempt_revision
        AND attempt.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        AND attempt.outcome = 'SUCCEEDED'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_ATTEMPT_INVALID: receipt requires a successful runtime attempt');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_current_desired
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
      WHERE operation.operation_id = NEW.operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_DESIRED_MISMATCH: operation is not current desired authority');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_direct_latest
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.finalization_kind = 'DIRECT_CONFIRMED'
      AND NEW.runtime_attempt_revision <> (
        SELECT MAX(attempt.attempt_revision)
        FROM model_binding_application_attempts attempt
        WHERE attempt.operation_id = NEW.operation_id
          AND attempt.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_NOT_LATEST: direct receipt must confirm the latest runtime generation');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_direct_after_cutoff
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.finalization_kind = 'DIRECT_CONFIRMED'
      AND EXISTS (
        SELECT 1
        FROM model_binding_runtime_finalize_cutoffs cutoff
        WHERE cutoff.operation_id = NEW.operation_id
          AND NEW.runtime_attempt_revision
            <= cutoff.max_preexisting_runtime_attempt_revision
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_REHYDRATE_REQUIRED: pre-054 runtime success requires a new startup generation');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_recovery_lineage
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NEW.finalization_kind = 'RECOVERED_BY' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts recovery
      JOIN model_binding_runtime_finalize_receipts confirmation
        ON confirmation.operation_id = recovery.operation_id
       AND confirmation.runtime_attempt_revision = recovery.attempt_revision
       AND confirmation.finalization_kind = 'DIRECT_CONFIRMED'
      WHERE recovery.operation_id = NEW.operation_id
        AND recovery.attempt_revision = NEW.recovered_by_attempt_revision
        AND recovery.attempt_kind = 'STARTUP_REHYDRATE'
        AND recovery.outcome = 'SUCCEEDED'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_RECOVERY_INVALID: recovery requires a later confirmed startup generation');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_time_order
    BEFORE INSERT ON model_binding_runtime_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.operation_id
        AND attempt.attempt_revision = NEW.runtime_attempt_revision
        AND attempt.created_at_ms <= NEW.created_at_ms
    ) OR (
      NEW.recovered_by_attempt_revision IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_application_attempts recovery
        WHERE recovery.operation_id = NEW.operation_id
          AND recovery.attempt_revision = NEW.recovered_by_attempt_revision
          AND recovery.created_at_ms <= NEW.created_at_ms
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_TIME_ROLLBACK: receipt time precedes its authority');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_append_only_update
    BEFORE UPDATE ON model_binding_runtime_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_receipts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_runtime_finalize_append_only_delete
    BEFORE DELETE ON model_binding_runtime_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_runtime_finalize_receipts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_application_finalize_prerequisite
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind IN ('VERIFICATION','NOTIFICATION')
      AND NOT EXISTS (
        SELECT 1
        FROM model_binding_application_attempts runtime
        JOIN model_binding_runtime_finalize_receipts receipt
          ON receipt.operation_id = runtime.operation_id
         AND receipt.runtime_attempt_revision = runtime.attempt_revision
         AND receipt.finalization_kind = 'DIRECT_CONFIRMED'
        WHERE runtime.operation_id = NEW.operation_id
          AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
          AND runtime.outcome = 'SUCCEEDED'
          AND runtime.attempt_revision = (
            SELECT MAX(latest.attempt_revision)
            FROM model_binding_application_attempts latest
            WHERE latest.operation_id = NEW.operation_id
              AND latest.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
          )
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_RUNTIME_FINALIZE_REQUIRED: terminal effect requires a confirmed runtime generation');
    END;
  `);
}
