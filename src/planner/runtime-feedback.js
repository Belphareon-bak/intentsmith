// Runtime Feedback Loop v100 — Parse Build/Test Output for Pattern Detection
// ══════════════════════════════════════════════════════════════════════════════
//
// Parses existing execution output (test results, build errors, console output)
// to detect cross-milestone patterns and generate fix suggestions.
//
// NOT full telemetry — only parses data already collected in lifecycle-build.js.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Feedback Sources ───────────────────────────────────────────────────────

export const FeedbackSource = Object.freeze({
  TEST_OUTPUT: 'test',
  BUILD_OUTPUT: 'build',
  CHECKPOINT: 'checkpoint',
  QUALITY_GATE: 'quality',
});

// ─── Test Output Parser ─────────────────────────────────────────────────────

/**
 * Parse test runner output into structured feedback.
 * Detects: Jest, Mocha, pytest, go test, cargo test.
 *
 * @param {string} stdout
 * @param {string} [stderr]
 * @returns {Object} TestFeedback
 */
export function parseTestOutput(stdout, stderr = '') {
  const combined = `${stdout || ''}\n${stderr || ''}`;
  if (!combined.trim()) {
    return { passed: 0, failed: 0, skipped: 0, failures: [], framework: null };
  }

  let framework = null;
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  // Jest / Vitest: "Tests: X passed, Y failed"
  const jestMatch = combined.match(/Tests:\s*(\d+)\s+passed.*?(\d+)\s+failed/i) ||
                    combined.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
  if (jestMatch) {
    framework = 'jest';
    passed = parseInt(jestMatch[1], 10);
    failed = parseInt(jestMatch[2], 10);
  }

  // Jest skipped
  const jestSkip = combined.match(/(\d+)\s+skipped/i);
  if (jestSkip) skipped = parseInt(jestSkip[1], 10);

  // Mocha: "N passing", "M failing"
  const mochaPass = combined.match(/(\d+)\s+passing/);
  const mochaFail = combined.match(/(\d+)\s+failing/);
  if (mochaPass) {
    framework = framework || 'mocha';
    passed = parseInt(mochaPass[1], 10);
  }
  if (mochaFail) {
    failed = Math.max(failed, parseInt(mochaFail[1], 10));
  }

  // pytest: "X passed, Y failed"
  const pytestMatch = combined.match(/(\d+)\s+passed.*?(\d+)\s+failed/);
  if (pytestMatch && !framework) {
    framework = 'pytest';
    passed = parseInt(pytestMatch[1], 10);
    failed = parseInt(pytestMatch[2], 10);
  }

  // go test: "ok" / "FAIL"
  if (/^(ok|FAIL)\s+\S+/m.test(combined) && !framework) {
    framework = 'go';
    const okCount = (combined.match(/^ok\s+/gm) || []).length;
    const failCount = (combined.match(/^FAIL\s+/gm) || []).length;
    passed = okCount;
    failed = failCount;
  }

  // cargo test: "test result: ok. X passed; Y failed"
  const cargoMatch = combined.match(/test result:\s*\w+\.\s*(\d+)\s+passed;\s*(\d+)\s+failed/);
  if (cargoMatch && !framework) {
    framework = 'cargo';
    passed = parseInt(cargoMatch[1], 10);
    failed = parseInt(cargoMatch[2], 10);
  }

  // Extract failure details (FAIL lines + stack traces)
  const failLines = combined.split('\n');
  let inFailure = false;
  let currentFailure = null;

  for (const line of failLines) {
    if (/^\s*(FAIL|✕|✗|FAILED|Error:)\s/i.test(line) || /AssertionError|AssertError|assert/i.test(line)) {
      if (currentFailure) failures.push(currentFailure);
      currentFailure = { message: line.trim(), file: null, line: null };
      inFailure = true;
    } else if (inFailure && currentFailure) {
      // Try to extract file:line from stack trace
      const fileMatch = line.match(/\s+at\s+.*?\(?([\w./\\-]+\.(?:js|ts|py|go)):(\d+)/);
      if (fileMatch && !currentFailure.file) {
        currentFailure.file = fileMatch[1];
        currentFailure.line = parseInt(fileMatch[2], 10);
      }
      if (line.trim() === '' && currentFailure.file) {
        inFailure = false;
      }
    }
  }
  if (currentFailure) failures.push(currentFailure);

  return { passed, failed, skipped, failures: failures.slice(0, 20), framework };
}

// ─── Build Output Parser ────────────────────────────────────────────────────

/**
 * Parse build/compiler output into structured feedback.
 * Detects: tsc, eslint, webpack, go build, cargo build, gcc.
 *
 * @param {string} stdout
 * @param {string} [stderr]
 * @returns {Object} BuildFeedback
 */
export function parseBuildOutput(stdout, stderr = '') {
  const combined = `${stdout || ''}\n${stderr || ''}`;
  if (!combined.trim()) {
    return { errors: [], warnings: [], tool: null };
  }

  const errors = [];
  const warnings = [];
  let tool = null;

  // TypeScript (tsc): "file.ts(line,col): error TS..."
  const tscErrors = combined.matchAll(/([^\s]+\.tsx?)\((\d+),\d+\):\s*(error|warning)\s+(TS\d+):\s*(.+)/g);
  for (const m of tscErrors) {
    tool = tool || 'tsc';
    const entry = { file: m[1], line: parseInt(m[2], 10), code: m[4], message: m[5].trim() };
    if (m[3] === 'error') errors.push(entry);
    else warnings.push(entry);
  }

  // ESLint: "file.js:line:col: error/warning message (rule)"
  const eslintErrors = combined.matchAll(/([^\s]+\.(?:js|ts|jsx|tsx)):(\d+):\d+:\s*(error|warning)\s+(.+)/g);
  for (const m of eslintErrors) {
    tool = tool || 'eslint';
    const entry = { file: m[1], line: parseInt(m[2], 10), message: m[4].trim() };
    if (m[3] === 'error') errors.push(entry);
    else warnings.push(entry);
  }

  // Go: "file.go:line:col: ..."
  const goErrors = combined.matchAll(/([^\s]+\.go):(\d+):\d+:\s*(.+)/g);
  for (const m of goErrors) {
    tool = tool || 'go';
    errors.push({ file: m[1], line: parseInt(m[2], 10), message: m[3].trim() });
  }

  // Cargo/Rust: "error[E...]: message"
  const cargoErrors = combined.matchAll(/error\[E(\d+)\]:\s*(.+)/g);
  for (const m of cargoErrors) {
    tool = tool || 'cargo';
    errors.push({ code: `E${m[1]}`, message: m[2].trim() });
  }

  // Generic: SyntaxError, ReferenceError
  if (errors.length === 0) {
    const genericErrors = combined.matchAll(/(SyntaxError|ReferenceError|TypeError|ImportError|ModuleNotFoundError):\s*(.+)/g);
    for (const m of genericErrors) {
      errors.push({ type: m[1], message: m[2].trim() });
    }
  }

  return { errors: errors.slice(0, 30), warnings: warnings.slice(0, 20), tool };
}

// ─── Pattern Detection ──────────────────────────────────────────────────────

/**
 * Detect cross-milestone patterns in feedback history.
 *
 * @param {Array<Object>} feedbackHistory - Array of { milestoneId, source, errors[], warnings[], failures[] }
 * @returns {Array<Object>} Detected patterns
 */
export function detectPatterns(feedbackHistory) {
  if (!feedbackHistory || feedbackHistory.length < 2) return [];

  const patterns = [];
  const errorCounts = new Map();    // message → { count, milestones[] }
  const fileCounts = new Map();     // file → { errorCount, milestones[] }
  const flakyTests = new Map();     // testName → { pass, fail }

  for (const fb of feedbackHistory) {
    const msId = fb.milestoneId || 'unknown';

    // Count recurring errors
    for (const err of (fb.errors || [])) {
      const key = err.message?.substring(0, 100) || 'unknown';
      if (!errorCounts.has(key)) errorCounts.set(key, { count: 0, milestones: [] });
      const entry = errorCounts.get(key);
      entry.count++;
      if (!entry.milestones.includes(msId)) entry.milestones.push(msId);
    }

    // Count error-prone files
    for (const err of (fb.errors || [])) {
      if (!err.file) continue;
      if (!fileCounts.has(err.file)) fileCounts.set(err.file, { errorCount: 0, milestones: [] });
      const entry = fileCounts.get(err.file);
      entry.errorCount++;
      if (!entry.milestones.includes(msId)) entry.milestones.push(msId);
    }

    // Track flaky tests
    for (const failure of (fb.failures || [])) {
      const key = failure.message?.substring(0, 80) || 'unknown';
      if (!flakyTests.has(key)) flakyTests.set(key, { pass: 0, fail: 0 });
      flakyTests.get(key).fail++;
    }
  }

  // Identify recurring errors (same error in 2+ milestones)
  for (const [message, data] of errorCounts) {
    if (data.milestones.length >= 2) {
      patterns.push({
        type: 'RECURRING_ERROR',
        message,
        occurrences: data.count,
        milestones: data.milestones,
        severity: data.count >= 5 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // Identify error-prone files (errors in 2+ milestones)
  for (const [file, data] of fileCounts) {
    if (data.milestones.length >= 2) {
      patterns.push({
        type: 'ERROR_PRONE_FILE',
        file,
        errorCount: data.errorCount,
        milestones: data.milestones,
        severity: data.errorCount >= 5 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // Identify persistent warnings
  // (simplified: not implementing full flaky detection without pass/fail alternation data)

  return patterns.sort((a, b) => {
    const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
  });
}

// ─── Fix Suggestions ────────────────────────────────────────────────────────

/**
 * Generate fix suggestions from detected patterns. Deterministic, no LLM.
 *
 * @param {Array<Object>} patterns - From detectPatterns()
 * @returns {Array<Object>} Suggestions
 */
export function generateFixSuggestions(patterns) {
  if (!patterns || patterns.length === 0) return [];

  const suggestions = [];

  for (const p of patterns) {
    switch (p.type) {
      case 'RECURRING_ERROR':
        if (/import|require|module/i.test(p.message)) {
          suggestions.push({
            pattern: p.type,
            suggestion: `Fix import/module resolution: "${p.message.substring(0, 80)}"`,
            priority: 'HIGH',
          });
        } else if (/syntax|unexpected/i.test(p.message)) {
          suggestions.push({
            pattern: p.type,
            suggestion: `Fix recurring syntax error: "${p.message.substring(0, 80)}"`,
            priority: 'HIGH',
          });
        } else {
          suggestions.push({
            pattern: p.type,
            suggestion: `Investigate recurring error (${p.occurrences}× across ${p.milestones.length} milestones): "${p.message.substring(0, 80)}"`,
            priority: 'MEDIUM',
          });
        }
        break;

      case 'ERROR_PRONE_FILE':
        suggestions.push({
          pattern: p.type,
          suggestion: `\`${p.file}\` has ${p.errorCount} errors across ${p.milestones.length} milestones — consider refactoring or adding error handling`,
          priority: p.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        });
        break;

      case 'FLAKY_TEST':
        suggestions.push({
          pattern: p.type,
          suggestion: `Test "${p.testName}" appears flaky (${p.failRate}% fail rate) — isolate timing/order dependencies`,
          priority: 'MEDIUM',
        });
        break;
    }
  }

  return suggestions.slice(0, 10);
}

// ─── Feedback Collection ────────────────────────────────────────────────────

/**
 * Collect all feedback from a single milestone execution cycle.
 *
 * @param {string} milestoneId
 * @param {Object} [testResults] - { stdout, stderr }
 * @param {Object} [buildResult] - { stdout, stderr }
 * @param {Object} [checkpointResult] - From milestoneCheckpoint()
 * @returns {Object} Aggregated feedback
 */
export function collectFeedback(milestoneId, testResults, buildResult, checkpointResult) {
  const feedback = {
    milestoneId,
    timestamp: new Date().toISOString(),
    errors: [],
    warnings: [],
    failures: [],
    source: [],
  };

  // Parse test output
  if (testResults?.stdout || testResults?.stderr) {
    const testFb = parseTestOutput(testResults.stdout, testResults.stderr);
    feedback.failures.push(...testFb.failures);
    feedback.source.push(FeedbackSource.TEST_OUTPUT);

    if (testFb.failed > 0) {
      feedback.errors.push({
        type: 'test_failure',
        message: `${testFb.failed} test(s) failed (${testFb.framework || 'unknown'} framework)`,
      });
    }
  }

  // Parse build output
  if (buildResult?.stdout || buildResult?.stderr) {
    const buildFb = parseBuildOutput(buildResult.stdout, buildResult.stderr);
    feedback.errors.push(...buildFb.errors);
    feedback.warnings.push(...buildFb.warnings);
    feedback.source.push(FeedbackSource.BUILD_OUTPUT);
  }

  // Include checkpoint findings
  if (checkpointResult?.fix_instructions?.length > 0) {
    for (const inst of checkpointResult.fix_instructions) {
      feedback.errors.push({ type: 'checkpoint', message: inst });
    }
    feedback.source.push(FeedbackSource.CHECKPOINT);
  }

  return feedback;
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────

/**
 * Format feedback + patterns for injection into next milestone request.
 *
 * @param {Object} feedback - From collectFeedback()
 * @param {Array<Object>} patterns - From detectPatterns()
 * @param {number} [maxTokens=500] - Token limit for feedback section
 * @returns {string}
 */
export function formatFeedbackForPrompt(feedback, patterns, maxTokens = 500) {
  if (!feedback && (!patterns || patterns.length === 0)) return '';

  const parts = [];

  // Recent feedback
  if (feedback?.errors?.length > 0) {
    parts.push('### Previous Milestone Issues');
    for (const err of feedback.errors.slice(0, 5)) {
      const fileInfo = err.file ? ` (\`${err.file}\`)` : '';
      parts.push(`- ${err.message || err.type}${fileInfo}`);
    }
  }

  // Cross-milestone patterns
  if (patterns?.length > 0) {
    parts.push('');
    parts.push('### Detected Patterns (Cross-Milestone)');
    for (const p of patterns.slice(0, 5)) {
      parts.push(`- **${p.type}**: ${p.message || p.file || ''} (${p.occurrences || p.errorCount || 0} occurrences)`);
    }
  }

  // Suggestions
  if (patterns?.length > 0) {
    const suggestions = generateFixSuggestions(patterns);
    if (suggestions.length > 0) {
      parts.push('');
      parts.push('### Suggested Fixes');
      for (const s of suggestions.slice(0, 3)) {
        parts.push(`- ${s.suggestion}`);
      }
    }
  }

  if (parts.length === 0) return '';

  let result = parts.join('\n');

  // Trim to token budget (rough: 4 chars per token)
  const maxChars = maxTokens * 4;
  if (result.length > maxChars) {
    result = result.substring(0, maxChars) + '\n... [truncated]';
  }

  return result;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  FeedbackSource,
  parseTestOutput,
  parseBuildOutput,
  detectPatterns,
  generateFixSuggestions,
  collectFeedback,
  formatFeedbackForPrompt,
};
