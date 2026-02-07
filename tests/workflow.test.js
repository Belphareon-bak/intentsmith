// tests/workflow.test.js — Workflow orchestrator unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  WorkflowOrchestrator,
  WorkflowSession,
  WorkflowState,
  ReviewVerdict,
} from '../src/planner/workflow.js';

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
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
