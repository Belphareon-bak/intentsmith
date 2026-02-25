// Telemetry Retention — startup pruning for observability tables.
// Deletes rows older than maxAgeDays. Runs once at process start.
// Must never throw — startup must not be blocked by retention failures.

import { logger } from '../core/logger.js';

const TELEMETRY_TABLES = [
  'telemetry_snapshots',
  'llm_execution_log',
  'quality_scores',
  'capability_drift_log',
  'specialist_telemetry',  // v82
];

const ROW_COUNT_WARNING_THRESHOLD = 200_000;

export function pruneTelemetry(db, { maxAgeDays = 30 } = {}) {
  try {
    let totalDeleted = 0;
    for (const table of TELEMETRY_TABLES) {
      const result = db.prepare(`
        DELETE FROM ${table}
        WHERE created_at < datetime('now', ?)
      `).run(`-${maxAgeDays} days`);
      totalDeleted += result.changes;

      const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
      if (cnt > ROW_COUNT_WARNING_THRESHOLD) {
        logger.warn('Retention', `${table} has ${cnt} rows — consider reducing maxAgeDays (currently ${maxAgeDays}d)`);
      }
    }
    if (totalDeleted > 0) {
      logger.info('Retention', `Pruned ${totalDeleted} rows older than ${maxAgeDays}d`);
    }
  } catch (_) { /* retention must never break startup */ }
}
