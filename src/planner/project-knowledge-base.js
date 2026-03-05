// Project Knowledge Base v100 — Auto-Generated Project Snapshot
// ══════════════════════════════════════════════════════════════════════════════
//
// Aggregates all code-intel modules into a single project snapshot:
//   architecture, API catalog, module map, dependency graph,
//   test coverage, hotspots, conventions, known issues
//
// Default path is INCREMENTAL — only full build on first call.
//   getOrCreateSnapshot() → updateSnapshot() (incremental) | buildProjectSnapshot() (first)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { estimateTokens } from '../code-intel/context-builder.js';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';

// ─── Lazy-loaded modules ────────────────────────────────────────────────────

let _loaded = false;
let _detectArchitecture, _formatArchitectureForPrompt, _minePatterns;
let _findHotspots, _exploreTestCoverage;

async function _ensureModules() {
  if (_loaded) return true;
  try {
    const [arch, evolution, coverage] = await Promise.all([
      import('../code-intel/architecture-detector.js'),
      import('../code-intel/code-evolution.js'),
      import('../code-intel/test-coverage-explorer.js'),
    ]);
    _detectArchitecture = arch.detectArchitecture;
    _formatArchitectureForPrompt = arch.formatArchitectureForPrompt;
    _minePatterns = arch.minePatterns;
    _findHotspots = evolution.findHotspots;
    _exploreTestCoverage = coverage.exploreTestCoverage;
    _loaded = true;
    return true;
  } catch (err) {
    logger.warn('ProjectKB', `Modules unavailable: ${err.message}`);
    return false;
  }
}

// ─── In-Memory Snapshot Cache ───────────────────────────────────────────────

const _snapshotCache = new Map(); // projectPath → { snapshot, timestamp }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Snapshot Persistence ───────────────────────────────────────────────────

const SNAPSHOT_FILE = '.c3/snapshot.json';
const SNAPSHOT_SCHEMA_VERSION = 1;

async function _saveToFile(projectPath, snapshot) {
  try {
    const dir = path.join(projectPath, '.c3');
    await mkdir(dir, { recursive: true });
    const data = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, ...snapshot };
    await writeFile(path.join(projectPath, SNAPSHOT_FILE), JSON.stringify(data), 'utf8');
  } catch (err) {
    logger.warn('ProjectKB', `Failed to save snapshot: ${err.message}`);
  }
}

async function _loadFromFile(projectPath) {
  try {
    const raw = await readFile(path.join(projectPath, SNAPSHOT_FILE), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (data.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;

    // Invalidate if architecture policy is newer than snapshot
    try {
      const policyPath = path.join(projectPath, '.c3/architecture-policy.json');
      const policyStat = await stat(policyPath);
      if (data.timestamp && policyStat.mtime > new Date(data.timestamp)) {
        logger.info('ProjectKB', 'Snapshot invalidated: architecture policy is newer');
        return null;
      }
    } catch { /* no policy file — fine */ }

    const { schemaVersion, ...snapshot } = data;
    return snapshot;
  } catch {
    return null; // file missing or corrupted
  }
}

// ─── Build Project Snapshot (Full) ──────────────────────────────────────────

/**
 * Build a complete project snapshot. Called only on first invocation or explicit refresh.
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {Array} [opts.files] - Pre-scanned files [{file, content}]
 * @returns {Promise<Object>} ProjectSnapshot
 */
export async function buildProjectSnapshot(projectPath, opts = {}) {
  if (!projectPath) return null;

  const start = Date.now();
  await _ensureModules();

  const snapshot = {
    projectPath,
    timestamp: new Date().toISOString(),
    version: 1,
    architecture: null,
    apiCatalog: [],
    moduleMap: {},
    hotspots: [],
    testCoverage: null,
    conventions: [],
    knownIssues: { driftViolations: 0, deadCode: 0 },
  };

  // 1. Architecture detection
  if (_detectArchitecture && opts.files) {
    try {
      snapshot.architecture = _detectArchitecture(opts.files);
    } catch { /* non-blocking */ }
  }

  // 2. Conventions (pattern mining)
  if (_minePatterns && opts.files) {
    try {
      snapshot.conventions = _minePatterns(opts.files);
    } catch { /* non-blocking */ }
  }

  // 3. Hotspots (git history)
  if (_findHotspots) {
    try {
      snapshot.hotspots = await _findHotspots(projectPath, { limit: 20 });
    } catch { /* git not available */ }
  }

  // 4. Test coverage
  if (_exploreTestCoverage) {
    try {
      snapshot.testCoverage = await _exploreTestCoverage(projectPath);
    } catch { /* non-blocking */ }
  }

  // 5. Module map from files
  if (opts.files) {
    snapshot.moduleMap = _buildModuleMap(opts.files);
  }

  // Cache + persist
  _snapshotCache.set(projectPath, { snapshot, timestamp: Date.now() });
  await _saveToFile(projectPath, snapshot);

  logger.info('ProjectKB', `Full snapshot built (${Date.now() - start}ms)`, {
    architecture: !!snapshot.architecture,
    hotspots: snapshot.hotspots.length,
    conventions: snapshot.conventions.length,
  });

  return snapshot;
}

// ─── Update Snapshot (Incremental) ──────────────────────────────────────────

/**
 * Incrementally update an existing snapshot. Only re-scans changed files.
 * This is the DEFAULT path — called by getOrCreateSnapshot().
 *
 * @param {string} projectPath
 * @param {string[]} changedFiles - Relative paths of changed files
 * @param {Object} existingSnapshot - Previous snapshot to update
 * @returns {Promise<Object>} Updated ProjectSnapshot
 */
export async function updateSnapshot(projectPath, changedFiles, existingSnapshot) {
  if (!existingSnapshot) {
    return buildProjectSnapshot(projectPath);
  }

  if (!changedFiles || changedFiles.length === 0) {
    return existingSnapshot; // nothing changed
  }

  const updated = { ...existingSnapshot };
  updated.version = (existingSnapshot.version || 1) + 1;
  updated.timestamp = new Date().toISOString();

  // Update module map: add/update changed files
  for (const file of changedFiles) {
    const parts = file.split('/');
    if (parts.length >= 2) {
      const module = parts.slice(0, 2).join('/');
      if (!updated.moduleMap[module]) {
        updated.moduleMap[module] = [];
      }
      if (!updated.moduleMap[module].includes(file)) {
        updated.moduleMap[module].push(file);
      }
    }
  }

  // Re-compute hotspots (lightweight git operation)
  if (_findHotspots) {
    try {
      updated.hotspots = await _findHotspots(projectPath, { limit: 20 });
    } catch { /* keep existing */ }
  }

  // Cache + persist
  _snapshotCache.set(projectPath, { snapshot: updated, timestamp: Date.now() });
  await _saveToFile(projectPath, updated);

  logger.info('ProjectKB', `Snapshot incrementally updated (v${updated.version})`, {
    changedFiles: changedFiles.length,
  });

  return updated;
}

// ─── Get or Create Snapshot (Main API) ──────────────────────────────────────

/**
 * Main entry point. Returns cached snapshot or builds/updates one.
 * Default path is INCREMENTAL — full build only on first call.
 *
 * @param {string} projectPath
 * @param {string[]} [changedFiles] - Files that changed since last snapshot
 * @param {Object} [opts] - Options for full build
 * @returns {Promise<Object>} ProjectSnapshot
 */
export async function getOrCreateSnapshot(projectPath, changedFiles = null, opts = {}) {
  // 1. In-memory cache (TTL valid)
  const cached = _snapshotCache.get(projectPath);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    if (changedFiles && changedFiles.length > 0) {
      return updateSnapshot(projectPath, changedFiles, cached.snapshot);
    }
    return cached.snapshot;
  }

  // 2. No in-memory cache → try loading from disk
  if (!cached?.snapshot) {
    const diskSnapshot = await _loadFromFile(projectPath);
    if (diskSnapshot) {
      _snapshotCache.set(projectPath, { snapshot: diskSnapshot, timestamp: Date.now() });
      if (changedFiles && changedFiles.length > 0) {
        return updateSnapshot(projectPath, changedFiles, diskSnapshot);
      }
      return diskSnapshot;
    }
    // 3. No disk → full build
    return buildProjectSnapshot(projectPath, opts);
  }

  // 4. Stale cache — incremental update
  return updateSnapshot(projectPath, changedFiles || [], cached.snapshot);
}

// ─── Format for Prompt ──────────────────────────────────────────────────────

/**
 * Format snapshot for LLM prompt injection. Respects token budget.
 * Priority: architecture > API catalog > modules > hotspots > conventions
 *
 * @param {Object} snapshot
 * @param {number} [tokenBudget=3000]
 * @returns {string}
 */
export function formatSnapshotForPrompt(snapshot, tokenBudget = 3000) {
  if (!snapshot) return '';

  const parts = [];
  let tokens = 0;

  // 1. Architecture (highest priority)
  if (snapshot.architecture && _formatArchitectureForPrompt) {
    const archText = _formatArchitectureForPrompt(snapshot.architecture);
    const archTokens = estimateTokens(archText);
    if (tokens + archTokens <= tokenBudget) {
      parts.push(archText);
      tokens += archTokens;
    }
  }

  // 2. Module map summary
  const modules = Object.keys(snapshot.moduleMap || {});
  if (modules.length > 0) {
    const moduleText = '### Project Modules\n' +
      modules.slice(0, 20).map(m => {
        const files = snapshot.moduleMap[m];
        return `- \`${m}/\` (${files.length} files)`;
      }).join('\n');
    const modTokens = estimateTokens(moduleText);
    if (tokens + modTokens <= tokenBudget) {
      parts.push(moduleText);
      tokens += modTokens;
    }
  }

  // 3. Hotspots
  if (snapshot.hotspots?.length > 0) {
    const hotText = '### Hotspots (Most Changed)\n' +
      snapshot.hotspots.slice(0, 5).map(h =>
        `- \`${h.file}\`: ${h.changes} changes`
      ).join('\n');
    const hotTokens = estimateTokens(hotText);
    if (tokens + hotTokens <= tokenBudget) {
      parts.push(hotText);
      tokens += hotTokens;
    }
  }

  // 4. Conventions
  if (snapshot.conventions?.length > 0) {
    const convText = '### Detected Patterns\n' +
      snapshot.conventions.slice(0, 5).map(c =>
        `- **${c.patternName}**: ${c.frequency} occurrences`
      ).join('\n');
    const convTokens = estimateTokens(convText);
    if (tokens + convTokens <= tokenBudget) {
      parts.push(convText);
      tokens += convTokens;
    }
  }

  return parts.join('\n\n');
}

// ─── Snapshot Diff ──────────────────────────────────────────────────────────

/**
 * Compare two snapshots to detect what changed.
 *
 * @param {Object} before
 * @param {Object} after
 * @returns {Object} SnapshotDiff
 */
export function diffSnapshots(before, after) {
  if (!before || !after) return { newModules: [], removedModules: [], changedModules: [] };

  const beforeModules = new Set(Object.keys(before.moduleMap || {}));
  const afterModules = new Set(Object.keys(after.moduleMap || {}));

  return {
    newModules: [...afterModules].filter(m => !beforeModules.has(m)),
    removedModules: [...beforeModules].filter(m => !afterModules.has(m)),
    changedModules: [...afterModules].filter(m => {
      if (!beforeModules.has(m)) return false;
      const bFiles = (before.moduleMap[m] || []).length;
      const aFiles = (after.moduleMap[m] || []).length;
      return bFiles !== aFiles;
    }),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _buildModuleMap(files) {
  const modules = {};
  for (const f of files) {
    const file = typeof f === 'string' ? f : f.file;
    if (!file) continue;
    const parts = file.split('/');
    if (parts.length >= 2) {
      const module = parts.slice(0, 2).join('/');
      if (!modules[module]) modules[module] = [];
      modules[module].push(file);
    }
  }
  return modules;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { _saveToFile, _loadFromFile, SNAPSHOT_SCHEMA_VERSION };

export default {
  buildProjectSnapshot,
  updateSnapshot,
  getOrCreateSnapshot,
  formatSnapshotForPrompt,
  diffSnapshots,
  _saveToFile,
  _loadFromFile,
};
