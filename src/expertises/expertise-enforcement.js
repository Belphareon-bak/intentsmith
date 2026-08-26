// C.3 v57.0 — Expertise Enforcement
// ══════════════════════════════════════════════════════════════════════════════
//
// Post-synthesis validation and retry logic for expert responses.
//
// CONTRACT:
//   Expert defines forbiddenPhrases → Enforcement checks them
//   If violated → Retry with violation context
//   If still violated → Return with warning
//
// This is the ENFORCE phase of expert lifecycle.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement Configuration
// ─────────────────────────────────────────────────────────────────────────────

const ENFORCEMENT_CONFIG = {
  maxRetries: 2,               // Max retry attempts on violation
  minResponseLength: 20,       // Minimum response length (characters)
  retryTemperatureDecay: 0.1,  // v63.2: Reduce temperature by this on each retry
  retryTopPDecay: 0.05,        // v63.2: Reduce top_p by this on each retry
};

// ─────────────────────────────────────────────────────────────────────────────
// Default Forbidden Phrases (applied to ALL experts)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FORBIDDEN_PHRASES = [
  /^(nevím|netuším)\.?$/i,                    // Just "I don't know" with nothing else
  /^to záleží\.?$/i,                           // Just "it depends" with nothing else
  /jako (velký )?jazykový model/i,             // "as a language model"
  /nemohu (vám )?pomoci s/i,                   // "I cannot help with" (should explain why)
];

// ─────────────────────────────────────────────────────────────────────────────
// Core Enforcement Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check response against forbidden phrases.
 *
 * @param {string} response - The response to check
 * @param {Array} forbiddenPhrases - Array of patterns (RegExp or string)
 * @returns {{ valid: boolean, violations: string[] }}
 */
export function checkForbiddenPhrases(response, forbiddenPhrases = []) {
  const violations = [];

  if (!response || typeof response !== 'string') {
    return { valid: false, violations: ['Response is empty or invalid'] };
  }

  // Combine default and expert-specific phrases
  const allPhrases = [...DEFAULT_FORBIDDEN_PHRASES, ...normalizePatterns(forbiddenPhrases)];

  for (const pattern of allPhrases) {
    if (pattern instanceof RegExp) {
      if (pattern.test(response)) {
        violations.push(`Matched pattern: ${pattern.source}`);
      }
    } else if (typeof pattern === 'string') {
      if (response.toLowerCase().includes(pattern.toLowerCase())) {
        violations.push(`Contains forbidden phrase: "${pattern}"`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Check response length against minimum requirement.
 *
 * @param {string} response
 * @param {number} minLength
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkResponseLength(response, minLength = ENFORCEMENT_CONFIG.minResponseLength) {
  if (!response) {
    return { valid: false, reason: 'Response is empty' };
  }

  const trimmed = response.trim();
  if (trimmed.length < minLength) {
    return {
      valid: false,
      reason: `Response too short (${trimmed.length} < ${minLength} chars)`,
    };
  }

  return { valid: true };
}

/**
 * Normalize forbidden phrase patterns.
 * Converts string patterns with regex syntax to RegExp objects.
 *
 * @param {Array} patterns
 * @returns {Array<RegExp|string>}
 */
function normalizePatterns(patterns) {
  if (!Array.isArray(patterns)) return [];

  return patterns.map(p => {
    // Already a RegExp
    if (p instanceof RegExp) return p;

    // String that looks like a regex pattern (starts and ends with /)
    if (typeof p === 'string' && p.startsWith('/') && p.includes('/', 1)) {
      try {
        const match = p.match(/^\/(.+)\/([gimsu]*)$/);
        if (match) {
          return new RegExp(match[1], match[2]);
        }
      } catch {
        // Invalid regex, keep as string
      }
    }

    // Plain string
    return p;
  }).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement Result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EnforcementResult
 * @property {boolean} passed - Whether enforcement passed
 * @property {string} response - The (possibly regenerated) response
 * @property {number} attempts - Number of generation attempts
 * @property {string[]} violations - Any violations found
 * @property {boolean} wasRetried - Whether response was regenerated
 * @property {string} [warning] - Warning message if enforcement failed but response was kept
 */

// ─────────────────────────────────────────────────────────────────────────────
// Expert Enforcer Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExpertiseEnforcer — Validates and potentially regenerates expert responses.
 *
 * @example
 *   const enforcer = new ExpertiseEnforcer(expert, regenerateFn);
 *   const result = await enforcer.enforce(response);
 *   if (!result.passed) {
 *     // Response had violations but was kept (with warning)
 *   }
 */
export class ExpertiseEnforcer {
  #expert;
  #regenerateFn;
  #maxRetries;
  #strictMode;
  #retryAudit;
  #executionTraceId;

  /**
   * @param {Object} expert - Expert instance with styleRules.forbiddenPhrases
   * @param {Function} regenerateFn - Async function to regenerate response
   *                                  Takes (prompt, violations, retryOptions) => Promise<string>
   *                                  retryOptions: { temperatureDecay, topPDecay, attempt, seed }
   * @param {Object} [options]
   * @param {number} [options.maxRetries] - Max retry attempts
   * @param {boolean} [options.strict] - v63.2: Strict mode — violations are hard failures (no fallback)
   * @param {string} [options.executionTraceId] - v63.3: Execution trace UUID (one per user turn)
   */
  constructor(expert, regenerateFn, options = {}) {
    this.#expert = expert;
    this.#regenerateFn = regenerateFn;
    const maxRetries = options.maxRetries ?? ENFORCEMENT_CONFIG.maxRetries;
    if (
      !Number.isSafeInteger(maxRetries)
      || maxRetries < 0
      || maxRetries > ENFORCEMENT_CONFIG.maxRetries
    ) {
      throw new RangeError('expertise-enforcer:max-retries-out-of-range');
    }
    this.#maxRetries = maxRetries;
    this.#strictMode = options.strict ?? false;
    this.#retryAudit = [];
    this.#executionTraceId = options.executionTraceId || null;
  }

  /**
   * Enforce expert rules on a response.
   *
   * @param {string} response - The response to validate
   * @param {string} originalPrompt - The original user prompt (for regeneration)
   * @returns {Promise<EnforcementResult>}
   */
  async enforce(response, originalPrompt) {
    let currentResponse = response;
    let attempts = 1;
    let allViolations = [];
    let wasRetried = false;

    // Get expert's forbidden phrases
    const forbiddenPhrases = this.#expert?.styleRules?.forbiddenPhrases || [];
    const minLength = this.#expert?.styleRules?.minResponseLength || ENFORCEMENT_CONFIG.minResponseLength;

    // Initial check
    let phraseCheck = checkForbiddenPhrases(currentResponse, forbiddenPhrases);
    let lengthCheck = checkResponseLength(currentResponse, minLength);

    // If passed, return immediately
    if (phraseCheck.valid && lengthCheck.valid) {
      return {
        passed: true,
        response: currentResponse,
        attempts: 1,
        violations: [],
        wasRetried: false,
      };
    }

    // Collect violations
    allViolations = [...phraseCheck.violations];
    if (!lengthCheck.valid) {
      allViolations.push(lengthCheck.reason);
    }

    logger.debug('ExpertiseEnforcer', 'Initial response violated rules', {
      expert: this.#expert?.id,
      violations: allViolations,
    });

    // v63.2: Reset retry audit trail
    // v63.3: Include executionTraceId + executionStep
    this.#retryAudit = [{
      attempt: 1,
      executionTraceId: this.#executionTraceId,
      executionStep: 'ENFORCER',
      violations: [...allViolations],
      timestamp: Date.now(),
    }];

    // Retry loop with temperature decay (v63.2)
    while (attempts <= this.#maxRetries && this.#regenerateFn) {
      attempts++;
      wasRetried = true;

      // v63.2: Compute retry modifiers — temperature decay + seed randomization
      const retryOptions = {
        temperatureDecay: ENFORCEMENT_CONFIG.retryTemperatureDecay * (attempts - 1),
        topPDecay: ENFORCEMENT_CONFIG.retryTopPDecay * (attempts - 1),
        attempt: attempts,
        seed: randomUUID(),
      };

      try {
        // Build retry prompt with violation context + stricter injection
        const retryPrompt = this.#buildRetryPrompt(originalPrompt, allViolations, attempts);

        // Regenerate with retry options
        currentResponse = await this.#regenerateFn(retryPrompt, allViolations, retryOptions);

        // Check again
        phraseCheck = checkForbiddenPhrases(currentResponse, forbiddenPhrases);
        lengthCheck = checkResponseLength(currentResponse, minLength);

        if (phraseCheck.valid && lengthCheck.valid) {
          logger.info('ExpertiseEnforcer', `Response passed on attempt ${attempts}`, {
            expert: this.#expert?.id,
          });

          // v63.2: Log successful retry to audit
          this.#retryAudit.push({
            attempt: attempts,
            executionTraceId: this.#executionTraceId,
            executionStep: 'ENFORCER',
            violations: [],
            passed: true,
            retryOptions,
            timestamp: Date.now(),
          });

          return {
            passed: true,
            response: currentResponse,
            attempts,
            violations: [],
            wasRetried: true,
            retryAudit: this.#retryAudit,
          };
        }

        // Update violations for next iteration
        allViolations = [...phraseCheck.violations];
        if (!lengthCheck.valid) {
          allViolations.push(lengthCheck.reason);
        }

        // v63.2: Log retry to audit
        this.#retryAudit.push({
          attempt: attempts,
          executionTraceId: this.#executionTraceId,
          executionStep: 'ENFORCER',
          violations: [...allViolations],
          retryOptions,
          timestamp: Date.now(),
        });

      } catch (err) {
        logger.error('ExpertiseEnforcer', `Regeneration failed: ${err.message}`);
        this.#retryAudit.push({
          attempt: attempts,
          executionTraceId: this.#executionTraceId,
          executionStep: 'ENFORCER',
          error: err.message,
          timestamp: Date.now(),
        });
        break;
      }
    }

    // All retries exhausted
    logger.warn('ExpertiseEnforcer', 'Enforcement failed after all retries', {
      expert: this.#expert?.id,
      attempts,
      violations: allViolations,
    });

    // v63.2: Strict mode — hard fail, do NOT return the response
    if (this.#strictMode) {
      return {
        passed: false,
        response: null,
        attempts,
        violations: allViolations,
        wasRetried,
        hardFail: true,
        retryAudit: this.#retryAudit,
        warning: `STRICT: Expert response failed enforcement after ${attempts} attempts. Response suppressed.`,
      };
    }

    return {
      passed: false,
      response: currentResponse,
      attempts,
      violations: allViolations,
      wasRetried,
      retryAudit: this.#retryAudit,
      warning: `Expert response had quality issues: ${allViolations.join(', ')}`,
    };
  }

  /**
   * Build a retry prompt that includes violation context.
   * @private
   */
  #buildRetryPrompt(originalPrompt, violations, attempt = 2) {
    const violationList = violations.map(v => `- ${v}`).join('\n');

    // v63.2: Escalating strictness on subsequent retries
    const strictness = attempt > 2
      ? '\nSTRIKTNĚ dodržuj VŠECHNA pravidla. Toto je POSLEDNÍ pokus.'
      : '';

    return `Previous response violated expert quality rules:
${violationList}
${strictness}
Please provide a new response that avoids these issues.

Original question: ${originalPrompt}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick check if a response passes expert rules (no retry).
 *
 * @param {string} response
 * @param {Object} expert
 * @returns {{ passed: boolean, violations: string[] }}
 */
export function quickCheck(response, expert) {
  const forbiddenPhrases = expert?.styleRules?.forbiddenPhrases || [];
  const minLength = expert?.styleRules?.minResponseLength || ENFORCEMENT_CONFIG.minResponseLength;

  const phraseCheck = checkForbiddenPhrases(response, forbiddenPhrases);
  const lengthCheck = checkResponseLength(response, minLength);

  const violations = [...phraseCheck.violations];
  if (!lengthCheck.valid) {
    violations.push(lengthCheck.reason);
  }

  return {
    passed: phraseCheck.valid && lengthCheck.valid,
    violations,
  };
}

/**
 * Create an enforcer for an expert.
 *
 * @param {Object} expert
 * @param {Function} regenerateFn
 * @returns {ExpertiseEnforcer}
 */
export function createEnforcer(expert, regenerateFn) {
  return new ExpertiseEnforcer(expert, regenerateFn);
}

export default {
  ExpertiseEnforcer,
  checkForbiddenPhrases,
  checkResponseLength,
  quickCheck,
  createEnforcer,
  ENFORCEMENT_CONFIG,
};
