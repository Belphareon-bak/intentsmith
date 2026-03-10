// Proposal Store v118 — DB-backed upgrade proposal lifecycle
// ══════════════════════════════════════════════════════════════════════════════
//
// States: pending → approved | rejected (cooldown 30d) | dismissed (permanent) | expired (7d)
//
// Anti-thrashing: MIN_UPGRADE_INTERVAL = 14 days per role
// Dedup: same (role, candidate, hash, evalVer) → update score
// Max 3 proposals per role per cycle
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

const MAX_PROPOSALS_PER_ROLE = 3;
const MIN_UPGRADE_INTERVAL_DAYS = 14;
const DEFAULT_COOLDOWN_DAYS = 30;
const DEFAULT_EXPIRE_DAYS = 7;

export class ProposalStore {
  constructor() {
    this._db = null;
  }

  setDb(db) {
    this._db = db;
  }

  // ── Store ────────────────────────────────────────────────────────────────

  /**
   * Store a single proposal if not duplicate and not in cooldown/dismissed.
   * @returns {{ stored: boolean, reason?: string }}
   */
  storeProposal(proposal) {
    if (!this._db) return { stored: false, reason: 'no db' };

    const { role, candidateModel, catalogHash, evaluationVersion } = proposal;

    // Check dismissed
    if (this.isDismissed(role, candidateModel)) {
      return { stored: false, reason: 'dismissed' };
    }

    // Check cooldown
    if (this.isInCooldown(role, candidateModel)) {
      return { stored: false, reason: 'cooldown' };
    }

    // Check dedup — same (role, candidate, hash, evalVer) pending → update
    const existing = this._db.prepare(`
      SELECT id FROM upgrade_proposals
      WHERE role = ? AND candidate_model = ? AND catalog_hash = ? AND evaluation_version = ? AND status = 'pending'
    `).get(role, candidateModel, catalogHash || null, evaluationVersion || null);

    if (existing) {
      this._db.prepare(`
        UPDATE upgrade_proposals
        SET score = ?, current_score = ?, improvement = ?, score_breakdown = ?,
            reason = ?, risk_level = ?, installed = ?, size_gb = ?, source = ?,
            current_model = ?, detected_at = datetime('now')
        WHERE id = ?
      `).run(
        proposal.score, proposal.currentScore ?? null, proposal.improvement ?? null,
        proposal.scoreBreakdown ? JSON.stringify(proposal.scoreBreakdown) : null,
        proposal.reason ?? null, proposal.riskLevel ?? 'medium',
        proposal.installed ? 1 : 0, proposal.sizeGB ?? 0, proposal.source ?? 'local',
        proposal.currentModel, existing.id
      );
      return { stored: true, reason: 'updated' };
    }

    // Allow re-propose if current_model changed (upgrade chain)
    const existingDifferentCurrent = this._db.prepare(`
      SELECT id FROM upgrade_proposals
      WHERE role = ? AND candidate_model = ? AND status = 'pending' AND current_model != ?
    `).get(role, candidateModel, proposal.currentModel);

    if (existingDifferentCurrent) {
      // Current model changed — expire old proposal, insert new
      this._db.prepare(`
        UPDATE upgrade_proposals SET status = 'expired', resolved_at = datetime('now') WHERE id = ?
      `).run(existingDifferentCurrent.id);
    }

    // Insert new
    this._db.prepare(`
      INSERT INTO upgrade_proposals
        (role, current_model, candidate_model, score, current_score, improvement,
         score_breakdown, reason, risk_level, installed, size_gb, source, status,
         catalog_hash, evaluation_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      role, proposal.currentModel, candidateModel,
      proposal.score, proposal.currentScore ?? null, proposal.improvement ?? null,
      proposal.scoreBreakdown ? JSON.stringify(proposal.scoreBreakdown) : null,
      proposal.reason ?? null, proposal.riskLevel ?? 'medium',
      proposal.installed ? 1 : 0, proposal.sizeGB ?? 0, proposal.source ?? 'local',
      catalogHash || null, evaluationVersion || null
    );

    return { stored: true, reason: 'new' };
  }

  /**
   * Bulk store proposals. Enforces max 3 per role (keeps highest score).
   * @param {Array} proposals
   * @returns {{ stored: number, skipped: number }}
   */
  storeProposals(proposals) {
    if (!this._db) return { stored: 0, skipped: 0 };

    // Group by role, sort by score desc, take top MAX_PROPOSALS_PER_ROLE
    const byRole = new Map();
    for (const p of proposals) {
      if (!byRole.has(p.role)) byRole.set(p.role, []);
      byRole.get(p.role).push(p);
    }

    let stored = 0;
    let skipped = 0;

    for (const [, roleProposals] of byRole) {
      roleProposals.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const limited = roleProposals.slice(0, MAX_PROPOSALS_PER_ROLE);

      for (const p of limited) {
        const result = this.storeProposal(p);
        if (result.stored) stored++;
        else skipped++;
      }

      skipped += roleProposals.length - limited.length;
    }

    return { stored, skipped };
  }

  // ── State transitions ────────────────────────────────────────────────────

  approve(proposalId) {
    if (!this._db) return;
    this._db.prepare(`
      UPDATE upgrade_proposals SET status = 'approved', resolved_at = datetime('now') WHERE id = ?
    `).run(proposalId);
  }

  reject(proposalId, cooldownDays = DEFAULT_COOLDOWN_DAYS) {
    if (!this._db) return;
    this._db.prepare(`
      UPDATE upgrade_proposals
      SET status = 'rejected', resolved_at = datetime('now'),
          cooldown_until = datetime('now', '+' || ? || ' days')
      WHERE id = ?
    `).run(cooldownDays, proposalId);
  }

  dismiss(proposalId) {
    if (!this._db) return;
    // Dismissed = permanent block (cooldown_until far future)
    this._db.prepare(`
      UPDATE upgrade_proposals
      SET status = 'dismissed', resolved_at = datetime('now'),
          cooldown_until = datetime('now', '+3650 days')
      WHERE id = ?
    `).run(proposalId);
  }

  // ── Expiration & invalidation ────────────────────────────────────────────

  expireStale(maxAgeDays = DEFAULT_EXPIRE_DAYS) {
    if (!this._db) return 0;
    const result = this._db.prepare(`
      UPDATE upgrade_proposals
      SET status = 'expired', resolved_at = datetime('now')
      WHERE status = 'pending'
        AND detected_at < datetime('now', '-' || ? || ' days')
    `).run(maxAgeDays);
    return result.changes;
  }

  /**
   * Invalidate proposals with stale catalog hash or evaluation version.
   */
  invalidateStale(currentHash, currentEvalVersion) {
    if (!this._db) return 0;
    const result = this._db.prepare(`
      UPDATE upgrade_proposals
      SET status = 'expired', resolved_at = datetime('now')
      WHERE status = 'pending'
        AND (catalog_hash IS NOT NULL AND catalog_hash != ?)
        OR  (evaluation_version IS NOT NULL AND evaluation_version != ?)
    `).run(currentHash, currentEvalVersion);
    return result.changes;
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  isInCooldown(role, candidateModel) {
    if (!this._db) return false;
    const row = this._db.prepare(`
      SELECT 1 FROM upgrade_proposals
      WHERE role = ? AND candidate_model = ?
        AND status IN ('rejected')
        AND cooldown_until > datetime('now')
      LIMIT 1
    `).get(role, candidateModel);
    return !!row;
  }

  isDismissed(role, candidateModel) {
    if (!this._db) return false;
    const row = this._db.prepare(`
      SELECT 1 FROM upgrade_proposals
      WHERE role = ? AND candidate_model = ? AND status = 'dismissed'
      LIMIT 1
    `).get(role, candidateModel);
    return !!row;
  }

  /**
   * Check anti-thrashing: was an upgrade applied for this role within MIN_UPGRADE_INTERVAL?
   * @returns {{ blocked: boolean, lastUpgradeAt?: string }}
   */
  isAntiThrashing(role, db) {
    // Uses upgrade_history table (from migration 030)
    const historyDb = db || this._db;
    if (!historyDb) return { blocked: false };

    try {
      const row = historyDb.prepare(`
        SELECT created_at FROM upgrade_history
        WHERE role = ? AND action = 'apply'
        ORDER BY created_at DESC LIMIT 1
      `).get(role);

      if (!row) return { blocked: false };

      const lastUpgradeMs = Date.parse(row.created_at);
      const intervalMs = MIN_UPGRADE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

      if (Date.now() - lastUpgradeMs < intervalMs) {
        return { blocked: true, lastUpgradeAt: row.created_at };
      }
    } catch (_) {}

    return { blocked: false };
  }

  getActiveProposals() {
    if (!this._db) return [];
    return this._db.prepare(`
      SELECT * FROM upgrade_proposals WHERE status = 'pending' ORDER BY score DESC
    `).all();
  }

  getPendingForRole(role) {
    if (!this._db) return [];
    return this._db.prepare(`
      SELECT * FROM upgrade_proposals WHERE role = ? AND status = 'pending' ORDER BY score DESC
    `).all(role);
  }

  getNotifiable(minScore = 6) {
    if (!this._db) return [];
    return this._db.prepare(`
      SELECT * FROM upgrade_proposals
      WHERE status = 'pending' AND score >= ?
      ORDER BY score DESC
    `).all(minScore);
  }

  getHistory(opts = {}) {
    if (!this._db) return [];
    const { status, role, limit = 50 } = opts;

    let sql = 'SELECT * FROM upgrade_proposals WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }

    sql += ' ORDER BY detected_at DESC LIMIT ?';
    params.push(limit);

    return this._db.prepare(sql).all(...params);
  }

  /**
   * Find a pending proposal matching role + candidateModel.
   */
  findPending(role, candidateModel) {
    if (!this._db) return null;
    return this._db.prepare(`
      SELECT * FROM upgrade_proposals
      WHERE role = ? AND candidate_model = ? AND status = 'pending'
      ORDER BY detected_at DESC LIMIT 1
    `).get(role, candidateModel) || null;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const proposalStore = new ProposalStore();

export default { ProposalStore, proposalStore, MAX_PROPOSALS_PER_ROLE, MIN_UPGRADE_INTERVAL_DAYS };
