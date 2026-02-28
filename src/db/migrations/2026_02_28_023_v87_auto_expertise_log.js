// Migration v87: Auto Expertise Selection Metrics
// ==============================================================================
//
// Logs every auto-expertise selection decision for trend tracking.
// Tracks: which expertise was selected, confidence, scores, and input preview.
//
// ==============================================================================

export const version = '2026_02_28_023';
export const description = 'Auto expertise selection metrics log';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_expertise_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      input_preview TEXT,
      selected_id TEXT,
      confidence REAL,
      scores_json TEXT,
      reason TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_auto_expertise_ts ON auto_expertise_log(timestamp)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auto_expertise_selected ON auto_expertise_log(selected_id)`);
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS auto_expertise_log');
}
