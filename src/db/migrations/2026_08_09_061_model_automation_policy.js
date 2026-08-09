// Migration 061 — one versioned authority for model automation policy.
//
// Legacy user_settings values are untrusted input.  They are quarantined in
// the migration event, removed from the general settings document and never
// promoted to an opt-in.  The new projection always starts OFF.

export const version = '2026_08_09_061_model_automation_policy';
export const description = 'Add audited model automation policy authority';

const OWNED_KEYS = Object.freeze([
  'autoFailoverEnabled',
  'autoCleanupEnabled',
  'autoCleanupDays',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function prepareLegacySettings(row) {
  if (!row) return { quarantineJson: null, sanitizedJson: null };
  try {
    const document = JSON.parse(row.data);
    if (!isPlainObject(document) || !isPlainObject(document.models)) {
      return { quarantineJson: null, sanitizedJson: null };
    }

    const quarantine = {};
    for (const key of OWNED_KEYS) {
      if (!Object.hasOwn(document.models, key)) continue;
      quarantine[key] = document.models[key];
      delete document.models[key];
    }
    if (Object.keys(quarantine).length === 0) {
      return { quarantineJson: null, sanitizedJson: null };
    }
    return {
      quarantineJson: JSON.stringify(quarantine),
      sanitizedJson: JSON.stringify(document),
    };
  } catch (_) {
    // Malformed general settings already fail closed in their existing reader.
    // Do not rewrite or manufacture a trusted policy from them.
    return { quarantineJson: null, sanitizedJson: null };
  }
}

export function up(db) {
  const existingObjects = db.prepare(`
    SELECT type, name
    FROM sqlite_master
    WHERE name IN (
      'model_automation_policy',
      'model_automation_policy_events'
    )
    ORDER BY type, name
  `).all();
  if (existingObjects.length > 0) {
    throw new Error(
      'model automation policy objects pre-exist migration authority: '
      + existingObjects.map(row => `${row.type}:${row.name}`).join(','),
    );
  }

  const legacy = prepareLegacySettings(
    db.prepare('SELECT data FROM user_settings WHERE id = 1').get(),
  );
  const createdAtMs = Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 1) {
    throw new Error('model automation policy migration clock is invalid');
  }

  db.exec(`
    CREATE TABLE model_automation_policy_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE
        CHECK (length(event_id) BETWEEN 16 AND 160),
      request_id TEXT NOT NULL UNIQUE
        CHECK (length(request_id) BETWEEN 16 AND 160),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      previous_revision INTEGER NOT NULL
        CHECK (typeof(previous_revision) = 'integer' AND previous_revision >= 0),
      committed_revision INTEGER NOT NULL UNIQUE
        CHECK (typeof(committed_revision) = 'integer' AND committed_revision >= 1),
      event_kind TEXT NOT NULL
        CHECK (event_kind IN (
          'MIGRATION_DEFAULT_OFF',
          'USER_UPDATE',
          'BACKUP_IMPORT',
          'GLOBAL_RESET'
        )),
      actor TEXT NOT NULL
        CHECK (
          length(actor) BETWEEN 3 AND 96
          AND actor NOT GLOB '*[^A-Za-z0-9:._-]*'
        ),
      source TEXT NOT NULL
        CHECK (source IN ('MIGRATION','TYPED_API','SETTINGS_IMPORT','GLOBAL_RESET')),
      before_auto_failover_enabled INTEGER NOT NULL
        CHECK (typeof(before_auto_failover_enabled) = 'integer'
          AND before_auto_failover_enabled IN (0, 1)),
      before_auto_cleanup_enabled INTEGER NOT NULL
        CHECK (typeof(before_auto_cleanup_enabled) = 'integer'
          AND before_auto_cleanup_enabled IN (0, 1)),
      before_auto_cleanup_days INTEGER NOT NULL
        CHECK (typeof(before_auto_cleanup_days) = 'integer'
          AND before_auto_cleanup_days BETWEEN 1 AND 3650),
      after_auto_failover_enabled INTEGER NOT NULL
        CHECK (typeof(after_auto_failover_enabled) = 'integer'
          AND after_auto_failover_enabled IN (0, 1)),
      after_auto_cleanup_enabled INTEGER NOT NULL
        CHECK (typeof(after_auto_cleanup_enabled) = 'integer'
          AND after_auto_cleanup_enabled IN (0, 1)),
      after_auto_cleanup_days INTEGER NOT NULL
        CHECK (typeof(after_auto_cleanup_days) = 'integer'
          AND after_auto_cleanup_days BETWEEN 1 AND 3650),
      legacy_quarantine_json TEXT
        CHECK (
          legacy_quarantine_json IS NULL
          OR (json_valid(legacy_quarantine_json)
            AND json_type(legacy_quarantine_json, '$') = 'object')
        ),
      created_at_ms INTEGER NOT NULL
        CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms > 0),

      CHECK (committed_revision = previous_revision + 1),
      CHECK (
        (event_kind = 'MIGRATION_DEFAULT_OFF'
          AND source = 'MIGRATION'
          AND actor = 'system:migration-061'
          AND previous_revision = 0
          AND committed_revision = 1
          AND before_auto_failover_enabled = 0
          AND before_auto_cleanup_enabled = 0
          AND before_auto_cleanup_days = 14
          AND after_auto_failover_enabled = 0
          AND after_auto_cleanup_enabled = 0
          AND after_auto_cleanup_days = 14)
        OR
        (event_kind <> 'MIGRATION_DEFAULT_OFF'
          AND source <> 'MIGRATION'
          AND actor LIKE 'user:%'
          AND committed_revision >= 2
          AND legacy_quarantine_json IS NULL)
      ),
      CHECK (
        (event_kind = 'USER_UPDATE' AND source = 'TYPED_API')
        OR (event_kind = 'BACKUP_IMPORT' AND source = 'SETTINGS_IMPORT')
        OR (event_kind = 'GLOBAL_RESET' AND source = 'GLOBAL_RESET')
        OR event_kind = 'MIGRATION_DEFAULT_OFF'
      )
    );

    CREATE TABLE model_automation_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
      revision INTEGER NOT NULL
        CHECK (typeof(revision) = 'integer' AND revision >= 1),
      auto_failover_enabled INTEGER NOT NULL
        CHECK (typeof(auto_failover_enabled) = 'integer'
          AND auto_failover_enabled IN (0, 1)),
      auto_cleanup_enabled INTEGER NOT NULL
        CHECK (typeof(auto_cleanup_enabled) = 'integer'
          AND auto_cleanup_enabled IN (0, 1)),
      auto_cleanup_days INTEGER NOT NULL
        CHECK (typeof(auto_cleanup_days) = 'integer'
          AND auto_cleanup_days BETWEEN 1 AND 3650),
      last_event_id TEXT NOT NULL UNIQUE
        REFERENCES model_automation_policy_events(event_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      updated_at_ms INTEGER NOT NULL
        CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms > 0)
    );
  `);

  db.prepare(`
    INSERT INTO model_automation_policy_events (
      event_id,
      request_id,
      previous_revision,
      committed_revision,
      event_kind,
      actor,
      source,
      before_auto_failover_enabled,
      before_auto_cleanup_enabled,
      before_auto_cleanup_days,
      after_auto_failover_enabled,
      after_auto_cleanup_enabled,
      after_auto_cleanup_days,
      legacy_quarantine_json,
      created_at_ms
    ) VALUES (
      'policy-event-migration-061',
      'policy-request-migration-061',
      0,
      1,
      'MIGRATION_DEFAULT_OFF',
      'system:migration-061',
      'MIGRATION',
      0, 0, 14,
      0, 0, 14,
      ?,
      ?
    )
  `).run(legacy.quarantineJson, createdAtMs);

  db.prepare(`
    INSERT INTO model_automation_policy (
      id,
      revision,
      auto_failover_enabled,
      auto_cleanup_enabled,
      auto_cleanup_days,
      last_event_id,
      updated_at_ms
    ) VALUES (1, 1, 0, 0, 14, 'policy-event-migration-061', ?)
  `).run(createdAtMs);

  if (legacy.sanitizedJson !== null) {
    db.prepare(`
      UPDATE user_settings
      SET data = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(legacy.sanitizedJson);
  }

  db.exec(`
    CREATE TRIGGER trg_model_automation_event_identity_conflict
    BEFORE INSERT ON model_automation_policy_events
    WHEN EXISTS (
      SELECT 1
      FROM model_automation_policy_events existing
      WHERE existing.seq = NEW.seq
         OR existing.event_id = NEW.event_id
         OR existing.request_id = NEW.request_id
         OR existing.committed_revision = NEW.committed_revision
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_IDENTITY_CONFLICT: append-only identity exists');
    END;

    CREATE TRIGGER trg_model_automation_event_revision
    BEFORE INSERT ON model_automation_policy_events
    WHEN NEW.previous_revision <> COALESCE((
      SELECT MAX(existing.committed_revision)
      FROM model_automation_policy_events existing
    ), 0)
      OR NEW.committed_revision <> COALESCE((
        SELECT MAX(existing.committed_revision)
        FROM model_automation_policy_events existing
      ), 0) + 1
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_REVISION_MISMATCH: event must append exactly');
    END;

    CREATE TRIGGER trg_model_automation_event_lineage
    BEFORE INSERT ON model_automation_policy_events
    WHEN NEW.previous_revision > 0 AND NOT EXISTS (
      SELECT 1
      FROM model_automation_policy_events previous
      WHERE previous.committed_revision = NEW.previous_revision
        AND previous.after_auto_failover_enabled = NEW.before_auto_failover_enabled
        AND previous.after_auto_cleanup_enabled = NEW.before_auto_cleanup_enabled
        AND previous.after_auto_cleanup_days = NEW.before_auto_cleanup_days
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_LINEAGE_MISMATCH: before state is not current');
    END;

    CREATE TRIGGER trg_model_automation_event_projection
    BEFORE INSERT ON model_automation_policy_events
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_automation_policy policy
      WHERE policy.id = 1
        AND policy.schema_version = NEW.schema_version
        AND policy.revision = NEW.committed_revision
        AND policy.auto_failover_enabled = NEW.after_auto_failover_enabled
        AND policy.auto_cleanup_enabled = NEW.after_auto_cleanup_enabled
        AND policy.auto_cleanup_days = NEW.after_auto_cleanup_days
        AND policy.last_event_id = NEW.event_id
        AND policy.updated_at_ms = NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_PROJECTION_MISMATCH: event lacks exact projection');
    END;

    CREATE TRIGGER trg_model_automation_event_append_only_update
    BEFORE UPDATE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_APPEND_ONLY: events cannot be updated');
    END;

    CREATE TRIGGER trg_model_automation_event_append_only_delete
    BEFORE DELETE ON model_automation_policy_events
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_APPEND_ONLY: events cannot be deleted');
    END;

    CREATE TRIGGER trg_model_automation_projection_replace
    BEFORE INSERT ON model_automation_policy
    WHEN EXISTS (SELECT 1 FROM model_automation_policy WHERE id = 1)
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_REPLACE_FORBIDDEN: singleton already exists');
    END;

    CREATE TRIGGER trg_model_automation_projection_revision
    BEFORE UPDATE ON model_automation_policy
    WHEN NEW.id <> OLD.id
      OR NEW.schema_version <> OLD.schema_version
      OR NEW.revision <> OLD.revision + 1
      OR NEW.last_event_id = OLD.last_event_id
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_REVISION_MISMATCH: projection must advance exactly');
    END;

    CREATE TRIGGER trg_model_automation_projection_new_event
    BEFORE UPDATE ON model_automation_policy
    WHEN EXISTS (
      SELECT 1
      FROM model_automation_policy_events event
      WHERE event.event_id = NEW.last_event_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_EVENT_IDENTITY_CONFLICT: projection must name a new event');
    END;

    CREATE TRIGGER trg_model_automation_projection_current_event
    BEFORE UPDATE ON model_automation_policy
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_automation_policy_events event
      WHERE event.event_id = OLD.last_event_id
        AND event.committed_revision = OLD.revision
        AND event.after_auto_failover_enabled = OLD.auto_failover_enabled
        AND event.after_auto_cleanup_enabled = OLD.auto_cleanup_enabled
        AND event.after_auto_cleanup_days = OLD.auto_cleanup_days
        AND event.created_at_ms = OLD.updated_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_CURRENT_EVENT_MISMATCH: current projection is invalid');
    END;

    CREATE TRIGGER trg_model_automation_projection_append_only_delete
    BEFORE DELETE ON model_automation_policy
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_PROJECTION_DELETE_FORBIDDEN: singleton cannot be deleted');
    END;

    CREATE TRIGGER trg_user_settings_model_automation_insert_guard
    BEFORE INSERT ON user_settings
    WHEN CASE
      WHEN json_valid(NEW.data) AND json_type(NEW.data, '$') = 'object' THEN
        EXISTS (
          SELECT 1
          FROM json_each(NEW.data) top_level
          JOIN json_each(
            CASE WHEN top_level.type = 'object' THEN top_level.value ELSE '{}' END
          ) model_member
          WHERE top_level.key = 'models'
            AND top_level.type = 'object'
            AND model_member.key IN (
              'autoFailoverEnabled',
              'autoCleanupEnabled',
              'autoCleanupDays'
            )
        )
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN: use versioned policy authority');
    END;

    CREATE TRIGGER trg_user_settings_model_automation_update_guard
    BEFORE UPDATE OF data ON user_settings
    WHEN CASE
      WHEN json_valid(NEW.data) AND json_type(NEW.data, '$') = 'object' THEN
        EXISTS (
          SELECT 1
          FROM json_each(NEW.data) top_level
          JOIN json_each(
            CASE WHEN top_level.type = 'object' THEN top_level.value ELSE '{}' END
          ) model_member
          WHERE top_level.key = 'models'
            AND top_level.type = 'object'
            AND model_member.key IN (
              'autoFailoverEnabled',
              'autoCleanupEnabled',
              'autoCleanupDays'
            )
        )
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN: use versioned policy authority');
    END;
  `);
}
