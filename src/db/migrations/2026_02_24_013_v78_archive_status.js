// Migration v78: Archive & Soft-Delete Status for Projects and Conversations
// ==============================================================================
//
// Adds `status` column (active | archived | deleted) to projects and conversations.
// Adds `archived_at` and `deleted_at` timestamps.
// Existing records default to 'active'.
//
// ==============================================================================

import { hasColumn } from '../migrate.js';

export const version = '2026_02_24_013';
export const description = 'Archive status for projects and conversations';

export function up(db) {
  // Projects: status + timestamps
  if (!hasColumn(db, 'projects', 'status')) {
    db.exec(`ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!hasColumn(db, 'projects', 'archived_at')) {
    db.exec(`ALTER TABLE projects ADD COLUMN archived_at DATETIME`);
  }
  if (!hasColumn(db, 'projects', 'deleted_at')) {
    db.exec(`ALTER TABLE projects ADD COLUMN deleted_at DATETIME`);
  }

  // Conversations: archived_at + deleted_at (already has `state` column, repurpose it)
  if (!hasColumn(db, 'conversations', 'archived_at')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN archived_at DATETIME`);
  }
  if (!hasColumn(db, 'conversations', 'deleted_at')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN deleted_at DATETIME`);
  }

  // Index for fast filtering
  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state)`);
}
