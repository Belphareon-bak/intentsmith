// v62: Add active_session_id to project_lifecycles (C4 multi-session)
// For existing pre-v62 DBs only — baseline already includes this column.

import { hasColumn } from '../migrate.js';

export const version = '2026_02_14_003_v62_active_session';
export const description = 'Add active_session_id to project_lifecycles (v62)';

export function up(db) {
  if (!hasColumn(db, 'project_lifecycles', 'active_session_id')) {
    db.exec('ALTER TABLE project_lifecycles ADD COLUMN active_session_id TEXT');
  }
}
