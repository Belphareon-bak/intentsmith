// C3-Agent v55.2 — Search Metrics & Usefulness Tracking
// ══════════════════════════════════════════════════════════════════════════════
// Sprint 1.1: Track search quality end-to-end
//
// Tracks the full funnel:
//   query → provider_result → result_quality → reformulation? → degradation?
//
// NOT a persistence layer — aggregates in-memory for current session,
// exposes getMetrics() for logging/debug endpoint.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SEARCH RESULT QUALITY SCORING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Score a single search result for completeness.
 * Returns 0.0–1.0.
 *
 * @param {{title?: string, url?: string, snippet?: string}} result
 * @returns {number}
 */
export function scoreResult(result) {
  let score = 0;

  // Has title? (0.3)
  if (result.title && result.title.trim().length > 3) {
    score += 0.3;
  }

  // Has URL? (0.2)
  if (result.url && result.url.startsWith('http')) {
    score += 0.2;
  }

  // Has snippet? (0.5 — this is the most important for synthesis)
  if (result.snippet && result.snippet.trim().length > 0) {
    const snippetLen = result.snippet.trim().length;
    if (snippetLen >= 50) {
      score += 0.5;     // v56.2: Full snippet (was 80 — DDG often returns 50-80 char snippets)
    } else if (snippetLen >= 25) {
      score += 0.3;     // v56.2: Partial snippet (was 30)
    } else {
      score += 0.1;     // Tiny snippet — barely useful
    }
  }

  return Math.round(score * 100) / 100;
}

/**
 * Score an entire search result set.
 * Returns aggregate quality info.
 *
 * @param {Array<{title?: string, url?: string, snippet?: string}>} results
 * @param {string} query - Original query (for relevance check)
 * @returns {SearchQualityScore}
 */
export function scoreSearchResults(results, query) {
  if (!results || results.length === 0) {
    return {
      totalResults: 0,
      avgScore: 0,
      completeResults: 0,    // title + url + snippet(80+)
      partialResults: 0,     // missing snippet or short snippet
      emptySnippets: 0,      // no snippet at all
      queryRelevance: 0,     // how many results mention query terms
      grade: 'EMPTY',        // EMPTY | POOR | FAIR | GOOD
    };
  }

  const scores = results.map(r => scoreResult(r));
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  const completeResults = scores.filter(s => s >= 0.9).length;
  const partialResults = scores.filter(s => s >= 0.5 && s < 0.9).length;
  const emptySnippets = results.filter(r => !r.snippet || r.snippet.trim().length === 0).length;

  // Query relevance: how many results mention at least one query keyword?
  // Uses prefix matching (min 4 chars) to handle Czech declensions
  const queryWords = extractQueryKeywords(query);
  let relevantCount = 0;
  if (queryWords.length > 0) {
    for (const r of results) {
      const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
      if (queryWords.some(w => matchKeyword(w, text))) {
        relevantCount++;
      }
    }
  }
  const queryRelevance = results.length > 0
    ? Math.round((relevantCount / results.length) * 100) / 100
    : 0;

  // Grade
  let grade = 'POOR';
  if (completeResults >= 3 && (queryRelevance >= 0.3 || completeResults >= 4)) {
    grade = 'GOOD';
  } else if (completeResults >= 1 || (partialResults >= 2 && queryRelevance >= 0.2)) {
    grade = 'FAIR';
  }

  return {
    totalResults: results.length,
    avgScore: Math.round(avgScore * 100) / 100,
    completeResults,
    partialResults,
    emptySnippets,
    queryRelevance,
    grade,
  };
}

/**
 * Match a keyword against text with Czech declension tolerance.
 * For words ≥ 5 chars: match prefix (first 4+ chars).
 * For words < 5 chars: exact match.
 * @param {string} keyword - Keyword to find
 * @param {string} text - Text to search in (lowercase)
 * @returns {boolean}
 */
function matchKeyword(keyword, text) {
  // Short words: exact boundary match
  if (keyword.length < 5) {
    return new RegExp(`\\b${keyword}\\b`).test(text);
  }
  // Long words: prefix match (handles Czech declension suffixes)
  // Use at least 4 chars or 70% of word length, whichever is more
  const prefixLen = Math.max(4, Math.floor(keyword.length * 0.7));
  const prefix = keyword.substring(0, prefixLen);
  return text.includes(prefix);
}

/**
 * Extract meaningful keywords from query for relevance checking.
 * Strips Czech/English stopwords and short words.
 */
function extractQueryKeywords(query) {
  const STOP_WORDS = new Set([
    // Czech
    'a', 'i', 'o', 'v', 'k', 'z', 'na', 'do', 'se', 'je', 'to', 'si',
    'co', 'jak', 'kde', 'kdy', 'ten', 'ta', 'ty', 'pro', 'ale', 'že',
    'jsou', 'byl', 'být', 'jsem', 'jsi', 'jeho', 'její', 'mi', 'mě',
    'jako', 'nebo', 'ani', 'tak', 'jen', 'už', 'než', 'při', 'pod',
    'nad', 'mezi', 'před', 'po', 'za', 'od', 'bez', 'aby', 'když',
    'nejlepší', 'jaké', 'jaký', 'která', 'který', 'které',
    // CZ instructional
    'odpověz', 'řekni', 'napiš', 'vysvětli', 'popiš', 'uveď',
    'stručně', 'podrobně', 'detailně', 'krátce', 'jednoduše', 'přesně',
    'jednou', 'větou', 'česky', 'anglicky', 'prosím',
    // Slovak
    'čo', 'kto', 'ako', 'kde', 'kedy', 'prečo', 'nie', 'áno', 'alebo',
    'ale', 'keď', 'som', 'sme', 'ste', 'sú', 'bol', 'bola', 'boli',
    'jeho', 'jej', 'ich', 'povedz', 'odpovedz', 'stručne', 'podrobne',
    'slovensky', 'prosím',
    // German
    'der', 'die', 'das', 'ein', 'eine', 'ist', 'sind', 'war', 'hat',
    'und', 'oder', 'aber', 'nicht', 'von', 'mit', 'für', 'auf', 'aus',
    'bei', 'nach', 'über', 'wie', 'was', 'wer', 'wo', 'wann', 'warum',
    'antworte', 'erkläre', 'beschreibe', 'kurz', 'bitte', 'genau',
    // Polish
    'czy', 'nie', 'tak', 'ale', 'lub', 'jest', 'są', 'był', 'była',
    'dla', 'jak', 'kto', 'gdzie', 'kiedy', 'dlaczego', 'ile',
    'odpowiedz', 'napisz', 'krótko', 'proszę', 'wyjaśnij',
    // French
    'le', 'la', 'les', 'un', 'une', 'des', 'est', 'sont', 'être',
    'de', 'du', 'en', 'et', 'ou', 'qui', 'que', 'quoi', 'où', 'quand',
    'comment', 'pourquoi', 'combien', 'quel', 'quelle',
    'réponds', 'explique', 'brièvement',
    // Spanish
    'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'fue', 'ser',
    'de', 'del', 'en', 'por', 'con', 'que', 'qué', 'quién', 'dónde',
    'cuándo', 'cómo', 'cuánto', 'por qué',
    'responde', 'explica', 'brevemente', 'por favor',
    // English
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'of', 'in', 'to', 'for',
    'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into', 'through',
    'it', 'its', 'this', 'that', 'what', 'which', 'who', 'how', 'where',
    'when', 'why', 'best', 'top', 'most',
    'briefly', 'concisely', 'please', 'simply',
  ]);

  return query
    .toLowerCase()
    .replace(/[^\w\sáčďéěíňóřšťúůýž]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

// ════════════════════════════════════════════════════════════════════════════
// SCRAPE CONTENT QUALITY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Assess quality of scraped page content.
 * Detects: login walls, cookie popups, empty content, JS-only pages.
 *
 * @param {string} content - Extracted text content
 * @param {string} query - Original query (for relevance)
 * @returns {ScrapeQualityScore}
 */
export function scoreScrapeContent(content, query) {
  if (!content || content.trim().length === 0) {
    return { usable: false, reason: 'EMPTY_CONTENT', contentLength: 0, relevance: 0, grade: 'EMPTY' };
  }

  const trimmed = content.trim();
  const contentLength = trimmed.length;

  // Block detection patterns
  const BLOCK_PATTERNS = [
    { pattern: /enable\s+javascript/i, reason: 'JS_REQUIRED' },
    { pattern: /please\s+enable\s+cookies/i, reason: 'COOKIES_REQUIRED' },
    { pattern: /přihlásit\s+se|log\s*in\s+to\s+continue|sign\s+in\s+required/i, reason: 'LOGIN_WALL' },
    { pattern: /access\s+denied|403\s+forbidden/i, reason: 'ACCESS_DENIED' },
    { pattern: /captcha|verify\s+you\s+are\s+human|are\s+you\s+a\s+robot/i, reason: 'CAPTCHA' },
    { pattern: /subscribe\s+to\s+(read|continue|access)|paywall/i, reason: 'PAYWALL' },
    { pattern: /souhlas.*cookie|cookie.*consent|gdpr.*souhlas/i, reason: 'COOKIE_BANNER_ONLY' },
  ];

  for (const { pattern, reason } of BLOCK_PATTERNS) {
    // Only flag if content is SHORT and matches block pattern
    // (Long content may mention these in passing)
    if (contentLength < 500 && pattern.test(trimmed)) {
      return { usable: false, reason, contentLength, relevance: 0, grade: 'BLOCKED' };
    }
  }

  // Too short to be useful
  if (contentLength < 100) {
    return { usable: false, reason: 'TOO_SHORT', contentLength, relevance: 0, grade: 'EMPTY' };
  }

  // Relevance: does content contain query keywords?
  // Uses prefix matching for Czech declension handling
  const queryWords = extractQueryKeywords(query);
  let matchedWords = 0;
  const lower = trimmed.toLowerCase();
  for (const word of queryWords) {
    if (matchKeyword(word, lower)) matchedWords++;
  }
  const relevance = queryWords.length > 0
    ? Math.round((matchedWords / queryWords.length) * 100) / 100
    : 0.5; // No keywords → assume medium

  // Grade
  let grade = 'POOR';
  if (contentLength >= 300 && relevance >= 0.3) {
    grade = 'GOOD';
  } else if (contentLength >= 500) {
    grade = 'GOOD'; // Long content is useful even if relevance is unclear
  } else if (contentLength >= 150 || relevance >= 0.2) {
    grade = 'FAIR';
  }

  return {
    usable: true,
    reason: null,
    contentLength,
    relevance,
    grade,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// USEFULNESS TRACKER (session-scoped aggregation)
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SearchEvent
 * @property {string} query
 * @property {number} timestamp
 * @property {string} provider
 * @property {number} resultCount
 * @property {string} resultGrade - EMPTY | POOR | FAIR | GOOD
 * @property {string} outcome - SUCCESS | REFORMULATED | DEGRADED | NO_RESULTS
 * @property {number} latencyMs
 */

class SearchMetrics {
  constructor() {
    /** @type {SearchEvent[]} */
    this.events = [];
    this.maxEvents = 500; // Ring buffer
  }

  /**
   * Record a search event
   * @param {Partial<SearchEvent>} event
   */
  record(event) {
    const entry = {
      query: event.query || '',
      timestamp: Date.now(),
      provider: event.provider || 'unknown',
      resultCount: event.resultCount || 0,
      resultGrade: event.resultGrade || 'EMPTY',
      outcome: event.outcome || 'SUCCESS',
      latencyMs: event.latencyMs || 0,
    };

    this.events.push(entry);

    // Ring buffer
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    logger.info('SearchMetrics', `[${entry.outcome}] "${entry.query}" → ${entry.resultCount} results (${entry.resultGrade}) via ${entry.provider} in ${entry.latencyMs}ms`);
  }

  /**
   * Get aggregated metrics
   * @param {number} [windowMs] - Time window (default: last hour)
   * @returns {Object}
   */
  getMetrics(windowMs = 3600000) {
    const cutoff = Date.now() - windowMs;
    const recent = this.events.filter(e => e.timestamp >= cutoff);

    if (recent.length === 0) {
      return {
        totalSearches: 0,
        successRate: 0,
        avgLatencyMs: 0,
        gradeDistribution: {},
        outcomeDistribution: {},
        providerDistribution: {},
      };
    }

    const total = recent.length;
    const successes = recent.filter(e => e.outcome === 'SUCCESS').length;

    // Grade distribution
    const grades = {};
    for (const e of recent) {
      grades[e.resultGrade] = (grades[e.resultGrade] || 0) + 1;
    }

    // Outcome distribution
    const outcomes = {};
    for (const e of recent) {
      outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1;
    }

    // Provider distribution
    const providers = {};
    for (const e of recent) {
      providers[e.provider] = (providers[e.provider] || 0) + 1;
    }

    const avgLatency = Math.round(
      recent.reduce((sum, e) => sum + e.latencyMs, 0) / total
    );

    return {
      totalSearches: total,
      successRate: Math.round((successes / total) * 100) / 100,
      avgLatencyMs: avgLatency,
      gradeDistribution: grades,
      outcomeDistribution: outcomes,
      providerDistribution: providers,
    };
  }

  /**
   * Get recent events (for debug)
   * @param {number} n
   * @returns {SearchEvent[]}
   */
  getRecent(n = 10) {
    return this.events.slice(-n);
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.events = [];
  }
}

// Singleton
export const searchMetrics = new SearchMetrics();

export default {
  scoreResult,
  scoreSearchResults,
  scoreScrapeContent,
  searchMetrics,
};
