// CRE v39.3 Copilot Context
// ══════════════════════════════════════════════════════════════════════════════
//
// Maintains context for local copilot mode.
//
// v39.3: Local Copilot Mode
//   - Observes user activity (files, commands, context)
//   - Maintains working context
//   - Provides proactive suggestions
//   - Approval-first UX (never acts without permission)
//
// Key Principle:
//   Copilot observes and suggests, user decides and approves.
//   Never take action without explicit user consent.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT EVENT TYPES
// ════════════════════════════════════════════════════════════════════════════

export const ContextEventType = {
  // File events
  FILE_OPENED: 'file.opened',
  FILE_CHANGED: 'file.changed',
  FILE_SAVED: 'file.saved',
  FILE_CLOSED: 'file.closed',

  // Editor events
  SELECTION_CHANGED: 'selection.changed',
  CURSOR_MOVED: 'cursor.moved',
  SCROLL: 'scroll',

  // Command events
  COMMAND_EXECUTED: 'command.executed',
  TERMINAL_OUTPUT: 'terminal.output',

  // Git events
  GIT_COMMIT: 'git.commit',
  GIT_BRANCH_CHANGED: 'git.branch_changed',
  GIT_STATUS_CHANGED: 'git.status_changed',

  // Error events
  ERROR_DETECTED: 'error.detected',
  WARNING_DETECTED: 'warning.detected',

  // User events
  USER_QUERY: 'user.query',
  USER_FEEDBACK: 'user.feedback',
};

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT CATEGORIES
// ════════════════════════════════════════════════════════════════════════════

export const ContextCategory = {
  CODE: 'code',             // Code being edited
  ERRORS: 'errors',         // Build/lint/runtime errors
  GIT: 'git',               // Git state
  DEPENDENCIES: 'dependencies', // Package dependencies
  DOCUMENTATION: 'documentation', // Related docs
  HISTORY: 'history',       // Recent actions
};

// ════════════════════════════════════════════════════════════════════════════
// COPILOT CONTEXT
// ════════════════════════════════════════════════════════════════════════════

export class CopilotContext {
  constructor(options = {}) {
    // Context storage
    this.context = {
      // Current file context
      currentFile: null,
      openFiles: [],
      recentFiles: [],

      // Code context
      selection: null,
      cursorPosition: null,
      visibleRange: null,

      // Project context
      projectRoot: options.projectRoot || null,
      language: null,
      framework: null,

      // Git context
      branch: null,
      uncommittedChanges: [],
      recentCommits: [],

      // Error context
      errors: [],
      warnings: [],

      // History
      recentCommands: [],
      recentQueries: [],

      // Intent inference
      inferredIntent: null,
      intentConfidence: 0,
    };

    // Event history
    this.events = [];
    this.maxEvents = options.maxEvents || 500;

    // Listeners for context changes
    this.listeners = new Map();

    // Stats
    this.stats = {
      eventsProcessed: 0,
      contextUpdates: 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EVENT PROCESSING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Process an incoming context event
   */
  processEvent(event) {
    const { type, data, timestamp = Date.now() } = event;

    // Store event
    this.events.push({ type, data, timestamp });
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.stats.eventsProcessed++;

    // Update context based on event type
    switch (type) {
      case ContextEventType.FILE_OPENED:
        this.handleFileOpened(data);
        break;

      case ContextEventType.FILE_CHANGED:
        this.handleFileChanged(data);
        break;

      case ContextEventType.FILE_SAVED:
        this.handleFileSaved(data);
        break;

      case ContextEventType.FILE_CLOSED:
        this.handleFileClosed(data);
        break;

      case ContextEventType.SELECTION_CHANGED:
        this.handleSelectionChanged(data);
        break;

      case ContextEventType.COMMAND_EXECUTED:
        this.handleCommandExecuted(data);
        break;

      case ContextEventType.TERMINAL_OUTPUT:
        this.handleTerminalOutput(data);
        break;

      case ContextEventType.GIT_STATUS_CHANGED:
        this.handleGitStatusChanged(data);
        break;

      case ContextEventType.ERROR_DETECTED:
        this.handleErrorDetected(data);
        break;

      case ContextEventType.USER_QUERY:
        this.handleUserQuery(data);
        break;
    }

    // Update inferred intent
    this.updateInferredIntent();

    // Notify listeners
    this.notifyListeners(type, data);

    this.stats.contextUpdates++;

    return this.getSnapshot();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EVENT HANDLERS
  // ──────────────────────────────────────────────────────────────────────────

  handleFileOpened(data) {
    this.context.currentFile = data.path;
    this.context.language = this.detectLanguage(data.path);

    if (!this.context.openFiles.includes(data.path)) {
      this.context.openFiles.push(data.path);
    }

    // Add to recent files
    this.context.recentFiles = [
      data.path,
      ...this.context.recentFiles.filter(f => f !== data.path),
    ].slice(0, 20);
  }

  handleFileChanged(data) {
    if (data.path === this.context.currentFile) {
      // Detect errors in changed content
      this.detectInlineErrors(data.content);
    }
  }

  handleFileSaved(data) {
    // Clear errors for saved file (will be re-detected by linter)
    this.context.errors = this.context.errors.filter(e => e.file !== data.path);
  }

  handleFileClosed(data) {
    this.context.openFiles = this.context.openFiles.filter(f => f !== data.path);

    if (this.context.currentFile === data.path) {
      this.context.currentFile = this.context.openFiles[0] || null;
    }
  }

  handleSelectionChanged(data) {
    this.context.selection = {
      text: data.text,
      startLine: data.startLine,
      endLine: data.endLine,
      file: data.file || this.context.currentFile,
    };
  }

  handleCommandExecuted(data) {
    this.context.recentCommands = [
      { command: data.command, timestamp: Date.now(), exitCode: data.exitCode },
      ...this.context.recentCommands,
    ].slice(0, 20);

    // Check for failed commands
    if (data.exitCode !== 0) {
      this.context.errors.push({
        type: 'command_error',
        command: data.command,
        output: data.output,
        timestamp: Date.now(),
      });
    }
  }

  handleTerminalOutput(data) {
    // Parse for errors/warnings
    this.parseTerminalOutput(data.output);
  }

  handleGitStatusChanged(data) {
    this.context.branch = data.branch || this.context.branch;
    this.context.uncommittedChanges = data.changes || [];
    if (data.recentCommits) {
      this.context.recentCommits = data.recentCommits.slice(0, 10);
    }
  }

  handleErrorDetected(data) {
    this.context.errors.push({
      ...data,
      timestamp: Date.now(),
    });

    // Trim old errors
    if (this.context.errors.length > 50) {
      this.context.errors = this.context.errors.slice(-50);
    }
  }

  handleUserQuery(data) {
    this.context.recentQueries = [
      { query: data.query, timestamp: Date.now() },
      ...this.context.recentQueries,
    ].slice(0, 10);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTENT INFERENCE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Infer user's current intent from context
   */
  updateInferredIntent() {
    let intent = null;
    let confidence = 0;

    // Recent errors → debugging intent
    if (this.context.errors.length > 0) {
      intent = 'debugging';
      confidence = Math.min(0.9, 0.5 + this.context.errors.length * 0.1);
    }
    // Uncommitted changes → commit intent
    else if (this.context.uncommittedChanges.length > 5) {
      intent = 'preparing_commit';
      confidence = 0.6;
    }
    // Selection → refactoring or explanation intent
    else if (this.context.selection?.text?.length > 50) {
      intent = 'code_review';
      confidence = 0.5;
    }
    // New file → creation intent
    else if (this.context.currentFile && this.isNewFile(this.context.currentFile)) {
      intent = 'creating_feature';
      confidence = 0.6;
    }
    // Test file → testing intent
    else if (this.context.currentFile?.includes('.test.') ||
             this.context.currentFile?.includes('.spec.')) {
      intent = 'writing_tests';
      confidence = 0.7;
    }

    this.context.inferredIntent = intent;
    this.context.intentConfidence = confidence;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Detect programming language from file path
   */
  detectLanguage(path) {
    if (!path) return null;

    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      md: 'markdown',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
    };

    return languageMap[ext] || null;
  }

  /**
   * Check if file is newly created (not in recent files)
   */
  isNewFile(path) {
    return !this.context.recentFiles.includes(path);
  }

  /**
   * Detect inline errors in code content
   */
  detectInlineErrors(content) {
    // Simple pattern-based error detection
    // In production, this would integrate with linters
    const errorPatterns = [
      { pattern: /console\.log\(/g, type: 'warning', message: 'Console.log detected' },
      { pattern: /TODO:/gi, type: 'info', message: 'TODO comment' },
      { pattern: /FIXME:/gi, type: 'warning', message: 'FIXME comment' },
    ];

    // This is a simplified implementation
    // Real implementation would use proper linting
  }

  /**
   * Parse terminal output for errors
   */
  parseTerminalOutput(output) {
    if (!output) return;

    const errorPatterns = [
      /error:/i,
      /exception:/i,
      /failed/i,
      /cannot find/i,
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(output)) {
        this.context.errors.push({
          type: 'terminal_error',
          output: output.slice(0, 500),
          timestamp: Date.now(),
        });
        break;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONTEXT QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get current context snapshot
   */
  getSnapshot() {
    return { ...this.context };
  }

  /**
   * Get context for specific category
   */
  getCategory(category) {
    switch (category) {
      case ContextCategory.CODE:
        return {
          currentFile: this.context.currentFile,
          openFiles: this.context.openFiles,
          selection: this.context.selection,
          language: this.context.language,
        };

      case ContextCategory.ERRORS:
        return {
          errors: this.context.errors,
          warnings: this.context.warnings,
        };

      case ContextCategory.GIT:
        return {
          branch: this.context.branch,
          uncommittedChanges: this.context.uncommittedChanges,
          recentCommits: this.context.recentCommits,
        };

      case ContextCategory.HISTORY:
        return {
          recentCommands: this.context.recentCommands,
          recentFiles: this.context.recentFiles,
          recentQueries: this.context.recentQueries,
        };

      default:
        return {};
    }
  }

  /**
   * Get recent events of specific type
   */
  getRecentEvents(type = null, limit = 20) {
    let events = this.events;
    if (type) {
      events = events.filter(e => e.type === type);
    }
    return events.slice(-limit);
  }

  /**
   * Get inferred intent
   */
  getIntent() {
    return {
      intent: this.context.inferredIntent,
      confidence: this.context.intentConfidence,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LISTENERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to context changes
   */
  subscribe(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);

    return () => {
      const callbacks = this.listeners.get(eventType);
      const idx = callbacks.indexOf(callback);
      if (idx >= 0) callbacks.splice(idx, 1);
    };
  }

  /**
   * Notify listeners
   */
  notifyListeners(eventType, data) {
    const callbacks = this.listeners.get(eventType) || [];
    for (const callback of callbacks) {
      try {
        callback(data, this.getSnapshot());
      } catch (e) {
        logger.error('CopilotContext', 'Listener error', { error: e.message });
      }
    }

    // Also notify wildcard listeners
    const wildcardCallbacks = this.listeners.get('*') || [];
    for (const callback of wildcardCallbacks) {
      try {
        callback(eventType, data, this.getSnapshot());
      } catch (e) {
        logger.error('CopilotContext', 'Wildcard listener error', { error: e.message });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESET & STATS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Clear context
   */
  clear() {
    this.context = {
      currentFile: null,
      openFiles: [],
      recentFiles: [],
      selection: null,
      cursorPosition: null,
      visibleRange: null,
      projectRoot: this.context.projectRoot,
      language: null,
      framework: null,
      branch: null,
      uncommittedChanges: [],
      recentCommits: [],
      errors: [],
      warnings: [],
      recentCommands: [],
      recentQueries: [],
      inferredIntent: null,
      intentConfidence: 0,
    };
    this.events = [];
    logger.debug('CopilotContext', 'Context cleared');
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      eventCount: this.events.length,
      openFiles: this.context.openFiles.length,
      errorCount: this.context.errors.length,
      listenerCount: Array.from(this.listeners.values()).reduce((a, b) => a + b.length, 0),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const copilotContext = new CopilotContext();

export default CopilotContext;
