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

// Per-model effective num_ctx cache
const _cache = new Map();

/**
 * Set the effective num_ctx for a model.
 * Called by VRAMManager after computing VRAM-aware context, or by initModelNumCtx().
 */
export function setNumCtx(modelName, numCtx) {
  if (modelName && Number.isFinite(numCtx) && numCtx >= 512) {
    _cache.set(String(modelName).toLowerCase(), numCtx);
  }
}

/**
 * Get the effective num_ctx for a model.
 * Returns the cached VRAM-optimized value, or fallback (default 8192).
 */
export function getNumCtx(modelName, fallback = 8192) {
  if (!modelName) return fallback;
  return _cache.get(String(modelName).toLowerCase()) ?? fallback;
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
 * @returns {Promise<number>} computed num_ctx (also stored in cache)
 */
export async function initModelNumCtx(modelName, ollamaUrl = 'http://127.0.0.1:11434') {
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
    const { getVramUsageAsync } = await import('../system/gpu-detector.js');
    const vram = await getVramUsageAsync();
    if (vram && vram.totalMb > 0 && vram.usedMb >= 0) {
      // Rough param estimate from model name (e.g. "qwen3.5:27b" → 27)
      const paramMatch = String(modelName).match(/[:\-_](\d+(?:\.\d+)?)b/i);
      const params = paramMatch ? parseFloat(paramMatch[1]) : 27;
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

  logger.info('ModelCtx', `Initialized ${modelName}: num_ctx=${numCtx}`, {
    declaredCtx, vramNumCtx, final: numCtx,
  });

  return numCtx;
}
