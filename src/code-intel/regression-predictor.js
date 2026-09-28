// Regression Predictor v100 — Pre-Checkpoint Risk Assessment
// ══════════════════════════════════════════════════════════════════════════════
//
// Predicts regression risk BEFORE checkpoint runs:
//   regressionRisk = 0.35 × riskScore
//                  + 0.25 × coverageGap
//                  + 0.20 × centrality
//                  + 0.10 × min(churnRate, 30)   ← capped to prevent overwhelming
//                  + 0.10 × couplingRisk
//
// Risk levels: LOW (0-25), MEDIUM (25-50), HIGH (50-75), CRITICAL (75-100)
// CRITICAL → shouldBlock = true
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Lazy-loaded modules ────────────────────────────────────────────────────

let _loaded = false;
let _computeRiskScore, _knowledgeGraph, _findHotspots, _exploreTestCoverage;

async function _ensureModules() {
  if (_loaded) return true;
  try {
    const [impact, kg, evolution, coverage] = await Promise.all([
      import('./impact-analyzer.js'),
      import('./knowledge-graph.js'),
      import('./code-evolution.js'),
      import('./test-coverage-explorer.js'),
    ]);
    _computeRiskScore = impact.computeRiskScore;
    _knowledgeGraph = kg.knowledgeGraph;
    _findHotspots = evolution.findHotspots;
    _exploreTestCoverage = coverage.exploreTestCoverage;
    _loaded = true;
    return true;
  } catch (err) {
    logger.warn('RegressionPredictor', `Modules unavailable: ${err.message}`);
    return false;
  }
}

// ─── Composite Weights ──────────────────────────────────────────────────────

const W_RISK = 0.35;
const W_COVERAGE = 0.25;
const W_CENTRALITY = 0.20;
const W_CHURN = 0.10;
const W_COUPLING = 0.10;
const CHURN_CAP = 30; // Cap churn contribution

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Predict regression risk for a set of changed files.
 *
 * @param {string} projectPath
 * @param {string[]} changedFiles - Relative paths of changed files
 * @param {Object} [opts]
 * @param {Object} [opts.impactResults] - Pre-computed impact results per file
 * @param {Object} [opts.graph] - Override knowledge graph
 * @param {Object} [opts.hotspots] - Pre-computed hotspots
 * @param {Object} [opts.coverageMap] - Pre-computed coverage { file → boolean }
 * @returns {Promise<Object>} Regression prediction
 */
export async function predictRegression(projectPath, changedFiles, opts = {}) {
  if (!changedFiles || changedFiles.length === 0) {
    return _emptyPrediction();
  }

  const modulesOk = await _ensureModules();

  const graph = opts.graph || (modulesOk ? _knowledgeGraph : null);
  const fileRisks = [];
  const recommendations = [];

  for (const file of changedFiles.slice(0, 50)) {
    const factors = await _analyzeFile(file, projectPath, graph, opts);
    const compositeRisk = _computeComposite(factors);

    fileRisks.push({
      file,
      risk: compositeRisk,
      factors,
    });
  }

  // Sort by risk descending
  fileRisks.sort((a, b) => b.risk - a.risk);

  // Overall risk = weighted average of top files
  const overallRisk = fileRisks.length > 0
    ? Math.round(fileRisks.reduce((sum, f) => sum + f.risk, 0) / fileRisks.length)
    : 0;

  const riskLevel = _classifyRisk(overallRisk);
  const shouldBlock = riskLevel === 'CRITICAL';

  // Generate recommendations
  for (const fr of fileRisks) {
    if (fr.factors.coverageGap > 0.5) {
      recommendations.push(`Add tests for \`${fr.file}\` (coverage gap: ${(fr.factors.coverageGap * 100).toFixed(0)}%)`);
    }
    if (fr.factors.centrality > 0.7) {
      recommendations.push(`\`${fr.file}\` is highly connected — review callers for compatibility`);
    }
    if (fr.factors.churnRate >= CHURN_CAP) {
      recommendations.push(`\`${fr.file}\` has high churn — consider stabilizing before changes`);
    }
  }

  logger.info('RegressionPredictor', `Prediction: ${riskLevel} (${overallRisk}/100)`, {
    files: changedFiles.length,
    shouldBlock,
  });

  return {
    overallRisk,
    riskLevel,
    fileRisks,
    recommendations: [...new Set(recommendations)].slice(0, 10),
    shouldBlock,
  };
}

// ─── Per-File Analysis ──────────────────────────────────────────────────────

async function _analyzeFile(file, projectPath, graph, opts) {
  const factors = {
    riskScore: 0,       // 0-1, from impact-analyzer
    coverageGap: 0,     // 0-1, 1 = no coverage
    centrality: 0,      // 0-1, from KG incoming edges
    churnRate: 0,       // 0-30 (capped), from code-evolution
    couplingRisk: 0,    // 0-1, from co-change patterns
  };

  // 1. Risk score from impact analyzer
  if (opts.impactResults?.[file]) {
    const riskResult = _computeRiskScore?.(opts.impactResults[file]);
    if (riskResult) factors.riskScore = riskResult.riskScore;
  }

  // 2. Coverage gap from test-coverage-explorer
  if (opts.coverageMap) {
    factors.coverageGap = opts.coverageMap[file] ? 0 : 1;
  } else if (_exploreTestCoverage) {
    try {
      const coverage = await _exploreTestCoverage(projectPath, { files: [file] });
      if (coverage?.fileCoverage) {
        const fileCov = coverage.fileCoverage.find(c => c.file === file);
        factors.coverageGap = fileCov?.hasCoverage ? 0 : 1;
      } else {
        factors.coverageGap = 1; // assume no coverage if unknown
      }
    } catch {
      factors.coverageGap = 0.5; // unknown
    }
  }

  // 3. Centrality from knowledge graph
  if (graph && graph._nodes && graph._nodes.size > 0) {
    try {
      const fid = `file:${file}`;
      const incoming = graph.getIncoming?.(fid);
      if (incoming) {
        // Normalize: 0 = 0, 10+ = 1.0
        factors.centrality = Math.min(incoming.length / 10, 1.0);
      }
    } catch { /* no graph data */ }
  }

  // 4. Churn rate from code-evolution (capped at CHURN_CAP)
  if (opts.hotspots) {
    const hotspot = opts.hotspots.find(h => h.file === file);
    if (hotspot) {
      factors.churnRate = Math.min(hotspot.changes || 0, CHURN_CAP);
    }
  } else if (_findHotspots) {
    try {
      const hotspots = await _findHotspots(projectPath, { limit: 100 });
      if (hotspots) {
        const hotspot = hotspots.find(h => h.file === file);
        if (hotspot) {
          factors.churnRate = Math.min(hotspot.changes || 0, CHURN_CAP);
        }
      }
    } catch { /* git not available */ }
  }

  // 5. Co-change coupling risk
  // Simple heuristic: high churn + high centrality → high coupling risk
  factors.couplingRisk = Math.min(
    (factors.churnRate / CHURN_CAP) * factors.centrality,
    1.0
  );

  return factors;
}

// ─── Composite Formula ──────────────────────────────────────────────────────

function _computeComposite(factors) {
  const raw = W_RISK * (factors.riskScore * 100) +
              W_COVERAGE * (factors.coverageGap * 100) +
              W_CENTRALITY * (factors.centrality * 100) +
              W_CHURN * (Math.min(factors.churnRate, CHURN_CAP) / CHURN_CAP * 100) +
              W_COUPLING * (factors.couplingRisk * 100);

  return Math.round(Math.min(raw, 100));
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format regression prediction as a report.
 *
 * @param {Object} prediction - From predictRegression()
 * @returns {string} Formatted report
 */
export function formatRegressionReport(prediction) {
  if (!prediction) return '';

  const parts = [];
  parts.push(`## Regression Risk: ${prediction.riskLevel} (${prediction.overallRisk}/100)`);

  if (prediction.shouldBlock) {
    parts.push('');
    parts.push('**WARNING: CRITICAL regression risk — review changes carefully before proceeding.**');
  }

  if (prediction.fileRisks.length > 0) {
    parts.push('');
    parts.push('### Per-File Risk');
    for (const fr of prediction.fileRisks.slice(0, 10)) {
      const level = _classifyRisk(fr.risk);
      parts.push(`- \`${fr.file}\`: ${level} (${fr.risk}/100)`);
    }
  }

  if (prediction.recommendations.length > 0) {
    parts.push('');
    parts.push('### Recommendations');
    for (const rec of prediction.recommendations) {
      parts.push(`- ${rec}`);
    }
  }

  return parts.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _classifyRisk(score) {
  if (score < 25) return 'LOW';
  if (score < 50) return 'MEDIUM';
  if (score < 75) return 'HIGH';
  return 'CRITICAL';
}

function _emptyPrediction() {
  return {
    overallRisk: 0,
    riskLevel: 'LOW',
    fileRisks: [],
    recommendations: [],
    shouldBlock: false,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default { predictRegression, formatRegressionReport };
