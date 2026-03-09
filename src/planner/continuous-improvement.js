// Continuous Improvement v115 (F13) — Post-Build Quality Enhancement
// ══════════════════════════════════════════════════════════════════════════════
//
// After milestones pass, identifies and executes improvement opportunities:
//   - Test coverage gaps
//   - Code quality issues (dead code, code smells)
//   - Documentation gaps
//
// Advisory mode — does NOT block milestones. Opt-in via config.
// Safeguards: maxFilesChangedPerCycle + maxLinesChanged limits.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Improvement Types ──────────────────────────────────────────────────────

export const ImprovementType = Object.freeze({
  TEST_COVERAGE:  'test_coverage',
  CODE_QUALITY:   'code_quality',
  DOCUMENTATION:  'documentation',
  DEAD_CODE:      'dead_code',
});

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_FILES_PER_CYCLE = 10;
const MAX_LINES_PER_CYCLE = 500;
const DEFAULT_MAX_ITEMS = 5;

// ─── Priority Weights ───────────────────────────────────────────────────────

const PRIORITY_WEIGHTS = {
  [ImprovementType.TEST_COVERAGE]:  4,
  [ImprovementType.CODE_QUALITY]:   3,
  [ImprovementType.DEAD_CODE]:      2,
  [ImprovementType.DOCUMENTATION]:  1,
};

// ─── Opportunity Analysis ───────────────────────────────────────────────────

/**
 * Analyze a project for improvement opportunities.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {Array}  [opts.changedFiles] - Files modified in recent build
 * @param {Object} [opts.testCoverage] - Coverage data { covered: string[], uncovered: string[] }
 * @param {Array}  [opts.codeSmells] - From code-analyzer or perf-analyzer
 * @param {Array}  [opts.deadSymbols] - From dead-code-detector
 * @param {Array}  [opts.undocumented] - Files without JSDoc/docstrings
 * @param {number} [opts.maxItems=5] - Max opportunities to return
 * @returns {Array<{ type: string, priority: number, file: string, description: string, estimatedEffort: string }>}
 */
export function analyzeImprovementOpportunities(projectPath, opts = {}) {
  const opportunities = [];
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;

  // Test coverage gaps
  if (opts.testCoverage) {
    const uncovered = opts.testCoverage.uncovered || [];
    for (const file of uncovered) {
      opportunities.push({
        type: ImprovementType.TEST_COVERAGE,
        priority: PRIORITY_WEIGHTS[ImprovementType.TEST_COVERAGE],
        file,
        description: `No test coverage for ${file}`,
        estimatedEffort: 'medium',
      });
    }
  }

  // Code smells
  if (opts.codeSmells && opts.codeSmells.length > 0) {
    for (const smell of opts.codeSmells) {
      opportunities.push({
        type: ImprovementType.CODE_QUALITY,
        priority: PRIORITY_WEIGHTS[ImprovementType.CODE_QUALITY],
        file: smell.file || '',
        description: smell.description || `Code quality issue: ${smell.type || 'unknown'}`,
        estimatedEffort: smell.severity === 'warning' ? 'low' : 'medium',
      });
    }
  }

  // Dead code
  if (opts.deadSymbols && opts.deadSymbols.length > 0) {
    for (const sym of opts.deadSymbols) {
      opportunities.push({
        type: ImprovementType.DEAD_CODE,
        priority: PRIORITY_WEIGHTS[ImprovementType.DEAD_CODE],
        file: sym.file || '',
        description: `Dead code: '${sym.name || sym.symbol || 'unknown'}' is never used`,
        estimatedEffort: 'low',
      });
    }
  }

  // Documentation gaps
  if (opts.undocumented && opts.undocumented.length > 0) {
    for (const file of opts.undocumented) {
      opportunities.push({
        type: ImprovementType.DOCUMENTATION,
        priority: PRIORITY_WEIGHTS[ImprovementType.DOCUMENTATION],
        file,
        description: `Missing documentation for ${file}`,
        estimatedEffort: 'low',
      });
    }
  }

  // Sort by priority (descending), then file name
  opportunities.sort((a, b) => b.priority - a.priority || a.file.localeCompare(b.file));

  return opportunities.slice(0, maxItems);
}

// ─── Improvement Execution ──────────────────────────────────────────────────

/**
 * Execute a single improvement opportunity.
 *
 * @param {Object} improvement - From analyzeImprovementOpportunities()
 * @param {Object} options
 * @param {Function} [options.callLLM] - (role, prompt) => { content }
 * @param {Function} [options.runTests] - () => { allPassed: boolean }
 * @param {Function} [options.applyPatch] - (patch) => { success: boolean }
 * @param {Function} [options.rollback] - (file) => void
 * @param {Function} [options.readFile] - (path) => string
 * @returns {Promise<{ success: boolean, filesModified: string[], linesChanged: number, report: string }>}
 */
export async function executeImprovement(improvement, options = {}) {
  if (!improvement) {
    return { success: false, filesModified: [], linesChanged: 0, report: 'No improvement provided' };
  }

  const { callLLM, runTests, applyPatch, rollback, readFile } = options;

  try {
    switch (improvement.type) {
      case ImprovementType.TEST_COVERAGE:
        return await _executeTestCoverage(improvement, { callLLM, runTests, applyPatch, rollback });
      case ImprovementType.CODE_QUALITY:
        return await _executeCodeQuality(improvement, { callLLM, runTests, applyPatch, rollback, readFile });
      case ImprovementType.DEAD_CODE:
        return await _executeDeadCode(improvement, { callLLM, runTests, applyPatch, rollback, readFile });
      case ImprovementType.DOCUMENTATION:
        return await _executeDocumentation(improvement, { callLLM, applyPatch, readFile });
      default:
        return { success: false, filesModified: [], linesChanged: 0, report: `Unknown type: ${improvement.type}` };
    }
  } catch (err) {
    logger.warn('ContinuousImprovement', `Improvement failed: ${err.message}`);
    return { success: false, filesModified: [], linesChanged: 0, report: err.message };
  }
}

async function _executeTestCoverage(improvement, { callLLM, runTests, applyPatch, rollback }) {
  if (!callLLM) return { success: false, filesModified: [], linesChanged: 0, report: 'No LLM available' };

  const testFile = improvement.file.replace(/\.(js|ts|py|go)$/, '.test.$1');
  const prompt = `Generate a test file for ${improvement.file}. Output ONLY the test code, no explanations.`;
  const result = await callLLM('CODE', prompt);
  const content = result?.content || '';
  if (!content.trim()) {
    return { success: false, filesModified: [], linesChanged: 0, report: 'LLM generated empty test' };
  }

  const linesChanged = content.split('\n').length;

  if (applyPatch) {
    const applied = await applyPatch({ file: testFile, content });
    if (!applied?.success) {
      return { success: false, filesModified: [], linesChanged: 0, report: 'Failed to write test file' };
    }
  }

  // Verify tests pass
  if (runTests) {
    const testResult = await runTests();
    if (testResult?.allPassed === false) {
      if (rollback) rollback(testFile);
      return { success: false, filesModified: [], linesChanged: 0, report: 'Generated test failed' };
    }
  }

  return { success: true, filesModified: [testFile], linesChanged, report: `Generated tests for ${improvement.file}` };
}

async function _executeCodeQuality(improvement, { callLLM, runTests, applyPatch, rollback, readFile }) {
  if (!callLLM || !readFile) return { success: false, filesModified: [], linesChanged: 0, report: 'Missing dependencies' };

  const content = readFile(improvement.file);
  if (!content) return { success: false, filesModified: [], linesChanged: 0, report: 'File not found' };

  const prompt = `Fix this code quality issue: ${improvement.description}\n\nFile: ${improvement.file}\n${content}\n\nOutput ONLY the fixed code.`;
  const result = await callLLM('CODE', prompt);
  const fixed = result?.content || '';
  if (!fixed.trim()) {
    return { success: false, filesModified: [], linesChanged: 0, report: 'LLM generated empty fix' };
  }

  const linesChanged = Math.abs(fixed.split('\n').length - content.split('\n').length) || 1;

  if (applyPatch) {
    const applied = await applyPatch({ file: improvement.file, content: fixed });
    if (!applied?.success) return { success: false, filesModified: [], linesChanged: 0, report: 'Patch failed' };
  }

  if (runTests) {
    const testResult = await runTests();
    if (testResult?.allPassed === false) {
      if (rollback) rollback(improvement.file);
      return { success: false, filesModified: [], linesChanged: 0, report: 'Fix caused regression' };
    }
  }

  return { success: true, filesModified: [improvement.file], linesChanged, report: `Fixed: ${improvement.description}` };
}

async function _executeDeadCode(improvement, { runTests, applyPatch, rollback, readFile }) {
  if (!readFile) return { success: false, filesModified: [], linesChanged: 0, report: 'Missing readFile' };

  const content = readFile(improvement.file);
  if (!content) return { success: false, filesModified: [], linesChanged: 0, report: 'File not found' };

  // Simple: remove the dead symbol (line-level removal)
  // For real use, this would need AST-level removal
  return { success: false, filesModified: [], linesChanged: 0, report: 'Dead code removal requires manual review' };
}

async function _executeDocumentation(improvement, { callLLM, applyPatch, readFile }) {
  if (!callLLM || !readFile) return { success: false, filesModified: [], linesChanged: 0, report: 'Missing dependencies' };

  const content = readFile(improvement.file);
  if (!content) return { success: false, filesModified: [], linesChanged: 0, report: 'File not found' };

  const prompt = `Add JSDoc/docstring comments to the exported functions in this file. Keep existing code unchanged. Output the FULL file with comments added.\n\n${content}`;
  const result = await callLLM('CODE', prompt);
  const documented = result?.content || '';
  if (!documented.trim()) {
    return { success: false, filesModified: [], linesChanged: 0, report: 'LLM generated empty output' };
  }

  const linesChanged = Math.abs(documented.split('\n').length - content.split('\n').length) || 1;

  if (applyPatch) {
    const applied = await applyPatch({ file: improvement.file, content: documented });
    if (!applied?.success) return { success: false, filesModified: [], linesChanged: 0, report: 'Patch failed' };
  }

  return { success: true, filesModified: [improvement.file], linesChanged, report: `Added docs to ${improvement.file}` };
}

// ─── Improvement Cycle ──────────────────────────────────────────────────────

/**
 * Run a full improvement cycle with safeguards.
 *
 * @param {string} projectPath
 * @param {Object} options
 * @param {Array}  [options.opportunities] - Pre-analyzed opportunities (skip analysis)
 * @param {Object} [options.analysisOpts] - Passed to analyzeImprovementOpportunities
 * @param {Array}  [options.types] - Filter to specific ImprovementTypes
 * @param {number} [options.maxItems=5]
 * @param {number} [options.maxFiles=10] - Stop if total files modified exceeds this
 * @param {number} [options.maxLines=500] - Stop if total lines changed exceeds this
 * @param {Function} [options.callLLM]
 * @param {Function} [options.runTests]
 * @param {Function} [options.applyPatch]
 * @param {Function} [options.rollback]
 * @param {Function} [options.readFile]
 * @returns {Promise<{ completed: Array, failed: Array, stoppedEarly: boolean, improvements: Array, report: string }>}
 */
export async function runImprovementCycle(projectPath, options = {}) {
  const maxFiles = options.maxFiles ?? MAX_FILES_PER_CYCLE;
  const maxLines = options.maxLines ?? MAX_LINES_PER_CYCLE;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;

  // Get opportunities
  let opportunities = options.opportunities || [];
  if (opportunities.length === 0 && options.analysisOpts) {
    opportunities = analyzeImprovementOpportunities(projectPath, {
      ...options.analysisOpts,
      maxItems,
    });
  }

  // Filter by type
  if (options.types && options.types.length > 0) {
    const typeSet = new Set(options.types);
    opportunities = opportunities.filter(o => typeSet.has(o.type));
  }

  // Execute improvements with safeguards
  const completed = [];
  const failed = [];
  let totalFiles = 0;
  let totalLines = 0;
  let stoppedEarly = false;

  for (const opp of opportunities) {
    // Check limits BEFORE executing
    if (totalFiles >= maxFiles) {
      stoppedEarly = true;
      logger.info('ContinuousImprovement', `Stopped: maxFiles limit (${maxFiles})`);
      break;
    }
    if (totalLines >= maxLines) {
      stoppedEarly = true;
      logger.info('ContinuousImprovement', `Stopped: maxLines limit (${maxLines})`);
      break;
    }

    const result = await executeImprovement(opp, {
      callLLM: options.callLLM,
      runTests: options.runTests,
      applyPatch: options.applyPatch,
      rollback: options.rollback,
      readFile: options.readFile,
    });

    if (result.success) {
      completed.push({ ...opp, result });
      totalFiles += result.filesModified.length;
      totalLines += result.linesChanged;
    } else {
      failed.push({ ...opp, result });
    }
  }

  const report = formatImprovementReport({ completed, failed, stoppedEarly });
  return { completed, failed, stoppedEarly, improvements: opportunities, report };
}

// ─── Report Formatting ──────────────────────────────────────────────────────

/**
 * Format improvement results as human-readable report.
 *
 * @param {{ completed: Array, failed: Array, stoppedEarly: boolean }} result
 * @returns {string}
 */
export function formatImprovementReport(result) {
  if (!result) return '';

  const parts = [];

  if (result.completed?.length > 0) {
    parts.push(`Completed (${result.completed.length}):`);
    for (const c of result.completed) {
      parts.push(`  ✓ [${c.type}] ${c.file}: ${c.result?.report || c.description}`);
    }
  }

  if (result.failed?.length > 0) {
    parts.push(`Failed (${result.failed.length}):`);
    for (const f of result.failed) {
      parts.push(`  ✗ [${f.type}] ${f.file}: ${f.result?.report || 'unknown'}`);
    }
  }

  if (result.stoppedEarly) {
    parts.push(`\n⚠ Stopped early — file or line limit reached`);
  }

  if (parts.length === 0) return 'No improvements executed';
  return parts.join('\n');
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  ImprovementType,
  analyzeImprovementOpportunities,
  executeImprovement,
  runImprovementCycle,
  formatImprovementReport,
};
