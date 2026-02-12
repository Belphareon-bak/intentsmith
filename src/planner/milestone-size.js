// Milestone Size Validation — Context Budget
// ══════════════════════════════════════════════════════════════════════════════
// Each milestone must fit within context budget to ensure quality.
// Too-large milestones get split suggestions instead of proceeding.

import { config } from '../config.js';

// ─── Token estimation heuristics ─────────────────────────────────────────────

// Rough estimate: 1 LOC ≈ 15 tokens (code + comments + whitespace)
const TOKENS_PER_LOC = 15;
// File overhead: imports, structure, boilerplate ≈ 200 tokens per file
const TOKENS_PER_FILE_OVERHEAD = 200;
// Plan/prompt overhead for a milestone ≈ 2000 tokens
const PLAN_OVERHEAD_TOKENS = 2000;
// Safe context budget for a single milestone (leaves room for LLM reasoning)
const MAX_CONTEXT_TOKENS = 60000;

/**
 * Estimate total context tokens for a milestone.
 * @param {Object} milestone - { estimated_loc, estimated_files, ... }
 * @returns {number} Estimated token count
 */
export function estimateContextTokens(milestone) {
  const loc = milestone.estimated_loc || 0;
  const files = milestone.estimated_files || 0;

  return (loc * TOKENS_PER_LOC) + (files * TOKENS_PER_FILE_OVERHEAD) + PLAN_OVERHEAD_TOKENS;
}

/**
 * Validate milestone size against configured limits.
 * @param {Object} milestone - { estimated_loc, estimated_files, estimated_complexity, title }
 * @param {Object} [limits] - Override config limits
 * @returns {{ fits: boolean, warnings: string[], issues: string[] }}
 */
export function validateMilestoneSize(milestone, limits = {}) {
  const maxLOC = limits.maxLOC || config.lifecycle.maxMilestoneLOC;
  const maxFiles = limits.maxFiles || config.lifecycle.maxMilestoneFiles;
  const loc = milestone.estimated_loc || 0;
  const files = milestone.estimated_files || 0;
  const tokens = estimateContextTokens(milestone);

  const warnings = [];
  const issues = [];

  // Hard limits
  if (loc > maxLOC) {
    issues.push(`LOC (${loc}) exceeds max (${maxLOC})`);
  }
  if (files > maxFiles) {
    issues.push(`Files (${files}) exceeds max (${maxFiles})`);
  }
  if (tokens > MAX_CONTEXT_TOKENS) {
    issues.push(`Estimated tokens (${tokens}) exceeds context budget (${MAX_CONTEXT_TOKENS})`);
  }

  // Soft warnings (75% threshold)
  if (loc > maxLOC * 0.75 && loc <= maxLOC) {
    warnings.push(`LOC (${loc}) is approaching limit (${maxLOC})`);
  }
  if (files > maxFiles * 0.75 && files <= maxFiles) {
    warnings.push(`Files (${files}) is approaching limit (${maxFiles})`);
  }

  // Complexity-based warnings
  if (milestone.estimated_complexity === 'HIGH' && loc > maxLOC * 0.5) {
    warnings.push(`HIGH complexity milestone with ${loc} LOC — consider splitting`);
  }

  return {
    fits: issues.length === 0,
    warnings,
    issues,
    tokens,
  };
}

/**
 * Suggest how to split an oversized milestone.
 * @param {Object} milestone - { title, estimated_loc, estimated_files, description }
 * @returns {{ shouldSplit: boolean, suggestions: Object[] }}
 */
export function suggestMilestoneSplit(milestone) {
  const validation = validateMilestoneSize(milestone);
  if (validation.fits && validation.warnings.length === 0) {
    return { shouldSplit: false, suggestions: [] };
  }

  const maxLOC = config.lifecycle.maxMilestoneLOC;
  const maxFiles = config.lifecycle.maxMilestoneFiles;
  const loc = milestone.estimated_loc || 0;
  const files = milestone.estimated_files || 0;

  // Calculate how many sub-milestones needed
  const splitByLOC = Math.ceil(loc / (maxLOC * 0.7)); // 70% fill factor
  const splitByFiles = Math.ceil(files / (maxFiles * 0.7));
  const splitCount = Math.max(splitByLOC, splitByFiles, 2);

  const suggestions = [];
  const locPerSplit = Math.ceil(loc / splitCount);
  const filesPerSplit = Math.ceil(files / splitCount);

  for (let i = 0; i < splitCount; i++) {
    suggestions.push({
      sequence: i + 1,
      title: `${milestone.title} (${i + 1}/${splitCount})`,
      estimated_loc: Math.min(locPerSplit, loc - (locPerSplit * i)),
      estimated_files: Math.min(filesPerSplit, files - (filesPerSplit * i)),
      note: i === 0
        ? 'Core structure and interfaces'
        : i === splitCount - 1
          ? 'Integration and final wiring'
          : `Implementation batch ${i + 1}`,
    });
  }

  return {
    shouldSplit: !validation.fits,
    splitCount,
    reason: validation.issues.concat(validation.warnings).join('; '),
    suggestions,
  };
}

export default {
  estimateContextTokens,
  validateMilestoneSize,
  suggestMilestoneSplit,
};
