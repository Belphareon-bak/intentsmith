export const version = '2026_03_12_034_v123_validation_results';
export const description = 'Validation test suite results for synthetic model evaluation';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      suite TEXT NOT NULL,
      test_name TEXT NOT NULL,
      passed INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT,
      duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_vr_model_suite
      ON validation_results(model, suite);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vr_unique
      ON validation_results(model, suite, test_name);

    CREATE TABLE IF NOT EXISTS validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0,
      passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_vss_model_suite
      ON validation_suite_scores(model, suite);
  `);
}
