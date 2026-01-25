// CRE v44.3 — FÁZE D: Agent Output Contract
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 9 — SYSTEM UNIFICATION
//
// AgentOutputContract: Structured output format for agents
// - No "chatty" responses - only structured data
// - Status, progress, next_action, summary, logs_ref
// - Visibility levels: hidden | summarized | verbose
//
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseSpeaker, ChatMode, ResponseTag, TaggedResponse } from './chat-controller.js';

// ─────────────────────────────────────────────────────────────────────────────
// Agent Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent execution status
 * @readonly
 * @enum {string}
 */
export const AgentStatus = Object.freeze({
  /** Agent is idle, waiting for task */
  IDLE: 'idle',
  /** Agent is running */
  RUNNING: 'running',
  /** Agent completed successfully */
  COMPLETED: 'completed',
  /** Agent failed */
  FAILED: 'failed',
  /** Agent was cancelled */
  CANCELLED: 'cancelled',
  /** Agent is paused, waiting for input */
  PAUSED: 'paused',
  /** Agent needs human approval */
  AWAITING_APPROVAL: 'awaiting_approval',
});

/**
 * Agent visibility levels
 * @readonly
 * @enum {string}
 */
export const VisibilityLevel = Object.freeze({
  /** Hidden - only errors shown to user */
  HIDDEN: 'hidden',
  /** Summarized - show summary only */
  SUMMARIZED: 'summarized',
  /** Verbose - show all details */
  VERBOSE: 'verbose',
});

/**
 * Action types for next_action
 * @readonly
 * @enum {string}
 */
export const ActionType = Object.freeze({
  /** No action needed */
  NONE: 'none',
  /** Continue execution */
  CONTINUE: 'continue',
  /** Wait for user input */
  WAIT_INPUT: 'wait_input',
  /** Wait for approval */
  WAIT_APPROVAL: 'wait_approval',
  /** Retry failed operation */
  RETRY: 'retry',
  /** Abort execution */
  ABORT: 'abort',
  /** Hand off to another agent/expert */
  HANDOFF: 'handoff',
});

// ─────────────────────────────────────────────────────────────────────────────
// Progress Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Progress indicator
 */
export class AgentProgress {
  #current;
  #total;
  #phase;
  #message;
  #percentage;

  /**
   * @param {Object} options
   * @param {number} options.current - Current step
   * @param {number} options.total - Total steps
   * @param {string} [options.phase] - Current phase name
   * @param {string} [options.message] - Progress message
   */
  constructor({ current, total, phase = '', message = '' }) {
    if (typeof current !== 'number' || current < 0) {
      throw new Error('current must be a non-negative number');
    }
    if (typeof total !== 'number' || total < 0) {
      throw new Error('total must be a non-negative number');
    }
    if (current > total) {
      throw new Error('current cannot exceed total');
    }

    this.#current = current;
    this.#total = total;
    this.#phase = phase;
    this.#message = message;
    this.#percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    Object.freeze(this);
  }

  get current() { return this.#current; }
  get total() { return this.#total; }
  get phase() { return this.#phase; }
  get message() { return this.#message; }
  get percentage() { return this.#percentage; }
  get isComplete() { return this.#current >= this.#total; }

  toJSON() {
    return {
      current: this.#current,
      total: this.#total,
      phase: this.#phase,
      message: this.#message,
      percentage: this.#percentage,
    };
  }

  /**
   * Create initial progress
   */
  static initial(total, phase = 'Initializing') {
    return new AgentProgress({ current: 0, total, phase });
  }

  /**
   * Create completed progress
   */
  static completed(total) {
    return new AgentProgress({ current: total, total, phase: 'Completed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Next Action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Next action specification
 */
export class NextAction {
  #type;
  #description;
  #params;
  #timeout;

  /**
   * @param {Object} options
   * @param {string} options.type - ActionType
   * @param {string} [options.description] - Human-readable description
   * @param {Object} [options.params] - Action parameters
   * @param {number} [options.timeout] - Timeout in ms
   */
  constructor({ type, description = '', params = {}, timeout = null }) {
    if (!Object.values(ActionType).includes(type)) {
      throw new Error(`Invalid action type: ${type}`);
    }

    this.#type = type;
    this.#description = description;
    this.#params = Object.freeze({ ...params });
    this.#timeout = timeout;
    Object.freeze(this);
  }

  get type() { return this.#type; }
  get description() { return this.#description; }
  get params() { return this.#params; }
  get timeout() { return this.#timeout; }

  get requiresInput() {
    return this.#type === ActionType.WAIT_INPUT ||
           this.#type === ActionType.WAIT_APPROVAL;
  }

  toJSON() {
    return {
      type: this.#type,
      description: this.#description,
      params: this.#params,
      timeout: this.#timeout,
    };
  }

  /**
   * Create a "continue" action
   */
  static continue(description = 'Continue execution') {
    return new NextAction({ type: ActionType.CONTINUE, description });
  }

  /**
   * Create a "none" action (done)
   */
  static none() {
    return new NextAction({ type: ActionType.NONE, description: 'No further action' });
  }

  /**
   * Create a "wait for approval" action
   */
  static waitApproval(description, params = {}) {
    return new NextAction({
      type: ActionType.WAIT_APPROVAL,
      description,
      params,
    });
  }

  /**
   * Create a "wait for input" action
   */
  static waitInput(description, params = {}) {
    return new NextAction({
      type: ActionType.WAIT_INPUT,
      description,
      params,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Reference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reference to execution logs
 */
export class LogsReference {
  #id;
  #path;
  #lineCount;
  #lastLines;
  #hasErrors;
  #errorCount;

  /**
   * @param {Object} options
   * @param {string} options.id - Log identifier
   * @param {string} [options.path] - Path to log file
   * @param {number} [options.lineCount] - Total line count
   * @param {string[]} [options.lastLines] - Last few lines preview
   * @param {boolean} [options.hasErrors] - Whether logs contain errors
   * @param {number} [options.errorCount] - Number of errors
   */
  constructor({ id, path = null, lineCount = 0, lastLines = [], hasErrors = false, errorCount = 0 }) {
    this.#id = id;
    this.#path = path;
    this.#lineCount = lineCount;
    this.#lastLines = Object.freeze([...lastLines]);
    this.#hasErrors = hasErrors;
    this.#errorCount = errorCount;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get path() { return this.#path; }
  get lineCount() { return this.#lineCount; }
  get lastLines() { return this.#lastLines; }
  get hasErrors() { return this.#hasErrors; }
  get errorCount() { return this.#errorCount; }

  toJSON() {
    return {
      id: this.#id,
      path: this.#path,
      line_count: this.#lineCount,
      last_lines: this.#lastLines,
      has_errors: this.#hasErrors,
      error_count: this.#errorCount,
    };
  }

  /**
   * Create an empty logs reference
   */
  static empty(id) {
    return new LogsReference({ id });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Output Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AgentOutputContract - Structured output for agents
 *
 * This is THE contract for agent output. No chatty responses.
 * Fields:
 * - status: Current execution status
 * - progress: Step progress indicator
 * - next_action: What happens next
 * - summary: Human-readable summary
 * - logs_ref: Reference to execution logs
 * - artifacts: Output artifacts (files, data, etc.)
 * - errors: Any errors encountered
 */
export class AgentOutputContract {
  #agentId;
  #taskId;
  #status;
  #progress;
  #nextAction;
  #summary;
  #logsRef;
  #artifacts;
  #errors;
  #timestamp;
  #metadata;

  /**
   * @param {Object} options
   * @param {string} options.agentId - Agent identifier
   * @param {string} options.taskId - Task identifier
   * @param {string} options.status - AgentStatus
   * @param {AgentProgress} options.progress - Progress indicator
   * @param {NextAction} options.nextAction - Next action
   * @param {string} options.summary - Human-readable summary
   * @param {LogsReference} [options.logsRef] - Logs reference
   * @param {Object[]} [options.artifacts] - Output artifacts
   * @param {Object[]} [options.errors] - Errors
   * @param {Object} [options.metadata] - Additional metadata
   */
  constructor({
    agentId,
    taskId,
    status,
    progress,
    nextAction,
    summary,
    logsRef = null,
    artifacts = [],
    errors = [],
    metadata = {},
  }) {
    if (!agentId) throw new Error('agentId is required');
    if (!taskId) throw new Error('taskId is required');
    if (!Object.values(AgentStatus).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    if (!(progress instanceof AgentProgress)) {
      throw new Error('progress must be an AgentProgress instance');
    }
    if (!(nextAction instanceof NextAction)) {
      throw new Error('nextAction must be a NextAction instance');
    }
    if (typeof summary !== 'string') {
      throw new Error('summary must be a string');
    }

    this.#agentId = agentId;
    this.#taskId = taskId;
    this.#status = status;
    this.#progress = progress;
    this.#nextAction = nextAction;
    this.#summary = summary;
    this.#logsRef = logsRef;
    this.#artifacts = Object.freeze([...artifacts]);
    this.#errors = Object.freeze([...errors]);
    this.#timestamp = Date.now();
    this.#metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }

  get agentId() { return this.#agentId; }
  get taskId() { return this.#taskId; }
  get status() { return this.#status; }
  get progress() { return this.#progress; }
  get nextAction() { return this.#nextAction; }
  get summary() { return this.#summary; }
  get logsRef() { return this.#logsRef; }
  get artifacts() { return this.#artifacts; }
  get errors() { return this.#errors; }
  get timestamp() { return this.#timestamp; }
  get metadata() { return this.#metadata; }

  /** Status helpers */
  get isRunning() { return this.#status === AgentStatus.RUNNING; }
  get isComplete() { return this.#status === AgentStatus.COMPLETED; }
  get isFailed() { return this.#status === AgentStatus.FAILED; }
  get isPaused() { return this.#status === AgentStatus.PAUSED; }
  get needsApproval() { return this.#status === AgentStatus.AWAITING_APPROVAL; }
  get hasErrors() { return this.#errors.length > 0; }

  toJSON() {
    return {
      agent_id: this.#agentId,
      task_id: this.#taskId,
      status: this.#status,
      progress: this.#progress.toJSON(),
      next_action: this.#nextAction.toJSON(),
      summary: this.#summary,
      logs_ref: this.#logsRef?.toJSON() || null,
      artifacts: this.#artifacts,
      errors: this.#errors,
      timestamp: this.#timestamp,
      metadata: this.#metadata,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibility Formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format agent output based on visibility level
 */
export class VisibilityFormatter {
  #level;
  #config;

  /**
   * @param {string} level - VisibilityLevel
   * @param {Object} [config] - Formatting configuration
   */
  constructor(level = VisibilityLevel.SUMMARIZED, config = {}) {
    if (!Object.values(VisibilityLevel).includes(level)) {
      throw new Error(`Invalid visibility level: ${level}`);
    }

    this.#level = level;
    this.#config = {
      maxSummaryLength: 200,
      showProgressBar: true,
      showErrors: true,
      ...config,
    };
  }

  get level() { return this.#level; }

  /**
   * Set visibility level
   */
  setLevel(level) {
    if (!Object.values(VisibilityLevel).includes(level)) {
      throw new Error(`Invalid visibility level: ${level}`);
    }
    this.#level = level;
  }

  /**
   * Format agent output for display
   * @param {AgentOutputContract} output - Agent output
   * @returns {{ content: string, shouldDisplay: boolean }}
   */
  format(output) {
    if (!(output instanceof AgentOutputContract)) {
      throw new Error('Output must be an AgentOutputContract instance');
    }

    switch (this.#level) {
      case VisibilityLevel.HIDDEN:
        return this.#formatHidden(output);

      case VisibilityLevel.SUMMARIZED:
        return this.#formatSummarized(output);

      case VisibilityLevel.VERBOSE:
        return this.#formatVerbose(output);

      default:
        return this.#formatSummarized(output);
    }
  }

  /**
   * Create a TaggedResponse from agent output
   */
  toTaggedResponse(output) {
    const formatted = this.format(output);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.AGENT,
      mode: ChatMode.AGENT,
      confidence: output.isComplete ? 1.0 : 0.8,
      canExecute: output.nextAction.requiresInput,
      metadata: {
        agent_id: output.agentId,
        task_id: output.taskId,
        status: output.status,
        visibility: this.#level,
        progress: output.progress.percentage,
      },
    });

    const actions = output.nextAction.requiresInput
      ? [{
          type: output.nextAction.type,
          description: output.nextAction.description,
          params: output.nextAction.params,
        }]
      : [];

    return new TaggedResponse({
      content: formatted.content,
      tag,
      actions,
    });
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  #formatHidden(output) {
    // Only show errors
    if (output.hasErrors || output.isFailed) {
      const errorMsg = output.errors.length > 0
        ? output.errors.map(e => e.message || e).join('\n')
        : output.summary;

      return {
        content: `[Agent Error] ${errorMsg}`,
        shouldDisplay: true,
      };
    }

    // Don't display anything for successful hidden operations
    return {
      content: '',
      shouldDisplay: false,
    };
  }

  #formatSummarized(output) {
    const parts = [];

    // Status icon
    const statusIcon = this.#getStatusIcon(output.status);
    parts.push(`${statusIcon} [${output.status.toUpperCase()}]`);

    // Progress
    if (this.#config.showProgressBar && output.isRunning) {
      parts.push(this.#formatProgressBar(output.progress));
    }

    // Summary (truncated)
    let summary = output.summary;
    if (summary.length > this.#config.maxSummaryLength) {
      summary = summary.slice(0, this.#config.maxSummaryLength) + '...';
    }
    parts.push(summary);

    // Errors (if any)
    if (this.#config.showErrors && output.hasErrors) {
      parts.push(`\nErrors: ${output.errors.length}`);
    }

    return {
      content: parts.join(' '),
      shouldDisplay: true,
    };
  }

  #formatVerbose(output) {
    const lines = [];

    // Header
    lines.push(`═══ Agent: ${output.agentId} ═══`);
    lines.push(`Task: ${output.taskId}`);
    lines.push(`Status: ${output.status}`);
    lines.push('');

    // Progress
    const progress = output.progress;
    lines.push(`Progress: ${progress.current}/${progress.total} (${progress.percentage}%)`);
    if (progress.phase) lines.push(`Phase: ${progress.phase}`);
    if (progress.message) lines.push(`Message: ${progress.message}`);
    lines.push('');

    // Summary
    lines.push('Summary:');
    lines.push(output.summary);
    lines.push('');

    // Next Action
    const next = output.nextAction;
    lines.push(`Next Action: ${next.type}`);
    if (next.description) lines.push(`  ${next.description}`);
    lines.push('');

    // Artifacts
    if (output.artifacts.length > 0) {
      lines.push(`Artifacts: ${output.artifacts.length}`);
      for (const artifact of output.artifacts) {
        lines.push(`  - ${artifact.name || artifact.type || 'unknown'}`);
      }
      lines.push('');
    }

    // Logs
    if (output.logsRef) {
      lines.push(`Logs: ${output.logsRef.lineCount} lines`);
      if (output.logsRef.path) lines.push(`  Path: ${output.logsRef.path}`);
      if (output.logsRef.hasErrors) lines.push(`  Errors: ${output.logsRef.errorCount}`);
      lines.push('');
    }

    // Errors
    if (output.hasErrors) {
      lines.push('Errors:');
      for (const error of output.errors) {
        lines.push(`  - ${error.message || error}`);
      }
    }

    return {
      content: lines.join('\n'),
      shouldDisplay: true,
    };
  }

  #getStatusIcon(status) {
    const icons = {
      [AgentStatus.IDLE]: '⏸',
      [AgentStatus.RUNNING]: '▶',
      [AgentStatus.COMPLETED]: '✓',
      [AgentStatus.FAILED]: '✗',
      [AgentStatus.CANCELLED]: '⊘',
      [AgentStatus.PAUSED]: '⏸',
      [AgentStatus.AWAITING_APPROVAL]: '?',
    };
    return icons[status] || '•';
  }

  #formatProgressBar(progress, width = 20) {
    const filled = Math.round((progress.percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${progress.percentage}%`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Output Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builder for AgentOutputContract
 */
export class AgentOutputBuilder {
  #agentId;
  #taskId;
  #status;
  #progress;
  #nextAction;
  #summary;
  #logsRef;
  #artifacts;
  #errors;
  #metadata;

  constructor(agentId, taskId) {
    this.#agentId = agentId;
    this.#taskId = taskId;
    this.#status = AgentStatus.IDLE;
    this.#progress = AgentProgress.initial(1);
    this.#nextAction = NextAction.none();
    this.#summary = '';
    this.#logsRef = null;
    this.#artifacts = [];
    this.#errors = [];
    this.#metadata = {};
  }

  status(status) {
    this.#status = status;
    return this;
  }

  progress(current, total, phase = '', message = '') {
    this.#progress = new AgentProgress({ current, total, phase, message });
    return this;
  }

  nextAction(action) {
    this.#nextAction = action instanceof NextAction
      ? action
      : new NextAction(action);
    return this;
  }

  summary(text) {
    this.#summary = text;
    return this;
  }

  logsRef(ref) {
    this.#logsRef = ref instanceof LogsReference
      ? ref
      : new LogsReference(ref);
    return this;
  }

  addArtifact(artifact) {
    this.#artifacts.push(artifact);
    return this;
  }

  addError(error) {
    this.#errors.push(typeof error === 'string' ? { message: error } : error);
    return this;
  }

  metadata(data) {
    this.#metadata = { ...this.#metadata, ...data };
    return this;
  }

  build() {
    return new AgentOutputContract({
      agentId: this.#agentId,
      taskId: this.#taskId,
      status: this.#status,
      progress: this.#progress,
      nextAction: this.#nextAction,
      summary: this.#summary,
      logsRef: this.#logsRef,
      artifacts: this.#artifacts,
      errors: this.#errors,
      metadata: this.#metadata,
    });
  }

  // ─── Convenience Methods ─────────────────────────────────────────────────

  /**
   * Build a "running" output
   */
  running(current, total, phase, message = '') {
    return this
      .status(AgentStatus.RUNNING)
      .progress(current, total, phase, message)
      .nextAction(NextAction.continue())
      .build();
  }

  /**
   * Build a "completed" output
   */
  completed(summary, artifacts = []) {
    const total = this.#progress.total || 1;
    this.#artifacts = artifacts;
    return this
      .status(AgentStatus.COMPLETED)
      .progress(total, total, 'Completed')
      .nextAction(NextAction.none())
      .summary(summary)
      .build();
  }

  /**
   * Build a "failed" output
   */
  failed(error, summary = '') {
    return this
      .status(AgentStatus.FAILED)
      .nextAction(new NextAction({ type: ActionType.ABORT, description: 'Execution failed' }))
      .summary(summary || `Failed: ${error}`)
      .addError(error)
      .build();
  }

  /**
   * Build an "awaiting approval" output
   */
  awaitingApproval(description, params = {}) {
    return this
      .status(AgentStatus.AWAITING_APPROVAL)
      .nextAction(NextAction.waitApproval(description, params))
      .build();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an AgentOutputBuilder
 */
export function createAgentOutputBuilder(agentId, taskId) {
  return new AgentOutputBuilder(agentId, taskId);
}

/**
 * Create a VisibilityFormatter
 */
export function createVisibilityFormatter(level = VisibilityLevel.SUMMARIZED, config = {}) {
  return new VisibilityFormatter(level, config);
}

/**
 * Create an AgentProgress
 */
export function createAgentProgress(options) {
  return new AgentProgress(options);
}

/**
 * Create a NextAction
 */
export function createNextAction(options) {
  return new NextAction(options);
}

/**
 * Create a LogsReference
 */
export function createLogsReference(options) {
  return new LogsReference(options);
}
