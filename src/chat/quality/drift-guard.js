// CRE v45.0 KOLO 5.5 — Long-Form Drift Guard
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// After 15+ turns, guard against:
// - Repetition (saying the same thing)
// - Unnecessary expansion (growing without reason)
// - Template starts (robotic openings)
//
// PURPOSE:
// Anti-regression contract for long conversations.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Drift Guard Thresholds
// ─────────────────────────────────────────────────────────────────────────────

export const DRIFT_GUARD_TURN_THRESHOLD = 15;
export const REPETITION_SIMILARITY_THRESHOLD = 0.6; // 60% similar = repetition
export const EXPANSION_RATIO_THRESHOLD = 1.5; // 50% longer = expansion drift

// ─────────────────────────────────────────────────────────────────────────────
// Template Starts (Robotic Openings)
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_START_PATTERNS = [
  // Czech templates
  /^Ano,?\s+(zde|tady)\s+(je|jsou)/i,
  /^Samozřejmě,?\s/i,
  /^Jistě,?\s/i,
  /^Rozumím,?\s/i,
  /^Chápu,?\s/i,
  /^Děkuji za otázku/i,
  /^To je skvělá otázka/i,
  /^Výborná otázka/i,

  // English templates
  /^Yes,?\s+(here|this)\s+is/i,
  /^Of course,?\s/i,
  /^Certainly,?\s/i,
  /^Great question/i,
  /^That's a great question/i,
  /^I understand/i,
  /^Thank you for asking/i,

  // Generic AI templates
  /^Jako (AI|umělá inteligence)/i,
  /^As an AI/i,
  /^I'd be happy to/i,
  /^Rád(a)?\s+ti\s+(pomohu|odpovím)/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Repetition Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate simple similarity between two texts (Jaccard-like)
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @returns {number} Similarity score 0-1
 */
export function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  // Normalize and tokenize
  const normalize = (text) => text
    .toLowerCase()
    .replace(/[.,!?;:„""']/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Detect repetition in recent responses
 * @param {string} newResponse - New response to check
 * @param {string[]} recentResponses - Array of recent responses
 * @returns {Object} { isRepetition: boolean, similarity: number, matchIndex: number }
 */
export function detectRepetition(newResponse, recentResponses) {
  let maxSimilarity = 0;
  let matchIndex = -1;

  for (let i = 0; i < recentResponses.length; i++) {
    const similarity = calculateTextSimilarity(newResponse, recentResponses[i]);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      matchIndex = i;
    }
  }

  return {
    isRepetition: maxSimilarity >= REPETITION_SIMILARITY_THRESHOLD,
    similarity: maxSimilarity,
    matchIndex,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expansion Drift Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect if responses are growing without reason
 * @param {number[]} responseLengths - Array of response lengths
 * @returns {Object} { isDrifting: boolean, avgGrowthRatio: number }
 */
export function detectExpansionDrift(responseLengths) {
  if (responseLengths.length < 3) {
    return { isDrifting: false, avgGrowthRatio: 1.0 };
  }

  // Calculate growth ratios between consecutive responses
  const growthRatios = [];
  for (let i = 1; i < responseLengths.length; i++) {
    if (responseLengths[i - 1] > 0) {
      growthRatios.push(responseLengths[i] / responseLengths[i - 1]);
    }
  }

  if (growthRatios.length === 0) {
    return { isDrifting: false, avgGrowthRatio: 1.0 };
  }

  const avgGrowthRatio = growthRatios.reduce((a, b) => a + b, 0) / growthRatios.length;

  // Check if consistently growing
  const consistentlyGrowing = growthRatios.filter(r => r > 1.1).length >= growthRatios.length * 0.6;

  return {
    isDrifting: consistentlyGrowing && avgGrowthRatio >= EXPANSION_RATIO_THRESHOLD,
    avgGrowthRatio,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Start Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if response starts with a template phrase
 * @param {string} response - Response to check
 * @returns {Object} { hasTemplateStart: boolean, pattern: string | null }
 */
export function detectTemplateStart(response) {
  if (!response) return { hasTemplateStart: false, pattern: null };

  const trimmed = response.trim();

  for (const pattern of TEMPLATE_START_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        hasTemplateStart: true,
        pattern: pattern.source,
      };
    }
  }

  return { hasTemplateStart: false, pattern: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drift Guard Tracker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks conversation drift patterns
 */
export class DriftGuard {
  constructor() {
    this.turnCount = 0;
    this.recentResponses = [];
    this.responseLengths = [];
    this.templateStartCount = 0;
    this.repetitionCount = 0;
    this.maxRecentResponses = 5;
  }

  /**
   * Record a new response and check for drift
   * @param {string} response - New response
   * @returns {Object} Drift analysis
   */
  recordResponse(response) {
    this.turnCount++;
    const responseLength = response?.length || 0;

    // Track lengths
    this.responseLengths.push(responseLength);
    if (this.responseLengths.length > 10) {
      this.responseLengths.shift();
    }

    // Check for template start
    const templateCheck = detectTemplateStart(response);
    if (templateCheck.hasTemplateStart) {
      this.templateStartCount++;
    }

    // Check for repetition (only after enough history)
    let repetitionCheck = { isRepetition: false };
    if (this.recentResponses.length >= 2) {
      repetitionCheck = detectRepetition(response, this.recentResponses);
      if (repetitionCheck.isRepetition) {
        this.repetitionCount++;
      }
    }

    // Store response
    this.recentResponses.push(response);
    if (this.recentResponses.length > this.maxRecentResponses) {
      this.recentResponses.shift();
    }

    // Check expansion drift
    const expansionCheck = detectExpansionDrift(this.responseLengths);

    // Build analysis
    const analysis = {
      turnCount: this.turnCount,
      isLongForm: this.turnCount >= DRIFT_GUARD_TURN_THRESHOLD,
      templateStart: templateCheck,
      repetition: repetitionCheck,
      expansion: expansionCheck,
      warnings: [],
    };

    // Generate warnings for long-form conversations
    if (analysis.isLongForm) {
      if (templateCheck.hasTemplateStart) {
        analysis.warnings.push('TEMPLATE_START');
      }
      if (repetitionCheck.isRepetition) {
        analysis.warnings.push(`REPETITION: ${(repetitionCheck.similarity * 100).toFixed(0)}% similar to turn ${repetitionCheck.matchIndex + 1}`);
      }
      if (expansionCheck.isDrifting) {
        analysis.warnings.push(`EXPANSION_DRIFT: avg growth ${expansionCheck.avgGrowthRatio.toFixed(2)}x`);
      }
    }

    if (analysis.warnings.length > 0) {
      logger.warn('DriftGuard', 'Drift detected', {
        turn: this.turnCount,
        warnings: analysis.warnings,
      });
    }

    return analysis;
  }

  /**
   * Get synthesis instructions to prevent drift
   * @returns {string} Instructions
   */
  getDriftPreventionInstructions() {
    if (this.turnCount < DRIFT_GUARD_TURN_THRESHOLD) {
      return '';
    }

    const instructions = [];
    instructions.push(`DRIFT GUARD (turn ${this.turnCount}):`);

    // Template warning
    if (this.templateStartCount >= 3) {
      instructions.push('⚠️ Častý šablonový začátek. Začni přímo obsahem.');
    }

    // Repetition warning
    if (this.repetitionCount >= 2) {
      instructions.push('⚠️ Opakování obsahu. Přidej nové informace nebo uzavři téma.');
    }

    // Expansion warning
    const expansionCheck = detectExpansionDrift(this.responseLengths);
    if (expansionCheck.isDrifting) {
      instructions.push('⚠️ Odpovědi rostou. Drž se stručnosti, pokud uživatel nežádá víc.');
    }

    // General long-form guidance
    instructions.push('');
    instructions.push('DLOUHÁ KONVERZACE - dbej na:');
    instructions.push('- Přímý začátek (ne "Ano, zde je...")');
    instructions.push('- Nový obsah (ne opakování)');
    instructions.push('- Konzistentní délku');

    return instructions.join('\n');
  }

  /**
   * Get drift statistics
   * @returns {Object}
   */
  getStats() {
    return {
      turnCount: this.turnCount,
      templateStartCount: this.templateStartCount,
      repetitionCount: this.repetitionCount,
      avgResponseLength: this.responseLengths.length > 0
        ? this.responseLengths.reduce((a, b) => a + b, 0) / this.responseLengths.length
        : 0,
      isLongForm: this.turnCount >= DRIFT_GUARD_TURN_THRESHOLD,
    };
  }

  /**
   * Reset tracker
   */
  reset() {
    this.turnCount = 0;
    this.recentResponses = [];
    this.responseLengths = [];
    this.templateStartCount = 0;
    this.repetitionCount = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate response against drift patterns
 * @param {string} response - Response to validate
 * @param {Object} context - Context with turnCount, recentResponses, etc.
 * @returns {Object} { valid: boolean, violations: string[] }
 */
export function validateAgainstDrift(response, context = {}) {
  const { turnCount = 0, recentResponses = [] } = context;
  const violations = [];

  // Only enforce after threshold
  if (turnCount < DRIFT_GUARD_TURN_THRESHOLD) {
    return { valid: true, violations: [] };
  }

  // Check template start
  const templateCheck = detectTemplateStart(response);
  if (templateCheck.hasTemplateStart) {
    violations.push(`TEMPLATE_START: ${templateCheck.pattern}`);
  }

  // Check repetition
  if (recentResponses.length >= 2) {
    const repetitionCheck = detectRepetition(response, recentResponses);
    if (repetitionCheck.isRepetition) {
      violations.push(`REPETITION: ${(repetitionCheck.similarity * 100).toFixed(0)}%`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

export const driftGuard = new DriftGuard();

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
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
};
