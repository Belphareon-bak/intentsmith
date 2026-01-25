// CRE v40.x Observability Index
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 5 — HARDENING & OPERABILITY
//
// v40.0: Observability Layer
//   - ExecutionTrace: Request-level tracing
//   - LatencyTracker: Per-layer latency tracking
//   - FailureHeatmap: Failure pattern visualization
//
// v40.1: Determinism & Replay
//   - SeededRandom: Deterministic random
//   - ExecutionRecorder: Record executions
//   - ExecutionReplayer: Replay executions
//   - ReplayStore: Store replayable executions
//
// v40.2: Versioned Behavior
//   - BehaviorProfile: Behavior snapshots
//   - BehaviorRegistry: Profile management
//   - BehaviorContext: Per-execution behavior
//
// ══════════════════════════════════════════════════════════════════════════════

// v40.0: Observability Layer
export {
  TracePhase, TraceStatus,
  PhaseTrace, ToolTrace,
  ExecutionTrace, ExecutionTraceStore,
  executionTraceStore,
} from './execution-trace.js';

export {
  LatencyBuckets, LayerStats,
  LatencyTracker, latencyTracker,
} from './latency-tracker.js';

export {
  FailureCategory, HeatmapCell,
  FailureHeatmap, failureHeatmap,
} from './failure-heatmap.js';

// v40.1: Determinism & Replay
export {
  FrozenTime,  // Time freezing for replay
  SeededRandom,
  ReplayMode,
  ExecutionRecorder, ExecutionReplayer,
  ReplayStore, replayStore,
  createReplayableExecution, replayExecution,
} from './replay.js';

// v40.2: Versioned Behavior
export {
  BehaviorAspect, BuiltInProfiles,
  BehaviorProfile, BehaviorRegistry, BehaviorContext,
  behaviorRegistry,
  createBehaviorContext, createFrozenBehaviorContext, getBehavior,
} from './behavior-profile.js';
