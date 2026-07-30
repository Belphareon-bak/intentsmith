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
      'POST /api/specialists': notAvailable,
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
    'POST /api/specialists/:id/disable': t(async (req, res, params) => {
      const id = params.id;
      if (!acquireLock(id)) {
        return sendJSON(res, 409, { ok: false, error: `Operation in progress for ${id}` });
      }

      try {
        // D7: Loader.disable() checks dependents and throws if any exist
        await specialistLoader.disable(id);
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

    // ─── Create new specialist package (v122.2) ─────────────────────────
    'POST /api/specialists': t(async (req, res) => {
      try {
        const body = await parseBody(req);
        const { name, domain, description, icon } = body;

        if (!name || name.trim().length < 2) {
          return sendJSON(res, 400, { ok: false, error: 'Name is required (min 2 chars)' });
        }

        const id = name.trim().toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
          .substring(0, 32);

        if (!id) {
          return sendJSON(res, 400, { ok: false, error: 'Invalid name — cannot generate ID' });
        }

        // Check if already exists
        const existing = specialistLoader.getInstalled().find(r => r.id === id);
        if (existing) {
          return sendJSON(res, 409, { ok: false, error: `Specialist "${id}" already exists` });
        }

        const fs = await import('fs');
        const path = await import('path');
        const baseDir = specialistLoader.baseDir;
        const specDir = path.default.join(baseDir, id);

        if (fs.default.existsSync(specDir)) {
          return sendJSON(res, 409, { ok: false, error: `Directory specialists/${id}/ already exists` });
        }

        // Generate manifest
        const manifest = {
          manifestVersion: 2,
          id,
          version: '1.0.0',
          name: name.trim(),
          description: (description || '').trim() || `Specialista: ${name.trim()}`,
          domain: (domain || 'general').trim(),
          type: 'domain',
          engine: '>=122.0.0',
          entry: './index.js',
          tools: [],
          capabilities: [],
          expertises: [id],
          enabledByDefault: true,
        };

        // Generate stub index.js
        const safeId = id.replace(/-/g, '_');
        const safeName = name.trim();
        const safeIcon = (icon || '🤖').substring(0, 4);
        const safeDomain = (domain || 'general').trim();
        const safeDesc = (description || '').trim();

        const indexJs = `// ${safeName} — Auto-generated specialist
// ══════════════════════════════════════════════════════════════════════════════

const EXPERTISE = {
  id: '${id}',
  name: '${safeName}',
  icon: '${safeIcon}',
  domain: '${safeDomain}',
  description: '${safeDesc || safeName}',
  isCustom: true,
  primaryProblemTypes: ['procedural'],
  allowedRepresentations: ['structured', 'prose'],
  planningDepth: 'light',
  reviewPolicy: 'self',
  dataUsagePolicy: 'open',
  outputBias: 'neutral',
  temperature: 0.5,
  tools: [],
  capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 30, verbosity: 50 },
  tone: 'professional',
  modules: {
    domain_rules: [],
    emphasis: [],
    constraints: [],
    vocabulary: [],
    antipatterns: [],
  },
  systemPrompt: '${safeDesc ? safeDesc.replace(/'/g, "\\'") : 'Jsi specialista ' + safeName + '.'}',
};

export async function register(ctx) {
  const { runtime, manifest } = ctx;

  runtime.registerSpecialist({
    id: manifest.id,
    domain: '${safeDomain}',
    globalParamExtractor: null,
    tools: [],
  });

  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(EXPERTISE);
  }

  if (ctx.registries?.capability?.register) {
    for (const cap of manifest.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
    }
  }
}

export function unregister(ctx) {
  try { ctx.runtime?.unregisterSpecialist?.('${id}'); } catch {}
  try { ctx.registries?.expertise?.removeCustom('${id}'); } catch {}
  try { ctx.registries?.capability?.unregisterBySpecialist?.('${id}'); } catch {}
}
`;

        // Write files
        fs.default.mkdirSync(specDir, { recursive: true });
        fs.default.writeFileSync(path.default.join(specDir, 'specialist.json'), JSON.stringify(manifest, null, 2), 'utf-8');
        fs.default.writeFileSync(path.default.join(specDir, 'index.js'), indexJs, 'utf-8');

        // Reload loader
        specialistLoader.discoverAll();
        specialistLoader.installPending();
        await specialistLoader.enableAll();

        // Verify
        const installed = specialistLoader.getInstalled().find(r => r.id === id);

        logger.info('SpecialistAPI', `Created specialist "${id}" → specialists/${id}/`);
        sendJSON(res, 201, {
          ok: true,
          specialist: {
            id,
            name: safeName,
            domain: safeDomain,
            version: '1.0.0',
            status: installed ? installed.status : 'installed',
          },
        });
      } catch (err) {
        logger.error('SpecialistAPI', `Create specialist failed: ${err.message}`);
        sendJSON(res, 500, { ok: false, error: err.message });
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
