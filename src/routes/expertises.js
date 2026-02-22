// ════════════════════════════════════════════════════════════════════════════
// Expertise & Lifecycle Routes — extracted from server.js
// ════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

/**
 * Creates expertise-related routes (merge preview, expertise schema, wizard, CRUD).
 * @param {object} deps
 */
export function createExpertiseRoutes(deps) {
  const {
    parseBody, sendJSON, safeError, safeParseInt, sendStaticFile,
    logger, config, path, fs, randomUUID,
    expertiseLayer, expertiseStore, callWithAuth, createAuthToken, LLMCallerRole,
    checkWizardRateLimit, db,
  } = deps;

  const __dirname = path.dirname(__filename);
  const srcDir = path.resolve(__dirname, '..');

  function saveCustomExpertises() {
    if (!expertiseLayer) return;

    try {
      const experts = expertiseLayer.expertiseRegistry.getCustom();

      // Clear existing
      db.db.exec('DELETE FROM custom_expertises');

      // Insert all
      const insert = db.db.prepare('INSERT INTO custom_expertises (id, config) VALUES (?, ?)');
      for (const expert of experts) {
        insert.run(expert.id, JSON.stringify(expert.toJSON()));
      }

      logger.debug('Server', `Saved ${experts.length} custom experts`);
    } catch (err) {
      logger.warn('Server', `Could not save custom experts: ${err.message}`);
    }
  }

  return {
    // v63.0 — Merge Preview endpoint
    'GET /api/merge-preview': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const expertiseIds = url.searchParams.get('expertises');

        if (!expertiseIds) {
          return sendJSON(res, 400, { error: 'Missing "expertises" query parameter (comma-separated IDs)' });
        }

        const ids = expertiseIds.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0 || ids.length > 3) {
          return sendJSON(res, 400, { error: 'Provide 1-3 expertise IDs' });
        }

        // Lazy-load dependencies
        const { BUILTIN_EXPERTISES, expertiseRegistry } = await import('../expertises/expertise-layer.js');
        const { mergeExpertisePrompt } = await import('../expertises/merge-engine.js');
        const { CompatibilityBlockError } = await import('../expertises/merge-types.js');

        // Resolve expertises with weights from query params
        const expertises = [];
        for (const id of ids) {
          const expert = BUILTIN_EXPERTISES[id] || expertiseRegistry.get(id)?.toJSON?.() || null;
          if (!expert) {
            return sendJSON(res, 400, { error: `Unknown expertise: ${id}` });
          }

          // Parse and validate weight
          const rawWeight = url.searchParams.get(`weight_${id}`);
          let weight = 0.5;
          if (rawWeight !== null) {
            const parsed = parseFloat(rawWeight);
            if (isNaN(parsed)) {
              return sendJSON(res, 400, { error: `Invalid weight for ${id}: "${rawWeight}" (must be 0.1-1.0)` });
            }
            weight = Math.max(0.1, Math.min(1.0, parsed));
          }

          expertises.push({ ...expert, weight });
        }

        // Call pure merge function
        const result = mergeExpertisePrompt(expertises, null, null, { registry: expertiseRegistry });

        sendJSON(res, 200, {
          activeExpertises: result.metadata.expertiseIds,
          weights: result.metadata.weights,
          tone: result.metadata.tone,
          temperature: result.metadata.temperature,
          temperatureMethod: result.metadata.temperatureMethod,
          tokenCount: result.metadata.tokenCount,
          compatibility: result.metadata.compatibility,
          requiresConfirmation: result.metadata.requiresConfirmation,
          promptPreview: result.prompt.substring(0, 500) + (result.prompt.length > 500 ? '...' : ''),
          enforcement: {
            forbiddenPhrasesCount: result.enforcement.forbiddenPhrases.length,
            minResponseLength: result.enforcement.minResponseLength,
            disclaimers: result.enforcement.disclaimers,
          },
        });

      } catch (err) {
        if (err.name === 'CompatibilityBlockError') {
          return sendJSON(res, 409, {
            error: 'Incompatible expertise combination',
            severity: err.compatibility?.severity || 'hard_block',
            conflicts: err.compatibility?.conflicts || [],
          });
        }
        sendJSON(res, 500, safeError(err));
      }
    },

    // v63.0 — Expertise Schema endpoint
    'GET /api/expertise-schema': async (req, res) => {
      try {
        const { MODULE_SECTIONS, MERGE_LIMITS, CompatibilitySeverity } = await import('../expertises/merge-types.js');

        sendJSON(res, 200, {
          moduleSections: MODULE_SECTIONS,
          limits: {
            maxActiveExpertises: MERGE_LIMITS.MAX_ACTIVE_EXPERTISES,
            maxDomainRules: MERGE_LIMITS.MAX_DOMAIN_RULES,
            maxEmphasis: MERGE_LIMITS.MAX_EMPHASIS,
            maxConstraints: MERGE_LIMITS.MAX_CONSTRAINTS,
            maxVocabulary: MERGE_LIMITS.MAX_VOCABULARY,
            maxAntipatterns: MERGE_LIMITS.MAX_ANTIPATTERNS,
            maxDisclaimers: MERGE_LIMITS.MAX_DISCLAIMERS,
            maxTotalTokens: MERGE_LIMITS.MAX_TOTAL_TOKENS,
            effectiveTokenBudget: MERGE_LIMITS.EFFECTIVE_TOKEN_BUDGET,
            maxUserContextTokens: MERGE_LIMITS.MAX_USER_CONTEXT_TOKENS,
            minWeight: MERGE_LIMITS.MIN_WEIGHT,
            maxWeight: MERGE_LIMITS.MAX_WEIGHT,
          },
          capabilityDimensions: ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'],
          inheritanceModes: ['extend', 'replace'],
          toneOptions: ['professional', 'casual', 'academic', 'empathetic', 'assertive', 'neutral'],
          severityLevels: Object.values(CompatibilitySeverity),
        });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // v63.0 — POST Merge Preview (inline config, for wizard — no registry lookup)
    'POST /api/merge-preview': async (req, res) => {
      try {
        const clientIp = req.socket.remoteAddress || 'unknown';
        if (!checkWizardRateLimit(clientIp + ':preview', 500)) {
          return sendJSON(res, 429, { error: 'Too many requests. Max 2 previews/second.' });
        }

        const body = await parseBody(req);
        if (!body.expertises || !Array.isArray(body.expertises) || body.expertises.length === 0) {
          return sendJSON(res, 400, { error: 'Missing "expertises" array (1-3 inline configs)' });
        }
        if (body.expertises.length > 3) {
          return sendJSON(res, 400, { error: 'Max 3 expertises allowed' });
        }

        const { mergeExpertisePrompt } = await import('../expertises/merge-engine.js');

        // Build expertise objects with temp IDs
        const expertises = body.expertises.map((cfg, idx) => ({
          id: cfg.id || `__wizard_${randomUUID()}_${idx}`,
          name: cfg.name || `Wizard Expert ${idx + 1}`,
          modules: cfg.modules || null,
          capabilities: cfg.capabilities || null,
          systemPrompt: cfg.systemPrompt || '',
          temperature: cfg.temperature ?? 0.5,
          tone: cfg.tone || 'professional',
          styleRules: cfg.styleRules || {},
          weight: Math.max(0.1, Math.min(1.0, parseFloat(cfg.weight) || 0.5)),
        }));

        const result = mergeExpertisePrompt(expertises);

        sendJSON(res, 200, {
          activeExpertises: result.metadata.expertiseIds,
          weights: result.metadata.weights,
          tone: result.metadata.tone,
          temperature: result.metadata.temperature,
          temperatureMethod: result.metadata.temperatureMethod,
          tokenCount: result.metadata.tokenCount,
          compatibility: result.metadata.compatibility,
          requiresConfirmation: result.metadata.requiresConfirmation,
          promptPreview: result.prompt.substring(0, 500) + (result.prompt.length > 500 ? '...' : ''),
          enforcement: {
            forbiddenPhrasesCount: result.enforcement.forbiddenPhrases.length,
            minResponseLength: result.enforcement.minResponseLength,
            disclaimers: result.enforcement.disclaimers,
          },
        });
      } catch (err) {
        if (err.name === 'CompatibilityBlockError') {
          return sendJSON(res, 409, {
            error: 'Incompatible expertise combination',
            severity: err.compatibility?.severity || 'hard_block',
            conflicts: err.compatibility?.conflicts || [],
          });
        }
        sendJSON(res, 500, safeError(err));
      }
    },

    // v63.0 — Wizard Test Prompt (LLM call with inline config)
    'POST /api/expertise-wizard/test-prompt': async (req, res) => {
      try {
        const clientIp = req.socket.remoteAddress || 'unknown';
        if (!checkWizardRateLimit(clientIp + ':test', 5000)) {
          return sendJSON(res, 429, { error: 'Too many requests. Max 1 test/5 seconds.', retryAfter: 5 });
        }

        const body = await parseBody(req);
        if (!body.expertiseConfig) {
          return sendJSON(res, 400, { error: 'Missing "expertiseConfig" object' });
        }
        if (!body.question || typeof body.question !== 'string') {
          return sendJSON(res, 400, { error: 'Missing "question" string' });
        }

        // Validate config
        const { validateExpertiseConfig } = await import('../expertises/expertise-store.js');
        const validation = validateExpertiseConfig(body.expertiseConfig);
        if (!validation.valid) {
          return sendJSON(res, 400, { error: 'Invalid config', details: validation.errors });
        }

        // Build single-expertise merge for system prompt
        const { mergeExpertisePrompt } = await import('../expertises/merge-engine.js');
        const cfg = body.expertiseConfig;
        const expertise = {
          id: `__wizard_${randomUUID()}`,
          name: cfg.name || 'Test Expert',
          modules: cfg.modules || null,
          capabilities: cfg.capabilities || null,
          systemPrompt: cfg.systemPrompt || '',
          temperature: cfg.temperature ?? 0.5,
          tone: cfg.tone || 'professional',
          styleRules: cfg.styleRules || {},
          weight: 1.0,
        };

        const mergeResult = mergeExpertisePrompt([expertise]);

        // Call LLM
        const startTime = Date.now();
        const token = createAuthToken({ role: LLMCallerRole.CHAT });
        const llmResult = await callWithAuth(token, body.question, {
          systemPrompt: mergeResult.prompt,
          temperature: mergeResult.metadata.temperature,
        });
        const duration = Date.now() - startTime;

        sendJSON(res, 200, {
          response: llmResult.content || llmResult.response || '',
          model: llmResult.model || 'unknown',
          duration,
          tokenCount: mergeResult.metadata.tokenCount,
          compatibility: mergeResult.metadata.compatibility,
        });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Expertise UI page
    'GET /expertises': async (req, res) => {
      try {
        // Try multiple possible locations (relative to server.js and cwd)
        const possiblePaths = [
          path.join(srcDir, 'expertises/expertises.html'),             // Primary: src/experts/
          path.join(srcDir, '..', 'src/expertises/expertises.html'),   // From parent
          path.join(process.cwd(), 'src/expertises/expertises.html'),     // CWD fallback
          path.join(process.cwd(), 'expertises/expertises.html'),
          path.join(process.cwd(), 'expertises.html')                  // Last resort
        ];

        let html = null;
        for (const p of possiblePaths) {
          try {
            html = fs.readFileSync(p, 'utf8');
            break;
          } catch (err) {
            // Expected: trying multiple paths
            logger.debug('Server', `expertises.html not at ${p}: ${err.code}`);
          }
        }

        if (!html) {
          throw new Error('expertises.html not found in: ' + possiblePaths.join(', '));
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end('Error loading experts page: ' + err.message);
      }
    },

    // Expertise CRUD
    'GET /api/expertises': async (req, res) => {
      try {
        if (!expertiseLayer) {
          return sendJSON(res, 500, { error: 'Expertise layer not loaded' });
        }

        const experts = expertiseLayer.expertiseRegistry.getAll().map(e => e.toJSON());
        const categories = expertiseLayer.getExpertiseCategories();

        // Add custom experts to custom category
        const customExperts = experts.filter(e => e.isCustom).map(e => e.id);
        const customCat = categories.find(c => c.id === 'custom');
        if (customCat) {
          customCat.experts = customExperts;
        }

        sendJSON(res, 200, { experts, categories });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/expertises/:id': async (req, res, params) => {
      try {
        if (!expertiseLayer) {
          return sendJSON(res, 500, { error: 'Expertise layer not loaded' });
        }

        const expert = expertiseLayer.expertiseRegistry.get(params.id);
        if (!expert) {
          return sendJSON(res, 404, { error: 'Expertise not found' });
        }

        sendJSON(res, 200, expert.toJSON());
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/expertises': async (req, res) => {
      try {
        if (!expertiseLayer) {
          return sendJSON(res, 500, { error: 'Expertise layer not loaded' });
        }

        const body = await parseBody(req);

        // v57.0 - Validate config before saving
        const { validateExpertiseConfig } = await import('../expertises/expertise-store.js');
        const validation = validateExpertiseConfig(body);
        if (!validation.valid) {
          return sendJSON(res, 400, {
            error: 'Invalid expertise configuration',
            details: validation.errors
          });
        }

        // Generate ID from name
        const id = body.id || body.name.toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '')
          .substring(0, 32);

        // Check if exists
        if (expertiseLayer.expertiseRegistry.get(id)) {
          return sendJSON(res, 400, { error: 'Expertise with this ID already exists' });
        }

        const expert = expertiseLayer.expertiseRegistry.addCustom({
          id,
          ...body,
          primaryProblemTypes: body.primaryProblemTypes || ['procedural'],
          allowedRepresentations: body.allowedRepresentations || ['structured'],
          preferredModels: body.preferredModels || ['qwen2.5:32b']
        });

        // Save to database
        saveCustomExpertises();

        sendJSON(res, 201, expert.toJSON());
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'PUT /api/expertises/:id': async (req, res, params) => {
      try {
        if (!expertiseLayer) {
          return sendJSON(res, 500, { error: 'Expertise layer not loaded' });
        }

        const body = await parseBody(req);

        // v57.0 - Validate config before updating
        // Only validate fields that are being updated
        const { validateExpertiseConfig } = await import('../expertises/expertise-store.js');
        const configToValidate = { name: body.name || 'placeholder', ...body };
        const validation = validateExpertiseConfig(configToValidate);
        if (!validation.valid) {
          return sendJSON(res, 400, {
            error: 'Invalid expertise configuration',
            details: validation.errors
          });
        }

        const expert = expertiseLayer.expertiseRegistry.updateCustom(params.id, body);

        if (!expert) {
          return sendJSON(res, 404, { error: 'Custom expertise not found' });
        }

        // Save to database
        saveCustomExpertises();

        sendJSON(res, 200, expert.toJSON());
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'DELETE /api/expertises/:id': async (req, res, params) => {
      try {
        if (!expertiseLayer) {
          return sendJSON(res, 500, { error: 'Expertise layer not loaded' });
        }

        const deleted = expertiseLayer.expertiseRegistry.removeCustom(params.id);

        if (!deleted) {
          return sendJSON(res, 404, { error: 'Custom expertise not found' });
        }

        // Save to database
        saveCustomExpertises();

        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/expertises/route': async (req, res) => {
      try {
        if (!expertiseLayer) {
          return sendJSON(res, 500, { error: 'Expertise layer not loaded' });
        }

        const body = await parseBody(req);
        const result = expertiseLayer.routeToExpert(body.message, body.intent);

        sendJSON(res, 200, {
          expertId: result.expert?.id || null,
          expertName: result.expert?.name || null,
          confidence: result.confidence,
          reason: result.reason
        });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}


/**
 * Creates lifecycle routes (project lifecycle management).
 * @param {object} deps
 */
export function createLifecycleRoutes(deps) {
  const {
    parseBody, sendJSON, safeError, safeParseInt, sendStaticFile,
    logger, config, path, fs, randomUUID,
    expertiseLayer, expertiseStore, callWithAuth, createAuthToken, LLMCallerRole,
    checkWizardRateLimit, db,
  } = deps;

  return {
    'POST /api/lifecycle/start': async (req, res) => {
      const body = await parseBody(req);
      const { projectId, request, config: lcConfig } = body;

      if (!projectId || !request) {
        return sendJSON(res, 400, { error: 'projectId and request are required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { startSpec } = await import('../planner/lifecycle-spec.js');

        const lifecycle = ProjectLifecycle.create({ projectId, config: lcConfig || {} });
        const specResult = await startSpec(lifecycle, request, {});

        sendJSON(res, 200, {
          lifecycleId: lifecycle.id,
          phase: lifecycle.phase,
          ...specResult,
        });
      } catch (err) {
        logger.error('Server', `Lifecycle start error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/spec/answer': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId, answers } = body;

      if (!lifecycleId || !answers) {
        return sendJSON(res, 400, { error: 'lifecycleId and answers are required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { answerSpecQuestions } = await import('../planner/lifecycle-spec.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await answerSpecQuestions(lifecycle, answers);
        sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle spec/answer error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/spec/approve': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId } = body;

      if (!lifecycleId) {
        return sendJSON(res, 400, { error: 'lifecycleId is required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { approveSpec } = await import('../planner/lifecycle-spec.js');
        const { generateRoadmap } = await import('../planner/lifecycle-planning.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        await approveSpec(lifecycle);
        const roadmapResult = await generateRoadmap(lifecycle);

        sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase, ...roadmapResult });
      } catch (err) {
        logger.error('Server', `Lifecycle spec/approve error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/roadmap/approve': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId } = body;

      if (!lifecycleId) {
        return sendJSON(res, 400, { error: 'lifecycleId is required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { approveRoadmap } = await import('../planner/lifecycle-planning.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await approveRoadmap(lifecycle);
        sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle roadmap/approve error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/milestone/approve': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId, milestoneId } = body;

      if (!lifecycleId || !milestoneId) {
        return sendJSON(res, 400, { error: 'lifecycleId and milestoneId are required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { approveMilestonePlan } = await import('../planner/lifecycle-build.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await approveMilestonePlan(lifecycle, milestoneId);
        sendJSON(res, 200, { lifecycleId, milestoneId, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle milestone/approve error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/milestone/next': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId } = body;

      if (!lifecycleId) {
        return sendJSON(res, 400, { error: 'lifecycleId is required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { startNextMilestone } = await import('../planner/lifecycle-build.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await startNextMilestone(lifecycle);
        sendJSON(res, 200, { lifecycleId, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle milestone/next error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/milestone/blocked': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId, milestoneId, decision, feedback } = body;

      if (!lifecycleId || !milestoneId || !decision) {
        return sendJSON(res, 400, { error: 'lifecycleId, milestoneId and decision are required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { handleMilestoneBlocked } = await import('../planner/lifecycle-build.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await handleMilestoneBlocked(lifecycle, milestoneId, decision, feedback);
        sendJSON(res, 200, { lifecycleId, milestoneId, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle milestone/blocked error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/review/acknowledge': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId, action } = body;

      if (!lifecycleId) {
        return sendJSON(res, 400, { error: 'lifecycleId is required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const lifecycle = ProjectLifecycle.resume(lifecycleId);

        // Action: 'continue' -> back to BUILD, 'change' -> CHANGE_MANAGEMENT
        if (action === 'change') {
          await lifecycle.transitionTo('CHANGE_MANAGEMENT');
        } else {
          await lifecycle.transitionTo('BUILD');
        }

        sendJSON(res, 200, { lifecycleId, phase: lifecycle.phase });
      } catch (err) {
        logger.error('Server', `Lifecycle review/acknowledge error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/change/propose': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId, description } = body;

      if (!lifecycleId || !description) {
        return sendJSON(res, 400, { error: 'lifecycleId and description are required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { proposeChange } = await import('../planner/lifecycle-change.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await proposeChange(lifecycle, description);
        sendJSON(res, 200, { lifecycleId, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle change/propose error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/change/approve': async (req, res) => {
      const body = await parseBody(req);
      const { lifecycleId, changeRequestId } = body;

      if (!lifecycleId || !changeRequestId) {
        return sendJSON(res, 400, { error: 'lifecycleId and changeRequestId are required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { applyChange } = await import('../planner/lifecycle-change.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const result = await applyChange(lifecycle, changeRequestId);
        sendJSON(res, 200, { lifecycleId, ...result });
      } catch (err) {
        logger.error('Server', `Lifecycle change/approve error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/lifecycle/change/reject': async (req, res) => {
      const body = await parseBody(req);
      const { changeRequestId } = body;

      if (!changeRequestId) {
        return sendJSON(res, 400, { error: 'changeRequestId is required' });
      }

      try {
        const { rejectChange } = await import('../planner/lifecycle-change.js');
        const result = rejectChange(changeRequestId);
        sendJSON(res, 200, result);
      } catch (err) {
        logger.error('Server', `Lifecycle change/reject error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/lifecycle/status': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const lifecycleId = url.searchParams.get('id');

      if (!lifecycleId) {
        return sendJSON(res, 400, { error: 'id query param is required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { computeLifecycleProgress } = await import('../planner/lifecycle-progress.js');
        const { getDriftHistory, getAggregateHealth } = await import('../planner/lifecycle-review.js');
        const { listChangeRequests } = await import('../planner/lifecycle-change.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const progress = computeLifecycleProgress(lifecycleId);
        const driftHistory = getDriftHistory(lifecycleId);
        const aggregateHealth = getAggregateHealth(lifecycleId);
        const changeRequests = listChangeRequests(lifecycleId);

        sendJSON(res, 200, {
          lifecycleId,
          phase: lifecycle.phase,
          progress,
          driftHistory,
          aggregateHealth,
          changeRequests,
        });
      } catch (err) {
        logger.error('Server', `Lifecycle status error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/lifecycle/resume': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const lifecycleId = url.searchParams.get('id');

      if (!lifecycleId) {
        return sendJSON(res, 400, { error: 'id query param is required' });
      }

      try {
        const { ProjectLifecycle } = await import('../planner/lifecycle.js');
        const { computeLifecycleProgress } = await import('../planner/lifecycle-progress.js');

        const lifecycle = ProjectLifecycle.resume(lifecycleId);
        const progress = computeLifecycleProgress(lifecycleId);

        sendJSON(res, 200, {
          lifecycleId,
          phase: lifecycle.phase,
          config: lifecycle.config,
          progress,
        });
      } catch (err) {
        logger.error('Server', `Lifecycle resume error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
