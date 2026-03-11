// Model Ranker v118 — Pairwise upgrade evaluation with multi-dimensional scoring
// ══════════════════════════════════════════════════════════════════════════════
//
// Scores a model for a specific role, then compares candidate vs current.
// No absolute ranking — pairwise evaluation only.
//
// Score formula (0-1):
//   benchmarkScore * 0.35 + hardwareFit * 0.20 + maturity * 0.15
//   + generation * 0.10 + category * 0.10 + speedScore * 0.10
//
// ══════════════════════════════════════════════════════════════════════════════

import { parseModelName, isNewerVersion } from './model-profiles.js';

export const EVALUATION_VERSION = 'v120.1';

// ─── Benchmark Weights per Role ──────────────────────────────────────────────

export const BENCHMARK_WEIGHTS = {
  D1:     { swebench: 0.20, reasoning: 0.50, mmlu: 0.20, arena: 0.10 },
  D2:     { swebench: 0.30, reasoning: 0.20, mmlu: 0.30, arena: 0.20 },
  CODE:   { swebench: 0.45, livecodebench: 0.30, humaneval: 0.15, arena: 0.10 },
  R1:     { swebench: 0.20, reasoning: 0.50, mmlu: 0.20, arena: 0.10 },
  R2:     { swebench: 0.10, reasoning: 0.30, mmlu: 0.40, arena: 0.20 },
  CHAT:   { swebench: 0.15, reasoning: 0.15, mmlu: 0.35, arena: 0.35 },
  VISION: { reasoning: 0.20, mmlu: 0.40, arena: 0.40 },
};

// ─── Improvement Thresholds per Role ─────────────────────────────────────────

export const IMPROVEMENT_THRESHOLD = {
  D1: 0.06, D2: 0.05, CODE: 0.05, R1: 0.06, R2: 0.05, CHAT: 0.04, VISION: 0.05,
};

// ─── Score Components ────────────────────────────────────────────────────────

/**
 * Compute weighted benchmark score for a role.
 * Null benchmarks: redistribute weight proportionally to non-null.
 */
export function computeBenchmarkScore(benchmarks, role) {
  if (!benchmarks) return 0;
  const weights = BENCHMARK_WEIGHTS[role];
  if (!weights) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(weights)) {
    if (benchmarks[key] != null) {
      totalWeight += weight;
      weightedSum += benchmarks[key] * weight;
    }
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight; // Redistributed to non-null
}

/**
 * Category bonus — small bump for category-role alignment.
 */
export function computeCategoryBonus(category, role) {
  if (category === 'code' && role === 'CODE') return 0.05;
  if (category === 'reasoning' && (role === 'D1' || role === 'R1')) return 0.05;
  if (category === 'vision' && role === 'VISION') return 0.10;
  return 0;
}

/**
 * Hardware fit score based on effective VRAM vs GPU VRAM.
 * @param {number} effectiveVramMb - Model's effective VRAM requirement
 * @param {number} gpuVramMb - Available GPU VRAM (0 = CPU-only)
 * @returns {number} 0-1
 */
export function computeHardwareFit(effectiveVramMb, gpuVramMb) {
  if (!gpuVramMb || gpuVramMb === 0) return 0.3; // CPU-only
  if (!effectiveVramMb) return 0.5; // Unknown

  const ratio = effectiveVramMb / gpuVramMb;
  if (ratio <= 0.80) return 1.0;  // Comfortable
  if (ratio <= 0.95) return 0.7;  // Tight
  if (ratio <= 1.00) return 0.4;  // Swap risk
  return 0.0;                      // Incompatible
}

/**
 * Speed score — penalizes large models relative to current.
 * @param {number} candidateParams - Candidate param count (billions)
 * @param {number} referenceParams - Current model param count (billions)
 * @returns {number} 0.6-1.2 (clamped)
 */
export function computeSpeedScore(candidateParams, referenceParams) {
  if (!candidateParams || !referenceParams || referenceParams === 0) return 0.8;
  const raw = 1 / Math.sqrt(candidateParams / referenceParams);
  return Math.max(0.6, Math.min(1.2, raw));
}

/**
 * Generation bonus from supersedes chain.
 * @param {Object} candidate - CatalogEntry or ModelCandidate
 * @param {Object} current - Current model info { name, family, version }
 * @returns {number} 0-1
 */
export function computeGenerationBonus(candidate, current) {
  if (!current || !candidate) return 0;

  const cParsed = typeof candidate.family === 'string' ? candidate : parseModelName(candidate.name);
  const curParsed = typeof current.family === 'string' ? current : parseModelName(current.name);

  // Direct successor via supersedes
  if (candidate.supersedes && candidate.supersedes === curParsed.name?.replace(/:.*/, '')) {
    return 1.0;
  }

  // Same family
  if (cParsed.family && cParsed.family === curParsed.family && cParsed.family !== 'unknown') {
    // Minor version bump (e.g. 3 → 3.5)
    if (cParsed.version && curParsed.version) {
      const cv = parseFloat(cParsed.version);
      const cuv = parseFloat(curParsed.version);
      if (!isNaN(cv) && !isNaN(cuv)) {
        if (cv > cuv && cv - cuv < 1) return 0.7; // Minor version
        if (cv > cuv) return 0.8; // Major version
      }
    }
    // Same family, newer (from isNewerVersion)
    if (isNewerVersion(curParsed.name || current.name, cParsed.name || candidate.name)) {
      return 0.5;
    }
    return 0.3; // Same family, unknown version relation
  }

  return 0.0; // Different family
}

/**
 * Maturity / community trust score.
 * @param {string} releaseDate - ISO date string
 * @returns {number} 0-1
 */
export function computeMaturity(releaseDate) {
  if (!releaseDate) return 0.5; // Unknown
  const ageDays = (Date.now() - Date.parse(releaseDate)) / (24 * 60 * 60 * 1000);
  if (ageDays > 90) return 1.0 + 0.02; // Stability bonus (capped at 1.0 in final)
  if (ageDays >= 30) return 0.7;
  if (ageDays >= 7) return 0.4;
  return 0.0; // Immature
}

// ─── Model Scoring ────────────────────────────────────────────────────────

/**
 * Score a single model for a specific role.
 *
 * @param {Object} model - CatalogEntry or ModelCandidate
 * @param {string} role - D1, D2, CODE, R1, R2, CHAT, VISION
 * @param {Object} context - { gpuVramMb, referenceParams }
 * @returns {{ totalScore: number, breakdown: Object }}
 */
export function scoreModel(model, role, context = {}, empirical = {}) {
  const benchmark = computeBenchmarkScore(model.benchmarks, role);
  const category = computeCategoryBonus(model.category, role);
  const hwFit = computeHardwareFit(
    model.effectiveVramMb || model.baseVramMb || 0,
    context.gpuVramMb || 0
  );
  const speed = computeSpeedScore(model.params, context.referenceParams);
  const maturityRaw = computeMaturity(model.releaseDate);
  const maturity = Math.min(1.0, maturityRaw);
  const generation = computeGenerationBonus(model, context.currentModel);

  // v120: Blended benchmark + empirical scoring
  const bw = empirical.blendWeights?.benchmarkWeight ?? 0.35;
  const ew = empirical.blendWeights?.empiricalWeight ?? 0.00;
  const rawEs = empirical.empiricalScore ?? 0;
  // Hard cap: empirical contribution <= MAX_EMPIRICAL_CONTRIBUTION (0.25)
  const es = ew > 0 ? Math.min(rawEs, 0.25 / ew) : rawEs;

  const totalScore = Math.min(1.0,
    benchmark * bw +
    es * ew +
    hwFit * 0.20 +
    maturity * 0.15 +
    generation * 0.10 +
    category * 0.10 +
    speed * 0.10
  );

  return {
    totalScore,
    normalizedScore: Math.round(totalScore * 11), // Backward compat with Phase 1 (0-11)
    breakdown: {
      benchmark,
      hardwareFit: hwFit,
      maturity,
      generation,
      category,
      speed,
    },
  };
}

// ─── Risk Scoring ─────────────────────────────────────────────────────────

/**
 * Compute risk level for an upgrade.
 */
export function computeRiskLevel(current, candidate) {
  const ageDays = candidate.releaseDate
    ? (Date.now() - Date.parse(candidate.releaseDate)) / (24 * 60 * 60 * 1000)
    : 999;

  const paramJump = (candidate.params && current.params)
    ? candidate.params / current.params
    : 1;

  const ctxDrop = (candidate.contextWindow && current.contextWindow)
    ? 1 - (candidate.contextWindow / current.contextWindow)
    : 0;

  const archChange = candidate.architecture && current.architecture
    && candidate.architecture !== current.architecture;

  // HIGH conditions
  if ((candidate.sizeGB || 0) > 30) return 'high';
  if (ageDays < 14) return 'high';
  if (paramJump > 2) return 'high';
  if (ctxDrop > 0.30) return 'high';

  // MEDIUM conditions
  if (archChange) return 'medium';
  if (paramJump > 1.5) return 'medium';

  return 'low';
}

// ─── Pairwise Upgrade Evaluation ──────────────────────────────────────────

/**
 * Evaluate whether upgrading from current to candidate is worthwhile.
 *
 * @param {Object} current - Current model (CatalogEntry or { name, family, params, benchmarks, ... })
 * @param {Object} candidate - Candidate model
 * @param {string} role
 * @param {Object} context - { gpuVramMb }
 * @returns {{ shouldUpgrade: boolean, currentScore: number, candidateScore: number,
 *             delta: number, breakdown: Object, riskLevel: string, rejectReason?: string }}
 */
export function evaluateUpgrade(current, candidate, role, context = {}, empiricalCtx = {}) {
  const currentParams = current.params || parseModelName(current.name || '').params || 0;
  const candidateParams = candidate.params || parseModelName(candidate.name || '').params || 0;

  const currentScoreResult = scoreModel(current, role, {
    ...context,
    referenceParams: currentParams,
    currentModel: current,
  }, empiricalCtx.current || {});

  const candidateScoreResult = scoreModel(candidate, role, {
    ...context,
    referenceParams: currentParams,
    currentModel: current,
  }, empiricalCtx.candidate || {});

  const delta = candidateScoreResult.totalScore - currentScoreResult.totalScore;
  const threshold = IMPROVEMENT_THRESHOLD[role] || 0.05;
  const riskLevel = computeRiskLevel(current, candidate);

  // Context regression check
  if (candidate.contextWindow && current.contextWindow) {
    if (candidate.contextWindow < current.contextWindow * 0.5) {
      return {
        shouldUpgrade: false,
        currentScore: currentScoreResult.totalScore,
        candidateScore: candidateScoreResult.totalScore,
        delta,
        breakdown: {
          current: currentScoreResult.breakdown,
          candidate: candidateScoreResult.breakdown,
        },
        riskLevel,
        rejectReason: `context window regression: ${candidate.contextWindow} < ${current.contextWindow * 0.5}`,
      };
    }
  }

  // Dominance gate — no dimension worse by >20%
  const dominanceChecks = [
    ['hardwareFit', candidateScoreResult.breakdown.hardwareFit, currentScoreResult.breakdown.hardwareFit],
    ['speed', candidateScoreResult.breakdown.speed, currentScoreResult.breakdown.speed],
  ];

  // Context window as normalized dimension (1.0 = same or better, 0 = none)
  if (candidate.contextWindow && current.contextWindow) {
    const ctxRatio = candidate.contextWindow / current.contextWindow;
    dominanceChecks.push(['contextWindow', Math.min(1.0, ctxRatio), 1.0]);
  }

  for (const [dim, candVal, curVal] of dominanceChecks) {
    if (curVal > 0 && candVal < curVal * 0.8) {
      return {
        shouldUpgrade: false,
        currentScore: currentScoreResult.totalScore,
        candidateScore: candidateScoreResult.totalScore,
        delta,
        breakdown: {
          current: currentScoreResult.breakdown,
          candidate: candidateScoreResult.breakdown,
        },
        riskLevel,
        rejectReason: `dominance gate: ${dim} regression (${candVal.toFixed(2)} < ${(curVal * 0.8).toFixed(2)})`,
      };
    }
  }

  return {
    shouldUpgrade: delta >= threshold,
    currentScore: currentScoreResult.totalScore,
    candidateScore: candidateScoreResult.totalScore,
    delta,
    breakdown: {
      current: currentScoreResult.breakdown,
      candidate: candidateScoreResult.breakdown,
    },
    riskLevel,
  };
}

// ─── Phase 3/4 Interface Stubs ────────────────────────────────────────────

/**
 * Phase 3: Empirical Model Evaluation — IMPLEMENTED (v120)
 * See: empirical-scorer.js, metrics-collector.js
 *
 * scoreModel() accepts empirical = { blendWeights, empiricalScore }
 * evaluateUpgrade() accepts empiricalCtx = { current, candidate } (each with blendWeights + empiricalScore)
 *
 * Blend transition (B+E=0.35):
 *   <10 samples:  B=0.35, E=0.00 (Phase 2 behavior)
 *   10-50:        B=0.25, E=0.10
 *   >50:          B=0.15, E=0.20
 *   Hard cap: empirical contribution <= 0.25
 */

/**
 * Phase 4: Adaptive Multi-Model Routing (NOT IMPLEMENTED)
 * @typedef {Object} RoutingDecision
 * @property {string} role
 * @property {string} selectedModel
 * @property {string} taskType           - 'reasoning'|'code_gen'|'review'|'chat'
 * @property {number} confidence         - 0-1
 * @property {string} fallbackModel
 */

export default {
  scoreModel, evaluateUpgrade, computeRiskLevel,
  computeBenchmarkScore, computeCategoryBonus, computeHardwareFit,
  computeSpeedScore, computeGenerationBonus, computeMaturity,
  BENCHMARK_WEIGHTS, IMPROVEMENT_THRESHOLD, EVALUATION_VERSION,
};
