import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import {
  createStateBackup,
  discoverSupportedMigrationVersions,
  listBackups,
  restoreStateBackup,
  validateStateBackup,
} from '../src/core/db-backup.js';
import {
  _testInternals,
  acquireDatabaseOpenLease,
  acquireDatabaseRestoreLock,
  assertDatabaseFileClosed,
  assertNoDatabaseRestore,
  databaseRestoreLockPath,
  releaseDatabaseOpenLease,
  releaseDatabaseRestoreLock,
} from '../src/core/database-restore-lock.js';
import { createSystemRoutes } from '../src/routes/system.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knownMigration = '2026_02_14_001_baseline';

test('supported restore schema uses migration version constants, not source filenames', () => {
  const versions = discoverSupportedMigrationVersions(root);
  assert.equal(versions.includes('2026_02_18_006'), true);
  assert.equal(versions.includes('2026_02_18_006_v67_auto_compact'), false);
  assert.equal(new Set(versions).size, versions.length);
});

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

function currentProcessStartTicks() {
  const stat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  return stat.slice(close + 2).trim().split(/\s+/)[19];
}

function restoreLockPayload(overrides = {}) {
  return {
    contract: 'IntentSmithDatabaseRestoreLock',
    version: 1,
    pid: process.pid,
    processStartTicks: currentProcessStartTicks(),
    token: '0123456789abcdef0123456789abcdef',
    createdAt: '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
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

function waitForOutput(stream, marker, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}`)), timeoutMs);
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      output += chunk;
      if (output.includes(marker)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    stream.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
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

test('backup fails closed and publishes nothing when WAL checkpoint is incomplete', () => {
  const state = fixture();
  try {
    const result = createStateBackup(state.db, state.dataDir, {
      dbPath: state.dbPath,
      projectRoot: state.projectRoot,
      now: '2026-08-26T12:00:00.000Z',
      checkpointWal: () => [{ busy: 1, log: 1, checkpointed: 0 }],
    });
    assert.match(result.error, /^BACKUP_WAL_CHECKPOINT_INCOMPLETE:/);
    assert.equal(listBackups(state.dataDir).length, 0);
    assert.deepEqual(
      fs.readdirSync(path.join(state.dataDir, 'backups')).filter(name => name.startsWith('.partial-')),
      [],
    );
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

test('offline restore replaces the complete DB/WAL/SHM file-set without replaying newer WAL', () => {
  const state = fixture();
  try {
    const created = backup(state);
    state.db.prepare('INSERT INTO messages VALUES (?, ?, ?)')
      .run('message-after-backup', 'conversation-1', 'must not replay');
    const captured = new Map();
    for (const candidate of [state.dbPath, `${state.dbPath}-wal`, `${state.dbPath}-shm`]) {
      assert.equal(fs.existsSync(candidate), true, candidate);
      captured.set(candidate, fs.readFileSync(candidate));
    }
    state.db.close();
    state.db = null;
    for (const [candidate, bytes] of captured) fs.writeFileSync(candidate, bytes);

    const restored = restoreStateBackup(state.dataDir, created.name, {
      offline: true,
      dbPath: state.dbPath,
      projectRoot: state.projectRoot,
      supportedMigrationVersions: [knownMigration],
      now: '2026-08-26T12:02:00.000Z',
    });

    assert.equal(fs.existsSync(`${state.dbPath}-wal`), false);
    assert.equal(fs.existsSync(`${state.dbPath}-shm`), false);
    const safetyPath = path.join(state.dataDir, 'backups', restored.safetyBackupName);
    assert.equal(fs.statSync(safetyPath).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(safetyPath, 'c3.db')), true);
    assert.equal(fs.existsSync(path.join(safetyPath, 'c3.db-wal')), true);
    assert.equal(fs.existsSync(path.join(safetyPath, 'c3.db-shm')), true);

    const recovered = new Database(state.dbPath, { readonly: true });
    assert.equal(
      recovered.prepare('SELECT id FROM messages WHERE id = ?').get('message-after-backup'),
      undefined,
    );
    recovered.close();
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

test('shared database lease and exclusive restore lease cover the complete connection/restore race', () => {
  const state = fixture();
  try {
    state.db.close();
    state.db = null;
    const openLease = acquireDatabaseOpenLease(state.dbPath);
    assert.throws(
      () => acquireDatabaseRestoreLock(state.dbPath),
      error => error.code === 'DATABASE_RESTORE_TARGET_OPEN',
    );
    releaseDatabaseOpenLease(openLease);

    const restoreLease = acquireDatabaseRestoreLock(state.dbPath);
    assert.throws(
      () => acquireDatabaseOpenLease(state.dbPath),
      error => error.code === 'DATABASE_RESTORE_IN_PROGRESS',
    );
    releaseDatabaseRestoreLock(restoreLease);
    assert.doesNotThrow(() => {
      const nextOpen = acquireDatabaseOpenLease(state.dbPath);
      releaseDatabaseOpenLease(nextOpen);
    });
  } finally { cleanup(state); }
});

test('database opener keeps its shared lease while stale metadata is quarantined', () => {
  const state = fixture();
  try {
    state.db.close();
    state.db = null;
    const lockPath = databaseRestoreLockPath(state.dbPath);
    fs.writeFileSync(lockPath, `${JSON.stringify(restoreLockPayload({
      pid: 2_147_483_647,
      processStartTicks: '1',
      token: 'stale-stale-stale-stale-token',
    }))}\n`, { mode: 0o600 });
    const openLease = acquireDatabaseOpenLease(state.dbPath);
    let concurrentRestoreBlocked = false;
    assert.doesNotThrow(() => assertNoDatabaseRestore(state.dbPath, {
      beforeQuarantine() {
        assert.throws(
          () => acquireDatabaseRestoreLock(state.dbPath),
          error => error.code === 'DATABASE_RESTORE_TARGET_OPEN',
        );
        concurrentRestoreBlocked = true;
      },
    }));
    assert.equal(concurrentRestoreBlocked, true);
    releaseDatabaseOpenLease(openLease);
  } finally { cleanup(state); }
});

test('production database module holds the shared lease until its real SQLite close', async () => {
  const state = fixture();
  let child;
  try {
    state.db.close();
    state.db = null;
    const productionDbPath = path.join(state.dataDir, 'production-c3.db');
    const databaseModule = pathToFileURL(path.join(root, 'src', 'db', 'database.js')).href;
    child = spawn(process.execPath, ['--input-type=module', '-e', `
      const database = await import(${JSON.stringify(databaseModule)});
      process.stdout.write('DATABASE_LEASE_READY\\n');
      process.stdin.once('data', () => {
        database.close();
        process.stdout.write('DATABASE_LEASE_CLOSED\\n');
      });
    `], {
      env: { ...process.env, C3_DB_PATH: productionDbPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await waitForOutput(child.stdout, 'DATABASE_LEASE_READY');
    assert.throws(
      () => acquireDatabaseRestoreLock(productionDbPath),
      error => error.code === 'DATABASE_RESTORE_TARGET_OPEN',
    );
    child.stdin.end('close\n');
    await waitForOutput(child.stdout, 'DATABASE_LEASE_CLOSED');
    await new Promise((resolve, reject) => {
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`DB child exited ${code}`)));
      child.once('error', reject);
    });
    child = null;
    const restoreLease = acquireDatabaseRestoreLock(productionDbPath);
    releaseDatabaseRestoreLock(restoreLease);
  } finally {
    if (child?.pid) child.kill('SIGKILL');
    cleanup(state);
  }
});

test('unreadable process identity and process census fail closed without clearing authority', () => {
  const state = fixture();
  try {
    state.db.close();
    state.db = null;
    const lockPath = databaseRestoreLockPath(state.dbPath);
    fs.writeFileSync(lockPath, `${JSON.stringify(restoreLockPayload())}\n`, { mode: 0o600 });
    const identityIo = new Proxy(fs, {
      get(target, property) {
        if (property === 'readFileSync') {
          return (source, ...args) => {
            if (source === `/proc/${process.pid}/stat`) {
              const error = new Error('permission denied');
              error.code = 'EACCES';
              throw error;
            }
            return fs.readFileSync(source, ...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    assert.throws(
      () => assertNoDatabaseRestore(state.dbPath, { io: identityIo }),
      error => error.code === 'DATABASE_RESTORE_LOCK_OWNER_UNKNOWN',
    );
    assert.equal(fs.existsSync(lockPath), true);
    fs.unlinkSync(lockPath);

    assert.throws(
      () => assertDatabaseFileClosed(state.dbPath, {
        censusDatabaseFiles: () => ({ state: 'unknown' }),
      }),
      error => error.code === 'DATABASE_RESTORE_PROCESS_CENSUS_UNREADABLE',
    );
  } finally { cleanup(state); }
});

test('production fuser adapter treats exit 1 as closed only with completely clean diagnostics', () => {
  const pathList = ['/tmp/non-sensitive-c3.db'];
  const databaseLease = Object.freeze({
    contract: 'IntentSmithDatabaseOsLease',
    mode: 'exclusive',
    leasePath: '/tmp/non-sensitive-c3.db.restore.lease',
  });
  const runWithTarget = target => {
    let call = 0;
    return () => {
      call += 1;
      if (call === 1) {
        return {
          status: 0,
          signal: null,
          error: null,
          stdout: String(process.pid),
          stderr: 'fuser self-probe header',
        };
      }
      return target;
    };
  };
  assert.deepEqual(
    _testInternals.censusDatabaseFiles(pathList, {
      databaseLease,
      runFuser: runWithTarget({
        status: 1,
        signal: null,
        error: null,
        stdout: '',
        stderr: '',
      }),
    }),
    { state: 'closed' },
  );
  for (const result of [
    { status: 1, signal: null, error: null, stdout: '', stderr: 'Permission denied' },
    { status: 1, signal: null, error: null, stdout: 'partial', stderr: '' },
    { status: 2, signal: null, error: null, stdout: '', stderr: '' },
  ]) {
    assert.deepEqual(
      _testInternals.censusDatabaseFiles(pathList, {
        databaseLease,
        runFuser: runWithTarget(result),
      }),
      { state: 'unknown' },
    );
  }
  assert.deepEqual(
    _testInternals.censusDatabaseFiles(pathList, {
      databaseLease,
      runFuser: runWithTarget({
        status: 0,
        signal: null,
        error: null,
        stdout: '1234',
        stderr: '',
      }),
    }),
    { state: 'open' },
  );
  assert.deepEqual(
    _testInternals.censusDatabaseFiles(pathList, {
      databaseLease,
      runFuser: () => ({ status: 1, signal: null, error: null, stdout: '', stderr: '' }),
    }),
    { state: 'unknown' },
  );
});

test('stale-lock cleanup preserves a replacement live lock across the cleanup race', () => {
  const state = fixture();
  try {
    state.db.close();
    state.db = null;
    const lockPath = databaseRestoreLockPath(state.dbPath);
    const stale = restoreLockPayload({
      pid: 2_147_483_647,
      processStartTicks: '1',
      token: 'stale-stale-stale-stale-token',
    });
    const replacement = restoreLockPayload({ token: 'live-live-live-live-live-token' });
    fs.writeFileSync(lockPath, `${JSON.stringify(stale)}\n`, { mode: 0o600 });
    assert.throws(
      () => assertNoDatabaseRestore(state.dbPath, {
        beforeQuarantine() {
          fs.unlinkSync(lockPath);
          fs.writeFileSync(lockPath, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });
        },
      }),
      error => error.code === 'DATABASE_RESTORE_LOCK_CHANGED',
    );
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, replacement.token);
    fs.unlinkSync(lockPath);
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
