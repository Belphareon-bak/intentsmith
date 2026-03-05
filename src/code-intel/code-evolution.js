// Code Evolution Analyzer v1 — Git-based change pattern analysis
// ══════════════════════════════════════════════════════════════════════════════
//
// Analyzes how code evolves over time using git history:
//   - Hotspot detection (frequently changed files)
//   - Churn analysis (lines added/removed over time)
//   - Co-change detection (files that always change together)
//   - Complexity trend (growing vs shrinking files)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

// ─── Git Helpers ─────────────────────────────────────────────────────────────

async function gitLog(projectPath, args, timeout = 15000) {
  try {
    const { stdout } = await execFileAsync('git', ['log', ...args], {
      cwd: projectPath,
      timeout,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });
    return stdout.trim();
  } catch (err) {
    if (err.code === 'ENOENT' || err.stderr?.includes('not a git repository')) {
      return null;
    }
    logger.warn('CodeEvolution', `git log failed: ${err.message}`);
    return null;
  }
}

// ─── Hotspot Detection ───────────────────────────────────────────────────────

/**
 * Find files that change most frequently (hotspots).
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {number} [opts.days=90] - Look back N days
 * @param {number} [opts.maxFiles=50] - Return top N files
 * @returns {Promise<Array<{file: string, commits: number, rank: number}>>}
 */
export async function findHotspots(projectPath, opts = {}) {
  const days = opts.days || 90;
  const maxFiles = opts.maxFiles || 50;

  const raw = await gitLog(projectPath, [
    `--since=${days} days ago`,
    '--name-only',
    '--format=',
    '--diff-filter=AMRC',
  ]);

  if (!raw) return [];

  // Count commits per file
  const counts = new Map();
  for (const line of raw.split('\n')) {
    const file = line.trim();
    if (!file || file.startsWith('.') || isIgnoredPath(file)) continue;
    counts.set(file, (counts.get(file) || 0) + 1);
  }

  // Sort by frequency
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFiles);

  return sorted.map(([file, commits], i) => ({
    file,
    commits,
    rank: i + 1,
  }));
}

// ─── Churn Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze code churn (lines added/removed) per file.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {number} [opts.days=90]
 * @param {number} [opts.maxFiles=30]
 * @returns {Promise<Array<{file: string, added: number, removed: number, churn: number, ratio: number}>>}
 */
export async function analyzeChurn(projectPath, opts = {}) {
  const days = opts.days || 90;
  const maxFiles = opts.maxFiles || 30;

  const raw = await gitLog(projectPath, [
    `--since=${days} days ago`,
    '--numstat',
    '--format=',
  ]);

  if (!raw) return [];

  const stats = new Map();
  for (const line of raw.split('\n')) {
    const match = line.match(/^(\d+)\t(\d+)\t(.+)$/);
    if (!match) continue;

    const added = parseInt(match[1], 10);
    const removed = parseInt(match[2], 10);
    const file = match[3].trim();

    if (isIgnoredPath(file)) continue;

    const existing = stats.get(file) || { added: 0, removed: 0 };
    existing.added += added;
    existing.removed += removed;
    stats.set(file, existing);
  }

  const result = [...stats.entries()]
    .map(([file, s]) => ({
      file,
      added: s.added,
      removed: s.removed,
      churn: s.added + s.removed,
      ratio: s.removed > 0 ? +(s.added / s.removed).toFixed(2) : s.added > 0 ? Infinity : 0,
    }))
    .sort((a, b) => b.churn - a.churn)
    .slice(0, maxFiles);

  return result;
}

// ─── Co-Change Detection ─────────────────────────────────────────────────────

/**
 * Find files that frequently change together in the same commit.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {number} [opts.days=90]
 * @param {number} [opts.minCoChanges=3] - Minimum co-changes to report
 * @param {number} [opts.maxPairs=30]
 * @returns {Promise<Array<{file1: string, file2: string, coChanges: number, coupling: number}>>}
 */
export async function findCoChanges(projectPath, opts = {}) {
  const days = opts.days || 90;
  const minCoChanges = opts.minCoChanges || 3;
  const maxPairs = opts.maxPairs || 30;

  // Get commit-grouped file changes
  const raw = await gitLog(projectPath, [
    `--since=${days} days ago`,
    '--name-only',
    '--pretty=format:__COMMIT__',
  ]);

  if (!raw) return [];

  const commits = [];
  let current = [];

  for (const line of raw.split('\n')) {
    if (line === '__COMMIT__') {
      if (current.length > 0) commits.push(current);
      current = [];
    } else {
      const file = line.trim();
      if (file && !isIgnoredPath(file)) current.push(file);
    }
  }
  if (current.length > 0) commits.push(current);

  // Count co-occurrences (pairs of files in same commit)
  const pairCounts = new Map();
  const fileCounts = new Map();

  for (const files of commits) {
    if (files.length > 20) continue; // Skip huge commits (merges, refactors)

    for (const f of files) {
      fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
    }

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = files[i] < files[j] ? `${files[i]}|||${files[j]}` : `${files[j]}|||${files[i]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  // Calculate coupling strength
  const pairs = [];
  for (const [key, count] of pairCounts) {
    if (count < minCoChanges) continue;
    const [file1, file2] = key.split('|||');
    const maxSingle = Math.max(fileCounts.get(file1) || 1, fileCounts.get(file2) || 1);
    pairs.push({
      file1,
      file2,
      coChanges: count,
      coupling: +(count / maxSingle).toFixed(2),
    });
  }

  return pairs
    .sort((a, b) => b.coupling - a.coupling || b.coChanges - a.coChanges)
    .slice(0, maxPairs);
}

// ─── Complexity Trend ────────────────────────────────────────────────────────

/**
 * Analyze file size growth/shrink trend.
 *
 * @param {string} projectPath
 * @param {string} filePath - Relative path to file
 * @param {Object} [opts]
 * @param {number} [opts.commits=20] - Number of commits to look back
 * @returns {Promise<{file: string, history: Array<{date: string, lines: number}>, trend: 'growing'|'shrinking'|'stable'}>}
 */
export async function analyzeComplexityTrend(projectPath, filePath, opts = {}) {
  const commits = opts.commits || 20;

  const raw = await gitLog(projectPath, [
    `-${commits}`,
    '--format=%H %ai',
    '--', filePath,
  ]);

  if (!raw) return { file: filePath, history: [], trend: 'stable' };

  const history = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/^(\w+)\s+(\d{4}-\d{2}-\d{2})/);
    if (!match) continue;

    const [, hash, date] = match;
    try {
      const { stdout } = await execFileAsync('git', ['show', `${hash}:${filePath}`], {
        cwd: projectPath,
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      history.push({ date, lines: stdout.split('\n').length });
    } catch {
      // File might not exist at that commit
    }
  }

  // Determine trend
  let trend = 'stable';
  if (history.length >= 2) {
    const first = history[history.length - 1].lines; // oldest
    const last = history[0].lines; // newest
    const change = (last - first) / first;
    if (change > 0.2) trend = 'growing';
    else if (change < -0.2) trend = 'shrinking';
  }

  return { file: filePath, history, trend };
}

// ─── Full Evolution Report ───────────────────────────────────────────────────

/**
 * Run full evolution analysis on a project.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
export async function analyzeEvolution(projectPath, opts = {}) {
  const start = Date.now();

  const [hotspots, churn, coChanges] = await Promise.all([
    findHotspots(projectPath, opts),
    analyzeChurn(projectPath, opts),
    findCoChanges(projectPath, opts),
  ]);

  const buildTime = Date.now() - start;

  logger.info('CodeEvolution', `Analyzed: ${hotspots.length} hotspots, ${churn.length} churn files, ${coChanges.length} co-change pairs (${buildTime}ms)`);

  return { hotspots, churn, coChanges, buildTime };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatEvolutionReport(result) {
  const parts = ['## Code Evolution Analysis'];

  if (result.hotspots.length > 0) {
    parts.push('', '### Hotspots (Most Frequently Changed)');
    for (const h of result.hotspots.slice(0, 15)) {
      parts.push(`${h.rank}. \`${h.file}\` — ${h.commits} commits`);
    }
  }

  if (result.churn.length > 0) {
    parts.push('', '### Highest Churn');
    for (const c of result.churn.slice(0, 10)) {
      parts.push(`- \`${c.file}\` — +${c.added}/−${c.removed} lines (churn: ${c.churn})`);
    }
  }

  if (result.coChanges.length > 0) {
    parts.push('', '### Co-Change Pairs (Temporal Coupling)');
    for (const p of result.coChanges.slice(0, 10)) {
      parts.push(`- \`${p.file1}\` ↔ \`${p.file2}\` — ${p.coChanges}× together (coupling: ${(p.coupling * 100).toFixed(0)}%)`);
    }
  }

  parts.push('', `---`, `*Analysis took ${result.buildTime}ms*`);
  return parts.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const IGNORED_PATHS = /(?:^|[/\\])(node_modules|\.git|dist|build|__pycache__|venv|\.c3|vendor|target|\.next|coverage)[/\\]/;

function isIgnoredPath(filePath) {
  return IGNORED_PATHS.test(filePath);
}

export default { findHotspots, analyzeChurn, findCoChanges, analyzeComplexityTrend, analyzeEvolution, formatEvolutionReport };
