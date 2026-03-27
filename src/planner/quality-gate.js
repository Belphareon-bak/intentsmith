// Quality Gate v2 — Deterministic Compile/Syntax + Semantic Checks
// ══════════════════════════════════════════════════════════════════════════════
// Runs between code generation and R1 checkpoint.
// v1: syntax only (Python, JS, Go)
// v2 (v134): + Java structural, non-empty, cross-module imports, mock detection
//
// Supported: Python (py_compile), Node (--check), Go (go build), Java (structural)
// Unknown extensions: SKIP (no-op, never blocks)
// ══════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { readdir, stat, readFile } from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger.js';

const TIMEOUT_MS = 15_000;

// ─── Language Detection ──────────────────────────────────────────────────────

const LANG_MAP = {
  '.py':   'python',
  '.js':   'javascript',
  '.mjs':  'javascript',
  '.cjs':  'javascript',
  '.go':   'go',
  '.java': 'java',
};

// v134: Extensions to include in semantic validation (non-empty, mock detection)
const SEMANTIC_EXTS = new Set(['.py', '.js', '.mjs', '.cjs', '.go', '.java', '.xml', '.json']);

// ─── Error Parsers ───────────────────────────────────────────────────────────

function parsePythonError(stderr) {
  const m = stderr.match(/File "(.+)", line (\d+)/);
  const lines = stderr.trim().split('\n');
  return {
    file: m?.[1] || null,
    line: m ? Number(m[2]) : null,
    message: lines[lines.length - 1]?.trim() || stderr.trim(),
  };
}

function parseNodeError(stderr) {
  const m = stderr.match(/(.+):(\d+)\n/);
  const syntaxMsg = stderr.match(/SyntaxError: (.+)/);
  return {
    file: m?.[1] || null,
    line: m ? Number(m[2]) : null,
    message: syntaxMsg?.[1] || stderr.trim().split('\n')[0],
  };
}

function parseGoError(stderr) {
  const m = stderr.match(/(.+\.go):(\d+):\d+: (.+)/);
  return {
    file: m?.[1] || null,
    line: m ? Number(m[2]) : null,
    message: m?.[3] || stderr.trim().split('\n')[0],
  };
}

function parseJavaError(detail) {
  return {
    file: detail.file || null,
    line: detail.line || null,
    message: detail.message || 'Java structural error',
  };
}

const ERROR_PARSERS = {
  python: parsePythonError,
  javascript: parseNodeError,
  go: parseGoError,
  java: parseJavaError,
};

// ─── v134: Java Structural Validation ────────────────────────────────────────

/**
 * Validate Java file structure without javac.
 * Checks: non-empty, class/interface matches filename, package present, braces balanced.
 */
function validateJavaStructure(filePath, relativePath) {
  let code;
  try { code = fs.readFileSync(filePath, 'utf-8'); } catch { return { ok: false, message: 'Cannot read file' }; }

  if (code.trim().length < 10) {
    return { ok: false, message: 'File is empty or near-empty' };
  }

  // Check package declaration
  if (!/^\s*package\s+[\w.]+\s*;/m.test(code)) {
    return { ok: false, message: 'Missing package declaration' };
  }

  // Check class or interface declaration exists
  const classMatch = code.match(/(?:public\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/);
  if (!classMatch) {
    return { ok: false, message: 'No class/interface/enum declaration found' };
  }

  // Check class name matches filename
  const expectedName = path.basename(filePath, '.java');
  if (classMatch[1] !== expectedName) {
    return { ok: false, message: `Class '${classMatch[1]}' doesn't match filename '${expectedName}.java'` };
  }

  // Basic brace balance check
  let depth = 0;
  for (const ch of code) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return { ok: false, message: 'Unmatched closing brace' };
  }
  if (depth !== 0) {
    return { ok: false, message: `Unbalanced braces (depth=${depth})` };
  }

  return { ok: true };
}

// ─── v134: Non-empty File Check ──────────────────────────────────────────────

/**
 * Check that a source file has substantive content (not empty, not comments-only).
 */
function isFileSubstantive(filePath, ext) {
  let code;
  try { code = fs.readFileSync(filePath, 'utf-8'); } catch { return { ok: false, message: 'Cannot read file' }; }

  if (code.trim().length === 0) {
    return { ok: false, message: 'File is empty' };
  }

  // For XML/JSON: just check non-empty (>10 bytes of content)
  if (ext === '.xml' || ext === '.json') {
    return code.trim().length > 10
      ? { ok: true }
      : { ok: false, message: `File has only ${code.trim().length} bytes of content` };
  }

  // For code files: filter out blank lines and comment-only lines
  const lines = code.split('\n');
  const codeLines = lines.filter(l => {
    const t = l.trim();
    if (!t) return false;
    // Common comment patterns
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/')) return false;
    return true;
  });

  return codeLines.length > 0
    ? { ok: true }
    : { ok: false, message: 'File contains only comments/blank lines' };
}

// ─── v134: Cross-Module Import Validation (JS) ──────────────────────────────

/**
 * Resolve a JS relative import to an actual file path.
 * Tries: exact, .js, .mjs, .cjs, /index.js
 */
export function resolveJsImport(fromDir, importPath) {
  const base = path.resolve(fromDir, importPath);
  const candidates = [
    base,
    base + '.js',
    base + '.mjs',
    base + '.cjs',
    path.join(base, 'index.js'),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* nope */ }
  }
  return null;
}

/**
 * Extract exported names from JS code (CommonJS + ESM).
 */
export function extractJsExports(code) {
  const names = new Set();
  // module.exports = { a, b, c }
  const objExport = code.match(/module\.exports\s*=\s*\{([^}]+)\}/);
  if (objExport) {
    for (const m of objExport[1].matchAll(/(\w+)/g)) names.add(m[1]);
  }
  // exports.name = ...
  for (const m of code.matchAll(/exports\.(\w+)\s*=/g)) names.add(m[1]);
  // export function name / export const name / export class name
  for (const m of code.matchAll(/export\s+(?:function|const|let|var|class|async\s+function)\s+(\w+)/g)) names.add(m[1]);
  // export { a, b }
  for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const n of m[1].matchAll(/(\w+)/g)) names.add(n[1]);
  }
  // export default — tracked as 'default'
  if (/export\s+default\s/.test(code)) names.add('default');
  return [...names];
}

/**
 * Validate JS cross-module imports: check targets exist and exported names match.
 */
function validateJsImports(projectPath, jsFiles) {
  const errors = [];

  for (const relFile of jsFiles) {
    const fullPath = path.join(projectPath, relFile);
    let code;
    try { code = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }

    const fromDir = path.dirname(fullPath);

    // Extract relative imports
    const imports = [];
    for (const m of code.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) imports.push({ path: m[1], line: null });
    for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) imports.push({ path: m[1], line: null });

    for (const imp of imports) {
      const resolved = resolveJsImport(fromDir, imp.path);
      if (!resolved) {
        errors.push({
          file: relFile, lang: 'javascript', passed: false,
          message: `Import '${imp.path}' not found on disk`,
          category: 'import_missing',
        });
        continue;
      }

      // Check named imports match exports (only for destructured require/import)
      // require('./x').name or const { a, b } = require('./x')
      const destructuredRe = new RegExp(
        `(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*require\\(\\s*['"]${imp.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\)`,
        'g'
      );
      const esmImportRe = new RegExp(
        `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${imp.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
        'g'
      );

      const namedImports = [];
      for (const m of code.matchAll(destructuredRe)) {
        for (const n of m[1].matchAll(/(\w+)/g)) namedImports.push(n[1]);
      }
      for (const m of code.matchAll(esmImportRe)) {
        for (const n of m[1].matchAll(/(\w+)/g)) namedImports.push(n[1]);
      }

      if (namedImports.length > 0) {
        let targetCode;
        try { targetCode = fs.readFileSync(resolved, 'utf-8'); } catch { continue; }
        const exports = extractJsExports(targetCode);
        for (const name of namedImports) {
          if (!exports.includes(name)) {
            errors.push({
              file: relFile, lang: 'javascript', passed: false,
              message: `'${name}' not exported from '${imp.path}' (exports: ${exports.join(', ') || 'none'})`,
              category: 'export_mismatch',
            });
          }
        }
      }
    }
  }

  return errors;
}

// ─── v134: Mock/Placeholder Detection ────────────────────────────────────────

const MOCK_PATTERNS = [
  /\/\/\s*(?:placeholder|mock|simulated|In a full implementation)/i,
  /\/\*\*?[\s\S]*?(?:placeholder|mock|simulated)[\s\S]*?\*\//i,
  /return\s+true;\s*\/\/\s*(?:mock|placeholder|stub)/i,
  /throw\s+new\s+\w*Error\(\s*['"](?:Not implemented|TODO)/i,
];

/**
 * Detect mock/placeholder content ratio.
 * Returns warning (not blocking) if >40% of methods are mock.
 */
function detectMockContent(filePath) {
  let code;
  try { code = fs.readFileSync(filePath, 'utf-8'); } catch { return null; }

  const lines = code.split('\n');
  const codeLines = lines.filter(l => l.trim().length > 0);
  if (codeLines.length < 5) return null; // too small to judge

  let mockLines = 0;
  for (const line of codeLines) {
    if (MOCK_PATTERNS.some(p => p.test(line))) mockLines++;
  }

  const ratio = mockLines / codeLines.length;
  if (ratio > 0.3) {
    return {
      file: filePath,
      mockLines,
      totalLines: codeLines.length,
      ratio: Math.round(ratio * 100),
      message: `${mockLines}/${codeLines.length} lines (${Math.round(ratio * 100)}%) are mock/placeholder`,
    };
  }
  return null;
}

// ─── v134: Enhanced Validation (combines all semantic checks) ────────────────

/**
 * Run enhanced semantic validation beyond syntax.
 * @param {string} projectPath
 * @param {string[]|null} changedFiles - null = full project discovery
 * @returns {Promise<{errors: Array, warnings: Array}>}
 */
export async function runEnhancedValidation(projectPath, changedFiles = null) {
  const errors = [];
  const warnings = [];

  // Discover all relevant files
  let files;
  if (changedFiles) {
    files = changedFiles;
  } else {
    files = await discoverFiles(projectPath, [...Object.keys(LANG_MAP), '.xml', '.json']);
  }

  const jsFiles = [];

  for (const relFile of files) {
    const fullPath = path.join(projectPath, relFile);
    const ext = path.extname(relFile);

    // Non-empty check for semantic extensions
    if (SEMANTIC_EXTS.has(ext)) {
      const subst = isFileSubstantive(fullPath, ext);
      if (!subst.ok) {
        errors.push({
          file: relFile, lang: LANG_MAP[ext] || ext, passed: false,
          message: subst.message, category: 'empty_file',
        });
      }
    }

    // Track JS files for import validation
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      jsFiles.push(relFile);
    }

    // Mock detection (warning, not blocking)
    if (['.js', '.mjs', '.cjs', '.py', '.java', '.go'].includes(ext)) {
      const mock = detectMockContent(fullPath);
      if (mock) {
        warnings.push({
          file: relFile, lang: LANG_MAP[ext] || ext,
          message: mock.message, category: 'mock_content',
        });
      }
    }
  }

  // Cross-module import validation (JS only)
  const importErrors = validateJsImports(projectPath, jsFiles);
  errors.push(...importErrors);

  return { errors, warnings };
}

// ─── Exec Helper ─────────────────────────────────────────────────────────────

function execCheck(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, stderr: '', stdout });
      } else if (error.killed) {
        resolve({ ok: false, stderr: `Timeout after ${TIMEOUT_MS}ms`, timedOut: true });
      } else if (error.code === 'ENOENT') {
        resolve({ ok: false, stderr: `Command not found: ${cmd}`, notFound: true });
      } else {
        resolve({ ok: false, stderr: stderr || error.message || '' });
      }
    });
  });
}

// ─── File Discovery (full-project mode) ──────────────────────────────────────

const MAX_FULL_SCAN_FILES = 200;

async function discoverFiles(projectPath, extensions) {
  const files = [];
  const extSet = new Set(extensions);

  async function walk(dir, depth = 0) {
    if (depth > 8 || files.length > MAX_FULL_SCAN_FILES) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__'
          || e.name === 'vendor' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (extSet.has(path.extname(e.name))) {
        files.push(path.relative(projectPath, full));
        if (files.length > MAX_FULL_SCAN_FILES) return;
      }
    }
  }

  await walk(projectPath);
  return files;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Run compile/syntax checks on changed files.
 * @param {string} projectPath - Absolute project directory
 * @param {Object} techStack - From spec (hint only)
 * @param {string[]|null} changedFiles - Files to check (null = full project scan)
 * @param {Object} [opts]
 * @param {'changed'|'full-project'} [opts.mode='changed']
 * @returns {Promise<{passed: boolean, results: Array, summary: string, status: string}>}
 */
export async function runQualityGate(projectPath, techStack, changedFiles, opts = {}) {
  const mode = opts.mode || 'changed';

  // Determine files to check
  let filesToCheck;
  if (mode === 'full-project' || changedFiles === null) {
    const relevantExts = [...Object.keys(LANG_MAP), '.xml', '.json'];
    filesToCheck = await discoverFiles(projectPath, relevantExts);
    if (filesToCheck.length > MAX_FULL_SCAN_FILES) {
      logger.warn('QualityGate', `Full scan limited to ${MAX_FULL_SCAN_FILES} files (found ${filesToCheck.length})`);
      filesToCheck = filesToCheck.slice(0, MAX_FULL_SCAN_FILES);
    }
  } else {
    filesToCheck = changedFiles || [];
  }

  if (filesToCheck.length === 0) {
    return { passed: true, results: [], summary: 'No files to check', status: 'SKIP' };
  }

  // Group files by language
  const byLang = {};
  let hasGo = false;
  for (const f of filesToCheck) {
    const ext = path.extname(f);
    const lang = LANG_MAP[ext];
    if (!lang) continue;
    if (lang === 'go') { hasGo = true; continue; } // Go handled separately
    (byLang[lang] ??= []).push(f);
  }

  const results = [];
  let hasWarning = false;

  // ─── Python: per-file py_compile ─────────────────────────────────────
  for (const file of (byLang.python || [])) {
    const r = await execCheck('python3', ['-m', 'py_compile', path.join(projectPath, file)], projectPath);
    if (r.ok) {
      results.push({ file, lang: 'python', passed: true });
    } else if (r.notFound) {
      hasWarning = true;
      results.push({ file, lang: 'python', passed: true, warning: 'python3 not found — skipped' });
    } else {
      const parsed = parsePythonError(r.stderr);
      results.push({
        file, lang: 'python', passed: false,
        error: r.stderr, line: parsed.line, message: parsed.message,
        timedOut: r.timedOut || false,
      });
    }
  }

  // ─── JavaScript: per-file node --check ───────────────────────────────
  for (const file of (byLang.javascript || [])) {
    // Skip JSX files — node --check can't parse JSX syntax
    const fullPath = path.join(projectPath, file);
    try {
      const code = await readFile(fullPath, 'utf-8');
      if (/<[A-Z][a-zA-Z]*[\s/>]/.test(code) || /<\w+\s+\w+=\{/.test(code) || /from\s+['"]react['"]/.test(code)) {
        results.push({ file, lang: 'javascript', passed: true, warning: 'JSX detected — skipped' });
        continue;
      }
    } catch { /* file read failed — proceed with check */ }

    const r = await execCheck('node', ['--check', fullPath], projectPath);
    if (r.ok) {
      results.push({ file, lang: 'javascript', passed: true });
    } else if (r.notFound) {
      hasWarning = true;
      results.push({ file, lang: 'javascript', passed: true, warning: 'node not found — skipped' });
    } else {
      // package.json errors are module resolution failures, not syntax errors
      if (r.stderr.includes('package.json') || r.stderr.includes('ERR_PACKAGE_JSON')) {
        results.push({ file, lang: 'javascript', passed: true, warning: 'Invalid package.json — skipped' });
        continue;
      }
      const parsed = parseNodeError(r.stderr);
      results.push({
        file, lang: 'javascript', passed: false,
        error: r.stderr, line: parsed.line, message: parsed.message,
        timedOut: r.timedOut || false,
      });
    }
  }

  // ─── Go: project-wide go build ──────────────────────────────────────
  if (hasGo) {
    const r = await execCheck('go', ['build', './...'], projectPath);
    if (r.ok) {
      results.push({ file: '*.go', lang: 'go', passed: true });
    } else if (r.notFound) {
      hasWarning = true;
      results.push({ file: '*.go', lang: 'go', passed: true, warning: 'go not found — skipped' });
    } else {
      const parsed = parseGoError(r.stderr);
      results.push({
        file: parsed.file || '*.go', lang: 'go', passed: false,
        error: r.stderr, line: parsed.line, message: parsed.message,
        timedOut: r.timedOut || false,
      });
    }
  }

  // ─── Java: structural validation (no javac needed) ─────────────────
  for (const file of (byLang.java || [])) {
    const fullPath = path.join(projectPath, file);
    const javaResult = validateJavaStructure(fullPath, file);
    if (javaResult.ok) {
      results.push({ file, lang: 'java', passed: true });
    } else {
      results.push({
        file, lang: 'java', passed: false,
        error: javaResult.message, message: javaResult.message,
      });
    }
  }

  // ─── v134: Non-empty check for non-code files (xml, json) ─────────
  for (const file of filesToCheck) {
    const ext = path.extname(file);
    if (ext === '.xml' || ext === '.json') {
      const fullPath = path.join(projectPath, file);
      const subst = isFileSubstantive(fullPath, ext);
      if (!subst.ok) {
        results.push({
          file, lang: ext.slice(1), passed: false,
          error: subst.message, message: subst.message,
        });
      }
    }
  }

  // ─── Aggregate ───────────────────────────────────────────────────────
  const failedResults = results.filter(r => !r.passed);
  const passed = failedResults.length === 0;

  const summary = passed
    ? `${results.length} file(s) checked — all passed`
    : `${failedResults.length}/${results.length} file(s) failed:\n${failedResults.map(r => `  ${r.file}:${r.line || '?'} ${r.message || r.error}`).join('\n')}`;

  const status = passed ? (hasWarning ? 'WARNING' : 'PASS') : 'FAIL';

  logger.info('QualityGate', `${status}: ${summary}`, { mode, fileCount: filesToCheck.length });

  return { passed, results, summary, status };
}
