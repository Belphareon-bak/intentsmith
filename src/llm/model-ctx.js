// src/llm/model-ctx.js — Effective num_ctx registry
// ══════════════════════════════════════════════════════════════════════════════
//
// Single source of truth for the effective context window (num_ctx) per model.
//
// How it works:
//   - At server startup, initModelNumCtx() queries Ollama /api/show for the
//     model's declared context_length, then clamps it by available VRAM.
//   - VRAMManager calls setNumCtx() after computing VRAM-aware num_ctx.
//   - The gateway reads getNumCtx() instead of the hardcoded 8192 default.
//   - Context-compact reads getNumCtx() to set the correct compaction threshold.
//
// This ensures the compaction threshold always matches what the gateway
// actually sends to Ollama as num_ctx — no static mismatch.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  capModelContextWindow,
  getModelRuntimeProfile,
} from './model-runtime-profile.js';

// Per-model effective num_ctx cache
const _cache = new Map();

export const VramFitState = Object.freeze({
  FIT: 'fit',
  NONFIT: 'nonfit',
  UNKNOWN: 'unknown',
});

export const VramFitReason = Object.freeze({
  FIT: 'VRAM_FIT',
  CAPACITY_NONFIT: 'VRAM_CAPACITY_NONFIT',
  CURRENT_FREE_INSUFFICIENT: 'VRAM_CURRENT_FREE_INSUFFICIENT',
  OBSERVATION_UNAVAILABLE: 'VRAM_OBSERVATION_UNAVAILABLE',
  FOOTPRINT_UNKNOWN: 'VRAM_FOOTPRINT_UNKNOWN',
  INPUT_INVALID: 'VRAM_INPUT_INVALID',
});

async function observeDefaultVram() {
  const { getVramUsageAsync } = await import('../system/gpu-detector.js');
  return getVramUsageAsync();
}

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function validNumCtx(value) {
  return Number.isSafeInteger(value) && value >= 512;
}

function modelCacheKey(modelName) {
  return typeof modelName === 'string' && modelName.trim().length > 0
    ? modelName.trim().toLowerCase()
    : null;
}

function modelFootprint(modelName, modelWeightsMb, kvMbPer1k) {
  if (positiveFinite(modelWeightsMb) && positiveFinite(kvMbPer1k)) {
    return { modelWeightsMb, kvMbPer1k, source: 'explicit' };
  }
  // A parameter count in a tag is not a trusted footprint: quantization,
  // architecture, aliases and GPU placement can all change the real value.
  // Only metadata supplied by the runtime owner may support FIT/NONFIT.
  return null;
}

function fitResult({
  state,
  reason,
  model,
  numCtx,
  requiredMb = null,
  totalMb = null,
  freeMb = null,
  reserveMb,
  source = null,
}) {
  return Object.freeze({
    state,
    reason,
    model,
    numCtx,
    requiredMb,
    totalMb,
    freeMb,
    reserveMb,
    source,
  });
}

/**
 * Classify whether a model request can fit without contacting the provider.
 *
 * `nonfit` is intentionally reserved for physical impossibility after
 * reclaiming other models. Low current free VRAM with sufficient total
 * capacity is `unknown`, because Ollama may perform a legitimate model swap.
 */
export async function fitsVram(modelName, options = {}) {
  const {
    numCtx = getNumCtx(modelName),
    observeVram = observeDefaultVram,
    modelWeightsMb = null,
    kvMbPer1k = null,
    reserveMb = 1024,
  } = options;
  const model = typeof modelName === 'string' && modelName.trim().length > 0
    ? modelName.trim().toLowerCase()
    : null;

  const hasExplicitWeights = modelWeightsMb !== null && modelWeightsMb !== undefined;
  const hasExplicitKv = kvMbPer1k !== null && kvMbPer1k !== undefined;
  const explicitFootprintInvalid = hasExplicitWeights !== hasExplicitKv
    || (hasExplicitWeights && (
      !positiveFinite(modelWeightsMb)
      || !positiveFinite(kvMbPer1k)
    ));
  if (
    !model
    || !validNumCtx(numCtx)
    || !nonNegativeFinite(reserveMb)
    || explicitFootprintInvalid
  ) {
    return fitResult({
      state: VramFitState.UNKNOWN,
      reason: VramFitReason.INPUT_INVALID,
      model,
      numCtx: validNumCtx(numCtx) ? numCtx : null,
      reserveMb: nonNegativeFinite(reserveMb) ? reserveMb : null,
    });
  }

  const footprint = modelFootprint(model, modelWeightsMb, kvMbPer1k);
  if (!footprint) {
    return fitResult({
      state: VramFitState.UNKNOWN,
      reason: VramFitReason.FOOTPRINT_UNKNOWN,
      model,
      numCtx,
      reserveMb,
    });
  }
  const requiredMb = Math.ceil(
    footprint.modelWeightsMb + (footprint.kvMbPer1k * numCtx / 1024),
  );

  let observation;
  let totalMb;
  let freeMb;
  let observationSource;
  try {
    observation = typeof observeVram === 'function'
      ? await observeVram()
      : null;
    // Keep property access inside the guarded region. A proxy or a broken
    // observer must degrade to UNKNOWN, never reject past gateway ownership.
    totalMb = observation?.totalMb;
    freeMb = observation?.freeMb;
    observationSource = observation?.source;
  } catch {
    observation = null;
    totalMb = null;
    freeMb = null;
    observationSource = null;
  }
  const observationValid = positiveFinite(totalMb)
    && nonNegativeFinite(freeMb)
    && freeMb <= totalMb;
  if (!observationValid) {
    return fitResult({
      state: VramFitState.UNKNOWN,
      reason: VramFitReason.OBSERVATION_UNAVAILABLE,
      model,
      numCtx,
      requiredMb,
      reserveMb,
    });
  }

  const source = typeof observationSource === 'string'
    && observationSource.trim().length > 0
    ? observationSource.trim().slice(0, 64)
    : 'unspecified-observer';
  if (totalMb - reserveMb < requiredMb) {
    return fitResult({
      state: VramFitState.NONFIT,
      reason: VramFitReason.CAPACITY_NONFIT,
      model,
      numCtx,
      requiredMb,
      totalMb,
      freeMb,
      reserveMb,
      source,
    });
  }
  if (freeMb - reserveMb >= requiredMb) {
    return fitResult({
      state: VramFitState.FIT,
      reason: VramFitReason.FIT,
      model,
      numCtx,
      requiredMb,
      totalMb,
      freeMb,
      reserveMb,
      source,
    });
  }
  return fitResult({
    state: VramFitState.UNKNOWN,
    reason: VramFitReason.CURRENT_FREE_INSUFFICIENT,
    model,
    numCtx,
    requiredMb,
    totalMb,
    freeMb,
    reserveMb,
    source,
  });
}

/**
 * Set the effective num_ctx for a model.
 * Called by VRAMManager after computing VRAM-aware context, or by initModelNumCtx().
 */
export function setNumCtx(modelName, numCtx) {
  const key = modelCacheKey(modelName);
  const effective = capModelContextWindow(modelName, numCtx);
  if (key && effective !== null) _cache.set(key, effective);
}

/**
 * Get the effective num_ctx for a model.
 * Returns the cached VRAM-optimized value, the committed profile ceiling, or
 * the caller fallback (default 8192), in that order.
 */
export function getNumCtx(modelName, fallback = 8192) {
  const key = modelCacheKey(modelName);
  if (!key) return fallback;
  const cached = _cache.get(key);
  if (validNumCtx(cached)) return cached;
  return getModelRuntimeProfile(modelName)?.contextWindowTokens ?? fallback;
}

/**
 * Resolve a request-level context without allowing it to exceed the effective
 * cache/profile ceiling. Models without either ceiling preserve a valid
 * explicit request and do not inherit the reference model profile.
 */
export function resolveNumCtx(modelName, requestedNumCtx, fallback = 8192) {
  const key = modelCacheKey(modelName);
  const cached = key ? _cache.get(key) : null;
  const profileLimit = getModelRuntimeProfile(modelName)?.contextWindowTokens ?? null;
  const ceiling = validNumCtx(cached) ? cached : profileLimit;
  if (validNumCtx(requestedNumCtx) && requestedNumCtx <= 262144) {
    return validNumCtx(ceiling) ? Math.min(requestedNumCtx, ceiling) : requestedNumCtx;
  }
  if (validNumCtx(ceiling)) return ceiling;
  return fallback;
}

/** Clear cache (e.g. after model change). */
export function clearNumCtxCache() {
  _cache.clear();
}

/**
 * Initialize effective num_ctx for a model by querying Ollama /api/show
 * and clamping by available VRAM.
 *
 * This is called at server startup for the CHAT model (and any other roles
 * that benefit from VRAM-aware context sizing).
 *
 * Flow:
 *   1. Ollama /api/show → declared context_length (the model's maximum)
 *   2. VRAM query → how much KV cache fits in available VRAM
 *   3. Result = min(declared, vram_limit), clamped [2048, 32768]
 *
 * @param {string} modelName
 * @param {string} [ollamaUrl]
 * @param {Object} [options]
 * @param {Function} [options.observeVram] injectable read-only VRAM observer
 * @returns {Promise<number>} computed num_ctx (also stored in cache)
 */
export async function initModelNumCtx(
  modelName,
  ollamaUrl = 'http://127.0.0.1:11434',
  { observeVram = observeDefaultVram } = {},
) {
  if (!modelName) return 8192;

  let declaredCtx = null;
  let vramNumCtx = null;

  // ── Step 1: Ollama /api/show → declared context_length ──────────────────
  try {
    const resp = await fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json();
      // model_info may have llama.context_length or similar keys
      const mi = data?.model_info || {};
      for (const [k, v] of Object.entries(mi)) {
        if (/context_length|num_ctx/i.test(k)) {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) { declaredCtx = Math.round(n); break; }
        }
      }
      // Fallback: check model parameters text
      if (!declaredCtx) {
        const p = String(data?.parameters || '').match(/num_ctx\s+(\d+)/i);
        if (p) declaredCtx = parseInt(p[1], 10);
      }
    }
  } catch (err) {
    logger.debug('ModelCtx', `Could not fetch /api/show for ${modelName}: ${err.message}`);
  }

  // ── Step 2: VRAM → how much KV cache fits ───────────────────────────────
  try {
    const vram = await observeVram();
    if (vram && vram.totalMb > 0 && vram.usedMb >= 0) {
      // Rough param estimate from model name (e.g. "qwen3.5:27b" → 27)
      const paramMatch = String(modelName).match(/[:\-_](\d+(?:\.\d+)?)b/i);
      const params = paramMatch ? parseFloat(paramMatch[1]) : null;
      if (!positiveFinite(params)) throw new Error('model footprint unknown');
      const weightsMb = Math.round(620 * params + 420);      // Q4_K_M formula (Q4_K_M)
      const kvPer1k = Math.round(params * 9);                // ~9 MB/1K/B (GQA models)
      const reserved = 1024;                                 // OS + compositor overhead

      // If model is already loaded in VRAM, usedMb includes weights — don't double-count.
      // Use the larger of: (total - used - reserved) vs (total - weights - reserved - usedWithoutModel).
      const modelAlreadyLoaded = vram.usedMb > (weightsMb * 0.7); // >70% of weights in use
      const availableForKV = modelAlreadyLoaded
        ? Math.max(0, vram.totalMb - vram.usedMb - reserved)          // model loaded: free space only
        : Math.max(0, vram.totalMb - vram.usedMb - reserved - weightsMb); // model not loaded: subtract weights too
      if (availableForKV >= kvPer1k) {
        let v = Math.floor(availableForKV / kvPer1k) * 1024;
        vramNumCtx = Math.max(2048, Math.min(32768, v));
      }
    }
  } catch (err) {
    logger.debug('ModelCtx', `VRAM query failed for ${modelName}: ${err.message}`);
  }

  // ── Step 3: Compute final num_ctx ────────────────────────────────────────
  // Priority: VRAM-computed > safe default (8192) > declared context
  // If VRAM is unavailable, use 8192 — not the declared context_length.
  // Declared context (e.g. 262144 for qwen3.5) is a model capability ceiling,
  // not a safe GPU budget. Without VRAM data, 8192 is the conservative default.
  let numCtx = vramNumCtx ?? 8192;
  // Never exceed declared context_length (model can't handle more than that)
  if (declaredCtx) numCtx = Math.min(numCtx, declaredCtx);
  numCtx = Math.max(2048, numCtx);

  setNumCtx(modelName, numCtx);
  const effectiveNumCtx = getNumCtx(modelName, numCtx);

  logger.info('ModelCtx', `Initialized ${modelName}: num_ctx=${effectiveNumCtx}`, {
    declaredCtx, vramNumCtx, computed: numCtx, final: effectiveNumCtx,
  });

  return effectiveNumCtx;
}
