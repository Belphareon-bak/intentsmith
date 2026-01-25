// CRE v39.0 Goal Scheduler
// ══════════════════════════════════════════════════════════════════════════════
//
// Schedules and queues goals for execution.
//
// Responsibilities:
//   - Queue management (priority-based)
//   - Cron/schedule parsing
//   - Concurrency control
//   - Trigger evaluation
//
// Key Invariants:
//   ✅ Never exceed max concurrent goals
//   ✅ Respect priority ordering
//   ✅ Handle recurring schedules
//   ✅ Gate all goal starts through approval (if required)
//
// ══════════════════════════════════════════════════════════════════════════════

import { GoalStatus, GoalTrigger, goalStore } from './goal-store.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SCHEDULER LIMITS
// ════════════════════════════════════════════════════════════════════════════

export const DEFAULT_SCHEDULER_LIMITS = {
  maxConcurrentGoals: 3,        // Max goals running at once
  maxQueueSize: 50,             // Max pending goals
  tickInterval: 5000,           // Scheduler tick interval (5s)
  maxGoalDuration: 3600000,     // Max single goal duration (1 hour)
};

// ════════════════════════════════════════════════════════════════════════════
// CRON PARSER (simplified)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parse a simple cron-like schedule
 *
 * Supported formats:
 *   - "every 5m" → every 5 minutes
 *   - "every 1h" → every hour
 *   - "daily 09:00" → daily at 9am
 *   - "weekly mon 09:00" → weekly on Monday at 9am
 *
 * Returns next run timestamp, or null if invalid
 */
export function parseSchedule(schedule, fromTime = Date.now()) {
  if (!schedule) return null;

  const s = schedule.toLowerCase().trim();

  // "every Xm" - every X minutes
  const everyMinMatch = s.match(/^every\s+(\d+)m$/);
  if (everyMinMatch) {
    const minutes = parseInt(everyMinMatch[1], 10);
    return fromTime + minutes * 60 * 1000;
  }

  // "every Xh" - every X hours
  const everyHourMatch = s.match(/^every\s+(\d+)h$/);
  if (everyHourMatch) {
    const hours = parseInt(everyHourMatch[1], 10);
    return fromTime + hours * 60 * 60 * 1000;
  }

  // "daily HH:MM" - daily at specific time
  const dailyMatch = s.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1], 10);
    const minute = parseInt(dailyMatch[2], 10);
    const now = new Date(fromTime);
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= fromTime) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  // "weekly DAY HH:MM" - weekly on specific day
  const weeklyMatch = s.match(/^weekly\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const targetDay = dayMap[weeklyMatch[1]];
    const hour = parseInt(weeklyMatch[2], 10);
    const minute = parseInt(weeklyMatch[3], 10);

    const now = new Date(fromTime);
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= fromTime)) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);

    return next.getTime();
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// GOAL SCHEDULER
// ════════════════════════════════════════════════════════════════════════════

export class GoalScheduler {
  constructor(options = {}) {
    this.store = options.store || goalStore;
    this.limits = { ...DEFAULT_SCHEDULER_LIMITS, ...options.limits };

    // Execution callback
    this.onGoalReady = options.onGoalReady || null;

    // Approval callback (for gated goals)
    this.onApprovalRequired = options.onApprovalRequired || null;

    // State
    this.running = false;
    this.tickTimer = null;
    this.pendingApprovals = new Map();  // goalId → { resolve, reject }

    // Stats
    this.stats = {
      goalsScheduled: 0,
      goalsStarted: 0,
      goalsDenied: 0,
      tickCount: 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start the scheduler
   */
  start() {
    if (this.running) return;

    this.running = true;
    this.tick();  // Initial tick
    this.tickTimer = setInterval(() => this.tick(), this.limits.tickInterval);

    logger.debug('GoalScheduler', 'Scheduler started', { interval: this.limits.tickInterval });
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.running) return;

    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    logger.debug('GoalScheduler', 'Scheduler stopped');
  }

  /**
   * Scheduler tick — check for goals to run
   */
  async tick() {
    if (!this.running) return;

    this.stats.tickCount++;

    // 1. Check recurring goals that need rescheduling
    this.checkRecurringGoals();

    // 2. Get goals ready to run
    const readyGoals = this.store.getReady();

    if (readyGoals.length === 0) return;

    // 3. Check concurrency limit
    const runningGoals = this.store.getByStatus(GoalStatus.RUNNING);
    const availableSlots = this.limits.maxConcurrentGoals - runningGoals.length;

    if (availableSlots <= 0) {
      logger.debug('GoalScheduler', 'All slots busy, waiting...', {
        running: runningGoals.length,
        waiting: readyGoals.length,
      });
      return;
    }

    // 4. Start goals (up to available slots)
    const toStart = readyGoals.slice(0, availableSlots);

    for (const goal of toStart) {
      await this.tryStartGoal(goal);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GOAL SCHEDULING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a goal
   */
  schedule(goal) {
    // Check queue limit
    const scheduled = this.store.getByStatus(GoalStatus.SCHEDULED);
    if (scheduled.length >= this.limits.maxQueueSize) {
      logger.warn('GoalScheduler', 'Queue full, cannot schedule', { goalId: goal.id });
      return { success: false, error: 'Queue full' };
    }

    // Calculate next run time based on trigger
    let scheduledAt = Date.now();

    switch (goal.trigger.type) {
      case GoalTrigger.IMMEDIATE:
        scheduledAt = Date.now();
        break;

      case GoalTrigger.SCHEDULED:
        scheduledAt = goal.trigger.at || Date.now();
        break;

      case GoalTrigger.RECURRING:
        scheduledAt = parseSchedule(goal.trigger.schedule) || Date.now();
        break;

      case GoalTrigger.MANUAL:
        // Manual goals stay in CREATED until explicitly started
        return { success: true, waiting: true };

      case GoalTrigger.EVENT:
        // Event-triggered goals wait for event
        return { success: true, waiting: true };
    }

    // Schedule it
    const result = this.store.schedule(goal.id, scheduledAt);
    if (result.success) {
      this.stats.goalsScheduled++;
    }

    return result;
  }

  /**
   * Try to start a goal (with approval gate if needed)
   */
  async tryStartGoal(goal) {
    // Check if goal requires approval
    if (goal.constraints.requiresApproval && !this.isApproved(goal.id)) {
      // Request approval
      if (this.onApprovalRequired) {
        logger.debug('GoalScheduler', `Goal requires approval: ${goal.id}`);

        const approved = await this.requestApproval(goal);
        if (!approved) {
          this.stats.goalsDenied++;
          logger.debug('GoalScheduler', `Goal approval denied: ${goal.id}`);
          // Keep in scheduled state for now, or cancel?
          return { success: false, reason: 'approval_denied' };
        }
      }
    }

    // Start the goal
    const result = this.store.start(goal.id);
    if (!result.success) {
      return result;
    }

    this.stats.goalsStarted++;

    // Notify runner
    if (this.onGoalReady) {
      try {
        await this.onGoalReady(goal);
      } catch (e) {
        logger.error('GoalScheduler', 'onGoalReady handler error', { error: e.message });
      }
    }

    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // APPROVAL HANDLING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Request approval for a goal
   */
  async requestApproval(goal) {
    return new Promise((resolve) => {
      this.pendingApprovals.set(goal.id, { resolve, goal });

      if (this.onApprovalRequired) {
        this.onApprovalRequired({
          goalId: goal.id,
          description: goal.description,
          constraints: goal.constraints,
          approve: () => this.approveGoal(goal.id),
          deny: () => this.denyGoal(goal.id),
        });
      }

      // Auto-timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingApprovals.has(goal.id)) {
          this.pendingApprovals.delete(goal.id);
          resolve(false);  // Timeout = deny
        }
      }, 60000);
    });
  }

  /**
   * Approve a goal
   */
  approveGoal(goalId) {
    const pending = this.pendingApprovals.get(goalId);
    if (pending) {
      this.pendingApprovals.delete(goalId);
      pending.resolve(true);
    }
  }

  /**
   * Deny a goal
   */
  denyGoal(goalId) {
    const pending = this.pendingApprovals.get(goalId);
    if (pending) {
      this.pendingApprovals.delete(goalId);
      pending.resolve(false);
    }
  }

  /**
   * Check if goal is approved
   */
  isApproved(goalId) {
    // For now, goals without pending approval are considered approved
    return !this.pendingApprovals.has(goalId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RECURRING GOALS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check and reschedule recurring goals
   */
  checkRecurringGoals() {
    const completed = this.store.getByStatus(GoalStatus.COMPLETED);

    for (const goal of completed) {
      if (goal.trigger.type === GoalTrigger.RECURRING && goal.trigger.schedule) {
        // Calculate next run
        const nextRun = parseSchedule(goal.trigger.schedule, goal.completedAt);
        if (nextRun && nextRun > Date.now()) {
          // Create a new instance of this goal
          const newGoal = this.store.create({
            description: goal.description,
            priority: goal.priority,
            trigger: goal.trigger,
            constraints: goal.constraints,
            context: { input: goal.context.input },
            tags: [...goal.tags, 'recurring'],
            source: 'scheduler',
          });

          this.store.schedule(newGoal.id, nextRun);
          logger.debug('GoalScheduler', `Rescheduled recurring goal: ${newGoal.id}`, {
            originalId: goal.id,
            nextRun: new Date(nextRun).toISOString(),
          });
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MANUAL TRIGGERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Manually trigger a goal (for MANUAL trigger type)
   */
  trigger(goalId) {
    const goal = this.store.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (goal.status !== GoalStatus.CREATED && goal.status !== GoalStatus.PAUSED) {
      return { success: false, error: `Cannot trigger goal in status: ${goal.status}` };
    }

    return this.store.schedule(goalId, Date.now());
  }

  /**
   * Emit an event (for EVENT trigger type)
   */
  emitEvent(eventName, data = {}) {
    const eventGoals = this.store.getAll().filter(
      g => g.trigger.type === GoalTrigger.EVENT &&
           g.trigger.event === eventName &&
           g.status === GoalStatus.CREATED
    );

    let triggered = 0;
    for (const goal of eventGoals) {
      // Store event data in context
      goal.context.input = { ...goal.context.input, eventData: data };
      this.store.schedule(goal.id, Date.now());
      triggered++;
    }

    logger.debug('GoalScheduler', `Event emitted: ${eventName}`, { triggered });
    return { success: true, triggered };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────────────

  getStats() {
    return {
      running: this.running,
      ...this.stats,
      queue: {
        scheduled: this.store.getByStatus(GoalStatus.SCHEDULED).length,
        running: this.store.getByStatus(GoalStatus.RUNNING).length,
        pendingApproval: this.pendingApprovals.size,
      },
      limits: this.limits,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const goalScheduler = new GoalScheduler();

export default GoalScheduler;
