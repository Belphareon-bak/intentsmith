import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test, summary } from './harness.js';
import * as execution from '../contracts/m2/execution-v2.js';
import * as lifecycle from '../contracts/m2/lifecycle-v2.js';
import * as originalExecution from '../contracts/m2/execution-v1.js';
import * as originalLifecycle from '../contracts/m2/lifecycle-v1.js';
import { computeEffectRequestDigest } from '../contracts/m2/effect-v1.js';
import { computeM2ProjectChangeRequestDigest } from '../contracts/m2/execution-v2.js';
import { computeM2LifecyclePlanSnapshotDigest } from '../contracts/m2/lifecycle-v2.js';
import { M2_EXECUTION_CONTRACT_KIND, M2_EXECUTION_CONTRACT_VERSION,
  computeM2ExecutionValueDigest, computeM2ProjectChangeAuthoritySetDigest,
  computeM2ProjectChangePatchSetDigest } from '../contracts/m2/execution-v1.js';
import { PROJECT_CONTEXT_CONTRACT_VERSION, PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_NORMALIZATION_VERSION, computeProjectContextSnapshotDigest,
  normalizeProjectContextQuery } from '../contracts/m2/project-context-v1.js';
import { M2_GOVERNANCE_CHECK_STATUS, M2_GOVERNANCE_CONTRACT_KIND,
  M2_GOVERNANCE_CONTRACT_VERSION, M2_GOVERNANCE_DECISION_CHECKS,
  M2_GOVERNANCE_VERDICT, computeM2GovernanceDecisionDigest,
  computeM2GovernanceReceiptDigest, computeM2GovernanceValueDigest,
  createM2GovernanceDecision } from '../contracts/m2/governance-v1.js';
import { M2_LIFECYCLE_CONTRACT_KIND, M2_LIFECYCLE_CONTRACT_VERSION,
  M2_LIFECYCLE_STATE, computeM2LifecycleApprovalIntentDigest,
  computeM2LifecycleValueDigest } from '../contracts/m2/lifecycle-v1.js';

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


const ref = (canonicalPath, suffix) => ({ canonicalPath, bytes: 1234, digest: sha(Buffer.from(suffix)), device: '2049', inode: String(suffix.charCodeAt(0) + 1000) });
const policy = () => ({ contract: 'M2PrivateHttpNetworkPolicy', version: 1,
  profile: execution.M2_PRIVATE_HTTP_PROFILE, architecture: 'x64',
  endpoint: { family: 'ipv4', transport: 'tcp', address: '127.0.0.1', port: 18080 },
  minimumLandlockAbi: 4, nftRulesDigest: execution.computeM2PrivateHttpNftRulesDigest(18080),
  seccompProgramDigest: execution.M2_PRIVATE_HTTP_SECCOMP_DIGEST,
  artifacts: { launcher: ref('/trusted/private-http-launcher', 'l'), ip: ref('/usr/bin/ip', 'i'),
    nft: ref('/usr/sbin/nft', 'f'), runtimeExecutable: ref('/trusted/node24', 'n'), oracle: ref('/trusted/oracle.mjs', 'o') } });
const environment = { LANG: 'C.UTF-8', LABEL: 'Český "řetězec"\n💡', LD_LIBRARY_PATH: '/trusted/server-only' };
function httpRequest() {
  const value = request();
  value.version = 2;
  const networkPolicy = policy();
  value.focusedTest = { ...value.focusedTest, binary: networkPolicy.artifacts.runtimeExecutable.canonicalPath,
    argv: [networkPolicy.artifacts.oracle.canonicalPath, 'src/server.mjs', '/tmp/private.sqlite', '18080'],
    sandboxProfile: execution.M2_PRIVATE_HTTP_PROFILE, networkPolicy,
    networkPolicyDigest: execution.computeM2PrivateHttpNetworkPolicyDigest(networkPolicy),
    environmentDigest: execution.computeM2ExecutionValueDigest(environment) };
  value.focusedTest.argvDigest = execution.computeM2ExecutionValueDigest(value.focusedTest.argv);
  const bytes = execution.encodeM2PrivateHttpProcessPayload(value.focusedTest, environment);
  const effect = { contract: 'EffectRequest', version: 1, effectId: value.focusedTest.authority.effectId,
    runId: value.runId, parentEffectId: null, actor: clone(value.actor), origin: clone(value.origin),
    kind: 'process.exec', target: { type: 'process', binary: value.focusedTest.binary, argv: value.focusedTest.argv,
      argvDigest: value.focusedTest.argvDigest, canonicalCwd: value.project.canonicalRoot },
    payloadDigest: sha(bytes), payloadBytes: bytes.length, workspaceRevision: value.project.workspaceRevision,
    requiredCapability: 'project.process.exec', riskClass: 'exec', timeoutMs: value.focusedTest.timeoutMs,
    idempotencyKey: 'idempotency-http-1', approvalGrantId: null, createdAt: value.createdAt };
  value.focusedTest.authority.requestDigest = computeEffectRequestDigest(effect);
  value.authoritySetDigest = execution.computeM2ProjectChangeAuthoritySetDigest(value);
  return { request: value, effect, bytes };
}
function chain() {
  const base = httpRequest(); const req = base.request;
  const decision = allowDecision(req);
  const focusedTest = Object.fromEntries(['binary', 'argv', 'argvDigest', 'environmentDigest', 'timeoutMs',
    'sandboxProfile', 'networkPolicy', 'networkPolicyDigest'].map(key => [key, clone(req.focusedTest[key])]));
  const p = plan(req, { version: 2, focusedTest });
  const a = approval(p);
  const r = result(req, { version: 2 });
  r.focusedTest = { ...r.focusedTest, sandboxProfile: req.focusedTest.sandboxProfile, networkPolicyDigest: req.focusedTest.networkPolicyDigest };
  const rec = receipt(r, decision);
  return { ...base, plan: p, approval: a, result: r, governanceDecision: decision,
    governanceReceipt: rec, contextSnapshot: contextSnapshot(req), terminal: terminal(p, a, r, decision, rec) };
}
function valid(result) { assert.equal(result.valid, true, result.errors.join(',')); }
function invalid(result, fragment) { assert.equal(result.valid, false); if (fragment) assert.ok(result.errors.some(e => e.includes(fragment)), result.errors.join(',')); }

suite('Private HTTP V2 — pure schema preparation, no execution');
test('complete V2 request/plan/@1 approval/@1 governance/@1 terminal bind exact policy', () => {
  const c = chain();
  valid(execution.validateM2ProjectChangeRequest(c.request));
  valid(execution.validateM2ProjectChangeResultForRequest(c.request, c.result));
  valid(lifecycle.validateM2LifecyclePlanSnapshotForRequest(c.request, c.plan));
  valid(lifecycle.validateM2LifecyclePlanSnapshotForContext(c.contextSnapshot, c.plan));
  valid(lifecycle.validateM2LifecyclePlanSnapshotForDecision(c.request, c.governanceDecision, c.plan));
  valid(lifecycle.validateM2LifecycleApprovalIntentForPlan(c.plan, c.approval));
  valid(lifecycle.validateM2GovernanceReceiptForDecision(c.request, c.result, c.governanceDecision, c.governanceReceipt));
  valid(lifecycle.validateM2LifecycleTerminalSnapshotForExecution(c));
});
test('V1 dispatch delegates exact validators, wire bytes and hashes', () => {
  const c = evidence();
  assert.deepEqual(execution.validateM2ProjectChangeRequest(c.request), originalExecution.validateM2ProjectChangeRequest(c.request));
  assert.equal(execution.computeM2ProjectChangeRequestDigest(c.request), originalExecution.computeM2ProjectChangeRequestDigest(c.request));
  assert.deepEqual(execution.encodeM2ExecutionContract(c.request), originalExecution.encodeM2ExecutionContract(c.request));
  assert.deepEqual(execution.encodeM2ExecutionContract(c.result), originalExecution.encodeM2ExecutionContract(c.result));
  assert.deepEqual(lifecycle.encodeM2LifecycleContract(c.plan), originalLifecycle.encodeM2LifecycleContract(c.plan));
  assert.equal(lifecycle.computeM2LifecyclePlanSnapshotDigest(c.plan), originalLifecycle.computeM2LifecyclePlanSnapshotDigest(c.plan));
  valid(lifecycle.validateM2LifecycleTerminalSnapshotForExecution(c));
});
test('canonical nft port formatter preserves independently pinned reference bytes', () => {
  assert.equal(Buffer.byteLength(execution.formatM2PrivateHttpNftRules(18080), 'ascii'), 613);
  assert.equal(execution.computeM2PrivateHttpNftRulesDigest(18080), 'sha256:b91c12c4d954906120b74c552cc4545e59e281a77e3f690918764f41ba20949e');
});
test('payload exact UTF8/escaping/environment and process capability bind into authority', () => {
  const c = chain();
  valid(execution.validateM2PrivateHttpProcessEffectForRequest(c.request, c.effect, c.bytes, environment));
  const decoded = JSON.parse(c.bytes);
  assert.deepEqual(decoded.environment, environment);
  assert.deepEqual(decoded.networkPolicy, c.request.focusedTest.networkPolicy);
  assert.equal(c.effect.payloadBytes, c.bytes.length);
  assert.equal(c.effect.payloadDigest, sha(c.bytes));
});
for (const [label, mutate, fragment] of [
  ['port zero', p => p.endpoint.port = 0, 'invalid-port'],
  ['privileged port', p => p.endpoint.port = 1023, 'invalid-port'],
  ['port overflow', p => p.endpoint.port = 65536, 'invalid-port'],
  ['port text', p => p.endpoint.port = '18080', 'invalid-port'],
  ['wildcard', p => p.endpoint.address = '0.0.0.0', 'unsupported-endpoint'],
  ['alias', p => p.endpoint.address = 'localhost', 'unsupported-endpoint'],
  ['mapped ipv4', p => p.endpoint.address = '::ffff:127.0.0.1', 'unsupported-endpoint'],
  ['udp', p => p.endpoint.transport = 'udp', 'unsupported-endpoint'],
  ['wrong arch', p => p.architecture = 'arm64', 'unsupported-architecture'],
  ['lower abi', p => p.minimumLandlockAbi = 3, 'invalid-minimumLandlockAbi'],
  ['unknown policy key', p => p.allowEgress = true, 'unknown-allowEgress'],
  ['changed nft port', p => p.endpoint.port = 18081, 'nft-rules-digest-mismatch'],
  ['changed seccomp', p => p.seccompProgramDigest = sha(Buffer.from('different-filter')), 'seccomp-program-digest-mismatch'],
  ['tool path alias', p => p.artifacts.ip.canonicalPath = '/usr/sbin/ip', 'setup-tool-path-mismatch'],
  ['path traversal', p => p.artifacts.oracle.canonicalPath = '/trusted/x/../oracle.mjs', 'invalid-canonicalPath'],
  ['invalid unicode path', p => p.artifacts.oracle.canonicalPath = '/trusted/\ud800.mjs', 'invalid-canonicalPath'],
  ['noncanonical inode', p => p.artifacts.oracle.inode = '001', 'invalid-inode'],
  ['uint64 overflow', p => p.artifacts.oracle.inode = '18446744073709551616', 'invalid-inode'],
  ['raw FD authority', p => p.artifacts.oracle.fd = 5, 'unknown-fd'],
]) test(`policy rejects ${label}`, () => { const p = policy(); mutate(p); invalid(execution.validateM2PrivateHttpNetworkPolicy(p), fragment); });
test('endpoint boundary values have corresponding exact nft policies', () => {
  for (const port of [1024, 65535]) {
    const p = policy(); p.endpoint.port = port; p.nftRulesDigest = execution.computeM2PrivateHttpNftRulesDigest(port);
    valid(execution.validateM2PrivateHttpNetworkPolicy(p));
  }
});
for (const key of ['bytes', 'digest', 'device', 'inode']) test(`artifact ${key} tamper changes full request/plan digests and invalidates approval`, () => {
  const c = chain(); const oldReqDigest = execution.computeM2ProjectChangeRequestDigest(c.request);
  const oldPlanDigest = lifecycle.computeM2LifecyclePlanSnapshotDigest(c.plan);
  const ref = c.request.focusedTest.networkPolicy.artifacts.oracle;
  ref[key] = key === 'bytes' ? ref[key] + 1 : key === 'digest' ? sha(Buffer.from('new-oracle')) : '9999';
  c.request.focusedTest.networkPolicyDigest = execution.computeM2PrivateHttpNetworkPolicyDigest(c.request.focusedTest.networkPolicy);
  assert.notEqual(execution.computeM2ProjectChangeRequestDigest(c.request), oldReqDigest);
  invalid(execution.validateM2PrivateHttpProcessEffectForRequest(c.request, c.effect, c.bytes, environment), 'payload-bytes-mismatch');
  invalid(lifecycle.validateM2LifecyclePlanSnapshotForRequest(c.request, c.plan));
  c.plan.focusedTest.networkPolicy = clone(c.request.focusedTest.networkPolicy);
  c.plan.focusedTest.networkPolicyDigest = c.request.focusedTest.networkPolicyDigest;
  assert.notEqual(lifecycle.computeM2LifecyclePlanSnapshotDigest(c.plan), oldPlanDigest);
  invalid(lifecycle.validateM2LifecycleApprovalIntentForPlan(c.plan, c.approval));
});
test('explicitly recaptured policy changes process EffectRequest and authoritySetDigest', () => {
  const c = chain(); const old = c.request.authoritySetDigest;
  c.request.focusedTest.networkPolicy.artifacts.oracle.inode = '9999';
  c.request.focusedTest.networkPolicyDigest = execution.computeM2PrivateHttpNetworkPolicyDigest(c.request.focusedTest.networkPolicy);
  const bytes = execution.encodeM2PrivateHttpProcessPayload(c.request.focusedTest, environment);
  const effect = { ...c.effect, payloadDigest: sha(bytes), payloadBytes: bytes.length };
  c.request.focusedTest.authority.requestDigest = computeEffectRequestDigest(effect);
  c.request.authoritySetDigest = execution.computeM2ProjectChangeAuthoritySetDigest(c.request);
  assert.notEqual(c.request.authoritySetDigest, old);
  valid(execution.validateM2PrivateHttpProcessEffectForRequest(c.request, effect, bytes, environment));
  invalid(lifecycle.validateM2LifecyclePlanSnapshotForRequest(c.request, c.plan));
});
test('missing policy, legacy profile and project-owned oracle fail closed', () => {
  const c = chain(); delete c.request.focusedTest.networkPolicy;
  invalid(execution.validateM2ProjectChangeRequest(c.request));
  const d = chain(); d.request.focusedTest.sandboxProfile = 'linux-bwrap-ro-v2';
  invalid(execution.validateM2ProjectChangeRequest(d.request));
  const e = chain(); e.request.focusedTest.networkPolicy.artifacts.oracle.canonicalPath = '/workspace/project/oracle.mjs';
  e.request.focusedTest.argv[0] = '/workspace/project/oracle.mjs';
  e.request.focusedTest.argvDigest = execution.computeM2ExecutionValueDigest(e.request.focusedTest.argv);
  e.request.focusedTest.networkPolicyDigest = execution.computeM2PrivateHttpNetworkPolicyDigest(e.request.focusedTest.networkPolicy);
  invalid(execution.validateM2ProjectChangeRequest(e.request), 'trusted-artifact-inside-project');
});
test('mixed request/result and request/plan V1↔V2 and unknown versions fail closed', () => {
  const c = chain(), old = evidence();
  invalid(execution.validateM2ProjectChangeResultForRequest(c.request, old.result), 'mixed');
  invalid(execution.validateM2ProjectChangeResultForRequest(old.request, c.result), 'mixed');
  invalid(lifecycle.validateM2LifecyclePlanSnapshotForRequest(c.request, old.plan), 'mixed');
  invalid(lifecycle.validateM2LifecyclePlanSnapshotForRequest(old.request, c.plan), 'mixed');
  c.request.version = 3; c.plan.version = 3;
  invalid(execution.validateM2ProjectChangeRequest(c.request), 'unsupported-version');
  invalid(lifecycle.validateM2LifecyclePlanSnapshot(c.plan), 'unsupported-version');
});
test('runtime profile/digest substitution and foreign process authority are denied', () => {
  const c = chain(); const changed = clone(environment); changed.LANG = 'C';
  invalid(execution.validateM2PrivateHttpProcessEffectForRequest(c.request, c.effect, c.bytes, changed), 'environment-digest-mismatch');
  const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(c.bytes), sandboxProfile: 'linux-bwrap-ro-v2' }));
  invalid(execution.validateM2PrivateHttpProcessEffectForRequest(c.request, c.effect, bytes, environment), 'payload-bytes-mismatch');
  const e = clone(c.effect); e.requiredCapability = 'project.process.other';
  invalid(execution.validateM2PrivateHttpProcessEffectForRequest(c.request, e, c.bytes, environment), 'effect-authority-mismatch');
  const r = clone(c.result); r.focusedTest.networkPolicyDigest = sha(Buffer.from('foreign-policy'));
  invalid(execution.validateM2ProjectChangeResultForRequest(c.request, r), 'network-policy-mismatch');
});
test('old approval, fabricated terminal, wrong result digest and decision cannot certify V2', () => {
  const c = chain(); invalid(lifecycle.validateM2LifecycleApprovalIntentForPlan(c.plan, evidence().approval));
  c.terminal.planDigest = sha(Buffer.from('fabricated-plan'));
  invalid(lifecycle.validateM2LifecycleTerminalSnapshotForExecution(c), 'execution-identity-mismatch');
  const d = chain(); d.result.focusedTest.stdoutDigest = sha(Buffer.from('different-result'));
  invalid(lifecycle.validateM2GovernanceReceiptForDecision(d.request, d.result, d.governanceDecision, d.governanceReceipt), 'result-identity-mismatch');
  const e = chain(); e.governanceDecision = evidence().governanceDecision;
  invalid(lifecycle.validateM2LifecyclePlanSnapshotForDecision(e.request, e.governanceDecision, e.plan), 'governance-decision-mismatch');
});
test('cancelled/not-started result still binds policy and refuses success certification', () => {
  const c = chain(); c.result.terminalStatus = 'cancelled'; c.result.errorCode = 'CANCELLED';
  c.result.changes = { ...c.result.changes, paths: [], afterRevision: null, diffDigest: null };
  c.result.focusedTest = { effectId: c.request.focusedTest.authority.effectId, terminalStatus: 'not_started',
    exitCode: null, signal: null, stdoutDigest: null, stderrDigest: null, outputTruncated: false,
    sandboxProfile: execution.M2_PRIVATE_HTTP_PROFILE, networkPolicyDigest: c.request.focusedTest.networkPolicyDigest };
  valid(execution.validateM2ProjectChangeResultForRequest(c.request, c.result));
  invalid(lifecycle.validateM2LifecycleTerminalSnapshotForExecution(c));
});
test('V2 codecs round-trip full bytes; noncanonical and malformed UTF8 are rejected', () => {
  const c = chain();
  for (const [dto, encode, decode] of [[c.request, execution.encodeM2ExecutionContract, execution.decodeM2ExecutionContract],
    [c.result, execution.encodeM2ExecutionContract, execution.decodeM2ExecutionContract],
    [c.plan, lifecycle.encodeM2LifecycleContract, lifecycle.decodeM2LifecycleContract]]) {
    const bytes = encode(dto); assert.deepEqual(decode(bytes), dto);
    assert.throws(() => decode(Buffer.from(JSON.stringify(dto))), /canonical/);
    assert.throws(() => decode(Buffer.from([0xff])), /invalid-utf8/);
  }
});
summary();
