// Migration v92: Checkpoint Mode on Milestones
// ==============================================================================
// Adds checkpoint_mode column (STRUCTURAL/FUNCTIONAL/SECURITY) to milestones.
// Controls checkpoint strictness per milestone.
// ==============================================================================

import { hasColumn } from '../migrate.js';

export const version = '2026_03_02_026';
export const description = 'Add checkpoint_mode to milestones';

export function up(db) {
  if (!hasColumn(db, 'milestones', 'checkpoint_mode')) {
    db.exec(`ALTER TABLE milestones ADD COLUMN checkpoint_mode TEXT DEFAULT 'FUNCTIONAL'`);
  }
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN before 3.35.0 — recreate table would be needed
  // For simplicity, this is a no-op since the column is harmless
}
