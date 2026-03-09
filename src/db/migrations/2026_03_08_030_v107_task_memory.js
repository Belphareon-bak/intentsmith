// Migration 030 — Task Memory (v107)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_08_030_v107_task_memory';
export const description = 'Task memory — cross-milestone learning for execution loop';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.8,
      milestone_id TEXT,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      UNIQUE(project_id, kind, key)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_memory_project ON task_memory(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_memory_key ON task_memory(project_id, key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_memory_kind ON task_memory(project_id, kind)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_memory_confidence ON task_memory(confidence)`);
}
