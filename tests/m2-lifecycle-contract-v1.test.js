#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { suite, test, summary } from './harness.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
  M2_EXECUTION_CONTRACT_VERSION,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeAuthoritySetDigest,
  computeM2ProjectChangePatchSetDigest,
  computeM2ProjectChangeRequestDigest,
} from '../contracts/m2/execution-v1.js';
import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_NORMALIZATION_VERSION,
  computeProjectContextSnapshotDigest,
  normalizeProjectContextQuery,
} from '../contracts/m2/project-context-v1.js';
import {
  M2_GOVERNANCE_CHECK_STATUS,
  M2_GOVERNANCE_CONTRACT_KIND,
  M2_GOVERNANCE_CONTRACT_VERSION,
  M2_GOVERNANCE_DECISION_CHECKS,
  M2_GOVERNANCE_VERDICT,
  computeM2GovernanceDecisionDigest,
  computeM2GovernanceReceiptDigest,
  computeM2GovernanceValueDigest,
  createM2GovernanceDecision,
} from '../contracts/m2/governance-v1.js';
import {
  M2_LIFECYCLE_CONTRACT_KIND,
  M2_LIFECYCLE_CONTRACT_STAGE,
  M2_LIFECYCLE_CONTRACT_VERSION,
  M2_LIFECYCLE_STATE,
  canonicalizeM2LifecycleValue,
  computeM2LifecycleApprovalIntentDigest,
  computeM2LifecyclePlanSnapshotDigest,
  computeM2LifecycleTerminalSnapshotDigest,
  computeM2LifecycleValueDigest,
  decodeM2LifecycleContract,
  encodeM2LifecycleContract,
  normalizeM2LifecycleValue,
  validateM2LifecycleApprovalIntent,
  validateM2LifecycleApprovalIntentForPlan,
  validateM2LifecycleContract,
  validateM2LifecyclePlanSnapshot,
  validateM2LifecyclePlanSnapshotForContext,
  validateM2LifecyclePlanSnapshotForDecision,
  validateM2LifecyclePlanSnapshotForRequest,
  validateM2LifecycleTerminalSnapshot,
  validateM2LifecycleTerminalSnapshotForExecution,
} from '../contracts/m2/lifecycle-v1.js';

const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const AFTER_REVISION = `wsr1:${'2'.repeat(64)}`;
const BEFORE_HEAD = '3'.repeat(40);
const EMPTY_DIGEST = sha(Buffer.alloc(0));
const POLICY_DIGEST = sha(Buffer.from('policy'));
const BASELINE_DIGEST = sha(Buffer.from('governance-baseline'));

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function clone(value) {
  return structuredClone(value);
}

function authority(effectId, requestDigest = EMPTY_DIGEST) {
  return { effectId, requestDigest };
}

function request(overrides = {}) {
  const before = Buffer.from('export const value = 1;\n');
  const after = Buffer.from('export const value = 2;\n');
  const changes = [{
    path: 'src/app.js',
    before: { exists: true, digest: sha(before), bytes: before.length, mode: 0o644 },
    after: { digest: sha(after), bytes: after.length, mode: 0o644 },
    forwardAuthority: authority('effect-forward'),
    rollbackAuthority: authority('effect-rollback'),
  }];
  const value = {
    contract: M2_EXECUTION_CONTRACT_KIND.REQUEST,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: 'execution-lifecycle-1',
    runId: 'run-lifecycle-1',
    actor: { type: 'user', id: 'operator-1' },
    origin: {
      surface: 'lifecycle',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    project: {
      projectId: 17,
      canonicalRoot: '/workspace/project',
      workspaceRevision: BEFORE_REVISION,
      gitHead: BEFORE_HEAD,
      gitBranchRef: 'refs/heads/codex/m2-lifecycle',
      foreignDirtDigest: EMPTY_DIGEST,
    },
    patchSetDigest: EMPTY_DIGEST,
    changes,
    focusedTest: {
      authority: authority('effect-focused-test'),
      binary: '/usr/bin/node',
      argv: ['--test', 'tests/focused.test.js'],
      argvDigest: EMPTY_DIGEST,
      canonicalCwd: '/workspace/project',
      environmentDigest: sha(Buffer.from('environment')),
      timeoutMs: 120_000,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v2',
    },
    gitCommit: null,
    authoritySetDigest: EMPTY_DIGEST,
    createdAt: '2026-08-24T12:00:00.000Z',
    ...overrides,
  };
  value.patchSetDigest = computeM2ProjectChangePatchSetDigest(value.changes);
  value.focusedTest.argvDigest = computeM2ExecutionValueDigest(value.focusedTest.argv);
  value.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(value);
  return value;
}

function result(boundRequest = request(), overrides = {}) {
  return {
    contract: M2_EXECUTION_CONTRACT_KIND.RESULT,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: boundRequest.executionId,
    requestDigest: computeM2ProjectChangeRequestDigest(boundRequest),
    runId: boundRequest.runId,
    projectId: boundRequest.project.projectId,
    terminalStatus: 'succeeded',
    fencingGeneration: 1,
    startedAt: '2026-08-24T12:02:00.000Z',
    completedAt: '2026-08-24T12:03:00.000Z',
    changes: {
      paths: boundRequest.changes.map(change => change.path),
      beforeRevision: boundRequest.project.workspaceRevision,
      afterRevision: AFTER_REVISION,
      diffDigest: sha(Buffer.from('diff')),
    },
    focusedTest: {
      effectId: boundRequest.focusedTest.authority.effectId,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: EMPTY_DIGEST,
      stderrDigest: EMPTY_DIGEST,
      outputTruncated: false,
    },
    git: {
      status: 'not_requested',
      beforeHead: boundRequest.project.gitHead,
      afterHead: boundRequest.project.gitHead,
      commitId: null,
      foreignDirtPreserved: true,
    },
    rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function contextSnapshot(boundRequest = request()) {
  const normalized = normalizeProjectContextQuery('Update exact project file');
  const value = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: 'request-context-lifecycle-1',
    projectId: boundRequest.project.projectId,
    status: 'ok',
    outcome: 'empty',
    workspaceRevision: boundRequest.project.workspaceRevision,
    normalizationVersion: PROJECT_CONTEXT_NORMALIZATION_VERSION,
    normalizedQuery: normalized.normalizedQuery,
    terms: [...normalized.terms],
    items: [],
    budget: {
      maxFiles: 8,
      maxBytes: 65_536,
      maxTokens: 16_384,
      usedFiles: 0,
      usedBytes: 0,
      usedTokens: 0,
    },
    truncation: { truncated: false },
  };
  value.snapshotDigest = computeProjectContextSnapshotDigest(value);
  return value;
}

function plan(boundRequest = request(), overrides = {}) {
  const boundContext = contextSnapshot(boundRequest);
  const governanceDecision = allowDecision(boundRequest);
  return {
    contract: M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: {
      lifecycleId: 'lifecycle-1',
      milestoneId: 'milestone-1',
      runId: boundRequest.runId,
      executionId: boundRequest.executionId,
    },
    state: M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
    planVersion: 1,
    actor: clone(boundRequest.actor),
    origin: clone(boundRequest.origin),
    project: clone(boundRequest.project),
    intent: 'Update the exact project file and run its focused test.',
    requestDigest: computeM2ProjectChangeRequestDigest(boundRequest),
    patchSetDigest: boundRequest.patchSetDigest,
    authoritySetDigest: boundRequest.authoritySetDigest,
    changes: boundRequest.changes.map(change => ({
      path: change.path,
      afterDigest: change.after.digest,
      afterBytes: change.after.bytes,
    })),
    focusedTest: {
      binary: boundRequest.focusedTest.binary,
      argv: [...boundRequest.focusedTest.argv],
      argvDigest: boundRequest.focusedTest.argvDigest,
      environmentDigest: boundRequest.focusedTest.environmentDigest,
      timeoutMs: boundRequest.focusedTest.timeoutMs,
    },
    gitCommit: null,
    governancePolicyDigest: POLICY_DIGEST,
    governanceBaselineDigest: BASELINE_DIGEST,
    contextSnapshotDigest: computeM2LifecycleValueDigest(boundContext),
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(governanceDecision),
    expectedAfterRevision: AFTER_REVISION,
    createdAt: '2026-08-24T12:00:01.000Z',
    approvalExpiresAt: '2026-08-24T12:10:00.000Z',
    ...overrides,
  };
}

function approval(boundPlan = plan(), overrides = {}) {
  return {
    contract: M2_LIFECYCLE_CONTRACT_KIND.APPROVAL_INTENT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    approvalId: 'approval-lifecycle-1',
    identity: clone(boundPlan.identity),
    state: M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
    decision: 'approve',
    planVersion: boundPlan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(boundPlan),
    requestDigest: boundPlan.requestDigest,
    authoritySetDigest: boundPlan.authoritySetDigest,
    projectId: boundPlan.project.projectId,
    workspaceRevision: boundPlan.project.workspaceRevision,
    actor: clone(boundPlan.actor),
    approvedAt: '2026-08-24T12:01:00.000Z',
    expiresAt: '2026-08-24T12:05:00.000Z',
    ...overrides,
  };
}

function allowDecision(boundRequest = request(), overrides = {}) {
  return createM2GovernanceDecision({
    lifecycleId: 'lifecycle-1',
    milestoneId: 'milestone-1',
    executionId: boundRequest.executionId,
    runId: boundRequest.runId,
    projectId: boundRequest.project.projectId,
    requestDigest: computeM2ProjectChangeRequestDigest(boundRequest),
    policyDigest: POLICY_DIGEST,
    baselineDigest: BASELINE_DIGEST,
    expectedAfterRevision: AFTER_REVISION,
    verdict: M2_GOVERNANCE_VERDICT.ALLOW,
    checks: M2_GOVERNANCE_DECISION_CHECKS.map(checkId => ({
      checkId,
      required: true,
      status: M2_GOVERNANCE_CHECK_STATUS.PASS,
      findingIds: [],
    })),
    findings: [],
    blockingFindingIds: [],
    ...overrides,
  });
}

function receipt(boundResult, decision, overrides = {}) {
  const projection = {
    contract: M2_GOVERNANCE_CONTRACT_KIND.RECEIPT,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    decisionDigest: computeM2GovernanceDecisionDigest(decision),
    lifecycleId: decision.lifecycleId,
    milestoneId: decision.milestoneId,
    executionId: decision.executionId,
    runId: decision.runId,
    projectId: decision.projectId,
    requestDigest: decision.requestDigest,
    policyDigest: decision.policyDigest,
    baselineDigest: decision.baselineDigest,
    expectedAfterRevision: decision.expectedAfterRevision,
    resultDigest: computeM2ExecutionValueDigest(boundResult),
    actualAfterRevision: boundResult.changes.afterRevision,
    fencingGeneration: boundResult.fencingGeneration,
    status: 'accepted',
    recordedAt: '2026-08-24T12:04:00.000Z',
    evidenceRefs: [
      ...boundResult.evidenceRefs,
      `governance-decision:${decision.decisionId}`,
      `project-change-result:${boundResult.executionId}`,
    ].sort(),
    ...overrides,
  };
  return {
    receiptId: `govreceipt1:${computeM2GovernanceValueDigest(projection).slice(7)}`,
    ...projection,
  };
}

function terminal(boundPlan, boundApproval, boundResult, decision, boundReceipt, overrides = {}) {
  return {
    contract: M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: clone(boundPlan.identity),
    state: M2_LIFECYCLE_STATE.SUCCEEDED,
    planVersion: boundPlan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(boundPlan),
    approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(boundApproval),
    requestDigest: boundPlan.requestDigest,
    authoritySetDigest: boundPlan.authoritySetDigest,
    projectId: boundPlan.project.projectId,
    workspaceRevision: boundResult.changes.afterRevision,
    resultDigest: computeM2ExecutionValueDigest(boundResult),
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(decision),
    governanceReceiptDigest: computeM2GovernanceReceiptDigest(boundReceipt),
    errorCode: null,
    completedAt: '2026-08-24T12:05:00.000Z',
    evidenceRefs: ['artifact:diff', 'artifact:focused-test', 'governance:receipt'],
    ...overrides,
  };
}

function evidence() {
  const boundRequest = request();
  const boundContextSnapshot = contextSnapshot(boundRequest);
  const boundPlan = plan(boundRequest);
  const boundApproval = approval(boundPlan);
  const boundResult = result(boundRequest);
  const governanceDecision = allowDecision(boundRequest);
  const governanceReceipt = receipt(boundResult, governanceDecision);
  const terminalSnapshot = terminal(
    boundPlan,
    boundApproval,
    boundResult,
    governanceDecision,
    governanceReceipt,
  );
  return {
    contextSnapshot: boundContextSnapshot,
    request: boundRequest,
    plan: boundPlan,
    approval: boundApproval,
    result: boundResult,
    governanceDecision,
    governanceReceipt,
    terminal: terminalSnapshot,
  };
}

suite('M2 lifecycle v1 — exact public contracts');

test('stage is PINNED_V1 and complete state vocabulary remains fixed', () => {
  assert.equal(M2_LIFECYCLE_CONTRACT_STAGE, 'PINNED_V1');
  assert.deepEqual(M2_LIFECYCLE_STATE, {
    PLANNING: 'planning',
    AWAITING_APPROVAL: 'awaiting_approval',
    EXECUTING: 'executing',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    TIMED_OUT: 'timed_out',
    ORPHANED: 'orphaned',
    BLOCKED: 'blocked',
  });
});

test('plan snapshot binds exact ProjectChange request and visible summaries', () => {
  const boundRequest = request();
  const boundContext = contextSnapshot(boundRequest);
  const governanceDecision = allowDecision(boundRequest);
  const value = plan(boundRequest);
  assert.equal(validateM2LifecyclePlanSnapshot(value).valid, true);
  assert.equal(validateM2LifecycleContract(value).valid, true);
  const semantic = validateM2LifecyclePlanSnapshotForRequest(boundRequest, value);
  assert.equal(semantic.valid, true, semantic.errors.join(', '));
  assert.equal(
    validateM2LifecyclePlanSnapshotForContext(boundContext, value).valid,
    true,
  );
  assert.equal(
    validateM2LifecyclePlanSnapshotForDecision(boundRequest, governanceDecision, value).valid,
    true,
  );
  assert.match(computeM2LifecyclePlanSnapshotDigest(value), /^sha256:[0-9a-f]{64}$/);
});

test('approval is an exact actor, plan, request, authority and revision intent', () => {
  const boundPlan = plan();
  const value = approval(boundPlan);
  assert.equal(validateM2LifecycleApprovalIntent(value).valid, true);
  const semantic = validateM2LifecycleApprovalIntentForPlan(boundPlan, value);
  assert.equal(semantic.valid, true, semantic.errors.join(', '));
  assert.match(computeM2LifecycleApprovalIntentDigest(value), /^sha256:[0-9a-f]{64}$/);
});

test('terminal succeeded requires exact ProjectChange success and accepted governance receipt', () => {
  const fixture = evidence();
  assert.equal(validateM2LifecycleTerminalSnapshot(fixture.terminal).valid, true);
  const semantic = validateM2LifecycleTerminalSnapshotForExecution(fixture);
  assert.equal(semantic.valid, true, semantic.errors.join(', '));
  assert.match(computeM2LifecycleTerminalSnapshotDigest(fixture.terminal), /^sha256:[0-9a-f]{64}$/);
});

test('non-success terminal is explicit and cannot omit errorCode', () => {
  const fixture = evidence();
  const blocked = terminal(
    fixture.plan,
    fixture.approval,
    fixture.result,
    fixture.governanceDecision,
    fixture.governanceReceipt,
    {
      state: M2_LIFECYCLE_STATE.BLOCKED,
      approvalIntentDigest: null,
      resultDigest: null,
      governanceDecisionDigest: null,
      governanceReceiptDigest: null,
      errorCode: 'PROPOSAL_INVALID',
    },
  );
  assert.equal(validateM2LifecycleTerminalSnapshot(blocked).valid, true);
  const falseSuccess = clone(blocked);
  falseSuccess.errorCode = null;
  assert.equal(validateM2LifecycleTerminalSnapshot(falseSuccess).valid, false);
});

suite('M2 lifecycle v1 — no false success or generic approval');

test('planning snapshot cannot be approved by a generic approval intent', () => {
  const planning = plan(request(), { state: M2_LIFECYCLE_STATE.PLANNING });
  const generic = approval(planning);
  const checked = validateM2LifecycleApprovalIntentForPlan(planning, generic);
  assert.equal(checked.valid, false);
  assert(checked.errors.includes('lifecycle-approval-intent:plan-not-awaiting-approval'));
});

test('stale plan version, request digest, authority digest, actor and approval window fail closed', () => {
  const boundPlan = plan();
  const mutations = [
    { planVersion: 2 },
    { requestDigest: sha(Buffer.from('other-request')) },
    { authoritySetDigest: sha(Buffer.from('other-authority')) },
    { actor: { type: 'user', id: 'other-user' } },
    { approvedAt: '2026-08-24T12:11:00.000Z', expiresAt: '2026-08-24T12:12:00.000Z' },
  ];
  for (const mutation of mutations) {
    assert.equal(validateM2LifecycleApprovalIntentForPlan(
      boundPlan,
      approval(boundPlan, mutation),
    ).valid, false);
  }
});

test('changed request, result, decision, receipt or terminal digest prevents succeeded', () => {
  const base = evidence();
  const cases = [];

  const wrongRequest = clone(base);
  wrongRequest.request.actor.id = 'other-user';
  cases.push(wrongRequest);

  const wrongResult = clone(base);
  wrongResult.result.changes.diffDigest = sha(Buffer.from('other-diff'));
  cases.push(wrongResult);

  const wrongDecision = clone(base);
  wrongDecision.governanceDecision.requestDigest = sha(Buffer.from('other-request'));
  cases.push(wrongDecision);

  const wrongReceipt = clone(base);
  wrongReceipt.governanceReceipt.resultDigest = sha(Buffer.from('other-result'));
  cases.push(wrongReceipt);

  const wrongTerminal = clone(base);
  wrongTerminal.terminal.governanceReceiptDigest = sha(Buffer.from('other-receipt'));
  cases.push(wrongTerminal);

  for (const malformed of cases) {
    assert.equal(validateM2LifecycleTerminalSnapshotForExecution(malformed).valid, false);
  }
});

test('changed ProjectContext or pre-effect governance decision prevents approval chain success', () => {
  const wrongContext = evidence();
  wrongContext.contextSnapshot.requestId = 'request-context-rebound';
  assert.equal(validateM2LifecycleTerminalSnapshotForExecution(wrongContext).valid, false);

  const wrongPlanDecision = evidence();
  wrongPlanDecision.plan.governanceDecisionDigest = sha(Buffer.from('other-decision'));
  assert.equal(validateM2LifecycleTerminalSnapshotForExecution(wrongPlanDecision).valid, false);

  const wrongExpectedRevision = evidence();
  wrongExpectedRevision.plan.expectedAfterRevision = `wsr1:${'9'.repeat(64)}`;
  assert.equal(validateM2LifecycleTerminalSnapshotForExecution(wrongExpectedRevision).valid, false);
});

test('plan rejects every validly reissued governance identity outside its exact scope', () => {
  const boundRequest = request();
  const boundPlan = plan(boundRequest);
  const mutations = [
    { lifecycleId: 'lifecycle-other' },
    { milestoneId: 'milestone-other' },
    { executionId: 'execution-other' },
    { runId: 'run-other' },
    { projectId: 18 },
    { requestDigest: sha(Buffer.from('other-request')) },
    { policyDigest: sha(Buffer.from('other-policy')) },
    { baselineDigest: sha(Buffer.from('other-baseline')) },
    { expectedAfterRevision: `wsr1:${'9'.repeat(64)}` },
  ];
  for (const mutation of mutations) {
    const rebound = allowDecision(boundRequest, mutation);
    assert.equal(
      validateM2LifecyclePlanSnapshotForDecision(boundRequest, rebound, boundPlan).valid,
      false,
      Object.keys(mutation)[0],
    );
  }
});

test('structural succeeded without approval, result or governance digests is invalid', () => {
  const fixture = evidence();
  for (const key of [
    'approvalIntentDigest', 'resultDigest', 'governanceDecisionDigest', 'governanceReceiptDigest',
  ]) {
    const malformed = clone(fixture.terminal);
    malformed[key] = null;
    assert.equal(validateM2LifecycleTerminalSnapshot(malformed).valid, false, key);
  }
});

test('unknown fields are rejected at every public lifecycle boundary', () => {
  const fixture = evidence();
  const values = [fixture.plan, fixture.approval, fixture.terminal];
  for (const value of values) {
    const malformed = { ...value, legacyPassed: true };
    assert.equal(validateM2LifecycleContract(malformed).valid, false);
  }
});

test('validators do not throw on malformed adversarial shapes', () => {
  const values = [undefined, null, [], 'yes', { contract: 'LifecyclePlanSnapshot' }];
  for (const value of values) {
    assert.doesNotThrow(() => validateM2LifecyclePlanSnapshot(value));
    assert.doesNotThrow(() => validateM2LifecycleApprovalIntent(value));
    assert.doesNotThrow(() => validateM2LifecycleTerminalSnapshot(value));
  }
});

test('canonical encoding is stable and noncanonical bytes are rejected', () => {
  const value = plan();
  assert.equal(
    canonicalizeM2LifecycleValue({ z: 'Pr\u030ci\u0301lis\u030c', a: 1 }),
    canonicalizeM2LifecycleValue({ a: 1, z: 'Příliš' }),
  );
  assert.deepEqual(normalizeM2LifecycleValue({ z: 2, a: 1 }), { a: 1, z: 2 });
  assert.match(computeM2LifecycleValueDigest(value), /^sha256:[0-9a-f]{64}$/);
  const encoded = encodeM2LifecycleContract(
    value,
    M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT,
  );
  assert.deepEqual(
    decodeM2LifecycleContract(encoded, M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT),
    value,
  );
  assert.throws(() => decodeM2LifecycleContract(Buffer.from(JSON.stringify(value, null, 2))), /noncanonical/);
});

summary();
