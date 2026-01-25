// CRE v40.x Observability Layer Tests
// ══════════════════════════════════════════════════════════════════════════════

import {
  // v40.0: Observability Layer
  TracePhase, TraceStatus,
  PhaseTrace, ToolTrace,
  ExecutionTrace, ExecutionTraceStore, executionTraceStore,
  LatencyBuckets, LayerStats,
  LatencyTracker, latencyTracker,
  FailureCategory, HeatmapCell,
  FailureHeatmap, failureHeatmap,

  // v40.1: Determinism & Replay
  FrozenTime,  // Time freezing for replay
  SeededRandom, ReplayMode,
  ExecutionRecorder, ExecutionReplayer,
  ReplayStore, replayStore,
  createReplayableExecution,

  // v40.2: Versioned Behavior
  BehaviorAspect, BuiltInProfiles,
  BehaviorProfile, BehaviorRegistry, BehaviorContext,
  behaviorRegistry,
  createBehaviorContext, createFrozenBehaviorContext, getBehavior,
} from '../src/observability/index.js';

// Test utilities
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function assertEq(actual, expected, message) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual: ${JSON.stringify(actual)}`);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ══════════════════════════════════════════════════════════════════════════════
// v40.0: Observability Layer Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v40.0: ExecutionTrace', () => {
  const trace = new ExecutionTrace('req-123');

  assert(trace.requestId === 'req-123', 'creates trace with requestId');
  assert(trace.status === TraceStatus.PENDING, 'initial status is PENDING');
  assert(Array.isArray(trace.phases), 'has phases array');

  // Start trace
  trace.start();
  assert(trace.status === TraceStatus.RUNNING, 'status is RUNNING after start');

  // Start a phase
  const phaseTrace = trace.startPhase(TracePhase.CRE);
  assert(phaseTrace instanceof PhaseTrace, 'startPhase returns PhaseTrace');
  assert(phaseTrace.phase === TracePhase.CRE, 'phase has correct type');

  // Complete phase
  phaseTrace.complete({ decision: 'test' });
  assert(phaseTrace.status === TraceStatus.COMPLETED, 'phase marked completed');
  assert(phaseTrace.endTime !== null, 'phase has endTime');
  assert(phaseTrace.output?.decision === 'test', 'phase has output');

  // Tool trace
  const toolTrace = trace.startTool('web_search');
  assert(toolTrace instanceof ToolTrace, 'startTool returns ToolTrace');
  toolTrace.complete({ results: 5 });
  assert(toolTrace.status === TraceStatus.COMPLETED, 'tool marked completed');

  // Record decision
  trace.recordDecision({ type: 'route', target: 'web_search', confidence: 0.9 });
  assert(trace.decisions.length === 1, 'decision recorded');

  // Complete trace
  trace.complete();
  assert(trace.status === TraceStatus.COMPLETED, 'trace marked completed');

  // Summary
  const summary = trace.computeSummary();
  assert(summary.totalDuration >= 0, 'summary has totalDuration');
  assert(typeof summary.phaseDurations === 'object', 'summary has phaseDurations');
});

describe('v40.0: ExecutionTraceStore', () => {
  const store = new ExecutionTraceStore();

  const trace1 = store.create('req-1');
  const trace2 = store.create('req-2');

  assert(store.get('req-1') === trace1, 'retrieves trace by id');
  assert(store.getRecent(10).length === 2, 'stores traces');

  trace1.start();
  store.complete('req-1', { result: 'done' });
  assert(trace1.status === TraceStatus.COMPLETED, 'completes trace');

  const recent = store.getRecent(10);
  assert(recent.length === 2, 'getRecent returns all traces');

  const stats = store.getStats();
  assert(stats.stored === 2, 'tracks stored count');
  assert(stats.completed === 1, 'tracks completed count');
});

describe('v40.0: LatencyTracker', () => {
  const tracker = new LatencyTracker();

  tracker.record('CRE', 50);
  tracker.record('CRE', 100);
  tracker.record('Planner', 200);
  tracker.record('Executor', 150);

  const stats = tracker.getLayerStats('CRE');
  assert(stats !== null, 'returns stats object');
  assert(stats.count === 2, 'tracks count');
  assert(stats.average === 75, 'calculates average');
  assert(stats.min === 50, 'tracks min');
  assert(stats.max === 100, 'tracks max');

  const breakdown = tracker.getBreakdown();
  assert(typeof breakdown.CRE?.percentage === 'number', 'breakdown has layer percentages');

  const bottleneck = tracker.getBottleneck();
  assert(bottleneck.layer === 'Planner', 'identifies bottleneck');
});

describe('v40.0: LatencyTracker.wrap', () => {
  const tracker = new LatencyTracker();

  // Test wrap - async tests need to be run separately
  (async () => {
    const wrappedFn = tracker.wrap('test', async () => {
      await new Promise(r => setTimeout(r, 10));
      return 42;
    });
    const result = await wrappedFn();
    assert(result === 42, 'wrap returns function result');
    assert(tracker.getLayerStats('test')?.count === 1, 'wrap records latency');
  })();
});

describe('v40.0: FailureHeatmap', () => {
  const heatmap = new FailureHeatmap();

  heatmap.record({
    layer: 'Executor',
    operation: 'web_search',
    category: FailureCategory.TIMEOUT,
    error: 'Request timeout',
  });

  heatmap.record({
    layer: 'Executor',
    operation: 'web_search',
    category: FailureCategory.TIMEOUT,
    error: 'Request timeout',
  });

  heatmap.record({
    layer: 'CRE',
    operation: 'decide',
    category: FailureCategory.VALIDATION,
    error: 'Invalid input',
  });

  const heatmapData = heatmap.getLayerByCategoryHeatmap();
  const executorTimeout = heatmapData.cells.find(
    c => c.dimension1 === 'Executor' && c.dimension2 === FailureCategory.TIMEOUT
  );
  assert(executorTimeout?.count === 2, 'tracks layer x category');

  const hotspots = heatmap.getHotspots(5);
  assert(hotspots.length >= 1, 'returns hotspots');
  assert(hotspots[0].count === 2, 'hotspot has highest count');

  const patterns = heatmap.getPatterns(2);
  assert(patterns.length >= 1, 'detects patterns');
  assert(patterns[0].error === 'Request timeout', 'pattern has error message');
});

// ══════════════════════════════════════════════════════════════════════════════
// v40.1: Determinism & Replay Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v40.1: SeededRandom', () => {
  const rng1 = new SeededRandom(12345);
  const rng2 = new SeededRandom(12345);

  const seq1 = [rng1.next(), rng1.next(), rng1.next()];
  const seq2 = [rng2.next(), rng2.next(), rng2.next()];

  assertEq(seq1, seq2, 'same seed produces same sequence');

  const rng3 = new SeededRandom(99999);
  const seq3 = [rng3.next(), rng3.next(), rng3.next()];
  assert(JSON.stringify(seq1) !== JSON.stringify(seq3), 'different seed produces different sequence');

  const rng4 = new SeededRandom(42);
  const int1 = rng4.nextInt(1, 10);
  assert(int1 >= 1 && int1 <= 10, 'nextInt returns value in range');

  const arr = [1, 2, 3, 4, 5];
  const rng5 = new SeededRandom(123);
  const rng6 = new SeededRandom(123);
  const shuffled1 = rng5.shuffle([...arr]);
  const shuffled2 = rng6.shuffle([...arr]);
  assertEq(shuffled1, shuffled2, 'shuffle is deterministic');
});

describe('v40.1: FrozenTime', () => {
  // Test live mode
  const liveTime = new FrozenTime({ mode: 'live' });
  const beforeNow = Date.now();
  const liveNow = liveTime.now();
  const afterNow = Date.now();
  assert(liveNow >= beforeNow && liveNow <= afterNow, 'live mode returns real time');

  // Test frozen mode
  const frozenBase = 1700000000000;
  const frozenTime = new FrozenTime({ baseTime: frozenBase, mode: 'frozen' });
  frozenTime.freeze(frozenBase);
  assert(frozenTime.now() === frozenBase, 'frozen mode returns base time');
  assert(frozenTime.isFrozen() === true, 'isFrozen returns true when frozen');

  // Test date()
  const frozenDate = frozenTime.date();
  assert(frozenDate instanceof Date, 'date() returns Date object');
  assert(frozenDate.getTime() === frozenBase, 'date() returns correct time');

  // Test serialization
  const time1 = new FrozenTime({ baseTime: 1700000000000, timezone: 'UTC' });
  time1.recordTimestamp('test1');
  time1.recordTimestamp('test2');
  const json = time1.toJSON();
  assert(json.baseTime === 1700000000000, 'toJSON preserves baseTime');
  assert(json.timestamps.length === 2, 'toJSON preserves timestamps');

  // Test fromJSON (replay)
  const time2 = FrozenTime.fromJSON(json);
  assert(time2.isFrozen() === true, 'fromJSON creates frozen time');
  assert(time2.getBaseTime() === 1700000000000, 'fromJSON preserves baseTime');
});

describe('v40.1: ExecutionRecorder', () => {
  const execution = createReplayableExecution({
    executionId: 'exec-1',
    seed: '12345',
    request: 'test query',
  });
  const recorder = new ExecutionRecorder(execution);

  recorder.start();
  recorder.recordPlan({ steps: ['step1', 'step2'] });
  recorder.recordStep({ id: 'step1', tool: 'web_search' });
  recorder.recordToolResult('web_search', { query: 'test' }, { results: [] });
  recorder.recordDecision({ type: 'route', target: 'web_search' });
  const recording = recorder.complete({ result: 'done' });

  assert(recording.executionId === 'exec-1', 'has executionId');
  assert(recording.seed === '12345', 'has seed');
  assert(recording.inputs.request === 'test query', 'recorded inputs');
  assert(recording.toolResults.length === 1, 'recorded tool results');
  assert(recording.plan.steps.length === 2, 'recorded plan');
  assert(recording.status === 'completed', 'marked as completed');

  // TIME CONTEXT: verify time is recorded for replay
  assert(recording.timeContext !== undefined, 'has timeContext');
  assert(typeof recording.timeContext.baseTime === 'number', 'timeContext has baseTime');
  assert(Array.isArray(recording.timeContext.timestamps), 'timeContext has timestamps');
  assert(recording.timeContext.timestamps.length >= 1, 'timeContext recorded timestamps');

  // Verify recorder provides time API
  const recorder2 = new ExecutionRecorder(createReplayableExecution({ executionId: 'exec-2' }));
  assert(typeof recorder2.now === 'function', 'recorder has now() method');
  assert(typeof recorder2.date === 'function', 'recorder has date() method');
  assert(typeof recorder2.getTime === 'function', 'recorder has getTime() method');
});

describe('v40.1: ExecutionReplayer', () => {
  // Create a recording
  const execution = createReplayableExecution({
    executionId: 'exec-replay',
    seed: '42',
    request: 'replay test',
  });
  const recorder = new ExecutionRecorder(execution);
  recorder.start();
  recorder.recordPlan({ steps: ['a', 'b'] });
  recorder.recordStep({ id: 'step1', tool: 'tool1' });
  recorder.recordToolResult('tool1', { query: 'test' }, { data: 'original' });
  const recording = recorder.complete({ done: true });

  // Replay in EXACT mode
  const replayer = new ExecutionReplayer(recording, { mode: ReplayMode.EXACT });

  assert(recording.inputs.request === 'replay test', 'execution has input');
  assert(recording.plan.steps.length === 2, 'execution has plan');

  // Verify RANDOM determinism
  const rng = replayer.getRandom();
  const val1 = rng.next();
  const rng2 = new SeededRandom('42');
  const val2 = rng2.next();
  assertEq(val1, val2, 'random is deterministic');

  // Verify TIME determinism (FROZEN WORLD)
  assert(typeof replayer.getTime === 'function', 'replayer has getTime() method');
  assert(typeof replayer.now === 'function', 'replayer has now() method');
  assert(typeof replayer.date === 'function', 'replayer has date() method');

  const frozenTime = replayer.getTime();
  assert(frozenTime.isFrozen() === true, 'replayer time is frozen');
  assert(frozenTime.getBaseTime() === recording.timeContext.baseTime, 'replayer uses recorded base time');
});

describe('v40.1: ReplayStore', () => {
  const store = new ReplayStore();

  // Use store.create() which returns a recorder
  const recorder = store.create({ executionId: 'store-test', request: 'test' });
  recorder.start();
  recorder.recordPlan({ steps: ['test'] });
  recorder.complete({ result: 'done' });

  const retrieved = store.get('store-test');
  assert(retrieved !== undefined, 'stores recording');
  assert(retrieved.inputs.request === 'test', 'retrieves recording');

  const recent = store.getRecent(10);
  assert(recent.length >= 1, 'lists recent recordings');
});

// ══════════════════════════════════════════════════════════════════════════════
// v40.2: Versioned Behavior Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v40.2: BehaviorProfile', () => {
  const profile = new BehaviorProfile({
    version: 'test-v1',
    aspects: {
      plannerRules: { maxSteps: 10 },
      safetyLimits: { maxTokens: 1000 },
    },
  });

  assert(profile.version === 'test-v1', 'has version');

  // Need a registry to resolve aspects
  const tempRegistry = new BehaviorRegistry();
  tempRegistry.register(profile);

  const plannerRules = profile.getAspect(BehaviorAspect.PLANNER_RULES, tempRegistry);
  assert(plannerRules.maxSteps === 10, 'returns behavior');

  const safetyLimits = profile.getAspect(BehaviorAspect.SAFETY_LIMITS, tempRegistry);
  assert(safetyLimits.maxTokens === 1000, 'returns another behavior');
});

describe('v40.2: BehaviorRegistry', () => {
  const registry = new BehaviorRegistry();

  // Check built-in profiles
  assert(registry.get('v39.0') !== undefined, 'has v39.0 profile');
  assert(registry.get('v40.0') !== undefined, 'has v40.0 profile');
  assert(registry.get('latest') !== undefined, 'has latest profile');

  // Register custom profile
  registry.register({
    version: 'custom-v1',
    inherits: 'v40.0',
    aspects: {
      plannerRules: { customSetting: true },
    },
  });

  assert(registry.get('custom-v1') !== undefined, 'registers custom profile');

  // Resolve with inheritance
  const resolved = registry.getResolved('custom-v1');
  assert(resolved.plannerRules?.customSetting === true, 'resolves custom behavior');
  assert(resolved.plannerRules?.maxSteps !== undefined, 'inherits from v40.0');
});

describe('v40.2: BehaviorContext', () => {
  const registry = new BehaviorRegistry();
  const context = new BehaviorContext(registry, 'v40.0');

  assert(context.version === 'v40.0', 'has version');

  const maxSteps = context.get(BehaviorAspect.PLANNER_RULES, 'maxSteps', 0);
  assert(maxSteps > 0, 'gets behavior through context');

  // Override
  context.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 5);
  const overridden = context.get(BehaviorAspect.PLANNER_RULES, 'maxSteps', 0);
  assert(overridden === 5, 'applies override');
});

describe('v40.2: BehaviorContext.freeze (IMMUTABILITY)', () => {
  const registry = new BehaviorRegistry();
  const ctx = new BehaviorContext(registry, 'v40.0');

  // Apply override before freeze
  ctx.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 50);
  assert(ctx.isFrozen() === false, 'not frozen initially');

  // Freeze
  ctx.freeze();
  assert(ctx.isFrozen() === true, 'isFrozen returns true after freeze');
  assert(ctx.getFrozenAt() !== null, 'getFrozenAt returns timestamp');

  // Verify override is preserved in frozen state
  const frozenMaxSteps = ctx.get(BehaviorAspect.PLANNER_RULES, 'maxSteps', 0);
  assert(frozenMaxSteps === 50, 'frozen context preserves overrides');

  // Verify override throws after freeze
  let threw = false;
  try {
    ctx.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 100);
  } catch (e) {
    threw = true;
  }
  assert(threw === true, 'override throws after freeze');

  // Verify snapshot is available
  const snapshot = ctx.getSnapshot();
  assert(snapshot !== null, 'getSnapshot returns snapshot');
  assert(Object.isFrozen(snapshot), 'snapshot is frozen');

  // Verify serialization
  const json = ctx.toJSON();
  assert(json.frozen === true, 'toJSON includes frozen state');
  assert(json.snapshot !== null, 'toJSON includes snapshot');

  // Verify fromJSON
  const restored = BehaviorContext.fromJSON(json, registry);
  assert(restored.isFrozen() === true, 'fromJSON restores frozen state');
  assert(restored.get(BehaviorAspect.PLANNER_RULES, 'maxSteps', 0) === 50, 'fromJSON restores values');
});

describe('v40.2: createBehaviorContext helper', () => {
  const ctx = createBehaviorContext('v39.3');
  assert(ctx instanceof BehaviorContext, 'creates BehaviorContext');
  assert(ctx.version === 'v39.3', 'has correct version');
  assert(ctx.isFrozen() === false, 'not auto-frozen by default');

  // Test autoFreeze option
  const autoCtx = createBehaviorContext('v40.0', { autoFreeze: true });
  assert(autoCtx.isFrozen() === true, 'autoFreeze option works');
});

describe('v40.2: createFrozenBehaviorContext helper', () => {
  const ctx = createFrozenBehaviorContext('v40.0');
  assert(ctx instanceof BehaviorContext, 'creates BehaviorContext');
  assert(ctx.isFrozen() === true, 'is immediately frozen');

  // Verify cannot override
  let threw = false;
  try {
    ctx.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 999);
  } catch (e) {
    threw = true;
  }
  assert(threw === true, 'frozen context rejects overrides');
});

describe('v40.2: getBehavior helper', () => {
  const rules = getBehavior(BehaviorAspect.PLANNER_RULES, 'maxSteps', 0, 'v40.0');
  assert(rules > 0, 'getBehavior returns value');
});

// ══════════════════════════════════════════════════════════════════════════════
// v40.1: Replay Consistency Test
// ══════════════════════════════════════════════════════════════════════════════

describe('v40.1: Replay Consistency Test (run → record → replay → compare)', () => {
  // This test verifies that:
  // 1. We can record an execution
  // 2. We can replay it
  // 3. The replay produces identical results

  // Step 1: Create a new execution with deterministic seed
  const execution = createReplayableExecution({
    executionId: 'consistency-test',
    seed: 'deterministic-seed-12345',
    request: 'test consistency',
  });

  // Step 2: Record execution with multiple operations
  const recorder = new ExecutionRecorder(execution);
  recorder.start();

  // Use deterministic random
  const random = recorder.getRandom();
  const randomValues = [random.next(), random.next(), random.next()];

  // Use frozen time
  const time = recorder.getTime();
  const timeValues = [time.now(), time.now(), time.now()];

  // Record some steps and decisions
  recorder.recordPlan({ steps: ['step1', 'step2', 'step3'] });
  recorder.recordStep({ id: 'step1', action: 'analyze' });
  recorder.recordToolResult('tool1', { query: 'test' }, { result: 'data1' });
  recorder.recordDecision({ type: 'route', target: 'step2', randomFactor: random.next() });
  recorder.recordStep({ id: 'step2', action: 'execute' });
  recorder.recordToolResult('tool2', { input: 'data1' }, { result: 'data2' });
  recorder.recordStep({ id: 'step3', action: 'finalize' });

  const recording = recorder.complete({ finalResult: 'success', randomValues, timeValues });

  // Step 3: Create replayer from recording
  const replayer = new ExecutionReplayer(recording, { mode: ReplayMode.EXACT });

  // Step 4: Verify deterministic random produces same values
  const replayRandom = replayer.getRandom();
  const replayRandomValues = [replayRandom.next(), replayRandom.next(), replayRandom.next()];

  assertEq(replayRandomValues, randomValues, 'replay random produces same sequence');

  // Step 5: Verify frozen time
  const replayTime = replayer.getTime();
  assert(replayTime.isFrozen() === true, 'replay time is frozen');
  assert(replayTime.getBaseTime() === recording.timeContext.baseTime, 'replay uses same base time');

  // Step 6: Verify recorded data integrity
  assert(recording.executionId === 'consistency-test', 'recording has correct executionId');
  assert(recording.seed === 'deterministic-seed-12345', 'recording has correct seed');
  assert(recording.plan.steps.length === 3, 'recording has correct plan');
  assert(recording.steps.length === 3, 'recording has all steps');
  assert(recording.toolResults.length === 2, 'recording has all tool results');
  assert(recording.decisions.length === 1, 'recording has all decisions');
  assert(recording.status === 'completed', 'recording is completed');
  assert(recording.output.finalResult === 'success', 'recording has correct output');
  assert(recording.output.randomValues.length === 3, 'recording captured random values');
  assert(recording.output.timeValues.length === 3, 'recording captured time values');

  // Step 7: Verify timeContext was recorded
  assert(recording.timeContext !== undefined, 'recording has timeContext');
  assert(recording.timeContext.baseTime !== undefined, 'timeContext has baseTime');
  assert(recording.timeContext.timestamps.length >= 1, 'timeContext has timestamps');
});

describe('v40.1: Replay Determinism (multiple replays produce same results)', () => {
  // Create and record an execution
  const execution = createReplayableExecution({
    executionId: 'determinism-test',
    seed: 'same-seed-always',
    request: 'test determinism',
  });

  const recorder = new ExecutionRecorder(execution);
  recorder.start();
  recorder.recordPlan({ steps: ['a'] });
  recorder.recordStep({ id: 'a', tool: 'test' });
  recorder.recordToolResult('test', {}, { value: 42 });
  const recording = recorder.complete({ result: 'done' });

  // Replay multiple times
  const replayer1 = new ExecutionReplayer(recording, { mode: ReplayMode.EXACT });
  const replayer2 = new ExecutionReplayer(recording, { mode: ReplayMode.EXACT });
  const replayer3 = new ExecutionReplayer(recording, { mode: ReplayMode.EXACT });

  // Each replayer should produce the same random sequence
  const seq1 = [replayer1.getRandom().next(), replayer1.getRandom().next()];
  const seq2 = [replayer2.getRandom().next(), replayer2.getRandom().next()];
  const seq3 = [replayer3.getRandom().next(), replayer3.getRandom().next()];

  assertEq(seq1, seq2, 'replayer 1 and 2 produce same random');
  assertEq(seq2, seq3, 'replayer 2 and 3 produce same random');

  // Each replayer should have the same frozen time
  assert(replayer1.getTime().getBaseTime() === replayer2.getTime().getBaseTime(), 'same base time 1-2');
  assert(replayer2.getTime().getBaseTime() === replayer3.getTime().getBaseTime(), 'same base time 2-3');
});

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(`v40.x Observability Tests: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
