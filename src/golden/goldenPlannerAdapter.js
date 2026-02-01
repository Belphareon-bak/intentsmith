// Golden Path — Planner Adapter
// ══════════════════════════════════════════════════════════════════════════════
//
// Maps raw LLM output into strict Planner Output Contract.
//
// This is NOT a planner rewrite — it's an adapter that:
//   1. Takes raw LLM response
//   2. Validates/transforms to contract schema
//   3. Returns valid PlannerOutput or throws
//
// Contract: src/contracts/planner-output.schema.json
//
// ══════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { extractJSON } from '../llm/client.js';
import { validate, ValidationError } from '../contracts/validate.js';

// ════════════════════════════════════════════════════════════════════════════
// PLANNER OUTPUT CONTRACT (inline for Golden Path clarity)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} PlannerStep
 * @property {string} step_id - Unique step identifier
 * @property {string} action - Human-readable action description
 * @property {string} tool - Tool name (from ToolRegistry)
 * @property {Object} args - Tool arguments
 */

/**
 * @typedef {Object} PlannerOutput
 * @property {string} plan_id - UUID
 * @property {string} goal - What this plan achieves
 * @property {PlannerStep[]} steps - Ordered list of steps
 * @property {boolean} requires_approval - Whether human approval needed
 * @property {number} confidence - 0-1 confidence score
 */

// ════════════════════════════════════════════════════════════════════════════
// ADAPTER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Adapt raw LLM response to PlannerOutput contract
 *
 * @param {string} rawLLMResponse - Raw text from LLM
 * @param {string} originalGoal - The goal that was sent to planner
 * @returns {PlannerOutput} Validated planner output
 * @throws {ValidationError} If output cannot be mapped to contract
 */
export function adaptPlannerOutput(rawLLMResponse, originalGoal) {
  // Step 1: Extract JSON from response
  const parsed = extractJSON(rawLLMResponse);

  if (!parsed) {
    throw new ValidationError('PLANNER_ADAPTER', 'Failed to extract JSON from LLM response');
  }

  // Step 2: Map to contract structure
  const output = mapToContract(parsed, originalGoal);

  // Step 3: Validate against schema
  const validation = validate('planner-output', output);

  if (!validation.valid) {
    throw new ValidationError('PLANNER_ADAPTER', `Contract validation failed: ${validation.errors.join(', ')}`);
  }

  return output;
}

/**
 * Map parsed JSON to PlannerOutput contract
 * Handles various LLM response formats
 */
function mapToContract(parsed, originalGoal) {
  // Generate plan_id if missing
  const plan_id = parsed.plan_id || parsed.id || randomUUID();

  // Extract goal - fallback to original
  const goal = parsed.goal || parsed.objective || originalGoal;

  // Map steps - handle various formats
  const rawSteps = parsed.steps || parsed.plan || parsed.actions || [];
  const steps = rawSteps.map((step, index) => mapStep(step, index));

  // Extract requires_approval - default true for safety
  const requires_approval = parsed.requires_approval ?? parsed.needsApproval ?? true;

  // Extract confidence - default 0.5 if unknown
  const confidence = normalizeConfidence(parsed.confidence ?? parsed.certainty ?? 0.5);

  return {
    plan_id,
    goal,
    steps,
    requires_approval,
    confidence,
  };
}

/**
 * Map a single step to contract format
 */
function mapStep(step, index) {
  // Handle string steps (simple format)
  if (typeof step === 'string') {
    return {
      step_id: `step_${index + 1}`,
      action: step,
      tool: 'unknown',
      args: {},
    };
  }

  return {
    step_id: step.step_id || step.id || `step_${index + 1}`,
    action: step.action || step.description || step.name || `Step ${index + 1}`,
    tool: step.tool || step.toolName || 'unknown',
    args: step.args || step.params || step.parameters || {},
  };
}

/**
 * Normalize confidence to 0-1 range
 */
function normalizeConfidence(value) {
  if (typeof value !== 'number') {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 0.5;
    value = parsed;
  }

  // Handle percentage (0-100)
  if (value > 1 && value <= 100) {
    value = value / 100;
  }

  // Clamp to 0-1
  return Math.max(0, Math.min(1, value));
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  adaptPlannerOutput,
};
