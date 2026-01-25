// CRE v42.0 Intent Continuity — Session Goal Tracking
// ══════════════════════════════════════════════════════════════════════════════
//
// "Uživatel myslí v cílech, ne v jednotlivých zprávách"
//
// SessionGoal tracks implicit user goals across a session, maintaining:
// - Current goal description
// - Progress (done items with timestamps, next items)
// - Goal state (active, completed, abandoned)
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Goal status enumeration
 */
export const GoalStatus = Object.freeze({
  ACTIVE: 'ACTIVE',         // Currently being worked on
  PAUSED: 'PAUSED',         // Temporarily paused
  COMPLETED: 'COMPLETED',   // Successfully finished
  ABANDONED: 'ABANDONED',   // User moved on without completing
});

/**
 * Goal update source - who/what proposed the change
 */
export const GoalUpdateSource = Object.freeze({
  USER: 'USER',             // Explicit user statement
  INFERRED: 'INFERRED',     // System inference from context
  TOOL_RESULT: 'TOOL_RESULT', // Result from tool execution
  SYSTEM: 'SYSTEM',         // System-initiated (e.g., timeout)
});

/**
 * Minimum confidence threshold for automatic goal updates
 * Below this threshold, updates become proposals requiring confirmation
 */
export const GOAL_UPDATE_THRESHOLD = 0.7;

/**
 * Progress item types
 */
export const ProgressType = Object.freeze({
  DONE: 'done',
  NEXT: 'next',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
});

/**
 * Progress item representing a step in goal completion
 * @typedef {Object} ProgressItem
 * @property {string} type - ProgressType (done, next, blocked, skipped)
 * @property {string} description - What was done or needs to be done
 * @property {string} [at] - Timestamp when completed (for done items)
 * @property {string} [reason] - Reason for blocked/skipped items
 * @property {Object} [metadata] - Additional context
 */

/**
 * Create a validated progress item
 * @param {Object} params - Progress item parameters
 * @returns {ProgressItem}
 */
export function createProgressItem(params) {
  const { type, description, at, reason, metadata = {} } = params;

  if (!Object.values(ProgressType).includes(type)) {
    throw new Error(`Invalid progress type: ${type}. Must be one of: ${Object.values(ProgressType).join(', ')}`);
  }

  if (!description || typeof description !== 'string') {
    throw new Error('Progress item requires description string');
  }

  const item = {
    type,
    description,
    metadata,
  };

  if (type === ProgressType.DONE) {
    item.at = at || new Date().toISOString();
  }

  if ((type === ProgressType.BLOCKED || type === ProgressType.SKIPPED) && reason) {
    item.reason = reason;
  }

  return Object.freeze(item);
}

/**
 * SessionGoal - Tracks implicit user goals across a session
 *
 * @example
 * const goal = new SessionGoal({
 *   description: 'Implementace dark mode',
 *   implicit: true
 * });
 *
 * goal.markDone('toggle component');
 * goal.markDone('state management');
 * goal.addNext('CSS variables for theme');
 *
 * // Later:
 * goal.getNextStep(); // → 'CSS variables for theme'
 * goal.getProgress(); // → full progress array
 */
export class SessionGoal {
  #id;
  #description;
  #implicit;
  #status;
  #progress;
  #createdAt;
  #updatedAt;
  #completedAt;
  #sessionId;
  #parentGoalId;
  #metadata;
  #confidence;
  #pendingUpdate;
  #updateHistory;

  /**
   * @param {Object} config
   * @param {string} config.description - Goal description
   * @param {boolean} [config.implicit=true] - Whether goal was inferred
   * @param {string} [config.sessionId] - Session this goal belongs to
   * @param {string} [config.parentGoalId] - Parent goal for sub-goals
   * @param {Object} [config.metadata] - Additional context
   * @param {number} [config.confidence=0.8] - Confidence in goal inference
   */
  constructor(config) {
    const {
      description,
      implicit = true,
      sessionId = null,
      parentGoalId = null,
      metadata = {},
      confidence = 0.8,
    } = config;

    if (!description || typeof description !== 'string') {
      throw new Error('SessionGoal requires description string');
    }

    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }

    this.#id = `goal_${crypto.randomUUID()}`;
    this.#description = description;
    this.#implicit = implicit;
    this.#status = GoalStatus.ACTIVE;
    this.#progress = [];
    this.#createdAt = new Date().toISOString();
    this.#updatedAt = this.#createdAt;
    this.#completedAt = null;
    this.#sessionId = sessionId;
    this.#parentGoalId = parentGoalId;
    this.#metadata = { ...metadata };
    this.#confidence = confidence;
    this.#pendingUpdate = null;
    this.#updateHistory = [];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id() { return this.#id; }
  get description() { return this.#description; }
  get implicit() { return this.#implicit; }
  get status() { return this.#status; }
  get createdAt() { return this.#createdAt; }
  get updatedAt() { return this.#updatedAt; }
  get completedAt() { return this.#completedAt; }
  get sessionId() { return this.#sessionId; }
  get parentGoalId() { return this.#parentGoalId; }
  get confidence() { return this.#confidence; }

  /**
   * Get full progress array (immutable copy)
   * @returns {ProgressItem[]}
   */
  getProgress() {
    return [...this.#progress];
  }

  /**
   * Get only completed items
   * @returns {ProgressItem[]}
   */
  getDoneItems() {
    return this.#progress.filter(p => p.type === ProgressType.DONE);
  }

  /**
   * Get next steps to be done
   * @returns {ProgressItem[]}
   */
  getNextItems() {
    return this.#progress.filter(p => p.type === ProgressType.NEXT);
  }

  /**
   * Get blocked items
   * @returns {ProgressItem[]}
   */
  getBlockedItems() {
    return this.#progress.filter(p => p.type === ProgressType.BLOCKED);
  }

  /**
   * Get the immediate next step
   * @returns {string|null}
   */
  getNextStep() {
    const nextItems = this.getNextItems();
    return nextItems.length > 0 ? nextItems[0].description : null;
  }

  /**
   * Get last completed step
   * @returns {ProgressItem|null}
   */
  getLastDone() {
    const doneItems = this.getDoneItems();
    return doneItems.length > 0 ? doneItems[doneItems.length - 1] : null;
  }

  /**
   * Check if goal is active
   * @returns {boolean}
   */
  isActive() {
    return this.#status === GoalStatus.ACTIVE;
  }

  /**
   * Check if goal is completed
   * @returns {boolean}
   */
  isCompleted() {
    return this.#status === GoalStatus.COMPLETED;
  }

  /**
   * Get metadata
   * @returns {Object}
   */
  getMetadata() {
    return { ...this.#metadata };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Progress Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mark a step as done
   * @param {string} description - What was completed
   * @param {Object} [metadata] - Additional context
   * @returns {SessionGoal} this for chaining
   */
  markDone(description, metadata = {}) {
    if (!this.isActive()) {
      throw new Error(`Cannot mark done on ${this.#status} goal`);
    }

    const item = createProgressItem({
      type: ProgressType.DONE,
      description,
      metadata,
    });

    // Remove from next if it was queued
    this.#progress = this.#progress.filter(
      p => !(p.type === ProgressType.NEXT && p.description === description)
    );

    this.#progress.push(item);
    this.#touch();
    return this;
  }

  /**
   * Add a next step to be done
   * @param {string} description - What needs to be done
   * @param {Object} [metadata] - Additional context
   * @returns {SessionGoal} this for chaining
   */
  addNext(description, metadata = {}) {
    if (!this.isActive()) {
      throw new Error(`Cannot add next step to ${this.#status} goal`);
    }

    // Check if already exists
    const exists = this.#progress.some(
      p => p.type === ProgressType.NEXT && p.description === description
    );

    if (!exists) {
      const item = createProgressItem({
        type: ProgressType.NEXT,
        description,
        metadata,
      });
      this.#progress.push(item);
      this.#touch();
    }

    return this;
  }

  /**
   * Mark a step as blocked
   * @param {string} description - What is blocked
   * @param {string} reason - Why it's blocked
   * @param {Object} [metadata] - Additional context
   * @returns {SessionGoal} this for chaining
   */
  markBlocked(description, reason, metadata = {}) {
    if (!this.isActive()) {
      throw new Error(`Cannot mark blocked on ${this.#status} goal`);
    }

    // Remove from next if it was queued
    this.#progress = this.#progress.filter(
      p => !(p.type === ProgressType.NEXT && p.description === description)
    );

    const item = createProgressItem({
      type: ProgressType.BLOCKED,
      description,
      reason,
      metadata,
    });

    this.#progress.push(item);
    this.#touch();
    return this;
  }

  /**
   * Skip a step
   * @param {string} description - What was skipped
   * @param {string} [reason] - Why it was skipped
   * @returns {SessionGoal} this for chaining
   */
  skip(description, reason = '') {
    if (!this.isActive()) {
      throw new Error(`Cannot skip on ${this.#status} goal`);
    }

    // Remove from next if it was queued
    this.#progress = this.#progress.filter(
      p => !(p.type === ProgressType.NEXT && p.description === description)
    );

    const item = createProgressItem({
      type: ProgressType.SKIPPED,
      description,
      reason,
    });

    this.#progress.push(item);
    this.#touch();
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Goal State Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Pause the goal
   * @returns {SessionGoal} this for chaining
   */
  pause() {
    if (this.#status !== GoalStatus.ACTIVE) {
      throw new Error(`Cannot pause ${this.#status} goal`);
    }
    this.#status = GoalStatus.PAUSED;
    this.#touch();
    return this;
  }

  /**
   * Resume a paused goal
   * @returns {SessionGoal} this for chaining
   */
  resume() {
    if (this.#status !== GoalStatus.PAUSED) {
      throw new Error(`Cannot resume ${this.#status} goal`);
    }
    this.#status = GoalStatus.ACTIVE;
    this.#touch();
    return this;
  }

  /**
   * Complete the goal
   * @returns {SessionGoal} this for chaining
   */
  complete() {
    if (this.#status !== GoalStatus.ACTIVE) {
      throw new Error(`Cannot complete ${this.#status} goal`);
    }
    this.#status = GoalStatus.COMPLETED;
    this.#completedAt = new Date().toISOString();
    this.#touch();
    return this;
  }

  /**
   * Abandon the goal
   * @param {string} [reason] - Why the goal was abandoned
   * @returns {SessionGoal} this for chaining
   */
  abandon(reason = '') {
    if (this.#status === GoalStatus.COMPLETED) {
      throw new Error('Cannot abandon completed goal');
    }
    this.#status = GoalStatus.ABANDONED;
    if (reason) {
      this.#metadata.abandonReason = reason;
    }
    this.#touch();
    return this;
  }

  /**
   * Update confidence in the goal
   * @param {number} confidence - New confidence value (0-1)
   * @returns {SessionGoal} this for chaining
   */
  updateConfidence(confidence) {
    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    this.#confidence = confidence;
    this.#touch();
    return this;
  }

  /**
   * Update metadata
   * @param {Object} metadata - Metadata to merge
   * @returns {SessionGoal} this for chaining
   */
  updateMetadata(metadata) {
    this.#metadata = { ...this.#metadata, ...metadata };
    this.#touch();
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Goal Update with Confidence Threshold (prevents goal drift)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Propose or apply a goal update based on confidence threshold
   * If confidence >= GOAL_UPDATE_THRESHOLD, applies immediately
   * Otherwise, stores as pending update requiring confirmation
   *
   * @param {string} newDescription - New goal description
   * @param {Object} options - Update options
   * @param {number} options.confidence - Confidence in the update (0-1)
   * @param {string} options.source - GoalUpdateSource
   * @param {string} [options.reason] - Why the update is proposed
   * @returns {{ applied: boolean, pending: boolean, update: Object }}
   */
  proposeUpdate(newDescription, options) {
    const {
      confidence,
      source,
      reason = '',
    } = options;

    if (!Object.values(GoalUpdateSource).includes(source)) {
      throw new Error(`Invalid update source: ${source}`);
    }

    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }

    const update = {
      id: `upd_${crypto.randomUUID()}`,
      previousDescription: this.#description,
      newDescription,
      confidence,
      source,
      reason,
      proposedAt: new Date().toISOString(),
      appliedAt: null,
      rejected: false,
    };

    // USER source always applies immediately (explicit user intent)
    // High confidence updates apply immediately
    if (source === GoalUpdateSource.USER || confidence >= GOAL_UPDATE_THRESHOLD) {
      this.#applyUpdate(update);
      return { applied: true, pending: false, update };
    }

    // Low confidence → store as pending, require confirmation
    this.#pendingUpdate = update;
    return { applied: false, pending: true, update };
  }

  /**
   * Get pending update if any
   * @returns {Object|null}
   */
  getPendingUpdate() {
    return this.#pendingUpdate ? { ...this.#pendingUpdate } : null;
  }

  /**
   * Check if there's a pending update
   * @returns {boolean}
   */
  hasPendingUpdate() {
    return this.#pendingUpdate !== null;
  }

  /**
   * Confirm and apply pending update
   * @returns {SessionGoal} this for chaining
   */
  confirmPendingUpdate() {
    if (!this.#pendingUpdate) {
      throw new Error('No pending update to confirm');
    }

    this.#applyUpdate(this.#pendingUpdate);
    this.#pendingUpdate = null;
    return this;
  }

  /**
   * Reject pending update
   * @param {string} [reason] - Why rejected
   * @returns {SessionGoal} this for chaining
   */
  rejectPendingUpdate(reason = '') {
    if (!this.#pendingUpdate) {
      throw new Error('No pending update to reject');
    }

    this.#pendingUpdate.rejected = true;
    this.#pendingUpdate.rejectedAt = new Date().toISOString();
    this.#pendingUpdate.rejectionReason = reason;

    // Store in history as rejected
    this.#updateHistory.push({ ...this.#pendingUpdate });
    this.#pendingUpdate = null;

    return this;
  }

  /**
   * Get update history
   * @returns {Object[]}
   */
  getUpdateHistory() {
    return [...this.#updateHistory];
  }

  /**
   * Internal: Apply an update
   * @private
   */
  #applyUpdate(update) {
    this.#description = update.newDescription;
    update.appliedAt = new Date().toISOString();
    this.#updateHistory.push({ ...update });
    this.#touch();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Serialize goal to plain object
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.#id,
      description: this.#description,
      implicit: this.#implicit,
      status: this.#status,
      progress: [...this.#progress],
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      completedAt: this.#completedAt,
      sessionId: this.#sessionId,
      parentGoalId: this.#parentGoalId,
      metadata: { ...this.#metadata },
      confidence: this.#confidence,
      pendingUpdate: this.#pendingUpdate ? { ...this.#pendingUpdate } : null,
      updateHistory: [...this.#updateHistory],
    };
  }

  /**
   * Create goal from serialized data
   * @param {Object} data - Serialized goal
   * @returns {SessionGoal}
   */
  static fromJSON(data) {
    const goal = new SessionGoal({
      description: data.description,
      implicit: data.implicit,
      sessionId: data.sessionId,
      parentGoalId: data.parentGoalId,
      metadata: data.metadata,
      confidence: data.confidence,
    });

    // Restore internal state
    goal.#id = data.id;
    goal.#status = data.status;
    goal.#progress = data.progress.map(p => Object.freeze({ ...p }));
    goal.#createdAt = data.createdAt;
    goal.#updatedAt = data.updatedAt;
    goal.#completedAt = data.completedAt;
    goal.#pendingUpdate = data.pendingUpdate || null;
    goal.#updateHistory = data.updateHistory || [];

    return goal;
  }

  /**
   * Get a summary of progress suitable for "ok pokračuj"
   * @returns {Object}
   */
  getSummary() {
    const done = this.getDoneItems();
    const next = this.getNextItems();
    const blocked = this.getBlockedItems();

    return {
      goal: this.#description,
      status: this.#status,
      doneCount: done.length,
      nextCount: next.length,
      blockedCount: blocked.length,
      lastDone: done.length > 0 ? done[done.length - 1].description : null,
      nextStep: next.length > 0 ? next[0].description : null,
      isBlocked: blocked.length > 0,
      confidence: this.#confidence,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  #touch() {
    this.#updatedAt = new Date().toISOString();
  }
}

/**
 * Create a new session goal (factory function)
 * @param {string} description - Goal description
 * @param {Object} [options] - Additional options
 * @returns {SessionGoal}
 */
export function createSessionGoal(description, options = {}) {
  return new SessionGoal({ description, ...options });
}

export default SessionGoal;
