// Graph Query v109 (F7) — Structured graph debugging queries
// ══════════════════════════════════════════════════════════════════════════════
//
// Developer-facing API for inspecting C3's knowledge graph decisions:
//   - Path queries: Why does A affect B?
//   - Impact radius: What files are affected by changes to X?
//   - Cycle detection: Are there circular dependencies?
//   - Centrality metrics: How central is this file?
//   - Context explanation: Why were these files selected?
//   - Mermaid export: Visual debugging
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileNodeId, EdgeType } from './knowledge-graph.js';
import { computeHubPenalty } from './graph-retrieval.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_BFS_NODES = 500;
const MAX_CYCLES = 20;

// ─── getImpactRadius ────────────────────────────────────────────────────────

/**
 * Get all nodes within N hops of a starting node.
 * Follows both outgoing and incoming edges.
 *
 * @param {KnowledgeGraph} graph
 * @param {string} nodeId - Starting node (file path or full node ID)
 * @param {number} [depth=2] - Max hops
 * @returns {{nodes: Array<{id, type, name, depth}>, edges: Array<{from, to, type}>}}
 */
export function getImpactRadius(graph, nodeId, depth = 2) {
  const startId = nodeId.startsWith('file:') ? nodeId : fileNodeId(nodeId);
  const startNode = graph.getNode(startId);
  if (!startNode) return { nodes: [], edges: [] };

  const visited = new Map(); // nodeId → depth
  const edges = [];
  const queue = [{ id: startId, d: 0 }];
  visited.set(startId, 0);

  while (queue.length > 0 && visited.size < MAX_BFS_NODES) {
    const { id, d } = queue.shift();
    if (d >= depth) continue;

    // Outgoing edges
    const outEdges = graph.getEdges(id);
    for (const { edge, target } of outEdges) {
      if (!visited.has(target)) {
        visited.set(target, d + 1);
        queue.push({ id: target, d: d + 1 });
      }
      edges.push({ from: id, to: target, type: edge.type });
    }

    // Incoming edges
    const inEdges = graph.getIncoming(id);
    for (const { edge, source } of inEdges) {
      if (!visited.has(source)) {
        visited.set(source, d + 1);
        queue.push({ id: source, d: d + 1 });
      }
      edges.push({ from: source, to: id, type: edge.type });
    }
  }

  const nodes = [];
  for (const [id, d] of visited) {
    const node = graph.getNode(id);
    if (node) {
      nodes.push({ id, type: node.type, name: node.name || id, depth: d });
    }
  }

  // Deduplicate edges
  const edgeSet = new Set();
  const uniqueEdges = edges.filter(e => {
    const key = `${e.from}|${e.to}|${e.type}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return { nodes, edges: uniqueEdges };
}

// ─── detectCycles ───────────────────────────────────────────────────────────

/**
 * Detect circular dependencies in the import graph.
 * Uses DFS with coloring (WHITE/GRAY/BLACK).
 *
 * @param {KnowledgeGraph} graph
 * @param {Object} [opts] - {edgeType?: EdgeType.IMPORTS, maxCycles?: 20}
 * @returns {Array<{cycle: string[], length: number}>}
 */
export function detectCycles(graph, opts = {}) {
  const edgeType = opts.edgeType ?? EdgeType.IMPORTS;
  const maxCycles = opts.maxCycles ?? MAX_CYCLES;

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();
  const cycles = [];

  // Get all file nodes
  const stats = graph.getStats();
  const fileNodes = [];
  for (const [id, node] of graph._nodes || new Map()) {
    if (node.type === 'file') fileNodes.push(id);
  }

  // If _nodes not accessible, try iterating via stats
  if (fileNodes.length === 0 && stats.nodesByType?.file) {
    return []; // Can't iterate, return empty
  }

  function dfs(nodeId) {
    if (cycles.length >= maxCycles) return;
    color.set(nodeId, GRAY);

    const edges = graph.getEdges(nodeId, edgeType);
    for (const { target } of edges) {
      if (cycles.length >= maxCycles) return;

      const c = color.get(target) ?? WHITE;
      if (c === GRAY) {
        // Back edge found — extract cycle
        const cycle = [target];
        let cur = nodeId;
        while (cur !== target && parent.has(cur)) {
          cycle.push(cur);
          cur = parent.get(cur);
        }
        cycle.push(target);
        cycle.reverse();

        // Normalize: start from smallest element
        const minIdx = cycle.indexOf(cycle.slice().sort()[0]);
        const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
        // Close the cycle
        if (normalized[normalized.length - 1] !== normalized[0]) {
          normalized.push(normalized[0]);
        }

        const key = normalized.join('→');
        if (!cycles.some(c => c.key === key)) {
          cycles.push({ cycle: normalized, length: normalized.length - 1, key });
        }
      } else if (c === WHITE) {
        parent.set(target, nodeId);
        dfs(target);
      }
    }

    color.set(nodeId, BLACK);
  }

  for (const nodeId of fileNodes) {
    if ((color.get(nodeId) ?? WHITE) === WHITE) {
      dfs(nodeId);
    }
  }

  return cycles.map(({ cycle, length }) => ({ cycle, length }));
}

// ─── computeMetrics ─────────────────────────────────────────────────────────

/**
 * Compute centrality metrics for a node.
 *
 * @param {KnowledgeGraph} graph
 * @param {string} nodeId - File path or full node ID
 * @returns {{fanIn: number, fanOut: number, degree: number, hubPenalty: number, dependents: number, dependencies: number}}
 */
export function computeMetrics(graph, nodeId) {
  const id = nodeId.startsWith('file:') ? nodeId : fileNodeId(nodeId);
  const node = graph.getNode(id);
  if (!node) return { fanIn: 0, fanOut: 0, degree: 0, hubPenalty: 1.0, dependents: 0, dependencies: 0 };

  const outEdges = graph.getEdges(id);
  const inEdges = graph.getIncoming(id);
  const fanOut = outEdges.length;
  const fanIn = inEdges.length;
  const hubPenalty = computeHubPenalty(graph, id);

  // Import-specific counts
  const dependencies = graph.getEdges(id, EdgeType.IMPORTS).length;
  const dependents = graph.getIncoming(id, EdgeType.IMPORTS).length;

  return { fanIn, fanOut, degree: fanIn + fanOut, hubPenalty, dependents, dependencies };
}

// ─── explainContext ─────────────────────────────────────────────────────────

/**
 * Explain why certain files were selected for context.
 * Traces the relationship chain from seed files to selected files.
 *
 * @param {KnowledgeGraph} graph
 * @param {string[]} selectedFiles - Files included in context
 * @param {string[]} seedFiles - Original seed files
 * @returns {Array<{file: string, reason: string, pathFromSeed: string[]|null, metrics: Object}>}
 */
export function explainContext(graph, selectedFiles, seedFiles) {
  const seedSet = new Set(seedFiles || []);
  const explanations = [];

  for (const file of selectedFiles || []) {
    const fileId = fileNodeId(file);
    const metrics = computeMetrics(graph, fileId);

    if (seedSet.has(file)) {
      explanations.push({
        file,
        reason: 'Seed file (directly in milestone scope)',
        pathFromSeed: [file],
        metrics,
      });
      continue;
    }

    // Find shortest path from any seed
    let bestPath = null;
    for (const seed of seedSet) {
      const seedId = fileNodeId(seed);
      const path = graph.findPath(seedId, fileId, 4);
      if (path && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
      }
      // Also check reverse direction
      const revPath = graph.findPath(fileId, seedId, 4);
      if (revPath && (!bestPath || revPath.length < bestPath.length)) {
        bestPath = revPath.reverse();
      }
    }

    const reason = bestPath
      ? `${bestPath.length - 1}-hop dependency from ${bestPath[0].replace('file:', '')}`
      : `No direct path from seeds (selected by relevance scoring)`;

    explanations.push({
      file,
      reason,
      pathFromSeed: bestPath ? bestPath.map(id => id.replace('file:', '')) : null,
      metrics,
    });
  }

  return explanations;
}

// ─── exportMermaid ──────────────────────────────────────────────────────────

/**
 * Export a subgraph as a Mermaid diagram.
 *
 * @param {{nodes: Array, edges: Array}} subgraph - From getImpactRadius or getSubgraph
 * @param {Object} [opts] - {direction?: 'TD'|'LR', title?: string}
 * @returns {string} Mermaid diagram text
 */
export function exportMermaid(subgraph, opts = {}) {
  const direction = opts.direction || 'TD';
  const title = opts.title || 'Dependency Graph';
  const lines = [`graph ${direction}`];

  if (opts.title) {
    lines.push(`  %% ${title}`);
  }

  // Sanitize node IDs for Mermaid (replace special chars)
  const sanitize = id => id.replace(/[^a-zA-Z0-9_]/g, '_');
  const label = id => {
    const name = id.replace(/^(file:|sym:|mod:)/, '');
    return name.length > 40 ? '...' + name.slice(-37) : name;
  };

  // Emit nodes
  const nodeSet = new Set();
  for (const node of subgraph.nodes || []) {
    const sId = sanitize(node.id);
    if (nodeSet.has(sId)) continue;
    nodeSet.add(sId);

    const shape = node.type === 'file' ? `[${label(node.id)}]`
      : node.type === 'function' || node.type === 'method' ? `(${label(node.id)})`
      : `{${label(node.id)}}`;
    lines.push(`  ${sId}${shape}`);
  }

  // Emit edges
  const edgeSet = new Set();
  for (const edge of subgraph.edges || []) {
    const key = `${sanitize(edge.from)}-->${sanitize(edge.to)}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    const edgeLabel = edge.type ? `|${edge.type}|` : '';
    lines.push(`  ${sanitize(edge.from)} -->${edgeLabel} ${sanitize(edge.to)}`);
  }

  return lines.join('\n');
}
