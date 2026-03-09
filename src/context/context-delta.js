// Context Delta Engine v110 (FΔ) — Incremental context compression for execution loop
// ══════════════════════════════════════════════════════════════════════════════
//
// Problem: Each execution loop iteration sends full context (~3000-6000 tokens).
// Most of this is unchanged between iterations. Delta engine sends only changes
// on iteration 2+, reducing prompt size by 50-80%.
//
// Pipeline:
//   createContextSnapshot(context) → computeContextDelta(prev, curr) →
//   formatDeltaForPrompt(delta, fullContext) OR formatFullContext(context)
//
// Sections tracked: errors, patches, files, taskMemory, critique, gitDiff
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SECTION_NAMES = ['errors', 'patches', 'files', 'taskMemory', 'critique', 'gitDiff'];

// ─── Hashing ────────────────────────────────────────────────────────────────

/**
 * Fast deterministic string fingerprint (FNV-1a 32-bit).
 * Not cryptographic — used only for content equality comparison.
 *
 * @param {string} str
 * @returns {string} Hex hash
 */
export function hashSection(str) {
  if (!str && str !== '') return '0';
  const s = String(str);
  if (s.length === 0) return '0';

  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, unsigned
  }
  return hash.toString(16);
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

/**
 * Create a snapshot of all context sections for delta comparison.
 *
 * @param {Object} context
 * @param {string} context.errors - Formatted error text
 * @param {string} context.patches - Formatted patch text
 * @param {string} context.files - Modified files list
 * @param {string} context.taskMemory - Task memory context
 * @param {string} context.critique - Self-critique context
 * @param {string} context.gitDiff - Git diff text
 * @returns {Object} Snapshot with hashes + raw content
 */
export function createContextSnapshot(context) {
  if (!context) {
    return {
      hashes: {},
      sections: {},
      timestamp: Date.now(),
    };
  }

  const sections = {};
  const hashes = {};

  for (const name of SECTION_NAMES) {
    const value = context[name] ?? '';
    sections[name] = value;
    hashes[name] = hashSection(value);
  }

  return { hashes, sections, timestamp: Date.now() };
}

// ─── Delta Computation ──────────────────────────────────────────────────────

/**
 * Compute what changed between two snapshots.
 *
 * @param {Object|null} prevSnapshot - Previous snapshot (null = first iteration)
 * @param {Object} currentSnapshot - Current snapshot
 * @returns {Object} Delta result
 */
export function computeContextDelta(prevSnapshot, currentSnapshot) {
  if (!currentSnapshot) {
    return {
      isFirstIteration: true,
      changed: new Set(SECTION_NAMES),
      unchanged: [],
      delta: {},
      stats: { sectionsChanged: SECTION_NAMES.length, sectionsUnchanged: 0 },
    };
  }

  // First iteration: everything is "changed"
  if (!prevSnapshot) {
    return {
      isFirstIteration: true,
      changed: new Set(SECTION_NAMES),
      unchanged: [],
      delta: {},
      stats: { sectionsChanged: SECTION_NAMES.length, sectionsUnchanged: 0 },
    };
  }

  const changed = new Set();
  const unchanged = [];
  const delta = {};

  for (const name of SECTION_NAMES) {
    const prevHash = prevSnapshot.hashes?.[name] ?? '0';
    const currHash = currentSnapshot.hashes?.[name] ?? '0';

    if (prevHash !== currHash) {
      changed.add(name);

      // Compute section-specific deltas
      if (name === 'errors') {
        delta.errors = _computeErrorDelta(
          prevSnapshot.sections?.errors ?? '',
          currentSnapshot.sections?.errors ?? ''
        );
      }
    } else {
      unchanged.push(name);
    }
  }

  return {
    isFirstIteration: false,
    changed,
    unchanged,
    delta,
    stats: {
      sectionsChanged: changed.size,
      sectionsUnchanged: unchanged.length,
    },
  };
}

// ─── Error Delta ────────────────────────────────────────────────────────────

/**
 * Parse error lines and compute added/resolved.
 * Error format from formatErrorsForLLM: "- [CODE] file:line message"
 */
function _computeErrorDelta(prevErrors, currErrors) {
  const parse = text => {
    if (!text) return new Set();
    return new Set(
      text.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- [') || l.startsWith('ROOT:') || l.startsWith('DEP:'))
    );
  };

  const prev = parse(prevErrors);
  const curr = parse(currErrors);

  const added = [...curr].filter(e => !prev.has(e));
  const resolved = [...prev].filter(e => !curr.has(e));
  const unchanged = [...curr].filter(e => prev.has(e));

  return { added, resolved, unchanged, addedCount: added.length, resolvedCount: resolved.length };
}

// ─── Prompt Formatting ──────────────────────────────────────────────────────

/**
 * Format a full context for iteration 1 (no compression).
 *
 * @param {Object} snapshot - From createContextSnapshot()
 * @returns {string} Full context prompt text
 */
export function formatFullContext(snapshot) {
  if (!snapshot?.sections) return '';

  const parts = [];
  const s = snapshot.sections;

  if (s.errors) parts.push(s.errors);
  if (s.taskMemory) parts.push(`\n## Past Fix Experience\n${s.taskMemory}`);
  if (s.critique) parts.push(`\n## Self-Critique Analysis\n${s.critique}`);
  if (s.patches) parts.push(`\n## Previous Patches\n${s.patches}`);
  if (s.gitDiff) parts.push(`\n## Current Git Diff\n${s.gitDiff}`);

  return parts.join('\n');
}

/**
 * Format a delta context for iteration 2+ (compressed).
 * Only includes changed sections; summarizes unchanged ones.
 *
 * @param {Object} deltaResult - From computeContextDelta()
 * @param {Object} currentSnapshot - Current full snapshot (for changed sections)
 * @returns {string} Delta prompt text
 */
export function formatDeltaForPrompt(deltaResult, currentSnapshot) {
  if (!deltaResult || !currentSnapshot) return '';

  // First iteration → full context
  if (deltaResult.isFirstIteration) {
    return formatFullContext(currentSnapshot);
  }

  const parts = [];
  const s = currentSnapshot.sections || {};

  // Always include current errors (even if unchanged — LLM needs error context)
  if (s.errors) {
    if (deltaResult.changed.has('errors') && deltaResult.delta?.errors) {
      const ed = deltaResult.delta.errors;
      parts.push(`## Error Changes Since Last Iteration`);
      if (ed.resolvedCount > 0) {
        parts.push(`RESOLVED (${ed.resolvedCount}):`);
        for (const e of ed.resolved) parts.push(`  ✓ ${e}`);
      }
      if (ed.addedCount > 0) {
        parts.push(`NEW ERRORS (${ed.addedCount}):`);
        for (const e of ed.added) parts.push(`  ✗ ${e}`);
      }
      if (ed.unchanged.length > 0) {
        parts.push(`REMAINING (${ed.unchanged.length}):`);
        for (const e of ed.unchanged) parts.push(`  • ${e}`);
      }
    } else {
      parts.push(`## Errors (unchanged from last iteration)`);
      parts.push(s.errors);
    }
  }

  // Changed sections: include full content
  if (deltaResult.changed.has('critique') && s.critique) {
    parts.push(`\n## Self-Critique Analysis (updated)`);
    parts.push(s.critique);
  }

  if (deltaResult.changed.has('patches') && s.patches) {
    parts.push(`\n## Previous Patches (updated)`);
    parts.push(s.patches);
  }

  if (deltaResult.changed.has('gitDiff') && s.gitDiff) {
    parts.push(`\n## Current Git Diff (updated)`);
    parts.push(s.gitDiff);
  }

  // Unchanged sections: single-line summary
  const unchangedNonEmpty = deltaResult.unchanged.filter(name => {
    const val = s[name];
    return val && val.trim().length > 0 && name !== 'errors'; // errors always shown
  });

  if (unchangedNonEmpty.length > 0) {
    parts.push(`\n[Unchanged from previous iteration: ${unchangedNonEmpty.join(', ')}]`);
  }

  return parts.join('\n');
}

// ─── Estimator ──────────────────────────────────────────────────────────────

/**
 * Estimate token savings from delta compression.
 *
 * @param {string} fullPrompt - Full context text
 * @param {string} deltaPrompt - Delta context text
 * @returns {{ fullTokens: number, deltaTokens: number, saved: number, ratio: number }}
 */
export function estimateTokenSavings(fullPrompt, deltaPrompt) {
  // Rough estimate: 1 token ≈ 4 characters
  const CHARS_PER_TOKEN = 4;
  const fullTokens = Math.ceil((fullPrompt || '').length / CHARS_PER_TOKEN);
  const deltaTokens = Math.ceil((deltaPrompt || '').length / CHARS_PER_TOKEN);
  const saved = fullTokens - deltaTokens;
  const ratio = fullTokens > 0 ? saved / fullTokens : 0;

  return { fullTokens, deltaTokens, saved, ratio };
}
