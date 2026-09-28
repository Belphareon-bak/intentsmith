// Risk Analysis Engine v1 — Unified change risk scoring
// ══════════════════════════════════════════════════════════════════════════════
//
// Combines 3 signals into a composite risk score:
//   - Impact (40%): how many callers/files are affected
//   - Coverage (35%): test coverage estimate for the symbol's file
//   - Centrality (25%): how connected the symbol is in the graph
//
// Standalone module — callable from Architecture Guardian, lifecycle,
// API routes, or other consumers. Not wired into code-analysis handler.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { symbolIndex } from './symbol-index.js';
import { knowledgeGraph, fileNodeId, EdgeType } from './knowledge-graph.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const RiskLevel = {
  LOW: 'LOW',           // 0-25
  MEDIUM: 'MEDIUM',     // 25-50
  HIGH: 'HIGH',         // 50-75
  CRITICAL: 'CRITICAL', // 75-100
};

function riskLevelFromScore(score) {
  if (score >= 75) return RiskLevel.CRITICAL;
  if (score >= 50) return RiskLevel.HIGH;
  if (score >= 25) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}

// ─── Risk Analyzer ──────────────────────────────────────────────────────────

/**
 * Analyze risk of changing a symbol.
 *
 * @param {string} projectPath
 * @param {string} symbolName
 * @param {Object} [opts]
 * @param {Object} [opts.graph] - KnowledgeGraph instance (default: singleton)
 * @param {Object} [opts.index] - SymbolIndex instance (default: singleton)
 * @returns {Promise<Object>}
 */
export async function analyzeRisk(projectPath, symbolName, opts = {}) {
  const graph = opts.graph || knowledgeGraph;
  const index = opts.index || symbolIndex;

  // Lazy build: index then graph if empty
  if (projectPath) {
    if (index.symbolCount === 0 && !index._building) {
      try { await index.buildIndex(projectPath); } catch (_) {}
    }
    if (graph._nodes.size === 0 && !graph._building) {
      if (graph._buildPromise) {
        await graph._buildPromise;
      } else {
        try { await graph.buildFromProject(projectPath); } catch (_) {}
      }
    }
  }

  // Determine confidence
  const hasGraph = graph._nodes.size > 0;
  const hasIndex = index.symbolCount > 0;
  let confidence;
  if (hasGraph && hasIndex) confidence = 'high';
  else if (hasIndex) confidence = 'medium';
  else {
    confidence = 'low';
    return {
      symbol: symbolName,
      riskScore: 0,
      riskLevel: RiskLevel.LOW,
      signals: { impact: 0, coverage: 0, centrality: 0 },
      recommendations: ['Build project index for accurate risk analysis'],
      confidence,
    };
  }

  // Find the symbol's file
  const symbolDefs = index.findSymbol(symbolName);
  const symbolFile = symbolDefs?.[0]?.file || null;

  // ─── Signal A: Impact (40%) ──────────────────────────────────────

  let impactScore = 0;
  try {
    impactScore = computeImpactScore(symbolName, graph, index);
  } catch (err) {
    logger.warn('RiskAnalyzer', `Impact analysis failed: ${err.message}`);
  }

  // ─── Signal B: Coverage (35%) ────────────────────────────────────

  let coverageScore = 0;
  try {
    coverageScore = computeCoverageScore(symbolFile, graph);
  } catch (err) {
    logger.warn('RiskAnalyzer', `Coverage analysis failed: ${err.message}`);
  }

  // ─── Signal C: Centrality (25%) ──────────────────────────────────

  let centralityScore = 0;
  try {
    centralityScore = computeCentralityScore(symbolFile, graph);
  } catch (err) {
    logger.warn('RiskAnalyzer', `Centrality analysis failed: ${err.message}`);
  }

  // ─── Composite ───────────────────────────────────────────────────

  const riskScore = Math.round(
    impactScore * 0.40 +
    coverageScore * 0.35 +
    centralityScore * 0.25
  );

  const clamped = Math.max(0, Math.min(100, riskScore));
  const riskLevel = riskLevelFromScore(clamped);

  // ─── Recommendations ─────────────────────────────────────────────

  const recommendations = generateRecommendations(clamped, impactScore, coverageScore, centralityScore);

  return {
    symbol: symbolName,
    riskScore: clamped,
    riskLevel,
    signals: {
      impact: impactScore,
      coverage: coverageScore,
      centrality: centralityScore,
    },
    recommendations,
    confidence,
  };
}

// ─── Signal Computation ──────────────────────────────────────────────────────

function computeImpactScore(symbolName, graph, index) {
  let directCallers = 0;
  let transitiveCallers = 0;
  const affectedFiles = new Set();

  // Graph-based impact
  if (graph._nodes.size > 0) {
    const callers = graph.getCallers(symbolName);
    for (const caller of callers) {
      directCallers++;
      if (caller.file) affectedFiles.add(caller.file);
    }

    // Transitive: callers of callers (1 level)
    for (const caller of callers) {
      if (caller.name && caller.name !== symbolName) {
        const transitives = graph.getCallers(caller.name);
        for (const t of transitives) {
          transitiveCallers++;
          if (t.file) affectedFiles.add(t.file);
        }
      }
    }
  }

  // Index-based fallback
  if (directCallers === 0 && index.symbolCount > 0) {
    const refs = index.references.get(symbolName);
    if (refs) {
      for (const ref of refs) {
        directCallers++;
        affectedFiles.add(ref.file);
      }
    }
  }

  return Math.min(100, directCallers * 15 + transitiveCallers * 5 + affectedFiles.size * 3);
}

function computeCoverageScore(symbolFile, graph) {
  if (!symbolFile) return 40; // unknown file — assume untested

  if (graph._nodes.size === 0) return 40;

  const fid = fileNodeId(symbolFile);
  // TESTED_BY edges: from=sourceFile → to=testFile (outgoing from source)
  const testedBy = graph.getEdges(fid, EdgeType.TESTED_BY);
  const isTested = testedBy.length > 0;

  if (!isTested) return 40; // untested file penalty

  // Rough coverage estimate: more test files = better coverage
  const coverageEstimate = Math.min(100, testedBy.length * 25);
  return Math.round((1 - coverageEstimate / 100) * 40);
}

function computeCentralityScore(symbolFile, graph) {
  if (!symbolFile || graph._nodes.size === 0) return 0;

  const fid = fileNodeId(symbolFile);
  if (!graph.getNode(fid)) return 0;

  // Count unique connected files (not raw edges) to avoid util/index bias
  const connectedFiles = new Set();

  const outgoing = graph.getEdges(fid);
  for (const { target } of outgoing) {
    const node = graph.getNode(target);
    if (node && node.type === 'file' && node.file) connectedFiles.add(node.file);
  }

  const incoming = graph.getIncoming(fid);
  for (const { source } of incoming) {
    const node = graph.getNode(source);
    if (node && node.type === 'file' && node.file) connectedFiles.add(node.file);
  }

  return Math.min(100, connectedFiles.size * 12);
}

// ─── Recommendations ─────────────────────────────────────────────────────────

function generateRecommendations(score, impact, coverage, centrality) {
  const recs = [];

  if (score >= 75) {
    recs.push('CRITICAL: This change has high blast radius — require thorough code review');
  }

  if (impact >= 50) {
    recs.push('High impact: many callers depend on this symbol — consider backward compatibility');
  }

  if (coverage >= 30) {
    recs.push('Low test coverage: add tests before modifying this code');
  }

  if (centrality >= 50) {
    recs.push('Highly connected file: changes here may cascade across the codebase');
  }

  if (score < 25) {
    recs.push('Low risk: this change is relatively isolated');
  }

  return recs;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a risk analysis result as markdown.
 *
 * @param {Object} result
 * @returns {string}
 */
export function formatRiskReport(result) {
  const parts = [`## Risk Analysis: \`${result.symbol}\``];

  const emoji = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  };

  parts.push('');
  parts.push(`**Risk Score:** ${result.riskScore}/100 (${emoji[result.riskLevel]})`);
  parts.push(`**Confidence:** ${result.confidence}`);

  parts.push('');
  parts.push('### Signal Breakdown');
  parts.push(`- **Impact** (40%): ${result.signals.impact}/100`);
  parts.push(`- **Coverage** (35%): ${result.signals.coverage}/100`);
  parts.push(`- **Centrality** (25%): ${result.signals.centrality}/100`);

  if (result.recommendations.length > 0) {
    parts.push('');
    parts.push('### Recommendations');
    for (const rec of result.recommendations) {
      parts.push(`- ${rec}`);
    }
  }

  return parts.join('\n');
}

export default { analyzeRisk, formatRiskReport, RiskLevel };
