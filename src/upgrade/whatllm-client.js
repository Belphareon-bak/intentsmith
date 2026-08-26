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
import {
  MODEL_DISCOVERY_OUTBOUND_AUTHORITY,
  outboundFetch,
} from '../network/outbound-policy.js';

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
/**
 * Specializace, které mění účel modelu.  Coder, vision ani embedding model
 * nejsou zaměnitelné za obecný model téže rodiny a velikosti, takže se musí
 * shodovat na obou stranách, jinak párování odmítneme.
 */
const HARD_VARIANTS = Object.freeze(['coder', 'omni', 'vl', 'vision', 'embed', 'guard', 'math', 'rerank']);

/**
 * Měkké modifikátory — tytéž váhy v jiném režimu nebo řezu řady.  Rozdíl
 * skóre způsobit mohou, ale o jiný model nejde, takže slouží jen jako
 * rozřazovací kritérium při shodě všeho ostatního.
 */
const SOFT_VARIANTS = Object.freeze([
  'instruct', 'reasoning', 'thinking', 'chat', 'flash', 'mini', 'small',
  'medium', 'large', 'plus', 'max', 'next', 'pro', 'preview', 'turbo',
  'distill', 'nemo', 'r1', 'v2', 'v3',
]);

/** Vytáhne z názvu množinu tvrdých a měkkých variant. */
function extractVariants(lower) {
  const hard = new Set();
  const soft = new Set();
  for (const v of HARD_VARIANTS) {
    if (new RegExp(`(^|[^a-z])${v}([^a-z]|$)`).test(lower)) hard.add(v);
  }
  for (const v of SOFT_VARIANTS) {
    if (new RegExp(`(^|[^a-z0-9])${v}([^a-z0-9]|$)`).test(lower)) soft.add(v);
  }
  return { hard, soft };
}

/**
 * Verze přilepená k názvu rodiny — `qwen3.5` → 3.5, `phi-4` → 4, `glm-5.1` → 5.1,
 * `llama 3.1` → 3.1, `gemma 2` → 2.
 *
 * Bere se pouze číslo bezprostředně za názvem rodiny (volitelně oddělené
 * mezerou, spojovníkem nebo `v`).  Číslo stojící až za dalším slovem
 * (`devstral small 2`) se za verzi rodiny nepovažuje — bez toho by se
 * `mistral large 2` tvářilo jako druhá generace Mistralu.
 */
function extractFamilyVersion(lower, family) {
  const match = lower.match(new RegExp(`^${family}[\\s-]*v?(\\d+(?:\\.\\d+)?)(?![0-9]*b\\b)`));
  return match ? match[1] : null;
}

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

  const version = extractFamilyVersion(lower, family);
  const { hard, soft } = extractVariants(lower);

  return { family, version, params, hard, soft };
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

  // Velikost bývá v tagu (`qwen3.5:27b`), ale u implicitně otagovaných modelů
  // je v základu jména a tag je `latest` (`deepseek-r1-32b:latest`,
  // `qwen3-30b-a3b:latest`).  Bez druhého pokusu vyjde params null a model se
  // nedá spárovat vůbec.
  let params = null;
  const tagParams = (tag || '').match(/^(\d+(?:\.\d+)?)b\b/);
  if (tagParams) {
    params = parseFloat(tagParams[1]);
  } else {
    const baseParams = base.match(/[-_](\d+(?:\.\d+)?)b(?:[-_]|$)/);
    if (baseParams) params = parseFloat(baseParams[1]);
  }

  // Extract family — strip version numbers and suffixes
  // "qwen2.5" → "qwen", "llama3.1" → "llama", "deepseek-r1" → "deepseek"
  const familyMatch = base.match(/^([a-z]+)/);
  if (!familyMatch) return null;
  const family = familyMatch[1];

  const version = extractFamilyVersion(base, family);
  const { hard, soft } = extractVariants(base);

  return { family, version, params, hard, soft };
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
function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function setDistance(a, b) {
  let d = 0;
  for (const v of a) if (!b.has(v)) d++;
  for (const v of b) if (!a.has(v)) d++;
  return d;
}

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

    const viable = [];
    for (const wm of parsed) {
      const w = wm._parsed;

      // Rodina musí sedět přesně.
      if (w.family !== cParsed.family) continue;

      // Generace musí sedět, známe-li ji na obou stranách.  Bez této podmínky
      // se `qwen2.5:32b` spároval s `Qwen3 32B` a `qwen3.5:27b` s `Qwen3.6 27B`
      // — tedy s jinou generací, a scoring dostal cizí čísla s jistotou 0.85.
      if (w.version != null && cParsed.version != null && w.version !== cParsed.version) continue;

      // Specializace musí sedět: coder model není zaměnitelný za obecný ani za
      // Omni. Kvůli tomu se `qwen3-coder:30b` párovalo s `Qwen3 Omni 30B A3B`.
      if (!sameSet(w.hard, cParsed.hard)) continue;

      // Velikost musí sedět do 10 %, známe-li ji na obou stranách.  Když ji
      // jedna strana neuvádí (`Devstral Small 2`), rozhodne rodina, generace
      // a specializace.
      let paramDelta = null;
      if (w.params != null && cParsed.params != null) {
        const delta = Math.abs(w.params - cParsed.params);
        if (delta / Math.max(w.params, cParsed.params) > 0.10) continue;
        paramDelta = delta;
      }

      // Sama shoda rodiny nestačí — rodiny jako `deepseek` mají v žebříčku
      // desítky položek od 7B distilů po frontier modely.  Bez tohohle
      // požadavku se `deepseek-r1-32b` spároval s `DeepSeek V4 Pro` (q=53.2).
      // Rozlišovacím znakem je porovnatelná velikost, porovnatelná generace,
      // nebo přesná shoda měkkých variant (`devstral-small-2` ↔
      // `Devstral Small 2`, kde velikost ani generace v názvu nejsou).
      //
      // Shoda dvou prázdných množin variant se za rozlišovací znak nepočítá —
      // „obojí bez přívlastku“ neříká nic a `claude:latest` by se spároval s
      // libovolným modelem téže rodiny.
      const hasDiscriminator = paramDelta != null
        || (w.version != null && cParsed.version != null)
        || (w.soft.size > 0 && sameSet(w.soft, cParsed.soft));
      if (!hasDiscriminator) continue;

      viable.push({
        wm,
        paramDelta: paramDelta ?? Number.MAX_SAFE_INTEGER,
        softDistance: setDistance(w.soft, cParsed.soft),
      });
    }

    if (viable.length === 0) continue;

    viable.sort((a, b) =>
      a.paramDelta - b.paramDelta
      || a.softDistance - b.softDistance
      || (b.wm.qualityIndex - a.wm.qualityIndex));

    // Dva stejně dobré zásahy s výrazně odlišnou kvalitou znamenají, že název
    // na rozlišení nestačí.  Radši žádná data než tiše vybraná půlka.
    const [best, second] = viable;
    if (second
      && second.paramDelta === best.paramDelta
      && second.softDistance === best.softDistance) {
      const spread = Math.abs(best.wm.qualityIndex - second.wm.qualityIndex);
      const scale = Math.max(best.wm.qualityIndex, second.wm.qualityIndex, 1);
      if (spread / scale > 0.15) {
        logger.warn('WhatLLM',
          `${candidate.name}: nejednoznačná shoda (${best.wm.name} q=${best.wm.qualityIndex} vs ${second.wm.name} q=${second.wm.qualityIndex}) — přeskakuji`);
        continue;
      }
    }

    matches.set(candidate.name, best.wm);
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
    const res = await outboundFetch(WHATLLM_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'Accept': 'text/html' },
    }, MODEL_DISCOVERY_OUTBOUND_AUTHORITY);

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
/** Průměr neprázdných benchmarků katalogové položky. */
function catalogBenchmarkAverage(entry) {
  const values = Object.values(entry?.benchmarks || {}).filter(v => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Hodnota v zadaném percentilu seřazeného pole (lineární interpolace). */
function quantile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Sestaví převod z whatllm `qualityIndex` na stupnici katalogových benchmarků.
 *
 * Obě čísla jsou „kvalita modelu“, ale měří ji v jiném režimu obtížnosti:
 * whatllm skládá index z frontier sad (GPQA Diamond, AIME, SWE-Bench Verified),
 * kde lokální 14B model dostane ~5 ze 100, zatímco katalog nese klasické sady
 * (HumanEval, MMLU), kde tentýž model dá 0.6–0.8.  Na modelech, které jsou v
 * obou zdrojích, spolu ty hodnoty prakticky nekorelují — lineární přepočet by
 * proto fitoval šum.
 *
 * Dělení globálním maximem (původní chování) posunulo každý whatllm model o
 * polovinu dolů proti katalogovým, takže scoring trestal právě ty modely, které
 * whatllm náhodou zná.  Místo toho se zachová jen **pořadí**: percentil modelu
 * v rozdělení whatllm se přeloží na tentýž percentil rozdělení katalogu.
 * Výsledek je s katalogem souměřitelný z konstrukce, aniž by se předstíral
 * vztah mezi absolutními hodnotami.
 *
 * @returns {(qualityIndex: number) => number|null}
 */
export async function buildScaleCalibration(whatllmModels, catalogOverride) {
  let catalog = catalogOverride;
  if (!catalog) {
    try {
      const mod = await import('./model-catalog.js');
      catalog = mod.CATALOG || mod.default?.CATALOG;
    } catch { catalog = null; }
  }

  const catalogScores = (catalog || [])
    .map(catalogBenchmarkAverage)
    .filter(v => v != null)
    .sort((a, b) => a - b);

  const whatllmScores = (whatllmModels || [])
    .map(m => m.qualityIndex)
    .filter(v => v != null && v > 0)
    .sort((a, b) => a - b);

  // Bez obou rozdělení nelze převádět; raději nic než nesouměřitelné číslo.
  if (catalogScores.length < 2 || whatllmScores.length < 2) {
    logger.warn('WhatLLM', 'Kalibrace stupnice není k dispozici — enrichment přeskočen');
    return () => null;
  }

  return (qualityIndex) => {
    if (qualityIndex == null || qualityIndex <= 0) return null;
    let below = 0;
    for (const v of whatllmScores) {
      if (v < qualityIndex) below++; else break;
    }
    const percentile = below / (whatllmScores.length - 1);
    const mapped = quantile(catalogScores, percentile);
    return mapped == null ? null : Math.max(0, Math.min(1, mapped));
  };
}

export async function enrichCandidates(candidates, opts = {}) {
  const whatllmModels = opts.whatllmModels || await fetchModels();
  if (!whatllmModels || whatllmModels.length === 0) {
    return { enriched: 0, total: candidates.length };
  }

  const matches = matchModels(whatllmModels, candidates);
  let enriched = 0;

  const calibration = await buildScaleCalibration(whatllmModels, opts.catalog);

  for (const candidate of candidates) {
    // Skip models that already have high-confidence benchmarks (catalog, manually set)
    if ((candidate.benchmarkConfidence ?? 1.0) >= WHATLLM_CONFIDENCE) continue;

    const whatllm = matches.get(candidate.name);
    if (!whatllm || !whatllm.qualityIndex) continue;

    // Převod na škálu katalogu (viz buildScaleCalibration).  Dřív se dělilo
    // globálním maximem, což míchalo dvě nesouměřitelné stupnice.
    const rawScore = calibration(whatllm.qualityIndex);
    if (rawScore == null) continue;

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
