// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Automatic Expertise Selection v88
// ══════════════════════════════════════════════════════════════════════════════
//
// Deterministic, vocabulary-based expertise matcher. Runs <1ms per call.
// Replaces the default "no expertise → CONVERSATION" behavior.
//
// Algorithm:
//   Tier 1: Vocabulary overlap (from expertise.modules.vocabulary[])
//   Tier 2: Boost patterns (high-confidence domain indicators, built-in only)
//   Anti-flip-flop: hysteresis for previous auto-selected expertise
//
// Design constraints:
//   - No LLM calls — pure regex/string matching
//   - Runs BEFORE CRE — only sets expertise context, never overrides intent
//   - Manual selection always has priority (auto never activates when locked)
//   - Custom expertises: Tier 1 only (vocabulary), no boost patterns
//
// ══════════════════════════════════════════════════════════════════════════════

import { BUILTIN_EXPERTISES, expertiseRegistry } from './expertise-layer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2: Boost patterns — high-confidence domain indicators
// Each match adds +3 to raw score. Must be unambiguous for their domain.
// ─────────────────────────────────────────────────────────────────────────────
const BOOST_PATTERNS = {
  writer:       [/(?:napi[šs]|napsa[tl]?)\s+(?:mi\s+)?(?:povídk|příběh|knih|kapitol|esej)/i, /příběhov/i],
  dnd_master:   [/\b(?:NPC|D&?D|DnD|dungeon)\b/i, /kampan[ěí]/i, /\bencounter\b/i],
  songwriter:   [/\b(?:chorus|verse|hook)\b/i, /\brefrén/i, /\bslok/i, /text\s+písn/i],
  analyst:      [/srovn(?:ej|at|ání)/i, /pro\s*\/?\s*proti/i, /\bSWOT\b/i],
  trader:       [/\b(?:bazar|retail)\b/i, /\bmarž/i, /koupit.{0,20}prodat/i],
  accountant:   [/\b(?:OSVČ|DPH)\b/i, /\bdaňov/i, /\bpaušál/i, /základ\s+dan/i],
  lawyer:       [/paragraf/i, /judikatur/i, /§\s*\d/i, /zákon\s+č\./i, /právní\s+úprav/i],
  doctor:       [/\bsymptom/i, /\bterapie\b/i, /\bprevenc/i, /\bvyšetřen/i, /diagnóz/i],
  psychologist: [/\bemoce\b/i, /\bempati/i, /\bpsycholog/i, /validace\s+emoc/i],
  ai_expert:    [/\b(?:LLM|transformer|fine-?tuning|embedding|RAG)\b/i],
  developer:    [/\b(?:refactoring|design\s+pattern|test\s+coverage|clean\s+code)\b/i, /naprogramu/i],
  technician:   [/\bnefunguj/i, /\btroubleshoot/i, /krok(?:ový|em)\s+postup/i],
  car_enthusiast: [/\bpřevodovk/i, /\bojetin/i, /servisní\s+interval/i, /\bmotor(?!k)/i],
  biker:        [/\bmotork/i, /\bkubatur/i, /ochranné\s+vybaven/i],
  political_analyst: [/\bgeopoliti/i, /\blegislativ/i, /politick/i],
};

// ─────────────────────────────────────────────────────────────────────────────
// Precomputation: shared vocabulary terms (terms in 2+ expertises)
// Built once at module load for built-ins. Recomputed after custom additions.
// ─────────────────────────────────────────────────────────────────────────────
const _termCount = new Map(); // term → number of expertises containing it
const _sharedTerms = new Set(); // terms appearing in 2+ expertises

/**
 * Get all expertises (built-in + custom) for scoring.
 * Custom expertises are included with vocabulary only (no boost patterns).
 */
function _getAllExpertises() {
  const all = { ...BUILTIN_EXPERTISES };
  for (const expert of expertiseRegistry.getCustom()) {
    const json = expert.toJSON ? expert.toJSON() : expert;
    all[json.id] = json;
  }
  return all;
}

/**
 * Recompute shared terms across all expertises (built-in + custom).
 * Call after adding/removing custom expertises.
 */
export function recomputeSharedTerms() {
  _termCount.clear();
  _sharedTerms.clear();
  for (const exp of Object.values(_getAllExpertises())) {
    const vocab = exp.modules?.vocabulary || [];
    for (const term of vocab) {
      const lower = term.toLowerCase();
      _termCount.set(lower, (_termCount.get(lower) || 0) + 1);
    }
  }
  for (const [term, count] of _termCount) {
    if (count >= 2) _sharedTerms.add(term);
  }
}

// Initial computation at module load (built-ins only at this point)
recomputeSharedTerms();

// ─────────────────────────────────────────────────────────────────────────────
// Czech stem matching — handles inflection (kapitola→kapitolu, helma→helmu)
// JS \b treats Czech diacritics as non-word chars, so we use stem substring.
// ─────────────────────────────────────────────────────────────────────────────
const _CZ_VOWELS = /[aeiouyáéíóúýěů]{1,2}$/i;

function czStem(word) {
  if (word.length < 4) return word;
  const stem = word.replace(_CZ_VOWELS, '');
  return stem.length >= 3 ? stem : word;
}

function stemMatch(input, term) {
  if (input.includes(term)) return true;
  if (term.includes(' ')) return false; // Don't stem multi-word terms
  const stem = czStem(term);
  return stem.length >= 3 && stem !== term && input.includes(stem);
}

// Score constants
const BOOST_WEIGHT = 3;
const MULTI_WORD_WEIGHT = 2;
const SINGLE_WORD_WEIGHT = 1;
const SHARED_PENALTY = 0.5; // multiplier for terms in 2+ expertises
const THRESHOLD = 2.0;
const MAX_PLAUSIBLE_SCORE = 10;
const HYSTERESIS_RATIO = 0.8; // previous must be >= 80% of winner

/**
 * Automatically select the best-matching expertise for user input.
 *
 * @param {string} input — Raw user message
 * @param {Object} [options]
 * @param {string} [options.previousAutoExpertiseId] — Last auto-selected expertise ID (for anti-flip-flop)
 * @returns {{ expertiseId: string|null, confidence: number, scores: Object, reason: string }}
 */
export function autoSelectExpertise(input, options = {}) {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return { expertiseId: null, confidence: 0, scores: {}, reason: 'empty input' };
  }

  const lower = input.toLowerCase();
  const scores = {};
  const allExpertises = _getAllExpertises();

  // Score each expertise (built-in + custom)
  for (const [id, exp] of Object.entries(allExpertises)) {
    const vocab = exp.modules?.vocabulary || [];
    let vocabScore = 0;

    // Tier 1: Vocabulary overlap (with Czech stem matching)
    for (const term of vocab) {
      const termLower = term.toLowerCase();
      if (stemMatch(lower, termLower)) {
        const isMultiWord = termLower.includes(' ');
        const isShared = _sharedTerms.has(termLower);
        const baseWeight = isMultiWord ? MULTI_WORD_WEIGHT : SINGLE_WORD_WEIGHT;
        vocabScore += baseWeight * (isShared ? SHARED_PENALTY : 1);
      }
    }

    // Tier 2: Boost patterns (built-in only — custom expertises have no boost)
    let boostScore = 0;
    const patterns = BOOST_PATTERNS[id] || [];
    for (const p of patterns) {
      if (p.test(input)) {
        boostScore += BOOST_WEIGHT;
        break; // One boost is enough per expertise
      }
    }

    const rawScore = vocabScore + boostScore;
    scores[id] = rawScore;
  }

  // Find winner
  let winnerId = null;
  let winnerScore = 0;
  let tieDetected = false;

  for (const [id, score] of Object.entries(scores)) {
    if (score >= THRESHOLD) {
      if (score > winnerScore) {
        winnerId = id;
        winnerScore = score;
        tieDetected = false;
      } else if (score === winnerScore && winnerId !== null) {
        tieDetected = true;
      }
    }
  }

  // Tie → null (ambiguous, don't guess)
  if (tieDetected) {
    return {
      expertiseId: null,
      confidence: 0,
      scores,
      reason: `tie between candidates (score: ${winnerScore})`,
    };
  }

  // Below threshold → null
  if (!winnerId) {
    return {
      expertiseId: null,
      confidence: 0,
      scores,
      reason: 'no expertise above threshold',
    };
  }

  // Anti-flip-flop: prefer previous auto-selected if within hysteresis
  const { previousAutoExpertiseId } = options;
  if (previousAutoExpertiseId && previousAutoExpertiseId !== winnerId) {
    const prevScore = scores[previousAutoExpertiseId] || 0;
    if (prevScore >= HYSTERESIS_RATIO * winnerScore && prevScore >= THRESHOLD) {
      return {
        expertiseId: previousAutoExpertiseId,
        confidence: Math.min(prevScore / MAX_PLAUSIBLE_SCORE, 1.0),
        scores,
        reason: `hysteresis: ${previousAutoExpertiseId} preferred over ${winnerId} (${prevScore.toFixed(1)} >= ${(HYSTERESIS_RATIO * winnerScore).toFixed(1)})`,
      };
    }
  }

  return {
    expertiseId: winnerId,
    confidence: Math.min(winnerScore / MAX_PLAUSIBLE_SCORE, 1.0),
    scores,
    reason: `best match: ${winnerId} (score: ${winnerScore})`,
  };
}

// Export matching primitives for reuse (D5: expertise-discovery.js)
export { czStem, stemMatch, BOOST_PATTERNS };
export const SCORE_CONSTANTS = {
  BOOST_WEIGHT,
  MULTI_WORD_WEIGHT,
  SINGLE_WORD_WEIGHT,
  SHARED_PENALTY,
  THRESHOLD,
  MAX_PLAUSIBLE_SCORE,
};

// Export internals for testing
export const _testInternals = {
  BOOST_PATTERNS,
  _sharedTerms,
  THRESHOLD,
  HYSTERESIS_RATIO,
  _getAllExpertises,
};
