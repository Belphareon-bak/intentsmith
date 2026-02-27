// CRE v86.0 M2 — Smart Injection Ranking
// ══════════════════════════════════════════════════════════════════════════════
//
// Ranks LTM entries by combined score: effectiveConfidence * relevance
//
// Relevance components:
//   1. Keyword overlap — input tokens vs memory key/value tokens
//   2. Intent-kind affinity — SEARCH → project, CODE → correction, etc.
//   3. Recency bonus — recently accessed entries get slight boost
//
// Architecture:
//   Called by ltm-context.js during extractLTMContext().
//   Pure scoring — no writes, no side effects.
//
// ══════════════════════════════════════════════════════════════════════════════

import { MemoryKind } from './long-term.js';

// ════════════════════════════════════════════════════════════════════════════
// INTENT → KIND AFFINITY MATRIX
// ════════════════════════════════════════════════════════════════════════════
// How much each MemoryKind matters for each intent.
// Values 0.0–1.0, default 0.3 for unspecified.

const INTENT_KIND_AFFINITY = {
  SEARCH:         { [MemoryKind.PROJECT]: 0.8, [MemoryKind.PREFERENCE]: 0.5, [MemoryKind.STYLE]: 0.3, [MemoryKind.CORRECTION]: 0.4, [MemoryKind.PATTERN]: 0.6 },
  FACTUAL:        { [MemoryKind.PROJECT]: 0.7, [MemoryKind.PREFERENCE]: 0.4, [MemoryKind.STYLE]: 0.2, [MemoryKind.CORRECTION]: 0.5, [MemoryKind.PATTERN]: 0.5 },
  REPORT:         { [MemoryKind.PROJECT]: 0.9, [MemoryKind.PREFERENCE]: 0.6, [MemoryKind.STYLE]: 0.7, [MemoryKind.CORRECTION]: 0.3, [MemoryKind.PATTERN]: 0.5 },
  CODE:           { [MemoryKind.PROJECT]: 0.9, [MemoryKind.PREFERENCE]: 0.4, [MemoryKind.STYLE]: 0.3, [MemoryKind.CORRECTION]: 0.9, [MemoryKind.PATTERN]: 0.7 },
  CONVERSATIONAL: { [MemoryKind.PROJECT]: 0.3, [MemoryKind.PREFERENCE]: 0.9, [MemoryKind.STYLE]: 0.9, [MemoryKind.CORRECTION]: 0.5, [MemoryKind.PATTERN]: 0.4 },
  CREATIVE:       { [MemoryKind.PROJECT]: 0.3, [MemoryKind.PREFERENCE]: 0.7, [MemoryKind.STYLE]: 0.9, [MemoryKind.CORRECTION]: 0.3, [MemoryKind.PATTERN]: 0.3 },
  DESIGN:         { [MemoryKind.PROJECT]: 0.9, [MemoryKind.PREFERENCE]: 0.6, [MemoryKind.STYLE]: 0.7, [MemoryKind.CORRECTION]: 0.5, [MemoryKind.PATTERN]: 0.6 },
  LOCAL:          { [MemoryKind.PROJECT]: 0.4, [MemoryKind.PREFERENCE]: 0.6, [MemoryKind.STYLE]: 0.3, [MemoryKind.CORRECTION]: 0.3, [MemoryKind.PATTERN]: 0.3 },
};

const DEFAULT_AFFINITY = 0.3;

// ════════════════════════════════════════════════════════════════════════════
// RECENCY BONUS
// ════════════════════════════════════════════════════════════════════════════
// Entries accessed in last 24h get a small relevance boost.
// This is separate from confidence decay — it rewards "hot" memories.

const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RECENCY_BONUS = 0.15;

// ════════════════════════════════════════════════════════════════════════════
// TOKENIZER (simple, no NLP)
// ════════════════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  'a', 'and', 'the', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are',
  'je', 'co', 'jak', 'na', 'do', 'se', 'za', 'od', 've', 'ke', 'ze',
  'ten', 'ta', 'to', 'ty', 'te', 'mi', 'si', 'me', 'my', 'ne',
]);

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

// ════════════════════════════════════════════════════════════════════════════
// KEYWORD OVERLAP
// ════════════════════════════════════════════════════════════════════════════

function keywordOverlap(inputTokens, entryTokens) {
  if (inputTokens.length === 0 || entryTokens.length === 0) return 0;
  const entrySet = new Set(entryTokens);
  let matches = 0;
  for (const token of inputTokens) {
    if (entrySet.has(token)) matches++;
  }
  // Jaccard-like: matches / union
  const union = new Set([...inputTokens, ...entryTokens]).size;
  return union > 0 ? matches / union : 0;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN RANKING FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rank LTM entries by combined score for context injection.
 *
 * Score = effectiveConfidence * relevance
 * Relevance = w1*keywordOverlap + w2*intentAffinity + w3*recencyBonus
 *
 * @param {Array<{key, value, confidence, effectiveConfidence, source, accessCount, kind}>} entries
 * @param {string} input - Current user input
 * @param {string} intent - Current CRE intent (e.g. 'SEARCH', 'CODE')
 * @returns {Array<{...entry, score, relevance}>} Sorted by score (highest first)
 */
export function rankForContext(entries, input, intent) {
  if (!entries || entries.length === 0) return [];

  const inputTokens = tokenize(input);
  const intentKey = (intent || '').toUpperCase();
  const affinityMap = INTENT_KIND_AFFINITY[intentKey] || {};
  const now = Date.now();

  const scored = entries.map(entry => {
    // 1. Keyword overlap (0.0–1.0)
    const valueStr = typeof entry.value === 'object'
      ? JSON.stringify(entry.value)
      : String(entry.value || '');
    const entryTokens = [...tokenize(entry.key), ...tokenize(valueStr)];
    const overlap = keywordOverlap(inputTokens, entryTokens);

    // 2. Intent-kind affinity (0.0–1.0)
    const affinity = affinityMap[entry.kind] ?? DEFAULT_AFFINITY;

    // 3. Recency bonus (0 or RECENCY_BONUS)
    const lastAccess = entry.lastAccessedAt || entry.lastUsed || 0;
    const recency = (now - lastAccess < RECENCY_WINDOW_MS) ? RECENCY_BONUS : 0;

    // Combined relevance: weighted sum, capped at 1.0
    // Weights: overlap=0.4, affinity=0.45, recency=0.15
    const relevance = Math.min(1.0,
      overlap * 0.4 +
      affinity * 0.45 +
      recency
    );

    // Final score = effectiveConfidence * relevance
    const effConf = entry.effectiveConfidence ?? entry.confidence ?? 0.5;
    const score = effConf * relevance;

    return { ...entry, score, relevance };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export default { rankForContext };
