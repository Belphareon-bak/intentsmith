#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  M5_PERFORMANCE_EVIDENCE_CONTRACT,
  M5_PERFORMANCE_EVIDENCE_VERSION,
  validateM5PerformanceEvidenceV1,
} from '../contracts/m5/performance-v1.js';
import {
  M5_PERFORMANCE_BUDGETS,
  evaluateM5PerformanceEvidence,
  nearestRank,
  summarizePerformanceMeasurement,
} from '../src/observability/performance-budget.js';
import { suite, summary, test } from './harness.js';

function measurement(surface, overrides = {}) {
  const latenciesMs = overrides.latenciesMs ?? Array.from({ length: 20 }, (_, index) => index + 1);
  return {
    surface,
    sampleCount: latenciesMs.length,
    errorCount: 0,
    latenciesMs,
    durationMs: 10_000,
    operations: latenciesMs.length,
    rss: { startMiB: 100, peakMiB: 120, endMiB: 110 },
    ...overrides,
  };
}

function baseline(name, budget) {
  const metrics = name === 'model'
    ? { coldMs: 50_000, warmP95Ms: 55_000, errorRateBps: 0 }
    : name === 'studio'
      ? { deterministicMs: 7, boundedSoakMs: 65_800, installAndBuildMs: 54_000 }
      : name === 'lifecycle'
        ? { journeyMs: 44_204, errorRateBps: 0 }
        : { residencyBps: 10_000, minimumFreeMiB: 5_489 };
  return {
    surface: budget.surface,
    sourceRevision: budget.sourceRevision,
    sourcePath: budget.sourcePath,
    metrics,
  };
}

function evidence() {
  return {
    contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
    version: M5_PERFORMANCE_EVIDENCE_VERSION,
    candidateRevision: 'b'.repeat(40),
    measuredAtIso: '2026-08-26T12:00:00.000Z',
    host: { platform: 'linux', arch: 'x64', node: 'v22.0.0' },
    measurements: [
      measurement('chat.deterministic-http'),
      measurement('code-intelligence.project-context'),
      measurement('core.deterministic-soak', {
        latenciesMs: Array.from({ length: 1_000 }, () => 10),
        durationMs: 300_000,
        operations: 1_000,
      }),
    ],
    pinnedBaselines: Object.entries(M5_PERFORMANCE_BUDGETS.pinned)
      .map(([name, item]) => baseline(name, item)),
    gpuDisposition: {
      currentMeasurement: 'not_run_foreign_activity',
      reason: 'shared compute is active',
      pinnedSurface: 'model.vram-authority',
    },
  };
}

suite('M5 performance evidence and release budgets');

test('nearest-rank p95 does not silently interpolate or discard the slow sample', () => {
  assert.equal(nearestRank([1, 2, 3, 4, 100], 95), 100);
  assert.equal(nearestRank(Array.from({ length: 20 }, (_, index) => index + 1), 95), 19);
  assert.throws(() => nearestRank([1, -1], 95), /invalid-sample/);
});

test('valid evidence distinguishes current CPU measurements from pinned GPU baselines', () => {
  const value = evidence();
  assert.deepEqual(validateM5PerformanceEvidenceV1(value).errors, []);
  assert.equal(value.gpuDisposition.currentMeasurement, 'not_run_foreign_activity');
  assert.equal(value.pinnedBaselines.some(item => item.surface === 'model.vram-authority'), true);
});

test('summary computes p50, p95, error rate and RSS growth from raw samples', () => {
  const result = summarizePerformanceMeasurement(measurement('summary', {
    errorCount: 1,
    latenciesMs: [1, 2, 3, 100],
    rss: { startMiB: 100, peakMiB: 140, endMiB: 125 },
  }));
  assert.equal(result.p50Ms, 2);
  assert.equal(result.p95Ms, 100);
  assert.equal(result.errorRateBps, 2_500);
  assert.equal(result.rssGrowthMiB, 25);
});

test('green evidence passes every explicit budget', () => {
  const result = evaluateM5PerformanceEvidence(evidence());
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.checks.every(check => check.passed), true);
});

test('one slow p95 fails instead of being averaged away', () => {
  const value = evidence();
  value.measurements[0].latenciesMs[17] = 101;
  value.measurements[0].latenciesMs[18] = 101;
  const result = evaluateM5PerformanceEvidence(value);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.some(check => check.id.endsWith(':p95') && !check.passed), true);
});

test('short soak, RSS leak and any request error are independent blockers', () => {
  const value = evidence();
  const soak = value.measurements[2];
  soak.durationMs = 299_999;
  soak.errorCount = 1;
  soak.rss.endMiB = 200;
  soak.rss.peakMiB = 200;
  const failed = evaluateM5PerformanceEvidence(value).checks
    .filter(check => !check.passed)
    .map(check => check.id);
  assert.equal(failed.includes('core.deterministic-soak:duration'), true);
  assert.equal(failed.includes('core.deterministic-soak:errors'), true);
  assert.equal(failed.includes('core.deterministic-soak:rss-growth'), true);
});

test('missing model, Studio, lifecycle or VRAM evidence cannot pass', () => {
  for (const surface of Object.values(M5_PERFORMANCE_BUDGETS.pinned).map(item => item.surface)) {
    const value = evidence();
    value.pinnedBaselines = value.pinnedBaselines.filter(item => item.surface !== surface);
    const result = evaluateM5PerformanceEvidence(value);
    assert.equal(result.verdict, 'FAIL', surface);
    assert.equal(
      result.checks.some(check => check.id === `${surface}:pinned-baseline` && !check.passed),
      true,
      surface,
    );
  }
});

test('pinned baseline identity and metrics cannot be rebound to a weaker artifact', () => {
  const wrongRevision = evidence();
  wrongRevision.pinnedBaselines[0].sourceRevision = 'f'.repeat(40);
  assert.equal(evaluateM5PerformanceEvidence(wrongRevision).verdict, 'FAIL');

  const liedMetric = evidence();
  liedMetric.pinnedBaselines[3].metrics.residencyBps = 9_999;
  const result = evaluateM5PerformanceEvidence(liedMetric);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(
    result.checks.some(check => check.id === 'model.vram-authority:residencyBps' && !check.passed),
    true,
  );
});

test('malformed evidence fails closed before budget comparison', () => {
  const value = evidence();
  value.measurements[0].latenciesMs.pop();
  const result = evaluateM5PerformanceEvidence(value);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.checks.length, 0);
  assert.equal(result.errors.some(error => error.includes('invalid-latenciesMs')), true);
});

summary();
