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
    'trg_model_failover_target_event_identity_conflict',
    'trg_model_failover_target_event_projection',
    'trg_model_failover_target_event_append_only_update',
    'trg_model_failover_target_event_append_only_delete',
    'trg_model_failover_target_policy_reset_projection',
    'trg_model_failover_target_projection_guard',
    'trg_model_failover_target_projection_insert_forbidden',
    'trg_model_failover_target_projection_delete_forbidden',
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
  `);
}
