// Upgrade Manager v103 — Self-Evaluating Model Registry
// ══════════════════════════════════════════════════════════════════════════════
//
// Orchestrates the model upgrade pipeline:
//   discover → filter → rank → propose
//
// NEVER auto-upgrades. Always produces proposals for user approval.
//
// Phase 1: Local discovery + ranking + proposals.
// Phase 2: Validation suites + monitoring + rollback.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { MODEL_PROFILES, parseModelName, isNewerVersion, isSameFamily } from './model-profiles.js';
import { discover, getUpgradeHints, fetchInstalledModels } from './model-discovery.js';

// Minimum score for user-facing notifications (lower proposals exist but are silent)
export const MIN_NOTIFY_SCORE = 6;

// ─── Candidate Filtering ────────────────────────────────────────────────────

/**
 * Filter candidates against a role profile's requirements.
 *
 * @param {Array<ModelCandidate>} candidates
 * @param {Object} profile - From MODEL_PROFILES
 * @returns {Array<ModelCandidate>}
 */
export function filterCandidates(candidates, profile) {
  const { requirements, preferredFamilies, preferredCategories } = profile;

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
    if (c.name === current) return false;

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
    const filtered = filterCandidates(candidates, profile);
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

      // Verify model is installed
      const installed = await fetchInstalledModels();
      if (!installed.some(m => m.name === targetModel)) {
        throw new Error(`Model not installed in Ollama: ${targetModel}`);
      }

      // Check not already set
      const previousModel = config.models[role];
      if (previousModel === targetModel) {
        throw new Error(`${role} is already set to ${targetModel}`);
      }

      // Hot-swap
      config.models[role] = targetModel;

      // Verify
      let verified = false;
      if (!opts.skipVerify) {
        verified = await this._verifyModel(targetModel);
        if (!verified) {
          config.models[role] = previousModel;
          throw new Error(`Verification failed: ${targetModel} did not respond`);
        }
      } else {
        verified = true;
      }

      // Persist
      const appliedBy = opts.appliedBy || 'user';
      if (this._db) {
        this._persistOverride(role, targetModel, previousModel, opts.score, appliedBy);
        this._recordHistory(role, previousModel, targetModel, opts.score, 'apply');
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

    // Verify previous model is still installed
    const installed = await fetchInstalledModels();
    if (!installed.some(m => m.name === previousModel)) {
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

    // Remove override from DB
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
    const timeout = 15000;

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
          options: { num_predict: 1 },
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

      const boundModels = new Set(Object.values(config.models));
      return rows
        .filter(r => !boundModels.has(r.previous_model))
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
   * Run full check: discover → filter → rank → propose.
   *
   * @param {Object} [opts]
   * @param {string} [opts.baseUrl] - Ollama URL override
   * @param {number} [opts.minScore] - Minimum proposal score
   * @returns {Promise<{proposals: UpgradeProposal[], discovery: DiscoveryResult}>}
   */
  async checkForUpgrades(opts = {}) {
    const discovery = await discover(opts);
    this._lastDiscovery = discovery;

    const proposals = generateProposals(discovery.candidates, {
      minScore: opts.minScore ?? 4,
      maxProposalsPerRole: opts.maxProposalsPerRole ?? 3,
    });
    this._lastProposals = proposals;

    this._lastCheckTime = Date.now();

    // Store model hash for change detection
    this._modelHash = discovery.candidates.map(c => c.name).sort().join(',');

    logger.info('UpgradeManager', `Check complete: ${proposals.length} proposals from ${discovery.candidates.length} models`, {
      ollamaAvailable: discovery.ollamaAvailable,
      hintsCount: discovery.hints.size,
    });

    return { proposals, discovery };
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
   * @returns {Array<UpgradeProposal>}
   */
  getNotifiableProposals() {
    if (!this._lastProposals) return [];
    return this._lastProposals.filter(p => p.score >= MIN_NOTIFY_SCORE);
  }

  // ─── Lifecycle: Periodic Check + Ollama Poll ─────────────────────────────

  /**
   * Start background lifecycle: initial check + periodic recheck + model change poll.
   *
   * @param {Object} [opts]
   * @param {number} [opts.recheckMs=86400000] - Recheck interval (default 24h)
   * @param {number} [opts.pollMs=300000] - Ollama poll interval (default 5min)
   * @param {string} [opts.baseUrl] - Ollama URL override
   */
  startPeriodicCheck(opts = {}) {
    if (this._active) return;
    this._active = true;

    const recheckMs = opts.recheckMs ?? 24 * 60 * 60 * 1000;
    const pollMs = opts.pollMs ?? 5 * 60 * 1000;
    const checkOpts = { baseUrl: opts.baseUrl };

    // Initial check (fire-and-forget)
    this.checkForUpgrades(checkOpts).catch(err =>
      logger.warn('UpgradeManager', `Startup check failed: ${err.message}`)
    );

    // Periodic full recheck (24h default)
    this._recheckInterval = setInterval(() => {
      this.checkForUpgrades(checkOpts).catch(err =>
        logger.warn('UpgradeManager', `Periodic check failed: ${err.message}`)
      );
    }, recheckMs);
    this._recheckInterval.unref();

    // Ollama model change poll (5min default)
    this._pollInterval = setInterval(() => {
      this._pollModelChanges(checkOpts).catch(() => {});
    }, pollMs);
    this._pollInterval.unref();

    logger.info('UpgradeManager', `Periodic check started (recheck: ${recheckMs / 3600000}h, poll: ${pollMs / 60000}min)`);
  }

  /**
   * Stop periodic checks.
   */
  stopPeriodicCheck() {
    if (this._recheckInterval) { clearInterval(this._recheckInterval); this._recheckInterval = null; }
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
  UpgradeManager, upgradeManager, MIN_NOTIFY_SCORE,
};
