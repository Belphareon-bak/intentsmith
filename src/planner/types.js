// CRE v37.0 Planner Types
// ══════════════════════════════════════════════════════════════════════════════
//
// Plan = sequence/graph of Steps
// Step = single tool call with dependencies
//
// CRE returns PLAN instead of TOOL_CALL.
// PlanRunner executes steps respecting order and dependencies.
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// STEP STATUS
// ════════════════════════════════════════════════════════════════════════════

export const StepStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped', // Skipped due to dependency failure
  GATED: 'gated',     // Waiting for human confirmation
};

// ════════════════════════════════════════════════════════════════════════════
// PLAN STATUS
// ════════════════════════════════════════════════════════════════════════════

export const PlanStatus = {
  CREATED: 'created',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  GATED: 'gated', // Blocked on human gate
};

// ════════════════════════════════════════════════════════════════════════════
// STEP
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a plan step
 *
 * @param {Object} opts
 * @param {string} opts.id - Unique step ID
 * @param {string} opts.tool - Tool name (from ToolName)
 * @param {Object} opts.params - Tool parameters
 * @param {string[]} [opts.dependsOn] - IDs of steps this depends on
 * @param {string} [opts.label] - Human-readable label
 * @param {Function} [opts.mapInput] - Transform previous step results into params
 * @returns {Step}
 */
export function createStep(opts) {
  return {
    id: opts.id,
    tool: opts.tool,
    params: opts.params || {},
    dependsOn: opts.dependsOn || [],
    label: opts.label || opts.tool,
    mapInput: opts.mapInput || null,
    status: StepStatus.PENDING,
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PLAN
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a plan
 *
 * @param {Object} opts
 * @param {string} opts.goal - What this plan achieves
 * @param {Step[]} opts.steps - Ordered list of steps
 * @param {string} [opts.id] - Plan ID
 * @returns {Plan}
 */
export function createPlan(opts) {
  const id = opts.id || `plan_${Date.now()}`;
  return {
    id,
    goal: opts.goal,
    steps: opts.steps || [],
    status: PlanStatus.CREATED,
    createdAt: Date.now(),
    completedAt: null,
    results: {}, // stepId → result
  };
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check if all dependencies of a step are completed
 */
export function areDependenciesMet(step, plan) {
  if (step.dependsOn.length === 0) return true;
  return step.dependsOn.every(depId => {
    const depStep = plan.steps.find(s => s.id === depId);
    return depStep && depStep.status === StepStatus.COMPLETED;
  });
}

/**
 * Check if any dependency has failed (step should be skipped)
 */
export function hasDependencyFailed(step, plan) {
  return step.dependsOn.some(depId => {
    const depStep = plan.steps.find(s => s.id === depId);
    return depStep && (depStep.status === StepStatus.FAILED || depStep.status === StepStatus.SKIPPED);
  });
}

/**
 * Get next runnable steps (dependencies met, still pending)
 */
export function getNextSteps(plan) {
  return plan.steps.filter(s =>
    s.status === StepStatus.PENDING && areDependenciesMet(s, plan)
  );
}

/**
 * Check if plan is complete (all steps done or skipped)
 */
export function isPlanComplete(plan) {
  return plan.steps.every(s =>
    s.status === StepStatus.COMPLETED ||
    s.status === StepStatus.FAILED ||
    s.status === StepStatus.SKIPPED
  );
}

export default {
  StepStatus, PlanStatus, createStep, createPlan,
  areDependenciesMet, hasDependencyFailed, getNextSteps, isPlanComplete,
};
