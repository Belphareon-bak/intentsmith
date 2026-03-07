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
   * Get upgrade history.
   * @returns {Array}
   */
  getHistory() {
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
