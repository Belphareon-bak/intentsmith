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
  MAX_MODEL_FAILOVER_CLAIM_MS,
  ModelFailoverRepositoryError,
  createModelFailoverRepository,
} from '../src/upgrade/model-failover.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const FAILOVER_MODULE_URL = new URL('../src/upgrade/model-failover.js', import.meta.url).href;

const CLAIM_WORKER_SOURCE = `
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
      clock: () => 3000,
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
      const result = repository.claimOperation({
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
        operationId: result.claim.operationId,
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

function runClaimRace({ databasePath, role, contenders }) {
  const signalBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const signal = new Int32Array(signalBuffer);
  const workers = contenders.map(contender => new Worker(CLAIM_WORKER_SOURCE, {
    eval: true,
    workerData: {
      databasePath,
      role,
      moduleUrl: FAILOVER_MODULE_URL,
      signal: signalBuffer,
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
      fail(new Error(`Claim worker race timed out after 5000 ms for ${role}`));
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
            assertEqual(message.snapshot.rowVersion, 1);
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

suite('M1 model failover repository — two-connection claim CAS');

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
    assertRepositoryError(manualError, 'MODEL_FAILOVER_MANUAL_SEAM_NOT_IMPLEMENTED');
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
    assert(/^SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)$/.test(conflictError.cause?.code || ''));
    assertEqual(first.getDesired('CODE'), null);

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

await testAsync('expired claim is not stolen or silently renewed', async () => {
  await withRepositories(async ({ firstDb }) => {
    const runtime = createRuntime('expired');
    const repository = createModelFailoverRepository(firstDb, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const detected = detectChat(repository).state;
    runtime.setNow(3000);
    const claimed = claimChat(repository, detected, { leaseMs: 500 });
    const beforeEvents = repository.listEvents({ role: 'CHAT' }).length;

    runtime.setNow(3501);
    const error = captureError(() => claimChat(repository, claimed.state));
    assertRepositoryError(error, 'MODEL_FAILOVER_CLAIM_EXPIRED_REQUIRES_RECLAIM');
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, beforeEvents);
    assertEqual(repository.getState('CHAT').claimOperationId, claimed.claim.operationId);
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

summary();
