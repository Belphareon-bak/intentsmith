// CRE v42.0 Intent Continuity — Intent Tracker
// ══════════════════════════════════════════════════════════════════════════════
//
// IntentTracker manages multiple goals across a session, enabling:
// - "ok pokračuj" → system knows what we're working on and where we left off
// - Implicit goal inference from user messages
// - Goal hierarchy (sub-goals)
// - Session continuity
//
// ══════════════════════════════════════════════════════════════════════════════

import { SessionGoal, GoalStatus, createSessionGoal } from './session-goal.js';

/**
 * Intent detection confidence thresholds
 */
export const IntentConfidence = Object.freeze({
  HIGH: 0.9,      // Explicit user statement
  MEDIUM: 0.7,    // Strong inference
  LOW: 0.5,       // Weak inference
  UNCERTAIN: 0.3, // Guessing
});

/**
 * Intent change types
 */
export const IntentChangeType = Object.freeze({
  NEW_GOAL: 'NEW_GOAL',           // New goal detected
  GOAL_PROGRESS: 'GOAL_PROGRESS', // Progress on existing goal
  GOAL_SHIFT: 'GOAL_SHIFT',       // Shifted to different goal
  GOAL_COMPLETE: 'GOAL_COMPLETE', // Goal completed
  GOAL_ABANDON: 'GOAL_ABANDON',   // Goal abandoned
  CONTEXT_SWITCH: 'CONTEXT_SWITCH', // Context switch (e.g., "now let's do X")
});

/**
 * IntentTracker - Tracks user intent across a session
 *
 * @example
 * const tracker = new IntentTracker('session_123');
 *
 * // Infer goal from user message
 * tracker.inferGoal('Potřebuju implementovat dark mode');
 *
 * // Track progress
 * tracker.recordProgress('vytvořen toggle component');
 * tracker.recordProgress('state management hotov');
 *
 * // Later user says "ok pokračuj"
 * const context = tracker.getContinuationContext();
 * // → { currentGoal: 'dark mode', lastDone: 'state management', nextStep: '...' }
 */
export class IntentTracker {
  #sessionId;
  #goals;
  #activeGoalId;
  #history;
  #createdAt;
  #lastInteraction;

  /**
   * @param {string} sessionId - Session identifier
   */
  constructor(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('IntentTracker requires sessionId string');
    }

    this.#sessionId = sessionId;
    this.#goals = new Map();
    this.#activeGoalId = null;
    this.#history = [];
    this.#createdAt = new Date().toISOString();
    this.#lastInteraction = this.#createdAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get sessionId() { return this.#sessionId; }
  get createdAt() { return this.#createdAt; }
  get lastInteraction() { return this.#lastInteraction; }

  /**
   * Get currently active goal
   * @returns {SessionGoal|null}
   */
  getActiveGoal() {
    if (!this.#activeGoalId) return null;
    return this.#goals.get(this.#activeGoalId) || null;
  }

  /**
   * Get all goals in session
   * @returns {SessionGoal[]}
   */
  getAllGoals() {
    return Array.from(this.#goals.values());
  }

  /**
   * Get goals by status
   * @param {string} status - GoalStatus
   * @returns {SessionGoal[]}
   */
  getGoalsByStatus(status) {
    return this.getAllGoals().filter(g => g.status === status);
  }

  /**
   * Check if there's an active goal
   * @returns {boolean}
   */
  hasActiveGoal() {
    return this.#activeGoalId !== null && this.getActiveGoal()?.isActive();
  }

  /**
   * Get intent history
   * @returns {Object[]}
   */
  getHistory() {
    return [...this.#history];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Goal Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create and track a new goal
   * @param {string} description - Goal description
   * @param {Object} [options] - Goal options
   * @returns {SessionGoal}
   */
  createGoal(description, options = {}) {
    const goal = createSessionGoal(description, {
      sessionId: this.#sessionId,
      ...options,
    });

    this.#goals.set(goal.id, goal);
    this.#recordChange(IntentChangeType.NEW_GOAL, {
      goalId: goal.id,
      description,
      confidence: options.confidence || 0.8,
    });

    return goal;
  }

  /**
   * Set a goal as active
   * @param {string} goalId - Goal ID to activate
   * @returns {SessionGoal}
   */
  setActiveGoal(goalId) {
    const goal = this.#goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    if (!goal.isActive() && goal.status !== GoalStatus.PAUSED) {
      throw new Error(`Cannot activate ${goal.status} goal`);
    }

    // Pause current active goal if different
    if (this.#activeGoalId && this.#activeGoalId !== goalId) {
      const currentGoal = this.#goals.get(this.#activeGoalId);
      if (currentGoal?.isActive()) {
        currentGoal.pause();
      }
    }

    // Resume if paused
    if (goal.status === GoalStatus.PAUSED) {
      goal.resume();
    }

    this.#activeGoalId = goalId;
    this.#touch();

    return goal;
  }

  /**
   * Infer goal from user message (implicit goal detection)
   * @param {string} message - User message
   * @param {Object} [context] - Additional context for inference
   * @returns {{ goal: SessionGoal|null, change: string, confidence: number }}
   */
  inferGoal(message, context = {}) {
    const normalized = message.toLowerCase().trim();
    let change = null;
    let confidence = IntentConfidence.MEDIUM;
    let goal = null;

    // Detect explicit continuation requests
    if (this.#isContinuationRequest(normalized)) {
      goal = this.getActiveGoal();
      if (goal) {
        change = IntentChangeType.GOAL_PROGRESS;
        confidence = IntentConfidence.HIGH;
      }
      this.#touch();
      return { goal, change, confidence };
    }

    // Detect explicit new goal markers
    if (this.#isNewGoalMarker(normalized)) {
      const description = this.#extractGoalDescription(message);
      if (description) {
        goal = this.createGoal(description, { implicit: true, confidence });
        this.setActiveGoal(goal.id);
        change = IntentChangeType.NEW_GOAL;
        confidence = IntentConfidence.HIGH;
      }
      return { goal, change, confidence };
    }

    // Detect context switch
    if (this.#isContextSwitch(normalized)) {
      const description = this.#extractGoalDescription(message);
      if (description) {
        // Pause current goal
        if (this.hasActiveGoal()) {
          this.getActiveGoal().pause();
        }
        goal = this.createGoal(description, { implicit: true, confidence: IntentConfidence.MEDIUM });
        this.setActiveGoal(goal.id);
        change = IntentChangeType.CONTEXT_SWITCH;
        confidence = IntentConfidence.MEDIUM;
      }
      return { goal, change, confidence };
    }

    // Detect completion indicators
    if (this.#isCompletionIndicator(normalized)) {
      goal = this.getActiveGoal();
      if (goal) {
        goal.complete();
        change = IntentChangeType.GOAL_COMPLETE;
        confidence = IntentConfidence.HIGH;
        this.#activeGoalId = null;
      }
      return { goal, change, confidence };
    }

    // Default: assume progress on current goal or create new implicit goal
    goal = this.getActiveGoal();
    if (goal) {
      change = IntentChangeType.GOAL_PROGRESS;
      confidence = IntentConfidence.MEDIUM;
    } else {
      // Try to infer a new goal from the message
      const description = this.#extractGoalDescription(message);
      if (description && description.length > 10) {
        goal = this.createGoal(description, { implicit: true, confidence: IntentConfidence.LOW });
        this.setActiveGoal(goal.id);
        change = IntentChangeType.NEW_GOAL;
        confidence = IntentConfidence.LOW;
      }
    }

    this.#touch();
    return { goal, change, confidence };
  }

  /**
   * Record progress on the active goal
   * @param {string} description - What was completed
   * @param {Object} [metadata] - Additional context
   * @returns {SessionGoal|null}
   */
  recordProgress(description, metadata = {}) {
    const goal = this.getActiveGoal();
    if (!goal) {
      return null;
    }

    goal.markDone(description, metadata);
    this.#recordChange(IntentChangeType.GOAL_PROGRESS, {
      goalId: goal.id,
      done: description,
    });
    this.#touch();

    return goal;
  }

  /**
   * Add next step to active goal
   * @param {string} description - What needs to be done
   * @returns {SessionGoal|null}
   */
  addNextStep(description) {
    const goal = this.getActiveGoal();
    if (!goal) {
      return null;
    }

    goal.addNext(description);
    this.#touch();

    return goal;
  }

  /**
   * Complete the active goal
   * @returns {SessionGoal|null}
   */
  completeActiveGoal() {
    const goal = this.getActiveGoal();
    if (!goal) {
      return null;
    }

    goal.complete();
    this.#recordChange(IntentChangeType.GOAL_COMPLETE, { goalId: goal.id });
    this.#activeGoalId = null;
    this.#touch();

    return goal;
  }

  /**
   * Abandon the active goal
   * @param {string} [reason] - Why abandoning
   * @returns {SessionGoal|null}
   */
  abandonActiveGoal(reason = '') {
    const goal = this.getActiveGoal();
    if (!goal) {
      return null;
    }

    goal.abandon(reason);
    this.#recordChange(IntentChangeType.GOAL_ABANDON, { goalId: goal.id, reason });
    this.#activeGoalId = null;
    this.#touch();

    return goal;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Continuation Context (for "ok pokračuj")
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get context for continuation ("ok pokračuj")
   * @returns {Object}
   */
  getContinuationContext() {
    const goal = this.getActiveGoal();

    if (!goal) {
      return {
        hasContext: false,
        message: 'No active goal. What would you like to work on?',
      };
    }

    const summary = goal.getSummary();
    const done = goal.getDoneItems();
    const next = goal.getNextItems();

    return {
      hasContext: true,
      currentGoal: summary.goal,
      status: summary.status,
      confidence: summary.confidence,
      progress: {
        completed: done.map(d => d.description),
        pending: next.map(n => n.description),
        lastDone: summary.lastDone,
        nextStep: summary.nextStep,
      },
      isBlocked: summary.isBlocked,
      blockedItems: goal.getBlockedItems().map(b => ({
        item: b.description,
        reason: b.reason,
      })),
      message: this.#formatContinuationMessage(summary),
    };
  }

  /**
   * Get full session context for debugging/display
   * @returns {Object}
   */
  getSessionContext() {
    const activeGoal = this.getActiveGoal();
    const allGoals = this.getAllGoals();

    return {
      sessionId: this.#sessionId,
      createdAt: this.#createdAt,
      lastInteraction: this.#lastInteraction,
      activeGoal: activeGoal?.toJSON() || null,
      goals: {
        active: allGoals.filter(g => g.status === GoalStatus.ACTIVE).length,
        paused: allGoals.filter(g => g.status === GoalStatus.PAUSED).length,
        completed: allGoals.filter(g => g.status === GoalStatus.COMPLETED).length,
        abandoned: allGoals.filter(g => g.status === GoalStatus.ABANDONED).length,
        total: allGoals.length,
      },
      recentHistory: this.#history.slice(-10),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Serialize tracker to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      sessionId: this.#sessionId,
      goals: Array.from(this.#goals.values()).map(g => g.toJSON()),
      activeGoalId: this.#activeGoalId,
      history: [...this.#history],
      createdAt: this.#createdAt,
      lastInteraction: this.#lastInteraction,
    };
  }

  /**
   * Restore tracker from serialized data
   * @param {Object} data - Serialized tracker
   * @returns {IntentTracker}
   */
  static fromJSON(data) {
    const tracker = new IntentTracker(data.sessionId);

    for (const goalData of data.goals) {
      const goal = SessionGoal.fromJSON(goalData);
      tracker.#goals.set(goal.id, goal);
    }

    tracker.#activeGoalId = data.activeGoalId;
    tracker.#history = data.history || [];
    tracker.#createdAt = data.createdAt;
    tracker.#lastInteraction = data.lastInteraction;

    return tracker;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  #touch() {
    this.#lastInteraction = new Date().toISOString();
  }

  #recordChange(type, details = {}) {
    this.#history.push({
      type,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }

  #isContinuationRequest(msg) {
    const patterns = [
      /^ok\s*(pokračuj|continue|go|dál|further)/i,
      /^pokračuj$/i,
      /^continue$/i,
      /^go\s*(on|ahead)$/i,
      /^next$/i,
      /^dál$/i,
      /^a\s*dál$/i,
    ];
    return patterns.some(p => p.test(msg));
  }

  #isNewGoalMarker(msg) {
    const patterns = [
      /^(potřebuju|need|want|chci|chtěl bych)/i,
      /^(udělej|make|create|implement|implementuj)/i,
      /^(help me|pomoz mi)/i,
    ];
    return patterns.some(p => p.test(msg));
  }

  #isContextSwitch(msg) {
    const patterns = [
      /^(teď|now|let's|pojďme)\s*(na|to|do)/i,
      /^(switch|přepni)\s*(to|na)/i,
      /^(místo toho|instead)/i,
      /^(jiná věc|something else|another thing)/i,
    ];
    return patterns.some(p => p.test(msg));
  }

  #isCompletionIndicator(msg) {
    const patterns = [
      /^(hotovo|done|finished|complete|dokončeno)/i,
      /^(to je vše|that's all|that's it)/i,
      /^(díky,?\s*to stačí|thanks,?\s*that's enough)/i,
    ];
    return patterns.some(p => p.test(msg));
  }

  #extractGoalDescription(message) {
    // Remove common prefixes
    let desc = message
      .replace(/^(potřebuju|need|want|chci|chtěl bych|udělej|make|create|implement|implementuj|help me|pomoz mi)\s*/i, '')
      .replace(/^(teď|now|let's|pojďme)\s*(na|to|do)\s*/i, '')
      .trim();

    // Limit length
    if (desc.length > 100) {
      desc = desc.substring(0, 100) + '...';
    }

    return desc;
  }

  #formatContinuationMessage(summary) {
    const parts = [];

    parts.push(`Pracujeme na: ${summary.goal}`);

    if (summary.lastDone) {
      parts.push(`Poslední dokončeno: ${summary.lastDone}`);
    }

    if (summary.nextStep) {
      parts.push(`Další krok: ${summary.nextStep}`);
    } else if (summary.doneCount > 0) {
      parts.push('Žádné další naplánované kroky.');
    }

    if (summary.isBlocked) {
      parts.push('⚠️ Některé kroky jsou blokovány.');
    }

    return parts.join('\n');
  }
}

/**
 * Create a new intent tracker (factory function)
 * @param {string} sessionId - Session identifier
 * @returns {IntentTracker}
 */
export function createIntentTracker(sessionId) {
  return new IntentTracker(sessionId);
}

export default IntentTracker;
