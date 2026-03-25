// Migration 027: Feedback table with runtime context

export const version = '2026_03_03_027_v91_feedback';
export const description = 'Feedback table for user bug reports and feature requests';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'other',
      message TEXT NOT NULL,
      version TEXT,
      context TEXT,
      last_response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
