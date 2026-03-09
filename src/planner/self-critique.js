// Self-Critique v108 (F6) — LLM Root Cause Analysis + Signature-First Patching
// ══════════════════════════════════════════════════════════════════════════════
//
// Two-phase approach to fix generation:
//   Phase 1 (analyzeCause): LLM reasons about WHY the error occurred
//   Phase 2 (generatePatchPlan): LLM produces a signature-level fix plan
//
// Plan validation: Checks plan steps against KG/symbol index to catch
// hallucinated symbols before implementation.
//
// Activation: iteration >= 2 only (first iteration uses fast deterministic path)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { formatErrorsForLLM } from './error-normalizer.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_CRITIQUE_ITERATION = 2;       // Only activate after 1st iteration fails
const MAX_PLAN_STEPS = 10;              // Reject overly ambitious plans
const PLAN_ACTION_TYPES = new Set(['ADD', 'MODIFY', 'DELETE', 'MOVE']);

// ─── shouldActivate ─────────────────────────────────────────────────────────

/**
 * Whether self-critique should run for this iteration.
 *
 * @param {number} iteration - Current iteration (1-based)
 * @param {Array} errors - Current NormalizedError[]
 * @returns {boolean}
 */
export function shouldActivate(iteration, errors) {
  if (iteration < MIN_CRITIQUE_ITERATION) return false;
  if (!errors || errors.length === 0) return false;
  return true;
}

// ─── analyzeCause ───────────────────────────────────────────────────────────

/**
 * Ask LLM to reason about the root cause of persistent errors.
 *
 * @param {Array} errors - NormalizedError[] (filtered, from frontier)
 * @param {string} signatureContext - Formatted signature map of relevant files
 * @param {Object} iterationMemory - Loop state with patchesApplied, errorHistory
 * @param {Function} callLLM - (role, prompt) => {content}
 * @returns {Promise<{rootCause: string, reasoning: string}>}
 */
export async function analyzeCause(errors, signatureContext, iterationMemory, callLLM) {
  const formattedErrors = formatErrorsForLLM(errors);
  const prevErrorCount = iterationMemory.errorHistory.length > 1
    ? iterationMemory.errorHistory[iterationMemory.errorHistory.length - 2].length
    : 0;

  const prompt = `You are diagnosing persistent errors that were NOT fixed in the previous attempt.

## Current Errors
${formattedErrors}

## Error Trend
Previous iteration: ${prevErrorCount} error(s) → Current: ${errors.length} error(s)

## Available API Signatures
${signatureContext || 'No signature context available.'}

## Previous Patches Applied (last 2)
${formatPreviousPatches(iterationMemory)}

## Task
Analyze the ROOT CAUSE of these errors. Consider:
1. Are the errors caused by a missing import, wrong API usage, or logic error?
2. Did a previous patch introduce new errors (regression)?
3. Are there cascading failures from a single root cause?

Respond in EXACTLY this format:
ROOT_CAUSE: <one sentence describing the fundamental issue>
REASONING: <2-3 sentences explaining your analysis>`;

  try {
    const result = await callLLM('CODE', prompt);
    return parseCauseResponse(result?.content || '');
  } catch (err) {
    logger.warn('SelfCritique', `analyzeCause failed: ${err.message}`);
    return { rootCause: '', reasoning: '' };
  }
}

// ─── generatePatchPlan ──────────────────────────────────────────────────────

/**
 * Generate a signature-level patch plan before implementation.
 *
 * @param {Array} errors - NormalizedError[]
 * @param {Object} causeAnalysis - From analyzeCause
 * @param {string} signatureContext - Formatted signature map
 * @param {Function} callLLM - (role, prompt) => {content}
 * @returns {Promise<{steps: Array<{action, file, symbol, reason}>, raw: string}>}
 */
export async function generatePatchPlan(errors, causeAnalysis, signatureContext, callLLM) {
  const formattedErrors = formatErrorsForLLM(errors);

  const prompt = `You are creating a PATCH PLAN at the API/signature level.

## Root Cause
${causeAnalysis.rootCause || 'Unknown — analyze from errors below.'}
${causeAnalysis.reasoning ? `\nReasoning: ${causeAnalysis.reasoning}` : ''}

## Current Errors
${formattedErrors}

## Available API Signatures
${signatureContext || 'No signature context available.'}

## Task
Create a concise fix plan. For each change, specify:
- ACTION: ADD | MODIFY | DELETE | MOVE
- FILE: which file to change
- SYMBOL: which function/class/variable
- REASON: why this change fixes the error

Respond with one step per line in this format:
ACTION FILE SYMBOL REASON

Example:
MODIFY src/service.js processOrder add null check for orderId parameter
ADD src/service.js validateOrder new validation function for order data
DELETE src/legacy.js oldHandler remove deprecated handler causing conflict

Maximum ${MAX_PLAN_STEPS} steps. Focus on ROOT CAUSE fixes first.`;

  try {
    const result = await callLLM('CODE', prompt);
    return parsePlanResponse(result?.content || '');
  } catch (err) {
    logger.warn('SelfCritique', `generatePatchPlan failed: ${err.message}`);
    return { steps: [], raw: '' };
  }
}

// ─── validatePlan ───────────────────────────────────────────────────────────

/**
 * Validate patch plan against KG and symbol index.
 * Catches hallucinated symbols before implementation.
 *
 * @param {Array} planSteps - [{action, file, symbol, reason}]
 * @param {Object} opts - {symbolIndex?, graph?, fileNodeId?}
 * @returns {{valid: boolean, issues: string[], validSteps: Array}}
 */
export function validatePlan(planSteps, opts = {}) {
  if (!planSteps || planSteps.length === 0) {
    return { valid: false, issues: ['Empty plan'], validSteps: [] };
  }
  if (planSteps.length > MAX_PLAN_STEPS) {
    return { valid: false, issues: [`Plan too large: ${planSteps.length} steps (max ${MAX_PLAN_STEPS})`], validSteps: [] };
  }

  const { symbolIndex, graph, fileNodeId } = opts;
  const issues = [];
  const validSteps = [];

  for (const step of planSteps) {
    // Validate action type
    if (!PLAN_ACTION_TYPES.has(step.action)) {
      issues.push(`Invalid action "${step.action}" for ${step.file}:${step.symbol}`);
      continue;
    }

    // MODIFY/DELETE: symbol should exist
    if ((step.action === 'MODIFY' || step.action === 'DELETE') && symbolIndex && step.symbol) {
      const found = symbolIndex.findSymbol(step.symbol);
      if (!found || found.length === 0) {
        issues.push(`Symbol "${step.symbol}" not found in index (${step.action} ${step.file})`);
        // Still include — might be a minor naming mismatch
      }
    }

    // ADD/MODIFY: file should exist in graph (unless ADD creates new file)
    if (step.action !== 'ADD' && graph && fileNodeId && step.file) {
      const node = graph.getNode(fileNodeId(step.file));
      if (!node) {
        issues.push(`File "${step.file}" not in knowledge graph (${step.action})`);
      }
    }

    validSteps.push(step);
  }

  return {
    valid: issues.length === 0,
    issues,
    validSteps,
  };
}

// ─── formatCritiqueForPrompt ────────────────────────────────────────────────

/**
 * Format self-critique results for injection into buildFixPrompt.
 *
 * @param {Object} causeAnalysis - {rootCause, reasoning}
 * @param {Object} patchPlan - {steps, raw}
 * @param {Object} validation - {valid, issues}
 * @returns {string}
 */
export function formatCritiqueForPrompt(causeAnalysis, patchPlan, validation) {
  const parts = [];

  if (causeAnalysis.rootCause) {
    parts.push(`Root cause: ${causeAnalysis.rootCause}`);
    if (causeAnalysis.reasoning) {
      parts.push(`Analysis: ${causeAnalysis.reasoning}`);
    }
  }

  if (patchPlan.steps.length > 0) {
    parts.push('');
    parts.push('Patch plan:');
    for (const step of patchPlan.steps) {
      parts.push(`  ${step.action} ${step.file} ${step.symbol} — ${step.reason}`);
    }
  }

  if (validation.issues.length > 0) {
    parts.push('');
    parts.push('Validation warnings:');
    for (const issue of validation.issues) {
      parts.push(`  ⚠ ${issue}`);
    }
  }

  return parts.join('\n');
}

// ─── Parsers ────────────────────────────────────────────────────────────────

function parseCauseResponse(raw) {
  const rootCauseMatch = raw.match(/ROOT_CAUSE:\s*(.+)/i);
  const reasoningMatch = raw.match(/REASONING:\s*(.+(?:\n(?!ROOT_CAUSE:|[A-Z]+:).+)*)/i);

  return {
    rootCause: rootCauseMatch ? rootCauseMatch[1].trim() : '',
    reasoning: reasoningMatch ? reasoningMatch[1].trim().replace(/\n/g, ' ') : '',
  };
}

function parsePlanResponse(raw) {
  const steps = [];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Match: ACTION FILE SYMBOL REASON
    // e.g. "MODIFY src/service.js processOrder add null check"
    const match = line.match(/^(ADD|MODIFY|DELETE|MOVE)\s+(\S+)\s+(\S+)\s+(.+)$/i);
    if (match) {
      steps.push({
        action: match[1].toUpperCase(),
        file: match[2],
        symbol: match[3],
        reason: match[4].trim(),
      });
    }
  }

  return { steps: steps.slice(0, MAX_PLAN_STEPS), raw };
}

function formatPreviousPatches(iterationMemory) {
  const recent = (iterationMemory.patchesApplied || []).slice(-2);
  if (recent.length === 0) return 'None';
  return recent.map(p => {
    const files = p.file || (p.regions || []).map(r => r.file || '').join(', ');
    const regions = (p.regions || []).length;
    return `- ${files} (${regions} region(s))`;
  }).join('\n');
}
