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
import { up as migrateModelPolicy } from '../src/db/migrations/2026_08_09_061_model_automation_policy.js';
import { up as migrateUserSettingsRevision } from '../src/db/migrations/2026_08_10_064_user_settings_revision.js';
import {
  NOTIFICATION_SETTING_FIELD_MAP,
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

const ROUTE_WAL_WORKER_SOURCE = String.raw`
const Database = require('better-sqlite3');
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  const db = new Database(workerData.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  let response = null;
  const parseBody = async () => {
    Atomics.add(workerData.barrier, 0, 1);
    Atomics.notify(workerData.barrier, 0);
    while (Atomics.load(workerData.barrier, 1) === 0) {
      Atomics.wait(workerData.barrier, 1, 0, 5000);
    }
    return workerData.body;
  };
  const sendJSON = (_res, status, body) => { response = { status, body }; };

  try {
    if (workerData.kind === 'generic') {
      const { createMiscRoutes } = await import(workerData.miscUrl);
      const routes = createMiscRoutes({
        db: { db },
        parseBody,
        sendJSON,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        callWithAuth: async () => ({}),
        createAuthToken: () => '',
        LLMCallerRole: {},
        featureManager: { applySettings: () => 0 },
      });
      await routes['POST /api/settings']({}, {});
    } else {
      const { createNotificationRoutes } = await import(workerData.notificationsUrl);
      const routes = createNotificationRoutes({
        db: { db },
        parseBody,
        sendJSON,
        notificationRouter: {
          updateChannelConfig() {},
          getAvailableChannels: () => [],
          channels: new Map(),
        },
        notificationEmitter: { invalidateCache() {} },
      });
      await routes['POST /api/notifications/config']({}, {});
    }
    parentPort.postMessage({ kind: workerData.kind, response });
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

function notificationProjectionFromBody(body) {
  return Object.fromEntries(
    Object.entries(NOTIFICATION_SETTING_FIELD_MAP).map(
      ([field, key]) => [key, body[field]],
    ),
  );
}

function createRouteHarness(db) {
  let requestBody = {};
  let parseFailure = null;
  let genericResponse = null;
  let notificationResponse = null;
  let genericRuntimeFailure = null;
  let notificationRuntimeFailure = null;
  let featureDocument = null;
  const notificationRuntimeConfigs = [];

  const miscRoutes = createMiscRoutes({
    db: { db },
    parseBody: async () => {
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
        if (genericRuntimeFailure) throw genericRuntimeFailure;
        return 0;
      },
    },
  });
  const notificationRoutes = createNotificationRoutes({
    db: { db },
    parseBody: async () => {
      if (parseFailure) throw parseFailure;
      return requestBody;
    },
    sendJSON: (_res, status, body) => { notificationResponse = { status, body }; },
    notificationRouter: {
      updateChannelConfig(_channel, config) {
        if (notificationRuntimeFailure) throw notificationRuntimeFailure;
        notificationRuntimeConfigs.push(structuredClone(config));
      },
      getAvailableChannels: () => [],
      channels: new Map(),
    },
    notificationEmitter: {
      invalidateCache() {
        if (notificationRuntimeFailure) throw notificationRuntimeFailure;
      },
    },
  });

  return {
    get notificationRuntimeConfigs() { return notificationRuntimeConfigs; },
    setGenericRuntimeFailure(error) { genericRuntimeFailure = error; },
    setNotificationRuntimeFailure(error) { notificationRuntimeFailure = error; },
    async postGeneric(body, options = {}) {
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
    async getGeneric() {
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
  };
}

function startRouteWorker(workerData) {
  const worker = new Worker(ROUTE_WAL_WORKER_SOURCE, {
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

    const generic = await harness.postGeneric({
      appearance: { theme: 'dark' },
      models: {
        autoFailoverEnabled: true,
        futureSetting: 'preserved-generic',
      },
      'c3.notif.futureChannel': 'exact-key-only',
    });
    assertEqual(generic.response.status, 200);
    assertEqual(generic.response.body.runtimeApplied, true);
    assertEqual(
      JSON.stringify(generic.response.body.ignoredReservedKeys),
      JSON.stringify(['autoFailoverEnabled']),
    );
    assertEqual(JSON.stringify(generic.response.body.ignoredNotificationKeys), '[]');
    const afterDocument = readDocument(db);
    assertEqual(JSON.stringify(notificationProjection(afterDocument)), JSON.stringify(before));
    assertEqual(afterDocument.appearance.theme, 'dark');
    assertEqual(afterDocument.models.futureSetting, 'preserved-generic');
    assertEqual(Object.hasOwn(afterDocument.models, 'autoFailoverEnabled'), false);
    assertEqual(afterDocument['c3.notif.futureChannel'], 'exact-key-only');
  } finally {
    db.close();
  }
});

await testAsync('v2 CAS is redacted and stale generic snapshots preserve newer notification commits', async () => {
  const db = openDb();
  try {
    const harness = createRouteHarness(db);
    await harness.postNotification(INITIAL_NOTIFICATION_BODY);

    const protectedDocument = readDocument(db);
    protectedDocument.storage = { root: '/private/device/path' };
    protectedDocument.webhookSecret = 'WEBHOOK_SECRET_CANARY';
    protectedDocument.futurePrivate = 'PRIVATE_DESTINATION_CANARY';
    replaceFixtureDocument(db, JSON.stringify(protectedDocument));

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
        'c3.features.skills': false,
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
    assertEqual(
      JSON.stringify(v2Commit.featureDocument),
      JSON.stringify({ 'c3.features.skills': false }),
    );
    assertEqual(JSON.stringify(v2Commit.response.body).includes('SECRET_CANARY'), false);
    const postCasDocument = readDocument(db);
    assertEqual(postCasDocument.storage.root, '/private/device/path');
    assertEqual(postCasDocument.webhookSecret, 'WEBHOOK_SECRET_CANARY');
    assertEqual(postCasDocument.futurePrivate, 'PRIVATE_DESTINATION_CANARY');

    const beforeUnowned = readSettingsRow(db);
    const unowned = await harness.putV2({
      expectedRevision: beforeUnowned.revision,
      patch: { storage: { root: '/attacker/path' } },
    });
    assertEqual(unowned.response.status, 400);
    assertEqual(unowned.response.body.code, 'USER_SETTINGS_PATH_UNOWNED');
    assertEqual(JSON.stringify(readSettingsRow(db)), JSON.stringify(beforeUnowned));

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

    const stale = (await harness.getGeneric()).body;
    await harness.postNotification(UPDATED_NOTIFICATION_BODY);

    stale.appearance = { theme: 'light' };
    const generic = await harness.postGeneric(stale);
    assertEqual(generic.response.status, 200);
    assertEqual(
      JSON.stringify(generic.response.body.ignoredNotificationKeys),
      JSON.stringify(NOTIFICATION_SETTING_KEYS),
    );
    assertEqual(
      JSON.stringify(notificationProjection(readDocument(db))),
      JSON.stringify(notificationProjectionFromBody(UPDATED_NOTIFICATION_BODY)),
    );
    const featurePayload = JSON.stringify(generic.featureDocument);
    for (const key of NOTIFICATION_SETTING_KEYS) {
      assertEqual(Object.hasOwn(generic.featureDocument, key), false);
    }
    assertEqual(featurePayload.includes('INITIAL_SECRET_CANARY'), false);
    assertEqual(featurePayload.includes('UPDATED_SECRET_CANARY'), false);
    assertEqual(JSON.stringify(generic.response.body).includes('SECRET_CANARY'), false);
  } finally {
    db.close();
  }
});

await testAsync('two real WAL route writers preserve disjoint notification and generic changes', async () => {
  const directory = mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'settings-notification-wal-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  const setup = openDb(databasePath);
  setup.close();
  const barrier = new Int32Array(new SharedArrayBuffer(8));
  const runs = [];
  const common = {
    databasePath,
    barrier,
    miscUrl: new URL('../src/routes/misc.js', import.meta.url).href,
    notificationsUrl: new URL('../src/routes/notifications.js', import.meta.url).href,
  };

  try {
    runs.push(startRouteWorker({
      ...common,
      kind: 'generic',
      body: {
        ui: { density: 'compact' },
        models: { autoCleanupEnabled: true, futureSetting: 'wal-preserved' },
        'c3.notif.smtpPass': 'STALE_GENERIC_SECRET',
      },
    }));
    runs.push(startRouteWorker({
      ...common,
      kind: 'notification',
      body: UPDATED_NOTIFICATION_BODY,
    }));

    const deadline = Date.now() + 5000;
    while (Atomics.load(barrier, 0) < 2 && Date.now() < deadline) {
      Atomics.wait(barrier, 0, Atomics.load(barrier, 0), 50);
    }
    assertEqual(Atomics.load(barrier, 0), 2);
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1, 2);

    const results = await Promise.all(runs.map(run => run.result));
    assertEqual(results.every(result => result.response.status === 200), true);
    const genericResult = results.find(result => result.kind === 'generic');
    assertEqual(
      JSON.stringify(genericResult.response.body.ignoredNotificationKeys),
      JSON.stringify(['c3.notif.smtpPass']),
    );
    assertEqual(JSON.stringify(genericResult.response.body).includes('STALE_GENERIC_SECRET'), false);

    const verify = new Database(databasePath, { readonly: true });
    try {
      const document = readDocument(verify);
      assertEqual(document.ui.density, 'compact');
      assertEqual(document.models.futureSetting, 'wal-preserved');
      assertEqual(Object.hasOwn(document.models, 'autoCleanupEnabled'), false);
      assertEqual(document['c3.notif.smtpPass'], UPDATED_NOTIFICATION_BODY.smtpPass);
      assertEqual(
        JSON.stringify(notificationProjection(document)),
        JSON.stringify(notificationProjectionFromBody(UPDATED_NOTIFICATION_BODY)),
      );
    } finally {
      verify.close();
    }
  } finally {
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1, runs.length);
    await Promise.allSettled(runs.map(run => run.worker.terminate()));
    await Promise.allSettled(runs.map(run => run.result));
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('input, storage and post-commit runtime failures have stable truthful boundaries', async () => {
  const db = openDb();
  try {
    replaceFixtureDocument(
      db,
      JSON.stringify({ sentinel: 'original', 'c3.notif.smtpPass': 'SECRET_BOUNDARY_CANARY' }),
    );
    const harness = createRouteHarness(db);
    const original = readRaw(db);

    const genericInvalid = await harness.postGeneric(null);
    assertEqual(genericInvalid.response.status, 400);
    assertEqual(genericInvalid.response.body.code, 'USER_SETTINGS_INPUT_INVALID');
    const notificationInvalid = await harness.postNotification([]);
    assertEqual(notificationInvalid.status, 400);
    assertEqual(notificationInvalid.body.code, 'NOTIFICATION_SETTINGS_INPUT_INVALID');
    assertEqual(readRaw(db), original);

    db.exec('DROP TRIGGER trg_user_settings_revision_update_guard');
    db.prepare('UPDATE user_settings SET data = ?, revision = revision + 1 WHERE id = 1').run('{broken');
    const malformedRaw = readRaw(db);
    const malformedRead = await harness.getV2();
    assertEqual(malformedRead.status, 503);
    assertEqual(malformedRead.body.code, 'USER_SETTINGS_JSON_INVALID');
    const malformed = await harness.postGeneric({ sentinel: 'replacement' });
    assertEqual(malformed.response.status, 503);
    assertEqual(malformed.response.body.code, 'USER_SETTINGS_STORAGE_FAILED');
    assertEqual(JSON.stringify(malformed.response.body).includes('broken'), false);
    assertEqual(readRaw(db), malformedRaw);

    db.prepare('UPDATE user_settings SET data = ?, revision = revision + 1 WHERE id = 1').run(original);
    db.exec(`
      CREATE TRIGGER reject_notification_update
      BEFORE UPDATE ON user_settings
      BEGIN
        SELECT RAISE(ABORT, 'RAW_DB_ERROR_CANARY');
      END
    `);
    const rejectedRaw = readRaw(db);
    const rejected = await harness.postNotification({ smtpHost: 'rejected.invalid' });
    assertEqual(rejected.status, 503);
    assertEqual(rejected.body.code, 'NOTIFICATION_SETTINGS_STORAGE_FAILED');
    assertEqual(JSON.stringify(rejected.body).includes('RAW_DB_ERROR_CANARY'), false);
    assertEqual(readRaw(db), rejectedRaw);
    db.exec('DROP TRIGGER reject_notification_update');

    const beforeAfterTrigger = readSettingsRow(db);
    db.exec(`
      CREATE TRIGGER fixture_mutate_settings_after_update
      AFTER UPDATE ON user_settings
      WHEN json_extract(NEW.data, '$.fixtureAfterTrigger') IS NULL
      BEGIN
        UPDATE user_settings
        SET data = json_set(NEW.data, '$.fixtureAfterTrigger', 'injected'),
            revision = NEW.revision + 1
        WHERE id = 1;
      END
    `);
    const postWriteDivergence = await harness.postGeneric({ sentinel: 'must-roll-back' });
    assertEqual(postWriteDivergence.response.status, 503);
    assertEqual(postWriteDivergence.response.body.code, 'USER_SETTINGS_STORAGE_FAILED');
    assertEqual(
      JSON.stringify(readSettingsRow(db)),
      JSON.stringify(beforeAfterTrigger),
    );
    db.exec('DROP TRIGGER fixture_mutate_settings_after_update');

    harness.setGenericRuntimeFailure(new Error('GENERIC_RUNTIME_SECRET_CANARY'));
    const genericDegraded = await harness.postGeneric({ appearance: { theme: 'system' } });
    assertEqual(genericDegraded.response.status, 200);
    assertEqual(genericDegraded.response.body.success, true);
    assertEqual(genericDegraded.response.body.runtimeApplied, false);
    assertEqual(genericDegraded.response.body.runtimeErrorCode, 'SETTINGS_RUNTIME_APPLY_FAILED');
    assertEqual(readDocument(db).appearance.theme, 'system');
    assertEqual(JSON.stringify(genericDegraded.response.body).includes('SECRET_CANARY'), false);

    harness.setNotificationRuntimeFailure(new Error('NOTIFICATION_RUNTIME_SECRET_CANARY'));
    const notificationDegraded = await harness.postNotification({
      smtpHost: 'durable-before-runtime.invalid',
      smtpPass: 'DURABLE_SECRET_CANARY',
    });
    assertEqual(notificationDegraded.status, 200);
    assertEqual(notificationDegraded.body.success, true);
    assertEqual(notificationDegraded.body.runtimeApplied, false);
    assertEqual(
      notificationDegraded.body.runtimeErrorCode,
      'NOTIFICATION_RUNTIME_APPLY_FAILED',
    );
    assertEqual(readDocument(db)['c3.notif.smtpHost'], 'durable-before-runtime.invalid');
    assertEqual(readDocument(db)['c3.notif.smtpPass'], 'DURABLE_SECRET_CANARY');
    assertEqual(JSON.stringify(notificationDegraded.body).includes('SECRET_CANARY'), false);
  } finally {
    db.close();
  }
});

summary();
