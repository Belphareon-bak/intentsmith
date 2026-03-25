// v130: ComfyUI Connector — health, submit, poll, fetch, WS progress
// ══════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { logger } from '../core/logger.js';

export class ComfyUIConnector {
  constructor(options = {}) {
    this._baseUrl = options.baseUrl || 'http://127.0.0.1:8188';
    this._timeout = options.timeout || 300_000;  // 5 min
    this._retries = options.retries || 2;
    this._maxOutputSizeMB = options.maxOutputSizeMB || 100;
    this._clientId = randomUUID();
    this._ws = null;
    this._wsCallbacks = new Map();  // promptId → onProgress callback
  }

  // ── Health check ────────────────────────────────────────────────────────────

  async isAvailable() {
    try {
      const resp = await fetch(`${this._baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { available: false, error: `HTTP ${resp.status}` };
      const data = await resp.json();
      const gpu = data.devices?.[0] || {};
      const queue = await this.getQueue();
      return {
        available: true,
        gpuInfo: {
          name: gpu.name || 'unknown',
          vramTotal: gpu.vram_total || 0,
          vramFree: gpu.vram_free || 0,
        },
        queueSize: (queue.running || 0) + (queue.pending || 0),
      };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  // ── Queue info ──────────────────────────────────────────────────────────────

  async getQueue() {
    try {
      const resp = await fetch(`${this._baseUrl}/queue`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { running: 0, pending: 0 };
      const data = await resp.json();
      return {
        running: data.queue_running?.length || 0,
        pending: data.queue_pending?.length || 0,
      };
    } catch {
      return { running: 0, pending: 0 };
    }
  }

  // ── Free VRAM (v131) ───────────────────────────────────────────────────────

  /**
   * Ask ComfyUI to unload models and free VRAM.
   * Uses the /free endpoint (ComfyUI 0.2.0+). Non-fatal on failure.
   */
  async freeVram() {
    try {
      const resp = await fetch(`${this._baseUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(10_000),
      });
      try { await resp.text(); } catch (_) {}
      logger.debug('ComfyUI', 'VRAM freed (models unloaded)');
    } catch (err) {
      logger.warn('ComfyUI', `freeVram failed: ${err.message}`);
    }
  }

  // ── Submit workflow ─────────────────────────────────────────────────────────

  async submitWorkflow(workflow) {
    const payload = {
      prompt: workflow,
      client_id: this._clientId,
    };

    const resp = await this._fetchWithRetry(`${this._baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ComfyUI submit failed (${resp.status}): ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    return { promptId: data.prompt_id };
  }

  // ── Get result (single poll) ────────────────────────────────────────────────

  async getResult(promptId) {
    try {
      const resp = await fetch(`${this._baseUrl}/history/${promptId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return { status: 'pending', outputs: [], error: null };
      const data = await resp.json();
      const entry = data[promptId];

      if (!entry) return { status: 'pending', outputs: [], error: null };

      // Check for error
      if (entry.status?.status_str === 'error') {
        return {
          status: 'failed',
          outputs: [],
          error: entry.status?.messages?.[0]?.[1]?.exception_message || 'Unknown ComfyUI error',
        };
      }

      // Check if completed
      if (entry.outputs && Object.keys(entry.outputs).length > 0) {
        const outputs = [];
        for (const nodeId of Object.keys(entry.outputs)) {
          const nodeOut = entry.outputs[nodeId];
          if (nodeOut.images) {
            for (const img of nodeOut.images) {
              outputs.push({
                filename: img.filename,
                subfolder: img.subfolder || '',
                type: img.type || 'output',
              });
            }
          }
          if (nodeOut.gifs) {
            for (const gif of nodeOut.gifs) {
              outputs.push({
                filename: gif.filename,
                subfolder: gif.subfolder || '',
                type: gif.type || 'output',
              });
            }
          }
        }
        return { status: 'completed', outputs, error: null };
      }

      return { status: 'running', outputs: [], error: null };
    } catch (err) {
      return { status: 'pending', outputs: [], error: err.message };
    }
  }

  // ── Wait for result (polling fallback) ──────────────────────────────────────

  async waitForResult(promptId) {
    const start = Date.now();

    while (Date.now() - start < this._timeout) {
      const res = await this.getResult(promptId);

      if (res.status === 'completed') return res;
      if (res.status === 'failed') throw new Error(res.error || 'Generation failed');

      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error('Generation timeout exceeded');
  }

  // ── Hard timeout wrapper ────────────────────────────────────────────────────

  async withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Hard timeout exceeded')), ms || this._timeout);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  // ── Fetch output file ───────────────────────────────────────────────────────

  async fetchOutput(filename, subfolder = '', type = 'output') {
    // Security: reject path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error(`Invalid output filename: ${filename}`);
    }

    const params = new URLSearchParams({ filename, subfolder, type });
    const url = `${this._baseUrl}/view?${params}`;

    // Retry loop: ComfyUI may not have flushed the file yet
    for (let i = 0; i < 10; i++) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!resp.ok) {
          if (i < 9) { await new Promise(r => setTimeout(r, 200)); continue; }
          throw new Error(`Failed to fetch output: HTTP ${resp.status}`);
        }
        const buf = Buffer.from(await resp.arrayBuffer());

        // Empty buffer retry
        if (buf.length === 0 && i < 9) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        // Large file protection
        const maxBytes = this._maxOutputSizeMB * 1024 * 1024;
        if (buf.length > maxBytes) {
          throw new Error(`Output too large (${(buf.length / 1024 / 1024).toFixed(1)} MB > ${this._maxOutputSizeMB} MB limit)`);
        }

        return buf;
      } catch (err) {
        if (err.message.includes('Output too large') || err.message.includes('Invalid output')) throw err;
        if (i === 9) throw err;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    throw new Error('Output not ready after retries');
  }

  // ── Object info (models, checkpoints, etc.) ─────────────────────────────────

  async getObjectInfo() {
    try {
      const resp = await fetch(`${this._baseUrl}/object_info`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // Extract checkpoint names from CheckpointLoaderSimple node
      const checkpoints = [];
      const loras = [];
      const vaes = [];

      const ckptNode = data.CheckpointLoaderSimple;
      if (ckptNode?.input?.required?.ckpt_name?.[0]) {
        checkpoints.push(...ckptNode.input.required.ckpt_name[0]);
      }

      const loraNode = data.LoraLoader;
      if (loraNode?.input?.required?.lora_name?.[0]) {
        loras.push(...loraNode.input.required.lora_name[0]);
      }

      const vaeNode = data.VAELoader;
      if (vaeNode?.input?.required?.vae_name?.[0]) {
        vaes.push(...vaeNode.input.required.vae_name[0]);
      }

      return { checkpoints, loras, vaes };
    } catch (err) {
      logger.warn('ComfyUI', `getObjectInfo failed: ${err.message}`);
      return { checkpoints: [], loras: [], vaes: [] };
    }
  }

  // ── WebSocket progress ──────────────────────────────────────────────────────

  connectWS(onProgress) {
    // Close previous WS to prevent leak
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }

    const wsUrl = `${this._baseUrl.replace('http', 'ws')}/ws?clientId=${this._clientId}`;

    try {
      this._ws = new WebSocket(wsUrl);

      this._ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'progress' && msg.data) {
            const { value, max, prompt_id } = msg.data;
            if (onProgress && prompt_id) {
              onProgress({
                promptId: prompt_id,
                step: value || 0,
                totalSteps: max || 0,
                percent: max > 0 ? Math.round((value / max) * 100) : 0,
              });
            }
          } else if (msg.type === 'executing' && msg.data) {
            if (msg.data.node === null && onProgress) {
              // Execution finished
              onProgress({
                promptId: msg.data.prompt_id,
                step: 0,
                totalSteps: 0,
                percent: 100,
                done: true,
              });
            }
          }
        } catch (_) {}
      });

      this._ws.on('error', (err) => {
        logger.warn('ComfyUI', `WS error: ${err.message}`);
      });

      this._ws.on('close', () => {
        this._ws = null;
      });

      logger.debug('ComfyUI', `WS connected to ${wsUrl}`);
    } catch (err) {
      logger.warn('ComfyUI', `WS connect failed: ${err.message}`);
      this._ws = null;
    }
  }

  disconnectWS() {
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }
  }

  get isWSConnected() {
    return this._ws?.readyState === WebSocket.OPEN;
  }

  // ── Internal: fetch with retry ──────────────────────────────────────────────

  async _fetchWithRetry(url, options = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= this._retries; attempt++) {
      try {
        const resp = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(this._timeout),
        });
        return resp;
      } catch (err) {
        lastErr = err;
        // Only retry on transient network errors
        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
          if (attempt < this._retries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
