// CRE v56.0 — Sprint 3: LTM Context Builder
// ══════════════════════════════════════════════════════════════════════════════
//
// READ-ONLY integration of LongTermMemory into synthesis pipeline.
//
// Architecture:
//   LTM = sémantická paměť (stable facts about the user)
//   Conversation DB = epizodická paměť (what happened this session)
//
//   LTM feeds into synthesis prompts, NEVER into:
//   - CRE intent classification
//   - Safety checks
//   - Mode routing
//
// Invariant:
//   ❗ LTM MUST NOT influence intent classification
//   ❗ LTM is read-only in this module (writes happen elsewhere)
//   ❗ If LTM is unavailable, synthesis proceeds without it
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { MemoryKind } from '../memory/long-term.js';
import { rankForContext } from '../memory/injection-ranker.js';

// ─────────────────────────────────────────────────────────────────────────────
// LTM Context Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract relevant LTM facts for synthesis context.
 *
 * Returns a curated set of facts organized by kind.
 * Filters out low-confidence and expired entries.
 *
 * @param {LongTermMemory} ltm — LongTermMemory instance
 * @param {Object} [opts]
 * @param {number} [opts.minConfidence=0.6] — Minimum confidence threshold
 * @param {number} [opts.maxFacts=10] — Maximum facts to include
 * @param {string[]} [opts.kinds] — Specific kinds to include (default: all relevant)
 * @param {string} [opts.input] — Current user input (for M2 ranked scoring)
 * @param {string} [opts.intent] — Current CRE intent (for M2 ranked scoring)
 * @returns {{ facts: Array<{ kind: string, key: string, value: any, score?: number }>, count: number }}
 */
export function extractLTMContext(ltm, opts = {}) {
  const {
    minConfidence = 0.6,
    maxFacts = 10,
    input = null,
    intent = null,
    kinds = [
      MemoryKind.PREFERENCE,
      MemoryKind.STYLE,
      MemoryKind.PROJECT,
      MemoryKind.CORRECTION,
    ],
  } = opts;

  if (!ltm) {
    return { facts: [], count: 0 };
  }

  const allFacts = [];

  try {
    for (const kind of kinds) {
      const entries = ltm.queryByKind(kind, { minConfidence });
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          allFacts.push({
            kind,  // from loop variable — queryByKind doesn't return kind
            key: entry.key,
            value: entry.value,
            confidence: entry.confidence,
            effectiveConfidence: entry.effectiveConfidence,
            accessCount: entry.accessCount,
            source: entry.source,
          });
        }
      }
    }
  } catch (err) {
    logger.warn('LTMContext', `Failed to query LTM: ${err.message}`);
    return { facts: [], count: 0 };
  }

  // v86 M2: Use ranked scoring when input + intent are available
  let sorted;
  if (input && intent) {
    try {
      sorted = rankForContext(allFacts, input, intent).slice(0, maxFacts);
    } catch (err) {
      logger.debug('LTMContext', `rankForContext failed, falling back to confidence sort: ${err.message}`);
      sorted = allFacts
        .sort((a, b) => (b.effectiveConfidence || b.confidence || 0) - (a.effectiveConfidence || a.confidence || 0))
        .slice(0, maxFacts);
    }
  } else {
    // Fallback: simple confidence sort (pre-M2 behavior)
    sorted = allFacts
      .sort((a, b) => (b.effectiveConfidence || b.confidence || 0) - (a.effectiveConfidence || a.confidence || 0))
      .slice(0, maxFacts);
  }

  return { facts: sorted, count: sorted.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// LTM Prompt Building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an LTM context block for injection into synthesis prompts.
 *
 * Format:
 *   KONTEXT O UŽIVATELI (z dlouhodobé paměti):
 *   - Preferuje stručné odpovědi
 *   - Pracuje jako DevOps engineer
 *   - Jmenuje se Petr
 *
 * Returns empty string if no relevant facts.
 *
 * @param {Array<{ kind: string, key: string, value: any }>} facts
 * @returns {string}
 */
export function buildLTMPromptBlock(facts) {
  if (!facts || facts.length === 0) return '';

  const lines = [];
  lines.push('KONTEXT O UŽIVATELI (z dlouhodobé paměti):');

  for (const fact of facts) {
    const value = typeof fact.value === 'object'
      ? JSON.stringify(fact.value)
      : String(fact.value);

    // Format depends on kind
    switch (fact.kind) {
      case MemoryKind.PREFERENCE:
        lines.push(`- Preference: ${fact.key} = ${value}`);
        break;
      case MemoryKind.STYLE:
        lines.push(`- Styl: ${value}`);
        break;
      case MemoryKind.PROJECT:
        lines.push(`- Projekt: ${fact.key} — ${value}`);
        break;
      case MemoryKind.CORRECTION:
        lines.push(`- Korekce: ${value}`);
        break;
      default:
        lines.push(`- ${fact.key}: ${value}`);
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get LTM context string ready for prompt injection.
 *
 * Convenience function: extract + format in one call.
 * v86 M2: Pass input + intent for ranked scoring.
 *
 * @param {LongTermMemory|null} ltm
 * @param {Object} [opts] — Options for extractLTMContext
 * @param {string} [opts.input] — Current user input (for ranked scoring)
 * @param {string} [opts.intent] — Current CRE intent (for ranked scoring)
 * @returns {string} — Formatted context block, or empty string
 */
export function getLTMContextForSynthesis(ltm, opts = {}) {
  if (!ltm) return '';

  const { facts } = extractLTMContext(ltm, opts);
  return buildLTMPromptBlock(facts);
}

export default {
  extractLTMContext,
  buildLTMPromptBlock,
  getLTMContextForSynthesis,
};
