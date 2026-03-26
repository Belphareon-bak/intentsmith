// v133: Model usage tracking for auto-cleanup decisions
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_26_039_v133_model_usage';
export const description = 'Model usage tracking for auto-cleanup (ModelRegistry)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      role TEXT NOT NULL,
      used_at TEXT DEFAULT (datetime('now')),
      request_type TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mu_model ON model_usage(model);
    CREATE INDEX IF NOT EXISTS idx_mu_used ON model_usage(used_at DESC);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS model_usage;`);
}
