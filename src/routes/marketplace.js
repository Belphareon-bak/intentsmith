// Marketplace REST API — catalog, install, uninstall, update, export (v124)
// ══════════════════════════════════════════════════════════════════════════════

import { semverNewer } from '../marketplace/package-installer.js';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export function createMarketplaceRoutes(deps) {
  const { sendJSON, logger, marketplaceClient, packageInstaller,
    expertiseLayer, specialistLoader } = deps;

  // Guard: if marketplace not initialized
  if (!marketplaceClient || !packageInstaller) {
    const notAvailable = (_req, res) => sendJSON(res, 503, { ok: false, error: 'Marketplace not available' });
    return {
      'GET /api/marketplace/catalog': notAvailable,
      'POST /api/marketplace/catalog/refresh': notAvailable,
      'GET /api/marketplace/installed': notAvailable,
      'POST /api/marketplace/install/:type/:id': notAvailable,
      'DELETE /api/marketplace/installed/:type/:id': notAvailable,
      'POST /api/marketplace/update/:type/:id': notAvailable,
      'POST /api/marketplace/export/:type/:id': notAvailable,
    };
  }

  return {
    // ─── Catalog (cached, enriched with install status) ─────────────────
    'GET /api/marketplace/catalog': async (req, res) => {
      try {
        const catalog = await marketplaceClient.getCatalog();
        const installed = packageInstaller.getInstalled();
        const url = new URL(req.url, 'http://localhost');
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
        const typeFilter = url.searchParams.get('type') || null;

        const enriched = _enrichCatalog(catalog, installed, { page, limit, typeFilter });
        sendJSON(res, 200, { ok: true, ...enriched });
      } catch (err) {
        logger.error('Marketplace', `marketplace.catalog.fetch fail: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Force refresh catalog ──────────────────────────────────────────
    'POST /api/marketplace/catalog/refresh': async (_req, res) => {
      try {
        const catalog = await marketplaceClient.getCatalog(true);
        const installed = packageInstaller.getInstalled();
        const enriched = _enrichCatalog(catalog, installed);
        sendJSON(res, 200, { ok: true, ...enriched });
      } catch (err) {
        logger.error('Marketplace', `marketplace.catalog.fetch fail: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── List installed marketplace packages ────────────────────────────
    'GET /api/marketplace/installed': (_req, res) => {
      try {
        const installed = packageInstaller.getInstalled();
        sendJSON(res, 200, { ok: true, installed });
      } catch (err) {
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Install package ────────────────────────────────────────────────
    'POST /api/marketplace/install/:type/:id': async (req, res, params) => {
      const { type, id } = params;
      if (!['skill', 'expertise', 'specialist'].includes(type)) {
        return sendJSON(res, 400, { ok: false, error: `Invalid type: ${type}` });
      }

      try {
        const catalog = await marketplaceClient.getCatalog();
        const typeKey = type + 's';
        const entry = (catalog.packages?.[typeKey] || []).find(e => e.id === id);
        if (!entry) {
          return sendJSON(res, 404, { ok: false, error: `Package not found: ${type}/${id}` });
        }

        logger.info('Marketplace', `marketplace.install.start ${type}/${id}`);
        const result = await packageInstaller.install(type, entry, catalog);
        sendJSON(res, 200, { ok: true, ...result });
      } catch (err) {
        logger.error('Marketplace', `marketplace.install.fail ${type}/${id}: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Uninstall package ──────────────────────────────────────────────
    'DELETE /api/marketplace/installed/:type/:id': async (_req, res, params) => {
      const { type, id } = params;
      if (!['skill', 'expertise', 'specialist'].includes(type)) {
        return sendJSON(res, 400, { ok: false, error: `Invalid type: ${type}` });
      }

      try {
        await packageInstaller.uninstall(type, id);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        logger.error('Marketplace', `marketplace.uninstall fail ${type}/${id}: ${err.message}`);
        const status = err.message.includes('Not installed') ? 404
          : err.message.includes('Cannot uninstall') ? 409 : 500;
        sendJSON(res, status, { ok: false, error: err.message });
      }
    },

    // ─── Update package to latest ───────────────────────────────────────
    'POST /api/marketplace/update/:type/:id': async (_req, res, params) => {
      const { type, id } = params;
      try {
        const catalog = await marketplaceClient.getCatalog();
        const typeKey = type + 's';
        const entry = (catalog.packages?.[typeKey] || []).find(e => e.id === id);
        if (!entry) {
          return sendJSON(res, 404, { ok: false, error: `Package not found: ${type}/${id}` });
        }

        const result = await packageInstaller.update(type, id, entry, catalog);
        sendJSON(res, 200, { ok: true, ...result });
      } catch (err) {
        logger.error('Marketplace', `marketplace.update fail ${type}/${id}: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Export local entity as marketplace package ───────────────────
    'POST /api/marketplace/export/:type/:id': async (req, res, params) => {
      const { type, id } = params;
      if (!['expertise', 'specialist'].includes(type)) {
        return sendJSON(res, 400, { ok: false, error: `Export not supported for type: ${type}` });
      }

      try {
        if (type === 'expertise') {
          const registry = expertiseLayer?.expertiseRegistry;
          if (!registry) return sendJSON(res, 503, { ok: false, error: 'Expertise registry not available' });

          // Find expertise by id
          const all = typeof registry.getAll === 'function' ? registry.getAll() : [];
          const exp = all.find(e => e.id === id || e.name === id);
          if (!exp) return sendJSON(res, 404, { ok: false, error: `Expertise not found: ${id}` });

          // Build marketplace-compatible JSON
          const pkg = {
            id: exp.id || id,
            name: exp.name,
            description: exp.description || exp.desc || '',
            version: exp.version || '1.0.0',
            domain: exp.domain || 'general',
            capabilities: exp.capabilities || {},
            tone: exp.tone || 'professional',
            temperature: exp.temperature ?? 0.5,
            systemPrompt: exp.systemPrompt || '',
            modules: exp.modules || {},
            parent: exp.parent || null,
          };

          const json = JSON.stringify(pkg, null, 2);
          const hash = createHash('sha256').update(json).digest('hex');

          logger.info('Marketplace', `marketplace.export expertise/${id} (${json.length} B, sha256: ${hash.slice(0, 12)}...)`);
          sendJSON(res, 200, {
            ok: true, type: 'expertise', id: pkg.id, name: pkg.name, version: pkg.version,
            sha256: hash, size: json.length,
            content: pkg,
            catalogEntry: {
              id: pkg.id, name: pkg.name, description: pkg.description,
              version: pkg.version, author: 'local', tags: [pkg.domain].filter(Boolean),
              sha256: hash, size: json.length, engine: '>=120.0.0',
              dependencies: [], conflicts: [],
            },
          });

        } else if (type === 'specialist') {
          if (!specialistLoader) return sendJSON(res, 503, { ok: false, error: 'Specialist loader not available' });

          const specDir = specialistLoader._specialistsDir || path.join(process.cwd(), 'specialists');
          const specPath = path.join(specDir, id);

          // Check specialist exists
          const stat = await fs.stat(specPath).catch(() => null);
          if (!stat?.isDirectory()) {
            return sendJSON(res, 404, { ok: false, error: `Specialist directory not found: ${id}` });
          }

          // Read manifest
          const manifestPath = path.join(specPath, 'specialist.json');
          const manifestRaw = await fs.readFile(manifestPath, 'utf-8').catch(() => null);
          if (!manifestRaw) {
            return sendJSON(res, 404, { ok: false, error: `Manifest not found: ${id}/specialist.json` });
          }

          const manifest = JSON.parse(manifestRaw);

          // List all files in specialist dir (for size estimation)
          const files = [];
          const walk = async (dir, prefix = '') => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.name.startsWith('.')) continue;
              const full = path.join(dir, ent.name);
              const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
              if (ent.isDirectory()) await walk(full, rel);
              else {
                const s = await fs.stat(full);
                files.push({ path: rel, size: s.size });
              }
            }
          };
          await walk(specPath);

          const totalSize = files.reduce((sum, f) => sum + f.size, 0);

          // Create tar.gz in temp dir
          const tmpDir = path.join(process.cwd(), '.tmp', 'marketplace-export');
          await fs.mkdir(tmpDir, { recursive: true });
          const archivePath = path.join(tmpDir, `${id}.tar.gz`);

          const { execFileSync } = await import('child_process');
          execFileSync('tar', ['czf', archivePath, '-C', specDir, id], { timeout: 30000 });

          // Compute hash
          const archiveData = await fs.readFile(archivePath);
          const hash = createHash('sha256').update(archiveData).digest('hex');
          const archiveSize = archiveData.length;

          logger.info('Marketplace', `marketplace.export specialist/${id} (${archiveSize} B, ${files.length} files, sha256: ${hash.slice(0, 12)}...)`);

          sendJSON(res, 200, {
            ok: true, type: 'specialist', id: manifest.id || id,
            name: manifest.name || id, version: manifest.version || '1.0.0',
            sha256: hash, size: archiveSize, files: files.length,
            archivePath,
            catalogEntry: {
              id: manifest.id || id, name: manifest.name || id,
              description: manifest.description || '',
              version: manifest.version || '1.0.0',
              author: 'local',
              tags: (manifest.capabilities || []).slice(0, 5),
              sha256: hash, size: archiveSize,
              engine: manifest.engine || '>=121.0.0',
              dependencies: manifest.dependencies || [],
              conflicts: manifest.conflicts || [],
            },
          });

          // Cleanup temp after response
          fs.rm(archivePath, { force: true }).catch(() => {});
        }
      } catch (err) {
        logger.error('Marketplace', `marketplace.export fail ${type}/${id}: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },
  };
}

// ─── Catalog Enrichment ─────────────────────────────────────────────────────

function _enrichCatalog(catalog, installedList, options = {}) {
  const { page = 1, limit = 50, typeFilter = null } = options;

  const installedMap = new Map();
  for (const pkg of installedList) {
    installedMap.set(`${pkg.type}:${pkg.id}`, pkg);
  }

  const enrichType = (entries, type) => (entries || []).map(e => {
    const installed = installedMap.get(`${type}:${e.id}`);
    return {
      ...e,
      installed: !!installed,
      installedVersion: installed?.version || null,
      updateAvailable: installed ? semverNewer(e.version, installed.version) : false,
    };
  });

  const packages = {
    skills: enrichType(catalog.packages?.skills, 'skill'),
    expertises: enrichType(catalog.packages?.expertises, 'expertise'),
    specialists: enrichType(catalog.packages?.specialists, 'specialist'),
  };

  // Pagination
  if (typeFilter && packages[typeFilter]) {
    const items = packages[typeFilter];
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    return {
      schema: catalog.schema || 1,
      version: catalog.version,
      updated: catalog.updated,
      _stale: catalog._stale || false,
      _offline: catalog._offline || false,
      packages,
      pagination: {
        type: typeFilter,
        items: items.slice(start, start + limit),
        page, totalPages, total,
      },
    };
  }

  return {
    schema: catalog.schema || 1,
    version: catalog.version,
    updated: catalog.updated,
    _stale: catalog._stale || false,
    _offline: catalog._offline || false,
    packages,
  };
}

// Exported for testing
export { _enrichCatalog };
