// CRE v38.0 Planner Types
// ══════════════════════════════════════════════════════════════════════════════
//
// Plan = explicit dependency GRAPH of Steps (not linear sequence)
// Step = single tool call with dependencies + conditions
//
// v38.0 Changes:
//   - Graph structure (edges, not just dependsOn array)
//   - Step conditions (run only if condition met)
//   - Parallel execution support (multiple root steps)
//   - Retry configuration per step
//
// Architectural invariants:
//   ❌ stepResult doesn't change plan directly
//   ❌ No magic in executor
//   ✅ Plan is explicit graph
//   ✅ Changes are mutations (via PlanMutator)
//   ✅ Every mutation is auditable
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// STEP STATUS
// ════════════════════════════════════════════════════════════════════════════

export const StepStatus = {
  PENDING: 'pending',
  READY: 'ready',         // v38: dependencies met, ready to run
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',     // Skipped due to dependency failure or condition
  GATED: 'gated',         // Waiting for human confirmation
  RETRYING: 'retrying',   // v38: retry in progress
};

// ════════════════════════════════════════════════════════════════════════════
// PLAN STATUS
// ════════════════════════════════════════════════════════════════════════════

export const PlanStatus = {
  CREATED: 'created',
  RUNNING: 'running',
  PAUSED: 'paused',       // v38: paused for reflection / user input
  COMPLETED: 'completed',
  FAILED: 'failed',
  GATED: 'gated',
};

// ════════════════════════════════════════════════════════════════════════════
// CONDITION TYPES (v38.0)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Condition types for step execution
 * Conditions are evaluated BEFORE a step runs
 */
export const ConditionType = {
  ALWAYS: 'always',                 // Always run (default)
  IF_PREVIOUS_SUCCESS: 'if_success', // Run only if specific step(s) succeeded
  IF_PREVIOUS_FAILED: 'if_failed',   // Run only if specific step(s) failed (for fallback)
  IF_RESULT_MATCHES: 'if_matches',   // Run if previous result matches criteria
  CUSTOM: 'custom',                  // Custom predicate function
};

/**
 * Create a step condition
 *
 * @param {string} type - ConditionType
 * @param {Object} [config] - Condition-specific config
 * @returns {StepCondition}
 */
export function createCondition(type, config = {}) {
  return {
    type,
    stepIds: config.stepIds || [],       // Which steps to check
    criteria: config.criteria || null,   // For IF_RESULT_MATCHES
    predicate: config.predicate || null, // For CUSTOM
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RETRY CONFIG (v38.0)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 0,          // 0 = no retry
  retryDelay: 1000,       // ms between retries
  retryOn: ['TIMEOUT', 'BACKEND_UNAVAILABLE'], // Error codes to retry
  backoffMultiplier: 2,   // Exponential backoff
};

/**
 * Create retry config
 */
export function createRetryConfig(overrides = {}) {
  return { ...DEFAULT_RETRY_CONFIG, ...overrides };
}

// ════════════════════════════════════════════════════════════════════════════
// STEP (v38.0)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a plan step (v38 — graph node)
 *
 * @param {Object} opts
 * @param {string} opts.id - Unique step ID
 * @param {string} opts.tool - Tool name (from ToolName)
 * @param {Object} opts.params - Tool parameters
 * @param {string[]} [opts.dependsOn] - IDs of steps this depends on (edges)
 * @param {StepCondition} [opts.condition] - When to run this step
 * @param {string} [opts.label] - Human-readable label
 * @param {Function} [opts.mapInput] - Transform previous step results into params
 * @param {RetryConfig} [opts.retry] - Retry configuration
 * @param {string} [opts.fallbackStep] - Step ID to run if this fails
 * @returns {Step}
 */
export function createStep(opts) {
  return {
    // Identity
    id: opts.id,
    tool: opts.tool,
    label: opts.label || opts.tool,

    // Parameters
    params: opts.params || {},
    mapInput: opts.mapInput || null,

    // Graph: dependencies (incoming edges)
    dependsOn: opts.dependsOn || [],

    // Condition: when to execute (v38.0)
    condition: opts.condition || createCondition(ConditionType.ALWAYS),

    // Retry configuration (v38.0)
    retry: opts.retry || createRetryConfig(),

    // Fallback: step to run if this fails (v38.0)
    fallbackStep: opts.fallbackStep || null,

    // Runtime state
    status: StepStatus.PENDING,
    result: null,
    error: null,
    errorCode: null,          // v38: specific error code for reflection
    attempts: 0,              // v38: retry counter
    startedAt: null,
    completedAt: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PLAN GRAPH (v38.0)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a plan (v38 — explicit graph)
 *
 * @param {Object} opts
 * @param {string} opts.goal - What this plan achieves
 * @param {Step[]} opts.steps - List of steps (graph nodes)
 * @param {string} [opts.id] - Plan ID
 * @returns {Plan}
 */
export function createPlan(opts) {
  const id = opts.id || `plan_${Date.now()}`;
  const steps = opts.steps || [];

  // Build adjacency info
  const graph = buildGraph(steps);

  return {
    id,
    goal: opts.goal,
    steps,

    // Graph metadata (v38.0)
    graph: {
      nodeCount: steps.length,
      edgeCount: graph.edgeCount,
      roots: graph.roots,           // Steps with no dependencies
      leaves: graph.leaves,         // Steps with no dependents
      hasCycles: graph.hasCycles,   // Validation: cycles = invalid
    },

    // Runtime state
    status: PlanStatus.CREATED,
    createdAt: Date.now(),
    completedAt: null,
    results: {},                    // stepId → result

    // Mutation log (v38.1)
    mutations: [],                  // Auditable change log
  };
}

/**
 * Build graph metadata from steps
 */
function buildGraph(steps) {
  const nodeIds = new Set(steps.map(s => s.id));
  const dependents = new Map(); // stepId → [steps that depend on it]
  let edgeCount = 0;

  for (const step of steps) {
    for (const depId of step.dependsOn) {
      edgeCount++;
      if (!dependents.has(depId)) {
        dependents.set(depId, []);
      }
      dependents.get(depId).push(step.id);
    }
  }

  const roots = steps.filter(s => s.dependsOn.length === 0).map(s => s.id);
  const leaves = steps.filter(s => !dependents.has(s.id) || dependents.get(s.id).length === 0).map(s => s.id);

  // Simple cycle detection (DFS)
  const hasCycles = detectCycles(steps);

  return { edgeCount, roots, leaves, hasCycles };
}

/**
 * Detect cycles in step graph using DFS
 */
function detectCycles(steps) {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const visited = new Set();
  const inStack = new Set();

  function dfs(stepId) {
    if (inStack.has(stepId)) return true; // Cycle!
    if (visited.has(stepId)) return false;

    visited.add(stepId);
    inStack.add(stepId);

    const step = stepMap.get(stepId);
    if (step) {
      for (const depId of step.dependsOn) {
        if (dfs(depId)) return true;
      }
    }

    inStack.delete(stepId);
    return false;
  }

  for (const step of steps) {
    if (dfs(step.id)) return true;
  }

  return false;
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
 * Evaluate step condition (v38.0)
 *
 * @param {Step} step
 * @param {Plan} plan
 * @returns {boolean} Whether step should run
 */
export function evaluateCondition(step, plan) {
  const cond = step.condition;
  if (!cond || cond.type === ConditionType.ALWAYS) {
    return true;
  }

  switch (cond.type) {
    case ConditionType.IF_PREVIOUS_SUCCESS:
      return cond.stepIds.every(id => {
        const s = plan.steps.find(x => x.id === id);
        return s && s.status === StepStatus.COMPLETED;
      });

    case ConditionType.IF_PREVIOUS_FAILED:
      return cond.stepIds.some(id => {
        const s = plan.steps.find(x => x.id === id);
        return s && s.status === StepStatus.FAILED;
      });

    case ConditionType.IF_RESULT_MATCHES:
      if (!cond.criteria || cond.stepIds.length === 0) return true;
      const depId = cond.stepIds[0];
      const result = plan.results[depId];
      if (!result) return false;
      return matchesCriteria(result, cond.criteria);

    case ConditionType.CUSTOM:
      if (typeof cond.predicate !== 'function') return true;
      try {
        return cond.predicate(step, plan);
      } catch {
        return false;
      }

    default:
      return true;
  }
}

/**
 * Check if result matches criteria (simple JSON path matching)
 */
function matchesCriteria(result, criteria) {
  if (typeof criteria === 'function') {
    return criteria(result);
  }
  if (typeof criteria === 'object') {
    for (const [key, expected] of Object.entries(criteria)) {
      if (result[key] !== expected) return false;
    }
    return true;
  }
  return result === criteria;
}

/**
 * Get next runnable steps (v38.0 — supports parallel)
 *
 * Returns ALL steps that:
 * - Are PENDING or READY
 * - Have dependencies met
 * - Pass condition evaluation
 */
export function getNextSteps(plan) {
  return plan.steps.filter(s =>
    (s.status === StepStatus.PENDING || s.status === StepStatus.READY) &&
    areDependenciesMet(s, plan) &&
    evaluateCondition(s, plan)
  );
}

/**
 * Get parallel-runnable steps (all ready at same level)
 */
export function getParallelSteps(plan) {
  const next = getNextSteps(plan);
  // All steps with no mutual dependencies can run in parallel
  return next.filter(step =>
    !next.some(other => other.id !== step.id && step.dependsOn.includes(other.id))
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

/**
 * Check if step should retry (v38.0)
 */
export function shouldRetry(step) {
  if (!step.retry || step.retry.maxRetries === 0) return false;
  if (step.attempts >= step.retry.maxRetries) return false;
  if (!step.errorCode) return false;
  return step.retry.retryOn.includes(step.errorCode);
}

/**
 * Calculate retry delay (with exponential backoff)
 */
export function getRetryDelay(step) {
  if (!step.retry) return 0;
  const base = step.retry.retryDelay;
  const multiplier = Math.pow(step.retry.backoffMultiplier, step.attempts);
  return base * multiplier;
}

/**
 * Validate plan graph (v38.0)
 */
export function validatePlan(plan) {
  const errors = [];

  if (!plan.goal) errors.push('Plan missing goal');
  if (!plan.steps || plan.steps.length === 0) errors.push('Plan has no steps');

  if (plan.graph.hasCycles) {
    errors.push('Plan graph has cycles — invalid dependency structure');
  }

  // Check for orphan dependencies
  const stepIds = new Set(plan.steps.map(s => s.id));
  for (const step of plan.steps) {
    for (const depId of step.dependsOn) {
      if (!stepIds.has(depId)) {
        errors.push(`Step ${step.id} depends on non-existent step ${depId}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  // Enums
  StepStatus,
  PlanStatus,
  ConditionType,
  DEFAULT_RETRY_CONFIG,

  // Factories
  createStep,
  createPlan,
  createCondition,
  createRetryConfig,

  // Graph helpers
  areDependenciesMet,
  hasDependencyFailed,
  evaluateCondition,
  getNextSteps,
  getParallelSteps,
  isPlanComplete,
  shouldRetry,
  getRetryDelay,
  validatePlan,
};
