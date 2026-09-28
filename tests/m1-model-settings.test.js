#!/usr/bin/env node

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
} from './harness.js';
import {
  DEFAULT_MODEL_SETTINGS,
  UserSettingsError,
  UserSettingsStatus,
  readModelSettings,
  readUserSettings,
  updateModelSettings,
  updateUserSettings,
} from '../src/db/user-settings.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return db;
}

function writeRaw(db, value) {
  db.prepare('INSERT OR REPLACE INTO user_settings (id, data) VALUES (1, ?)').run(value);
}

function readRaw(db) {
  return db.prepare('SELECT data FROM user_settings WHERE id = 1').get()?.data ?? null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected operation to throw');
}

suite('M1 model settings — strict default-off reads');

test('valid literal booleans and cleanup days are read from the JSON authority', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({
      sentinel: { preserved: true },
      models: {
        autoFailoverEnabled: true,
        autoCleanupEnabled: true,
        autoCleanupDays: 30,
      },
    }));
    const result = readModelSettings(db);
    assertEqual(result.status, UserSettingsStatus.VALID);
    assertEqual(result.valid, true);
    assertEqual(result.settings.autoFailoverEnabled, true);
    assertEqual(result.settings.autoCleanupEnabled, true);
    assertEqual(result.settings.autoCleanupDays, 30);
  } finally {
    db.close();
  }
});

test('missing row and missing models section are both default-off', () => {
  const db = createDb();
  try {
    const missing = readModelSettings(db);
    assertEqual(missing.status, UserSettingsStatus.MISSING);
    assertEqual(missing.valid, false);
    assertEqual(missing.settings.autoFailoverEnabled, false);

    writeRaw(db, JSON.stringify({ unrelated: true }));
    const absentSection = readModelSettings(db);
    assertEqual(absentSection.status, UserSettingsStatus.VALID);
    assertEqual(absentSection.valid, true);
    assertEqual(JSON.stringify(absentSection.settings), JSON.stringify(DEFAULT_MODEL_SETTINGS));
  } finally {
    db.close();
  }
});

test('malformed JSON, scalar documents and array documents fail closed', () => {
  const db = createDb();
  try {
    for (const raw of ['{', 'true', '[]']) {
      writeRaw(db, raw);
      const result = readModelSettings(db);
      assertEqual(result.status, UserSettingsStatus.MALFORMED);
      assertEqual(result.valid, false);
      assertEqual(result.settings.autoFailoverEnabled, false);
    }
  } finally {
    db.close();
  }
});

test('non-object models and string true never enable failover', () => {
  const db = createDb();
  try {
    for (const models of [[], 'models', { autoFailoverEnabled: 'true' }]) {
      writeRaw(db, JSON.stringify({ models }));
      const result = readModelSettings(db);
      assertEqual(result.status, UserSettingsStatus.MALFORMED);
      assertEqual(result.valid, false);
      assertEqual(result.settings.autoFailoverEnabled, false);
    }
  } finally {
    db.close();
  }
});

test('a valid true sibling is erased when any owned model setting is invalid', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({
      models: {
        autoFailoverEnabled: true,
        autoCleanupDays: 0,
      },
    }));
    const result = readModelSettings(db);
    assertEqual(result.status, UserSettingsStatus.MALFORMED);
    assertEqual(result.valid, false);
    assertEqual(result.settings.autoFailoverEnabled, false);
    assertEqual(JSON.stringify(result.settings), JSON.stringify(DEFAULT_MODEL_SETTINGS));
  } finally {
    db.close();
  }
});

test('DB read failure is typed and default-off', () => {
  const db = createDb();
  db.close();
  const result = readModelSettings(db);
  assertEqual(result.status, UserSettingsStatus.DB_ERROR);
  assertEqual(result.valid, false);
  assertEqual(result.settings.autoFailoverEnabled, false);
});

suite('M1 model settings — transactional owned updates');

test('model update preserves unrelated document and unknown model keys', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({
      sentinel: { preserved: true },
      models: { futureSetting: 'keep-me', autoCleanupDays: 9 },
    }));
    const persisted = updateModelSettings(db, { autoFailoverEnabled: true });
    const document = readUserSettings(db);
    assertEqual(document.status, UserSettingsStatus.VALID);
    assertEqual(document.settings.sentinel.preserved, true);
    assertEqual(document.settings.models.futureSetting, 'keep-me');
    assertEqual(document.settings.models.autoCleanupDays, 9);
    assertEqual(document.settings.models.autoFailoverEnabled, true);
    assertEqual(persisted.autoFailoverEnabled, true);
  } finally {
    db.close();
  }
});

test('persisted opt-in survives close and reopen through a new DB connection', () => {
  const directory = mkdtempSync(path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'settings-restart-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  let db = new Database(databasePath);
  try {
    db.exec(`
      CREATE TABLE user_settings (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    updateModelSettings(db, { autoFailoverEnabled: true });
    db.close();
    db = new Database(databasePath, { readonly: true });
    const restartedReader = readModelSettings(db);
    assertEqual(restartedReader.valid, true);
    assertEqual(restartedReader.settings.autoFailoverEnabled, true);
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: false });
  }
});

test('updates acquire an IMMEDIATE reservation before read-modify-write', () => {
  const db = createDb();
  try {
    const originalTransaction = db.transaction.bind(db);
    let invokedMode = null;
    const facade = {
      prepare: db.prepare.bind(db),
      transaction(fn) {
        const transaction = originalTransaction(fn);
        const wrapped = (...args) => {
          invokedMode = 'deferred';
          return transaction(...args);
        };
        wrapped.immediate = (...args) => {
          invokedMode = 'immediate';
          return transaction.immediate(...args);
        };
        return wrapped;
      },
    };

    updateModelSettings(facade, { autoFailoverEnabled: true });
    assertEqual(invokedMode, 'immediate');
    assertEqual(readModelSettings(db).settings.autoFailoverEnabled, true);
  } finally {
    db.close();
  }
});

test('malformed persisted settings are preserved instead of overwritten', () => {
  const db = createDb();
  try {
    writeRaw(db, '{broken');
    const before = readRaw(db);
    const error = captureError(() => updateModelSettings(db, { autoFailoverEnabled: true }));
    assert(error instanceof UserSettingsError);
    assertEqual(error.code, 'USER_SETTINGS_JSON_INVALID');
    assertEqual(readRaw(db), before);
  } finally {
    db.close();
  }
});

test('validation rejects invalid values and unknown owned keys without mutation', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({ sentinel: 1 }));
    const before = readRaw(db);
    for (const [patch, expectedCode] of [
      [{ autoFailoverEnabled: 'true' }, 'AUTO_FAILOVER_ENABLED_NOT_BOOLEAN'],
      [{ autoCleanupEnabled: 1 }, 'AUTO_CLEANUP_ENABLED_NOT_BOOLEAN'],
      [{ autoCleanupDays: 0 }, 'AUTO_CLEANUP_DAYS_OUT_OF_RANGE'],
      [{ autoCleanupDays: 3651 }, 'AUTO_CLEANUP_DAYS_OUT_OF_RANGE'],
      [{ inventedSetting: true }, 'MODEL_SETTINGS_KEY_UNKNOWN'],
    ]) {
      const error = captureError(() => updateModelSettings(db, patch));
      assert(error instanceof UserSettingsError);
      assertEqual(error.code, expectedCode);
      assertEqual(readRaw(db), before);
    }

    writeRaw(db, JSON.stringify({ sentinel: 1, models: 'broken' }));
    const malformedBefore = readRaw(db);
    const malformedError = captureError(() => updateModelSettings(db, { autoFailoverEnabled: true }));
    assertEqual(malformedError.code, 'MODEL_SETTINGS_NOT_OBJECT');
    assertEqual(readRaw(db), malformedBefore);
  } finally {
    db.close();
  }
});

test('updater failure rolls back and preserves the original blob', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({ sentinel: 'original' }));
    const before = readRaw(db);
    const error = captureError(() => updateUserSettings(db, (document) => {
      document.sentinel = 'changed';
      throw new Error('fixture updater failed');
    }));
    assert(error instanceof UserSettingsError);
    assertEqual(error.code, 'USER_SETTINGS_UPDATER_FAILED');
    assertEqual(readRaw(db), before);
  } finally {
    db.close();
  }
});

test('serialization failure is typed and preserves the original blob', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({ sentinel: 'original' }));
    const before = readRaw(db);
    const error = captureError(() => updateUserSettings(db, (document) => {
      document.unsupported = 1n;
    }));
    assert(error instanceof UserSettingsError);
    assertEqual(error.code, 'USER_SETTINGS_SERIALIZATION_FAILED');
    assertEqual(readRaw(db), before);
  } finally {
    db.close();
  }
});

test('SQLite write failure rolls back and preserves the original blob', () => {
  const db = createDb();
  try {
    writeRaw(db, JSON.stringify({ sentinel: 'original' }));
    db.exec(`
      CREATE TRIGGER reject_user_settings_update
      BEFORE UPDATE ON user_settings
      BEGIN
        SELECT RAISE(ABORT, 'fixture write rejected');
      END
    `);
    const before = readRaw(db);
    const error = captureError(() => updateModelSettings(db, { autoFailoverEnabled: true }));
    assert(error instanceof UserSettingsError);
    assertEqual(error.code, 'USER_SETTINGS_DB_WRITE_FAILED');
    assertEqual(readRaw(db), before);
  } finally {
    db.close();
  }
});

summary();
