// Lifecycle REVIEW Phase — Project Review + Drift Detection
// ══════════════════════════════════════════════════════════════════════════════
// Triggered every N milestones (config.reviewFrequency).
// Runs 4 drift checks:
//   1. Spec Alignment — are spec goals being addressed?
//   2. Scope Creep — is anything built that's NOT in spec?
//   3. Architecture Consistency — structural deviations?
//   4. Tech Debt — complexity/debt trends from health scores?
//
// IMPORTANT: All findings are ADVISORY with confidence levels.
// User decides actions — this is not a blocking gate.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callLLM, parseJSON } from './workflow.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  roadmapVersions,
  driftChecks,
} from '../db/database.js';
import { projectReview as projectReviewPrompt } from './lifecycle-prompts.js';
import { ProjectPhase } from './lifecycle.js';

// ─── Drift Check Types ───────────────────────────────────────────────────────

export const DriftCheckType = Object.freeze({
  SPEC_ALIGNMENT:         'SPEC_ALIGNMENT',
  SCOPE_CREEP:            'SCOPE_CREEP',
  ARCHITECTURE_CONSISTENCY: 'ARCHITECTURE_CONSISTENCY',
  TECH_DEBT:              'TECH_DEBT',
});

// ─── Trigger Project Review ──────────────────────────────────────────────────

/**
 * Run a comprehensive project review with 4 drift checks.
 * Called when lifecycle.isReviewDue() returns true.
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @returns {Promise<Object>} Review results with recommendations
 */
export async function triggerProjectReview(lifecycle) {
  logger.info('LifecycleReview', 'Starting PROJECT_REVIEW', { lifecycleId: lifecycle.id });

  // Gather data
  const spec = lifecycleRepo.getSpec(lifecycle.id);
  const latestRoadmap = roadmapVersions.getLatestRoadmap(lifecycle.id);
  const completed = msRepo.getCompleted(lifecycle.id);

  if (!spec || !latestRoadmap) {
    throw new Error('Cannot run project review without spec and roadmap');
  }

  // Collect health scores from completed milestones
  const healthScores = completed
    .filter(m => m.health_score)
    .map(m => ({
      milestoneId: m.id,
      title: m.title,
      healthScore: m.health_score,
    }));

  // Run LLM-based review (all 4 checks in one prompt)
  const prompt = projectReviewPrompt(
    spec,
    latestRoadmap.roadmap,
    completed,
    healthScores
  );

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('R1', prompt);
  const review = parseJSON(result.content);

  if (!review) {
    logger.warn('LifecycleReview', 'Review parse failed', { lifecycleId: lifecycle.id });
    return { success: false, raw: result.content };
  }

  // Store individual drift checks
  const checks = [];

  if (review.spec_alignment) {
    const checkResult = review.spec_alignment;
    driftChecks.addCheck(
      lifecycle.id, null,
      DriftCheckType.SPEC_ALIGNMENT,
      assessResult(checkResult),
      checkResult
    );
    checks.push({ type: DriftCheckType.SPEC_ALIGNMENT, result: assessResult(checkResult), ...checkResult });
  }

  if (review.scope_creep) {
    const checkResult = review.scope_creep;
    driftChecks.addCheck(
      lifecycle.id, null,
      DriftCheckType.SCOPE_CREEP,
      assessResult(checkResult),
      checkResult
    );
    checks.push({ type: DriftCheckType.SCOPE_CREEP, result: assessResult(checkResult), ...checkResult });
  }

  if (review.architecture_consistency) {
    const checkResult = review.architecture_consistency;
    driftChecks.addCheck(
      lifecycle.id, null,
      DriftCheckType.ARCHITECTURE_CONSISTENCY,
      assessResult(checkResult),
      checkResult
    );
    checks.push({ type: DriftCheckType.ARCHITECTURE_CONSISTENCY, result: assessResult(checkResult), ...checkResult });
  }

  if (review.tech_debt) {
    const checkResult = review.tech_debt;
    driftChecks.addCheck(
      lifecycle.id, null,
      DriftCheckType.TECH_DEBT,
      assessResult(checkResult),
      checkResult
    );
    checks.push({ type: DriftCheckType.TECH_DEBT, result: assessResult(checkResult), ...checkResult });
  }

  logger.info('LifecycleReview', 'PROJECT_REVIEW complete', {
    lifecycleId: lifecycle.id,
    overallHealth: review.overall_health,
    checksCount: checks.length,
  });

  return {
    success: true,
    overallHealth: review.overall_health || 'UNKNOWN',
    checks,
    recommendations: review.recommendations || [],
    completedMilestones: completed.length,
    totalMilestones: msRepo.listByLifecycle(lifecycle.id).length,
  };
}

// ─── Get Drift History ───────────────────────────────────────────────────────

/**
 * Get drift check history for display.
 * @param {string} lifecycleId
 * @returns {{ checks: Object[], trend: string }}
 */
export function getDriftHistory(lifecycleId) {
  const allChecks = driftChecks.getChecks(lifecycleId);

  // Group by type
  const byType = {};
  for (const check of allChecks) {
    if (!byType[check.check_type]) byType[check.check_type] = [];
    byType[check.check_type].push(check);
  }

  // Determine trend per type
  const trends = {};
  for (const [type, typeChecks] of Object.entries(byType)) {
    if (typeChecks.length < 2) {
      trends[type] = 'INSUFFICIENT_DATA';
      continue;
    }

    // Compare latest 2
    const latest = typeChecks[0]; // sorted DESC
    const previous = typeChecks[1];
    if (latest.result === previous.result) {
      trends[type] = 'STABLE';
    } else if (latest.result === 'PASS' && previous.result !== 'PASS') {
      trends[type] = 'IMPROVING';
    } else {
      trends[type] = 'DEGRADING';
    }
  }

  // Overall trend
  const trendValues = Object.values(trends);
  let overallTrend = 'STABLE';
  if (trendValues.includes('DEGRADING')) overallTrend = 'DEGRADING';
  else if (trendValues.length > 0 && trendValues.every(t => t === 'IMPROVING' || t === 'INSUFFICIENT_DATA')) {
    overallTrend = trendValues.some(t => t === 'IMPROVING') ? 'IMPROVING' : 'STABLE';
  }

  return {
    checks: allChecks,
    trends,
    overallTrend,
    totalChecks: allChecks.length,
  };
}

// ─── Health Score Aggregation ────────────────────────────────────────────────

/**
 * Compute aggregate health metrics across all completed milestones.
 * @param {string} lifecycleId
 * @returns {{ averages: Object, trend: string, milestoneCount: number }}
 */
export function getAggregateHealth(lifecycleId) {
  const completed = msRepo.getCompleted(lifecycleId);
  const withHealth = completed.filter(m => m.health_score);

  if (withHealth.length === 0) {
    return {
      averages: { scope_adherence: 0, test_coverage: 0, complexity_delta: 0, tech_debt_delta: 0 },
      trend: 'NO_DATA',
      milestoneCount: 0,
    };
  }

  // Compute averages
  const sums = { scope_adherence: 0, test_coverage: 0, complexity_delta: 0, tech_debt_delta: 0 };
  for (const ms of withHealth) {
    const h = ms.health_score;
    sums.scope_adherence += h.scope_adherence || 0;
    sums.test_coverage += h.test_coverage || 0;
    sums.complexity_delta += h.complexity_delta || 0;
    sums.tech_debt_delta += h.tech_debt_delta || 0;
  }

  const count = withHealth.length;
  const averages = {
    scope_adherence: round2(sums.scope_adherence / count),
    test_coverage: round2(sums.test_coverage / count),
    complexity_delta: round2(sums.complexity_delta / count),
    tech_debt_delta: round2(sums.tech_debt_delta / count),
  };

  // Trend from last 3 milestones vs first 3
  let trend = 'STABLE';
  if (count >= 6) {
    const recent = withHealth.slice(0, 3);
    const early = withHealth.slice(-3);
    const recentDebt = avg(recent.map(m => m.health_score.tech_debt_delta || 0));
    const earlyDebt = avg(early.map(m => m.health_score.tech_debt_delta || 0));
    if (recentDebt > earlyDebt + 0.1) trend = 'DEGRADING';
    else if (recentDebt < earlyDebt - 0.1) trend = 'IMPROVING';
  }

  return { averages, trend, milestoneCount: count };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine check result from LLM output.
 * Maps severity/confidence to PASS/WARN/FAIL.
 */
function assessResult(checkResult) {
  // scope_creep has severity
  if (checkResult.severity) {
    if (checkResult.severity === 'NONE') return 'PASS';
    if (checkResult.severity === 'LOW') return 'WARN';
    return 'FAIL';
  }
  // architecture has consistent boolean
  if (typeof checkResult.consistent === 'boolean') {
    return checkResult.consistent ? 'PASS' : 'WARN';
  }
  // tech_debt has trend
  if (checkResult.trend) {
    if (checkResult.trend === 'DECREASING' || checkResult.trend === 'STABLE') return 'PASS';
    return 'WARN';
  }
  // spec_alignment: check for unaddressed goals
  if (checkResult.unaddressed_goals && checkResult.unaddressed_goals.length > 0) {
    return 'WARN';
  }
  return 'PASS';
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function avg(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export default {
  DriftCheckType,
  triggerProjectReview,
  getDriftHistory,
  getAggregateHealth,
};
