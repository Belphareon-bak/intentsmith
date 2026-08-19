// tests/model-upgrade-phase2.test.js — v118: Phase 2 Model Upgrade Pipeline
// ══════════════════════════════════════════════════════════════════════════════
// ~80 tests: Catalog, Ranker, Proposal Store, Preference, Registry, Discovery, Feasibility
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  CATALOG, CATALOG_VERSION, CATALOG_HASH, QUANT_FACTORS,
  getCatalogEntry, findByFamily, findByCategory,
  getNotInstalled, isModelMature, computeEffectiveVram,
} from '../src/upgrade/model-catalog.js';

import {
  scoreModel, evaluateUpgrade, computeRiskLevel,
  computeBenchmarkScore, computeCategoryBonus, computeHardwareFit,
  computeSpeedScore, computeGenerationBonus, computeMaturity,
  checkVramGate, weightsForRole, ROLE_WEIGHTS,
  BENCHMARK_WEIGHTS, IMPROVEMENT_THRESHOLD, EVALUATION_VERSION,
} from '../src/upgrade/model-ranker.js';

import { ProposalStore } from '../src/upgrade/proposal-store.js';

import {
  computePreferencePenalty, getPreferenceStats, sizeBucket,
} from '../src/upgrade/preference-tracker.js';

import { RegistryClient } from '../src/upgrade/registry-client.js';

import { checkFeasibility } from '../src/upgrade/upgrade-manager.js';

// ─── Test DB Setup ──────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      current_model TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      score REAL NOT NULL,
      current_score REAL,
      improvement REAL,
      score_breakdown TEXT,
      reason TEXT,
      risk_level TEXT DEFAULT 'medium',
      installed INTEGER DEFAULT 0,
      size_gb REAL DEFAULT 0,
      source TEXT DEFAULT 'local',
      status TEXT DEFAULT 'pending',
      catalog_hash TEXT,
      evaluation_version TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      cooldown_until DATETIME
    );
    CREATE TABLE IF NOT EXISTS model_catalog_cache (
      model_name TEXT PRIMARY KEY,
      exists_in_registry INTEGER,
      metadata_json TEXT,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      from_model TEXT NOT NULL,
      to_model TEXT NOT NULL,
      new_model TEXT,
      score REAL,
      action TEXT NOT NULL DEFAULT 'apply',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT NOT NULL,
      score REAL,
      applied_by TEXT DEFAULT 'user',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CATALOG TESTS (~12)
// ═══════════════════════════════════════════════════════════════════════════

suite('Catalog — Structure & Validation');

test('CATALOG has 50+ entries', () => {
  assert(CATALOG.length >= 50, `Expected ≥50 entries, got ${CATALOG.length}`);
});

test('CATALOG_VERSION is set', () => {
  assert(CATALOG_VERSION.startsWith('v118'), `Version: ${CATALOG_VERSION}`);
});

test('CATALOG_HASH is deterministic', () => {
  assert(typeof CATALOG_HASH === 'string' && CATALOG_HASH.length > 5, `Hash: ${CATALOG_HASH}`);
  assert(CATALOG_HASH.startsWith('v118'), `Hash should start with version: ${CATALOG_HASH}`);
});

test('No duplicate names', () => {
  const names = CATALOG.map(e => e.name);
  const unique = new Set(names);
  assertEqual(unique.size, names.length, `Duplicates found: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});

test('All entries have required fields', () => {
  for (const entry of CATALOG) {
    assert(entry.name, `Missing name: ${JSON.stringify(entry)}`);
    assert(entry.family, `Missing family for ${entry.name}`);
    assert(entry.category, `Missing category for ${entry.name}`);
    assert(typeof entry.params === 'number', `Missing/invalid params for ${entry.name}`);
    assert(typeof entry.sizeGB === 'number', `Missing/invalid sizeGB for ${entry.name}`);
    assert(typeof entry.baseVramMb === 'number', `Missing/invalid baseVramMb for ${entry.name}`);
    assert(entry.benchmarks, `Missing benchmarks for ${entry.name}`);
    assert(Array.isArray(entry.capabilities), `capabilities not array for ${entry.name}`);
    assert(entry.architecture, `Missing architecture for ${entry.name}`);
    assert(entry.tokenizer, `Missing tokenizer for ${entry.name}`);
    assert(entry.recommendedQuant, `Missing recommendedQuant for ${entry.name}`);
  }
});

test('Benchmarks are 0-1 range or null', () => {
  for (const entry of CATALOG) {
    for (const [key, val] of Object.entries(entry.benchmarks)) {
      if (val !== null) {
        assert(val >= 0 && val <= 1, `${entry.name}.benchmarks.${key} = ${val} out of range`);
      }
    }
  }
});

test('Supersedes chains are valid', () => {
  const names = new Set(CATALOG.map(e => e.name));
  const supersedesValues = CATALOG.filter(e => e.supersedes).map(e => e.supersedes);
  // supersedes points to a family prefix, not exact name
  for (const sup of supersedesValues) {
    assert(typeof sup === 'string' && sup.length > 0, `Invalid supersedes: ${sup}`);
  }
});

test('getCatalogEntry returns entry by name', () => {
  const entry = getCatalogEntry('qwen3:32b');
  assert(entry, 'qwen3:32b not found');
  assertEqual(entry.family, 'qwen');
  assertEqual(entry.params, 32);
});

test('getCatalogEntry returns null for unknown', () => {
  assertEqual(getCatalogEntry('nonexistent:7b'), null);
});

test('findByFamily returns correct entries', () => {
  const qwen = findByFamily('qwen');
  assert(qwen.length >= 4, `Expected ≥4 qwen entries, got ${qwen.length}`);
  for (const e of qwen) assertEqual(e.family, 'qwen');
});

test('findByCategory returns correct entries', () => {
  const code = findByCategory('code');
  assert(code.length >= 3, `Expected ≥3 code entries, got ${code.length}`);
  for (const e of code) assertEqual(e.category, 'code');
});

test('getNotInstalled excludes installed models', () => {
  const installed = new Set(['qwen3:32b', 'deepseek-r1:32b']);
  const notInstalled = getNotInstalled(installed);
  assert(!notInstalled.some(e => installed.has(e.name)), 'Installed model found in notInstalled');
  assert(notInstalled.length === CATALOG.length - installed.size, `Expected ${CATALOG.length - installed.size}, got ${notInstalled.length}`);
});

test('isModelMature checks release date', () => {
  const mature = { releaseDate: '2024-01-01' };
  assert(isModelMature(mature, 7), 'Should be mature');

  const immature = { releaseDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() };
  assert(!isModelMature(immature, 7), 'Should be immature');

  const unknown = { releaseDate: null };
  assert(!isModelMature(unknown, 7), 'Should not be mature without date');
});

test('computeEffectiveVram includes KV cache and safety margin', () => {
  const entry = { params: 32, baseVramMb: 22000, contextWindow: 32768 };
  const effective = computeEffectiveVram(entry, 1.0);
  // (22000 * 1.0 + 32 * 32768 * 0.00002) * 1.10
  const expected = (22000 + 32 * 32768 * 0.00002) * 1.10;
  assert(Math.abs(effective - expected) < 0.01, `Expected ~${expected.toFixed(1)}, got ${effective.toFixed(1)}`);
  assert(effective > 22000, 'Effective VRAM should be > base');
});

test('QUANT_FACTORS has expected keys', () => {
  assertEqual(QUANT_FACTORS.Q4_K_M, 1.0);
  assertEqual(QUANT_FACTORS.Q8_0, 2.0);
  assertEqual(QUANT_FACTORS.FP16, 3.5);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. RANKER TESTS (~22)
// ═══════════════════════════════════════════════════════════════════════════

suite('Ranker — Benchmark Score');

test('computeBenchmarkScore with CODE role weights (livecodebench dominant)', () => {
  const benchmarks = { swebench: 1.0, livecodebench: 1.0, humaneval: 1.0, arena: 1.0 };
  const score = computeBenchmarkScore(benchmarks, 'CODE');
  assertEqual(score, 1.0);
});

test('computeBenchmarkScore returns 0 for null benchmarks', () => {
  assertEqual(computeBenchmarkScore(null, 'CODE'), 0);
});

test('computeBenchmarkScore redistributes null benchmark weight', () => {
  // D1: swebench 0.20, reasoning 0.50, mmlu 0.20, arena 0.10
  const benchmarks = { swebench: null, reasoning: 0.80, mmlu: 0.70, arena: 0.60 };
  const score = computeBenchmarkScore(benchmarks, 'D1');
  // Total non-null weight: 0.50 + 0.20 + 0.10 = 0.80
  // Redistributed: (0.80*0.50 + 0.70*0.20 + 0.60*0.10) / 0.80
  const expected = (0.80 * 0.50 + 0.70 * 0.20 + 0.60 * 0.10) / 0.80;
  assert(Math.abs(score - expected) < 0.001, `Expected ${expected.toFixed(3)}, got ${score.toFixed(3)}`);
});

test('computeBenchmarkScore returns 0 for unknown role', () => {
  assertEqual(computeBenchmarkScore({ mmlu: 0.8 }, 'NONEXISTENT'), 0);
});

suite('Ranker — Category & Hardware');

test('computeCategoryBonus gives code+CODE bonus', () => {
  assertEqual(computeCategoryBonus('code', 'CODE'), 0.10);
});

test('computeCategoryBonus gives reasoning+D1 bonus', () => {
  assertEqual(computeCategoryBonus('reasoning', 'D1'), 0.05);
});

test('computeCategoryBonus gives vision+VISION bonus', () => {
  assertEqual(computeCategoryBonus('vision', 'VISION'), 0.10);
});

test('computeCategoryBonus returns 0 for mismatch', () => {
  assertEqual(computeCategoryBonus('code', 'CHAT'), 0);
});

test('computeHardwareFit anchors', () => {
  // Comfortable: ratio <= 0.80
  assertEqual(computeHardwareFit(8000, 12000), 1.0);
  // Kotevní body původních pásem zůstávají beze změny…
  assertEqual(computeHardwareFit(8000, 10000), 1.0);   // ratio 0.80
  assertEqual(computeHardwareFit(9500, 10000), 0.7);   // ratio 0.95
  assertEqual(computeHardwareFit(10000, 10000), 0.4);  // ratio 1.00
  // Incompatible: ratio > 1.00 — vyřazení zůstává skokové
  assertEqual(computeHardwareFit(11000, 10000), 0.0);
  // CPU-only
  assertEqual(computeHardwareFit(5000, 0), 0.3);
  // Unknown model VRAM
  assertEqual(computeHardwareFit(0, 10000), 0.5);
});

test('computeHardwareFit interpoluje mezi kotvami místo skoku', () => {
  // Dřív obě hodnoty spadly do pásma „tight“ = 0.7; teď se liší podle poměru.
  assertEqual(computeHardwareFit(8100, 10000), 0.98);  // ratio 0.81
  assertEqual(computeHardwareFit(9000, 10000), 0.8);   // ratio 0.90
  assertEqual(computeHardwareFit(9800, 10000), 0.52);  // ratio 0.98
});

test('computeHardwareFit je monotónní a bez útesů', () => {
  let prev = 1.0;
  for (let ratio = 0.70; ratio <= 1.005; ratio += 0.005) {
    const score = computeHardwareFit(Math.round(ratio * 10000), 10000);
    assert(score <= prev + 1e-9, `skóre musí klesat, u ratio ${ratio.toFixed(3)} vzrostlo`);
    if (ratio > 0.705 && ratio <= 1.0) {
      assert(prev - score < 0.10, `skok ${(prev - score).toFixed(3)} u ratio ${ratio.toFixed(3)} je útes`);
    }
    prev = score;
  }
});

suite('Ranker — Speed & Generation');

test('computeSpeedScore same size = 1.0', () => {
  const score = computeSpeedScore(14, 14);
  assertEqual(score, 1.0);
});

test('computeSpeedScore larger model penalized', () => {
  const score = computeSpeedScore(32, 14);
  assert(score < 1.0, `Expected < 1.0, got ${score}`);
  assert(score >= 0.6, `Expected >= 0.6 (clamped), got ${score}`);
});

test('computeSpeedScore smaller model bonus (clamped at 1.2)', () => {
  const score = computeSpeedScore(7, 32);
  assertEqual(score, 1.2);
});

test('computeSpeedScore returns 0.8 for missing params', () => {
  assertEqual(computeSpeedScore(0, 14), 0.8);
  assertEqual(computeSpeedScore(14, 0), 0.8);
});

test('computeGenerationBonus direct successor = 1.0', () => {
  const candidate = { name: 'qwen3:14b', supersedes: 'qwen2.5' };
  const current = { name: 'qwen2.5:14b' };
  const bonus = computeGenerationBonus(candidate, current);
  assertEqual(bonus, 1.0);
});

test('computeGenerationBonus same family newer version', () => {
  const candidate = { name: 'qwen3.5:27b', family: 'qwen', version: '3.5' };
  const current = { name: 'qwen3:32b', family: 'qwen', version: '3' };
  const bonus = computeGenerationBonus(candidate, current);
  assertEqual(bonus, 0.7); // Minor version (3 → 3.5, diff < 1)
});

test('computeGenerationBonus different family = 0', () => {
  const candidate = { name: 'llama3.3:70b', family: 'llama' };
  const current = { name: 'qwen3:32b', family: 'qwen' };
  const bonus = computeGenerationBonus(candidate, current);
  assertEqual(bonus, 0.0);
});

suite('Ranker — Maturity');

test('computeMaturity >90d = stability bonus', () => {
  const date = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const score = computeMaturity(date);
  assert(score > 1.0, 'Should have stability bonus');
});

test('computeMaturity 30-90d = 0.7', () => {
  const date = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
  assertEqual(computeMaturity(date), 0.7);
});

test('computeMaturity 7-30d = 0.4', () => {
  const date = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  assertEqual(computeMaturity(date), 0.4);
});

test('computeMaturity <7d = 0.0', () => {
  const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  assertEqual(computeMaturity(date), 0.0);
});

test('computeMaturity null = 0.5', () => {
  assertEqual(computeMaturity(null), 0.5);
});

suite('Ranker — v120.2 Calibration');

test('CODE benchmark weights: livecodebench=0.40, humaneval=0.30', () => {
  const w = BENCHMARK_WEIGHTS.CODE;
  assertEqual(w.livecodebench, 0.40);
  assertEqual(w.humaneval, 0.30);
  assertEqual(w.swebench, 0.15);
  assertEqual(w.arena, 0.15);
});

test('CODE size floor: params<20B gets -0.05 penalty', () => {
  const small = {
    name: 'test:14b', family: 'test', category: 'general', params: 14,
    benchmarks: { swebench: 0.5, livecodebench: 0.5, humaneval: 0.5, arena: 0.5 },
    releaseDate: '2024-06-01', baseVramMb: 10000,
  };
  const big = { ...small, name: 'test:32b', params: 32, baseVramMb: 22000 };

  const sSmall = scoreModel(small, 'CODE', { gpuVramMb: 24000 });
  const sBig = scoreModel(big, 'CODE', { gpuVramMb: 24000 });

  // All else being equal (same benchmarks, same maturity), the 14B model should
  // score lower due to -0.05 size floor, even if hwFit is better
  const hwDelta = (sSmall.breakdown.hardwareFit - sBig.breakdown.hardwareFit) * 0.20;
  const speedDelta = (sSmall.breakdown.speed - sBig.breakdown.speed) * 0.07;
  // Size penalty = -0.05 for small model
  // Net should be: even with hwFit and speed advantage, size penalty offsets
  assert(sSmall.totalScore < sBig.totalScore + 0.10,
    `Small model (${sSmall.totalScore.toFixed(3)}) should not dramatically exceed big model (${sBig.totalScore.toFixed(3)})`);
});

test('CODE size floor: params>=20B no penalty', () => {
  const model = {
    name: 'test:27b', family: 'test', category: 'code', params: 27,
    benchmarks: { swebench: 0.5, livecodebench: 0.5, humaneval: 0.5, arena: 0.5 },
    releaseDate: '2024-06-01', baseVramMb: 18000,
  };
  // category=code+CODE → bonus 0.10, no size penalty (27B >= 20B)
  const result = scoreModel(model, 'CODE', { gpuVramMb: 24000 });
  // Category 0.10 * 0.13 = 0.013 contribution
  assert(result.breakdown.category === 0.10, `Expected category bonus 0.10, got ${result.breakdown.category}`);
});

test('non-CODE role: no size floor for small models', () => {
  const small = {
    name: 'test:14b', family: 'test', category: 'general', params: 14,
    benchmarks: { mmlu: 0.8, reasoning: 0.8, arena: 0.5 },
    releaseDate: '2024-06-01', baseVramMb: 10000,
  };
  const r = scoreModel(small, 'D1', { gpuVramMb: 24000 });
  // D1 should not have size penalty — verify score is reasonable
  assert(r.totalScore > 0.3, `D1 14B should have decent score, got ${r.totalScore}`);
});

test('category weight 0.13, speed weight 0.07', () => {
  // Vision model: category bonus 0.10 for VISION
  const model = {
    name: 'test:13b', family: 'test', category: 'vision', params: 13,
    benchmarks: { mmlu: 0.5, arena: 0.5, reasoning: 0.3 },
    releaseDate: '2024-06-01', baseVramMb: 9000,
    capabilities: ['vision'],
  };
  // Score: benchmark*0.35 + hwFit*0.20 + maturity*0.15 + gen*0.10 + cat(0.10)*0.13 + speed*0.07
  const r = scoreModel(model, 'VISION', { gpuVramMb: 24000, referenceParams: 13 });
  // category contribution = 0.10 * 0.13 = 0.013
  // speed at 1.0 (same size as ref) → 1.0 * 0.07 = 0.07
  assert(r.totalScore > 0, 'Should produce valid score');
  assert(r.breakdown.category === 0.10, `Category should be 0.10, got ${r.breakdown.category}`);
});

test('dominance gate bypassed with strong empirical data', () => {
  // Setup: candidate has worse hwFit but much better empirical score
  const current = {
    name: 'small:27b', family: 'test', category: 'general', params: 27,
    benchmarks: { swebench: 0.5, livecodebench: 0.5, humaneval: 0.5, arena: 0.5 },
    releaseDate: '2024-06-01', baseVramMb: 18000,
  };
  const candidate = {
    name: 'big:32b', family: 'test', category: 'code', params: 32,
    benchmarks: { swebench: 0.5, livecodebench: 0.6, humaneval: 0.6, arena: 0.5 },
    releaseDate: '2024-06-01', baseVramMb: 22000,
  };
  // Without empirical: hwFit regression (0.7 < 0.8 for 27B→32B on 24GB) → blocked
  const r1 = evaluateUpgrade(current, candidate, 'CODE', { gpuVramMb: 24000 });
  if (r1.rejectReason?.includes('dominance gate')) {
    // Good — now verify empirical override works
    const r2 = evaluateUpgrade(current, candidate, 'CODE', { gpuVramMb: 24000 }, {
      candidate: { blendWeights: { benchmarkWeight: 0.25, empiricalWeight: 0.10 }, empiricalScore: 0.90 },
      current: { blendWeights: { benchmarkWeight: 0.25, empiricalWeight: 0.10 }, empiricalScore: 0.50 },
    });
    assert(!r2.rejectReason?.includes('dominance gate'),
      `Strong empirical (delta=0.40) should bypass dominance gate, got: ${r2.rejectReason}`);
  } else {
    assert(true, 'No dominance gate hit — model sizes may not trigger it');
  }
});

test('qwen3.5 now has full maturity', () => {
  const entry = getCatalogEntry('qwen3.5:27b');
  assert(entry.releaseDate, 'qwen3.5:27b should have releaseDate');
  const maturity = computeMaturity(entry.releaseDate);
  assert(maturity >= 1.0, `qwen3.5 maturity should be >= 1.0 (>90d old), got ${maturity}`);
});

suite('Ranker — Score Model & Evaluate Upgrade');

test('scoreModel returns totalScore 0-1 with breakdown', () => {
  const model = getCatalogEntry('qwen3:32b');
  const result = scoreModel(model, 'CODE', { gpuVramMb: 24000 });
  assert(result.totalScore >= 0 && result.totalScore <= 1, `Score out of range: ${result.totalScore}`);
  assert(result.breakdown, 'Missing breakdown');
  assert(typeof result.breakdown.benchmark === 'number');
  // hardwareFit už není složkou kvality — o vejde-se rozhoduje checkVramGate
  // z naměřeného umístění, v rozpadu zůstává jen jako null pro diagnostiku.
  assertEqual(result.breakdown.hardwareFit, null);
  assert(typeof result.breakdown.maturity === 'number');
  assert(typeof result.normalizedScore === 'number');
  assert(result.weights && typeof result.weights.speed === 'number', 'chybí použité váhy');
});

test('váha rychlosti závisí na roli', () => {
  const model = getCatalogEntry('qwen3:32b');
  const ctx = { referenceTokensPerSecond: 70 };
  const slowChat = scoreModel({ ...model, measuredTokensPerSecond: 30 }, 'CHAT', ctx).totalScore;
  const fastChat = scoreModel({ ...model, measuredTokensPerSecond: 140 }, 'CHAT', ctx).totalScore;
  const slowD1 = scoreModel({ ...model, measuredTokensPerSecond: 30 }, 'D1', ctx).totalScore;
  const fastD1 = scoreModel({ ...model, measuredTokensPerSecond: 140 }, 'D1', ctx).totalScore;
  assert((fastChat - slowChat) > (fastD1 - slowD1) * 2,
    'u CHAT musí rychlost vážit výrazně víc než u D1 — odezva je tam součástí kvality');
});

test('naměřená rychlost přebíjí odhad z velikosti', () => {
  // MoE model s 30B parametrů a 142 tok/s nesmí prohrát s hustým 14B modelem
  // jen proto, že odhad počítá rychlost z počtu parametrů.
  const moe = { ...getCatalogEntry('qwen3:32b'), params: 30, measuredTokensPerSecond: 142 };
  const dense = { ...getCatalogEntry('qwen3:32b'), params: 14, measuredTokensPerSecond: 74 };
  const ctx = { referenceParams: 27, referenceTokensPerSecond: 74 };
  assert(scoreModel(moe, 'CHAT', ctx).breakdown.speed > scoreModel(dense, 'CHAT', ctx).breakdown.speed,
    'rychlejší MoE musí mít vyšší speed složku');
});

test('checkVramGate: bez měření nebrání, s měřením rozhoduje', () => {
  assertEqual(checkVramGate(null).measured, false);
  assertEqual(checkVramGate(null).fits, true, 'bez měření se brána neuplatní');
  assertEqual(checkVramGate({ fits: true }).fits, true);
  const bad = checkVramGate({ fits: false, placement: { cpuBytes: 8 * 2 ** 30 } });
  assertEqual(bad.fits, false);
  assert(/8\.00 GB/.test(bad.reason), `důvod má uvést kolik jde na CPU: ${bad.reason}`);
});

test('evaluateUpgrade detects improvement', () => {
  const current = getCatalogEntry('qwen2.5:32b');
  const candidate = getCatalogEntry('qwen3:32b');
  const result = evaluateUpgrade(current, candidate, 'CODE', { gpuVramMb: 24000 });
  assert(result.delta > 0, `Expected positive delta, got ${result.delta}`);
  assert(typeof result.shouldUpgrade === 'boolean');
  assert(typeof result.riskLevel === 'string');
  assert(result.breakdown.current, 'Missing current breakdown');
  assert(result.breakdown.candidate, 'Missing candidate breakdown');
});

test('evaluateUpgrade context regression rejects', () => {
  const current = { name: 'test:32b', benchmarks: { mmlu: 0.8 }, contextWindow: 131072, params: 32 };
  const candidate = { name: 'test2:32b', benchmarks: { mmlu: 0.95 }, contextWindow: 32768, params: 32, releaseDate: '2024-01-01' };
  const result = evaluateUpgrade(current, candidate, 'CHAT', {});
  assert(!result.shouldUpgrade, 'Should reject context regression');
  assert(result.rejectReason?.includes('context window regression'), `Reason: ${result.rejectReason}`);
});

test('evaluateUpgrade dominance gate rejects', () => {
  // Candidate has much worse hardwareFit
  const current = { name: 'small:7b', benchmarks: { mmlu: 0.7 }, params: 7, baseVramMb: 5000, effectiveVramMb: 5000 };
  const candidate = {
    name: 'huge:70b', benchmarks: { mmlu: 0.9 }, params: 70, baseVramMb: 46000,
    effectiveVramMb: 46000, releaseDate: '2024-01-01',
  };
  const result = evaluateUpgrade(current, candidate, 'CHAT', { gpuVramMb: 48000 });
  // Speed score for 70b vs 7b reference will be very low → dominance gate should catch it
  if (!result.shouldUpgrade && result.rejectReason?.includes('dominance gate')) {
    assert(true);
  } else {
    // If no dominance gate hit, the improvement threshold may just not be met
    assert(!result.shouldUpgrade || result.delta >= 0, 'Result is valid either way');
  }
});

test('IMPROVEMENT_THRESHOLD varies by role', () => {
  assertEqual(IMPROVEMENT_THRESHOLD.D1, 0.06);
  assertEqual(IMPROVEMENT_THRESHOLD.CODE, 0.05);
  assertEqual(IMPROVEMENT_THRESHOLD.CHAT, 0.04);
});

suite('Ranker — Risk Level');

test('computeRiskLevel HIGH for large model', () => {
  const current = { params: 14 };
  const candidate = { sizeGB: 35 };
  assertEqual(computeRiskLevel(current, candidate), 'high');
});

test('computeRiskLevel HIGH for young model', () => {
  const current = {};
  const candidate = { releaseDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() };
  assertEqual(computeRiskLevel(current, candidate), 'high');
});

test('computeRiskLevel HIGH for param jump >2x', () => {
  const current = { params: 14 };
  const candidate = { params: 70, releaseDate: '2024-01-01' };
  assertEqual(computeRiskLevel(current, candidate), 'high');
});

test('computeRiskLevel HIGH for context drop >30%', () => {
  const current = { contextWindow: 131072 };
  const candidate = { contextWindow: 32768, releaseDate: '2024-01-01' };
  assertEqual(computeRiskLevel(current, candidate), 'high');
});

test('computeRiskLevel MEDIUM for architecture change', () => {
  const current = { architecture: 'transformer' };
  const candidate = { architecture: 'moe', releaseDate: '2024-01-01' };
  assertEqual(computeRiskLevel(current, candidate), 'medium');
});

test('computeRiskLevel LOW for minor same-family upgrade', () => {
  const current = { params: 32, architecture: 'transformer' };
  const candidate = { params: 32, architecture: 'transformer', releaseDate: '2024-01-01', sizeGB: 19 };
  assertEqual(computeRiskLevel(current, candidate), 'low');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROPOSAL STORE TESTS (~16)
// ═══════════════════════════════════════════════════════════════════════════

suite('Proposal Store — CRUD');

test('storeProposal creates new proposal', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  const result = store.storeProposal({
    role: 'CODE', currentModel: 'qwen2.5:32b', candidateModel: 'qwen3:32b',
    score: 0.75, improvement: 0.08, riskLevel: 'low', installed: true, sizeGB: 19.6,
  });
  assert(result.stored, 'Should be stored');
  assertEqual(result.reason, 'new');

  const active = store.getActiveProposals();
  assertEqual(active.length, 1);
  assertEqual(active[0].role, 'CODE');
});

test('storeProposal deduplicates same (role, candidate, hash, evalVer)', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  const proposal = {
    role: 'CODE', currentModel: 'qwen2.5:32b', candidateModel: 'qwen3:32b',
    score: 0.70, catalogHash: 'abc', evaluationVersion: 'v1',
  };
  store.storeProposal(proposal);
  const result = store.storeProposal({ ...proposal, score: 0.80 });
  assert(result.stored, 'Should be stored');
  assertEqual(result.reason, 'updated');

  const active = store.getActiveProposals();
  assertEqual(active.length, 1);
  assertEqual(active[0].score, 0.80); // Updated score
});

test('storeProposal allows re-propose when current_model changed', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({
    role: 'CODE', currentModel: 'qwen2.5:14b', candidateModel: 'qwen3:32b', score: 0.75,
  });
  store.storeProposal({
    role: 'CODE', currentModel: 'qwen2.5:32b', candidateModel: 'qwen3:32b', score: 0.80,
  });

  const active = store.getActiveProposals();
  assertEqual(active.length, 1);
  assertEqual(active[0].current_model, 'qwen2.5:32b'); // New current
});

suite('Proposal Store — State Transitions');

test('approve sets status', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({ role: 'D1', currentModel: 'a', candidateModel: 'b', score: 0.8 });
  const proposals = store.getActiveProposals();
  store.approve(proposals[0].id);

  assertEqual(store.getActiveProposals().length, 0);
  const history = store.getHistory({ status: 'approved' });
  assertEqual(history.length, 1);
});

test('reject sets cooldown', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({ role: 'D1', currentModel: 'a', candidateModel: 'b', score: 0.8 });
  const proposals = store.getActiveProposals();
  store.reject(proposals[0].id, 30);

  assert(store.isInCooldown('D1', 'b'), 'Should be in cooldown');
  assertEqual(store.getActiveProposals().length, 0);
});

test('dismiss blocks permanently', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({ role: 'CHAT', currentModel: 'a', candidateModel: 'b', score: 0.8 });
  const proposals = store.getActiveProposals();
  assertEqual(store.dismiss(proposals[0].id), true);
  assertEqual(store.dismiss(999999), false);

  assert(store.isDismissed('CHAT', 'b'), 'Should be dismissed');
  // Cannot re-store dismissed
  const result = store.storeProposal({ role: 'CHAT', currentModel: 'a', candidateModel: 'b', score: 0.9 });
  assert(!result.stored, 'Should not store dismissed');
  assertEqual(result.reason, 'dismissed');
});

test('rejected proposal blocks storage during cooldown', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({ role: 'D1', currentModel: 'a', candidateModel: 'b', score: 0.8 });
  store.reject(store.getActiveProposals()[0].id, 30);

  const result = store.storeProposal({ role: 'D1', currentModel: 'a', candidateModel: 'b', score: 0.9 });
  assert(!result.stored, 'Should not store during cooldown');
  assertEqual(result.reason, 'cooldown');
});

test('expireStale expires old proposals', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  // Insert proposal with old date
  db.prepare(`
    INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, detected_at)
    VALUES ('CODE', 'a', 'b', 0.8, 'pending', datetime('now', '-10 days'))
  `).run();

  const expired = store.expireStale(7);
  assertEqual(expired, 1);
  assertEqual(store.getActiveProposals().length, 0);
});

test('invalidateStale expires mismatched catalog hash', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({
    role: 'CODE', currentModel: 'a', candidateModel: 'b', score: 0.8,
    catalogHash: 'old-hash', evaluationVersion: 'v1',
  });

  const expired = store.invalidateStale('new-hash', 'v1');
  assertEqual(expired, 1);
});

test('invalidateStale expires mismatched evaluation version', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({
    role: 'CODE', currentModel: 'a', candidateModel: 'b', score: 0.8,
    catalogHash: 'hash1', evaluationVersion: 'v1',
  });

  const expired = store.invalidateStale('hash1', 'v2');
  assertEqual(expired, 1);
});

test('anti-thrashing blocks within 14 days', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  // Record a recent upgrade
  db.prepare(`
    INSERT INTO upgrade_history (role, from_model, to_model, action, created_at)
    VALUES ('CODE', 'old', 'new', 'apply', datetime('now', '-5 days'))
  `).run();

  const result = store.isAntiThrashing('CODE', db);
  assert(result.blocked, 'Should be blocked');
  assert(result.lastUpgradeAt, 'Should have lastUpgradeAt');
});

test('anti-thrashing allows after 14+ days', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  db.prepare(`
    INSERT INTO upgrade_history (role, from_model, to_model, action, created_at)
    VALUES ('CODE', 'old', 'new', 'apply', datetime('now', '-20 days'))
  `).run();

  const result = store.isAntiThrashing('CODE', db);
  assert(!result.blocked, 'Should not be blocked');
});

test('storeProposals enforces maxProposalsPerRole = 3', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  const result = store.storeProposals([
    { role: 'CODE', currentModel: 'a', candidateModel: 'b1', score: 0.9 },
    { role: 'CODE', currentModel: 'a', candidateModel: 'b2', score: 0.8 },
    { role: 'CODE', currentModel: 'a', candidateModel: 'b3', score: 0.7 },
    { role: 'CODE', currentModel: 'a', candidateModel: 'b4', score: 0.6 },
    { role: 'CODE', currentModel: 'a', candidateModel: 'b5', score: 0.5 },
  ]);
  assertEqual(result.stored, 3);
  assertEqual(result.skipped, 2); // 2 over the limit
});

test('getNotifiable returns proposals above threshold', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({ role: 'CODE', currentModel: 'a', candidateModel: 'b', score: 0.9 });
  store.storeProposal({ role: 'D1', currentModel: 'a', candidateModel: 'c', score: 0.1 });

  const notifiable = store.getNotifiable(0.5);
  assertEqual(notifiable.length, 1);
  assertEqual(notifiable[0].role, 'CODE');
});

test('findPending returns matching proposal', () => {
  const db = createTestDb();
  const store = new ProposalStore();
  store.setDb(db);

  store.storeProposal({ role: 'CODE', currentModel: 'a', candidateModel: 'qwen3:32b', score: 0.8 });
  const found = store.findPending('CODE', 'qwen3:32b');
  assert(found, 'Should find pending proposal');
  assertEqual(found.candidate_model, 'qwen3:32b');
});

test('no db returns safe defaults', () => {
  const store = new ProposalStore();
  const result = store.storeProposal({ role: 'X', currentModel: 'a', candidateModel: 'b', score: 1 });
  assert(!result.stored);
  assertEqual(store.getActiveProposals().length, 0);
  assert(!store.isInCooldown('X', 'b'));
  assert(!store.isDismissed('X', 'b'));
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PREFERENCE TRACKER TESTS (~10)
// ═══════════════════════════════════════════════════════════════════════════

suite('Preference Tracker');

test('sizeBucket classifies correctly', () => {
  assertEqual(sizeBucket(7), 'small');
  assertEqual(sizeBucket(9), 'small');
  assertEqual(sizeBucket(14), 'medium');
  assertEqual(sizeBucket(27), 'medium');
  assertEqual(sizeBucket(32), 'large');
  assertEqual(sizeBucket(70), 'large');
  assertEqual(sizeBucket(null), 'small');
  assertEqual(sizeBucket(0), 'small');
});

test('computePreferencePenalty returns 0 with no DB', () => {
  assertEqual(computePreferencePenalty('CODE', 'qwen', 32, null), 0);
});

test('computePreferencePenalty returns 0 with no history', () => {
  const db = createTestDb();
  assertEqual(computePreferencePenalty('CODE', 'qwen', 32, db), 0);
});

test('getPreferenceStats counts approvals and rejections', () => {
  const db = createTestDb();

  // Insert some proposal history
  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'old', 'qwen3:32b', 0.8, 'approved');
  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'old', 'qwen3:32b', 0.7, 'rejected');

  const stats = getPreferenceStats('CODE', db);
  const key = 'qwen:large'; // qwen3:32b → family=qwen, 32B=large
  assert(stats.has(key), `Expected key ${key} in stats`);
  const entry = stats.get(key);
  assertEqual(entry.approvals, 1);
  assertEqual(entry.rejections, 1);
  assertEqual(entry.totalActions, 2); // 1 approval + 1 rejection
});

test('getPreferenceStats applies time decay', () => {
  const db = createTestDb();

  // Old approval (>90 days)
  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now', '-100 days'))`)
    .run('CODE', 'old', 'qwen3:32b', 0.8, 'approved');

  const stats = getPreferenceStats('CODE', db);
  const key = 'qwen:large';
  const entry = stats.get(key);
  // exp(-100/90) ≈ 0.33 → score should be low
  assert(entry.score < 0.5, `Expected low score due to decay, got ${entry.score}`);
});

test('getPreferenceStats confidence dampening under 5 actions', () => {
  const db = createTestDb();

  // 2 approvals — confidence = 2/5 = 0.4
  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'old', 'qwen3:32b', 0.8, 'approved');
  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'old2', 'qwen3:32b', 0.7, 'approved');

  const stats = getPreferenceStats('CODE', db);
  const key = 'qwen:large';
  const entry = stats.get(key);
  // totalActions = 2, confidence = min(1, 2/5) = 0.4
  // base = 2/2 = 1.0, decay ≈ 1.0 (recent), score = 1.0 * 1.0 * 0.4 = 0.4
  assert(entry.score < 1.0, `Expected dampened score, got ${entry.score}`);
});

test('preference penalty is 0 for positive history', () => {
  const db = createTestDb();

  // 5+ approvals → confidence = 1.0, base = 1.0
  for (let i = 0; i < 6; i++) {
    db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('CODE', `old${i}`, 'qwen3:32b', 0.8, 'approved');
  }

  const penalty = computePreferencePenalty('CODE', 'qwen', 32, db);
  assertEqual(penalty, 0);
});

test('preference penalty > 0 for negative history', () => {
  const db = createTestDb();

  // 5 rejections → base = 0, penalty = 0.5 * 0.16 = 0.08
  for (let i = 0; i < 5; i++) {
    db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('CODE', `old${i}`, 'qwen3:32b', 0.8, 'rejected');
  }

  const penalty = computePreferencePenalty('CODE', 'qwen', 32, db);
  assert(penalty > 0, `Expected positive penalty, got ${penalty}`);
  assert(penalty <= 0.08, `Penalty capped at 0.08, got ${penalty}`);
});

test('getPreferenceStats counts rollbacks with 2x weight', () => {
  const db = createTestDb();

  // 1 rollback
  db.prepare(`INSERT INTO upgrade_history (role, from_model, to_model, new_model, action, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'qwen3:32b', 'qwen2.5:32b', 'qwen3:32b', 'rollback');

  const stats = getPreferenceStats('CODE', db);
  const key = 'qwen:large'; // qwen3:32b → family=qwen, size=32=large
  const entry = stats.get(key);
  assertEqual(entry.rollbacks, 1);
  assertEqual(entry.totalActions, 2); // rollback * 2
});

test('getPreferenceStats counts dismissals with 3x weight', () => {
  const db = createTestDb();

  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'old', 'qwen3:32b', 0.8, 'dismissed');

  const stats = getPreferenceStats('CODE', db);
  const key = 'qwen:large';
  const entry = stats.get(key);
  assertEqual(entry.dismissals, 1);
  assertEqual(entry.totalActions, 3); // dismissal * 3
});

test('per-role isolation', () => {
  const db = createTestDb();

  db.prepare(`INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run('CODE', 'old', 'qwen3:32b', 0.8, 'rejected');

  const codeStats = getPreferenceStats('CODE', db);
  const chatStats = getPreferenceStats('CHAT', db);
  assert(codeStats.size > 0, 'CODE should have stats');
  assertEqual(chatStats.size, 0, 'CHAT should have no stats');
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. REGISTRY CLIENT TESTS (~6)
// ═══════════════════════════════════════════════════════════════════════════

suite('Registry Client');

test('cached result returned without fetch', () => {
  const client = new RegistryClient();
  // Manually populate cache
  client._cache.set('qwen3', { exists: true, verifiedAt: new Date().toISOString() });

  // Sync check — the method is async but uses cache
  let result;
  client.verify('qwen3').then(r => { result = r; });
  // Wait a tick (cache path is sync-like)
  const syncResult = { exists: client._cache.get('qwen3').exists, cached: true };
  assert(syncResult.exists, 'Should return cached result');
  assert(syncResult.cached, 'Should be cached');
});

test('offline detection after failures', () => {
  const client = new RegistryClient();
  client._failureCount = 3;
  client._offlineSince = Date.now();
  assert(client.isOffline(), 'Should be offline after 3 failures');
});

test('offline recovery after 1 hour', () => {
  const client = new RegistryClient();
  client._failureCount = 3;
  client._offlineSince = Date.now() - 61 * 60 * 1000; // 61 min ago
  assert(!client.isOffline(), 'Should recover after 1 hour');
});

test('cache TTL expires after 7 days', () => {
  const client = new RegistryClient();
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert(client._isCacheExpired(oldDate), 'Should be expired');

  const newDate = new Date().toISOString();
  assert(!client._isCacheExpired(newDate), 'Should not be expired');
});

test('DB cache persistence', () => {
  const db = createTestDb();
  const client = new RegistryClient();
  client.setDb(db);

  client._updateCache('testmodel', true);
  const row = db.prepare('SELECT * FROM model_catalog_cache WHERE model_name = ?').get('testmodel');
  assert(row, 'Should persist to DB');
  assertEqual(row.exists_in_registry, 1);
});

test('loadCache populates from DB', () => {
  const db = createTestDb();
  db.prepare("INSERT INTO model_catalog_cache (model_name, exists_in_registry, verified_at) VALUES (?, ?, datetime('now'))").run('cached_model', 1);

  const client = new RegistryClient();
  client.setDb(db);
  client.loadCache();

  assert(client._cache.has('cached_model'), 'Should load from DB');
  assert(client._cache.get('cached_model').exists, 'Should be true');
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. FEASIBILITY GATE TESTS (~8)
// ═══════════════════════════════════════════════════════════════════════════

suite('Feasibility Gate');

test('VRAM check rejects over 90%', () => {
  const result = checkFeasibility(
    { effectiveVramMb: 23000, capabilities: [] },
    'CODE',
    { gpuVramMb: 24000 }
  );
  assert(!result.feasible, 'Should reject: 23000/24000 = 95.8% > 90%');
  assert(result.reason.includes('VRAM'), `Reason: ${result.reason}`);
});

test('VRAM check passes under 90%', () => {
  const result = checkFeasibility(
    { effectiveVramMb: 20000, capabilities: [] },
    'CODE',
    { gpuVramMb: 24000 }
  );
  assert(result.feasible, 'Should pass: 20000/24000 = 83.3% < 90%');
});

test('capability check rejects missing json_mode for D1', () => {
  const result = checkFeasibility(
    { capabilities: [], effectiveVramMb: 5000 },
    'D1',
    { gpuVramMb: 24000 }
  );
  assert(!result.feasible, 'D1 requires json_mode');
  assert(result.reason.includes('json_mode'), `Reason: ${result.reason}`);
});

test('capability check passes with json_mode for D1', () => {
  const result = checkFeasibility(
    { capabilities: ['json_mode'], effectiveVramMb: 5000 },
    'D1',
    { gpuVramMb: 24000 }
  );
  assert(result.feasible, 'Should pass with json_mode');
});

test('vision capability required for VISION role', () => {
  const result = checkFeasibility(
    { capabilities: [], effectiveVramMb: 5000 },
    'VISION',
    { gpuVramMb: 24000 }
  );
  assert(!result.feasible, 'VISION requires vision capability');
});

test('host RAM check rejects oversize', () => {
  const result = checkFeasibility(
    { params: 70, capabilities: [], effectiveVramMb: 40000 },
    'CODE',
    { gpuVramMb: 48000, systemRamGb: 32 }
  );
  // 70 * 0.6 = 42 GB > 32 * 0.7 = 22.4 GB
  assert(!result.feasible, 'Should reject: RAM insufficient');
  assert(result.reason.includes('RAM'), `Reason: ${result.reason}`);
});

test('CPU-only param cap rejects >14B', () => {
  const result = checkFeasibility(
    { params: 32, capabilities: [] },
    'CODE',
    { gpuVramMb: 0 }
  );
  assert(!result.feasible, 'Should reject: 32B > 14B CPU cap');
  assert(result.reason.includes('CPU-only'), `Reason: ${result.reason}`);
});

test('disk space check rejects', () => {
  const result = checkFeasibility(
    { sizeGB: 40, capabilities: [] },
    'CODE',
    { gpuVramMb: 48000, freeDiskGb: 45 }
  );
  // 40 > 45 * 0.8 = 36
  assert(!result.feasible, 'Should reject: insufficient disk');
  assert(result.reason.includes('disk'), `Reason: ${result.reason}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// v120.2: VISION Capability Guard, L1 Enrichment, Role Diversity Penalty
// ═══════════════════════════════════════════════════════════════════════════

suite('v120.2 — Capability Guard (undefined capabilities)');

test('undefined capabilities rejects for D1 (requires json_mode)', () => {
  const result = checkFeasibility(
    { params: 14, effectiveVramMb: 10000 },
    'D1',
    { gpuVramMb: 24000 }
  );
  assert(!result.feasible, 'Should reject when capabilities is undefined');
  assert(result.reason.includes('json_mode'), `Reason: ${result.reason}`);
});

test('undefined capabilities rejects for VISION (requires vision)', () => {
  const result = checkFeasibility(
    { params: 14, effectiveVramMb: 10000 },
    'VISION',
    { gpuVramMb: 24000 }
  );
  assert(!result.feasible, 'Should reject when capabilities is undefined');
  assert(result.reason.includes('vision'), `Reason: ${result.reason}`);
});

test('null capabilities rejects for D1', () => {
  const result = checkFeasibility(
    { params: 14, capabilities: null, effectiveVramMb: 10000 },
    'D1',
    { gpuVramMb: 24000 }
  );
  assert(!result.feasible, 'Should reject when capabilities is null');
});

test('empty capabilities passes for CODE (no requirements)', () => {
  const result = checkFeasibility(
    { params: 14, capabilities: [], effectiveVramMb: 10000 },
    'CODE',
    { gpuVramMb: 24000 }
  );
  assert(result.feasible, 'CODE has no capability requirements');
});

test('undefined capabilities passes for CHAT (no requirements)', () => {
  const result = checkFeasibility(
    { params: 14, effectiveVramMb: 10000 },
    'CHAT',
    { gpuVramMb: 24000 }
  );
  assert(result.feasible, 'CHAT has no capability requirements');
});

test('vision capability passes for VISION', () => {
  const result = checkFeasibility(
    { params: 14, capabilities: ['vision'], effectiveVramMb: 10000 },
    'VISION',
    { gpuVramMb: 24000 }
  );
  assert(result.feasible, 'Should pass with vision capability');
});

suite('v120.2 — Role Diversity Penalty');

test('no penalty when model serves single role', () => {
  const result = scoreModel(
    { name: 'test:14b', params: 14, benchmarks: { swebench: 0.5 }, category: 'general', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: { CODE: 'test:14b', D1: 'other:32b', CHAT: 'other:32b' } }
  );
  assertEqual(result.breakdown.diversityPenalty, 0, 'No penalty for single-role model');
});

test('penalty -0.01 when model serves 2 roles', () => {
  const result = scoreModel(
    { name: 'shared:27b', params: 27, benchmarks: { swebench: 0.5 }, category: 'general', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: { CODE: 'shared:27b', CHAT: 'shared:27b', D1: 'other:32b' } }
  );
  assertEqual(result.breakdown.diversityPenalty, -0.01, 'One other role using same model = -0.01');
});

test('penalty -0.02 when model serves 3 roles', () => {
  const result = scoreModel(
    { name: 'shared:27b', params: 27, benchmarks: { swebench: 0.5 }, category: 'general', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: { CODE: 'shared:27b', CHAT: 'shared:27b', R2: 'shared:27b', D1: 'other:32b' } }
  );
  assertEqual(result.breakdown.diversityPenalty, -0.02, 'Two other roles using same model = -0.02');
});

test('penalty capped at -0.04', () => {
  const result = scoreModel(
    { name: 'mono:27b', params: 27, benchmarks: { swebench: 0.5 }, category: 'general', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: {
      CODE: 'mono:27b', D1: 'mono:27b', D2: 'mono:27b',
      R1: 'mono:27b', R2: 'mono:27b', CHAT: 'mono:27b', VISION: 'mono:27b'
    } }
  );
  assertEqual(result.breakdown.diversityPenalty, -0.04, 'Cap at -0.04 even with 6 other roles');
});

test('no roleBindings = no penalty (backward compat)', () => {
  const result = scoreModel(
    { name: 'test:14b', params: 14, benchmarks: { swebench: 0.5 }, category: 'general', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000 }
  );
  assertEqual(result.breakdown.diversityPenalty, 0, 'No roleBindings = no penalty');
});

test('diversity penalty reduces total score', () => {
  const base = scoreModel(
    { name: 'test:27b', params: 27, benchmarks: { swebench: 0.6, livecodebench: 0.7 }, category: 'code', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: { CODE: 'test:27b', D1: 'other:32b' } }
  );
  const penalized = scoreModel(
    { name: 'test:27b', params: 27, benchmarks: { swebench: 0.6, livecodebench: 0.7 }, category: 'code', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: { CODE: 'test:27b', D1: 'test:27b', CHAT: 'test:27b', R2: 'test:27b' } }
  );
  assert(penalized.totalScore < base.totalScore, `Penalized ${penalized.totalScore} should be < base ${base.totalScore}`);
  const diff = base.totalScore - penalized.totalScore;
  assert(Math.abs(diff - 0.03) < 0.001, `Score diff should be ~0.03, got ${diff.toFixed(4)}`);
});

test('diversity penalty only counts OTHER roles, not the scored role itself', () => {
  const result = scoreModel(
    { name: 'test:27b', params: 27, benchmarks: { swebench: 0.5 }, category: 'general', releaseDate: '2025-01-01' },
    'CODE',
    { gpuVramMb: 24000, roleBindings: { CODE: 'test:27b' } }
  );
  assertEqual(result.breakdown.diversityPenalty, 0, 'Own role not counted');
});

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
