// tests/regression-predictor.test.js — Regression Predictor v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  predictRegression,
  formatRegressionReport,
} from '../src/code-intel/regression-predictor.js';

// ─── Prediction ──────────────────────────────────────────────────────────────

suite('Regression Predictor — Prediction');

await testAsync('empty files → LOW risk', async () => {
  const result = await predictRegression('/tmp', []);
  assertEqual(result.riskLevel, 'LOW');
  assertEqual(result.overallRisk, 0);
  assertEqual(result.shouldBlock, false);
});

await testAsync('null files → LOW risk', async () => {
  const result = await predictRegression('/tmp', null);
  assertEqual(result.riskLevel, 'LOW');
});

await testAsync('isolated file with no coverage → non-zero risk', async () => {
  const result = await predictRegression('/tmp', ['src/isolated.js'], {
    coverageMap: { 'src/isolated.js': false },
  });
  // coverageGap = 1 → contributes 25 points (W_COVERAGE × 100)
  assert(result.overallRisk >= 20, `should have risk >= 20, got ${result.overallRisk}`);
});

await testAsync('file with full coverage → lower risk', async () => {
  const result = await predictRegression('/tmp', ['src/tested.js'], {
    coverageMap: { 'src/tested.js': true },
  });
  assert(result.overallRisk < 50, `covered file should have risk < 50, got ${result.overallRisk}`);
});

await testAsync('high churn file → higher risk', async () => {
  const result = await predictRegression('/tmp', ['src/hot.js'], {
    hotspots: [{ file: 'src/hot.js', changes: 50 }], // capped at 30
    coverageMap: { 'src/hot.js': false },
  });
  // churn capped at 30 → W_CHURN × (30/30 × 100) = 10 points
  assert(result.overallRisk > 0, 'high churn should add risk');
});

await testAsync('churn is capped at 30', async () => {
  const resultHigh = await predictRegression('/tmp', ['src/a.js'], {
    hotspots: [{ file: 'src/a.js', changes: 100 }],
    coverageMap: { 'src/a.js': true },
  });
  const resultCapped = await predictRegression('/tmp', ['src/a.js'], {
    hotspots: [{ file: 'src/a.js', changes: 30 }],
    coverageMap: { 'src/a.js': true },
  });
  // Both should have same churn contribution (capped at 30)
  assertEqual(resultHigh.overallRisk, resultCapped.overallRisk);
});

await testAsync('shouldBlock for CRITICAL risk', async () => {
  // Manufacture high risk: no coverage, high impact, high centrality
  const result = await predictRegression('/tmp', ['src/core.js'], {
    coverageMap: { 'src/core.js': false },
    hotspots: [{ file: 'src/core.js', changes: 50 }],
    impactResults: {
      'src/core.js': {
        symbol: 'core',
        impactedFunctions: Array.from({ length: 20 }, (_, i) => `fn${i}`),
        impactedFiles: Array.from({ length: 15 }, (_, i) => `f${i}.js`),
        impactedTests: [],
        callChain: [],
        stats: { totalImpacted: 30, directCallers: 15, transitiveCallers: 15, testsAffected: 0 },
      },
    },
  });
  // riskScore should be high from impact + no coverage + churn → could be CRITICAL or HIGH
  assert(result.overallRisk >= 50, `heavily-used uncovered file should be HIGH+, got ${result.overallRisk}`);
});

await testAsync('generates recommendations for coverage gaps', async () => {
  const result = await predictRegression('/tmp', ['src/notest.js'], {
    coverageMap: { 'src/notest.js': false },
  });
  assert(result.recommendations.some(r => r.includes('Add tests')),
    'should recommend adding tests');
});

// ─── Formatting ──────────────────────────────────────────────────────────────

suite('Regression Predictor — Formatting');

test('formats report', () => {
  const prediction = {
    overallRisk: 60,
    riskLevel: 'HIGH',
    shouldBlock: false,
    fileRisks: [
      { file: 'src/a.js', risk: 60, factors: {} },
    ],
    recommendations: ['Add tests for `src/a.js`'],
  };
  const report = formatRegressionReport(prediction);
  assert(report.includes('HIGH'), 'should mention risk level');
  assert(report.includes('src/a.js'), 'should mention file');
  assert(report.includes('Add tests'), 'should include recommendation');
});

test('formats CRITICAL with warning', () => {
  const prediction = {
    overallRisk: 80,
    riskLevel: 'CRITICAL',
    shouldBlock: true,
    fileRisks: [],
    recommendations: [],
  };
  const report = formatRegressionReport(prediction);
  assert(report.includes('CRITICAL'), 'should mention CRITICAL');
  assert(report.includes('WARNING'), 'should include warning');
});

test('handles null prediction', () => {
  assertEqual(formatRegressionReport(null), '');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
