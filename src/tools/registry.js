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
