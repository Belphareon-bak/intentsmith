// System Routes — GPU detection, model info, system diagnostics, storage management
// ══════════════════════════════════════════════════════════════════════════════

import { getSystemProfile, computeSessionCapacity } from '../system/gpu-detector.js';
import { recommend, checkCompatibility, getModelTiers, getVRAMRecommendations } from '../system/model-compatibility.js';
import { logger } from '../core/logger.js';
import config from '../config.js';
import os from 'os';
import path from 'path';
import { getCurrentVersion } from '../packaging/auto-updater.js';
import { getStorageConfig, validateStorageConfig, autoClean } from '../db/data-retention.js';
import { drainMessages, getHistoryStats } from '../core/history-drain.js';
import { createStateBackup, listBackups, pruneBackups, getBackupStats } from '../core/db-backup.js';
import { upgradeManager, UpgradeManager } from '../upgrade/upgrade-manager.js';
import { broadcast } from '../ws-bridge/ws-server.js';
import { modelUniverseStore } from '../upgrade/model-universe-store.js';
import { parseModelName } from '../upgrade/model-profiles.js';
import { estimateModelPrior } from '../upgrade/model-similarity.js';

const FEATURE_UNIVERSE_ENABLED = (process.env.C3_MODEL_UNIVERSE_ENABLED || 'true') !== 'false';
const FEATURE_UNIVERSE_MIRROR = (process.env.C3_DISCOVERY_MIRROR_DISCOVERED_MODELS || 'true') !== 'false';
const SHOW_ATTEMPT_TIMEOUT_MS = parseInt(process.env.C3_MODEL_SHOW_ATTEMPT_TIMEOUT_MS || '2000', 10);
const SHOW_MAX_TOTAL_MS = parseInt(process.env.C3_MODEL_SHOW_MAX_TOTAL_MS || '5000', 10);
const SHOW_RETRY_DELAY_MS = parseInt(process.env.C3_MODEL_SHOW_RETRY_DELAY_MS || '250', 10);
const MAX_SHOW_ATTEMPTS = parseInt(process.env.C3_MODEL_SHOW_MAX_ATTEMPTS || '3', 10);
const CONTEXT_TOLERANCE = parseFloat(process.env.C3_MODEL_CONTEXT_TOLERANCE || '0.05');
const PARTIAL_MAX_AGE_MS = parseInt(process.env.C3_MODEL_PARTIAL_MAX_AGE_MS || String(60 * 60 * 1000), 10);
const RECOMPUTE_DELAY_MS = parseInt(process.env.C3_MODEL_RECOMPUTE_DELAY_MS || '15000', 10);
const RECOMPUTE_RETRY_MS = parseInt(process.env.C3_MODEL_RECOMPUTE_RETRY_MS || String(5 * 60 * 1000), 10);
const CRITICAL_FIELDS = ['model', 'parameters', 'context_length', 'quantization', 'modality'];

function _parseBoolFlag(v, fallback = false) {
  if (v == null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return fallback;
}

function _normalizeUniverseStateParam(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'stable' || s === 'validated' || s === 'valid') return 'STABLE';
  if (s === 'partial') return 'PARTIAL';
  if (s === 'unstable') return 'UNSTABLE';
  return null;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _parseParams(modelName, showData) {
  const fromShow = String(showData?.details?.parameter_size || '').toLowerCase();
  let m = fromShow.match(/(\d+(?:\.\d+)?)\s*b/);
  if (m) return parseFloat(m[1]);
  const fromName = String(modelName || '').toLowerCase();
  m = fromName.match(/[:\-](\d+(?:\.\d+)?)b/);
  if (m) return parseFloat(m[1]);
  return null;
}

function _parseContextLength(showData) {
  const mi = showData?.model_info || {};
  for (const [k, v] of Object.entries(mi)) {
    if (/context_length|num_ctx/i.test(k)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
  }
  const paramsText = String(showData?.parameters || '');
  const p = paramsText.match(/num_ctx\s+(\d+)/i);
  if (p) return parseInt(p[1], 10);
  return null;
}

function _parseQuantization(modelName, showData) {
  const q = String(showData?.details?.quantization_level || '').trim();
  if (q) return q.toUpperCase();
  const n = String(modelName || '');
  const m = n.match(/(q\d[_\w]*)/i);
  return m ? m[1].toUpperCase() : null;
}

function _parseModality(modelName, showData) {
  const families = Array.isArray(showData?.details?.families) ? showData.details.families.map(x => String(x).toLowerCase()) : [];
  const lowerName = String(modelName || '').toLowerCase();
  if (families.some(f => /llava|vision|clip|qwen2\.5vl|qwen2\.5-vl/.test(f))) return 'vision';
  if (/llava|vision|vl/.test(lowerName)) return 'vision';
  return 'text';
}

function _buildSnapshot(modelName, showData) {
  return {
    model: String(modelName || '').toLowerCase(),
    parameters: _parseParams(modelName, showData),
    context_length: _parseContextLength(showData),
    quantization: _parseQuantization(modelName, showData),
    modality: _parseModality(modelName, showData),
    raw: showData || {},
  };
}

function _hasCritical(snapshot) {
  return CRITICAL_FIELDS.every(k => snapshot?.[k] != null && snapshot[k] !== '');
}

function _contextStable(a, b) {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / max <= CONTEXT_TOLERANCE;
}

function _snapshotsStable(a, b) {
  if (!a || !b) return false;
  if (a.parameters !== b.parameters) return false;
  if (a.quantization !== b.quantization) return false;
  if (a.modality !== b.modality) return false;
  if (!_contextStable(a.context_length, b.context_length)) return false;
  return true;
}

async function _fetchShowSnapshot(ollamaBaseUrl, modelName) {
  const resp = await fetch(`${ollamaBaseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
    signal: AbortSignal.timeout(SHOW_ATTEMPT_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`show HTTP ${resp.status}`);
  const data = await resp.json();
  return _buildSnapshot(modelName, data);
}

async function fetchShowWithStability(ollamaBaseUrl, modelName) {
  const started = Date.now();
  const snapshots = [];
  const errors = [];

  for (let attempt = 1; attempt <= MAX_SHOW_ATTEMPTS; attempt++) {
    if (Date.now() - started > SHOW_MAX_TOTAL_MS) break;
    try {
      const snap = await _fetchShowSnapshot(ollamaBaseUrl, modelName);
      snapshots.push(snap);
      if (snapshots.length >= 2 && _snapshotsStable(snapshots[snapshots.length - 2], snapshots[snapshots.length - 1]) && _hasCritical(snap)) {
        break;
      }
    } catch (err) {
      errors.push(err.message);
    }
    if (attempt < MAX_SHOW_ATTEMPTS) await _sleep(SHOW_RETRY_DELAY_MS);
  }

  const latest = snapshots[snapshots.length - 1] || null;
  let metadataState = 'PARTIAL';
  let unstable = false;
  for (let i = 1; i < snapshots.length; i++) {
    if (!_snapshotsStable(snapshots[i - 1], snapshots[i])) {
      unstable = true;
      break;
    }
  }
  if (unstable) metadataState = 'UNSTABLE';
  else if (latest && _hasCritical(latest)) metadataState = 'STABLE';

  return {
    snapshot: latest,
    metadataState,
    attempts: snapshots.length + errors.length,
    errors,
    unstable,
    elapsedMs: Date.now() - started,
  };
}

function _estimatedBenchmarks(params) {
  if (!params || params <= 0) return null;
  const base = Math.max(0.12, Math.min(0.86, 0.18 + Math.log2(params + 1) * 0.12));
  return {
    swebench: Math.min(0.95, base * 0.95),
    livecodebench: Math.min(0.95, base * 1.0),
    humaneval: Math.min(0.95, base * 1.02),
    mmlu: Math.min(0.95, base * 1.05),
    arena: Math.min(0.95, base * 0.92),
    reasoning: Math.min(0.95, base * 0.98),
  };
}

function _buildEstimatedEntry(modelName, snapshot, metadataState, prior = null) {
  const parsed = parseModelName(snapshot?.model || modelName);
  const params = snapshot?.parameters ?? parsed?.params ?? null;
  const modality = snapshot?.modality || 'text';
  const category = prior?.category || (modality === 'vision' ? 'vision' : 'general');
  const benchmarks = prior?.benchmarks || _estimatedBenchmarks(params);
  const defaultConfidence = metadataState === 'STABLE' ? 0.45 : (metadataState === 'UNSTABLE' ? 0.20 : 0.25);
  const priorConfidence = Number.isFinite(prior?.benchmarkConfidence) ? prior.benchmarkConfidence : null;
  let benchmarkConfidence = priorConfidence != null ? priorConfidence : defaultConfidence;
  if (metadataState === 'UNSTABLE') benchmarkConfidence = Math.max(0.20, benchmarkConfidence * 0.85);
  if (metadataState === 'PARTIAL') benchmarkConfidence = Math.max(0.25, benchmarkConfidence * 0.92);

  const capabilities = Array.isArray(prior?.capabilities) && prior.capabilities.length > 0
    ? [...new Set(prior.capabilities)]
    : (modality === 'vision' ? ['vision'] : ['instruction-following']);

  return {
    name: modelName,
    family: parsed?.family || 'unknown',
    category,
    params,
    contextWindow: snapshot?.context_length ?? prior?.contextWindow ?? null,
    benchmarks,
    benchmarkConfidence,
    benchmarkSource: prior?.strategy || 'heuristic',
    provisional: true,
    source: prior ? 'universe_similarity' : 'universe',
    capabilities,
    architecture: prior?.architecture || null,
    baseVramMb: params ? Math.round(620 * params + 420) : null,
    similarity: prior ? {
      strategy: prior.strategy,
      score: prior.similarityScore,
      neighbors: prior.neighbors,
    } : null,
  };
}

/**
 * @param {{ db: import('better-sqlite3').Database, sendJSON: Function, parseBody: Function }} deps
 */
export function createSystemRoutes({ db, sendJSON, parseBody, modelRegistry }) {
  const rawDb = db.db || db; // unwrap: db wrapper → raw better-sqlite3 instance
  const dataDir = config.db?.path ? path.dirname(path.resolve(config.db.path)) : path.resolve('./data');
  const recomputeQueue = new Map(); // model_name -> { queuedAt, attempts, timer }

  const enqueueUniverseRecompute = (modelName, reason = 'PARTIAL') => {
    const normalizedModel = String(modelName || '').trim().toLowerCase();
    if (!normalizedModel || recomputeQueue.has(normalizedModel)) return false;

    const task = { queuedAt: Date.now(), attempts: 0, reason, timer: null };
    recomputeQueue.set(normalizedModel, task);

    const runTask = async () => {
      const current = recomputeQueue.get(normalizedModel);
      if (!current) return;
      current.attempts++;

      try {
        const showResult = await fetchShowWithStability(config.ollama.baseUrl, normalizedModel);
        if (FEATURE_UNIVERSE_ENABLED && showResult.snapshot) {
          const snapshot = showResult.snapshot;
          const entry = {
            modelName: normalizedModel,
            tag: normalizedModel.includes(':') ? normalizedModel.split(':')[1] : '',
            source: 'local',
            metadataState: showResult.metadataState,
            parameters: snapshot.parameters,
            contextLength: snapshot.context_length,
            quantization: snapshot.quantization,
            modality: snapshot.modality,
            metadata: {
              show: snapshot.raw,
              showAttempts: showResult.attempts,
              showErrors: showResult.errors,
              queuedReason: reason,
            },
            lastVerifiedAt: new Date().toISOString(),
          };
          modelUniverseStore.persistRawWithFallback(entry, {
            mirrorEnabled: FEATURE_UNIVERSE_MIRROR,
            scheduleRecompute: false,
          });
          try {
            modelUniverseStore.reconcileAndRecompute(normalizedModel, entry.tag, { reasonCode: 'metadata_refresh' });
          } catch (reconcileErr) {
            logger.warn('ModelUniverse', `Reconcile after metadata refresh failed for ${normalizedModel}: ${reconcileErr.message}`);
          }
        }

        const age = Date.now() - current.queuedAt;
        if (showResult.metadataState === 'STABLE' || age >= PARTIAL_MAX_AGE_MS) {
          recomputeQueue.delete(normalizedModel);
          logger.info('ModelUniverse', `Recompute done for ${normalizedModel} (state=${showResult.metadataState}, attempts=${current.attempts})`);
          return;
        }
      } catch (err) {
        const age = Date.now() - current.queuedAt;
        if (age >= PARTIAL_MAX_AGE_MS) {
          recomputeQueue.delete(normalizedModel);
          logger.warn('ModelUniverse', `Recompute forced-stop for ${normalizedModel} after max age: ${err.message}`);
          return;
        }
      }

      const next = recomputeQueue.get(normalizedModel);
      if (!next) return;
      next.timer = setTimeout(runTask, RECOMPUTE_RETRY_MS);
      next.timer.unref?.();
    };

    task.timer = setTimeout(runTask, RECOMPUTE_DELAY_MS);
    task.timer.unref?.();
    return true;
  };

  return {
    // ── GPU & System Profile ──────────────────────────────────────────────
    'GET /api/system/gpu': (req, res) => {
      try {
        const profile = getSystemProfile();
        const primaryGPU = profile.gpus[0] || {};
        const recommendation = recommend(primaryGPU.vram_mb || 0, primaryGPU.is_igpu || false);
        const capacity = computeSessionCapacity(profile);

        sendJSON(res, 200, {
          profile,
          recommendation,
          sessionCapacity: capacity,
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

    // Model universe list (paged, sortable, filterable)
    'GET /api/system/models/universe': (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
        const offset = Number.parseInt(url.searchParams.get('offset') || '0', 10);
        const state = _normalizeUniverseStateParam(url.searchParams.get('state'));
        const sort = String(url.searchParams.get('sort') || 'score').trim().toLowerCase();
        const order = String(url.searchParams.get('order') || 'desc').trim().toLowerCase();
        const runtimeState = String(url.searchParams.get('runtime_state') || '').trim().toLowerCase() || null;

        const listed = modelUniverseStore.listUniverse({
          limit,
          offset,
          state,
          sort,
          order,
          runtimeState,
        });

        if (!listed.ok && !listed.disabled) {
          return sendJSON(res, 500, {
            error: 'Universe list failed',
            reason: listed.reason || 'unknown',
          });
        }

        sendJSON(res, 200, {
          models: listed.models || [],
          total: listed.total || 0,
          limit: listed.limit || Math.max(1, Math.min(200, limit || 50)),
          offset: listed.offset || Math.max(0, offset || 0),
          snapshot_id: listed.snapshotId || null,
          sort: { by: listed.sortBy || sort || 'score', order: listed.order || (order === 'asc' ? 'asc' : 'desc') },
          filters: {
            state: listed.state || state || null,
            runtime_state: listed.runtimeState || runtimeState || null,
          },
          unavailable: listed.disabled ? (listed.reason || 'feature_disabled') : null,
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Failed to list model universe: ${err.message}` });
      }
    },

    // Model universe detail (lazy detail fetch for one model)
    'GET /api/system/models/universe/:name': (req, res, params) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const modelName = params?.name || '';
        const tag = String(url.searchParams.get('tag') || '').trim();
        const includeSignals = _parseBoolFlag(url.searchParams.get('include_signals'), false);
        const signalLimit = Number.parseInt(url.searchParams.get('signal_limit') || '20', 10);
        const sourceLimit = Number.parseInt(url.searchParams.get('source_limit') || '30', 10);

        const detail = modelUniverseStore.getUniverseModelDetails(modelName, {
          tag,
          includeSignals,
          signalLimit,
          sourceLimit,
        });

        if (!detail.ok && !detail.disabled) {
          return sendJSON(res, 500, {
            error: 'Universe detail failed',
            reason: detail.reason || 'unknown',
          });
        }
        if (!detail.model) {
          return sendJSON(res, 404, {
            error: 'Model not found in universe',
            model: modelName,
          });
        }

        sendJSON(res, 200, {
          model: detail.model,
          sources: detail.sources || [],
          signals: detail.signals || [],
          snapshot_id: detail.snapshotId || null,
          unavailable: detail.disabled ? (detail.reason || 'feature_disabled') : null,
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Failed to load model universe detail: ${err.message}` });
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
            provider: config.providers?.active || 'ollama',
          },
          sessions: {
            maxConcurrentLLM: config.sessions?.maxConcurrentLLM || 1,
            gpuAutoScale: config.sessions?.gpuAutoScale || false,
          },
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'System info failed' });
      }
    },

    // ── Storage Info (enhanced with history + backup stats) ───────────────
    'GET /api/system/storage': (req, res) => {
      try {
        let dbSizeMb = 0;
        try {
          const pageCount = rawDb.pragma('page_count', { simple: true });
          const pageSize = rawDb.pragma('page_size', { simple: true });
          dbSizeMb = Math.round((pageCount * pageSize) / (1024 * 1024) * 100) / 100;
        } catch (_) {}

        let messageCount = 0;
        try {
          const row = rawDb.prepare("SELECT COUNT(*) as cnt FROM messages").get();
          messageCount = row?.cnt || 0;
        } catch (_) {}

        const history = getHistoryStats(dataDir);
        const backups = getBackupStats(dataDir);

        sendJSON(res, 200, {
          db_size_mb: dbSizeMb,
          messages_in_db: messageCount,
          history: {
            total_mb: Math.round(history.totalBytes / (1024 * 1024) * 100) / 100,
            conversations: history.conversations,
            lifecycle: history.lifecycle,
            memory: history.memory,
          },
          backups,
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'Storage info failed' });
      }
    },

    // ── Storage Settings ─────────────────────────────────────────────────
    'GET /api/system/storage/settings': (req, res) => {
      try {
        const storageConfig = getStorageConfig(rawDb);
        sendJSON(res, 200, storageConfig);
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to read storage settings' });
      }
    },

    'PUT /api/system/storage/settings': async (req, res) => {
      try {
        const body = await parseBody(req);
        const validated = validateStorageConfig(body);

        // Read current user_settings, merge storage section
        let currentSettings = {};
        try {
          const row = rawDb.prepare('SELECT data FROM user_settings WHERE id = 1').get();
          if (row) currentSettings = JSON.parse(row.data);
        } catch (_) {}

        currentSettings.storage = validated;

        rawDb.prepare(
          'INSERT OR REPLACE INTO user_settings (id, data, updated_at) VALUES (1, ?, datetime(\'now\'))'
        ).run(JSON.stringify(currentSettings));

        sendJSON(res, 200, validated);
      } catch (err) {
        sendJSON(res, 500, { error: `Failed to update storage settings: ${err.message}` });
      }
    },

    // ── Manual Drain ─────────────────────────────────────────────────────
    'POST /api/system/drain': (req, res) => {
      try {
        const storageConfig = getStorageConfig(rawDb);
        const result = drainMessages(rawDb, dataDir, {
          cutoffHours: storageConfig.drain.cutoff_hours,
        });
        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, { error: `Drain failed: ${err.message}` });
      }
    },

    // ── Manual Clean ─────────────────────────────────────────────────────
    'POST /api/system/clean': (req, res) => {
      try {
        const storageConfig = getStorageConfig(rawDb);
        const result = autoClean(rawDb, dataDir, { config: storageConfig });
        sendJSON(res, 200, {
          db_rows_pruned: result.db?.totalDeleted || 0,
          history_files_pruned: result.history?.deleted || 0,
          jsonl_cleaned: result.jsonlCleaned || 0,
          pressure: result.db?.pressure || 'normal',
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Clean failed: ${err.message}` });
      }
    },

    // ── Manual Backup ────────────────────────────────────────────────────
    'POST /api/system/backup': (req, res) => {
      try {
        const result = createStateBackup(rawDb, dataDir);
        if (result.error) {
          return sendJSON(res, 500, { error: result.error });
        }
        // Prune old backups after creating new one
        const storageConfig = getStorageConfig(rawDb);
        pruneBackups(dataDir, {
          maxDaily: storageConfig.backup.max_daily,
          maxWeekly: storageConfig.backup.max_weekly,
        });
        sendJSON(res, 200, {
          ok: true,
          name: result.name,
          files: result.files,
          size_kb: Math.round(result.size / 1024),
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Backup failed: ${err.message}` });
      }
    },

    // ── List Backups ─────────────────────────────────────────────────────
    'GET /api/system/backups': (req, res) => {
      try {
        const backupList = listBackups(dataDir);
        sendJSON(res, 200, {
          backups: backupList.map(b => ({
            name: b.name,
            created_at: b.created_at,
            version: b.version,
            schema_version: b.schema_version,
            db_size_mb: Math.round(b.db_size_bytes / (1024 * 1024) * 100) / 100,
            total_size_mb: Math.round(b.total_size_bytes / (1024 * 1024) * 100) / 100,
          })),
        });
      } catch (err) {
        sendJSON(res, 500, { error: 'Failed to list backups' });
      }
    },

    // ── Shutdown Backup (drain + backup — called from FE on IDE close) ──
    'POST /api/system/shutdown-backup': (req, res) => {
      try {
        const storageConfig = getStorageConfig(rawDb);

        // 1. Drain messages
        let drainResult = { drained: 0 };
        if (storageConfig.drain.enabled) {
          drainResult = drainMessages(rawDb, dataDir, {
            cutoffHours: storageConfig.drain.cutoff_hours,
          });
        }

        // 2. State backup
        let backupResult = { name: null, error: null };
        if (storageConfig.backup.on_shutdown) {
          backupResult = createStateBackup(rawDb, dataDir);
          pruneBackups(dataDir, {
            maxDaily: storageConfig.backup.max_daily,
            maxWeekly: storageConfig.backup.max_weekly,
          });
        }

        sendJSON(res, 200, {
          ok: true,
          drained: drainResult.drained,
          backup: backupResult.name,
          backup_error: backupResult.error,
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Shutdown backup failed: ${err.message}` });
      }
    },

    // ── DB Vacuum ────────────────────────────────────────────────────────
    'POST /api/system/vacuum': (req, res) => {
      try {
        rawDb.pragma('wal_checkpoint(TRUNCATE)');
        rawDb.exec('VACUUM');
        sendJSON(res, 200, { ok: true, message: 'Database vacuumed successfully' });
      } catch (err) {
        sendJSON(res, 500, { error: `Vacuum failed: ${err.message}` });
      }
    },

    // ── Model Upgrade Proposals (v103) ────────────────────────────────
    'GET /api/system/upgrades': (req, res) => {
      try {
        const { proposals, discovery } = upgradeManager.getLastResults();
        sendJSON(res, 200, {
          proposals: proposals || [],
          formatted: UpgradeManager.formatProposals(proposals),
          discovery: discovery ? {
            ollamaAvailable: discovery.ollamaAvailable,
            candidateCount: discovery.candidates.length,
            hintsCount: discovery.hints.size,
            timestamp: discovery.timestamp,
          } : null,
          lastCheckTime: upgradeManager._lastCheckTime,
          history: upgradeManager.getHistory(),
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Upgrade check failed: ${err.message}` });
      }
    },

    // Force re-check upgrades
    'POST /api/system/upgrades/check': async (req, res) => {
      try {
        const body = await parseBody(req).catch(() => ({}));
        const opts = {};
        if (body.fullCycle) opts.fullCycle = true;
        const { proposals, discovery } = await upgradeManager.checkForUpgrades(opts);
        sendJSON(res, 200, {
          proposals,
          formatted: UpgradeManager.formatProposals(proposals),
          discovery: {
            ollamaAvailable: discovery.ollamaAvailable,
            candidateCount: discovery.candidates.length,
            hintsCount: discovery.hints.size,
            timestamp: discovery.timestamp,
            l4Count: discovery.candidates.filter(c => c.provisional || c.source === 'L4').length,
          },
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Upgrade check failed: ${err.message}` });
      }
    },

    // ── Model Upgrade Apply/Rollback (v125: fire-and-forget with auto-pull + BG verify) ──
    'POST /api/system/upgrades/apply': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { role, targetModel } = body;

        if (!role || !targetModel) {
          return sendJSON(res, 400, { error: 'Missing required fields: role, targetModel' });
        }

        // Quick validation before going async
        const { MODEL_PROFILES: profiles } = await import('../upgrade/model-profiles.js');
        if (!profiles[role]) {
          return sendJSON(res, 400, { error: `Invalid role: ${role}` });
        }

        // Respond immediately — progress via WS
        sendJSON(res, 200, { ok: true, status: 'started', role, targetModel });

        // Fire-and-forget: pull (if needed) → apply → BG verify → validation prompt
        (async () => {
          try {
            broadcast('control', { action: 'upgrade_progress', role, model: targetModel,
              status: 'starting', text: `${role}: Aplikuji ${targetModel}...` });

            const result = await upgradeManager.applyUpgrade(role, targetModel, {
              score: body.score,
              skipVerify: true,
              appliedBy: body.appliedBy || 'user',
              onPullProgress: (progress) => {
                broadcast('control', { action: 'model_pull_progress', model: targetModel, ...progress });
              },
            });

            broadcast('control', {
              action: 'model_changed', role,
              fromModel: result.from, toModel: result.to,
              configVersion: result.configVersion,
            });

            // Background verify (v125) — don't await
            upgradeManager._backgroundVerify(role, targetModel, result.from, (r, m) => {
              broadcast('control', { action: 'upgrade_verify_failed', role: r, model: m,
                text: `Varování: ${m} neodpovídá na ping po 3 pokusech. Zvažte rollback.` });
            }).catch(err => logger.warn('UpgradeManager', `BG verify error: ${err.message}`));

            // Auto-validation prompt (v125)
            try {
              const { getSuiteForRole } = await import('../upgrade/validation-suites.js');
              const suite = getSuiteForRole(role);
              if (suite) {
                broadcast('control', { action: 'model_validation_prompt', role, model: targetModel,
                  suite, estimatedMinutes: 5,
                  text: `Model ${targetModel} nastaven pro ${role}. Spustit validaci? (~5 min)` });
              }
            } catch (_) {}

          } catch (err) {
            broadcast('control', { action: 'upgrade_error', role, model: targetModel, error: err.message });
          }
        })();
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    'POST /api/system/upgrades/rollback': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { role } = body;

        if (!role) {
          return sendJSON(res, 400, { error: 'Missing required field: role' });
        }

        const { MODEL_PROFILES: profiles } = await import('../upgrade/model-profiles.js');
        if (!profiles[role]) {
          return sendJSON(res, 400, { error: `Invalid role: ${role}` });
        }

        const result = await upgradeManager.rollbackUpgrade(role, {
          skipVerify: body.skipVerify === true,
          force: body.force === true,
        });

        broadcast('control', {
          action: 'model_changed',
          role,
          fromModel: result.from,
          toModel: result.to,
          configVersion: result.configVersion,
        });

        sendJSON(res, 200, result);
      } catch (err) {
        const status = err.message.includes('No override found') ? 404
          : err.message.includes('no longer installed') ? 404
          : err.message.includes('Rollback verification') ? 502
          : err.message.includes('DB not initialized') ? 500
          : 500;
        sendJSON(res, status, { error: err.message });
      }
    },

    // ── Model Delete (v133: via ModelRegistry with safety guards) ──────
    'DELETE /api/system/models': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const modelName = url.searchParams.get('name');
        if (!modelName) return sendJSON(res, 400, { error: 'Missing ?name= parameter' });

        if (modelRegistry) {
          const { deletable, reason } = modelRegistry.isDeletable(modelName);
          if (!deletable) return sendJSON(res, 409, { error: reason });
          const result = await modelRegistry.deleteModel(modelName);
          return sendJSON(res, 200, result);
        }

        // Fallback: direct delete without registry
        const bound = Object.entries(config.models).filter(([_, m]) => m === modelName);
        if (bound.length > 0) {
          const roles = bound.map(([r]) => r).join(', ');
          return sendJSON(res, 409, { error: `Model still bound to role(s): ${roles}` });
        }

        const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
        const resp = await fetch(`${baseUrl}/api/delete`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName }),
        });
        if (!resp.ok) {
          return sendJSON(res, 502, { error: `Ollama returned ${resp.status}` });
        }
        sendJSON(res, 200, { ok: true, deleted: modelName });
      } catch (err) {
        const status = err.message.includes('přiřazený') || err.message.includes('validován') || err.message.includes('maže') ? 409 : 500;
        sendJSON(res, status, { error: err.message });
      }
    },

    'GET /api/system/upgrades/bindings': (req, res) => {
      try {
        const bindings = {};
        for (const role of Object.keys(config.models)) {
          bindings[role] = config.models[role];
        }

        const overrides = {};
        if (upgradeManager._db) {
          try {
            const rows = upgradeManager._db.prepare(
              'SELECT role, previous_model, applied_by, applied_at FROM model_overrides'
            ).all();
            for (const r of rows) {
              overrides[r.role] = {
                previousModel: r.previous_model,
                appliedBy: r.applied_by,
                appliedAt: r.applied_at,
              };
            }
          } catch (_) { /* DB not ready */ }
        }

        sendJSON(res, 200, { bindings, overrides, configVersion: upgradeManager._configVersion });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // ── v118: Model Catalog & Proposals ──────────────────────────────
    'GET /api/system/catalog': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const role = url.searchParams.get('role');
        const family = url.searchParams.get('family');

        const { CATALOG, CATALOG_VERSION, CATALOG_HASH } = await import('../upgrade/model-catalog.js');

        let entries = CATALOG;
        if (role) {
          const { BENCHMARK_WEIGHTS } = await import('../upgrade/model-ranker.js');
          const weights = BENCHMARK_WEIGHTS[role];
          if (!weights) return sendJSON(res, 400, { error: `Unknown role: ${role}` });
          // Return entries with non-zero benchmark coverage for this role
          entries = entries.filter(e => {
            if (!e.benchmarks) return false;
            return Object.keys(weights).some(k => e.benchmarks[k] != null);
          });
        }
        if (family) {
          entries = entries.filter(e => e.family === family);
        }

        sendJSON(res, 200, {
          entries,
          total: entries.length,
          catalogVersion: CATALOG_VERSION,
          catalogHash: CATALOG_HASH,
        });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    'GET /api/system/proposals': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const status = url.searchParams.get('status');
        const role = url.searchParams.get('role');

        const { proposalStore } = await import('../upgrade/proposal-store.js');
        const { MODEL_PROFILES } = await import('../upgrade/model-profiles.js');

        // v126: Build current models map for filtering
        const currentModels = {};
        for (const [r, profile] of Object.entries(MODEL_PROFILES)) {
          currentModels[r] = profile.getCurrentModel();
        }

        if (status === 'pending' && role) {
          sendJSON(res, 200, { proposals: proposalStore.getPendingForRole(role) });
        } else if (status || role) {
          sendJSON(res, 200, { proposals: proposalStore.getHistory({ status, role }) });
        } else {
          sendJSON(res, 200, { proposals: proposalStore.getActiveProposals(currentModels) });
        }
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v120.2: Per-role model scoring for all installed models
    'GET /api/system/upgrades/scoring': async (req, res) => {
      try {
        const { scoreModel, EVALUATION_VERSION, BENCHMARK_WEIGHTS } = await import('../upgrade/model-ranker.js');
        const { getCatalogEntry, computeEffectiveVram } = await import('../upgrade/model-catalog.js');
        const { MODEL_PROFILES } = await import('../upgrade/model-profiles.js');
        const { getSystemProfile } = await import('../system/gpu-detector.js');

        // Hardware context
        let gpuVramMb = 0;
        try {
          const profile = await getSystemProfile();
          if (profile.gpus?.length > 0) gpuVramMb = Math.max(...profile.gpus.map(g => g.vram_mb || 0));
        } catch (_) {}

        // Role bindings
        const roleBindings = {};
        for (const [r, p] of Object.entries(MODEL_PROFILES)) {
          roleBindings[r] = p.getCurrentModel();
        }

        // Fetch installed models from Ollama
        let installed = [];
        try {
          const r = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
          const data = await r.json();
          installed = (data.models || []).map(m => m.name);
        } catch (_) {}

        // Also load L4 discovered models for scoring
        let discoveredModels = [];
        try {
          const { onlineDiscovery } = await import('../upgrade/online-discovery.js');
          discoveredModels = await onlineDiscovery.getDiscoveredModels();
        } catch (_) {}

        // v123: Load validation scores for scoring enrichment
        const roleSuiteMap = { D1: 'reasoning', D2: 'reasoning', CODE: 'code', R1: 'reasoning', R2: 'review', CHAT: 'chat', VISION: 'vision' };
        let validationScores = new Map();
        try {
          const { validationRunner } = await import('../upgrade/validation-suites.js');
          validationRunner.setDb(rawDb);
          validationScores = validationRunner.getAllScores();
        } catch (_) {}

        // Score each installed model + discovered models for each role
        const roles = Object.keys(MODEL_PROFILES);
        const scoring = {};
        for (const role of roles) {
          scoring[role] = { current: roleBindings[role], models: [] };
          const suiteName = roleSuiteMap[role];
          for (const modelName of installed) {
            const entry = getCatalogEntry(modelName);
            if (!entry) continue;
            const vs = validationScores.get(modelName);
            const valScore = vs && suiteName && vs[suiteName] ? vs[suiteName].score : null;
            const ctx = { gpuVramMb, referenceParams: entry.params || 14, currentModel: entry, roleBindings, validationScore: valScore };
            const result = scoreModel(entry, role, ctx);
            scoring[role].models.push({
              name: modelName,
              score: result.totalScore,
              normalized: result.normalizedScore,
              breakdown: result.breakdown,
              isCurrent: modelName === roleBindings[role],
              benchmarkSource: 'catalog',
            });
          }
          // Add L4 discovered models not already in installed list
          for (const dm of discoveredModels) {
            if (installed.includes(dm.name)) continue;
            if (!dm.benchmarks) continue;
            const ctx = { gpuVramMb, referenceParams: dm.params || 14, roleBindings };
            const result = scoreModel(dm, role, ctx);
            scoring[role].models.push({
              name: dm.name,
              score: result.totalScore,
              normalized: result.normalizedScore,
              breakdown: result.breakdown,
              isCurrent: false,
              provisional: true,
              benchmarkConfidence: dm.benchmarkConfidence,
              benchmarkSource: dm.benchmarkSource || 'L4',
            });
          }
          scoring[role].models.sort((a, b) => b.score - a.score);
        }

        sendJSON(res, 200, { scoring, evalVersion: EVALUATION_VERSION, gpuVramMb });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v121.1: List all L4 discovered models with confidence scores
    'GET /api/system/upgrades/discovered': async (req, res) => {
      try {
        const { onlineDiscovery } = await import('../upgrade/online-discovery.js');
        const models = await onlineDiscovery.getDiscoveredModels();
        sendJSON(res, 200, { models, count: models.length });
      } catch (err) {
        sendJSON(res, 200, { models: [], count: 0, error: err.message });
      }
    },

    // v121.2: Pull (download) model from Ollama with WS progress + auto-scoring
    'POST /api/system/models/pull': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { name } = body;
        if (!name) return sendJSON(res, 400, { error: 'Missing required field: name' });

        // Respond immediately — progress via WebSocket
        sendJSON(res, 200, { ok: true, started: true, model: name });

        // Fire-and-forget: pull + score
        (async () => {
          try {
            broadcast('control', { action: 'model_pull_progress', model: name, status: 'starting', percent: 0, text: `${name} — Zahajuji stahování...` });

            await upgradeManager.pullModel(name, (progress) => {
              broadcast('control', { action: 'model_pull_progress', model: name, ...progress });
            });

            broadcast('control', { action: 'model_pull_progress', model: name, status: 'pulled', percent: 100, text: `${name} — Staženo. Spouštím scoring...` });

            // Auto-scoring after pull
            try {
              broadcast('control', { action: 'model_pull_progress', model: name, status: 'scoring', percent: -1, text: `${name} — Probíhá scoring modelu...` });

              const { scoreModel, EVALUATION_VERSION } = await import('../upgrade/model-ranker.js');
              const { getCatalogEntry, CATALOG } = await import('../upgrade/model-catalog.js');
              const { MODEL_PROFILES } = await import('../upgrade/model-profiles.js');
              const { getSystemProfile } = await import('../system/gpu-detector.js');
              const { onlineDiscovery } = await import('../upgrade/online-discovery.js');

              let gpuVramMb = 0;
              try {
                const profile = await getSystemProfile();
                if (profile.gpus?.length > 0) gpuVramMb = Math.max(...profile.gpus.map(g => g.vram_mb || 0));
              } catch (_) {}

              const roleBindings = {};
              for (const [r, p] of Object.entries(MODEL_PROFILES)) roleBindings[r] = p.getCurrentModel();

              // Stabilized model metadata fetch from Ollama (/api/show)
              const showResult = await fetchShowWithStability(config.ollama.baseUrl, name);
              const snapshot = showResult.snapshot;
              const metadataState = showResult.metadataState;

              // Persist raw model facts immediately (primary universe, fallback discovered mirror)
              let writeSource = 'none';
              let reconcileResult = null;
              if (FEATURE_UNIVERSE_ENABLED && snapshot) {
                try {
                  const persist = modelUniverseStore.persistRawWithFallback({
                    modelName: name,
                    tag: name.includes(':') ? name.split(':')[1] : '',
                    source: 'local',
                    metadataState,
                    parameters: snapshot.parameters,
                    contextLength: snapshot.context_length,
                    quantization: snapshot.quantization,
                    modality: snapshot.modality,
                    metadata: {
                      show: snapshot.raw,
                      showAttempts: showResult.attempts,
                      showErrors: showResult.errors,
                      elapsedMs: showResult.elapsedMs,
                    },
                    lastVerifiedAt: new Date().toISOString(),
                  }, {
                    mirrorEnabled: FEATURE_UNIVERSE_MIRROR,
                    scheduleRecompute: false,
                  });
                  writeSource = persist.writeSource || 'universe';
                  try {
                    reconcileResult = modelUniverseStore.reconcileAndRecompute(name, name.includes(':') ? name.split(':')[1] : '', {
                      reasonCode: 'post_pull',
                    });
                  } catch (reconcileErr) {
                    logger.warn('SystemRoutes', `Model universe reconcile failed for ${name}: ${reconcileErr.message}`);
                  }
                } catch (persistErr) {
                  logger.warn('SystemRoutes', `Model universe persist failed for ${name}: ${persistErr.message}`);
                  writeSource = 'error';
                }
              }

              // Try catalog entry first, then L4 discovered, then universe similarity/heuristic estimate
              let entry = getCatalogEntry(name);
              let discovered = [];
              if (!entry) {
                try {
                  discovered = await onlineDiscovery.getDiscoveredModels();
                  entry = discovered.find(d => d.name === name);
                } catch (_) {}
              }
              if (!entry && snapshot) {
                const parsed = parseModelName(name);
                const target = {
                  name,
                  family: parsed.family,
                  params: snapshot.parameters,
                  contextWindow: snapshot.context_length,
                  modality: snapshot.modality,
                  quantization: snapshot.quantization,
                };
                const pool = [
                  ...(Array.isArray(CATALOG) ? CATALOG.map(c => ({ ...c, benchmarkConfidence: 1, source: 'catalog' })) : []),
                  ...(Array.isArray(discovered) ? discovered : []),
                ];
                const prior = estimateModelPrior(target, pool, { topK: 3 });
                entry = _buildEstimatedEntry(name, snapshot, metadataState, prior);
              }

              if (entry) {
                const scores = {};
                for (const role of Object.keys(MODEL_PROFILES)) {
                  const ctx = { gpuVramMb, referenceParams: entry.params || 14, roleBindings };
                  const result = scoreModel(entry, role, ctx);
                  scores[role] = { score: result.totalScore, breakdown: result.breakdown };
                }

                const qualitySuffix = metadataState === 'STABLE'
                  ? 'Scoring dokončen (estimated)'
                  : `Scoring dokončen (estimated, metadata ${metadataState})`;
                broadcast('control', { action: 'model_pull_progress', model: name, status: 'done', percent: 100,
                  text: `${name} — ${qualitySuffix}`, scores, evalVersion: EVALUATION_VERSION, metadataState, writeSource,
                  reconcile: reconcileResult?.ok ? {
                    metadataState: reconcileResult.metadataState,
                    changedFields: reconcileResult.changedFields,
                    confidence: reconcileResult.derived?.confidence,
                  } : null });
              } else {
                broadcast('control', { action: 'model_pull_progress', model: name, status: 'done', percent: 100,
                  text: `${name} — Staženo (metadata nedostupná, scoring odložen)` });
              }

              if (metadataState !== 'STABLE') {
                const queued = enqueueUniverseRecompute(name, metadataState);
                if (queued) {
                  broadcast('control', {
                    action: 'model_pull_progress',
                    model: name,
                    status: 'recompute_queued',
                    percent: 100,
                    text: `${name} — Metadata ${metadataState}, plánuju background recompute`,
                  });
                }
              }
            } catch (scoreErr) {
              broadcast('control', { action: 'model_pull_progress', model: name, status: 'done', percent: 100,
                text: `${name} — Staženo (scoring selhal: ${scoreErr.message})` });
            }
          } catch (pullErr) {
            broadcast('control', { action: 'model_pull_progress', model: name, status: 'error', percent: -1,
              text: `${name} — Chyba: ${pullErr.message}` });
          }
        })();
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v121.3: Curated model recommendations with semaphore scoring
    'GET /api/system/upgrades/recommendations': async (req, res) => {
      try {
        const { RECOMMENDATION_SECTIONS, computeSemaphore, getRecommendedEntry, isSameModel } = await import('../upgrade/model-recommendations.js');
        const { scoreModel } = await import('../upgrade/model-ranker.js');
        const { getCatalogEntry } = await import('../upgrade/model-catalog.js');
        const { MODEL_PROFILES } = await import('../upgrade/model-profiles.js');
        const { getSystemProfile } = await import('../system/gpu-detector.js');

        // Hardware context
        let gpuVramMb = 0;
        try {
          const profile = await getSystemProfile();
          if (profile.gpus?.length > 0) gpuVramMb = Math.max(...profile.gpus.map(g => g.vram_mb || 0));
        } catch (_) {}

        // Role bindings
        const roleBindings = {};
        for (const [r, p] of Object.entries(MODEL_PROFILES)) {
          roleBindings[r] = p.getCurrentModel();
        }

        // Fetch installed models from Ollama
        // Build set with name variants (exact + stripped :latest + dash↔colon size suffix)
        // so recommendations like 'deepseek-r1:32b' match Ollama's 'deepseek-r1:32b' or 'deepseek-r1:latest'
        const installedSet = new Set();
        try {
          const r = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
          const data = await r.json();
          for (const m of (data.models || [])) {
            const name = m.name;
            installedSet.add(name);
            // Strip :latest → bare name
            const bare = name.replace(/:latest$/, '');
            if (bare !== name) installedSet.add(bare);
            // dash→colon variant: deepseek-r1-32b → deepseek-r1:32b
            const dm = bare.match(/^(.+?)-((\d+\.?\d*)b(-.+)?)$/i);
            if (dm) installedSet.add(dm[1] + ':' + dm[2]);
            // colon→dash variant: deepseek-r1:32b → deepseek-r1-32b
            const cm = bare.match(/^(.+):((\d+\.?\d*)b(-.+)?)$/i);
            if (cm) installedSet.add(cm[1] + '-' + cm[2]);
            // Quantization strip: deepseek-r1:32b-q4_K_M → also add deepseek-r1:32b
            const qm = bare.match(/^(.+:\d+\.?\d*b)-[a-zA-Z]/);
            if (qm) installedSet.add(qm[1]);
          }
        } catch (ollamaErr) {
          logger.warn('System', `Cannot fetch installed models from Ollama: ${ollamaErr.message}`);
        }

        // Get catalog entry set for "inCatalog" flag
        const { CATALOG } = await import('../upgrade/model-catalog.js');
        const catalogSet = new Set(CATALOG.map(e => e.name));

        const scoringContext = { gpuVramMb, roleBindings };

        // Build current model info per role (for FE comparison tables)
        // Fallback chain: CATALOG (exact) → CATALOG (variant) → RECOMMENDATION_SECTIONS (variant)
        // Name variants handle Ollama naming mismatches (e.g. 'deepseek-r1-32b' ↔ 'deepseek-r1:32b')
        function _resolveEntry(modelName) {
          const direct = getCatalogEntry(modelName);
          if (direct) return direct;
          // Try name variants (strip :latest, dash↔colon)
          const bare = modelName.replace(/:latest$/, '');
          if (bare !== modelName) { const e = getCatalogEntry(bare); if (e) return e; }
          const dm = bare.match(/^(.+?)-((\d+\.?\d*)b(-.+)?)$/i);
          if (dm) { const e = getCatalogEntry(dm[1] + ':' + dm[2]); if (e) return e; }
          const cm = bare.match(/^(.+):((\d+\.?\d*)b(-.+)?)$/i);
          if (cm) { const e = getCatalogEntry(cm[1] + '-' + cm[2]); if (e) return e; }
          // Fallback to recommendations
          return getRecommendedEntry(modelName);
        }

        const currentModels = {};
        for (const [role, modelName] of Object.entries(roleBindings)) {
          const entry = _resolveEntry(modelName);
          currentModels[role] = {
            name: modelName,
            params: entry?.params || null,
            vramMb: entry?.baseVramMb || (entry?.params ? Math.round(620 * entry.params + 420) : null),
            contextWindow: entry?.contextWindow || null,
            benchmarks: entry?.benchmarks || null,
          };
        }

        // v128.3: VRAM budget — hide models that won't fit in GPU memory (80% threshold)
        // Always show: already installed, currently assigned to a role, or GPU not detected
        const vramBudget = gpuVramMb > 0 ? gpuVramMb * 0.80 : Infinity;
        const currentModelNames = new Set(Object.values(roleBindings).filter(Boolean));

        // Enrich each section
        const sections = RECOMMENDATION_SECTIONS.map(section => ({
          id: section.id,
          title: section.title,
          subtitle: section.subtitle,
          icon: section.icon,
          models: section.models.filter(m => {
            // Always show installed or currently-assigned models
            if (installedSet.has(m.name)) return true;
            for (const cn of currentModelNames) { if (isSameModel(m.name, cn)) return true; }
            // Hide models that exceed 80% of GPU VRAM
            return !m.vramMb || m.vramMb <= vramBudget;
          }).map(m => {
            const installed = installedSet.has(m.name);
            const inCatalog = catalogSet.has(m.name);

            // Compute semaphore for each role this model serves
            const semaphores = {};
            for (const role of (m.roles || [])) {
              const currentModel = roleBindings[role];
              const currentEntry = _resolveEntry(currentModel);
              semaphores[role] = computeSemaphore(m, currentEntry, role, scoreModel, scoringContext);
            }

            // Best semaphore (upgrade > sidegrade > downgrade > unknown)
            const order = { upgrade: 3, sidegrade: 2, downgrade: 1, unknown: 0 };
            const bestSemaphore = Object.values(semaphores).reduce((best, s) =>
              (order[s] || 0) > (order[best] || 0) ? s : best, 'unknown');

            // Current model info for "replaces" hint + self-detection
            const replaces = {};
            const isCurrent = {};
            for (const role of (m.roles || [])) {
              replaces[role] = roleBindings[role] || null;
              isCurrent[role] = isSameModel(m.name, roleBindings[role]);
            }

            return {
              ...m,
              installed,
              inCatalog,
              semaphores,
              bestSemaphore,
              replaces,
              isCurrent,
            };
          }),
        }));

        sendJSON(res, 200, { sections, gpuVramMb, vramBudget: vramBudget === Infinity ? null : Math.round(vramBudget), currentModels });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v123: Run validation suite against a model
    'POST /api/system/models/validate': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { model, suite } = body;
        if (!model) return sendJSON(res, 400, { error: 'Missing model name' });

        const { validationRunner, SUITES, getSuiteForRole } = await import('../upgrade/validation-suites.js');
        validationRunner.setDb(rawDb);

        // Determine which suites to run
        let suiteNames;
        if (suite) {
          if (!SUITES[suite]) return sendJSON(res, 400, { error: `Unknown suite: ${suite}` });
          suiteNames = [suite];
        } else {
          suiteNames = Object.keys(SUITES);
        }

        // Quick response — actual work runs async with WS progress
        sendJSON(res, 200, { ok: true, model, suites: suiteNames, status: 'started' });

        // Run validation in background
        (async () => {
          try {
            broadcast('control', { action: 'model_validation_progress', model, status: 'starting', percent: 0,
              text: `${model} — Spouštím validaci...` });

            const result = await validationRunner.runAll(model, suiteNames, (progress) => {
              broadcast('control', {
                action: 'model_validation_progress', model,
                suite: progress.suite, testName: progress.testName,
                status: progress.status,
                currentTest: progress.currentTest, totalTests: progress.totalTests,
                percent: progress.percent, score: progress.score,
                text: progress.status === 'complete'
                  ? `${model} — ${progress.suite}: ${Math.round((progress.score || 0) * 100)}%`
                  : `${model} — ${progress.suite}: ${progress.testName} (${progress.currentTest}/${progress.totalTests})`,
              });
            });

            broadcast('control', {
              action: 'model_validation_progress', model, status: 'done', percent: 100,
              text: `${model} — Validace dokončena: ${Math.round(result.overallScore * 100)}%`,
              overallScore: result.overallScore,
              results: result.results.map(r => ({ suite: r.suite, score: r.score, passed: r.passed, total: r.total })),
            });
          } catch (err) {
            broadcast('control', { action: 'model_validation_progress', model, status: 'error', percent: -1,
              text: `${model} — Chyba validace: ${err.message}` });
          }
        })();
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v123: Get validation results for a model
    'GET /api/system/models/validate': async (req, res) => {
      try {
        const urlObj = new URL(req.url, 'http://localhost');
        const model = urlObj.searchParams.get('model');
        if (!model) return sendJSON(res, 400, { error: 'Missing model param' });

        const { validationRunner } = await import('../upgrade/validation-suites.js');
        validationRunner.setDb(rawDb);

        const results = validationRunner.getResults(model);
        if (!results) return sendJSON(res, 200, { model, suites: {} });

        sendJSON(res, 200, results);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v123: Get all validation scores (for scoring tab enrichment)
    'GET /api/system/models/validation-scores': async (req, res) => {
      try {
        const { validationRunner } = await import('../upgrade/validation-suites.js');
        validationRunner.setDb(rawDb);

        const allScores = validationRunner.getAllScores();
        const result = {};
        for (const [model, suites] of allScores) {
          result[model] = suites;
        }

        sendJSON(res, 200, { scores: result });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // ── v133: Model Overview (consolidated view) ──────────────────────
    'GET /api/system/models/overview': async (req, res) => {
      try {
        if (!modelRegistry) {
          return sendJSON(res, 501, { error: 'ModelRegistry not initialized' });
        }
        const overview = await modelRegistry.getOverview();
        sendJSON(res, 200, overview);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // ── v133: Batch Validate All Models ──────────────────────────────
    'POST /api/system/models/validate-all': async (req, res) => {
      try {
        if (!modelRegistry) {
          return sendJSON(res, 501, { error: 'ModelRegistry not initialized' });
        }
        const result = await modelRegistry.validateAll();
        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    'POST /api/system/proposals/:id/dismiss': async (req, res) => {
      try {
        const match = req.url.match(/\/api\/system\/proposals\/(\d+)\/dismiss/);
        if (!match) return sendJSON(res, 400, { error: 'Missing proposal ID' });
        const id = parseInt(match[1], 10);

        const { proposalStore } = await import('../upgrade/proposal-store.js');
        if (!proposalStore.dismiss(id)) {
          return sendJSON(res, 404, { error: `Proposal not found: ${id}` });
        }

        sendJSON(res, 200, { ok: true, dismissed: id });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },
  };
}
