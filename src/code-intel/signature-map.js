// Signature Map v1 — Compact API signatures for LLM context
// ══════════════════════════════════════════════════════════════════════════════
//
// For files outside the edit scope, include only exported API signatures
// instead of full source. Saves ~85% tokens while preserving API awareness.
//
// Two-tier extraction: AST (precise) → regex fallback (unsupported languages).
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFile } from 'fs/promises';
import path from 'path';
import { parseAST, extractSymbols, isASTSupported } from './ast-analyzer.js';
import { detectLanguage } from './code-analyzer.js';

// ─── Regex Fallback Patterns ────────────────────────────────────────────────

const EXPORT_PATTERNS = [
  // JS/TS: export function/class/const/let/var/interface/type/enum
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)|interface\s+(\w+)|type\s+(\w+)|enum\s+(\w+))/,
  // Python: def / class at module level (no indent)
  /^(?:def\s+(\w+)|class\s+(\w+))/,
  // Go: func / type at module level (exported = capitalized)
  /^func\s+(?:\([\w\s*]+\)\s+)?(\w+)/,
  /^type\s+(\w+)/,
];

// ─── buildSignatureMap ──────────────────────────────────────────────────────

/**
 * Build signature map for a set of files.
 *
 * @param {Array<string>} files - relative file paths
 * @param {string} projectPath - project root
 * @returns {Promise<Array<{file: string, exports: string[]}>>}
 */
export async function buildSignatureMap(files, projectPath) {
  if (!files || files.length === 0) return [];

  const results = [];

  for (const file of files) {
    try {
      const absPath = path.isAbsolute(file) ? file : path.join(projectPath, file);
      const content = await readFile(absPath, 'utf-8');
      const language = detectLanguage(file);

      let exports;
      if (isASTSupported(language)) {
        exports = await extractSignaturesAST(content, language, file);
      }

      // Fallback to regex if AST failed or unsupported
      if (!exports || exports.length === 0) {
        exports = extractSignaturesRegex(content, language);
      }

      if (exports.length > 0) {
        results.push({ file, exports });
      }
    } catch (_) {
      // File read failed — skip silently
    }
  }

  return results;
}

/**
 * Extract signatures using AST (preferred path).
 */
async function extractSignaturesAST(content, language, filePath) {
  try {
    const { tree, supported } = await parseAST(content, language);
    if (!supported || !tree) return null;

    const symbols = extractSymbols(tree, language, filePath);
    const exported = symbols.filter(s => s.exported);

    return exported.map(s => formatSignature(s));
  } catch (_) {
    return null;
  }
}

/**
 * Extract signatures using regex (fallback for unsupported languages).
 */
function extractSignaturesRegex(content, language) {
  const signatures = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    for (const pattern of EXPORT_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        // For Go: only exported (capitalized) names
        if (language === 'go') {
          const name = match[1];
          if (name && /^[A-Z]/.test(name)) {
            signatures.push(trimmed.replace(/\{.*$/, '').trim());
          }
        } else if (language === 'python') {
          // Python: module-level defs/classes (no leading whitespace)
          if (line === trimmed) { // no indent
            signatures.push(trimmed.replace(/:.*$/, '').trim());
          }
        } else {
          // JS/TS and others
          signatures.push(trimmed.replace(/\{.*$/, '').trim());
        }
        break;
      }
    }
  }

  return signatures;
}

// ─── formatSignature ────────────────────────────────────────────────────────

/**
 * Format a symbol as a compact signature string.
 *
 * @param {Object} symbol - {name, type, params?, exported, file, line}
 * @returns {string} e.g. "export function processOrder(orderId, items)"
 */
export function formatSignature(symbol) {
  if (!symbol || !symbol.name) return '';

  const prefix = symbol.exported ? 'export ' : '';

  switch (symbol.type) {
    case 'function':
    case 'method':
    case 'arrow': {
      const params = symbol.params ? symbol.params.join(', ') : '';
      const asyncPrefix = symbol.async ? 'async ' : '';
      return `${prefix}${asyncPrefix}function ${symbol.name}(${params})`;
    }
    case 'class':
      return `${prefix}class ${symbol.name}`;
    case 'interface':
      return `${prefix}interface ${symbol.name}`;
    case 'enum':
      return `${prefix}enum ${symbol.name}`;
    case 'variable':
    case 'constant':
      return `${prefix}const ${symbol.name}`;
    case 'struct':
      return `${prefix}type ${symbol.name} struct`;
    default:
      return `${prefix}${symbol.type || ''} ${symbol.name}`.trim();
  }
}

// ─── formatSignatureMap ─────────────────────────────────────────────────────

/**
 * Format signature map for LLM prompt injection.
 *
 * @param {Array<{file: string, exports: string[]}>} signatureMap
 * @returns {string} Markdown with file headers + signatures
 */
export function formatSignatureMap(signatureMap) {
  if (!signatureMap || signatureMap.length === 0) return '';

  const parts = ['## API Signatures (dependency context — DO NOT modify these files)\n'];

  for (const entry of signatureMap) {
    parts.push(`### ${entry.file}`);
    for (const sig of entry.exports) {
      parts.push(`- ${sig}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
