// Model Discovery v118 — Ollama Model Discovery & Catalog Candidates
// ══════════════════════════════════════════════════════════════════════════════
//
// Three-level discovery:
//   L1: Local — query Ollama /api/tags for installed models
//   L2: Catalog — curated model catalog (not installed, maturity ≥7d)
//   L3: Family heuristics — infer upgrade paths from naming patterns
//
// L1 always runs. L2 on fullCycle (discover({ includeCatalog: true })).
// L3 always runs for hints.
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

// ─── L2: Catalog Candidates (v118) ───────────────────────────────────────────

/**
 * Build candidate list from curated catalog (not-installed models).
 *
 * @param {Set<string>} installedNames - Names of installed models
 * @param {Object} [opts]
 * @param {number} [opts.minMaturityDays=7] - Minimum days since release
 * @returns {Array<ModelCandidate>}
 */
export function buildCatalogCandidates(installedNames, opts = {}) {
  const minDays = opts.minMaturityDays ?? 7;

  let catalog;
  try {
    // Lazy import — catalog may not be available yet
    const mod = require('./model-catalog.js');
    catalog = mod.CATALOG || mod.default?.CATALOG;
  } catch {
    try {
      // ESM dynamic import is async; use synchronous fallback
      return _buildCatalogCandidatesAsync(installedNames, minDays);
    } catch {
      return [];
    }
  }

  if (!catalog) return [];
  return _filterCatalog(catalog, installedNames, minDays);
}

function _filterCatalog(catalog, installedNames, minDays) {
  const candidates = [];
  for (const entry of catalog) {
    // Skip installed
    if (installedNames.has(entry.name)) continue;

    // Skip immature
    if (entry.releaseDate) {
      const ageDays = (Date.now() - Date.parse(entry.releaseDate)) / (24 * 60 * 60 * 1000);
      if (ageDays < minDays) continue;
    } else {
      // Unknown release date — skip (maturity unknown)
      continue;
    }

    // Benchmark sanity: reject if ALL benchmarks are null
    if (entry.benchmarks) {
      const hasAny = Object.values(entry.benchmarks).some(v => v != null);
      if (!hasAny) continue;
    } else {
      continue;
    }

    const parsed = parseModelName(entry.name);
    candidates.push({
      name: entry.name,
      family: parsed.family,
      category: entry.category || parsed.category,
      version: parsed.version,
      params: entry.params || parsed.params,
      quantization: parsed.quantization,
      sizeBytes: (entry.sizeGB || 0) * 1_073_741_824,
      sizeGB: entry.sizeGB || 0,
      modifiedAt: entry.releaseDate || null,
      installed: false,
      source: 'catalog',
      // Catalog-specific fields passed through for ranker
      benchmarks: entry.benchmarks,
      baseVramMb: entry.baseVramMb,
      contextWindow: entry.contextWindow,
      capabilities: entry.capabilities,
      architecture: entry.architecture,
      releaseDate: entry.releaseDate,
      supersedes: entry.supersedes,
      effectiveVramMb: entry.baseVramMb, // Will be refined by computeEffectiveVram
    });
  }
  return candidates;
}

// Async fallback for ESM catalog import
let _catalogCache = null;
async function _buildCatalogCandidatesAsync(installedNames, minDays) {
  if (!_catalogCache) {
    try {
      const mod = await import('./model-catalog.js');
      _catalogCache = mod.CATALOG || mod.default?.CATALOG;
    } catch {
      return [];
    }
  }
  if (!_catalogCache) return [];
  return _filterCatalog(_catalogCache, installedNames, minDays);
}

// ─── L4 Online Discovery Integration ─────────────────────────────────────────

let _onlineDiscovery = null;

/**
 * Set the OnlineDiscovery instance for L4 provisional model merging.
 * @param {Object} od - OnlineDiscovery instance
 */
export function setOnlineDiscovery(od) {
  _onlineDiscovery = od;
}

// ─── Full Discovery Pipeline ───────────────────────────────────────────────

/**
 * Run full model discovery: L1 (local) + optional L2 (catalog) + L3 (hints).
 *
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl] - Ollama base URL override
 * @param {number} [opts.timeout] - Ollama API timeout
 * @param {boolean} [opts.includeCatalog=false] - Include L2 catalog candidates
 * @returns {Promise<DiscoveryResult>}
 *
 * DiscoveryResult = {
 *   candidates: ModelCandidate[],
 *   hints: Map<string, UpgradeHint[]>,
 *   ollamaAvailable: boolean,
 *   timestamp: number,
 *   stats: { local: number, catalog: number, total: number }
 * }
 */
export async function discover(opts = {}) {
  const ollamaModels = await fetchInstalledModels(opts);
  const ollamaAvailable = ollamaModels.length > 0;
  const localCandidates = buildCandidates(ollamaModels);

  // L2: Catalog candidates (fullCycle only)
  let catalogCandidates = [];
  if (opts.includeCatalog) {
    const installedNames = new Set(localCandidates.map(c => c.name));
    try {
      const mod = await import('./model-catalog.js');
      const catalog = mod.CATALOG || mod.default?.CATALOG;
      if (catalog) {
        catalogCandidates = _filterCatalog(catalog, installedNames, opts.minMaturityDays ?? 7);
      }
    } catch (err) {
      logger.warn('ModelDiscovery', `Catalog load failed: ${err.message}`);
    }
  }

  // Merge: L1 wins on name collision (dedup)
  const localNames = new Set(localCandidates.map(c => c.name));
  const merged = [...localCandidates];
  for (const cc of catalogCandidates) {
    if (!localNames.has(cc.name)) {
      merged.push(cc);
    }
  }

  // L4: Online discovery (provisional entries from discovered_models DB)
  // L1 (installed) wins; L2 (catalog) wins; L4 fills gaps
  let l4Count = 0;
  if (_onlineDiscovery) {
    try {
      const provisional = await _onlineDiscovery.getDiscoveredModels();
      for (const entry of provisional) {
        if (!localNames.has(entry.name) && !merged.some(c => c.name === entry.name)) {
          merged.push({
            name: entry.name,
            family: entry.family,
            category: entry.category || 'general',
            version: entry.version || null,
            params: entry.params,
            quantization: null,
            sizeBytes: 0,
            sizeGB: 0,
            modifiedAt: entry.discoveredAt || null,
            installed: false,
            source: 'L4',
            benchmarks: entry.benchmarks,
            baseVramMb: entry.baseVramMb,
            contextWindow: entry.contextWindow,
            capabilities: entry.capabilities,
            releaseDate: entry.releaseDate,
            benchmarkConfidence: entry.benchmarkConfidence,
            provisional: true,
            discoveredAt: entry.discoveredAt,
          });
          l4Count++;
        }
      }
    } catch (err) {
      logger.warn('ModelDiscovery', `L4 merge failed: ${err.message}`);
    }
  }

  // L3: Build hints map for current models
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

  const stats = { local: localCandidates.length, catalog: catalogCandidates.length, l4: l4Count, total: merged.length };
  logger.info('ModelDiscovery', `Discovered ${stats.local} local + ${stats.catalog} catalog + ${stats.l4} L4 = ${stats.total} candidates, ${hints.size} hints`, {
    ollamaAvailable,
    families: [...new Set(merged.map(c => c.family))],
  });

  return {
    candidates: merged,
    hints,
    ollamaAvailable,
    timestamp: Date.now(),
    stats,
  };
}

export default {
  fetchInstalledModels, fetchModelInfo, buildCandidates,
  buildCatalogCandidates, getUpgradeHints, discover, UPGRADE_HINTS,
  setOnlineDiscovery,
};
