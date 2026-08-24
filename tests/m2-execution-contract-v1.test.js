#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, summary } from './harness.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
  M2_EXECUTION_CONTRACT_STAGE,
  M2_EXECUTION_CONTRACT_VERSION,
  M2_EXECUTION_LIMITS,
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeAuthoritySetDigest,
  computeM2ProjectChangePatchSetDigest,
  computeM2ProjectChangeRequestDigest,
  decodeM2ExecutionContract,
  deriveM2ProjectChangeAuthoritySet,
  encodeM2ExecutionContract,
  normalizeM2ExecutionValue,
  validateM2ExecutionContract,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResult,
  validateM2ProjectChangeResultForRequest,
} from '../contracts/m2/execution-v1.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;
const DIGEST_D = `sha256:${'d'.repeat(64)}`;
const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const AFTER_REVISION = `wsr1:${'2'.repeat(64)}`;
const BEFORE_HEAD = '3'.repeat(40);
const AFTER_HEAD = '4'.repeat(40);

function clone(value) {
  return structuredClone(value);
}

function authority(effectId, requestDigest) {
  return { effectId, requestDigest };
}

function change(overrides = {}) {
  return {
    path: 'src/app.js',
    before: { exists: true, digest: DIGEST_A, bytes: 21, mode: 0o644 },
    after: { digest: DIGEST_B, bytes: 34, mode: 0o644 },
    forwardAuthority: authority('effect-forward-app', DIGEST_A),
    rollbackAuthority: authority('effect-rollback-app', DIGEST_B),
    ...overrides,
  };
}

function request(overrides = {}) {
  const changes = overrides.changes ?? [
    change(),
    change({
      path: 'src/new.js',
      before: { exists: false, digest: null, bytes: 0, mode: null },
      after: { digest: DIGEST_C, bytes: 17, mode: 0o644 },
      forwardAuthority: authority('effect-forward-new', DIGEST_C),
      rollbackAuthority: authority('effect-rollback-new', DIGEST_D),
    }),
  ];
  const value = {
    contract: M2_EXECUTION_CONTRACT_KIND.REQUEST,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: 'execution-1',
    runId: 'run-1',
    actor: { type: 'user', id: 'operator-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    project: {
      projectId: 17,
      canonicalRoot: '/workspace/project',
      workspaceRevision: BEFORE_REVISION,
      gitHead: BEFORE_HEAD,
      gitBranchRef: 'refs/heads/codex/m2-execution',
      foreignDirtDigest: DIGEST_A,
    },
    patchSetDigest: DIGEST_A,
    changes,
    focusedTest: {
      authority: authority('effect-focused-test', DIGEST_B),
      binary: '/usr/bin/node',
      argv: ['--test', 'tests/focused.test.js'],
      argvDigest: DIGEST_A,
      canonicalCwd: '/workspace/project',
      environmentDigest: DIGEST_C,
      timeoutMs: 120_000,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v2',
    },
    gitCommit: {
      authority: authority('effect-git-commit', DIGEST_D),
      expectedHead: BEFORE_HEAD,
      branchRef: 'refs/heads/codex/m2-execution',
      paths: changes.map(item => item.path),
      messageDigest: DIGEST_A,
      identityDigest: DIGEST_B,
    },
    authoritySetDigest: DIGEST_A,
    createdAt: '2026-08-24T09:00:00.000Z',
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
    startedAt: '2026-08-24T09:00:01.000Z',
    completedAt: '2026-08-24T09:00:02.000Z',
    changes: {
      paths: boundRequest.changes.map(item => item.path),
      beforeRevision: boundRequest.project.workspaceRevision,
      afterRevision: AFTER_REVISION,
      diffDigest: DIGEST_D,
    },
    focusedTest: {
      effectId: boundRequest.focusedTest.authority.effectId,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: DIGEST_A,
      stderrDigest: DIGEST_B,
      outputTruncated: false,
    },
    git: boundRequest.gitCommit === null ? {
      status: 'not_requested',
      beforeHead: boundRequest.project.gitHead,
      afterHead: boundRequest.project.gitHead,
      commitId: null,
      foreignDirtPreserved: true,
    } : {
      status: 'committed',
      beforeHead: boundRequest.project.gitHead,
      afterHead: AFTER_HEAD,
      commitId: AFTER_HEAD,
      foreignDirtPreserved: true,
    },
    rollback: {
      required: false,
      status: 'not_required',
      paths: [],
      evidenceRef: null,
    },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function recomputeRequest(value) {
  value.patchSetDigest = computeM2ProjectChangePatchSetDigest(value.changes);
  if (Array.isArray(value.focusedTest?.argv)) {
    value.focusedTest.argvDigest = computeM2ExecutionValueDigest(value.focusedTest.argv);
  }
  value.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(value);
  return value;
}

suite('M2 ProjectChange v1 — canonical positive forms');

test('contract remains CANDIDATE_V1 and publishes hard file-set bounds', () => {
  assert.equal(M2_EXECUTION_CONTRACT_STAGE, 'CANDIDATE_V1');
  assert.deepEqual(M2_EXECUTION_LIMITS, {
    MAX_CHANGES: 32,
    MAX_FILE_BYTES: 1_048_576,
    MAX_TOTAL_AFTER_BYTES: 8_388_608,
    MAX_WIRE_BYTES: 8_388_608,
  });
});

test('valid request binds exact patch, rollback, focused-test and Git authorities', () => {
  const value = request();
  const checked = validateM2ProjectChangeRequest(value);
  assert.equal(checked.valid, true, checked.errors.join(', '));
  assert.equal(validateM2ExecutionContract(value).valid, true);
  assert.match(computeM2ProjectChangeRequestDigest(value), /^sha256:[0-9a-f]{64}$/);
});

test('authority set derives one forward and rollback role per path plus test and Git', () => {
  const value = request();
  assert.deepEqual(deriveM2ProjectChangeAuthoritySet(value), [
    { role: 'change.forward', path: 'src/app.js', kind: 'fs.write', effectId: 'effect-forward-app', requestDigest: DIGEST_A },
    { role: 'change.rollback', path: 'src/app.js', kind: 'fs.write', effectId: 'effect-rollback-app', requestDigest: DIGEST_B },
    { role: 'change.forward', path: 'src/new.js', kind: 'fs.write', effectId: 'effect-forward-new', requestDigest: DIGEST_C },
    { role: 'change.rollback', path: 'src/new.js', kind: 'fs.delete', effectId: 'effect-rollback-new', requestDigest: DIGEST_D },
    { role: 'focused-test', path: null, kind: 'process.exec', effectId: 'effect-focused-test', requestDigest: DIGEST_B },
    { role: 'git-commit', path: null, kind: 'git.commit', effectId: 'effect-git-commit', requestDigest: DIGEST_D },
  ]);
  assert.equal(value.authoritySetDigest, computeM2ProjectChangeAuthoritySetDigest(value));
});

test('successful result is valid only against its exact request', () => {
  const boundRequest = request();
  const value = result(boundRequest);
  assert.equal(validateM2ProjectChangeResult(value).valid, true);
  const checked = validateM2ProjectChangeResultForRequest(boundRequest, value);
  assert.equal(checked.valid, true, checked.errors.join(', '));
});

test('request without Git requires explicit not-requested head-preservation evidence', () => {
  const boundRequest = request({ gitCommit: null });
  const value = result(boundRequest);
  assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, value).valid, true);
});

test('canonical encoding is key-order independent, NFC-normalized and round-trips', () => {
  assert.equal(
    canonicalizeM2ExecutionValue({ z: 'Pr\u030ci\u0301lis\u030c', a: 1 }),
    canonicalizeM2ExecutionValue({ a: 1, z: 'Příliš' }),
  );
  assert.deepEqual(normalizeM2ExecutionValue({ label: 'Cafe\u0301' }), { label: 'Café' });
  assert.throws(
    () => normalizeM2ExecutionValue({ 'e\u0301': 1, 'é': 2 }),
    /normalized-key-collision/,
  );
  const value = request();
  const encoded = encodeM2ExecutionContract(value, M2_EXECUTION_CONTRACT_KIND.REQUEST);
  assert.deepEqual(decodeM2ExecutionContract(encoded), value);
});

suite('M2 ProjectChange v1 — fail-closed request negatives');

test('wire objects are closed and reject unknown fields', () => {
  const extraTop = { ...request(), allowUnsandboxed: true };
  const extraNested = request();
  extraNested.changes[0].after.content = 'not allowed on wire';
  assert(validateM2ProjectChangeRequest(extraTop).errors.includes('project-change-request:unknown-allowUnsandboxed'));
  assert(validateM2ProjectChangeRequest(extraNested).errors.includes('project-change-request.changes[0].after:unknown-content'));
});

test('validators return diagnostics rather than throwing on malformed nested shapes', () => {
  for (const malformed of [
    null,
    {},
    { changes: [null] },
    { changes: [], focusedTest: { argv: [] }, gitCommit: null },
  ]) {
    assert.doesNotThrow(() => validateM2ProjectChangeRequest(malformed));
    assert.equal(validateM2ProjectChangeRequest(malformed).valid, false);
  }
  for (const malformed of [
    null,
    {},
    { changes: null, focusedTest: null, git: null, rollback: null },
  ]) {
    assert.doesNotThrow(() => validateM2ProjectChangeResult(malformed));
    assert.equal(validateM2ProjectChangeResult(malformed).valid, false);
  }
});

test('changes must be bytewise sorted, unique, project-relative and NFC', () => {
  const unsorted = request();
  unsorted.changes.reverse();
  unsorted.gitCommit.paths = unsorted.changes.map(item => item.path);
  recomputeRequest(unsorted);
  assert(validateM2ProjectChangeRequest(unsorted).errors.includes('project-change-request.changes.paths:not-bytewise-sorted-unique'));

  const duplicate = request();
  duplicate.changes[1].path = duplicate.changes[0].path;
  duplicate.gitCommit.paths = duplicate.changes.map(item => item.path);
  recomputeRequest(duplicate);
  assert(validateM2ProjectChangeRequest(duplicate).errors.includes('project-change-request.changes.paths:not-bytewise-sorted-unique'));

  for (const invalidPath of ['../outside.js', '/absolute.js', 'src\\windows.js', 'src/Cafe\u0301.js']) {
    const invalid = request({ changes: [change({ path: invalidPath })] });
    assert.equal(validateM2ProjectChangeRequest(invalid).valid, false, invalidPath);
  }
});

test('change count, per-file bytes and aggregate after bytes are bounded', () => {
  const tooMany = Array.from({ length: 33 }, (_, index) => change({
    path: `src/${String(index).padStart(2, '0')}.js`,
    forwardAuthority: authority(`forward-${index}`, DIGEST_A),
    rollbackAuthority: authority(`rollback-${index}`, DIGEST_B),
  }));
  assert(validateM2ProjectChangeRequest(request({ changes: tooMany })).errors.includes('project-change-request:invalid-change-count'));

  const tooLarge = request();
  tooLarge.changes[0].after.bytes = M2_EXECUTION_LIMITS.MAX_FILE_BYTES + 1;
  recomputeRequest(tooLarge);
  assert(validateM2ProjectChangeRequest(tooLarge).errors.includes('project-change-request.changes[0].after:invalid-bytes'));

  const aggregate = Array.from({ length: 9 }, (_, index) => change({
    path: `src/${index}.bin`,
    after: { digest: DIGEST_C, bytes: M2_EXECUTION_LIMITS.MAX_FILE_BYTES, mode: 0o644 },
    forwardAuthority: authority(`aggregate-forward-${index}`, DIGEST_A),
    rollbackAuthority: authority(`aggregate-rollback-${index}`, DIGEST_B),
  }));
  assert(validateM2ProjectChangeRequest(request({ changes: aggregate })).errors.includes('project-change-request:after-bytes-exceed-total-limit'));
});

test('before image, mode preservation and no-op semantics are enforced', () => {
  const absentWithDigest = request();
  absentWithDigest.changes[1].before.digest = DIGEST_A;
  recomputeRequest(absentWithDigest);
  assert(validateM2ProjectChangeRequest(absentWithDigest).errors.includes('project-change-request.changes[1].before:digest-on-absent'));

  const modeDrift = request();
  modeDrift.changes[0].after.mode = 0o755;
  recomputeRequest(modeDrift);
  assert(validateM2ProjectChangeRequest(modeDrift).errors.includes('project-change-request.changes[0]:mode-not-preserved'));

  const noOp = request();
  noOp.changes[0].after = { digest: DIGEST_A, bytes: 21, mode: 0o644 };
  recomputeRequest(noOp);
  assert(validateM2ProjectChangeRequest(noOp).errors.includes('project-change-request.changes[0]:no-op-change'));
});

test('patch-set digest must bind the exact ordered before/after descriptors', () => {
  const mutated = request();
  mutated.changes[0].after.digest = DIGEST_D;
  assert(validateM2ProjectChangeRequest(mutated).errors.includes('project-change-request:patchSetDigest-mismatch'));
});

test('focused test is mandatory, argv-only, digest-bound and fail-closed sandboxed', () => {
  const missing = request();
  delete missing.focusedTest;
  assert.equal(validateM2ProjectChangeRequest(missing).valid, false);

  const shell = request();
  shell.focusedTest.binary = 'npm test && curl example.com';
  shell.focusedTest.argv = 'npm test';
  assert.equal(validateM2ProjectChangeRequest(shell).valid, false);

  const driftedArgv = request();
  driftedArgv.focusedTest.argv.push('--changed');
  driftedArgv.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(driftedArgv);
  assert(validateM2ProjectChangeRequest(driftedArgv).errors.includes('project-change-request.focusedTest:argvDigest-mismatch'));

  const fallback = request();
  fallback.focusedTest.sandboxProfile = 'plain-spawn';
  assert(validateM2ProjectChangeRequest(fallback).errors.includes('project-change-request.focusedTest:invalid-sandboxProfile'));
});

test('every change needs distinct forward and rollback authority plus exact set digest', () => {
  const missingRollback = request();
  delete missingRollback.changes[0].rollbackAuthority;
  assert.equal(validateM2ProjectChangeRequest(missingRollback).valid, false);

  const reused = request();
  reused.changes[0].rollbackAuthority = clone(reused.changes[0].forwardAuthority);
  recomputeRequest(reused);
  assert(validateM2ProjectChangeRequest(reused).errors.includes('project-change-request.changes[0]:authority-reused'));
  assert(validateM2ProjectChangeRequest(reused).errors.includes('project-change-request:authority-effect-reused'));

  const missingTestAuthority = request();
  delete missingTestAuthority.focusedTest.authority.requestDigest;
  assert.equal(validateM2ProjectChangeRequest(missingTestAuthority).valid, false);

  const staleSet = request();
  staleSet.changes[0].forwardAuthority.requestDigest = DIGEST_D;
  assert(validateM2ProjectChangeRequest(staleSet).errors.includes('project-change-request:authoritySetDigest-mismatch'));
});

test('Git authority must cover exactly all and only change paths', () => {
  const incomplete = request();
  incomplete.gitCommit.paths = ['src/app.js'];
  recomputeRequest(incomplete);
  assert(validateM2ProjectChangeRequest(incomplete).errors.includes('project-change-request:git-paths-incomplete'));
});

suite('M2 ProjectChange v1 — false-success and identity negatives');

test('success cannot report nonzero or nonterminal focused test evidence', () => {
  const boundRequest = request();
  const nonzero = result(boundRequest);
  nonzero.focusedTest = { ...nonzero.focusedTest, terminalStatus: 'failed', exitCode: 1 };
  assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, nonzero).valid, false);

  const notStarted = result(boundRequest);
  notStarted.focusedTest = {
    effectId: boundRequest.focusedTest.authority.effectId,
    terminalStatus: 'not_started',
    exitCode: null,
    signal: null,
    stdoutDigest: null,
    stderrDigest: null,
    outputTruncated: false,
  };
  assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, notStarted).valid, false);
});

test('success cannot coexist with pending or failed rollback', () => {
  const boundRequest = request();
  const pending = result(boundRequest, {
    rollback: { required: true, status: 'pending', paths: ['src/app.js'], evidenceRef: null },
  });
  assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, pending).valid, false);

  const failed = result(boundRequest, {
    rollback: { required: true, status: 'failed', paths: ['src/app.js'], evidenceRef: 'artifact:rollback' },
  });
  assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, failed).valid, false);
});

test('success cannot hide Git failure, foreign dirt loss or a missing required commit', () => {
  const boundRequest = request();
  for (const git of [
    { ...result(boundRequest).git, status: 'failed' },
    { ...result(boundRequest).git, foreignDirtPreserved: false },
    {
      status: 'not_requested',
      beforeHead: BEFORE_HEAD,
      afterHead: BEFORE_HEAD,
      commitId: null,
      foreignDirtPreserved: true,
    },
  ]) {
    assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, result(boundRequest, { git })).valid, false);
  }
});

test('success must cover every requested path and advance the workspace revision', () => {
  const boundRequest = request();
  const partial = result(boundRequest);
  partial.changes.paths = ['src/app.js'];
  assert(validateM2ProjectChangeResultForRequest(boundRequest, partial).errors.includes('project-change-result:success-paths-incomplete'));

  const unchanged = result(boundRequest);
  unchanged.changes.afterRevision = unchanged.changes.beforeRevision;
  assert(validateM2ProjectChangeResultForRequest(boundRequest, unchanged).errors.includes('project-change-result:success-revision-unchanged'));
});

test('result is bound to exact request identity, revision, test effect and target paths', () => {
  const boundRequest = request();
  const wrongIdentity = result(boundRequest, { executionId: 'execution-other' });
  assert(validateM2ProjectChangeResultForRequest(boundRequest, wrongIdentity).errors.includes('project-change-result:request-identity-mismatch'));

  const wrongRevision = result(boundRequest);
  wrongRevision.changes.beforeRevision = AFTER_REVISION;
  assert(validateM2ProjectChangeResultForRequest(boundRequest, wrongRevision).errors.includes('project-change-result:before-revision-mismatch'));

  const wrongTest = result(boundRequest);
  wrongTest.focusedTest.effectId = 'effect-other-test';
  assert(validateM2ProjectChangeResultForRequest(boundRequest, wrongTest).errors.includes('project-change-result:focused-test-effect-mismatch'));

  const foreignPath = result(boundRequest);
  foreignPath.changes.paths = ['outside.js'];
  assert(validateM2ProjectChangeResultForRequest(boundRequest, foreignPath).errors.includes('project-change-result:foreign-change-path'));
});

test('non-success requires an error and a terminal rollback disposition', () => {
  const boundRequest = request();
  const missingError = result(boundRequest, { terminalStatus: 'failed' });
  assert(validateM2ProjectChangeResult(missingError).errors.includes('project-change-result:missing-errorCode'));

  const honestFailure = result(boundRequest, {
    terminalStatus: 'failed',
    focusedTest: {
      effectId: boundRequest.focusedTest.authority.effectId,
      terminalStatus: 'failed',
      exitCode: 1,
      signal: null,
      stdoutDigest: DIGEST_A,
      stderrDigest: DIGEST_B,
      outputTruncated: false,
    },
    git: {
      status: 'failed',
      beforeHead: BEFORE_HEAD,
      afterHead: BEFORE_HEAD,
      commitId: null,
      foreignDirtPreserved: true,
    },
    rollback: {
      required: true,
      status: 'succeeded',
      paths: ['src/app.js', 'src/new.js'],
      evidenceRef: 'artifact:rollback',
    },
    errorCode: 'FOCUSED_TEST_FAILED',
  });
  assert.equal(validateM2ProjectChangeResultForRequest(boundRequest, honestFailure).valid, true);
});

test('decoder rejects invalid UTF-8, oversize input and a wrong expected contract', () => {
  assert.throws(() => decodeM2ExecutionContract(Buffer.from([0xff])), /invalid-utf8/);
  assert.throws(
    () => decodeM2ExecutionContract(Buffer.alloc(M2_EXECUTION_LIMITS.MAX_WIRE_BYTES + 1, 0x20)),
    /invalid-size/,
  );
  assert.throws(
    () => decodeM2ExecutionContract(
      encodeM2ExecutionContract(request()),
      M2_EXECUTION_CONTRACT_KIND.RESULT,
    ),
    /unexpected-contract/,
  );
  assert.throws(
    () => decodeM2ExecutionContract(JSON.stringify(request())),
    /non-canonical-encoding/,
  );
});

summary();
