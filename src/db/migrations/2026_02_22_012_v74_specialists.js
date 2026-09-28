// Migration v74: Specialist Lifecycle (Package System)
// ==============================================================================
//
// specialists            — installed specialist packages + status
// specialist_migrations  — per-specialist migration tracking (separate from core)
//
// ==============================================================================

export const version = '2026_02_22_012';
export const description = 'Specialist lifecycle tables';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialists (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'domain'
        CHECK (type IN ('domain', 'utility', 'integration')),
      status TEXT NOT NULL DEFAULT 'installed'
        CHECK (status IN ('installed', 'enabled', 'disabled')),
      manifest_json TEXT NOT NULL,
      installed_at TEXT DEFAULT (datetime('now')),
      enabled_at TEXT,
      disabled_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
      migration_name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      UNIQUE(specialist_id, migration_name)
    )
  `);
}
