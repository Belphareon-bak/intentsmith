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
  sameModelName,
} from '../src/upgrade/model-identity.js';
import { ModelRegistry } from '../src/upgrade/model-registry.js';
import {
  UpgradeManager,
  filterCandidates,
} from '../src/upgrade/upgrade-manager.js';
import { createSystemRoutes } from '../src/routes/system.js';

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
  `);
  return db;
}

function createRegistry(db, { upgradeManager, broadcast } = {}) {
  const registry = new ModelRegistry();
  registry.init({
    db,
    upgradeManager: upgradeManager || { applyUpgrade: async () => ({ ok: true }) },
    validationRunner: null,
    broadcast: broadcast || (() => {}),
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

function installedModel(name, digest = `sha256:${name}`) {
  return {
    name,
    digest,
    size: 1_073_741_824,
    sizeGB: '1.0',
    modified_at: '2025-01-01T00:00:00.000Z',
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
    assert(boundError.message.includes('přiřazený'));

    config.models.CHAT = 'identity-fixture:latest';
    assert(registry.isBound('identity-fixture'));
    assert(registry.getBoundRoles('identity-fixture').includes('CHAT'));
    assertEqual(registry.isDeletable('identity-fixture').deletable, false);
    const reverseBoundError = await captureError(registry.deleteModel('identity-fixture'));
    assert(reverseBoundError.message.includes('přiřazený'));

    config.models.CHAT = 'another-model';
    registry._validatingModel = 'identity-fixture';
    assertEqual(registry.isDeletable('identity-fixture:latest').deletable, false);
    const validatingError = await captureError(registry.deleteModel('identity-fixture:latest'));
    assert(validatingError.message.includes('validován'));

    registry._validatingModel = 'identity-fixture:latest';
    assertEqual(registry.isDeletable('identity-fixture').deletable, false);
    const reverseValidatingError = await captureError(registry.deleteModel('identity-fixture'));
    assert(reverseValidatingError.message.includes('validován'));
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

test('getUnusedOldModels protects both bare/latest binding directions', () => {
  const db = createTestDb();
  try {
    const manager = new UpgradeManager();
    manager.setDb(db);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO model_overrides (role, model, previous_model)
      VALUES ('D1', 'replacement-model', ?)
    `);

    config.models.CHAT = 'identity-fixture';
    insert.run('identity-fixture:latest');
    assertEqual(manager.getUnusedOldModels().length, 0);

    config.models.CHAT = 'identity-fixture:latest';
    insert.run('identity-fixture');
    assertEqual(manager.getUnusedOldModels().length, 0);
  } finally {
    db.close();
    restoreBindings();
  }
});

await testAsync('fallback and live registry routes block bound aliases before fetch', async () => {
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

    assertEqual(JSON.stringify(responses.map(item => item.status)), JSON.stringify([409, 409]));
    assertEqual(JSON.stringify(liveResponses.map(item => item.status)), JSON.stringify([409]));
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
