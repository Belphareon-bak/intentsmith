// Exploration Agent v1 — Autonomous codebase exploration
// ══════════════════════════════════════════════════════════════════════════════
//
// Given a question, autonomously explores the codebase:
//   1. Start with query expansion → initial search
//   2. Follow import chains → discover related files
//   3. Build mental model → answer or ask for more info
//
// Max iterations capped to prevent runaway exploration.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { expandQuery } from './query-expander.js';
import { searchCode } from './code-search.js';
import { symbolIndex } from './symbol-index.js';
import { readFile } from 'fs/promises';
import path from 'path';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 5;
const MAX_FILES_READ = 15;
const MAX_FILE_SIZE = 512 * 1024; // 512KB
const IMPORT_REGEX = /(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

// ─── Exploration State ───────────────────────────────────────────────────────

class ExplorationState {
  constructor(query) {
    this.query = query;
    this.filesRead = new Map();    // path → content summary
    this.symbolsFound = [];        // discovered symbols
    this.importChains = [];        // import relationships
    this.searchResults = [];       // raw search hits
    this.iterations = 0;
    this.trail = [];               // exploration trail for reporting
  }

  hasRead(filePath) { return this.filesRead.has(filePath); }
  filesReadCount() { return this.filesRead.size; }
}

// ─── Exploration Agent ───────────────────────────────────────────────────────

/**
 * Autonomously explore codebase to answer a question.
 *
 * @param {string} projectPath
 * @param {string} query - Developer's question
 * @param {Object} [opts]
 * @param {number} [opts.maxIterations=5]
 * @param {number} [opts.maxFiles=15]
 * @param {Function} [opts.onStep] - Called on each step for progress reporting
 * @returns {Promise<ExplorationResult>}
 */
export async function explore(projectPath, query, opts = {}) {
  const maxIterations = opts.maxIterations || MAX_ITERATIONS;
  const maxFiles = opts.maxFiles || MAX_FILES_READ;
  const onStep = opts.onStep || (() => {});
  const state = new ExplorationState(query);
  const start = Date.now();

  logger.info('ExplorationAgent', `Starting exploration: "${query.substring(0, 80)}"`);

  try {
    // ─── Phase 1: Initial search ─────────────────────────────────
    onStep('search', `Searching for: ${query.substring(0, 60)}`);
    const expanded = expandQuery(query);
    state.trail.push({ action: 'expand', detail: expanded });

    // Symbol index lookup first
    if (symbolIndex.symbolCount > 0) {
      for (const term of expanded.primary) {
        const symbols = symbolIndex.findSymbol(term);
        if (symbols && symbols.length > 0) {
          state.symbolsFound.push(...symbols);
          state.trail.push({ action: 'symbol_hit', detail: `${term}: ${symbols.length} definitions` });
        }
      }
    }

    // Code search for each query
    const queries = [expanded.primary.join(' '), ...expanded.secondary].slice(0, 3);
    for (const q of queries) {
      if (!q) continue;
      const result = await searchCode(projectPath, q, { maxResults: 20, contextLines: 2 });
      state.searchResults.push(...result.results);
    }

    // Deduplicate by file
    const uniqueFiles = [...new Set(state.searchResults.map(r => r.file))];
    state.trail.push({ action: 'search', detail: `${state.searchResults.length} hits in ${uniqueFiles.length} files` });

    // ─── Phase 2: Read top files ─────────────────────────────────
    onStep('read', `Reading ${Math.min(uniqueFiles.length, maxFiles)} files`);

    const filesToRead = prioritizeFiles(uniqueFiles, expanded, state.symbolsFound).slice(0, maxFiles);

    for (const relPath of filesToRead) {
      if (state.filesReadCount() >= maxFiles) break;
      await readAndAnalyze(projectPath, relPath, state);
    }

    // ─── Phase 3: Follow imports (iterative) ─────────────────────
    while (state.iterations < maxIterations && state.filesReadCount() < maxFiles) {
      state.iterations++;

      const newFiles = findUnexploredImports(state);
      if (newFiles.length === 0) break;

      onStep('follow', `Following ${newFiles.length} import chains (iteration ${state.iterations})`);
      state.trail.push({ action: 'follow_imports', detail: `${newFiles.length} new files` });

      for (const relPath of newFiles.slice(0, 3)) { // Max 3 per iteration
        if (state.filesReadCount() >= maxFiles) break;
        await readAndAnalyze(projectPath, relPath, state);
      }
    }

    const explorationTime = Date.now() - start;

    logger.info('ExplorationAgent', `Done: ${state.filesReadCount()} files read, ${state.symbolsFound.length} symbols found (${explorationTime}ms)`);

    return {
      query,
      filesExplored: [...state.filesRead.entries()].map(([path, info]) => ({
        path,
        lines: info.lines,
        symbols: info.symbols,
      })),
      symbolsFound: state.symbolsFound,
      importChains: state.importChains,
      searchHits: state.searchResults.length,
      iterations: state.iterations,
      trail: state.trail,
      explorationTime,
    };

  } catch (err) {
    logger.error('ExplorationAgent', `Exploration failed: ${err.message}`);
    return {
      query,
      filesExplored: [],
      symbolsFound: [],
      importChains: [],
      searchHits: 0,
      iterations: state.iterations,
      trail: state.trail,
      explorationTime: Date.now() - start,
      error: err.message,
    };
  }
}

// ─── File Reading & Analysis ─────────────────────────────────────────────────

async function readAndAnalyze(projectPath, relPath, state) {
  if (state.hasRead(relPath)) return;

  const absPath = path.join(projectPath, relPath);
  let content;
  try {
    content = await readFile(absPath, 'utf8');
    if (content.length > MAX_FILE_SIZE) {
      state.filesRead.set(relPath, { lines: 0, symbols: [], truncated: true });
      return;
    }
  } catch {
    return;
  }

  const lines = content.split('\n');

  // Extract imports
  const imports = [];
  const regex = new RegExp(IMPORT_REGEX.source, IMPORT_REGEX.flags);
  let match;
  while ((match = regex.exec(content)) !== null) {
    const imp = match[1];
    if (imp.startsWith('.')) {
      const resolved = path.normalize(path.join(path.dirname(relPath), imp)).replace(/\\/g, '/');
      imports.push(resolved);
      state.importChains.push({ from: relPath, to: resolved });
    }
  }

  // Extract top-level symbols (simple regex)
  const symbols = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Functions
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (fnMatch) symbols.push({ name: fnMatch[1], type: 'function', line: i + 1 });
    // Classes
    const clsMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
    if (clsMatch) symbols.push({ name: clsMatch[1], type: 'class', line: i + 1 });
    // Constants
    const constMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=/);
    if (constMatch && /^[A-Z]/.test(constMatch[1])) symbols.push({ name: constMatch[1], type: 'constant', line: i + 1 });
  }

  state.filesRead.set(relPath, { lines: lines.length, symbols, imports });
  if (symbols.length > 0) {
    state.symbolsFound.push(...symbols.map(s => ({ ...s, file: relPath })));
  }
}

// ─── Prioritization ─────────────────────────────────────────────────────────

function prioritizeFiles(files, expanded, symbolHits) {
  const scores = new Map();
  const terms = [...expanded.primary, ...expanded.secondary].map(t => t.toLowerCase());

  for (const file of files) {
    let score = 0;
    const lower = file.toLowerCase();

    // File name contains query term
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) score += 2;
    }

    // Symbol definitions in file
    for (const sym of symbolHits) {
      if (sym.file === file) score += 3;
    }

    // Prefer src/ over test/
    if (/(?:^|[/\\])src[/\\]/.test(file)) score += 1;
    if (/(?:^|[/\\])(test|tests|__tests__)[/\\]/.test(file)) score -= 1;

    scores.set(file, score);
  }

  return files.sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));
}

// ─── Import Following ────────────────────────────────────────────────────────

function findUnexploredImports(state) {
  const unexplored = new Set();

  for (const [, info] of state.filesRead) {
    if (!info.imports) continue;
    for (const imp of info.imports) {
      // Try with common extensions
      const candidates = [imp, imp + '.js', imp + '.ts', imp + '.mjs', imp + '/index.js', imp + '/index.ts'];
      for (const c of candidates) {
        if (!state.hasRead(c) && !unexplored.has(c)) {
          unexplored.add(c);
          break;
        }
      }
    }
  }

  return [...unexplored];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatExplorationReport(result) {
  const parts = ['## Exploration Report'];

  parts.push(`**Query:** ${result.query}`);
  parts.push(`**Files explored:** ${result.filesExplored.length}`);
  parts.push(`**Search hits:** ${result.searchHits}`);
  parts.push(`**Iterations:** ${result.iterations}`);
  parts.push('');

  if (result.filesExplored.length > 0) {
    parts.push('### Files Explored');
    for (const f of result.filesExplored) {
      const syms = f.symbols.length > 0
        ? ` (${f.symbols.map(s => s.name).join(', ')})`
        : '';
      parts.push(`- \`${f.path}\` — ${f.lines} lines${syms}`);
    }
  }

  if (result.importChains.length > 0) {
    parts.push('', '### Import Graph');
    const shown = new Set();
    for (const ic of result.importChains.slice(0, 20)) {
      const key = `${ic.from}→${ic.to}`;
      if (shown.has(key)) continue;
      shown.add(key);
      parts.push(`- \`${ic.from}\` → \`${ic.to}\``);
    }
  }

  if (result.trail.length > 0) {
    parts.push('', '### Exploration Trail');
    for (const t of result.trail) {
      parts.push(`- [${t.action}] ${typeof t.detail === 'string' ? t.detail : JSON.stringify(t.detail)}`);
    }
  }

  parts.push('', '---', `*Explored in ${result.explorationTime}ms*`);
  return parts.join('\n');
}

export default { explore, formatExplorationReport };
