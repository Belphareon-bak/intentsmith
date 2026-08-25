#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { suite, test, summary } from './harness.js';
import {
  M2_GOVERNANCE_CHECK_STATUS,
  M2_GOVERNANCE_CONTRACT_KIND,
  M2_GOVERNANCE_CONTRACT_STAGE,
  M2_GOVERNANCE_CONTRACT_VERSION,
  M2_GOVERNANCE_DECISION_CHECKS,
  M2_GOVERNANCE_REQUIRED_CHECKS,
  M2_GOVERNANCE_VERDICT,
  canonicalizeM2GovernanceValue,
  computeM2GovernanceDecisionDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceReceiptDigest,
  computeM2GovernanceValueDigest,
  createM2GovernanceDecision,
  createM2GovernanceFinding,
  decodeM2GovernanceContract,
  encodeM2GovernanceContract,
  validateM2GovernanceContract,
  validateM2GovernanceDecision,
  validateM2GovernancePolicySnapshot,
  validateM2GovernanceReceipt,
  validateM2GovernanceReceiptForDecision,
} from '../contracts/m2/governance-v1.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
  M2_EXECUTION_CONTRACT_VERSION,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeAuthoritySetDigest,
  computeM2ProjectChangePatchSetDigest,
  computeM2ProjectChangeRequestDigest,
} from '../contracts/m2/execution-v1.js';

const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const AFTER_REVISION = `wsr1:${'2'.repeat(64)}`;
const BEFORE_HEAD = '3'.repeat(40);
const AFTER_HEAD = '4'.repeat(40);
const EMPTY_DIGEST = sha(Buffer.alloc(0));

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
  const before = Buffer.from('export const app = 1;\n');
  const after = Buffer.from("import { service } from '../services/service.js';\nexport const app = service;\n");
  const changes = overrides.changes ?? [{
    path: 'src/controllers/app.js',
    before: { exists: true, digest: sha(before), bytes: before.length, mode: 0o644 },
    after: { digest: sha(after), bytes: after.length, mode: 0o644 },
    forwardAuthority: authority('effect-forward'),
    rollbackAuthority: authority('effect-rollback'),
  }];
  const value = {
    contract: M2_EXECUTION_CONTRACT_KIND.REQUEST,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: 'execution-governance-1',
    runId: 'run-governance-1',
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
      gitBranchRef: 'refs/heads/codex/m2-governance',
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
      environmentDigest: EMPTY_DIGEST,
      timeoutMs: 120_000,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v2',
    },
    gitCommit: {
      authority: authority('effect-git'),
      expectedHead: BEFORE_HEAD,
      branchRef: 'refs/heads/codex/m2-governance',
      paths: changes.map(change => change.path),
      messageDigest: EMPTY_DIGEST,
      identityDigest: EMPTY_DIGEST,
    },
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
    startedAt: '2026-08-24T12:00:01.000Z',
    completedAt: '2026-08-24T12:00:02.000Z',
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
      status: 'committed',
      beforeHead: BEFORE_HEAD,
      afterHead: AFTER_HEAD,
      commitId: AFTER_HEAD,
      foreignDirtPreserved: true,
    },
    rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    contract: M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    policyId: 'policy-1',
    projectId: 17,
    workspaceRevision: BEFORE_REVISION,
    policyPath: '.c3/architecture-policy.json',
    layers: [
      { name: 'controller', roots: ['src/controllers'] },
      { name: 'service', roots: ['src/services'] },
    ],
    rules: [
      { from: 'controller', canImport: ['service'] },
      { from: 'service', canImport: [] },
    ],
    externalImports: [],
    sourceExtensions: ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'],
    requiredChecks: [...M2_GOVERNANCE_REQUIRED_CHECKS],
    unmappedFilePolicy: 'unavailable',
    ...overrides,
  };
}

function allowDecision(boundRequest = request(), boundPolicy = policy()) {
  return createM2GovernanceDecision({
    lifecycleId: 'lifecycle-1',
    milestoneId: 'milestone-1',
    executionId: boundRequest.executionId,
    runId: boundRequest.runId,
    projectId: boundRequest.project.projectId,
    requestDigest: computeM2ProjectChangeRequestDigest(boundRequest),
    policyDigest: computeM2GovernancePolicySnapshotDigest(boundPolicy),
    baselineDigest: computeM2GovernanceValueDigest({ baseline: 1 }),
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
  });
}

function receipt(boundRequest, boundResult, decision, overrides = {}) {
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
    recordedAt: '2026-08-24T12:00:03.000Z',
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

suite('M2 governance v1 — policy snapshot');

test('stage is PINNED_V1 and required checks are fixed and sorted', () => {
  assert.equal(M2_GOVERNANCE_CONTRACT_STAGE, 'PINNED_V1');
  assert.deepEqual(M2_GOVERNANCE_REQUIRED_CHECKS, [
    'imports.allowed', 'inventory.complete', 'layers.mapped',
  ]);
  assert.deepEqual([...M2_GOVERNANCE_REQUIRED_CHECKS].sort(), M2_GOVERNANCE_REQUIRED_CHECKS);
});

test('policy snapshot is exact, canonical and digest-bound', () => {
  const value = policy();
  assert.equal(validateM2GovernancePolicySnapshot(value).valid, true);
  assert.equal(validateM2GovernanceContract(value).valid, true);
  assert.match(computeM2GovernancePolicySnapshotDigest(value), /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    canonicalizeM2GovernanceValue({ z: 'Pr\u030ci\u0301lis\u030c', a: 1 }),
    canonicalizeM2GovernanceValue({ a: 1, z: 'Příliš' }),
  );
});

test('policy cannot omit checks or source kinds, allow unmapped files, reorder fields or add fields', () => {
  const cases = [
    policy({ requiredChecks: ['imports.allowed', 'layers.mapped'] }),
    policy({ sourceExtensions: [] }),
    policy({ sourceExtensions: ['.js', '.JS'] }),
    policy({ sourceExtensions: ['.ts', '.js'] }),
    policy({ sourceExtensions: ['js'] }),
    policy({ sourceExtensions: ['.d.ts'] }),
    policy({ unmappedFilePolicy: 'allow' }),
    policy({ externalImports: ['react', 'node:fs'] }),
    policy({ rules: [...policy().rules].reverse() }),
    { ...policy(), threshold: 0.7 },
  ];
  for (const malformed of cases) {
    assert.equal(validateM2GovernancePolicySnapshot(malformed).valid, false);
  }
});

test('policy requires one explicit allowlist rule for every declared layer', () => {
  const missing = policy({ rules: [policy().rules[0]] });
  const foreign = policy({
    rules: [
      { from: 'controller', canImport: ['repository'] },
      { from: 'service', canImport: [] },
    ],
  });
  assert.equal(validateM2GovernancePolicySnapshot(missing).valid, false);
  assert.equal(validateM2GovernancePolicySnapshot(foreign).valid, false);
});

test('nested malformed contract values are rejected without validator exceptions', () => {
  const malformedPolicies = [
    policy({ layers: [{ name: null, roots: null }], rules: [] }),
    policy({ rules: [{ from: 'controller', canImport: {} }, policy().rules[1]] }),
  ];
  const malformedDecision = clone(allowDecision());
  malformedDecision.blockingFindingIds = {};
  const malformedReceipt = receipt(request(), result(request()), allowDecision());
  malformedReceipt.evidenceRefs = {};
  for (const [validator, malformed] of [
    ...malformedPolicies.map(value => [validateM2GovernancePolicySnapshot, value]),
    [validateM2GovernanceDecision, malformedDecision],
    [validateM2GovernanceReceipt, malformedReceipt],
  ]) {
    assert.doesNotThrow(() => validator(malformed));
    assert.equal(validator(malformed).valid, false);
  }
});

suite('M2 governance v1 — decision');

test('allow decision has exact sorted all-pass checks and stable digest', () => {
  const value = allowDecision();
  assert.equal(validateM2GovernanceDecision(value).valid, true);
  assert.equal(validateM2GovernanceContract(value).valid, true);
  assert.deepEqual(value.checks.map(check => check.checkId), M2_GOVERNANCE_DECISION_CHECKS);
  assert.match(value.decisionId, /^govdec1:[0-9a-f]{64}$/);
  assert.match(computeM2GovernanceDecisionDigest(value), /^sha256:[0-9a-f]{64}$/);
});

test('false allow, reordered checks and mutated decision identity are rejected', () => {
  const original = allowDecision();
  const falseAllow = clone(original);
  falseAllow.checks[0].status = 'unavailable';
  const reordered = clone(original);
  reordered.checks.reverse();
  const rebound = clone(original);
  rebound.requestDigest = sha(Buffer.from('other'));
  for (const malformed of [falseAllow, reordered, rebound]) {
    assert.equal(validateM2GovernanceDecision(malformed).valid, false);
  }
});

test('unavailable decision requires stable exact finding and blocking set', () => {
  const boundRequest = request();
  const boundPolicy = policy();
  const finding = createM2GovernanceFinding({
    checkId: 'inventory.complete',
    code: 'INVENTORY_TRUNCATED',
    evidence: { observedFiles: 200 },
  });
  const value = createM2GovernanceDecision({
    lifecycleId: 'lifecycle-1',
    milestoneId: 'milestone-1',
    executionId: boundRequest.executionId,
    runId: boundRequest.runId,
    projectId: boundRequest.project.projectId,
    requestDigest: computeM2ProjectChangeRequestDigest(boundRequest),
    policyDigest: computeM2GovernancePolicySnapshotDigest(boundPolicy),
    baselineDigest: computeM2GovernanceValueDigest({ baseline: 1 }),
    expectedAfterRevision: AFTER_REVISION,
    verdict: 'unavailable',
    checks: M2_GOVERNANCE_DECISION_CHECKS.map(checkId => ({
      checkId,
      required: true,
      status: checkId === 'inventory.complete' ? 'unavailable' : 'pass',
      findingIds: checkId === 'inventory.complete' ? [finding.findingId] : [],
    })),
    findings: [finding],
    blockingFindingIds: [finding.findingId],
  });
  assert.equal(validateM2GovernanceDecision(value).valid, true);
  const forged = clone(value);
  forged.findings[0].code = 'OTHER_CODE';
  assert.equal(validateM2GovernanceDecision(forged).valid, false);

  const omittedBlocker = createM2GovernanceFinding({
    checkId: 'inventory.complete',
    code: 'SECOND_INVENTORY_FAILURE',
    evidence: { observedFiles: 201 },
  });
  const incompleteBlockingSet = clone(value);
  incompleteBlockingSet.findings = [finding, omittedBlocker]
    .sort((left, right) => Buffer.compare(Buffer.from(left.findingId), Buffer.from(right.findingId)));
  incompleteBlockingSet.checks = incompleteBlockingSet.checks.map(check => (
    check.checkId === 'inventory.complete'
      ? { ...check, findingIds: incompleteBlockingSet.findings.map(item => item.findingId) }
      : check
  ));
  incompleteBlockingSet.decisionId = `govdec1:${computeM2GovernanceValueDigest((() => {
    const projection = clone(incompleteBlockingSet);
    delete projection.decisionId;
    return projection;
  })()).slice(7)}`;
  assert.equal(validateM2GovernanceDecision(incompleteBlockingSet).valid, false);
  assert(validateM2GovernanceDecision(incompleteBlockingSet).errors.some(error => (
    error.includes('blocking-finding-set-mismatch')
  )));
});

suite('M2 governance v1 — succeeded-result receipt');

test('accepted receipt binds exact allow decision and exact succeeded result', () => {
  const boundRequest = request();
  const boundResult = result(boundRequest);
  const decision = allowDecision(boundRequest);
  const value = receipt(boundRequest, boundResult, decision);
  assert.equal(validateM2GovernanceReceipt(value).valid, true);
  assert.equal(
    validateM2GovernanceReceiptForDecision(boundRequest, boundResult, decision, value).valid,
    true,
  );
  assert.match(computeM2GovernanceReceiptDigest(value), /^sha256:[0-9a-f]{64}$/);
});

test('receipt rejects changed result digest, revision, fence, evidence or decision identity', () => {
  const boundRequest = request();
  const boundResult = result(boundRequest);
  const decision = allowDecision(boundRequest);
  const original = receipt(boundRequest, boundResult, decision);
  const cases = [];
  for (const [key, value] of [
    ['resultDigest', sha(Buffer.from('other-result'))],
    ['actualAfterRevision', `wsr1:${'9'.repeat(64)}`],
    ['fencingGeneration', 2],
    ['decisionDigest', sha(Buffer.from('other-decision'))],
  ]) {
    const malformed = clone(original);
    malformed[key] = value;
    cases.push(malformed);
  }
  const evidence = clone(original);
  evidence.evidenceRefs = evidence.evidenceRefs.slice(1);
  cases.push(evidence);
  for (const malformed of cases) {
    const checked = validateM2GovernanceReceiptForDecision(
      boundRequest,
      boundResult,
      decision,
      malformed,
    );
    assert.equal(checked.valid, false);
  }

  const premature = receipt(boundRequest, boundResult, decision, {
    recordedAt: '2026-08-24T12:00:01.500Z',
  });
  assert.equal(validateM2GovernanceReceipt(premature).valid, true);
  const prematureCheck = validateM2GovernanceReceiptForDecision(
    boundRequest,
    boundResult,
    decision,
    premature,
  );
  assert.equal(prematureCheck.valid, false);
  assert(prematureCheck.errors.includes('governance-receipt:recorded-before-result'));
});

test('noncanonical bytes are rejected and canonical contract round-trips', () => {
  const value = policy();
  const encoded = encodeM2GovernanceContract(value, M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT);
  assert.deepEqual(
    decodeM2GovernanceContract(encoded, M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT),
    value,
  );
  const pretty = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  assert.throws(() => decodeM2GovernanceContract(pretty), /noncanonical/);
});

summary();
