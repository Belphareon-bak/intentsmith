// Migration 029 — Architecture Governance tables (v98)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_05_029_v98_architecture_governance';
export const description = 'Architecture state tracking + API contract registry for cross-milestone governance';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS architecture_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
      milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
      phase TEXT NOT NULL DEFAULT 'post',
      layer_violations INTEGER DEFAULT 0,
      circular_deps INTEGER DEFAULT 0,
      naming_issues INTEGER DEFAULT 0,
      api_surface_count INTEGER DEFAULT 0,
      drift_score REAL DEFAULT 1.0,
      acf_score REAL DEFAULT 1.0,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_arch_state_lifecycle ON architecture_state(lifecycle_id);
    CREATE INDEX IF NOT EXISTS idx_arch_state_milestone ON architecture_state(milestone_id);

    CREATE TABLE IF NOT EXISTS api_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
      milestone_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      export_name TEXT NOT NULL,
      signature TEXT,
      kind TEXT NOT NULL DEFAULT 'function',
      consumer_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      removed_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_api_contracts_lifecycle ON api_contracts(lifecycle_id);
    CREATE INDEX IF NOT EXISTS idx_api_contracts_file ON api_contracts(file_path);
    CREATE INDEX IF NOT EXISTS idx_api_contracts_export ON api_contracts(export_name);
  `);
}
