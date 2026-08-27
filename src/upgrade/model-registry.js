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
import { requireLoopbackModelProviderOrigin } from './model-provider-origin.js';
import { readModelAutomationPolicy } from '../db/model-policy.js';
import { execSync } from 'child_process';
import fs from 'fs';

const VALIDATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const OVERVIEW_CACHE_TTL = 30_000; // 30s
const SUITES = ['reasoning', 'code', 'chat', 'vision', 'review'];
const DELETE_SOURCES = new Set(['USER_REQUEST', 'USER_HTTP', 'USER_CHAT', 'AUTO_CLEANUP']);

const ROLE_PROFILES = {
  D1:     { name: 'Hluboká analýza',   desc: 'Analýza, plánování, redesign. Vyžaduje reasoning + JSON.', suite: 'reasoning', color: '#8b5cf6' },
  D2:     { name: 'Analýza oprav',     desc: 'Fokusovaný reasoning pro opravy a fix-loop.',              suite: 'reasoning', color: '#a78bfa' },
  CODE:   { name: 'Generování kódu',   desc: 'Implementace, generování a editace kódu.',                 suite: 'code',      color: '#22c55e' },
  R1:     { name: 'Hluboká revize',    desc: 'Finální deep review (stejný reasoning jako D1).',          suite: 'reasoning', color: '#6366f1' },
  R2:     { name: 'Rychlá revize',     desc: 'Rychlý strukturální a logický check.',                     suite: 'review',    color: '#818cf8' },
  CHAT:   { name: 'Konverzace',        desc: 'Uživatelská konverzace, čeština, syntéza.',                suite: 'chat',      color: '#3b82f6' },
  VISION: { name: 'Analýza obrázků',   desc: 'Porozumění obrázkům a vizuálnímu obsahu. Vyžaduje vision.',suite: 'vision',    color: '#f59e0b' },
};

function parseValidationTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function normalizeValidationScore(value) {
  if (value && typeof value === 'object') {
    return {
      score: Number.isFinite(value.score) ? value.score : null,
      updatedAt: value.validatedAt || value.updatedAt || null,
    };
  }
  return { score: Number.isFinite(value) ? value : null, updatedAt: null };
}

function shouldReplaceValidationScore(current, candidate) {
  if (!current) return true;
  const currentTime = parseValidationTimestamp(current.updatedAt);
  const candidateTime = parseValidationTimestamp(candidate.updatedAt);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidate.sourcePriority !== current.sourcePriority) {
    return candidate.sourcePriority > current.sourcePriority;
  }
  if (candidate.sourceModel !== current.sourceModel) {
    return candidate.sourceModel < current.sourceModel;
  }
  return candidate.score > current.score;
}

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
    this._validationRunner = null;
    this._broadcast = null;
    this._overviewCache = null;
    this._overviewCacheTime = 0;
    this._batchRunning = false;
    this._batchCancelled = false;
    this._validatingModel = null;
    this._cleanupRunning = false;
    this._clock = Date.now;
    this._modelUseAuthority = modelUseAuthority;
    this._modelArtifactAuthorityRepository = null;
    this._requireDurableModelUseAuthority = false;
  }

  /** Wire dependencies (called once in server.js) */
  init({
    db,
    upgradeManager,
    modelBindingApplication,
    validationRunner,
    broadcast,
    clock,
    modelUseAuthority: injectedModelUseAuthority,
    modelArtifactAuthorityRepository,
    requireDurableModelUseAuthority = false,
  }) {
    this._db = db;
    this._upgradeManager = upgradeManager;
    this._modelBindingApplication = modelBindingApplication || null;
    this._validationRunner = validationRunner;
    this._broadcast = broadcast || (() => {});
    this._clock = typeof clock === 'function' ? clock : Date.now;
    this._modelUseAuthority = injectedModelUseAuthority || modelUseAuthority;
    this._modelArtifactAuthorityRepository = modelArtifactAuthorityRepository || null;
    this._requireDurableModelUseAuthority = requireDurableModelUseAuthority === true;
    if (typeof this._modelUseAuthority?.acquireShared !== 'function'
      || typeof this._modelUseAuthority?.acquireExclusive !== 'function') {
      registryFail(
        'MODEL_USE_AUTHORITY_REQUIRED',
        'Model use authority is unavailable',
        503,
      );
    }
    if (this._requireDurableModelUseAuthority) {
      if (this._modelUseAuthority.durable !== true
        || typeof this._modelArtifactAuthorityRepository?.recordIntent !== 'function'
        || typeof this._modelArtifactAuthorityRepository?.recordOutcome !== 'function') {
        registryFail(
          'MODEL_ARTIFACT_DURABLE_AUTHORITY_REQUIRED',
          'Durable model artifact authority is unavailable',
          503,
        );
      }
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
        && error?.details?.activeOwners?.includes(MODEL_ACTIVITY_OWNER.MODEL_VALIDATION)) {
        registryFail(
          'MODEL_DELETE_VALIDATING',
          `Model právě prochází validací: ${modelName}`,
          409,
        );
      }
      if (error?.code === 'MODEL_MUTATION_ACTIVE_USE'
        || error?.code === 'MODEL_MUTATION_EXCLUSIVE_ACTIVE') {
        registryFail(
          'MODEL_DELETE_IN_USE',
          `Model je používán nebo měněn: ${modelName}`,
          409,
        );
      }
      if (error?.code === 'MODEL_ARTIFACT_OUTCOME_UNRESOLVED') {
        registryFail(
          'MODEL_DELETE_OUTCOME_UNRESOLVED',
          `Předchozí provider efekt nemá potvrzený výsledek: ${modelName}`,
          503,
          error.details,
        );
      }
      throw error;
    }
  }

  #acquireValidationLease(modelName) {
    try {
      return this._modelUseAuthority.acquireShared({
        modelName,
        owner: MODEL_ACTIVITY_OWNER.MODEL_VALIDATION,
      });
    } catch (error) {
      if (error?.code === 'MODEL_USE_EXCLUSIVE_ACTIVE') {
        registryFail(
          'MODEL_VALIDATION_MODEL_MUTATING',
          `Model je právě měněn: ${modelName}`,
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
    const baseUrl = options?.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
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
      if (sameModelName(model, modelName)) roles.push(role);
    }
    return roles;
  }

  /** Check if model is bound to any role */
  isBound(modelName) {
    return Object.values(config.models).some(model => sameModelName(model, modelName));
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

  /** Get validation scores for a model across all suites */
  getValidationScores(modelName) {
    const key = canonicalModelName(modelName);
    if (!key) return {};
    const consolidated = this.getAllValidationScores()[key] || {};
    return Object.fromEntries(SUITES.map(suite => [suite, consolidated[suite] || null]));
  }

  /** Get all validation scores for all models */
  getAllValidationScores() {
    try {
      const selected = new Map();
      const aliasesByScore = new Map();
      const consider = ({ model, suite, score, updatedAt, sourcePriority }) => {
        const key = canonicalModelName(model);
        if (!key || !suite || !Number.isFinite(score)) return;
        const selectionKey = `${key}\0${suite}`;
        const candidate = {
          score,
          updatedAt: updatedAt || null,
          sourceModel: String(model),
          sourcePriority,
        };
        if (shouldReplaceValidationScore(selected.get(selectionKey), candidate)) {
          selected.set(selectionKey, candidate);
        }
        if (!aliasesByScore.has(selectionKey)) aliasesByScore.set(selectionKey, new Set());
        aliasesByScore.get(selectionKey).add(String(model));
      };

      if (this._validationRunner?.getAllScores) {
        const allScores = this._validationRunner.getAllScores();
        for (const [model, suiteScores] of allScores || []) {
          for (const [suite, rawScore] of Object.entries(suiteScores || {})) {
            const normalized = normalizeValidationScore(rawScore);
            consider({ model, suite, ...normalized, sourcePriority: 0 });
          }
        }
      }

      if (this._db) {
        try {
          const rows = this._db.prepare(
            'SELECT model, suite, score, validated_at FROM validation_suite_scores'
          ).all();
          for (const r of rows) {
            consider({
              model: r.model,
              suite: r.suite,
              score: r.score,
              updatedAt: r.validated_at,
              sourcePriority: 1,
            });
          }
        } catch (_) {}
      }

      const result = {};
      const now = Date.now();
      for (const [selectionKey, score] of [...selected.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        const [model, suite] = selectionKey.split('\0');
        if (!result[model]) result[model] = {};
        const aliases = [...(aliasesByScore.get(selectionKey) || [])].sort();
        result[model][suite] = {
          score: score.score,
          updatedAt: score.updatedAt,
          expired: score.updatedAt
            ? (now - parseValidationTimestamp(score.updatedAt)) > VALIDATION_TTL_MS
            : true,
          sourceModel: score.sourceModel,
          identityAliases: aliases,
          identityAmbiguous: aliases.length > 1,
          artifactVerified: false,
        };
      }
      return result;
    } catch (_) {
      return {};
    }
  }

  /** Get last usage info for a model */
  getUsage(modelName) {
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
        `SELECT used_at
         FROM model_usage
         WHERE lower(trim(model)) IN (${placeholders})`
      ).all(...aliases);
      let newest = null;
      for (const row of rows) {
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

    // Auto-cleanup is enabled only by the authoritative JSON settings row.
    const modelSettings = this.getModelSettings();
    const autoCleanup = {
      enabled: modelSettings.valid && modelSettings.settings.autoCleanupEnabled,
      days: modelSettings.settings.autoCleanupDays,
    };

    let unvalidatedCount = 0;
    const models = installed.map(m => {
      const boundRoles = this.getBoundRoles(m.name);
      const { deletable, reason } = this.isDeletable(m.name);
      const vs = allScores[canonicalModelName(m.name)] || {};
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
    const currentKey = canonicalModelName(current);
    const currentScore = allScores[currentKey]?.[suite]?.score ?? -1;

    for (const [model, scores] of Object.entries(allScores).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (model === currentKey) continue;
      const s = scores[suite]?.score;
      if (s != null && s > bestScore) {
        bestScore = s;
        best = scores[suite]?.sourceModel || model;
      }
    }

    if (best && bestScore > currentScore) {
      const delta = currentScore >= 0 ? Math.round((bestScore - currentScore) * 100) : null;
      return { model: best, score: bestScore, delta };
    }
    return null;
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
    if (sameModelName(this._validatingModel, name)) {
      return {
        code: 'MODEL_DELETE_VALIDATING',
        message: 'Model je právě validován',
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
    let provider;
    try {
      provider = requireLoopbackModelProviderOrigin(
        config.ollama?.baseUrl || 'http://127.0.0.1:11434',
      );
    } catch (error) {
      registryFail(
        'MODEL_DELETE_PROVIDER_SCOPE_UNSUPPORTED',
        error.message,
        403,
        { causeCode: error.code || null },
      );
    }

    return this._modelBindingApplication.runExclusiveModelMutation(
      { kind: 'MODEL_DELETE' },
      async () => {
        const deleteLease = this.#acquireDeleteLease(name);
        try {
          this.#assertDeleteAllowed(name);
          const firstInventory = await this.getInstalled({ strict: true, baseUrl: provider.origin });
          const planned = resolveInstalledArtifact(firstInventory, name, {
            digestSha256: expectedDigestSha256,
          });
          this.#assertDeleteAllowed(name);
          const secondInventory = await this.getInstalled({ strict: true, baseUrl: provider.origin });
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

          let operationId = null;
          if (this._modelArtifactAuthorityRepository) {
            if (typeof deleteLease.claimId !== 'string') {
              registryFail(
                'MODEL_ARTIFACT_DURABLE_AUTHORITY_REQUIRED',
                'Durable delete claim is unavailable',
                503,
              );
            }
            operationId = this._modelArtifactAuthorityRepository.recordIntent({
              claimId: deleteLease.claimId,
              kind: 'DELETE',
              exactName: observed.exactName,
              canonicalName: observed.canonicalName,
              digestSha256: observed.digestSha256,
              source,
              providerOrigin: provider.origin,
            }).operationId;
          }
          let resp;
          try {
            resp = await fetch(provider.endpoint('/api/delete'), {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: observed.exactName }),
              redirect: 'error',
              signal: AbortSignal.timeout(30_000),
            });
          } catch (error) {
            if (operationId) {
              this._modelArtifactAuthorityRepository.recordOutcome(
                operationId,
                'ORPHANED',
                'MODEL_DELETE_PROVIDER_OUTCOME_UNKNOWN',
              );
            }
            throw new ModelRegistryError(
              'MODEL_DELETE_PROVIDER_UNAVAILABLE',
              `Ollama delete není dostupný pro ${observed.exactName}`,
              { cause: error, httpStatus: 503 },
            );
          }
          if (!resp?.ok) {
            if (operationId) {
              this._modelArtifactAuthorityRepository.recordOutcome(
                operationId,
                'FAILED',
                `MODEL_DELETE_PROVIDER_HTTP_${resp?.status ?? 'UNKNOWN'}`,
              );
            }
            registryFail('MODEL_DELETE_PROVIDER_FAILED', `Ollama vrátil ${resp?.status ?? 'unknown'}`, 502);
          }
          if (operationId) {
            this._modelArtifactAuthorityRepository.recordOutcome(operationId, 'SUCCEEDED');
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

  // ─── Batch Validation ──────────────────────────────────────────────────────

  /** Validate all installed models that need it (sequential, mutex-guarded) */
  async validateAll(onProgress) {
    if (this._batchRunning || this._validatingModel) {
      return { ok: true, alreadyRunning: true, model: this._validatingModel };
    }
    if (!this._validationRunner) return { ok: false, error: 'Validation runner not available' };

    const installed = await this.getInstalled();
    const allScores = this.getAllValidationScores();
    const now = Date.now();

    // Filter to models needing validation
    const queue = installed.filter(m => {
      const scores = allScores[canonicalModelName(m.name)];
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
          if (!check.some(m => sameModelName(m.name, model))) {
            logger.warn('ModelRegistry', `Skipping ${model} — no longer installed`);
            continue;
          }

          let validationLease;
          try {
            validationLease = self.#acquireValidationLease(model);
          } catch (error) {
            self._broadcast('control', {
              action: 'model_validation_progress', model,
              status: 'error', percent: -1,
              batchIndex: i + 1, batchTotal: queue.length,
              text: `${model} — Chyba: ${error.message}`,
            });
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
          } finally {
            self._validatingModel = null;
            validationLease.release();
          }
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

  /** Reserve the live single-model validation path before its async work starts. */
  startValidation(modelName, suiteNames, onProgress) {
    const model = typeof modelName === 'string' ? modelName.trim() : '';
    if (!canonicalModelName(model)
      || !Array.isArray(suiteNames)
      || suiteNames.length < 1
      || suiteNames.some(suite => typeof suite !== 'string' || !suite.trim())) {
      registryFail('MODEL_VALIDATION_INPUT_INVALID', 'Model validation input is invalid', 400);
    }
    if (!this._validationRunner?.runAll) {
      registryFail('MODEL_VALIDATION_AUTHORITY_REQUIRED', 'Model validation authority is unavailable', 503);
    }
    if (this._batchRunning || this._validatingModel) {
      registryFail(
        'MODEL_VALIDATION_BUSY',
        `Model validation is already running${this._validatingModel ? ` for ${this._validatingModel}` : ''}`,
        409,
      );
    }
    const validationLease = this.#acquireValidationLease(model);
    this._validatingModel = model;
    // Defer the runner by one microtask. The route can publish the accepted
    // reservation before a synchronous progress callback is able to fire.
    const completion = Promise.resolve()
      .then(() => this._validationRunner.runAll(model, [...suiteNames], onProgress))
      .finally(() => {
        if (sameModelName(this._validatingModel, model)) this._validatingModel = null;
        this.invalidateCache();
        validationLease.release();
      });
    return Object.freeze({ model, suites: Object.freeze([...suiteNames]), completion });
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
      const installed = await this.getInstalled({ strict: true });
      const boundModels = canonicalModelNameSet(Object.values(config.models));
      const cutoffMs = now - days * 86400000;
      const deleted = [];
      const seenCanonical = new Set();

      for (const m of installed) {
        const canonicalName = canonicalModelName(m.name);
        if (!canonicalName || seenCanonical.has(canonicalName)) continue;
        seenCanonical.add(canonicalName);
        // Skip bound models
        if (boundModels.has(canonicalName)) continue;
        // Skip if currently validating
        if (sameModelName(this._validatingModel, m.name)) continue;
        // Retention is fail-closed. Every stored usage timestamp must parse as
        // explicit UTC and provider modification time remains a second
        // protection even when historical usage exists.
        const usage = this.getUsage(m.name);
        if (!usage.retentionValid) continue;
        // Absence of gateway usage is not proof that the artifact was unused:
        // validation, vision, embeddings and other provider consumers do not
        // all write model_usage yet. Keep zero-evidence artifacts until the
        // shared model-use port can account for every consumer.
        if (usage.requestCount < 1) continue;
        if (usage.lastUsedAtMs !== null && usage.lastUsedAtMs >= cutoffMs) continue;
        const modifiedAtMs = parseCleanupUtcTimestamp(m.modified_at);
        if (modifiedAtMs === null || modifiedAtMs >= cutoffMs) continue;
        const digestSha256 = m.digestSha256 || normalizeModelDigestSha256(m.digest);
        if (!digestSha256) continue;

        try {
          const result = await this.deleteModel(m.name, {
            source: 'AUTO_CLEANUP',
            expectedDigestSha256: digestSha256,
          });
          deleted.push({
            model: result.deleted,
            freedGB: result.freedGB,
          });
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

      for (const [role, model] of Object.entries(config.models).sort(([a], [b]) => a.localeCompare(b))) {
        if (installed.some(entry => sameModelName(entry.name, model))) continue;

        const rec = this.getRecommendation(role);
        const installedCandidate = rec
          ? installed.find(entry => sameModelName(entry.name, rec.model))
          : null;
        const candidate = installedCandidate ? {
          model: installedCandidate.name,
          digest: installedCandidate.digest || null,
          score: rec.score,
          delta: rec.delta,
        } : null;
        const state = candidate ? 'PROPOSED' : 'DETECTED';
        findings.push({
          role,
          configuredModel: model,
          state,
          reason: 'BOUND_MODEL_NOT_INSTALLED',
          candidate,
        });
        logger.warn(
          'ModelRegistry',
          candidate
            ? `Model ${model} missing for ${role}; proposed local candidate ${candidate.model}`
            : `Model ${model} missing for ${role}; no local candidate proposed`,
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
export { ROLE_PROFILES, SUITES };
export default modelRegistry;
