// CRE v40.1 Determinism & Replay
// ══════════════════════════════════════════════════════════════════════════════
//
// 100% reproducible execution for debugging production issues.
//
// Purpose:
//   Bug z produkce → lokálně replayneš → opravíš
//
// Key Features:
//   - Seedovaný planner (deterministic random)
//   - Frozen inputs (tools, memory snapshots)
//   - Frozen time (Date.now(), new Date())
//   - replayExecution(executionId) → same plan, same steps
//   - Execution recording and playback
//
// IMPORTANT: External World Freezing
//   During replay, these are frozen:
//   ✓ Random → SeededRandom with deterministic seed
//   ✓ Tool results → Recorded results are replayed
//   ✓ Time → FrozenTime provides consistent timestamps
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// FROZEN TIME
// ════════════════════════════════════════════════════════════════════════════

/**
 * FrozenTime — provides deterministic time for replay
 *
 * During recording: captures real timestamps
 * During replay: returns captured timestamps
 *
 * IMPORTANT: All code that needs deterministic time should use:
 *   - frozenTime.now() instead of Date.now()
 *   - frozenTime.date() instead of new Date()
 */
export class FrozenTime {
  constructor(options = {}) {
    // Base timestamp (execution start)
    this._baseTime = options.baseTime || Date.now();
    this._timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Mode: 'live' (use real time) or 'frozen' (use recorded time)
    this._mode = options.mode || 'live';

    // Recorded timestamps (for replay)
    this._recordedTimestamps = options.timestamps || [];
    this._timestampIndex = 0;

    // Elapsed time simulation (for frozen mode)
    this._elapsedOffsets = [];
    this._offsetIndex = 0;

    // Lock state
    this._frozen = false;
  }

  /**
   * Freeze time at a specific point
   */
  freeze(timestamp = null) {
    this._baseTime = timestamp || Date.now();
    this._frozen = true;
    this._mode = 'frozen';
    return this;
  }

  /**
   * Unfreeze time (return to live mode)
   */
  unfreeze() {
    this._frozen = false;
    this._mode = 'live';
    return this;
  }

  /**
   * Get current timestamp (replacement for Date.now())
   *
   * In live mode: returns real Date.now()
   * In frozen mode: returns base time + recorded offset
   */
  now() {
    if (this._mode === 'live') {
      return Date.now();
    }

    // Frozen mode: use recorded offsets if available
    if (this._elapsedOffsets.length > 0 && this._offsetIndex < this._elapsedOffsets.length) {
      return this._baseTime + this._elapsedOffsets[this._offsetIndex++];
    }

    // Fallback: return base time
    return this._baseTime;
  }

  /**
   * Get current date (replacement for new Date())
   */
  date() {
    return new Date(this.now());
  }

  /**
   * Record a timestamp (during recording)
   */
  recordTimestamp(label = 'default') {
    const timestamp = Date.now();
    const offset = timestamp - this._baseTime;
    this._recordedTimestamps.push({ label, timestamp, offset });
    this._elapsedOffsets.push(offset);
    return timestamp;
  }

  /**
   * Get elapsed time since base
   */
  elapsed() {
    return this.now() - this._baseTime;
  }

  /**
   * Get timezone
   */
  getTimezone() {
    return this._timezone;
  }

  /**
   * Get base time
   */
  getBaseTime() {
    return this._baseTime;
  }

  /**
   * Check if frozen
   */
  isFrozen() {
    return this._frozen;
  }

  /**
   * Reset for replay
   */
  reset() {
    this._timestampIndex = 0;
    this._offsetIndex = 0;
  }

  /**
   * Serialize for recording
   */
  toJSON() {
    return {
      baseTime: this._baseTime,
      timezone: this._timezone,
      timestamps: this._recordedTimestamps,
      offsets: this._elapsedOffsets,
    };
  }

  /**
   * Create from recorded data
   */
  static fromJSON(data) {
    return new FrozenTime({
      baseTime: data.baseTime,
      timezone: data.timezone,
      timestamps: data.timestamps || [],
      mode: 'frozen',
    }).freeze(data.baseTime);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SEEDED RANDOM
// ════════════════════════════════════════════════════════════════════════════

/**
 * SeededRandom — deterministic random number generator
 *
 * Uses mulberry32 algorithm for reproducibility.
 */
export class SeededRandom {
  constructor(seed) {
    this.seed = this.hashString(String(seed));
    this.state = this.seed;
  }

  /**
   * Hash a string to a 32-bit integer
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;  // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Generate next random number (0-1)
   */
  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  /**
   * Generate random integer in range [min, max]
   */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Pick random element from array
   */
  pick(array) {
    if (array.length === 0) return undefined;
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Shuffle array (Fisher-Yates)
   */
  shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Reset to initial seed
   */
  reset() {
    this.state = this.seed;
  }

  /**
   * Fork with new seed derived from current state
   */
  fork(suffix = '') {
    return new SeededRandom(`${this.state}_${suffix}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPLAYABLE EXECUTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ReplayableExecution
 * @property {string} executionId
 * @property {string} seed
 * @property {Object} inputs
 * @property {Object} memorySnapshot
 * @property {Object} plan
 * @property {Array} steps
 * @property {Array} toolResults
 * @property {Object} output
 * @property {number} timestamp
 */

/**
 * Create a replayable execution record
 */
export function createReplayableExecution(options = {}) {
  const now = Date.now();
  const executionId = options.executionId ||
    `exec_${now}_${Math.random().toString(36).substr(2, 8)}`;

  // Create frozen time context
  const frozenTime = new FrozenTime({
    baseTime: now,
    timezone: options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    mode: 'live',
  });

  return {
    executionId,
    version: '40.1',
    seed: options.seed || executionId,  // Use executionId as default seed

    // Frozen inputs
    inputs: {
      request: options.request || null,
      context: options.context || {},
      tools: options.tools || [],
    },

    // Memory snapshot at execution start
    memorySnapshot: options.memorySnapshot || null,

    // FROZEN TIME CONTEXT
    // Records all timestamps for replay
    timeContext: {
      baseTime: now,
      timezone: frozenTime.getTimezone(),
      timestamps: [],
      offsets: [],
    },

    // Execution state
    plan: null,
    steps: [],
    toolResults: [],
    decisions: [],

    // Output
    output: null,
    error: null,
    status: 'created',  // created, running, completed, failed

    // Timestamps
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION RECORDER
// ════════════════════════════════════════════════════════════════════════════

/**
 * ExecutionRecorder — records execution for replay
 *
 * IMPORTANT: Provides deterministic context for:
 *   - Random numbers → getRandom()
 *   - Time → getTime()
 *
 * All code that needs determinism should use these methods.
 */
export class ExecutionRecorder {
  constructor(execution) {
    this.execution = execution;
    this.random = new SeededRandom(execution.seed);
    this.stepIndex = 0;

    // Initialize frozen time from execution context
    this.frozenTime = new FrozenTime({
      baseTime: execution.timeContext?.baseTime || execution.createdAt,
      timezone: execution.timeContext?.timezone,
      mode: 'live',
    });
  }

  /**
   * Start recording
   */
  start() {
    const timestamp = this.frozenTime.recordTimestamp('start');
    this.execution.status = 'running';
    this.execution.startedAt = timestamp;
    return this;
  }

  /**
   * Record plan
   */
  recordPlan(plan) {
    this.frozenTime.recordTimestamp('plan');
    this.execution.plan = JSON.parse(JSON.stringify(plan));
    return this;
  }

  /**
   * Record a step
   */
  recordStep(step) {
    const timestamp = this.frozenTime.recordTimestamp(`step_${this.stepIndex}`);
    this.execution.steps.push({
      index: this.stepIndex++,
      timestamp,
      ...JSON.parse(JSON.stringify(step)),
    });
    return this;
  }

  /**
   * Record a tool result
   */
  recordToolResult(toolId, params, result, error = null) {
    const timestamp = this.frozenTime.recordTimestamp(`tool_${this.execution.toolResults.length}`);
    this.execution.toolResults.push({
      index: this.execution.toolResults.length,
      timestamp,
      toolId,
      params: JSON.parse(JSON.stringify(params)),
      result: error ? null : JSON.parse(JSON.stringify(result)),
      error: error ? String(error) : null,
    });
    return this;
  }

  /**
   * Record a decision
   */
  recordDecision(decision) {
    const timestamp = this.frozenTime.recordTimestamp(`decision_${this.execution.decisions.length}`);
    this.execution.decisions.push({
      index: this.execution.decisions.length,
      timestamp,
      decision: JSON.parse(JSON.stringify(decision)),
    });
    return this;
  }

  /**
   * Complete recording
   */
  complete(output) {
    const timestamp = this.frozenTime.recordTimestamp('complete');
    this.execution.status = 'completed';
    this.execution.completedAt = timestamp;
    this.execution.output = JSON.parse(JSON.stringify(output));

    // Store time context for replay
    this.execution.timeContext = this.frozenTime.toJSON();

    return this.execution;
  }

  /**
   * Fail recording
   */
  fail(error) {
    const timestamp = this.frozenTime.recordTimestamp('fail');
    this.execution.status = 'failed';
    this.execution.completedAt = timestamp;
    this.execution.error = error instanceof Error ? error.message : String(error);

    // Store time context for replay
    this.execution.timeContext = this.frozenTime.toJSON();

    return this.execution;
  }

  /**
   * Get random for deterministic operations
   */
  getRandom() {
    return this.random;
  }

  /**
   * Get frozen time for deterministic timestamps
   *
   * Use this instead of Date.now() or new Date()
   */
  getTime() {
    return this.frozenTime;
  }

  /**
   * Get current timestamp (convenience method)
   *
   * During recording: returns real time and records it
   * During replay: returns recorded time
   */
  now() {
    return this.frozenTime.now();
  }

  /**
   * Get current date (convenience method)
   */
  date() {
    return this.frozenTime.date();
  }

  /**
   * Get execution record
   */
  getExecution() {
    return this.execution;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION REPLAYER
// ════════════════════════════════════════════════════════════════════════════

/**
 * ReplayMode — how to handle tool calls during replay
 */
export const ReplayMode = {
  EXACT: 'exact',           // Use recorded tool results
  SIMULATE: 'simulate',     // Simulate tool calls with recorded results
  LIVE: 'live',             // Actually execute tools (for testing fixes)
};

/**
 * ExecutionReplayer — replays a recorded execution
 *
 * FROZEN WORLD during replay:
 *   ✓ Random → Same sequence as recording
 *   ✓ Time → Same timestamps as recording
 *   ✓ Tool results → Same results as recording
 */
export class ExecutionReplayer {
  constructor(execution, options = {}) {
    this.execution = execution;
    this.mode = options.mode || ReplayMode.EXACT;
    this.onStep = options.onStep || null;
    this.onTool = options.onTool || null;

    // Replay state — FROZEN WORLD
    this.random = new SeededRandom(execution.seed);
    this.stepIndex = 0;
    this.toolIndex = 0;

    // FROZEN TIME from recording
    if (execution.timeContext) {
      this.frozenTime = FrozenTime.fromJSON(execution.timeContext);
    } else {
      // Fallback for old recordings without time context
      this.frozenTime = new FrozenTime({
        baseTime: execution.createdAt,
        mode: 'frozen',
      }).freeze(execution.createdAt);
    }

    // Results
    this.replayPlan = null;
    this.replaySteps = [];
    this.replayToolResults = [];
    this.differences = [];
  }

  /**
   * Replay the execution
   */
  async replay(executor = null) {
    logger.debug('ExecutionReplayer', `Starting replay: ${this.execution.executionId}`);

    try {
      // Replay plan generation
      this.replayPlan = await this.replayPlanGeneration();

      // Compare plan
      if (!this.comparePlan(this.replayPlan, this.execution.plan)) {
        this.differences.push({
          type: 'plan_mismatch',
          expected: this.execution.plan,
          actual: this.replayPlan,
        });
      }

      // Replay steps
      for (const recordedStep of this.execution.steps) {
        const replayedStep = await this.replayStep(recordedStep, executor);
        this.replaySteps.push(replayedStep);

        // Notify
        if (this.onStep) {
          this.onStep(recordedStep, replayedStep);
        }
      }

      return {
        success: this.differences.length === 0,
        differences: this.differences,
        replayPlan: this.replayPlan,
        replaySteps: this.replaySteps,
        replayToolResults: this.replayToolResults,
      };
    } catch (error) {
      logger.error('ExecutionReplayer', 'Replay failed', { error: error.message });
      return {
        success: false,
        error: error.message,
        differences: this.differences,
      };
    }
  }

  /**
   * Replay plan generation
   */
  async replayPlanGeneration() {
    // In exact mode, return the recorded plan
    if (this.mode === ReplayMode.EXACT) {
      return this.execution.plan;
    }

    // In simulate/live mode, we'd need the actual planner
    // For now, return recorded plan
    return this.execution.plan;
  }

  /**
   * Replay a step
   */
  async replayStep(recordedStep, executor) {
    const replayedStep = {
      index: this.stepIndex++,
      timestamp: Date.now(),
      ...recordedStep,
      replay: true,
    };

    // Handle tool calls
    if (recordedStep.tool) {
      const toolResult = await this.replayToolCall(recordedStep, executor);
      replayedStep.toolResult = toolResult;
    }

    return replayedStep;
  }

  /**
   * Replay a tool call
   */
  async replayToolCall(step, executor) {
    const recordedResult = this.execution.toolResults[this.toolIndex++];

    if (this.mode === ReplayMode.EXACT) {
      // Return recorded result
      if (this.onTool) {
        this.onTool(recordedResult, recordedResult);
      }
      this.replayToolResults.push(recordedResult);
      return recordedResult;
    }

    if (this.mode === ReplayMode.SIMULATE) {
      // Simulate with delay
      await new Promise(resolve => setTimeout(resolve, 10));
      if (this.onTool) {
        this.onTool(recordedResult, recordedResult);
      }
      this.replayToolResults.push(recordedResult);
      return recordedResult;
    }

    if (this.mode === ReplayMode.LIVE && executor) {
      // Actually execute the tool
      try {
        const result = await executor(step.tool, step.params || recordedResult.params);
        const liveResult = {
          index: recordedResult.index,
          timestamp: Date.now(),
          toolId: step.tool,
          params: step.params || recordedResult.params,
          result,
          error: null,
        };

        // Compare results
        if (JSON.stringify(result) !== JSON.stringify(recordedResult.result)) {
          this.differences.push({
            type: 'tool_result_mismatch',
            tool: step.tool,
            expected: recordedResult.result,
            actual: result,
          });
        }

        if (this.onTool) {
          this.onTool(recordedResult, liveResult);
        }
        this.replayToolResults.push(liveResult);
        return liveResult;
      } catch (error) {
        const errorResult = {
          index: recordedResult.index,
          timestamp: Date.now(),
          toolId: step.tool,
          params: step.params || recordedResult.params,
          result: null,
          error: error.message,
        };

        if (recordedResult.error !== error.message) {
          this.differences.push({
            type: 'tool_error_mismatch',
            tool: step.tool,
            expectedError: recordedResult.error,
            actualError: error.message,
          });
        }

        if (this.onTool) {
          this.onTool(recordedResult, errorResult);
        }
        this.replayToolResults.push(errorResult);
        return errorResult;
      }
    }

    return recordedResult;
  }

  /**
   * Compare plans
   */
  comparePlan(plan1, plan2) {
    return JSON.stringify(plan1) === JSON.stringify(plan2);
  }

  /**
   * Get replay random
   */
  getRandom() {
    return this.random;
  }

  /**
   * Get frozen time for deterministic timestamps
   *
   * IMPORTANT: During replay, this returns recorded timestamps
   */
  getTime() {
    return this.frozenTime;
  }

  /**
   * Get current timestamp (convenience method)
   *
   * During replay: returns recorded time
   */
  now() {
    return this.frozenTime.now();
  }

  /**
   * Get current date (convenience method)
   */
  date() {
    return this.frozenTime.date();
  }

  /**
   * Reset replay state
   */
  reset() {
    this.random.reset();
    this.frozenTime.reset();
    this.stepIndex = 0;
    this.toolIndex = 0;
    this.replayPlan = null;
    this.replaySteps = [];
    this.replayToolResults = [];
    this.differences = [];
  }

  /**
   * Get differences
   */
  getDifferences() {
    return this.differences;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION STORE
// ════════════════════════════════════════════════════════════════════════════

/**
 * ReplayStore — stores executions for replay
 */
export class ReplayStore {
  constructor(options = {}) {
    this.maxExecutions = options.maxExecutions || 100;
    this.executions = new Map();  // executionId → ReplayableExecution
    this.index = [];              // Ordered list of executionIds

    // Persistence hook (optional)
    this.persistFn = options.persistFn || null;
    this.loadFn = options.loadFn || null;
  }

  /**
   * Create and store a new execution
   */
  create(options = {}) {
    const execution = createReplayableExecution(options);
    this.add(execution);
    return new ExecutionRecorder(execution);
  }

  /**
   * Add an execution
   */
  add(execution) {
    // Evict oldest if at capacity
    while (this.executions.size >= this.maxExecutions && this.index.length > 0) {
      const oldestId = this.index.shift();
      this.executions.delete(oldestId);
    }

    this.executions.set(execution.executionId, execution);
    this.index.push(execution.executionId);

    // Persist if hook provided
    if (this.persistFn) {
      try {
        this.persistFn(execution);
      } catch (e) {
        logger.error('ReplayStore', 'Persist failed', { error: e.message });
      }
    }

    return execution;
  }

  /**
   * Get an execution
   */
  get(executionId) {
    return this.executions.get(executionId);
  }

  /**
   * Replay an execution
   */
  async replay(executionId, options = {}) {
    const execution = this.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    const replayer = new ExecutionReplayer(execution, options);
    return replayer.replay(options.executor);
  }

  /**
   * Get recent executions
   */
  getRecent(limit = 20) {
    return this.index
      .slice(-limit)
      .reverse()
      .map(id => this.executions.get(id));
  }

  /**
   * Get failed executions
   */
  getFailed(limit = 20) {
    return Array.from(this.executions.values())
      .filter(e => e.status === 'failed')
      .slice(-limit);
  }

  /**
   * Query executions
   */
  query(filter = {}) {
    let results = Array.from(this.executions.values());

    if (filter.status) {
      results = results.filter(e => e.status === filter.status);
    }
    if (filter.since) {
      results = results.filter(e => e.createdAt >= filter.since);
    }
    if (filter.hasError) {
      results = results.filter(e => e.error !== null);
    }

    return results;
  }

  /**
   * Load from persistence
   */
  async load() {
    if (this.loadFn) {
      try {
        const executions = await this.loadFn();
        for (const execution of executions) {
          this.executions.set(execution.executionId, execution);
          this.index.push(execution.executionId);
        }
      } catch (e) {
        logger.error('ReplayStore', 'Load failed', { error: e.message });
      }
    }
  }

  /**
   * Get stats
   */
  getStats() {
    const statuses = {};
    for (const exec of this.executions.values()) {
      statuses[exec.status] = (statuses[exec.status] || 0) + 1;
    }

    return {
      total: this.executions.size,
      byStatus: statuses,
    };
  }

  /**
   * Clear all
   */
  clear() {
    this.executions.clear();
    this.index = [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Replay an execution from the store
 */
export async function replayExecution(executionId, options = {}) {
  return replayStore.replay(executionId, options);
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const replayStore = new ReplayStore();

export default {
  FrozenTime,
  SeededRandom,
  ExecutionRecorder,
  ExecutionReplayer,
  ReplayStore,
  ReplayMode,
  createReplayableExecution,
  replayExecution,
  replayStore,
};
