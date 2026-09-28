// Migration v78: Drop old expert-named tables
// ==============================================================================
//
// v69 soft migration created new expertise-named tables and copied data.
// All code has been migrated to use the new names since v69.
// This migration drops the old fallback tables that are no longer referenced.
//
// Dropped tables: experts, conversation_experts, expert_memory, custom_experts
// Dropped columns: capability_drift_log.expert_id, llm_execution_log.expert_id
//   (SQLite doesn't support DROP COLUMN before 3.35.0, so we skip column drops
//    — the columns remain but are unused.)
//
// ==============================================================================

export const version = '2026_02_24_014';
export const description = 'Drop old expert-named tables (superseded by expertise tables in v69)';

export function up(db) {
  db.exec(`DROP TABLE IF EXISTS custom_experts`);
  db.exec(`DROP TABLE IF EXISTS expert_memory`);
  db.exec(`DROP TABLE IF EXISTS conversation_experts`);
  db.exec(`DROP TABLE IF EXISTS experts`);
}
