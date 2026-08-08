// Migration 046 — desired model bindings, digest-bound proofs, failover state,
// and append-only audit. This migration creates storage only; no runtime path
// consumes it until the later B3 coordinator checkpoint is proven.

export const version = '2026_08_08_046_model_failover';
export const description = 'Add versioned desired bindings and audited model failover state';

const ROLES = `'D1','D2','CODE','R1','R2','CHAT','VISION'`;
const SUITES = `'reasoning','code','chat','vision','review'`;
const STATES = `'DETECTED','ACTIVATED','FAILED','RESTORED','SUPERSEDED_BY_USER'`;
const EVENT_TYPES = `
  'DESIRED_OBSERVED','DESIRED_CHANGED','DETECTED',
  'ACTIVATION_CLAIMED','ACTIVATED','ACTIVATION_FAILED',
  'RESTORE_CLAIMED','RESTORED','RESTORE_FAILED',
  'REAPPLY_CLAIMED','REAPPLIED','REAPPLY_FAILED',
  'CLAIM_EXPIRED','SUPERSEDED_BY_USER'
`;
const FAILURE_PHASES = `'VERIFICATION','PERSISTENCE','RUNTIME_APPLY','RESTORE','REHYDRATE'`;

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_failover_proofs (
      proof_id TEXT PRIMARY KEY
        CHECK (length(trim(proof_id)) BETWEEN 16 AND 128),
      validation_run_id TEXT NOT NULL
        CHECK (length(trim(validation_run_id)) BETWEEN 1 AND 128),
      role TEXT NOT NULL CHECK (role IN (${ROLES})),
      suite TEXT NOT NULL CHECK (suite IN (${SUITES})),
      role_contract_sha256 TEXT NOT NULL
        CHECK (
          length(role_contract_sha256) = 64
          AND role_contract_sha256 = lower(role_contract_sha256)
          AND role_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      model_canonical_name TEXT NOT NULL
        CHECK (length(trim(model_canonical_name)) BETWEEN 1 AND 512),
      model_digest_sha256 TEXT NOT NULL
        CHECK (
          length(model_digest_sha256) = 64
          AND model_digest_sha256 = lower(model_digest_sha256)
          AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      validation_version TEXT NOT NULL
        CHECK (length(trim(validation_version)) BETWEEN 1 AND 64),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
      required_score REAL NOT NULL CHECK (required_score > 0 AND required_score <= 1),
      passed_count INTEGER NOT NULL
        CHECK (typeof(passed_count) = 'integer' AND passed_count >= 0),
      required_passed_count INTEGER NOT NULL
        CHECK (typeof(required_passed_count) = 'integer' AND required_passed_count >= 1),
      total_count INTEGER NOT NULL
        CHECK (typeof(total_count) = 'integer' AND total_count > 0),
      duration_ms INTEGER NOT NULL
        CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
      result TEXT NOT NULL CHECK (result = 'PASS'),
      inventory_before_name TEXT NOT NULL
        CHECK (length(trim(inventory_before_name)) BETWEEN 1 AND 512),
      inventory_before_digest TEXT NOT NULL,
      inventory_after_name TEXT NOT NULL
        CHECK (length(trim(inventory_after_name)) BETWEEN 1 AND 512),
      inventory_after_digest TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL
        CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms > 0),
      completed_at_ms INTEGER NOT NULL
        CHECK (typeof(completed_at_ms) = 'integer' AND completed_at_ms >= started_at_ms),
      expires_at_ms INTEGER NOT NULL
        CHECK (typeof(expires_at_ms) = 'integer' AND expires_at_ms > completed_at_ms),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(validation_run_id, role),
      CHECK (
        (role IN ('D1','D2','R1') AND suite = 'reasoning')
        OR (role = 'CODE' AND suite = 'code')
        OR (role = 'R2' AND suite = 'review')
        OR (role = 'CHAT' AND suite = 'chat')
        OR (role = 'VISION' AND suite = 'vision')
      ),
      CHECK (passed_count <= total_count),
      CHECK (required_passed_count <= total_count),
      CHECK (score >= required_score),
      CHECK (passed_count >= required_passed_count),
      CHECK (inventory_before_digest = model_digest_sha256),
      CHECK (inventory_after_digest = model_digest_sha256),
      CHECK (created_at_ms >= completed_at_ms)
    );

    CREATE INDEX IF NOT EXISTS idx_model_failover_proof_eligibility
      ON model_failover_proofs(role, model_digest_sha256, expires_at_ms DESC);

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_proofs_append_only_update
    BEFORE UPDATE ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proofs is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_proofs_append_only_delete
    BEFORE DELETE ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proofs is append-only');
    END;

    CREATE TABLE IF NOT EXISTS model_failover_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(event_id)) BETWEEN 1 AND 128),
      event_type TEXT NOT NULL CHECK (event_type IN (${EVENT_TYPES})),
      role TEXT NOT NULL CHECK (role IN (${ROLES})),
      binding_revision INTEGER NOT NULL
        CHECK (typeof(binding_revision) = 'integer' AND binding_revision >= 1),
      row_version INTEGER
        CHECK (row_version IS NULL OR (typeof(row_version) = 'integer' AND row_version >= 1)),
      episode_id TEXT
        CHECK (episode_id IS NULL OR length(trim(episode_id)) BETWEEN 1 AND 128),
      operation_id TEXT
        CHECK (operation_id IS NULL OR length(trim(operation_id)) BETWEEN 1 AND 128),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      state_before TEXT CHECK (state_before IS NULL OR state_before IN (${STATES})),
      state_after TEXT CHECK (state_after IS NULL OR state_after IN (${STATES})),
      desired_model_name TEXT
        CHECK (desired_model_name IS NULL OR length(trim(desired_model_name)) BETWEEN 1 AND 512),
      desired_digest_sha256 TEXT
        CHECK (
          desired_digest_sha256 IS NULL OR (
            length(desired_digest_sha256) = 64
            AND desired_digest_sha256 = lower(desired_digest_sha256)
            AND desired_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      fallback_model_name TEXT
        CHECK (fallback_model_name IS NULL OR length(trim(fallback_model_name)) BETWEEN 1 AND 512),
      fallback_canonical_name TEXT
        CHECK (fallback_canonical_name IS NULL OR length(trim(fallback_canonical_name)) BETWEEN 1 AND 512),
      fallback_digest_sha256 TEXT
        CHECK (
          fallback_digest_sha256 IS NULL OR (
            length(fallback_digest_sha256) = 64
            AND fallback_digest_sha256 = lower(fallback_digest_sha256)
            AND fallback_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      proof_id TEXT REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      verified INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(verified) = 'integer' AND verified IN (0, 1)),
      failure_phase TEXT
        CHECK (failure_phase IS NULL OR failure_phase IN (${FAILURE_PHASES})),
      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      CHECK ((desired_model_name IS NULL) = (desired_digest_sha256 IS NULL)),
      CHECK (
        (fallback_model_name IS NULL AND fallback_canonical_name IS NULL AND fallback_digest_sha256 IS NULL)
        OR
        (fallback_model_name IS NOT NULL AND fallback_canonical_name IS NOT NULL AND fallback_digest_sha256 IS NOT NULL)
      ),
      CHECK (verified = 0 OR proof_id IS NOT NULL),
      CHECK (
        event_type NOT IN ('ACTIVATED','RESTORED','REAPPLIED')
        OR (verified = 1 AND proof_id IS NOT NULL)
      ),
      CHECK (
        (event_type IN ('ACTIVATION_FAILED','RESTORE_FAILED','REAPPLY_FAILED'))
        = (failure_phase IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_model_failover_event_operation
      ON model_failover_events(operation_id, event_type)
      WHERE operation_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_model_failover_event_role_seq
      ON model_failover_events(role, seq DESC);
    CREATE INDEX IF NOT EXISTS idx_model_failover_event_episode
      ON model_failover_events(episode_id, seq)
      WHERE episode_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_events_terminal_claim
    BEFORE INSERT ON model_failover_events
    WHEN NEW.event_type IN ('ACTIVATED','REAPPLIED','RESTORED') AND NOT EXISTS (
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
        AND state.claim_started_at_ms <= NEW.created_at_ms
        AND state.claim_expires_at_ms >= NEW.created_at_ms
        AND state.policy_version = NEW.policy_version
        AND NEW.state_before = state.state
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND (
          (NEW.event_type = 'ACTIVATED'
            AND state.claim_kind = 'ACTIVATE'
            AND state.state = 'DETECTED'
            AND NEW.state_after = 'ACTIVATED')
          OR
          (NEW.event_type = 'REAPPLIED'
            AND state.claim_kind = 'REAPPLY'
            AND state.state = 'ACTIVATED'
            AND state.active_failover = 1
            AND NEW.state_after = 'ACTIVATED')
          OR
          (NEW.event_type = 'RESTORED'
            AND state.claim_kind = 'RESTORE'
            AND state.state = 'ACTIVATED'
            AND state.active_failover = 1
            AND NEW.state_after = 'RESTORED')
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'terminal failover event requires matching live claim');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_events_fallback_proof
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
        AND proof.expires_at_ms >= NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'verified fallback event requires matching fresh proof');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_events_restore_proof
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
        AND proof.expires_at_ms >= NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'verified restore event requires matching fresh desired proof');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_events_append_only_update
    BEFORE UPDATE ON model_failover_events
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_events is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_events_append_only_delete
    BEFORE DELETE ON model_failover_events
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_events is append-only');
    END;

    CREATE TABLE IF NOT EXISTS model_desired_bindings (
      role TEXT PRIMARY KEY CHECK (role IN (${ROLES})),
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
      binding_revision INTEGER NOT NULL
        CHECK (typeof(binding_revision) = 'integer' AND binding_revision >= 1),
      source TEXT NOT NULL CHECK (source IN (
        'CONFIG_DEFAULT','LEGACY_OVERRIDE','USER_APPLY','USER_ROLLBACK'
      )),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      observed_at_ms INTEGER NOT NULL
        CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms > 0),
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms >= observed_at_ms),
      last_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,

      UNIQUE(role, binding_revision)
    );

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_last_event_insert
    BEFORE INSERT ON model_desired_bindings
    WHEN NOT EXISTS (
      SELECT 1 FROM model_failover_events event
      WHERE event.event_id = NEW.last_event_id
        AND event.event_type IN ('DESIRED_OBSERVED','DESIRED_CHANGED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.binding_revision
        AND event.desired_model_name = NEW.model_name
        AND event.desired_digest_sha256 = NEW.digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'desired binding requires matching audit event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_desired_bindings_last_event_update
    BEFORE UPDATE ON model_desired_bindings
    WHEN NOT EXISTS (
      SELECT 1 FROM model_failover_events event
      WHERE event.event_id = NEW.last_event_id
        AND event.event_type IN ('DESIRED_OBSERVED','DESIRED_CHANGED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.binding_revision
        AND event.desired_model_name = NEW.model_name
        AND event.desired_digest_sha256 = NEW.digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'desired binding requires matching audit event');
    END;

    CREATE TABLE IF NOT EXISTS model_failover_state (
      role TEXT PRIMARY KEY CHECK (role IN (${ROLES})),
      desired_revision INTEGER NOT NULL
        CHECK (typeof(desired_revision) = 'integer' AND desired_revision >= 1),
      episode_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(episode_id)) BETWEEN 1 AND 128),
      state TEXT NOT NULL CHECK (state IN (${STATES})),
      active_failover INTEGER NOT NULL
        CHECK (typeof(active_failover) = 'integer' AND active_failover IN (0, 1)),
      fallback_model_name TEXT
        CHECK (fallback_model_name IS NULL OR length(trim(fallback_model_name)) BETWEEN 1 AND 512),
      fallback_canonical_name TEXT
        CHECK (fallback_canonical_name IS NULL OR length(trim(fallback_canonical_name)) BETWEEN 1 AND 512),
      fallback_digest_sha256 TEXT
        CHECK (
          fallback_digest_sha256 IS NULL OR (
            length(fallback_digest_sha256) = 64
            AND fallback_digest_sha256 = lower(fallback_digest_sha256)
            AND fallback_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      proof_id TEXT REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      active_event_id TEXT
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      actor TEXT NOT NULL
        CHECK (length(trim(actor)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      failure_phase TEXT
        CHECK (failure_phase IS NULL OR failure_phase IN (${FAILURE_PHASES})),
      proof_verified_at_ms INTEGER
        CHECK (
          proof_verified_at_ms IS NULL
          OR (typeof(proof_verified_at_ms) = 'integer' AND proof_verified_at_ms > 0)
        ),
      row_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(row_version) = 'integer' AND row_version >= 1),
      claim_operation_id TEXT UNIQUE
        CHECK (claim_operation_id IS NULL OR length(trim(claim_operation_id)) BETWEEN 1 AND 128),
      claim_token TEXT UNIQUE
        CHECK (claim_token IS NULL OR length(trim(claim_token)) BETWEEN 16 AND 128),
      claim_kind TEXT CHECK (claim_kind IS NULL OR claim_kind IN ('ACTIVATE','RESTORE','REAPPLY')),
      claim_started_at_ms INTEGER,
      claim_expires_at_ms INTEGER,
      detected_at_ms INTEGER NOT NULL
        CHECK (typeof(detected_at_ms) = 'integer' AND detected_at_ms > 0),
      activated_at_ms INTEGER,
      resolved_at_ms INTEGER,
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms >= detected_at_ms),
      last_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,

      FOREIGN KEY(role, desired_revision)
        REFERENCES model_desired_bindings(role, binding_revision)
        ON UPDATE RESTRICT ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED,
      CHECK (
        (fallback_model_name IS NULL AND fallback_canonical_name IS NULL AND fallback_digest_sha256 IS NULL)
        OR
        (fallback_model_name IS NOT NULL AND fallback_canonical_name IS NOT NULL AND fallback_digest_sha256 IS NOT NULL)
      ),
      CHECK (
        active_failover = 0
        OR (
          fallback_model_name IS NOT NULL
          AND proof_id IS NOT NULL
          AND active_event_id IS NOT NULL
          AND proof_verified_at_ms IS NOT NULL
          AND activated_at_ms IS NOT NULL
        )
      ),
      CHECK (state <> 'DETECTED' OR active_failover = 0),
      CHECK (state <> 'ACTIVATED' OR active_failover = 1),
      CHECK (
        state NOT IN ('RESTORED','SUPERSEDED_BY_USER')
        OR (active_failover = 0 AND resolved_at_ms IS NOT NULL)
      ),
      CHECK ((state = 'FAILED') = (failure_phase IS NOT NULL)),
      CHECK (
        (claim_token IS NULL AND claim_operation_id IS NULL AND claim_kind IS NULL
          AND claim_started_at_ms IS NULL AND claim_expires_at_ms IS NULL)
        OR
        (claim_token IS NOT NULL AND claim_operation_id IS NOT NULL AND claim_kind IS NOT NULL
          AND typeof(claim_started_at_ms) = 'integer'
          AND typeof(claim_expires_at_ms) = 'integer'
          AND claim_started_at_ms > 0
          AND claim_expires_at_ms > claim_started_at_ms)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_model_failover_state_active
      ON model_failover_state(active_failover, state);
    CREATE INDEX IF NOT EXISTS idx_model_failover_state_claim_expiry
      ON model_failover_state(claim_expires_at_ms)
      WHERE claim_token IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_last_event_insert
    BEFORE INSERT ON model_failover_state
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.last_event_id
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version = NEW.row_version
        AND event.state_after = NEW.state
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover state requires matching audit event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_last_event_update
    BEFORE UPDATE ON model_failover_state
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.last_event_id
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version = NEW.row_version
        AND event.state_after = NEW.state
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.created_at_ms = NEW.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover state requires matching audit event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_claim_event_insert
    BEFORE INSERT ON model_failover_state
    WHEN (
      NEW.claim_token IS NULL AND EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.event_type IN (
            'ACTIVATION_CLAIMED','RESTORE_CLAIMED','REAPPLY_CLAIMED'
          )
      )
    ) OR (
      NEW.claim_token IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.operation_id = NEW.claim_operation_id
          AND event.created_at_ms = NEW.claim_started_at_ms
          AND (
            (NEW.claim_kind = 'ACTIVATE' AND event.event_type = 'ACTIVATION_CLAIMED')
            OR (NEW.claim_kind = 'RESTORE' AND event.event_type = 'RESTORE_CLAIMED')
            OR (NEW.claim_kind = 'REAPPLY' AND event.event_type = 'REAPPLY_CLAIMED')
          )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover claim requires matching claimed event and tuple');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_claim_event_update
    BEFORE UPDATE ON model_failover_state
    WHEN (
      NEW.claim_token IS NULL AND EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.event_type IN (
            'ACTIVATION_CLAIMED','RESTORE_CLAIMED','REAPPLY_CLAIMED'
          )
      )
    ) OR (
      NEW.claim_token IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM model_failover_events event
        WHERE event.event_id = NEW.last_event_id
          AND event.operation_id = NEW.claim_operation_id
          AND event.created_at_ms = NEW.claim_started_at_ms
          AND (
            (NEW.claim_kind = 'ACTIVATE' AND event.event_type = 'ACTIVATION_CLAIMED')
            OR (NEW.claim_kind = 'RESTORE' AND event.event_type = 'RESTORE_CLAIMED')
            OR (NEW.claim_kind = 'REAPPLY' AND event.event_type = 'REAPPLY_CLAIMED')
          )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'failover claim requires matching claimed event and tuple');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_active_event_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.active_event_id
        AND event.event_type IN ('ACTIVATED','REAPPLIED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version <= NEW.row_version
        AND event.state_after = 'ACTIVATED'
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.fallback_model_name = NEW.fallback_model_name
        AND event.fallback_canonical_name = NEW.fallback_canonical_name
        AND event.fallback_digest_sha256 = NEW.fallback_digest_sha256
        AND event.proof_id = NEW.proof_id
        AND event.verified = 1
        AND event.created_at_ms = NEW.proof_verified_at_ms
        AND NEW.activated_at_ms <= event.created_at_ms
        AND (event.event_type <> 'ACTIVATED' OR NEW.activated_at_ms = event.created_at_ms)
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching terminal activation event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_active_event_update
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_events event
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.desired_revision
      WHERE event.event_id = NEW.active_event_id
        AND event.event_type IN ('ACTIVATED','REAPPLIED')
        AND event.role = NEW.role
        AND event.binding_revision = NEW.desired_revision
        AND event.episode_id = NEW.episode_id
        AND event.row_version <= NEW.row_version
        AND event.state_after = 'ACTIVATED'
        AND event.policy_version = NEW.policy_version
        AND event.desired_model_name = desired.model_name
        AND event.desired_digest_sha256 = desired.digest_sha256
        AND event.fallback_model_name = NEW.fallback_model_name
        AND event.fallback_canonical_name = NEW.fallback_canonical_name
        AND event.fallback_digest_sha256 = NEW.fallback_digest_sha256
        AND event.proof_id = NEW.proof_id
        AND event.verified = 1
        AND event.created_at_ms = NEW.proof_verified_at_ms
        AND NEW.activated_at_ms <= event.created_at_ms
        AND (event.event_type <> 'ACTIVATED' OR NEW.activated_at_ms = event.created_at_ms)
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching terminal activation event');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_active_proof_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms >= NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_model_failover_state_active_proof_update
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms >= NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;
  `);
}
