import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  M2_EFFECT_CONTRACT_KIND,
  computeEffectRequestDigest,
} from '../contracts/m2/effect-v1.js';
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import {
  EXPECTED_M2_SCHEMA_FINGERPRINT,
  computeM2SchemaFingerprint,
  up as applyEffectExecutionClaims,
} from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
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
const FUTURE_EXPIRES = '2026-08-23T20:10:00.000Z';
const PAYLOAD_BYTES = 31;
const EXECUTION_OWNER = Object.freeze({
  ownerId: 'owner:test-process',
  pid: 4242,
  bootId: '11111111-1111-4111-8111-111111111111',
  startIdentity: '9191',
});

function openDb(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  const hasAuthority = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_effect_requests'",
  ).get());
  if (!hasAuthority) {
    applyEffectAuthorityMigration(db);
    applyEffectAuthorityHardening(db);
  }
  applyEffectExecutionClaims(db);
  return db;
}

function installNearCurrentCandidate(db, { pendingRow = false } = {}) {
  db.exec(`
    CREATE TABLE m2_effect_requests (
      effect_id TEXT PRIMARY KEY,
      payload_bytes INTEGER,
      request_digest TEXT
    );
    CREATE TABLE m2_approval_grants (grant_id TEXT PRIMARY KEY, payload_bytes INTEGER);
    CREATE TABLE m2_effect_results (
      effect_id TEXT PRIMARY KEY,
      run_id TEXT,
      project_id INTEGER,
      request_digest TEXT,
      approval_grant_id TEXT
    );
    CREATE TABLE m2_pending_effect_payloads (
      effect_id TEXT PRIMARY KEY,
      user_id TEXT,
      payload BLOB
    );
    CREATE TABLE m2_effect_authority_events (seq INTEGER PRIMARY KEY);
  `);
  if (pendingRow) {
    db.prepare(`
      INSERT INTO m2_pending_effect_payloads (effect_id, user_id, payload)
      VALUES (?, ?, ?)
    `).run('legacy-effect', 'legacy-user', Buffer.from('pending'));
  }
}

function installColumnCompleteButTriggerWeakCandidate(db, { requestRow = false } = {}) {
  applyEffectAuthorityMigration(db);
  if (requestRow) repositoryAt(db, CREATED).registerEffectRequest(request());
  db.exec('DROP TRIGGER trg_m2_approval_grants_exact_scope');
}

function repositoryAt(db, timestamp = CONSUMED) {
  const atMs = Date.parse(timestamp);
  return new EffectAuthorityRepository(db, { clock: () => atMs });
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
    runId: 'run-1',
    projectId: 17,
    requestDigest: computeEffectRequestDigest(request()),
    approvalGrantId: 'grant-1',
    terminalStatus: 'succeeded',
    startedAt: '2026-08-23T20:00:11.000Z',
    completedAt: '2026-08-23T20:00:12.000Z',
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

function consume(repository, input) {
  return repository.consumeApprovalGrant({ ...input, executionOwner: EXECUTION_OWNER });
}

suite('M2 durable effect authority repository');

test('registers an immutable request and exact retry is idempotent', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  assert.equal(repository.registerEffectRequest(request()).created, true);
  assert.equal(repository.registerEffectRequest(request()).created, false);
  assert.deepEqual(repository.listAuthorityEvents('effect-1').map(event => event.eventType), [
    'REQUEST_REGISTERED',
  ]);
  db.close();
});

test('request identity or idempotency collision with different bytes is rejected', () => {
  const db = openDb();
  const repository = repositoryAt(db);
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
  const repository = repositoryAt(db);
  expectCode(
    () => repository.issueApprovalGrant(grant()),
    EffectAuthorityErrorCode.REQUEST_NOT_FOUND,
  );
  repository.registerEffectRequest(request());
  expectCode(
    () => repository.issueApprovalGrant(grant({ scope: { ...grant().scope, projectId: 18 } })),
    EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
  );
  db.close();
});

test('issue and consume commit a durable ordered audit', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  const bound = repository.getEffectRequest('effect-1');
  assert.equal(bound.approvalGrantId, 'grant-1');
  const consumed = consume(repository, { grantId: 'grant-1', request: bound, consumedAt: CONSUMED });
  assert.equal(consumed.grant.consumedByEffectId, 'effect-1');
  assert.deepEqual(repository.listAuthorityEvents('effect-1').map(event => event.eventType), [
    'REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED',
  ]);
  db.close();
});

test('changing target bytes after approval cannot consume the grant', () => {
  const db = openDb();
  const repository = repositoryAt(db);
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
    () => consume(repository, { grantId: 'grant-1', request: changed, consumedAt: CONSUMED }),
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
  const repositoryA = repositoryAt(dbA);
  const repositoryB = repositoryAt(dbB);
  registerAndGrant(repositoryA);
  const current = repositoryA.getEffectRequest('effect-1');
  assert.equal(consume(repositoryA, { grantId: 'grant-1', request: current, consumedAt: CONSUMED }).consumed, true);
  expectCode(
    () => consume(repositoryB, { grantId: 'grant-1', request: current, consumedAt: CONSUMED }),
    EffectAuthorityErrorCode.GRANT_CONSUMED,
  );
  assert.equal(repositoryA.listAuthorityEvents('effect-1').filter(event => event.eventType === 'GRANT_CONSUMED').length, 1);
  dbB.close();
  dbA.close();
  rmSync(root, { recursive: true, force: true });
});

test('expiry boundary is fail-closed and distinct from consumption', () => {
  const db = openDb();
  registerAndGrant(repositoryAt(db));
  const repository = repositoryAt(db, EXPIRES);
  expectCode(
    () => consume(repository, {
      grantId: 'grant-1',
      request: repository.getEffectRequest('effect-1'),
      consumedAt: EXPIRES,
    }),
    EffectAuthorityErrorCode.GRANT_EXPIRED,
  );
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, null);
  db.close();
});

test('caller-supplied time cannot backdate consumption against the trusted clock', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1',
    request: repository.getEffectRequest('effect-1'),
    consumedAt: '1970-01-01T00:00:00.000Z',
  });
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, CONSUMED);
  db.close();
});

test('repository rejects a grant whose issuance is in the future', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  repository.registerEffectRequest(request());
  expectCode(
    () => repository.issueApprovalGrant(grant({
      issuedAt: EXPIRES,
      expiresAt: FUTURE_EXPIRES,
    })),
    EffectAuthorityErrorCode.INPUT_INVALID,
  );
  assert.equal(repository.getApprovalGrant('grant-1'), null);
  db.close();
});

test('revocation is idempotent and a revoked grant cannot be consumed', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  assert.equal(repository.revokeApprovalGrant({ grantId: 'grant-1', revokedAt: CONSUMED, reason: 'user_cancelled' }).revoked, true);
  assert.equal(repository.revokeApprovalGrant({ grantId: 'grant-1', revokedAt: CONSUMED, reason: 'user_cancelled' }).revoked, false);
  expectCode(
    () => consume(repository, {
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
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
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
  const repository = repositoryAt(db);
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
  consume(repository, {
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

test('run cancellation revokes a restored not-yet-valid grant', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  repository.registerEffectRequest(request());
  const futureGrant = grant({ issuedAt: EXPIRES, expiresAt: FUTURE_EXPIRES });
  db.prepare(`
    INSERT INTO m2_approval_grants (
      grant_id, effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
      workspace_revision, nonce, grant_json, issued_at_ms, expires_at_ms,
      consumed_at_ms, consumed_by_effect_id, revoked_at_ms, revocation_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
  `).run(
    futureGrant.grantId,
    futureGrant.scope.effectId,
    futureGrant.scope.runId,
    futureGrant.scope.projectId,
    futureGrant.scope.kind,
    futureGrant.scope.payloadDigest,
    futureGrant.scope.payloadBytes,
    futureGrant.scope.workspaceRevision,
    futureGrant.nonce,
    JSON.stringify(futureGrant),
    Date.parse(futureGrant.issuedAt),
    Date.parse(futureGrant.expiresAt),
  );

  const revoked = repository.revokeRunGrants({ runId: 'run-1', reason: 'run_cancelled' });
  assert.deepEqual([...revoked.grantIds], ['grant-1']);
  assert.equal(repository.getApprovalGrant('grant-1').revokedAt, CONSUMED);
  expectCode(
    () => consume(repository, {
      grantId: 'grant-1', request: repository.getEffectRequest('effect-1'),
    }),
    EffectAuthorityErrorCode.GRANT_REVOKED,
  );
  db.close();
});

test('state and audit survive database close and reopen', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm2-effect-ledger-'));
  const filename = path.join(root, 'authority.sqlite');
  let db = openDb(filename);
  let repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'), consumedAt: CONSUMED,
  });
  db.close();

  db = openDb(filename);
  repository = repositoryAt(db);
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, CONSUMED);
  assert.deepEqual(repository.listAuthorityEvents('effect-1').map(event => event.eventType), [
    'REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED',
  ]);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test('terminal result is immutable, exact retry is idempotent and conflict is rejected', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'),
  });
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

test('success cannot be recorded before the exact grant is consumed', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  expectCode(
    () => repository.recordEffectResult(result()),
    EffectAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
  );

  const encoded = JSON.stringify(result());
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_results (
      effect_id, run_id, project_id, request_digest, approval_grant_id,
      terminal_status, result_json, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'effect-1', 'run-1', 17, computeEffectRequestDigest(request()), 'grant-1',
    'succeeded', encoded, Date.parse(result().completedAt),
  ), /RESULT_AUTHORITY_MISSING/);
  assert.equal(repository.getEffectResult('effect-1'), null);
  db.close();
});

test('pre-consumption failure is not an EffectResult and cannot create a terminal', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  repository.registerEffectRequest(request());
  const failed = result({
    approvalGrantId: null,
    terminalStatus: 'failed',
    errorCode: 'EFFECT_FAILED',
    outputDigest: null,
  });
  expectCode(
    () => repository.recordEffectResult(failed),
    EffectAuthorityErrorCode.INPUT_INVALID,
  );
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_results (
      effect_id, run_id, project_id, request_digest, approval_grant_id,
      terminal_status, result_json, completed_at_ms
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    'effect-1', 'run-1', 17, computeEffectRequestDigest(request()),
    'failed', JSON.stringify(failed), Date.parse(failed.completedAt),
  ), /RESULT_AUTHORITY_MISSING/);
  assert.equal(repository.getEffectResult('effect-1'), null);
  db.close();
});

test('result cannot predate its request', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1',
    request: repository.getEffectRequest('effect-1'),
  });
  expectCode(
    () => repository.recordEffectResult(result({
      terminalStatus: 'failed',
      errorCode: 'EFFECT_FAILED',
      outputDigest: null,
      startedAt: '2026-08-23T19:59:59.000Z',
      completedAt: '2026-08-23T19:59:59.500Z',
    })),
    EffectAuthorityErrorCode.INPUT_INVALID,
  );
  db.close();
});

test('result cannot predate the durable execution claim', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1',
    request: repository.getEffectRequest('effect-1'),
  });
  expectCode(
    () => repository.recordEffectResult(result({
      startedAt: '2026-08-23T20:00:09.999Z',
      completedAt: '2026-08-23T20:00:10.001Z',
    })),
    EffectAuthorityErrorCode.INPUT_INVALID,
  );
  db.close();
});

test('database blocks request, result and event mutation or replacement', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'),
  });
  repository.recordEffectResult(result());
  assert.throws(() => db.prepare("UPDATE m2_effect_requests SET kind = 'fs.delete' WHERE effect_id = 'effect-1'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM m2_effect_results WHERE effect_id = 'effect-1'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM m2_effect_authority_events').run(), /append-only/);
  assert.throws(() => db.prepare(`
    INSERT OR REPLACE INTO m2_effect_authority_events (
      seq, event_id, event_type, effect_id, grant_id, run_id, project_id,
      occurred_at_ms, details_json
    ) SELECT seq, event_id, event_type, effect_id, grant_id, run_id, project_id,
             occurred_at_ms, details_json
      FROM m2_effect_authority_events
      WHERE event_id = 'REQUEST_REGISTERED:effect-1'
  `).run(), /EVENT_IDENTITY_CONFLICT/);
  assert.throws(() => db.prepare(`
    INSERT OR REPLACE INTO m2_effect_requests (
      effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
      request_digest, workspace_revision, idempotency_key, request_json, created_at_ms
    ) SELECT effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
             request_digest, workspace_revision, idempotency_key, request_json, created_at_ms
      FROM m2_effect_requests WHERE effect_id = 'effect-1'
  `).run(), /IDENTITY_CONFLICT/);
  db.close();
});

test('database rejects a forged authority event before the matching state transition', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_authority_events (
      event_id, event_type, effect_id, grant_id, run_id, project_id,
      occurred_at_ms, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'GRANT_CONSUMED:grant-1', 'GRANT_CONSUMED', 'effect-1', 'grant-1',
    'run-1', 17, Date.parse(CONSUMED),
    JSON.stringify({ consumedByEffectId: 'effect-1' }),
  ), /EVENT_STATE_MISMATCH/);

  consume(repository, {
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'),
  });
  assert.equal(
    repository.listAuthorityEvents('effect-1')
      .filter(event => event.eventType === 'GRANT_CONSUMED').length,
    1,
  );
  db.close();
});

test('storage faults are typed and are not mislabeled as identity conflicts', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  db.pragma('query_only = ON');
  expectCode(
    () => repository.registerEffectRequest(request()),
    EffectAuthorityErrorCode.STORAGE_FAILURE,
  );
  db.close();
});

test('repository fails closed when direct SQL stores a structurally invalid request', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  const malformed = JSON.stringify({
    ...request(),
    target: { ...request().target, relativePath: 'src//app.js' },
  });
  db.prepare(`
    INSERT INTO m2_effect_requests (
      effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
      request_digest, workspace_revision, idempotency_key, request_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'effect-1', 'run-1', 17, 'fs.write', DIGEST_A, PAYLOAD_BYTES, DIGEST_B,
    'wsr1:revision-a', 'write-app-1', malformed, Date.parse(CREATED),
  );
  expectCode(
    () => repository.getEffectRequest('effect-1'),
    EffectAuthorityErrorCode.STORAGE_FAILURE,
  );
  db.close();
});

test('database rejects JSON identities that disagree with indexed authority columns', () => {
  const db = openDb();
  const mismatched = JSON.stringify({
    ...request(),
    origin: { ...request().origin, projectId: 18 },
  });
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_requests (
      effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
      request_digest, workspace_revision, idempotency_key, request_json, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'effect-1', 'run-1', 17, 'fs.write', DIGEST_A, PAYLOAD_BYTES,
    computeEffectRequestDigest(request()),
    'wsr1:revision-a', 'write-app-1', mismatched, Date.parse(CREATED),
  ), /JSON_IDENTITY_MISMATCH/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count, 0);
  db.close();
});

test('repository and database reject approval by a subject other than the request actor', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  repository.registerEffectRequest(request());
  const forged = grant({
    subject: { actorType: 'user', actorId: 'attacker' },
  });

  expectCode(
    () => repository.issueApprovalGrant(forged),
    EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
  );
  assert.throws(() => db.prepare(`
    INSERT INTO m2_approval_grants (
      grant_id, effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
      workspace_revision, nonce, grant_json, issued_at_ms, expires_at_ms,
      consumed_at_ms, consumed_by_effect_id, revoked_at_ms, revocation_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
  `).run(
    forged.grantId,
    forged.scope.effectId,
    forged.scope.runId,
    forged.scope.projectId,
    forged.scope.kind,
    forged.scope.payloadDigest,
    forged.scope.payloadBytes,
    forged.scope.workspaceRevision,
    forged.nonce,
    JSON.stringify(forged),
    Date.parse(forged.issuedAt),
    Date.parse(forged.expiresAt),
  ), /GRANT_SCOPE_MISMATCH/);
  assert.equal(repository.getEffectRequest('effect-1').approvalGrantId, null);
  db.close();
});

test('database permits one direct terminal grant transition and always emits audit', () => {
  const db = openDb();
  const repository = repositoryAt(db);
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

test('database refuses direct grant consumption without the exact durable execution claim', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  assert.throws(() => db.prepare(`
    UPDATE m2_approval_grants
    SET consumed_at_ms = ?, consumed_by_effect_id = effect_id
    WHERE grant_id = ?
  `).run(Date.parse(CONSUMED), 'grant-1'), /INVALID_TRANSITION/);
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, null);
  assert.equal(repository.getExecutionClaim('effect-1'), null);
  db.close();
});

test('durable execution claim is exact and append-only', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'),
  });
  const claim = repository.getExecutionClaim('effect-1');
  assert.equal(claim.grantId, 'grant-1');
  assert.equal(claim.ownerId, EXECUTION_OWNER.ownerId);
  assert.throws(() => db.prepare(`
    UPDATE m2_effect_execution_claims SET owner_pid = owner_pid + 1
    WHERE effect_id = 'effect-1'
  `).run(), /append-only/);
  assert.throws(() => db.prepare(`
    DELETE FROM m2_effect_execution_claims WHERE effect_id = 'effect-1'
  `).run(), /append-only/);
  db.close();
});

test('repository and database reject malformed persisted execution owner identities', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  expectCode(
    () => repository.consumeApprovalGrant({
      grantId: 'grant-1',
      request: { ...repository.getEffectRequest('effect-1'), approvalGrantId: 'grant-1' },
      executionOwner: { ...EXECUTION_OWNER, bootId: 'malformed-boot-id' },
    }),
    EffectAuthorityErrorCode.INPUT_INVALID,
  );
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_execution_claims (
      effect_id, grant_id, owner_id, owner_pid, owner_boot_id,
      owner_start_identity, claimed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'effect-1', 'grant-1', EXECUTION_OWNER.ownerId, EXECUTION_OWNER.pid,
    'malformed-boot-id', 'malformed-start-id', Date.parse(CONSUMED),
  ), /CHECK constraint failed/);
  assert.equal(repository.getExecutionClaim('effect-1'), null);
  assert.equal(repository.getApprovalGrant('grant-1').consumedAt, null);
  db.close();
});

test('database rejects a direct EffectResult that predates its execution claim', () => {
  const db = openDb();
  const repository = repositoryAt(db);
  registerAndGrant(repository);
  consume(repository, {
    grantId: 'grant-1', request: repository.getEffectRequest('effect-1'),
  });
  const forged = result({
    startedAt: '2026-08-23T20:00:09.999Z',
    completedAt: '2026-08-23T20:00:10.001Z',
  });
  assert.throws(() => db.prepare(`
    INSERT INTO m2_effect_results (
      effect_id, run_id, project_id, request_digest, approval_grant_id,
      terminal_status, result_json, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    forged.effectId,
    forged.runId,
    forged.projectId,
    forged.requestDigest,
    forged.approvalGrantId,
    forged.terminalStatus,
    JSON.stringify(forged),
    Date.parse(forged.completedAt),
  ), /RESULT_AUTHORITY_MISSING/);
  assert.equal(repository.getEffectResult('effect-1'), null);
  db.close();
});

test('hardening migration rebuilds only an empty pre-acceptance authority schema', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE m2_effect_requests (effect_id TEXT PRIMARY KEY)');
  applyEffectAuthorityHardening(db);
  const columns = db.prepare('PRAGMA table_info(m2_effect_requests)').all().map(row => row.name);
  assert.equal(columns.includes('payload_bytes'), true);
  assert.equal(columns.includes('request_digest'), true);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'm2_pending_effect_payloads'").get().count,
    1,
  );
  db.close();
});

test('hardening migration detects and rebuilds an empty near-current user_id layout', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installNearCurrentCandidate(db);
  applyEffectAuthorityHardening(db);
  applyEffectExecutionClaims(db);
  const pendingColumns = db.prepare('PRAGMA table_info(m2_pending_effect_payloads)')
    .all().map(row => row.name);
  assert.equal(pendingColumns.includes('subject_id'), true);
  assert.equal(pendingColumns.includes('user_id'), false);
  db.close();
});

test('hardening migration refuses to drop pending rows from a near-current layout', () => {
  const db = new Database(':memory:');
  installNearCurrentCandidate(db, { pendingRow: true });
  applyEffectAuthorityHardening(db);
  assert.throws(
    () => applyEffectExecutionClaims(db),
    /PRE_ACCEPTANCE_DATA_REQUIRES_EXPLICIT_MIGRATION/,
  );
  assert.equal(
    db.prepare('SELECT count(*) AS count FROM m2_pending_effect_payloads').get().count,
    1,
  );
  db.close();
});

test('hardening migration refuses to fabricate authority for pre-acceptance rows', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE m2_effect_requests (effect_id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO m2_effect_requests (effect_id) VALUES (?)').run('legacy-effect');
  assert.throws(
    () => applyEffectAuthorityHardening(db),
    /PRE_ACCEPTANCE_DATA_REQUIRES_EXPLICIT_MIGRATION/,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count, 1);
  db.close();
});

test('072 advances a stamped 071 schema and pins the full sqlite_master fingerprint', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyEffectAuthorityMigration(db);
  applyEffectAuthorityHardening(db);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'm2_effect_execution_claims'")
      .get().count,
    0,
  );
  applyEffectExecutionClaims(db);
  assert.equal(computeM2SchemaFingerprint(db), EXPECTED_M2_SCHEMA_FINGERPRINT);
  applyEffectExecutionClaims(db);
  assert.equal(computeM2SchemaFingerprint(db), EXPECTED_M2_SCHEMA_FINGERPRINT);
  db.close();
});

test('072 rebuilds an empty column-complete but trigger-weak candidate', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installColumnCompleteButTriggerWeakCandidate(db);
  assert.notEqual(computeM2SchemaFingerprint(db), EXPECTED_M2_SCHEMA_FINGERPRINT);
  applyEffectExecutionClaims(db);
  assert.equal(computeM2SchemaFingerprint(db), EXPECTED_M2_SCHEMA_FINGERPRINT);
  db.close();
});

test('072 never drops rows from a column-complete but trigger-weak candidate', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installColumnCompleteButTriggerWeakCandidate(db, { requestRow: true });
  assert.throws(
    () => applyEffectExecutionClaims(db),
    /PRE_ACCEPTANCE_DATA_REQUIRES_EXPLICIT_MIGRATION/,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count, 1);
  db.close();
});

summary();
