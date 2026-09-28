// Incremental Context Engine v100 — Symbol-Aware Context Compression
// ══════════════════════════════════════════════════════════════════════════════
//
// Replaces full-file context with targeted, symbol-aware extraction:
//   symbol → impact-analyzer → graph expansion (graph-retrieval.js) → compress
//
// Typical ~70% reduction vs buildCodeContext() for the same query.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import { estimateTokens } from './context-builder.js';

// ─── Lazy-loaded modules ────────────────────────────────────────────────────

let _loaded = false;
let _analyzeImpact, _expandWithGraph, _mergeAndResort, _knowledgeGraph;

async function _ensureModules() {
  if (_loaded) return true;
  try {
    const [impact, graphRetrieval, kg] = await Promise.all([
      import('./impact-analyzer.js'),
      import('./graph-retrieval.js'),
      import('./knowledge-graph.js'),
    ]);
    _analyzeImpact = impact.analyzeImpact;
    _expandWithGraph = graphRetrieval.expandWithGraph;
    _mergeAndResort = graphRetrieval.mergeAndResort;
    _knowledgeGraph = kg.knowledgeGraph;
    _loaded = true;
    return true;
  } catch (err) {
    logger.warn('ContextEngine', `Modules unavailable: ${err.message}`);
    return false;
  }
}

// ─── Extract Relevant Sections ──────────────────────────────────────────────

/**
 * Extract only functions/classes matching target symbols, plus imports/exports.
 * Much smaller than full file content.
 *
 * @param {string} content - Full file content
 * @param {string[]} symbols - Symbol names to keep
 * @param {number} [contextLines=5] - Lines of context around each match
 * @returns {string} Extracted sections
 */
export function extractRelevantSections(content, symbols, contextLines = 5) {
  if (!content || !symbols || symbols.length === 0) return content || '';

  const lines = content.split('\n');
  if (lines.length <= 30) return content; // small file — keep all

  const keepLines = new Set();

  // Always keep imports (first block of import/require/from lines)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^(import |from |const .* = require|export \{)/.test(l) || l === '') {
      keepLines.add(i);
    } else if (i > 0 && keepLines.has(i - 1) && l === '') {
      keepLines.add(i); // blank line after imports
    } else if (i > 5 && !keepLines.has(i - 1)) {
      break; // end of import block
    }
  }

  // Always keep exports at end
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
    const l = lines[i].trim();
    if (/^(export |module\.exports)/.test(l) || l === '' || l === '};' || l === '}') {
      keepLines.add(i);
    }
  }

  // Find function/class definitions matching symbols
  const symbolLower = symbols.map(s => s.toLowerCase());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const lLower = l.toLowerCase();

    // Check if this line references any target symbol
    const matches = symbolLower.some(s =>
      lLower.includes(s) ||
      // camelCase partial match: "createUser" matches "user"
      lLower.includes(s.replace(/[A-Z]/g, m => m.toLowerCase()))
    );

    if (matches) {
      // Find the enclosing block (function/class boundary)
      const { start, end } = _findEnclosingBlock(lines, i);
      for (let j = Math.max(0, start - contextLines); j <= Math.min(lines.length - 1, end + contextLines); j++) {
        keepLines.add(j);
      }
    }
  }

  if (keepLines.size === 0 || keepLines.size >= lines.length * 0.8) {
    return content; // nothing matched or almost everything matched
  }

  // Build output with section separators
  const sorted = [...keepLines].sort((a, b) => a - b);
  const result = [];
  let lastLine = -2;

  for (const lineIdx of sorted) {
    if (lineIdx > lastLine + 1) {
      result.push('  // ... (omitted)');
    }
    result.push(lines[lineIdx]);
    lastLine = lineIdx;
  }

  return result.join('\n');
}

/**
 * Find the enclosing function/class block for a line.
 */
function _findEnclosingBlock(lines, targetLine) {
  let start = targetLine;
  let end = targetLine;
  let braceDepth = 0;

  // Search backward for function/class definition start
  for (let i = targetLine; i >= Math.max(0, targetLine - 50); i--) {
    const l = lines[i].trim();
    if (/^(export\s+)?(async\s+)?function\s|^(export\s+)?class\s|^\w+\s*[=(]\s*(async\s+)?\(/.test(l)) {
      start = i;
      break;
    }
    if (i < targetLine) start = i;
  }

  // Search forward for matching closing brace
  for (let i = start; i < Math.min(lines.length, start + 200); i++) {
    for (const ch of lines[i]) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    end = i;
    if (braceDepth <= 0 && i > start) break;
  }

  return { start, end };
}

// ─── Context Compression ────────────────────────────────────────────────────

/**
 * Compress context to fit within token budget.
 * Removes least relevant sections iteratively.
 *
 * @param {Array<{file: string, content: string, score: number}>} sections
 * @param {number} tokenBudget
 * @returns {{ context: string, files: string[], tokens: number, droppedFiles: string[] }}
 */
export function compressContext(sections, tokenBudget) {
  if (!sections || sections.length === 0) {
    return { context: '', files: [], tokens: 0, droppedFiles: [] };
  }

  // Sort by score descending
  const sorted = [...sections].sort((a, b) => b.score - a.score);

  const kept = [];
  const dropped = [];
  let totalTokens = 0;

  for (const section of sorted) {
    const tokens = estimateTokens(section.content);
    if (totalTokens + tokens <= tokenBudget || kept.length === 0) {
      kept.push(section);
      totalTokens += tokens;
    } else {
      dropped.push(section.file);
    }
  }

  const context = kept.map(s =>
    `### ${s.file}\n\`\`\`\n${s.content}\n\`\`\``
  ).join('\n\n');

  return {
    context,
    files: kept.map(s => s.file),
    tokens: totalTokens,
    droppedFiles: dropped,
  };
}

// ─── Incremental Context Builder ────────────────────────────────────────────

/**
 * Build incremental, symbol-aware context.
 *
 * Pipeline:
 *   1. Impact analysis for each symbol
 *   2. Graph expansion via graph-retrieval.js (NOT custom BFS)
 *   3. Read + extract relevant sections
 *   4. Compress to token budget
 *
 * @param {string} projectPath
 * @param {string[]} changedSymbols - Symbol names to analyze
 * @param {Object} [opts]
 * @param {number} [opts.maxFiles=10] - Max files in context
 * @param {number} [opts.maxTokens=15000] - Token budget
 * @param {number} [opts.contextLines=5] - Lines around matches
 * @param {Object} [opts.graph] - Override knowledge graph
 * @returns {Promise<{context: string, files: string[], tokens: number, compressionRatio: number}>}
 */
export async function buildIncrementalContext(projectPath, changedSymbols, opts = {}) {
  if (!projectPath || !changedSymbols || changedSymbols.length === 0) {
    return { context: '', files: [], tokens: 0, compressionRatio: 1.0 };
  }

  const maxFiles = opts.maxFiles || 10;
  const maxTokens = opts.maxTokens || 15000;
  const contextLines = opts.contextLines || 5;

  if (!await _ensureModules()) {
    return { context: '', files: [], tokens: 0, compressionRatio: 1.0 };
  }

  const graph = opts.graph || _knowledgeGraph;

  try {
    // 1. Impact analysis for each symbol → collect impacted files
    const impactedFiles = new Map(); // file → best score

    for (const symbol of changedSymbols.slice(0, 10)) {
      const impact = await _analyzeImpact(symbol, {
        maxDepth: 2,
        projectPath,
        graph,
      });

      // Direct: score 1.0
      for (const file of impact.impactedFiles) {
        const existing = impactedFiles.get(file) || 0;
        if (1.0 > existing) impactedFiles.set(file, 1.0);
      }
      // Tests: score 0.6
      for (const file of impact.impactedTests) {
        const existing = impactedFiles.get(file) || 0;
        if (0.6 > existing) impactedFiles.set(file, 0.6);
      }
    }

    // 2. Graph expansion via graph-retrieval.js (delegate, NOT custom BFS)
    const rankedFiles = [...impactedFiles.entries()]
      .map(([file, score]) => ({ file, score }))
      .sort((a, b) => b.score - a.score);

    let allFiles = rankedFiles;
    if (graph && graph._nodes && graph._nodes.size > 0) {
      const graphExpanded = _expandWithGraph(rankedFiles, graph, {
        topN: 5,
        maxDepth: 2,
        maxExpansion: 5,
        minScore: 0.05,
      });
      allFiles = _mergeAndResort(rankedFiles, graphExpanded);
    }

    // Cap at maxFiles
    const filesToRead = allFiles.slice(0, maxFiles);

    // 3. Read files + extract relevant sections
    const sections = [];
    let fullSizeTotal = 0;

    for (const entry of filesToRead) {
      const absPath = path.join(projectPath, entry.file);
      let content;
      try {
        content = await readFile(absPath, 'utf8');
        if (content.length > 512 * 1024) continue; // skip huge files
      } catch { continue; }

      fullSizeTotal += estimateTokens(content);

      // Extract only relevant sections
      const extracted = extractRelevantSections(content, changedSymbols, contextLines);

      sections.push({
        file: entry.file,
        content: extracted,
        score: entry.score,
      });
    }

    // 4. Compress to token budget
    const result = compressContext(sections, maxTokens);

    const compressionRatio = fullSizeTotal > 0
      ? 1 - (result.tokens / fullSizeTotal)
      : 0;

    logger.info('ContextEngine', `Incremental context: ${result.files.length} files, ${result.tokens} tokens, ${(compressionRatio * 100).toFixed(0)}% reduction`, {
      symbols: changedSymbols.length,
      impactedFiles: impactedFiles.size,
      graphExpanded: allFiles.length - rankedFiles.length,
    });

    return {
      context: result.context,
      files: result.files,
      tokens: result.tokens,
      compressionRatio: Math.round(compressionRatio * 100) / 100,
    };
  } catch (err) {
    logger.warn('ContextEngine', `Incremental context failed: ${err.message}`);
    return { context: '', files: [], tokens: 0, compressionRatio: 0 };
  }
}

// ─── Milestone Context (BUILD Pipeline) ─────────────────────────────────────

/**
 * Build context for a BUILD milestone.
 * Extracts symbols from scope_files + title/description, then delegates
 * to buildIncrementalContext().
 *
 * @param {string} projectPath
 * @param {Object} milestone - { title, description, scope_files }
 * @param {Object} [opts] - Passed to buildIncrementalContext()
 * @returns {Promise<{context: string, files: string[], tokens: number, compressionRatio: number}>}
 */
export async function buildMilestoneContext(projectPath, milestone, opts = {}) {
  if (!milestone) {
    return { context: '', files: [], tokens: 0, compressionRatio: 0 };
  }

  // Extract symbol candidates from milestone metadata
  const symbols = _extractSymbolsFromMilestone(milestone);

  if (symbols.length === 0) {
    return { context: '', files: [], tokens: 0, compressionRatio: 0 };
  }

  return buildIncrementalContext(projectPath, symbols, {
    maxFiles: opts.maxFiles || 5,
    maxTokens: opts.maxTokens || 5000,
    contextLines: opts.contextLines || 5,
    graph: opts.graph,
  });
}

/**
 * Extract likely symbol names from milestone title/description/scope_files.
 */
function _extractSymbolsFromMilestone(milestone) {
  const symbols = new Set();

  // From title + description: extract camelCase/PascalCase identifiers
  const text = `${milestone.title || ''} ${milestone.description || ''}`;
  const identifiers = text.match(/[A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]{3,}/g) || [];
  for (const id of identifiers) {
    // Filter out common words
    if (!/^(the|and|for|with|from|this|that|will|should|must|have|been|into|each|when|then|also|only|after)$/i.test(id)) {
      symbols.add(id);
    }
  }

  // From scope_files: extract base names (without extension)
  const scopeFiles = typeof milestone.scope_files === 'string'
    ? JSON.parse(milestone.scope_files || '[]')
    : (milestone.scope_files || []);

  for (const file of scopeFiles) {
    const base = path.basename(file).replace(/\.\w+$/, '');
    // Convert filename patterns to likely symbol names
    // user-service.js → UserService, userService
    const camel = base.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
    if (camel.length >= 3) symbols.add(camel);
    const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
    if (pascal.length >= 3) symbols.add(pascal);
  }

  return [...symbols].slice(0, 20); // cap at 20 symbols
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  extractRelevantSections,
  compressContext,
  buildIncrementalContext,
  buildMilestoneContext,
};
