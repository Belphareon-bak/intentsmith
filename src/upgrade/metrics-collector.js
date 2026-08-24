/**
 * Runtime model telemetry recorder.
 *
 * This module records raw operational events only. It deliberately exposes no
 * quality aggregate, recommendation, blacklist or drift decision: current
 * model quality belongs to the exact-artifact evaluation authority, while the
 * governor may independently summarize raw runtime health.
 */

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 5;
const DISABLE_DURATION_MS = 10 * 60 * 1000;

export class MetricsCollector {
  constructor() {
    this._db = null;
    this._buffer = [];
    this._flushTimer = null;
    this._consecutiveFailures = 0;
    this._disabledUntil = 0;
    this._insertStmt = null;
  }

  setDb(db) {
    this._db = db;
    this._insertStmt = null;
  }

  /** Buffer a raw event. Fire-and-forget: telemetry never breaks execution. */
  recordEvent({ role, model, taskType, success, iterations, tokens, durationMs,
                errorsFixed, errorsRemaining, stopReason, lifecycleId, milestoneId, detail }) {
    try {
      if (!this._db || Date.now() < this._disabledUntil) return;

      this._buffer.push({
        role,
        model,
        taskType,
        success: success ? 1 : 0,
        iterations: iterations ?? 1,
        tokens: tokens ?? 0,
        durationMs: durationMs ?? 0,
        errorsFixed: errorsFixed ?? 0,
        errorsRemaining: errorsRemaining ?? 0,
        stopReason: stopReason ?? null,
        lifecycleId: lifecycleId ?? null,
        milestoneId: milestoneId ?? null,
        detailJson: detail ? JSON.stringify(detail) : null,
      });

      if (this._buffer.length >= BATCH_SIZE) {
        this._flush();
      } else if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => this._flush(), FLUSH_INTERVAL_MS);
      }
    } catch (_) { /* telemetry is best-effort */ }
  }

  _flush() {
    try {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      if (!this._db || this._buffer.length === 0) return;

      if (!this._insertStmt) {
        this._insertStmt = this._db.prepare(`
          INSERT OR IGNORE INTO model_performance
            (role, model, task_type, success, iterations, tokens, duration_ms,
             errors_fixed, errors_remaining, stop_reason, lifecycle_id, milestone_id, detail_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      }

      const batch = [...this._buffer];
      const tx = this._db.transaction((rows) => {
        for (const row of rows) {
          this._insertStmt.run(
            row.role,
            row.model,
            row.taskType,
            row.success,
            row.iterations,
            row.tokens,
            row.durationMs,
            row.errorsFixed,
            row.errorsRemaining,
            row.stopReason,
            row.lifecycleId,
            row.milestoneId,
            row.detailJson,
          );
        }
      });
      tx(batch);
      this._buffer.splice(0, batch.length);
      this._consecutiveFailures = 0;
    } catch (_) {
      this._consecutiveFailures++;
      if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._disabledUntil = Date.now() + DISABLE_DURATION_MS;
      }
    }
  }

  /** Force buffered telemetry to storage; used during shutdown and tests. */
  flush() {
    this._flush();
  }
}

export const metricsCollector = new MetricsCollector();
