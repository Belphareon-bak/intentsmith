// Upgrade Manager v118 — Self-Evaluating Model Registry (Phase 2)
// ══════════════════════════════════════════════════════════════════════════════
//
// Phase 2 pipeline:
//   catalog → discover → feasibility gate → pairwise evaluation
//   → preference adjust → proposal store → user approval → pull + apply
//
// NEVER auto-upgrades. Always produces proposals for user approval.
// Discovery NEVER changes config. Runtime NEVER touches internet.
// Communication only through proposals in DB.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { MODEL_PROFILES, parseModelName, isNewerVersion, isSameFamily } from './model-profiles.js';
import { discover, getUpgradeHints, fetchInstalledModels } from './model-discovery.js';
import { modelUniverseStore } from './model-universe-store.js';
import {
  canonicalModelName,
  canonicalModelNameSet,
  modelNameAliases,
  sameModelName,
} from './model-identity.js';

// Minimum score for user-facing notifications (lower proposals exist but are silent)
export const MIN_NOTIFY_SCORE = 6;

// v118: Phase 2 lazy-loaded modules
let _ranker = null;
let _proposalStore = null;
let _catalog = null;
let _preferenceTracker = null;
let _registryClient = null;

async function _ensurePhase2() {
  if (!_ranker) {
    try { _ranker = await import('./model-ranker.js'); } catch { _ranker = null; }
  }
  if (!_catalog) {
    try { _catalog = await import('./model-catalog.js'); } catch { _catalog = null; }
  }
  if (!_proposalStore) {
    try {
      const mod = await import('./proposal-store.js');
      _proposalStore = mod.proposalStore;
    } catch { _proposalStore = null; }
  }
  if (!_preferenceTracker) {
    try { _preferenceTracker = await import('./preference-tracker.js'); } catch { _preferenceTracker = null; }
  }
}

// v120: Phase 3 lazy-loaded modules (empirical scoring)
let _metricsCollector = null;
let _empiricalScorer = null;

async function _ensurePhase3() {
  if (!_metricsCollector) {
    try { _metricsCollector = (await import('./metrics-collector.js')).metricsCollector; } catch { _metricsCollector = null; }
  }
  if (!_empiricalScorer) {
    try { _empiricalScorer = await import('./empirical-scorer.js'); } catch { _empiricalScorer = null; }
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

function _getCatalogEntryByIdentity(catalog, modelName) {
  if (!catalog?.getCatalogEntry) return null;
  const exact = catalog.getCatalogEntry(modelName);
  if (exact) return exact;
  for (const alias of modelNameAliases(modelName)) {
    const entry = catalog.getCatalogEntry(alias);
    if (entry) return entry;
  }
  return Array.isArray(catalog.CATALOG)
    ? catalog.CATALOG.find(entry => sameModelName(entry?.name, modelName)) || null
    : null;
}

function _getMapValueByModelIdentity(map, modelName) {
  if (!(map instanceof Map)) return undefined;
  if (map.has(modelName)) return map.get(modelName);
  for (const [name, value] of map) {
    if (sameModelName(name, modelName)) return value;
  }
  return undefined;
}

// ─── Feasibility Gate (v118) ────────────────────────────────────────────────

/**
 * Required capabilities per role.
 */
const ROLE_CAPABILITIES = {
  D1: ['json_mode'], D2: ['json_mode'], R1: ['json_mode'], R2: ['json_mode'],
  CODE: [], CHAT: [], VISION: ['vision'],
};

const CPU_ONLY_PARAM_CAP = 14; // Max params for CPU-only inference

/**
 * Check if a candidate is feasible for the current hardware.
 * @param {Object} candidate - ModelCandidate with catalog fields
 * @param {string} role
 * @param {Object} hwContext - { gpuVramMb, systemRamGb, freeDiskGb }
 * @returns {{ feasible: boolean, reason?: string }}
 */
export function checkFeasibility(candidate, role, hwContext = {}) {
  const { gpuVramMb = 0, systemRamGb = 0, freeDiskGb = Infinity } = hwContext;

  // Capability check — reject if required capability is missing OR unknown
  const required = ROLE_CAPABILITIES[role] || [];
  for (const cap of required) {
    if (!candidate.capabilities || !candidate.capabilities.includes(cap)) {
      return { feasible: false, reason: `missing capability: ${cap}` };
    }
  }

  // VRAM check (context-aware)
  if (candidate.effectiveVramMb && gpuVramMb > 0) {
    if (candidate.effectiveVramMb > gpuVramMb * 0.90) {
      return { feasible: false, reason: `VRAM: ${candidate.effectiveVramMb}MB > ${Math.round(gpuVramMb * 0.90)}MB (90% of ${gpuVramMb}MB)` };
    }
  }

  // Host RAM check
  if (candidate.params && systemRamGb > 0) {
    const ramNeeded = candidate.params * 0.6; // ~0.6 GB per B params for Q4_K_M
    if (ramNeeded > systemRamGb * 0.7) {
      return { feasible: false, reason: `RAM: ${ramNeeded.toFixed(1)}GB > ${(systemRamGb * 0.7).toFixed(1)}GB (70% of ${systemRamGb}GB)` };
    }
  }

  // Disk space check
  if (candidate.sizeGB && candidate.sizeGB > freeDiskGb * 0.8) {
    return { feasible: false, reason: `disk: ${candidate.sizeGB}GB > ${(freeDiskGb * 0.8).toFixed(1)}GB (80% of ${freeDiskGb}GB)` };
  }

  // CPU-only param cap
  if (gpuVramMb === 0 && candidate.params && candidate.params > CPU_ONLY_PARAM_CAP) {
    return { feasible: false, reason: `CPU-only: ${candidate.params}B > ${CPU_ONLY_PARAM_CAP}B cap` };
  }

  return { feasible: true };
}

// ─── Candidate Filtering ────────────────────────────────────────────────────

/**
 * Filter candidates against a role profile's requirements.
 *
 * @param {Array<ModelCandidate>} candidates
 * @param {Object} profile - From MODEL_PROFILES
 * @returns {Array<ModelCandidate>}
 */
export function filterCandidates(candidates, profile, opts = {}) {
  const { requirements, preferredFamilies, preferredCategories } = profile;
  const blockedModels = opts.blockedModels instanceof Set
    ? canonicalModelNameSet(opts.blockedModels)
    : null;

  return candidates.filter(c => {
    // Param bounds
    if (c.params && requirements.minParams && c.params < requirements.minParams) return false;
    if (c.params && requirements.maxParams && c.params > requirements.maxParams) return false;

    // Must be in a preferred family or category
    const familyMatch = preferredFamilies.some(f => c.family === f || c.family.startsWith(f));
    const categoryMatch = preferredCategories.includes(c.category);
    if (!familyMatch && !categoryMatch) return false;

    // Skip the current model itself
    const current = profile.getCurrentModel();
    if (sameModelName(c.name, current)) return false;

    // Runtime safety guard: optionally exclude currently disabled models.
    if (blockedModels && blockedModels.has(canonicalModelName(c.name))) return false;

    return true;
  });
}

// ─── Candidate Ranking ──────────────────────────────────────────────────────

/**
 * Score and rank candidates for a role.
 *
 * Score = familyBonus + versionBonus + paramsBonus + recencyBonus + hintBonus
 *
 * @param {Array<ModelCandidate>} candidates - Pre-filtered
 * @param {Object} profile - From MODEL_PROFILES
 * @returns {Array<ScoredCandidate>}
 *
 * ScoredCandidate = ModelCandidate & { score: number, scoreBreakdown: Object }
 */
export function rankCandidates(candidates, profile) {
  const current = profile.getCurrentModel();
  const currentParsed = parseModelName(current);
  const hints = getUpgradeHints(current);
  const hintNames = new Set(hints.map(h => h.suggestedModel.toLowerCase()));

  return candidates.map(c => {
    const breakdown = {};
    let score = 0;

    // Family match bonus: exact family = 3, category match = 1
    if (profile.preferredFamilies[0] === c.family) {
      breakdown.familyBonus = 3;  // Top preferred family
    } else if (profile.preferredFamilies.includes(c.family)) {
      breakdown.familyBonus = 2;  // Other preferred family
    } else {
      breakdown.familyBonus = 1;  // Category match only
    }
    score += breakdown.familyBonus;

    // Version bonus: newer version of same family = 2
    if (isNewerVersion(current, c.name)) {
      breakdown.versionBonus = 2;
    } else if (isSameFamily(current, c.name)) {
      breakdown.versionBonus = 1; // Same family, unknown version relation
    } else {
      breakdown.versionBonus = 0;
    }
    score += breakdown.versionBonus;

    // Params fitness: prefer similar or slightly larger params
    if (c.params && currentParsed.params) {
      const ratio = c.params / currentParsed.params;
      if (ratio >= 0.8 && ratio <= 1.5) {
        breakdown.paramsBonus = 2; // Similar size
      } else if (ratio >= 0.5 && ratio <= 2.0) {
        breakdown.paramsBonus = 1; // Reasonable range
      } else {
        breakdown.paramsBonus = 0; // Too different
      }
    } else {
      breakdown.paramsBonus = 1; // Unknown — neutral
    }
    score += breakdown.paramsBonus;

    // Recency bonus: newer modified date = better
    if (c.modifiedAt) {
      const age = Date.now() - new Date(c.modifiedAt).getTime();
      const dayAge = age / (1000 * 60 * 60 * 24);
      if (dayAge < 30) {
        breakdown.recencyBonus = 2;
      } else if (dayAge < 90) {
        breakdown.recencyBonus = 1;
      } else {
        breakdown.recencyBonus = 0;
      }
    } else {
      breakdown.recencyBonus = 0;
    }
    score += breakdown.recencyBonus;

    // Hint bonus: if this candidate matches a known upgrade hint = 3
    const candidateLower = c.name.toLowerCase();
    const hintMatch = [...hintNames].some(h => candidateLower.includes(h));
    if (hintMatch) {
      breakdown.hintBonus = 3;
    } else {
      breakdown.hintBonus = 0;
    }
    score += breakdown.hintBonus;

    return { ...c, score, scoreBreakdown: breakdown };
  }).sort((a, b) => b.score - a.score);
}

// ─── Upgrade Proposals ──────────────────────────────────────────────────────

/**
 * @typedef {Object} UpgradeProposal
 * @property {string} role - Model role (D1, CHAT, etc.)
 * @property {string} currentModel - Currently configured model
 * @property {string} candidateModel - Proposed replacement
 * @property {number} score - Candidate's ranking score
 * @property {Object} scoreBreakdown - Score components
 * @property {string} reason - Human-readable explanation
 * @property {string} riskLevel - 'low' | 'medium' | 'high'
 * @property {boolean} installed - Whether candidate is already installed
 * @property {number} sizeGB - Candidate model size in GB
 */

/**
 * Generate upgrade proposals for all roles.
 *
 * @param {Array<ModelCandidate>} candidates - From discovery
 * @param {Object} [opts]
 * @param {number} [opts.minScore=4] - Minimum score to propose
 * @param {number} [opts.maxProposalsPerRole=3] - Max proposals per role
 * @returns {Array<UpgradeProposal>}
 */
export function generateProposals(candidates, opts = {}) {
  const minScore = opts.minScore ?? 4;
  const maxPerRole = opts.maxProposalsPerRole ?? 3;
  const proposals = [];

  for (const [role, profile] of Object.entries(MODEL_PROFILES)) {
    const current = profile.getCurrentModel();
    const filtered = filterCandidates(candidates, profile, {
      blockedModels: opts.blockedModels,
    });
    const ranked = rankCandidates(filtered, profile);

    // Take top candidates above threshold
    const topCandidates = ranked.filter(c => c.score >= minScore).slice(0, maxPerRole);

    for (const candidate of topCandidates) {
      const hints = getUpgradeHints(current);
      const matchingHint = hints.find(h =>
        candidate.name.toLowerCase().includes(h.suggestedModel.toLowerCase())
      );

      proposals.push({
        role,
        currentModel: current,
        candidateModel: candidate.name,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        reason: matchingHint?.reason || _generateReason(current, candidate, profile),
        riskLevel: _assessRisk(current, candidate, profile),
        installed: candidate.installed,
        sizeGB: candidate.sizeGB,
      });
    }
  }

  // Sort by score descending, then by role
  return proposals.sort((a, b) => b.score - a.score || a.role.localeCompare(b.role));
}

/**
 * Generate a human-readable reason for an upgrade proposal.
 */
function _generateReason(currentModel, candidate, profile) {
  const parts = [];

  if (isNewerVersion(currentModel, candidate.name)) {
    parts.push(`newer version of ${parseModelName(currentModel).family}`);
  }

  if (candidate.scoreBreakdown.familyBonus >= 3) {
    parts.push(`top preferred family for ${profile.role}`);
  }

  if (candidate.scoreBreakdown.recencyBonus >= 2) {
    parts.push('recently updated');
  }

  if (parts.length === 0) {
    parts.push(`compatible ${candidate.family} model for ${profile.role} role`);
  }

  return parts.join(', ');
}

/**
 * Assess risk level of an upgrade.
 */
function _assessRisk(currentModel, candidate, profile) {
  // Same family, newer version → low risk
  if (isSameFamily(currentModel, candidate.name)) {
    if (isNewerVersion(currentModel, candidate.name)) return 'low';
    return 'medium'; // Same family but unclear version
  }

  // Different family → high risk
  return 'high';
}

// ─── Upgrade Manager Class ──────────────────────────────────────────────────

export class UpgradeManager {
  constructor() {
    this._lastDiscovery = null;
    this._lastProposals = null;
    this._lastCheckTime = null;
    this._history = [];  // Applied upgrades
    this._modelHash = null;
    this._recheckInterval = null;
    this._pollInterval = null;
    this._active = false;
    // v103.1: Apply mechanism
    this._db = null;
    this._upgrading = false;  // Mutex flag
    this._configVersion = 0;  // Monotonic counter for WS broadcast
  }

  // ─── DB + Persistence (v103.1) ──────────────────────────────────────────

  /**
   * Set DB handle for persistence.
   * @param {import('better-sqlite3').Database} db
   */
  setDb(db) {
    this._db = db;
  }

  _getRuntimeGuardDecision(modelName) {
    try {
      const decision = modelUniverseStore?.isModelRuntimeAllowed?.(modelName);
      if (!decision || typeof decision.allowed !== 'boolean') {
        return { allowed: true, reason: 'runtime_guard_unavailable' };
      }
      return decision;
    } catch (err) {
      logger.debug('UpgradeManager', `Runtime guard check failed for ${modelName}: ${err.message}`);
      return { allowed: true, reason: 'runtime_guard_error' };
    }
  }

  _filterRuntimeGuardedCandidates(candidates = [], stage = 'discovery') {
    const filtered = [];
    const blocked = [];
    for (const candidate of candidates) {
      const decision = this._getRuntimeGuardDecision(candidate?.name);
      if (decision.allowed) {
        filtered.push(candidate);
        continue;
      }
      blocked.push({
        name: candidate?.name,
        reason: decision.reason || 'runtime_guard_disabled',
        disabledUntil: decision.disabledUntil || null,
      });
    }

    if (blocked.length > 0) {
      logger.info('UpgradeManager', `Runtime guard blocked ${blocked.length} candidate(s) during ${stage}`, {
        blocked: blocked.slice(0, 12),
      });
    }

    return { filtered, blocked };
  }

  /**
   * Load persisted model overrides from DB and apply to config.models.
   * Called once on startup BEFORE any LLM calls.
   * @returns {number} Number of overrides applied
   */
  loadPersistedOverrides() {
    if (!this._db) return 0;
    try {
      const rows = this._db.prepare('SELECT role, model FROM model_overrides').all();
      let applied = 0;
      for (const row of rows) {
        if (MODEL_PROFILES[row.role] && row.model) {
          const current = config.models[row.role];
          config.models[row.role] = row.model;
          applied++;
          logger.info('UpgradeManager', `Restored override: ${row.role} = ${row.model} (was ${current})`);
        }
      }
      return applied;
    } catch (err) {
      logger.warn('UpgradeManager', `Failed to load overrides: ${err.message}`);
      return 0;
    }
  }

  /**
   * Apply a model upgrade: validate → hot-swap → verify → persist.
   *
   * @param {string} role - Model role (D1, D2, CODE, R1, R2, CHAT, VISION)
   * @param {string} targetModel - New model name
   * @param {Object} [opts]
   * @param {number} [opts.score] - Proposal score (for history)
   * @param {boolean} [opts.skipVerify=false] - Skip Ollama ping verification
   * @param {string} [opts.appliedBy='user'] - 'user' | 'system' | 'auto'
   * @returns {Promise<{ok: boolean, role: string, from: string, to: string, verified: boolean, configVersion: number}>}
   */
  async applyUpgrade(role, targetModel, opts = {}) {
    // Mutex
    if (this._upgrading) throw new Error('Upgrade in progress');
    this._upgrading = true;

    try {
      // Validate role
      if (!MODEL_PROFILES[role]) throw new Error(`Invalid role: ${role}`);

      if (!opts.ignoreRuntimeGuard) {
        const decision = this._getRuntimeGuardDecision(targetModel);
        if (!decision.allowed) {
          const until = decision.disabledUntil ? ` until ${decision.disabledUntil}` : '';
          throw new Error(`Model temporarily blocked by runtime guard (${decision.reason || 'error rate guard'})${until}: ${targetModel}`);
        }
      }

      // v125: Check if installed — auto-pull if onPullProgress callback provided
      const installed = await fetchInstalledModels({ timeout: 15000 });
      const isInstalled = installed.some(m => sameModelName(m.name, targetModel));

      if (!isInstalled) {
        if (!opts.onPullProgress) {
          throw new Error(`Model not installed in Ollama: ${targetModel}`);
        }
        opts.onPullProgress({ status: 'pulling', text: `Stahuji ${targetModel}...`, percent: 0 });
        await this.pullModel(targetModel, opts.onPullProgress);
        opts.onPullProgress({ status: 'pulled', text: `${targetModel} stažen`, percent: 100 });
        // Verify model appeared after pull
        const recheck = await fetchInstalledModels({ timeout: 10000 });
        if (!recheck.some(m => sameModelName(m.name, targetModel))) {
          throw new Error(`Pull completed but model not found: ${targetModel}`);
        }
      }

      // Check not already set (normalize to handle :latest variants)
      const previousModel = config.models[role];
      if (sameModelName(previousModel, targetModel)) {
        throw new Error(`${role} is already set to ${targetModel}`);
      }

      // Hot-swap
      config.models[role] = targetModel;

      // v125: Verify is always deferred to background (caller invokes _backgroundVerify)
      const verified = true;

      // Persist
      const appliedBy = opts.appliedBy || 'user';
      if (this._db) {
        this._persistOverride(role, targetModel, previousModel, opts.score, appliedBy);
        this._recordHistory(role, previousModel, targetModel, opts.score, 'apply');

        // v126: Every pending proposal for this role was ranked against the
        // previous active model and is stale after a successful hot-swap.
        this._expirePendingProposalsForRole(role, targetModel);
      }

      // In-memory history
      this.recordUpgrade(role, previousModel, targetModel, opts.score || 0);
      this._configVersion++;

      logger.info('UpgradeManager', `Applied: ${role} ${previousModel} → ${targetModel}`, {
        score: opts.score, verified, appliedBy,
      });

      return { ok: true, role, from: previousModel, to: targetModel, verified, configVersion: this._configVersion };
    } finally {
      this._upgrading = false;
    }
  }

  /**
   * Rollback a role to its previous model.
   *
   * @param {string} role
   * @param {Object} [opts]
   * @param {boolean} [opts.skipVerify=false]
   * @param {boolean} [opts.force=false] - Proceed even if verify fails (prevents stuck state)
   * @returns {Promise<{ok: boolean, role: string, from: string, to: string, configVersion: number}>}
   */
  async rollbackUpgrade(role, opts = {}) {
    if (!this._db) throw new Error('DB not initialized');

    const row = this._db.prepare(
      'SELECT model, previous_model FROM model_overrides WHERE role = ?'
    ).get(role);

    if (!row) throw new Error(`No override found for role: ${role}`);

    const currentModel = row.model;
    const previousModel = row.previous_model;

    // Verify previous model is still installed (15s timeout — Ollama may be busy)
    const installed = await fetchInstalledModels({ timeout: 15000 });
    if (!installed.some(m => sameModelName(m.name, previousModel))) {
      throw new Error(`Previous model no longer installed: ${previousModel}`);
    }

    // Hot-swap back
    config.models[role] = previousModel;

    // Verify (unless skipped or forced)
    if (!opts.skipVerify) {
      const verified = await this._verifyModel(previousModel);
      if (!verified && !opts.force) {
        config.models[role] = currentModel;
        throw new Error(`Rollback verification failed: ${previousModel} did not respond`);
      }
    }

    // v124: Remove override from DB AFTER successful verification (not before)
    this._db.prepare('DELETE FROM model_overrides WHERE role = ?').run(role);

    // Record in history
    this._recordHistory(role, currentModel, previousModel, null, 'rollback');
    this._configVersion++;

    logger.info('UpgradeManager', `Rolled back: ${role} ${currentModel} → ${previousModel}`);

    return { ok: true, role, from: currentModel, to: previousModel, configVersion: this._configVersion };
  }

  /**
   * Quick verification that a model responds via Ollama /api/chat.
   * @param {string} modelName
   * @returns {Promise<boolean>}
   */
  async _verifyModel(modelName) {
    const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';
    // 90s — model may need to load into VRAM (unload previous + load new)
    const timeout = 90000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          options: { num_predict: 1, num_ctx: 512 },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (!response.ok) return false;

      const data = await response.json();
      return !!(data.message?.content || data.response);
    } catch (err) {
      logger.warn('UpgradeManager', `Verify failed for ${modelName}: ${err.message}`);
      return false;
    }
  }

  /**
   * v125: Background verify with retry — runs AFTER apply returns.
   * 3 attempts × 30s delay. On success → mark verified=1. On failure → mark verified=0 + notify.
   * NEVER auto-rollbacks — user must decide.
   *
   * @param {string} role
   * @param {string} targetModel
   * @param {string} previousModel
   * @param {Function} [onFail] - callback(role, model) on all attempts failed
   * @returns {Promise<boolean>}
   */
  async _backgroundVerify(role, targetModel, previousModel, onFail) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ok = await this._verifyModel(targetModel);
      if (ok) {
        this._markVerified(role, true);
        logger.info('UpgradeManager', `BG verify OK: ${targetModel} (attempt ${attempt})`);
        return true;
      }
      if (attempt < 3) {
        logger.info('UpgradeManager', `BG verify attempt ${attempt} failed for ${targetModel}, retrying in 30s`);
        await new Promise(r => setTimeout(r, 30_000));
      }
    }
    // All 3 failed — warn but DON'T auto-rollback
    this._markVerified(role, false);
    logger.warn('UpgradeManager', `BG verify FAILED for ${targetModel} after 3 attempts`);
    if (onFail) onFail(role, targetModel);
    return false;
  }

  /**
   * v125: Update verified flag in DB.
   */
  _markVerified(role, verified) {
    if (!this._db) return;
    try {
      this._db.prepare('UPDATE model_overrides SET verified = ? WHERE role = ?').run(verified ? 1 : 0, role);
    } catch (err) {
      logger.warn('UpgradeManager', `markVerified failed: ${err.message}`);
    }
  }

  /**
   * Expire stale pending proposals for a role after its active model changes.
   * Called after applyUpgrade to clean up proposals that are now obsolete.
   * @param {string} role
   * @param {string} newModel - The newly applied model
   */
  _expirePendingProposalsForRole(role, newModel) {
    if (!this._db) {
      logger.warn('UpgradeManager', `Cannot expire proposals: DB not set`);
      return;
    }
    try {
      const result = this._db.prepare(`
        UPDATE upgrade_proposals
        SET status = 'expired', resolved_at = datetime('now')
        WHERE role = ? AND status = 'pending'
      `).run(role);
      logger.info('UpgradeManager', `Expired ${result.changes} stale proposals for ${role} after applying ${newModel}`);
    } catch (err) {
      logger.warn('UpgradeManager', `Failed to expire proposals: ${err.message}`);
    }
  }

  /**
   * Pull a model from Ollama with streaming progress.
   *
   * @param {string} modelName - e.g. 'qwen3.5:27b'
   * @param {Function} [onProgress] - callback({text, percent, downloadedGB, totalGB, eta, status})
   * @returns {Promise<void>}
   */
  async pullModel(modelName, onProgress) {
    const baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434';

    const response = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      throw new Error(`Ollama pull failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastPercent = -1;
    let lastEmitTime = 0;
    const startTime = Date.now();

    const STATUS_LABELS = {
      'pulling manifest': 'Stahuji manifest...',
      'downloading': null,
      'verifying sha256 digest': 'Ověřuji integritu...',
      'writing manifest': 'Zapisuji manifest...',
      'removing any unused layers': 'Čistím staré vrstvy...',
      'success': 'Hotovo',
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);

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
          } else if (data.error) {
            throw new Error(`Ollama pull error: ${data.error}`);
          }
        } catch (parseErr) {
          if (parseErr.message.startsWith('Ollama pull error')) throw parseErr;
        }
      }
    }

    logger.info('UpgradeManager', `Pulled model: ${modelName}`);
  }

  /**
   * Find old models that were replaced and are no longer bound to any role.
   * @returns {Array<{model: string, replacedBy: string, role: string, appliedAt: string}>}
   */
  getUnusedOldModels() {
    if (!this._db) return [];
    try {
      const rows = this._db.prepare(
        'SELECT role, model, previous_model, applied_at FROM model_overrides ORDER BY applied_at DESC LIMIT 50'
      ).all();

      const boundModels = canonicalModelNameSet(Object.values(config.models));
      return rows
        .filter(r => !boundModels.has(canonicalModelName(r.previous_model)))
        .map(r => ({
          model: r.previous_model,
          replacedBy: r.model,
          role: r.role,
          appliedAt: r.applied_at,
        }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Persist a model override to DB.
   */
  _persistOverride(role, model, previousModel, score, appliedBy) {
    this._db.prepare(`
      INSERT OR REPLACE INTO model_overrides (role, model, previous_model, score, applied_by, applied_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(role, model, previousModel, score ?? null, appliedBy || 'user');
  }

  /**
   * Record an upgrade/rollback action in DB history.
   */
  _recordHistory(role, fromModel, toModel, score, action) {
    this._db.prepare(`
      INSERT INTO upgrade_history (role, from_model, to_model, score, action)
      VALUES (?, ?, ?, ?, ?)
    `).run(role, fromModel, toModel, score ?? null, action);
  }

  /**
   * Set the proposal store instance (v118).
   * @param {import('./proposal-store.js').ProposalStore} store
   */
  setProposalStore(store) {
    this._proposalStore = store;
  }

  /**
   * Set the registry client instance (v118).
   * @param {import('./registry-client.js').RegistryClient} client
   */
  setRegistryClient(client) {
    this._registryClient = client;
  }

  /**
   * Run full check: discover → filter → rank → propose.
   * v118: Uses Phase 2 pipeline when available (feasibility + pairwise + preference + proposal store).
   *
   * @param {Object} [opts]
   * @param {string} [opts.baseUrl] - Ollama URL override
   * @param {number} [opts.minScore] - Minimum proposal score (Phase 1 compat)
   * @param {boolean} [opts.fullCycle=false] - Include L2 catalog candidates
   * @returns {Promise<{proposals: UpgradeProposal[], discovery: DiscoveryResult}>}
   */
  async checkForUpgrades(opts = {}) {
    const discovery = await discover({
      ...opts,
      includeCatalog: opts.fullCycle || false,
    });

    const runtimeGuardFilter = this._filterRuntimeGuardedCandidates(discovery.candidates, 'check_for_upgrades');
    if (runtimeGuardFilter.blocked.length > 0) {
      discovery.candidates = runtimeGuardFilter.filtered;
      discovery.stats = {
        ...(discovery.stats || {}),
        runtimeGuardBlocked: runtimeGuardFilter.blocked.length,
      };
    }
    this._lastDiscovery = discovery;

    // v121.1: L4 Online Discovery (fullCycle only — same cadence as L2)
    // Use model name prefixes (library names) instead of logical families
    // because 'qwen3.5:27b' → library 'qwen3.5', not logical family 'qwen'
    if (opts.fullCycle && config.features?.onlineDiscovery) {
      try {
        const od = await _ensureOnlineDiscovery();
        if (od) {
          const { extractLibraryName } = await import('./benchmark-estimator.js');
          const installedLibraryNames = [...new Set(
            discovery.candidates
              .filter(c => c.source === 'local')
              .map(c => extractLibraryName(c.name))
              .filter(Boolean)
          )];
          if (installedLibraryNames.length > 0) {
            await _ensurePhase2();
            const catalogArr = _catalog?.CATALOG || [];
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

      // v131: L5 — WhatLLM.org external benchmark enrichment (fullCycle only)
      // Replaces estimated benchmarks with real composite quality scores
      // for L4 provisional models (benchmarkConfidence < 0.85).
      try {
        const { enrichCandidates } = await import('./whatllm-client.js');
        const { enriched } = await enrichCandidates(discovery.candidates);
        if (enriched > 0) {
          logger.info('UpgradeManager', `L5: enriched ${enriched} candidates with WhatLLM benchmarks`);
          // Persist enrichment back to DB for scoring visibility
          try {
            const od = await _ensureOnlineDiscovery();
            if (od) od.persistEnrichment(discovery.candidates.filter(c => c.benchmarkSource === 'whatllm'));
          } catch (_) {}
        }
      } catch (err) {
        logger.warn('UpgradeManager', `L5 enrichment failed: ${err.message}`);
      }
    }

    // Try Phase 2 pipeline first
    let proposals;
    try {
      await _ensurePhase2();
      if (_ranker && _catalog) {
        proposals = await this._checkForUpgradesV2(discovery, opts);
      }
    } catch (err) {
      logger.warn('UpgradeManager', `Phase 2 pipeline failed, falling back to Phase 1: ${err.message}`);
      proposals = null;
    }

    // Fallback to Phase 1
    if (!proposals) {
      proposals = generateProposals(discovery.candidates, {
        minScore: opts.minScore ?? 4,
        maxProposalsPerRole: opts.maxProposalsPerRole ?? 3,
      });
    }

    this._lastProposals = proposals;
    this._lastCheckTime = Date.now();
    this._modelHash = discovery.candidates.map(c => c.name).sort().join(',');

    logger.info('UpgradeManager', `Check complete: ${proposals.length} proposals from ${discovery.candidates.length} models`, {
      ollamaAvailable: discovery.ollamaAvailable,
      hintsCount: discovery.hints.size,
      stats: discovery.stats,
    });

    return { proposals, discovery };
  }

  /**
   * Phase 2 pipeline: feasibility → pairwise → preference → store.
   * @private
   */
  async _checkForUpgradesV2(discovery, opts) {
    const proposals = [];

    // Get hardware context
    let hwContext = { gpuVramMb: 0, systemRamGb: 0, freeDiskGb: Infinity };
    try {
      const { getSystemProfile } = await import('../system/gpu-detector.js');
      const profile = await getSystemProfile();
      if (profile.gpus?.length > 0) {
        hwContext.gpuVramMb = Math.max(...profile.gpus.map(g => g.vram_mb || 0));
      }
      hwContext.systemRamGb = profile.ram_gb || 0;
    } catch (_) {}

    // Invalidate stale proposals (catalog hash / eval version changed)
    const store = this._proposalStore || _proposalStore;
    if (store && _catalog && _ranker) {
      try {
        store.invalidateStale(_catalog.CATALOG_HASH, _ranker.EVALUATION_VERSION);
      } catch (_) {}
    }

    // v124: Expire proposals older than 7 days
    if (store) {
      try { store.expireStale(7); } catch (_) {}
    }

    // v120: Query empirical data for all roles (Phase 3)
    const empiricalData = new Map(); // role → Map<model, aggregated>
    await _ensurePhase3();
    if (_metricsCollector && _empiricalScorer) {
      try {
        for (const role of Object.keys(MODEL_PROFILES)) {
          empiricalData.set(role, _metricsCollector.getAllMetricsForRole(role));
        }
      } catch (_) {}
    }

    // v120.2: Build role bindings map for diversity penalty
    const roleBindings = {};
    for (const [r, p] of Object.entries(MODEL_PROFILES)) {
      roleBindings[r] = p.getCurrentModel();
    }

    for (const [role, profile] of Object.entries(MODEL_PROFILES)) {
      const current = profile.getCurrentModel();
      const currentParsed = parseModelName(current);

      // Find current model's catalog entry or build from local data
      const currentEntry = _getCatalogEntryByIdentity(_catalog, current) || {
        name: current,
        family: currentParsed.family,
        category: currentParsed.category,
        params: currentParsed.params,
        benchmarks: null,
        contextWindow: null,
      };

      // Anti-thrashing check
      if (store) {
        const thrashing = store.isAntiThrashing(role, this._db);
        if (thrashing.blocked) {
          logger.debug('UpgradeManager', `Skipping ${role}: anti-thrashing (last upgrade ${thrashing.lastUpgradeAt})`);
          continue;
        }
      }

      // Filter candidates for this role
      const roleCandidates = discovery.candidates.filter(c => {
        if (sameModelName(c.name, current)) return false;
        const guardDecision = this._getRuntimeGuardDecision(c.name);
        if (!guardDecision.allowed) return false;
        // Param bounds from profile
        const req = profile.requirements;
        if (c.params && req.minParams && c.params < req.minParams) return false;
        if (c.params && req.maxParams && c.params > req.maxParams) return false;
        // Family/category match
        const familyMatch = profile.preferredFamilies.some(f => c.family === f || c.family.startsWith(f));
        const categoryMatch = profile.preferredCategories.includes(c.category);
        return familyMatch || categoryMatch;
      });

      for (const candidate of roleCandidates) {
        // v120.2: Enrich L1 (local) candidates with catalog data
        if (candidate.source === 'local' && _catalog?.getCatalogEntry) {
          const catEntry = _getCatalogEntryByIdentity(_catalog, candidate.name);
          if (catEntry) {
            if (!candidate.capabilities) candidate.capabilities = catEntry.capabilities;
            if (!candidate.benchmarks) candidate.benchmarks = catEntry.benchmarks;
            if (!candidate.contextWindow) candidate.contextWindow = catEntry.contextWindow;
            if (!candidate.baseVramMb) candidate.baseVramMb = catEntry.baseVramMb;
            if (!candidate.releaseDate) candidate.releaseDate = catEntry.releaseDate;
            if (!candidate.supersedes) candidate.supersedes = catEntry.supersedes;
          }
        }

        // Benchmark sanity: all benchmarks null → skip (except L4 provisional)
        if (candidate.benchmarks) {
          const hasAny = Object.values(candidate.benchmarks).some(v => v != null);
          if (!hasAny && !candidate.provisional) continue;
        } else if (candidate.source === 'catalog') {
          continue; // Catalog candidates without benchmarks are useless
        } else if (!candidate.provisional) {
          // Non-catalog, non-provisional without benchmarks — skip
        }

        // v121.1: Params jump guard — reject L4 candidates with >3× param increase
        if (candidate.provisional && candidate.params && currentEntry.params) {
          if (candidate.params / currentEntry.params > 3) continue;
        }

        // v121.1: Capability inheritance guard — L4 inherited caps must match role requirements
        if (candidate.provisional) {
          const reqCaps = ROLE_CAPABILITIES[role] || [];
          for (const cap of reqCaps) {
            if (!candidate.capabilities || !candidate.capabilities.includes(cap)) {
              continue; // Will be caught by checkFeasibility too, but skip early
            }
          }
        }

        // Compute effective VRAM if catalog entry available
        let effectiveVramMb = candidate.effectiveVramMb;
        if (!effectiveVramMb && _catalog?.computeEffectiveVram) {
          const entry = _getCatalogEntryByIdentity(_catalog, candidate.name);
          if (entry) effectiveVramMb = _catalog.computeEffectiveVram(entry);
        }

        // Feasibility gate
        const feasibility = checkFeasibility(
          { ...candidate, effectiveVramMb },
          role,
          hwContext
        );
        if (!feasibility.feasible) continue;

        // v120: Blacklist guard — skip candidates with very poor empirical performance
        if (_metricsCollector) {
          try {
            if (_metricsCollector.isBlacklisted(role, candidate.name)) continue;
          } catch (_) {}
        }

        // v120: Build empirical context for pairwise evaluation
        let empiricalCtx = {};
        if (_empiricalScorer && empiricalData.has(role)) {
          const roleData = empiricalData.get(role);
          const candMetrics = _getMapValueByModelIdentity(roleData, candidate.name);
          const curMetrics = _getMapValueByModelIdentity(roleData, current);
          const candSamples = candMetrics?.sampleCount ?? 0;
          const curSamples = curMetrics?.sampleCount ?? 0;

          // Drift detection — reset to Phase 2 weights if drifted
          let candDrifted = false;
          if (_metricsCollector && candSamples >= _empiricalScorer.MIN_SAMPLES) {
            try {
              const driftInfo = _metricsCollector.detectDrift(role, candidate.name);
              candDrifted = driftInfo?.drifted ?? false;
            } catch (_) {}
          }

          const candBlend = candDrifted
            ? { benchmarkWeight: 0.35, empiricalWeight: 0.00 }
            : _empiricalScorer.computeBlendWeights(candSamples);
          const curBlend = _empiricalScorer.computeBlendWeights(curSamples);

          const candEmpScore = (!candDrifted && candSamples >= _empiricalScorer.MIN_SAMPLES)
            ? _empiricalScorer.computeEmpiricalScore(candMetrics)
            : 0;
          const curEmpScore = (curSamples >= _empiricalScorer.MIN_SAMPLES)
            ? _empiricalScorer.computeEmpiricalScore(curMetrics)
            : 0;

          empiricalCtx = {
            candidate: { blendWeights: candBlend, empiricalScore: candEmpScore },
            current: { blendWeights: curBlend, empiricalScore: curEmpScore },
          };
        }

        // Pairwise evaluation
        const evalResult = _ranker.evaluateUpgrade(
          currentEntry,
          { ...candidate, effectiveVramMb },
          role,
          { gpuVramMb: hwContext.gpuVramMb, currentModel: currentEntry, roleBindings },
          empiricalCtx
        );

        if (!evalResult.shouldUpgrade) continue;

        // Preference penalty
        let adjustedDelta = evalResult.delta;
        if (_preferenceTracker && this._db) {
          const penalty = _preferenceTracker.computePreferencePenalty(
            role, candidate.family, candidate.params, this._db
          );
          adjustedDelta -= penalty;
          const threshold = _ranker.IMPROVEMENT_THRESHOLD[role] || 0.05;
          if (adjustedDelta < threshold) continue;
        }

        proposals.push({
          role,
          currentModel: current,
          candidateModel: candidate.name,
          score: evalResult.candidateScore,
          currentScore: evalResult.currentScore,
          improvement: evalResult.delta,
          scoreBreakdown: evalResult.breakdown,
          reason: evalResult.rejectReason || `+${(evalResult.delta * 100).toFixed(1)}% improvement`,
          riskLevel: evalResult.riskLevel,
          installed: candidate.installed,
          sizeGB: candidate.sizeGB || 0,
          source: candidate.source || 'local',
          catalogHash: _catalog?.CATALOG_HASH,
          evaluationVersion: _ranker?.EVALUATION_VERSION,
        });
      }
    }

    // Sort by improvement descending
    proposals.sort((a, b) => (b.improvement ?? 0) - (a.improvement ?? 0));

    // v121.1: Ranking candidate limit — top 8 per role to prevent instability
    const MAX_PER_ROLE = 8;
    const roleCounts = {};
    const limited = proposals.filter(p => {
      roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
      return roleCounts[p.role] <= MAX_PER_ROLE;
    });
    if (limited.length < proposals.length) {
      proposals.length = 0;
      proposals.push(...limited);
    }

    // Store in proposal store
    if (store) {
      try {
        const result = store.storeProposals(proposals);
        logger.info('UpgradeManager', `Stored ${result.stored} proposals (${result.skipped} skipped)`);
      } catch (err) {
        logger.warn('UpgradeManager', `Proposal store failed: ${err.message}`);
      }
    }

    // Registry verify (async non-blocking, fullCycle only)
    if (opts.fullCycle && config.features?.onlineDiscovery && this._registryClient) {
      const catalogCandidates = proposals.filter(p => p.source === 'catalog').map(p => p.candidateModel);
      if (catalogCandidates.length > 0) {
        this._registryClient.verifyBatch([...new Set(catalogCandidates.map(n => n.replace(/:.*/, '')))]).catch(() => {});
      }
    }

    return proposals;
  }

  /**
   * Get last check results (without re-running discovery).
   * @returns {{proposals: UpgradeProposal[]|null, discovery: DiscoveryResult|null}}
   */
  getLastResults() {
    return {
      proposals: this._lastProposals,
      discovery: this._lastDiscovery,
    };
  }

  /**
   * Format proposals for display.
   *
   * @param {Array<UpgradeProposal>} proposals
   * @returns {string}
   */
  static formatProposals(proposals) {
    if (!proposals || proposals.length === 0) {
      return 'No model upgrades available.';
    }

    const lines = ['## Model Upgrade Proposals', ''];

    // Group by role
    const byRole = new Map();
    for (const p of proposals) {
      if (!byRole.has(p.role)) byRole.set(p.role, []);
      byRole.get(p.role).push(p);
    }

    for (const [role, roleProposals] of byRole) {
      const current = roleProposals[0].currentModel;
      lines.push(`### ${role} (current: \`${current}\`)`);

      for (const p of roleProposals) {
        const risk = p.riskLevel === 'low' ? 'LOW' : p.riskLevel === 'medium' ? 'MED' : 'HIGH';
        const installed = p.installed ? '' : ' (not installed)';
        lines.push(`- \`${p.candidateModel}\` — score ${p.score}, risk ${risk}${installed}`);
        lines.push(`  ${p.reason}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Record an applied upgrade in history.
   * Called after user approves and upgrade is applied.
   *
   * @param {string} role
   * @param {string} fromModel
   * @param {string} toModel
   * @param {number} score
   */
  recordUpgrade(role, fromModel, toModel, score) {
    this._history.push({
      role,
      fromModel,
      toModel,
      score,
      timestamp: Date.now(),
    });
  }

  /**
   * Get upgrade history. Prefers DB when available, falls back to in-memory.
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
    return [...this._history];
  }

  /**
   * Get proposals above the notification threshold.
   * v118: Prefers proposal store (DB-backed) when available.
   * @returns {Array<UpgradeProposal>}
   */
  getNotifiableProposals() {
    // v118: Use proposal store if available
    const store = this._proposalStore || _proposalStore;
    if (store) {
      try {
        const dbProposals = store.getNotifiable(0.3); // 0.3 = ~normalized from 0-1 score
        if (dbProposals.length > 0) return dbProposals;
      } catch (_) {}
    }
    // Fallback to in-memory
    if (!this._lastProposals) return [];
    return this._lastProposals.filter(p => p.score >= MIN_NOTIFY_SCORE);
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

    // v126: Startup cleanup — expire pending proposals where candidate == active model
    if (this._db) {
      try {
        for (const [role, profile] of Object.entries(MODEL_PROFILES)) {
          const currentModel = profile.getCurrentModel();
          const aliases = modelNameAliases(currentModel);
          if (aliases.length === 0) continue;
          const placeholders = aliases.map(() => '?').join(', ');
          const result = this._db.prepare(`
            UPDATE upgrade_proposals
            SET status = 'expired', resolved_at = datetime('now')
            WHERE role = ? AND status = 'pending'
              AND lower(trim(candidate_model)) IN (${placeholders})
          `).run(role, ...aliases);
          if (result.changes > 0) {
            logger.info('UpgradeManager', `Startup cleanup: expired ${result.changes} stale proposals for ${role}`);
          }
        }
      } catch (err) {
        logger.warn('UpgradeManager', `Startup cleanup failed: ${err.message}`);
      }
    }

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
      // First poll, just store hash (initial check handles proposals)
      this._modelHash = hash;
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const upgradeManager = new UpgradeManager();

export default {
  filterCandidates, rankCandidates, generateProposals,
  checkFeasibility, UpgradeManager, upgradeManager, MIN_NOTIFY_SCORE,
};
