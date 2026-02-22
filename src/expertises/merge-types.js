// C3 Merge Engine v2 — Types and Constants
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure definitions, no side effects.
// All merge-engine-wide constants, error classes, and token estimation utilities.
//
// v63.0 — Merge Engine v2
// ══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MERGE LIMITS
// ═══════════════════════════════════════════════════════════════════════════

export const MERGE_LIMITS = Object.freeze({
  // Expertises
  MAX_ACTIVE_EXPERTISES: 3,       // hard limit — more = prompt chaos

  // Per-section limits (after merge, before trim)
  MAX_DOMAIN_RULES: 15,
  MAX_EMPHASIS: 10,
  MAX_CONSTRAINTS: 15,            // never trimmed, only warns
  MAX_VOCABULARY: 30,
  MAX_ANTIPATTERNS: 10,           // never trimmed, only warns
  MAX_DISCLAIMERS: 3,             // never trimmed

  // Token budget
  MAX_TOTAL_TOKENS: 2000,         // external API limit
  EFFECTIVE_TOKEN_BUDGET: 1800,   // internal budget with 10% safety margin
  MAX_USER_CONTEXT_TOKENS: 300,   // dedicated user context budget

  // Weight
  MIN_WEIGHT: 0.1,
  MAX_WEIGHT: 1.0,
  DOMINANCE_THRESHOLD: 0.6,       // above this = dominant expertise
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION TRIM PRIORITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sections ordered from HIGHEST to LOWEST priority.
 * Trimming starts from the END of the list (lowest priority first).
 * Sections with trimmable: false are NEVER trimmed.
 */
export const SECTION_TRIM_PRIORITY = Object.freeze([
  // === NEVER TRIM (safety-critical) ===
  { section: 'disclaimers',  priority: 1, trimmable: false },
  { section: 'constraints',  priority: 2, trimmable: false },
  { section: 'antipatterns', priority: 3, trimmable: false },

  // === TRIM WHEN NECESSARY (from end) ===
  { section: 'domain_rules', priority: 4, trimmable: true },
  { section: 'emphasis',     priority: 5, trimmable: true },
  { section: 'vocabulary',   priority: 6, trimmable: true },
]);

export const MODULE_SECTIONS = Object.freeze([
  'domain_rules', 'emphasis', 'constraints',
  'vocabulary', 'antipatterns', 'disclaimer',
]);

export const TRIMMABLE_SECTIONS = Object.freeze([
  'domain_rules', 'emphasis', 'vocabulary',
]);

export const NEVER_TRIM_SECTIONS = Object.freeze([
  'disclaimers', 'constraints', 'antipatterns',
]);

// ═══════════════════════════════════════════════════════════════════════════
// COMPATIBILITY SEVERITY
// ═══════════════════════════════════════════════════════════════════════════

export const CompatibilitySeverity = Object.freeze({
  OK:         'ok',
  WARNING:    'warning',
  SOFT_BLOCK: 'soft_block',
  HARD_BLOCK: 'hard_block',
});

// ═══════════════════════════════════════════════════════════════════════════
// INHERITANCE
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_INHERITANCE_MODE = 'extend';
export const MAX_INHERITANCE_DEPTH = 4;

// ═══════════════════════════════════════════════════════════════════════════
// ERROR CLASSES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thrown when a HARD_BLOCK compatibility conflict is detected.
 * Contains the full compatibility result for UI display.
 */
export class CompatibilityBlockError extends Error {
  constructor(compatibility) {
    const details = compatibility.conflicts
      .map(c => {
        if (c.conflicts?.length > 0) {
          return c.conflicts.map(cc => cc.detail).join('; ');
        }
        return c.detail || '';
      })
      .filter(Boolean)
      .join('; ');
    super(`Expertise combination blocked: ${details || 'incompatible capability vectors'}`);
    this.name = 'CompatibilityBlockError';
    this.compatibility = compatibility;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estimate token count from text.
 * Heuristic: ~3.5 chars per token for Czech text on Qwen/Llama tokenizers.
 *
 * @param {string|Array|Object} input
 * @returns {number}
 */
export function estimateTokens(input) {
  if (typeof input === 'string') {
    return Math.ceil(input.length / 3.5);
  }
  if (Array.isArray(input)) {
    return input.reduce((sum, item) => {
      if (typeof item === 'object' && item !== null && item.text) {
        return sum + estimateTokens(item.text);
      }
      if (typeof item === 'string') {
        return sum + estimateTokens(item);
      }
      return sum;
    }, 0);
  }
  if (typeof input === 'object' && input !== null) {
    return Object.values(input).reduce((sum, val) => sum + estimateTokens(val), 0);
  }
  return 0;
}

/**
 * Estimate tokens for a merged sections object with tagged items.
 * Sections: { domain_rules: [{text, expertiseId, weight}], ... }
 *
 * @param {Object} merged
 * @returns {number}
 */
export function estimateTokensTagged(merged) {
  let total = 0;
  for (const section of Object.keys(merged)) {
    if (section.startsWith('_')) continue; // skip internal props like _trimWarning
    const items = merged[section];
    if (Array.isArray(items)) {
      for (const item of items) {
        if (typeof item === 'object' && item !== null && item.text) {
          total += estimateTokens(item.text);
        } else if (typeof item === 'string') {
          total += estimateTokens(item);
        }
      }
    } else if (typeof items === 'string') {
      total += estimateTokens(items);
    }
  }
  return total;
}

/**
 * Truncate text to fit within a token budget.
 *
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
export function truncateToTokens(text, maxTokens) {
  const maxChars = Math.floor(maxTokens * 3.5);
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT FORBIDDEN PHRASES (baseline enforcement)
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_FORBIDDEN_PHRASES = Object.freeze([
  /^(nevím|netuším)\.?$/i,
  /^to záleží\.?$/i,
  /jako (velký )?jazykový model/i,
  /nemohu (vám )?pomoci s/i,
]);
