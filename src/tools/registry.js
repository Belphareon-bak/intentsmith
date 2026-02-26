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
// GIT — Full Suite
// ════════════════════════════════════════════════════════════════════════════

tools['git.push'] = {
  name: 'git.push',
  description: 'Push commits to remote repository',
  params: { required: [], optional: ['cwd', 'remote', 'branch', 'force', 'tags', 'setUpstream'] },
  permissions: ['fs.write'],
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
  permissions: ['fs.read'],
  async execute(params) {
    const { cwd = '.', fix = false, production = false } = params;
    const { execSync } = await import('child_process');
    try {
      let cmd = fix ? 'npm audit fix --json' : 'npm audit --json';
      if (production) cmd += ' --production';
      const output = execSync(cmd, { cwd, timeout: 60000, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
      const data = JSON.parse(output || '{}');
      return {
        vulnerabilities: data.metadata?.vulnerabilities || data.vulnerabilities || {},
        totalDeps: data.metadata?.totalDependencies,
        advisories: Object.values(data.advisories || {}).slice(0, 20).map(a => ({
          title: a.title, severity: a.severity, module: a.module_name, url: a.url,
        })),
      };
    } catch (err) {
      try { return JSON.parse(err.stdout || '{}'); }
      catch { return { error: err.message, code: 'NPM_ERROR' }; }
    }
  },
};

tools['npm.init'] = {
  name: 'npm.init',
  description: 'Initialize a new package.json',
  params: { required: [], optional: ['cwd', 'name', 'version', 'description', 'main', 'type'] },
  permissions: ['fs.write'],
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
