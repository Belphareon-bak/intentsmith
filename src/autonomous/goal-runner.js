// CRE v39.0 Goal Runner
// ══════════════════════════════════════════════════════════════════════════════
//
// Executes goals by creating and running plans.
//
// Goal → Plan → Steps → Results → Goal Output
//
// Key Responsibilities:
//   - Convert goal to plan
//   - Execute plan via PlanRunner
//   - Handle plan failures (retry, replan, fail)
//   - Track progress and metrics
//   - Respect goal constraints
//
// Key Invariants:
//   ✅ Never exceed goal duration limit
//   ✅ Never exceed max plan attempts
//   ✅ All actions respect safety constraints
//   ✅ Progress is tracked and reported
//
// ══════════════════════════════════════════════════════════════════════════════

import { GoalStatus, goalStore } from './goal-store.js';
import { goalScheduler } from './goal-scheduler.js';
import { planRunner } from '../planner/runner.js';
import { createPlan, createStep, PlanStatus } from '../planner/types.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// GOAL EXECUTION RESULT
// ════════════════════════════════════════════════════════════════════════════

export const GoalExecutionResult = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
};

// ════════════════════════════════════════════════════════════════════════════
// GOAL RUNNER
// ════════════════════════════════════════════════════════════════════════════

export class GoalRunner {
  constructor(options = {}) {
    this.store = options.store || goalStore;
    this.scheduler = options.scheduler || goalScheduler;
    this.planRunner = options.planRunner || planRunner;

    // Plan generator function: (goal) => Plan
    // In v39.2+, this will use the LLM planner
    this.planGenerator = options.planGenerator || this.defaultPlanGenerator.bind(this);

    // Running goals
    this.runningGoals = new Map();  // goalId → { abortController, startTime, plan }

    // Callbacks
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onFailed = options.onFailed || null;

    // Stats
    this.stats = {
      goalsExecuted: 0,
      goalsCompleted: 0,
      goalsFailed: 0,
      plansGenerated: 0,
      totalDuration: 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EXECUTION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute a goal
   */
  async execute(goal) {
    const goalId = goal.id;

    logger.debug('GoalRunner', `Executing goal: ${goalId}`, { description: goal.description });

    // Track execution
    const execution = {
      abortController: new AbortController(),
      startTime: Date.now(),
      plan: null,
    };
    this.runningGoals.set(goalId, execution);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this.timeout(goalId);
    }, goal.constraints.maxDuration);

    try {
      const result = await this.runGoal(goal, execution);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      return this.handleError(goal, error);
    } finally {
      this.runningGoals.delete(goalId);
    }
  }

  /**
   * Main goal execution loop
   */
  async runGoal(goal, execution) {
    let planAttempts = 0;
    let lastPlanResult = null;

    while (planAttempts < goal.constraints.maxPlans) {
      // Check for abort
      if (execution.abortController.signal.aborted) {
        return { result: GoalExecutionResult.CANCELLED };
      }

      planAttempts++;
      this.updateProgress(goal, 10, 'planning', `Creating plan (attempt ${planAttempts})`);

      // Generate a plan for this goal
      const plan = await this.generatePlan(goal, lastPlanResult);
      if (!plan) {
        return this.failGoal(goal, 'Failed to generate plan');
      }

      execution.plan = plan;
      this.store.addPlan(goal.id, plan.id);
      this.stats.plansGenerated++;

      // Execute the plan
      this.updateProgress(goal, 20, 'executing', 'Executing plan');

      const context = this.buildExecutionContext(goal);
      const planResult = await this.planRunner.run(plan, context);

      // Handle plan result
      switch (planResult.status) {
        case PlanStatus.COMPLETED:
          this.store.recordPlanResult(goal.id, plan.id, true, planResult);
          return this.completeGoal(goal, this.extractOutput(plan));

        case PlanStatus.GATED:
          // Plan is gated — pause goal and wait for approval
          this.store.pause(goal.id, 'gated');
          return {
            result: GoalExecutionResult.PAUSED,
            gatedStep: planResult.gatedStep,
            plan: plan,
          };

        case PlanStatus.PAUSED:
          // Plan is paused — pause goal
          this.store.pause(goal.id, 'user_input_required');
          return {
            result: GoalExecutionResult.PAUSED,
            question: planResult.question,
            plan: plan,
          };

        case PlanStatus.FAILED:
        default:
          // Plan failed — record and maybe retry
          this.store.recordPlanResult(goal.id, plan.id, false, planResult);
          lastPlanResult = planResult;

          // Check if we should retry
          if (planAttempts < goal.constraints.maxPlans) {
            this.updateProgress(goal, 15, 'retrying', `Plan failed, retrying (${planAttempts}/${goal.constraints.maxPlans})`);
            continue;
          }

          return this.failGoal(goal, `All ${planAttempts} plan attempts failed`);
      }
    }

    return this.failGoal(goal, 'Max plan attempts exceeded');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PLAN GENERATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate a plan for a goal
   */
  async generatePlan(goal, lastFailedPlan = null) {
    try {
      const plan = await this.planGenerator(goal, lastFailedPlan);
      return plan;
    } catch (error) {
      logger.error('GoalRunner', 'Plan generation failed', { error: error.message });
      return null;
    }
  }

  /**
   * Default plan generator (simple, synchronous)
   * In v39.2+, this will be replaced by LLM-based planning
   */
  defaultPlanGenerator(goal, _lastFailedPlan) {
    // For now, create a simple single-step plan based on goal input
    const input = goal.context.input || {};

    // If goal has explicit steps, use them
    if (input.steps && Array.isArray(input.steps)) {
      return createPlan({
        goal: goal.description,
        steps: input.steps.map((s, i) => createStep({
          id: s.id || `step_${i}`,
          tool: s.tool,
          params: s.params || {},
          dependsOn: s.dependsOn || [],
          label: s.label || `Step ${i + 1}`,
        })),
      });
    }

    // If goal has a single tool call
    if (input.tool) {
      return createPlan({
        goal: goal.description,
        steps: [
          createStep({
            id: 'main',
            tool: input.tool,
            params: input.params || {},
            label: goal.description,
          }),
        ],
      });
    }

    // Default: create a placeholder plan
    return createPlan({
      goal: goal.description,
      steps: [
        createStep({
          id: 'placeholder',
          tool: 'data.parse',  // Safe no-op
          params: { input: JSON.stringify({ goal: goal.description }) },
          label: 'Goal placeholder',
        }),
      ],
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESULT HANDLERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Complete a goal successfully
   */
  completeGoal(goal, output) {
    this.store.complete(goal.id, output);
    this.stats.goalsCompleted++;
    this.stats.goalsExecuted++;
    this.stats.totalDuration += Date.now() - goal.startedAt;

    if (this.onComplete) {
      try {
        this.onComplete(goal, output);
      } catch (e) {
        logger.error('GoalRunner', 'onComplete handler error', { error: e.message });
      }
    }

    logger.debug('GoalRunner', `Goal completed: ${goal.id}`);
    return { result: GoalExecutionResult.COMPLETED, output };
  }

  /**
   * Fail a goal
   */
  failGoal(goal, error) {
    this.store.fail(goal.id, error);
    this.stats.goalsFailed++;
    this.stats.goalsExecuted++;
    this.stats.totalDuration += Date.now() - goal.startedAt;

    if (this.onFailed) {
      try {
        this.onFailed(goal, error);
      } catch (e) {
        logger.error('GoalRunner', 'onFailed handler error', { error: e.message });
      }
    }

    logger.error('GoalRunner', `Goal failed: ${goal.id}`, { error });
    return { result: GoalExecutionResult.FAILED, error };
  }

  /**
   * Handle execution error
   */
  handleError(goal, error) {
    return this.failGoal(goal, error.message || 'Unknown error');
  }

  /**
   * Handle timeout
   */
  timeout(goalId) {
    const execution = this.runningGoals.get(goalId);
    if (execution) {
      execution.abortController.abort();
      const goal = this.store.get(goalId);
      if (goal) {
        this.store.fail(goalId, 'Goal execution timeout');
        logger.warn('GoalRunner', `Goal timed out: ${goalId}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONTROL
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Cancel a running goal
   */
  cancel(goalId) {
    const execution = this.runningGoals.get(goalId);
    if (execution) {
      execution.abortController.abort();
    }
    this.store.cancel(goalId);
    return { success: true };
  }

  /**
   * Pause a running goal
   */
  pause(goalId) {
    this.store.pause(goalId, 'user_request');
    return { success: true };
  }

  /**
   * Resume a paused goal
   */
  async resume(goalId, input = {}) {
    const goal = this.store.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    if (goal.status !== GoalStatus.PAUSED) {
      return { success: false, error: `Cannot resume goal in status: ${goal.status}` };
    }

    // Merge input
    if (Object.keys(input).length > 0) {
      goal.context.input = { ...goal.context.input, ...input };
    }

    // Restart execution
    this.store.start(goalId);
    return this.execute(goal);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build execution context for plan runner
   */
  buildExecutionContext(goal) {
    return {
      goalId: goal.id,
      internal: !goal.constraints.requiresApproval,  // Skip gates if no approval needed
      allowedTools: goal.constraints.allowedTools,
      blockedTools: goal.constraints.blockedTools,
      sandboxed: goal.constraints.sandboxed,
    };
  }

  /**
   * Extract output from completed plan
   */
  extractOutput(plan) {
    // Get results from all completed steps
    const results = {};
    for (const step of plan.steps) {
      if (plan.results[step.id]) {
        results[step.id] = plan.results[step.id];
      }
    }

    // If single step, return just that result
    if (plan.steps.length === 1) {
      return plan.results[plan.steps[0].id] || null;
    }

    return results;
  }

  /**
   * Update goal progress
   */
  updateProgress(goal, percent, phase, message) {
    this.store.updateProgress(goal.id, percent, phase, message);

    if (this.onProgress) {
      try {
        this.onProgress(goal, { percent, phase, message });
      } catch (e) {
        logger.error('GoalRunner', 'onProgress handler error', { error: e.message });
      }
    }
  }

  /**
   * Check if goal is running
   */
  isRunning(goalId) {
    return this.runningGoals.has(goalId);
  }

  /**
   * Get running goal info
   */
  getRunningGoal(goalId) {
    const execution = this.runningGoals.get(goalId);
    if (!execution) return null;

    return {
      goalId,
      duration: Date.now() - execution.startTime,
      hasPlan: !!execution.plan,
      planId: execution.plan?.id,
    };
  }

  /**
   * Get all running goals
   */
  getRunningGoals() {
    return Array.from(this.runningGoals.keys()).map(id => this.getRunningGoal(id));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      running: this.runningGoals.size,
      avgDuration: this.stats.goalsExecuted > 0
        ? this.stats.totalDuration / this.stats.goalsExecuted
        : 0,
      successRate: this.stats.goalsExecuted > 0
        ? this.stats.goalsCompleted / this.stats.goalsExecuted
        : 0,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const goalRunner = new GoalRunner();

// Wire up scheduler to runner
goalScheduler.onGoalReady = (goal) => goalRunner.execute(goal);

export default GoalRunner;
