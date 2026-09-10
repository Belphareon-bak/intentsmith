import { up as applyFileReadOutputs } from '../src/db/migrations/2026_09_09_109_m2_file_read_outputs.js';
import { EffectFileReadOutputRepository, readM2FileReadOutput } from '../src/effects/effect-file-read-output-repository.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as nativeFs from 'node:fs';
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
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyToolAuthority } from '../src/db/migrations/2026_08_24_074_m2_tool_authority.js';
import { up as applyToolEffectLinks } from '../src/db/migrations/2026_08_24_075_m2_tool_effect_links.js';
import { up as applyToolTruth } from '../src/db/migrations/2026_08_24_076_m2_tool_authority_truth.js';
import { up as applyEffectInvalidations } from '../src/db/migrations/2026_08_24_077_m2_effect_invalidations.js';
import { up as applyEffectSemanticAuthority } from '../src/db/migrations/2026_08_24_080_m2_effect_semantic_authority.js';
import { up as applyEffectResultSemanticAuthorityV2 } from '../src/db/migrations/2026_08_24_093_m2_effect_result_semantic_authority_v2.js';
import { up as applyPreexecutionApprovalTerminals } from '../src/db/migrations/2026_08_25_094_m2_preexecution_approval_terminals.js';
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
import { createM2FileReadPolicyPayload, M2_FILE_READ_MAX_BYTES, m2FileReadOutputEvidenceRef, createM2FileReadOutputEvidence, isM2FileReadOutputRequest, m2FileReadConversationOrigin } from '../contracts/m2/file-read-output-v1.js';
import { createFilesystemEffectProvider } from '../src/effects/filesystem-effect-provider.js';
import { processExecutionOwner } from '../src/effects/execution-owner.js';
import { suite, testAsync, summary } from './harness.js';

const BASE_MS = Date.parse('2026-08-24T12:00:00.000Z');
const PROJECT_ID = 17;
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'user-1' });

function tracingFilesystem({ failParentFsync = false, failSecondDescriptorRead = false } = {}) {
  const descriptorPaths = new Map();
  const events = [];
  let descriptorReads = 0;
  const fileSystem = {
    ...nativeFs,
    openSync(filePath, flags, mode) {
      const descriptor = nativeFs.openSync(filePath, flags, mode);
      descriptorPaths.set(descriptor, filePath);
      events.push(`open:${filePath}`);
      return descriptor;
    },
    fsyncSync(descriptor) {
      const filePath = descriptorPaths.get(descriptor);
      events.push(`fsync:${filePath}`);
      if (failParentFsync && filePath && nativeFs.statSync(filePath).isDirectory()) {
        const error = new Error('forced parent directory fsync failure');
        error.code = 'EIO';
        throw error;
      }
      return nativeFs.fsyncSync(descriptor);
    },
    closeSync(descriptor) {
      events.push(`close:${descriptorPaths.get(descriptor)}`);
      descriptorPaths.delete(descriptor);
      return nativeFs.closeSync(descriptor);
    },
    renameSync(from, to) {
      events.push(`rename:${from}->${to}`);
      return nativeFs.renameSync(from, to);
    },
    readFileSync(filePath, ...args) {
      if (Number.isInteger(filePath)) {
        descriptorReads += 1;
        if (failSecondDescriptorRead && descriptorReads === 2) {
          const error = new Error('forced post-write readback failure');
          error.code = 'EIO';
          throw error;
        }
      }
      return nativeFs.readFileSync(filePath, ...args);
    },
  };
  return { fileSystem, events };
}

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

function openDatabase(filename = ':memory:', { fileReadOutputs = true } = {}) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, path TEXT, status TEXT); CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, project_id INTEGER, state TEXT);");
  const hasAuthority = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_effect_requests'",
  ).get());
  if (!hasAuthority) {
    applyEffectAuthorityMigration(db);
    applyEffectAuthorityHardening(db);
    applyEffectExecutionClaims(db);
  }
  const hasInvalidations = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_effect_invalidations'",
  ).get());
  if (!hasInvalidations) {
    applyEffectClaimTruth(db);
    applyToolAuthority(db);
    applyToolEffectLinks(db);
    applyToolTruth(db);
    applyEffectInvalidations(db);
    applyEffectSemanticAuthority(db);
    applyEffectResultSemanticAuthorityV2(db);
    applyPreexecutionApprovalTerminals(db);
  }
  if (fileReadOutputs) applyFileReadOutputs(db);
  return db;
}

async function withEnvironment(callback, { persistentDatabase = false, fileReadOutputs = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-m2-effect-broker-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const databasePath = persistentDatabase ? path.join(directory, 'authority.sqlite') : ':memory:';
  const clock = mutableClock();
  const revision = { value: 'wsr1:revision-a' };
  const observations = [];
  let db = openDatabase(databasePath, { fileReadOutputs });
  db.prepare("INSERT INTO projects(id,path,status) VALUES(17,?,'active')").run(projectRoot);
  db.prepare("INSERT INTO conversations(id,project_id,state) VALUES('conversation-1',17,'active')").run();
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
  workspaceAuthority = environment.workspaceAuthority,
} = {}) {
  return createEffectBroker(repository, {
    providers: { 'fs.write': provider },
    clock: environment.clock.now,
    scheduleTimeout: scheduler?.schedule,
    terminationGraceMs,
    workspaceAuthority,
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

function grantForRequest(request, overrides = {}) {
  const base = {
    contract: M2_EFFECT_CONTRACT_KIND.APPROVAL_GRANT,
    version: 1,
    grantId: 'grant-forged',
    subject: { actorType: 'user', actorId: request.actor.id },
    scope: {
      runId: request.runId,
      projectId: request.origin.projectId,
      effectId: request.effectId,
      kind: request.kind,
      payloadDigest: request.payloadDigest,
      payloadBytes: request.payloadBytes,
      workspaceRevision: request.workspaceRevision,
    },
    constraints: {
      allowedRealpaths: [request.target.resolvedRealpath],
      allowedBinary: null,
      allowedArgvDigest: null,
      allowedOrigin: null,
      maxBytes: request.payloadBytes,
    },
    issuedAt: new Date(BASE_MS).toISOString(),
    expiresAt: new Date(BASE_MS + 60_000).toISOString(),
    singleUse: true,
    nonce: 'nonce-forged-00000001',
    consumedAt: null,
    consumedByEffectId: null,
    revokedAt: null,
    revocationReason: null,
  };
  return { ...base, ...overrides };
}

function insertGrantDirectly(db, grant) {
  return db.prepare(`
    INSERT INTO m2_approval_grants (
      grant_id, effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
      workspace_revision, nonce, grant_json, issued_at_ms, expires_at_ms,
      consumed_at_ms, consumed_by_effect_id, revoked_at_ms, revocation_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
  `).run(
    grant.grantId,
    grant.scope.effectId,
    grant.scope.runId,
    grant.scope.projectId,
    grant.scope.kind,
    grant.scope.payloadDigest,
    grant.scope.payloadBytes,
    grant.scope.workspaceRevision,
    grant.nonce,
    canonicalStringify(grant),
    Date.parse(grant.issuedAt),
    Date.parse(grant.expiresAt),
  );
}

function repositoryView(repository, overrides = {}) {
  const methods = [
    'registerEffectRequest',
    'getEffectRequest',
    'getApprovalGrant',
    'getEffectResult',
    'getEffectInvalidation',
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

function successfulEvidence(request) {
  return {
    changes: {
      paths: [request.target.relativePath],
      beforeDigest: null,
      afterDigest: request.payloadDigest,
      diffArtifact: null,
    },
    outputDigest: request.payloadDigest,
    evidenceRefs: [`effect:${request.effectId}:test-provider`],
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
    const idempotentResult = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });
    assert.deepEqual(idempotentResult, result);
    assert.equal(providerCalls, 1);

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

await testAsync('empty provider evidence is durably orphaned and can never fabricate fs.write success', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    let providerCalls = 0;
    const broker = createBroker(environment, {
      provider: {
        async execute() {
          providerCalls += 1;
          return {};
        },
      },
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);

    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.errorCode, 'EFFECT_PROVIDER_EVIDENCE_INVALID');
    assert.equal(result.rollback.required, true);
    assert.equal(result.rollback.status, 'pending');
    assert.equal(result.lateCompletionRejected, true);
    assert.equal(readFileSync(target, 'utf8'), 'before\n');
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('filesystem success is withheld until the parent directory entry is fsynced', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    const trace = tracingFilesystem();
    const broker = createBroker(environment, {
      provider: createFilesystemEffectProvider({ fileSystem: trace.fileSystem }),
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    const renameIndex = trace.events.findIndex(event => event.startsWith('rename:'));
    const tempFsyncIndex = trace.events.findIndex(event => (
      event.startsWith('fsync:') && event.includes('.intentsmith-')
    ));
    const directoryFsyncIndex = trace.events.findIndex(event => (
      event === `fsync:${path.dirname(target)}`
    ));
    assert.ok(tempFsyncIndex >= 0 && tempFsyncIndex < renameIndex);
    assert.ok(renameIndex >= 0 && renameIndex < directoryFsyncIndex);
    assert.equal(result.terminalStatus, 'succeeded');
  });
});

await testAsync('parent directory fsync failure records an orphan with rollback evidence, never success', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    const trace = tracingFilesystem({ failParentFsync: true });
    const broker = createBroker(environment, {
      provider: createFilesystemEffectProvider({ fileSystem: trace.fileSystem }),
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.errorCode, 'PROJECT_WRITE_DURABILITY_UNCONFIRMED');
    assert.equal(result.rollback.required, true);
    assert.equal(result.rollback.status, 'pending');
    assert.equal(result.lateCompletionRejected, true);
    assert.equal(readFileSync(target, 'utf8'), 'after\n');
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('missing parent is rejected before mkdir and produces no filesystem side effect', async () => {
  await withEnvironment(async environment => {
    const missingParent = path.join(environment.projectRoot, 'missing', 'nested');
    const broker = createBroker(environment, {
      provider: createFilesystemEffectProvider(),
    });
    const prepared = await prepareWrite(environment, broker, {
      relativePath: 'missing/nested/result.md',
    });
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.errorCode, 'PROJECT_PATH_VIOLATION');
    assert.deepEqual(result.evidenceRefs, [
      `effect:${prepared.effectId}:provider-pre-effect-failed`,
    ]);
    assert.equal(nativeFs.existsSync(missingParent), false);
    assert.equal(result.rollback.required, false);
  });
});

await testAsync('M2 writer never invokes legacy mkdir even when its race hook could recreate a parent', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    let mkdirCalls = 0;
    const racingFs = {
      ...nativeFs,
      mkdirSync(directory, options) {
        mkdirCalls += 1;
        // This is the adversarial hook that used to remove and then recreate
        // an authorized parent inside recursive mkdir. It must be unreachable
        // from the M2 provider.
        rmSync(directory, { recursive: true, force: true });
        return nativeFs.mkdirSync(directory, options);
      },
    };
    const broker = createBroker(environment, {
      provider: createFilesystemEffectProvider({ fileSystem: racingFs }),
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(mkdirCalls, 0);
    assert.equal(readFileSync(target, 'utf8'), 'after\n');
  });
});

await testAsync('post-write readback failure records applied orphan and pending rollback', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/app.js');
    writeFileSync(target, 'before\n');
    const trace = tracingFilesystem({ failSecondDescriptorRead: true });
    const broker = createBroker(environment, {
      provider: createFilesystemEffectProvider({ fileSystem: trace.fileSystem }),
    });
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: Buffer.from('after\n'),
    });

    assert.equal(readFileSync(target, 'utf8'), 'after\n');
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.errorCode, 'EIO');
    assert.deepEqual(result.changes.paths, ['src/app.js']);
    assert.equal(result.changes.beforeDigest?.startsWith('sha256:'), true);
    assert.equal(result.changes.afterDigest, null);
    assert.equal(result.rollback.required, true);
    assert.equal(result.rollback.status, 'pending');
    assert.equal(result.lateCompletionRejected, true);
  });
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

await testAsync('repository and direct SQL reject grant constraints not derived from the request', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment);
    const prepared = await prepareWrite(environment, broker);
    const request = environment.repository.getEffectRequest(prepared.effectId);
    const forged = grantForRequest(request, {
      constraints: {
        ...grantForRequest(request).constraints,
        allowedRealpaths: [path.join(environment.projectRoot, 'src/other.js')],
      },
    });

    assert.throws(
      () => environment.repository.issueApprovalGrant(forged),
      error => error instanceof EffectAuthorityError
        && error.code === EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
    );
    assert.throws(
      () => insertGrantDirectly(environment.db, forged),
      /M2_APPROVAL_GRANT_SCOPE_MISMATCH/,
    );
    assert.equal(environment.repository.getApprovalGrant(forged.grantId), null);
  });
});

await testAsync('prepare retry reuses the original timestamp and immutable request after clock advance', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment);
    const identity = environment.nextIdentity();
    const first = await prepareWrite(environment, broker, identity);
    environment.clock.set(BASE_MS + 30_000);
    const retry = await prepareWrite(environment, broker, identity);

    assert.deepEqual(retry.request, first.request);
    assert.equal(retry.effectId, first.effectId);
    assert.deepEqual(
      environment.repository.listAuthorityEvents(first.effectId).map(event => event.eventType),
      ['REQUEST_REGISTERED'],
    );
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

    assert.equal(providerCalls, 0);
    for (const grant of [payloadGrant, constraintGrant]) {
      assert.equal(environment.repository.getApprovalGrant(grant.grantId).consumedAt, null);
    }
  });
});

await testAsync('workspace drift after approval consumes authority and records one failed terminal', async () => {
  await withEnvironment(async environment => {
    let providerCalls = 0;
    const broker = createBroker(environment, {
      provider: { async execute() { providerCalls += 1; return {}; } },
    });
    const prepared = await prepareWrite(environment, broker, { relativePath: 'src/revision.js' });
    const grant = issue(environment, prepared.effectId);
    environment.revision.value = 'wsr1:revision-b';

    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    });

    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.errorCode, EffectBrokerErrorCode.WORKSPACE_STALE);
    assert.equal(providerCalls, 0);
    assert.equal(
      environment.repository.getApprovalGrant(grant.grantId).consumedByEffectId,
      prepared.effectId,
    );
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('cancellation during a non-cooperative workspace observation registers no effect', async () => {
  await withEnvironment(async environment => {
    const observationStarted = deferred();
    const observationCompletion = deferred();
    const controller = new AbortController();
    const broker = createBroker(environment, {
      workspaceAuthority: {
        async observe() {
          observationStarted.resolve();
          return observationCompletion.promise;
        },
      },
    });
    const preparation = prepareWrite(environment, broker, { signal: controller.signal });
    await observationStarted.promise;
    controller.abort('tool-timeout');
    observationCompletion.resolve({
      canonicalRoot: realpathSync(environment.projectRoot),
      workspaceRevision: environment.revision.value,
    });

    await assert.rejects(
      preparation,
      assertCode(EffectBrokerErrorCode.INPUT_INVALID),
    );
    assert.equal(
      environment.db.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      0,
    );
  });
});

await testAsync('execution timeout during workspace observation is terminal and never reaches provider', async () => {
  await withEnvironment(async environment => {
    const scheduler = createManualScheduler();
    const observationStarted = deferred();
    const observationCompletion = deferred();
    let providerCalls = 0;
    const broker = createBroker(environment, {
      scheduler,
      workspaceAuthority: {
        async observe() {
          observationStarted.resolve();
          return observationCompletion.promise;
        },
      },
      provider: { async execute() { providerCalls += 1; return {}; } },
    });
    const prepared = await prepareWrite(environment, createBroker(environment));
    const grant = issue(environment, prepared.effectId);
    const execution = broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'after\n',
    });
    await observationStarted.promise;
    scheduler.fireNext(50);
    const result = await execution;

    assert.equal(result.terminalStatus, 'timed_out');
    assert.equal(result.errorCode, 'EFFECT_TIMED_OUT');
    assert.equal(result.lateCompletionRejected, false);
    assert.equal(result.rollback.required, false);
    assert.deepEqual(result.changes.paths, []);
    assert.equal(providerCalls, 0);
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
    observationCompletion.resolve({
      canonicalRoot: realpathSync(environment.projectRoot),
      workspaceRevision: environment.revision.value,
    });
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
        () => environment.repository.consumeApprovalGrant({
          grantId: grant.grantId,
          request: changed,
          executionOwner: processExecutionOwner,
        }),
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
    providerCompletion.resolve(successfulEvidence(prepared.request));
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

await testAsync('revoked and expired grants have zero provider calls and exact cancelled terminals', async () => {
  await withEnvironment(async environment => {
    let providerCalls = 0;
    const broker = createBroker(environment, {
      provider: { async execute() { providerCalls += 1; return {}; } },
    });

    const revokedCase = await prepareWrite(environment, broker, { relativePath: 'src/revoked.js' });
    const revokedGrant = issue(environment, revokedCase.effectId);
    environment.repository.revokeApprovalGrant({ grantId: revokedGrant.grantId, reason: 'user cancelled' });
    const revokedResult = await broker.execute({
      effectId: revokedCase.effectId,
      grantId: revokedGrant.grantId,
      payload: 'after\n',
    });

    const expiredCase = await prepareWrite(environment, broker, { relativePath: 'src/expired.js' });
    const expiredGrant = issue(environment, expiredCase.effectId, { ttlMs: 10 });
    environment.clock.set(BASE_MS + 10);
    await assert.rejects(
      broker.execute({ effectId: expiredCase.effectId, grantId: expiredGrant.grantId, payload: 'after\n' }),
      assertCode(EffectAuthorityErrorCode.GRANT_EXPIRED),
    );
    const expiredResult = environment.repository.terminalizeInactiveApprovalGrant(expiredCase.effectId);

    assert.equal(providerCalls, 0);
    assert.equal(revokedResult.terminalStatus, 'cancelled');
    assert.equal(revokedResult.errorCode, 'APPROVAL_GRANT_REVOKED');
    assert.equal(expiredResult.terminalStatus, 'cancelled');
    assert.equal(expiredResult.errorCode, 'APPROVAL_GRANT_EXPIRED');
    for (const result of [revokedResult, expiredResult]) {
      assert.deepEqual(result.rollback, {
        required: false,
        status: 'not_required',
        evidenceRef: null,
      });
      assert.equal(result.lateCompletionRejected, false);
    }
    assert.deepEqual(environment.repository.getEffectResult(revokedCase.effectId), revokedResult);
    assert.deepEqual(environment.repository.getEffectResult(expiredCase.effectId), expiredResult);
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
    assert.deepEqual(result.evidenceRefs, [
      `effect:${prepared.effectId}:provider-pre-effect-failed`,
    ]);
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
    assert.equal(result.rollback.required, true);
    assert.equal(result.rollback.status, 'pending');
    assert.deepEqual(result.changes.paths, ['src/app.js']);
    assert.deepEqual(result.evidenceRefs, [
      `effect:${prepared.effectId}:timed_out-after-provider-start`,
      'provider:settled-after-timeout',
    ]);
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
    assert.equal(result.rollback.required, true);
    assert.equal(result.rollback.status, 'pending');
    assert.deepEqual(result.changes.paths, ['src/app.js']);
    assert.deepEqual(result.evidenceRefs, [
      `effect:${prepared.effectId}:cancelled-after-provider-start`,
      'provider:settled-after-cancel',
    ]);
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
    assert.equal(result.rollback.required, true);
    assert.equal(result.rollback.status, 'pending');
    assert.deepEqual(result.changes.paths, ['src/app.js']);
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

await testAsync('repository and direct SQL reject an orphaned fs.write with no rollback path evidence', async () => {
  await withEnvironment(async environment => {
    const broker = createBroker(environment);
    const prepared = await prepareWrite(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const request = environment.repository.getEffectRequest(prepared.effectId);
    environment.repository.consumeApprovalGrant({
      grantId: grant.grantId,
      request: { ...request, approvalGrantId: grant.grantId },
      executionOwner: processExecutionOwner,
    });
    const forged = {
      ...successfulResult(request, grant.grantId),
      terminalStatus: 'orphaned',
      changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
      rollback: { required: false, status: 'not_required', evidenceRef: null },
      outputDigest: null,
      errorCode: 'EFFECT_ORPHANED',
      lateCompletionRejected: true,
    };

    assert.throws(
      () => environment.repository.recordEffectResult(forged),
      error => error instanceof EffectAuthorityError
        && error.code === EffectAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
    );
    assert.throws(() => environment.db.prepare(`
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
      canonicalStringify(forged),
      BASE_MS,
    ), /M2_EFFECT_RESULT_SEMANTIC_AUTHORITY_MISMATCH/);
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
    assert.deepEqual(result.evidenceRefs, [
      `effect:${prepared.effectId}:provider-pre-effect-failed`,
    ]);
    assert.equal(readFileSync(target, 'utf8'), 'before\n');
    assert.equal(readFileSync(alias, 'utf8'), 'before\n');
    assert.deepEqual(environment.repository.getEffectResult(prepared.effectId), result);
  });
});

await testAsync('filesystem beforeDigest hashes exact pre-existing bytes without UTF-8 replacement', async () => {
  await withEnvironment(async environment => {
    const target = path.join(environment.projectRoot, 'src/non-utf8.js');
    const beforeBytes = Buffer.from([0xff, 0xfe, 0x00, 0x61]);
    writeFileSync(target, beforeBytes);
    const broker = createBroker(environment, { provider: createFilesystemEffectProvider() });
    const prepared = await prepareWrite(environment, broker, {
      relativePath: 'src/non-utf8.js',
      content: 'valid after\n',
    });
    const grant = issue(environment, prepared.effectId);
    const result = await broker.execute({
      effectId: prepared.effectId,
      grantId: grant.grantId,
      payload: 'valid after\n',
    });

    const expectedBeforeDigest = `sha256:${createHash('sha256').update(beforeBytes).digest('hex')}`;
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(result.changes.beforeDigest, expectedBeforeDigest);
    assert.equal(readFileSync(target, 'utf8'), 'valid after\n');
  });
});
// Exact-byte read provider regressions.
async function withReadProviderEnvironment(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-read-provider-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(projectRoot);
  const request = {
    kind: 'fs.read', effectId: `effect:${'a'.repeat(64)}`,
    target: { canonicalRoot: realpathSync(projectRoot), relativePath: 'file.bin' },
  };
  const target = path.join(projectRoot, 'file.bin');
  const run = (options = {}, payload = createM2FileReadPolicyPayload(), signal = null) => (
    createFilesystemEffectProvider(options).execute({ request, payload, signal })
  );
  try { await callback({ directory, projectRoot, target, request, run }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

await testAsync('fs.read returns exact binary and empty bytes with digest evidence and no write claims', async () => {
  await withReadProviderEnvironment(async ({ target, request, run }) => {
    const fileSystem = { ...nativeFs, readFileSync() { assert.fail('Unbounded read'); } };
    for (const bytes of [Buffer.from([0, 0xff, 0xfe, 10, 0xc3, 0xa9]), Buffer.alloc(0)]) {
      writeFileSync(target, bytes);
      const result = await run({ fileSystem });
      assert.deepEqual(result.fileReadBytes, bytes);
      assert.equal(result.outputDigest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
      assert.deepEqual(result.evidenceRefs, [m2FileReadOutputEvidenceRef(request.effectId)]);
      assert.equal(Object.hasOwn(result, 'changes'), false);
      assert.equal(Object.hasOwn(result, 'rollback'), false);
      assert.deepEqual(readFileSync(target), bytes);
    }
  });
});

await testAsync('fs.read accepts the full 1 MiB limit and rejects one extra byte before reading', async () => {
  await withReadProviderEnvironment(async ({ target, run }) => {
    const bytes = Buffer.alloc(M2_FILE_READ_MAX_BYTES, 0xa5);
    writeFileSync(target, bytes);
    assert.deepEqual((await run()).fileReadBytes, bytes);
    nativeFs.appendFileSync(target, Buffer.from([0]));
    let reads = 0;
    const fileSystem = { ...nativeFs, readSync(...args) { reads++; return nativeFs.readSync(...args); } };
    await assert.rejects(run({ fileSystem }), { code: 'EFFECT_FS_READ_TOO_LARGE' });
    assert.equal(reads, 0);
  });
});

await testAsync('fs.read honors both exact policy and lower configured ceiling without truncation', async () => {
  await withReadProviderEnvironment(async ({ target, run }) => {
    writeFileSync(target, 'four');
    await assert.rejects(run({}, createM2FileReadPolicyPayload(3)), { code: 'EFFECT_FS_READ_TOO_LARGE' });
    await assert.rejects(run({ maxReadBytes: 3 }), { code: 'EFFECT_FS_READ_TOO_LARGE' });
    assert.equal((await run({ maxReadBytes: 4 }, createM2FileReadPolicyPayload(4))).fileReadBytes.toString(), 'four');
    for (const maxReadBytes of [0, -1, 1.5, NaN, Infinity, M2_FILE_READ_MAX_BYTES + 1]) {
      assert.throws(() => createFilesystemEffectProvider({ maxReadBytes }), TypeError);
    }
  });
});

await testAsync('fs.read detects growth beyond the limit with bounded allocation and closes the descriptor', async () => {
  await withReadProviderEnvironment(async ({ target, run }) => {
    writeFileSync(target, Buffer.alloc(70_000));
    let reads = 0;
    let closed = 0;
    const fileSystem = {
      ...nativeFs,
      readSync(...args) {
        assert.ok(args[1].length <= 65_536);
        const count = nativeFs.readSync(...args);
        if (++reads === 1) nativeFs.appendFileSync(target, Buffer.alloc(10_000));
        return count;
      },
      closeSync(fd) { closed++; return nativeFs.closeSync(fd); },
    };
    await assert.rejects(run({ fileSystem }, createM2FileReadPolicyPayload(70_000)), {
      code: 'EFFECT_FS_READ_TOO_LARGE',
    });
    assert.equal(reads, 2);
    assert.equal(closed, 1);
  });
});

await testAsync('fs.read rejects missing, directory, hardlinked and retargeted names without releasing bytes', async () => {
  await withReadProviderEnvironment(async ({ directory, projectRoot, target, run }) => {
    await assert.rejects(run(), { code: 'EFFECT_FS_READ_NOT_FOUND' });
    mkdirSync(target);
    await assert.rejects(run(), error => error.reason === 'not_regular_file');
    rmSync(target, { recursive: true });
    const outside = path.join(directory, 'outside.bin');
    writeFileSync(outside, 'private');
    linkSync(outside, target);
    await assert.rejects(run(), { code: 'EFFECT_FS_HARDLINK_REJECTED' });
    rmSync(target);
    symlinkSync(outside, target);
    await assert.rejects(run(), { code: 'PROJECT_PATH_VIOLATION' });
    rmSync(target);
    const inside = path.join(projectRoot, 'different.bin');
    writeFileSync(inside, 'different');
    symlinkSync(inside, target);
    await assert.rejects(run(), error => error.reason === 'canonical_target_mismatch');
    assert.equal(readFileSync(outside, 'utf8'), 'private');
  });
});

await testAsync('fs.read cancels before opening and during bounded read without returning content', async () => {
  await withReadProviderEnvironment(async ({ target, run }) => {
    writeFileSync(target, Buffer.alloc(70_000));
    const before = new AbortController();
    before.abort();
    await assert.rejects(run({ fileSystem: { ...nativeFs, openSync() { assert.fail('opened after cancel'); } } },
      createM2FileReadPolicyPayload(), before.signal), { code: 'EFFECT_CANCELLED' });
    const during = new AbortController();
    let closed = 0;
    const fileSystem = {
      ...nativeFs,
      readSync(...args) { const count = nativeFs.readSync(...args); during.abort(); return count; },
      closeSync(fd) { closed++; return nativeFs.closeSync(fd); },
    };
    await assert.rejects(run({ fileSystem }, createM2FileReadPolicyPayload(), during.signal), { code: 'EFFECT_CANCELLED' });
    assert.equal(closed, 1);
  });
});

await testAsync('fs.read rejects inode replacement and same-length mutation during read', async () => {
  await withReadProviderEnvironment(async ({ target, run }) => {
    for (const replace of [true, false]) {
      writeFileSync(target, Buffer.alloc(70_000, 1));
      let changed = false;
      const fileSystem = {
        ...nativeFs,
        readSync(...args) {
          const count = nativeFs.readSync(...args);
          if (!changed) {
            changed = true;
            if (replace) { rmSync(target); writeFileSync(target, Buffer.alloc(70_000, 2)); }
            else {
              writeFileSync(target, Buffer.alloc(70_000, 3));
              nativeFs.utimesSync(target, new Date(), new Date(Date.now() + 10_000));
            }
          }
          return count;
        },
      };
      await assert.rejects(run({ fileSystem }), { code: 'PROJECT_PATH_VIOLATION' });
    }
  });
});

await testAsync('fs.read rejects malformed, empty and noncanonical policy before filesystem access', async () => {
  await withReadProviderEnvironment(async ({ run }) => {
    const fileSystem = { ...nativeFs, realpathSync() { assert.fail('policy must be checked before I/O'); } };
    for (const text of ['', '{}', '{"maxOutputBytes":4,"format":"bytes@1"}', '{"format":"bytes@1","maxOutputBytes":0}', '{"format":"bytes@1","maxOutputBytes":4,"extra":true}']) {
      await assert.rejects(run({ fileSystem }, Buffer.from(text)), error => error.code !== 'ERR_ASSERTION');
    }
  });
});


suite('Immutable file.read output authority');

async function prepareRead(environment, broker, overrides = {}) {
  return broker.prepareFilesystemRead({
    ...environment.nextIdentity(), actor: { type: 'user', id: 'user-1' },
    origin: { surface: 'studio', sessionId: 'session-1', conversationId: m2FileReadConversationOrigin('conversation-1'), projectId: PROJECT_ID },
    projectId: PROJECT_ID, projectRoot: environment.projectRoot,
    relativePath: 'src/app.js', timeoutMs: 50, ...overrides,
  });
}

function createReadBroker(environment, provider = createFilesystemEffectProvider(), extras = {}) {
  return createEffectBroker(environment.repository, { providers: { 'fs.read': provider },
    clock: environment.clock.now, workspaceAuthority: environment.workspaceAuthority, ...extras });
}

function readResult(request, bytes, status = 'succeeded') {
  return {
    contract: 'EffectResult', version: 1, effectId: request.effectId, runId: request.runId,
    projectId: request.origin.projectId, requestDigest: computeEffectRequestDigest(request),
    approvalGrantId: request.approvalGrantId, terminalStatus: status,
    startedAt: new Date(BASE_MS).toISOString(), completedAt: new Date(BASE_MS).toISOString(),
    process: { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null },
    changes: { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null },
    network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
    rollback: { required: false, status: 'not_required', evidenceRef: null },
    outputDigest: status === 'succeeded' ? `sha256:${createHash('sha256').update(bytes).digest('hex')}` : null,
    errorCode: status === 'succeeded' ? null : 'EFFECT_CANCELLED',
    evidenceRefs: [m2FileReadOutputEvidenceRef(request.effectId)], lateCompletionRejected: false,
  };
}

await testAsync('file.read preparation binds policy and requires a grant without publishing output', async () => {
  await withEnvironment(async environment => {
    writeFileSync(path.join(environment.projectRoot, 'src/app.js'), 'private-byte-canary');
    let calls = 0;
    const broker = createReadBroker(environment, { async execute() { calls++; assert.fail('no approval'); } });
    const prepared = await prepareRead(environment, broker);
    assert.equal(prepared.state, 'approval_required');
    assert.equal(prepared.request.requiredCapability, 'project.fs.read');
    assert.equal(prepared.request.payloadBytes, createM2FileReadPolicyPayload().length);
    assert.equal(calls, 0);
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    await assert.rejects(broker.execute({ effectId: prepared.effectId, grantId: 'missing', payload: createM2FileReadPolicyPayload() }));
    assert.equal(calls, 0);
  });
});

await testAsync('approved read stores exact binary and empty bytes; replay survives file deletion and database reopen', async () => {
  for (const bytes of [Buffer.from([0, 255, 195, 40]), Buffer.alloc(0)]) {
    await withEnvironment(async environment => {
      writeFileSync(path.join(environment.projectRoot, 'src/app.js'), bytes);
      const broker = createReadBroker(environment);
      const prepared = await prepareRead(environment, broker);
      const grant = issue(environment, prepared.effectId);
      const invocation = { effectId: prepared.effectId, grantId: grant.grantId, payload: createM2FileReadPolicyPayload() };
      const result = await broker.execute(invocation);
      assert.equal(result.terminalStatus, 'succeeded');
      const request = environment.repository.getEffectRequest(result.effectId);
      const output = readM2FileReadOutput(environment.db, request, result);
      assert.deepEqual(output.bytes, bytes);
      assert.equal(output.evidence.byteLength, bytes.length);
      assert.equal(JSON.stringify(result).includes('fileReadBytes'), false);
      rmSync(path.join(environment.projectRoot, 'src/app.js'));
      environment.reopen();
      const reopened = createReadBroker(environment, { async execute() { assert.fail('replay read provider'); } });
      assert.deepEqual(await reopened.execute(invocation), result);
      assert.deepEqual(readM2FileReadOutput(environment.db, environment.repository.getEffectRequest(result.effectId), result).bytes, bytes);
    }, { persistentDatabase: true });
  }
});

await testAsync('generic terminal writer and direct output insertion cannot bypass atomic read authority', async () => {
  await withEnvironment(async environment => {
    const broker = createReadBroker(environment);
    const prepared = await prepareRead(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const request = { ...prepared.request, approvalGrantId: grant.grantId };
    environment.repository.consumeApprovalGrant({ grantId: grant.grantId, request, executionOwner: processExecutionOwner });
    const bytes = Buffer.from('private-byte-canary');
    const result = readResult(request, bytes);
    assert.throws(() => environment.repository.recordEffectResult(result), error => error.details?.cause?.includes('M2_FILE_READ_RESULT_OUTPUT_MISMATCH'));
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
    const insertResult = () => environment.db.prepare(`
      INSERT INTO m2_effect_results(effect_id, run_id, project_id, request_digest,
        approval_grant_id, terminal_status, result_json, completed_at_ms) VALUES(?,?,?,?,?,?,?,?)
    `).run(result.effectId, result.runId, result.projectId, result.requestDigest,
      result.approvalGrantId, result.terminalStatus, canonicalStringify(result), BASE_MS);
    assert.throws(insertResult, /M2_FILE_READ_RESULT_OUTPUT_MISMATCH/);
    const evidence = createM2FileReadOutputEvidence(request, result, bytes);
    const insertOutput = (metadata = evidence, payload = bytes, projectId = PROJECT_ID) => environment.db.prepare(`
      INSERT INTO m2_file_read_outputs(effect_id, project_id, conversation_id, project_path, request_digest, metadata_json, payload)
      VALUES(?,?,?,?,?,?,?)
    `).run(request.effectId, projectId, 'conversation-1', environment.projectRoot, result.requestDigest, canonicalStringify(metadata), payload);
    assert.throws(() => insertOutput(), /FOREIGN KEY constraint failed/);
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    assert.throws(() => insertOutput({ ...evidence, extra: true }), /REQUEST_OR_BYTES_MISMATCH/);
    assert.throws(() => insertOutput(evidence, Buffer.from('wrong bytes')), /REQUEST_OR_BYTES_MISMATCH/);
    assert.throws(() => insertOutput(evidence, bytes, PROJECT_ID + 1), /REQUEST_OR_BYTES_MISMATCH/);
    const writer = new EffectFileReadOutputRepository(environment.repository);
    const execute = environment.db.transaction(() => {
      writer.recordSuccessfulFileRead({ request, result, bytes });
      throw new Error('rollback-entire-authority');
    });
    assert.throws(execute, /rollback-entire-authority/);
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
    writer.recordSuccessfulFileRead({ request, result, bytes });
    assert.throws(() => environment.db.prepare('UPDATE m2_file_read_outputs SET payload = ?').run(Buffer.from('tampered')), /IMMUTABLE/);
    assert.throws(() => environment.db.exec('DELETE FROM m2_file_read_outputs'), /IMMUTABLE/);
    assert.equal(JSON.stringify(environment.db.prepare('SELECT result_json FROM m2_effect_results').all()).includes('private-byte-canary'), false);
    assert.equal(JSON.stringify(environment.db.prepare('SELECT details_json FROM m2_effect_authority_events').all()).includes('private-byte-canary'), false);
  });
});

await testAsync('failed terminal insertion rolls back file bytes and withholds success', async () => {
  await withEnvironment(async environment => {
    writeFileSync(path.join(environment.projectRoot, 'src/app.js'), 'private-byte-canary');
    const broker = createReadBroker(environment);
    const prepared = await prepareRead(environment, broker);
    const grant = issue(environment, prepared.effectId);
    environment.db.exec("CREATE TRIGGER fail_read_terminal BEFORE INSERT ON m2_effect_results BEGIN SELECT RAISE(ABORT, 'injected terminal storage failure'); END");
    await assert.rejects(broker.execute({ effectId: prepared.effectId, grantId: grant.grantId, payload: createM2FileReadPolicyPayload() }), { code: 'EFFECT_RESULT_UNCOMMITTED' });
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    assert.equal(environment.repository.getEffectResult(prepared.effectId), null);
    assert.ok(environment.repository.getApprovalGrant(grant.grantId).consumedAt);
  });
});

await testAsync('invalid read provider evidence is a failed read without rollback or published bytes', async () => {
  await withEnvironment(async environment => {
    for (const evidence of [{}, { fileReadBytes: Buffer.from('x'), outputDigest: 'sha256:' + '0'.repeat(64), evidenceRefs: [] }]) {
      const broker = createReadBroker(environment, { async execute() { return evidence; } });
      const prepared = await prepareRead(environment, broker);
      const grant = issue(environment, prepared.effectId);
      const result = await broker.execute({ effectId: prepared.effectId, grantId: grant.grantId, payload: createM2FileReadPolicyPayload() });
      assert.equal(result.terminalStatus, 'failed');
      assert.equal(result.errorCode, 'EFFECT_PROVIDER_EVIDENCE_INVALID');
      assert.equal(result.outputDigest, null);
      assert.equal(result.rollback.required, false);
      assert.equal(result.lateCompletionRejected, false);
      assert.deepEqual(result.changes.paths, []);
    }
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
  });
});

await testAsync('read cancellation rejects late bytes without write rollback semantics', async () => {
  await withEnvironment(async environment => {
    const controller = new AbortController();
    let finish;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const broker = createReadBroker(environment, { execute({ request }) {
      started();
      return new Promise(resolve => { finish = () => resolve({ fileReadBytes: Buffer.from('late-secret'),
        outputDigest: `sha256:${createHash('sha256').update('late-secret').digest('hex')}`,
        evidenceRefs: [m2FileReadOutputEvidenceRef(request.effectId)] }); });
    } }, { terminationGraceMs: 10 });
    const prepared = await prepareRead(environment, broker);
    const grant = issue(environment, prepared.effectId);
    const execution = broker.execute({ effectId: prepared.effectId, grantId: grant.grantId, payload: createM2FileReadPolicyPayload(), signal: controller.signal });
    await ready;
    controller.abort();
    finish();
    const result = await execution;
    assert.equal(result.terminalStatus, 'cancelled');
    assert.equal(result.outputDigest, null);
    assert.equal(result.rollback.required, false);
    assert.equal(result.lateCompletionRejected, false);
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
  });
});

await testAsync('private output tampering and schema drift fail closed on readback and migration', async () => {
  await withEnvironment(async environment => {
    writeFileSync(path.join(environment.projectRoot, 'src/app.js'), 'private-byte-canary');
    const broker = createReadBroker(environment);
    const prepared = await prepareRead(environment, broker);
    const grant = issue(environment, prepared.effectId);
    await broker.execute({ effectId: prepared.effectId, grantId: grant.grantId, payload: createM2FileReadPolicyPayload() });
    environment.db.exec('DROP TRIGGER trg_m2_file_read_output_no_update');
    environment.db.prepare('UPDATE m2_file_read_outputs SET payload = ?').run(Buffer.from('tampered-byte-canary'));
    assert.throws(() => environment.repository.getEffectResult(prepared.effectId), error => error.details?.cause?.includes('stored bytes or binding'));
    assert.throws(() => applyFileReadOutputs(environment.db), /SOURCE_SCHEMA_MISMATCH/);
  });
});


await testAsync('only the fixed read@2 policy can publish immutable output; legacy and lower leaf policies remain distinct', async () => {
  await withEnvironment(async environment => {
    const broker = createReadBroker(environment);
    const prepared = await prepareRead(environment, broker);
    assert.equal(isM2FileReadOutputRequest(prepared.request), true);
    for (const payload of [Buffer.alloc(0), createM2FileReadPolicyPayload(4)]) {
      const request = { ...prepared.request, payloadBytes: payload.length,
        payloadDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}` };
      assert.equal(isM2FileReadOutputRequest(request), false);
      assert.throws(() => createM2FileReadOutputEvidence(request, readResult(request, Buffer.from('x')), Buffer.from('x')));
    }
  });
});


await testAsync('109 upgrades populated write and legacy read authority without rewriting any historical row', async () => {
  await withEnvironment(async environment => {
    writeFileSync(path.join(environment.projectRoot, 'src/app.js'), 'before');
    const broker = createBroker(environment, { provider: createFilesystemEffectProvider() });
    const write = await prepareWrite(environment, broker);
    const writeGrant = issue(environment, write.effectId);
    const writeResult = await broker.execute({ effectId: write.effectId, grantId: writeGrant.grantId, payload: Buffer.from('after\n') });
    const legacy = { ...write.request, effectId: 'effect:' + 'b'.repeat(64), idempotencyKey: 'legacy-read',
      kind: 'fs.read', payloadBytes: 0, payloadDigest: `sha256:${createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`,
      requiredCapability: 'project.fs.read', riskClass: 'read' };
    environment.repository.registerEffectRequest(legacy);
    const legacyGrant = issue(environment, legacy.effectId);
    const bound = { ...legacy, approvalGrantId: legacyGrant.grantId };
    environment.repository.consumeApprovalGrant({ grantId: legacyGrant.grantId, request: bound, executionOwner: processExecutionOwner });
    const legacyResult = { ...readResult(bound, Buffer.from('historical')), evidenceRefs: ['legacy-read-evidence'] };
    environment.repository.recordEffectResult(legacyResult);
    const tables = ['m2_effect_requests', 'm2_effect_results', 'm2_approval_grants', 'm2_effect_execution_claims', 'm2_effect_authority_events'];
    const snapshot = () => tables.map(table => ({ table, rows: environment.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() }));
    const before = snapshot();
    applyFileReadOutputs(environment.db);
    assert.deepEqual(snapshot(), before);
    applyFileReadOutputs(environment.db);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(environment.repository.getEffectResult(write.effectId), writeResult);
    assert.deepEqual(environment.repository.getEffectResult(legacy.effectId), legacyResult);
    assert.equal(environment.db.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    assert.deepEqual(environment.db.pragma('foreign_key_check'), []);
  }, { fileReadOutputs: false });
});

import {
  createM2FileListTarget, validateM2FileListTarget, createM2FileListEntry,
  createM2FileListPolicyPayload, parseM2FileListPolicyPayload,
  createM2FileListSnapshot, parseM2FileListSnapshot,
} from '../contracts/m2/file-list-snapshot-v1.js';
import { observeProjectRootListing } from '../src/executor/project-root-listing.js';
import { validateEffectRequest as validateLegacyEffectRequest } from '../contracts/m2/effect-v1.js';
import { getM2ToolDescriptor as listingLegacyDescriptor, getCurrentM2ToolDescriptor as listingCurrentDescriptor } from '../src/tools/m2-tool-registry.js';

async function withListingRoot(callback) {
  const parent = mkdtempSync(path.join(tmpdir(), 'm2-root-list-'));
  const root = path.join(parent, 'project');
  mkdirSync(root);
  try { await callback(root, parent); } finally { rmSync(parent, { recursive: true, force: true }); }
}
function trackedListingFs() {
  const opened = new Set(); let directoryCount = 0;
  const fileSystem = { ...nativeFs,
    openSync(...args) { const fd = nativeFs.openSync(...args); opened.add(fd); return fd; },
    closeSync(fd) { opened.delete(fd); return nativeFs.closeSync(fd); },
    opendirSync(...args) {
      const directory = nativeFs.opendirSync(...args); directoryCount++;
      return { readSync: () => directory.readSync(), closeSync: () => { directoryCount--; return directory.closeSync(); } };
    },
  };
  return { fileSystem, assertClosed: () => { assert.equal(opened.size, 0); assert.equal(directoryCount, 0); } };
}

suite('Project root listing foundation; legacy tool remains unavailable');
await testAsync('root listing has an explicit target and does not relax Effect@1 or enable Tool@1', async () => {
  const target = createM2FileListTarget('/workspace/project');
  assert.equal(validateM2FileListTarget(target), true);
  for (const wrong of [{ ...target, relativePath: 'src' }, { ...target, type: 'filesystem' },
    { ...target, resolvedRealpath: '/workspace/other' }, { ...target, extra: true }]) {
    assert.equal(validateM2FileListTarget(wrong), false);
  }
  assert.throws(() => createM2FileListTarget('/workspace/../project'));
  const legacy = { contract: 'EffectRequest', version: 1, effectId: 'effect-list-probe',
    runId: 'run-list-probe', parentEffectId: null, actor: { type: 'user', id: 'local-operator' },
    origin: { surface: 'studio', sessionId: 'list-session', conversationId: 'list-conversation', projectId: 17 },
    kind: 'fs.read', target: { type: 'filesystem', canonicalRoot: '/workspace/project',
      relativePath: 'file.txt', resolvedRealpath: '/workspace/project/file.txt' },
    payloadDigest: 'sha256:' + '0'.repeat(64), payloadBytes: 0,
    workspaceRevision: 'wsr1:root-list-probe', requiredCapability: 'project.fs.read', riskClass: 'read',
    timeoutMs: 30000, idempotencyKey: 'root-list-probe', approvalGrantId: null,
    createdAt: '2026-09-09T00:00:00.000Z' };
  assert.equal(validateLegacyEffectRequest(legacy).valid, true);
  assert.equal(validateLegacyEffectRequest({ ...legacy, target }).valid, false);
  assert.equal(validateLegacyEffectRequest({ ...legacy, target: { ...target, type: 'filesystem' } }).valid, false);
  assert.equal(listingLegacyDescriptor('file.list').authorityMode, 'unavailable');
  assert.equal(listingCurrentDescriptor('file.list').version, 2);
  assert.equal(listingCurrentDescriptor('file.read').version, 2);
});
await testAsync('listing policy preserves exact canonical bytes and rejects recursion and oversized controls', async () => {
  const bytes = createM2FileListPolicyPayload();
  const policy = parseM2FileListPolicyPayload(bytes);
  assert.deepEqual(policy, { format: 'root-entries@1', maxEntries: 10000, maxOutputBytes: 1048576, recursive: false });
  for (const value of [{ ...policy, recursive: true }, { ...policy, maxEntries: 10001 },
    { ...policy, maxOutputBytes: 1048577 }, { ...policy, maxEntries: 0 }, { ...policy, extra: true }]) {
    assert.throws(() => parseM2FileListPolicyPayload(Buffer.from(canonicalStringify(value))));
  }
  assert.throws(() => parseM2FileListPolicyPayload(Buffer.concat([bytes, Buffer.from(' ')])));
});
await testAsync('actual listing returns complete sorted names/types without child reads, recursion or symlink following', async () => {
  await withListingRoot(root => {
    writeFileSync(path.join(root, 'z.txt'), 'never-read-content');
    writeFileSync(path.join(root, '.env'), 'never-read-secret');
    mkdirSync(path.join(root, 'nested'));
    writeFileSync(path.join(root, 'nested/hidden.txt'), 'never-descend');
    symlinkSync('/definitely-outside-and-absent', path.join(root, 'outside-link'));
    const tracking = trackedListingFs();
    const f = tracking.fileSystem; const open = f.openSync;
    f.openSync = (name, ...rest) => { assert.equal(name, root); return open(name, ...rest); };
    // Node may internally lstat unknown Dirent types; this does not read
    // child contents or follow symlink targets. The wrapper observes its own API only.
    f.readFileSync = f.readSync = f.statSync = f.readlinkSync = () => assert.fail('No child content or symlink-target read');
    const value = observeProjectRootListing(createM2FileListTarget(root), { fileSystem: f });
    assert.deepEqual(value.value.entries.map(e => [Buffer.from(e.nameBase64, 'base64').toString(), e.type]),
      [['.env', 'file'], ['nested', 'directory'], ['outside-link', 'symlink'], ['z.txt', 'file']]);
    assert.equal(value.value.complete, true);
    assert.deepEqual(parseM2FileListSnapshot(value.bytes).value, value.value);
    assert.equal(value.digest, `sha256:${createHash('sha256').update(value.bytes).digest('hex')}`);
    tracking.assertClosed();
  });
});
await testAsync('actual POSIX byte names preserve invalid UTF8, decomposed Unicode and control characters losslessly', async () => {
  await withListingRoot(root => {
    const names = [Buffer.from([0xff, 0xfe]), Buffer.from('e\u0301.txt'), Buffer.from('name\n```<tag>.txt')];
    for (const name of names) writeFileSync(Buffer.concat([Buffer.from(root + '/'), name]), 'never-read');
    const snapshot = observeProjectRootListing(createM2FileListTarget(root));
    assert.deepEqual(snapshot.value.entries.map(e => Buffer.from(e.nameBase64, 'base64')),
      [...names].sort(Buffer.compare));
    assert.ok(!snapshot.bytes.includes(Buffer.from('```')));
  });
});
await testAsync('root symlink cannot substitute for canonical project root', async () => {
  await withListingRoot((root, parent) => {
    const alias = path.join(parent, 'alias'); symlinkSync(root, alias);
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(alias)), { code: 'EFFECT_FILE_LIST_ROOT_CHANGED' });
  });
});
await testAsync('entry overflow fails explicitly and closes every owned descriptor', async () => {
  await withListingRoot(root => {
    writeFileSync(path.join(root, 'a'), ''); writeFileSync(path.join(root, 'b'), '');
    const tracking = trackedListingFs();
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(root), {
      fileSystem: tracking.fileSystem, policyBytes: createM2FileListPolicyPayload({ maxEntries: 1 }),
    }), { code: 'EFFECT_FILE_LIST_ENTRY_LIMIT' });
    tracking.assertClosed();
  });
});
await testAsync('output byte ceiling fails instead of silently trimming a complete listing', async () => {
  await withListingRoot(root => {
    const tracking = trackedListingFs();
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(root), {
      fileSystem: tracking.fileSystem, policyBytes: createM2FileListPolicyPayload({ maxOutputBytes: 1 }),
    }), { code: 'EFFECT_FILE_LIST_INVALID' });
    tracking.assertClosed();
  });
});
await testAsync('pre-cancel makes no filesystem calls and mid-enumeration cancellation closes descriptors', async () => {
  await withListingRoot(root => {
    const pre = new AbortController(); pre.abort();
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(root), {
      signal: pre.signal, fileSystem: { realpathSync: () => assert.fail('No pre-cancel IO') },
    }), { code: 'EFFECT_CANCELLED' });
    writeFileSync(path.join(root, 'a'), '');
    const mid = new AbortController(); const tracking = trackedListingFs();
    const opendir = tracking.fileSystem.opendirSync;
    tracking.fileSystem.opendirSync = (...args) => {
      const dir = opendir(...args); const read = dir.readSync;
      dir.readSync = () => { const entry = read(); mid.abort(); return entry; }; return dir;
    };
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(root), {
      signal: mid.signal, fileSystem: tracking.fileSystem,
    }), { code: 'EFFECT_CANCELLED' });
    tracking.assertClosed();
  });
});
await testAsync('replacement after opendir cannot return entries from a foreign replacement root', async () => {
  await withListingRoot((root, parent) => {
    writeFileSync(path.join(root, 'original'), '');
    const tracking = trackedListingFs(); const opendir = tracking.fileSystem.opendirSync;
    tracking.fileSystem.opendirSync = (...args) => {
      const dir = opendir(...args);
      nativeFs.renameSync(root, path.join(parent, 'original-root')); mkdirSync(root);
      writeFileSync(path.join(root, 'foreign'), ''); return dir;
    };
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(root), { fileSystem: tracking.fileSystem }),
      { code: 'EFFECT_FILE_LIST_ROOT_CHANGED' });
    tracking.assertClosed();
  });
});
await testAsync('concurrent directory mutation invalidates the observed listing', async () => {
  await withListingRoot(root => {
    writeFileSync(path.join(root, 'original'), '');
    const tracking = trackedListingFs(); const opendir = tracking.fileSystem.opendirSync;
    tracking.fileSystem.opendirSync = (...args) => {
      const dir = opendir(...args); const read = dir.readSync; let mutated = false;
      dir.readSync = () => { const value = read(); if (!mutated) { mutated = true; writeFileSync(path.join(root, 'new-child'), ''); } return value; };
      return dir;
    };
    assert.throws(() => observeProjectRootListing(createM2FileListTarget(root), { fileSystem: tracking.fileSystem }),
      { code: 'EFFECT_FILE_LIST_ROOT_CHANGED' });
    tracking.assertClosed();
  });
});
await testAsync('canonical snapshot rejects duplicate names, forged completeness, alternate encodings and reordered bytes', async () => {
  const a = createM2FileListEntry(Buffer.from('a'), 'file'); const b = createM2FileListEntry(Buffer.from('b'), 'directory');
  const snapshot = createM2FileListSnapshot([b, a]);
  assert.throws(() => createM2FileListSnapshot([a, a]));
  for (const value of [{ ...snapshot.value, complete: false }, { ...snapshot.value, path: 'subdir' },
    { ...snapshot.value, extra: true }, { ...snapshot.value, entries: [b, a] },
    { ...snapshot.value, entries: [{ ...a, nameBase64: a.nameBase64 + '=' }] }]) {
    assert.throws(() => parseM2FileListSnapshot(Buffer.from(canonicalStringify(value))));
  }
  for (const invalid of [Buffer.from('.'), Buffer.from('..'), Buffer.from('a/b'), Buffer.from([0])]) {
    assert.throws(() => createM2FileListEntry(invalid, 'file'));
  }
});

summary();
