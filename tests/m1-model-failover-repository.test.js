#!/usr/bin/env node

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
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
  createModelAutomationPolicyRepository,
  createModelFailoverTargetInventoryReader,
} from '../src/db/model-policy.js';
import {
  MAX_MODEL_FAILOVER_CLAIM_MS,
  ModelFailoverRepositoryError,
  createModelFailoverRepository,
} from '../src/upgrade/model-failover.js';
import {
  getModelFailoverMeasurementContract,
} from '../src/upgrade/model-failover-proof-policy.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const FAILOVER_MODULE_URL = new URL('../src/upgrade/model-failover.js', import.meta.url).href;

const FAILOVER_WORKER_SOURCE = `
  const Database = require('better-sqlite3');
  const { parentPort, workerData } = require('node:worker_threads');

  (async () => {
    const { createModelFailoverRepository } = await import(workerData.moduleUrl);
    const db = new Database(workerData.databasePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const ids = {
      event: () => workerData.prefix + '-event',
      episode: () => workerData.prefix + '-episode-unused',
      operation: () => workerData.prefix + '-operation',
      claimToken: () => workerData.prefix + '-claim-token-0001',
    };
    const repository = createModelFailoverRepository(db, {
      clock: () => workerData.nowMs,
      ids,
    });
    const snapshot = repository.getState(workerData.role);
    parentPort.postMessage({ type: 'ready', prefix: workerData.prefix, snapshot });
    const signal = new Int32Array(workerData.signal);
    while (Atomics.load(signal, 0) !== 1) {
      Atomics.wait(signal, 0, 0);
    }
    if (workerData.delayMs > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.delayMs);
    }
    try {
      const result = workerData.action === 'expire'
        ? repository.expireClaim({
            role: workerData.role,
            episodeId: snapshot.episodeId,
            expectedDesiredRevision: snapshot.desiredRevision,
            expectedRowVersion: snapshot.rowVersion,
            expectedOperationId: snapshot.claimOperationId,
            expectedClaimKind: snapshot.claimKind,
          })
        : repository.claimOperation({
            role: workerData.role,
            episodeId: snapshot.episodeId,
            expectedDesiredRevision: snapshot.desiredRevision,
            expectedRowVersion: snapshot.rowVersion,
            kind: 'ACTIVATE',
            leaseMs: 1000,
          });
      parentPort.postMessage({
        type: 'result',
        prefix: workerData.prefix,
        outcome: result.outcome,
        operationId: result.claim?.operationId || result.expiredOperationId,
        eventId: result.claim?.eventId || result.eventId,
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

function createLiveTerminalInventory(initialRows = [
  { name: 'reasoner', canonicalName: 'reasoner', digestSha256: DIGEST_A },
  { name: 'fallback:latest', canonicalName: 'fallback', digestSha256: DIGEST_B },
]) {
  let rows = initialRows.map(row => Object.freeze({ ...row }));
  const reader = Object.freeze(target => {
    const matches = rows.filter(row => row.canonicalName === target.canonicalName);
    if (matches.length === 0) {
      const error = new Error('terminal target is not installed');
      error.code = 'MODEL_FAILOVER_TARGET_NOT_INSTALLED';
      throw error;
    }
    return matches[0];
  });
  return {
    reader,
    replace(nextRows) {
      rows = nextRows.map(row => Object.freeze({ ...row }));
    },
  };
}

function createRuntime(prefix, initialNow = 1000) {
  let now = initialNow;
  const terminalInventory = createLiveTerminalInventory();
  const counters = {
    event: 0,
    episode: 0,
    operation: 0,
    claimToken: 0,
  };
  return {
    setNow(value) {
      now = value;
    },
    counters,
    terminalInventory,
    options: {
      clock: () => now,
      terminalInventoryReader: terminalInventory.reader,
      ids: {
        event: () => `${prefix}-event-${++counters.event}`,
        episode: () => `${prefix}-episode-${++counters.episode}`,
        operation: () => `${prefix}-operation-${++counters.operation}`,
        claimToken: () => `${prefix}-claim-token-${String(++counters.claimToken).padStart(4, '0')}`,
      },
    },
  };
}

async function withRepositories(callback, { second = false } = {}) {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'failover-repository-'),
  );
  const databasePath = path.join(directory, 'failover.sqlite');
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

async function captureErrorAsync(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

function assertRepositoryError(error, code) {
  assert(error instanceof ModelFailoverRepositoryError, `Expected repository error, got ${error}`);
  assertEqual(error.code, code);
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

function detectChat(repository, expectedDesiredRevision = 1) {
  return repository.recordDetection({
    role: 'CHAT',
    expectedDesiredRevision,
  });
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

function expireChat(repository, state, overrides = {}) {
  return repository.expireClaim({
    role: 'CHAT',
    episodeId: state.episodeId,
    expectedDesiredRevision: state.desiredRevision,
    expectedRowVersion: state.rowVersion,
    expectedOperationId: state.claimOperationId,
    expectedClaimKind: state.claimKind,
    ...overrides,
  });
}

function insertTerminalProof(db, {
  proofId,
  modelName,
  canonicalName,
  digestSha256,
  completedAtMs = 2400,
  expiresAtMs = 900000,
}) {
  const contract = getModelFailoverMeasurementContract('CHAT');
  const validationRunId = `${proofId}-run`;
  const measurementSha256 = createHash('sha256')
    .update(`measurement:${proofId}`)
    .digest('hex');
  const acceptanceSha256 = createHash('sha256')
    .update(`acceptance:${proofId}`)
    .digest('hex');
  const sourceRevision = createHash('sha256')
    .update(`source:${proofId}`)
    .digest('hex')
    .slice(0, 40);
  const startedAtMs = completedAtMs - 100;
  const proofTtlMs = expiresAtMs - completedAtMs;
  const insert = db.transaction(() => {
    db.prepare('PRAGMA defer_foreign_keys = ON').run();
    db.prepare(`
      INSERT INTO model_failover_proof_artifacts (
        proof_id, validation_run_id, parent_run_id, source_revision,
        measurement_artifact_sha256, measurement_artifact_byte_length,
        acceptance_artifact_sha256, acceptance_artifact_byte_length,
        role, suite, role_contract_sha256, model_name,
        model_canonical_name, model_digest_sha256, validation_version,
        policy_version, score, required_score, passed_count,
        required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest,
        inventory_after_name, inventory_after_digest,
        measurement_started_at_ms, measurement_completed_at_ms,
        acceptance_completed_at_ms, proof_ttl_ms, expires_at_ms, issued_at_ms
      ) VALUES (?, ?, ?, ?, ?, 4096, ?, 2048, 'CHAT', 'chat', ?, ?, ?, ?,
        'v123.1', ?, 1, 1, 6, 6, 6, 100, 'PASS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proofId,
      validationRunId,
      `parent-${proofId}`,
      sourceRevision,
      measurementSha256,
      acceptanceSha256,
      contract.measurementContractSha256,
      modelName,
      canonicalName,
      digestSha256,
      contract.contract.policyVersion,
      modelName,
      digestSha256,
      modelName,
      digestSha256,
      startedAtMs,
      completedAtMs,
      completedAtMs,
      proofTtlMs,
      expiresAtMs,
      completedAtMs,
    );
    db.prepare(`
      INSERT INTO model_failover_proofs (
        proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        validation_version, policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      ) VALUES (?, ?, 'CHAT', 'chat', ?, ?, ?, ?, 'v123.1', ?, 1, 1, 6, 6,
        6, 100, 'PASS', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proofId,
      validationRunId,
      contract.measurementContractSha256,
      modelName,
      canonicalName,
      digestSha256,
      contract.contract.policyVersion,
      modelName,
      digestSha256,
      modelName,
      digestSha256,
      startedAtMs,
      completedAtMs,
      expiresAtMs,
      completedAtMs,
    );
  });
  insert.immediate();
}

async function enableTerminalTarget(db, {
  nowMs = 2600,
  modelName = 'fallback:latest',
  canonicalName = 'fallback',
  digestSha256 = DIGEST_B,
} = {}) {
  const inventoryReader = createModelFailoverTargetInventoryReader([{
    name: modelName,
    canonicalName,
    digestSha256,
  }]);
  let eventCounter = 0;
  let requestCounter = 0;
  const repository = createModelAutomationPolicyRepository(db, {
    clock: () => nowMs,
    ids: {
      event: () => `terminal-policy-event-${++eventCounter}`,
      request: () => `terminal-policy-request-${++requestCounter}`,
    },
    targetInventoryReader: inventoryReader,
  });
  const current = repository.read();
  if (!current.settings.autoFailoverEnabled) {
    repository.updateFromTypedApi({
      expectedRevision: current.revision,
      autoFailoverEnabled: true,
      autoCleanupEnabled: current.settings.autoCleanupEnabled,
      autoCleanupDays: current.settings.autoCleanupDays,
    });
  }
  return repository.setTarget({
    role: 'CHAT',
    expectedRevision: repository.readTarget('CHAT').revision,
    target: { requestedName: modelName, canonicalName, digestSha256 },
  });
}

async function prepareActivation(repository, state, overrides = {}) {
  return repository.prepareTerminalOperation({
    role: 'CHAT',
    episodeId: state.episodeId,
    expectedDesiredRevision: state.desiredRevision,
    expectedRowVersion: state.rowVersion,
    kind: 'ACTIVATE',
    leaseMs: 1000,
    expectedTargetRevision: 1,
    expectedRuntimeIncarnationId: 'runtime-incarnation-repository-0001',
    expectedRuntimeGeneration: 0,
    ...overrides,
  });
}

function activationRuntime(overrides = {}) {
  return {
    incarnationBefore: 'runtime-incarnation-repository-0001',
    incarnationAfter: 'runtime-incarnation-repository-0001',
    generationBefore: 0,
    generationAfter: 1,
    fromModelName: 'reasoner',
    fromDigestSha256: DIGEST_A,
    toModelName: 'fallback:latest',
    toDigestSha256: DIGEST_B,
    changed: true,
    ...overrides,
  };
}

function runFailoverRace({
  databasePath,
  role,
  contenders,
  action = 'claim',
  nowMs = 3000,
  expectedRowVersion = 1,
}) {
  const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const signal = new Int32Array(signalBuffer);
  const workers = contenders.map(contender => new Worker(FAILOVER_WORKER_SOURCE, {
    eval: true,
    workerData: {
      databasePath,
      role,
      moduleUrl: FAILOVER_MODULE_URL,
      signal: signalBuffer,
      action,
      nowMs,
      ...contender,
    },
  }));

  return new Promise((resolve, reject) => {
    const results = [];
    let readyCount = 0;
    let exitCount = 0;
    let settled = false;
    let watchdog = null;

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
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
      for (const worker of workers) worker.terminate();
      reject(error);
    };

    watchdog = setTimeout(() => {
      fail(new Error(`Failover ${action} worker race timed out after 5000 ms for ${role}`));
    }, 5000);

    for (const worker of workers) {
      worker.on('error', fail);
      worker.on('message', message => {
        try {
          if (message.type === 'fatal') {
            fail(new Error(`${message.prefix}: ${message.errorMessage}`));
            return;
          }
          if (message.type === 'ready') {
            assertEqual(message.snapshot.rowVersion, expectedRowVersion);
            readyCount += 1;
            if (readyCount === workers.length) {
              Atomics.store(signal, 0, 1);
              Atomics.notify(signal, 0);
            }
            return;
          }
          if (message.type === 'result') {
            results.push(message);
            finishIfComplete();
          }
        } catch (error) {
          fail(error);
        }
      });
      worker.on('exit', code => {
        if (settled) return;
        if (code !== 0) {
          fail(new Error(`Claim worker exited ${code}`));
          return;
        }
        exitCount += 1;
        finishIfComplete();
      });
    }
  });
}

function runClaimRace(options) {
  return runFailoverRace(options);
}

suite('M1 model failover repository — desired and incident authority');

await testAsync('desired observation is canonical-idempotent and digest changes revision', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('desired');
    const repository = createModelFailoverRepository(firstDb, runtime.options);

    const created = observeChat(repository);
    assertEqual(created.outcome, 'CREATED');
    assertEqual(created.binding.bindingRevision, 1);
    assertEqual(created.binding.canonicalName, 'reasoner');

    runtime.setNow(1100);
    const aliasRepeat = observeChat(repository, { modelName: 'reasoner:latest' });
    assertEqual(aliasRepeat.outcome, 'UNCHANGED');
    assertEqual(aliasRepeat.binding.modelName, 'reasoner');
    assertEqual(runtime.counters.event, 1);

    runtime.setNow(1200);
    const sourceChanged = observeChat(repository, {
      modelName: 'reasoner:latest',
      source: 'CONFIG_DEFAULT',
    });
    assertEqual(sourceChanged.outcome, 'CHANGED');
    assertEqual(sourceChanged.binding.bindingRevision, 2);
    assertEqual(sourceChanged.binding.source, 'CONFIG_DEFAULT');

    runtime.setNow(1300);
    const changed = observeChat(repository, {
      modelName: 'reasoner:latest',
      digestSha256: DIGEST_B,
      source: 'CONFIG_DEFAULT',
    });
    assertEqual(changed.outcome, 'CHANGED');
    assertEqual(changed.binding.bindingRevision, 3);
    assertEqual(changed.binding.canonicalName, 'reasoner');
    assertEqual(changed.binding.digestSha256, DIGEST_B);

    const effective = repository.getEffectiveBinding('chat');
    assertEqual(effective.source, 'DESIRED');
    assertEqual(effective.digestSha256, DIGEST_B);
    assertEqual(
      repository.listEvents({ role: 'CHAT' }).map(event => event.eventType).join(','),
      'DESIRED_OBSERVED,DESIRED_CHANGED,DESIRED_CHANGED',
    );
  });
});

await testAsync('detection is idempotent and desired change fails closed during an incident', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('detect');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);

    const created = detectChat(repository);
    assertEqual(created.outcome, 'CREATED');
    assertEqual(created.state.state, 'DETECTED');
    assertEqual(created.state.rowVersion, 1);
    assertEqual(created.state.episodeId, 'detect-episode-1');

    runtime.setNow(2500);
    const repeated = detectChat(repository);
    assertEqual(repeated.outcome, 'UNCHANGED');
    assertEqual(runtime.counters.event, 2);
    assertEqual(runtime.counters.episode, 1);

    runtime.setNow(3000);
    const error = captureError(() => observeChat(repository, { digestSha256: DIGEST_B }));
    assertRepositoryError(error, 'MODEL_FAILOVER_DESIRED_CHANGE_REQUIRES_SUPERSEDE');
    assertEqual(repository.getDesired('CHAT').digestSha256, DIGEST_A);
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, 2);
  });
});

await testAsync('desired and detection projections rollback their preceding audit events', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('projection-rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);

    firstDb.exec(`
      CREATE TRIGGER reject_desired_projection
      BEFORE INSERT ON model_desired_bindings
      BEGIN
        SELECT RAISE(ABORT, 'fixture rejects desired projection');
      END
    `);
    const desiredError = captureError(() => observeChat(repository));
    assertRepositoryError(desiredError, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assert(/fixture rejects desired projection/.test(desiredError.cause?.message || ''));
    assertEqual(repository.getDesired('CHAT'), null);
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, 0);
    firstDb.exec('DROP TRIGGER reject_desired_projection');

    observeChat(repository);
    const beforeDetectionEvents = repository.listEvents({ role: 'CHAT' }).length;
    firstDb.exec(`
      CREATE TRIGGER reject_detection_projection
      BEFORE INSERT ON model_failover_state
      BEGIN
        SELECT RAISE(ABORT, 'fixture rejects detection projection');
      END
    `);
    runtime.setNow(2000);
    const detectionError = captureError(() => detectChat(repository));
    assertRepositoryError(detectionError, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assert(/fixture rejects detection projection/.test(detectionError.cause?.message || ''));
    assertEqual(repository.getState('CHAT'), null);
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeDetectionEvents);
  });
});

suite('M1 model failover repository — two-connection claim and expiry CAS');

await testAsync('BEGIN IMMEDIATE is the only repository write transaction mode', async () => {
  await withRepositories(async ({ firstDb }) => {
    const calls = [];
    const instrumentedDb = {
      prepare: (...args) => firstDb.prepare(...args),
      transaction: callback => {
        const transaction = firstDb.transaction(callback);
        return {
          immediate: (...args) => {
            calls.push('immediate');
            return transaction.immediate(...args);
          },
        };
      },
    };
    const runtime = createRuntime('immediate');
    const repository = createModelFailoverRepository(instrumentedDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    claimChat(repository, detected);
    assertEqual(calls.join(','), 'immediate,immediate,immediate');
  });
});

await testAsync('real worker races serialize to one winner and one typed stale loser', async () => {
  await withRepositories(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('race');
    const repository = createModelFailoverRepository(firstDb, runtime.options);

    observeChat(repository);
    repository.observeDesiredBinding({
      role: 'CODE',
      modelName: 'coder',
      digestSha256: DIGEST_B,
      source: 'LEGACY_OVERRIDE',
      actor: 'user:fixture',
    });
    runtime.setNow(2000);
    detectChat(repository);
    repository.recordDetection({ role: 'CODE', expectedDesiredRevision: 1 });

    for (const scenario of [
      {
        role: 'CHAT',
        expectedWinner: 'race-a',
        contenders: [
          { prefix: 'race-a', delayMs: 0 },
          { prefix: 'race-b', delayMs: 40 },
        ],
      },
      {
        role: 'CODE',
        expectedWinner: 'race-b',
        contenders: [
          { prefix: 'race-a', delayMs: 40 },
          { prefix: 'race-b', delayMs: 0 },
        ],
      },
    ]) {
      const results = await runClaimRace({
        databasePath,
        role: scenario.role,
        contenders: scenario.contenders,
      });
      const winners = results.filter(result => result.outcome === 'CLAIMED');
      const losers = results.filter(result => result.errorCode === 'MODEL_FAILOVER_STALE_STATE');
      assertEqual(winners.length, 1);
      assertEqual(losers.length, 1);
      assertEqual(winners[0].prefix, scenario.expectedWinner);
      assertEqual(results.some(result => result.errorCode === 'MODEL_FAILOVER_DB_BUSY'), false);
      assertEqual(
        repository.listEvents({ role: scenario.role })
          .filter(event => event.eventType === 'ACTIVATION_CLAIMED').length,
        1,
      );
      assertEqual(repository.getState(scenario.role).claimOperationId, winners[0].operationId);
    }
  });
});

await testAsync('real expiry workers serialize to one release and one exact idempotent retry', async () => {
  await withRepositories(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('expiry-race');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    const claimed = claimChat(repository, detected, { leaseMs: 500 });

    const results = await runFailoverRace({
      databasePath,
      role: 'CHAT',
      action: 'expire',
      nowMs: 3501,
      expectedRowVersion: claimed.state.rowVersion,
      contenders: [
        { prefix: 'expiry-a', delayMs: 0 },
        { prefix: 'expiry-b', delayMs: 40 },
      ],
    });
    assertEqual(results.filter(result => result.outcome === 'EXPIRED').length, 1);
    assertEqual(results.filter(result => result.outcome === 'ALREADY_EXPIRED').length, 1);
    assertEqual(results.some(result => result.errorCode === 'MODEL_FAILOVER_DB_BUSY'), false);
    assertEqual(new Set(results.map(result => result.eventId)).size, 1);
    assertEqual(
      repository.listEvents({ role: 'CHAT' })
        .filter(event => event.eventType === 'CLAIM_EXPIRED').length,
      1,
    );
    const state = repository.getState('CHAT');
    assertEqual(state.rowVersion, claimed.state.rowVersion + 1);
    assertEqual(state.claimPresent, false);
  });
});

await testAsync('two stale snapshots produce exactly one claim winner and no loser audit', async () => {
  await withRepositories(async ({ firstDb, secondDb, databasePath }) => {
    const firstPath = firstDb.pragma('database_list').find(row => row.name === 'main').file;
    const secondPath = secondDb.pragma('database_list').find(row => row.name === 'main').file;
    assertEqual(firstPath, databasePath);
    assertEqual(secondPath, databasePath);
    assert(firstDb !== secondDb, 'fixture must use two distinct Database instances');
    assertEqual(firstDb.pragma('journal_mode', { simple: true }), 'wal');
    assertEqual(secondDb.pragma('foreign_keys', { simple: true }), 1);

    const firstRuntime = createRuntime('winner');
    const secondRuntime = createRuntime('loser');
    const first = createModelFailoverRepository(firstDb, firstRuntime.options);
    const second = createModelFailoverRepository(secondDb, secondRuntime.options);
    observeChat(first);
    firstRuntime.setNow(2000);
    const detected = detectChat(first).state;
    const staleSnapshot = second.getState('CHAT');
    assertEqual(staleSnapshot.rowVersion, detected.rowVersion);

    firstRuntime.setNow(3000);
    const authorityError = captureError(() => claimChat(first, detected, {
      nowMs: 1,
      eventId: 'caller-event',
      operationId: 'caller-operation',
      claimToken: 'caller-claim-token',
    }));
    assertRepositoryError(authorityError, 'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED');
    assertEqual(firstRuntime.counters.event, 2);
    assertEqual(firstRuntime.counters.operation, 0);
    assertEqual(firstRuntime.counters.claimToken, 0);

    const winner = claimChat(first, detected);
    assertEqual(winner.outcome, 'CLAIMED');
    assertEqual(winner.state.rowVersion, 2);
    assertEqual(winner.state.claimPresent, true);
    assertEqual(Object.hasOwn(winner.state, 'claimToken'), false);
    assertEqual(winner.claim.token, 'winner-claim-token-0001');
    assertEqual(winner.claim.startedAtMs, 3000);
    assertEqual(winner.claim.operationId, 'winner-operation-1');
    assertEqual(winner.claim.eventId, 'winner-event-3');

    const repeatedDetectionError = captureError(() => detectChat(first));
    assertRepositoryError(repeatedDetectionError, 'MODEL_FAILOVER_INCIDENT_EXISTS');
    assertEqual(firstRuntime.counters.event, 3);
    assertEqual(firstRuntime.counters.episode, 1);

    secondRuntime.setNow(3000);
    const loserError = captureError(() => claimChat(second, staleSnapshot));
    assertRepositoryError(loserError, 'MODEL_FAILOVER_STALE_STATE');
    assertEqual(secondRuntime.counters.event, 0);
    assertEqual(secondRuntime.counters.operation, 0);
    assertEqual(secondRuntime.counters.claimToken, 0);

    const rawState = firstDb.prepare(
      'SELECT row_version, claim_operation_id, claim_token FROM model_failover_state WHERE role = ?'
    ).get('CHAT');
    assertEqual(rawState.row_version, 2);
    assertEqual(rawState.claim_operation_id, winner.claim.operationId);
    assertEqual(rawState.claim_token, winner.claim.token);
    assertEqual(
      firstDb.prepare("SELECT count(*) AS count FROM model_failover_events WHERE event_type = 'ACTIVATION_CLAIMED'").get().count,
      1,
    );
  }, { second: true });
});

await testAsync('claim validation and a rejected state update leave zero orphan events', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    const beforeEvents = repository.listEvents({ role: 'CHAT' }).length;

    for (const [input, code] of [
      [{ kind: 'UNKNOWN' }, 'MODEL_FAILOVER_CLAIM_KIND_INVALID'],
      [{ leaseMs: MAX_MODEL_FAILOVER_CLAIM_MS + 1 }, 'MODEL_FAILOVER_CLAIM_WINDOW_INVALID'],
      [{ episodeId: 'different-episode' }, 'MODEL_FAILOVER_INCIDENT_MISMATCH'],
      [{ expectedDesiredRevision: 2 }, 'MODEL_FAILOVER_STALE_DESIRED'],
    ]) {
      const error = captureError(() => claimChat(repository, detected, input));
      assertRepositoryError(error, code);
      assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    }

    runtime.setNow(1999);
    const clockError = captureError(() => claimChat(repository, detected));
    assertRepositoryError(clockError, 'MODEL_FAILOVER_CLOCK_ROLLBACK');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);

    const brokenIds = createModelFailoverRepository(firstDb, {
      ...runtime.options,
      ids: {
        ...runtime.options.ids,
        operation: () => {
          throw new Error('fixture operation id failure');
        },
      },
    });
    runtime.setNow(3000);
    const idError = captureError(() => claimChat(brokenIds, detected));
    assertRepositoryError(idError, 'MODEL_FAILOVER_ID_FACTORY_FAILED');
    assert(/fixture operation id failure/.test(idError.cause?.message || ''));
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);

    const brokenClock = createModelFailoverRepository(firstDb, {
      ...runtime.options,
      clock: () => {
        throw new Error('fixture clock failure');
      },
    });
    const clockFactoryError = captureError(() => claimChat(brokenClock, detected));
    assertRepositoryError(clockFactoryError, 'MODEL_FAILOVER_CLOCK_FAILED');
    assert(/fixture clock failure/.test(clockFactoryError.cause?.message || ''));
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);

    firstDb.exec(`
      CREATE TRIGGER reject_repository_claim_update
      BEFORE UPDATE ON model_failover_state
      WHEN NEW.claim_token IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'fixture rejects claim projection');
      END
    `);
    runtime.setNow(3000);
    const writeError = captureError(() => claimChat(repository, detected));
    assertRepositoryError(writeError, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assert(/fixture rejects claim projection/.test(writeError.cause?.message || ''));
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    const state = repository.getState('CHAT');
    assertEqual(state.rowVersion, 1);
    assertEqual(state.claimPresent, false);
  });
});

await testAsync('manual desired sources and stale incident policy fail closed', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('policy');
    const repository = createModelFailoverRepository(firstDb, runtime.options);

    const manualError = captureError(() => observeChat(repository, { source: 'USER_APPLY' }));
    assertRepositoryError(
      manualError,
      'MODEL_FAILOVER_MANUAL_SOURCE_REQUIRES_DEDICATED_API',
    );
    assertEqual(repository.getDesired('CHAT'), null);

    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    firstDb.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        actor, reason_code, policy_version, state_after, desired_model_name,
        desired_digest_sha256, created_at_ms
      ) VALUES (?, 'DETECTED', 'CHAT', 1, 1, ?, ?, ?, ?, 'DETECTED', ?, ?, ?)
    `).run(
      'legacy-policy-event',
      detected.episodeId,
      'system:legacy',
      'BOUND_MODEL_NOT_INSTALLED',
      'd-plus-v0',
      'reasoner',
      DIGEST_A,
      detected.updatedAtMs,
    );
    firstDb.prepare(`
      UPDATE model_failover_state
      SET policy_version = 'd-plus-v0', last_event_id = 'legacy-policy-event'
      WHERE role = 'CHAT'
    `).run();

    const policyError = captureError(() => detectChat(repository));
    assertRepositoryError(policyError, 'MODEL_FAILOVER_POLICY_MISMATCH');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, 3);
  });
});

await testAsync('busy, identity conflict and corrupt storage remain typed', async () => {
  await withRepositories(async ({ firstDb, secondDb }) => {
    const runtime = createRuntime('typed');
    const second = createModelFailoverRepository(secondDb, runtime.options);
    secondDb.pragma('busy_timeout = 1');

    firstDb.exec('BEGIN IMMEDIATE');
    try {
      const busyError = captureError(() => observeChat(second));
      assertRepositoryError(busyError, 'MODEL_FAILOVER_DB_BUSY');
      assert(/^SQLITE_BUSY/.test(busyError.cause?.code || ''));
    } finally {
      firstDb.exec('ROLLBACK');
    }
    assertEqual(second.getDesired('CHAT'), null);

    const first = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(first);
    const conflicting = createModelFailoverRepository(firstDb, {
      ...runtime.options,
      ids: {
        ...runtime.options.ids,
        event: () => 'typed-event-1',
      },
    });
    const conflictError = captureError(() => conflicting.observeDesiredBinding({
      role: 'CODE',
      modelName: 'coder',
      digestSha256: DIGEST_B,
      source: 'CONFIG_DEFAULT',
      actor: 'user:fixture',
    }));
    assertRepositoryError(conflictError, 'MODEL_FAILOVER_ID_CONFLICT');
    assertEqual(conflictError.cause?.code, 'SQLITE_CONSTRAINT_TRIGGER');
    assert(
      conflictError.cause?.message.startsWith('MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT:'),
      `Expected owned identity signal, got ${conflictError.cause?.message}`,
    );
    assertEqual(first.getDesired('CODE'), null);
    assertEqual(first.listEvents({ role: 'CODE' }).length, 0);

    for (const rejectedSignal of [
      'MODEL_FAILOVER_EVENT_IDENTITY_CONFLICTING: fixture near miss',
      'MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT',
    ]) {
      firstDb.exec(`
        CREATE TRIGGER fixture_identity_signal_near_miss
        BEFORE INSERT ON model_desired_bindings
        BEGIN
          SELECT RAISE(ABORT, '${rejectedSignal}');
        END;
      `);
      const nearMissError = captureError(() => first.observeDesiredBinding({
        role: 'D1',
        modelName: 'reasoner',
        digestSha256: DIGEST_A,
        source: 'CONFIG_DEFAULT',
        actor: 'system:config',
      }));
      assertRepositoryError(nearMissError, 'MODEL_FAILOVER_STORAGE_CONTRACT');
      assertEqual(nearMissError.cause?.code, 'SQLITE_CONSTRAINT_TRIGGER');
      assertEqual(nearMissError.cause?.message, rejectedSignal);
      assertEqual(first.getDesired('D1'), null);
      assertEqual(first.listEvents({ role: 'D1' }).length, 0);
      firstDb.exec('DROP TRIGGER fixture_identity_signal_near_miss');
    }

    firstDb.pragma('ignore_check_constraints = ON');
    try {
      firstDb.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, actor, reason_code,
          policy_version, desired_model_name, desired_digest_sha256,
          details_json, created_at_ms
        ) VALUES (
          'corrupt-details-event', 'DESIRED_OBSERVED', 'CODE', 1,
          'system:fixture', 'CORRUPT_FIXTURE', 'd-plus-v1', 'coder', ?,
          'not-json', 4000
        )
      `).run(DIGEST_B);
    } finally {
      firstDb.pragma('ignore_check_constraints = OFF');
    }
    const corruptError = captureError(() => first.listEvents({ role: 'CODE' }));
    assertRepositoryError(corruptError, 'MODEL_FAILOVER_CORRUPT_STORAGE');
  }, { second: true });
});

await testAsync('expired claim is released exactly once before a fresh bounded claim', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('expired');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    const claimed = claimChat(repository, detected, { leaseMs: 500 });
    const beforeEvents = repository.listEvents({ role: 'CHAT' }).length;
    const oldToken = claimed.claim.token;

    runtime.setNow(3500);
    for (const [field, value] of Object.entries({
      nowMs: 9999,
      eventId: 'caller-expiry-event',
      operationId: 'caller-operation',
      actor: 'caller:fixture',
      claimToken: oldToken,
    })) {
      const authorityError = captureError(() => expireChat(repository, claimed.state, {
        [field]: value,
      }));
      assertRepositoryError(authorityError, 'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED');
      assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
      assertEqual(runtime.counters.event, 3);
    }
    const boundaryError = captureError(() => expireChat(repository, claimed.state));
    assertRepositoryError(boundaryError, 'MODEL_FAILOVER_CLAIM_NOT_EXPIRED');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    assertEqual(runtime.counters.event, 3);

    runtime.setNow(3501);
    const renewalError = captureError(() => claimChat(repository, claimed.state));
    assertRepositoryError(renewalError, 'MODEL_FAILOVER_CLAIM_EXPIRED_REQUIRES_RECLAIM');
    const mismatchError = captureError(() => expireChat(repository, claimed.state, {
      expectedOperationId: 'expired-wrong-operation',
    }));
    assertRepositoryError(mismatchError, 'MODEL_FAILOVER_CLAIM_MISMATCH');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    assertEqual(repository.getState('CHAT').claimOperationId, claimed.claim.operationId);

    const expired = expireChat(repository, claimed.state);
    assertEqual(expired.outcome, 'EXPIRED');
    assertEqual(expired.expiredOperationId, claimed.claim.operationId);
    assertEqual(expired.state.rowVersion, claimed.state.rowVersion + 1);
    assertEqual(expired.state.claimPresent, false);
    assertEqual(Object.hasOwn(expired.state, 'claimToken'), false);
    const events = repository.listEvents({ role: 'CHAT' });
    assertEqual(events.length, beforeEvents + 1);
    assertEqual(events.at(-1).eventType, 'CLAIM_EXPIRED');
    assertEqual(events.at(-1).operationId, claimed.claim.operationId);
    assertEqual(events.at(-1).rowVersion, expired.state.rowVersion);
    assertEqual(events.at(-1).reasonCode, 'EXPIRED_CLAIM_RELEASED');
    assertEqual(JSON.stringify(events.at(-1).details), '{}');

    const retry = expireChat(repository, claimed.state);
    assertEqual(retry.outcome, 'ALREADY_EXPIRED');
    assertEqual(retry.eventId, expired.eventId);
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, events.length);
    const conflictingRetry = captureError(() => expireChat(repository, claimed.state, {
      expectedClaimKind: 'RESTORE',
    }));
    assertRepositoryError(conflictingRetry, 'MODEL_FAILOVER_STALE_STATE');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, events.length);

    runtime.setNow(3502);
    const reclaimed = claimChat(repository, expired.state, { leaseMs: 500 });
    assertEqual(reclaimed.outcome, 'CLAIMED');
    assert(reclaimed.claim.operationId !== claimed.claim.operationId);
    assert(reclaimed.claim.token !== oldToken);
    assertEqual(reclaimed.state.rowVersion, expired.state.rowVersion + 1);
    assertEqual(Object.hasOwn(reclaimed.state, 'claimToken'), false);
    const rawClaim = firstDb.prepare(`
      SELECT claim_operation_id, claim_token
      FROM model_failover_state WHERE role = 'CHAT'
    `).get();
    assertEqual(rawClaim.claim_operation_id, reclaimed.claim.operationId);
    assertEqual(rawClaim.claim_token, reclaimed.claim.token);
    assert(rawClaim.claim_token !== oldToken);

    const staleError = captureError(() => expireChat(repository, claimed.state));
    assertRepositoryError(staleError, 'MODEL_FAILOVER_STALE_STATE');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, events.length + 1);
  });
});

await testAsync('expiry projection failure rolls back its audit event and preserves the secret claim', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('expiry-rollback');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    const claimed = claimChat(repository, detected, { leaseMs: 500 });
    const before = firstDb.prepare(`
      SELECT row_version, claim_operation_id, claim_token, claim_kind,
             claim_started_at_ms, claim_expires_at_ms, last_event_id
      FROM model_failover_state WHERE role = 'CHAT'
    `).get();
    const beforeEvents = repository.listEvents({ role: 'CHAT' }).length;

    firstDb.exec(`
      CREATE TRIGGER fixture_reject_claim_expiry_projection
      BEFORE UPDATE ON model_failover_state
      WHEN OLD.claim_token IS NOT NULL AND NEW.claim_token IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'fixture rejects claim expiry projection');
      END;
    `);
    runtime.setNow(3501);
    const error = captureError(() => expireChat(repository, claimed.state));
    assertRepositoryError(error, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assert(!error.message.includes(claimed.claim.token));
    assert(!JSON.stringify(error.details).includes(claimed.claim.token));

    const after = firstDb.prepare(`
      SELECT row_version, claim_operation_id, claim_token, claim_kind,
             claim_started_at_ms, claim_expires_at_ms, last_event_id
      FROM model_failover_state WHERE role = 'CHAT'
    `).get();
    assertEqual(JSON.stringify(after), JSON.stringify(before));
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    assertEqual(
      firstDb.prepare("SELECT count(*) AS count FROM model_failover_events WHERE event_type = 'CLAIM_EXPIRED'").get().count,
      0,
    );
  });
});

await testAsync('claim-free next row with a non-expiry audit is never an idempotent expiry retry', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('non-expiry-row');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    const claimed = claimChat(repository, detected, { leaseMs: 500 });

    firstDb.transaction(() => {
      firstDb.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256, failure_phase,
          created_at_ms
        ) VALUES ('non-expiry-failed-event', 'DETECTED', 'CHAT', 1, 3,
          ?, ?, 'system:binding-integrity', 'FIXTURE_NON_EXPIRY_TRANSITION',
          'd-plus-v1', 'DETECTED', 'DETECTED', 'reasoner', ?, NULL, 3501)
      `).run(claimed.state.episodeId, claimed.claim.operationId, DIGEST_A);
      firstDb.prepare(`
        UPDATE model_failover_state
        SET row_version = 3, claim_operation_id = NULL, claim_token = NULL,
            claim_kind = NULL, claim_started_at_ms = NULL,
            claim_expires_at_ms = NULL, updated_at_ms = 3501,
            last_event_id = 'non-expiry-failed-event'
        WHERE role = 'CHAT'
      `).run();
    }).immediate();
    const beforeEvents = repository.listEvents({ role: 'CHAT' }).length;

    runtime.setNow(3502);
    const error = captureError(() => expireChat(repository, claimed.state));
    assertRepositoryError(error, 'MODEL_FAILOVER_STALE_STATE');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    assertEqual(repository.getState('CHAT').lastEventId, 'non-expiry-failed-event');
  });
});

await testAsync('persisted desired, incident and claim survive a real close and reopen', async () => {
  await withRepositories(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('restart');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    const claimed = claimChat(repository, detected);

    firstDb.close();
    const restartedDb = openDb(databasePath);
    try {
      const restarted = createModelFailoverRepository(restartedDb, createRuntime('reader').options);
      const state = restarted.getState('CHAT');
      assertEqual(state.episodeId, detected.episodeId);
      assertEqual(state.rowVersion, claimed.state.rowVersion);
      assertEqual(state.claimOperationId, claimed.claim.operationId);
      assertEqual(state.claimPresent, true);
      assertEqual(Object.hasOwn(state, 'claimToken'), false);
      assertEqual(restarted.getEffectiveBinding('CHAT').source, 'DESIRED');
      assertEqual(restarted.listEvents({ role: 'CHAT', afterSeq: 1, limit: 10 }).length, 2);
      assertEqual(restarted.listActiveForRestart().length, 0);
    } finally {
      restartedDb.close();
    }
  });
});

suite('M1 model failover repository — durable terminal intent and receipt CAS');

await testAsync('terminal activation commits intent before effect and one exact finalize receipt', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('terminal-activation');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-fallback-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
    });
    await enableTerminalTarget(firstDb);

    runtime.setNow(3000);
    const prepared = await prepareActivation(repository, detected);
    assertEqual(prepared.outcome, 'PREPARED');
    assertEqual(
      prepared.intent.expectedRuntime.incarnationId,
      'runtime-incarnation-repository-0001',
    );
    assertEqual(prepared.intent.expectedRuntime.generation, 0);
    assertEqual(prepared.intent.observedInventory.requestedName, 'fallback:latest');
    assertEqual(prepared.intent.observedInventory.canonicalName, 'fallback');
    assertEqual(prepared.intent.observedInventory.digestSha256, DIGEST_B);
    assertEqual(repository.listTerminalReconciliationRequired().length, 1);
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts').get().count,
      0,
    );

    runtime.setNow(3200);
    const finalized = await repository.finalizeTerminalOperation({
      operationId: prepared.claim.operationId,
      expectedRowVersion: prepared.state.rowVersion,
      claimToken: prepared.claim.token,
      resolution: 'DIRECT_CONFIRMED',
      runtime: activationRuntime(),
      failureCode: null,
    });
    assertEqual(finalized.outcome, 'FINALIZED');
    assertEqual(finalized.receipt.resolution, 'DIRECT_CONFIRMED');
    assertEqual(finalized.state.state, 'ACTIVATED');
    assertEqual(finalized.state.activeFailover, true);
    assertEqual(repository.listTerminalReconciliationRequired().length, 0);
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts').get().count,
      1,
    );

    const replay = await repository.finalizeTerminalOperation({
      operationId: prepared.claim.operationId,
      expectedRowVersion: prepared.state.rowVersion,
      claimToken: prepared.claim.token,
      resolution: 'DIRECT_CONFIRMED',
      runtime: activationRuntime(),
      failureCode: null,
    });
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts').get().count,
      1,
    );

    runtime.setNow(900000);
    const degraded = repository.recordActiveProofExpired({
      role: 'CHAT',
      episodeId: finalized.state.episodeId,
      expectedDesiredRevision: finalized.state.desiredRevision,
      expectedRowVersion: finalized.state.rowVersion,
      expectedActiveEventId: finalized.state.activeEventId,
    });
    assertEqual(degraded.outcome, 'RECORDED');
    assertEqual(degraded.state.state, 'DEGRADED_PROOF_EXPIRED');
    assertEqual(degraded.state.storageState, 'ACTIVATED');
    assertEqual(degraded.state.activeFailover, true);

    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-revalidated-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
      completedAtMs: 900100,
      expiresAtMs: 1800000,
    });
    const eventCount = repository.listEvents({ role: 'CHAT' }).length;
    runtime.setNow(900200);
    const revalidated = repository.revalidateActiveProof({
      role: 'CHAT',
      episodeId: finalized.state.episodeId,
      expectedDesiredRevision: finalized.state.desiredRevision,
      expectedRowVersion: finalized.state.rowVersion,
      expectedActiveEventId: finalized.state.activeEventId,
    });
    assertEqual(revalidated.outcome, 'REVALIDATED');
    assertEqual(revalidated.state.state, 'ACTIVATED');
    assertEqual(revalidated.state.proofId, 'proof-terminal-fallback-0001');
    assertEqual(revalidated.state.effectiveProofId, 'proof-terminal-revalidated-0001');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, eventCount);

    runtime.setNow(1800000);
    const degradedAgain = repository.recordActiveProofExpired({
      role: 'CHAT',
      episodeId: finalized.state.episodeId,
      expectedDesiredRevision: finalized.state.desiredRevision,
      expectedRowVersion: finalized.state.rowVersion,
      expectedActiveEventId: finalized.state.activeEventId,
    });
    assertEqual(degradedAgain.outcome, 'RECORDED');
    assertEqual(degradedAgain.state.state, 'DEGRADED_PROOF_EXPIRED');
    assertEqual(degradedAgain.state.effectiveProofId, 'proof-terminal-revalidated-0001');
  });
});

await testAsync('terminal writers fail closed on live inventory removal or digest drift', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('terminal-inventory');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-inventory-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
    });
    await enableTerminalTarget(firstDb);
    const beforePrepare = JSON.stringify({
      state: firstDb.prepare("SELECT * FROM model_failover_state WHERE role = 'CHAT'").get(),
      eventCount: firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count,
    });

    runtime.setNow(3000);
    runtime.terminalInventory.replace([]);
    const uninstalled = await captureErrorAsync(() => prepareActivation(repository, detected));
    assertRepositoryError(uninstalled, 'MODEL_FAILOVER_TERMINAL_TARGET_NOT_INSTALLED');
    assertEqual(JSON.stringify({
      state: firstDb.prepare("SELECT * FROM model_failover_state WHERE role = 'CHAT'").get(),
      eventCount: firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count,
    }), beforePrepare);
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_intents').get().count,
      0,
    );

    runtime.terminalInventory.replace([{
      name: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_C,
    }]);
    const driftBeforePrepare = await captureErrorAsync(
      () => prepareActivation(repository, detected),
    );
    assertRepositoryError(driftBeforePrepare, 'MODEL_FAILOVER_TERMINAL_INVENTORY_MISMATCH');
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_intents').get().count,
      0,
    );

    runtime.terminalInventory.replace([{
      name: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
    }]);
    const prepared = await prepareActivation(repository, detected);
    const beforeFinalize = JSON.stringify({
      state: firstDb.prepare("SELECT * FROM model_failover_state WHERE role = 'CHAT'").get(),
      eventCount: firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count,
      intentCount: firstDb.prepare(
        'SELECT COUNT(*) AS count FROM model_failover_terminal_intents'
      ).get().count,
    });
    runtime.terminalInventory.replace([{
      name: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_C,
    }]);
    runtime.setNow(3200);
    const driftAtHandoff = await captureErrorAsync(
      () => repository.finalizeTerminalOperation({
        operationId: prepared.claim.operationId,
        expectedRowVersion: prepared.state.rowVersion,
        claimToken: prepared.claim.token,
        resolution: 'DIRECT_CONFIRMED',
        runtime: activationRuntime(),
        failureCode: null,
      }),
    );
    assertRepositoryError(driftAtHandoff, 'MODEL_FAILOVER_TERMINAL_INVENTORY_MISMATCH');
    assertEqual(JSON.stringify({
      state: firstDb.prepare("SELECT * FROM model_failover_state WHERE role = 'CHAT'").get(),
      eventCount: firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count,
      intentCount: firstDb.prepare(
        'SELECT COUNT(*) AS count FROM model_failover_terminal_intents'
      ).get().count,
    }), beforeFinalize);
    assertEqual(
      firstDb.prepare(
        'SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts'
      ).get().count,
      0,
    );
  });
});

await testAsync('same-incarnation reconciliation starts at lease expiry and remains single-winner', async () => {
  for (const [createdAtMs, expectedOutcome] of [
    [3999, 'TOO_EARLY'],
    [4000, 'FINALIZED'],
    [4001, 'FINALIZED'],
  ]) {
    await withRepositories(async ({ firstDb }) => {
      const runtime = createRuntime(`terminal-reconcile-${createdAtMs}`);
      const repository = createModelFailoverRepository(firstDb, runtime.options);
      observeChat(repository);
      runtime.setNow(2000);
      const detected = detectChat(repository).state;
      insertTerminalProof(firstDb, {
        proofId: `proof-terminal-reconcile-${createdAtMs}`,
        modelName: 'fallback:latest',
        canonicalName: 'fallback',
        digestSha256: DIGEST_B,
      });
      await enableTerminalTarget(firstDb);
      runtime.setNow(3000);
      const prepared = await prepareActivation(repository, detected);
      runtime.setNow(createdAtMs);
      const reconcile = () => repository.finalizeTerminalOperation({
        operationId: prepared.claim.operationId,
        expectedRowVersion: prepared.state.rowVersion,
        claimToken: null,
        resolution: 'RECONCILED_CONFIRMED',
        runtime: activationRuntime(),
        failureCode: null,
      });
      if (expectedOutcome === 'TOO_EARLY') {
        const error = await captureErrorAsync(reconcile);
        assertRepositoryError(error, 'MODEL_FAILOVER_TERMINAL_RECONCILIATION_TOO_EARLY');
        assertEqual(
          firstDb.prepare(
            'SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts'
          ).get().count,
          0,
        );
      } else {
        const direct = await captureErrorAsync(() => repository.finalizeTerminalOperation({
          operationId: prepared.claim.operationId,
          expectedRowVersion: prepared.state.rowVersion,
          claimToken: prepared.claim.token,
          resolution: 'DIRECT_CONFIRMED',
          runtime: activationRuntime(),
          failureCode: null,
        }));
        assertRepositoryError(direct, 'MODEL_FAILOVER_TERMINAL_RECONCILIATION_REQUIRED');
        const finalized = await reconcile();
        assertEqual(finalized.outcome, 'FINALIZED');
        assertEqual(finalized.receipt.createdAtMs, createdAtMs);
        const lateDirect = await captureErrorAsync(() => repository.finalizeTerminalOperation({
          operationId: prepared.claim.operationId,
          expectedRowVersion: prepared.state.rowVersion,
          claimToken: prepared.claim.token,
          resolution: 'DIRECT_CONFIRMED',
          runtime: activationRuntime(),
          failureCode: null,
        }));
        assertRepositoryError(lateDirect, 'MODEL_FAILOVER_TERMINAL_FINALIZE_CONFLICT');
        assertEqual(
          firstDb.prepare(
            'SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts'
          ).get().count,
          1,
        );
      }
    });
  }
});

await testAsync('changed-incarnation reconciliation accepts only the exact old-to-new tuple', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('terminal-new-incarnation');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-new-incarnation-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
    });
    await enableTerminalTarget(firstDb);
    runtime.setNow(3000);
    const prepared = await prepareActivation(repository, detected);
    runtime.setNow(3500);
    const wrongTuple = await captureErrorAsync(() => repository.finalizeTerminalOperation({
      operationId: prepared.claim.operationId,
      expectedRowVersion: prepared.state.rowVersion,
      claimToken: null,
      resolution: 'RECONCILED_CONFIRMED',
      runtime: activationRuntime({
        incarnationAfter: 'runtime-incarnation-restarted-0002',
        fromDigestSha256: DIGEST_C,
      }),
      failureCode: null,
    }));
    assertRepositoryError(wrongTuple, 'MODEL_FAILOVER_RUNTIME_GENERATION_MISMATCH');
    const finalized = await repository.finalizeTerminalOperation({
      operationId: prepared.claim.operationId,
      expectedRowVersion: prepared.state.rowVersion,
      claimToken: null,
      resolution: 'RECONCILED_CONFIRMED',
      runtime: activationRuntime({
        incarnationAfter: 'runtime-incarnation-restarted-0002',
      }),
      failureCode: null,
    });
    assertEqual(finalized.outcome, 'FINALIZED');
    assertEqual(finalized.receipt.runtime.incarnationBefore, 'runtime-incarnation-repository-0001');
    assertEqual(finalized.receipt.runtime.incarnationAfter, 'runtime-incarnation-restarted-0002');
  });
});

await testAsync('failed restore retains active A lineage after operator replaces target with B', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('terminal-restore-lineage');
    runtime.terminalInventory.replace([
      { name: 'reasoner', canonicalName: 'reasoner', digestSha256: DIGEST_A },
      { name: 'fallback-a:latest', canonicalName: 'fallback-a', digestSha256: DIGEST_B },
    ]);
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-fallback-a-0001',
      modelName: 'fallback-a:latest',
      canonicalName: 'fallback-a',
      digestSha256: DIGEST_B,
    });
    await enableTerminalTarget(firstDb, {
      modelName: 'fallback-a:latest',
      canonicalName: 'fallback-a',
      digestSha256: DIGEST_B,
    });
    runtime.setNow(3000);
    const activation = await prepareActivation(repository, detected);
    runtime.setNow(3200);
    const active = await repository.finalizeTerminalOperation({
      operationId: activation.claim.operationId,
      expectedRowVersion: activation.state.rowVersion,
      claimToken: activation.claim.token,
      resolution: 'DIRECT_CONFIRMED',
      runtime: activationRuntime({ toModelName: 'fallback-a:latest' }),
      failureCode: null,
    });
    assertEqual(active.state.fallbackModelName, 'fallback-a:latest');

    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-target-b-0001',
      modelName: 'fallback-b:latest',
      canonicalName: 'fallback-b',
      digestSha256: DIGEST_C,
    });
    await enableTerminalTarget(firstDb, {
      nowMs: 3400,
      modelName: 'fallback-b:latest',
      canonicalName: 'fallback-b',
      digestSha256: DIGEST_C,
    });
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-desired-restore-0001',
      modelName: 'reasoner',
      canonicalName: 'reasoner',
      digestSha256: DIGEST_A,
      completedAtMs: 3500,
      expiresAtMs: 900000,
    });

    runtime.setNow(4000);
    const restore = await repository.prepareTerminalOperation({
      role: 'CHAT',
      episodeId: active.state.episodeId,
      expectedDesiredRevision: active.state.desiredRevision,
      expectedRowVersion: active.state.rowVersion,
      kind: 'RESTORE',
      leaseMs: 1000,
      expectedTargetRevision: 2,
      expectedRuntimeIncarnationId: 'runtime-incarnation-repository-0001',
      expectedRuntimeGeneration: 1,
    });
    assertEqual(restore.intent.target.requestedName, 'fallback-b:latest');
    assertEqual(restore.intent.expectedRuntime.modelName, 'fallback-a:latest');
    assertEqual(restore.intent.effect.modelName, 'reasoner');

    runtime.setNow(4200);
    const failed = await repository.finalizeTerminalOperation({
      operationId: restore.claim.operationId,
      expectedRowVersion: restore.state.rowVersion,
      claimToken: restore.claim.token,
      resolution: 'EFFECT_FAILED',
      runtime: {
        incarnationBefore: 'runtime-incarnation-repository-0001',
        incarnationAfter: 'runtime-incarnation-repository-0001',
        generationBefore: 1,
        generationAfter: 1,
        fromModelName: 'fallback-a:latest',
        fromDigestSha256: DIGEST_B,
        toModelName: 'fallback-a:latest',
        toDigestSha256: DIGEST_B,
        changed: false,
      },
      failureCode: 'MODEL_FAILOVER_RESTORE_EFFECT_FAILED',
    });
    assertEqual(failed.state.state, 'FAILED');
    assertEqual(failed.state.activeFailover, true);
    assertEqual(failed.state.fallbackModelName, 'fallback-a:latest');
    assertEqual(failed.state.fallbackCanonicalName, 'fallback-a');
    assertEqual(failed.state.fallbackDigestSha256, DIGEST_B);
    assertEqual(failed.receipt.runtime.fromModelName, 'fallback-a:latest');
    assertEqual(failed.receipt.runtime.toModelName, 'fallback-a:latest');

    const terminalEvent = firstDb.prepare(
      'SELECT * FROM model_failover_events WHERE event_id = ?'
    ).get(failed.receipt.terminalEventId);
    assertEqual(terminalEvent.event_type, 'RESTORE_FAILED');
    assertEqual(terminalEvent.fallback_model_name, 'fallback-a:latest');
    assertEqual(terminalEvent.fallback_canonical_name, 'fallback-a');
    assertEqual(terminalEvent.fallback_digest_sha256, DIGEST_B);
    const currentTarget = firstDb.prepare(
      "SELECT requested_name, canonical_name, digest_sha256 FROM model_failover_targets WHERE role = 'CHAT'"
    ).get();
    assertEqual(currentTarget.requested_name, 'fallback-b:latest');
    assertEqual(currentTarget.canonical_name, 'fallback-b');
    assertEqual(currentTarget.digest_sha256, DIGEST_C);
  });
});

await testAsync('unresolved terminal intent blocks expiry and user supersede fences late finalize', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('terminal-supersede');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-supersede-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
    });
    await enableTerminalTarget(firstDb);
    runtime.setNow(3000);
    const prepared = await prepareActivation(repository, detected);

    runtime.setNow(4001);
    const expiryError = captureError(() => expireChat(repository, prepared.state));
    assertRepositoryError(expiryError, 'MODEL_FAILOVER_TERMINAL_RECONCILIATION_REQUIRED');
    assertEqual(repository.listTerminalReconciliationRequired().length, 1);

    runtime.setNow(4100);
    const manual = repository.recordUserBindingApply({
      requestKey: 'terminal-user-request-0001',
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'manual:latest',
      targetDigestSha256: 'c'.repeat(64),
      actor: 'user:terminal-test',
    });
    assertEqual(manual.outcome, 'RECORDED');
    assertEqual(repository.getState('CHAT').state, 'SUPERSEDED_BY_USER');
    assertEqual(repository.listTerminalReconciliationRequired().length, 0);
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_supersedes').get().count,
      1,
    );

    runtime.setNow(4200);
    const lateFinalize = await captureErrorAsync(() => repository.finalizeTerminalOperation({
      operationId: prepared.claim.operationId,
      expectedRowVersion: prepared.state.rowVersion,
      claimToken: null,
      resolution: 'RECONCILED_CONFIRMED',
      runtime: activationRuntime(),
      failureCode: null,
    }));
    assertRepositoryError(lateFinalize, 'MODEL_FAILOVER_TERMINAL_SUPERSEDED');
    assertEqual(
      firstDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts').get().count,
      0,
    );
  });
});

await testAsync('restart reconciliation binds incarnation plus generation and never reclaims effect', async () => {
  await withRepositories(async ({ firstDb, databasePath }) => {
    const runtime = createRuntime('terminal-restart');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    insertTerminalProof(firstDb, {
      proofId: 'proof-terminal-restart-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: DIGEST_B,
    });
    await enableTerminalTarget(firstDb);
    runtime.setNow(3000);
    const prepared = await prepareActivation(repository, detected);
    firstDb.close();

    const restartedDb = openDb(databasePath);
    try {
      const restartedRuntime = createRuntime('terminal-reconciler', 4500);
      const restarted = createModelFailoverRepository(restartedDb, restartedRuntime.options);
      const pending = restarted.listTerminalReconciliationRequired();
      assertEqual(pending.length, 1);
      assertEqual(pending[0].operationId, prepared.claim.operationId);
      assertEqual(
        pending[0].expectedRuntime.incarnationId,
        'runtime-incarnation-repository-0001',
      );
      assertEqual(pending[0].expectedRuntime.generation, 0);

      const reconciled = await restarted.finalizeTerminalOperation({
        operationId: prepared.claim.operationId,
        expectedRowVersion: prepared.state.rowVersion,
        claimToken: null,
        resolution: 'RECONCILED_CONFIRMED',
        runtime: activationRuntime(),
        failureCode: null,
      });
      assertEqual(reconciled.outcome, 'FINALIZED');
      assertEqual(reconciled.receipt.resolution, 'RECONCILED_CONFIRMED');
      assertEqual(restarted.listTerminalReconciliationRequired().length, 0);
      assertEqual(
        restartedDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_intents').get().count,
        1,
      );
      assertEqual(
        restartedDb.prepare('SELECT COUNT(*) AS count FROM model_failover_terminal_finalize_receipts').get().count,
        1,
      );
    } finally {
      restartedDb.close();
    }
  });
});

summary();
