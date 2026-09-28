// Pattern Miner v109 (F8) — Cross-milestone pattern discovery
// ══════════════════════════════════════════════════════════════════════════════
//
// Discovers recurring patterns from task memory (F5) and execution history:
//   - Error cascades: same root cause → same downstream errors
//   - Fix archetypes: same error code → same fix strategy works
//   - File coupling: files A and B always modified together
//   - Complexity hotspots: same files cause errors repeatedly
//
// Scoring: confidence threshold 0.7, decay half-life ~69 days (LTM-aligned).
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.7;
const DECAY_LAMBDA = 0.01;            // half-life ~69 days (same as LTM)
const MS_PER_DAY = 86_400_000;
const MIN_OCCURRENCES = 2;            // Minimum times a pattern must appear
const MAX_PATTERNS = 50;              // Cap on returned patterns

// ─── Pattern Types ──────────────────────────────────────────────────────────

export const PatternType = Object.freeze({
  ERROR_CASCADE: 'error_cascade',
  FIX_ARCHETYPE: 'fix_archetype',
  FILE_COUPLING: 'file_coupling',
  COMPLEXITY_HOTSPOT: 'complexity_hotspot',
});

// ─── minePatterns ───────────────────────────────────────────────────────────

/**
 * Discover patterns from task memory entries.
 *
 * @param {Array} entries - From taskMemory.queryByProject(projectId)
 * @param {Object} [opts] - {minConfidence?: 0.7, maxPatterns?: 50}
 * @returns {Array<{type, key, description, confidence, occurrences, data}>}
 */
export function minePatterns(entries, opts = {}) {
  if (!entries || entries.length === 0) return [];

  const minConfidence = opts.minConfidence ?? CONFIDENCE_THRESHOLD;
  const maxPatterns = opts.maxPatterns ?? MAX_PATTERNS;
  const now = Date.now();

  const patterns = [];

  // Phase 1: Fix archetypes — successful fix strategies for specific error codes
  patterns.push(...findFixArchetypes(entries, now, minConfidence));

  // Phase 2: Error cascades — repeated root cause → downstream patterns
  patterns.push(...findErrorCascades(entries, now, minConfidence));

  // Phase 3: File coupling — files that appear together in fix entries
  patterns.push(...findFileCoupling(entries, now, minConfidence));

  // Phase 4: Complexity hotspots — files that repeatedly cause errors
  patterns.push(...findComplexityHotspots(entries, now, minConfidence));

  // Sort by confidence descending, cap at max
  patterns.sort((a, b) => b.confidence - a.confidence);
  return patterns.slice(0, maxPatterns);
}

// ─── Fix Archetypes ─────────────────────────────────────────────────────────

/**
 * Find successful fix strategies that were applied for specific error codes.
 */
function findFixArchetypes(entries, now, minConfidence) {
  const patterns = [];

  // Group successful fixes by error code
  const codeStrategies = new Map(); // errorCode → [{strategy, confidence, created_at}]

  for (const entry of entries) {
    if (entry.kind !== 'fix_strategy') continue;
    try {
      const val = JSON.parse(entry.value);
      if (!val.success) continue;

      const errorCode = entry.key.split(':')[0];
      if (!errorCode || errorCode === 'UNKNOWN') continue;

      if (!codeStrategies.has(errorCode)) codeStrategies.set(errorCode, []);
      codeStrategies.get(errorCode).push({
        strategy: val.strategy,
        confidence: entry.confidence,
        created_at: entry.created_at,
        key: entry.key,
      });
    } catch (_) {}
  }

  for (const [errorCode, strategies] of codeStrategies) {
    if (strategies.length < MIN_OCCURRENCES) continue;

    // Find dominant strategy (most frequent)
    const stratCounts = new Map();
    for (const s of strategies) {
      const key = s.strategy.slice(0, 100); // normalize
      stratCounts.set(key, (stratCounts.get(key) || 0) + 1);
    }

    let dominant = null, maxCount = 0;
    for (const [strat, count] of stratCounts) {
      if (count > maxCount) { dominant = strat; maxCount = count; }
    }

    // Apply decay to average confidence
    const avgConf = strategies.reduce((sum, s) => {
      const ageDays = (now - s.created_at) / MS_PER_DAY;
      return sum + s.confidence * Math.exp(-DECAY_LAMBDA * ageDays);
    }, 0) / strategies.length;

    if (avgConf >= minConfidence) {
      patterns.push({
        type: PatternType.FIX_ARCHETYPE,
        key: `archetype:${errorCode}`,
        description: `${errorCode} → "${dominant}" (${strategies.length} occurrences)`,
        confidence: avgConf,
        occurrences: strategies.length,
        data: { errorCode, strategy: dominant, count: maxCount },
      });
    }
  }

  return patterns;
}

// ─── Error Cascades ─────────────────────────────────────────────────────────

/**
 * Find error patterns where the same root cause repeatedly produces
 * the same set of downstream errors.
 */
function findErrorCascades(entries, now, minConfidence) {
  const patterns = [];

  // Group error patterns by error code
  const codeCounts = new Map(); // errorCode → {count, files: Set, totalConf}
  for (const entry of entries) {
    if (entry.kind !== 'error_pattern') continue;
    const errorCode = entry.key.split(':')[0];
    if (!errorCode || errorCode === 'UNKNOWN') continue;

    const existing = codeCounts.get(errorCode) || { count: 0, files: new Set(), totalConf: 0 };
    existing.count++;
    const file = entry.key.split(':')[1];
    if (file) existing.files.add(file);

    const ageDays = (now - entry.created_at) / MS_PER_DAY;
    existing.totalConf += entry.confidence * Math.exp(-DECAY_LAMBDA * ageDays);
    codeCounts.set(errorCode, existing);
  }

  for (const [errorCode, data] of codeCounts) {
    if (data.count < MIN_OCCURRENCES) continue;
    const avgConf = data.totalConf / data.count;
    if (avgConf < minConfidence) continue;

    patterns.push({
      type: PatternType.ERROR_CASCADE,
      key: `cascade:${errorCode}`,
      description: `${errorCode} recurring in ${data.files.size} file(s), ${data.count} occurrence(s)`,
      confidence: avgConf,
      occurrences: data.count,
      data: { errorCode, files: [...data.files], count: data.count },
    });
  }

  return patterns;
}

// ─── File Coupling ──────────────────────────────────────────────────────────

/**
 * Find files that are frequently modified together in fix attempts.
 */
function findFileCoupling(entries, now, minConfidence) {
  const patterns = [];

  // Collect (file, patchFile) pairs from fixes
  const pairs = new Map(); // "fileA|fileB" → {count, totalConf}

  for (const entry of entries) {
    if (entry.kind !== 'fix_strategy' && entry.kind !== 'error_pattern') continue;
    try {
      const val = JSON.parse(entry.value);
      const errorFile = entry.key.split(':')[1];
      const patchFile = val.patchFile;

      if (!errorFile || !patchFile || errorFile === patchFile) continue;

      // Normalize pair key (alphabetical order)
      const pair = [errorFile, patchFile].sort().join('|');
      const existing = pairs.get(pair) || { count: 0, totalConf: 0 };
      existing.count++;

      const ageDays = (now - entry.created_at) / MS_PER_DAY;
      existing.totalConf += entry.confidence * Math.exp(-DECAY_LAMBDA * ageDays);
      pairs.set(pair, existing);
    } catch (_) {}
  }

  for (const [pair, data] of pairs) {
    if (data.count < MIN_OCCURRENCES) continue;
    const avgConf = data.totalConf / data.count;
    if (avgConf < minConfidence) continue;

    const [fileA, fileB] = pair.split('|');
    patterns.push({
      type: PatternType.FILE_COUPLING,
      key: `coupling:${pair}`,
      description: `${fileA} ↔ ${fileB} modified together ${data.count} time(s)`,
      confidence: avgConf,
      occurrences: data.count,
      data: { files: [fileA, fileB], count: data.count },
    });
  }

  return patterns;
}

// ─── Complexity Hotspots ────────────────────────────────────────────────────

/**
 * Find files that repeatedly cause errors.
 */
function findComplexityHotspots(entries, now, minConfidence) {
  const patterns = [];

  // Count errors per file
  const fileCounts = new Map(); // file → {errorCount, fixCount, totalConf}

  for (const entry of entries) {
    const file = entry.key.split(':')[1];
    if (!file) continue;

    const existing = fileCounts.get(file) || { errorCount: 0, fixCount: 0, totalConf: 0 };
    if (entry.kind === 'error_pattern') existing.errorCount++;
    if (entry.kind === 'fix_strategy') existing.fixCount++;

    const ageDays = (now - entry.created_at) / MS_PER_DAY;
    existing.totalConf += entry.confidence * Math.exp(-DECAY_LAMBDA * ageDays);
    fileCounts.set(file, existing);
  }

  for (const [file, data] of fileCounts) {
    const total = data.errorCount + data.fixCount;
    if (total < 3) continue; // higher bar for hotspots
    const avgConf = data.totalConf / total;
    if (avgConf < minConfidence) continue;

    patterns.push({
      type: PatternType.COMPLEXITY_HOTSPOT,
      key: `hotspot:${file}`,
      description: `${file}: ${data.errorCount} error(s), ${data.fixCount} fix(es)`,
      confidence: avgConf,
      occurrences: total,
      data: { file, errorCount: data.errorCount, fixCount: data.fixCount },
    });
  }

  return patterns;
}

// ─── findArchetypes ─────────────────────────────────────────────────────────

/**
 * Find known fix strategies for current errors.
 * Used by execution loop to suggest strategies before LLM call.
 *
 * @param {Array} errors - NormalizedError[]
 * @param {Array} patterns - From minePatterns()
 * @returns {Array<{errorCode, strategy, confidence}>}
 */
export function findArchetypes(errors, patterns) {
  if (!errors || !patterns) return [];

  const archetypes = patterns.filter(p => p.type === PatternType.FIX_ARCHETYPE);
  const results = [];

  for (const err of errors) {
    const matching = archetypes.find(a => a.data.errorCode === err.code);
    if (matching) {
      results.push({
        errorCode: err.code,
        strategy: matching.data.strategy,
        confidence: matching.confidence,
      });
    }
  }

  return results;
}

// ─── formatPatternsForPrompt ────────────────────────────────────────────────

/**
 * Format mined patterns for LLM prompt injection.
 *
 * @param {Array} patterns - From minePatterns()
 * @param {number} [maxEntries=5]
 * @returns {string}
 */
export function formatPatternsForPrompt(patterns, maxEntries = 5) {
  if (!patterns || patterns.length === 0) return '';

  return patterns.slice(0, maxEntries).map(p => {
    const conf = (p.confidence * 100).toFixed(0);
    return `- [${p.type}] ${p.description} (${conf}% confidence)`;
  }).join('\n');
}
