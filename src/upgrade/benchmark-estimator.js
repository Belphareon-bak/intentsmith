// Benchmark Estimator v121.1 — Log-space interpolation for provisional models
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure functions for estimating benchmarks from known family members in CATALOG.
// Used by OnlineDiscovery (L4) to score models not in the curated catalog.
//
// Key formulas:
//   VRAM:       baseVramMb = 620 * params + 420  (Q4_K_M fit)
//   Benchmark:  log-space interpolation between 2+ known points per family
//   Confidence: 0.70-0.85 (interpolation), 0.50-0.65 (close extrap), 0.30-0.45 (far)
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize family name for consistent matching across catalog, HTML, and tags.
 * Strips hyphens, underscores, lowercases, removes trailing .N version decimals.
 *
 * Examples: 'qwen-3' → 'qwen3', 'Qwen3' → 'qwen3',
 *           'deepseek-r1' → 'deepseekr1', 'qwen3.5' → 'qwen3'
 */
export function normalizeFamily(name) {
  if (!name) return '';
  let n = name.toLowerCase().replace(/[-_]/g, '');
  // Strip trailing .N (version decimal) — 'qwen3.5' → 'qwen3'
  n = n.replace(/\.\d+$/, '');
  return n;
}

/**
 * Estimate VRAM for Q4_K_M quantization from parameter count.
 * Formula: 620 * params + 420 (MB), fitted against catalog data.
 *
 * @param {number} params - Parameter count in billions
 * @returns {number} Estimated base VRAM in MB
 */
export function estimateVram(params) {
  if (!params || params <= 0) return 0;
  return Math.round(620 * params + 420);
}

/**
 * Log-space linear interpolation between two known benchmark points.
 * log(bench) = log(b1) + (log(b2)-log(b1)) * (log(p)-log(p1)) / (log(p2)-log(p1))
 *
 * @param {number} p  - Target param count
 * @param {number} p1 - Lower known param count
 * @param {number} b1 - Lower known benchmark value
 * @param {number} p2 - Upper known param count
 * @param {number} b2 - Upper known benchmark value
 * @returns {number} Estimated benchmark value
 */
export function logInterpolate(p, p1, b1, p2, b2) {
  if (!p || !p1 || !p2 || p1 === p2) return b1;
  if (!b1 || b1 <= 0) return b2;
  if (!b2 || b2 <= 0) return b1;

  const logP = Math.log(p);
  const logP1 = Math.log(p1);
  const logP2 = Math.log(p2);
  const logB1 = Math.log(b1);
  const logB2 = Math.log(b2);

  const t = (logP - logP1) / (logP2 - logP1);
  const logResult = logB1 + (logB2 - logB1) * t;

  return Math.max(0, Math.min(1.0, Math.exp(logResult)));
}

/**
 * Build family scaling models from catalog entries.
 * Groups entries by normalized family, sorts by params.
 *
 * @param {Array} catalog - Array of catalog entries
 * @returns {Map<string, Array<{params: number, benchmarks: Object}>>} Sorted entries per family
 */
export function buildFamilyScalingModels(catalog) {
  if (!catalog || !Array.isArray(catalog)) return new Map();

  const familyMap = new Map();

  for (const entry of catalog) {
    if (!entry.family || !entry.params || !entry.benchmarks) continue;
    const norm = normalizeFamily(entry.family);
    if (!familyMap.has(norm)) familyMap.set(norm, []);
    familyMap.get(norm).push({
      params: entry.params,
      benchmarks: entry.benchmarks,
      category: entry.category,
      capabilities: entry.capabilities,
      contextWindow: entry.contextWindow,
    });
  }

  // Sort each family by params ascending
  for (const [, entries] of familyMap) {
    entries.sort((a, b) => a.params - b.params);
  }

  return familyMap;
}

/**
 * Estimate benchmarks for a model given its family and param count.
 * Uses log-space interpolation between nearest catalog entries.
 *
 * @param {string} family - Model family name (will be normalized)
 * @param {number} params - Parameter count in billions
 * @param {Map} scalingModels - From buildFamilyScalingModels()
 * @returns {{ benchmarks: Object|null, confidence: number }}
 */
export function estimateBenchmarks(family, params, scalingModels) {
  if (!family || !params || params <= 0 || !scalingModels) {
    return { benchmarks: null, confidence: 0 };
  }

  const norm = normalizeFamily(family);
  const entries = scalingModels.get(norm);

  if (!entries || entries.length === 0) {
    return { benchmarks: null, confidence: 0 };
  }

  // Family scaling guard: <2 entries → can't interpolate
  if (entries.length < 2) {
    return { benchmarks: null, confidence: 0.20 };
  }

  // Collect all known benchmark keys
  const benchKeys = new Set();
  for (const e of entries) {
    if (e.benchmarks) {
      for (const [k, v] of Object.entries(e.benchmarks)) {
        if (v != null) benchKeys.add(k);
      }
    }
  }

  const benchmarks = {};
  let estimatedCount = 0;

  for (const key of benchKeys) {
    // Get entries that have this benchmark
    const points = entries
      .filter(e => e.benchmarks?.[key] != null)
      .map(e => ({ params: e.params, value: e.benchmarks[key] }));

    if (points.length < 2) {
      benchmarks[key] = null;
      continue;
    }

    // Find bracketing points for interpolation
    let lower = null, upper = null;
    for (const pt of points) {
      if (pt.params <= params) lower = pt;
    }
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].params >= params) upper = points[i];
    }

    if (lower && upper && lower !== upper) {
      // Interpolation (or extrapolation if params outside range)
      benchmarks[key] = logInterpolate(params, lower.params, lower.value, upper.params, upper.value);
      estimatedCount++;
    } else if (lower && !upper) {
      // Extrapolation above largest
      const secondLargest = points[points.length - 2];
      const largest = points[points.length - 1];
      benchmarks[key] = logInterpolate(params, secondLargest.params, secondLargest.value, largest.params, largest.value);
      estimatedCount++;
    } else if (!lower && upper) {
      // Extrapolation below smallest
      const smallest = points[0];
      const secondSmallest = points[1];
      benchmarks[key] = logInterpolate(params, smallest.params, smallest.value, secondSmallest.params, secondSmallest.value);
      estimatedCount++;
    } else if (lower === upper) {
      // Exact match
      benchmarks[key] = lower.value;
      estimatedCount++;
    } else {
      benchmarks[key] = null;
    }
  }

  if (estimatedCount === 0) {
    return { benchmarks: null, confidence: 0.20 };
  }

  const knownParams = entries.map(e => e.params);
  const confidence = computeEstimationConfidence(params, knownParams);

  return { benchmarks, confidence };
}

/**
 * Compute estimation confidence based on position relative to known points.
 *
 * @param {number} params - Target param count
 * @param {number[]} knownParams - Known param counts in the family
 * @returns {number} Confidence 0-1
 */
export function computeEstimationConfidence(params, knownParams) {
  if (!params || !knownParams || knownParams.length < 2) return 0;

  const sorted = [...knownParams].sort((a, b) => a - b);
  const minKnown = sorted[0];
  const maxKnown = sorted[sorted.length - 1];

  // Interpolation: params is between min and max known
  if (params >= minKnown && params <= maxKnown) {
    // Find nearest bracketing points
    let lower = minKnown, upper = maxKnown;
    for (const p of sorted) {
      if (p <= params) lower = p;
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i] >= params) upper = sorted[i];
    }

    if (lower === upper) return 0.85; // Exact match

    // Distance ratio: how far between the two bracket points (0 = at lower, 1 = at upper)
    const range = upper - lower;
    const fromNearest = Math.min(params - lower, upper - params);
    const distRatio = range > 0 ? fromNearest / range : 0;

    // base=0.70, bonus up to 0.15 closer to known point
    return 0.70 + 0.15 * (1 - distRatio);
  }

  // Extrapolation: find nearest known point
  const nearest = params < minKnown ? minKnown : maxKnown;
  const distance = Math.abs(params - nearest);
  const ratio = distance / nearest;

  if (ratio < 0.5) return 0.60;  // Close extrapolation
  if (ratio < 1.0) return 0.45;  // Medium extrapolation
  return 0.30;                    // Far extrapolation
}

/**
 * Inherit non-benchmark fields from nearest same-family catalog entry.
 *
 * @param {string} family - Model family name (will be normalized)
 * @param {number} params - Parameter count
 * @param {Map} scalingModels - From buildFamilyScalingModels()
 * @returns {{ category: string|null, capabilities: string[]|null, contextWindow: number|null }}
 */
export function inheritFromNearest(family, params, scalingModels) {
  if (!family || !params || !scalingModels) {
    return { category: null, capabilities: null, contextWindow: null };
  }

  const norm = normalizeFamily(family);
  const entries = scalingModels.get(norm);

  if (!entries || entries.length === 0) {
    return { category: null, capabilities: null, contextWindow: null };
  }

  // Find nearest by param count
  let nearest = entries[0];
  let minDist = Math.abs(entries[0].params - params);

  for (let i = 1; i < entries.length; i++) {
    const dist = Math.abs(entries[i].params - params);
    if (dist < minDist) {
      minDist = dist;
      nearest = entries[i];
    }
  }

  return {
    category: nearest.category || null,
    capabilities: nearest.capabilities ? [...nearest.capabilities] : null,
    contextWindow: nearest.contextWindow ?? null,
  };
}

export default {
  normalizeFamily, estimateVram, logInterpolate,
  buildFamilyScalingModels, estimateBenchmarks,
  computeEstimationConfidence, inheritFromNearest,
};
