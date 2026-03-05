// Index Builder — Extracts symbols from files using AST + regex fallback
// ══════════════════════════════════════════════════════════════════════════════

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import { parseAST, extractSymbols, isASTSupported } from './ast-analyzer.js';
import { analyzeCodeStructure, detectLanguage } from './code-analyzer.js';

const MAX_FILE_SIZE = 1_048_576; // 1MB
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  'venv', '.venv', '.c3', 'vendor', 'target', '.next',
  '.nuxt', 'coverage', '.cache', '.tox', 'env',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.pyw', '.go', '.java', '.kt', '.scala',
  '.rs', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs',
  '.php', '.rb', '.swift', '.vue', '.svelte',
]);

// ─── File Walker ─────────────────────────────────────────────────────────────

/**
 * Walk project directory and collect code files.
 *
 * @param {string} projectPath
 * @param {number} [maxFiles=5000]
 * @returns {Promise<string[]>} Relative file paths
 */
export async function collectCodeFiles(projectPath, maxFiles = 5000) {
  const files = [];

  async function walk(dir, depth) {
    if (depth > 8 || files.length >= maxFiles) return;

    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (files.length >= maxFiles) return;
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;

      const full = path.join(dir, e.name);

      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (CODE_EXTENSIONS.has(path.extname(e.name))) {
        try {
          const s = await stat(full);
          if (s.size <= MAX_FILE_SIZE) {
            files.push(path.relative(projectPath, full));
          }
        } catch { /* skip */ }
      }
    }
  }

  await walk(projectPath, 0);
  return files;
}

// ─── Extract Symbols from File ───────────────────────────────────────────────

/**
 * Extract symbols from a single file (AST or regex fallback).
 *
 * @param {string} projectPath
 * @param {string} relPath
 * @returns {Promise<Array<Symbol>>}
 */
export async function extractFileSymbols(projectPath, relPath) {
  const absPath = path.join(projectPath, relPath);
  let content;

  try {
    content = await readFile(absPath, 'utf8');
  } catch {
    return [];
  }

  const language = detectLanguage(relPath);

  // Try AST first (precise)
  if (isASTSupported(language)) {
    try {
      const { tree } = await parseAST(content, language);
      if (tree) {
        const symbols = extractSymbols(tree, language, relPath);
        if (symbols.length > 0) return symbols;
      }
    } catch (err) {
      logger.warn('IndexBuilder', `AST failed for ${relPath}: ${err.message}`);
    }
  }

  // Fallback to regex-based extraction
  const analysis = analyzeCodeStructure(content, language);
  const symbols = [];

  for (const cls of analysis.classes) {
    symbols.push({
      name: cls.name,
      type: cls.kind || 'class',
      line: cls.line,
      endLine: cls.line,
      exported: false,
      file: relPath,
    });
  }

  for (const fn of analysis.functions) {
    symbols.push({
      name: fn.name,
      type: fn.kind || 'function',
      line: fn.line,
      endLine: fn.line,
      params: fn.params,
      exported: false,
      file: relPath,
    });
  }

  for (const iface of analysis.interfaces) {
    symbols.push({
      name: iface.name,
      type: iface.kind || 'interface',
      line: iface.line,
      endLine: iface.line,
      exported: false,
      file: relPath,
    });
  }

  for (const en of analysis.enums) {
    symbols.push({
      name: en.name,
      type: 'enum',
      line: en.line,
      endLine: en.line,
      exported: false,
      file: relPath,
    });
  }

  for (const c of analysis.constants) {
    symbols.push({
      name: c.name,
      type: 'constant',
      line: c.line,
      endLine: c.line,
      exported: false,
      file: relPath,
    });
  }

  return symbols;
}

// ─── Reference Extraction ────────────────────────────────────────────────────

/**
 * Find references to a symbol in a file.
 *
 * @param {string} projectPath
 * @param {string} relPath
 * @param {string} symbolName
 * @returns {Promise<Array<{file: string, line: number, context: string}>>}
 */
export async function findReferencesInFile(projectPath, relPath, symbolName) {
  const absPath = path.join(projectPath, relPath);
  let content;

  try {
    content = await readFile(absPath, 'utf8');
  } catch {
    return [];
  }

  const refs = [];
  const lines = content.split('\n');
  const regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`, 'g');

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      refs.push({
        file: relPath,
        line: i + 1,
        context: lines[i].trim().substring(0, 120),
      });
    }
    regex.lastIndex = 0; // Reset for next line
  }

  return refs;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default { collectCodeFiles, extractFileSymbols, findReferencesInFile };
