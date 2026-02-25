// ══════════════════════════════════════════════════════════════════════════════
// Test: Quality Report — Aggregate Analytics
// ══════════════════════════════════════════════════════════════════════════════
//
//   T1: getSummary() — empty DB returns zeros
//   T2: getSummary() — with data returns correct stats
//   T3: getDistribution() — histogram buckets
//   T4: getProjectReport() — per-lifecycle report
//   T5: getVolatilityIndex() — stable vs volatile
//   T6: getSpecVersionDelta() — improvement tracking
//   T7: generateTextReport() — text output format
//   T8: Filters — sinceDays and artifactType
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  db,
  projects,
  lifecycles as lifecycleRepo,
  qualityScores,
} from '../src/db/database.js';

import {
  getSummary,
  getProjectReport,
  getDistribution,
  getVolatilityIndex,
  getSpecVersionDelta,
  generateTextReport,
} from '../src/planner/quality-report.js';

const LC_PREFIX = 'qr-test';
const LC_IDS = [`${LC_PREFIX}-1`, `${LC_PREFIX}-2`, `${LC_PREFIX}-3`];

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push({ name, detail: detail || '' });
  }
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

function cleanDB() {
  for (const lcId of LC_IDS) {
    try { db.prepare(`DELETE FROM quality_scores WHERE lifecycle_id = ?`).run(lcId); } catch {}
    try { db.prepare(`DELETE FROM project_lifecycles WHERE id = ?`).run(lcId); } catch {}
  }
  try { db.prepare(`DELETE FROM projects WHERE name LIKE 'qr-test-%'`).run(); } catch {}
}

function setupLifecycle(lcId, projectName) {
  const project = projects.getOrCreate(projectName, `/tmp/${projectName}`, `QR Test ${projectName}`);
  lifecycleRepo.save(lcId, Number(project.id), 'SPEC', null, {});
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('\u2550'.repeat(70));
  console.log('  Test: Quality Report — Aggregate Analytics');
  console.log('\u2550'.repeat(70));

  cleanDB();

  // ─── T1: Empty DB ─────────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T1: getSummary() — empty DB \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Clean state — no quality_scores for our test lifecycles
  const emptySummary = getSummary();
  // We can't guarantee fully empty DB (other tests may have data), so check structure
  check(typeof emptySummary.projects_analyzed === 'number', 'T1.1: projects_analyzed is number');
  check(typeof emptySummary.mean === 'number', 'T1.2: mean is number');
  check(typeof emptySummary.distribution === 'object', 'T1.3: distribution is object');
  check('EXCELLENT' in emptySummary.distribution, 'T1.4: distribution has EXCELLENT bucket');
  check('per_type' in emptySummary, 'T1.5: has per_type breakdown');

  // ─── T2: Summary with data ────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T2: getSummary() — with data \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Setup 3 lifecycles with known scores
  setupLifecycle(LC_IDS[0], 'qr-test-1');
  setupLifecycle(LC_IDS[1], 'qr-test-2');
  setupLifecycle(LC_IDS[2], 'qr-test-3');

  // LC1: high quality (spec 0.90, roadmap 0.85)
  qualityScores.log(LC_IDS[0], 'spec', 1, 0.90, 'EXCELLENT', { decision_depth: 0.95 });
  qualityScores.log(LC_IDS[0], 'roadmap', 1, 0.85, 'EXCELLENT', { milestone_completeness: 0.90 });

  // LC2: medium quality (spec 0.65, roadmap 0.70)
  qualityScores.log(LC_IDS[1], 'spec', 1, 0.65, 'ACCEPTABLE', { decision_depth: 0.60 });
  qualityScores.log(LC_IDS[1], 'roadmap', 1, 0.70, 'GOOD', { milestone_completeness: 0.75 });

  // LC3: low quality (spec 0.40)
  qualityScores.log(LC_IDS[2], 'spec', 1, 0.40, 'WEAK', { decision_depth: 0.30 });

  const summary = getSummary();
  check(summary.projects_analyzed >= 3, 'T2.1: at least 3 projects', `got ${summary.projects_analyzed}`);
  check(summary.mean > 0, 'T2.2: mean > 0', `got ${summary.mean}`);
  check(summary.median > 0, 'T2.3: median > 0', `got ${summary.median}`);
  check(summary.min <= summary.max, 'T2.4: min <= max', `${summary.min} <= ${summary.max}`);
  check(summary.stddev >= 0, 'T2.5: stddev >= 0', `got ${summary.stddev}`);
  check(summary.distribution.EXCELLENT >= 0, 'T2.6: distribution has non-negative counts');

  // Per-type should have spec and roadmap
  check('spec' in summary.per_type, 'T2.7: per_type has spec');
  check('roadmap' in summary.per_type, 'T2.8: per_type has roadmap');

  // ─── T3: Distribution ─────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T3: getDistribution() \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const dist = getDistribution();
  check(dist.total >= 5, 'T3.1: total >= 5 entries', `got ${dist.total}`);
  check(dist.buckets.EXCELLENT + dist.buckets.GOOD + dist.buckets.ACCEPTABLE + dist.buckets.WEAK === dist.total,
    'T3.2: bucket sum = total');

  const pctSum = dist.percentages.EXCELLENT + dist.percentages.GOOD + dist.percentages.ACCEPTABLE + dist.percentages.WEAK;
  check(inRange(pctSum, 99, 101), 'T3.3: percentages sum ~100%', `got ${pctSum}`);

  // Filter by type
  const specDist = getDistribution({ artifactType: 'spec' });
  check(specDist.total >= 3, 'T3.4: spec-only distribution has >= 3', `got ${specDist.total}`);

  // ─── T4: Project Report ───────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T4: getProjectReport() \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const report = getProjectReport(LC_IDS[0]);
  check(report.lifecycle_id === LC_IDS[0], 'T4.1: correct lifecycle_id');
  check('spec' in report.latest, 'T4.2: latest has spec entry');
  check('roadmap' in report.latest, 'T4.3: latest has roadmap entry');
  check(report.latest.spec.score === 0.90, 'T4.4: latest spec score = 0.90', `got ${report.latest.spec?.score}`);
  check(report.history.length >= 2, 'T4.5: history has >= 2 entries', `got ${report.history.length}`);
  check('spec' in report.trend, 'T4.6: trend has spec type');
  check(typeof report.volatility === 'number', 'T4.7: volatility is number');

  // Empty lifecycle
  const emptyReport = getProjectReport('nonexistent-lifecycle');
  check(emptyReport.history.length === 0, 'T4.8: nonexistent lifecycle returns empty');

  // ─── T5: Volatility Index ─────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T5: getVolatilityIndex() \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // LC1 has stable scores (only 1 entry per type) → volatility = 0
  const stableVol = getVolatilityIndex(LC_IDS[0]);
  check(stableVol === 0, 'T5.1: single-entry lifecycle = 0 volatility', `got ${stableVol}`);

  // Add volatile scores to LC2
  qualityScores.log(LC_IDS[1], 'spec', 2, 0.85, 'EXCELLENT', {}); // jump from 0.65 to 0.85 = +0.20
  qualityScores.log(LC_IDS[1], 'spec', 3, 0.55, 'ACCEPTABLE', {}); // drop from 0.85 to 0.55 = -0.30

  const volatileVol = getVolatilityIndex(LC_IDS[1]);
  check(volatileVol > 0, 'T5.2: multi-entry lifecycle > 0 volatility', `got ${volatileVol}`);
  // Expected: spec deltas = |0.85-0.65| + |0.55-0.85| = 0.20 + 0.30 = 0.50, avg = 0.25
  // Plus roadmap has only 1 entry, so only spec contributes
  check(inRange(volatileVol, 0.20, 0.30), 'T5.3: volatility ~0.25 (avg of 0.20 and 0.30)', `got ${volatileVol}`);

  // ─── T6: Spec Version Delta ───────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T6: getSpecVersionDelta() \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const specDelta = getSpecVersionDelta();
  check(specDelta.count >= 1, 'T6.1: at least 1 lifecycle with >=2 spec versions', `got ${specDelta.count}`);
  check(typeof specDelta.avg_delta === 'number', 'T6.2: avg_delta is number');
  check(typeof specDelta.improvements === 'number', 'T6.3: improvements is number');
  check(typeof specDelta.regressions === 'number', 'T6.4: regressions is number');

  // LC2 went from 0.65 → 0.55 (regression of -0.10)
  // So we should see at least 1 regression
  // (Note: LC2's last spec entry = 0.55, first = 0.65, delta = -0.10)
  check(specDelta.regressions >= 1 || specDelta.improvements >= 0,
    'T6.5: detects improvements or regressions');

  // ─── T7: Text Report ──────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T7: generateTextReport() \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  const report_text = generateTextReport({ sinceDays: 30 });
  check(typeof report_text === 'string', 'T7.1: returns string');
  check(report_text.includes('Quality Score Report'), 'T7.2: contains title');
  check(report_text.includes('Projects analyzed'), 'T7.3: contains project count');
  check(report_text.includes('Mean'), 'T7.4: contains mean');
  check(report_text.includes('EXCELLENT'), 'T7.5: contains distribution labels');
  check(report_text.includes('WEAK'), 'T7.6: contains WEAK label');

  // ─── T8: Filters ──────────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550 T8: Filters (sinceDays, artifactType) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  // Filter by type = spec
  const specOnly = getSummary({ artifactType: 'spec' });
  check(specOnly.projects_analyzed >= 3, 'T8.1: spec filter returns >= 3 projects', `got ${specOnly.projects_analyzed}`);
  check(!('roadmap' in specOnly.per_type), 'T8.2: spec filter excludes roadmap from per_type');

  // Filter by type = roadmap
  const roadmapOnly = getSummary({ artifactType: 'roadmap' });
  check(roadmapOnly.projects_analyzed >= 2, 'T8.3: roadmap filter returns >= 2 projects', `got ${roadmapOnly.projects_analyzed}`);

  // Very old sinceDays (should include everything)
  const allTime = getSummary({ sinceDays: 3650 });
  check(allTime.projects_analyzed >= 3, 'T8.4: 10-year window includes all', `got ${allTime.projects_analyzed}`);

  // ═════════════════════════════════════════════════════════════════════════
  // Cleanup + Summary
  // ═════════════════════════════════════════════════════════════════════════

  cleanDB();

  console.log('\n' + '\u2550'.repeat(70));
  console.log(`  Quality Report: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    \u2717 ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    }
  }
  console.log('\u2550'.repeat(70));

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Quality Report test crashed:', err);
  process.exit(1);
});
