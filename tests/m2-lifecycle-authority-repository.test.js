#!/usr/bin/env node

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  M2_EFFECT_CONTRACT_KIND,
  computeEffectArgvDigest,
  computeEffectRequestDigest,
} from '../contracts/m2/effect-v1.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
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
  M2_GOVERNANCE_REQUIRED_CHECKS,
  M2_GOVERNANCE_VERDICT,
  computeM2GovernanceBaselineDigest,
  computeM2GovernanceDecisionDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceReceiptDigest,
  createM2GovernanceDecision,
  validateM2GovernancePolicySnapshot,
} from '../contracts/m2/governance-v1.js';
import {
  M2_LIFECYCLE_CONTRACT_KIND,
  M2_LIFECYCLE_CONTRACT_VERSION,
  M2_LIFECYCLE_STATE,
  canonicalizeM2LifecycleValue,
  computeM2LifecycleApprovalIntentDigest,
  computeM2LifecyclePlanSnapshotDigest,
  computeM2LifecycleTerminalSnapshotDigest,
  computeM2LifecycleValueDigest,
} from '../contracts/m2/lifecycle-v1.js';
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import {
  EXPECTED_M2_LIFECYCLE_SCHEMA_FINGERPRINT,
  computeM2LifecycleSchemaFingerprint,
  up as applyLifecycleAuthority,
} from '../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';
import { ExecutionAuthorityRepository } from '../src/execution/execution-authority-repository.js';
import { createM2GovernanceReceipt } from '../src/lifecycle/m2-governance-evaluator.js';
import {
  M2LifecycleAuthorityError,
  M2LifecycleAuthorityErrorCode,
  M2LifecycleAuthorityRepository,
} from '../src/lifecycle/m2-lifecycle-authority-repository.js';
import { suite, test, summary } from './harness.js';

const CREATED_MS = Date.parse('2026-08-24T12:00:00.000Z');
const APPROVED_MS = CREATED_MS + 60_000;
const CLAIM_MS = CREATED_MS + 120_000;
const COMPLETED_MS = CREATED_MS + 180_000;
const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const AFTER_REVISION = `wsr1:${'2'.repeat(64)}`;
const ROOT = '/workspace/project';
const EMPTY_DIGEST = sha(Buffer.alloc(0));
const OWNER = Object.freeze({
  ownerId: 'owner:lifecycle-test',
  pid: 7101,
  bootId: '11111111-1111-4111-8111-111111111111',
  startIdentity: '401',
});

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function openDb(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  const installed = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_effect_requests'
  `).get();
  if (!installed) {
    applyEffectAuthority(db);
    applyEffectAuthorityHardening(db);
    applyEffectExecutionClaims(db);
    applyEffectClaimTruth(db);
    applyExecutionAuthority(db);
  }
  applyLifecycleAuthority(db);
  return db;
}

function effectRequest({ effectId, kind, payload = Buffer.alloc(0), relativePath = 'src/app.js' }) {
  const bytes = Buffer.from(payload);
  const processEffect = kind === 'process.exec';
  const argv = ['--test', 'tests/focused.test.js'];
  return {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
    version: 1,
    effectId,
    runId: 'run-lifecycle-1',
    parentEffectId: null,
    actor: { type: 'user', id: 'operator-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    kind,
    target: processEffect ? {
      type: 'process',
      binary: '/usr/bin/node',
      argv,
      argvDigest: computeEffectArgvDigest(argv),
      canonicalCwd: ROOT,
    } : {
      type: 'filesystem',
      canonicalRoot: ROOT,
      relativePath,
      resolvedRealpath: path.posix.join(ROOT, relativePath),
    },
    payloadDigest: sha(bytes),
    payloadBytes: bytes.length,
    workspaceRevision: BEFORE_REVISION,
    requiredCapability: processEffect ? 'project.process.exec' : 'project.fs.write',
    riskClass: processEffect ? 'exec' : 'write',
    timeoutMs: 120_000,
    idempotencyKey: `lifecycle:${effectId}`,
    approvalGrantId: null,
    createdAt: iso(CREATED_MS),
  };
}

function policySnapshot() {
  const base = {
    contract: M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    policyId: 'policy-lifecycle-1',
    projectId: 17,
    workspaceRevision: BEFORE_REVISION,
    policyPath: '.c3/architecture-policy.json',
    layers: [{ name: 'application', roots: ['src'] }],
    rules: [{ from: 'application', canImport: [] }],
    externalImports: [],
    requiredChecks: [...M2_GOVERNANCE_REQUIRED_CHECKS],
    unmappedFilePolicy: 'unavailable',
  };
  const extended = { ...base, sourceExtensions: ['.js'] };
  return validateM2GovernancePolicySnapshot(extended).valid ? extended : base;
}

function contextSnapshot() {
  const normalized = normalizeProjectContextQuery('Update exact project file');
  const value = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: 'context-lifecycle-1',
    projectId: 17,
    status: 'ok',
    outcome: 'empty',
    workspaceRevision: BEFORE_REVISION,
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

function makeFixture() {
  const before = Buffer.from('export const value = 1;\n');
  const after = Buffer.from('export const value = 2;\n');
  const environment = { NODE_ENV: 'test', NO_COLOR: '1' };
  const forward = effectRequest({ effectId: 'effect-forward', kind: 'fs.write', payload: after });
  const rollback = effectRequest({ effectId: 'effect-rollback', kind: 'fs.write', payload: before });
  const focused = effectRequest({ effectId: 'effect-focused', kind: 'process.exec' });
  const changes = [{
    path: 'src/app.js',
    before: { exists: true, digest: sha(before), bytes: before.length, mode: 0o644 },
    after: { digest: sha(after), bytes: after.length, mode: 0o644 },
    forwardAuthority: {
      effectId: forward.effectId,
      requestDigest: computeEffectRequestDigest(forward),
    },
    rollbackAuthority: {
      effectId: rollback.effectId,
      requestDigest: computeEffectRequestDigest(rollback),
    },
  }];
  const request = {
    contract: M2_EXECUTION_CONTRACT_KIND.REQUEST,
    version: 1,
    executionId: 'execution-lifecycle-1',
    runId: 'run-lifecycle-1',
    actor: { type: 'user', id: 'operator-1' },
    origin: clone(forward.origin),
    project: {
      projectId: 17,
      canonicalRoot: ROOT,
      workspaceRevision: BEFORE_REVISION,
      gitHead: '3'.repeat(40),
      gitBranchRef: 'refs/heads/main',
      foreignDirtDigest: sha(Buffer.from('foreign-dirt')),
    },
    patchSetDigest: computeM2ProjectChangePatchSetDigest(changes),
    changes,
    focusedTest: {
      authority: {
        effectId: focused.effectId,
        requestDigest: computeEffectRequestDigest(focused),
      },
      binary: focused.target.binary,
      argv: [...focused.target.argv],
      argvDigest: computeM2ExecutionValueDigest(focused.target.argv),
      canonicalCwd: ROOT,
      environmentDigest: computeM2ExecutionValueDigest(environment),
      timeoutMs: focused.timeoutMs,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v2',
    },
    gitCommit: null,
    authoritySetDigest: null,
    createdAt: iso(CREATED_MS),
  };
  request.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(request);

  const policy = policySnapshot();
  const baseline = {
    projectId: 17,
    workspaceRevision: BEFORE_REVISION,
    complete: true,
    files: [{
      path: 'src/app.js',
      contentBase64: before.toString('base64'),
      digest: sha(before),
      bytes: before.length,
    }],
  };
  const decision = createM2GovernanceDecision({
    lifecycleId: 'lifecycle-1',
    milestoneId: 'milestone-1',
    executionId: request.executionId,
    runId: request.runId,
    projectId: request.project.projectId,
    requestDigest: computeM2ProjectChangeRequestDigest(request),
    policyDigest: computeM2GovernancePolicySnapshotDigest(policy),
    baselineDigest: computeM2GovernanceBaselineDigest(baseline),
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
  const context = contextSnapshot();
  const plan = {
    contract: M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: {
      lifecycleId: decision.lifecycleId,
      milestoneId: decision.milestoneId,
      runId: request.runId,
      executionId: request.executionId,
    },
    state: M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
    planVersion: 1,
    actor: clone(request.actor),
    origin: clone(request.origin),
    project: clone(request.project),
    intent: 'Update the exact project file and run its focused test.',
    requestDigest: computeM2ProjectChangeRequestDigest(request),
    patchSetDigest: request.patchSetDigest,
    authoritySetDigest: request.authoritySetDigest,
    changes: request.changes.map(change => ({
      path: change.path,
      afterDigest: change.after.digest,
      afterBytes: change.after.bytes,
    })),
    focusedTest: {
      binary: request.focusedTest.binary,
      argv: [...request.focusedTest.argv],
      argvDigest: request.focusedTest.argvDigest,
      environmentDigest: request.focusedTest.environmentDigest,
      timeoutMs: request.focusedTest.timeoutMs,
    },
    gitCommit: null,
    governancePolicyDigest: computeM2GovernancePolicySnapshotDigest(policy),
    governanceBaselineDigest: computeM2GovernanceBaselineDigest(baseline),
    contextSnapshotDigest: computeM2LifecycleValueDigest(context),
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(decision),
    expectedAfterRevision: AFTER_REVISION,
    createdAt: iso(CREATED_MS + 1_000),
    approvalExpiresAt: iso(CREATED_MS + 10 * 60_000),
  };
  const approval = {
    contract: M2_LIFECYCLE_CONTRACT_KIND.APPROVAL_INTENT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    approvalId: 'approval-lifecycle-1',
    identity: clone(plan.identity),
    state: M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
    decision: 'approve',
    planVersion: plan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(plan),
    requestDigest: plan.requestDigest,
    authoritySetDigest: plan.authoritySetDigest,
    projectId: plan.project.projectId,
    workspaceRevision: plan.project.workspaceRevision,
    actor: clone(plan.actor),
    approvedAt: iso(APPROVED_MS),
    expiresAt: iso(CREATED_MS + 9 * 60_000),
  };
  return {
    before,
    after,
    environment,
    effects: [forward, rollback, focused],
    request,
    files: [{ path: 'src/app.js', beforeBytes: before, afterBytes: after }],
    context,
    policy,
    baseline,
    decision,
    plan,
    approval,
  };
}

function repositories(db, time) {
  return {
    effectRepository: new EffectAuthorityRepository(db, { clock: () => time.now }),
    executionRepository: new ExecutionAuthorityRepository(db, { clock: () => time.now }),
    lifecycleRepository: new M2LifecycleAuthorityRepository(db, { clock: () => time.now }),
  };
}

function registerFixture(db, fixture = makeFixture(), time = { now: APPROVED_MS }) {
  const repos = repositories(db, time);
  for (const effect of fixture.effects) repos.effectRepository.registerEffectRequest(effect);
  repos.executionRepository.registerProjectChange(fixture.request, { files: fixture.files, git: null });
  repos.lifecycleRepository.registerOperation({
    plan: fixture.plan,
    request: fixture.request,
    contextSnapshot: fixture.context,
    focusedEnvironment: fixture.environment,
    policySnapshot: fixture.policy,
    baselineSnapshot: fixture.baseline,
    decision: fixture.decision,
  });
  return { ...repos, fixture, time };
}

function issueGrants(registered) {
  let ordinal = 0;
  const issuer = createApprovalGrantIssuer(registered.effectRepository, {
    clock: () => registered.time.now,
    grantIdFactory: () => `grant-lifecycle-${++ordinal}`,
    nonceFactory: () => `nonce-lifecycle-0000-${ordinal}`,
  });
  return registered.fixture.effects.map(effect => ({
    effectId: effect.effectId,
    grantId: issuer.issue({
      effectId: effect.effectId,
      authenticatedSubject: { actorType: 'user', actorId: 'operator-1' },
    }).grant.grantId,
  }));
}

function consumeForExecution(registered, grants) {
  registered.time.now = CLAIM_MS;
  registered.executionRepository.acquireClaim({
    executionId: registered.fixture.request.executionId,
    owner: OWNER,
    liveness: { isProvablyDead: () => false },
  });
  registered.effectRepository.consumeApprovalGrantBatch({
    items: registered.fixture.effects.map(effect => {
      const grant = grants.find(candidate => candidate.effectId === effect.effectId);
      return { grantId: grant.grantId, request: { ...effect, approvalGrantId: grant.grantId } };
    }),
    executionOwner: OWNER,
  });
  registered.executionRepository.recordApprovalSet({
    executionId: registered.fixture.request.executionId,
    generation: 1,
    grantIds: grants.map(grant => grant.grantId).sort(),
  });
}

function effectSuccess(request, grantId, fixture) {
  const filesystem = request.kind === 'fs.write';
  const forward = request.effectId === 'effect-forward';
  return {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
    version: 1,
    effectId: request.effectId,
    runId: request.runId,
    projectId: request.origin.projectId,
    requestDigest: computeEffectRequestDigest(request),
    approvalGrantId: grantId,
    terminalStatus: 'succeeded',
    startedAt: iso(CLAIM_MS + 1_000),
    completedAt: iso(CLAIM_MS + 2_000),
    process: filesystem
      ? { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null }
      : { pid: 7201, processGroupId: 7201, startIdentity: '501', exitCode: 0, signal: null },
    changes: filesystem ? {
      paths: ['src/app.js'],
      beforeDigest: forward ? sha(fixture.before) : sha(fixture.after),
      afterDigest: request.payloadDigest,
      diffArtifact: null,
    } : { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: filesystem ? request.payloadDigest : EMPTY_DIGEST,
    errorCode: null,
    evidenceRefs: [`effect:${request.effectId}:fixture-success`],
    lateCompletionRejected: false,
  };
}

function projectSuccess(fixture) {
  return {
    contract: M2_EXECUTION_CONTRACT_KIND.RESULT,
    version: 1,
    executionId: fixture.request.executionId,
    requestDigest: computeM2ProjectChangeRequestDigest(fixture.request),
    runId: fixture.request.runId,
    projectId: fixture.request.project.projectId,
    terminalStatus: 'succeeded',
    fencingGeneration: 1,
    startedAt: iso(CLAIM_MS),
    completedAt: iso(COMPLETED_MS),
    changes: {
      paths: ['src/app.js'],
      beforeRevision: BEFORE_REVISION,
      afterRevision: AFTER_REVISION,
      diffDigest: sha(Buffer.from('diff')),
    },
    focusedTest: {
      effectId: fixture.request.focusedTest.authority.effectId,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: EMPTY_DIGEST,
      stderrDigest: EMPTY_DIGEST,
      outputTruncated: false,
    },
    git: {
      status: 'not_requested',
      beforeHead: fixture.request.project.gitHead,
      afterHead: fixture.request.project.gitHead,
      commitId: null,
      foreignDirtPreserved: true,
    },
    rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
  };
}

function recordSuccess(registered, grants) {
  consumeForExecution(registered, grants);
  for (const effect of registered.fixture.effects.filter(effect => effect.effectId !== 'effect-rollback')) {
    const grant = grants.find(candidate => candidate.effectId === effect.effectId);
    registered.effectRepository.recordEffectResult(effectSuccess(effect, grant.grantId, registered.fixture));
  }
  const result = projectSuccess(registered.fixture);
  registered.executionRepository.recordResult(result);
  return result;
}

function successTerminal(fixture, result, receipt) {
  return {
    contract: M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: clone(fixture.plan.identity),
    state: M2_LIFECYCLE_STATE.SUCCEEDED,
    planVersion: fixture.plan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(fixture.plan),
    approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(fixture.approval),
    requestDigest: fixture.plan.requestDigest,
    authoritySetDigest: fixture.plan.authoritySetDigest,
    projectId: fixture.plan.project.projectId,
    workspaceRevision: result.changes.afterRevision,
    resultDigest: computeM2ExecutionValueDigest(result),
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(fixture.decision),
    governanceReceiptDigest: computeM2GovernanceReceiptDigest(receipt),
    errorCode: null,
    completedAt: iso(COMPLETED_MS + 2_000),
    evidenceRefs: [...receipt.evidenceRefs, 'lifecycle:lifecycle-1:succeeded'].sort(),
  };
}

function orphanedSucceededTerminal(fixture, result, errorCode) {
  return {
    contract: M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: clone(fixture.plan.identity),
    state: M2_LIFECYCLE_STATE.ORPHANED,
    planVersion: fixture.plan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(fixture.plan),
    approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(fixture.approval),
    requestDigest: fixture.plan.requestDigest,
    authoritySetDigest: fixture.plan.authoritySetDigest,
    projectId: fixture.plan.project.projectId,
    workspaceRevision: result.changes.afterRevision,
    resultDigest: computeM2ExecutionValueDigest(result),
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(fixture.decision),
    governanceReceiptDigest: null,
    errorCode,
    completedAt: iso(COMPLETED_MS + 2_000),
    evidenceRefs: [...result.evidenceRefs, `lifecycle:lifecycle-1:${errorCode}`].sort(),
  };
}

function blockedTerminal(fixture) {
  return {
    contract: M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT,
    version: M2_LIFECYCLE_CONTRACT_VERSION,
    identity: clone(fixture.plan.identity),
    state: M2_LIFECYCLE_STATE.BLOCKED,
    planVersion: fixture.plan.planVersion,
    planDigest: computeM2LifecyclePlanSnapshotDigest(fixture.plan),
    approvalIntentDigest: null,
    requestDigest: fixture.plan.requestDigest,
    authoritySetDigest: fixture.plan.authoritySetDigest,
    projectId: fixture.plan.project.projectId,
    workspaceRevision: BEFORE_REVISION,
    resultDigest: null,
    governanceDecisionDigest: computeM2GovernanceDecisionDigest(fixture.decision),
    governanceReceiptDigest: null,
    errorCode: 'M2_LIFECYCLE_BLOCKED',
    completedAt: iso(COMPLETED_MS),
    evidenceRefs: ['lifecycle:lifecycle-1:blocked'],
  };
}

function reboundContext(fixture) {
  const changed = clone(fixture);
  changed.context.requestId = 'context-lifecycle-rebound';
  changed.context.snapshotDigest = computeProjectContextSnapshotDigest(changed.context);
  changed.plan.contextSnapshotDigest = computeM2LifecycleValueDigest(changed.context);
  changed.approval.planDigest = computeM2LifecyclePlanSnapshotDigest(changed.plan);
  return changed;
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof M2LifecycleAuthorityError && error.code === code);
}

suite('M2 durable lifecycle authority repository');

test('079 installs its pinned seven-table append-only schema idempotently', () => {
  const db = openDb();
  assert.equal(computeM2LifecycleSchemaFingerprint(db), EXPECTED_M2_LIFECYCLE_SCHEMA_FINGERPRINT);
  assert.equal(db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name GLOB 'm2_lifecycle_*'
  `).get().count, 7);
  assert.equal(db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE type = 'trigger' AND name GLOB 'trg_m2_lifecycle_*_append_only_*'
  `).get().count, 14);
  assert.doesNotThrow(() => applyLifecycleAuthority(db));
  db.close();
});

test('operation persists exact request, context, environment and governance material', () => {
  const db = openDb();
  const fixture = makeFixture();
  const registered = registerFixture(db, fixture);
  assert.equal(registered.lifecycleRepository.registerOperation({
    plan: fixture.plan,
    request: fixture.request,
    contextSnapshot: fixture.context,
    focusedEnvironment: fixture.environment,
    policySnapshot: fixture.policy,
    baselineSnapshot: fixture.baseline,
    decision: fixture.decision,
  }).created, false);
  assert.deepEqual(registered.lifecycleRepository.getPlan('lifecycle-1'), fixture.plan);
  assert.deepEqual(registered.lifecycleRepository.getRequest('lifecycle-1'), fixture.request);
  assert.deepEqual(registered.lifecycleRepository.getContextSnapshot('lifecycle-1'), fixture.context);
  assert.deepEqual(registered.lifecycleRepository.getFocusedEnvironment('lifecycle-1'), fixture.environment);
  assert.deepEqual(registered.lifecycleRepository.getPolicy('lifecycle-1'), fixture.policy);
  assert.deepEqual(registered.lifecycleRepository.getBaseline('lifecycle-1'), fixture.baseline);
  assert.deepEqual(registered.lifecycleRepository.getDecision('lifecycle-1'), fixture.decision);
  const rebound = reboundContext(fixture);
  expectCode(() => registered.lifecycleRepository.registerOperation({
    plan: rebound.plan,
    request: rebound.request,
    contextSnapshot: rebound.context,
    focusedEnvironment: rebound.environment,
    policySnapshot: rebound.policy,
    baselineSnapshot: rebound.baseline,
    decision: rebound.decision,
  }), M2LifecycleAuthorityErrorCode.OPERATION_CONFLICT);
  db.close();
});

test('SQL rejects forged lifecycle rows and every lifecycle table is immutable', () => {
  const db = openDb();
  registerFixture(db);
  const row = db.prepare('SELECT * FROM m2_lifecycle_operations').get();
  const columns = Object.keys(row);
  const forged = { ...row, lifecycle_id: 'lifecycle-forged' };
  assert.throws(() => db.prepare(`
    INSERT INTO m2_lifecycle_operations (${columns.join(',')})
    VALUES (${columns.map(() => '?').join(',')})
  `).run(...columns.map(column => forged[column])), /M2_LIFECYCLE_OPERATION_AUTHORITY_MISMATCH/);
  assert.throws(() => db.prepare(`
    INSERT INTO m2_lifecycle_events (
      event_id, lifecycle_id, event_type, occurred_at_ms, details_json
    ) VALUES ('forged-approval-event', 'lifecycle-1', 'approval_recorded', ?, '{}')
  `).run(APPROVED_MS), /M2_LIFECYCLE_EVENT_AFTER_TERMINAL/);
  assert.throws(() => db.prepare(`
    UPDATE m2_lifecycle_operations SET milestone_id = 'other' WHERE lifecycle_id = 'lifecycle-1'
  `).run(), /append-only/);
  assert.throws(() => db.prepare(`
    DELETE FROM m2_lifecycle_operations WHERE lifecycle_id = 'lifecycle-1'
  `).run(), /append-only/);
  db.close();
});

test('approval is exact, stale authority fails closed, and exact replay survives expiry', () => {
  const db = openDb();
  const registered = registerFixture(db);
  assert.equal(registered.lifecycleRepository.recordApprovalIntent({
    lifecycleId: 'lifecycle-1', approval: registered.fixture.approval,
  }).created, true);
  const stale = { ...registered.fixture.approval, planDigest: sha(Buffer.from('stale-plan')) };
  expectCode(
    () => registered.lifecycleRepository.recordApprovalIntent(stale),
    M2LifecycleAuthorityErrorCode.INPUT_INVALID,
  );
  registered.time.now = CREATED_MS + 20 * 60_000;
  assert.equal(registered.lifecycleRepository.recordApprovalIntent(registered.fixture.approval).created, false);
  const conflict = { ...registered.fixture.approval, approvalId: 'approval-other' };
  expectCode(
    () => registered.lifecycleRepository.recordApprovalIntent(conflict),
    M2LifecycleAuthorityErrorCode.APPROVAL_CONFLICT,
  );
  db.close();
});

test('grant projection requires every exact live child authority and rejects different replay', () => {
  const db = openDb();
  const registered = registerFixture(db);
  registered.lifecycleRepository.recordApprovalIntent(registered.fixture.approval);
  const grants = issueGrants(registered);
  expectCode(
    () => registered.lifecycleRepository.recordGrantSet({ lifecycleId: 'lifecycle-1', grants: grants.slice(1) }),
    M2LifecycleAuthorityErrorCode.GRANT_SET_INCOMPLETE,
  );
  expectCode(() => registered.lifecycleRepository.recordGrantSet({
    lifecycleId: 'lifecycle-1',
    approvalIntentDigest: sha(Buffer.from('wrong-approval')),
    grants,
  }), M2LifecycleAuthorityErrorCode.INPUT_INVALID);
  assert.equal(registered.lifecycleRepository.recordGrantSet({
    lifecycleId: 'lifecycle-1',
    approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(registered.fixture.approval),
    grants,
  }).created, true);
  assert.deepEqual(registered.lifecycleRepository.getGrantSet('lifecycle-1').grants, [...grants].sort(
    (left, right) => Buffer.compare(Buffer.from(left.effectId), Buffer.from(right.effectId)),
  ));
  assert.equal(registered.lifecycleRepository.recordGrantSet({ lifecycleId: 'lifecycle-1', grants }).created, false);
  expectCode(() => registered.lifecycleRepository.recordGrantSet({
    lifecycleId: 'lifecycle-1',
    grants: grants.map((grant, index) => index === 0 ? { ...grant, grantId: 'grant-different' } : grant),
  }), M2LifecycleAuthorityErrorCode.GRANT_SET_CONFLICT);
  db.close();
});

test('cancel intent is exact, cuts off later approval and requires revoked grants before terminal', () => {
  const db = openDb();
  const registered = registerFixture(db);
  registered.lifecycleRepository.recordApprovalIntent(registered.fixture.approval);
  const grants = issueGrants(registered);
  registered.lifecycleRepository.recordGrantSet({ lifecycleId: 'lifecycle-1', grants });
  const cancelInput = {
    lifecycleId: 'lifecycle-1',
    actorId: 'operator-1',
    reason: 'user_cancelled',
    requestedAt: iso(APPROVED_MS),
  };
  assert.equal(registered.lifecycleRepository.recordCancelIntent(cancelInput).created, true);
  assert.equal(registered.lifecycleRepository.recordCancelIntent(cancelInput).created, false);
  expectCode(
    () => registered.lifecycleRepository.recordTerminal({ terminal: {
      ...blockedTerminal(registered.fixture),
      state: M2_LIFECYCLE_STATE.CANCELLED,
      approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(registered.fixture.approval),
      errorCode: 'M2_LIFECYCLE_CANCELLED',
    }, lifecycleId: 'lifecycle-1' }),
    M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING,
  );
  registered.effectRepository.revokeRunGrants({ runId: registered.fixture.request.runId, reason: 'lifecycle_cancelled' });
  const cancelled = {
    ...blockedTerminal(registered.fixture),
    state: M2_LIFECYCLE_STATE.CANCELLED,
    approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(registered.fixture.approval),
    errorCode: 'M2_LIFECYCLE_CANCELLED',
  };
  assert.equal(registered.lifecycleRepository.recordTerminal({
    lifecycleId: 'lifecycle-1', terminal: cancelled,
  }).created, true);
  assert.deepEqual(registered.lifecycleRepository.getTerminal('lifecycle-1'), cancelled);
  db.close();
});

test('success cannot be forged before execution, approval, grants and governance receipt', () => {
  const db = openDb();
  const registered = registerFixture(db);
  const fakeResult = projectSuccess(registered.fixture);
  const fakeReceipt = createM2GovernanceReceipt({
    request: registered.fixture.request,
    result: fakeResult,
    decision: registered.fixture.decision,
    recordedAt: iso(COMPLETED_MS + 1_000),
  });
  expectCode(
    () => registered.lifecycleRepository.recordReceipt(fakeReceipt),
    M2LifecycleAuthorityErrorCode.INPUT_INVALID,
  );
  const fakeTerminal = successTerminal(registered.fixture, fakeResult, fakeReceipt);
  expectCode(
    () => registered.lifecycleRepository.recordTerminal(fakeTerminal),
    M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING,
  );
  assert.throws(() => db.prepare(`
    INSERT INTO m2_lifecycle_terminals (
      lifecycle_id, execution_id, terminal_status,
      terminal_digest, terminal_json, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'lifecycle-1', registered.fixture.request.executionId, 'succeeded',
    computeM2LifecycleTerminalSnapshotDigest(fakeTerminal),
    canonicalizeM2LifecycleValue(fakeTerminal), Date.parse(fakeTerminal.completedAt),
  ), /M2_LIFECYCLE_TERMINAL_AUTHORITY_MISSING/);
  db.close();
});

test('exact execution result, receipt and terminal form one immutable success chain', () => {
  const db = openDb();
  const registered = registerFixture(db);
  registered.lifecycleRepository.recordApprovalIntent(registered.fixture.approval);
  const grants = issueGrants(registered);
  registered.lifecycleRepository.recordGrantSet({ lifecycleId: 'lifecycle-1', grants });
  const result = recordSuccess(registered, grants);
  expectCode(() => registered.lifecycleRepository.recordTerminal(orphanedSucceededTerminal(
    registered.fixture,
    result,
    'M2_LIFECYCLE_LATE_SUCCESS_AFTER_CANCEL',
  )), M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING);
  const receipt = createM2GovernanceReceipt({
    request: registered.fixture.request,
    result,
    decision: registered.fixture.decision,
    recordedAt: iso(COMPLETED_MS + 1_000),
  });
  assert.equal(registered.lifecycleRepository.recordReceipt({
    lifecycleId: 'lifecycle-1', receipt,
  }).created, true);
  assert.equal(registered.lifecycleRepository.recordReceipt(receipt).created, false);
  const terminal = successTerminal(registered.fixture, result, receipt);
  assert.equal(registered.lifecycleRepository.recordTerminal({
    lifecycleId: 'lifecycle-1', terminal,
  }).created, true);
  assert.equal(registered.lifecycleRepository.recordTerminal(terminal).created, false);
  assert.deepEqual(registered.lifecycleRepository.getReceipt('lifecycle-1'), receipt);
  assert.deepEqual(registered.lifecycleRepository.getTerminal('lifecycle-1'), terminal);
  assert.equal(registered.lifecycleRepository.listRecoverable().length, 0);
  assert.throws(() => db.prepare(`
    UPDATE m2_lifecycle_terminals SET terminal_status = 'failed' WHERE lifecycle_id = 'lifecycle-1'
  `).run(), /append-only/);
  db.close();
});

test('late execution success after durable cancel can only become exact orphaned evidence', () => {
  const db = openDb();
  const registered = registerFixture(db);
  registered.lifecycleRepository.recordApprovalIntent(registered.fixture.approval);
  const grants = issueGrants(registered);
  registered.lifecycleRepository.recordGrantSet({ lifecycleId: 'lifecycle-1', grants });
  consumeForExecution(registered, grants);
  const cancel = {
    lifecycleId: 'lifecycle-1',
    actorId: 'operator-1',
    reason: 'user_cancelled',
    requestedAt: iso(CLAIM_MS),
  };
  registered.lifecycleRepository.recordCancelIntent(cancel);
  for (const effect of registered.fixture.effects.filter(effect => effect.effectId !== 'effect-rollback')) {
    const grant = grants.find(candidate => candidate.effectId === effect.effectId);
    registered.effectRepository.recordEffectResult(effectSuccess(effect, grant.grantId, registered.fixture));
  }
  const result = projectSuccess(registered.fixture);
  registered.executionRepository.recordResult(result);
  const receipt = createM2GovernanceReceipt({
    request: registered.fixture.request,
    result,
    decision: registered.fixture.decision,
    recordedAt: iso(COMPLETED_MS + 1_000),
  });
  expectCode(
    () => registered.lifecycleRepository.recordReceipt(receipt),
    M2LifecycleAuthorityErrorCode.RECEIPT_CONFLICT,
  );
  expectCode(() => registered.lifecycleRepository.recordTerminal(orphanedSucceededTerminal(
    registered.fixture,
    result,
    'M2_LIFECYCLE_RESULT_REVISION_MISMATCH',
  )), M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING);
  const late = orphanedSucceededTerminal(
    registered.fixture,
    result,
    'M2_LIFECYCLE_LATE_SUCCESS_AFTER_CANCEL',
  );
  assert.equal(registered.lifecycleRepository.recordTerminal(late).created, true);
  assert.deepEqual(registered.lifecycleRepository.getTerminal('lifecycle-1'), late);
  assert.equal(registered.lifecycleRepository.listRecoverable().length, 0);
  db.close();
});

test('non-success terminal remains explicit and cannot be relabelled as success', () => {
  const db = openDb();
  const registered = registerFixture(db);
  const blocked = blockedTerminal(registered.fixture);
  assert.equal(registered.lifecycleRepository.recordTerminal(blocked).created, true);
  assert.equal(registered.lifecycleRepository.recordTerminal(blocked).created, false);
  const falseSuccess = {
    ...blocked,
    state: M2_LIFECYCLE_STATE.SUCCEEDED,
    errorCode: null,
  };
  expectCode(
    () => registered.lifecycleRepository.recordTerminal(falseSuccess),
    M2LifecycleAuthorityErrorCode.INPUT_INVALID,
  );
  db.close();
});

test('event journal is state-backed, ordered, immutable and exactly replayable', () => {
  const db = openDb();
  const registered = registerFixture(db);
  assert.equal(registered.lifecycleRepository.appendEvent({
    eventId: 'event-operation', lifecycleId: 'lifecycle-1', eventType: 'operation_registered',
    details: { planDigest: computeM2LifecyclePlanSnapshotDigest(registered.fixture.plan) },
  }).created, true);
  assert.equal(registered.lifecycleRepository.appendEvent({
    eventId: 'event-operation', lifecycleId: 'lifecycle-1', eventType: 'operation_registered',
    details: { planDigest: computeM2LifecyclePlanSnapshotDigest(registered.fixture.plan) },
  }).created, false);
  registered.lifecycleRepository.recordApprovalIntent(registered.fixture.approval);
  registered.lifecycleRepository.appendEvent({
    eventId: 'event-approval', lifecycleId: 'lifecycle-1', type: 'approval_recorded',
    details: { approvalIntentDigest: computeM2LifecycleApprovalIntentDigest(registered.fixture.approval) },
  });
  assert.deepEqual(
    registered.lifecycleRepository.listEvents('lifecycle-1').map(event => event.eventId),
    ['event-operation', 'event-approval'],
  );
  expectCode(() => registered.lifecycleRepository.appendEvent({
    eventId: 'event-operation', lifecycleId: 'lifecycle-1', type: 'operation_registered',
    details: { planDigest: sha(Buffer.from('different')) },
  }), M2LifecycleAuthorityErrorCode.EVENT_CONFLICT);
  assert.throws(() => db.prepare(`
    DELETE FROM m2_lifecycle_events WHERE event_id = 'event-operation'
  `).run(), /append-only/);
  db.close();
});

test('two SQLite connections resolve exact operation races without split identity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m2-lifecycle-race-'));
  const filename = path.join(directory, 'authority.sqlite');
  const firstDb = openDb(filename);
  const fixture = makeFixture();
  const time = { now: APPROVED_MS };
  const base = repositories(firstDb, time);
  for (const effect of fixture.effects) base.effectRepository.registerEffectRequest(effect);
  base.executionRepository.registerProjectChange(fixture.request, { files: fixture.files, git: null });
  const secondDb = openDb(filename);
  const first = new M2LifecycleAuthorityRepository(firstDb, { clock: () => time.now });
  const second = new M2LifecycleAuthorityRepository(secondDb, { clock: () => time.now });
  const input = {
    plan: fixture.plan,
    request: fixture.request,
    contextSnapshot: fixture.context,
    focusedEnvironment: fixture.environment,
    policySnapshot: fixture.policy,
    baselineSnapshot: fixture.baseline,
    decision: fixture.decision,
  };
  assert.equal(first.registerOperation(input).created, true);
  assert.equal(second.registerOperation(input).created, false);
  const rebound = reboundContext(fixture);
  expectCode(() => second.registerOperation({
    ...input, plan: rebound.plan, contextSnapshot: rebound.context,
  }), M2LifecycleAuthorityErrorCode.OPERATION_CONFLICT);
  assert.equal(firstDb.prepare('SELECT count(*) AS count FROM m2_lifecycle_operations').get().count, 1);
  firstDb.close();
  secondDb.close();
  rmSync(directory, { recursive: true, force: true });
});

test('crash-window read model preserves recovery stage and exact restart material', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m2-lifecycle-recovery-'));
  const filename = path.join(directory, 'authority.sqlite');
  const fixture = makeFixture();
  const time = { now: APPROVED_MS };
  let db = openDb(filename);
  let registered = registerFixture(db, fixture, time);
  assert.equal(registered.lifecycleRepository.listRecoverable()[0].state, M2_LIFECYCLE_STATE.AWAITING_APPROVAL);
  db.close();

  db = openDb(filename);
  registered = { ...repositories(db, time), fixture, time };
  assert.deepEqual(registered.lifecycleRepository.getContextSnapshot('lifecycle-1'), fixture.context);
  assert.deepEqual(registered.lifecycleRepository.getFocusedEnvironment('lifecycle-1'), fixture.environment);
  registered.lifecycleRepository.recordApprovalIntent(fixture.approval);
  assert.equal(registered.lifecycleRepository.listRecoverable()[0].state, 'approval_recorded');
  const grants = issueGrants(registered);
  registered.lifecycleRepository.recordGrantSet({ lifecycleId: 'lifecycle-1', grants });
  assert.equal(registered.lifecycleRepository.listRecoverable()[0].state, M2_LIFECYCLE_STATE.EXECUTING);
  const result = recordSuccess(registered, grants);
  assert.equal(registered.lifecycleRepository.listRecoverable()[0].state, 'governance_pending');
  const receipt = createM2GovernanceReceipt({
    request: fixture.request,
    result,
    decision: fixture.decision,
    recordedAt: iso(COMPLETED_MS + 1_000),
  });
  registered.lifecycleRepository.recordReceipt(receipt);
  assert.equal(registered.lifecycleRepository.listRecoverable()[0].state, 'terminal_pending');
  db.close();

  db = openDb(filename);
  registered = { ...repositories(db, time), fixture, time };
  assert.deepEqual(registered.lifecycleRepository.getReceipt('lifecycle-1'), receipt);
  registered.lifecycleRepository.recordTerminal(successTerminal(fixture, result, receipt));
  assert.equal(registered.lifecycleRepository.listRecoverable().length, 0);
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

summary();
