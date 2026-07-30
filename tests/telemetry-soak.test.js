#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// Telemetry Soak Test — 1000-turn Distribution Analysis
// ══════════════════════════════════════════════════════════════════════════════
//
// Simulates 1000 turns through CRE classification → ToolExecutor → telemetry.
// Collects TurnTelemetry snapshots and computes distribution metrics:
//
//   - p50 / p95 / p99 totalTurnTimeMs
//   - avg retryCount per tool
//   - circuit open rate (% turns where anyOpened=true)
//   - % partialFailure
//   - % wasCancelled
//   - deterministic vs LLM classification ratio
//   - tool failure rate per tool type
//
// No network, no real LLM. Uses CRE.classifyIntent() (deterministic only)
// + ToolExecutor with mock handlers. Pure computation — runs in ~5-15s.
//
// Run: C3_LOG_LEVEL=error node tests/telemetry-soak.test.js
// Env: SOAK_TURNS=2000 C3_LOG_LEVEL=error node tests/telemetry-soak.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { TurnTelemetry } from '../src/telemetry/turn-telemetry.js';
import { aggregate } from '../src/autonomy/aggregator.js';
import { ToolExecutor, ToolResult, ToolResultType, ExecutionStatus, ToolErrorCode } from '../src/executor/tool-executor.js';
import { CREDecisionEngine, IntentType, DecisionType, ToolType } from '../src/chat/cre-decision.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const TOTAL_TURNS = parseInt(process.env.SOAK_TURNS || '1000');
const CONV_ID = 'soak-test-conv';
const SOAK_SEED = Number.parseInt(process.env.SOAK_SEED || '12648430', 10) >>> 0;
let randomState = SOAK_SEED;

function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

// Failure injection rates (realistic production estimates)
const FAILURE_RATE = 0.08;       // 8% of tool executions fail
const TIMEOUT_RATE = 0.03;       // 3% of tool executions timeout
const CANCEL_RATE = 0.02;        // 2% of turns cancelled by "user"

// Session rotation — prevents circuit breaker cascade within a single session
const SESSION_POOL_SIZE = 20;
const SESSION_IDS = Array.from({ length: SESSION_POOL_SIZE }, (_, i) => `soak-session-${i}`);

// ═══════════════════════════════════════════════════════════════════════════════
// TURN INPUT CORPUS — realistic distribution of user messages
// ═══════════════════════════════════════════════════════════════════════════════

const SEARCH_INPUTS = [
  'vyhledej informace o React 19',
  'co je WebAssembly?',
  'najdi dokumentaci k Prisma ORM',
  'jaké jsou novinky v Node.js 22?',
  'porovnej Redis a Memcached',
  'search for Rust async patterns',
  'find best practices for Docker security',
  'how does gRPC compare to REST?',
  'najdi benchmarky PostgreSQL vs MySQL',
  'co je to Kubernetes ingress controller?',
  'vyhledej tutoriál na Svelte 5',
  'jaké jsou alternativy k MongoDB?',
  'search for WebSocket scaling strategies',
  'najdi články o event-driven architecture',
  'what is the latest version of TypeScript?',
];

const SIMPLE_INPUTS = [
  'ahoj', 'díky', 'dobře', 'ok', 'ano',
  'ne', 'chápu', 'super', 'hello', 'thanks',
];

const CONVERSATIONAL_INPUTS = [
  'co si myslíš o TypeScriptu?',
  'jaký je tvůj názor na microservices?',
  'vysvětli mi dependency injection',
  'jak funguje garbage collector?',
  'popiš mi SOLID principy',
  'what is the difference between let and const?',
  'explain the event loop in Node.js',
  'tell me about design patterns',
  'jak se píše unit test?',
  'co je to CI/CD pipeline?',
];

const DESIGN_INPUTS = [
  'navrhni architekturu pro e-shop',
  'design a REST API for a blog platform',
  'navrhni databázové schéma pro CRM',
  'create architecture for a real-time chat app',
  'navrhni microservice architekturu pro fintech',
];

const LOCAL_TOOL_INPUTS = [
  'kolik je hodin?',
  'jaké je dnešní datum?',
  'spočítej 2^32',
  'what day is March 15, 2026?',
  'calculate 1337 * 42',
];

const REPORT_INPUTS = [
  'napiš report o stavu projektu',
  'shrň co jsme udělali',
  'create a summary of our progress',
  'write a status update',
];

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT → DECISION MAPPING (deterministic, no LLM needed)
// ═══════════════════════════════════════════════════════════════════════════════
// Mirrors what CRE.decide() produces, but without the LLM fallback path.
// This lets us test the full telemetry pipeline at speed.
// ═══════════════════════════════════════════════════════════════════════════════

function intentToDecision(intent) {
  switch (intent) {
    case IntentType.SEARCH:
      return { type: DecisionType.TOOL_CALL, intent, tools: [ToolType.WEB_SEARCH], metadata: {} };
    case IntentType.REPORT:
      return { type: DecisionType.TOOL_CALL, intent, tools: [ToolType.WEB_SEARCH, ToolType.WEB_SCRAPE], metadata: {} };
    case IntentType.LOCAL:
      return { type: DecisionType.TOOL_CALL, intent, tools: [ToolType.LOCAL_DATE], metadata: {} };
    case IntentType.DESIGN:
      return { type: DecisionType.ANSWER, intent, tools: [], metadata: { classifiedBy: 'deterministic' } };
    case IntentType.CONVERSATIONAL:
      return { type: DecisionType.ANSWER, intent, tools: [], metadata: { classifiedBy: 'deterministic' } };
    default:
      return { type: DecisionType.ANSWER, intent, tools: [], metadata: { classifiedBy: 'deterministic' } };
  }
}

// Weighted distribution (approximate real traffic)
function pickRandomInput(turnIndex) {
  const r = random();
  if (r < 0.30) return { input: SEARCH_INPUTS[turnIndex % SEARCH_INPUTS.length], category: 'search' };
  if (r < 0.50) return { input: CONVERSATIONAL_INPUTS[turnIndex % CONVERSATIONAL_INPUTS.length], category: 'conversational' };
  if (r < 0.65) return { input: SIMPLE_INPUTS[turnIndex % SIMPLE_INPUTS.length], category: 'simple' };
  if (r < 0.78) return { input: LOCAL_TOOL_INPUTS[turnIndex % LOCAL_TOOL_INPUTS.length], category: 'local' };
  if (r < 0.90) return { input: DESIGN_INPUTS[turnIndex % DESIGN_INPUTS.length], category: 'design' };
  return { input: REPORT_INPUTS[turnIndex % REPORT_INPUTS.length], category: 'report' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK TOOL EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════

function createMockExecutor() {
  const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 1, retryDelayMs: 0 });

  // Override ALL handlers with fast mocks
  executor.register(ToolType.WEB_SEARCH, async () => {
    const latency = 200 + random() * 800; // 200-1000ms simulated
    if (shouldFail()) {
      return ToolResult.failed({
        type: ToolResultType.SEARCH,
        error: 'Search provider unavailable',
        errorCode: ToolErrorCode.SOURCE_UNAVAILABLE,
      });
    }
    if (shouldTimeout()) {
      return ToolResult.failed({
        type: ToolResultType.SEARCH,
        error: 'Search timed out',
        errorCode: ToolErrorCode.TIMEOUT,
      });
    }
    return ToolResult.search({
      results: [{ title: 'Mock Result', url: 'https://example.com', snippet: 'mock data' }],
      count: 1,
      source: 'mock-provider',
      latency: Math.round(latency),
    });
  });

  executor.register(ToolType.WEB_SCRAPE, async () => {
    const latency = 500 + random() * 1500; // 500-2000ms simulated
    if (shouldFail()) {
      return ToolResult.failed({
        type: ToolResultType.SCRAPE,
        error: 'Source blocked',
        errorCode: ToolErrorCode.SOURCE_BLOCKED,
      });
    }
    return ToolResult.scrape({
      url: 'https://example.com',
      title: 'Mock Page',
      content: 'Mock content for soak test',
      latency: Math.round(latency),
    });
  });

  executor.register(ToolType.LOCAL_DATE, async () => {
    return ToolResult.local({ subtype: 'date', data: { date: new Date().toISOString() }, latency: 1 });
  });

  executor.register(ToolType.LOCAL_MATH, async () => {
    return ToolResult.local({ subtype: 'math', data: { result: 42 }, latency: 1 });
  });

  executor.register(ToolType.LOCAL_CALENDAR, async () => {
    return ToolResult.local({ subtype: 'calendar', data: { day: 'Monday' }, latency: 1 });
  });

  return executor;
}

function shouldFail() { return random() < FAILURE_RATE; }
function shouldTimeout() { return random() < TIMEOUT_RATE; }
function shouldCancel() { return random() < CANCEL_RATE; }

// ═══════════════════════════════════════════════════════════════════════════════
// SOAK TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runSoakTest() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Telemetry Soak Test — ${TOTAL_TURNS} turns`);
  console.log(`${'═'.repeat(60)}\n`);

  const cre = new CREDecisionEngine();
  const executor = createMockExecutor();
  const snapshots = [];
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_TURNS; i++) {
    const turnId = `soak-turn-${i}`;
    const sessionId = SESSION_IDS[i % SESSION_POOL_SIZE];
    const turnStart = Date.now();
    const telemetry = new TurnTelemetry(turnId, sessionId, CONV_ID);

    // ── 1. CRE Classification (deterministic only, no LLM) ──────────────
    const { input } = pickRandomInput(i);
    const classStart = Date.now();
    const intent = cre.classifyIntent(input);
    const classTimeMs = Date.now() - classStart;

    // Build decision deterministically (mirrors CRE.decide without LLM)
    const decision = intentToDecision(intent);

    // Simulate LLM classification for ~15% of turns (record as 'llm' even
    // though we didn't actually call LLM — tests the telemetry shape)
    const simulateLlm = random() < 0.15;
    const classifiedBy = simulateLlm ? 'llm' : 'deterministic';
    const confidence = simulateLlm ? (0.7 + random() * 0.3) : 1.0;
    const overrideApplied = random() < 0.05;

    telemetry.recordClassification({
      intent,
      classifiedBy,
      confidence,
      classificationTimeMs: simulateLlm ? classTimeMs + Math.round(random() * 500) : classTimeMs,
      diag: {
        initialIntent: intent,
        finalIntent: intent,
        isIntentBreak: false,
        lastIntent: null,
        followUp: null,
        overrides: overrideApplied ? ['first_turn_override'] : null,
      },
    });

    // Simulate override for ~5% of turns
    telemetry.recordDecision({
      decideTimeMs: classTimeMs + Math.round(random() * 5),
      overrideApplied,
      overrideSource: overrideApplied ? 'first_turn_override' : null,
    });

    // ── 2. Execution (only for TOOL_CALL decisions) ─────────────────────
    if (decision.type === DecisionType.TOOL_CALL && decision.tools?.length > 0) {
      if (shouldCancel()) {
        telemetry.recordCancel('user');
      } else {
        await executor.execute(decision, {
          input,
          sessionId,
          telemetry,
        });
      }
    }

    // ── 3. Finalize ─────────────────────────────────────────────────────
    const snapshot = telemetry.finalize(turnStart);
    snapshots.push(snapshot);

    // Progress report every 200 turns
    if (i > 0 && i % 200 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ... ${i}/${TOTAL_TURNS} turns (${elapsed}s elapsed)`);
    }
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`\n  Completed ${TOTAL_TURNS} turns in ${(totalElapsed / 1000).toFixed(1)}s\n`);

  return analyzeSnapshots(snapshots);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISTRIBUTION ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function analyzeSnapshots(snapshots) {
  const total = snapshots.length;
  const aggregation = aggregate({
    db: {
      prepare: () => ({
        all: () => snapshots.map(snapshot => ({ snapshot_json: JSON.stringify(snapshot) })),
      }),
    },
    telemetryMetrics: { add: { run: () => {} } },
    telemetryAlerts: { add: { run: () => {} } },
    creEngine: { getOverrideThreshold: () => 0.85 },
    logger: { debug: () => {} },
  }, new Date('2026-07-30T00:15:00.000Z'));

  // ── Timing distribution ────────────────────────────────────────────────
  const totalTurnTimes = snapshots
    .map(s => s.timing.totalTurnTimeMs)
    .filter(v => v !== null)
    .sort((a, b) => a - b);

  const classificationTimes = snapshots
    .map(s => s.timing.classificationTimeMs)
    .filter(v => v !== null)
    .sort((a, b) => a - b);

  const executionTimes = snapshots
    .map(s => s.timing.executionTimeMs)
    .filter(v => v !== null)
    .sort((a, b) => a - b);

  // ── Classification distribution ────────────────────────────────────────
  const classifiedBy = {};
  for (const s of snapshots) {
    const key = s.classification.classifiedBy ?? 'null';
    classifiedBy[key] = (classifiedBy[key] || 0) + 1;
  }

  // ── Intent distribution ────────────────────────────────────────────────
  const intents = {};
  for (const s of snapshots) {
    const key = s.classification.intent ?? 'null';
    intents[key] = (intents[key] || 0) + 1;
  }

  // ── Execution metrics ──────────────────────────────────────────────────
  const turnsWithExecution = snapshots.filter(s => s.execution.status !== null);
  const turnsSuccess = snapshots.filter(s => s.execution.status === 'SUCCESS');
  const turnsPartial = snapshots.filter(s => s.execution.partialFailure === true);
  const turnsFailed = snapshots.filter(s => s.execution.status === 'FAILED');
  const turnsCancelled = snapshots.filter(s => s.execution.wasCancelled === true);

  // ── Retry distribution ─────────────────────────────────────────────────
  const retryCounts = snapshots.map(s => s.execution.retryCount).filter(v => v > 0);
  const totalRetries = retryCounts.reduce((a, b) => a + b, 0);
  const avgRetryCount = turnsWithExecution.length > 0
    ? (totalRetries / turnsWithExecution.length).toFixed(3)
    : '0';

  // ── Circuit breaker metrics ────────────────────────────────────────────
  const turnsWithCircuitOpen = snapshots.filter(s => s.circuit.anyOpened === true);

  // ── Tool failure rate ──────────────────────────────────────────────────
  const toolStats = {};
  for (const s of snapshots) {
    for (const t of s.execution.toolsInvoked) {
      if (!toolStats[t.tool]) toolStats[t.tool] = { total: 0, failed: 0, totalDurationMs: 0, retries: 0 };
      toolStats[t.tool].total++;
      if (!t.success) toolStats[t.tool].failed++;
      toolStats[t.tool].totalDurationMs += t.durationMs;
      toolStats[t.tool].retries += t.retryCount;
    }
  }

  // ── Cancel distribution ────────────────────────────────────────────────
  const cancelSources = { user: 0, timeout: 0 };
  for (const s of snapshots.filter(s => s.execution.wasCancelled)) {
    cancelSources[s.execution.abortSource] = (cancelSources[s.execution.abortSource] || 0) + 1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`${'─'.repeat(60)}`);
  console.log('  TIMING DISTRIBUTION');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  totalTurnTimeMs:`);
  console.log(`    p50 = ${percentile(totalTurnTimes, 50)}ms`);
  console.log(`    p95 = ${percentile(totalTurnTimes, 95)}ms`);
  console.log(`    p99 = ${percentile(totalTurnTimes, 99)}ms`);
  console.log(`    max = ${totalTurnTimes[totalTurnTimes.length - 1] ?? 'N/A'}ms`);
  console.log(`  classificationTimeMs:`);
  console.log(`    p50 = ${percentile(classificationTimes, 50)}ms`);
  console.log(`    p95 = ${percentile(classificationTimes, 95)}ms`);
  if (executionTimes.length > 0) {
    console.log(`  executionTimeMs (${executionTimes.length} turns with execution):`);
    console.log(`    p50 = ${percentile(executionTimes, 50)}ms`);
    console.log(`    p95 = ${percentile(executionTimes, 95)}ms`);
    console.log(`    p99 = ${percentile(executionTimes, 99)}ms`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  CLASSIFICATION');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  classifiedBy:`);
  for (const [method, count] of Object.entries(classifiedBy).sort((a, b) => b[1] - a[1])) {
    if (count > 0) console.log(`    ${method}: ${count} (${(count / total * 100).toFixed(1)}%)`);
  }
  console.log(`  intent distribution (top 10):`);
  const sortedIntents = Object.entries(intents).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [intent, count] of sortedIntents) {
    console.log(`    ${intent}: ${count} (${(count / total * 100).toFixed(1)}%)`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  EXECUTION');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  turns with execution: ${turnsWithExecution.length}/${total} (${(turnsWithExecution.length / total * 100).toFixed(1)}%)`);
  console.log(`  SUCCESS:  ${turnsSuccess.length}`);
  console.log(`  PARTIAL:  ${turnsPartial.length} (${(turnsPartial.length / Math.max(turnsWithExecution.length, 1) * 100).toFixed(1)}%)`);
  console.log(`  FAILED:   ${turnsFailed.length} (${(turnsFailed.length / Math.max(turnsWithExecution.length, 1) * 100).toFixed(1)}%)`);
  console.log(`  cancelled: ${turnsCancelled.length} (${(turnsCancelled.length / total * 100).toFixed(1)}%)`);
  if (turnsCancelled.length > 0) {
    console.log(`    user: ${cancelSources.user}, timeout: ${cancelSources.timeout}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  RETRIES');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  total retries: ${totalRetries}`);
  console.log(`  avg retryCount (exec turns): ${avgRetryCount}`);
  console.log(`  turns with retries > 0: ${retryCounts.length}`);

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  CIRCUIT BREAKER');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  turns with circuit OPEN: ${turnsWithCircuitOpen.length} (${(turnsWithCircuitOpen.length / total * 100).toFixed(1)}%)`);

  if (Object.keys(toolStats).length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('  PER-TOOL STATS');
    console.log(`${'─'.repeat(60)}`);
    for (const [tool, stats] of Object.entries(toolStats).sort((a, b) => b[1].total - a[1].total)) {
      const failRate = (stats.failed / stats.total * 100).toFixed(1);
      const avgDuration = Math.round(stats.totalDurationMs / stats.total);
      console.log(`  ${tool}: ${stats.total} invocations, ${stats.failed} failed (${failRate}%), avg ${avgDuration}ms, ${stats.retries} retries`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTLIER DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  const p95Total = percentile(totalTurnTimes, 95) ?? 0;
  const outliers = snapshots.filter(s => {
    const t = s.timing.totalTurnTimeMs ?? 0;
    return (p95Total > 0 && t > 2 * p95Total) || s.execution.retryCount > 2 || s.circuit.anyOpened;
  });

  if (outliers.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  OUTLIERS (${outliers.length} turns)`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`  Criteria: >2×p95 (${2 * p95Total}ms) OR retryCount>2 OR circuit OPEN`);
    for (const o of outliers.slice(0, 10)) {
      const reasons = [];
      if (p95Total > 0 && (o.timing.totalTurnTimeMs ?? 0) > 2 * p95Total) reasons.push(`slow:${o.timing.totalTurnTimeMs}ms`);
      if (o.execution.retryCount > 2) reasons.push(`retries:${o.execution.retryCount}`);
      if (o.circuit.anyOpened) reasons.push('circuit:OPEN');
      console.log(`    ${o.turnId}: ${reasons.join(', ')}`);
    }
    if (outliers.length > 10) {
      console.log(`    ... and ${outliers.length - 10} more`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURAL ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  STRUCTURAL ASSERTIONS');
  console.log(`${'─'.repeat(60)}`);

  let assertPassed = 0;
  let assertFailed = 0;

  function check(name, condition) {
    if (condition) {
      assertPassed++;
      console.log(`  ✅ ${name}`);
    } else {
      assertFailed++;
      console.log(`  ❌ ${name}`);
    }
  }

  check('All snapshots have version: 2',
    snapshots.every(s => s.version === 2));

  check('All snapshots have turnId, sessionId, conversationId',
    snapshots.every(s => s.turnId && s.sessionId && s.conversationId));

  check('All snapshots have timing block',
    snapshots.every(s => s.timing !== undefined && s.timing !== null));

  check('All snapshots are frozen',
    snapshots.every(s => Object.isFrozen(s)));

  check('All snapshots have classification block',
    snapshots.every(s => s.classification !== undefined));

  check('All v2 snapshots are eligible for telemetry aggregation',
    aggregation?.metrics?.observedTurns === total
      && aggregation?.metrics?.totalTurns === total);

  const execTurns = snapshots.filter(s => s.execution.toolsInvoked.length > 0);
  check('Execution turns have status set',
    execTurns.every(s => s.execution.status !== null));

  check('circuit.anyOpened consistent with states',
    snapshots.every(s => {
      if (s.circuit.anyOpened) {
        return s.circuit.states.some(st => st.stateAfter === 'OPEN');
      }
      return true;
    }));

  const turnIds = snapshots.map(s => s.turnId);
  check('All turnIds are unique',
    new Set(turnIds).size === turnIds.length);

  check('Cancelled turns have abortSource',
    snapshots.filter(s => s.execution.wasCancelled).every(s => s.execution.abortSource !== null));

  check('retryCount is non-negative for all turns',
    snapshots.every(s => s.execution.retryCount >= 0));

  check('PARTIAL status has at least one tool invocation',
    snapshots.filter(s => s.execution.status === 'PARTIAL').every(s => s.execution.toolsInvoked.length > 0));

  // Sanity: at least some turns had execution
  check('At least 20% of turns had tool execution',
    turnsWithExecution.length >= total * 0.2);

  // Sanity: deterministic+llm classification adds up
  const totalClassified = Object.values(classifiedBy).reduce((a, b) => a + b, 0);
  check('Classification counts match total turns',
    totalClassified === total);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SOAK TEST: ${assertPassed} assertions passed, ${assertFailed} failed`);
  console.log(`  Total turns: ${total}, Duration: ${((Date.now() - globalStart) / 1000).toFixed(1)}s`);
  console.log(`${'═'.repeat(60)}\n`);

  return assertFailed === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const globalStart = Date.now();
const success = await runSoakTest();
process.exit(success ? 0 : 1);
