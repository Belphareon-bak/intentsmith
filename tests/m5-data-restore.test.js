import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  createStateBackup,
  listBackups,
  restoreStateBackup,
  validateStateBackup,
} from '../src/core/db-backup.js';
import {
  acquireDatabaseRestoreLock,
  assertNoDatabaseRestore,
  databaseRestoreLockPath,
  releaseDatabaseRestoreLock,
} from '../src/core/database-restore-lock.js';
import { createSystemRoutes } from '../src/routes/system.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knownMigration = '2026_02_14_001_baseline';

function fixture(migration = knownMigration) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m5-data-'));
  const dataDir = path.join(projectRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"version":"136.1.0"}\n');
  fs.mkdirSync(path.join(projectRoot, 'skills'));
  fs.writeFileSync(path.join(projectRoot, 'skills', 'custom.json'), '{"name":"custom"}\n');
  fs.mkdirSync(path.join(projectRoot, 'specialists', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'specialists', 'custom', 'index.js'), 'export default true;\n');
  fs.writeFileSync(path.join(dataDir, 'c3-setup.json'), '{"setup":true}\n');

  const dbPath = path.join(dataDir, 'c3.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE conversations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, content TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(migration, '2026-08-26T00:00:00Z');
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('project-1', 'Proof project');
  db.prepare('INSERT INTO conversations VALUES (?, ?, ?)')
    .run('conversation-1', 'project-1', 'Backup proof');
  db.prepare('INSERT INTO messages VALUES (?, ?, ?)')
    .run('message-1', 'conversation-1', 'durable canary');
  return { projectRoot, dataDir, dbPath, db, migration };
}

function cleanup(state) {
  try { state.db?.close(); } catch { /* already closed */ }
  fs.rmSync(state.projectRoot, { recursive: true, force: true });
}

function digest(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function backup(state, now = '2026-08-26T12:00:00.000Z') {
  const result = createStateBackup(state.db, state.dataDir, {
    dbPath: state.dbPath,
    projectRoot: state.projectRoot,
    now,
  });
  assert.equal(result.error, null, result.error);
  return result;
}

test('V2 backup is immutable, exact and marks code-bearing payload archival-only', () => {
  const state = fixture();
  try {
    const first = backup(state);
    const second = backup(state);
    assert.notEqual(first.name, second.name);
    assert.equal(fs.existsSync(first.path), true);
    assert.equal(fs.existsSync(second.path), true);
    const metadata = JSON.parse(fs.readFileSync(path.join(first.path, 'metadata.json'), 'utf8'));
    assert.equal(metadata.contract, 'IntentSmithStateBackup');
    assert.equal(metadata.format_version, 2);
    assert.deepEqual(metadata.restore_scope, ['database']);
    assert.deepEqual(metadata.archival_only, ['config', 'skills', 'specialists']);
    assert.deepEqual(metadata.migration_versions, [knownMigration]);
    assert.match(metadata.migration_fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(metadata.content_fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.ok(metadata.content_manifest.some(item => item.path === 'skills/custom.json'));
    assert.ok(metadata.content_manifest.some(item => item.path === 'specialists/custom/index.js'));
    assert.equal(listBackups(state.dataDir).filter(item => item.restorable).length, 2);
  } finally { cleanup(state); }
});

test('backup → damaged current DB → offline restore recovers exact bytes and logical state', () => {
  const state = fixture();
  try {
    const created = backup(state);
    const backupDigest = digest(path.join(created.path, 'c3.db'));
    state.db.close();
    state.db = null;
    fs.writeFileSync(state.dbPath, 'damaged current database');

    const restored = restoreStateBackup(state.dataDir, created.name, {
      offline: true,
      dbPath: state.dbPath,
      projectRoot: state.projectRoot,
      supportedMigrationVersions: [knownMigration],
      now: '2026-08-26T12:01:00.000Z',
    });
    assert.equal(restored.ok, true);
    assert.match(restored.safetyBackupName, /^pre-restore-/);
    assert.equal(digest(state.dbPath), backupDigest);

    const recovered = new Database(state.dbPath, { readonly: true });
    assert.deepEqual(recovered.prepare('SELECT id, name FROM projects').get(), {
      id: 'project-1',
      name: 'Proof project',
    });
    assert.equal(recovered.prepare('SELECT content FROM messages').get().content, 'durable canary');
    recovered.close();
    assert.equal(fs.existsSync(databaseRestoreLockPath(state.dbPath)), false);
  } finally { cleanup(state); }
});

test('missing or corrupted backup content never mutates the current database', () => {
  for (const mode of ['missing', 'corrupt', 'extra']) {
    const state = fixture();
    try {
      const created = backup(state);
      state.db.close();
      state.db = null;
      const currentDigest = digest(state.dbPath);
      if (mode === 'missing') fs.unlinkSync(path.join(created.path, 'c3.db'));
      if (mode === 'corrupt') fs.appendFileSync(path.join(created.path, 'c3.db'), 'corruption');
      if (mode === 'extra') fs.writeFileSync(path.join(created.path, 'unexpected.bin'), 'unexpected');
      assert.throws(
        () => restoreStateBackup(state.dataDir, created.name, {
          offline: true,
          dbPath: state.dbPath,
          projectRoot: state.projectRoot,
          supportedMigrationVersions: [knownMigration],
        }),
        error => /^BACKUP_/.test(error.code),
      );
      assert.equal(digest(state.dbPath), currentDigest, mode);
      assert.equal(fs.existsSync(databaseRestoreLockPath(state.dbPath)), false);
    } finally { cleanup(state); }
  }
});

test('unknown migration identity is incompatible even when backup bytes are internally valid', () => {
  const state = fixture('2099_01_01_999_unknown');
  try {
    const created = backup(state);
    state.db.close();
    state.db = null;
    const currentDigest = digest(state.dbPath);
    assert.throws(
      () => restoreStateBackup(state.dataDir, created.name, {
        offline: true,
        dbPath: state.dbPath,
        projectRoot: state.projectRoot,
        supportedMigrationVersions: [knownMigration],
      }),
      error => error.code === 'BACKUP_SCHEMA_INCOMPATIBLE',
    );
    assert.equal(digest(state.dbPath), currentDigest);
  } finally { cleanup(state); }
});

test('online and open-database restore attempts are terminal before replacement', () => {
  const state = fixture();
  try {
    const created = backup(state);
    const currentDigest = digest(state.dbPath);
    assert.throws(
      () => restoreStateBackup(state.dataDir, created.name, {
        offline: false,
        dbPath: state.dbPath,
        supportedMigrationVersions: [knownMigration],
      }),
      error => error.code === 'DATABASE_RESTORE_REQUIRES_OFFLINE',
    );
    assert.throws(
      () => restoreStateBackup(state.dataDir, created.name, {
        offline: true,
        dbPath: state.dbPath,
        projectRoot: state.projectRoot,
        supportedMigrationVersions: [knownMigration],
      }),
      error => error.code === 'DATABASE_RESTORE_TARGET_OPEN',
    );
    assert.equal(digest(state.dbPath), currentDigest);
    assert.equal(fs.existsSync(databaseRestoreLockPath(state.dbPath)), false);
  } finally { cleanup(state); }
});

test('live restore lock blocks a new database opener and stale ownership is not self-asserted', () => {
  const state = fixture();
  try {
    state.db.close();
    state.db = null;
    const lease = acquireDatabaseRestoreLock(state.dbPath);
    assert.throws(
      () => assertNoDatabaseRestore(state.dbPath),
      error => error.code === 'DATABASE_RESTORE_IN_PROGRESS',
    );
    releaseDatabaseRestoreLock(lease);
    assert.doesNotThrow(() => assertNoDatabaseRestore(state.dbPath));
  } finally { cleanup(state); }
});

test('legacy backup remains listable but automatic restore refuses its unauthenticated format', () => {
  const state = fixture();
  try {
    const legacyName = 'c3-state-2026-08-25.backup';
    const legacyPath = path.join(state.dataDir, 'backups', legacyName);
    fs.mkdirSync(legacyPath, { recursive: true });
    fs.copyFileSync(state.dbPath, path.join(legacyPath, 'c3.db'));
    fs.writeFileSync(path.join(legacyPath, 'metadata.json'), JSON.stringify({
      type: 'state',
      schema_version: 1,
      created_at: '2026-08-25T00:00:00Z',
    }));
    const listed = listBackups(state.dataDir).find(item => item.name === legacyName);
    assert.equal(listed.restorable, false);
    assert.throws(
      () => validateStateBackup(state.dataDir, legacyName, {
        supportedMigrationVersions: [knownMigration],
      }),
      error => error.code === 'BACKUP_LEGACY_FORMAT_UNSAFE',
    );
  } finally { cleanup(state); }
});

test('HTTP restore connector always returns typed offline disposition without touching body authority', () => {
  const state = fixture();
  try {
    let response = null;
    const routes = createSystemRoutes({
      db: state.db,
      sendJSON: (_res, status, body) => { response = { status, body }; },
      parseBody: async () => ({ offline: true }),
      modelRegistry: {},
    });
    routes['POST /api/system/restore']({}, {});
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'DATABASE_RESTORE_REQUIRES_OFFLINE');
    assert.match(response.body.command, /restore-state-backup\.js/);
  } finally { cleanup(state); }
});

test('offline CLI performs the same validated restore and emits no filesystem paths', () => {
  const state = fixture();
  try {
    const created = backup(state);
    state.db.close();
    state.db = null;
    fs.writeFileSync(state.dbPath, 'damaged before CLI');
    const output = execFileSync(process.execPath, [
      path.join(root, 'scripts', 'restore-state-backup.js'),
      '--data-dir', state.dataDir,
      '--backup', created.name,
      '--db-path', state.dbPath,
    ], { encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.ok, true);
    assert.equal(result.backup, created.name);
    assert.equal(output.includes(state.projectRoot), false);
    const recovered = new Database(state.dbPath, { readonly: true });
    assert.equal(recovered.prepare('SELECT content FROM messages').get().content, 'durable canary');
    recovered.close();
  } finally { cleanup(state); }
});
