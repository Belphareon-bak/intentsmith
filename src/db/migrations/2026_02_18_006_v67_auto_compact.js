// v67.0 — Auto-Compact: add summary_up_to_msg_id column to conversations
export const version = '2026_02_18_006';
export const description = 'Add summary_up_to_msg_id column for auto-compact context compression';

export function up(db) {
  // Check if column already exists (idempotent)
  const cols = db.pragma('table_info(conversations)').map(c => c.name);
  if (!cols.includes('summary_up_to_msg_id')) {
    db.exec('ALTER TABLE conversations ADD COLUMN summary_up_to_msg_id INTEGER DEFAULT NULL');
  }
}
