#!/usr/bin/env node

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
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

function createRuntime(prefix, initialNow = 1000) {
  let now = initialNow;
  const counters = { event: 0, episode: 0, operation: 0, claimToken: 0 };
  return {
    setNow(value) { now = value; },
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

async function withRepository(callback) {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'failover-detection-repository-'),
  );
  const databasePath = path.join(directory, 'detection.sqlite');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    await runMigrations(db);
    return await callback(db);
  } finally {
    db.close();
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
    detectionOnly: true,
  });
}

suite('M1 model failover detection repository — desired and incident authority');

await testAsync('desired observation is canonical-idempotent and digest changes revision', async () => {
  await withRepository(async db => {
    const runtime = createRuntime('desired');
    const repository = createModelFailoverRepository(db, runtime.options);
    const created = observeChat(repository);
    assertEqual(created.outcome, 'CREATED');
    assertEqual(created.binding.bindingRevision, 1);

    runtime.setNow(1100);
    const aliasRepeat = observeChat(repository, { modelName: 'reasoner:latest' });
    assertEqual(aliasRepeat.outcome, 'UNCHANGED');
    assertEqual(runtime.counters.event, 1);

    runtime.setNow(1200);
    const changed = observeChat(repository, {
      modelName: 'reasoner:latest',
      digestSha256: DIGEST_B,
    });
    assertEqual(changed.outcome, 'CHANGED');
    assertEqual(changed.binding.bindingRevision, 2);
    assertEqual(changed.binding.digestSha256, DIGEST_B);
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'DESIRED');
  });
});

await testAsync('detection is idempotent and desired change fails closed during an incident', async () => {
  await withRepository(async db => {
    const runtime = createRuntime('detect');
    const repository = createModelFailoverRepository(db, runtime.options);
    observeChat(repository);
    runtime.setNow(2000);
    const created = detectChat(repository);
    assertEqual(created.outcome, 'CREATED');
    assertEqual(created.state.state, 'DETECTED');
    assertEqual(created.state.activeFailover, false);
    assertEqual(created.state.claimPresent, false);

    runtime.setNow(2500);
    const repeated = detectChat(repository);
    assertEqual(repeated.outcome, 'UNCHANGED');

    runtime.setNow(3000);
    const error = captureError(() => observeChat(repository, { digestSha256: DIGEST_B }));
    assertRepositoryError(error, 'MODEL_FAILOVER_DESIRED_CHANGE_REQUIRES_SUPERSEDE');
    assertEqual(repository.getDesired('CHAT').digestSha256, DIGEST_A);
  });
});

await testAsync('desired and detection projections roll back their audit events', async () => {
  await withRepository(async db => {
    const runtime = createRuntime('rollback');
    const repository = createModelFailoverRepository(db, runtime.options);
    db.exec(`
      CREATE TRIGGER reject_desired_projection
      BEFORE INSERT ON model_desired_bindings
      BEGIN SELECT RAISE(ABORT, 'fixture rejects desired projection'); END
    `);
    const desiredError = captureError(() => observeChat(repository));
    assertRepositoryError(desiredError, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(repository.getDesired('CHAT'), null);
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, 0);
    db.exec('DROP TRIGGER reject_desired_projection');

    observeChat(repository);
    const before = repository.listEvents({ role: 'CHAT' }).length;
    db.exec(`
      CREATE TRIGGER reject_detection_projection
      BEFORE INSERT ON model_failover_state
      BEGIN SELECT RAISE(ABORT, 'fixture rejects detection projection'); END
    `);
    runtime.setNow(2000);
    const detectionError = captureError(() => detectChat(repository));
    assertRepositoryError(detectionError, 'MODEL_FAILOVER_STORAGE_CONTRACT');
    assertEqual(repository.getState('CHAT'), null);
    assertEqual(repository.listEvents({ role: 'CHAT' }).length, before);
  });
});

await testAsync('public repository exposes no automatic failover transition authority', async () => {
  await withRepository(async db => {
    const repository = createModelFailoverRepository(db, createRuntime('surface').options);
    for (const method of [
      'claimOperation',
      'listEligibleProofs',
      'completeOperation',
      'failOperation',
      'getRuntimeFinalization',
      'listPendingRuntimeFinalizations',
      'recordRuntimeFinalized',
      'getRuntimeHealth',
      'recordActiveProofExpired',
      'expireClaim',
      'listActiveForRestart',
    ]) {
      assertEqual(repository[method], undefined, `${method} must not be reachable`);
    }
  });
});

summary();
