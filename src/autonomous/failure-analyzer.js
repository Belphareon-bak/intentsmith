// CRE v39.2 Failure Analyzer
// ══════════════════════════════════════════════════════════════════════════════
//
// Analyzes failures and learns patterns for self-correction.
//
// v39.2: Self-Correction Layer
//   - Pattern recognition for common failures
//   - Root cause classification
//   - Correction suggestions
//   - Learning sink for future improvements
//
// Key Principle:
//   Learn from failures, don't just retry blindly.
//   Each failure is an opportunity to improve.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// FAILURE CATEGORIES
// ════════════════════════════════════════════════════════════════════════════

export const FailureCategory = {
  // Input Errors
  INVALID_INPUT: 'invalid_input',           // Bad parameters
  MISSING_INPUT: 'missing_input',           // Required data not provided
  MALFORMED_INPUT: 'malformed_input',       // Wrong format

  // External Errors
  NETWORK_ERROR: 'network_error',           // Connection/timeout issues
  SERVICE_UNAVAILABLE: 'service_unavailable', // External service down
  RATE_LIMITED: 'rate_limited',             // API rate limits

  // Permission Errors
  PERMISSION_DENIED: 'permission_denied',   // Auth/access issues
  GATED: 'gated',                           // Human gate blocked

  // Resource Errors
  NOT_FOUND: 'not_found',                   // Resource doesn't exist
  CONFLICT: 'conflict',                     // State conflict
  RESOURCE_EXHAUSTED: 'resource_exhausted', // Limits exceeded

  // Logic Errors
  PRECONDITION_FAILED: 'precondition_failed', // Dependencies not met
  ASSERTION_FAILED: 'assertion_failed',       // Logic error
  TIMEOUT: 'timeout',                         // Operation timed out

  // System Errors
  INTERNAL_ERROR: 'internal_error',         // Bug/crash
  UNKNOWN: 'unknown',                       // Unclassified
};

// ════════════════════════════════════════════════════════════════════════════
// ROOT CAUSE PATTERNS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Pattern matching rules for failure classification
 */
const FAILURE_PATTERNS = [
  // Network patterns
  { pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i, category: FailureCategory.NETWORK_ERROR },
  { pattern: /network|connection|socket/i, category: FailureCategory.NETWORK_ERROR },
  { pattern: /timeout|timed out/i, category: FailureCategory.TIMEOUT },

  // Rate limiting
  { pattern: /rate.?limit|429|too many requests/i, category: FailureCategory.RATE_LIMITED },
  { pattern: /quota exceeded|throttl/i, category: FailureCategory.RATE_LIMITED },

  // Permission
  { pattern: /permission|denied|forbidden|401|403/i, category: FailureCategory.PERMISSION_DENIED },
  { pattern: /auth|unauthorized|unauthenticated/i, category: FailureCategory.PERMISSION_DENIED },
  { pattern: /gated/i, category: FailureCategory.GATED },

  // Not found
  { pattern: /not.?found|404|does not exist|no such/i, category: FailureCategory.NOT_FOUND },
  { pattern: /missing|undefined|null/i, category: FailureCategory.MISSING_INPUT },

  // Input errors
  { pattern: /invalid|malformed|bad request|400/i, category: FailureCategory.INVALID_INPUT },
  { pattern: /parse|syntax|json|format/i, category: FailureCategory.MALFORMED_INPUT },
  { pattern: /required|must provide|missing parameter/i, category: FailureCategory.MISSING_INPUT },

  // Service errors
  { pattern: /service.?unavailable|503|502|500/i, category: FailureCategory.SERVICE_UNAVAILABLE },
  { pattern: /internal.?error|server.?error/i, category: FailureCategory.INTERNAL_ERROR },

  // Resource
  { pattern: /resource.?exhausted|out of memory|disk full/i, category: FailureCategory.RESOURCE_EXHAUSTED },
  { pattern: /conflict|already exists|duplicate/i, category: FailureCategory.CONFLICT },

  // Logic
  { pattern: /precondition|dependency|depends on/i, category: FailureCategory.PRECONDITION_FAILED },
  { pattern: /assert|expect|invariant/i, category: FailureCategory.ASSERTION_FAILED },
];

// ════════════════════════════════════════════════════════════════════════════
// FAILURE RECORD
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} FailureRecord
 * @property {string} id
 * @property {number} timestamp
 * @property {string} category - FailureCategory
 * @property {string} error - Error message
 * @property {Object} context - Failure context
 * @property {string} tool - Tool that failed (if any)
 * @property {string} stepId - Step that failed (if any)
 * @property {string} goalId - Goal context (if any)
 * @property {Object} analysis - Analysis results
 * @property {string[]} suggestions - Correction suggestions
 */

// ════════════════════════════════════════════════════════════════════════════
// FAILURE ANALYZER
// ════════════════════════════════════════════════════════════════════════════

export class FailureAnalyzer {
  constructor(options = {}) {
    // Failure history
    this.failures = [];
    this.maxFailures = options.maxFailures || 1000;

    // Pattern stats
    this.patternStats = new Map();  // category → { count, lastSeen, tools }

    // Learning sink (for v39.2+)
    this.learningSink = options.learningSink || null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ANALYSIS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Analyze a failure
   *
   * @param {string|Error} error - Error or error message
   * @param {Object} context - Failure context
   * @returns {FailureRecord}
   */
  analyze(error, context = {}) {
    const errorMessage = typeof error === 'string' ? error : error.message || String(error);

    // Classify the failure
    const category = this.classify(errorMessage);

    // Create failure record
    const record = {
      id: `failure_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      category,
      error: errorMessage,
      context,
      tool: context.tool || null,
      stepId: context.stepId || null,
      goalId: context.goalId || null,
      analysis: {
        patterns: this.findMatchingPatterns(errorMessage),
        severity: this.assessSeverity(category),
        isRetryable: this.isRetryable(category),
        retryDelay: this.suggestRetryDelay(category),
      },
      suggestions: this.generateSuggestions(category, context),
    };

    // Store failure
    this.failures.push(record);
    if (this.failures.length > this.maxFailures) {
      this.failures.shift();
    }

    // Update pattern stats
    this.updatePatternStats(record);

    // Send to learning sink
    if (this.learningSink) {
      this.sendToLearningSink(record);
    }

    logger.debug('FailureAnalyzer', `Analyzed failure: ${category}`, {
      error: errorMessage.slice(0, 100),
      suggestions: record.suggestions.length,
    });

    return record;
  }

  /**
   * Classify error into category
   */
  classify(errorMessage) {
    if (!errorMessage) return FailureCategory.UNKNOWN;

    for (const { pattern, category } of FAILURE_PATTERNS) {
      if (pattern.test(errorMessage)) {
        return category;
      }
    }

    return FailureCategory.UNKNOWN;
  }

  /**
   * Find all matching patterns
   */
  findMatchingPatterns(errorMessage) {
    return FAILURE_PATTERNS
      .filter(({ pattern }) => pattern.test(errorMessage))
      .map(({ category }) => category);
  }

  /**
   * Assess severity of failure category
   */
  assessSeverity(category) {
    const severityMap = {
      [FailureCategory.INVALID_INPUT]: 'low',
      [FailureCategory.MISSING_INPUT]: 'low',
      [FailureCategory.MALFORMED_INPUT]: 'low',
      [FailureCategory.NOT_FOUND]: 'medium',
      [FailureCategory.NETWORK_ERROR]: 'medium',
      [FailureCategory.TIMEOUT]: 'medium',
      [FailureCategory.RATE_LIMITED]: 'medium',
      [FailureCategory.SERVICE_UNAVAILABLE]: 'medium',
      [FailureCategory.PERMISSION_DENIED]: 'high',
      [FailureCategory.GATED]: 'high',
      [FailureCategory.RESOURCE_EXHAUSTED]: 'high',
      [FailureCategory.CONFLICT]: 'high',
      [FailureCategory.PRECONDITION_FAILED]: 'high',
      [FailureCategory.ASSERTION_FAILED]: 'critical',
      [FailureCategory.INTERNAL_ERROR]: 'critical',
      [FailureCategory.UNKNOWN]: 'medium',
    };

    return severityMap[category] || 'medium';
  }

  /**
   * Determine if failure is retryable
   */
  isRetryable(category) {
    const retryable = [
      FailureCategory.NETWORK_ERROR,
      FailureCategory.SERVICE_UNAVAILABLE,
      FailureCategory.RATE_LIMITED,
      FailureCategory.TIMEOUT,
    ];

    return retryable.includes(category);
  }

  /**
   * Suggest retry delay based on category
   */
  suggestRetryDelay(category) {
    const delays = {
      [FailureCategory.NETWORK_ERROR]: 2000,       // 2s
      [FailureCategory.SERVICE_UNAVAILABLE]: 5000, // 5s
      [FailureCategory.RATE_LIMITED]: 60000,       // 60s
      [FailureCategory.TIMEOUT]: 5000,             // 5s
    };

    return delays[category] || 1000;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUGGESTIONS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate correction suggestions
   */
  generateSuggestions(category, context) {
    const suggestions = [];

    switch (category) {
      case FailureCategory.INVALID_INPUT:
      case FailureCategory.MALFORMED_INPUT:
        suggestions.push('Validate input parameters before execution');
        suggestions.push('Check data format requirements');
        break;

      case FailureCategory.MISSING_INPUT:
        suggestions.push('Ensure all required parameters are provided');
        suggestions.push('Check for null/undefined values');
        break;

      case FailureCategory.NETWORK_ERROR:
      case FailureCategory.TIMEOUT:
        suggestions.push('Retry with exponential backoff');
        suggestions.push('Check network connectivity');
        suggestions.push('Consider increasing timeout');
        break;

      case FailureCategory.RATE_LIMITED:
        suggestions.push('Wait before retrying (rate limit backoff)');
        suggestions.push('Reduce request frequency');
        suggestions.push('Consider batching requests');
        break;

      case FailureCategory.SERVICE_UNAVAILABLE:
        suggestions.push('Retry after delay');
        suggestions.push('Check service status');
        suggestions.push('Consider fallback service');
        break;

      case FailureCategory.PERMISSION_DENIED:
        suggestions.push('Request user approval');
        suggestions.push('Check authentication credentials');
        suggestions.push('Verify access permissions');
        break;

      case FailureCategory.GATED:
        suggestions.push('Wait for user approval');
        suggestions.push('Provide justification for action');
        break;

      case FailureCategory.NOT_FOUND:
        suggestions.push('Verify resource exists before accessing');
        suggestions.push('Check path/URL correctness');
        suggestions.push('Handle missing resource gracefully');
        break;

      case FailureCategory.CONFLICT:
        suggestions.push('Check for existing resource');
        suggestions.push('Use update instead of create');
        suggestions.push('Handle concurrent modifications');
        break;

      case FailureCategory.RESOURCE_EXHAUSTED:
        suggestions.push('Release unused resources');
        suggestions.push('Reduce resource usage');
        suggestions.push('Request resource limit increase');
        break;

      case FailureCategory.PRECONDITION_FAILED:
        suggestions.push('Check and satisfy preconditions');
        suggestions.push('Ensure dependencies are met');
        suggestions.push('Reorder execution sequence');
        break;

      case FailureCategory.INTERNAL_ERROR:
      case FailureCategory.ASSERTION_FAILED:
        suggestions.push('Report bug for investigation');
        suggestions.push('Skip and continue if possible');
        suggestions.push('Fail gracefully');
        break;

      default:
        suggestions.push('Investigate error details');
        suggestions.push('Try alternative approach');
    }

    // Add context-specific suggestions
    if (context.tool) {
      suggestions.push(`Review ${context.tool} tool documentation`);
    }

    return suggestions;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PATTERN LEARNING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Update pattern statistics
   */
  updatePatternStats(record) {
    const stats = this.patternStats.get(record.category) || {
      count: 0,
      lastSeen: 0,
      tools: new Set(),
      errors: [],
    };

    stats.count++;
    stats.lastSeen = record.timestamp;
    if (record.tool) stats.tools.add(record.tool);
    stats.errors.push(record.error.slice(0, 100));
    if (stats.errors.length > 10) stats.errors.shift();

    this.patternStats.set(record.category, stats);
  }

  /**
   * Get frequently failing categories
   */
  getFrequentFailures(limit = 5) {
    return Array.from(this.patternStats.entries())
      .map(([category, stats]) => ({
        category,
        count: stats.count,
        lastSeen: stats.lastSeen,
        tools: Array.from(stats.tools),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get failure trends for a tool
   */
  getToolFailures(tool) {
    return this.failures.filter(f => f.tool === tool);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LEARNING SINK
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Send failure data to learning sink
   */
  sendToLearningSink(record) {
    if (!this.learningSink) return;

    try {
      this.learningSink.ingest({
        type: 'failure',
        category: record.category,
        tool: record.tool,
        error: record.error,
        suggestions: record.suggestions,
        timestamp: record.timestamp,
      });
    } catch (e) {
      logger.error('FailureAnalyzer', 'Learning sink error', { error: e.message });
    }
  }

  /**
   * Set learning sink
   */
  setLearningSink(sink) {
    this.learningSink = sink;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get recent failures
   */
  getRecent(limit = 20) {
    return this.failures.slice(-limit);
  }

  /**
   * Get failures by category
   */
  getByCategory(category) {
    return this.failures.filter(f => f.category === category);
  }

  /**
   * Get failures by goal
   */
  getByGoal(goalId) {
    return this.failures.filter(f => f.goalId === goalId);
  }

  /**
   * Get stats
   */
  getStats() {
    const byCategory = {};
    for (const failure of this.failures) {
      byCategory[failure.category] = (byCategory[failure.category] || 0) + 1;
    }

    return {
      totalFailures: this.failures.length,
      byCategory,
      frequentFailures: this.getFrequentFailures(),
      retryableCount: this.failures.filter(f => f.analysis.isRetryable).length,
    };
  }

  /**
   * Clear failures
   */
  clear() {
    const count = this.failures.length;
    this.failures = [];
    this.patternStats.clear();
    return { success: true, cleared: count };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const failureAnalyzer = new FailureAnalyzer();

export default FailureAnalyzer;
