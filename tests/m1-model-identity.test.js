#!/usr/bin/env node

import Database from 'better-sqlite3';
import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { config } from '../src/config.js';
import {
  canonicalModelName,
  canonicalModelNameSet,
  modelNameAliases,
  normalizeModelDigestSha256,
  sameModelName,
} from '../src/upgrade/model-identity.js';
import { ModelRegistry } from '../src/upgrade/model-registry.js';
import {
  UpgradeManager,
  filterCandidates,
} from '../src/upgrade/upgrade-manager.js';
import { createSystemRoutes } from '../src/routes/system.js';
import { up as installAutomationPolicy } from '../src/db/migrations/2026_08_22_066_model_automation_policy.js';
import {
  POLICY_SOURCE,
  readModelAutomationPolicy,
  updateModelAutomationPolicy,
} from '../src/db/model-policy.js';

const originalFetch = globalThis.fetch;
const originalBindings = { ...config.models };
const originalBaseUrl = config.ollama?.baseUrl;

function restoreBindings() {
  for (const key of Object.keys(config.models)) delete config.models[key];
  Object.assign(config.models, originalBindings);
}

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      suite TEXT NOT NULL,
      score REAL NOT NULL,
      validated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_identity_validation
      ON validation_suite_scores(model, suite);

    CREATE TABLE model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      role TEXT NOT NULL,
      used_at TEXT NOT NULL,
      request_type TEXT
    );

    CREATE TABLE model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT,
      applied_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at TEXT
    );

    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Decision 020/E: the automation policy lives in its own storage; this
  // hand-built fixture installs it the same way the migration does.
  installAutomationPolicy(db);
  return db;
}

function createRegistry(db, {
  upgradeManager,
  broadcast,
  modelBindingApplication,
  validationRunner,
  clock,
} = {}) {
  const registry = new ModelRegistry();
  registry.init({
    db,
    upgradeManager: upgradeManager || { applyUpgrade: async () => ({ ok: true }) },
    modelBindingApplication: modelBindingApplication || {
      getProtectedModelNames() {
        return [];
      },
      async runExclusiveModelMutation(input, callback) {
        assertEqual(input.kind, 'MODEL_DELETE');
        return callback();
      },
      async applyManualBinding() {
        return { ok: true };
      },
    },
    validationRunner: validationRunner || null,
    broadcast: broadcast || (() => {}),
    clock,
  });
  return registry;
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function installedModel(name, digest = `sha256:${DIGEST_A}`, modifiedAt = '2025-01-01T00:00:00.000Z') {
  return {
    name,
    digest,
    size: 1_073_741_824,
    sizeGB: '1.0',
    modified_at: modifiedAt,
    params: '7B',
    family: 'unknown',
    category: 'general',
    quantization: 'Q4_K_M',
  };
}

suite('M1 model identity — conservative presence key');

test('bare and implicit latest aliases match in both directions', () => {
  assertEqual(canonicalModelName('  Fixture-Model:latest  '), 'fixture-model');
  assert(sameModelName('fixture-model', 'FIXTURE-MODEL:latest'));
  assert(sameModelName('fixture-model:latest', 'fixture-model'));
  assertEqual(canonicalModelName(canonicalModelName('fixture-model:latest')), 'fixture-model');
  assertEqual(JSON.stringify(modelNameAliases('fixture-model')), JSON.stringify([
    'fixture-model',
    'fixture-model:latest',
  ]));
});

test('explicit tags and fuzzy family spellings remain different', () => {
  assertEqual(sameModelName('fixture:7b', 'fixture:8b'), false);
  assertEqual(sameModelName('deepseek-r1-32b', 'deepseek-r1:32b'), false);
  assertEqual(sameModelName('fixture-q4_k_m', 'fixture-q8_0'), false);
  assertEqual(JSON.stringify(modelNameAliases('fixture:7b')), JSON.stringify(['fixture:7b']));
});

test('invalid identities never match and canonical sets drop them', () => {
  assertEqual(sameModelName(null, undefined), false);
  assertEqual(sameModelName('', '   '), false);
  assertEqual(canonicalModelName({ name: 'fixture' }), null);
  const set = canonicalModelNameSet([null, '', 'Fixture', 'fixture:latest']);
  assertEqual(set.size, 1);
  assert(set.has('fixture'));
});

test('artifact digest accepts bare and sha256-prefixed 64-hex only', () => {
  assertEqual(normalizeModelDigestSha256(DIGEST_A), DIGEST_A);
  assertEqual(normalizeModelDigestSha256(`SHA256:${DIGEST_A.toUpperCase()}`), DIGEST_A);
  assertEqual(normalizeModelDigestSha256(`sha256:${DIGEST_A.slice(1)}`), null);
  assertEqual(normalizeModelDigestSha256('sha512:' + DIGEST_A), null);
  assertEqual(normalizeModelDigestSha256(null), null);
});

suite('M1 model identity — binding and destructive guards');

await testAsync('bound and validating aliases block registry delete before provider effect', async () => {
  const db = createTestDb();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('delete reached provider');
  };
  try {
    config.models.CHAT = 'identity-fixture';
    const registry = createRegistry(db);

    assert(registry.isBound('IDENTITY-FIXTURE:latest'));
    assert(registry.getBoundRoles('identity-fixture:latest').includes('CHAT'));
    assertEqual(registry.isDeletable('identity-fixture:latest').deletable, false);
    const boundError = await captureError(registry.deleteModel('identity-fixture:latest'));
    assertEqual(boundError.code, 'MODEL_DELETE_BOUND');

    config.models.CHAT = 'identity-fixture:latest';
    assert(registry.isBound('identity-fixture'));
    assert(registry.getBoundRoles('identity-fixture').includes('CHAT'));
    assertEqual(registry.isDeletable('identity-fixture').deletable, false);
    const reverseBoundError = await captureError(registry.deleteModel('identity-fixture'));
    assertEqual(reverseBoundError.code, 'MODEL_DELETE_BOUND');

    config.models.CHAT = 'another-model';
    registry._validatingModel = 'identity-fixture';
    assertEqual(registry.isDeletable('identity-fixture:latest').deletable, false);
    const validatingError = await captureError(registry.deleteModel('identity-fixture:latest'));
    assertEqual(validatingError.code, 'MODEL_DELETE_VALIDATING');

    registry._validatingModel = 'identity-fixture:latest';
    assertEqual(registry.isDeletable('identity-fixture').deletable, false);
    const reverseValidatingError = await captureError(registry.deleteModel('identity-fixture'));
    assertEqual(reverseValidatingError.code, 'MODEL_DELETE_VALIDATING');
    assertEqual(fetchCount, 0);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('delete revalidates exact provider name and normalized digest before one effect', async () => {
  async function runScenario(inventories, options = {}) {
    const db = createTestDb();
    const broadcasts = [];
    const deleteBodies = [];
    let inventoryCalls = 0;
    try {
      for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
      globalThis.fetch = async (url, request = {}) => {
        if (url.endsWith('/api/tags')) {
          const models = inventories[Math.min(inventoryCalls, inventories.length - 1)];
          inventoryCalls += 1;
          return { ok: true, status: 200, json: async () => ({ models }) };
        }
        if (url.endsWith('/api/delete')) {
          deleteBodies.push(JSON.parse(request.body));
          return { ok: true, status: 200 };
        }
        throw new Error(`unexpected URL: ${url}`);
      };
      const registry = createRegistry(db, {
        broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
      });
      let result = null;
      let error = null;
      try {
        result = await registry.deleteModel('delete-fixture', {
          source: 'USER_HTTP',
          expectedDigestSha256: options.expectedDigestSha256 || DIGEST_A,
        });
      } catch (caught) {
        error = caught;
      }
      return { result, error, inventoryCalls, deleteBodies, broadcasts };
    } finally {
      db.close();
      restoreBindings();
      globalThis.fetch = originalFetch;
    }
  }

  const stableInventory = [{
    name: 'delete-fixture:latest',
    digest: `sha256:${DIGEST_A}`,
    size: 1_073_741_824,
    modified_at: '2026-01-01T00:00:00.000Z',
  }];
  const success = await runScenario([stableInventory, stableInventory]);
  assertEqual(success.error, null);
  assertEqual(success.inventoryCalls, 2);
  assertEqual(JSON.stringify(success.deleteBodies), JSON.stringify([{ name: 'delete-fixture:latest' }]));
  assertEqual(success.result.deleted, 'delete-fixture:latest');
  assertEqual(success.result.digestSha256, DIGEST_A);
  assertEqual(JSON.stringify(success.broadcasts[0]), JSON.stringify({
    channel: 'control',
    payload: { action: 'model_deleted', model: 'delete-fixture:latest', freedGB: '1.0' },
  }));

  const renamed = await runScenario([
    stableInventory,
    [{ ...stableInventory[0], name: 'delete-fixture' }],
  ]);
  assertEqual(renamed.error.code, 'MODEL_DELETE_ARTIFACT_DRIFT');
  assertEqual(renamed.inventoryCalls, 2);
  assertEqual(renamed.deleteBodies.length, 0);

  const changedDigest = await runScenario([
    stableInventory,
    [{ ...stableInventory[0], digest: `sha256:${DIGEST_B}` }],
  ]);
  assertEqual(changedDigest.error.code, 'MODEL_DELETE_ARTIFACT_DRIFT');
  assertEqual(changedDigest.inventoryCalls, 2);
  assertEqual(changedDigest.deleteBodies.length, 0);

  const malformed = await runScenario([[
    { ...stableInventory[0], digest: `sha512:${DIGEST_A}` },
  ]]);
  assertEqual(malformed.error.code, 'MODEL_DELETE_IDENTITY_INCOMPLETE');
  assertEqual(malformed.inventoryCalls, 1);
  assertEqual(malformed.deleteBodies.length, 0);

  const ambiguous = await runScenario([[
    stableInventory[0],
    { ...stableInventory[0], name: 'delete-fixture' },
  ]]);
  assertEqual(ambiguous.error.code, 'MODEL_DELETE_IDENTITY_AMBIGUOUS');
  assertEqual(ambiguous.inventoryCalls, 1);
  assertEqual(ambiguous.deleteBodies.length, 0);
});

await testAsync('binding acquired at the delete seam blocks before inventory and provider effects', async () => {
  const db = createTestDb();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('provider must not be reached');
  };
  try {
    for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
    const registry = createRegistry(db, {
      modelBindingApplication: {
        getProtectedModelNames() {
          return [];
        },
        async runExclusiveModelMutation(input, callback) {
          assertEqual(input.kind, 'MODEL_DELETE');
          config.models.CHAT = 'interleaved-model:latest';
          return callback();
        },
      },
    });
    const error = await captureError(registry.deleteModel('interleaved-model'));
    assertEqual(error.code, 'MODEL_DELETE_BOUND');
    assertEqual(fetchCount, 0);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('durable desired and rollback binding identities block before provider effects', async () => {
  const db = createTestDb();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('provider must not be reached for a protected binding');
  };
  try {
    for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
    const registry = createRegistry(db, {
      modelBindingApplication: {
        getProtectedModelNames() {
          return ['desired-fixture:latest', 'rollback-fixture'];
        },
        async runExclusiveModelMutation(input, callback) {
          assertEqual(input.kind, 'MODEL_DELETE');
          return callback();
        },
      },
    });

    const desiredError = await captureError(registry.deleteModel('desired-fixture'));
    assertEqual(desiredError.code, 'MODEL_DELETE_BINDING_PROTECTED');
    const rollbackError = await captureError(registry.deleteModel('rollback-fixture:latest'));
    assertEqual(rollbackError.code, 'MODEL_DELETE_BINDING_PROTECTED');
    const previewError = await captureError(registry.prepareDeletePlans(['desired-fixture']));
    assertEqual(previewError.code, 'MODEL_DELETE_BINDING_PROTECTED');
    assertEqual(registry.isDeletable('desired-fixture').deletable, false);
    assertEqual(registry.isDeletable('desired-fixture').code, 'MODEL_DELETE_BINDING_PROTECTED');
    registry.getInstalled = async () => [installedModel('desired-fixture:latest')];
    const overview = await registry.getOverview();
    assertEqual(overview.models[0].isDeletable, false);
    assertEqual(
      overview.models[0].deletableReason,
      'Model je chráněn aktivním, požadovaným nebo rollback bindingem',
    );
    assertEqual(fetchCount, 0);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('overview joins binding, newest validation alias, and aggregate usage', async () => {
  const db = createTestDb();
  try {
    config.models.CHAT = 'identity-fixture';
    db.prepare(`
      INSERT INTO validation_suite_scores (model, suite, score, validated_at)
      VALUES (?, ?, ?, ?)
    `).run('identity-fixture', 'chat', 0.4, '2026-08-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO validation_suite_scores (model, suite, score, validated_at)
      VALUES (?, ?, ?, ?)
    `).run('identity-fixture:latest', 'chat', 0.9, '2026-08-08T00:00:00.000Z');
    const insertUsage = db.prepare(`
      INSERT INTO model_usage (model, role, used_at, request_type)
      VALUES (?, 'CHAT', ?, 'answer')
    `);
    insertUsage.run('identity-fixture', '2026-08-07T00:00:00.000Z');
    insertUsage.run('identity-fixture:latest', '2026-08-08T00:00:00.000Z');

    const registry = createRegistry(db);
    registry.getInstalled = async () => [installedModel('identity-fixture:latest')];
    const overview = await registry.getOverview();
    const [model] = overview.models;

    assertEqual(model.isBound, true);
    assertEqual(model.isDeletable, false);
    assert(model.boundRoles.includes('CHAT'));
    assertEqual(model.requestCount, 2);
    assertEqual(model.lastUsedAt, '2026-08-08T00:00:00.000Z');
    assertEqual(model.validationScores.chat.score, 0.9);
    assertEqual(model.validationScores.chat.sourceModel, 'identity-fixture:latest');
    assertEqual(model.validationScores.chat.identityAmbiguous, true);
    assertEqual(model.validationScores.chat.artifactVerified, false);
  } finally {
    db.close();
    restoreBindings();
  }
});

await testAsync('overview and scheduler consume only the authoritative policy storage', async () => {
  const db = createTestDb();
  try {
    // Decision 020/E: the settings blob is no longer the authority. A value
    // written there must not reach the scheduler at all.
    db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      models: { autoCleanupEnabled: true, autoCleanupDays: 30 },
    }));
    const registryIgnoringBlob = createRegistry(db);
    registryIgnoringBlob.getInstalled = async () => [];
    assertEqual(
      JSON.stringify((await registryIgnoringBlob.getOverview()).autoCleanup),
      JSON.stringify({ enabled: false, days: 14 }),
      'the legacy blob cannot enable cleanup',
    );

    updateModelAutomationPolicy(db, {
      values: { autoCleanupEnabled: true, autoCleanupDays: 30 },
      expectedRevision: readModelAutomationPolicy(db).revision,
      actor: 'user:test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const registry = createRegistry(db);
    registry.getInstalled = async () => [];
    const enabled = await registry.getOverview();
    assertEqual(JSON.stringify(enabled.autoCleanup), JSON.stringify({ enabled: true, days: 30 }));

    const cleanupCalls = [];
    registry.runAutoCleanup = async days => {
      cleanupCalls.push(days);
      return [];
    };
    const configured = await registry.runConfiguredAutoCleanup();
    assertEqual(configured.status, 'COMPLETED');
    assertEqual(configured.days, 30);
    assertEqual(JSON.stringify(cleanupCalls), JSON.stringify([30]));

    // Corrupting the projection is the equivalent of the old malformed blob.
    db.exec('DROP TRIGGER trg_model_automation_policy_projection_event_update');
    db.prepare('UPDATE model_automation_policy SET revision = revision + 1 WHERE id = 1').run();
    registry.invalidateCache();
    const malformed = await registry.getOverview();
    assertEqual(JSON.stringify(malformed.autoCleanup), JSON.stringify({ enabled: false, days: 14 }));
    const skipped = await registry.runConfiguredAutoCleanup();
    assertEqual(skipped.status, 'SKIPPED_INVALID_SETTINGS');
    assertEqual(cleanupCalls.length, 1);
  } finally {
    db.close();
  }
});

test('equal-time validation aliases select deterministically regardless of row order', () => {
  const db = createTestDb();
  try {
    const insert = db.prepare(`
      INSERT INTO validation_suite_scores (model, suite, score, validated_at)
      VALUES (?, 'chat', 0.7, '2026-08-08T00:00:00.000Z')
    `);
    const registry = createRegistry(db);

    insert.run('identity-fixture:latest');
    insert.run('identity-fixture');
    const latestFirst = registry.getAllValidationScores()['identity-fixture'].chat;

    db.prepare('DELETE FROM validation_suite_scores').run();
    insert.run('identity-fixture');
    insert.run('identity-fixture:latest');
    const bareFirst = registry.getAllValidationScores()['identity-fixture'].chat;

    assertEqual(latestFirst.sourceModel, 'identity-fixture');
    assertEqual(bareFirst.sourceModel, 'identity-fixture');
    assertEqual(JSON.stringify(latestFirst.identityAliases), JSON.stringify([
      'identity-fixture',
      'identity-fixture:latest',
    ]));
    assertEqual(JSON.stringify(bareFirst), JSON.stringify(latestFirst));
    assertEqual(latestFirst.artifactVerified, false);
  } finally {
    db.close();
  }
});

await testAsync('outer auto-cleanup skips bound, validating, and recently used aliases', async () => {
  const db = createTestDb();
  try {
    config.models.CHAT = 'bound-model';
    config.models.D1 = 'reverse-bound-model:latest';
    db.prepare(`
      INSERT INTO model_usage (model, role, used_at, request_type)
      VALUES ('recent-model', 'CHAT', datetime('now'), 'answer')
    `).run();
    db.prepare(`
      INSERT INTO model_usage (model, role, used_at, request_type)
      VALUES ('old-unbound-model', 'CHAT', '2025-01-01 00:00:00', 'answer')
    `).run();
    const registry = createRegistry(db);
    registry._validatingModel = 'validating-model';
    registry.getInstalled = async () => [
      installedModel('bound-model:latest'),
      installedModel('reverse-bound-model'),
      installedModel('validating-model:latest'),
      installedModel('recent-model:latest'),
      installedModel('old-unbound-model:latest'),
    ];
    const deleteCalls = [];
    registry.deleteModel = async name => {
      deleteCalls.push(name);
      return { ok: true, freedGB: '1.0' };
    };

    const deleted = await registry.runAutoCleanup(14);
    assertEqual(JSON.stringify(deleteCalls), JSON.stringify(['old-unbound-model:latest']));
    assertEqual(deleted.length, 1);

    registry._validatingModel = 'reverse-validating-model:latest';
    registry.getInstalled = async () => [installedModel('reverse-validating-model')];
    deleteCalls.length = 0;
    const reverseValidatingDeleted = await registry.runAutoCleanup(14);
    assertEqual(deleteCalls.length, 0);
    assertEqual(reverseValidatingDeleted.length, 0);
  } finally {
    db.close();
    restoreBindings();
  }
});

await testAsync('auto-cleanup parses every UTC usage row and is strict and fail-closed at cutoff', async () => {
  const db = createTestDb();
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);
  const insertUsage = db.prepare(`
    INSERT INTO model_usage (model, role, used_at, request_type)
    VALUES (?, 'CHAT', ?, 'answer')
  `);
  try {
    insertUsage.run('before-cutoff', '2026-07-26 11:59:59');
    insertUsage.run('equal-cutoff', '2026-07-26 12:00:00');
    insertUsage.run('after-cutoff', '2026-07-26 12:00:01');
    insertUsage.run('mixed-format', '2026-07-26T01:00:00.000Z');
    insertUsage.run('mixed-format:latest', '2026-07-26 23:00:00');
    insertUsage.run('invalid-time', 'not-a-timestamp');
    insertUsage.run('fresh-modified', '2026-07-01 00:00:00');

    const oldModified = '2026-07-01T00:00:00.000Z';
    const registry = createRegistry(db, { clock: () => now });
    registry.getInstalled = async () => [
      installedModel('before-cutoff:latest', undefined, oldModified),
      installedModel('equal-cutoff:latest', undefined, oldModified),
      installedModel('after-cutoff:latest', undefined, oldModified),
      installedModel('mixed-format:latest', undefined, oldModified),
      installedModel('invalid-time:latest', undefined, oldModified),
      installedModel('fresh-modified:latest', undefined, '2026-08-01T00:00:00.000Z'),
      installedModel('old-no-usage', undefined, oldModified),
      installedModel('old-no-usage:latest', undefined, oldModified),
      installedModel('missing-modified:latest', undefined, null),
    ];
    const deleteCalls = [];
    registry.deleteModel = async (name, options) => {
      deleteCalls.push({ name, options });
      return { ok: true, deleted: name, digestSha256: DIGEST_A, freedGB: '1.0' };
    };

    const deleted = await registry.runAutoCleanup(14);
    assertEqual(JSON.stringify(deleteCalls.map(call => call.name)), JSON.stringify([
      'before-cutoff:latest',
    ]));
    assertEqual(deleteCalls.every(call => call.options.source === 'AUTO_CLEANUP'), true);
    assertEqual(deleteCalls.every(call => call.options.expectedDigestSha256 === DIGEST_A), true);
    assertEqual(deleted.length, 1);

    db.exec('DROP TABLE model_usage');
    registry.getInstalled = async () => [installedModel('usage-read-failure', undefined, oldModified)];
    deleteCalls.length = 0;
    const failedRead = await registry.runAutoCleanup(14);
    assertEqual(failedRead.length, 0);
    assertEqual(deleteCalls.length, 0);
  } finally {
    db.close();
    restoreBindings();
  }
});

await testAsync('overlapping cleanup tick fails typed before a second inventory effect', async () => {
  const db = createTestDb();
  let releaseInventory;
  let inventoryStarted;
  const entered = new Promise(resolve => { inventoryStarted = resolve; });
  const gate = new Promise(resolve => { releaseInventory = resolve; });
  let inventoryCalls = 0;
  try {
    const registry = createRegistry(db, { clock: () => Date.UTC(2026, 7, 9, 12, 0, 0) });
    registry.getInstalled = async () => {
      inventoryCalls += 1;
      inventoryStarted();
      await gate;
      return [];
    };

    const first = registry.runAutoCleanup(14);
    await entered;
    const overlapError = await captureError(registry.runAutoCleanup(14));
    assertEqual(overlapError.code, 'MODEL_CLEANUP_BUSY');
    assertEqual(overlapError.httpStatus, 409);
    assertEqual(inventoryCalls, 1);

    releaseInventory();
    assertEqual((await first).length, 0);
    assertEqual((await registry.runAutoCleanup(14)).length, 0);
    assertEqual(inventoryCalls, 2);
  } finally {
    db.close();
  }
});

await testAsync('single-model validation reserves its model and releases on terminal completion', async () => {
  const db = createTestDb();
  let releaseValidation;
  let validationStarted;
  const started = new Promise(resolve => { validationStarted = resolve; });
  const gate = new Promise(resolve => { releaseValidation = resolve; });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('delete must not reach provider while validation is active');
  };
  try {
    const registry = createRegistry(db, {
      validationRunner: {
        async runAll() {
          validationStarted();
          await gate;
          return { overallScore: 1, results: [] };
        },
      },
    });
    const validation = registry.startValidation('validation-fixture:latest', ['reasoning'], () => {});
    await started;
    assertEqual(registry.isValidating(), true);
    const deleteError = await captureError(registry.deleteModel('validation-fixture'));
    assertEqual(deleteError.code, 'MODEL_DELETE_VALIDATING');
    assertEqual(fetchCount, 0);

    releaseValidation();
    const result = await validation.completion;
    assertEqual(result.overallScore, 1);
    assertEqual(registry.isValidating(), false);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('live validation route acquires the registry reservation before reporting started', async () => {
  const db = createTestDb();
  const responses = [];
  const calls = [];
  const events = [];
  try {
    const routes = createSystemRoutes({
      db,
      modelRegistry: {
        startValidation(model, suites) {
          events.push('reserved');
          calls.push({ model, suites });
          return {
            completion: Promise.resolve({ overallScore: 1, results: [] }),
          };
        },
      },
      broadcastValidation: (_channel, payload) => events.push(`broadcast:${payload.status}`),
      parseBody: async () => ({ model: 'validation-route-fixture', suite: 'reasoning' }),
      sendJSON: (_res, status, body) => {
        events.push(`response:${status}`);
        responses.push({ status, body });
      },
    });
    await routes['POST /api/system/models/validate']({}, {});
    await new Promise(resolve => setImmediate(resolve));
    assertEqual(JSON.stringify(calls), JSON.stringify([{
      model: 'validation-route-fixture',
      suites: ['reasoning'],
    }]));
    assertEqual(responses.length, 1);
    assertEqual(responses[0].status, 200);
    assertEqual(responses[0].body.status, 'started');
    assertEqual(
      JSON.stringify(events.slice(0, 3)),
      JSON.stringify(['reserved', 'broadcast:starting', 'response:200']),
    );

    const rejectedBroadcasts = [];
    const rejectedResponses = [];
    const rejectedRoutes = createSystemRoutes({
      db,
      modelRegistry: {
        startValidation() {
          throw Object.assign(new Error('validation busy'), { httpStatus: 409 });
        },
      },
      broadcastValidation: (_channel, payload) => rejectedBroadcasts.push(payload),
      parseBody: async () => ({ model: 'validation-route-fixture', suite: 'reasoning' }),
      sendJSON: (_res, status, body) => rejectedResponses.push({ status, body }),
    });
    await rejectedRoutes['POST /api/system/models/validate']({}, {});
    assertEqual(rejectedBroadcasts.length, 0);
    assertEqual(JSON.stringify(rejectedResponses), JSON.stringify([{
      status: 409,
      body: { error: 'validation busy' },
    }]));
  } finally {
    db.close();
  }
});

test('getUnusedOldModels is canonical-deduped, null-free and newest-first', () => {
  const db = createTestDb();
  try {
    const manager = new UpgradeManager();
    manager.setDb(db);
    for (const role of Object.keys(config.models)) config.models[role] = `bound-${role.toLowerCase()}`;
    config.models.R2 = 'bound-alias';
    config.models.CHAT = 'identity-fixture';
    config.models.VISION = 'reverse-identity-fixture:latest';
    const insert = db.prepare(`
      INSERT OR REPLACE INTO model_overrides (role, model, previous_model, applied_at)
      VALUES (?, ?, ?, ?)
    `);
    insert.run('D1', 'replacement-d1', null, '2026-08-08 12:00:00');
    insert.run('D2', 'replacement-d2', '   ', '2026-08-08 11:00:00');
    insert.run('CODE', 'replacement-code', 'orphan-model', '2026-08-08 10:00:00');
    insert.run('R1', 'replacement-r1', 'ORPHAN-MODEL:latest', '2026-08-07 10:00:00');
    insert.run('R2', 'replacement-r2', 'bound-alias:latest', '2026-08-08 09:00:00');
    insert.run('CHAT', 'replacement-chat', 'identity-fixture:latest', '2026-08-08 08:00:00');
    insert.run('VISION', 'replacement-vision', 'reverse-identity-fixture', '2026-08-08 07:00:00');

    const unused = manager.getUnusedOldModels();
    assertEqual(unused.length, 1);
    assertEqual(unused[0].model, 'orphan-model');
    assertEqual(unused[0].replacedBy, 'replacement-code');
    assertEqual(unused[0].role, 'CODE');
    assertEqual(unused[0].appliedAt, '2026-08-08 10:00:00');
  } finally {
    db.close();
    restoreBindings();
  }
});

await testAsync('route without deletion authority fails closed and live registry blocks aliases', async () => {
  const db = createTestDb();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return { ok: true, status: 200 };
  };
  try {
    const responses = [];
    const routes = createSystemRoutes({
      db,
      modelRegistry: null,
      parseBody: async () => ({}),
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });
    const invoke = name => routes['DELETE /api/system/models']({
      url: `/api/system/models?name=${encodeURIComponent(name)}`,
      headers: { host: '127.0.0.1:3335' },
    }, {});

    config.models.CHAT = 'identity-fixture';
    await invoke('identity-fixture:latest');
    config.models.CHAT = 'identity-fixture:latest';
    await invoke('identity-fixture');

    const liveRegistry = createRegistry(db);
    const liveResponses = [];
    const liveRoutes = createSystemRoutes({
      db,
      modelRegistry: liveRegistry,
      parseBody: async () => ({}),
      sendJSON: (_res, status, body) => liveResponses.push({ status, body }),
    });
    config.models.CHAT = 'live-identity-fixture';
    await liveRoutes['DELETE /api/system/models']({
      url: '/api/system/models?name=live-identity-fixture%3Alatest',
      headers: { host: '127.0.0.1:3335' },
    }, {});

    const publicResponses = [];
    const publicRoutes = createSystemRoutes({
      db,
      modelRegistry: {
        async deleteModel(name, options) {
          assertEqual(name, 'public-fixture');
          assertEqual(JSON.stringify(options), JSON.stringify({ source: 'USER_HTTP' }));
          return {
            ok: true,
            deleted: 'public-fixture:latest',
            freedGB: '1.0',
            canonicalName: 'public-fixture',
            digestSha256: DIGEST_A,
            source: 'USER_HTTP',
          };
        },
      },
      parseBody: async () => ({}),
      sendJSON: (_res, status, body) => publicResponses.push({ status, body }),
    });
    await publicRoutes['DELETE /api/system/models']({
      url: '/api/system/models?name=public-fixture',
      headers: { host: '127.0.0.1:3335' },
    }, {});

    assertEqual(JSON.stringify(responses.map(item => item.status)), JSON.stringify([503, 503]));
    assertEqual(responses.every(item => item.body.error === 'Model deletion authority is unavailable'), true);
    assertEqual(JSON.stringify(liveResponses.map(item => item.status)), JSON.stringify([409]));
    assertEqual(JSON.stringify(publicResponses), JSON.stringify([{
      status: 200,
      body: { ok: true, deleted: 'public-fixture:latest', freedGB: '1.0' },
    }]));
    assertEqual(fetchCount, 0);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

suite('M1 model identity — recommendation and detection-only integrity');

test('candidate filtering excludes current and blocked aliases', () => {
  const profile = {
    requirements: { minParams: 1, maxParams: 20 },
    preferredFamilies: ['fixture'],
    preferredCategories: ['general'],
    getCurrentModel: () => 'current-model',
  };
  const candidates = [
    { name: 'current-model:latest', params: 7, family: 'fixture', category: 'general' },
    { name: 'blocked-model:latest', params: 7, family: 'fixture', category: 'general' },
    { name: 'allowed-model:latest', params: 7, family: 'fixture', category: 'general' },
  ];
  const result = filterCandidates(candidates, profile, {
    blockedModels: new Set(['BLOCKED-MODEL']),
  });
  assertEqual(JSON.stringify(result.map(item => item.name)), JSON.stringify(['allowed-model:latest']));
});

await testAsync('applyUpgrade treats an installed active latest alias as the same model', async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: 'active-model:latest' },
          { name: 'reverse-active-model' },
        ],
      }),
    };
  };
  try {
    config.models.D1 = 'active-model';
    const manager = new UpgradeManager();
    const error = await captureError(manager.applyUpgrade('D1', 'active-model:latest'));
    assert(error.message.includes('already set'));
    assertEqual(config.models.D1, 'active-model');

    config.models.D1 = 'reverse-active-model:latest';
    const reverseError = await captureError(manager.applyUpgrade('D1', 'reverse-active-model'));
    assert(reverseError.message.includes('already set'));
    assertEqual(config.models.D1, 'reverse-active-model:latest');
    assertEqual(fetchCount, 2);
  } finally {
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

test('recommendation never recommends the current logical alias to itself', () => {
  const db = createTestDb();
  try {
    config.models.D1 = 'current-reasoner';
    const insert = db.prepare(`
      INSERT INTO validation_suite_scores (model, suite, score, validated_at)
      VALUES (?, 'reasoning', ?, ?)
    `);
    insert.run('current-reasoner', 0.7, '2026-08-01T00:00:00.000Z');
    insert.run('current-reasoner:latest', 0.99, '2026-08-08T00:00:00.000Z');
    insert.run('other-reasoner:latest', 0.9, '2026-08-08T00:00:00.000Z');
    const registry = createRegistry(db);
    const recommendation = registry.getRecommendation('D1');
    assertEqual(recommendation, null);
  } finally {
    db.close();
    restoreBindings();
  }
});

await testAsync('latest alias is present even when its digest changed', async () => {
  const db = createTestDb();
  let assignCalls = 0;
  let broadcastCalls = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected provider effect');
  };
  try {
    const bindings = Object.keys(config.models).map((role, index) => {
      const bare = `bound-${role.toLowerCase()}`;
      const configured = index % 2 === 0 ? bare : `${bare}:latest`;
      const installed = index % 2 === 0 ? `${bare}:latest` : bare;
      config.models[role] = configured;
      return { role, installed };
    });
    const registry = createRegistry(db, {
      upgradeManager: { applyUpgrade: async () => { assignCalls += 1; } },
      broadcast: () => { broadcastCalls += 1; },
    });
    registry.getInstalled = async () => bindings.map(({ role, installed }) => (
      installedModel(installed, `sha256:changed-${role.toLowerCase()}`)
    ));

    const report = await registry.checkBindingIntegrity();
    assertEqual(report.scanStatus, 'COMPLETE');
    assertEqual(report.findings.length, 0);
    assertEqual(assignCalls, 0);
    assertEqual(broadcastCalls, 0);
    assertEqual(fetchCount, 0);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('truly missing binding produces one proposal and zero mutations', async () => {
  const db = createTestDb();
  let assignCalls = 0;
  let broadcastCalls = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected provider effect');
  };
  try {
    for (const role of Object.keys(config.models)) config.models[role] = 'stable-shared';
    config.models.D1 = 'missing-reasoner';
    db.prepare(`
      INSERT INTO validation_suite_scores (model, suite, score, validated_at)
      VALUES ('candidate-reasoner', 'reasoning', 0.95, '2026-08-08T00:00:00.000Z')
    `).run();
    const registry = createRegistry(db, {
      upgradeManager: {
        applyUpgrade: async () => {
          assignCalls += 1;
          db.prepare(`
            INSERT OR REPLACE INTO model_overrides (role, model, previous_model)
            VALUES ('D1', 'candidate-reasoner', 'missing-reasoner')
          `).run();
          return { ok: true };
        },
      },
      broadcast: () => { broadcastCalls += 1; },
    });
    registry.getInstalled = async () => [
      installedModel('stable-shared:latest'),
      installedModel('candidate-reasoner:latest', 'sha256:candidate-digest'),
    ];
    const beforeBindings = JSON.stringify(config.models);
    const beforeDbChanges = db.prepare('SELECT total_changes() AS count').get().count;

    const report = await registry.checkBindingIntegrity();
    assertEqual(report.scanStatus, 'COMPLETE');
    assertEqual(report.findings.length, 1);
    assertEqual(report.findings[0].role, 'D1');
    assertEqual(report.findings[0].state, 'PROPOSED');
    assertEqual(report.findings[0].candidate.model, 'candidate-reasoner:latest');
    assertEqual(report.findings[0].candidate.digest, 'sha256:candidate-digest');
    assertEqual(assignCalls, 0);
    assertEqual(broadcastCalls, 0);
    assertEqual(fetchCount, 0);
    assertEqual(db.prepare('SELECT total_changes() AS count').get().count, beforeDbChanges);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_overrides').get().count, 0);
    assertEqual(JSON.stringify(config.models), beforeBindings);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('missing binding without a candidate stays detected with zero mutations', async () => {
  const db = createTestDb();
  let assignCalls = 0;
  let broadcastCalls = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected provider effect');
  };
  try {
    for (const role of Object.keys(config.models)) config.models[role] = 'stable-shared';
    config.models.D1 = 'missing-without-candidate';
    const registry = createRegistry(db, {
      upgradeManager: { applyUpgrade: async () => { assignCalls += 1; } },
      broadcast: () => { broadcastCalls += 1; },
    });
    registry.getInstalled = async () => [installedModel('stable-shared:latest')];
    const beforeBindings = JSON.stringify(config.models);
    const beforeDbChanges = db.prepare('SELECT total_changes() AS count').get().count;

    const report = await registry.checkBindingIntegrity();
    assertEqual(report.scanStatus, 'COMPLETE');
    assertEqual(report.findings.length, 1);
    assertEqual(report.findings[0].role, 'D1');
    assertEqual(report.findings[0].state, 'DETECTED');
    assertEqual(report.findings[0].candidate, null);
    assertEqual(assignCalls, 0);
    assertEqual(broadcastCalls, 0);
    assertEqual(fetchCount, 0);
    assertEqual(db.prepare('SELECT total_changes() AS count').get().count, beforeDbChanges);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_overrides').get().count, 0);
    assertEqual(JSON.stringify(config.models), beforeBindings);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('empty Ollama inventory is inconclusive, not uninstall evidence', async () => {
  const db = createTestDb();
  let assignCalls = 0;
  let broadcastCalls = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected provider effect');
  };
  try {
    const registry = createRegistry(db, {
      upgradeManager: { applyUpgrade: async () => { assignCalls += 1; } },
      broadcast: () => { broadcastCalls += 1; },
    });
    registry.getInstalled = async () => [];
    const report = await registry.checkBindingIntegrity();
    assertEqual(report.scanStatus, 'INCONCLUSIVE');
    assertEqual(report.reason, 'OLLAMA_UNAVAILABLE_OR_EMPTY');
    assertEqual(report.findings.length, 0);
    assertEqual(assignCalls, 0);
    assertEqual(broadcastCalls, 0);
    assertEqual(fetchCount, 0);
  } finally {
    db.close();
    restoreBindings();
    globalThis.fetch = originalFetch;
  }
});

restoreBindings();
if (config.ollama) config.ollama.baseUrl = originalBaseUrl;
globalThis.fetch = originalFetch;
summary();
