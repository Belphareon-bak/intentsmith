// v68.0 — Knowledge Base: versioned facts, verification sources, audit log
export const version = '2026_02_19_007';
export const description = 'Knowledge base tables for specialist domain facts (D2)';

export function up(db) {
  // 1. Core facts table — one row per atomic fact per validity period
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      specialist_id TEXT,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'number',
      valid_from TEXT,
      valid_to TEXT,
      year INTEGER,
      source TEXT,
      source_url TEXT,
      confidence TEXT NOT NULL DEFAULT 'high',
      is_provisional INTEGER DEFAULT 0,
      verified_at TEXT,
      verified_by TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(domain, category, key, year)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_kf_domain_cat ON knowledge_facts(domain, category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kf_specialist ON knowledge_facts(specialist_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kf_year ON knowledge_facts(year)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kf_key ON knowledge_facts(domain, key)`);

  // 2. Verification sources — replaces hardcoded VERIFICATION_SOURCES
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT,
      affects TEXT NOT NULL DEFAULT '[]',
      keywords TEXT DEFAULT '[]',
      check_frequency_days INTEGER DEFAULT 30,
      last_checked_at DATETIME,
      last_result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Verification audit log
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_verification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact_id INTEGER REFERENCES knowledge_facts(id) ON DELETE CASCADE,
      source_id TEXT REFERENCES knowledge_sources(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      triggered_by TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_kvl_fact ON knowledge_verification_log(fact_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_kvl_action ON knowledge_verification_log(action)`);
}
