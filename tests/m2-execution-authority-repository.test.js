#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
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
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import {
  EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT,
  computeM2ExecutionSchemaFingerprint,
  up as applyExecutionAuthority,
} from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';
import {
  ExecutionAuthorityError,
  ExecutionAuthorityErrorCode,
  ExecutionAuthorityRepository,
} from '../src/execution/execution-authority-repository.js';
import { suite, test, summary } from './harness.js';

const CREATED_MS = Date.parse('2026-08-24T05:00:00.000Z');
const CLAIM_MS = CREATED_MS + 10_000;
const ROOT = '/workspace/project';
const REVISION = `wsr1:${'a'.repeat(64)}`;
const AFTER_REVISION = `wsr1:${'b'.repeat(64)}`;
const DIGEST_EMPTY = sha(Buffer.alloc(0));
const OWNER_ONE = Object.freeze({
  ownerId: 'owner:one',
  pid: 4101,
  bootId: '11111111-1111-4111-8111-111111111111',
  startIdentity: '101',
});
const OWNER_TWO = Object.freeze({
  ownerId: 'owner:two',
  pid: 4102,
  bootId: '11111111-1111-4111-8111-111111111111',
  startIdentity: '102',
});

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function openDb(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  const installed = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_execution_requests'
  `).get();
  if (!installed) {
    applyEffectAuthority(db);
    applyEffectAuthorityHardening(db);
    applyEffectExecutionClaims(db);
    applyEffectClaimTruth(db);
    applyExecutionAuthority(db);
  }
  return db;
}

function effectRequest({
  effectId,
  kind,
  payload,
  relativePath = 'src/app.js',
  argv = ['--version'],
}) {
  const payloadBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '');
  const processEffect = kind === 'process.exec';
  return {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
    version: 1,
    effectId,
    runId: 'run-1',
    parentEffectId: null,
    actor: { type: 'user', id: 'user-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    kind,
    target: processEffect
      ? {
        type: 'process',
        binary: '/usr/bin/node',
        argv,
        argvDigest: computeEffectArgvDigest(argv),
        canonicalCwd: ROOT,
      }
      : {
        type: 'filesystem',
        canonicalRoot: ROOT,
        relativePath,
        resolvedRealpath: path.posix.join(ROOT, relativePath),
      },
    payloadDigest: sha(payloadBytes),
    payloadBytes: payloadBytes.length,
    workspaceRevision: REVISION,
    requiredCapability: processEffect ? 'project.process.exec' : `project.${kind}`,
    riskClass: processEffect ? 'exec' : kind === 'fs.delete' ? 'destructive' : 'write',
    timeoutMs: 30_000,
    idempotencyKey: `execution:${effectId}`,
    approvalGrantId: null,
    createdAt: new Date(CREATED_MS).toISOString(),
  };
}

function fixture({ git = false } = {}) {
  const before = Buffer.from('export const value = 1;\n');
  const after = Buffer.from('export const value = 2;\n');
  const forward = effectRequest({ effectId: 'effect-forward', kind: 'fs.write', payload: after });
  const rollback = effectRequest({ effectId: 'effect-rollback', kind: 'fs.write', payload: before });
  const focused = effectRequest({ effectId: 'effect-test', kind: 'process.exec', payload: '' });
  const gitMaterial = git ? {
    message: 'message',
    identity: {
      authorName: 'IntentSmith Runtime',
      authorEmail: 'runtime@example.invalid',
      authorDate: '2026-08-24T06:00:00Z',
      committerName: 'IntentSmith Runtime',
      committerEmail: 'runtime@example.invalid',
      committerDate: '2026-08-24T06:00:00Z',
    },
  } : null;
  const gitEffect = git ? {
    ...effectRequest({
      effectId: 'effect-git',
      kind: 'fs.write',
      payload: Buffer.from(JSON.stringify(gitMaterial), 'utf8'),
    }),
    kind: 'git.commit',
    target: {
      type: 'git',
      canonicalRepo: ROOT,
      paths: ['src/app.js'],
      expectedWorkspaceRevision: REVISION,
      remote: null,
    },
    requiredCapability: 'project.git.commit',
    riskClass: 'write',
  } : null;
  const effects = [forward, rollback, focused, ...(gitEffect ? [gitEffect] : [])];
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
    executionId: 'execution-1',
    runId: 'run-1',
    actor: { type: 'user', id: 'user-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    project: {
      projectId: 17,
      canonicalRoot: ROOT,
      workspaceRevision: REVISION,
      gitHead: 'a'.repeat(40),
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
      binary: '/usr/bin/node',
      argv: ['--version'],
      argvDigest: computeM2ExecutionValueDigest(['--version']),
      canonicalCwd: ROOT,
      environmentDigest: sha(Buffer.from('env')),
      timeoutMs: 30_000,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v2',
    },
    gitCommit: git ? {
      authority: {
        effectId: gitEffect.effectId,
        requestDigest: computeEffectRequestDigest(gitEffect),
      },
      expectedHead: 'a'.repeat(40),
      branchRef: 'refs/heads/main',
      paths: ['src/app.js'],
      messageDigest: computeM2ExecutionValueDigest(gitMaterial.message),
      identityDigest: computeM2ExecutionValueDigest(gitMaterial.identity),
    } : null,
    authoritySetDigest: null,
    createdAt: new Date(CREATED_MS).toISOString(),
  };
  request.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(request);
  return {
    request,
    effects,
    files: [{ path: 'src/app.js', beforeBytes: before, afterBytes: after }],
    git: gitMaterial,
  };
}

function registerFixture(db, input = fixture()) {
  const effectRepository = new EffectAuthorityRepository(db, { clock: () => CLAIM_MS });
  for (const effect of input.effects) effectRepository.registerEffectRequest(effect);
  const executionRepository = new ExecutionAuthorityRepository(db, { clock: () => CLAIM_MS });
  executionRepository.registerProjectChange(input.request, { files: input.files, git: input.git });
  return { effectRepository, executionRepository, ...input };
}

function approveAndConsume(effectRepository, effects) {
  let ordinal = 0;
  const issuer = createApprovalGrantIssuer(effectRepository, {
    clock: () => CLAIM_MS,
    grantIdFactory: () => `grant-${++ordinal}`,
    nonceFactory: () => `nonce-0000000000-${ordinal}`,
  });
  const issued = effects.map(effect => issuer.issue({
    effectId: effect.effectId,
    authenticatedSubject: { actorType: 'user', actorId: 'user-1' },
  }).grant);
  const items = effects.map((effect, index) => ({
    grantId: issued[index].grantId,
    request: { ...effect, approvalGrantId: issued[index].grantId },
  }));
  effectRepository.consumeApprovalGrantBatch({ items, executionOwner: OWNER_ONE });
  return issued.map(grant => grant.grantId)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function failureResult(request, overrides = {}) {
  return {
    contract: M2_EXECUTION_CONTRACT_KIND.RESULT,
    version: 1,
    executionId: request.executionId,
    requestDigest: computeM2ProjectChangeRequestDigest(request),
    runId: request.runId,
    projectId: request.project.projectId,
    terminalStatus: 'failed',
    fencingGeneration: 1,
    startedAt: new Date(CLAIM_MS).toISOString(),
    completedAt: new Date(CLAIM_MS + 1_000).toISOString(),
    changes: {
      paths: [],
      beforeRevision: request.project.workspaceRevision,
      afterRevision: null,
      diffDigest: null,
    },
    focusedTest: {
      effectId: request.focusedTest.authority.effectId,
      terminalStatus: 'not_started',
      exitCode: null,
      signal: null,
      stdoutDigest: null,
      stderrDigest: null,
      outputTruncated: false,
    },
    git: {
      status: 'not_requested',
      beforeHead: request.project.gitHead,
      afterHead: request.project.gitHead,
      commitId: null,
      foreignDirtPreserved: true,
    },
    rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
    errorCode: 'EXECUTION_PRECONDITION_FAILED',
    evidenceRefs: ['execution:test-failure'],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function successResult(request) {
  return {
    ...failureResult(request),
    terminalStatus: 'succeeded',
    changes: {
      paths: request.changes.map(change => change.path),
      beforeRevision: request.project.workspaceRevision,
      afterRevision: AFTER_REVISION,
      diffDigest: sha(Buffer.from('diff')),
    },
    focusedTest: {
      effectId: request.focusedTest.authority.effectId,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: DIGEST_EMPTY,
      stderrDigest: DIGEST_EMPTY,
      outputTruncated: false,
    },
    errorCode: null,
    evidenceRefs: ['execution:test-success'],
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof ExecutionAuthorityError && error.code === code);
}

suite('M2 durable project-change authority');

test('078 installs a pinned append-only execution schema', () => {
  const db = openDb();
  assert.equal(computeM2ExecutionSchemaFingerprint(db), EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT);
  const tables = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name GLOB 'm2_execution_*'
  `).get().count;
  const appendOnly = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE type = 'trigger' AND name GLOB 'trg_m2_execution_*_append_only_*'
  `).get().count;
  assert.equal(tables, 10);
  assert.equal(appendOnly, 20);
  db.close();
});

test('registers exact request bytes, child roles, and durable before images idempotently', () => {
  const db = openDb();
  const input = fixture();
  const { executionRepository } = registerFixture(db, input);
  assert.equal(executionRepository.registerProjectChange(input.request, { files: input.files }).created, false);
  assert.equal(executionRepository.getFileMaterial(input.request.executionId)[0].beforeBytes.toString(), 'export const value = 1;\n');
  assert.deepEqual(db.prepare(`
    SELECT role, effect_id AS effectId FROM m2_execution_steps
    WHERE execution_id = ? ORDER BY role
  `).all(input.request.executionId), [
    { role: 'focused_test', effectId: 'effect-test' },
    { role: 'forward', effectId: 'effect-forward' },
    { role: 'rollback', effectId: 'effect-rollback' },
  ]);
  db.close();
});

test('Git material retries are exact and a late Git-step failure rolls back the whole registration', () => {
  const db = openDb();
  const input = fixture({ git: true });
  const registered = registerFixture(db, input);
  assert.equal(registered.executionRepository.registerProjectChange(input.request, {
    files: input.files,
    git: input.git,
  }).created, false);
  expectCode(() => registered.executionRepository.registerProjectChange(input.request, {
    files: input.files,
    git: { ...input.git, message: 'different message' },
  }), ExecutionAuthorityErrorCode.INPUT_INVALID);
  assert.equal(db.prepare(`SELECT count(*) AS count FROM m2_execution_git_material`).get().count, 1);
  db.close();

  const rollbackDb = openDb();
  const rollbackInput = fixture({ git: true });
  const effectRepository = new EffectAuthorityRepository(rollbackDb, { clock: () => CLAIM_MS });
  for (const effect of rollbackInput.effects.filter(effect => effect.effectId !== 'effect-git')) {
    effectRepository.registerEffectRequest(effect);
  }
  const executionRepository = new ExecutionAuthorityRepository(rollbackDb, { clock: () => CLAIM_MS });
  assert.throws(() => executionRepository.registerProjectChange(rollbackInput.request, {
    files: rollbackInput.files,
    git: rollbackInput.git,
  }), error => error.code === ExecutionAuthorityErrorCode.STORAGE_FAILURE);
  for (const table of ['m2_execution_requests', 'm2_execution_files', 'm2_execution_git_material']) {
    assert.equal(rollbackDb.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  }
  rollbackDb.close();
});

test('a Git request without exact durable Git material is rejected before any registration', () => {
  const db = openDb();
  const input = fixture({ git: true });
  const effectRepository = new EffectAuthorityRepository(db, { clock: () => CLAIM_MS });
  for (const effect of input.effects) effectRepository.registerEffectRequest(effect);
  const executionRepository = new ExecutionAuthorityRepository(db, { clock: () => CLAIM_MS });
  expectCode(() => executionRepository.registerProjectChange(input.request, {
    files: input.files,
  }), ExecutionAuthorityErrorCode.INPUT_INVALID);
  assert.equal(db.prepare(`SELECT count(*) AS count FROM m2_execution_requests`).get().count, 0);
  db.close();
});

test('request identity cannot be replayed with different durable bytes', () => {
  const db = openDb();
  const input = fixture();
  const { executionRepository } = registerFixture(db, input);
  expectCode(() => executionRepository.registerProjectChange(input.request, {
    files: [{ ...input.files[0], beforeBytes: Buffer.from('wrong') }],
  }), ExecutionAuthorityErrorCode.INPUT_INVALID);
  db.close();
});

test('two SQLite connections have exactly one live claim winner', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-exec-claim-'));
  const filename = path.join(directory, 'authority.sqlite');
  const firstDb = openDb(filename);
  registerFixture(firstDb);
  const secondDb = openDb(filename);
  const first = new ExecutionAuthorityRepository(firstDb, { clock: () => CLAIM_MS });
  const second = new ExecutionAuthorityRepository(secondDb, { clock: () => CLAIM_MS });
  const liveness = { isProvablyDead: () => false };
  const outcomes = [
    () => first.acquireClaim({ executionId: 'execution-1', owner: OWNER_ONE, liveness }),
    () => second.acquireClaim({ executionId: 'execution-1', owner: OWNER_TWO, liveness }),
  ].map(operation => {
    try { return { ok: true, value: operation() }; } catch (error) { return { ok: false, error }; }
  });
  assert.equal(outcomes.filter(outcome => outcome.ok).length, 1);
  assert.equal(outcomes.filter(outcome => outcome.error?.code === ExecutionAuthorityErrorCode.CLAIM_BUSY).length, 1);
  firstDb.close();
  secondDb.close();
  rmSync(directory, { recursive: true, force: true });
});

test('takeover requires both an expired lease and proof the previous owner is dead', () => {
  const db = openDb();
  registerFixture(db);
  let now = CLAIM_MS;
  const repository = new ExecutionAuthorityRepository(db, { clock: () => now });
  repository.acquireClaim({ executionId: 'execution-1', owner: OWNER_ONE, leaseMs: 1_000, liveness: { isProvablyDead: () => false } });
  now += 1_001;
  expectCode(() => repository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_TWO, liveness: { isProvablyDead: () => false },
  }), ExecutionAuthorityErrorCode.CLAIM_LIVENESS_UNKNOWN);
  const takeover = repository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_TWO, liveness: { isProvablyDead: () => true },
  });
  assert.equal(takeover.generation, 2);
  assert.equal(takeover.ownerId, OWNER_TWO.ownerId);
  db.close();
});

test('SQL fencing rejects a premature next generation across original and renewed leases', () => {
  const db = openDb();
  registerFixture(db);
  let now = CLAIM_MS;
  const repository = new ExecutionAuthorityRepository(db, { clock: () => now });
  repository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_ONE, leaseMs: 1_000,
    liveness: { isProvablyDead: () => false },
  });
  const insertPremature = claimedAt => db.prepare(`
    INSERT INTO m2_execution_claims (
      execution_id, generation, owner_id, owner_pid, owner_boot_id,
      owner_start_identity, claimed_at_ms, lease_until_ms
    ) VALUES (?, 2, ?, ?, ?, ?, ?, ?)
  `).run(
    'execution-1', OWNER_TWO.ownerId, OWNER_TWO.pid, OWNER_TWO.bootId,
    OWNER_TWO.startIdentity, claimedAt, claimedAt + 1_000,
  );
  assert.throws(() => insertPremature(CLAIM_MS + 500), /M2_EXECUTION_CLAIM_FENCE_MISMATCH/);

  now = CLAIM_MS + 500;
  const renewed = repository.renewClaim({
    executionId: 'execution-1', generation: 1, ownerId: OWNER_ONE.ownerId, leaseMs: 5_000,
  });
  assert.equal(renewed.leaseUntilMs, CLAIM_MS + 5_500);
  assert.throws(() => insertPremature(CLAIM_MS + 1_500), /M2_EXECUTION_CLAIM_FENCE_MISMATCH/);
  assert.equal(db.prepare(`SELECT count(*) AS count FROM m2_execution_claims`).get().count, 1);
  db.close();
});

test('lease renewal can only extend a live effective lease and cannot resurrect expiry', () => {
  const db = openDb();
  registerFixture(db);
  let now = CLAIM_MS;
  const repository = new ExecutionAuthorityRepository(db, { clock: () => now });
  repository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_ONE, leaseMs: 300_000,
    liveness: { isProvablyDead: () => false },
  });
  now += 500;
  expectCode(() => repository.renewClaim({
    executionId: 'execution-1', generation: 1, ownerId: OWNER_ONE.ownerId, leaseMs: 1_000,
  }), ExecutionAuthorityErrorCode.STALE_FENCE);

  const insertRenewal = (renewedAt, leaseUntil) => db.prepare(`
    INSERT INTO m2_execution_claim_renewals (
      execution_id, generation, renewal_seq, renewed_at_ms, lease_until_ms
    ) VALUES ('execution-1', 1, 1, ?, ?)
  `).run(renewedAt, leaseUntil);
  assert.throws(
    () => insertRenewal(CLAIM_MS + 500, CLAIM_MS + 1_500),
    /M2_EXECUTION_CLAIM_RENEWAL_MISMATCH/,
  );
  assert.throws(
    () => insertRenewal(CLAIM_MS + 300_001, CLAIM_MS + 301_001),
    /M2_EXECUTION_CLAIM_RENEWAL_MISMATCH/,
  );
  assert.equal(db.prepare(`SELECT count(*) AS count FROM m2_execution_claim_renewals`).get().count, 0);
  assert.equal(repository.getLatestClaim('execution-1').leaseUntilMs, CLAIM_MS + 300_000);
  db.close();
});

test('stale fencing generation cannot append an event after takeover', () => {
  const db = openDb();
  registerFixture(db);
  let now = CLAIM_MS;
  const repository = new ExecutionAuthorityRepository(db, { clock: () => now });
  repository.acquireClaim({ executionId: 'execution-1', owner: OWNER_ONE, leaseMs: 1_000, liveness: { isProvablyDead: () => false } });
  now += 1_001;
  repository.acquireClaim({ executionId: 'execution-1', owner: OWNER_TWO, liveness: { isProvablyDead: () => true } });
  expectCode(() => repository.appendEvent({
    eventId: 'event-stale', executionId: 'execution-1', generation: 1,
    phase: 'write', type: 'phase_intent', details: {},
  }), ExecutionAuthorityErrorCode.STALE_FENCE);
  assert.equal(repository.listEvents('execution-1').length, 0);
  db.close();
});

test('outstanding process census closes only after durable termination evidence', () => {
  const db = openDb();
  const { executionRepository } = registerFixture(db);
  executionRepository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_ONE, liveness: { isProvablyDead: () => false },
  });
  executionRepository.recordProcess({
    executionId: 'execution-1',
    generation: 1,
    effectId: 'effect-test',
    supervisorPid: 8801,
    processGroupId: 8801,
    ownerBootId: OWNER_ONE.bootId,
    ownerStartIdentity: '5501',
  });
  assert.deepEqual(executionRepository.listOutstandingProcesses('execution-1'), [{
    executionId: 'execution-1',
    generation: 1,
    effectId: 'effect-test',
    supervisorPid: 8801,
    processGroupId: 8801,
    ownerBootId: OWNER_ONE.bootId,
    ownerStartIdentity: '5501',
    startedAtMs: CLAIM_MS,
  }]);
  executionRepository.appendEvent({
    eventId: 'event-process-terminated',
    executionId: 'execution-1',
    generation: 1,
    phase: 'focused_test',
    type: 'process_terminated',
    effectId: 'effect-test',
    details: { recovered: false },
  });
  assert.deepEqual(executionRepository.listOutstandingProcesses('execution-1'), []);
  db.close();
});

test('approval set is accepted only after every exact child grant is atomically consumed', () => {
  const db = openDb();
  const { effectRepository, executionRepository, effects } = registerFixture(db);
  executionRepository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_ONE, liveness: { isProvablyDead: () => false },
  });
  const grantIds = approveAndConsume(effectRepository, effects);
  assert.equal(executionRepository.recordApprovalSet({
    executionId: 'execution-1', generation: 1, grantIds,
  }).created, true);
  assert.equal(db.prepare(`
    SELECT json_array_length(grant_ids_json) AS count FROM m2_execution_approval_sets
    WHERE execution_id = 'execution-1'
  `).get().count, 3);
  db.close();
});

test('SQL terminal truth rejects a forged success without successful child results', () => {
  const db = openDb();
  const { effectRepository, executionRepository, effects, request } = registerFixture(db);
  executionRepository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_ONE, liveness: { isProvablyDead: () => false },
  });
  executionRepository.recordApprovalSet({
    executionId: 'execution-1',
    generation: 1,
    grantIds: approveAndConsume(effectRepository, effects),
  });
  const result = successResult(request);
  assert.throws(() => db.prepare(`
    INSERT INTO m2_execution_results (
      execution_id, request_digest, run_id, project_id, generation,
      terminal_status, result_json, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.executionId,
    result.requestDigest,
    result.runId,
    result.projectId,
    result.fencingGeneration,
    result.terminalStatus,
    JSON.stringify(result),
    Date.parse(result.completedAt),
  ), /M2_EXECUTION_RESULT_AUTHORITY_MISSING/);
  assert.equal(executionRepository.getResult('execution-1'), null);
  db.close();
});

test('non-success terminal is immutable and blocks late journal events', () => {
  const db = openDb();
  const { effectRepository, executionRepository, effects, request } = registerFixture(db);
  executionRepository.acquireClaim({
    executionId: 'execution-1', owner: OWNER_ONE, liveness: { isProvablyDead: () => false },
  });
  executionRepository.recordApprovalSet({
    executionId: 'execution-1',
    generation: 1,
    grantIds: approveAndConsume(effectRepository, effects),
  });
  const failed = failureResult(request);
  assert.equal(executionRepository.recordResult(failed).created, true);
  assert.equal(executionRepository.recordResult(failed).created, false);
  expectCode(() => executionRepository.appendEvent({
    eventId: 'late-event', executionId: 'execution-1', generation: 1,
    phase: 'terminal', type: 'terminal_prepared', details: {},
  }), ExecutionAuthorityErrorCode.STALE_FENCE);
  assert.throws(() => db.prepare(`
    UPDATE m2_execution_results SET terminal_status = 'succeeded'
    WHERE execution_id = 'execution-1'
  `).run(), /append-only/);
  db.close();
});

summary();
