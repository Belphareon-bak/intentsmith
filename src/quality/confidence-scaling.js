// CRE v45.0 KOLO 5.3 — Answer Confidence Scaling
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Response sounds CONFIDENT when data is strong
// - Response sounds CAUTIOUS when data is weak
// - NO explicit disclaimers ("Nemohu si být jistý...")
// - Use natural hedging ("Dostupná data naznačují...")
//
// PURPOSE:
// Confidence level in answer should match evidence strength.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Levels
// ─────────────────────────────────────────────────────────────────────────────

export const ConfidenceLevel = {
  HIGH: 'high',         // Strong evidence, official sources
  MEDIUM: 'medium',     // Mixed evidence, media sources
  LOW: 'low',           // Weak evidence, community/unknown sources
  UNCERTAIN: 'uncertain', // Conflicting or no evidence
};

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate answer confidence based on filtered results
 * @param {Object} filteredResults - Output from relevance filter
 * @param {Array} annotatedResults - Results with _sourceTrust
 * @returns {Object} { level: ConfidenceLevel, score: number, factors: string[] }
 */
export function calculateAnswerConfidence(filteredResults, annotatedResults = []) {
  const factors = [];
  let score = 0.5; // Start neutral

  const { relevant, marginal, stats } = filteredResults;

  // Factor 1: Relevance quality
  if (stats.avgRelevantScore >= 0.8) {
    score += 0.2;
    factors.push('high_relevance');
  } else if (stats.avgRelevantScore >= 0.6) {
    score += 0.1;
    factors.push('good_relevance');
  } else if (stats.avgRelevantScore < 0.4) {
    score -= 0.2;
    factors.push('low_relevance');
  }

  // Factor 2: Number of relevant sources
  if (relevant.length >= 3) {
    score += 0.15;
    factors.push('multiple_sources');
  } else if (relevant.length === 0) {
    score -= 0.25;
    factors.push('no_relevant_sources');
  }

  // Factor 3: Source trust distribution
  const trustDistribution = {
    official: 0,
    media: 0,
    community: 0,
    unknown: 0,
  };

  for (const result of annotatedResults) {
    const trust = result._sourceTrust?.trust || 'unknown';
    trustDistribution[trust]++;
  }

  if (trustDistribution.official > 0) {
    score += 0.15;
    factors.push('has_official');
  }

  if (trustDistribution.unknown > trustDistribution.official + trustDistribution.media) {
    score -= 0.15;
    factors.push('mostly_unknown');
  }

  // Factor 4: Source agreement (if multiple sources say the same)
  // This would require semantic analysis - simplified check here
  if (relevant.length >= 2) {
    // Assume agreement if relevance scores are similar
    const scores = relevant.map(r => r._relevance?.score || 0);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;

    if (variance < 0.05) {
      score += 0.1;
      factors.push('consistent_sources');
    }
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  // Determine level
  let level;
  if (score >= 0.7) {
    level = ConfidenceLevel.HIGH;
  } else if (score >= 0.5) {
    level = ConfidenceLevel.MEDIUM;
  } else if (score >= 0.3) {
    level = ConfidenceLevel.LOW;
  } else {
    level = ConfidenceLevel.UNCERTAIN;
  }

  logger.debug('ConfidenceScaling', 'Confidence calculated', {
    level,
    score: score.toFixed(3),
    factors,
  });

  return { level, score, factors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hedging Phrases (Czech)
// ─────────────────────────────────────────────────────────────────────────────

// Forbidden explicit disclaimers
export const FORBIDDEN_DISCLAIMERS = [
  /nemohu si být jist[ýá]/i,
  /nejsem si jist[ýá]/i,
  /nevím (jistě|přesně)/i,
  /nemám dostatek informací/i,
  /není možné (říct|určit)/i,
  /omlouvám se/i,
  /jako (AI|umělá inteligence)/i,
  /moje znalosti/i,
  /my knowledge/i,
  /I cannot be (sure|certain)/i,
  /I don't have enough/i,
];

// Natural hedging phrases by confidence level
export const HEDGING_PHRASES = {
  [ConfidenceLevel.HIGH]: [
    // No hedging needed - state facts directly
    '', // Empty = direct statement
  ],
  [ConfidenceLevel.MEDIUM]: [
    'Podle dostupných zdrojů',
    'Na základě aktuálních dat',
    'Dostupné informace ukazují, že',
    'Z dostupných údajů vyplývá',
  ],
  [ConfidenceLevel.LOW]: [
    'Dostupná data naznačují',
    'Některé zdroje uvádějí',
    'Podle neověřených informací',
    'Pravděpodobně',
  ],
  [ConfidenceLevel.UNCERTAIN]: [
    'Informace k tomuto tématu jsou omezené',
    'Dostupné zdroje se liší',
    'Nelze jednoznačně potvrdit',
    'Data jsou neúplná, ale',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Instructions for Synthesis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get synthesis instructions for confidence scaling
 * @param {Object} confidenceInfo - Output from calculateAnswerConfidence
 * @returns {string} Instructions for synthesis prompt
 */
export function getConfidenceSynthesisInstructions(confidenceInfo) {
  const { level, factors } = confidenceInfo;

  const instructions = [];

  // Level-specific guidance
  switch (level) {
    case ConfidenceLevel.HIGH:
      instructions.push('JISTOTA: Vysoká. Formuluj přímo a sebevědomě.');
      instructions.push('Nepoužívej zbytečné hedging fráze.');
      break;

    case ConfidenceLevel.MEDIUM:
      instructions.push('JISTOTA: Střední. Použij přirozené uvedení zdroje.');
      instructions.push('Příklad: "Podle dostupných zdrojů..."');
      break;

    case ConfidenceLevel.LOW:
      instructions.push('JISTOTA: Nízká. Naznač nejistotu přirozeně.');
      instructions.push('Příklad: "Dostupná data naznačují..." nebo "Pravděpodobně..."');
      instructions.push('NIKDY nepiš "Nemohu si být jistý" nebo podobné disclaimery.');
      break;

    case ConfidenceLevel.UNCERTAIN:
      instructions.push('JISTOTA: Velmi nízká. Přiznej omezení dat.');
      instructions.push('Příklad: "Informace k tomuto tématu jsou omezené, ale..."');
      instructions.push('NIKDY nepiš explicitní omluvy nebo disclaimery o AI.');
      break;
  }

  // Add forbidden phrases reminder
  instructions.push('');
  instructions.push('ZAKÁZANÉ FRÁZE:');
  instructions.push('- "Nemohu si být jistý/á"');
  instructions.push('- "Jako AI..."');
  instructions.push('- "Omlouvám se..."');
  instructions.push('- "Nemám dostatek informací"');

  return instructions.join('\n');
}

/**
 * Select appropriate hedging phrase for confidence level
 * @param {ConfidenceLevel} level - Confidence level
 * @returns {string} Hedging phrase or empty string
 */
export function selectHedgingPhrase(level) {
  const phrases = HEDGING_PHRASES[level] || HEDGING_PHRASES[ConfidenceLevel.MEDIUM];

  // Filter out empty strings for HIGH confidence
  const nonEmpty = phrases.filter(p => p.length > 0);

  if (nonEmpty.length === 0) {
    return '';
  }

  // Select randomly from available phrases
  return nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation: Check Response for Forbidden Disclaimers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if response contains forbidden disclaimers
 * @param {string} response - Generated response text
 * @returns {Object} { valid: boolean, violations: string[] }
 */
export function validateConfidenceResponse(response) {
  const violations = [];

  for (const pattern of FORBIDDEN_DISCLAIMERS) {
    if (pattern.test(response)) {
      violations.push(pattern.source);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  ConfidenceLevel,
  calculateAnswerConfidence,
  FORBIDDEN_DISCLAIMERS,
  HEDGING_PHRASES,
  getConfidenceSynthesisInstructions,
  selectHedgingPhrase,
  validateConfidenceResponse,
};
