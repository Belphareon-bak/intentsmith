// D8: Specialist Management REST API
// ══════════════════════════════════════════════════════════════════════════════
//
// CRUD + lifecycle endpoints for specialist packages.
// Wraps SpecialistLoader + SpecialistRuntime for IDE/CLI access.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} deps
 * @returns {Object} route map { 'METHOD /path': handler }
 */
export function createSpecialistRoutes(deps) {
  const { specialistLoader, specialistRuntime, sendJSON, parseBody, logger } = deps;

  // In-memory mutex per specialist — prevents concurrent enable/disable/update
  const _locks = new Map();

  function acquireLock(specialistId) {
    if (_locks.get(specialistId)) return false;
    _locks.set(specialistId, true);
    return true;
  }

  function releaseLock(specialistId) {
    _locks.delete(specialistId);
  }

  /**
   * Resolve expertiseId from specialist manifest.
   * accountant-cz registers as 'accountant' in runtime.
   */
  function resolveExpertiseId(specialistId) {
    const manifest = specialistLoader?.getManifest(specialistId);
    if (manifest?.expertises?.length) return manifest.expertises[0];
    return specialistId;
  }

  /**
   * Build tools summary for a specialist (from runtime, not manifest).
   */
  function getToolsSummary(specialistId) {
    const expertiseId = resolveExpertiseId(specialistId);
    const config = specialistRuntime?.getSpecialistConfig(expertiseId);
    return config?.tools || [];
  }

  // Guard: if loader not available, all endpoints 503
  if (!specialistLoader) {
    const notAvailable = (req, res) => {
      sendJSON(res, 503, { ok: false, error: 'Specialist system not available' });
    };
    return {
      'GET /api/specialists': notAvailable,
      'GET /api/specialists/:id': notAvailable,
      'POST /api/specialists/:id/enable': notAvailable,
      'POST /api/specialists/:id/disable': notAvailable,
      'POST /api/specialists/:id/update': notAvailable,
      'POST /api/specialists/discover': notAvailable,
      'GET /api/specialists/:id/integrity': notAvailable,
    };
  }

  return {
    // ─── List all installed specialists ─────────────────────────────────
    'GET /api/specialists': (req, res) => {
      try {
        const installed = specialistLoader.getInstalled();
        const result = installed.map(row => ({
          id: row.id,
          name: row.name,
          version: row.version,
          domain: row.domain,
          type: row.type,
          status: row.status,
          tools: getToolsSummary(row.id),
          installedAt: row.installed_at,
          enabledAt: row.enabled_at,
        }));
        sendJSON(res, 200, { ok: true, specialists: result });
      } catch (err) {
        logger.error('SpecialistAPI', `GET /api/specialists failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Get specialist detail ──────────────────────────────────────────
    'GET /api/specialists/:id': (req, res, params) => {
      try {
        const manifest = specialistLoader.getManifest(params.id);
        if (!manifest) {
          return sendJSON(res, 404, { ok: false, error: `Specialist not found: ${params.id}` });
        }

        const installed = specialistLoader.getInstalled().find(r => r.id === params.id);
        const expertiseId = resolveExpertiseId(params.id);
        const isRegistered = specialistRuntime?.isSpecialist(expertiseId) || false;

        sendJSON(res, 200, {
          ok: true,
          id: params.id,
          manifest,
          status: installed?.status || 'unknown',
          version: installed?.version || manifest.version,
          isRegistered,
          tools: getToolsSummary(params.id),
          installedAt: installed?.installed_at,
          enabledAt: installed?.enabled_at,
          disabledAt: installed?.disabled_at,
        });
      } catch (err) {
        logger.error('SpecialistAPI', `GET /api/specialists/${params.id} failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Enable specialist ──────────────────────────────────────────────
    'POST /api/specialists/:id/enable': async (req, res, params) => {
      const id = params.id;
      if (!acquireLock(id)) {
        return sendJSON(res, 409, { ok: false, error: `Operation in progress for ${id}` });
      }

      try {
        await specialistLoader.enable(id);
        const manifest = specialistLoader.getManifest(id);
        sendJSON(res, 200, {
          ok: true,
          status: 'enabled',
          version: manifest?.version || 'unknown',
        });
      } catch (err) {
        logger.error('SpecialistAPI', `Enable ${id} failed: ${err.message}`);
        sendJSON(res, 400, { ok: false, error: err.message });
      } finally {
        releaseLock(id);
      }
    },

    // ─── Disable specialist ─────────────────────────────────────────────
    'POST /api/specialists/:id/disable': (req, res, params) => {
      const id = params.id;
      if (!acquireLock(id)) {
        return sendJSON(res, 409, { ok: false, error: `Operation in progress for ${id}` });
      }

      try {
        // D7: Loader.disable() checks dependents and throws if any exist
        specialistLoader.disable(id);
        sendJSON(res, 200, { ok: true, status: 'disabled' });
      } catch (err) {
        logger.error('SpecialistAPI', `Disable ${id} failed: ${err.message}`);
        sendJSON(res, 400, { ok: false, error: err.message });
      } finally {
        releaseLock(id);
      }
    },

    // ─── Update specialist ──────────────────────────────────────────────
    'POST /api/specialists/:id/update': async (req, res, params) => {
      const id = params.id;
      if (!acquireLock(id)) {
        return sendJSON(res, 409, { ok: false, error: `Operation in progress for ${id}` });
      }

      try {
        // Check busy guard
        const expertiseId = resolveExpertiseId(id);
        if (specialistRuntime?.isSpecialistBusy(expertiseId)) {
          return sendJSON(res, 409, {
            ok: false,
            error: `Cannot update ${id}: tools currently executing`,
          });
        }

        // Re-discover to pick up new files
        specialistLoader.discoverAll();

        const result = await specialistLoader.update(id);
        if (!result) {
          return sendJSON(res, 200, {
            ok: true,
            message: 'Already up to date',
            version: specialistLoader.getManifest(id)?.version,
          });
        }

        sendJSON(res, 200, {
          ok: true,
          oldVersion: result.oldVersion,
          newVersion: result.newVersion,
          wasEnabled: result.wasEnabled,
          reversible: result.reversible,
        });
      } catch (err) {
        logger.error('SpecialistAPI', `Update ${id} failed: ${err.message}`);
        sendJSON(res, 400, { ok: false, error: err.message });
      } finally {
        releaseLock(id);
      }
    },

    // ─── Re-scan disk for new specialists ───────────────────────────────
    'POST /api/specialists/discover': async (req, res) => {
      try {
        const before = new Set(specialistLoader.getInstalled().map(r => r.id));
        const discovered = specialistLoader.discoverAll();
        specialistLoader.installPending();
        await specialistLoader.enableAll();

        const after = specialistLoader.getInstalled();
        const newlyInstalled = after.filter(r => !before.has(r.id)).map(r => r.id);

        sendJSON(res, 200, {
          ok: true,
          discovered: discovered.map(m => m.id),
          newlyInstalled,
          total: after.length,
        });
      } catch (err) {
        logger.error('SpecialistAPI', `Discover failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },

    // ─── Check integrity ────────────────────────────────────────────────
    'GET /api/specialists/:id/integrity': (req, res, params) => {
      try {
        const manifest = specialistLoader.getManifest(params.id);
        if (!manifest) {
          return sendJSON(res, 404, { ok: false, error: `Specialist not found: ${params.id}` });
        }

        const integrity = specialistLoader.checkIntegrity();
        // Filter issues for this specific specialist
        const relevantIssues = integrity.issues.filter(i =>
          i.includes(params.id) || i.includes(resolveExpertiseId(params.id))
        );

        sendJSON(res, 200, {
          ok: relevantIssues.length === 0,
          issues: relevantIssues,
        });
      } catch (err) {
        logger.error('SpecialistAPI', `Integrity check failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },
  };
}
