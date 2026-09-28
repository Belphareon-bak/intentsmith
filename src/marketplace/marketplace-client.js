// Marketplace Client — catalog fetch, cache, download, hash, archive validation
// ══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { createWriteStream, createReadStream, readdirSync, readFileSync, existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { logger } from '../core/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/C3studio/C3-agent/master/marketplace/catalog.json';
const CATALOG_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50 MB

const EMPTY_CATALOG = Object.freeze({
  _offline: true,
  schema: 1,
  version: 0,
  updated: null,
  packages: { skills: [], expertises: [], specialists: [] },
});

// ══════════════════════════════════════════════════════════════════════════════
// MarketplaceClient
// ══════════════════════════════════════════════════════════════════════════════

export class MarketplaceClient {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {{ catalogUrl?: string }} options
   */
  constructor(db, options = {}) {
    this._db = db;
    this._catalogUrl = options.catalogUrl || DEFAULT_CATALOG_URL;
    this._projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
    this._fetchPromise = null; // fetch mutex
    this._prepareStatements();
  }

  _prepareStatements() {
    this._stmts = {
      getCache: this._db.prepare('SELECT catalog_json, fetched_at, etag FROM marketplace_catalog_cache WHERE id = 1'),
      setCache: this._db.prepare(
        `INSERT OR REPLACE INTO marketplace_catalog_cache (id, catalog_json, fetched_at, etag)
         VALUES (1, ?, datetime('now'), ?)`
      ),
    };
  }

  // ─── Catalog ────────────────────────────────────────────────────────────

  /**
   * Get catalog (cached, auto-refresh if stale, offline fallback).
   * @param {boolean} forceRefresh
   * @returns {Promise<object>}
   */
  async getCatalog(forceRefresh = false) {
    const cached = this._getCachedCatalog();

    if (!forceRefresh && cached && !this._isCacheStale(cached.fetched_at)) {
      return cached.catalog;
    }

    // Fetch mutex — prevent concurrent fetches
    if (this._fetchPromise) {
      return this._fetchPromise;
    }

    try {
      this._fetchPromise = this._fetchRemoteCatalog(cached?.etag);
      const catalog = await this._fetchPromise;

      if (catalog) {
        return this._mergeLocalPackages(catalog);
      }
    } catch (err) {
      logger.warn('Marketplace', `Catalog fetch failed: ${err.message}`);
    } finally {
      this._fetchPromise = null;
    }

    // Fallback: stale cache or empty
    if (cached) {
      return this._mergeLocalPackages({ ...cached.catalog, _stale: true });
    }
    return this._mergeLocalPackages({ ...EMPTY_CATALOG });
  }

  // ─── Local Package Discovery ────────────────────────────────────────────

  /**
   * Scan local directories for packages and merge into catalog.
   * Local entries get `_local: true` and `localPath` for direct disk install.
   */
  _mergeLocalPackages(catalog) {
    const local = this._scanLocalPackages();
    const totalLocal = local.skills.length + local.expertises.length + local.specialists.length;
    if (totalLocal === 0) return catalog;

    const merged = { ...catalog, packages: { ...catalog.packages } };

    for (const type of ['skills', 'expertises', 'specialists']) {
      const remoteEntries = merged.packages[type] || [];
      const localEntries = local[type] || [];
      const remoteIds = new Set(remoteEntries.map(e => e.id));
      const newLocal = localEntries.filter(e => !remoteIds.has(e.id));
      merged.packages[type] = [...remoteEntries, ...newLocal];
    }

    // Clear offline flag if we have local packages
    if (merged._offline && totalLocal > 0) {
      merged._offline = false;
    }

    return merged;
  }

  /**
   * Scan marketplace/packages/, skills/, and specialists/ for local entries.
   * @returns {{ skills: Array, expertises: Array, specialists: Array }}
   */
  _scanLocalPackages() {
    const result = { skills: [], expertises: [], specialists: [] };

    try {
      // ─── Expertises from marketplace/packages/expertises/ ───────────
      const expDir = path.join(this._projectRoot, 'marketplace', 'packages', 'expertises');
      if (existsSync(expDir)) {
        for (const file of readdirSync(expDir).filter(f => f.endsWith('.json'))) {
          try {
            const filePath = path.join(expDir, file);
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            result.expertises.push({
              id: data.id || file.replace('.json', '').replace(/-/g, '_'),
              name: data.name || data.id || file.replace('.json', ''),
              version: '1.0.0',
              description: data.description || '',
              author: 'local',
              tags: [data.domain].filter(Boolean),
              icon: data.icon || null,
              downloadUrl: 'local',
              _local: true,
              localPath: filePath,
            });
          } catch { /* skip invalid JSON */ }
        }
      }

      // ─── Skills from skills/ ───────────────────────────────────────
      const skillsDir = path.join(this._projectRoot, 'skills');
      if (existsSync(skillsDir)) {
        for (const file of readdirSync(skillsDir).filter(f => f.endsWith('.json'))) {
          try {
            const filePath = path.join(skillsDir, file);
            const data = JSON.parse(readFileSync(filePath, 'utf-8'));
            result.skills.push({
              id: data.id || file.replace('.json', ''),
              name: data.description ? data.description.substring(0, 60) : file.replace('.json', ''),
              version: String(data.version || 1),
              description: data.description || '',
              author: 'local',
              tags: [],
              downloadUrl: 'local',
              _local: true,
              _installed: true, // already in skills/ dir
              localPath: filePath,
            });
          } catch { /* skip */ }
        }
      }

      // ─── Specialists from specialists/ ─────────────────────────────
      const specDir = path.join(this._projectRoot, 'specialists');
      if (existsSync(specDir)) {
        for (const ent of readdirSync(specDir, { withFileTypes: true })) {
          if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
          try {
            const manifestPath = path.join(specDir, ent.name, 'specialist.json');
            if (!existsSync(manifestPath)) continue;
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            result.specialists.push({
              id: manifest.id || ent.name,
              name: manifest.name || ent.name,
              version: manifest.version || '1.0.0',
              description: manifest.description || '',
              author: 'local',
              tags: (manifest.capabilities || []).slice(0, 5),
              icon: manifest.icon || null,
              downloadUrl: 'local',
              _local: true,
              _installed: true, // already in specialists/ dir
              localPath: path.join(specDir, ent.name),
            });
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      logger.warn('Marketplace', `Local package scan failed: ${err.message}`);
    }

    return result;
  }

  /**
   * @param {string|null} etag
   * @returns {Promise<object|null>}
   */
  async _fetchRemoteCatalog(etag = null) {
    const headers = { 'Accept': 'application/json' };
    if (etag) headers['If-None-Match'] = etag;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(this._catalogUrl, {
        headers,
        signal: controller.signal,
      });

      if (response.status === 304 && etag) {
        // Not modified — update timestamp only
        this._stmts.setCache.run(this._getCachedCatalog()?.rawJson || '{}', etag);
        logger.info('Marketplace', 'Catalog not modified (304)');
        const cached = this._getCachedCatalog();
        return cached?.catalog || null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const json = JSON.parse(text);

      this._validateCatalogSchema(json);

      const newEtag = response.headers.get('etag') || null;
      this._stmts.setCache.run(text, newEtag);

      logger.info('Marketplace', `Catalog fetched: ${(json.packages?.skills?.length || 0) + (json.packages?.expertises?.length || 0) + (json.packages?.specialists?.length || 0)} packages`);
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Validate catalog structure before use.
   * @param {object} json
   */
  _validateCatalogSchema(json) {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid catalog: not an object');
    }
    if (!json.packages || typeof json.packages !== 'object') {
      throw new Error('Invalid catalog: missing packages');
    }
    for (const key of ['skills', 'expertises', 'specialists']) {
      if (json.packages[key] && !Array.isArray(json.packages[key])) {
        throw new Error(`Invalid catalog: packages.${key} must be array`);
      }
    }
    // Validate required fields per entry
    for (const key of ['skills', 'expertises', 'specialists']) {
      for (const entry of (json.packages[key] || [])) {
        if (!entry.id || !entry.version || !entry.downloadUrl) {
          throw new Error(`Invalid catalog entry in ${key}: missing id, version, or downloadUrl`);
        }
      }
    }
  }

  /**
   * @returns {{ catalog: object, fetched_at: string, etag: string|null, rawJson: string }|null}
   */
  _getCachedCatalog() {
    try {
      const row = this._stmts.getCache.get();
      if (!row) return null;
      return {
        catalog: JSON.parse(row.catalog_json),
        fetched_at: row.fetched_at,
        etag: row.etag,
        rawJson: row.catalog_json,
      };
    } catch {
      return null;
    }
  }

  _setCachedCatalog(json, etag) {
    this._stmts.setCache.run(JSON.stringify(json), etag);
  }

  /**
   * @param {string} fetchedAt — ISO datetime
   */
  _isCacheStale(fetchedAt) {
    if (!fetchedAt) return true;
    const age = Date.now() - new Date(fetchedAt + 'Z').getTime();
    return age > CATALOG_MAX_AGE_MS;
  }

  // ─── Download ──────────────────────────────────────────────────────────

  /**
   * Download a package file with streaming hash verification and size limit.
   * @param {{ downloadUrl: string, sha256?: string, id: string }} entry
   * @param {string} targetDir — directory to save downloaded file
   * @returns {Promise<{ path: string, verified: boolean }>}
   */
  async downloadPackage(entry, targetDir) {
    await fs.mkdir(targetDir, { recursive: true });

    const url = entry.downloadUrl;
    const filename = path.basename(new URL(url).pathname) || `${entry.id}.pkg`;
    const targetPath = path.join(targetDir, filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
      }

      // Stream download with hash + size check
      const hash = createHash('sha256');
      const writeStream = createWriteStream(targetPath);
      let size = 0;

      const body = response.body;
      if (!body) throw new Error('No response body');

      for await (const chunk of body) {
        size += chunk.length;
        if (size > MAX_PACKAGE_SIZE) {
          controller.abort();
          writeStream.destroy();
          await fs.unlink(targetPath).catch(() => {});
          throw new Error(`Package too large (>${MAX_PACKAGE_SIZE / 1024 / 1024} MB)`);
        }
        hash.update(chunk);
        writeStream.write(chunk);
      }

      await new Promise((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });

      // Verify hash
      const computed = hash.digest('hex');
      let verified = false;
      if (entry.sha256) {
        if (computed !== entry.sha256) {
          await fs.unlink(targetPath).catch(() => {});
          logger.error('Marketplace', `Hash mismatch for ${entry.id}: expected ${entry.sha256}, got ${computed}`);
          throw new Error(`SHA-256 mismatch for ${entry.id}`);
        }
        verified = true;
      } else {
        // v126: Require SHA-256 for remote packages — refuse unverified downloads
        await fs.unlink(targetPath).catch(() => {});
        throw new Error(`Package ${entry.id} missing SHA-256 hash — refusing unverified remote package`);
      }

      logger.info('Marketplace', `Downloaded ${entry.id} (${(size / 1024).toFixed(1)} kB, hash verified)`);
      return { path: targetPath, verified };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Archive Extraction ────────────────────────────────────────────────

  /**
   * Safely extract .tar.gz archive with path traversal + symlink protection.
   * @param {string} archivePath — path to .tar.gz file
   * @param {string} targetDir — directory to extract into
   * @returns {Promise<string>} — extracted directory path
   */
  async extractArchive(archivePath, targetDir) {
    await fs.mkdir(targetDir, { recursive: true });
    const resolvedTarget = path.resolve(targetDir);

    // Phase 1: List contents and validate all entries
    let listing;
    try {
      listing = execSync(`tar -tzf ${JSON.stringify(archivePath)}`, {
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      }).trim();
    } catch (err) {
      throw new Error(`Failed to list archive: ${err.message}`);
    }

    const entries = listing.split('\n').filter(Boolean);
    for (const entry of entries) {
      const resolved = path.resolve(resolvedTarget, entry);
      if (!resolved.startsWith(resolvedTarget + path.sep) && resolved !== resolvedTarget) {
        throw new Error(`Archive path traversal detected: ${entry}`);
      }
    }

    // Phase 2: Check for symlinks/hardlinks/devices via tar -tvf
    let verbose;
    try {
      verbose = execSync(`tar -tvf ${JSON.stringify(archivePath)}`, {
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      }).trim();
    } catch (err) {
      throw new Error(`Failed to inspect archive: ${err.message}`);
    }

    for (const line of verbose.split('\n')) {
      if (!line) continue;
      const typeChar = line.charAt(0);
      // Allow: '-' (regular file), 'd' (directory)
      // Reject: 'l' (symlink), 'h' (hardlink), 'c'/'b' (devices), 'p' (pipe)
      if (typeChar !== '-' && typeChar !== 'd') {
        throw new Error(`Unsupported archive entry type '${typeChar}': ${line.substring(0, 80)}`);
      }
    }

    // Phase 3: Extract
    execSync(`tar -xzf ${JSON.stringify(archivePath)} -C ${JSON.stringify(resolvedTarget)}`, {
      timeout: 60_000,
    });

    logger.info('Marketplace', `Extracted archive to ${resolvedTarget} (${entries.length} entries)`);
    return resolvedTarget;
  }
}

export default MarketplaceClient;
