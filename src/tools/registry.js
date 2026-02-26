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
import { memory } from '../memory/policy.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITION STRUCTURE
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {{ required: string[], optional: string[] }} params
 * @property {string[]} permissions
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
    optional: ['encoding'],
  },
  permissions: ['fs.write'],
  async execute(params) {
    const { path, content, encoding = 'utf-8' } = params;
    const { writeFile, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');

    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, encoding);
      return { path, written: content.length };
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
    }));
  }
}

// Singleton
export const toolRegistry = new ToolRegistry();

export default ToolRegistry;
