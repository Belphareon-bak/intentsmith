// Code Search Engine v1 — ripgrep / grep / Node.js fallback
// ══════════════════════════════════════════════════════════════════════════════
//
// Search priority:
//   1. ripgrep (rg) — fastest, respects .gitignore
//   2. grep (GNU) — fallback
//   3. Node.js fs — last resort (no external deps)
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 50;
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_FILES_SCAN = 5000;
const CACHE_TTL = 30_000; // 30s

// Directories to always ignore
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  'venv', '.venv', '.c3', 'vendor', 'target', '.next',
  '.nuxt', 'coverage', '.cache', '.tox', 'env',
]);

// Code file extensions
const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.pyw',
  '.go',
  '.java', '.kt', '.scala',
  '.rs',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.swift',
  '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.sql',
  '.sh', '.bash',
  '.md', '.txt',
  '.html', '.css', '.scss',
  '.xml',
]);

// ─── Search Cache ─────────────────────────────────────────────────────────────

const _cache = new Map();

function cacheKey(projectPath, query, opts) {
  return `${projectPath}::${query}::${opts.maxResults || MAX_RESULTS}::${opts.ignoreCase ?? true}`;
}

function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.results;
}

function setCache(key, results) {
  _cache.set(key, { results, timestamp: Date.now() });
  // Evict old entries
  if (_cache.size > 100) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 20; i++) _cache.delete(oldest[i][0]);
  }
}

export function clearSearchCache() {
  _cache.clear();
}

// ─── Engine Detection ─────────────────────────────────────────────────────────

let _engineChecked = false;
let _hasRipgrep = false;
let _hasGrep = false;

async function detectEngine() {
  if (_engineChecked) return;
  _engineChecked = true;

  _hasRipgrep = await checkCommand('rg', ['--version']);
  _hasGrep = await checkCommand('grep', ['--version']);

  logger.info('CodeSearch', `Engine detection: rg=${_hasRipgrep}, grep=${_hasGrep}`);
}

function checkCommand(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (error) => {
      resolve(!error);
    });
  });
}

// ─── Exec Helper ──────────────────────────────────────────────────────────────

function execSearch(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && error.killed) {
        resolve({ ok: false, stdout: '', stderr: `Timeout after ${TIMEOUT_MS}ms`, timedOut: true });
      } else if (error && error.code === 'ENOENT') {
        resolve({ ok: false, stdout: '', stderr: `Command not found: ${cmd}`, notFound: true });
      } else {
        // grep returns exit 1 for "no matches" — that's OK
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

// ─── Ripgrep Search ───────────────────────────────────────────────────────────

async function searchWithRipgrep(projectPath, query, opts) {
  const args = [
    '--json', '-n',
    '--max-count', String(opts.maxResults || MAX_RESULTS),
    '--max-filesize', '1M',
  ];

  if (opts.ignoreCase !== false) args.push('-i');
  if (opts.contextLines) {
    args.push('-C', String(opts.contextLines));
  }

  // File type filter
  args.push(
    '--type-add', 'code:*.{js,mjs,cjs,ts,tsx,jsx,py,go,java,kt,scala,rs,c,cpp,cc,h,hpp,cs,php,rb,swift,vue,svelte}',
    '--type', 'code',
  );

  args.push(query, projectPath);

  const r = await execSearch('rg', args, projectPath);
  if (!r.ok) return { results: [], engine: 'ripgrep', error: r.stderr };

  return parseRipgrepJSON(r.stdout, projectPath);
}

function parseRipgrepJSON(stdout, projectPath) {
  const results = [];
  const lines = stdout.split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'match') {
        const data = obj.data;
        results.push({
          file: path.relative(projectPath, data.path.text),
          line: data.line_number,
          content: data.lines.text.trimEnd(),
          contextBefore: [],
          contextAfter: [],
        });
      }
    } catch {
      // skip malformed JSON lines
    }
  }

  return { results, engine: 'ripgrep' };
}

// ─── Grep Search ──────────────────────────────────────────────────────────────

async function searchWithGrep(projectPath, query, opts) {
  const args = ['-rn', '--binary-files=without-match'];

  if (opts.ignoreCase !== false) args.push('-i');
  if (opts.contextLines) {
    args.push(`-C${opts.contextLines}`);
  }

  // Include code file extensions
  const exts = [
    '*.js', '*.mjs', '*.cjs', '*.ts', '*.tsx', '*.jsx',
    '*.py', '*.go', '*.java', '*.kt', '*.rs',
    '*.c', '*.cpp', '*.h', '*.hpp', '*.cs',
    '*.php', '*.rb', '*.swift', '*.vue', '*.svelte',
  ];
  for (const ext of exts) {
    args.push(`--include=${ext}`);
  }

  // Exclude directories
  for (const dir of IGNORE_DIRS) {
    args.push(`--exclude-dir=${dir}`);
  }

  args.push(query, projectPath);

  const r = await execSearch('grep', args, projectPath);
  if (!r.ok) return { results: [], engine: 'grep', error: r.stderr };

  return parseGrepOutput(r.stdout, projectPath, opts);
}

function parseGrepOutput(stdout, projectPath, opts) {
  const results = [];
  const lines = stdout.split('\n').filter(Boolean);
  const maxResults = opts.maxResults || MAX_RESULTS;

  for (const line of lines) {
    if (results.length >= maxResults) break;

    // Format: file:line:content  or  file-line-content (context lines)
    const match = line.match(/^(.+?):(\d+)[::](.*)$/);
    if (match) {
      const filePath = match[1];
      const relPath = filePath.startsWith(projectPath)
        ? path.relative(projectPath, filePath)
        : filePath;

      results.push({
        file: relPath,
        line: Number(match[2]),
        content: match[3].trimEnd(),
        contextBefore: [],
        contextAfter: [],
      });
    }
  }

  return { results, engine: 'grep' };
}

// ─── Node.js Fallback Search ──────────────────────────────────────────────────

async function searchWithNode(projectPath, query, opts) {
  const results = [];
  const regex = new RegExp(escapeRegex(query), opts.ignoreCase !== false ? 'i' : '');
  const maxResults = opts.maxResults || MAX_RESULTS;
  let filesScanned = 0;

  async function walk(dir, depth = 0) {
    if (depth > 8 || filesScanned > MAX_FILES_SCAN || results.length >= maxResults) return;

    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (results.length >= maxResults || filesScanned > MAX_FILES_SCAN) return;
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;

      const full = path.join(dir, e.name);

      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (CODE_EXTENSIONS.has(path.extname(e.name))) {
        filesScanned++;
        try {
          const fileStat = await stat(full);
          if (fileStat.size > MAX_FILE_SIZE) continue;

          const content = await readFile(full, 'utf8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            if (regex.test(lines[i])) {
              results.push({
                file: path.relative(projectPath, full),
                line: i + 1,
                content: lines[i].trimEnd(),
                contextBefore: lines.slice(Math.max(0, i - (opts.contextLines || 0)), i).map(l => l.trimEnd()),
                contextAfter: lines.slice(i + 1, i + 1 + (opts.contextLines || 0)).map(l => l.trimEnd()),
              });
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(projectPath);
  return { results, engine: 'node' };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Main Search ──────────────────────────────────────────────────────────────

/**
 * Search code in a project directory.
 *
 * @param {string} projectPath - Absolute project directory
 * @param {string} query - Search term
 * @param {Object} [opts]
 * @param {number} [opts.maxResults=50] - Maximum results
 * @param {number} [opts.contextLines=3] - Context lines around match
 * @param {boolean} [opts.ignoreCase=true] - Case insensitive
 * @param {boolean} [opts.noCache=false] - Skip cache
 * @returns {Promise<{results: Array, totalMatches: number, searchTime: number, engine: string}>}
 */
export async function searchCode(projectPath, query, opts = {}) {
  if (!query || !projectPath) {
    return { results: [], totalMatches: 0, searchTime: 0, engine: 'none' };
  }

  const key = cacheKey(projectPath, query, opts);
  if (!opts.noCache) {
    const cached = getCached(key);
    if (cached) {
      logger.info('CodeSearch', `Cache hit for "${query.substring(0, 40)}"`, { engine: cached.engine });
      return cached;
    }
  }

  const start = Date.now();
  await detectEngine();

  let result;

  if (_hasRipgrep) {
    result = await searchWithRipgrep(projectPath, query, opts);
  } else if (_hasGrep) {
    result = await searchWithGrep(projectPath, query, opts);
  } else {
    result = await searchWithNode(projectPath, query, opts);
  }

  const searchTime = Date.now() - start;
  const output = {
    results: result.results,
    totalMatches: result.results.length,
    searchTime,
    engine: result.engine,
  };

  if (!opts.noCache) {
    setCache(key, output);
  }

  logger.info('CodeSearch', `${result.engine}: "${query.substring(0, 40)}" → ${result.results.length} matches (${searchTime}ms)`);

  return output;
}

// ─── Symbol Search ────────────────────────────────────────────────────────────

const SYMBOL_DEF_PATTERNS = {
  javascript: (sym) => `(?:function|const|let|var|class|export)\\s+${escapeRegex(sym)}\\b`,
  python: (sym) => `(?:def|class)\\s+${escapeRegex(sym)}\\b`,
  go: (sym) => `(?:func|type|var|const)\\s+${escapeRegex(sym)}\\b`,
  java: (sym) => `(?:class|interface|enum|void|public|private|protected|static)\\s+.*${escapeRegex(sym)}\\b`,
  rust: (sym) => `(?:fn|struct|enum|impl|type|trait)\\s+${escapeRegex(sym)}\\b`,
};

/**
 * Search for symbol definitions in a project.
 *
 * @param {string} projectPath
 * @param {string} symbol - Symbol name to find
 * @param {Object} [opts]
 * @returns {Promise<{definitions: Array, references: Array}>}
 */
export async function searchSymbol(projectPath, symbol, opts = {}) {
  // Build combined regex for definitions across all languages
  const defPatterns = Object.values(SYMBOL_DEF_PATTERNS)
    .map(fn => fn(symbol))
    .join('|');

  const defResults = await searchCode(projectPath, defPatterns.length < 200 ? symbol : symbol, {
    ...opts,
    maxResults: opts.maxResults || 30,
    contextLines: 2,
    noCache: true,
  });

  // Separate definitions from references
  const defRegex = new RegExp(defPatterns, 'i');
  const definitions = [];
  const references = [];

  for (const r of defResults.results) {
    if (defRegex.test(r.content)) {
      const kind = detectDefinitionKind(r.content);
      definitions.push({ ...r, kind });
    } else {
      references.push(r);
    }
  }

  return { definitions, references };
}

function detectDefinitionKind(content) {
  if (/\b(?:function|def|func)\b/.test(content)) return 'function';
  if (/\bclass\b/.test(content)) return 'class';
  if (/\b(?:interface|trait)\b/.test(content)) return 'interface';
  if (/\b(?:enum)\b/.test(content)) return 'enum';
  if (/\b(?:struct|type)\b/.test(content)) return 'type';
  if (/\b(?:const|var|let)\b/.test(content)) return 'variable';
  return 'unknown';
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

export function _resetEngineCache() {
  _engineChecked = false;
  _hasRipgrep = false;
  _hasGrep = false;
}

export default { searchCode, searchSymbol, clearSearchCache };
