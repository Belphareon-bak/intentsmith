// v135: Health Analyzer — 6-dimension system health aggregator
// ══════════════════════════════════════════════════════════════════════════════
// Read-only. Each dimension: SQL aggregation → { score, status, details, trend, trendDirection, dataCompleteness }

import { logger } from '../../core/logger.js';
import { createRoleEvaluationPlans } from '../../eval/role-evaluation-plan.js';

const DIMENSION_WEIGHTS = {
  models: 0.25,
  cre: 0.15,
  architecture: 0.15,
  builds: 0.25,
  specialists: 0.10,
  upgrades: 0.10,
};

const STATUS_THRESHOLDS = { HEALTHY: 0.7, DEGRADED: 0.4 };

function classifyStatus(score) {
  if (score >= STATUS_THRESHOLDS.HEALTHY) return 'HEALTHY';
  if (score >= STATUS_THRESHOLDS.DEGRADED) return 'DEGRADED';
  return 'CRITICAL';
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function tableExists(db, name) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !!row;
  } catch { return false; }
}

function fallbackDimension(name, note) {
  return { score: 0.5, status: 'UNKNOWN', details: { note }, trend: 0, trendDirection: 'stable', dataCompleteness: 0.0 };
}

// ── Dimension: Models ─────────────────────────────────────────────────────────
function analyzeModels(db) {
  if (!tableExists(db, 'model_performance')) return fallbackDimension('models', 'table not found');
  try {
    const rows = db.prepare(
      "SELECT role, AVG(success) as sr, COUNT(*) as n FROM model_performance WHERE created_at >= datetime('now','-30 days') GROUP BY role"
    ).all();
    if (!rows.length) return fallbackDimension('models', 'no data in 30d');
    const totalN = rows.reduce((s, r) => s + r.n, 0);
    const avgSr = rows.reduce((s, r) => s + r.sr, 0) / rows.length;
    return {
      score: clamp(avgSr, 0, 1),
      status: classifyStatus(avgSr),
      details: { roles: rows.map(r => ({ role: r.role, success_rate: r.sr, samples: r.n })), total_samples: totalN },
      trend: 0, trendDirection: 'stable',
      dataCompleteness: Math.min(1, totalN / 50),
    };
  } catch (e) { return fallbackDimension('models', e.message); }
}

// ── Dimension: CRE ────────────────────────────────────────────────────────────
function analyzeCre(db) {
  if (!tableExists(db, 'telemetry_snapshots')) return fallbackDimension('cre', 'table not found');
  try {
    const snap = db.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN execution_status='success' AND partial_failure=0 THEN 1 ELSE 0 END) as ok, AVG(total_turn_time_ms) as avg_latency FROM telemetry_snapshots WHERE created_at >= datetime('now','-7 days')"
    ).get();
    const total = snap.total || 0;
    if (total === 0) return fallbackDimension('cre', 'no telemetry in 7d');

    let overrideCount = 0;
    if (tableExists(db, 'cre_override_log')) {
      const ov = db.prepare(
        "SELECT COUNT(*) as c FROM cre_override_log WHERE created_at >= datetime('now','-7 days')"
      ).get();
      overrideCount = ov.c || 0;
    }
    const successPct = snap.ok / total;
    const overrideRate = overrideCount / total;
    const score = clamp(successPct * 0.7 + (1 - overrideRate) * 0.3, 0, 1);
    return {
      score,
      status: classifyStatus(score),
      details: { total, success: snap.ok, override_count: overrideCount, override_rate: overrideRate, avg_latency_ms: snap.avg_latency },
      trend: 0, trendDirection: 'stable',
      dataCompleteness: Math.min(1, total / 100),
    };
  } catch (e) { return fallbackDimension('cre', e.message); }
}

// ── Dimension: Architecture ───────────────────────────────────────────────────
function analyzeArchitecture(db) {
  if (!tableExists(db, 'architecture_state')) return fallbackDimension('architecture', 'table not found');
  try {
    const row = db.prepare(
      "SELECT drift_score, layer_violations, circular_deps FROM architecture_state ORDER BY created_at DESC LIMIT 1"
    ).get();
    if (!row) return fallbackDimension('architecture', 'no records');
    const score = clamp(1 - (row.drift_score ?? 0), 0, 1);
    return {
      score,
      status: classifyStatus(score),
      details: { drift_score: row.drift_score, layer_violations: row.layer_violations, circular_deps: row.circular_deps },
      trend: 0, trendDirection: 'stable',
      dataCompleteness: 1.0,
    };
  } catch (e) { return fallbackDimension('architecture', e.message); }
}

// ── Dimension: Builds ─────────────────────────────────────────────────────────
function analyzeBuilds(db) {
  if (!tableExists(db, 'quality_scores')) return fallbackDimension('builds', 'table not found');
  try {
    const qs = db.prepare(
      "SELECT AVG(score) as avg_q, COUNT(*) as n FROM quality_scores WHERE created_at >= datetime('now','-30 days')"
    ).get();
    let cpRate = null;
    let cpCount = 0;
    if (tableExists(db, 'model_performance')) {
      const cp = db.prepare(
        "SELECT AVG(success) as cp_rate, COUNT(*) as n FROM model_performance WHERE task_type='checkpoint' AND created_at >= datetime('now','-30 days')"
      ).get();
      if (cp.n > 0) { cpRate = cp.cp_rate; cpCount = cp.n; }
    }
    const qCount = qs.n || 0;
    if (qCount === 0 && cpRate === null) return fallbackDimension('builds', 'no quality data in 30d');

    let score;
    if (qCount > 0 && cpRate !== null) {
      score = qs.avg_q * 0.6 + cpRate * 0.4;
    } else if (qCount > 0) {
      score = qs.avg_q;
    } else {
      score = cpRate;
    }
    score = clamp(score, 0, 1);
    return {
      score,
      status: classifyStatus(score),
      details: { avg_quality: qs.avg_q, quality_count: qCount, checkpoint_pass_rate: cpRate, checkpoint_count: cpCount },
      trend: 0, trendDirection: 'stable',
      dataCompleteness: Math.min(1, qCount / 20),
    };
  } catch (e) { return fallbackDimension('builds', e.message); }
}

// ── Dimension: Specialists ────────────────────────────────────────────────────
function analyzeSpecialists(db) {
  if (!tableExists(db, 'specialist_telemetry')) return fallbackDimension('specialists', 'table not found');
  try {
    const rows = db.prepare(
      "SELECT event_type, COUNT(*) as n FROM specialist_telemetry WHERE created_at >= datetime('now','-7 days') GROUP BY event_type"
    ).all();
    const totalAll = rows.reduce((s, r) => s + r.n, 0);
    if (totalAll === 0) return fallbackDimension('specialists', 'no events in 7d');
    // Only count outcome events for the score (success/fail/clarify), not observability events (match/memory/lifecycle/api)
    const OUTCOME_RE = /^tool\.(success|fail|clarify)$/;
    const outcomeRows = rows.filter(r => OUTCOME_RE.test(r.event_type));
    const outcomeTotal = outcomeRows.reduce((s, r) => s + r.n, 0);
    if (outcomeTotal === 0) return fallbackDimension('specialists', 'no outcome events in 7d');
    const successN = outcomeRows.filter(r => /success/.test(r.event_type)).reduce((s, r) => s + r.n, 0);
    const score = clamp(successN / outcomeTotal, 0, 1);
    return {
      score,
      status: classifyStatus(score),
      details: { events: rows.map(r => ({ type: r.event_type, count: r.n })), total: totalAll, outcome_total: outcomeTotal, success_count: successN },
      trend: 0, trendDirection: 'stable',
      dataCompleteness: Math.min(1, outcomeTotal / 30),
    };
  } catch (e) { return fallbackDimension('specialists', e.message); }
}

// ── Dimension: Upgrades ───────────────────────────────────────────────────────
function analyzeUpgrades(db) {
  try {
    const evaluation = { complete: 0, missing: [], failed: [], blocked: [], durable: 0 };
    if (tableExists(db, 'model_desired_bindings') && tableExists(db, 'model_evaluation_runs')) {
      const plans = createRoleEvaluationPlans();
      const desired = db.prepare(
        'SELECT role, digest_sha256 FROM model_desired_bindings ORDER BY role'
      ).all();
      evaluation.durable = desired.length;
      for (const binding of desired) {
        const plan = plans[binding.role];
        if (!plan) {
          evaluation.missing.push(binding.role);
          continue;
        }
        const row = db.prepare(`
          SELECT status
          FROM model_evaluation_runs
          WHERE model_digest_sha256 = ?
            AND suite_name = ?
            AND suite_contract_sha256 = ?
          ORDER BY CASE status WHEN 'COMPLETE' THEN 0 ELSE 1 END,
                   completed_at DESC,
                   run_id DESC
          LIMIT 1
        `).get(binding.digest_sha256, plan.suiteName, plan.suiteContractSha256);
        if (row?.status === 'COMPLETE') evaluation.complete++;
        else if (row?.status === 'FAILED') evaluation.failed.push(binding.role);
        else if (row?.status === 'BLOCKED') evaluation.blocked.push(binding.role);
        else evaluation.missing.push(binding.role);
      }
    }
    const incompleteCount = evaluation.missing.length + evaluation.failed.length + evaluation.blocked.length;
    const evaluationPenalty = incompleteCount > 0 || evaluation.durable < 7 ? 0.2 : 0;
    const score = clamp(1.0 - evaluationPenalty, 0, 1);
    return {
      score,
      status: classifyStatus(score),
      details: {
        current_evaluation_complete: evaluation.complete,
        current_evaluation_missing_roles: evaluation.missing,
        current_evaluation_failed_roles: evaluation.failed,
        current_evaluation_blocked_roles: evaluation.blocked,
        durable_binding_count: evaluation.durable,
        evaluation_penalty: evaluationPenalty,
      },
      trend: 0, trendDirection: 'stable',
      dataCompleteness: evaluation.durable / 7,
    };
  } catch (e) { return fallbackDimension('upgrades', e.message); }
}

// ── Trend Analysis ────────────────────────────────────────────────────────────
function applyTrends(dimensions, db) {
  // Load last 10 historical reports
  let history = [];
  try {
    if (tableExists(db, 'governor_reports')) {
      history = db.prepare(
        "SELECT dimensions FROM governor_reports ORDER BY created_at DESC LIMIT 10"
      ).all();
    }
  } catch { /* no history yet */ }

  if (!history.length) return dimensions;

  // Parse historical per-dimension scores
  const histScores = {};
  for (const dim of Object.keys(DIMENSION_WEIGHTS)) histScores[dim] = [];
  for (const row of history) {
    try {
      const parsed = JSON.parse(row.dimensions);
      for (const dim of Object.keys(DIMENSION_WEIGHTS)) {
        if (parsed[dim] && typeof parsed[dim].score === 'number') {
          histScores[dim].push(parsed[dim].score);
        }
      }
    } catch { /* skip corrupt rows */ }
  }

  // Apply trend to each dimension
  for (const dim of Object.keys(DIMENSION_WEIGHTS)) {
    const d = dimensions[dim];
    if (!d || d.status === 'UNKNOWN') continue;
    const scores = histScores[dim];
    if (!scores.length) continue;

    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const trend = d.score - avg;

    // trendScore maps trend to 0-1 range (0.5 = stable)
    const trendScore = 0.5 + clamp(trend / 0.4, -0.5, 0.5);
    d.score = clamp(d.score * 0.7 + trendScore * 0.3, 0, 1);
    d.trend = Math.round(trend * 1000) / 1000;
    d.trendDirection = trend > 0.05 ? 'improving' : trend < -0.05 ? 'declining' : 'stable';
    d.status = classifyStatus(d.score);
  }

  return dimensions;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const healthAnalyzer = {
  /**
   * Analyze system health across all 6 dimensions.
   * @param {import('better-sqlite3').Database} db
   * @returns {{ overallHealth: string, overallScore: number, dimensions: Object, summary: string }}
   */
  analyze(db) {
    const dimensions = {
      models: analyzeModels(db),
      cre: analyzeCre(db),
      architecture: analyzeArchitecture(db),
      builds: analyzeBuilds(db),
      specialists: analyzeSpecialists(db),
      upgrades: analyzeUpgrades(db),
    };

    // Apply trend analysis from historical reports
    applyTrends(dimensions, db);

    // Weighted overall score
    let overallScore = 0;
    for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
      overallScore += (dimensions[dim]?.score ?? 0.5) * weight;
    }
    overallScore = Math.round(overallScore * 1000) / 1000;

    // CRITICAL propagation: if any dimension is CRITICAL, overall can't be HEALTHY
    const hasCritical = Object.values(dimensions).some(d => d.status === 'CRITICAL');
    let overallHealth = classifyStatus(overallScore);
    if (hasCritical && overallHealth === 'HEALTHY') overallHealth = 'DEGRADED';

    // Czech summary
    const summary = _buildSummary(overallHealth, dimensions);

    return { overallHealth, overallScore, dimensions, summary };
  },
};

function _buildSummary(health, dims) {
  const critical = Object.entries(dims).filter(([, d]) => d.status === 'CRITICAL').map(([k]) => k);
  const degraded = Object.entries(dims).filter(([, d]) => d.status === 'DEGRADED').map(([k]) => k);
  const declining = Object.entries(dims).filter(([, d]) => d.trendDirection === 'declining').map(([k]) => k);

  if (health === 'HEALTHY' && !declining.length) return 'Systém je v pořádku.';
  if (health === 'HEALTHY' && declining.length) return `Systém je stabilní, ale ${declining.join(', ')} vykazuje klesající trend.`;
  if (critical.length) return `Kritický stav: ${critical.join(', ')}. Doporučena okamžitá akce.`;
  if (degraded.length) return `Zhoršený stav: ${degraded.join(', ')}. Zvažte návrhy na zlepšení.`;
  return 'Systém běží s drobným zhoršením.';
}

// Exported for testing
export { DIMENSION_WEIGHTS, classifyStatus, clamp, tableExists, fallbackDimension };
export { analyzeModels, analyzeCre, analyzeArchitecture, analyzeBuilds, analyzeSpecialists, analyzeUpgrades, applyTrends };
