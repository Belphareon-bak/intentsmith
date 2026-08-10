#!/usr/bin/env node

import './helpers/isolated-test-db.js';

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
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { createMiscRoutes } from '../src/routes/misc.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
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

function openDb(databasePath = ':memory:') {
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(USER_SETTINGS_SCHEMA);
  return db;
}

function readRaw(db) {
  return db.prepare('SELECT data FROM user_settings WHERE id = 1').get()?.data ?? null;
}

function readDocument(db) {
  const raw = readRaw(db);
  return raw === null ? {} : JSON.parse(raw);
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

await testAsync('notification save followed by partial generic save preserves all nine exact values', async () => {
  const db = openDb();
  try {
    const harness = createRouteHarness(db);
    const notification = await harness.postNotification(INITIAL_NOTIFICATION_BODY);
    assertEqual(notification.status, 200);
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

await testAsync('stale generic snapshot cannot overwrite a newer notification commit', async () => {
  const db = openDb();
  try {
    const harness = createRouteHarness(db);
    await harness.postNotification(INITIAL_NOTIFICATION_BODY);
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
    db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(
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

    db.prepare('UPDATE user_settings SET data = ? WHERE id = 1').run('{broken');
    const malformedRaw = readRaw(db);
    const malformed = await harness.postGeneric({ sentinel: 'replacement' });
    assertEqual(malformed.response.status, 503);
    assertEqual(malformed.response.body.code, 'USER_SETTINGS_STORAGE_FAILED');
    assertEqual(JSON.stringify(malformed.response.body).includes('broken'), false);
    assertEqual(readRaw(db), malformedRaw);

    db.prepare('UPDATE user_settings SET data = ? WHERE id = 1').run(original);
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
