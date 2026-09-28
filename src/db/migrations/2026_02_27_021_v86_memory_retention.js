// Migration v86: Memory & Retention
// ==============================================================================
//
// 1. Add indexes on created_at for all tables that need time-based pruning
// 2. Add `archived` column to messages (archive-before-delete)
// 3. Add `summary_archive` to conversations (extended summary for archived messages)
// 4. Ensure memory table exists with access_count, last_accessed_at for confidence decay
//
// ==============================================================================

import { hasColumn, hasTable } from '../migrate.js';

export const version = '2026_02_27_021';
export const description = 'Memory persistence & data retention (indexes, archived, decay)';

export function up(db) {
  // ── 1. Retention indexes (critical for DELETE WHERE created_at < ?) ──
  const indexDefs = [
    ['idx_messages_created_at',            'messages',             'messages(created_at)'],
    ['idx_agent_logs_created_at',          'agent_logs',           'agent_logs(created_at)'],
    ['idx_execution_trace_created_at',     'execution_trace',      'execution_trace(created_at)'],
    ['idx_cre_override_log_created_at',    'cre_override_log',     'cre_override_log(created_at)'],
    ['idx_conversation_memory_created_at', 'conversation_memory',  'conversation_memory(created_at)'],
    ['idx_conversations_deleted_at',       'conversations',        'conversations(deleted_at)'],
    ['idx_projects_status',                'projects',             'projects(status)'],
  ];

  for (const [name, table, def] of indexDefs) {
    if (hasTable(db, table)) {
      db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
    }
  }

  // ── 2. Messages: archived flag ──
  if (!hasColumn(db, 'messages', 'archived')) {
    db.exec(`ALTER TABLE messages ADD COLUMN archived INTEGER DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages(archived, created_at)`);

  // ── 3. Conversations: summary_archive for extended archive summaries ──
  if (!hasColumn(db, 'conversations', 'summary_archive')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN summary_archive TEXT`);
  }

  // ── 4. Memory table: ensure exists with decay/access columns ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSON NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT DEFAULT 'explicit',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used DATETIME,
      ttl INTEGER,
      UNIQUE(user_id, kind, key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_user_kind ON memory(user_id, kind)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(user_id, key)`);

  if (!hasColumn(db, 'memory', 'access_count')) {
    db.exec(`ALTER TABLE memory ADD COLUMN access_count INTEGER DEFAULT 0`);
  }
  if (!hasColumn(db, 'memory', 'last_accessed_at')) {
    db.exec(`ALTER TABLE memory ADD COLUMN last_accessed_at DATETIME`);
  }
}
