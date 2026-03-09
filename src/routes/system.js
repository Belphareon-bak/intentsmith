// System Routes — GPU detection, model info, system diagnostics, storage management
// ══════════════════════════════════════════════════════════════════════════════

import { getSystemProfile } from '../system/gpu-detector.js';
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

/**
 * @param {{ db: import('better-sqlite3').Database, sendJSON: Function, parseBody: Function }} deps
 */
export function createSystemRoutes({ db, sendJSON, parseBody }) {
  const rawDb = db.db || db; // unwrap: db wrapper → raw better-sqlite3 instance
  const dataDir = config.db?.path ? path.dirname(path.resolve(config.db.path)) : path.resolve('./data');

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
        const { proposals, discovery } = await upgradeManager.checkForUpgrades();
        sendJSON(res, 200, {
          proposals,
          formatted: UpgradeManager.formatProposals(proposals),
          discovery: {
            ollamaAvailable: discovery.ollamaAvailable,
            candidateCount: discovery.candidates.length,
            hintsCount: discovery.hints.size,
            timestamp: discovery.timestamp,
          },
        });
      } catch (err) {
        sendJSON(res, 500, { error: `Upgrade check failed: ${err.message}` });
      }
    },

    // ── Model Upgrade Apply/Rollback (v103.1) ─────────────────────────
    'POST /api/system/upgrades/apply': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { role, targetModel } = body;

        if (!role || !targetModel) {
          return sendJSON(res, 400, { error: 'Missing required fields: role, targetModel' });
        }

        const result = await upgradeManager.applyUpgrade(role, targetModel, {
          score: body.score,
          skipVerify: body.skipVerify === true,
          appliedBy: body.appliedBy || 'user',
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
        const status = err.message.includes('Invalid role') ? 400
          : err.message.includes('not installed') ? 404
          : err.message.includes('already set') ? 409
          : err.message.includes('Verification failed') ? 502
          : err.message.includes('in progress') ? 409
          : 500;
        sendJSON(res, status, { error: err.message });
      }
    },

    'POST /api/system/upgrades/rollback': async (req, res) => {
      try {
        const body = await parseBody(req);
        const { role } = body;

        if (!role) {
          return sendJSON(res, 400, { error: 'Missing required field: role' });
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

    // ── Model Delete (v103.2) ───────────────────────────────────────
    'DELETE /api/system/models': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const modelName = url.searchParams.get('name');
        if (!modelName) return sendJSON(res, 400, { error: 'Missing ?name= parameter' });

        // Safety: refuse to delete a model currently bound to any role
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
        sendJSON(res, 500, { error: err.message });
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
  };
}
