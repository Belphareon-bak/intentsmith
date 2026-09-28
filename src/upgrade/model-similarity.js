// Model Similarity Engine v138 — cold-start priors for unknown models
// ══════════════════════════════════════════════════════════════════════════════
//
// Fallback chain:
//   1) same_family
//   2) params
//   3) architecture
//   4) baseline
//
// Produces weighted prior benchmarks/capabilities/category/context for models
// without direct catalog entries.

import { parseModelName } from './model-profiles.js';

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function toFiniteNumber(value) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeFamily(value, name = '') {
  if (value) return String(value).trim().toLowerCase();
  const parsed = parseModelName(name || '');
  return parsed.family || 'unknown';
}

function normalizeContext(value) {
  const n = toFiniteNumber(value);
  if (n == null || n <= 0) return null;
  return Math.round(n);
}

function normalizeModality(entry = {}) {
  const raw = String(entry.modality || '').trim().toLowerCase();
  if (raw) return raw;
  const caps = Array.isArray(entry.capabilities) ? entry.capabilities.map(x => String(x).toLowerCase()) : [];
  if (caps.some(c => c.includes('vision') || c.includes('image'))) return 'vision';
  if (caps.some(c => c.includes('audio') || c.includes('speech'))) return 'audio';
  const category = String(entry.category || '').toLowerCase();
  if (category === 'vision') return 'vision';
  return 'text';
}

function normalizeArchitecture(value, fallbackFamily = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('moe') || raw.includes('mixture')) return 'moe';
  if (raw.includes('transformer') || raw.includes('decoder')) return 'transformer';
  if (raw.includes('mamba') || raw.includes('rwkv') || raw.includes('rnn')) return 'state-space';

  const family = String(fallbackFamily || '').toLowerCase();
  if (family.includes('mixtral')) return 'moe';
  if (family.includes('qwen') || family.includes('llama') || family.includes('gemma') || family.includes('mistral') || family.includes('deepseek')) {
    return 'transformer';
  }
  return 'unknown';
}

function normalizeCategory(value, modality = 'text') {
  const v = String(value || '').trim().toLowerCase();
  if (v) return v;
  if (modality === 'vision') return 'vision';
  return 'general';
}

function safeBenchmarks(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  let any = false;
  for (const [k, v] of Object.entries(value)) {
    const n = toFiniteNumber(v);
    if (n == null) continue;
    out[k] = clamp01(n);
    any = true;
  }
  return any ? out : null;
}

function canonicalModel(entry = {}) {
  const parsed = parseModelName(entry.name || '');
  const family = normalizeFamily(entry.family, entry.name);
  const modality = normalizeModality(entry);
  return {
    name: entry.name || '',
    family,
    params: toFiniteNumber(entry.params),
    contextWindow: normalizeContext(entry.contextWindow ?? entry.context_length),
    quantization: entry.quantization || null,
    architecture: normalizeArchitecture(entry.architecture, family || parsed.family),
    modality,
    category: normalizeCategory(entry.category, modality),
    capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : null,
    benchmarks: safeBenchmarks(entry.benchmarks),
    benchmarkConfidence: clamp01(toFiniteNumber(entry.benchmarkConfidence) ?? 1),
    source: entry.source || 'unknown',
  };
}

function paramsSimilarity(a, b) {
  if (!a || !b || a <= 0 || b <= 0) return 0.5;
  return Math.exp(-Math.abs(Math.log((a + 1) / (b + 1))));
}

function contextSimilarity(a, b) {
  if (!a || !b || a <= 0 || b <= 0) return 0.5;
  return Math.exp(-Math.abs(Math.log((a + 1) / (b + 1))));
}

function modalitySimilarity(a, b) {
  if (!a || !b) return 0.55;
  if (a === b) return 1.0;
  return 0.25;
}

function architectureSimilarity(a, b) {
  if (!a || !b || a === 'unknown' || b === 'unknown') return 0.6;
  if (a === b) return 1.0;
  if ((a === 'moe' && b === 'transformer') || (a === 'transformer' && b === 'moe')) return 0.75;
  return 0.25;
}

export function computeModelSimilarity(target, candidate) {
  const t = canonicalModel(target);
  const c = canonicalModel(candidate);

  const base =
    paramsSimilarity(t.params, c.params) * 0.45 +
    contextSimilarity(t.contextWindow, c.contextWindow) * 0.20 +
    modalitySimilarity(t.modality, c.modality) * 0.20 +
    architectureSimilarity(t.architecture, c.architecture) * 0.15;

  const familyBoost = (t.family && c.family && t.family === c.family && t.family !== 'unknown') ? 0.2 : 0;
  return clamp01(base + familyBoost);
}

function weightedVote(items, pickValue, pickWeight) {
  const tally = new Map();
  for (const item of items) {
    const value = pickValue(item);
    const weight = pickWeight(item);
    if (!value || !Number.isFinite(weight) || weight <= 0) continue;
    tally.set(value, (tally.get(value) || 0) + weight);
  }
  if (tally.size === 0) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function aggregateBenchmarks(neighbors) {
  const keys = new Set();
  for (const n of neighbors) {
    if (!n.model.benchmarks) continue;
    for (const k of Object.keys(n.model.benchmarks)) keys.add(k);
  }
  const out = {};
  let any = false;
  for (const key of keys) {
    let weighted = 0;
    let weightSum = 0;
    for (const n of neighbors) {
      const value = n.model.benchmarks?.[key];
      if (!Number.isFinite(value)) continue;
      const weight = Math.max(0.001, n.weight);
      weighted += value * weight;
      weightSum += weight;
    }
    if (weightSum <= 0) continue;
    out[key] = clamp01(weighted / weightSum);
    any = true;
  }
  return any ? out : null;
}

function aggregateCapabilities(neighbors) {
  const tally = new Map();
  let totalWeight = 0;
  for (const n of neighbors) {
    const caps = Array.isArray(n.model.capabilities) ? n.model.capabilities : [];
    const weight = Math.max(0.001, n.weight);
    totalWeight += weight;
    for (const cap of caps) {
      tally.set(cap, (tally.get(cap) || 0) + weight);
    }
  }
  if (totalWeight <= 0 || tally.size === 0) return null;
  const out = [...tally.entries()]
    .filter(([, w]) => (w / totalWeight) >= 0.40)
    .sort((a, b) => b[1] - a[1])
    .map(([cap]) => cap);
  return out.length > 0 ? out : null;
}

function aggregateContextWindow(neighbors) {
  let weighted = 0;
  let weightSum = 0;
  for (const n of neighbors) {
    const v = n.model.contextWindow;
    if (!Number.isFinite(v) || v <= 0) continue;
    const w = Math.max(0.001, n.weight);
    weighted += v * w;
    weightSum += w;
  }
  if (weightSum <= 0) return null;
  return Math.max(1024, Math.round(weighted / weightSum));
}

function baseConfidenceByStrategy(strategy) {
  switch (strategy) {
    case 'same_family': return 0.62;
    case 'params': return 0.48;
    case 'architecture': return 0.40;
    case 'baseline': return 0.30;
    default: return 0.25;
  }
}

function finalizePrior(strategy, target, selected) {
  const neighbors = selected.map(item => ({
    name: item.model.name,
    source: item.model.source,
    similarity: Number(item.similarity.toFixed(4)),
  }));
  const avgSimilarity = selected.reduce((s, x) => s + x.similarity, 0) / Math.max(1, selected.length);

  const benchmarks = aggregateBenchmarks(selected);
  const category = weightedVote(selected, x => x.model.category, x => x.weight) || target.category;
  const capabilities = aggregateCapabilities(selected);
  const contextWindow = aggregateContextWindow(selected) ?? target.contextWindow ?? null;
  const architecture = weightedVote(selected, x => x.model.architecture, x => x.weight) || target.architecture;

  const supportBoost = Math.min(0.15, selected.length * 0.05);
  const similarityBoost = clamp01(avgSimilarity) * 0.20;
  const benchmarkConfidence = clamp01(baseConfidenceByStrategy(strategy) + supportBoost + similarityBoost);

  return {
    strategy,
    neighbors,
    similarityScore: Number(avgSimilarity.toFixed(4)),
    benchmarks,
    benchmarkConfidence: Number(benchmarkConfidence.toFixed(4)),
    category,
    capabilities,
    contextWindow,
    architecture,
  };
}

function selectByStrategy(strategy, target, pool, topK, minSimilarity) {
  const candidates = [];
  for (const raw of pool) {
    const c = canonicalModel(raw);
    if (!c.name || c.name === target.name) continue;
    if (!c.benchmarks) continue;

    if (strategy === 'same_family') {
      if (!target.family || target.family === 'unknown' || c.family !== target.family) continue;
    } else if (strategy === 'params') {
      if (!Number.isFinite(target.params) || target.params <= 0) continue;
      if (!Number.isFinite(c.params) || c.params <= 0) continue;
    } else if (strategy === 'architecture') {
      if (!target.architecture || target.architecture === 'unknown') continue;
      if (!c.architecture || c.architecture === 'unknown') continue;
      if (c.architecture !== target.architecture) continue;
    }

    const similarity = computeModelSimilarity(target, c);
    if (similarity < minSimilarity) continue;
    const weight = similarity * (c.benchmarkConfidence || 1);
    candidates.push({ model: c, similarity, weight });
  }

  candidates.sort((a, b) => b.weight - a.weight || b.similarity - a.similarity);
  return candidates.slice(0, topK);
}

/**
 * Estimate prior data for an unknown model from known neighbors.
 *
 * @param {Object} targetModel
 * @param {Array<Object>} neighborPool
 * @param {Object} [opts]
 * @param {number} [opts.topK=3]
 * @returns {Object|null}
 */
export function estimateModelPrior(targetModel, neighborPool, opts = {}) {
  if (!Array.isArray(neighborPool) || neighborPool.length === 0) return null;
  const target = canonicalModel(targetModel || {});
  const topK = Math.max(1, Math.min(6, Number.parseInt(String(opts.topK ?? 3), 10) || 3));

  const strategies = [
    { name: 'same_family', minSimilarity: 0.35 },
    { name: 'params', minSimilarity: 0.30 },
    { name: 'architecture', minSimilarity: 0.30 },
    { name: 'baseline', minSimilarity: 0.0 },
  ];

  for (const s of strategies) {
    const selected = selectByStrategy(s.name, target, neighborPool, topK, s.minSimilarity);
    if (selected.length === 0) continue;
    return finalizePrior(s.name, target, selected);
  }
  return null;
}

export default {
  computeModelSimilarity,
  estimateModelPrior,
};
