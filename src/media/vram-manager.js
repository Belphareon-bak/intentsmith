// v131: VRAM Manager — GPU Job Lock + VRAM-aware Ollama coordination
// ══════════════════════════════════════════════════════════════════════════════

import { broadcast } from '../ws-bridge/ws-server.js';
import { logger } from '../core/logger.js';
import { getNumCtx, setNumCtx } from '../llm/model-ctx.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Estimate model weights VRAM (MB) from param count. From benchmark-estimator.js formula. */
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
    artifactUsePort = null,
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
    this._artifactUsePort = artifactUsePort;
    if (this._chatModel && typeof this._artifactUsePort?.acquire !== 'function') {
      const error = new Error('VRAM artifact use authority is required for a configured chat model');
      error.code = 'MODEL_USE_AUTHORITY_REQUIRED';
      throw error;
    }
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
    let taskArtifactLease = null;
    let result;
    let taskError = null;
    try {
      taskArtifactLease = this._acquireArtifactUse([this._chatModel].filter(Boolean));
      result = await task();
    } catch (err) {
      taskError = err;
    } finally {
      try {
        taskArtifactLease?.release();
      } catch (err) {
        taskError ||= err;
      }
      this._busy = false;
      this._broadcastState();
      this._processQueue();
    }
    if (taskError) reject(taskError);
    else resolve(result);
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
      return this._setTargetNumCtx(4096);
    }

    const gatewayLimit = opts.maxCtx ?? 8192;
    const reservedMb = opts.reservedMb ?? 1024;
    const modelWeightsMb = opts.modelWeightsMb || _estimateWeightsMb(opts.modelParams);
    const kvPer1k = _kvMbPer1k(this._modelMeta, opts.modelParams);

    // Available VRAM for KV cache (clamped ≥ 0, review fix #2)
    const availableForKV = Math.max(0, vram.totalMb - vram.usedMb - reservedMb - modelWeightsMb);

    if (availableForKV < kvPer1k) {
      logger.warn('VRAMManager', `Tight VRAM: total=${vram.totalMb}, used=${vram.usedMb}, weights=${modelWeightsMb} → num_ctx=2048`);
      return this._setTargetNumCtx(2048);
    }

    let maxCtx = Math.floor(availableForKV / kvPer1k) * 1024;
    maxCtx = Math.floor(maxCtx / 1024) * 1024;
    maxCtx = Math.max(2048, Math.min(gatewayLimit, maxCtx));

    const effectiveNumCtx = this._setTargetNumCtx(maxCtx);
    logger.info('VRAMManager', `computeNumCtx=${effectiveNumCtx} (computed=${maxCtx}, total=${vram.totalMb}, used=${vram.usedMb}, weights=${modelWeightsMb}, kvPer1k=${kvPer1k})`);
    return effectiveNumCtx;
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
    // Discover all loaded models via /api/ps. This read determines the complete
    // artifact set; no unload effect may start until the whole set is reserved.
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

    const artifactLease = this._acquireArtifactUse(modelsToUnload);
    try {
      for (const model of artifactLease?.modelNames || []) {
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
      artifactLease?.release();
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

    const artifactLease = this._acquireArtifactUse([this._chatModel]);
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
      artifactLease?.release();
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
      if (this._isArtifactUseAuthorityError(err)) throw err;
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

  _acquireArtifactUse(modelNames) {
    if (modelNames.length === 0) return null;
    if (typeof this._artifactUsePort?.acquire !== 'function') {
      const error = new Error('VRAM artifact use authority is unavailable');
      error.code = 'MODEL_USE_AUTHORITY_REQUIRED';
      throw error;
    }
    return this._artifactUsePort.acquire(modelNames);
  }

  _setTargetNumCtx(numCtx) {
    if (!this._chatModel) {
      this._targetNumCtx = numCtx;
      return numCtx;
    }
    setNumCtx(this._chatModel, numCtx);
    this._targetNumCtx = getNumCtx(this._chatModel, numCtx);
    return this._targetNumCtx;
  }

  _isArtifactUseAuthorityError(error) {
    return typeof error?.code === 'string' && error.code.startsWith('MODEL_USE_');
  }

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
