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
import { parseModelNameExtended } from './model-family-extensions.js';
import { normalizeInstalledModel } from './model-inventory.js';
import { catalogLookupKey, enrichLocalCandidateMetadata } from './catalog-metadata.js';
import { enrichFromHuggingFace } from './huggingface-client.js';

// ─── Ollama API ────────────────────────────────────────────────────────────

// v124.6: Unreachable backoff cache
let _ollamaUnreachableUntil = 0;

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
  // v124.6: Skip if Ollama was recently unreachable (30s backoff)
  if (Date.now() < _ollamaUnreachableUntil) return [];

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
      // v124.6: Cache unreachable state for 30s backoff
      _ollamaUnreachableUntil = Date.now() + 30_000;
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
    const normalized = normalizeInstalledModel(m);

    candidates.push({
      name: normalized.name,
      family: normalized.family,
      category: normalized.category,
      version: normalized.version,
      params: normalized.params,
      quantization: normalized.quantization,
      sizeBytes: normalized.size,
      sizeGB: Math.round((normalized.size / 1_073_741_824) * 10) / 10,
      modifiedAt: normalized.modifiedAt,
      installed: true,
      source: 'local',
      digest: normalized.digest,
      digestSha256: normalized.digestSha256,
      details: normalized.details,
      capabilities: normalized.capabilities,
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
    reason: 'Newer Qwen generation candidate; exact role evaluation required',
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
  // Volající předávají buď holá jména z Ollama, nebo už lookup klíče.  Převod
  // na klíče je idempotentní, takže obojí projde stejnou cestou a katalog
  // nenabídne model, který je pod jiným zápisem jména už nainstalovaný.
  const installedKeys = new Set();
  for (const name of installedNames || []) {
    const key = catalogLookupKey(name);
    if (key) installedKeys.add(key);
  }

  const candidates = [];
  for (const entry of catalog) {
    // Skip installed
    const entryKey = catalogLookupKey(entry.name);
    if (entryKey && installedKeys.has(entryKey)) continue;

    // Skip immature
    if (entry.releaseDate) {
      const ageDays = (Date.now() - Date.parse(entry.releaseDate)) / (24 * 60 * 60 * 1000);
      if (ageDays < minDays) continue;
    } else {
      // Unknown release date — skip (maturity unknown)
      continue;
    }

    const parsed = parseModelNameExtended(entry.name);
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

  // Katalog se načítá vždy, ne jen pro L2. Lokální kandidáti z něj
  // berou pouze factual metadata; kvalita patří exact-contract evaluaci.
  let catalog = null;
  try {
    const mod = await import('./model-catalog.js');
    catalog = mod.CATALOG || mod.default?.CATALOG || null;
  } catch (err) {
    logger.warn('ModelDiscovery', `Catalog load failed: ${err.message}`);
  }

  let enrichment = { exact: 0, unmatched: [] };
  if (catalog) {
    enrichment = enrichLocalCandidateMetadata(localCandidates, catalog);
    if (enrichment.unmatched.length > 0) {
      logger.warn(
        'ModelDiscovery',
        `Katalog nepokrývá ${enrichment.unmatched.length} nainstalovaných modelů: ${enrichment.unmatched.join(', ')}`,
      );
    }
  }

  // Druhý zdroj faktů.  Katalog je ruční a whatllm je jediný zdroj kvality —
  // HuggingFace slouží k ověření data vydání a schopností a k odhalení rozporu.
  // Za bránou outbound policy; bez sítě se prostě nic nedoplní.
  let hfSummary = { resolved: 0, datesFilled: 0, visionFound: 0, conflicts: [] };
  if (config.features?.onlineDiscovery && opts.includeHuggingFace !== false) {
    try {
      hfSummary = await enrichFromHuggingFace(localCandidates);
    } catch (err) {
      logger.warn('ModelDiscovery', `HuggingFace enrichment selhal: ${err.message}`);
    }
  }

  // Shoda „už nainstalováno“ musí být tolerantní ke znakovému zápisu, jinak
  // katalog nabídne `deepseek-r1:32b` proti nainstalovanému `deepseek-r1-32b`.
  const localKeys = new Set(
    localCandidates.map(c => catalogLookupKey(c.name)).filter(Boolean),
  );

  // L2: Catalog candidates (fullCycle only)
  let catalogCandidates = [];
  if (opts.includeCatalog && catalog) {
    catalogCandidates = _filterCatalog(catalog, localKeys, opts.minMaturityDays ?? 7);
  }

  // Merge: L1 wins on name collision (dedup)
  const merged = [...localCandidates];
  for (const cc of catalogCandidates) {
    const key = catalogLookupKey(cc.name);
    if (!key || !localKeys.has(key)) {
      merged.push(cc);
    }
  }

  // L4: Online discovery (provisional entries from discovered_models DB)
  // L1 (installed) wins; L2 (catalog) wins; L4 fills gaps
  let l4Count = 0;
  if (_onlineDiscovery) {
    try {
      const provisional = await _onlineDiscovery.getDiscoveredModels();
      const mergedKeys = new Set(merged.map(c => catalogLookupKey(c.name)).filter(Boolean));
      for (const entry of provisional) {
        const entryKey = catalogLookupKey(entry.name);
        if (!entryKey || !mergedKeys.has(entryKey)) {
          if (entryKey) mergedKeys.add(entryKey);
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
            baseVramMb: entry.baseVramMb,
            contextWindow: entry.contextWindow,
            capabilities: entry.capabilities,
            releaseDate: entry.releaseDate,
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

  const stats = {
    local: localCandidates.length,
    catalog: catalogCandidates.length,
    l4: l4Count,
    total: merged.length,
    enrichedExact: enrichment.exact,
    enrichedEstimated: enrichment.estimated,
    enrichmentMissing: enrichment.unmatched.length,
    hfResolved: hfSummary.resolved,
    hfDatesFilled: hfSummary.datesFilled,
    hfVisionFound: hfSummary.visionFound,
    sourceConflicts: hfSummary.conflicts,
  };
  logger.info('ModelDiscovery', `Discovered ${stats.local} local + ${stats.catalog} catalog + ${stats.l4} L4 = ${stats.total} candidates, ${hints.size} hints`, {
    ollamaAvailable,
    families: [...new Set(merged.map(c => c.family))],
    enrichment: `${enrichment.exact} exact / ${enrichment.estimated} odhad / ${enrichment.unmatched.length} bez podkladu`,
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
