// Graph-Based Retrieval v2 — Enrich search results with structural relationships
// ══════════════════════════════════════════════════════════════════════════════
//
// Uses KnowledgeGraph edges to discover related files that grep/keyword
// search would miss:
//   - Priority BFS from ranked files (MaxHeap + edge weights + depthDecay)
//   - Hub penalty: high-degree nodes (utils, config, types) get lower scores
//   - Namespace boost: same-module files get higher scores
//   - Dependency context for LLM prompt enrichment
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileNodeId, EdgeType } from './knowledge-graph.js';

// ─── Edge Weights ───────────────────────────────────────────────────────────

export const EDGE_WEIGHT = Object.freeze({
  [EdgeType.CALLS]: 2.0,
  [EdgeType.IMPORTS]: 1.0,
  [EdgeType.REFERENCES]: 0.5,
  [EdgeType.EXTENDS]: 1.5,
  [EdgeType.IMPLEMENTS]: 1.5,
  [EdgeType.TESTED_BY]: 0.3,
  [EdgeType.DEFINES]: 0.8,
  [EdgeType.BELONGS_TO]: 0.3,
});

// ─── Hub Penalty ─────────────────────────────────────────────────────────────

const HUB_DEGREE_THRESHOLD = 15;

/**
 * Compute hub penalty for a node based on its degree (in + out edges).
 * Nodes with degree <= threshold get no penalty (1.0).
 * High-degree hubs (utils, config, types) get penalized to prevent
 * them from dominating retrieval results.
 *
 * @param {KnowledgeGraph} graph
 * @param {string} nodeId
 * @returns {number} penalty factor in [0.1, 1.0]
 */
export function computeHubPenalty(graph, nodeId) {
  const out = graph._adjacency.get(nodeId)?.length || 0;
  const inp = graph._reverse.get(nodeId)?.length || 0;
  const degree = out + inp;
  if (degree <= HUB_DEGREE_THRESHOLD) return 1.0;
  return Math.max(0.1, 1 / Math.log2(2 + degree));
}

// ─── Namespace Boost ─────────────────────────────────────────────────────────

function _moduleForFile(relPath) {
  const parts = relPath.split('/');
  return parts.length >= 2 ? parts.slice(0, 2).join('/') : null;
}

/**
 * Boost score for files in the same module as the query seeds.
 * Same module = first 2 path segments match (e.g. "src/auth").
 *
 * @param {Set<string>} seedModules - Modules of seed files
 * @param {string|null} targetFile - File path of target node
 * @returns {number} boost factor (1.5 for same module, 1.0 otherwise)
 */
export function computeNamespaceBoost(seedModules, targetFile) {
  if (!targetFile || !seedModules || seedModules.size === 0) return 1.0;
  const targetMod = _moduleForFile(targetFile);
  if (targetMod && seedModules.has(targetMod)) return 1.5;
  return 1.0;
}

// ─── MaxHeap (priority queue) ───────────────────────────────────────────────

export class MaxHeap {
  constructor() { this._data = []; }

  get size() { return this._data.length; }

  push(item) {
    this._data.push(item);
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    if (this._data.length === 0) return null;
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[i].score <= this._data[parent].score) break;
      [this._data[i], this._data[parent]] = [this._data[parent], this._data[i]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._data.length;
    while (true) {
      let largest = i;
      const left = 2 * i + 1, right = 2 * i + 2;
      if (left < n && this._data[left].score > this._data[largest].score) largest = left;
      if (right < n && this._data[right].score > this._data[largest].score) largest = right;
      if (largest === i) break;
      [this._data[i], this._data[largest]] = [this._data[largest], this._data[i]];
      i = largest;
    }
  }
}

// ─── Graph Expansion (Priority BFS) ─────────────────────────────────────────

/**
 * Expand ranked search results with structurally related files from the graph.
 *
 * Priority BFS from top N ranked files using MaxHeap + edge weights.
 * Score = parentScore × edgeWeight × depthDecay × hubPenalty × namespaceBoost.
 *
 * @param {Array<{file: string, score: number}>} rankedFiles
 * @param {KnowledgeGraph} graph
 * @param {Object} [opts]
 * @param {number} [opts.topN=5] - Number of top ranked files to seed from
 * @param {number} [opts.maxDepth=3] - Hard depth limit
 * @param {number} [opts.maxExpansion=5] - Max new files to add
 * @param {number} [opts.minScore=0.05] - Minimum score threshold (dynamic cutoff)
 * @param {number} [opts.depthDecay=0.7] - Score decay per depth level
 * @param {number} [opts.maxVisited] - Hard visited limit (default 500)
 * @returns {Array<{file: string, score: number, source: string}>}
 */
export function expandWithGraph(rankedFiles, graph, opts = {}) {
  if (!rankedFiles || rankedFiles.length === 0) return [];
  if (!graph || graph._nodes.size === 0) return [];

  const topN = opts.topN || 5;
  const maxDepth = opts.maxDepth ?? 3;
  const maxExpansion = opts.maxExpansion || 5;
  const minScore = opts.minScore || 0.05;
  const depthDecay = opts.depthDecay ?? 0.7;
  const MAX_VISITED = opts.maxVisited ?? 500;

  const existingFiles = new Set(rankedFiles.map(r => r.file));
  const discovered = new Map(); // file → best score
  const visited = new Set();    // BFS cycle guard
  const heap = new MaxHeap();

  // Seed top-N files into the heap + compute seed modules for namespace boost
  const seeds = rankedFiles.slice(0, topN);
  const seedModules = new Set();
  for (const seed of seeds) {
    const fid = fileNodeId(seed.file);
    if (!graph.getNode(fid)) continue;
    heap.push({ nodeId: fid, depth: 0, score: seed.score });
    visited.add(fid);
    const mod = _moduleForFile(seed.file);
    if (mod) seedModules.add(mod);
  }

  while (heap.size > 0 && visited.size < MAX_VISITED) {
    const { nodeId, depth, score } = heap.pop();

    // Dynamic cutoff: heap is max-ordered, so if top is below threshold, done
    if (score < minScore) break;
    if (depth >= maxDepth) continue;

    const nextDepth = depth + 1;

    // Follow IMPORTS and CALLS edges (outgoing)
    const outgoing = [
      ...graph.getEdges(nodeId, EdgeType.IMPORTS),
      ...graph.getEdges(nodeId, EdgeType.CALLS),
    ];

    for (const { edge, target } of outgoing) {
      if (visited.has(target) || visited.size >= MAX_VISITED) continue;
      visited.add(target);

      const edgeWeight = EDGE_WEIGHT[edge?.type] ?? 1.0;
      const hubPen = computeHubPenalty(graph, target);
      const targetNode = graph.getNode(target);
      const nsBst = computeNamespaceBoost(seedModules, targetNode?.file);
      const nextScore = score * edgeWeight * depthDecay * hubPen * nsBst;

      if (nextScore < minScore) continue;

      if (targetNode && targetNode.type === 'file' && targetNode.file) {
        if (!existingFiles.has(targetNode.file)) {
          const existing = discovered.get(targetNode.file) || 0;
          if (nextScore > existing) discovered.set(targetNode.file, nextScore);
        }
      }

      heap.push({ nodeId: target, depth: nextDepth, score: nextScore });
    }

    // Follow reverse IMPORTS (dependents — who imports this file?)
    const incoming = graph.getIncoming(nodeId, EdgeType.IMPORTS);
    for (const { edge, source } of incoming) {
      if (visited.has(source) || visited.size >= MAX_VISITED) continue;
      visited.add(source);

      const edgeWeight = EDGE_WEIGHT[edge?.type] ?? 1.0;
      const hubPen = computeHubPenalty(graph, source);
      const sourceNode = graph.getNode(source);
      const nsBst = computeNamespaceBoost(seedModules, sourceNode?.file);
      const nextScore = score * edgeWeight * depthDecay * hubPen * nsBst;

      if (nextScore < minScore) continue;

      if (sourceNode && sourceNode.type === 'file' && sourceNode.file) {
        if (!existingFiles.has(sourceNode.file)) {
          const existing = discovered.get(sourceNode.file) || 0;
          if (nextScore > existing) discovered.set(sourceNode.file, nextScore);
        }
      }

      heap.push({ nodeId: source, depth: nextDepth, score: nextScore });
    }
  }

  // Sort by score, cap at maxExpansion
  return [...discovered.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxExpansion)
    .map(([file, score]) => ({ file, score, source: 'graph' }));
}

// ─── Dependency Context ─────────────────────────────────────────────────────

/**
 * Build a markdown dependency context string for a file.
 *
 * @param {string} relPath
 * @param {KnowledgeGraph} graph
 * @returns {string}
 */
export function buildDependencyContext(relPath, graph) {
  if (!graph || graph._nodes.size === 0) return '';

  const fid = fileNodeId(relPath);
  if (!graph.getNode(fid)) return '';

  const parts = [`**${relPath}**`];

  // Imports
  const deps = graph.getDependencies(relPath);
  if (deps.length > 0) {
    const names = deps.slice(0, 8).map(d => d.name || d.id);
    parts.push(`imports: ${names.join(', ')}`);
  }

  // Imported by
  const dependents = graph.getDependents(relPath);
  if (dependents.length > 0) {
    const names = dependents.slice(0, 8).map(d => d.name || d.id);
    parts.push(`imported by: ${names.join(', ')}`);
  }

  // Defines
  const symbols = graph.getFileSymbols(relPath);
  if (symbols.length > 0) {
    const names = symbols.slice(0, 10).map(s => s.name);
    parts.push(`defines: ${names.join(', ')}`);
  }

  const result = parts.join(' | ');
  // Cap at ~500 chars
  return result.length > 500 ? result.substring(0, 497) + '...' : result;
}

// ─── Merge ──────────────────────────────────────────────────────────────────

/**
 * Merge graph-discovered files into existing ranked files and re-sort.
 * If a file exists in both, uses max(existingScore, graphScore).
 *
 * @param {Array<{file: string, score: number}>} existingRanked
 * @param {Array<{file: string, score: number, source: string}>} graphFiles
 * @returns {Array<{file: string, score: number, source?: string}>}
 */
export function mergeAndResort(existingRanked, graphFiles) {
  const merged = new Map();

  // Add existing
  for (const item of existingRanked) {
    merged.set(item.file, { ...item });
  }

  // Add/merge graph files
  for (const item of graphFiles) {
    const existing = merged.get(item.file);
    if (existing) {
      // Use max score, don't overwrite
      if (item.score > existing.score) {
        existing.score = item.score;
        existing.source = 'graph';
      }
    } else {
      merged.set(item.file, { ...item });
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score);
}

export default { expandWithGraph, buildDependencyContext, mergeAndResort, computeHubPenalty, computeNamespaceBoost };
