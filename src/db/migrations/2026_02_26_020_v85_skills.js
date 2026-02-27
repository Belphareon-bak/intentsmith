// Migration v85: Skills System
// ==============================================================================
//
// Deterministic macro-recipes — reusable step sequences for repeating tasks.
//
// Two tables:
//   skill_executions — execution lifecycle (IDLE → CONFIRMING → EXECUTING → DONE/FAILED)
//   skill_steps      — per-step audit log with timing, retry, and output hash
//
// ==============================================================================

export const version = '2026_02_26_020';
export const description = 'Skills system (executions + step audit)';

export function up(db) {
  // ── Skill execution lifecycle ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_executions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      skill_version INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'IDLE',
      input TEXT NOT NULL,
      params TEXT,
      steps_output TEXT,
      confidence REAL,
      current_step_id TEXT,
      error_message TEXT,
      session_id TEXT,
      conversation_id TEXT,
      locked_at DATETIME,
      started_at DATETIME,
      confirmed_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_exec_state ON skill_executions(state)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_exec_skill ON skill_executions(skill_id)`);

  // ── Per-step audit log ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL REFERENCES skill_executions(id),
      step_id TEXT NOT NULL,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_type TEXT,
      output TEXT,
      output_hash TEXT,
      retryable INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      duration_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_steps_exec ON skill_steps(execution_id)`);
}
