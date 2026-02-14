// C.3 v64.0 — Schema Migration Runner
// ══════════════════════════════════════════════════════════════════════════════
//
// Timestamp-based versioning: 2026_02_14_001_baseline
// Each migration runs in a transaction (DDL + version stamp = atomic).
// Idempotent: running twice applies nothing on second run.
//
// Usage:
//   import { runMigrations } from './migrate.js';
//   await runMigrations(db);
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ─── Internal Helpers ────────────────────────────────────────────────────────

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getAppliedVersions(db) {
  return new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );
}

async function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort(); // Lexicographic = chronological for timestamp-based versions

  const migrations = [];
  for (const file of files) {
    const mod = await import(path.join(MIGRATIONS_DIR, file));
    if (!mod.version || !mod.up) {
      logger.warn('Migration', `Skipping ${file}: missing version or up() export`);
      continue;
    }
    migrations.push({
      version: mod.version,
      description: mod.description || file,
      up: mod.up,
      file,
    });
  }
  return migrations;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all pending migrations in order.
 *
 * Each migration is wrapped in a transaction:
 *   BEGIN → up(db) → INSERT schema_migrations → COMMIT
 *
 * If a migration fails, it rolls back and throws (fail-fast).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
export async function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);
  const migrations = await discoverMigrations();

  const result = { applied: [], skipped: [] };

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      result.skipped.push(migration.version);
      continue;
    }

    logger.info('Migration', `Applying: ${migration.version} — ${migration.description}`);

    const run = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
    });

    try {
      run();
      result.applied.push(migration.version);
      logger.info('Migration', `Applied: ${migration.version}`);
    } catch (err) {
      logger.error('Migration', `Failed: ${migration.version} — ${err.message}`);
      throw new Error(`Migration ${migration.version} failed: ${err.message}`);
    }
  }

  if (result.applied.length > 0) {
    logger.info('Migration', `${result.applied.length} migration(s) applied, ${result.skipped.length} skipped`);
  } else {
    logger.debug('Migration', `Schema up to date (${result.skipped.length} migration(s))`);
  }

  return result;
}

/**
 * Get the latest applied migration version.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {string|null}
 */
export function getCurrentVersion(db) {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  return row ? row.version : null;
}

/**
 * List all discovered migrations with their applied status.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<Array<{version: string, description: string, applied: boolean}>>}
 */
export async function listMigrations(db) {
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);
  const migrations = await discoverMigrations();
  return migrations.map(m => ({
    version: m.version,
    description: m.description,
    applied: applied.has(m.version),
  }));
}

// ─── Migration Utilities (for use inside migration up() functions) ───────────

/**
 * Check if a column exists on a table.
 * Use inside migration up() to make ALTER TABLE idempotent.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {string} column
 * @returns {boolean}
 */
export function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

/**
 * Check if a table exists.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @returns {boolean}
 */
export function hasTable(db, table) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table);
  return !!row;
}

export default { runMigrations, getCurrentVersion, listMigrations, hasColumn, hasTable };
