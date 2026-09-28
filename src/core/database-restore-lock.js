import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const LOCK_CONTRACT = 'IntentSmithDatabaseRestoreLock';
const LOCK_VERSION = 1;
const MAX_LOCK_BYTES = 16 * 1024;
const FUSER_PATH = '/usr/bin/fuser';
const FLOCK_PATH = '/usr/bin/flock';
const releasedOsLeases = new WeakSet();

export class DatabaseRestoreLockError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DatabaseRestoreLockError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function databaseRestoreLockPath(dbPath) {
  return `${path.resolve(dbPath)}.restore.lock`;
}

export function databaseRestoreLeasePath(dbPath) {
  return `${path.resolve(dbPath)}.restore.lease`;
}

function ioFrom(opts) {
  return opts?.io || fs;
}

function acquireOsLease(dbPath, mode, opts = {}) {
  const io = ioFrom(opts);
  const leasePath = databaseRestoreLeasePath(dbPath);
  io.mkdirSync(path.dirname(leasePath), { recursive: true });
  let descriptor;
  try {
    descriptor = io.openSync(
      leasePath,
      fs.constants.O_CREAT
        | fs.constants.O_RDWR
        | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    const opened = io.fstatSync(descriptor);
    const current = io.statSync(leasePath);
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || opened.dev !== current.dev
      || opened.ino !== current.ino
    ) {
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_LEASE_INVALID',
        'Database lease path is not a stable regular file',
      );
    }
    io.fchmodSync(descriptor, 0o600);

    // flock locks the inherited open-file description. The lock therefore
    // remains held by this process after the short helper exits and is released
    // only when releaseOsLease closes the original descriptor.
    const runFlock = opts.runFlock || spawnSync;
    const result = runFlock(FLOCK_PATH, [
      mode === 'shared' ? '--shared' : '--exclusive',
      '--nonblock',
      '3',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', descriptor],
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.error || result.signal || result.status !== 0) {
      const contention = result.status === 1 && !result.error && !result.signal;
      throw new DatabaseRestoreLockError(
        contention
          ? (mode === 'shared' ? 'DATABASE_RESTORE_IN_PROGRESS' : 'DATABASE_RESTORE_TARGET_OPEN')
          : 'DATABASE_RESTORE_LEASE_UNAVAILABLE',
        contention
          ? (mode === 'shared'
            ? 'Database cannot be opened while an offline restore owns the exclusive lease'
            : 'Offline restore refused because a database opener owns the shared lease')
          : 'Database lease could not be acquired safely',
      );
    }
    return Object.freeze({
      contract: 'IntentSmithDatabaseOsLease',
      mode,
      leasePath,
      dbPath: path.resolve(dbPath),
      descriptor,
    });
  } catch (error) {
    if (descriptor !== undefined) {
      try { io.closeSync(descriptor); } catch { /* owned descriptor cleanup */ }
    }
    if (error instanceof DatabaseRestoreLockError) throw error;
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LEASE_UNAVAILABLE',
      'Database lease could not be acquired safely',
    );
  }
}

function releaseOsLease(lease, opts = {}) {
  if (!lease || releasedOsLeases.has(lease)) {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LEASE_OWNERSHIP_LOST',
      'Database lease is missing or was already released',
    );
  }
  const io = ioFrom(opts);
  try {
    io.closeSync(lease.descriptor);
    releasedOsLeases.add(lease);
  } catch {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LEASE_OWNERSHIP_LOST',
      'Database lease could not be released safely',
    );
  }
}

export function acquireDatabaseOpenLease(dbPath, opts = {}) {
  return acquireOsLease(dbPath, 'shared', opts);
}

export function releaseDatabaseOpenLease(lease, opts = {}) {
  releaseOsLease(lease, opts);
}

function processStartIdentity(pid, opts = {}) {
  const io = ioFrom(opts);
  const procRoot = opts.procRoot || '/proc';
  try {
    const stat = io.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return Object.freeze({ state: 'unknown', ticks: null });
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const ticks = fields[19];
    if (typeof ticks !== 'string' || !/^\d+$/.test(ticks)) {
      return Object.freeze({ state: 'unknown', ticks: null });
    }
    return Object.freeze({ state: 'present', ticks });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') {
      return Object.freeze({ state: 'absent', ticks: null });
    }
    return Object.freeze({ state: 'unknown', ticks: null });
  }
}

function validateLockPayload(parsed) {
  if (
    parsed?.contract !== LOCK_CONTRACT
    || parsed?.version !== LOCK_VERSION
    || !Number.isSafeInteger(parsed?.pid)
    || parsed.pid <= 0
    || typeof parsed?.processStartTicks !== 'string'
    || !/^\d+$/.test(parsed.processStartTicks)
    || typeof parsed?.token !== 'string'
    || parsed.token.length < 16
  ) {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_INVALID',
      'Database restore lock is malformed and cannot be cleared safely',
    );
  }
  return parsed;
}

function readLockSnapshot(lockPath, opts = {}) {
  const io = ioFrom(opts);
  let descriptor;
  try {
    descriptor = io.openSync(
      lockPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_UNREADABLE',
      'Database restore lock cannot be opened safely',
    );
  }

  try {
    const stat = io.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_LOCK_BYTES) {
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_LOCK_INVALID',
        'Database restore lock is not a bounded regular file',
      );
    }
    let parsed;
    try {
      parsed = validateLockPayload(JSON.parse(io.readFileSync(descriptor, 'utf8')));
    } catch (error) {
      if (error instanceof DatabaseRestoreLockError) throw error;
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_LOCK_INVALID',
        'Database restore lock is malformed and cannot be cleared safely',
      );
    }
    return Object.freeze({
      lockPath,
      dev: stat.dev,
      ino: stat.ino,
      payload: Object.freeze(parsed),
    });
  } finally {
    try { io.closeSync(descriptor); } catch { /* owned descriptor cleanup */ }
  }
}

function sameSnapshot(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.payload.token === right.payload.token
    && left.payload.pid === right.payload.pid
    && left.payload.processStartTicks === right.payload.processStartTicks,
  );
}

function lockOwnerState(snapshot, opts = {}) {
  const identity = processStartIdentity(snapshot.payload.pid, opts);
  if (identity.state === 'unknown') return 'unknown';
  if (identity.state === 'absent') return 'stale';
  return identity.ticks === snapshot.payload.processStartTicks ? 'live' : 'stale';
}

function restoreQuarantinedLock(quarantinePath, lockPath, opts = {}) {
  const io = ioFrom(opts);
  try {
    // linkSync is create-if-absent. Unlike renameSync it cannot overwrite a
    // concurrent live owner that appeared after quarantine.
    io.linkSync(quarantinePath, lockPath);
    io.unlinkSync(quarantinePath);
    return true;
  } catch {
    // Never delete an identity that may be live. If a concurrent owner already
    // occupies lockPath, the quarantined file remains as evidence.
    return false;
  }
}

function quarantineAndRemove(snapshot, opts = {}) {
  const io = ioFrom(opts);
  const quarantinePath = `${snapshot.lockPath}.quarantine-${randomUUID()}`;
  opts.beforeQuarantine?.(snapshot);
  try {
    io.renameSync(snapshot.lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ removed: false, changed: true });
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_UNREADABLE',
      'Database restore lock could not be quarantined safely',
    );
  }

  let moved;
  try {
    moved = readLockSnapshot(quarantinePath, opts);
  } catch (error) {
    restoreQuarantinedLock(quarantinePath, snapshot.lockPath, opts);
    throw error;
  }
  if (!sameSnapshot(snapshot, moved)) {
    restoreQuarantinedLock(quarantinePath, snapshot.lockPath, opts);
    return Object.freeze({ removed: false, changed: true });
  }

  try {
    io.unlinkSync(quarantinePath);
  } catch (error) {
    restoreQuarantinedLock(quarantinePath, snapshot.lockPath, opts);
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_UNREADABLE',
      'Quarantined database restore lock could not be removed safely',
    );
  }
  return Object.freeze({ removed: true, changed: false });
}

function clearStaleLock(lockPath, opts = {}) {
  const snapshot = readLockSnapshot(lockPath, opts);
  if (!snapshot) return true;
  const ownerState = lockOwnerState(snapshot, opts);
  if (ownerState === 'live') return false;
  if (ownerState === 'unknown') {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_OWNER_UNKNOWN',
      'Database restore lock owner identity cannot be established safely',
    );
  }

  const result = quarantineAndRemove(snapshot, opts);
  if (result.changed) {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_CHANGED',
      'Database restore lock identity changed during stale cleanup',
    );
  }
  return true;
}

export function assertNoDatabaseRestore(dbPath, opts = {}) {
  const lockPath = databaseRestoreLockPath(dbPath);
  if (clearStaleLock(lockPath, opts)) return;
  throw new DatabaseRestoreLockError(
    'DATABASE_RESTORE_IN_PROGRESS',
    'Database cannot be opened while an offline restore owns the restore lock',
  );
}

export function acquireDatabaseRestoreLock(dbPath, opts = {}) {
  const io = ioFrom(opts);
  const resolvedDbPath = path.resolve(dbPath);
  const lockPath = databaseRestoreLockPath(resolvedDbPath);
  io.mkdirSync(path.dirname(lockPath), { recursive: true });
  const osLease = acquireOsLease(resolvedDbPath, 'exclusive', opts);

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      const identity = processStartIdentity(process.pid, opts);
      if (identity.state !== 'present') {
        throw new DatabaseRestoreLockError(
          'DATABASE_RESTORE_PLATFORM_UNSUPPORTED',
          'Supported Linux /proc process identity is unavailable',
        );
      }
      const payload = {
        contract: LOCK_CONTRACT,
        version: LOCK_VERSION,
        pid: process.pid,
        processStartTicks: identity.ticks,
        token,
        createdAt: new Date().toISOString(),
      };

      try {
        io.writeFileSync(lockPath, `${JSON.stringify(payload)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        return Object.freeze({ lockPath, token, dbPath: resolvedDbPath, osLease });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (!clearStaleLock(lockPath, opts)) {
          throw new DatabaseRestoreLockError(
            'DATABASE_RESTORE_IN_PROGRESS',
            'Another live process owns the database restore lock',
          );
        }
      }
    }

    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_UNAVAILABLE',
      'Database restore lock could not be acquired',
    );
  } catch (error) {
    releaseOsLease(osLease, opts);
    throw error;
  }
}

export function releaseDatabaseRestoreLock(lease, opts = {}) {
  try {
    const current = readLockSnapshot(lease?.lockPath, opts);
    if (
      !current
      || current.payload.token !== lease?.token
      || current.payload.pid !== process.pid
    ) {
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_LOCK_OWNERSHIP_LOST',
        'Database restore lock ownership changed before release',
      );
    }
    const result = quarantineAndRemove(current, opts);
    if (!result.removed) {
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_LOCK_OWNERSHIP_LOST',
        'Database restore lock ownership changed before release',
      );
    }
  } finally {
    releaseOsLease(lease?.osLease, opts);
  }
}

function databaseFileSet(dbPath, opts = {}) {
  const io = ioFrom(opts);
  const resolved = path.resolve(dbPath);
  const targets = [];
  for (const candidate of [resolved, `${resolved}-wal`, `${resolved}-shm`]) {
    let stat;
    try {
      stat = io.statSync(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_TARGET_UNREADABLE',
        `Current database file-set cannot be inspected: ${error.message}`,
      );
    }
    if (!stat.isFile()) {
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_TARGET_UNREADABLE',
        'Current database file-set contains a non-regular entry',
      );
    }
    targets.push(Object.freeze({ path: candidate, dev: stat.dev, ino: stat.ino }));
  }
  return targets;
}

function censusError(message) {
  return new DatabaseRestoreLockError(
    'DATABASE_RESTORE_PROCESS_CENSUS_UNREADABLE',
    message,
  );
}

function censusDatabaseFiles(paths, opts = {}) {
  if (opts.censusDatabaseFiles) return opts.censusDatabaseFiles(paths);
  if (
    opts.databaseLease?.contract !== 'IntentSmithDatabaseOsLease'
    || opts.databaseLease.mode !== 'exclusive'
  ) {
    return Object.freeze({ state: 'unknown' });
  }
  const runFuser = opts.runFuser || spawnSync;
  const spawnOptions = {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  };

  // Exit 1 alone is ambiguous in fuser(1): it means either no holder or a
  // fatal error. First require a positive self-probe against the lease inode
  // that this process demonstrably has open, then classify the target call.
  const probe = runFuser(FUSER_PATH, ['-v', opts.databaseLease.leasePath], spawnOptions);
  const visiblePids = String(probe.stdout || '').match(/\d+/g) || [];
  if (
    probe.error
    || probe.signal
    || probe.status !== 0
    || !visiblePids.includes(String(process.pid))
  ) {
    return Object.freeze({ state: 'unknown' });
  }

  const result = runFuser(FUSER_PATH, ['-v', ...paths], spawnOptions);
  if (result.error || result.signal) {
    return Object.freeze({ state: 'unknown' });
  }
  if (result.status === 0) return Object.freeze({ state: 'open' });
  if (
    result.status === 1
    && String(result.stdout || '').trim() === ''
    && String(result.stderr || '').trim() === ''
  ) {
    return Object.freeze({ state: 'closed' });
  }
  return Object.freeze({ state: 'unknown' });
}

export function assertDatabaseFileClosed(dbPath, opts = {}) {
  const targets = databaseFileSet(dbPath, opts);
  if (targets.length === 0) return;
  const census = censusDatabaseFiles(targets.map(target => target.path), opts);
  if (census?.state === 'unknown') {
    throw censusError('Database file holder census is unavailable or unreadable');
  }
  if (census?.state !== 'closed') {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_TARGET_OPEN',
      'Offline restore refused because the current database file-set is open',
    );
  }
}

export const _testInternals = Object.freeze({
  clearStaleLock,
  censusDatabaseFiles,
  processStartIdentity,
  readLockSnapshot,
});
