// WhatLLM.org External Benchmark Client — L5 Discovery Layer
// ══════════════════════════════════════════════════════════════════════════════
//
// Fetches real-world quality scores from whatllm.org (Artificial Analysis
// Intelligence Index composite: GPQA Diamond + AIME 2025 + LiveCodeBench +
// SWE-Bench Verified + MMLU-Pro).
//
// Data format: { name, qualityIndex (0-100), creator, contextWindow, outputSpeed }
// No individual benchmark breakdowns — only the composite qualityIndex.
//
// Integration:
//   enrichCandidates(candidates) → upgrades benchmarkConfidence for matched models
//   Called from upgrade-manager.js during fullCycle discovery.
//
// Priority: empirical > local validation > L5 (whatllm) > L4 (estimated) > L2 (catalog)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const WHATLLM_URL = 'https://whatllm.org';
const FETCH_TIMEOUT = 15_000;          // 15s
const CACHE_TTL = 24 * 3600 * 1000;    // 24h
const ERROR_COOLDOWN = 3600 * 1000;     // 1h retry after failure
const MIN_MODELS = 20;                  // Sanity: expect at least 20 models

// Confidence for whatllm-sourced benchmarks (real data > estimates, < catalog)
export const WHATLLM_CONFIDENCE = 0.85;

// Quantization penalty — full-precision benchmarks don't apply 1:1 to quantized models
const QUANT_PENALTY = {
  'q2_k': 0.82, 'q3_k_s': 0.85, 'q3_k_m': 0.87, 'q3_k_l': 0.88,
  'q4_0': 0.88, 'q4_k_s': 0.90, 'q4_k_m': 0.92,
  'q5_0': 0.94, 'q5_k_s': 0.95, 'q5_k_m': 0.96,
  'q6_k': 0.97, 'q8_0': 0.99, 'fp16': 1.0,
};

// Known creator → family mappings (whatllm uses "Meta", Ollama uses "llama3.2:3b")
const CREATOR_FAMILIES = {
  'meta':       ['llama'],
  'alibaba':    ['qwen'],
  'deepseek':   ['deepseek'],
  'mistral':    ['mistral', 'mixtral', 'codestral', 'pixtral'],
  'google':     ['gemma'],
  'microsoft':  ['phi'],
  'cohere':     ['command-r'],
  '01.ai':      ['yi'],
  'nvidia':     ['nemotron'],
  'ibm':        ['granite'],
};

// ─── Cache ───────────────────────────────────────────────────────────────────

let _cache = null;
let _lastFetch = 0;
let _lastError = 0;

// ─── HTML Parsing ────────────────────────────────────────────────────────────

/**
 * Extract model data from whatllm.org HTML.
 * Multi-strategy parser — handles both Next.js App Router (__next_f.push)
 * and Pages Router (__NEXT_DATA__) formats.
 *
 * @param {string} html - Raw HTML content
 * @returns {Array<{name: string, qualityIndex: number, creator: string, contextWindow: number}>}
 */
export function parseModels(html) {
  // Strategy 1: __NEXT_DATA__ script tag (Next.js Pages Router)
  const nextData = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) {
    try {
      const data = JSON.parse(nextData[1]);
      const models = _findModelsArray(data);
      if (models && models.length >= MIN_MODELS) return models;
    } catch { /* fall through */ }
  }

  // Strategy 2: Search for "models":[...] in raw HTML (catches __next_f embedded data)
  const models = _extractModelsFromText(html);
  if (models) return models;

  // Strategy 3: Unescape __next_f chunks, then search
  const unescaped = _unescapeNextF(html);
  if (unescaped) {
    const models2 = _extractModelsFromText(unescaped);
    if (models2) return models2;
  }

  throw new Error('WHATLLM_PARSE_FAILED');
}

/**
 * Recursively search a JSON tree for an array of model objects.
 */
function _findModelsArray(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length >= MIN_MODELS && obj[0]?.qualityIndex != null) return obj;
    for (const item of obj) {
      const found = _findModelsArray(item);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(obj)) {
    if (key === 'models' && Array.isArray(obj[key]) && obj[key].length >= MIN_MODELS) {
      return obj[key];
    }
    const found = _findModelsArray(obj[key]);
    if (found) return found;
  }
  return null;
}

/**
 * Find "models":[...] in text using balanced bracket extraction.
 */
function _extractModelsFromText(text) {
  const re = /"models"\s*:\s*\[/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length - 1; // Position of '['
    const arr = _extractBalancedArray(text, start);
    if (!arr) continue;
    try {
      const parsed = JSON.parse(arr);
      if (Array.isArray(parsed) && parsed.length >= MIN_MODELS && parsed[0]?.qualityIndex != null) {
        return parsed;
      }
    } catch { /* try next match */ }
  }
  return null;
}

/**
 * Extract a balanced JSON array starting at `start` position.
 */
function _extractBalancedArray(text, start) {
  if (text[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length && i < start + 2_000_000; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Unescape __next_f push chunks — Next.js RSC format stores JSON as escaped
 * strings inside `self.__next_f.push([1,"..."])` calls.
 */
function _unescapeNextF(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[\d+,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    chunks.push(m[1]);
  }
  if (chunks.length === 0) return null;
  return chunks.join('')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

// ─── Model Name Parsing ─────────────────────────────────────────────────────

/**
 * Parse whatllm model name into family + params.
 * Examples:
 *   "Qwen3.5 27B"         → { family: "qwen", version: "3.5", params: 27 }
 *   "Llama 3.1 Instruct 70B" → { family: "llama", version: "3.1", params: 70 }
 *   "DeepSeek V3.2"       → { family: "deepseek", version: "3.2", params: null }
 *   "Mistral Large 2"     → { family: "mistral", version: null, params: null }
 *
 * @param {string} name - whatllm model name
 * @returns {{ family: string, version: string|null, params: number|null }}
 */
export function parseWhatllmName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();

  // Extract param count (e.g. "70B", "7.5B", "27b")
  const paramsMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*b\b/);
  const params = paramsMatch ? parseFloat(paramsMatch[1]) : null;

  // Extract family name — first word group, stripped of version numbers
  // "qwen3.5 27b" → family "qwen"
  // "llama 3.1 instruct 70b" → family "llama"
  // "deepseek v3.2" → family "deepseek"
  const familyMatch = lower.match(/^([a-z]+)/);
  if (!familyMatch) return null;
  const family = familyMatch[1];

  // Extract version — number after family name (e.g. "3.5", "3.1", "v3.2")
  const versionMatch = lower.match(/(?:^[a-z]+|[vV])\s*(\d+(?:\.\d+)?)/);
  const version = versionMatch ? versionMatch[1] : null;

  return { family, version, params };
}

/**
 * Parse Ollama model name into family + params.
 * Examples:
 *   "qwen2.5:72b"    → { family: "qwen", version: "2.5", params: 72 }
 *   "llama3.1:70b"   → { family: "llama", version: "3.1", params: 70 }
 *   "deepseek-r1:32b" → { family: "deepseek", version: null, params: 32 }
 *
 * @param {string} name - Ollama model name
 * @returns {{ family: string, version: string|null, params: number|null }}
 */
export function parseOllamaName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();

  // Split on colon: "qwen2.5:72b" → ["qwen2.5", "72b"]
  const [base, tag] = lower.split(':');
  if (!base) return null;

  // Extract params from tag
  const paramsMatch = (tag || '').match(/^(\d+(?:\.\d+)?)b/);
  const params = paramsMatch ? parseFloat(paramsMatch[1]) : null;

  // Extract family — strip version numbers and suffixes
  // "qwen2.5" → "qwen", "llama3.1" → "llama", "deepseek-r1" → "deepseek"
  const familyMatch = base.match(/^([a-z]+)/);
  if (!familyMatch) return null;
  const family = familyMatch[1];

  // Extract version from base: "qwen2.5" → "2.5", "llama3.1" → "3.1"
  const versionMatch = base.match(/(\d+(?:\.\d+)?)/);
  const version = versionMatch ? versionMatch[1] : null;

  return { family, version, params };
}

// ─── Matching ────────────────────────────────────────────────────────────────

/**
 * Match whatllm models to Ollama candidate models.
 * Strict matching: family must match exactly AND params within 10%.
 *
 * @param {Array} whatllmModels - Parsed whatllm entries
 * @param {Array} candidates - Ollama model candidates (with .name field)
 * @returns {Map<string, Object>} Map of ollamaName → whatllmModel
 */
export function matchModels(whatllmModels, candidates) {
  const matches = new Map();

  // Pre-parse whatllm names
  const parsed = whatllmModels
    .filter(m => m.qualityIndex != null && m.qualityIndex > 0)
    .map(m => ({ ...m, _parsed: parseWhatllmName(m.name) }))
    .filter(m => m._parsed?.family);

  for (const candidate of candidates) {
    const cParsed = parseOllamaName(candidate.name);
    if (!cParsed?.family) continue;

    // Find best matching whatllm entry: exact family + closest params
    let bestMatch = null;
    let bestParamDelta = Infinity;

    for (const wm of parsed) {
      // Family must match exactly
      if (wm._parsed.family !== cParsed.family) continue;

      // Both must have params — cloud-only models (no params) can't reliably match
      if (wm._parsed.params == null || cParsed.params == null) continue;

      // Params must be within 10%
      const delta = Math.abs(wm._parsed.params - cParsed.params);
      const maxP = Math.max(wm._parsed.params, cParsed.params);
      if (delta / maxP > 0.10) continue; // >10% mismatch → skip
      if (delta < bestParamDelta) {
        bestParamDelta = delta;
        bestMatch = wm;
      }
    }

    if (bestMatch) {
      matches.set(candidate.name, bestMatch);
    }
  }

  return matches;
}

// ─── Quantization Penalty ────────────────────────────────────────────────────

/**
 * Get quantization degradation factor for a model.
 * whatllm benchmarks are full-precision; Ollama models are typically Q4_K_M.
 *
 * @param {string} [quant] - Quantization level (e.g. "q4_k_m")
 * @returns {number} 0.82-1.0 penalty factor
 */
export function getQuantPenalty(quant) {
  if (!quant) return QUANT_PENALTY['q4_k_m']; // Default assumption for Ollama
  const key = quant.toLowerCase().replace(/-/g, '_');
  return QUANT_PENALTY[key] ?? QUANT_PENALTY['q4_k_m'];
}

// ─── Fetch + Cache ───────────────────────────────────────────────────────────

/**
 * Fetch whatllm.org model data with caching and error cooldown.
 *
 * @returns {Promise<Array>} Array of { name, qualityIndex, creator, contextWindow }
 */
export async function fetchModels() {
  const now = Date.now();

  // Return cached if fresh
  if (_cache && (now - _lastFetch) < CACHE_TTL) {
    return _cache;
  }

  // Error cooldown — don't spam after failure
  if (_lastError && (now - _lastError) < ERROR_COOLDOWN) {
    return _cache || [];
  }

  try {
    const res = await fetch(WHATLLM_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'Accept': 'text/html' },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const html = await res.text();
    const models = parseModels(html);

    _cache = models;
    _lastFetch = now;
    _lastError = 0;

    logger.info('WhatLLM', `Fetched ${models.length} models`);
    return models;
  } catch (err) {
    _lastError = now;
    logger.warn('WhatLLM', `Fetch failed: ${err.message}`);
    return _cache || []; // Return stale cache on error, or empty
  }
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

/**
 * Enrich model candidates with real benchmark data from whatllm.org.
 *
 * For each matched candidate with estimated benchmarks (benchmarkConfidence < 0.85):
 *   - Replaces benchmark scores with normalized qualityIndex
 *   - Upgrades benchmarkConfidence to 0.85
 *   - Applies quantization penalty
 *
 * Does NOT touch:
 *   - Catalog models (benchmarkConfidence >= 0.85)
 *   - Models with empirical data (handled separately by empirical-scorer)
 *   - Unmatched models (keep existing estimates)
 *
 * @param {Array} candidates - Model candidates to enrich
 * @param {Object} [opts]
 * @param {Array}  [opts.whatllmModels] - Pre-fetched whatllm data (for testing)
 * @returns {Promise<{ enriched: number, total: number }>}
 */
export async function enrichCandidates(candidates, opts = {}) {
  const whatllmModels = opts.whatllmModels || await fetchModels();
  if (!whatllmModels || whatllmModels.length === 0) {
    return { enriched: 0, total: candidates.length };
  }

  const matches = matchModels(whatllmModels, candidates);
  let enriched = 0;

  // Find max qualityIndex for normalization (practical ceiling, not 100)
  const maxQuality = Math.max(...whatllmModels.map(m => m.qualityIndex || 0), 1);

  for (const candidate of candidates) {
    // Skip models that already have high-confidence benchmarks (catalog, manually set)
    if ((candidate.benchmarkConfidence ?? 1.0) >= WHATLLM_CONFIDENCE) continue;

    const whatllm = matches.get(candidate.name);
    if (!whatllm || !whatllm.qualityIndex) continue;

    // Normalize qualityIndex to 0-1 scale (relative to observed max)
    const rawScore = whatllm.qualityIndex / maxQuality;

    // Apply quantization penalty
    const qp = getQuantPenalty(candidate.recommendedQuant || candidate.quant);
    const adjustedScore = rawScore * qp;

    // Set ALL benchmark keys to the adjusted score so computeBenchmarkScore()
    // produces the same value regardless of role weights.
    // This is a known limitation — we lose role-specific differentiation.
    // However, for L4 provisionals with confidence 0.30-0.60, this is a net gain.
    candidate.benchmarks = {
      swebench: adjustedScore,
      livecodebench: adjustedScore,
      humaneval: adjustedScore,
      mmlu: adjustedScore,
      arena: adjustedScore,
      reasoning: adjustedScore,
    };
    candidate.benchmarkConfidence = WHATLLM_CONFIDENCE;
    candidate.benchmarkSource = 'whatllm';
    candidate.whatllmQuality = whatllm.qualityIndex;
    candidate.whatllmVersion = `whatllm-${new Date().toISOString().slice(0, 10)}`;

    // Also update contextWindow if whatllm has better data and candidate has none
    if (whatllm.contextWindow && !candidate.contextWindow) {
      candidate.contextWindow = whatllm.contextWindow;
    }

    enriched++;
  }

  if (enriched > 0) {
    logger.info('WhatLLM', `Enriched ${enriched}/${candidates.length} candidates (${matches.size} matched)`);
  }

  return { enriched, total: candidates.length };
}

// ─── Cache Control (for testing) ─────────────────────────────────────────────

export function clearCache() {
  _cache = null;
  _lastFetch = 0;
  _lastError = 0;
}

export function getCacheState() {
  return {
    hasCache: _cache != null,
    modelCount: _cache?.length ?? 0,
    lastFetch: _lastFetch,
    lastError: _lastError,
    age: _lastFetch ? Date.now() - _lastFetch : null,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  fetchModels,
  enrichCandidates,
  parseModels,
  parseWhatllmName,
  parseOllamaName,
  matchModels,
  getQuantPenalty,
  clearCache,
  getCacheState,
  WHATLLM_CONFIDENCE,
};
