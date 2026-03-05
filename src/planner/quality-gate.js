// Quality Gate v1 — Deterministic Compile/Syntax Check
// ══════════════════════════════════════════════════════════════════════════════
// Runs between code generation and R1 checkpoint.
// Checks syntax only — no dependencies, no runtime, no tests.
//
// Supported: Python (py_compile), Node (--check), Go (go build)
// Unknown extensions: SKIP (no-op, never blocks)
// ══════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { readdir, stat } from 'fs/promises';
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
};

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

const ERROR_PARSERS = {
  python: parsePythonError,
  javascript: parseNodeError,
  go: parseGoError,
};

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
    const relevantExts = Object.keys(LANG_MAP);
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
    const r = await execCheck('node', ['--check', path.join(projectPath, file)], projectPath);
    if (r.ok) {
      results.push({ file, lang: 'javascript', passed: true });
    } else if (r.notFound) {
      hasWarning = true;
      results.push({ file, lang: 'javascript', passed: true, warning: 'node not found — skipped' });
    } else {
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
