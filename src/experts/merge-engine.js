// C3 Merge Engine v2 — Core Pure Function
// ══════════════════════════════════════════════════════════════════════════════
//
// mergeExpertisePrompt() — 15-step pure function that merges N expertises
// into a single structured prompt + enforcement config.
//
// CONTRACT:
//   - Pure function: no side effects, no DB, no I/O
//   - Deterministic: same input → same output
//   - Commutative: merge(A,B) == merge(B,A) when weights differ
//   - Returns Object.freeze(result)
//   - Input is NOT mutated
//
// PRECEDENCE RULES:
//   Conflict              │ Resolution
//   ──────────────────────┼──────────────────────────────────
//   tone clash            │ highest weight wins (sorted[0])
//   temperature clash     │ dominant (>0.6) wins; else weighted avg
//   module conflict       │ per-section: 'extend' = dedup merge, 'replace' = child only
//   disclaimer conflict   │ UNION (all unique, never trimmed)
//   capability conflict   │ used for compatibility check, not merged
//   constraints conflict  │ UNION (never trimmed)
//   antipatterns conflict │ UNION (never trimmed)
//   forbiddenPhrases      │ UNION of all (regex + string)
//   minResponseLength     │ MAX across all expertises
//   equal weight tie      │ position field is tie-breaker (lower = higher priority)
//
// v63.0 — Merge Engine v2
// ══════════════════════════════════════════════════════════════════════════════

import {
  MERGE_LIMITS,
  MODULE_SECTIONS,
  TRIMMABLE_SECTIONS,
  SECTION_TRIM_PRIORITY,
  CompatibilitySeverity,
  CompatibilityBlockError,
  DEFAULT_FORBIDDEN_PHRASES,
  estimateTokens,
  truncateToTokens,
} from './merge-types.js';
import { checkCompatibility } from './merge-compatibility.js';
import { resolveInheritance } from './expert-layer.js';
import {
  computeCapabilityModifiers,
  applyCapabilityModifiers as applyCapMods,
} from './capability-mapping.js';

// ──────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tag items with source expertise ID and weight for weight-aware trimming.
 * @param {string[]} items
 * @param {string} expertiseId
 * @param {number} weight
 * @returns {Array<{text: string, expertiseId: string, weight: number}>}
 */
function tagItems(items, expertiseId, weight) {
  if (!Array.isArray(items)) return [];
  return items.map(text => ({ text, expertiseId, weight }));
}

/**
 * Merge modules from resolved expertises using tagged items.
 * Deduplicates by text (keeps highest weight), sorts by weight desc.
 *
 * @param {Array<{id: string, weight: number, modules: Object}>} resolved
 * @returns {Object} Merged modules with tagged items per section
 */
function mergeModulesTagged(resolved) {
  const merged = {};

  for (const section of MODULE_SECTIONS) {
    if (section === 'disclaimer') {
      // Collect unique disclaimers
      const disclaimers = [];
      for (const { modules, id, weight } of resolved) {
        const d = modules?.[section];
        if (d && !disclaimers.some(x => x.text === d)) {
          disclaimers.push({ text: d, expertiseId: id, weight });
        }
      }
      merged[section] = disclaimers;
      continue;
    }

    // Tag all items from all expertises
    const allTagged = [];
    for (const { modules, id, weight } of resolved) {
      const items = modules?.[section] || [];
      allTagged.push(...tagItems(items, id, weight));
    }

    // Dedup by text (keep highest weight)
    const seen = new Map();
    for (const item of allTagged) {
      const existing = seen.get(item.text);
      if (!existing || item.weight > existing.weight) {
        seen.set(item.text, item);
      }
    }

    // Sort by weight desc
    merged[section] = [...seen.values()].sort((a, b) => b.weight - a.weight);

    // Apply per-section limits
    const limitKey = `MAX_${section.toUpperCase()}`;
    const limit = MERGE_LIMITS[limitKey];
    if (limit && merged[section].length > limit) {
      merged[section] = merged[section].slice(0, limit);
    }
  }

  return merged;
}

/**
 * Apply specialist override: adds rules, never removes.
 *
 * @param {Object} merged - Merged modules (tagged)
 * @param {Object|null} specialist - Specialist config with optional modules
 * @returns {Object} Updated merged modules
 */
function applySpecialistOverride(merged, specialist) {
  if (!specialist?.modules) return merged;

  const result = { ...merged };
  for (const section of MODULE_SECTIONS) {
    if (section === 'disclaimer') {
      if (specialist.modules.disclaimer) {
        // Prepend specialist disclaimer
        const existing = result.disclaimer || [];
        if (!existing.some(d => d.text === specialist.modules.disclaimer)) {
          result.disclaimer = [
            { text: specialist.modules.disclaimer, expertiseId: specialist.id || '_specialist', weight: 1.0 },
            ...existing,
          ];
        }
      }
      continue;
    }

    const specialistItems = specialist.modules[section];
    if (Array.isArray(specialistItems) && specialistItems.length > 0) {
      const existing = result[section] || [];
      const newItems = tagItems(specialistItems, specialist.id || '_specialist', 1.0);
      // Add specialist items that don't already exist
      for (const item of newItems) {
        if (!existing.some(e => e.text === item.text)) {
          existing.push(item);
        }
      }
      result[section] = existing;
    }
  }

  return result;
}

/**
 * Derive tone from sorted expertises — highest weight wins.
 *
 * @param {Array<{tone: string, weight: number}>} sorted
 * @returns {string}
 */
function deriveTone(sorted) {
  if (sorted.length === 0) return 'professional';
  return sorted[0].tone || 'professional';
}

/**
 * Derive temperature with dominance rule.
 * If dominant weight > DOMINANCE_THRESHOLD → use its temperature.
 * Otherwise → weighted average.
 *
 * @param {Array<{temperature: number, weight: number}>} sorted
 * @returns {{ temperature: number, method: string }}
 */
function deriveTemperature(sorted) {
  if (sorted.length === 0) return { temperature: 0.5, method: 'default' };
  if (sorted.length === 1) return { temperature: sorted[0].temperature, method: 'single' };

  const totalWeight = sorted.reduce((sum, e) => sum + e.weight, 0);
  const dominantRatio = sorted[0].weight / totalWeight;

  if (dominantRatio > MERGE_LIMITS.DOMINANCE_THRESHOLD) {
    return {
      temperature: sorted[0].temperature,
      method: 'dominant',
    };
  }

  // Weighted average
  const weightedSum = sorted.reduce((sum, e) => sum + e.temperature * e.weight, 0);
  return {
    temperature: Math.round((weightedSum / totalWeight) * 100) / 100,
    method: 'weighted_avg',
  };
}

/**
 * Trim merged modules to fit token budget.
 * Trims vocabulary → emphasis → domain_rules, lowest weight first.
 * NEVER trims: constraints, antipatterns, disclaimers.
 *
 * @param {Object} merged - Merged modules with tagged items
 * @param {number} budget - Token budget for modules
 * @returns {{ merged: Object, removed: Array }}
 */
function trimToTokenBudget(merged, budget) {
  const removed = [];

  // Calculate current token usage
  function currentTokens() {
    let total = 0;
    for (const section of MODULE_SECTIONS) {
      const items = merged[section] || [];
      for (const item of items) {
        total += estimateTokens(typeof item === 'object' ? item.text : item);
      }
    }
    return total;
  }

  let tokens = currentTokens();
  if (tokens <= budget) {
    return { merged, removed };
  }

  // Trim order: vocabulary (priority 6) → emphasis (5) → domain_rules (4)
  // Within each section: remove lowest weight first (pop from sorted desc = take last)
  const trimOrder = SECTION_TRIM_PRIORITY
    .filter(s => s.trimmable)
    .sort((a, b) => b.priority - a.priority); // highest priority number = trim first

  for (const { section } of trimOrder) {
    while (tokens > budget && merged[section] && merged[section].length > 0) {
      // Remove the lowest weight item (last in weight-sorted array)
      const removedItem = merged[section].pop();
      removed.push({ section, ...removedItem });
      tokens = currentTokens();
    }
  }

  return { merged, removed };
}

/**
 * Build structured prompt text from merged modules.
 *
 * @param {Object} merged - Merged modules with tagged items
 * @param {string} tone - Derived tone
 * @returns {string}
 */
function buildStructuredPrompt(merged, tone) {
  const parts = [];

  // Header with tone
  parts.push(`[TONE: ${tone}]`);
  parts.push('');

  // Domain rules
  const rules = merged.domain_rules || [];
  if (rules.length > 0) {
    parts.push('## Pravidla domény');
    for (const item of rules) {
      parts.push(`- ${item.text}`);
    }
    parts.push('');
  }

  // Emphasis
  const emphasis = merged.emphasis || [];
  if (emphasis.length > 0) {
    parts.push('## Důraz');
    for (const item of emphasis) {
      parts.push(`- ${item.text}`);
    }
    parts.push('');
  }

  // Constraints
  const constraints = merged.constraints || [];
  if (constraints.length > 0) {
    parts.push('## Omezení');
    for (const item of constraints) {
      parts.push(`- ${item.text}`);
    }
    parts.push('');
  }

  // Vocabulary
  const vocab = merged.vocabulary || [];
  if (vocab.length > 0) {
    parts.push('## Slovník');
    parts.push(vocab.map(item => item.text).join(', '));
    parts.push('');
  }

  // Antipatterns
  const antipatterns = merged.antipatterns || [];
  if (antipatterns.length > 0) {
    parts.push('## Antipatterns (VYVARUJ SE)');
    for (const item of antipatterns) {
      parts.push(`- ${item.text}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Format user context for appending to prompt.
 *
 * @param {string|null} userContext
 * @returns {string|null}
 */
function formatUserContext(userContext) {
  if (!userContext || typeof userContext !== 'string' || userContext.trim().length === 0) {
    return null;
  }
  return truncateToTokens(userContext.trim(), MERGE_LIMITS.MAX_USER_CONTEXT_TOKENS);
}

/**
 * Merge enforcement configs from resolved expertises.
 * Rules: forbiddenPhrases=UNION, minResponseLength=MAX, numericVerification=OR
 *
 * @param {Array<{modules: Object, styleRules?: Object}>} resolved
 * @param {Object|null} specialist
 * @returns {Object} Frozen enforcement config
 */
function mergeEnforcement(resolved, specialist) {
  const allForbidden = [...DEFAULT_FORBIDDEN_PHRASES];
  let maxMinLength = 50;
  let numericVerification = false;
  let toolEnforcement = false;
  const disclaimers = [];

  for (const expertise of resolved) {
    // Collect forbiddenPhrases from styleRules
    const phrases = expertise.styleRules?.forbiddenPhrases || [];
    for (const phrase of phrases) {
      // Deduplicate by string representation
      const key = phrase instanceof RegExp ? phrase.source : String(phrase);
      if (!allForbidden.some(f => (f instanceof RegExp ? f.source : String(f)) === key)) {
        allForbidden.push(phrase);
      }
    }

    // MAX for minResponseLength
    const minLen = expertise.styleRules?.minResponseLength || 50;
    if (minLen > maxMinLength) maxMinLength = minLen;

    // OR for numericVerification / toolEnforcement
    if (expertise.styleRules?.numericVerification) numericVerification = true;
    if (expertise.styleRules?.toolEnforcement) toolEnforcement = true;

    // Collect disclaimers from modules
    if (expertise.modules?.disclaimer) {
      if (!disclaimers.includes(expertise.modules.disclaimer)) {
        disclaimers.push(expertise.modules.disclaimer);
      }
    }
  }

  // Specialist overrides
  if (specialist?.styleRules?.forbiddenPhrases) {
    for (const phrase of specialist.styleRules.forbiddenPhrases) {
      const key = phrase instanceof RegExp ? phrase.source : String(phrase);
      if (!allForbidden.some(f => (f instanceof RegExp ? f.source : String(f)) === key)) {
        allForbidden.push(phrase);
      }
    }
  }
  if (specialist?.modules?.disclaimer) {
    if (!disclaimers.includes(specialist.modules.disclaimer)) {
      disclaimers.unshift(specialist.modules.disclaimer);
    }
  }

  return Object.freeze({
    forbiddenPhrases: allForbidden,
    minResponseLength: maxMinLength,
    numericVerification,
    toolEnforcement,
    disclaimers,
  });
}

/**
 * Build audit log object for the merge operation.
 *
 * @param {Object} data
 * @returns {Object}
 */
function buildAuditLog(data) {
  return {
    timestamp: new Date().toISOString(),
    expertiseIds: data.expertiseIds,
    weights: data.weights,
    compatibility: data.compatibility,
    tone: data.tone,
    temperature: data.temperature,
    tokensBefore: data.tokensBefore,
    tokensAfter: data.tokensAfter,
    trimmedItems: data.trimmedItems,
    specialistId: data.specialistId || null,
    userContextTokens: data.userContextTokens || 0,
    capabilityModifiers: data.capabilityModifiers || null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Merge N expertises into a single structured prompt.
 *
 * 15-step pure function algorithm:
 *  1. Validate count (≤3)
 *  2. checkCompatibility on RAW capabilities → HARD_BLOCK throws
 *  3. Sort by weight desc
 *  4. resolveInheritance for each
 *  5. mergeModulesTagged — tagged items, dedup, sort
 *  6. applySpecialistOverride — adds, never removes
 *  7. deriveTone — highest weight wins
 *  8. deriveTemperature — dominance rule
 *  9. User context budget (max 300 tokens)
 * 10. trimToTokenBudget — EFFECTIVE_TOKEN_BUDGET minus context
 * 11. buildStructuredPrompt
 * 12. Append user context
 * 13. mergeEnforcement — UNION/MAX/OR
 * 14. buildAuditLog
 * 15. Object.freeze(result)
 *
 * @param {Array<{id: string, name?: string, capabilities?: Object, weight?: number, modules?: Object, temperature?: number, tone?: string, styleRules?: Object, parent?: string}>} expertises
 * @param {Object|null} [specialistOverride] - Optional specialist config
 * @param {string|null} [userContext] - Optional user context text
 * @param {Object} [options] - Options
 * @param {Object} [options.registry] - Expert registry for inheritance resolution
 * @returns {Readonly<{ prompt: string, metadata: Object, enforcement: Object, audit: Object }>}
 * @throws {CompatibilityBlockError} If expertises are incompatible (HARD_BLOCK)
 */
export function mergeExpertisePrompt(expertises, specialistOverride = null, userContext = null, options = {}) {
  // Step 1: Validate count
  if (!Array.isArray(expertises) || expertises.length === 0) {
    throw new Error('mergeExpertisePrompt: at least 1 expertise required');
  }
  if (expertises.length > MERGE_LIMITS.MAX_ACTIVE_EXPERTISES) {
    throw new Error(`mergeExpertisePrompt: max ${MERGE_LIMITS.MAX_ACTIVE_EXPERTISES} expertises, got ${expertises.length}`);
  }

  // Step 2: Compatibility check on RAW capabilities (before merge)
  const compatibility = checkCompatibility(expertises);
  if (compatibility.blocked) {
    throw new CompatibilityBlockError(compatibility);
  }

  // Step 3: Sort by weight desc (stable sort — position as tie-breaker 🟡5)
  const sorted = [...expertises].sort((a, b) => {
    const wDiff = (b.weight ?? 0.5) - (a.weight ?? 0.5);
    if (wDiff !== 0) return wDiff;
    return (a.position ?? 0) - (b.position ?? 0);
  });

  // Step 4: Resolve inheritance for each (v63.2: capabilities + enforcement too)
  const registry = options.registry || {};
  const resolved = sorted.map(e => {
    const inherited = resolveInheritance(e, registry);
    return {
      ...e,
      weight: e.weight ?? 0.5,
      modules: inherited.modules,
      capabilities: inherited.capabilities,
      styleRules: inherited.styleRules,
    };
  });

  // Step 5: Merge modules (tagged items, dedup, sort by weight)
  let merged = mergeModulesTagged(resolved);

  // Step 6: Apply specialist override
  merged = applySpecialistOverride(merged, specialistOverride);

  // Step 7: Derive tone
  const tone = specialistOverride?.tone || deriveTone(resolved);

  // Step 8: Derive temperature
  let tempResult = specialistOverride?.temperature != null
    ? { temperature: specialistOverride.temperature, method: 'specialist_override' }
    : deriveTemperature(resolved);

  // Step 9: User context budget
  const formattedContext = formatUserContext(userContext);
  const contextTokens = formattedContext ? estimateTokens(formattedContext) : 0;

  // Step 10: Trim to token budget
  const modulesBudget = MERGE_LIMITS.EFFECTIVE_TOKEN_BUDGET - contextTokens;
  const tokensBefore = estimateTokens(
    Object.values(merged).flat().map(i => typeof i === 'object' ? i.text : i).join(' ')
  );
  const trimResult = trimToTokenBudget(merged, modulesBudget);
  merged = trimResult.merged;

  // Step 11: Build structured prompt
  let prompt = buildStructuredPrompt(merged, tone);

  // Step 12: Append user context
  if (formattedContext) {
    prompt += `\n## Uživatelský kontext\n${formattedContext}\n`;
  }

  // Append disclaimers to prompt
  const disclaimers = merged.disclaimer || [];
  if (disclaimers.length > 0) {
    prompt += '\n## Disclaimery\n';
    for (const d of disclaimers) {
      prompt += `⚠️ ${d.text}\n`;
    }
  }

  // Step 13: Merge enforcement
  let enforcement = mergeEnforcement(resolved, specialistOverride);

  // Step 13.5: Apply capability modifiers (v63.0 — real behavior, not cosmetic)
  const capModifiers = computeCapabilityModifiers(resolved);
  const capApplied = applyCapMods(capModifiers, prompt, tempResult, enforcement);
  prompt = capApplied.prompt;
  tempResult = capApplied.tempResult;
  enforcement = capApplied.enforcement;

  // Step 14: Build audit log
  const tokensAfter = estimateTokens(prompt);
  const audit = buildAuditLog({
    expertiseIds: resolved.map(e => e.id),
    weights: resolved.map(e => ({ id: e.id, weight: e.weight })),
    compatibility: {
      severity: compatibility.severity,
      conflicts: compatibility.conflicts.length,
    },
    tone,
    temperature: tempResult,
    tokensBefore,
    tokensAfter,
    trimmedItems: trimResult.removed,
    specialistId: specialistOverride?.id || null,
    userContextTokens: contextTokens,
    capabilityModifiers: capModifiers, // audit the applied modifiers
  });

  // Step 15: Freeze and return
  return Object.freeze({
    prompt,
    metadata: Object.freeze({
      expertiseIds: resolved.map(e => e.id),
      weights: resolved.map(e => ({ id: e.id, weight: e.weight })),
      tone,
      temperature: tempResult.temperature,
      temperatureMethod: tempResult.method,
      tokenCount: tokensAfter,
      compatibility: compatibility.severity,
      requiresConfirmation: compatibility.requiresConfirmation,
      capabilityVector: capModifiers.capabilityVector,
    }),
    enforcement: Object.freeze(enforcement),
    audit,
  });
}
