#!/usr/bin/env node

import Database from 'better-sqlite3';
import {
  assert, assertEqual, suite, summary, test, testAsync,
} from './harness.js';
import { config } from '../src/config.js';
import {
  canonicalModelName,
  canonicalModelNameSet,
  modelNameAliases,
  normalizeModelDigestSha256,
  sameModelName,
} from '../src/upgrade/model-identity.js';
import {
  AUTO_CLEANUP_MIN_FREE_BYTES,
  ModelRegistry,
} from '../src/upgrade/model-registry.js';
import { createSystemRoutes } from '../src/routes/system.js';
import { up as installAutomationPolicy } from '../src/db/migrations/2026_08_22_066_model_automation_policy.js';
import {
  POLICY_SOURCE,
  readModelAutomationPolicy,
  updateModelAutomationPolicy,
} from '../src/db/model-policy.js';

const originalFetch = globalThis.fetch;
const originalBindings = { ...config.models };
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const GiB = 1_073_741_824;

function restoreBindings() {
  for (const role of Object.keys(config.models)) delete config.models[role];
  Object.assign(config.models, originalBindings);
}

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      model_digest_sha256 TEXT,
      role TEXT NOT NULL,
      used_at TEXT NOT NULL,
      request_type TEXT
    );
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  installAutomationPolicy(db);
  return db;
}

function installedModel(name, digestSha256 = DIGEST_A, modifiedAt = '2025-01-01T00:00:00.000Z') {
  return {
    name,
    digest: `sha256:${digestSha256}`,
    digestSha256,
    size: GiB,
    sizeGB: '1.0',
    modified_at: modifiedAt,
    params: '7B',
    family: 'fixture',
    category: 'general',
    quantization: 'Q4_K_M',
  };
}

function completeEvaluationReadModel() {
  return {
    read({ inventory, bindings, bindingAuthority }) {
      const models = inventory.map(model => ({
        name: model.name,
        canonicalName: canonicalModelName(model.name),
        digestSha256: model.digestSha256,
        evaluations: {
          CHAT: Object.freeze({
            status: 'COMPLETE',
            score: 0.875,
            testedAt: '2026-08-24T12:00:00.000Z',
            modelDigestSha256: model.digestSha256,
            suiteName: 'chat_v3',
            suiteContractSha256: 'c'.repeat(64),
          }),
        },
      }));
      return {
        authority: 'model_evaluation_runs',
        bindingAuthority: bindingAuthority || { status: 'TEST' },
        bindings,
        models,
        roles: {},
        statusCounts: { COMPLETE: models.length, FAILED: 0, BLOCKED: 0, MISSING: 0 },
      };
    },
  };
}

function createRegistry(db, opts = {}) {
  const registry = new ModelRegistry();
  registry.init({
    db,
    modelBindingApplication: opts.modelBindingApplication || {
      getProtectedModelNames: () => [],
      runExclusiveModelMutation: async (_input, callback) => callback(),
      applyManualBinding: async () => ({ ok: true }),
    },
    bindingRepository: opts.bindingRepository || null,
    modelEvaluationReadModel: opts.modelEvaluationReadModel || completeEvaluationReadModel(),
    broadcast: opts.broadcast || (() => {}),
    clock: opts.clock,
    modelStorageFreeBytes: opts.modelStorageFreeBytes || (() => 20 * GiB),
  });
  return registry;
}

async function captureError(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error('expected promise to reject');
}

suite('current model identity');

test('only bare and implicit latest aliases share an identity', () => {
  assertEqual(canonicalModelName(' Fixture:latest '), 'fixture');
  assert(sameModelName('fixture', 'FIXTURE:latest'));
  assertEqual(sameModelName('fixture:7b', 'fixture:8b'), false);
  assertEqual(JSON.stringify(modelNameAliases('fixture')), JSON.stringify(['fixture', 'fixture:latest']));
  assertEqual(JSON.stringify([...canonicalModelNameSet(['fixture', 'FIXTURE:latest'])]), JSON.stringify(['fixture']));
});

test('artifact digests are exact normalized sha256 values', () => {
  assertEqual(normalizeModelDigestSha256(DIGEST_A), DIGEST_A);
  assertEqual(normalizeModelDigestSha256(`SHA256:${DIGEST_A.toUpperCase()}`), DIGEST_A);
  assertEqual(normalizeModelDigestSha256(`sha256:${DIGEST_A.slice(1)}`), null);
  assertEqual(normalizeModelDigestSha256(`sha512:${DIGEST_A}`), null);
});

suite('registry binding and deletion authority');

await testAsync('bound aliases are blocked before provider effects', async () => {
  const db = createTestDb();
  let effects = 0;
  globalThis.fetch = async () => { effects += 1; throw new Error('unexpected effect'); };
  try {
    config.models.CHAT = 'bound-fixture';
    const registry = createRegistry(db);
    assertEqual(registry.isDeletable('BOUND-FIXTURE:latest').deletable, false);
    const error = await captureError(registry.deleteModel('bound-fixture:latest'));
    assertEqual(error.code, 'MODEL_DELETE_BOUND');
    assertEqual(effects, 0);
  } finally {
    db.close(); restoreBindings(); globalThis.fetch = originalFetch;
  }
});

await testAsync('desired and rollback protections are canonical and fail before inventory', async () => {
  const db = createTestDb();
  let effects = 0;
  globalThis.fetch = async () => { effects += 1; throw new Error('unexpected effect'); };
  try {
    for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
    const registry = createRegistry(db, {
      modelBindingApplication: {
        getProtectedModelNames: () => ['desired-fixture:latest', 'rollback-fixture'],
        runExclusiveModelMutation: async (_input, callback) => callback(),
      },
    });
    assertEqual((await captureError(registry.deleteModel('desired-fixture'))).code,
      'MODEL_DELETE_BINDING_PROTECTED');
    assertEqual((await captureError(registry.prepareDeletePlans(['rollback-fixture:latest']))).code,
      'MODEL_DELETE_BINDING_PROTECTED');
    assertEqual(effects, 0);
  } finally {
    db.close(); restoreBindings(); globalThis.fetch = originalFetch;
  }
});

await testAsync('delete revalidates exact provider name and digest before one effect', async () => {
  async function scenario(second) {
    const db = createTestDb();
    let inventoryCalls = 0;
    const deletes = [];
    const first = [{ name: 'delete-fixture:latest', digest: `sha256:${DIGEST_A}`, size: GiB }];
    try {
      for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
      globalThis.fetch = async (url, request = {}) => {
        if (url.endsWith('/api/tags')) {
          const models = inventoryCalls++ === 0 ? first : second;
          return { ok: true, status: 200, json: async () => ({ models }) };
        }
        if (url.endsWith('/api/delete')) {
          deletes.push(JSON.parse(request.body));
          return { ok: true, status: 200 };
        }
        throw new Error(`unexpected URL ${url}`);
      };
      const registry = createRegistry(db);
      try {
        return { result: await registry.deleteModel('delete-fixture', {
          source: 'USER_HTTP', expectedDigestSha256: DIGEST_A,
        }), deletes };
      } catch (error) { return { error, deletes }; }
    } finally {
      db.close(); restoreBindings(); globalThis.fetch = originalFetch;
    }
  }

  const stable = await scenario([
    { name: 'delete-fixture:latest', digest: `sha256:${DIGEST_A}`, size: GiB },
  ]);
  assertEqual(stable.result.digestSha256, DIGEST_A);
  assertEqual(JSON.stringify(stable.deletes), JSON.stringify([{ name: 'delete-fixture:latest' }]));

  const drift = await scenario([
    { name: 'delete-fixture:latest', digest: `sha256:${DIGEST_B}`, size: GiB },
  ]);
  assertEqual(drift.error.code, 'MODEL_DELETE_ARTIFACT_DRIFT');
  assertEqual(drift.deletes.length, 0);
});

suite('registry evaluation and retention read path');

await testAsync('overview exposes exact evaluation score, digest and timestamp', async () => {
  const db = createTestDb();
  try {
    for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
    config.models.CHAT = 'evaluated-fixture';
    db.prepare(`
      INSERT INTO model_usage (model, model_digest_sha256, role, used_at, request_type)
      VALUES ('evaluated-fixture:latest', ?, 'CHAT', '2026-08-24T11:00:00.000Z', 'answer')
    `).run(DIGEST_A);
    const registry = createRegistry(db);
    registry.getInstalled = async () => [installedModel('evaluated-fixture:latest')];
    const overview = await registry.getOverview();
    const row = overview.models[0];
    assertEqual(row.evaluations.CHAT.status, 'COMPLETE');
    assertEqual(row.evaluations.CHAT.score, 0.875);
    assertEqual(row.evaluations.CHAT.modelDigestSha256, DIGEST_A);
    assertEqual(row.evaluations.CHAT.testedAt, '2026-08-24T12:00:00.000Z');
    assertEqual(row.requestCount, 1);
    assertEqual(overview.evaluations.authority, 'model_evaluation_runs');
  } finally { db.close(); restoreBindings(); }
});

await testAsync('overview fails closed without the evaluation read authority', async () => {
  const db = createTestDb();
  try {
    const registry = createRegistry(db, { modelEvaluationReadModel: { read: null } });
    registry.getInstalled = async () => [];
    const error = await captureError(registry.getOverview());
    assertEqual(error.code, 'MODEL_EVALUATION_READ_AUTHORITY_REQUIRED');
  } finally { db.close(); }
});

await testAsync('cleanup requires disk pressure, exact-digest usage and COMPLETE evaluation', async () => {
  const db = createTestDb();
  const old = '2026-07-01T00:00:00.000Z';
  try {
    for (const role of Object.keys(config.models)) config.models[role] = `safe-${role.toLowerCase()}`;
    db.prepare(`
      INSERT INTO model_usage (model, model_digest_sha256, role, used_at, request_type)
      VALUES ('retention-fixture', ?, 'CHAT', '2026-07-01 00:00:00', 'answer')
    `).run(DIGEST_A);
    const deleted = [];
    const registry = createRegistry(db, {
      clock: () => Date.UTC(2026, 7, 24, 12, 0, 0),
      modelStorageFreeBytes: () => AUTO_CLEANUP_MIN_FREE_BYTES - 1,
    });
    registry.getInstalled = async () => [installedModel('retention-fixture', DIGEST_A, old)];
    registry.deleteModel = async (name, options) => {
      deleted.push({ name, options });
      return { deleted: name, freedGB: '1.0' };
    };
    assertEqual((await registry.runAutoCleanup(14)).length, 1);
    assertEqual(deleted[0].options.expectedDigestSha256, DIGEST_A);

    deleted.length = 0;
    registry._evaluationReadModel = { read: () => ({
      models: [{ evaluations: { CHAT: { status: 'BLOCKED' } } }],
    }) };
    assertEqual((await registry.runAutoCleanup(14)).length, 0);
    assertEqual(deleted.length, 0);

    registry._evaluationReadModel = completeEvaluationReadModel();
    db.prepare('UPDATE model_usage SET model_digest_sha256 = NULL').run();
    assertEqual((await registry.runAutoCleanup(14)).length, 0);
  } finally { db.close(); restoreBindings(); }
});

await testAsync('automation scheduler reads only typed policy storage', async () => {
  const db = createTestDb();
  try {
    db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      models: { autoCleanupEnabled: true, autoCleanupDays: 30 },
    }));
    const registry = createRegistry(db);
    const calls = [];
    registry.runAutoCleanup = async days => { calls.push(days); return []; };
    assertEqual((await registry.runConfiguredAutoCleanup()).status, 'SKIPPED_DISABLED');
    updateModelAutomationPolicy(db, {
      values: { autoCleanupEnabled: true, autoCleanupDays: 30 },
      expectedRevision: readModelAutomationPolicy(db).revision,
      actor: 'test', source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const result = await registry.runConfiguredAutoCleanup();
    assertEqual(result.status, 'COMPLETED');
    assertEqual(JSON.stringify(calls), JSON.stringify([30]));
  } finally { db.close(); }
});

suite('registry route and integrity boundaries');

await testAsync('delete route fails closed without registry authority', async () => {
  const db = createTestDb();
  try {
    const responses = [];
    const routes = createSystemRoutes({
      db, modelRegistry: null, parseBody: async () => ({}),
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });
    await routes['DELETE /api/system/models']({
      url: '/api/system/models?name=fixture', headers: { host: '127.0.0.1' },
    }, {});
    assertEqual(responses[0].status, 503);
  } finally { db.close(); }
});

await testAsync('missing binding is detection-only and never invents a scored replacement', async () => {
  const db = createTestDb();
  try {
    for (const role of Object.keys(config.models)) config.models[role] = 'stable-shared';
    config.models.D1 = 'missing-reasoner';
    const registry = createRegistry(db);
    registry.getInstalled = async () => [
      installedModel('stable-shared:latest'), installedModel('unrelated-candidate:latest'),
    ];
    const before = JSON.stringify(config.models);
    const report = await registry.checkBindingIntegrity();
    assertEqual(report.scanStatus, 'COMPLETE');
    assertEqual(report.findings.length, 1);
    assertEqual(report.findings[0].state, 'DETECTED');
    assertEqual(report.findings[0].candidate, null);
    assertEqual(JSON.stringify(config.models), before);
  } finally { db.close(); restoreBindings(); }
});

restoreBindings();
globalThis.fetch = originalFetch;
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
