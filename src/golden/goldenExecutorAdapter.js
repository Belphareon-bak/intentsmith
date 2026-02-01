// Golden Path — Executor Adapter
// ══════════════════════════════════════════════════════════════════════════════
//
// Simplified executor for Golden Path pipeline.
// Wraps the existing ToolExecutor with contract validation.
//
// This is NOT an executor rewrite — it's an adapter that:
//   1. Takes validated PlannerOutput
//   2. Executes each step sequentially (no parallelism in Golden Path)
//   3. Validates each tool-call against contract
//   4. Returns ExecutionResult conforming to contract
//
// Contract: src/contracts/execution-result.schema.json
//
// ══════════════════════════════════════════════════════════════════════════════

import { toolExecutor } from '../tools/executor.js';
import { validate, ValidationError } from '../contracts/validate.js';

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION RESULT CONTRACT (inline for Golden Path clarity)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} StepResult
 * @property {string} step_id - Step that was executed
 * @property {string} status - 'completed' | 'failed' | 'skipped'
 * @property {any} [data] - Result data if successful
 * @property {string} [error] - Error message if failed
 * @property {number} duration_ms - Execution time in milliseconds
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {string} plan_id - Plan that was executed
 * @property {string} status - 'completed' | 'partial' | 'failed'
 * @property {StepResult[]} step_results - Results for each step
 * @property {number} total_duration_ms - Total execution time
 */

// ════════════════════════════════════════════════════════════════════════════
// EXECUTOR ADAPTER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Execute a validated PlannerOutput
 *
 * Golden Path execution:
 *   - Sequential step execution (no parallelism)
 *   - Stop on first failure (no retry in Golden Path)
 *   - Validate each tool-call against contract
 *
 * @param {import('./goldenPlannerAdapter.js').PlannerOutput} plannerOutput - Validated planner output
 * @param {Object} [context] - Execution context (API keys, etc.)
 * @returns {Promise<ExecutionResult>}
 */
export async function executeGoldenPath(plannerOutput, context = {}) {
  const startTime = Date.now();
  const stepResults = [];

  for (const step of plannerOutput.steps) {
    const stepResult = await executeStep(step, context);
    stepResults.push(stepResult);

    // Golden Path: stop on first failure
    if (stepResult.status === 'failed') {
      break;
    }
  }

  const result = {
    plan_id: plannerOutput.plan_id,
    status: determineOverallStatus(stepResults),
    step_results: stepResults,
    total_duration_ms: Date.now() - startTime,
  };

  // Validate result against contract
  const validation = validate('execution-result', result);
  if (!validation.valid) {
    throw new ValidationError('EXECUTOR_ADAPTER', `Result validation failed: ${validation.errors.join(', ')}`);
  }

  return result;
}

/**
 * Execute a single step
 *
 * @param {import('./goldenPlannerAdapter.js').PlannerStep} step
 * @param {Object} context
 * @returns {Promise<StepResult>}
 */
async function executeStep(step, context) {
  const startTime = Date.now();

  // Validate tool-call against contract before execution
  const toolCallValidation = validate('tool-call', {
    tool: step.tool,
    args: step.args,
  });

  if (!toolCallValidation.valid) {
    return {
      step_id: step.step_id,
      status: 'failed',
      error: `Invalid tool-call: ${toolCallValidation.errors.join(', ')}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // Execute via existing ToolExecutor
  const decision = {
    type: 'TOOL_CALL',
    tool: step.tool,
    params: step.args,
  };

  try {
    const result = await toolExecutor.execute(decision, {
      ...context,
      skipGate: false, // Golden Path respects gates
    });

    if (result.ok) {
      return {
        step_id: step.step_id,
        status: 'completed',
        data: result.data,
        duration_ms: result.duration,
      };
    } else {
      return {
        step_id: step.step_id,
        status: 'failed',
        error: result.error || 'Unknown error',
        duration_ms: result.duration,
      };
    }
  } catch (err) {
    return {
      step_id: step.step_id,
      status: 'failed',
      error: err.message,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Determine overall execution status from step results
 */
function determineOverallStatus(stepResults) {
  if (stepResults.length === 0) {
    return 'completed';
  }

  const failedCount = stepResults.filter(r => r.status === 'failed').length;
  const completedCount = stepResults.filter(r => r.status === 'completed').length;

  if (failedCount === 0) {
    return 'completed';
  }

  if (completedCount > 0) {
    return 'partial';
  }

  return 'failed';
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  executeGoldenPath,
};
