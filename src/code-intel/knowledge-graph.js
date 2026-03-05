// Knowledge Graph v1 — Unified project graph (symbols, files, imports, calls)
// ══════════════════════════════════════════════════════════════════════════════
//
// Single graph with multiple edge types (NOT separate indexes).
//
// Node types: file, function, class, method, variable, constant, module, interface, enum
// Edge types: imports, calls, defines, extends, implements, references, tested_by, belongs_to
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { collectCodeFiles, extractFileSymbols, findReferencesInFile } from './index-builder.js';
import { extractImports } from './context-builder.js';
import { detectLanguage } from './code-analyzer.js';
import { readFile } from 'fs/promises';
import path from 'path';

// ─── Constants ──────────────────────────────────────────────────────────────

export const NodeType = {
  FILE: 'file',
  FUNCTION: 'function',
  CLASS: 'class',
  METHOD: 'method',
  VARIABLE: 'variable',
  CONSTANT: 'constant',
  MODULE: 'module',
  INTERFACE: 'interface',
  ENUM: 'enum',
};

export const EdgeType = {
  IMPORTS: 'imports',
  CALLS: 'calls',
  DEFINES: 'defines',
  EXTENDS: 'extends',
  IMPLEMENTS: 'implements',
  REFERENCES: 'references',
  TESTED_BY: 'tested_by',
  BELONGS_TO: 'belongs_to',
};

// ─── Node ID Helpers ────────────────────────────────────────────────────────

export function fileNodeId(relPath) { return `file:${relPath}`; }
export function symbolNodeId(name, file) { return `sym:${name}@${file}`; }
export function moduleNodeId(name) { return `mod:${name}`; }

// ─── Knowledge Graph ────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 1_048_576;
const TEST_DIR_RE = /(?:^|[/\\])(test|tests|__tests__|spec)[/\\]/;

export class KnowledgeGraph {
  constructor() {
    this._nodes = new Map();     // id → { id, type, name, file?, line?, metadata? }
    this._edges = [];            // [{ type, from, to, metadata? }]
    this._adjacency = new Map(); // nodeId → [{ edge, target }] (outgoing)
    this._reverse = new Map();   // nodeId → [{ edge, source }] (incoming)
    this._fileIndex = new Map(); // relPath → Set<nodeId> — O(1) file→nodes lookup
    this._projectPath = null;
    this._buildTime = 0;
    this._building = false;
    this._buildPromise = null;   // mutex for lazy build (prevents double concurrent builds)
  }

  // ─── Core Operations ────────────────────────────────────────────────

  addNode(id, type, metadata = {}) {
    if (this._nodes.has(id)) return;
    this._nodes.set(id, { id, type, name: metadata.name || id, ...metadata });
    if (!this._adjacency.has(id)) this._adjacency.set(id, []);
    if (!this._reverse.has(id)) this._reverse.set(id, []);

    // Track in _fileIndex for O(1) file→nodes lookup
    const file = metadata.file || (type === NodeType.FILE ? metadata.name : null);
    if (file) {
      let set = this._fileIndex.get(file);
      if (!set) { set = new Set(); this._fileIndex.set(file, set); }
      set.add(id);
    }
  }

  addEdge(type, from, to, metadata = {}) {
    const edge = { type, from, to, ...metadata };
    this._edges.push(edge);

    const adj = this._adjacency.get(from);
    if (adj) adj.push({ edge, target: to });
    else this._adjacency.set(from, [{ edge, target: to }]);

    const rev = this._reverse.get(to);
    if (rev) rev.push({ edge, source: from });
    else this._reverse.set(to, [{ edge, source: from }]);
  }

  getNode(id) {
    return this._nodes.get(id) || null;
  }

  getEdges(nodeId, edgeType = null) {
    const adj = this._adjacency.get(nodeId) || [];
    if (!edgeType) return adj;
    return adj.filter(a => a.edge.type === edgeType);
  }

  getIncoming(nodeId, edgeType = null) {
    const rev = this._reverse.get(nodeId) || [];
    if (!edgeType) return rev;
    return rev.filter(r => r.edge.type === edgeType);
  }

  // ─── Query API ──────────────────────────────────────────────────────

  getCallers(symbolName) {
    // Find all nodes with this symbol name
    const results = [];
    for (const [id, node] of this._nodes) {
      if (node.name === symbolName || id.startsWith(`sym:${symbolName}@`)) {
        const incoming = this.getIncoming(id, EdgeType.CALLS);
        for (const { source } of incoming) {
          const srcNode = this.getNode(source);
          if (srcNode) results.push(srcNode);
        }
        const refsIncoming = this.getIncoming(id, EdgeType.REFERENCES);
        for (const { source } of refsIncoming) {
          const srcNode = this.getNode(source);
          if (srcNode) results.push(srcNode);
        }
      }
    }
    return results;
  }

  getCallees(symbolName) {
    const results = [];
    for (const [id, node] of this._nodes) {
      if (node.name === symbolName || id.startsWith(`sym:${symbolName}@`)) {
        const outgoing = this.getEdges(id, EdgeType.CALLS);
        for (const { target } of outgoing) {
          const tgtNode = this.getNode(target);
          if (tgtNode) results.push(tgtNode);
        }
      }
    }
    return results;
  }

  getDependencies(fileId) {
    const id = fileId.startsWith('file:') ? fileId : fileNodeId(fileId);
    return this.getEdges(id, EdgeType.IMPORTS).map(a => this.getNode(a.target)).filter(Boolean);
  }

  getDependents(fileId) {
    const id = fileId.startsWith('file:') ? fileId : fileNodeId(fileId);
    return this.getIncoming(id, EdgeType.IMPORTS).map(r => this.getNode(r.source)).filter(Boolean);
  }

  findPath(fromId, toId, maxDepth = 10) {
    if (fromId === toId) return [fromId];

    const visited = new Set([fromId]);
    const queue = [{ nodeId: fromId, path: [fromId] }];
    let steps = 0;
    const maxVisited = 500;

    while (queue.length > 0 && steps < maxVisited) {
      const { nodeId, path: curPath } = queue.shift();
      steps++;

      if (curPath.length > maxDepth) continue;

      const adj = this._adjacency.get(nodeId) || [];
      for (const { target } of adj) {
        if (target === toId) return [...curPath, target];
        if (!visited.has(target)) {
          visited.add(target);
          queue.push({ nodeId: target, path: [...curPath, target] });
        }
      }
    }

    return null;
  }

  getSubgraph(nodeId, depth = 2) {
    const visited = new Set([nodeId]);
    const queue = [{ id: nodeId, d: 0 }];
    const nodes = [];
    const edges = [];

    while (queue.length > 0) {
      const { id, d } = queue.shift();
      const node = this.getNode(id);
      if (node) nodes.push(node);

      if (d >= depth) continue;

      const adj = this._adjacency.get(id) || [];
      for (const { edge, target } of adj) {
        edges.push(edge);
        if (!visited.has(target)) {
          visited.add(target);
          queue.push({ id: target, d: d + 1 });
        }
      }

      const rev = this._reverse.get(id) || [];
      for (const { edge, source } of rev) {
        edges.push(edge);
        if (!visited.has(source)) {
          visited.add(source);
          queue.push({ id: source, d: d + 1 });
        }
      }
    }

    return { nodes, edges };
  }

  getFileSymbols(fileId) {
    const id = fileId.startsWith('file:') ? fileId : fileNodeId(fileId);
    return this.getEdges(id, EdgeType.DEFINES).map(a => this.getNode(a.target)).filter(Boolean);
  }

  // ─── Incremental Update ────────────────────────────────────────────

  /**
   * Remove all nodes and edges belonging to a file.
   *
   * @param {string} relPath
   */
  removeFile(relPath) {
    // Collect all node IDs belonging to this file
    const nodeIds = new Set();
    const indexSet = this._fileIndex.get(relPath);
    if (indexSet) for (const id of indexSet) nodeIds.add(id);
    const fid = fileNodeId(relPath);
    nodeIds.add(fid);

    if (nodeIds.size === 0 || (nodeIds.size === 1 && !this._nodes.has(fid))) return;

    // Remove nodes
    for (const id of nodeIds) this._nodes.delete(id);

    // Remove adjacency/reverse for removed nodes
    for (const id of nodeIds) {
      this._adjacency.delete(id);
      this._reverse.delete(id);
    }

    // Filter edges
    this._edges = this._edges.filter(e => !nodeIds.has(e.from) && !nodeIds.has(e.to));

    // Robust cross-ref cleanup: clean remaining adjacency/reverse entries
    for (const [, arr] of this._adjacency) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (nodeIds.has(arr[i].target)) arr.splice(i, 1);
      }
    }
    for (const [, arr] of this._reverse) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (nodeIds.has(arr[i].source)) arr.splice(i, 1);
      }
    }

    // Remove from _fileIndex
    this._fileIndex.delete(relPath);
  }

  /**
   * Reindex a single file (incremental update without full rebuild).
   * Does NOT rebuild cross-file REFERENCES edges (O(project) cost).
   *
   * @param {string} relPath
   * @param {string} [content] - File content (read from disk if not provided)
   * @returns {Promise<{nodesAdded: number, edgesAdded: number}>}
   */
  async reindexFile(relPath, content) {
    if (this._building) return { nodesAdded: 0, edgesAdded: 0 };

    this.removeFile(relPath);

    if (!content && this._projectPath) {
      try {
        content = await readFile(path.join(this._projectPath, relPath), 'utf8');
      } catch { /* file may have been deleted */ }
    }

    if (!content) return { nodesAdded: 0, edgesAdded: 0 };
    if (content.length > MAX_FILE_SIZE) return { nodesAdded: 0, edgesAdded: 0 };

    const knownFiles = [...this._fileIndex.keys()];
    return await this._indexSingleFile(relPath, content, knownFiles);
  }

  /**
   * Validate graph integrity (test/debug only — not for production paths).
   *
   * @returns {{valid: boolean, orphanedEdges: number, details: Array}}
   */
  validateGraph() {
    const details = [];
    for (let i = 0; i < this._edges.length; i++) {
      const edge = this._edges[i];
      if (!this._nodes.has(edge.from)) {
        details.push({ index: i, edge, reason: `from node missing: ${edge.from}` });
      }
      if (!this._nodes.has(edge.to)) {
        details.push({ index: i, edge, reason: `to node missing: ${edge.to}` });
      }
    }
    return {
      valid: details.length === 0,
      orphanedEdges: details.length,
      details,
    };
  }

  // ─── Build from Project ─────────────────────────────────────────────

  async buildFromProject(projectPath, opts = {}) {
    if (this._building) {
      if (this._buildPromise) return this._buildPromise;
      return { nodeCount: this._nodes.size, edgeCount: this._edges.length, buildTime: this._buildTime };
    }

    this._building = true;
    this._buildPromise = this._doBuild(projectPath, opts).finally(() => {
      this._building = false;
      this._buildPromise = null;
    });
    return this._buildPromise;
  }

  async _doBuild(projectPath, opts = {}) {
    const start = Date.now();
    this.clear();
    this._projectPath = projectPath;

    // Step 1: Collect files
    const files = await collectCodeFiles(projectPath, opts.maxFiles || 5000);

    // Step 2: Add file nodes, read content
    const fileContents = new Map(); // relPath → content
    for (const relPath of files) {
      const fid = fileNodeId(relPath);
      this.addNode(fid, NodeType.FILE, { name: relPath, file: relPath });

      const absPath = path.join(projectPath, relPath);
      try {
        const content = await readFile(absPath, 'utf8');
        if (content.length <= MAX_FILE_SIZE) fileContents.set(relPath, content);
      } catch { /* skip */ }
    }

    // Step 3: Index each file (symbols, imports, extends/implements)
    const allSymbolNames = [];
    for (const [relPath, content] of fileContents) {
      const result = await this._indexSingleFile(relPath, content, files);
      // Collect symbol names for REFERENCES pass
      const fid = fileNodeId(relPath);
      const defined = this.getEdges(fid, EdgeType.DEFINES);
      for (const { target } of defined) {
        const node = this.getNode(target);
        if (node) allSymbolNames.push({ name: node.name, file: relPath });
      }
    }

    // Step 4: Build REFERENCES edges (capped at 50 symbols)
    const symbolsToScan = allSymbolNames.slice(0, 50);
    for (const { name, file: defFile } of symbolsToScan) {
      for (const [relPath] of fileContents) {
        if (relPath === defFile) continue;
        try {
          const refs = await findReferencesInFile(projectPath, relPath, name);
          if (refs.length > 0) {
            const fromFid = fileNodeId(relPath);
            const toSid = symbolNodeId(name, defFile);
            if (this._nodes.has(toSid)) {
              this.addEdge(EdgeType.REFERENCES, fromFid, toSid);
            }
          }
        } catch { /* skip */ }
      }
    }

    // Step 5: Test relationships
    for (const relPath of files) {
      if (!TEST_DIR_RE.test(relPath)) continue;
      const content = fileContents.get(relPath);
      if (!content) continue;

      const language = detectLanguage(relPath);
      const imports = extractImports(content, language);
      for (const imp of imports) {
        const resolved = resolveImport(relPath, imp, files);
        if (resolved && !TEST_DIR_RE.test(resolved)) {
          const testFid = fileNodeId(relPath);
          const srcFid = fileNodeId(resolved);
          this.addEdge(EdgeType.TESTED_BY, srcFid, testFid);
        }
      }
    }

    this._buildTime = Date.now() - start;

    const stats = this.getStats();
    logger.info('KnowledgeGraph', `Graph built: ${stats.nodeCount} nodes, ${stats.edgeCount} edges (${this._buildTime}ms)`);

    return { nodeCount: stats.nodeCount, edgeCount: stats.edgeCount, buildTime: this._buildTime };
  }

  /**
   * Index a single file: symbols, imports, extends/implements.
   * Shared by buildFromProject() and reindexFile().
   *
   * @param {string} relPath
   * @param {string} content
   * @param {string[]} knownFiles - All known file paths for import resolution
   * @returns {Promise<{nodesAdded: number, edgesAdded: number}>}
   */
  async _indexSingleFile(relPath, content, knownFiles) {
    let nodesAdded = 0;
    let edgesAdded = 0;

    const fid = fileNodeId(relPath);
    if (!this._nodes.has(fid)) {
      this.addNode(fid, NodeType.FILE, { name: relPath, file: relPath });
      nodesAdded++;
    }

    // Extract symbols
    try {
      const symbols = await extractFileSymbols(this._projectPath, relPath);
      for (const sym of symbols) {
        const sid = symbolNodeId(sym.name, relPath);
        this.addNode(sid, sym.type || NodeType.FUNCTION, {
          name: sym.name,
          file: relPath,
          line: sym.line,
          exported: sym.exported,
          params: sym.params,
        });
        this.addEdge(EdgeType.DEFINES, fid, sid);
        nodesAdded++;
        edgesAdded++;
      }
    } catch { /* skip */ }

    // Extract imports → IMPORTS edges
    const language = detectLanguage(relPath);
    const imports = extractImports(content, language);
    for (const imp of imports) {
      const resolved = resolveImport(relPath, imp, knownFiles);
      if (resolved) {
        const targetFid = fileNodeId(resolved);
        if (!this._nodes.has(targetFid)) {
          this.addNode(targetFid, NodeType.FILE, { name: resolved, file: resolved });
          nodesAdded++;
        }
        this.addEdge(EdgeType.IMPORTS, fid, targetFid);
        edgesAdded++;
      } else if (!imp.startsWith('.') && !imp.startsWith('/')) {
        const mid = moduleNodeId(imp);
        if (!this._nodes.has(mid)) {
          this.addNode(mid, NodeType.MODULE, { name: imp });
          nodesAdded++;
        }
        this.addEdge(EdgeType.IMPORTS, fid, mid);
        edgesAdded++;
      }
    }

    // Detect extends/implements
    const extendsMatches = content.matchAll(/class\s+(\w+)\s+extends\s+(\w+)/g);
    for (const m of extendsMatches) {
      const childSid = symbolNodeId(m[1], relPath);
      const parentSid = findSymbolNode(this._nodes, m[2]);
      if (parentSid) {
        this.addEdge(EdgeType.EXTENDS, childSid, parentSid);
        edgesAdded++;
      }
    }

    const implMatches = content.matchAll(/class\s+(\w+).*?implements\s+([\w,\s]+)/g);
    for (const m of implMatches) {
      const childSid = symbolNodeId(m[1], relPath);
      const ifaces = m[2].split(',').map(s => s.trim()).filter(Boolean);
      for (const iface of ifaces) {
        const ifaceSid = findSymbolNode(this._nodes, iface);
        if (ifaceSid) {
          this.addEdge(EdgeType.IMPLEMENTS, childSid, ifaceSid);
          edgesAdded++;
        }
      }
    }

    return { nodesAdded, edgesAdded };
  }

  // ─── Stats & Clear ──────────────────────────────────────────────────

  getStats() {
    const nodesByType = {};
    for (const [, node] of this._nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    const edgesByType = {};
    for (const edge of this._edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    return {
      nodeCount: this._nodes.size,
      edgeCount: this._edges.length,
      nodesByType,
      edgesByType,
      buildTime: this._buildTime,
      projectPath: this._projectPath,
    };
  }

  clear() {
    this._nodes.clear();
    this._edges = [];
    this._adjacency.clear();
    this._reverse.clear();
    this._fileIndex.clear();
    this._projectPath = null;
    this._buildTime = 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveImport(fromFile, importPath, knownFiles) {
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) return null;

  const fromDir = path.dirname(fromFile);
  const resolved = path.posix.normalize(path.posix.join(fromDir, importPath));

  // Try exact match, then with extensions, then with /index
  const candidates = [
    resolved,
    resolved + '.js', resolved + '.ts', resolved + '.jsx', resolved + '.tsx',
    resolved + '.mjs', resolved + '.cjs',
    resolved + '/index.js', resolved + '/index.ts',
  ];

  const fileSet = new Set(knownFiles);
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }

  return null;
}

function findSymbolNode(nodes, name) {
  for (const [id, node] of nodes) {
    if (node.name === name && id.startsWith('sym:')) return id;
  }
  return null;
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const knowledgeGraph = new KnowledgeGraph();

export default { KnowledgeGraph, knowledgeGraph, NodeType, EdgeType, fileNodeId, symbolNodeId, moduleNodeId };
