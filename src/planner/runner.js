// CRE v37.0 Plan Runner
// ══════════════════════════════════════════════════════════════════════════════
//
// Executes a Plan step by step, respecting dependencies and gates.
//
// Flow:
//   CREDecision(PLAN) → PlanRunner.run(plan) → { status, results, gatedStep? }
//
// Features:
// - Sequential execution with dependency graph
// - mapInput: transform previous step results into next step params
// - Gate handling: pauses plan, returns GATED status
// - Failure propagation: skip steps whose dependencies failed
// - Per-step timeout
//
// ══════════════════════════════════════════════════════════════════════════════

import { toolExecutor, ToolError } from '../tools/executor.js';
import { humanGate } from '../gates/human-gate.js';
import {
  StepStatus, PlanStatus,
  areDependenciesMet, hasDependencyFailed, getNextSteps, isPlanComplete
} from './types.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// PLAN RUNNER
// ════════════════════════════════════════════════════════════════════════════

export class PlanRunner {
  constructor(options = {}) {
    this.defaultStepTimeout = options.stepTimeout || 30000;
    this.maxSteps = options.maxSteps || 20; // Safety: max steps per plan
    this.executionHistory = [];
  }

  /**
   * Run a plan to completion (or until gated/failed)
   *
   * @param {Plan} plan
   * @param {Object} [context] - Shared context (API keys, etc.)
   * @returns {Promise<{ status: string, plan: Plan, gatedStep?: Step, error?: string }>}
   */
  async run(plan, context = {}) {
    plan.status = PlanStatus.RUNNING;
    logger.debug('PlanRunner', `Running plan: ${plan.goal}`, { steps: plan.steps.length });

    // Set goal for HumanGate scope
    humanGate.setGoal(plan.id);

    let stepsExecuted = 0;

    while (!isPlanComplete(plan) && stepsExecuted < this.maxSteps) {
      // Mark failed dependencies as SKIPPED
      this.propagateFailures(plan);

      // Get next executable steps
      const nextSteps = getNextSteps(plan);

      if (nextSteps.length === 0) {
        // No more runnable steps — either all done, or deadlocked
        if (!isPlanComplete(plan)) {
          plan.status = PlanStatus.FAILED;
          return { status: PlanStatus.FAILED, plan, error: 'Deadlock: no runnable steps' };
        }
        break;
      }

      // Execute next step (sequential for now — parallel later)
      const step = nextSteps[0];
      const result = await this.executeStep(step, plan, context);

      stepsExecuted++;

      // Handle GATED — pause plan
      if (step.status === StepStatus.GATED) {
        plan.status = PlanStatus.GATED;
        return { status: PlanStatus.GATED, plan, gatedStep: step };
      }

      // Handle FAILED — continue (dependent steps will be skipped)
      if (step.status === StepStatus.FAILED) {
        logger.warn('PlanRunner', `Step failed: ${step.id}`, { error: step.error });
      }
    }

    // Determine final status
    const hasFailures = plan.steps.some(s => s.status === StepStatus.FAILED);
    plan.status = hasFailures ? PlanStatus.FAILED : PlanStatus.COMPLETED;
    plan.completedAt = Date.now();

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

    // Reset the gated step to PENDING
    const gatedStep = plan.steps.find(s => s.status === StepStatus.GATED);
    if (gatedStep) {
      gatedStep.status = StepStatus.PENDING;
    }

    // Continue execution
    return this.run(plan, context);
  }

  /**
   * Execute a single step
   */
  async executeStep(step, plan, context) {
    step.status = StepStatus.RUNNING;
    step.startedAt = Date.now();

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
        step.status = StepStatus.FAILED;
        step.error = `mapInput error: ${err.message}`;
        step.completedAt = Date.now();
        return;
      }
    }

    // Execute via ToolExecutor
    const decision = { type: 'TOOL_CALL', tool: step.tool, params };
    const result = await toolExecutor.execute(decision, {
      ...context,
      timeout: context.stepTimeout || this.defaultStepTimeout,
    });

    step.completedAt = Date.now();

    if (result.code === ToolError.GATED) {
      step.status = StepStatus.GATED;
      step.error = result.error;
      return;
    }

    if (!result.ok) {
      step.status = StepStatus.FAILED;
      step.error = result.error;
      step.result = result;
      return;
    }

    // Success
    step.status = StepStatus.COMPLETED;
    step.result = result.data;
    plan.results[step.id] = result.data;
  }

  /**
   * Skip steps whose dependencies have failed
   */
  propagateFailures(plan) {
    for (const step of plan.steps) {
      if (step.status === StepStatus.PENDING && hasDependencyFailed(step, plan)) {
        step.status = StepStatus.SKIPPED;
        step.error = 'Dependency failed';
        step.completedAt = Date.now();
      }
    }
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
      recent: this.executionHistory.slice(-5),
    };
  }
}

// Singleton
export const planRunner = new PlanRunner();

export default PlanRunner;
