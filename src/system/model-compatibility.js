// Model Compatibility Engine — GPU-aware model recommendations
// ══════════════════════════════════════════════════════════════════════════════
//
// Hardcoded reference map (NOT LLM output).
// Recommends models based on available VRAM.
// Estimates real memory usage: model_size * 1.2 (KV cache overhead).
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Model recommendation tiers.
 * Ordered from smallest to largest.
 * real_vram_mb = approximate VRAM needed including KV cache overhead.
 */
const MODEL_TIERS = [
  { model: 'qwen3.5:4b',    params: '4B',  quant: 'Q4_K_M', size_gb: 2.6,  real_vram_mb: 3100,  min_vram_mb: 0,     ctx_default: 8192  },
  { model: 'qwen3.5:9b',    params: '9B',  quant: 'Q4_K_M', size_gb: 5.6,  real_vram_mb: 6700,  min_vram_mb: 6000,  ctx_default: 16384 },
  { model: 'qwen3.5:27b',   params: '27B', quant: 'Q4_K_M', size_gb: 16.0, real_vram_mb: 19200, min_vram_mb: 18000, ctx_default: 32768 },
  { model: 'qwen3.5:35b',   params: '35B', quant: 'Q4_K_M', size_gb: 21.0, real_vram_mb: 25200, min_vram_mb: 22000, ctx_default: 32768 },
  { model: 'llama3.1:70b',  params: '70B', quant: 'Q4_K_M', size_gb: 40.0, real_vram_mb: 48000, min_vram_mb: 46000, ctx_default: 8192  },
];

/**
 * VRAM → recommended model lookup table (for quick reference).
 */
const VRAM_RECOMMENDATIONS = [
  { vram_label: 'CPU-only', max_vram: 0,     recommended: 'qwen3.5:4b (Q4_K_M)',  note: 'Very slow, CPU inference only' },
  { vram_label: '4 GB',     max_vram: 4096,  recommended: 'qwen3.5:4b (Q4_K_M)',  note: 'Tight fit, short context' },
  { vram_label: '8 GB',     max_vram: 8192,  recommended: 'qwen3.5:9b (Q4_K_M)',  note: 'Good for basic tasks' },
  { vram_label: '12 GB',    max_vram: 12288, recommended: 'qwen3.5:9b (Q4_K_M)',  note: 'Good balance' },
  { vram_label: '16 GB',    max_vram: 16384, recommended: 'qwen3.5:9b (Q4_K_M)',  note: 'Comfortable for 9B' },
  { vram_label: '24 GB',    max_vram: 24576, recommended: 'qwen3.5:27b (Q4_K_M)', note: 'Best for C3 (current default)' },
  { vram_label: '48 GB',    max_vram: 49152, recommended: 'llama3.1:70b (Q4_K_M)', note: 'Maximum capability' },
];

/**
 * Get recommended model for given VRAM.
 *
 * @param {number} vramMb - Available VRAM in MB (0 for CPU-only)
 * @param {boolean} isIGPU - Is integrated GPU (shared VRAM)
 * @returns {{ model: string, params: string, quant: string, ctx_default: number, note: string, warnings: string[] }}
 */
export function recommend(vramMb, isIGPU = false) {
  const warnings = [];

  // Adjust for iGPU (shared VRAM is ~60% usable for ML)
  let effectiveVram = vramMb;
  if (isIGPU && vramMb > 0) {
    effectiveVram = Math.round(vramMb * 0.6);
    warnings.push(`Shared VRAM (iGPU): reported ${vramMb} MB, effective ~${effectiveVram} MB`);
  }

  // CPU-only
  if (effectiveVram === 0) {
    const tier = MODEL_TIERS[0];
    return {
      model: tier.model,
      params: tier.params,
      quant: tier.quant,
      ctx_default: tier.ctx_default,
      note: 'CPU-only: inference will be slow. Consider installing a GPU.',
      warnings,
    };
  }

  // Find best fitting model
  let bestTier = MODEL_TIERS[0]; // fallback to smallest
  for (const tier of MODEL_TIERS) {
    if (tier.real_vram_mb <= effectiveVram) {
      bestTier = tier;
    }
  }

  // Find matching recommendation note
  const rec = VRAM_RECOMMENDATIONS.find(r => effectiveVram <= r.max_vram)
    || VRAM_RECOMMENDATIONS[VRAM_RECOMMENDATIONS.length - 1];

  return {
    model: bestTier.model,
    params: bestTier.params,
    quant: bestTier.quant,
    ctx_default: bestTier.ctx_default,
    note: rec.note,
    warnings,
  };
}

/**
 * Check if a specific model is compatible with available VRAM.
 *
 * @param {string} modelName - Model name (e.g., 'qwen3.5:27b')
 * @param {number} vramMb - Available VRAM in MB
 * @param {boolean} isIGPU
 * @returns {{ compatible: boolean, reason: string|null, estimated_vram_mb: number }}
 */
export function checkCompatibility(modelName, vramMb, isIGPU = false) {
  let effectiveVram = vramMb;
  if (isIGPU && vramMb > 0) {
    effectiveVram = Math.round(vramMb * 0.6);
  }

  // Find model in tiers
  const tier = MODEL_TIERS.find(t => modelName.includes(t.params.toLowerCase()));
  if (!tier) {
    // Unknown model — can't check
    return { compatible: true, reason: null, estimated_vram_mb: 0 };
  }

  if (effectiveVram === 0) {
    return {
      compatible: true, // CPU can run anything, just slowly
      reason: `CPU-only mode: ${tier.params} will be very slow without GPU acceleration.`,
      estimated_vram_mb: tier.real_vram_mb,
    };
  }

  if (tier.real_vram_mb > effectiveVram) {
    const overflowPct = Math.round(((tier.real_vram_mb - effectiveVram) / effectiveVram) * 100);
    return {
      compatible: false,
      reason: `${tier.params} model needs ~${tier.real_vram_mb} MB VRAM but only ${effectiveVram} MB available (${overflowPct}% over).`,
      estimated_vram_mb: tier.real_vram_mb,
    };
  }

  const headroom = effectiveVram - tier.real_vram_mb;
  const headroomPct = Math.round((headroom / effectiveVram) * 100);
  return {
    compatible: true,
    reason: headroomPct < 10
      ? `Tight fit: only ${headroom} MB headroom (${headroomPct}%). Context length may be limited.`
      : null,
    estimated_vram_mb: tier.real_vram_mb,
  };
}

/**
 * Get the full model tiers table (for UI display).
 * @returns {Array}
 */
export function getModelTiers() {
  return MODEL_TIERS.map(t => ({ ...t }));
}

/**
 * Get the VRAM recommendations table (for UI display).
 * @returns {Array}
 */
export function getVRAMRecommendations() {
  return VRAM_RECOMMENDATIONS.map(r => ({ ...r }));
}

/**
 * Estimate real memory usage for a model.
 * Formula: model_size_gb * 1.2 (KV cache overhead)
 *
 * @param {number} modelSizeGb
 * @returns {number} Estimated VRAM in MB
 */
export function estimateMemoryUsage(modelSizeGb) {
  return Math.round(modelSizeGb * 1.2 * 1024);
}

export default {
  recommend,
  checkCompatibility,
  getModelTiers,
  getVRAMRecommendations,
  estimateMemoryUsage,
};
