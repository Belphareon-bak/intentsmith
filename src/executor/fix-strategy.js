// Fix Strategy v111 (F10) — Failure Strategy Selection
// ══════════════════════════════════════════════════════════════════════════════
//
// Classifies errors into fix strategies to avoid unnecessary LLM calls:
//   - DETERMINISTIC: template-based fix, no LLM needed
//   - HEURISTIC: LLM with focused hint (shorter prompt)
//   - LLM_FULL: full LLM reasoning (current behavior)
//   - SKIP: known unfixable, skip iteration
//
// Decision tree based on error code, archetypes, and iteration count.
// Deterministic patches go through dry-run validation before apply.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Strategy Types ─────────────────────────────────────────────────────────

export const StrategyType = Object.freeze({
  DETERMINISTIC: 'deterministic',
  HEURISTIC:     'heuristic',
  LLM_FULL:      'llm_full',
  SKIP:          'skip',
});

// ─── Deterministic patterns ─────────────────────────────────────────────────

// Map error code → deterministic fix template (when archetype exists or pattern is trivial)
const DETERMINISTIC_RULES = {
  UNUSED_IMPORT:   { canAlwaysFix: true },
  SYNTAX_ERROR:    { needsArchetype: false },
  IMPORT_NOT_FOUND:{ needsArchetype: true },
};

// Heuristic hints per error code
const HEURISTIC_HINTS = {
  NULL_REFERENCE:     'Add null/undefined check before the property access. Check the call chain for nullable values.',
  ASSERTION_FAILED:   'Compare expected vs actual values in the test. Check if the API contract or return type changed.',
  TYPE_MISMATCH:      'Check the type signature at the call site. Verify the argument/return type matches the declaration.',
  MISSING_PROPERTY:   'Check if the property name is correct and the object type includes it. May need interface extension.',
  ARGUMENT_COUNT:     'Check the function signature — the number of arguments does not match the call site.',
  UNDEFINED_VARIABLE: 'Check if the variable is imported or declared. May be a missing import or a scope issue.',
  MISSING_TYPE:       'Add explicit type annotation to resolve the implicit any.',
};

// Max iteration before giving up on a repeating error
const STALE_ERROR_THRESHOLD = 3;

// ─── selectFixStrategy ──────────────────────────────────────────────────────

/**
 * Select a fix strategy for each error.
 *
 * @param {Array} errors - NormalizedError[]
 * @param {Array} archetypes - From findArchetypes() (pattern-miner F8)
 * @param {number} iteration - Current loop iteration (1-based)
 * @param {Object} [opts] - { errorHistory?: Array<Array> } — past iterations' error lists
 * @returns {Map<Object, { type: string, hint?: string, template?: string, archetype?: Object }>}
 */
export function selectFixStrategy(errors, archetypes, iteration, opts = {}) {
  if (!errors || errors.length === 0) return new Map();

  const archetypeMap = _buildArchetypeMap(archetypes);
  const errorHistory = opts.errorHistory || [];
  const strategyMap = new Map();

  for (const error of errors) {
    const strategy = _selectOne(error, archetypeMap, iteration, errorHistory);
    strategyMap.set(error, strategy);
  }

  return strategyMap;
}

/**
 * Select strategy for a single error.
 */
function _selectOne(error, archetypeMap, iteration, errorHistory) {
  const code = error.code;

  // 1. SKIP: unrecoverable errors
  if (code === 'PERMISSION_DENIED') {
    return { type: StrategyType.SKIP, hint: 'Permission denied — not fixable by code change' };
  }

  // 2. SKIP: stale error (same error repeating for STALE_ERROR_THRESHOLD iterations)
  if (iteration >= STALE_ERROR_THRESHOLD && _isStaleError(error, errorHistory, STALE_ERROR_THRESHOLD)) {
    return { type: StrategyType.SKIP, hint: `Error persisted for ${STALE_ERROR_THRESHOLD}+ iterations — giving up` };
  }

  // 3. DETERMINISTIC: UNUSED_IMPORT — always removable
  if (code === 'UNUSED_IMPORT') {
    return {
      type: StrategyType.DETERMINISTIC,
      template: 'remove_unused_import',
      hint: `Remove the unused import of '${error.symbol || 'unknown'}' from ${error.file || 'file'}`,
    };
  }

  // 4. DETERMINISTIC: SYNTAX_ERROR with bracket/semicolon pattern
  if (code === 'SYNTAX_ERROR' && _isTrivialSyntax(error)) {
    return {
      type: StrategyType.DETERMINISTIC,
      template: 'fix_trivial_syntax',
      hint: 'Fix trivial syntax error (missing bracket, semicolon, or comma)',
    };
  }

  // 5. DETERMINISTIC: IMPORT_NOT_FOUND with archetype
  if (code === 'IMPORT_NOT_FOUND' && archetypeMap.has(code)) {
    return {
      type: StrategyType.DETERMINISTIC,
      template: 'fix_import',
      archetype: archetypeMap.get(code),
      hint: `Fix missing import: ${archetypeMap.get(code).strategy}`,
    };
  }

  // 6. HEURISTIC: known error codes with focused hints
  if (HEURISTIC_HINTS[code]) {
    const archetype = archetypeMap.get(code);
    const hint = archetype
      ? `${HEURISTIC_HINTS[code]} Past fix: ${archetype.strategy}`
      : HEURISTIC_HINTS[code];
    return {
      type: StrategyType.HEURISTIC,
      hint,
      archetype: archetype || null,
    };
  }

  // 7. HEURISTIC: any error with an archetype (even if no standard hint)
  if (archetypeMap.has(code)) {
    const archetype = archetypeMap.get(code);
    return {
      type: StrategyType.HEURISTIC,
      hint: `Past fix for ${code}: ${archetype.strategy}`,
      archetype,
    };
  }

  // 8. Default: LLM_FULL
  return { type: StrategyType.LLM_FULL };
}

// ─── Deterministic Patch Builders ───────────────────────────────────────────

/**
 * Build a deterministic patch text for simple error fixes.
 * Returns null if the error cannot be fixed deterministically.
 *
 * @param {Object} error - NormalizedError
 * @param {Object} strategy - From selectFixStrategy
 * @param {string} [fileContent] - Current file content (for line-level fixes)
 * @returns {{ patchText: string, file: string }|null}
 */
export function buildDeterministicPatch(error, strategy, fileContent) {
  if (!error || !strategy || strategy.type !== StrategyType.DETERMINISTIC) return null;

  switch (strategy.template) {
    case 'remove_unused_import':
      return _buildRemoveImport(error, fileContent);
    case 'fix_trivial_syntax':
      return _buildSyntaxFix(error, fileContent);
    case 'fix_import':
      return _buildImportFix(error, strategy);
    default:
      return null;
  }
}

/**
 * Build patch to remove an unused import line.
 */
function _buildRemoveImport(error, fileContent) {
  if (!error.file || !error.line || !fileContent) return null;

  const lines = fileContent.split('\n');
  const lineIdx = error.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;

  const line = lines[lineIdx];

  // Simple case: entire line is the unused import
  return {
    file: error.file,
    patchText: `--- ${error.file}\n@@ line ${error.line}\n- ${line}\n`,
  };
}

/**
 * Build patch for trivial syntax errors (missing semicolons, brackets).
 */
function _buildSyntaxFix(error, fileContent) {
  if (!error.file || !error.line || !fileContent) return null;

  const lines = fileContent.split('\n');
  const lineIdx = error.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;

  const line = lines[lineIdx];
  const msg = (error.message || '').toLowerCase();

  // Missing semicolon
  if (msg.includes('semicolon') || msg.includes(';')) {
    const trimmed = line.trimEnd();
    if (!trimmed.endsWith(';') && !trimmed.endsWith('{') && !trimmed.endsWith('}') && !trimmed.endsWith(',')) {
      return {
        file: error.file,
        patchText: `--- ${error.file}\n@@ line ${error.line}\n- ${line}\n+ ${trimmed};\n`,
      };
    }
  }

  // Missing closing bracket — can't determine deterministically without AST
  // Falls through to null → LLM will handle
  return null;
}

/**
 * Build patch for import fixes based on archetype.
 */
function _buildImportFix(error, strategy) {
  if (!error.file || !strategy.archetype) return null;

  // Import fixes are complex enough that we provide a hint only
  // The actual fix goes through the HEURISTIC path with the archetype
  return null;
}

// ─── Deterministic Patch Validation ─────────────────────────────────────────

/**
 * Validate a deterministic patch via dry-run: check that applying it
 * doesn't introduce more errors than the original.
 *
 * Simple heuristic: for line removal, check that the result parses (no orphan brackets).
 * Returns null if validation fails.
 *
 * @param {Object} patch - { patchText, file }
 * @param {string} fileContent - Original file content
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateDeterministicPatch(patch, fileContent) {
  if (!patch || !fileContent) return { valid: false, reason: 'missing input' };

  // Parse the patch to understand what changes
  const lines = patch.patchText.split('\n');
  const removals = lines.filter(l => l.startsWith('- ')).length;
  const additions = lines.filter(l => l.startsWith('+ ')).length;

  // Pure removal: verify it doesn't break bracket balance
  if (removals > 0 && additions === 0) {
    const removedContent = lines
      .filter(l => l.startsWith('- '))
      .map(l => l.slice(2))
      .join('\n');

    // Count brackets in removed content
    const openBrackets = (removedContent.match(/[({[]/g) || []).length;
    const closeBrackets = (removedContent.match(/[)}\]]/g) || []).length;

    // If removing unbalanced brackets → reject
    if (openBrackets !== closeBrackets) {
      return { valid: false, reason: 'Unbalanced brackets in removed lines' };
    }
  }

  // Substitution: basic sanity check
  if (additions > 0) {
    const addedContent = lines
      .filter(l => l.startsWith('+ '))
      .map(l => l.slice(2))
      .join('\n');

    // Check for empty additions (accidental deletion)
    if (addedContent.trim().length === 0 && removals > 0) {
      return { valid: false, reason: 'Replacement content is empty' };
    }
  }

  return { valid: true };
}

// ─── Heuristic Hint Builder ─────────────────────────────────────────────────

/**
 * Build a focused LLM hint for a heuristic-strategy error.
 *
 * @param {Object} error - NormalizedError
 * @param {Object} strategy - From selectFixStrategy
 * @param {Object} [archetype] - From findArchetypes (may be null)
 * @returns {string} Hint text for LLM prompt
 */
export function buildHeuristicHint(error, strategy, archetype) {
  if (!error) return '';

  const parts = [];
  const loc = error.file ? `\`${error.file}${error.line ? ':' + error.line : ''}\`` : '';

  parts.push(`**${error.code}** ${loc}: ${error.message || 'unknown error'}`);

  if (strategy?.hint) {
    parts.push(`Hint: ${strategy.hint}`);
  }

  if (archetype?.strategy) {
    parts.push(`Past successful fix: ${archetype.strategy} (confidence: ${Math.round((archetype.confidence || 0) * 100)}%)`);
  }

  return parts.join('\n');
}

// ─── Strategy Report ────────────────────────────────────────────────────────

/**
 * Format a human-readable summary of strategy assignments.
 *
 * @param {Map} strategyMap - From selectFixStrategy
 * @returns {string}
 */
export function formatStrategyReport(strategyMap) {
  if (!strategyMap || strategyMap.size === 0) return '';

  const counts = { deterministic: 0, heuristic: 0, llm_full: 0, skip: 0 };
  for (const [, s] of strategyMap) {
    counts[s.type] = (counts[s.type] || 0) + 1;
  }

  return `${counts.deterministic} deterministic, ${counts.heuristic} heuristic, ${counts.llm_full} LLM, ${counts.skip} skipped`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build archetype lookup: errorCode → archetype
 */
function _buildArchetypeMap(archetypes) {
  const map = new Map();
  if (!archetypes) return map;
  for (const a of archetypes) {
    if (a.errorCode && !map.has(a.errorCode)) {
      map.set(a.errorCode, a);
    }
  }
  return map;
}

/**
 * Check if a SYNTAX_ERROR is trivially fixable (missing semicolon, bracket, comma).
 */
function _isTrivialSyntax(error) {
  const msg = (error.message || '').toLowerCase();
  return msg.includes('semicolon') || msg.includes(';') ||
    msg.includes('unexpected token') || msg.includes('missing') ||
    msg.includes('expected');
}

/**
 * Check if an error has been present for N consecutive iterations.
 */
function _isStaleError(error, errorHistory, threshold) {
  if (!errorHistory || errorHistory.length < threshold) return false;

  const key = `${error.code}|${error.file}|${error.line ?? '?'}`;
  const recent = errorHistory.slice(-threshold);

  return recent.every(iterErrors =>
    iterErrors.some(e => `${e.code}|${e.file}|${e.line ?? '?'}` === key)
  );
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  StrategyType,
  selectFixStrategy,
  buildDeterministicPatch,
  validateDeterministicPatch,
  buildHeuristicHint,
  formatStrategyReport,
};
