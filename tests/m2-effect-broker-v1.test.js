import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  M2_EFFECT_CONTRACT_KIND,
  canonicalStringify,
  computeEffectRequestDigest,
} from '../contracts/m2/effect-v1.js';
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import {
  EffectAuthorityError,
  EffectAuthorityErrorCode,
  EffectAuthorityRepository,
} from '../src/effects/effect-authority-repository.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import {
  EffectBrokerError,
  EffectBrokerErrorCode,
  createEffectBroker,
} from '../src/effects/effect-broker.js';
import { createFilesystemEffectProvider } from '../src/effects/filesystem-effect-provider.js';
import { suite, testAsync, summary } from './harness.js';

const BASE_MS = Date.parse('2026-08-24T12:00:00.000Z');
const PROJECT_ID = 17;
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'user-1' });

function mutableClock(initial = BASE_MS) {
  let value = initial;
  return Object.freeze({
    now: () => value,
    set(next) { value = next; },
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createManualScheduler() {
  const tasks = [];
  return Object.freeze({
    tasks,
    schedule(callback, milliseconds) {
      const task = { callback, milliseconds, cancelled: false, fired: false };
      tasks.push(task);
      return Object.freeze({ cancel() { task.cancelled = true; } });
    },
    hasActive(milliseconds) {
      return tasks.some(task => (
        task.milliseconds === milliseconds && !task.cancelled && !task.fired
      ));
    },
    fireNext(milliseconds) {
      const task = tasks.find(candidate => (
        candidate.milliseconds === milliseconds && !candidate.cancelled && !candidate.fired
      ));
      assert.ok(task, `No active ${milliseconds}ms timer`);
      task.fired = true;
      task.callback();
    },
  });
}

function openDatabase(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  applyEffectAuthorityMigration(db);
  return db;
}

async function withEnvironment(callback, { persistentDatabase = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m2-effect-broker-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const databasePath = persistentDatabase ? path.join(directory, 'authority.sqlite') : ':memory:';
  const clock = mutableClock();
  const revision = { value: 'wsr1:revision-a' };
  const observations = [];
  let db = openDatabase(databasePath);
  let repository = new EffectAuthorityRepository(db, { clock: clock.now });
  let grantSequence = 0;
  let nonceSequence = 0;
  const issuer = createApprovalGrantIssuer(repository, {
    clock: clock.now,
    grantIdFactory: () => `grant-${++grantSequence}`,
    nonceFactory: () => `nonce-${String(++nonceSequence).padStart(16, '0')}`,
    defaultTtlMs: 60_000,
  });
  const workspaceAuthority = Object.freeze({
    async observe(input) {
      observations.push({ ...input });
      return Object.freeze({
        canonicalRoot: realpathSync(input.projectRoot),
        workspaceRevision: revision.value,
      });
    },
  });
  let effectSequence = 0;

  const environment = {
    directory,
    projectRoot,
    databasePath,
    clock,
    revision,
    observations,
    get db() { return db; },
    get repository() { return repository; },
    issuer,
    workspaceAuthority,
    nextIdentity() {
      effectSequence += 1;
      return {
        runId: `run-${effectSequence}`,
        idempotencyKey: `write-${effectSequence}`,
      };
    },
    reopen() {
      db.close();
      db = openDatabase(databasePath);
      repository = new EffectAuthorityRepository(db, { clock: clock.now });
      return repository;
    },
  };

  try {
    return await callback(environment);
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function createBroker(environment, {
  repository = environment.repository,
  provider = { async execute() { return {}; } },
  scheduler,
  terminationGraceMs = 5,
} = {}) {
  return createEffectBroker(repository, {
    providers: { 'fs.write': provider },
    clock: environment.clock.now,
    scheduleTimeout: scheduler?.schedule,
    terminationGraceMs,
    workspaceAuthority: environment.workspaceAuthority,
  });
}

function prepareWrite(environment, broker, overrides = {}) {
  const identity = environment.nextIdentity();
  return broker.prepareFilesystemWrite({
    ...identity,
    actor: { type: 'user', id: 'user-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: PROJECT_ID,
    },
    projectId: PROJECT_ID,
    projectRoot: environment.projectRoot,
    relativePath: 'src/app.js',
    content: 'after\n',
    timeoutMs: 50,
    ...overrides,
  });
}

function issue(environment, effectId, extras = {}) {
  return environment.issuer.issue({
    effectId,
    authenticatedSubject: SUBJECT,
    ...extras,
  }).grant;
}

function repositoryView(repository, overrides = {}) {
  const methods = [
    'registerEffectRequest',
    'getEffectRequest',
    'getApprovalGrant',
    'consumeApprovalGrant',
    'recordEffectResult',
  ];
  return Object.freeze(Object.fromEntries(methods.map(method => [
    method,
    overrides[method] || repository[method].bind(repository),
  ])));
}

function assertCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

function successfulResult(request, approvalGrantId) {
  return {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
    version: 1,
    effectId: request.effectId,
    runId: request.runId,
    projectId: request.origin.projectId,
    requestDigest: computeEffectRequestDigest(request),
    approvalGrantId,
    terminalStatus: 'succeeded',
    startedAt: new Date(BASE_MS).toISOString(),
    completedAt: new Date(BASE_MS).toISOString(),
    process: {
      pid: null,
      processGroupId: null,
      startIdentity: null,
      exitCode: null,
      signal: null,
    },
    changes: {
      paths: [request.target.relativePath],
      beforeDigest: null,
      afterDigest: request.payloadDigest,
      diffArtifact: null,
    },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: request.payloadDigest,
    errorCode: null,
    evidenceRefs: [`effect:${request.effectId}:test`],
    lateCompletionRejected: false,
  };
}

suite('M2 canonical effect broker v1');

await testAsync('durably registers the request before execution and no grant means zero provider calls or writes', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    let providerCalls = 0;
    const broker = createBroker(environment, {
      provider: { async execute() { providerCalls += 1; return {}; } },
    });
    const prepared = await prepareWrite(environment, broker);

    assert.equal(prepared.state, 'approval_required');
    assert.equal(environment.repository.getEffectRequest(prepared.effectId)?.effectId, prepared.effectId);
    assert.deepEqual(
      environment.repository.listAuthorityEvents(prepared.effectId).map(event => event.eventType),
      ['REQUEST_REGISTERED'],
    );
    await assert.rejects(
      broker.execute({ effectId: prepared.effectId, grantId: 'grant-missing', payload: 'after\n' }),
      assertCode(EffectBrokerErrorCode.GRANT_NOT_FOUND),
    );
    assert.equal(providerCalls, 0);
    assert.equal(readFileSync(target, 'utf8'), 'before\n');
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
  });
});

await testAsync('exact approval consumes before the real filesystem write and commits a restart-durable result', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    const actualProvider = createFilesystemEffectProvider();
    let providerCalls = 0;
    let prepared;
    let grant;
    const checkingProvider = {
      async execute(input) {
        providerCalls += 1;
        assert.equal(environment.repository.getApprovalGrant(grant.grantId).consumedByEffectId, prepared.effectId);
        assert.deepEqual(
          environment.repository.listAuthorityEvents(prepared.effectId).map(event => event.eventType),
          ['REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED'],
        );
        assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
        return actualProvider.execute(input);
      },
    };
    const broker = createBroker(environment, { provider: checkingProvider });
    prepared = await prepareWrite(environment, broker);
    grant = issue(environment, prepared.effectId, {
      constraints: { allowedRealpaths: ['/attacker/chosen'], maxBytes: 1 },
    });

    assert.deepEqual(grant.constraints.allowedRealpaths, [target]);
    assert.equal(grant.constraints.maxBytes, Buffer.byteLength('after\n'));
    assert.equal(grant.subject.actorId, SUBJECT.actorId);

    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(result.approvalGrantId, grant.grantId);
    assert.equal(readFileSync(target, 'utf8'), 'after\n');
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
    assert.deepEqual(
      environment.repository.listAuthorityEvents(prepared.effectId).map(event => event.eventType),
      ['REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED', 'RESULT_RECORDED'],
    );

    const restarted = environment.reopen();
    assert.equal(restarted.getEffectRequest(prepared.effectId).approvalGrantId, grant.grantId);
    assert.equal(restarted.getApprovalGrant(grant.grantId).consumedByEffectId, prepared.effectId);
    assert.deepEqual(restarted.getEffectResult(prepared.effectId), result);
    assert.deepEqual(
      restarted.listAuthorityEvents(prepared.effectId).map(event => event.eventType),
      ['REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED', 'RESULT_RECORDED'],
    );
  }, { persistentDatabase: true });
});

await testAsync('approval issuer rejects an authenticated subject that does not own the request', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment);
    const prepared = await prepareWrite(environment, broker);

    assert.throws(
      () => environment.issuer.issue({
        effectId: prepared.effectId,
        authenticatedSubject: { actorType: 'user', actorId: 'attacker' },
      }),
      error => error?.code === 'APPROVAL_GRANT_SUBJECT_MISMATCH',
    );
    assert.equal(environment.repository.getEffectRequest(prepared.effectId).approvalGrantId, null);
  });
});

await testAsync('payload, grant-constraint, and workspace-revision drift all fail before provider invocation', async () => {
  await withEnvironment(async environment => {
    let providerCalls = 0;
    const provider = { async execute() { providerCalls += 1; return {}; } };
    const broker = createBroker(environment, { provider });

    const payloadCase = await prepareWrite(environment, broker, { relativePath: 'src/payload.js' });
    const payloadGrant = issue(environment, payloadCase.effectId);
    await assert.rejects(
      broker.execute({ effectId: payloadCase.effectId, grantId: payloadGrant.grantId, payload: 'changed\n' }),
      assertCode(EffectBrokerErrorCode.PAYLOAD_MISMATCH),
    );

    const constraintCase = await prepareWrite(environment, broker, { relativePath: 'src/constraint.js' });
    const constraintGrant = issue(environment, constraintCase.effectId);
    const mismatches = [
      grant => ({
        ...grant,
        constraints: { ...grant.constraints, allowedRealpaths: [path.join(environment.projectRoot, 'src/other.js')] },
      }),
      grant => ({
        ...grant,
        constraints: { ...grant.constraints, maxBytes: grant.constraints.maxBytes + 1 },
      }),
    ];
    for (const mutate of mismatches) {
      const forgedRepository = repositoryView(environment.repository, {
        getApprovalGrant(grantId) {
          const stored = environment.repository.getApprovalGrant(grantId);
          return stored ? mutate(stored) : null;
        },
      });
      const forgedBroker = createBroker(environment, { repository: forgedRepository, provider });
      await assert.rejects(
        forgedBroker.execute({
          effectId: constraintCase.effectId,
          grantId: constraintGrant.grantId,
          payload: 'after\n',
        }),
        assertCode(EffectBrokerErrorCode.CONSTRAINT_MISMATCH),
      );
    }

    const revisionCase = await prepareWrite(environment, broker, { relativePath: 'src/revision.js' });
    const revisionGrant = issue(environment, revisionCase.effectId);
    environment.revision.value = 'wsr1:revision-b';
    await assert.rejects(
      broker.execute({ effectId: revisionCase.effectId, grantId: revisionGrant.grantId, payload: 'after\n' }),
      assertCode(EffectBrokerErrorCode.WORKSPACE_STALE),
    );

    assert.equal(providerCalls, 0);
    for (const grant of [payloadGrant, constraintGrant, revisionGrant]) {
      assert.equal(environment.repository.getApprovalGrant(grant.grantId).consumedAt, null);
    }
  });
});

await testAsync('repository exact-request comparison rejects actor and origin drift without consuming the grant', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment);
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const stored = environment.repository.getEffectRequest(prepared.effectId);

    for (const changed of [
      { ...stored, actor: { ...stored.actor, id: 'attacker' }, approvalGrantId: grant.grantId },
      {
        ...stored,
        origin: { ...stored.origin, surface: 'http' },
        approvalGrantId: grant.grantId,
      },
    ]) {
      assert.throws(
        () => environment.repository.consumeApprovalGrant({ grantId: grant.grantId, request: changed }),
        error => error instanceof EffectAuthorityError
          && error.code === EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
      );
    }
    assert.equal(environment.repository.getApprovalGrant(grant.grantId).consumedAt, null);
  });
});

await testAsync('concurrent replay has one grant-consumption winner and one provider invocation', async () => {
  await withEnvironment(async environment => {
    const providerStarted = deferred();
    const providerCompletion = deferred();
    let providerCalls = 0;
    const broker = createBroker(environment, {
      provider: {
        async execute() {
          providerCalls += 1;
          providerStarted.resolve();
          return providerCompletion.promise;
        },
      },
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const execution = {
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    };

    const winner = broker.execute(execution);
    await providerStarted.promise;
    await assert.rejects(
      broker.execute(execution),
      assertCode(EffectAuthorityErrorCode.GRANT_CONSUMED),
    );
    providerCompletion.resolve({});
    const result = await winner;

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(providerCalls, 1);
    assert.equal(
      environment.repository.listAuthorityEvents(prepared.effectId)
        .filter(event => event.eventType === 'GRANT_CONSUMED').length,
      1,
    );
  });
});

await testAsync('revoked and expired grants have zero provider calls and remain without results', async () => {
  await withEnvironment(async environment => {
    let providerCalls = 0;
    const broker = createBroker(environment, {
      provider: { async execute() { providerCalls += 1; return {}; } },
    });

    const revokedCase = await prepareWrite(environment, broker, { relativePath: 'src/revoked.js' });
    const revokedGrant = issue(environment, revokedCase.effectId);
    environment.repository.revokeApprovalGrant({ grantId: revokedGrant.grantId, reason: 'user cancelled' });
    await assert.rejects(
      broker.execute({ effectId: revokedCase.effectId, grantId: revokedGrant.grantId, payload: 'after\n' }),
      assertCode(EffectAuthorityErrorCode.GRANT_REVOKED),
    );

    const expiredCase = await prepareWrite(environment, broker, { relativePath: 'src/expired.js' });
    const expiredGrant = issue(environment, expiredCase.effectId, { ttlMs: 10 });
    environment.clock.set(BASE_MS + 10);
    await assert.rejects(
      broker.execute({ effectId: expiredCase.effectId, grantId: expiredGrant.grantId, payload: 'after\n' }),
      assertCode(EffectAuthorityErrorCode.GRANT_EXPIRED),
    );

    assert.equal(providerCalls, 0);
    assert.equal(environment.repository.getEffectResult(revokedCase.effectId), null);
    assert.equal(environment.repository.getEffectResult(expiredCase.effectId), null);
  });
});

await testAsync('provider throw records a truthful failed terminal result after consuming authority', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment, {
      provider: {
        async execute() {
          const error = new Error('disk failure');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    });

    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.errorCode, 'EIO');
    assert.equal(environment.repository.getApprovalGrant(grant.grantId).consumedByEffectId, prepared.effectId);
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('timeout followed by provider settlement records timed_out and rejects the late completion', async () => {
  await withEnvironment(async environment => {
    const scheduler = createManualScheduler();
    const providerStarted = deferred();
    const providerCompletion = deferred();
    const broker = createBroker(environment, {
      scheduler,
      terminationGraceMs: 5,
      provider: {
        async execute() {
          providerStarted.resolve();
          return providerCompletion.promise;
        },
      },
    });
    const prepared = await prepareWrite(environment, broker, { timeoutMs: 10 });
    const grant = issue(environment, prepared.effectId);
    const execution = broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    });

    await providerStarted.promise;
    scheduler.fireNext(10);
    await waitUntil(() => scheduler.hasActive(5), 'termination grace timer');
    providerCompletion.resolve({ evidenceRefs: ['provider:settled-after-timeout'] });
    const result = await execution;

    assert.equal(result.terminalStatus, 'timed_out');
    assert.equal(result.errorCode, 'EFFECT_TIMED_OUT');
    assert.equal(result.lateCompletionRejected, true);
    assert.deepEqual(result.evidenceRefs, ['provider:settled-after-timeout']);
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('cancellation followed by provider settlement records cancelled and rejects the late completion', async () => {
  await withEnvironment(async environment => {
    const scheduler = createManualScheduler();
    const providerStarted = deferred();
    const providerCompletion = deferred();
    const controller = new AbortController();
    const broker = createBroker(environment, {
      scheduler,
      terminationGraceMs: 5,
      provider: {
        async execute() {
          providerStarted.resolve();
          return providerCompletion.promise;
        },
      },
    });
    const prepared = await prepareWrite(environment, broker, { timeoutMs: 20 });
    const grant = issue(environment, prepared.effectId);
    const execution = broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
      signal: controller.signal,
    });

    await providerStarted.promise;
    controller.abort('user cancelled');
    await waitUntil(() => scheduler.hasActive(5), 'termination grace timer');
    providerCompletion.resolve({ evidenceRefs: ['provider:settled-after-cancel'] });
    const result = await execution;

    assert.equal(result.terminalStatus, 'cancelled');
    assert.equal(result.errorCode, 'EFFECT_CANCELLED');
    assert.equal(result.lateCompletionRejected, true);
    assert.deepEqual(result.evidenceRefs, ['provider:settled-after-cancel']);
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('provider that does not settle within termination grace records durable orphaned truth', async () => {
  await withEnvironment(async environment => {
    const scheduler = createManualScheduler();
    const providerStarted = deferred();
    const broker = createBroker(environment, {
      scheduler,
      terminationGraceMs: 5,
      provider: {
        async execute() {
          providerStarted.resolve();
          return new Promise(() => {});
        },
      },
    });
    const prepared = await prepareWrite(environment, broker, { timeoutMs: 10 });
    const grant = issue(environment, prepared.effectId);
    const execution = broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    });

    await providerStarted.promise;
    scheduler.fireNext(10);
    await waitUntil(() => scheduler.hasActive(5), 'termination grace timer');
    scheduler.fireNext(5);
    const result = await execution;

    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.errorCode, 'EFFECT_ORPHANED');
    assert.equal(result.lateCompletionRejected, true);
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('result-storage failure withholds success after the effect and leaves no fabricated result', async () => {
  await withEnvironment(async environment => {
    let providerCalls = 0;
    const failingView = repositoryView(environment.repository, {
      recordEffectResult() {
        throw new Error('simulated durable result write failure');
      },
    });
    const broker = createBroker(environment, {
      repository: failingView,
      provider: { async execute() { providerCalls += 1; return {}; } },
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);

    await assert.rejects(
      broker.execute({ effectId: prepared.effectId, grantId: grant.grantId, payload: 'after\n' }),
      error => error instanceof EffectBrokerError
        && error.code === EffectBrokerErrorCode.RESULT_UNCOMMITTED,
    );
    assert.equal(providerCalls, 1);
    assert.equal(environment.repository.getApprovalGrant(grant.grantId).consumedByEffectId, prepared.effectId);
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
  });
});

await testAsync('repository and direct SQL cannot store success before the exact grant is consumed', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment);
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const request = environment.repository.getEffectRequest(prepared.effectId);
    const result = successfulResult(request, grant.grantId);

    assert.throws(
      () => environment.repository.recordEffectResult(result),
      error => error instanceof EffectAuthorityError
        && error.code === EffectAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
    );
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
    assert.throws(() => environment.db.prepare(`
      INSERT INTO m2_effect_results (
        effect_id, run_id, project_id, request_digest, approval_grant_id,
        terminal_status, result_json, completed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.effectId,
      result.runId,
      result.projectId,
      result.requestDigest,
      result.approvalGrantId,
      result.terminalStatus,
      canonicalStringify(result),
      BASE_MS,
    ), /M2_EFFECT_RESULT_AUTHORITY_MISSING/);
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
  });
});

await testAsync('path traversal and external symlink targets are rejected before request registration', async () => {
  await withEnvironment(async environment => {
    const outside = path.join(environment.directory, 'outside.txt');
    writeFileSync(outside, 'outside\n');
    symlinkSync(outside, path.join(environment.projectRoot, 'src/link.js'));
    const broker = createBroker(environment);

    await assert.rejects(prepareWrite(environment, broker, {
      relativePath: '../outside.txt',
      content: 'owned\n',
    }));
    await assert.rejects(prepareWrite(environment, broker, {
      relativePath: 'src/link.js',
      content: 'owned\n',
    }));

    assert.equal(environment.db.prepare('SELECT COUNT(*) AS count FROM m2_effect_requests').get().count, 0);
    assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
  });
});

await testAsync('existing hardlinked filesystem target is not written and records a failed terminal result', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/hardlinked.js');
    const alias = path.join(environment.directory, 'hardlink-alias.js');
    writeFileSync(target, 'before\n');
    linkSync(target, alias);
    const broker = createBroker(environment, { provider: createFilesystemEffectProvider() });
    const prepared = await prepareWrite(environment, broker, {
      relativePath: 'src/hardlinked.js',
      content: 'after\n',
    });
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    });

    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.errorCode, 'EFFECT_FS_HARDLINK_REJECTED');
    assert.equal(readFileSync(target, 'utf8'), 'before\n');
    assert.equal(readFileSync(alias, 'utf8'), 'before\n');
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

summary();
