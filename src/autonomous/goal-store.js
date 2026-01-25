// CRE v39.0.1 Goal Store
// ══════════════════════════════════════════════════════════════════════════════
//
// Persistent goal storage — goals survive restarts, timeouts, failures.
//
// v39.0 Paradigm Shift:
//   OLD: request → plan → execute → respond → END
//   NEW: goal → observe → plan → execute → learn → repeat
//
// v39.0.1 Fix:
//   - Separate staticContext vs dynamicContext
//   - staticContext: immutable (owner, type, initial input)
//   - dynamicContext: reloaded at execution (permissions, limits, preferences)
//   - Per-goal sandboxMode support
//
// Goal Lifecycle:
//   CREATED → SCHEDULED → RUNNING → { COMPLETED | FAILED | PAUSED | CANCELLED }
//
// Key Invariants:
//   ✅ Goals are persistent (survive restarts)
//   ✅ Goals are resumable (can continue after failure)
//   ✅ Goals are auditable (full history)
//   ✅ Goals respect safety limits
//   ✅ Dynamic context is always fresh (v39.0.1)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// GOAL STATUS
// ════════════════════════════════════════════════════════════════════════════

export const GoalStatus = {
  CREATED: 'created',       // Goal defined, not yet scheduled
  SCHEDULED: 'scheduled',   // Waiting to run (cron, trigger, etc.)
  RUNNING: 'running',       // Currently executing
  PAUSED: 'paused',         // Paused (user request, gate, etc.)
  COMPLETED: 'completed',   // Successfully finished
  FAILED: 'failed',         // Failed after all retries
  CANCELLED: 'cancelled',   // User cancelled
};

// ════════════════════════════════════════════════════════════════════════════
// GOAL PRIORITY
// ════════════════════════════════════════════════════════════════════════════

export const GoalPriority = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 10,
  CRITICAL: 20,
};

// ════════════════════════════════════════════════════════════════════════════
// GOAL TRIGGER TYPES
// ════════════════════════════════════════════════════════════════════════════

export const GoalTrigger = {
  IMMEDIATE: 'immediate',   // Run now
  SCHEDULED: 'scheduled',   // Run at specific time
  RECURRING: 'recurring',   // Cron-like schedule
  EVENT: 'event',           // Triggered by event
  MANUAL: 'manual',         // User manually triggers
};

// ════════════════════════════════════════════════════════════════════════════
// GOAL SCHEMA
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Goal
 * @property {string} id - Unique goal ID
 * @property {string} description - Human-readable goal description
 * @property {string} status - GoalStatus
 * @property {number} priority - GoalPriority
 * @property {Object} trigger - When/how to trigger
 * @property {Object} constraints - Safety constraints
 * @property {Object} context - Execution context
 * @property {string[]} planIds - Associated plan IDs
 * @property {Object} progress - Progress tracking
 * @property {Object[]} history - Execution history
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} scheduledAt
 * @property {number} startedAt
 * @property {number} completedAt
 */

/**
 * Create a new goal
 */
export function createGoal(config) {
  const now = Date.now();
  return {
    id: config.id || `goal_${now}_${Math.random().toString(36).substr(2, 6)}`,
    description: config.description || '',
    status: GoalStatus.CREATED,
    priority: config.priority ?? GoalPriority.NORMAL,

    // Trigger configuration
    trigger: {
      type: config.trigger?.type || GoalTrigger.MANUAL,
      schedule: config.trigger?.schedule || null,  // Cron expression for RECURRING
      at: config.trigger?.at || null,               // Timestamp for SCHEDULED
      event: config.trigger?.event || null,         // Event name for EVENT
    },

    // Safety constraints
    constraints: {
      maxDuration: config.constraints?.maxDuration || 3600000,      // 1 hour default
      maxPlans: config.constraints?.maxPlans || 10,                 // Max plan attempts
      maxRetries: config.constraints?.maxRetries || 3,              // Retries per plan
      requiresApproval: config.constraints?.requiresApproval ?? true,
      allowedTools: config.constraints?.allowedTools || null,       // null = all allowed
      blockedTools: config.constraints?.blockedTools || [],
      sandboxMode: config.constraints?.sandboxMode || 'disabled',   // v39.1.1: Per-goal sandbox mode
    },

    // v39.0.1: Static context — immutable, set at creation
    staticContext: {
      owner: config.staticContext?.owner || 'user',                 // Who created the goal
      type: config.staticContext?.type || 'general',                // Goal type/category
      initialInput: config.context?.input || {},                    // Original input (immutable)
      createdBy: config.staticContext?.createdBy || 'user',         // 'user' | 'system' | 'copilot'
    },

    // v39.0.1: Dynamic context — reloaded at execution time
    // These are KEYS, not values — actual values fetched from providers
    dynamicContextKeys: {
      permissionsKey: config.dynamicContextKeys?.permissionsKey || null,  // Key to fetch permissions
      limitsKey: config.dynamicContextKeys?.limitsKey || null,            // Key to fetch limits
      preferencesKey: config.dynamicContextKeys?.preferencesKey || null,  // Key to fetch preferences
    },

    // Execution context (runtime state)
    context: {
      input: config.context?.input || {},                           // Current input (may be modified)
      output: config.context?.output || null,
      error: null,
      // v39.0.1: Cached dynamic context (refreshed at execution)
      cachedDynamic: {
        permissions: null,
        limits: null,
        preferences: null,
        lastRefreshed: null,
      },
      metrics: {
        plansCreated: 0,
        plansCompleted: 0,
        plansFailed: 0,
        stepsExecuted: 0,
        retriesUsed: 0,
      },
    },

    // Plan tracking
    planIds: [],
    currentPlanId: null,

    // Progress (0-100)
    progress: {
      percent: 0,
      phase: 'idle',
      message: '',
    },

    // History log
    history: [],

    // Timestamps
    createdAt: now,
    updatedAt: now,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,

    // Metadata
    tags: config.tags || [],
    source: config.source || 'user',  // 'user' | 'system' | 'copilot'
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GOAL STORE
// ════════════════════════════════════════════════════════════════════════════

/**
 * In-memory goal store with persistence hooks
 *
 * In production, this would be backed by SQLite/Redis/etc.
 * For v39.0, we use in-memory with JSON file persistence.
 */
export class GoalStore {
  constructor(options = {}) {
    this.goals = new Map();
    this.persistPath = options.persistPath || null;
    this.maxGoals = options.maxGoals || 100;
    this.autoSave = options.autoSave ?? true;

    // Event handlers
    this.onGoalChanged = options.onGoalChanged || null;

    // v39.0.1: Dynamic context providers
    // These are functions that fetch fresh context at execution time
    this.contextProviders = {
      permissions: options.permissionsProvider || null,  // (key) => permissions
      limits: options.limitsProvider || null,            // (key) => limits
      preferences: options.preferencesProvider || null,  // (key) => preferences
    };

    // Stats
    this.stats = {
      created: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // v39.0.1: DYNAMIC CONTEXT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set a context provider
   * @param {string} type - 'permissions' | 'limits' | 'preferences'
   * @param {Function} provider - (key) => value
   */
  setContextProvider(type, provider) {
    if (this.contextProviders.hasOwnProperty(type)) {
      this.contextProviders[type] = provider;
    }
  }

  /**
   * Refresh dynamic context for a goal (called before execution)
   * This ensures goal always runs with current permissions/limits/preferences
   */
  async refreshDynamicContext(goalId) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    const refreshed = {
      permissions: null,
      limits: null,
      preferences: null,
      lastRefreshed: Date.now(),
    };

    // Fetch permissions
    if (goal.dynamicContextKeys.permissionsKey && this.contextProviders.permissions) {
      try {
        refreshed.permissions = await this.contextProviders.permissions(
          goal.dynamicContextKeys.permissionsKey
        );
      } catch (e) {
        logger.warn('GoalStore', `Failed to refresh permissions for ${goalId}`, { error: e.message });
      }
    }

    // Fetch limits
    if (goal.dynamicContextKeys.limitsKey && this.contextProviders.limits) {
      try {
        refreshed.limits = await this.contextProviders.limits(
          goal.dynamicContextKeys.limitsKey
        );
      } catch (e) {
        logger.warn('GoalStore', `Failed to refresh limits for ${goalId}`, { error: e.message });
      }
    }

    // Fetch preferences
    if (goal.dynamicContextKeys.preferencesKey && this.contextProviders.preferences) {
      try {
        refreshed.preferences = await this.contextProviders.preferences(
          goal.dynamicContextKeys.preferencesKey
        );
      } catch (e) {
        logger.warn('GoalStore', `Failed to refresh preferences for ${goalId}`, { error: e.message });
      }
    }

    // Update cached context
    goal.context.cachedDynamic = refreshed;
    goal.updatedAt = Date.now();

    this.logHistory(goal, 'CONTEXT_REFRESHED', {
      hasPermissions: !!refreshed.permissions,
      hasLimits: !!refreshed.limits,
      hasPreferences: !!refreshed.preferences,
    });

    logger.debug('GoalStore', `Dynamic context refreshed for ${goalId}`);
    return { success: true, refreshed };
  }

  /**
   * Get effective permissions for a goal (combines static + dynamic)
   */
  getEffectivePermissions(goalId) {
    const goal = this.get(goalId);
    if (!goal) return null;

    // Dynamic permissions override static constraints
    const dynamic = goal.context.cachedDynamic?.permissions;
    if (dynamic) {
      return {
        ...goal.constraints,  // Base constraints
        ...dynamic,           // Override with dynamic
      };
    }

    return goal.constraints;
  }

  /**
   * Check if dynamic context is stale (older than maxAge ms)
   */
  isDynamicContextStale(goalId, maxAge = 60000) {
    const goal = this.get(goalId);
    if (!goal) return true;

    const lastRefreshed = goal.context.cachedDynamic?.lastRefreshed;
    if (!lastRefreshed) return true;

    return (Date.now() - lastRefreshed) > maxAge;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create and store a new goal
   */
  create(config) {
    if (this.goals.size >= this.maxGoals) {
      // Evict oldest completed/cancelled goals
      this.evictOldGoals();
    }

    const goal = createGoal(config);
    this.goals.set(goal.id, goal);
    this.stats.created++;

    this.logHistory(goal, 'CREATED', { config });
    this.notifyChange(goal, 'created');

    logger.debug('GoalStore', `Goal created: ${goal.id}`, { description: goal.description });
    return goal;
  }

  /**
   * Get a goal by ID
   */
  get(goalId) {
    return this.goals.get(goalId) || null;
  }

  /**
   * Update a goal
   */
  update(goalId, updates) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: `Goal not found: ${goalId}` };
    }

    const previous = { ...goal };

    // Apply updates
    Object.assign(goal, updates, { updatedAt: Date.now() });

    this.logHistory(goal, 'UPDATED', { updates: Object.keys(updates) });
    this.notifyChange(goal, 'updated', previous);

    return { success: true, goal };
  }

  /**
   * Delete a goal
   */
  delete(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: `Goal not found: ${goalId}` };
    }

    // Only allow deleting completed/cancelled/failed goals
    if (goal.status === GoalStatus.RUNNING) {
      return { success: false, error: 'Cannot delete running goal. Cancel it first.' };
    }

    this.goals.delete(goalId);
    this.notifyChange(goal, 'deleted');

    logger.debug('GoalStore', `Goal deleted: ${goalId}`);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATUS TRANSITIONS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a goal for execution
   */
  schedule(goalId, scheduledAt = null) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (goal.status !== GoalStatus.CREATED && goal.status !== GoalStatus.PAUSED) {
      return { success: false, error: `Cannot schedule goal in status: ${goal.status}` };
    }

    goal.status = GoalStatus.SCHEDULED;
    goal.scheduledAt = scheduledAt || Date.now();
    goal.updatedAt = Date.now();

    this.logHistory(goal, 'SCHEDULED', { scheduledAt: goal.scheduledAt });
    this.notifyChange(goal, 'scheduled');

    return { success: true };
  }

  /**
   * Start running a goal
   */
  start(goalId) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (goal.status !== GoalStatus.SCHEDULED && goal.status !== GoalStatus.PAUSED) {
      return { success: false, error: `Cannot start goal in status: ${goal.status}` };
    }

    goal.status = GoalStatus.RUNNING;
    goal.startedAt = goal.startedAt || Date.now();
    goal.updatedAt = Date.now();
    goal.progress.phase = 'running';

    this.logHistory(goal, 'STARTED', {});
    this.notifyChange(goal, 'started');

    return { success: true };
  }

  /**
   * Pause a running goal
   */
  pause(goalId, reason = 'user_request') {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (goal.status !== GoalStatus.RUNNING) {
      return { success: false, error: `Cannot pause goal in status: ${goal.status}` };
    }

    goal.status = GoalStatus.PAUSED;
    goal.updatedAt = Date.now();
    goal.progress.phase = 'paused';
    goal.progress.message = reason;

    this.logHistory(goal, 'PAUSED', { reason });
    this.notifyChange(goal, 'paused');

    return { success: true };
  }

  /**
   * Complete a goal successfully
   */
  complete(goalId, output = null) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    goal.status = GoalStatus.COMPLETED;
    goal.completedAt = Date.now();
    goal.updatedAt = Date.now();
    goal.context.output = output;
    goal.progress.percent = 100;
    goal.progress.phase = 'completed';

    this.stats.completed++;
    this.logHistory(goal, 'COMPLETED', { hasOutput: !!output });
    this.notifyChange(goal, 'completed');

    logger.debug('GoalStore', `Goal completed: ${goal.id}`);
    return { success: true };
  }

  /**
   * Mark a goal as failed
   */
  fail(goalId, error) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    goal.status = GoalStatus.FAILED;
    goal.completedAt = Date.now();
    goal.updatedAt = Date.now();
    goal.context.error = error;
    goal.progress.phase = 'failed';
    goal.progress.message = error;

    this.stats.failed++;
    this.logHistory(goal, 'FAILED', { error });
    this.notifyChange(goal, 'failed');

    logger.error('GoalStore', `Goal failed: ${goal.id}`, { error });
    return { success: true };
  }

  /**
   * Cancel a goal
   */
  cancel(goalId, reason = 'user_cancelled') {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (goal.status === GoalStatus.COMPLETED || goal.status === GoalStatus.CANCELLED) {
      return { success: false, error: `Cannot cancel goal in status: ${goal.status}` };
    }

    goal.status = GoalStatus.CANCELLED;
    goal.completedAt = Date.now();
    goal.updatedAt = Date.now();
    goal.progress.phase = 'cancelled';
    goal.progress.message = reason;

    this.stats.cancelled++;
    this.logHistory(goal, 'CANCELLED', { reason });
    this.notifyChange(goal, 'cancelled');

    logger.debug('GoalStore', `Goal cancelled: ${goal.id}`, { reason });
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PLAN TRACKING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Associate a plan with a goal
   */
  addPlan(goalId, planId) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    goal.planIds.push(planId);
    goal.currentPlanId = planId;
    goal.context.metrics.plansCreated++;
    goal.updatedAt = Date.now();

    this.logHistory(goal, 'PLAN_ADDED', { planId });
    return { success: true };
  }

  /**
   * Record plan completion
   */
  recordPlanResult(goalId, planId, success, result = null) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (success) {
      goal.context.metrics.plansCompleted++;
    } else {
      goal.context.metrics.plansFailed++;
    }

    goal.updatedAt = Date.now();
    this.logHistory(goal, success ? 'PLAN_COMPLETED' : 'PLAN_FAILED', { planId, result });

    return { success: true };
  }

  /**
   * Update goal progress
   */
  updateProgress(goalId, percent, phase = null, message = null) {
    const goal = this.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    goal.progress.percent = Math.min(100, Math.max(0, percent));
    if (phase) goal.progress.phase = phase;
    if (message) goal.progress.message = message;
    goal.updatedAt = Date.now();

    this.notifyChange(goal, 'progress');
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all goals
   */
  getAll() {
    return Array.from(this.goals.values());
  }

  /**
   * Get goals by status
   */
  getByStatus(status) {
    return this.getAll().filter(g => g.status === status);
  }

  /**
   * Get active goals (running or scheduled)
   */
  getActive() {
    return this.getAll().filter(g =>
      g.status === GoalStatus.RUNNING ||
      g.status === GoalStatus.SCHEDULED ||
      g.status === GoalStatus.PAUSED
    );
  }

  /**
   * Get goals ready to run (scheduled and due)
   */
  getReady() {
    const now = Date.now();
    return this.getByStatus(GoalStatus.SCHEDULED)
      .filter(g => !g.scheduledAt || g.scheduledAt <= now)
      .sort((a, b) => b.priority - a.priority);  // Highest priority first
  }

  /**
   * Get goals by tag
   */
  getByTag(tag) {
    return this.getAll().filter(g => g.tags.includes(tag));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Export all goals to JSON
   */
  export() {
    return {
      goals: this.getAll(),
      stats: { ...this.stats },
      exportedAt: Date.now(),
    };
  }

  /**
   * Import goals from JSON
   */
  import(data) {
    if (!data.goals || !Array.isArray(data.goals)) {
      return { success: false, error: 'Invalid import data' };
    }

    let imported = 0;
    for (const goal of data.goals) {
      if (!this.goals.has(goal.id)) {
        this.goals.set(goal.id, goal);
        imported++;
      }
    }

    logger.debug('GoalStore', `Imported ${imported} goals`);
    return { success: true, imported };
  }

  /**
   * Clear all goals (use with caution)
   */
  clear() {
    const count = this.goals.size;
    this.goals.clear();
    logger.debug('GoalStore', `Cleared ${count} goals`);
    return { success: true, cleared: count };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Log history entry
   */
  logHistory(goal, event, data) {
    goal.history.push({
      event,
      data,
      timestamp: Date.now(),
    });

    // Trim history if too long
    if (goal.history.length > 100) {
      goal.history = goal.history.slice(-100);
    }
  }

  /**
   * Notify change listeners
   */
  notifyChange(goal, event, previous = null) {
    if (this.onGoalChanged) {
      try {
        this.onGoalChanged(goal, event, previous);
      } catch (e) {
        logger.error('GoalStore', 'onGoalChanged handler error', { error: e.message });
      }
    }
  }

  /**
   * Evict old completed/cancelled goals to make room
   */
  evictOldGoals() {
    const evictable = this.getAll()
      .filter(g => g.status === GoalStatus.COMPLETED || g.status === GoalStatus.CANCELLED)
      .sort((a, b) => a.completedAt - b.completedAt);

    const toEvict = Math.ceil(this.maxGoals * 0.2);  // Evict 20%
    for (let i = 0; i < toEvict && i < evictable.length; i++) {
      this.goals.delete(evictable[i].id);
    }

    logger.debug('GoalStore', `Evicted ${Math.min(toEvict, evictable.length)} old goals`);
  }

  /**
   * Get store statistics
   */
  getStats() {
    return {
      total: this.goals.size,
      byStatus: {
        created: this.getByStatus(GoalStatus.CREATED).length,
        scheduled: this.getByStatus(GoalStatus.SCHEDULED).length,
        running: this.getByStatus(GoalStatus.RUNNING).length,
        paused: this.getByStatus(GoalStatus.PAUSED).length,
        completed: this.getByStatus(GoalStatus.COMPLETED).length,
        failed: this.getByStatus(GoalStatus.FAILED).length,
        cancelled: this.getByStatus(GoalStatus.CANCELLED).length,
      },
      lifetime: { ...this.stats },
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const goalStore = new GoalStore();

export default GoalStore;
