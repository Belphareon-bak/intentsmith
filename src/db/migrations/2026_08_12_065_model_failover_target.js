// Migration 065 — versioned per-role terminal failover target authority.
//
// Ordinary target changes own one append-only event.  A global settings reset
// instead references the reset's existing model-policy event: all seven target
// tombstones advance in that same transaction without a second audit lineage.

export const version = '2026_08_12_065_model_failover_target';
export const description = 'Add versioned terminal failover target authority';

const ROLES = Object.freeze(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']);
const ROLE_SQL = ROLES.map(role => `'${role}'`).join(', ');
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

export function up(db) {
  const names = [
    'model_failover_target_events',
    'model_failover_targets',
    'model_failover_terminal_intents',
    'model_failover_terminal_finalize_receipts',
    'model_failover_active_proof_expiry_events',
    'model_failover_active_proof_revalidations',
    'model_failover_terminal_supersedes',
    'trg_model_failover_target_event_sequence_authority',
    'trg_model_failover_target_event_sequence_positive',
    'trg_model_failover_target_event_identity_conflict',
    'trg_model_failover_target_event_projection',
    'trg_model_failover_target_event_append_only_update',
    'trg_model_failover_target_event_append_only_delete',
    'trg_model_failover_target_policy_reset_projection',
    'trg_model_failover_target_projection_guard',
    'trg_model_failover_target_projection_insert_forbidden',
    'trg_model_failover_target_projection_delete_forbidden',
    'trg_model_failover_terminal_intent_identity_conflict',
    'trg_model_failover_terminal_intent_projection',
    'trg_model_failover_terminal_intent_append_only_update',
    'trg_model_failover_terminal_intent_append_only_delete',
    'trg_model_failover_terminal_receipt_identity_conflict',
    'trg_model_failover_terminal_receipt_projection',
    'trg_model_failover_terminal_receipt_finalize',
    'trg_model_failover_terminal_receipt_append_only_update',
    'trg_model_failover_terminal_receipt_append_only_delete',
    'trg_model_failover_terminal_state_receipt_projection',
    'trg_model_failover_terminal_event_receipt',
    'trg_model_failover_terminal_unresolved_expiry',
    'trg_model_failover_active_proof_expiry_identity_conflict',
    'trg_model_failover_active_proof_expiry_projection',
    'trg_model_failover_active_proof_expiry_append_only_update',
    'trg_model_failover_active_proof_expiry_append_only_delete',
    'trg_model_failover_active_proof_revalidation_identity_conflict',
    'trg_model_failover_active_proof_revalidation_projection',
    'trg_model_failover_active_proof_revalidation_append_only_update',
    'trg_model_failover_active_proof_revalidation_append_only_delete',
    'trg_model_failover_terminal_supersede_identity_conflict',
    'trg_model_failover_terminal_supersede_projection',
    'trg_model_failover_terminal_supersede_append_only_update',
    'trg_model_failover_terminal_supersede_append_only_delete',
  ];
  const existing = db.prepare(`
    SELECT type, name
    FROM sqlite_master
    WHERE name IN (${names.map(() => '?').join(', ')})
    ORDER BY type, name
  `).all(...names);
  if (existing.length > 0) {
    throw new Error(
      'model failover target objects pre-exist migration authority: '
      + existing.map(row => `${row.type}:${row.name}`).join(','),
    );
  }

  const createdAtMs = Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 1) {
    throw new Error('model failover target migration clock is invalid');
  }

  db.exec(`
    CREATE TABLE model_failover_target_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE
        CHECK (length(event_id) BETWEEN 16 AND 160),
      request_id TEXT NOT NULL UNIQUE
        CHECK (length(request_id) BETWEEN 16 AND 160),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      role TEXT NOT NULL CHECK (role IN (${ROLE_SQL})),
      previous_revision INTEGER NOT NULL
        CHECK (typeof(previous_revision) = 'integer'
          AND previous_revision BETWEEN 0 AND ${MAX_SAFE_INTEGER - 1}),
      committed_revision INTEGER NOT NULL
        CHECK (typeof(committed_revision) = 'integer'
          AND committed_revision BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
      event_kind TEXT NOT NULL CHECK (event_kind IN ('SET', 'REPLACE', 'CLEAR')),
      actor TEXT NOT NULL CHECK (actor = 'operator:model-failover-target-cli'),
      before_requested_name TEXT,
      before_canonical_name TEXT,
      before_digest_sha256 TEXT,
      after_requested_name TEXT,
      after_canonical_name TEXT,
      after_digest_sha256 TEXT,
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE (role, committed_revision),
      CHECK (committed_revision = previous_revision + 1),
      CHECK (
        (event_kind = 'SET'
          AND before_requested_name IS NULL
          AND before_canonical_name IS NULL
          AND before_digest_sha256 IS NULL
          AND after_requested_name IS NOT NULL
          AND length(after_requested_name) BETWEEN 1 AND 255
          AND after_canonical_name IS NOT NULL
          AND length(after_canonical_name) BETWEEN 1 AND 255
          AND length(after_digest_sha256) = 64
          AND after_digest_sha256 = lower(after_digest_sha256)
          AND after_digest_sha256 NOT GLOB '*[^0-9a-f]*')
        OR
        (event_kind = 'REPLACE'
          AND before_requested_name IS NOT NULL
          AND before_canonical_name IS NOT NULL
          AND length(before_digest_sha256) = 64
          AND before_digest_sha256 = lower(before_digest_sha256)
          AND before_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND after_requested_name IS NOT NULL
          AND length(after_requested_name) BETWEEN 1 AND 255
          AND after_canonical_name IS NOT NULL
          AND length(after_canonical_name) BETWEEN 1 AND 255
          AND length(after_digest_sha256) = 64
          AND after_digest_sha256 = lower(after_digest_sha256)
          AND after_digest_sha256 NOT GLOB '*[^0-9a-f]*')
        OR
        (event_kind = 'CLEAR'
          AND before_requested_name IS NOT NULL
          AND before_canonical_name IS NOT NULL
          AND length(before_digest_sha256) = 64
          AND before_digest_sha256 = lower(before_digest_sha256)
          AND before_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND after_requested_name IS NULL
          AND after_canonical_name IS NULL
          AND after_digest_sha256 IS NULL)
      )
    );

    CREATE TABLE model_failover_targets (
      role TEXT PRIMARY KEY CHECK (role IN (${ROLE_SQL})),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      revision INTEGER NOT NULL
        CHECK (typeof(revision) = 'integer'
          AND revision BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
      requested_name TEXT,
      canonical_name TEXT,
      digest_sha256 TEXT,
      actor TEXT NOT NULL,
      authority_source TEXT NOT NULL
        CHECK (authority_source IN ('MIGRATION', 'TARGET_EVENT', 'GLOBAL_RESET')),
      last_target_event_id TEXT UNIQUE
        REFERENCES model_failover_target_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      last_policy_event_id TEXT
        REFERENCES model_automation_policy_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms > 0),

      CHECK (
        (requested_name IS NULL
          AND canonical_name IS NULL
          AND digest_sha256 IS NULL)
        OR
        (requested_name IS NOT NULL
          AND length(requested_name) BETWEEN 1 AND 255
          AND canonical_name IS NOT NULL
          AND length(canonical_name) BETWEEN 1 AND 255
          AND length(digest_sha256) = 64
          AND digest_sha256 = lower(digest_sha256)
          AND digest_sha256 NOT GLOB '*[^0-9a-f]*')
      ),
      CHECK (
        (authority_source = 'MIGRATION'
          AND revision = 0
          AND actor = 'system:migration-065'
          AND last_target_event_id IS NULL
          AND last_policy_event_id IS NULL
          AND requested_name IS NULL)
        OR
        (authority_source = 'TARGET_EVENT'
          AND revision >= 1
          AND actor = 'operator:model-failover-target-cli'
          AND last_target_event_id IS NOT NULL
          AND last_policy_event_id IS NULL)
        OR
        (authority_source = 'GLOBAL_RESET'
          AND revision >= 1
          AND actor = 'user:global-reset'
          AND last_target_event_id IS NULL
          AND last_policy_event_id IS NOT NULL
          AND requested_name IS NULL)
      )
    );

    CREATE TABLE model_failover_terminal_intents (
      operation_id TEXT PRIMARY KEY
        CHECK (length(operation_id) BETWEEN 1 AND 128),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      claim_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      role TEXT NOT NULL CHECK (role IN (${ROLE_SQL})),
      operation_kind TEXT NOT NULL
        CHECK (operation_kind IN ('ACTIVATE', 'REAPPLY', 'RESTORE')),
      episode_id TEXT NOT NULL CHECK (length(episode_id) BETWEEN 1 AND 128),
      desired_revision INTEGER NOT NULL
        CHECK (typeof(desired_revision) = 'integer' AND desired_revision >= 1),
      claimed_row_version INTEGER NOT NULL
        CHECK (typeof(claimed_row_version) = 'integer' AND claimed_row_version >= 2),
      policy_revision INTEGER NOT NULL
        CHECK (typeof(policy_revision) = 'integer' AND policy_revision >= 1),
      policy_event_id TEXT NOT NULL
        REFERENCES model_automation_policy_events(event_id) ON DELETE RESTRICT,
      policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
      role_contract_sha256 TEXT NOT NULL
        CHECK (length(role_contract_sha256) = 64
          AND role_contract_sha256 = lower(role_contract_sha256)
          AND role_contract_sha256 NOT GLOB '*[^0-9a-f]*'),
      target_revision INTEGER NOT NULL
        CHECK (typeof(target_revision) = 'integer' AND target_revision >= 1),
      target_requested_name TEXT NOT NULL CHECK (length(target_requested_name) BETWEEN 1 AND 255),
      target_canonical_name TEXT NOT NULL CHECK (length(target_canonical_name) BETWEEN 1 AND 255),
      target_digest_sha256 TEXT NOT NULL
        CHECK (length(target_digest_sha256) = 64
          AND target_digest_sha256 = lower(target_digest_sha256)
          AND target_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      desired_model_name TEXT NOT NULL CHECK (length(desired_model_name) BETWEEN 1 AND 512),
      desired_canonical_name TEXT NOT NULL CHECK (length(desired_canonical_name) BETWEEN 1 AND 512),
      desired_digest_sha256 TEXT NOT NULL
        CHECK (length(desired_digest_sha256) = 64
          AND desired_digest_sha256 = lower(desired_digest_sha256)
          AND desired_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      effect_model_name TEXT NOT NULL CHECK (length(effect_model_name) BETWEEN 1 AND 512),
      effect_canonical_name TEXT NOT NULL CHECK (length(effect_canonical_name) BETWEEN 1 AND 512),
      effect_digest_sha256 TEXT NOT NULL
        CHECK (length(effect_digest_sha256) = 64
          AND effect_digest_sha256 = lower(effect_digest_sha256)
          AND effect_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      observed_inventory_requested_name TEXT NOT NULL
        CHECK (length(observed_inventory_requested_name) BETWEEN 1 AND 512),
      observed_inventory_canonical_name TEXT NOT NULL
        CHECK (length(observed_inventory_canonical_name) BETWEEN 1 AND 512),
      observed_inventory_digest_sha256 TEXT NOT NULL
        CHECK (length(observed_inventory_digest_sha256) = 64
          AND observed_inventory_digest_sha256 = lower(observed_inventory_digest_sha256)
          AND observed_inventory_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      proof_id TEXT NOT NULL REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      proof_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(proof_expires_at_ms) = 'integer' AND proof_expires_at_ms > 0),
      expected_runtime_model_name TEXT NOT NULL
        CHECK (length(expected_runtime_model_name) BETWEEN 1 AND 512),
      expected_runtime_canonical_name TEXT NOT NULL
        CHECK (length(expected_runtime_canonical_name) BETWEEN 1 AND 512),
      expected_runtime_digest_sha256 TEXT NOT NULL
        CHECK (length(expected_runtime_digest_sha256) = 64
          AND expected_runtime_digest_sha256 = lower(expected_runtime_digest_sha256)
          AND expected_runtime_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      expected_runtime_incarnation_id TEXT NOT NULL
        CHECK (length(expected_runtime_incarnation_id) BETWEEN 16 AND 160),
      expected_runtime_generation INTEGER NOT NULL
        CHECK (typeof(expected_runtime_generation) = 'integer'
          AND expected_runtime_generation BETWEEN 0 AND ${MAX_SAFE_INTEGER - 1}),
      claim_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(claim_expires_at_ms) = 'integer' AND claim_expires_at_ms > 0),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(role, episode_id, claimed_row_version),
      CHECK (proof_expires_at_ms > created_at_ms),
      CHECK (claim_expires_at_ms > created_at_ms),
      CHECK (observed_inventory_requested_name = effect_model_name
        AND observed_inventory_canonical_name = effect_canonical_name
        AND observed_inventory_digest_sha256 = effect_digest_sha256),
      CHECK (
        (operation_kind IN ('ACTIVATE', 'REAPPLY')
          AND effect_model_name = target_requested_name
          AND effect_canonical_name = target_canonical_name
          AND effect_digest_sha256 = target_digest_sha256)
        OR
        (operation_kind = 'RESTORE'
          AND effect_model_name = desired_model_name
          AND effect_canonical_name = desired_canonical_name
          AND effect_digest_sha256 = desired_digest_sha256)
      )
    ) WITHOUT ROWID;

    CREATE TABLE model_failover_terminal_finalize_receipts (
      receipt_id TEXT PRIMARY KEY CHECK (length(receipt_id) BETWEEN 1 AND 128),
      operation_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_terminal_intents(operation_id) ON DELETE RESTRICT,
      resolution TEXT NOT NULL CHECK (resolution IN (
        'DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED',
        'EFFECT_FAILED', 'RECONCILED_NO_EFFECT'
      )),
      terminal_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      terminal_event_type TEXT NOT NULL CHECK (terminal_event_type IN (
        'ACTIVATED', 'REAPPLIED', 'RESTORED',
        'ACTIVATION_FAILED', 'REAPPLY_FAILED', 'RESTORE_FAILED'
      )),
      terminal_row_version INTEGER NOT NULL
        CHECK (typeof(terminal_row_version) = 'integer' AND terminal_row_version >= 3),
      runtime_incarnation_before TEXT NOT NULL
        CHECK (length(runtime_incarnation_before) BETWEEN 16 AND 160),
      runtime_incarnation_after TEXT NOT NULL
        CHECK (length(runtime_incarnation_after) BETWEEN 16 AND 160),
      runtime_generation_before INTEGER NOT NULL
        CHECK (typeof(runtime_generation_before) = 'integer'
          AND runtime_generation_before BETWEEN 0 AND ${MAX_SAFE_INTEGER - 1}),
      runtime_generation_after INTEGER NOT NULL
        CHECK (typeof(runtime_generation_after) = 'integer'
          AND runtime_generation_after BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
      runtime_from_model_name TEXT NOT NULL CHECK (length(runtime_from_model_name) BETWEEN 1 AND 512),
      runtime_from_canonical_name TEXT NOT NULL CHECK (length(runtime_from_canonical_name) BETWEEN 1 AND 512),
      runtime_from_digest_sha256 TEXT NOT NULL
        CHECK (length(runtime_from_digest_sha256) = 64
          AND runtime_from_digest_sha256 = lower(runtime_from_digest_sha256)
          AND runtime_from_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      runtime_to_model_name TEXT NOT NULL CHECK (length(runtime_to_model_name) BETWEEN 1 AND 512),
      runtime_to_canonical_name TEXT NOT NULL CHECK (length(runtime_to_canonical_name) BETWEEN 1 AND 512),
      runtime_to_digest_sha256 TEXT NOT NULL
        CHECK (length(runtime_to_digest_sha256) = 64
          AND runtime_to_digest_sha256 = lower(runtime_to_digest_sha256)
          AND runtime_to_digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      runtime_changed INTEGER NOT NULL
        CHECK (typeof(runtime_changed) = 'integer' AND runtime_changed IN (0, 1)),
      failure_phase TEXT CHECK (failure_phase IS NULL OR failure_phase IN ('RUNTIME_APPLY', 'RESTORE')),
      failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 3 AND 96),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      CHECK (
        (resolution = 'DIRECT_CONFIRMED'
          AND terminal_event_type IN ('ACTIVATED', 'REAPPLIED', 'RESTORED')
          AND failure_phase IS NULL AND failure_code IS NULL
          AND runtime_incarnation_after = runtime_incarnation_before
          AND runtime_generation_after = runtime_generation_before + 1)
        OR
        (resolution = 'EFFECT_FAILED'
          AND terminal_event_type IN ('ACTIVATION_FAILED', 'REAPPLY_FAILED', 'RESTORE_FAILED')
          AND failure_phase IS NOT NULL AND failure_code IS NOT NULL
          AND runtime_changed = 0
          AND runtime_incarnation_after = runtime_incarnation_before
          AND runtime_generation_after = runtime_generation_before)
        OR
        (resolution = 'RECONCILED_CONFIRMED'
          AND terminal_event_type IN ('ACTIVATED', 'REAPPLIED', 'RESTORED')
          AND failure_phase IS NULL AND failure_code IS NULL)
        OR
        (resolution = 'RECONCILED_NO_EFFECT'
          AND terminal_event_type IN ('ACTIVATION_FAILED', 'REAPPLY_FAILED', 'RESTORE_FAILED')
          AND failure_phase IS NOT NULL AND failure_code IS NOT NULL
          AND runtime_changed = 0)
      )
    ) WITHOUT ROWID;

    CREATE TABLE model_failover_active_proof_expiry_events (
      expiry_event_id TEXT PRIMARY KEY CHECK (length(expiry_event_id) BETWEEN 1 AND 128),
      active_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN (${ROLE_SQL})),
      episode_id TEXT NOT NULL CHECK (length(episode_id) BETWEEN 1 AND 128),
      desired_revision INTEGER NOT NULL
        CHECK (typeof(desired_revision) = 'integer' AND desired_revision >= 1),
      observed_row_version INTEGER NOT NULL
        CHECK (typeof(observed_row_version) = 'integer' AND observed_row_version >= 1),
      proof_id TEXT NOT NULL REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      proof_expires_at_ms INTEGER NOT NULL
        CHECK (typeof(proof_expires_at_ms) = 'integer' AND proof_expires_at_ms > 0),
      observed_at_ms INTEGER NOT NULL
        CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms > 0),
      CHECK (observed_at_ms >= proof_expires_at_ms),
      UNIQUE(active_event_id, proof_id),
      UNIQUE(role, episode_id, observed_row_version, proof_id)
    ) WITHOUT ROWID;

    CREATE TABLE model_failover_active_proof_revalidations (
      revalidation_id TEXT PRIMARY KEY CHECK (length(revalidation_id) BETWEEN 1 AND 128),
      expiry_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_active_proof_expiry_events(expiry_event_id)
        ON DELETE RESTRICT,
      active_event_id TEXT NOT NULL
        REFERENCES model_failover_events(event_id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN (${ROLE_SQL})),
      episode_id TEXT NOT NULL CHECK (length(episode_id) BETWEEN 1 AND 128),
      desired_revision INTEGER NOT NULL
        CHECK (typeof(desired_revision) = 'integer' AND desired_revision >= 1),
      observed_row_version INTEGER NOT NULL
        CHECK (typeof(observed_row_version) = 'integer' AND observed_row_version >= 1),
      expired_proof_id TEXT NOT NULL
        REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      replacement_proof_id TEXT NOT NULL
        REFERENCES model_failover_proofs(proof_id) ON DELETE RESTRICT,
      policy_revision INTEGER NOT NULL
        CHECK (typeof(policy_revision) = 'integer' AND policy_revision >= 1),
      policy_event_id TEXT NOT NULL
        REFERENCES model_automation_policy_events(event_id) ON DELETE RESTRICT,
      target_revision INTEGER NOT NULL
        CHECK (typeof(target_revision) = 'integer' AND target_revision >= 1),
      role_contract_sha256 TEXT NOT NULL
        CHECK (length(role_contract_sha256) = 64
          AND role_contract_sha256 = lower(role_contract_sha256)
          AND role_contract_sha256 NOT GLOB '*[^0-9a-f]*'),
      actor TEXT NOT NULL CHECK (actor = 'operator:model-failover-proof-revalidation'),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      UNIQUE(active_event_id, replacement_proof_id),
      CHECK (expired_proof_id <> replacement_proof_id)
    ) WITHOUT ROWID;

    CREATE TABLE model_failover_terminal_supersedes (
      terminal_operation_id TEXT PRIMARY KEY
        REFERENCES model_failover_terminal_intents(operation_id) ON DELETE RESTRICT,
      binding_operation_id TEXT NOT NULL UNIQUE
        REFERENCES model_binding_operations(operation_id) ON DELETE RESTRICT,
      supersede_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_failover_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      role TEXT NOT NULL CHECK (role IN (${ROLE_SQL})),
      episode_id TEXT NOT NULL CHECK (length(episode_id) BETWEEN 1 AND 128),
      terminal_row_version INTEGER NOT NULL
        CHECK (typeof(terminal_row_version) = 'integer' AND terminal_row_version >= 2),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0)
    ) WITHOUT ROWID;
  `);

  const seed = db.prepare(`
    INSERT INTO model_failover_targets (
      role, revision, requested_name, canonical_name, digest_sha256,
      actor, authority_source, last_target_event_id, last_policy_event_id,
      updated_at_ms
    ) VALUES (?, 0, NULL, NULL, NULL, 'system:migration-065', 'MIGRATION',
      NULL, NULL, ?)
  `);
  for (const role of ROLES) seed.run(role, createdAtMs);

  db.exec(`
    CREATE TRIGGER trg_model_failover_target_event_sequence_authority
    BEFORE INSERT ON model_failover_target_events
    WHEN NEW.seq <> -1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_EVENT_SEQUENCE_AUTHORITY: target event sequence is database assigned');
    END;

    CREATE TRIGGER trg_model_failover_target_event_sequence_positive
    AFTER INSERT ON model_failover_target_events
    WHEN NEW.seq <= 0
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_EVENT_SEQUENCE_AUTHORITY: target event sequence must be positive');
    END;

    CREATE TRIGGER trg_model_failover_target_event_identity_conflict
    BEFORE INSERT ON model_failover_target_events
    WHEN EXISTS (
      SELECT 1 FROM model_failover_target_events existing
      WHERE existing.seq = NEW.seq
         OR existing.event_id = NEW.event_id
         OR existing.request_id = NEW.request_id
         OR (existing.role = NEW.role
           AND existing.committed_revision = NEW.committed_revision)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_EVENT_IDENTITY_CONFLICT: append-only identity exists');
    END;

    CREATE TRIGGER trg_model_failover_target_event_projection
    BEFORE INSERT ON model_failover_target_events
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_targets target
      WHERE target.role = NEW.role
        AND target.schema_version = NEW.schema_version
        AND target.revision = NEW.committed_revision
        AND target.actor = NEW.actor
        AND target.authority_source = 'TARGET_EVENT'
        AND target.last_target_event_id = NEW.event_id
        AND target.last_policy_event_id IS NULL
        AND target.updated_at_ms = NEW.created_at_ms
        AND target.requested_name IS NEW.after_requested_name
        AND target.canonical_name IS NEW.after_canonical_name
        AND target.digest_sha256 IS NEW.after_digest_sha256
        AND (
          (NEW.previous_revision = 0
            AND NEW.before_requested_name IS NULL
            AND NEW.before_canonical_name IS NULL
            AND NEW.before_digest_sha256 IS NULL)
          OR EXISTS (
            SELECT 1 FROM model_failover_target_events previous
            WHERE previous.role = NEW.role
              AND previous.committed_revision = NEW.previous_revision
              AND previous.after_requested_name IS NEW.before_requested_name
              AND previous.after_canonical_name IS NEW.before_canonical_name
              AND previous.after_digest_sha256 IS NEW.before_digest_sha256
          )
          OR (NOT EXISTS (
              SELECT 1 FROM model_failover_target_events previous
              WHERE previous.role = NEW.role
                AND previous.committed_revision = NEW.previous_revision
            )
            AND NEW.before_requested_name IS NULL
            AND NEW.before_canonical_name IS NULL
            AND NEW.before_digest_sha256 IS NULL)
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_EVENT_PROJECTION_MISMATCH: event lacks exact projection');
    END;

    CREATE TRIGGER trg_model_failover_target_event_append_only_update
    BEFORE UPDATE ON model_failover_target_events
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_EVENT_APPEND_ONLY: events cannot be updated');
    END;

    CREATE TRIGGER trg_model_failover_target_event_append_only_delete
    BEFORE DELETE ON model_failover_target_events
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_EVENT_APPEND_ONLY: events cannot be deleted');
    END;

    CREATE TRIGGER trg_model_failover_target_policy_reset_projection
    BEFORE INSERT ON model_automation_policy_events
    WHEN NEW.event_kind = 'GLOBAL_RESET' AND NOT (
      NEW.actor = 'user:global-reset'
      AND NEW.source = 'GLOBAL_RESET'
      AND NEW.after_auto_failover_enabled = 0
      AND NEW.after_auto_cleanup_enabled = 0
      AND NEW.after_auto_cleanup_days = 14
      AND 7 = (
        SELECT COUNT(*)
        FROM model_failover_targets target
        WHERE target.authority_source = 'GLOBAL_RESET'
          AND target.actor = NEW.actor
          AND target.last_target_event_id IS NULL
          AND target.last_policy_event_id = NEW.event_id
          AND target.updated_at_ms = NEW.created_at_ms
          AND target.requested_name IS NULL
          AND target.canonical_name IS NULL
          AND target.digest_sha256 IS NULL
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_RESET_PROJECTION_MISMATCH: reset must clear every target');
    END;

    CREATE TRIGGER trg_model_failover_target_projection_insert_forbidden
    BEFORE INSERT ON model_failover_targets
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_INSERT_FORBIDDEN: role tombstones already exist');
    END;

    CREATE TRIGGER trg_model_failover_target_projection_delete_forbidden
    BEFORE DELETE ON model_failover_targets
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_DELETE_FORBIDDEN: target tombstones are durable');
    END;

    CREATE TRIGGER trg_model_failover_target_projection_guard
    BEFORE UPDATE ON model_failover_targets
    WHEN NOT (
      NEW.role = OLD.role
      AND NEW.schema_version = 1
      AND OLD.revision < ${MAX_SAFE_INTEGER}
      AND NEW.revision = OLD.revision + 1
      AND NEW.updated_at_ms > 0
      AND (
        (OLD.authority_source = 'MIGRATION'
          AND OLD.revision = 0
          AND OLD.actor = 'system:migration-065'
          AND OLD.last_target_event_id IS NULL
          AND OLD.last_policy_event_id IS NULL
          AND OLD.requested_name IS NULL)
        OR
        (OLD.authority_source = 'TARGET_EVENT'
          AND EXISTS (
            SELECT 1 FROM model_failover_target_events old_event
            WHERE old_event.event_id = OLD.last_target_event_id
              AND old_event.role = OLD.role
              AND old_event.committed_revision = OLD.revision
              AND old_event.actor = OLD.actor
              AND old_event.after_requested_name IS OLD.requested_name
              AND old_event.after_canonical_name IS OLD.canonical_name
              AND old_event.after_digest_sha256 IS OLD.digest_sha256
              AND old_event.created_at_ms = OLD.updated_at_ms
          ))
        OR
        (OLD.authority_source = 'GLOBAL_RESET'
          AND EXISTS (
            SELECT 1 FROM model_automation_policy_events old_reset
            WHERE old_reset.event_id = OLD.last_policy_event_id
              AND old_reset.event_kind = 'GLOBAL_RESET'
              AND old_reset.actor = OLD.actor
              AND old_reset.source = 'GLOBAL_RESET'
              AND old_reset.created_at_ms = OLD.updated_at_ms
              AND OLD.requested_name IS NULL
              AND OLD.canonical_name IS NULL
              AND OLD.digest_sha256 IS NULL
          ))
      )
      AND (
        (NEW.authority_source = 'TARGET_EVENT'
          AND NEW.actor = 'operator:model-failover-target-cli'
          AND NEW.last_target_event_id IS NOT NULL
          AND NEW.last_policy_event_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM model_failover_target_events new_event
            WHERE new_event.event_id = NEW.last_target_event_id
          ))
        OR
        (NEW.authority_source = 'GLOBAL_RESET'
          AND NEW.actor = 'user:global-reset'
          AND NEW.last_target_event_id IS NULL
          AND NEW.last_policy_event_id IS NOT NULL
          AND NEW.last_policy_event_id IS NOT OLD.last_policy_event_id
          AND NEW.requested_name IS NULL
          AND NEW.canonical_name IS NULL
          AND NEW.digest_sha256 IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM model_automation_policy_events existing_reset
            WHERE existing_reset.event_id = NEW.last_policy_event_id
          )
          AND EXISTS (
            SELECT 1
            FROM model_automation_policy policy
            WHERE policy.id = 1
              AND policy.last_event_id = NEW.last_policy_event_id
              AND policy.auto_failover_enabled = 0
              AND policy.auto_cleanup_enabled = 0
              AND policy.auto_cleanup_days = 14
              AND policy.updated_at_ms = NEW.updated_at_ms
          ))
      )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TARGET_PROJECTION_MISMATCH: update lacks exact authority');
    END;

    CREATE TRIGGER trg_model_failover_terminal_intent_identity_conflict
    BEFORE INSERT ON model_failover_terminal_intents
    WHEN EXISTS (
      SELECT 1 FROM model_failover_terminal_intents existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.claim_event_id = NEW.claim_event_id
         OR (existing.role = NEW.role
           AND existing.episode_id = NEW.episode_id
           AND existing.claimed_row_version = NEW.claimed_row_version)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_INTENT_IDENTITY_CONFLICT: terminal intent identity exists');
    END;

    CREATE TRIGGER trg_model_failover_terminal_intent_projection
    BEFORE INSERT ON model_failover_terminal_intents
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_state state
      JOIN model_desired_bindings desired
        ON desired.role = state.role
       AND desired.binding_revision = state.desired_revision
      JOIN model_failover_events claim_event
        ON claim_event.event_id = NEW.claim_event_id
      JOIN model_failover_targets target
        ON target.role = state.role
      JOIN model_automation_policy policy
        ON policy.id = 1
      JOIN model_automation_policy_events policy_event
        ON policy_event.event_id = policy.last_event_id
      JOIN model_failover_proofs proof
        ON proof.proof_id = NEW.proof_id
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
       AND artifact.validation_run_id = proof.validation_run_id
       AND artifact.role = proof.role
       AND artifact.role_contract_sha256 = proof.role_contract_sha256
       AND artifact.model_canonical_name = proof.model_canonical_name
       AND artifact.model_digest_sha256 = proof.model_digest_sha256
       AND artifact.policy_version = proof.policy_version
       AND artifact.result = proof.result
       AND artifact.expires_at_ms = proof.expires_at_ms
      WHERE state.role = NEW.role
        AND state.episode_id = NEW.episode_id
        AND state.desired_revision = NEW.desired_revision
        AND state.row_version = NEW.claimed_row_version
        AND state.claim_operation_id = NEW.operation_id
        AND state.claim_kind = NEW.operation_kind
        AND state.claim_token IS NOT NULL
        AND state.claim_started_at_ms = NEW.created_at_ms
        AND state.claim_expires_at_ms = NEW.claim_expires_at_ms
        AND state.claim_expires_at_ms > NEW.created_at_ms
        AND state.last_event_id = NEW.claim_event_id
        AND state.policy_version = NEW.policy_version
        AND claim_event.operation_id = NEW.operation_id
        AND claim_event.role = NEW.role
        AND claim_event.episode_id = NEW.episode_id
        AND claim_event.binding_revision = NEW.desired_revision
        AND claim_event.row_version = NEW.claimed_row_version
        AND claim_event.created_at_ms = NEW.created_at_ms
        AND claim_event.event_type = CASE NEW.operation_kind
          WHEN 'ACTIVATE' THEN 'ACTIVATION_CLAIMED'
          WHEN 'REAPPLY' THEN 'REAPPLY_CLAIMED'
          WHEN 'RESTORE' THEN 'RESTORE_CLAIMED'
        END
        AND desired.model_name = NEW.desired_model_name
        AND desired.canonical_name = NEW.desired_canonical_name
        AND desired.digest_sha256 = NEW.desired_digest_sha256
        AND target.revision = NEW.target_revision
        AND target.authority_source = 'TARGET_EVENT'
        AND target.requested_name = NEW.target_requested_name
        AND target.canonical_name = NEW.target_canonical_name
        AND target.digest_sha256 = NEW.target_digest_sha256
        AND policy.revision = NEW.policy_revision
        AND policy.last_event_id = NEW.policy_event_id
        AND policy.auto_failover_enabled = 1
        AND policy_event.committed_revision = NEW.policy_revision
        AND policy_event.after_auto_failover_enabled = 1
        AND proof.role = NEW.role
        AND proof.policy_version = NEW.policy_version
        AND proof.role_contract_sha256 = NEW.role_contract_sha256
        AND proof.model_name = NEW.effect_model_name
        AND proof.model_canonical_name = NEW.effect_canonical_name
        AND proof.model_digest_sha256 = NEW.effect_digest_sha256
        AND NEW.observed_inventory_requested_name = NEW.effect_model_name
        AND NEW.observed_inventory_canonical_name = NEW.effect_canonical_name
        AND NEW.observed_inventory_digest_sha256 = NEW.effect_digest_sha256
        AND proof.result = 'PASS'
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms = NEW.proof_expires_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND (
          (NEW.operation_kind = 'ACTIVATE'
            AND state.state = 'DETECTED' AND state.active_failover = 0
            AND state.fallback_model_name IS NULL
            AND NEW.expected_runtime_model_name = desired.model_name
            AND NEW.expected_runtime_canonical_name = desired.canonical_name
            AND NEW.expected_runtime_digest_sha256 = desired.digest_sha256)
          OR
          (NEW.operation_kind IN ('REAPPLY', 'RESTORE')
            AND state.state = 'ACTIVATED' AND state.active_failover = 1
            AND NEW.expected_runtime_model_name = state.fallback_model_name
            AND NEW.expected_runtime_canonical_name = state.fallback_canonical_name
            AND NEW.expected_runtime_digest_sha256 = state.fallback_digest_sha256
            AND (NEW.operation_kind <> 'REAPPLY' OR NOT EXISTS (
              SELECT 1
              FROM model_failover_active_proof_expiry_events expiry
              LEFT JOIN model_failover_active_proof_revalidations revalidation
                ON revalidation.expiry_event_id = expiry.expiry_event_id
              WHERE expiry.active_event_id = state.active_event_id
                AND revalidation.revalidation_id IS NULL
            )))
        )
    ) OR EXISTS (
      SELECT 1
      FROM model_failover_terminal_intents pending
      LEFT JOIN model_failover_terminal_finalize_receipts receipt
        ON receipt.operation_id = pending.operation_id
      LEFT JOIN model_failover_terminal_supersedes supersede
        ON supersede.terminal_operation_id = pending.operation_id
      WHERE pending.role = NEW.role
        AND receipt.operation_id IS NULL
        AND supersede.terminal_operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_INTENT_PROJECTION_MISMATCH: intent lacks exact live authority');
    END;

    CREATE TRIGGER trg_model_failover_terminal_intent_append_only_update
    BEFORE UPDATE ON model_failover_terminal_intents
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_TERMINAL_INTENT_APPEND_ONLY: intents cannot be updated');
    END;

    CREATE TRIGGER trg_model_failover_terminal_intent_append_only_delete
    BEFORE DELETE ON model_failover_terminal_intents
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_TERMINAL_INTENT_APPEND_ONLY: intents cannot be deleted');
    END;

    CREATE TRIGGER trg_model_failover_terminal_receipt_identity_conflict
    BEFORE INSERT ON model_failover_terminal_finalize_receipts
    WHEN EXISTS (
      SELECT 1 FROM model_failover_terminal_finalize_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.operation_id = NEW.operation_id
         OR existing.terminal_event_id = NEW.terminal_event_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_RECEIPT_IDENTITY_CONFLICT: terminal receipt identity exists');
    END;

    CREATE TRIGGER trg_model_failover_terminal_receipt_projection
    BEFORE INSERT ON model_failover_terminal_finalize_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_terminal_intents intent
      JOIN model_failover_state state
        ON state.role = intent.role
       AND state.episode_id = intent.episode_id
       AND state.desired_revision = intent.desired_revision
      JOIN model_desired_bindings desired
        ON desired.role = state.role
       AND desired.binding_revision = state.desired_revision
      JOIN model_failover_targets target
        ON target.role = state.role
      JOIN model_automation_policy policy ON policy.id = 1
      JOIN model_failover_proofs proof ON proof.proof_id = intent.proof_id
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
       AND artifact.validation_run_id = proof.validation_run_id
       AND artifact.role = proof.role
       AND artifact.role_contract_sha256 = proof.role_contract_sha256
       AND artifact.model_canonical_name = proof.model_canonical_name
       AND artifact.model_digest_sha256 = proof.model_digest_sha256
       AND artifact.policy_version = proof.policy_version
       AND artifact.result = proof.result
       AND artifact.expires_at_ms = proof.expires_at_ms
      WHERE intent.operation_id = NEW.operation_id
        AND state.row_version = intent.claimed_row_version
        AND state.claim_operation_id = intent.operation_id
        AND state.claim_kind = intent.operation_kind
        AND state.claim_token IS NOT NULL
        AND NEW.terminal_row_version = state.row_version + 1
        AND desired.model_name = intent.desired_model_name
        AND desired.canonical_name = intent.desired_canonical_name
        AND desired.digest_sha256 = intent.desired_digest_sha256
        AND target.revision = intent.target_revision
        AND target.requested_name = intent.target_requested_name
        AND target.canonical_name = intent.target_canonical_name
        AND target.digest_sha256 = intent.target_digest_sha256
        AND policy.revision = intent.policy_revision
        AND policy.last_event_id = intent.policy_event_id
        AND policy.auto_failover_enabled = 1
        AND proof.role = intent.role
        AND proof.policy_version = intent.policy_version
        AND proof.role_contract_sha256 = intent.role_contract_sha256
        AND proof.model_name = intent.effect_model_name
        AND proof.model_canonical_name = intent.effect_canonical_name
        AND proof.model_digest_sha256 = intent.effect_digest_sha256
        AND proof.expires_at_ms = intent.proof_expires_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND intent.observed_inventory_requested_name = intent.effect_model_name
        AND intent.observed_inventory_canonical_name = intent.effect_canonical_name
        AND intent.observed_inventory_digest_sha256 = intent.effect_digest_sha256
        AND NEW.runtime_incarnation_before = intent.expected_runtime_incarnation_id
        AND NEW.runtime_generation_before = intent.expected_runtime_generation
        AND NEW.runtime_from_model_name = intent.expected_runtime_model_name
        AND NEW.runtime_from_canonical_name = intent.expected_runtime_canonical_name
        AND NEW.runtime_from_digest_sha256 = intent.expected_runtime_digest_sha256
        AND NEW.terminal_event_type = CASE
          WHEN NEW.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'ACTIVATE' THEN 'ACTIVATED'
          WHEN NEW.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'REAPPLY' THEN 'REAPPLIED'
          WHEN NEW.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'RESTORE' THEN 'RESTORED'
          WHEN intent.operation_kind = 'ACTIVATE' THEN 'ACTIVATION_FAILED'
          WHEN intent.operation_kind = 'REAPPLY' THEN 'REAPPLY_FAILED'
          WHEN intent.operation_kind = 'RESTORE' THEN 'RESTORE_FAILED'
        END
        AND (
          (NEW.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND NEW.runtime_to_model_name = intent.effect_model_name
            AND NEW.runtime_to_canonical_name = intent.effect_canonical_name
            AND NEW.runtime_to_digest_sha256 = intent.effect_digest_sha256)
          OR
          (NEW.resolution IN ('EFFECT_FAILED', 'RECONCILED_NO_EFFECT')
            AND NEW.runtime_to_model_name = intent.expected_runtime_model_name
            AND NEW.runtime_to_canonical_name = intent.expected_runtime_canonical_name
            AND NEW.runtime_to_digest_sha256 = intent.expected_runtime_digest_sha256)
        )
        AND (NEW.resolution NOT IN ('DIRECT_CONFIRMED', 'EFFECT_FAILED')
          OR state.claim_expires_at_ms > NEW.created_at_ms)
        AND (NEW.resolution NOT IN ('RECONCILED_CONFIRMED', 'RECONCILED_NO_EFFECT')
          OR NEW.runtime_incarnation_after <> NEW.runtime_incarnation_before
          OR NEW.created_at_ms >= state.claim_expires_at_ms)
        AND NOT EXISTS (
          SELECT 1 FROM model_failover_terminal_supersedes supersede
          WHERE supersede.terminal_operation_id = intent.operation_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_RECEIPT_PROJECTION_MISMATCH: receipt lacks exact intent and runtime CAS');
    END;

    CREATE TRIGGER trg_model_failover_terminal_receipt_append_only_update
    BEFORE UPDATE ON model_failover_terminal_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_TERMINAL_RECEIPT_APPEND_ONLY: receipts cannot be updated');
    END;

    CREATE TRIGGER trg_model_failover_terminal_receipt_append_only_delete
    BEFORE DELETE ON model_failover_terminal_finalize_receipts
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_TERMINAL_RECEIPT_APPEND_ONLY: receipts cannot be deleted');
    END;

    DROP TRIGGER trg_model_failover_events_terminal_claim;

    CREATE TRIGGER trg_model_failover_events_terminal_claim
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1 FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type)
    )) AND NEW.event_type IN (
      'ACTIVATED', 'REAPPLIED', 'RESTORED',
      'ACTIVATION_FAILED', 'REAPPLY_FAILED', 'RESTORE_FAILED'
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_failover_terminal_finalize_receipts receipt
      JOIN model_failover_terminal_intents intent
        ON intent.operation_id = receipt.operation_id
      JOIN model_failover_state state
        ON state.role = intent.role
       AND state.episode_id = intent.episode_id
       AND state.desired_revision = intent.desired_revision
      WHERE receipt.terminal_event_id = NEW.event_id
        AND receipt.operation_id = NEW.operation_id
        AND receipt.terminal_event_type = NEW.event_type
        AND receipt.terminal_row_version = NEW.row_version
        AND state.row_version = intent.claimed_row_version
        AND state.claim_operation_id = intent.operation_id
        AND state.claim_kind = intent.operation_kind
        AND state.claim_token IS NOT NULL
        AND NEW.role = intent.role
        AND NEW.episode_id = intent.episode_id
        AND NEW.binding_revision = intent.desired_revision
        AND NEW.created_at_ms = receipt.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_CLAIM_MISMATCH: terminal event requires exact durable receipt');
    END;

    CREATE TRIGGER trg_model_failover_terminal_event_receipt
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1 FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type)
    )) AND NEW.event_type IN (
      'ACTIVATED', 'REAPPLIED', 'RESTORED',
      'ACTIVATION_FAILED', 'REAPPLY_FAILED', 'RESTORE_FAILED'
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_failover_terminal_finalize_receipts receipt
      JOIN model_failover_terminal_intents intent
        ON intent.operation_id = receipt.operation_id
      WHERE receipt.terminal_event_id = NEW.event_id
        AND receipt.operation_id = NEW.operation_id
        AND receipt.terminal_event_type = NEW.event_type
        AND receipt.terminal_row_version = NEW.row_version
        AND NEW.role = intent.role
        AND NEW.binding_revision = intent.desired_revision
        AND NEW.episode_id = intent.episode_id
        AND NEW.actor = 'system:binding-integrity'
        AND NEW.policy_version = intent.policy_version
        AND NEW.desired_model_name = intent.desired_model_name
        AND NEW.desired_digest_sha256 = intent.desired_digest_sha256
        AND NEW.created_at_ms = receipt.created_at_ms
        AND NEW.state_before = CASE intent.operation_kind
          WHEN 'ACTIVATE' THEN 'DETECTED'
          ELSE 'ACTIVATED'
        END
        AND NEW.state_after = CASE
          WHEN receipt.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind IN ('ACTIVATE', 'REAPPLY') THEN 'ACTIVATED'
          WHEN receipt.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'RESTORE' THEN 'RESTORED'
          ELSE 'FAILED'
        END
        AND NEW.reason_code = CASE
          WHEN receipt.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'ACTIVATE' THEN 'FAILOVER_ACTIVATED'
          WHEN receipt.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'REAPPLY' THEN 'FAILOVER_REAPPLIED'
          WHEN receipt.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED')
            AND intent.operation_kind = 'RESTORE' THEN 'DESIRED_MODEL_RESTORED'
          WHEN intent.operation_kind = 'ACTIVATE' THEN 'FAILOVER_ACTIVATION_FAILED'
          WHEN intent.operation_kind = 'REAPPLY' THEN 'FAILOVER_REAPPLY_FAILED'
          WHEN intent.operation_kind = 'RESTORE' THEN 'DESIRED_MODEL_RESTORE_FAILED'
        END
        AND NEW.fallback_model_name IS CASE
          WHEN intent.operation_kind IN ('ACTIVATE', 'REAPPLY')
            THEN intent.target_requested_name ELSE intent.expected_runtime_model_name END
        AND NEW.fallback_canonical_name IS CASE
          WHEN intent.operation_kind IN ('ACTIVATE', 'REAPPLY')
            THEN intent.target_canonical_name ELSE intent.expected_runtime_canonical_name END
        AND NEW.fallback_digest_sha256 IS CASE
          WHEN intent.operation_kind IN ('ACTIVATE', 'REAPPLY')
            THEN intent.target_digest_sha256 ELSE intent.expected_runtime_digest_sha256 END
        AND NEW.proof_id IS intent.proof_id
        AND NEW.verified = CASE
          WHEN receipt.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED') THEN 1 ELSE 0 END
        AND NEW.failure_phase IS receipt.failure_phase
        AND NEW.details_json = json_object(
          'failureCode', receipt.failure_code,
          'resolution', receipt.resolution,
          'runtimeGenerationBefore', receipt.runtime_generation_before,
          'runtimeGenerationAfter', receipt.runtime_generation_after,
          'runtimeIncarnationBefore', receipt.runtime_incarnation_before,
          'runtimeIncarnationAfter', receipt.runtime_incarnation_after
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_EVENT_RECEIPT_MISMATCH: event does not match its receipt');
    END;

    CREATE TRIGGER trg_model_failover_terminal_state_receipt_projection
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.last_event_id <> OLD.last_event_id
      AND NEW.last_event_id IN (
        SELECT terminal_event_id
        FROM model_failover_terminal_finalize_receipts
      )
      AND NOT EXISTS (
        SELECT 1
        FROM model_failover_terminal_finalize_receipts receipt
        JOIN model_failover_terminal_intents intent
          ON intent.operation_id = receipt.operation_id
        JOIN model_failover_events event
          ON event.event_id = receipt.terminal_event_id
        WHERE receipt.terminal_event_id = NEW.last_event_id
          AND receipt.operation_id = OLD.claim_operation_id
          AND receipt.terminal_row_version = NEW.row_version
          AND intent.role = OLD.role
          AND intent.episode_id = OLD.episode_id
          AND intent.desired_revision = OLD.desired_revision
          AND intent.claimed_row_version = OLD.row_version
          AND OLD.claim_operation_id = intent.operation_id
          AND OLD.claim_kind = intent.operation_kind
          AND OLD.claim_token IS NOT NULL
          AND NEW.role = OLD.role
          AND NEW.desired_revision = OLD.desired_revision
          AND NEW.episode_id = OLD.episode_id
          AND NEW.row_version = OLD.row_version + 1
          AND NEW.state = event.state_after
          AND NEW.actor = event.actor
          AND NEW.reason_code = event.reason_code
          AND NEW.failure_phase IS event.failure_phase
          AND NEW.claim_operation_id IS NULL
          AND NEW.claim_token IS NULL
          AND NEW.claim_kind IS NULL
          AND NEW.claim_started_at_ms IS NULL
          AND NEW.claim_expires_at_ms IS NULL
          AND NEW.updated_at_ms = event.created_at_ms
          AND (
            (receipt.terminal_event_type IN ('ACTIVATED', 'REAPPLIED')
              AND NEW.active_failover = 1
              AND NEW.fallback_model_name = intent.effect_model_name
              AND NEW.fallback_canonical_name = intent.effect_canonical_name
              AND NEW.fallback_digest_sha256 = intent.effect_digest_sha256
              AND NEW.proof_id = intent.proof_id
              AND NEW.active_event_id = event.event_id
              AND NEW.proof_verified_at_ms = event.created_at_ms
              AND NEW.resolved_at_ms IS NULL)
            OR
            (receipt.terminal_event_type = 'RESTORED'
              AND NEW.active_failover = 0
              AND NEW.fallback_model_name IS NULL
              AND NEW.fallback_canonical_name IS NULL
              AND NEW.fallback_digest_sha256 IS NULL
              AND NEW.proof_id IS NULL
              AND NEW.active_event_id IS NULL
              AND NEW.proof_verified_at_ms IS NULL
              AND NEW.resolved_at_ms = event.created_at_ms)
            OR
            (receipt.terminal_event_type = 'ACTIVATION_FAILED'
              AND NEW.active_failover = 0
              AND NEW.fallback_model_name IS NULL
              AND NEW.fallback_canonical_name IS NULL
              AND NEW.fallback_digest_sha256 IS NULL
              AND NEW.proof_id IS NULL
              AND NEW.active_event_id IS NULL
              AND NEW.proof_verified_at_ms IS NULL)
            OR
            (receipt.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED')
              AND NEW.active_failover = 1
              AND NEW.fallback_model_name = OLD.fallback_model_name
              AND NEW.fallback_canonical_name = OLD.fallback_canonical_name
              AND NEW.fallback_digest_sha256 = OLD.fallback_digest_sha256
              AND NEW.proof_id = OLD.proof_id
              AND NEW.active_event_id = OLD.active_event_id
              AND NEW.proof_verified_at_ms = OLD.proof_verified_at_ms)
          )
      )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_STATE_RECEIPT_MISMATCH: state does not match terminal receipt');
    END;

    CREATE TRIGGER trg_model_failover_terminal_receipt_finalize
    AFTER INSERT ON model_failover_terminal_finalize_receipts
    BEGIN
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        operation_id, actor, reason_code, policy_version, state_before,
        state_after, desired_model_name, desired_digest_sha256,
        fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
        proof_id, verified, failure_phase, details_json, created_at_ms
      )
      SELECT
        NEW.terminal_event_id,
        NEW.terminal_event_type,
        intent.role,
        intent.desired_revision,
        NEW.terminal_row_version,
        intent.episode_id,
        intent.operation_id,
        'system:binding-integrity',
        CASE NEW.terminal_event_type
          WHEN 'ACTIVATED' THEN 'FAILOVER_ACTIVATED'
          WHEN 'REAPPLIED' THEN 'FAILOVER_REAPPLIED'
          WHEN 'RESTORED' THEN 'DESIRED_MODEL_RESTORED'
          WHEN 'ACTIVATION_FAILED' THEN 'FAILOVER_ACTIVATION_FAILED'
          WHEN 'REAPPLY_FAILED' THEN 'FAILOVER_REAPPLY_FAILED'
          WHEN 'RESTORE_FAILED' THEN 'DESIRED_MODEL_RESTORE_FAILED'
        END,
        intent.policy_version,
        CASE intent.operation_kind WHEN 'ACTIVATE' THEN 'DETECTED' ELSE 'ACTIVATED' END,
        CASE
          WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN 'ACTIVATED'
          WHEN NEW.terminal_event_type = 'RESTORED' THEN 'RESTORED'
          ELSE 'FAILED'
        END,
        intent.desired_model_name,
        intent.desired_digest_sha256,
        CASE
          WHEN intent.operation_kind IN ('ACTIVATE', 'REAPPLY')
            THEN intent.target_requested_name
          ELSE intent.expected_runtime_model_name
        END,
        CASE
          WHEN intent.operation_kind IN ('ACTIVATE', 'REAPPLY')
            THEN intent.target_canonical_name
          ELSE intent.expected_runtime_canonical_name
        END,
        CASE
          WHEN intent.operation_kind IN ('ACTIVATE', 'REAPPLY')
            THEN intent.target_digest_sha256
          ELSE intent.expected_runtime_digest_sha256
        END,
        intent.proof_id,
        CASE
          WHEN NEW.resolution IN ('DIRECT_CONFIRMED', 'RECONCILED_CONFIRMED') THEN 1
          ELSE 0
        END,
        NEW.failure_phase,
        json_object(
          'failureCode', NEW.failure_code,
          'resolution', NEW.resolution,
          'runtimeGenerationBefore', NEW.runtime_generation_before,
          'runtimeGenerationAfter', NEW.runtime_generation_after,
          'runtimeIncarnationBefore', NEW.runtime_incarnation_before,
          'runtimeIncarnationAfter', NEW.runtime_incarnation_after
        ),
        NEW.created_at_ms
      FROM model_failover_terminal_intents intent
      WHERE intent.operation_id = NEW.operation_id;

      SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_FINALIZE_EVENT_CAS_FAILED: receipt did not create one event') END;

      UPDATE model_failover_state
      SET state = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN 'ACTIVATED'
            WHEN NEW.terminal_event_type = 'RESTORED' THEN 'RESTORED'
            ELSE 'FAILED'
          END,
          active_failover = CASE
            WHEN NEW.terminal_event_type IN (
              'ACTIVATED', 'REAPPLIED', 'REAPPLY_FAILED', 'RESTORE_FAILED'
            ) THEN 1
            ELSE 0
          END,
          fallback_model_name = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN (
              SELECT intent.effect_model_name
              FROM model_failover_terminal_intents intent
              WHERE intent.operation_id = NEW.operation_id
            )
            WHEN NEW.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED')
              THEN fallback_model_name
            ELSE NULL
          END,
          fallback_canonical_name = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN (
              SELECT intent.effect_canonical_name
              FROM model_failover_terminal_intents intent
              WHERE intent.operation_id = NEW.operation_id
            )
            WHEN NEW.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED')
              THEN fallback_canonical_name
            ELSE NULL
          END,
          fallback_digest_sha256 = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN (
              SELECT intent.effect_digest_sha256
              FROM model_failover_terminal_intents intent
              WHERE intent.operation_id = NEW.operation_id
            )
            WHEN NEW.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED')
              THEN fallback_digest_sha256
            ELSE NULL
          END,
          proof_id = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN (
              SELECT intent.proof_id
              FROM model_failover_terminal_intents intent
              WHERE intent.operation_id = NEW.operation_id
            )
            WHEN NEW.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED') THEN proof_id
            ELSE NULL
          END,
          active_event_id = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED')
              THEN NEW.terminal_event_id
            WHEN NEW.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED')
              THEN active_event_id
            ELSE NULL
          END,
          actor = 'system:binding-integrity',
          reason_code = CASE NEW.terminal_event_type
            WHEN 'ACTIVATED' THEN 'FAILOVER_ACTIVATED'
            WHEN 'REAPPLIED' THEN 'FAILOVER_REAPPLIED'
            WHEN 'RESTORED' THEN 'DESIRED_MODEL_RESTORED'
            WHEN 'ACTIVATION_FAILED' THEN 'FAILOVER_ACTIVATION_FAILED'
            WHEN 'REAPPLY_FAILED' THEN 'FAILOVER_REAPPLY_FAILED'
            WHEN 'RESTORE_FAILED' THEN 'DESIRED_MODEL_RESTORE_FAILED'
          END,
          failure_phase = NEW.failure_phase,
          proof_verified_at_ms = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN NEW.created_at_ms
            WHEN NEW.terminal_event_type IN ('REAPPLY_FAILED', 'RESTORE_FAILED')
              THEN proof_verified_at_ms
            ELSE NULL
          END,
          row_version = NEW.terminal_row_version,
          claim_operation_id = NULL,
          claim_token = NULL,
          claim_kind = NULL,
          claim_started_at_ms = NULL,
          claim_expires_at_ms = NULL,
          activated_at_ms = CASE
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED')
              THEN COALESCE(activated_at_ms, NEW.created_at_ms)
            ELSE activated_at_ms
          END,
          resolved_at_ms = CASE
            WHEN NEW.terminal_event_type = 'RESTORED' THEN NEW.created_at_ms
            WHEN NEW.terminal_event_type IN ('ACTIVATED', 'REAPPLIED') THEN NULL
            ELSE resolved_at_ms
          END,
          updated_at_ms = NEW.created_at_ms,
          last_event_id = NEW.terminal_event_id
      WHERE EXISTS (
        SELECT 1
        FROM model_failover_terminal_intents intent
        WHERE intent.operation_id = NEW.operation_id
          AND intent.role = model_failover_state.role
          AND intent.desired_revision = model_failover_state.desired_revision
          AND intent.episode_id = model_failover_state.episode_id
          AND intent.claimed_row_version = model_failover_state.row_version
          AND intent.operation_id = model_failover_state.claim_operation_id
          AND intent.operation_kind = model_failover_state.claim_kind
          AND intent.claim_event_id = model_failover_state.last_event_id
          AND model_failover_state.claim_token IS NOT NULL
      );

      SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_FINALIZE_STATE_CAS_FAILED: receipt did not advance one state') END;
    END;

    CREATE TRIGGER trg_model_failover_terminal_unresolved_expiry
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1 FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type)
    )) AND NEW.event_type = 'CLAIM_EXPIRED' AND EXISTS (
      SELECT 1
      FROM model_failover_terminal_intents intent
      LEFT JOIN model_failover_terminal_finalize_receipts receipt
        ON receipt.operation_id = intent.operation_id
      LEFT JOIN model_failover_terminal_supersedes supersede
        ON supersede.terminal_operation_id = intent.operation_id
      WHERE intent.operation_id = NEW.operation_id
        AND receipt.operation_id IS NULL
        AND supersede.terminal_operation_id IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_RECONCILIATION_REQUIRED: unresolved terminal intent cannot expire');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_expiry_identity_conflict
    BEFORE INSERT ON model_failover_active_proof_expiry_events
    WHEN EXISTS (
      SELECT 1 FROM model_failover_active_proof_expiry_events existing
      WHERE existing.expiry_event_id = NEW.expiry_event_id
         OR (existing.active_event_id = NEW.active_event_id
           AND existing.proof_id = NEW.proof_id)
         OR (existing.role = NEW.role AND existing.episode_id = NEW.episode_id
           AND existing.observed_row_version = NEW.observed_row_version
           AND existing.proof_id = NEW.proof_id)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_ACTIVE_PROOF_EXPIRY_IDENTITY_CONFLICT: expiry identity exists');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_expiry_projection
    BEFORE INSERT ON model_failover_active_proof_expiry_events
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_state state
      JOIN model_failover_proofs proof ON proof.proof_id = NEW.proof_id
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
       AND artifact.validation_run_id = proof.validation_run_id
       AND artifact.role = proof.role
       AND artifact.role_contract_sha256 = proof.role_contract_sha256
       AND artifact.model_name = proof.model_name
       AND artifact.model_canonical_name = proof.model_canonical_name
       AND artifact.model_digest_sha256 = proof.model_digest_sha256
       AND artifact.policy_version = proof.policy_version
       AND artifact.result = proof.result
       AND artifact.expires_at_ms = proof.expires_at_ms
      JOIN model_failover_events active ON active.event_id = state.active_event_id
      WHERE state.role = NEW.role
        AND state.episode_id = NEW.episode_id
        AND state.desired_revision = NEW.desired_revision
        AND state.row_version = NEW.observed_row_version
        AND state.active_failover = 1
        AND state.active_event_id = NEW.active_event_id
        AND active.event_type IN ('ACTIVATED', 'REAPPLIED')
        AND active.role = NEW.role
        AND active.episode_id = NEW.episode_id
        AND active.proof_id = state.proof_id
        AND NEW.proof_id = COALESCE((
          SELECT revalidation.replacement_proof_id
          FROM model_failover_active_proof_revalidations revalidation
          WHERE revalidation.active_event_id = state.active_event_id
          ORDER BY revalidation.created_at_ms DESC, revalidation.revalidation_id DESC
          LIMIT 1
        ), state.proof_id)
        AND proof.role = NEW.role
        AND proof.model_name = state.fallback_model_name
        AND proof.model_canonical_name = state.fallback_canonical_name
        AND proof.model_digest_sha256 = state.fallback_digest_sha256
        AND proof.policy_version = state.policy_version
        AND proof.result = 'PASS'
        AND proof.expires_at_ms = NEW.proof_expires_at_ms
        AND proof.expires_at_ms <= NEW.observed_at_ms
        AND NOT EXISTS (
          SELECT 1
          FROM model_failover_active_proof_expiry_events unresolved
          LEFT JOIN model_failover_active_proof_revalidations resolved
            ON resolved.expiry_event_id = unresolved.expiry_event_id
          WHERE unresolved.active_event_id = state.active_event_id
            AND resolved.revalidation_id IS NULL
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_ACTIVE_PROOF_EXPIRY_PROJECTION_MISMATCH: expiry lacks exact active lineage');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_expiry_append_only_update
    BEFORE UPDATE ON model_failover_active_proof_expiry_events
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_ACTIVE_PROOF_EXPIRY_APPEND_ONLY: expiry events cannot be updated');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_expiry_append_only_delete
    BEFORE DELETE ON model_failover_active_proof_expiry_events
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_ACTIVE_PROOF_EXPIRY_APPEND_ONLY: expiry events cannot be deleted');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_revalidation_identity_conflict
    BEFORE INSERT ON model_failover_active_proof_revalidations
    WHEN EXISTS (
      SELECT 1 FROM model_failover_active_proof_revalidations existing
      WHERE existing.revalidation_id = NEW.revalidation_id
         OR existing.expiry_event_id = NEW.expiry_event_id
         OR (existing.active_event_id = NEW.active_event_id
           AND existing.replacement_proof_id = NEW.replacement_proof_id)
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_ACTIVE_PROOF_REVALIDATION_IDENTITY_CONFLICT: revalidation identity exists');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_revalidation_projection
    BEFORE INSERT ON model_failover_active_proof_revalidations
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_active_proof_expiry_events expiry
      JOIN model_failover_state state
        ON state.role = expiry.role
       AND state.episode_id = expiry.episode_id
       AND state.desired_revision = expiry.desired_revision
      JOIN model_failover_events active
        ON active.event_id = state.active_event_id
      JOIN model_automation_policy policy ON policy.id = 1
      JOIN model_failover_targets target ON target.role = state.role
      JOIN model_failover_proofs replacement
        ON replacement.proof_id = NEW.replacement_proof_id
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = replacement.proof_id
       AND artifact.validation_run_id = replacement.validation_run_id
       AND artifact.role = replacement.role
       AND artifact.role_contract_sha256 = replacement.role_contract_sha256
       AND artifact.model_name = replacement.model_name
       AND artifact.model_canonical_name = replacement.model_canonical_name
       AND artifact.model_digest_sha256 = replacement.model_digest_sha256
       AND artifact.policy_version = replacement.policy_version
       AND artifact.result = replacement.result
       AND artifact.expires_at_ms = replacement.expires_at_ms
      WHERE expiry.expiry_event_id = NEW.expiry_event_id
        AND expiry.active_event_id = NEW.active_event_id
        AND expiry.role = NEW.role
        AND expiry.episode_id = NEW.episode_id
        AND expiry.desired_revision = NEW.desired_revision
        AND expiry.observed_row_version = NEW.observed_row_version
        AND expiry.proof_id = NEW.expired_proof_id
        AND state.row_version = NEW.observed_row_version
        AND state.active_failover = 1
        AND state.active_event_id = NEW.active_event_id
        AND active.event_type IN ('ACTIVATED', 'REAPPLIED')
        AND active.role = NEW.role
        AND active.episode_id = NEW.episode_id
        AND active.proof_id = state.proof_id
        AND NEW.expired_proof_id = COALESCE((
          SELECT previous.replacement_proof_id
          FROM model_failover_active_proof_revalidations previous
          WHERE previous.active_event_id = NEW.active_event_id
          ORDER BY previous.created_at_ms DESC, previous.revalidation_id DESC
          LIMIT 1
        ), state.proof_id)
        AND policy.revision = NEW.policy_revision
        AND policy.last_event_id = NEW.policy_event_id
        AND policy.auto_failover_enabled = 1
        AND target.revision = NEW.target_revision
        AND target.authority_source = 'TARGET_EVENT'
        AND target.requested_name = state.fallback_model_name
        AND target.canonical_name = state.fallback_canonical_name
        AND target.digest_sha256 = state.fallback_digest_sha256
        AND replacement.role = NEW.role
        AND replacement.model_name = state.fallback_model_name
        AND replacement.model_canonical_name = state.fallback_canonical_name
        AND replacement.model_digest_sha256 = state.fallback_digest_sha256
        AND replacement.policy_version = state.policy_version
        AND replacement.role_contract_sha256 = NEW.role_contract_sha256
        AND replacement.result = 'PASS'
        AND replacement.completed_at_ms <= NEW.created_at_ms
        AND replacement.expires_at_ms > NEW.created_at_ms
        AND NEW.created_at_ms >= expiry.observed_at_ms
        AND NEW.created_at_ms > COALESCE((
          SELECT MAX(previous.created_at_ms)
          FROM model_failover_active_proof_revalidations previous
          WHERE previous.active_event_id = NEW.active_event_id
        ), 0)
        AND NOT EXISTS (
          SELECT 1 FROM model_failover_active_proof_revalidations existing
          WHERE existing.expiry_event_id = expiry.expiry_event_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM model_failover_active_proof_expiry_events other_expiry
          LEFT JOIN model_failover_active_proof_revalidations other_resolution
            ON other_resolution.expiry_event_id = other_expiry.expiry_event_id
          WHERE other_expiry.active_event_id = NEW.active_event_id
            AND other_expiry.expiry_event_id <> NEW.expiry_event_id
            AND other_resolution.revalidation_id IS NULL
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_ACTIVE_PROOF_REVALIDATION_PROJECTION_MISMATCH: revalidation lacks exact active proof authority');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_revalidation_append_only_update
    BEFORE UPDATE ON model_failover_active_proof_revalidations
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_ACTIVE_PROOF_REVALIDATION_APPEND_ONLY: revalidations cannot be updated');
    END;

    CREATE TRIGGER trg_model_failover_active_proof_revalidation_append_only_delete
    BEFORE DELETE ON model_failover_active_proof_revalidations
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_ACTIVE_PROOF_REVALIDATION_APPEND_ONLY: revalidations cannot be deleted');
    END;

    CREATE TRIGGER trg_model_failover_terminal_supersede_identity_conflict
    BEFORE INSERT ON model_failover_terminal_supersedes
    WHEN EXISTS (
      SELECT 1 FROM model_failover_terminal_supersedes existing
      WHERE existing.terminal_operation_id = NEW.terminal_operation_id
         OR existing.binding_operation_id = NEW.binding_operation_id
         OR existing.supersede_event_id = NEW.supersede_event_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_SUPERSEDE_IDENTITY_CONFLICT: terminal supersede identity exists');
    END;

    CREATE TRIGGER trg_model_failover_terminal_supersede_projection
    BEFORE INSERT ON model_failover_terminal_supersedes
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_failover_terminal_intents intent
      JOIN model_failover_state state
        ON state.role = intent.role
       AND state.episode_id = intent.episode_id
       AND state.desired_revision = intent.desired_revision
      JOIN model_binding_operations operation
        ON operation.operation_id = NEW.binding_operation_id
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
      WHERE intent.operation_id = NEW.terminal_operation_id
        AND state.claim_operation_id = intent.operation_id
        AND state.row_version = intent.claimed_row_version
        AND operation.role = intent.role
        AND operation.expected_binding_revision = intent.desired_revision
        AND desired.source = operation.operation_kind
        AND desired.actor = operation.actor
        AND desired.last_event_id = operation.desired_event_id
        AND NEW.role = intent.role
        AND NEW.episode_id = intent.episode_id
        AND NEW.terminal_row_version = intent.claimed_row_version
        AND NEW.created_at_ms = operation.created_at_ms
        AND NOT EXISTS (
          SELECT 1 FROM model_failover_terminal_finalize_receipts receipt
          WHERE receipt.operation_id = intent.operation_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM model_failover_events event
          WHERE event.event_id = NEW.supersede_event_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_TERMINAL_SUPERSEDE_PROJECTION_MISMATCH: supersede lacks exact intent and binding');
    END;

    CREATE TRIGGER trg_model_failover_terminal_supersede_append_only_update
    BEFORE UPDATE ON model_failover_terminal_supersedes
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_TERMINAL_SUPERSEDE_APPEND_ONLY: supersedes cannot be updated');
    END;

    CREATE TRIGGER trg_model_failover_terminal_supersede_append_only_delete
    BEFORE DELETE ON model_failover_terminal_supersedes
    BEGIN
      SELECT RAISE(ABORT, 'MODEL_FAILOVER_TERMINAL_SUPERSEDE_APPEND_ONLY: supersedes cannot be deleted');
    END;

    DROP TRIGGER trg_model_binding_operations_no_incident;
    DROP TRIGGER trg_model_failover_events_manual_supersede;
    DROP TRIGGER trg_model_failover_state_manual_supersede;
    DROP VIEW model_failover_manual_supersede_eligible;

    CREATE VIEW model_failover_manual_supersede_eligible AS
    WITH incident_lineage AS (
      SELECT incident.role, incident.desired_revision, incident.episode_id,
        incident.row_version, incident.state, incident.active_failover,
        incident.fallback_model_name, incident.fallback_canonical_name,
        incident.fallback_digest_sha256, incident.proof_id,
        incident.active_event_id, incident.policy_version, incident.actor,
        incident.reason_code, incident.failure_phase,
        incident.proof_verified_at_ms, incident.claim_operation_id,
        incident.claim_token, incident.claim_kind,
        incident.claim_started_at_ms, incident.claim_expires_at_ms,
        incident.detected_at_ms, incident.activated_at_ms,
        incident.updated_at_ms, incident.last_event_id,
        current.desired_model_name, current.desired_digest_sha256
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
       AND current.policy_version = incident.policy_version
       AND current.state_after = incident.state
       AND current.desired_model_name = origin.desired_model_name
       AND current.desired_digest_sha256 = origin.desired_digest_sha256
       AND current.created_at_ms = incident.updated_at_ms
      WHERE incident.state IN ('DETECTED', 'ACTIVATED', 'FAILED')
        AND incident.policy_version = 'd-plus-v1'
        AND incident.actor = 'system:binding-integrity'
        AND incident.resolved_at_ms IS NULL
        AND 1 = (
          SELECT COUNT(*) FROM model_failover_events origin_count
          WHERE origin_count.event_type = 'DETECTED'
            AND origin_count.role = incident.role
            AND origin_count.binding_revision = incident.desired_revision
            AND origin_count.episode_id = incident.episode_id
            AND origin_count.row_version = 1
        )
        AND (
          (incident.state = 'DETECTED'
            AND incident.active_failover = 0
            AND incident.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
            AND incident.fallback_model_name IS NULL
            AND incident.fallback_canonical_name IS NULL
            AND incident.fallback_digest_sha256 IS NULL
            AND incident.proof_id IS NULL
            AND incident.active_event_id IS NULL
            AND incident.failure_phase IS NULL
            AND incident.proof_verified_at_ms IS NULL
            AND incident.activated_at_ms IS NULL)
          OR
          (incident.state = 'ACTIVATED'
            AND incident.active_failover = 1
            AND incident.reason_code IN ('FAILOVER_ACTIVATED', 'FAILOVER_REAPPLIED')
            AND incident.fallback_model_name IS NOT NULL
            AND incident.fallback_canonical_name IS NOT NULL
            AND incident.fallback_digest_sha256 IS NOT NULL
            AND incident.proof_id IS NOT NULL
            AND incident.active_event_id IS NOT NULL
            AND incident.failure_phase IS NULL
            AND incident.proof_verified_at_ms IS NOT NULL
            AND incident.activated_at_ms IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM model_failover_events active_event
              JOIN model_failover_terminal_finalize_receipts active_receipt
                ON active_receipt.terminal_event_id = active_event.event_id
              JOIN model_failover_terminal_intents active_intent
                ON active_intent.operation_id = active_receipt.operation_id
              WHERE active_event.event_id = incident.active_event_id
                AND active_event.event_type IN ('ACTIVATED', 'REAPPLIED')
                AND active_event.role = incident.role
                AND active_event.binding_revision = incident.desired_revision
                AND active_event.episode_id = incident.episode_id
                AND active_event.state_after = 'ACTIVATED'
                AND active_event.desired_model_name = origin.desired_model_name
                AND active_event.desired_digest_sha256 = origin.desired_digest_sha256
                AND active_event.fallback_model_name = incident.fallback_model_name
                AND active_event.fallback_canonical_name = incident.fallback_canonical_name
                AND active_event.fallback_digest_sha256 = incident.fallback_digest_sha256
                AND active_event.proof_id = incident.proof_id
                AND active_event.reason_code = incident.reason_code
                AND active_event.verified = 1
                AND active_event.failure_phase IS NULL
                AND active_event.created_at_ms = incident.proof_verified_at_ms
                AND active_intent.role = incident.role
                AND active_intent.desired_revision = incident.desired_revision
                AND active_intent.episode_id = incident.episode_id
            ))
          OR
          (incident.state = 'FAILED'
            AND incident.failure_phase IS NOT NULL
            AND incident.reason_code IN (
              'FAILOVER_ACTIVATION_FAILED',
              'FAILOVER_REAPPLY_FAILED',
              'DESIRED_MODEL_RESTORE_FAILED'
            )
            AND (
              (incident.active_failover = 0
                AND incident.fallback_model_name IS NULL
                AND incident.fallback_canonical_name IS NULL
                AND incident.fallback_digest_sha256 IS NULL
                AND incident.proof_id IS NULL
                AND incident.active_event_id IS NULL
                AND incident.proof_verified_at_ms IS NULL)
              OR
              (incident.active_failover = 1
                AND incident.fallback_model_name IS NOT NULL
                AND incident.fallback_canonical_name IS NOT NULL
                AND incident.fallback_digest_sha256 IS NOT NULL
                AND incident.proof_id IS NOT NULL
                AND incident.active_event_id IS NOT NULL
                AND incident.proof_verified_at_ms IS NOT NULL
                AND incident.activated_at_ms IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM model_failover_events active_event
                  JOIN model_failover_terminal_finalize_receipts active_receipt
                    ON active_receipt.terminal_event_id = active_event.event_id
                  JOIN model_failover_terminal_intents active_intent
                    ON active_intent.operation_id = active_receipt.operation_id
                  WHERE active_event.event_id = incident.active_event_id
                    AND active_event.event_type IN ('ACTIVATED', 'REAPPLIED')
                    AND active_event.role = incident.role
                    AND active_event.binding_revision = incident.desired_revision
                    AND active_event.episode_id = incident.episode_id
                    AND active_event.state_after = 'ACTIVATED'
                    AND active_event.desired_model_name = origin.desired_model_name
                    AND active_event.desired_digest_sha256 = origin.desired_digest_sha256
                    AND active_event.fallback_model_name = incident.fallback_model_name
                    AND active_event.fallback_canonical_name = incident.fallback_canonical_name
                    AND active_event.fallback_digest_sha256 = incident.fallback_digest_sha256
                    AND active_event.proof_id = incident.proof_id
                    AND active_event.verified = 1
                    AND active_event.failure_phase IS NULL
                    AND active_event.created_at_ms = incident.proof_verified_at_ms
                    AND active_intent.role = incident.role
                    AND active_intent.desired_revision = incident.desired_revision
                    AND active_intent.episode_id = incident.episode_id
                ))
            ))
        )
        AND (
          (
            incident.claim_operation_id IS NULL
            AND incident.claim_token IS NULL
            AND incident.claim_kind IS NULL
            AND incident.claim_started_at_ms IS NULL
            AND incident.claim_expires_at_ms IS NULL
            AND (
              (incident.state = 'DETECTED' AND (
                (incident.row_version = 1
                  AND current.event_id = origin.event_id
                  AND current.event_type = 'DETECTED'
                  AND current.operation_id IS NULL
                  AND current.actor = 'system:binding-integrity'
                  AND current.reason_code = 'BOUND_MODEL_NOT_INSTALLED'
                  AND current.state_before IS NULL
                  AND current.fallback_model_name IS NULL
                  AND current.fallback_canonical_name IS NULL
                  AND current.fallback_digest_sha256 IS NULL
                  AND current.proof_id IS NULL
                  AND current.verified = 0
                  AND current.failure_phase IS NULL
                  AND current.details_json = '{}'
                  AND incident.updated_at_ms = incident.detected_at_ms)
                OR
                (incident.row_version > 1
                  AND current.event_type = 'CLAIM_EXPIRED'
                  AND current.operation_id IS NOT NULL
                  AND current.actor = 'system:binding-integrity'
                  AND current.reason_code = 'EXPIRED_CLAIM_RELEASED'
                  AND current.state_before = 'DETECTED'
                  AND current.fallback_model_name IS NULL
                  AND current.fallback_canonical_name IS NULL
                  AND current.fallback_digest_sha256 IS NULL
                  AND current.proof_id IS NULL
                  AND current.verified = 0
                  AND current.failure_phase IS NULL
                  AND current.details_json = '{}'
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
              ))
              OR
              (incident.state IN ('ACTIVATED', 'FAILED')
                AND EXISTS (
                  SELECT 1
                  FROM model_failover_terminal_finalize_receipts receipt
                  JOIN model_failover_terminal_intents intent
                    ON intent.operation_id = receipt.operation_id
                  WHERE receipt.terminal_event_id = current.event_id
                    AND receipt.terminal_event_type = current.event_type
                    AND receipt.terminal_row_version = incident.row_version
                    AND intent.role = incident.role
                    AND intent.desired_revision = incident.desired_revision
                    AND intent.episode_id = incident.episode_id
                    AND current.operation_id = intent.operation_id
                    AND current.actor = 'system:binding-integrity'
                    AND current.reason_code = incident.reason_code
                    AND current.failure_phase IS incident.failure_phase
                ))
            )
          )
          OR
          (
            incident.claim_operation_id IS NOT NULL
            AND incident.claim_token IS NOT NULL
            AND incident.claim_kind IS NOT NULL
            AND incident.claim_started_at_ms IS NOT NULL
            AND incident.claim_expires_at_ms > incident.claim_started_at_ms
            AND current.operation_id = incident.claim_operation_id
            AND current.actor = 'system:binding-integrity'
            AND current.reason_code = 'FAILOVER_OPERATION_CLAIMED'
            AND current.state_before = incident.state
            AND current.fallback_model_name IS NULL
            AND current.fallback_canonical_name IS NULL
            AND current.fallback_digest_sha256 IS NULL
            AND current.proof_id IS NULL
            AND current.verified = 0
            AND current.failure_phase IS NULL
            AND current.details_json = '{}'
            AND current.created_at_ms = incident.claim_started_at_ms
            AND (
              (incident.state = 'DETECTED'
                AND incident.claim_kind = 'ACTIVATE'
                AND current.event_type = 'ACTIVATION_CLAIMED')
              OR
              (incident.state = 'ACTIVATED'
                AND incident.claim_kind = 'REAPPLY'
                AND current.event_type = 'REAPPLY_CLAIMED')
              OR
              (incident.state = 'ACTIVATED'
                AND incident.claim_kind = 'RESTORE'
                AND current.event_type = 'RESTORE_CLAIMED')
            )
            AND (
              incident.state = 'DETECTED'
              OR EXISTS (
                SELECT 1
                FROM model_failover_terminal_finalize_receipts active_receipt
                JOIN model_failover_terminal_intents active_intent
                  ON active_intent.operation_id = active_receipt.operation_id
                WHERE active_receipt.terminal_event_id = incident.active_event_id
                  AND active_intent.role = incident.role
                  AND active_intent.desired_revision = incident.desired_revision
                  AND active_intent.episode_id = incident.episode_id
              )
            )
          )
        )
    )
    SELECT incident.role, incident.desired_revision, incident.episode_id,
      incident.row_version, incident.state, incident.active_failover,
      incident.fallback_model_name, incident.fallback_canonical_name,
      incident.fallback_digest_sha256, incident.proof_id,
      incident.active_event_id, incident.policy_version, incident.actor,
      incident.reason_code, incident.failure_phase,
      incident.proof_verified_at_ms, incident.claim_operation_id,
      incident.claim_token, incident.claim_kind, incident.claim_started_at_ms,
      incident.claim_expires_at_ms, incident.detected_at_ms,
      incident.activated_at_ms, incident.updated_at_ms, incident.last_event_id,
      incident.desired_model_name,
      desired.canonical_name AS desired_canonical_name,
      incident.desired_digest_sha256
    FROM incident_lineage incident
    JOIN model_desired_bindings desired
      ON desired.role = incident.role
     AND desired.binding_revision = incident.desired_revision
     AND desired.model_name = incident.desired_model_name
     AND desired.digest_sha256 = incident.desired_digest_sha256
    UNION ALL
    SELECT incident.role, incident.desired_revision, incident.episode_id,
      incident.row_version, incident.state, incident.active_failover,
      incident.fallback_model_name, incident.fallback_canonical_name,
      incident.fallback_digest_sha256, incident.proof_id,
      incident.active_event_id, incident.policy_version, incident.actor,
      incident.reason_code, incident.failure_phase,
      incident.proof_verified_at_ms, incident.claim_operation_id,
      incident.claim_token, incident.claim_kind, incident.claim_started_at_ms,
      incident.claim_expires_at_ms, incident.detected_at_ms,
      incident.activated_at_ms, incident.updated_at_ms, incident.last_event_id,
      incident.desired_model_name,
      operation.previous_canonical_name AS desired_canonical_name,
      incident.desired_digest_sha256
    FROM incident_lineage incident
    JOIN model_binding_operations operation
      ON operation.role = incident.role
     AND operation.expected_binding_revision = incident.desired_revision
     AND operation.previous_model_name = incident.desired_model_name
     AND operation.previous_digest_sha256 = incident.desired_digest_sha256
     AND operation.policy_version = incident.policy_version
    JOIN model_desired_bindings desired
      ON desired.role = operation.role
     AND desired.binding_revision = operation.committed_binding_revision
     AND desired.model_name = operation.target_model_name
     AND desired.canonical_name = operation.target_canonical_name
     AND desired.digest_sha256 = operation.target_digest_sha256
     AND desired.source = operation.operation_kind
     AND desired.actor = operation.actor
     AND desired.observed_at_ms = operation.created_at_ms
     AND desired.updated_at_ms = operation.created_at_ms
     AND desired.last_event_id = operation.desired_event_id
    JOIN model_failover_events desired_event
      ON desired_event.event_id = operation.desired_event_id
     AND desired_event.event_type = 'DESIRED_CHANGED'
     AND desired_event.operation_id = operation.operation_id
     AND desired_event.role = operation.role
     AND desired_event.binding_revision = operation.committed_binding_revision
     AND desired_event.actor = operation.actor
     AND desired_event.reason_code = operation.reason_code
     AND desired_event.policy_version = operation.policy_version
     AND desired_event.desired_model_name = operation.target_model_name
     AND desired_event.desired_digest_sha256 = operation.target_digest_sha256
     AND desired_event.row_version IS NULL
     AND desired_event.episode_id IS NULL
     AND desired_event.state_before IS NULL
     AND desired_event.state_after IS NULL
     AND desired_event.fallback_model_name IS NULL
     AND desired_event.fallback_canonical_name IS NULL
     AND desired_event.fallback_digest_sha256 IS NULL
     AND desired_event.proof_id IS NULL
     AND desired_event.verified = 0
     AND desired_event.failure_phase IS NULL
     AND desired_event.details_json = '{}'
     AND desired_event.created_at_ms = operation.created_at_ms;

    CREATE TRIGGER trg_model_binding_operations_no_incident
    BEFORE INSERT ON model_binding_operations
    WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS (
      SELECT 1 FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision)
         OR (NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id)
    )) AND EXISTS (
      SELECT 1 FROM model_failover_state incident WHERE incident.role = NEW.role
    ) AND NOT EXISTS (
      SELECT 1
      FROM model_failover_manual_supersede_eligible eligible
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
        AND eligible.desired_model_name = NEW.previous_model_name
        AND eligible.desired_canonical_name = NEW.previous_canonical_name
        AND eligible.desired_digest_sha256 = NEW.previous_digest_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'manual binding operation requires exact atomic incident supersede');
    END;

    CREATE TRIGGER trg_model_failover_events_manual_supersede
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1 FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type)
    )) AND NEW.event_type = 'SUPERSEDED_BY_USER' AND NOT EXISTS (
      SELECT 1
      FROM model_binding_operations operation
      JOIN model_failover_manual_supersede_eligible eligible
        ON eligible.role = operation.role
       AND eligible.desired_revision = operation.expected_binding_revision
       AND eligible.desired_model_name = operation.previous_model_name
       AND eligible.desired_canonical_name = operation.previous_canonical_name
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
      WHERE operation.operation_id = NEW.operation_id
        AND NEW.role = operation.role
        AND NEW.binding_revision = operation.committed_binding_revision
        AND NEW.row_version = eligible.row_version + 1
        AND NEW.episode_id = eligible.episode_id
        AND NEW.actor = operation.actor
        AND NEW.reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER'
        AND NEW.policy_version = operation.policy_version
        AND NEW.state_before = eligible.state
        AND NEW.state_after = 'SUPERSEDED_BY_USER'
        AND NEW.desired_model_name = operation.target_model_name
        AND NEW.desired_digest_sha256 = operation.target_digest_sha256
        AND NEW.fallback_model_name IS eligible.fallback_model_name
        AND NEW.fallback_canonical_name IS eligible.fallback_canonical_name
        AND NEW.fallback_digest_sha256 IS eligible.fallback_digest_sha256
        AND NEW.proof_id IS eligible.proof_id
        AND NEW.verified = 0
        AND NEW.failure_phase IS NULL
        AND NEW.details_json = '{}'
        AND NEW.created_at_ms = operation.created_at_ms
        AND (
          eligible.claim_operation_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM model_failover_terminal_intents intent
            WHERE intent.operation_id = eligible.claim_operation_id
          )
          OR EXISTS (
            SELECT 1 FROM model_failover_terminal_supersedes supersede
            WHERE supersede.terminal_operation_id = eligible.claim_operation_id
              AND supersede.binding_operation_id = operation.operation_id
              AND supersede.supersede_event_id = NEW.event_id
              AND supersede.role = NEW.role
              AND supersede.episode_id = NEW.episode_id
              AND supersede.terminal_row_version = eligible.row_version
              AND supersede.created_at_ms = NEW.created_at_ms
          )
        )
    )
    BEGIN
      SELECT RAISE(ABORT,
        'manual supersede event requires exact operation, desired projection and incident');
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
       AND eligible.state = OLD.state
       AND eligible.active_failover = OLD.active_failover
       AND eligible.last_event_id = OLD.last_event_id
      JOIN model_failover_events event
        ON event.event_id = NEW.last_event_id
       AND event.event_type = 'SUPERSEDED_BY_USER'
       AND event.operation_id = operation.operation_id
       AND event.role = operation.role
       AND event.binding_revision = operation.committed_binding_revision
       AND event.row_version = NEW.row_version
       AND event.episode_id = NEW.episode_id
       AND event.state_before = OLD.state
       AND event.state_after = 'SUPERSEDED_BY_USER'
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.last_event_id = operation.desired_event_id
      WHERE operation.role = OLD.role
        AND operation.expected_binding_revision = OLD.desired_revision
        AND operation.committed_binding_revision = NEW.desired_revision
        AND operation.policy_version = OLD.policy_version
        AND NEW.role = OLD.role
        AND NEW.desired_revision = OLD.desired_revision + 1
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
        AND event.actor = operation.actor
        AND event.reason_code = NEW.reason_code
        AND event.policy_version = NEW.policy_version
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
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_BINDING_SUPERSEDE_STATE_LINEAGE_MISMATCH: manual incident supersede requires exact operation and audit lineage');
    END;
  `);
}
