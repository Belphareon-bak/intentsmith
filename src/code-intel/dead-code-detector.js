// ══════════════════════════════════════════════════════════════════════════════
// Dead Code Detector v1 — Detects unused symbols using SymbolIndex
// ══════════════════════════════════════════════════════════════════════════════
//
// Uses the existing SymbolIndex to find symbols with zero real references
// (excluding their own definition line). Applies false-positive filters for
// framework entrypoints, lifecycle hooks, test files, and dynamic usage.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFile } from 'fs/promises';
import path from 'path';
import { symbolIndex } from './symbol-index.js';
import { collectCodeFiles, findReferencesInFile } from './index-builder.js';
import { extractImports } from './context-builder.js';
import { logger } from '../core/logger.js';

// ─── Framework Entrypoint Patterns ──────────────────────────────────────────

const HANDLER_PATTERN = /^(get|post|put|delete|patch|head|options|handle)/i;
const LIFECYCLE_PATTERN = /^(on|before|after|init|setup|teardown|configure|register|mount)/i;
const MAGIC_PATTERN = /^(__\w+__|toString|valueOf|constructor|dispose|destroy)$/;
const MAIN_PATTERN = /^(main|run|start|bootstrap|serve|execute)$/i;

const TEST_DIR_PATTERN = /(?:^|[/\\])(test|tests|__tests__|spec)[/\\]/;
const ROUTING_FILE_PATTERN = /(routes|router|handler)/;

// ─── Entry Point Detection ──────────────────────────────────────────────────

/**
 * Detect entry point files in a project.
 * Entry points are files like main.js, index.js, server.js, app.js, etc.
 *
 * @param {string} projectPath
 * @param {string[]} files - Relative file paths
 * @returns {string[]}
 */
function detectEntryPoints(files) {
  const entryPatterns = /^(index|main|server|app|cli|bin)[./]/i;
  return files.filter(f => {
    const base = path.basename(f);
    return entryPatterns.test(base);
  });
}

// ─── False Positive Filters ─────────────────────────────────────────────────

/**
 * Check if a symbol should be considered safe (not dead) based on heuristics.
 *
 * @param {Object} symbol - { name, type, file, line, exported }
 * @param {Object} opts - { includeExported }
 * @returns {boolean} true if the symbol is SAFE (should NOT be reported as dead)
 */
function isSymbolSafe(symbol, opts) {
  // Exported symbols are safe by default (public API)
  if (symbol.exported === true && !opts.includeExported) {
    return true;
  }

  const name = symbol.name;

  // Framework entrypoint patterns
  if (HANDLER_PATTERN.test(name)) return true;
  if (LIFECYCLE_PATTERN.test(name)) return true;
  if (MAGIC_PATTERN.test(name)) return true;
  if (MAIN_PATTERN.test(name)) return true;

  // Test files — symbols in test directories are safe
  if (TEST_DIR_PATTERN.test(symbol.file)) return true;

  // ALL_CAPS constants — likely runtime configuration
  if (symbol.type === 'constant' && /^[A-Z][A-Z0-9_]+$/.test(name)) return true;

  // Routing files — handlers registered dynamically
  if (ROUTING_FILE_PATTERN.test(symbol.file)) return true;

  return false;
}

// ─── Dynamic Usage Detection ────────────────────────────────────────────────

/**
 * Check if a symbol name appears as a string literal in any project file,
 * indicating potential dynamic usage (e.g., reflection, bracket access).
 *
 * @param {string} projectPath
 * @param {string[]} files - Relative file paths
 * @param {string} symbolName
 * @returns {Promise<boolean>}
 */
async function hasDynamicUsage(projectPath, files, symbolName) {
  // Only check for names that could plausibly be used dynamically
  // (skip very short names to avoid false matches)
  if (symbolName.length < 3) return false;

  const singleQuoted = `'${symbolName}'`;
  const doubleQuoted = `"${symbolName}"`;

  for (const file of files) {
    const absPath = path.join(projectPath, file);
    try {
      const content = await readFile(absPath, 'utf8');
      if (content.includes(singleQuoted) || content.includes(doubleQuoted)) {
        return true;
      }
    } catch {
      // skip unreadable files
    }
  }

  return false;
}

// ─── Reference Counting ─────────────────────────────────────────────────────

/**
 * Count real references to a symbol (excluding the definition itself).
 *
 * A reference on the SAME line in the SAME file as the definition is the
 * definition itself, not a usage. Only count references on different lines
 * or in different files.
 *
 * @param {Array<{file: string, line: number, context: string}>} refs
 * @param {Object} symbol - { name, file, line }
 * @returns {number}
 */
function countRealReferences(refs, symbol) {
  let count = 0;
  for (const ref of refs) {
    // Skip the definition line itself
    if (ref.file === symbol.file && ref.line === symbol.line) {
      continue;
    }
    count++;
  }
  return count;
}

// ─── Main Detection ─────────────────────────────────────────────────────────

/**
 * Detect dead (unused) code in a project.
 *
 * @param {string} projectPath - Absolute path to project root
 * @param {Object} [opts]
 * @param {number} [opts.maxFiles=5000] - Maximum files to scan
 * @param {boolean} [opts.includeExported=false] - Whether to check exported symbols
 * @returns {Promise<{deadSymbols: Array<{name, type, file, line, confidence}>, stats: {totalSymbols, deadCount, scanTime}, entryPoints: string[]}>}
 */
export async function detectDeadCode(projectPath, opts = {}) {
  const maxFiles = opts.maxFiles ?? 5000;
  const includeExported = opts.includeExported ?? false;
  const effectiveOpts = { maxFiles, includeExported };

  const start = Date.now();

  // Step 1: Build index if empty
  if (symbolIndex.symbolCount === 0) {
    await symbolIndex.buildIndex(projectPath, { maxFiles });
  }

  // Step 2: Collect files and detect entry points
  const files = await collectCodeFiles(projectPath, maxFiles);
  const entryPoints = detectEntryPoints(files);

  // Step 3: Analyze each symbol
  const deadSymbols = [];
  let totalSymbols = 0;

  for (const [name, symbols] of symbolIndex.symbolsByName) {
    for (const symbol of symbols) {
      totalSymbols++;

      // Apply false positive filters
      if (isSymbolSafe(symbol, effectiveOpts)) {
        continue;
      }

      // Find all references across the project
      const refs = await symbolIndex.findReferences(name);
      const realRefCount = countRealReferences(refs, symbol);

      if (realRefCount === 0) {
        // Check for dynamic usage (string-form references)
        const dynamicUsed = await hasDynamicUsage(projectPath, files, name);
        if (dynamicUsed) {
          continue;
        }

        // Determine confidence
        const confidence = (symbol.exported === true && includeExported)
          ? 0.6   // exported but unused within project — might be used externally
          : 0.9;  // internal + unreferenced — very likely dead

        deadSymbols.push({
          name: symbol.name,
          type: symbol.type,
          file: symbol.file,
          line: symbol.line,
          confidence,
        });
      }
    }
  }

  const scanTime = Date.now() - start;

  logger.info('DeadCodeDetector', `Scan complete: ${deadSymbols.length} dead symbols found in ${totalSymbols} total (${scanTime}ms)`);

  return {
    deadSymbols,
    stats: {
      totalSymbols,
      deadCount: deadSymbols.length,
      scanTime,
    },
    entryPoints,
  };
}

// ─── Report Formatting ──────────────────────────────────────────────────────

/**
 * Format dead code detection results as a markdown report.
 *
 * @param {Object} result - Return value from detectDeadCode()
 * @returns {string} Markdown string
 */
export function formatDeadCodeReport(result) {
  const { deadSymbols, stats, entryPoints } = result;

  const lines = [];
  lines.push('## Dead Code Report');
  lines.push('');
  lines.push(`Scanned **${stats.totalSymbols}** symbols, found **${stats.deadCount}** potentially unused.`);
  lines.push(`Scan time: ${stats.scanTime}ms`);
  lines.push('');

  if (entryPoints.length > 0) {
    lines.push('### Entry Points');
    for (const ep of entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push('');
  }

  if (deadSymbols.length === 0) {
    lines.push('No dead code detected.');
    return lines.join('\n');
  }

  // Group by file
  const byFile = new Map();
  for (const sym of deadSymbols) {
    const existing = byFile.get(sym.file) || [];
    existing.push(sym);
    byFile.set(sym.file, existing);
  }

  lines.push('### Dead Symbols by File');
  lines.push('');

  for (const [file, syms] of byFile) {
    lines.push(`#### \`${file}\``);
    lines.push('');
    for (const sym of syms) {
      const confLabel = sym.confidence >= 0.8 ? 'high' : 'medium';
      lines.push(`- **${sym.name}** (${sym.type}, line ${sym.line}) — confidence: ${confLabel}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get a one-line summary of dead code detection results.
 *
 * @param {Object} result - Return value from detectDeadCode()
 * @returns {string}
 */
export function getDeadCodeSummary(result) {
  const { deadSymbols, stats } = result;

  if (deadSymbols.length === 0) {
    return `No unused symbols found among ${stats.totalSymbols} total symbols.`;
  }

  // Count by confidence level
  const fileSet = new Set(deadSymbols.map(s => s.file));
  const high = deadSymbols.filter(s => s.confidence >= 0.8).length;
  const medium = deadSymbols.length - high;

  const parts = [];
  if (high > 0) parts.push(`high ${high}`);
  if (medium > 0) parts.push(`medium ${medium}`);

  return `Found ${deadSymbols.length} potentially unused symbols in ${fileSet.size} files (confidence: ${parts.join(', ')})`;
}

// ─── Default Export ─────────────────────────────────────────────────────────

export default { detectDeadCode, formatDeadCodeReport, getDeadCodeSummary };
