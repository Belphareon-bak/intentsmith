// Model Discovery v103 — Ollama Model Discovery & Family Heuristics
// ══════════════════════════════════════════════════════════════════════════════
//
// Three-level discovery:
//   L1: Local — query Ollama /api/tags for installed models
//   L2: Remote — query Ollama library for available models (Phase 2)
//   L3: Family heuristics — infer upgrade paths from naming patterns
//
// This module is Phase 1: L1 (local) + L3 (family heuristics).
// L2 (remote) will be added in Phase 2 with caching (.c3/model-catalog.json).
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { parseModelName, MODEL_FAMILIES } from './model-profiles.js';

// ─── Ollama API ────────────────────────────────────────────────────────────

/**
 * Fetch installed models from Ollama /api/tags.
 *
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl] - Ollama base URL override
 * @param {number} [opts.timeout=5000] - Request timeout (ms)
 * @returns {Promise<Array<OllamaModel>>}
 *
 * OllamaModel = {
 *   name: string,           // e.g. "qwen3.5:27b"
 *   size: number,           // bytes
 *   modifiedAt: string,     // ISO date
 *   digest: string,         // sha256
 *   details: { family, parameterSize, quantizationLevel, format }
 * }
 */
export async function fetchInstalledModels(opts = {}) {
  const baseUrl = opts.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
  const timeout = opts.timeout ?? 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.models || [];
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('ModelDiscovery', `Ollama timeout after ${timeout}ms`);
    } else if (err.code === 'ECONNREFUSED') {
      logger.warn('ModelDiscovery', 'Ollama not running');
    } else {
      logger.warn('ModelDiscovery', `Failed to fetch models: ${err.message}`);
    }
    return [];
  }
}

/**
 * Fetch detailed info for a specific model from Ollama /api/show.
 *
 * @param {string} modelName
 * @param {Object} [opts]
 * @returns {Promise<Object|null>}
 */
export async function fetchModelInfo(modelName, opts = {}) {
  const baseUrl = opts.baseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
  const timeout = opts.timeout ?? 5000;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ─── Candidate Building ────────────────────────────────────────────────────

/**
 * Build candidate list from installed Ollama models.
 * Enriches raw Ollama data with parsed family/version/params.
 *
 * @param {Array<OllamaModel>} ollamaModels - From fetchInstalledModels()
 * @returns {Array<ModelCandidate>}
 *
 * ModelCandidate = {
 *   name: string,
 *   family: string,
 *   category: string,
 *   version: string|null,
 *   params: number|null,
 *   quantization: string|null,
 *   sizeBytes: number,
 *   sizeGB: number,
 *   modifiedAt: string|null,
 *   installed: boolean,
 *   source: 'local'|'remote'
 * }
 */
export function buildCandidates(ollamaModels) {
  const candidates = [];

  for (const m of ollamaModels) {
    const parsed = parseModelName(m.name);

    // Try to get params from Ollama details if our parser missed it
    let params = parsed.params;
    if (!params && m.details?.parameter_size) {
      const pMatch = m.details.parameter_size.match(/(\d+)/);
      if (pMatch) params = parseInt(pMatch[1], 10);
    }

    // Try to get quantization from details
    let quantization = parsed.quantization;
    if (!quantization && m.details?.quantization_level) {
      quantization = m.details.quantization_level;
    }

    candidates.push({
      name: m.name,
      family: parsed.family,
      category: parsed.category,
      version: parsed.version,
      params,
      quantization,
      sizeBytes: m.size || 0,
      sizeGB: m.size ? Math.round((m.size / 1_073_741_824) * 10) / 10 : 0,
      modifiedAt: m.modified_at || null,
      installed: true,
      source: 'local',
    });
  }

  return candidates;
}

// ─── Family Upgrade Heuristics ─────────────────────────────────────────────

/**
 * Known upgrade paths within model families.
 * These are manually curated — the "L3" layer.
 *
 * Format: { from: regex, to: string[], reason: string }
 * "from" matches current model name, "to" lists recommended upgrades.
 */
export const UPGRADE_HINTS = [
  {
    from: /^qwen2\.5/i,
    to: ['qwen3', 'qwen3.5'],
    reason: 'Qwen 3/3.5 significantly outperforms 2.5 on code and reasoning benchmarks',
  },
  {
    from: /^qwen3(?!\.5)/i,
    to: ['qwen3.5'],
    reason: 'Qwen 3.5 improves code generation and instruction following over Qwen 3',
  },
  {
    from: /^llama3\.1/i,
    to: ['llama3.2', 'llama3.3', 'llama4'],
    reason: 'Newer Llama versions improve reasoning and multilingual support',
  },
  {
    from: /^llama3\.2/i,
    to: ['llama3.3', 'llama4'],
    reason: 'Newer Llama versions available',
  },
  {
    from: /^deepseek-r1(?!-0528)/i,
    to: ['deepseek-r1-0528'],
    reason: 'DeepSeek R1 0528 fixes JSON reliability and improves reasoning',
  },
  {
    from: /^codestral(?!-25\.01)/i,
    to: ['codestral-25.01'],
    reason: 'Codestral 25.01 improves code completion accuracy',
  },
  {
    from: /^mistral(?!-nemo)/i,
    to: ['mistral-nemo', 'mistral-large'],
    reason: 'Newer Mistral models available with better performance',
  },
  {
    from: /^phi-3/i,
    to: ['phi-4'],
    reason: 'Phi-4 significantly improves over Phi-3 in reasoning and code',
  },
  {
    from: /^llava:13b/i,
    to: ['llava:34b', 'llava-next'],
    reason: 'Larger LLaVA models provide better image understanding',
  },
];

/**
 * Find upgrade hints for a model name.
 *
 * @param {string} currentModel
 * @returns {Array<{suggestedModel: string, reason: string}>}
 */
export function getUpgradeHints(currentModel) {
  const hints = [];
  for (const hint of UPGRADE_HINTS) {
    if (hint.from.test(currentModel)) {
      for (const target of hint.to) {
        hints.push({ suggestedModel: target, reason: hint.reason });
      }
    }
  }
  return hints;
}

// ─── Full Discovery Pipeline ───────────────────────────────────────────────

/**
 * Run full model discovery: fetch installed → build candidates → enrich with hints.
 *
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl] - Ollama base URL override
 * @param {number} [opts.timeout] - Ollama API timeout
 * @returns {Promise<DiscoveryResult>}
 *
 * DiscoveryResult = {
 *   candidates: ModelCandidate[],
 *   hints: Map<string, UpgradeHint[]>,    // currentModel → hints
 *   ollamaAvailable: boolean,
 *   timestamp: number
 * }
 */
export async function discover(opts = {}) {
  const ollamaModels = await fetchInstalledModels(opts);
  const ollamaAvailable = ollamaModels.length > 0;
  const candidates = buildCandidates(ollamaModels);

  // Build hints map for current models
  const hints = new Map();
  const currentModels = new Set();
  try {
    const { getCurrentBindings } = await import('./model-profiles.js');
    const bindings = getCurrentBindings();
    for (const model of Object.values(bindings)) {
      if (model && !currentModels.has(model)) {
        currentModels.add(model);
        const modelHints = getUpgradeHints(model);
        if (modelHints.length > 0) {
          hints.set(model, modelHints);
        }
      }
    }
  } catch {
    // model-profiles not available — skip hints
  }

  logger.info('ModelDiscovery', `Discovered ${candidates.length} installed models, ${hints.size} upgrade hints`, {
    ollamaAvailable,
    families: [...new Set(candidates.map(c => c.family))],
  });

  return {
    candidates,
    hints,
    ollamaAvailable,
    timestamp: Date.now(),
  };
}

export default {
  fetchInstalledModels, fetchModelInfo, buildCandidates,
  getUpgradeHints, discover, UPGRADE_HINTS,
};
