// v130: Media generation routes (ComfyUI multimedia module)
// ══════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { broadcast } from '../ws-bridge/ws-server.js';
import { sanitizePrompt, validateParams, getTemplate, substituteParams, validateWorkflow, getDefaultParams } from '../media/workflow-templates.js';

// ── Status transition helper ──────────────────────────────────────────────────

function setStatus(db, id, status, error = null) {
  db.prepare(`
    UPDATE media_generations
    SET status = ?,
        error = ?,
        completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN datetime('now') ELSE completed_at END,
        duration_ms = CASE WHEN ? IN ('completed','failed','cancelled')
          THEN CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER)
          ELSE duration_ms END
    WHERE id = ?
  `).run(status, error, status, status, id);
}

// ── Crash recovery ────────────────────────────────────────────────────────────

export function recoverStuckGenerations(db, logger) {
  try {
    const stuck = db.prepare(`
      SELECT id FROM media_generations WHERE status IN ('running','pending')
    `).all();

    for (const row of stuck) {
      db.prepare(`
        UPDATE media_generations
        SET status = 'failed',
            error = 'Server restart during generation',
            completed_at = datetime('now')
        WHERE id = ?
      `).run(row.id);
    }

    if (stuck.length > 0) {
      logger.warn('Media', `Recovered ${stuck.length} stuck generations`);
    }
  } catch (err) {
    logger.error('Media', `Recovery failed: ${err.message}`);
  }
}

// ── Route factory ─────────────────────────────────────────────────────────────

export function createMediaRoutes({ db, parseBody, sendJSON, safeError, logger, comfyuiConnector, vramManager, mediaStorage }) {
  // Prepared statements
  const stmts = {
    insert: db.db.prepare(`
      INSERT INTO media_generations (id, type, prompt, negative_prompt, params, workflow_template, status, comfyui_prompt_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)
    `),
    findById: db.db.prepare(`SELECT * FROM media_generations WHERE id = ?`),
    findDedup: db.db.prepare(`
      SELECT id FROM media_generations
      WHERE status IN ('pending','running') AND prompt = ? AND params = ?
      LIMIT 1
    `),
    history: db.db.prepare(`
      SELECT id, type, prompt, status, created_at, completed_at, duration_ms, favorite,
             outputs, error
      FROM media_generations
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `),
    historyByType: db.db.prepare(`
      SELECT id, type, prompt, status, created_at, completed_at, duration_ms, favorite,
             outputs, error
      FROM media_generations
      WHERE type = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `),
    historyFavorites: db.db.prepare(`
      SELECT id, type, prompt, status, created_at, completed_at, duration_ms, favorite,
             outputs, error
      FROM media_generations
      WHERE favorite = 1
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `),
    setFavorite: db.db.prepare(`UPDATE media_generations SET favorite = ? WHERE id = ?`),
    setOutputs: db.db.prepare(`UPDATE media_generations SET outputs = ? WHERE id = ?`),
    setPromptId: db.db.prepare(`UPDATE media_generations SET comfyui_prompt_id = ? WHERE id = ?`),
    deleteById: db.db.prepare(`DELETE FROM media_generations WHERE id = ?`),
    search: db.db.prepare(`
      SELECT id, type, prompt, status, created_at, favorite, outputs
      FROM media_generations
      WHERE prompt LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
  };

  // Model discovery instance
  let modelDiscovery = null;
  const getModelDiscovery = async () => {
    if (!modelDiscovery) {
      const { MediaModelDiscovery } = await import('../media/model-discovery.js');
      modelDiscovery = new MediaModelDiscovery(comfyuiConnector);
    }
    return modelDiscovery;
  };

  return {
    // ── Health check ────────────────────────────────────────────────────────

    'GET /api/media/health': async (req, res) => {
      try {
        const status = await comfyuiConnector.isAvailable();
        sendJSON(res, 200, status);
      } catch (err) {
        sendJSON(res, 502, { available: false, error: err.message });
      }
    },

    // ── Generate ────────────────────────────────────────────────────────────

    'POST /api/media/generate': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { type, prompt, negative_prompt, params: userParams, model: bodyModel } = body;

        // Validate required fields
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
          return sendJSON(res, 400, { error: 'prompt is required' });
        }
        if (!type || !['txt2img', 'img2img', 'txt2vid'].includes(type)) {
          return sendJSON(res, 400, { error: 'type must be txt2img, img2img, or txt2vid' });
        }

        // Check ComfyUI availability
        const health = await comfyuiConnector.isAvailable();
        if (!health.available) {
          return sendJSON(res, 502, { error: 'ComfyUI is not available', url: comfyuiConnector._baseUrl });
        }

        // Sanitize prompt
        const cleanPrompt = sanitizePrompt(prompt);
        const cleanNeg = negative_prompt ? sanitizePrompt(negative_prompt) : '';

        // Merge params with defaults
        const defaults = getDefaultParams(type);
        const mergedParams = { ...defaults, ...userParams };

        // Model from top-level body field takes priority
        if (bodyModel) mergedParams.model = bodyModel;

        // Validate params
        const validation = validateParams(type, mergedParams);
        if (!validation.valid) {
          return sendJSON(res, 400, { error: 'Invalid parameters', details: validation.errors });
        }

        const paramsJson = JSON.stringify(mergedParams);

        // Dedup check
        const existing = stmts.findDedup.get(cleanPrompt, paramsJson);
        if (existing) {
          return sendJSON(res, 200, { ok: true, generationId: existing.id, dedup: true });
        }

        // Create generation record
        const generationId = `gen-${Date.now()}-${randomUUID().slice(0, 8)}`;
        stmts.insert.run(generationId, type, cleanPrompt, cleanNeg, paramsJson, type);

        // Ack immediately
        sendJSON(res, 200, { ok: true, generationId });

        // Async: GPU-locked generation pipeline
        vramManager.acquire(async () => {
          try {
            setStatus(db.db, generationId, 'running');
            broadcast('control', { action: 'comfyui_progress', generationId, status: 'preparing', percent: 0, text: 'Uvolňuji GPU...' });

            // Unload Ollama + wait for VRAM
            await vramManager.unloadOllama();
            await new Promise(r => setTimeout(r, 3000));

            // Build workflow from template
            const template = getTemplate(type);
            const workflow = substituteParams(template, {
              prompt: cleanPrompt,
              negative_prompt: cleanNeg,
              ...mergedParams,
            });
            validateWorkflow(workflow);

            // Connect WS for progress
            comfyuiConnector.connectWS((progress) => {
              broadcast('control', {
                action: 'comfyui_progress',
                generationId,
                status: 'generating',
                ...progress,
                text: `Krok ${progress.step}/${progress.totalSteps}`,
              });
            });

            // Submit and wait
            broadcast('control', { action: 'comfyui_progress', generationId, status: 'generating', percent: 0, text: 'Generuji...' });
            const { promptId } = await comfyuiConnector.submitWorkflow(workflow);
            stmts.setPromptId.run(promptId, generationId);

            const result = await comfyuiConnector.withTimeout(
              comfyuiConnector.waitForResult(promptId),
              comfyuiConnector._timeout
            );

            // Fetch and save outputs
            const savedPaths = [];
            for (const output of result.outputs) {
              try {
                const buf = await comfyuiConnector.fetchOutput(output.filename, output.subfolder, output.type);
                const savedPath = await mediaStorage.saveOutput(generationId, output.filename, buf, type);
                savedPaths.push(output.filename);
              } catch (err) {
                logger.warn('Media', `Failed to save output ${output.filename}: ${err.message}`);
              }
            }

            stmts.setOutputs.run(JSON.stringify(savedPaths), generationId);
            setStatus(db.db, generationId, 'completed');
            await mediaStorage.enforceQuota();

            broadcast('control', { action: 'comfyui_complete', generationId, outputs: savedPaths });
            logger.info('Media', `Generation ${generationId} completed (${savedPaths.length} outputs)`);
          } catch (err) {
            setStatus(db.db, generationId, 'failed', err.message);
            broadcast('control', { action: 'comfyui_error', generationId, error: err.message });
            logger.error('Media', `Generation ${generationId} failed: ${err.message}`);
          } finally {
            comfyuiConnector.disconnectWS();
            // v131: Free ComfyUI VRAM + wait for drop before Ollama reload
            try { await comfyuiConnector.freeVram(); } catch (_) {}
            await vramManager.waitForVramDrop(
              Math.round((vramManager._gpuTotalVramMb || 24576) * 0.15),
              { timeoutMs: 10_000 }
            );
            try { await vramManager.reloadOllama(); } catch (_) {}
          }
        }).catch(err => {
          // Queue-level error (shouldn't happen, but safety net)
          setStatus(db.db, generationId, 'failed', err.message);
          broadcast('control', { action: 'comfyui_error', generationId, error: err.message });
        });
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── Status ──────────────────────────────────────────────────────────────

    'GET /api/media/status': async (req, res, params) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const id = url.searchParams.get('id') || params?.id;
        if (!id) return sendJSON(res, 400, { error: 'id is required' });

        const gen = stmts.findById.get(id);
        if (!gen) return sendJSON(res, 404, { error: 'Generation not found' });

        sendJSON(res, 200, gen);
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── History ─────────────────────────────────────────────────────────────

    'GET /api/media/history': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const page = parseInt(url.searchParams.get('page') || '0');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
        const type = url.searchParams.get('type');
        const favorite = url.searchParams.get('favorite');
        const query = url.searchParams.get('q');
        const offset = page * limit;

        let rows;
        if (query) {
          rows = stmts.search.all(`%${query}%`, limit);
        } else if (favorite === '1') {
          rows = stmts.historyFavorites.all(limit, offset);
        } else if (type && ['txt2img', 'img2img', 'txt2vid'].includes(type)) {
          rows = stmts.historyByType.all(type, limit, offset);
        } else {
          rows = stmts.history.all(limit, offset);
        }

        sendJSON(res, 200, { generations: rows, page, limit });
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── Output file ─────────────────────────────────────────────────────────

    'GET /api/media/output': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const id = url.searchParams.get('id');
        const filename = url.searchParams.get('filename');

        if (!id || !filename) {
          return sendJSON(res, 400, { error: 'id and filename are required' });
        }

        // Security: reject path traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          return sendJSON(res, 400, { error: 'Invalid filename' });
        }

        const filePath = mediaStorage.getOutputPath(id, filename);
        if (!filePath) return sendJSON(res, 404, { error: 'File not found' });

        try {
          const data = await import('fs').then(fs => fs.promises.readFile(filePath));
          // Determine content type
          const ext = filename.split('.').pop()?.toLowerCase();
          const contentTypes = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4',
            webm: 'video/webm',
          };
          res.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(data);
        } catch {
          sendJSON(res, 404, { error: 'File not found on disk' });
        }
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── Models ──────────────────────────────────────────────────────────────

    'GET /api/media/models': async (req, res) => {
      try {
        const disc = await getModelDiscovery();
        const [checkpoints, loras, vaes] = await Promise.all([
          disc.getCheckpoints(),
          disc.getLoRAs(),
          disc.getVAEs(),
        ]);
        sendJSON(res, 200, { checkpoints, loras, vaes });
      } catch (err) {
        sendJSON(res, 502, { error: `Failed to query models: ${err.message}` });
      }
    },

    'POST /api/media/models/refresh': async (req, res) => {
      try {
        const disc = await getModelDiscovery();
        disc.invalidateCache();
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── Cancel ──────────────────────────────────────────────────────────────

    'POST /api/media/cancel': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const id = url.searchParams.get('id');
        if (!id) return sendJSON(res, 400, { error: 'id is required' });

        const gen = stmts.findById.get(id);
        if (!gen) return sendJSON(res, 404, { error: 'Generation not found' });

        if (gen.status === 'pending') {
          setStatus(db.db, id, 'cancelled');
          sendJSON(res, 200, { ok: true, message: 'Generation cancelled' });
        } else if (gen.status === 'running') {
          // ComfyUI can only remove from queue, not kill running jobs
          sendJSON(res, 200, { ok: true, message: 'Zrušení se projeví po dokončení aktuální úlohy' });
        } else {
          sendJSON(res, 400, { error: `Cannot cancel generation with status: ${gen.status}` });
        }
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── Favorite ────────────────────────────────────────────────────────────

    'PUT /api/media/favorite': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { id, favorite } = body;
        if (!id) return sendJSON(res, 400, { error: 'id is required' });

        const gen = stmts.findById.get(id);
        if (!gen) return sendJSON(res, 404, { error: 'Generation not found' });

        const fav = favorite ? 1 : 0;
        stmts.setFavorite.run(fav, id);
        sendJSON(res, 200, { ok: true, favorite: fav });
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── Delete ──────────────────────────────────────────────────────────────

    'DELETE /api/media': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const id = url.searchParams.get('id');
        if (!id) return sendJSON(res, 400, { error: 'id is required' });

        const gen = stmts.findById.get(id);
        if (!gen) return sendJSON(res, 404, { error: 'Generation not found' });

        await mediaStorage.deleteGeneration(id);
        stmts.deleteById.run(id);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },

    // ── VRAM state ──────────────────────────────────────────────────────────

    'GET /api/media/vram': async (req, res) => {
      try {
        sendJSON(res, 200, vramManager.getState());
      } catch (err) {
        sendJSON(res, 500, { error: safeError(err) });
      }
    },
  };
}
