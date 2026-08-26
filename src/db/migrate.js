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
const MIGRATION_VERSION_PATTERN = /^\d{4}_\d{2}_\d{2}_\d{3}(?:_[a-z0-9]+)*$/;
const MIGRATION_NUMERIC_SLOT_PATTERN = /^\d{4}_\d{2}_\d{2}_(\d{3})(?:_|$)/;
const HISTORICAL_NUMERIC_SLOT_COLLISIONS = new Map([
  ['008', Object.freeze([
    '2026_02_19_008',
    '2026_02_20_008',
  ])],
  ['030', Object.freeze([
    '2026_03_08_030_v103_model_overrides',
    '2026_03_08_030_v107_task_memory',
  ])],
  ['081', Object.freeze([
    '2026_08_24_081_model_policy_trigger_compatibility',
    '2026_08_24_081_model_proof_trigger_compatibility',
  ])],
]);

// These three identities were introduced by renaming migrations that had
// already shipped as 081/081/082. They are permanently retired. Databases
// which saw the accidental names are adopted back to the immutable originals
// before pending migrations are evaluated.
const RETIRED_MIGRATION_IDENTITY_ADOPTIONS = Object.freeze([
  Object.freeze({
    retired: '2026_08_26_084_model_policy_trigger_compatibility',
    canonical: '2026_08_24_081_model_policy_trigger_compatibility',
  }),
  Object.freeze({
    retired: '2026_08_26_085_model_proof_trigger_compatibility',
    canonical: '2026_08_24_081_model_proof_trigger_compatibility',
  }),
  Object.freeze({
    retired: '2026_08_26_086_model_evaluation_consolidation',
    canonical: '2026_08_24_082_model_evaluation_consolidation',
  }),
]);

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

function numericSlot(version) {
  return version.match(MIGRATION_NUMERIC_SLOT_PATTERN)?.[1];
}

function validateNumericSlots(versions, label) {
  const versionsByNumericSlot = new Map();
  for (const version of versions) {
    if (typeof version !== 'string' || !MIGRATION_VERSION_PATTERN.test(version)) {
      throw new Error(`${label} contains an invalid migration version: ${String(version)}`);
    }
    const slot = numericSlot(version);
    const slotVersions = versionsByNumericSlot.get(slot) || [];
    slotVersions.push(version);
    versionsByNumericSlot.set(slot, slotVersions);
  }

  for (const [slot, slotVersions] of versionsByNumericSlot) {
    if (slotVersions.length < 2) continue;
    const allowed = HISTORICAL_NUMERIC_SLOT_COLLISIONS.get(slot);
    const actualSorted = [...slotVersions].sort();
    const allowedSorted = allowed ? [...allowed].sort() : [];
    const isExactHistoricalSet = actualSorted.length === allowedSorted.length
      && actualSorted.every((version, index) => version === allowedSorted[index]);
    if (!isExactHistoricalSet) {
      throw new Error(
        `Duplicate migration numeric slot ${slot} in ${label}: ${actualSorted.join(', ')}`
      );
    }
  }
}

function validateAppliedMigrationHistory(db) {
  const versions = db.prepare(
    'SELECT version FROM schema_migrations ORDER BY version'
  ).all().map(row => row.version);
  validateNumericSlots(versions, 'schema_migrations');
}

function projectAdoptedMigrationVersions(appliedVersions, migrations) {
  const canonicalVersions = new Set(migrations.map(migration => migration.version));
  const projected = new Set(appliedVersions);

  for (const { retired, canonical } of RETIRED_MIGRATION_IDENTITY_ADOPTIONS) {
    if (!projected.has(retired)) continue;
    if (!canonicalVersions.has(canonical)) {
      throw new Error(
        `Cannot adopt retired migration ${retired}: canonical identity ${canonical} is absent from manifest`
      );
    }
    projected.delete(retired);
    projected.add(canonical);
  }
  return projected;
}

function validateManifestAndHistoryUnion(appliedVersions, migrations, label) {
  const projected = projectAdoptedMigrationVersions(appliedVersions, migrations);
  validateNumericSlots(
    new Set([...projected, ...migrations.map(migration => migration.version)]),
    label,
  );
  return projected;
}

function adoptRetiredMigrationIdentities(db, migrations) {
  const rows = new Set(db.prepare(
    'SELECT version FROM schema_migrations'
  ).all().map(row => row.version));
  // Resolve the complete hypothetical state before the first identity write.
  // This catches collisions split across the manifest and stored history and
  // also proves that every retired identity has a canonical manifest target.
  validateManifestAndHistoryUnion(
    rows,
    migrations,
    'migration manifest + schema_migrations after identity adoption',
  );

  for (const { retired, canonical } of RETIRED_MIGRATION_IDENTITY_ADOPTIONS) {
    if (!rows.has(retired)) continue;
    if (rows.has(canonical)) {
      // The original migration already ran. The later stamp represents only
      // a redundant execution under the invalid renamed identity.
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(retired);
    } else {
      // Preserve the exact original applied_at while restoring the identity.
      db.prepare(
        'UPDATE schema_migrations SET version = ? WHERE version = ?'
      ).run(canonical, retired);
      rows.add(canonical);
    }
    rows.delete(retired);
  }
}

function prepareMigrationHistory(db, migrations) {
  ensureMigrationsTable(db);
  const prepare = db.transaction(() => {
    adoptRetiredMigrationIdentities(db, migrations);
    const finalVersions = db.prepare(
      'SELECT version FROM schema_migrations ORDER BY version'
    ).all().map(row => row.version);
    // Keep the final read and validation inside the adoption transaction. A
    // failed postcondition therefore rolls every stamp change back.
    validateManifestAndHistoryUnion(
      finalVersions,
      migrations,
      'migration manifest + schema_migrations after identity adoption',
    );
  });
  prepare();
}

async function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort(); // Lexicographic = chronological for timestamp-based versions

  const migrations = [];
  for (const file of files) {
    const mod = await import(path.join(MIGRATIONS_DIR, file));
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

  validateNumericSlots(versions, 'migration manifest');

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
  prepareMigrationHistory(db, migrations);
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
  prepareMigrationHistory(db, migrations);
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
  validateAppliedMigrationHistory,
  validateManifestAndHistoryUnion,
  projectAdoptedMigrationVersions,
  adoptRetiredMigrationIdentities,
});

export default { runMigrations, getCurrentVersion, listMigrations, hasColumn, hasTable };
