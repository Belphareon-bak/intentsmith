// CRE v39.3.1 Suggestions
// ══════════════════════════════════════════════════════════════════════════════
//
// Proactive suggestions engine for copilot mode.
//
// Suggestion Types:
//   - Error fixes
//   - Refactoring opportunities
//   - Missing tests
//   - Documentation gaps
//   - Performance improvements
//   - Security issues
//
// v39.3.1 Fix:
//   - Connect to GoalStore for goal-aware suggestions
//   - Connect to FailureHistory for failure-aware suggestions
//   - Suggestions align with active goals and avoid repeated failures
//
// Key Principle:
//   Suggest, don't act. User always decides.
//   Suggestions are helpful hints, not commands.
//
// ══════════════════════════════════════════════════════════════════════════════

import { copilotContext, ContextEventType } from './copilot-context.js';
import { goalStore } from './goal-store.js';
import { failureHistory } from './correction-strategy.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SUGGESTION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const SuggestionType = {
  FIX_ERROR: 'fix_error',           // Fix detected error
  REFACTOR: 'refactor',             // Refactoring suggestion
  ADD_TEST: 'add_test',             // Missing test coverage
  ADD_DOC: 'add_doc',               // Missing documentation
  PERFORMANCE: 'performance',       // Performance improvement
  SECURITY: 'security',             // Security issue
  BEST_PRACTICE: 'best_practice',   // Code style/practice
  COMMIT: 'commit',                 // Commit suggestion
  DEPENDENCY: 'dependency',         // Dependency update
  CLEANUP: 'cleanup',               // Code cleanup
  // v39.3.1: Goal-related suggestions
  GOAL_PROGRESS: 'goal_progress',   // Goal progress nudge
  GOAL_STUCK: 'goal_stuck',         // Goal is stuck
  GOAL_ALIGNED: 'goal_aligned',     // Current work aligns with goal
};

// ════════════════════════════════════════════════════════════════════════════
// SUGGESTION PRIORITY
// ════════════════════════════════════════════════════════════════════════════

export const SuggestionPriority = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 10,
  URGENT: 20,
};

// ════════════════════════════════════════════════════════════════════════════
// SUGGESTION SCHEMA
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Suggestion
 * @property {string} id
 * @property {string} type - SuggestionType
 * @property {number} priority - SuggestionPriority
 * @property {string} title - Short title
 * @property {string} description - Detailed description
 * @property {Object} context - Related context
 * @property {Object[]} actions - Possible actions
 * @property {number} confidence - Confidence score (0-1)
 * @property {number} createdAt
 * @property {string} status - 'pending' | 'accepted' | 'rejected' | 'expired'
 */

// ════════════════════════════════════════════════════════════════════════════
// SUGGESTION ENGINE
// ════════════════════════════════════════════════════════════════════════════

export class SuggestionEngine {
  constructor(options = {}) {
    this.context = options.context || copilotContext;

    // v39.3.1: Connect to goals and failure history
    this.goalStore = options.goalStore || goalStore;
    this.failureHistory = options.failureHistory || failureHistory;

    // Active suggestions
    this.suggestions = [];
    this.maxSuggestions = options.maxSuggestions || 20;

    // Configuration
    this.enabled = options.enabled ?? true;
    this.minConfidence = options.minConfidence || 0.5;
    this.suggestionTTL = options.suggestionTTL || 300000; // 5 minutes
    this.goalCheckInterval = options.goalCheckInterval || 60000; // 1 minute

    // Callbacks
    this.onSuggestion = options.onSuggestion || null;

    // Rules
    this.rules = this.buildDefaultRules();

    // v39.3.1: Goal alignment cache
    this.goalAlignmentCache = new Map();  // suggestionId → goalId

    // Stats
    this.stats = {
      generated: 0,
      accepted: 0,
      rejected: 0,
      expired: 0,
      goalAligned: 0,     // v39.3.1
      failureAvoided: 0,  // v39.3.1
    };

    // Subscribe to context events
    this.setupContextListeners();

    // v39.3.1: Start goal monitoring
    this.goalCheckTimer = null;
    if (this.enabled) {
      this.startGoalMonitoring();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONTEXT LISTENING
  // ──────────────────────────────────────────────────────────────────────────

  setupContextListeners() {
    // Listen to error events
    this.context.subscribe(ContextEventType.ERROR_DETECTED, (data, snapshot) => {
      this.checkErrorRules(data, snapshot);
    });

    // Listen to file changes
    this.context.subscribe(ContextEventType.FILE_SAVED, (data, snapshot) => {
      this.checkFileRules(data, snapshot);
    });

    // Listen to git changes
    this.context.subscribe(ContextEventType.GIT_STATUS_CHANGED, (data, snapshot) => {
      this.checkGitRules(data, snapshot);
    });

    // Listen to all events for pattern detection
    this.context.subscribe('*', (eventType, data, snapshot) => {
      this.checkPatternRules(eventType, data, snapshot);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULE CHECKING
  // ──────────────────────────────────────────────────────────────────────────

  checkErrorRules(errorData, snapshot) {
    if (!this.enabled) return;

    // Generate fix suggestion for error
    const suggestion = this.createSuggestion({
      type: SuggestionType.FIX_ERROR,
      priority: SuggestionPriority.HIGH,
      title: `Fix: ${errorData.message || 'Error detected'}`,
      description: this.describeError(errorData),
      context: {
        file: errorData.file || snapshot.currentFile,
        line: errorData.line,
        error: errorData,
      },
      actions: [
        { label: 'Show fix', action: 'show_fix', primary: true },
        { label: 'Ignore', action: 'ignore' },
        { label: 'Add to ignore list', action: 'ignore_rule' },
      ],
      confidence: 0.8,
    });

    this.addSuggestion(suggestion);
  }

  checkFileRules(fileData, snapshot) {
    if (!this.enabled) return;

    const file = fileData.path || snapshot.currentFile;
    if (!file) return;

    // Check for missing tests
    if (this.shouldHaveTest(file) && !this.hasTest(file, snapshot)) {
      this.addSuggestion(this.createSuggestion({
        type: SuggestionType.ADD_TEST,
        priority: SuggestionPriority.NORMAL,
        title: 'Add tests for this file',
        description: `File ${this.getFileName(file)} has no corresponding test file.`,
        context: { file },
        actions: [
          { label: 'Generate test', action: 'generate_test', primary: true },
          { label: 'Remind later', action: 'remind' },
          { label: 'Not needed', action: 'ignore' },
        ],
        confidence: 0.6,
      }));
    }

    // Check for missing documentation
    if (this.shouldHaveDoc(file) && !this.hasJSDoc(file, snapshot)) {
      this.addSuggestion(this.createSuggestion({
        type: SuggestionType.ADD_DOC,
        priority: SuggestionPriority.LOW,
        title: 'Add documentation',
        description: 'Consider adding JSDoc comments to exported functions.',
        context: { file },
        actions: [
          { label: 'Add docs', action: 'add_docs', primary: true },
          { label: 'Skip', action: 'ignore' },
        ],
        confidence: 0.5,
      }));
    }
  }

  checkGitRules(gitData, snapshot) {
    if (!this.enabled) return;

    const changes = gitData.changes || snapshot.uncommittedChanges || [];

    // Suggest commit when many changes accumulated
    if (changes.length >= 5) {
      const existing = this.suggestions.find(s => s.type === SuggestionType.COMMIT);
      if (!existing) {
        this.addSuggestion(this.createSuggestion({
          type: SuggestionType.COMMIT,
          priority: SuggestionPriority.NORMAL,
          title: 'Consider committing changes',
          description: `You have ${changes.length} uncommitted changes. Consider creating a commit.`,
          context: { changes: changes.slice(0, 10) },
          actions: [
            { label: 'Create commit', action: 'create_commit', primary: true },
            { label: 'Review changes', action: 'review_changes' },
            { label: 'Later', action: 'dismiss' },
          ],
          confidence: 0.7,
        }));
      }
    }
  }

  checkPatternRules(eventType, data, snapshot) {
    if (!this.enabled) return;

    // Pattern: Repeated errors → debugging assistance
    const recentErrors = snapshot.errors?.slice(-5) || [];
    if (recentErrors.length >= 3) {
      const sameError = recentErrors.every(e =>
        e.message === recentErrors[0].message
      );
      if (sameError) {
        this.addSuggestion(this.createSuggestion({
          type: SuggestionType.FIX_ERROR,
          priority: SuggestionPriority.URGENT,
          title: 'Repeated error detected',
          description: 'The same error keeps occurring. Would you like help debugging?',
          context: { errors: recentErrors },
          actions: [
            { label: 'Help debug', action: 'debug_assist', primary: true },
            { label: 'I got this', action: 'dismiss' },
          ],
          confidence: 0.9,
        }));
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // v39.3.1: GOAL-AWARE SUGGESTIONS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start periodic goal monitoring
   */
  startGoalMonitoring() {
    if (this.goalCheckTimer) return;

    this.goalCheckTimer = setInterval(() => {
      this.checkGoalSuggestions();
    }, this.goalCheckInterval);

    // Initial check
    this.checkGoalSuggestions();
  }

  /**
   * Stop goal monitoring
   */
  stopGoalMonitoring() {
    if (this.goalCheckTimer) {
      clearInterval(this.goalCheckTimer);
      this.goalCheckTimer = null;
    }
  }

  /**
   * Check active goals and generate suggestions
   */
  checkGoalSuggestions() {
    if (!this.enabled || !this.goalStore) return;

    try {
      const activeGoals = this.goalStore.getActive();

      for (const goal of activeGoals) {
        this.checkGoalProgress(goal);
        this.checkGoalStuckPatterns(goal);
        this.checkGoalAlignedActions(goal);
      }
    } catch (e) {
      logger.error('SuggestionEngine', 'Failed to check goals', { error: e.message });
    }
  }

  /**
   * Check if a goal needs progress nudge
   */
  checkGoalProgress(goal) {
    // Suggest action if goal is paused for too long
    if (goal.status === 'paused') {
      const pausedDuration = Date.now() - (goal.updatedAt || goal.createdAt);
      if (pausedDuration > 600000) { // 10 minutes
        this.addSuggestion(this.createSuggestion({
          type: SuggestionType.GOAL_PROGRESS,
          priority: SuggestionPriority.NORMAL,
          title: `Resume goal: ${this.truncate(goal.description, 40)}`,
          description: 'This goal has been paused. Would you like to resume it?',
          context: { goalId: goal.id, goal },
          actions: [
            { label: 'Resume', action: 'resume_goal', primary: true },
            { label: 'Cancel goal', action: 'cancel_goal' },
            { label: 'Keep paused', action: 'dismiss' },
          ],
          confidence: 0.7,
          goalId: goal.id,
        }));
      }
    }

    // Suggest review if goal is running too long
    if (goal.status === 'running' && goal.startedAt) {
      const runningDuration = Date.now() - goal.startedAt;
      const maxDuration = goal.constraints?.maxDuration || 3600000;
      if (runningDuration > maxDuration * 0.8) {
        this.addSuggestion(this.createSuggestion({
          type: SuggestionType.GOAL_PROGRESS,
          priority: SuggestionPriority.HIGH,
          title: 'Goal approaching time limit',
          description: `Goal "${this.truncate(goal.description, 30)}" is nearing its time limit.`,
          context: { goalId: goal.id, progress: goal.progress },
          actions: [
            { label: 'Extend time', action: 'extend_goal' },
            { label: 'Review progress', action: 'review_goal', primary: true },
            { label: 'Cancel', action: 'cancel_goal' },
          ],
          confidence: 0.9,
          goalId: goal.id,
        }));
      }
    }
  }

  /**
   * Check for patterns that suggest goal is stuck
   */
  checkGoalStuckPatterns(goal) {
    if (!this.failureHistory) return;

    // Get failure history for this goal
    const history = this.failureHistory.getGoalHistory(goal.id, 10);
    const recentFailures = history.filter(h => !h.success);

    if (recentFailures.length >= 3) {
      // Same correction failing repeatedly
      const failingActions = this.groupBy(recentFailures, h => h.action);

      for (const [action, failures] of Object.entries(failingActions)) {
        if (failures.length >= 3) {
          this.addSuggestion(this.createSuggestion({
            type: SuggestionType.GOAL_STUCK,
            priority: SuggestionPriority.URGENT,
            title: 'Goal may be stuck',
            description: `Correction "${action}" has failed ${failures.length} times. Consider a different approach.`,
            context: {
              goalId: goal.id,
              failingAction: action,
              failures: failures.length,
            },
            actions: [
              { label: 'Try different approach', action: 'replan_goal', primary: true },
              { label: 'Get help', action: 'ask_user' },
              { label: 'Cancel goal', action: 'cancel_goal' },
            ],
            confidence: 0.95,
            goalId: goal.id,
          }));
        }
      }
    }
  }

  /**
   * Check if current actions align with active goals
   */
  checkGoalAlignedActions(goal) {
    const snapshot = this.context.getSnapshot();
    if (!snapshot || !snapshot.currentFile) return;

    // Check if current work relates to goal
    const currentFile = snapshot.currentFile;
    const goalInput = goal.staticContext?.initialInput || goal.context?.input || {};

    // Simple alignment check: does current file match goal's target files?
    const targetFiles = goalInput.files || goalInput.targetFiles || [];
    const isAligned = targetFiles.some(f => currentFile.includes(f) || f.includes(currentFile));

    if (isAligned && goal.status !== 'running') {
      // Suggest starting this goal since user is working on related files
      this.addSuggestion(this.createSuggestion({
        type: SuggestionType.GOAL_ALIGNED,
        priority: SuggestionPriority.NORMAL,
        title: 'Related goal available',
        description: `You're working on files related to: "${this.truncate(goal.description, 40)}"`,
        context: { goalId: goal.id, currentFile },
        actions: [
          { label: 'Start goal', action: 'start_goal', primary: true },
          { label: 'View goal', action: 'view_goal' },
          { label: 'Ignore', action: 'dismiss' },
        ],
        confidence: 0.6,
        goalId: goal.id,
      }));
      this.stats.goalAligned++;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // v39.3.1: FAILURE-AWARE FILTERING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if a suggestion's action has been failing
   * @returns {boolean} true if suggestion should be suppressed
   */
  isActionFailing(suggestionType, goalId) {
    if (!this.failureHistory || !goalId) return false;

    // Map suggestion types to correction actions
    const actionMap = {
      [SuggestionType.FIX_ERROR]: 'retry',
      [SuggestionType.REFACTOR]: 'replan',
    };

    const action = actionMap[suggestionType];
    if (!action) return false;

    const check = this.failureHistory.shouldBlock(goalId, suggestionType, action, 3);
    if (check.blocked) {
      this.stats.failureAvoided++;
      logger.debug('SuggestionEngine', `Suppressed suggestion due to failure history: ${suggestionType}`);
      return true;
    }

    return false;
  }

  /**
   * Get suggestions based on failure patterns
   */
  getFailureBasedSuggestions() {
    if (!this.failureHistory) return [];

    const failingPatterns = this.failureHistory.getFailingPatterns(5, 0.2);
    const suggestions = [];

    for (const pattern of failingPatterns.slice(0, 3)) {
      suggestions.push(this.createSuggestion({
        type: SuggestionType.BEST_PRACTICE,
        priority: SuggestionPriority.NORMAL,
        title: 'Consider alternative approach',
        description: `Pattern "${pattern.pattern}" has low success rate (${(pattern.successRate * 100).toFixed(0)}%). Consider a different strategy.`,
        context: { pattern },
        actions: [
          { label: 'Learn more', action: 'show_alternatives' },
          { label: 'Ignore', action: 'dismiss' },
        ],
        confidence: 0.6,
      }));
    }

    return suggestions;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUGGESTION MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create a new suggestion
   */
  createSuggestion(config) {
    return {
      id: `sugg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: config.type,
      priority: config.priority || SuggestionPriority.NORMAL,
      title: config.title,
      description: config.description,
      context: config.context || {},
      actions: config.actions || [],
      confidence: config.confidence || 0.5,
      createdAt: Date.now(),
      status: 'pending',
    };
  }

  /**
   * Add a suggestion
   */
  addSuggestion(suggestion) {
    // Check confidence threshold
    if (suggestion.confidence < this.minConfidence) {
      return null;
    }

    // v39.3.1: Check if action has been failing for this goal
    if (suggestion.goalId && this.isActionFailing(suggestion.type, suggestion.goalId)) {
      return null;
    }

    // Check for duplicates
    const isDuplicate = this.suggestions.some(s =>
      s.type === suggestion.type &&
      s.title === suggestion.title &&
      s.status === 'pending'
    );
    if (isDuplicate) {
      return null;
    }

    // Add suggestion
    this.suggestions.push(suggestion);
    this.stats.generated++;

    // v39.3.1: Track goal alignment
    if (suggestion.goalId) {
      this.goalAlignmentCache.set(suggestion.id, suggestion.goalId);
    }

    // Trim if needed
    if (this.suggestions.length > this.maxSuggestions) {
      // Remove oldest low-priority pending suggestions
      const pending = this.suggestions.filter(s => s.status === 'pending');
      pending.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
      if (pending.length > 0) {
        const toRemove = pending[0];
        this.suggestions = this.suggestions.filter(s => s.id !== toRemove.id);
        this.goalAlignmentCache.delete(toRemove.id);
      }
    }

    // Notify callback
    if (this.onSuggestion) {
      try {
        this.onSuggestion(suggestion);
      } catch (e) {
        logger.error('SuggestionEngine', 'onSuggestion error', { error: e.message });
      }
    }

    logger.debug('SuggestionEngine', `Suggestion: ${suggestion.title}`, {
      type: suggestion.type,
      confidence: suggestion.confidence,
      goalId: suggestion.goalId,
    });

    return suggestion;
  }

  /**
   * Accept a suggestion
   */
  accept(suggestionId) {
    const suggestion = this.suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return { success: false, error: 'Not found' };

    suggestion.status = 'accepted';
    suggestion.acceptedAt = Date.now();
    this.stats.accepted++;

    return { success: true, suggestion };
  }

  /**
   * Reject a suggestion
   */
  reject(suggestionId) {
    const suggestion = this.suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return { success: false, error: 'Not found' };

    suggestion.status = 'rejected';
    suggestion.rejectedAt = Date.now();
    this.stats.rejected++;

    return { success: true };
  }

  /**
   * Dismiss a suggestion (not rejected, just hidden)
   */
  dismiss(suggestionId) {
    const suggestion = this.suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return { success: false, error: 'Not found' };

    suggestion.status = 'dismissed';
    return { success: true };
  }

  /**
   * Expire old suggestions
   */
  expireOld() {
    const now = Date.now();
    let expired = 0;

    for (const suggestion of this.suggestions) {
      if (suggestion.status === 'pending' &&
          now - suggestion.createdAt > this.suggestionTTL) {
        suggestion.status = 'expired';
        expired++;
      }
    }

    this.stats.expired += expired;
    return expired;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get pending suggestions (sorted by priority)
   */
  getPending() {
    this.expireOld();
    return this.suggestions
      .filter(s => s.status === 'pending')
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all suggestions
   */
  getAll() {
    return [...this.suggestions];
  }

  /**
   * Get suggestions by type
   */
  getByType(type) {
    return this.suggestions.filter(s => s.type === type);
  }

  /**
   * Get top suggestion
   */
  getTop() {
    const pending = this.getPending();
    return pending[0] || null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  describeError(errorData) {
    if (errorData.type === 'command_error') {
      return `Command \`${errorData.command}\` failed. Check the output for details.`;
    }
    if (errorData.type === 'lint') {
      return `Linting error in ${errorData.file}:${errorData.line}: ${errorData.message}`;
    }
    return errorData.message || 'An error was detected.';
  }

  shouldHaveTest(file) {
    // Source files that should have tests
    const testableExtensions = ['.js', '.ts', '.jsx', '.tsx'];
    return testableExtensions.some(ext => file.endsWith(ext)) &&
           !file.includes('.test.') &&
           !file.includes('.spec.') &&
           !file.includes('/tests/');
  }

  hasTest(file, snapshot) {
    const baseName = file.replace(/\.[^.]+$/, '');
    const testPatterns = [
      `${baseName}.test.`,
      `${baseName}.spec.`,
    ];

    return snapshot.recentFiles?.some(f =>
      testPatterns.some(p => f.includes(p))
    );
  }

  shouldHaveDoc(file) {
    return file.endsWith('.js') || file.endsWith('.ts');
  }

  hasJSDoc(file, snapshot) {
    // This would check file content for JSDoc comments
    // Simplified for now
    return false;
  }

  getFileName(path) {
    return path.split('/').pop();
  }

  /**
   * Truncate string with ellipsis
   */
  truncate(str, maxLength = 50) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  /**
   * Group array by key function
   */
  groupBy(array, keyFn) {
    const result = {};
    for (const item of array) {
      const key = keyFn(item);
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RULES
  // ──────────────────────────────────────────────────────────────────────────

  buildDefaultRules() {
    return [
      // Error-related rules are handled by checkErrorRules
      // File-related rules are handled by checkFileRules
      // Git-related rules are handled by checkGitRules
      // Pattern rules are handled by checkPatternRules
    ];
  }

  /**
   * Add custom rule
   */
  addRule(rule) {
    this.rules.push(rule);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────

  enable() {
    this.enabled = true;
    this.startGoalMonitoring();
    logger.debug('SuggestionEngine', 'Enabled');
  }

  disable() {
    this.enabled = false;
    this.stopGoalMonitoring();
    logger.debug('SuggestionEngine', 'Disabled');
  }

  setMinConfidence(confidence) {
    this.minConfidence = Math.max(0, Math.min(1, confidence));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      pending: this.getPending().length,
      total: this.suggestions.length,
      enabled: this.enabled,
      // v39.3.1: Goal integration stats
      goalConnected: !!this.goalStore,
      failureHistoryConnected: !!this.failureHistory,
      goalAlignedSuggestions: this.goalAlignmentCache.size,
    };
  }

  /**
   * Clear all suggestions
   */
  clear() {
    const count = this.suggestions.length;
    this.suggestions = [];
    this.goalAlignmentCache.clear();
    return { success: true, cleared: count };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // v39.3.1: GOAL QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get suggestions for a specific goal
   */
  getForGoal(goalId) {
    return this.suggestions.filter(s =>
      s.context?.goalId === goalId || this.goalAlignmentCache.get(s.id) === goalId
    );
  }

  /**
   * Get active goals summary for context
   */
  getGoalContext() {
    if (!this.goalStore) return null;

    try {
      const activeGoals = this.goalStore.getActive();
      return {
        activeCount: activeGoals.length,
        goals: activeGoals.map(g => ({
          id: g.id,
          description: this.truncate(g.description, 50),
          status: g.status,
          priority: g.priority,
          progress: g.progress?.percent || 0,
        })),
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if current work aligns with any active goal
   */
  getAlignedGoals(currentFile) {
    if (!this.goalStore || !currentFile) return [];

    const activeGoals = this.goalStore.getActive();
    const aligned = [];

    for (const goal of activeGoals) {
      const goalInput = goal.staticContext?.initialInput || goal.context?.input || {};
      const targetFiles = goalInput.files || goalInput.targetFiles || [];

      if (targetFiles.some(f => currentFile.includes(f) || f.includes(currentFile))) {
        aligned.push({
          goalId: goal.id,
          description: goal.description,
          status: goal.status,
          matchedFile: currentFile,
        });
      }
    }

    return aligned;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const suggestionEngine = new SuggestionEngine();

export default SuggestionEngine;
