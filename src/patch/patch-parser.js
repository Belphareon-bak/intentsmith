// Patch Parser v104 — LLM Output → Patch ADT (Deterministic, No LLM)
// ══════════════════════════════════════════════════════════════════════════════
//
// Parses LLM diff output into structured Patch ADT objects.
// Two paths:
//   1. parsePatchFromDiff()  — parse ```diff blocks with semantic anchors
//   2. parsePatchFromFullFile() — compute diff from original vs new content
//
// All parsing is deterministic — no LLM calls inside this module.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const AnchorType = Object.freeze({
  FUNCTION:     'function',
  CLASS:        'class',
  METHOD:       'method',
  IMPORT:       'import',
  LINE:         'line',
  INSERT_AFTER: 'insert_after',
});

export const PatchType = Object.freeze({
  FIX:      'fix',
  FEATURE:  'feature',
  REFACTOR: 'refactor',
});

// ─── Newline Normalization ──────────────────────────────────────────────────

/**
 * Normalize line endings to LF. Must be called before any parsing.
 * @param {string} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n');
}

// ─── Anchor Type Inference ──────────────────────────────────────────────────

const ANCHOR_PATTERNS = [
  { pattern: /^(?:export\s+)?(?:async\s+)?function\s/, type: AnchorType.FUNCTION },
  { pattern: /^(?:export\s+)?class\s/, type: AnchorType.CLASS },
  { pattern: /^(?:import\s|from\s)/, type: AnchorType.IMPORT },
  { pattern: /\.prototype\./, type: AnchorType.METHOD },
];

function inferAnchorType(anchorText) {
  if (!anchorText) return AnchorType.LINE;
  for (const { pattern, type } of ANCHOR_PATTERNS) {
    if (pattern.test(anchorText)) return type;
  }
  return AnchorType.LINE;
}

// ─── Parse Diff Blocks ─────────────────────────────────────────────────────

/**
 * Parse LLM diff output into Patch ADT objects.
 *
 * Expected format:
 *   ```diff
 *   --- a/src/auth/login.js
 *   @@ function login(user, password)
 *   - return db.find(user)
 *   + if (!user) throw new Error("Missing user")
 *   + return db.find(user)
 *   ```
 *
 * @param {string} llmOutput - Raw LLM output containing diff blocks
 * @returns {Array<Object>} Patch ADT objects
 */
export function parsePatchFromDiff(llmOutput) {
  if (!llmOutput || typeof llmOutput !== 'string') return [];

  const input = normalizeNewlines(llmOutput);

  // Extract diff blocks between fences
  const diffBlocks = [];
  const fenceStart = /```[^\n]*\n/g;
  let match;
  while ((match = fenceStart.exec(input)) !== null) {
    const startIdx = match.index + match[0].length;
    const endIdx = input.indexOf('```', startIdx);
    if (endIdx < 0) break;
    const block = input.substring(startIdx, endIdx).trim();
    if (block.length > 0) diffBlocks.push(block);
  }

  // If no fenced blocks found, try parsing entire input as diff
  if (diffBlocks.length === 0) {
    if (/^---\s/.test(input.trim()) || /^@@\s/.test(input.trim())) {
      diffBlocks.push(input.trim());
    }
  }

  if (diffBlocks.length === 0) return [];

  // Parse each diff block
  const patchesByFile = new Map(); // file → { file, regions[], metadata }

  for (const block of diffBlocks) {
    const lines = block.split('\n');
    let currentFile = null;
    let currentAnchor = null;
    let currentAnchorType = null;
    let contextLines = [];
    let oldLines = [];
    let newLines = [];
    let inRegion = false;

    const flushRegion = () => {
      if (!currentFile || !currentAnchor) return;
      if (oldLines.length === 0 && newLines.length === 0) return;

      if (!patchesByFile.has(currentFile)) {
        patchesByFile.set(currentFile, {
          file: currentFile,
          regions: [],
          metadata: { type: PatchType.FIX, confidence: 0.5, description: '', milestone: '' },
        });
      }

      patchesByFile.get(currentFile).regions.push({
        anchor: currentAnchor,
        anchorType: currentAnchorType || AnchorType.LINE,
        contextBefore: contextLines.length > 0 ? contextLines.join('\n') : '',
        old: [...oldLines],
        new: [...newLines],
      });

      contextLines = [];
      oldLines = [];
      newLines = [];
      inRegion = false;
    };

    for (const line of lines) {
      // File header: --- a/path or --- path
      const fileMatch = line.match(/^---\s+(?:a\/)?(.*)/);
      if (fileMatch) {
        flushRegion();
        currentFile = fileMatch[1].trim();
        continue;
      }

      // Skip +++ header
      if (/^\+\+\+\s/.test(line)) continue;

      // Anchor line: @@ anchorType anchorText or @@ anchorText
      const anchorMatch = line.match(/^@@\s+(.+)$/);
      if (anchorMatch) {
        flushRegion();
        const anchorRaw = anchorMatch[1].trim();

        // Check if anchorType is explicit: "@@ function login("
        const explicitType = anchorRaw.match(/^(function|class|method|import|line|insert_after)\s+(.+)$/);
        if (explicitType) {
          currentAnchorType = explicitType[1];
          currentAnchor = explicitType[2];
        } else {
          currentAnchor = anchorRaw;
          currentAnchorType = inferAnchorType(anchorRaw);
        }
        inRegion = true;
        continue;
      }

      if (!inRegion && !currentAnchor) continue;

      // Diff lines
      if (line.startsWith('-')) {
        oldLines.push(line.substring(1));
        inRegion = true;
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1));
        inRegion = true;
      } else if (inRegion && (oldLines.length > 0 || newLines.length > 0)) {
        // Context line after a diff region — flush current region
        flushRegion();
        contextLines.push(line.startsWith(' ') ? line.substring(1) : line);
      } else {
        // Context line before a diff region
        contextLines.push(line.startsWith(' ') ? line.substring(1) : line);
      }
    }

    // Flush last region
    flushRegion();
  }

  const patches = [...patchesByFile.values()];

  if (patches.length > 0) {
    logger.info('PatchParser', `Parsed ${patches.length} patch(es) from diff`, {
      files: patches.map(p => p.file),
      totalRegions: patches.reduce((s, p) => s + p.regions.length, 0),
    });
  }

  return patches;
}

// ─── Full-File Diff (Fallback) ──────────────────────────────────────────────

const DECLARATION_PATTERN = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|import|def |func )/;

/**
 * Compute diff between original and new file content, producing a Patch ADT.
 * Used as fallback when LLM outputs full file instead of diff.
 *
 * @param {string} originalContent
 * @param {string} newContent
 * @param {string} filePath - Relative path
 * @returns {Object|null} Patch ADT or null if identical/too large
 */
export function parsePatchFromFullFile(originalContent, newContent, filePath) {
  if (!filePath) return null;

  const oldLines = normalizeNewlines(originalContent || '').split('\n');
  const newLines = normalizeNewlines(newContent || '').split('\n');

  // Identical files
  if (oldLines.join('\n') === newLines.join('\n')) return null;

  // Compute changed regions using greedy two-pointer
  const regions = _computeChangedRegions(oldLines, newLines);

  if (regions.length === 0) return null;

  // Size guards
  const totalChanged = regions.reduce((s, r) => s + r.old.length + r.new.length, 0);
  if (totalChanged > 300) {
    logger.warn('PatchParser', `Full-file diff exceeds 300 changed lines (${totalChanged}), skipping`, { file: filePath });
    return null;
  }
  if (regions.length > 20) {
    logger.warn('PatchParser', `Full-file diff has ${regions.length} regions (max 20), skipping`, { file: filePath });
    return null;
  }

  // Assign anchors to each region
  const patchRegions = regions.map(r => {
    const anchor = _findNearestDeclaration(oldLines, r.startLine);
    return {
      anchor: anchor.text,
      anchorType: anchor.type,
      contextBefore: r.startLine > 0 ? oldLines[r.startLine - 1] : '',
      old: r.old,
      new: r.new,
    };
  });

  logger.info('PatchParser', `Computed diff from full file`, {
    file: filePath,
    regions: patchRegions.length,
    totalChanged,
  });

  return {
    file: filePath,
    regions: patchRegions,
    metadata: { type: PatchType.FIX, confidence: 0.3, description: 'Auto-diff from full file', milestone: '' },
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Compute changed regions between two line arrays.
 * Greedy two-pointer: finds contiguous blocks of changes bounded by matching context.
 */
function _computeChangedRegions(oldLines, newLines) {
  const regions = [];
  let oi = 0, ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    // Skip matching lines
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      oi++;
      ni++;
      continue;
    }

    // Start of a diff region
    const startOld = oi;
    const regionOld = [];
    const regionNew = [];

    // Scan forward until we find a re-sync point (3 consecutive matching lines)
    while (oi < oldLines.length || ni < newLines.length) {
      // Check if we've re-synced
      if (oi < oldLines.length && ni < newLines.length) {
        let synced = true;
        for (let k = 0; k < 3 && synced; k++) {
          if (oi + k >= oldLines.length || ni + k >= newLines.length ||
              oldLines[oi + k] !== newLines[ni + k]) {
            synced = false;
          }
        }
        if (synced) break; // Found sync point
      }

      // Consume differing lines
      if (oi < oldLines.length && ni < newLines.length) {
        regionOld.push(oldLines[oi++]);
        regionNew.push(newLines[ni++]);
      } else if (oi < oldLines.length) {
        regionOld.push(oldLines[oi++]);
      } else {
        regionNew.push(newLines[ni++]);
      }
    }

    if (regionOld.length > 0 || regionNew.length > 0) {
      regions.push({ startLine: startOld, old: regionOld, new: regionNew });
    }
  }

  return regions;
}

/**
 * Find the nearest preceding declaration for use as a semantic anchor.
 */
function _findNearestDeclaration(lines, targetLine) {
  for (let i = targetLine; i >= 0; i--) {
    const line = lines[i];
    if (DECLARATION_PATTERN.test(line)) {
      return { text: line.trim(), type: inferAnchorType(line.trim()) };
    }
  }
  // No declaration found — use the target line itself
  const fallbackLine = lines[targetLine] || '';
  return { text: fallbackLine.trim() || `line ${targetLine + 1}`, type: AnchorType.LINE };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  AnchorType,
  PatchType,
  normalizeNewlines,
  parsePatchFromDiff,
  parsePatchFromFullFile,
};
