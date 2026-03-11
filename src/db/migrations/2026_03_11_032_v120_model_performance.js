export const version = '2026_03_11_032_v120_model_performance';
export const description = 'Empirical model performance metrics for Phase 3 scoring';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      iterations INTEGER DEFAULT 1,
      tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      errors_fixed INTEGER DEFAULT 0,
      errors_remaining INTEGER DEFAULT 0,
      stop_reason TEXT,
      lifecycle_id TEXT,
      milestone_id TEXT,
      detail_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_mp_role_model
      ON model_performance(role, model);
    CREATE INDEX IF NOT EXISTS idx_mp_role_created
      ON model_performance(role, created_at);
    CREATE INDEX IF NOT EXISTS idx_mp_model_task
      ON model_performance(model, task_type);
  `);
}
