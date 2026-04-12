// Migration 044 — Runtime guard state for model auto-disable/recovery (v138)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_04_12_044_v138_runtime_guard';
export const description = 'Add model_runtime_guard table for runtime error-rate safety guard';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_runtime_guard (
      model_name TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'enabled',
      error_rate REAL,
      sample_size INTEGER,
      window_seconds INTEGER,
      disabled_until DATETIME,
      reason TEXT,
      last_event_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_guard_state ON model_runtime_guard(state);
    CREATE INDEX IF NOT EXISTS idx_runtime_guard_disabled_until ON model_runtime_guard(disabled_until);
    CREATE INDEX IF NOT EXISTS idx_runtime_guard_updated ON model_runtime_guard(updated_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS model_runtime_guard;
  `);
}

