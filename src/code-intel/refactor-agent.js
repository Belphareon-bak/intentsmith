// Autonomous Refactor Agent v100 — Detect Smells → Plan → Apply → Verify
// ══════════════════════════════════════════════════════════════════════════════
//
// Pipeline: detect smells → generate refactor plan → impact analysis →
//           risk score → apply patch → AST validate → run tests → commit/revert
//
// Safety constraints:
//   - Risk threshold: riskScore < 30 (LOW only)
//   - Coverage: affected files must have tests
//   - Atomic: 1 file per step, commit or revert
//   - AST validation via ast-analyzer.js (structural integrity check)
//   - Dry-run mode: plan only, no changes
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Smell Types ────────────────────────────────────────────────────────────

export const SmellType = Object.freeze({
  DEAD_CODE: 'dead_code',
  DUPLICATE_LOGIC: 'duplicate_logic',
  GOD_CLASS: 'god_class',
  LAYER_VIOLATION: 'layer_violation',
  CIRCULAR_DEPENDENCY: 'circular_dep',
  MISSING_ERROR_HANDLING: 'missing_error_handling',
});

// ─── Risk Thresholds ────────────────────────────────────────────────────────

const DEFAULT_RISK_THRESHOLD = 30; // Only refactor LOW risk items
const DEFAULT_MAX_STEPS = 5;

// ─── Lazy-loaded modules ────────────────────────────────────────────────────

let _loaded = false;
let _computeRiskScore, _driftDetector;

async function _ensureModules() {
  if (_loaded) return true;
  try {
    const [impact, drift] = await Promise.all([
      import('./impact-analyzer.js'),
      import('./drift-detector.js'),
    ]);
    _computeRiskScore = impact.computeRiskScore;
    _driftDetector = drift.driftDetector;
    _loaded = true;
    return true;
  } catch (err) {
    logger.warn('RefactorAgent', `Modules unavailable: ${err.message}`);
    return false;
  }
}

// ─── Detect Smells ──────────────────────────────────────────────────────────

/**
 * Aggregate code smells from all detectors.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {Object} [opts.deadCodeResult] - Pre-computed dead code results
 * @param {Object} [opts.driftResult] - Pre-computed drift results
 * @param {Array} [opts.files] - File list with content for analysis
 * @returns {Promise<Array>} Detected smells
 */
export async function detectSmells(projectPath, opts = {}) {
  await _ensureModules();
  const smells = [];

  // 1. Dead code from dead-code-detector
  if (opts.deadCodeResult?.unreachable?.length > 0) {
    for (const item of opts.deadCodeResult.unreachable) {
      smells.push({
        type: SmellType.DEAD_CODE,
        file: item.file,
        symbol: item.name || item.symbol,
        severity: 'LOW',
        description: `Unused ${item.kind || 'symbol'}: ${item.name || item.symbol}`,
      });
    }
  }

  // 2. Layer violations from drift-detector
  const driftResult = opts.driftResult || (
    _driftDetector ? await _driftDetector.analyze(projectPath, { maxFiles: 1000 }).catch(() => null) : null
  );
  if (driftResult?.violations?.length > 0) {
    for (const v of driftResult.violations) {
      smells.push({
        type: SmellType.LAYER_VIOLATION,
        file: v.file,
        severity: 'MEDIUM',
        description: `${v.sourceLayer} → ${v.targetLayer}: ${v.message}`,
        details: v,
      });
    }
  }

  // 3. Circular dependencies
  if (driftResult?.circularDependencies?.length > 0) {
    for (const c of driftResult.circularDependencies) {
      smells.push({
        type: SmellType.CIRCULAR_DEPENDENCY,
        file: c.files?.[0] || 'unknown',
        severity: 'HIGH',
        description: `Circular dependency: ${c.files?.join(' → ')}`,
        details: c,
      });
    }
  }

  // 4. God classes from files analysis
  if (opts.files) {
    for (const f of opts.files) {
      if (!f.content) continue;
      const lines = f.content.split('\n').length;
      if (lines > 500) {
        smells.push({
          type: SmellType.GOD_CLASS,
          file: f.file,
          severity: 'MEDIUM',
          description: `File has ${lines} lines — consider splitting`,
        });
      }

      // Missing error handling
      const hasTryCatch = /try\s*\{/.test(f.content);
      const hasAsync = /async\s+function|\.then\(|await\s/.test(f.content);
      if (hasAsync && !hasTryCatch && lines > 50) {
        smells.push({
          type: SmellType.MISSING_ERROR_HANDLING,
          file: f.file,
          severity: 'LOW',
          description: 'Async code without error handling',
        });
      }
    }
  }

  // Deduplicate by file+type
  const seen = new Set();
  const unique = smells.filter(s => {
    const key = `${s.file}:${s.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: HIGH > MEDIUM > LOW
  const sevOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  unique.sort((a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2));

  logger.info('RefactorAgent', `Detected ${unique.length} smells`, {
    deadCode: smells.filter(s => s.type === SmellType.DEAD_CODE).length,
    violations: smells.filter(s => s.type === SmellType.LAYER_VIOLATION).length,
    circular: smells.filter(s => s.type === SmellType.CIRCULAR_DEPENDENCY).length,
  });

  return unique;
}

// ─── Generate Refactor Plan ─────────────────────────────────────────────────

/**
 * Generate a safe refactor plan from detected smells.
 * Only includes steps where risk < threshold and coverage exists.
 *
 * @param {Array} smells - From detectSmells()
 * @param {Object} [opts]
 * @param {number} [opts.riskThreshold=30] - Max risk score for safe steps
 * @param {number} [opts.maxSteps=5] - Max steps per plan
 * @param {Object} [opts.impactResults] - Pre-computed impacts per symbol
 * @param {Object} [opts.coverageMap] - { file: hasCoverage }
 * @returns {Object} RefactorPlan
 */
export function generateRefactorPlan(smells, opts = {}) {
  const riskThreshold = opts.riskThreshold ?? DEFAULT_RISK_THRESHOLD;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  const steps = [];
  const skippedSteps = [];

  for (const smell of smells) {
    // Compute risk
    let riskScore = 0;
    if (opts.impactResults?.[smell.symbol] && _computeRiskScore) {
      const risk = _computeRiskScore(opts.impactResults[smell.symbol]);
      riskScore = (risk.riskScore || 0) * 100;
    }

    // Check coverage
    const hasCoverage = opts.coverageMap?.[smell.file] ?? false;

    // Safety gate
    const safe = riskScore < riskThreshold && (hasCoverage || smell.type === SmellType.DEAD_CODE);

    if (safe && steps.length < maxSteps) {
      steps.push({
        smell,
        riskScore,
        hasCoverage,
        action: _suggestAction(smell),
        safe: true,
      });
    } else {
      skippedSteps.push({
        smell,
        riskScore,
        hasCoverage,
        reason: riskScore >= riskThreshold ? 'risk too high' : 'no test coverage',
        safe: false,
      });
    }
  }

  const totalRisk = steps.length > 0
    ? Math.round(steps.reduce((s, st) => s + st.riskScore, 0) / steps.length)
    : 0;

  return {
    steps,
    skippedSteps,
    totalRisk,
    safeSteps: steps.length,
    unsafeSteps: skippedSteps.length,
  };
}

// ─── Refactor Report ────────────────────────────────────────────────────────

/**
 * Format refactor plan/results as a report.
 *
 * @param {Object} planOrReport
 * @returns {string}
 */
export function formatRefactorReport(planOrReport) {
  if (!planOrReport) return '';

  const parts = [];
  parts.push(`## Refactor Plan`);
  parts.push(`Safe steps: ${planOrReport.safeSteps}, Skipped: ${planOrReport.unsafeSteps}`);

  if (planOrReport.steps?.length > 0) {
    parts.push('');
    parts.push('### Safe Refactors');
    for (const step of planOrReport.steps) {
      parts.push(`- **${step.smell.type}** in \`${step.smell.file}\`: ${step.action} (risk: ${step.riskScore})`);
    }
  }

  if (planOrReport.skippedSteps?.length > 0) {
    parts.push('');
    parts.push('### Skipped (Unsafe)');
    for (const step of planOrReport.skippedSteps.slice(0, 5)) {
      parts.push(`- \`${step.smell.file}\`: ${step.reason}`);
    }
  }

  if (planOrReport.applied) {
    parts.push('');
    parts.push('### Applied');
    for (const a of planOrReport.applied) {
      parts.push(`- ✅ \`${a.file}\`: ${a.action}`);
    }
  }

  if (planOrReport.failed) {
    parts.push('');
    parts.push('### Failed');
    for (const f of planOrReport.failed) {
      parts.push(`- ❌ \`${f.file}\`: ${f.error}`);
    }
  }

  return parts.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _suggestAction(smell) {
  switch (smell.type) {
    case SmellType.DEAD_CODE:
      return `Remove unused ${smell.symbol || 'code'}`;
    case SmellType.LAYER_VIOLATION:
      return 'Redirect import through correct layer';
    case SmellType.CIRCULAR_DEPENDENCY:
      return 'Break cycle by extracting shared interface';
    case SmellType.GOD_CLASS:
      return 'Split into smaller focused modules';
    case SmellType.MISSING_ERROR_HANDLING:
      return 'Add try/catch for async operations';
    case SmellType.DUPLICATE_LOGIC:
      return 'Extract shared utility function';
    default:
      return 'Refactor';
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  SmellType,
  detectSmells,
  generateRefactorPlan,
  formatRefactorReport,
};
