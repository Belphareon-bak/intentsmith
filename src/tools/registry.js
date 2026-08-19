// CRE v36.9.2 Tool Registry
// ══════════════════════════════════════════════════════════════════════════════
//
// Central registry of all executable tools.
// Pure functions, no LLM, no text generation.
//
// Each tool has:
//   - name: matches ToolName from cre-decision-types.js
//   - description: what it does (for logging/debugging only)
//   - params.required: array of required param names
//   - params.optional: array of optional param names
//   - permissions: array of required permissions (stub for now)
//   - execute(params, context): the actual function → result | ErrorObject
//
// Stop-condition: registry['web.search'].execute() → Array | ErrorObject
//
// ══════════════════════════════════════════════════════════════════════════════

import { httpClient } from './http-client.js';
import {
  dependencyVulnerabilityResult,
  npmAuditError,
  npmAuditOverview,
  runNpmAuditReport,
} from './npm-audit.js';
import { memory } from '../memory/policy.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION STRUCTURE
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ToolMeta
 * @property {boolean} sideEffects   - Does this tool modify external state?
 * @property {boolean} idempotent    - Same input → same result, safe to retry?
 * @property {boolean} destructive   - Can this tool cause data loss?
 * @property {boolean} requiresConfirmation - Should autonomy layer ask user first?
 * @property {'free'|'low'|'medium'|'high'} costLevel - Resource/time cost
 * @property {'read'|'write'|'exec'|'net'|'pure'} category - Operation class
 */

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {{ required: string[], optional: string[] }} params
 * @property {string[]} permissions
 * @property {ToolMeta} meta
 * @property {(params: Object, context?: Object) => Promise<any>} execute
 */

// ════════════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ════════════════════════════════════════════════════════════════════════════

const tools = {};

// ────────────────────────────────────────────────────────────────────────────
// web.search
// ────────────────────────────────────────────────────────────────────────────

tools['web.search'] = {
  name: 'web.search',
  description: 'Search the web via configured search backend',
  params: {
    required: ['query'],
    optional: ['maxResults', 'domain', 'language'],
  },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'net' },
  async execute(params, context = {}) {
    const { query, maxResults = 5, domain, language = 'cs' } = params;
    const searchUrl = context.searchBaseUrl || 'https://www.googleapis.com/customsearch/v1';

    // Build search URL with params
    const url = new URL(searchUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(Math.min(maxResults, 10)));
    if (domain) url.searchParams.set('siteSearch', domain);
    if (language) url.searchParams.set('hl', language);
    if (context.apiKey) url.searchParams.set('key', context.apiKey);
    if (context.cx) url.searchParams.set('cx', context.cx);

    const response = await httpClient.get(url.toString(), {
      timeout: context.timeout || 10000,
    });

    if (!response.ok) {
      return { error: response.error, code: response.code || 'SEARCH_FAILED' };
    }

    // Parse results
    try {
      const data = JSON.parse(response.body);
      const items = data.items || data.results || [];
      return items.map(item => ({
        title: item.title || '',
        url: item.link || item.url || '',
        snippet: item.snippet || item.description || '',
      }));
    } catch {
      // Return raw body if not JSON (some search APIs return HTML)
      return { error: 'Failed to parse search results', code: 'PARSE_ERROR', raw: response.body.substring(0, 500) };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// web.fetch
// ────────────────────────────────────────────────────────────────────────────

tools['web.fetch'] = {
  name: 'web.fetch',
  description: 'Fetch a URL and return its content',
  params: {
    required: ['url'],
    optional: ['headers', 'method', 'body', 'timeout'],
  },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { url, headers, method, body, timeout } = params;

    const response = await httpClient.request(url, {
      method: method || 'GET',
      headers,
      body,
      timeout: timeout || 15000,
    });

    if (!response.ok) {
      return { error: response.error, code: response.code || 'FETCH_FAILED', status: response.status };
    }

    return {
      status: response.status,
      body: response.body,
      headers: response.headers,
      duration: response.duration,
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// web.scrape
// ────────────────────────────────────────────────────────────────────────────

tools['web.scrape'] = {
  name: 'web.scrape',
  description: 'Scrape a web page and extract structured data',
  params: {
    required: ['url'],
    optional: ['selector', 'format', 'timeout'],
  },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { url, timeout } = params;

    const response = await httpClient.get(url, {
      timeout: timeout || 15000,
    });

    if (!response.ok) {
      return { error: response.error, code: response.code || 'SCRAPE_FAILED' };
    }

    // Basic extraction - return raw HTML content
    // (Advanced parsing would use a DOM parser, but no dependencies for now)
    return {
      url,
      content: response.body,
      contentLength: response.body.length,
      duration: response.duration,
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// data.parse
// ────────────────────────────────────────────────────────────────────────────

tools['data.parse'] = {
  name: 'data.parse',
  description: 'Parse data from one format to structured object',
  params: {
    required: ['input'],
    optional: ['format'],
  },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, format = 'json' } = params;

    if (format === 'json') {
      try {
        return { data: JSON.parse(input) };
      } catch (e) {
        return { error: `JSON parse error: ${e.message}`, code: 'PARSE_ERROR' };
      }
    }

    // CSV basic parsing
    if (format === 'csv') {
      const lines = input.split('\n').filter(l => l.trim());
      if (lines.length === 0) return { data: [] };
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const row = {};
        headers.forEach((h, i) => { row[h] = values[i] || ''; });
        return row;
      });
      return { data: rows };
    }

    return { error: `Unsupported format: ${format}`, code: 'UNSUPPORTED_FORMAT' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// data.filter
// ────────────────────────────────────────────────────────────────────────────

tools['data.filter'] = {
  name: 'data.filter',
  description: 'Filter array of objects by criteria',
  params: {
    required: ['data', 'criteria'],
    optional: ['limit'],
  },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { data, criteria, limit } = params;

    if (!Array.isArray(data)) {
      return { error: 'data must be an array', code: 'INVALID_INPUT' };
    }

    let result = data.filter(item => {
      return Object.entries(criteria).every(([key, value]) => {
        const itemVal = item[key];
        if (typeof value === 'object' && value !== null) {
          // Range filter: { min, max }
          if (value.min !== undefined && itemVal < value.min) return false;
          if (value.max !== undefined && itemVal > value.max) return false;
          return true;
        }
        // Exact match or contains
        if (typeof itemVal === 'string') return itemVal.toLowerCase().includes(String(value).toLowerCase());
        return itemVal === value;
      });
    });

    if (limit) result = result.slice(0, limit);

    return { data: result, count: result.length };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.read
// ────────────────────────────────────────────────────────────────────────────

tools['fs.read'] = {
  name: 'fs.read',
  description: 'Read a file from the filesystem',
  params: {
    required: ['path'],
    optional: ['encoding'],
  },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path, encoding = 'utf-8' } = params;
    const { readFile } = await import('fs/promises');

    try {
      const content = await readFile(path, encoding);
      return { content, path, size: content.length };
    } catch (err) {
      return { error: err.message, code: 'FS_ERROR' };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.write
// ────────────────────────────────────────────────────────────────────────────

tools['fs.write'] = {
  name: 'fs.write',
  description: 'Write content to a file',
  params: {
    required: ['path', 'content'],
    // `encoding` tu bývalo a **zmizelo schválně**.  Řízená cesta digestuje
    // obsah jako UTF-8 řetězec, protože přesně nad tím se počítá předpoklad i
    // otisk approvalu; jiné kódování by znamenalo, že se člověk rozhoduje o
    // jiných bajtech, než jaké dorazí na disk.  Deklarovaný parametr, který se
    // tiše ignoruje, je horší než žádný.
    optional: [],
  },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params, context = {}) {
    const { path, content } = params;

    // Nástrojová cesta jde přes tutéž řízenou cestu jako handler (P0-2).
    // Dokud tady byl `writeFile`, byl `fs.write` obchvat kolem approvalu:
    // stačilo, aby model zvolil nástroj místo FILE_WRITE intentu, a soubor
    // vznikl bez otázky.  Jedna bezpečná cesta a jedna nebezpečná vedle ní
    // není jedna cesta.
    const { writeUserFile } = await import('../executor/effects.js');

    try {
      const result = await writeUserFile({
        filePath: path,
        content: String(content ?? ''),
        runId: context.runId || `tool:${context.sessionId || 'anonymous'}`,
        ownerLabel: 'fs.write',
      });
      if (!result.written) {
        // Nezapsáno **není** zapsáno: nástroj vrací důvod, ne tiché `written: 0`.
        return {
          path: result.target || path,
          written: 0,
          refused: true,
          state: result.state,
          guard: result.guard,
          ...(result.message ? { message: result.message } : {}),
          ...(result.approvalId ? { approvalId: result.approvalId } : {}),
        };
      }
      return { path: result.target || path, written: content.length, guard: result.guard };
    } catch (err) {
      return { error: err.message, code: 'FS_ERROR' };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.list
// ────────────────────────────────────────────────────────────────────────────

tools['fs.list'] = {
  name: 'fs.list',
  description: 'List files in a directory',
  params: {
    required: ['path'],
    optional: ['pattern'],
  },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path } = params;
    const { readdir } = await import('fs/promises');

    try {
      const entries = await readdir(path, { withFileTypes: true });
      return {
        files: entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        })),
      };
    } catch (err) {
      return { error: err.message, code: 'FS_ERROR' };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// memory.store
// ────────────────────────────────────────────────────────────────────────────

tools['memory.store'] = {
  name: 'memory.store',
  description: 'Store a fact in session memory',
  params: {
    required: ['key', 'value'],
    optional: ['ttl', 'source', 'tags'],
  },
  permissions: [],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { key, value, ttl, source, tags } = params;
    return memory.set(key, value, { ttl, source, tags });
  },
};

// ────────────────────────────────────────────────────────────────────────────
// memory.recall
// ────────────────────────────────────────────────────────────────────────────

tools['memory.recall'] = {
  name: 'memory.recall',
  description: 'Recall a fact from session memory',
  params: {
    required: ['key'],
    optional: ['tag', 'prefix'],
  },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { key, tag, prefix } = params;

    // Tag-based recall
    if (tag) return { results: memory.getByTag(tag) };
    // Prefix-based recall
    if (prefix) return { results: memory.getByPrefix(prefix) };
    // Key-based recall
    return memory.get(key);
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.copy
// ────────────────────────────────────────────────────────────────────────────

tools['fs.copy'] = {
  name: 'fs.copy',
  description: 'Copy a file or directory',
  params: { required: ['src', 'dest'], optional: ['recursive'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { src, dest, recursive = true } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      await fsP.mkdir(pathM.dirname(dest), { recursive: true });
      await fsP.cp(src, dest, { recursive });
      return { src, dest, ok: true };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.move
// ────────────────────────────────────────────────────────────────────────────

tools['fs.move'] = {
  name: 'fs.move',
  description: 'Move or rename a file or directory',
  params: { required: ['src', 'dest'], optional: [] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: true, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { src, dest } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      await fsP.mkdir(pathM.dirname(dest), { recursive: true });
      await fsP.rename(src, dest);
      return { src, dest, ok: true };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.delete
// ────────────────────────────────────────────────────────────────────────────

tools['fs.delete'] = {
  name: 'fs.delete',
  description: 'Delete a file or directory',
  params: { required: ['path'], optional: ['recursive'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: true, requiresConfirmation: true, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { path, recursive = false } = params;
    const fsP = await import('fs/promises');
    try {
      await fsP.rm(path, { recursive, force: false });
      return { path, ok: true };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.glob
// ────────────────────────────────────────────────────────────────────────────

tools['fs.glob'] = {
  name: 'fs.glob',
  description: 'Find files matching a glob pattern',
  params: { required: ['pattern'], optional: ['cwd', 'maxResults'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { pattern, cwd = '.', maxResults = 100 } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const results = [];
      async function walk(dir, depth) {
        if (depth > 10 || results.length >= maxResults) return;
        const entries = await fsP.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (['node_modules', '.git', '.c3'].includes(e.name)) continue;
          const full = pathM.join(dir, e.name);
          const rel = pathM.relative(cwd, full);
          if (e.isDirectory()) { await walk(full, depth + 1); }
          else if (_matchGlob(rel, pattern)) { results.push(rel); }
          if (results.length >= maxResults) return;
        }
      }
      await walk(pathM.resolve(cwd), 0);
      return { files: results, count: results.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

function _matchGlob(str, pattern) {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp('^' + re + '$').test(str);
}

// ────────────────────────────────────────────────────────────────────────────
// fs.diff
// ────────────────────────────────────────────────────────────────────────────

tools['fs.diff'] = {
  name: 'fs.diff',
  description: 'Compare two files and return differences',
  params: { required: ['fileA', 'fileB'], optional: [] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { fileA, fileB } = params;
    const fsP = await import('fs/promises');
    try {
      const [a, b] = await Promise.all([fsP.readFile(fileA, 'utf-8'), fsP.readFile(fileB, 'utf-8')]);
      const linesA = a.split('\n'), linesB = b.split('\n');
      const changes = [];
      const maxLen = Math.max(linesA.length, linesB.length);
      for (let i = 0; i < maxLen; i++) {
        if (linesA[i] !== linesB[i]) changes.push({ line: i + 1, a: linesA[i] ?? null, b: linesB[i] ?? null });
      }
      return { fileA, fileB, identical: changes.length === 0, changes: changes.slice(0, 200), totalChanges: changes.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fs.stat
// ────────────────────────────────────────────────────────────────────────────

tools['fs.stat'] = {
  name: 'fs.stat',
  description: 'Get file or directory metadata (size, dates, permissions)',
  params: { required: ['path'], optional: [] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path } = params;
    const fsP = await import('fs/promises');
    try {
      const s = await fsP.stat(path);
      return { path, size: s.size, isFile: s.isFile(), isDir: s.isDirectory(), created: s.birthtime, modified: s.mtime, mode: s.mode };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// git.status
// ────────────────────────────────────────────────────────────────────────────

tools['git.status'] = {
  name: 'git.status',
  description: 'Get git status, branch, and recent log',
  params: { required: [], optional: ['cwd', 'log'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { cwd = '.', log = 5 } = params;
    const { execSync } = await import('child_process');
    try {
      const status = execSync('git status --porcelain', { cwd, timeout: 5000, encoding: 'utf-8' });
      const branch = execSync('git branch --show-current', { cwd, timeout: 3000, encoding: 'utf-8' }).trim();
      const logOut = execSync(`git log --oneline -${Math.min(log, 20)}`, { cwd, timeout: 5000, encoding: 'utf-8' });
      const files = {};
      status.split('\n').filter(Boolean).forEach(l => { files[l.substring(3)] = l.substring(0, 2).trim(); });
      return { branch, files, log: logOut.trim().split('\n'), clean: Object.keys(files).length === 0 };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// git.commit
// ────────────────────────────────────────────────────────────────────────────

tools['git.commit'] = {
  name: 'git.commit',
  description: 'Stage files and create a git commit',
  params: { required: ['message'], optional: ['cwd', 'files', 'all'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { message, cwd = '.', files, all = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (all) execSync('git add -A', { cwd, timeout: 10000 });
      else if (files?.length) execSync(`git add -- ${files.map(f => `"${f}"`).join(' ')}`, { cwd, timeout: 10000 });
      const result = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, timeout: 10000, encoding: 'utf-8' });
      return { ok: true, output: result.trim() };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// git.diff
// ────────────────────────────────────────────────────────────────────────────

tools['git.diff'] = {
  name: 'git.diff',
  description: 'Show git diff (staged or unstaged)',
  params: { required: [], optional: ['cwd', 'staged', 'file'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { cwd = '.', staged = false, file } = params;
    const { execSync } = await import('child_process');
    try {
      const args = staged ? '--cached' : '';
      const fileArg = file ? `-- "${file}"` : '';
      const diff = execSync(`git diff ${args} ${fileArg}`.trim(), { cwd, timeout: 10000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      return { diff, lines: diff.split('\n').length };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// shell.exec
// ────────────────────────────────────────────────────────────────────────────

tools['shell.exec'] = {
  name: 'shell.exec',
  description: 'Execute a shell command in the project sandbox',
  params: { required: ['command'], optional: ['cwd', 'timeout'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'exec' },
  async execute(params) {
    const { command, cwd = '.', timeout = 30000 } = params;
    const { execSync } = await import('child_process');
    try {
      const output = execSync(command, {
        cwd, timeout: Math.min(timeout, 60000),
        encoding: 'utf-8', maxBuffer: 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production' },
      });
      return { ok: true, output: output.substring(0, 50000), exitCode: 0 };
    } catch (err) {
      return { ok: false, output: (err.stdout || '') + (err.stderr || ''), exitCode: err.status || 1, error: err.message };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// http.request
// ────────────────────────────────────────────────────────────────────────────

tools['http.request'] = {
  name: 'http.request',
  description: 'Full HTTP client — GET, POST, PUT, DELETE with headers/body',
  params: { required: ['url'], optional: ['method', 'headers', 'body', 'timeout', 'json'] },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { url, method = 'GET', headers = {}, body, timeout = 15000, json = true } = params;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const opts = { method, headers: { ...headers }, signal: ctrl.signal };
      if (body) {
        opts.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (json && !opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(url, opts);
      clearTimeout(timer);
      const text = await res.text();
      let data = text;
      if (json) { try { data = JSON.parse(text); } catch {} }
      return { status: res.status, ok: res.ok, data, headers: Object.fromEntries(res.headers) };
    } catch (err) { return { error: err.message, code: 'HTTP_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// archive.extract
// ────────────────────────────────────────────────────────────────────────────

tools['archive.extract'] = {
  name: 'archive.extract',
  description: 'Extract a zip/tar/gz archive',
  params: { required: ['archive', 'dest'], optional: [] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'write' },
  async execute(params) {
    const { archive, dest } = params;
    const { execSync } = await import('child_process');
    const fsP = await import('fs/promises');
    try {
      await fsP.mkdir(dest, { recursive: true });
      if (archive.endsWith('.zip')) execSync(`unzip -o "${archive}" -d "${dest}"`, { timeout: 60000 });
      else if (archive.endsWith('.tar.gz') || archive.endsWith('.tgz')) execSync(`tar -xzf "${archive}" -C "${dest}"`, { timeout: 60000 });
      else if (archive.endsWith('.tar')) execSync(`tar -xf "${archive}" -C "${dest}"`, { timeout: 60000 });
      else if (archive.endsWith('.gz')) execSync(`gunzip -k "${archive}"`, { timeout: 30000 });
      else return { error: `Unsupported: ${archive}`, code: 'UNSUPPORTED' };
      const entries = await fsP.readdir(dest, { withFileTypes: true });
      return { ok: true, dest, files: entries.map(e => e.name), count: entries.length };
    } catch (err) { return { error: err.message, code: 'ARCHIVE_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// archive.create
// ────────────────────────────────────────────────────────────────────────────

tools['archive.create'] = {
  name: 'archive.create',
  description: 'Create a zip or tar.gz archive',
  params: { required: ['source', 'output'], optional: ['format'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'write' },
  async execute(params) {
    const { source, output, format } = params;
    const { execSync } = await import('child_process');
    try {
      const fmt = format || (output.endsWith('.tar.gz') || output.endsWith('.tgz') ? 'tar.gz' : 'zip');
      if (fmt === 'zip') execSync(`zip -r "${output}" "${source}"`, { timeout: 120000 });
      else execSync(`tar -czf "${output}" "${source}"`, { timeout: 120000 });
      const fsP = await import('fs/promises');
      const stat = await fsP.stat(output);
      return { ok: true, output, size: stat.size, format: fmt };
    } catch (err) { return { error: err.message, code: 'ARCHIVE_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// hash.checksum
// ────────────────────────────────────────────────────────────────────────────

tools['hash.checksum'] = {
  name: 'hash.checksum',
  description: 'Compute hash of a file or string',
  params: { required: ['input'], optional: ['algorithm', 'inputType'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'pure' },
  async execute(params) {
    const { input, algorithm = 'sha256', inputType = 'file' } = params;
    const { createHash } = await import('crypto');
    try {
      const hash = createHash(algorithm);
      if (inputType === 'file') {
        const fsP = await import('fs/promises');
        hash.update(await fsP.readFile(input));
      } else { hash.update(input); }
      return { hash: hash.digest('hex'), algorithm };
    } catch (err) { return { error: err.message, code: 'HASH_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// json.transform
// ────────────────────────────────────────────────────────────────────────────

tools['json.transform'] = {
  name: 'json.transform',
  description: 'Transform JSON — pick/omit fields, sort, flatten, unique',
  params: { required: ['data'], optional: ['pick', 'omit', 'sortBy', 'reverse', 'flatten', 'unique'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { data, pick, omit, sortBy, reverse, flatten, unique } = params;
    try {
      let result = typeof data === 'string' ? JSON.parse(data) : data;
      if (flatten && Array.isArray(result)) result = result.flat(typeof flatten === 'number' ? flatten : 1);
      if (Array.isArray(result)) {
        if (pick) result = result.map(item => { const o = {}; pick.forEach(k => { if (item[k] !== undefined) o[k] = item[k]; }); return o; });
        if (omit) result = result.map(item => { const o = { ...item }; omit.forEach(k => delete o[k]); return o; });
        if (sortBy) result.sort((a, b) => a[sortBy] < b[sortBy] ? -1 : a[sortBy] > b[sortBy] ? 1 : 0);
        if (reverse) result.reverse();
        if (unique) result = [...new Map(result.map(i => [JSON.stringify(i), i])).values()];
      } else if (typeof result === 'object' && result) {
        if (pick) { const o = {}; pick.forEach(k => { if (result[k] !== undefined) o[k] = result[k]; }); result = o; }
        if (omit) { result = { ...result }; omit.forEach(k => delete result[k]); }
      }
      return { data: result, count: Array.isArray(result) ? result.length : 1 };
    } catch (err) { return { error: err.message, code: 'TRANSFORM_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// csv.convert
// ────────────────────────────────────────────────────────────────────────────

tools['csv.convert'] = {
  name: 'csv.convert',
  description: 'Convert between CSV and JSON',
  params: { required: ['input', 'direction'], optional: ['delimiter', 'headers'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, direction, delimiter = ',', headers } = params;
    try {
      if (direction === 'csv_to_json') {
        const lines = input.split('\n').filter(l => l.trim());
        const hdr = headers || lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = (headers ? lines : lines.slice(1)).map(line => {
          const vals = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
          const obj = {}; hdr.forEach((h, i) => { obj[h] = vals[i] || ''; }); return obj;
        });
        return { data: rows, count: rows.length };
      }
      const data = typeof input === 'string' ? JSON.parse(input) : input;
      if (!Array.isArray(data) || !data.length) return { error: 'Input must be non-empty array', code: 'INVALID_INPUT' };
      const keys = Object.keys(data[0]);
      const csv = [keys.join(delimiter), ...data.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(delimiter))].join('\n');
      return { csv, rows: data.length, columns: keys.length };
    } catch (err) { return { error: err.message, code: 'CSV_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// template.render
// ────────────────────────────────────────────────────────────────────────────

tools['template.render'] = {
  name: 'template.render',
  description: 'Render a Mustache-style template with variables',
  params: { required: ['template', 'vars'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { template, vars } = params;
    try {
      let result = template;
      result = result.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
        const arr = vars[key]; if (!Array.isArray(arr)) return '';
        return arr.map((item, i) => {
          let line = body;
          if (typeof item === 'object') Object.entries(item).forEach(([k, v]) => { line = line.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)); });
          return line.replace(/\{\{this\}\}/g, String(item)).replace(/\{\{@index\}\}/g, String(i));
        }).join('');
      });
      result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => vars[key] ? body : '');
      result = result.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
        const val = key.split('.').reduce((o, k) => o?.[k], vars);
        return val !== undefined ? String(val) : '';
      });
      return { output: result, length: result.length };
    } catch (err) { return { error: err.message, code: 'TEMPLATE_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// env.get / env.set
// ────────────────────────────────────────────────────────────────────────────

tools['env.get'] = {
  name: 'env.get',
  description: 'Read environment variable(s), hides secrets',
  params: { required: [], optional: ['key', 'prefix'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { key, prefix } = params;
    if (key) return { key, value: process.env[key] || null };
    const hide = /token|secret|password|key|pass|auth|credential/i;
    if (prefix) {
      const vars = {}; Object.entries(process.env).forEach(([k, v]) => { if (k.startsWith(prefix) && !hide.test(k)) vars[k] = v; });
      return { vars, count: Object.keys(vars).length };
    }
    const safe = {}; Object.entries(process.env).forEach(([k, v]) => { if (!hide.test(k)) safe[k] = v; });
    return { vars: safe, count: Object.keys(safe).length };
  },
};

tools['env.set'] = {
  name: 'env.set',
  description: 'Set an environment variable for current session',
  params: { required: ['key', 'value'], optional: [] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'free', category: 'write' },
  async execute(params) { process.env[params.key] = params.value; return { ok: true, key: params.key }; },
};

// ────────────────────────────────────────────────────────────────────────────
// docker.run
// ────────────────────────────────────────────────────────────────────────────

tools['docker.run'] = {
  name: 'docker.run',
  description: 'Run a command in a Docker container (sandboxed)',
  params: { required: ['image', 'command'], optional: ['volumes', 'env', 'timeout', 'network'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { image, command, volumes = [], env = {}, timeout = 60000, network = 'none' } = params;
    const { execSync } = await import('child_process');
    try {
      const volArgs = volumes.map(v => `-v "${v}"`).join(' ');
      const envArgs = Object.entries(env).map(([k, v]) => `-e ${k}="${v}"`).join(' ');
      const cmd = `docker run --rm --network=${network} --memory=512m --cpus=1 --pids-limit=100 ${volArgs} ${envArgs} ${image} ${command}`;
      const output = execSync(cmd, { timeout: Math.min(timeout, 120000), encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, output: output.substring(0, 50000) };
    } catch (err) { return { ok: false, output: (err.stdout || '') + (err.stderr || ''), error: err.message }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// image.info / image.resize
// ────────────────────────────────────────────────────────────────────────────

tools['image.info'] = {
  name: 'image.info',
  description: 'Get image metadata (dimensions, format, size)',
  params: { required: ['path'], optional: [] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const fsP = await import('fs/promises');
    try {
      const stat = await fsP.stat(params.path);
      const buf = Buffer.alloc(24);
      const fh = await fsP.open(params.path, 'r');
      await fh.read(buf, 0, 24, 0); await fh.close();
      let width, height, format;
      if (buf[0] === 0x89 && buf[1] === 0x50) { format = 'png'; width = buf.readUInt32BE(16); height = buf.readUInt32BE(20); }
      else if (buf[0] === 0xFF && buf[1] === 0xD8) { format = 'jpeg'; }
      else if (buf[0] === 0x47 && buf[1] === 0x49) { format = 'gif'; width = buf.readUInt16LE(6); height = buf.readUInt16LE(8); }
      else { format = params.path.split('.').pop(); }
      return { path: params.path, format, size: stat.size, width, height };
    } catch (err) { return { error: err.message, code: 'IMAGE_ERROR' }; }
  },
};

tools['image.resize'] = {
  name: 'image.resize',
  description: 'Resize an image (requires ImageMagick or ffmpeg)',
  params: { required: ['input', 'output'], optional: ['width', 'height', 'quality'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'write' },
  async execute(params) {
    const { input, output, width, height, quality = 85 } = params;
    const { execSync } = await import('child_process');
    try {
      const size = width && height ? `${width}x${height}` : width ? `${width}x` : `x${height}`;
      try { execSync(`convert "${input}" -resize ${size} -quality ${quality} "${output}"`, { timeout: 30000 }); }
      catch { execSync(`ffmpeg -i "${input}" -vf scale=${width || -1}:${height || -1} "${output}" -y`, { timeout: 30000 }); }
      const fsP = await import('fs/promises');
      return { ok: true, output, size: (await fsP.stat(output)).size };
    } catch (err) { return { error: err.message, code: 'IMAGE_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// db.query
// ────────────────────────────────────────────────────────────────────────────

tools['db.query'] = {
  name: 'db.query',
  description: 'Execute SQL on a SQLite database',
  params: { required: ['dbPath', 'sql'], optional: ['params'] },
  permissions: ['fs.read'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(toolParams) {
    const { dbPath, sql, params = [] } = toolParams;
    try {
      const Database = (await import('better-sqlite3')).default;
      const isRead = /^\s*(SELECT|PRAGMA|EXPLAIN)/i.test(sql);
      const db = new Database(dbPath, { readonly: isRead });
      let result;
      if (isRead) { result = db.prepare(sql).all(...params); db.close(); return { rows: result.slice(0, 1000), count: result.length }; }
      else { result = db.prepare(sql).run(...params); db.close(); return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }; }
    } catch (err) { return { error: err.message, code: 'DB_ERROR' }; }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// cron.schedule
// ────────────────────────────────────────────────────────────────────────────

const _cronJobs = new Map();

tools['cron.schedule'] = {
  name: 'cron.schedule',
  description: 'Schedule periodic tasks (in-memory, lost on restart)',
  params: { required: ['action'], optional: ['name', 'intervalMs', 'command'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'exec' },
  async execute(params) {
    const { action, name, intervalMs, command } = params;
    if (action === 'list') return { jobs: [..._cronJobs.entries()].map(([n, j]) => ({ name: n, interval: j.interval, runs: j.runs, lastRun: j.lastRun })) };
    if (action === 'add') {
      if (!name || !intervalMs || !command) return { error: 'name, intervalMs, command required', code: 'INVALID_INPUT' };
      if (_cronJobs.has(name)) clearInterval(_cronJobs.get(name).timer);
      const job = { interval: intervalMs, command, runs: 0, lastRun: null, timer: null };
      job.timer = setInterval(async () => {
        try { (await import('child_process')).execSync(command, { timeout: 30000 }); } catch {}
        job.runs++; job.lastRun = new Date().toISOString();
      }, intervalMs);
      _cronJobs.set(name, job);
      return { ok: true, name, intervalMs };
    }
    if (action === 'remove') {
      if (!_cronJobs.has(name)) return { error: 'Not found', code: 'NOT_FOUND' };
      clearInterval(_cronJobs.get(name).timer); _cronJobs.delete(name);
      return { ok: true, removed: name };
    }
    return { error: `Unknown action: ${action}`, code: 'INVALID_ACTION' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// base64.encode / base64.decode
// ────────────────────────────────────────────────────────────────────────────

tools['base64.encode'] = {
  name: 'base64.encode',
  description: 'Encode string or file to base64',
  params: { required: ['input'], optional: ['inputType'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, inputType = 'string' } = params;
    try {
      const data = inputType === 'file' ? await (await import('fs/promises')).readFile(input) : Buffer.from(input);
      return { output: data.toString('base64'), length: data.length };
    } catch (err) { return { error: err.message, code: 'ENCODE_ERROR' }; }
  },
};

tools['base64.decode'] = {
  name: 'base64.decode',
  description: 'Decode base64 to string or file',
  params: { required: ['input'], optional: ['outputPath'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, outputPath } = params;
    try {
      const buf = Buffer.from(input, 'base64');
      if (outputPath) { await (await import('fs/promises')).writeFile(outputPath, buf); return { output: outputPath, size: buf.length }; }
      return { output: buf.toString('utf-8'), length: buf.length };
    } catch (err) { return { error: err.message, code: 'DECODE_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// GIT — Full Suite
// ════════════════════════════════════════════════════════════════════════════

tools['git.push'] = {
  name: 'git.push',
  description: 'Push commits to remote repository',
  params: { required: [], optional: ['cwd', 'remote', 'branch', 'force', 'tags', 'setUpstream'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { cwd = '.', remote = 'origin', branch, force = false, tags = false, setUpstream = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `git push ${remote}`;
      if (branch) cmd += ` ${branch}`;
      if (force) cmd += ' --force-with-lease';
      if (tags) cmd += ' --tags';
      if (setUpstream) cmd += ' -u';
      const output = execSync(cmd, { cwd, timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, output: output.trim() };
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      if (out.includes('rejected')) return { error: 'Push rejected — pull first or use force', code: 'GIT_REJECTED', output: out };
      return { error: err.message, code: 'GIT_ERROR', output: out };
    }
  },
};

tools['git.pull'] = {
  name: 'git.pull',
  description: 'Pull changes from remote repository',
  params: { required: [], optional: ['cwd', 'remote', 'branch', 'rebase', 'ff'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { cwd = '.', remote = 'origin', branch, rebase = false, ff = true } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `git pull ${remote}`;
      if (branch) cmd += ` ${branch}`;
      if (rebase) cmd += ' --rebase';
      if (!ff) cmd += ' --no-ff';
      const output = execSync(cmd, { cwd, timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, output: output.trim() };
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      if (out.includes('CONFLICT')) return { error: 'Merge conflict detected', code: 'GIT_CONFLICT', output: out };
      return { error: err.message, code: 'GIT_ERROR', output: out };
    }
  },
};

tools['git.clone'] = {
  name: 'git.clone',
  description: 'Clone a git repository',
  params: { required: ['url'], optional: ['dest', 'branch', 'depth', 'cwd'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'net' },
  async execute(params) {
    const { url, dest, branch, depth, cwd = '.' } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `git clone "${url}"`;
      if (dest) cmd += ` "${dest}"`;
      if (branch) cmd += ` -b ${branch}`;
      if (depth) cmd += ` --depth ${depth}`;
      execSync(cmd, { cwd, timeout: 120000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, url, dest: dest || url.split('/').pop().replace(/\.git$/, '') };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR', output: (err.stderr || '') }; }
  },
};

tools['git.branch'] = {
  name: 'git.branch',
  description: 'Create, delete, list, or rename branches',
  params: { required: ['action'], optional: ['cwd', 'name', 'newName', 'remote', 'force'] },
  permissions: ['fs.read'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { action, cwd = '.', name, newName, remote = false, force = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (action === 'list') {
        const flags = remote ? '-a' : '';
        const out = execSync(`git branch ${flags} --format='%(refname:short) %(objectname:short) %(upstream:short)'`, { cwd, timeout: 5000, encoding: 'utf-8' });
        const current = execSync('git branch --show-current', { cwd, timeout: 3000, encoding: 'utf-8' }).trim();
        const branches = out.trim().split('\n').filter(Boolean).map(l => {
          const [n, hash, upstream] = l.split(' ');
          return { name: n, hash, upstream: upstream || null, current: n === current };
        });
        return { branches, current, count: branches.length };
      }
      if (action === 'create') {
        execSync(`git branch "${name}"`, { cwd, timeout: 5000 });
        return { ok: true, created: name };
      }
      if (action === 'delete') {
        const flag = force ? '-D' : '-d';
        execSync(`git branch ${flag} "${name}"`, { cwd, timeout: 5000, encoding: 'utf-8' });
        return { ok: true, deleted: name };
      }
      if (action === 'rename') {
        execSync(`git branch -m "${name}" "${newName}"`, { cwd, timeout: 5000 });
        return { ok: true, renamed: { from: name, to: newName } };
      }
      return { error: `Unknown action: ${action}`, code: 'INVALID_ACTION' };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.checkout'] = {
  name: 'git.checkout',
  description: 'Switch branches or restore working tree files',
  params: { required: ['target'], optional: ['cwd', 'create', 'force', 'files'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { target, cwd = '.', create = false, force = false, files } = params;
    const { execSync } = await import('child_process');
    try {
      if (files?.length) {
        execSync(`git checkout "${target}" -- ${files.map(f => `"${f}"`).join(' ')}`, { cwd, timeout: 10000, encoding: 'utf-8' });
        return { ok: true, restored: files, from: target };
      }
      let cmd = create ? `git checkout -b "${target}"` : `git checkout "${target}"`;
      if (force) cmd += ' -f';
      const output = execSync(cmd, { cwd, timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, branch: target, output: (output || '').trim() };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR', output: (err.stderr || '') }; }
  },
};

tools['git.merge'] = {
  name: 'git.merge',
  description: 'Merge a branch into the current branch',
  params: { required: ['branch'], optional: ['cwd', 'noFf', 'squash', 'message', 'abort'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'write' },
  async execute(params) {
    const { branch, cwd = '.', noFf = false, squash = false, message, abort = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (abort) {
        execSync('git merge --abort', { cwd, timeout: 5000 });
        return { ok: true, aborted: true };
      }
      let cmd = `git merge "${branch}"`;
      if (noFf) cmd += ' --no-ff';
      if (squash) cmd += ' --squash';
      if (message) cmd += ` -m "${message.replace(/"/g, '\\"')}"`;
      const output = execSync(cmd, { cwd, timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, merged: branch, output: output.trim() };
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      if (out.includes('CONFLICT')) {
        const conflicts = out.match(/CONFLICT.*$/gm) || [];
        return { error: 'Merge conflict', code: 'GIT_CONFLICT', conflicts, hint: 'Use git.merge({abort:true}) to abort or resolve manually' };
      }
      return { error: err.message, code: 'GIT_ERROR' };
    }
  },
};

tools['git.stash'] = {
  name: 'git.stash',
  description: 'Stash working directory changes (push, pop, list, drop, apply)',
  params: { required: ['action'], optional: ['cwd', 'message', 'index', 'includeUntracked'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { action, cwd = '.', message, index = 0, includeUntracked = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (action === 'push' || action === 'save') {
        let cmd = 'git stash push';
        if (message) cmd += ` -m "${message.replace(/"/g, '\\"')}"`;
        if (includeUntracked) cmd += ' -u';
        const output = execSync(cmd, { cwd, timeout: 10000, encoding: 'utf-8' });
        return { ok: true, output: output.trim() };
      }
      if (action === 'pop') {
        const output = execSync(`git stash pop stash@{${index}}`, { cwd, timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { ok: true, output: output.trim() };
      }
      if (action === 'apply') {
        const output = execSync(`git stash apply stash@{${index}}`, { cwd, timeout: 10000, encoding: 'utf-8' });
        return { ok: true, output: output.trim() };
      }
      if (action === 'drop') {
        execSync(`git stash drop stash@{${index}}`, { cwd, timeout: 5000 });
        return { ok: true, dropped: index };
      }
      if (action === 'list') {
        const out = execSync('git stash list', { cwd, timeout: 5000, encoding: 'utf-8' });
        const stashes = out.trim().split('\n').filter(Boolean).map((l, i) => ({ index: i, description: l }));
        return { stashes, count: stashes.length };
      }
      if (action === 'clear') {
        execSync('git stash clear', { cwd, timeout: 5000 });
        return { ok: true, cleared: true };
      }
      return { error: `Unknown action: ${action}`, code: 'INVALID_ACTION' };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.tag'] = {
  name: 'git.tag',
  description: 'Create, list, or delete tags',
  params: { required: ['action'], optional: ['cwd', 'name', 'message', 'commit', 'force'] },
  permissions: ['fs.read'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { action, cwd = '.', name, message, commit, force = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (action === 'list') {
        const out = execSync('git tag -l --sort=-v:refname', { cwd, timeout: 5000, encoding: 'utf-8' });
        return { tags: out.trim().split('\n').filter(Boolean) };
      }
      if (action === 'create') {
        let cmd = message ? `git tag -a "${name}" -m "${message.replace(/"/g, '\\"')}"` : `git tag "${name}"`;
        if (commit) cmd += ` ${commit}`;
        if (force) cmd += ' -f';
        execSync(cmd, { cwd, timeout: 5000 });
        return { ok: true, created: name };
      }
      if (action === 'delete') {
        execSync(`git tag -d "${name}"`, { cwd, timeout: 5000 });
        return { ok: true, deleted: name };
      }
      return { error: `Unknown action: ${action}`, code: 'INVALID_ACTION' };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.log'] = {
  name: 'git.log',
  description: 'Show detailed commit log with filters',
  params: { required: [], optional: ['cwd', 'count', 'branch', 'author', 'since', 'until', 'path', 'grep', 'format', 'stat'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { cwd = '.', count = 10, branch, author, since, until, path, grep, format, stat = false } = params;
    const { execSync } = await import('child_process');
    try {
      const fmt = format || '%H|%h|%an|%ae|%ai|%s';
      let cmd = `git log --format="${fmt}" -${Math.min(count, 100)}`;
      if (branch) cmd += ` ${branch}`;
      if (author) cmd += ` --author="${author}"`;
      if (since) cmd += ` --since="${since}"`;
      if (until) cmd += ` --until="${until}"`;
      if (grep) cmd += ` --grep="${grep}"`;
      if (stat) cmd += ' --stat';
      if (path) cmd += ` -- "${path}"`;
      const out = execSync(cmd, { cwd, timeout: 10000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      if (stat || format) return { output: out.trim(), count: out.trim().split('\n').filter(Boolean).length };
      const commits = out.trim().split('\n').filter(Boolean).map(l => {
        const [hash, short, author, email, date, ...msg] = l.split('|');
        return { hash, short, author, email, date, message: msg.join('|') };
      });
      return { commits, count: commits.length };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.remote'] = {
  name: 'git.remote',
  description: 'Manage remote repositories (list, add, remove, set-url)',
  params: { required: ['action'], optional: ['cwd', 'name', 'url'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { action, cwd = '.', name, url } = params;
    const { execSync } = await import('child_process');
    try {
      if (action === 'list') {
        const out = execSync('git remote -v', { cwd, timeout: 5000, encoding: 'utf-8' });
        const remotes = {};
        out.trim().split('\n').filter(Boolean).forEach(l => {
          const [n, u, type] = l.split(/\s+/);
          if (!remotes[n]) remotes[n] = {};
          remotes[n][type.replace(/[()]/g, '')] = u;
        });
        return { remotes };
      }
      if (action === 'add') {
        execSync(`git remote add "${name}" "${url}"`, { cwd, timeout: 5000 });
        return { ok: true, added: name, url };
      }
      if (action === 'remove') {
        execSync(`git remote remove "${name}"`, { cwd, timeout: 5000 });
        return { ok: true, removed: name };
      }
      if (action === 'set-url') {
        execSync(`git remote set-url "${name}" "${url}"`, { cwd, timeout: 5000 });
        return { ok: true, name, url };
      }
      return { error: `Unknown action: ${action}`, code: 'INVALID_ACTION' };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.reset'] = {
  name: 'git.reset',
  description: 'Reset HEAD to a commit (soft, mixed, or hard)',
  params: { required: [], optional: ['cwd', 'commit', 'mode', 'files'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: true, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { cwd = '.', commit = 'HEAD', mode = 'mixed', files } = params;
    const { execSync } = await import('child_process');
    try {
      if (files?.length) {
        execSync(`git reset -- ${files.map(f => `"${f}"`).join(' ')}`, { cwd, timeout: 10000 });
        return { ok: true, unstaged: files };
      }
      const validModes = ['soft', 'mixed', 'hard'];
      if (!validModes.includes(mode)) return { error: `Invalid mode: ${mode}. Use: ${validModes.join(', ')}`, code: 'INVALID_INPUT' };
      const output = execSync(`git reset --${mode} ${commit}`, { cwd, timeout: 10000, encoding: 'utf-8' });
      return { ok: true, mode, commit, output: output.trim() };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.cherry-pick'] = {
  name: 'git.cherry-pick',
  description: 'Apply specific commits from another branch',
  params: { required: ['commits'], optional: ['cwd', 'noCommit', 'abort'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'write' },
  async execute(params) {
    const { commits, cwd = '.', noCommit = false, abort = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (abort) { execSync('git cherry-pick --abort', { cwd, timeout: 5000 }); return { ok: true, aborted: true }; }
      const commitList = Array.isArray(commits) ? commits.join(' ') : commits;
      let cmd = `git cherry-pick ${commitList}`;
      if (noCommit) cmd += ' --no-commit';
      const output = execSync(cmd, { cwd, timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, output: output.trim() };
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      if (out.includes('CONFLICT')) return { error: 'Cherry-pick conflict', code: 'GIT_CONFLICT', output: out };
      return { error: err.message, code: 'GIT_ERROR' };
    }
  },
};

tools['git.rebase'] = {
  name: 'git.rebase',
  description: 'Rebase current branch onto another',
  params: { required: [], optional: ['cwd', 'onto', 'abort', 'continue_'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: true, requiresConfirmation: true, costLevel: 'high', category: 'write' },
  async execute(params) {
    const { cwd = '.', onto, abort = false, continue_ = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (abort) { execSync('git rebase --abort', { cwd, timeout: 5000 }); return { ok: true, aborted: true }; }
      if (continue_) { execSync('git rebase --continue', { cwd, timeout: 30000, encoding: 'utf-8' }); return { ok: true, continued: true }; }
      if (!onto) return { error: 'onto is required for rebase', code: 'INVALID_INPUT' };
      const output = execSync(`git rebase ${onto}`, { cwd, timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, onto, output: output.trim() };
    } catch (err) {
      const out = (err.stdout || '') + (err.stderr || '');
      if (out.includes('CONFLICT')) return { error: 'Rebase conflict', code: 'GIT_CONFLICT', output: out, hint: 'Resolve conflicts, then git.rebase({continue_:true}) or git.rebase({abort:true})' };
      return { error: err.message, code: 'GIT_ERROR' };
    }
  },
};

tools['git.init'] = {
  name: 'git.init',
  description: 'Initialize a new git repository',
  params: { required: [], optional: ['cwd', 'bare', 'defaultBranch'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { cwd = '.', bare = false, defaultBranch = 'main' } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `git init -b ${defaultBranch}`;
      if (bare) cmd += ' --bare';
      execSync(cmd, { cwd, timeout: 5000 });
      return { ok: true, path: cwd, bare, branch: defaultBranch };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

tools['git.blame'] = {
  name: 'git.blame',
  description: 'Show line-by-line authorship of a file',
  params: { required: ['file'], optional: ['cwd', 'startLine', 'endLine'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { file, cwd = '.', startLine, endLine } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `git blame --porcelain "${file}"`;
      if (startLine && endLine) cmd = `git blame --porcelain -L ${startLine},${endLine} "${file}"`;
      const out = execSync(cmd, { cwd, timeout: 15000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      const lines = [];
      const chunks = out.split(/^([0-9a-f]{40})/gm).filter(Boolean);
      for (let i = 0; i < chunks.length; i += 2) {
        const hash = chunks[i];
        const block = chunks[i + 1] || '';
        const authorMatch = block.match(/^author (.+)$/m);
        const timeMatch = block.match(/^author-time (\d+)$/m);
        const lineMatch = block.match(/^\t(.*)$/m);
        if (authorMatch && lineMatch) {
          lines.push({ hash: hash.substring(0, 8), author: authorMatch[1], line: lineMatch[1] });
        }
      }
      return { file, lines: lines.slice(0, 500), count: lines.length };
    } catch (err) { return { error: err.message, code: 'GIT_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// FILESYSTEM — Extended Operations
// ════════════════════════════════════════════════════════════════════════════

tools['fs.mkdir'] = {
  name: 'fs.mkdir',
  description: 'Create a directory (with parents)',
  params: { required: ['path'], optional: ['recursive'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { path, recursive = true } = params;
    const fsP = await import('fs/promises');
    try { await fsP.mkdir(path, { recursive }); return { ok: true, path }; }
    catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.exists'] = {
  name: 'fs.exists',
  description: 'Check if a file or directory exists',
  params: { required: ['path'], optional: [] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const fsP = await import('fs/promises');
    try { const s = await fsP.stat(params.path); return { exists: true, isFile: s.isFile(), isDir: s.isDirectory(), size: s.size }; }
    catch { return { exists: false }; }
  },
};

tools['fs.head'] = {
  name: 'fs.head',
  description: 'Read the first N lines of a file',
  params: { required: ['path'], optional: ['lines'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path, lines = 20 } = params;
    const fsP = await import('fs/promises');
    try {
      const content = await fsP.readFile(path, 'utf-8');
      const allLines = content.split('\n');
      const result = allLines.slice(0, Math.min(lines, 500));
      return { lines: result, count: result.length, totalLines: allLines.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.tail'] = {
  name: 'fs.tail',
  description: 'Read the last N lines of a file',
  params: { required: ['path'], optional: ['lines'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path, lines = 20 } = params;
    const fsP = await import('fs/promises');
    try {
      const content = await fsP.readFile(path, 'utf-8');
      const allLines = content.split('\n');
      const result = allLines.slice(-Math.min(lines, 500));
      return { lines: result, count: result.length, totalLines: allLines.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.append'] = {
  name: 'fs.append',
  description: 'Append content to a file',
  params: { required: ['path', 'content'], optional: ['newline'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { path, content, newline = true } = params;
    const fsP = await import('fs/promises');
    try {
      await fsP.appendFile(path, newline ? content + '\n' : content);
      const stat = await fsP.stat(path);
      return { ok: true, path, size: stat.size };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.chmod'] = {
  name: 'fs.chmod',
  description: 'Change file permissions',
  params: { required: ['path', 'mode'], optional: [] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { path, mode } = params;
    const fsP = await import('fs/promises');
    try {
      const numMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
      await fsP.chmod(path, numMode);
      return { ok: true, path, mode: numMode.toString(8) };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.symlink'] = {
  name: 'fs.symlink',
  description: 'Create a symbolic link',
  params: { required: ['target', 'linkPath'], optional: ['type'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { target, linkPath, type = 'file' } = params;
    const fsP = await import('fs/promises');
    try { await fsP.symlink(target, linkPath, type); return { ok: true, target, link: linkPath }; }
    catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.readJson'] = {
  name: 'fs.readJson',
  description: 'Read and parse a JSON file',
  params: { required: ['path'], optional: [] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const fsP = await import('fs/promises');
    try {
      const raw = await fsP.readFile(params.path, 'utf-8');
      return { data: JSON.parse(raw), path: params.path, size: raw.length };
    } catch (err) { return { error: err.message, code: err.message.includes('JSON') ? 'PARSE_ERROR' : 'FS_ERROR' }; }
  },
};

tools['fs.writeJson'] = {
  name: 'fs.writeJson',
  description: 'Write data as formatted JSON file',
  params: { required: ['path', 'data'], optional: ['indent'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { path, data, indent = 2 } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      await fsP.mkdir(pathM.dirname(path), { recursive: true });
      const content = JSON.stringify(data, null, indent) + '\n';
      await fsP.writeFile(path, content);
      return { ok: true, path, size: content.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.patch'] = {
  name: 'fs.patch',
  description: 'Apply line-based edits to a file (search & replace blocks)',
  params: { required: ['path', 'edits'], optional: [] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { path, edits } = params;
    const fsP = await import('fs/promises');
    try {
      let content = await fsP.readFile(path, 'utf-8');
      let applied = 0;
      for (const edit of edits) {
        if (edit.search && content.includes(edit.search)) {
          content = content.replace(edit.search, edit.replace || '');
          applied++;
        } else if (edit.line && edit.replace !== undefined) {
          const lines = content.split('\n');
          if (edit.line > 0 && edit.line <= lines.length) {
            lines[edit.line - 1] = edit.replace;
            content = lines.join('\n');
            applied++;
          }
        } else if (edit.insertAfter !== undefined) {
          const idx = content.indexOf(edit.insertAfter);
          if (idx !== -1) {
            const end = idx + edit.insertAfter.length;
            content = content.slice(0, end) + '\n' + edit.content + content.slice(end);
            applied++;
          }
        }
      }
      await fsP.writeFile(path, content);
      return { ok: true, path, editsApplied: applied, totalEdits: edits.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

tools['fs.find'] = {
  name: 'fs.find',
  description: 'Search files by name pattern and/or content (grep-like)',
  params: { required: [], optional: ['dir', 'name', 'content', 'ext', 'maxResults', 'maxDepth'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { dir = '.', name, content, ext, maxResults = 50, maxDepth = 10 } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const results = [];
      const skip = new Set(['node_modules', '.git', '.c3', 'dist', 'build', '.next', '__pycache__']);
      async function walk(d, depth) {
        if (depth > maxDepth || results.length >= maxResults) return;
        let entries;
        try { entries = await fsP.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (skip.has(e.name)) continue;
          const full = pathM.join(d, e.name);
          const rel = pathM.relative(dir, full);
          if (e.isDirectory()) { await walk(full, depth + 1); continue; }
          if (name && !e.name.includes(name)) continue;
          if (ext && !e.name.endsWith('.' + ext)) continue;
          if (content) {
            try {
              const stat = await fsP.stat(full);
              if (stat.size > 1024 * 1024) continue;
              const text = await fsP.readFile(full, 'utf-8');
              const re = new RegExp(content, 'gim');
              const matches = [];
              let m;
              while ((m = re.exec(text)) !== null && matches.length < 5) {
                const lineNum = text.substring(0, m.index).split('\n').length;
                matches.push({ line: lineNum, text: text.split('\n')[lineNum - 1]?.trim().substring(0, 200) });
              }
              if (matches.length) results.push({ path: rel, matches });
            } catch { continue; }
          } else {
            results.push({ path: rel });
          }
          if (results.length >= maxResults) return;
        }
      }
      await walk(pathM.resolve(dir), 0);
      return { results, count: results.length };
    } catch (err) { return { error: err.message, code: 'FS_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// NPM / Package Management
// ════════════════════════════════════════════════════════════════════════════

tools['npm.install'] = {
  name: 'npm.install',
  description: 'Install npm packages (with --ignore-scripts for safety)',
  params: { required: [], optional: ['packages', 'cwd', 'dev', 'global', 'exact'] },
  permissions: ['shell.exec', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { packages, cwd = '.', dev = false, global: isGlobal = false, exact = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = 'npm install --ignore-scripts';
      if (packages?.length) cmd += ' ' + (Array.isArray(packages) ? packages.join(' ') : packages);
      if (dev) cmd += ' --save-dev';
      if (isGlobal) cmd += ' -g';
      if (exact) cmd += ' --save-exact';
      const output = execSync(cmd, { cwd, timeout: 120000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, output: output.substring(0, 5000) };
    } catch (err) { return { ok: false, error: err.message, output: (err.stdout || '') + (err.stderr || '') }; }
  },
};

tools['npm.run'] = {
  name: 'npm.run',
  description: 'Run an npm script from package.json',
  params: { required: ['script'], optional: ['cwd', 'args', 'timeout'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'exec' },
  async execute(params) {
    const { script, cwd = '.', args = '', timeout = 60000 } = params;
    const { execSync } = await import('child_process');
    try {
      const cmd = args ? `npm run ${script} -- ${args}` : `npm run ${script}`;
      const output = execSync(cmd, { cwd, timeout: Math.min(timeout, 300000), encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, script, output: output.substring(0, 50000) };
    } catch (err) {
      return { ok: false, script, exitCode: err.status || 1, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 50000) };
    }
  },
};

tools['npm.list'] = {
  name: 'npm.list',
  description: 'List installed npm packages',
  params: { required: [], optional: ['cwd', 'depth', 'global', 'json'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { cwd = '.', depth = 0, global: isGlobal = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `npm list --depth=${depth} --json`;
      if (isGlobal) cmd += ' -g';
      const output = execSync(cmd, { cwd, timeout: 15000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      const data = JSON.parse(output);
      const deps = data.dependencies || {};
      return { packages: Object.entries(deps).map(([name, info]) => ({ name, version: info.version || '?' })), count: Object.keys(deps).length };
    } catch (err) {
      // npm list exits 1 with missing/extraneous deps — still parse output
      try { const data = JSON.parse(err.stdout || '{}'); return { packages: Object.entries(data.dependencies || {}).map(([n, i]) => ({ name: n, version: i.version || '?' })), count: Object.keys(data.dependencies || {}).length, problems: data.problems }; }
      catch { return { error: err.message, code: 'NPM_ERROR' }; }
    }
  },
};

tools['npm.outdated'] = {
  name: 'npm.outdated',
  description: 'Check for outdated npm packages',
  params: { required: [], optional: ['cwd'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { cwd = '.' } = params;
    const { execSync } = await import('child_process');
    try {
      const output = execSync('npm outdated --json', { cwd, timeout: 30000, encoding: 'utf-8' });
      const data = JSON.parse(output || '{}');
      const packages = Object.entries(data).map(([name, info]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest, type: info.type }));
      return { packages, count: packages.length, upToDate: packages.length === 0 };
    } catch (err) {
      // npm outdated exits 1 if packages are outdated
      try { const data = JSON.parse(err.stdout || '{}'); return { packages: Object.entries(data).map(([n, i]) => ({ name: n, current: i.current, wanted: i.wanted, latest: i.latest })), count: Object.keys(data).length }; }
      catch { return { error: err.message, code: 'NPM_ERROR' }; }
    }
  },
};

tools['npm.audit'] = {
  name: 'npm.audit',
  description: 'Run npm security audit',
  params: { required: [], optional: ['cwd', 'fix', 'production'] },
  permissions: ['fs.read', 'fs.write', 'process.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'exec' },
  async execute(params) {
    const { cwd = '.', fix = false, production = false } = params;
    const result = runNpmAuditReport({ cwd, fix, production });
    if (!result.ok) return npmAuditError(result, 'NPM_ERROR');
    return npmAuditOverview(result);
  },
};

tools['npm.init'] = {
  name: 'npm.init',
  description: 'Initialize a new package.json',
  params: { required: [], optional: ['cwd', 'name', 'version', 'description', 'main', 'type'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'free', category: 'write' },
  async execute(params) {
    const { cwd = '.', name, version = '1.0.0', description = '', main = 'index.js', type = 'module' } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const pkgName = name || pathM.basename(pathM.resolve(cwd));
      const pkg = { name: pkgName, version, description, main, type, scripts: { test: 'echo "Error: no test specified" && exit 1' }, keywords: [], author: '', license: 'ISC' };
      const pkgPath = pathM.join(pathM.resolve(cwd), 'package.json');
      await fsP.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      return { ok: true, path: pkgPath, name: pkgName };
    } catch (err) { return { error: err.message, code: 'NPM_ERROR' }; }
  },
};

tools['npm.scripts'] = {
  name: 'npm.scripts',
  description: 'List available npm scripts from package.json',
  params: { required: [], optional: ['cwd'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { cwd = '.' } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const raw = await fsP.readFile(pathM.join(pathM.resolve(cwd), 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};
      return { scripts, count: Object.keys(scripts).length, name: pkg.name, version: pkg.version };
    } catch (err) { return { error: err.message, code: 'NPM_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// TEXT PROCESSING
// ════════════════════════════════════════════════════════════════════════════

tools['text.search'] = {
  name: 'text.search',
  description: 'Search for text/regex in files (grep-like) across a directory',
  params: { required: ['pattern'], optional: ['dir', 'ext', 'maxResults', 'caseSensitive', 'wholeWord'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { pattern, dir = '.', ext, maxResults = 50, caseSensitive = false, wholeWord = false } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.c3', '__pycache__']);
      let flags = 'gm'; if (!caseSensitive) flags += 'i';
      const searchPat = wholeWord ? `\\b${pattern}\\b` : pattern;
      const re = new RegExp(searchPat, flags);
      const results = [];
      async function walk(d, depth) {
        if (depth > 8 || results.length >= maxResults) return;
        let entries; try { entries = await fsP.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (skip.has(e.name) || e.name.startsWith('.')) continue;
          const full = pathM.join(d, e.name);
          if (e.isDirectory()) { await walk(full, depth + 1); continue; }
          if (ext && !e.name.endsWith('.' + ext)) continue;
          try {
            const stat = await fsP.stat(full);
            if (stat.size > 512 * 1024) continue;
            const text = await fsP.readFile(full, 'utf-8');
            const matches = [];
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(text)) !== null && matches.length < 10) {
              const lineNum = text.substring(0, m.index).split('\n').length;
              matches.push({ line: lineNum, col: m.index - text.lastIndexOf('\n', m.index - 1), text: text.split('\n')[lineNum - 1]?.substring(0, 200) });
            }
            if (matches.length) results.push({ file: pathM.relative(dir, full), matches, matchCount: matches.length });
          } catch { continue; }
          if (results.length >= maxResults) return;
        }
      }
      await walk(pathM.resolve(dir), 0);
      return { results, fileCount: results.length, totalMatches: results.reduce((s, r) => s + r.matchCount, 0) };
    } catch (err) { return { error: err.message, code: 'TEXT_ERROR' }; }
  },
};

tools['text.replace'] = {
  name: 'text.replace',
  description: 'Find and replace text in one or more files',
  params: { required: ['pattern', 'replacement'], optional: ['files', 'dir', 'ext', 'regex', 'dryRun'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { pattern, replacement, files, dir, ext, regex = false, dryRun = false } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      let targetFiles = files ? (Array.isArray(files) ? files : [files]) : [];
      if (!targetFiles.length && dir) {
        const found = await tools['fs.find'].execute({ dir, ext, content: pattern, maxResults: 50 });
        targetFiles = (found.results || []).map(r => pathM.join(dir, r.path));
      }
      const results = [];
      for (const file of targetFiles) {
        try {
          const content = await fsP.readFile(file, 'utf-8');
          const re = regex ? new RegExp(pattern, 'g') : undefined;
          const newContent = re ? content.replace(re, replacement) : content.split(pattern).join(replacement);
          const changes = re ? (content.match(re) || []).length : content.split(pattern).length - 1;
          if (changes > 0) {
            if (!dryRun) await fsP.writeFile(file, newContent);
            results.push({ file, changes });
          }
        } catch { continue; }
      }
      return { ok: true, dryRun, filesChanged: results.length, results, totalChanges: results.reduce((s, r) => s + r.changes, 0) };
    } catch (err) { return { error: err.message, code: 'TEXT_ERROR' }; }
  },
};

tools['text.count'] = {
  name: 'text.count',
  description: 'Count lines, words, characters, or pattern occurrences',
  params: { required: ['input'], optional: ['inputType', 'pattern'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { input, inputType = 'file', pattern } = params;
    const fsP = await import('fs/promises');
    try {
      const text = inputType === 'file' ? await fsP.readFile(input, 'utf-8') : input;
      const result = { lines: text.split('\n').length, words: text.split(/\s+/).filter(Boolean).length, chars: text.length, bytes: Buffer.byteLength(text) };
      if (pattern) {
        const re = new RegExp(pattern, 'gm');
        const matches = text.match(re);
        result.patternMatches = matches ? matches.length : 0;
      }
      return result;
    } catch (err) { return { error: err.message, code: 'TEXT_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM / PROCESS
// ════════════════════════════════════════════════════════════════════════════

tools['system.info'] = {
  name: 'system.info',
  description: 'Get system information (OS, CPU, memory, uptime)',
  params: { required: [], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute() {
    const os = await import('os');
    return {
      platform: os.platform(), arch: os.arch(), release: os.release(),
      hostname: os.hostname(), uptime: os.uptime(),
      cpus: { model: os.cpus()[0]?.model, count: os.cpus().length, speed: os.cpus()[0]?.speed },
      memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), usedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100) },
      nodeVersion: process.version,
      cwd: process.cwd(),
    };
  },
};

tools['system.disk'] = {
  name: 'system.disk',
  description: 'Show disk usage for a path',
  params: { required: [], optional: ['path'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path = '.' } = params;
    const { execSync } = await import('child_process');
    try {
      const df = execSync(`df -h "${path}"`, { timeout: 5000, encoding: 'utf-8' });
      const lines = df.trim().split('\n');
      if (lines.length < 2) return { error: 'No data', code: 'SYSTEM_ERROR' };
      const parts = lines[1].split(/\s+/);
      return { filesystem: parts[0], size: parts[1], used: parts[2], available: parts[3], usePercent: parts[4], mountedOn: parts[5] };
    } catch (err) { return { error: err.message, code: 'SYSTEM_ERROR' }; }
  },
};

tools['process.list'] = {
  name: 'process.list',
  description: 'List running processes (optionally filter by name)',
  params: { required: [], optional: ['filter', 'limit'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { filter, limit = 50 } = params;
    const { execSync } = await import('child_process');
    try {
      const cmd = filter ? `ps aux | head -1 && ps aux | grep -i "${filter}" | grep -v grep` : `ps aux --sort=-%mem | head -${limit + 1}`;
      const output = execSync(cmd, { timeout: 5000, encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      const header = lines[0];
      const processes = lines.slice(1).map(l => {
        const parts = l.split(/\s+/);
        return { user: parts[0], pid: parseInt(parts[1]), cpu: parseFloat(parts[2]), mem: parseFloat(parts[3]), command: parts.slice(10).join(' ').substring(0, 200) };
      });
      return { processes: processes.slice(0, limit), count: processes.length };
    } catch (err) { return { error: err.message, code: 'SYSTEM_ERROR' }; }
  },
};

tools['process.kill'] = {
  name: 'process.kill',
  description: 'Kill a process by PID',
  params: { required: ['pid'], optional: ['signal'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: true, destructive: true, requiresConfirmation: true, costLevel: 'free', category: 'exec' },
  async execute(params) {
    const { pid, signal = 'SIGTERM' } = params;
    try {
      process.kill(parseInt(pid), signal);
      return { ok: true, pid, signal };
    } catch (err) { return { error: err.message, code: 'SYSTEM_ERROR' }; }
  },
};

tools['system.which'] = {
  name: 'system.which',
  description: 'Check if a command/tool is available on the system',
  params: { required: ['command'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { execSync } = await import('child_process');
    try {
      const path = execSync(`which ${params.command}`, { timeout: 3000, encoding: 'utf-8' }).trim();
      let version = null;
      try { version = execSync(`${params.command} --version`, { timeout: 3000, encoding: 'utf-8' }).trim().split('\n')[0]; } catch {}
      return { available: true, path, version };
    } catch { return { available: false, command: params.command, suggestion: `Install with: apt install ${params.command} / brew install ${params.command}` }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// NETWORK
// ════════════════════════════════════════════════════════════════════════════

tools['net.ping'] = {
  name: 'net.ping',
  description: 'Ping a host to check connectivity',
  params: { required: ['host'], optional: ['count', 'timeout'] },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'net' },
  async execute(params) {
    const { host, count = 3, timeout = 5 } = params;
    const { execSync } = await import('child_process');
    try {
      const output = execSync(`ping -c ${Math.min(count, 10)} -W ${timeout} "${host}"`, { timeout: (timeout + 2) * count * 1000, encoding: 'utf-8' });
      const stats = output.match(/(\d+) packets transmitted, (\d+) received/);
      const rtt = output.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
      return {
        host, reachable: true,
        transmitted: stats ? parseInt(stats[1]) : count,
        received: stats ? parseInt(stats[2]) : 0,
        loss: stats ? `${Math.round((1 - parseInt(stats[2]) / parseInt(stats[1])) * 100)}%` : '?',
        rtt: rtt ? { min: parseFloat(rtt[1]), avg: parseFloat(rtt[2]), max: parseFloat(rtt[3]) } : null,
      };
    } catch (err) {
      return { host, reachable: false, error: err.message };
    }
  },
};

tools['net.ports'] = {
  name: 'net.ports',
  description: 'Check if ports are open on a host (or list listening ports)',
  params: { required: [], optional: ['host', 'ports', 'listening'] },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'net' },
  async execute(params) {
    const { host, ports, listening = false } = params;
    const { execSync } = await import('child_process');
    try {
      if (listening) {
        const output = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', { timeout: 5000, encoding: 'utf-8' });
        const lines = output.trim().split('\n').slice(1);
        const portList = lines.map(l => {
          const parts = l.split(/\s+/);
          const addr = parts[3] || parts[2] || '';
          const portMatch = addr.match(/:(\d+)$/);
          return { address: addr, port: portMatch ? parseInt(portMatch[1]) : null, process: parts[parts.length - 1] || '' };
        }).filter(p => p.port);
        return { ports: portList, count: portList.length };
      }
      if (!host || !ports?.length) return { error: 'host and ports required (or use listening:true)', code: 'INVALID_INPUT' };
      const net = await import('net');
      const results = await Promise.all(ports.map(port => new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(2000);
        sock.on('connect', () => { sock.destroy(); resolve({ port, open: true }); });
        sock.on('error', () => { sock.destroy(); resolve({ port, open: false }); });
        sock.on('timeout', () => { sock.destroy(); resolve({ port, open: false }); });
        sock.connect(port, host);
      })));
      return { host, results };
    } catch (err) { return { error: err.message, code: 'NET_ERROR' }; }
  },
};

tools['net.dns'] = {
  name: 'net.dns',
  description: 'DNS lookup for a hostname',
  params: { required: ['hostname'], optional: ['type'] },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'net' },
  async execute(params) {
    const { hostname, type } = params;
    const dns = await import('dns');
    const { promisify } = await import('util');
    try {
      if (type) {
        const resolve = promisify(dns.resolve);
        const records = await resolve(hostname, type);
        return { hostname, type, records };
      }
      const lookup = promisify(dns.lookup);
      const result = await lookup(hostname, { all: true });
      return { hostname, addresses: result };
    } catch (err) { return { error: err.message, code: 'DNS_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// DOCKER — Full Suite
// ════════════════════════════════════════════════════════════════════════════

tools['docker.build'] = {
  name: 'docker.build',
  description: 'Build a Docker image from Dockerfile',
  params: { required: ['tag'], optional: ['context', 'dockerfile', 'buildArgs', 'noCache'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { tag, context = '.', dockerfile, buildArgs = {}, noCache = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `docker build -t "${tag}" ${context}`;
      if (dockerfile) cmd += ` -f "${dockerfile}"`;
      if (noCache) cmd += ' --no-cache';
      Object.entries(buildArgs).forEach(([k, v]) => { cmd += ` --build-arg ${k}="${v}"`; });
      const output = execSync(cmd, { timeout: 300000, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
      return { ok: true, tag, output: output.substring(output.length - 2000) };
    } catch (err) { return { ok: false, error: err.message, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 5000) }; }
  },
};

tools['docker.ps'] = {
  name: 'docker.ps',
  description: 'List running Docker containers',
  params: { required: [], optional: ['all', 'filter'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { all = false, filter } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `docker ps --format '{{json .}}'`;
      if (all) cmd += ' -a';
      if (filter) cmd += ` --filter "${filter}"`;
      const output = execSync(cmd, { timeout: 10000, encoding: 'utf-8' });
      const containers = output.trim().split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return { raw: l }; }
      });
      return { containers, count: containers.length };
    } catch (err) { return { error: err.message, code: 'DOCKER_ERROR' }; }
  },
};

tools['docker.images'] = {
  name: 'docker.images',
  description: 'List Docker images',
  params: { required: [], optional: ['filter'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { filter } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `docker images --format '{{json .}}'`;
      if (filter) cmd += ` "${filter}"`;
      const output = execSync(cmd, { timeout: 10000, encoding: 'utf-8' });
      const images = output.trim().split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return { raw: l }; }
      });
      return { images, count: images.length };
    } catch (err) { return { error: err.message, code: 'DOCKER_ERROR' }; }
  },
};

tools['docker.logs'] = {
  name: 'docker.logs',
  description: 'Show logs from a Docker container',
  params: { required: ['container'], optional: ['tail', 'since', 'follow'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { container, tail = 100, since } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = `docker logs --tail ${tail} "${container}"`;
      if (since) cmd += ` --since "${since}"`;
      const output = execSync(cmd, { timeout: 10000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { container, output: output.substring(0, 50000), lines: output.split('\n').length };
    } catch (err) { return { error: err.message, code: 'DOCKER_ERROR' }; }
  },
};

tools['docker.compose'] = {
  name: 'docker.compose',
  description: 'Run docker compose commands (up, down, ps, logs, build, restart)',
  params: { required: ['action'], optional: ['cwd', 'services', 'file', 'detach', 'build'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { action, cwd = '.', services = [], file, detach = true, build: doBuild = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = 'docker compose';
      if (file) cmd += ` -f "${file}"`;
      cmd += ` ${action}`;
      if (action === 'up') {
        if (detach) cmd += ' -d';
        if (doBuild) cmd += ' --build';
      }
      if (services.length) cmd += ' ' + services.join(' ');
      const timeout = ['up', 'build'].includes(action) ? 300000 : 30000;
      const output = execSync(cmd, { cwd, timeout, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, action, output: ((output || '') + '').substring(0, 10000) };
    } catch (err) { return { ok: false, action, error: err.message, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 5000) }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// SELF-CAPABILITY: Auto-detect, suggest, install missing tools/packages
// ════════════════════════════════════════════════════════════════════════════

const _TOOL_INSTALL_MAP = {
  convert: { name: 'ImageMagick', apt: 'imagemagick', brew: 'imagemagick', npm: null },
  ffmpeg: { name: 'FFmpeg', apt: 'ffmpeg', brew: 'ffmpeg', npm: null },
  docker: { name: 'Docker', apt: 'docker.io', brew: 'docker', npm: null },
  python3: { name: 'Python 3', apt: 'python3', brew: 'python3', npm: null },
  pip3: { name: 'pip3', apt: 'python3-pip', brew: 'python3', npm: null },
  gcc: { name: 'GCC', apt: 'gcc', brew: 'gcc', npm: null },
  make: { name: 'Make', apt: 'make', brew: 'make', npm: null },
  cmake: { name: 'CMake', apt: 'cmake', brew: 'cmake', npm: null },
  jq: { name: 'jq', apt: 'jq', brew: 'jq', npm: null },
  curl: { name: 'curl', apt: 'curl', brew: 'curl', npm: null },
  wget: { name: 'wget', apt: 'wget', brew: 'wget', npm: null },
  zip: { name: 'zip', apt: 'zip', brew: 'zip', npm: null },
  unzip: { name: 'unzip', apt: 'unzip', brew: 'unzip', npm: null },
  sqlite3: { name: 'SQLite3 CLI', apt: 'sqlite3', brew: 'sqlite', npm: null },
  rsync: { name: 'rsync', apt: 'rsync', brew: 'rsync', npm: null },
  htop: { name: 'htop', apt: 'htop', brew: 'htop', npm: null },
  tree: { name: 'tree', apt: 'tree', brew: 'tree', npm: null },
  typescript: { name: 'TypeScript', apt: null, brew: null, npm: 'typescript' },
  eslint: { name: 'ESLint', apt: null, brew: null, npm: 'eslint' },
  prettier: { name: 'Prettier', apt: null, brew: null, npm: 'prettier' },
  jest: { name: 'Jest', apt: null, brew: null, npm: 'jest' },
  vitest: { name: 'Vitest', apt: null, brew: null, npm: 'vitest' },
  nodemon: { name: 'Nodemon', apt: null, brew: null, npm: 'nodemon' },
  pm2: { name: 'PM2', apt: null, brew: null, npm: 'pm2' },
};

tools['tools.check'] = {
  name: 'tools.check',
  description: 'Check which external tools/commands are available on this system',
  params: { required: [], optional: ['commands'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { commands } = params;
    const { execSync } = await import('child_process');
    const toCheck = commands || Object.keys(_TOOL_INSTALL_MAP);
    const results = {};
    for (const cmd of toCheck) {
      try {
        const path = execSync(`which ${cmd}`, { timeout: 2000, encoding: 'utf-8' }).trim();
        results[cmd] = { available: true, path };
      } catch {
        results[cmd] = { available: false, install: _TOOL_INSTALL_MAP[cmd] || null };
      }
    }
    const available = Object.entries(results).filter(([, v]) => v.available).map(([k]) => k);
    const missing = Object.entries(results).filter(([, v]) => !v.available).map(([k, v]) => ({ command: k, ...(v.install || {}) }));
    return { results, available, missing, summary: `${available.length} available, ${missing.length} missing` };
  },
};

tools['tools.install'] = {
  name: 'tools.install',
  description: 'Install a missing tool/package (auto-detects package manager)',
  params: { required: ['package'], optional: ['manager', 'global'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { package: pkg, manager, global: isGlobal = true } = params;
    const { execSync } = await import('child_process');
    try {
      // Auto-detect package manager
      let mgr = manager;
      if (!mgr) {
        // Check what's available
        const known = _TOOL_INSTALL_MAP[pkg];
        try { execSync('which apt', { timeout: 2000 }); mgr = 'apt'; } catch {}
        if (!mgr) { try { execSync('which brew', { timeout: 2000 }); mgr = 'brew'; } catch {} }
        if (!mgr) { try { execSync('which dnf', { timeout: 2000 }); mgr = 'dnf'; } catch {} }
        if (!mgr) { try { execSync('which pacman', { timeout: 2000 }); mgr = 'pacman'; } catch {} }
        // If it's an npm package, use npm
        if (known?.npm && !known.apt) mgr = 'npm';
        if (!mgr) mgr = 'npm';
      }
      const pkgName = _TOOL_INSTALL_MAP[pkg]?.[mgr] || pkg;
      let cmd;
      if (mgr === 'npm') cmd = `npm install ${isGlobal ? '-g' : ''} ${pkgName}`;
      else if (mgr === 'apt') cmd = `sudo apt install -y ${pkgName}`;
      else if (mgr === 'brew') cmd = `brew install ${pkgName}`;
      else if (mgr === 'dnf') cmd = `sudo dnf install -y ${pkgName}`;
      else if (mgr === 'pacman') cmd = `sudo pacman -S --noconfirm ${pkgName}`;
      else return { error: `Unknown package manager: ${mgr}`, code: 'UNSUPPORTED' };
      const output = execSync(cmd, { timeout: 120000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, package: pkgName, manager: mgr, output: output.substring(0, 3000) };
    } catch (err) {
      return { ok: false, error: err.message, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 3000) };
    }
  },
};

tools['tools.suggest'] = {
  name: 'tools.suggest',
  description: 'Analyze an error and suggest what tool/package to install',
  params: { required: ['error'], optional: ['context'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { error, context } = params;
    const suggestions = [];
    const errLower = error.toLowerCase();
    // Common "command not found" patterns
    const cmdMatch = error.match(/(?:command not found|not found|ENOENT).*?[: ]([a-z0-9_-]+)/i);
    if (cmdMatch) {
      const cmd = cmdMatch[1];
      if (_TOOL_INSTALL_MAP[cmd]) suggestions.push({ type: 'install', ...{ command: cmd, ..._TOOL_INSTALL_MAP[cmd] } });
      else suggestions.push({ type: 'install', command: cmd, hint: `Try: apt install ${cmd} or brew install ${cmd} or npm install -g ${cmd}` });
    }
    // Module not found
    if (errLower.includes('cannot find module') || errLower.includes('module not found')) {
      const modMatch = error.match(/(?:Cannot find module|Module not found)[: ]*['"]([^'"]+)['"]/);
      if (modMatch) suggestions.push({ type: 'npm_install', package: modMatch[1], command: `npm install ${modMatch[1]}` });
    }
    // Python import error
    if (errLower.includes('modulenotfounderror') || errLower.includes('no module named')) {
      const pyMatch = error.match(/No module named '([^']+)'/i);
      if (pyMatch) suggestions.push({ type: 'pip_install', package: pyMatch[1], command: `pip3 install ${pyMatch[1]}` });
    }
    // Permission denied
    if (errLower.includes('permission denied') || errLower.includes('eacces')) {
      suggestions.push({ type: 'permission', hint: 'Try: chmod +x <file> or run with sudo' });
    }
    // Port in use
    if (errLower.includes('eaddrinuse') || errLower.includes('address already in use')) {
      const portMatch = error.match(/port[: ]*(\d+)/i) || error.match(/:(\d+)/);
      if (portMatch) suggestions.push({ type: 'port_conflict', port: portMatch[1], hint: `Port ${portMatch[1]} is in use. Find process: lsof -i :${portMatch[1]}` });
    }
    // Out of memory
    if (errLower.includes('heap out of memory') || errLower.includes('enomem')) {
      suggestions.push({ type: 'memory', hint: 'Increase Node memory: NODE_OPTIONS="--max-old-space-size=4096"' });
    }
    if (!suggestions.length) suggestions.push({ type: 'unknown', hint: 'No specific fix detected. Try searching the error message.' });
    return { suggestions, errorSnippet: error.substring(0, 300), context };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// YAML
// ════════════════════════════════════════════════════════════════════════════

// Minimal YAML parser — handles common cases (maps, arrays, scalars, nesting).
// Does NOT support anchors/aliases, multi-line block scalars (|, >), or tags.
function _yamlParse(text) {
  const lines = text.split('\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.search(/\S/);
    const line = raw.trim();

    // Pop stack to find parent at correct indent
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (line.startsWith('- ')) {
      const val = line.substring(2).trim();
      if (Array.isArray(parent)) {
        if (val.includes(': ')) {
          const obj = {};
          const [k, ...v] = val.split(': ');
          obj[k.trim()] = _yamlScalar(v.join(': ').trim());
          parent.push(obj);
          stack.push({ obj: obj, indent: indent });
        } else {
          parent.push(_yamlScalar(val));
        }
      } else if (currentKey && parent[currentKey] === null) {
        parent[currentKey] = [_yamlScalar(val)];
        stack.push({ obj: parent[currentKey], indent: indent });
      }
      continue;
    }

    // Key: value
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 1).trim();
      currentKey = key;
      if (val === '' || val === '|' || val === '>') {
        // Nested object or null
        if (Array.isArray(parent)) { const obj = {}; obj[key] = null; parent.push(obj); stack.push({ obj: obj, indent: indent }); }
        else { parent[key] = null; stack.push({ obj: parent, indent: indent }); }
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Inline array
        parent[key] = val.slice(1, -1).split(',').map(s => _yamlScalar(s.trim()));
      } else if (val.startsWith('{') && val.endsWith('}')) {
        // Inline object
        const obj = {};
        val.slice(1, -1).split(',').forEach(pair => {
          const [k, ...v] = pair.split(':');
          if (k) obj[k.trim()] = _yamlScalar(v.join(':').trim());
        });
        parent[key] = obj;
      } else {
        parent[key] = _yamlScalar(val);
      }
    }
  }
  return result;
}

function _yamlScalar(val) {
  if (val === 'true' || val === 'True' || val === 'TRUE') return true;
  if (val === 'false' || val === 'False' || val === 'FALSE') return false;
  if (val === 'null' || val === 'Null' || val === '~' || val === '') return null;
  if (/^-?\d+$/.test(val)) return parseInt(val);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // Strip quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) return val.slice(1, -1);
  return val;
}

function _yamlStringify(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  let out = '';
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        out += `${pad}- ${entries[0][0]}: ${_yamlStringifyValue(entries[0][1])}\n`;
        for (let i = 1; i < entries.length; i++) {
          out += `${pad}  ${entries[i][0]}: ${_yamlStringifyValue(entries[i][1])}\n`;
        }
      } else {
        out += `${pad}- ${_yamlStringifyValue(item)}\n`;
      }
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'object' && val !== null) {
        out += `${pad}${key}:\n${_yamlStringify(val, indent + 1)}`;
      } else {
        out += `${pad}${key}: ${_yamlStringifyValue(val)}\n`;
      }
    }
  }
  return out;
}

function _yamlStringifyValue(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (val.includes(':') || val.includes('#') || val.includes('"') || val.includes("'") || /^\s|\s$/.test(val)) return `"${val.replace(/"/g, '\\"')}"`;
    return val;
  }
  return String(val);
}

tools['yaml.parse'] = {
  name: 'yaml.parse',
  description: 'Parse YAML string to JSON object',
  params: { required: ['input'], optional: ['inputType'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, inputType = 'string' } = params;
    try {
      const text = inputType === 'file' ? await (await import('fs/promises')).readFile(input, 'utf-8') : input;
      return { data: _yamlParse(text) };
    } catch (err) { return { error: err.message, code: 'YAML_ERROR' }; }
  },
};

tools['yaml.stringify'] = {
  name: 'yaml.stringify',
  description: 'Convert JSON object to YAML string',
  params: { required: ['data'], optional: ['outputPath'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { data, outputPath } = params;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      const yaml = _yamlStringify(obj);
      if (outputPath) {
        const fsP = await import('fs/promises');
        const pathM = await import('path');
        await fsP.mkdir(pathM.dirname(outputPath), { recursive: true });
        await fsP.writeFile(outputPath, yaml);
        return { ok: true, output: outputPath, length: yaml.length };
      }
      return { yaml, length: yaml.length };
    } catch (err) { return { error: err.message, code: 'YAML_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// CRYPTO
// ════════════════════════════════════════════════════════════════════════════

tools['crypto.randomBytes'] = {
  name: 'crypto.randomBytes',
  description: 'Generate cryptographically secure random bytes (hex, base64, or raw)',
  params: { required: [], optional: ['length', 'encoding'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { length = 32, encoding = 'hex' } = params;
    const { randomBytes } = await import('crypto');
    const buf = randomBytes(Math.min(length, 1024));
    return { value: buf.toString(encoding), length: buf.length, encoding };
  },
};

tools['crypto.generatePassword'] = {
  name: 'crypto.generatePassword',
  description: 'Generate a secure random password',
  params: { required: [], optional: ['length', 'uppercase', 'lowercase', 'digits', 'symbols'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { length = 20, uppercase = true, lowercase = true, digits = true, symbols = true } = params;
    const { randomBytes } = await import('crypto');
    let chars = '';
    if (lowercase) chars += 'abcdefghijkmnopqrstuvwxyz';
    if (uppercase) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    if (digits) chars += '23456789';
    if (symbols) chars += '!@#$%&*_+-=?';
    if (!chars) chars = 'abcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(Math.min(length, 128));
    let password = '';
    for (let i = 0; i < Math.min(length, 128); i++) password += chars[bytes[i] % chars.length];
    return { password, length: password.length };
  },
};

tools['crypto.encrypt'] = {
  name: 'crypto.encrypt',
  description: 'Encrypt text using AES-256-GCM',
  params: { required: ['text', 'key'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { text, key } = params;
    const crypto = await import('crypto');
    try {
      const keyHash = crypto.createHash('sha256').update(key).digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);
      let encrypted = cipher.update(text, 'utf-8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      return { encrypted, iv: iv.toString('hex'), tag, algorithm: 'aes-256-gcm' };
    } catch (err) { return { error: err.message, code: 'CRYPTO_ERROR' }; }
  },
};

tools['crypto.decrypt'] = {
  name: 'crypto.decrypt',
  description: 'Decrypt AES-256-GCM encrypted text',
  params: { required: ['encrypted', 'key', 'iv', 'tag'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { encrypted, key, iv, tag } = params;
    const crypto = await import('crypto');
    try {
      const keyHash = crypto.createHash('sha256').update(key).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyHash, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      return { text: decrypted };
    } catch (err) { return { error: err.message, code: 'CRYPTO_ERROR' }; }
  },
};

tools['crypto.uuid'] = {
  name: 'crypto.uuid',
  description: 'Generate a UUID v4',
  params: { required: [], optional: ['count'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { count = 1 } = params;
    const { randomUUID } = await import('crypto');
    const uuids = Array.from({ length: Math.min(count, 100) }, () => randomUUID());
    return count === 1 ? { uuid: uuids[0] } : { uuids };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// REGEX
// ════════════════════════════════════════════════════════════════════════════

tools['regex.test'] = {
  name: 'regex.test',
  description: 'Test a regex pattern against text',
  params: { required: ['pattern', 'text'], optional: ['flags'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { pattern, text, flags = '' } = params;
    try {
      const re = new RegExp(pattern, flags);
      const match = re.test(text);
      const firstMatch = text.match(new RegExp(pattern, flags));
      return { match, pattern, flags, firstMatch: firstMatch ? { value: firstMatch[0], index: firstMatch.index, groups: firstMatch.groups || null } : null };
    } catch (err) { return { error: err.message, code: 'REGEX_ERROR' }; }
  },
};

tools['regex.extract'] = {
  name: 'regex.extract',
  description: 'Extract all matches of a regex pattern from text',
  params: { required: ['pattern', 'text'], optional: ['flags', 'limit'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { pattern, text, flags = 'g', limit = 100 } = params;
    try {
      const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
      const matches = [];
      let m;
      while ((m = re.exec(text)) !== null && matches.length < limit) {
        matches.push({ value: m[0], index: m.index, groups: m.groups || null, captures: m.slice(1) });
        if (!flags.includes('g')) break;
      }
      return { matches, count: matches.length };
    } catch (err) { return { error: err.message, code: 'REGEX_ERROR' }; }
  },
};

tools['regex.replace'] = {
  name: 'regex.replace',
  description: 'Replace matches using a regex pattern',
  params: { required: ['pattern', 'text', 'replacement'], optional: ['flags'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { pattern, text, replacement, flags = 'g' } = params;
    try {
      const re = new RegExp(pattern, flags);
      const result = text.replace(re, replacement);
      const changes = (text.match(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')) || []).length;
      return { result, changes, length: result.length };
    } catch (err) { return { error: err.message, code: 'REGEX_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// DATE / TIME
// ════════════════════════════════════════════════════════════════════════════

tools['date.now'] = {
  name: 'date.now',
  description: 'Get current date/time in various formats',
  params: { required: [], optional: ['timezone', 'format'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { timezone, format } = params;
    const now = new Date();
    const result = {
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      unixMs: now.getTime(),
      utc: now.toUTCString(),
      date: now.toISOString().split('T')[0],
      time: now.toISOString().split('T')[1].split('.')[0],
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
    };
    if (timezone) {
      try { result.local = now.toLocaleString('en-US', { timeZone: timezone }); result.timezone = timezone; }
      catch { result.timezoneError = `Invalid timezone: ${timezone}`; }
    }
    return result;
  },
};

tools['date.parse'] = {
  name: 'date.parse',
  description: 'Parse a date string to structured components',
  params: { required: ['input'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input } = params;
    try {
      const d = new Date(input);
      if (isNaN(d.getTime())) return { error: `Cannot parse date: ${input}`, code: 'DATE_ERROR' };
      return {
        iso: d.toISOString(), unix: Math.floor(d.getTime() / 1000),
        year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
        hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
        dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()],
      };
    } catch (err) { return { error: err.message, code: 'DATE_ERROR' }; }
  },
};

tools['date.diff'] = {
  name: 'date.diff',
  description: 'Calculate difference between two dates',
  params: { required: ['from', 'to'], optional: ['unit'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { from, to, unit = 'auto' } = params;
    try {
      const a = new Date(from), b = new Date(to);
      if (isNaN(a.getTime()) || isNaN(b.getTime())) return { error: 'Invalid date(s)', code: 'DATE_ERROR' };
      const diffMs = b.getTime() - a.getTime();
      const result = { milliseconds: diffMs, seconds: diffMs / 1000, minutes: diffMs / 60000, hours: diffMs / 3600000, days: diffMs / 86400000, weeks: diffMs / 604800000 };
      if (unit !== 'auto' && result[unit] !== undefined) return { diff: result[unit], unit, from: a.toISOString(), to: b.toISOString() };
      // Auto — pick most readable unit
      const abs = Math.abs(diffMs);
      let display;
      if (abs < 60000) display = { value: Math.round(result.seconds), unit: 'seconds' };
      else if (abs < 3600000) display = { value: Math.round(result.minutes), unit: 'minutes' };
      else if (abs < 86400000) display = { value: +(result.hours).toFixed(1), unit: 'hours' };
      else if (abs < 604800000) display = { value: +(result.days).toFixed(1), unit: 'days' };
      else display = { value: +(result.weeks).toFixed(1), unit: 'weeks' };
      return { ...result, display, from: a.toISOString(), to: b.toISOString() };
    } catch (err) { return { error: err.message, code: 'DATE_ERROR' }; }
  },
};

tools['date.format'] = {
  name: 'date.format',
  description: 'Format a date with locale and timezone support',
  params: { required: ['input'], optional: ['locale', 'timezone', 'options'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, locale = 'en-US', timezone, options = {} } = params;
    try {
      const d = input === 'now' ? new Date() : new Date(input);
      if (isNaN(d.getTime())) return { error: `Cannot parse: ${input}`, code: 'DATE_ERROR' };
      const opts = { ...options };
      if (timezone) opts.timeZone = timezone;
      return { formatted: d.toLocaleString(locale, opts), iso: d.toISOString() };
    } catch (err) { return { error: err.message, code: 'DATE_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// MATH
// ════════════════════════════════════════════════════════════════════════════

tools['math.eval'] = {
  name: 'math.eval',
  description: 'Safely evaluate a mathematical expression',
  params: { required: ['expression'], optional: ['precision'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { expression, precision } = params;
    try {
      // Only allow safe math characters, Math.*, constants, and common functions
      const sanitized = expression.replace(/\s/g, '');
      if (!/^[0-9+\-*/().,%^e]+$/.test(sanitized) && !/^[0-9+\-*/().,%^e\s]*(?:Math\.\w+|sqrt|pow|abs|ceil|floor|round|log|log10|sin|cos|tan|min|max|PI|E|random)\b/i.test(expression)) {
        // Try to make it safe by substituting common function names
        let safe = expression
          .replace(/\bsqrt\b/g, 'Math.sqrt').replace(/\bpow\b/g, 'Math.pow')
          .replace(/\babs\b/g, 'Math.abs').replace(/\bceil\b/g, 'Math.ceil')
          .replace(/\bfloor\b/g, 'Math.floor').replace(/\bround\b/g, 'Math.round')
          .replace(/\blog\b/g, 'Math.log').replace(/\blog10\b/g, 'Math.log10')
          .replace(/\bsin\b/g, 'Math.sin').replace(/\bcos\b/g, 'Math.cos')
          .replace(/\btan\b/g, 'Math.tan').replace(/\bPI\b/g, 'Math.PI')
          .replace(/\bmin\b/g, 'Math.min').replace(/\bmax\b/g, 'Math.max');
        // Final safety check — only allow Math.*, numbers, operators, parens
        if (!/^[0-9+\-*/().,%^eMath.\s\w]+$/.test(safe)) {
          return { error: 'Expression contains unsafe characters', code: 'MATH_ERROR' };
        }
        const result = new Function(`"use strict"; return (${safe})`)();
        return { result: precision !== undefined ? +result.toFixed(precision) : result, expression };
      }
      let safe = expression
        .replace(/\bsqrt\b/g, 'Math.sqrt').replace(/\bpow\b/g, 'Math.pow')
        .replace(/\babs\b/g, 'Math.abs').replace(/\bceil\b/g, 'Math.ceil')
        .replace(/\bfloor\b/g, 'Math.floor').replace(/\bround\b/g, 'Math.round')
        .replace(/\blog10\b/g, 'Math.log10').replace(/\blog\b/g, 'Math.log')
        .replace(/\bsin\b/g, 'Math.sin').replace(/\bcos\b/g, 'Math.cos')
        .replace(/\btan\b/g, 'Math.tan').replace(/\bPI\b/g, 'Math.PI')
        .replace(/\bmin\b/g, 'Math.min').replace(/\bmax\b/g, 'Math.max')
        .replace(/\^/g, '**');
      const result = new Function(`"use strict"; return (${safe})`)();
      return { result: precision !== undefined ? +result.toFixed(precision) : result, expression };
    } catch (err) { return { error: err.message, code: 'MATH_ERROR' }; }
  },
};

tools['math.stats'] = {
  name: 'math.stats',
  description: 'Calculate basic statistics on a dataset (mean, median, std, min, max, etc.)',
  params: { required: ['data'], optional: ['field'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { data, field } = params;
    try {
      let values = Array.isArray(data) ? data : (typeof data === 'string' ? JSON.parse(data) : []);
      if (field) values = values.map(item => item[field]).filter(v => typeof v === 'number');
      else values = values.map(Number).filter(v => !isNaN(v));
      if (!values.length) return { error: 'No numeric values', code: 'MATH_ERROR' };
      values.sort((a, b) => a - b);
      const n = values.length;
      const sum = values.reduce((a, b) => a + b, 0);
      const mean = sum / n;
      const median = n % 2 === 0 ? (values[n / 2 - 1] + values[n / 2]) / 2 : values[Math.floor(n / 2)];
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
      const stddev = Math.sqrt(variance);
      const q1 = values[Math.floor(n * 0.25)];
      const q3 = values[Math.floor(n * 0.75)];
      return { count: n, sum, mean, median, min: values[0], max: values[n - 1], stddev: +stddev.toFixed(6), variance: +variance.toFixed(6), q1, q3, iqr: q3 - q1, range: values[n - 1] - values[0] };
    } catch (err) { return { error: err.message, code: 'MATH_ERROR' }; }
  },
};

tools['math.convert'] = {
  name: 'math.convert',
  description: 'Convert between units (length, weight, temperature, data size, time)',
  params: { required: ['value', 'from', 'to'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { value, from, to } = params;
    const conversions = {
      // Length → meters
      mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344,
      // Weight → grams
      mg: 0.001, g: 1, kg: 1000, oz: 28.3495, lb: 453.592, ton: 1000000,
      // Data → bytes
      b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776,
      // Time → seconds
      ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, w: 604800,
    };
    // Temperature special case
    if ((from === 'c' || from === 'f' || from === 'k') && (to === 'c' || to === 'f' || to === 'k')) {
      let celsius;
      if (from === 'c') celsius = value;
      else if (from === 'f') celsius = (value - 32) * 5 / 9;
      else celsius = value - 273.15;
      let result;
      if (to === 'c') result = celsius;
      else if (to === 'f') result = celsius * 9 / 5 + 32;
      else result = celsius + 273.15;
      return { result: +result.toFixed(4), from, to, value };
    }
    const fromFactor = conversions[from.toLowerCase()];
    const toFactor = conversions[to.toLowerCase()];
    if (!fromFactor || !toFactor) return { error: `Unknown unit: ${!fromFactor ? from : to}`, code: 'MATH_ERROR', supportedUnits: Object.keys(conversions) };
    // Check same dimension (approximate — length/weight/data/time groups)
    const groups = [['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'], ['mg', 'g', 'kg', 'oz', 'lb', 'ton'], ['b', 'kb', 'mb', 'gb', 'tb'], ['ms', 's', 'min', 'h', 'd', 'w']];
    const fromGroup = groups.find(g => g.includes(from.toLowerCase()));
    const toGroup = groups.find(g => g.includes(to.toLowerCase()));
    if (fromGroup !== toGroup) return { error: `Cannot convert ${from} to ${to} — different dimensions`, code: 'MATH_ERROR' };
    const result = value * fromFactor / toFactor;
    return { result: +result.toFixed(6), from, to, value };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// URL
// ════════════════════════════════════════════════════════════════════════════

tools['url.parse'] = {
  name: 'url.parse',
  description: 'Parse a URL into its components',
  params: { required: ['url'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    try {
      const u = new URL(params.url);
      return {
        href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname,
        port: u.port || null, pathname: u.pathname, search: u.search,
        hash: u.hash, origin: u.origin, username: u.username || null,
        searchParams: Object.fromEntries(u.searchParams),
      };
    } catch (err) { return { error: err.message, code: 'URL_ERROR' }; }
  },
};

tools['url.build'] = {
  name: 'url.build',
  description: 'Build a URL from components',
  params: { required: ['base'], optional: ['path', 'params', 'hash'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { base, path, params: queryParams, hash } = params;
    try {
      const u = new URL(path || '', base);
      if (queryParams) Object.entries(queryParams).forEach(([k, v]) => u.searchParams.set(k, String(v)));
      if (hash) u.hash = hash;
      return { url: u.href };
    } catch (err) { return { error: err.message, code: 'URL_ERROR' }; }
  },
};

tools['url.encode'] = {
  name: 'url.encode',
  description: 'URL-encode a string',
  params: { required: ['input'], optional: ['component'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, component = true } = params;
    return { encoded: component ? encodeURIComponent(input) : encodeURI(input) };
  },
};

tools['url.decode'] = {
  name: 'url.decode',
  description: 'URL-decode a string',
  params: { required: ['input'], optional: ['component'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, component = true } = params;
    try { return { decoded: component ? decodeURIComponent(input) : decodeURI(input) }; }
    catch (err) { return { error: err.message, code: 'URL_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// DIFF (unified format)
// ════════════════════════════════════════════════════════════════════════════

tools['diff.create'] = {
  name: 'diff.create',
  description: 'Create a unified diff between two texts or files',
  params: { required: ['a', 'b'], optional: ['inputType', 'nameA', 'nameB', 'context'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { a, b, inputType = 'string', nameA = 'a', nameB = 'b', context = 3 } = params;
    const fsP = await import('fs/promises');
    try {
      const textA = inputType === 'file' ? await fsP.readFile(a, 'utf-8') : a;
      const textB = inputType === 'file' ? await fsP.readFile(b, 'utf-8') : b;
      const linesA = textA.split('\n'), linesB = textB.split('\n');
      // Simple LCS-based diff
      const hunks = [];
      let i = 0, j = 0;
      while (i < linesA.length || j < linesB.length) {
        if (i < linesA.length && j < linesB.length && linesA[i] === linesB[j]) { i++; j++; continue; }
        // Found a difference — build a hunk
        const startA = Math.max(0, i - context), startB = Math.max(0, j - context);
        const hunkLines = [];
        // Context before
        for (let c = startA; c < i; c++) hunkLines.push(' ' + linesA[c]);
        // Find extent of change
        let endI = i, endJ = j;
        let matchCount = 0;
        while (endI < linesA.length || endJ < linesB.length) {
          if (endI < linesA.length && endJ < linesB.length && linesA[endI] === linesB[endJ]) {
            matchCount++;
            if (matchCount > context * 2) break;
            endI++; endJ++;
          } else {
            matchCount = 0;
            if (endI < linesA.length) { hunkLines.push('-' + linesA[endI]); endI++; }
            if (endJ < linesB.length) { hunkLines.push('+' + linesB[endJ]); endJ++; }
          }
        }
        // Context after
        const afterStart = Math.min(endI, linesA.length);
        for (let c = afterStart; c < Math.min(afterStart + context, linesA.length); c++) hunkLines.push(' ' + linesA[c]);
        hunks.push({ startA: startA + 1, startB: startB + 1, lines: hunkLines });
        i = endI; j = endJ;
      }
      const header = `--- ${inputType === 'file' ? a : nameA}\n+++ ${inputType === 'file' ? b : nameB}\n`;
      const body = hunks.map(h => `@@ -${h.startA} +${h.startB} @@\n${h.lines.join('\n')}`).join('\n');
      const diff = header + body;
      return { diff, hunks: hunks.length, additions: diff.split('\n').filter(l => l.startsWith('+')).length - 1, deletions: diff.split('\n').filter(l => l.startsWith('-')).length - 1 };
    } catch (err) { return { error: err.message, code: 'DIFF_ERROR' }; }
  },
};

tools['diff.apply'] = {
  name: 'diff.apply',
  description: 'Apply a unified diff patch to a file or text',
  params: { required: ['target', 'patch'], optional: ['inputType', 'dryRun'] },
  permissions: ['fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { target, patch, inputType = 'file', dryRun = false } = params;
    const fsP = await import('fs/promises');
    try {
      let text = inputType === 'file' ? await fsP.readFile(target, 'utf-8') : target;
      const lines = text.split('\n');
      const patchLines = patch.split('\n');
      let offset = 0;
      for (const pl of patchLines) {
        if (pl.startsWith('@@')) {
          const match = pl.match(/@@ -(\d+)/);
          if (match) offset = parseInt(match[1]) - 1;
          continue;
        }
        if (pl.startsWith('-')) {
          const expected = pl.substring(1);
          if (lines[offset] === expected) { lines.splice(offset, 1); }
          else { return { error: `Patch conflict at line ${offset + 1}: expected "${expected}", got "${lines[offset]}"`, code: 'PATCH_CONFLICT' }; }
        } else if (pl.startsWith('+')) {
          lines.splice(offset, 0, pl.substring(1));
          offset++;
        } else if (pl.startsWith(' ')) {
          offset++;
        }
      }
      const result = lines.join('\n');
      if (!dryRun && inputType === 'file') await fsP.writeFile(target, result);
      return { ok: true, dryRun, lines: lines.length };
    } catch (err) { return { error: err.message, code: 'DIFF_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ════════════════════════════════════════════════════════════════════════════

tools['test.detect'] = {
  name: 'test.detect',
  description: 'Auto-detect test framework in a project',
  params: { required: [], optional: ['cwd'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { cwd = '.' } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const root = pathM.resolve(cwd);
      let pkg = {};
      try { pkg = JSON.parse(await fsP.readFile(pathM.join(root, 'package.json'), 'utf-8')); } catch {}
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const scripts = pkg.scripts || {};
      const frameworks = [];
      if (deps.jest || scripts.test?.includes('jest')) frameworks.push({ name: 'jest', command: 'npx jest', config: 'jest.config' });
      if (deps.vitest || scripts.test?.includes('vitest')) frameworks.push({ name: 'vitest', command: 'npx vitest run', config: 'vitest.config' });
      if (deps.mocha || scripts.test?.includes('mocha')) frameworks.push({ name: 'mocha', command: 'npx mocha', config: '.mocharc' });
      if (deps.ava) frameworks.push({ name: 'ava', command: 'npx ava', config: 'ava.config' });
      if (deps.tap) frameworks.push({ name: 'tap', command: 'npx tap', config: '.taprc' });
      // Python
      try { await fsP.access(pathM.join(root, 'pytest.ini')); frameworks.push({ name: 'pytest', command: 'pytest' }); } catch {}
      try { await fsP.access(pathM.join(root, 'setup.py')); frameworks.push({ name: 'pytest', command: 'python -m pytest' }); } catch {}
      try { await fsP.access(pathM.join(root, 'pyproject.toml')); frameworks.push({ name: 'pytest', command: 'pytest' }); } catch {}
      // Node built-in test runner
      if (scripts.test?.includes('node --test')) frameworks.push({ name: 'node:test', command: 'node --test' });
      // Custom C3 test harness
      try {
        const testDir = await fsP.readdir(pathM.join(root, 'tests'));
        if (testDir.some(f => f.endsWith('.test.js') || f.endsWith('.test.mjs'))) {
          const harnessExists = testDir.includes('harness.js') || testDir.includes('harness.mjs');
          if (harnessExists && !frameworks.length) frameworks.push({ name: 'custom', command: 'node tests/<file>.test.js', config: 'tests/harness.js' });
        }
      } catch {}
      // npm test script
      if (scripts.test && !frameworks.length) frameworks.push({ name: 'npm', command: 'npm test' });
      return { frameworks, primary: frameworks[0] || null, testScript: scripts.test || null };
    } catch (err) { return { error: err.message, code: 'TEST_ERROR' }; }
  },
};

tools['test.run'] = {
  name: 'test.run',
  description: 'Run tests (auto-detects framework or uses specified command)',
  params: { required: [], optional: ['cwd', 'command', 'file', 'grep', 'timeout', 'coverage'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { cwd = '.', command, file, grep, timeout = 120000, coverage = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = command;
      if (!cmd) {
        // Auto-detect
        const detected = await tools['test.detect'].execute({ cwd });
        if (!detected.primary) return { error: 'No test framework detected. Specify command.', code: 'NO_FRAMEWORK' };
        cmd = detected.primary.command;
      }
      if (file) cmd += ` ${file}`;
      if (grep) cmd += ` --grep "${grep}"`;
      if (coverage) cmd += ' --coverage';
      const output = execSync(cmd, { cwd, timeout: Math.min(timeout, 300000), encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
      const passed = (output.match(/(\d+) pass/i) || [])[1];
      const failed = (output.match(/(\d+) fail/i) || [])[1];
      return { ok: true, output: output.substring(0, 50000), passed: passed ? parseInt(passed) : null, failed: failed ? parseInt(failed) : null };
    } catch (err) {
      const out = ((err.stdout || '') + (err.stderr || '')).substring(0, 50000);
      const failed = (out.match(/(\d+) fail/i) || [])[1];
      return { ok: false, exitCode: err.status || 1, output: out, failed: failed ? parseInt(failed) : null };
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// PYTHON
// ════════════════════════════════════════════════════════════════════════════

tools['python.run'] = {
  name: 'python.run',
  description: 'Run a Python script or inline code',
  params: { required: ['input'], optional: ['inputType', 'cwd', 'args', 'timeout', 'venv'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'exec' },
  async execute(params) {
    const { input, inputType = 'file', cwd = '.', args = '', timeout = 30000, venv } = params;
    const { execSync } = await import('child_process');
    try {
      let python = 'python3';
      if (venv) python = `${venv}/bin/python`;
      const cmd = inputType === 'code'
        ? `${python} -c "${input.replace(/"/g, '\\"')}"`
        : `${python} "${input}" ${args}`;
      const output = execSync(cmd, { cwd, timeout: Math.min(timeout, 120000), encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, output: output.substring(0, 50000) };
    } catch (err) {
      return { ok: false, exitCode: err.status || 1, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 10000) };
    }
  },
};

tools['python.pip'] = {
  name: 'python.pip',
  description: 'Install Python packages via pip',
  params: { required: ['packages'], optional: ['cwd', 'venv', 'upgrade'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'exec' },
  async execute(params) {
    const { packages, cwd = '.', venv, upgrade = false } = params;
    const { execSync } = await import('child_process');
    try {
      let pip = 'pip3';
      if (venv) pip = `${venv}/bin/pip`;
      const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;
      let cmd = `${pip} install ${pkgList}`;
      if (upgrade) cmd += ' --upgrade';
      const output = execSync(cmd, { cwd, timeout: 120000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, output: output.substring(0, 5000) };
    } catch (err) { return { ok: false, error: err.message, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 5000) }; }
  },
};

tools['python.venv'] = {
  name: 'python.venv',
  description: 'Create or manage a Python virtual environment',
  params: { required: ['action'], optional: ['path', 'cwd'] },
  permissions: ['shell.exec', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { action, path = '.venv', cwd = '.' } = params;
    const { execSync } = await import('child_process');
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const venvPath = pathM.resolve(cwd, path);
      if (action === 'create') {
        execSync(`python3 -m venv "${venvPath}"`, { cwd, timeout: 30000 });
        return { ok: true, path: venvPath, python: pathM.join(venvPath, 'bin/python'), pip: pathM.join(venvPath, 'bin/pip') };
      }
      if (action === 'exists') {
        try { await fsP.access(pathM.join(venvPath, 'bin/python')); return { exists: true, path: venvPath }; }
        catch { return { exists: false }; }
      }
      if (action === 'list') {
        const output = execSync(`${pathM.join(venvPath, 'bin/pip')} list --format=json`, { timeout: 10000, encoding: 'utf-8' });
        return { packages: JSON.parse(output) };
      }
      return { error: `Unknown action: ${action}`, code: 'INVALID_ACTION' };
    } catch (err) { return { error: err.message, code: 'PYTHON_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// CODE ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

tools['code.analyze'] = {
  name: 'code.analyze',
  description: 'Analyze code metrics — LOC, file count, language breakdown',
  params: { required: [], optional: ['dir', 'ext', 'maxDepth'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { dir = '.', ext, maxDepth = 8 } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '.c3', '__pycache__', '.next', 'vendor', 'coverage']);
      const langExts = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript', py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java', cpp: 'C++', c: 'C', cs: 'C#', php: 'PHP', swift: 'Swift', kt: 'Kotlin', scala: 'Scala', dart: 'Dart', vue: 'Vue', svelte: 'Svelte', css: 'CSS', scss: 'SCSS', html: 'HTML', sql: 'SQL', sh: 'Shell', yaml: 'YAML', yml: 'YAML', json: 'JSON', md: 'Markdown', xml: 'XML' };
      const stats = { totalFiles: 0, totalLines: 0, totalBlank: 0, totalComment: 0, totalCode: 0, languages: {}, largestFiles: [] };
      async function walk(d, depth) {
        if (depth > maxDepth) return;
        let entries; try { entries = await fsP.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (skip.has(e.name) || e.name.startsWith('.')) continue;
          const full = pathM.join(d, e.name);
          if (e.isDirectory()) { await walk(full, depth + 1); continue; }
          const fileExt = e.name.split('.').pop()?.toLowerCase();
          if (ext && fileExt !== ext) continue;
          if (!langExts[fileExt]) continue;
          try {
            const stat = await fsP.stat(full);
            if (stat.size > 512 * 1024) continue;
            const content = await fsP.readFile(full, 'utf-8');
            const lines = content.split('\n');
            const blank = lines.filter(l => !l.trim()).length;
            const comment = lines.filter(l => /^\s*(\/\/|#|\/\*|\*|<!--)/.test(l)).length;
            const code = lines.length - blank - comment;
            const lang = langExts[fileExt] || fileExt;
            if (!stats.languages[lang]) stats.languages[lang] = { files: 0, lines: 0, code: 0 };
            stats.languages[lang].files++;
            stats.languages[lang].lines += lines.length;
            stats.languages[lang].code += code;
            stats.totalFiles++;
            stats.totalLines += lines.length;
            stats.totalBlank += blank;
            stats.totalComment += comment;
            stats.totalCode += code;
            stats.largestFiles.push({ path: pathM.relative(dir, full), lines: lines.length, lang });
          } catch { continue; }
        }
      }
      await walk(pathM.resolve(dir), 0);
      stats.largestFiles.sort((a, b) => b.lines - a.lines);
      stats.largestFiles = stats.largestFiles.slice(0, 15);
      return stats;
    } catch (err) { return { error: err.message, code: 'CODE_ERROR' }; }
  },
};

tools['code.format'] = {
  name: 'code.format',
  description: 'Format code using project formatter (prettier, eslint --fix, black, etc.)',
  params: { required: [], optional: ['cwd', 'files', 'tool', 'check'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'exec' },
  async execute(params) {
    const { cwd = '.', files, tool, check = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd;
      const t = tool || 'auto';
      if (t === 'auto') {
        // Auto-detect
        try { execSync('npx prettier --version', { cwd, timeout: 5000 }); cmd = check ? 'npx prettier --check' : 'npx prettier --write'; }
        catch { try { execSync('npx eslint --version', { cwd, timeout: 5000 }); cmd = check ? 'npx eslint' : 'npx eslint --fix'; }
        catch { try { execSync('which black', { timeout: 3000 }); cmd = check ? 'black --check' : 'black'; }
        catch { return { error: 'No formatter found. Install prettier, eslint, or black.', code: 'NO_FORMATTER' }; } } }
      } else {
        cmd = { prettier: check ? 'npx prettier --check' : 'npx prettier --write', eslint: check ? 'npx eslint' : 'npx eslint --fix', black: check ? 'black --check' : 'black', gofmt: 'gofmt -w', rustfmt: 'rustfmt' }[t] || t;
      }
      if (files) cmd += ' ' + (Array.isArray(files) ? files.map(f => `"${f}"`).join(' ') : `"${files}"`);
      else cmd += ' .';
      const output = execSync(cmd, { cwd, timeout: 60000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
      return { ok: true, tool: t, output: ((output || '') + '').substring(0, 5000) };
    } catch (err) {
      return { ok: false, exitCode: err.status, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 5000) };
    }
  },
};

tools['code.lint'] = {
  name: 'code.lint',
  description: 'Run linter and return issues',
  params: { required: [], optional: ['cwd', 'files', 'tool', 'fix'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'exec' },
  async execute(params) {
    const { cwd = '.', files, tool, fix = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd;
      const t = tool || 'auto';
      if (t === 'auto') {
        try { execSync('npx eslint --version', { cwd, timeout: 5000 }); cmd = 'npx eslint --format json'; }
        catch { try { execSync('which pylint', { timeout: 3000 }); cmd = 'pylint --output-format=json'; }
        catch { return { error: 'No linter found. Install eslint or pylint.', code: 'NO_LINTER' }; } }
      } else {
        cmd = { eslint: 'npx eslint --format json', pylint: 'pylint --output-format=json', flake8: 'flake8', clippy: 'cargo clippy --message-format=json' }[t] || t;
      }
      if (fix) cmd += ' --fix';
      if (files) cmd += ' ' + (Array.isArray(files) ? files.join(' ') : files);
      else cmd += ' .';
      const output = execSync(cmd, { cwd, timeout: 60000, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
      let issues = [];
      try { issues = JSON.parse(output); } catch {}
      return { ok: true, tool: t, issues: Array.isArray(issues) ? issues.slice(0, 50) : [], output: output.substring(0, 5000) };
    } catch (err) {
      let issues = [];
      try { issues = JSON.parse(err.stdout || '[]'); } catch {}
      return { ok: false, tool: t || 'auto', exitCode: err.status, issues: Array.isArray(issues) ? issues.slice(0, 50) : [], output: ((err.stdout || '') + (err.stderr || '')).substring(0, 5000) };
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// SSH / Remote
// ════════════════════════════════════════════════════════════════════════════

tools['ssh.exec'] = {
  name: 'ssh.exec',
  description: 'Execute a command on a remote host via SSH',
  params: { required: ['host', 'command'], optional: ['user', 'port', 'key', 'timeout'] },
  permissions: ['shell.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { host, command, user, port = 22, key, timeout = 30000 } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = 'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10';
      if (key) cmd += ` -i "${key}"`;
      if (port !== 22) cmd += ` -p ${port}`;
      const target = user ? `${user}@${host}` : host;
      cmd += ` ${target} "${command.replace(/"/g, '\\"')}"`;
      const output = execSync(cmd, { timeout: Math.min(timeout, 120000), encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      return { ok: true, host, output: output.substring(0, 50000) };
    } catch (err) {
      return { ok: false, host, error: err.message, output: ((err.stdout || '') + (err.stderr || '')).substring(0, 5000) };
    }
  },
};

tools['ssh.copy'] = {
  name: 'ssh.copy',
  description: 'Copy files to/from remote host via SCP',
  params: { required: ['source', 'dest'], optional: ['user', 'host', 'port', 'key', 'recursive'] },
  permissions: ['shell.exec', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'net' },
  async execute(params) {
    const { source, dest, user, host, port = 22, key, recursive = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = 'scp -o StrictHostKeyChecking=accept-new';
      if (key) cmd += ` -i "${key}"`;
      if (port !== 22) cmd += ` -P ${port}`;
      if (recursive) cmd += ' -r';
      cmd += ` "${source}" "${dest}"`;
      const output = execSync(cmd, { timeout: 120000, encoding: 'utf-8' });
      return { ok: true, source, dest, output: (output || '').trim() };
    } catch (err) { return { ok: false, error: err.message, output: (err.stderr || '') }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// DATABASE — Extended
// ════════════════════════════════════════════════════════════════════════════

tools['db.schema'] = {
  name: 'db.schema',
  description: 'Show database schema (tables, columns, indices)',
  params: { required: ['dbPath'], optional: ['table'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { dbPath, table } = params;
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });
      if (table) {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
        const indices = db.prepare(`PRAGMA index_list("${table}")`).all();
        const count = db.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get();
        db.close();
        return { table, columns, indices, rowCount: count.count };
      }
      const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const views = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name").all();
      const result = { tables: [], views: views.map(v => v.name) };
      for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
        const count = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get();
        result.tables.push({ name: t.name, columns: cols.length, rows: count.count, columnNames: cols.map(c => c.name) });
      }
      db.close();
      return result;
    } catch (err) { return { error: err.message, code: 'DB_ERROR' }; }
  },
};

tools['db.backup'] = {
  name: 'db.backup',
  description: 'Create a backup of a SQLite database',
  params: { required: ['dbPath'], optional: ['outputPath'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { dbPath, outputPath } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = outputPath || dbPath.replace(/\.db$/, '') + `-backup-${timestamp}.db`;
      await fsP.mkdir(pathM.dirname(dest), { recursive: true });
      await fsP.copyFile(dbPath, dest);
      const stat = await fsP.stat(dest);
      return { ok: true, source: dbPath, backup: dest, size: stat.size };
    } catch (err) { return { error: err.message, code: 'DB_ERROR' }; }
  },
};

tools['db.migrate'] = {
  name: 'db.migrate',
  description: 'Run SQL migration files against a SQLite database',
  params: { required: ['dbPath', 'migrationsDir'], optional: ['dryRun'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: true, requiresConfirmation: true, costLevel: 'high', category: 'write' },
  async execute(params) {
    const { dbPath, migrationsDir, dryRun = false } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath);
      // Create migrations tracking table
      db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
      const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
      const files = (await fsP.readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
      const pending = files.filter(f => !applied.has(f));
      if (dryRun) { db.close(); return { pending, applied: [...applied], dryRun: true }; }
      const results = [];
      for (const file of pending) {
        const sql = await fsP.readFile(pathM.join(migrationsDir, file), 'utf-8');
        try {
          db.exec(sql);
          db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
          results.push({ file, ok: true });
        } catch (err) {
          results.push({ file, ok: false, error: err.message });
          break; // Stop on first error
        }
      }
      db.close();
      return { results, applied: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, pending: pending.length };
    } catch (err) { return { error: err.message, code: 'DB_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// LOG ANALYSIS
// ════════════════════════════════════════════════════════════════════════════

tools['log.tail'] = {
  name: 'log.tail',
  description: 'Tail a log file with optional filtering',
  params: { required: ['path'], optional: ['lines', 'filter', 'level'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { path, lines = 50, filter, level } = params;
    const fsP = await import('fs/promises');
    try {
      const content = await fsP.readFile(path, 'utf-8');
      let allLines = content.split('\n');
      if (level) {
        const levels = { error: ['ERROR', 'FATAL', 'CRITICAL'], warn: ['WARN', 'WARNING', 'ERROR', 'FATAL'], info: ['INFO', 'WARN', 'ERROR', 'FATAL'], debug: ['DEBUG', 'INFO', 'WARN', 'ERROR'] };
        const allowed = levels[level.toLowerCase()] || [level.toUpperCase()];
        allLines = allLines.filter(l => allowed.some(lv => l.includes(lv)));
      }
      if (filter) {
        const re = new RegExp(filter, 'i');
        allLines = allLines.filter(l => re.test(l));
      }
      const result = allLines.slice(-Math.min(lines, 1000));
      return { lines: result, count: result.length, totalLines: allLines.length };
    } catch (err) { return { error: err.message, code: 'LOG_ERROR' }; }
  },
};

tools['log.analyze'] = {
  name: 'log.analyze',
  description: 'Analyze a log file — count errors, find patterns, summarize',
  params: { required: ['path'], optional: ['maxLines'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const { path, maxLines = 10000 } = params;
    const fsP = await import('fs/promises');
    try {
      const content = await fsP.readFile(path, 'utf-8');
      const allLines = content.split('\n').slice(-maxLines);
      const levels = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, FATAL: 0 };
      const errorMessages = {};
      const timestamps = [];
      for (const line of allLines) {
        for (const lv of Object.keys(levels)) { if (line.includes(lv)) { levels[lv]++; break; } }
        if (line.includes('ERROR') || line.includes('FATAL')) {
          const msg = line.replace(/^\[?[\d\-T:.Z]+\]?\s*/i, '').substring(0, 100);
          errorMessages[msg] = (errorMessages[msg] || 0) + 1;
        }
        const ts = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
        if (ts) timestamps.push(ts[0]);
      }
      const topErrors = Object.entries(errorMessages).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([msg, count]) => ({ message: msg, count }));
      return {
        totalLines: allLines.length, levels, topErrors,
        timeRange: timestamps.length ? { first: timestamps[0], last: timestamps[timestamps.length - 1] } : null,
        errorRate: allLines.length ? `${((levels.ERROR + levels.FATAL) / allLines.length * 100).toFixed(1)}%` : '0%',
      };
    } catch (err) { return { error: err.message, code: 'LOG_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ════════════════════════════════════════════════════════════════════════════

tools['validate.json'] = {
  name: 'validate.json',
  description: 'Validate JSON data — check syntax, optional field validation',
  params: { required: ['input'], optional: ['inputType', 'requiredFields', 'types'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { input, inputType = 'string', requiredFields, types } = params;
    const fsP = await import('fs/promises');
    try {
      const text = inputType === 'file' ? await fsP.readFile(input, 'utf-8') : input;
      let data;
      try { data = JSON.parse(text); } catch (e) { return { valid: false, error: `JSON syntax error: ${e.message}`, position: e.message.match(/position (\d+)/)?.[1] }; }
      const errors = [];
      if (requiredFields) {
        for (const field of requiredFields) {
          if (data[field] === undefined) errors.push(`Missing required field: ${field}`);
        }
      }
      if (types) {
        for (const [field, expectedType] of Object.entries(types)) {
          if (data[field] !== undefined && typeof data[field] !== expectedType) {
            errors.push(`Field "${field}" expected ${expectedType}, got ${typeof data[field]}`);
          }
        }
      }
      return { valid: errors.length === 0, errors, data: errors.length === 0 ? data : undefined, keys: Object.keys(data), type: Array.isArray(data) ? 'array' : typeof data };
    } catch (err) { return { valid: false, error: err.message }; }
  },
};

tools['validate.email'] = {
  name: 'validate.email',
  description: 'Validate email address format',
  params: { required: ['email'], optional: [] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { email } = params;
    const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    const valid = re.test(email) && email.includes('.') && email.length <= 254;
    const [local, domain] = email.split('@');
    return { valid, email, local, domain, issues: valid ? [] : ['Invalid email format'] };
  },
};

tools['validate.url'] = {
  name: 'validate.url',
  description: 'Validate URL format and accessibility',
  params: { required: ['url'], optional: ['checkReachable'] },
  permissions: ['web.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { url, checkReachable = false } = params;
    try {
      const u = new URL(url);
      const result = { valid: true, url: u.href, protocol: u.protocol, hostname: u.hostname };
      if (checkReachable) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
          clearTimeout(timer);
          result.reachable = true;
          result.status = res.status;
        } catch { result.reachable = false; }
      }
      return result;
    } catch { return { valid: false, url, issues: ['Invalid URL format'] }; }
  },
};

tools['validate.semver'] = {
  name: 'validate.semver',
  description: 'Validate and compare semantic version strings',
  params: { required: ['version'], optional: ['compareTo'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'pure' },
  async execute(params) {
    const { version, compareTo } = params;
    const re = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?(?:\+([\w.]+))?$/;
    const m = version.match(re);
    if (!m) return { valid: false, version, error: 'Not a valid semver' };
    const parsed = { major: parseInt(m[1]), minor: parseInt(m[2]), patch: parseInt(m[3]), prerelease: m[4] || null, build: m[5] || null };
    const result = { valid: true, version: `${parsed.major}.${parsed.minor}.${parsed.patch}`, ...parsed };
    if (compareTo) {
      const m2 = compareTo.match(re);
      if (!m2) { result.compareError = 'compareTo is not valid semver'; return result; }
      const b = { major: parseInt(m2[1]), minor: parseInt(m2[2]), patch: parseInt(m2[3]) };
      if (parsed.major !== b.major) result.comparison = parsed.major > b.major ? 'newer' : 'older';
      else if (parsed.minor !== b.minor) result.comparison = parsed.minor > b.minor ? 'newer' : 'older';
      else if (parsed.patch !== b.patch) result.comparison = parsed.patch > b.patch ? 'newer' : 'older';
      else result.comparison = 'equal';
      result.compareTo = compareTo;
    }
    return result;
  },
};

// ════════════════════════════════════════════════════════════════════════════
// WORKSPACE — Snapshot / Restore
// ════════════════════════════════════════════════════════════════════════════

tools['workspace.snapshot'] = {
  name: 'workspace.snapshot',
  description: 'Create a snapshot of workspace state (file list + git status)',
  params: { required: [], optional: ['dir', 'name'] },
  permissions: ['fs.read'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'write' },
  async execute(params) {
    const { dir = '.', name } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    const { execSync } = await import('child_process');
    try {
      const root = pathM.resolve(dir);
      const snapshotName = name || `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const snapshotDir = pathM.join(root, '.c3', 'snapshots');
      await fsP.mkdir(snapshotDir, { recursive: true });
      // Capture file list with hashes
      const skip = new Set(['node_modules', '.git', '.c3', 'dist', 'build']);
      const files = {};
      async function walk(d, depth) {
        if (depth > 5) return;
        let entries; try { entries = await fsP.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (skip.has(e.name)) continue;
          const full = pathM.join(d, e.name);
          if (e.isDirectory()) { await walk(full, depth + 1); continue; }
          const stat = await fsP.stat(full);
          files[pathM.relative(root, full)] = { size: stat.size, modified: stat.mtime.toISOString() };
        }
      }
      await walk(root, 0);
      // Git state
      let gitState = null;
      try {
        const branch = execSync('git branch --show-current', { cwd: root, timeout: 3000, encoding: 'utf-8' }).trim();
        const status = execSync('git status --porcelain', { cwd: root, timeout: 5000, encoding: 'utf-8' });
        const head = execSync('git rev-parse HEAD', { cwd: root, timeout: 3000, encoding: 'utf-8' }).trim();
        gitState = { branch, head, dirty: status.trim().length > 0, status: status.trim() };
      } catch {}
      const snapshot = { name: snapshotName, created: new Date().toISOString(), dir: root, files, fileCount: Object.keys(files).length, git: gitState };
      await fsP.writeFile(pathM.join(snapshotDir, `${snapshotName}.json`), JSON.stringify(snapshot, null, 2));
      return { ok: true, name: snapshotName, fileCount: snapshot.fileCount, path: pathM.join(snapshotDir, `${snapshotName}.json`) };
    } catch (err) { return { error: err.message, code: 'WORKSPACE_ERROR' }; }
  },
};

tools['workspace.restore'] = {
  name: 'workspace.restore',
  description: 'Restore workspace to a snapshot (via git checkout or file comparison)',
  params: { required: ['name'], optional: ['dir', 'dryRun'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: false, destructive: true, requiresConfirmation: true, costLevel: 'high', category: 'write' },
  async execute(params) {
    const { name, dir = '.', dryRun = true } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    const { execSync } = await import('child_process');
    try {
      const root = pathM.resolve(dir);
      const snapshotPath = pathM.join(root, '.c3', 'snapshots', `${name}.json`);
      const snapshot = JSON.parse(await fsP.readFile(snapshotPath, 'utf-8'));
      const changes = { added: [], modified: [], deleted: [] };
      // Compare current state
      const currentFiles = {};
      const skip = new Set(['node_modules', '.git', '.c3', 'dist', 'build']);
      async function walk(d, depth) {
        if (depth > 5) return;
        let entries; try { entries = await fsP.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (skip.has(e.name)) continue;
          const full = pathM.join(d, e.name);
          if (e.isDirectory()) { await walk(full, depth + 1); continue; }
          const stat = await fsP.stat(full);
          currentFiles[pathM.relative(root, full)] = { size: stat.size, modified: stat.mtime.toISOString() };
        }
      }
      await walk(root, 0);
      for (const [file, info] of Object.entries(currentFiles)) {
        if (!snapshot.files[file]) changes.added.push(file);
        else if (info.size !== snapshot.files[file].size || info.modified !== snapshot.files[file].modified) changes.modified.push(file);
      }
      for (const file of Object.keys(snapshot.files)) {
        if (!currentFiles[file]) changes.deleted.push(file);
      }
      if (!dryRun && snapshot.git?.head) {
        try { execSync(`git checkout ${snapshot.git.head}`, { cwd: root, timeout: 10000 }); } catch {}
      }
      return { snapshot: name, dryRun, changes, totalChanges: changes.added.length + changes.modified.length + changes.deleted.length, canGitRestore: !!snapshot.git?.head };
    } catch (err) { return { error: err.message, code: 'WORKSPACE_ERROR' }; }
  },
};

tools['workspace.snapshots'] = {
  name: 'workspace.snapshots',
  description: 'List available workspace snapshots',
  params: { required: [], optional: ['dir'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    const { dir = '.' } = params;
    const fsP = await import('fs/promises');
    const pathM = await import('path');
    try {
      const snapshotDir = pathM.join(pathM.resolve(dir), '.c3', 'snapshots');
      let files;
      try { files = await fsP.readdir(snapshotDir); } catch { return { snapshots: [], count: 0 }; }
      const snapshots = [];
      for (const f of files.filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(await fsP.readFile(pathM.join(snapshotDir, f), 'utf-8'));
          snapshots.push({ name: data.name, created: data.created, fileCount: data.fileCount, git: data.git?.branch || null });
        } catch { continue; }
      }
      snapshots.sort((a, b) => b.created.localeCompare(a.created));
      return { snapshots, count: snapshots.length };
    } catch (err) { return { error: err.message, code: 'WORKSPACE_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// PROFILING / OBSERVABILITY
// ════════════════════════════════════════════════════════════════════════════

tools['profile.cpu'] = {
  name: 'profile.cpu',
  description: 'CPU profile a Node.js script via --prof and process the log',
  params: { required: ['script'], optional: ['cwd', 'duration', 'args'] },
  permissions: ['fs.read', 'process.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'high', category: 'exec' },
  async execute(params) {
    try {
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const script = params.script;
      const args = params.args || '';
      const dur = params.duration || 5;

      // Run with --prof
      execSync(`node --prof ${script} ${args}`, { cwd, timeout: (dur + 30) * 1000, stdio: 'pipe' });

      // Find the latest isolate log
      const logs = fs.readdirSync(cwd).filter(f => f.startsWith('isolate-') && f.endsWith('.log'));
      if (!logs.length) return { error: 'No profiling log generated', code: 'PROFILE_ERROR' };
      logs.sort((a, b) => fs.statSync(path.join(cwd, b)).mtimeMs - fs.statSync(path.join(cwd, a)).mtimeMs);
      const logFile = logs[0];

      // Process the log
      const output = execSync(`node --prof-process ${logFile}`, { cwd, timeout: 30000, encoding: 'utf-8' });

      // Cleanup
      try { fs.unlinkSync(path.join(cwd, logFile)); } catch {}

      // Parse summary
      const lines = output.split('\n');
      const summary = [];
      let section = '';
      for (const line of lines) {
        if (line.includes('[Summary]')) { section = 'summary'; continue; }
        if (line.includes('[C++]') || line.includes('[JavaScript]') || line.includes('[Bottom up')) { section = ''; }
        if (section === 'summary' && line.trim()) summary.push(line.trim());
      }

      return { summary: summary.join('\n'), fullOutput: output.slice(0, 5000) };
    } catch (err) { return { error: err.message, code: 'PROFILE_ERROR' }; }
  },
};

tools['profile.heap'] = {
  name: 'profile.heap',
  description: 'Take a V8 heap snapshot of a running process or script',
  params: { required: ['script'], optional: ['cwd', 'args'] },
  permissions: ['fs.read', 'fs.write', 'process.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'high', category: 'exec' },
  async execute(params) {
    try {
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const path = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const script = params.script;
      const args = params.args || '';

      // Use --heap-prof to generate heap profile
      execSync(`node --heap-prof --heap-prof-interval=512 ${script} ${args}`, { cwd, timeout: 60000, stdio: 'pipe' });

      // Find the generated file
      const files = fs.readdirSync(cwd).filter(f => f.endsWith('.heapprofile'));
      if (!files.length) return { error: 'No heap profile generated', code: 'PROFILE_ERROR' };
      files.sort((a, b) => fs.statSync(path.join(cwd, b)).mtimeMs - fs.statSync(path.join(cwd, a)).mtimeMs);
      const profileFile = files[0];
      const profilePath = path.join(cwd, profileFile);
      const stats = fs.statSync(profilePath);

      return {
        file: profilePath,
        size: stats.size,
        sizeHuman: stats.size > 1048576 ? `${(stats.size / 1048576).toFixed(1)}MB` : `${(stats.size / 1024).toFixed(1)}KB`,
        hint: 'Open in Chrome DevTools → Memory → Load profile',
      };
    } catch (err) { return { error: err.message, code: 'PROFILE_ERROR' }; }
  },
};

tools['profile.eventloop'] = {
  name: 'profile.eventloop',
  description: 'Measure event loop lag and delays',
  params: { required: [], optional: ['duration', 'interval'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'read' },
  async execute(params) {
    const duration = (params.duration || 3) * 1000;
    const interval = params.interval || 50;
    const samples = [];
    const start = Date.now();

    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const expected = interval;
        const before = process.hrtime.bigint();
        setImmediate(() => {
          const actual = Number(process.hrtime.bigint() - before) / 1e6;
          samples.push(actual);
          if (Date.now() - start >= duration) {
            clearInterval(timer);
            samples.sort((a, b) => a - b);
            const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
            resolve({
              samples: samples.length,
              min: samples[0].toFixed(2) + 'ms',
              max: samples[samples.length - 1].toFixed(2) + 'ms',
              avg: avg.toFixed(2) + 'ms',
              p50: samples[Math.floor(samples.length * 0.5)].toFixed(2) + 'ms',
              p95: samples[Math.floor(samples.length * 0.95)].toFixed(2) + 'ms',
              p99: samples[Math.floor(samples.length * 0.99)].toFixed(2) + 'ms',
              healthy: avg < 10,
            });
          }
        });
      }, interval);
    });
  },
};

tools['profile.benchmark'] = {
  name: 'profile.benchmark',
  description: 'Micro-benchmark a JS expression or function',
  params: { required: ['code'], optional: ['iterations', 'warmup'] },
  permissions: ['process.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'exec' },
  async execute(params) {
    try {
      const code = params.code;
      const iterations = params.iterations || 10000;
      const warmup = params.warmup || 100;

      const fn = new Function('return (' + code + ')')();
      if (typeof fn !== 'function') return { error: 'Code must evaluate to a function', code: 'BENCH_ERROR' };

      // Warmup
      for (let i = 0; i < warmup; i++) fn();

      // Benchmark
      const times = [];
      for (let i = 0; i < iterations; i++) {
        const s = process.hrtime.bigint();
        fn();
        times.push(Number(process.hrtime.bigint() - s));
      }

      times.sort((a, b) => a - b);
      const totalNs = times.reduce((s, v) => s + v, 0);
      const avgNs = totalNs / times.length;

      return {
        iterations,
        totalMs: (totalNs / 1e6).toFixed(2),
        avgNs: avgNs.toFixed(0),
        minNs: times[0],
        maxNs: times[times.length - 1],
        p50Ns: times[Math.floor(times.length * 0.5)],
        p99Ns: times[Math.floor(times.length * 0.99)],
        opsPerSec: Math.floor(1e9 / avgNs),
      };
    } catch (err) { return { error: err.message, code: 'BENCH_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// API / HTTP TESTING
// ════════════════════════════════════════════════════════════════════════════

tools['api.request'] = {
  name: 'api.request',
  description: 'Make an HTTP request with full control (method, headers, body, auth)',
  params: { required: ['url'], optional: ['method', 'headers', 'body', 'auth', 'timeout'] },
  permissions: ['net.http'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'net' },
  async execute(params) {
    try {
      const url = params.url;
      const method = (params.method || 'GET').toUpperCase();
      const headers = params.headers || {};
      const timeout = params.timeout || 30000;

      if (params.auth) {
        if (params.auth.type === 'bearer') headers['Authorization'] = `Bearer ${params.auth.token}`;
        else if (params.auth.type === 'basic') {
          const cred = Buffer.from(`${params.auth.user}:${params.auth.pass}`).toString('base64');
          headers['Authorization'] = `Basic ${cred}`;
        }
      }

      const opts = { method, headers };
      if (params.body && method !== 'GET') {
        if (typeof params.body === 'object') {
          opts.body = JSON.stringify(params.body);
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        } else {
          opts.body = params.body;
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      opts.signal = controller.signal;

      const start = Date.now();
      const resp = await fetch(url, opts);
      const elapsed = Date.now() - start;
      clearTimeout(timer);

      const contentType = resp.headers.get('content-type') || '';
      let data;
      if (contentType.includes('json')) {
        data = await resp.json();
      } else {
        const text = await resp.text();
        data = text.length > 10000 ? text.slice(0, 10000) + '...(truncated)' : text;
      }

      const respHeaders = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });

      return {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
        data,
        elapsed: elapsed + 'ms',
        size: respHeaders['content-length'] || null,
      };
    } catch (err) { return { error: err.message, code: 'API_ERROR' }; }
  },
};

tools['api.latency'] = {
  name: 'api.latency',
  description: 'Measure endpoint latency over multiple requests',
  params: { required: ['url'], optional: ['method', 'count', 'headers', 'body'] },
  permissions: ['net.http'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'net' },
  async execute(params) {
    try {
      const url = params.url;
      const method = params.method || 'GET';
      const count = Math.min(params.count || 10, 100);
      const headers = params.headers || {};
      const body = params.body ? JSON.stringify(params.body) : undefined;
      const times = [];
      const statuses = [];

      for (let i = 0; i < count; i++) {
        const opts = { method, headers };
        if (body && method !== 'GET') {
          opts.body = body;
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
        const start = Date.now();
        try {
          const resp = await fetch(url, opts);
          times.push(Date.now() - start);
          statuses.push(resp.status);
          await resp.text(); // consume body
        } catch (err) {
          times.push(Date.now() - start);
          statuses.push('ERR');
        }
      }

      times.sort((a, b) => a - b);
      const avg = times.reduce((s, v) => s + v, 0) / times.length;
      const statusCounts = {};
      statuses.forEach(s => { statusCounts[s] = (statusCounts[s] || 0) + 1; });

      return {
        requests: count,
        min: times[0] + 'ms',
        max: times[times.length - 1] + 'ms',
        avg: avg.toFixed(0) + 'ms',
        p50: times[Math.floor(times.length * 0.5)] + 'ms',
        p95: times[Math.floor(times.length * 0.95)] + 'ms',
        p99: times[Math.floor(times.length * 0.99)] + 'ms',
        statuses: statusCounts,
      };
    } catch (err) { return { error: err.message, code: 'API_ERROR' }; }
  },
};

tools['api.validate'] = {
  name: 'api.validate',
  description: 'Validate API response against expected schema/status/headers',
  params: { required: ['url'], optional: ['method', 'headers', 'body', 'expect'] },
  permissions: ['net.http'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'low', category: 'net' },
  async execute(params) {
    try {
      const url = params.url;
      const method = params.method || 'GET';
      const expect = params.expect || {};
      const headers = params.headers || {};
      const opts = { method, headers };
      if (params.body && method !== 'GET') {
        opts.body = typeof params.body === 'object' ? JSON.stringify(params.body) : params.body;
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }

      const resp = await fetch(url, opts);
      const contentType = resp.headers.get('content-type') || '';
      let data;
      if (contentType.includes('json')) data = await resp.json();
      else data = await resp.text();

      const results = [];
      let pass = true;

      // Status check
      if (expect.status) {
        const ok = resp.status === expect.status;
        results.push({ check: 'status', expected: expect.status, actual: resp.status, pass: ok });
        if (!ok) pass = false;
      }

      // Content-Type check
      if (expect.contentType) {
        const ok = contentType.includes(expect.contentType);
        results.push({ check: 'contentType', expected: expect.contentType, actual: contentType, pass: ok });
        if (!ok) pass = false;
      }

      // Header checks
      if (expect.headers) {
        for (const [k, v] of Object.entries(expect.headers)) {
          const actual = resp.headers.get(k);
          const ok = actual === v;
          results.push({ check: `header:${k}`, expected: v, actual, pass: ok });
          if (!ok) pass = false;
        }
      }

      // Body field checks
      if (expect.bodyFields && typeof data === 'object') {
        for (const [field, expectedType] of Object.entries(expect.bodyFields)) {
          const parts = field.split('.');
          let val = data;
          for (const p of parts) val = val?.[p];
          const actualType = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
          const ok = actualType === expectedType;
          results.push({ check: `body:${field}`, expected: expectedType, actual: actualType, pass: ok });
          if (!ok) pass = false;
        }
      }

      return { pass, checks: results, status: resp.status };
    } catch (err) { return { error: err.message, code: 'API_ERROR' }; }
  },
};

tools['api.loadtest'] = {
  name: 'api.loadtest',
  description: 'Simple concurrent load test against an endpoint',
  params: { required: ['url'], optional: ['method', 'concurrency', 'requests', 'headers', 'body'] },
  permissions: ['net.http'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'high', category: 'net' },
  async execute(params) {
    try {
      const url = params.url;
      const method = params.method || 'GET';
      const concurrency = Math.min(params.concurrency || 5, 50);
      const totalRequests = Math.min(params.requests || 50, 500);
      const headers = params.headers || {};
      const body = params.body ? JSON.stringify(params.body) : undefined;

      const results = [];
      let completed = 0;
      let errors = 0;

      const doRequest = async () => {
        const opts = { method, headers };
        if (body && method !== 'GET') {
          opts.body = body;
          if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
        const start = Date.now();
        try {
          const resp = await fetch(url, opts);
          await resp.text();
          results.push({ status: resp.status, time: Date.now() - start });
          completed++;
        } catch (err) {
          results.push({ status: 'ERR', time: Date.now() - start, error: err.message });
          errors++;
          completed++;
        }
      };

      // Run in batches of concurrency
      const startTime = Date.now();
      for (let i = 0; i < totalRequests; i += concurrency) {
        const batch = Math.min(concurrency, totalRequests - i);
        await Promise.all(Array.from({ length: batch }, doRequest));
      }
      const totalTime = Date.now() - startTime;

      const times = results.filter(r => r.status !== 'ERR').map(r => r.time).sort((a, b) => a - b);
      const statusCounts = {};
      results.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });

      return {
        totalRequests: completed,
        concurrency,
        totalTimeMs: totalTime,
        rps: (completed / (totalTime / 1000)).toFixed(1),
        errors,
        statuses: statusCounts,
        latency: times.length ? {
          min: times[0] + 'ms',
          max: times[times.length - 1] + 'ms',
          avg: (times.reduce((s, v) => s + v, 0) / times.length).toFixed(0) + 'ms',
          p50: times[Math.floor(times.length * 0.5)] + 'ms',
          p95: times[Math.floor(times.length * 0.95)] + 'ms',
        } : null,
      };
    } catch (err) { return { error: err.message, code: 'LOADTEST_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// CODE ANALYSIS / STRUCTURED REFACTORING
// ════════════════════════════════════════════════════════════════════════════

tools['code.imports'] = {
  name: 'code.imports',
  description: 'Analyze import/require graph for a file or directory',
  params: { required: ['path'], optional: ['depth', 'cwd'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'read' },
  async execute(params) {
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const targetPath = pathMod.resolve(cwd, params.path);
      const maxDepth = params.depth || 3;

      const graph = {};
      const visited = new Set();

      const extractImports = (filePath) => {
        if (visited.has(filePath) || visited.size > 200) return;
        visited.add(filePath);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const imports = [];

          // ES imports: import X from 'Y', import { X } from 'Y', import 'Y'
          const esRe = /import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]/g;
          let m;
          while ((m = esRe.exec(content))) imports.push(m[1]);

          // Dynamic imports: import('X'), await import('X')
          const dynRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
          while ((m = dynRe.exec(content))) imports.push(m[1]);

          // CJS require: require('X')
          const cjsRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
          while ((m = cjsRe.exec(content))) imports.push(m[1]);

          const resolved = [];
          for (const imp of imports) {
            if (imp.startsWith('.')) {
              // Relative import — try to resolve
              const dir = pathMod.dirname(filePath);
              const candidates = [
                pathMod.resolve(dir, imp),
                pathMod.resolve(dir, imp + '.js'),
                pathMod.resolve(dir, imp + '.ts'),
                pathMod.resolve(dir, imp + '.mjs'),
                pathMod.resolve(dir, imp, 'index.js'),
                pathMod.resolve(dir, imp, 'index.ts'),
              ];
              const found = candidates.find(c => fs.existsSync(c));
              resolved.push({ specifier: imp, resolved: found || null, type: 'local' });
              if (found && visited.size < 200) extractImports(found);
            } else {
              resolved.push({ specifier: imp, type: imp.startsWith('@') ? 'scoped' : 'package' });
            }
          }

          graph[filePath] = resolved;
        } catch {}
      };

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        // Scan directory for JS/TS files
        const scanDir = (dir, depth) => {
          if (depth > maxDepth) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const full = pathMod.join(dir, entry.name);
            if (entry.isDirectory()) scanDir(full, depth + 1);
            else if (/\.(js|ts|mjs|cjs|jsx|tsx)$/.test(entry.name)) extractImports(full);
          }
        };
        scanDir(targetPath, 0);
      } else {
        extractImports(targetPath);
      }

      // Compute stats
      const allPackages = new Set();
      let localCount = 0;
      for (const deps of Object.values(graph)) {
        for (const d of deps) {
          if (d.type === 'local') localCount++;
          else allPackages.add(d.specifier);
        }
      }

      return {
        files: Object.keys(graph).length,
        localImports: localCount,
        externalPackages: [...allPackages].sort(),
        externalCount: allPackages.size,
        graph,
      };
    } catch (err) { return { error: err.message, code: 'IMPORT_ERROR' }; }
  },
};

tools['code.deadcode'] = {
  name: 'code.deadcode',
  description: 'Detect potentially unused exports in a JS/TS project',
  params: { required: ['path'], optional: ['cwd'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'read' },
  async execute(params) {
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const targetPath = pathMod.resolve(cwd, params.path);

      const exports = new Map(); // symbol → { file, used: boolean }
      const allImported = new Set(); // all imported symbol names

      const scanFile = (filePath) => {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');

          // Named exports: export { x }, export const x, export function x, export class x
          const namedRe = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
          let m;
          while ((m = namedRe.exec(content))) {
            exports.set(`${filePath}::${m[1]}`, { file: filePath, symbol: m[1], used: false });
          }

          // Imported names
          const importRe = /import\s+\{([^}]+)\}\s+from/g;
          while ((m = importRe.exec(content))) {
            const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
            names.forEach(n => allImported.add(n));
          }

          // Default import names don't help (they can be renamed)
          // But require destructure: const { x } = require(...)
          const reqRe = /const\s+\{([^}]+)\}\s*=\s*require/g;
          while ((m = reqRe.exec(content))) {
            const names = m[1].split(',').map(n => n.trim().split(':')[0].trim());
            names.forEach(n => allImported.add(n));
          }
        } catch {}
      };

      const walk = (dir, depth) => {
        if (depth > 5) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
          const full = pathMod.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (/\.(js|ts|mjs|cjs|jsx|tsx)$/.test(entry.name)) scanFile(full);
        }
      };

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) walk(targetPath, 0);
      else scanFile(targetPath);

      // Mark used exports
      for (const [key, info] of exports) {
        if (allImported.has(info.symbol)) info.used = true;
      }

      const unused = [...exports.values()].filter(e => !e.used);
      const used = [...exports.values()].filter(e => e.used);

      return {
        totalExports: exports.size,
        usedExports: used.length,
        unusedExports: unused.length,
        unused: unused.map(e => ({ file: e.file, symbol: e.symbol })),
        note: 'Heuristic analysis — may have false positives for dynamically accessed exports',
      };
    } catch (err) { return { error: err.message, code: 'DEADCODE_ERROR' }; }
  },
};

tools['code.rename'] = {
  name: 'code.rename',
  description: 'Rename a symbol across all files in a project (text-based safe rename)',
  params: { required: ['path', 'oldName', 'newName'], optional: ['cwd', 'dryRun', 'extensions'] },
  permissions: ['fs.read', 'fs.write'],
  meta: { sideEffects: true, idempotent: true, destructive: false, requiresConfirmation: true, costLevel: 'medium', category: 'write' },
  async execute(params) {
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const targetPath = pathMod.resolve(cwd, params.path);
      const oldName = params.oldName;
      const newName = params.newName;
      const dryRun = params.dryRun !== false; // default true for safety
      const extensions = params.extensions || ['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.json'];

      // Word-boundary regex to avoid partial matches
      const re = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

      const changes = [];

      const processFile = (filePath) => {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const matches = content.match(re);
          if (!matches || !matches.length) return;

          const newContent = content.replace(re, newName);
          changes.push({ file: filePath, occurrences: matches.length });

          if (!dryRun) {
            fs.writeFileSync(filePath, newContent, 'utf-8');
          }
        } catch {}
      };

      const walk = (dir, depth) => {
        if (depth > 6) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const full = pathMod.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (extensions.some(ext => entry.name.endsWith(ext))) processFile(full);
        }
      };

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) walk(targetPath, 0);
      else processFile(targetPath);

      const totalOccurrences = changes.reduce((s, c) => s + c.occurrences, 0);

      return {
        dryRun,
        filesChanged: changes.length,
        totalOccurrences,
        changes,
        ...(dryRun ? { hint: 'Set dryRun: false to apply changes' } : {}),
      };
    } catch (err) { return { error: err.message, code: 'RENAME_ERROR' }; }
  },
};

tools['code.duplicates'] = {
  name: 'code.duplicates',
  description: 'Detect duplicate/similar code blocks in a project',
  params: { required: ['path'], optional: ['cwd', 'minLines', 'threshold'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'high', category: 'read' },
  async execute(params) {
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const targetPath = pathMod.resolve(cwd, params.path);
      const minLines = params.minLines || 5;

      const files = [];
      const walk = (dir, depth) => {
        if (depth > 5) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const full = pathMod.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, depth + 1);
          else if (/\.(js|ts|mjs|jsx|tsx|py|java|go|rs)$/.test(entry.name)) files.push(full);
        }
      };

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) walk(targetPath, 0);
      else files.push(targetPath);

      // Extract normalized blocks
      const blocks = new Map(); // hash → [{ file, startLine, lines }]

      for (const file of files.slice(0, 100)) { // cap at 100 files
        try {
          const lines = fs.readFileSync(file, 'utf-8').split('\n');
          for (let i = 0; i <= lines.length - minLines; i++) {
            const block = lines.slice(i, i + minLines);
            // Normalize: trim, collapse whitespace, skip if too short or all empty/comments
            const normalized = block.map(l => l.trim().replace(/\s+/g, ' ')).join('\n');
            if (normalized.length < minLines * 5) continue;
            if (block.every(l => !l.trim() || l.trim().startsWith('//') || l.trim().startsWith('#'))) continue;

            // Simple hash
            let hash = 0;
            for (let j = 0; j < normalized.length; j++) hash = ((hash << 5) - hash + normalized.charCodeAt(j)) | 0;
            const key = hash.toString(36);

            if (!blocks.has(key)) blocks.set(key, []);
            blocks.get(key).push({ file, startLine: i + 1, preview: block[0].trim().slice(0, 80) });
          }
        } catch {}
      }

      // Find duplicates
      const duplicates = [];
      for (const [, locations] of blocks) {
        if (locations.length < 2) continue;
        // Skip same-file adjacent (sliding window overlap)
        const unique = [];
        const seen = new Set();
        for (const loc of locations) {
          const key = `${loc.file}:${Math.floor(loc.startLine / minLines)}`;
          if (!seen.has(key)) { seen.add(key); unique.push(loc); }
        }
        if (unique.length >= 2) {
          duplicates.push({ blockSize: minLines, locations: unique.slice(0, 5) });
        }
      }

      // Sort by most occurrences
      duplicates.sort((a, b) => b.locations.length - a.locations.length);

      return {
        filesScanned: files.length,
        duplicatesFound: duplicates.length,
        duplicates: duplicates.slice(0, 30),
      };
    } catch (err) { return { error: err.message, code: 'DUPLICATE_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// DEPENDENCY INTELLIGENCE
// ════════════════════════════════════════════════════════════════════════════

tools['deps.tree'] = {
  name: 'deps.tree',
  description: 'Analyze transitive dependency tree with depth/size info',
  params: { required: [], optional: ['cwd', 'depth', 'package'] },
  permissions: ['fs.read', 'process.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'read' },
  async execute(params) {
    try {
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const depth = params.depth || 3;

      const args = params.package ? `${params.package}` : '';
      const output = execSync(`npm ls --json --depth=${depth} ${args} 2>/dev/null || true`, {
        cwd, encoding: 'utf-8', timeout: 30000,
      });

      let tree;
      try { tree = JSON.parse(output); } catch { return { error: 'Could not parse npm ls output', code: 'DEPS_ERROR' }; }

      // Count unique packages
      const packages = new Set();
      const countDeps = (node) => {
        if (!node?.dependencies) return;
        for (const [name, info] of Object.entries(node.dependencies)) {
          packages.add(`${name}@${info.version || '?'}`);
          countDeps(info);
        }
      };
      countDeps(tree);

      // Get node_modules size
      const nmPath = pathMod.join(cwd, 'node_modules');
      let nmSize = null;
      try {
        const du = execSync(`du -sh ${nmPath} 2>/dev/null`, { encoding: 'utf-8', timeout: 10000 });
        nmSize = du.split('\t')[0].trim();
      } catch {}

      return {
        name: tree.name,
        version: tree.version,
        totalPackages: packages.size,
        nodeModulesSize: nmSize,
        tree: tree.dependencies || {},
      };
    } catch (err) { return { error: err.message, code: 'DEPS_ERROR' }; }
  },
};

tools['deps.licenses'] = {
  name: 'deps.licenses',
  description: 'Scan all dependency licenses and flag problematic ones',
  params: { required: [], optional: ['cwd'] },
  permissions: ['fs.read'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'read' },
  async execute(params) {
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const nmPath = pathMod.join(cwd, 'node_modules');

      if (!fs.existsSync(nmPath)) return { error: 'node_modules not found — run npm install first', code: 'DEPS_ERROR' };

      const COPYLEFT = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'SSPL-1.0', 'EUPL-1.2'];
      const licenses = {};
      const flagged = [];

      const scanDir = (dir) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const pkgDir = pathMod.join(dir, entry.name);
            if (entry.name.startsWith('@')) {
              // Scoped package — go one level deeper
              scanDir(pkgDir);
              continue;
            }
            const pkgPath = pathMod.join(pkgDir, 'package.json');
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
              const license = pkg.license || pkg.licenses?.[0]?.type || 'UNKNOWN';
              const name = pkg.name || entry.name;
              licenses[license] = (licenses[license] || 0) + 1;
              if (license === 'UNKNOWN' || COPYLEFT.some(c => license.toUpperCase().includes(c))) {
                flagged.push({ name, version: pkg.version, license });
              }
            } catch {}
          }
        } catch {}
      };

      scanDir(nmPath);

      return {
        summary: licenses,
        totalPackages: Object.values(licenses).reduce((s, v) => s + v, 0),
        flagged: flagged.length ? flagged : null,
        flaggedCount: flagged.length,
        clean: flagged.length === 0,
      };
    } catch (err) { return { error: err.message, code: 'DEPS_ERROR' }; }
  },
};

tools['deps.size'] = {
  name: 'deps.size',
  description: 'Analyze size impact of each dependency',
  params: { required: [], optional: ['cwd', 'top'] },
  permissions: ['fs.read', 'process.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'medium', category: 'read' },
  async execute(params) {
    try {
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const cwd = params.cwd || process.cwd();
      const top = params.top || 20;
      const nmPath = pathMod.join(cwd, 'node_modules');

      if (!fs.existsSync(nmPath)) return { error: 'node_modules not found', code: 'DEPS_ERROR' };

      // Get sizes of top-level packages
      const sizes = [];
      const getDirSize = (dir) => {
        let total = 0;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = pathMod.join(dir, entry.name);
            if (entry.isDirectory()) total += getDirSize(full);
            else total += fs.statSync(full).size;
          }
        } catch {}
        return total;
      };

      for (const entry of fs.readdirSync(nmPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const full = pathMod.join(nmPath, entry.name);
        if (entry.name.startsWith('@')) {
          // Scoped packages
          for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            const scopedFull = pathMod.join(full, sub.name);
            sizes.push({ name: `${entry.name}/${sub.name}`, size: getDirSize(scopedFull) });
          }
        } else {
          sizes.push({ name: entry.name, size: getDirSize(full) });
        }
      }

      sizes.sort((a, b) => b.size - a.size);
      const totalSize = sizes.reduce((s, p) => s + p.size, 0);

      return {
        totalPackages: sizes.length,
        totalSize: (totalSize / 1048576).toFixed(1) + 'MB',
        top: sizes.slice(0, top).map(p => ({
          name: p.name,
          size: p.size > 1048576 ? (p.size / 1048576).toFixed(1) + 'MB' : (p.size / 1024).toFixed(0) + 'KB',
          percent: (p.size / totalSize * 100).toFixed(1) + '%',
        })),
      };
    } catch (err) { return { error: err.message, code: 'DEPS_ERROR' }; }
  },
};

tools['deps.vuln'] = {
  name: 'deps.vuln',
  description: 'Run vulnerability audit and return structured results',
  params: { required: [], optional: ['cwd', 'fix'] },
  permissions: ['fs.read', 'fs.write', 'process.exec'],
  meta: { sideEffects: true, idempotent: false, destructive: false, requiresConfirmation: true, costLevel: 'low', category: 'exec' },
  async execute(params) {
    const result = runNpmAuditReport({
      cwd: params.cwd || process.cwd(),
      fix: Boolean(params.fix),
    });
    if (!result.ok) return npmAuditError(result, 'VULN_ERROR');
    if (params.fix) return result.audit;
    return dependencyVulnerabilityResult(result);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// RESOURCE GUARDS
// ════════════════════════════════════════════════════════════════════════════

tools['guard.disk'] = {
  name: 'guard.disk',
  description: 'Check disk space and warn if running low',
  params: { required: [], optional: ['path', 'thresholdPercent'] },
  permissions: ['process.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    try {
      const { execSync } = await import('node:child_process');
      const checkPath = params.path || '/';
      const threshold = params.thresholdPercent || 90;

      const output = execSync(`df -h ${checkPath} 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
      const lines = output.trim().split('\n');
      if (lines.length < 2) return { error: 'Unexpected df output', code: 'GUARD_ERROR' };

      const parts = lines[1].split(/\s+/);
      const total = parts[1];
      const used = parts[2];
      const avail = parts[3];
      const usePercent = parseInt(parts[4]);

      return {
        filesystem: parts[0],
        total,
        used,
        available: avail,
        usePercent: usePercent + '%',
        warning: usePercent >= threshold,
        critical: usePercent >= 95,
        message: usePercent >= 95 ? 'CRITICAL: Disk almost full!' :
                 usePercent >= threshold ? `WARNING: Disk usage above ${threshold}%` :
                 'Disk space OK',
      };
    } catch (err) { return { error: err.message, code: 'GUARD_ERROR' }; }
  },
};

tools['guard.memory'] = {
  name: 'guard.memory',
  description: 'Check system and process memory pressure',
  params: { required: [], optional: ['thresholdPercent'] },
  permissions: [],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    try {
      const os = await import('node:os');
      const threshold = params.thresholdPercent || 85;

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const usePercent = (usedMem / totalMem * 100);

      const processMemory = process.memoryUsage();

      return {
        system: {
          total: (totalMem / 1073741824).toFixed(1) + 'GB',
          used: (usedMem / 1073741824).toFixed(1) + 'GB',
          free: (freeMem / 1073741824).toFixed(1) + 'GB',
          usePercent: usePercent.toFixed(1) + '%',
        },
        process: {
          rss: (processMemory.rss / 1048576).toFixed(1) + 'MB',
          heapUsed: (processMemory.heapUsed / 1048576).toFixed(1) + 'MB',
          heapTotal: (processMemory.heapTotal / 1048576).toFixed(1) + 'MB',
          external: (processMemory.external / 1048576).toFixed(1) + 'MB',
        },
        warning: usePercent >= threshold,
        critical: usePercent >= 95,
        message: usePercent >= 95 ? 'CRITICAL: Memory almost exhausted!' :
                 usePercent >= threshold ? `WARNING: Memory usage above ${threshold}%` :
                 'Memory OK',
      };
    } catch (err) { return { error: err.message, code: 'GUARD_ERROR' }; }
  },
};

tools['guard.fd'] = {
  name: 'guard.fd',
  description: 'Check open file descriptors for the process',
  params: { required: [], optional: ['thresholdPercent'] },
  permissions: ['process.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    try {
      const { execSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const threshold = params.thresholdPercent || 80;
      const pid = process.pid;

      // Get open FDs for this process
      let openFds = 0;
      try {
        const fds = fs.readdirSync(`/proc/${pid}/fd`);
        openFds = fds.length;
      } catch {
        // Fallback: lsof
        try {
          const output = execSync(`lsof -p ${pid} 2>/dev/null | wc -l`, { encoding: 'utf-8', timeout: 5000 });
          openFds = parseInt(output.trim()) || 0;
        } catch { openFds = -1; }
      }

      // Get FD limit
      let fdLimit = 1024;
      try {
        const output = execSync('ulimit -n 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
        fdLimit = parseInt(output.trim()) || 1024;
      } catch {}

      const usePercent = openFds > 0 ? (openFds / fdLimit * 100) : 0;

      return {
        openFds,
        fdLimit,
        usePercent: usePercent.toFixed(1) + '%',
        warning: usePercent >= threshold,
        critical: usePercent >= 95,
        message: usePercent >= 95 ? 'CRITICAL: FD limit almost reached!' :
                 usePercent >= threshold ? `WARNING: FD usage above ${threshold}%` :
                 'File descriptors OK',
      };
    } catch (err) { return { error: err.message, code: 'GUARD_ERROR' }; }
  },
};

tools['guard.watchdog'] = {
  name: 'guard.watchdog',
  description: 'Run all resource guards and return combined health check',
  params: { required: [], optional: ['diskPath', 'diskThreshold', 'memThreshold', 'fdThreshold'] },
  permissions: ['process.exec'],
  meta: { sideEffects: false, idempotent: true, destructive: false, requiresConfirmation: false, costLevel: 'free', category: 'read' },
  async execute(params) {
    try {
      const [disk, memory, fd] = await Promise.all([
        tools['guard.disk'].execute({ path: params.diskPath, thresholdPercent: params.diskThreshold }),
        tools['guard.memory'].execute({ thresholdPercent: params.memThreshold }),
        tools['guard.fd'].execute({ thresholdPercent: params.fdThreshold }),
      ]);

      const warnings = [];
      const criticals = [];

      if (disk.warning) warnings.push('disk');
      if (disk.critical) criticals.push('disk');
      if (memory.warning) warnings.push('memory');
      if (memory.critical) criticals.push('memory');
      if (fd.warning) warnings.push('fd');
      if (fd.critical) criticals.push('fd');

      const status = criticals.length ? 'critical' : warnings.length ? 'warning' : 'healthy';

      return {
        status,
        disk: { available: disk.available, usePercent: disk.usePercent, warning: disk.warning },
        memory: { free: memory.system?.free, usePercent: memory.system?.usePercent, warning: memory.warning },
        fd: { open: fd.openFds, limit: fd.fdLimit, warning: fd.warning },
        warnings,
        criticals,
        timestamp: new Date().toISOString(),
      };
    } catch (err) { return { error: err.message, code: 'GUARD_ERROR' }; }
  },
};

// ════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ════════════════════════════════════════════════════════════════════════════

class ToolRegistry {
  constructor() {
    this.tools = { ...tools };
  }

  /**
   * Get a tool by name
   * @param {string} name
   * @returns {ToolDef | undefined}
   */
  get(name) {
    return this.tools[name];
  }

  /**
   * Check if tool exists
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return name in this.tools;
  }

  /**
   * Register a new tool
   * @param {ToolDef} toolDef
   */
  register(toolDef) {
    if (!toolDef.name || !toolDef.execute) {
      throw new Error('Tool must have name and execute function');
    }
    if (!toolDef.params) {
      toolDef.params = { required: [], optional: [] };
    }
    if (!toolDef.permissions) {
      toolDef.permissions = [];
    }
    this.tools[toolDef.name] = toolDef;
    logger.debug('ToolRegistry', `Registered tool: ${toolDef.name}`);
  }

  /**
   * List all registered tools
   * @returns {string[]}
   */
  list() {
    return Object.keys(this.tools);
  }

  /**
   * Get tool metadata (without execute function)
   * @param {string} name
   * @returns {Object | undefined}
   */
  getMetadata(name) {
    const tool = this.tools[name];
    if (!tool) return undefined;
    return {
      name: tool.name,
      description: tool.description,
      params: tool.params,
      permissions: tool.permissions,
      meta: tool.meta || null,
    };
  }

  /**
   * Get all tool metadata
   * @returns {Object[]}
   */
  listMetadata() {
    return Object.values(this.tools).map(t => ({
      name: t.name,
      description: t.description,
      params: t.params,
      permissions: t.permissions,
      meta: t.meta || null,
    }));
  }

  // ── Meta-aware query methods ──────────────────────────────────────────

  /**
   * Get tools safe for autonomous execution (no side effects + idempotent)
   * @returns {string[]}
   */
  safeForAutoExec() {
    return Object.values(this.tools)
      .filter(t => t.meta && !t.meta.sideEffects && t.meta.idempotent)
      .map(t => t.name);
  }

  /**
   * Get tools that require user confirmation before execution
   * @returns {string[]}
   */
  requiresConfirmation() {
    return Object.values(this.tools)
      .filter(t => t.meta?.requiresConfirmation)
      .map(t => t.name);
  }

  /**
   * Get destructive tools (can cause data loss)
   * @returns {string[]}
   */
  destructive() {
    return Object.values(this.tools)
      .filter(t => t.meta?.destructive)
      .map(t => t.name);
  }

  /**
   * Filter tools by category
   * @param {'read'|'write'|'exec'|'net'|'pure'} category
   * @returns {string[]}
   */
  byCategory(category) {
    return Object.values(this.tools)
      .filter(t => t.meta?.category === category)
      .map(t => t.name);
  }

  /**
   * Filter tools by cost level
   * @param {'free'|'low'|'medium'|'high'} costLevel
   * @returns {string[]}
   */
  byCost(costLevel) {
    return Object.values(this.tools)
      .filter(t => t.meta?.costLevel === costLevel)
      .map(t => t.name);
  }

  /**
   * Check if a specific tool is safe to auto-execute
   * @param {string} name
   * @returns {boolean}
   */
  isSafe(name) {
    const tool = this.tools[name];
    if (!tool?.meta) return false;
    return !tool.meta.sideEffects && tool.meta.idempotent && !tool.meta.destructive;
  }

  /**
   * Get risk assessment for a tool
   * @param {string} name
   * @returns {{ risk: 'safe'|'low'|'medium'|'high'|'critical', reasons: string[] } | undefined}
   */
  riskAssessment(name) {
    const tool = this.tools[name];
    if (!tool?.meta) return undefined;
    const m = tool.meta;
    const reasons = [];
    if (m.destructive) reasons.push('destructive — can cause data loss');
    if (m.sideEffects) reasons.push('has side effects');
    if (!m.idempotent) reasons.push('not idempotent — repeated calls may differ');
    if (m.requiresConfirmation) reasons.push('requires user confirmation');
    if (m.costLevel === 'high') reasons.push('high resource cost');

    let risk = 'safe';
    if (m.destructive) risk = 'critical';
    else if (m.requiresConfirmation || m.costLevel === 'high') risk = 'high';
    else if (m.sideEffects && !m.idempotent) risk = 'medium';
    else if (m.sideEffects) risk = 'low';
    return { risk, reasons, meta: m };
  }

  /**
   * Get full capability summary for autonomy layer
   * @returns {Object}
   */
  capabilitySummary() {
    const all = Object.values(this.tools);
    const withMeta = all.filter(t => t.meta);
    return {
      total: all.length,
      withMeta: withMeta.length,
      categories: {
        pure: this.byCategory('pure').length,
        read: this.byCategory('read').length,
        write: this.byCategory('write').length,
        exec: this.byCategory('exec').length,
        net: this.byCategory('net').length,
      },
      costs: {
        free: this.byCost('free').length,
        low: this.byCost('low').length,
        medium: this.byCost('medium').length,
        high: this.byCost('high').length,
      },
      safeForAutoExec: this.safeForAutoExec().length,
      requiresConfirmation: this.requiresConfirmation().length,
      destructive: this.destructive().length,
    };
  }
}

// Singleton
export const toolRegistry = new ToolRegistry();

export default ToolRegistry;
