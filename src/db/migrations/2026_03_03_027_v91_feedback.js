// Migration 027: Feedback table for user feedback from About panel
export default {
  id: '027_v91_feedback',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'other',
        message TEXT NOT NULL,
        version TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
};
