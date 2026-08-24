// v131: VRAM Manager — GPU Job Lock + VRAM-aware Ollama coordination
// ══════════════════════════════════════════════════════════════════════════════

import { broadcast } from '../ws-bridge/ws-server.js';
import { logger } from '../core/logger.js';
import { setNumCtx } from '../llm/model-ctx.js';
import {
  MODEL_ACTIVITY_OWNER,
  modelUseAuthority as defaultModelUseAuthority,
} from '../upgrade/model-use-authority.js';
import { canonicalModelName } from '../upgrade/model-identity.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Estimate model weights VRAM (MB) from parameter count and quantization. */
function _estimateWeightsMb(params) {
  if (!params || params <= 0) return 16200;  // default for ~27B model
  return Math.round(620 * params + 420);
}

/**
 * Estimate KV cache cost (MB per 1K context tokens) for a model.
 * Based on architecture: kvPerToken ≈ 2 * layers * kvHeads * headDim * 2 (fp16) / 1M.
 * Conservative default: 250 MB/1K (safe for most 20-35B models).
 * @param {Object} [modelMeta] - optional model metadata with kv_per_1k
 * @param {number} [params] - param count in billions (fallback estimate)
 * @returns {number} MB per 1K context tokens
 */
function _kvMbPer1k(modelMeta, params) {
  // Explicit value from model metadata takes priority
  if (modelMeta?.kv_per_1k > 0) return modelMeta.kv_per_1k;
  // Conservative estimate: ~9 MB/1K/B for most GQA models
  if (params > 0) return Math.round(params * 9);
  return 250;  // safe default
}

// ── VRAMManager ────────────────────────────────────────────────────────────

export class VRAMManager {
  constructor({
    ollamaUrl,
    chatModel,
    comfyuiUrl,
    gpuTotalVramMb,
    defaultNumCtx,
    modelUseAuthority,
  } = {}) {
    this._ollamaUrl = ollamaUrl || 'http://127.0.0.1:11434';
    this._chatModel = chatModel || '';
    this._comfyuiUrl = comfyuiUrl || null;
    this._gpuTotalVramMb = gpuTotalVramMb || 0;
    this._busy = false;
    this._queue = [];
    this._ollamaUnloaded = false;
    this._targetNumCtx = defaultNumCtx || 4096;  // safe default (not 8192 — review fix #6)
    this._lastReloadTime = 0;  // cooldown tracking (review fix #4)
    this._modelMeta = null;    // optional: { params, kv_per_1k } for active model
    // Decision 023/A: narrow shared artifact authority. This protects the model
    // artifact from a concurrent delete; it is NOT global GPU residency.
    this._modelUseAuthority = modelUseAuthority || defaultModelUseAuthority;
  }

  // ── Decision 023/A: artifact-use leases ───────────────────────────────────

  /**
   * Acquire one shared VRAM_ARTIFACT_USE lease per canonical identity.
   * All leases are taken before the first provider effect; on conflict every
   * already-acquired lease is released and the typed error propagates, so the
   * caller produces zero provider effects.
   *
   * @param {string[]} modelNames
   * @returns {{ release: () => void, count: number }}
   */
  #acquireArtifactLeases(modelNames) {
    const seen = new Set();
    const wanted = [];
    for (const name of modelNames) {
      const canonicalName = canonicalModelName(name);
      if (!canonicalName || seen.has(canonicalName)) continue;
      seen.add(canonicalName);
      wanted.push(name);
    }

    const leases = [];
    const releaseAll = () => {
      for (const lease of leases.splice(0)) {
        try { lease.release(); } catch (_) {}
      }
    };

    try {
      for (const name of wanted) {
        leases.push(this._modelUseAuthority.acquireShared({
          modelName: name,
          owner: MODEL_ACTIVITY_OWNER.VRAM_ARTIFACT_USE,
        }));
      }
    } catch (error) {
      releaseAll();
      throw error;
    }

    return { release: releaseAll, count: leases.length };
  }

  /** Set model metadata for better KV cache estimation. */
  setModelMeta(meta) {
    this._modelMeta = meta;
  }

  // ── Core: FIFO serialized GPU access (capacity 1) ──────────────────────────

  async acquire(task) {
    return new Promise((resolve, reject) => {
      this._queue.push({ task, resolve, reject });
      this._broadcastState();
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this._busy || this._queue.length === 0) return;

    this._busy = true;
    this._broadcastState();

    const { task, resolve, reject } = this._queue.shift();

    // Decision 023/A: the chat identity is held from task dequeue through the
    // finally below, so a delete during a running media task fails typed and
    // immediately instead of removing the artifact mid-work.
    let leases = null;
    try {
      if (this._chatModel) leases = this.#acquireArtifactLeases([this._chatModel]);
    } catch (err) {
      this._busy = false;
      reject(err);
      this._broadcastState();
      this._processQueue();
      return;
    }

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      if (leases) leases.release();
      this._busy = false;
      this._broadcastState();
      this._processQueue();
    }
  }

  // ── VRAM-aware num_ctx computation (v131) ─────────────────────────────────

  /**
   * Compute the max safe num_ctx given current VRAM state.
   *
   * Formula:
   *   availableForKV = totalMb − usedMb − reservedMb − modelWeightsMb
   *   maxCtx = floor(availableForKV / kvMbPer1k) × 1024
   *   clamp [2048, gatewayLimit]
   *
   * @param {Object} [opts]
   * @param {number} [opts.modelParams]    - param count (billions)
   * @param {number} [opts.modelWeightsMb] - known weights size (from catalog)
   * @param {number} [opts.reservedMb=1024] - OS/compositor overhead
   * @param {number} [opts.maxCtx=8192]    - gateway limit (no point loading bigger)
   * @returns {Promise<number>} Safe num_ctx (multiple of 1024)
   */
  async computeNumCtx(opts = {}) {
    const { getVramUsageAsync } = await import('../system/gpu-detector.js');

    const vram = await getVramUsageAsync({ comfyuiUrl: this._comfyuiUrl });
    if (!vram) {
      logger.debug('VRAMManager', 'Cannot query VRAM — using fallback num_ctx 4096');
      this._targetNumCtx = 4096;
      if (this._chatModel) setNumCtx(this._chatModel, 4096);
      return 4096;
    }

    const gatewayLimit = opts.maxCtx ?? 8192;
    const reservedMb = opts.reservedMb ?? 1024;
    const modelWeightsMb = opts.modelWeightsMb || _estimateWeightsMb(opts.modelParams);
    const kvPer1k = _kvMbPer1k(this._modelMeta, opts.modelParams);

    // Available VRAM for KV cache (clamped ≥ 0, review fix #2)
    const availableForKV = Math.max(0, vram.totalMb - vram.usedMb - reservedMb - modelWeightsMb);

    if (availableForKV < kvPer1k) {
      logger.warn('VRAMManager', `Tight VRAM: total=${vram.totalMb}, used=${vram.usedMb}, weights=${modelWeightsMb} → num_ctx=2048`);
      this._targetNumCtx = 2048;
      if (this._chatModel) setNumCtx(this._chatModel, 2048);
      return 2048;
    }

    let maxCtx = Math.floor(availableForKV / kvPer1k) * 1024;
    maxCtx = Math.floor(maxCtx / 1024) * 1024;
    maxCtx = Math.max(2048, Math.min(gatewayLimit, maxCtx));

    logger.info('VRAMManager', `computeNumCtx=${maxCtx} (total=${vram.totalMb}, used=${vram.usedMb}, weights=${modelWeightsMb}, kvPer1k=${kvPer1k})`);
    this._targetNumCtx = maxCtx;
    if (this._chatModel) setNumCtx(this._chatModel, maxCtx);
    return maxCtx;
  }

  /** @returns {number} Last computed target num_ctx. */
  getTargetNumCtx() {
    return this._targetNumCtx;
  }

  // ── VRAM polling (review fix #3) ─────────────────────────────────────────

  /**
   * Wait until VRAM usage drops below a threshold (or timeout).
   * Used after freeVram() instead of blind sleep.
   *
   * @param {number} targetUsedMb - target max used VRAM (MB)
   * @param {Object} [opts]
   * @param {number} [opts.timeoutMs=10000] - max wait time
   * @param {number} [opts.pollMs=500]      - poll interval
   * @returns {Promise<boolean>} true if target reached, false if timed out
   */
  async waitForVramDrop(targetUsedMb, opts = {}) {
    const { getVramUsageAsync } = await import('../system/gpu-detector.js');
    const { _clearVramCache } = await import('../system/gpu-detector.js');
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const pollMs = opts.pollMs ?? 500;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      _clearVramCache();  // force fresh read
      const vram = await getVramUsageAsync({ comfyuiUrl: this._comfyuiUrl });
      if (!vram) return false;  // can't monitor — give up
      if (vram.usedMb <= targetUsedMb) {
        logger.debug('VRAMManager', `VRAM dropped to ${vram.usedMb} MB (target: ${targetUsedMb})`);
        return true;
      }
      await new Promise(r => setTimeout(r, pollMs));
    }

    logger.warn('VRAMManager', `VRAM did not drop to ${targetUsedMb} MB within ${timeoutMs}ms`);
    return false;
  }

  // ── Ollama VRAM management ─────────────────────────────────────────────────

  /**
   * Unload ALL loaded Ollama models (not just chatModel).
   * Queries /api/ps for full list, falls back to chatModel only on error.
   * Review fix #5: skip if VRAMManager is in generating state (busy).
   */
  async unloadOllama() {
    // Discovery touches no artifact, so it stays outside the reservation.
    let modelsToUnload = [this._chatModel].filter(Boolean);
    try {
      const psResp = await fetch(`${this._ollamaUrl}/api/ps`, {
        signal: AbortSignal.timeout(5000),
      });
      if (psResp.ok) {
        const psData = await psResp.json();
        const loaded = (psData.models || []).map(m => m.name).filter(Boolean);
        if (loaded.length > 0) modelsToUnload = loaded;
      }
    } catch (_) {
      // Fallback to chatModel only
    }

    // Decision 023/A: reserve every discovered identity before the first unload
    // effect and hold it through all response bodies. A conflict deliberately
    // escapes this method — swallowing it here would let a delete race the
    // unload, which is the exact edge this checkpoint closes.
    const leases = this.#acquireArtifactLeases(modelsToUnload);
    try {
      for (const model of modelsToUnload) {
        try {
          const resp = await fetch(`${this._ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: '0' }),
            signal: AbortSignal.timeout(10_000),
          });
          try { await resp.text(); } catch (_) {}
          logger.debug('VRAMManager', `Ollama model ${model} unloaded`);
        } catch (err) {
          logger.warn('VRAMManager', `Failed to unload ${model}: ${err.message}`);
        }
      }
      this._ollamaUnloaded = true;
    } finally {
      leases.release();
    }
  }

  /**
   * Reload Ollama model with VRAM-aware num_ctx.
   * Review fix #4: enforces 30s cooldown between reloads to prevent loops.
   */
  async reloadOllama() {
    if (!this._chatModel) {
      this._ollamaUnloaded = false;
      return;
    }

    // Cooldown guard (review fix #4)
    const now = Date.now();
    if (now - this._lastReloadTime < 30_000) {
      logger.debug('VRAMManager', 'Reload cooldown active — skipping');
      this._ollamaUnloaded = false;
      return;
    }

    // Decision 023/A: the direct reload holds the chat identity from before the
    // provider call through its body. The conflict is not swallowed below.
    const leases = this.#acquireArtifactLeases([this._chatModel]);
    try {
      // Compute safe num_ctx BEFORE reload (Ollama is unloaded → VRAM query sees what's free)
      const numCtx = await this.computeNumCtx();

      const resp = await fetch(`${this._ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._chatModel,
          prompt: ' ',
          stream: false,
          options: {
            num_ctx: numCtx,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      try { await resp.text(); } catch (_) {}

      this._ollamaUnloaded = false;
      this._lastReloadTime = Date.now();
      logger.info('VRAMManager', `Ollama ${this._chatModel} reloaded with num_ctx=${numCtx}`);
    } catch (err) {
      logger.warn('VRAMManager', `Ollama reload failed: ${err.message}`);
      this._ollamaUnloaded = false;
    } finally {
      leases.release();
    }
  }

  // ── Startup audit (v131) ─────────────────────────────────────────────────

  /**
   * Startup audit: detect if loaded Ollama models have excessive context or
   * CPU spillover. If so, unload and reload with correct num_ctx.
   *
   * @returns {Promise<{ action: string, details: string }>}
   */
  async auditOllamaModels() {
    try {
      const psResp = await fetch(`${this._ollamaUrl}/api/ps`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!psResp.ok) {
        return { action: 'skip', details: `Ollama /api/ps returned ${psResp.status}` };
      }

      const psData = await psResp.json();
      const loadedModels = psData.models || [];

      if (loadedModels.length === 0) {
        return { action: 'none', details: 'No models loaded' };
      }

      // Find our chat model (or any model matching the family)
      const chatLoaded = loadedModels.find(m =>
        m.name === this._chatModel || m.name?.startsWith(this._chatModel?.split(':')[0])
      );

      if (!chatLoaded) {
        return { action: 'none', details: `Chat model ${this._chatModel} not loaded` };
      }

      // Detect problems:
      // 1. CPU spillover: size_vram < size * 0.95 (>5% on CPU)
      const sizeBytes = chatLoaded.size || 0;
      const sizeVramBytes = chatLoaded.size_vram || 0;
      const cpuSpillover = sizeBytes > 0 && sizeVramBytes < sizeBytes * 0.95;

      // 2. Excessive context: context_length > gateway max (8192)
      const contextLength = chatLoaded.context_length || 0;
      const excessiveCtx = contextLength > 8192;

      if (!cpuSpillover && !excessiveCtx) {
        return {
          action: 'ok',
          details: `${chatLoaded.name}: ctx=${contextLength}, vram=${Math.round(sizeVramBytes / 1e9)}GB/${Math.round(sizeBytes / 1e9)}GB — OK`,
        };
      }

      // Problem detected — unload and reload with correct num_ctx
      const reasons = [];
      if (cpuSpillover) reasons.push(`CPU spillover (${Math.round((1 - sizeVramBytes / sizeBytes) * 100)}%)`);
      if (excessiveCtx) reasons.push(`excessive ctx (${contextLength})`);

      logger.warn('VRAMManager', `Startup audit: ${reasons.join(', ')} — reloading ${this._chatModel}`);

      await this.unloadOllama();
      // Wait for VRAM to settle before reload
      await this.waitForVramDrop(
        Math.round((this._gpuTotalVramMb || 24576) * 0.15),  // expect <15% usage after unload
        { timeoutMs: 8000 }
      );
      await this.reloadOllama();

      return {
        action: 'reloaded',
        details: `${reasons.join(', ')} → reloaded with num_ctx=${this._targetNumCtx}`,
      };
    } catch (err) {
      logger.warn('VRAMManager', `Startup audit failed (non-fatal): ${err.message}`);
      return { action: 'error', details: err.message };
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  getState() {
    return {
      busy: this._busy,
      queueLength: this._queue.length,
      ollamaUnloaded: this._ollamaUnloaded,
      targetNumCtx: this._targetNumCtx,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _broadcastState() {
    try {
      broadcast('control', {
        action: 'vram_state',
        busy: this._busy,
        queueLength: this._queue.length,
        targetNumCtx: this._targetNumCtx,
      });
    } catch (_) {
      // WS may not be initialized yet
    }
  }
}

// Export helpers for testing
export { _estimateWeightsMb, _kvMbPer1k };
