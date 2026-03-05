// Execution Graph v1 — Runtime-aware code intelligence
// ══════════════════════════════════════════════════════════════════════════════
//
// Builds execution flow from static analysis + framework pattern inference.
// Unlike the knowledge graph (structural), this models runtime behavior:
//   HTTP request → middleware → controller → service → repository → DB
//
// Sources:
//   1. Static call graph (from knowledge graph)
//   2. Framework pattern detection (Express routes, Spring controllers, etc.)
//   3. Stack trace parsing (runtime logs)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { collectCodeFiles } from './index-builder.js';
import { detectLanguage } from './code-analyzer.js';
import { readFile } from 'fs/promises';
import path from 'path';

// ─── Route Pattern Detection ────────────────────────────────────────────────

const ROUTE_PATTERNS = [
  // Express.js: app.get('/path', handler) or router.post('/path', handler)
  { framework: 'Express', pattern: /(?:app|router)\.(get|post|put|delete|patch|all|use)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+(?:\.\w+)?)?/g },
  // Fastify: fastify.get('/path', handler)
  { framework: 'Fastify', pattern: /fastify\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g },
  // Flask: @app.route('/path', methods=['GET'])
  { framework: 'Flask', pattern: /@(?:app|blueprint)\.route\s*\(\s*['"]([^'"]+)['"](?:.*?methods\s*=\s*\[['"](\w+))?/g },
  // FastAPI: @app.get('/path')
  { framework: 'FastAPI', pattern: /@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g },
  // Spring: @GetMapping("/path"), @RequestMapping("/path")
  { framework: 'Spring', pattern: /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g },
  // Gin (Go): r.GET("/path", handler)
  { framework: 'Gin', pattern: /\.\s*(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)/g },
];

// ─── Middleware Detection ───────────────────────────────────────────────────

const MIDDLEWARE_PATTERNS = [
  // Express app.use(middleware)
  /app\.use\s*\(\s*(\w+(?:\.\w+)?)/g,
  // Express app.use('/path', middleware)
  /app\.use\s*\(\s*['"][^'"]+['"]\s*,\s*(\w+(?:\.\w+)?)/g,
];

// ─── Execution Graph ────────────────────────────────────────────────────────

export class ExecutionGraph {
  constructor() {
    this._routes = [];        // { method, path, handler, file, line, framework, middleware? }
    this._middleware = [];    // { name, file, line, path? }
    this._callChains = [];    // { route, chain: [handler1, handler2, ...] }
    this._projectPath = null;
    this._buildTime = 0;
    this._building = false;
  }

  /**
   * Build execution graph from project.
   *
   * @param {string} projectPath
   * @param {Object} [opts]
   * @param {number} [opts.maxFiles=5000]
   * @returns {Promise<{routeCount: number, middlewareCount: number, buildTime: number}>}
   */
  async buildFromProject(projectPath, opts = {}) {
    if (this._building) {
      return { routeCount: this._routes.length, middlewareCount: this._middleware.length, buildTime: this._buildTime };
    }

    this._building = true;
    this._projectPath = projectPath;
    const start = Date.now();

    try {
      this._routes = [];
      this._middleware = [];
      this._callChains = [];

      const files = await collectCodeFiles(projectPath, opts.maxFiles || 5000);

      for (const relPath of files) {
        const absPath = path.join(projectPath, relPath);
        let content;
        try {
          content = await readFile(absPath, 'utf8');
          if (content.length > 1_048_576) continue;
        } catch { continue; }

        const lines = content.split('\n');

        // Detect routes
        for (const rp of ROUTE_PATTERNS) {
          const regex = new RegExp(rp.pattern.source, rp.pattern.flags);
          let match;
          while ((match = regex.exec(content)) !== null) {
            const route = parseRouteMatch(match, rp.framework, content, relPath, lines);
            if (route) this._routes.push(route);
          }
        }

        // Detect middleware
        for (const mp of MIDDLEWARE_PATTERNS) {
          const regex = new RegExp(mp.source, mp.flags);
          let match;
          while ((match = regex.exec(content)) !== null) {
            const lineNum = content.substring(0, match.index).split('\n').length;
            this._middleware.push({
              name: match[1],
              file: relPath,
              line: lineNum,
            });
          }
        }
      }

      this._buildTime = Date.now() - start;

      logger.info('ExecutionGraph', `Built: ${this._routes.length} routes, ${this._middleware.length} middleware (${this._buildTime}ms)`);

      return {
        routeCount: this._routes.length,
        middlewareCount: this._middleware.length,
        buildTime: this._buildTime,
      };
    } finally {
      this._building = false;
    }
  }

  /**
   * Trace execution path for a given HTTP request.
   *
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} urlPath - URL path (e.g., '/api/users')
   * @returns {{ route: Object|null, middleware: Object[], chain: string[] }}
   */
  traceRequest(method, urlPath) {
    // Find matching route
    const route = this._routes.find(r => {
      if (r.method && r.method.toUpperCase() !== method.toUpperCase() && r.method !== 'all' && r.method !== 'use') {
        return false;
      }
      return matchPath(r.path, urlPath);
    });

    // Find applicable middleware (path prefix match or global)
    const mw = this._middleware.filter(m => {
      if (!m.path) return true; // global middleware
      return urlPath.startsWith(m.path);
    });

    // Build execution chain
    const chain = [];
    for (const m of mw) chain.push(`[middleware] ${m.name}`);
    if (route) {
      chain.push(`[route] ${route.method.toUpperCase()} ${route.path}`);
      if (route.handler) chain.push(`[handler] ${route.handler}`);
    }

    return { route: route || null, middleware: mw, chain };
  }

  /**
   * Get all routes.
   */
  getRoutes() {
    return [...this._routes];
  }

  /**
   * Get all middleware.
   */
  getMiddleware() {
    return [...this._middleware];
  }

  /**
   * Parse a stack trace and map to code locations.
   *
   * @param {string} stackTrace - Raw stack trace text
   * @returns {Array<{function: string, file: string, line: number}>}
   */
  parseStackTrace(stackTrace) {
    const frames = [];
    const lines = stackTrace.split('\n');

    for (const line of lines) {
      // Java: at package.Class.method(File.java:line) — check BEFORE Node.js (more specific)
      const javaMatch = line.match(/at\s+([\w$.]+)\((\w+\.java):(\d+)\)/);
      if (javaMatch) {
        frames.push({
          function: javaMatch[1],
          file: javaMatch[2],
          line: parseInt(javaMatch[3], 10),
        });
        continue;
      }

      // Node.js: at functionName (file:line:col)
      const nodeMatch = line.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+)(?::\d+)?\)?/);
      if (nodeMatch) {
        frames.push({
          function: nodeMatch[1] || '<anonymous>',
          file: nodeMatch[2],
          line: parseInt(nodeMatch[3], 10),
        });
        continue;
      }

      // Python: File "file", line N, in function
      const pyMatch = line.match(/File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(\w+))?/);
      if (pyMatch) {
        frames.push({
          function: pyMatch[3] || '<module>',
          file: pyMatch[1],
          line: parseInt(pyMatch[2], 10),
        });
      }
    }

    return frames;
  }

  /**
   * Get statistics.
   */
  getStats() {
    const frameworkCounts = {};
    for (const r of this._routes) {
      frameworkCounts[r.framework] = (frameworkCounts[r.framework] || 0) + 1;
    }

    return {
      routeCount: this._routes.length,
      middlewareCount: this._middleware.length,
      frameworks: frameworkCounts,
      buildTime: this._buildTime,
      projectPath: this._projectPath,
    };
  }

  /**
   * Clear the execution graph.
   */
  clear() {
    this._routes = [];
    this._middleware = [];
    this._callChains = [];
    this._projectPath = null;
    this._buildTime = 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseRouteMatch(match, framework, content, file, lines) {
  let method, routePath, handler;

  switch (framework) {
    case 'Express':
    case 'Fastify':
      method = match[1];
      routePath = match[2];
      handler = match[3] || null;
      break;
    case 'Flask':
      routePath = match[1];
      method = match[2] || 'GET';
      handler = null;
      break;
    case 'FastAPI':
      method = match[1];
      routePath = match[2];
      handler = null;
      break;
    case 'Spring':
      routePath = match[1];
      method = match[0].includes('Get') ? 'GET' :
               match[0].includes('Post') ? 'POST' :
               match[0].includes('Put') ? 'PUT' :
               match[0].includes('Delete') ? 'DELETE' : 'ALL';
      handler = null;
      break;
    case 'Gin':
      method = match[1];
      routePath = match[2];
      handler = match[3] || null;
      break;
    default:
      return null;
  }

  if (!routePath) return null;

  const lineNum = content.substring(0, match.index).split('\n').length;

  return { method, path: routePath, handler, file, line: lineNum, framework };
}

function matchPath(routePath, urlPath) {
  // Simple path matching (supports :param and *)
  const routeParts = routePath.split('/');
  const urlParts = urlPath.split('/');

  if (routePath.includes('*')) {
    // Wildcard: check prefix
    const prefix = routePath.split('*')[0];
    return urlPath.startsWith(prefix);
  }

  if (routeParts.length !== urlParts.length) return false;

  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) continue; // param matches anything
    if (routeParts[i] !== urlParts[i]) return false;
  }

  return true;
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const executionGraph = new ExecutionGraph();

export default { ExecutionGraph, executionGraph };
