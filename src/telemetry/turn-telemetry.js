// TurnTelemetry v1.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Passive telemetry collector for a single turn.
// Records classification, execution, circuit breaker, and timing data.
//
// Design constraints:
//   - Never throws (all record methods wrapped in try-catch)
//   - Never blocks execution
//   - Never changes control flow
//   - No dependencies on CRE, Executor, or any business logic
//   - finalize() is idempotent — second call returns cached snapshot
//
// ══════════════════════════════════════════════════════════════════════════════

const TELEMETRY_VERSION = 1;

export class TurnTelemetry {
  constructor(turnId, sessionId, conversationId) {
    this.turnId = turnId;
    this.sessionId = sessionId;
    this.conversationId = conversationId;

    // Classification data (populated by conversation handler after CRE decide)
    this.classification = {
      intent: null,
      classifiedBy: null,    // 'deterministic' | 'llm' | 'regex'
      confidence: null,      // 0-1
      classificationTimeMs: null,
      overrideApplied: false,
      overrideSource: null,
    };

    // Decision timing
    this.decideTimeMs = null;

    // Execution data (populated by ToolExecutor)
    this.execution = {
      toolsInvoked: [],      // { tool, durationMs, success, retryCount, errorType, errorCode }
      status: null,          // 'SUCCESS' | 'PARTIAL' | 'FAILED' | null
      retryCount: 0,         // accumulated across all tools
      partialFailure: false,
      wasCancelled: false,
      abortSource: null,     // 'user' | 'timeout' | null
      executionTimeMs: null,
    };

    // Circuit breaker data (populated by ToolExecutor)
    this.circuit = {
      states: [],            // { tool, stateBefore, stateAfter }
      anyOpened: false,
    };

    // Finalization guard
    this._finalized = false;
    this._snapshot = null;
  }

  /**
   * Record CRE classification result.
   */
  recordClassification({ intent, classifiedBy, confidence, classificationTimeMs }) {
    if (this._finalized) return;
    try {
      this.classification.intent = intent ?? null;
      this.classification.classifiedBy = classifiedBy ?? null;
      this.classification.confidence = confidence ?? null;
      this.classification.classificationTimeMs = classificationTimeMs ?? null;
    } catch (_) { /* telemetry must not throw */ }
  }

  /**
   * Record CRE decision timing and override state.
   */
  recordDecision({ decideTimeMs, overrideApplied, overrideSource }) {
    if (this._finalized) return;
    try {
      this.decideTimeMs = decideTimeMs ?? null;
      this.classification.overrideApplied = overrideApplied ?? false;
      this.classification.overrideSource = overrideSource ?? null;
    } catch (_) { /* telemetry must not throw */ }
  }

  /**
   * Record a single tool invocation result.
   * Called once per tool after execution completes.
   */
  recordToolInvocation({ tool, durationMs, success, retryCount, errorType, errorCode }) {
    if (this._finalized) return;
    try {
      this.execution.toolsInvoked.push({
        tool: tool ?? 'unknown',
        durationMs: durationMs ?? 0,
        success: success ?? false,
        retryCount: retryCount ?? 0,
        errorType: errorType ?? null,
        errorCode: errorCode ?? null,
      });
      // Accumulate global retry count
      this.execution.retryCount += retryCount ?? 0;
    } catch (_) { /* telemetry must not throw */ }
  }

  /**
   * Record circuit breaker state before/after a tool execution.
   */
  recordCircuitState({ tool, stateBefore, stateAfter }) {
    if (this._finalized) return;
    try {
      this.circuit.states.push({
        tool: tool ?? 'unknown',
        stateBefore: stateBefore ?? null,
        stateAfter: stateAfter ?? null,
      });
      // Compute anyOpened inline
      if (stateAfter === 'OPEN') {
        this.circuit.anyOpened = true;
      }
    } catch (_) { /* telemetry must not throw */ }
  }

  /**
   * Record cancellation event.
   * @param {'user' | 'timeout'} abortSource
   */
  recordCancel(abortSource) {
    if (this._finalized) return;
    try {
      this.execution.wasCancelled = true;
      this.execution.abortSource = abortSource ?? 'unknown';
    } catch (_) { /* telemetry must not throw */ }
  }

  /**
   * Record execution summary (from ToolExecutor).
   */
  recordExecution({ executionTimeMs, status, partialFailure }) {
    if (this._finalized) return;
    try {
      this.execution.executionTimeMs = executionTimeMs ?? null;
      this.execution.status = status ?? null;
      this.execution.partialFailure = partialFailure ?? false;
    } catch (_) { /* telemetry must not throw */ }
  }

  /**
   * Finalize and return frozen snapshot.
   * Idempotent — second call returns cached snapshot.
   *
   * @param {number} turnStartTime - Date.now() at turn start
   * @returns {Object} frozen TurnTelemetrySnapshot
   */
  finalize(turnStartTime) {
    if (this._finalized) return this._snapshot;

    try {
      const totalTurnTimeMs = turnStartTime
        ? Math.round(Date.now() - turnStartTime)
        : null;

      this._snapshot = Object.freeze({
        version: TELEMETRY_VERSION,
        turnId: this.turnId,
        sessionId: this.sessionId,
        conversationId: this.conversationId,

        timing: Object.freeze({
          classificationTimeMs: this.classification.classificationTimeMs,
          decideTimeMs: this.decideTimeMs,
          executionTimeMs: this.execution.executionTimeMs,
          totalTurnTimeMs,
        }),

        classification: Object.freeze({
          intent: this.classification.intent,
          classifiedBy: this.classification.classifiedBy,
          confidence: this.classification.confidence,
          overrideApplied: this.classification.overrideApplied,
          overrideSource: this.classification.overrideSource,
        }),

        execution: Object.freeze({
          toolsInvoked: Object.freeze(
            this.execution.toolsInvoked.map(t => Object.freeze({ ...t }))
          ),
          status: this.execution.status,
          retryCount: this.execution.retryCount,
          partialFailure: this.execution.partialFailure,
          wasCancelled: this.execution.wasCancelled,
          abortSource: this.execution.abortSource,
        }),

        circuit: Object.freeze({
          states: Object.freeze(
            this.circuit.states.map(s => Object.freeze({ ...s }))
          ),
          anyOpened: this.circuit.anyOpened,
        }),
      });

      this._finalized = true;
    } catch (_) {
      // Even finalize must not throw
      this._snapshot = Object.freeze({ version: TELEMETRY_VERSION, error: 'finalize_failed' });
      this._finalized = true;
    }

    return this._snapshot;
  }
}

export default TurnTelemetry;
