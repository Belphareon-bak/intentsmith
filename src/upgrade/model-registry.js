// ModelRegistry v133 — Centralized Model Management
// ══════════════════════════════════════════════════════════════════════════════
//
// Single source of truth for all model queries and mutations.
// Consolidates logic from config, upgrade-manager, validation-suites, routes.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { parseModelName } from './model-profiles.js';
import { execSync } from 'child_process';
import fs from 'fs';

const VALIDATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const OVERVIEW_CACHE_TTL = 30_000; // 30s
const SUITES = ['reasoning', 'code', 'chat', 'vision', 'review'];

const ROLE_PROFILES = {
  D1:     { name: 'Hluboká analýza',   desc: 'Analýza, plánování, redesign. Vyžaduje reasoning + JSON.', suite: 'reasoning', color: '#8b5cf6' },
  D2:     { name: 'Analýza oprav',     desc: 'Fokusovaný reasoning pro opravy a fix-loop.',              suite: 'reasoning', color: '#a78bfa' },
  CODE:   { name: 'Generování kódu',   desc: 'Implementace, generování a editace kódu.',                 suite: 'code',      color: '#22c55e' },
  R1:     { name: 'Hluboká revize',    desc: 'Finální deep review (stejný reasoning jako D1).',          suite: 'reasoning', color: '#6366f1' },
  R2:     { name: 'Rychlá revize',     desc: 'Rychlý strukturální a logický check.',                     suite: 'review',    color: '#818cf8' },
  CHAT:   { name: 'Konverzace',        desc: 'Uživatelská konverzace, čeština, syntéza.',                suite: 'chat',      color: '#3b82f6' },
  VISION: { name: 'Analýza obrázků',   desc: 'Porozumění obrázkům a vizuálnímu obsahu. Vyžaduje vision.',suite: 'vision',    color: '#f59e0b' },
};

class ModelRegistry {
  constructor() {
    this._db = null;
    this._upgradeManager = null;
    this._validationRunner = null;
    this._broadcast = null;
    this._overviewCache = null;
    this._overviewCacheTime = 0;
    this._batchRunning = false;
    this._batchCancelled = false;
    this._validatingModel = null;
    this._deleting = false;
  }

  /** Wire dependencies (called once in server.js) */
  init({ db, upgradeManager, validationRunner, broadcast }) {
    this._db = db;
    this._upgradeManager = upgradeManager;
    this._validationRunner = validationRunner;
    this._broadcast = broadcast || (() => {});
  }

  // ─── Core Queries ──────────────────────────────────────────────────────────

  /** Get installed Ollama models with parsed metadata */
  async getInstalled() {
    const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
    try {
      const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.models || []).map(m => {
        const parsed = parseModelName(m.name);
        return {
          name: m.name,
          size: m.size || 0,
          sizeGB: (m.size / 1_073_741_824).toFixed(1),
          modified_at: m.modified_at,
          digest: m.digest,
          params: parsed.params ? parsed.params + 'B' : '?',
          family: parsed.family,
          category: parsed.category,
          quantization: m.details?.quantization_level || parsed.quantization || '?',
        };
      });
    } catch (err) {
      logger.warn('ModelRegistry', `Ollama unavailable: ${err.message}`);
      return [];
    }
  }

  /** Get current role → model bindings */
  getBound() {
    const bindings = {};
    for (const role of Object.keys(config.models)) {
      bindings[role] = config.models[role];
    }
    return bindings;
  }

  /** Get which roles a model is bound to */
  getBoundRoles(modelName) {
    const roles = [];
    for (const [role, model] of Object.entries(config.models)) {
      if (model === modelName) roles.push(role);
    }
    return roles;
  }

  /** Check if model is bound to any role */
  isBound(modelName) {
    return Object.values(config.models).includes(modelName);
  }

  /** Check if model can be deleted */
  isDeletable(modelName) {
    if (this.isBound(modelName)) {
      const roles = this.getBoundRoles(modelName).join(', ');
      return { deletable: false, reason: `Model je přiřazený k rolím: ${roles}` };
    }
    if (this._validatingModel === modelName) {
      return { deletable: false, reason: 'Model je právě validován' };
    }
    return { deletable: true };
  }

  /** Get validation scores for a model across all suites */
  getValidationScores(modelName) {
    if (!this._validationRunner) return {};
    const scores = {};
    const now = Date.now();
    for (const suite of SUITES) {
      const s = this._validationRunner.getScore(modelName, suite);
      if (s != null) {
        // Get updatedAt from DB
        let updatedAt = null;
        if (this._db) {
          try {
            const row = this._db.prepare(
              'SELECT validated_at FROM validation_suite_scores WHERE model = ? AND suite = ?'
            ).get(modelName, suite);
            if (row) updatedAt = row.validated_at;
          } catch (_) {}
        }
        const expired = updatedAt ? (now - Date.parse(updatedAt)) > VALIDATION_TTL_MS : true;
        scores[suite] = { score: s, updatedAt, expired };
      } else {
        scores[suite] = null;
      }
    }
    return scores;
  }

  /** Get all validation scores for all models */
  getAllValidationScores() {
    if (!this._validationRunner) return {};
    try {
      const allScores = this._validationRunner.getAllScores();
      const result = {};
      for (const [model, suiteScores] of allScores) {
        result[model] = {};
        for (const [suite, score] of Object.entries(suiteScores)) {
          result[model][suite] = { score, updatedAt: null, expired: false };
        }
      }
      // Enrich with timestamps
      if (this._db) {
        try {
          const rows = this._db.prepare(
            'SELECT model, suite, score, validated_at FROM validation_suite_scores'
          ).all();
          const now = Date.now();
          for (const r of rows) {
            if (!result[r.model]) result[r.model] = {};
            const expired = (now - Date.parse(r.validated_at)) > VALIDATION_TTL_MS;
            result[r.model][r.suite] = { score: r.score, updatedAt: r.validated_at, expired };
          }
        } catch (_) {}
      }
      return result;
    } catch (_) {
      return {};
    }
  }

  /** Get last usage info for a model */
  getUsage(modelName) {
    if (!this._db) return { lastUsedAt: null, requestCount: 0 };
    try {
      const row = this._db.prepare(
        'SELECT MAX(used_at) as last_used, COUNT(*) as cnt FROM model_usage WHERE model = ?'
      ).get(modelName);
      return {
        lastUsedAt: row?.last_used || null,
        requestCount: row?.cnt || 0,
      };
    } catch (_) {
      return { lastUsedAt: null, requestCount: 0 };
    }
  }

  /** Check if any model is being validated */
  isValidating() { return !!this._validatingModel; }
  isValidatingBatch() { return this._batchRunning; }

  // ─── Computed ──────────────────────────────────────────────────────────────

  /** Full consolidated overview (cached 30s) */
  async getOverview() {
    const now = Date.now();
    if (this._overviewCache && (now - this._overviewCacheTime) < OVERVIEW_CACHE_TTL) {
      return this._overviewCache;
    }

    const installed = await this.getInstalled();
    const bindings = this.getBound();
    const allScores = this.getAllValidationScores();
    const ollamaAvailable = installed.length > 0 || Object.keys(bindings).length > 0;

    // Disk usage
    let diskUsage = { totalBytes: 0, totalGB: '0', freeBytes: 0, freeGB: '0' };
    const totalBytes = installed.reduce((sum, m) => sum + (m.size || 0), 0);
    diskUsage.totalBytes = totalBytes;
    diskUsage.totalGB = (totalBytes / 1_073_741_824).toFixed(1);
    try {
      const stats = fs.statfsSync(config.ollama?.modelsPath || '/usr/share/ollama/.ollama/models');
      diskUsage.freeBytes = stats.bfree * stats.bsize;
      diskUsage.freeGB = (diskUsage.freeBytes / 1_073_741_824).toFixed(1);
    } catch (_) {
      // Try df as fallback
      try {
        const dfOut = execSync('df -B1 / 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
        const parts = dfOut.split('\n')[1]?.split(/\s+/);
        if (parts && parts[3]) {
          diskUsage.freeBytes = parseInt(parts[3], 10) || 0;
          diskUsage.freeGB = (diskUsage.freeBytes / 1_073_741_824).toFixed(1);
        }
      } catch (_) {}
    }

    // Auto-cleanup settings
    let autoCleanup = { enabled: false, days: 14 };
    if (this._db) {
      try {
        const row = this._db.prepare("SELECT value FROM user_settings WHERE key = 'c3.models.autoCleanupEnabled'").get();
        const rowD = this._db.prepare("SELECT value FROM user_settings WHERE key = 'c3.models.autoCleanupDays'").get();
        if (row) autoCleanup.enabled = row.value === 'true' || row.value === true;
        if (rowD) autoCleanup.days = parseInt(rowD.value, 10) || 14;
      } catch (_) {}
    }

    let unvalidatedCount = 0;
    const models = installed.map(m => {
      const boundRoles = this.getBoundRoles(m.name);
      const { deletable, reason } = this.isDeletable(m.name);
      const vs = allScores[m.name] || {};
      const usage = this.getUsage(m.name);
      const unvalidatedSuites = SUITES.filter(s => !vs[s] || vs[s].expired);
      if (unvalidatedSuites.length > 0) unvalidatedCount++;

      // Overall score: average of non-null, non-expired scores
      const validScores = SUITES.map(s => vs[s]?.score).filter(s => s != null);
      const overallScore = validScores.length > 0
        ? validScores.reduce((a, b) => a + b, 0) / validScores.length
        : null;

      return {
        name: m.name,
        size: m.size,
        sizeGB: m.sizeGB,
        params: m.params,
        family: m.family,
        category: m.category,
        quantization: m.quantization,
        modified_at: m.modified_at,
        isBound: boundRoles.length > 0,
        isDeletable: deletable,
        deletableReason: reason || null,
        boundRoles,
        lastUsedAt: usage.lastUsedAt,
        requestCount: usage.requestCount,
        validationScores: vs,
        overallScore,
        unvalidatedSuites,
      };
    });

    const result = {
      models,
      bindings,
      profiles: ROLE_PROFILES,
      diskUsage,
      autoCleanup,
      unvalidatedCount,
      batchValidating: this._batchRunning,
      ollamaAvailable,
    };

    this._overviewCache = result;
    this._overviewCacheTime = now;
    return result;
  }

  /** Get models that can be deleted */
  getDeletable() {
    const bindings = this.getBound();
    const boundModels = new Set(Object.values(bindings));
    // Uses cached overview if available
    if (this._overviewCache) {
      return this._overviewCache.models
        .filter(m => m.isDeletable)
        .map(m => ({ name: m.name, size: m.size, sizeGB: m.sizeGB }));
    }
    return [];
  }

  /** Get recommendation for a role (best non-current model by validation score) */
  getRecommendation(role) {
    const profile = ROLE_PROFILES[role];
    if (!profile) return null;
    const current = config.models[role];
    const allScores = this.getAllValidationScores();
    const suite = profile.suite;

    let best = null;
    let bestScore = -1;
    const currentScore = allScores[current]?.[suite]?.score ?? -1;

    for (const [model, scores] of Object.entries(allScores)) {
      if (model === current) continue;
      const s = scores[suite]?.score;
      if (s != null && s > bestScore) {
        bestScore = s;
        best = model;
      }
    }

    if (best && bestScore > currentScore) {
      const delta = currentScore >= 0 ? Math.round((bestScore - currentScore) * 100) : null;
      return { model: best, score: bestScore, delta };
    }
    return null;
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  /** Delete a model with all safety guards */
  async deleteModel(name) {
    if (this._deleting) throw new Error('Jiný model se právě maže');

    // Double-check bindings (race condition guard)
    if (this.isBound(name)) {
      const roles = this.getBoundRoles(name).join(', ');
      throw new Error(`Model je přiřazený k rolím: ${roles}`);
    }
    if (this._validatingModel === name) {
      throw new Error('Model je právě validován');
    }

    this._deleting = true;
    try {
      const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
      const resp = await fetch(`${baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        throw new Error(`Ollama vrátil ${resp.status}`);
      }

      this.invalidateCache();

      // Find size from cache for the WS event
      let freedGB = '?';
      if (this._overviewCache) {
        const m = this._overviewCache.models.find(m => m.name === name);
        if (m) freedGB = m.sizeGB;
      }

      this._broadcast('control', { action: 'model_deleted', model: name, freedGB });
      logger.info('ModelRegistry', `Deleted model: ${name} (freed ~${freedGB} GB)`);

      return { ok: true, deleted: name, freedGB };
    } finally {
      this._deleting = false;
    }
  }

  /** Assign model to role (delegates to upgrade manager) */
  async assignModel(role, model, opts = {}) {
    const result = await this._upgradeManager.applyUpgrade(role, model, {
      appliedBy: opts.appliedBy || 'user-registry',
      skipVerify: true,
      onPullProgress: opts.onPullProgress,
    });
    this.invalidateCache();
    return result;
  }

  // ─── Batch Validation ──────────────────────────────────────────────────────

  /** Validate all installed models that need it (sequential, mutex-guarded) */
  async validateAll(onProgress) {
    if (this._batchRunning) return { ok: true, alreadyRunning: true };
    if (!this._validationRunner) return { ok: false, error: 'Validation runner not available' };

    const installed = await this.getInstalled();
    const allScores = this.getAllValidationScores();
    const now = Date.now();

    // Filter to models needing validation
    const queue = installed.filter(m => {
      const scores = allScores[m.name];
      if (!scores) return true;
      // Need validation if any suite is missing or expired
      return SUITES.some(s => !scores[s] || scores[s].expired);
    }).map(m => m.name);

    if (queue.length === 0) return { ok: true, queued: [], estimatedMinutes: 0 };

    this._batchRunning = true;
    this._batchCancelled = false;
    const estimatedMinutes = queue.length * 3;

    logger.info('ModelRegistry', `Batch validation started: ${queue.length} models (~${estimatedMinutes} min)`);

    // Return immediately — run async
    const self = this;
    (async () => {
      try {
        for (let i = 0; i < queue.length; i++) {
          if (self._batchCancelled) break;

          const model = queue[i];

          // Check model still exists
          const check = await self.getInstalled();
          if (!check.some(m => m.name === model)) {
            logger.warn('ModelRegistry', `Skipping ${model} — no longer installed`);
            continue;
          }

          self._validatingModel = model;

          self._broadcast('control', {
            action: 'model_validation_progress', model,
            status: 'starting', percent: 0,
            batchIndex: i + 1, batchTotal: queue.length,
            text: `${model} — Spouštím validaci... (${i + 1}/${queue.length})`,
          });

          try {
            const result = await self._validationRunner.runAll(model, null, (progress) => {
              self._broadcast('control', {
                action: 'model_validation_progress', model,
                suite: progress.suite, testName: progress.testName,
                status: progress.status,
                currentTest: progress.currentTest, totalTests: progress.totalTests,
                percent: progress.percent, score: progress.score,
                batchIndex: i + 1, batchTotal: queue.length,
                text: progress.status === 'complete'
                  ? `${model} — ${progress.suite}: ${Math.round((progress.score || 0) * 100)}%`
                  : `${model} — ${progress.suite}: ${progress.testName} (${progress.currentTest}/${progress.totalTests})`,
              });
              if (onProgress) onProgress({ model, batchIndex: i + 1, batchTotal: queue.length, ...progress });
            });

            self._broadcast('control', {
              action: 'model_validation_progress', model,
              status: 'done', percent: 100,
              batchIndex: i + 1, batchTotal: queue.length,
              text: `${model} — Validace dokončena: ${Math.round(result.overallScore * 100)}%`,
              overallScore: result.overallScore,
              results: result.results.map(r => ({ suite: r.suite, score: r.score, passed: r.passed, total: r.total })),
            });
          } catch (err) {
            self._broadcast('control', {
              action: 'model_validation_progress', model,
              status: 'error', percent: -1,
              batchIndex: i + 1, batchTotal: queue.length,
              text: `${model} — Chyba: ${err.message}`,
            });
          }

          self._validatingModel = null;
        }
      } finally {
        self._batchRunning = false;
        self._validatingModel = null;
        self.invalidateCache();
        logger.info('ModelRegistry', 'Batch validation finished');
      }
    })();

    return { ok: true, queued: queue, estimatedMinutes };
  }

  cancelBatchValidation() {
    this._batchCancelled = true;
    if (this._validationRunner) {
      try { this._validationRunner._cancelled = true; } catch (_) {}
    }
  }

  // ─── Auto-Cleanup ──────────────────────────────────────────────────────────

  /** Run auto-cleanup of unused models older than `days` */
  async runAutoCleanup(days = 14) {
    const installed = await this.getInstalled();
    const boundModels = new Set(Object.values(config.models));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const deleted = [];

    for (const m of installed) {
      // Skip bound models
      if (boundModels.has(m.name)) continue;
      // Skip if currently validating
      if (this._validatingModel === m.name) continue;
      // Check last usage
      const usage = this.getUsage(m.name);
      if (usage.lastUsedAt && usage.lastUsedAt > cutoff) continue;
      // Check last modified (fallback if no usage data)
      if (!usage.lastUsedAt && m.modified_at && m.modified_at > cutoff) continue;

      try {
        const result = await this.deleteModel(m.name);
        deleted.push({ model: m.name, freedGB: result.freedGB });
        this._broadcast('control', { action: 'model_auto_cleaned', model: m.name, freedGB: result.freedGB });
      } catch (err) {
        logger.warn('ModelRegistry', `Auto-cleanup failed for ${m.name}: ${err.message}`);
      }
    }

    if (deleted.length > 0) {
      logger.info('ModelRegistry', `Auto-cleanup: deleted ${deleted.length} models`, { deleted });
    }
    return deleted;
  }

  // ─── Binding Integrity Check ───────────────────────────────────────────────

  /** Check if bound models are still installed, auto-rebind if not */
  async checkBindingIntegrity() {
    try {
      const installed = await this.getInstalled();
      if (installed.length === 0) return; // Ollama probably offline
      const installedNames = new Set(installed.map(m => m.name));

      for (const [role, model] of Object.entries(config.models)) {
        if (installedNames.has(model)) continue;

        // Model missing! Try to find best alternative
        const rec = this.getRecommendation(role);
        if (rec && installedNames.has(rec.model)) {
          logger.warn('ModelRegistry', `Model ${model} missing for ${role}, rebinding to ${rec.model}`);
          try {
            await this.assignModel(role, rec.model, { appliedBy: 'auto-rebind' });
            this._broadcast('control', {
              action: 'model_auto_rebound', role, from: model, to: rec.model,
            });
          } catch (err) {
            logger.error('ModelRegistry', `Auto-rebind failed: ${err.message}`);
          }
        } else {
          // No recommendation — just log warning
          logger.warn('ModelRegistry', `Model ${model} missing for ${role}, no alternative found`);
        }
      }
    } catch (err) {
      logger.warn('ModelRegistry', `Integrity check failed: ${err.message}`);
    }
  }

  /** Invalidate overview cache */
  invalidateCache() {
    this._overviewCache = null;
    this._overviewCacheTime = 0;
  }
}

export const modelRegistry = new ModelRegistry();
export { ROLE_PROFILES, SUITES };
export default modelRegistry;
