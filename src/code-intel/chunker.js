// Code Chunker — Semantic chunking for code embeddings
// ══════════════════════════════════════════════════════════════════════════════
//
// Splits code into semantically meaningful chunks:
//   - Functions/methods (each as a chunk)
//   - Classes (header + method signatures)
//   - Top-level blocks (imports, constants, etc.)
//
// ══════════════════════════════════════════════════════════════════════════════

import { analyzeCodeStructure, detectLanguage } from './code-analyzer.js';

const MAX_CHUNK_LINES = 100;   // Max lines per chunk
const MIN_CHUNK_LINES = 3;    // Min lines (skip trivial chunks)
const OVERLAP_LINES = 2;      // Overlap between chunks for context

/**
 * @typedef {Object} CodeChunk
 * @property {string} content - Chunk text
 * @property {string} file - Source file path
 * @property {string} type - Chunk type: 'function'|'class'|'block'|'import'
 * @property {string} name - Symbol name (or 'imports', 'top-level')
 * @property {number} startLine - 1-based
 * @property {number} endLine - 1-based
 * @property {string} language
 */

/**
 * Split file content into semantic chunks.
 *
 * @param {string} content - File content
 * @param {string} filePath - File path (for language detection)
 * @returns {CodeChunk[]}
 */
export function chunkCode(content, filePath) {
  if (!content || !filePath) return [];

  const language = detectLanguage(filePath);
  const lines = content.split('\n');
  const analysis = analyzeCodeStructure(content, language);
  const chunks = [];

  // Build a set of "owned" line ranges from structure analysis
  const ownedRanges = [];

  // Functions
  for (const fn of analysis.functions) {
    const startLine = fn.line;
    const endLine = findBlockEnd(lines, startLine - 1, language);
    ownedRanges.push({
      type: 'function',
      name: fn.name,
      startLine,
      endLine,
    });
  }

  // Classes
  for (const cls of analysis.classes) {
    const startLine = cls.line;
    const endLine = findBlockEnd(lines, startLine - 1, language);
    ownedRanges.push({
      type: cls.kind || 'class',
      name: cls.name,
      startLine,
      endLine,
    });
  }

  // Sort by start line
  ownedRanges.sort((a, b) => a.startLine - b.startLine);

  // Merge overlapping ranges
  const mergedRanges = mergeOverlapping(ownedRanges);

  // Extract chunks from ranges
  for (const range of mergedRanges) {
    const start = Math.max(0, range.startLine - 1);
    const end = Math.min(lines.length, range.endLine);
    const chunkLines = lines.slice(start, end);

    if (chunkLines.length < MIN_CHUNK_LINES) continue;

    // Split large chunks
    if (chunkLines.length > MAX_CHUNK_LINES) {
      const subChunks = splitLargeChunk(chunkLines, start, range, filePath, language);
      chunks.push(...subChunks);
    } else {
      chunks.push({
        content: chunkLines.join('\n'),
        file: filePath,
        type: range.type,
        name: range.name,
        startLine: range.startLine,
        endLine: range.endLine,
        language,
      });
    }
  }

  // Collect unowned lines (imports, top-level statements, etc.)
  const unowned = collectUnownedLines(lines, mergedRanges);
  if (unowned.length >= MIN_CHUNK_LINES) {
    chunks.unshift({
      content: unowned.join('\n'),
      file: filePath,
      type: 'block',
      name: 'top-level',
      startLine: 1,
      endLine: unowned.length,
      language,
    });
  }

  return chunks;
}

/**
 * Chunk a file into fixed-size overlapping windows (fallback).
 *
 * @param {string} content
 * @param {string} filePath
 * @param {number} [windowSize=60]
 * @param {number} [overlap=10]
 * @returns {CodeChunk[]}
 */
export function chunkFixed(content, filePath, windowSize = 60, overlap = 10) {
  if (!content || !filePath) return [];

  const language = detectLanguage(filePath);
  const lines = content.split('\n');
  const chunks = [];

  for (let i = 0; i < lines.length; i += windowSize - overlap) {
    const end = Math.min(i + windowSize, lines.length);
    const chunkLines = lines.slice(i, end);

    if (chunkLines.length < MIN_CHUNK_LINES) continue;

    chunks.push({
      content: chunkLines.join('\n'),
      file: filePath,
      type: 'window',
      name: `lines-${i + 1}-${end}`,
      startLine: i + 1,
      endLine: end,
      language,
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

// ─── Block End Detection ─────────────────────────────────────────────────────

function findBlockEnd(lines, startIdx, language) {
  if (language === 'python') {
    return findPythonBlockEnd(lines, startIdx);
  }
  return findBraceBlockEnd(lines, startIdx);
}

function findBraceBlockEnd(lines, startIdx) {
  let braceCount = 0;
  let foundOpen = false;

  for (let i = startIdx; i < lines.length && i < startIdx + MAX_CHUNK_LINES * 2; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { braceCount++; foundOpen = true; }
      else if (ch === '}') { braceCount--; }
    }
    if (foundOpen && braceCount <= 0) return i + 1;
  }

  // If no closing brace found, estimate ~20 lines
  return Math.min(startIdx + 20, lines.length);
}

function findPythonBlockEnd(lines, startIdx) {
  if (startIdx >= lines.length) return startIdx + 1;

  // Get indentation of the def/class line
  const startIndent = getIndent(lines[startIdx]);

  for (let i = startIdx + 1; i < lines.length && i < startIdx + MAX_CHUNK_LINES * 2; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // Skip blank lines
    const indent = getIndent(line);
    if (indent <= startIndent && line.trim() !== '') return i;
  }

  return lines.length;
}

function getIndent(line) {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count++;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeOverlapping(ranges) {
  if (ranges.length === 0) return [];

  const merged = [{ ...ranges[0] }];

  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const curr = ranges[i];

    if (curr.startLine <= last.endLine) {
      last.endLine = Math.max(last.endLine, curr.endLine);
      // Keep the more specific name
      if (curr.type === 'class' || curr.type === 'struct') {
        last.name = curr.name;
        last.type = curr.type;
      }
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

function splitLargeChunk(chunkLines, startOffset, range, filePath, language) {
  const chunks = [];
  const step = MAX_CHUNK_LINES - OVERLAP_LINES;

  for (let i = 0; i < chunkLines.length; i += step) {
    const end = Math.min(i + MAX_CHUNK_LINES, chunkLines.length);
    const subLines = chunkLines.slice(i, end);

    if (subLines.length < MIN_CHUNK_LINES) continue;

    chunks.push({
      content: subLines.join('\n'),
      file: filePath,
      type: range.type,
      name: `${range.name}:${i + 1}-${end}`,
      startLine: startOffset + i + 1,
      endLine: startOffset + end,
      language,
    });

    if (end >= chunkLines.length) break;
  }

  return chunks;
}

function collectUnownedLines(lines, ranges) {
  const owned = new Set();
  for (const r of ranges) {
    for (let i = r.startLine - 1; i < r.endLine && i < lines.length; i++) {
      owned.add(i);
    }
  }

  const unowned = [];
  for (let i = 0; i < lines.length; i++) {
    if (!owned.has(i) && lines[i].trim()) {
      unowned.push(lines[i]);
    }
  }

  return unowned;
}

export default { chunkCode, chunkFixed };
