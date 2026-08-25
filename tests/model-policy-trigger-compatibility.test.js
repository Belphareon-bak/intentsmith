import Database from 'better-sqlite3';
import { suite, test, assert, assertEqual, summary } from './harness.js';
import { up as up066 } from '../src/db/migrations/2026_08_22_066_model_automation_policy.js';
import { up as up081 } from '../src/db/migrations/2026_08_24_081_model_policy_trigger_compatibility.js';

const LEGACY_TRIGGERS = [
  'trg_model_automation_policy_events_no_update',
  'trg_model_automation_policy_events_no_delete',
  'trg_model_automation_policy_events_sequence',
  'trg_model_automation_policy_projection_event',
  'trg_model_automation_policy_projection_event_update',
];

const M1_TRIGGERS = [
  'trg_model_automation_event_identity_conflict',
  'trg_model_automation_event_revision',
  'trg_model_automation_event_lineage',
  'trg_model_automation_event_projection',
  'trg_model_automation_event_append_only_update',
  'trg_model_automation_event_append_only_delete',
  'trg_model_automation_projection_replace',
  'trg_model_automation_projection_revision',
  'trg_model_automation_projection_new_event',
  'trg_model_automation_projection_current_event',
  'trg_model_automation_projection_append_only_delete',
];

function triggerNames(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_model_automation_%'
    ORDER BY name
  `).all().map(row => row.name);
}

function installM1Fixture(db) {
  db.exec(`
    CREATE TABLE model_automation_policy_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL,
      previous_revision INTEGER NOT NULL,
      committed_revision INTEGER NOT NULL UNIQUE,
      event_kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      source TEXT NOT NULL,
      before_auto_failover_enabled INTEGER NOT NULL,
      before_auto_cleanup_enabled INTEGER NOT NULL,
      before_auto_cleanup_days INTEGER NOT NULL,
      after_auto_failover_enabled INTEGER NOT NULL,
      after_auto_cleanup_enabled INTEGER NOT NULL,
      after_auto_cleanup_days INTEGER NOT NULL,
      legacy_quarantine_json TEXT,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE model_automation_policy (
      id INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      auto_failover_enabled INTEGER NOT NULL,
      auto_cleanup_enabled INTEGER NOT NULL,
      auto_cleanup_days INTEGER NOT NULL,
      last_event_id TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    INSERT INTO model_automation_policy_events (
      event_id, request_id, schema_version, previous_revision, committed_revision,
      event_kind, actor, source, before_auto_failover_enabled,
      before_auto_cleanup_enabled, before_auto_cleanup_days,
      after_auto_failover_enabled, after_auto_cleanup_enabled,
      after_auto_cleanup_days, created_at_ms
    ) VALUES (
      'policy-event-migration-061', 'policy-request-migration-061', 1, 0, 1,
      'MIGRATION_DEFAULT_OFF', 'system:migration-061', 'MIGRATION', 0, 0, 14,
      0, 0, 14, 1
    );
    INSERT INTO model_automation_policy VALUES (
      1, 1, 1, 0, 0, 14, 'policy-event-migration-061', 1
    );
  `);
  for (const name of M1_TRIGGERS) {
    const table = name.startsWith('trg_model_automation_event_')
      ? 'model_automation_policy_events'
      : 'model_automation_policy';
    db.exec(`CREATE TRIGGER ${name} BEFORE UPDATE ON ${table} BEGIN SELECT 1; END`);
  }
}

suite('Model policy migration 081 trigger compatibility');

test('leaves the native legacy 066 schema and triggers unchanged', () => {
  const db = new Database(':memory:');
  up066(db);
  const before = triggerNames(db);
  up081(db);
  assertEqual(JSON.stringify(triggerNames(db)), JSON.stringify(before));
  assert(LEGACY_TRIGGERS.every(name => before.includes(name)));
  db.close();
});

test('removes only complete legacy 066 triggers from an exact M1 authority', () => {
  const db = new Database(':memory:');
  installM1Fixture(db);
  up066(db);
  const beforePolicy = JSON.stringify(db.prepare('SELECT * FROM model_automation_policy').all());
  const beforeEvents = JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events').all());
  assert(LEGACY_TRIGGERS.every(name => triggerNames(db).includes(name)));

  up081(db);
  const after = triggerNames(db);
  assert(LEGACY_TRIGGERS.every(name => !after.includes(name)));
  assert(M1_TRIGGERS.every(name => after.includes(name)));
  assertEqual(JSON.stringify(db.prepare('SELECT * FROM model_automation_policy').all()), beforePolicy);
  assertEqual(JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events').all()), beforeEvents);
  db.exec('CREATE TABLE schema_reparse_probe (id INTEGER PRIMARY KEY)');

  up081(db);
  assertEqual(JSON.stringify(triggerNames(db)), JSON.stringify(after));
  db.close();
});

test('fails closed on an incomplete M1 protective trigger set', () => {
  const db = new Database(':memory:');
  installM1Fixture(db);
  up066(db);
  db.exec('DROP TRIGGER trg_model_automation_event_lineage');
  let error = null;
  try { up081(db); } catch (caught) { error = caught; }
  assert(String(error?.message || '').includes('trigger set is incomplete'));
  assert(LEGACY_TRIGGERS.every(name => triggerNames(db).includes(name)));
  db.close();
});

test('fails closed on a partial legacy trigger collision', () => {
  const db = new Database(':memory:');
  installM1Fixture(db);
  up066(db);
  db.exec(`DROP TRIGGER ${LEGACY_TRIGGERS[0]}`);
  let error = null;
  try { up081(db); } catch (caught) { error = caught; }
  assert(String(error?.message || '').includes('partially present'));
  assert(LEGACY_TRIGGERS.slice(1).every(name => triggerNames(db).includes(name)));
  db.close();
});

summary();
