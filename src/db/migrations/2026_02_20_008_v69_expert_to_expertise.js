// v69.0 — Rename: expert → expertise
// Soft migration: create new tables + copy data, keep old tables as fallback.
export const version = '2026_02_20_008';
export const description = 'Rename expert tables to expertise (soft migration, old tables kept)';

function addColumnIfMissing(db, table, column, type) {
  const cols = db.pragma(`table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function hasColumn(db, table, column) {
  const cols = db.pragma(`table_info(${table})`);
  return cols.some(c => c.name === column);
}

export function up(db) {
  // ═══════════════════════════════════════════════════════════════
  // 1. NEW TABLES with explicit DDL (schema copy)
  // ═══════════════════════════════════════════════════════════════

  db.exec(`
    CREATE TABLE IF NOT EXISTS expertises (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      domain TEXT,
      system_prompt TEXT,
      temperature REAL DEFAULT 0.5 CHECK(temperature >= 0 AND temperature <= 1),
      config TEXT NOT NULL DEFAULT '{}',
      is_builtin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO expertises
      (id, name, description, domain, system_prompt, temperature, config, is_builtin, created_at, updated_at)
    SELECT id, name, description, domain, system_prompt, temperature, config, is_builtin, created_at, updated_at
    FROM experts
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expertise_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      expertise_id TEXT NOT NULL,
      locked INTEGER DEFAULT 0,
      strength INTEGER DEFAULT 50 CHECK(strength >= 0 AND strength <= 100),
      locked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id)
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO expertise_bindings
      (id, conversation_id, expertise_id, locked, strength, locked_at, created_at, updated_at)
    SELECT id, conversation_id, expert_id, locked, strength, locked_at, created_at, updated_at
    FROM conversation_experts
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expertise_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expertise_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      previous_value TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(expertise_id, key)
    )
  `);

  // expert_memory may or may not have previous_value (added post-baseline)
  if (hasColumn(db, 'expert_memory', 'previous_value')) {
    db.exec(`
      INSERT OR IGNORE INTO expertise_memory
        (id, expertise_id, key, value, previous_value, created_at, updated_at)
      SELECT id, expert_id, key, value, previous_value, created_at, updated_at
      FROM expert_memory
    `);
  } else {
    db.exec(`
      INSERT OR IGNORE INTO expertise_memory
        (id, expertise_id, key, value, created_at, updated_at)
      SELECT id, expert_id, key, value, created_at, updated_at
      FROM expert_memory
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_expertises (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO custom_expertises (id, config, created_at)
    SELECT id, config, created_at FROM custom_experts
  `);

  // ═══════════════════════════════════════════════════════════════
  // 2. ADD COLUMN to existing tables (idempotent via JS check)
  // ═══════════════════════════════════════════════════════════════

  addColumnIfMissing(db, 'capability_drift_log', 'expertise_id', 'TEXT');
  addColumnIfMissing(db, 'llm_execution_log', 'expertise_id', 'TEXT');

  db.exec(`UPDATE capability_drift_log SET expertise_id = expert_id WHERE expertise_id IS NULL`);
  db.exec(`UPDATE llm_execution_log SET expertise_id = expert_id WHERE expertise_id IS NULL`);

  // ═══════════════════════════════════════════════════════════════
  // 3. INDEXES on new tables + new columns
  // ═══════════════════════════════════════════════════════════════

  db.exec(`CREATE INDEX IF NOT EXISTS idx_expertise_bindings_conv ON expertise_bindings(conversation_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_expertises_domain ON expertises(domain)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_expertise_memory_id ON expertise_memory(expertise_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cap_drift_expertise ON capability_drift_log(expertise_id)`);

  // ═══════════════════════════════════════════════════════════════
  // 4. OLD TABLES KEPT (drop in next major version)
  // experts, conversation_experts, expert_memory, custom_experts
  // capability_drift_log.expert_id, llm_execution_log.expert_id
  // ═══════════════════════════════════════════════════════════════
}

export function down(db) {
  // Reverse: drop new tables (old tables still exist as fallback)
  db.exec(`DROP TABLE IF EXISTS custom_expertises`);
  db.exec(`DROP TABLE IF EXISTS expertise_memory`);
  db.exec(`DROP TABLE IF EXISTS expertise_bindings`);
  db.exec(`DROP TABLE IF EXISTS expertises`);
  db.exec(`DROP INDEX IF EXISTS idx_cap_drift_expertise`);
}
