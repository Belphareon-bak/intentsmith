// Context Optimizer v1 — Cost-benefit file ranking + budget allocation
// ══════════════════════════════════════════════════════════════════════════════
//
// Ranks files by relevance/tokenCost ratio and allocates token budget between
// full-source, signature-only, and skip representations.
//
// ══════════════════════════════════════════════════════════════════════════════

import { estimateTokens } from './context-builder.js';
import { fileNodeId, EdgeType } from './knowledge-graph.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SIGNATURE_FILES = 20;

// ─── rankFilesByValue ───────────────────────────────────────────────────────

/**
 * Rank files by relevance/tokenCost ratio.
 *
 * @param {Array} files - [{file: string, content: string, score?: number}]
 * @param {string} query - Search query / milestone description
 * @param {Object} opts - {graph?, seedFiles?: string[]}
 * @returns {Array} [{file, content, relevance, tokenCost, value, representation}]
 */
export function rankFilesByValue(files, query, opts = {}) {
  if (!files || files.length === 0) return [];

  const { graph, seedFiles } = opts;
  const seedSet = new Set(seedFiles || []);

  const ranked = files.map(f => {
    const relevance = computeRelevance(f, query, graph, seedSet);
    const tokenCost = estimateTokens(f.content || '');
    const value = tokenCost > 0 ? relevance / Math.max(1, tokenCost / 100) : relevance;

    return {
      file: f.file,
      content: f.content || '',
      relevance,
      tokenCost,
      value,
      representation: 'skip', // will be assigned by allocateBudget
    };
  });

  // Sort by value descending
  ranked.sort((a, b) => b.value - a.value);
  return ranked;
}

/**
 * Compute relevance score for a file.
 */
function computeRelevance(fileEntry, query, graph, seedSet) {
  // If existing score provided, use it as base
  if (typeof fileEntry.score === 'number' && fileEntry.score > 0) {
    return fileEntry.score;
  }

  // Seed files are the most relevant by definition
  if (seedSet.has(fileEntry.file)) return 1.0;

  let score = 0;

  // Component 1: Symbol call overlap (0.5 weight)
  if (graph && seedSet.size > 0) {
    score += computeSymbolCallOverlap(fileEntry.file, graph, seedSet) * 0.5;
  }

  // Component 2: Graph distance (0.3 weight)
  if (graph && seedSet.size > 0) {
    score += computeGraphDistance(fileEntry.file, graph, seedSet) * 0.3;
  } else if (seedSet.has(fileEntry.file)) {
    score += 0.3; // seed file without graph
  }

  // Component 3: Import proximity (0.2 weight)
  if (graph && seedSet.size > 0) {
    score += computeImportProximity(fileEntry.file, graph, seedSet) * 0.2;
  }

  // Fallback if no graph and no score: keyword overlap
  if (score === 0 && query) {
    score = computeKeywordOverlap(fileEntry.file, query);
  }

  return Math.max(0.01, score); // never zero
}

/**
 * Compute symbol call overlap between file and seed files.
 * Uses KG getCallers/getCallees to find shared call relationships.
 */
function computeSymbolCallOverlap(file, graph, seedSet) {
  try {
    const fileId = fileNodeId(file);
    const fileNode = graph.getNode(fileId);
    if (!fileNode) return 0;

    // Get symbols defined in this file
    const fileSymbols = graph.getFileSymbols(fileId);
    if (fileSymbols.length === 0) return 0;

    // Get all symbols from seed files
    const seedSymbolNames = new Set();
    for (const seed of seedSet) {
      const seedId = fileNodeId(seed);
      const seedSymbols = graph.getFileSymbols(seedId);
      for (const sym of seedSymbols) {
        seedSymbolNames.add(sym.name);
      }
    }

    if (seedSymbolNames.size === 0) return 0;

    // Count how many of this file's symbols are called by/call seed symbols
    let overlapCount = 0;
    for (const sym of fileSymbols) {
      // Check if any seed symbol calls this symbol
      const callers = graph.getCallers(sym.name);
      for (const caller of callers) {
        if (caller.file && seedSet.has(caller.file)) {
          overlapCount++;
          break;
        }
      }

      // Check if this symbol calls any seed symbol
      const callees = graph.getCallees(sym.name);
      for (const callee of callees) {
        if (callee.name && seedSymbolNames.has(callee.name)) {
          overlapCount++;
          break;
        }
      }
    }

    return Math.min(1, overlapCount / Math.max(1, fileSymbols.length));
  } catch (_) {
    return 0;
  }
}

/**
 * Compute graph distance: 1.0 if seed, 0.7 if 1-hop, 0.4 if 2-hop, 0.1 otherwise.
 */
function computeGraphDistance(file, graph, seedSet) {
  if (seedSet.has(file)) return 1.0;

  try {
    const fileId = fileNodeId(file);
    for (const seed of seedSet) {
      const seedId = fileNodeId(seed);
      const path = graph.findPath(seedId, fileId, 3);
      if (path) {
        const hops = path.length - 1;
        if (hops === 1) return 0.7;
        if (hops === 2) return 0.4;
        if (hops === 3) return 0.2;
      }
      // Check reverse direction too
      const revPath = graph.findPath(fileId, seedId, 3);
      if (revPath) {
        const hops = revPath.length - 1;
        if (hops === 1) return 0.7;
        if (hops === 2) return 0.4;
        if (hops === 3) return 0.2;
      }
    }
  } catch (_) {}

  return 0.1;
}

/**
 * Compute import proximity: 1.0 if directly imported by seed, 0.5 if transitively.
 */
function computeImportProximity(file, graph, seedSet) {
  try {
    const fileId = fileNodeId(file);
    if (seedSet.has(file)) return 1.0;

    // Check direct imports from seeds
    for (const seed of seedSet) {
      const seedId = fileNodeId(seed);
      const deps = graph.getEdges(seedId, EdgeType.IMPORTS);
      for (const { target } of deps) {
        if (target === fileId) return 1.0;
      }
      // Check reverse: this file imports seed
      const fileDeps = graph.getEdges(fileId, EdgeType.IMPORTS);
      for (const { target } of fileDeps) {
        if (target === seedId) return 0.8;
      }
    }

    // Check transitive (2-hop) imports
    for (const seed of seedSet) {
      const seedId = fileNodeId(seed);
      const deps = graph.getEdges(seedId, EdgeType.IMPORTS);
      for (const { target: mid } of deps) {
        const midDeps = graph.getEdges(mid, EdgeType.IMPORTS);
        for (const { target: t2 } of midDeps) {
          if (t2 === fileId) return 0.5;
        }
      }
    }
  } catch (_) {}

  return 0;
}

/**
 * Simple keyword overlap between file path and query.
 */
function computeKeywordOverlap(file, query) {
  const fileWords = new Set(file.replace(/[/\\._-]/g, ' ').toLowerCase().split(/\s+/).filter(Boolean));
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (queryWords.size === 0) return 0.1;

  let overlap = 0;
  for (const w of queryWords) {
    if (fileWords.has(w)) overlap++;
  }
  return Math.min(1, overlap / queryWords.size);
}

// ─── allocateBudget ─────────────────────────────────────────────────────────

/**
 * Allocate token budget across files.
 *
 * @param {Array} rankedFiles - from rankFilesByValue(), sorted by value DESC
 * @param {number} totalBudget - total token budget
 * @param {Object} opts - {summaryBudget?: 500, signatureRatio?: 0.3}
 * @returns {{
 *   fullFiles: [{file, content, tokens}],
 *   signatureFiles: [{file, signatures}],
 *   skippedFiles: string[],
 *   totalTokens: number,
 *   budgetBreakdown: {summary, signatures, fullSource}
 * }}
 */
export function allocateBudget(rankedFiles, totalBudget, opts = {}) {
  if (!rankedFiles || rankedFiles.length === 0 || totalBudget <= 0) {
    return {
      fullFiles: [],
      signatureFiles: [],
      skippedFiles: [],
      totalTokens: 0,
      budgetBreakdown: { summary: 0, signatures: 0, fullSource: 0 },
    };
  }

  const summaryBudget = opts.summaryBudget ?? 500;
  const signatureRatio = opts.signatureRatio ?? 0.3;
  const available = totalBudget - summaryBudget;
  const signatureBudget = Math.floor(available * signatureRatio);
  const seedBudget = available - signatureBudget;

  const fullFiles = [];
  const signatureFiles = [];
  const skippedFiles = [];
  let fullTokens = 0;
  let sigTokens = 0;
  let sigCount = 0;

  for (const f of rankedFiles) {
    const tokens = f.tokenCost || estimateTokens(f.content || '');

    // Try full source first
    if (fullTokens + tokens <= seedBudget) {
      fullFiles.push({ file: f.file, content: f.content || '', tokens });
      fullTokens += tokens;
      continue;
    }

    // Try signature-only
    const sigCost = Math.ceil(tokens * 0.15); // signatures ≈ 15% of full
    if (sigTokens + sigCost <= signatureBudget && sigCount < MAX_SIGNATURE_FILES) {
      signatureFiles.push({ file: f.file, signatures: '' }); // signatures filled later
      sigTokens += sigCost;
      sigCount++;
      continue;
    }

    // Skip
    skippedFiles.push(f.file);
  }

  return {
    fullFiles,
    signatureFiles,
    skippedFiles,
    totalTokens: summaryBudget + fullTokens + sigTokens,
    budgetBreakdown: {
      summary: summaryBudget,
      signatures: sigTokens,
      fullSource: fullTokens,
    },
  };
}

// ─── detectRedundancy ───────────────────────────────────────────────────────

/**
 * Detect re-export chains: if A imports and re-exports all of B, skip B.
 *
 * @param {Array} files - [{file, content}]
 * @param {Object} graph - KnowledgeGraph instance (optional)
 * @returns {Set<string>} Set of redundant file paths to skip
 */
export function detectRedundancy(files, graph) {
  const redundant = new Set();
  if (!graph || !files || files.length < 2) return redundant;

  try {
    for (let i = 0; i < files.length; i++) {
      const aFile = files[i].file;
      const aId = fileNodeId(aFile);
      const aSymbols = graph.getFileSymbols(aId);
      const aExports = new Set(aSymbols.filter(s => s.exported !== false).map(s => s.name));

      if (aExports.size === 0) continue;

      // Check if A imports B and re-exports all of B's exports
      const aDeps = graph.getEdges(aId, EdgeType.IMPORTS);
      for (const { target: bId } of aDeps) {
        const bNode = graph.getNode(bId);
        if (!bNode || !bNode.name) continue;

        // Find B in our file list
        const bFile = files.find(f => fileNodeId(f.file) === bId);
        if (!bFile) continue;

        const bSymbols = graph.getFileSymbols(bId);
        const bExports = bSymbols.filter(s => s.exported !== false).map(s => s.name);

        if (bExports.length === 0) continue;

        // Check if all of B's exports are in A's exports
        const allCovered = bExports.every(name => aExports.has(name));
        if (allCovered) {
          redundant.add(bFile.file);
        }
      }
    }
  } catch (_) {}

  return redundant;
}
