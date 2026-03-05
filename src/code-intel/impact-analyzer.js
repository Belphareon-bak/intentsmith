// Change Impact Analyzer v1 — BFS traversal on knowledge graph
// ══════════════════════════════════════════════════════════════════════════════
//
// Analyzes what files, functions, and tests are affected by changing a symbol.
// Uses knowledge graph (high confidence) → symbol index fallback (medium) → heuristic (low).
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { knowledgeGraph, EdgeType, symbolNodeId } from './knowledge-graph.js';
import { symbolIndex } from './symbol-index.js';

// ─── BFS Impact Traversal ───────────────────────────────────────────────────

function bfsImpact(graph, startNodeIds, maxDepth, edgeTypes) {
  const visited = new Set();
  const queue = [];
  const functions = [];
  const files = new Set();
  const tests = new Set();
  const chains = [];

  for (const id of startNodeIds) {
    queue.push({ nodeId: id, depth: 0, chain: [id] });
    visited.add(id);
  }

  while (queue.length > 0) {
    const { nodeId, depth, chain } = queue.shift();

    if (depth > maxDepth) continue;

    if (depth >= maxDepth) continue; // Don't explore beyond maxDepth

    const incoming = graph.getIncoming(nodeId);
    for (const { edge, source } of incoming) {
      if (!edgeTypes.includes(edge.type)) continue;
      if (visited.has(source)) continue;
      visited.add(source);

      const srcNode = graph.getNode(source);
      if (!srcNode) continue;

      const newChain = [...chain, source];

      if (srcNode.type === 'function' || srcNode.type === 'method' || srcNode.type === 'class') {
        functions.push(srcNode.name);
      }
      if (srcNode.file) files.add(srcNode.file);

      queue.push({ nodeId: source, depth: depth + 1, chain: newChain });
    }

    // Also check TESTED_BY edges (regardless of type filter)
    const testEdges = graph.getIncoming(nodeId, EdgeType.TESTED_BY);
    for (const { source } of testEdges) {
      const testNode = graph.getNode(source);
      // TESTED_BY is srcFile → testFile, so incoming on srcFile = the test file is the edge target
      // Actually: we add TESTED_BY as (srcFile, testFile), so getIncoming on testFile gives srcFile
      // Let's also check outgoing TESTED_BY from the file of this symbol
    }

    // Check outgoing TESTED_BY from the file containing this node
    const node = graph.getNode(nodeId);
    if (node && node.file) {
      const fileId = `file:${node.file}`;
      const testedBy = graph.getEdges(fileId, EdgeType.TESTED_BY);
      for (const { target } of testedBy) {
        const testNode = graph.getNode(target);
        if (testNode) tests.add(testNode.file || testNode.name);
      }
    }

    if (chain.length > 1) {
      chains.push(chain.map(id => {
        const n = graph.getNode(id);
        return n ? n.name : id;
      }));
    }
  }

  return { functions: [...new Set(functions)], files: [...files], tests: [...tests], chains };
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Analyze the impact of changing a symbol.
 *
 * @param {string} symbolName - The symbol being changed
 * @param {Object} [opts]
 * @param {number} [opts.maxDepth=3] - Max traversal depth
 * @param {boolean} [opts.includeTests=true] - Include affected test files
 * @param {string} [opts.projectPath] - For building index if needed
 * @param {Object} [opts.graph] - Override graph (for testing)
 * @param {Object} [opts.index] - Override symbol index (for testing)
 * @returns {Promise<Object>}
 */
export async function analyzeImpact(symbolName, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const includeTests = opts.includeTests !== false;
  const graph = opts.graph || knowledgeGraph;
  const index = opts.index || symbolIndex;

  // Strategy 1: Knowledge Graph (high confidence)
  if (graph._nodes && graph._nodes.size > 0) {
    const startIds = [];
    for (const [id, node] of graph._nodes) {
      if (node.name === symbolName && id.startsWith('sym:')) {
        startIds.push(id);
      }
    }

    if (startIds.length > 0) {
      logger.info('ImpactAnalyzer', `Graph-based analysis for ${symbolName} (${startIds.length} definitions)`);

      const impact = bfsImpact(graph, startIds, maxDepth, [
        EdgeType.CALLS, EdgeType.REFERENCES, EdgeType.IMPORTS,
      ]);

      const tests = includeTests ? impact.tests : [];
      const directCallers = graph.getIncoming(startIds[0], EdgeType.CALLS).length +
                            graph.getIncoming(startIds[0], EdgeType.REFERENCES).length;

      return {
        symbol: symbolName,
        impactedFunctions: impact.functions,
        impactedFiles: impact.files,
        impactedTests: tests,
        callChain: impact.chains.slice(0, 10),
        depth: maxDepth,
        confidence: 'high',
        stats: {
          totalImpacted: impact.functions.length + impact.files.length,
          directCallers,
          transitiveCallers: impact.functions.length,
          testsAffected: tests.length,
        },
      };
    }
  }

  // Strategy 2: Symbol Index fallback (medium confidence)
  if (index.symbolCount > 0) {
    logger.info('ImpactAnalyzer', `Index-based analysis for ${symbolName}`);

    const refs = await index.findReferences(symbolName);
    const callGraph = await index.getCallGraph(symbolName);

    const impactedFiles = [...new Set(refs.map(r => r.file))];
    const impactedFunctions = callGraph.callers || [];
    const tests = includeTests
      ? impactedFiles.filter(f => /(?:^|[/\\])(test|tests|__tests__|spec)[/\\]/.test(f))
      : [];

    return {
      symbol: symbolName,
      impactedFunctions,
      impactedFiles: impactedFiles.filter(f => !tests.includes(f)),
      impactedTests: tests,
      callChain: [],
      depth: 1,
      confidence: 'medium',
      stats: {
        totalImpacted: impactedFiles.length,
        directCallers: refs.length,
        transitiveCallers: 0,
        testsAffected: tests.length,
      },
    };
  }

  // Strategy 3: Heuristic fallback (low confidence)
  logger.warn('ImpactAnalyzer', `No index data for ${symbolName} — returning low confidence`);

  return {
    symbol: symbolName,
    impactedFunctions: [],
    impactedFiles: [],
    impactedTests: [],
    callChain: [],
    depth: 0,
    confidence: 'low',
    stats: { totalImpacted: 0, directCallers: 0, transitiveCallers: 0, testsAffected: 0 },
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format impact analysis as markdown report.
 */
export function formatImpactReport(result) {
  const parts = [`## Impact Analysis: \`${result.symbol}\``];
  parts.push(`**Confidence:** ${result.confidence}`);
  parts.push('');

  if (result.impactedFunctions.length > 0) {
    parts.push('### Direct Callers');
    for (const fn of result.impactedFunctions.slice(0, 20)) {
      parts.push(`- \`${fn}\``);
    }
    parts.push('');
  }

  if (result.impactedFiles.length > 0) {
    parts.push('### Affected Files');
    for (const f of result.impactedFiles.slice(0, 20)) {
      parts.push(`- ${f}`);
    }
    parts.push('');
  }

  if (result.impactedTests.length > 0) {
    parts.push('### Affected Tests');
    for (const t of result.impactedTests) {
      parts.push(`- ${t}`);
    }
    parts.push('');
  }

  if (result.callChain.length > 0) {
    parts.push('### Call Chains');
    for (const chain of result.callChain.slice(0, 5)) {
      parts.push(`- ${chain.join(' → ')}`);
    }
    parts.push('');
  }

  const s = result.stats;
  parts.push(`---`);
  parts.push(`*${s.totalImpacted} impacted, ${s.directCallers} direct callers, ${s.testsAffected} tests*`);

  return parts.join('\n');
}

/**
 * Quick summary for inline display.
 */
export function getImpactSummary(result) {
  const fn = result.impactedFunctions.length;
  const fi = result.impactedFiles.length;
  const te = result.impactedTests.length;
  return `Changing ${result.symbol} affects ${fn} function${fn !== 1 ? 's' : ''} in ${fi} file${fi !== 1 ? 's' : ''} (${te} test${te !== 1 ? 's' : ''})`;
}

// ─── Risk Scoring ───────────────────────────────────────────────────────────

/**
 * Compute risk score for a code change based on impact analysis.
 *
 * Formula: riskScore = dependencyFactor × (1 - coverageFactor)
 * - dependencyFactor: high if many dependents, normalized to [0, 1]
 * - coverageFactor: ratio of tested-to-total impacted, [0, 1]
 *
 * @param {Object} impactResult - From analyzeImpact()
 * @returns {{ riskScore: number, riskLevel: string, testGaps: string[], breakingChanges: string[], details: Object }}
 */
export function computeRiskScore(impactResult) {
  if (!impactResult || !impactResult.stats) {
    return { riskScore: 0, riskLevel: 'LOW', testGaps: [], breakingChanges: [], details: {} };
  }

  const s = impactResult.stats;

  // Dependency factor: how many things depend on this?
  // Normalize: 0 deps = 0.0, 10+ deps = 1.0
  const depCount = s.totalImpacted || 0;
  const dependencyFactor = Math.min(depCount / 10, 1.0);

  // Coverage factor: what fraction of impacted code has tests?
  const testsAffected = s.testsAffected || 0;
  const totalImpacted = Math.max(s.totalImpacted, 1);
  const coverageFactor = Math.min(testsAffected / totalImpacted, 1.0);

  // Risk = high dependencies × low coverage
  const riskScore = dependencyFactor * (1 - coverageFactor);

  // Find test gaps: impacted files that have no test coverage
  const testGaps = [];
  const testedFiles = new Set(impactResult.impactedTests || []);
  for (const file of impactResult.impactedFiles || []) {
    const hasTest = [...testedFiles].some(t =>
      t.includes(file.replace(/\.\w+$/, '')) ||
      file.includes(t.replace(/\.\w+$/, ''))
    );
    if (!hasTest) {
      testGaps.push(file);
    }
  }

  // Breaking changes: exported symbols with consumers
  const breakingChanges = [];
  if (s.directCallers > 3) {
    breakingChanges.push(`${impactResult.symbol} has ${s.directCallers} direct callers — signature change is risky`);
  }

  // Classify risk
  let riskLevel;
  if (riskScore < 0.2) riskLevel = 'LOW';
  else if (riskScore < 0.5) riskLevel = 'MEDIUM';
  else if (riskScore < 0.8) riskLevel = 'HIGH';
  else riskLevel = 'CRITICAL';

  return {
    riskScore: Math.round(riskScore * 100) / 100,
    riskLevel,
    testGaps: testGaps.slice(0, 10),
    breakingChanges,
    details: {
      dependencyFactor: Math.round(dependencyFactor * 100) / 100,
      coverageFactor: Math.round(coverageFactor * 100) / 100,
      directCallers: s.directCallers,
      totalImpacted: s.totalImpacted,
      testsAffected: s.testsAffected,
    },
  };
}

export default { analyzeImpact, formatImpactReport, getImpactSummary, computeRiskScore };
