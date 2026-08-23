import assert from 'node:assert/strict';
import {
  M2_EFFECT_CONTRACT_KIND,
  M2_EFFECT_CONTRACT_STAGE,
  canonicalStringify,
  computeEffectArgvDigest,
  computeEffectRequestDigest,
  decodeM2EffectContract,
  encodeM2EffectContract,
  validateApprovalGrant,
  validateEffectRequest,
  validateEffectResult,
} from '../contracts/m2/effect-v1.js';
import { suite, test, summary } from './harness.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const CREATED = '2026-08-23T20:00:00.000Z';
const STARTED = '2026-08-23T20:00:01.000Z';
const COMPLETED = '2026-08-23T20:00:02.000Z';
const PAYLOAD_BYTES = 31;

function request(overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
    version: 1,
    effectId: 'effect-1',
    runId: 'run-1',
    parentEffectId: null,
    actor: { type: 'user', id: 'user-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    kind: 'fs.write',
    target: {
      type: 'filesystem',
      canonicalRoot: '/workspace/project',
      relativePath: 'src/app.js',
      resolvedRealpath: '/workspace/project/src/app.js',
    },
    payloadDigest: DIGEST_A,
    payloadBytes: PAYLOAD_BYTES,
    workspaceRevision: 'wsr1:revision-a',
    requiredCapability: 'project.fs.write',
    riskClass: 'write',
    timeoutMs: 120_000,
    idempotencyKey: 'write-app-1',
    approvalGrantId: null,
    createdAt: CREATED,
  };
  return { ...base, ...overrides };
}

function grant(overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.APPROVAL_GRANT,
    version: 1,
    grantId: 'grant-1',
    subject: { actorType: 'user', actorId: 'user-1' },
    scope: {
      runId: 'run-1',
      projectId: 17,
      effectId: 'effect-1',
      kind: 'fs.write',
      payloadDigest: DIGEST_A,
      payloadBytes: PAYLOAD_BYTES,
      workspaceRevision: 'wsr1:revision-a',
    },
    constraints: {
      allowedRealpaths: ['/workspace/project/src/app.js'],
      allowedBinary: null,
      allowedArgvDigest: null,
      allowedOrigin: null,
      maxBytes: PAYLOAD_BYTES,
    },
    issuedAt: CREATED,
    expiresAt: '2026-08-23T20:05:00.000Z',
    singleUse: true,
    nonce: 'nonce-000000000001',
    consumedAt: null,
    consumedByEffectId: null,
    revokedAt: null,
    revocationReason: null,
  };
  return { ...base, ...overrides };
}

function result(overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
    version: 1,
    effectId: 'effect-1',
    runId: 'run-1',
    projectId: 17,
    requestDigest: computeEffectRequestDigest(request()),
    approvalGrantId: 'grant-1',
    terminalStatus: 'succeeded',
    startedAt: STARTED,
    completedAt: COMPLETED,
    process: {
      pid: null,
      processGroupId: null,
      startIdentity: null,
      exitCode: null,
      signal: null,
    },
    changes: {
      paths: ['src/app.js'],
      beforeDigest: DIGEST_A,
      afterDigest: DIGEST_B,
      diffArtifact: 'artifact:diff-1',
    },
    network: {
      resolvedAddresses: [],
      finalUrl: null,
      status: null,
      bytes: 0,
    },
    rollback: {
      required: false,
      status: 'not_required',
      evidenceRef: null,
    },
    outputDigest: DIGEST_B,
    errorCode: null,
    evidenceRefs: ['artifact:diff-1'],
    lateCompletionRejected: false,
  };
  return { ...base, ...overrides };
}

suite('M2 EffectRequest/Result and ApprovalGrant executable contract');

test('contract remains CANDIDATE_V1 until independent review', () => {
  assert.equal(M2_EFFECT_CONTRACT_STAGE, 'CANDIDATE_V1');
});

test('valid request has a canonical byte-stable encoding and round-trip', () => {
  const value = request();
  assert.equal(validateEffectRequest(value).valid, true);
  const encoded = encodeM2EffectContract(value, M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST);
  assert.equal(encoded, canonicalStringify({ ...value }));
  assert.deepEqual(decodeM2EffectContract(encoded), value);
  assert(encoded.indexOf('"actor"') < encoded.indexOf('"approvalGrantId"'));
});

test('request rejects unknown fields and a false risk class', () => {
  const value = request({ extra: true, riskClass: 'read' });
  const checked = validateEffectRequest(value);
  assert.equal(checked.valid, false);
  assert(checked.errors.includes('effect-request:unknown-extra'));
  assert(checked.errors.includes('effect-request:risk-kind-mismatch'));
});

test('filesystem target rejects traversal, outside target and canonical alias mismatch', () => {
  const traversal = request({
    target: { ...request().target, relativePath: '../outside.js', resolvedRealpath: '/workspace/outside.js' },
  });
  const traversalErrors = validateEffectRequest(traversal).errors;
  assert(traversalErrors.includes('effect-request.target:invalid-relativePath'));
  assert(traversalErrors.includes('effect-request.target:outside-project'));

  const alias = request({
    target: { ...request().target, resolvedRealpath: '/workspace/project/releases/app.js' },
  });
  assert(validateEffectRequest(alias).errors.includes('effect-request.target:canonical-target-mismatch'));
});

test('request rejects a target discriminant that does not match its effect kind', () => {
  const value = request({
    kind: 'process.exec',
    riskClass: 'exec',
  });
  assert.equal(validateEffectRequest(value).valid, false);
  assert(validateEffectRequest(value).errors.includes('effect-request.target:invalid-type'));
});

test('process target requires an absolute binary and argv array', () => {
  const value = request({
    kind: 'process.exec',
    riskClass: 'exec',
    target: {
      type: 'process',
      binary: 'node',
      argv: 'script.js',
      argvDigest: DIGEST_A,
      canonicalCwd: '/workspace/project',
    },
  });
  const errors = validateEffectRequest(value).errors;
  assert(errors.includes('effect-request.target:invalid-binary'));
  assert(errors.includes('effect-request.target:invalid-argv'));
});

test('process argv digest is derived from exact ordered argv bytes', () => {
  const argv = ['node', 'script.js', '--mode=test'];
  const value = request({
    kind: 'process.exec',
    riskClass: 'exec',
    target: {
      type: 'process',
      binary: '/usr/bin/node',
      argv,
      argvDigest: computeEffectArgvDigest(argv),
      canonicalCwd: '/workspace/project',
    },
  });
  assert.equal(validateEffectRequest(value).valid, true);
  value.target.argv = [...argv, '--drift'];
  assert(validateEffectRequest(value).errors.includes('effect-request.target:argvDigest-mismatch'));
});

test('network target rejects credentialed and non-normalized URLs', () => {
  const value = request({
    kind: 'network.request',
    riskClass: 'network',
    target: {
      type: 'network',
      url: 'https://user:pass@example.com',
      origin: 'https://example.com',
      method: 'GET',
      redirectPolicy: 'revalidate',
      dnsPolicy: 'public-only',
    },
  });
  const errors = validateEffectRequest(value).errors;
  assert(errors.includes('effect-request.target:credentialed-url'));
  assert(errors.includes('effect-request.target:url-not-normalized'));
});

test('git target requires exact revision and bytewise-sorted unique paths', () => {
  const value = request({
    kind: 'git.commit',
    riskClass: 'write',
    target: {
      type: 'git',
      canonicalRepo: '/workspace/project',
      paths: ['src/z.js', 'src/a.js'],
      expectedWorkspaceRevision: 'wsr1:stale',
      remote: null,
    },
  });
  const errors = validateEffectRequest(value).errors;
  assert(errors.includes('effect-request.target.paths:not-bytewise-sorted-unique'));
  assert(errors.includes('effect-request.target:workspace-revision-mismatch'));
});

test('request rejects non-canonical timestamps and malformed digests', () => {
  const checked = validateEffectRequest(request({
    payloadDigest: 'a'.repeat(64),
    createdAt: '2026-08-23T20:00:00Z',
  }));
  assert(checked.errors.includes('effect-request:invalid-payloadDigest'));
  assert(checked.errors.includes('effect-request:invalid-createdAt'));
});

test('request rejects a self-referential effect lineage', () => {
  const checked = validateEffectRequest(request({ parentEffectId: 'effect-1' }));
  assert(checked.errors.includes('effect-request:self-parent'));
});

test('fresh exact single-use grant is valid', () => {
  assert.equal(validateApprovalGrant(grant()).valid, true);
});

test('request digest excludes grant binding but covers payload byte count', () => {
  const original = request();
  assert.equal(
    computeEffectRequestDigest({ ...original, approvalGrantId: 'grant-1' }),
    computeEffectRequestDigest(original),
  );
  assert.notEqual(
    computeEffectRequestDigest({ ...original, payloadBytes: original.payloadBytes + 1 }),
    computeEffectRequestDigest(original),
  );
});

test('grant rejects partial or simultaneous consumed and revoked states', () => {
  const partial = validateApprovalGrant(grant({ consumedAt: COMPLETED }));
  assert(partial.errors.includes('approval-grant:invalid-consumedByEffectId'));
  assert(partial.errors.includes('approval-grant:partial-consumption'));

  const terminalConflict = validateApprovalGrant(grant({
    consumedAt: STARTED,
    consumedByEffectId: 'effect-1',
    revokedAt: COMPLETED,
    revocationReason: 'cancelled',
  }));
  assert(terminalConflict.errors.includes('approval-grant:consumed-and-revoked'));
});

test('grant rejects invalid expiry and non-single-use claims', () => {
  const checked = validateApprovalGrant(grant({ expiresAt: CREATED, singleUse: false }));
  assert(checked.errors.includes('approval-grant:invalid-expiry-order'));
  assert(checked.errors.includes('approval-grant:singleUse-required'));
});

test('grant rejects consumption at expiry and permits defensive revocation before issuance', () => {
  const consumed = validateApprovalGrant(grant({
    consumedAt: '2026-08-23T20:05:00.000Z',
    consumedByEffectId: 'effect-1',
  }));
  assert(consumed.errors.includes('approval-grant:invalid-consumption-time'));
  const revoked = validateApprovalGrant(grant({
    revokedAt: '2026-08-23T19:59:59.999Z',
    revocationReason: 'cancelled',
  }));
  assert.equal(revoked.valid, true);
});

test('successful EffectResult is valid and failure requires an error code', () => {
  assert.equal(validateEffectResult(result()).valid, true);
  const failure = validateEffectResult(result({ terminalStatus: 'failed', errorCode: null }));
  assert(failure.errors.includes('effect-result:missing-errorCode'));
});

test('every EffectResult requires exact approval and request authority identity', () => {
  const withoutApproval = validateEffectResult(result({ approvalGrantId: null }));
  assert(withoutApproval.errors.includes('effect-result:invalid-approvalGrantId'));
  assert.equal(validateEffectResult(result({ projectId: '17' })).valid, false);
  assert.equal(validateEffectResult(result({ requestDigest: 'not-a-digest' })).valid, false);
});

test('EffectResult rejects time inversion and contradictory rollback state', () => {
  const checked = validateEffectResult(result({
    startedAt: COMPLETED,
    completedAt: STARTED,
    rollback: { required: false, status: 'failed', evidenceRef: null },
  }));
  assert(checked.errors.includes('effect-result:time-order'));
  assert(checked.errors.includes('effect-result.rollback:unexpected-status'));
});

test('EffectResult network evidence rejects credentials and non-IP addresses', () => {
  const checked = validateEffectResult(result({
    network: {
      resolvedAddresses: ['not-an-ip'],
      finalUrl: 'https://user:secret@example.com/',
      status: 200,
      bytes: 1,
    },
  }));
  assert(checked.errors.includes('effect-result.network.resolvedAddresses[0]:invalid'));
  assert(checked.errors.includes('effect-result.network:credentialed-finalUrl'));
});

summary();
