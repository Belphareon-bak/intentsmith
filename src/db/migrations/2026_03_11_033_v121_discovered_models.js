export const version = '2026_03_11_033_v121_discovered_models';
export const description = 'L4 Online Discovery — provisional model entries';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL,
      params REAL,
      category TEXT,
      base_vram_mb INTEGER,
      context_window INTEGER,
      benchmarks_json TEXT,
      benchmark_confidence REAL,
      capabilities_json TEXT,
      source TEXT DEFAULT 'L4',
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_dm_family ON discovered_models(family);
    CREATE INDEX IF NOT EXISTS idx_dm_name ON discovered_models(name);
  `);
}
