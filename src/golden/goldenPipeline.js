// Golden Path — Reference Pipeline
// ══════════════════════════════════════════════════════════════════════════════
//
// THE ONLY OFFICIALLY SUPPORTED PATH
//
// This file defines the minimal, readable, deterministic agent pipeline.
// One file. One flow. No magic.
//
// Flow:
//   User Input
//   → Chat Intent Classification
//   → Planner (STRICT OUTPUT)
//   → Schema Validation
//   → Approval Gate (auto-approve)
//   → Executor
//   → Artifact Result
//
// What this path DOES NOT include (by design):
//   ❌ Autonomous loop
//   ❌ Memory writes
//   ❌ Tool chaining
//   ❌ Retries
//   ❌ Self-correction
//
// This is the "Hello World" of the architecture — not a feature.
//
// ══════════════════════════════════════════════════════════════════════════════

import { llmGateway } from '../llm/gateway.js';
import { adaptPlannerOutput } from './goldenPlannerAdapter.js';
import { executeGoldenPath } from './goldenExecutorAdapter.js';
import { validate, ValidationError } from '../contracts/validate.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// GOLDEN PATH PIPELINE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Run the Golden Path pipeline
 *
 * This is the reference implementation. Every step is explicit.
 * No hidden behavior. No implicit state. No retries.
 *
 * @param {string} userInput - Raw user input
 * @param {Object} [options] - Pipeline options
 * @param {boolean} [options.autoApprove=true] - Auto-approve plan (Golden Path default)
 * @param {Object} [options.context] - Execution context (API keys, etc.)
 * @returns {Promise<GoldenPathResult>}
 */
export async function runGoldenPath(userInput, options = {}) {
  const { autoApprove = true, context = {} } = options;
  const startTime = Date.now();

  logger.info('GoldenPath', `Starting pipeline for: "${userInput.substring(0, 50)}..."`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: Input Validation
  // ──────────────────────────────────────────────────────────────────────────

  if (!userInput || typeof userInput !== 'string' || userInput.trim().length === 0) {
    return createErrorResult('INVALID_INPUT', 'User input must be non-empty string', startTime);
  }

  const trimmedInput = userInput.trim();

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: Call Planner LLM
  // ──────────────────────────────────────────────────────────────────────────

  let rawPlannerResponse;
  try {
    const token = llmGateway.authorize({
      role: 'PLANNER',
      capabilities: ['PLANNING'],
      auditContext: { source: 'GoldenPath', input: trimmedInput.substring(0, 100) },
    });

    rawPlannerResponse = await llmGateway.call(token, {
      prompt: buildPlannerPrompt(trimmedInput),
      systemPrompt: PLANNER_SYSTEM_PROMPT,
    });

    logger.debug('GoldenPath', 'Planner response received', {
      length: rawPlannerResponse?.content?.length,
    });
  } catch (err) {
    return createErrorResult('PLANNER_CALL_FAILED', err.message, startTime);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: Adapt to Contract (with validation)
  // ──────────────────────────────────────────────────────────────────────────

  let plannerOutput;
  try {
    plannerOutput = adaptPlannerOutput(rawPlannerResponse.content, trimmedInput);
    logger.debug('GoldenPath', 'Planner output adapted', {
      plan_id: plannerOutput.plan_id,
      steps: plannerOutput.steps.length,
      confidence: plannerOutput.confidence,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return createErrorResult('PLANNER_OUTPUT_INVALID', err.message, startTime);
    }
    return createErrorResult('ADAPTER_FAILED', err.message, startTime);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4: Approval Gate
  // ──────────────────────────────────────────────────────────────────────────

  if (!autoApprove && plannerOutput.requires_approval) {
    // In Golden Path, we return for manual approval
    return {
      status: 'PENDING_APPROVAL',
      plan: plannerOutput,
      duration_ms: Date.now() - startTime,
    };
  }

  logger.debug('GoldenPath', 'Plan approved (auto)', { plan_id: plannerOutput.plan_id });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 5: Execute Plan
  // ──────────────────────────────────────────────────────────────────────────

  let executionResult;
  try {
    executionResult = await executeGoldenPath(plannerOutput, context);
    logger.debug('GoldenPath', 'Execution completed', {
      status: executionResult.status,
      steps_completed: executionResult.step_results.filter(r => r.status === 'completed').length,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return createErrorResult('EXECUTION_RESULT_INVALID', err.message, startTime);
    }
    return createErrorResult('EXECUTION_FAILED', err.message, startTime);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 6: Return Result
  // ──────────────────────────────────────────────────────────────────────────

  return {
    status: executionResult.status === 'completed' ? 'SUCCESS' : 'PARTIAL',
    plan: plannerOutput,
    execution: executionResult,
    duration_ms: Date.now() - startTime,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PLANNER PROMPTS
// ════════════════════════════════════════════════════════════════════════════

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant. Given a user goal, output a JSON plan.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "goal": "What this plan achieves",
  "steps": [
    {
      "step_id": "step_1",
      "action": "Human-readable action description",
      "tool": "tool.name",
      "args": { "param": "value" }
    }
  ],
  "requires_approval": true,
  "confidence": 0.8
}

AVAILABLE TOOLS:
- web.search: Search the web. Args: { query: string }
- web.fetch: Fetch a URL. Args: { url: string }
- fs.read: Read a file. Args: { path: string }
- fs.write: Write a file. Args: { path: string, content: string }
- data.parse: Parse data. Args: { input: string, format: "json"|"csv" }
- data.filter: Filter data. Args: { data: array, criteria: object }
- memory.store: Store in memory. Args: { key: string, value: any }
- memory.recall: Recall from memory. Args: { key: string }

RULES:
1. Output ONLY valid JSON, no explanation
2. Each step must have step_id, action, tool, args
3. confidence must be 0-1
4. requires_approval should be true for destructive operations`;

function buildPlannerPrompt(userInput) {
  return `Create a plan for the following goal:\n\n${userInput}`;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create error result
 */
function createErrorResult(code, message, startTime) {
  logger.error('GoldenPath', `Pipeline error: ${code}`, { message });
  return {
    status: 'ERROR',
    error: {
      code,
      message,
    },
    duration_ms: Date.now() - startTime,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TYPES (for documentation)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} GoldenPathResult
 * @property {'SUCCESS'|'PARTIAL'|'PENDING_APPROVAL'|'ERROR'} status
 * @property {import('./goldenPlannerAdapter.js').PlannerOutput} [plan]
 * @property {import('./goldenExecutorAdapter.js').ExecutionResult} [execution]
 * @property {{code: string, message: string}} [error]
 * @property {number} duration_ms
 */

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  runGoldenPath,
};
