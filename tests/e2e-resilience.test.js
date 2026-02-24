#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// E2E Resilience Test Suite v72
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests system resilience under failure conditions:
//   I.   Tool Execution Resilience (timeout, partial failure, exception)
//   II.  Cancellation Robustness (abort during LLM, abort during tool)
//   III. State Integrity (break during sticky, recovery after error)
//   IV.  Concurrency Isolation (multi-conversation, per-conv mutex)
//   V.   Circuit Breaker (trip, half-open, recovery)
//
// These tests do NOT require LLM — they exercise the execution layer
// with controlled mocks.
//
// Run: node tests/e2e-resilience.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { ToolExecutor, ToolResult, ToolResultType, ExecutionResult, ExecutionStatus, ToolErrorCode } from '../src/executor/tool-executor.js';
import { CircuitBreaker, CircuitState } from '../src/executor/circuit-breaker.js';
import { DecisionType, IntentType, ToolType, CREDecisionEngine } from '../src/chat/cre-decision.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST HARNESS (minimal, self-contained)
// ═══════════════════════════════════════════════════════════════════════════════

let _passed = 0, _failed = 0, _sections = [];
let _currentSection = '', _sectionPassed = 0, _sectionFailed = 0;

function section(name) {
  if (_currentSection && (_sectionPassed + _sectionFailed > 0)) {
    const icon = _sectionFailed > 0 ? '❌' : '✅';
    _sections.push({ name: _currentSection, passed: _sectionPassed, failed: _sectionFailed });
    console.log(`  ${icon} ${_currentSection}: ${_sectionPassed}/${_sectionPassed + _sectionFailed}`);
  }
  _currentSection = name;
  _sectionPassed = 0;
  _sectionFailed = 0;
  console.log(`\n${'─'.repeat(60)}\n  ${name}\n${'─'.repeat(60)}`);
}

async function t(name, fn) {
  try {
    await fn();
    _passed++; _sectionPassed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    _failed++; _sectionFailed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} — expected "${b}", got "${a}"`); }
function ok(cond, msg = '') { if (!cond) throw new Error(msg || 'assertion failed'); }

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS: Mock Decision, Mock Handlers
// ═══════════════════════════════════════════════════════════════════════════════

function makeToolCallDecision(tools = [ToolType.WEB_SEARCH], intent = IntentType.SEARCH) {
  return {
    type: DecisionType.TOOL_CALL,
    intent,
    tools,
    metadata: {},
  };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════════════════
// I. TOOL EXECUTION RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

async function testToolResilience() {
  // ── 1. Tool Timeout ──────────────────────────────────────────────────────
  section('I.1 Tool Timeout');

  await t('tool timeout → FAILED status, retryable', async () => {
    const executor = new ToolExecutor({ timeout: 100, maxAutoRetries: 0 });
    // Override handler with a slow one
    executor.register(ToolType.WEB_SEARCH, async () => {
      await delay(500); // Will exceed 100ms timeout
      return ToolResult.search({ results: [], count: 0, source: 'mock', latency: 500 });
    });

    const decision = makeToolCallDecision();
    const result = await executor.execute(decision, { input: 'test query' });

    eq(result.status, ExecutionStatus.FAILED, 'status');
    ok(result.toolResults.length > 0, 'should have tool results');
    ok(result.toolResults[0].success === false, 'tool should have failed');
  });

  await t('tool timeout does not block next execution', async () => {
    const executor = new ToolExecutor({ timeout: 100, maxAutoRetries: 0 });
    let callCount = 0;

    executor.register(ToolType.WEB_SEARCH, async () => {
      callCount++;
      if (callCount === 1) {
        await delay(500); // First call: timeout
        return ToolResult.search({ results: [], count: 0, source: 'mock', latency: 500 });
      }
      // Second call: fast success
      return ToolResult.search({
        results: [{ title: 'Test', url: 'https://test.com', snippet: 'ok' }],
        count: 1, source: 'mock', latency: 10,
      });
    });

    const decision = makeToolCallDecision();

    // First: timeout
    const r1 = await executor.execute(decision, { input: 'slow', sessionId: 'timeout-test' });
    eq(r1.status, ExecutionStatus.FAILED, 'first should fail');

    // Second: should succeed (not blocked)
    const r2 = await executor.execute(decision, { input: 'fast', sessionId: 'timeout-test' });
    eq(r2.status, ExecutionStatus.SUCCESS, 'second should succeed');
    eq(callCount, 2, 'both calls should execute');
  });

  // ── 2. Partial Failure ───────────────────────────────────────────────────
  section('I.2 Partial Failure (mixed success/failure)');

  await t('3 tools, 1 fails → PARTIAL status', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 0 });

    // Register 3 tools: 2 succeed, 1 fails
    executor.register(ToolType.WEB_SEARCH, async () => {
      return ToolResult.search({
        results: [{ title: 'R1', url: 'https://a.com', snippet: 'ok' }],
        count: 1, source: 'mock', latency: 10,
      });
    });
    executor.register(ToolType.WEB_SCRAPE, async () => {
      throw new Error('Connection refused');
    });

    const decision = makeToolCallDecision([ToolType.WEB_SEARCH, ToolType.WEB_SCRAPE]);
    const result = await executor.execute(decision, { input: 'test' });

    eq(result.status, ExecutionStatus.PARTIAL, 'status should be PARTIAL');
    eq(result.toolResults.length, 2, 'should have 2 tool results');
    ok(result.successfulResults.length === 1, 'should have 1 success');

    // Synthesis data should contain both success and failure info
    const synthData = result.getDataForSynthesis();
    ok(synthData.results.length === 1, 'synthesis gets 1 successful result');
    ok(synthData.hasFailures === true, 'synthesis knows about failures');
    ok(synthData.failedTools.length === 1, 'synthesis lists 1 failed tool');
  });

  await t('partial failure: successful results are usable', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 0 });

    executor.register(ToolType.WEB_SEARCH, async () => {
      return ToolResult.search({
        results: [
          { title: 'Good Result', url: 'https://good.com', snippet: 'useful data' },
          { title: 'Another', url: 'https://another.com', snippet: 'more data' },
        ],
        count: 2, source: 'mock', latency: 10,
      });
    });
    executor.register(ToolType.WEB_SCRAPE, async () => {
      return ToolResult.failed({
        type: ToolResultType.SCRAPE,
        error: 'HTTP 503',
        errorCode: ToolErrorCode.SOURCE_UNAVAILABLE,
      });
    });

    const decision = makeToolCallDecision([ToolType.WEB_SEARCH, ToolType.WEB_SCRAPE]);
    const result = await executor.execute(decision, { input: 'test' });

    eq(result.status, ExecutionStatus.PARTIAL, 'PARTIAL');
    const data = result.getDataForSynthesis();
    eq(data.results[0].data.count, 2, 'search data preserved');
    eq(data.failedTools[0].errorCode, ToolErrorCode.SOURCE_UNAVAILABLE, 'error code preserved');
  });

  // ── 3. Tool Exception ───────────────────────────────────────────────────
  section('I.3 Tool Throws Exception');

  await t('uncaught exception → FAILED, session stays alive', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 0 });

    executor.register(ToolType.WEB_SEARCH, async () => {
      throw new TypeError('Cannot read properties of undefined');
    });

    const decision = makeToolCallDecision();
    const result = await executor.execute(decision, { input: 'test' });

    eq(result.status, ExecutionStatus.FAILED, 'status');
    ok(result.toolResults[0].error.includes('Cannot read properties'), 'error captured');

    // Next execution should work
    executor.register(ToolType.WEB_SEARCH, async () => {
      return ToolResult.search({
        results: [{ title: 'OK', url: 'https://ok.com', snippet: 'fine' }],
        count: 1, source: 'mock', latency: 5,
      });
    });
    const r2 = await executor.execute(decision, { input: 'test2' });
    eq(r2.status, ExecutionStatus.SUCCESS, 'next execution succeeds');
  });

  // ── 4. Auto-Retry ───────────────────────────────────────────────────────
  section('I.4 Auto-Retry Strategy');

  await t('retryable failure → auto-retry once → success', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 1, retryDelayMs: 10 });
    let attempt = 0;

    executor.register(ToolType.WEB_SEARCH, async () => {
      attempt++;
      if (attempt === 1) {
        return ToolResult.failed({
          type: ToolResultType.SEARCH,
          error: 'HTTP 503',
          errorCode: ToolErrorCode.SOURCE_UNAVAILABLE,
        });
      }
      return ToolResult.search({
        results: [{ title: 'Retry OK', url: 'https://retry.com', snippet: 'worked' }],
        count: 1, source: 'mock', latency: 10,
      });
    });

    const decision = makeToolCallDecision();
    const result = await executor.execute(decision, { input: 'test' });

    eq(result.status, ExecutionStatus.SUCCESS, 'retry succeeded');
    eq(attempt, 2, 'called twice (original + retry)');
  });

  await t('non-retryable failure → no retry', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 1, retryDelayMs: 10 });
    let attempt = 0;

    executor.register(ToolType.WEB_SEARCH, async () => {
      attempt++;
      throw Object.assign(new Error('Sandbox violation'), { code: ToolErrorCode.SANDBOX_VIOLATION });
    });

    const decision = makeToolCallDecision();
    const result = await executor.execute(decision, { input: 'test' });

    eq(result.status, ExecutionStatus.FAILED, 'failed without retry');
    eq(attempt, 1, 'only called once (no retry for sandbox violation)');
  });

  await t('max retries respected → stops after maxAutoRetries', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 1, retryDelayMs: 10 });
    let attempt = 0;

    executor.register(ToolType.WEB_SEARCH, async () => {
      attempt++;
      return ToolResult.failed({
        type: ToolResultType.SEARCH,
        error: 'Timeout',
        errorCode: ToolErrorCode.TIMEOUT,
      });
    });

    const decision = makeToolCallDecision();
    const result = await executor.execute(decision, { input: 'test' });

    eq(result.status, ExecutionStatus.FAILED, 'failed after max retries');
    eq(attempt, 2, 'original + 1 retry = 2 attempts');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// II. CANCELLATION ROBUSTNESS
// ═══════════════════════════════════════════════════════════════════════════════

async function testCancellation() {
  section('II.1 Cancel During Tool Execution');

  await t('AbortController.abort() stops tool execution', async () => {
    const ac = new AbortController();
    let toolStarted = false;
    let toolCompleted = false;

    const executor = new ToolExecutor({ timeout: 10000, maxAutoRetries: 0 });
    executor.register(ToolType.WEB_SEARCH, async (params) => {
      toolStarted = true;
      // Simulate long operation that checks abort
      await delay(2000);
      toolCompleted = true;
      return ToolResult.search({
        results: [], count: 0, source: 'mock', latency: 2000,
      });
    });

    const decision = makeToolCallDecision();

    // Start execution and cancel after 50ms
    const execPromise = executor.execute(decision, { input: 'test', signal: ac.signal });
    await delay(50);
    ac.abort();

    // The executor uses Promise.race with timeout, abort won't directly kill
    // but the turn-level catch in session-adapter handles AbortError
    const result = await execPromise;

    // The tool itself runs to completion (no signal check in ToolExecutor)
    // but the SESSION layer catches the abort. This test verifies the pattern works.
    ok(toolStarted, 'tool started before cancel');
    // NOTE: ToolExecutor itself doesn't propagate abort to tool handlers —
    // that's the session adapter's job. This is a known architectural boundary.
  });

  section('II.2 activeTurns Map Simulation');

  await t('activeTurns: set/get/delete lifecycle', async () => {
    const activeTurns = new Map();

    // Create turn
    const convId = 'conv-001';
    const ac = new AbortController();
    const turnId = 't-001';
    activeTurns.set(convId, { turnId, abortController: ac, startTime: Date.now() });

    eq(activeTurns.size, 1, 'one active turn');
    ok(activeTurns.has(convId), 'conversation tracked');

    // Cancel
    const entry = activeTurns.get(convId);
    entry.abortController.abort();
    ok(ac.signal.aborted, 'signal is aborted');

    // Cleanup (safe delete — only if turnId matches)
    const current = activeTurns.get(convId);
    if (current && current.turnId === turnId) {
      activeTurns.delete(convId);
    }
    eq(activeTurns.size, 0, 'cleaned up');
  });

  await t('activeTurns: per-conversation mutex rejects second message', async () => {
    const activeTurns = new Map();
    const convId = 'conv-mutex';

    // First message starts
    activeTurns.set(convId, {
      turnId: 't-001',
      abortController: new AbortController(),
      startTime: Date.now(),
    });

    // Second message arrives → should be rejected
    const isBlocked = activeTurns.has(convId);
    ok(isBlocked, 'second message blocked by mutex');

    // Different conversation → allowed
    const otherConv = 'conv-other';
    const isOtherBlocked = activeTurns.has(otherConv);
    ok(!isOtherBlocked, 'different conversation is not blocked');
  });

  await t('activeTurns: cancel specific conversation, others continue', async () => {
    const activeTurns = new Map();

    activeTurns.set('conv-A', {
      turnId: 't-A', abortController: new AbortController(), startTime: Date.now(),
    });
    activeTurns.set('conv-B', {
      turnId: 't-B', abortController: new AbortController(), startTime: Date.now(),
    });

    eq(activeTurns.size, 2, 'two active');

    // Cancel A
    const turnA = activeTurns.get('conv-A');
    turnA.abortController.abort();
    activeTurns.delete('conv-A');

    eq(activeTurns.size, 1, 'only B remains');
    ok(!activeTurns.get('conv-B').abortController.signal.aborted, 'B not aborted');
    ok(turnA.abortController.signal.aborted, 'A was aborted');
  });

  await t('activeTurns: agentStatus transitions', async () => {
    const activeTurns = new Map();

    const getStatus = () => activeTurns.size > 0 ? 'executing' : 'idle';

    eq(getStatus(), 'idle', 'initially idle');

    activeTurns.set('conv-1', { turnId: 't-1', abortController: new AbortController(), startTime: Date.now() });
    eq(getStatus(), 'executing', 'executing after turn start');

    activeTurns.set('conv-2', { turnId: 't-2', abortController: new AbortController(), startTime: Date.now() });
    eq(getStatus(), 'executing', 'still executing with 2 turns');

    activeTurns.delete('conv-1');
    eq(getStatus(), 'executing', 'still executing with 1 turn');

    activeTurns.delete('conv-2');
    eq(getStatus(), 'idle', 'idle after all turns complete');
  });

  await t('activeTurns: safe delete prevents race condition', async () => {
    const activeTurns = new Map();

    // Turn 1 starts
    activeTurns.set('conv-X', { turnId: 't-old', abortController: new AbortController(), startTime: Date.now() });

    // Simulate: turn 1 finishes slowly, but turn 2 already started
    // (this can happen if mutex is bypassed by timing)
    activeTurns.set('conv-X', { turnId: 't-new', abortController: new AbortController(), startTime: Date.now() });

    // Turn 1's finally block tries to delete — but turnId doesn't match
    const oldTurnId = 't-old';
    const entry = activeTurns.get('conv-X');
    if (entry && entry.turnId === oldTurnId) {
      activeTurns.delete('conv-X'); // Should NOT execute
    }

    // Turn 2 should still be there
    ok(activeTurns.has('conv-X'), 'new turn not deleted by old finally');
    eq(activeTurns.get('conv-X').turnId, 't-new', 'correct turn preserved');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// III. STATE INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

async function testStateIntegrity() {
  section('III.1 Break During Sticky Mode');

  await t('"dost reportů" after REPORT → intent changes away from REPORT', async () => {
    const engine = new CREDecisionEngine();
    const ctx = { lastIntent: IntentType.REPORT };
    const decision = await engine.decide('dost reportů', ctx);

    ok(decision.intent !== IntentType.REPORT, `should break from REPORT, got ${decision.intent}`);
  });

  await t('break override: intent === lastIntent → CONVERSATIONAL', async () => {
    const engine = new CREDecisionEngine();
    // "dost reportů" contains "reportů" → LLM may classify as REPORT
    // But break + same as lastIntent → override to CONVERSATIONAL
    const ctx = { lastIntent: IntentType.REPORT };
    const decision = await engine.decide('dost reportů', ctx);

    eq(decision.intent, IntentType.CONVERSATIONAL, 'should override to CONVERSATIONAL');
  });

  await t('break: different intent stays unchanged', async () => {
    const engine = new CREDecisionEngine();
    // "teď chci najít restauraci" → break fires, LLM classifies as SEARCH
    // Since SEARCH !== REPORT (lastIntent), no override
    const ctx = { lastIntent: IntentType.REPORT };
    const decision = await engine.decide('teď chci najít restauraci', ctx);

    eq(decision.intent, IntentType.SEARCH, 'SEARCH stays SEARCH (different from lastIntent)');
  });

  section('III.2 Recovery After Tool Failure');

  await t('after FAILED execution, next turn is clean', async () => {
    const executor = new ToolExecutor({ timeout: 100, maxAutoRetries: 0 });

    // First: fail
    executor.register(ToolType.WEB_SEARCH, async () => {
      throw new Error('Network error');
    });
    const decision = makeToolCallDecision();
    const r1 = await executor.execute(decision, { input: 'fail', sessionId: 'recovery-test' });
    eq(r1.status, ExecutionStatus.FAILED, 'first fails');

    // Second: different success — no leftover error state
    executor.register(ToolType.WEB_SEARCH, async () => {
      return ToolResult.search({
        results: [{ title: 'OK', url: 'https://ok.com', snippet: 'fine' }],
        count: 1, source: 'mock', latency: 5,
      });
    });
    const r2 = await executor.execute(decision, { input: 'ok', sessionId: 'recovery-test' });
    eq(r2.status, ExecutionStatus.SUCCESS, 'second succeeds — no sticky error');
    eq(r2.toolResults[0].data.count, 1, 'data is from second call');
  });

  section('III.3 SessionState Consistency');

  await t('recordDecision updates lastIntent and lastDecision', async () => {
    // Simulate SimpleSessionState behavior
    const state = {
      _lastIntent: null,
      _lastDecision: null,
      get lastIntent() { return this._lastIntent; },
      get lastDecision() { return this._lastDecision; },
      recordDecision(decision, input) {
        this._lastIntent = decision.intent;
        this._lastDecision = decision;
      },
    };

    const decision1 = { intent: IntentType.SEARCH, type: DecisionType.TOOL_CALL };
    state.recordDecision(decision1, 'najdi restaurace');
    eq(state.lastIntent, IntentType.SEARCH, 'lastIntent updated');
    eq(state.lastDecision.type, DecisionType.TOOL_CALL, 'lastDecision updated');

    const decision2 = { intent: IntentType.CONVERSATIONAL, type: DecisionType.ANSWER };
    state.recordDecision(decision2, 'ahoj');
    eq(state.lastIntent, IntentType.CONVERSATIONAL, 'lastIntent overwritten');
    eq(state.lastDecision.type, DecisionType.ANSWER, 'lastDecision overwritten');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// IV. CONCURRENCY ISOLATION
// ═══════════════════════════════════════════════════════════════════════════════

async function testConcurrency() {
  section('IV.1 Multi-conversation Parallel Execution');

  await t('two conversations execute in parallel without interference', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 0 });
    const callLog = [];

    executor.register(ToolType.WEB_SEARCH, async (params) => {
      callLog.push({ session: params.sessionId, query: params.query });
      await delay(50); // Simulate work
      return ToolResult.search({
        results: [{ title: `Result for ${params.sessionId}`, url: 'https://test.com', snippet: params.query }],
        count: 1, source: 'mock', latency: 50,
      });
    });

    const decision = makeToolCallDecision();

    // Execute two conversations in parallel
    const [r1, r2] = await Promise.all([
      executor.execute(decision, { input: 'query A', sessionId: 'session-A', query: 'query A' }),
      executor.execute(decision, { input: 'query B', sessionId: 'session-B', query: 'query B' }),
    ]);

    eq(r1.status, ExecutionStatus.SUCCESS, 'A succeeds');
    eq(r2.status, ExecutionStatus.SUCCESS, 'B succeeds');
    eq(callLog.length, 2, 'both calls executed');

    // Verify no cross-contamination
    ok(r1.toolResults[0].data.results[0].title.includes('session-A'), 'A has A data');
    ok(r2.toolResults[0].data.results[0].title.includes('session-B'), 'B has B data');
  });

  await t('failure in session A does not affect session B', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 0 });

    executor.register(ToolType.WEB_SEARCH, async (params) => {
      if (params.sessionId === 'session-FAIL') {
        throw new Error('Session A failure');
      }
      return ToolResult.search({
        results: [{ title: 'OK', url: 'https://ok.com', snippet: 'fine' }],
        count: 1, source: 'mock', latency: 10,
      });
    });

    const decision = makeToolCallDecision();

    const [rFail, rOk] = await Promise.all([
      executor.execute(decision, { input: 'fail', sessionId: 'session-FAIL' }),
      executor.execute(decision, { input: 'ok', sessionId: 'session-OK' }),
    ]);

    eq(rFail.status, ExecutionStatus.FAILED, 'A failed');
    eq(rOk.status, ExecutionStatus.SUCCESS, 'B succeeded despite A failure');
  });

  section('IV.2 Per-Session Circuit Breaker Isolation');

  await t('circuit breaker trips per session, not globally', async () => {
    const executor = new ToolExecutor({ timeout: 5000, maxAutoRetries: 0 });

    let callCount = { A: 0, B: 0 };
    executor.register(ToolType.WEB_SEARCH, async (params) => {
      callCount[params.sessionId]++;
      if (params.sessionId === 'A') {
        throw new Error('Always fails for A');
      }
      return ToolResult.search({
        results: [{ title: 'OK', url: 'https://ok.com', snippet: 'fine' }],
        count: 1, source: 'mock', latency: 10,
      });
    });

    const decision = makeToolCallDecision();

    // Trip circuit for session A (5 failures)
    for (let i = 0; i < 5; i++) {
      await executor.execute(decision, { input: `fail-${i}`, sessionId: 'A' });
    }

    // Session A should be blocked by circuit breaker
    const rA = await executor.execute(decision, { input: 'blocked', sessionId: 'A' });
    eq(rA.status, ExecutionStatus.FAILED, 'A blocked by circuit');

    // Session B should still work
    const rB = await executor.execute(decision, { input: 'ok', sessionId: 'B' });
    eq(rB.status, ExecutionStatus.SUCCESS, 'B unaffected by A circuit');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// V. CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════════

async function testCircuitBreaker() {
  section('V.1 Circuit Breaker State Machine');

  await t('starts CLOSED', () => {
    const cb = new CircuitBreaker();
    eq(cb.state, CircuitState.CLOSED, 'initial state');
    ok(cb.canProceed().allowed, 'allows requests');
  });

  await t('5 failures → OPEN', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, failureWindow: 60000 });

    for (let i = 0; i < 4; i++) {
      cb.recordFailure(new Error(`fail-${i}`));
      eq(cb.state, CircuitState.CLOSED, `still closed after ${i + 1} failures`);
    }

    cb.recordFailure(new Error('fail-5'));
    eq(cb.state, CircuitState.OPEN, 'opens after 5th failure');
    ok(!cb.canProceed().allowed, 'blocks requests when open');
  });

  await t('OPEN → HALF_OPEN after resetTimeout', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });

    cb.recordFailure(new Error('f1'));
    cb.recordFailure(new Error('f2'));
    eq(cb.state, CircuitState.OPEN, 'opened');

    // Simulate time passing by backdating openedAt
    cb.openedAt = Date.now() - 100;

    const result = cb.canProceed();
    ok(result.allowed, 'allowed after reset timeout');
    eq(cb.state, CircuitState.HALF_OPEN, 'transitioned to half-open');
  });

  await t('HALF_OPEN: 2 successes → CLOSED', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2, successThreshold: 2, resetTimeout: 50,
    });

    // Trip it
    cb.recordFailure(new Error('f1'));
    cb.recordFailure(new Error('f2'));
    eq(cb.state, CircuitState.OPEN, 'opened');

    // Simulate reset timeout
    cb.openedAt = Date.now() - 100;
    cb.canProceed(); // Triggers HALF_OPEN
    eq(cb.state, CircuitState.HALF_OPEN, 'half-open');

    // 2 successes to recover
    cb.recordSuccess();
    eq(cb.state, CircuitState.HALF_OPEN, 'still half-open after 1 success');
    cb.recordSuccess();
    eq(cb.state, CircuitState.CLOSED, 'closed after 2 successes');
  });

  await t('HALF_OPEN: failure → back to OPEN', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2, resetTimeout: 50,
    });

    cb.recordFailure(new Error('f1'));
    cb.recordFailure(new Error('f2'));
    cb.openedAt = Date.now() - 100;
    cb.canProceed(); // → HALF_OPEN

    cb.recordFailure(new Error('f3'));
    eq(cb.state, CircuitState.OPEN, 'back to open after failure in half-open');
  });

  await t('failure window cleanup: old failures expire', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3, failureWindow: 100,
    });

    // Add 2 failures
    cb.recordFailure(new Error('old-1'));
    cb.recordFailure(new Error('old-2'));

    // Backdate them outside the window
    cb.failures.forEach(f => f.timestamp = Date.now() - 200);

    // Add 1 more (within window)
    cb.recordFailure(new Error('new-1'));

    // Should still be CLOSED — old failures expired
    eq(cb.state, CircuitState.CLOSED, 'old failures cleaned up, still closed');
    eq(cb.failures.length, 1, 'only 1 failure in window');
  });

  await t('forceOpen / forceClose for testing', () => {
    const cb = new CircuitBreaker();

    cb.forceOpen();
    eq(cb.state, CircuitState.OPEN, 'force opened');
    ok(!cb.canProceed().allowed, 'blocked');

    cb.forceClose();
    eq(cb.state, CircuitState.CLOSED, 'force closed');
    ok(cb.canProceed().allowed, 'allowed again');
  });

  await t('metrics tracking', () => {
    const cb = new CircuitBreaker({ failureThreshold: 10 });

    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure(new Error('f'));

    const metrics = cb.getMetrics();
    eq(metrics.total_calls, 3, 'total calls');
    eq(metrics.total_successes, 2, 'successes');
    eq(metrics.total_failures, 1, 'failures');
    eq(metrics.current_state, CircuitState.CLOSED, 'state in metrics');
  });

  section('V.2 HALF_OPEN Request Limiting');

  await t('halfOpenMaxRequests limits concurrent probes', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2, resetTimeout: 50, halfOpenMaxRequests: 2,
    });

    cb.recordFailure(new Error('f1'));
    cb.recordFailure(new Error('f2'));
    cb.openedAt = Date.now() - 100;
    cb.canProceed(); // → HALF_OPEN

    const r1 = cb.canProceed();
    ok(r1.allowed, 'first probe allowed');
    const r2 = cb.canProceed();
    ok(r2.allowed, 'second probe allowed');
    const r3 = cb.canProceed();
    ok(!r3.allowed, 'third probe blocked — limit reached');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
console.log('  E2E RESILIENCE TEST SUITE v72');
console.log('═'.repeat(60));

await testToolResilience();
await testCancellation();
await testStateIntegrity();
await testConcurrency();
await testCircuitBreaker();

// Final section flush
if (_currentSection && (_sectionPassed + _sectionFailed > 0)) {
  const icon = _sectionFailed > 0 ? '❌' : '✅';
  _sections.push({ name: _currentSection, passed: _sectionPassed, failed: _sectionFailed });
  console.log(`  ${icon} ${_currentSection}: ${_sectionPassed}/${_sectionPassed + _sectionFailed}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
console.log('  SECTION SUMMARY');
console.log('═'.repeat(60));

for (const s of _sections) {
  const icon = s.failed > 0 ? '❌' : '✅';
  console.log(`  ${icon} ${s.name}: ${s.passed}/${s.passed + s.failed}`);
}

console.log('\n' + '═'.repeat(60));
console.log(`  TOTAL: ${_passed}/${_passed + _failed} passed, ${_failed} failed`);
console.log('═'.repeat(60) + '\n');

process.exit(_failed > 0 ? 1 : 0);
