// Code Cleaner v97 — Fence Stripping + AST-Guided Repair Pipeline
// ══════════════════════════════════════════════════════════════════════════════
// Shared module for production executor + test harness.
// Pipeline: generate → stripFences → checkSyntax → snippetRepair → fullRepair → accept
//
// Key principle: LLM is a good patcher but bad file rewriter.
// Snippet repair first, full-file repair only as fallback.
// ══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../core/logger.js';

// ─── 1a. stripCodeFences ────────────────────────────────────────────────────

const CODE_START_PATTERN = /^(import |from |#!|const |let |var |function |class |def |package |\/\*|\/\/|module\.|export |async |require\(|\{|"|\[|@|<!)/;

/**
 * Aggressively strip markdown fences and leading prose from LLM output.
 * Also applies TypeScript→JS transform for .js files.
 * @param {string} content - Raw LLM output
 * @param {string} fileExt - File extension (e.g. '.js', '.py')
 * @returns {string} Clean source code
 */
export function stripCodeFences(content, fileExt) {
  if (!content) return '';
  // Guard: content might be array (Ollama response) or object
  let c = typeof content === 'string' ? content : String(content);

  // Remove all markdown fences (```lang and ```)
  c = c.replace(/```[\w]*\n?/g, '');
  c = c.replace(/\n?```/g, '');

  // Remove leading prose before first code line
  const lines = c.split('\n');
  while (lines.length && !CODE_START_PATTERN.test(lines[0])) {
    lines.shift();
  }

  c = lines.join('\n').trim();

  // TypeScript→JS transform for .js files
  if (['.js', '.mjs', '.cjs'].includes(fileExt)) {
    c = stripTypeAnnotations(c);
  }

  return c;
}

// ─── 1b. stripTypeAnnotations ───────────────────────────────────────────────

/**
 * Remove TypeScript syntax from JavaScript code.
 * Handles: interfaces, type aliases, parameter annotations, return types, as casts, import type.
 * @param {string} code
 * @returns {string}
 */
export function stripTypeAnnotations(code) {
  // Remove standalone interface/type declarations (multiline)
  code = code.replace(/^(export\s+)?(interface|type)\s+\w+[\s\S]*?^\}/gm, '');

  // Remove type annotations from parameters: (x: string, y: number) → (x, y)
  code = code.replace(/:\s*(string|number|boolean|any|void|null|undefined|object|never|unknown|bigint|symbol|Array<[^>]+>|\w+\[\]|\{[^}]*\}|\w+)\s*([,)=])/g, '$2');

  // Remove return type annotations: ): string { → ) {
  code = code.replace(/\):\s*[\w<>\[\]|&]+(\s*\{)/g, ')$1');

  // Remove 'as Type' casts
  code = code.replace(/\s+as\s+\w+/g, '');

  // Remove import type statements
  code = code.replace(/import\s+type\s+.*?;\n?/g, '');

  // Remove generic type parameters from function declarations: function foo<T> → function foo
  code = code.replace(/(function\s+\w+)<[^>]+>/g, '$1');

  // Clean up empty lines left by removed declarations
  code = code.replace(/\n{3,}/g, '\n\n');

  return code;
}

// ─── 1c. checkSyntax ────────────────────────────────────────────────────────

/**
 * Detect JSX syntax in JavaScript code.
 * Checks for uppercase component tags, JSX attribute expressions, and React imports.
 */
function hasJSXSyntax(code) {
  return /<[A-Z][a-zA-Z]*[\s/>]/.test(code) ||
         /<\w+\s+\w+=\{/.test(code) ||
         /from\s+['"]react['"]/.test(code);
}

/**
 * Deterministic syntax check using native tools.
 * Python: py_compile (simulates runtime loader) + __pycache__ cleanup
 * JS: node --check (skips JSX files)
 * @param {string} filePath - Absolute path to file
 * @returns {{ ok: true }} on success
 * @throws {Error} with stderr details on syntax error
 */
export function checkSyntax(filePath) {
  const ext = path.extname(filePath);

  try {
    if (ext === '.py') {
      execFileSync('python3', ['-m', 'py_compile', filePath], {
        timeout: 5000,
        stdio: 'pipe',
      });
      // Clean up __pycache__ created by py_compile to prevent scope violations
      const pycacheDir = path.join(path.dirname(filePath), '__pycache__');
      try { fs.rmSync(pycacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
    } else if (['.js', '.mjs', '.cjs'].includes(ext)) {
      // Skip JSX files — node --check can't parse JSX syntax
      const code = fs.readFileSync(filePath, 'utf-8');
      if (hasJSXSyntax(code)) {
        return { ok: true, skipped: true, reason: 'JSX detected' };
      }
      execFileSync('node', ['--check', filePath], {
        timeout: 5000,
        stdio: 'pipe',
      });
    } else {
      // .ts, .go, .json, etc.: skip (no quick deterministic check available)
      return { ok: true, skipped: true };
    }
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message || '';
    // package.json errors are module resolution failures, not syntax errors in the target file
    if (stderr.includes('package.json') || stderr.includes('ERR_PACKAGE_JSON')) {
      return { ok: true, skipped: true, reason: 'Invalid package.json' };
    }
    const error = new Error(`Syntax error in ${path.basename(filePath)}: ${stderr.trim()}`);
    error.stderr = stderr;
    throw error;
  }

  return { ok: true };
}

// ─── 1d. parseErrorLocation ─────────────────────────────────────────────────

/**
 * Extract exact error line number from syntax check stderr.
 * @param {string} stderr
 * @param {string} lang - 'python' or 'javascript'
 * @returns {{ line: number } | null}
 */
export function parseErrorLocation(stderr, lang) {
  if (!stderr) return null;

  if (lang === 'python') {
    // Python: "File "foo.py", line 52"
    const m = stderr.match(/line\s+(\d+)/);
    return m ? { line: parseInt(m[1]) } : null;
  }

  // JavaScript: "foo.js:52" or at position-based
  const m = stderr.match(/:(\d+)/);
  return m ? { line: parseInt(m[1]) } : null;
}

// ─── 1e. extractSnippet ─────────────────────────────────────────────────────

/**
 * Cut a small window around the error for targeted repair.
 * @param {string} code
 * @param {number} line - 1-based line number
 * @param {number} [radius=10] - Lines before and after to include
 * @returns {{ snippet: string, startLine: number, endLine: number }}
 */
export function extractSnippet(code, line, radius = 10) {
  const lines = code.split('\n');
  const start = Math.max(0, line - radius - 1);
  const end = Math.min(lines.length, line + radius);
  return {
    snippet: lines.slice(start, end).join('\n'),
    startLine: start,
    endLine: end,
  };
}

// ─── 1f. applyPatch ─────────────────────────────────────────────────────────

/**
 * Splice repaired snippet back into original code.
 * @param {string} originalCode
 * @param {number} startLine - 0-based start index
 * @param {number} endLine - 0-based end index (exclusive)
 * @param {string} newSnippet
 * @returns {string}
 */
export function applyPatch(originalCode, startLine, endLine, newSnippet) {
  const lines = originalCode.split('\n');
  const patchLines = newSnippet.split('\n');
  lines.splice(startLine, endLine - startLine, ...patchLines);
  return lines.join('\n');
}

// ─── 1g. repairCode — 3-tier AST-guided repair ─────────────────────────────

const LANG_MAP = {
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};

const LANG_NAMES = {
  '.py': 'Python',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
};

/**
 * 3-tier repair pipeline:
 *   Tier 1: AST-guided snippet repair (2 attempts, temperature=0)
 *   Tier 2: Full-file repair (1 attempt, temperature=0)
 *   Tier 3: Accept as-is — let milestone quality gate handle
 *
 * @param {string} content - Current file content (with syntax error)
 * @param {string} error - Error message from checkSyntax
 * @param {string} filePath - Absolute path to the file
 * @param {Function} callLLM - LLM call function (role, prompt, system, opts)
 * @returns {Promise<{ repaired: boolean, content: string, attempts: number, tier: string }>}
 */
export async function repairCode(content, error, filePath, callLLM) {
  const ext = path.extname(filePath);
  const lang = LANG_MAP[ext] || 'code';
  const langName = LANG_NAMES[ext] || 'code';

  // ─── Tier 1: Snippet repair (2 attempts) ──────────────────────────────
  for (let attempt = 0; attempt < 2; attempt++) {
    const loc = parseErrorLocation(error, lang);
    if (!loc) break; // Can't locate error → fall to tier 2

    const { snippet, startLine, endLine } = extractSnippet(content, loc.line);
    const snippetLineCount = (endLine - startLine);

    const repairPrompt = `The following ${langName} code has a syntax error.

Error: ${error}

Code snippet (lines ${startLine + 1}-${endLine}):
${snippet}

Fix ONLY the syntax error.
Do not change program logic.
Do not rewrite the whole file.
Return ONLY the corrected snippet.
Do not include markdown fences or explanations.`;

    try {
      const result = await callLLM('CODE', repairPrompt, null, { temperature: 0 });
      const rawPatch = typeof result.content === 'string' ? result.content : (result.content || '').toString();
      const patchedSnippet = stripCodeFences(rawPatch, ext);

      // Snippet length guard: reject if > 2× original length
      const patchLineCount = patchedSnippet.split('\n').length;
      if (patchLineCount > snippetLineCount * 2) {
        logger.warn('CodeCleaner', 'Snippet repair returned oversized patch, ignoring', {
          original: snippetLineCount,
          patched: patchLineCount,
          attempt,
        });
        continue;
      }

      content = applyPatch(content, startLine, endLine, patchedSnippet);
      fs.writeFileSync(filePath, content);

      checkSyntax(filePath);
      logger.info('CodeCleaner', 'Snippet repair succeeded', { file: path.basename(filePath), attempt: attempt + 1 });
      return { repaired: true, content, attempts: attempt + 1, tier: 'snippet' };
    } catch (e) {
      error = e.stderr || e.message || String(e);
      logger.warn('CodeCleaner', `Snippet repair attempt ${attempt + 1} failed`, {
        file: path.basename(filePath),
        error: error.slice(0, 200),
      });
    }
  }

  // ─── Tier 2: Full-file repair (1 attempt) ─────────────────────────────
  try {
    const fullRepairPrompt = `Fix the syntax error in this ${langName} file.
Error: ${error}

Do not change program logic.
Return the corrected file only.
Do not include markdown fences or explanations.

${content}`;

    const result = await callLLM('CODE', fullRepairPrompt, null, { temperature: 0 });
    const rawContent = typeof result.content === 'string' ? result.content : (result.content || '').toString();
    content = stripCodeFences(rawContent, ext);
    fs.writeFileSync(filePath, content);

    checkSyntax(filePath);
    logger.info('CodeCleaner', 'Full-file repair succeeded', { file: path.basename(filePath) });
    return { repaired: true, content, attempts: 3, tier: 'full-file' };
  } catch (e) {
    logger.warn('CodeCleaner', 'Full-file repair failed, accepting as-is', {
      file: path.basename(filePath),
      error: (e.stderr || e.message || '').slice(0, 200),
    });
  }

  // ─── Tier 3: Accept as-is ─────────────────────────────────────────────
  return { repaired: false, content, attempts: 3, tier: 'failed' };
}

// ─── 1h. languagePromptSuffix ───────────────────────────────────────────────

/**
 * Returns language-aware output instruction to append to code generation prompts.
 * Prevents markdown fences, explanations, and TypeScript syntax in .js files.
 * @param {string} fileExt
 * @returns {string}
 */
export function languagePromptSuffix(fileExt) {
  switch (fileExt) {
    case '.py':
      return 'Output ONLY raw Python code. NO markdown fences. NO ``` markers. NO explanations. The output will be written directly to a file. Start with imports or code.';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'Output ONLY JavaScript. NO TypeScript syntax (no type annotations, no interfaces, no `as` casts, no import type). This is .js not .ts. NO markdown fences. The output will be written directly to a file.';
    case '.ts':
    case '.tsx':
      return 'Output TypeScript. NO markdown fences. The output will be written directly to a file.';
    case '.go':
      return 'Output ONLY raw Go code. NO markdown fences. The output will be written directly to a file.';
    default:
      return 'Output ONLY raw source code. NO markdown fences. NO explanation. The output will be written directly to a file.';
  }
}
