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
import { up as migrateUserSettingsRevision } from '../src/db/migrations/2026_08_10_064_user_settings_revision.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createSystemRoutes } from '../src/routes/system.js';
import {
  DEFAULT_MODEL_AUTOMATION_POLICY,
  ModelAutomationPolicyError,
  ModelAutomationPolicyStatus,
  createModelAutomationPolicyRepository,
  readModelAutomationPolicy,
} from '../src/db/model-policy.js';
import {
  SETTINGS_PORTABLE_PATHS,
} from '../src/db/settings-portability.js';

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

function createPolicySchema(db, { revisioned = true } = {}) {
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.transaction(() => {
    migrateModelPolicy(db);
    if (revisioned) migrateUserSettingsRevision(db);
  })();
}

function hasSettingsRevision(db) {
  return db.prepare('PRAGMA table_info(user_settings)').all()
    .some(column => column.name === 'revision');
}

function writeSettingsRaw(db, raw) {
  if (!hasSettingsRevision(db)) {
    const result = db.prepare(`
      INSERT INTO user_settings (id, data)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `).run(raw);
    assertEqual(result.changes, 1);
    return result;
  }
  const result = db.prepare(`
    UPDATE user_settings
    SET data = ?, revision = revision + 1
    WHERE id = 1
  `).run(raw);
  assertEqual(result.changes, 1);
  return result;
}

function writeCorruptSettingsRaw(db, raw) {
  if (hasSettingsRevision(db)) {
    db.exec('DROP TRIGGER IF EXISTS trg_user_settings_revision_update_guard');
  }
  return writeSettingsRaw(db, raw);
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

function portableValues(overrides = {}) {
  return {
    '/appearance/accentColor': '#6366f1',
    '/appearance/fontFamily': 'system',
    '/appearance/fontSize': 14,
    '/appearance/theme': 'light',
    '/c3.language': 'cs',
    '/c3.output.codeBlocks': true,
    '/c3.output.markdownRendering': true,
    '/c3.output.syntaxHighlight': true,
    '/output/codeStyle': 'default',
    '/output/defaultFormat': 'markdown',
    '/output/namingConvention': 'camelCase',
    ...overrides,
  };
}

function backupEnvelope(overrides = {}) {
  const base = {
    kind: 'INTENTSMITH_SETTINGS_BACKUP',
    schemaVersion: 2,
    settingsProjection: {
      profile: 'UX_PREFERENCES_V1',
      values: portableValues(),
    },
    modelAutomationPolicy: {
      autoFailoverEnabled: true,
      autoCleanupEnabled: true,
      autoCleanupDays: 30,
    },
    omissions: {
      strategy: 'DEFAULT_DENY',
      scope: 'GENERAL_SETTINGS',
      excluded: 'ALL_PATHS_NOT_IN_PROFILE',
      sourceHadExcludedPaths: false,
    },
  };
  return {
    ...base,
    ...overrides,
    settingsProjection: overrides.settingsProjection === undefined
      ? base.settingsProjection
      : (overrides.settingsProjection && typeof overrides.settingsProjection === 'object'
        ? {
          ...base.settingsProjection,
          ...overrides.settingsProjection,
          values: overrides.settingsProjection.values === undefined
            ? base.settingsProjection.values
            : overrides.settingsProjection.values,
        }
        : overrides.settingsProjection),
  };
}

function legacyBackupEnvelope(overrides = {}) {
  return {
    kind: 'INTENTSMITH_SETTINGS_BACKUP',
    schemaVersion: 1,
    generalSettings: {
      appearance: { theme: 'light' },
      'c3.language': 'cs',
    },
    modelAutomationPolicy: null,
    omittedSensitiveKeys: [],
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
  let parseFailure = null;
  let featureFailure = null;
  let loggerFailure = null;
  let featureResetCount = 0;
  const routes = createMiscRoutes({
    db: { db },
    parseBody: async () => {
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { response = { status, body }; },
    safeError: error => ({ error: error.message }),
    logger: {
      info() {},
      warn() { if (loggerFailure) throw loggerFailure; },
      error() {},
      debug() {},
    },
    callWithAuth: async () => ({}),
    createAuthToken: () => '',
    LLMCallerRole: {},
    featureManager: {
      applySettings(document) {
        if (featureFailure) throw featureFailure;
        featureDocument = document;
        return 0;
      },
      resetToDefaults() {
        if (featureFailure) throw featureFailure;
        featureResetCount++;
      },
    },
  });
  return {
    get featureResetCount() { return featureResetCount; },
    setFeatureFailure(error) { featureFailure = error; },
    setLoggerFailure(error) { loggerFailure = error; },
    async putV2(body) {
      requestBody = body;
      response = null;
      featureDocument = null;
      await routes['PUT /api/settings/v2']({}, {});
      return { response, featureDocument };
    },
    async getV2() {
      response = null;
      await routes['GET /api/settings/v2']({}, {});
      return response;
    },
    backup() {
      response = null;
      routes['GET /api/settings/backup']({}, {});
      return response;
    },
    async importBackup(body, options = {}) {
      const expectedRevision = options.expectedRevision
        ?? db.prepare('SELECT revision FROM user_settings WHERE id=1').get()?.revision;
      requestBody = options.requestBody ?? { backup: body, expectedRevision };
      parseFailure = options.parseFailure || null;
      response = null;
      featureDocument = null;
      await routes['POST /api/settings/import']({}, {});
      parseFailure = null;
      return { response, featureDocument };
    },
    async reset(options = {}) {
      response = null;
      const route = options.legacy
        ? routes['POST /api/reset']
        : routes['POST /api/settings/reset'];
      await route({}, {});
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
    assertEqual(result.applied.at(-1), '2026_08_10_064_user_settings_revision');
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
      '2026_08_10_064_user_settings_revision',
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
      '2026_08_10_064_user_settings_revision',
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
    assertEqual(
      db.prepare('SELECT revision FROM user_settings WHERE id = 1').get().revision,
      1,
    );

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
    createPolicySchema(db, { revisioned: false });
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

    writeSettingsRaw(db, JSON.stringify({
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
    createPolicySchema(db, { revisioned: false });
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

await testAsync('versioned generic settings reject policy and runtime-feature paths before mutation', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const harness = createSettingsRouteHarness(db);
    const before = snapshot(db);
    for (const patch of [
      {
        models: {
          autoFailoverEnabled: true,
          autoCleanupEnabled: true,
          autoCleanupDays: 30,
        },
      },
      { 'c3.features.skills': false },
    ]) {
      const result = await harness.putV2({ expectedRevision: 1, patch });
      assertEqual(result.response.status, 400);
      assertEqual(result.response.body.ok, false);
      assertEqual(result.response.body.code, 'USER_SETTINGS_PATH_UNOWNED');
      assertEqual(result.featureDocument, null);
      assertEqual(snapshot(db), before);
    }
    assertEqual(readModelAutomationPolicy(db).settings.autoFailoverEnabled, false);
  } finally {
    db.close();
  }
});

await testAsync('versioned settings GET projects only public paths from a legacy raw row', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    db.exec(`
      DROP TRIGGER trg_user_settings_model_automation_insert_guard;
      DROP TRIGGER trg_user_settings_model_automation_update_guard;
    `);
    writeSettingsRaw(db, JSON.stringify({
      'c3.language': 'en',
      models: {
        autoFailoverEnabled: true,
        autoCleanupDays: 99,
        futureSetting: 'keep-me',
      },
    }));
    const response = await createSettingsRouteHarness(db).getV2();
    assertEqual(response.status, 200);
    assertEqual(response.body.revision, 2);
    assertEqual(JSON.stringify(response.body.settings), JSON.stringify({ 'c3.language': 'en' }));
    assertEqual(Object.hasOwn(response.body.settings, 'models'), false);
    assertEqual(readModelAutomationPolicy(db).settings.autoFailoverEnabled, false);
  } finally {
    db.close();
  }
});

await testAsync('schema v2 export is one deterministic default-deny settings projection', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    writeSettingsRaw(db, JSON.stringify({
      appearance: {
        theme: 'light',
        accentColor: '#12abEF',
        fontFamily: 'inter',
        fontSize: 16,
        density: 'compact',
      },
      output: {
        enabledTypes: ['code'],
        defaultFormat: 'json',
        codeStyle: 'airbnb',
        namingConvention: 'snake_case',
      },
      'c3.language': 'en',
      'c3.output.codeBlocks': false,
      'c3.output.markdownRendering': false,
      'c3.output.syntaxHighlight': false,
      'c3.notif.smtpPass': 'CANARY_FLAT_SMTP',
      'c3.notif.webhookSecret': 'CANARY_FLAT_HMAC',
      webhookSecret: 'CANARY_TOPLEVEL_HMAC',
      notifications: {
        telegramToken: 'CANARY_TELEGRAM',
        telegramChatId: 'CANARY_TELEGRAM_DESTINATION',
        slackWebhook: 'CANARY_SLACK',
        discordWebhook: 'CANARY_DISCORD',
        webhookUrl: 'CANARY_WEBHOOK_DESTINATION',
        smsApiKey: 'CANARY_SMS_KEY',
        smsSecret: 'CANARY_SMS_SECRET',
        smsPhone: 'CANARY_SMS_DESTINATION',
      },
      user: { avatar: 'CANARY_AVATAR', connectedAccounts: ['CANARY_ACCOUNT'] },
      memory: { customPrompt: 'CANARY_PROMPT', saveHistory: false },
      location: { city: 'CANARY_CITY', country: 'CANARY_COUNTRY' },
      system: { ollamaUrl: 'CANARY_OLLAMA_URL' },
      future: { credential: 'CANARY_FUTURE_SECRET' },
    }));
    createModelAutomationPolicyRepository(db).updateFromTypedApi(updateInput(1));
    const harness = createSettingsRouteHarness(db);
    const response = harness.backup();
    const repeated = harness.backup();
    assertEqual(response.status, 200);
    assertEqual(Object.keys(response.body).sort().join(','), 'backup,ok');
    assertEqual(response.body.ok, true);
    assertEqual(JSON.stringify(response.body), JSON.stringify(repeated.body));
    assertEqual(JSON.stringify(response.body.backup), JSON.stringify({
      kind: 'INTENTSMITH_SETTINGS_BACKUP',
      schemaVersion: 2,
      settingsProjection: {
        profile: 'UX_PREFERENCES_V1',
        values: portableValues({
          '/appearance/accentColor': '#12abEF',
          '/appearance/fontFamily': 'inter',
          '/appearance/fontSize': 16,
          '/appearance/theme': 'light',
          '/c3.language': 'en',
          '/c3.output.codeBlocks': false,
          '/c3.output.markdownRendering': false,
          '/c3.output.syntaxHighlight': false,
          '/output/codeStyle': 'airbnb',
          '/output/defaultFormat': 'json',
          '/output/namingConvention': 'snake_case',
        }),
      },
      modelAutomationPolicy: {
        autoFailoverEnabled: true,
        autoCleanupEnabled: false,
        autoCleanupDays: 30,
      },
      omissions: {
        strategy: 'DEFAULT_DENY',
        scope: 'GENERAL_SETTINGS',
        excluded: 'ALL_PATHS_NOT_IN_PROFILE',
        sourceHadExcludedPaths: true,
      },
    }));
    assertEqual(
      Object.keys(response.body.backup.settingsProjection.values).join(','),
      SETTINGS_PORTABLE_PATHS.join(','),
    );
    const serialized = JSON.stringify(response.body.backup);
    for (const canary of [
      'CANARY_FLAT_SMTP', 'CANARY_FLAT_HMAC', 'CANARY_TOPLEVEL_HMAC',
      'CANARY_TELEGRAM', 'CANARY_TELEGRAM_DESTINATION', 'CANARY_SLACK',
      'CANARY_DISCORD', 'CANARY_WEBHOOK_DESTINATION', 'CANARY_SMS_KEY',
      'CANARY_SMS_SECRET', 'CANARY_SMS_DESTINATION', 'CANARY_AVATAR',
      'CANARY_ACCOUNT', 'CANARY_PROMPT', 'CANARY_CITY', 'CANARY_COUNTRY',
      'CANARY_OLLAMA_URL', 'CANARY_FUTURE_SECRET',
    ]) {
      assertEqual(serialized.includes(canary), false);
    }
  } finally {
    db.close();
  }
});

await testAsync('schema v2 carries only source values and repairs a malformed owned container', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    writeSettingsRaw(db, JSON.stringify({
      appearance: { theme: 'light' },
      'c3.language': 'en',
      webhookSecret: 'SOURCE_SECRET_CANARY',
    }));
    const harness = createSettingsRouteHarness(db);
    const exported = harness.backup();
    assertEqual(exported.status, 200);
    assertEqual(JSON.stringify(exported.body.backup.settingsProjection.values), JSON.stringify({
      '/appearance/theme': 'light',
      '/c3.language': 'en',
    }));
    assertEqual(JSON.stringify(exported.body.backup).includes('SOURCE_SECRET_CANARY'), false);

    writeSettingsRaw(db, JSON.stringify({
      appearance: null,
      output: {
        codeStyle: 'google',
        defaultFormat: 'yaml',
        namingConvention: 'PascalCase',
      },
      'c3.language': 'cs',
      'c3.output.codeBlocks': false,
      webhookSecret: 'DESTINATION_SECRET_CANARY',
    }));
    const { response } = await harness.importBackup(exported.body.backup);
    assertEqual(response.status, 200);
    assertEqual(response.body.appliedPortablePaths.join(','), '/appearance/theme,/c3.language');
    assertEqual(response.body.settings.appearance.theme, 'light');
    assertEqual(response.body.settings.output.codeStyle, 'google');
    assertEqual(response.body.settings.output.defaultFormat, 'yaml');
    assertEqual(response.body.settings.output.namingConvention, 'PascalCase');
    assertEqual(response.body.settings['c3.language'], 'en');
    assertEqual(response.body.settings['c3.output.codeBlocks'], false);
    assertEqual(Object.hasOwn(response.body.settings, 'webhookSecret'), false);
    assertEqual(
      JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data)
        .webhookSecret,
      'DESTINATION_SECRET_CANARY',
    );
  } finally {
    db.close();
  }
});

await testAsync('schema v2 import overlays only portable preferences and preserves local authority', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const destination = JSON.parse('{"constructor":{"local":"DESTINATION_CONSTRUCTOR"},"prototype":{"local":"DESTINATION_PROTOTYPE"},"__proto__":{"local":"DESTINATION_PROTO"}}');
    Object.assign(destination, {
      old: true,
      appearance: { theme: 'dark', privateSibling: 'DESTINATION_APPEARANCE_PRIVATE' },
      notifications: {
        telegramToken: 'DESTINATION_TELEGRAM',
        slackWebhook: 'DESTINATION_SLACK',
        discordWebhook: 'DESTINATION_DISCORD',
        webhookUrl: 'DESTINATION_WEBHOOK_URL',
        smsApiKey: 'DESTINATION_SMS_KEY',
        smsSecret: 'DESTINATION_SMS_SECRET',
      },
      'c3.notif.smtpPass': 'DESTINATION_SMTP',
      'c3.notif.webhookSecret': 'DESTINATION_HMAC',
      webhookSecret: 'DESTINATION_TOPLEVEL_HMAC',
      system: { ollamaUrl: 'DESTINATION_OLLAMA' },
      future: { setting: 'DESTINATION_FUTURE' },
    });
    writeSettingsRaw(db, JSON.stringify(destination));
    const harness = createSettingsRouteHarness(db);
    const imported = backupEnvelope({
      settingsProjection: {
        profile: 'UX_PREFERENCES_V1',
        values: portableValues({
          '/appearance/theme': 'light',
          '/appearance/fontSize': 18,
          '/c3.language': 'en',
          '/output/defaultFormat': 'yaml',
        }),
      },
    });
    const { response, featureDocument } = await harness.importBackup(imported);
    assertEqual(response.status, 200);
    assertEqual(response.body.ok, true);
    assertEqual(response.body.success, true);
    assertEqual(response.body.policy.revision, 2);
    assertEqual(response.body.policy.autoFailoverEnabled, true);
    assertEqual(response.body.event.eventKind, 'BACKUP_IMPORT');
    assertEqual(response.body.event.source, 'SETTINGS_IMPORT');
    assertEqual(response.body.sourceSchemaVersion, 2);
    assertEqual(response.body.appliedPortablePaths.join(','), SETTINGS_PORTABLE_PATHS.join(','));
    assertEqual(response.body.ignoredSourcePathCount, 0);
    assert(response.body.preservedLocalPathCount >= 3);
    const committed = response.body.settings;
    assertEqual(committed.appearance.theme, 'light');
    assertEqual(committed.appearance.fontSize, 18);
    assertEqual(Object.hasOwn(committed.appearance, 'privateSibling'), false);
    assertEqual(committed['c3.language'], 'en');
    assertEqual(committed.output.defaultFormat, 'yaml');
    for (const key of [
      'notifications', 'c3.notif.smtpPass', 'c3.notif.webhookSecret',
      'webhookSecret', 'system', 'future', 'constructor', 'prototype', '__proto__',
    ]) {
      assertEqual(Object.hasOwn(committed, key), false);
    }
    const persisted = JSON.parse(
      db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data,
    );
    assertEqual(persisted.appearance.privateSibling, 'DESTINATION_APPEARANCE_PRIVATE');
    assertEqual(persisted.notifications.telegramToken, 'DESTINATION_TELEGRAM');
    assertEqual(persisted.notifications.slackWebhook, 'DESTINATION_SLACK');
    assertEqual(persisted.notifications.discordWebhook, 'DESTINATION_DISCORD');
    assertEqual(persisted.notifications.webhookUrl, 'DESTINATION_WEBHOOK_URL');
    assertEqual(persisted.notifications.smsApiKey, 'DESTINATION_SMS_KEY');
    assertEqual(persisted.notifications.smsSecret, 'DESTINATION_SMS_SECRET');
    assertEqual(persisted['c3.notif.smtpPass'], 'DESTINATION_SMTP');
    assertEqual(persisted['c3.notif.webhookSecret'], 'DESTINATION_HMAC');
    assertEqual(persisted.webhookSecret, 'DESTINATION_TOPLEVEL_HMAC');
    assertEqual(persisted.system.ollamaUrl, 'DESTINATION_OLLAMA');
    assertEqual(persisted.future.setting, 'DESTINATION_FUTURE');
    assertEqual(persisted.constructor.local, 'DESTINATION_CONSTRUCTOR');
    assertEqual(persisted.prototype.local, 'DESTINATION_PROTOTYPE');
    assertEqual(persisted.__proto__.local, 'DESTINATION_PROTO');
    assertEqual(featureDocument, null);
    assertEqual(readModelAutomationPolicy(db).settings.autoFailoverEnabled, true);
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count
      FROM model_automation_policy_events
      WHERE event_kind = 'BACKUP_IMPORT'
    `).get().count, 1);
  } finally {
    db.close();
  }
});

await testAsync('schema v1 and raw legacy imports are projected without trusting omission metadata', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    writeSettingsRaw(db, JSON.stringify({
      appearance: {
        accentColor: '#abcdef',
        fontFamily: 'roboto',
        fontSize: 20,
        theme: 'dark',
      },
      output: {
        codeStyle: 'google',
        defaultFormat: 'json',
        namingConvention: 'snake_case',
      },
      'c3.language': 'en',
      'c3.output.codeBlocks': false,
      'c3.output.markdownRendering': false,
      'c3.output.syntaxHighlight': false,
      notifications: { telegramToken: 'DESTINATION_LEGACY_TOKEN' },
      webhookSecret: 'DESTINATION_LEGACY_HMAC',
    }));
    const repository = createModelAutomationPolicyRepository(db);
    const enabled = repository.updateFromTypedApi(updateInput(1));
    const harness = createSettingsRouteHarness(db);
    const { response } = await harness.importBackup(legacyBackupEnvelope({
      generalSettings: {
        appearance: { theme: 'system' },
        notifications: { telegramToken: 'ATTACKER_LEGACY_TOKEN' },
        webhookSecret: 'ATTACKER_LEGACY_HMAC',
        'c3.notif.webhookSecret': 'ATTACKER_FLAT_HMAC',
        system: { ollamaUrl: 'ATTACKER_OLLAMA' },
        future: { credential: 'ATTACKER_FUTURE' },
      },
      omittedSensitiveKeys: ['totally-false-metadata'],
    }));
    assertEqual(response.status, 200);
    assertEqual(response.body.sourceSchemaVersion, 1);
    assertEqual(response.body.appliedPortablePaths.join(','), '/appearance/theme');
    assertEqual(response.body.ignoredSourcePathCount, 5);
    assert(response.body.preservedLocalPathCount >= 2);
    assertEqual(response.body.settings.appearance.theme, 'system');
    assertEqual(response.body.settings.appearance.accentColor, '#abcdef');
    assertEqual(response.body.settings.appearance.fontFamily, 'roboto');
    assertEqual(response.body.settings.appearance.fontSize, 20);
    assertEqual(response.body.settings.output.codeStyle, 'google');
    assertEqual(response.body.settings.output.defaultFormat, 'json');
    assertEqual(response.body.settings.output.namingConvention, 'snake_case');
    assertEqual(response.body.settings['c3.language'], 'en');
    assertEqual(response.body.settings['c3.output.codeBlocks'], false);
    assertEqual(response.body.settings['c3.output.markdownRendering'], false);
    assertEqual(response.body.settings['c3.output.syntaxHighlight'], false);
    assertEqual(Object.hasOwn(response.body.settings, 'notifications'), false);
    assertEqual(Object.hasOwn(response.body.settings, 'webhookSecret'), false);
    assertEqual(JSON.stringify(response.body.settings).includes('ATTACKER_'), false);
    let persisted = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
    assertEqual(persisted.notifications.telegramToken, 'DESTINATION_LEGACY_TOKEN');
    assertEqual(persisted.webhookSecret, 'DESTINATION_LEGACY_HMAC');
    assertEqual(JSON.stringify(persisted).includes('ATTACKER_'), false);
    assertEqual(response.body.policy.revision, enabled.revision + 1);
    assertEqual(response.body.policy.autoFailoverEnabled, true);

    const raw = await harness.importBackup({
      appearance: { theme: 'light' },
      notifications: { telegramToken: 'ATTACKER_RAW_TOKEN' },
      webhookSecret: 'ATTACKER_RAW_HMAC',
    });
    assertEqual(raw.response.status, 200);
    assertEqual(raw.response.body.sourceSchemaVersion, 0);
    assertEqual(raw.response.body.appliedPortablePaths.join(','), '/appearance/theme');
    assertEqual(raw.response.body.settings.appearance.theme, 'light');
    assertEqual(raw.response.body.settings.output.defaultFormat, 'json');
    assertEqual(raw.response.body.settings['c3.language'], 'en');
    assertEqual(Object.hasOwn(raw.response.body.settings, 'notifications'), false);
    assertEqual(JSON.stringify(raw.response.body.settings).includes('ATTACKER_'), false);
    persisted = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
    assertEqual(persisted.notifications.telegramToken, 'DESTINATION_LEGACY_TOKEN');
    assertEqual(persisted.webhookSecret, 'DESTINATION_LEGACY_HMAC');
    assertEqual(JSON.stringify(persisted).includes('ATTACKER_'), false);
    assertEqual(readModelAutomationPolicy(db).settings.autoFailoverEnabled, true);

    const dangerousSource = JSON.parse('{"kind":"INTENTSMITH_SETTINGS_BACKUP","schemaVersion":1,"generalSettings":{"appearance":{"theme":"dark"},"__proto__":{"polluted":true},"constructor":{"polluted":true}},"modelAutomationPolicy":null,"omittedSensitiveKeys":[]}');
    const dangerous = await harness.importBackup(dangerousSource);
    assertEqual(dangerous.response.status, 200);
    assertEqual(dangerous.response.body.settings.appearance.theme, 'dark');
    assertEqual(Object.prototype.polluted, undefined);
    assertEqual(Object.hasOwn(dangerous.response.body.settings, '__proto__'), false);
    assertEqual(Object.hasOwn(dangerous.response.body.settings, 'constructor'), false);
    persisted = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
    assertEqual(Object.hasOwn(persisted, '__proto__'), false);
    assertEqual(Object.hasOwn(persisted, 'constructor'), false);
  } finally {
    db.close();
  }
});

await testAsync('invalid and nonportable v2 envelopes fail before settings or policy mutation', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    writeSettingsRaw(db, '{"stable":true}');
    const harness = createSettingsRouteHarness(db);
    const before = snapshot(db);
    const extraPath = portableValues({ '/notifications/telegramToken': 'ATTACKER' });
    for (const body of [
      { ...backupEnvelope(), unknown: true },
      { ...backupEnvelope(), schemaVersion: 3 },
      { ...backupEnvelope(), settingsProjection: null },
      backupEnvelope({ settingsProjection: { profile: 'UNKNOWN', values: portableValues() } }),
      backupEnvelope({ settingsProjection: { profile: 'UX_PREFERENCES_V1', values: extraPath } }),
      backupEnvelope({
        settingsProjection: {
          profile: 'UX_PREFERENCES_V1',
          values: portableValues({ '/appearance/theme': 'ATTACKER' }),
        },
      }),
      backupEnvelope({
        settingsProjection: {
          profile: 'UX_PREFERENCES_V1',
          values: portableValues({ '/appearance/fontSize': 200 }),
        },
      }),
      backupEnvelope({ omissions: { ...backupEnvelope().omissions, extra: true } }),
      legacyBackupEnvelope({ omittedSensitiveKeys: ['z', 'a'] }),
      legacyBackupEnvelope({ omittedSensitiveKeys: ['duplicate', 'duplicate'] }),
      backupEnvelope({ modelAutomationPolicy: { ...backupEnvelope().modelAutomationPolicy, extra: true } }),
      backupEnvelope({
        modelAutomationPolicy: {
          ...backupEnvelope().modelAutomationPolicy,
          autoFailoverEnabled: 'true',
        },
      }),
    ]) {
      const { response, featureDocument } = await harness.importBackup(body);
      assertEqual(response.status, 400);
      assertEqual(response.body.ok, false);
      assertEqual(featureDocument, null);
      assertEqual(snapshot(db), before);
    }
    const malformed = await harness.importBackup(null, {
      parseFailure: new Error('invalid JSON'),
    });
    assertEqual(malformed.response.status, 400);
    assertEqual(malformed.response.body.code, 'MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID');
    assertEqual(snapshot(db), before);

    const currentRevision = db.prepare('SELECT revision FROM user_settings WHERE id=1').get().revision;
    const stale = await harness.importBackup(backupEnvelope(), {
      expectedRevision: currentRevision - 1,
    });
    assertEqual(stale.response.status, 409);
    assertEqual(stale.response.body.code, 'USER_SETTINGS_REVISION_CONFLICT');
    assertEqual(stale.response.body.expectedRevision, currentRevision - 1);
    assertEqual(stale.response.body.currentRevision, currentRevision);
    assertEqual(snapshot(db), before);

    const extraWrapperKey = await harness.importBackup(backupEnvelope(), {
      requestBody: {
        backup: backupEnvelope(),
        expectedRevision: currentRevision,
        override: true,
      },
    });
    assertEqual(extraWrapperKey.response.status, 400);
    assertEqual(extraWrapperKey.response.body.code, 'MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID');
    assertEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

await testAsync('import and reset failures roll back both settings and policy', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    createModelAutomationPolicyRepository(db).updateFromTypedApi(updateInput(1));
    writeSettingsRaw(db, '{"stable":true}');
    const harness = createSettingsRouteHarness(db);

    db.exec(`
      CREATE TRIGGER fixture_fail_backup_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'BACKUP_IMPORT'
      BEGIN
        SELECT RAISE(ABORT, 'fixture backup failure');
      END;
    `);
    const beforeImport = snapshot(db);
    const failedImport = await harness.importBackup(backupEnvelope());
    assertEqual(failedImport.response.status, 503);
    assertEqual(failedImport.featureDocument, null);
    assertEqual(snapshot(db), beforeImport);
    db.exec('DROP TRIGGER fixture_fail_backup_event');

    db.exec(`
      CREATE TRIGGER fixture_fail_reset_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'GLOBAL_RESET'
      BEGIN
        SELECT RAISE(ABORT, 'fixture reset failure');
      END;
    `);
    const beforeReset = snapshot(db);
    const failedReset = await harness.reset();
    assertEqual(failedReset.status, 503);
    assertEqual(harness.featureResetCount, 0);
    assertEqual(snapshot(db), beforeReset);
  } finally {
    db.close();
  }
});

await testAsync('general settings write failures leave policy and audit lineage unchanged', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    createModelAutomationPolicyRepository(db).updateFromTypedApi(updateInput(1));
    writeSettingsRaw(db, '{"stable":true}');
    const harness = createSettingsRouteHarness(db);

    db.exec(`
      CREATE TRIGGER fixture_fail_settings_write
      BEFORE UPDATE ON user_settings
      WHEN NEW.id = 1
      BEGIN
        SELECT RAISE(ABORT, 'fixture settings write failure');
      END;
    `);
    const beforeImport = snapshot(db);
    const failedImport = await harness.importBackup(backupEnvelope());
    assertEqual(failedImport.response.status, 503);
    assertEqual(failedImport.featureDocument, null);
    assertEqual(snapshot(db), beforeImport);
    db.exec('DROP TRIGGER fixture_fail_settings_write');

    db.exec(`
      CREATE TRIGGER fixture_fail_settings_reset
      BEFORE UPDATE ON user_settings
      WHEN NEW.id = 1 AND NEW.data = '{}'
      BEGIN
        SELECT RAISE(ABORT, 'fixture settings reset failure');
      END;
    `);
    const beforeReset = snapshot(db);
    const failedReset = await harness.reset();
    assertEqual(failedReset.status, 503);
    assertEqual(harness.featureResetCount, 0);
    assertEqual(snapshot(db), beforeReset);
  } finally {
    db.close();
  }
});

test('versioned settings operations reject foreign transaction ownership before mutation', () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    writeSettingsRaw(db, '{"stable":true}');
    const repository = createModelAutomationPolicyRepository(db);
    const before = snapshot(db);
    for (const operation of [
      () => repository.exportSettingsBackup(),
      () => repository.replaceFromSettingsImport({
        backup: backupEnvelope(),
        expectedRevision: db.prepare('SELECT revision FROM user_settings WHERE id=1').get().revision,
      }),
      () => repository.resetFromGlobalSettings(),
    ]) {
      const error = captureError(() => db.transaction(operation).immediate());
      assertPolicyError(error, 'MODEL_AUTOMATION_POLICY_TRANSACTION_OWNERSHIP_REQUIRED');
      assertEqual(snapshot(db), before);
    }
  } finally {
    db.close();
  }
});

await testAsync('versioned settings routes expose unavailable storage as 503 without runtime effects', async () => {
  const db = openDb();
  createPolicySchema(db);
  const harness = createSettingsRouteHarness(db);
  db.close();

  const backup = harness.backup();
  assertEqual(backup.status, 503);
  assertEqual(backup.body.ok, false);

  const imported = await harness.importBackup(backupEnvelope(), { expectedRevision: 1 });
  assertEqual(imported.response.status, 503);
  assertEqual(imported.response.body.ok, false);
  assertEqual(imported.featureDocument, null);

  const reset = await harness.reset();
  assertEqual(reset.status, 503);
  assertEqual(reset.body.ok, false);
  assertEqual(harness.featureResetCount, 0);
});

await testAsync('post-commit runtime and diagnostic failures remain a truthful degraded success', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const harness = createSettingsRouteHarness(db);
    harness.setFeatureFailure(new Error('fixture runtime apply failure'));
    harness.setLoggerFailure(new Error('fixture post-commit logger failure'));

    const imported = await harness.importBackup(backupEnvelope({
      settingsProjection: {
        profile: 'UX_PREFERENCES_V1',
        values: portableValues({ '/appearance/theme': 'system' }),
      },
    }));
    assertEqual(imported.response.status, 200);
    assertEqual(imported.response.body.ok, true);
    assertEqual(imported.response.body.runtimeApplied, true);
    assertEqual(imported.response.body.runtimeErrorCode, null);
    assertEqual(imported.featureDocument, null);
    assertEqual(
      JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data)
        .appearance.theme,
      'system',
    );
    assertEqual(readModelAutomationPolicy(db).revision, 2);

    const reset = await harness.reset();
    assertEqual(reset.status, 200);
    assertEqual(reset.body.ok, true);
    assertEqual(reset.body.runtimeApplied, false);
    assertEqual(reset.body.runtimeErrorCode, 'SETTINGS_RUNTIME_APPLY_FAILED');
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM user_settings').get().count, 1);
    assertEqual(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data, '{}');
    assertEqual(readModelAutomationPolicy(db).revision, 3);
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count
      FROM model_automation_policy_events
      WHERE event_kind IN ('BACKUP_IMPORT', 'GLOBAL_RESET')
    `).get().count, 2);
  } finally {
    db.close();
  }
});

await testAsync('global settings reset is one audited OFF transition on both aliases', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    const repository = createModelAutomationPolicyRepository(db);
    repository.updateFromTypedApi(updateInput(1));
    writeSettingsRaw(db, '{"custom":true}');
    const harness = createSettingsRouteHarness(db);
    const reset = await harness.reset();
    assertEqual(reset.status, 200);
    assertEqual(reset.body.ok, true);
    assertEqual(reset.body.policy.autoFailoverEnabled, false);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM user_settings').get().count, 1);
    assertEqual(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data, '{}');
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count
      FROM model_automation_policy_events
      WHERE event_kind = 'GLOBAL_RESET'
    `).get().count, 1);

    repository.updateFromTypedApi(updateInput(reset.body.policy.revision));
    writeSettingsRaw(db, '{"again":true}');
    const legacyReset = await harness.reset({ legacy: true });
    assertEqual(legacyReset.status, 200);
    assertEqual(legacyReset.body.policy.autoFailoverEnabled, false);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM user_settings').get().count, 1);
    assertEqual(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data, '{}');
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count
      FROM model_automation_policy_events
      WHERE event_kind = 'GLOBAL_RESET'
    `).get().count, 2);
    assertEqual(harness.featureResetCount, 2);
  } finally {
    db.close();
  }
});

await testAsync('backup export fails closed on malformed or invalid stored settings', async () => {
  const db = openDb();
  try {
    createPolicySchema(db);
    writeCorruptSettingsRaw(db, '{invalid');
    const before = snapshot(db);
    const response = createSettingsRouteHarness(db).backup();
    assertEqual(response.status, 503);
    assertEqual(response.body.code, 'MODEL_AUTOMATION_POLICY_STORED_GENERAL_SETTINGS_INVALID');
    assertEqual(snapshot(db), before);

    writeSettingsRaw(db, JSON.stringify({
      appearance: { theme: 'future-unreviewed-theme' },
    }));
    const invalidValue = snapshot(db);
    const invalidResponse = createSettingsRouteHarness(db).backup();
    assertEqual(invalidResponse.status, 409);
    assertEqual(
      invalidResponse.body.code,
      'MODEL_AUTOMATION_POLICY_STORED_PORTABLE_VALUE_INVALID',
    );
    assertEqual(invalidResponse.body.path, '/appearance/theme');
    assertEqual(snapshot(db), invalidValue);
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
    const reset = repository.resetFromGlobalSettings();
    assertEqual(reset.policy.revision, 3);
    assertEqual(
      JSON.stringify(reset.policy.settings),
      JSON.stringify(DEFAULT_MODEL_AUTOMATION_POLICY),
    );
    assertEqual(reset.policy.event.eventKind, 'GLOBAL_RESET');
    assertEqual(JSON.stringify(reset.settings), '{}');
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM model_automation_policy_events
      WHERE event_kind = 'GLOBAL_RESET'
    `).get().count, 1);

    const second = repository.resetFromGlobalSettings();
    assertEqual(second.policy.revision, 4);
    assertEqual(second.policy.event.eventKind, 'GLOBAL_RESET');
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM model_automation_policy_events
      WHERE event_kind = 'GLOBAL_RESET'
    `).get().count, 2);
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
