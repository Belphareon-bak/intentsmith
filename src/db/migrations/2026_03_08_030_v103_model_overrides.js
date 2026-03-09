// Migration 030 — Model Override Persistence + Upgrade History (v103.1)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_08_030_v103_model_overrides';
export const description = 'Model override persistence + upgrade history for runtime model swaps';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT NOT NULL,
      score REAL,
      applied_by TEXT DEFAULT 'user',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      from_model TEXT NOT NULL,
      to_model TEXT NOT NULL,
      score REAL,
      action TEXT NOT NULL DEFAULT 'apply',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_upgrade_history_role ON upgrade_history(role);
    CREATE INDEX IF NOT EXISTS idx_upgrade_history_created ON upgrade_history(created_at);
  `);
}
