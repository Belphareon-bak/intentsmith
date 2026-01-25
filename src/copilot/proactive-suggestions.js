// CRE v42.1 Proactive Mode — Suggestions Engine
// ══════════════════════════════════════════════════════════════════════════════
//
// Systém SMNÍ:
// - ✅ navrhnout další krok
// - ✅ upozornit na riziko
// - ✅ doporučit refactor / cleanup
//
// Systém NESMÍ:
// - ❌ auto-execution bez schválení
// - ❌ změny bez confidence > 0.8
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Suggestion types
 */
export const SuggestionType = Object.freeze({
  NEXT_STEP: 'NEXT_STEP',           // Suggest next logical step
  RISK_WARNING: 'RISK_WARNING',     // Warn about potential risk
  REFACTOR: 'REFACTOR',             // Recommend refactoring
  CLEANUP: 'CLEANUP',               // Recommend cleanup
  OPTIMIZATION: 'OPTIMIZATION',     // Performance/efficiency improvement
  BEST_PRACTICE: 'BEST_PRACTICE',   // Suggest best practice
  MISSING_TEST: 'MISSING_TEST',     // Missing test coverage
  DOCUMENTATION: 'DOCUMENTATION',   // Documentation improvement
});

/**
 * Suggestion priority levels
 */
export const SuggestionPriority = Object.freeze({
  CRITICAL: 'CRITICAL',   // Must address (security, data loss risk)
  HIGH: 'HIGH',           // Should address soon
  MEDIUM: 'MEDIUM',       // Worth considering
  LOW: 'LOW',             // Nice to have
  INFO: 'INFO',           // Informational only
});

/**
 * Suggestion action types
 */
export const SuggestionAction = Object.freeze({
  APPROVE: 'APPROVE',     // User approves suggestion
  DISMISS: 'DISMISS',     // User dismisses suggestion
  DEFER: 'DEFER',         // User defers for later
  MODIFY: 'MODIFY',       // User wants modified version
});

/**
 * Minimum confidence threshold for suggestions
 */
export const MIN_SUGGESTION_CONFIDENCE = 0.8;

/**
 * Maximum times to show same suggestion before auto-suppressing
 */
export const MAX_SUGGESTION_REPETITIONS = 3;

/**
 * Proactive Suggestion - A single suggestion from the system
 *
 * Includes noise prevention mechanisms:
 * - suppressionKey: prevents duplicate suggestions
 * - noveltyScore: tracks how many times similar suggestions were made
 */
export class ProactiveSuggestion {
  #id;
  #type;
  #priority;
  #title;
  #description;
  #rationale;
  #confidence;
  #createdAt;
  #expiresAt;
  #context;
  #actions;
  #userAction;
  #userActionAt;
  #relatedGoalId;
  #suppressionKey;
  #noveltyScore;

  /**
   * @param {Object} config
   * @param {string} config.type - SuggestionType
   * @param {string} config.priority - SuggestionPriority
   * @param {string} config.title - Short title
   * @param {string} config.description - Detailed description
   * @param {string} config.rationale - Why this is suggested
   * @param {number} config.confidence - Confidence score (0-1)
   * @param {Object} [config.context] - Additional context
   * @param {string[]} [config.actions] - Possible actions
   * @param {string} [config.relatedGoalId] - Related goal ID
   * @param {number} [config.expiresInMs] - Time until suggestion expires
   * @param {string} [config.suppressionKey] - Key for duplicate detection (auto-generated if not provided)
   */
  constructor(config) {
    const {
      type,
      priority,
      title,
      description,
      rationale,
      confidence,
      context = {},
      actions = [],
      relatedGoalId = null,
      expiresInMs = 3600000, // 1 hour default
      suppressionKey = null,
    } = config;

    // Validation
    if (!Object.values(SuggestionType).includes(type)) {
      throw new Error(`Invalid suggestion type: ${type}`);
    }

    if (!Object.values(SuggestionPriority).includes(priority)) {
      throw new Error(`Invalid suggestion priority: ${priority}`);
    }

    if (!title || typeof title !== 'string') {
      throw new Error('Suggestion requires title string');
    }

    if (!description || typeof description !== 'string') {
      throw new Error('Suggestion requires description string');
    }

    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }

    // CRITICAL: Enforce minimum confidence for non-info suggestions
    if (priority !== SuggestionPriority.INFO && confidence < MIN_SUGGESTION_CONFIDENCE) {
      throw new Error(
        `Suggestions with priority ${priority} require confidence >= ${MIN_SUGGESTION_CONFIDENCE}. ` +
        `Got: ${confidence}`
      );
    }

    this.#id = `sug_${crypto.randomUUID()}`;
    this.#type = type;
    this.#priority = priority;
    this.#title = title;
    this.#description = description;
    this.#rationale = rationale || '';
    this.#confidence = confidence;
    this.#createdAt = new Date().toISOString();
    this.#expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    this.#context = { ...context };
    this.#actions = [...actions];
    this.#userAction = null;
    this.#userActionAt = null;
    this.#relatedGoalId = relatedGoalId;

    // Noise prevention: suppressionKey for duplicate detection
    // Auto-generate from type + title if not provided
    this.#suppressionKey = suppressionKey || `${type}:${title}`;

    // Novelty score: starts at 1.0, decreases as similar suggestions are made
    // Managed by SuggestionEngine
    this.#noveltyScore = 1.0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id() { return this.#id; }
  get type() { return this.#type; }
  get priority() { return this.#priority; }
  get title() { return this.#title; }
  get description() { return this.#description; }
  get rationale() { return this.#rationale; }
  get confidence() { return this.#confidence; }
  get createdAt() { return this.#createdAt; }
  get expiresAt() { return this.#expiresAt; }
  get userAction() { return this.#userAction; }
  get userActionAt() { return this.#userActionAt; }
  get relatedGoalId() { return this.#relatedGoalId; }
  get suppressionKey() { return this.#suppressionKey; }
  get noveltyScore() { return this.#noveltyScore; }

  /**
   * Set novelty score (managed by SuggestionEngine)
   * @param {number} score - Novelty score (0-1), lower = less novel
   */
  setNoveltyScore(score) {
    if (score < 0 || score > 1) {
      throw new Error('Novelty score must be between 0 and 1');
    }
    this.#noveltyScore = score;
  }

  /**
   * Check if suggestion is still novel enough to show
   * @returns {boolean}
   */
  isNovel() {
    return this.#noveltyScore > 0;
  }

  /**
   * Check if suggestion has expired
   * @returns {boolean}
   */
  isExpired() {
    return new Date() > new Date(this.#expiresAt);
  }

  /**
   * Check if suggestion is pending (no user action yet)
   * @returns {boolean}
   */
  isPending() {
    return this.#userAction === null && !this.isExpired();
  }

  /**
   * Check if suggestion was approved
   * @returns {boolean}
   */
  isApproved() {
    return this.#userAction === SuggestionAction.APPROVE;
  }

  /**
   * Check if suggestion was dismissed
   * @returns {boolean}
   */
  isDismissed() {
    return this.#userAction === SuggestionAction.DISMISS;
  }

  /**
   * Get context
   * @returns {Object}
   */
  getContext() {
    return { ...this.#context };
  }

  /**
   * Get available actions
   * @returns {string[]}
   */
  getActions() {
    return [...this.#actions];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // User Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Record user action on this suggestion
   * @param {string} action - SuggestionAction
   * @param {Object} [details] - Additional details
   * @returns {ProactiveSuggestion} this for chaining
   */
  recordAction(action, details = {}) {
    if (!Object.values(SuggestionAction).includes(action)) {
      throw new Error(`Invalid suggestion action: ${action}`);
    }

    if (this.#userAction !== null) {
      throw new Error('User action already recorded');
    }

    this.#userAction = action;
    this.#userActionAt = new Date().toISOString();

    if (Object.keys(details).length > 0) {
      this.#context.actionDetails = details;
    }

    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Serialize to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.#id,
      type: this.#type,
      priority: this.#priority,
      title: this.#title,
      description: this.#description,
      rationale: this.#rationale,
      confidence: this.#confidence,
      createdAt: this.#createdAt,
      expiresAt: this.#expiresAt,
      context: { ...this.#context },
      actions: [...this.#actions],
      userAction: this.#userAction,
      userActionAt: this.#userActionAt,
      relatedGoalId: this.#relatedGoalId,
      suppressionKey: this.#suppressionKey,
      noveltyScore: this.#noveltyScore,
    };
  }

  /**
   * Restore from serialized data
   * @param {Object} data
   * @returns {ProactiveSuggestion}
   */
  static fromJSON(data) {
    const suggestion = new ProactiveSuggestion({
      type: data.type,
      priority: data.priority,
      title: data.title,
      description: data.description,
      rationale: data.rationale,
      confidence: data.confidence,
      context: data.context,
      actions: data.actions,
      relatedGoalId: data.relatedGoalId,
      suppressionKey: data.suppressionKey,
    });

    suggestion.#id = data.id;
    suggestion.#createdAt = data.createdAt;
    suggestion.#expiresAt = data.expiresAt;
    suggestion.#userAction = data.userAction;
    suggestion.#userActionAt = data.userActionAt;
    suggestion.#noveltyScore = data.noveltyScore || 1.0;

    return suggestion;
  }
}

/**
 * ProactiveSuggestionEngine - Manages suggestions for a session
 *
 * Rules enforced:
 * - NO auto-execution without approval
 * - NO suggestions with confidence < 0.8 (except INFO)
 * - User must explicitly approve before any action is taken
 *
 * @example
 * const engine = new ProactiveSuggestionEngine('session_123');
 *
 * // Add a suggestion
 * engine.suggest({
 *   type: SuggestionType.NEXT_STEP,
 *   priority: SuggestionPriority.MEDIUM,
 *   title: 'Add unit tests',
 *   description: 'The new function lacks test coverage',
 *   rationale: 'Tests prevent regressions',
 *   confidence: 0.9,
 * });
 *
 * // Get pending suggestions
 * const pending = engine.getPendingSuggestions();
 *
 * // User approves
 * engine.approve(suggestion.id);
 */
export class ProactiveSuggestionEngine {
  #sessionId;
  #suggestions;
  #enabled;
  #rules;
  #history;
  #suppressionCounts;  // Track how many times each suppressionKey was used

  /**
   * @param {string} sessionId - Session identifier
   * @param {Object} [options]
   * @param {boolean} [options.enabled=false] - Whether proactive mode is enabled (opt-in)
   */
  constructor(sessionId, options = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('ProactiveSuggestionEngine requires sessionId string');
    }

    const { enabled = false } = options;

    this.#sessionId = sessionId;
    this.#suggestions = new Map();
    this.#enabled = enabled;
    this.#history = [];
    this.#rules = this.#getDefaultRules();
    this.#suppressionCounts = new Map();  // key → count
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get sessionId() { return this.#sessionId; }
  get enabled() { return this.#enabled; }

  /**
   * Enable proactive mode
   * @returns {ProactiveSuggestionEngine} this for chaining
   */
  enable() {
    this.#enabled = true;
    this.#recordHistory('ENABLED');
    return this;
  }

  /**
   * Disable proactive mode
   * @returns {ProactiveSuggestionEngine} this for chaining
   */
  disable() {
    this.#enabled = false;
    this.#recordHistory('DISABLED');
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Suggestion Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new suggestion
   * @param {Object} config - Suggestion configuration
   * @returns {ProactiveSuggestion|null} - null if disabled, below threshold, or suppressed
   */
  suggest(config) {
    if (!this.#enabled) {
      return null;
    }

    // Enforce minimum confidence
    if (config.confidence < MIN_SUGGESTION_CONFIDENCE && config.priority !== SuggestionPriority.INFO) {
      return null; // Silently reject low-confidence suggestions
    }

    // Check rules
    if (!this.#checkRules(config)) {
      return null;
    }

    const suggestion = new ProactiveSuggestion(config);

    // NOISE PREVENTION: Track suppression counts and calculate novelty
    const suppressionKey = suggestion.suppressionKey;
    const currentCount = this.#suppressionCounts.get(suppressionKey) || 0;

    // Auto-suppress if shown too many times
    if (currentCount >= MAX_SUGGESTION_REPETITIONS) {
      this.#recordHistory('SUPPRESSED', {
        suppressionKey,
        count: currentCount,
        reason: 'max_repetitions_exceeded',
      });
      return null;
    }

    // Update suppression count
    this.#suppressionCounts.set(suppressionKey, currentCount + 1);

    // Calculate novelty score: decreases with each repetition
    // 1.0 for first time, 0.66 for second, 0.33 for third, then suppressed
    const noveltyScore = 1.0 - (currentCount / MAX_SUGGESTION_REPETITIONS);
    suggestion.setNoveltyScore(noveltyScore);

    this.#suggestions.set(suggestion.id, suggestion);
    this.#recordHistory('SUGGESTED', {
      suggestionId: suggestion.id,
      type: config.type,
      suppressionKey,
      noveltyScore,
      repetition: currentCount + 1,
    });

    return suggestion;
  }

  /**
   * Reset suppression count for a key (e.g., when context changes significantly)
   * @param {string} suppressionKey
   */
  resetSuppression(suppressionKey) {
    this.#suppressionCounts.delete(suppressionKey);
    this.#recordHistory('SUPPRESSION_RESET', { suppressionKey });
  }

  /**
   * Reset all suppression counts
   */
  resetAllSuppressions() {
    this.#suppressionCounts.clear();
    this.#recordHistory('ALL_SUPPRESSIONS_RESET');
  }

  /**
   * Get suppression count for a key
   * @param {string} suppressionKey
   * @returns {number}
   */
  getSuppressionCount(suppressionKey) {
    return this.#suppressionCounts.get(suppressionKey) || 0;
  }

  /**
   * Get all pending suggestions (not expired, no user action)
   * @returns {ProactiveSuggestion[]}
   */
  getPendingSuggestions() {
    return Array.from(this.#suggestions.values())
      .filter(s => s.isPending())
      .sort((a, b) => {
        // Sort by priority, then by creation time
        const priorityOrder = {
          [SuggestionPriority.CRITICAL]: 0,
          [SuggestionPriority.HIGH]: 1,
          [SuggestionPriority.MEDIUM]: 2,
          [SuggestionPriority.LOW]: 3,
          [SuggestionPriority.INFO]: 4,
        };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
  }

  /**
   * Get suggestions by type
   * @param {string} type - SuggestionType
   * @returns {ProactiveSuggestion[]}
   */
  getSuggestionsByType(type) {
    return Array.from(this.#suggestions.values())
      .filter(s => s.type === type);
  }

  /**
   * Get suggestions related to a goal
   * @param {string} goalId - Goal ID
   * @returns {ProactiveSuggestion[]}
   */
  getSuggestionsByGoal(goalId) {
    return Array.from(this.#suggestions.values())
      .filter(s => s.relatedGoalId === goalId);
  }

  /**
   * Get a specific suggestion
   * @param {string} suggestionId
   * @returns {ProactiveSuggestion|null}
   */
  getSuggestion(suggestionId) {
    return this.#suggestions.get(suggestionId) || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // User Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Approve a suggestion (user explicitly agrees)
   * IMPORTANT: This only marks it as approved - execution requires separate action
   * @param {string} suggestionId
   * @returns {ProactiveSuggestion}
   */
  approve(suggestionId) {
    const suggestion = this.#suggestions.get(suggestionId);
    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    suggestion.recordAction(SuggestionAction.APPROVE);
    this.#recordHistory('APPROVED', { suggestionId });

    return suggestion;
  }

  /**
   * Dismiss a suggestion (user explicitly rejects)
   * @param {string} suggestionId
   * @param {string} [reason] - Why dismissed
   * @returns {ProactiveSuggestion}
   */
  dismiss(suggestionId, reason = '') {
    const suggestion = this.#suggestions.get(suggestionId);
    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    suggestion.recordAction(SuggestionAction.DISMISS, { reason });
    this.#recordHistory('DISMISSED', { suggestionId, reason });

    return suggestion;
  }

  /**
   * Defer a suggestion for later
   * @param {string} suggestionId
   * @returns {ProactiveSuggestion}
   */
  defer(suggestionId) {
    const suggestion = this.#suggestions.get(suggestionId);
    if (!suggestion) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    suggestion.recordAction(SuggestionAction.DEFER);
    this.#recordHistory('DEFERRED', { suggestionId });

    return suggestion;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Rule Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a custom rule
   * @param {string} name - Rule name
   * @param {Function} predicate - (config) => boolean
   */
  addRule(name, predicate) {
    if (typeof predicate !== 'function') {
      throw new Error('Rule predicate must be a function');
    }
    this.#rules.set(name, predicate);
  }

  /**
   * Remove a rule
   * @param {string} name - Rule name
   */
  removeRule(name) {
    this.#rules.delete(name);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Statistics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get suggestion statistics
   * @returns {Object}
   */
  getStats() {
    const all = Array.from(this.#suggestions.values());

    return {
      total: all.length,
      pending: all.filter(s => s.isPending()).length,
      expired: all.filter(s => s.isExpired()).length,
      approved: all.filter(s => s.isApproved()).length,
      dismissed: all.filter(s => s.isDismissed()).length,
      byType: this.#countByField(all, 'type'),
      byPriority: this.#countByField(all, 'priority'),
      averageConfidence: all.length > 0
        ? all.reduce((sum, s) => sum + s.confidence, 0) / all.length
        : 0,
    };
  }

  /**
   * Get history
   * @returns {Object[]}
   */
  getHistory() {
    return [...this.#history];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Remove expired suggestions
   * @returns {number} Number of removed suggestions
   */
  cleanup() {
    let removed = 0;
    for (const [id, suggestion] of this.#suggestions) {
      if (suggestion.isExpired()) {
        this.#suggestions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all suggestions
   */
  clear() {
    this.#suggestions.clear();
    this.#recordHistory('CLEARED');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Serialize to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      sessionId: this.#sessionId,
      enabled: this.#enabled,
      suggestions: Array.from(this.#suggestions.values()).map(s => s.toJSON()),
      history: [...this.#history],
    };
  }

  /**
   * Restore from serialized data
   * @param {Object} data
   * @returns {ProactiveSuggestionEngine}
   */
  static fromJSON(data) {
    const engine = new ProactiveSuggestionEngine(data.sessionId, {
      enabled: data.enabled,
    });

    for (const sugData of data.suggestions) {
      const suggestion = ProactiveSuggestion.fromJSON(sugData);
      engine.#suggestions.set(suggestion.id, suggestion);
    }

    engine.#history = data.history || [];

    return engine;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  #getDefaultRules() {
    const rules = new Map();

    // Rule: No duplicate active suggestions of same type+title
    rules.set('no-duplicates', (config) => {
      const existing = Array.from(this.#suggestions.values()).find(
        s => s.isPending() && s.type === config.type && s.title === config.title
      );
      return !existing;
    });

    // Rule: Max 10 pending suggestions
    rules.set('max-pending', () => {
      return this.getPendingSuggestions().length < 10;
    });

    return rules;
  }

  #checkRules(config) {
    for (const [name, predicate] of this.#rules) {
      if (!predicate(config)) {
        return false;
      }
    }
    return true;
  }

  #recordHistory(action, details = {}) {
    this.#history.push({
      action,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }

  #countByField(items, field) {
    const counts = {};
    for (const item of items) {
      const value = item[field];
      counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Factory Functions & Helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create suggestion engine (factory function)
 * @param {string} sessionId
 * @param {Object} [options]
 * @returns {ProactiveSuggestionEngine}
 */
export function createSuggestionEngine(sessionId, options = {}) {
  return new ProactiveSuggestionEngine(sessionId, options);
}

/**
 * Create a next step suggestion
 * @param {Object} params
 * @returns {Object} Suggestion config
 */
export function nextStepSuggestion(params) {
  const { title, description, rationale, confidence = 0.85, context = {}, relatedGoalId = null } = params;
  return {
    type: SuggestionType.NEXT_STEP,
    priority: SuggestionPriority.MEDIUM,
    title,
    description,
    rationale,
    confidence,
    context,
    relatedGoalId,
  };
}

/**
 * Create a risk warning suggestion
 * @param {Object} params
 * @returns {Object} Suggestion config
 */
export function riskWarningSuggestion(params) {
  const { title, description, rationale, confidence = 0.9, context = {}, relatedGoalId = null, priority = SuggestionPriority.HIGH } = params;
  return {
    type: SuggestionType.RISK_WARNING,
    priority,
    title,
    description,
    rationale,
    confidence,
    context,
    relatedGoalId,
  };
}

/**
 * Create a refactor suggestion
 * @param {Object} params
 * @returns {Object} Suggestion config
 */
export function refactorSuggestion(params) {
  const { title, description, rationale, confidence = 0.85, context = {}, relatedGoalId = null } = params;
  return {
    type: SuggestionType.REFACTOR,
    priority: SuggestionPriority.LOW,
    title,
    description,
    rationale,
    confidence,
    context,
    relatedGoalId,
  };
}

export default ProactiveSuggestionEngine;
