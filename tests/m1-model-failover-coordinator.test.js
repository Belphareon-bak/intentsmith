#!/usr/bin/env node

import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  readModelSettings,
  updateModelSettings,
} from '../src/db/user-settings.js';
import {
  MODEL_FAILOVER_ACTOR,
  MODEL_FAILOVER_ROLES,
  ModelFailoverRepositoryError,
  createModelFailoverRepository,
} from '../src/upgrade/model-failover.js';
import {
  ModelFailoverDetectionStatus,
  createModelFailoverDetectionCoordinator,
  createModelFailoverDetectionInventoryPort,
  createModelFailoverDetectionRepositoryPort,
  startModelFailoverDetectionScheduler,
} from '../src/upgrade/model-failover-coordinator.js';

const ROLE_MODELS = Object.freeze({
  D1: 'deep-reasoner',
  D2: 'repair-reasoner',
  CODE: 'code-model',
  R1: 'review-reasoner',
  R2: 'review-model',
  CHAT: 'chat-model',
  VISION: 'vision-model',
});
const ROLE_DIGESTS = Object.freeze({
  D1: '1'.repeat(64),
  D2: '2'.repeat(64),
  CODE: '3'.repeat(64),
  R1: '4'.repeat(64),
  R2: '5'.repeat(64),
  CHAT: '6'.repeat(64),
  VISION: '7'.repeat(64),
});

function openDb(databasePath) {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function createRepository(db, prefix) {
  let now = 10_000;
  const counters = { event: 0, episode: 0, operation: 0, claimToken: 0 };
  return createModelFailoverRepository(db, {
    clock: () => ++now,
    ids: {
      event: () => `${prefix}-event-${++counters.event}`,
      episode: () => `${prefix}-episode-${++counters.episode}`,
      operation: () => `${prefix}-operation-${++counters.operation}`,
      claimToken: () => `${prefix}-claim-${++counters.claimToken}`,
    },
  });
}

async function withRuntime(callback, { second = false } = {}) {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'failover-coordinator-',
  ));
  const databasePath = path.join(directory, 'coordinator.sqlite');
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

function installedInventory({ omit = [], digestOverrides = {}, extra = [] } = {}) {
  const omitted = new Set(omit);
  return [
    ...Object.entries(ROLE_MODELS)
      .filter(([role]) => !omitted.has(role))
      .map(([role, modelName]) => ({
        name: `${modelName}:latest`,
        canonicalName: modelName,
        digestSha256: digestOverrides[role] || ROLE_DIGESTS[role],
      })),
    ...extra,
  ];
}

function createProvider(initialInventory) {
  let current = initialInventory;
  const calls = { listInstalled: 0 };
  return {
    calls,
    setInventory(value) {
      current = value;
    },
    async listInstalled() {
      calls.listInstalled += 1;
      if (typeof current === 'function') return current();
      if (current instanceof Error) throw current;
      return structuredClone(current);
    },
  };
}

function createCoordinator({
  db,
  repository,
  provider,
  bindings = ROLE_MODELS,
  readSettings = () => readModelSettings(db),
  readBindings = () => ({ ...bindings }),
} = {}) {
  return createModelFailoverDetectionCoordinator({
    repositoryPort: createModelFailoverDetectionRepositoryPort(repository),
    inventoryPort: createModelFailoverDetectionInventoryPort(provider),
    readSettings,
    readBindings,
    clock: () => 50_000,
  });
}

function repositoryFacade(repository, overrides = {}) {
  return {
    getDesired: repository.getDesired.bind(repository),
    getState: repository.getState.bind(repository),
    listCompatibilityOverridesForRehydrate:
      repository.listCompatibilityOverridesForRehydrate.bind(repository),
    observeDesiredBinding: repository.observeDesiredBinding.bind(repository),
    recordDetection: repository.recordDetection.bind(repository),
    ...overrides,
  };
}

function assertRepositoryError(error, code) {
  assert(error instanceof ModelFailoverRepositoryError, `Expected repository error, got ${error}`);
  assertEqual(error.code, code);
}

function enableFailover(db) {
  updateModelSettings(db, { autoFailoverEnabled: true });
}

function countRows(db, table, where = '', params = []) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params).count;
}

function authorityCounts(db) {
  return {
    desired: countRows(db, 'model_desired_bindings'),
    state: countRows(db, 'model_failover_state'),
    events: countRows(db, 'model_failover_events'),
    proofs: countRows(db, 'model_failover_proofs'),
    operations: countRows(db, 'model_binding_operations'),
    providerOperations: countRows(db, 'model_binding_provider_operations'),
    attempts: countRows(db, 'model_binding_application_attempts'),
    overrides: countRows(db, 'model_overrides'),
    upgradeHistory: countRows(db, 'upgrade_history'),
  };
}

function roleResult(report, role) {
  return report.roles.find(entry => entry.role === role);
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

suite('M1 model failover detection coordinator');

await testAsync('literal opt-in is checked before inventory or repository effects', async () => {
  await withRuntime(async ({ firstDb }) => {
    const repository = createRepository(firstDb, 'settings');
    const provider = createProvider(installedInventory());
    const cases = [
      {
        name: 'missing',
        prepare: () => firstDb.prepare('DELETE FROM user_settings').run(),
        readSettings: () => readModelSettings(firstDb),
        status: ModelFailoverDetectionStatus.SKIPPED_INVALID_SETTINGS,
      },
      {
        name: 'disabled',
        prepare: () => updateModelSettings(firstDb, { autoFailoverEnabled: false }),
        readSettings: () => readModelSettings(firstDb),
        status: ModelFailoverDetectionStatus.SKIPPED_DISABLED,
      },
      {
        name: 'malformed',
        prepare: () => firstDb.prepare(`
          INSERT OR REPLACE INTO user_settings (id, data) VALUES (1, '{bad json')
        `).run(),
        readSettings: () => readModelSettings(firstDb),
        status: ModelFailoverDetectionStatus.SKIPPED_INVALID_SETTINGS,
      },
      {
        name: 'db-error',
        prepare: () => {},
        readSettings: () => ({
          status: 'DB_ERROR',
          valid: false,
          settings: { autoFailoverEnabled: false },
          reason: 'USER_SETTINGS_DB_READ_FAILED',
        }),
        status: ModelFailoverDetectionStatus.SKIPPED_INVALID_SETTINGS,
      },
      {
        name: 'throw',
        prepare: () => {},
        readSettings: () => { throw new Error('fixture settings failure'); },
        status: ModelFailoverDetectionStatus.SKIPPED_INVALID_SETTINGS,
      },
    ];

    for (const fixture of cases) {
      fixture.prepare();
      const before = authorityCounts(firstDb);
      const callsBefore = provider.calls.listInstalled;
      const report = await createCoordinator({
        db: firstDb,
        repository,
        provider,
        readSettings: fixture.readSettings,
      }).runOnce();
      assertEqual(report.status, fixture.status, fixture.name);
      assertEqual(provider.calls.listInstalled, callsBefore, fixture.name);
      assertEqual(JSON.stringify(authorityCounts(firstDb)), JSON.stringify(before), fixture.name);
    }
  });
});

await testAsync('one strict snapshot seeds seven exact baselines and reruns without writes', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'seed');
    const provider = createProvider(installedInventory());
    const coordinator = createCoordinator({ db: firstDb, repository, provider });

    const first = await coordinator.runOnce();
    assertEqual(first.status, ModelFailoverDetectionStatus.COMPLETED);
    assertEqual(first.counters.desiredCreated, 7);
    assertEqual(first.counters.detectionsCreated, 0);
    assertEqual(provider.calls.listInstalled, 1);
    assertEqual(countRows(firstDb, 'model_desired_bindings'), 7);
    assertEqual(countRows(firstDb, 'model_failover_events'), 7);
    assertEqual(countRows(firstDb, 'model_failover_state'), 0);

    for (const role of MODEL_FAILOVER_ROLES) {
      const desired = repository.getDesired(role);
      assertEqual(desired.modelName, ROLE_MODELS[role]);
      assertEqual(desired.canonicalName, ROLE_MODELS[role]);
      assertEqual(desired.digestSha256, ROLE_DIGESTS[role]);
      assertEqual(desired.bindingRevision, 1);
      assertEqual(desired.source, 'CONFIG_DEFAULT');
      assertEqual(desired.actor, MODEL_FAILOVER_ACTOR);
    }

    const second = await coordinator.runOnce();
    assertEqual(second.status, ModelFailoverDetectionStatus.COMPLETED);
    assertEqual(second.counters.presentExact, 7);
    assertEqual(provider.calls.listInstalled, 2);
    assertEqual(countRows(firstDb, 'model_failover_events'), 7);
    assertEqual(JSON.stringify(authorityCounts(firstDb)), JSON.stringify({
      desired: 7,
      state: 0,
      events: 7,
      proofs: 0,
      operations: 0,
      providerOperations: 0,
      attempts: 0,
      overrides: 0,
      upgradeHistory: 0,
    }));
  });
});

await testAsync('legacy source requires one exact operationless legacy override', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    firstDb.prepare(`
      INSERT INTO model_overrides (role, model, previous_model)
      VALUES ('CHAT', 'chat-model:latest', 'old-chat-model')
    `).run();
    const repository = createRepository(firstDb, 'legacy');
    const provider = createProvider(installedInventory());
    const report = await createCoordinator({ db: firstDb, repository, provider }).runOnce();

    assertEqual(report.status, ModelFailoverDetectionStatus.COMPLETED);
    assertEqual(repository.getDesired('CHAT').source, 'LEGACY_OVERRIDE');
    assertEqual(repository.getDesired('CODE').source, 'CONFIG_DEFAULT');
    assertEqual(countRows(firstDb, 'model_failover_events', 'WHERE event_type = ?', ['DETECTED']), 0);

    let orphanWrites = 0;
    const orphanRepository = repositoryFacade(repository, {
      getDesired: role => role === 'CHAT' ? null : repository.getDesired(role),
      getState: role => role === 'CHAT' ? null : repository.getState(role),
      listCompatibilityOverridesForRehydrate: () => [{
        role: 'CHAT',
        modelName: 'chat-model:latest',
        bindingOperationId: 'operation-without-desired',
        verificationStatus: 'PENDING',
      }],
      observeDesiredBinding: input => {
        if (input.role === 'CHAT') orphanWrites += 1;
        return repository.observeDesiredBinding(input);
      },
    });
    const orphan = await createCoordinator({
      db: firstDb,
      repository: orphanRepository,
      provider,
    }).runOnce();
    assertEqual(roleResult(orphan, 'CHAT').outcome, 'INCONCLUSIVE_AUTHORITY');
    assertEqual(orphanWrites, 0);
    assertEqual(repository.getDesired('CHAT').source, 'LEGACY_OVERRIDE');
  });
});

await testAsync('invalid or ambiguous inventory fails before every durable write', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'inventory');
    const invalidInventories = [
      [],
      [{ name: '', canonicalName: '', digestSha256: '1'.repeat(64) }],
      [{ name: 'chat-model:latest', canonicalName: 'chat-model', digestSha256: '' }],
      [
        { name: 'chat-model', canonicalName: 'chat-model', digestSha256: '1'.repeat(64) },
        { name: 'chat-model:latest', canonicalName: 'chat-model', digestSha256: '2'.repeat(64) },
      ],
    ];
    for (const inventory of invalidInventories) {
      const provider = createProvider(inventory);
      const report = await createCoordinator({ db: firstDb, repository, provider }).runOnce();
      assertEqual(report.status, ModelFailoverDetectionStatus.INCONCLUSIVE);
      assertEqual(provider.calls.listInstalled, 1);
      assertEqual(countRows(firstDb, 'model_desired_bindings'), 0);
      assertEqual(countRows(firstDb, 'model_failover_events'), 0);
    }

    const unavailable = createProvider(new Error('fixture provider unavailable'));
    const report = await createCoordinator({
      db: firstDb,
      repository,
      provider: unavailable,
    }).runOnce();
    assertEqual(report.status, ModelFailoverDetectionStatus.INCONCLUSIVE);
    assertEqual(report.reason, 'INVENTORY_UNAVAILABLE');
    assertEqual(unavailable.calls.listInstalled, 1);
    assertEqual(countRows(firstDb, 'model_desired_bindings'), 0);
  });
});

await testAsync('policy or binding drift during the one inventory snapshot stops before writes', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'scan-drift');
    const policyProvider = createProvider(() => {
      updateModelSettings(firstDb, { autoFailoverEnabled: false });
      return installedInventory();
    });
    const policyDrift = await createCoordinator({
      db: firstDb,
      repository,
      provider: policyProvider,
    }).runOnce();
    assertEqual(policyDrift.status, ModelFailoverDetectionStatus.INCONCLUSIVE);
    assertEqual(policyDrift.reason, 'AUTO_FAILOVER_POLICY_CHANGED');
    assertEqual(countRows(firstDb, 'model_desired_bindings'), 0);

    enableFailover(firstDb);
    const mutableBindings = { ...ROLE_MODELS };
    const bindingProvider = createProvider(() => {
      mutableBindings.CHAT = 'changed-during-scan';
      return installedInventory();
    });
    const bindingDrift = await createCoordinator({
      db: firstDb,
      repository,
      provider: bindingProvider,
      readBindings: () => ({ ...mutableBindings }),
    }).runOnce();
    assertEqual(bindingDrift.status, ModelFailoverDetectionStatus.INCONCLUSIVE);
    assertEqual(bindingDrift.reason, 'BINDINGS_CHANGED_DURING_INVENTORY');
    assertEqual(countRows(firstDb, 'model_desired_bindings'), 0);
    assertEqual(countRows(firstDb, 'model_failover_events'), 0);
  });
});

await testAsync('repository opt-in check is atomic with seed and detection writes', async () => {
  await withRuntime(async ({ firstDb, secondDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'policy-toctou');
    const provider = createProvider(installedInventory());
    let seedPolicyChanged = false;
    const seedRace = repositoryFacade(repository, {
      observeDesiredBinding: input => {
        if (!seedPolicyChanged) {
          seedPolicyChanged = true;
          updateModelSettings(secondDb, { autoFailoverEnabled: false });
        }
        return repository.observeDesiredBinding(input);
      },
    });

    const seedReport = await createCoordinator({
      db: firstDb,
      repository: seedRace,
      provider,
    }).runOnce();
    assertEqual(seedReport.status, ModelFailoverDetectionStatus.PARTIAL);
    assertEqual(roleResult(seedReport, 'CHAT').reason, 'AUTO_FAILOVER_POLICY_CHANGED');
    assertEqual(JSON.stringify(authorityCounts(firstDb)), JSON.stringify({
      desired: 0,
      state: 0,
      events: 0,
      proofs: 0,
      operations: 0,
      providerOperations: 0,
      attempts: 0,
      overrides: 0,
      upgradeHistory: 0,
    }));

    enableFailover(firstDb);
    await createCoordinator({ db: firstDb, repository, provider }).runOnce();
    const beforeDetection = authorityCounts(firstDb);
    provider.setInventory(installedInventory({ omit: ['CHAT'] }));
    let detectionPolicyChanged = false;
    const detectionRace = repositoryFacade(repository, {
      recordDetection: input => {
        if (!detectionPolicyChanged) {
          detectionPolicyChanged = true;
          updateModelSettings(secondDb, { autoFailoverEnabled: false });
        }
        return repository.recordDetection(input);
      },
    });
    const detectionReport = await createCoordinator({
      db: firstDb,
      repository: detectionRace,
      provider,
    }).runOnce();
    assertEqual(detectionReport.status, ModelFailoverDetectionStatus.PARTIAL);
    assertEqual(roleResult(detectionReport, 'CHAT').reason, 'AUTO_FAILOVER_POLICY_CHANGED');
    assertEqual(JSON.stringify(authorityCounts(firstDb)), JSON.stringify(beforeDetection));
    assertEqual(repository.getState('CHAT'), null);
  }, { second: true });
});

await testAsync('absence without baseline, authority drift and digest drift never become uninstall', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'drift');
    const provider = createProvider(installedInventory({ omit: ['CHAT'] }));
    const coordinator = createCoordinator({ db: firstDb, repository, provider });

    const unseeded = await coordinator.runOnce();
    assertEqual(roleResult(unseeded, 'CHAT').outcome, 'UNSEEDED_MISSING');
    assertEqual(repository.getDesired('CHAT'), null);
    assertEqual(repository.getState('CHAT'), null);

    provider.setInventory(installedInventory());
    const seeded = await coordinator.runOnce();
    assertEqual(roleResult(seeded, 'CHAT').outcome, 'DESIRED_CREATED');
    const eventCount = countRows(firstDb, 'model_failover_events');

    provider.setInventory(installedInventory({
      digestOverrides: { CHAT: 'a'.repeat(64) },
    }));
    const digestDrift = await coordinator.runOnce();
    assertEqual(roleResult(digestDrift, 'CHAT').outcome, 'DIGEST_DRIFT');
    assertEqual(repository.getState('CHAT'), null);
    assertEqual(repository.getDesired('CHAT').digestSha256, ROLE_DIGESTS.CHAT);
    assertEqual(countRows(firstDb, 'model_failover_events'), eventCount);

    const driftedBindings = { ...ROLE_MODELS, CHAT: 'different-chat-model' };
    provider.setInventory(installedInventory({
      extra: [{
        name: 'different-chat-model:latest',
        canonicalName: 'different-chat-model',
        digestSha256: 'b'.repeat(64),
      }],
    }));
    const authorityDrift = await createCoordinator({
      db: firstDb,
      repository,
      provider,
      bindings: driftedBindings,
    }).runOnce();
    assertEqual(roleResult(authorityDrift, 'CHAT').outcome, 'AUTHORITY_DRIFT');
    assertEqual(repository.getDesired('CHAT').canonicalName, ROLE_MODELS.CHAT);
    assertEqual(repository.getState('CHAT'), null);
  });
});

await testAsync('healthy then missing creates one detection across rerun and restart', async () => {
  await withRuntime(async ({ firstDb, secondDb }) => {
    enableFailover(firstDb);
    const firstRepository = createRepository(firstDb, 'detect-first');
    const provider = createProvider(installedInventory());
    const firstCoordinator = createCoordinator({
      db: firstDb,
      repository: firstRepository,
      provider,
    });
    await firstCoordinator.runOnce();

    provider.setInventory(installedInventory({ omit: ['CHAT'] }));
    const detected = await firstCoordinator.runOnce();
    assertEqual(roleResult(detected, 'CHAT').outcome, 'DETECTED_CREATED');
    const state = firstRepository.getState('CHAT');
    assertEqual(state.state, 'DETECTED');
    assertEqual(state.desiredRevision, 1);
    assertEqual(state.rowVersion, 1);
    assertEqual(state.activeFailover, false);
    assertEqual(state.claimPresent, false);
    assertEqual(state.actor, MODEL_FAILOVER_ACTOR);
    assertEqual(state.reasonCode, 'BOUND_MODEL_NOT_INSTALLED');
    assertEqual(countRows(firstDb, 'model_failover_events', 'WHERE role = ? AND event_type = ?', [
      'CHAT',
      'DETECTED',
    ]), 1);

    const repeated = await firstCoordinator.runOnce();
    assertEqual(roleResult(repeated, 'CHAT').outcome, 'DETECTED_UNCHANGED');
    const secondRepository = createRepository(secondDb, 'detect-second');
    const restarted = await createCoordinator({
      db: secondDb,
      repository: secondRepository,
      provider,
    }).runOnce();
    assertEqual(roleResult(restarted, 'CHAT').outcome, 'DETECTED_UNCHANGED');
    assertEqual(countRows(secondDb, 'model_failover_events', 'WHERE role = ? AND event_type = ?', [
      'CHAT',
      'DETECTED',
    ]), 1);
    assertEqual(authorityCounts(secondDb).proofs, 0);
    assertEqual(authorityCounts(secondDb).operations, 0);
    assertEqual(authorityCounts(secondDb).providerOperations, 0);
    assertEqual(authorityCounts(secondDb).attempts, 0);
    assertEqual(authorityCounts(secondDb).overrides, 0);
    assertEqual(authorityCounts(secondDb).upgradeHistory, 0);
  }, { second: true });
});

await testAsync('manual authority, existing terminal state and competing seed remain untouched', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'manual');
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'chat-model',
      digestSha256: ROLE_DIGESTS.CHAT,
      source: 'CONFIG_DEFAULT',
      actor: MODEL_FAILOVER_ACTOR,
    });
    repository.recordUserBindingApply({
      requestKey: 'coordinator-manual-apply-request',
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'manual-chat-model',
      targetDigestSha256: 'a'.repeat(64),
      actor: 'user:coordinator-test',
    });
    const bindings = { ...ROLE_MODELS, CHAT: 'manual-chat-model' };
    const provider = createProvider(installedInventory({ omit: ['CHAT'] }));
    const manual = await createCoordinator({
      db: firstDb,
      repository,
      provider,
      bindings,
    }).runOnce();
    assertEqual(roleResult(manual, 'CHAT').outcome, 'MANUAL_OWNED');
    assertEqual(repository.getState('CHAT'), null);

    let terminalWrites = 0;
    const terminalFacade = repositoryFacade(repository, {
      getState: role => role === 'CODE' ? {
        role: 'CODE',
        desiredRevision: 1,
        state: 'RESTORED',
        activeFailover: false,
        claimPresent: false,
      } : repository.getState(role),
      recordDetection: input => {
        if (input.role === 'CODE') terminalWrites += 1;
        return repository.recordDetection(input);
      },
    });
    const terminal = await createCoordinator({
      db: firstDb,
      repository: terminalFacade,
      provider,
      bindings,
    }).runOnce();
    assertEqual(roleResult(terminal, 'CODE').outcome, 'INCIDENT_OWNED');
    assertEqual(terminalWrites, 0);

    const seedRepository = createRepository(firstDb, 'seed-race');
    const stale = captureError(() => seedRepository.observeDesiredBinding({
      role: 'CODE',
      modelName: 'different-code-model',
      digestSha256: 'b'.repeat(64),
      source: 'CONFIG_DEFAULT',
      actor: MODEL_FAILOVER_ACTOR,
      expectedAbsent: true,
    }));
    assert(stale instanceof ModelFailoverRepositoryError);
    assertEqual(stale.code, 'MODEL_FAILOVER_STALE_DESIRED');
    assertEqual(seedRepository.getDesired('CODE').modelName, ROLE_MODELS.CODE);
  });
});

await testAsync('coordinator-only literals fail closed and cannot retire a terminal incident', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'repository-flags');
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: ROLE_MODELS.CHAT,
      digestSha256: ROLE_DIGESTS.CHAT,
      source: 'CONFIG_DEFAULT',
      actor: MODEL_FAILOVER_ACTOR,
    });

    for (const [operation, expectedCode] of [
      [() => repository.observeDesiredBinding({
        role: 'CODE',
        modelName: ROLE_MODELS.CODE,
        digestSha256: ROLE_DIGESTS.CODE,
        source: 'CONFIG_DEFAULT',
        actor: MODEL_FAILOVER_ACTOR,
        expectedAbsent: false,
      }), 'MODEL_FAILOVER_EXPECTED_ABSENT_INVALID'],
      [() => repository.observeDesiredBinding({
        role: 'CODE',
        modelName: ROLE_MODELS.CODE,
        digestSha256: ROLE_DIGESTS.CODE,
        source: 'CONFIG_DEFAULT',
        actor: MODEL_FAILOVER_ACTOR,
        requireAutoFailoverEnabled: false,
      }), 'MODEL_FAILOVER_POLICY_REQUIREMENT_INVALID'],
      [() => repository.recordDetection({
        role: 'CHAT',
        expectedDesiredRevision: 1,
        detectionOnly: false,
      }), 'MODEL_FAILOVER_DETECTION_ONLY_INVALID'],
      [() => repository.recordDetection({
        role: 'CHAT',
        expectedDesiredRevision: 1,
        requireAutoFailoverEnabled: false,
      }), 'MODEL_FAILOVER_POLICY_REQUIREMENT_INVALID'],
    ]) {
      assertRepositoryError(captureError(operation), expectedCode);
    }

    repository.recordDetection({ role: 'CHAT', expectedDesiredRevision: 1 });
    repository.recordUserBindingApply({
      requestKey: 'coordinator-terminal-apply-request',
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'manual-chat-model',
      targetDigestSha256: 'a'.repeat(64),
      actor: 'user:coordinator-terminal-test',
    });
    const terminalBefore = repository.getState('CHAT');
    const eventCountBefore = countRows(firstDb, 'model_failover_events');
    assertEqual(terminalBefore.state, 'SUPERSEDED_BY_USER');
    assertEqual(terminalBefore.desiredRevision, 2);

    const terminalError = captureError(() => repository.recordDetection({
      role: 'CHAT',
      expectedDesiredRevision: 2,
      detectionOnly: true,
      requireAutoFailoverEnabled: true,
    }));
    assertRepositoryError(terminalError, 'MODEL_FAILOVER_INCIDENT_EXISTS');
    assertEqual(JSON.stringify(repository.getState('CHAT')), JSON.stringify(terminalBefore));
    assertEqual(countRows(firstDb, 'model_failover_events'), eventCountBefore);
  });
});

await testAsync('manual apply racing detection wins revision without a wrong incident', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'manual-race');
    const provider = createProvider(installedInventory());
    await createCoordinator({ db: firstDb, repository, provider }).runOnce();
    provider.setInventory(installedInventory({ omit: ['R2'] }));
    let injected = false;
    const racingRepository = repositoryFacade(repository, {
      recordDetection: input => {
        if (!injected && input.role === 'R2') {
          injected = true;
          repository.recordUserBindingApply({
            requestKey: 'coordinator-manual-race-request',
            role: 'R2',
            expectedBindingRevision: 1,
            targetModelName: 'manual-review-model',
            targetDigestSha256: 'c'.repeat(64),
            actor: 'user:coordinator-race',
          });
        }
        return repository.recordDetection(input);
      },
    });
    const report = await createCoordinator({
      db: firstDb,
      repository: racingRepository,
      provider,
    }).runOnce();
    assertEqual(roleResult(report, 'R2').outcome, 'INCONCLUSIVE');
    assertEqual(roleResult(report, 'R2').reason, 'DESIRED_AUTHORITY_CHANGED');
    assertEqual(repository.getDesired('R2').bindingRevision, 2);
    assertEqual(repository.getDesired('R2').source, 'USER_APPLY');
    assertEqual(repository.getState('R2'), null);
    assertEqual(countRows(firstDb, 'model_failover_events', 'WHERE role = ? AND event_type = ?', [
      'R2',
      'DETECTED',
    ]), 0);
  });
});

await testAsync('single-flight and two WAL connections produce at most one detection event', async () => {
  await withRuntime(async ({ firstDb, secondDb }) => {
    enableFailover(firstDb);
    const firstRepository = createRepository(firstDb, 'race-one');
    const seedProvider = createProvider(installedInventory());
    await createCoordinator({
      db: firstDb,
      repository: firstRepository,
      provider: seedProvider,
    }).runOnce();

    let releaseInventory;
    const blockedProvider = createProvider(() => new Promise(resolve => {
      releaseInventory = resolve;
    }));
    const single = createCoordinator({
      db: firstDb,
      repository: firstRepository,
      provider: blockedProvider,
    });
    const active = single.runOnce();
    await nextTurn();
    const busy = await single.runOnce();
    assertEqual(busy.status, ModelFailoverDetectionStatus.SKIPPED_BUSY);
    assertEqual(blockedProvider.calls.listInstalled, 1);
    releaseInventory(installedInventory({ omit: ['CHAT'] }));
    await active;

    const secondRepository = createRepository(secondDb, 'race-two');
    const missingProvider = createProvider(installedInventory({ omit: ['CODE', 'CHAT'] }));
    const [left, right] = await Promise.all([
      createCoordinator({
        db: firstDb,
        repository: firstRepository,
        provider: missingProvider,
      }).runOnce(),
      createCoordinator({
        db: secondDb,
        repository: secondRepository,
        provider: missingProvider,
      }).runOnce(),
    ]);
    const outcomes = [roleResult(left, 'CODE').outcome, roleResult(right, 'CODE').outcome].sort();
    assertEqual(JSON.stringify(outcomes), JSON.stringify([
      'DETECTED_CREATED',
      'DETECTED_UNCHANGED',
    ]));
    assertEqual(countRows(firstDb, 'model_failover_events', 'WHERE role = ? AND event_type = ?', [
      'CODE',
      'DETECTED',
    ]), 1);
  }, { second: true });
});

await testAsync('projection failure rolls back audit and cannot report completion', async () => {
  await withRuntime(async ({ firstDb }) => {
    enableFailover(firstDb);
    const repository = createRepository(firstDb, 'rollback');
    const provider = createProvider(installedInventory());
    const coordinator = createCoordinator({ db: firstDb, repository, provider });
    await coordinator.runOnce();
    provider.setInventory(installedInventory({ omit: ['CHAT'] }));
    firstDb.exec(`
      CREATE TRIGGER fixture_reject_coordinator_projection
      BEFORE INSERT ON model_failover_state
      BEGIN
        SELECT RAISE(ABORT, 'fixture rejects coordinator projection');
      END;
    `);
    const beforeEvents = countRows(firstDb, 'model_failover_events');

    const report = await coordinator.runOnce();
    assertEqual(report.status, ModelFailoverDetectionStatus.PARTIAL);
    assertEqual(roleResult(report, 'CHAT').reason, 'REPOSITORY_WRITE_FAILED');
    assertEqual(repository.getState('CHAT'), null);
    assertEqual(countRows(firstDb, 'model_failover_events'), beforeEvents);
    assertEqual(repository.getDesired('CHAT').bindingRevision, 1);
  });
});

await testAsync('scheduler preserves first delay, never overlaps and server drops legacy poll', async () => {
  let active = 0;
  let maxActive = 0;
  let release;
  const coordinator = {
    async runOnce() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => { release = resolve; });
      active -= 1;
      return {
        status: ModelFailoverDetectionStatus.COMPLETED,
        counters: { desiredCreated: 0, detectionsCreated: 0 },
      };
    },
  };
  const scheduled = [];
  const delays = [];
  const schedule = (callback, delayMs) => {
    scheduled.push(callback);
    delays.push(delayMs);
    return { unref() {} };
  };
  const scheduler = startModelFailoverDetectionScheduler({
    coordinator,
    intervalMs: 300_000,
    schedule,
    cancel: () => {},
  });
  assertEqual(active, 0);
  assertEqual(scheduled.length, 1);
  assertEqual(delays[0], 300_000);
  scheduled.shift()();
  await nextTurn();
  assertEqual(active, 1);
  assertEqual(scheduled.length, 0);
  release();
  await nextTurn();
  assertEqual(maxActive, 1);
  assertEqual(scheduled.length, 1);
  scheduler.stop();

  const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert(serverSource.includes('startModelFailoverDetectionScheduler({'));
  assert(!serverSource.includes('modelRegistry.checkBindingIntegrity().catch(() => {})'));
});

test('coordinator source excludes activation, recommendation and provider mutation authority', () => {
  const source = readFileSync(
    new URL('../src/upgrade/model-failover-coordinator.js', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    '.claimOperation(',
    '.recordProof(',
    '.getRecommendation(',
    '.pull(',
    '.deleteModel(',
    '.apply(',
    '.activate(',
    '.restore(',
    '.publishControl(',
  ]) {
    assert(!source.includes(forbidden), `Forbidden coordinator authority: ${forbidden}`);
  }
  assert(source.includes('detectionOnly: true'));
  assert(source.includes('expectedAbsent: true'));
});

test('composition exposes only frozen detection capabilities', () => {
  const repositoryMethods = {
    getDesired() {},
    getState() {},
    listCompatibilityOverridesForRehydrate() {},
    observeDesiredBinding() {},
    recordDetection() {},
  };
  const repository = new Proxy(repositoryMethods, {
    get(target, property, receiver) {
      if (!(property in target)) throw new Error(`Unexpected repository capability: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });
  const provider = new Proxy({ async listInstalled() { return installedInventory(); } }, {
    get(target, property, receiver) {
      if (!(property in target)) throw new Error(`Unexpected provider capability: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  });
  const repositoryPort = createModelFailoverDetectionRepositoryPort(repository);
  const inventoryPort = createModelFailoverDetectionInventoryPort(provider);

  assert(Object.isFrozen(repositoryPort));
  assert(Object.isFrozen(inventoryPort));
  assertEqual(JSON.stringify(Object.keys(repositoryPort).sort()), JSON.stringify([
    'getDesired',
    'getState',
    'listCompatibilityOverridesForRehydrate',
    'observeDesiredBinding',
    'recordDetection',
  ]));
  assertEqual(JSON.stringify(Object.keys(inventoryPort)), JSON.stringify(['listInstalled']));
  for (const forbidden of ['claimOperation', 'recordProof', 'pull', 'verify', 'activate']) {
    assertEqual(repositoryPort[forbidden], undefined);
    assertEqual(inventoryPort[forbidden], undefined);
  }

  const options = {
    repositoryPort,
    inventoryPort,
    readSettings: () => ({ valid: true, settings: { autoFailoverEnabled: false } }),
    readBindings: () => ({ ...ROLE_MODELS }),
  };
  assert(createModelFailoverDetectionCoordinator(options));
  assert(captureError(() => createModelFailoverDetectionCoordinator({
    ...options,
    repositoryPort: { ...repositoryPort },
  })) instanceof TypeError);
  assert(captureError(() => createModelFailoverDetectionCoordinator({
    ...options,
    repositoryPort: Object.freeze({ ...repositoryPort, claimOperation() {} }),
  })) instanceof TypeError);
});

summary();
