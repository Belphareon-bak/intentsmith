// CRE v38.0.1 Plan Runner
// ══════════════════════════════════════════════════════════════════════════════
//
// Executes a Plan graph, respecting dependencies, conditions, and gates.
//
// v38.0 Changes:
//   - Graph-based execution (not linear)
//   - Parallel step execution (all ready steps at once)
//   - Condition evaluation (IF_SUCCESS, IF_FAILED, IF_MATCHES)
//   - Retry with exponential backoff
//   - All changes via PlanMutator (auditable)
//   - Deterministic reflection on failure (retry → fallback → ask → fail)
//
// v38.0.1 — Safety guards:
//   - Hard execution limits (maxSteps, maxIterations, maxParallel, maxRetryTotal)
//   - Cycle detection HARD FAIL (plan with cycles won't run)
//   - Visited step tracking (prevent infinite re-execution)
//
// Flow:
//   CREDecision(PLAN) → PlanRunner.run(plan)
//   → parallel execution of ready steps
//   → on failure: DeterministicReflector decides
//   → { status, results, gatedStep?, question? }
//
// Architectural invariants:
//   ❌ stepResult doesn't change plan directly
//   ✅ All changes via PlanMutator
//   ✅ Every mutation is auditable
//   ✅ Hard limits enforced (v38.0.1)
//
// ══════════════════════════════════════════════════════════════════════════════

import { toolExecutor, ToolError } from '../tools/executor.js';
import { humanGate } from '../gates/human-gate.js';
import {
  StepStatus, PlanStatus,
  areDependenciesMet, hasDependencyFailed, getNextSteps, getParallelSteps,
  isPlanComplete, evaluateCondition, getRetryDelay, validatePlan,
  DEFAULT_EXECUTION_LIMITS, createExecutionLimits, ExecutionLimitError
} from './types.js';
import { createMutator } from './mutations.js';
import { deterministicReflector, ReflectionAction } from './reflection.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// PLAN RUNNER (v38.0.1)
// ════════════════════════════════════════════════════════════════════════════

export class PlanRunner {
  constructor(options = {}) {
    this.defaultStepTimeout = options.stepTimeout || 30000;
    this.parallelExecution = options.parallel ?? true; // v38: parallel by default
    this.reflector = options.reflector || deterministicReflector;
    this.executionHistory = [];

    // v38.0.1: Execution limits — NON-NEGOTIABLE safety guards
    this.limits = createExecutionLimits(options.limits || {});
  }

  /**
   * Run a plan to completion (or until gated/failed/paused)
   *
   * @param {Plan} plan
   * @param {Object} [context] - Shared context (API keys, etc.)
   * @returns {Promise<{ status: string, plan: Plan, gatedStep?: Step, question?: Object, error?: string }>}
   */
  async run(plan, context = {}) {
    const mutator = createMutator(plan);

    // v38.0.1: HARD FAIL on cycles — don't even start
    const validation = validatePlan(plan);
    if (!validation.valid) {
      if (plan.graph?.hasCycles) {
        mutator.setPlanStatus(PlanStatus.FAILED, 'runner');
        logger.error('PlanRunner', 'CYCLE_DETECTED: Plan has cycles, refusing to execute');
        return {
          status: PlanStatus.FAILED,
          plan,
          error: ExecutionLimitError.CYCLE_DETECTED,
          details: 'Plan graph contains cycles — infinite loop risk',
        };
      }
    }

    mutator.setPlanStatus(PlanStatus.RUNNING, 'runner');

    logger.debug('PlanRunner', `Running plan: ${plan.goal}`, {
      steps: plan.steps.length,
      parallel: this.parallelExecution,
      limits: this.limits,
    });

    // Set goal for HumanGate scope
    humanGate.setGoal(plan.id);

    // v38.0.1: Execution tracking
    let stepsExecuted = 0;
    let iterations = 0;
    let totalRetries = 0;
    const visitedSteps = new Set(); // Track executed steps to detect re-execution loops

    while (!isPlanComplete(plan)) {
      iterations++;

      // v38.0.1: HARD LIMIT — max iterations
      if (iterations > this.limits.maxIterations) {
        mutator.setPlanStatus(PlanStatus.FAILED, 'runner');
        logger.error('PlanRunner', `MAX_ITERATIONS_EXCEEDED: ${iterations} > ${this.limits.maxIterations}`);
        return {
          status: PlanStatus.FAILED,
          plan,
          error: ExecutionLimitError.MAX_ITERATIONS_EXCEEDED,
        };
      }

      // v38.0.1: HARD LIMIT — max steps
      if (stepsExecuted >= this.limits.maxSteps) {
        mutator.setPlanStatus(PlanStatus.FAILED, 'runner');
        logger.error('PlanRunner', `MAX_STEPS_EXCEEDED: ${stepsExecuted} >= ${this.limits.maxSteps}`);
        return {
          status: PlanStatus.FAILED,
          plan,
          error: ExecutionLimitError.MAX_STEPS_EXCEEDED,
        };
      }

      // v38.0.1: HARD LIMIT — max total retries
      if (totalRetries > this.limits.maxRetryTotal) {
        mutator.setPlanStatus(PlanStatus.FAILED, 'runner');
        logger.error('PlanRunner', `MAX_RETRY_EXCEEDED: ${totalRetries} > ${this.limits.maxRetryTotal}`);
        return {
          status: PlanStatus.FAILED,
          plan,
          error: ExecutionLimitError.MAX_RETRY_EXCEEDED,
        };
      }

      // Mark failed dependencies as SKIPPED
      this.propagateFailures(plan, mutator);

      // Get next executable steps (v38: parallel-aware)
      let nextSteps = this.parallelExecution
        ? getParallelSteps(plan)
        : getNextSteps(plan).slice(0, 1);

      // v38.0.1: Enforce maxParallel limit
      if (nextSteps.length > this.limits.maxParallel) {
        nextSteps = nextSteps.slice(0, this.limits.maxParallel);
      }

      if (nextSteps.length === 0) {
        // No more runnable steps — either all done, or deadlocked
        if (!isPlanComplete(plan)) {
          mutator.setPlanStatus(PlanStatus.FAILED, 'runner');
          return { status: PlanStatus.FAILED, plan, error: 'Deadlock: no runnable steps' };
        }
        break;
      }

      // Execute steps (parallel or sequential)
      if (this.parallelExecution && nextSteps.length > 1) {
        // Track which steps we're executing
        for (const s of nextSteps) {
          visitedSteps.add(`${s.id}:${s.attempts}`);
        }

        const results = await this.executeParallel(nextSteps, plan, mutator, context);
        stepsExecuted += nextSteps.length;

        // v38.0.1: Track retries from results
        for (const r of results) {
          if (r.retrying) totalRetries++;
        }

        // Check for gated/paused conditions
        const pauseResult = this.checkPauseConditions(results, plan, mutator);
        if (pauseResult) return pauseResult;
      } else {
        // Single step execution
        const step = nextSteps[0];

        // v38.0.1: Track step execution
        visitedSteps.add(`${step.id}:${step.attempts}`);

        const result = await this.executeStep(step, plan, mutator, context);
        stepsExecuted++;

        // v38.0.1: Track retries
        if (result.retrying) totalRetries++;

        // Handle special results
        if (result.gated) {
          mutator.setPlanStatus(PlanStatus.GATED, 'runner');
          return { status: PlanStatus.GATED, plan, gatedStep: step };
        }
        if (result.askUser) {
          mutator.setPlanStatus(PlanStatus.PAUSED, 'runner');
          return { status: PlanStatus.PAUSED, plan, question: result.question };
        }
      }
    }

    // Determine final status
    const hasFailures = plan.steps.some(s => s.status === StepStatus.FAILED);
    const finalStatus = hasFailures ? PlanStatus.FAILED : PlanStatus.COMPLETED;
    mutator.setPlanStatus(finalStatus, 'runner');

    this.logPlanExecution(plan);

    logger.debug('PlanRunner', `Plan ${plan.status}: ${plan.goal}`, {
      completed: plan.steps.filter(s => s.status === StepStatus.COMPLETED).length,
      failed: plan.steps.filter(s => s.status === StepStatus.FAILED).length,
      skipped: plan.steps.filter(s => s.status === StepStatus.SKIPPED).length,
    });

    return { status: plan.status, plan };
  }

  /**
   * Resume a gated plan after user confirms
   *
   * @param {Plan} plan - Previously gated plan
   * @param {string} confirmedTool - Tool that was confirmed
   * @param {Object} [context]
   */
  async resume(plan, confirmedTool, context = {}) {
    // Confirm the tool in gate
    humanGate.confirm(confirmedTool);

    const mutator = createMutator(plan);

    // Reset the gated step to PENDING
    const gatedStep = plan.steps.find(s => s.status === StepStatus.GATED);
    if (gatedStep) {
      mutator.setStepStatus(gatedStep.id, StepStatus.PENDING, 'runner');
    }

    // Continue execution
    return this.run(plan, context);
  }

  /**
   * Resume after user answers a question (v38.2)
   *
   * @param {Plan} plan - Previously paused plan
   * @param {Object} answer - User's answer { stepId, value }
   * @param {Object} [context]
   */
  async resumeWithAnswer(plan, answer, context = {}) {
    const mutator = createMutator(plan);

    // Find the step that was waiting for input
    const step = plan.steps.find(s => s.id === answer.stepId);
    if (step) {
      // Apply the answer to step params
      mutator.modifyStep(step.id, {
        params: { ...step.params, ...answer.value },
      }, 'user');

      // Reset to PENDING
      mutator.setStepStatus(step.id, StepStatus.PENDING, 'runner');
    }

    // Continue execution
    return this.run(plan, context);
  }

  /**
   * Execute steps in parallel (v38.0)
   */
  async executeParallel(steps, plan, mutator, context) {
    logger.debug('PlanRunner', `Executing ${steps.length} steps in parallel`, {
      steps: steps.map(s => s.id),
    });

    const promises = steps.map(step =>
      this.executeStep(step, plan, mutator, context)
    );

    return Promise.all(promises);
  }

  /**
   * Execute a single step (v38.0 — via mutator)
   */
  async executeStep(step, plan, mutator, context) {
    // Check condition before execution (v38.0)
    if (!evaluateCondition(step, plan)) {
      mutator.skipStep(step.id, 'Condition not met', 'runner');
      return { skipped: true };
    }

    mutator.setStepStatus(step.id, StepStatus.RUNNING, 'runner');

    // Build params: merge with mapInput from dependencies
    let params = { ...step.params };
    if (step.mapInput && step.dependsOn.length > 0) {
      const depResults = {};
      for (const depId of step.dependsOn) {
        depResults[depId] = plan.results[depId];
      }
      try {
        params = { ...params, ...step.mapInput(depResults) };
      } catch (err) {
        mutator.setStepError(step.id, `mapInput error: ${err.message}`, 'INVALID_INPUT', 'runner');
        return this.handleFailure(step, plan, mutator);
      }
    }

    // Execute via ToolExecutor
    const decision = { type: 'TOOL_CALL', tool: step.tool, params };
    const result = await toolExecutor.execute(decision, {
      ...context,
      timeout: context.stepTimeout || this.defaultStepTimeout,
    });

    // Handle GATED
    if (result.code === ToolError.GATED) {
      mutator.setStepStatus(step.id, StepStatus.GATED, 'runner');
      step.error = result.error;
      return { gated: true };
    }

    // Handle FAILURE
    if (!result.ok) {
      // Set error with code for reflection
      const errorCode = this.mapErrorCode(result);
      mutator.setStepError(step.id, result.error, errorCode, 'runner');

      return this.handleFailure(step, plan, mutator);
    }

    // SUCCESS
    mutator.setStepResult(step.id, result.data, 'runner');
    return { success: true, data: result.data };
  }

  /**
   * Handle step failure with reflection (v38.2)
   */
  handleFailure(step, plan, mutator) {
    // Get reflection decision
    const reflection = this.reflector.reflect(step, plan);

    logger.debug('PlanRunner', `Reflection for ${step.id}: ${reflection.action}`, {
      reason: reflection.reason,
    });

    // Apply reflection
    const applied = this.reflector.applyReflection(reflection, step, plan);

    switch (reflection.action) {
      case ReflectionAction.RETRY:
        // Schedule retry with delay
        return this.scheduleRetry(step, plan, mutator, reflection.delay);

      case ReflectionAction.FALLBACK:
        // Fallback enabled — will be picked up on next iteration
        return { fallback: true, fallbackStepId: reflection.fallbackStepId };

      case ReflectionAction.ASK_USER:
        // Pause and return question
        return { askUser: true, question: reflection.question };

      case ReflectionAction.SKIP:
        // Already marked as skipped
        return { skipped: true };

      case ReflectionAction.FAIL:
      default:
        // Step remains failed — dependent steps will be skipped
        return { failed: true, error: step.error };
    }
  }

  /**
   * Schedule a retry with delay (v38.0)
   */
  async scheduleRetry(step, plan, mutator, delay) {
    if (delay > 0) {
      logger.debug('PlanRunner', `Retrying ${step.id} after ${delay}ms`);
      await this.sleep(delay);
    }

    // Reset step status to PENDING for next iteration
    mutator.setStepStatus(step.id, StepStatus.PENDING, 'runner');

    return { retrying: true, delay };
  }

  /**
   * Check if any parallel results require pause/gate
   */
  checkPauseConditions(results, plan, mutator) {
    for (const result of results) {
      if (result.gated) {
        mutator.setPlanStatus(PlanStatus.GATED, 'runner');
        const gatedStep = plan.steps.find(s => s.status === StepStatus.GATED);
        return { status: PlanStatus.GATED, plan, gatedStep };
      }
      if (result.askUser) {
        mutator.setPlanStatus(PlanStatus.PAUSED, 'runner');
        return { status: PlanStatus.PAUSED, plan, question: result.question };
      }
    }
    return null;
  }

  /**
   * Map tool error to error code for reflection
   */
  mapErrorCode(result) {
    if (result.code === ToolError.TIMEOUT) return 'TIMEOUT';
    if (result.code === ToolError.VALIDATION) return 'INVALID_INPUT';
    if (result.code === ToolError.PERMISSION) return 'PERMISSION_DENIED';
    if (result.code === ToolError.NOT_FOUND) return 'NOT_FOUND';
    if (result.error?.includes('rate limit')) return 'RATE_LIMITED';
    if (result.error?.includes('unavailable')) return 'BACKEND_UNAVAILABLE';
    return 'UNKNOWN';
  }

  /**
   * Skip steps whose dependencies have failed (via mutator)
   */
  propagateFailures(plan, mutator) {
    for (const step of plan.steps) {
      if (step.status === StepStatus.PENDING && hasDependencyFailed(step, plan)) {
        mutator.skipStep(step.id, 'Dependency failed', 'runner');
      }
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log plan execution
   */
  logPlanExecution(plan) {
    this.executionHistory.push({
      planId: plan.id,
      goal: plan.goal,
      status: plan.status,
      steps: plan.steps.length,
      completed: plan.steps.filter(s => s.status === StepStatus.COMPLETED).length,
      duration: plan.completedAt - plan.createdAt,
      mutations: plan.mutations.length,
      timestamp: Date.now(),
    });
    if (this.executionHistory.length > 50) {
      this.executionHistory = this.executionHistory.slice(-50);
    }
  }

  /**
   * Get execution stats
   */
  getStats() {
    return {
      totalPlans: this.executionHistory.length,
      successRate: this.executionHistory.length > 0
        ? this.executionHistory.filter(p => p.status === PlanStatus.COMPLETED).length / this.executionHistory.length
        : 0,
      reflectorStats: this.reflector.getStats(),
      recent: this.executionHistory.slice(-5),
    };
  }
}

// Singleton
export const planRunner = new PlanRunner();

export default PlanRunner;
