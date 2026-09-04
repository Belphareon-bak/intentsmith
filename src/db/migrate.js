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
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_VERSION_PATTERN = /^\d{4}_\d{2}_\d{2}_\d{3}(?:_[a-z0-9]+)*$/;

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
    // Dynamic import accepts native absolute paths on POSIX but requires a
    // file URL on Windows. Converting on every platform keeps one deterministic
    // code path and makes clean-clone migration tests portable.
    const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, file)).href);
    migrations.push({
      version: mod.version,
      description: mod.description || file,
      up: mod.up,
      file,
    });
  }
  return migrations;
}

/**
 * Validate the complete migration manifest before the runner is allowed to
 * create schema_migrations or execute any migration body.
 *
 * @param {Array<{version: unknown, up: unknown, file: unknown}>} migrations
 * @returns {Array<{version: string, description: string, up: Function, file: string}>}
 */
function validateMigrationPlan(migrations) {
  if (!Array.isArray(migrations)) {
    throw new TypeError('Migration manifest must be an array');
  }

  const versions = new Set();

  for (const migration of migrations) {
    const file = migration?.file;
    const version = migration?.version;

    if (typeof file !== 'string' || !file.endsWith('.js')) {
      throw new Error('Migration manifest entry has an invalid file name');
    }
    if (typeof version !== 'string' || !MIGRATION_VERSION_PATTERN.test(version)) {
      throw new Error(`Migration ${file} has an invalid version export`);
    }
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration ${file} is missing an up() export`);
    }

    const basename = path.basename(file, '.js');
    if (basename !== version && !basename.startsWith(`${version}_`)) {
      throw new Error(
        `Migration ${file} does not match exported version ${version}`
      );
    }
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }
    versions.add(version);
  }

  return migrations;
}

/**
 * Execute a supplied migration plan. Validation deliberately precedes every
 * database read or write so invalid manifests fail without mutating the DB.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{version: string, description: string, up: Function, file: string}>} migrations
 * @returns {{applied: string[], skipped: string[]}}
 */
function runMigrationPlan(db, migrations) {
  validateMigrationPlan(migrations);
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);

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
      applied.add(migration.version);
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
  const migrations = await discoverMigrations();
  return runMigrationPlan(db, migrations);
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
  const migrations = await discoverMigrations();
  validateMigrationPlan(migrations);
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);
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

// Test-only seam: production discovery remains pinned to MIGRATIONS_DIR.
export const _testInternals = Object.freeze({
  discoverMigrations,
  runMigrationPlan,
  validateMigrationPlan,
});

export default { runMigrations, getCurrentVersion, listMigrations, hasColumn, hasTable };
