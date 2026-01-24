// CRE v37.0 Session Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// Short-term, authoritative session memory. NOT a chat log. NOT an LLM buffer.
//
// Provides:
// - Turn history (user message + CRE decision + execution result)
// - Active slots (from dialog state)
// - Open goals (from planner)
// - Last decision / last tool result (for reference resolution)
//
// CRE workflow:
//   raw input → ReferenceResolver → intent detection → decision → update SessionMemory
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// TURN RECORD
// ════════════════════════════════════════════════════════════════════════════

let turnCounter = 0;

/**
 * Create a turn record
 *
 * @param {Object} opts
 * @param {string} opts.userMessage
 * @param {Object} opts.decision - CREDecision
 * @param {Object} [opts.executionResult]
 * @param {Object} [opts.extractedSlots]
 * @returns {TurnRecord}
 */
export function createTurnRecord(opts) {
  return {
    turnId: `turn_${++turnCounter}`,
    timestamp: Date.now(),
    userMessage: opts.userMessage,
    decision: opts.decision || null,
    executionResult: opts.executionResult || null,
    extractedSlots: opts.extractedSlots || null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GOAL REF
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} GoalRef
 * @property {string} id
 * @property {string} description
 * @property {string} status - 'active' | 'completed' | 'abandoned'
 * @property {number} createdAt
 * @property {string} [planId] - associated plan ID
 */

export function createGoalRef(description, planId = null) {
  return {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    description,
    status: 'active',
    createdAt: Date.now(),
    planId,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SESSION MEMORY
// ════════════════════════════════════════════════════════════════════════════

export class SessionMemory {
  constructor(sessionId = null) {
    this.sessionId = sessionId || `session_${Date.now()}`;
    this.turns = [];
    this.openGoals = [];
    this.slots = new Map(); // active slots: key → { value, source, updatedAt }
    this.lastDecision = null;
    this.lastToolResult = null;
    this.createdAt = Date.now();
    this.maxTurns = 200; // prevent unbounded growth
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TURNS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record a turn (user input + CRE decision + result)
   */
  addTurn(userMessage, decision, executionResult = null, extractedSlots = null) {
    const turn = createTurnRecord({ userMessage, decision, executionResult, extractedSlots });

    this.turns.push(turn);
    this.lastDecision = decision;
    if (executionResult) {
      this.lastToolResult = executionResult;
    }

    // Extract slots from this turn
    if (extractedSlots) {
      for (const [key, value] of Object.entries(extractedSlots)) {
        this.setSlot(key, value, 'extracted');
      }
    }

    // Evict oldest turns if over limit
    if (this.turns.length > this.maxTurns) {
      this.turns.shift();
    }

    logger.debug('SessionMemory', `Turn recorded: ${turn.turnId}`, {
      decisionType: decision?.type,
      slotsExtracted: extractedSlots ? Object.keys(extractedSlots).length : 0,
    });

    return turn;
  }

  /**
   * Get the last N turns
   */
  getRecentTurns(n = 5) {
    return this.turns.slice(-n);
  }

  /**
   * Get turn by ID
   */
  getTurn(turnId) {
    return this.turns.find(t => t.turnId === turnId) || null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SLOTS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set a slot value
   * @param {string} key
   * @param {*} value
   * @param {string} [source='user'] - 'user' | 'extracted' | 'corrected' | 'default'
   */
  setSlot(key, value, source = 'user') {
    const prev = this.slots.get(key);
    this.slots.set(key, { value, source, updatedAt: Date.now(), previous: prev?.value ?? null });
    logger.debug('SessionMemory', `Slot set: ${key}`, { source, value });
  }

  /**
   * Get a slot value
   */
  getSlot(key) {
    const entry = this.slots.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Get all slots as plain object
   */
  getAllSlots() {
    const result = {};
    for (const [key, entry] of this.slots) {
      result[key] = entry.value;
    }
    return result;
  }

  /**
   * Correct a slot (overwrites with 'corrected' source, preserves previous)
   */
  correctSlot(key, newValue) {
    this.setSlot(key, newValue, 'corrected');
  }

  /**
   * Clear a slot
   */
  clearSlot(key) {
    this.slots.delete(key);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GOALS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Add a new goal
   */
  addGoal(description, planId = null) {
    const goal = createGoalRef(description, planId);
    this.openGoals.push(goal);
    logger.debug('SessionMemory', `Goal added: ${goal.id}`, { description });
    return goal;
  }

  /**
   * Complete a goal
   */
  completeGoal(goalId) {
    const goal = this.openGoals.find(g => g.id === goalId);
    if (goal) {
      goal.status = 'completed';
      logger.debug('SessionMemory', `Goal completed: ${goalId}`);
    }
    return goal;
  }

  /**
   * Abandon a goal
   */
  abandonGoal(goalId) {
    const goal = this.openGoals.find(g => g.id === goalId);
    if (goal) {
      goal.status = 'abandoned';
    }
    return goal;
  }

  /**
   * Get active goals
   */
  getActiveGoals() {
    return this.openGoals.filter(g => g.status === 'active');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONTEXT (for CRE decision-making)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get session context for CRE decision-making
   * This is the ONLY way CRE accesses session memory.
   */
  getContext() {
    return {
      sessionId: this.sessionId,
      turnCount: this.turns.length,
      lastDecision: this.lastDecision,
      lastToolResult: this.lastToolResult,
      activeSlots: this.getAllSlots(),
      activeGoals: this.getActiveGoals(),
      recentTurns: this.getRecentTurns(3),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESET / STATS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reset session (new conversation)
   */
  reset() {
    this.turns = [];
    this.openGoals = [];
    this.slots.clear();
    this.lastDecision = null;
    this.lastToolResult = null;
    logger.debug('SessionMemory', 'Session reset');
  }

  /**
   * Get session stats
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      turns: this.turns.length,
      slots: this.slots.size,
      activeGoals: this.getActiveGoals().length,
      totalGoals: this.openGoals.length,
      createdAt: this.createdAt,
    };
  }
}

// Singleton per process (sessions are managed externally in multi-user setup)
export const sessionMemory = new SessionMemory();

export default SessionMemory;
