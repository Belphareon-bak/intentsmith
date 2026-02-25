// v82: Specialist Telemetry — Passive Execution Layer Observability
// ══════════════════════════════════════════════════════════════════════════════
//
// In-memory queue + periodic batch flush to SQLite.
// Tracks tool matches/success/fail, memory hits/misses, lifecycle events, API latency.
//
// Contract:
//   - NEVER throws (all methods wrapped in try/catch)
//   - NEVER blocks (no await before returning response)
//   - NEVER changes control flow
//   - Best-effort: data loss under load is acceptable
//
// Retention handled by centralized telemetry-retention.js (startup pruning).
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── NOOP Sentinel ──────────────────────────────────────────────────────────
// Returned when telemetry is disabled. Eliminates if-guards at all call sites.

const NOOP = Object.freeze({
  record() {},
  getSummary() { return { events: 0 }; },
  flush() {},
  shutdown() {},
});

// ─── Event Type Whitelist ────────────────────────────────────────────────────
// Unknown types → silent ignore. Prevents future drift.

const VALID_EVENT_TYPES = new Set([
  'tool.match', 'tool.success', 'tool.fail', 'tool.clarify',
  'memory.hit', 'memory.miss', 'memory.write',
  'lifecycle.boot', 'lifecycle.enable', 'lifecycle.disable',
  'api.request',
]);

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_METADATA_LENGTH = 1000;

// ─── SpecialistTelemetry ────────────────────────────────────────────────────

export class SpecialistTelemetry {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._queue = [];
    this._stmts = null;
    this._summaryStmts = null;
    this._timer = null;
    this._maxQueue = 500;        // flush at this count
    this._hardLimit = 2000;      // backpressure — drop oldest above this
    this._flushInterval = 30_000; // 30s
  }

  /** Start periodic flush timer. Timer.unref() prevents blocking process.exit. */
  start() {
    this._timer = setInterval(() => this.flush(), this._flushInterval);
    this._timer.unref();
  }

  /**
   * Record a telemetry event. Never throws.
   *
   * @param {string} eventType - Must be in VALID_EVENT_TYPES
   * @param {Object} [opts]
   * @param {string} [opts.specialistId]
   * @param {string} [opts.toolId]
   * @param {number} [opts.durationMs] - Integer ms, never float
   * @param {Object} [opts.metadata] - Flat keys, no sensitive values, max 1KB
   */
  record(eventType, { specialistId, toolId, durationMs, metadata } = {}) {
    try {
      if (!VALID_EVENT_TYPES.has(eventType)) return;

      // Backpressure: drop oldest when queue exceeds hard limit
      if (this._queue.length >= this._hardLimit) {
        this._queue.splice(0, this._queue.length - this._hardLimit + 1);
      }

      let metaStr = metadata ? JSON.stringify(metadata) : null;
      if (metaStr && metaStr.length > MAX_METADATA_LENGTH) {
        metaStr = metaStr.slice(0, MAX_METADATA_LENGTH);
      }

      this._queue.push({
        event_type: eventType,
        specialist_id: specialistId || null,
        tool_id: toolId || null,
        duration_ms: typeof durationMs === 'number' ? Math.round(durationMs) : null,
        metadata: metaStr,
      });

      if (this._queue.length >= this._maxQueue) this.flush();
    } catch { /* swallow — telemetry must never propagate errors */ }
  }

  /** Flush queued events to DB in a single transaction. Never throws. */
  flush() {
    if (this._queue.length === 0) return;
    try {
      const batch = this._queue.splice(0);
      const stmt = this._prepare();
      const runBatch = this.db.transaction((rows) => {
        for (const row of rows) {
          stmt.run(row.event_type, row.specialist_id, row.tool_id,
                   row.duration_ms, row.metadata);
        }
      });
      runBatch(batch);
    } catch (err) {
      // Swallow — events are lost, that's acceptable (best-effort)
      logger.debug('SpecialistTelemetry', `Flush failed (${err.message}), events dropped`);
    }
  }

  /**
   * Get aggregated summary from DB. Does NOT flush queue (never blocks HTTP).
   *
   * @param {Object} [opts]
   * @param {string} [opts.specialistId] - Filter by specialist
   * @param {string} [opts.since] - ISO date string, e.g. '2026-02-01'
   * @returns {{ events: number, byType: Object, bySpecialist: Object, toolMatchRate: number|null, toolSuccessRate: number|null, memoryHitRate: number|null }}
   */
  getSummary({ specialistId, since } = {}) {
    try {
      const stmts = this._prepareSummary();
      const params = [];
      let whereClause = '';
      const conditions = [];

      if (specialistId) {
        conditions.push('specialist_id = ?');
        params.push(specialistId);
      }
      if (since) {
        conditions.push('created_at >= ?');
        params.push(since);
      }
      if (conditions.length > 0) {
        whereClause = 'WHERE ' + conditions.join(' AND ');
      }

      // Total events
      const { total } = this.db.prepare(
        `SELECT COUNT(*) as total FROM specialist_telemetry ${whereClause}`
      ).get(...params);

      // By type
      const byTypeRows = this.db.prepare(
        `SELECT event_type, COUNT(*) as count FROM specialist_telemetry ${whereClause} GROUP BY event_type ORDER BY count DESC`
      ).all(...params);
      const byType = {};
      for (const r of byTypeRows) byType[r.event_type] = r.count;

      // By specialist
      const specWhere = whereClause
        ? `${whereClause} AND specialist_id IS NOT NULL`
        : 'WHERE specialist_id IS NOT NULL';
      const bySpecialistRows = this.db.prepare(
        `SELECT specialist_id, COUNT(*) as count FROM specialist_telemetry ${specWhere} GROUP BY specialist_id ORDER BY count DESC`
      ).all(...params);
      const bySpecialist = {};
      for (const r of bySpecialistRows) bySpecialist[r.specialist_id] = r.count;

      // Derived rates
      const toolMatch = byType['tool.match'] || 0;
      const toolSuccess = byType['tool.success'] || 0;
      const toolFail = byType['tool.fail'] || 0;
      const toolClarify = byType['tool.clarify'] || 0;
      const toolTotal = toolSuccess + toolFail + toolClarify;
      const memoryHit = byType['memory.hit'] || 0;
      const memoryMiss = byType['memory.miss'] || 0;
      const memoryTotal = memoryHit + memoryMiss;

      return {
        events: total,
        byType,
        bySpecialist,
        toolSuccessRate: toolTotal > 0 ? Math.round((toolSuccess / toolTotal) * 100) / 100 : null,
        memoryHitRate: memoryTotal > 0 ? Math.round((memoryHit / memoryTotal) * 100) / 100 : null,
      };
    } catch (err) {
      logger.debug('SpecialistTelemetry', `getSummary failed: ${err.message}`);
      return { events: 0 };
    }
  }

  /** Graceful shutdown: stop timer, flush remaining events. */
  shutdown() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.flush();
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  /** Lazy-prepare INSERT statement. */
  _prepare() {
    if (!this._stmts) {
      this._stmts = this.db.prepare(`
        INSERT INTO specialist_telemetry (event_type, specialist_id, tool_id, duration_ms, metadata)
        VALUES (?, ?, ?, ?, ?)
      `);
    }
    return this._stmts;
  }

  /** Lazy-prepare summary statements. */
  _prepareSummary() {
    if (!this._summaryStmts) {
      this._summaryStmts = true; // marker — dynamic queries used in getSummary
    }
    return this._summaryStmts;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get or create the SpecialistTelemetry singleton.
 * Returns NOOP sentinel when db is null (telemetry disabled).
 *
 * @param {import('better-sqlite3').Database} [db]
 * @returns {SpecialistTelemetry}
 */
export function getSpecialistTelemetry(db = null) {
  if (!_instance) {
    if (!db) return NOOP;
    _instance = new SpecialistTelemetry(db);
    _instance.start();
  }
  return _instance;
}

export default { SpecialistTelemetry, getSpecialistTelemetry, NOOP, VALID_EVENT_TYPES };
