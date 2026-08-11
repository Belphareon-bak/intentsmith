#!/usr/bin/env node

import Database from 'better-sqlite3';
import {
  assertEqual,
  suite,
  summary,
  test,
} from './harness.js';
import {
  DEFAULT_MODEL_SETTINGS,
  UserSettingsStatus,
  readModelSettings,
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
        futureSetting: 'ignored',
      },
    }));
    const result = readModelSettings(db);
    assertEqual(result.status, UserSettingsStatus.VALID);
    assertEqual(result.valid, true);
    assertEqual(result.settings.autoFailoverEnabled, true);
    assertEqual(result.settings.autoCleanupEnabled, true);
    assertEqual(result.settings.autoCleanupDays, 30);
    assertEqual(Object.hasOwn(result.settings, 'futureSetting'), false);
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

summary();
