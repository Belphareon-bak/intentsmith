// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Expertise Discovery v91 (D5)
// ══════════════════════════════════════════════════════════════════════════════
//
// Scoped vocabulary matching within a specialist's expertise collection.
// Reuses stemming + scoring primitives from auto-select.js.
//
// Unlike global auto-select (which picks from ALL expertises), discovery
// operates only on the specialist's bound expertises — with label priority
// boost and multi-match support for complex queries.
//
// Pure function, no side effects, <1ms per call.
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  czStem,
  stemMatch,
  BOOST_PATTERNS,
  SCORE_CONSTANTS,
} from './auto-select.js';

const {
  BOOST_WEIGHT,
  MULTI_WORD_WEIGHT,
  SINGLE_WORD_WEIGHT,
  THRESHOLD,
  MAX_PLAUSIBLE_SCORE,
} = SCORE_CONSTANTS;

// Label match adds a priority boost (labeled = "favorite" expertise)
const LABEL_BOOST = 2;
// Second match must be at least this ratio of the best to qualify for multi-match
const MULTI_MATCH_RATIO = 0.6;
// Maximum expertises returned in multi-match
const MAX_MULTI_MATCH = 3;

/**
 * Discover relevant expertise(s) from a specialist's collection for a given query.
 *
 * @param {string} input — Raw user message
 * @param {Array<Object>} expertises — Specialist's expertise collection
 *   Each entry: { id, modules: { vocabulary }, label?, priority? }
 *   (ExpertiseAgent objects or plain JSON with at least modules.vocabulary)
 * @param {Object} [options]
 * @param {boolean} [options.allowMultiMatch=true] — Allow returning 2-3 matches for complex queries
 * @returns {{
 *   matched: Array<Object>,   — Matched expertise objects (0-3)
 *   gap: boolean,             — True if no expertise matched (score < threshold)
 *   scores: Object,           — Per-expertise scores { expertiseId: number }
 *   reason: string,           — Human-readable reason
 * }}
 */
export function discoverExpertises(input, expertises, options = {}) {
  const { allowMultiMatch = true } = options;

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return { matched: [], gap: true, scores: {}, reason: 'empty input' };
  }

  if (!expertises || expertises.length === 0) {
    return { matched: [], gap: true, scores: {}, reason: 'empty collection' };
  }

  const lower = input.toLowerCase();
  const scores = {};
  const expertiseMap = {};

  // ── Precompute shared terms within THIS collection (not global) ──
  const termCount = new Map();
  for (const exp of expertises) {
    const vocab = exp.modules?.vocabulary || [];
    for (const term of vocab) {
      const tl = term.toLowerCase();
      termCount.set(tl, (termCount.get(tl) || 0) + 1);
    }
  }
  const sharedTerms = new Set();
  for (const [term, count] of termCount) {
    if (count >= 2) sharedTerms.add(term);
  }

  // ── Score each expertise ──
  for (const exp of expertises) {
    const id = exp.id;
    expertiseMap[id] = exp;
    const vocab = exp.modules?.vocabulary || [];
    let vocabScore = 0;

    // Tier 1: Vocabulary overlap (with Czech stem matching)
    for (const term of vocab) {
      const termLower = term.toLowerCase();
      if (stemMatch(lower, termLower)) {
        const isMultiWord = termLower.includes(' ');
        const isShared = sharedTerms.has(termLower);
        const baseWeight = isMultiWord ? MULTI_WORD_WEIGHT : SINGLE_WORD_WEIGHT;
        const sharedPenalty = isShared ? 0.5 : 1;
        vocabScore += baseWeight * sharedPenalty;
      }
    }

    // Tier 2: Boost patterns (built-in only)
    let boostScore = 0;
    const patterns = BOOST_PATTERNS[id] || [];
    for (const p of patterns) {
      if (p.test(input)) {
        boostScore += BOOST_WEIGHT;
        break;
      }
    }

    // Label boost: labeled expertises get priority
    const labelBoost = exp.label ? LABEL_BOOST : 0;

    const rawScore = vocabScore + boostScore + labelBoost;
    scores[id] = rawScore;
  }

  // ── Find matches above threshold ──
  const candidates = Object.entries(scores)
    .filter(([, score]) => score >= THRESHOLD)
    .sort((a, b) => {
      // Sort by score desc, then by priority desc (tie-breaker)
      if (b[1] !== a[1]) return b[1] - a[1];
      const priA = expertiseMap[a[0]]?.priority || 0;
      const priB = expertiseMap[b[0]]?.priority || 0;
      return priB - priA;
    });

  // No matches → gap
  if (candidates.length === 0) {
    return {
      matched: [],
      gap: true,
      scores,
      reason: 'no expertise above threshold',
    };
  }

  const bestId = candidates[0][0];
  const bestScore = candidates[0][1];

  // Single match (or multi-match disabled)
  if (candidates.length === 1 || !allowMultiMatch) {
    return {
      matched: [expertiseMap[bestId]],
      gap: false,
      scores,
      reason: `best match: ${bestId} (score: ${bestScore})`,
    };
  }

  // Multi-match: include candidates within MULTI_MATCH_RATIO of best
  const multiMatched = [expertiseMap[bestId]];
  for (let i = 1; i < candidates.length && multiMatched.length < MAX_MULTI_MATCH; i++) {
    const [id, score] = candidates[i];
    if (score >= bestScore * MULTI_MATCH_RATIO) {
      multiMatched.push(expertiseMap[id]);
    }
  }

  if (multiMatched.length === 1) {
    return {
      matched: multiMatched,
      gap: false,
      scores,
      reason: `best match: ${bestId} (score: ${bestScore})`,
    };
  }

  return {
    matched: multiMatched,
    gap: false,
    scores,
    reason: `multi-match: ${multiMatched.map(e => e.id).join(', ')} (best: ${bestScore})`,
  };
}

/**
 * Extract the likely topic from user input that doesn't match any expertise.
 * Used for gap detection messages ("I don't have expertise on {topic}").
 *
 * Simple heuristic: take content words (exclude common Czech stop words).
 *
 * @param {string} input
 * @returns {string}
 */
export function extractGapTopic(input) {
  const STOP_WORDS = new Set([
    'a', 'i', 'o', 'v', 'na', 'do', 'se', 'z', 'k', 'je', 'to', 'co',
    'jak', 'mi', 'me', 'mne', 'si', 'ty', 'on', 'by', 'za', 'po', 'pro',
    'ale', 'tak', 'uz', 'že', 'jako', 'ten', 'ta', 'ti', 'te', 'jsem',
    'jsi', 'bych', 'bys', 'jsme', 'jste', 'jsou', 'byl', 'být', 'mám',
    'the', 'is', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'can', 'you',
    'me', 'my', 'with', 'this', 'that', 'what', 'how', 'help', 'pomoz',
    'pomuzes', 'pomůžeš', 'poradit', 'porad', 'poradíš', 'prosím', 'chtěl',
    'potřebuju', 'rád',
  ]);

  const words = input
    .replace(/[?!.,;:()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

  if (words.length === 0) return input.substring(0, 50);
  return words.slice(0, 4).join(' ');
}

// Export internals for testing
export const _testInternals = {
  LABEL_BOOST,
  MULTI_MATCH_RATIO,
  MAX_MULTI_MATCH,
  extractGapTopic,
};
