// v92: State Backup — atomic DB backup + skills + specialists + config files.
//
// Backup format:
//   data/backups/c3-state-YYYY-MM-DD.backup/
//     c3.db           ← SQLite snapshot (WAL checkpoint + copy)
//     skills/*.json   ← Skill definitions
//     specialists/**  ← Specialist packages
//     config/         ← c3-setup.json, design-defaults.json
//     metadata.json   ← Version, schema, timestamp, sizes
//
// Retention: 7 daily + 4 weekly (Sunday). Oldest beyond limit deleted.
//
// Must never throw — must not block startup or crash the server.

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function copyDirSync(src, dst, stats) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath, stats);
    } else {
      fs.copyFileSync(srcPath, dstPath);
      stats.files++;
      try { stats.size += fs.statSync(dstPath).size; } catch (_) {}
    }
  }
}

function dirSizeSync(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSizeSync(fp);
      } else {
        try { total += fs.statSync(fp).size; } catch (_) {}
      }
    }
  } catch (_) {}
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create State Backup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a state backup: DB snapshot + skills + specialists + config files.
 * @param {import('better-sqlite3').Database} db - raw better-sqlite3 instance
 * @param {string} dataDir - data directory (contains c3.db)
 * @param {{ projectRoot?: string }} opts
 * @returns {{ name: string, path: string, files: number, size: number, error: string|null }}
 */
export function createStateBackup(db, dataDir, opts = {}) {
  const projectRoot = opts.projectRoot || path.dirname(dataDir);
  const backupsDir = path.join(dataDir, 'backups');
  const today = new Date().toISOString().slice(0, 10);
  const backupName = `c3-state-${today}.backup`;
  const backupPath = path.join(backupsDir, backupName);

  const stats = { name: backupName, path: backupPath, files: 0, size: 0, error: null };

  try {
    // Remove previous same-day backup (overwrite)
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    fs.mkdirSync(backupPath, { recursive: true });

    // 1. SQLite backup (WAL checkpoint + file copy — synchronous, crash-safe)
    const dbSourcePath = path.join(dataDir, 'c3.db');
    const dbBackupPath = path.join(backupPath, 'c3.db');
    if (fs.existsSync(dbSourcePath)) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(dbSourcePath, dbBackupPath);
      stats.files++;
      try { stats.size += fs.statSync(dbBackupPath).size; } catch (_) {}
    }

    // 2. Copy skills/*.json
    const skillsSrc = path.join(projectRoot, 'skills');
    if (fs.existsSync(skillsSrc)) {
      const skillsDst = path.join(backupPath, 'skills');
      fs.mkdirSync(skillsDst, { recursive: true });
      for (const f of fs.readdirSync(skillsSrc)) {
        if (!f.endsWith('.json')) continue;
        const src = path.join(skillsSrc, f);
        const dst = path.join(skillsDst, f);
        fs.copyFileSync(src, dst);
        stats.files++;
        try { stats.size += fs.statSync(dst).size; } catch (_) {}
      }
    }

    // 3. Copy specialists/ (full directory tree)
    const specSrc = path.join(projectRoot, 'specialists');
    if (fs.existsSync(specSrc)) {
      copyDirSync(specSrc, path.join(backupPath, 'specialists'), stats);
    }

    // 4. Copy config files
    const configDst = path.join(backupPath, 'config');
    fs.mkdirSync(configDst, { recursive: true });
    for (const name of ['c3-setup.json', 'design-defaults.json']) {
      const src = path.join(dataDir, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(configDst, name));
        stats.files++;
        try { stats.size += fs.statSync(path.join(configDst, name)).size; } catch (_) {}
      }
    }

    // 5. Write metadata.json
    let schemaVersion = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM migrations').get();
      schemaVersion = row?.cnt || 0;
    } catch (_) {}

    let version = 'unknown';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
      version = pkg.version || 'unknown';
    } catch (_) {}

    const metadata = {
      version,
      schema_version: schemaVersion,
      created_at: new Date().toISOString(),
      type: 'state',
      db_size_bytes: 0,
      files_count: stats.files,
      total_size_bytes: stats.size,
    };
    try { metadata.db_size_bytes = fs.statSync(path.join(backupPath, 'c3.db')).size; } catch (_) {}

    fs.writeFileSync(path.join(backupPath, 'metadata.json'), JSON.stringify(metadata, null, 2));
    stats.files++;

    logger.info('Backup', `State backup created: ${backupName} (${stats.files} files, ${Math.round(stats.size / 1024)}KB)`);
  } catch (err) {
    stats.error = err.message;
    logger.error('Backup', `State backup failed: ${err.message}`);
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// List Backups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all state backups with metadata.
 * @param {string} dataDir
 * @returns {Array<{ name, path, created_at, version, schema_version, db_size_bytes, total_size_bytes }>}
 */
export function listBackups(dataDir) {
  const backupsDir = path.join(dataDir, 'backups');
  const backups = [];

  try {
    if (!fs.existsSync(backupsDir)) return backups;

    for (const name of fs.readdirSync(backupsDir)) {
      if (!name.startsWith('c3-state-') || !name.endsWith('.backup')) continue;
      const bp = path.join(backupsDir, name);

      try {
        if (!fs.statSync(bp).isDirectory()) continue;

        let metadata = {};
        try {
          metadata = JSON.parse(fs.readFileSync(path.join(bp, 'metadata.json'), 'utf-8'));
        } catch (_) {}

        backups.push({
          name,
          path: bp,
          created_at: metadata.created_at || null,
          version: metadata.version || 'unknown',
          schema_version: metadata.schema_version || 0,
          db_size_bytes: metadata.db_size_bytes || 0,
          total_size_bytes: dirSizeSync(bp),
        });
      } catch (_) {}
    }
  } catch (_) {}

  backups.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return backups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prune Backups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prune old backups beyond retention limits.
 * Keeps maxDaily most recent non-Sunday backups + maxWeekly most recent Sunday backups.
 * @param {string} dataDir
 * @param {{ maxDaily?: number, maxWeekly?: number }} opts
 * @returns {{ deleted: number, kept: number }}
 */
export function pruneBackups(dataDir, opts = {}) {
  const maxDaily = opts.maxDaily ?? 7;
  const maxWeekly = opts.maxWeekly ?? 4;
  const stats = { deleted: 0, kept: 0 };

  try {
    const backups = listBackups(dataDir);
    if (backups.length === 0) return stats;

    const weekly = [];
    const daily = [];

    for (const b of backups) {
      const dateMatch = b.name.match(/c3-state-(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) { daily.push(b); continue; }

      const d = new Date(dateMatch[1] + 'T00:00:00Z');
      if (d.getUTCDay() === 0) {
        weekly.push(b);
      } else {
        daily.push(b);
      }
    }

    const keepDaily = daily.slice(0, maxDaily);
    const keepWeekly = weekly.slice(0, maxWeekly);
    const keep = new Set([...keepDaily, ...keepWeekly].map(b => b.name));

    for (const b of backups) {
      if (keep.has(b.name)) {
        stats.kept++;
      } else {
        try {
          fs.rmSync(b.path, { recursive: true, force: true });
          stats.deleted++;
        } catch (_) {}
      }
    }

    if (stats.deleted > 0) {
      logger.info('Backup', `Pruned ${stats.deleted} old backups (kept ${stats.kept})`);
    }
  } catch (_) {}

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup Stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get backup statistics (count, total size, last backup date).
 * @param {string} dataDir
 */
export function getBackupStats(dataDir) {
  const backups = listBackups(dataDir);
  let totalBytes = 0;
  for (const b of backups) totalBytes += b.total_size_bytes;

  return {
    count: backups.length,
    total_mb: Math.round(totalBytes / (1024 * 1024) * 100) / 100,
    last_at: backups.length > 0 ? backups[0].created_at : null,
  };
}
