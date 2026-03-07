// Patch Applier v104 — Apply/Revert/Compose Patch Operations
// ══════════════════════════════════════════════════════════════════════════════
//
// Operates on in-memory content strings. Does NOT touch filesystem.
// The engine module (patch-engine.js) orchestrates file I/O.
//
// Key algorithms:
//   - Bottom-up region application (preserves line offsets)
//   - Backup store for rollback
//   - Patch composition with conflict detection
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { findAnchor, getRegionOffset } from './patch-validator.js';
import { normalizeNewlines } from './patch-parser.js';

// ─── Backup Store ───────────────────────────────────────────────────────────

const _backups = new Map(); // filePath → original content

/**
 * Save original content before patch application.
 * @param {string} filePath - Relative path
 * @param {string} content - Original file content
 */
export function saveBackup(filePath, content) {
  _backups.set(filePath, content);
}

/**
 * Restore original content from backup.
 * @param {string} filePath
 * @returns {string|null} Original content, or null if no backup
 */
export function revertPatch(filePath) {
  const original = _backups.get(filePath);
  if (original === undefined) return null;
  _backups.delete(filePath);
  return original;
}

/**
 * Check if backup exists for a file.
 * @param {string} filePath
 * @returns {boolean}
 */
export function hasBackup(filePath) {
  return _backups.has(filePath);
}

/**
 * Clear all stored backups.
 */
export function clearBackups() {
  _backups.clear();
}

// ─── Apply Patch ────────────────────────────────────────────────────────────

/**
 * Apply a patch to file content. Operates in-memory only.
 *
 * Algorithm:
 *   1. Resolve ALL anchors in single pass against original content
 *   2. Sort by resolved line descending (bottom-up)
 *   3. Splice each region — bottom-up preserves line offsets
 *
 * @param {Object} patch - Patch ADT
 * @param {string} fileContent - Current file content
 * @returns {{ content: string, applied: number, skipped: number, details: Array }}
 */
export function applyPatch(patch, fileContent) {
  const content = normalizeNewlines(fileContent || '');
  const lines = content.split('\n');
  const regions = patch.regions || [];

  if (regions.length === 0) {
    return { content, applied: 0, skipped: 0, details: [] };
  }

  // Step 1: Resolve all anchors against original content
  const resolved = [];
  const skippedDetails = [];

  for (const region of regions) {
    const result = findAnchor(content, region.anchor, region.anchorType, region.contextBefore || null);
    if (!result) {
      skippedDetails.push({ anchor: region.anchor, reason: 'anchor not found' });
      logger.warn('PatchApplier', `Anchor not found, skipping: "${region.anchor}"`, { file: patch.file });
      continue;
    }
    resolved.push({ region, ...result });
  }

  if (resolved.length === 0) {
    return { content, applied: 0, skipped: regions.length, details: skippedDetails };
  }

  // Step 2: Sort descending by anchor line (bottom-up application)
  resolved.sort((a, b) => b.line - a.line);

  // Step 3: Apply each region
  const details = [];

  for (const { region, line: anchorLine, tier } of resolved) {
    const offset = getRegionOffset(region.anchorType);
    const contentLine = anchorLine + offset;
    const oldLen = region.old?.length || 0;
    const newLines = region.new || [];

    if (region.anchorType === 'insert_after') {
      // Insert after anchor line
      lines.splice(anchorLine + 1, 0, ...newLines);
    } else if (oldLen === 0 && newLines.length > 0) {
      // Pure insert at content position
      lines.splice(contentLine, 0, ...newLines);
    } else if (newLines.length === 0 && oldLen > 0) {
      // Deletion
      lines.splice(contentLine, oldLen);
    } else {
      // Replace
      lines.splice(contentLine, oldLen, ...newLines);
    }

    details.push({
      anchor: region.anchor,
      tier,
      startLine: contentLine,
      linesRemoved: oldLen,
      linesAdded: newLines.length,
    });
  }

  // Join and ensure trailing newline
  let result = lines.join('\n');
  if (result.length > 0 && !result.endsWith('\n')) {
    result += '\n';
  }

  return {
    content: result,
    applied: resolved.length,
    skipped: skippedDetails.length,
    details: [...details, ...skippedDetails],
  };
}

// ─── Compose Patch Set ──────────────────────────────────────────────────────

/**
 * Merge patches targeting the same file, detect conflicts.
 *
 * @param {Array<Object>} patches
 * @returns {{ composed: Array<Object>, conflicts: Array }}
 */
export function composePatchSet(patches) {
  if (!patches || patches.length === 0) {
    return { composed: [], conflicts: [] };
  }

  const byFile = new Map(); // file → Patch[]
  for (const p of patches) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }

  const composed = [];
  const conflicts = [];

  for (const [file, filePatchList] of byFile) {
    if (filePatchList.length === 1) {
      composed.push(filePatchList[0]);
      continue;
    }

    // Merge regions from all patches for this file
    const mergedRegions = [];
    const seenAnchors = new Map(); // anchor → patch index

    for (let pi = 0; pi < filePatchList.length; pi++) {
      for (const region of filePatchList[pi].regions || []) {
        if (seenAnchors.has(region.anchor)) {
          conflicts.push({
            file,
            anchor: region.anchor,
            patchIndices: [seenAnchors.get(region.anchor), pi],
            reason: 'Same anchor targeted by multiple patches',
          });
        } else {
          seenAnchors.set(region.anchor, pi);
          mergedRegions.push(region);
        }
      }
    }

    // Pick highest confidence metadata
    const sortedByConf = [...filePatchList].sort((a, b) =>
      (b.metadata?.confidence || 0) - (a.metadata?.confidence || 0));

    composed.push({
      file,
      regions: mergedRegions,
      metadata: {
        ...sortedByConf[0]?.metadata,
        description: filePatchList.map(p => p.metadata?.description).filter(Boolean).join('; '),
      },
    });
  }

  return { composed, conflicts };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

/**
 * Compute metrics for a patch application.
 *
 * @param {Object} patch
 * @param {{ applied: number, skipped: number, details: Array }} applyResult
 * @returns {Object} Metrics
 */
export function computeMetrics(patch, applyResult) {
  const regions = patch.regions || [];
  let linesAdded = 0, linesRemoved = 0, linesModified = 0;

  for (const r of regions) {
    const oldLen = r.old?.length || 0;
    const newLen = r.new?.length || 0;

    if (oldLen === 0 && newLen > 0) {
      linesAdded += newLen;
    } else if (newLen === 0 && oldLen > 0) {
      linesRemoved += oldLen;
    } else {
      linesModified += Math.max(oldLen, newLen);
    }
  }

  // Aggregate anchor resolution tiers from details
  const anchorsResolved = { exact: 0, normalized: 0, ast: 0 };
  for (const d of applyResult.details || []) {
    if (d.tier && anchorsResolved[d.tier] !== undefined) {
      anchorsResolved[d.tier]++;
    }
  }

  return {
    linesChanged: linesAdded + linesRemoved + linesModified,
    linesAdded,
    linesRemoved,
    linesModified,
    filesChanged: 1,
    anchorsResolved,
    applied: applyResult.applied,
    skipped: applyResult.skipped,
  };
}

// ─── Pretty Printer ─────────────────────────────────────────────────────────

/**
 * Format a patch as human-readable diff text.
 *
 * @param {Object} patch - Patch ADT
 * @returns {string}
 */
export function formatPatch(patch) {
  if (!patch) return '';

  const parts = [`--- ${patch.file}`];
  for (const r of patch.regions || []) {
    parts.push(`@@ ${r.anchorType} ${r.anchor}`);
    for (const line of r.old || []) parts.push(`- ${line}`);
    for (const line of r.new || []) parts.push(`+ ${line}`);
  }
  return parts.join('\n');
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  applyPatch,
  saveBackup,
  revertPatch,
  hasBackup,
  clearBackups,
  composePatchSet,
  computeMetrics,
  formatPatch,
};
