// Multi-File Context Builder v1 — Smart truncation + token budget
// ══════════════════════════════════════════════════════════════════════════════
//
// Reads ranked files, applies smart truncation (keep imports + matched lines),
// estimates tokens, stops when budget is reached.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFile, stat } from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

const MAX_FILE_SIZE = 512 * 1024; // 512KB (matches file handler limit)
const DEFAULT_MAX_FILES = 10;
const DEFAULT_MAX_TOKENS = 15000;
const DEFAULT_MAX_LINES_PER_FILE = 200;
const HEADER_LINES = 20;  // Always keep first N lines (imports, class decl)
const MATCH_CONTEXT = 10; // Lines around each match to keep

// ─── Token Estimation ─────────────────────────────────────────────────────────

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Language Detection ───────────────────────────────────────────────────────

const LANG_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.java': 'java', '.kt': 'kotlin', '.scala': 'scala',
  '.rs': 'rust',
  '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.h': 'c', '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.vue': 'vue', '.svelte': 'svelte',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.sql': 'sql',
  '.sh': 'bash', '.bash': 'bash',
  '.md': 'markdown',
  '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.xml': 'xml',
};

function detectLanguage(filePath) {
  return LANG_MAP[path.extname(filePath)] || 'text';
}

// ─── Import Extraction (regex, no AST) ────────────────────────────────────────

export function extractImports(content, language) {
  const imports = [];

  switch (language) {
    case 'javascript':
    case 'typescript': {
      // import ... from 'path'
      const esm = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
      for (const m of esm) imports.push(m[1]);
      // require('path')
      const cjs = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
      for (const m of cjs) imports.push(m[1]);
      break;
    }
    case 'python': {
      // import X  /  from X import Y
      const py = content.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
      for (const m of py) imports.push(m[1] || m[2]);
      break;
    }
    case 'go': {
      // import "path"  /  import ( "path" )
      const go = content.matchAll(/import\s+(?:\(\s*)?"([^"]+)"/g);
      for (const m of go) imports.push(m[1]);
      // Multi-line imports
      const multiImport = content.match(/import\s*\(([\s\S]*?)\)/);
      if (multiImport) {
        const paths = multiImport[1].matchAll(/"([^"]+)"/g);
        for (const m of paths) imports.push(m[1]);
      }
      break;
    }
    case 'java':
    case 'kotlin':
    case 'scala': {
      const jvm = content.matchAll(/import\s+([\w.]+)/g);
      for (const m of jvm) imports.push(m[1]);
      break;
    }
    case 'rust': {
      const rs = content.matchAll(/use\s+([\w:]+)/g);
      for (const m of rs) imports.push(m[1]);
      break;
    }
  }

  return [...new Set(imports)];
}

// ─── Smart Truncation ─────────────────────────────────────────────────────────

/**
 * Smart-truncate file content: keep header + matched lines ± context.
 *
 * @param {string[]} lines - File lines
 * @param {string[]} queryTerms - Search terms to match
 * @param {number} maxLines - Max output lines
 * @returns {{content: string, truncated: boolean, keptLines: number}}
 */
function smartTruncate(lines, queryTerms, maxLines) {
  if (lines.length <= maxLines) {
    return { content: lines.join('\n'), truncated: false, keptLines: lines.length };
  }

  // Build set of lines to keep
  const keepSet = new Set();

  // Always keep header (first HEADER_LINES lines — imports, class decl)
  for (let i = 0; i < Math.min(HEADER_LINES, lines.length); i++) {
    keepSet.add(i);
  }

  // Keep lines matching query terms ± context
  if (queryTerms.length > 0) {
    const patterns = queryTerms.map(t => {
      try { return new RegExp(escapeRegex(t), 'i'); }
      catch { return null; }
    }).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      if (patterns.some(p => p.test(lines[i]))) {
        for (let j = Math.max(0, i - MATCH_CONTEXT); j <= Math.min(lines.length - 1, i + MATCH_CONTEXT); j++) {
          keepSet.add(j);
        }
      }
    }
  }

  // If still too many, trim from the middle
  let keptIndices = [...keepSet].sort((a, b) => a - b);
  if (keptIndices.length > maxLines) {
    keptIndices = keptIndices.slice(0, maxLines);
  }

  // Build output with truncation markers
  const outputLines = [];
  let lastIdx = -1;

  for (const idx of keptIndices) {
    if (lastIdx >= 0 && idx > lastIdx + 1) {
      const skipped = idx - lastIdx - 1;
      outputLines.push(`// ... (${skipped} lines truncated)`);
    }
    outputLines.push(lines[idx]);
    lastIdx = idx;
  }

  // Trailing truncation marker
  if (lastIdx < lines.length - 1) {
    const skipped = lines.length - 1 - lastIdx;
    outputLines.push(`// ... (${skipped} lines truncated)`);
  }

  return {
    content: outputLines.join('\n'),
    truncated: true,
    keptLines: keptIndices.length,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── File Metadata ────────────────────────────────────────────────────────────

async function getFileModified(filePath) {
  try {
    const s = await stat(filePath);
    return s.mtime.toISOString().split('T')[0];
  } catch {
    return 'unknown';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Build multi-file context from ranked search results.
 *
 * @param {string} projectPath - Absolute project path
 * @param {Array<{file: string, score?: number}>} rankedFiles - Files ordered by relevance
 * @param {Object} [opts]
 * @param {number} [opts.maxFiles=10]
 * @param {number} [opts.maxTokens=15000]
 * @param {number} [opts.maxLinesPerFile=200]
 * @param {string[]} [opts.queryTerms=[]]
 * @returns {Promise<{context: string, files: Array, totalTokens: number}>}
 */
export async function buildCodeContext(projectPath, rankedFiles, opts = {}) {
  const maxFiles = opts.maxFiles || DEFAULT_MAX_FILES;
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const maxLinesPerFile = opts.maxLinesPerFile || DEFAULT_MAX_LINES_PER_FILE;
  const queryTerms = opts.queryTerms || [];

  const contextParts = [];
  const fileInfos = [];
  let totalTokens = 0;
  const seenPaths = new Set();

  for (const entry of rankedFiles) {
    if (fileInfos.length >= maxFiles || totalTokens >= maxTokens) break;

    const relPath = entry.file;
    if (seenPaths.has(relPath)) continue;
    seenPaths.add(relPath);

    const absPath = path.join(projectPath, relPath);
    let content;

    try {
      const fileStat = await stat(absPath);
      if (fileStat.size > MAX_FILE_SIZE) continue;
      content = await readFile(absPath, 'utf8');
    } catch {
      continue; // skip unreadable files
    }

    const lines = content.split('\n');
    const language = detectLanguage(relPath);
    const imports = extractImports(content, language);
    const modified = await getFileModified(absPath);

    // Smart truncation
    const truncated = smartTruncate(lines, queryTerms, maxLinesPerFile);

    // Build file section
    const header = `### File: ${relPath} (${lines.length} lines, modified ${modified})`;
    const importLine = imports.length > 0
      ? `**Imports:** ${imports.slice(0, 10).join(', ')}${imports.length > 10 ? ` (+${imports.length - 10} more)` : ''}`
      : '';

    const codeFence = '```' + language + '\n' + truncated.content + '\n```';

    const section = [header, importLine, '', codeFence].filter(Boolean).join('\n');
    const sectionTokens = estimateTokens(section);

    if (totalTokens + sectionTokens > maxTokens && fileInfos.length > 0) {
      break; // Don't exceed budget (but always include at least 1 file)
    }

    contextParts.push(section);
    totalTokens += sectionTokens;

    fileInfos.push({
      path: relPath,
      lines: lines.length,
      truncated: truncated.truncated,
      keptLines: truncated.keptLines,
      language,
      tokens: sectionTokens,
    });
  }

  const context = contextParts.join('\n\n---\n\n');

  logger.info('ContextBuilder', `Built context: ${fileInfos.length} files, ${totalTokens} tokens`, {
    files: fileInfos.map(f => f.path),
  });

  return { context, files: fileInfos, totalTokens };
}

// ─── Code Analysis System Prompt ──────────────────────────────────────────────

/**
 * Build the system prompt for code analysis LLM call.
 */
export function buildCodeAnalysisPrompt(query, codeContext, projectInfo) {
  return `You are analyzing a codebase to answer a developer's question.

## Developer Question
${query}

## Project
${projectInfo || 'No project info available.'}

## Codebase Excerpt
${codeContext}

## Instructions
1. Identify the root cause of the issue described, or explain the requested behavior
2. Explain the mechanism (how the bug/behavior occurs)
3. Propose concrete fixes with code changes when applicable
4. If multiple solutions exist, rank them by impact and simplicity
5. Reference specific files and line numbers from the codebase excerpt
6. If the provided code is insufficient to answer, state what additional files/info would be needed

## Output Format
### Analysis
[What you found in the code]

### Root Cause
[Specific file, line, and mechanism — or "N/A" if not a bug investigation]

### Solution
[Description + code changes if applicable]
`;
}

export default { buildCodeContext, buildCodeAnalysisPrompt, estimateTokens, extractImports };
