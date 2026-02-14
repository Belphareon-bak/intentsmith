// Migration 005: v64.0 — CRE Override Audit Log
// ══════════════════════════════════════════════════════════════════════════════
// Adds cre_override_log table for Gatekeeper audit trail.
// Every decision created via overrideDecision() or intercept logged via
// logIntercept() can optionally be persisted here for post-mortem analysis.
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_02_14_005_v64_cre_override_log';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cre_override_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_trace_id TEXT,
      conversation_id TEXT,
      session_id TEXT,
      event_type TEXT NOT NULL DEFAULT 'override',
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      decision_type TEXT,
      decision_intent TEXT,
      original_type TEXT,
      original_intent TEXT,
      confidence REAL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cre_override_trace ON cre_override_log(execution_trace_id);
    CREATE INDEX IF NOT EXISTS idx_cre_override_conv ON cre_override_log(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_cre_override_source ON cre_override_log(source);
    CREATE INDEX IF NOT EXISTS idx_cre_override_type ON cre_override_log(event_type);
  `);
}
