// Project Symbol Index — In-memory symbol lookup (O(1))
// ══════════════════════════════════════════════════════════════════════════════
//
// Data model:
//   symbolsByName:  Map<string, Symbol[]>     name → all definitions
//   symbolsByFile:  Map<string, Symbol[]>     file → all symbols in file
//   references:     Map<string, Reference[]>  symbolName → usage locations
//   imports:        Map<string, string[]>     file → imported module paths
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { collectCodeFiles, extractFileSymbols, findReferencesInFile } from './index-builder.js';
import { knowledgeGraph } from './knowledge-graph.js';

export class SymbolIndex {
  constructor() {
    this.symbolsByName = new Map();   // name → Symbol[]
    this.symbolsByFile = new Map();   // file → Symbol[]
    this.references = new Map();      // symbolName → Reference[]
    this.fileCount = 0;
    this.symbolCount = 0;
    this.buildTime = 0;
    this._projectPath = null;
    this._building = false;
  }

  // ─── Build Index ─────────────────────────────────────────────────────

  /**
   * Build full project index (background-safe).
   *
   * @param {string} projectPath
   * @param {Object} [opts]
   * @param {number} [opts.maxFiles=5000]
   * @returns {Promise<{fileCount: number, symbolCount: number, buildTime: number}>}
   */
  async buildIndex(projectPath, opts = {}) {
    if (this._building) {
      logger.warn('SymbolIndex', 'Build already in progress');
      return { fileCount: this.fileCount, symbolCount: this.symbolCount, buildTime: this.buildTime };
    }

    this._building = true;
    this._projectPath = projectPath;
    const start = Date.now();

    try {
      // Clear existing data
      this.symbolsByName.clear();
      this.symbolsByFile.clear();
      this.references.clear();
      this.fileCount = 0;
      this.symbolCount = 0;

      // Collect files
      const files = await collectCodeFiles(projectPath, opts.maxFiles || 5000);
      this.fileCount = files.length;

      // Extract symbols from each file
      for (const file of files) {
        try {
          const symbols = await extractFileSymbols(projectPath, file);
          if (symbols.length > 0) {
            this.symbolsByFile.set(file, symbols);

            for (const sym of symbols) {
              const existing = this.symbolsByName.get(sym.name) || [];
              existing.push(sym);
              this.symbolsByName.set(sym.name, existing);
              this.symbolCount++;
            }
          }
        } catch (err) {
          logger.warn('SymbolIndex', `Failed to index ${file}: ${err.message}`);
        }
      }

      this.buildTime = Date.now() - start;

      logger.info('SymbolIndex', `Index built: ${this.symbolCount} symbols in ${this.fileCount} files (${this.buildTime}ms)`);

      return {
        fileCount: this.fileCount,
        symbolCount: this.symbolCount,
        buildTime: this.buildTime,
      };
    } finally {
      this._building = false;
    }
  }

  // ─── Incremental Update ──────────────────────────────────────────────

  /**
   * Reindex a single file (after modification).
   *
   * @param {string} filePath - Relative path
   */
  async reindexFile(filePath) {
    if (!this._projectPath) return;

    // Remove old symbols for this file
    const oldSymbols = this.symbolsByFile.get(filePath) || [];
    for (const sym of oldSymbols) {
      const nameEntries = this.symbolsByName.get(sym.name);
      if (nameEntries) {
        const filtered = nameEntries.filter(s => s.file !== filePath);
        if (filtered.length > 0) this.symbolsByName.set(sym.name, filtered);
        else this.symbolsByName.delete(sym.name);
        this.symbolCount--;
      }
    }
    this.symbolsByFile.delete(filePath);

    // Re-extract
    try {
      const symbols = await extractFileSymbols(this._projectPath, filePath);
      if (symbols.length > 0) {
        this.symbolsByFile.set(filePath, symbols);
        for (const sym of symbols) {
          const existing = this.symbolsByName.get(sym.name) || [];
          existing.push(sym);
          this.symbolsByName.set(sym.name, existing);
          this.symbolCount++;
        }
      }
    } catch (err) {
      logger.warn('SymbolIndex', `Reindex failed for ${filePath}: ${err.message}`);
    }

    // Trigger graph sync if graph is populated
    if (knowledgeGraph._nodes.size > 0) {
      try { await knowledgeGraph.reindexFile(filePath); }
      catch (err) { logger.warn('SymbolIndex', `Graph reindex failed: ${err.message}`); }
    }
  }

  // ─── Query API ───────────────────────────────────────────────────────

  /**
   * Find symbol by exact name. O(1).
   *
   * @param {string} name
   * @returns {Symbol[]|null}
   */
  findSymbol(name) {
    return this.symbolsByName.get(name) || null;
  }

  /**
   * Find symbols matching a prefix.
   *
   * @param {string} prefix
   * @param {number} [limit=20]
   * @returns {Symbol[]}
   */
  findByPrefix(prefix, limit = 20) {
    const results = [];
    const lowerPrefix = prefix.toLowerCase();

    for (const [name, symbols] of this.symbolsByName) {
      if (results.length >= limit) break;
      if (name.toLowerCase().startsWith(lowerPrefix)) {
        results.push(...symbols);
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Find symbols matching a fuzzy pattern.
   *
   * @param {string} query
   * @param {number} [limit=20]
   * @returns {Symbol[]}
   */
  fuzzyFind(query, limit = 20) {
    if (!query) return [];

    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [name, symbols] of this.symbolsByName) {
      if (results.length >= limit) break;
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push(...symbols);
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Find all references to a symbol across the project.
   * Lazily built: searches files on demand, then caches.
   *
   * @param {string} symbolName
   * @returns {Promise<Array<{file: string, line: number, context: string}>>}
   */
  async findReferences(symbolName) {
    // Check cache
    if (this.references.has(symbolName)) {
      return this.references.get(symbolName);
    }

    if (!this._projectPath) return [];

    // Search all indexed files for references
    const allRefs = [];
    for (const [file] of this.symbolsByFile) {
      const refs = await findReferencesInFile(this._projectPath, file, symbolName);
      allRefs.push(...refs);
    }

    this.references.set(symbolName, allRefs);
    return allRefs;
  }

  /**
   * Get all symbols in a specific file.
   *
   * @param {string} filePath - Relative path
   * @returns {Symbol[]}
   */
  getFileSymbols(filePath) {
    return this.symbolsByFile.get(filePath) || [];
  }

  /**
   * Get basic call graph for a function.
   * Returns callers and callees based on reference analysis.
   *
   * @param {string} functionName
   * @returns {Promise<{callers: string[], callees: string[]}>}
   */
  async getCallGraph(functionName) {
    const symbol = this.findSymbol(functionName);
    if (!symbol || symbol.length === 0) return { callers: [], callees: [] };

    // Find all files that reference this function
    const refs = await this.findReferences(functionName);

    // Callers: files (other than definition) that reference this function
    const defFiles = new Set(symbol.map(s => s.file));
    const callers = [...new Set(
      refs.filter(r => !defFiles.has(r.file)).map(r => r.file)
    )];

    // Callees: symbols defined in the same file(s) as this function
    // (rough heuristic — proper call chain needs AST)
    const callees = [];
    for (const defFile of defFiles) {
      const fileSymbols = this.getFileSymbols(defFile);
      for (const sym of fileSymbols) {
        if (sym.name !== functionName && sym.type === 'function') {
          callees.push(sym.name);
        }
      }
    }

    return { callers, callees };
  }

  /**
   * Get index statistics.
   */
  getStats() {
    return {
      projectPath: this._projectPath,
      fileCount: this.fileCount,
      symbolCount: this.symbolCount,
      buildTime: this.buildTime,
      uniqueNames: this.symbolsByName.size,
      building: this._building,
    };
  }

  /**
   * Clear the index.
   */
  clear() {
    this.symbolsByName.clear();
    this.symbolsByFile.clear();
    this.references.clear();
    this.fileCount = 0;
    this.symbolCount = 0;
    this.buildTime = 0;
    this._projectPath = null;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const symbolIndex = new SymbolIndex();

export default { SymbolIndex, symbolIndex };
