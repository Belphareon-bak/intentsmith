// System Routes — GPU detection, model info, system diagnostics
// ══════════════════════════════════════════════════════════════════════════════

import { getSystemProfile } from '../system/gpu-detector.js';
import { recommend, checkCompatibility, getModelTiers, getVRAMRecommendations } from '../system/model-compatibility.js';
import { logger } from '../core/logger.js';
import config from '../config.js';
import os from 'os';
import { getCurrentVersion } from '../packaging/auto-updater.js';

/**
 * @param {{ db: import('better-sqlite3').Database, sendJSON: Function }} deps
 */
export function createSystemRoutes({ db, sendJSON }) {
  const rawDb = db.db || db; // unwrap: db wrapper → raw better-sqlite3 instance

  return {
    // ── GPU & System Profile ──────────────────────────────────────────────
    'GET /api/system/gpu': (req, res) => {
      try {
        const profile = getSystemProfile();
        const primaryGPU = profile.gpus[0] || {};
        const recommendation = recommend(primaryGPU.vram_mb || 0, primaryGPU.is_igpu || false);

        sendJSON(res, 200, {
          profile,
          recommendation,
        });
      } catch (err) {
        logger.error('SystemRoutes', `GPU detection failed: ${err.message}`);
        sendJSON(res, 500, { error: 'GPU detection failed' });
      }
    },

    // Force refresh GPU detection
    'POST /api/system/gpu/refresh': (req, res) => {
      try {
        const profile = getSystemProfile(true);
        const primaryGPU = profile.gpus[0] || {};
        const recommendation = recommend(primaryGPU.vram_mb || 0, primaryGPU.is_igpu || false);

        sendJSON(res, 200, {
          profile,
          recommendation,
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'GPU refresh failed' });
      }
    },

    // ── Model Compatibility ───────────────────────────────────────────────
    'GET /api/system/models/compatibility': (req, res) => {
      try {
        const profile = getSystemProfile();
        const primaryGPU = profile.gpus[0] || {};
        const vramMb = primaryGPU.vram_mb || 0;
        const isIGPU = primaryGPU.is_igpu || false;

        const tiers = getModelTiers().map(tier => ({
          ...tier,
          compatible: tier.real_vram_mb <= (isIGPU ? vramMb * 0.6 : vramMb) || vramMb === 0,
          current: config.models.CHAT === tier.model,
        }));

        sendJSON(res, 200, {
          vram_mb: vramMb,
          is_igpu: isIGPU,
          tiers,
          recommendations: getVRAMRecommendations(),
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'Compatibility check failed' });
      }
    },

    // Check specific model compatibility
    'GET /api/system/models/check': (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const modelName = url.searchParams.get('model');

      if (!modelName) {
        return sendJSON(res, 400, { error: 'Missing ?model= parameter' });
      }

      try {
        const profile = getSystemProfile();
        const primaryGPU = profile.gpus[0] || {};
        const result = checkCompatibility(
          modelName,
          primaryGPU.vram_mb || 0,
          primaryGPU.is_igpu || false
        );

        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, { error: 'Check failed' });
      }
    },

    // ── Ollama Models (proxy) ─────────────────────────────────────────────
    'GET /api/system/models': async (req, res) => {
      try {
        const ollamaUrl = config.ollama.baseUrl;
        const resp = await fetch(`${ollamaUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!resp.ok) {
          return sendJSON(res, 502, { error: `Ollama returned ${resp.status}` });
        }

        const data = await resp.json();
        const models = (data.models || []).map(m => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
          digest: m.digest,
          details: m.details || {},
        }));

        sendJSON(res, 200, {
          models,
          ollama_url: ollamaUrl,
          current_model: config.models.CHAT,
        });
      } catch (err) {
        if (err.name === 'TimeoutError' || err.code === 'ECONNREFUSED') {
          return sendJSON(res, 502, {
            error: 'Ollama not reachable',
            ollama_url: config.ollama.baseUrl,
          });
        }
        sendJSON(res, 500, { error: `Failed to list models: ${err.message}` });
      }
    },

    // Model detail (proxy to Ollama show)
    'GET /api/system/models/info': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const modelName = url.searchParams.get('model');

      if (!modelName) {
        return sendJSON(res, 400, { error: 'Missing ?model= parameter' });
      }

      try {
        const ollamaUrl = config.ollama.baseUrl;
        const resp = await fetch(`${ollamaUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName }),
          signal: AbortSignal.timeout(5000),
        });

        if (!resp.ok) {
          return sendJSON(res, 502, { error: `Ollama returned ${resp.status}` });
        }

        const data = await resp.json();
        sendJSON(res, 200, {
          name: modelName,
          modelfile: data.modelfile,
          parameters: data.parameters,
          template: data.template,
          details: data.details || {},
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Failed to get model info: ${err.message}` });
      }
    },

    // ── System Info ───────────────────────────────────────────────────────
    'GET /api/system/info': (req, res) => {
      try {
        // DB size
        let dbSizeMb = 0;
        try {
          const pragma = rawDb.pragma('page_count');
          const pageSize = rawDb.pragma('page_size');
          if (pragma[0] && pageSize[0]) {
            dbSizeMb = Math.round((pragma[0].page_count * pageSize[0].page_size) / (1024 * 1024) * 100) / 100;
          }
        } catch (_) {}

        // Table counts
        let tableCounts = {};
        try {
          const tables = ['messages', 'sessions', 'memory', 'skill_executions', 'workflow_patterns'];
          for (const table of tables) {
            try {
              const row = rawDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
              tableCounts[table] = row?.cnt || 0;
            } catch (_) {}
          }
        } catch (_) {}

        // Migration count
        let migrationCount = 0;
        try {
          const row = rawDb.prepare('SELECT COUNT(*) as cnt FROM migrations').get();
          migrationCount = row?.cnt || 0;
        } catch (_) {}

        sendJSON(res, 200, {
          version: getCurrentVersion(),
          platform: os.platform(),
          arch: os.arch(),
          node_version: process.version,
          uptime_seconds: Math.round(process.uptime()),
          memory: {
            total_mb: Math.round(os.totalmem() / (1024 * 1024)),
            free_mb: Math.round(os.freemem() / (1024 * 1024)),
            process_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
          },
          db: {
            size_mb: dbSizeMb,
            migrations: migrationCount,
            tables: tableCounts,
          },
          config: {
            chat_model: config.models.CHAT,
            ollama_url: config.ollama.baseUrl,
            features: config.features,
          },
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'System info failed' });
      }
    },

    // ── Storage Info ──────────────────────────────────────────────────────
    'GET /api/system/storage': (req, res) => {
      try {
        let dbSizeMb = 0;
        try {
          const pragma = rawDb.pragma('page_count');
          const pageSize = rawDb.pragma('page_size');
          if (pragma[0] && pageSize[0]) {
            dbSizeMb = Math.round((pragma[0].page_count * pageSize[0].page_size) / (1024 * 1024) * 100) / 100;
          }
        } catch (_) {}

        let ltmCount = 0;
        try {
          const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM memory").get();
          ltmCount = row?.cnt || 0;
        } catch (_) {}

        let messageCount = 0;
        try {
          const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM messages").get();
          messageCount = row?.cnt || 0;
        } catch (_) {}

        let sessionCount = 0;
        try {
          const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM sessions").get();
          sessionCount = row?.cnt || 0;
        } catch (_) {}

        sendJSON(res, 200, {
          db_size_mb: dbSizeMb,
          ltm_entries: ltmCount,
          messages: messageCount,
          sessions: sessionCount,
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'Storage info failed' });
      }
    },

    // DB Vacuum
    'POST /api/system/vacuum': (req, res) => {
      try {
        rawDb.pragma('wal_checkpoint(TRUNCATE)');
        rawDb.exec('VACUUM');
        sendJSON(res, 200, { ok: true, message: 'Database vacuumed successfully' });
      } catch (err) {
        sendJSON(res, 500, { error: `Vacuum failed: ${err.message}` });
      }
    },
  };
}
