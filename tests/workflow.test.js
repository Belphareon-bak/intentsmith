// tests/workflow.test.js — Workflow orchestrator unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  WorkflowOrchestrator,
  WorkflowSession,
  WorkflowState,
  ReviewVerdict,
  callLLM,
  callSpecDocumentLLM,
} from '../src/planner/workflow.js';
import { callWithPolicy, llmGateway } from '../src/llm/gateway.js';
import {
  LLMCallerRole,
  LLMOperation,
  authTokenOperation,
  createAuthToken,
} from '../src/llm/auth-types.js';
import { config } from '../src/config.js';

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowState — enum completeness');
// ═══════════════════════════════════════════════════════════════════════════════

test('All required states exist', () => {
  const required = [
    'IDLE', 'ANALYZING', 'CLARIFYING', 'PLANNING',
    'AWAITING_APPROVAL', 'IMPLEMENTING', 'QUICK_REVIEWING',
    'FIX_DELIBERATING', 'APPLYING_FIX', 'FINAL_REVIEWING',
    'REDESIGNING', 'COMPLETED', 'FAILED',
  ];
  for (const s of required) {
    assert(WorkflowState[s] != null, `WorkflowState.${s} must exist`);
  }
});

test('ReviewVerdict has PASS, FAIL, REDESIGN', () => {
  assert(ReviewVerdict.PASS != null);
  assert(ReviewVerdict.FAIL != null);
  assert(ReviewVerdict.REDESIGN != null);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowSession — lifecycle');
// ═══════════════════════════════════════════════════════════════════════════════

test('New session starts IDLE', () => {
  const session = new WorkflowSession('sess-1', 'test-req');
  assertEqual(session.state, WorkflowState.IDLE);
  assertEqual(session.request, 'test-req');
});

test('Session has unique ID', () => {
  const s1 = new WorkflowSession('a', 'req-a');
  const s2 = new WorkflowSession('b', 'req-b');
  assert(s1.id !== s2.id, 'Session IDs should be unique');
});

test('Session tracks state changes', () => {
  const session = new WorkflowSession('s1', 'test');
  session.state = WorkflowState.ANALYZING;
  session.state = WorkflowState.PLANNING;
  assertEqual(session.state, WorkflowState.PLANNING);
});

test('Session addStep records step results', () => {
  const session = new WorkflowSession('s2', 'test');
  session.addStep({
    role: 'D1',
    action: 'analyze',
    result: { ready: true },
    duration: 1500,
  });
  assertEqual(session.history.length, 1);
  assertEqual(session.history[0].role, 'D1');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — construction');
// ═══════════════════════════════════════════════════════════════════════════════

test('WorkflowOrchestrator creates with defaults', () => {
  const orch = new WorkflowOrchestrator();
  assert(orch != null, 'Should construct');
});

test('WorkflowOrchestrator has required methods', () => {
  const orch = new WorkflowOrchestrator();
  assert(typeof orch.start === 'function', 'start');
  assert(typeof orch.clarify === 'function', 'clarify');
  assert(typeof orch.approve === 'function', 'approve');
  assert(typeof orch.reject === 'function', 'reject');
  assert(typeof orch.getSession === 'function', 'getSession');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — session management');
// ═══════════════════════════════════════════════════════════════════════════════

test('getSession returns null for unknown ID', () => {
  const orch = new WorkflowOrchestrator();
  assertEqual(orch.getSession('nonexistent'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowSession — transition() and _onUpdate (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

test('transition() sets state and updates timestamp', () => {
  const session = new WorkflowSession('t1', 'req');
  const before = session.updatedAt;
  session.transition(WorkflowState.ANALYZING);
  assertEqual(session.state, WorkflowState.ANALYZING);
  assert(session.updatedAt >= before, 'updatedAt should advance');
});

test('transition() calls _onUpdate callback', () => {
  const session = new WorkflowSession('t2', 'req');
  let callbackCalled = false;
  let callbackArg = null;
  session._onUpdate = (s) => { callbackCalled = true; callbackArg = s; };
  session.transition(WorkflowState.PLANNING);
  assert(callbackCalled, 'Callback should be called');
  assertEqual(callbackArg, session);
});

test('addStep() calls _onUpdate callback', () => {
  const session = new WorkflowSession('t3', 'req');
  let calls = 0;
  session._onUpdate = () => { calls++; };
  session.addStep({ step: 'TEST', model: 'test', output: 'ok' });
  assertEqual(calls, 1);
  session.addStep({ step: 'TEST2', model: 'test', output: 'ok2' });
  assertEqual(calls, 2);
  assertEqual(session.history.length, 2);
});

test('No callback = no error', () => {
  const session = new WorkflowSession('t4', 'req');
  session.transition(WorkflowState.FAILED); // should not throw
  session.addStep({ step: 'X', model: 'm', output: 'o' }); // should not throw
  assertEqual(session.state, WorkflowState.FAILED);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — DB persistence (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

// Mock DB that simulates workflowSessions repository
function createMockDb() {
  const store = new Map();
  return {
    _store: store,
    findById: {
      get(id) { return store.get(id) || undefined; },
    },
    listActive: {
      all() { return [...store.values()].filter(r => r.state !== 'COMPLETED' && r.state !== 'FAILED'); },
    },
    listAll: {
      all() { return [...store.values()].sort((a, b) => b.updated_at > a.updated_at ? 1 : -1).slice(0, 50); },
    },
    getOrCreate(sessionId, projectId, request, complexity = 'SIMPLE') {
      if (store.has(sessionId)) return store.get(sessionId);
      const row = {
        session_id: sessionId,
        project_id: projectId,
        state: 'INIT',
        complexity,
        request,
        plan: null,
        implementation: null,
        timing: '{}',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set(sessionId, row);
      return row;
    },
    save(sessionId, state, plan, implementation, timing) {
      const existing = store.get(sessionId);
      if (!existing) return;
      existing.state = state;
      existing.plan = typeof plan === 'string' ? plan : JSON.stringify(plan);
      existing.implementation = typeof implementation === 'string' ? implementation : JSON.stringify(implementation);
      existing.timing = typeof timing === 'string' ? timing : JSON.stringify(timing);
      existing.updated_at = new Date().toISOString();
    },
  };
}

test('Constructor accepts db option', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });
  assertEqual(orch.db, db);
});

test('No db = no error', () => {
  const orch = new WorkflowOrchestrator();
  assertEqual(orch.db, null);
  // persist and createDbRow should silently no-op
  orch._persist({ id: 'x', state: 'IDLE' });
  orch._createDbRow({ id: 'x', request: 'test' });
});

test('_createDbRow creates row in mock DB', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });
  const session = new WorkflowSession('db-1', 'Create something');
  orch._createDbRow(session);
  const row = db._store.get('db-1');
  assert(row != null, 'Row should exist');
  assertEqual(row.request, 'Create something');
  assertEqual(row.state, 'INIT');
});

test('_persist updates state and data in DB', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });
  const session = new WorkflowSession('db-2', 'test-persist');
  orch._createDbRow(session);

  session.state = WorkflowState.AWAITING_APPROVAL;
  session.plan = { title: 'Test Plan', steps: [{ id: 1, action: 'do stuff' }] };
  orch._persist(session);

  const row = db._store.get('db-2');
  assertEqual(row.state, 'AWAITING_APPROVAL');
  const plan = JSON.parse(row.plan);
  assertEqual(plan.title, 'Test Plan');
});

test('transition() triggers auto-persist via _onUpdate', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });
  const session = new WorkflowSession('db-3', 'auto-persist');
  session._onUpdate = (s) => orch._persist(s);
  orch.sessions.set('db-3', session);
  orch._createDbRow(session);

  session.transition(WorkflowState.ANALYZING);
  assertEqual(db._store.get('db-3').state, 'ANALYZING');

  session.transition(WorkflowState.PLANNING);
  assertEqual(db._store.get('db-3').state, 'PLANNING');
});

test('getSession falls back to DB when not in RAM', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  // Manually create a DB row
  db.getOrCreate('db-4', null, 'Loaded from DB');
  db.save('db-4', 'AWAITING_APPROVAL', { title: 'DB Plan', steps: [] }, null, JSON.stringify({
    history: [],
    fixAttempts: 0,
    redesignAttempts: 0,
  }));

  // Not in RAM
  assertEqual(orch.sessions.has('db-4'), false);

  // getSession loads from DB
  const session = orch.getSession('db-4');
  assert(session != null, 'Should find session from DB');
  assertEqual(session.state, 'AWAITING_APPROVAL');
  assertEqual(session.plan.title, 'DB Plan');
  assertEqual(session.request, 'Loaded from DB');

  // Now cached in RAM
  assertEqual(orch.sessions.has('db-4'), true);
});

test('_hydrateSession restores all fields from DB row', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  const timing = {
    history: [
      { step: 'D1_ANALYZE', model: 'test', output: 'ok', verdict: null, duration: 100, error: null, timestamp: '2024-01-01T00:00:00Z' },
      { step: 'D1_PLAN', model: 'test', output: { title: 'X' }, verdict: null, duration: 200, error: null, timestamp: '2024-01-01T00:01:00Z' },
    ],
    fixAttempts: 2,
    redesignAttempts: 1,
    clarificationQuestions: ['How?', 'Why?'],
    createdAt: '2024-01-01T00:00:00Z',
  };

  const row = {
    session_id: 'hydrate-1',
    request: 'Hydrate test',
    state: 'IMPLEMENTING',
    plan: JSON.stringify({ title: 'Plan X', steps: [{ id: 1 }] }),
    implementation: JSON.stringify([{ stepId: 1, output: 'code' }]),
    timing: JSON.stringify(timing),
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:05:00Z',
  };

  const session = orch._hydrateSession(row);
  assertEqual(session.id, 'hydrate-1');
  assertEqual(session.state, 'IMPLEMENTING');
  assertEqual(session.plan.title, 'Plan X');
  assertEqual(session.history.length, 2);
  assertEqual(session.history[0].step, 'D1_ANALYZE');
  assertEqual(session.fixAttempts, 2);
  assertEqual(session.redesignAttempts, 1);
  assertEqual(session.clarificationQuestions.length, 2);
  assert(session._onUpdate != null, 'Should have _onUpdate wired');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — resume (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

await testAsync('Resume AWAITING_APPROVAL returns plan', async () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  // Create a session in AWAITING_APPROVAL
  db.getOrCreate('resume-1', null, 'Resume test');
  db.save('resume-1', 'AWAITING_APPROVAL', { title: 'My Plan', steps: [{ id: 1 }] }, null, '{}');

  const result = await orch.resume('resume-1');
  assertEqual(result.state, 'AWAITING_APPROVAL');
  assertEqual(result.plan.title, 'My Plan');
  assert(result.message.includes('awaiting plan approval'), 'Message should indicate awaiting approval');
});

await testAsync('Resume CLARIFYING returns questions', async () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  db.getOrCreate('resume-2', null, 'Clarify test');
  db.save('resume-2', 'CLARIFYING', null, null, JSON.stringify({ clarificationQuestions: ['Q1?', 'Q2?'] }));

  const result = await orch.resume('resume-2');
  assertEqual(result.state, 'CLARIFYING');
  assertEqual(result.questions.length, 2);
  assert(result.message.includes('awaiting clarification'));
});

await testAsync('Resume COMPLETED returns terminal state', async () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  db.getOrCreate('resume-3', null, 'Done test');
  db.save('resume-3', 'COMPLETED', { title: 'Done Plan' }, [{ stepId: 1, output: 'code' }], '{}');

  const result = await orch.resume('resume-3');
  assertEqual(result.state, 'COMPLETED');
  assert(result.message.includes('already completed'));
});

await testAsync('Resume mid-pipeline state returns canRetry', async () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  db.getOrCreate('resume-4', null, 'Interrupted');
  db.save('resume-4', 'IMPLEMENTING', null, null, '{}');

  const result = await orch.resume('resume-4');
  assertEqual(result.state, 'IMPLEMENTING');
  assertEqual(result.canRetry, true);
  assert(result.message.includes('cannot resume mid-pipeline'));
});

await testAsync('Resume nonexistent throws', async () => {
  const orch = new WorkflowOrchestrator({ db: createMockDb() });
  let threw = false;
  try { await orch.resume('nope'); } catch { threw = true; }
  assert(threw, 'Should throw for unknown session');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — listSessions (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

test('listSessions returns active only by default', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  db.getOrCreate('list-1', null, 'Active');
  db.save('list-1', 'AWAITING_APPROVAL', null, null, '{}');
  db.getOrCreate('list-2', null, 'Done');
  db.save('list-2', 'COMPLETED', null, null, '{}');
  db.getOrCreate('list-3', null, 'Also active');
  db.save('list-3', 'IMPLEMENTING', null, null, '{}');

  const active = orch.listSessions({ activeOnly: true });
  assertEqual(active.length, 2);
  assert(active.every(s => s.state !== 'COMPLETED'), 'Should not include COMPLETED');
});

test('listSessions with activeOnly=false returns all', () => {
  const db = createMockDb();
  const orch = new WorkflowOrchestrator({ db });

  db.getOrCreate('all-1', null, 'One');
  db.save('all-1', 'COMPLETED', null, null, '{}');
  db.getOrCreate('all-2', null, 'Two');
  db.save('all-2', 'FAILED', null, null, '{}');

  const all = orch.listSessions({ activeOnly: false });
  assertEqual(all.length, 2);
});

test('listSessions RAM fallback without DB', () => {
  const orch = new WorkflowOrchestrator(); // no DB
  const s1 = new WorkflowSession('ram-1', 'active session');
  s1.state = WorkflowState.IMPLEMENTING;
  const s2 = new WorkflowSession('ram-2', 'done session');
  s2.state = WorkflowState.COMPLETED;
  orch.sessions.set('ram-1', s1);
  orch.sessions.set('ram-2', s2);

  const active = orch.listSessions({ activeOnly: true });
  assertEqual(active.length, 1);
  assertEqual(active[0].sessionId, 'ram-1');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — getProgress (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

test('getProgress returns null for unknown session', () => {
  const orch = new WorkflowOrchestrator({ db: createMockDb() });
  assertEqual(orch.getProgress('nope'), null);
});

test('getProgress computes percentage for AWAITING_APPROVAL', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('prog-1', 'test');
  session.state = WorkflowState.AWAITING_APPROVAL;
  session.plan = { title: 'Plan', steps: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  orch.sessions.set('prog-1', session);

  const progress = orch.getProgress('prog-1');
  assertEqual(progress.percentage, 20);
  assertEqual(progress.currentStage, 'approval');
  assertEqual(progress.totalSteps, 3);
  assertEqual(progress.implementedSteps, 0);
});

test('getProgress computes percentage for IMPLEMENTING with partial steps', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('prog-2', 'test');
  session.state = WorkflowState.IMPLEMENTING;
  session.plan = { title: 'Plan', steps: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
  session.history = [
    { step: 'D1_ANALYZE', model: 'm', output: 'ok', duration: 100, timestamp: '2024-01-01' },
    { step: 'D1_PLAN', model: 'm', output: 'ok', duration: 100, timestamp: '2024-01-01' },
    { step: 'CODE_IMPLEMENT_1', model: 'm', output: 'code', duration: 100, timestamp: '2024-01-01' },
    { step: 'CODE_IMPLEMENT_2', model: 'm', output: 'code', duration: 100, timestamp: '2024-01-01' },
  ];
  orch.sessions.set('prog-2', session);

  const progress = orch.getProgress('prog-2');
  assertEqual(progress.implementedSteps, 2);
  assertEqual(progress.totalSteps, 4);
  assertEqual(progress.currentStage, 'CODE');
  // 30 + (2/4)*30 = 30 + 15 = 45
  assertEqual(progress.percentage, 45);
});

test('getProgress COMPLETED = 100%', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('prog-3', 'test');
  session.state = WorkflowState.COMPLETED;
  orch.sessions.set('prog-3', session);

  assertEqual(orch.getProgress('prog-3').percentage, 100);
});

test('getProgress includes stepsCompleted summary', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('prog-4', 'test');
  session.state = WorkflowState.QUICK_REVIEWING;
  session.history = [
    { step: 'D1_ANALYZE', model: 'm', duration: 100, verdict: null, timestamp: '2024-01-01' },
    { step: 'CODE_IMPLEMENT_1', model: 'm', duration: 200, verdict: null, timestamp: '2024-01-02' },
  ];
  orch.sessions.set('prog-4', session);

  const progress = orch.getProgress('prog-4');
  assertEqual(progress.stepsCompleted.length, 2);
  assertEqual(progress.stepsCompleted[0].step, 'D1_ANALYZE');
  assertEqual(progress.stepsCompleted[1].duration, 200);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — blocker aggregation (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

test('Blockers aggregated from R2 FAIL reviews', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('block-1', 'test');
  session.state = WorkflowState.QUICK_REVIEWING;
  session.history = [
    {
      step: 'R2_QUICK_REVIEW',
      model: 'm',
      output: {
        verdict: 'FAIL',
        issues: [
          { severity: 'critical', description: 'SQL injection risk', location: 'db.js:42' },
          { severity: 'warning', description: 'Missing error handling' },
        ],
      },
      verdict: 'FAIL',
      duration: 100,
      timestamp: '2024-01-01',
    },
  ];
  orch.sessions.set('block-1', session);

  const progress = orch.getProgress('block-1');
  assertEqual(progress.blockers.length, 2);
  assertEqual(progress.blockers[0].source, 'R2_QUICK_REVIEW');
  assertEqual(progress.blockers[0].severity, 'critical');
  assertEqual(progress.blockers[0].description, 'SQL injection risk');
  assertEqual(progress.blockers[1].severity, 'warning');
});

test('Blockers aggregated from R1 FAIL reviews', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('block-2', 'test');
  session.state = WorkflowState.FIX_DELIBERATING;
  session.fixAttempts = 1;
  session.history = [
    {
      step: 'R2_QUICK_REVIEW',
      model: 'm',
      output: { verdict: 'PASS', notes: 'ok' },
      verdict: 'PASS',
      duration: 50,
      timestamp: '2024-01-01',
    },
    {
      step: 'R1_FINAL_REVIEW',
      model: 'm',
      output: {
        verdict: 'FAIL',
        issues: [{ severity: 'critical', description: 'Missing input validation', location: 'api.js' }],
      },
      verdict: 'FAIL',
      duration: 200,
      timestamp: '2024-01-02',
    },
  ];
  orch.sessions.set('block-2', session);

  const progress = orch.getProgress('block-2');
  assertEqual(progress.blockers.length, 1);
  assertEqual(progress.blockers[0].source, 'R1_FINAL_REVIEW');
  assertEqual(progress.blockers[0].description, 'Missing input validation');
});

test('No blockers when reviews PASS', () => {
  const orch = new WorkflowOrchestrator();
  const session = new WorkflowSession('block-3', 'test');
  session.state = WorkflowState.COMPLETED;
  session.history = [
    { step: 'R2_QUICK_REVIEW', model: 'm', output: { verdict: 'PASS' }, verdict: 'PASS', duration: 50, timestamp: '2024-01-01' },
    { step: 'R1_FINAL_REVIEW', model: 'm', output: { verdict: 'PASS' }, verdict: 'PASS', duration: 100, timestamp: '2024-01-02' },
  ];
  orch.sessions.set('block-3', session);

  const progress = orch.getProgress('block-3');
  assertEqual(progress.blockers.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('WorkflowOrchestrator — new methods exist (Phase C)');
// ═══════════════════════════════════════════════════════════════════════════════

test('Has resume method', () => {
  const orch = new WorkflowOrchestrator();
  assert(typeof orch.resume === 'function');
});

test('Has listSessions method', () => {
  const orch = new WorkflowOrchestrator();
  assert(typeof orch.listSessions === 'function');
});

test('Has getProgress method', () => {
  const orch = new WorkflowOrchestrator();
  assert(typeof orch.getProgress === 'function');
});

test('Has _persist method', () => {
  const orch = new WorkflowOrchestrator();
  assert(typeof orch._persist === 'function');
});

test('Has _hydrateSession method', () => {
  const orch = new WorkflowOrchestrator();
  assert(typeof orch._hydrateSession === 'function');
});

test('Has _currentStage method', () => {
  const orch = new WorkflowOrchestrator();
  assertEqual(orch._currentStage('IMPLEMENTING'), 'CODE');
  assertEqual(orch._currentStage('FINAL_REVIEWING'), 'R1');
  assertEqual(orch._currentStage('COMPLETED'), 'done');
  assertEqual(orch._currentStage('UNKNOWN'), 'unknown');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Workflow callLLM — gateway completion evidence');
// The real wrapper and callWithAuth run; only the gateway effect is inert.
// No inference, persistence, retry policy or model authority is exercised here.

await testAsync('preserves actual stop/length evidence and request authority', async () => {
  const originalCall = llmGateway.call;
  const requests = [];
  let reason;
  try {
    llmGateway.call = async (prompt, options) => {
      requests.push({ prompt, options });
      return { content: '{"title":"Synthetic spec"}', finishReason: reason, promptEvalCount: 3061, evalCount: 1035 };
    };
    for (const finishReason of ['stop', 'length']) {
      reason = finishReason;
      const result = await callLLM('D1', 'Synthetic specification request', 'Synthetic system');
      assertEqual(result.finishReason, finishReason);
      assertEqual(result.content, '{"title":"Synthetic spec"}');
      assertEqual(result.promptEvalCount, 3061);
      assertEqual(result.evalCount, 1035);
    }
    assertEqual(requests.length, 2, 'one gateway call per wrapper invocation');
    for (const { prompt, options } of requests) {
      assertEqual(prompt, 'Synthetic specification request');
      assertEqual(options.systemPrompt, 'Synthetic system');
      assertEqual(options._authToken.role, LLMCallerRole.WORKFLOW_PLANNER);
      assertEqual(options._authToken.maxTokens, 4000);
    }
  } finally { llmGateway.call = originalCall; }
});

await testAsync('does not invent a stop reason for legacy or absent evidence', async () => {
  const originalCall = llmGateway.call;
  try {
    for (const response of ['legacy content', { content: 'missing reason' }, { content: 'explicit null', finishReason: null }]) {
      llmGateway.call = async () => response;
      const result = await callLLM('D1', 'Synthetic compatibility request');
      assertEqual(result.finishReason, null);
      assertEqual(result.content, typeof response === 'string' ? response : response.content);
    }
    llmGateway.call = async () => ({ content: 'Provider-specific terminal', finishReason: 'provider-specific' });
    assertEqual((await callLLM('D1', 'Synthetic evidence request')).finishReason, 'provider-specific');
  } finally { llmGateway.call = originalCall; }
});

await testAsync('propagates the same gateway failure without a new retry', async () => {
  const originalCall = llmGateway.call;
  const expected = new Error('SYNTHETIC gateway failure');
  let calls = 0;
  let caught;
  try {
    llmGateway.call = async () => { calls++; throw expected; };
    try { await callLLM('D1', 'Synthetic failed request'); } catch (error) { caught = error; }
    assertEqual(caught, expected);
    assertEqual(calls, 1);
  } finally { llmGateway.call = originalCall; }
});

await testAsync('complete SPEC alone receives operation-bound 6000 with one attempt', async () => {
  const originalCall = llmGateway.call;
  const originalProfiles = llmGateway._vramFitProfiles;
  const model = config.models?.D1 || config.models?.CHAT;
  const calls = [];
  try {
    llmGateway._vramFitProfiles = Object.freeze({
      ...originalProfiles,
      [model.toLowerCase()]: Object.freeze({
        modelWeightsMb: 100,
        kvMbPer1k: 1,
        observeVram: async () => ({ totalMb: 32768, freeMb: 32768, source: 'spec-budget-fixture' }),
      }),
    });
    llmGateway.call = async (prompt, options) => {
      calls.push({ prompt, options });
      return { content: '{"title":"Synthetic spec"}', finishReason: 'stop', promptEvalCount: 100, evalCount: options.maxTokens };
    };
    const full = await callSpecDocumentLLM('D1', 'Complete specification', '', { format: 'json' });
    const lower = await callSpecDocumentLLM('D1', 'Short specification', '', { format: 'json', maxTokens: 2000 });
    assertEqual(full.evalCount, 6000);
    assertEqual(lower.evalCount, 2000);
    assertEqual(calls.length, 2, 'one provider call per complete SPEC invocation');
    for (const [index, { options }] of calls.entries()) {
      assertEqual(options.format, 'json');
      assertEqual(options.retries, 1);
      assertEqual(options.correlation.modelRole, 'D1');
      assertEqual(options.correlation.purpose, 'answer');
      assertEqual(authTokenOperation(options._authToken), LLMOperation.WORKFLOW_SPEC_DOCUMENT_JSON_V1);
      assertEqual(options._authToken.maxTokens, 6000);
      assertEqual(options.maxTokens, index === 0 ? 6000 : 2000);
    }

    for (const invalidOptions of [
      { format: 'json', maxTokens: 6001 },
      { format: 'json', maxTokens: 0 },
      { format: 'json', maxTokens: -1 },
      { format: 'json', maxTokens: 1.5 },
      { format: 'json', maxTokens: Number.NaN },
      { format: 'json', maxTokens: Number.POSITIVE_INFINITY },
      { format: 'text' },
      { format: 'json', model: 'attacker-model' },
    ]) {
      let rejected = false;
      try { await callSpecDocumentLLM('D1', 'Rejected specification', '', invalidOptions); } catch { rejected = true; }
      assert(rejected, `invalid complete SPEC options must reject: ${JSON.stringify(invalidOptions)}`);
    }
    assertEqual(calls.length, 2, 'invalid options produce zero provider calls');

    const ordinary = createAuthToken({
      role: LLMCallerRole.WORKFLOW_PLANNER,
      decisionId: 'ordinary-planner-over-limit',
      auditContext: { sessionId: 'ordinary-planner-session', stepId: 'ordinary-planner-turn' },
      maxTokens: 6000,
    });
    let ordinaryError;
    try {
      await callWithPolicy(ordinary, 'Rejected ordinary planner', {
        model,
        maxTokens: 6000,
        capability: 'reasoning',
        correlation: {
          requestId: ordinary.decisionId,
          conversationId: ordinary.auditContext.sessionId,
          turnId: ordinary.auditContext.stepId,
          callerRole: ordinary.role,
          modelRole: 'D1',
          purpose: 'answer',
        },
      });
    } catch (error) { ordinaryError = error; }
    assertEqual(ordinaryError?.code, 'LLM_AUTHORIZATION_DENIED');
    assertEqual(calls.length, 2, 'ordinary planner token at 6000 cannot reach provider');

    const capturedSpecToken = calls[0].options._authToken;
    let reboundError;
    try {
      await callWithPolicy(capturedSpecToken, 'Rebound specification', {
        model,
        systemPrompt: '',
        format: 'json',
        maxTokens: 6000,
        capability: 'reasoning',
        correlation: {
          ...calls[0].options.correlation,
          turnId: 'different-turn',
        },
      });
    } catch (error) { reboundError = error; }
    assertEqual(reboundError?.code, 'LLM_AUTHORIZATION_DENIED');
    assertEqual(calls.length, 2, 'operation token cannot be rebound to another turn');

    for (const mutate of [
      options => ({ ...options, model: 'different-model:1b' }),
      options => ({ ...options, systemPrompt: 'different system prompt' }),
      options => ({ ...options, format: undefined }),
      options => ({ ...options, capability: 'json_output' }),
      options => ({ ...options, correlation: { ...options.correlation, requestId: 'different-request' } }),
      options => ({ ...options, correlation: { ...options.correlation, conversationId: 'different-conversation' } }),
      options => ({ ...options, correlation: { ...options.correlation, modelRole: 'R1' } }),
      options => ({ ...options, correlation: { ...options.correlation, purpose: 'refine' } }),
    ]) {
      let mismatch;
      try {
        await callWithPolicy(capturedSpecToken, 'Mismatched specification', mutate({
          model,
          systemPrompt: '',
          format: 'json',
          maxTokens: 6000,
          capability: 'reasoning',
          correlation: { ...calls[0].options.correlation },
        }));
      } catch (error) { mismatch = error; }
      assertEqual(mismatch?.code, 'LLM_AUTHORIZATION_DENIED');
    }
    assertEqual(calls.length, 2, 'every operation identity mismatch produces zero provider calls');
  } finally {
    llmGateway.call = originalCall;
    llmGateway._vramFitProfiles = originalProfiles;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
