// Quality Report — Aggregate Analytics for Quality Scores
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure computation over quality_scores DB table.
// No LLM calls. Provides:
//   - getSummary(sinceDays)      → mean, median, stddev, min/max, distribution
//   - getProjectReport(lifecycleId) → per-project scores + trend
//   - getDistribution(sinceDays) → histogram buckets
//   - getVolatilityIndex(lifecycleId) → avg abs delta of lifecycle_score
//
// ══════════════════════════════════════════════════════════════════════════════

import { db } from '../db/database.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n) { return Math.round(n * 100) / 100; }

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function stddev(values, mean) {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return Math.sqrt(sumSq / values.length);
}

function scoreLabel(score) {
  if (score >= 0.85) return 'EXCELLENT';
  if (score >= 0.70) return 'GOOD';
  if (score >= 0.55) return 'ACCEPTABLE';
  return 'WEAK';
}

function sinceClause(sinceDays, alias = '') {
  const col = alias ? `${alias}.created_at` : 'created_at';
  if (!sinceDays || sinceDays <= 0) return '';
  return `AND ${col} >= datetime('now', '-${Math.floor(sinceDays)} days')`;
}

function typeClause(artifactType, alias = '') {
  if (!artifactType) return '';
  const col = alias ? `${alias}.artifact_type` : 'artifact_type';
  return `AND ${col} = '${artifactType}'`;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * Get aggregate summary across all lifecycles.
 * @param {{ sinceDays?: number, artifactType?: string }} options
 * @returns {{ projects_analyzed, mean, median, stddev, min, max, distribution, per_type }}
 */
export function getSummary({ sinceDays = 0, artifactType } = {}) {
  const sinceInner = sinceClause(sinceDays);
  const typeInner = typeClause(artifactType);
  const sinceOuter = sinceClause(sinceDays, 'qs');
  const typeOuter = typeClause(artifactType, 'qs');

  // Get latest score per lifecycle per artifact_type
  const rows = db.prepare(`
    SELECT qs.lifecycle_id, qs.artifact_type, qs.score, qs.label, qs.created_at
    FROM quality_scores qs
    INNER JOIN (
      SELECT lifecycle_id, artifact_type, MAX(created_at) as max_created
      FROM quality_scores
      WHERE 1=1 ${sinceInner} ${typeInner}
      GROUP BY lifecycle_id, artifact_type
    ) latest ON qs.lifecycle_id = latest.lifecycle_id
      AND qs.artifact_type = latest.artifact_type
      AND qs.created_at = latest.max_created
    WHERE 1=1 ${sinceOuter} ${typeOuter}
    ORDER BY qs.lifecycle_id
  `).all();

  if (rows.length === 0) {
    return {
      projects_analyzed: 0,
      mean: 0, median: 0, stddev: 0, min: 0, max: 0,
      distribution: { EXCELLENT: 0, GOOD: 0, ACCEPTABLE: 0, WEAK: 0 },
      per_type: {},
    };
  }

  const scores = rows.map(r => r.score).sort((a, b) => a - b);
  const lifecycleIds = new Set(rows.map(r => r.lifecycle_id));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Distribution
  const distribution = { EXCELLENT: 0, GOOD: 0, ACCEPTABLE: 0, WEAK: 0 };
  for (const s of scores) {
    distribution[scoreLabel(s)]++;
  }

  // Per-type breakdown
  const perType = {};
  for (const row of rows) {
    if (!perType[row.artifact_type]) perType[row.artifact_type] = [];
    perType[row.artifact_type].push(row.score);
  }

  const perTypeStats = {};
  for (const [type, typeScores] of Object.entries(perType)) {
    const sorted = [...typeScores].sort((a, b) => a - b);
    const typeMean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    perTypeStats[type] = {
      count: sorted.length,
      mean: round2(typeMean),
      median: round2(median(sorted)),
      min: round2(sorted[0]),
      max: round2(sorted[sorted.length - 1]),
    };
  }

  return {
    projects_analyzed: lifecycleIds.size,
    mean: round2(mean),
    median: round2(median(scores)),
    stddev: round2(stddev(scores, mean)),
    min: round2(scores[0]),
    max: round2(scores[scores.length - 1]),
    distribution,
    per_type: perTypeStats,
  };
}

// ─── Project Report ───────────────────────────────────────────────────────────

/**
 * Get quality report for a specific lifecycle/project.
 * @param {string} lifecycleId
 * @returns {{ lifecycle_id, latest, history, trend, volatility }}
 */
export function getProjectReport(lifecycleId) {
  const allScores = db.prepare(`
    SELECT * FROM quality_scores
    WHERE lifecycle_id = ?
    ORDER BY created_at ASC
  `).all(lifecycleId);

  if (allScores.length === 0) {
    return { lifecycle_id: lifecycleId, latest: {}, history: [], trend: {}, volatility: 0 };
  }

  // Parse breakdown JSON
  const parsed = allScores.map(r => {
    const row = { ...r };
    if (row.breakdown && typeof row.breakdown === 'string') {
      try { row.breakdown = JSON.parse(row.breakdown); } catch { /* keep string */ }
    }
    return row;
  });

  // Latest per type
  const latest = {};
  for (const row of parsed) {
    if (!latest[row.artifact_type] || row.created_at > latest[row.artifact_type].created_at) {
      latest[row.artifact_type] = row;
    }
  }

  // Trend per type (version progression)
  const trend = {};
  for (const row of parsed) {
    if (!trend[row.artifact_type]) trend[row.artifact_type] = [];
    trend[row.artifact_type].push({
      version: row.artifact_version,
      score: row.score,
      label: row.label,
      created_at: row.created_at,
    });
  }

  // Volatility: avg absolute delta between consecutive scores (same type)
  const volatility = computeVolatility(parsed);

  return {
    lifecycle_id: lifecycleId,
    latest,
    history: parsed,
    trend,
    volatility: round2(volatility),
  };
}

// ─── Distribution ─────────────────────────────────────────────────────────────

/**
 * Get distribution histogram across all lifecycles.
 * @param {{ sinceDays?: number, artifactType?: string }} options
 * @returns {{ total, buckets: { EXCELLENT, GOOD, ACCEPTABLE, WEAK }, percentages }}
 */
export function getDistribution({ sinceDays = 0, artifactType } = {}) {
  const sinceInner = sinceClause(sinceDays);
  const typeInner = typeClause(artifactType);
  const sinceOuter = sinceClause(sinceDays, 'qs');
  const typeOuter = typeClause(artifactType, 'qs');

  // Latest score per lifecycle per artifact_type
  const rows = db.prepare(`
    SELECT qs.score
    FROM quality_scores qs
    INNER JOIN (
      SELECT lifecycle_id, artifact_type, MAX(created_at) as max_created
      FROM quality_scores
      WHERE 1=1 ${sinceInner} ${typeInner}
      GROUP BY lifecycle_id, artifact_type
    ) latest ON qs.lifecycle_id = latest.lifecycle_id
      AND qs.artifact_type = latest.artifact_type
      AND qs.created_at = latest.max_created
    WHERE 1=1 ${sinceOuter} ${typeOuter}
  `).all();

  const buckets = { EXCELLENT: 0, GOOD: 0, ACCEPTABLE: 0, WEAK: 0 };
  for (const r of rows) {
    buckets[scoreLabel(r.score)]++;
  }

  const total = rows.length;
  const percentages = {};
  for (const [label, count] of Object.entries(buckets)) {
    percentages[label] = total > 0 ? round2(count / total * 100) : 0;
  }

  return { total, buckets, percentages };
}

// ─── Volatility Index ─────────────────────────────────────────────────────────

/**
 * Compute volatility index for a lifecycle.
 * Average absolute change in score between consecutive entries of the same type.
 * Low = stable planning. High = chaotic.
 * @param {string} lifecycleId
 * @returns {number}
 */
export function getVolatilityIndex(lifecycleId) {
  const allScores = db.prepare(`
    SELECT * FROM quality_scores
    WHERE lifecycle_id = ?
    ORDER BY artifact_type, created_at ASC
  `).all(lifecycleId);

  return round2(computeVolatility(allScores));
}

function computeVolatility(rows) {
  // Group by artifact_type
  const byType = {};
  for (const row of rows) {
    if (!byType[row.artifact_type]) byType[row.artifact_type] = [];
    byType[row.artifact_type].push(row.score);
  }

  let totalDelta = 0;
  let deltaCount = 0;

  for (const scores of Object.values(byType)) {
    for (let i = 1; i < scores.length; i++) {
      totalDelta += Math.abs(scores[i] - scores[i - 1]);
      deltaCount++;
    }
  }

  return deltaCount > 0 ? totalDelta / deltaCount : 0;
}

// ─── Spec Version Delta ───────────────────────────────────────────────────────

/**
 * Average improvement between spec v1 and v2 across all lifecycles.
 * @param {{ sinceDays?: number }} options
 * @returns {{ avg_delta, count, improvements, regressions }}
 */
export function getSpecVersionDelta({ sinceDays = 0 } = {}) {
  const since = sinceClause(sinceDays);

  const rows = db.prepare(`
    SELECT lifecycle_id, artifact_version, score
    FROM quality_scores
    WHERE artifact_type = 'spec' ${since}
    ORDER BY lifecycle_id, artifact_version ASC
  `).all();

  // Group by lifecycle
  const byLifecycle = {};
  for (const row of rows) {
    if (!byLifecycle[row.lifecycle_id]) byLifecycle[row.lifecycle_id] = [];
    byLifecycle[row.lifecycle_id].push(row);
  }

  let totalDelta = 0;
  let count = 0;
  let improvements = 0;
  let regressions = 0;

  for (const entries of Object.values(byLifecycle)) {
    if (entries.length < 2) continue;
    const delta = entries[entries.length - 1].score - entries[0].score;
    totalDelta += delta;
    count++;
    if (delta > 0) improvements++;
    else if (delta < 0) regressions++;
  }

  return {
    avg_delta: count > 0 ? round2(totalDelta / count) : 0,
    count,
    improvements,
    regressions,
  };
}

// ─── CLI Text Report ──────────────────────────────────────────────────────────

/**
 * Generate a text report for CLI output.
 * @param {{ sinceDays?: number }} options
 * @returns {string}
 */
export function generateTextReport({ sinceDays = 30 } = {}) {
  const summary = getSummary({ sinceDays });
  const dist = getDistribution({ sinceDays });
  const specDelta = getSpecVersionDelta({ sinceDays });

  const lines = [];
  lines.push('═'.repeat(60));
  lines.push('  C3 Quality Score Report');
  lines.push('═'.repeat(60));
  lines.push('');

  if (summary.projects_analyzed === 0) {
    lines.push('No quality data found.');
    lines.push('Run lifecycle operations (approveSpec, generateRoadmap, proposeChange)');
    lines.push('to start collecting quality scores.');
    return lines.join('\n');
  }

  lines.push(`Projects analyzed: ${summary.projects_analyzed}`);
  lines.push(`Period: last ${sinceDays} days`);
  lines.push('');

  // Overall scores
  lines.push('─── Overall Scores ─────────────────────────────────');
  lines.push(`  Mean:    ${summary.mean}`);
  lines.push(`  Median:  ${summary.median}`);
  lines.push(`  Stddev:  ${summary.stddev}`);
  lines.push(`  Min/Max: ${summary.min} / ${summary.max}`);
  lines.push('');

  // Distribution
  lines.push('─── Distribution ───────────────────────────────────');
  lines.push(`  EXCELLENT (≥0.85): ${dist.buckets.EXCELLENT} (${dist.percentages.EXCELLENT}%)`);
  lines.push(`  GOOD (0.70–0.85):  ${dist.buckets.GOOD} (${dist.percentages.GOOD}%)`);
  lines.push(`  ACCEPTABLE (0.55–0.70): ${dist.buckets.ACCEPTABLE} (${dist.percentages.ACCEPTABLE}%)`);
  lines.push(`  WEAK (<0.55):      ${dist.buckets.WEAK} (${dist.percentages.WEAK}%)`);
  lines.push('');

  // Per-type breakdown
  if (Object.keys(summary.per_type).length > 0) {
    lines.push('─── Per Artifact Type ──────────────────────────────');
    for (const [type, stats] of Object.entries(summary.per_type)) {
      lines.push(`  ${type}: mean=${stats.mean} median=${stats.median} (n=${stats.count})`);
    }
    lines.push('');
  }

  // Spec version delta
  if (specDelta.count > 0) {
    lines.push('─── Spec Version Trend ─────────────────────────────');
    lines.push(`  Avg delta v1→vN:  ${specDelta.avg_delta > 0 ? '+' : ''}${specDelta.avg_delta}`);
    lines.push(`  Improvements:     ${specDelta.improvements}`);
    lines.push(`  Regressions:      ${specDelta.regressions}`);
    lines.push(`  Lifecycles w/ ≥2: ${specDelta.count}`);
    lines.push('');
  }

  lines.push('═'.repeat(60));
  return lines.join('\n');
}

export default {
  getSummary,
  getProjectReport,
  getDistribution,
  getVolatilityIndex,
  getSpecVersionDelta,
  generateTextReport,
};
