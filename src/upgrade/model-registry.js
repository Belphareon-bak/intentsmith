// ModelRegistry v133 — Centralized Model Management
// ══════════════════════════════════════════════════════════════════════════════
//
// Central inventory/deletion surface. Durable binding state and exact-contract
// evaluation state are injected authorities, not reconstructed from legacy
// last-value scoring tables.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { parseModelName } from './model-profiles.js';
import {
  canonicalModelName,
  canonicalModelNameSet,
  modelNameAliases,
  normalizeModelDigestSha256,
  sameModelName,
} from './model-identity.js';
import {
  MODEL_ACTIVITY_OWNER,
  modelUseAuthority,
} from './model-use-authority.js';
import { readModelAutomationPolicy } from '../db/model-policy.js';
import { resolveCurrentBindings } from './model-upgrade-prototype.js';
import { execSync } from 'child_process';
import fs from 'fs';

const OVERVIEW_CACHE_TTL = 30_000; // 30s
const DELETE_SOURCES = new Set(['USER_REQUEST', 'USER_HTTP', 'USER_CHAT', 'AUTO_CLEANUP']);
export const AUTO_CLEANUP_MIN_FREE_BYTES = 40 * 1_073_741_824;

function readModelStorageFreeBytes() {
  try {
    const stats = fs.statfsSync(config.ollama?.modelsPath || '/usr/share/ollama/.ollama/models');
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return Number.isSafeInteger(freeBytes) && freeBytes >= 0 ? freeBytes : null;
  } catch {
    return null;
  }
}

const ROLE_PROFILES = {
  D1:     { name: 'Hluboká analýza',   desc: 'Analýza, plánování, redesign. Vyžaduje reasoning + JSON.', suite: 'reasoning_v2', color: '#8b5cf6' },
  D2:     { name: 'Analýza oprav',     desc: 'Fokusovaný reasoning pro opravy a fix-loop.',              suite: 'reasoning_v2', color: '#a78bfa' },
  CODE:   { name: 'Generování kódu',   desc: 'Implementace, generování a editace kódu.',                 suite: 'code_patch',   color: '#22c55e' },
  R1:     { name: 'Hluboká revize',    desc: 'Finální deep review (stejný reasoning jako D1).',          suite: 'reasoning_v2', color: '#6366f1' },
  R2:     { name: 'Rychlá revize',     desc: 'Rychlý strukturální a logický check.',                     suite: 'review_v2',    color: '#818cf8' },
  CHAT:   { name: 'Konverzace',        desc: 'Uživatelská konverzace, čeština, syntéza.',                suite: 'chat_v3',      color: '#3b82f6' },
  VISION: { name: 'Analýza obrázků',   desc: 'Porozumění obrázkům a vizuálnímu obsahu. Vyžaduje vision.',suite: 'vision_v2',    color: '#f59e0b' },
};

function parseCleanupUtcTimestamp(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  let milliseconds = 0;
  if (!match) {
    match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(normalized);
    if (!match) return null;
    milliseconds = Number((match[7] || '').padEnd(3, '0').slice(0, 3));
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59) return null;
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const roundTrip = new Date(epochMs);
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour
    || roundTrip.getUTCMinutes() !== minute
    || roundTrip.getUTCSeconds() !== second
    || roundTrip.getUTCMilliseconds() !== milliseconds) return null;
  return epochMs;
}

export class ModelRegistryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelRegistryError';
    this.code = code;
    this.httpStatus = options.httpStatus || null;
    this.details = options.details || null;
  }
}

function registryFail(code, message, httpStatus, details = null) {
  throw new ModelRegistryError(code, message, { httpStatus, details });
}

function resolveInstalledArtifact(inventory, requestedName, expectations = {}) {
  const canonicalName = canonicalModelName(requestedName);
  if (!canonicalName) {
    registryFail('MODEL_DELETE_INPUT_INVALID', 'Model name is invalid', 400);
  }
  const matches = inventory.filter(model => canonicalModelName(model?.name) === canonicalName);
  if (matches.length === 0) {
    registryFail('MODEL_DELETE_NOT_INSTALLED', `Model není nainstalovaný: ${requestedName}`, 404);
  }
  if (matches.length !== 1) {
    registryFail(
      'MODEL_DELETE_IDENTITY_AMBIGUOUS',
      `Více modelů sdílí identitu: ${requestedName}`,
      409,
      { matches: matches.map(model => model?.name).filter(Boolean).sort() },
    );
  }

  const observed = matches[0];
  const exactName = typeof observed?.name === 'string' ? observed.name.trim() : '';
  const digestSha256 = observed?.digestSha256
    || normalizeModelDigestSha256(observed?.digest);
  if (!exactName || !digestSha256) {
    registryFail(
      'MODEL_DELETE_IDENTITY_INCOMPLETE',
      `Model nemá úplnou provider identitu: ${requestedName}`,
      409,
    );
  }
  if (expectations.exactName !== undefined && exactName !== expectations.exactName) {
    registryFail(
      'MODEL_DELETE_ARTIFACT_DRIFT',
      `Provider identity se změnila před odstraněním: ${requestedName}`,
      409,
      { expectedName: expectations.exactName, observedName: exactName },
    );
  }
  if (expectations.digestSha256 !== undefined
    && digestSha256 !== expectations.digestSha256) {
    registryFail(
      'MODEL_DELETE_ARTIFACT_DRIFT',
      `Provider digest se změnil před odstraněním: ${requestedName}`,
      409,
      {
        expectedDigestSha256: expectations.digestSha256,
        observedDigestSha256: digestSha256,
      },
    );
  }
  return Object.freeze({ exactName, canonicalName, digestSha256 });
}

export class ModelRegistry {
  constructor() {
    this._db = null;
    this._upgradeManager = null;
    this._modelBindingApplication = null;
    this._bindingRepository = null;
    this._bindingStartupAuthority = null;
    this._evaluationReadModel = null;
    this._broadcast = null;
    this._overviewCache = null;
    this._overviewCacheTime = 0;
    this._cleanupRunning = false;
    this._clock = Date.now;
    this._modelUseAuthority = modelUseAuthority;
    this._modelStorageFreeBytes = readModelStorageFreeBytes;
  }

  /** Wire dependencies (called once in server.js) */
  init({
    db,
    upgradeManager,
    modelBindingApplication,
    bindingRepository,
    bindingStartupAuthority,
    modelEvaluationReadModel,
    broadcast,
    clock,
    modelUseAuthority: injectedModelUseAuthority,
    modelStorageFreeBytes,
  }) {
    this._db = db;
    this._upgradeManager = upgradeManager;
    this._modelBindingApplication = modelBindingApplication || null;
    this._bindingRepository = bindingRepository || null;
    if (bindingStartupAuthority !== undefined && bindingStartupAuthority !== null) {
      const expectedRoles = Object.keys(ROLE_PROFILES).sort();
      const durableRoles = Array.isArray(bindingStartupAuthority?.roles)
        ? [...bindingStartupAuthority.roles].sort()
        : [];
      const validDurable = bindingStartupAuthority?.status === 'DURABLE'
        && durableRoles.length === expectedRoles.length
        && durableRoles.every((role, index) => role === expectedRoles[index])
        && expectedRoles.every(role => (
          typeof bindingStartupAuthority?.artifacts?.[role]?.modelName === 'string'
          && bindingStartupAuthority.artifacts[role].modelName.trim().length > 0
          && normalizeModelDigestSha256(
            bindingStartupAuthority.artifacts[role].digestSha256,
          ) !== null
        ));
      const validDegraded = bindingStartupAuthority?.status === 'DEGRADED'
        && typeof bindingStartupAuthority.reason === 'string'
        && bindingStartupAuthority.reason.length > 0
        && Array.isArray(bindingStartupAuthority.verifiedRoles)
        && Array.isArray(bindingStartupAuthority.failures);
      if (!validDurable && !validDegraded) {
        registryFail(
          'MODEL_BINDING_STARTUP_AUTHORITY_INVALID',
          'Model binding startup authority is invalid',
          503,
        );
      }
      this._bindingStartupAuthority = Object.freeze({
        status: bindingStartupAuthority.status,
        roles: Object.freeze(durableRoles),
        reason: bindingStartupAuthority.reason || null,
        verifiedRoles: Object.freeze([...(bindingStartupAuthority.verifiedRoles || [])]),
        failures: Object.freeze([...(bindingStartupAuthority.failures || [])]),
        artifacts: Object.freeze(Object.fromEntries(Object.entries(
          bindingStartupAuthority.artifacts || {},
        ).map(([role, artifact]) => [role, Object.freeze({
          modelName: artifact.modelName,
          digestSha256: normalizeModelDigestSha256(artifact.digestSha256),
        })]))),
      });
    } else {
      this._bindingStartupAuthority = null;
    }
    this._evaluationReadModel = modelEvaluationReadModel || null;
    this._broadcast = broadcast || (() => {});
    this._clock = typeof clock === 'function' ? clock : Date.now;
    this._modelUseAuthority = injectedModelUseAuthority || modelUseAuthority;
    this._modelStorageFreeBytes = typeof modelStorageFreeBytes === 'function'
      ? modelStorageFreeBytes
      : readModelStorageFreeBytes;
    if (typeof this._modelUseAuthority?.acquireShared !== 'function'
      || typeof this._modelUseAuthority?.acquireExclusive !== 'function') {
      registryFail(
        'MODEL_USE_AUTHORITY_REQUIRED',
        'Model use authority is unavailable',
        503,
      );
    }
  }

  #acquireDeleteLease(modelName) {
    try {
      return this._modelUseAuthority.acquireExclusive({
        modelName,
        owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
      });
    } catch (error) {
      if (error?.code === 'MODEL_MUTATION_ACTIVE_USE'
        || error?.code === 'MODEL_MUTATION_EXCLUSIVE_ACTIVE') {
        registryFail(
          'MODEL_DELETE_IN_USE',
          `Model je používán nebo měněn: ${modelName}`,
          409,
        );
      }
      throw error;
    }
  }

  // ─── Core Queries ──────────────────────────────────────────────────────────

  /** Get installed Ollama models with parsed metadata */
  async getInstalled(options = {}) {
    const strict = options?.strict === true;
    const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
    try {
      const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        if (strict) {
          registryFail(
            'MODEL_DELETE_INVENTORY_UNAVAILABLE',
            `Ollama inventory returned ${resp.status}`,
            503,
          );
        }
        return [];
      }
      const data = await resp.json();
      if (!data || typeof data !== 'object' || !Array.isArray(data.models)) {
        if (strict) {
          registryFail(
            'MODEL_DELETE_INVENTORY_UNAVAILABLE',
            'Ollama inventory has an invalid shape',
            503,
          );
        }
        return [];
      }
      return (data.models || []).map(m => {
        const parsed = parseModelName(m.name);
        return {
          name: m.name,
          size: m.size || 0,
          sizeGB: (m.size / 1_073_741_824).toFixed(1),
          modified_at: m.modified_at,
          digest: m.digest,
          digestSha256: normalizeModelDigestSha256(m.digest),
          params: parsed.params ? parsed.params + 'B' : '?',
          family: parsed.family,
          category: parsed.category,
          quantization: m.details?.quantization_level || parsed.quantization || '?',
        };
      });
    } catch (err) {
      if (err instanceof ModelRegistryError) throw err;
      logger.warn('ModelRegistry', `Ollama unavailable: ${err.message}`);
      if (strict) {
        throw new ModelRegistryError(
          'MODEL_DELETE_INVENTORY_UNAVAILABLE',
          'Ollama inventory is unavailable',
          { cause: err, httpStatus: 503 },
        );
      }
      return [];
    }
  }

  /** Get current role → model bindings */
  getBindingState(installedInput = null) {
    if (!this._bindingRepository) {
      return Object.freeze({
        status: 'BOOTSTRAP_FALLBACK',
        reason: 'MODEL_BINDING_REPOSITORY_UNAVAILABLE',
        bindings: Object.freeze({ ...config.models }),
        durable: Object.freeze({}),
        verifiedRoles: Object.freeze([]),
        failures: Object.freeze([]),
      });
    }
    try {
      const roles = Object.keys(ROLE_PROFILES).sort();
      const resolved = resolveCurrentBindings(
        config.models,
        this._bindingRepository,
        roles,
      );
      const durableCount = Object.keys(resolved.durable).length;
      const startupAuthority = this._bindingStartupAuthority;
      if (startupAuthority?.status === 'DEGRADED') {
        return Object.freeze({
          status: 'DEGRADED',
          reason: startupAuthority.reason || 'MODEL_BINDING_STARTUP_BASELINE_FAILED',
          // config.models is the runtime port observed during startup. Durable
          // rows remain audit evidence but must not replace a mismatched runtime
          // in the public projection.
          bindings: Object.freeze({ ...config.models }),
          durable: resolved.durable,
          artifacts: resolved.artifacts,
          verifiedRoles: Object.freeze([...(startupAuthority.verifiedRoles || [])]),
          failures: Object.freeze([...(startupAuthority.failures || [])]),
        });
      }

      const runtimeMatchesDurable = roles.every(role => (
        resolved.durable[role]
        && sameModelName(resolved.durable[role], config.models[role])
      ));
      if (startupAuthority?.status === 'DURABLE'
        && durableCount === roles.length
        && runtimeMatchesDurable) {
        const inventory = Array.isArray(installedInput) ? installedInput : null;
        const failures = [];
        for (const role of roles) {
          const expected = resolved.artifacts[role];
          const matches = inventory?.filter(row => sameModelName(row?.name, expected.modelName)) || [];
          const observedDigest = matches.length === 1
            ? normalizeModelDigestSha256(matches[0]?.digestSha256 || matches[0]?.digest)
            : null;
          if (!inventory) {
            failures.push(Object.freeze({
              role,
              code: 'MODEL_BINDING_RUNTIME_ARTIFACT_UNVERIFIED',
            }));
          } else if (matches.length !== 1 || observedDigest !== expected.digestSha256) {
            failures.push(Object.freeze({
              role,
              code: matches.length !== 1
                ? 'MODEL_BINDING_RUNTIME_ARTIFACT_UNRESOLVED'
                : 'MODEL_BINDING_RUNTIME_ARTIFACT_DRIFT',
              expectedDigestSha256: expected.digestSha256,
              observedDigestSha256: observedDigest,
            }));
          }
        }
        if (failures.length > 0) {
          const verifiedRoles = roles.filter(role => (
            !failures.some(failure => failure.role === role)
          ));
          return Object.freeze({
            status: 'DEGRADED',
            reason: inventory
              ? 'MODEL_BINDING_RUNTIME_ARTIFACT_DRIFT'
              : 'MODEL_BINDING_RUNTIME_ARTIFACT_UNVERIFIED',
            bindings: resolved.bindings,
            durable: resolved.durable,
            artifacts: resolved.artifacts,
            verifiedRoles: Object.freeze(verifiedRoles),
            failures: Object.freeze(failures),
          });
        }
        return Object.freeze({
          status: 'DURABLE',
          reason: null,
          bindings: resolved.bindings,
          durable: resolved.durable,
          artifacts: resolved.artifacts,
          verifiedRoles: Object.freeze([...roles]),
          failures: Object.freeze([]),
        });
      }

      return Object.freeze({
        status: startupAuthority?.status === 'DURABLE'
          ? 'DEGRADED'
          : 'UNVERIFIED_RUNTIME',
        reason: startupAuthority?.status === 'DURABLE'
          ? 'MODEL_BINDING_RUNTIME_STATE_CHANGED'
          : 'MODEL_BINDING_RUNTIME_NOT_OBSERVED',
        bindings: Object.freeze({ ...config.models }),
        durable: resolved.durable,
        artifacts: resolved.artifacts,
        verifiedRoles: Object.freeze([]),
        failures: Object.freeze([]),
      });
    } catch (error) {
      throw new ModelRegistryError(
        'MODEL_BINDING_READ_FAILED',
        `Durable model binding read failed: ${error.message}`,
        { cause: error, httpStatus: 503 },
      );
    }
  }

  getBound() {
    return this.getBindingState().bindings;
  }

  /** Get which roles a model is bound to */
  getBoundRoles(modelName) {
    const roles = [];
    for (const [role, model] of Object.entries(this.getBound())) {
      if (sameModelName(model, modelName)) roles.push(role);
    }
    return roles;
  }

  /** Check if model is bound to any role */
  isBound(modelName) {
    return Object.values(this.getBound()).some(model => sameModelName(model, modelName));
  }

  /** Check if model can be deleted */
  isDeletable(modelName) {
    const blocked = this.#getDeleteBlock(modelName);
    return blocked
      ? { deletable: false, reason: blocked.message, code: blocked.code }
      : { deletable: true, reason: null, code: null };
  }

  getModelSettings() {
    // Decision 020/E: automation policy has its own authority. The shape stays
    // compatible with the previous reader so consumers do not have to branch.
    const state = readModelAutomationPolicy(this._db);
    return {
      status: state.status,
      valid: state.valid,
      settings: state.policy,
      reason: state.reason,
    };
  }

  /** Get last usage info for a model */
  getUsage(modelName, digestValue = null) {
    if (!this._db) {
      return {
        lastUsedAt: null,
        lastUsedAtMs: null,
        requestCount: 0,
        retentionValid: false,
        reason: 'MODEL_USAGE_DB_UNAVAILABLE',
      };
    }
    const aliases = modelNameAliases(modelName);
    const digestSha256 = normalizeModelDigestSha256(digestValue);
    if (aliases.length === 0) {
      return {
        lastUsedAt: null,
        lastUsedAtMs: null,
        requestCount: 0,
        retentionValid: false,
        reason: 'MODEL_USAGE_IDENTITY_INVALID',
      };
    }
    try {
      const placeholders = aliases.map(() => '?').join(', ');
      const rows = this._db.prepare(
        `SELECT used_at, model_digest_sha256
         FROM model_usage
         WHERE lower(trim(model)) IN (${placeholders})`
      ).all(...aliases);
      let newest = null;
      for (const row of rows) {
        // Name-only historical usage cannot prove which mutable tag artifact
        // served the request. Preserve it as a deletion block instead of
        // guessing that it belongs to either the old or current digest.
        if (digestSha256 && !row?.model_digest_sha256) {
          return {
            lastUsedAt: null,
            lastUsedAtMs: null,
            requestCount: rows.length,
            retentionValid: false,
            reason: 'MODEL_USAGE_DIGEST_UNKNOWN',
          };
        }
        if (digestSha256 && row.model_digest_sha256 !== digestSha256) continue;
        const epochMs = parseCleanupUtcTimestamp(row?.used_at);
        if (epochMs === null) {
          return {
            lastUsedAt: null,
            lastUsedAtMs: null,
            requestCount: rows.length,
            retentionValid: false,
            reason: 'MODEL_USAGE_TIMESTAMP_INVALID',
          };
        }
        if (!newest || epochMs > newest.epochMs) {
          newest = { value: row.used_at, epochMs };
        }
      }
      return {
        lastUsedAt: newest?.value || null,
        lastUsedAtMs: newest?.epochMs ?? null,
        requestCount: rows.length,
        retentionValid: true,
        reason: null,
      };
    } catch (_) {
      return {
        lastUsedAt: null,
        lastUsedAtMs: null,
        requestCount: 0,
        retentionValid: false,
        reason: 'MODEL_USAGE_DB_READ_FAILED',
      };
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  async getEvaluations(installedInput = null) {
    if (!this._evaluationReadModel || typeof this._evaluationReadModel.read !== 'function') {
      registryFail(
        'MODEL_EVALUATION_READ_AUTHORITY_REQUIRED',
        'Model evaluation read authority is unavailable',
        503,
      );
    }
    const installed = installedInput || await this.getInstalled();
    const bindingState = this.getBindingState(installed);
    return this._evaluationReadModel.read({
      inventory: installed,
      bindings: bindingState.bindings,
      bindingAuthority: {
        status: bindingState.status,
        durableRoles: Object.keys(bindingState.durable).sort(),
        verifiedRoles: bindingState.verifiedRoles,
        reason: bindingState.reason,
        failures: bindingState.failures,
      },
    });
  }

  /** Full consolidated overview (cached 30s) */
  async getOverview() {
    const now = Date.now();
    if (this._overviewCache && (now - this._overviewCacheTime) < OVERVIEW_CACHE_TTL) {
      return this._overviewCache;
    }

    const installed = await this.getInstalled();
    const evaluations = await this.getEvaluations(installed);
    const bindings = evaluations.bindings;
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

    // Auto-cleanup is enabled only by the authoritative JSON settings row.
    const modelSettings = this.getModelSettings();
    const autoCleanup = {
      enabled: modelSettings.valid && modelSettings.settings.autoCleanupEnabled,
      days: modelSettings.settings.autoCleanupDays,
    };

    const evaluationByModel = new Map(
      evaluations.models.map(model => [model.canonicalName, model.evaluations]),
    );
    let incompleteEvaluationCount = 0;
    const models = installed.map(m => {
      const boundRoles = Object.entries(bindings)
        .filter(([, model]) => sameModelName(model, m.name))
        .map(([role]) => role);
      const { deletable, reason } = this.isDeletable(m.name);
      const modelEvaluations = evaluationByModel.get(canonicalModelName(m.name)) || {};
      const usage = this.getUsage(m.name, m.digestSha256);
      const missingEvaluationRoles = Object.entries(modelEvaluations)
        .filter(([, row]) => row.status !== 'COMPLETE')
        .map(([role]) => role);
      if (missingEvaluationRoles.length > 0) incompleteEvaluationCount++;

      return {
        name: m.name,
        canonicalName: canonicalModelName(m.name),
        digestSha256: m.digestSha256,
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
        evaluations: modelEvaluations,
        evaluatedRoleCount: Object.values(modelEvaluations)
          .filter(row => row.status === 'COMPLETE').length,
        missingEvaluationRoles,
      };
    });

    const result = {
      models,
      bindings,
      profiles: ROLE_PROFILES,
      diskUsage,
      autoCleanup,
      evaluations: {
        authority: evaluations.authority,
        bindingAuthority: evaluations.bindingAuthority,
        statusCounts: evaluations.statusCounts,
        roles: evaluations.roles,
        decisions: evaluations.decisions,
      },
      incompleteEvaluationCount,
      ollamaAvailable,
    };

    this._overviewCache = result;
    this._overviewCacheTime = now;
    return result;
  }

  /** Get models that can be deleted */
  getDeletable() {
    // Uses cached overview if available
    if (this._overviewCache) {
      return this._overviewCache.models
        .filter(m => m.isDeletable)
        .map(m => ({ name: m.name, size: m.size, sizeGB: m.sizeGB }));
    }
    return [];
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  #getDeleteBlock(name) {
    if (!canonicalModelName(name)) {
      return {
        code: 'MODEL_DELETE_INPUT_INVALID',
        message: 'Model name is invalid',
        httpStatus: 400,
      };
    }
    if (this.isBound(name)) {
      const roles = this.getBoundRoles(name).join(', ');
      return {
        code: 'MODEL_DELETE_BOUND',
        message: `Model je přiřazený k rolím: ${roles}`,
        httpStatus: 409,
      };
    }
    if (typeof this._modelBindingApplication?.getProtectedModelNames !== 'function') {
      return {
        code: 'MODEL_DELETE_AUTHORITY_REQUIRED',
        message: 'Model binding protection authority is unavailable',
        httpStatus: 503,
      };
    }
    let protectedNames;
    try {
      protectedNames = this._modelBindingApplication.getProtectedModelNames();
    } catch {
      return {
        code: 'MODEL_DELETE_AUTHORITY_REQUIRED',
        message: 'Model binding protection authority is unavailable',
        httpStatus: 503,
      };
    }
    if (!Array.isArray(protectedNames)) {
      return {
        code: 'MODEL_DELETE_AUTHORITY_REQUIRED',
        message: 'Model binding protection authority returned an invalid result',
        httpStatus: 503,
      };
    }
    if (protectedNames.some(protectedName => sameModelName(protectedName, name))) {
      return {
        code: 'MODEL_DELETE_BINDING_PROTECTED',
        message: 'Model je chráněn aktivním, požadovaným nebo rollback bindingem',
        httpStatus: 409,
      };
    }
    return null;
  }

  #assertDeleteAllowed(name) {
    const blocked = this.#getDeleteBlock(name);
    if (blocked) {
      registryFail(blocked.code, blocked.message, blocked.httpStatus);
    }
  }

  /** Build a bounded, exact artifact preview without performing deletion. */
  async prepareDeletePlans(names) {
    if (!Array.isArray(names) || names.length < 1 || names.length > 50) {
      registryFail('MODEL_DELETE_INPUT_INVALID', 'Model delete preview is invalid', 400);
    }
    const requested = [];
    const seen = new Set();
    for (const name of names) {
      const canonical = canonicalModelName(name);
      if (!canonical) {
        registryFail('MODEL_DELETE_INPUT_INVALID', 'Model delete preview contains an invalid name', 400);
      }
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      requested.push(String(name).trim());
    }
    // Protection is cheaper and more authoritative than provider discovery.
    // A rollback-bound candidate must fail before even a read effect.
    for (const name of requested) this.#assertDeleteAllowed(name);
    const inventory = await this.getInstalled({ strict: true });
    const plans = requested.map(name => {
      const artifact = resolveInstalledArtifact(inventory, name);
      return Object.freeze({
        exactName: artifact.exactName,
        canonicalName: artifact.canonicalName,
        digestSha256: artifact.digestSha256,
      });
    });
    return Object.freeze(plans);
  }

  /** Delete one exact artifact through the binding application's mutation owner. */
  async deleteModel(name, options = {}) {
    if (typeof name !== 'string' || !canonicalModelName(name)) {
      registryFail('MODEL_DELETE_INPUT_INVALID', 'Model name is invalid', 400);
    }
    const optionKeys = Object.keys(options || {});
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || optionKeys.some(key => !['source', 'expectedDigestSha256'].includes(key))) {
      registryFail('MODEL_DELETE_INPUT_INVALID', 'Model delete options are invalid', 400);
    }
    const source = options.source || 'USER_REQUEST';
    if (!DELETE_SOURCES.has(source)) {
      registryFail('MODEL_DELETE_INPUT_INVALID', 'Model delete source is invalid', 400);
    }
    const expectedDigestSha256 = options.expectedDigestSha256 === undefined
      ? undefined
      : normalizeModelDigestSha256(options.expectedDigestSha256);
    if (options.expectedDigestSha256 !== undefined && !expectedDigestSha256) {
      registryFail('MODEL_DELETE_INPUT_INVALID', 'Expected model digest is invalid', 400);
    }
    if (typeof this._modelBindingApplication?.runExclusiveModelMutation !== 'function') {
      registryFail(
        'MODEL_DELETE_AUTHORITY_REQUIRED',
        'Model mutation authority is unavailable',
        503,
      );
    }

    return this._modelBindingApplication.runExclusiveModelMutation(
      { kind: 'MODEL_DELETE' },
      async () => {
        const deleteLease = this.#acquireDeleteLease(name);
        try {
          this.#assertDeleteAllowed(name);
          const firstInventory = await this.getInstalled({ strict: true });
          const planned = resolveInstalledArtifact(firstInventory, name, {
            digestSha256: expectedDigestSha256,
          });
          this.#assertDeleteAllowed(name);
          const secondInventory = await this.getInstalled({ strict: true });
          const observed = resolveInstalledArtifact(secondInventory, planned.exactName, {
            exactName: planned.exactName,
            digestSha256: planned.digestSha256,
          });
          this.#assertDeleteAllowed(observed.exactName);

          const observedModel = secondInventory.find(model => (
            model.name === observed.exactName
            && (model.digestSha256 || normalizeModelDigestSha256(model.digest))
              === observed.digestSha256
          ));
          const freedGB = observedModel?.sizeGB || '?';

          const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
          let resp;
          try {
            resp = await fetch(`${baseUrl}/api/delete`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: observed.exactName }),
              redirect: 'error',
              signal: AbortSignal.timeout(30_000),
            });
          } catch (error) {
            throw new ModelRegistryError(
              'MODEL_DELETE_PROVIDER_UNAVAILABLE',
              `Ollama delete není dostupný pro ${observed.exactName}`,
              { cause: error, httpStatus: 503 },
            );
          }
          if (!resp?.ok) {
            registryFail('MODEL_DELETE_PROVIDER_FAILED', `Ollama vrátil ${resp?.status ?? 'unknown'}`, 502);
          }

          this.invalidateCache();

          const result = Object.freeze({
            ok: true,
            deleted: observed.exactName,
            canonicalName: observed.canonicalName,
            digestSha256: observed.digestSha256,
            source,
            freedGB,
          });
          this._broadcast('control', {
            action: 'model_deleted',
            model: observed.exactName,
            freedGB,
          });
          logger.info(
            'ModelRegistry',
            `Deleted model: ${observed.exactName} digest=${observed.digestSha256} source=${source} (freed ~${freedGB} GB)`,
          );

          return result;
        } finally {
          deleteLease.release();
        }
      },
    );
  }

  /** Assign model to role through the single manual binding application port. */
  async assignModel(role, model, opts = {}) {
    if (!this._modelBindingApplication) {
      const error = new Error('Model binding application service is required');
      error.code = 'MODEL_BINDING_APPLICATION_SERVICE_REQUIRED';
      throw error;
    }
    const result = await this._modelBindingApplication.applyManualBinding({
      role,
      targetModel: model,
    });
    this.invalidateCache();
    return result;
  }

  // ─── Auto-Cleanup ──────────────────────────────────────────────────────────

  /** Run auto-cleanup of unused models older than `days` */
  async runAutoCleanup(days = 14) {
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      registryFail('MODEL_CLEANUP_RETENTION_INVALID', 'Cleanup retention days are invalid', 400);
    }
    if (this._cleanupRunning) {
      registryFail('MODEL_CLEANUP_BUSY', 'Model cleanup is already running', 409);
    }
    this._cleanupRunning = true;
    try {
      const now = this._clock();
      if (!Number.isSafeInteger(now) || now < 1) {
        registryFail('MODEL_CLEANUP_CLOCK_INVALID', 'Cleanup clock is invalid', 500);
      }
      // Retention is pressure relief, not routine churn. A failed or ambiguous
      // disk measurement must keep every artifact.
      let freeBytes = this._modelStorageFreeBytes();
      if (!Number.isSafeInteger(freeBytes) || freeBytes < 0
        || freeBytes >= AUTO_CLEANUP_MIN_FREE_BYTES) return [];
      const installed = await this.getInstalled({ strict: true });
      const boundModels = canonicalModelNameSet(Object.values(this.getBound()));
      const cutoffMs = now - days * 86400000;
      const deleted = [];
      const seenCanonical = new Set();

      for (const m of installed) {
        if (freeBytes >= AUTO_CLEANUP_MIN_FREE_BYTES) break;
        const canonicalName = canonicalModelName(m.name);
        if (!canonicalName || seenCanonical.has(canonicalName)) continue;
        seenCanonical.add(canonicalName);
        // Skip bound models
        if (boundModels.has(canonicalName)) continue;
        // Retention is fail-closed. Every stored usage timestamp must parse as
        // explicit UTC and provider modification time remains a second
        // protection even when historical usage exists.
        const usage = this.getUsage(m.name, m.digestSha256 || m.digest);
        if (!usage.retentionValid) continue;
        // COMPLETE digest-bound scoring below is authoritative evidence that a
        // downloaded candidate finished its purpose even when it never served
        // a gateway request. With no usage rows, provider modified_at remains
        // the grace-period clock; malformed or unreadable usage still fails
        // closed through retentionValid.
        if (usage.lastUsedAtMs !== null && usage.lastUsedAtMs >= cutoffMs) continue;
        const modifiedAtMs = parseCleanupUtcTimestamp(m.modified_at);
        if (modifiedAtMs === null || modifiedAtMs >= cutoffMs) continue;
        const digestSha256 = m.digestSha256 || normalizeModelDigestSha256(m.digest);
        if (!digestSha256) continue;
        // An unfinished, blocked, failed or inconclusive role evaluation is
        // precisely the artifact most likely to be needed by the next hunt
        // tick. Retention therefore requires COMPLETE evidence for every
        // current role contract, never merely one historical score.
        try {
          const evaluation = this._evaluationReadModel.read({
            inventory: [m],
            bindings: this.getBound(),
          }).models[0];
          if (!evaluation
            || Object.values(evaluation.evaluations).some(row => row.status !== 'COMPLETE')) {
            continue;
          }
        } catch {
          continue;
        }

        try {
          const result = await this.deleteModel(m.name, {
            source: 'AUTO_CLEANUP',
            expectedDigestSha256: digestSha256,
          });
          deleted.push({
            model: result.deleted,
            freedGB: result.freedGB,
          });
          const artifactBytes = Number(m.size);
          if (Number.isSafeInteger(artifactBytes) && artifactBytes > 0) {
            freeBytes = Math.min(Number.MAX_SAFE_INTEGER, freeBytes + artifactBytes);
          }
          this._broadcast('control', {
            action: 'model_auto_cleaned',
            model: result.deleted,
            freedGB: result.freedGB,
          });
        } catch (err) {
          logger.warn('ModelRegistry', `Auto-cleanup failed for ${m.name}: ${err.message}`);
        }
      }

      if (deleted.length > 0) {
        logger.info('ModelRegistry', `Auto-cleanup: deleted ${deleted.length} models`, { deleted });
      }
      return deleted;
    } finally {
      this._cleanupRunning = false;
    }
  }

  /** Execute one scheduler decision from the authoritative JSON settings row. */
  async runConfiguredAutoCleanup() {
    const settings = this.getModelSettings();
    if (!settings.valid) {
      return Object.freeze({
        status: 'SKIPPED_INVALID_SETTINGS',
        reason: settings.reason,
        deleted: Object.freeze([]),
      });
    }
    if (settings.settings.autoCleanupEnabled !== true) {
      return Object.freeze({
        status: 'SKIPPED_DISABLED',
        reason: 'AUTO_CLEANUP_DISABLED',
        deleted: Object.freeze([]),
      });
    }
    const deleted = await this.runAutoCleanup(settings.settings.autoCleanupDays);
    return Object.freeze({
      status: 'COMPLETED',
      days: settings.settings.autoCleanupDays,
      deleted: Object.freeze([...deleted]),
    });
  }

  // ─── Binding Integrity Check ───────────────────────────────────────────────

  /** Detect missing bindings without changing configuration or broadcasting. */
  async checkBindingIntegrity() {
    const checkedAt = new Date().toISOString();
    try {
      const installed = await this.getInstalled();
      if (installed.length === 0) {
        return {
          schemaVersion: 1,
          scanStatus: 'INCONCLUSIVE',
          reason: 'OLLAMA_UNAVAILABLE_OR_EMPTY',
          checkedAt,
          installedCount: 0,
          findings: [],
        };
      }

      const findings = [];

      for (const [role, model] of Object.entries(this.getBound()).sort(([a], [b]) => a.localeCompare(b))) {
        if (installed.some(entry => sameModelName(entry.name, model))) continue;
        findings.push({
          role,
          configuredModel: model,
          state: 'DETECTED',
          reason: 'BOUND_MODEL_NOT_INSTALLED',
          candidate: null,
        });
        logger.warn(
          'ModelRegistry',
          `Model ${model} missing for ${role}; no audited replacement decision is available`,
        );
      }

      return {
        schemaVersion: 1,
        scanStatus: 'COMPLETE',
        reason: null,
        checkedAt,
        installedCount: installed.length,
        findings,
      };
    } catch (err) {
      logger.warn('ModelRegistry', `Integrity check failed: ${err.message}`);
      return {
        schemaVersion: 1,
        scanStatus: 'INCONCLUSIVE',
        reason: 'INTEGRITY_SCAN_FAILED',
        checkedAt,
        installedCount: null,
        findings: [],
      };
    }
  }

  /** Invalidate overview cache */
  invalidateCache() {
    this._overviewCache = null;
    this._overviewCacheTime = 0;
  }
}

export const modelRegistry = new ModelRegistry();
export { ROLE_PROFILES };
export default modelRegistry;
