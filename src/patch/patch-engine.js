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

import { logger } from '../core/logger.js';
import {
  isProjectPathError,
  readProjectFile,
  resolveProjectTarget,
  writeProjectFileAtomic,
} from '../executor/project-path-authority.js';
import { parsePatchFromDiff, parsePatchFromFullFile } from './patch-parser.js';
import { validatePatch, validatePatchSet, validateSyntaxPostApply } from './patch-validator.js';
import {
  applyPatch as applyPatchToContent,
  saveBackup, revertPatch as revertFromBackup, clearBackups,
  composePatchSet, computeMetrics, hasBackup, formatPatch,
} from './patch-applier.js';

function projectPathFailure(error, { preview = false } = {}) {
  if (!isProjectPathError(error)) throw error;

  const message = `Project path rejected (${error.reason || 'unknown'})`;
  const pathAuthority = {
    reason: error.reason || 'unknown',
    projectRoot: error?.detail?.projectRoot || null,
    target: error?.detail?.target || null,
  };

  return preview
    ? { valid: false, state: 'project_path_violation', pathAuthority, errors: [message] }
    : {
      success: false,
      written: false,
      state: 'project_path_violation',
      pathAuthority,
      errors: [message],
    };
}

function ioFailure(error, operation, { preview = false } = {}) {
  const state = `${operation}_failed`;
  const message = `${operation[0].toUpperCase()}${operation.slice(1)} failed: ${error.message}`;
  return preview
    ? { valid: false, state, errors: [message] }
    : { success: false, written: false, state, errors: [message] };
}

// ─── Apply Single Patch ─────────────────────────────────────────────────────

/**
 * Apply a single patch to a file.
 *
 * Flow: read → validate → backup → apply → syntax check → atomic write
 * On failure at any stage: revert from backup.
 *
 * @param {Object} patch - Patch ADT
 * @param {string} projectRoot - Project root directory
 * @param {Object} [options]
 * @param {Object} [options.fileSystem] injectable filesystem for boundary tests
 * @returns {Promise<{ success: boolean, state?: string, errors?: string[], metrics?: Object, content?: string }>}
 */
export async function applyPatch(patch, projectRoot, options = {}) {
  if (!patch || !patch.file) {
    return { success: false, errors: ['Invalid patch: missing file'] };
  }

  let read;
  try {
    read = readProjectFile(projectRoot, patch.file, {
      fileSystem: options.fileSystem,
    });
  } catch (error) {
    if (isProjectPathError(error)) return projectPathFailure(error);
    return ioFailure(error, 'read');
  }
  const filePath = read.target.real;
  const fileContent = read.content;

  // Validate
  const fileContents = new Map([[patch.file, fileContent || undefined]]);
  // For new files (pure inserts), don't set in map
  if (!read.exists) fileContents.delete(patch.file);

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

  // Atomic write through the same project boundary used for preview/read.
  try {
    writeProjectFileAtomic(projectRoot, patch.file, result.content, {
      expectedTarget: read.target,
      fileSystem: options.fileSystem,
    });
  } catch (err) {
    revertFromBackup(patch.file);
    if (isProjectPathError(err)) return projectPathFailure(err);
    return ioFailure(err, 'write');
  }

  const metrics = computeMetrics(patch, result);

  logger.info('PatchEngine', 'Patch applied', {
    file: patch.file,
    applied: result.applied,
    skipped: result.skipped,
    ...metrics.anchorsResolved,
  });

  return { success: true, written: true, state: 'written', metrics, content: result.content };
}

// ─── Preview Patch (Dry-Run) ────────────────────────────────────────────────

/**
 * Preview a patch without writing to disk.
 *
 * @param {Object} patch - Patch ADT
 * @param {string} projectRoot
 * @returns {Promise<{ valid: boolean, errors?: string[], preview?: { before: string, after: string, metrics: Object, formatted: string } }>}
 */
export async function previewPatch(patch, projectRoot, options = {}) {
  if (!patch || !patch.file) {
    return { valid: false, errors: ['Invalid patch: missing file'] };
  }

  let read;
  try {
    read = readProjectFile(projectRoot, patch.file, {
      fileSystem: options.fileSystem,
    });
  } catch (error) {
    if (isProjectPathError(error)) return projectPathFailure(error, { preview: true });
    return ioFailure(error, 'read', { preview: true });
  }
  const fileContent = read.content;

  const fileContents = new Map();
  if (read.exists) fileContents.set(patch.file, fileContent);

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
export function rollbackPatch(filePath, projectRoot, options = {}) {
  // Validate before consuming the process-local backup.  A traversal reject
  // must not destroy the only rollback material even though no effect began.
  let target;
  try {
    target = resolveProjectTarget(projectRoot, filePath, {
      fileSystem: options.fileSystem,
    });
  } catch (error) {
    if (isProjectPathError(error)) {
      const failure = projectPathFailure(error);
      return {
        success: false,
        state: failure.state,
        pathAuthority: failure.pathAuthority,
        error: failure.errors[0],
      };
    }
    return {
      success: false,
      state: 'read_failed',
      error: `Rollback preflight failed: ${error.message}`,
    };
  }

  const original = revertFromBackup(filePath);
  if (original === null) {
    return { success: false, state: 'no_backup', error: 'No backup found for rollback' };
  }

  try {
    writeProjectFileAtomic(projectRoot, filePath, original, {
      expectedTarget: target,
      fileSystem: options.fileSystem,
    });
    logger.info('PatchEngine', 'Patch rolled back', { file: filePath });
    return { success: true, state: 'written' };
  } catch (err) {
    if (isProjectPathError(err)) {
      const failure = projectPathFailure(err);
      return {
        success: false,
        state: failure.state,
        pathAuthority: failure.pathAuthority,
        error: failure.errors[0],
      };
    }
    return { success: false, state: 'write_failed', error: `Rollback write failed: ${err.message}` };
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
export async function applyPatchSet(patches, projectRoot, options = {}) {
  if (!patches || patches.length === 0) {
    return { success: true, results: [] };
  }

  // Preflight every target before reading or writing the first file.  Without
  // this, a valid first patch could become visible before a later traversal is
  // rejected.
  try {
    for (const patch of patches) {
      resolveProjectTarget(projectRoot, patch.file, {
        fileSystem: options.fileSystem,
      });
    }
  } catch (error) {
    if (isProjectPathError(error)) {
      const failure = projectPathFailure(error);
      return {
        success: false,
        results: [],
        state: failure.state,
        pathAuthority: failure.pathAuthority,
        errors: failure.errors,
      };
    }
    const failure = ioFailure(error, 'read');
    return { ...failure, results: [] };
  }

  // Build file contents map for validation
  const fileContents = new Map();
  for (const p of patches) {
    try {
      const read = readProjectFile(projectRoot, p.file, {
        fileSystem: options.fileSystem,
      });
      if (read.exists) fileContents.set(p.file, read.content);
    } catch (error) {
      if (isProjectPathError(error)) {
        const failure = projectPathFailure(error);
        return {
          success: false,
          results: [],
          state: failure.state,
          pathAuthority: failure.pathAuthority,
          errors: failure.errors,
        };
      }
      const failure = ioFailure(error, 'read');
      return { ...failure, results: [] };
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
    const result = await applyPatch(patch, projectRoot, options);
    results.push({ file: patch.file, ...result });

    if (!result.success) {
      // Rollback all previously applied patches in reverse
      logger.warn('PatchEngine', `PatchSet failed at ${patch.file}, rolling back ${appliedFiles.length} applied patches`);

      for (let i = appliedFiles.length - 1; i >= 0; i--) {
        const rb = rollbackPatch(appliedFiles[i], projectRoot, options);
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
