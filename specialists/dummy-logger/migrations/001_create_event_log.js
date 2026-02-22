// Migration: Create event_log table for dummy-logger specialist
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info'
        CHECK (level IN ('debug', 'info', 'warn', 'error')),
      source TEXT NOT NULL DEFAULT 'system',
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_event_log_level ON event_log(level)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at)`);
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function down(db) {
  db.exec(`DROP TABLE IF EXISTS event_log`);
}
