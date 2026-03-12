// tests/model-upgrade-phase3.test.js — v120: Phase 3 Empirical Model Evaluation
// ══════════════════════════════════════════════════════════════════════════════
// ~60 tests: Empirical Scorer, Metrics Collector, Blended Scoring, Integration
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  computeEmpiricalScore, computeBlendWeights, computeEfficiency,
  normalizeEfficiency, normalizeIterations, normalizeDuration,
  capEmpiricalContribution,
  MIN_SAMPLES, FULL_CONFIDENCE_SAMPLES, MAX_EMPIRICAL_CONTRIBUTION, EMPIRICAL_SCHEMA_VERSION,
} from '../src/upgrade/empirical-scorer.js';

import {
  MetricsCollector, TASK_WEIGHTS, PRIOR_SUCCESS, K,
} from '../src/upgrade/metrics-collector.js';

import {
  scoreModel, evaluateUpgrade, EVALUATION_VERSION, IMPROVEMENT_THRESHOLD,
} from '../src/upgrade/model-ranker.js';

// ─── Test DB Setup ──────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      iterations INTEGER DEFAULT 1,
      tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      errors_fixed INTEGER DEFAULT 0,
      errors_remaining INTEGER DEFAULT 0,
      stop_reason TEXT,
      lifecycle_id TEXT,
      milestone_id TEXT,
      detail_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mp_role_model ON model_performance(role, model);
    CREATE INDEX IF NOT EXISTS idx_mp_role_created ON model_performance(role, created_at);
    CREATE INDEX IF NOT EXISTS idx_mp_model_task ON model_performance(model, task_type);
  `);
  return db;
}

function insertSample(db, overrides = {}) {
  const d = {
    role: 'CODE',
    model: 'deepseek-coder-v2:16b',
    task_type: 'patch',
    success: 1,
    iterations: 2,
    tokens: 1500,
    duration_ms: 8000,
    errors_fixed: 3,
    errors_remaining: 0,
    stop_reason: 'success',
    lifecycle_id: 'lc-1',
    milestone_id: 'ms-1',
    detail_json: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO model_performance
      (role, model, task_type, success, iterations, tokens, duration_ms,
       errors_fixed, errors_remaining, stop_reason, lifecycle_id, milestone_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.role, d.model, d.task_type, d.success, d.iterations, d.tokens, d.duration_ms,
    d.errors_fixed, d.errors_remaining, d.stop_reason, d.lifecycle_id, d.milestone_id, d.detail_json, d.created_at);
}

// Helper: insert N samples with varying success
function insertManySamples(db, n, opts = {}) {
  const successRate = opts.successRate ?? 0.7;
  for (let i = 0; i < n; i++) {
    insertSample(db, {
      success: Math.random() < successRate ? 1 : 0,
      iterations: 1 + Math.floor(Math.random() * 5),
      tokens: 800 + Math.floor(Math.random() * 2000),
      duration_ms: 3000 + Math.floor(Math.random() * 10000),
      errors_fixed: Math.floor(Math.random() * 5),
      errors_remaining: Math.random() < successRate ? 0 : Math.floor(Math.random() * 3) + 1,
      ...opts,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SUITE 1: Empirical Scorer — Pure Functions
// ════════════════════════════════════════════════════════════════════════════

suite('Empirical Scorer — Constants');

test('MIN_SAMPLES is 10', () => {
  assertEqual(MIN_SAMPLES, 10);
});

test('FULL_CONFIDENCE_SAMPLES is 50', () => {
  assertEqual(FULL_CONFIDENCE_SAMPLES, 50);
});

test('MAX_EMPIRICAL_CONTRIBUTION is 0.25', () => {
  assertEqual(MAX_EMPIRICAL_CONTRIBUTION, 0.25);
});

test('EMPIRICAL_SCHEMA_VERSION is 1', () => {
  assertEqual(EMPIRICAL_SCHEMA_VERSION, 1);
});

suite('Empirical Scorer — normalizeEfficiency');

test('at median tokens → 1.0', () => {
  assertEqual(normalizeEfficiency(1000, 1000), 1.0);
});

test('at 3× median → 0.0', () => {
  assertEqual(normalizeEfficiency(3000, 1000), 0.0);
});

test('at 2× median → 0.5', () => {
  assertEqual(normalizeEfficiency(2000, 1000), 0.5);
});

test('below median → clamped to 1.0', () => {
  assertEqual(normalizeEfficiency(500, 1000), 1.0);
});

test('zero median → 0', () => {
  assertEqual(normalizeEfficiency(1000, 0), 0);
});

suite('Empirical Scorer — normalizeIterations');

test('1 iteration → 1.0', () => {
  assertEqual(normalizeIterations(1), 1.0);
});

test('6 iterations → 0.5', () => {
  assertEqual(normalizeIterations(6), 0.5);
});

test('11 iterations → 0.0', () => {
  assertEqual(normalizeIterations(11), 0.0);
});

test('20 iterations → clamped to 0.0', () => {
  assertEqual(normalizeIterations(20), 0.0);
});

test('0 or negative → 1.0', () => {
  assertEqual(normalizeIterations(0), 1.0);
  assertEqual(normalizeIterations(-1), 1.0);
});

suite('Empirical Scorer — normalizeDuration');

test('at median duration → 1.0', () => {
  assertEqual(normalizeDuration(5000, 5000), 1.0);
});

test('at 2× median → 0.5', () => {
  assertEqual(normalizeDuration(10000, 5000), 0.5);
});

test('faster than median → clamped to 1.0', () => {
  assertEqual(normalizeDuration(2000, 5000), 1.0);
});

test('zero duration → 0', () => {
  assertEqual(normalizeDuration(0, 5000), 0);
});

suite('Empirical Scorer — computeEfficiency');

test('composite formula: tokens 0.6 + iterations 0.3 + duration 0.1', () => {
  const metrics = {
    avgTokens: 1000, medianTokens: 1000,  // tokenEff = 1.0
    avgIterations: 1,                       // iterEff = 1.0
    avgDurationMs: 5000, medianDurationMs: 5000, // durEff = 1.0
  };
  const eff = computeEfficiency(metrics);
  assert(Math.abs(eff - 1.0) < 0.001, `Expected ~1.0, got ${eff}`);
});

test('mixed efficiency values', () => {
  const metrics = {
    avgTokens: 2000, medianTokens: 1000,  // tokenEff = 0.5
    avgIterations: 6,                       // iterEff = 0.5
    avgDurationMs: 10000, medianDurationMs: 5000, // durEff = 0.5
  };
  const eff = computeEfficiency(metrics);
  assert(Math.abs(eff - 0.5) < 0.001, `Expected ~0.5, got ${eff}`);
});

test('null metrics → 0', () => {
  assertEqual(computeEfficiency(null), 0);
});

suite('Empirical Scorer — computeBlendWeights');

test('<10 samples → Phase 2 weights', () => {
  const w = computeBlendWeights(5);
  assertEqual(w.benchmarkWeight, 0.35);
  assertEqual(w.empiricalWeight, 0.00);
});

test('0 samples → Phase 2 weights', () => {
  const w = computeBlendWeights(0);
  assertEqual(w.benchmarkWeight, 0.35);
  assertEqual(w.empiricalWeight, 0.00);
});

test('10 samples → partial blend', () => {
  const w = computeBlendWeights(10);
  assertEqual(w.benchmarkWeight, 0.25);
  assertEqual(w.empiricalWeight, 0.10);
});

test('50 samples → full confidence (boundary)', () => {
  // v124: 50 = FULL_CONFIDENCE_SAMPLES → full empirical weight
  const w = computeBlendWeights(50);
  assertEqual(w.benchmarkWeight, 0.15);
  assertEqual(w.empiricalWeight, 0.20);
});

test('30 samples → linear interpolation midpoint', () => {
  // v124: t = (30-10)/(50-10) = 0.5 → B=0.25-0.05=0.20, E=0.10+0.05=0.15
  const w = computeBlendWeights(30);
  assertEqual(w.benchmarkWeight, 0.2);
  assertEqual(w.empiricalWeight, 0.15);
});

test('51 samples → full confidence', () => {
  const w = computeBlendWeights(51);
  assertEqual(w.benchmarkWeight, 0.15);
  assertEqual(w.empiricalWeight, 0.20);
});

test('B+E always sums to 0.35', () => {
  for (const n of [0, 5, 10, 30, 50, 51, 100]) {
    const w = computeBlendWeights(n);
    const sum = w.benchmarkWeight + w.empiricalWeight;
    assert(Math.abs(sum - 0.35) < 0.001, `B+E=${sum} for n=${n}`);
  }
});

suite('Empirical Scorer — computeEmpiricalScore');

test('formula with all components', () => {
  const metrics = {
    sampleCount: 50,
    smoothedPatchSuccess: 0.8,
    smoothedCheckpointPass: 0.9,
    avgTokens: 1000, medianTokens: 1000,
    avgIterations: 1,
    avgDurationMs: 5000, medianDurationMs: 5000,
  };
  const score = computeEmpiricalScore(metrics);
  // raw = 0.8*0.45 + 0.9*0.35 + 1.0*0.20 = 0.36 + 0.315 + 0.20 = 0.875
  // confidence = 50/50 = 1.0
  // score = 0.875
  assert(Math.abs(score - 0.875) < 0.01, `Expected ~0.875, got ${score}`);
});

test('confidence factor: 12 samples < 50 samples', () => {
  const base = {
    smoothedPatchSuccess: 0.8,
    smoothedCheckpointPass: 0.9,
    avgTokens: 1000, medianTokens: 1000,
    avgIterations: 1,
    avgDurationMs: 5000, medianDurationMs: 5000,
  };
  const s12 = computeEmpiricalScore({ ...base, sampleCount: 12 });
  const s50 = computeEmpiricalScore({ ...base, sampleCount: 50 });
  assert(s12 < s50, `12-sample score ${s12} should be < 50-sample score ${s50}`);
  // s12 confidence = 12/50 = 0.24
  assert(Math.abs(s12 / s50 - 0.24) < 0.01, `Ratio should be ~0.24`);
});

test('0 samples → 0', () => {
  assertEqual(computeEmpiricalScore({ sampleCount: 0 }), 0);
});

test('null metrics → 0', () => {
  assertEqual(computeEmpiricalScore(null), 0);
});

suite('Empirical Scorer — capEmpiricalContribution');

test('within cap → unchanged', () => {
  // score=0.5, weight=0.20 → contribution=0.10 < 0.25 → OK
  assertEqual(capEmpiricalContribution(0.5, 0.20), 0.5);
});

test('exceeds cap → capped', () => {
  // score=1.5, weight=0.20 → contribution=0.30 > 0.25 → cap to 0.25/0.20=1.25
  const capped = capEmpiricalContribution(1.5, 0.20);
  assertEqual(capped, 1.25);
});

test('zero weight → unchanged', () => {
  assertEqual(capEmpiricalContribution(0.9, 0), 0.9);
});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 2: Metrics Collector
// ════════════════════════════════════════════════════════════════════════════

suite('Metrics Collector — Basic Recording');

await testAsync('recordEvent stores to DB via batch flush', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  mc.recordEvent({
    role: 'CODE', model: 'test-model:7b', taskType: 'patch',
    success: 1, iterations: 3, tokens: 2000, durationMs: 5000,
    errorsFixed: 2, errorsRemaining: 0, stopReason: 'success',
  });
  mc.flush();

  const count = db.prepare('SELECT COUNT(*) as c FROM model_performance').get().c;
  assertEqual(count, 1);
});

await testAsync('batch flushes at 10 events', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  for (let i = 0; i < 10; i++) {
    mc.recordEvent({
      role: 'CODE', model: 'test:7b', taskType: 'patch',
      success: 1, iterations: 1, tokens: 100, durationMs: 1000,
    });
  }
  // Should have auto-flushed at 10
  const count = db.prepare('SELECT COUNT(*) as c FROM model_performance').get().c;
  assertEqual(count, 10);
});

await testAsync('no-op without setDb', async () => {
  const mc = new MetricsCollector();
  // Should not throw
  mc.recordEvent({
    role: 'CODE', model: 'test:7b', taskType: 'patch', success: 1,
  });
  mc.flush();
  // No crash = pass
  assert(true);
});

await testAsync('fire-and-forget: no throw on DB error', async () => {
  const mc = new MetricsCollector();
  mc._db = { prepare: () => { throw new Error('DB error'); } };
  // Should not throw
  mc.recordEvent({
    role: 'CODE', model: 'test:7b', taskType: 'patch', success: 1,
  });
  mc._buffer = [{ role: 'CODE', model: 'x', taskType: 'patch', success: 1, iterations: 1, tokens: 0, durationMs: 0, errorsFixed: 0, errorsRemaining: 0, stopReason: null, lifecycleId: null, milestoneId: null, detailJson: null }];
  mc._flush();
  assert(mc._consecutiveFailures >= 1, 'Should increment failure count');
});

suite('Metrics Collector — Aggregation');

await testAsync('getAggregatedMetrics correct rates + medians', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 10 patch samples: 7 success, 3 fail
  for (let i = 0; i < 10; i++) {
    insertSample(db, {
      success: i < 7 ? 1 : 0,
      tokens: 1000 + i * 100,  // 1000..1900
      iterations: 2,
      duration_ms: 5000,
      errors_fixed: 2,
      errors_remaining: i < 7 ? 0 : 1,
    });
  }

  const agg = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  assert(agg !== null, 'Should return aggregation');
  assertEqual(agg.sampleCount, 10);
  assert(agg.smoothedPatchSuccess > 0, 'Should have smoothed patch success');
  assert(agg.medianTokens > 0, 'Should have median tokens');
});

await testAsync('getAllMetricsForRole groups by model', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  insertManySamples(db, 5, { model: 'model-a:7b' });
  insertManySamples(db, 5, { model: 'model-b:14b' });

  const byRole = mc.getAllMetricsForRole('CODE');
  assert(byRole instanceof Map, 'Should return Map');
  assert(byRole.has('model-a:7b'), 'Should have model-a');
  assert(byRole.has('model-b:14b'), 'Should have model-b');
});

await testAsync('empty results return null/empty', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  const agg = mc.getAggregatedMetrics('CODE', 'nonexistent');
  assertEqual(agg, null);

  const byRole = mc.getAllMetricsForRole('NONEXISTENT');
  assertEqual(byRole.size, 0);
});

suite('Metrics Collector — Task Weighting');

await testAsync('patch weight 1.0 > build weight 0.6', async () => {
  assertEqual(TASK_WEIGHTS.patch, 1.0);
  assertEqual(TASK_WEIGHTS.checkpoint, 0.8);
  assertEqual(TASK_WEIGHTS.build, 0.6);
});

suite('Metrics Collector — Outlier Filter');

await testAsync('tokens > 5× median discarded', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 9 normal samples
  for (let i = 0; i < 9; i++) {
    insertSample(db, { tokens: 1000, success: 1 });
  }
  // Insert 1 outlier (tokens = 50000, 50× median)
  insertSample(db, { tokens: 50000, success: 0 });

  const agg = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  // Outlier should be filtered out → sampleCount = 9
  assertEqual(agg.sampleCount, 9);
});

await testAsync('iterations > 20 discarded', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  for (let i = 0; i < 5; i++) {
    insertSample(db, { iterations: 3, success: 1 });
  }
  insertSample(db, { iterations: 25, success: 0 });

  const agg = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  assertEqual(agg.sampleCount, 5);
});

suite('Metrics Collector — Bayesian Smoothing');

await testAsync('smoothing stabilizes small samples', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // 3 successes out of 3 → raw = 1.0, smoothed = (3 + 0.5*5) / (3+5) = 5.5/8 = 0.6875
  for (let i = 0; i < 3; i++) {
    insertSample(db, { success: 1 });
  }

  const agg = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  assert(agg.smoothedPatchSuccess < 1.0, `Smoothed ${agg.smoothedPatchSuccess} should be < 1.0`);
  assert(agg.smoothedPatchSuccess > 0.5, `Smoothed ${agg.smoothedPatchSuccess} should be > 0.5 (prior)`);
});

suite('Metrics Collector — Difficulty Normalization');

await testAsync('errorsFixed ratio adjusts success weight', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert samples with high difficulty (many errors fixed)
  for (let i = 0; i < 5; i++) {
    insertSample(db, { success: 1, errors_fixed: 10, errors_remaining: 0 });
  }

  const aggHard = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');

  // Insert samples with low difficulty
  const db2 = createTestDb();
  const mc2 = new MetricsCollector();
  mc2.setDb(db2);
  for (let i = 0; i < 5; i++) {
    insertSample(db2, { success: 1, errors_fixed: 1, errors_remaining: 0 });
  }

  const aggEasy = mc2.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  // Both should have aggregation, difficulty factor differs
  assert(aggHard !== null && aggEasy !== null);
  assert(aggHard.difficultyAdjustedSuccess > 0);
});

suite('Metrics Collector — Drift Detection');

await testAsync('detects drift when recent < historical × 0.8', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 30 old successful samples
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (let i = 0; i < 30; i++) {
    insertSample(db, { success: 1, created_at: oldDate });
  }

  // Insert 20 recent failed samples
  const recentDate = new Date().toISOString();
  for (let i = 0; i < 20; i++) {
    insertSample(db, { success: 0, created_at: recentDate });
  }

  const drift = mc.detectDrift('CODE', 'deepseek-coder-v2:16b');
  assert(drift.drifted, 'Should detect drift');
  assert(drift.recentScore < drift.historicalScore, 'Recent should be lower');
});

await testAsync('no drift with insufficient samples', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  insertManySamples(db, 10);
  const drift = mc.detectDrift('CODE', 'deepseek-coder-v2:16b');
  assert(!drift.drifted, 'Should not detect drift with < 25 samples');
});

suite('Metrics Collector — Blacklist');

await testAsync('patchSuccess < 0.2 after 20+ samples → blacklisted', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 25 mostly-failed patch samples
  for (let i = 0; i < 25; i++) {
    insertSample(db, { success: i < 3 ? 1 : 0 }); // 3/25 = 0.12
  }

  assert(mc.isBlacklisted('CODE', 'deepseek-coder-v2:16b'), 'Should be blacklisted');
});

await testAsync('not blacklisted with < 20 samples', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  for (let i = 0; i < 15; i++) {
    insertSample(db, { success: 0 });
  }

  assert(!mc.isBlacklisted('CODE', 'deepseek-coder-v2:16b'), 'Should not blacklist < 20 samples');
});

await testAsync('not blacklisted with good success rate', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  for (let i = 0; i < 25; i++) {
    insertSample(db, { success: 1 });
  }

  assert(!mc.isBlacklisted('CODE', 'deepseek-coder-v2:16b'), 'Should not blacklist good model');
});

suite('Metrics Collector — Telemetry Guard');

await testAsync('5 failures → disabled, recovers after reset', async () => {
  const mc = new MetricsCollector();
  mc._db = { prepare: () => { throw new Error('fail'); } };
  mc._insertStmt = null;

  // Simulate 5 flush failures
  for (let i = 0; i < 5; i++) {
    mc._buffer = [{ role: 'CODE', model: 'x', taskType: 'patch', success: 1, iterations: 1, tokens: 0, durationMs: 0, errorsFixed: 0, errorsRemaining: 0, stopReason: null, lifecycleId: null, milestoneId: null, detailJson: null }];
    mc._flush();
  }

  assert(mc._disabledUntil > Date.now(), 'Should be disabled');
  assertEqual(mc._consecutiveFailures, 5);

  // recordEvent should early-return while disabled
  mc._buffer = [];
  mc.recordEvent({ role: 'CODE', model: 'x', taskType: 'patch', success: 1 });
  assertEqual(mc._buffer.length, 0, 'Should not buffer while disabled');
});

suite('Metrics Collector — Concurrency');

await testAsync('INSERT OR IGNORE in transaction', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 20 events rapidly
  for (let i = 0; i < 20; i++) {
    mc.recordEvent({
      role: 'CODE', model: 'test:7b', taskType: 'patch',
      success: 1, iterations: 1, tokens: 100, durationMs: 1000,
    });
  }
  mc.flush();

  const count = db.prepare('SELECT COUNT(*) as c FROM model_performance').get().c;
  assertEqual(count, 20);
});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 3: Blended Scoring
// ════════════════════════════════════════════════════════════════════════════

suite('Blended Scoring — scoreModel');

test('no empirical context = Phase 2 behavior', () => {
  const model = {
    name: 'test:14b', family: 'test', category: 'code',
    params: 14, benchmarks: { swebench: 0.7, humaneval: 0.8, livecodebench: 0.7, arena: 0.6 },
    releaseDate: '2025-06-01', baseVramMb: 10000,
  };
  const result1 = scoreModel(model, 'CODE', { gpuVramMb: 24000, referenceParams: 14 });
  const result2 = scoreModel(model, 'CODE', { gpuVramMb: 24000, referenceParams: 14 }, {});
  assertEqual(result1.totalScore, result2.totalScore);
});

test('empirical data shifts score', () => {
  const model = {
    name: 'test:14b', family: 'test', category: 'code',
    params: 14, benchmarks: { swebench: 0.5, humaneval: 0.5, livecodebench: 0.5, arena: 0.5 },
    releaseDate: '2025-06-01', baseVramMb: 10000,
  };

  const base = scoreModel(model, 'CODE', { gpuVramMb: 24000, referenceParams: 14 });
  const withEmpirical = scoreModel(model, 'CODE', { gpuVramMb: 24000, referenceParams: 14 }, {
    blendWeights: { benchmarkWeight: 0.15, empiricalWeight: 0.20 },
    empiricalScore: 0.9,
  });

  assert(withEmpirical.totalScore !== base.totalScore, 'Score should differ with empirical data');
});

test('hard cap prevents empirical from dominating', () => {
  const model = {
    name: 'test:14b', family: 'test', category: 'code',
    params: 14, benchmarks: { swebench: 0.1, humaneval: 0.1 },
    releaseDate: '2025-06-01', baseVramMb: 10000,
  };

  // Even with perfect empirical score and full weight, contribution should be capped
  const result = scoreModel(model, 'CODE', { gpuVramMb: 24000, referenceParams: 14 }, {
    blendWeights: { benchmarkWeight: 0.15, empiricalWeight: 0.20 },
    empiricalScore: 2.0, // artificially high
  });

  // empirical contribution = min(2.0, 0.25/0.20) * 0.20 = 1.25 * 0.20 = 0.25
  assert(result.totalScore <= 1.0, 'Score should be capped at 1.0');
});

test('EVALUATION_VERSION is v120.2', () => {
  assertEqual(EVALUATION_VERSION, 'v120.2');
});

suite('Blended Scoring — evaluateUpgrade');

test('evaluateUpgrade with empirical context (both sides)', () => {
  const current = {
    name: 'old:14b', family: 'test', category: 'code',
    params: 14, benchmarks: { swebench: 0.5, humaneval: 0.5, livecodebench: 0.5, arena: 0.5 },
    releaseDate: '2025-01-01', baseVramMb: 10000, contextWindow: 32768,
  };
  const candidate = {
    name: 'new:14b', family: 'test', category: 'code',
    params: 14, benchmarks: { swebench: 0.7, humaneval: 0.7, livecodebench: 0.7, arena: 0.7 },
    releaseDate: '2025-06-01', baseVramMb: 10000, contextWindow: 32768,
  };

  const result = evaluateUpgrade(current, candidate, 'CODE', { gpuVramMb: 24000 }, {
    candidate: {
      blendWeights: { benchmarkWeight: 0.25, empiricalWeight: 0.10 },
      empiricalScore: 0.8,
    },
    current: {
      blendWeights: { benchmarkWeight: 0.25, empiricalWeight: 0.10 },
      empiricalScore: 0.6,
    },
  });

  assert(result.candidateScore > result.currentScore, 'Candidate should score higher');
  assert(result.delta > 0, 'Delta should be positive');
});

test('context defaults (no blendWeights) = Phase 2', () => {
  const model = {
    name: 'test:14b', family: 'test', category: 'code',
    params: 14, benchmarks: { swebench: 0.6, humaneval: 0.6, livecodebench: 0.6, arena: 0.6 },
    releaseDate: '2025-06-01', baseVramMb: 10000, contextWindow: 32768,
  };

  const r1 = evaluateUpgrade(model, model, 'CODE', { gpuVramMb: 24000 });
  const r2 = evaluateUpgrade(model, model, 'CODE', { gpuVramMb: 24000 }, {});

  assertEqual(r1.delta, r2.delta);
});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 4: Integration
// ════════════════════════════════════════════════════════════════════════════

suite('Integration — Full Pipeline');

await testAsync('<10 samples = no empirical impact', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 5 samples (below MIN_SAMPLES)
  insertManySamples(db, 5);

  const agg = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  assert(agg !== null);

  const blendWeights = computeBlendWeights(agg.sampleCount);
  assertEqual(blendWeights.empiricalWeight, 0.00, 'Should have zero empirical weight');
});

await testAsync('model with good empirical data gets boosted', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 60 successful samples
  insertManySamples(db, 60, { successRate: 0.95, model: 'good-model:14b' });

  const agg = mc.getAggregatedMetrics('CODE', 'good-model:14b');
  const score = computeEmpiricalScore(agg);
  assert(score > 0.3, `Good model empirical score ${score} should be > 0.3`);
});

await testAsync('model with bad empirical data gets penalized', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // Insert 60 mostly-failed samples
  insertManySamples(db, 60, { successRate: 0.1, model: 'bad-model:14b' });

  const agg = mc.getAggregatedMetrics('CODE', 'bad-model:14b');
  const score = computeEmpiricalScore(agg);
  assert(score < 0.5, `Bad model empirical score ${score} should be < 0.5 (Bayesian prior pulls toward 0.5)`);
});

await testAsync('cold start: Bayesian smoothing prevents score jumping', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // 10 perfect samples
  for (let i = 0; i < 10; i++) {
    insertSample(db, { success: 1 });
  }

  const agg10 = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  // smoothed = (10 + 0.5*5) / (10 + 5) = 12.5/15 ≈ 0.833
  assert(agg10.smoothedPatchSuccess < 1.0, 'Smoothing should pull 100% rate down');
  assert(agg10.smoothedPatchSuccess > 0.7, `Smoothed ${agg10.smoothedPatchSuccess} should be > 0.7`);
});

await testAsync('multiple task types aggregate correctly with weights', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  // 5 patch successes + 5 build successes + 5 checkpoint successes
  for (let i = 0; i < 5; i++) {
    insertSample(db, { task_type: 'patch', success: 1 });
    insertSample(db, { task_type: 'build', success: 1 });
    insertSample(db, { task_type: 'checkpoint', success: 1 });
  }

  const agg = mc.getAggregatedMetrics('CODE', 'deepseek-coder-v2:16b');
  assertEqual(agg.sampleCount, 15);
  assert(agg.patchSuccessRate > 0, 'Should have patch success rate');
  assert(agg.checkpointPassRate > 0, 'Should have checkpoint pass rate');
});

await testAsync('detail_json stored and retrievable', async () => {
  const db = createTestDb();
  const mc = new MetricsCollector();
  mc.setDb(db);

  mc.recordEvent({
    role: 'CODE', model: 'test:7b', taskType: 'patch',
    success: 1, iterations: 1, tokens: 100, durationMs: 1000,
    detail: { custom: 'data', numbers: [1, 2, 3] },
  });
  mc.flush();

  const row = db.prepare('SELECT detail_json FROM model_performance WHERE model = ?').get('test:7b');
  assert(row !== undefined, 'Row should exist');
  const parsed = JSON.parse(row.detail_json);
  assertEqual(parsed.custom, 'data');
  assertEqual(parsed.numbers.length, 3);
});

suite('Integration — Edge Cases');

test('NaN/Infinity guards in normalizers', () => {
  assertEqual(normalizeEfficiency(NaN, 1000), 0);
  assertEqual(normalizeEfficiency(Infinity, 1000), 0);
  assertEqual(normalizeIterations(NaN), 1.0);
  assertEqual(normalizeDuration(NaN, 1000), 0);
  assertEqual(normalizeDuration(1000, NaN), 0);
});

test('EMPIRICAL_SCHEMA_VERSION exported', () => {
  assert(EMPIRICAL_SCHEMA_VERSION >= 1, 'Should have schema version');
});

// ════════════════════════════════════════════════════════════════════════════

const results = summary();
if (results.failed > 0) process.exit(1);
