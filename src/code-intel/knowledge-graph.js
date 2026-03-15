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
    this._nodes = new Map();       // id → { id, type, name, file?, line?, metadata? }
    this._edges = new Map();       // edgeId → { id, type, from, to, metadata? }
    this._edgeCounter = 0;
    this._edgesByType = new Map(); // edgeType → Set<edgeId> — type index for fast filtering
    this._adjacency = new Map();   // nodeId → [{ edgeId, target }] (outgoing, lighter entries)
    this._reverse = new Map();     // nodeId → [{ edgeId, source }] (incoming, lighter entries)
    this._fileIndex = new Map();   // relPath → Set<nodeId> — O(1) file→nodes lookup
    this._moduleIndex = new Map(); // modulePath → Set<relPath> — module-level grouping
    this._moduleDepCache = null;   // Map<modulePath, {deps}> — invalidated on reindex/remove
    this._projectPath = null;
    this._buildTime = 0;
    this._building = false;
    this._buildPromise = null;     // mutex for lazy build (prevents double concurrent builds)
  }

  // ─── Core Operations ────────────────────────────────────────────────

  addNode(id, type, metadata = {}) {
    if (this._nodes.has(id)) return;
    // v124: Memory ceiling — prevent unbounded growth
    if (this._nodes.size >= 50_000) {
      logger.warn('KG', 'Node limit reached (50K)');
      return;
    }
    this._nodes.set(id, { id, type, name: metadata.name || id, ...metadata });
    if (!this._adjacency.has(id)) this._adjacency.set(id, []);
    if (!this._reverse.has(id)) this._reverse.set(id, []);

    // Track in _fileIndex for O(1) file→nodes lookup
    const file = metadata.file || (type === NodeType.FILE ? metadata.name : null);
    if (file) {
      let set = this._fileIndex.get(file);
      if (!set) { set = new Set(); this._fileIndex.set(file, set); }
      set.add(id);

      // Track in _moduleIndex for module-level queries
      const mod = _computeModuleForFile(file);
      if (mod) {
        let modSet = this._moduleIndex.get(mod);
        if (!modSet) { modSet = new Set(); this._moduleIndex.set(mod, modSet); }
        modSet.add(file);
      }
    }
  }

  addEdge(type, from, to, metadata = {}) {
    if (!this._nodes.has(from) || !this._nodes.has(to)) return null;
    // v124: Memory ceiling — prevent unbounded edge growth
    if (this._edges.size >= 100_000) {
      logger.warn('KG', 'Edge limit reached (100K)');
      return null;
    }
    const id = ++this._edgeCounter;
    const edge = { id, type, from, to, ...metadata };
    this._edges.set(id, edge);

    // Type index
    let typeSet = this._edgesByType.get(type);
    if (!typeSet) { typeSet = new Set(); this._edgesByType.set(type, typeSet); }
    typeSet.add(id);

    // Adjacency (lighter entries — edge fetched from Map when needed)
    const adj = this._adjacency.get(from);
    if (adj) adj.push({ edgeId: id, target: to });
    else this._adjacency.set(from, [{ edgeId: id, target: to }]);

    const rev = this._reverse.get(to);
    if (rev) rev.push({ edgeId: id, source: from });
    else this._reverse.set(to, [{ edgeId: id, source: from }]);

    return id;
  }

  getNode(id) {
    return this._nodes.get(id) || null;
  }

  getEdges(nodeId, edgeType = null) {
    const adj = this._adjacency.get(nodeId) || [];
    if (!edgeType) {
      return adj.map(a => ({ edge: this._edges.get(a.edgeId), target: a.target }));
    }
    const result = [];
    for (const a of adj) {
      const edge = this._edges.get(a.edgeId);
      if (edge && edge.type === edgeType) result.push({ edge, target: a.target });
    }
    return result;
  }

  getIncoming(nodeId, edgeType = null) {
    const rev = this._reverse.get(nodeId) || [];
    if (!edgeType) {
      return rev.map(r => ({ edge: this._edges.get(r.edgeId), source: r.source }));
    }
    const result = [];
    for (const r of rev) {
      const edge = this._edges.get(r.edgeId);
      if (edge && edge.type === edgeType) result.push({ edge, source: r.source });
    }
    return result;
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
      for (const a of adj) {
        const edge = this._edges.get(a.edgeId);
        if (edge) edges.push(edge);
        if (!visited.has(a.target)) {
          visited.add(a.target);
          queue.push({ id: a.target, d: d + 1 });
        }
      }

      const rev = this._reverse.get(id) || [];
      for (const r of rev) {
        const edge = this._edges.get(r.edgeId);
        if (edge) edges.push(edge);
        if (!visited.has(r.source)) {
          visited.add(r.source);
          queue.push({ id: r.source, d: d + 1 });
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

    // Collect edgeIds touching removed nodes + counterpart nodes to clean
    const edgeIdsToRemove = new Set();
    const counterpartCleanup = new Map(); // survivingNodeId → Set<edgeId>

    for (const id of nodeIds) {
      const adj = this._adjacency.get(id) || [];
      for (const a of adj) {
        edgeIdsToRemove.add(a.edgeId);
        if (!nodeIds.has(a.target)) {
          let set = counterpartCleanup.get(a.target);
          if (!set) { set = new Set(); counterpartCleanup.set(a.target, set); }
          set.add(a.edgeId);
        }
      }
      const rev = this._reverse.get(id) || [];
      for (const r of rev) {
        edgeIdsToRemove.add(r.edgeId);
        if (!nodeIds.has(r.source)) {
          let set = counterpartCleanup.get(r.source);
          if (!set) { set = new Set(); counterpartCleanup.set(r.source, set); }
          set.add(r.edgeId);
        }
      }
    }

    // Remove nodes + their adjacency/reverse
    for (const id of nodeIds) {
      this._nodes.delete(id);
      this._adjacency.delete(id);
      this._reverse.delete(id);
    }

    // Remove edges from Map + type index (O(1) per edge)
    for (const edgeId of edgeIdsToRemove) {
      const edge = this._edges.get(edgeId);
      if (edge) {
        const typeSet = this._edgesByType.get(edge.type);
        if (typeSet) typeSet.delete(edgeId);
      }
      this._edges.delete(edgeId);
    }

    // Clean counterpart adjacency/reverse (splice only matching edgeIds)
    for (const [nodeId, edgeIds] of counterpartCleanup) {
      const adj = this._adjacency.get(nodeId);
      if (adj) {
        for (let i = adj.length - 1; i >= 0; i--) {
          if (edgeIds.has(adj[i].edgeId)) adj.splice(i, 1);
        }
      }
      const rev = this._reverse.get(nodeId);
      if (rev) {
        for (let i = rev.length - 1; i >= 0; i--) {
          if (edgeIds.has(rev[i].edgeId)) rev.splice(i, 1);
        }
      }
    }

    // Remove from _fileIndex
    this._fileIndex.delete(relPath);

    // Remove from _moduleIndex + invalidate cache
    const mod = _computeModuleForFile(relPath);
    if (mod) {
      const modSet = this._moduleIndex.get(mod);
      if (modSet) {
        modSet.delete(relPath);
        if (modSet.size === 0) this._moduleIndex.delete(mod);
      }
    }
    this._moduleDepCache = null;
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
    for (const [edgeId, edge] of this._edges) {
      if (!this._nodes.has(edge.from)) {
        details.push({ edgeId, edge, reason: `from node missing: ${edge.from}` });
      }
      if (!this._nodes.has(edge.to)) {
        details.push({ edgeId, edge, reason: `to node missing: ${edge.to}` });
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
      return { nodeCount: this._nodes.size, edgeCount: this._edges.size, buildTime: this._buildTime };
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

  // ─── Module-Level Queries ──────────────────────────────────────────

  /** @returns {string[]} All module paths */
  getModules() {
    this._ensureModuleIndex();
    return [...this._moduleIndex.keys()];
  }

  /** @returns {string[]} File paths in a module */
  getModuleFiles(modulePath) {
    this._ensureModuleIndex();
    const set = this._moduleIndex.get(modulePath);
    return set ? [...set] : [];
  }

  /**
   * Get cross-module dependencies for a module.
   * Cached — invalidated on reindex/remove.
   *
   * @param {string} modulePath
   * @returns {{module: string, count: number}[]}
   */
  getModuleDependencies(modulePath) {
    // Cache check
    if (this._moduleDepCache?.has(modulePath)) {
      return this._moduleDepCache.get(modulePath);
    }

    this._ensureModuleIndex();
    const files = this._moduleIndex.get(modulePath);
    if (!files || files.size === 0) return [];

    const depCounts = new Map(); // targetModule → count
    for (const relPath of files) {
      const deps = this.getDependencies(relPath);
      for (const dep of deps) {
        const depFile = dep.file || dep.name;
        if (!depFile) continue;
        const depMod = _computeModuleForFile(depFile);
        if (depMod && depMod !== modulePath) {
          depCounts.set(depMod, (depCounts.get(depMod) || 0) + 1);
        }
      }
    }

    const result = [...depCounts.entries()]
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count);

    // Cache
    if (!this._moduleDepCache) this._moduleDepCache = new Map();
    this._moduleDepCache.set(modulePath, result);
    return result;
  }

  /** Get file-level dependencies (alias for getDependencies, clarity API) */
  getFileDependencies(fileId) {
    return this.getDependencies(fileId);
  }

  /** Get symbol-level dependencies (callers + callees) */
  getSymbolDependencies(symbolName) {
    return { callers: this.getCallers(symbolName), callees: this.getCallees(symbolName) };
  }

  /** Lazy-fill _moduleIndex from _fileIndex if empty */
  _ensureModuleIndex() {
    if (this._moduleIndex.size > 0) return;
    for (const relPath of this._fileIndex.keys()) {
      const mod = _computeModuleForFile(relPath);
      if (mod) {
        let set = this._moduleIndex.get(mod);
        if (!set) { set = new Set(); this._moduleIndex.set(mod, set); }
        set.add(relPath);
      }
    }
  }

  // ─── Stats & Clear ──────────────────────────────────────────────────

  getStats() {
    const nodesByType = {};
    for (const [, node] of this._nodes) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    const edgesByType = {};
    for (const edge of this._edges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    return {
      nodeCount: this._nodes.size,
      edgeCount: this._edges.size,
      nodesByType,
      edgesByType,
      buildTime: this._buildTime,
      projectPath: this._projectPath,
    };
  }

  clear() {
    this._nodes.clear();
    this._edges = new Map();
    this._edgeCounter = 0;
    this._edgesByType.clear();
    this._adjacency.clear();
    this._reverse.clear();
    this._fileIndex.clear();
    this._moduleIndex.clear();
    this._moduleDepCache = null;
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

function _computeModuleForFile(relPath) {
  const parts = relPath.split('/');
  if (parts.length >= 2) return parts.slice(0, 2).join('/');
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
