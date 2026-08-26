// M5 state backup V2 — immutable timestamped snapshots with exact integrity
// metadata and an offline-only SQLite restore boundary.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { logger } from './logger.js';
import {
  acquireDatabaseRestoreLock,
  assertDatabaseFileClosed,
  releaseDatabaseRestoreLock,
} from './database-restore-lock.js';

const BACKUP_FORMAT_VERSION = 2;
const BACKUP_NAME_PATTERN = /^c3-state-(\d{4}-\d{2}-\d{2})(?:T[0-9A-Z-]+)?(?:-\d{2})?\.backup$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export class StateBackupError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StateBackupError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function copyDirSync(src, dst, stats) {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      throw new StateBackupError(
        'BACKUP_SOURCE_SYMLINK_UNSUPPORTED',
        `Backup source contains a symbolic link: ${entry.name}`,
      );
    }
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath, stats);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath, fs.constants.COPYFILE_EXCL);
      stats.files += 1;
      stats.size += fs.statSync(dstPath).size;
    } else {
      throw new StateBackupError(
        'BACKUP_SOURCE_NOT_REGULAR',
        `Backup source is not a regular file or directory: ${entry.name}`,
      );
    }
  }
}

function dirSizeSync(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSizeSync(target);
      else if (entry.isFile()) total += fs.statSync(target).size;
    }
  } catch { /* statistics are best effort */ }
  return total;
}

function formatTimestamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new StateBackupError('BACKUP_TIME_INVALID', 'Backup timestamp is invalid');
  }
  return date.toISOString().replaceAll(':', '-').replace('.', '-');
}

function uniquePath(directory, stem, suffix) {
  for (let index = 0; index < 100; index += 1) {
    const discriminator = index === 0 ? '' : `-${String(index).padStart(2, '0')}`;
    const name = `${stem}${discriminator}${suffix}`;
    const target = path.join(directory, name);
    if (!fs.existsSync(target)) return { name, target };
  }
  throw new StateBackupError(
    'BACKUP_NAME_EXHAUSTED',
    'Could not allocate a unique immutable backup name',
  );
}

function migrationVersionsFromDb(db) {
  const table = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();
  if (!table) {
    throw new StateBackupError(
      'BACKUP_SCHEMA_AUTHORITY_MISSING',
      'Database does not contain the authoritative schema_migrations table',
    );
  }
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    .map(row => row.version);
  if (versions.some(version => typeof version !== 'string' || version.length === 0)) {
    throw new StateBackupError(
      'BACKUP_SCHEMA_AUTHORITY_INVALID',
      'Database contains an invalid migration identity',
    );
  }
  if (new Set(versions).size !== versions.length) {
    throw new StateBackupError(
      'BACKUP_SCHEMA_AUTHORITY_DUPLICATE',
      'Database contains duplicate migration identities',
    );
  }
  return versions;
}

function payloadManifest(backupPath) {
  const manifest = [];
  function walk(directory, prefix = '') {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === 'metadata.json' && prefix === '') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new StateBackupError(
          'BACKUP_PAYLOAD_SYMLINK',
          `Backup payload contains a symbolic link: ${relative}`,
        );
      }
      if (entry.isDirectory()) walk(target, relative);
      else if (entry.isFile()) {
        const stat = fs.statSync(target);
        manifest.push(Object.freeze({
          path: relative,
          bytes: stat.size,
          sha256: sha256File(target),
        }));
      } else {
        throw new StateBackupError(
          'BACKUP_PAYLOAD_NOT_REGULAR',
          `Backup payload is not regular: ${relative}`,
        );
      }
    }
  }
  walk(backupPath);
  return manifest;
}

function readPackageVersion(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function checkpointWalForBackup(db, opts = {}) {
  const rows = opts.checkpointWal
    ? opts.checkpointWal(db)
    : db.pragma('wal_checkpoint(TRUNCATE)');
  const result = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (
    !result
    || !Number.isSafeInteger(result.busy)
    || !Number.isSafeInteger(result.log)
    || !Number.isSafeInteger(result.checkpointed)
    || result.busy !== 0
    || result.log !== 0
    || result.checkpointed !== 0
  ) {
    throw new StateBackupError(
      'BACKUP_WAL_CHECKPOINT_INCOMPLETE',
      'State backup refused because the WAL checkpoint was not complete',
      {
        busy: Number.isSafeInteger(result?.busy) ? result.busy : null,
        log: Number.isSafeInteger(result?.log) ? result.log : null,
        checkpointed: Number.isSafeInteger(result?.checkpointed) ? result.checkpointed : null,
      },
    );
  }
  return Object.freeze({ busy: 0, log: 0, checkpointed: 0 });
}

function databaseFileSetPaths(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function createPreRestoreSafetySnapshot(targetDbPath, backupsDir, now) {
  const existing = databaseFileSetPaths(targetDbPath).filter(candidate => fs.existsSync(candidate));
  if (existing.length === 0) return null;
  const allocated = uniquePath(
    backupsDir,
    `pre-restore-${formatTimestamp(now)}`,
    '.backup',
  );
  fs.mkdirSync(allocated.target, { mode: 0o700 });
  try {
    for (const source of existing) {
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new StateBackupError(
          'DATABASE_RESTORE_TARGET_UNREADABLE',
          'Current database file-set contains a non-regular entry',
        );
      }
      const destination = path.join(allocated.target, path.basename(source));
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      fsyncFile(destination);
    }
    fsyncDirectory(allocated.target);
    fsyncDirectory(backupsDir);
    return Object.freeze({ name: allocated.name, path: allocated.target });
  } catch (error) {
    try { fs.rmSync(allocated.target, { recursive: true, force: true }); } catch { /* owned cleanup */ }
    throw error;
  }
}

function replaceDatabaseFileSet(stagingPath, targetDbPath) {
  const movedSidecars = [];
  let installed = false;
  try {
    for (const sidecar of [`${targetDbPath}-wal`, `${targetDbPath}-shm`]) {
      if (!fs.existsSync(sidecar)) continue;
      const moved = `${sidecar}.restore-old-${randomUUID()}`;
      fs.renameSync(sidecar, moved);
      movedSidecars.push(Object.freeze({ source: sidecar, moved }));
    }
    fs.renameSync(stagingPath, targetDbPath);
    installed = true;
    fsyncDirectory(path.dirname(targetDbPath));
    for (const sidecar of movedSidecars) fs.unlinkSync(sidecar.moved);
    fsyncDirectory(path.dirname(targetDbPath));
  } catch (error) {
    if (!installed) {
      for (const sidecar of [...movedSidecars].reverse()) {
        try {
          if (!fs.existsSync(sidecar.source) && fs.existsSync(sidecar.moved)) {
            fs.renameSync(sidecar.moved, sidecar.source);
          }
        } catch { /* preserve the original failure; safety snapshot remains */ }
      }
    }
    throw error;
  }
}

/**
 * Create an immutable state backup. V2 preserves code-bearing skills and
 * specialists as archival evidence, but automatic restore intentionally owns
 * only c3.db; release code is never downgraded by data recovery.
 */
export function createStateBackup(db, dataDir, opts = {}) {
  const projectRoot = opts.projectRoot || path.dirname(dataDir);
  const backupsDir = path.join(dataDir, 'backups');
  const timestamp = formatTimestamp(opts.now || new Date());
  let allocated;
  const stats = {
    name: null,
    path: null,
    files: 0,
    size: 0,
    error: null,
    format_version: BACKUP_FORMAT_VERSION,
  };
  let stagingPath = null;

  try {
    fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    allocated = uniquePath(backupsDir, `c3-state-${timestamp}`, '.backup');
    stats.name = allocated.name;
    stats.path = allocated.target;
    stagingPath = path.join(backupsDir, `.partial-${allocated.name}-${randomUUID()}`);
    fs.mkdirSync(stagingPath, { mode: 0o700 });

    const dbSourcePath = path.resolve(opts.dbPath || db.name || path.join(dataDir, 'c3.db'));
    if (!fs.existsSync(dbSourcePath)) {
      throw new StateBackupError('BACKUP_DATABASE_MISSING', 'Database source file is missing');
    }
    const checkpoint = checkpointWalForBackup(db, opts);
    const dbBackupPath = path.join(stagingPath, 'c3.db');
    fs.copyFileSync(dbSourcePath, dbBackupPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dbBackupPath, 0o600);
    fsyncFile(dbBackupPath);
    stats.files += 1;
    stats.size += fs.statSync(dbBackupPath).size;

    const skillsSrc = path.join(projectRoot, 'skills');
    if (fs.existsSync(skillsSrc)) {
      const skillsDst = path.join(stagingPath, 'skills');
      fs.mkdirSync(skillsDst, { mode: 0o700 });
      for (const name of fs.readdirSync(skillsSrc).sort()) {
        if (!name.endsWith('.json')) continue;
        const src = path.join(skillsSrc, name);
        if (!fs.lstatSync(src).isFile()) {
          throw new StateBackupError(
            'BACKUP_SOURCE_NOT_REGULAR',
            `Skill backup source is not a regular file: ${name}`,
          );
        }
        const dst = path.join(skillsDst, name);
        fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
        stats.files += 1;
        stats.size += fs.statSync(dst).size;
      }
    }

    const specialistsSrc = path.join(projectRoot, 'specialists');
    if (fs.existsSync(specialistsSrc)) {
      copyDirSync(specialistsSrc, path.join(stagingPath, 'specialists'), stats);
    }

    const configDst = path.join(stagingPath, 'config');
    for (const name of ['c3-setup.json', 'design-defaults.json']) {
      const src = path.join(dataDir, name);
      if (!fs.existsSync(src)) continue;
      if (!fs.lstatSync(src).isFile()) {
        throw new StateBackupError(
          'BACKUP_SOURCE_NOT_REGULAR',
          `Config backup source is not a regular file: ${name}`,
        );
      }
      fs.mkdirSync(configDst, { recursive: true, mode: 0o700 });
      const dst = path.join(configDst, name);
      fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
      stats.files += 1;
      stats.size += fs.statSync(dst).size;
    }

    const migrationVersions = migrationVersionsFromDb(db);
    const manifest = payloadManifest(stagingPath);
    const metadata = {
      contract: 'IntentSmithStateBackup',
      format_version: BACKUP_FORMAT_VERSION,
      version: readPackageVersion(projectRoot),
      created_at: new Date(opts.now || Date.now()).toISOString(),
      type: 'state',
      restore_scope: ['database'],
      archival_only: ['config', 'skills', 'specialists'],
      schema_version: migrationVersions.length,
      migration_versions: migrationVersions,
      migration_fingerprint: sha256Bytes(JSON.stringify(migrationVersions)),
      content_manifest: manifest,
      content_fingerprint: sha256Bytes(JSON.stringify(manifest)),
      db_size_bytes: fs.statSync(dbBackupPath).size,
      files_count: manifest.length,
      total_size_bytes: manifest.reduce((total, item) => total + item.bytes, 0),
      wal_checkpoint: checkpoint,
    };
    const metadataPath = path.join(stagingPath, 'metadata.json');
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fsyncFile(metadataPath);
    fsyncDirectory(stagingPath);
    fs.renameSync(stagingPath, allocated.target);
    stagingPath = null;
    fsyncDirectory(backupsDir);

    stats.files = manifest.length + 1;
    stats.size = dirSizeSync(allocated.target);
    logger.info(
      'Backup',
      `State backup created: ${allocated.name} (${stats.files} files, ${Math.round(stats.size / 1024)}KB)`,
    );
  } catch (error) {
    stats.error = error.code ? `${error.code}: ${error.message}` : error.message;
    try {
      if (stagingPath && fs.existsSync(stagingPath)) {
        fs.rmSync(stagingPath, { recursive: true, force: true });
      }
    } catch { /* owned partial cleanup is best effort */ }
    logger.error('Backup', `State backup failed: ${stats.error}`);
  }

  return stats;
}

export function listBackups(dataDir) {
  const backupsDir = path.join(dataDir, 'backups');
  const backups = [];
  try {
    if (!fs.existsSync(backupsDir)) return backups;
    for (const name of fs.readdirSync(backupsDir)) {
      if (!BACKUP_NAME_PATTERN.test(name)) continue;
      const backupPath = path.join(backupsDir, name);
      try {
        const stat = fs.lstatSync(backupPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        let metadata = {};
        try {
          metadata = JSON.parse(fs.readFileSync(path.join(backupPath, 'metadata.json'), 'utf8'));
        } catch { /* listed as unrestorable */ }
        backups.push({
          name,
          path: backupPath,
          created_at: metadata.created_at || null,
          version: metadata.version || 'unknown',
          format_version: Number.isSafeInteger(metadata.format_version) ? metadata.format_version : 1,
          restorable: metadata.format_version === BACKUP_FORMAT_VERSION,
          schema_version: Number.isSafeInteger(metadata.schema_version) ? metadata.schema_version : 0,
          migration_fingerprint: metadata.migration_fingerprint || null,
          db_size_bytes: Number.isSafeInteger(metadata.db_size_bytes) ? metadata.db_size_bytes : 0,
          total_size_bytes: dirSizeSync(backupPath),
        });
      } catch { /* malformed entry is omitted */ }
    }
  } catch { /* list is best effort */ }
  backups.sort((a, b) => (
    (b.created_at || '').localeCompare(a.created_at || '') || b.name.localeCompare(a.name)
  ));
  return backups;
}

export function pruneBackups(dataDir, opts = {}) {
  const maxDaily = opts.maxDaily ?? 7;
  const maxWeekly = opts.maxWeekly ?? 4;
  const stats = { deleted: 0, kept: 0 };
  try {
    const backups = listBackups(dataDir);
    const weekly = [];
    const daily = [];
    for (const backup of backups) {
      const match = backup.name.match(BACKUP_NAME_PATTERN);
      if (!match) { daily.push(backup); continue; }
      const date = new Date(`${match[1]}T00:00:00Z`);
      (date.getUTCDay() === 0 ? weekly : daily).push(backup);
    }
    const keep = new Set([
      ...daily.slice(0, maxDaily),
      ...weekly.slice(0, maxWeekly),
    ].map(backup => backup.name));
    for (const backup of backups) {
      if (keep.has(backup.name)) stats.kept += 1;
      else {
        try {
          fs.rmSync(backup.path, { recursive: true, force: true });
          stats.deleted += 1;
        } catch { /* retention is best effort */ }
      }
    }
    if (stats.deleted > 0) {
      logger.info('Backup', `Pruned ${stats.deleted} old backups (kept ${stats.kept})`);
    }
  } catch { /* retention is best effort */ }
  return stats;
}

export function getBackupStats(dataDir) {
  const backups = listBackups(dataDir);
  const totalBytes = backups.reduce((total, backup) => total + backup.total_size_bytes, 0);
  return {
    count: backups.length,
    restorable: backups.filter(backup => backup.restorable).length,
    total_mb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
    last_at: backups.length > 0 ? backups[0].created_at : null,
  };
}

export function discoverSupportedMigrationVersions(projectRoot) {
  const directory = path.join(projectRoot, 'src', 'db', 'migrations');
  if (!fs.existsSync(directory)) {
    throw new StateBackupError(
      'BACKUP_SUPPORTED_SCHEMA_UNAVAILABLE',
      'Current release migration directory is unavailable',
    );
  }
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.js'))
    .map(name => name.slice(0, -3))
    .sort();
}

function assertMigrationMetadata(metadata) {
  const versions = metadata.migration_versions;
  if (!Array.isArray(versions) || versions.some(version => typeof version !== 'string' || !version)) {
    throw new StateBackupError(
      'BACKUP_MIGRATION_MANIFEST_INVALID',
      'Backup migration manifest is missing or invalid',
    );
  }
  const sorted = [...versions].sort();
  if (new Set(versions).size !== versions.length || JSON.stringify(sorted) !== JSON.stringify(versions)) {
    throw new StateBackupError(
      'BACKUP_MIGRATION_MANIFEST_INVALID',
      'Backup migration identities must be unique and sorted',
    );
  }
  const fingerprint = sha256Bytes(JSON.stringify(versions));
  if (metadata.migration_fingerprint !== fingerprint || metadata.schema_version !== versions.length) {
    throw new StateBackupError(
      'BACKUP_MIGRATION_FINGERPRINT_MISMATCH',
      'Backup migration metadata is internally inconsistent',
    );
  }
  return versions;
}

function assertManifestPath(relative) {
  if (
    typeof relative !== 'string'
    || !relative
    || relative.includes('\\')
    || path.posix.isAbsolute(relative)
    || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new StateBackupError('BACKUP_MANIFEST_PATH_INVALID', 'Backup manifest contains an unsafe path');
  }
}

export function validateStateBackup(dataDir, backupName, opts = {}) {
  if (typeof backupName !== 'string' || !BACKUP_NAME_PATTERN.test(backupName)) {
    throw new StateBackupError('BACKUP_NAME_INVALID', 'Backup name is invalid');
  }
  const backupPath = path.join(path.resolve(dataDir), 'backups', backupName);
  let rootStat;
  try { rootStat = fs.lstatSync(backupPath); } catch {
    throw new StateBackupError('BACKUP_NOT_FOUND', 'Backup does not exist');
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new StateBackupError('BACKUP_BOUNDARY_INVALID', 'Backup root must be a real directory');
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(backupPath, 'metadata.json'), 'utf8'));
  } catch {
    throw new StateBackupError('BACKUP_METADATA_INVALID', 'Backup metadata is missing or invalid');
  }
  if (metadata.contract !== 'IntentSmithStateBackup' || metadata.format_version !== BACKUP_FORMAT_VERSION) {
    throw new StateBackupError(
      'BACKUP_LEGACY_FORMAT_UNSAFE',
      'Only exact IntentSmith state backup format V2 can be restored automatically',
    );
  }
  if (metadata.type !== 'state' || JSON.stringify(metadata.restore_scope) !== JSON.stringify(['database'])) {
    throw new StateBackupError('BACKUP_RESTORE_SCOPE_INVALID', 'Backup restore scope is invalid');
  }

  const migrationVersions = assertMigrationMetadata(metadata);
  if (!Array.isArray(metadata.content_manifest) || metadata.content_manifest.length === 0) {
    throw new StateBackupError('BACKUP_CONTENT_MANIFEST_INVALID', 'Backup content manifest is missing');
  }
  const seen = new Set();
  for (const item of metadata.content_manifest) {
    assertManifestPath(item?.path);
    if (seen.has(item.path)) {
      throw new StateBackupError('BACKUP_CONTENT_MANIFEST_INVALID', 'Backup manifest path is duplicated');
    }
    seen.add(item.path);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !SHA256_PATTERN.test(item.sha256 || '')) {
      throw new StateBackupError('BACKUP_CONTENT_MANIFEST_INVALID', 'Backup manifest entry is invalid');
    }
    const target = path.join(backupPath, ...item.path.split('/'));
    let stat;
    try { stat = fs.lstatSync(target); } catch {
      throw new StateBackupError('BACKUP_CONTENT_MISSING', `Backup content is missing: ${item.path}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || sha256File(target) !== item.sha256) {
      throw new StateBackupError('BACKUP_CONTENT_MISMATCH', `Backup content does not match: ${item.path}`);
    }
  }
  const actual = payloadManifest(backupPath);
  if (JSON.stringify(actual) !== JSON.stringify(metadata.content_manifest)) {
    throw new StateBackupError('BACKUP_CONTENT_SET_MISMATCH', 'Backup contains unmanifested or reordered content');
  }
  if (metadata.content_fingerprint !== sha256Bytes(JSON.stringify(actual))) {
    throw new StateBackupError('BACKUP_CONTENT_FINGERPRINT_MISMATCH', 'Backup content fingerprint is invalid');
  }
  if (!seen.has('c3.db')) {
    throw new StateBackupError('BACKUP_DATABASE_MISSING', 'Backup does not contain c3.db');
  }

  const backupDbPath = path.join(backupPath, 'c3.db');
  let backupDb;
  try {
    backupDb = new Database(backupDbPath, { readonly: true, fileMustExist: true });
    const quick = backupDb.pragma('quick_check');
    if (!Array.isArray(quick) || quick.length !== 1 || quick[0].quick_check !== 'ok') {
      throw new StateBackupError('BACKUP_DATABASE_CORRUPT', 'Backup SQLite quick_check failed');
    }
    const actualVersions = migrationVersionsFromDb(backupDb);
    if (JSON.stringify(actualVersions) !== JSON.stringify(migrationVersions)) {
      throw new StateBackupError(
        'BACKUP_DATABASE_SCHEMA_MISMATCH',
        'Backup database migration rows do not match metadata',
      );
    }
  } catch (error) {
    if (error instanceof StateBackupError) throw error;
    throw new StateBackupError(
      'BACKUP_DATABASE_CORRUPT',
      `Backup database cannot be opened: ${error.message}`,
    );
  } finally {
    try { backupDb?.close(); } catch { /* read-only validation cleanup */ }
  }

  const supported = opts.supportedMigrationVersions
    || discoverSupportedMigrationVersions(opts.projectRoot || path.dirname(path.resolve(dataDir)));
  const supportedSet = new Set(supported);
  const unsupported = migrationVersions.filter(version => !supportedSet.has(version));
  if (unsupported.length > 0) {
    throw new StateBackupError(
      'BACKUP_SCHEMA_INCOMPATIBLE',
      'Backup contains migrations unknown to this release',
      { unsupportedCount: unsupported.length },
    );
  }

  return Object.freeze({
    backupName,
    backupPath,
    backupDbPath,
    metadata: Object.freeze(metadata),
  });
}

export function restoreStateBackup(dataDir, backupName, opts = {}) {
  if (opts.offline !== true) {
    throw new StateBackupError(
      'DATABASE_RESTORE_REQUIRES_OFFLINE',
      'State restore is supported only while the IntentSmith server is stopped',
    );
  }
  const resolvedDataDir = path.resolve(dataDir);
  const targetDbPath = path.resolve(opts.dbPath || path.join(resolvedDataDir, 'c3.db'));
  if (path.dirname(targetDbPath) !== resolvedDataDir) {
    throw new StateBackupError(
      'DATABASE_RESTORE_TARGET_OUTSIDE_DATA_DIR',
      'Restore target must be the configured database inside the data directory',
    );
  }

  const restoreLockOptions = opts.restoreLockOptions || {};
  const lease = acquireDatabaseRestoreLock(targetDbPath, restoreLockOptions);
  const stagingPath = path.join(resolvedDataDir, `.c3.db.restore-${randomUUID()}.tmp`);
  try {
    assertDatabaseFileClosed(targetDbPath, restoreLockOptions);
    const validated = validateStateBackup(resolvedDataDir, backupName, opts);
    fs.copyFileSync(validated.backupDbPath, stagingPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(stagingPath, 0o600);
    fsyncFile(stagingPath);

    let stagedDb;
    try {
      stagedDb = new Database(stagingPath, { readonly: true, fileMustExist: true });
      const quick = stagedDb.pragma('quick_check');
      if (quick?.[0]?.quick_check !== 'ok') {
        throw new StateBackupError('DATABASE_RESTORE_STAGE_CORRUPT', 'Staged database failed quick_check');
      }
    } finally {
      try { stagedDb?.close(); } catch { /* validation cleanup */ }
    }

    const backupsDir = path.join(resolvedDataDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    const safety = createPreRestoreSafetySnapshot(
      targetDbPath,
      backupsDir,
      opts.now || new Date(),
    );

    replaceDatabaseFileSet(stagingPath, targetDbPath);
    if (opts.silent !== true) {
      logger.info('Backup', `State database restored from ${backupName}`);
    }
    return Object.freeze({
      ok: true,
      backupName,
      safetyBackupName: safety?.name || null,
      migrationCount: validated.metadata.migration_versions.length,
      contentFingerprint: validated.metadata.content_fingerprint,
    });
  } finally {
    try {
      if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
    } catch { /* exact owned staging cleanup */ }
    releaseDatabaseRestoreLock(lease, restoreLockOptions);
  }
}
