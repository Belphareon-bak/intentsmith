// Migration 043: Create drafts table
// Drafts were in the baseline schema but never got a standalone migration —
// existing DBs are missing this table.

export const version = '2026_04_12_043_drafts_table';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id),
      UNIQUE(project_id)
    );
  `);
}
