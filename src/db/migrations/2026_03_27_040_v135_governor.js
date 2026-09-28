// v135: System Governor — health reports + improvement proposals
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_27_040_v135_governor';
export const description = 'System Governor health reports and improvement proposals';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS governor_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      overall_health TEXT NOT NULL,
      overall_score REAL NOT NULL,
      dimensions TEXT NOT NULL,
      proposals_json TEXT NOT NULL,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gov_reports_created ON governor_reports(created_at);

    CREATE TABLE IF NOT EXISTS governor_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES governor_reports(id),
      rule_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_action TEXT,
      action_payload TEXT,
      confidence REAL NOT NULL,
      priority REAL NOT NULL,
      root_cause TEXT,
      hash TEXT NOT NULL,
      cooldown_until DATETIME,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gov_proposals_status ON governor_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_gov_proposals_hash ON governor_proposals(hash, status);
    CREATE INDEX IF NOT EXISTS idx_gov_proposals_rule ON governor_proposals(rule_id, status);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS governor_proposals;
    DROP TABLE IF EXISTS governor_reports;
  `);
}
