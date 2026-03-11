/**
 * empirical-scorer.js — v120 Phase 3
 *
 * Pure scoring functions for empirical model evaluation.
 * No DB, no side effects. All inputs are pre-aggregated metrics.
 */

export const MIN_SAMPLES = 10;
export const FULL_CONFIDENCE_SAMPLES = 50;
export const MAX_EMPIRICAL_CONTRIBUTION = 0.25;
export const EMPIRICAL_SCHEMA_VERSION = 1;

// ---------- Normalization helpers ----------

/**
 * Token efficiency: 1.0 at median, linear decay to 0.0 at 3× median.
 * Below median → clamped to 1.0 (better than median is still 1.0).
 */
export function normalizeEfficiency(avgTokens, medianTokens) {
  if (!medianTokens || medianTokens <= 0 || !isFinite(avgTokens)) return 0;
  if (avgTokens <= medianTokens) return 1.0;
  const ratio = (avgTokens - medianTokens) / (medianTokens * 2); // 0→1 as avg goes median→3×median
  return Math.max(0, Math.min(1, 1 - ratio));
}

/**
 * Iteration efficiency: 1 iteration = 1.0, 11+ iterations = 0.0.
 * clamp(1 - (iterations - 1) / 10, 0, 1)
 */
export function normalizeIterations(iterations) {
  if (!isFinite(iterations) || iterations < 1) return 1.0;
  return Math.max(0, Math.min(1, 1 - (iterations - 1) / 10));
}

/**
 * Duration efficiency: 1.0 at median, faster → clamped 1.0.
 * clamp(medianDuration / durationMs, 0, 1)
 */
export function normalizeDuration(durationMs, medianDuration) {
  if (!medianDuration || medianDuration <= 0 || !isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, medianDuration / durationMs));
}

/**
 * Composite efficiency score:
 *   normalizeEfficiency(tokens) * 0.6
 * + normalizeIterations(iterations) * 0.3
 * + normalizeDuration(durationMs, medianDuration) * 0.1
 */
export function computeEfficiency(metrics) {
  if (!metrics) return 0;
  const tokenEff = normalizeEfficiency(metrics.avgTokens, metrics.medianTokens);
  const iterEff = normalizeIterations(metrics.avgIterations);
  const durEff = normalizeDuration(metrics.avgDurationMs, metrics.medianDurationMs);
  return tokenEff * 0.6 + iterEff * 0.3 + durEff * 0.1;
}

// ---------- Core scoring ----------

/**
 * Compute empirical score from aggregated metrics.
 *
 * rawScore = smoothedPatchSuccess * 0.45 + smoothedCheckpointPass * 0.35 + efficiency * 0.20
 * confidence = min(1.0, sampleCount / FULL_CONFIDENCE_SAMPLES)
 * return rawScore * confidence
 */
export function computeEmpiricalScore(metrics) {
  if (!metrics || !metrics.sampleCount) return 0;

  const patchSuccess = metrics.smoothedPatchSuccess ?? metrics.patchSuccessRate ?? 0;
  const checkpointPass = metrics.smoothedCheckpointPass ?? metrics.checkpointPassRate ?? 0;
  const efficiency = computeEfficiency(metrics);

  const rawScore = patchSuccess * 0.45 + checkpointPass * 0.35 + efficiency * 0.20;
  const confidence = Math.min(1.0, metrics.sampleCount / FULL_CONFIDENCE_SAMPLES);

  const result = rawScore * confidence;
  if (!isFinite(result)) return 0;
  return Math.max(0, Math.min(1, result));
}

// ---------- Blend weights ----------

/**
 * Compute blend weights based on sample count.
 * B+E always sums to 0.35 — other signal weights unchanged.
 *
 * <10 samples:  B=0.35, E=0.00 (Phase 2 behavior)
 * 10-50:        B=0.25, E=0.10
 * >50:          B=0.15, E=0.20
 */
export function computeBlendWeights(sampleSize) {
  if (!sampleSize || sampleSize < MIN_SAMPLES) {
    return { benchmarkWeight: 0.35, empiricalWeight: 0.00 };
  }
  if (sampleSize <= FULL_CONFIDENCE_SAMPLES) {
    return { benchmarkWeight: 0.25, empiricalWeight: 0.10 };
  }
  return { benchmarkWeight: 0.15, empiricalWeight: 0.20 };
}

// ---------- Hard cap ----------

/**
 * Enforce: empiricalScore * empiricalWeight <= MAX_EMPIRICAL_CONTRIBUTION.
 * If exceeded, return the capped score such that score * weight = MAX_EMPIRICAL_CONTRIBUTION.
 */
export function capEmpiricalContribution(empiricalScore, empiricalWeight) {
  if (!empiricalWeight || empiricalWeight <= 0) return empiricalScore;
  const contribution = empiricalScore * empiricalWeight;
  if (contribution <= MAX_EMPIRICAL_CONTRIBUTION) return empiricalScore;
  return MAX_EMPIRICAL_CONTRIBUTION / empiricalWeight;
}
