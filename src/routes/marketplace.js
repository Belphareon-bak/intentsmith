// Marketplace REST API — catalog, install, uninstall, update (v123)
// ══════════════════════════════════════════════════════════════════════════════

import { semverNewer } from '../marketplace/package-installer.js';

export function createMarketplaceRoutes(deps) {
  const { sendJSON, logger, marketplaceClient, packageInstaller } = deps;

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
