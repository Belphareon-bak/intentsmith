// Patch Engine v104 — Main API for Structured Code Patching
// ══════════════════════════════════════════════════════════════════════════════
//
// Orchestrates: parse → validate → apply → verify
// This is the ONLY patch module that touches the filesystem.
//
// Key features:
//   - Atomic writes (tmp + rename)
//   - Rollback on syntax validation failure
//   - PatchSet with automatic rollback on partial failure
//   - Preview mode (dry-run)
//
// F1 is standalone — no integration with lifecycle-build or critic-agent.
// Integration happens in F3 (Execution Loop).
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger.js';
import { parsePatchFromDiff, parsePatchFromFullFile } from './patch-parser.js';
import { validatePatch, validatePatchSet, validateSyntaxPostApply } from './patch-validator.js';
import {
  applyPatch as applyPatchToContent,
  saveBackup, revertPatch as revertFromBackup, clearBackups,
  composePatchSet, computeMetrics, hasBackup, formatPatch,
} from './patch-applier.js';

// ─── Apply Single Patch ─────────────────────────────────────────────────────

/**
 * Apply a single patch to a file.
 *
 * Flow: read → validate → backup → apply → syntax check → atomic write
 * On failure at any stage: revert from backup.
 *
 * @param {Object} patch - Patch ADT
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<{ success: boolean, errors?: string[], metrics?: Object, content?: string }>}
 */
export async function applyPatch(patch, projectRoot) {
  if (!patch || !patch.file) {
    return { success: false, errors: ['Invalid patch: missing file'] };
  }

  const filePath = path.resolve(projectRoot, patch.file);

  // Read current content
  let fileContent = '';
  if (fs.existsSync(filePath)) {
    fileContent = fs.readFileSync(filePath, 'utf-8');
  }

  // Validate
  const fileContents = new Map([[patch.file, fileContent || undefined]]);
  // For new files (pure inserts), don't set in map
  if (!fs.existsSync(filePath)) fileContents.delete(patch.file);

  const validation = validatePatch(patch, fileContents);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  // Log warnings
  for (const w of validation.warnings) {
    logger.warn('PatchEngine', w);
  }

  // Backup original
  saveBackup(patch.file, fileContent);

  // Apply
  const result = applyPatchToContent(patch, fileContent);
  if (result.applied === 0) {
    revertFromBackup(patch.file);
    return { success: false, errors: ['No regions could be applied'] };
  }

  // Syntax validation (AST)
  const syntaxCheck = await validateSyntaxPostApply(result.content, filePath);
  if (!syntaxCheck.valid) {
    revertFromBackup(patch.file);
    return { success: false, errors: [`Syntax error after patch: ${syntaxCheck.error}`] };
  }

  // Atomic write: tmp → rename
  const tmpPath = filePath + '.tmp';
  try {
    // Ensure directory exists for new files
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, result.content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up tmp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    revertFromBackup(patch.file);
    return { success: false, errors: [`Write failed: ${err.message}`] };
  }

  const metrics = computeMetrics(patch, result);

  logger.info('PatchEngine', 'Patch applied', {
    file: patch.file,
    applied: result.applied,
    skipped: result.skipped,
    ...metrics.anchorsResolved,
  });

  return { success: true, metrics, content: result.content };
}

// ─── Preview Patch (Dry-Run) ────────────────────────────────────────────────

/**
 * Preview a patch without writing to disk.
 *
 * @param {Object} patch - Patch ADT
 * @param {string} projectRoot
 * @returns {Promise<{ valid: boolean, errors?: string[], preview?: { before: string, after: string, metrics: Object, formatted: string } }>}
 */
export async function previewPatch(patch, projectRoot) {
  if (!patch || !patch.file) {
    return { valid: false, errors: ['Invalid patch: missing file'] };
  }

  const filePath = path.resolve(projectRoot, patch.file);
  let fileContent = '';
  if (fs.existsSync(filePath)) {
    fileContent = fs.readFileSync(filePath, 'utf-8');
  }

  const fileContents = new Map();
  if (fs.existsSync(filePath)) fileContents.set(patch.file, fileContent);

  const validation = validatePatch(patch, fileContents);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors };
  }

  const result = applyPatchToContent(patch, fileContent);
  if (result.applied === 0) {
    return { valid: false, errors: ['No regions could be applied'] };
  }

  const metrics = computeMetrics(patch, result);

  return {
    valid: true,
    preview: {
      before: fileContent,
      after: result.content,
      metrics,
      formatted: formatPatch(patch),
    },
  };
}

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Rollback a previously applied patch.
 *
 * @param {string} filePath - Relative file path
 * @param {string} projectRoot
 * @returns {{ success: boolean, error?: string }}
 */
export function rollbackPatch(filePath, projectRoot) {
  const original = revertFromBackup(filePath);
  if (original === null) {
    return { success: false, error: 'No backup found for rollback' };
  }

  const absPath = path.resolve(projectRoot, filePath);
  try {
    fs.writeFileSync(absPath, original, 'utf-8');
    logger.info('PatchEngine', 'Patch rolled back', { file: filePath });
    return { success: true };
  } catch (err) {
    return { success: false, error: `Rollback write failed: ${err.message}` };
  }
}

// ─── Apply Patch Set ────────────────────────────────────────────────────────

/**
 * Apply multiple patches with automatic rollback on failure.
 *
 * On any patch failure: rollback ALL previously applied patches in reverse.
 *
 * @param {Array<Object>} patches
 * @param {string} projectRoot
 * @returns {Promise<{ success: boolean, results: Array, errors?: string[] }>}
 */
export async function applyPatchSet(patches, projectRoot) {
  if (!patches || patches.length === 0) {
    return { success: true, results: [] };
  }

  // Build file contents map for validation
  const fileContents = new Map();
  for (const p of patches) {
    const fp = path.resolve(projectRoot, p.file);
    if (fs.existsSync(fp)) {
      fileContents.set(p.file, fs.readFileSync(fp, 'utf-8'));
    }
  }

  // Validate entire set
  const setValidation = validatePatchSet(patches, fileContents);
  if (!setValidation.valid) {
    return { success: false, results: [], errors: setValidation.errors };
  }

  // Compose overlapping patches
  const { composed, conflicts } = composePatchSet(patches);
  if (conflicts.length > 0) {
    return {
      success: false,
      results: [],
      errors: conflicts.map(c => `Conflict in ${c.file}: ${c.reason} (anchor: "${c.anchor}")`),
    };
  }

  // Apply each patch sequentially
  const results = [];
  const appliedFiles = []; // Track for rollback

  for (const patch of composed) {
    const result = await applyPatch(patch, projectRoot);
    results.push({ file: patch.file, ...result });

    if (!result.success) {
      // Rollback all previously applied patches in reverse
      logger.warn('PatchEngine', `PatchSet failed at ${patch.file}, rolling back ${appliedFiles.length} applied patches`);

      for (let i = appliedFiles.length - 1; i >= 0; i--) {
        const rb = rollbackPatch(appliedFiles[i], projectRoot);
        if (!rb.success) {
          logger.error('PatchEngine', `Rollback failed for ${appliedFiles[i]}: ${rb.error}`);
        }
      }

      return {
        success: false,
        results,
        errors: [`PatchSet failed at ${patch.file}: ${result.errors?.join(', ')}`],
      };
    }

    appliedFiles.push(patch.file);
  }

  logger.info('PatchEngine', `PatchSet applied: ${appliedFiles.length} files`, {
    files: appliedFiles,
  });

  return { success: true, results };
}

// ─── Parse LLM Output ──────────────────────────────────────────────────────

/**
 * Parse LLM output into Patch ADT objects.
 * Tries diff parsing first, falls back to full-file diff.
 *
 * @param {string} llmOutput - Raw LLM output
 * @param {Map<string, string>|null} [originalContents] - Map of file → original content for full-file diff fallback
 * @returns {Array<Object>} Patch ADT objects
 */
export function parseLLMOutput(llmOutput, originalContents = null) {
  // Try diff parsing first
  const patches = parsePatchFromDiff(llmOutput);
  if (patches.length > 0) return patches;

  // Fallback: full-file diff (if original contents provided)
  if (!originalContents || originalContents.size === 0) return [];

  const fallbackPatches = [];
  for (const [file, original] of originalContents) {
    const patch = parsePatchFromFullFile(original, llmOutput, file);
    if (patch) fallbackPatches.push(patch);
  }

  return fallbackPatches;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  applyPatch,
  previewPatch,
  rollbackPatch,
  applyPatchSet,
  parseLLMOutput,
};
