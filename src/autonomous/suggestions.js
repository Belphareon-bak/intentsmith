// CRE v39.3 Suggestions
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
// Key Principle:
//   Suggest, don't act. User always decides.
//   Suggestions are helpful hints, not commands.
//
// ══════════════════════════════════════════════════════════════════════════════

import { copilotContext, ContextEventType } from './copilot-context.js';
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

    // Active suggestions
    this.suggestions = [];
    this.maxSuggestions = options.maxSuggestions || 20;

    // Configuration
    this.enabled = options.enabled ?? true;
    this.minConfidence = options.minConfidence || 0.5;
    this.suggestionTTL = options.suggestionTTL || 300000; // 5 minutes

    // Callbacks
    this.onSuggestion = options.onSuggestion || null;

    // Rules
    this.rules = this.buildDefaultRules();

    // Stats
    this.stats = {
      generated: 0,
      accepted: 0,
      rejected: 0,
      expired: 0,
    };

    // Subscribe to context events
    this.setupContextListeners();
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

    // Trim if needed
    if (this.suggestions.length > this.maxSuggestions) {
      // Remove oldest low-priority pending suggestions
      const pending = this.suggestions.filter(s => s.status === 'pending');
      pending.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
      if (pending.length > 0) {
        this.suggestions = this.suggestions.filter(s => s.id !== pending[0].id);
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
    logger.debug('SuggestionEngine', 'Enabled');
  }

  disable() {
    this.enabled = false;
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
    };
  }

  /**
   * Clear all suggestions
   */
  clear() {
    const count = this.suggestions.length;
    this.suggestions = [];
    return { success: true, cleared: count };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const suggestionEngine = new SuggestionEngine();

export default SuggestionEngine;
