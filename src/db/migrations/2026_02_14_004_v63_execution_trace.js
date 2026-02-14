// v63.3: Add execution_trace_id + execution_step to audit tables
// For existing pre-v63.3 DBs only — baseline already includes these columns.

import { hasColumn } from '../migrate.js';

export const version = '2026_02_14_004_v63_execution_trace';
export const description = 'Add execution_trace_id to audit tables, execution_step to capability_drift_log (v63.3)';

export function up(db) {
  // merge_audit_log
  if (!hasColumn(db, 'merge_audit_log', 'execution_trace_id')) {
    db.exec('ALTER TABLE merge_audit_log ADD COLUMN execution_trace_id TEXT');
  }

  // capability_drift_log
  if (!hasColumn(db, 'capability_drift_log', 'execution_trace_id')) {
    db.exec('ALTER TABLE capability_drift_log ADD COLUMN execution_trace_id TEXT');
  }
  if (!hasColumn(db, 'capability_drift_log', 'execution_step')) {
    db.exec('ALTER TABLE capability_drift_log ADD COLUMN execution_step TEXT');
  }

  // Indexes (IF NOT EXISTS = safe to run always)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_merge_audit_trace ON merge_audit_log(execution_trace_id);
    CREATE INDEX IF NOT EXISTS idx_cap_drift_trace ON capability_drift_log(execution_trace_id);
    CREATE INDEX IF NOT EXISTS idx_llm_exec_trace ON llm_execution_log(execution_trace_id);
  `);
}
