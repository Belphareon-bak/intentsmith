// CRE v39.2.1 Correction Strategy
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
// v39.2.1: FailureHistory
//   - Tracks correction attempts across goals
//   - Prevents correction loops ("this correction already failed 3× for this goal")
//   - Global learning from failures
//
// Key Principle:
//   Apply the least disruptive correction that has a chance of success.
//   Don't repeat corrections that have already failed.
//
// ══════════════════════════════════════════════════════════════════════════════

import { FailureCategory, failureAnalyzer } from './failure-analyzer.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// v39.2.1: FAILURE HISTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * FailureHistory — tracks correction outcomes across goals
 *
 * Prevents:
 *   - Correction loops (same correction failing repeatedly)
 *   - Unbounded retry storms
 *   - Repeated unsuccessful patterns
 */
export class FailureHistory {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 500;
    this.entries = [];

    // Pattern tracking: pattern → { attempts, successes, lastOutcome, lastSeen }
    this.patterns = new Map();

    // Goal-specific tracking: goalId → { pattern → attempts }
    this.goalPatterns = new Map();
  }

  /**
   * Record a correction attempt and its outcome
   */
  record(entry) {
    const {
      goalId,
      pattern,        // e.g., "NETWORK_ERROR:retry"
      action,         // CorrectionAction
      success,
      timestamp = Date.now(),
    } = entry;

    // Store entry
    this.entries.push({ goalId, pattern, action, success, timestamp });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Update pattern stats
    const patternKey = `${pattern}:${action}`;
    const stats = this.patterns.get(patternKey) || {
      attempts: 0,
      successes: 0,
      lastOutcome: null,
      lastSeen: null,
    };
    stats.attempts++;
    if (success) stats.successes++;
    stats.lastOutcome = success ? 'success' : 'failure';
    stats.lastSeen = timestamp;
    this.patterns.set(patternKey, stats);

    // Update goal-specific tracking
    if (!this.goalPatterns.has(goalId)) {
      this.goalPatterns.set(goalId, new Map());
    }
    const goalMap = this.goalPatterns.get(goalId);
    const goalAttempts = goalMap.get(patternKey) || { total: 0, failures: 0 };
    goalAttempts.total++;
    if (!success) goalAttempts.failures++;
    goalMap.set(patternKey, goalAttempts);
  }

  /**
   * Check if a correction has repeatedly failed for a goal
   *
   * @returns {{ blocked: boolean, reason?: string }}
   */
  shouldBlock(goalId, pattern, action, maxFailures = 3) {
    const patternKey = `${pattern}:${action}`;

    // Check goal-specific failures
    const goalMap = this.goalPatterns.get(goalId);
    if (goalMap) {
      const attempts = goalMap.get(patternKey);
      if (attempts && attempts.failures >= maxFailures) {
        return {
          blocked: true,
          reason: `Correction ${action} for ${pattern} has failed ${attempts.failures} times for this goal`,
        };
      }
    }

    // Check global pattern success rate
    const stats = this.patterns.get(patternKey);
    if (stats && stats.attempts >= 10) {
      const successRate = stats.successes / stats.attempts;
      if (successRate < 0.1) {
        return {
          blocked: true,
          reason: `Correction ${action} for ${pattern} has <10% success rate globally`,
        };
      }
    }

    return { blocked: false };
  }

  /**
   * Get success rate for a correction pattern
   */
  getSuccessRate(pattern, action) {
    const patternKey = `${pattern}:${action}`;
    const stats = this.patterns.get(patternKey);
    if (!stats || stats.attempts === 0) return null;
    return stats.successes / stats.attempts;
  }

  /**
   * Get correction history for a goal
   */
  getGoalHistory(goalId, limit = 20) {
    return this.entries
      .filter(e => e.goalId === goalId)
      .slice(-limit);
  }

  /**
   * Get patterns that are consistently failing
   */
  getFailingPatterns(minAttempts = 5, maxSuccessRate = 0.2) {
    const failing = [];
    for (const [patternKey, stats] of this.patterns) {
      if (stats.attempts >= minAttempts) {
        const rate = stats.successes / stats.attempts;
        if (rate <= maxSuccessRate) {
          failing.push({
            pattern: patternKey,
            attempts: stats.attempts,
            successRate: rate,
            lastOutcome: stats.lastOutcome,
          });
        }
      }
    }
    return failing.sort((a, b) => a.successRate - b.successRate);
  }

  /**
   * Clear history for a goal (after goal completes)
   */
  clearGoal(goalId) {
    this.goalPatterns.delete(goalId);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalEntries: this.entries.length,
      uniquePatterns: this.patterns.size,
      goalsTracked: this.goalPatterns.size,
      failingPatterns: this.getFailingPatterns().length,
    };
  }
}

// Global failure history instance
export const failureHistory = new FailureHistory();

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
    this.history = options.history || failureHistory;  // v39.2.1: Use failure history

    // Configuration
    this.maxRetries = options.maxRetries || 3;
    this.maxReplanAttempts = options.maxReplanAttempts || 2;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.initialBackoffMs = options.initialBackoffMs || 1000;
    this.maxCorrectionFailures = options.maxCorrectionFailures || 3;  // v39.2.1

    // State tracking
    this.retryCounters = new Map();  // stepId → count
    this.replanCounters = new Map(); // goalId → count

    // Stats
    this.stats = {
      corrections: 0,
      blocked: 0,  // v39.2.1: Corrections blocked by history
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

    // v39.2.1: Check failure history before attempting corrections
    const checkHistoryForAction = (action) => {
      if (!goalId) return { blocked: false };
      return this.history.shouldBlock(goalId, category, action, this.maxCorrectionFailures);
    };

    // 1. Check if retryable and under limit
    if (analysis.isRetryable && retryCount < this.maxRetries) {
      const historyCheck = checkHistoryForAction(CorrectionAction.RETRY);
      if (historyCheck.blocked) {
        logger.warn('CorrectionStrategy', `RETRY blocked by history: ${historyCheck.reason}`);
        this.stats.blocked++;
        // Skip to next strategy
      } else {
        result = this.retryStrategy(failure, retryCount, context);
      }
    }
    // 2. Check for fallback availability
    if (!result && context.hasFallback) {
      const historyCheck = checkHistoryForAction(CorrectionAction.FALLBACK);
      if (!historyCheck.blocked) {
        result = this.fallbackStrategy(failure, context);
      } else {
        this.stats.blocked++;
      }
    }
    // 3. Check if replan is possible
    if (!result && this.canReplan(category) && replanCount < this.maxReplanAttempts) {
      const historyCheck = checkHistoryForAction(CorrectionAction.REPLAN);
      if (!historyCheck.blocked) {
        result = this.replanStrategy(failure, replanCount, context);
      } else {
        this.stats.blocked++;
      }
    }
    // 4. Check if user can help
    if (!result && this.needsUserInput(category)) {
      result = this.askUserStrategy(failure, context, suggestions);
    }
    // 5. Check if step can be skipped
    if (!result && context.canSkip) {
      result = this.skipStrategy(failure, context);
    }
    // 6. Fail
    if (!result) {
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
  // v39.2.1: OUTCOME RECORDING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record the outcome of a correction attempt
   *
   * Call this after attempting a correction to track success/failure.
   * This enables learning: corrections that repeatedly fail will be blocked.
   *
   * @param {Object} outcome
   * @param {string} outcome.goalId - Goal ID
   * @param {string} outcome.category - Failure category (pattern)
   * @param {string} outcome.action - CorrectionAction that was attempted
   * @param {boolean} outcome.success - Whether the correction succeeded
   */
  recordOutcome(outcome) {
    const { goalId, category, action, success } = outcome;

    if (!goalId || !action) {
      logger.warn('CorrectionStrategy', 'recordOutcome called without goalId or action');
      return;
    }

    this.history.record({
      goalId,
      pattern: category || 'UNKNOWN',
      action,
      success,
      timestamp: Date.now(),
    });

    logger.debug('CorrectionStrategy', `Recorded outcome: ${action} ${success ? 'succeeded' : 'failed'}`, {
      goalId,
      category,
    });
  }

  /**
   * Get correction success rate for a goal
   *
   * @param {string} goalId
   * @returns {{ total: number, successful: number, rate: number }}
   */
  getGoalCorrectionStats(goalId) {
    const history = this.history.getGoalHistory(goalId);
    const successful = history.filter(e => e.success).length;
    return {
      total: history.length,
      successful,
      rate: history.length > 0 ? successful / history.length : null,
    };
  }

  /**
   * Check if a correction is recommended based on history
   *
   * @param {string} goalId
   * @param {string} category - Failure category
   * @param {string} action - CorrectionAction to check
   * @returns {{ recommended: boolean, successRate: number | null, reason: string }}
   */
  isCorrectionRecommended(goalId, category, action) {
    const blockCheck = this.history.shouldBlock(goalId, category, action, this.maxCorrectionFailures);
    if (blockCheck.blocked) {
      return {
        recommended: false,
        successRate: this.history.getSuccessRate(category, action),
        reason: blockCheck.reason,
      };
    }

    const rate = this.history.getSuccessRate(category, action);
    if (rate !== null && rate < 0.3) {
      return {
        recommended: false,
        successRate: rate,
        reason: `Low success rate: ${(rate * 100).toFixed(0)}%`,
      };
    }

    return {
      recommended: true,
      successRate: rate,
      reason: rate !== null ? `Success rate: ${(rate * 100).toFixed(0)}%` : 'No history',
    };
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

    // v39.2.1: Clear goal-specific history (preserves global pattern stats)
    this.history.clearGoal(goalId);
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
      // v39.2.1: Include history stats
      history: this.history.getStats(),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const correctionStrategy = new CorrectionStrategy();

export default CorrectionStrategy;
