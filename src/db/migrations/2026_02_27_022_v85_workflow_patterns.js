// Migration v85.1: Workflow Pattern Detection
// ==============================================================================
//
// Tracks repeating tool/decision sequences across sessions.
// When count >= threshold, detector proposes creating a skill.
//
// ==============================================================================

export const version = '2026_02_27_022';
export const description = 'Workflow pattern detection for skill proposals';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_patterns (
      pattern_hash TEXT PRIMARY KEY,
      tool_sequence TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_seen DATETIME NOT NULL,
      proposed INTEGER NOT NULL DEFAULT 0,
      session_ids TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_wp_count ON workflow_patterns(count)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wp_proposed ON workflow_patterns(proposed)`);
}
