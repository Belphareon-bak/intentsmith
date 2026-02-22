// Migration v73: Compliance Layer (Phase 5)
// ══════════════════════════════════════════════════════════════════════════════
//
// compliance_checks — stores results of compliance verification runs
//
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_02_22_011';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      rule_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      period TEXT,
      status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'violation', 'not_applicable')),
      checked_at TEXT DEFAULT (datetime('now')),
      detail_json TEXT,
      UNIQUE(entity_id, rule_code, year, period)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cc_entity_year ON compliance_checks(entity_id, year)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cc_rule ON compliance_checks(rule_code, year)`);
}
