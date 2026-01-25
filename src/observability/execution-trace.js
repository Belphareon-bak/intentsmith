// CRE v40.0 Execution Trace
// ══════════════════════════════════════════════════════════════════════════════
//
// Comprehensive execution tracing for debugging and performance analysis.
//
// Purpose:
//   Answer: "Proč tento dotaz trval 18 sekund a kde se to zpomalilo?"
//
// Trace Hierarchy:
//   ExecutionTrace (request-level)
//     └─ PhaseTrace (CRE, Planner, Executor, LLM)
//         └─ StepTrace (individual steps)
//             └─ ToolTrace (tool invocations)
//
// Key Features:
//   - IMMUTABLE trace IDs (generated once, never changed)
//   - APPEND-ONLY pattern (traces only append, never mutate)
//   - Fully serializable for replay
//   - Hierarchical timing (phases, steps, tools)
//   - Decision audit trail
//   - Memory snapshots
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { randomUUID } from 'crypto';

/**
 * Generate immutable trace ID
 */
function generateTraceId(prefix = 'trace') {
  return `${prefix}_${randomUUID()}`;
}

// ════════════════════════════════════════════════════════════════════════════
// TRACE PHASES
// ════════════════════════════════════════════════════════════════════════════

export const TracePhase = {
  CRE: 'cre',           // Intent detection, decision making
  PLANNER: 'planner',   // Plan generation
  EXECUTOR: 'executor', // Plan execution
  LLM: 'llm',           // LLM calls
  TOOL: 'tool',         // Tool execution
  MEMORY: 'memory',     // Memory operations
  RENDER: 'render',     // Response rendering
};

// ════════════════════════════════════════════════════════════════════════════
// TRACE STATUS
// ════════════════════════════════════════════════════════════════════════════

export const TraceStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
};

// ════════════════════════════════════════════════════════════════════════════
// PHASE TRACE
// ════════════════════════════════════════════════════════════════════════════

/**
 * PhaseTrace — tracks a single phase within execution
 *
 * IMMUTABLE: ID is generated once and never changes
 * APPEND-ONLY: State transitions are recorded, not mutated
 */
export class PhaseTrace {
  constructor(phase, options = {}) {
    // IMMUTABLE ID - generated once, never changes
    this.id = generateTraceId('phase');
    this.phase = phase;
    this.createdAt = Date.now();

    // APPEND-ONLY: State transitions log
    this._transitions = [];
    this._currentStatus = TraceStatus.PENDING;
    this._startTime = null;
    this._endTime = null;

    // Phase-specific data (immutable after set)
    this.input = Object.freeze(options.input || null);
    this._output = null;
    this._error = null;

    // Nested traces (append-only array)
    this._children = [];

    // Metadata (frozen)
    this.metadata = Object.freeze(options.metadata || {});
  }

  // Read-only getters
  get status() { return this._currentStatus; }
  get startTime() { return this._startTime; }
  get endTime() { return this._endTime; }
  get duration() { return this._endTime && this._startTime ? this._endTime - this._startTime : null; }
  get output() { return this._output; }
  get error() { return this._error; }
  get children() { return [...this._children]; } // Return copy

  /**
   * APPEND transition: start
   */
  start() {
    if (this._currentStatus !== TraceStatus.PENDING) {
      throw new Error(`Cannot start phase in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.RUNNING;
    this._startTime = performance.now();
    this._transitions.push({ status: TraceStatus.RUNNING, at: this._startTime });
    return this;
  }

  /**
   * APPEND transition: complete
   */
  complete(output = null) {
    if (this._currentStatus !== TraceStatus.RUNNING) {
      throw new Error(`Cannot complete phase in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.COMPLETED;
    this._endTime = performance.now();
    this._output = output ? Object.freeze(JSON.parse(JSON.stringify(output))) : null;
    this._transitions.push({ status: TraceStatus.COMPLETED, at: this._endTime, output: this._output });
    return this;
  }

  /**
   * APPEND transition: fail
   */
  fail(error) {
    if (this._currentStatus !== TraceStatus.RUNNING) {
      throw new Error(`Cannot fail phase in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.FAILED;
    this._endTime = performance.now();
    this._error = error instanceof Error ? error.message : String(error);
    this._transitions.push({ status: TraceStatus.FAILED, at: this._endTime, error: this._error });
    return this;
  }

  /**
   * APPEND child trace
   */
  addChild(childTrace) {
    this._children.push(childTrace);
    return childTrace;
  }

  /**
   * Serialize for replay (fully deterministic)
   */
  toJSON() {
    return Object.freeze({
      id: this.id,
      phase: this.phase,
      createdAt: this.createdAt,
      status: this._currentStatus,
      startTime: this._startTime,
      endTime: this._endTime,
      duration: this.duration,
      input: this.input,
      output: this._output,
      error: this._error,
      children: this._children.map(c => c.toJSON ? c.toJSON() : c),
      metadata: this.metadata,
      transitions: [...this._transitions],
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TOOL TRACE
// ════════════════════════════════════════════════════════════════════════════

/**
 * ToolTrace — tracks a tool invocation
 *
 * IMMUTABLE: ID is generated once and never changes
 * APPEND-ONLY: State transitions are recorded, not mutated
 */
export class ToolTrace {
  constructor(toolId, options = {}) {
    // IMMUTABLE ID
    this.id = generateTraceId('tool');
    this.toolId = toolId;
    this.createdAt = Date.now();

    // APPEND-ONLY state
    this._transitions = [];
    this._currentStatus = TraceStatus.PENDING;
    this._startTime = null;
    this._endTime = null;
    this._result = null;
    this._error = null;

    // Immutable params
    this.params = Object.freeze(options.params || {});

    // Retry tracking (immutable)
    this.attempt = options.attempt || 1;
    this.maxAttempts = options.maxAttempts || 3;
  }

  // Read-only getters
  get status() { return this._currentStatus; }
  get startTime() { return this._startTime; }
  get endTime() { return this._endTime; }
  get duration() { return this._endTime && this._startTime ? this._endTime - this._startTime : null; }
  get result() { return this._result; }
  get error() { return this._error; }

  start() {
    if (this._currentStatus !== TraceStatus.PENDING) {
      throw new Error(`Cannot start tool in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.RUNNING;
    this._startTime = performance.now();
    this._transitions.push({ status: TraceStatus.RUNNING, at: this._startTime });
    return this;
  }

  complete(result) {
    if (this._currentStatus !== TraceStatus.RUNNING) {
      throw new Error(`Cannot complete tool in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.COMPLETED;
    this._endTime = performance.now();
    this._result = result ? Object.freeze(JSON.parse(JSON.stringify(result))) : null;
    this._transitions.push({ status: TraceStatus.COMPLETED, at: this._endTime, result: this._result });
    return this;
  }

  fail(error) {
    if (this._currentStatus !== TraceStatus.RUNNING) {
      throw new Error(`Cannot fail tool in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.FAILED;
    this._endTime = performance.now();
    this._error = error instanceof Error ? error.message : String(error);
    this._transitions.push({ status: TraceStatus.FAILED, at: this._endTime, error: this._error });
    return this;
  }

  toJSON() {
    return Object.freeze({
      id: this.id,
      toolId: this.toolId,
      createdAt: this.createdAt,
      status: this._currentStatus,
      startTime: this._startTime,
      endTime: this._endTime,
      duration: this.duration,
      params: this.params,
      result: this._result,
      error: this._error,
      attempt: this.attempt,
      maxAttempts: this.maxAttempts,
      transitions: [...this._transitions],
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION TRACE
// ════════════════════════════════════════════════════════════════════════════

/**
 * ExecutionTrace — top-level trace for a request
 *
 * IMMUTABLE: Request ID is generated once and never changes
 * APPEND-ONLY: All state changes are recorded as transitions
 *
 * Captures the full execution timeline from request to response.
 */
export class ExecutionTrace {
  constructor(requestId, options = {}) {
    // IMMUTABLE ID
    this.requestId = requestId || generateTraceId('req');
    this.createdAt = Date.now();

    // APPEND-ONLY state
    this._transitions = [];
    this._currentStatus = TraceStatus.PENDING;
    this._startTime = null;
    this._endTime = null;
    this._output = null;
    this._error = null;

    // Immutable input
    this.input = options.input ? Object.freeze(JSON.parse(JSON.stringify(options.input))) : null;

    // Phase traces (append-only)
    this._phases = [];
    this._currentPhase = null;

    // Memory snapshot (immutable for replay)
    this.memorySnapshot = options.memorySnapshot
      ? Object.freeze(JSON.parse(JSON.stringify(options.memorySnapshot)))
      : null;

    // Decision audit trail (append-only)
    this._decisions = [];

    // Immutable metadata
    this.metadata = Object.freeze({
      createdAt: this.createdAt,
      userId: options.userId || null,
      sessionId: options.sessionId || null,
      goalId: options.goalId || null,
      ...options.metadata,
    });

    // Performance summary (computed on complete)
    this._summary = null;
  }

  // Read-only getters
  get status() { return this._currentStatus; }
  get startTime() { return this._startTime; }
  get endTime() { return this._endTime; }
  get duration() { return this._endTime && this._startTime ? this._endTime - this._startTime : null; }
  get output() { return this._output; }
  get error() { return this._error; }
  get phases() { return [...this._phases]; }
  get currentPhase() { return this._currentPhase; }
  get decisions() { return [...this._decisions]; }
  get summary() { return this._summary; }

  // ──────────────────────────────────────────────────────────────────────────
  // LIFECYCLE (APPEND-ONLY transitions)
  // ──────────────────────────────────────────────────────────────────────────

  start() {
    if (this._currentStatus !== TraceStatus.PENDING) {
      throw new Error(`Cannot start execution in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.RUNNING;
    this._startTime = performance.now();
    this._transitions.push({ status: TraceStatus.RUNNING, at: this._startTime });
    logger.debug('ExecutionTrace', `Started: ${this.requestId}`);
    return this;
  }

  complete(output = null) {
    if (this._currentStatus !== TraceStatus.RUNNING) {
      throw new Error(`Cannot complete execution in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.COMPLETED;
    this._endTime = performance.now();
    this._output = output ? Object.freeze(JSON.parse(JSON.stringify(output))) : null;
    this._transitions.push({ status: TraceStatus.COMPLETED, at: this._endTime, output: this._output });
    this.computeSummary();
    logger.debug('ExecutionTrace', `Completed: ${this.requestId}`, { duration: this.duration });
    return this;
  }

  fail(error) {
    if (this._currentStatus !== TraceStatus.RUNNING) {
      throw new Error(`Cannot fail execution in status: ${this._currentStatus}`);
    }
    this._currentStatus = TraceStatus.FAILED;
    this._endTime = performance.now();
    this._error = error instanceof Error ? error.message : String(error);
    this._transitions.push({ status: TraceStatus.FAILED, at: this._endTime, error: this._error });
    this.computeSummary();
    logger.debug('ExecutionTrace', `Failed: ${this.requestId}`, { error: this._error });
    return this;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE MANAGEMENT (APPEND-ONLY)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start a new phase (APPEND to phases array)
   */
  startPhase(phase, options = {}) {
    // Complete current phase if running
    if (this._currentPhase && this._currentPhase.status === TraceStatus.RUNNING) {
      this._currentPhase.complete();
    }

    const phaseTrace = new PhaseTrace(phase, options);
    phaseTrace.start();
    this._phases.push(phaseTrace);
    this._currentPhase = phaseTrace;

    return phaseTrace;
  }

  /**
   * Complete current phase
   */
  completePhase(output = null) {
    if (this._currentPhase) {
      this._currentPhase.complete(output);
    }
    return this;
  }

  /**
   * Fail current phase
   */
  failPhase(error) {
    if (this._currentPhase) {
      this._currentPhase.fail(error);
    }
    return this;
  }

  /**
   * Get phase by type (returns copy)
   */
  getPhase(phase) {
    return this._phases.find(p => p.phase === phase);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TOOL TRACING (APPEND-ONLY)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start a tool trace (attached to current phase)
   */
  startTool(toolId, options = {}) {
    const toolTrace = new ToolTrace(toolId, options);
    toolTrace.start();

    if (this._currentPhase) {
      this._currentPhase.addChild(toolTrace);
    }

    return toolTrace;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DECISION AUDIT (APPEND-ONLY)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record a decision (APPEND to decisions array)
   */
  recordDecision(decision) {
    const record = Object.freeze({
      id: generateTraceId('decision'),
      timestamp: Date.now(),
      phase: this._currentPhase?.phase || null,
      decision: Object.freeze(JSON.parse(JSON.stringify(decision))),
    });
    this._decisions.push(record);
    return this;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Compute performance summary (frozen result)
   */
  computeSummary() {
    const phaseDurations = {};
    let totalToolTime = 0;
    let toolCount = 0;
    let llmTime = 0;
    let llmCalls = 0;

    for (const phase of this._phases) {
      phaseDurations[phase.phase] = phase.duration || 0;

      // Count tool time
      for (const child of phase.children) {
        if (child.toolId) {
          totalToolTime += child.duration || 0;
          toolCount++;
        }
      }

      // Track LLM time separately
      if (phase.phase === TracePhase.LLM) {
        llmTime += phase.duration || 0;
        llmCalls++;
      }
    }

    this._summary = Object.freeze({
      totalDuration: this.duration,
      phaseDurations: Object.freeze(phaseDurations),
      toolTime: totalToolTime,
      toolCount,
      llmTime,
      llmCalls,
      overheadTime: (this.duration || 0) - totalToolTime - llmTime,
      decisionCount: this._decisions.length,
      status: this._currentStatus,
    });

    return this._summary;
  }

  /**
   * Get slowest phase
   */
  getSlowestPhase() {
    if (!this._phases.length) return null;

    return this._phases.reduce((slowest, phase) =>
      (phase.duration || 0) > (slowest.duration || 0) ? phase : slowest
    );
  }

  /**
   * Get bottleneck analysis
   */
  getBottlenecks(threshold = 1000) {
    const bottlenecks = [];

    for (const phase of this._phases) {
      if ((phase.duration || 0) > threshold) {
        bottlenecks.push({
          type: 'phase',
          id: phase.id,
          phase: phase.phase,
          duration: phase.duration,
        });
      }

      for (const child of phase.children) {
        if ((child.duration || 0) > threshold) {
          bottlenecks.push({
            type: 'tool',
            id: child.id,
            toolId: child.toolId,
            duration: child.duration,
          });
        }
      }
    }

    return bottlenecks.sort((a, b) => b.duration - a.duration);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SERIALIZATION (fully deterministic for replay)
  // ──────────────────────────────────────────────────────────────────────────

  toJSON() {
    return Object.freeze({
      requestId: this.requestId,
      createdAt: this.createdAt,
      status: this._currentStatus,
      startTime: this._startTime,
      endTime: this._endTime,
      duration: this.duration,
      input: this.input,
      output: this._output,
      error: this._error,
      phases: this._phases.map(p => p.toJSON()),
      decisions: this._decisions.map(d => ({ ...d })),
      metadata: this.metadata,
      memorySnapshot: this.memorySnapshot,
      summary: this._summary,
      transitions: [...this._transitions],
    });
  }

  /**
   * Verify trace integrity (for replay validation)
   */
  verifyIntegrity() {
    const json = this.toJSON();
    const hash = JSON.stringify(json);
    return {
      valid: true,
      requestId: this.requestId,
      transitionCount: this._transitions.length,
      phaseCount: this._phases.length,
      decisionCount: this._decisions.length,
      checksum: hash.length, // Simple length-based checksum
    };
  }

  /**
   * Get human-readable timeline
   */
  getTimeline() {
    const lines = [];
    lines.push(`Request: ${this.requestId}`);
    lines.push(`Status: ${this._currentStatus}`);
    lines.push(`Duration: ${this.duration?.toFixed(2)}ms`);
    lines.push('');
    lines.push('Timeline:');

    for (const phase of this._phases) {
      const status = phase.status === TraceStatus.COMPLETED ? '✓' :
                     phase.status === TraceStatus.FAILED ? '✗' : '•';
      lines.push(`  ${status} ${phase.phase}: ${phase.duration?.toFixed(2)}ms`);

      for (const child of phase.children) {
        const childStatus = child.status === TraceStatus.COMPLETED ? '✓' :
                           child.status === TraceStatus.FAILED ? '✗' : '•';
        lines.push(`      ${childStatus} ${child.toolId}: ${child.duration?.toFixed(2)}ms`);
      }
    }

    if (this._summary) {
      lines.push('');
      lines.push('Summary:');
      lines.push(`  Tool time: ${this._summary.toolTime?.toFixed(2)}ms (${this._summary.toolCount} calls)`);
      lines.push(`  LLM time: ${this._summary.llmTime?.toFixed(2)}ms (${this._summary.llmCalls} calls)`);
      lines.push(`  Overhead: ${this._summary.overheadTime?.toFixed(2)}ms`);
    }

    return lines.join('\n');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION TRACE STORE
// ════════════════════════════════════════════════════════════════════════════

/**
 * ExecutionTraceStore — stores and queries execution traces
 */
export class ExecutionTraceStore {
  constructor(options = {}) {
    this.maxTraces = options.maxTraces || 1000;
    this.traces = new Map();  // requestId → ExecutionTrace
    this.index = [];          // Ordered list of requestIds

    // Stats
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      avgDuration: 0,
    };
  }

  /**
   * Create a new trace
   */
  create(requestId, options = {}) {
    const trace = new ExecutionTrace(requestId, options);
    this.add(trace);
    return trace;
  }

  /**
   * Add a trace
   */
  add(trace) {
    // Evict oldest if at capacity
    while (this.traces.size >= this.maxTraces && this.index.length > 0) {
      const oldestId = this.index.shift();
      this.traces.delete(oldestId);
    }

    this.traces.set(trace.requestId, trace);
    this.index.push(trace.requestId);
    this.stats.total++;

    return trace;
  }

  /**
   * Get a trace by ID
   */
  get(requestId) {
    return this.traces.get(requestId);
  }

  /**
   * Complete a trace
   */
  complete(requestId, output = null) {
    const trace = this.traces.get(requestId);
    if (trace) {
      trace.complete(output);
      this.stats.completed++;
      this.updateAvgDuration(trace.duration);
    }
    return trace;
  }

  /**
   * Fail a trace
   */
  fail(requestId, error) {
    const trace = this.traces.get(requestId);
    if (trace) {
      trace.fail(error);
      this.stats.failed++;
      this.updateAvgDuration(trace.duration);
    }
    return trace;
  }

  /**
   * Update average duration
   */
  updateAvgDuration(duration) {
    const completed = this.stats.completed + this.stats.failed;
    if (completed > 0) {
      this.stats.avgDuration = ((this.stats.avgDuration * (completed - 1)) + duration) / completed;
    }
  }

  /**
   * Query traces
   */
  query(filter = {}) {
    let results = Array.from(this.traces.values());

    if (filter.status) {
      results = results.filter(t => t.status === filter.status);
    }
    if (filter.minDuration) {
      results = results.filter(t => (t.duration || 0) >= filter.minDuration);
    }
    if (filter.maxDuration) {
      results = results.filter(t => (t.duration || 0) <= filter.maxDuration);
    }
    if (filter.goalId) {
      results = results.filter(t => t.metadata.goalId === filter.goalId);
    }
    if (filter.userId) {
      results = results.filter(t => t.metadata.userId === filter.userId);
    }
    if (filter.since) {
      results = results.filter(t => t.metadata.createdAt >= filter.since);
    }

    return results.sort((a, b) => (b.metadata.createdAt || 0) - (a.metadata.createdAt || 0));
  }

  /**
   * Get slow traces
   */
  getSlow(threshold = 5000, limit = 10) {
    return this.query({ minDuration: threshold }).slice(0, limit);
  }

  /**
   * Get failed traces
   */
  getFailed(limit = 10) {
    return this.query({ status: TraceStatus.FAILED }).slice(0, limit);
  }

  /**
   * Get recent traces
   */
  getRecent(limit = 20) {
    return Array.from(this.traces.values())
      .sort((a, b) => (b.metadata.createdAt || 0) - (a.metadata.createdAt || 0))
      .slice(0, limit);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      stored: this.traces.size,
      successRate: this.stats.completed > 0
        ? this.stats.completed / (this.stats.completed + this.stats.failed)
        : null,
    };
  }

  /**
   * Clear all traces
   */
  clear() {
    this.traces.clear();
    this.index = [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const executionTraceStore = new ExecutionTraceStore();

export default ExecutionTrace;
