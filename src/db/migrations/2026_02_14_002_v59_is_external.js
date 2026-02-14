// v59: Add is_external column to projects table
// For existing pre-v59 DBs only — baseline already includes this column.

import { hasColumn } from '../migrate.js';

export const version = '2026_02_14_002_v59_is_external';
export const description = 'Add is_external column to projects (v59)';

export function up(db) {
  if (!hasColumn(db, 'projects', 'is_external')) {
    db.exec('ALTER TABLE projects ADD COLUMN is_external INTEGER DEFAULT 0');
  }
}
