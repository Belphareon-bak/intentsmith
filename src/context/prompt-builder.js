// Prompt Builder v119 — Unified structured prompt assembly
// ══════════════════════════════════════════════════════════════════════════════
//
// Replaces ad-hoc prompt construction scattered across lifecycle-build.js,
// execution-loop.js, and self-critique.js with a single, priority-weighted,
// budget-managed builder.
//
// Sections are filled top-down by priority. Each has a base weight; adaptive
// multipliers shift budget based on the dominant error type. Audit metadata
// tracks which sections were included, truncated, and their token cost.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Section Definitions ──────────────────────────────────────────────────

/**
 * Ordered section names with base priority weights.
 * Higher priority = filled first when budget is tight.
 */
const SECTION_DEFS = [
  { name: 'ROLE',          priority: 100, baseFraction: 0.02 },
  { name: 'ERRORS',        priority: 95,  baseFraction: 0.12 },
  { name: 'SCOPE',         priority: 90,  baseFraction: 0.04 },
  { name: 'SIGNATURES',    priority: 80,  baseFraction: 0.12 },
  { name: 'IMPORT_MAP',    priority: 78,  baseFraction: 0.08 },
  { name: 'SOURCE',        priority: 70,  baseFraction: 0.25 },
  { name: 'TASK_MEMORY',   priority: 60,  baseFraction: 0.06 },
  { name: 'CALL_GRAPH',    priority: 55,  baseFraction: 0.05 },
  { name: 'CROSS_PROJECT', priority: 50,  baseFraction: 0.04 },
  { name: 'TASK',          priority: 45,  baseFraction: 0.10 },
  { name: 'RULES',         priority: 40,  baseFraction: 0.06 },
  { name: 'OUTPUT_FORMAT', priority: 35,  baseFraction: 0.06 },
];

// ─── Adaptive Multipliers ──────────────────────────────────────────────────

/**
 * Per-error-type multipliers. Sections not listed get 1.0 (neutral).
 * These shift budget toward sections most useful for the current error type.
 */
const ADAPTIVE_WEIGHTS = {
  IMPORT_NOT_FOUND: {
    SIGNATURES:  1.5,
    IMPORT_MAP:  2.0,
    CALL_GRAPH:  0.3,
    TASK_MEMORY: 0.7,
  },
  TYPE_MISMATCH: {
    SOURCE:      1.5,
    SIGNATURES:  1.3,
    TASK_MEMORY: 0.5,
  },
  TEST_FAILED: {
    SOURCE:      1.5,
    TASK_MEMORY: 1.3,
    SIGNATURES:  0.7,
  },
  SYNTAX_ERROR: {
    SOURCE:      2.0,
    SIGNATURES:  0.3,
    IMPORT_MAP:  0.3,
    CALL_GRAPH:  0.2,
    CROSS_PROJECT: 0.2,
    TASK_MEMORY: 0.3,
  },
};

// ─── Token Estimation ──────────────────────────────────────────────────────

/**
 * Rough token estimate (~4 chars per token, matching context-delta.js).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Budget Computation ────────────────────────────────────────────────────

/**
 * Compute per-section token budgets with adaptive weighting.
 *
 * @param {number} maxTokens - Total token budget
 * @param {string} [errorType] - Dominant error code (from ERROR_CODES)
 * @param {string} [strategy] - Fix strategy type (DETERMINISTIC/HEURISTIC/LLM_FULL)
 * @returns {Map<string, { budget: number, priority: number }>}
 */
export function buildSectionBudget(maxTokens, errorType, strategy) {
  const budgets = new Map();
  if (!maxTokens || maxTokens <= 0) {
    for (const def of SECTION_DEFS) {
      budgets.set(def.name, { budget: 0, priority: def.priority });
    }
    return budgets;
  }

  const multipliers = (errorType && ADAPTIVE_WEIGHTS[errorType]) || {};

  // Strategy adjustments: DETERMINISTIC = less context needed
  let strategyScale = 1.0;
  if (strategy === 'DETERMINISTIC') strategyScale = 0.6;
  else if (strategy === 'HEURISTIC') strategyScale = 0.8;

  // Compute weighted fractions
  let totalWeighted = 0;
  const weighted = [];
  for (const def of SECTION_DEFS) {
    const mult = multipliers[def.name] ?? 1.0;
    const w = def.baseFraction * mult * strategyScale;
    weighted.push({ name: def.name, priority: def.priority, weight: w });
    totalWeighted += w;
  }

  // Normalize to fill maxTokens
  const scale = totalWeighted > 0 ? maxTokens / totalWeighted : 0;
  for (const w of weighted) {
    budgets.set(w.name, {
      budget: Math.floor(w.weight * scale),
      priority: w.priority,
    });
  }

  return budgets;
}

// ─── Section Truncation ────────────────────────────────────────────────────

/**
 * Smart truncation: keeps first N complete entries (lines), not arbitrary cut.
 * @param {string} content
 * @param {number} budgetTokens
 * @returns {{ text: string, truncated: boolean, originalTokens: number }}
 */
function truncateSection(content, budgetTokens) {
  const originalTokens = estimateTokens(content);
  if (originalTokens <= budgetTokens) {
    return { text: content, truncated: false, originalTokens };
  }

  // Split into lines, keep as many as fit
  const lines = content.split('\n');
  const result = [];
  let usedTokens = 0;
  const ellipsisTokens = estimateTokens('\n... (truncated)');

  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n');
    if (usedTokens + lineTokens + ellipsisTokens > budgetTokens && result.length > 0) {
      break;
    }
    result.push(line);
    usedTokens += lineTokens;
  }

  if (result.length < lines.length) {
    result.push('... (truncated)');
    return { text: result.join('\n'), truncated: true, originalTokens };
  }

  return { text: content, truncated: false, originalTokens };
}

// ─── Main Builder ──────────────────────────────────────────────────────────

/**
 * Build a structured prompt from named sections with priority weighting
 * and token budget management.
 *
 * @param {Object} opts
 * @param {Map<string, string>|Object} opts.sections - Section name → content map
 * @param {number} opts.maxTokens - Total token budget
 * @param {string} [opts.errorType] - Dominant error code for adaptive weighting
 * @param {string} [opts.strategy] - Fix strategy type
 * @returns {{ prompt: string, metadata: Object }}
 */
export function buildStructuredPrompt(opts) {
  if (!opts) return { prompt: '', metadata: { sections: [], totalTokens: 0 } };

  const { maxTokens = 4096, errorType, strategy } = opts;
  const sectionsInput = opts.sections instanceof Map
    ? opts.sections
    : new Map(Object.entries(opts.sections || {}));

  // Compute budgets
  const budgets = buildSectionBudget(maxTokens, errorType, strategy);

  // Sort sections by priority descending (highest first)
  const ordered = [...SECTION_DEFS]
    .filter(def => {
      const content = sectionsInput.get(def.name);
      return content && content.trim().length > 0;
    })
    .sort((a, b) => b.priority - a.priority);

  // Fill sections within budget
  const parts = [];
  const sectionMeta = [];
  let totalUsed = 0;

  for (const def of ordered) {
    const content = sectionsInput.get(def.name);
    const budget = budgets.get(def.name);
    const sectionBudget = budget ? budget.budget : 0;

    // Remaining budget for this section: min(section budget, remaining total)
    const remaining = maxTokens - totalUsed;
    const effectiveBudget = Math.min(sectionBudget, remaining);

    if (effectiveBudget <= 0) {
      // v124: Warn when high-priority sections are dropped
      if (def.priority >= 70) {
        logger.warn('PromptBuilder', `High-priority section "${def.name}" (priority=${def.priority}) dropped — budget exhausted`);
      }
      sectionMeta.push({
        name: def.name,
        tokens: 0,
        included: false,
        truncated: false,
        reason: 'budget_exhausted',
      });
      continue;
    }

    const { text, truncated, originalTokens } = truncateSection(content, effectiveBudget);
    const usedTokens = estimateTokens(text);

    parts.push(text);
    totalUsed += usedTokens;

    sectionMeta.push({
      name: def.name,
      tokens: usedTokens,
      included: true,
      truncated,
      originalTokens,
    });
  }

  // Include metadata for sections with no content
  for (const def of SECTION_DEFS) {
    if (!sectionMeta.find(m => m.name === def.name)) {
      sectionMeta.push({
        name: def.name,
        tokens: 0,
        included: false,
        truncated: false,
        reason: 'no_content',
      });
    }
  }

  const prompt = parts.join('\n\n');

  return {
    prompt,
    metadata: {
      sections: sectionMeta,
      totalTokens: totalUsed,
      maxTokens,
      errorType: errorType || null,
      strategy: strategy || null,
      sectionsIncluded: sectionMeta.filter(s => s.included).length,
      sectionsTruncated: sectionMeta.filter(s => s.truncated).length,
    },
  };
}

// ─── Exports for testing ────────────────────────────────────────────────────

export { SECTION_DEFS, ADAPTIVE_WEIGHTS };
