import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  M2_EFFECT_CONTRACT_KIND,
} from '../contracts/m2/effect-v1.js';
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import {
  EffectAuthorityError,
  EffectAuthorityErrorCode,
  EffectAuthorityRepository,
} from '../src/effects/effect-authority-repository.js';
import { suite, test, summary } from './harness.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const CREATED = '2026-08-23T20:00:00.000Z';
const CONSUMED = '2026-08-23T20:00:10.000Z';
const EXPIRES = '2026-08-23T20:05:00.000Z';

function openDb(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  applyEffectAuthorityMigration(db);
  return db;
}

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
      projectId: 'project-1',
    },
    kind: 'fs.write',
    target: {
      type: 'filesystem',
      canonicalRoot: '/workspace/project',
      relativePath: 'src/app.js',
      resolvedRealpath: '/workspace/project/src/app.js',
    },
    payloadDigest: DIGEST_A,
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
      projectId: 'project-1',
      effectId: 'effect-1',
      kind: 'fs.write',
      payloadDigest: DIGEST_A,
      workspaceRevision: 'wsr1:revision-a',
    },
    constraints: {
      allowedRealpaths: ['/workspace/project/src/app.js'],
      allowedBinary: null,
      allowedArgvDigest: null,
      allowedOrigin: null,
      maxBytes: 4096,
    },
    issuedAt: CREATED,
    expiresAt: EXPIRES,
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
    terminalStatus: 'succeeded',
    startedAt: '2026-08-23T20:00:01.000Z',
    completedAt: '2026-08-23T20:00:02.000Z',
    process: { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null },
    changes: {
      paths: ['src/app.js'],
      beforeDigest: DIGEST_A,
      afterDigest: DIGEST_B,
      diffArtifact: 'artifact:diff-1',
    },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: DIGEST_B,
    errorCode: null,
    evidenceRefs: ['artifact:diff-1'],
    lateCompletionRejected: false,
  };
  return { ...base, ...overrides };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof EffectAuthorityError && error.code === code);
}

function registerAndGrant(repository, requestValue = request(), grantValue = grant()) {
  repository.registerEffectRequest(requestValue);
  repository.issueApprovalGrant(grantValue);
}

suite('M2 durable effect authority repository');

test('registers an immutable request and exact retry is idempotent', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  assert.equal(repository.registerEffectRequest(request()).created, true);
  assert.equal(repository.registerEffectRequest(request()).created, false);
  assert.deepEqual(repository.listAuthorityEvents('effect-1').map(event => event.eventType), [
    'REQUEST_REGISTERED',
  ]);
  db.close();
});

test('request identity or idempotency collision with different bytes is rejected', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  repository.registerEffectRequest(request());
  expectCode(
    () => repository.registerEffectRequest(request({ payloadDigest: DIGEST_B })),
    EffectAuthorityErrorCode.REQUEST_CONFLICT,
  );
  expectCode(
    () => repository.registerEffectRequest(request({ effectId: 'effect-2', payloadDigest: DIGEST_B })),
    EffectAuthorityErrorCode.REQUEST_CONFLICT,
  );
  db.close();
});

test('grant issuance requires an existing exact effect scope', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  expectCode(
    () => repository.issueApprovalGrant(grant()),
    EffectAuthorityErrorCode.REQUEST_NOT_FOUND,
  );
  repository.registerEffectRequest(request());
  expectCode(
    () => repository.issueApprovalGrant(grant({ scope: { ...grant().scope, projectId: 'project-2' } })),
    EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
  );
  db.close();
});

test('issue and consume commit a durable ordered audit', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  const bound = repository.getEffectRequest('effect-1');
  assert.equal(bound.approvalGrantId, 'grant-1');
  const consumed = repository.consumeApprovalGrant({ grantId: 'grant-1', request: bound, consumedAt: CONSUMED });
  assert.equal(consumed.grant.consumedByEffectId, 'effect-1');
  assert.deepEqual(repository.listAuthorityEvents('effect-1').map(event => event.eventType), [
    'REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED',
  ]);
  db.close();
});

test('changing target bytes after approval cannot consume the grant', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  const current = repository.getEffectRequest('effect-1');
  const changed = {
    ...current,
    target: {
      ...current.target,
      relativePath: 'src/other.js',
      resolvedRealpath: '/workspace/project/src/other.js',
    },
  };
  expectCode(
    () => repository.consumeApprovalGrant({ grantId: 'grant-1', request: changed, consumedAt: CONSUMED }),
    EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
  );
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, null);
  db.close();
});

test('two database connections attempting consume have exactly one winner', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm2-effect-consume-'));
  const filename = path.join(root, 'authority.sqlite');
  const dbA = openDb(filename);
  const dbB = openDb(filename);
  const repositoryA = new EffectAuthorityRepository(dbA);
  const repositoryB = new EffectAuthorityRepository(dbB);
  registerAndGrant(repositoryA);
  const current = repositoryA.getEffectRequest('effect-1');
  assert.equal(repositoryA.consumeApprovalGrant({ grantId: 'grant-1', request: current, consumedAt: CONSUMED }).consumed, true);
  expectCode(
    () => repositoryB.consumeApprovalGrant({ grantId: 'grant-1', request: current, consumedAt: CONSUMED }),
    EffectAuthorityErrorCode.GRANT_CONSUMED,
  );
  assert.equal(repositoryA.listAuthorityEvents('effect-1').filter(event => event.eventType === 'GRANT_CONSUMED').length, 1);
  dbB.close();
  dbA.close();
  rmSync(root, { recursive: true, force: true });
});

test('expiry boundary is fail-closed and distinct from consumption', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  expectCode(
    () => repository.consumeApprovalGrant({
      grantId: 'grant-1',
      request: repository.getEffectRequest('effect-1'),
      consumedAt: EXPIRES,
    }),
    EffectAuthorityErrorCode.GRANT_EXPIRED,
  );
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, null);
  db.close();
});

test('grant cannot be consumed before its issuance time', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  expectCode(
    () => repository.consumeApprovalGrant({
      grantId: 'grant-1',
      request: repository.getEffectRequest('effect-1'),
      consumedAt: '2026-08-23T19:59:59.999Z',
    }),
    EffectAuthorityErrorCode.GRANT_NOT_YET_VALID,
  );
  db.close();
});

test('revocation is idempotent and a revoked grant cannot be consumed', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  assert.equal(repository.revokeApprovalGrant({ grantId: 'grant-1', revokedAt: CONSUMED, reason: 'user_cancelled' }).revoked, true);
  assert.equal(repository.revokeApprovalGrant({ grantId: 'grant-1', revokedAt: CONSUMED, reason: 'user_cancelled' }).revoked, false);
  expectCode(
    () => repository.consumeApprovalGrant({
      grantId: 'grant-1',
      request: repository.getEffectRequest('effect-1'),
      consumedAt: '2026-08-23T20:00:11.000Z',
    }),
    EffectAuthorityErrorCode.GRANT_REVOKED,
  );
  assert.equal(repository.listAuthorityEvents('effect-1').filter(event => event.eventType === 'GRANT_REVOKED').length, 1);
  db.close();
});

test('consumed grant cannot be revoked', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  repository.consumeApprovalGrant({
    grantId: 'grant-1',
    request: repository.getEffectRequest('effect-1'),
    consumedAt: CONSUMED,
  });
  expectCode(
    () => repository.revokeApprovalGrant({
      grantId: 'grant-1',
      revokedAt: '2026-08-23T20:00:11.000Z',
      reason: 'late_cancel',
    }),
    EffectAuthorityErrorCode.GRANT_CONSUMED,
  );
  db.close();
});

test('run revocation revokes every active grant and preserves consumed grants', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  const request2 = request({
    effectId: 'effect-2',
    idempotencyKey: 'write-app-2',
    target: { ...request().target, relativePath: 'src/b.js', resolvedRealpath: '/workspace/project/src/b.js' },
  });
  const grant2 = grant({
    grantId: 'grant-2',
    nonce: 'nonce-000000000002',
    scope: { ...grant().scope, effectId: 'effect-2' },
    constraints: { ...grant().constraints, allowedRealpaths: ['/workspace/project/src/b.js'] },
  });
  registerAndGrant(repository, request2, grant2);
  repository.consumeApprovalGrant({
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'), consumedAt: CONSUMED,
  });
  const revoked = repository.revokeRunGrants({
    runId: 'run-1', revokedAt: '2026-08-23T20:00:11.000Z', reason: 'run_cancelled',
  });
  assert.deepEqual([...revoked.grantIds], ['grant-2']);
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, CONSUMED);
  assert.equal(repository.getApprovalGrant('grant-2').revocationReason, 'run_cancelled');
  db.close();
});

test('state and audit survive database close and reopen', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm2-effect-ledger-'));
  const filename = path.join(root, 'authority.sqlite');
  let db = openDb(filename);
  let repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  repository.consumeApprovalGrant({
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'), consumedAt: CONSUMED,
  });
  db.close();

  db = openDb(filename);
  repository = new EffectAuthorityRepository(db);
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, CONSUMED);
  assert.deepEqual(repository.listAuthorityEvents('effect-1').map(event => event.eventType), [
    'REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED',
  ]);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test('terminal result is immutable, exact retry is idempotent and conflict is rejected', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  repository.registerEffectRequest(request());
  assert.equal(repository.recordEffectResult(result()).created, true);
  assert.equal(repository.recordEffectResult(result()).created, false);
  expectCode(
    () => repository.recordEffectResult(result({
      terminalStatus: 'failed',
      errorCode: 'EFFECT_FAILED',
      outputDigest: null,
    })),
    EffectAuthorityErrorCode.RESULT_CONFLICT,
  );
  assert.equal(repository.listAuthorityEvents('effect-1').filter(event => event.eventType === 'RESULT_RECORDED').length, 1);
  db.close();
});

test('result cannot predate its request', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  repository.registerEffectRequest(request());
  expectCode(
    () => repository.recordEffectResult(result({
      startedAt: '2026-08-23T19:59:59.000Z',
      completedAt: '2026-08-23T19:59:59.500Z',
    })),
    EffectAuthorityErrorCode.INPUT_INVALID,
  );
  db.close();
});

test('database blocks request, result and event mutation or replacement', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  repository.registerEffectRequest(request());
  repository.recordEffectResult(result());
  assert.throws(() => db.prepare("UPDATE m2_effect_requests SET kind = 'fs.delete' WHERE effect_id = 'effect-1'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM m2_effect_results WHERE effect_id = 'effect-1'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM m2_effect_authority_events').run(), /append-only/);
  assert.throws(() => db.prepare(`
    INSERT OR REPLACE INTO m2_effect_requests (
      effect_id, run_id, project_id, kind, payload_digest,
      workspace_revision, idempotency_key, request_json, created_at_ms
    ) SELECT effect_id, run_id, project_id, kind, payload_digest,
             workspace_revision, idempotency_key, request_json, created_at_ms
      FROM m2_effect_requests WHERE effect_id = 'effect-1'
  `).run(), /IDENTITY_CONFLICT/);
  db.close();
});

test('database rejects JSON identities that disagree with indexed authority columns', () => {
  const db = openDb();
  const mismatched = JSON.stringify({
    ...request(),
    origin: { ...request().origin, projectId: 'project-other' },
  });
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_requests (
      effect_id, run_id, project_id, kind, payload_digest,
      workspace_revision, idempotency_key, request_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'effect-1', 'run-1', 'project-1', 'fs.write', DIGEST_A,
    'wsr1:revision-a', 'write-app-1', mismatched, Date.parse(CREATED),
  ), /JSON_IDENTITY_MISMATCH/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count, 0);
  db.close();
});

test('database permits one direct terminal grant transition and always emits audit', () => {
  const db = openDb();
  const repository = new EffectAuthorityRepository(db);
  registerAndGrant(repository);
  db.prepare(`
    UPDATE m2_approval_grants
    SET revoked_at_ms = ?, revocation_reason = ?
    WHERE grant_id = ?
  `).run(Date.parse(CONSUMED), 'direct_census', 'grant-1');
  assert.equal(repository.getApprovalGrant('grant-1').revocationReason, 'direct_census');
  assert.equal(repository.listAuthorityEvents('effect-1').at(-1).eventType, 'GRANT_REVOKED');
  assert.throws(() => db.prepare(`
    UPDATE m2_approval_grants SET revocation_reason = 'rewritten' WHERE grant_id = 'grant-1'
  `).run(), /INVALID_TRANSITION/);
  db.close();
});

summary();
