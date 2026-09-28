// CRE v45.0 KOLO 5.1 — Relevance Filter Contract
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Each ToolResult gets relevanceScore (0-1)
// - < 0.3 → IGNORE (don't include in synthesis)
// - 0.3-0.6 → MARGINAL (mention briefly, low weight)
// - > 0.6 → FULL (use completely in synthesis)
//
// PURPOSE:
// LLM must NOT synthesize data that is off-topic.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Relevance Thresholds
// ─────────────────────────────────────────────────────────────────────────────

export const RelevanceLevel = {
  IGNORE: 'ignore',       // < 0.3
  MARGINAL: 'marginal',   // 0.3 - 0.6
  FULL: 'full',           // > 0.6
};

export const RELEVANCE_THRESHOLD_IGNORE = 0.3;
export const RELEVANCE_THRESHOLD_FULL = 0.6;

// ─────────────────────────────────────────────────────────────────────────────
// Off-Topic Patterns (always reduce relevance)
// ─────────────────────────────────────────────────────────────────────────────

const OFF_TOPIC_PATTERNS = [
  // Grammar/spelling corrections in non-grammar queries
  /by\s*js[i]?\s+(nebo|or)\s*bys/i,
  /správně\s+se\s+píše/i,
  /mělo\s+by\s+se\s+psát/i,
  /by\s*jsi\b/i,
  /\bbys\b.*\bby\s*jsi\b/i,
  /gramatick[áý]/i,

  // Ads and promotional content
  /sponzorovan[ýáé]/i,
  /reklama/i,
  /kupte\s+(si|teď)/i,
  /sleva\s+\d+%/i,

  // Cookie/privacy notices
  /cookie/i,
  /souhlas.*zpracování/i,
  /gdpr/i,

  // Navigation/menu items
  /přihlásit\s+se/i,
  /registrace/i,
  /nákupní\s+košík/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Topic Keywords Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract key terms from query for relevance matching
 * @param {string} query - User query
 * @returns {string[]} Key terms
 */
export function extractQueryKeywords(query) {
  // Remove common Czech/English stop words
  const stopWords = new Set([
    'co', 'je', 'jak', 'jaký', 'jaká', 'jaké', 'proč', 'kdy', 'kde', 'kdo',
    'a', 'i', 'nebo', 'ale', 'že', 'to', 'ten', 'ta', 'ty', 'on', 'ona',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'why',
    'when', 'where', 'who', 'which', 'this', 'that', 'and', 'or', 'but',
    'mi', 'mě', 'mně', 'ti', 'tě', 'tobě', 'mu', 'ho', 'jí', 'ji', 'nám',
    'vám', 'jim', 'ním', 'ní', 'nich', 'se', 'si',
  ]);

  const words = query
    .toLowerCase()
    .replace(/[?.!,;:„""']/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  return words;
}

// ─────────────────────────────────────────────────────────────────────────────
// Relevance Scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate relevance score for a tool result
 * @param {Object} toolResult - Tool result object
 * @param {string} toolResult.content - Content of the result
 * @param {string} toolResult.source - Source URL or identifier
 * @param {string} query - Original user query
 * @param {string} [topicHash] - Current topic identifier
 * @returns {Object} { score: number, level: RelevanceLevel, reasons: string[] }
 */
export function calculateRelevanceScore(toolResult, query, topicHash = null) {
  const content = toolResult.content || '';
  const source = toolResult.source || '';
  const contentLower = content.toLowerCase();

  let score = 0.5; // Start neutral
  const reasons = [];

  // Extract query keywords
  const keywords = extractQueryKeywords(query);

  // 1. Keyword matching (up to +0.3)
  let keywordMatches = 0;
  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) {
      keywordMatches++;
    }
  }

  if (keywords.length > 0) {
    const keywordRatio = keywordMatches / keywords.length;
    const keywordBoost = keywordRatio * 0.3;
    score += keywordBoost;

    if (keywordRatio >= 0.5) {
      reasons.push(`keyword_match: ${keywordMatches}/${keywords.length}`);
    }
  }

  // 2. Off-topic pattern detection (up to -0.6)
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(content)) {
      score -= 0.25;
      reasons.push(`off_topic_pattern: ${pattern.source.slice(0, 20)}`);
    }
  }

  // 3. Content length heuristic
  // Very short content is often navigation/noise
  if (content.length < 50) {
    score -= 0.15;
    reasons.push('too_short');
  } else if (content.length > 200) {
    score += 0.1;
    reasons.push('substantial_content');
  }

  // 4. Semantic coherence (basic check)
  // If content has many unrelated fragments, reduce score
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length > 5) {
    // Check if sentences share keywords with query
    let coherentSentences = 0;
    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      for (const keyword of keywords) {
        if (sentenceLower.includes(keyword)) {
          coherentSentences++;
          break;
        }
      }
    }
    const coherenceRatio = coherentSentences / sentences.length;
    if (coherenceRatio < 0.3) {
      score -= 0.15;
      reasons.push('low_coherence');
    }
  }

  // Clamp score to [0, 1]
  score = Math.max(0, Math.min(1, score));

  // Determine level
  let level;
  if (score < RELEVANCE_THRESHOLD_IGNORE) {
    level = RelevanceLevel.IGNORE;
  } else if (score < RELEVANCE_THRESHOLD_FULL) {
    level = RelevanceLevel.MARGINAL;
  } else {
    level = RelevanceLevel.FULL;
  }

  logger.debug('RelevanceFilter', 'Score calculated', {
    score: score.toFixed(3),
    level,
    reasons,
    queryKeywords: keywords.slice(0, 5),
    contentPreview: content.slice(0, 100),
  });

  return { score, level, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Results Filter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter and annotate tool results with relevance scores
 * @param {Array} toolResults - Array of tool results
 * @param {string} query - Original user query
 * @param {Object} [options] - Filter options
 * @returns {Object} { relevant: [], marginal: [], ignored: [], stats: {} }
 */
export function filterToolResults(toolResults, query, options = {}) {
  const { topicHash = null, includeIgnored = false } = options;

  const relevant = [];
  const marginal = [];
  const ignored = [];

  for (const result of toolResults) {
    const { score, level, reasons } = calculateRelevanceScore(result, query, topicHash);

    const annotatedResult = {
      ...result,
      _relevance: { score, level, reasons },
    };

    switch (level) {
      case RelevanceLevel.FULL:
        relevant.push(annotatedResult);
        break;
      case RelevanceLevel.MARGINAL:
        marginal.push(annotatedResult);
        break;
      case RelevanceLevel.IGNORE:
        if (includeIgnored) {
          ignored.push(annotatedResult);
        }
        break;
    }
  }

  // Sort by relevance score (highest first)
  relevant.sort((a, b) => b._relevance.score - a._relevance.score);
  marginal.sort((a, b) => b._relevance.score - a._relevance.score);

  const stats = {
    total: toolResults.length,
    relevant: relevant.length,
    marginal: marginal.length,
    ignored: toolResults.length - relevant.length - marginal.length,
    avgRelevantScore: relevant.length > 0
      ? relevant.reduce((sum, r) => sum + r._relevance.score, 0) / relevant.length
      : 0,
  };

  logger.debug('RelevanceFilter', 'Results filtered', stats);

  return { relevant, marginal, ignored, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis Instructions Based on Relevance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate synthesis instructions based on relevance levels
 * @param {Object} filteredResults - Output from filterToolResults
 * @returns {string} Instructions for synthesis prompt
 */
export function getRelevanceSynthesisInstructions(filteredResults) {
  const { relevant, marginal, stats } = filteredResults;

  const instructions = [];

  if (relevant.length === 0 && marginal.length === 0) {
    instructions.push('VAROVÁNÍ: Žádné relevantní zdroje nebyly nalezeny. Uveď to v odpovědi.');
    return instructions.join('\n');
  }

  if (relevant.length > 0) {
    instructions.push(`PRIMÁRNÍ ZDROJE (${relevant.length}): Plně využij pro odpověď.`);
  }

  if (marginal.length > 0) {
    instructions.push(`OKRAJOVÉ ZDROJE (${marginal.length}): Pouze krátce zmíň, pokud je to nutné.`);
  }

  if (stats.ignored > 0) {
    instructions.push(`IGNOROVANÉ: ${stats.ignored} zdrojů bylo vyřazeno pro nízkou relevanci.`);
  }

  // Add warning if average relevance is low
  if (stats.avgRelevantScore < 0.7) {
    instructions.push('UPOZORNĚNÍ: Průměrná relevance zdrojů je nižší. Formuluj opatrněji.');
  }

  return instructions.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  RelevanceLevel,
  RELEVANCE_THRESHOLD_IGNORE,
  RELEVANCE_THRESHOLD_FULL,
  extractQueryKeywords,
  calculateRelevanceScore,
  filterToolResults,
  getRelevanceSynthesisInstructions,
};
