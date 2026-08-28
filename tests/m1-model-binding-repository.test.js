#!/usr/bin/env node

import { createHash } from 'node:crypto';
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
      let result;
      if (workerData.action === 'provider-terminal') {
        result = repository.recordManualProviderPullSucceeded({
          operationId: workerData.providerOperationId,
          claimToken: workerData.claimToken,
          expectedFencingRevision: workerData.expectedFencingRevision,
          observedModelName: workerData.observedModelName,
          observedDigestSha256: workerData.observedDigestSha256,
        });
      } else {
        result = repository.recordUserBindingApply({
          requestKey: workerData.requestKey,
          role: workerData.role,
          expectedBindingRevision: desired.bindingRevision,
          targetModelName: workerData.targetModelName,
          targetDigestSha256: workerData.targetDigestSha256,
          actor: workerData.actor,
        });
      }
      parentPort.postMessage({
        type: 'result',
        prefix: workerData.prefix,
        outcome: result.outcome,
        operationId: result.operation?.operationId ?? result.claim?.operationId ?? null,
        receiptId: result.noOpReceipt?.receiptId ?? null,
        supersededProviderOperationIds:
          result.noOpReceipt?.supersededProviderOperationIds ?? null,
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

function providerClaim(operation) {
  assert(operation?.claim, 'Expected provider operation to own an active claim');
  return {
    claimToken: operation.claim.claimToken,
    expectedFencingRevision: operation.claim.fencingRevision,
  };
}

function finalizeRuntime(repository, operationId, expectedAttemptRevision, configVersion = 1) {
  return repository.recordManualRuntimeFinalized({
    operationId,
    expectedAttemptRevision,
    configVersion,
  });
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
  // Decision 022/A: the rollback names the attempt it was issued for.
  const state = repository.getBindingApplicationState(applyOperationId);
  return repository.recordUserBindingRollback({
    requestKey: 'request-user-rollback-0001',
    role: 'CHAT',
    expectedBindingRevision: 2,
    rollbackOfOperationId: applyOperationId,
    expectedFailedVerificationAttemptRevision: state?.attemptRevision ?? 0,
    actor: 'user:fixture',
    ...overrides,
  });
}

function detectChat(repository, expectedDesiredRevision = 1) {
  return repository.recordDetection({ role: 'CHAT', expectedDesiredRevision });
}

const PROOF_ARTIFACT_SOURCE_REVISION = 'f'.repeat(40);

// Decision 015 (migration 067): a proof cannot exist without its durable
// content-addressed artifacts, so the fixture writes them first.
function insertProofArtifactFixture(db, kind, proofId) {
  const artifactSha256 = createHash('sha256').update(`${kind}:${proofId}`).digest('hex');
  db.prepare(`
    INSERT OR IGNORE INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, ?, 1, ?, 1)
  `).run(artifactSha256, kind, PROOF_ARTIFACT_SOURCE_REVISION);
  return artifactSha256;
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
      created_at_ms, measurement_artifact_sha256, acceptance_artifact_sha256,
      source_revision
    ) VALUES (?, ?, 'CHAT', 'chat', ?, ?, ?, ?,
      'v123.1', 'd-plus-v1', 1, 0.8, 6, 5, 6, 500, 'PASS',
      ?, ?, ?, ?, ?, ?, 900000, ?, ?, ?, ?)
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
    insertProofArtifactFixture(db, 'MEASUREMENT', proofId),
    insertProofArtifactFixture(db, 'PARENT_ACCEPTANCE', proofId),
    PROOF_ARTIFACT_SOURCE_REVISION,
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

// Upgrade compatibility fixture only. Automatic failover claim/terminal writers
// are intentionally absent from the public repository contract; these rows
// model incidents that may already exist in an upgraded database.
function insertHistoricalFailoverClaim(db, state, {
  kind = 'ACTIVATE',
  operationId = `operation-historical-${kind.toLowerCase()}`,
  claimToken = `claim-token-historical-${kind.toLowerCase()}-0001`,
  createdAtMs = 2200,
} = {}) {
  const desired = db.prepare(`
    SELECT model_name, digest_sha256
    FROM model_desired_bindings
    WHERE role = 'CHAT' AND binding_revision = ?
  `).get(state.desiredRevision);
  const eventType = kind === 'ACTIVATE' ? 'ACTIVATION_CLAIMED' : 'RESTORE_CLAIMED';
  const eventId = `event-binding-repository-historical-${kind.toLowerCase()}-claimed`;
  const rowVersion = state.rowVersion + 1;
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256, created_at_ms
    ) VALUES (?, ?, 'CHAT', ?, ?, ?, ?, 'system:binding-integrity',
      'FAILOVER_OPERATION_CLAIMED', 'd-plus-v1', ?, ?, ?, ?, ?)
  `).run(
    eventId,
    eventType,
    state.desiredRevision,
    rowVersion,
    state.episodeId,
    operationId,
    state.state,
    state.state,
    desired.model_name,
    desired.digest_sha256,
    createdAtMs,
  );
  db.prepare(`
    UPDATE model_failover_state
    SET row_version = ?, claim_operation_id = ?, claim_token = ?,
        claim_kind = ?, claim_started_at_ms = ?, claim_expires_at_ms = ?,
        updated_at_ms = ?, last_event_id = ?
    WHERE role = 'CHAT'
  `).run(
    rowVersion,
    operationId,
    claimToken,
    kind,
    createdAtMs,
    createdAtMs + 1000,
    createdAtMs,
    eventId,
  );
  return {
    state: { ...state, rowVersion },
    claim: { operationId, token: claimToken, kind },
  };
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
    'model_binding_application_attempts',
    'model_binding_runtime_finalize_cutoffs',
    'model_binding_runtime_finalize_receipts',
    'model_binding_provider_operations',
    'model_binding_provider_attempts',
    'model_binding_provider_claims',
    'model_binding_user_noop_receipts',
    'model_binding_user_noop_provider_supersedes',
    'model_overrides',
    'upgrade_history',
  ];
  return JSON.stringify(Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ])));
}

suite('M1 manual binding repository — durable intent and idempotency');

await testAsync('same-target user apply is a durable audited no-op', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('apply-noop-contract');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const noOp = applyChat(repository, {
      requestKey: 'request-alias-noop-0001',
      targetModelName: 'reasoner:latest',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(noOp.outcome, 'UNCHANGED');
    assertEqual(noOp.requestKeyConsumed, true);
    assertEqual(noOp.operation, null);
    assertEqual(noOp.noOpReceipt.role, 'CHAT');
    assertEqual(noOp.noOpReceipt.bindingRevision, 1);
    assertEqual(noOp.noOpReceipt.canonicalName, 'reasoner');
    assertEqual(noOp.committedDesired.bindingRevision, 1);
    assertEqual(noOp.committedDesired.source, 'LEGACY_OVERRIDE');
    assertEqual(noOp.committedDesired.actor, 'user:fixture');
    assertEqual(runtime.counters.operation, 1);
    assertEqual(runtime.counters.event, 1);
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_user_noop_receipts').get().n,
      1,
    );

    const replay = applyChat(repository, {
      requestKey: 'request-alias-noop-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(replay.noOpReceipt.receiptId, noOp.noOpReceipt.receiptId);
    assertEqual(runtime.counters.operation, 1);

    const negativeReceiptRowid = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        rowid, receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms
      )
      SELECT -1, 'receipt-negative-rowid-0001', 'request-negative-rowid-0001',
        role, binding_revision, model_name, canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms + 1
      FROM model_binding_user_noop_receipts
      WHERE receipt_id = ?
    `).run(noOp.noOpReceipt.receiptId));
    assert(/MODEL_BINDING_USER_NOOP_ROWID_AUTHORITY/.test(negativeReceiptRowid.message));
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_user_noop_receipts').get().n,
      1,
    );

    const nullReceiptIdentity = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms
      )
      SELECT NULL, 'request-null-receipt-id-0001', role, binding_revision,
        model_name, canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms + 1
      FROM model_binding_user_noop_receipts
      WHERE receipt_id = ?
    `).run(noOp.noOpReceipt.receiptId));
    assert(
      /MODEL_BINDING_USER_NOOP_IDENTITY_REQUIRED/.test(nullReceiptIdentity.message),
      `Expected NULL receipt identity rejection, got ${nullReceiptIdentity.message}`,
    );
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_user_noop_receipts').get().n,
      1,
    );

    runtime.setNow(2200);
    const later = applyChat(repository, {
      requestKey: 'request-after-noop-0001',
      targetModelName: 'candidate',
      targetDigestSha256: DIGEST_B,
    });
    assertEqual(later.committedDesired.bindingRevision, 2);
    const lateReplay = applyChat(repository, {
      requestKey: 'request-alias-noop-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(lateReplay.noOpReceipt.bindingRevision, 1);
    assertEqual(lateReplay.committedDesired.bindingRevision, 1);
    assertEqual(lateReplay.committedDesired.modelName, 'reasoner');
    assertEqual(lateReplay.currentDesired.bindingRevision, 2);
    assertEqual(lateReplay.currentDesired.modelName, 'candidate');

    const replayConflict = captureError(() => applyChat(repository, {
      requestKey: 'request-alias-noop-0001',
      targetModelName: 'candidate',
      targetDigestSha256: DIGEST_B,
    }));
    assertRepositoryError(replayConflict, 'MODEL_FAILOVER_REQUEST_KEY_CONFLICT');

    for (const sql of [
      `UPDATE model_binding_user_noop_receipts SET actor = 'user:other'`,
      `DELETE FROM model_binding_user_noop_receipts`,
    ]) {
      const immutable = captureError(() => firstDb.exec(sql));
      assert(/append-only/.test(immutable.message));
    }
    const receiptBeforeReplace = firstDb.prepare(`
      SELECT rowid AS storage_rowid, receipt_id, request_key, actor, created_at_ms
      FROM model_binding_user_noop_receipts
      WHERE receipt_id = ?
    `).get(noOp.noOpReceipt.receiptId);
    const replaceReceipt = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms
      )
      SELECT receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, 'user:replacement',
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms + 1
      FROM model_binding_user_noop_receipts
      WHERE receipt_id = ?
    `).run(noOp.noOpReceipt.receiptId));
    assert(/MODEL_BINDING_USER_NOOP_APPEND_ONLY_CONFLICT/.test(replaceReceipt.message));
    assertEqual(
      JSON.stringify(firstDb.prepare(`
        SELECT rowid AS storage_rowid, receipt_id, request_key, actor, created_at_ms
        FROM model_binding_user_noop_receipts
        WHERE receipt_id = ?
      `).get(noOp.noOpReceipt.receiptId)),
      JSON.stringify(receiptBeforeReplace),
    );
    const hiddenRowidReplacement = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_binding_user_noop_receipts (
        rowid, receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms
      )
      SELECT rowid, 'receipt-hidden-rowid-0001', 'request-hidden-rowid-0001',
        role, binding_revision, model_name, canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id,
        created_at_ms
      FROM model_binding_user_noop_receipts
      WHERE receipt_id = ?
    `).run(noOp.noOpReceipt.receiptId));
    assert(/MODEL_BINDING_USER_NOOP_ROWID_AUTHORITY/.test(hiddenRowidReplacement.message));
    assertEqual(
      JSON.stringify(firstDb.prepare(`
        SELECT rowid AS storage_rowid, receipt_id, request_key, actor, created_at_ms
        FROM model_binding_user_noop_receipts
        WHERE receipt_id = ?
      `).get(noOp.noOpReceipt.receiptId)),
      JSON.stringify(receiptBeforeReplace),
    );
    for (const [receiptId, requestKey] of [
      [noOp.noOpReceipt.receiptId, 'request-replace-receipt-id-0001'],
      ['receipt-replace-request-key-0001', noOp.noOpReceipt.requestKey],
    ]) {
      const identityReplace = captureError(() => firstDb.prepare(`
        INSERT OR REPLACE INTO model_binding_user_noop_receipts (
          receipt_id, request_key, role, binding_revision, model_name,
          canonical_name, digest_sha256, actor,
          desired_source, desired_actor, desired_observed_at_ms,
          desired_updated_at_ms, desired_last_event_id,
          provider_command_cutoff_seq, source_provider_operation_id,
          created_at_ms
        )
        SELECT ?, ?, role, binding_revision, model_name,
          canonical_name, digest_sha256, 'user:replacement',
          desired_source, desired_actor, desired_observed_at_ms,
          desired_updated_at_ms, desired_last_event_id,
          provider_command_cutoff_seq, source_provider_operation_id,
          created_at_ms + 1
        FROM model_binding_user_noop_receipts
        WHERE receipt_id = ?
      `).run(receiptId, requestKey, noOp.noOpReceipt.receiptId));
      assert(/MODEL_BINDING_USER_NOOP_APPEND_ONLY_CONFLICT/.test(identityReplace.message));
    }
    const invalidActor = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        created_at_ms
      )
      SELECT 'receipt-invalid-actor-0001', 'request-invalid-actor-0001',
        role, binding_revision, model_name, canonical_name, digest_sha256,
        'system:fixture', source, actor, observed_at_ms, updated_at_ms,
        last_event_id, 2300
      FROM model_desired_bindings WHERE role = 'CHAT'
    `).run());
    assert(/NOOP_ACTOR_INVALID/.test(invalidActor.message));

    const invalidProjection = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        created_at_ms
      )
      SELECT 'receipt-invalid-projection-0001', 'request-invalid-projection-0001',
        role, binding_revision + 1, model_name, canonical_name, digest_sha256,
        'user:fixture', source, actor, observed_at_ms, updated_at_ms,
        last_event_id, 2300
      FROM model_desired_bindings WHERE role = 'CHAT'
    `).run());
    assert(/NOOP_PROJECTION_MISMATCH/.test(invalidProjection.message));

    const backdated = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        created_at_ms
      )
      SELECT 'receipt-backdated-0001', 'request-backdated-noop-0001',
        role, binding_revision, model_name, canonical_name, digest_sha256,
        'user:fixture', source, actor, observed_at_ms, updated_at_ms,
        last_event_id, 1
      FROM model_desired_bindings WHERE role = 'CHAT'
    `).run());
    assert(/NOOP_PROJECTION_MISMATCH/.test(backdated.message));

    const unicodeWhitespaceActor = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        created_at_ms
      )
      SELECT 'receipt-unicode-actor-0001', 'request-unicode-actor-0001',
        role, binding_revision, model_name, canonical_name, digest_sha256,
        'user:' || char(160) || 'fixture', source, actor, observed_at_ms, updated_at_ms,
        last_event_id, 2300
      FROM model_desired_bindings WHERE role = 'CHAT'
    `).run());
    assert(/NOOP_ACTOR_INVALID/.test(unicodeWhitespaceActor.message));
  });
});

await testAsync('no-op provider supersession uses committed terminal lineage, not timestamps', async () => {
  await withRepository(async ({ firstDb, secondDb }) => {
    const firstRuntime = createRuntime('noop-first', 1000);
    const secondRuntime = createRuntime('provider-second', 900);
    const first = createModelFailoverRepository(firstDb, firstRuntime.options);
    const second = createModelFailoverRepository(secondDb, secondRuntime.options);
    observeChat(first);

    const receipt = applyChat(first, {
      requestKey: 'request-noop-before-provider-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    for (const invalidSeq of [0, -1, -2, 99]) {
      let invalidSequence = null;
      try {
        firstDb.prepare(`
        INSERT INTO model_binding_provider_operations (
          command_seq, operation_id, request_key, role, effect_kind,
          request_purpose, expected_binding_revision, provider_origin,
          requested_model_name, requested_canonical_name, actor,
          initial_claim_token, initial_claim_expires_at_ms, created_at_ms
        ) VALUES (?, ?, ?, 'CHAT', 'PULL', 'USER_APPLY_TARGET', 1,
          'http://127.0.0.1:11434', 'sequence-target', 'sequence-target',
          'user:fixture', ?, 300900, 900)
        `).run(
          invalidSeq,
          `provider-invalid-sequence-${invalidSeq}`,
          `request-invalid-sequence-${invalidSeq}`,
          `claim-invalid-sequence-${invalidSeq}`,
        );
      } catch (error) {
        invalidSequence = error;
      }
      assert(invalidSequence, `Explicit provider command sequence ${invalidSeq} was accepted`);
      const expectedSignal = invalidSeq === -1
        ? /CHECK constraint failed/
        : /COMMAND_SEQUENCE_AUTHORITY/;
      assert(expectedSignal.test(invalidSequence.message),
        `Expected invalid provider command sequence rejection, got ${invalidSequence.message}`);
    }
    const laterProvider = second.recordManualProviderPullIntent({
      requestKey: 'request-provider-after-noop-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    });
    assert(receipt.noOpReceipt.createdAtMs > laterProvider.operation.createdAtMs);
    secondRuntime.setNow(950);
    second.recordManualProviderPullSucceeded({
      operationId: laterProvider.operation.operationId,
      ...providerClaim(laterProvider.operation),
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });
    assertEqual(receipt.noOpReceipt.providerCommandCutoffSeq, 0);
    assert(laterProvider.operation.commandSeq > receipt.noOpReceipt.providerCommandCutoffSeq);
    const lateLinkEligible = secondDb.prepare(`
      SELECT provider.operation_id
      FROM model_binding_user_noop_receipts receipt
      JOIN model_binding_provider_operations provider
        ON provider.operation_id = ?
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE receipt.receipt_id = ?
        AND provider.role = receipt.role
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = receipt.binding_revision
        AND provider.command_seq <= receipt.provider_command_cutoff_seq
        AND provider.created_at_ms <= receipt.created_at_ms
        AND terminal.created_at_ms <= receipt.created_at_ms
    `).get(laterProvider.operation.operationId, receipt.noOpReceipt.receiptId);
    assertEqual(lateLinkEligible, undefined);
    const lineageTrigger = secondDb.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_model_binding_user_noop_provider_lineage'
    `).get();
    assert(lineageTrigger?.sql.includes('provider.command_seq <= receipt.provider_command_cutoff_seq'));
    const forgedLateLink = captureError(() => secondDb.prepare(`
      INSERT INTO model_binding_user_noop_provider_supersedes (
        receipt_id, provider_operation_id
      ) VALUES (?, ?)
    `).run(receipt.noOpReceipt.receiptId, laterProvider.operation.operationId));
    assert(
      /NOOP_PROVIDER_(?:CUTOFF|LINEAGE)_MISMATCH/.test(forgedLateLink.message),
      `Expected provider frontier rejection, got ${forgedLateLink.message}`,
    );
    assertEqual(
      first.getRelevantProviderOperation('CHAT').operationId,
      laterProvider.operation.operationId,
    );
  }, { second: true });

  await withRepository(async ({ firstDb, secondDb }) => {
    const providerRuntime = createRuntime('provider-first', 1000);
    const noopRuntime = createRuntime('noop-second', 1000);
    const providerRepository = createModelFailoverRepository(firstDb, providerRuntime.options);
    const noopRepository = createModelFailoverRepository(secondDb, noopRuntime.options);
    observeChat(providerRepository);
    const earlierProvider = providerRepository.recordManualProviderPullIntent({
      requestKey: 'request-provider-before-noop-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    });
    const beforeTerminal = captureError(() => applyChat(noopRepository, {
      requestKey: 'request-noop-live-provider-0001',
      targetModelName: 'final-candidate',
      targetDigestSha256: DIGEST_A,
    }));
    assertRepositoryError(beforeTerminal, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_user_noop_receipts').get().n,
      0,
    );
    providerRuntime.setNow(1100);
    providerRepository.recordManualProviderPullSucceeded({
      operationId: earlierProvider.operation.operationId,
      ...providerClaim(earlierProvider.operation),
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });
    assertEqual(
      providerRepository.getRelevantProviderOperation('CHAT').operationId,
      earlierProvider.operation.operationId,
    );
    noopRuntime.setNow(1200);
    const receipt = applyChat(noopRepository, {
      requestKey: 'request-noop-after-provider-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(JSON.stringify(receipt.noOpReceipt.supersededProviderOperationIds), JSON.stringify([
      earlierProvider.operation.operationId,
    ]));
    assertEqual(providerRepository.getRelevantProviderOperation('CHAT'), null);
    noopRuntime.setNow(1300);
    const laterReceipt = applyChat(noopRepository, {
      requestKey: 'request-second-noop-after-provider-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(
      JSON.stringify(laterReceipt.noOpReceipt.supersededProviderOperationIds),
      JSON.stringify([]),
    );
    const replaceLineage = captureError(() => secondDb.prepare(`
      INSERT OR REPLACE INTO model_binding_user_noop_provider_supersedes (
        receipt_id, provider_operation_id
      ) VALUES (?, ?)
    `).run(laterReceipt.noOpReceipt.receiptId, earlierProvider.operation.operationId));
    assert(/NOOP_PROVIDER_SUPERSEDES_CONFLICT/.test(replaceLineage.message));
    const hiddenLineageRowid = captureError(() => secondDb.prepare(`
      INSERT OR REPLACE INTO model_binding_user_noop_provider_supersedes (
        rowid, receipt_id, provider_operation_id
      )
      SELECT rowid, ?, provider_operation_id
      FROM model_binding_user_noop_provider_supersedes
      WHERE provider_operation_id = ?
    `).run(
      laterReceipt.noOpReceipt.receiptId,
      earlierProvider.operation.operationId,
    ));
    assert(
      /MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_ROWID_AUTHORITY/.test(
        hiddenLineageRowid.message,
      ),
    );
    assertEqual(
      secondDb.prepare(`
        SELECT receipt_id
        FROM model_binding_user_noop_provider_supersedes
        WHERE provider_operation_id = ?
      `).get(earlierProvider.operation.operationId).receipt_id,
      receipt.noOpReceipt.receiptId,
    );
  }, { second: true });
});

await testAsync('two WAL workers serialize provider terminal versus current-binding no-op', async () => {
  await withRepository(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('provider-noop-wal-race', 1000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const provider = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-noop-race-source-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    });
    const results = await runManualBindingRace({
      databasePath,
      contenders: [
        {
          prefix: 'race-provider-terminal',
          action: 'provider-terminal',
          nowMs: 2100,
          providerOperationId: provider.operation.operationId,
          claimToken: provider.operation.claim.claimToken,
          expectedFencingRevision: provider.operation.claim.fencingRevision,
          observedModelName: 'candidate',
          observedDigestSha256: DIGEST_B,
        },
        {
          prefix: 'race-current-noop',
          action: 'apply',
          nowMs: 2100,
          requestKey: 'request-provider-noop-race-receipt-0001',
          targetModelName: 'reasoner',
          targetDigestSha256: DIGEST_A,
        },
      ],
    });
    const terminalResult = results.find(result => result.prefix === 'race-provider-terminal');
    const noopResult = results.find(result => result.prefix === 'race-current-noop');
    assertEqual(terminalResult.outcome, 'RECORDED');
    assert(
      noopResult.outcome === 'UNCHANGED'
        || noopResult.errorCode === 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS',
      `Unexpected no-op race result ${JSON.stringify(noopResult)}`,
    );
    if (noopResult.outcome === 'UNCHANGED') {
      assertEqual(JSON.stringify(noopResult.supersededProviderOperationIds), JSON.stringify([
        provider.operation.operationId,
      ]));
    } else {
      runtime.setNow(2200);
      const closed = applyChat(repository, {
        requestKey: 'request-provider-noop-race-receipt-0001',
        targetModelName: 'reasoner',
        targetDigestSha256: DIGEST_A,
      });
      assertEqual(JSON.stringify(closed.noOpReceipt.supersededProviderOperationIds), JSON.stringify([
        provider.operation.operationId,
      ]));
    }
    assertEqual(repository.getRelevantProviderOperation('CHAT'), null);
    assertEqual(repository.listResumableProviderOperations().length, 0);
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_user_noop_receipts').get().n,
      1,
    );
  });
});

await testAsync('two WAL workers serialize provider completion versus current-binding closure', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await withRepository(async ({ firstDb, databasePath }) => {
      const runtime = createRuntime(`provider-completion-noop-race-${attempt}`, 1000);
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      const provider = repository.recordManualProviderPullIntent({
        requestKey: `request-provider-completion-race-${attempt}-0001`,
        role: 'CHAT',
        requestPurpose: 'USER_APPLY_TARGET',
        expectedBindingRevision: 1,
        providerOrigin: 'http://127.0.0.1:11434',
        targetModelName: 'candidate',
        actor: 'user:fixture',
      });
      runtime.setNow(1100);
      repository.recordManualProviderPullSucceeded({
        operationId: provider.operation.operationId,
        ...providerClaim(provider.operation),
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
      });

      const results = await runManualBindingRace({
        databasePath,
        contenders: [
          {
            prefix: `race-provider-completion-${attempt}`,
            requestKey: provider.operation.requestKey,
            targetModelName: 'candidate',
            targetDigestSha256: DIGEST_B,
          },
          {
            prefix: `race-provider-closure-${attempt}`,
            requestKey: `request-provider-closure-race-${attempt}-0001`,
            targetModelName: 'reasoner',
            targetDigestSha256: DIGEST_A,
          },
        ],
      });
      const completion = results.find(result => result.prefix.includes('completion'));
      const closure = results.find(result => result.prefix.includes('closure'));
      const bindingWon = completion.outcome === 'RECORDED'
        && closure.errorCode === 'MODEL_FAILOVER_STALE_DESIRED';
      const closureWon = closure.outcome === 'UNCHANGED'
        && completion.errorCode === 'MODEL_BINDING_PROVIDER_COMMAND_SUPERSEDED';
      assert(
        bindingWon || closureWon,
        `Unexpected provider completion/closure race ${JSON.stringify(results)}`,
      );
      assertEqual(
        firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_operations').get().n,
        bindingWon ? 1 : 0,
      );
      assertEqual(
        firstDb.prepare('SELECT COUNT(*) AS n FROM model_binding_user_noop_receipts').get().n,
        closureWon ? 1 : 0,
      );
      assertEqual(repository.listResumableProviderOperations().length, 0);
    });
  }
});

await testAsync('provider request key can become an exact same-target no-op only after its terminal', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-noop-source', 2000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const provider = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-source-noop-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'reasoner',
      actor: 'user:fixture',
    });
    runtime.setNow(3000);
    repository.recordManualProviderPullSucceeded({
      operationId: provider.operation.operationId,
      ...providerClaim(provider.operation),
      observedModelName: 'reasoner:latest',
      observedDigestSha256: DIGEST_A,
    });

    const backdated = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_user_noop_receipts (
        receipt_id, request_key, role, binding_revision, model_name,
        canonical_name, digest_sha256, actor,
        desired_source, desired_actor, desired_observed_at_ms,
        desired_updated_at_ms, desired_last_event_id,
        provider_command_cutoff_seq, source_provider_operation_id, created_at_ms
      )
      SELECT 'receipt-source-backdated-0001', 'request-backdated-terminal-0001',
        role, binding_revision,
        model_name, canonical_name, digest_sha256, 'user:fixture',
        source, actor, observed_at_ms, updated_at_ms, last_event_id, ?, NULL, 2500
      FROM model_desired_bindings WHERE role = 'CHAT'
    `).run(
      provider.operation.commandSeq,
    ));
    assert(
      /NOOP_TIME_ROLLBACK/.test(backdated.message),
      `Expected no-op/provider terminal ordering rejection, got ${backdated.message}`,
    );

    runtime.setNow(3100);
    const accepted = applyChat(repository, {
      requestKey: provider.operation.requestKey,
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(accepted.noOpReceipt.sourceProviderOperationId, provider.operation.operationId);
    assertEqual(JSON.stringify(accepted.noOpReceipt.supersededProviderOperationIds), JSON.stringify([
      provider.operation.operationId,
    ]));
    const replay = applyChat(repository, {
      requestKey: provider.operation.requestKey,
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(repository.listResumableProviderOperations().length, 0);
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-noop-source-reverse-alias', 2000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository, { modelName: 'reasoner:latest' });
    const provider = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-source-reverse-alias-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'reasoner:latest',
      actor: 'user:fixture',
    });
    runtime.setNow(3000);
    repository.recordManualProviderPullSucceeded({
      operationId: provider.operation.operationId,
      ...providerClaim(provider.operation),
      observedModelName: 'reasoner',
      observedDigestSha256: DIGEST_A,
    });
    runtime.setNow(3100);
    const accepted = applyChat(repository, {
      requestKey: provider.operation.requestKey,
      targetModelName: 'reasoner:latest',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(accepted.noOpReceipt.sourceProviderOperationId, provider.operation.operationId);
    assertEqual(repository.listResumableProviderOperations().length, 0);
  });
});

await testAsync('no-op links every prior terminal command and unresolved success blocks a newer intent', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-noop-set', 4000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const terminalIds = [];
    for (const [index, target] of ['candidate', 'other-candidate'].entries()) {
      const provider = repository.recordManualProviderPullIntent({
        requestKey: `request-provider-failed-${index}-0001`,
        role: 'CHAT',
        requestPurpose: 'USER_APPLY_TARGET',
        expectedBindingRevision: 1,
        providerOrigin: 'http://127.0.0.1:11434',
        targetModelName: target,
        actor: 'user:fixture',
      });
      terminalIds.push(provider.operation.operationId);
      runtime.setNow(4100 + (index * 100));
      repository.recordManualProviderPullFailed({
        operationId: provider.operation.operationId,
        ...providerClaim(provider.operation),
        failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
      });
    }
    runtime.setNow(4400);
    const success = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-success-before-noop-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'final-candidate',
      actor: 'user:fixture',
    });
    terminalIds.push(success.operation.operationId);
    runtime.setNow(4500);
    repository.recordManualProviderPullSucceeded({
      operationId: success.operation.operationId,
      ...providerClaim(success.operation),
      observedModelName: 'final-candidate',
      observedDigestSha256: CONTRACT_DIGEST,
    });

    const blocked = captureError(() => repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-after-unresolved-success-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'newer-target',
      actor: 'user:fixture',
    }));
    assertRepositoryError(blocked, 'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS');
    const directBlocked = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_operations (
        operation_id, request_key, role, effect_kind, request_purpose,
        expected_binding_revision, provider_origin, requested_model_name,
        requested_canonical_name, actor, initial_claim_token,
        initial_claim_expires_at_ms, created_at_ms
      ) VALUES (
        'provider-direct-unresolved-0001', 'request-direct-unresolved-0001',
        'CHAT', 'PULL', 'USER_APPLY_TARGET', 1, 'http://127.0.0.1:11434',
        'newer-target', 'newer-target', 'user:fixture',
        'claim-direct-unresolved-0001', 304501, 4501
      )
    `).run());
    assert(/PROVIDER_UNRESOLVED_SUCCESS/.test(directBlocked.message));

    runtime.setNow(4600);
    const receipt = applyChat(repository, {
      requestKey: 'request-noop-supersede-terminal-set-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(
      JSON.stringify(receipt.noOpReceipt.supersededProviderOperationIds),
      JSON.stringify(terminalIds),
    );
    assertEqual(repository.getRelevantProviderOperation('CHAT'), null);
    assertEqual(repository.listResumableProviderOperations().length, 0);
    const resurrectedProvider = captureError(() => repository.recordUserBindingApply({
      requestKey: success.operation.requestKey,
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'final-candidate',
      targetDigestSha256: CONTRACT_DIGEST,
      actor: 'user:fixture',
    }));
    assertRepositoryError(
      resurrectedProvider,
      'MODEL_BINDING_PROVIDER_COMMAND_SUPERSEDED',
    );

    const directSql = firstDb.prepare(`
      INSERT INTO model_binding_provider_operations (
        operation_id, request_key, role, effect_kind, request_purpose,
        expected_binding_revision, provider_origin, requested_model_name,
        requested_canonical_name, actor, initial_claim_token,
        initial_claim_expires_at_ms, created_at_ms
      ) VALUES (
        'provider-direct-after-receipt-0001', 'request-direct-after-receipt-0001',
        'CHAT', 'PULL', 'USER_APPLY_TARGET', 1, 'http://127.0.0.1:11434',
        'allowed-after-receipt', 'allowed-after-receipt', 'user:fixture',
        'claim-direct-after-receipt-0001', 304601, 4601
      )
    `).run();
    assertEqual(directSql.changes, 1);
  });
});

await testAsync('pending or unresolved provider authority blocks every desired transition until closure', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-transition-guard', 5000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const mutateDesiredWithoutRevision = (suffix, nowMs) => captureError(() => firstDb
      .transaction(() => {
        const eventId = `event-provider-transition-${suffix}-0001`;
        firstDb.prepare(`
          INSERT INTO model_failover_events (
            event_id, event_type, role, binding_revision, actor, reason_code,
            policy_version, desired_model_name, desired_digest_sha256,
            created_at_ms
          ) VALUES (?, 'DESIRED_CHANGED', 'CHAT', 1, 'user:fixture',
            'DESIRED_BINDING_CHANGED', 'd-plus-v1', 'same-revision-other', ?, ?)
        `).run(eventId, CONTRACT_DIGEST, nowMs);
        firstDb.prepare(`
          UPDATE model_desired_bindings
          SET model_name = 'same-revision-other',
              canonical_name = 'same-revision-other', digest_sha256 = ?,
              source = 'LEGACY_OVERRIDE', actor = 'user:fixture',
              observed_at_ms = ?, updated_at_ms = ?, last_event_id = ?
          WHERE role = 'CHAT' AND binding_revision = 1
        `).run(CONTRACT_DIGEST, nowMs, nowMs, eventId);
      })());
    const replaceDesiredWithoutRevision = (suffix, nowMs) => captureError(() => firstDb
      .transaction(() => {
        const eventId = `event-provider-replace-${suffix}-0001`;
        firstDb.prepare(`
          INSERT INTO model_failover_events (
            event_id, event_type, role, binding_revision, actor, reason_code,
            policy_version, desired_model_name, desired_digest_sha256,
            created_at_ms
          ) VALUES (?, 'DESIRED_CHANGED', 'CHAT', 1, 'user:fixture',
            'DESIRED_BINDING_CHANGED', 'd-plus-v1', 'replace-same-revision', ?, ?)
        `).run(eventId, CONTRACT_DIGEST, nowMs);
        firstDb.prepare(`
          INSERT OR REPLACE INTO model_desired_bindings (
            role, model_name, canonical_name, digest_sha256,
            binding_revision, source, actor, observed_at_ms,
            updated_at_ms, last_event_id
          ) VALUES (
            'CHAT', 'replace-same-revision', 'replace-same-revision', ?,
            1, 'LEGACY_OVERRIDE', 'user:fixture', ?, ?, ?
          )
        `).run(CONTRACT_DIGEST, nowMs, nowMs, eventId);
      })());
    const deleteDesired = () => captureError(() => firstDb.prepare(`
      DELETE FROM model_desired_bindings WHERE role = 'CHAT'
    `).run());
    const provider = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-transition-guard-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    });
    const pendingApply = captureError(() => applyChat(repository, {
      requestKey: 'request-transition-pending-apply-0001',
      targetModelName: 'other-installed',
      targetDigestSha256: CONTRACT_DIGEST,
    }));
    assertRepositoryError(pendingApply, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    const pendingDirectMutation = mutateDesiredWithoutRevision('pending', 5050);
    assert(/MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS/.test(pendingDirectMutation.message));
    const pendingReplace = replaceDesiredWithoutRevision('pending', 5060);
    assert(/MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS/.test(pendingReplace.message));
    const pendingDelete = deleteDesired();
    assert(/MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS/.test(pendingDelete.message));
    runtime.setNow(5100);
    repository.recordManualProviderPullSucceeded({
      operationId: provider.operation.operationId,
      ...providerClaim(provider.operation),
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });
    const unresolvedDirectMutation = mutateDesiredWithoutRevision('unresolved', 5150);
    assert(/MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS/.test(unresolvedDirectMutation.message));
    const unresolvedReplace = replaceDesiredWithoutRevision('unresolved', 5160);
    assert(/MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS/.test(unresolvedReplace.message));
    const unresolvedDelete = deleteDesired();
    assert(/MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS/.test(unresolvedDelete.message));

    const unresolvedApply = captureError(() => applyChat(repository, {
      requestKey: 'request-transition-unresolved-apply-0001',
      targetModelName: 'other-installed',
      targetDigestSha256: CONTRACT_DIGEST,
    }));
    assertRepositoryError(unresolvedApply, 'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS');
    const unresolvedObserve = captureError(() => observeChat(repository, {
      modelName: 'new-baseline',
      digestSha256: CONTRACT_DIGEST,
    }));
    assertRepositoryError(unresolvedObserve, 'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS');
    const directDesired = captureError(() => firstDb.prepare(`
      UPDATE model_desired_bindings
      SET binding_revision = binding_revision + 1
      WHERE role = 'CHAT'
    `).run());
    assert(/MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS/.test(directDesired.message));
    assertEqual(repository.getDesired('CHAT').bindingRevision, 1);

    runtime.setNow(5200);
    const closure = applyChat(repository, {
      requestKey: 'request-transition-current-closure-0001',
      targetModelName: 'reasoner',
      targetDigestSha256: DIGEST_A,
    });
    assertEqual(closure.outcome, 'UNCHANGED');
    runtime.setNow(5300);
    const observed = observeChat(repository, {
      modelName: 'new-baseline',
      digestSha256: CONTRACT_DIGEST,
    });
    assertEqual(observed.outcome, 'CHANGED');
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-rollback-guard', 6000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const applied = applyChat(repository);
    runtime.setNow(6100);
    const provider = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-rollback-guard-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 2,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'other-installed',
      actor: 'user:fixture',
    });
    runtime.setNow(6200);
    repository.recordManualProviderPullSucceeded({
      operationId: provider.operation.operationId,
      ...providerClaim(provider.operation),
      observedModelName: 'other-installed',
      observedDigestSha256: CONTRACT_DIGEST,
    });
    const blockedRollback = captureError(() => rollbackChat(
      repository,
      applied.operation.operationId,
      { requestKey: 'request-provider-blocked-rollback-0001' },
    ));
    assertRepositoryError(blockedRollback, 'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS');
    assertEqual(repository.getDesired('CHAT').bindingRevision, 2);
    runtime.setNow(6300);
    applyChat(repository, {
      requestKey: 'request-provider-rollback-closure-0001',
      expectedBindingRevision: 2,
      targetModelName: 'candidate',
      targetDigestSha256: DIGEST_B,
    });
    runtime.setNow(6400);
    const rolledBack = rollbackChat(repository, applied.operation.operationId, {
      requestKey: 'request-provider-unblocked-rollback-0001',
    });
    assertEqual(rolledBack.outcome, 'RECORDED');
  });
});

await testAsync('provider intent requires an existing current desired revision', async () => {
  await withRepository(async ({ firstDb }) => {
    const repository = createModelFailoverRepository(firstDb, createRuntime('provider-desired').options);
    const missing = captureError(() => repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-missing-desired-0001',
      role: 'R1',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    }));
    assertRepositoryError(missing, 'MODEL_FAILOVER_STALE_DESIRED');
    observeChat(repository);
    const stale = captureError(() => repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-stale-desired-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 999,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    }));
    assertRepositoryError(stale, 'MODEL_FAILOVER_STALE_DESIRED');
    const direct = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_operations (
        operation_id, request_key, role, effect_kind, request_purpose,
        expected_binding_revision, provider_origin, requested_model_name,
        requested_canonical_name, actor, initial_claim_token,
        initial_claim_expires_at_ms, created_at_ms
      ) VALUES (
        'provider-direct-stale-desired-0001', 'request-direct-stale-desired-0001',
        'CHAT', 'PULL', 'USER_APPLY_TARGET', 999, 'http://127.0.0.1:11434',
        'candidate', 'candidate', 'user:fixture',
        'claim-direct-stale-desired-0001', 301000, 1000
      )
    `).run());
    assert(/MODEL_BINDING_PROVIDER_DESIRED_MISMATCH/.test(direct.message));
    const legacy = repository.recordManualProviderPullIntent({
      requestKey: 'request-provider-legacy-no-desired-0001',
      role: 'R1',
      requestPurpose: 'LEGACY_BASELINE_RECOVERY',
      expectedBindingRevision: null,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'candidate',
      actor: 'user:fixture',
    });
    assertEqual(legacy.outcome, 'RECORDED');
  });
});

await testAsync('apply is unverified, alias-idempotent and replay-safe after later revisions', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('apply-contract');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);

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

await testAsync('provider pull journal is exact, replay-safe and terminal', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-journal', 2000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const input = {
      requestKey: 'provider-request-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target:latest',
      actor: 'user:fixture',
    };

    const created = repository.recordManualProviderPullIntent(input);
    const replay = repository.recordManualProviderPullIntent(input);
    assertEqual(created.outcome, 'RECORDED');
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(replay.operation.operationId, created.operation.operationId);
    assertEqual(created.operation.requestPurpose, 'USER_APPLY_TARGET');
    assertEqual(created.operation.expectedBindingRevision, 1);
    assertEqual(created.operation.providerOrigin, 'http://127.0.0.1:11434');
    assertEqual(
      repository.getLatestProviderOperation('CHAT').operationId,
      created.operation.operationId,
    );
    assertEqual(repository.listPendingProviderOperations().length, 1);
    assertEqual(
      repository.listPendingProviderOperations()[0].operationId,
      created.operation.operationId,
    );

    const conflict = captureError(() => repository.recordManualProviderPullIntent({
      ...input,
      targetModelName: 'other-target',
    }));
    assertRepositoryError(conflict, 'MODEL_BINDING_PROVIDER_REQUEST_CONFLICT');

    runtime.setNow(2100);
    const terminal = repository.recordManualProviderPullSucceeded({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });
    const terminalReplay = repository.recordManualProviderPullSucceeded({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });
    assertEqual(terminal.outcome, 'RECORDED');
    assertEqual(terminalReplay.outcome, 'REPLAYED');
    assertEqual(repository.listPendingProviderOperations().length, 0);
    assertEqual(repository.listResumableProviderOperations().length, 1);

    const terminalConflict = captureError(() => repository.recordManualProviderPullFailed({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
      failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
    }));
    assertRepositoryError(terminalConflict, 'MODEL_BINDING_PROVIDER_TERMINAL_CONFLICT');
    repository.recordUserBindingApply({
      requestKey: created.operation.requestKey,
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'fixture-target',
      targetDigestSha256: DIGEST_B,
      actor: 'user:fixture',
    });

    const nextRevisionInput = { ...input, expectedBindingRevision: 2 };

    const unknownFailure = repository.recordManualProviderPullIntent({
      ...nextRevisionInput,
      requestKey: 'provider-request-0002',
    });
    const invalidFailure = captureError(() => repository.recordManualProviderPullFailed({
      operationId: unknownFailure.operation.operationId,
      ...providerClaim(unknownFailure.operation),
      failureCode: 'UNKNOWN_PROVIDER_FAILURE',
    }));
    assertRepositoryError(invalidFailure, 'MODEL_BINDING_PROVIDER_FAILURE_CODE_INVALID');
    repository.recordManualProviderPullFailed({
      operationId: unknownFailure.operation.operationId,
      ...providerClaim(unknownFailure.operation),
      failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
    });

    const absent = repository.recordManualProviderPullIntent({
      ...nextRevisionInput,
      requestKey: 'provider-request-0003',
    });
    const reconciledAbsent = repository.recordManualProviderPullReconciledAbsent({
      operationId: absent.operation.operationId,
      ...providerClaim(absent.operation),
    });
    assertEqual(reconciledAbsent.operation.terminal.outcome, 'RECONCILED_ABSENT');
    assertEqual(reconciledAbsent.operation.terminal.retryable, true);
    assertEqual(
      reconciledAbsent.operation.terminal.failureCode,
      'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED',
    );

    for (const [field, value, code] of [
      ['providerOrigin', 'https://example.com', 'MODEL_BINDING_PROVIDER_ORIGIN_INVALID'],
      ['providerOrigin', 'http://localhost:0', 'MODEL_BINDING_PROVIDER_ORIGIN_INVALID'],
      ['providerOrigin', 'http://localhost:00081', 'MODEL_BINDING_PROVIDER_ORIGIN_INVALID'],
      ['requestPurpose', 'UNKNOWN_PURPOSE', 'MODEL_BINDING_PROVIDER_PURPOSE_INVALID'],
      ['expectedBindingRevision', 0, 'MODEL_FAILOVER_INPUT_INVALID'],
    ]) {
      const invalid = captureError(() => repository.recordManualProviderPullIntent({
        ...nextRevisionInput,
        requestKey: `provider-invalid-${field}`,
        [field]: value,
      }));
      assertRepositoryError(invalid, code);
    }
    for (const requestKey of ['x'.repeat(15), 'x'.repeat(129)]) {
      const invalid = captureError(() => repository.recordManualProviderPullIntent({
        ...nextRevisionInput,
        requestKey,
      }));
      assertRepositoryError(invalid, 'MODEL_FAILOVER_INPUT_INVALID');
    }
  });
});

await testAsync('provider effect claim fences WAL contenders and permits only expired takeover', async () => {
  await withRepository(async ({ firstDb, secondDb }) => {
    let nowMs = 10_000;
    const firstRuntime = createRuntime('provider-claim-first', nowMs);
    const secondRuntime = createRuntime('provider-claim-second', nowMs);
    firstRuntime.options.clock = () => nowMs;
    secondRuntime.options.clock = () => nowMs;
    const first = createModelFailoverRepository(firstDb, firstRuntime.options);
    const second = createModelFailoverRepository(secondDb, secondRuntime.options);
    observeChat(first);
    const created = first.recordManualProviderPullIntent({
      requestKey: 'provider-claim-request-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target',
      actor: 'user:first-worker',
    });

    const sameRole = captureError(() => second.recordManualProviderPullIntent({
      requestKey: 'provider-claim-request-0002',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'other-target',
      actor: 'user:second-worker',
    }));
    assertRepositoryError(sameRole, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');

    const sameGlobalTarget = captureError(() => second.recordManualProviderPullIntent({
      requestKey: 'provider-claim-request-0003',
      role: 'R1',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target:latest',
      actor: 'user:second-worker',
    }));
    assertRepositoryError(sameGlobalTarget, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');

    const liveTakeover = captureError(() => second.claimManualProviderPullRecovery({
      operationId: created.operation.operationId,
    }));
    assertRepositoryError(liveTakeover, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');

    nowMs += 60_000;
    const renewed = first.renewManualProviderPullClaim({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
    });
    assertEqual(renewed.claim.fencingRevision, 1);
    assert(renewed.claim.leaseExpiresAtMs > created.operation.claim.leaseExpiresAtMs);

    const directDelete = captureError(() => firstDb.prepare(`
      DELETE FROM model_binding_provider_claims WHERE operation_id = ?
    `).run(created.operation.operationId));
    assert(/MODEL_BINDING_PROVIDER_CLAIM_ACTIVE/.test(directDelete.message));

    const oversizedLease = captureError(() => firstDb.prepare(`
      UPDATE model_binding_provider_claims
      SET lease_expires_at_ms = ?, updated_at_ms = ?
      WHERE operation_id = ?
    `).run(nowMs + 300_001, nowMs, created.operation.operationId));
    assert(
      /CHECK constraint failed|MODEL_BINDING_PROVIDER_CLAIM_INVALID/.test(oversizedLease.message),
      `Expected oversized provider lease rejection, got ${oversizedLease.message}`,
    );

    nowMs += 300_001;
    const expiredTerminal = captureError(() => first.recordManualProviderPullFailed({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
      failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
    }));
    assertRepositoryError(expiredTerminal, 'MODEL_BINDING_PROVIDER_CLAIM_STALE');

    const recovered = second.claimManualProviderPullRecovery({
      operationId: created.operation.operationId,
    });
    assertEqual(recovered.claim.fencingRevision, 2);
    assert(recovered.claim.claimToken !== created.operation.claim.claimToken);

    const staleTerminal = captureError(() => first.recordManualProviderPullSucceeded({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    }));
    assertRepositoryError(staleTerminal, 'MODEL_BINDING_PROVIDER_CLAIM_STALE');

    const terminal = second.recordManualProviderPullFailed({
      operationId: recovered.operationId,
      ...providerClaim(recovered),
      failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
    });
    assertEqual(terminal.operation.terminal.outcome, 'FAILED');
    assertEqual(firstDb.prepare(`SELECT COUNT(*) AS n FROM model_binding_provider_claims`).get().n, 0);

    const staleReplay = captureError(() => first.recordManualProviderPullFailed({
      operationId: created.operation.operationId,
      ...providerClaim(created.operation),
      failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
    }));
    assertRepositoryError(staleReplay, 'MODEL_BINDING_PROVIDER_CLAIM_STALE');

    const resurrectedClaim = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_claims (
        operation_id, role, provider_origin, requested_canonical_name,
        claim_token, fencing_revision, lease_expires_at_ms, updated_at_ms
      ) VALUES (?, 'CHAT', 'http://127.0.0.1:11434', 'fixture-target',
        ?, 1, ?, ?)
    `).run(
      created.operation.operationId,
      created.operation.claim.claimToken,
      created.operation.claim.leaseExpiresAtMs,
      created.operation.claim.updatedAtMs,
    ));
    assert(
      /MODEL_BINDING_PROVIDER_CLAIM_AUTHORITY/.test(resurrectedClaim.message),
      `Expected terminal claim resurrection rejection, got ${resurrectedClaim.message}`,
    );

    const next = first.recordManualProviderPullIntent({
      requestKey: 'provider-claim-request-0004',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target',
      actor: 'user:first-worker',
    });
    assertEqual(next.outcome, 'RECORDED');
  }, { second: true });
});

await testAsync('provider terminal authority is identical to the downstream binding lineage', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-binding-lineage', 20_000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'provider-binding-lineage-request-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target',
      actor: 'user:original-actor',
    });
    runtime.setNow(20_100);
    repository.recordManualProviderPullSucceeded({
      operationId: intent.operation.operationId,
      ...providerClaim(intent.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });

    for (const overrides of [
      { actor: 'user:different-actor' },
      { targetModelName: 'fixture-target:q4' },
      { targetDigestSha256: CONTRACT_DIGEST },
    ]) {
      const lineageDrift = captureError(() => repository.recordUserBindingApply({
        requestKey: intent.operation.requestKey,
        role: 'CHAT',
        expectedBindingRevision: 1,
        targetModelName: 'fixture-target',
        targetDigestSha256: DIGEST_B,
        actor: 'user:original-actor',
        ...overrides,
      }));
      assertRepositoryError(lineageDrift, 'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS');
      assertEqual(repository.getDesired('CHAT').bindingRevision, 1);
    }

    const revisionDrift = captureError(() => repository.recordUserBindingApply({
      requestKey: intent.operation.requestKey,
      role: 'CHAT',
      expectedBindingRevision: 2,
      targetModelName: 'fixture-target',
      targetDigestSha256: DIGEST_B,
      actor: 'user:original-actor',
    }));
    assertRepositoryError(revisionDrift, 'MODEL_FAILOVER_STALE_DESIRED');

    runtime.setNow(20_200);
    const applied = repository.recordUserBindingApply({
      requestKey: intent.operation.requestKey,
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'fixture-target:latest',
      targetDigestSha256: DIGEST_B,
      actor: 'user:original-actor',
    });
    assertEqual(applied.outcome, 'RECORDED');
    assertEqual(applied.operation.actor, intent.operation.actor);
    assertEqual(applied.operation.targetCanonicalName, 'fixture-target');

    runtime.setNow(20_300);
    const legacy = repository.recordManualProviderPullIntent({
      requestKey: 'provider-binding-lineage-legacy-0001',
      role: 'CHAT',
      requestPurpose: 'LEGACY_BASELINE_RECOVERY',
      expectedBindingRevision: null,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target',
      actor: 'user:original-actor',
    });
    runtime.setNow(20_400);
    repository.recordManualProviderPullSucceeded({
      operationId: legacy.operation.operationId,
      ...providerClaim(legacy.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });
    const legacyPurpose = captureError(() => repository.recordUserBindingApply({
      requestKey: legacy.operation.requestKey,
      role: 'CHAT',
      expectedBindingRevision: 2,
      targetModelName: 'fixture-target:latest',
      targetDigestSha256: DIGEST_B,
      actor: 'user:original-actor',
    }));
    assertRepositoryError(legacyPurpose, 'MODEL_FAILOVER_STORAGE_CONTRACT');

  });
});

await testAsync('provider pull journal rejects SQL tamper, identity drift and time rollback', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('provider-guard', 3000);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    let expectedBindingRevision = 1;
    const createIntent = requestKey => repository.recordManualProviderPullIntent({
      requestKey,
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target',
      actor: 'user:fixture',
    }).operation;

    const terminalOperation = createIntent('provider-guard-request-0001');
    for (const injectedSequence of [999, -1]) {
      const beforeTerminalSequenceInjection = authoritySnapshot(firstDb);
      const providerSequenceInjection = captureError(() => firstDb.prepare(`
        INSERT INTO model_binding_provider_attempts (
          seq, operation_id, attempt_revision, outcome, observed_model_name,
          observed_canonical_name, observed_digest_sha256, failure_code,
          retryable, claim_token, fencing_revision, created_at_ms
        ) VALUES (?, ?, 1, 'FAILED', NULL, NULL, NULL,
          'MODEL_BINDING_PROVIDER_PULL_FAILED', 1, ?, 1, 3050)
      `).run(
        injectedSequence,
        terminalOperation.operationId,
        terminalOperation.claim.claimToken,
      ));
      assert(
        /MODEL_BINDING_PROVIDER_ATTEMPT_SEQUENCE_AUTHORITY/.test(
          providerSequenceInjection.message,
        ),
        `Expected provider sequence authority rejection, got ${providerSequenceInjection.message}`,
      );
      assertEqual(authoritySnapshot(firstDb), beforeTerminalSequenceInjection);
    }

    runtime.setNow(3100);
    repository.recordManualProviderPullSucceeded({
      operationId: terminalOperation.operationId,
      ...providerClaim(terminalOperation),
      observedModelName: 'fixture-target:latest',
      observedDigestSha256: DIGEST_B,
    });
    repository.recordUserBindingApply({
      requestKey: terminalOperation.requestKey,
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'fixture-target:latest',
      targetDigestSha256: DIGEST_B,
      actor: 'user:fixture',
    });
    expectedBindingRevision = 2;

    for (const sql of [
      `UPDATE model_binding_provider_operations SET actor = 'user:other'`,
      `DELETE FROM model_binding_provider_operations`,
      `UPDATE model_binding_provider_attempts SET retryable = 1`,
      `DELETE FROM model_binding_provider_attempts`,
    ]) {
      const error = captureError(() => firstDb.exec(sql));
      assert(/append-only/.test(error.message), `Expected append-only rejection for ${sql}`);
    }

    const providerOperationReplacement = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_binding_provider_operations (
        operation_id, request_key, role, effect_kind, request_purpose,
        expected_binding_revision, provider_origin, requested_model_name,
        requested_canonical_name, actor, initial_claim_token,
        initial_claim_expires_at_ms, created_at_ms
      )
      SELECT operation_id, request_key, role, effect_kind, request_purpose,
        expected_binding_revision, provider_origin, requested_model_name,
        requested_canonical_name, 'user:replacement', initial_claim_token,
        initial_claim_expires_at_ms, created_at_ms
      FROM model_binding_provider_operations
      WHERE operation_id = ?
    `).run(terminalOperation.operationId));
    assert(
      /MODEL_BINDING_PROVIDER_OPERATION_IDENTITY_CONFLICT/.test(
        providerOperationReplacement.message,
      ),
      `Expected provider operation identity rejection, got ${providerOperationReplacement.message}`,
    );
    assertEqual(firstDb.prepare(`
      SELECT actor FROM model_binding_provider_operations WHERE operation_id = ?
    `).get(terminalOperation.operationId).actor, 'user:fixture');

    const providerAttemptBusinessSql = firstDb.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_model_binding_provider_attempt_once'
    `).get().sql;
    firstDb.exec('DROP TRIGGER trg_model_binding_provider_attempt_once');
    firstDb.exec(providerAttemptBusinessSql);
    const providerAttemptReplacement = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_binding_provider_attempts (
        operation_id, attempt_revision, outcome, observed_model_name,
        observed_canonical_name, observed_digest_sha256, failure_code,
        retryable, claim_token, fencing_revision, created_at_ms
      )
      SELECT operation_id, attempt_revision, outcome, observed_model_name,
        observed_canonical_name, observed_digest_sha256, failure_code,
        retryable, claim_token, fencing_revision, created_at_ms + 1
      FROM model_binding_provider_attempts
      WHERE operation_id = ? AND attempt_revision = 1
    `).run(terminalOperation.operationId));
    assert(
      /MODEL_BINDING_PROVIDER_ATTEMPT_IDENTITY_CONFLICT/.test(
        providerAttemptReplacement.message,
      ),
      `Expected provider attempt identity rejection, got ${providerAttemptReplacement.message}`,
    );
    assertEqual(firstDb.prepare(`
      SELECT created_at_ms
      FROM model_binding_provider_attempts
      WHERE operation_id = ? AND attempt_revision = 1
    `).get(terminalOperation.operationId).created_at_ms, 3100);

    const externalOrigin = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_operations (
        operation_id, request_key, role, effect_kind, request_purpose,
        expected_binding_revision, provider_origin, requested_model_name,
        requested_canonical_name, actor, initial_claim_token,
        initial_claim_expires_at_ms, created_at_ms
      ) VALUES ('provider-origin-invalid-0001', 'provider-origin-invalid-request-0001',
        'CHAT', 'PULL', 'USER_APPLY_TARGET', 2, 'https://example.com',
        'fixture-target', 'fixture-target', 'user:fixture',
        'provider-invalid-claim-token-0001', 303050, 3050)
    `).run());
    assert(/CHECK constraint failed/.test(externalOrigin.message));

    for (const [operationId, requestKey, providerOrigin, actor] of [
      [
        'provider-short-key-invalid-0001',
        'shortkey',
        'http://127.0.0.1:11434',
        'user:fixture',
      ],
      [
        'provider-actor-invalid-0001',
        'provider-actor-invalid-request-0001',
        'http://127.0.0.1:11434',
        'system:fixture',
      ],
      [
        'provider-origin-canonical-invalid-0001',
        'provider-origin-canonical-request-0001',
        'http://localhost:00081',
        'user:fixture',
      ],
    ]) {
      const invalid = captureError(() => firstDb.prepare(`
        INSERT INTO model_binding_provider_operations (
          operation_id, request_key, role, effect_kind, request_purpose,
          expected_binding_revision, provider_origin, requested_model_name,
          requested_canonical_name, actor, initial_claim_token,
          initial_claim_expires_at_ms, created_at_ms
        ) VALUES (?, ?, 'CHAT', 'PULL', 'USER_APPLY_TARGET', 2, ?,
          'fixture-direct-target', 'fixture-direct-target', ?,
          'provider-direct-claim-token-0001', 303100, 3100)
      `).run(operationId, requestKey, providerOrigin, actor));
      assert(
        /CHECK constraint failed|requires a user actor/.test(invalid.message),
        `Expected direct provider authority rejection, got ${invalid.message}`,
      );
    }

    const duplicateTerminal = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_attempts (
        operation_id, attempt_revision, outcome, observed_model_name,
        observed_canonical_name, observed_digest_sha256, failure_code,
        retryable, claim_token, fencing_revision, created_at_ms
      ) VALUES (?, 1, 'FAILED', NULL, NULL, NULL,
        'MODEL_BINDING_PROVIDER_PULL_FAILED', 1, ?, 1, 3200)
    `).run(terminalOperation.operationId, terminalOperation.claim.claimToken));
    assert(
      /MODEL_BINDING_PROVIDER_ATTEMPT_IDENTITY_CONFLICT/.test(duplicateTerminal.message),
      `Expected provider attempt identity rejection, got ${duplicateTerminal.message}`,
    );
    runtime.setNow(4000);
    const identityOperation = createIntent('provider-guard-request-0002');
    const identityDrift = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_attempts (
        operation_id, attempt_revision, outcome, observed_model_name,
        observed_canonical_name, observed_digest_sha256, failure_code,
        retryable, claim_token, fencing_revision, created_at_ms
      ) VALUES (?, 1, 'SUCCEEDED', 'other-target', 'other-target', ?, NULL, 0, ?, 1, 4100)
    `).run(identityOperation.operationId, DIGEST_B, identityOperation.claim.claimToken));
    assert(
      /MODEL_BINDING_PROVIDER_IDENTITY_MISMATCH/.test(identityDrift.message),
      `Expected identity mismatch, got ${identityDrift.message}`,
    );
    runtime.setNow(4200);
    repository.recordManualProviderPullFailed({
      operationId: identityOperation.operationId,
      ...providerClaim(identityOperation),
      failureCode: 'MODEL_BINDING_PROVIDER_PULL_FAILED',
    });

    runtime.setNow(5000);
    const timeOperation = createIntent('provider-guard-request-0003');
    const arbitraryAbsent = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_attempts (
        operation_id, attempt_revision, outcome, observed_model_name,
        observed_canonical_name, observed_digest_sha256, failure_code,
        retryable, claim_token, fencing_revision, created_at_ms
      ) VALUES (?, 1, 'RECONCILED_ABSENT', NULL, NULL, NULL,
        'ARBITRARY_CODE', 0, ?, 1, 5100)
    `).run(timeOperation.operationId, timeOperation.claim.claimToken));
    assert(
      /CHECK constraint failed/.test(arbitraryAbsent.message),
      `Expected absent-outcome shape rejection, got ${arbitraryAbsent.message}`,
    );
    const timeRollback = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_provider_attempts (
        operation_id, attempt_revision, outcome, observed_model_name,
        observed_canonical_name, observed_digest_sha256, failure_code,
        retryable, claim_token, fencing_revision, created_at_ms
      ) VALUES (?, 1, 'FAILED', NULL, NULL, NULL,
        'MODEL_BINDING_PROVIDER_PULL_FAILED', 1, ?, 1, 4999)
    `).run(timeOperation.operationId, timeOperation.claim.claimToken));
    assert(
      /MODEL_BINDING_PROVIDER_TIME_ROLLBACK/.test(timeRollback.message),
      `Expected provider time rollback rejection, got ${timeRollback.message}`,
    );
  });
});

suite('M1 manual binding repository — application state and truth');

await testAsync('runtime, verification and notification attempts derive one truthful state', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-state');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;

    assertEqual(repository.getBindingApplicationState(operationId).state, 'PENDING');
    assertEqual(repository.getBindingApplicationState(operationId).attemptRevision, 0);

    runtime.setNow(2100);
    const runtimeResult = repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate:latest',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    assertEqual(runtimeResult.outcome, 'RECORDED');
    assertEqual(runtimeResult.applicationState.state, 'RUNTIME_RECONCILIATION_REQUIRED');
    assertEqual(runtimeResult.applicationState.runtimeStatus, 'APPLIED');
    assertEqual(runtimeResult.applicationState.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(runtimeResult.applicationState.verificationStatus, 'NOT_VERIFIED');
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);

    runtime.setNow(2150);
    const finalized = finalizeRuntime(repository, operationId, 1);
    assertEqual(finalized.outcome, 'RECORDED');
    assertEqual(finalized.receipt.kind, 'DIRECT_CONFIRMED');
    assertEqual(finalized.receipt.configVersion, 1);
    assertEqual(finalized.applicationState.state, 'APPLIED_PENDING_VERIFICATION');
    assertEqual(finalized.applicationState.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'MANUAL');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);
    const finalizeReplay = finalizeRuntime(repository, operationId, 1);
    assertEqual(finalizeReplay.outcome, 'REPLAYED');

    const pendingOverride = firstDb.prepare(`
      SELECT * FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(pendingOverride.model, 'candidate');
    assertEqual(pendingOverride.previous_model, 'reasoner');
    assertEqual(pendingOverride.binding_operation_id, operationId);
    assertEqual(pendingOverride.model_canonical_name, 'candidate');
    assertEqual(pendingOverride.model_digest_sha256, DIGEST_B);
    assertEqual(pendingOverride.verified, 0);
    assertEqual(pendingOverride.verification_status, 'PENDING');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);

    const forgedVerification = captureError(() => firstDb.prepare(`
      UPDATE model_overrides
      SET verified = 1, verification_status = 'VERIFIED'
      WHERE role = 'CHAT'
    `).run());
    assert(/verified override requires exact successful probe/i.test(forgedVerification.message));

    runtime.setNow(2200);
    const verified = repository.recordManualVerificationSucceeded({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });
    assertEqual(verified.applicationState.state, 'VERIFIED');
    assertEqual(verified.applicationState.verificationStatus, 'VERIFIED');
    assertEqual(verified.attempt.verificationMethod, 'OLLAMA_CHAT_EXACT_DIGEST_V1');
    const verifiedOverride = firstDb.prepare(`
      SELECT verified, verification_status FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(verifiedOverride.verified, 1);
    assertEqual(verifiedOverride.verification_status, 'VERIFIED');

    const immutableIntent = repository.getBindingOperation(operationId);
    assertEqual(immutableIntent.verificationStatus, 'NOT_VERIFIED');
    assertEqual(immutableIntent.runtimeStatus, 'NOT_APPLIED');
    assertEqual(immutableIntent.applicationState.state, 'VERIFIED');

    const deleteAttempt = captureError(() => firstDb.prepare(`
      DELETE FROM model_binding_application_attempts
      WHERE operation_id = ? AND attempt_revision = 2
    `).run(operationId));
    assert(/append-only/i.test(deleteAttempt.message));
    const updateAttempt = captureError(() => firstDb.prepare(`
      UPDATE model_binding_application_attempts
      SET failure_code = 'FORGED'
      WHERE operation_id = ? AND attempt_revision = 2
    `).run(operationId));
    assert(/append-only/i.test(updateAttempt.message));

    runtime.setNow(2250);
    const secondVerification = captureError(() => repository.recordManualVerificationSucceeded({
      operationId,
      expectedAttemptRevision: 2,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    }));
    assertRepositoryError(secondVerification, 'MODEL_FAILOVER_STORAGE_CONTRACT');

    runtime.setNow(2300);
    const notification = repository.recordManualNotificationFailed({
      operationId,
      expectedAttemptRevision: 2,
      failureCode: 'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED',
    });
    assertEqual(notification.applicationState.state, 'VERIFIED');
    assertEqual(notification.applicationState.notificationStatus, 'FAILED');
    assertEqual(
      notification.applicationState.notificationFailureCode,
      'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED',
    );
    const replay = repository.recordManualNotificationFailed({
      operationId,
      expectedAttemptRevision: 2,
      failureCode: 'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED',
    });
    assertEqual(replay.outcome, 'REPLAYED');
    const delayedRuntimeReplay = repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate:latest',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    assertEqual(delayedRuntimeReplay.outcome, 'REPLAYED');

    runtime.setNow(2400);
    const rehydrated = repository.recordManualStartupRehydrated({
      operationId,
      expectedAttemptRevision: 3,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    });
    assertEqual(rehydrated.applicationState.state, 'RUNTIME_RECONCILIATION_REQUIRED');
    runtime.setNow(2450);
    const rehydrateFinalized = finalizeRuntime(repository, operationId, 4, 1);
    assertEqual(rehydrateFinalized.recoveredReceipts.length, 0);
    assertEqual(rehydrateFinalized.applicationState.notificationStatus, 'FAILED');
    const duplicateNotification = captureError(() => repository.recordManualNotificationFailed({
      operationId,
      expectedAttemptRevision: 4,
      failureCode: 'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED',
    }));
    assertRepositoryError(duplicateNotification, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(firstDb.prepare(`
      SELECT COUNT(*) AS count FROM model_binding_application_attempts
      WHERE operation_id = ?
    `).get(operationId).count, 4);
  });
});

await testAsync('runtime finalize receipts are append-only, exact and recovery-linked', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('runtime-finalize-receipt');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;

    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    const unknown = repository.getBindingApplicationState(operationId);
    assertEqual(unknown.state, 'RUNTIME_RECONCILIATION_REQUIRED');
    assertEqual(unknown.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(unknown.runtimeFinalizeReceipts.length, 0);

    const prematureVerification = captureError(() => (
      repository.recordManualVerificationSucceeded({
        operationId,
        expectedAttemptRevision: 1,
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
      })
    ));
    assertRepositoryError(prematureVerification, 'MODEL_FAILOVER_STORAGE_CONTRACT');

    for (const injectedSequence of [999, -1]) {
      const sequenceError = captureError(() => firstDb.prepare(`
        INSERT INTO model_binding_runtime_finalize_receipts (
          seq, operation_id, runtime_attempt_revision, finalization_kind,
          config_version, recovered_by_attempt_revision, created_at_ms
        ) VALUES (?, ?, 1, 'DIRECT_CONFIRMED', 1, NULL, 2150)
      `).run(injectedSequence, operationId));
      assert(
        /MODEL_BINDING_RUNTIME_FINALIZE_SEQUENCE_AUTHORITY/.test(sequenceError.message),
        `Expected finalize sequence authority rejection, got ${sequenceError.message}`,
      );
      assertEqual(
        firstDb.prepare(`
          SELECT COUNT(*) AS count
          FROM model_binding_runtime_finalize_receipts
          WHERE operation_id = ?
        `).get(operationId).count,
        0,
      );
    }

    runtime.setNow(2200);
    repository.recordManualStartupRehydrated({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate:latest',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    });
    const unconfirmedRecovery = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_runtime_finalize_receipts (
        operation_id, runtime_attempt_revision, finalization_kind,
        config_version, recovered_by_attempt_revision, created_at_ms
      ) VALUES (?, 1, 'RECOVERED_BY', NULL, 2, 2250)
    `).run(operationId));
    assert(
      /MODEL_BINDING_RUNTIME_FINALIZE_RECOVERY_INVALID/.test(unconfirmedRecovery.message),
      `Expected recovery lineage rejection, got ${unconfirmedRecovery.message}`,
    );

    runtime.setNow(2300);
    const finalized = finalizeRuntime(repository, operationId, 2, 0);
    assertEqual(finalized.receipt.kind, 'DIRECT_CONFIRMED');
    assertEqual(finalized.recoveredReceipts.length, 1);
    assertEqual(finalized.recoveredReceipts[0].runtimeAttemptRevision, 1);
    assertEqual(finalized.recoveredReceipts[0].kind, 'RECOVERED_BY');
    assertEqual(finalized.recoveredReceipts[0].recoveredByAttemptRevision, 2);
    assertEqual(finalized.applicationState.state, 'APPLIED_PENDING_VERIFICATION');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);

    const conflictingReplay = captureError(() => finalizeRuntime(
      repository,
      operationId,
      2,
      1,
    ));
    assertRepositoryError(
      conflictingReplay,
      'MODEL_BINDING_RUNTIME_FINALIZE_CONFLICT',
    );

    const beforeTamper = authoritySnapshot(firstDb);
    const update = captureError(() => firstDb.prepare(`
      UPDATE model_binding_runtime_finalize_receipts
      SET config_version = 9
      WHERE operation_id = ? AND runtime_attempt_revision = 2
    `).run(operationId));
    assert(/append-only/i.test(update.message));
    const remove = captureError(() => firstDb.prepare(`
      DELETE FROM model_binding_runtime_finalize_receipts
      WHERE operation_id = ? AND runtime_attempt_revision = 2
    `).run(operationId));
    assert(/append-only/i.test(remove.message));
    const replacement = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_binding_runtime_finalize_receipts (
        operation_id, runtime_attempt_revision, finalization_kind,
        config_version, recovered_by_attempt_revision, created_at_ms
      ) VALUES (?, 2, 'DIRECT_CONFIRMED', 0, NULL, 2350)
    `).run(operationId));
    assert(
      /MODEL_BINDING_RUNTIME_FINALIZE_IDENTITY_CONFLICT/.test(replacement.message),
      `Expected finalize identity rejection, got ${replacement.message}`,
    );
    assertEqual(authoritySnapshot(firstDb), beforeTamper);
  });
});

await testAsync('failed exact recovery cannot erase an older unresolved runtime generation', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('runtime-finalize-failed-recovery');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;

    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2200);
    const failedRecovery = repository.recordManualStartupRehydrateFailed({
      operationId,
      expectedAttemptRevision: 1,
      failureCode: 'MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE',
    });
    assertEqual(failedRecovery.applicationState.state, 'RUNTIME_RECONCILIATION_REQUIRED');
    assertEqual(failedRecovery.applicationState.runtimeStatus, 'APPLIED');
    assertEqual(failedRecovery.applicationState.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(failedRecovery.applicationState.lastRuntimeAttempt.attemptRevision, 2);
    assertEqual(failedRecovery.applicationState.lastRuntimeAttempt.outcome, 'FAILED');
    assertEqual(
      failedRecovery.applicationState.lastUnresolvedRuntimeAttempt.attemptRevision,
      1,
    );
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');
    assertEqual(firstDb.prepare(`
      SELECT COUNT(*) AS count FROM model_binding_runtime_finalize_receipts
      WHERE operation_id = ?
    `).get(operationId).count, 0);

    runtime.setNow(2300);
    repository.recordManualStartupRehydrated({
      operationId,
      expectedAttemptRevision: 2,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    });
    runtime.setNow(2350);
    const finalized = finalizeRuntime(repository, operationId, 3, 1);
    assertEqual(finalized.applicationState.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
    assertEqual(finalized.recoveredReceipts.length, 1);
    assertEqual(finalized.recoveredReceipts[0].runtimeAttemptRevision, 1);
    assertEqual(finalized.recoveredReceipts[0].recoveredByAttemptRevision, 3);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);
  });
});

await testAsync('first startup finalize after a pre-attempt crash records user history once', async () => {
  await withRepository(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('runtime-finalize-pre-attempt-crash');
    let repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;
    assertEqual(firstDb.prepare(`
      SELECT COUNT(*) AS count FROM model_binding_application_attempts
      WHERE operation_id = ?
    `).get(operationId).count, 0);
    firstDb.close();

    const restartedDb = openDb(databasePath);
    try {
      repository = createModelFailoverRepository(restartedDb, runtime.options);
      runtime.setNow(2100);
      repository.recordManualStartupRehydrated({
        operationId,
        expectedAttemptRevision: 0,
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
        runtimeChanged: true,
      });
      runtime.setNow(2150);
      const finalized = finalizeRuntime(repository, operationId, 1, 0);
      assertEqual(finalized.applicationState.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
      const history = restartedDb.prepare(`
        SELECT role, from_model, to_model, action
        FROM upgrade_history
      `).all();
      assertEqual(JSON.stringify(history), JSON.stringify([{
        role: 'CHAT',
        from_model: 'reasoner',
        to_model: 'candidate',
        action: 'apply',
      }]));
      const replay = finalizeRuntime(repository, operationId, 1, 0);
      assertEqual(replay.outcome, 'REPLAYED');
      assertEqual(restartedDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);
    } finally {
      restartedDb.close();
    }
  });
});

await testAsync('retry and restart rehydrate invalidate only the prior runtime verification', async () => {
  await withRepository(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('application-retry');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;

    runtime.setNow(2100);
    const failedRuntime = repository.recordManualRuntimeApplyFailed({
      operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_PROVIDER_UNAVAILABLE',
    });
    assertEqual(failedRuntime.applicationState.state, 'FAILED');
    assertEqual(failedRuntime.applicationState.runtimeStatus, 'FAILED');
    assertEqual(failedRuntime.applicationState.retryable, true);
    const failureReplay = repository.recordManualRuntimeApplyFailed({
      operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_PROVIDER_UNAVAILABLE',
    });
    assertEqual(failureReplay.outcome, 'REPLAYED');

    runtime.setNow(2200);
    repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2250);
    finalizeRuntime(repository, operationId, 2);
    runtime.setNow(2300);
    const failedVerification = repository.recordManualVerificationFailed({
      operationId,
      expectedAttemptRevision: 2,
      failureCode: 'MODEL_BINDING_VERIFICATION_PROVIDER_UNAVAILABLE',
    });
    assertEqual(failedVerification.applicationState.state, 'FAILED');
    assertEqual(failedVerification.applicationState.runtimeStatus, 'APPLIED');
    assertEqual(failedVerification.applicationState.verificationStatus, 'FAILED');
    assertEqual(failedVerification.applicationState.retryable, true);

    runtime.setNow(2400);
    const recoveredVerification = repository.recordManualVerificationSucceeded({
      operationId,
      expectedAttemptRevision: 3,
      observedModelName: 'candidate:latest',
      observedDigestSha256: DIGEST_B,
    });
    assertEqual(recoveredVerification.applicationState.state, 'VERIFIED');

    runtime.setNow(2450);
    const repeatedRuntime = captureError(() => repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 4,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    }));
    assertRepositoryError(repeatedRuntime, 'MODEL_BINDING_APPLICATION_TRANSITION_INVALID');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);
    const directRepeatedRuntime = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms
      ) VALUES (?, 5, 'RUNTIME_APPLY', 'SUCCEEDED', 'candidate', 'candidate', ?,
        NULL, NULL, 0, 2450)
    `).run(operationId, DIGEST_B));
    assert(/runtime apply is terminal after success/i.test(directRepeatedRuntime.message));

    runtime.setNow(2500);
    const rehydrated = repository.recordManualStartupRehydrated({
      operationId,
      expectedAttemptRevision: 4,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    });
    assertEqual(rehydrated.applicationState.state, 'RUNTIME_RECONCILIATION_REQUIRED');
    runtime.setNow(2550);
    const rehydrateFinalized = finalizeRuntime(repository, operationId, 5, 1);
    assertEqual(rehydrateFinalized.applicationState.state, 'APPLIED_PENDING_VERIFICATION');
    assertEqual(firstDb.prepare(`
      SELECT verified FROM model_overrides WHERE role = 'CHAT'
    `).get().verified, 0);
    const staleVerificationReuse = captureError(() => firstDb.prepare(`
      UPDATE model_overrides
      SET verified = 1, verification_status = 'VERIFIED'
      WHERE role = 'CHAT'
    `).run());
    assert(/verified override requires exact successful probe/i.test(staleVerificationReuse.message));

    runtime.setNow(2600);
    const reverified = repository.recordManualVerificationSucceeded({
      operationId,
      expectedAttemptRevision: 5,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });
    assertEqual(reverified.applicationState.state, 'VERIFIED');
    const expectedState = JSON.stringify(reverified.applicationState);
    firstDb.close();

    const restartedDb = openDb(databasePath);
    try {
      const restarted = createModelFailoverRepository(
        restartedDb,
        createRuntime('application-restart', 3000).options,
      );
      assertEqual(
        JSON.stringify(restarted.getBindingApplicationState(operationId)),
        expectedState,
      );
      assertEqual(restarted.getEffectiveBinding('CHAT').source, 'MANUAL');
      assertEqual(restarted.listCurrentManualBindingsForRehydrate().length, 1);
    } finally {
      restartedDb.close();
    }
  });
});

await testAsync('startup rehydrate closes runtime apply for the same operation generation', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-rehydrate-generation');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;

    runtime.setNow(2100);
    repository.recordManualStartupRehydrated({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2150);
    finalizeRuntime(repository, operationId, 1, 0);
    runtime.setNow(2200);
    const repeatedSuccess = captureError(() => repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    }));
    assertRepositoryError(repeatedSuccess, 'MODEL_BINDING_APPLICATION_TRANSITION_INVALID');
    const repeatedFailure = captureError(() => repository.recordManualRuntimeApplyFailed({
      operationId,
      expectedAttemptRevision: 1,
      failureCode: 'MODEL_BINDING_RUNTIME_COMMIT_FAILED',
    }));
    assertRepositoryError(repeatedFailure, 'MODEL_BINDING_APPLICATION_TRANSITION_INVALID');
    const directRepeat = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        failure_code, retryable, created_at_ms, runtime_changed
      ) VALUES (?, 2, 'RUNTIME_APPLY', 'FAILED',
        'MODEL_BINDING_RUNTIME_COMMIT_FAILED', 1, 2200, 0)
    `).run(operationId));
    assert(/runtime apply cannot follow startup rehydrate/i.test(directRepeat.message));
    assertEqual(JSON.stringify(firstDb.prepare(`
      SELECT role, from_model, to_model, action
      FROM upgrade_history
    `).all()), JSON.stringify([{
      role: 'CHAT',
      from_model: 'reasoner',
      to_model: 'candidate',
      action: 'apply',
    }]));
  });
});

await testAsync('non-retryable runtime failure requires a new user operation', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-nonretryable-generation');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;
    runtime.setNow(2100);
    repository.recordManualRuntimeApplyFailed({
      operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_TARGET_DIGEST_DRIFT',
    });
    runtime.setNow(2200);
    const retry = captureError(() => repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    }));
    assertRepositoryError(retry, 'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL');
    const repeatedFailure = captureError(() => repository.recordManualRuntimeApplyFailed({
      operationId,
      expectedAttemptRevision: 1,
      failureCode: 'MODEL_BINDING_PROVIDER_UNAVAILABLE',
    }));
    assertRepositoryError(
      repeatedFailure,
      'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
    );
    const directRetry = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms,
        runtime_changed
      ) VALUES (?, 2, 'RUNTIME_APPLY', 'SUCCEEDED',
        'candidate', 'candidate', ?, NULL, NULL, 0, 2200, 1)
    `).run(operationId, DIGEST_B));
    assert(/MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL/.test(directRetry.message));
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
  });
});

await testAsync('runtime_changed is owned only by successful runtime effects', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-runtime-changed-shape');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;

    const invalidFailure = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        failure_code, retryable, created_at_ms, runtime_changed
      ) VALUES (?, 1, 'RUNTIME_APPLY', 'FAILED',
        'MODEL_BINDING_PROVIDER_UNAVAILABLE', 1, 2100, 1)
    `).run(operationId));
    assert(/MODEL_BINDING_APPLICATION_RUNTIME_CHANGED_INVALID/.test(invalidFailure.message));

    runtime.setNow(2100);
    const noOp = repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    });
    assertEqual(noOp.attempt.runtimeChanged, false);
    runtime.setNow(2150);
    finalizeRuntime(repository, operationId, 1, 0);

    const invalidVerification = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms,
        runtime_changed
      ) VALUES (?, 2, 'VERIFICATION', 'SUCCEEDED',
        'candidate', 'candidate', ?, 'OLLAMA_CHAT_EXACT_DIGEST_V1',
        NULL, 0, 2200, 1)
    `).run(operationId, DIGEST_B));
    assert(/MODEL_BINDING_APPLICATION_RUNTIME_CHANGED_INVALID/.test(
      invalidVerification.message,
    ));

    const invalidNotification = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        failure_code, retryable, created_at_ms, runtime_changed
      ) VALUES (?, 2, 'NOTIFICATION', 'FAILED',
        'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED', 0, 2200, 1)
    `).run(operationId));
    assert(/MODEL_BINDING_APPLICATION_RUNTIME_CHANGED_INVALID/.test(
      invalidNotification.message,
    ));
  });
});

await testAsync('runtime no-op completes rollback without inventing history', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-noop-rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(2100);
    const rolledBack = rollbackChat(repository, applied.operation.operationId);
    runtime.setNow(2200);
    const reconciled = repository.recordManualRuntimeApplied({
      operationId: rolledBack.operation.operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'reasoner',
      observedDigestSha256: DIGEST_A,
      runtimeChanged: false,
    });
    assertEqual(reconciled.applicationState.runtimeStatus, 'APPLIED');
    assertEqual(reconciled.applicationState.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(reconciled.attempt.runtimeChanged, false);
    runtime.setNow(2250);
    const finalized = finalizeRuntime(
      repository,
      rolledBack.operation.operationId,
      1,
      0,
    );
    assertEqual(finalized.applicationState.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
    const override = firstDb.prepare(`
      SELECT model, binding_operation_id FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(override.model, 'reasoner');
    assertEqual(override.binding_operation_id, rolledBack.operation.operationId);
  });
});

await testAsync('failed startup rehydrate preserves legacy and prior manual runtime truth', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-rehydrate-preserve');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    firstDb.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, applied_by, verified, verification_status
      ) VALUES ('CHAT', 'reasoner', 'older', 'user', 0, 'LEGACY_UNVERIFIED')
    `).run();
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(2100);
    const legacyFailure = repository.recordManualStartupRehydrateFailed({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE',
    });
    assertEqual(legacyFailure.applicationState.state, 'FAILED');
    const legacy = firstDb.prepare(`
      SELECT model, binding_operation_id, verification_status
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(legacy.model, 'reasoner');
    assertEqual(legacy.binding_operation_id, null);
    assertEqual(legacy.verification_status, 'LEGACY_UNVERIFIED');
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-rehydrate-prior-manual');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const first = applyChat(repository);
    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId: first.operation.operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2150);
    finalizeRuntime(repository, first.operation.operationId, 1);
    runtime.setNow(2200);
    const second = repository.recordUserBindingApply({
      requestKey: 'request-third-model-0001',
      role: 'CHAT',
      expectedBindingRevision: first.operation.committedBindingRevision,
      targetModelName: 'third-model',
      targetDigestSha256: CONTRACT_DIGEST,
      actor: 'user:fixture',
    });
    runtime.setNow(2300);
    const priorFailure = repository.recordManualStartupRehydrateFailed({
      operationId: second.operation.operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_REHYDRATE_DIGEST_DRIFT',
    });
    assertEqual(priorFailure.applicationState.state, 'FAILED');
    const prior = firstDb.prepare(`
      SELECT model, binding_operation_id, verification_status
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(prior.model, 'candidate');
    assertEqual(prior.binding_operation_id, first.operation.operationId);
    assertEqual(prior.verification_status, 'PENDING');
  });
});

await testAsync('failed startup rehydrate demotes persisted truth until a later success', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-rehydrate-failure');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;
    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2150);
    finalizeRuntime(repository, operationId, 1);
    runtime.setNow(2200);
    repository.recordManualVerificationSucceeded({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });
    runtime.setNow(2300);
    const failed = repository.recordManualStartupRehydrateFailed({
      operationId,
      expectedAttemptRevision: 2,
      failureCode: 'MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE',
    });
    assertEqual(failed.applicationState.state, 'FAILED');
    assertEqual(failed.applicationState.runtimeStatus, 'FAILED');
    assertEqual(failed.applicationState.verificationStatus, 'NOT_VERIFIED');
    const override = firstDb.prepare(`
      SELECT verified, verification_status FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(override.verified, 0);
    assertEqual(override.verification_status, 'FAILED');
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');
  });
});

await testAsync('rollback has its own append-only runtime and verification lineage', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2150);
    finalizeRuntime(repository, applied.operation.operationId, 1);
    runtime.setNow(2200);
    repository.recordManualVerificationSucceeded({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    });

    runtime.setNow(3000);
    const rolledBack = rollbackChat(repository, applied.operation.operationId);
    runtime.setNow(3100);
    repository.recordManualRuntimeApplied({
      operationId: rolledBack.operation.operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'reasoner:latest',
      observedDigestSha256: DIGEST_A,
      runtimeChanged: true,
    });
    runtime.setNow(3150);
    finalizeRuntime(repository, rolledBack.operation.operationId, 1, 2);
    runtime.setNow(3200);
    repository.recordManualVerificationSucceeded({
      operationId: rolledBack.operation.operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'reasoner',
      observedDigestSha256: DIGEST_A,
    });

    assertEqual(repository.getBindingApplicationState(applied.operation.operationId).state, 'VERIFIED');
    assertEqual(repository.getBindingApplicationState(rolledBack.operation.operationId).state, 'VERIFIED');
    assertEqual(repository.getEffectiveBinding('CHAT').modelName, 'reasoner');
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 2);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM model_binding_application_attempts').get().count, 4);
    assertEqual(firstDb.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 2);
  });
});

await testAsync('application APIs reject authority injection, stale revisions and invalid ordering', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-negative');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;
    const before = authoritySnapshot(firstDb);

    for (const field of ['nowMs', 'retryable', 'verificationMethod', 'observedCanonicalName']) {
      const error = captureError(() => repository.recordManualRuntimeApplied({
        operationId,
        expectedAttemptRevision: 0,
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
        runtimeChanged: true,
        [field]: 'caller-owned',
      }));
      assertRepositoryError(error, 'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED');
      assertEqual(JSON.stringify(error.details?.fields), JSON.stringify([field]));
      assertEqual(authoritySnapshot(firstDb), before);
    }

    const prematureVerification = captureError(() => repository.recordManualVerificationSucceeded({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    }));
    assertRepositoryError(prematureVerification, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(authoritySnapshot(firstDb), before);

    const digestDrift = captureError(() => repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_A,
      runtimeChanged: true,
    }));
    assertRepositoryError(digestDrift, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(authoritySnapshot(firstDb), before);

    const forgedCanonical = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms
      ) VALUES (?, 1, 'RUNTIME_APPLY', 'SUCCEEDED', 'unrelated:latest',
        'candidate', ?, NULL, NULL, 0, 2050)
    `).run(operationId, DIGEST_B));
    assert(/check constraint/i.test(forgedCanonical.message));
    assertEqual(authoritySnapshot(firstDb), before);

    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2125);
    finalizeRuntime(repository, operationId, 1);
    const afterRuntime = authoritySnapshot(firstDb);
    const applicationRevisionBusinessSql = firstDb.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_model_binding_application_revision'
    `).get().sql;
    firstDb.exec('DROP TRIGGER trg_model_binding_application_revision');
    firstDb.exec(applicationRevisionBusinessSql);
    const applicationReplacement = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms
      )
      SELECT operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms + 1
      FROM model_binding_application_attempts
      WHERE operation_id = ? AND attempt_revision = 1
    `).run(operationId));
    assert(
      /MODEL_BINDING_APPLICATION_IDENTITY_CONFLICT/.test(applicationReplacement.message),
      `Expected application identity rejection, got ${applicationReplacement.message}`,
    );
    assertEqual(authoritySnapshot(firstDb), afterRuntime);

    for (const injectedSequence of [999, -1]) {
      const applicationSequenceInjection = captureError(() => firstDb.prepare(`
        INSERT INTO model_binding_application_attempts (
          seq, operation_id, attempt_revision, attempt_kind, outcome,
          observed_model_name, observed_canonical_name, observed_digest_sha256,
          verification_method, failure_code, retryable, created_at_ms
        ) VALUES (?, ?, 2, 'NOTIFICATION', 'FAILED', NULL, NULL, NULL,
          NULL, 'MODEL_BINDING_NOTIFICATION_RECEIPT_NOT_ISSUED', 0, 2150)
      `).run(injectedSequence, operationId));
      assert(
        /MODEL_BINDING_APPLICATION_SEQUENCE_AUTHORITY/.test(
          applicationSequenceInjection.message,
        ),
        `Expected application sequence authority rejection, got ${applicationSequenceInjection.message}`,
      );
      assertEqual(authoritySnapshot(firstDb), afterRuntime);
    }

    const fakeProbe = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms
      ) VALUES (?, 2, 'VERIFICATION', 'SUCCEEDED', 'candidate', 'candidate', ?,
        'FAKE_PROBE', NULL, 0, 2150)
    `).run(operationId, DIGEST_B));
    assert(/check constraint/i.test(fakeProbe.message));
    assertEqual(authoritySnapshot(firstDb), afterRuntime);

    const legacyOverwrite = captureError(() => firstDb.prepare(`
      INSERT OR REPLACE INTO model_overrides (
        role, model, previous_model, score, applied_by, applied_at
      ) VALUES ('CHAT', 'legacy-replacement', 'candidate', NULL, 'user', CURRENT_TIMESTAMP)
    `).run());
    assert(/legacy writer cannot replace manual lineage/i.test(legacyOverwrite.message));
    const manualDelete = captureError(() => firstDb.prepare(`
      DELETE FROM model_overrides WHERE role = 'CHAT'
    `).run());
    assert(/manual override is append-only/i.test(manualDelete.message));
    assertEqual(authoritySnapshot(firstDb), afterRuntime);
    const stale = captureError(() => repository.recordManualRuntimeApplyFailed({
      operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_PROVIDER_UNAVAILABLE',
    }));
    assertRepositoryError(stale, 'MODEL_BINDING_APPLICATION_STALE_ATTEMPT');
    assertEqual(authoritySnapshot(firstDb), afterRuntime);

    const overrideIdentityUpdate = captureError(() => firstDb.prepare(`
      UPDATE model_overrides SET model = 'forged-model' WHERE role = 'CHAT'
    `).run());
    assert(/override requires exact operation target/i.test(overrideIdentityUpdate.message));
    const overrideIdentityInsert = captureError(() => firstDb.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, applied_by, verified,
        binding_operation_id, model_canonical_name, model_digest_sha256,
        verification_status
      ) VALUES ('D1', 'candidate', 'previous', 'user:fixture', 0, ?,
        'candidate', ?, 'PENDING')
    `).run(operationId, DIGEST_B));
    assert(/override requires exact operation target/i.test(overrideIdentityInsert.message));
    assertEqual(authoritySnapshot(firstDb), afterRuntime);
  });
});

await testAsync('all application recorders reject caller authority fields', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-recorder-authority');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    const operationId = applied.operation.operationId;
    const cases = [
      ['recordManualRuntimeApplyFailed', {
        operationId,
        expectedAttemptRevision: 0,
        failureCode: 'MODEL_BINDING_PROVIDER_UNAVAILABLE',
      }],
      ['recordManualRuntimeFinalized', {
        operationId,
        expectedAttemptRevision: 1,
        configVersion: 1,
      }],
      ['recordManualStartupRehydrated', {
        operationId,
        expectedAttemptRevision: 0,
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
        runtimeChanged: true,
      }],
      ['recordManualStartupRehydrateFailed', {
        operationId,
        expectedAttemptRevision: 0,
        failureCode: 'MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE',
      }],
      ['recordManualVerificationSucceeded', {
        operationId,
        expectedAttemptRevision: 0,
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
      }],
      ['recordManualVerificationFailed', {
        operationId,
        expectedAttemptRevision: 0,
        failureCode: 'MODEL_BINDING_VERIFICATION_REJECTED',
      }],
      ['recordManualNotificationSucceeded', { operationId, expectedAttemptRevision: 0 }],
      ['recordManualNotificationFailed', {
        operationId,
        expectedAttemptRevision: 0,
        failureCode: 'MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED',
      }],
    ];
    const before = authoritySnapshot(firstDb);
    for (const [method, input] of cases) {
      const error = captureError(() => repository[method]({
        ...input,
        actor: 'caller-owned',
      }));
      assertRepositoryError(error, 'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED');
      assertEqual(JSON.stringify(error.details?.fields), JSON.stringify(['actor']));
      assertEqual(authoritySnapshot(firstDb), before);
    }
  });
});

await testAsync('schema rejects superseded authority, clock rollback and non-retryable drift', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-schema-boundaries');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const first = applyChat(repository);
    runtime.setNow(3000);
    applyChat(repository, {
      requestKey: 'request-application-newer-0001',
      expectedBindingRevision: 2,
      targetModelName: 'newer',
      targetDigestSha256: DIGEST_A,
    });
    const before = authoritySnapshot(firstDb);
    const superseded = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms
      ) VALUES (?, 1, 'RUNTIME_APPLY', 'SUCCEEDED', 'candidate', 'candidate', ?,
        NULL, NULL, 0, 3100)
    `).run(first.operation.operationId, DIGEST_B));
    assert(/operation is not current desired authority/i.test(superseded.message));
    assertEqual(authoritySnapshot(firstDb), before);

    const current = repository.listCurrentManualBindingsForRehydrate()[0];
    const clockRollback = captureError(() => firstDb.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms
      ) VALUES (?, 1, 'RUNTIME_APPLY', 'SUCCEEDED', 'newer', 'newer', ?,
        NULL, NULL, 0, 2999)
    `).run(current.operationId, DIGEST_A));
    assert(/attempt time precedes its authority/i.test(clockRollback.message));
    assertEqual(authoritySnapshot(firstDb), before);
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-nonretryable');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(2100);
    const drift = repository.recordManualRuntimeApplyFailed({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_TARGET_DIGEST_DRIFT',
    });
    assertEqual(drift.applicationState.state, 'FAILED');
    assertEqual(drift.applicationState.retryable, false);
  });
});

await testAsync('application transaction failures roll back attempt, override and history together', async () => {
  for (const fixture of [
    {
      name: 'override',
      sql: `
        CREATE TRIGGER fixture_reject_application_override
        BEFORE INSERT ON model_overrides
        BEGIN SELECT RAISE(ABORT, 'fixture application override'); END;
      `,
    },
  ]) {
    await withRepository(async ({ firstDb }) => {
      const runtime = createRuntime(`application-failure-${fixture.name}`);
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      runtime.setNow(2000);
      const applied = applyChat(repository);
      const before = authoritySnapshot(firstDb);
      firstDb.exec(fixture.sql);
      runtime.setNow(2100);
      const error = captureError(() => repository.recordManualRuntimeApplied({
        operationId: applied.operation.operationId,
        expectedAttemptRevision: 0,
        observedModelName: 'candidate',
        observedDigestSha256: DIGEST_B,
        runtimeChanged: true,
      }));
      assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
      assertEqual(authoritySnapshot(firstDb), before);
    });
  }

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-failure-history');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    const before = authoritySnapshot(firstDb);
    firstDb.exec(`
      CREATE TRIGGER fixture_reject_application_history
      BEFORE INSERT ON upgrade_history
      BEGIN SELECT RAISE(ABORT, 'fixture application history'); END;
    `);
    runtime.setNow(2150);
    const error = captureError(() => finalizeRuntime(
      repository,
      applied.operation.operationId,
      1,
    ));
    assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(authoritySnapshot(firstDb), before);
  });

  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('application-failure-verification');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const applied = applyChat(repository);
    runtime.setNow(2100);
    repository.recordManualRuntimeApplied({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 0,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: true,
    });
    runtime.setNow(2150);
    finalizeRuntime(repository, applied.operation.operationId, 1);
    const before = authoritySnapshot(firstDb);
    firstDb.exec(`
      CREATE TRIGGER fixture_reject_application_verification
      BEFORE UPDATE ON model_overrides
      WHEN NEW.verification_status = 'VERIFIED'
      BEGIN SELECT RAISE(ABORT, 'fixture application verification'); END;
    `);
    runtime.setNow(2200);
    const error = captureError(() => repository.recordManualVerificationSucceeded({
      operationId: applied.operation.operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
    }));
    assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(authoritySnapshot(firstDb), before);
  });
});

suite('M1 manual binding repository — incident supersede and retirement');

await testAsync('detected incident is atomically superseded by manual intent', async () => {
  await withRepository(async ({ firstDb }) => {
    const runtime = createRuntime('supersede-detected');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    detectChat(repository);
    runtime.setNow(2500);
    const applied = applyChat(repository);
    assertEqual(applied.outcome, 'RECORDED');
    const state = repository.getState('CHAT');
    assertEqual(state.state, 'SUPERSEDED_BY_USER');
    assertEqual(state.desiredRevision, 2);
    assertEqual(state.rowVersion, 2);
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
    const claimed = insertHistoricalFailoverClaim(firstDb, detected);
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
    const activateClaim = insertHistoricalFailoverClaim(firstDb, detected);
    activateClaimedChat(firstDb, activateClaim);
    runtime.setNow(3200);
    const active = repository.getState('CHAT');
    const restoreClaim = insertHistoricalFailoverClaim(firstDb, active, {
      kind: 'RESTORE',
      operationId: 'operation-historical-restore',
      claimToken: 'claim-token-historical-restore-0001',
      createdAtMs: 3200,
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
