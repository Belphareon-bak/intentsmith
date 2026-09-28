// Test Coverage Explorer v1 — Heuristic test↔source matching
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects which code has tests and which doesn't, without running coverage tools.
//
// Signals:
//   1. Test file naming conventions (auth.test.js ↔ auth.js)
//   2. Import analysis (test imports source)
//   3. Describe/it block names matching symbol names
//   4. Test framework detection
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { collectCodeFiles } from './index-builder.js';
import { extractImports } from './context-builder.js';
import { detectLanguage } from './code-analyzer.js';
import { readFile } from 'fs/promises';
import path from 'path';

// ─── Constants ──────────────────────────────────────────────────────────────

const TEST_DIR_RE = /(?:^|[/\\])(test|tests|__tests__|spec|e2e)[/\\]/;
const TEST_FILE_RE = /\.(test|spec|_test|tests)\.[^.]+$|^test_/;

const TEST_BLOCK_RE = /(?:describe|it|test|suite)\s*\(\s*['"`]([^'"`]+)['"`]/g;

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Explore test coverage heuristically.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {number} [opts.maxFiles=5000]
 * @param {string[]} [opts.symbolNames] - Specific symbols to check
 * @returns {Promise<CoverageResult>}
 */
export async function exploreTestCoverage(projectPath, opts = {}) {
  const start = Date.now();
  const files = await collectCodeFiles(projectPath, opts.maxFiles || 5000);

  // Separate source and test files
  const sourceFiles = [];
  const testFiles = [];

  for (const f of files) {
    if (isTestFile(f)) testFiles.push(f);
    else sourceFiles.push(f);
  }

  // Build test→source mapping
  const testSourceMap = new Map(); // testFile → [sourceFile, ...]
  const sourceTestMap = new Map(); // sourceFile → [testFile, ...]
  const testedSymbols = new Set();

  for (const testFile of testFiles) {
    const absPath = path.join(projectPath, testFile);
    let content;
    try {
      content = await readFile(absPath, 'utf8');
    } catch { continue; }

    const language = detectLanguage(testFile);
    const mappedSources = [];

    // Signal 1: Naming convention
    const baseName = extractBaseName(testFile);
    for (const src of sourceFiles) {
      const srcBase = path.basename(src).replace(/\.[^.]+$/, '');
      if (srcBase === baseName) {
        mappedSources.push(src);
      }
    }

    // Signal 2: Import analysis
    const imports = extractImports(content, language);
    for (const imp of imports) {
      if (!imp.startsWith('.') && !imp.startsWith('/')) continue;
      // Resolve relative import
      const testDir = path.dirname(testFile);
      const resolved = path.posix.normalize(path.posix.join(testDir, imp));

      for (const src of sourceFiles) {
        const srcNoExt = src.replace(/\.[^.]+$/, '');
        if (resolved === src || resolved === srcNoExt) {
          if (!mappedSources.includes(src)) mappedSources.push(src);
        }
      }
    }

    // Signal 3: Describe/it block names
    const blocks = [];
    const regex = new RegExp(TEST_BLOCK_RE.source, TEST_BLOCK_RE.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      blocks.push(match[1]);
    }

    for (const blockName of blocks) {
      testedSymbols.add(blockName);
      // Try matching block name to source file
      const normalized = blockName.replace(/\s+/g, '').toLowerCase();
      for (const src of sourceFiles) {
        const srcBase = path.basename(src).replace(/\.[^.]+$/, '').toLowerCase();
        if (normalized.includes(srcBase) || srcBase.includes(normalized)) {
          if (!mappedSources.includes(src)) mappedSources.push(src);
        }
      }
    }

    if (mappedSources.length > 0) {
      testSourceMap.set(testFile, mappedSources);
      for (const src of mappedSources) {
        const existing = sourceTestMap.get(src) || [];
        if (!existing.includes(testFile)) existing.push(testFile);
        sourceTestMap.set(src, existing);
      }
    }
  }

  // Identify untested source files
  const untestedFiles = sourceFiles.filter(f => !sourceTestMap.has(f));

  // Check specific symbols if requested
  let untestedSymbols = [];
  if (opts.symbolNames) {
    untestedSymbols = opts.symbolNames.filter(s => !testedSymbols.has(s));
  }

  const scanTime = Date.now() - start;

  logger.info('TestCoverage', `Scan: ${sourceFiles.length} source, ${testFiles.length} test, ${untestedFiles.length} untested (${scanTime}ms)`);

  return {
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    testedFiles: sourceTestMap.size,
    untestedFiles,
    untestedSymbols,
    testSourceMap: Object.fromEntries(testSourceMap),
    sourceTestMap: Object.fromEntries(sourceTestMap),
    testedSymbols: [...testedSymbols],
    coverageEstimate: sourceFiles.length > 0
      ? Math.round((sourceTestMap.size / sourceFiles.length) * 100)
      : 0,
    scanTime,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format coverage report as markdown.
 */
export function formatCoverageReport(result) {
  const parts = ['## Test Coverage Analysis'];
  parts.push(`**Coverage estimate:** ~${result.coverageEstimate}% of source files have tests`);
  parts.push(`**Source files:** ${result.sourceFiles} | **Test files:** ${result.testFiles} | **Tested:** ${result.testedFiles}`);
  parts.push('');

  if (result.untestedFiles.length > 0) {
    parts.push('### Files Without Tests');
    for (const f of result.untestedFiles.slice(0, 20)) {
      parts.push(`- ${f}`);
    }
    if (result.untestedFiles.length > 20) {
      parts.push(`- ... and ${result.untestedFiles.length - 20} more`);
    }
    parts.push('');
  }

  if (result.untestedSymbols.length > 0) {
    parts.push('### Untested Symbols');
    for (const s of result.untestedSymbols.slice(0, 20)) {
      parts.push(`- \`${s}\``);
    }
    parts.push('');
  }

  const mappingEntries = Object.entries(result.sourceTestMap);
  if (mappingEntries.length > 0) {
    parts.push('### Test Mapping');
    for (const [src, tests] of mappingEntries.slice(0, 10)) {
      parts.push(`- ${src} → ${tests.join(', ')}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Quick summary.
 */
export function getCoverageSummary(result) {
  return `~${result.coverageEstimate}% coverage: ${result.testedFiles}/${result.sourceFiles} files tested, ${result.untestedFiles.length} untested`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isTestFile(filePath) {
  return TEST_DIR_RE.test(filePath) || TEST_FILE_RE.test(path.basename(filePath));
}

function extractBaseName(testFile) {
  const base = path.basename(testFile);
  // Remove test suffixes: foo.test.js → foo, test_foo.py → foo
  return base
    .replace(/\.(test|spec|_test|tests)\.[^.]+$/, '')
    .replace(/^test_/, '')
    .replace(/\.[^.]+$/, '');
}

export default { exploreTestCoverage, formatCoverageReport, getCoverageSummary };
