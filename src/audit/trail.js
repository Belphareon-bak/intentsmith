// Audit Trail — Immutable Event Log
// ══════════════════════════════════════════════════════════════════════════════
//
// Immutable audit trail for all agent operations.
// Events cannot be modified or deleted after creation.
//
// Schema:
//   id            - auto-increment
//   plan_id       - associated plan (nullable)
//   timestamp     - event timestamp
//   actor         - who performed the action
//   action        - what happened (PLAN_STARTED, STEP_EXECUTED, etc.)
//   payload_hash  - SHA256 of payload for integrity
//   payload       - JSON payload
//
// ══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import db from '../db/database.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

function initAuditTable() {
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_audit_plan_id ON audit_events(plan_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
    `);
    logger.debug('AuditTrail', 'Audit table initialized');
  } catch (err) {
    logger.error('AuditTrail', `Failed to initialize audit table: ${err.message}`);
  }
}

// Initialize on module load
initAuditTable();

// ════════════════════════════════════════════════════════════════════════════
// AUDIT ACTIONS (enum)
// ════════════════════════════════════════════════════════════════════════════

export const AuditAction = {
  // Plan lifecycle
  PLAN_STARTED: 'PLAN_STARTED',
  PLAN_COMPLETED: 'PLAN_COMPLETED',
  PLAN_FAILED: 'PLAN_FAILED',
  PLAN_ERROR: 'PLAN_ERROR',
  PLAN_APPROVED: 'PLAN_APPROVED',
  PLAN_REJECTED: 'PLAN_REJECTED',

  // Step execution
  STEP_STARTED: 'STEP_STARTED',
  STEP_COMPLETED: 'STEP_COMPLETED',
  STEP_FAILED: 'STEP_FAILED',
  STEP_SKIPPED: 'STEP_SKIPPED',

  // Tool execution
  TOOL_CALLED: 'TOOL_CALLED',
  TOOL_RESULT: 'TOOL_RESULT',
  TOOL_ERROR: 'TOOL_ERROR',
  TOOL_GATED: 'TOOL_GATED',

  // Human gate
  GATE_REQUESTED: 'GATE_REQUESTED',
  GATE_APPROVED: 'GATE_APPROVED',
  GATE_DENIED: 'GATE_DENIED',

  // System
  SYSTEM_START: 'SYSTEM_START',
  SYSTEM_STOP: 'SYSTEM_STOP',
  CONFIG_CHANGED: 'CONFIG_CHANGED',
};

// ════════════════════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ════════════════════════════════════════════════════════════════════════════

class AuditTrail {
  constructor() {
    this.insertStmt = null;
    this.prepareStatements();
  }

  prepareStatements() {
    try {
      this.insertStmt = db.db.prepare(`
        INSERT INTO audit_events (plan_id, timestamp, actor, action, payload_hash, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
    } catch (err) {
      logger.warn('AuditTrail', `Failed to prepare statements: ${err.message}`);
    }
  }

  /**
   * Log an audit event (immutable)
   *
   * @param {Object} event
   * @param {string} [event.plan_id] - Associated plan ID
   * @param {string} event.actor - Who performed the action
   * @param {string} event.action - Action type (from AuditAction)
   * @param {Object} [event.payload] - Additional event data
   * @returns {{ id: number, timestamp: number, payload_hash: string }}
   */
  log(event) {
    const timestamp = Date.now();
    const payload = event.payload || {};
    const payloadStr = JSON.stringify(payload);
    const payloadHash = this.hashPayload(payloadStr);

    try {
      if (!this.insertStmt) {
        this.prepareStatements();
      }

      const result = this.insertStmt.run(
        event.plan_id || null,
        timestamp,
        event.actor,
        event.action,
        payloadHash,
        payloadStr
      );

      logger.debug('AuditTrail', `Event logged: ${event.action}`, {
        id: result.lastInsertRowid,
        plan_id: event.plan_id,
        actor: event.actor,
      });

      return {
        id: result.lastInsertRowid,
        timestamp,
        payload_hash: payloadHash,
      };
    } catch (err) {
      logger.error('AuditTrail', `Failed to log event: ${err.message}`, { event });
      // Don't throw - audit should not break the main flow
      return { id: null, timestamp, payload_hash: payloadHash };
    }
  }

  /**
   * Query events by plan ID
   *
   * @param {string} planId
   * @returns {AuditEvent[]}
   */
  getByPlanId(planId) {
    try {
      const stmt = db.db.prepare(`
        SELECT id, plan_id, timestamp, actor, action, payload_hash, payload
        FROM audit_events
        WHERE plan_id = ?
        ORDER BY timestamp ASC
      `);

      return stmt.all(planId).map(row => ({
        ...row,
        payload: JSON.parse(row.payload),
      }));
    } catch (err) {
      logger.error('AuditTrail', `Failed to query events: ${err.message}`);
      return [];
    }
  }

  /**
   * Query events by action type
   *
   * @param {string} action
   * @param {Object} [options]
   * @param {number} [options.limit=100]
   * @param {number} [options.since] - Timestamp
   * @returns {AuditEvent[]}
   */
  getByAction(action, options = {}) {
    const { limit = 100, since = 0 } = options;

    try {
      const stmt = db.db.prepare(`
        SELECT id, plan_id, timestamp, actor, action, payload_hash, payload
        FROM audit_events
        WHERE action = ? AND timestamp > ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      return stmt.all(action, since, limit).map(row => ({
        ...row,
        payload: JSON.parse(row.payload),
      }));
    } catch (err) {
      logger.error('AuditTrail', `Failed to query events: ${err.message}`);
      return [];
    }
  }

  /**
   * Query recent events
   *
   * @param {Object} [options]
   * @param {number} [options.limit=100]
   * @param {number} [options.since] - Timestamp
   * @returns {AuditEvent[]}
   */
  getRecent(options = {}) {
    const { limit = 100, since = 0 } = options;

    try {
      const stmt = db.db.prepare(`
        SELECT id, plan_id, timestamp, actor, action, payload_hash, payload
        FROM audit_events
        WHERE timestamp > ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      return stmt.all(since, limit).map(row => ({
        ...row,
        payload: JSON.parse(row.payload),
      }));
    } catch (err) {
      logger.error('AuditTrail', `Failed to query events: ${err.message}`);
      return [];
    }
  }

  /**
   * Verify event integrity
   *
   * @param {number} eventId
   * @returns {{ valid: boolean, expected?: string, actual?: string }}
   */
  verifyIntegrity(eventId) {
    try {
      const stmt = db.db.prepare(`
        SELECT payload_hash, payload FROM audit_events WHERE id = ?
      `);

      const row = stmt.get(eventId);
      if (!row) {
        return { valid: false, error: 'Event not found' };
      }

      const actualHash = this.hashPayload(row.payload);
      const valid = actualHash === row.payload_hash;

      if (!valid) {
        logger.error('AuditTrail', `Integrity check failed for event ${eventId}`, {
          expected: row.payload_hash,
          actual: actualHash,
        });
      }

      return {
        valid,
        expected: row.payload_hash,
        actual: actualHash,
      };
    } catch (err) {
      logger.error('AuditTrail', `Integrity check failed: ${err.message}`);
      return { valid: false, error: err.message };
    }
  }

  /**
   * Get audit statistics
   *
   * @returns {Object}
   */
  getStats() {
    try {
      const total = db.db.prepare('SELECT COUNT(*) as count FROM audit_events').get();
      const byAction = db.db.prepare(`
        SELECT action, COUNT(*) as count
        FROM audit_events
        GROUP BY action
        ORDER BY count DESC
      `).all();

      const recent24h = db.db.prepare(`
        SELECT COUNT(*) as count
        FROM audit_events
        WHERE timestamp > ?
      `).get(Date.now() - 24 * 60 * 60 * 1000);

      return {
        total_events: total.count,
        events_24h: recent24h.count,
        by_action: byAction.reduce((acc, r) => ({ ...acc, [r.action]: r.count }), {}),
      };
    } catch (err) {
      logger.error('AuditTrail', `Failed to get stats: ${err.message}`);
      return { total_events: 0, events_24h: 0, by_action: {} };
    }
  }

  /**
   * Hash payload for integrity verification
   */
  hashPayload(payloadStr) {
    return createHash('sha256').update(payloadStr).digest('hex');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export const auditTrail = new AuditTrail();

export default {
  auditTrail,
  AuditAction,
};
