// Package Installer — transactional install, rollback, mutex, dependency resolver
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ══════════════════════════════════════════════════════════════════════════════
// Semver helpers
// ══════════════════════════════════════════════════════════════════════════════

function parseSemver(v) {
  if (!v) return [0, 0, 0];
  const parts = v.replace(/^[v>=^~]+/, '').split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function semverGte(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return true; // equal
}

function semverNewer(catalog, installed) {
  const ca = parseSemver(catalog);
  const ia = parseSemver(installed);
  for (let i = 0; i < 3; i++) {
    if (ca[i] > ia[i]) return true;
    if (ca[i] < ia[i]) return false;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// Dependency spec parser: "type:id>=version" → { type, id, versionSpec }
// ══════════════════════════════════════════════════════════════════════════════

function parseDependencySpec(spec) {
  const match = spec.match(/^(skill|expertise|specialist):([a-z0-9_-]+)(>=.+)?$/i);
  if (!match) return null;
  return { type: match[1], id: match[2], versionSpec: match[3] || null };
}

// ══════════════════════════════════════════════════════════════════════════════
// PackageInstaller
// ══════════════════════════════════════════════════════════════════════════════

export class PackageInstaller {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {object} options
   * @param {import('./marketplace-client.js').MarketplaceClient} options.client
   * @param {object} [options.skillRegistry] — SkillRegistry with reload()
   * @param {object} [options.expertiseRegistry] — ExpertiseRegistry with addCustom/removeCustom
   * @param {object} [options.specialistLoader] — SpecialistLoader instance
   * @param {string} [options.projectRoot]
   */
  constructor(db, options = {}) {
    this._db = db;
    this._client = options.client;
    this._skillRegistry = options.skillRegistry || null;
    this._expertiseRegistry = options.expertiseRegistry || null;
    this._specialistLoader = options.specialistLoader || null;
    this._projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');

    this._locks = new Map(); // mutex per type:id
    this._prepareStatements();
  }

  _prepareStatements() {
    this._stmts = {
      getOne: this._db.prepare('SELECT * FROM marketplace_packages WHERE id = ? AND type = ?'),
      listAll: this._db.prepare('SELECT * FROM marketplace_packages ORDER BY type, id'),
      listByType: this._db.prepare('SELECT * FROM marketplace_packages WHERE type = ? ORDER BY id'),
      insert: this._db.prepare(
        `INSERT INTO marketplace_packages (id, type, name, version, author, description, tags, dependencies, download_url, sha256, catalog_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      update: this._db.prepare(
        `UPDATE marketplace_packages SET version = ?, catalog_data = ?, updated_at = datetime('now')
         WHERE id = ? AND type = ?`
      ),
      remove: this._db.prepare('DELETE FROM marketplace_packages WHERE id = ? AND type = ?'),
    };
  }

  // ─── Mutex ──────────────────────────────────────────────────────────────

  async _withLock(type, id, fn) {
    const key = `${type}:${id}`;
    while (this._locks.has(key)) {
      await this._locks.get(key);
    }
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    this._locks.set(key, promise);
    try {
      return await fn();
    } finally {
      this._locks.delete(key);
      resolve();
    }
  }

  // ─── Install ────────────────────────────────────────────────────────────

  /**
   * Install a package (with dependency resolution).
   * @param {string} type — 'skill' | 'expertise' | 'specialist'
   * @param {object} catalogEntry — entry from catalog
   * @param {object} [catalog] — full catalog for dependency resolution
   * @returns {Promise<{ ok: boolean, id: string, version: string, alreadyInstalled?: boolean, deps?: string[] }>}
   */
  async install(type, catalogEntry, catalog = null) {
    return this._withLock(type, catalogEntry.id, async () => {
      // Idempotent check
      const existing = this._stmts.getOne.get(catalogEntry.id, type);
      if (existing && existing.version === catalogEntry.version) {
        return { ok: true, id: catalogEntry.id, version: catalogEntry.version, alreadyInstalled: true };
      }

      logger.info('Marketplace', `marketplace.install.start ${type}/${catalogEntry.id}@${catalogEntry.version}`);

      // Dependency resolution
      const installedDeps = [];
      if (catalog && catalogEntry.dependencies?.length) {
        const depOrder = this.resolveDependencies(catalogEntry, catalog);
        for (const dep of depOrder) {
          if (!this.isInstalled(dep.type, dep.id)) {
            const typeKey = dep.type + 's';
            const depEntry = (catalog.packages?.[typeKey] || []).find(e => e.id === dep.id);
            if (!depEntry) {
              throw new Error(`Dependency not found in catalog: ${dep.type}:${dep.id}`);
            }
            // Install dependency (without further dep resolution to avoid recursion loops)
            await this._installByType(dep.type, depEntry);
            installedDeps.push(`${dep.type}:${dep.id}`);
          }
        }
      }

      await this._installByType(type, catalogEntry);

      logger.info('Marketplace', `marketplace.install.success ${type}/${catalogEntry.id}@${catalogEntry.version}`);
      return { ok: true, id: catalogEntry.id, version: catalogEntry.version, deps: installedDeps };
    });
  }

  async _installByType(type, entry) {
    switch (type) {
      case 'skill': return this._installSkill(entry);
      case 'expertise': return this._installExpertise(entry);
      case 'specialist': return this._installSpecialist(entry);
      default: throw new Error(`Unknown package type: ${type}`);
    }
  }

  async _installSkill(entry) {
    // Validate entry.id to prevent path traversal
    if (!entry.id || /[\/\\]|\.\./.test(entry.id)) {
      throw new Error(`Invalid package id: ${entry.id}`);
    }

    if (entry._local && entry.localPath) {
      // Local package — already on disk, just ensure it's in skills/
      const skillsDir = path.join(this._projectRoot, 'skills');
      const targetPath = path.join(skillsDir, `${entry.id}.json`);
      // Copy from localPath to skills/ if not already there
      if (path.resolve(entry.localPath) !== path.resolve(targetPath)) {
        const raw = await fs.readFile(entry.localPath, 'utf-8');
        await fs.writeFile(targetPath, raw, 'utf-8');
      }
    } else {
      const skillsDir = path.join(this._projectRoot, 'skills');
      const download = await this._client.downloadPackage(entry, skillsDir);

      // Rename to <id>.json if needed
      const targetPath = path.join(skillsDir, `${entry.id}.json`);
      if (download.path !== targetPath) {
        await fs.rename(download.path, targetPath);
      }
    }

    // Reload skill registry
    if (this._skillRegistry?.reload) {
      this._skillRegistry.reload();
    }

    this._recordInstall(entry, 'skill');
  }

  async _installExpertise(entry) {
    let config;

    if (entry._local && entry.localPath) {
      // Local package — read directly from disk
      const raw = await fs.readFile(entry.localPath, 'utf-8');
      config = JSON.parse(raw);
    } else {
      // Remote — download
      const tempDir = path.join(this._projectRoot, '.tmp', 'marketplace');
      try {
        const download = await this._client.downloadPackage(entry, tempDir);
        const raw = await fs.readFile(download.path, 'utf-8');
        config = JSON.parse(raw);
      } finally {
        await fs.rm(path.join(tempDir), { recursive: true, force: true }).catch(() => {});
      }
    }

    if (!config.id) config.id = entry.id;
    config.isCustom = true;

    if (this._expertiseRegistry?.addCustom) {
      this._expertiseRegistry.addCustom(config);
    }

    this._recordInstall(entry, 'expertise');
  }

  async _installSpecialist(entry) {
    const specialistsDir = path.join(this._projectRoot, 'specialists');
    const installingDir = path.join(specialistsDir, '.installing', entry.id);
    const finalDir = path.join(specialistsDir, entry.id);

    try {
      // Download to temp
      const tempDir = path.join(this._projectRoot, '.tmp', 'marketplace');
      const download = await this._client.downloadPackage(entry, tempDir);

      // Extract to .installing/<id>/ (same filesystem for atomic rename)
      await fs.rm(installingDir, { recursive: true, force: true }).catch(() => {});
      await this._client.extractArchive(download.path, installingDir);

      // Validate manifest
      const manifestPath = path.join(installingDir, 'specialist.json');
      try {
        await fs.access(manifestPath);
      } catch {
        throw new Error(`Missing specialist.json in archive for ${entry.id}`);
      }

      // Atomic rename
      await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
      await fs.rename(installingDir, finalDir);

      // Discover + install + enable via specialist loader
      if (this._specialistLoader) {
        await this._specialistLoader.discoverAll();
        await this._specialistLoader.installPending();
        try {
          await this._specialistLoader.enable(entry.id);
        } catch (err) {
          logger.warn('Marketplace', `Specialist ${entry.id} installed but enable failed: ${err.message}`);
        }
      }

      // DB write only after successful enable
      this._recordInstall(entry, 'specialist');

      // Cleanup temp
      await fs.unlink(download.path).catch(() => {});
    } catch (err) {
      // Rollback
      logger.error('Marketplace', `marketplace.install.rollback ${entry.id}: ${err.message}`);
      await fs.rm(installingDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(finalDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  _recordInstall(entry, type) {
    // Update if already exists (different version), else insert
    const existing = this._stmts.getOne.get(entry.id, type);
    if (existing) {
      this._stmts.update.run(entry.version, JSON.stringify(entry), entry.id, type);
    } else {
      this._stmts.insert.run(
        entry.id, type,
        entry.name || entry.id,
        entry.version,
        entry.author || null,
        entry.description || null,
        JSON.stringify(entry.tags || []),
        JSON.stringify(entry.dependencies || []),
        entry.downloadUrl,
        entry.sha256 || null,
        JSON.stringify(entry),
      );
    }
  }

  // ─── Uninstall ──────────────────────────────────────────────────────────

  /**
   * Uninstall a package. Blocks if other packages depend on it.
   */
  async uninstall(type, id) {
    return this._withLock(type, id, async () => {
      if (!this.isInstalled(type, id)) {
        throw new Error(`Not installed: ${type}/${id}`);
      }

      // Check dependents
      const dependents = this.checkDependents(type, id);
      if (dependents.length > 0) {
        throw new Error(`Cannot uninstall ${type}/${id}: used by ${dependents.join(', ')}`);
      }

      logger.info('Marketplace', `marketplace.uninstall ${type}/${id}`);

      switch (type) {
        case 'skill': await this._uninstallSkill(id); break;
        case 'expertise': await this._uninstallExpertise(id); break;
        case 'specialist': await this._uninstallSpecialist(id); break;
        default: throw new Error(`Unknown type: ${type}`);
      }

      this._stmts.remove.run(id, type);
    });
  }

  async _uninstallSkill(id) {
    const skillPath = path.join(this._projectRoot, 'skills', `${id}.json`);
    await fs.unlink(skillPath).catch(() => {});
    if (this._skillRegistry?.reload) {
      this._skillRegistry.reload();
    }
  }

  async _uninstallExpertise(id) {
    if (this._expertiseRegistry?.removeCustom) {
      this._expertiseRegistry.removeCustom(id);
    }
  }

  async _uninstallSpecialist(id) {
    if (this._specialistLoader) {
      try { await this._specialistLoader.disable(id); } catch {}
    }
    const dir = path.join(this._projectRoot, 'specialists', id);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  // ─── Update ─────────────────────────────────────────────────────────────

  /**
   * Update a package to a new version (uninstall + install).
   */
  async update(type, id, catalogEntry, catalog = null) {
    return this._withLock(type, id, async () => {
      logger.info('Marketplace', `marketplace.update ${type}/${id} → ${catalogEntry.version}`);

      // Uninstall (bypass lock since we already hold it)
      const existing = this._stmts.getOne.get(id, type);
      if (existing) {
        switch (type) {
          case 'skill': await this._uninstallSkill(id); break;
          case 'expertise': await this._uninstallExpertise(id); break;
          case 'specialist': await this._uninstallSpecialist(id); break;
        }
        this._stmts.remove.run(id, type);
      }

      // Install new version
      await this._installByType(type, catalogEntry);

      return { ok: true, id, version: catalogEntry.version, previousVersion: existing?.version || null };
    });
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  /**
   * List installed marketplace packages.
   * @param {string} [type] — optional filter by type
   */
  getInstalled(type = null) {
    const rows = type ? this._stmts.listByType.all(type) : this._stmts.listAll.all();
    return rows.map(r => ({
      ...r,
      tags: _parseJson(r.tags, []),
      dependencies: _parseJson(r.dependencies, []),
    }));
  }

  isInstalled(type, id) {
    return !!this._stmts.getOne.get(id, type);
  }

  getInstalledVersion(type, id) {
    const row = this._stmts.getOne.get(id, type);
    return row?.version || null;
  }

  // ─── Dependency Resolution ──────────────────────────────────────────────

  /**
   * Resolve dependencies for a catalog entry. Returns topological install order.
   * @param {object} entry — catalog entry with dependencies[]
   * @param {object} catalog — full catalog
   * @returns {Array<{ type: string, id: string }>} — install order (not including entry itself)
   */
  resolveDependencies(entry, catalog) {
    const result = [];
    const visited = new Set();
    const inStack = new Set(); // circular detection

    const resolve = (deps, parentLabel) => {
      for (const spec of (deps || [])) {
        const parsed = parseDependencySpec(spec);
        if (!parsed) continue;

        const key = `${parsed.type}:${parsed.id}`;

        // Circular detection
        if (inStack.has(key)) {
          throw new Error(`Circular dependency detected: ${parentLabel} → ${key}`);
        }
        if (visited.has(key)) continue;

        inStack.add(key);

        // Check if already installed with satisfying version
        const installedVersion = this.getInstalledVersion(parsed.type, parsed.id);
        if (installedVersion) {
          if (!parsed.versionSpec || semverGte(installedVersion, parsed.versionSpec.replace(/^>=/, ''))) {
            visited.add(key);
            inStack.delete(key);
            continue; // satisfied
          }
        }

        // Find in catalog
        const typeKey = parsed.type + 's';
        const depEntry = (catalog.packages?.[typeKey] || []).find(e => e.id === parsed.id);
        if (depEntry) {
          // Resolve transitive deps
          resolve(depEntry.dependencies, key);
        }

        result.push({ type: parsed.type, id: parsed.id });
        visited.add(key);
        inStack.delete(key);
      }
    };

    resolve(entry.dependencies, `${entry.id}`);

    logger.info('Marketplace', `marketplace.dependency.resolve ${entry.id}: ${result.length} deps [${result.map(d => d.type + ':' + d.id).join(', ')}]`);
    return result;
  }

  /**
   * Check which installed packages depend on the given package.
   * @returns {string[]} — list of "type:id" that depend on this package
   */
  checkDependents(type, id) {
    const depSpec = `${type}:${id}`;
    const all = this._stmts.listAll.all();
    const dependents = [];

    for (const pkg of all) {
      const deps = _parseJson(pkg.dependencies, []);
      for (const spec of deps) {
        const parsed = parseDependencySpec(spec);
        if (parsed && parsed.type === type && parsed.id === id) {
          dependents.push(`${pkg.type}:${pkg.id}`);
          break;
        }
      }
    }

    if (dependents.length > 0) {
      logger.warn('Marketplace', `marketplace.dependency.blocked ${depSpec}: used by ${dependents.join(', ')}`);
    }
    return dependents;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function _parseJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// Exported for tests and routes
export { parseSemver, semverGte, semverNewer, parseDependencySpec };

export default PackageInstaller;
