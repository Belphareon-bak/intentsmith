#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import Database from 'better-sqlite3';
import { Buffer } from 'node:buffer';
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
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
import { createSecurityRoutes } from '../src/routes/security.js';
import { createSystemRoutes } from '../src/routes/system.js';
import { up as migrateModelPolicy } from '../src/db/migrations/2026_08_09_061_model_automation_policy.js';
import { up as migrateUserSettingsRevision } from '../src/db/migrations/2026_08_10_064_user_settings_revision.js';
import {
  GENERIC_USER_SETTING_PATHS,
  NOTIFICATION_SETTING_KEYS,
} from '../src/db/user-settings.js';

const USER_SETTINGS_SCHEMA = `
  CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const INITIAL_NOTIFICATION_BODY = Object.freeze({
  emailEnabled: true,
  smtpHost: 'smtp.initial.invalid',
  smtpPort: 2525,
  smtpUser: 'initial-user',
  smtpPass: 'INITIAL_SECRET_CANARY',
  smtpFrom: 'initial@example.invalid',
  emailRecipient: 'recipient@example.invalid',
  emailOnLifecycle: false,
  emailOnWorker: true,
});

const UPDATED_NOTIFICATION_BODY = Object.freeze({
  emailEnabled: false,
  smtpHost: 'smtp.updated.invalid',
  smtpPort: 465,
  smtpUser: 'updated-user',
  smtpPass: 'UPDATED_SECRET_CANARY',
  smtpFrom: 'updated@example.invalid',
  emailRecipient: 'new-recipient@example.invalid',
  emailOnLifecycle: true,
  emailOnWorker: false,
});

const EXPECTED_GENERIC_USER_SETTING_PATHS = Object.freeze([
  'c3.account.displayName',
  'c3.account.description',
  'c3.account.timezone',
  'c3.account.currency',
  'c3.language',
  'c3.llm.chatModel',
  'c3.llm.codeModel',
  'c3.llm.ollamaUrl',
  'c3.llm.temperature',
  'c3.llm.contextWindow',
  'c3.llm.timeoutChat',
  'c3.llm.timeoutCode',
  'c3.llm.numGpu',
  'c3.memory.conversationMaxTurns',
  'c3.memory.compactThreshold',
  'c3.memory.compactKeepTurns',
  'c3.memory.ltmEnabled',
  'c3.memory.ltmMaxEntries',
  'c3.memory.ltmDecayHalfLife',
  'c3.memory.contextBudgetChat',
  'c3.memory.contextBudgetCode',
  'c3.memory.contextBudgetMaxTokens',
  'c3.memory.learningEnabled',
  'c3.memory.feedbackDetection',
  'c3.memory.patternTracking',
  'c3.notif.desktopEnabled',
  'c3.notif.quietEnabled',
  'c3.notif.quietFrom',
  'c3.notif.quietTo',
  'c3.output.codeBlocks',
  'c3.output.syntaxHighlight',
  'c3.output.markdownRendering',
  'c3.output.maxResponseLength',
  'c3.system.logLevel',
  'c3.system.logRetentionDays',
  'c3.system.maxFileSize',
  'c3.system.rateLimit',
  '/appearance/theme',
  '/appearance/accentColor',
  '/appearance/fontFamily',
  '/appearance/fontSize',
  '/appearance/density',
  '/output/enabledTypes',
  '/output/defaultFormat',
  '/output/codeStyle',
  '/output/namingConvention',
]);

const STALE_ROUTE_WAL_WORKER_SOURCE = String.raw`
const Database = require('better-sqlite3');
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  const db = new Database(workerData.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  let response = null;
  let requestBody = null;
  const parseBody = async () => requestBody;
  const sendJSON = (_res, status, body) => { response = { status, body }; };

  try {
    const { createMiscRoutes } = await import(workerData.miscUrl);
    const routes = createMiscRoutes({
      db: { db },
      parseBody,
      sendJSON,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      callWithAuth: async () => ({}),
      createAuthToken: () => '',
      LLMCallerRole: {},
      featureManager: { applySettings: () => 0, resetToDefaults: () => 0 },
    });
    await routes['GET /api/settings/v2']({}, {});
    if (!response || response.status !== 200) {
      throw new Error('candidate failed to read the versioned settings snapshot');
    }
    const observedRevision = response.body.revision;
    Atomics.store(workerData.barrier, 0, 1);
    Atomics.notify(workerData.barrier, 0);
    while (Atomics.load(workerData.barrier, 1) === 0) {
      Atomics.wait(workerData.barrier, 1, 0, 5000);
    }

    response = null;
    if (workerData.kind === 'generic') {
      requestBody = {
        expectedRevision: observedRevision,
        patch: { 'c3.language': 'en' },
      };
      await routes['PUT /api/settings/v2']({}, {});
    } else {
      requestBody = {
        backup: workerData.backup,
        expectedRevision: observedRevision,
      };
      await routes['POST /api/settings/import']({}, {});
    }
    parentPort.postMessage({ kind: workerData.kind, observedRevision, response });
  } catch (error) {
    parentPort.postMessage({
      kind: 'WORKER_ERROR',
      code: error && error.code || null,
      message: error && error.stack || String(error),
    });
  } finally {
    db.close();
  }
})().catch(error => {
  parentPort.postMessage({
    kind: 'WORKER_ERROR',
    code: error && error.code || null,
    message: error && error.stack || String(error),
  });
});
`;

function openLegacyDb(databasePath = ':memory:') {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(USER_SETTINGS_SCHEMA);
  return db;
}

function openDb(databasePath = ':memory:') {
  const db = openLegacyDb(databasePath);
  db.transaction(() => migrateUserSettingsRevision(db)).immediate();
  return db;
}

function openPolicyDb(databasePath = ':memory:') {
  const db = openLegacyDb(databasePath);
  db.transaction(() => {
    migrateModelPolicy(db);
    migrateUserSettingsRevision(db);
  }).immediate();
  return db;
}

function readRaw(db) {
  return db.prepare('SELECT data FROM user_settings WHERE id = 1').get()?.data ?? null;
}

function readDocument(db) {
  const raw = readRaw(db);
  return raw === null ? {} : JSON.parse(raw);
}

function readSettingsRow(db) {
  return db.prepare(`
    SELECT id, data, updated_at, revision
    FROM user_settings
    WHERE id = 1
  `).get();
}

function replaceFixtureDocument(db, value) {
  return db.prepare(`
    UPDATE user_settings
    SET data = ?, revision = revision + 1
    WHERE id = 1
  `).run(value);
}

function readRowBytes(db) {
  return db.prepare(`
    SELECT hex(CAST(data AS BLOB)) AS dataHex, revision, updated_at AS updatedAt
    FROM user_settings
    WHERE id = 1
  `).get();
}

function backupEnvelope(overrides = {}) {
  return {
    kind: 'INTENTSMITH_SETTINGS_BACKUP',
    schemaVersion: 2,
    settingsProjection: {
      profile: 'UX_PREFERENCES_V1',
      values: {
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
        ...overrides.portableValues,
      },
    },
    modelAutomationPolicy: {
      autoFailoverEnabled: true,
      autoCleanupEnabled: true,
      autoCleanupDays: 30,
      ...overrides.modelAutomationPolicy,
    },
    omissions: {
      strategy: 'DEFAULT_DENY',
      scope: 'GENERAL_SETTINGS',
      excluded: 'ALL_PATHS_NOT_IN_PROFILE',
      sourceHadExcludedPaths: false,
    },
  };
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('expected operation to fail');
}

function notificationProjection(document) {
  return Object.fromEntries(
    NOTIFICATION_SETTING_KEYS.map(key => [key, document[key]]),
  );
}

function createRouteHarness(db) {
  let requestBody = {};
  let parseFailure = null;
  let parseCount = 0;
  let genericResponse = null;
  let notificationResponse = null;
  let securityResponse = null;
  let systemResponse = null;
  let featureDocument = null;
  const notificationRuntimeConfigs = [];

  const miscRoutes = createMiscRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { genericResponse = { status, body }; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    callWithAuth: async () => ({}),
    createAuthToken: () => '',
    LLMCallerRole: {},
    featureManager: {
      applySettings(document) {
        featureDocument = document;
        return 0;
      },
      resetToDefaults() {
        return 0;
      },
    },
  });
  const notificationRoutes = createNotificationRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { notificationResponse = { status, body }; },
    notificationRouter: {
      updateChannelConfig(_channel, config) {
        notificationRuntimeConfigs.push(structuredClone(config));
      },
      getAvailableChannels: () => [],
      channels: new Map(),
    },
    notificationEmitter: {
      invalidateCache() {},
    },
  });
  const systemRoutes = createSystemRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { systemResponse = { status, body }; },
    modelRegistry: {},
    broadcastValidation() {},
  });
  const securityRoutes = createSecurityRoutes({
    db: { db },
    parseBody: async () => {
      parseCount += 1;
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { securityResponse = { status, body }; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  return {
    get parseCount() { return parseCount; },
    get notificationRuntimeConfigs() { return notificationRuntimeConfigs; },
    async postLegacy(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      genericResponse = null;
      featureDocument = null;
      await miscRoutes['POST /api/settings']({}, {});
      parseFailure = null;
      return { response: genericResponse, featureDocument };
    },
    async postNotification(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      notificationResponse = null;
      await notificationRoutes['POST /api/notifications/config']({}, {});
      parseFailure = null;
      return notificationResponse;
    },
    async getLegacy() {
      genericResponse = null;
      await miscRoutes['GET /api/settings']({}, {});
      return genericResponse;
    },
    async getV2() {
      genericResponse = null;
      await miscRoutes['GET /api/settings/v2']({}, {});
      return genericResponse;
    },
    async putV2(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      genericResponse = null;
      featureDocument = null;
      await miscRoutes['PUT /api/settings/v2']({}, {});
      parseFailure = null;
      return { response: genericResponse, featureDocument };
    },
    async postImport(body, options = {}) {
      requestBody = body;
      parseFailure = options.parseFailure || null;
      genericResponse = null;
      await miscRoutes['POST /api/settings/import']({}, {});
      parseFailure = null;
      return genericResponse;
    },
    async postReset() {
      genericResponse = null;
      await miscRoutes['POST /api/settings/reset']({}, {});
      return genericResponse;
    },
    async putStorage(body) {
      requestBody = body;
      parseFailure = null;
      systemResponse = null;
      await systemRoutes['PUT /api/system/storage/settings']({}, {});
      return systemResponse;
    },
    async postWebhookSecret() {
      securityResponse = null;
      await securityRoutes['POST /api/security/webhook-secret']({
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      }, {});
      return securityResponse;
    },
  };
}

function startStaleRouteWorker(workerData) {
  const worker = new Worker(STALE_ROUTE_WAL_WORKER_SOURCE, {
    eval: true,
    workerData,
  });
  const result = new Promise((resolve, reject) => {
    worker.once('message', message => {
      if (message.kind === 'WORKER_ERROR') {
        reject(new Error(message.message));
      } else {
        resolve(message);
      }
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`route WAL worker exited ${code}`));
    });
  });
  return { worker, result };
}

suite('M1 settings notification authority — route-level data integrity');

await testAsync('migration guard and notification owner preserve the versioned singleton', async () => {
  const preservedDb = openLegacyDb();
  try {
    const original = ' {"duplicate":1,"duplicate":2,"sentinel":"raw-bytes"} ';
    preservedDb.prepare(`
      INSERT INTO user_settings (id, data, updated_at)
      VALUES (1, ?, '2026-08-11 00:00:00')
    `).run(original);
    const before = preservedDb.prepare(`
      SELECT hex(CAST(data AS BLOB)) AS data_hex, updated_at
      FROM user_settings WHERE id = 1
    `).get();
    preservedDb.transaction(() => migrateUserSettingsRevision(preservedDb)).immediate();
    const migrated = readSettingsRow(preservedDb);
    assertEqual(migrated.revision, 1);
    assertEqual(
      preservedDb.prepare('SELECT hex(CAST(data AS BLOB)) AS value FROM user_settings WHERE id=1').get().value,
      before.data_hex,
    );
    assertEqual(migrated.updated_at, before.updated_at);

    for (const [operation, expectedPrefix] of [
      [() => preservedDb.prepare("INSERT INTO user_settings (id,data,revision) VALUES (2,'{}',1)").run(), 'USER_SETTINGS_INSERT_FORBIDDEN:'],
      [() => preservedDb.prepare("INSERT OR REPLACE INTO user_settings (id,data,revision) VALUES (1,'{}',1)").run(), 'USER_SETTINGS_INSERT_FORBIDDEN:'],
      [() => preservedDb.prepare('DELETE FROM user_settings WHERE id=1').run(), 'USER_SETTINGS_DELETE_FORBIDDEN:'],
      [() => preservedDb.prepare("UPDATE user_settings SET data='{}' WHERE id=1").run(), 'USER_SETTINGS_REVISION_MISMATCH:'],
      [() => preservedDb.prepare("UPDATE user_settings SET data='{}', revision=revision+2 WHERE id=1").run(), 'USER_SETTINGS_REVISION_MISMATCH:'],
      [() => preservedDb.prepare("UPDATE user_settings SET id=2, data='{}', revision=revision+1 WHERE id=1").run(), 'USER_SETTINGS_REVISION_MISMATCH:'],
    ]) {
      const error = captureError(operation);
      assert(error.message.startsWith(expectedPrefix));
      assertEqual(readSettingsRow(preservedDb).revision, 1);
      assertEqual(readSettingsRow(preservedDb).data, original);
    }
    const committed = preservedDb.prepare(`
      UPDATE user_settings
      SET data='{"committed":true}', revision=revision+1
      WHERE id=1 AND revision=1
    `).run();
    assertEqual(committed.changes, 1);
    assertEqual(readSettingsRow(preservedDb).revision, 2);
  } finally {
    preservedDb.close();
  }

  const seededDb = openLegacyDb();
  try {
    seededDb.transaction(() => migrateUserSettingsRevision(seededDb)).immediate();
    const seeded = readSettingsRow(seededDb);
    assertEqual(seeded.data, '{}');
    assertEqual(seeded.revision, 1);
  } finally {
    seededDb.close();
  }

  const invalidDb = openLegacyDb();
  try {
    invalidDb.prepare("INSERT INTO user_settings (id,data) VALUES (2,'{}')").run();
    const error = captureError(
      () => invalidDb.transaction(() => migrateUserSettingsRevision(invalidDb)).immediate(),
    );
    assert(error.message.startsWith('USER_SETTINGS_REVISION_MIGRATION_INVALID:'));
    assertEqual(
      invalidDb.prepare('PRAGMA table_info(user_settings)').all().some(row => row.name === 'revision'),
      false,
    );
  } finally {
    invalidDb.close();
  }

  const foreignTriggerDb = openLegacyDb();
  try {
    foreignTriggerDb.exec(`
      CREATE TRIGGER fixture_unknown_settings_trigger
      AFTER UPDATE ON user_settings
      BEGIN
        SELECT 1;
      END
    `);
    const error = captureError(
      () => foreignTriggerDb.transaction(() => migrateUserSettingsRevision(foreignTriggerDb)).immediate(),
    );
    assert(error.message.includes('unsupported pre-existing user_settings triggers'));
    assertEqual(
      foreignTriggerDb.prepare('PRAGMA table_info(user_settings)').all()
        .some(row => row.name === 'revision'),
      false,
    );
  } finally {
    foreignTriggerDb.close();
  }

  const lateNoopPolicyDb = openLegacyDb();
  const noLegacyPolicyBytes = '{"number":1.0,"models":{"futureSetting":"keep-me"}}';
  try {
    lateNoopPolicyDb.prepare('INSERT INTO user_settings (id,data) VALUES (1,?)')
      .run(noLegacyPolicyBytes);
    lateNoopPolicyDb.transaction(() => migrateUserSettingsRevision(lateNoopPolicyDb)).immediate();
    lateNoopPolicyDb.transaction(() => migrateModelPolicy(lateNoopPolicyDb)).immediate();
    const lateRow = readSettingsRow(lateNoopPolicyDb);
    assertEqual(lateRow.revision, 1);
    assertEqual(lateRow.data, noLegacyPolicyBytes);
  } finally {
    lateNoopPolicyDb.close();
  }

  const legacyPolicyBytes = '{"number":1e2,"duplicate":1,"duplicate":2,"models":{"autoFailoverEnabled":true,"futureSetting":"keep-me"}}';
  const expectedLegacyHex = Buffer.from(legacyPolicyBytes, 'utf8').toString('hex').toUpperCase();
  for (const legacyValue of [legacyPolicyBytes, Buffer.from(legacyPolicyBytes, 'utf8')]) {
    const legacyPolicyDb = openLegacyDb();
    try {
      legacyPolicyDb.prepare('INSERT INTO user_settings (id,data) VALUES (1,?)')
        .run(legacyValue);
      const migrationError = captureError(
        () => legacyPolicyDb.transaction(() => migrateUserSettingsRevision(legacyPolicyDb)).immediate(),
      );
      assert(migrationError.message.includes('legacy model automation keys require migration 061'));
      assertEqual(
        legacyPolicyDb.prepare('PRAGMA table_info(user_settings)').all()
          .some(row => row.name === 'revision'),
        false,
      );
      assertEqual(
        legacyPolicyDb.prepare(`
          SELECT hex(CAST(data AS BLOB)) AS data_hex
          FROM user_settings WHERE id=1
        `).get().data_hex,
        expectedLegacyHex,
      );

      const expectedDocument = JSON.parse(legacyPolicyBytes);
      delete expectedDocument.models.autoFailoverEnabled;
      legacyPolicyDb.transaction(() => migrateModelPolicy(legacyPolicyDb)).immediate();
      legacyPolicyDb.transaction(() => migrateUserSettingsRevision(legacyPolicyDb)).immediate();
      assertEqual(readSettingsRow(legacyPolicyDb).revision, 1);
      assertEqual(readSettingsRow(legacyPolicyDb).data, JSON.stringify(expectedDocument));
    } finally {
      legacyPolicyDb.close();
    }
  }

  const db = openDb();
  try {
    const harness = createRouteHarness(db);
    const notification = await harness.postNotification(INITIAL_NOTIFICATION_BODY);
    assertEqual(notification.status, 200);
    const beforeUnownedNotification = readSettingsRow(db);
    const unownedNotification = await harness.postNotification({ futureCredential: 'blocked' });
    assertEqual(unownedNotification.status, 400);
    assertEqual(unownedNotification.body.code, 'NOTIFICATION_SETTINGS_INPUT_INVALID');
    assertEqual(
      JSON.stringify(readSettingsRow(db)),
      JSON.stringify(beforeUnownedNotification),
    );
    const runtimeConfigCount = harness.notificationRuntimeConfigs.length;
    const maskedOnly = await harness.postNotification({ smtpPass: '*****' });
    assertEqual(maskedOnly.status, 200);
    assertEqual(maskedOnly.body.runtimeApplied, true);
    assertEqual(harness.notificationRuntimeConfigs.length, runtimeConfigCount);
    assertEqual(
      readDocument(db)['c3.notif.smtpPass'],
      INITIAL_NOTIFICATION_BODY.smtpPass,
    );

    const masked = await harness.postNotification({
      smtpHost: 'smtp.partial.invalid',
      smtpPass: '*****',
    });
    assertEqual(masked.status, 200);
    assertEqual(
      readDocument(db)['c3.notif.smtpPass'],
      INITIAL_NOTIFICATION_BODY.smtpPass,
    );
    const partialRuntime = harness.notificationRuntimeConfigs.at(-1);
    assertEqual(partialRuntime.host, 'smtp.partial.invalid');
    assertEqual(partialRuntime.port, INITIAL_NOTIFICATION_BODY.smtpPort);
    assertEqual(partialRuntime.pass, INITIAL_NOTIFICATION_BODY.smtpPass);

    const cleared = await harness.postNotification({ smtpHost: '' });
    assertEqual(cleared.status, 200);
    assertEqual(cleared.body.runtimeApplied, false);
    assertEqual(cleared.body.runtimeErrorCode, 'NOTIFICATION_RUNTIME_APPLY_FAILED');
    assertEqual(readDocument(db)['c3.notif.smtpHost'], '');
    const before = notificationProjection(readDocument(db));

    const genericSnapshot = await harness.getV2();
    const generic = await harness.putV2({
      expectedRevision: genericSnapshot.body.revision,
      patch: { appearance: { theme: 'dark' } },
    });
    assertEqual(generic.response.status, 200);
    assertEqual(generic.response.body.revision, genericSnapshot.body.revision + 1);
    const afterDocument = readDocument(db);
    assertEqual(JSON.stringify(notificationProjection(afterDocument)), JSON.stringify(before));
    assertEqual(afterDocument.appearance.theme, 'dark');
    assertEqual(JSON.stringify(generic.response.body).includes('SECRET_CANARY'), false);
  } finally {
    db.close();
  }
});

await testAsync('versioned generic CAS is redacted and legacy settings routes are inert 410 endpoints', async () => {
  const db = openDb();
  try {
    assertEqual(new Set(GENERIC_USER_SETTING_PATHS).size, 46);
    assertEqual(
      JSON.stringify([...GENERIC_USER_SETTING_PATHS].sort()),
      JSON.stringify([...EXPECTED_GENERIC_USER_SETTING_PATHS].sort()),
    );
    const harness = createRouteHarness(db);
    await harness.postNotification(INITIAL_NOTIFICATION_BODY);

    const protectedDocument = readDocument(db);
    protectedDocument.storage = { root: '/private/device/path' };
    protectedDocument.webhookSecret = 'WEBHOOK_SECRET_CANARY';
    protectedDocument.futurePrivate = 'PRIVATE_DESTINATION_CANARY';
    replaceFixtureDocument(db, JSON.stringify(protectedDocument));

    const beforeLegacy = readRowBytes(db);
    const parseCountBeforeLegacy = harness.parseCount;
    const legacyGet = await harness.getLegacy();
    const legacyPost = await harness.postLegacy(
      { storage: { root: '/must-not-parse' } },
      { parseFailure: new Error('LEGACY_BODY_PARSE_CANARY') },
    );
    const retiredBody = { ok: false, code: 'USER_SETTINGS_LEGACY_RETIRED' };
    assertEqual(legacyGet.status, 410);
    assertEqual(JSON.stringify(legacyGet.body), JSON.stringify(retiredBody));
    assertEqual(legacyPost.response.status, 410);
    assertEqual(JSON.stringify(legacyPost.response.body), JSON.stringify(retiredBody));
    assertEqual(harness.parseCount, parseCountBeforeLegacy);
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeLegacy));

    const initialV2 = await harness.getV2();
    assertEqual(initialV2.status, 200);
    assertEqual(initialV2.body.revision, readSettingsRow(db).revision);
    assertEqual(Object.hasOwn(initialV2.body.settings, 'storage'), false);
    assertEqual(Object.hasOwn(initialV2.body.settings, 'webhookSecret'), false);
    assertEqual(Object.hasOwn(initialV2.body.settings, 'futurePrivate'), false);
    for (const key of NOTIFICATION_SETTING_KEYS) {
      assertEqual(Object.hasOwn(initialV2.body.settings, key), false);
    }
    assertEqual(JSON.stringify(initialV2.body).includes('SECRET_CANARY'), false);

    const v2Commit = await harness.putV2({
      expectedRevision: initialV2.body.revision,
      patch: {
        'c3.language': 'en',
        appearance: { theme: 'dark' },
      },
    });
    assertEqual(v2Commit.response.status, 200);
    assertEqual(v2Commit.response.body.revision, initialV2.body.revision + 1);
    assertEqual(v2Commit.response.body.settings['c3.language'], 'en');
    assertEqual(v2Commit.response.body.settings.appearance.theme, 'dark');
    assertEqual(Object.hasOwn(v2Commit.response.body.settings, 'storage'), false);
    assertEqual(Object.hasOwn(v2Commit.response.body.settings, 'webhookSecret'), false);
    assertEqual(Object.hasOwn(v2Commit.response.body.settings, 'futurePrivate'), false);
    assertEqual(v2Commit.featureDocument, null);
    assertEqual(JSON.stringify(v2Commit.response.body).includes('SECRET_CANARY'), false);
    const postCasDocument = readDocument(db);
    assertEqual(postCasDocument.storage.root, '/private/device/path');
    assertEqual(postCasDocument.webhookSecret, 'WEBHOOK_SECRET_CANARY');
    assertEqual(postCasDocument.futurePrivate, 'PRIVATE_DESTINATION_CANARY');

    db.exec(`
      CREATE TRIGGER fixture_reject_v2_settings_write
      BEFORE UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        SELECT RAISE(ABORT, 'V2_SETTINGS_WRITE_FAILURE_CANARY');
      END
    `);
    const beforeRejectedV2Write = readRowBytes(db);
    const rejectedV2Write = await harness.putV2({
      expectedRevision: beforeRejectedV2Write.revision,
      patch: { 'c3.language': 'cs' },
    });
    assertEqual(rejectedV2Write.response.status, 503);
    assertEqual(rejectedV2Write.response.body.code, 'USER_SETTINGS_DB_WRITE_FAILED');
    assertEqual(JSON.stringify(rejectedV2Write.response.body).includes('CANARY'), false);
    const afterRejectedV2Write = readRowBytes(db);
    assertEqual(afterRejectedV2Write.dataHex, beforeRejectedV2Write.dataHex);
    assertEqual(afterRejectedV2Write.revision, beforeRejectedV2Write.revision);
    assertEqual(JSON.stringify(afterRejectedV2Write), JSON.stringify(beforeRejectedV2Write));
    db.exec('DROP TRIGGER fixture_reject_v2_settings_write');

    db.exec(`
      CREATE TRIGGER fixture_diverge_v2_settings_after_write
      AFTER UPDATE OF data, revision ON user_settings
      WHEN OLD.id = 1
      BEGIN
        UPDATE user_settings
        SET data = json_set(NEW.data, '$.fixtureAfterTrigger', 'injected'),
            revision = NEW.revision + 1
        WHERE id = 1;
      END
    `);
    const beforeDivergentV2Write = readRowBytes(db);
    const divergentV2Write = await harness.putV2({
      expectedRevision: beforeDivergentV2Write.revision,
      patch: { 'c3.language': 'cs' },
    });
    assertEqual(divergentV2Write.response.status, 503);
    assertEqual(divergentV2Write.response.body.code, 'USER_SETTINGS_STORAGE_CONTRACT');
    assertEqual(
      JSON.stringify(readRowBytes(db)),
      JSON.stringify(beforeDivergentV2Write),
    );
    db.exec('DROP TRIGGER fixture_diverge_v2_settings_after_write');

    const beforeUnowned = readSettingsRow(db);
    for (const patch of [
      { storage: { root: '/attacker/path' } },
      { 'c3.features.skills': false },
    ]) {
      const unowned = await harness.putV2({
        expectedRevision: beforeUnowned.revision,
        patch,
      });
      assertEqual(unowned.response.status, 400);
      assertEqual(unowned.response.body.code, 'USER_SETTINGS_PATH_UNOWNED');
      assertEqual(JSON.stringify(readSettingsRow(db)), JSON.stringify(beforeUnowned));
    }

    const staleRevision = readSettingsRow(db).revision;
    await harness.postNotification(UPDATED_NOTIFICATION_BODY);
    const afterNotification = readSettingsRow(db);
    const staleV2 = await harness.putV2({
      expectedRevision: staleRevision,
      patch: { 'c3.language': 'cs' },
    });
    assertEqual(staleV2.response.status, 409);
    assertEqual(staleV2.response.body.code, 'USER_SETTINGS_REVISION_CONFLICT');
    assertEqual(staleV2.response.body.expectedRevision, staleRevision);
    assertEqual(staleV2.response.body.currentRevision, afterNotification.revision);
    assertEqual(JSON.stringify(readSettingsRow(db)), JSON.stringify(afterNotification));

    const beforeParseFailure = readRowBytes(db);
    const parseFailure = await harness.putV2(
      { expectedRevision: afterNotification.revision, patch: { 'c3.language': 'cs' } },
      { parseFailure: new Error('TYPED_PARSE_CANARY') },
    );
    assertEqual(parseFailure.response.status, 400);
    assertEqual(parseFailure.response.body.code, 'USER_SETTINGS_INPUT_INVALID');
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeParseFailure));

    db.exec('DROP TRIGGER trg_user_settings_revision_update_guard');
    db.prepare('UPDATE user_settings SET data = ?, revision = revision + 1 WHERE id = 1')
      .run('{broken');
    const malformedRaw = readRaw(db);
    const malformedRead = await harness.getV2();
    assertEqual(malformedRead.status, 503);
    assertEqual(malformedRead.body.code, 'USER_SETTINGS_JSON_INVALID');
    assertEqual(readRaw(db), malformedRaw);
  } finally {
    db.close();
  }
});

await testAsync('seven real-WAL stale candidates cannot overwrite any newer route-owned commit', async () => {
  const directory = mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'settings-authority-wal-'));
  const cases = [
    ['generic', 'notification'],
    ['generic', 'storage'],
    ['generic', 'webhook'],
    ['import', 'notification'],
    ['import', 'storage'],
    ['import', 'webhook'],
    ['import', 'generic'],
  ];

  try {
    for (const [candidateKind, writerKind] of cases) {
      const databasePath = path.join(directory, `${candidateKind}-${writerKind}.sqlite`);
      const setup = openPolicyDb(databasePath);
      setup.close();
      const barrier = new Int32Array(new SharedArrayBuffer(8));
      const candidate = startStaleRouteWorker({
        databasePath,
        barrier,
        kind: candidateKind,
        backup: backupEnvelope(),
        miscUrl: new URL('../src/routes/misc.js', import.meta.url).href,
      });
      let writerDb = null;
      try {
        const deadline = Date.now() + 5000;
        while (Atomics.load(barrier, 0) !== 1 && Date.now() < deadline) {
          Atomics.wait(barrier, 0, Atomics.load(barrier, 0), 50);
        }
        assertEqual(Atomics.load(barrier, 0), 1);

        writerDb = new Database(databasePath);
        writerDb.pragma('journal_mode = WAL');
        writerDb.pragma('foreign_keys = ON');
        writerDb.pragma('busy_timeout = 5000');
        const writerHarness = createRouteHarness(writerDb);
        const observedRevision = readSettingsRow(writerDb).revision;
        let writerResponse;
        let expectedWriterValue;
        if (writerKind === 'notification') {
          expectedWriterValue = `${candidateKind}.writer.invalid`;
          writerResponse = await writerHarness.postNotification({
            smtpHost: expectedWriterValue,
          });
        } else if (writerKind === 'storage') {
          expectedWriterValue = candidateKind === 'generic' ? 17 : 19;
          writerResponse = await writerHarness.putStorage({
            retention: { llm_logs: expectedWriterValue },
          });
        } else if (writerKind === 'webhook') {
          writerResponse = await writerHarness.postWebhookSecret();
          expectedWriterValue = readDocument(writerDb).webhookSecret;
        } else {
          writerResponse = (await writerHarness.putV2({
            expectedRevision: observedRevision,
            patch: { 'c3.language': 'cs' },
          })).response;
          expectedWriterValue = 'cs';
        }
        assertEqual(writerResponse.status, 200);

        const afterWriter = readRowBytes(writerDb);
        assertEqual(afterWriter.revision, observedRevision + 1);
        const afterWriterDocument = readDocument(writerDb);
        if (writerKind === 'notification') {
          assertEqual(afterWriterDocument['c3.notif.smtpHost'], expectedWriterValue);
        } else if (writerKind === 'storage') {
          assertEqual(afterWriterDocument.storage.retention.llm_logs, expectedWriterValue);
        } else if (writerKind === 'webhook') {
          assert(typeof expectedWriterValue === 'string' && expectedWriterValue.startsWith('c3_'));
        } else {
          assertEqual(afterWriterDocument['c3.language'], expectedWriterValue);
        }

        Atomics.store(barrier, 1, 1);
        Atomics.notify(barrier, 1);
        const stale = await candidate.result;
        assertEqual(stale.observedRevision, observedRevision);
        assertEqual(stale.response.status, 409);
        assertEqual(JSON.stringify(stale.response.body), JSON.stringify({
          ok: false,
          code: 'USER_SETTINGS_REVISION_CONFLICT',
          expectedRevision: observedRevision,
          currentRevision: observedRevision + 1,
        }));
        assertEqual(JSON.stringify(readRowBytes(writerDb)), JSON.stringify(afterWriter));

        const finalDocument = readDocument(writerDb);
        if (writerKind === 'notification') {
          assertEqual(finalDocument['c3.notif.smtpHost'], expectedWriterValue);
        } else if (writerKind === 'storage') {
          assertEqual(finalDocument.storage.retention.llm_logs, expectedWriterValue);
        } else if (writerKind === 'webhook') {
          assertEqual(finalDocument.webhookSecret, expectedWriterValue);
        } else {
          assertEqual(finalDocument['c3.language'], expectedWriterValue);
        }
      } finally {
        Atomics.store(barrier, 1, 1);
        Atomics.notify(barrier, 1);
        if (writerDb) writerDb.close();
        await Promise.allSettled([candidate.result]);
        await candidate.worker.terminate();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('import and reset commit settings with policy atomically and return only redacted state', async () => {
  const db = openPolicyDb();
  const readPolicyState = () => ({
    projection: db.prepare('SELECT * FROM model_automation_policy WHERE id = 1').get(),
    events: db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all(),
  });
  try {
    replaceFixtureDocument(db, JSON.stringify({
      appearance: { theme: 'dark' },
      'c3.language': 'en',
      storage: { root: '/private/device/path' },
      webhookSecret: 'WEBHOOK_SECRET_CANARY',
      'c3.notif.smtpPass': 'NOTIFICATION_SECRET_CANARY',
      futurePrivate: 'PRIVATE_DESTINATION_CANARY',
    }));
    const harness = createRouteHarness(db);
    const importRequest = {
      backup: backupEnvelope(),
      expectedRevision: readSettingsRow(db).revision,
    };

    db.exec(`
      CREATE TRIGGER fixture_reject_import_policy_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'BACKUP_IMPORT'
      BEGIN
        SELECT RAISE(ABORT, 'IMPORT_POLICY_FAILURE_CANARY');
      END
    `);
    const beforeRejectedImport = readRowBytes(db);
    const policyBeforeRejectedImport = readPolicyState();
    const rejectedImport = await harness.postImport(importRequest);
    assertEqual(rejectedImport.status, 503);
    assertEqual(rejectedImport.body.code, 'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT');
    assertEqual(JSON.stringify(rejectedImport.body).includes('CANARY'), false);
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeRejectedImport));
    assertEqual(JSON.stringify(readPolicyState()), JSON.stringify(policyBeforeRejectedImport));
    db.exec('DROP TRIGGER fixture_reject_import_policy_event');

    const imported = await harness.postImport(importRequest);
    assertEqual(imported.status, 200);
    assertEqual(imported.body.revision, importRequest.expectedRevision + 1);
    assertEqual(imported.body.settings.appearance.theme, 'light');
    assertEqual(imported.body.settings['c3.language'], 'cs');
    assertEqual(imported.body.policy.autoFailoverEnabled, true);
    assertEqual(imported.body.policy.autoCleanupEnabled, true);
    assertEqual(imported.body.policy.autoCleanupDays, 30);
    for (const key of [
      'storage',
      'webhookSecret',
      'futurePrivate',
      ...NOTIFICATION_SETTING_KEYS,
    ]) {
      assertEqual(Object.hasOwn(imported.body.settings, key), false);
    }
    assertEqual(JSON.stringify(imported.body).includes('SECRET_CANARY'), false);
    const importedDocument = readDocument(db);
    assertEqual(importedDocument.storage.root, '/private/device/path');
    assertEqual(importedDocument.webhookSecret, 'WEBHOOK_SECRET_CANARY');
    assertEqual(importedDocument['c3.notif.smtpPass'], 'NOTIFICATION_SECRET_CANARY');
    assertEqual(importedDocument.futurePrivate, 'PRIVATE_DESTINATION_CANARY');
    assertEqual(importedDocument.appearance.theme, 'light');
    assertEqual(readPolicyState().events.length, policyBeforeRejectedImport.events.length + 1);

    db.exec(`
      CREATE TRIGGER fixture_reject_reset_policy_event
      BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'GLOBAL_RESET'
      BEGIN
        SELECT RAISE(ABORT, 'RESET_POLICY_FAILURE_CANARY');
      END
    `);
    const beforeRejectedReset = readRowBytes(db);
    const policyBeforeRejectedReset = readPolicyState();
    const rejectedReset = await harness.postReset();
    assertEqual(rejectedReset.status, 503);
    assertEqual(rejectedReset.body.code, 'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT');
    assertEqual(JSON.stringify(rejectedReset.body).includes('CANARY'), false);
    assertEqual(JSON.stringify(readRowBytes(db)), JSON.stringify(beforeRejectedReset));
    assertEqual(JSON.stringify(readPolicyState()), JSON.stringify(policyBeforeRejectedReset));
    db.exec('DROP TRIGGER fixture_reject_reset_policy_event');

    const reset = await harness.postReset();
    assertEqual(reset.status, 200);
    assertEqual(reset.body.revision, beforeRejectedReset.revision + 1);
    assertEqual(JSON.stringify(reset.body.settings), '{}');
    assertEqual(reset.body.policy.autoFailoverEnabled, false);
    assertEqual(reset.body.policy.autoCleanupEnabled, false);
    assertEqual(reset.body.policy.autoCleanupDays, 14);
    assertEqual(JSON.stringify(reset.body).includes('CANARY'), false);
    assertEqual(readRaw(db), '{}');
    assertEqual(readPolicyState().events.length, policyBeforeRejectedReset.events.length + 1);
  } finally {
    db.close();
  }
});

summary();
