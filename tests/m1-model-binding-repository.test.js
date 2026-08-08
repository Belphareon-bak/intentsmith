#!/usr/bin/env node

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  ModelFailoverRepositoryError,
  createModelFailoverRepository,
} from '../src/upgrade/model-failover.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CONTRACT_DIGEST = 'c'.repeat(64);
const FAILOVER_MODULE_URL = new URL('../src/upgrade/model-failover.js', import.meta.url).href;

const MANUAL_BINDING_WORKER_SOURCE = `
  const Database = require('better-sqlite3');
  const { parentPort, workerData } = require('node:worker_threads');

  (async () => {
    const { createModelFailoverRepository } = await import(workerData.moduleUrl);
    const db = new Database(workerData.databasePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const counters = { event: 0, episode: 0, operation: 0, claimToken: 0 };
    const repository = createModelFailoverRepository(db, {
      clock: () => workerData.nowMs,
      ids: {
        event: () => workerData.prefix + '-event-' + (++counters.event),
        episode: () => workerData.prefix + '-episode-' + (++counters.episode),
        operation: () => workerData.prefix + '-operation-' + (++counters.operation),
        claimToken: () => workerData.prefix + '-claim-token-' + (++counters.claimToken),
      },
    });
    const desired = repository.getDesired(workerData.role);
    const state = repository.getState(workerData.role);
    parentPort.postMessage({ type: 'ready', prefix: workerData.prefix, desired, state });
    const signal = new Int32Array(workerData.signal);
    while (Atomics.load(signal, 0) !== 1) Atomics.wait(signal, 0, 0);
    try {
      const result = workerData.action === 'claim'
        ? repository.claimOperation({
            role: workerData.role,
            episodeId: state.episodeId,
            expectedDesiredRevision: state.desiredRevision,
            expectedRowVersion: state.rowVersion,
            kind: 'ACTIVATE',
            leaseMs: 1000,
          })
        : repository.recordUserBindingApply({
            requestKey: workerData.requestKey,
            role: workerData.role,
            expectedBindingRevision: desired.bindingRevision,
            targetModelName: workerData.targetModelName,
            targetDigestSha256: workerData.targetDigestSha256,
            actor: workerData.actor,
          });
      parentPort.postMessage({
        type: 'result',
        prefix: workerData.prefix,
        outcome: result.outcome,
        operationId: result.operation?.operationId ?? result.claim?.operationId ?? null,
        committedRevision: result.committedDesired?.bindingRevision ?? null,
        currentRevision: result.currentDesired?.bindingRevision ?? null,
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'result',
        prefix: workerData.prefix,
        errorCode: error.code || null,
        errorMessage: error.message,
      });
    } finally {
      db.close();
    }
  })().catch(error => {
    parentPort.postMessage({
      type: 'fatal',
      prefix: workerData.prefix,
      errorMessage: error.stack || error.message,
    });
  });
`;

function openDb(databasePath) {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function createRuntime(prefix, initialNow = 1000) {
  let now = initialNow;
  const counters = { event: 0, episode: 0, operation: 0, claimToken: 0 };
  return {
    setNow(value) {
      now = value;
    },
    counters,
    options: {
      clock: () => now,
      ids: {
        event: () => `${prefix}-event-${++counters.event}`,
        episode: () => `${prefix}-episode-${++counters.episode}`,
        operation: () => `${prefix}-operation-${++counters.operation}`,
        claimToken: () => `${prefix}-claim-token-${String(++counters.claimToken).padStart(4, '0')}`,
      },
    },
  };
}

async function withRepository(callback, { second = false } = {}) {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'binding-repository-'),
  );
  const databasePath = path.join(directory, 'binding.sqlite');
  const firstDb = openDb(databasePath);
  let secondDb = null;
  try {
    await runMigrations(firstDb);
    if (second) secondDb = openDb(databasePath);
    return await callback({ firstDb, secondDb, databasePath });
  } finally {
    if (secondDb?.open) secondDb.close();
    if (firstDb.open) firstDb.close();
    rmSync(directory, { recursive: true, force: false });
  }
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

function assertRepositoryError(error, code) {
  assert(error instanceof ModelFailoverRepositoryError, `Expected repository error, got ${error}`);
  assertEqual(error.code, code);
}

function runManualBindingRace({ databasePath, contenders, releaseOrder = null }) {
  const workers = contenders.map(contender => {
    const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    return {
      prefix: contender.prefix,
      signal: new Int32Array(signalBuffer),
      worker: new Worker(MANUAL_BINDING_WORKER_SOURCE, {
        eval: true,
        workerData: {
          databasePath,
          moduleUrl: FAILOVER_MODULE_URL,
          signal: signalBuffer,
          role: 'CHAT',
          nowMs: 2000,
          targetModelName: 'candidate',
          targetDigestSha256: DIGEST_B,
          actor: 'user:fixture',
          ...contender,
        },
      }),
    };
  });

  return new Promise((resolve, reject) => {
    const results = [];
    let readyCount = 0;
    let exitCount = 0;
    let nextReleaseIndex = 0;
    let settled = false;
    let watchdog = null;

    const release = record => {
      Atomics.store(record.signal, 0, 1);
      Atomics.notify(record.signal, 0);
    };
    const releaseNext = () => {
      if (releaseOrder === null) {
        for (const record of workers) release(record);
        return;
      }
      const prefix = releaseOrder[nextReleaseIndex++];
      const record = workers.find(candidate => candidate.prefix === prefix);
      if (!record) throw new Error(`Unknown manual binding release prefix: ${prefix}`);
      release(record);
    };

    const finishIfComplete = () => {
      if (!settled && results.length === workers.length && exitCount === workers.length) {
        settled = true;
        clearTimeout(watchdog);
        resolve(results);
      }
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      for (const record of workers) {
        release(record);
        record.worker.terminate();
      }
      reject(error);
    };

    watchdog = setTimeout(() => {
      fail(new Error('Manual binding worker race timed out after 5000 ms'));
    }, 5000);

    for (const { worker } of workers) {
      worker.on('error', fail);
      worker.on('message', message => {
        try {
          if (message.type === 'fatal') {
            fail(new Error(`${message.prefix}: ${message.errorMessage}`));
            return;
          }
          if (message.type === 'ready') {
            assertEqual(message.desired.bindingRevision, 1);
            readyCount += 1;
            if (readyCount === workers.length) {
              releaseNext();
            }
            return;
          }
          if (message.type === 'result') {
            results.push(message);
            if (releaseOrder !== null && results.length < workers.length) releaseNext();
            finishIfComplete();
          }
        } catch (error) {
          fail(error);
        }
      });
      worker.on('exit', code => {
        if (settled) return;
        if (code !== 0) {
          fail(new Error(`Manual binding worker exited ${code}`));
          return;
        }
        exitCount += 1;
        finishIfComplete();
      });
    }
  });
}

function observeChat(repository, overrides = {}) {
  return repository.observeDesiredBinding({
    role: 'CHAT',
    modelName: 'reasoner',
    digestSha256: DIGEST_A,
    source: 'LEGACY_OVERRIDE',
    actor: 'user:fixture',
    ...overrides,
  });
}

function applyChat(repository, overrides = {}) {
  return repository.recordUserBindingApply({
    requestKey: 'request-user-apply-0001',
    role: 'CHAT',
    expectedBindingRevision: 1,
    targetModelName: 'candidate',
    targetDigestSha256: DIGEST_B,
    actor: 'user:fixture',
    ...overrides,
  });
}

function rollbackChat(repository, applyOperationId, overrides = {}) {
  return repository.recordUserBindingRollback({
    requestKey: 'request-user-rollback-0001',
    role: 'CHAT',
    expectedBindingRevision: 2,
    rollbackOfOperationId: applyOperationId,
    actor: 'user:fixture',
    ...overrides,
  });
}

function detectChat(repository, expectedDesiredRevision = 1) {
  return repository.recordDetection({ role: 'CHAT', expectedDesiredRevision });
}

function claimChat(repository, state, overrides = {}) {
  return repository.claimOperation({
    role: 'CHAT',
    episodeId: state.episodeId,
    expectedDesiredRevision: state.desiredRevision,
    expectedRowVersion: state.rowVersion,
    kind: 'ACTIVATE',
    leaseMs: 1000,
    ...overrides,
  });
}

function insertPassingChatProof(db, {
  proofId = 'proof-binding-repository-0001',
  completedAtMs = 2800,
  modelName = 'fallback:latest',
  canonicalName = 'fallback',
  digestSha256 = DIGEST_B,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_proofs (
      proof_id, validation_run_id, role, suite, role_contract_sha256,
      model_name, model_canonical_name, model_digest_sha256,
      validation_version, policy_version, score, required_score, passed_count,
      required_passed_count, total_count, duration_ms, result,
      inventory_before_name, inventory_before_digest, inventory_after_name,
      inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
      created_at_ms
    ) VALUES (?, ?, 'CHAT', 'chat', ?, ?, ?, ?,
      'v123.1', 'd-plus-v1', 1, 0.8, 6, 5, 6, 500, 'PASS',
      ?, ?, ?, ?, ?, ?, 900000, ?)
  `).run(
    proofId,
    `${proofId}-run`,
    CONTRACT_DIGEST,
    modelName,
    canonicalName,
    digestSha256,
    modelName,
    digestSha256,
    modelName,
    digestSha256,
    completedAtMs - 500,
    completedAtMs,
    completedAtMs,
  );
}

function insertActivationEvent(db, {
  eventId = 'event-binding-repository-activated',
  proofId = 'proof-binding-repository-0001',
  episodeId,
  operationId,
  bindingRevision = 1,
  rowVersion,
  desiredModelName = 'reasoner',
  desiredDigestSha256 = DIGEST_A,
  createdAtMs = 3000,
} = {}) {
  return db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256,
      fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
      proof_id, verified, created_at_ms
    ) VALUES (?, 'ACTIVATED', 'CHAT', ?, ?, ?, ?,
      'system:binding-integrity', 'LOCAL_FAILOVER_ACTIVATED', 'd-plus-v1',
      'DETECTED', 'ACTIVATED', ?, ?, 'fallback:latest', 'fallback', ?,
      ?, 1, ?)
  `).run(
    eventId,
    bindingRevision,
    rowVersion,
    episodeId,
    operationId,
    desiredModelName,
    desiredDigestSha256,
    DIGEST_B,
    proofId,
    createdAtMs,
  );
}

function activateClaimedChat(db, claimed, { createdAtMs = 3000 } = {}) {
  insertPassingChatProof(db);
  const rowVersion = claimed.state.rowVersion + 1;
  insertActivationEvent(db, {
    episodeId: claimed.state.episodeId,
    operationId: claimed.claim.operationId,
    rowVersion,
    createdAtMs,
  });
  db.prepare(`
    UPDATE model_failover_state
    SET state = 'ACTIVATED', active_failover = 1,
        fallback_model_name = 'fallback:latest', fallback_canonical_name = 'fallback',
        fallback_digest_sha256 = ?, proof_id = 'proof-binding-repository-0001',
        active_event_id = 'event-binding-repository-activated',
        proof_verified_at_ms = ?, activated_at_ms = ?, updated_at_ms = ?,
        row_version = ?, claim_operation_id = NULL, claim_token = NULL,
        claim_kind = NULL, claim_started_at_ms = NULL,
        claim_expires_at_ms = NULL,
        last_event_id = 'event-binding-repository-activated'
    WHERE role = 'CHAT'
  `).run(DIGEST_B, createdAtMs, createdAtMs, createdAtMs, rowVersion);
}

function failDetectedChat(db, detected, { createdAtMs = 2500 } = {}) {
  const desired = db.prepare(`
    SELECT model_name, digest_sha256
    FROM model_desired_bindings
    WHERE role = 'CHAT' AND binding_revision = ?
  `).get(detected.desiredRevision);
  const rowVersion = detected.rowVersion + 1;
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      actor, reason_code, policy_version, state_before, state_after,
      desired_model_name, desired_digest_sha256, verified, failure_phase,
      created_at_ms
    ) VALUES ('event-binding-repository-failed', 'ACTIVATION_FAILED', 'CHAT',
      ?, ?, ?, 'system:binding-integrity', 'LOCAL_FAILOVER_ACTIVATION_FAILED',
      'd-plus-v1', 'DETECTED', 'FAILED', ?, ?, 0, 'VERIFICATION', ?)
  `).run(
    detected.desiredRevision,
    rowVersion,
    detected.episodeId,
    desired.model_name,
    desired.digest_sha256,
    createdAtMs,
  );
  db.prepare(`
    UPDATE model_failover_state
    SET state = 'FAILED', reason_code = 'LOCAL_FAILOVER_ACTIVATION_FAILED',
        failure_phase = 'VERIFICATION', row_version = ?, updated_at_ms = ?,
        last_event_id = 'event-binding-repository-failed'
    WHERE role = 'CHAT'
  `).run(rowVersion, createdAtMs);
}

function insertDetectedForCurrentDesired(db, { createdAtMs = 2500 } = {}) {
  const desired = db.prepare(`
    SELECT * FROM model_desired_bindings WHERE role = 'CHAT'
  `).get();
  const eventId = 'event-binding-repository-manual-detected';
  const episodeId = 'episode-binding-repository-manual-detected';
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      actor, reason_code, policy_version, state_after, desired_model_name,
      desired_digest_sha256, verified, details_json, created_at_ms
    ) VALUES (?, 'DETECTED', 'CHAT', ?, 1, ?, 'system:binding-integrity',
      'BOUND_MODEL_NOT_INSTALLED', 'd-plus-v1', 'DETECTED', ?, ?, 0, '{}', ?)
  `).run(
    eventId,
    desired.binding_revision,
    episodeId,
    desired.model_name,
    desired.digest_sha256,
    createdAtMs,
  );
  db.prepare(`
    INSERT INTO model_failover_state (
      role, desired_revision, episode_id, state, active_failover,
      policy_version, actor, reason_code, row_version, detected_at_ms,
      updated_at_ms, last_event_id
    ) VALUES ('CHAT', ?, ?, 'DETECTED', 0, 'd-plus-v1',
      'system:binding-integrity', 'BOUND_MODEL_NOT_INSTALLED', 1, ?, ?, ?)
  `).run(
    desired.binding_revision,
    episodeId,
    createdAtMs,
    createdAtMs,
    eventId,
  );
  return {
    desiredRevision: desired.binding_revision,
    episodeId,
    rowVersion: 1,
  };
}

function restoreActiveChat(db, restoredClaim, { createdAtMs = 3600 } = {}) {
  const proofId = 'proof-binding-repository-restored';
  insertPassingChatProof(db, {
    proofId,
    completedAtMs: createdAtMs - 100,
    modelName: 'reasoner',
    canonicalName: 'reasoner',
    digestSha256: DIGEST_A,
  });
  const rowVersion = restoredClaim.state.rowVersion + 1;
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256, proof_id,
      verified, created_at_ms
    ) VALUES ('event-binding-repository-restored', 'RESTORED', 'CHAT', ?, ?, ?,
      ?, 'system:binding-integrity', 'DESIRED_MODEL_RESTORED', 'd-plus-v1',
      'ACTIVATED', 'RESTORED', 'reasoner', ?, ?, 1, ?)
  `).run(
    restoredClaim.state.desiredRevision,
    rowVersion,
    restoredClaim.state.episodeId,
    restoredClaim.claim.operationId,
    DIGEST_A,
    proofId,
    createdAtMs,
  );
  db.prepare(`
    UPDATE model_failover_state
    SET state = 'RESTORED', active_failover = 0, row_version = ?,
        claim_operation_id = NULL, claim_token = NULL, claim_kind = NULL,
        claim_started_at_ms = NULL, claim_expires_at_ms = NULL,
        resolved_at_ms = ?, updated_at_ms = ?,
        last_event_id = 'event-binding-repository-restored'
    WHERE role = 'CHAT'
  `).run(rowVersion, createdAtMs, createdAtMs);
}

function authoritySnapshot(db) {
  const tables = [
    'model_desired_bindings',
    'model_failover_state',
    'model_failover_events',
    'model_binding_operations',
    'model_overrides',
    'upgrade_history',
  ];
  return JSON.stringify(Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ])));
}

suite('M1 manual binding repository — durable intent and idempotency');

await testAsync('apply is unverified, alias-idempotent and replay-safe after later revisions', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('apply-contract');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);

    const noOp = applyChat(repository, {
      requestKey: 'request-alias-noop-0001',
      targetModelName: 'reasoner:latest',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(noOp.outcome, 'UNCHANGED');
    assertEqual(noOp.requestKeyConsumed, false);
    assertEqual(noOp.operation, null);
    assertEqual(runtime.counters.operation, 0);
    assertEqual(runtime.counters.event, 1);

    runtime.setNow(2000);
    const first = applyChat(repository);
    assertEqual(first.outcome, 'RECORDED');
    assertEqual(first.kind, 'USER_APPLY');
    assertEqual(first.operation.verificationStatus, 'NOT_VERIFIED');
    assertEqual(first.operation.runtimeStatus, 'NOT_APPLIED');
    assertEqual(first.operation.predecessorOperationId, null);
    assertEqual(first.committedDesired.bindingRevision, 2);
    assertEqual(first.currentDesired.bindingRevision, 2);
    assertEqual(first.requestKeyConsumed, true);
    const pending = repository.getEffectiveBinding('CHAT');
    assertEqual(pending.source, 'PENDING_MANUAL');
    assertEqual(pending.modelName, null);
    assertEqual(pending.pendingOperation.operationId, first.operation.operationId);
    assertEqual(pending.pendingOperation.verificationStatus, 'NOT_VERIFIED');
    assertEqual(pending.pendingOperation.runtimeStatus, 'NOT_APPLIED');
    const prematureDetection = captureError(() => detectChat(repository, 2));
    assertRepositoryError(
      prematureDetection,
      'MODEL_FAILOVER_RUNTIME_BINDING_UNCONFIRMED',
    );
    assertEqual(
      JSON.stringify(repository.getBindingOperation(first.operation.operationId)),
      JSON.stringify(first.operation),
    );

    const aliasReplay = applyChat(repository, { targetModelName: 'candidate:latest' });
    assertEqual(aliasReplay.outcome, 'REPLAYED');
    assertEqual(aliasReplay.operation.operationId, first.operation.operationId);
    assertEqual(aliasReplay.operation.targetModelName, 'candidate');
    assertEqual(runtime.counters.operation, 1);
    assertEqual(runtime.counters.event, 2);

    for (const overrides of [
      { actor: 'user:other' },
      { targetDigestSha256: DIGEST_A },
      { role: 'CODE' },
    ]) {
      const error = captureError(() => applyChat(repository, overrides));
      assertRepositoryError(error, 'MODEL_FAILOVER_REQUEST_KEY_CONFLICT');
    }

    runtime.setNow(3000);
    const second = applyChat(repository, {
      requestKey: 'request-user-apply-0002',
      expectedBindingRevision: 2,
      targetModelName: 'candidate-v2:latest',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(second.outcome, 'RECORDED');
    assertEqual(second.operation.predecessorOperationId, first.operation.operationId);
    assertEqual(second.currentDesired.bindingRevision, 3);

    const lateReplay = applyChat(repository);
    assertEqual(lateReplay.outcome, 'REPLAYED');
    assertEqual(lateReplay.committedDesired.bindingRevision, 2);
    assertEqual(lateReplay.currentDesired.bindingRevision, 3);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_overrides').get().count, 0);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
  });
});

await testAsync('manual APIs accept exact input schemas and reject internal or unknown fields', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('authority-input');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const applyAuthorityFields = [
      'nowMs',
      'createdAtMs',
      'eventId',
      'desiredEventId',
      'supersedeEventId',
      'operationId',
      'kind',
      'operationKind',
      'source',
      'previousModelName',
      'previousCanonicalName',
      'previousDigestSha256',
      'targetCanonicalName',
      'predecessorOperationId',
      'rollbackOfOperationId',
      'committedBindingRevision',
      'verificationStatus',
      'runtimeStatus',
      'proofId',
      'policyVersion',
      'reasonCode',
      'details',
      'detailsJson',
      'unknownField',
    ];
    const beforeApply = authoritySnapshot(firstDb);
    for (const field of applyAuthorityFields) {
      const error = captureError(() => applyChat(repository, { [field]: 'caller-owned' }));
      assertRepositoryError(error, 'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED');
      assertEqual(JSON.stringify(error.details?.fields), JSON.stringify([field]));
      assertEqual(authoritySnapshot(firstDb), beforeApply);
    }
    for (const actor of ['system:fixture', 'user:', 'user:bad actor', 'user:\vbad']) {
      const error = captureError(() => applyChat(repository, { actor }));
      assertRepositoryError(error, 'MODEL_FAILOVER_ACTOR_INVALID');
      assertEqual(authoritySnapshot(firstDb), beforeApply);
    }

    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(3000);
    const rollbackAuthorityFields = [
      'nowMs',
      'createdAtMs',
      'eventId',
      'desiredEventId',
      'supersedeEventId',
      'operationId',
      'kind',
      'operationKind',
      'source',
      'previousModelName',
      'previousCanonicalName',
      'previousDigestSha256',
      'targetModelName',
      'targetCanonicalName',
      'targetDigestSha256',
      'predecessorOperationId',
      'committedBindingRevision',
      'verificationStatus',
      'runtimeStatus',
      'proofId',
      'policyVersion',
      'reasonCode',
      'details',
      'detailsJson',
      'unknownField',
    ];
    const beforeRollback = authoritySnapshot(firstDb);
    for (const field of rollbackAuthorityFields) {
      const error = captureError(() => rollbackChat(
        repository,
        applied.operation.operationId,
        { [field]: 'caller-owned' },
      ));
      assertRepositoryError(error, 'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED');
      assertEqual(JSON.stringify(error.details?.fields), JSON.stringify([field]));
      assertEqual(authoritySnapshot(firstDb), beforeRollback);
    }
    for (const actor of ['system:fixture', 'user:', 'user:bad actor', 'user:\vbad']) {
      const error = captureError(() => rollbackChat(
        repository,
        applied.operation.operationId,
        { actor },
      ));
      assertRepositoryError(error, 'MODEL_FAILOVER_ACTOR_INVALID');
      assertEqual(authoritySnapshot(firstDb), beforeRollback);
    }
  });
});

await testAsync('two WAL workers serialize same-key replay and different-key stale CAS', async () => {
  await withRepository(async ({ firstDb, databasePath }) => {
    const repository = createModelFailoverRepository(firstDb, createRuntime('race-same').options);
    observeChat(repository);
    const results = await runManualBindingRace({
      databasePath,
      contenders: [
        { prefix: 'race-same-left', requestKey: 'request-race-same-0001' },
        { prefix: 'race-same-right', requestKey: 'request-race-same-0001' },
      ],
    });
    assertEqual(results.map(result => result.outcome).sort().join(','), 'RECORDED,REPLAYED');
    assertEqual(new Set(results.map(result => result.operationId)).size, 1);
    assertEqual(results.every(result => result.committedRevision === 2), true);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 1);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count, 2);
    assertEqual(firstDb.prepare('SELECT binding_revision FROM model_desired_bindings WHERE role = ?').get('CHAT').binding_revision, 2);
  });

  await withRepository(async ({ firstDb, databasePath }) => {
    const repository = createModelFailoverRepository(firstDb, createRuntime('race-different').options);
    observeChat(repository);
    const results = await runManualBindingRace({
      databasePath,
      contenders: [
        { prefix: 'race-different-left', requestKey: 'request-race-left-0001' },
        { prefix: 'race-different-right', requestKey: 'request-race-right-0001' },
      ],
    });
    assertEqual(
      results.map(result => result.outcome || result.errorCode).sort().join(','),
      'MODEL_FAILOVER_STALE_DESIRED,RECORDED',
    );
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 1);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count, 2);
    assertEqual(firstDb.prepare('SELECT binding_revision FROM model_desired_bindings WHERE role = ?').get('CHAT').binding_revision, 2);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_overrides').get().count, 0);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
  });
});

await testAsync('manual operation and replay survive a real close and reopen', async () => {
  await withRepository(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('restart-writer');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const recorded = applyChat(repository);
    const expectedOperation = JSON.stringify(recorded.operation);
    firstDb.close();

    const restartedDb = openDb(databasePath);
    try {
      const restarted = createModelFailoverRepository(
        restartedDb,
        createRuntime('restart-reader', 3000).options,
      );
      assertEqual(
        JSON.stringify(restarted.getBindingOperation(recorded.operation.operationId)),
        expectedOperation,
      );
      const replay = applyChat(restarted);
      assertEqual(replay.outcome, 'REPLAYED');
      assertEqual(replay.operation.operationId, recorded.operation.operationId);
      assertEqual(restarted.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');
      assertEqual(restartedDb.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 1);
      assertEqual(restartedDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count, 2);
    } finally {
      restartedDb.close();
    }
  });
});

await testAsync('rollback derives one exact append-only reversal and remains replay-safe', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('rollback-contract');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(3000);
    const rolledBack = rollbackChat(repository, applied.operation.operationId);
    assertEqual(rolledBack.outcome, 'RECORDED');
    assertEqual(rolledBack.kind, 'USER_ROLLBACK');
    assertEqual(rolledBack.operation.rollbackOfOperationId, applied.operation.operationId);
    assertEqual(rolledBack.operation.predecessorOperationId, applied.operation.operationId);
    assertEqual(rolledBack.operation.verificationStatus, 'NOT_VERIFIED');
    assertEqual(rolledBack.operation.runtimeStatus, 'NOT_APPLIED');
    assertEqual(rolledBack.currentDesired.modelName, 'reasoner');
    assertEqual(rolledBack.currentDesired.bindingRevision, 3);
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');

    const replay = rollbackChat(repository, applied.operation.operationId);
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(replay.operation.operationId, rolledBack.operation.operationId);
    const duplicateError = captureError(() => rollbackChat(repository, applied.operation.operationId, {
      requestKey: 'request-user-rollback-0002',
    }));
    assertRepositoryError(duplicateError, 'MODEL_FAILOVER_ROLLBACK_ALREADY_RECORDED');
    const wrongKind = captureError(() => rollbackChat(repository, rolledBack.operation.operationId, {
      requestKey: 'request-user-rollback-wrong-kind',
      expectedBindingRevision: 3,
    }));
    assertRepositoryError(wrongKind, 'MODEL_FAILOVER_ROLLBACK_TARGET_INVALID');
    const missing = captureError(() => rollbackChat(repository, 'operation-missing-0001', {
      requestKey: 'request-user-rollback-missing',
      expectedBindingRevision: 3,
    }));
    assertRepositoryError(missing, 'MODEL_FAILOVER_BINDING_OPERATION_MISSING');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 2);
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('rollback-stale');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const first = applyChat(repository);
    runtime.setNow(3000);
    applyChat(repository, {
      requestKey: 'request-user-apply-newer',
      expectedBindingRevision: 2,
      targetModelName: 'newer',
      targetDigestSha256: DIGEST_A,
    });
    const stale = captureError(() => rollbackChat(repository, first.operation.operationId, {
      requestKey: 'request-user-rollback-stale',
      expectedBindingRevision: 3,
    }));
    assertRepositoryError(stale, 'MODEL_FAILOVER_ROLLBACK_NOT_CURRENT');
  });
});

suite('M1 manual binding repository — incident supersede and retirement');

await testAsync('manual apply and ACTIVATE claim serialize safely in both orders', async () => {
  const scenarios = [
    {
      name: 'apply-wins',
      contenders: [
        { prefix: 'apply-first', action: 'apply', requestKey: 'request-race-apply-first' },
        { prefix: 'claim-second', action: 'claim' },
      ],
      expected: 'MODEL_FAILOVER_STALE_DESIRED,RECORDED',
      claimedEvents: 0,
    },
    {
      name: 'claim-wins',
      contenders: [
        { prefix: 'claim-first', action: 'claim' },
        { prefix: 'apply-second', action: 'apply', requestKey: 'request-race-apply-second' },
      ],
      expected: 'CLAIMED,RECORDED',
      claimedEvents: 1,
    },
  ];

  for (const scenario of scenarios) {
    await withRepository(async ({ firstDb, databasePath }) => {
      const runtime = createRuntime(`claim-apply-${scenario.name}`);
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      runtime.setNow(2000);
      detectChat(repository);
      const results = await runManualBindingRace({
        databasePath,
        contenders: scenario.contenders,
        releaseOrder: scenario.contenders.map(contender => contender.prefix),
      });
      assertEqual(
        results.map(result => result.outcome || result.errorCode).sort().join(','),
        scenario.expected,
      );
      const state = repository.getState('CHAT');
      assertEqual(state.state, 'SUPERSEDED_BY_USER');
      assertEqual(state.desiredRevision, 2);
      assertEqual(state.claimPresent, false);
      assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');
      assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 1);
      assertEqual(
        firstDb.prepare("SELECT COUNT(*) AS count FROM model_failover_events WHERE event_type = 'ACTIVATION_CLAIMED'").get().count,
        scenario.claimedEvents,
      );
      assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_overrides').get().count, 0);
      assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
    });
  }
});

await testAsync('detected incident with or without ACTIVATE claim is atomically superseded', async () => {
  for (const claimedVariant of [false, true]) {
    await withRepository(async ({ firstDb }) => {
      const runtime = createRuntime(claimedVariant ? 'supersede-claimed' : 'supersede-detected');
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      runtime.setNow(2000);
      const detected = detectChat(repository).state;
      let claimed = null;
      if (claimedVariant) {
        runtime.setNow(2200);
        claimed = claimChat(repository, detected);
      }
      runtime.setNow(2500);
      const applied = applyChat(repository);
      assertEqual(applied.outcome, 'RECORDED');
      const state = repository.getState('CHAT');
      assertEqual(state.state, 'SUPERSEDED_BY_USER');
      assertEqual(state.desiredRevision, 2);
      assertEqual(state.rowVersion, claimedVariant ? 3 : 2);
      assertEqual(state.activeFailover, false);
      assertEqual(state.claimPresent, false);
      assertEqual(state.resolvedAtMs, 2500);
      const supersede = repository.listEvents({ role: 'CHAT' })
        .find(event => event.eventType === 'SUPERSEDED_BY_USER');
      assertEqual(supersede.operationId, applied.operation.operationId);
      assertEqual(supersede.bindingRevision, 2);
      assertEqual(supersede.stateBefore, 'DETECTED');
      assertEqual(supersede.stateAfter, 'SUPERSEDED_BY_USER');
      assertEqual(supersede.verified, false);
      assertEqual(supersede.proofId, null);

      if (claimedVariant) {
        insertPassingChatProof(firstDb, { completedAtMs: 2550 });
        const late = captureError(() => insertActivationEvent(firstDb, {
          eventId: 'event-late-activation-after-manual',
          episodeId: claimed.state.episodeId,
          operationId: claimed.claim.operationId,
          bindingRevision: state.desiredRevision,
          rowVersion: state.rowVersion + 1,
          desiredModelName: 'candidate',
          desiredDigestSha256: DIGEST_B,
          createdAtMs: 2600,
        }));
        assert(
          /live claim/i.test(late.message),
          `Expected late terminal rejection, got: ${late.message}`,
        );
      }

      runtime.setNow(3000);
      const pendingDetection = captureError(() => detectChat(repository, 2));
      assertRepositoryError(
        pendingDetection,
        'MODEL_FAILOVER_RUNTIME_BINDING_UNCONFIRMED',
      );
      const followUp = applyChat(repository, {
        requestKey: 'request-user-apply-after-supersede',
        expectedBindingRevision: 2,
        targetModelName: 'candidate-v2',
        targetDigestSha256: DIGEST_A,
      });
      assertEqual(followUp.outcome, 'RECORDED');
      assertEqual(followUp.currentDesired.bindingRevision, 3);
      assertEqual(repository.getState('CHAT'), null);
      assertEqual(
        repository.listEvents({ role: 'CHAT' })
          .filter(event => event.eventType === 'SUPERSEDED_BY_USER').length,
        1,
      );
    });
  }
});

await testAsync('apply and rollback failures restore a retired superseded incident', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('retirement-rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    detectChat(repository);
    runtime.setNow(2500);
    applyChat(repository);
    const terminal = repository.getState('CHAT');
    assertEqual(terminal.state, 'SUPERSEDED_BY_USER');
    const before = authoritySnapshot(firstDb);

    firstDb.exec(`
      CREATE TRIGGER fixture_reject_after_incident_retirement
      BEFORE INSERT ON model_failover_events
      WHEN NEW.event_type = 'DESIRED_CHANGED'
      BEGIN SELECT RAISE(ABORT, 'fixture after incident retirement'); END;
    `);
    runtime.setNow(3000);
    const error = captureError(() => applyChat(repository, {
      requestKey: 'request-after-retirement-0001',
      expectedBindingRevision: 2,
      targetModelName: 'candidate-v2',
      targetDigestSha256: CONTRACT_DIGEST,
    }));
    assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(authoritySnapshot(firstDb), before);
    assertEqual(repository.getState('CHAT').episodeId, terminal.episodeId);
    assertEqual(repository.getState('CHAT').state, 'SUPERSEDED_BY_USER');
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('rollback-retirement-rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    detectChat(repository);
    runtime.setNow(2500);
    const applied = applyChat(repository);
    const terminal = repository.getState('CHAT');
    assertEqual(terminal.state, 'SUPERSEDED_BY_USER');
    const before = authoritySnapshot(firstDb);

    firstDb.exec(`
      CREATE TRIGGER fixture_reject_rollback_after_incident_retirement
      BEFORE INSERT ON model_failover_events
      WHEN NEW.event_type = 'DESIRED_CHANGED'
      BEGIN SELECT RAISE(ABORT, 'fixture rollback after incident retirement'); END;
    `);
    runtime.setNow(3000);
    const error = captureError(() => rollbackChat(
      repository,
      applied.operation.operationId,
    ));
    assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(authoritySnapshot(firstDb), before);
    assertEqual(repository.getState('CHAT').episodeId, terminal.episodeId);
    assertEqual(repository.getState('CHAT').state, 'SUPERSEDED_BY_USER');
  });
});

await testAsync('active failover cannot be superseded by the storage-only repository', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('active-block');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(2200);
    const claimed = claimChat(repository, detected);
    activateClaimedChat(firstDb, claimed);
    const before = authoritySnapshot(firstDb);

    runtime.setNow(4000);
    const error = captureError(() => applyChat(repository));
    assertRepositoryError(error, 'MODEL_FAILOVER_ACTIVE_INCIDENT_REQUIRES_RUNTIME_COORDINATOR');
    assertEqual(authoritySnapshot(firstDb), before);
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'FAILOVER');
  });
});

await testAsync('failed and restored incidents require explicit runtime coordination', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('failed-block');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    failDetectedChat(firstDb, detected);
    const before = authoritySnapshot(firstDb);
    runtime.setNow(3000);
    const error = captureError(() => applyChat(repository));
    assertRepositoryError(
      error,
      'MODEL_FAILOVER_FAILED_INCIDENT_REQUIRES_RUNTIME_COORDINATOR',
    );
    assertEqual(error.details.activeFailover, false);
    assertEqual(error.details.failurePhase, 'VERIFICATION');
    assertEqual(error.details.retryableNow, false);
    assertEqual(error.details.retryPrerequisite, 'RUNTIME_COORDINATOR_RECOVERY');
    assertEqual(authoritySnapshot(firstDb), before);
    assertEqual(repository.getState('CHAT').state, 'FAILED');
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('restored-block');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(2200);
    const activateClaim = claimChat(repository, detected);
    activateClaimedChat(firstDb, activateClaim);
    runtime.setNow(3200);
    const active = repository.getState('CHAT');
    const restoreClaim = repository.claimOperation({
      role: 'CHAT',
      episodeId: active.episodeId,
      expectedDesiredRevision: active.desiredRevision,
      expectedRowVersion: active.rowVersion,
      kind: 'RESTORE',
      leaseMs: 1000,
    });
    restoreActiveChat(firstDb, restoreClaim);
    const before = authoritySnapshot(firstDb);
    runtime.setNow(4000);
    const error = captureError(() => applyChat(repository));
    assertRepositoryError(
      error,
      'MODEL_FAILOVER_RESTORED_INCIDENT_REQUIRES_RUNTIME_COORDINATOR',
    );
    assertEqual(error.details.activeFailover, false);
    assertEqual(error.details.failurePhase, null);
    assertEqual(error.details.retryableNow, false);
    assertEqual(error.details.retryPrerequisite, 'AUDITED_TERMINAL_RETIREMENT');
    assertEqual(authoritySnapshot(firstDb), before);
    assertEqual(repository.getState('CHAT').state, 'RESTORED');
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('failed-rollback-block');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const detected = insertDetectedForCurrentDesired(firstDb);
    failDetectedChat(firstDb, detected, { createdAtMs: 2700 });
    const before = authoritySnapshot(firstDb);
    runtime.setNow(3000);
    const error = captureError(() => rollbackChat(
      repository,
      applied.operation.operationId,
    ));
    assertRepositoryError(
      error,
      'MODEL_FAILOVER_FAILED_INCIDENT_REQUIRES_RUNTIME_COORDINATOR',
    );
    assertEqual(error.details.activeFailover, false);
    assertEqual(error.details.failurePhase, 'VERIFICATION');
    assertEqual(error.details.retryableNow, false);
    assertEqual(error.details.retryPrerequisite, 'RUNTIME_COORDINATOR_RECOVERY');
    assertEqual(authoritySnapshot(firstDb), before);
    assertEqual(repository.getState('CHAT').state, 'FAILED');
  });
});

await testAsync('malformed DETECTED metadata is never laundered into a terminal supersede', async () => {
  const mutations = [
    "actor = 'user:corrupt'",
    "reason_code = 'WRONG_REASON'",
    'activated_at_ms = 1900',
    'proof_verified_at_ms = 1900',
    'resolved_at_ms = 1900',
  ];
  for (const mutation of mutations) {
    await withRepository(async ({ firstDb }) => {
      const runtime = createRuntime('corrupt-detected');
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      runtime.setNow(2000);
      detectChat(repository);
      firstDb.prepare(`UPDATE model_failover_state SET ${mutation} WHERE role = 'CHAT'`).run();
      const before = authoritySnapshot(firstDb);
      runtime.setNow(2500);
      const error = captureError(() => applyChat(repository));
      assertRepositoryError(error, 'MODEL_FAILOVER_CORRUPT_STORAGE');
      assertEqual(authoritySnapshot(firstDb), before);
    });
  }
});

await testAsync('open incident deletion and synthetic superseded INSERT fail closed', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('schema-guards');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    detectChat(repository);
    const deleteError = captureError(() => firstDb.prepare(`
      DELETE FROM model_failover_state WHERE role = 'CHAT'
    `).run());
    assert(/audited terminal retirement/i.test(deleteError.message));
    assertEqual(repository.getState('CHAT').state, 'DETECTED');

    repository.observeDesiredBinding({
      role: 'D1',
      modelName: 'reasoner-d1',
      digestSha256: DIGEST_A,
      source: 'LEGACY_OVERRIDE',
      actor: 'user:fixture',
    });
    const insertError = captureError(() => firstDb.prepare(`
      INSERT INTO model_failover_state (
        role, desired_revision, episode_id, state, active_failover,
        policy_version, actor, reason_code, row_version, detected_at_ms,
        resolved_at_ms, updated_at_ms, last_event_id
      ) VALUES ('D1', 1, 'episode-synthetic-super', 'SUPERSEDED_BY_USER', 0,
        'd-plus-v1', 'user:fixture', 'USER_BINDING_SUPERSEDED_FAILOVER', 1,
        2000, 2000, 2000, 'schema-guards-event-3')
    `).run());
    assert(/must transition from an existing detected row/i.test(insertError.message));
    assertEqual(repository.getState('D1'), null);
  });
});

suite('M1 manual binding repository — atomic failure boundary');

await testAsync('repository refuses a caller-owned outer transaction', async () => {
  await withRepository(async ({ firstDb }) => {
    const repository = createModelFailoverRepository(firstDb, createRuntime('outer-tx').options);
    observeChat(repository);
    const before = authoritySnapshot(firstDb);
    const outer = firstDb.transaction(() => {
      const error = captureError(() => applyChat(repository));
      assertRepositoryError(error, 'MODEL_FAILOVER_TRANSACTION_OWNERSHIP_REQUIRED');
      assertEqual(firstDb.pragma('defer_foreign_keys', { simple: true }), 0);
    });
    outer();
    assertEqual(authoritySnapshot(firstDb), before);
  });
});

await testAsync('failure after every durable statement restores all authority tables', async () => {
  const injections = [
    {
      name: 'desired-event',
      sql: `
        CREATE TRIGGER fixture_reject_manual_desired_event
        BEFORE INSERT ON model_failover_events
        WHEN NEW.event_type = 'DESIRED_CHANGED'
        BEGIN SELECT RAISE(ABORT, 'fixture desired event'); END;
      `,
    },
    {
      name: 'supersede-event',
      sql: `
        CREATE TRIGGER fixture_reject_manual_supersede_event
        BEFORE INSERT ON model_failover_events
        WHEN NEW.event_type = 'SUPERSEDED_BY_USER'
        BEGIN SELECT RAISE(ABORT, 'fixture supersede event'); END;
      `,
    },
    {
      name: 'operation',
      sql: `
        CREATE TRIGGER fixture_reject_manual_operation
        BEFORE INSERT ON model_binding_operations
        BEGIN SELECT RAISE(ABORT, 'fixture operation'); END;
      `,
    },
    {
      name: 'desired-projection',
      sql: `
        CREATE TRIGGER fixture_reject_manual_desired_projection
        BEFORE UPDATE ON model_desired_bindings
        WHEN NEW.source = 'USER_APPLY'
        BEGIN SELECT RAISE(ABORT, 'fixture desired projection'); END;
      `,
    },
    {
      name: 'incident-projection',
      sql: `
        CREATE TRIGGER fixture_reject_manual_incident_projection
        BEFORE UPDATE ON model_failover_state
        WHEN NEW.state = 'SUPERSEDED_BY_USER'
        BEGIN SELECT RAISE(ABORT, 'fixture incident projection'); END;
      `,
    },
  ];

  for (const injection of injections) {
    await withRepository(async ({ firstDb }) => {
      const runtime = createRuntime(`failure-${injection.name}`);
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      runtime.setNow(2000);
      detectChat(repository);
      const before = authoritySnapshot(firstDb);
      firstDb.exec(injection.sql);
      runtime.setNow(2500);
      const error = captureError(() => applyChat(repository));
      assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
      assertEqual(authoritySnapshot(firstDb), before);
    });
  }
});

summary();
