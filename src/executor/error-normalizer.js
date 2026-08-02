// Error Normalizer v104 (F2) — Structured Error Classification
// ══════════════════════════════════════════════════════════════════════════════
//
// Transforms raw build/test output into structured NormalizedError objects.
// Deterministic (no LLM calls), no filesystem I/O.
//
// Key features:
//   - 32-entry ERROR_MAP with symbol extraction
//   - Root-cause cascade detection (IMPORT_NOT_FOUND → downstream)
//   - Recoverability classification
//   - LLM-friendly formatting with root-cause prioritization
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const ERROR_CODES = Object.freeze({
  MISSING_PROPERTY:   'MISSING_PROPERTY',
  TYPE_MISMATCH:      'TYPE_MISMATCH',
  UNDEFINED_VARIABLE: 'UNDEFINED_VARIABLE',
  IMPORT_NOT_FOUND:   'IMPORT_NOT_FOUND',
  SYNTAX_ERROR:       'SYNTAX_ERROR',
  NULL_REFERENCE:     'NULL_REFERENCE',
  ASSERTION_FAILED:   'ASSERTION_FAILED',
  TEST_FAILED:        'TEST_FAILED',
  FILE_NOT_FOUND:     'FILE_NOT_FOUND',
  PERMISSION_DENIED:  'PERMISSION_DENIED',
  UNUSED_IMPORT:      'UNUSED_IMPORT',
  ARGUMENT_COUNT:     'ARGUMENT_COUNT',
  MISSING_TYPE:       'MISSING_TYPE',
  UNKNOWN:            'UNKNOWN',
});

// ─── Error Map (ordered: most specific first, generic last) ──────────────────

const ERROR_MAP = [
  // ── TypeScript compile ────────────────────────────────────────────────────
  { pattern: /TS2339:.*Property '([^']+)' does not exist/,
    code: ERROR_CODES.MISSING_PROPERTY, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /TS2345:.*Argument of type '([^']+)' is not assignable/,
    code: ERROR_CODES.TYPE_MISMATCH, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /TS2554:.*Expected (\d+) arguments/,
    code: ERROR_CODES.ARGUMENT_COUNT, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /TS2304:.*Cannot find name '([^']+)'/,
    code: ERROR_CODES.UNDEFINED_VARIABLE, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /TS2307:.*Cannot find module '([^']+)'/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /TS7006:.*'([^']+)'.*implicitly has.*'any'/,
    code: ERROR_CODES.MISSING_TYPE, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /TS(?:1005|1003|1128):/,
    code: ERROR_CODES.SYNTAX_ERROR, category: 'compile' },
  // ── TypeScript lint ───────────────────────────────────────────────────────
  { pattern: /TS6133:.*'([^']+)' is declared but/,
    code: ERROR_CODES.UNUSED_IMPORT, category: 'lint',
    symbolExtractor: m => m[1] },
  // ── JavaScript runtime ────────────────────────────────────────────────────
  { pattern: /TypeError: Cannot read propert(?:y|ies) of (?:undefined|null)/,
    code: ERROR_CODES.NULL_REFERENCE, category: 'runtime' },
  { pattern: /TypeError: (\w+) is not a function/,
    code: ERROR_CODES.TYPE_MISMATCH, category: 'runtime',
    symbolExtractor: m => m[1] },
  { pattern: /ReferenceError: (\w+) is not defined/,
    code: ERROR_CODES.UNDEFINED_VARIABLE, category: 'runtime',
    symbolExtractor: m => m[1] },
  // ── JavaScript compile ────────────────────────────────────────────────────
  { pattern: /SyntaxError: Unexpected token/,
    code: ERROR_CODES.SYNTAX_ERROR, category: 'compile' },
  { pattern: /SyntaxError: (?:Cannot use import|missing \)|Unexpected reserved word)/,
    code: ERROR_CODES.SYNTAX_ERROR, category: 'compile' },
  // ── Module resolution ─────────────────────────────────────────────────────
  { pattern: /Module not found:.*(?:Can't|Cannot) resolve '([^']+)'/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /Error:\s*Cannot find module '([^']+)'/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  // ── Python ────────────────────────────────────────────────────────────────
  { pattern: /ImportError: No module named (\S+)/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /ModuleNotFoundError:.*?'?(\S+?)'?\s*$/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /IndentationError:/,
    code: ERROR_CODES.SYNTAX_ERROR, category: 'compile' },
  { pattern: /NameError: name '(\w+)' is not defined/,
    code: ERROR_CODES.UNDEFINED_VARIABLE, category: 'runtime',
    symbolExtractor: m => m[1] },
  { pattern: /AttributeError:.*no attribute '(\w+)'/,
    code: ERROR_CODES.MISSING_PROPERTY, category: 'runtime',
    symbolExtractor: m => m[1] },
  // ── Go ────────────────────────────────────────────────────────────────────
  { pattern: /undefined: (\w+)/,
    code: ERROR_CODES.UNDEFINED_VARIABLE, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /cannot find package "([^"]+)"/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /(\w+) declared.*not used/,
    code: ERROR_CODES.UNUSED_IMPORT, category: 'lint',
    symbolExtractor: m => m[1] },
  // ── Java ──────────────────────────────────────────────────────────────────
  { pattern: /cannot find symbol/,
    code: ERROR_CODES.MISSING_PROPERTY, category: 'compile' },
  { pattern: /symbol:\s*\w+\s+(\w+)/,
    code: ERROR_CODES.MISSING_PROPERTY, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /package (\S+) does not exist/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  // ── Rust ──────────────────────────────────────────────────────────────────
  { pattern: /error\[E0433\]:.*`(\w+)`/,
    code: ERROR_CODES.IMPORT_NOT_FOUND, category: 'compile',
    symbolExtractor: m => m[1] },
  { pattern: /error\[E0425\]:.*`(\w+)`/,
    code: ERROR_CODES.UNDEFINED_VARIABLE, category: 'compile',
    symbolExtractor: m => m[1] },
  // ── Test assertions ───────────────────────────────────────────────────────
  { pattern: /Assertion(?:Error)?:.*expected/i,
    code: ERROR_CODES.ASSERTION_FAILED, category: 'test' },
  // ── Filesystem ────────────────────────────────────────────────────────────
  { pattern: /ENOENT:.*no such file or directory.*?'([^']+)'/,
    code: ERROR_CODES.FILE_NOT_FOUND, category: 'runtime',
    symbolExtractor: m => m[1] },
  { pattern: /EACCES:.*permission denied/,
    code: ERROR_CODES.PERMISSION_DENIED, category: 'runtime' },
  // ── Lint ──────────────────────────────────────────────────────────────────
  { pattern: /no-unused-vars|unused.*import/i,
    code: ERROR_CODES.UNUSED_IMPORT, category: 'lint' },
  // ── Generic (LAST — lowest priority) ──────────────────────────────────────
  { pattern: /(?:FAIL|FAILED)\s/,
    code: ERROR_CODES.TEST_FAILED, category: 'test' },
];

// ─── File:Line Extraction ────────────────────────────────────────────────────

const FILE_LINE_PATTERNS = [
  /([^\s:(]+\.(?:js|ts|jsx|tsx|py|go|java|rs|rb)):(\d+)/,            // generic file:line
  /([^\s]+\.(?:js|ts|jsx|tsx))\((\d+),\d+\)/,                       // tsc: file.ts(42,5)
  /File "([^"]+)", line (\d+)/,                                       // Python traceback
  /at\s+.*?\(([\w./\\-]+\.(?:js|ts|py|go|java)):(\d+)/,              // JS stack trace
];

const FILE_LINE_WINDOW = 5;

function _extractFileLocation(lines, currentIdx) {
  for (let j = currentIdx; j < Math.min(lines.length, currentIdx + FILE_LINE_WINDOW + 1); j++) {
    for (const pat of FILE_LINE_PATTERNS) {
      const m = lines[j].match(pat);
      if (m) return { file: m[1], lineNum: parseInt(m[2], 10) };
    }
  }
  return { file: null, lineNum: null };
}

// ─── Recoverability ──────────────────────────────────────────────────────────

const RECOVERABLE_CODES = new Set([
  ERROR_CODES.MISSING_PROPERTY,
  ERROR_CODES.UNDEFINED_VARIABLE,
  ERROR_CODES.IMPORT_NOT_FOUND,
  ERROR_CODES.SYNTAX_ERROR,
  ERROR_CODES.UNUSED_IMPORT,
  ERROR_CODES.FILE_NOT_FOUND,
  ERROR_CODES.NULL_REFERENCE,
  ERROR_CODES.ASSERTION_FAILED,
  ERROR_CODES.TYPE_MISMATCH,
  ERROR_CODES.ARGUMENT_COUNT,
  ERROR_CODES.MISSING_TYPE,
]);

const UNRECOVERABLE_CODES = new Set([
  ERROR_CODES.PERMISSION_DENIED,
]);

// ─── Normalize Errors ────────────────────────────────────────────────────────

/**
 * Transform raw build/test output into NormalizedError[].
 *
 * Dual-mode:
 *   - String: splits by newlines, matches each against ERROR_MAP
 *   - Array: enriches pre-parsed error objects from runtime-feedback
 *
 * @param {string|Array} rawOutput - Raw stdout+stderr string, or array of {file, line, message}
 * @param {string} [language] - Optional hint (unused currently, reserved for future filtering)
 * @returns {Array<Object>} NormalizedError[]
 */
export function normalizeErrors(rawOutput, language) {
  if (!rawOutput) return [];

  // Pre-parsed object array path
  if (Array.isArray(rawOutput)) {
    return rawOutput.map(err => _normalizeOneFromParsed(err)).filter(Boolean);
  }

  // Raw string path
  const lines = String(rawOutput).split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    for (const entry of ERROR_MAP) {
      const match = line.match(entry.pattern);
      if (!match) continue;

      const { file, lineNum } = _extractFileLocation(lines, i);

      results.push({
        code: entry.code,
        file: file || '',
        line: lineNum,
        symbol: entry.symbolExtractor ? entry.symbolExtractor(match) : null,
        message: line.trim(),
        raw: lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + FILE_LINE_WINDOW)).join('\n'),
        severity: entry.category === 'lint' ? 'warning' : 'error',
        category: entry.category,
        recoverable: false,
        derivedFrom: null,
      });
      break; // first match wins per line
    }
  }

  return results;
}

/**
 * Normalize a single pre-parsed error object.
 */
function _normalizeOneFromParsed(err) {
  if (!err) return null;
  const text = err.message || '';

  for (const entry of ERROR_MAP) {
    const match = text.match(entry.pattern);
    if (!match) continue;
    return {
      code: entry.code,
      file: err.file || '',
      line: err.line ?? null,
      symbol: entry.symbolExtractor ? entry.symbolExtractor(match) : null,
      message: text,
      raw: text,
      severity: entry.category === 'lint' ? 'warning' : 'error',
      category: entry.category,
      recoverable: false,
      derivedFrom: null,
    };
  }

  // No pattern matched → UNKNOWN
  return {
    code: ERROR_CODES.UNKNOWN,
    file: err.file || '',
    line: err.line ?? null,
    symbol: null,
    message: text,
    raw: text,
    severity: 'error',
    category: 'compile',
    recoverable: false,
    derivedFrom: null,
  };
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Remove duplicate errors (same code + file + line). Keeps first occurrence.
 *
 * @param {Array<Object>} errors
 * @returns {Array<Object>}
 */
export function deduplicateErrors(errors) {
  if (!errors || errors.length === 0) return [];

  const seen = new Set();
  return errors.filter(err => {
    const key = `${err.code}|${err.file}|${err.line ?? '?'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Recoverability Classification ───────────────────────────────────────────

/**
 * Classify whether an error is likely auto-fixable by LLM.
 *
 * @param {Object} error - NormalizedError
 * @returns {boolean}
 */
export function classifyRecoverability(error) {
  if (!error) return false;
  if (UNRECOVERABLE_CODES.has(error.code)) return false;
  if (RECOVERABLE_CODES.has(error.code)) return true;

  // TEST_FAILED: recoverable only if file location is known
  if (error.code === ERROR_CODES.TEST_FAILED) {
    return !!error.file;
  }

  // Heuristic for UNKNOWN: compile + lint are usually recoverable
  return error.category === 'compile' || error.category === 'lint';
}

// ─── Root Cause Detection ────────────────────────────────────────────────────

/**
 * Extract module name from import error message.
 * '@org/pkg/util' → 'util', './config' → 'config', 'express' → 'express'
 */
function _extractModuleName(message) {
  const m = message.match(/['"]([^'"]+)['"]/);
  if (!m) return null;
  const full = m[1];
  const parts = full.split('/');
  return parts[parts.length - 1];
}

/**
 * Heuristic: does the symbol likely come from the missing module?
 * Tightened: exact match or symbol.startsWith(module). No reverse containment.
 */
function _symbolLikelyFromModule(symbol, moduleName) {
  if (!symbol || !moduleName) return false;
  const symLower = symbol.toLowerCase();
  const modLower = moduleName.toLowerCase();
  if (symLower === modLower) return true;
  if (symLower.startsWith(modLower) && modLower.length >= 2) return true;
  return false;
}

/**
 * Annotate downstream errors with `derivedFrom` pointing to root cause.
 *
 * Rule: IMPORT_NOT_FOUND → downstream UNDEFINED_VARIABLE / MISSING_PROPERTY
 * in same file or with matching symbol.
 *
 * Returns a new array (does not mutate input).
 *
 * @param {Array<Object>} errors
 * @returns {Array<Object>}
 */
export function findRootCause(errors) {
  if (!errors || errors.length === 0) return [];
  if (errors.length < 2) return errors.map(e => ({ ...e, derivedFrom: e.derivedFrom ?? null }));

  const result = errors.map(e => ({ ...e, derivedFrom: e.derivedFrom ?? null }));

  const importErrors = result.filter(e => e.code === ERROR_CODES.IMPORT_NOT_FOUND);
  if (importErrors.length === 0) return result;

  // Build module name map
  const missingModules = new Map();
  for (const ie of importErrors) {
    const moduleName = ie.symbol || _extractModuleName(ie.message);
    if (moduleName) missingModules.set(moduleName, ie);
  }

  // Mark downstream errors
  for (const err of result) {
    if (err.code === ERROR_CODES.IMPORT_NOT_FOUND) continue;
    if (err.derivedFrom) continue;

    // Case A: Same file as an IMPORT_NOT_FOUND
    if (err.file && (err.code === ERROR_CODES.UNDEFINED_VARIABLE || err.code === ERROR_CODES.MISSING_PROPERTY)) {
      if (importErrors.some(ie => ie.file && ie.file === err.file)) {
        err.derivedFrom = ERROR_CODES.IMPORT_NOT_FOUND;
        continue;
      }
    }

    // Case B: Symbol matches missing module name
    if (err.symbol && err.code === ERROR_CODES.UNDEFINED_VARIABLE) {
      for (const [moduleName] of missingModules) {
        if (_symbolLikelyFromModule(err.symbol, moduleName)) {
          err.derivedFrom = ERROR_CODES.IMPORT_NOT_FOUND;
          break;
        }
      }
    }
  }

  return result;
}

// ─── LLM Formatting ─────────────────────────────────────────────────────────

/**
 * Format a single error as markdown line.
 */
function _formatSingleError(err, includeRaw) {
  const loc = err.file ? `\`${err.file}${err.line ? ':' + err.line : ''}\`` : '';
  const sym = err.symbol ? ` (symbol: \`${err.symbol}\`)` : '';
  const rec = err.recoverable ? '' : ' [manual fix likely needed]';
  let line = `- **${err.code}** ${loc}${sym}: ${err.message}${rec}`;
  if (includeRaw && err.raw !== err.message) {
    line += `\n  Raw: ${err.raw.substring(0, 200)}`;
  }
  return line;
}

/**
 * Format NormalizedError[] for LLM prompts.
 * Groups: root causes first → independent → derived (omitted with count).
 *
 * @param {Array<Object>} errors
 * @param {Object} [opts]
 * @param {number} [opts.maxRoots=5] - Max root cause errors
 * @param {number} [opts.maxOther=10] - Max other errors
 * @param {boolean} [opts.includeRaw=false] - Include raw text
 * @returns {string}
 */
export function formatErrorsForLLM(errors, opts = {}) {
  if (!errors || errors.length === 0) return '';

  const maxRoots = opts.maxRoots ?? 5;
  const maxOther = opts.maxOther ?? 10;
  const includeRaw = opts.includeRaw ?? false;

  // Partition
  const derived = errors.filter(e => e.derivedFrom);
  const nonDerived = errors.filter(e => !e.derivedFrom);

  // Root causes: errors that have at least one derived error pointing to their code
  const derivedCodes = new Set(derived.map(e => e.derivedFrom));
  const rootCauses = nonDerived.filter(e => derivedCodes.has(e.code));
  const independent = nonDerived.filter(e => !derivedCodes.has(e.code));

  const parts = [];

  if (rootCauses.length > 0) {
    parts.push('**Root cause errors** (fix these first):');
    for (const e of rootCauses.slice(0, maxRoots)) {
      parts.push(_formatSingleError(e, includeRaw));
    }
    if (rootCauses.length > maxRoots) {
      parts.push(`_(${rootCauses.length - maxRoots} more root cause(s) omitted)_`);
    }
  }

  if (independent.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('**Other errors:**');
    for (const e of independent.slice(0, maxOther)) {
      parts.push(_formatSingleError(e, includeRaw));
    }
    if (independent.length > maxOther) {
      parts.push(`_(${independent.length - maxOther} more error(s) omitted)_`);
    }
  }

  if (derived.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push(`_(${derived.length} downstream error(s) omitted — will resolve when root causes are fixed)_`);
  }

  return parts.join('\n');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  ERROR_CODES,
  normalizeErrors,
  deduplicateErrors,
  classifyRecoverability,
  findRootCause,
  formatErrorsForLLM,
};
