// Upgrade Manager — discovery, provider pull and manual binding support.
// ══════════════════════════════════════════════════════════════════════════════
//
// Discovery metadata orders work; it never claims measured quality and never
// creates an upgrade recommendation. Exact-contract evaluation and decisions
// live in model-upgrade-hunt + model_evaluation_* storage.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { MODEL_PROFILES } from './model-profiles.js';
import { discover, fetchInstalledModels } from './model-discovery.js';
import {
  canonicalModelName,
  canonicalModelNameSet,
  sameModelName,
} from './model-identity.js';
import {
  MODEL_ACTIVITY_OWNER,
  modelUseAuthority,
} from './model-use-authority.js';
import { requireLoopbackModelProviderOrigin } from './model-provider-origin.js';

export const MODEL_PULL_IDLE_TIMEOUT_MS = 120_000;

function modelPullError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

async function readPullChunk(reader, controller, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = modelPullError(
        'MODEL_PULL_IDLE_TIMEOUT',
        `Ollama pull produced no bytes for ${timeoutMs} ms`,
      );
      controller.abort(error);
      void reader.cancel(error).catch(() => {});
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// v121.1: L4 Online Discovery lazy-loaded
let _onlineDiscovery = null;

async function _ensureOnlineDiscovery() {
  if (!_onlineDiscovery) {
    try {
      const mod = await import('./online-discovery.js');
      _onlineDiscovery = mod.onlineDiscovery;
    } catch { _onlineDiscovery = null; }
  }
  return _onlineDiscovery;
}

// ─── Upgrade Manager Class ──────────────────────────────────────────────────

export class UpgradeManager {
  constructor(options = {}) {
    this._lastDiscovery = null;
    this._lastCheckTime = null;
    this._modelHash = null;
    this._recheckInterval = null;
    this._pollInterval = null;
    this._active = false;
    this._db = null;
    this._configVersion = 0;  // Monotonic counter for WS broadcast
    this._bindingRuntimeToken = null;
    this._bindingRuntimeTokenSequence = 0;
    this._modelArtifactAuthorityRepository = null;
    this._pullIdleTimeoutMs = MODEL_PULL_IDLE_TIMEOUT_MS;
    this._modelUseAuthority = options.modelUseAuthority || modelUseAuthority;
    if (typeof this._modelUseAuthority?.acquireExclusive !== 'function') {
      throw modelPullError('MODEL_USE_AUTHORITY_REQUIRED', 'Model use authority is unavailable');
    }
  }

  // ─── DB + Persistence (v103.1) ──────────────────────────────────────────

  /**
   * Set DB handle for persistence.
   * @param {import('better-sqlite3').Database} db
   */
  setDb(db) {
    this._db = db;
  }

  setModelArtifactAuthorityRepository(repository) {
    if (!repository
      || typeof repository.recordIntent !== 'function'
      || typeof repository.recordOutcome !== 'function'
      || typeof repository.acquirePullRecoveryClaim !== 'function'
      || typeof repository.releaseClaim !== 'function'
      || typeof repository.reconcileSucceeded !== 'function'
      || typeof repository.listOutstandingEffects !== 'function') {
      throw modelPullError(
        'MODEL_ARTIFACT_REPOSITORY_INVALID',
        'Model artifact authority repository is invalid',
      );
    }
    this._modelArtifactAuthorityRepository = repository;
  }

  createBindingRuntimePort() {
    return Object.freeze({
      snapshot: role => this._bindingRuntimeSnapshot(role),
      prepare: input => this._prepareBindingRuntime(input),
      commit: token => this._commitBindingRuntime(token),
      compensate: token => this._compensateBindingRuntime(token),
      rehydrateLegacy: input => this._rehydrateLegacyBinding(input),
    });
  }

  _bindingRuntimeFailure(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  _bindingRuntimeSnapshot(role) {
    if (!MODEL_PROFILES[role]) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_ROLE_INVALID',
        `Invalid role: ${role}`,
        { role },
      );
    }
    return Object.freeze({
      role,
      modelName: config.models[role],
      configVersion: this._configVersion,
    });
  }

  _prepareBindingRuntime(input = {}) {
    const allowed = new Set(['role', 'expectedModel', 'targetModel', 'incrementVersion']);
    const unexpected = Object.keys(input).filter(key => !allowed.has(key));
    if (unexpected.length > 0) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_INPUT_INVALID',
        'Runtime binding input contains unknown authority fields',
        { fields: unexpected.sort() },
      );
    }
    const { role, expectedModel, targetModel } = input;
    if (!MODEL_PROFILES[role]) {
      throw this._bindingRuntimeFailure('MODEL_BINDING_ROLE_INVALID', `Invalid role: ${role}`, { role });
    }
    if (typeof expectedModel !== 'string' || !expectedModel.trim()
      || typeof targetModel !== 'string' || !targetModel.trim()) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_INPUT_INVALID',
        'Runtime binding requires non-empty expected and target models',
        { role },
      );
    }
    if (this._bindingRuntimeToken) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_APPLICATION_BUSY',
        'Another model binding runtime transition is in progress',
      );
    }
    const currentModel = config.models[role];
    if (!sameModelName(currentModel, expectedModel)
      && !sameModelName(currentModel, targetModel)) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_CAS_MISMATCH',
        `Runtime binding changed before ${role} could be updated`,
        { role, expectedModel, targetModel, currentModel },
      );
    }
    const token = Object.freeze({
      id: ++this._bindingRuntimeTokenSequence,
      role,
      previousModel: currentModel,
      targetModel,
      versionBefore: this._configVersion,
      incrementVersion: input.incrementVersion !== false,
      changed: currentModel !== targetModel,
    });
    this._bindingRuntimeToken = token;
    if (token.changed) config.models[role] = targetModel;
    return token;
  }

  _commitBindingRuntime(token) {
    if (!token || token !== this._bindingRuntimeToken) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_TOKEN_INVALID',
        'Runtime binding commit token is not active',
      );
    }
    if (config.models[token.role] !== token.targetModel
      || this._configVersion !== token.versionBefore) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_CAS_MISMATCH',
        'Runtime binding changed before commit',
        { role: token.role },
      );
    }
    const nextConfigVersion = token.versionBefore + (token.incrementVersion ? 1 : 0);
    const result = Object.freeze({
      role: token.role,
      from: token.previousModel,
      to: token.targetModel,
      configVersion: nextConfigVersion,
      changed: token.changed,
    });
    this._configVersion = nextConfigVersion;
    this._bindingRuntimeToken = null;
    return result;
  }

  _compensateBindingRuntime(token) {
    if (!token || token !== this._bindingRuntimeToken) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_TOKEN_INVALID',
        'Runtime binding compensation token is not active',
      );
    }
    if (config.models[token.role] !== token.targetModel
      || this._configVersion !== token.versionBefore) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_COMPENSATION_FAILED',
        'Runtime binding cannot be compensated after concurrent mutation',
        { role: token.role },
      );
    }
    if (token.changed) config.models[token.role] = token.previousModel;
    this._bindingRuntimeToken = null;
    return Object.freeze({
      role: token.role,
      restoredModel: token.previousModel,
      configVersion: this._configVersion,
    });
  }

  _rehydrateLegacyBinding(input = {}) {
    const allowed = new Set(['role', 'targetModel']);
    const unexpected = Object.keys(input).filter(key => !allowed.has(key));
    if (unexpected.length > 0) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_INPUT_INVALID',
        'Legacy rehydrate input contains unknown fields',
        { fields: unexpected.sort() },
      );
    }
    if (!MODEL_PROFILES[input.role]
      || typeof input.targetModel !== 'string'
      || !input.targetModel.trim()) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_RUNTIME_INPUT_INVALID',
        'Legacy rehydrate requires a valid role and model',
      );
    }
    if (this._bindingRuntimeToken) {
      throw this._bindingRuntimeFailure(
        'MODEL_BINDING_APPLICATION_BUSY',
        'Cannot rehydrate a legacy binding during a runtime transition',
      );
    }
    const from = config.models[input.role];
    config.models[input.role] = input.targetModel;
    return Object.freeze({
      role: input.role,
      from,
      to: input.targetModel,
      configVersion: this._configVersion,
    });
  }

  /**
   * Pull a model from Ollama with streaming progress.
   *
   * @param {string} modelName - e.g. 'qwen3.5:27b'
   * @param {Function} [onProgress] - callback({text, percent, downloadedGB, totalGB, eta, status})
   * @param {{baseUrl?: string, source?: string, recoveryOperationId?: string}} [authority]
   * @returns {Promise<void>}
   */
  async pullModel(modelName, onProgress, authority = {}) {
    const authorityKeys = Object.keys(authority || {}).sort();
    if (authority === null || typeof authority !== 'object' || Array.isArray(authority)
      || authorityKeys.some(key => !['baseUrl', 'recoveryOperationId', 'source'].includes(key))) {
      throw modelPullError('MODEL_PULL_INPUT_INVALID', 'Model pull authority is invalid');
    }
    const canonicalName = canonicalModelName(modelName);
    if (!canonicalName) throw modelPullError('MODEL_PULL_INPUT_INVALID', 'Model name is invalid');
    let provider;
    try {
      provider = requireLoopbackModelProviderOrigin(
        authority.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434',
      );
    } catch (error) {
      throw modelPullError('MODEL_PULL_PROVIDER_SCOPE_UNSUPPORTED', error.message, error);
    }
    const source = authority.source || 'USER_REQUEST';
    if (!new Set(['USER_REQUEST', 'USER_HTTP', 'USER_CHAT', 'AUTO_CLEANUP', 'BINDING_APPLICATION', 'RECOVERY']).has(source)) {
      throw modelPullError('MODEL_PULL_INPUT_INVALID', 'Model pull source is invalid');
    }

    let pullLease;
    let operationId = authority.recoveryOperationId || null;
    const recovery = typeof operationId === 'string';
    if (recovery) {
      if (!this._modelArtifactAuthorityRepository) {
        throw modelPullError(
          'MODEL_ARTIFACT_DURABLE_AUTHORITY_REQUIRED',
          'Durable pull recovery authority is unavailable',
        );
      }
      const claim = this._modelArtifactAuthorityRepository.acquirePullRecoveryClaim(operationId);
      if (claim.exactName !== modelName || claim.providerOrigin !== provider.origin) {
        this._modelArtifactAuthorityRepository.releaseClaim(claim.claimId);
        throw modelPullError('MODEL_PULL_RECOVERY_IDENTITY_MISMATCH', 'Pull recovery identity drifted');
      }
      pullLease = Object.freeze({
        claimId: claim.claimId,
        release: () => this._modelArtifactAuthorityRepository.releaseClaim(claim.claimId),
      });
    } else {
      pullLease = this._modelUseAuthority.acquireExclusive({
        modelName,
        owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
      });
    }
    try {
      if (!recovery && this._modelArtifactAuthorityRepository) {
        if (typeof pullLease.claimId !== 'string') {
          throw modelPullError(
            'MODEL_ARTIFACT_DURABLE_AUTHORITY_REQUIRED',
            'Durable pull claim is unavailable',
          );
        }
        operationId = this._modelArtifactAuthorityRepository.recordIntent({
          claimId: pullLease.claimId,
          kind: 'PULL',
          exactName: modelName,
          canonicalName,
          digestSha256: null,
          source,
          providerOrigin: provider.origin,
        }).operationId;
      }
      const controller = new AbortController();
      const response = await fetch(provider.endpoint('/api/pull'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw modelPullError(
          `MODEL_PULL_PROVIDER_HTTP_${response.status}`,
          `Ollama pull failed: HTTP ${response.status}`,
        );
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        throw modelPullError('MODEL_PULL_PROVIDER_BODY_INVALID', 'Ollama pull body is unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastPercent = -1;
      let lastEmitTime = 0;
      let providerSuccessSeen = false;
      const startTime = Date.now();

      const STATUS_LABELS = {
        'pulling manifest': 'Stahuji manifest...',
        'downloading': null,
        'verifying sha256 digest': 'Ověřuji integritu...',
        'writing manifest': 'Zapisuji manifest...',
        'removing any unused layers': 'Čistím staré vrstvy...',
        'success': 'Hotovo',
      };

      const consumeProviderLine = line => {
        if (!line.trim()) return;
        let data;
        try {
          data = JSON.parse(line);
        } catch (error) {
          throw modelPullError(
            'MODEL_PULL_PROVIDER_BODY_INVALID',
            'Ollama pull returned malformed JSON',
            error,
          );
        }
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
          throw modelPullError(
            'MODEL_PULL_PROVIDER_BODY_INVALID',
            'Ollama pull returned a non-object event',
          );
        }
        if (typeof data.error === 'string' && data.error.trim()) {
          throw modelPullError(
            'MODEL_PULL_PROVIDER_REPORTED_ERROR',
            `Ollama pull error: ${data.error}`,
          );
        }
        if (data.status === 'success') providerSuccessSeen = true;

        if (data.status === 'downloading' && data.total > 0) {
          const percent = Math.round((data.completed / data.total) * 100);
          const now = Date.now();
          if (percent >= lastPercent + 5 || (now - lastEmitTime >= 3000) || percent === 100) {
            lastPercent = percent;
            lastEmitTime = now;
            const elapsed = (now - startTime) / 1000;
            const speed = data.completed / elapsed;
            const remaining = (data.total - data.completed) / speed;
            const eta = remaining > 60
              ? `${Math.round(remaining / 60)}:${String(Math.round(remaining % 60)).padStart(2, '0')}`
              : `${Math.round(remaining)}s`;
            const downloadedGB = (data.completed / 1_073_741_824).toFixed(1);
            const totalGB = (data.total / 1_073_741_824).toFixed(1);
            const text = `${modelName} — ${percent}% (${downloadedGB}/${totalGB} GB) — ETA ~${eta}`;

            if (onProgress) onProgress({ text, percent, downloadedGB, totalGB, eta, status: 'downloading' });
          }
        } else if (data.status && STATUS_LABELS[data.status] !== undefined) {
          const label = STATUS_LABELS[data.status];
          if (label && onProgress) {
            onProgress({ text: `${modelName} — ${label}`, percent: -1, status: data.status });
          }
        }
      };

      while (true) {
        const { done, value } = await readPullChunk(
          reader,
          controller,
          this._pullIdleTimeoutMs,
        );
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          consumeProviderLine(line);
        }
      }
      buffer += decoder.decode();
      consumeProviderLine(buffer);

      if (!providerSuccessSeen) {
        throw modelPullError(
          'MODEL_PULL_PROVIDER_TERMINAL_MISSING',
          'Ollama pull ended without an explicit success receipt',
        );
      }

      logger.info('UpgradeManager', `Pulled model: ${modelName}`);
      if (operationId) {
        if (recovery) this._modelArtifactAuthorityRepository.reconcileSucceeded(operationId);
        else this._modelArtifactAuthorityRepository.recordOutcome(operationId, 'SUCCEEDED');
      }
    } catch (error) {
      if (operationId && !recovery) {
        const definitive = typeof error?.code === 'string'
          && (error.code.startsWith('MODEL_PULL_PROVIDER_HTTP_')
            || error.code === 'MODEL_PULL_PROVIDER_BODY_INVALID'
            || error.code === 'MODEL_PULL_PROVIDER_REPORTED_ERROR'
            || error.code === 'MODEL_PULL_PROVIDER_TERMINAL_MISSING');
        this._modelArtifactAuthorityRepository.recordOutcome(
          operationId,
          definitive ? 'FAILED' : 'ORPHANED',
          error?.code || 'MODEL_PULL_PROVIDER_OUTCOME_UNKNOWN',
        );
      }
      throw error;
    } finally {
      pullLease.release();
    }
  }

  async recoverOutstandingModelPulls(onProgress) {
    if (!this._modelArtifactAuthorityRepository) return Object.freeze([]);
    const results = [];
    for (const operation of this._modelArtifactAuthorityRepository.listOutstandingEffects()) {
      if (operation.kind !== 'PULL') continue;
      try {
        await this.pullModel(operation.exactName, onProgress, {
          baseUrl: operation.providerOrigin,
          source: 'RECOVERY',
          recoveryOperationId: operation.operationId,
        });
        results.push(Object.freeze({ operationId: operation.operationId, status: 'RECOVERED' }));
      } catch (error) {
        results.push(Object.freeze({
          operationId: operation.operationId,
          status: 'STILL_BLOCKED',
          errorCode: error?.code || 'MODEL_PULL_RECOVERY_FAILED',
        }));
      }
    }
    return Object.freeze(results);
  }

  /**
   * Find old models that were replaced and are no longer bound to any role.
   * @returns {Array<{model: string, replacedBy: string, role: string, appliedAt: string}>}
   */
  getUnusedOldModels() {
    if (!this._db) return [];
    try {
      const rows = this._db.prepare(
        `SELECT role, model, previous_model, applied_at
         FROM model_overrides
         ORDER BY applied_at DESC, role ASC
         LIMIT 50`
      ).all();

      const boundModels = canonicalModelNameSet(Object.values(config.models));
      const seen = new Set();
      const result = [];
      for (const row of rows) {
        const canonical = canonicalModelName(row.previous_model);
        if (!canonical || boundModels.has(canonical) || seen.has(canonical)) continue;
        seen.add(canonical);
        result.push({
          model: row.previous_model.trim(),
          replacedBy: typeof row.model === 'string' ? row.model.trim() : '',
          role: row.role,
          appliedAt: row.applied_at,
        });
      }
      return result;
    } catch (_) {
      return [];
    }
  }

  /**
   * Refresh factual discovery only. This path deliberately returns no quality
   * quality labels; exact decisions come from persisted pairwise evidence.
   *
   * @param {Object} [opts]
   * @param {string} [opts.baseUrl] - Ollama URL override
   * @param {boolean} [opts.fullCycle=false] - Include L2 catalog candidates
   * @returns {Promise<{discovery: DiscoveryResult}>}
   */
  async checkForUpgrades(opts = {}) {
    const discovery = await discover({
      ...opts,
      includeCatalog: opts.fullCycle || false,
    });

    this._lastDiscovery = discovery;

    // v121.1: L4 Online Discovery (fullCycle only — same cadence as L2)
    // Use model name prefixes (library names) instead of logical families
    // because 'qwen3.5:27b' → library 'qwen3.5', not logical family 'qwen'
    if (opts.fullCycle && config.features?.onlineDiscovery) {
      try {
        const od = await _ensureOnlineDiscovery();
        if (od) {
          const { extractLibraryName } = await import('./model-metadata-estimator.js');
          const installedLibraryNames = [...new Set(
            discovery.candidates
              .filter(c => c.source === 'local')
              .map(c => extractLibraryName(c.name))
              .filter(Boolean)
          )];
          if (installedLibraryNames.length > 0) {
            const { CATALOG: catalogArr = [] } = await import('./model-catalog.js');
            const { MODEL_PROFILES } = await import('./model-profiles.js');
            const currentLibraryNames = [...new Set(
              Object.values(MODEL_PROFILES)
                .map(profile => profile?.getCurrentModel?.())
                .map(name => extractLibraryName(name))
                .filter(Boolean)
            )];
            const envSeedFamilies = String(process.env.C3_DISCOVERY_SEED_FAMILIES || '')
              .split(',')
              .map(s => s.trim())
              .filter(Boolean);
            const seedFamilies = [...new Set([...currentLibraryNames, ...envSeedFamilies])];
            // Pass GPU VRAM for pre-filtering oversized models
            let gpuVramMb = 0;
            try {
              const { getSystemProfile } = await import('../system/gpu-detector.js');
              const profile = await getSystemProfile();
              if (profile.gpus?.length > 0) {
                gpuVramMb = Math.max(...profile.gpus.map(g => g.vram_mb || 0));
              }
            } catch (_) {}
            const newEntries = await od.discoverForFamilies(installedLibraryNames, {
              catalog: catalogArr,
              gpuVramMb,
              currentFamilies: currentLibraryNames,
              seedFamilies,
            });
            if (newEntries.length > 0) {
              await od.persistEntries(newEntries);
              logger.info('UpgradeManager', `L4: discovered ${newEntries.length} new model variants`);
            }
            await od.pruneStale();
          }
        }
      } catch (err) {
        logger.warn('UpgradeManager', `L4 discovery failed: ${err.message}`);
      }

    }

    this._lastCheckTime = Date.now();
    this._modelHash = discovery.candidates.map(c => c.name).sort().join(',');

    logger.info('UpgradeManager', `Discovery refresh complete: ${discovery.candidates.length} candidates; no quality decision produced`, {
      ollamaAvailable: discovery.ollamaAvailable,
      hintsCount: discovery.hints.size,
      stats: discovery.stats,
    });

    return { discovery };
  }

  /**
   * Get last check results (without re-running discovery).
   * @returns {{discovery: DiscoveryResult|null}}
   */
  getLastResults() {
    return {
      discovery: this._lastDiscovery,
    };
  }

  /**
   * Get durable manual-binding history.
   * @returns {Array}
   */
  getHistory() {
    if (this._db) {
      try {
        return this._db.prepare(
          'SELECT role, from_model AS fromModel, to_model AS toModel, score, action, created_at AS timestamp FROM upgrade_history ORDER BY created_at DESC LIMIT 50'
        ).all();
      } catch (_) { /* fall through */ }
    }
    return [];
  }

  // ─── Lifecycle: Periodic Check + Ollama Poll ─────────────────────────────

  /**
   * Start background lifecycle: initial check + periodic recheck + model change poll.
   * v118: fullCycle (L2 catalog) every 24h with ±90min jitter.
   *
   * @param {Object} [opts]
   * @param {number} [opts.recheckMs=86400000] - Full cycle interval (default 24h)
   * @param {number} [opts.pollMs=300000] - Ollama poll interval (default 5min)
   * @param {string} [opts.baseUrl] - Ollama URL override
   * @param {number} [opts.jitterMs=5400000] - Full cycle jitter ±ms (default ±90min)
   */
  startPeriodicCheck(opts = {}) {
    if (this._active) return;
    this._active = true;

    const recheckMs = opts.recheckMs ?? 24 * 60 * 60 * 1000;
    const pollMs = opts.pollMs ?? 5 * 60 * 1000;
    const jitterMs = opts.jitterMs ?? 90 * 60 * 1000; // ±90min
    const checkOpts = { baseUrl: opts.baseUrl };

    // Initial check (L1 only, fire-and-forget)
    this.checkForUpgrades(checkOpts).catch(err =>
      logger.warn('UpgradeManager', `Startup check failed: ${err.message}`)
    );

    // Schedule first full cycle (L1+L2) with jitter
    const scheduleFullCycle = () => {
      const jitter = Math.round((Math.random() * 2 - 1) * jitterMs);
      const delay = recheckMs + jitter;
      this._recheckTimeout = setTimeout(() => {
        this.checkForUpgrades({ ...checkOpts, fullCycle: true }).catch(err =>
          logger.warn('UpgradeManager', `Full cycle failed: ${err.message}`)
        );
        scheduleFullCycle(); // Re-schedule next
      }, delay);
      this._recheckTimeout.unref();
    };
    scheduleFullCycle();

    // Ollama model change poll (5min default, L1 only)
    this._pollInterval = setInterval(() => {
      this._pollModelChanges(checkOpts).catch(() => {});
    }, pollMs);
    this._pollInterval.unref();

    logger.info('UpgradeManager', `Periodic check started (fullCycle: ${recheckMs / 3600000}h ±${jitterMs / 60000}min, poll: ${pollMs / 60000}min)`);
  }

  /**
   * Stop periodic checks.
   */
  stopPeriodicCheck() {
    if (this._recheckInterval) { clearInterval(this._recheckInterval); this._recheckInterval = null; }
    if (this._recheckTimeout) { clearTimeout(this._recheckTimeout); this._recheckTimeout = null; }
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
    this._active = false;
  }

  /**
   * Poll Ollama for model list changes. If the hash changed, re-run full check.
   * @param {Object} [opts]
   */
  async _pollModelChanges(opts = {}) {
    const models = await fetchInstalledModels(opts);
    if (models.length === 0) return; // Ollama not running — skip

    const hash = models.map(m => m.name).sort().join(',');
    if (this._modelHash !== null && hash !== this._modelHash) {
      logger.info('UpgradeManager', 'Ollama model list changed — re-checking upgrades');
      await this.checkForUpgrades(opts);
    } else if (this._modelHash === null) {
      // First poll, just store hash (initial discovery handles the snapshot)
      this._modelHash = hash;
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const upgradeManager = new UpgradeManager();

export default {
  UpgradeManager, upgradeManager,
};
