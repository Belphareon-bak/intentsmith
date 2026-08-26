// Repair a narrow historical migration collision before schema consolidation.
//
// Migration 066 legitimately owns its five `trg_model_automation_policy_*`
// triggers when it also owns the legacy policy tables. Some databases already
// contained the accepted M1 policy authority (migration 061), however. Because
// 066 used CREATE TABLE/TRIGGER IF NOT EXISTS, it left the M1 tables in place
// but added triggers whose SQL refers to legacy-only event columns. SQLite then
// refuses unrelated later DDL while reparsing that invalid schema.
//
// This migration only removes those five foreign triggers from an exact M1
// schema with its complete protective trigger set. Legacy 066 databases are
// left untouched. Mixed or unknown schemas fail closed.

export const version = '2026_08_26_084_model_policy_trigger_compatibility';
export const description = 'Remove legacy policy triggers from exact M1 policy schemas';

const LEGACY_TRIGGER_NAMES = Object.freeze([
  'trg_model_automation_policy_events_no_update',
  'trg_model_automation_policy_events_no_delete',
  'trg_model_automation_policy_events_sequence',
  'trg_model_automation_policy_projection_event',
  'trg_model_automation_policy_projection_event_update',
]);

const M1_TRIGGER_NAMES = Object.freeze([
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
]);

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function hasExact(columns, names) {
  return columns.size === names.length && names.every(name => columns.has(name));
}

function triggerNames(db) {
  return new Set(db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND (
      name LIKE 'trg_model_automation_%'
      OR name LIKE 'trg_user_settings_model_automation_%'
    )
  `).all().map(row => row.name));
}

export function up(db) {
  const eventColumns = tableColumns(db, 'model_automation_policy_events');
  const policyColumns = tableColumns(db, 'model_automation_policy');

  const isLegacy066 = hasExact(eventColumns, [
    'event_id', 'seq', 'revision', 'auto_failover_enabled',
    'auto_cleanup_enabled', 'auto_cleanup_days', 'actor', 'source', 'request_id',
    'created_at_ms', 'quarantined_legacy',
  ])
    && hasExact(policyColumns, [
      'id', 'revision', 'auto_failover_enabled', 'auto_cleanup_enabled',
      'auto_cleanup_days', 'last_event_id', 'updated_at_ms',
    ]);

  if (isLegacy066) return;

  const isM1Authority = hasExact(eventColumns, [
    'seq', 'event_id', 'request_id', 'schema_version', 'previous_revision',
    'committed_revision', 'event_kind', 'actor', 'source',
    'before_auto_failover_enabled', 'before_auto_cleanup_enabled',
    'before_auto_cleanup_days', 'after_auto_failover_enabled',
    'after_auto_cleanup_enabled', 'after_auto_cleanup_days',
    'legacy_quarantine_json', 'created_at_ms',
  ])
    && hasExact(policyColumns, [
      'id', 'schema_version', 'revision', 'auto_failover_enabled',
      'auto_cleanup_enabled', 'auto_cleanup_days', 'last_event_id', 'updated_at_ms',
    ]);

  if (!isM1Authority) {
    throw new Error('model automation policy schema is neither exact M1 nor legacy 066');
  }

  const triggers = triggerNames(db);
  const missingM1 = M1_TRIGGER_NAMES.filter(name => !triggers.has(name));
  if (missingM1.length > 0) {
    throw new Error(`M1 model automation policy trigger set is incomplete: ${missingM1.join(',')}`);
  }

  const presentLegacy = LEGACY_TRIGGER_NAMES.filter(name => triggers.has(name));
  if (presentLegacy.length === 0) return;
  if (presentLegacy.length !== LEGACY_TRIGGER_NAMES.length) {
    throw new Error('legacy model automation policy trigger set is partially present');
  }

  for (const name of LEGACY_TRIGGER_NAMES) db.exec(`DROP TRIGGER ${name}`);
}

export default { version, description, up };
