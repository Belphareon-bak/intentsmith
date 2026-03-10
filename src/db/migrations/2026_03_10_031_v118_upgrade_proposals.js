// Migration 031 — Upgrade Proposals + Model Catalog Cache (v118 Phase 2)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_10_031_v118_upgrade_proposals';
export const description = 'Upgrade proposals with cooldown/dismissed/anti-thrashing + model catalog cache';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      current_model TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      score REAL NOT NULL,
      current_score REAL,
      improvement REAL,
      score_breakdown TEXT,
      reason TEXT,
      risk_level TEXT DEFAULT 'medium',
      installed INTEGER DEFAULT 0,
      size_gb REAL DEFAULT 0,
      source TEXT DEFAULT 'local',
      status TEXT DEFAULT 'pending',
      catalog_hash TEXT,
      evaluation_version TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      cooldown_until DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_proposals_status
      ON upgrade_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_proposals_role_status
      ON upgrade_proposals(role, status);
    CREATE INDEX IF NOT EXISTS idx_proposals_cooldown
      ON upgrade_proposals(role, candidate_model, cooldown_until);
    CREATE INDEX IF NOT EXISTS idx_proposals_candidate_status
      ON upgrade_proposals(candidate_model, status);

    CREATE TABLE IF NOT EXISTS model_catalog_cache (
      model_name TEXT PRIMARY KEY,
      exists_in_registry INTEGER,
      metadata_json TEXT,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_cache_verified
      ON model_catalog_cache(verified_at);
  `);
}
