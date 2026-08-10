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
  test,
  testAsync,
} from './harness.js';
import {
  _testInternals as migrationInternals,
  runMigrations,
} from '../src/db/migrate.js';
import { up as migrateModelPolicy } from '../src/db/migrations/2026_08_09_061_model_automation_policy.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createSystemRoutes } from '../src/routes/system.js';
import {
  DEFAULT_MODEL_AUTOMATION_POLICY,
  ModelAutomationPolicyError,
  ModelAutomationPolicyStatus,
  createModelAutomationPolicyRepository,
  readModelAutomationPolicy,
} from '../src/db/model-policy.js';

const MODEL_POLICY_WAL_WORKER_SOURCE = String.raw`
const Database = require('better-sqlite3');
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  const { createModelAutomationPolicyRepository } = await import(workerData.repositoryUrl);
  const db = new Database(workerData.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    const repository = createModelAutomationPolicyRepository(db, {
      clock: () => workerData.createdAtMs,
      ids: {
        event: () => workerData.prefix + '-policy-event-0001',
        request: () => workerData.prefix + '-policy-request-0001',
      },
    });
    const observedRevision = repository.read().revision;
    Atomics.add(workerData.barrier, 0, 1);
    Atomics.notify(workerData.barrier, 0);
    Atomics.wait(workerData.barrier, 1, 0);
    try {
      const committed = repository.updateFromTypedApi({
        expectedRevision: observedRevision,
        autoFailoverEnabled: true,
        autoCleanupEnabled: false,
        autoCleanupDays: workerData.cleanupDays,
      });
      parentPort.postMessage({
        kind: 'COMMITTED',
        observedRevision,
        revision: committed.revision,
        cleanupDays: committed.settings.autoCleanupDays,
        eventId: committed.lastEventId,
      });
    } catch (error) {
      parentPort.postMessage({
        kind: 'ERROR',
        observedRevision,
        code: error && error.code || null,
        message: error && error.message || String(error),
      });
    }
  } finally {
    db.close();
  }
})().catch(error => {
  parentPort.postMessage({
    kind: 'WORKER_ERROR',
    code: error && error.code || null,
    message: error && error.stack || String(error),
  });
  process.exitCode = 1;
});
`;

function openDb(databasePath = ':memory:') {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function createPolicySchema(db) {
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.transaction(() => migrateModelPolicy(db))();
}

function createRuntime(prefix, initialNow = 2000) {
  let now = initialNow;
  const counters = { event: 0, request: 0 };
  return {
    setNow(value) {
      now = value;
    },
    counters,
    options: {
      clock: () => now,
      ids: {
        event: () => `${prefix}-policy-event-${String(++counters.event).padStart(4, '0')}`,
        request: () => `${prefix}-policy-request-${String(++counters.request).padStart(4, '0')}`,
      },
    },
  };
}

function updateInput(expectedRevision, overrides = {}) {
  return {
    expectedRevision,
    autoFailoverEnabled: true,
    autoCleanupEnabled: false,
    autoCleanupDays: 30,
    ...overrides,
  };
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected operation to throw');
}

function assertPolicyError(error, code) {
  assert(error instanceof ModelAutomationPolicyError);
  assertEqual(error.code, code);
}

function snapshot(db) {
  return JSON.stringify({
    policy: db.prepare('SELECT * FROM model_automation_policy ORDER BY id').all(),
    events: db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all(),
    settings: db.prepare('SELECT * FROM user_settings ORDER BY id').all(),
  });
}

function createSettingsRouteHarness(db) {
  let requestBody = {};
  let response = null;
  let featureDocument = null;
  const routes = createMiscRoutes({
    db: { db },
    parseBody: async () => requestBody,
    sendJSON: (_res, status, body) => { response = { status, body }; },
    safeError: error => ({ error: error.message }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    callWithAuth: async () => ({}),
    createAuthToken: () => '',
    LLMCallerRole: {},
    featureManager: {
      applySettings(document) {
        featureDocument = document;
        return 0;
      },
    },
  });
  return {
    async post(body) {
      requestBody = body;
      response = null;
      featureDocument = null;
      await routes['POST /api/settings']({}, {});
      return { response, featureDocument };
    },
    async get() {
      response = null;
      await routes['GET /api/settings']({}, {});
      return response;
    },
  };
}

function createTypedPolicyRouteHarness(db) {
  let requestBody = {};
  let response = null;
  let parseFailure = null;
  const effects = { fetch: 0, modelRegistry: 0, modelBinding: 0 };
  const effectPort = key => new Proxy({}, {
    get() {
      effects[key]++;
      return () => {
        effects[key]++;
        throw new Error(`unexpected ${key} effect`);
      };
    },
  });
  const withFetchTrap = async callback => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => {
      effects.fetch++;
      throw new Error('unexpected provider fetch');
    };
    try {
      return await callback();
    } finally {
      globalThis.fetch = previousFetch;
    }
  };
  const routes = createSystemRoutes({
    db: { db },
    modelRegistry: effectPort('modelRegistry'),
    modelBindingApplication: effectPort('modelBinding'),
    parseBody: async () => {
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { response = { status, body }; },
  });
  return {
    effects,
    async get() {
      response = null;
      return withFetchTrap(async () => {
        await routes['GET /api/system/models/settings']({}, {});
        return response;
      });
    },
    async put(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      response = null;
      return withFetchTrap(async () => {
        await routes['PUT /api/system/models/settings']({}, {});
        parseFailure = null;
        return response;
      });
    },
  };
}

function assertNoTypedPolicyEffects(harness) {
  assertEqual(harness.effects.fetch, 0, 'typed policy route must not call a provider');
  assertEqual(harness.effects.modelRegistry, 0, 'typed policy route must not touch model registry');
  assertEqual(harness.effects.modelBinding, 0, 'typed policy route must not touch binding authority');
}

function waitForWorker(worker, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`model policy worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    worker.once('message', result => finish(resolve, result));
    worker.once('error', error => finish(reject, error));
    worker.once('exit', code => {
      if (code !== 0) {
        finish(reject, new Error(`model policy worker exited ${code}`));
      } else if (!settled) {
        finish(reject, new Error('model policy worker exited without a result'));
      }
    });
  });
}

function waitForReadyWriters(barrier, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Atomics.load(barrier, 0) < expected) {
    const observed = Atomics.load(barrier, 0);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`timed out waiting for ${expected} model policy writers`);
    }
    Atomics.wait(barrier, 0, observed, remaining);
  }
}

suite('M1 model automation policy — migration authority');

await testAsync('migration 061 creates exact default-off projection and audit authority', async () => {
  const db = openDb();
  try {
    const result = await runMigrations(db);
    assert(result.applied.includes('2026_08_09_061_model_automation_policy'));
    assertEqual(result.applied.at(-1), '2026_08_10_062_model_failover_proof_issuance');
    const policy = readModelAutomationPolicy(db);
    assertEqual(policy.status, ModelAutomationPolicyStatus.VALID);
    assertEqual(policy.valid, true);
    assertEqual(policy.revision, 1);
    assertEqual(JSON.stringify(policy.settings), JSON.stringify(DEFAULT_MODEL_AUTOMATION_POLICY));

    const event = db.prepare('SELECT * FROM model_automation_policy_events').get();
    assertEqual(event.event_kind, 'MIGRATION_DEFAULT_OFF');
    assertEqual(event.previous_revision, 0);
    assertEqual(event.committed_revision, 1);
    assertEqual(event.after_auto_failover_enabled, 0);
    assertEqual(event.legacy_quarantine_json, null);

    const triggerNames = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
        AND (name LIKE 'trg_model_automation_%'
          OR name LIKE 'trg_user_settings_model_automation_%')
      ORDER BY name
    `).all().map(row => row.name);
    assertEqual(triggerNames.length, 13);
  } finally {
    db.close();
  }
});

await testAsync('legacy values are quarantined and removed without becoming opt-in', async () => {
  const db = openDb();
  try {
    const plan = await migrationInternals.discoverMigrations();
    const before061 = plan.filter(migration => ![
      '2026_08_09_061_model_automation_policy',
      '2026_08_10_062_model_failover_proof_issuance',
    ].includes(migration.version));
    migrationInternals.runMigrationPlan(db, before061);
    db.prepare(`
      INSERT INTO user_settings (id, data)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `).run(JSON.stringify({
      sentinel: { preserved: true },
      models: {
        autoFailoverEnabled: true,
        autoCleanupEnabled: 'true',
        autoCleanupDays: 45,
        futureSetting: 'keep-me',
      },
    }));

    const result = await runMigrations(db);
    assertEqual(JSON.stringify(result.applied), JSON.stringify([
      '2026_08_09_061_model_automation_policy',
      '2026_08_10_062_model_failover_proof_issuance',
    ]));
    const policy = readModelAutomationPolicy(db);
    assertEqual(policy.valid, true);
    assertEqual(JSON.stringify(policy.settings), JSON.stringify(DEFAULT_MODEL_AUTOMATION_POLICY));

    const document = JSON.parse(
      db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data,
    );
    assertEqual(document.sentinel.preserved, true);
    assertEqual(document.models.futureSetting, 'keep-me');
    assertEqual(Object.hasOwn(document.models, 'autoFailoverEnabled'), false);
    assertEqual(Object.hasOwn(document.models, 'autoCleanupEnabled'), false);
    assertEqual(Object.hasOwn(document.models, 'autoCleanupDays'), false);

    const quarantine = JSON.parse(db.prepare(`
      SELECT legacy_quarantine_json
      FROM model_automation_policy_events
      WHERE event_kind = 'MIGRATION_DEFAULT_OFF'
    `).get().legacy_quarantine_json);
    assertEqual(quarantine.autoFailoverEnabled, true);
    assertEqual(quarantine.autoCleanupEnabled, 'true');
    assertEqual(quarantine.autoCleanupDays, 45);
  } finally {
    db.close();
  }
});

test('pre-existing authority object fails atomically without a migration stamp', () => {
  const db = openDb();
  try {
    db.exec(`
      CREATE TABLE user_settings (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE model_automation_policy (id INTEGER PRIMARY KEY);
    `);
    const error = captureError(() => migrationInternals.runMigrationPlan(db, [{
      version: '2026_08_09_061_model_automation_policy',
      file: '2026_08_09_061_model_automation_policy.js',
      description: 'fixture',
      up: migrateModelPolicy,
    }]));
    assert(error.message.includes('pre-exist migration authority'));
    assertEqual(
      db.prepare(`
        SELECT COUNT(*) AS count FROM schema_migrations
        WHERE version = '2026_08_09_061_model_automation_policy'
      `).get().count,
      0,
    );
    assertEqual(
      db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'model_automation_policy_events'
      `).get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test('legacy INSERT and UPDATE writers cannot reintroduce owned keys', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    for (const [key, value] of [
      ['autoFailoverEnabled', false],
      ['autoCleanupEnabled', null],
      ['autoCleanupDays', '14'],
    ]) {
      const ownedError = captureError(() => db.prepare(`
        INSERT INTO user_settings (id, data) VALUES (1, ?)
      `).run(JSON.stringify({
        models: { [key]: value, futureSetting: 'keep-me' },
      })));
      assert(ownedError.message.startsWith('MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN:'));
      assertEqual(db.prepare('SELECT COUNT(*) AS count FROM user_settings').get().count, 0);
    }

    db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      models: { futureSetting: 'keep-me' },
    }));
    const safeRaw = db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data;
    const document = JSON.parse(safeRaw);
    assertEqual(document.models.futureSetting, 'keep-me');

    for (const [key, value] of [
      ['autoFailoverEnabled', true],
      ['autoCleanupEnabled', false],
      ['autoCleanupDays', 30],
    ]) {
      const error = captureError(() => db.prepare(`
        UPDATE user_settings SET data = ? WHERE id = 1
      `).run(JSON.stringify({ models: { futureSetting: 'keep-me', [key]: value } })));
      assert(error.message.startsWith('MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN:'));
      assertEqual(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data, safeRaw);
    }
    assertEqual(readModelAutomationPolicy(db).settings.autoFailoverEnabled, false);
  } finally {
    db.close();
  }
});

test('duplicate models objects cannot bypass INSERT or UPDATE downgrade guards', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const duplicate = '{"models":{},"models":{"autoFailoverEnabled":true}}';
    const insertError = captureError(() => db.prepare(`
      INSERT INTO user_settings (id, data) VALUES (1, ?)
    `).run(duplicate));
    assert(insertError.message.startsWith('MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN:'));
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM user_settings').get().count, 0);

    const safeRaw = '{"models":{"futureSetting":"keep-me"}}';
    db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(safeRaw);
    const updateError = captureError(() => db.prepare(`
      UPDATE user_settings SET data = ? WHERE id = 1
    `).run(duplicate));
    assert(updateError.message.startsWith('MODEL_AUTOMATION_POLICY_LEGACY_KEY_FORBIDDEN:'));
    assertEqual(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data, safeRaw);
  } finally {
    db.close();
  }
});

await testAsync('generic settings POST drops owned keys and cannot mutate policy authority', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const harness = createSettingsRouteHarness(db);
    const before = readModelAutomationPolicy(db);
    const first = await harness.post({
      ui: { theme: 'dark' },
      models: {
        autoFailoverEnabled: true,
        autoCleanupEnabled: true,
        autoCleanupDays: 30,
        futureSetting: 'keep-me',
      },
    });
    assertEqual(first.response.status, 200);
    assertEqual(first.response.body.success, true);
    assertEqual(
      JSON.stringify(first.response.body.ignoredReservedKeys),
      JSON.stringify(['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays']),
    );
    assertEqual(first.featureDocument.ui.theme, 'dark');
    assertEqual(first.featureDocument.models.futureSetting, 'keep-me');
    assertEqual(Object.hasOwn(first.featureDocument.models, 'autoFailoverEnabled'), false);

    const stored = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
    assertEqual(stored.ui.theme, 'dark');
    assertEqual(stored.models.futureSetting, 'keep-me');
    assertEqual(Object.hasOwn(stored.models, 'autoFailoverEnabled'), false);
    assertEqual(Object.hasOwn(stored.models, 'autoCleanupEnabled'), false);
    assertEqual(Object.hasOwn(stored.models, 'autoCleanupDays'), false);
    assertEqual(JSON.stringify(readModelAutomationPolicy(db)), JSON.stringify(before));

    const reset = await harness.post({});
    assertEqual(reset.response.status, 200);
    assertEqual(JSON.stringify(reset.response.body.ignoredReservedKeys), '[]');
    assertEqual(JSON.stringify(readModelAutomationPolicy(db)), JSON.stringify(before));
  } finally {
    db.close();
  }
});

await testAsync('generic settings GET omits owned keys from a legacy raw row', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    db.exec(`
      DROP TRIGGER trg_user_settings_model_automation_insert_guard;
      DROP TRIGGER trg_user_settings_model_automation_update_guard;
    `);
    db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      ui: { theme: 'light' },
      models: {
        autoFailoverEnabled: true,
        autoCleanupDays: 99,
        futureSetting: 'keep-me',
      },
    }));
    const response = await createSettingsRouteHarness(db).get();
    assertEqual(response.status, 200);
    assertEqual(response.body.ui.theme, 'light');
    assertEqual(response.body.models.futureSetting, 'keep-me');
    assertEqual(Object.hasOwn(response.body.models, 'autoFailoverEnabled'), false);
    assertEqual(Object.hasOwn(response.body.models, 'autoCleanupDays'), false);
    assertEqual(readModelAutomationPolicy(db).settings.autoFailoverEnabled, false);
  } finally {
    db.close();
  }
});

await testAsync('typed policy GET and PUT expose one exact revisioned authority', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const harness = createTypedPolicyRouteHarness(db);
    const initial = await harness.get();
    assertEqual(initial.status, 200);
    assertEqual(initial.body.ok, true);
    assertEqual(JSON.stringify(initial.body.policy), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      autoFailoverEnabled: false,
      autoCleanupEnabled: false,
      autoCleanupDays: 14,
      lastEventId: 'policy-event-migration-061',
      updatedAtMs: readModelAutomationPolicy(db).updatedAtMs,
    }));

    const committed = await harness.put({
      expectedRevision: 1,
      autoFailoverEnabled: true,
      autoCleanupEnabled: true,
      autoCleanupDays: 30,
    });
    assertEqual(committed.status, 200);
    assertEqual(Object.keys(committed.body).sort().join(','), 'event,ok,policy');
    assertEqual(committed.body.ok, true);
    assertEqual(committed.body.policy.revision, 2);
    assertEqual(committed.body.policy.autoFailoverEnabled, true);
    assertEqual(committed.body.policy.autoCleanupEnabled, true);
    assertEqual(committed.body.policy.autoCleanupDays, 30);
    assertEqual(committed.body.event.eventKind, 'USER_UPDATE');
    assertEqual(Object.keys(committed.body.event).sort().join(','), 'actor,eventId,eventKind,requestId,source');
    assertEqual(committed.body.event.actor, 'user:model-settings-api');
    assertEqual(committed.body.event.source, 'TYPED_API');
    assert(/^policy-event-/.test(committed.body.event.eventId));
    assert(/^policy-request-/.test(committed.body.event.requestId));
    assertEqual((await harness.get()).body.policy.revision, 2);
    assertNoTypedPolicyEffects(harness);
  } finally {
    db.close();
  }
});

await testAsync('typed policy PUT rejects invalid and stale bodies without mutation', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const harness = createTypedPolicyRouteHarness(db);
    const before = snapshot(db);
    for (const body of [
      { ...updateInput(1), extra: true },
      { ...updateInput(1), autoFailoverEnabled: 'true' },
      { ...updateInput(1), autoCleanupDays: 0 },
      {
        autoFailoverEnabled: true,
        autoCleanupEnabled: false,
        autoCleanupDays: 14,
      },
    ]) {
      const response = await harness.put(body);
      assertEqual(response.status, 400);
      assertEqual(response.body.ok, false);
      assertEqual(snapshot(db), before);
    }
    const malformed = await harness.put(null, { parseFailure: new Error('invalid JSON') });
    assertEqual(malformed.status, 400);
    assertEqual(malformed.body.code, 'MODEL_AUTOMATION_POLICY_INPUT_INVALID');
    assertEqual(snapshot(db), before);

    const first = await harness.put(updateInput(1));
    assertEqual(first.status, 200);
    const afterFirst = snapshot(db);
    const stale = await harness.put(updateInput(1, { autoCleanupDays: 31 }));
    assertEqual(stale.status, 409);
    assertEqual(stale.body.code, 'MODEL_AUTOMATION_POLICY_STALE');
    assertEqual(snapshot(db), afterFirst);
    assertNoTypedPolicyEffects(harness);
  } finally {
    db.close();
  }
});

await testAsync('typed policy routes fail closed on a projection/event mismatch', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    db.exec(`
      DROP TRIGGER trg_model_automation_projection_revision;
      DROP TRIGGER trg_model_automation_projection_new_event;
      DROP TRIGGER trg_model_automation_projection_current_event;
      UPDATE model_automation_policy SET auto_cleanup_days = 31 WHERE id = 1;
    `);
    const harness = createTypedPolicyRouteHarness(db);
    const before = snapshot(db);
    const read = await harness.get();
    assertEqual(read.status, 503);
    assertEqual(read.body.code, 'MODEL_AUTOMATION_POLICY_PROJECTION_INVALID');
    const write = await harness.put(updateInput(1));
    assertEqual(write.status, 503);
    assertEqual(write.body.code, 'MODEL_AUTOMATION_POLICY_INVALID_STATE');
    assertEqual(snapshot(db), before);
    assertNoTypedPolicyEffects(harness);
  } finally {
    db.close();
  }
});

await testAsync('typed policy routes report unavailable storage as 503 without effects', async () => {
  const db = openDb();
  try {
    const harness = createTypedPolicyRouteHarness(db);
    const before = JSON.stringify(db.prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all());
    const read = await harness.get();
    assertEqual(read.status, 503);
    assertEqual(read.body.code, 'MODEL_AUTOMATION_POLICY_DB_READ_FAILED');
    const write = await harness.put(updateInput(1));
    assertEqual(write.status, 503);
    assertEqual(write.body.code, 'MODEL_AUTOMATION_POLICY_DB_WRITE_FAILED');
    const after = JSON.stringify(db.prepare(
      "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all());
    assertEqual(after, before);
    assertNoTypedPolicyEffects(harness);
  } finally {
    db.close();
  }
});

suite('M1 model automation policy — repository and CAS');

test('typed update commits one exact event and matching projection', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const runtime = createRuntime('typed');
    const repository = createModelAutomationPolicyRepository(db, runtime.options);
    const committed = repository.updateFromTypedApi(updateInput(1));
    assertEqual(committed.revision, 2);
    assertEqual(committed.settings.autoFailoverEnabled, true);
    assertEqual(committed.settings.autoCleanupDays, 30);
    assertEqual(committed.event.eventKind, 'USER_UPDATE');
    assertEqual(committed.event.source, 'TYPED_API');
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_automation_policy_events').get().count, 2);

    const event = db.prepare(`
      SELECT * FROM model_automation_policy_events WHERE event_id = ?
    `).get(committed.lastEventId);
    assertEqual(event.previous_revision, 1);
    assertEqual(event.committed_revision, 2);
    assertEqual(event.before_auto_failover_enabled, 0);
    assertEqual(event.after_auto_failover_enabled, 1);
    assertEqual(event.created_at_ms, committed.updatedAtMs);
  } finally {
    db.close();
  }
});

test('invalid and incomplete inputs fail before any storage mutation', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const repository = createModelAutomationPolicyRepository(db, createRuntime('invalid').options);
    const before = snapshot(db);
    const cases = [
      [{ ...updateInput(1), unknown: true }, 'MODEL_AUTOMATION_POLICY_INPUT_SHAPE_INVALID'],
      [{ ...updateInput(1), autoFailoverEnabled: 'true' }, 'MODEL_AUTOMATION_POLICY_AUTO_FAILOVER_INVALID'],
      [{ ...updateInput(1), autoCleanupEnabled: 1 }, 'MODEL_AUTOMATION_POLICY_AUTO_CLEANUP_INVALID'],
      [{ ...updateInput(1), autoCleanupDays: 0 }, 'MODEL_AUTOMATION_POLICY_CLEANUP_DAYS_INVALID'],
      [{ ...updateInput(1), autoCleanupDays: 3651 }, 'MODEL_AUTOMATION_POLICY_CLEANUP_DAYS_INVALID'],
      [{ ...updateInput(1), autoCleanupDays: 1.5 }, 'MODEL_AUTOMATION_POLICY_CLEANUP_DAYS_INVALID'],
      [{
        autoFailoverEnabled: true,
        autoCleanupEnabled: false,
        autoCleanupDays: 14,
      }, 'MODEL_AUTOMATION_POLICY_INPUT_SHAPE_INVALID'],
    ];
    for (const [input, code] of cases) {
      assertPolicyError(captureError(() => repository.updateFromTypedApi(input)), code);
      assertEqual(snapshot(db), before);
    }
  } finally {
    db.close();
  }
});

test('stale revision is a typed conflict with no event or projection change', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const runtime = createRuntime('stale');
    const repository = createModelAutomationPolicyRepository(db, runtime.options);
    repository.updateFromTypedApi(updateInput(1));
    const before = snapshot(db);
    const error = captureError(() => repository.updateFromTypedApi(updateInput(1, {
      autoCleanupDays: 31,
    })));
    assertPolicyError(error, 'MODEL_AUTOMATION_POLICY_STALE');
    assertEqual(snapshot(db), before);
    assertEqual(runtime.counters.event, 1);
    assertEqual(runtime.counters.request, 1);
  } finally {
    db.close();
  }
});

await testAsync('two concurrent WAL workers from the same revision produce one winner', async () => {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'model-policy-race-'),
  );
  const databasePath = path.join(directory, 'policy.sqlite');
  const db = openDb(databasePath);
  const barrier = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
  const repositoryUrl = new URL('../src/db/model-policy.js', import.meta.url).href;
  const workers = [];
  try {
    createPolicySchema(db);
    assertEqual(db.pragma('journal_mode', { simple: true }), 'wal');
    const baseTime = readModelAutomationPolicy(db).updatedAtMs + 1;
    for (const [prefix, cleanupDays, createdAtMs] of [
      ['writer-a', 30, baseTime],
      ['writer-b', 31, baseTime + 1],
    ]) {
      workers.push(new Worker(MODEL_POLICY_WAL_WORKER_SOURCE, {
        eval: true,
        workerData: {
          databasePath,
          barrier,
          prefix,
          cleanupDays,
          createdAtMs,
          repositoryUrl,
        },
      }));
    }
    const resultsPromise = Promise.all(workers.map(worker => waitForWorker(worker)));
    waitForReadyWriters(barrier, 2);
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1, 2);
    const results = await resultsPromise;

    assertEqual(results.filter(result => result.kind === 'COMMITTED').length, 1);
    assertEqual(results.filter(result => (
      result.kind === 'ERROR'
      && result.code === 'MODEL_AUTOMATION_POLICY_STALE'
    )).length, 1);
    assertEqual(results.every(result => result.observedRevision === 1), true);

    const committed = results.find(result => result.kind === 'COMMITTED');
    const policy = readModelAutomationPolicy(db);
    assertEqual(policy.revision, 2);
    assertEqual(policy.lastEventId, committed.eventId);
    assertEqual(policy.settings.autoCleanupDays, committed.cleanupDays);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_automation_policy_events').get().count, 2);
  } finally {
    for (const worker of workers) {
      if (worker.threadId !== -1) await worker.terminate();
    }
    db.close();
    rmSync(directory, { recursive: true, force: false });
  }
});

test('event without its projection update is rejected before insertion', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const before = snapshot(db);
    const error = captureError(() => db.prepare(`
      INSERT INTO model_automation_policy_events (
        event_id, request_id, previous_revision, committed_revision,
        event_kind, actor, source,
        before_auto_failover_enabled, before_auto_cleanup_enabled,
        before_auto_cleanup_days, after_auto_failover_enabled,
        after_auto_cleanup_enabled, after_auto_cleanup_days,
        legacy_quarantine_json, created_at_ms
      ) VALUES (
        'orphan-policy-event-0001', 'orphan-policy-request-0001', 1, 2,
        'USER_UPDATE', 'user:orphan-fixture', 'TYPED_API',
        0, 0, 14, 1, 0, 30, NULL, 2000
      )
    `).run());
    assert(error.message.startsWith('MODEL_AUTOMATION_POLICY_EVENT_PROJECTION_MISMATCH:'));
    assertEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test('projection without its event fails the deferred foreign key at commit', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const before = snapshot(db);
    const writeProjectionOnly = db.transaction(() => db.prepare(`
      UPDATE model_automation_policy
      SET revision = 2,
          auto_failover_enabled = 1,
          auto_cleanup_days = 30,
          last_event_id = 'missing-policy-event-0001',
          updated_at_ms = 2000
      WHERE id = 1
    `).run());
    const error = captureError(() => writeProjectionOnly.immediate());
    assertEqual(error.code, 'SQLITE_CONSTRAINT_FOREIGNKEY');
    assertEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test('projection cannot advance by reusing an older event identity', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const repository = createModelAutomationPolicyRepository(
      db,
      createRuntime('old-event').options,
    );
    repository.updateFromTypedApi(updateInput(1));
    const before = snapshot(db);
    const reuseOldEvent = db.transaction(() => db.prepare(`
      UPDATE model_automation_policy
      SET revision = 3,
          auto_cleanup_days = 31,
          last_event_id = 'policy-event-migration-061',
          updated_at_ms = 3000
      WHERE id = 1
    `).run());
    const error = captureError(() => reuseOldEvent.immediate());
    assert(error.message.startsWith('MODEL_AUTOMATION_POLICY_EVENT_IDENTITY_CONFLICT:'));
    assertEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test('reader rejects a projection that no longer matches its event', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    db.exec(`
      DROP TRIGGER trg_model_automation_projection_revision;
      DROP TRIGGER trg_model_automation_projection_new_event;
      DROP TRIGGER trg_model_automation_projection_current_event;
    `);
    db.prepare(`
      UPDATE model_automation_policy SET auto_cleanup_days = 99 WHERE id = 1
    `).run();
    const policy = readModelAutomationPolicy(db);
    assertEqual(policy.status, ModelAutomationPolicyStatus.INVALID);
    assertEqual(policy.valid, false);
    assertEqual(policy.revision, 0);
    assertEqual(JSON.stringify(policy.settings), JSON.stringify(DEFAULT_MODEL_AUTOMATION_POLICY));
  } finally {
    db.close();
  }
});

test('events and projection reject update, delete and replacement', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    for (const statement of [
      "UPDATE model_automation_policy_events SET actor = 'user:tamper' WHERE seq = 1",
      'DELETE FROM model_automation_policy_events WHERE seq = 1',
      "INSERT OR REPLACE INTO model_automation_policy (id, revision, auto_failover_enabled, auto_cleanup_enabled, auto_cleanup_days, last_event_id, updated_at_ms) VALUES (1, 1, 0, 0, 14, 'policy-event-migration-061', 1)",
      'DELETE FROM model_automation_policy WHERE id = 1',
    ]) {
      const before = snapshot(db);
      const error = captureError(() => db.exec(statement));
      assert(error.code?.startsWith('SQLITE_CONSTRAINT'));
      assertEqual(snapshot(db), before);
    }
  } finally {
    db.close();
  }
});

test('event insertion failure rolls the projection update back', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    db.exec(`
      CREATE TRIGGER fixture_reject_policy_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'USER_UPDATE'
      BEGIN
        SELECT RAISE(ABORT, 'FIXTURE_EVENT_REJECTED');
      END;
    `);
    const repository = createModelAutomationPolicyRepository(db, createRuntime('rollback').options);
    const before = snapshot(db);
    assertPolicyError(
      captureError(() => repository.updateFromTypedApi(updateInput(1))),
      'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT',
    );
    assertEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test('explicit reset appends exactly one audited OFF transition', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const runtime = createRuntime('reset');
    const repository = createModelAutomationPolicyRepository(db, runtime.options);
    const enabled = repository.updateFromTypedApi(updateInput(1, {
      autoCleanupEnabled: true,
    }));
    runtime.setNow(3000);
    const reset = repository.resetFromGlobalSettings({ expectedRevision: enabled.revision });
    assertEqual(reset.revision, 3);
    assertEqual(JSON.stringify(reset.settings), JSON.stringify(DEFAULT_MODEL_AUTOMATION_POLICY));
    assertEqual(reset.event.eventKind, 'GLOBAL_RESET');
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM model_automation_policy_events
      WHERE event_kind = 'GLOBAL_RESET'
    `).get().count, 1);

    const beforeStale = snapshot(db);
    assertPolicyError(
      captureError(() => repository.resetFromGlobalSettings({ expectedRevision: 2 })),
      'MODEL_AUTOMATION_POLICY_STALE',
    );
    assertEqual(snapshot(db), beforeStale);
  } finally {
    db.close();
  }
});

test('restart preserves policy revision, event identity and values', () => {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'model-policy-restart-'),
  );
  const databasePath = path.join(directory, 'policy.sqlite');
  let db = openDb(databasePath);
  try {
    createPolicySchema(db);
    const repository = createModelAutomationPolicyRepository(db, createRuntime('restart').options);
    const committed = repository.updateFromTypedApi(updateInput(1));
    db.close();
    db = openDb(databasePath);
    const restarted = readModelAutomationPolicy(db);
    assertEqual(restarted.valid, true);
    assertEqual(restarted.revision, committed.revision);
    assertEqual(restarted.lastEventId, committed.lastEventId);
    assertEqual(JSON.stringify(restarted.settings), JSON.stringify(committed.settings));
    assertEqual(
      db.prepare('SELECT COUNT(*) AS count FROM model_automation_policy_events').get().count,
      2,
    );
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: false });
  }
});

test('closed database is a typed default-off read instead of a throw', () => {
  const db = openDb();
  createPolicySchema(db);
  db.close();
  const policy = readModelAutomationPolicy(db);
  assertEqual(policy.status, ModelAutomationPolicyStatus.DB_ERROR);
  assertEqual(policy.valid, false);
  assertEqual(JSON.stringify(policy.settings), JSON.stringify(DEFAULT_MODEL_AUTOMATION_POLICY));
});

summary();
