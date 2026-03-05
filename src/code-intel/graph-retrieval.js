// Graph-Based Retrieval v1 — Enrich search results with structural relationships
// ══════════════════════════════════════════════════════════════════════════════
//
// Uses KnowledgeGraph edges to discover related files that grep/keyword
// search would miss:
//   - BFS expansion from ranked files (IMPORTS/CALLS edges + reverse IMPORTS)
//   - Dependency context for LLM prompt enrichment
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileNodeId, EdgeType } from './knowledge-graph.js';

// ─── Graph Expansion ────────────────────────────────────────────────────────

/**
 * Expand ranked search results with structurally related files from the graph.
 *
 * BFS from top N ranked files, following IMPORTS/CALLS edges + reverse IMPORTS.
 * Score decay: depth 1 = parent × 0.8, depth 2 = parent × 0.4.
 *
 * @param {Array<{file: string, score: number}>} rankedFiles
 * @param {KnowledgeGraph} graph
 * @param {Object} [opts]
 * @param {number} [opts.topN=5] - Number of top ranked files to seed BFS from
 * @param {number} [opts.maxDepth=2] - BFS depth limit
 * @param {number} [opts.maxExpansion=5] - Max new files to add
 * @param {number} [opts.minScore=0.05] - Minimum score threshold
 * @returns {Array<{file: string, score: number, source: string}>}
 */
export function expandWithGraph(rankedFiles, graph, opts = {}) {
  if (!rankedFiles || rankedFiles.length === 0) return [];
  if (!graph || graph._nodes.size === 0) return [];

  const topN = opts.topN || 5;
  const maxDepth = opts.maxDepth || 2;
  const maxExpansion = opts.maxExpansion || 5;
  const minScore = opts.minScore || 0.05;

  const existingFiles = new Set(rankedFiles.map(r => r.file));
  const discovered = new Map(); // file → best score
  const visited = new Set();    // BFS cycle guard
  const MAX_VISITED = 500;      // Hard limit for extreme graphs

  const seeds = rankedFiles.slice(0, topN);

  for (const seed of seeds) {
    const fid = fileNodeId(seed.file);
    if (!graph.getNode(fid)) continue;

    // BFS from this seed
    const queue = [{ nodeId: fid, depth: 0, score: seed.score }];
    visited.add(fid);

    while (queue.length > 0 && visited.size < MAX_VISITED) {
      const { nodeId, depth, score } = queue.shift();

      if (depth >= maxDepth) continue;

      const nextDepth = depth + 1;
      const decay = nextDepth === 1 ? 0.8 : 0.4;
      const nextScore = score * decay;

      if (nextScore < minScore) continue;

      // Follow IMPORTS and CALLS edges (outgoing)
      const outgoing = [
        ...graph.getEdges(nodeId, EdgeType.IMPORTS),
        ...graph.getEdges(nodeId, EdgeType.CALLS),
      ];

      for (const { target } of outgoing) {
        if (visited.has(target) || visited.size >= MAX_VISITED) continue;
        visited.add(target);

        const targetNode = graph.getNode(target);
        if (targetNode && targetNode.type === 'file' && targetNode.file) {
          if (!existingFiles.has(targetNode.file)) {
            const existing = discovered.get(targetNode.file) || 0;
            if (nextScore > existing) discovered.set(targetNode.file, nextScore);
          }
        }

        queue.push({ nodeId: target, depth: nextDepth, score: nextScore });
      }

      // Follow reverse IMPORTS (dependents — who imports this file?)
      const incoming = graph.getIncoming(nodeId, EdgeType.IMPORTS);
      for (const { source } of incoming) {
        if (visited.has(source) || visited.size >= MAX_VISITED) continue;
        visited.add(source);

        const sourceNode = graph.getNode(source);
        if (sourceNode && sourceNode.type === 'file' && sourceNode.file) {
          if (!existingFiles.has(sourceNode.file)) {
            const existing = discovered.get(sourceNode.file) || 0;
            if (nextScore > existing) discovered.set(sourceNode.file, nextScore);
          }
        }

        queue.push({ nodeId: source, depth: nextDepth, score: nextScore });
      }
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

export default { expandWithGraph, buildDependencyContext, mergeAndResort };
