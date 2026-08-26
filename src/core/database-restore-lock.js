import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_CONTRACT = 'IntentSmithDatabaseRestoreLock';
const LOCK_VERSION = 1;

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

function processStartTicks(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    return fields[19] || null;
  } catch {
    return null;
  }
}

function parseLock(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (
      parsed?.contract !== LOCK_CONTRACT
      || parsed?.version !== LOCK_VERSION
      || !Number.isSafeInteger(parsed?.pid)
      || parsed.pid <= 0
      || typeof parsed?.processStartTicks !== 'string'
      || typeof parsed?.token !== 'string'
      || parsed.token.length < 16
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ownerIsLive(lock) {
  return lock && processStartTicks(lock.pid) === lock.processStartTicks;
}

function clearStaleLock(lockPath) {
  const parsed = parseLock(lockPath);
  if (ownerIsLive(parsed)) return false;
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_UNREADABLE',
      'Database restore lock cannot be validated or cleared',
    );
  }
}

export function assertNoDatabaseRestore(dbPath) {
  const lockPath = databaseRestoreLockPath(dbPath);
  if (!fs.existsSync(lockPath)) return;
  if (clearStaleLock(lockPath)) return;
  throw new DatabaseRestoreLockError(
    'DATABASE_RESTORE_IN_PROGRESS',
    'Database cannot be opened while an offline restore owns the restore lock',
  );
}

export function acquireDatabaseRestoreLock(dbPath) {
  const resolvedDbPath = path.resolve(dbPath);
  const lockPath = databaseRestoreLockPath(resolvedDbPath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    const payload = {
      contract: LOCK_CONTRACT,
      version: LOCK_VERSION,
      pid: process.pid,
      processStartTicks: processStartTicks(process.pid),
      token,
      createdAt: new Date().toISOString(),
    };
    if (!payload.processStartTicks) {
      throw new DatabaseRestoreLockError(
        'DATABASE_RESTORE_PLATFORM_UNSUPPORTED',
        'Supported Linux /proc process identity is unavailable',
      );
    }

    try {
      fs.writeFileSync(lockPath, `${JSON.stringify(payload)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return Object.freeze({ lockPath, token, dbPath: resolvedDbPath });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (!clearStaleLock(lockPath)) {
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
}

export function releaseDatabaseRestoreLock(lease) {
  const current = parseLock(lease?.lockPath);
  if (!current || current.token !== lease?.token || current.pid !== process.pid) {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_LOCK_OWNERSHIP_LOST',
      'Database restore lock ownership changed before release',
    );
  }
  fs.unlinkSync(lease.lockPath);
}

export function assertDatabaseFileClosed(dbPath) {
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) return;

  let target;
  try {
    target = fs.statSync(resolved);
  } catch (error) {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_TARGET_UNREADABLE',
      `Current database cannot be inspected: ${error.message}`,
    );
  }

  const holders = [];
  for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    const fdRoot = `/proc/${entry.name}/fd`;
    let descriptors;
    try { descriptors = fs.readdirSync(fdRoot); } catch { continue; }
    for (const descriptor of descriptors) {
      try {
        const opened = fs.statSync(path.join(fdRoot, descriptor));
        if (opened.dev === target.dev && opened.ino === target.ino) {
          holders.push(pid);
          break;
        }
      } catch { /* descriptor raced or is inaccessible */ }
    }
  }

  if (holders.length > 0) {
    throw new DatabaseRestoreLockError(
      'DATABASE_RESTORE_TARGET_OPEN',
      'Offline restore refused because the current database is open',
      { holderCount: holders.length },
    );
  }
}
