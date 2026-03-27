// v135: System Governor — pipeline orchestrator
// ══════════════════════════════════════════════════════════════════════════════
// Pipeline: rate limit → idempotency → analyze → plan → guard → persist → WS diff
// Phase 1: Level 1 (analyze + propose only, no executor)

import { healthAnalyzer } from './health-analyzer.js';
import { improvementPlanner, computePriority } from './improvement-planner.js';
import { safetyGuard, COOLDOWN_HOURS } from './safety-guard.js';
import { logger } from '../../core/logger.js';

const RATE_LIMIT_MS = 30_000;
const IDEMPOTENT_SCORE_DELTA = 0.02;
const IDEMPOTENT_TIME_MS = 60_000;

class SystemGovernor {
  constructor() {
    this._db = null;
    this._lastRunTime = 0;
    this._lastReport = null;
    this._lastRuleIds = new Set();
    this._broadcast = null;
    this._stmts = null;
  }

  /**
   * Initialize with database handle. Must be called before runCheck().
   * @param {import('better-sqlite3').Database} db — raw better-sqlite3 instance
   */
  setDb(db) {
    this._db = db;
    this._stmts = {
      insertReport: db.prepare(
        `INSERT INTO governor_reports (overall_health, overall_score, dimensions, proposals_json, summary)
         VALUES (?, ?, ?, ?, ?)`
      ),
      insertProposal: db.prepare(
        `INSERT INTO governor_proposals (report_id, rule_id, type, severity, title, description, suggested_action, action_payload, confidence, priority, root_cause, hash, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      ),
      getLatestReport: db.prepare(
        `SELECT * FROM governor_reports ORDER BY created_at DESC LIMIT 1`
      ),
      getPendingProposals: db.prepare(
        `SELECT * FROM governor_proposals WHERE status = 'pending' ORDER BY priority DESC`
      ),
      getProposalById: db.prepare(
        `SELECT * FROM governor_proposals WHERE id = ?`
      ),
      approveProposal: db.prepare(
        `UPDATE governor_proposals SET status = 'approved', resolved_at = datetime('now') WHERE id = ? AND status = 'pending'`
      ),
      dismissProposal: db.prepare(
        `UPDATE governor_proposals SET status = 'dismissed', resolved_at = datetime('now'), cooldown_until = ? WHERE id = ? AND status = 'pending'`
      ),
      countPending: db.prepare(
        `SELECT COUNT(*) as c FROM governor_proposals WHERE status = 'pending'`
      ),
    };

    // Load last report for idempotency + post-restart status recovery
    try {
      const row = this._stmts.getLatestReport.get();
      if (row) {
        this._lastReport = {
          id: row.id,
          overallHealth: row.overall_health,
          overallScore: row.overall_score,
          dimensions: JSON.parse(row.dimensions),
          proposals: JSON.parse(row.proposals_json),
          summary: row.summary,
          created_at: row.created_at,
        };
        this._lastRunTime = new Date(row.created_at + 'Z').getTime() || 0;
      }
    } catch { /* first run — no governor_reports table yet */ }
  }

  /**
   * Set WS broadcast function. Called from server.js after WS is available.
   * @param {Function} broadcastFn — broadcast('control', payload)
   */
  setBroadcast(broadcastFn) {
    this._broadcast = broadcastFn;
  }

  /**
   * Run a full health check. Rate-limited and idempotent.
   * @returns {{ overallHealth, overallScore, dimensions, proposals, summary, skipped? }}
   */
  runCheck() {
    if (!this._db) throw new Error('Governor not initialized — call setDb() first');

    // Rate limit
    const now = Date.now();
    if (now - this._lastRunTime < RATE_LIMIT_MS) {
      const err = new Error('Rate limited');
      err.code = 'RATE_LIMITED';
      throw err;
    }

    // Analyze
    const analysis = healthAnalyzer.analyze(this._db);

    // Idempotency: skip if minimal change and recent
    if (this._lastReport && (now - this._lastRunTime < IDEMPOTENT_TIME_MS)) {
      const delta = Math.abs(analysis.overallScore - this._lastReport.overallScore);
      if (delta < IDEMPOTENT_SCORE_DELTA) {
        // Quick check: would any new rules fire?
        const proposals = improvementPlanner.evaluate(analysis, this._db);
        const newRuleIds = new Set(proposals.map(p => p.rule_id));
        const hasNewRules = [...newRuleIds].some(id => !this._lastRuleIds.has(id));
        if (!hasNewRules) {
          return { ...this._lastReport, skipped: true };
        }
      }
    }

    // Plan
    const rawProposals = improvementPlanner.evaluate(analysis, this._db);

    // Add priority (needs isNew check against DB)
    for (const p of rawProposals) {
      const isNew = !this._lastRuleIds.has(p.rule_id);
      p.priority = computePriority(p.severity, p.confidence, isNew);
    }

    // Guard
    const safeProposals = safetyGuard.filterSafe(rawProposals, this._db);

    // Sort by priority DESC
    safeProposals.sort((a, b) => b.priority - a.priority);

    // Persist report
    const prevHealth = this._lastReport?.overallHealth;
    const prevScore = this._lastReport?.overallScore ?? 0;
    const prevPending = this._countPending();

    const reportResult = this._stmts.insertReport.run(
      analysis.overallHealth,
      analysis.overallScore,
      JSON.stringify(analysis.dimensions),
      JSON.stringify(safeProposals),
      analysis.summary,
    );
    const reportId = reportResult.lastInsertRowid;

    // Persist proposals
    const newProposalIds = [];
    for (const p of safeProposals) {
      const result = this._stmts.insertProposal.run(
        reportId,
        p.rule_id, p.type, p.severity, p.title, p.description,
        p.suggested_action || null,
        p.action_payload || null,
        p.confidence, p.priority,
        p.root_cause || null,
        p.hash,
      );
      newProposalIds.push({ id: Number(result.lastInsertRowid), title: p.title, severity: p.severity });
    }

    // Update cached state
    this._lastRunTime = now;
    this._lastRuleIds = new Set(rawProposals.map(p => p.rule_id));
    this._lastReport = {
      id: Number(reportId),
      overallHealth: analysis.overallHealth,
      overallScore: analysis.overallScore,
      dimensions: analysis.dimensions,
      proposals: safeProposals,
      summary: analysis.summary,
      created_at: new Date().toISOString(),
    };

    // WS diff broadcast
    const currentPending = this._countPending();
    this._broadcastDiff({
      overallHealth: analysis.overallHealth,
      overallScore: analysis.overallScore,
      diff: {
        newProposals: newProposalIds,
        resolvedCount: Math.max(0, prevPending - currentPending + newProposalIds.length),
        healthChanged: prevHealth !== analysis.overallHealth,
        scoreChange: Math.round((analysis.overallScore - prevScore) * 1000) / 1000,
      },
    });

    return this._lastReport;
  }

  /**
   * Get governor status (lightweight, no analysis).
   */
  getStatus() {
    if (!this._db) return { enabled: false };
    const pending = this._countPending();
    return {
      enabled: true,
      lastCheckTime: this._lastRunTime > 0 ? new Date(this._lastRunTime).toISOString() : null,
      overallHealth: this._lastReport?.overallHealth ?? null,
      overallScore: this._lastReport?.overallScore ?? null,
      proposalCount: pending,
    };
  }

  /**
   * Get latest full report with parsed dimensions.
   */
  getLatestReport() {
    if (!this._db) return null;
    if (this._lastReport?.dimensions) return this._lastReport;
    try {
      const row = this._stmts.getLatestReport.get();
      if (!row) return null;
      return {
        id: row.id,
        overallHealth: row.overall_health,
        overallScore: row.overall_score,
        dimensions: JSON.parse(row.dimensions),
        proposals: JSON.parse(row.proposals_json),
        summary: row.summary,
        created_at: row.created_at,
      };
    } catch { return null; }
  }

  /**
   * Get proposals, optionally filtered by status.
   * @param {string} [status] — 'pending' | 'approved' | 'dismissed'. Default: 'pending'
   */
  getProposals(status = 'pending') {
    if (!this._db) return [];
    try {
      if (status === 'pending') return this._stmts.getPendingProposals.all();
      return this._db.prepare(
        `SELECT * FROM governor_proposals WHERE status = ? ORDER BY priority DESC`
      ).all(status);
    } catch { return []; }
  }

  /**
   * Approve a proposal. No executor in Phase 1 — user acts manually.
   * @param {number} id
   * @returns {{ success: boolean, proposal?: Object }}
   */
  approveProposal(id) {
    if (!this._db) throw new Error('Governor not initialized');
    const proposal = this._stmts.getProposalById.get(id);
    if (!proposal) return { success: false, error: 'not_found' };
    if (proposal.status !== 'pending') return { success: false, error: 'not_pending' };
    this._stmts.approveProposal.run(id);
    return { success: true, proposal: { ...proposal, status: 'approved' } };
  }

  /**
   * Dismiss a proposal with severity-based cooldown.
   * @param {number} id
   * @returns {{ success: boolean, proposal?: Object }}
   */
  dismissProposal(id) {
    if (!this._db) throw new Error('Governor not initialized');
    const proposal = this._stmts.getProposalById.get(id);
    if (!proposal) return { success: false, error: 'not_found' };
    if (proposal.status !== 'pending') return { success: false, error: 'not_pending' };

    const hours = COOLDOWN_HOURS[proposal.severity] || 24;
    // Store in SQLite-compatible format (YYYY-MM-DD HH:MM:SS) for datetime('now') comparison
    const d = new Date(Date.now() + hours * 3600_000);
    const cooldownUntil = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0') + ' ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' +
      String(d.getUTCMinutes()).padStart(2, '0') + ':' +
      String(d.getUTCSeconds()).padStart(2, '0');
    this._stmts.dismissProposal.run(cooldownUntil, id);
    return { success: true, proposal: { ...proposal, status: 'dismissed', cooldown_until: cooldownUntil } };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _countPending() {
    try {
      return this._stmts.countPending.get().c;
    } catch { return 0; }
  }

  _broadcastDiff(payload) {
    if (typeof this._broadcast === 'function') {
      try {
        this._broadcast('control', { action: 'governor_report', ...payload });
      } catch (e) {
        logger.warn('Governor', `WS broadcast failed: ${e.message}`);
      }
    }
  }

  // Phase 2 hook (reserved — no implementation in v135)
  // async _advancedAnalysis(report) { /* future: LLM reviews health report */ }
}

export const systemGovernor = new SystemGovernor();
