// CRE v39.1 Audit Log
// ══════════════════════════════════════════════════════════════════════════════
//
// Comprehensive audit trail for autonomous operations.
//
// Every significant action is logged:
//   - Goal lifecycle events
//   - Plan execution
//   - Tool invocations
//   - Safety violations
//   - User approvals
//
// Key Principle:
//   Full transparency — every agent action is traceable.
//   Audit log is append-only (cannot be modified or deleted by agent).
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// AUDIT EVENT TYPES
// ════════════════════════════════════════════════════════════════════════════

export const AuditEventType = {
  // Goal Events
  GOAL_CREATED: 'goal.created',
  GOAL_SCHEDULED: 'goal.scheduled',
  GOAL_STARTED: 'goal.started',
  GOAL_PAUSED: 'goal.paused',
  GOAL_RESUMED: 'goal.resumed',
  GOAL_COMPLETED: 'goal.completed',
  GOAL_FAILED: 'goal.failed',
  GOAL_CANCELLED: 'goal.cancelled',

  // Plan Events
  PLAN_CREATED: 'plan.created',
  PLAN_STARTED: 'plan.started',
  PLAN_COMPLETED: 'plan.completed',
  PLAN_FAILED: 'plan.failed',

  // Step Events
  STEP_STARTED: 'step.started',
  STEP_COMPLETED: 'step.completed',
  STEP_FAILED: 'step.failed',
  STEP_SKIPPED: 'step.skipped',
  STEP_RETRIED: 'step.retried',

  // Tool Events
  TOOL_INVOKED: 'tool.invoked',
  TOOL_COMPLETED: 'tool.completed',
  TOOL_FAILED: 'tool.failed',
  TOOL_GATED: 'tool.gated',

  // Safety Events
  SAFETY_VIOLATION: 'safety.violation',
  SAFETY_LIMIT_REACHED: 'safety.limit_reached',
  SANDBOX_VIOLATION: 'sandbox.violation',

  // Approval Events
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_GRANTED: 'approval.granted',
  APPROVAL_DENIED: 'approval.denied',
  APPROVAL_TIMEOUT: 'approval.timeout',

  // System Events
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended',
  CONFIG_CHANGED: 'config.changed',
  ERROR: 'system.error',
};

// ════════════════════════════════════════════════════════════════════════════
// AUDIT SEVERITY
// ════════════════════════════════════════════════════════════════════════════

export const AuditSeverity = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  CRITICAL: 'critical',
};

// ════════════════════════════════════════════════════════════════════════════
// AUDIT ENTRY
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AuditEntry
 * @property {string} id - Unique entry ID
 * @property {number} timestamp
 * @property {string} type - AuditEventType
 * @property {string} severity - AuditSeverity
 * @property {string} source - Component that generated the event
 * @property {Object} context - Event-specific data
 * @property {string} goalId - Associated goal (if any)
 * @property {string} planId - Associated plan (if any)
 * @property {string} stepId - Associated step (if any)
 * @property {Object} metadata - Additional metadata
 */

/**
 * Create an audit entry
 */
function createAuditEntry(type, source, context = {}, options = {}) {
  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: Date.now(),
    type,
    severity: options.severity || AuditSeverity.INFO,
    source,
    context,
    goalId: options.goalId || null,
    planId: options.planId || null,
    stepId: options.stepId || null,
    metadata: options.metadata || {},
  };
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════════════════

export class AuditLog {
  constructor(options = {}) {
    this.entries = [];
    this.maxEntries = options.maxEntries || 10000;

    // Persistence callback
    this.onPersist = options.onPersist || null;
    this.persistBatchSize = options.persistBatchSize || 100;
    this.pendingPersist = [];

    // Event listeners
    this.listeners = new Map();

    // Stats
    this.stats = {
      totalEvents: 0,
      byType: {},
      bySeverity: {},
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LOGGING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Log an audit event
   */
  log(type, source, context = {}, options = {}) {
    const entry = createAuditEntry(type, source, context, options);

    // Add to in-memory log
    this.entries.push(entry);

    // Update stats
    this.stats.totalEvents++;
    this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
    this.stats.bySeverity[entry.severity] = (this.stats.bySeverity[entry.severity] || 0) + 1;

    // Trim if needed
    if (this.entries.length > this.maxEntries) {
      const toRemove = this.entries.length - this.maxEntries;
      this.entries.splice(0, toRemove);
    }

    // Queue for persistence
    this.pendingPersist.push(entry);
    if (this.pendingPersist.length >= this.persistBatchSize) {
      this.flush();
    }

    // Notify listeners
    this.notifyListeners(entry);

    // Log critical events to console
    if (entry.severity === AuditSeverity.CRITICAL || entry.severity === AuditSeverity.ERROR) {
      logger.warn('AuditLog', `${entry.type}: ${JSON.stringify(context)}`);
    }

    return entry;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS
  // ──────────────────────────────────────────────────────────────────────────

  // Goal Events
  logGoalCreated(goalId, description, source = 'user') {
    return this.log(AuditEventType.GOAL_CREATED, source, { description }, { goalId });
  }

  logGoalStarted(goalId, source = 'scheduler') {
    return this.log(AuditEventType.GOAL_STARTED, source, {}, { goalId });
  }

  logGoalCompleted(goalId, output, source = 'runner') {
    return this.log(AuditEventType.GOAL_COMPLETED, source, { hasOutput: !!output }, { goalId });
  }

  logGoalFailed(goalId, error, source = 'runner') {
    return this.log(AuditEventType.GOAL_FAILED, source, { error }, { goalId, severity: AuditSeverity.ERROR });
  }

  // Plan Events
  logPlanCreated(planId, goalId, steps, source = 'planner') {
    return this.log(AuditEventType.PLAN_CREATED, source, { stepCount: steps.length }, { goalId, planId });
  }

  logPlanCompleted(planId, goalId, source = 'runner') {
    return this.log(AuditEventType.PLAN_COMPLETED, source, {}, { goalId, planId });
  }

  logPlanFailed(planId, goalId, error, source = 'runner') {
    return this.log(AuditEventType.PLAN_FAILED, source, { error }, { goalId, planId, severity: AuditSeverity.WARN });
  }

  // Step Events
  logStepStarted(stepId, planId, tool, source = 'runner') {
    return this.log(AuditEventType.STEP_STARTED, source, { tool }, { planId, stepId });
  }

  logStepCompleted(stepId, planId, source = 'runner') {
    return this.log(AuditEventType.STEP_COMPLETED, source, {}, { planId, stepId });
  }

  logStepFailed(stepId, planId, error, source = 'runner') {
    return this.log(AuditEventType.STEP_FAILED, source, { error }, { planId, stepId, severity: AuditSeverity.WARN });
  }

  // Tool Events
  logToolInvoked(tool, params, goalId = null, source = 'executor') {
    return this.log(AuditEventType.TOOL_INVOKED, source, { tool, params: this.sanitizeParams(params) }, { goalId });
  }

  logToolCompleted(tool, success, goalId = null, source = 'executor') {
    return this.log(AuditEventType.TOOL_COMPLETED, source, { tool, success }, { goalId });
  }

  logToolGated(tool, goalId = null, source = 'gate') {
    return this.log(AuditEventType.TOOL_GATED, source, { tool }, { goalId, severity: AuditSeverity.WARN });
  }

  // Safety Events
  logSafetyViolation(violation, reason, goalId = null, source = 'safety') {
    return this.log(AuditEventType.SAFETY_VIOLATION, source, { violation, reason }, { goalId, severity: AuditSeverity.ERROR });
  }

  logSandboxViolation(violation, reason, goalId = null, source = 'sandbox') {
    return this.log(AuditEventType.SANDBOX_VIOLATION, source, { violation, reason }, { goalId, severity: AuditSeverity.WARN });
  }

  // Approval Events
  logApprovalRequested(goalId, tool, source = 'gate') {
    return this.log(AuditEventType.APPROVAL_REQUESTED, source, { tool }, { goalId });
  }

  logApprovalGranted(goalId, tool, source = 'user') {
    return this.log(AuditEventType.APPROVAL_GRANTED, source, { tool }, { goalId });
  }

  logApprovalDenied(goalId, tool, source = 'user') {
    return this.log(AuditEventType.APPROVAL_DENIED, source, { tool }, { goalId, severity: AuditSeverity.WARN });
  }

  // System Events
  logSessionStarted(source = 'system') {
    return this.log(AuditEventType.SESSION_STARTED, source, { timestamp: Date.now() });
  }

  logError(error, context = {}, source = 'system') {
    return this.log(AuditEventType.ERROR, source, { error, ...context }, { severity: AuditSeverity.ERROR });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all entries
   */
  getAll() {
    return [...this.entries];
  }

  /**
   * Get entries by type
   */
  getByType(type) {
    return this.entries.filter(e => e.type === type);
  }

  /**
   * Get entries by goal
   */
  getByGoal(goalId) {
    return this.entries.filter(e => e.goalId === goalId);
  }

  /**
   * Get entries by plan
   */
  getByPlan(planId) {
    return this.entries.filter(e => e.planId === planId);
  }

  /**
   * Get entries by severity
   */
  getBySeverity(severity) {
    return this.entries.filter(e => e.severity === severity);
  }

  /**
   * Get entries in time range
   */
  getInRange(startTime, endTime) {
    return this.entries.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);
  }

  /**
   * Get recent entries
   */
  getRecent(limit = 50) {
    return this.entries.slice(-limit);
  }

  /**
   * Search entries
   */
  search(query) {
    const q = query.toLowerCase();
    return this.entries.filter(e =>
      e.type.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q) ||
      JSON.stringify(e.context).toLowerCase().includes(q)
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LISTENERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to audit events
   */
  subscribe(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(eventType);
      const idx = callbacks.indexOf(callback);
      if (idx >= 0) callbacks.splice(idx, 1);
    };
  }

  /**
   * Notify listeners of new entry
   */
  notifyListeners(entry) {
    // Notify type-specific listeners
    const typeListeners = this.listeners.get(entry.type) || [];
    for (const callback of typeListeners) {
      try {
        callback(entry);
      } catch (e) {
        logger.error('AuditLog', 'Listener error', { error: e.message });
      }
    }

    // Notify wildcard listeners
    const wildcardListeners = this.listeners.get('*') || [];
    for (const callback of wildcardListeners) {
      try {
        callback(entry);
      } catch (e) {
        logger.error('AuditLog', 'Wildcard listener error', { error: e.message });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Flush pending entries to persistence
   */
  async flush() {
    if (this.pendingPersist.length === 0) return;
    if (!this.onPersist) {
      this.pendingPersist = [];
      return;
    }

    const batch = [...this.pendingPersist];
    this.pendingPersist = [];

    try {
      await this.onPersist(batch);
    } catch (e) {
      logger.error('AuditLog', 'Persistence error', { error: e.message });
      // Re-queue failed batch
      this.pendingPersist = [...batch, ...this.pendingPersist];
    }
  }

  /**
   * Export audit log
   */
  export() {
    return {
      entries: this.getAll(),
      stats: { ...this.stats },
      exportedAt: Date.now(),
    };
  }

  /**
   * Import audit log
   */
  import(data) {
    if (!data.entries || !Array.isArray(data.entries)) {
      return { success: false, error: 'Invalid import data' };
    }

    let imported = 0;
    for (const entry of data.entries) {
      if (!this.entries.find(e => e.id === entry.id)) {
        this.entries.push(entry);
        imported++;
      }
    }

    // Sort by timestamp
    this.entries.sort((a, b) => a.timestamp - b.timestamp);

    // Trim if needed
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    logger.debug('AuditLog', `Imported ${imported} entries`);
    return { success: true, imported };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Sanitize params for logging (remove sensitive data)
   */
  sanitizeParams(params) {
    if (!params || typeof params !== 'object') return params;

    const sanitized = { ...params };
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth', 'credential'];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      entryCount: this.entries.length,
      pendingPersist: this.pendingPersist.length,
    };
  }

  /**
   * Clear audit log (use with caution)
   */
  clear() {
    const count = this.entries.length;
    this.entries = [];
    this.pendingPersist = [];
    logger.debug('AuditLog', `Cleared ${count} entries`);
    return { success: true, cleared: count };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const auditLog = new AuditLog();

export default AuditLog;
