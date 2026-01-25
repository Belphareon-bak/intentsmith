// CRE v39.2 Correction Strategy
// ══════════════════════════════════════════════════════════════════════════════
//
// Determines how to correct failures based on analysis.
//
// Strategy Selection:
//   1. RETRY     — Try the same action again (transient errors)
//   2. BACKOFF   — Retry with increasing delay (rate limits)
//   3. FALLBACK  — Use alternative approach
//   4. REPLAN    — Generate a new plan
//   5. ASK_USER  — Request human assistance
//   6. SKIP      — Skip the failing step
//   7. FAIL      — Accept failure and stop
//
// Key Principle:
//   Apply the least disruptive correction that has a chance of success.
//
// ══════════════════════════════════════════════════════════════════════════════

import { FailureCategory, failureAnalyzer } from './failure-analyzer.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION ACTIONS
// ════════════════════════════════════════════════════════════════════════════

export const CorrectionAction = {
  RETRY: 'retry',           // Immediate retry
  BACKOFF: 'backoff',       // Retry with delay
  FALLBACK: 'fallback',     // Use alternative
  REPLAN: 'replan',         // Create new plan
  ASK_USER: 'ask_user',     // Human assistance
  SKIP: 'skip',             // Skip failing step
  FAIL: 'fail',             // Accept failure
};

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION RESULT
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} CorrectionResult
 * @property {string} action - CorrectionAction
 * @property {string} reason - Why this action was chosen
 * @property {number} delay - Delay before action (if applicable)
 * @property {Object} fallback - Fallback configuration (if applicable)
 * @property {Object} question - Question for user (if ASK_USER)
 * @property {number} confidence - Confidence in this correction (0-1)
 */

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION STRATEGY
// ════════════════════════════════════════════════════════════════════════════

export class CorrectionStrategy {
  constructor(options = {}) {
    this.analyzer = options.analyzer || failureAnalyzer;

    // Configuration
    this.maxRetries = options.maxRetries || 3;
    this.maxReplanAttempts = options.maxReplanAttempts || 2;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.initialBackoffMs = options.initialBackoffMs || 1000;

    // State tracking
    this.retryCounters = new Map();  // stepId → count
    this.replanCounters = new Map(); // goalId → count

    // Stats
    this.stats = {
      corrections: 0,
      byAction: {},
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STRATEGY SELECTION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Determine correction action for a failure
   *
   * @param {FailureRecord} failure - Analyzed failure from FailureAnalyzer
   * @param {Object} context - Current execution context
   * @returns {CorrectionResult}
   */
  correct(failure, context = {}) {
    const { category, analysis, suggestions } = failure;
    const { stepId, goalId, tool } = failure;

    // Get retry count for this step
    const retryKey = stepId || `${goalId}_${tool}`;
    const retryCount = this.retryCounters.get(retryKey) || 0;

    // Get replan count for this goal
    const replanCount = this.replanCounters.get(goalId) || 0;

    let result;

    // 1. Check if retryable and under limit
    if (analysis.isRetryable && retryCount < this.maxRetries) {
      result = this.retryStrategy(failure, retryCount, context);
    }
    // 2. Check for fallback availability
    else if (context.hasFallback) {
      result = this.fallbackStrategy(failure, context);
    }
    // 3. Check if replan is possible
    else if (this.canReplan(category) && replanCount < this.maxReplanAttempts) {
      result = this.replanStrategy(failure, replanCount, context);
    }
    // 4. Check if user can help
    else if (this.needsUserInput(category)) {
      result = this.askUserStrategy(failure, context, suggestions);
    }
    // 5. Check if step can be skipped
    else if (context.canSkip) {
      result = this.skipStrategy(failure, context);
    }
    // 6. Fail
    else {
      result = this.failStrategy(failure, context);
    }

    // Update counters
    if (result.action === CorrectionAction.RETRY || result.action === CorrectionAction.BACKOFF) {
      this.retryCounters.set(retryKey, retryCount + 1);
    } else if (result.action === CorrectionAction.REPLAN) {
      this.replanCounters.set(goalId, replanCount + 1);
    }

    // Update stats
    this.stats.corrections++;
    this.stats.byAction[result.action] = (this.stats.byAction[result.action] || 0) + 1;

    logger.debug('CorrectionStrategy', `Selected: ${result.action}`, {
      category,
      reason: result.reason,
      confidence: result.confidence,
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STRATEGIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Retry strategy
   */
  retryStrategy(failure, retryCount, context) {
    const { category, analysis } = failure;

    // Determine if we need backoff
    const needsBackoff = category === FailureCategory.RATE_LIMITED ||
                         category === FailureCategory.SERVICE_UNAVAILABLE ||
                         retryCount > 0;

    if (needsBackoff) {
      const delay = this.calculateBackoff(retryCount, analysis.retryDelay);
      return {
        action: CorrectionAction.BACKOFF,
        reason: `Retrying with ${delay}ms backoff (attempt ${retryCount + 1}/${this.maxRetries})`,
        delay,
        confidence: this.retryConfidence(category, retryCount),
      };
    }

    return {
      action: CorrectionAction.RETRY,
      reason: `Immediate retry (attempt ${retryCount + 1}/${this.maxRetries})`,
      delay: 0,
      confidence: this.retryConfidence(category, retryCount),
    };
  }

  /**
   * Fallback strategy
   */
  fallbackStrategy(failure, context) {
    return {
      action: CorrectionAction.FALLBACK,
      reason: 'Using fallback approach',
      fallback: context.fallbackConfig || {},
      confidence: 0.7,
    };
  }

  /**
   * Replan strategy
   */
  replanStrategy(failure, replanCount, context) {
    return {
      action: CorrectionAction.REPLAN,
      reason: `Generating new plan (attempt ${replanCount + 1}/${this.maxReplanAttempts})`,
      failedStepId: failure.stepId,
      failureContext: {
        category: failure.category,
        error: failure.error,
        suggestions: failure.suggestions,
      },
      confidence: 0.5,
    };
  }

  /**
   * Ask user strategy
   */
  askUserStrategy(failure, context, suggestions) {
    return {
      action: CorrectionAction.ASK_USER,
      reason: 'Requesting human assistance',
      question: {
        type: 'CORRECTION_NEEDED',
        message: this.buildUserQuestion(failure),
        context: {
          stepId: failure.stepId,
          error: failure.error,
          category: failure.category,
          suggestions,
        },
        options: this.buildUserOptions(failure, context),
      },
      confidence: 0.9,  // User input is highly reliable
    };
  }

  /**
   * Skip strategy
   */
  skipStrategy(failure, context) {
    return {
      action: CorrectionAction.SKIP,
      reason: `Skipping failed step: ${failure.stepId}`,
      skipReason: failure.error,
      confidence: 0.6,
    };
  }

  /**
   * Fail strategy
   */
  failStrategy(failure, context) {
    return {
      action: CorrectionAction.FAIL,
      reason: 'No viable correction available',
      error: failure.error,
      category: failure.category,
      confidence: 1.0,  // Certain we can't continue
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if category allows replanning
   */
  canReplan(category) {
    const replannable = [
      FailureCategory.INVALID_INPUT,
      FailureCategory.MISSING_INPUT,
      FailureCategory.NOT_FOUND,
      FailureCategory.PRECONDITION_FAILED,
    ];
    return replannable.includes(category);
  }

  /**
   * Check if category needs user input
   */
  needsUserInput(category) {
    const needsUser = [
      FailureCategory.PERMISSION_DENIED,
      FailureCategory.GATED,
      FailureCategory.CONFLICT,
    ];
    return needsUser.includes(category);
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateBackoff(retryCount, baseDelay = null) {
    const base = baseDelay || this.initialBackoffMs;
    const delay = base * Math.pow(this.backoffMultiplier, retryCount);
    // Cap at 5 minutes
    return Math.min(delay, 300000);
  }

  /**
   * Calculate retry confidence based on category and attempts
   */
  retryConfidence(category, retryCount) {
    // Base confidence by category
    const baseConfidence = {
      [FailureCategory.NETWORK_ERROR]: 0.8,
      [FailureCategory.SERVICE_UNAVAILABLE]: 0.7,
      [FailureCategory.RATE_LIMITED]: 0.9,
      [FailureCategory.TIMEOUT]: 0.6,
    };

    const base = baseConfidence[category] || 0.5;
    // Decrease confidence with each retry
    return base * Math.pow(0.8, retryCount);
  }

  /**
   * Build question for user
   */
  buildUserQuestion(failure) {
    const questions = {
      [FailureCategory.PERMISSION_DENIED]: `Permission denied for ${failure.tool || 'operation'}. How should I proceed?`,
      [FailureCategory.GATED]: `Action requires approval. Should I proceed?`,
      [FailureCategory.CONFLICT]: `Conflict detected: ${failure.error}. How should I resolve this?`,
    };

    return questions[failure.category] || `Step failed: ${failure.error}. What should I do?`;
  }

  /**
   * Build options for user
   */
  buildUserOptions(failure, context) {
    const options = [];

    if (this.analyzer.isRetryable(failure.category)) {
      options.push({ value: 'retry', label: 'Try again' });
    }
    if (context.hasFallback) {
      options.push({ value: 'fallback', label: 'Use alternative approach' });
    }
    if (context.canSkip) {
      options.push({ value: 'skip', label: 'Skip this step' });
    }
    options.push({ value: 'fail', label: 'Stop execution' });
    options.push({ value: 'custom', label: 'Provide guidance' });

    return options;
  }

  /**
   * Apply user's correction choice
   */
  applyUserChoice(choice, failure, context = {}) {
    switch (choice.value) {
      case 'retry':
        return { action: CorrectionAction.RETRY, delay: 0 };
      case 'fallback':
        return { action: CorrectionAction.FALLBACK, fallback: context.fallbackConfig };
      case 'skip':
        return { action: CorrectionAction.SKIP };
      case 'fail':
        return { action: CorrectionAction.FAIL };
      case 'custom':
        return { action: CorrectionAction.REPLAN, customGuidance: choice.guidance };
      default:
        return { action: CorrectionAction.FAIL };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESET & STATS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reset counters for a goal
   */
  resetGoal(goalId) {
    // Clear all retry counters for this goal
    for (const key of this.retryCounters.keys()) {
      if (key.startsWith(goalId)) {
        this.retryCounters.delete(key);
      }
    }
    this.replanCounters.delete(goalId);
  }

  /**
   * Reset all counters
   */
  reset() {
    this.retryCounters.clear();
    this.replanCounters.clear();
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      activeRetries: this.retryCounters.size,
      activeReplans: this.replanCounters.size,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const correctionStrategy = new CorrectionStrategy();

export default CorrectionStrategy;
