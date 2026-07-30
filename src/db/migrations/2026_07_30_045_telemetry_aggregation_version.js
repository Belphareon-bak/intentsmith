// Migration 045 — Version telemetry metric aggregation semantics
// ==============================================================================
//
// Rows created before this migration used the original denominator semantics.
// SQLite applies the legacy default without rebuilding or rewriting the table.
//
// ==============================================================================

import { hasColumn } from '../migrate.js';

export const version = '2026_07_30_045_telemetry_aggregation_version';
export const description = 'Version telemetry_metrics aggregation semantics';

export function up(db) {
  if (!hasColumn(db, 'telemetry_metrics', 'aggregation_version')) {
    db.exec(`
      ALTER TABLE telemetry_metrics
      ADD COLUMN aggregation_version INTEGER NOT NULL DEFAULT 1
    `);
  }
}
