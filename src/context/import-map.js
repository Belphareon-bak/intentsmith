// Import Map v119 — KG-based import resolution hints for LLM prompts
// ══════════════════════════════════════════════════════════════════════════════
//
// Uses KnowledgeGraph IMPORTS and DEFINES edges to tell the LLM exactly
// where each symbol should be imported from. Prevents the #1 code gen error:
// wrong import paths (e.g. `import { getUser } from '@/services/user'`
// instead of the correct `'@/db/user-repo'`).
//
// Also detects symbol name conflicts (same name in multiple files) and
// formats warnings so the LLM picks the right one.
//
// ══════════════════════════════════════════════════════════════════════════════

import { EdgeType, NodeType, fileNodeId, symbolNodeId } from '../code-intel/knowledge-graph.js';

// ─── buildImportMap ─────────────────────────────────────────────────────────

/**
 * Build import resolution hints from the knowledge graph.
 *
 * For each target file, find all symbols it imports and resolve their
 * source file via KG IMPORTS edges. For symbols defined in target files,
 * resolve where they're exported from via DEFINES edges.
 *
 * @param {KnowledgeGraph} graph - Populated knowledge graph
 * @param {string[]} targetFiles - Relative file paths (scope files)
 * @returns {Array<{ symbol: string, exportedFrom: string, importAs?: string }>}
 */
export function buildImportMap(graph, targetFiles) {
  if (!graph || !targetFiles || targetFiles.length === 0) return [];

  const entries = [];
  const seen = new Set(); // avoid duplicate entries

  for (const file of targetFiles) {
    const fileId = file.startsWith('file:') ? file : fileNodeId(file);

    // Get IMPORTS edges from this file → find what files it depends on
    const imports = graph.getEdges(fileId, EdgeType.IMPORTS);
    if (!imports) continue;

    for (const { edge, target } of imports) {
      const targetNode = graph.getNode(target);
      if (!targetNode) continue;

      // target is a file node — extract the path
      const importedFile = _extractFilePath(targetNode);
      if (!importedFile) continue;

      // Find symbols defined in the imported file
      const definedSymbols = _getDefinedSymbols(graph, target);
      for (const sym of definedSymbols) {
        const key = `${sym}→${importedFile}`;
        if (seen.has(key)) continue;
        seen.add(key);

        entries.push({
          symbol: sym,
          exportedFrom: importedFile,
        });
      }
    }
  }

  return entries;
}

// ─── detectSymbolConflicts ──────────────────────────────────────────────────

/**
 * Detect symbols with the same name defined in multiple files.
 *
 * @param {KnowledgeGraph} graph - Populated knowledge graph
 * @param {string[]} symbolNames - Symbol names to check
 * @returns {Array<{ name: string, definitions: Array<{ file: string, type: string }> }>}
 */
export function detectSymbolConflicts(graph, symbolNames) {
  if (!graph || !symbolNames || symbolNames.length === 0) return [];

  const conflicts = [];

  for (const name of symbolNames) {
    const defs = _findAllDefinitions(graph, name);
    if (defs.length > 1) {
      conflicts.push({ name, definitions: defs });
    }
  }

  return conflicts;
}

// ─── formatImportMap ────────────────────────────────────────────────────────

/**
 * Format import map and conflicts as markdown for LLM prompt injection.
 *
 * @param {Array<{ symbol: string, exportedFrom: string }>} entries
 * @param {Array<{ name: string, definitions: Array<{ file: string, type: string }> }>} [conflicts]
 * @returns {string}
 */
export function formatImportMap(entries, conflicts) {
  if ((!entries || entries.length === 0) && (!conflicts || conflicts.length === 0)) {
    return '';
  }

  const parts = [];

  if (entries && entries.length > 0) {
    parts.push('## Import Map (use these exact paths)');
    for (const e of entries) {
      parts.push(`${e.symbol} → ${e.exportedFrom}`);
    }
  }

  if (conflicts && conflicts.length > 0) {
    parts.push('');
    parts.push('## Symbol Conflicts (similar names — use correct one!)');
    for (const c of conflicts) {
      const locs = c.definitions.map(d => `${d.file} (${d.type})`);
      parts.push(`${c.name}: ${locs.join(' vs ')}`);
    }
  }

  return parts.join('\n');
}

// ─── Private Helpers ────────────────────────────────────────────────────────

/**
 * Extract the file path from a graph node.
 * File nodes: id = "file:src/foo.js", name = "src/foo.js" or metadata.file
 */
function _extractFilePath(node) {
  if (!node) return null;
  if (node.type === NodeType.FILE) {
    return node.file || node.name || (node.id ? node.id.replace(/^file:/, '') : null);
  }
  // Symbol nodes have a .file property
  return node.file || null;
}

/**
 * Get all exported symbol names defined in a file node.
 * Looks for DEFINES edges outgoing from the file node.
 */
function _getDefinedSymbols(graph, fileNodeIdStr) {
  const symbols = [];

  // DEFINES edges: file → symbol
  const defines = graph.getEdges(fileNodeIdStr, EdgeType.DEFINES);
  if (defines) {
    for (const { target } of defines) {
      const symNode = graph.getNode(target);
      if (symNode && symNode.name) {
        // Extract bare name (strip file qualifier from sym:name@file)
        const name = symNode.name.includes('@') ? symNode.name.split('@')[0] : symNode.name;
        // Remove sym: prefix if present
        const clean = name.startsWith('sym:') ? name.slice(4) : name;
        symbols.push(clean);
      }
    }
  }

  return symbols;
}

/**
 * Find all files where a symbol name is defined.
 * Uses same iteration pattern as KG.getCallers() — scans _nodes Map.
 */
function _findAllDefinitions(graph, symbolName) {
  const defs = [];

  // Access internal _nodes Map (same pattern as getCallers/getCallees in KG)
  const nodes = graph._nodes;
  if (!nodes || typeof nodes[Symbol.iterator] !== 'function') return defs;

  const prefix = `sym:${symbolName}@`;
  for (const [id, node] of nodes) {
    if (node.name === symbolName || id.startsWith(prefix)) {
      if (node.type === NodeType.SYMBOL || id.startsWith('sym:')) {
        const file = node.file || id.replace(/^sym:\w+@/, '');
        defs.push({ file, type: node.symbolType || node.type || 'unknown' });
      }
    }
  }

  return defs;
}
