import {
  M5_PERFORMANCE_EVIDENCE_CONTRACT,
  M5_PERFORMANCE_EVIDENCE_VERSION,
  validateM5PerformanceEvidenceV1,
} from '../../contracts/m5/performance-v1.js';

export const M5_PERFORMANCE_BUDGET_CONTRACT = 'M5PerformanceBudget@1';

export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new TypeError('performance-budget:invalid-percentile');
  }
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('performance-budget:invalid-sample');
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil((percentile / 100) * ordered.length) - 1)];
}

export function summarizePerformanceMeasurement(measurement) {
  const rssGrowthMiB = Math.max(0, measurement.rss.endMiB - measurement.rss.startMiB);
  return Object.freeze({
    surface: measurement.surface,
    sampleCount: measurement.sampleCount,
    errorCount: measurement.errorCount,
    errorRateBps: Math.ceil((measurement.errorCount / measurement.sampleCount) * 10_000),
    p50Ms: nearestRank(measurement.latenciesMs, 50),
    p95Ms: nearestRank(measurement.latenciesMs, 95),
    maxMs: Math.max(...measurement.latenciesMs),
    durationMs: measurement.durationMs,
    operations: measurement.operations,
    rssStartMiB: measurement.rss.startMiB,
    rssPeakMiB: measurement.rss.peakMiB,
    rssEndMiB: measurement.rss.endMiB,
    rssGrowthMiB,
  });
}

function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

// These are candidate release budgets, intentionally pinned in source so an
// acceptance review can approve or change them. Dynamic baseline-derived
// values are filled only after the clean M5 calibration run and never relaxed
// automatically by a slower candidate.
export const M5_PERFORMANCE_BUDGETS = immutable({
  contract: M5_PERFORMANCE_BUDGET_CONTRACT,
  deterministicChat: {
    surface: 'chat.deterministic-http',
    minimumSamples: 20,
    maximumP95Ms: 100,
    maximumErrorRateBps: 0,
    source: 'M1 accepted p95 target and M1 B6 20-sample measurement',
  },
  codeIntelligence: {
    surface: 'code-intelligence.project-context',
    minimumSamples: 20,
    maximumP95Ms: 250,
    maximumErrorRateBps: 0,
    source: 'M5 calibration with 50 percent headroom rounded to 25 ms',
  },
  boundedSoak: {
    surface: 'core.deterministic-soak',
    minimumDurationMs: 300_000,
    minimumSamples: 1_000,
    maximumP95Ms: 100,
    maximumErrorRateBps: 0,
    maximumPeakRssMiB: 512,
    maximumRssGrowthMiB: 64,
    source: 'M5 five-minute production calibration with bounded headroom',
  },
  pinned: {
    model: {
      surface: 'chat.model-http',
      sourceRevision: 'd518d7ec2156b108c5d71b72d16ee855781c6be5',
      sourcePath: 'docs/execution/runs/m1-b6-fresh-install-20260823.md',
      maximumColdMs: 70_000,
      maximumWarmP95Ms: 60_000,
      maximumErrorRateBps: 0,
    },
    studio: {
      surface: 'studio.production-journey',
      sourceRevision: 'd518d7ec2156b108c5d71b72d16ee855781c6be5',
      sourcePath: 'docs/execution/runs/m1-b6-fresh-install-20260823.md',
      maximumDeterministicMs: 100,
      minimumSoakMs: 65_000,
      maximumBuildMs: 90_000,
    },
    lifecycle: {
      surface: 'lifecycle.governed-project-change',
      sourceRevision: '181bb0cdfa371aaef222fee53e39d7ed60ff8c25',
      sourcePath: 'docs/execution/runs/wp-m2-execution-v1-20260824.md',
      maximumJourneyMs: 60_000,
      maximumErrorRateBps: 0,
    },
    vram: {
      surface: 'model.vram-authority',
      sourceRevision: '3185948840b96bb76567a43da69eb1505545e308',
      sourcePath: 'docs/execution/runs/wp-m1-model-report.md',
      minimumResidencyBps: 10_000,
      minimumFreeHeadroomMiB: 1_024,
    },
  },
});

function failed(checks, id, actual, limit, comparator) {
  checks.push(Object.freeze({ id, passed: false, actual, limit, comparator }));
}

function checked(checks, id, actual, limit, comparator, predicate) {
  if (!predicate(actual, limit)) failed(checks, id, actual, limit, comparator);
  else checks.push(Object.freeze({ id, passed: true, actual, limit, comparator }));
}

export function evaluateM5PerformanceEvidence(evidence, budgets = M5_PERFORMANCE_BUDGETS) {
  const validation = validateM5PerformanceEvidenceV1(evidence);
  if (!validation.valid) {
    return immutable({
      contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
      version: M5_PERFORMANCE_EVIDENCE_VERSION,
      verdict: 'FAIL',
      errors: validation.errors,
      checks: [],
      summaries: [],
    });
  }

  const checks = [];
  const summaries = evidence.measurements.map(summarizePerformanceMeasurement);
  const bySurface = new Map(summaries.map(item => [item.surface, item]));
  for (const budget of [budgets.deterministicChat, budgets.codeIntelligence]) {
    const actual = bySurface.get(budget.surface);
    checked(checks, `${budget.surface}:present`, Boolean(actual), true, 'eq', value => value === true);
    if (!actual) continue;
    checked(checks, `${budget.surface}:samples`, actual.sampleCount, budget.minimumSamples, 'gte', (a, b) => a >= b);
    checked(checks, `${budget.surface}:p95`, actual.p95Ms, budget.maximumP95Ms, 'lte', (a, b) => a <= b);
    checked(checks, `${budget.surface}:errors`, actual.errorRateBps, budget.maximumErrorRateBps, 'lte', (a, b) => a <= b);
  }
  const soak = bySurface.get(budgets.boundedSoak.surface);
  checked(checks, `${budgets.boundedSoak.surface}:present`, Boolean(soak), true, 'eq', value => value === true);
  if (soak) {
    checked(checks, `${soak.surface}:duration`, soak.durationMs, budgets.boundedSoak.minimumDurationMs, 'gte', (a, b) => a >= b);
    checked(checks, `${soak.surface}:samples`, soak.sampleCount, budgets.boundedSoak.minimumSamples, 'gte', (a, b) => a >= b);
    checked(checks, `${soak.surface}:p95`, soak.p95Ms, budgets.boundedSoak.maximumP95Ms, 'lte', (a, b) => a <= b);
    checked(checks, `${soak.surface}:errors`, soak.errorRateBps, budgets.boundedSoak.maximumErrorRateBps, 'lte', (a, b) => a <= b);
    checked(checks, `${soak.surface}:peak-rss`, soak.rssPeakMiB, budgets.boundedSoak.maximumPeakRssMiB, 'lte', (a, b) => a <= b);
    checked(checks, `${soak.surface}:rss-growth`, soak.rssGrowthMiB, budgets.boundedSoak.maximumRssGrowthMiB, 'lte', (a, b) => a <= b);
  }
  const pinnedChecks = Object.freeze({
    model: Object.freeze([
      ['coldMs', 'maximumColdMs', 'lte'],
      ['warmP95Ms', 'maximumWarmP95Ms', 'lte'],
      ['errorRateBps', 'maximumErrorRateBps', 'lte'],
    ]),
    studio: Object.freeze([
      ['deterministicMs', 'maximumDeterministicMs', 'lte'],
      ['boundedSoakMs', 'minimumSoakMs', 'gte'],
      ['installAndBuildMs', 'maximumBuildMs', 'lte'],
    ]),
    lifecycle: Object.freeze([
      ['journeyMs', 'maximumJourneyMs', 'lte'],
      ['errorRateBps', 'maximumErrorRateBps', 'lte'],
    ]),
    vram: Object.freeze([
      ['residencyBps', 'minimumResidencyBps', 'gte'],
      ['minimumFreeMiB', 'minimumFreeHeadroomMiB', 'gte'],
    ]),
  });
  for (const [name, budget] of Object.entries(budgets.pinned)) {
    const baseline = evidence.pinnedBaselines.find(item => item.surface === budget.surface);
    checked(
      checks,
      `${budget.surface}:pinned-baseline`,
      Boolean(baseline),
      true,
      'eq',
      value => value === true,
    );
    if (!baseline) continue;
    checked(checks, `${budget.surface}:source-revision`, baseline.sourceRevision, budget.sourceRevision, 'eq', (a, b) => a === b);
    checked(checks, `${budget.surface}:source-path`, baseline.sourcePath, budget.sourcePath, 'eq', (a, b) => a === b);
    for (const [metric, limitName, comparator] of pinnedChecks[name]) {
      const predicate = comparator === 'lte' ? (a, b) => a <= b : (a, b) => a >= b;
      checked(
        checks,
        `${budget.surface}:${metric}`,
        baseline.metrics[metric],
        budget[limitName],
        comparator,
        (actual, limit) => Number.isFinite(actual) && predicate(actual, limit),
      );
    }
  }
  return immutable({
    contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
    version: M5_PERFORMANCE_EVIDENCE_VERSION,
    verdict: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    errors: [],
    checks,
    summaries,
  });
}
