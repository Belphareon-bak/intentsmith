// Migration 035: Marketplace package tracking + catalog cache
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_12_035_v123_marketplace';
export const description = 'Marketplace package tracking and catalog cache';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_packages (
      id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('skill', 'expertise', 'specialist')),
      name TEXT,
      version TEXT,
      author TEXT,
      description TEXT,
      tags TEXT,
      dependencies TEXT,
      download_url TEXT,
      sha256 TEXT,
      catalog_data TEXT,
      installed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_mp_type ON marketplace_packages(type);

    CREATE TABLE IF NOT EXISTS marketplace_catalog_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      catalog_json TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      etag TEXT
    );
  `);
}
