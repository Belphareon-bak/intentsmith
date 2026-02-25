// v74: Specialist Loader — MVP
// ══════════════════════════════════════════════════════════════════════════════
//
// Boot-time discovery, installation, and activation of specialist packages.
//
// Boot sequence:
//   1. discoverAll()   — scan specialists/ directory, parse + validate manifests
//   2. installPending() — run specialist migrations for newly discovered packages
//   3. enableAll()      — dynamic import index.js, register tools + seed knowledge
//
// Each specialist is a self-contained directory with specialist.json manifest.
// See docs/SPECIALIST-LIFECYCLE.md for full spec.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from '../core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Manifest Validation ────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9-]+$/;
const DOMAIN_PATTERN = /^[a-z0-9_]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const VALID_TYPES = ['domain', 'utility', 'integration'];

/**
 * Validate a specialist.json manifest.
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateManifest(manifest) {
  const errors = [];

  if (!manifest.id || typeof manifest.id !== 'string') {
    errors.push('id is required (string)');
  } else if (!ID_PATTERN.test(manifest.id)) {
    errors.push(`id must match ${ID_PATTERN} (got "${manifest.id}")`);
  } else if (manifest.id.length > 64) {
    errors.push('id max 64 characters');
  }

  if (!manifest.version || !SEMVER_PATTERN.test(manifest.version)) {
    errors.push(`version must be semver X.Y.Z (got "${manifest.version}")`);
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('name is required (string)');
  }

  if (!manifest.domain || !DOMAIN_PATTERN.test(manifest.domain)) {
    errors.push(`domain must match ${DOMAIN_PATTERN} (got "${manifest.domain}")`);
  }

  if (manifest.type && !VALID_TYPES.includes(manifest.type)) {
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (!manifest.engine || typeof manifest.engine !== 'string') {
    errors.push('engine version requirement is required');
  }

  if (!manifest.entry || typeof manifest.entry !== 'string') {
    errors.push('entry point is required');
  }

  // D7: Validate dependencies format
  if (manifest.dependencies) {
    if (typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)) {
      errors.push('dependencies must be an object { id: ">=X.Y.Z" }');
    } else {
      for (const [depId, depVersion] of Object.entries(manifest.dependencies)) {
        if (!ID_PATTERN.test(depId)) {
          errors.push(`dependency id "${depId}" must match ${ID_PATTERN}`);
        }
        if (typeof depVersion !== 'string' || !depVersion.startsWith('>=')) {
          errors.push(`dependency "${depId}" version must be ">=X.Y.Z" format`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Simple semver satisfies check: manifest.engine ">=X.Y.Z" against current version.
 * Only supports >=X.Y.Z format for MVP.
 */
function checkEngineCompat(engineRequirement, currentVersion) {
  const match = engineRequirement.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    // Can't parse requirement — skip check, log warning
    return { compatible: true, warning: `Unparseable engine requirement: ${engineRequirement}` };
  }

  const required = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  const parts = currentVersion.split('.').map(Number);
  const current = [parts[0] || 0, parts[1] || 0, parts[2] || 0];

  for (let i = 0; i < 3; i++) {
    if (current[i] > required[i]) return { compatible: true };
    if (current[i] < required[i]) {
      return {
        compatible: false,
        error: `Requires engine >=${match[1]}.${match[2]}.${match[3]}, running ${currentVersion}`,
      };
    }
  }
  return { compatible: true }; // exact match
}

// ─── Specialist Loader ──────────────────────────────────────────────────────

export class SpecialistLoader {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {Object} runtime - SpecialistRuntime instance
   * @param {Object} [options]
   * @param {string} [options.baseDir] - specialists/ directory path
   * @param {string} [options.engineVersion] - current C3 engine version
   */
  constructor(db, runtime, options = {}) {
    this.db = db;
    this.runtime = runtime;

    // Default: project_root/specialists/
    const projectRoot = path.resolve(__dirname, '..', '..');
    this.baseDir = options.baseDir || path.join(projectRoot, 'specialists');
    this.engineVersion = options.engineVersion || '65.5.0';

    /** @type {Map<string, { manifest: Object, dir: string }>} */
    this._discovered = new Map();

    /** @type {Map<string, Object>} loaded module references */
    this._modules = new Map();

    /** @type {Set<string>} specialists needing ESM cache bust on next enable */
    this._needsCacheBust = new Set();

    /** @type {import('../telemetry/specialist-telemetry.js').SpecialistTelemetry|null} v82: passive telemetry */
    this._telemetry = options.telemetry || null;

    this._prepareStatements();
  }

  _prepareStatements() {
    this._stmts = {
      getSpecialist: this.db.prepare(
        'SELECT * FROM specialists WHERE id = ?'
      ),
      listAll: this.db.prepare(
        'SELECT * FROM specialists ORDER BY id'
      ),
      listEnabled: this.db.prepare(
        "SELECT * FROM specialists WHERE status = 'enabled' ORDER BY id"
      ),
      insert: this.db.prepare(`
        INSERT INTO specialists (id, version, name, domain, type, status, manifest_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      updateStatus: this.db.prepare(`
        UPDATE specialists SET status = ?, enabled_at = ?, disabled_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `),
      updateVersion: this.db.prepare(`
        UPDATE specialists SET version = ?, manifest_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `),
      // Specialist migration tracking
      getMigrations: this.db.prepare(
        'SELECT migration_name FROM specialist_migrations WHERE specialist_id = ?'
      ),
      insertMigration: this.db.prepare(
        'INSERT INTO specialist_migrations (specialist_id, migration_name) VALUES (?, ?)'
      ),
    };
  }

  // ─── Phase 1: Discovery ─────────────────────────────────────────────────

  /**
   * Scan specialists/ directory for valid packages.
   * @returns {Object[]} Array of validated manifests
   */
  discoverAll() {
    this._discovered.clear();

    if (!fs.existsSync(this.baseDir)) {
      logger.debug('SpecialistLoader', `No specialists directory at ${this.baseDir}`);
      return [];
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dir = path.join(this.baseDir, entry.name);
      const manifestPath = path.join(dir, 'specialist.json');

      if (!fs.existsSync(manifestPath)) {
        logger.debug('SpecialistLoader', `Skipping ${entry.name}: no specialist.json`);
        continue;
      }

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw);

        // Validate
        const validation = validateManifest(manifest);
        if (!validation.valid) {
          logger.warn('SpecialistLoader', `Invalid manifest in ${entry.name}: ${validation.errors.join(', ')}`);
          continue;
        }

        // Check engine compatibility
        const compat = checkEngineCompat(manifest.engine, this.engineVersion);
        if (!compat.compatible) {
          logger.warn('SpecialistLoader', `Incompatible specialist ${manifest.id}: ${compat.error}`);
          continue;
        }
        if (compat.warning) {
          logger.debug('SpecialistLoader', compat.warning);
        }

        // Check entry point exists
        const entryPath = path.join(dir, manifest.entry);
        if (!fs.existsSync(entryPath)) {
          logger.warn('SpecialistLoader', `Missing entry point: ${entryPath}`);
          continue;
        }

        this._discovered.set(manifest.id, { manifest, dir });
        results.push(manifest);
        logger.debug('SpecialistLoader', `Discovered: ${manifest.id} v${manifest.version}`);
      } catch (err) {
        logger.warn('SpecialistLoader', `Error reading ${entry.name}: ${err.message}`);
      }
    }

    logger.info('SpecialistLoader', `Discovered ${results.length} specialist(s)`);
    return results;
  }

  // ─── Phase 2: Install Pending ───────────────────────────────────────────

  /**
   * Install newly discovered specialists (not yet in DB).
   * Runs specialist migrations and creates DB record.
   */
  installPending() {
    let installed = 0;

    for (const [id, { manifest, dir }] of this._discovered) {
      const existing = this._stmts.getSpecialist.get(id);

      if (existing) {
        // Already installed — check version update
        if (existing.version !== manifest.version) {
          logger.info('SpecialistLoader', `Updating ${id}: ${existing.version} → ${manifest.version}`);
          this._runMigrations(id, dir, manifest);
          this._stmts.updateVersion.run(manifest.version, JSON.stringify(manifest), id);
        }
        continue;
      }

      // New specialist — install
      logger.info('SpecialistLoader', `Installing: ${id} v${manifest.version}`);

      try {
        this._runMigrations(id, dir, manifest);

        const status = manifest.enabledByDefault ? 'enabled' : 'installed';
        this._stmts.insert.run(
          id,
          manifest.version,
          manifest.name,
          manifest.domain,
          manifest.type || 'domain',
          status,
          JSON.stringify(manifest),
        );
        installed++;
        logger.info('SpecialistLoader', `Installed: ${id} (status: ${status})`);
      } catch (err) {
        logger.error('SpecialistLoader', `Failed to install ${id}: ${err.message}`);
      }
    }

    if (installed > 0) {
      logger.info('SpecialistLoader', `${installed} new specialist(s) installed`);
    }
  }

  /**
   * Run specialist-scoped migrations.
   * Tracks in specialist_migrations table (separate from core schema_migrations).
   */
  _runMigrations(specialistId, dir, manifest) {
    if (!manifest.migrations?.length) return;

    const migrationsDir = path.join(dir, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      logger.warn('SpecialistLoader', `Migrations declared but directory missing: ${migrationsDir}`);
      return;
    }

    const applied = new Set(
      this._stmts.getMigrations.all(specialistId).map(r => r.migration_name)
    );

    for (const migrationName of manifest.migrations) {
      if (applied.has(migrationName)) continue;

      const migrationFile = path.join(migrationsDir, `${migrationName}.js`);
      if (!fs.existsSync(migrationFile)) {
        logger.warn('SpecialistLoader', `Migration file not found: ${migrationFile}`);
        continue;
      }

      // Note: we can't use dynamic import synchronously inside a transaction.
      // So we collect pending migrations and run them sequentially.
      logger.info('SpecialistLoader', `Pending migration: ${specialistId}/${migrationName}`);
    }

    // Actually run pending migrations (cannot be done inside the install transaction
    // because ESM import is async, but SQLite is sync — run one by one)
    this._pendingMigrations = this._pendingMigrations || [];
    for (const migrationName of manifest.migrations) {
      if (applied.has(migrationName)) continue;
      this._pendingMigrations.push({ specialistId, migrationsDir, migrationName });
    }
  }

  /**
   * Execute pending migrations (async, called after sync installPending).
   */
  async _executePendingMigrations() {
    if (!this._pendingMigrations?.length) return;

    for (const { specialistId, migrationsDir, migrationName } of this._pendingMigrations) {
      const migrationFile = path.join(migrationsDir, `${migrationName}.js`);

      try {
        const mod = await import(migrationFile);
        if (typeof mod.up !== 'function') {
          logger.warn('SpecialistLoader', `Migration ${migrationName} has no up() function`);
          continue;
        }

        const runMigration = this.db.transaction(() => {
          mod.up(this.db);
          this._stmts.insertMigration.run(specialistId, migrationName);
        });

        runMigration();
        logger.info('SpecialistLoader', `Applied migration: ${specialistId}/${migrationName}`);
      } catch (err) {
        logger.error('SpecialistLoader', `Migration ${specialistId}/${migrationName} failed: ${err.message}`);
        throw err; // fail-fast
      }
    }

    this._pendingMigrations = [];
  }

  // ─── Phase 3: Enable ────────────────────────────────────────────────────

  /**
   * Enable all specialists with status 'enabled' in DB.
   * D7: Topological sort by dependencies — guarantees load order.
   * Loads index.js, calls register(), seeds knowledge.
   */
  async enableAll() {
    // First execute any pending migrations from installPending()
    await this._executePendingMigrations();

    const enabledRows = this._stmts.listEnabled.all();

    // D7: Sort by dependencies (Kahn's algorithm)
    const sorted = this._topologicalSort(enabledRows);

    let count = 0;
    for (const row of sorted) {
      const discovered = this._discovered.get(row.id);
      if (!discovered) {
        logger.warn('SpecialistLoader', `Specialist ${row.id} enabled in DB but not found on disk`);
        continue;
      }

      try {
        await this._enableOne(row.id, discovered);
        count++;
      } catch (err) {
        logger.error('SpecialistLoader', `Failed to enable ${row.id}: ${err.message}`);
      }
    }

    logger.info('SpecialistLoader', `${count} specialist(s) enabled`);
  }

  /**
   * Enable a single specialist.
   * Supports ESM cache busting for update flow.
   */
  async _enableOne(id, { manifest, dir }) {
    const needsBust = this._needsCacheBust.has(id);

    if (this._modules.has(id) && !needsBust) {
      logger.debug('SpecialistLoader', `${id} already loaded, skipping`);
      return;
    }

    // Clear old module reference if cache busting
    if (needsBust) {
      this._modules.delete(id);
    }

    const entryPath = path.join(dir, manifest.entry);
    let mod;
    if (needsBust) {
      // Cache bust: file URL with query param bypasses Node's ESM cache
      const url = pathToFileURL(entryPath);
      url.searchParams.set('v', Date.now());
      mod = await import(url.href);
      this._needsCacheBust.delete(id);
    } else {
      mod = await import(entryPath);
    }

    if (typeof mod.register !== 'function') {
      throw new Error(`${id}/index.js must export register(ctx)`);
    }

    // Build registration context
    const ctx = {
      runtime: this.runtime,
      db: this.db,
      manifest,
      specialistDir: dir,
      logger: logger,
    };

    // Call register — specialist wires itself into runtime
    mod.register(ctx);

    this._modules.set(id, mod);
    logger.info('SpecialistLoader', `Enabled: ${id} v${manifest.version}`);
  }

  // ─── Lifecycle API ──────────────────────────────────────────────────────

  /**
   * Enable a specific specialist by ID.
   * D7: Checks that all dependencies are enabled first.
   */
  async enable(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) throw new Error(`Specialist not found: ${specialistId}`);
    if (row.status === 'enabled') return; // noop

    const discovered = this._discovered.get(specialistId);
    if (!discovered) throw new Error(`Specialist ${specialistId} not on disk`);

    // D7: Check dependencies are enabled
    const manifest = discovered.manifest;
    if (manifest.dependencies) {
      const missing = this._checkDependencies(manifest.dependencies);
      if (missing.length > 0) {
        throw new Error(`Cannot enable ${specialistId}: missing/disabled dependencies: ${missing.join(', ')}`);
      }
    }

    await this._enableOne(specialistId, discovered);

    const now = new Date().toISOString();
    this._stmts.updateStatus.run('enabled', now, null, specialistId);

    // v82: Telemetry
    this._telemetry?.record('lifecycle.enable', { specialistId });
  }

  /**
   * Disable a specific specialist by ID.
   * D7: Refuses if other specialists depend on this one.
   * Defensively cleans up ALL registrations (tools, scenarios).
   */
  disable(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) throw new Error(`Specialist not found: ${specialistId}`);
    if (row.status === 'disabled') return; // noop

    // D7: Check dependents — refuse if other specialists depend on this one
    const dependents = this.getDependents(specialistId);
    if (dependents.length > 0) {
      throw new Error(`Cannot disable ${specialistId}: required by: ${dependents.join(', ')}`);
    }

    // Let specialist do custom cleanup
    const mod = this._modules.get(specialistId);
    if (mod && typeof mod.unregister === 'function') {
      try {
        mod.unregister({ runtime: this.runtime });
      } catch (err) {
        logger.warn('SpecialistLoader', `${specialistId} unregister() error: ${err.message}`);
      }
    }

    // Defensive cleanup — remove from all registries regardless of unregister()
    const manifest = this._getManifestFromDiscovered(specialistId);
    const expertiseId = this._resolveExpertiseId(specialistId, manifest);

    // Tools
    if (this.runtime.isSpecialist(expertiseId)) {
      this.runtime.unregisterSpecialist(expertiseId);
    }

    // Scenarios (lazy import — only if module already loaded)
    this._cleanupScenarios(expertiseId);

    this._modules.delete(specialistId);

    const now = new Date().toISOString();
    this._stmts.updateStatus.run('disabled', null, now, specialistId);
    logger.info('SpecialistLoader', `Disabled: ${specialistId}`);

    // v82: Telemetry
    this._telemetry?.record('lifecycle.disable', { specialistId });
  }

  // ─── Update Flow ──────────────────────────────────────────────────────

  /**
   * Update a specialist to a new version discovered on disk.
   * Rollback-ready: DB version committed AFTER successful re-enable.
   * If re-enable fails, migrations are rolled back via down().
   *
   * Flow: validate → snapshot → disable → migrate → re-enable → commit DB.
   *
   * Requires discoverAll() to have been called first to pick up new manifest.
   *
   * @param {string} specialistId
   * @returns {Promise<{ oldVersion: string, newVersion: string, wasEnabled: boolean, reversible: boolean } | null>}
   */
  async update(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) throw new Error(`Specialist not installed: ${specialistId}`);

    const discovered = this._discovered.get(specialistId);
    if (!discovered) throw new Error(`Specialist ${specialistId} not found on disk (call discoverAll() first)`);

    const { manifest, dir } = discovered;
    const oldVersion = row.version;
    const newVersion = manifest.version;

    // Version must be strictly newer
    if (this._compareVersions(newVersion, oldVersion) <= 0) {
      logger.debug('SpecialistLoader', `${specialistId}: disk v${newVersion} <= installed v${oldVersion}, skipping`);
      return null;
    }

    // Validate manifest + engine
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Invalid manifest for ${specialistId}: ${validation.errors.join(', ')}`);
    }
    const compat = checkEngineCompat(manifest.engine, this.engineVersion);
    if (!compat.compatible) {
      throw new Error(`Engine incompatible for ${specialistId}: ${compat.error}`);
    }

    const wasEnabled = row.status === 'enabled';
    const expertiseId = this._resolveExpertiseId(specialistId, manifest);

    // Safety: don't update while tools are executing
    if (wasEnabled && typeof this.runtime.isSpecialistBusy === 'function') {
      if (this.runtime.isSpecialistBusy(expertiseId)) {
        throw new Error(`Cannot update ${specialistId}: tools currently executing`);
      }
    }

    // Check migration reversibility
    const reversible = await this._checkMigrationsReversible(specialistId, dir, manifest);

    logger.info('SpecialistLoader', `Updating: ${specialistId} v${oldVersion} → v${newVersion}` +
      (reversible ? '' : ' (irreversible migrations)'));

    // 1. Snapshot pre-update state
    const snapshot = {
      oldVersion,
      oldManifest: row.manifest_json,
      oldStatus: row.status,
    };

    // 2. Clear tool module caches (before disable removes config)
    if (wasEnabled && typeof this.runtime.clearModuleCache === 'function') {
      this.runtime.clearModuleCache(expertiseId);
    }

    // 3. Disable if enabled
    if (wasEnabled) {
      this.disable(specialistId);
    }

    // 4. Mark for entry point cache bust
    this._needsCacheBust.add(specialistId);

    // 5. Run new migrations
    const migrationsApplied = [];
    this._runMigrations(specialistId, dir, manifest);
    if (this._pendingMigrations?.length) {
      // Track which migrations we apply for potential rollback
      for (const pm of this._pendingMigrations) {
        migrationsApplied.push(pm.migrationName);
      }
    }
    await this._executePendingMigrations();

    // 6. Re-enable if was enabled — BEFORE DB version commit
    if (wasEnabled) {
      try {
        const now = new Date().toISOString();
        this._stmts.updateStatus.run('enabled', now, null, specialistId);
        await this._enableOne(specialistId, discovered);
      } catch (err) {
        // Re-enable failed — rollback migrations if reversible
        logger.error('SpecialistLoader', `Re-enable failed for ${specialistId}: ${err.message}`);

        if (reversible && migrationsApplied.length > 0) {
          await this._rollbackMigrations(specialistId, dir, manifest, migrationsApplied);
        }

        // Restore DB state to disabled (disable already set it, but status may have been changed)
        const nowFail = new Date().toISOString();
        this._stmts.updateStatus.run('disabled', null, nowFail, specialistId);
        this._needsCacheBust.delete(specialistId);

        throw new Error(`Update failed for ${specialistId}: re-enable failed after migration. ` +
          (reversible ? 'Migrations rolled back.' : 'Migrations NOT rolled back (irreversible).') +
          ` Original error: ${err.message}`);
      }
    }

    // 7. Commit DB version + manifest — ONLY after successful re-enable
    this._stmts.updateVersion.run(newVersion, JSON.stringify(manifest), specialistId);

    logger.info('SpecialistLoader', `Updated: ${specialistId} v${oldVersion} → v${newVersion}`);
    return { oldVersion, newVersion, wasEnabled, reversible };
  }

  /**
   * Check if all new migrations in a manifest have down() functions.
   * @returns {Promise<boolean>} true if all migrations are reversible
   */
  async _checkMigrationsReversible(specialistId, dir, manifest) {
    if (!manifest.migrations?.length) return true;

    const migrationsDir = path.join(dir, 'migrations');
    if (!fs.existsSync(migrationsDir)) return true;

    const applied = new Set(
      this._stmts.getMigrations.all(specialistId).map(r => r.migration_name)
    );

    for (const migrationName of manifest.migrations) {
      if (applied.has(migrationName)) continue;

      const migrationFile = path.join(migrationsDir, `${migrationName}.js`);
      if (!fs.existsSync(migrationFile)) continue;

      try {
        const mod = await import(migrationFile);
        if (typeof mod.down !== 'function') {
          logger.debug('SpecialistLoader', `Migration ${migrationName} has no down() — irreversible`);
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Rollback applied migrations in reverse order via their down() functions.
   */
  async _rollbackMigrations(specialistId, dir, manifest, migrationsApplied) {
    const migrationsDir = path.join(dir, 'migrations');

    // Reverse order — last applied first
    for (let i = migrationsApplied.length - 1; i >= 0; i--) {
      const migrationName = migrationsApplied[i];
      const migrationFile = path.join(migrationsDir, `${migrationName}.js`);

      try {
        const mod = await import(migrationFile);
        if (typeof mod.down !== 'function') {
          logger.warn('SpecialistLoader', `Cannot rollback ${migrationName}: no down()`);
          continue;
        }

        const rollback = this.db.transaction(() => {
          mod.down(this.db);
          this.db.prepare(
            'DELETE FROM specialist_migrations WHERE specialist_id = ? AND migration_name = ?'
          ).run(specialistId, migrationName);
        });

        rollback();
        logger.info('SpecialistLoader', `Rolled back migration: ${specialistId}/${migrationName}`);
      } catch (err) {
        logger.error('SpecialistLoader', `Rollback failed for ${specialistId}/${migrationName}: ${err.message}`);
      }
    }
  }

  /**
   * Compare semver strings. Returns: 1 if a > b, -1 if a < b, 0 if equal.
   */
  _compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  /**
   * Resolve the expertise ID used in runtime from specialist ID.
   * accountant-cz manifest registers as 'accountant' in runtime.
   */
  _resolveExpertiseId(specialistId, manifest) {
    // Check if the specialist registered under a different expertise ID
    // by looking at manifest.expertises or the registered tools
    if (manifest?.expertises?.length) {
      return manifest.expertises[0]; // primary expertise ID
    }
    return specialistId;
  }

  _getManifestFromDiscovered(specialistId) {
    const discovered = this._discovered.get(specialistId);
    return discovered?.manifest || null;
  }

  /**
   * Remove scenarios registered by a specialist.
   */
  _cleanupScenarios(expertiseId) {
    try {
      // Lazy: only cleanup if scenario-engine is already loaded
      const scenarioMod = this._scenarioRegistry;
      if (scenarioMod && typeof scenarioMod.unregisterBySpecialist === 'function') {
        scenarioMod.unregisterBySpecialist(expertiseId);
      }
    } catch {
      // scenario-engine not loaded — nothing to clean
    }
  }

  /**
   * Set scenario registry reference for cleanup during disable.
   * @param {Object} registry - ScenarioRegistry instance
   */
  setScenarioRegistry(registry) {
    this._scenarioRegistry = registry;
  }

  // ─── D7: Dependency System ──────────────────────────────────────────────

  /**
   * Topological sort of specialist rows by dependencies (Kahn's algorithm).
   * Specialists without dependencies come first.
   * Falls back to original order if cycle detected (shouldn't happen with valid manifests).
   * @param {Object[]} rows - DB rows with id field
   * @returns {Object[]} sorted rows
   */
  _topologicalSort(rows) {
    if (rows.length <= 1) return rows;

    const rowMap = new Map(rows.map(r => [r.id, r]));
    const inDegree = new Map(rows.map(r => [r.id, 0]));
    const adjacency = new Map(rows.map(r => [r.id, []]));

    // Build graph
    for (const row of rows) {
      const manifest = this._getManifestFromDiscovered(row.id);
      if (!manifest?.dependencies) continue;
      for (const depId of Object.keys(manifest.dependencies)) {
        if (rowMap.has(depId)) {
          // depId must load before row.id
          adjacency.get(depId).push(row.id);
          inDegree.set(row.id, (inDegree.get(row.id) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue = rows.filter(r => inDegree.get(r.id) === 0).map(r => r.id);
    const sorted = [];

    while (queue.length > 0) {
      const id = queue.shift();
      sorted.push(rowMap.get(id));
      for (const neighbor of (adjacency.get(id) || [])) {
        const deg = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) queue.push(neighbor);
      }
    }

    if (sorted.length < rows.length) {
      logger.warn('SpecialistLoader', 'Dependency cycle detected — using original order');
      return rows;
    }

    return sorted;
  }

  /**
   * Check that all dependencies are installed and enabled.
   * @param {Object} dependencies - { specialistId: ">=X.Y.Z" }
   * @returns {string[]} missing or disabled dependency IDs
   */
  _checkDependencies(dependencies) {
    const missing = [];
    for (const [depId, depVersion] of Object.entries(dependencies)) {
      const row = this._stmts.getSpecialist.get(depId);
      if (!row) {
        missing.push(`${depId} (not installed)`);
        continue;
      }
      if (row.status !== 'enabled') {
        missing.push(`${depId} (${row.status})`);
        continue;
      }
      // Version check (reuse checkEngineCompat)
      const compat = checkEngineCompat(depVersion, row.version);
      if (!compat.compatible) {
        missing.push(`${depId} (requires ${depVersion}, installed ${row.version})`);
      }
    }
    return missing;
  }

  /**
   * Get list of specialist IDs that depend on this specialist.
   * @param {string} specialistId
   * @returns {string[]} dependent specialist IDs
   */
  getDependents(specialistId) {
    const result = [];
    const installed = this._stmts.listAll.all();
    for (const row of installed) {
      if (row.id === specialistId) continue;
      try {
        const manifest = JSON.parse(row.manifest_json);
        if (manifest.dependencies && specialistId in manifest.dependencies) {
          result.push(row.id);
        }
      } catch {
        // Invalid manifest — skip
      }
    }
    return result;
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  /**
   * Get all installed specialists.
   */
  getInstalled() {
    return this._stmts.listAll.all();
  }

  /**
   * Get all enabled specialists.
   */
  getEnabled() {
    return this._stmts.listEnabled.all();
  }

  /**
   * Get manifest for a specialist.
   */
  getManifest(specialistId) {
    const row = this._stmts.getSpecialist.get(specialistId);
    if (!row) return null;
    try {
      return JSON.parse(row.manifest_json);
    } catch {
      return null;
    }
  }

  // ─── Integrity Check ─────────────────────────────────────────────────────

  /**
   * Verify runtime state matches DB state.
   * Returns { ok: boolean, issues: string[] }
   */
  checkIntegrity() {
    const issues = [];
    const enabledRows = this._stmts.listEnabled.all();

    for (const row of enabledRows) {
      const manifest = this._getManifestFromDiscovered(row.id);
      const expertiseId = this._resolveExpertiseId(row.id, manifest);

      // Check tools registered
      if (!this.runtime.isSpecialist(expertiseId)) {
        issues.push(`${row.id}: enabled in DB but NOT registered in runtime`);
      }

      // Check module loaded
      if (!this._modules.has(row.id)) {
        issues.push(`${row.id}: enabled in DB but module NOT loaded`);
      }
    }

    // Check for ghost registrations (in runtime but not in DB as enabled)
    const runtimeIds = this.runtime.getSpecialistIds();
    const enabledExpertiseIds = new Set(enabledRows.map(r => {
      const manifest = this._getManifestFromDiscovered(r.id);
      return this._resolveExpertiseId(r.id, manifest);
    }));

    for (const rid of runtimeIds) {
      if (!enabledExpertiseIds.has(rid)) {
        issues.push(`${rid}: registered in runtime but NOT enabled in DB (ghost)`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  // ─── Convenience: Full Boot ─────────────────────────────────────────────

  /**
   * Run the complete boot sequence: discover → install → enable.
   * Single call for server.js integration.
   */
  async boot() {
    const startTime = Date.now();
    this.discoverAll();
    this.installPending();
    await this.enableAll();

    // Post-boot integrity check
    const integrity = this.checkIntegrity();
    if (!integrity.ok) {
      for (const issue of integrity.issues) {
        logger.warn('SpecialistLoader', `Integrity: ${issue}`);
      }
    }

    // v82: Telemetry — passive, never throws
    this._telemetry?.record('lifecycle.boot', {
      durationMs: Date.now() - startTime,
      metadata: { enabled: this.getEnabled().length, total: this.getInstalled().length },
    });
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get or create the SpecialistLoader singleton.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} runtime - SpecialistRuntime instance
 * @param {Object} [options]
 * @returns {SpecialistLoader}
 */
export function getSpecialistLoader(db, runtime, options = {}) {
  if (!_instance) {
    if (!db) throw new Error('SpecialistLoader: db required on first call');
    if (!runtime) throw new Error('SpecialistLoader: runtime required on first call');
    _instance = new SpecialistLoader(db, runtime, options);
  }
  return _instance;
}

export default { SpecialistLoader, getSpecialistLoader };
