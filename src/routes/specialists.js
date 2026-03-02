// D8: Specialist Management REST API
// ══════════════════════════════════════════════════════════════════════════════
//
// CRUD + lifecycle endpoints for specialist packages.
// Wraps SpecialistLoader + SpecialistRuntime for IDE/CLI access.
//
// v82: withApiTelemetry wrapper for passive latency observability.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * v82: Wrap a route handler with passive API telemetry.
 * Logs method, path (without query params), duration, and status.
 * Never throws, never blocks.
 */
function withApiTelemetry(handler, telemetry) {
  if (!telemetry) return handler;
  return async (req, res, params) => {
    const start = Date.now();
    const path = (req.url || '').split('?')[0]; // strip query params — no PII
    try {
      const result = await handler(req, res, params);
      telemetry.record('api.request', {
        durationMs: Date.now() - start,
        metadata: { method: req.method, path, status: 'ok' },
      });
      return result;
    } catch (err) {
      telemetry.record('api.request', {
        durationMs: Date.now() - start,
        metadata: { method: req.method, path, status: 'error' },
      });
      throw err;
    }
  };
}

/**
 * @param {object} deps
 * @returns {Object} route map { 'METHOD /path': handler }
 */
export function createSpecialistRoutes(deps) {
  const { specialistLoader, specialistRuntime, specialistTelemetry, sendJSON, parseBody, logger } = deps;

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

  // Helper: wrap handler with telemetry
  const t = (handler) => withApiTelemetry(handler, specialistTelemetry);

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
      'GET /api/specialists/telemetry': notAvailable,
      'GET /api/specialists/:id/expertises': notAvailable,
      'POST /api/specialists/:id/expertises': notAvailable,
      'DELETE /api/specialists/:id/expertises/:expertiseId': notAvailable,
      'PATCH /api/specialists/:id/expertises/:expertiseId': notAvailable,
    };
  }

  return {
    // ─── List all installed specialists ─────────────────────────────────
    'GET /api/specialists': t((req, res) => {
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
    }),

    // ─── Get specialist detail ──────────────────────────────────────────
    'GET /api/specialists/:id': t((req, res, params) => {
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
    }),

    // ─── Enable specialist ──────────────────────────────────────────────
    'POST /api/specialists/:id/enable': t(async (req, res, params) => {
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
    }),

    // ─── Disable specialist ─────────────────────────────────────────────
    'POST /api/specialists/:id/disable': t((req, res, params) => {
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
    }),

    // ─── Update specialist ──────────────────────────────────────────────
    'POST /api/specialists/:id/update': t(async (req, res, params) => {
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
    }),

    // ─── Re-scan disk for new specialists ───────────────────────────────
    'POST /api/specialists/discover': t(async (req, res) => {
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
    }),

    // ─── Check integrity ────────────────────────────────────────────────
    'GET /api/specialists/:id/integrity': t((req, res, params) => {
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
    }),

    // ─── D5: Specialist ↔ Expertise binding ─────────────────────────────

    // List all expertises bound to a specialist (with labels + priority)
    'GET /api/specialists/:id/expertises': t(async (req, res, params) => {
      try {
        const manifest = specialistLoader.getManifest(params.id);
        if (!manifest) {
          return sendJSON(res, 404, { ok: false, error: `Specialist not found: ${params.id}` });
        }

        const db = (await import('../db/database.js')).default;
        const rows = db.db.prepare(
          'SELECT expertise_id, label, priority, added_at FROM specialist_expertises WHERE specialist_id = ? ORDER BY priority DESC, added_at ASC'
        ).all(params.id);

        sendJSON(res, 200, { ok: true, expertises: rows });
      } catch (err) {
        logger.error('SpecialistAPI', `GET expertises for ${params.id} failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    }),

    // Bind an expertise to a specialist
    'POST /api/specialists/:id/expertises': t(async (req, res, params) => {
      try {
        const manifest = specialistLoader.getManifest(params.id);
        if (!manifest) {
          return sendJSON(res, 404, { ok: false, error: `Specialist not found: ${params.id}` });
        }

        const body = await parseBody(req);
        if (!body.expertiseId) {
          return sendJSON(res, 400, { ok: false, error: 'expertiseId is required' });
        }

        const db = (await import('../db/database.js')).default;
        const existing = db.db.prepare(
          'SELECT 1 FROM specialist_expertises WHERE specialist_id = ? AND expertise_id = ?'
        ).get(params.id, body.expertiseId);

        if (existing) {
          return sendJSON(res, 409, { ok: false, error: `Expertise ${body.expertiseId} already bound to ${params.id}` });
        }

        db.db.prepare(
          'INSERT INTO specialist_expertises (specialist_id, expertise_id, label, priority) VALUES (?, ?, ?, ?)'
        ).run(params.id, body.expertiseId, body.label || null, body.priority ?? 0);

        logger.info('SpecialistAPI', `Bound expertise ${body.expertiseId} → ${params.id}`, {
          label: body.label || null,
          priority: body.priority ?? 0,
        });

        sendJSON(res, 201, { ok: true, specialistId: params.id, expertiseId: body.expertiseId });
      } catch (err) {
        logger.error('SpecialistAPI', `POST expertise bind for ${params.id} failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    }),

    // Unbind an expertise from a specialist
    'DELETE /api/specialists/:id/expertises/:expertiseId': t(async (req, res, params) => {
      try {
        const db = (await import('../db/database.js')).default;
        const result = db.db.prepare(
          'DELETE FROM specialist_expertises WHERE specialist_id = ? AND expertise_id = ?'
        ).run(params.id, params.expertiseId);

        if (result.changes === 0) {
          return sendJSON(res, 404, { ok: false, error: `Binding not found: ${params.id} ↔ ${params.expertiseId}` });
        }

        logger.info('SpecialistAPI', `Unbound expertise ${params.expertiseId} from ${params.id}`);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        logger.error('SpecialistAPI', `DELETE expertise binding failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    }),

    // Update label or priority of a specialist ↔ expertise binding
    'PATCH /api/specialists/:id/expertises/:expertiseId': t(async (req, res, params) => {
      try {
        const body = await parseBody(req);

        const sets = [];
        const values = [];
        if (body.label !== undefined) { sets.push('label = ?'); values.push(body.label); }
        if (body.priority !== undefined) { sets.push('priority = ?'); values.push(body.priority); }

        if (sets.length === 0) {
          return sendJSON(res, 400, { ok: false, error: 'Nothing to update (provide label and/or priority)' });
        }

        values.push(params.id, params.expertiseId);

        const db = (await import('../db/database.js')).default;
        const result = db.db.prepare(
          `UPDATE specialist_expertises SET ${sets.join(', ')} WHERE specialist_id = ? AND expertise_id = ?`
        ).run(...values);

        if (result.changes === 0) {
          return sendJSON(res, 404, { ok: false, error: `Binding not found: ${params.id} ↔ ${params.expertiseId}` });
        }

        sendJSON(res, 200, { ok: true });
      } catch (err) {
        logger.error('SpecialistAPI', `PATCH expertise binding failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    }),

    // ─── v82: Telemetry summary ─────────────────────────────────────────
    'GET /api/specialists/telemetry': (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const specialistId = url.searchParams.get('specialist') || undefined;
        const since = url.searchParams.get('since') || undefined;
        const summary = specialistTelemetry?.getSummary({ specialistId, since }) || { events: 0 };
        sendJSON(res, 200, { ok: true, ...summary });
      } catch (err) {
        logger.error('SpecialistAPI', `Telemetry summary failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
      }
    },
  };
}
