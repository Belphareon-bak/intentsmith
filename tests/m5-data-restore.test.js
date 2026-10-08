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
  assert.deepEqual(
    versions.filter(version => [
      '2026_08_09_061_model_automation_policy',
      '2026_08_10_062_model_failover_proof_issuance',
      '2026_08_22_068_model_evaluation_history',
    ].includes(version)),
    [
      '2026_08_09_061_model_automation_policy',
      '2026_08_10_062_model_failover_proof_issuance',
      '2026_08_22_068_model_evaluation_history',
    ],
  );
  assert.equal(versions.includes('2099_01_01_999_unknown'), false);
  assert.equal(new Set(versions).size, versions.length);
});

test('supported restore schema rejects reintroduced historical version authorities', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m5-discovery-'));
  const migrationsDir = path.join(projectRoot, 'src', 'db', 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(
    path.join(migrationsDir, 'reintroduced.js'),
    "export const version = '2026_08_09_061_model_automation_policy';\n",
  );
  try {
    assert.throws(
      () => discoverSupportedMigrationVersions(projectRoot),
      error => error?.code === 'BACKUP_SUPPORTED_SCHEMA_DUPLICATE',
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('backup validation accepts only the exact supported historical migration stamps', () => {
  const state = fixture('2026_08_09_061_model_automation_policy');
  try {
    state.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run('2026_08_10_062_model_failover_proof_issuance', '2026-08-10T00:00:00Z');
    state.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run('2026_08_22_068_model_evaluation_history', '2026-08-22T00:00:00Z');
    const created = backup(state);
    assert.doesNotThrow(() => validateStateBackup(state.dataDir, created.name, {
      projectRoot: root,
    }));
  } finally { cleanup(state); }
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
  fs.writeFileSync(path.join(dataDir, 'intentsmith-setup.json'), '{"setup":true}\n');

  const dbPath = path.join(dataDir, 'intentsmith.db');
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
    const backupDigest = digest(path.join(created.path, 'intentsmith.db'));
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
    assert.equal(fs.existsSync(path.join(safetyPath, 'intentsmith.db')), true);
    assert.equal(fs.existsSync(path.join(safetyPath, 'intentsmith.db-wal')), true);
    assert.equal(fs.existsSync(path.join(safetyPath, 'intentsmith.db-shm')), true);

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
      if (mode === 'missing') fs.unlinkSync(path.join(created.path, 'intentsmith.db'));
      if (mode === 'corrupt') fs.appendFileSync(path.join(created.path, 'intentsmith.db'), 'corruption');
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
        projectRoot: root,
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
    const productionDbPath = path.join(state.dataDir, 'production-intentsmith.db');
    const databaseModule = pathToFileURL(path.join(root, 'src', 'db', 'database.js')).href;
    child = spawn(process.execPath, ['--input-type=module', '-e', `
      const database = await import(${JSON.stringify(databaseModule)});
      process.stdout.write('DATABASE_LEASE_READY\\n');
      process.stdin.once('data', () => {
        database.close();
        process.stdout.write('DATABASE_LEASE_CLOSED\\n');
      });
    `], {
      env: { ...process.env, INTENTSMITH_DB_PATH: productionDbPath },
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
  const pathList = ['/tmp/non-sensitive-intentsmith.db'];
  const databaseLease = Object.freeze({
    contract: 'IntentSmithDatabaseOsLease',
    mode: 'exclusive',
    leasePath: '/tmp/non-sensitive-intentsmith.db.restore.lease',
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
    const legacyName = 'intentsmith-state-2026-08-25.backup';
    const legacyPath = path.join(state.dataDir, 'backups', legacyName);
    fs.mkdirSync(legacyPath, { recursive: true });
    fs.copyFileSync(state.dbPath, path.join(legacyPath, 'intentsmith.db'));
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

function archiveIdentity(directory) {
  const entries = [];
  function walk(current, prefix = '') {
    for (const name of fs.readdirSync(current).sort()) {
      const target = path.join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(target);
      assert.equal(stat.isSymbolicLink(), false, relative);
      entries.push({
        path: relative, type: stat.isDirectory() ? 'directory' : 'file',
        dev: stat.dev, ino: stat.ino, mode: stat.mode,
        bytes: stat.isFile() ? stat.size : null,
        digest: stat.isFile() ? digest(target) : null,
        mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
      });
      if (stat.isDirectory()) walk(target, relative);
      else assert.equal(stat.isFile(), true, relative);
    }
  }
  walk(directory);
  return entries;
}

function assertNoRestoreCopies(dataDir) {
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => (
    name.startsWith('.intentsmith-db-validation-')
    || name.startsWith('.intentsmith.db.restore-')
  )), []);
}

function setArchiveModes(directory, directoryMode, fileMode) {
  fs.chmodSync(directory, directoryMode);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) setArchiveModes(target, directoryMode, fileMode);
    else fs.chmodSync(target, fileMode);
  }
}

test('WAL-backed V2 archive is unchanged through validation, restore and reuse', () => {
  const state = fixture();
  let archivePath;
  try {
    const created = backup(state);
    archivePath = created.path;
    setArchiveModes(archivePath, 0o500, 0o400);
    const archivedDb = path.join(created.path, 'intentsmith.db');
    const header = fs.readFileSync(archivedDb).subarray(0, 100);
    assert.equal(header[18], 2, 'fixture must retain SQLite WAL write-header mode');
    assert.equal(header[19], 2, 'fixture must retain SQLite WAL read-header mode');
    const frozen = archiveIdentity(created.path);
    const dataNames = fs.readdirSync(state.dataDir).sort();
    const options = { supportedMigrationVersions: [knownMigration] };
    for (let index = 0; index < 2; index += 1) {
      const validated = validateStateBackup(state.dataDir, created.name, options);
      assert.equal(validated.backupDbPath, archivedDb);
      assert.deepEqual(archiveIdentity(created.path), frozen);
      assert.deepEqual(fs.readdirSync(state.dataDir).sort(), dataNames);
    }
    state.db.close(); state.db = null;
    for (let index = 0; index < 2; index += 1) {
      fs.writeFileSync(state.dbPath, `damaged before restore ${index}`);
      const restored = restoreStateBackup(state.dataDir, created.name, {
        ...options, offline: true, dbPath: state.dbPath,
        now: `2026-08-26T12:0${index + 1}:00.000Z`,
      });
      assert.equal(restored.ok, true);
      assert.equal(restored.migrationCount, 1);
      assert.equal(digest(state.dbPath), digest(archivedDb));
      assert.deepEqual(archiveIdentity(created.path), frozen);
      assertNoRestoreCopies(state.dataDir);
      const recovered = new Database(state.dbPath, { readonly: true });
      try {
        assert.equal(recovered.prepare('SELECT content FROM messages').get().content, 'durable canary');
      } finally { recovered.close(); }
      validateStateBackup(state.dataDir, created.name, options);
      assert.deepEqual(archiveIdentity(created.path), frozen);
      assertNoRestoreCopies(state.dataDir);
    }
  } finally {
    if (archivePath) setArchiveModes(archivePath, 0o700, 0o600);
    cleanup(state);
  }
});

test('native backup validation failures clean copies and preserve the archive', () => {
  for (const mode of ['schema-mismatch', 'corrupt-database']) {
    const state = fixture();
    try {
      const created = backup(state);
      const metadataPath = path.join(created.path, 'metadata.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (mode === 'schema-mismatch') {
        metadata.migration_versions = [knownMigration, '2099_01_01_999_unknown'];
        metadata.schema_version = 2;
        metadata.migration_fingerprint = `sha256:${createHash('sha256')
          .update(JSON.stringify(metadata.migration_versions)).digest('hex')}`;
      } else {
        const archivedDb = path.join(created.path, 'intentsmith.db');
        fs.writeFileSync(archivedDb, 'not a SQLite database');
        const entry = metadata.content_manifest.find(item => item.path === 'intentsmith.db');
        entry.bytes = fs.statSync(archivedDb).size;
        entry.sha256 = `sha256:${digest(archivedDb)}`;
        metadata.content_fingerprint = `sha256:${createHash('sha256')
          .update(JSON.stringify(metadata.content_manifest)).digest('hex')}`;
      }
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      const frozen = archiveIdentity(created.path);
      const dataNames = fs.readdirSync(state.dataDir).sort();
      assert.throws(() => validateStateBackup(state.dataDir, created.name, {
        supportedMigrationVersions: [knownMigration, '2099_01_01_999_unknown'],
      }), error => error.code === (mode === 'schema-mismatch'
        ? 'BACKUP_DATABASE_SCHEMA_MISMATCH' : 'BACKUP_DATABASE_CORRUPT'));
      assert.deepEqual(archiveIdentity(created.path), frozen, mode);
      assert.deepEqual(fs.readdirSync(state.dataDir).sort(), dataNames, mode);
      assertNoRestoreCopies(state.dataDir);
    } finally { cleanup(state); }
  }
});

test('copied validation and restore bytes must match the declared database', () => {
  for (const tamperedCopy of [1, 2]) {
    const state = fixture();
    const originalCopy = fs.copyFileSync;
    try {
      const created = backup(state);
      state.db.close(); state.db = null;
      const frozen = archiveIdentity(created.path);
      const before = digest(state.dbPath);
      let copyCount = 0;
      fs.copyFileSync = (source, destination, ...args) => {
        const result = originalCopy(source, destination, ...args);
        copyCount += 1;
        if (copyCount === tamperedCopy) fs.appendFileSync(destination, 'tampered copied database');
        return result;
      };
      assert.throws(() => restoreStateBackup(state.dataDir, created.name, {
        offline: true, dbPath: state.dbPath, supportedMigrationVersions: [knownMigration],
      }), error => error.code === 'BACKUP_CONTENT_MISMATCH');
      assert.equal(digest(state.dbPath), before);
      assert.deepEqual(archiveIdentity(created.path), frozen);
      assertNoRestoreCopies(state.dataDir);
      assert.equal(fs.existsSync(databaseRestoreLockPath(state.dbPath)), false);
    } finally { fs.copyFileSync = originalCopy; cleanup(state); }
  }
});


test('validation copy preparation failures are not database corruption and clean owned files', () => {
  for (const [method, code] of [
    ['mkdtempSync', 'ENOSPC'], ['chmodSync', 'EACCES'], ['copyFileSync', 'ENOSPC'],
    ['statSync', 'EACCES'], ['readFileSync', 'EACCES'],
  ]) {
    const state = fixture();
    const original = fs[method];
    try {
      const created = backup(state);
      const frozen = archiveIdentity(created.path);
      const dataNames = fs.readdirSync(state.dataDir).sort();
      let rejected = false;
      fs[method] = (target, ...args) => {
        const validationTarget = method === 'copyFileSync' ? args[0] : target;
        if (typeof validationTarget === 'string'
          && validationTarget.startsWith(path.join(state.dataDir, '.intentsmith-db-validation-'))) {
          rejected = true;
          throw Object.assign(new Error('controlled validation-copy preparation failure'), { code });
        }
        return original(target, ...args);
      };
      assert.throws(() => validateStateBackup(state.dataDir, created.name, {
        supportedMigrationVersions: [knownMigration],
      }), error => error.code === 'BACKUP_VALIDATION_COPY_FAILED' && error.details.causeCode === code);
      fs[method] = original;
      assert.equal(rejected, true, method);
      assert.deepEqual(archiveIdentity(created.path), frozen, method);
      assert.deepEqual(fs.readdirSync(state.dataDir).sort(), dataNames, method);
      assertNoRestoreCopies(state.dataDir);
    } finally { fs[method] = original; cleanup(state); }
  }
});

// C21: retrieving archived bytes does not install or activate those bytes.
import * as archiveApi from '../src/core/db-backup.js';

function archiveFixture() {
  const state = fixture();
  const outputParent = fs.mkdtempSync('/tmp/intentsmith-m5-extract-');
  fs.chmodSync(outputParent, 0o700);
  const configBytes = Buffer.from('{"localCanary":"synthetic-only"}\n');
  const skillBytes = Buffer.from(JSON.stringify({ name: 'inert-synthetic', enabled: true, code: 'throw new Error("NEVER_EXECUTE")' }) + '\n');
  fs.writeFileSync(path.join(state.dataDir, 'intentsmith-setup.json'), configBytes);
  fs.writeFileSync(path.join(state.projectRoot, 'skills/custom.json'), skillBytes);
  const created = backup(state);
  state.db.close(); state.db = null;
  const destination = path.join(outputParent, 'recovered');
  const options = { offline: true, projectRoot: state.projectRoot, supportedMigrationVersions: [knownMigration] };
  return { ...state, created, configBytes, skillBytes, outputParent, destination, options };
}

function extractFixture(state, destination = state.destination, options = state.options) {
  assert.equal(typeof archiveApi.extractStateBackupArchive, 'function', 'missing explicit inert archival extraction capability');
  return archiveApi.extractStateBackupArchive(state.dataDir, state.created.name, destination, options);
}

function cleanupArchiveFixture(state) {
  cleanup(state);
  fs.rmSync(state.outputParent, { recursive: true, force: true });
}

function archiveSnapshot(directory) {
  const result = {};
  const visit = (current, prefix = '') => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), relative = `${prefix}${name}`;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file, `${relative}/`);
      else result[relative] = stat.isSymbolicLink() ? `link:${fs.readlinkSync(file)}` : digest(file);
    }
  };
  visit(directory);
  return result;
}

test('archive extraction recovers exact lost synthetic config/skill bytes without activation or DB replacement', () => {
  const state = archiveFixture();
  try {
    const archiveBefore = archiveSnapshot(state.created.path);
    fs.unlinkSync(path.join(state.dataDir, 'intentsmith-setup.json'));
    fs.unlinkSync(path.join(state.projectRoot, 'skills/custom.json'));
    const activeBefore = archiveSnapshot(state.projectRoot);
    const result = extractFixture(state);
    assert.equal(result.ok, true);
    assert.equal(result.activated, false);
    assert.deepEqual(result.scope, ['config', 'skills']);
    assert.deepEqual(result.files.map(item => item.path), ['config/intentsmith-setup.json', 'skills/custom.json']);
    assert.deepEqual(fs.readFileSync(path.join(state.destination, 'config/intentsmith-setup.json')), state.configBytes);
    assert.deepEqual(fs.readFileSync(path.join(state.destination, 'skills/custom.json')), state.skillBytes);
    assert.equal(fs.lstatSync(state.destination).mode & 0o777, 0o700);
    for (const item of result.files) assert.equal(fs.statSync(path.join(state.destination, item.path)).mode & 0o777, 0o600);
    assert.deepEqual(archiveSnapshot(state.projectRoot), activeBefore);
    assert.deepEqual(archiveSnapshot(state.created.path), archiveBefore);
    assert.equal(fs.existsSync(path.join(state.destination, 'specialists')), false);
    assert.equal(fs.existsSync(path.join(state.destination, 'intentsmith.db')), false);
  } finally { cleanupArchiveFixture(state); }
});

test('archive extraction CLI is explicit and preserves its default database restore mode', () => {
  const state = archiveFixture();
  try {
    const before = archiveSnapshot(state.projectRoot);
    const output = execFileSync(process.execPath, [path.join(root, 'scripts/restore-state-backup.js'),
      '--data-dir', state.dataDir, '--backup', state.created.name, '--extract-archive-to', state.destination],
    { encoding: 'utf8', timeout: 15_000 });
    const result = JSON.parse(output.trim());
    assert.equal(result.ok, true); assert.equal(result.activated, false);
    assert.deepEqual(fs.readFileSync(path.join(state.destination, 'skills/custom.json')), state.skillBytes);
    assert.deepEqual(archiveSnapshot(state.projectRoot), before);
    assert.throws(() => execFileSync(process.execPath, [path.join(root, 'scripts/restore-state-backup.js'),
      '--data-dir', state.dataDir, '--backup', state.created.name, '--db-path', state.dbPath,
      '--extract-archive-to', path.join(state.outputParent, 'other')], { stdio: 'pipe', timeout: 15_000 }),
    error => error.status === 1 && /cannot be combined/.test(error.stderr.toString()));
    assert.equal(fs.existsSync(path.join(state.outputParent, 'other')), false);
    fs.writeFileSync(state.dbPath, 'damaged synthetic DB');
    const restored = JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts/restore-state-backup.js'),
      '--data-dir', state.dataDir, '--backup', state.created.name], { encoding: 'utf8', timeout: 15_000 }).trim());
    assert.equal(restored.ok, true); assert.ok(restored.safetyBackup);
    assert.equal(digest(state.dbPath), digest(path.join(state.created.path, 'intentsmith.db')));
  } finally { cleanupArchiveFixture(state); }
});

test('archive extraction refuses corrupted manifests/payloads and unsafe boundaries before publication', async t => {
  const cases = [
    ['offline missing', s => { s.options.offline = false; }, 'BACKUP_EXTRACT_REQUIRES_OFFLINE'],
    ['invalid metadata', s => fs.writeFileSync(path.join(s.created.path, 'metadata.json'), '{'), 'BACKUP_METADATA_INVALID'],
    ['corrupted skill', s => fs.writeFileSync(path.join(s.created.path, 'skills/custom.json'), 'bad'), 'BACKUP_CONTENT_MISMATCH'],
    ['missing config', s => fs.unlinkSync(path.join(s.created.path, 'config/intentsmith-setup.json')), 'BACKUP_CONTENT_MISSING'],
    ['corrupted excluded DB', s => fs.writeFileSync(path.join(s.created.path, 'intentsmith.db'), 'bad'), 'BACKUP_CONTENT_MISMATCH'],
    ['manifest traversal', s => {
      const p = path.join(s.created.path, 'metadata.json'), m = JSON.parse(fs.readFileSync(p));
      m.content_manifest[0].path = '../outside.json'; fs.writeFileSync(p, JSON.stringify(m));
    }, 'BACKUP_MANIFEST_PATH_INVALID'],
    ['metadata symlink', s => {
      const p = path.join(s.created.path, 'metadata.json'); fs.copyFileSync(p, path.join(s.outputParent, 'metadata-copy')); fs.unlinkSync(p);
      fs.symlinkSync(path.join(s.outputParent, 'metadata-copy'), p);
    }, 'BACKUP_METADATA_INVALID'],
    ['payload symlink', s => {
      const p = path.join(s.created.path, 'skills/custom.json'); fs.unlinkSync(p);
      fs.symlinkSync(path.join(s.projectRoot, 'skills/custom.json'), p);
    }, 'BACKUP_PAYLOAD_SYMLINK'],
    ['existing destination', s => fs.mkdirSync(s.destination), 'BACKUP_EXTRACT_TARGET_EXISTS'],
    ['dangling destination symlink', s => fs.symlinkSync(path.join(s.outputParent, 'absent'), s.destination), 'BACKUP_EXTRACT_TARGET_EXISTS'],
    ['active skill destination', s => { s.destination = path.join(s.projectRoot, 'skills/recovered'); fs.chmodSync(path.dirname(s.destination), 0o700); }, 'BACKUP_EXTRACT_TARGET_ACTIVE'],
    ['active data destination', s => { s.destination = path.join(s.dataDir, 'recovered'); fs.chmodSync(s.dataDir, 0o700); }, 'BACKUP_EXTRACT_TARGET_ACTIVE'],
    ['public parent', s => fs.chmodSync(s.outputParent, 0o755), 'BACKUP_EXTRACT_PARENT_INVALID'],
    ['symlink parent', s => { fs.symlinkSync(s.outputParent, path.join(s.projectRoot, 'alias')); s.destination = path.join(s.projectRoot, 'alias/recovered'); }, 'BACKUP_EXTRACT_BOUNDARY_INVALID'],
  ];
  for (const [name, change, code] of cases) await t.test(name, () => {
    const state = archiveFixture();
    try {
      change(state);
      const activeBefore = archiveSnapshot(state.projectRoot);
      const outputBefore = archiveSnapshot(state.outputParent);
      assert.throws(() => extractFixture(state), error => error.code === code);
      assert.deepEqual(archiveSnapshot(state.projectRoot), activeBefore);
      assert.deepEqual(archiveSnapshot(state.outputParent), outputBefore);
    } finally { cleanupArchiveFixture(state); }
  });
});

test('archive extraction cleans its partial inactive output on a mid-copy write failure', t => {
  const state = archiveFixture();
  try {
    const before = archiveSnapshot(state.projectRoot);
    const original = fs.writeFileSync;
    let writes = 0;
    t.mock.method(fs, 'writeFileSync', (...args) => {
      if (typeof args[0] === 'number' && ++writes === 2) throw Object.assign(new Error('synthetic ENOSPC'), { code: 'ENOSPC' });
      return original(...args);
    });
    assert.throws(() => extractFixture(state), error => error.code === 'ENOSPC');
    assert.equal(writes, 2);
    assert.equal(fs.existsSync(state.destination), false);
    assert.deepEqual(archiveSnapshot(state.projectRoot), before);
  } finally { t.mock.restoreAll(); cleanupArchiveFixture(state); }
});

// Regression adapted from the independent V1 review; same zero-read oracle.
test('C21 independent archive parent symlink must not read an external payload', t => {
  const state = archiveFixture();
  try {
    const archiveDir = path.join(state.created.path, 'skills');
    const externalDir = path.join(state.outputParent, 'external-skills');
    fs.mkdirSync(externalDir, { mode: 0o700 });
    const externalFile = path.join(externalDir, 'custom.json');
    fs.copyFileSync(path.join(archiveDir, 'custom.json'), externalFile);
    fs.rmSync(archiveDir, { recursive: true });
    fs.symlinkSync(externalDir, archiveDir);
    const originalRead = fs.readFileSync;
    let externalReads = 0;
    t.mock.method(fs, 'readFileSync', (...args) => {
      if (typeof args[0] === 'string') {
        try { if (fs.realpathSync(args[0]) === externalFile) externalReads++; } catch {}
      }
      return originalRead(...args);
    });
    let actualError;
    try { extractFixture(state); } catch (error) { actualError = error.code; }
    t.mock.restoreAll();
    const observed = { actualError, externalReads, destinationExists: fs.existsSync(state.destination), syntheticOnly: true };
    if (process.env.C21_REVIEW_OBSERVATION) fs.writeFileSync(process.env.C21_REVIEW_OBSERVATION, JSON.stringify(observed, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    assert.equal(actualError, 'BACKUP_PAYLOAD_SYMLINK');
    assert.equal(fs.existsSync(state.destination), false);
    assert.equal(externalReads, 0, 'archive validation read payload outside the archive through a symlink parent');
  } finally { t.mock.restoreAll(); cleanupArchiveFixture(state); }
});
