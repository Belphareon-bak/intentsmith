import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  M5_PERFORMANCE_EVIDENCE_CONTRACT,
  M5_PERFORMANCE_EVIDENCE_VERSION,
  validateM5PerformanceEvidenceV3,
  validateM5PerformanceRawArtifactV2,
} from '../../contracts/m5/performance-v3.js';

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
    source: 'M5 calibration with bounded headroom rounded to 250 ms',
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
      sourceRevision: '44a9ba87c99a448b1b1b5f479963c3b6aaac7e91',
      sourcePath: 'docs/execution/runs/m1-b6-fresh-install-20260823.md',
      sourceBlobOid: '598eda44f9f6c3b2e26e95c286ecf204b538ce00',
      sourceSha256: '0e6c8e3efdaf4e4dbb5b2d3ae42cb9e7862c6fff867fb3da874f071ed74240b7',
      maximumColdMs: 70_000,
      maximumWarmP95Ms: 60_000,
    },
    studio: {
      surface: 'studio.production-journey',
      sourceRevision: '44a9ba87c99a448b1b1b5f479963c3b6aaac7e91',
      sourcePath: 'docs/execution/runs/m1-b6-fresh-install-20260823.md',
      sourceBlobOid: '598eda44f9f6c3b2e26e95c286ecf204b538ce00',
      sourceSha256: '0e6c8e3efdaf4e4dbb5b2d3ae42cb9e7862c6fff867fb3da874f071ed74240b7',
      maximumDeterministicMs: 100,
      maximumModelMs: 70_000,
    },
    lifecycle: {
      surface: 'lifecycle.governed-project-change',
      sourceRevision: 'c14d800ee15084d2b7c25b529a3a3f90102eedc7',
      sourcePath: 'docs/execution/runs/wp-m2-execution-v1-20260824.md',
      sourceBlobOid: '79d8dbe66c6f1c713f5ef5738ab00fcdc2363c32',
      sourceSha256: '3445ebdf9c0683bfde8a0563a46974f7739607236fd935ad6e35e7cba874aecd',
      maximumJourneyMs: 60_000,
      maximumErrorRateBps: 0,
    },
    vram: {
      surface: 'model.vram-authority',
      sourceRevision: '40ce44ecde9684fa11a0fb8824d49fe45acddd02',
      sourcePath: 'docs/execution/runs/wp-m1-model-report.md',
      sourceBlobOid: '3092fa7bb1dbef51d7c56570e3d2f3b048336642',
      sourceSha256: '42b2f7eefd193fc25d11db539347b77b118b3f496ae4d12c81d3827ca0aec13e',
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

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(repositoryRoot, args) {
  return execFileSync('/usr/bin/git', args, {
    cwd: repositoryRoot,
    encoding: args[0] === 'show' ? 'buffer' : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function numberWithSpaces(value) {
  return Number(String(value).replaceAll(' ', '').replace(',', '.'));
}

function oneMatch(text, pattern, sourceName) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`performance-source:${sourceName}:expected-one-match:${matches.length}`);
  }
  return matches[0];
}

export function derivePinnedPerformanceMetrics(surface, sourceBytes) {
  const text = Buffer.from(sourceBytes).toString('utf8');
  if (surface === 'chat.model-http') {
    const match = oneMatch(
      text,
      /^\| HTTP modelový chat \| cold `([\d ]+) ms`; warm `[^`]+`, p95 `([\d ]+) ms`; `([\d,]+)` turnu\/min \|$/gmu,
      surface,
    );
    return Object.freeze({
      coldMs: numberWithSpaces(match[1]),
      warmP95Ms: numberWithSpaces(match[2]),
      throughputTurnsPerMinute: numberWithSpaces(match[3]),
    });
  }
  if (surface === 'studio.production-journey') {
    const match = oneMatch(
      text,
      /^\| literal Studio → real server \| deterministic `([\d ]+) ms`, model `([\d ]+) ms`, oba `ok`, spinner cleared \|$/gmu,
      surface,
    );
    return Object.freeze({
      deterministicMs: numberWithSpaces(match[1]),
      modelMs: numberWithSpaces(match[2]),
    });
  }
  if (surface === 'lifecycle.governed-project-change') {
    const match = oneMatch(
      text,
      /dokládá `([\d ]+)\/([\d ]+) PASS` za ([\d ]+) ms, bez timeoutu a leaků\./gu,
      surface,
    );
    const passed = numberWithSpaces(match[1]);
    const total = numberWithSpaces(match[2]);
    if (passed !== total || total < 1) throw new Error(`performance-source:${surface}:not-all-pass`);
    return Object.freeze({
      journeyMs: numberWithSpaces(match[3]),
      errorRateBps: 0,
    });
  }
  if (surface === 'model.vram-authority') {
    const residency = oneMatch(
      text,
      /^\| model allocation \| [\d ]+ B, ([\d,.]+)% GPU residency \|$/gmu,
      `${surface}:residency`,
    );
    const minimumFree = oneMatch(
      text,
      /^\| GPU minimum free \| ([\d ]+) MiB, bezpečně nad [\d ]+ MiB headroomem \|$/gmu,
      `${surface}:minimum-free`,
    );
    return Object.freeze({
      residencyBps: Math.round(numberWithSpaces(residency[1]) * 100),
      minimumFreeMiB: numberWithSpaces(minimumFree[1]),
    });
  }
  throw new Error(`performance-source:unsupported-surface:${surface}`);
}

function loadRawMeasurementArtifact(evidence, repositoryRoot) {
  const artifactRoot = path.resolve(repositoryRoot, '.intentsmith-artifacts');
  const artifactPath = path.resolve(repositoryRoot, evidence.measurementArtifact.path);
  const canonicalArtifact = realpathSync(artifactPath);
  const relative = path.relative(artifactRoot, canonicalArtifact);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('performance-artifact:path-outside-authority-root');
  }
  if (!statSync(canonicalArtifact).isFile()) {
    throw new Error('performance-artifact:not-regular-file');
  }
  const bytes = readFileSync(canonicalArtifact);
  if (bytes.byteLength !== evidence.measurementArtifact.byteLength) {
    throw new Error('performance-artifact:byte-length-mismatch');
  }
  if (sha256(bytes) !== evidence.measurementArtifact.sha256) {
    throw new Error('performance-artifact:sha256-mismatch');
  }
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('performance-artifact:invalid-json');
  }
  const validation = validateM5PerformanceRawArtifactV2(artifact);
  if (!validation.valid) {
    throw new Error(`performance-artifact:invalid-contract:${validation.errors.join('|')}`);
  }
  if (
    artifact.candidateRevision !== evidence.candidateRevision
    || artifact.candidateTree !== evidence.candidateTree
    || artifact.measuredAtIso !== evidence.measuredAtIso
    || JSON.stringify(artifact.host) !== JSON.stringify(evidence.host)
  ) throw new Error('performance-artifact:envelope-binding-mismatch');
  return artifact;
}

function verifyCandidateBinding(evidence, options, repositoryRoot) {
  if (!SHA_PATTERN.test(options.expectedCandidateRevision ?? '')) {
    throw new Error('performance-candidate:expected-revision-required');
  }
  if (options.expectedCandidateRevision !== evidence.candidateRevision) {
    throw new Error('performance-candidate:revision-mismatch');
  }
  const tree = String(git(repositoryRoot, [
    'rev-parse',
    `${evidence.candidateRevision}^{tree}`,
  ])).trim();
  if (tree !== evidence.candidateTree) throw new Error('performance-candidate:tree-mismatch');
  if (options.requireHeadCandidate === true) {
    const head = String(git(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
    if (head !== evidence.candidateRevision) throw new Error('performance-candidate:head-mismatch');
  }
  if (options.requireCleanWorktree === true) {
    const status = String(git(repositoryRoot, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])).trim();
    if (status !== '') throw new Error('performance-candidate:dirty-worktree');
  }
}

function verifyPinnedBaselines(evidence, budgets, repositoryRoot) {
  const derived = new Map();
  for (const budget of Object.values(budgets.pinned)) {
    const baseline = evidence.pinnedBaselines.find(item => item.surface === budget.surface);
    if (!baseline) throw new Error(`performance-source:${budget.surface}:missing`);
    for (const field of [
      'sourceRevision',
      'sourcePath',
      'sourceBlobOid',
      'sourceSha256',
    ]) {
      if (baseline[field] !== budget[field]) {
        throw new Error(`performance-source:${budget.surface}:${field}-mismatch`);
      }
    }
    const objectSpec = `${baseline.sourceRevision}:${baseline.sourcePath}`;
    const blobOid = String(git(repositoryRoot, ['rev-parse', objectSpec])).trim();
    if (blobOid !== baseline.sourceBlobOid) {
      throw new Error(`performance-source:${budget.surface}:blob-mismatch`);
    }
    const bytes = git(repositoryRoot, ['show', objectSpec]);
    if (sha256(bytes) !== baseline.sourceSha256) {
      throw new Error(`performance-source:${budget.surface}:sha256-mismatch`);
    }
    derived.set(budget.surface, derivePinnedPerformanceMetrics(budget.surface, bytes));
  }
  return derived;
}

export function evaluateM5PerformanceEvidence(evidence, options = {}) {
  const budgets = options.budgets ?? M5_PERFORMANCE_BUDGETS;
  const validation = validateM5PerformanceEvidenceV3(evidence);
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

  let repositoryRoot;
  let rawArtifact;
  let pinnedMetrics;
  try {
    if (typeof options.repositoryRoot !== 'string' || options.repositoryRoot.length === 0) {
      throw new Error('performance-authority:repository-root-required');
    }
    repositoryRoot = realpathSync(options.repositoryRoot);
    verifyCandidateBinding(evidence, options, repositoryRoot);
    rawArtifact = loadRawMeasurementArtifact(evidence, repositoryRoot);
    pinnedMetrics = verifyPinnedBaselines(evidence, budgets, repositoryRoot);
  } catch (error) {
    return immutable({
      contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
      version: M5_PERFORMANCE_EVIDENCE_VERSION,
      verdict: 'FAIL',
      errors: [error instanceof Error ? error.message : String(error)],
      checks: [],
      summaries: [],
      pinnedSummaries: [],
    });
  }

  const checks = [];
  const summaries = rawArtifact.measurements.map(summarizePerformanceMeasurement);
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
    ]),
    studio: Object.freeze([
      ['deterministicMs', 'maximumDeterministicMs', 'lte'],
      ['modelMs', 'maximumModelMs', 'lte'],
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
      const metrics = pinnedMetrics.get(budget.surface);
      const predicate = comparator === 'lte' ? (a, b) => a <= b : (a, b) => a >= b;
      checked(
        checks,
        `${budget.surface}:${metric}`,
        metrics?.[metric],
        budget[limitName],
        comparator,
        (actual, limit) => Number.isFinite(actual) && predicate(actual, limit),
      );
    }
  }
  const gpuObservation = rawArtifact.gpuObservation;
  let gpuSummary = Object.freeze({
    state: gpuObservation.state,
    censusState: gpuObservation.census.state,
    computeProcessCount: gpuObservation.census.computeProcessCount,
    measurement: null,
  });
  if (gpuObservation.state === 'measured') {
    const measurement = gpuObservation.measurement;
    const vramBudget = budgets.pinned.vram;
    checked(checks, 'model.gpu-current:samples', measurement.sampleCount, 1, 'gte', (a, b) => a >= b);
    checked(checks, 'model.gpu-current:errors', measurement.errorCount, 0, 'eq', (a, b) => a === b);
    checked(
      checks,
      'model.gpu-current:residencyBps',
      measurement.residencyBps,
      vramBudget.minimumResidencyBps,
      'gte',
      (a, b) => a >= b,
    );
    checked(
      checks,
      'model.gpu-current:minimumFreeMiB',
      measurement.minimumFreeMiB,
      vramBudget.minimumFreeHeadroomMiB,
      'gte',
      (a, b) => a >= b,
    );
    gpuSummary = Object.freeze({
      state: gpuObservation.state,
      censusState: gpuObservation.census.state,
      computeProcessCount: gpuObservation.census.computeProcessCount,
      measurement: Object.freeze({
        surface: measurement.surface,
        sampleCount: measurement.sampleCount,
        errorCount: measurement.errorCount,
        p95Ms: nearestRank(measurement.latenciesMs, 95),
        residencyBps: measurement.residencyBps,
        minimumFreeMiB: measurement.minimumFreeMiB,
      }),
    });
  }
  return immutable({
    contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
    version: M5_PERFORMANCE_EVIDENCE_VERSION,
    verdict: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    errors: [],
    checks,
    summaries,
    gpuSummary,
    pinnedSummaries: [...pinnedMetrics].map(([surface, metrics]) => Object.freeze({
      surface,
      metrics,
    })),
  });
}
