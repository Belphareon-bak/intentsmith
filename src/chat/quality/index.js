// CRE v45.0 KOLO 5 — Quality & Trust Contracts
// ══════════════════════════════════════════════════════════════════════════════
//
// K5.1: Relevance Filter - Filter off-topic data from tool results
// K5.2: Source Trust - Classify and weight sources by trustworthiness
// K5.3: Confidence Scaling - Match answer confidence to evidence strength
// K5.4: Creative Depth - Scale creative output depth independently of style
// K5.5: Drift Guard - Prevent regression in long conversations
//
// ══════════════════════════════════════════════════════════════════════════════

// K5.1: Relevance Filter
export {
  RelevanceLevel,
  RELEVANCE_THRESHOLD_IGNORE,
  RELEVANCE_THRESHOLD_FULL,
  extractQueryKeywords,
  calculateRelevanceScore,
  filterToolResults,
  getRelevanceSynthesisInstructions,
} from './relevance-filter.js';

// K5.2: Source Trust
export {
  SourceTrust,
  TRUST_WEIGHTS,
  extractDomain,
  classifySourceTrust,
  annotateWithTrust,
  sortByTrust,
  getTrustSynthesisInstructions,
  getCombinedQualityScore,
} from './source-trust.js';

// K5.3: Confidence Scaling
export {
  ConfidenceLevel,
  calculateAnswerConfidence,
  FORBIDDEN_DISCLAIMERS,
  HEDGING_PHRASES,
  getConfidenceSynthesisInstructions,
  selectHedgingPhrase,
  validateConfidenceResponse,
} from './confidence-scaling.js';

// K5.4: Creative Depth
export {
  CreativeDepth,
  CreativeTaskType,
  detectCreativeTaskType,
  CreativeDepthTracker,
  creativeDepthTracker,
  getCreativeDepthInstructions,
} from './creative-depth.js';

// K5.5: Drift Guard
export {
  DRIFT_GUARD_TURN_THRESHOLD,
  REPETITION_SIMILARITY_THRESHOLD,
  EXPANSION_RATIO_THRESHOLD,
  TEMPLATE_START_PATTERNS,
  calculateTextSimilarity,
  detectRepetition,
  detectExpansionDrift,
  detectTemplateStart,
  DriftGuard,
  driftGuard,
  validateAgainstDrift,
} from './drift-guard.js';

// ─────────────────────────────────────────────────────────────────────────────
// Combined Quality Pipeline
// ─────────────────────────────────────────────────────────────────────────────

import { filterToolResults, getRelevanceSynthesisInstructions } from './relevance-filter.js';
import { annotateWithTrust, sortByTrust, getTrustSynthesisInstructions } from './source-trust.js';
import { calculateAnswerConfidence, getConfidenceSynthesisInstructions } from './confidence-scaling.js';
import { driftGuard } from './drift-guard.js';

/**
 * Run full quality pipeline on tool results
 * @param {Array} toolResults - Raw tool results
 * @param {string} query - User query
 * @param {Object} options - Pipeline options
 * @returns {Object} { results, instructions, confidence }
 */
export function runQualityPipeline(toolResults, query, options = {}) {
  const { turnCount = 0 } = options;

  // 1. Annotate with trust
  const trustedResults = annotateWithTrust(toolResults);

  // 2. Filter by relevance
  const filtered = filterToolResults(trustedResults, query);

  // 3. Sort by combined quality (trust + relevance)
  const sortedRelevant = sortByTrust(filtered.relevant);
  const sortedMarginal = sortByTrust(filtered.marginal);

  // 4. Calculate confidence
  const allAnnotated = [...filtered.relevant, ...filtered.marginal];
  const confidence = calculateAnswerConfidence(filtered, allAnnotated);

  // 5. Build synthesis instructions
  const instructions = [];

  instructions.push('═══ QUALITY LAYER (KOLO 5) ═══');
  instructions.push('');

  // Relevance instructions
  instructions.push(getRelevanceSynthesisInstructions(filtered));
  instructions.push('');

  // Trust instructions
  instructions.push(getTrustSynthesisInstructions(allAnnotated));
  instructions.push('');

  // Confidence instructions
  instructions.push(getConfidenceSynthesisInstructions(confidence));

  // Drift guard (if long form)
  if (turnCount >= 15) {
    const driftInstructions = driftGuard.getDriftPreventionInstructions();
    if (driftInstructions) {
      instructions.push('');
      instructions.push(driftInstructions);
    }
  }

  return {
    results: {
      relevant: sortedRelevant,
      marginal: sortedMarginal,
      stats: filtered.stats,
    },
    instructions: instructions.join('\n'),
    confidence,
  };
}

export default {
  runQualityPipeline,
};
