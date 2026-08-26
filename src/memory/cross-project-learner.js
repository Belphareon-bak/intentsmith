// Cross-Project Learner v116 (F14) — Pattern sharing across projects
// ══════════════════════════════════════════════════════════════════════════════
//
// Extends F5 (task memory) with cross-project query scope:
//   - Shared error patterns: IMPORT_NOT_FOUND in project A → hint for project B
//   - Successful fix strategies: what worked in one project may work in another
//   - Architecture templates: decisions from similar-stack projects
//   - File coupling patterns: common framework patterns (route+controller, etc.)
//
// Relevance scoring weighs stack similarity (same language, same framework)
// and pattern generality (language-agnostic > framework-specific).
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DECAY_LAMBDA = 0.005;           // Same as task memory (half-life ~139d)
const MS_PER_DAY = 86_400_000;
const MAX_CROSS_PROJECT_RESULTS = 10;
const MIN_CONFIDENCE = 0.3;
const STACK_SIMILARITY_BOOST = 0.3;   // Bonus for same tech stack
const GENERALITY_BOOST = 0.2;         // Bonus for language-agnostic patterns

// ─── Pattern Generality ─────────────────────────────────────────────────────

// Error codes that transfer well across projects (not tied to specific codebase)
const GENERAL_ERROR_CODES = new Set([
  'IMPORT_NOT_FOUND',
  'SYNTAX_ERROR',
  'TYPE_MISMATCH',
  'UNDEFINED_VARIABLE',
  'UNUSED_IMPORT',
  'DUPLICATE_IDENTIFIER',
  'MISSING_SEMICOLON',
  'NULL_REFERENCE',
]);

// Architecture decision kinds that generalize across projects
const GENERAL_ARCH_KINDS = new Set([
  'architecture_decision',
]);

// ─── Stack Similarity ───────────────────────────────────────────────────────

/**
 * Compute similarity between two tech stacks.
 * Returns 0–1 where 1 = identical stack.
 *
 * @param {Object} stackA - { language: string, frameworks: string[], tools: string[] }
 * @param {Object} stackB - Same shape
 * @returns {number}
 */
export function computeStackSimilarity(stackA, stackB) {
  if (!stackA || !stackB) return 0;

  let score = 0;
  let factors = 0;

  // Language match (strongest signal)
  if (stackA.language && stackB.language) {
    factors++;
    if (_normalizeStr(stackA.language) === _normalizeStr(stackB.language)) {
      score += 1;
    }
  }

  // Framework overlap (Jaccard similarity)
  const fwA = (stackA.frameworks || []).map(_normalizeStr);
  const fwB = (stackB.frameworks || []).map(_normalizeStr);
  if (fwA.length > 0 || fwB.length > 0) {
    factors++;
    const setA = new Set(fwA);
    const setB = new Set(fwB);
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    score += union > 0 ? intersection / union : 0;
  }

  // Tools overlap (weaker signal)
  const tA = (stackA.tools || []).map(_normalizeStr);
  const tB = (stackB.tools || []).map(_normalizeStr);
  if (tA.length > 0 || tB.length > 0) {
    factors += 0.5;  // Lower weight for tools
    const setA = new Set(tA);
    const setB = new Set(tB);
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    score += (union > 0 ? intersection / union : 0) * 0.5;
  }

  return factors > 0 ? score / factors : 0;
}

function _normalizeStr(s) {
  return (s || '').toLowerCase().trim();
}

// ─── Cross-Project Query ─────────────────────────────────────────────────────

/**
 * Query task memory entries from ALL projects, score by relevance to current.
 *
 * @param {Object} db - Database connection (better-sqlite3)
 * @param {Object} opts
 * @param {string} opts.currentProjectId - Exclude this project (self-learning handled by F5)
 * @param {Array}  opts.errors           - Current errors (NormalizedError[])
 * @param {Array}  opts.files            - Currently modified files
 * @param {Object} opts.currentStack     - Current project tech stack
 * @param {Object} opts.projectStacks    - Map<projectId, stackInfo> for other projects
 * @param {number} [opts.maxResults=10]
 * @param {number} [opts.minConfidence=0.3]
 * @param {boolean} [opts.crossProjectOptIn=false] Explicit user-controlled scope opt-in
 * @returns {Array<{projectId, kind, key, value, confidence, relevanceScore, source}>}
 */
export function queryCrossProject(db, opts = {}) {
  if (opts.crossProjectOptIn !== true) return [];
  if (!db) return [];

  const {
    currentProjectId,
    errors = [],
    files = [],
    currentStack = {},
    projectStacks = {},
    maxResults = MAX_CROSS_PROJECT_RESULTS,
    minConfidence = MIN_CONFIDENCE,
  } = opts;

  if (!currentProjectId) return [];

  try {
    // Get ALL entries from other projects
    const rows = db.prepare(
      'SELECT project_id, kind, key, value, confidence, created_at, access_count FROM task_memory WHERE project_id != ? AND confidence >= ?',
    ).all(currentProjectId, minConfidence);

    if (rows.length === 0) return [];

    const now = Date.now();
    const errorKeys = errors.map(e => `${e.code || 'UNKNOWN'}:${e.file || ''}`);
    const errorCodes = new Set(errors.map(e => e.code || 'UNKNOWN'));
    const results = [];

    for (const row of rows) {
      // Apply time decay
      const ageDays = (now - row.created_at) / MS_PER_DAY;
      const decayedConf = row.confidence * Math.exp(-DECAY_LAMBDA * ageDays);
      if (decayedConf < minConfidence) continue;

      // Compute relevance
      let relevance = 0;

      // 1. Error code match (strongest signal for fix strategies)
      if (row.kind === 'fix_strategy' || row.kind === 'error_pattern') {
        const entryCode = row.key.split(':')[0];
        if (errorCodes.has(entryCode)) {
          relevance += 0.5;
        }
        // Full key prefix match (code:file)
        for (const ek of errorKeys) {
          if (row.key.startsWith(ek)) {
            relevance += 0.2;
            break;
          }
        }
      }

      // 2. Architecture decisions always somewhat relevant
      if (row.kind === 'architecture_decision') {
        relevance += 0.3;
      }

      // 3. Stack similarity boost
      const otherStack = projectStacks[row.project_id];
      if (otherStack) {
        const similarity = computeStackSimilarity(currentStack, otherStack);
        relevance += similarity * STACK_SIMILARITY_BOOST;
      }

      // 4. Generality boost (language-agnostic patterns)
      const entryCode = row.key.split(':')[0];
      if (GENERAL_ERROR_CODES.has(entryCode) || GENERAL_ARCH_KINDS.has(row.kind)) {
        relevance += GENERALITY_BOOST;
      }

      // Skip completely irrelevant entries
      if (relevance <= 0) continue;

      // Final score: decayed confidence × relevance
      const finalScore = decayedConf * relevance;

      results.push({
        projectId: row.project_id,
        kind: row.kind,
        key: row.key,
        value: row.value,
        confidence: decayedConf,
        relevanceScore: finalScore,
        source: 'cross_project',
      });
    }

    // Sort by final score descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, maxResults);
  } catch (err) {
    logger.warn('CrossProjectLearner', `queryCrossProject failed: ${err.message}`);
    return [];
  }
}

// ─── Share Patterns ─────────────────────────────────────────────────────────

/**
 * Identify which patterns from a project are worth sharing (high confidence,
 * general enough to transfer).
 *
 * @param {Array} entries - taskMemory.queryByProject() results
 * @param {Object} [opts]
 * @param {number} [opts.minConfidence=0.7] - Minimum confidence for sharing
 * @param {number} [opts.maxPatterns=20]
 * @returns {Array<{kind, key, value, confidence, shareable: boolean, reason: string}>}
 */
export function identifyShareablePatterns(entries, opts = {}) {
  if (!entries || entries.length === 0) return [];

  const minConfidence = opts.minConfidence ?? 0.7;
  const maxPatterns = opts.maxPatterns ?? 20;
  const now = Date.now();

  const results = [];

  for (const entry of entries) {
    const ageDays = entry.created_at
      ? (now - entry.created_at) / MS_PER_DAY
      : 0;
    const decayedConf = (entry.confidence ?? 0.5) * Math.exp(-DECAY_LAMBDA * ageDays);

    if (decayedConf < minConfidence) continue;

    const entryCode = (entry.key || '').split(':')[0];
    let shareable = false;
    let reason = '';

    // Fix strategies with general error codes are shareable
    if (entry.kind === 'fix_strategy' && GENERAL_ERROR_CODES.has(entryCode)) {
      shareable = true;
      reason = `General fix: ${entryCode}`;
    }

    // Architecture decisions are always shareable
    if (entry.kind === 'architecture_decision') {
      shareable = true;
      reason = 'Architecture decision';
    }

    // High-confidence error patterns are shareable
    if (entry.kind === 'error_pattern' && decayedConf >= 0.8 && GENERAL_ERROR_CODES.has(entryCode)) {
      shareable = true;
      reason = `High-confidence error pattern: ${entryCode}`;
    }

    // High-access-count entries are shareable (battle-tested)
    if ((entry.access_count ?? 0) >= 3 && decayedConf >= minConfidence) {
      shareable = true;
      reason = reason || `Battle-tested (${entry.access_count} uses)`;
    }

    if (shareable) {
      results.push({
        kind: entry.kind,
        key: entry.key,
        value: entry.value,
        confidence: decayedConf,
        shareable,
        reason,
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, maxPatterns);
}

// ─── Format for Prompt ───────────────────────────────────────────────────────

/**
 * Format cross-project insights for LLM prompt injection.
 *
 * @param {Array} entries - From queryCrossProject()
 * @param {Object} [opts]
 * @param {number} [opts.maxTokenBudget=500] - Approximate token budget
 * @returns {string}
 */
export function formatCrossProjectHints(entries, opts = {}) {
  if (!entries || entries.length === 0) return '';

  const maxBudget = opts.maxTokenBudget ?? 500;
  const lines = ['## Cross-Project Insights\n'];
  let approxTokens = 10;

  for (const entry of entries) {
    let line = '';
    try {
      const parsed = JSON.parse(entry.value);
      if (entry.kind === 'fix_strategy') {
        const outcome = parsed.success ? 'WORKED' : 'FAILED';
        line = `- [${outcome}] ${entry.key}: ${parsed.strategy || 'unknown'} (from project ${_shortId(entry.projectId)}, confidence: ${(entry.confidence * 100).toFixed(0)}%)`;
      } else if (entry.kind === 'architecture_decision') {
        line = `- [ARCH] ${parsed.decision || entry.key}: ${parsed.rationale || ''} (from project ${_shortId(entry.projectId)})`;
      } else if (entry.kind === 'error_pattern') {
        line = `- [PATTERN] ${entry.key}: ${parsed.strategy || 'observed failure'} (from project ${_shortId(entry.projectId)})`;
      } else {
        line = `- ${entry.key}: ${entry.value} (from project ${_shortId(entry.projectId)})`;
      }
    } catch (_) {
      line = `- ${entry.key}: ${entry.value}`;
    }

    // Approximate token count (~4 chars per token)
    const lineTokens = Math.ceil(line.length / 4);
    if (approxTokens + lineTokens > maxBudget) break;

    lines.push(line);
    approxTokens += lineTokens;
  }

  if (lines.length <= 1) return '';
  lines.push('');
  return lines.join('\n');
}

function _shortId(projectId) {
  if (!projectId) return '?';
  return projectId.length > 8 ? projectId.slice(0, 8) : projectId;
}

// ─── Merge Results ──────────────────────────────────────────────────────────

/**
 * Merge same-project (F5) and cross-project (F14) results, deduplicating
 * by key and preferring higher-confidence entries.
 *
 * @param {Array} localEntries   - From taskMemory.queryRelevant()
 * @param {Array} crossEntries   - From queryCrossProject()
 * @param {Object} [opts]
 * @param {number} [opts.maxResults=15]
 * @returns {Array}
 */
export function mergeResults(localEntries, crossEntries, opts = {}) {
  const maxResults = opts.maxResults ?? 15;
  const seen = new Map();  // key → entry

  // Local entries take priority
  for (const entry of (localEntries || [])) {
    const dedupKey = `${entry.kind}:${entry.key}`;
    const existing = seen.get(dedupKey);
    if (!existing || (entry.effectiveConfidence ?? entry.confidence ?? 0) > (existing.effectiveConfidence ?? existing.confidence ?? 0)) {
      seen.set(dedupKey, { ...entry, source: entry.source || 'local' });
    }
  }

  // Cross-project entries fill gaps
  for (const entry of (crossEntries || [])) {
    const dedupKey = `${entry.kind}:${entry.key}`;
    if (!seen.has(dedupKey)) {
      seen.set(dedupKey, { ...entry, source: 'cross_project' });
    }
  }

  // Sort by score/confidence descending
  const merged = [...seen.values()].sort((a, b) => {
    const scoreA = a.relevanceScore ?? a.effectiveConfidence ?? a.confidence ?? 0;
    const scoreB = b.relevanceScore ?? b.effectiveConfidence ?? b.confidence ?? 0;
    return scoreB - scoreA;
  });

  return merged.slice(0, maxResults);
}

// ─── Project Registry ───────────────────────────────────────────────────────

/**
 * Get all project IDs that have task memory entries.
 *
 * @param {Object} db - Database connection
 * @returns {string[]}
 */
export function getProjectsWithMemory(db) {
  if (!db) return [];
  try {
    const rows = db.prepare(
      'SELECT DISTINCT project_id FROM task_memory',
    ).all();
    return rows.map(r => r.project_id);
  } catch (err) {
    logger.warn('CrossProjectLearner', `getProjectsWithMemory failed: ${err.message}`);
    return [];
  }
}

/**
 * Get summary stats for all projects.
 *
 * @param {Object} db
 * @returns {Array<{projectId, entryCount, kinds: Object}>}
 */
export function getProjectSummaries(db) {
  if (!db) return [];
  try {
    const rows = db.prepare(
      'SELECT project_id, kind, COUNT(*) as count FROM task_memory GROUP BY project_id, kind',
    ).all();

    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.project_id)) {
        map.set(row.project_id, { projectId: row.project_id, entryCount: 0, kinds: {} });
      }
      const entry = map.get(row.project_id);
      entry.kinds[row.kind] = row.count;
      entry.entryCount += row.count;
    }

    return [...map.values()];
  } catch (err) {
    logger.warn('CrossProjectLearner', `getProjectSummaries failed: ${err.message}`);
    return [];
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  computeStackSimilarity,
  queryCrossProject,
  identifyShareablePatterns,
  formatCrossProjectHints,
  mergeResults,
  getProjectsWithMemory,
  getProjectSummaries,
};
