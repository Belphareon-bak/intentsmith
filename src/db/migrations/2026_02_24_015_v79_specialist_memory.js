// Migration v79: Specialist Memory (Persistent Context)
// ==============================================================================
//
// specialist_memory — persistent key-value store per specialist + conversation.
// Tools write via explicit memoryWrites contract (opt-in, not automatic).
// Enables cross-session context: "minule jsme počítali s 850k..."
//
// ==============================================================================

import { hasColumn } from '../migrate.js';

export const version = '2026_02_24_015';
export const description = 'Specialist memory (persistent context per specialist+conversation)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'string',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(specialist_id, conversation_id, key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialist_memory_conv ON specialist_memory(specialist_id, conversation_id)`);
}
