// Migration v80: Quality Scores Telemetry
// ==============================================================================
//
// quality_scores — deterministic quality metrics logged per artifact per version.
// Score ≠ Gate. Diagnostic, not blocking.
//
// Tracks: spec_score, roadmap_score, change_score, lifecycle_score
// Each with breakdown (JSON sub-metrics) and label (EXCELLENT/GOOD/ACCEPTABLE/WEAK).
//
// ==============================================================================

export const version = '2026_02_24_016';
export const description = 'Quality scores telemetry (deterministic diagnostic metrics)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_version INTEGER,
      score REAL NOT NULL,
      label TEXT NOT NULL,
      breakdown TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lifecycle_id) REFERENCES project_lifecycles(id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quality_scores_lifecycle ON quality_scores(lifecycle_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quality_scores_type ON quality_scores(lifecycle_id, artifact_type)`);
}
