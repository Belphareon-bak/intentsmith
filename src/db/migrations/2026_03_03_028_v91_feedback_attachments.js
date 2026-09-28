// Migration 028: Feedback attachments stored on disk

export const version = '2026_03_03_028_v91_feedback_attachments';
export const description = 'Feedback attachment file references';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fb_attach_fid ON feedback_attachments(feedback_id)`);
}
