// Migration 064 — one monotonic commit point for the user_settings singleton.
//
// Existing document bytes are preserved. A missing singleton is seeded once;
// every later mutation must be an UPDATE that advances revision exactly by one.

export const version = '2026_08_10_064_user_settings_revision';
export const description = 'Add revisioned user settings singleton authority';

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const EXPECTED_COLUMNS = Object.freeze(['id', 'data', 'updated_at']);
const OWNED_TRIGGER_NAMES = Object.freeze([
  'trg_user_settings_revision_insert_forbidden',
  'trg_user_settings_revision_update_guard',
  'trg_user_settings_revision_delete_forbidden',
]);
const COMPATIBLE_061_TRIGGER_NAMES = Object.freeze([
  'trg_user_settings_model_automation_insert_guard',
  'trg_user_settings_model_automation_update_guard',
]);
const LEGACY_061_MODEL_KEYS = Object.freeze([
  'autoFailoverEnabled',
  'autoCleanupEnabled',
  'autoCleanupDays',
]);

function fail(message) {
  throw new Error(`USER_SETTINGS_REVISION_MIGRATION_INVALID: ${message}`);
}

function readTriggerNames(db, names) {
  if (names.length === 0) return [];
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (${names.map(() => '?').join(',')})
    ORDER BY name
  `).all(...names).map(row => row.name);
}

function assertTriggerSet(db, names, label) {
  const actual = readTriggerNames(db, names);
  const expected = [...names].sort();
  if (actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])) {
    fail(`${label} trigger authority is incomplete`);
  }
}

function assertCompatiblePreexistingTriggers(names) {
  if (names.length === 0) return;
  const expected = [...COMPATIBLE_061_TRIGGER_NAMES].sort();
  if (names.length !== expected.length
    || names.some((name, index) => name !== expected[index])) {
    fail(`unsupported pre-existing user_settings triggers: ${names.join(',')}`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiresLegacy061Sanitation(row) {
  if (!row) return false;
  try {
    const document = JSON.parse(row.data);
    if (!isPlainObject(document) || !isPlainObject(document.models)) return false;
    return LEGACY_061_MODEL_KEYS.some(key => Object.hasOwn(document.models, key));
  } catch (_) {
    return false;
  }
}

function assertLegacyShape(db) {
  const table = db.prepare(`
    SELECT type
    FROM sqlite_master
    WHERE name = 'user_settings'
  `).get();
  if (!table || table.type !== 'table') {
    fail('user_settings must be a table');
  }

  const columns = db.prepare('PRAGMA table_info(user_settings)').all();
  if (columns.length !== EXPECTED_COLUMNS.length
    || columns.some((column, index) => column.name !== EXPECTED_COLUMNS[index])) {
    fail(`expected legacy columns ${EXPECTED_COLUMNS.join(',')}`);
  }

  const objects = db.prepare(`
    SELECT type, name
    FROM sqlite_master
    WHERE name IN (${OWNED_TRIGGER_NAMES.map(() => '?').join(',')})
       OR (type = 'table' AND name = 'user_settings' AND sql LIKE '% revision %')
    ORDER BY type, name
  `).all(...OWNED_TRIGGER_NAMES);
  if (objects.length > 0) {
    fail(`revision authority already exists: ${objects.map(row => `${row.type}:${row.name}`).join(',')}`);
  }
  const existingTriggerNames = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = 'user_settings'
    ORDER BY name
  `).all().map(row => row.name);
  assertCompatiblePreexistingTriggers(existingTriggerNames);

  const rows = db.prepare(`
    SELECT id,
           data,
           typeof(data) AS data_type,
           hex(CAST(data AS BLOB)) AS data_hex,
           updated_at
    FROM user_settings
    ORDER BY id
  `).all();
  if (rows.length > 1 || (rows.length === 1 && rows[0].id !== 1)) {
    fail('user_settings must contain at most the singleton id=1');
  }
  if (requiresLegacy061Sanitation(rows[0])) {
    fail('legacy model automation keys require migration 061 before migration 064');
  }
  return {
    row: rows[0] || null,
    existingTriggerNames,
  };
}

function assertPreserved(db, before) {
  const rows = db.prepare(`
    SELECT id,
           data,
           typeof(data) AS data_type,
           hex(CAST(data AS BLOB)) AS data_hex,
           updated_at,
           revision,
           typeof(revision) AS revision_type
    FROM user_settings
    ORDER BY id
  `).all();
  if (rows.length !== 1 || rows[0].id !== 1) {
    fail('migration did not produce exactly one singleton row');
  }
  const row = rows[0];
  if (row.revision_type !== 'integer' || row.revision !== 1) {
    fail('singleton revision was not initialized to integer 1');
  }
  if (before && (
    row.data_type !== before.data_type
    || row.data_hex !== before.data_hex
    || row.updated_at !== before.updated_at
  )) {
    fail('existing settings bytes or timestamp changed during migration');
  }
  if (!before && row.data !== '{}') {
    fail('missing singleton was not seeded with the exact empty document');
  }
}

export function up(db) {
  const before = assertLegacyShape(db);

  db.exec(`
    ALTER TABLE user_settings
    ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
      CHECK (
        typeof(revision) = 'integer'
        AND revision BETWEEN 1 AND ${MAX_SAFE_INTEGER}
      );
  `);

  if (!before.row) {
    db.prepare(`
      INSERT INTO user_settings (id, data, revision)
      VALUES (1, '{}', 1)
    `).run();
  }
  assertPreserved(db, before.row);

  db.exec(`
    CREATE TRIGGER trg_user_settings_revision_insert_forbidden
    BEFORE INSERT ON user_settings
    BEGIN
      SELECT RAISE(ABORT,
        'USER_SETTINGS_INSERT_FORBIDDEN: singleton already exists; use revisioned UPDATE');
    END;

    CREATE TRIGGER trg_user_settings_revision_update_guard
    BEFORE UPDATE ON user_settings
    WHEN NOT (
      OLD.id = 1
      AND NEW.id = OLD.id
      AND typeof(OLD.revision) = 'integer'
      AND typeof(NEW.revision) = 'integer'
      AND OLD.revision < ${MAX_SAFE_INTEGER}
      AND typeof(NEW.data) = 'text'
      AND json_valid(NEW.data)
      AND json_type(NEW.data, '$') = 'object'
      AND NEW.revision = OLD.revision + 1
    )
    BEGIN
      SELECT RAISE(ABORT,
        'USER_SETTINGS_REVISION_MISMATCH: update must preserve id, store an object and advance exactly');
    END;

    CREATE TRIGGER trg_user_settings_revision_delete_forbidden
    BEFORE DELETE ON user_settings
    BEGIN
      SELECT RAISE(ABORT,
        'USER_SETTINGS_DELETE_FORBIDDEN: singleton cannot be deleted');
    END;
  `);

  assertTriggerSet(db, before.existingTriggerNames, 'pre-existing user_settings');
  assertTriggerSet(db, OWNED_TRIGGER_NAMES, 'migration 064');
}
