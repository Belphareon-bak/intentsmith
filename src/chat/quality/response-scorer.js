// ═══════════════════════════════════════════════════════════════════════════════
// Response Scorer — Semantic Quality Scoring for Chat Responses
// ═══════════════════════════════════════════════════════════════════════════════
//
// v126: Deterministic semantic scoring that COMPLEMENTS QGv2.
// QGv2 handles structural/mechanical fixes. This module scores MEANING:
//   - Relevance: Does the response address the query?
//   - Completeness: Is the response thorough enough for the intent?
//   - Coherence: Is the response well-structured and readable?
//   - Intent Alignment: Does the response match expected format for the intent?
//   - Language Quality: Czech diacritics, no SK contamination
//
// Contract:
//   scoreResponse(response, context) → ResponseScore
//
// No LLM calls. Deterministic. ~0ms execution.
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 1: RELEVANCE (0–1)
// Does the response address the actual query?
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'je', 'jsou', 'byl', 'byla', 'bylo', 'být', 'bude', 'mít', 'má',
  'se', 'si', 'na', 've', 'do', 'za', 'po', 'od', 'ke', 'ze', 'při',
  'jak', 'co', 'to', 'ten', 'ta', 'ty', 'toto', 'tento', 'tato',
  'pro', 'ale', 'nebo', 'když', 'že', 'jako', 'tak', 'jen', 'které',
  'který', 'která', 'kteří', 'než', 'ani', 'již', 'ještě', 'již',
]);

function extractKeywords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreRelevance(response, query) {
  if (!response) return 0;

  const queryKw = new Set(extractKeywords(query || ''));
  if (queryKw.size === 0) return 0.5; // Can't measure — neutral

  const responseKw = extractKeywords(response);
  if (responseKw.length === 0) return 0;

  let hits = 0;
  for (const qk of queryKw) {
    // Stem-match: require prefix length ≥4 for fuzzy matching
    if (qk.length < 4) {
      // Short keywords: exact match only
      if (responseKw.some(rk => rk === qk)) hits++;
    } else {
      const prefix = qk.substring(0, Math.max(4, qk.length - 2));
      if (responseKw.some(rk => rk === qk || rk.startsWith(prefix))) {
        hits++;
      }
    }
  }

  return Math.min(1, hits / queryKw.size);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 2: COMPLETENESS (0–1)
// Is the response thorough enough for the intent type?
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_LENGTH_EXPECTATIONS = {
  SEARCH:         { min: 150, ideal: 500, max: 3000 },
  REPORT:         { min: 200, ideal: 800, max: 5000 },
  CODE:           { min: 50,  ideal: 300, max: 8000 },
  CODE_ANALYSIS:  { min: 100, ideal: 400, max: 5000 },
  DESIGN:         { min: 200, ideal: 600, max: 5000 },
  CREATIVE:       { min: 100, ideal: 400, max: 5000 },
  CONVERSATIONAL: { min: 20,  ideal: 150, max: 2000 },
  FACTUAL:        { min: 30,  ideal: 200, max: 2000 },
  LOCAL:          { min: 10,  ideal: 50,  max: 500 },
  BUILD:          { min: 100, ideal: 400, max: 5000 },
  PLAN:           { min: 100, ideal: 400, max: 5000 },
  FILE_EXPLAIN:   { min: 50,  ideal: 300, max: 3000 },
  SHELL:          { min: 20,  ideal: 100, max: 1000 },
};

const DEFAULT_LENGTH = { min: 20, ideal: 200, max: 3000 };

function scoreCompleteness(response, intent) {
  const len = (response || '').length;
  const expect = INTENT_LENGTH_EXPECTATIONS[intent] || DEFAULT_LENGTH;

  if (len < expect.min) return Math.max(0, len / expect.min * 0.5);
  if (len <= expect.ideal) return 0.5 + 0.5 * ((len - expect.min) / (expect.ideal - expect.min));
  if (len <= expect.max) return 1.0;
  // Over max — slight penalty for verbosity
  return Math.max(0.6, 1.0 - (len - expect.max) / (expect.max * 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 3: COHERENCE (0–1)
// Is the response well-structured and readable?
// ─────────────────────────────────────────────────────────────────────────────

function scoreCoherence(response) {
  if (!response || response.length < 10) return 0;

  let score = 0.5; // Baseline

  // Structure markers boost
  const hasHeadings = /^#{1,3}\s/m.test(response);
  const hasBullets = /^[\s]*[-*•]\s/m.test(response);
  const hasNumbered = /^[\s]*\d+[.)]\s/m.test(response);
  const hasCodeBlock = /```/.test(response);
  const hasParagraphs = response.split(/\n\n+/).length >= 2;

  const structureCount = [hasHeadings, hasBullets, hasNumbered, hasCodeBlock, hasParagraphs]
    .filter(Boolean).length;
  score += Math.min(0.3, structureCount * 0.1);

  // Sentence flow: reasonable sentence length distribution
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 5);
  if (sentences.length >= 2) {
    const avgLen = sentences.reduce((sum, s) => sum + s.trim().length, 0) / sentences.length;
    // Penalize if sentences are all very short (<20 chars avg) or very long (>200 chars avg)
    if (avgLen >= 20 && avgLen <= 200) score += 0.1;
    else if (avgLen < 10 || avgLen > 400) score -= 0.1;
  }

  // Repetition penalty: detect repeated phrases (>10 chars, appearing 3+ times)
  const phrases = response.match(/\b\w{4,}\s+\w{4,}\b/g) || [];
  const phraseCounts = {};
  for (const p of phrases) {
    const lp = p.toLowerCase();
    phraseCounts[lp] = (phraseCounts[lp] || 0) + 1;
  }
  const repeatedCount = Object.values(phraseCounts).filter(c => c >= 4).length;
  if (repeatedCount >= 3) score -= 0.15;

  return Math.max(0, Math.min(1, score));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 4: INTENT ALIGNMENT (0–1)
// Does the response match expected format for the intent?
// ─────────────────────────────────────────────────────────────────────────────

function scoreIntentAlignment(response, intent) {
  if (!response || !intent) return 0.5;
  const text = response;

  switch (intent) {
    case 'CODE':
    case 'CODE_ANALYSIS': {
      // Expect code blocks or code-like content
      const hasCode = /```/.test(text) || /\b(function|def|class|const|let|var|import|return)\b/.test(text);
      return hasCode ? 1.0 : 0.3;
    }
    case 'SEARCH': {
      // Expect URLs/sources
      const linkCount = (text.match(/https?:\/\/\S+/g) || []).length;
      if (linkCount >= 2) return 1.0;
      if (linkCount >= 1) return 0.7;
      return 0.3;
    }
    case 'REPORT': {
      // Expect structured content with sources
      const hasStructure = /^#{1,3}\s/m.test(text) || /^[\s]*[-*•]\s/m.test(text);
      const hasLinks = /https?:\/\/\S+/.test(text);
      return (hasStructure ? 0.5 : 0.2) + (hasLinks ? 0.3 : 0) + (text.length > 300 ? 0.2 : 0);
    }
    case 'CREATIVE': {
      // Creative responses: expect length and no URLs
      const noUrls = !(/(https?:\/\/\S+)/.test(text));
      return (text.length > 100 ? 0.5 : 0.2) + (noUrls ? 0.3 : 0.1) + 0.2;
    }
    case 'DESIGN': {
      // Expect structure and technical terms
      const hasStructure = /^#{1,3}\s/m.test(text) || /^[\s]*[-*•]\s/m.test(text) || /^[\s]*\d+[.)]\s/m.test(text);
      return hasStructure ? 1.0 : 0.5;
    }
    case 'FACTUAL':
    case 'LOCAL': {
      // Expect concise, direct answers
      const hasNumber = /\d/.test(text);
      return hasNumber ? 0.9 : 0.6;
    }
    case 'CONVERSATIONAL': {
      // Any reasonable response
      return text.length > 10 ? 0.8 : 0.4;
    }
    default:
      return 0.5;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension 5: LANGUAGE QUALITY (0–1)
// Czech diacritics presence, no SK contamination, no random language mixing
// ─────────────────────────────────────────────────────────────────────────────

// Core SK markers (subset from language-enforcement.js)
const SK_MARKER_PATTERNS = [
  /\bpotrebuj[eé]/i, /\bmôž[eě]/i, /\bpoužívať\b/i,
  /\bnejakú?\b/i, /\bpomôcť\b/i, /\bďalš/i,
  /\bstránk[auy]\b/i, /\bktorý?\b/i, /\bzdieľ/i,
  /\bobsahuj[eé]\b/i, /\bvyhľad/i, /\bprístupy?\b/i,
  /ô/i, /ľ/i, /ŕ/i, /ĺ/i,           // SK-only diacritics
  /\btiež\b/i, /\bveľ[akm]/i, /\btreba\b/i,
  /\bale\s+aj\b/i, /\bvšak\b/i,
];

function scoreLanguageQuality(response, targetLang) {
  if (!response || response.length < 20) return 0.5;
  if (targetLang === 'en') return 0.8; // English — less strict

  let score = 0.7; // Baseline

  // SK-only characters (ô, ľ, ŕ, ĺ) — definitive Slovak indicator
  const skOnlyChars = (response.match(/[ôľŕĺ]/gi) || []).length;
  if (skOnlyChars >= 2) {
    score -= 0.4;
  } else if (skOnlyChars >= 1) {
    score -= 0.2;
  }

  // Czech diacritics boost (only if no SK-only chars)
  if (skOnlyChars === 0) {
    const czechChars = (response.match(/[ěščřžýáíéúůďťň]/gi) || []).length;
    const totalChars = response.replace(/\s/g, '').length;
    const diacriticRatio = totalChars > 0 ? czechChars / totalChars : 0;

    if (diacriticRatio > 0.03) score += 0.2;      // Good Czech
    else if (diacriticRatio > 0.01) score += 0.1;  // Some Czech
    else score -= 0.2;                              // Missing diacritics
  }

  // SK contamination penalty (word-level patterns)
  let skMarkerCount = 0;
  for (const pat of SK_MARKER_PATTERNS) {
    if (pat.test(response)) skMarkerCount++;
  }
  if (skMarkerCount >= 5) score -= 0.4;
  else if (skMarkerCount >= 3) score -= 0.25;
  else if (skMarkerCount >= 1) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE SCORER
// ═══════════════════════════════════════════════════════════════════════════════

const DIMENSION_WEIGHTS = {
  relevance:      0.30,
  completeness:   0.20,
  coherence:      0.15,
  intentAlignment: 0.20,
  languageQuality: 0.15,
};

/**
 * Score a chat response on semantic quality.
 *
 * @param {string} response — The LLM-generated response text
 * @param {Object} context
 * @param {string} context.query — Original user query
 * @param {string} [context.intent] — CRE intent (CODE, SEARCH, CONVERSATIONAL, etc.)
 * @param {string} [context.lang='cs'] — Target language
 * @returns {ResponseScore}
 */
export function scoreResponse(response, context = {}) {
  const { query = '', intent = 'CONVERSATIONAL', lang = 'cs' } = context;

  const dimensions = {
    relevance:       scoreRelevance(response, query),
    completeness:    scoreCompleteness(response, intent),
    coherence:       scoreCoherence(response),
    intentAlignment: scoreIntentAlignment(response, intent),
    languageQuality: scoreLanguageQuality(response, lang),
  };

  // Weighted composite (0–100)
  let total = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    total += (dimensions[dim] ?? 0) * weight;
  }
  total = Math.round(total * 100);

  // Identify issues (dimensions below threshold)
  const issues = [];
  if (dimensions.relevance < 0.3)       issues.push('low_relevance');
  if (dimensions.completeness < 0.3)    issues.push('incomplete');
  if (dimensions.coherence < 0.3)       issues.push('incoherent');
  if (dimensions.intentAlignment < 0.3) issues.push('intent_mismatch');
  if (dimensions.languageQuality < 0.4) issues.push('language_issues');

  // Generate improvement hints for retry prompts
  const hints = [];
  if (dimensions.relevance < 0.4) {
    hints.push('Odpověz PŘÍMO na otázku uživatele. Neodbíhej od tématu.');
  }
  if (dimensions.completeness < 0.4) {
    const expect = INTENT_LENGTH_EXPECTATIONS[intent] || DEFAULT_LENGTH;
    hints.push(`Odpověď je příliš ${(response || '').length < expect.min ? 'krátká' : 'dlouhá'}. Poskytni ${intent === 'CODE' ? 'kompletní kód' : 'podrobnější informace'}.`);
  }
  if (dimensions.intentAlignment < 0.4) {
    if (intent === 'CODE') hints.push('Odpověď na CODE dotaz MUSÍ obsahovat kódový blok (```).');
    else if (intent === 'SEARCH') hints.push('SEARCH odpověď MUSÍ obsahovat URL odkazy na zdroje.');
    else if (intent === 'DESIGN') hints.push('DESIGN odpověď by měla mít strukturu (nadpisy, odrážky).');
  }
  if (dimensions.languageQuality < 0.4) {
    hints.push('Piš výhradně česky s korektní diakritikou. Nepoužívej slovenštinu.');
  }

  return {
    total,
    dimensions,
    issues,
    hints,
    threshold: {
      retry: 60,      // Score below this → fast retry
      refinement: 75,  // Score below this → self-refinement
      accept: 40,      // Score below this → degraded response warning
    },
  };
}

/**
 * Build a retry prompt injection based on score issues.
 * @param {ResponseScore} score
 * @returns {string} Retry instruction to append to synthesis prompt
 */
export function buildScoreRetryPrompt(score) {
  if (!score.hints || score.hints.length === 0) return '';

  return `\n\n═══════════════════════════════════════════════════════════════\n` +
    `⚠️ KVALITA ODPOVĚDI: ${score.total}/100 (pod prahem ${score.threshold.retry})\n` +
    score.hints.map(h => `• ${h}`).join('\n') + '\n' +
    `═══════════════════════════════════════════════════════════════`;
}

// Export individual scorers for testing
export {
  scoreRelevance,
  scoreCompleteness,
  scoreCoherence,
  scoreIntentAlignment,
  scoreLanguageQuality,
  extractKeywords,
  DIMENSION_WEIGHTS,
  INTENT_LENGTH_EXPECTATIONS,
};

export default { scoreResponse, buildScoreRetryPrompt };
