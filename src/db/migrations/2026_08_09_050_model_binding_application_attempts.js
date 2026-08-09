// Migration 050 — append-only outcomes for manual binding application.
//
// Migration 048 intentionally records durable user intent only. Its fixed
// NOT_VERIFIED/NOT_APPLIED values remain historical facts and are never
// rewritten. Runtime application, restart rehydrate, exact verification and
// notification delivery are recorded here as separate terminal attempts.

export const version = '2026_08_09_050_model_binding_application_attempts';
export const description = 'Add append-only manual binding application attempts and safe override default';

export function up(db) {
  const applicationTableExists = db.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'model_binding_application_attempts'
  `).get();
  if (applicationTableExists) {
    throw new Error('model_binding_application_attempts pre-exists its migration authority');
  }

  const overrideColumns = db.prepare("PRAGMA table_info('model_overrides')").all();
  const overrideColumnNames = overrideColumns.map(column => column.name).sort();
  const expectedOverrideColumns = [
    'applied_at',
    'applied_by',
    'model',
    'previous_model',
    'role',
    'score',
    'verified',
  ];
  if (JSON.stringify(overrideColumnNames) !== JSON.stringify(expectedOverrideColumns)) {
    throw new Error('model_overrides schema is not the expected pre-050 shape');
  }

  db.exec(`
    CREATE TABLE model_binding_application_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      attempt_revision INTEGER NOT NULL
        CHECK (typeof(attempt_revision) = 'integer' AND attempt_revision >= 1),
      attempt_kind TEXT NOT NULL
        CHECK (attempt_kind IN (
          'RUNTIME_APPLY','STARTUP_REHYDRATE','VERIFICATION','NOTIFICATION'
        )),
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED')),
      observed_model_name TEXT
        CHECK (
          observed_model_name IS NULL
          OR length(trim(observed_model_name)) BETWEEN 1 AND 512
        ),
      observed_canonical_name TEXT
        CHECK (
          observed_canonical_name IS NULL
          OR length(trim(observed_canonical_name)) BETWEEN 1 AND 512
        ),
      observed_digest_sha256 TEXT
        CHECK (
          observed_digest_sha256 IS NULL OR (
            length(observed_digest_sha256) = 64
            AND observed_digest_sha256 = lower(observed_digest_sha256)
            AND observed_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      verification_method TEXT
        CHECK (
          verification_method IS NULL
          OR length(trim(verification_method)) BETWEEN 1 AND 64
        ),
      failure_code TEXT
        CHECK (
          failure_code IS NULL
          OR (
            length(failure_code) BETWEEN 3 AND 96
            AND failure_code = upper(failure_code)
            AND failure_code NOT GLOB '*[^A-Z0-9_]*'
          )
        ),
      retryable INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(retryable) = 'integer' AND retryable IN (0, 1)),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(operation_id, attempt_revision),
      CHECK (
        (observed_model_name IS NULL
          AND observed_canonical_name IS NULL
          AND observed_digest_sha256 IS NULL)
        OR
        (observed_model_name IS NOT NULL
          AND observed_canonical_name IS NOT NULL
          AND observed_digest_sha256 IS NOT NULL)
      ),
      CHECK (
        (outcome = 'SUCCEEDED'
          AND observed_model_name IS NOT NULL
          AND failure_code IS NULL
          AND retryable = 0)
        OR
        (outcome = 'FAILED' AND failure_code IS NOT NULL)
      ),
      CHECK (
        (attempt_kind = 'VERIFICATION'
          AND verification_method = 'OLLAMA_CHAT_EXACT_DIGEST_V1')
        OR
        (attempt_kind <> 'VERIFICATION' AND verification_method IS NULL)
      ),
      CHECK (
        observed_model_name IS NULL
        OR observed_model_name = observed_canonical_name
        OR observed_model_name = observed_canonical_name || ':latest'
      )
    );

    CREATE INDEX idx_model_binding_application_operation
      ON model_binding_application_attempts(operation_id, attempt_revision);

    CREATE TRIGGER trg_model_binding_application_revision
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_revision <> COALESCE((
      SELECT MAX(existing.attempt_revision)
      FROM model_binding_application_attempts existing
      WHERE existing.operation_id = NEW.operation_id
    ), 0) + 1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_ATTEMPT_REVISION_MISMATCH: attempt revision must append exactly');
    END;

    CREATE TRIGGER trg_model_binding_application_current_desired
    BEFORE INSERT ON model_binding_application_attempts
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
       AND desired.observed_at_ms = operation.created_at_ms
       AND desired.updated_at_ms = operation.created_at_ms
      WHERE operation.operation_id = NEW.operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_DESIRED_MISMATCH: operation is not current desired authority');
    END;

    CREATE TRIGGER trg_model_binding_application_success_identity
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.outcome = 'SUCCEEDED' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.target_canonical_name = NEW.observed_canonical_name
        AND operation.target_digest_sha256 = NEW.observed_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_IDENTITY_MISMATCH: success requires exact target identity');
    END;

    CREATE TRIGGER trg_model_binding_application_time_order
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.created_at_ms <= NEW.created_at_ms
    ) OR EXISTS (
      SELECT 1
      FROM model_binding_application_attempts previous
      WHERE previous.operation_id = NEW.operation_id
        AND previous.attempt_revision = NEW.attempt_revision - 1
        AND previous.created_at_ms > NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_TIME_ROLLBACK: attempt time precedes its authority');
    END;

    CREATE TRIGGER trg_model_binding_application_runtime_prerequisite
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind IN ('VERIFICATION','NOTIFICATION') AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts runtime
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
        'MODEL_BINDING_APPLICATION_RUNTIME_PREREQUISITE: terminal effect requires applied runtime');
    END;

    CREATE TRIGGER trg_model_binding_application_runtime_apply_once
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind = 'RUNTIME_APPLY' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts applied
      WHERE applied.operation_id = NEW.operation_id
        AND applied.attempt_kind = 'RUNTIME_APPLY'
        AND applied.outcome = 'SUCCEEDED'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_RUNTIME_ALREADY_APPLIED: runtime apply is terminal after success');
    END;

    CREATE TRIGGER trg_model_binding_application_verification_terminal
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind = 'VERIFICATION' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts verified
      WHERE verified.operation_id = NEW.operation_id
        AND verified.attempt_kind = 'VERIFICATION'
        AND verified.outcome = 'SUCCEEDED'
        AND verified.attempt_revision > COALESCE((
          SELECT MAX(runtime.attempt_revision)
          FROM model_binding_application_attempts runtime
          WHERE runtime.operation_id = NEW.operation_id
            AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        ), 0)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_VERIFICATION_TERMINAL: verified operation cannot be reverified');
    END;

    CREATE TRIGGER trg_model_binding_application_notification_once
    BEFORE INSERT ON model_binding_application_attempts
    WHEN NEW.attempt_kind = 'NOTIFICATION' AND EXISTS (
      SELECT 1
      FROM model_binding_application_attempts notification
      WHERE notification.operation_id = NEW.operation_id
        AND notification.attempt_kind = 'NOTIFICATION'
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_APPLICATION_NOTIFICATION_TERMINAL: notification is recorded once');
    END;

    CREATE TRIGGER trg_model_binding_application_append_only_update
    BEFORE UPDATE ON model_binding_application_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_application_attempts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_application_append_only_delete
    BEFORE DELETE ON model_binding_application_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_application_attempts is append-only');
    END;

    ALTER TABLE model_overrides RENAME TO model_overrides_pre_050;

    CREATE TABLE model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT NOT NULL,
      score REAL,
      applied_by TEXT DEFAULT 'user',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(verified) = 'integer' AND verified IN (0, 1)),
      binding_operation_id TEXT
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      model_canonical_name TEXT,
      model_digest_sha256 TEXT,
      verification_status TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED'
        CHECK (verification_status IN (
          'LEGACY_UNVERIFIED','PENDING','VERIFIED','FAILED'
        )),
      CHECK (
        (binding_operation_id IS NULL
          AND model_canonical_name IS NULL
          AND model_digest_sha256 IS NULL
          AND verification_status = 'LEGACY_UNVERIFIED'
          AND verified = 0)
        OR
        (binding_operation_id IS NOT NULL
          AND length(trim(model_canonical_name)) BETWEEN 1 AND 512
          AND length(model_digest_sha256) = 64
          AND model_digest_sha256 = lower(model_digest_sha256)
          AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND verification_status IN ('PENDING','VERIFIED','FAILED')
          AND verified = (verification_status = 'VERIFIED'))
      )
    );

    INSERT INTO model_overrides (
      role, model, previous_model, score, applied_by, applied_at, verified,
      binding_operation_id, model_canonical_name, model_digest_sha256,
      verification_status
    )
    SELECT role, model, previous_model, score, applied_by, applied_at, 0,
      NULL, NULL, NULL, 'LEGACY_UNVERIFIED'
    FROM model_overrides_pre_050;

    DROP TABLE model_overrides_pre_050;

    CREATE TRIGGER trg_model_overrides_manual_identity_insert
    BEFORE INSERT ON model_overrides
    WHEN NEW.binding_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.binding_operation_id
        AND operation.role = NEW.role
        AND operation.target_model_name = NEW.model
        AND operation.target_canonical_name = NEW.model_canonical_name
        AND operation.target_digest_sha256 = NEW.model_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_IDENTITY_MISMATCH: override requires exact operation target');
    END;

    CREATE TRIGGER trg_model_overrides_legacy_cannot_replace_manual
    BEFORE INSERT ON model_overrides
    WHEN NEW.binding_operation_id IS NULL AND EXISTS (
      SELECT 1 FROM model_overrides existing
      WHERE existing.role = NEW.role AND existing.binding_operation_id IS NOT NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_LEGACY_OVERWRITE_REJECTED: legacy writer cannot replace manual lineage');
    END;

    CREATE TRIGGER trg_model_overrides_manual_identity_update
    BEFORE UPDATE ON model_overrides
    WHEN NEW.binding_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      WHERE operation.operation_id = NEW.binding_operation_id
        AND operation.role = NEW.role
        AND operation.target_model_name = NEW.model
        AND operation.target_canonical_name = NEW.model_canonical_name
        AND operation.target_digest_sha256 = NEW.model_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_IDENTITY_MISMATCH: override requires exact operation target');
    END;

    CREATE TRIGGER trg_model_overrides_manual_lineage_update
    BEFORE UPDATE ON model_overrides
    WHEN OLD.binding_operation_id IS NOT NULL AND NEW.binding_operation_id IS NULL
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_LEGACY_OVERWRITE_REJECTED: manual lineage cannot become legacy');
    END;

    CREATE TRIGGER trg_model_overrides_manual_lineage_delete
    BEFORE DELETE ON model_overrides
    WHEN OLD.binding_operation_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_MANUAL_DELETE_REJECTED: manual override is append-only through operations');
    END;

    CREATE TRIGGER trg_model_overrides_verified_authority_insert
    BEFORE INSERT ON model_overrides
    WHEN NEW.verified = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.binding_operation_id
        AND attempt.attempt_kind = 'VERIFICATION'
        AND attempt.outcome = 'SUCCEEDED'
        AND attempt.observed_canonical_name = NEW.model_canonical_name
        AND attempt.observed_digest_sha256 = NEW.model_digest_sha256
        AND attempt.attempt_revision > COALESCE((
          SELECT MAX(runtime.attempt_revision)
          FROM model_binding_application_attempts runtime
          WHERE runtime.operation_id = NEW.binding_operation_id
            AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        ), 0)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_VERIFICATION_REQUIRED: verified override requires exact successful probe');
    END;

    CREATE TRIGGER trg_model_overrides_verified_authority_update
    BEFORE UPDATE ON model_overrides
    WHEN NEW.verified = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_binding_application_attempts attempt
      WHERE attempt.operation_id = NEW.binding_operation_id
        AND attempt.attempt_kind = 'VERIFICATION'
        AND attempt.outcome = 'SUCCEEDED'
        AND attempt.observed_canonical_name = NEW.model_canonical_name
        AND attempt.observed_digest_sha256 = NEW.model_digest_sha256
        AND attempt.attempt_revision > COALESCE((
          SELECT MAX(runtime.attempt_revision)
          FROM model_binding_application_attempts runtime
          WHERE runtime.operation_id = NEW.binding_operation_id
            AND runtime.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
        ), 0)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_OVERRIDE_VERIFICATION_REQUIRED: verified override requires exact successful probe');
    END;
  `);
}
