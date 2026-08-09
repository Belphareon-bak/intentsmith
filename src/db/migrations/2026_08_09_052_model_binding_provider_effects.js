// Migration 052 — durable audit authority for provider mutation effects.
//
// A model pull changes provider storage before a binding operation can know
// the downloaded artifact digest.  The intent therefore needs its own
// append-only journal: durable intent first, provider effect second, terminal
// exact identity or typed failure last.

export const version = '2026_08_09_052_model_binding_provider_effects';
export const description = 'Audit manual binding provider effects before mutation';

export function up(db) {
  const existing = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'model_binding_provider_operations',
        'model_binding_provider_attempts',
        'model_binding_provider_claims',
        'model_binding_user_noop_receipts',
        'model_binding_user_noop_provider_supersedes'
      )
    ORDER BY name
  `).all();
  if (existing.length !== 0) {
    throw new Error('model binding provider-effect tables pre-exist migration 052');
  }

  db.exec(`
    CREATE TABLE model_binding_provider_operations (
      command_seq INTEGER PRIMARY KEY AUTOINCREMENT
        CHECK (typeof(command_seq) = 'integer' AND command_seq > 0),
      operation_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(operation_id)) BETWEEN 16 AND 256),
      request_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(request_key)) BETWEEN 16 AND 128),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      effect_kind TEXT NOT NULL CHECK (effect_kind = 'PULL'),
      request_purpose TEXT NOT NULL
        CHECK (request_purpose IN ('USER_APPLY_TARGET','LEGACY_BASELINE_RECOVERY')),
      expected_binding_revision INTEGER
        CHECK (
          (request_purpose = 'USER_APPLY_TARGET'
            AND typeof(expected_binding_revision) = 'integer'
            AND expected_binding_revision >= 1)
          OR
          (request_purpose = 'LEGACY_BASELINE_RECOVERY'
            AND expected_binding_revision IS NULL)
        ),
      provider_origin TEXT NOT NULL
        CHECK (
          provider_origin IN (
            'http://127.0.0.1','http://localhost','http://[::1]'
          )
          OR (
            substr(provider_origin, 1, 17) IN ('http://127.0.0.1:','http://localhost:')
            AND length(substr(provider_origin, 18)) BETWEEN 1 AND 5
            AND substr(provider_origin, 18) NOT GLOB '*[^0-9]*'
            AND CAST(substr(provider_origin, 18) AS INTEGER) BETWEEN 1 AND 65535
            AND CAST(substr(provider_origin, 18) AS TEXT)
              = CAST(CAST(substr(provider_origin, 18) AS INTEGER) AS TEXT)
            AND CAST(substr(provider_origin, 18) AS INTEGER) <> 80
          )
          OR (
            substr(provider_origin, 1, 13) = 'http://[::1]:'
            AND length(substr(provider_origin, 14)) BETWEEN 1 AND 5
            AND substr(provider_origin, 14) NOT GLOB '*[^0-9]*'
            AND CAST(substr(provider_origin, 14) AS INTEGER) BETWEEN 1 AND 65535
            AND CAST(substr(provider_origin, 14) AS TEXT)
              = CAST(CAST(substr(provider_origin, 14) AS INTEGER) AS TEXT)
            AND CAST(substr(provider_origin, 14) AS INTEGER) <> 80
          )
        ),
      requested_model_name TEXT NOT NULL
        CHECK (length(trim(requested_model_name)) BETWEEN 1 AND 512),
      requested_canonical_name TEXT NOT NULL
        CHECK (length(trim(requested_canonical_name)) BETWEEN 1 AND 512),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 3 AND 128),
      initial_claim_token TEXT NOT NULL UNIQUE
        CHECK (length(trim(initial_claim_token)) BETWEEN 16 AND 256),
      initial_claim_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(initial_claim_expires_at_ms) = 'integer'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),
      CHECK (
        initial_claim_expires_at_ms > created_at_ms
        AND initial_claim_expires_at_ms <= created_at_ms + 300000
      ),
      CHECK (
        lower(requested_model_name) = requested_canonical_name
        OR lower(requested_model_name) = requested_canonical_name || ':latest'
      )
    );

    CREATE TABLE model_binding_provider_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      attempt_revision INTEGER NOT NULL
        CHECK (typeof(attempt_revision) = 'integer' AND attempt_revision = 1),
      outcome TEXT NOT NULL CHECK (outcome IN (
        'SUCCEEDED','FAILED','RECONCILED_PRESENT','RECONCILED_ABSENT'
      )),
      observed_model_name TEXT,
      observed_canonical_name TEXT,
      observed_digest_sha256 TEXT,
      failure_code TEXT,
      retryable INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(retryable) = 'integer' AND retryable IN (0, 1)),
      claim_token TEXT NOT NULL
        CHECK (length(trim(claim_token)) BETWEEN 16 AND 256),
      fencing_revision INTEGER NOT NULL
        CHECK (typeof(fencing_revision) = 'integer' AND fencing_revision >= 1),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),
      UNIQUE(operation_id, attempt_revision),
      CHECK (
        (outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
          AND length(trim(observed_model_name)) BETWEEN 1 AND 512
          AND length(trim(observed_canonical_name)) BETWEEN 1 AND 512
          AND length(observed_digest_sha256) = 64
          AND observed_digest_sha256 = lower(observed_digest_sha256)
          AND observed_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND failure_code IS NULL
          AND retryable = 0)
        OR
        (outcome = 'FAILED'
          AND observed_model_name IS NULL
          AND observed_canonical_name IS NULL
          AND observed_digest_sha256 IS NULL
          AND (
            (failure_code IN (
              'MODEL_BINDING_PROVIDER_UNAVAILABLE',
              'MODEL_BINDING_PROVIDER_PULL_FAILED',
              'MODEL_BINDING_TARGET_NOT_INSTALLED'
            ) AND retryable = 1)
            OR
            (failure_code IN (
              'MODEL_BINDING_TARGET_DIGEST_MISSING',
              'MODEL_BINDING_TARGET_AMBIGUOUS',
              'MODEL_BINDING_TARGET_DIGEST_DRIFT'
            ) AND retryable = 0)
          ))
        OR
        (outcome = 'RECONCILED_ABSENT'
          AND observed_model_name IS NULL
          AND observed_canonical_name IS NULL
          AND observed_digest_sha256 IS NULL
          AND failure_code = 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED'
          AND retryable = 1)
      ),
      CHECK (
        observed_model_name IS NULL
        OR lower(observed_model_name) = observed_canonical_name
        OR lower(observed_model_name) = observed_canonical_name || ':latest'
      )
    );

    CREATE TABLE model_binding_provider_claims (
      operation_id TEXT PRIMARY KEY
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      role TEXT NOT NULL UNIQUE
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      provider_origin TEXT NOT NULL,
      requested_canonical_name TEXT NOT NULL
        CHECK (length(trim(requested_canonical_name)) BETWEEN 1 AND 512),
      claim_token TEXT NOT NULL UNIQUE
        CHECK (length(trim(claim_token)) BETWEEN 16 AND 256),
      fencing_revision INTEGER NOT NULL
        CHECK (typeof(fencing_revision) = 'integer' AND fencing_revision >= 1),
      lease_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(lease_expires_at_ms) = 'integer' AND lease_expires_at_ms > 0),
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms > 0),
      UNIQUE(provider_origin, requested_canonical_name),
      CHECK (
        lease_expires_at_ms > updated_at_ms
        AND lease_expires_at_ms <= updated_at_ms + 300000
      )
    );

    CREATE TABLE model_binding_user_noop_receipts (
      receipt_id TEXT PRIMARY KEY
        CHECK (length(trim(receipt_id)) BETWEEN 16 AND 256),
      request_key TEXT NOT NULL UNIQUE
        CHECK (length(trim(request_key)) BETWEEN 16 AND 128),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      binding_revision INTEGER NOT NULL
        CHECK (typeof(binding_revision) = 'integer' AND binding_revision >= 1),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      canonical_name TEXT NOT NULL
        CHECK (length(trim(canonical_name)) BETWEEN 1 AND 512),
      digest_sha256 TEXT NOT NULL
        CHECK (
          length(digest_sha256) = 64
          AND digest_sha256 = lower(digest_sha256)
          AND digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 3 AND 128),
      desired_source TEXT NOT NULL
        CHECK (desired_source IN (
          'CONFIG_DEFAULT','LEGACY_OVERRIDE','USER_APPLY','USER_ROLLBACK'
        )),
      desired_actor TEXT NOT NULL
        CHECK (length(trim(desired_actor)) BETWEEN 3 AND 128),
      desired_observed_at_ms INTEGER NOT NULL
        CHECK (typeof(desired_observed_at_ms) = 'integer' AND desired_observed_at_ms > 0),
      desired_updated_at_ms INTEGER NOT NULL
        CHECK (typeof(desired_updated_at_ms) = 'integer' AND desired_updated_at_ms > 0),
      desired_last_event_id TEXT NOT NULL
        CHECK (length(trim(desired_last_event_id)) BETWEEN 16 AND 256),
      provider_command_cutoff_seq INTEGER NOT NULL DEFAULT 0
        CHECK (
          typeof(provider_command_cutoff_seq) = 'integer'
          AND provider_command_cutoff_seq >= 0
        ),
      source_provider_operation_id TEXT
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),
      CHECK (
        lower(model_name) = canonical_name
        OR lower(model_name) = canonical_name || ':latest'
      )
    );

    CREATE TRIGGER trg_model_binding_user_noop_projection
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_desired_bindings desired
      WHERE desired.role = NEW.role
        AND desired.binding_revision = NEW.binding_revision
        AND desired.model_name = NEW.model_name
        AND desired.canonical_name = NEW.canonical_name
        AND desired.digest_sha256 = NEW.digest_sha256
        AND desired.source = NEW.desired_source
        AND desired.actor = NEW.desired_actor
        AND desired.observed_at_ms = NEW.desired_observed_at_ms
        AND desired.updated_at_ms = NEW.desired_updated_at_ms
        AND desired.last_event_id = NEW.desired_last_event_id
        AND desired.updated_at_ms <= NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROJECTION_MISMATCH: receipt must match current desired binding');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_actor
    BEFORE INSERT ON model_binding_user_noop_receipts
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
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_ACTOR_INVALID: receipt requires a user actor');
    END;

    CREATE TABLE model_binding_user_noop_provider_supersedes (
      receipt_id TEXT NOT NULL
        REFERENCES model_binding_user_noop_receipts(receipt_id) ON DELETE RESTRICT,
      provider_operation_id TEXT NOT NULL UNIQUE
        REFERENCES model_binding_provider_operations(operation_id) ON DELETE RESTRICT,
      PRIMARY KEY (receipt_id, provider_operation_id)
    );

    CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_insert_conflict
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_user_noop_provider_supersedes existing
      WHERE (
          existing.receipt_id = NEW.receipt_id
          AND existing.provider_operation_id = NEW.provider_operation_id
        )
        OR existing.provider_operation_id = NEW.provider_operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_CONFLICT: provider lineage is already committed');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_cutoff
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN (
      SELECT provider.command_seq > receipt.provider_command_cutoff_seq
      FROM model_binding_provider_operations provider
      JOIN model_binding_user_noop_receipts receipt
        ON receipt.receipt_id = NEW.receipt_id
      WHERE provider.operation_id = NEW.provider_operation_id
    ) = 1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_CUTOFF_MISMATCH: provider command is newer than the receipt frontier');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_lineage
    BEFORE INSERT ON model_binding_user_noop_provider_supersedes
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts receipt
      JOIN model_binding_provider_operations provider
        ON provider.operation_id = NEW.provider_operation_id
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE receipt.receipt_id = NEW.receipt_id
        AND provider.role = receipt.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = receipt.binding_revision
        AND provider.command_seq <= receipt.provider_command_cutoff_seq
        AND provider.created_at_ms <= receipt.created_at_ms
        AND terminal.created_at_ms <= receipt.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_LINEAGE_MISMATCH: superseded provider command must be terminal and share role and revision');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_frontier
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NEW.provider_command_cutoff_seq <> COALESCE((
      SELECT MAX(provider.command_seq)
      FROM model_binding_provider_operations provider
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
    ), 0)
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_FRONTIER_MISMATCH: receipt must pin the current provider command frontier');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_source_provider_lineage
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN NEW.source_provider_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.operation_id = NEW.source_provider_operation_id
        AND provider.request_key = NEW.request_key
        AND provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq = NEW.provider_command_cutoff_seq
        AND provider.actor = NEW.actor
        AND provider.created_at_ms <= NEW.created_at_ms
        AND terminal.created_at_ms <= NEW.created_at_ms
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND terminal.observed_canonical_name = NEW.canonical_name
        AND terminal.observed_digest_sha256 = NEW.digest_sha256
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_SOURCE_LINEAGE_MISMATCH: source provider command must exactly match the no-op receipt');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_pending
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq <= NEW.provider_command_cutoff_seq
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_PROVIDER_PENDING: no-op receipt cannot overtake a live provider command');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_time_order
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq <= NEW.provider_command_cutoff_seq
        AND terminal.created_at_ms > NEW.created_at_ms
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_TIME_ROLLBACK: no-op receipt precedes a provider terminal');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_prefix
    AFTER INSERT ON model_binding_user_noop_receipts
    BEGIN
      INSERT INTO model_binding_user_noop_provider_supersedes (
        receipt_id, provider_operation_id
      )
      SELECT NEW.receipt_id, provider.operation_id
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.binding_revision
        AND provider.command_seq <= NEW.provider_command_cutoff_seq
        AND terminal.created_at_ms <= NEW.created_at_ms
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        );
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_update
    BEFORE UPDATE ON model_binding_user_noop_provider_supersedes
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_provider_supersedes is append-only');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_provider_supersedes_delete
    BEFORE DELETE ON model_binding_user_noop_provider_supersedes
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_provider_supersedes is append-only');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_request_key
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN EXISTS (
      SELECT 1 FROM model_binding_operations binding
      WHERE binding.request_key = NEW.request_key
    ) OR EXISTS (
      SELECT 1 FROM model_binding_provider_operations provider
      WHERE provider.request_key = NEW.request_key
        AND (
          NEW.source_provider_operation_id IS NULL
          OR provider.operation_id <> NEW.source_provider_operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_REQUEST_CONFLICT: request key already owns another command');
    END;

    CREATE TRIGGER trg_model_binding_provider_unresolved_success
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NEW.request_purpose = 'USER_APPLY_TARGET' AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations prior
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = prior.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = prior.request_key
      WHERE prior.role = NEW.role
        AND prior.request_purpose = 'USER_APPLY_TARGET'
        AND prior.expected_binding_revision = NEW.expected_binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = prior.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: resolve the earlier provider success before recording another intent');
    END;

    CREATE TRIGGER trg_model_binding_provider_desired_revision
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NEW.request_purpose = 'USER_APPLY_TARGET' AND NOT EXISTS (
      SELECT 1
      FROM model_desired_bindings desired
      WHERE desired.role = NEW.role
        AND desired.binding_revision = NEW.expected_binding_revision
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_DESIRED_MISMATCH: provider intent requires the current desired binding revision');
    END;

    CREATE TRIGGER trg_model_desired_binding_provider_unresolved_success
    BEFORE UPDATE ON model_desired_bindings
    WHEN NOT (
      NEW.role IS OLD.role
      AND NEW.model_name IS OLD.model_name
      AND NEW.canonical_name IS OLD.canonical_name
      AND NEW.digest_sha256 IS OLD.digest_sha256
      AND NEW.binding_revision IS OLD.binding_revision
      AND NEW.source IS OLD.source
      AND NEW.actor IS OLD.actor
      AND NEW.observed_at_ms IS OLD.observed_at_ms
      AND NEW.updated_at_ms IS OLD.updated_at_ms
      AND NEW.last_event_id IS OLD.last_event_id
    ) AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: desired projection cannot change before provider success closure');
    END;

    CREATE TRIGGER trg_model_desired_binding_provider_pending
    BEFORE UPDATE ON model_desired_bindings
    WHEN NOT (
      NEW.role IS OLD.role
      AND NEW.model_name IS OLD.model_name
      AND NEW.canonical_name IS OLD.canonical_name
      AND NEW.digest_sha256 IS OLD.digest_sha256
      AND NEW.binding_revision IS OLD.binding_revision
      AND NEW.source IS OLD.source
      AND NEW.actor IS OLD.actor
      AND NEW.observed_at_ms IS OLD.observed_at_ms
      AND NEW.updated_at_ms IS OLD.updated_at_ms
      AND NEW.last_event_id IS OLD.last_event_id
    ) AND EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: desired projection cannot change during a live provider command');
    END;

    CREATE TRIGGER trg_model_desired_binding_provider_unresolved_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_desired_bindings current
      JOIN model_binding_provider_operations provider
        ON provider.role = current.role
       AND provider.request_purpose = 'USER_APPLY_TARGET'
       AND provider.expected_binding_revision = current.binding_revision
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE current.role = NEW.role
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: desired projection cannot be replaced before provider success closure');
    END;

    CREATE TRIGGER trg_model_desired_binding_provider_pending_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_desired_bindings current
      JOIN model_binding_provider_operations provider
        ON provider.role = current.role
       AND provider.request_purpose = 'USER_APPLY_TARGET'
       AND provider.expected_binding_revision = current.binding_revision
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE current.role = NEW.role
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: desired projection cannot be replaced during a live provider command');
    END;

    CREATE TRIGGER trg_model_desired_binding_provider_unresolved_delete
    BEFORE DELETE ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: desired projection cannot be deleted before provider success closure');
    END;

    CREATE TRIGGER trg_model_desired_binding_provider_pending_delete
    BEFORE DELETE ON model_desired_bindings
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = OLD.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = OLD.binding_revision
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: desired projection cannot be deleted during a live provider command');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_append_only_insert_conflict
    BEFORE INSERT ON model_binding_user_noop_receipts
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_APPEND_ONLY_CONFLICT: receipt identity is already committed');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_append_only_update
    BEFORE UPDATE ON model_binding_user_noop_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_receipts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_user_noop_append_only_delete
    BEFORE DELETE ON model_binding_user_noop_receipts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_user_noop_receipts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_provider_noop_request_conflict
    BEFORE INSERT ON model_binding_provider_operations
    WHEN EXISTS (
      SELECT 1 FROM model_binding_user_noop_receipts receipt
      WHERE receipt.request_key = NEW.request_key
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_REQUEST_CONFLICT: request key already owns a no-op receipt');
    END;

    CREATE TRIGGER trg_model_binding_operation_noop_request_conflict
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1 FROM model_binding_user_noop_receipts receipt
      WHERE receipt.request_key = NEW.request_key
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_USER_NOOP_REQUEST_CONFLICT: request key already owns a no-op receipt');
    END;

    CREATE TRIGGER trg_model_binding_provider_operations_user_actor
    BEFORE INSERT ON model_binding_provider_operations
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
      SELECT RAISE(ABORT, 'model binding provider operation requires a user actor');
    END;

    CREATE TRIGGER trg_model_binding_provider_command_sequence_authority
    BEFORE INSERT ON model_binding_provider_operations
    WHEN NEW.command_seq <> -1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_COMMAND_SEQUENCE_AUTHORITY: command sequence is database assigned');
    END;

    CREATE TRIGGER trg_model_binding_provider_claim_conflict
    BEFORE INSERT ON model_binding_provider_operations
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_claims claim
      WHERE claim.role = NEW.role
         OR (claim.provider_origin = NEW.provider_origin
           AND claim.requested_canonical_name = NEW.requested_canonical_name)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_HELD: provider effect authority is already claimed');
    END;

    CREATE TRIGGER trg_model_binding_provider_claim_create
    AFTER INSERT ON model_binding_provider_operations
    BEGIN
      INSERT INTO model_binding_provider_claims (
        operation_id, role, provider_origin, requested_canonical_name,
        claim_token, fencing_revision, lease_expires_at_ms, updated_at_ms
      ) VALUES (
        NEW.operation_id, NEW.role, NEW.provider_origin, NEW.requested_canonical_name,
        NEW.initial_claim_token, 1, NEW.initial_claim_expires_at_ms, NEW.created_at_ms
      );
    END;

    CREATE TRIGGER trg_model_binding_provider_claim_update_guard
    BEFORE UPDATE ON model_binding_provider_claims
    WHEN NOT (
      OLD.operation_id = NEW.operation_id
      AND OLD.role = NEW.role
      AND OLD.provider_origin = NEW.provider_origin
      AND OLD.requested_canonical_name = NEW.requested_canonical_name
      AND NEW.lease_expires_at_ms > NEW.updated_at_ms
      AND (
        (NEW.claim_token = OLD.claim_token
          AND NEW.fencing_revision = OLD.fencing_revision
          AND NEW.updated_at_ms >= OLD.updated_at_ms
          AND NEW.updated_at_ms <= OLD.lease_expires_at_ms
          AND NEW.lease_expires_at_ms > OLD.lease_expires_at_ms)
        OR
        (NEW.claim_token <> OLD.claim_token
          AND NEW.fencing_revision = OLD.fencing_revision + 1
          AND OLD.lease_expires_at_ms < NEW.updated_at_ms)
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_INVALID: invalid heartbeat or fenced takeover');
    END;

    CREATE TRIGGER trg_model_binding_provider_claim_delete_guard
    BEFORE DELETE ON model_binding_provider_claims
    WHEN NOT EXISTS (
      SELECT 1 FROM model_binding_provider_attempts terminal
      WHERE terminal.operation_id = OLD.operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_ACTIVE: claim cannot be released before terminal audit');
    END;

    CREATE TRIGGER trg_model_binding_provider_terminal_claim
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_claims claim
      WHERE claim.operation_id = NEW.operation_id
        AND claim.claim_token = NEW.claim_token
        AND claim.fencing_revision = NEW.fencing_revision
        AND claim.lease_expires_at_ms >= NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_STALE: terminal audit requires the live fenced claim');
    END;

    CREATE TRIGGER trg_model_binding_provider_attempt_once
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN EXISTS (
      SELECT 1 FROM model_binding_provider_attempts existing
      WHERE existing.operation_id = NEW.operation_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_TERMINAL: provider effect already has a terminal outcome');
    END;

    CREATE TRIGGER trg_model_binding_provider_success_identity
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NEW.outcome IN ('SUCCEEDED','RECONCILED_PRESENT') AND NOT EXISTS (
      SELECT 1 FROM model_binding_provider_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.requested_canonical_name = NEW.observed_canonical_name
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_IDENTITY_MISMATCH: pull result changed canonical target');
    END;

    CREATE TRIGGER trg_model_binding_provider_time_order
    BEFORE INSERT ON model_binding_provider_attempts
    WHEN NOT EXISTS (
      SELECT 1 FROM model_binding_provider_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.created_at_ms <= NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_TIME_ROLLBACK: terminal outcome precedes intent');
    END;

    CREATE TRIGGER trg_model_binding_provider_claim_release
    AFTER INSERT ON model_binding_provider_attempts
    BEGIN
      DELETE FROM model_binding_provider_claims
      WHERE operation_id = NEW.operation_id
        AND claim_token = NEW.claim_token
        AND fencing_revision = NEW.fencing_revision;
    END;

    CREATE TRIGGER trg_model_binding_operation_provider_lineage
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1 FROM model_binding_provider_operations provider
      WHERE provider.request_key = NEW.request_key
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.request_key = NEW.request_key
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND NEW.operation_kind = 'USER_APPLY'
        AND provider.role = NEW.role
        AND provider.expected_binding_revision = NEW.expected_binding_revision
        AND provider.actor = NEW.actor
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND terminal.observed_canonical_name = NEW.target_canonical_name
        AND terminal.observed_digest_sha256 = NEW.target_digest_sha256
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_LINEAGE_MISMATCH: binding does not match provider authority');
    END;

    CREATE TRIGGER trg_model_binding_operation_provider_unresolved_success
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.expected_binding_revision
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
        AND NOT (
          NEW.operation_kind = 'USER_APPLY'
          AND provider.request_key = NEW.request_key
          AND provider.actor = NEW.actor
          AND terminal.observed_canonical_name = NEW.target_canonical_name
          AND terminal.observed_digest_sha256 = NEW.target_digest_sha256
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS: resolve or explicitly supersede the earlier provider success before changing the binding');
    END;

    CREATE TRIGGER trg_model_binding_operation_provider_pending
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = NEW.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = NEW.expected_binding_revision
        AND terminal.operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS: binding cannot change during a live provider command');
    END;

    CREATE TRIGGER trg_model_binding_operation_provider_not_superseded
    BEFORE INSERT ON model_binding_operations
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_operations provider
      JOIN model_binding_user_noop_provider_supersedes superseded
        ON superseded.provider_operation_id = provider.operation_id
      WHERE provider.request_key = NEW.request_key
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_COMMAND_SUPERSEDED: provider command was closed by a no-op receipt');
    END;

    CREATE TRIGGER trg_model_binding_provider_operations_append_only_update
    BEFORE UPDATE ON model_binding_provider_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_operations is append-only');
    END;

    CREATE TRIGGER trg_model_binding_provider_operations_append_only_delete
    BEFORE DELETE ON model_binding_provider_operations
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_operations is append-only');
    END;

    CREATE TRIGGER trg_model_binding_provider_attempts_append_only_update
    BEFORE UPDATE ON model_binding_provider_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_attempts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_provider_attempts_append_only_delete
    BEFORE DELETE ON model_binding_provider_attempts
    BEGIN
      SELECT RAISE(ABORT, 'model_binding_provider_attempts is append-only');
    END;

    CREATE TRIGGER trg_model_binding_provider_claims_insert_forbidden
    BEFORE INSERT ON model_binding_provider_claims
    WHEN EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts terminal
      WHERE terminal.operation_id = NEW.operation_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM model_binding_provider_operations operation
      WHERE operation.operation_id = NEW.operation_id
        AND operation.role = NEW.role
        AND operation.provider_origin = NEW.provider_origin
        AND operation.requested_canonical_name = NEW.requested_canonical_name
        AND operation.initial_claim_token = NEW.claim_token
        AND NEW.fencing_revision = 1
        AND operation.initial_claim_expires_at_ms = NEW.lease_expires_at_ms
        AND operation.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_PROVIDER_CLAIM_AUTHORITY: claim must originate with provider intent');
    END;
  `);
}
