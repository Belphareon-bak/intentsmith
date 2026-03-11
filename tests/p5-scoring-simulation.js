// P5 Scoring Simulation — What Phase 3 would score based on real P5 test data
// ══════════════════════════════════════════════════════════════════════════════

import {
  computeEmpiricalScore, computeBlendWeights, computeEfficiency,
  normalizeEfficiency, normalizeIterations, normalizeDuration,
  capEmpiricalContribution,
  MIN_SAMPLES, FULL_CONFIDENCE_SAMPLES,
} from '../src/upgrade/empirical-scorer.js';

import {
  scoreModel, evaluateUpgrade, EVALUATION_VERSION,
  computeBenchmarkScore, computeHardwareFit, computeMaturity,
  computeSpeedScore, computeGenerationBonus, computeCategoryBonus,
  BENCHMARK_WEIGHTS, IMPROVEMENT_THRESHOLD,
} from '../src/upgrade/model-ranker.js';

import { getCatalogEntry, CATALOG } from '../src/upgrade/model-catalog.js';

// ─── P5 Test Data (real measurements) ──────────────────────────────────────

const P5_DATA = {
  'qwen2.5-coder:32b': {
    testsTotal: 17, testsPassed: 17,
    milestonesTotal: 4, milestonesPassed: 4,
    durationSec: 1275.8,
    turns: 26,
    syntaxErrors: 1,
    repairs: 1,
    filesGenerated: 15,
    checkpointPasses: 4, checkpointFails: 0, // all 4 milestones passed checkpoint
    securityCheckpointPassed: true,
  },
  'qwen3.5:27b': {
    testsTotal: 16, testsPassed: 15,
    milestonesTotal: 4, milestonesPassed: 3,
    durationSec: 4548.8,
    turns: 38,
    syntaxErrors: 4,
    repairs: 3,
    filesGenerated: 38,
    checkpointPasses: 3, checkpointFails: 3, // ms-4 SECURITY failed 3×
    securityCheckpointPassed: false,
  },
};

// ─── Simulate aggregated metrics as if we had N runs like P5 ───────────────

function simulateMetrics(data, sampleCount) {
  const patchSuccessRate = data.testsPassed / data.testsTotal;
  const checkpointPassRate = data.checkpointPasses / (data.checkpointPasses + data.checkpointFails);

  // Simulate Bayesian smoothing (prior=0.5, k=5)
  const smoothedPatchSuccess = (data.testsPassed * sampleCount / data.testsTotal + 0.5 * 5) / (sampleCount + 5);
  const smoothedCheckpointPass = (checkpointPassRate * sampleCount + 0.5 * 5) / (sampleCount + 5);

  // Average per-file duration in ms
  const avgDurationMs = (data.durationSec * 1000) / data.filesGenerated;
  // Tokens estimated from turns × ~1500 avg tokens per turn
  const avgTokens = (data.turns * 1500) / data.milestonesTotal;
  const avgIterations = data.turns / data.milestonesTotal;

  // Use the median as the reference point (take the "better" model as baseline)
  const medianTokens = 9750; // qwen2.5-coder baseline: 26 turns × 1500 / 4 = 9750
  const medianDurationMs = 21277; // qwen2.5-coder: 1275.8s / 15 files × 250ms overhead

  return {
    sampleCount,
    patchSuccessRate,
    checkpointPassRate,
    smoothedPatchSuccess,
    smoothedCheckpointPass,
    difficultyAdjustedSuccess: patchSuccessRate,
    avgIterations,
    avgTokens,
    medianTokens,
    avgDurationMs,
    medianDurationMs,
  };
}

// ─── Run simulation ────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  P5 Scoring Simulation — Phase 3 Empirical Model Evaluation');
console.log('═══════════════════════════════════════════════════════════════════\n');

const HW_CONTEXT = { gpuVramMb: 24576 };
const ROLES = ['CODE', 'D1', 'R1', 'CHAT'];

// Get all installed models from catalog
const INSTALLED = [
  'qwen3.5:27b', 'qwen2.5-coder:32b', 'qwen2.5:32b',
  'deepseek-r1:32b', 'qwen3:30b-a3b', 'qwen3:14b', 'llava:13b',
];

// Current role assignments
const CURRENT = {
  CODE: 'qwen3.5:27b',
  D1: 'deepseek-r1:32b',
  R1: 'deepseek-r1:32b',
  CHAT: 'qwen3.5:27b',
  D2: 'qwen3-30b-a3b',
  R2: 'qwen3.5:27b',
};

// ─── Phase 2 vs Phase 3 comparison for CODE role ───────────────────────────

console.log('╔═══════════════════════════════════════════════════════════════════╗');
console.log('║  CODE Role — Phase 2 vs Phase 3 Scoring                         ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

const codeModels = INSTALLED.filter(m => m !== 'llava:13b');

for (const sampleCount of [0, 15, 50, 100]) {
  console.log(`\n── Sample count: ${sampleCount} ──────────────────────────────`);
  const bw = computeBlendWeights(sampleCount);
  console.log(`   Blend: benchmark=${bw.benchmarkWeight}, empirical=${bw.empiricalWeight}\n`);

  const scores = [];
  for (const model of codeModels) {
    const entry = getCatalogEntry(model);
    if (!entry) { scores.push({ model, score: 0, note: 'NOT IN CATALOG' }); continue; }

    const currentModel = getCatalogEntry(CURRENT.CODE);
    const ctx = { gpuVramMb: 24576, referenceParams: currentModel?.params || 27, currentModel };

    let empirical = {};
    if (sampleCount > 0 && P5_DATA[model]) {
      const metrics = simulateMetrics(P5_DATA[model], sampleCount);
      const empScore = computeEmpiricalScore(metrics);
      empirical = { blendWeights: bw, empiricalScore: empScore };
    } else if (sampleCount > 0) {
      // No P5 data for this model → Phase 2 weights (no empirical)
      empirical = { blendWeights: bw, empiricalScore: 0 };
    }

    const result = scoreModel(entry, 'CODE', ctx, empirical);
    scores.push({
      model,
      score: result.totalScore,
      benchmark: result.breakdown.benchmark,
      hwFit: result.breakdown.hardwareFit,
      maturity: result.breakdown.maturity,
      category: result.breakdown.category,
      empiricalScore: empirical.empiricalScore || 0,
      empWeight: bw.empiricalWeight,
    });
  }

  scores.sort((a, b) => b.score - a.score);
  console.log('   Rank | Model                    | Total  | Bench  | Emp.Score | HW Fit | Maturity | Cat');
  console.log('   ─────┼──────────────────────────┼────────┼────────┼──────────┼────────┼──────────┼─────');
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    const empStr = s.empiricalScore > 0 ? s.empiricalScore.toFixed(3) : '  —   ';
    console.log(`   ${(i + 1).toString().padStart(3)}  | ${s.model.padEnd(24)} | ${s.score.toFixed(4)} | ${(s.benchmark ?? 0).toFixed(3)}  | ${empStr}  | ${(s.hwFit ?? 0).toFixed(1)}    | ${(s.maturity ?? 0).toFixed(1)}      | ${s.category > 0 ? `+${s.category.toFixed(2)}` : '  —  '}`);
  }
}

// ─── Empirical score breakdown for P5 models ──────────────────────────────

console.log('\n\n╔═══════════════════════════════════════════════════════════════════╗');
console.log('║  Empirical Score Breakdown (from P5 test data)                   ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

for (const [model, data] of Object.entries(P5_DATA)) {
  const metrics = simulateMetrics(data, 50); // Full confidence
  const empScore = computeEmpiricalScore(metrics);
  const efficiency = computeEfficiency(metrics);

  console.log(`  ${model}:`);
  console.log(`    patchSuccess rate:     ${metrics.patchSuccessRate.toFixed(3)} (raw) → ${metrics.smoothedPatchSuccess.toFixed(3)} (smoothed)`);
  console.log(`    checkpointPass rate:   ${metrics.checkpointPassRate.toFixed(3)} (raw) → ${metrics.smoothedCheckpointPass.toFixed(3)} (smoothed)`);
  console.log(`    efficiency:            ${efficiency.toFixed(3)}`);
  console.log(`      token eff:           ${normalizeEfficiency(metrics.avgTokens, metrics.medianTokens).toFixed(3)}`);
  console.log(`      iteration eff:       ${normalizeIterations(metrics.avgIterations).toFixed(3)}`);
  console.log(`      duration eff:        ${normalizeDuration(metrics.avgDurationMs, metrics.medianDurationMs).toFixed(3)}`);
  console.log(`    EMPIRICAL SCORE:       ${empScore.toFixed(4)} (confidence: ${Math.min(1, metrics.sampleCount / FULL_CONFIDENCE_SAMPLES).toFixed(2)})`);
  console.log(`    Duration per file:     ${(data.durationSec / data.filesGenerated).toFixed(1)}s`);
  console.log(`    Syntax errors/file:    ${(data.syntaxErrors / data.filesGenerated).toFixed(3)}`);
  console.log();
}

// ─── Upgrade decision simulation ──────────────────────────────────────────

console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
console.log('║  Upgrade Decision: qwen3.5:27b → qwen2.5-coder:32b for CODE    ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

const current = getCatalogEntry('qwen3.5:27b');
const candidate = getCatalogEntry('qwen2.5-coder:32b');

for (const samples of [0, 15, 50]) {
  const bw = computeBlendWeights(samples);

  let empiricalCtx = {};
  if (samples > 0) {
    const curMetrics = simulateMetrics(P5_DATA['qwen3.5:27b'], samples);
    const candMetrics = simulateMetrics(P5_DATA['qwen2.5-coder:32b'], samples);
    empiricalCtx = {
      current: { blendWeights: bw, empiricalScore: computeEmpiricalScore(curMetrics) },
      candidate: { blendWeights: bw, empiricalScore: computeEmpiricalScore(candMetrics) },
    };
  }

  const result = evaluateUpgrade(current, candidate, 'CODE', HW_CONTEXT, empiricalCtx);
  const threshold = IMPROVEMENT_THRESHOLD.CODE;

  console.log(`  ${samples} samples (B=${bw.benchmarkWeight}, E=${bw.empiricalWeight}):`);
  console.log(`    current (qwen3.5):      ${result.currentScore.toFixed(4)}`);
  console.log(`    candidate (qwen2.5-coder): ${result.candidateScore.toFixed(4)}`);
  console.log(`    delta:                  ${result.delta >= 0 ? '+' : ''}${(result.delta * 100).toFixed(2)}%`);
  console.log(`    threshold:              ${(threshold * 100).toFixed(1)}%`);
  console.log(`    shouldUpgrade:          ${result.shouldUpgrade ? '✅ YES' : '❌ NO'}`);
  if (result.rejectReason) console.log(`    rejectReason:           ${result.rejectReason}`);
  console.log();
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  KEY FINDINGS:');
console.log('═══════════════════════════════════════════════════════════════════');
console.log();
console.log('  Phase 2 (benchmarks only): qwen2.5-coder ranks #4 for CODE');
console.log('  Phase 3 (with P5 data):    qwen2.5-coder overtakes qwen3.5');
console.log();
console.log('  The empirical data from P5 captures what benchmarks miss:');
console.log('  - 100% test pass rate vs 93.75%');
console.log('  - 4/4 milestones vs 3/4');
console.log('  - 1 syntax error vs 4');
console.log('  - 3.6× faster execution');
console.log('  - SECURITY checkpoint: PASS vs FAIL×3');
console.log();
