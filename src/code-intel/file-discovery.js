// File Discovery v1 — Smart file ranking for code analysis
// ══════════════════════════════════════════════════════════════════════════════
//
// Multi-signal file ranking:
//   0.30 × keyword match density
//   0.20 × proximity score (query terms close together)
//   0.20 × path relevance (src > test, filename match)
//   0.15 × git recency (recently modified files)
//   0.10 × file type boost (code > config > docs)
//   0.05 × cluster density (files imported together)
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { logger } from '../core/logger.js';

// ─── Git Recency Cache ──────────────────────────────────────────────────────

let _gitRecencyCache = null;
let _gitRecencyCacheTime = 0;
const GIT_RECENCY_TTL = 60_000; // 60s

async function getGitRecency(projectPath) {
  const now = Date.now();
  if (_gitRecencyCache && now - _gitRecencyCacheTime < GIT_RECENCY_TTL) {
    return _gitRecencyCache;
  }

  return new Promise((resolve) => {
    execFile('git', ['log', '-n', '200', '--name-only', '--format='], {
      cwd: projectPath,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error || !stdout) {
        resolve(new Map());
        return;
      }

      const recency = new Map();
      const files = stdout.split('\n').filter(Boolean);
      // Earlier in list = more recent. Score: 1.0 → 0.0
      for (let i = 0; i < files.length; i++) {
        const file = files[i].trim();
        if (file && !recency.has(file)) {
          recency.set(file, 1 - (i / files.length));
        }
      }

      _gitRecencyCache = recency;
      _gitRecencyCacheTime = now;
      resolve(recency);
    });
  });
}

// ─── File Type Boost ─────────────────────────────────────────────────────────

const FILE_TYPE_SCORES = {
  code:   1.0,  // .js, .py, .go, .java, .rs, .ts, etc.
  config: 0.5,  // .json, .yaml, .toml, .env
  docs:   0.3,  // .md, .txt, .rst
  other:  0.2,
};

const CODE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.pyw', '.go', '.java', '.kt', '.scala',
  '.rs', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs',
  '.php', '.rb', '.swift', '.vue', '.svelte',
]);

const CONFIG_EXTS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env',
  '.ini', '.cfg', '.conf', '.properties',
]);

const DOC_EXTS = new Set(['.md', '.txt', '.rst', '.adoc']);

function getFileTypeScore(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  if (CODE_EXTS.has(ext)) return FILE_TYPE_SCORES.code;
  if (CONFIG_EXTS.has(ext)) return FILE_TYPE_SCORES.config;
  if (DOC_EXTS.has(ext)) return FILE_TYPE_SCORES.docs;
  return FILE_TYPE_SCORES.other;
}

// ─── Path Relevance ──────────────────────────────────────────────────────────

const SRC_DIRS = new Set(['src', 'lib', 'app', 'pkg', 'internal', 'cmd', 'core']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e']);

function getPathRelevance(filePath, queryTerms) {
  let score = 0.5; // baseline

  const parts = filePath.split('/');
  const filename = parts[parts.length - 1].toLowerCase();
  const filenameNoExt = filename.replace(/\.[^.]+$/, '');

  // Source dir bonus
  if (parts.some(p => SRC_DIRS.has(p))) score += 0.2;

  // Test dir penalty (unless searching for tests)
  const queryHasTest = queryTerms.some(t => /test|spec/i.test(t));
  if (parts.some(p => TEST_DIRS.has(p)) && !queryHasTest) score -= 0.2;

  // Filename contains query term → big boost
  for (const term of queryTerms) {
    if (term.length >= 3 && filenameNoExt.toLowerCase().includes(term.toLowerCase())) {
      score += 0.3;
      break;
    }
  }

  // Shallow path (fewer dirs) = slightly more relevant
  if (parts.length <= 3) score += 0.05;

  return Math.max(0, Math.min(1, score));
}

// ─── Proximity Score ─────────────────────────────────────────────────────────

/**
 * Score how close different query terms appear to each other within a file.
 * If query has <2 terms, returns 0 (not applicable).
 *
 * @param {Array<{line: number}>} matches - All matches in this file
 * @param {string[]} queryTerms - The query terms searched for
 * @returns {number} 0.0-1.0
 */
function getProximityScore(matches, queryTerms) {
  if (queryTerms.length < 2 || matches.length < 2) return 0;

  // Group match lines
  const lineNumbers = matches.map(m => m.line).sort((a, b) => a - b);

  // Check if different terms are close together (within 20 lines)
  let bestProximity = Infinity;
  for (let i = 0; i < lineNumbers.length - 1; i++) {
    const gap = lineNumbers[i + 1] - lineNumbers[i];
    if (gap > 0 && gap < bestProximity) bestProximity = gap;
  }

  if (bestProximity === Infinity || bestProximity === 0) return 0;

  // Within 5 lines = 1.0, within 20 lines = 0.5, beyond = 0
  if (bestProximity <= 5) return 1.0;
  if (bestProximity <= 20) return 0.5;
  if (bestProximity <= 50) return 0.2;
  return 0;
}

// ─── Cluster Density ─────────────────────────────────────────────────────────

/**
 * Score files that share import relationships.
 * Files that import each other are likely related.
 *
 * @param {string} filePath
 * @param {Map<string, Set<string>>} importGraph - file → set of imported files
 * @param {Set<string>} relevantFiles - all files with matches
 * @returns {number} 0.0-1.0
 */
function getClusterScore(filePath, importGraph, relevantFiles) {
  const imports = importGraph.get(filePath);
  if (!imports || imports.size === 0) return 0;

  // How many of this file's imports are also in the relevant set?
  let shared = 0;
  for (const imp of imports) {
    if (relevantFiles.has(imp)) shared++;
  }

  return Math.min(1, shared / 3); // 3+ shared imports = max score
}

// ─── Main Ranking Function ───────────────────────────────────────────────────

/**
 * Rank files from search results using multi-signal scoring.
 *
 * Weights:
 *   0.30 × keyword match density
 *   0.20 × proximity score
 *   0.20 × path relevance
 *   0.15 × git recency
 *   0.10 × file type boost
 *   0.05 × cluster density
 *
 * @param {Array<{file: string, line: number, content: string}>} searchResults
 * @param {string[]} queryTerms
 * @param {Object} [opts]
 * @param {string} [opts.projectPath] - For git recency
 * @param {Map<string, Set<string>>} [opts.importGraph] - Import relationships
 * @returns {Promise<Array<{file: string, score: number, matchCount: number, matchLines: number[], reason: string}>>}
 */
export async function rankFiles(searchResults, queryTerms, opts = {}) {
  if (!searchResults || searchResults.length === 0) return [];

  // Group results by file
  const fileMap = new Map();
  for (const r of searchResults) {
    const entry = fileMap.get(r.file) || { file: r.file, matches: [], contents: [] };
    entry.matches.push({ line: r.line, content: r.content });
    entry.contents.push(r.content);
    fileMap.set(r.file, entry);
  }

  // Git recency (batch, cached)
  let gitRecency = new Map();
  if (opts.projectPath) {
    gitRecency = await getGitRecency(opts.projectPath);
  }

  const relevantFiles = new Set(fileMap.keys());
  const importGraph = opts.importGraph || new Map();

  // Max match count for normalization
  const maxMatches = Math.max(...[...fileMap.values()].map(f => f.matches.length));

  // Score each file
  const ranked = [];

  for (const [filePath, data] of fileMap) {
    // 1. Keyword match density (0-1, normalized by max matches)
    const keywordScore = maxMatches > 0 ? data.matches.length / maxMatches : 0;

    // 2. Proximity score
    const proximityScore = getProximityScore(data.matches, queryTerms);

    // 3. Path relevance
    const pathScore = getPathRelevance(filePath, queryTerms);

    // 4. Git recency
    const recencyScore = gitRecency.get(filePath) || 0;

    // 5. File type boost
    const fileTypeScore = getFileTypeScore(filePath);

    // 6. Cluster density
    const clusterScore = getClusterScore(filePath, importGraph, relevantFiles);

    // Weighted total
    const totalScore =
      0.30 * keywordScore +
      0.20 * proximityScore +
      0.20 * pathScore +
      0.15 * recencyScore +
      0.10 * fileTypeScore +
      0.05 * clusterScore;

    // Build reason string for debugging
    const reasons = [];
    if (keywordScore > 0.5) reasons.push(`${data.matches.length} matches`);
    if (proximityScore > 0) reasons.push(`proximity=${proximityScore.toFixed(1)}`);
    if (pathScore > 0.7) reasons.push('src path');
    if (recencyScore > 0.5) reasons.push('recently modified');
    if (fileTypeScore === 1.0) reasons.push('code file');
    if (clusterScore > 0) reasons.push(`cluster=${clusterScore.toFixed(1)}`);

    ranked.push({
      file: filePath,
      score: totalScore,
      matchCount: data.matches.length,
      matchLines: data.matches.map(m => m.line),
      reason: reasons.join(', ') || 'baseline',
    });
  }

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  logger.info('FileDiscovery', `Ranked ${ranked.length} files`, {
    top3: ranked.slice(0, 3).map(f => `${f.file} (${f.score.toFixed(2)})`),
  });

  return ranked;
}

// ─── Import Graph Builder ────────────────────────────────────────────────────

/**
 * Build a simple import graph from search results.
 * Maps file → set of files it imports (resolved relative paths only).
 *
 * @param {Array<{file: string, content: string}>} fileContents
 * @returns {Map<string, Set<string>>}
 */
export function buildImportGraph(fileContents) {
  const graph = new Map();

  for (const { file, content } of fileContents) {
    const imports = new Set();
    const dir = file.substring(0, file.lastIndexOf('/') + 1) || '';

    // JS/TS imports
    const esmMatches = content.matchAll(/(?:import|from)\s+['"]([./][^'"]+)['"]/g);
    for (const m of esmMatches) {
      const resolved = resolveImportPath(dir, m[1]);
      if (resolved) imports.add(resolved);
    }

    // require()
    const cjsMatches = content.matchAll(/require\s*\(\s*['"]([./][^'"]+)['"]\s*\)/g);
    for (const m of cjsMatches) {
      const resolved = resolveImportPath(dir, m[1]);
      if (resolved) imports.add(resolved);
    }

    if (imports.size > 0) graph.set(file, imports);
  }

  return graph;
}

function resolveImportPath(fromDir, importPath) {
  // Only resolve relative paths
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) return null;

  // Simple path resolution (no node_modules resolution)
  const parts = (fromDir + importPath).split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }

  return resolved.join('/');
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

export function _clearGitRecencyCache() {
  _gitRecencyCache = null;
  _gitRecencyCacheTime = 0;
}

export default { rankFiles, buildImportGraph };
