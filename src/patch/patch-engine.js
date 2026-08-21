// Patch Engine v104 — Main API for Structured Code Patching
// ══════════════════════════════════════════════════════════════════════════════
//
// Orchestrates: parse → validate → apply → verify
// This is the ONLY patch module that touches the filesystem.
//
// Key features:
//   - Rollback on syntax validation failure
//   - PatchSet with automatic rollback on partial failure
//   - Preview mode (dry-run)
//
// ── M2: zápis jde sdílenou cestou, ne vlastní ─────────────────────────────
//
// Do `M2` měl tenhle modul **vlastní** `tmp + rename`.  Dělal ho hůř, než ho
// dnes dělá `atomic-write.js` (žádný `fsync`, temp jméno `path + '.tmp'`, které
// se dvěma běhy sráží, zahozená práva cíle) — a hlavně ho dělal **mimo zámek**,
// takže dva běhy nad jedním souborem o sobě nevěděly.
//
// Teď jde zápis přes `writeUserFile`.  Není to approval na každý patch:
// rozhodnutí `028` říká, že se agent běžně **neptá**, a politika (`write-policy.js`)
// otázku vyvolá jen u pojmenovaných kategorií.  Co se získalo, je to ostatní —
// zámek, kanonický cíl, atomická náhrada s právy a `fsync`, a záznam.
//
// **Zápis nemusí nastat** a modul to musí umět říct.  `writeUserFile` vrací
// jméno stavu (`locked`, `rejected`, `precondition_changed`, `cancelled`,
// `refused_unconfigured`, …), ne `false`; `applyPatch` ho propouští dál pod
// klíčem `state`, aby smyčka nad ním nemusela hádat, jestli se nezapsalo,
// selhalo, nebo osiřelo.
//
// Záloha je **v paměti** (`patch-applier.js`), takže „revert" po nezapsaném
// patchi znamená zahodit záznam, ne psát na disk.  Kdyby se zálohovalo
// zápisem, byla by tahle cesta nekonzistentní přesně v tom případě, kvůli
// kterému existuje.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger.js';
import { writeUserFile } from '../executor/effects.js';
import { describeWorkspace } from '../executor/file-lock.js';
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
 * Flow: read → validate → backup → apply → syntax check → sdílený zápis
 * On failure at any stage: revert from backup.
 *
 * @param {Object} patch - Patch ADT
 * @param {string} projectRoot - Project root directory
 * @param {Object} [options]
 * @param {string} options.runId   **povinné** — vlastník zámku.  Identita
 *   tahu/běhu, ne relace: dvě iterace téže smyčky si nesmí navzájem projít
 *   zámkem jen proto, že sedí ve stejné konverzaci.
 * @param {AbortSignal} [options.signal]  zrušení běhu zastaví zápis
 * @param {Object} [options.workspace]  výsledek `describeWorkspace(projectRoot)`;
 *   předává ho `applyPatchSet`, aby se `git` nevolal na každý patch zvlášť
 * @param {string} [options.ownerLabel]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ success: boolean, state?: string, errors?: string[], metrics?: Object, content?: string }>}
 */
export async function applyPatch(patch, projectRoot, options = {}) {
  const { runId = null, signal = null, ownerLabel = 'patch-engine', timeoutMs = null } = options;

  // Chybějící `runId` je vada volajícího, ne běhový stav — proto výjimka, ne
  // `{ success: false }`.  Zámek bez vlastníka je jen zpomalení a modul, který
  // by si vlastníka vymyslel sám, by tiše zrušil ochranu, kvůli které tudy
  // zápis vede.
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new Error('applyPatch: runId required — zápis musí mít vlastníka (běh, ne relace)');
  }

  if (!patch || !patch.file) {
    return { success: false, errors: ['Invalid patch: missing file'] };
  }

  const workspace = options.workspace || describeWorkspace(projectRoot);

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

  // Zápis — sdílenou cestou.  Adresáře pro nové soubory dělá `commitFile`.
  let write;
  try {
    write = await writeUserFile({
      filePath, content: result.content, runId, signal, workspace,
      ownerLabel,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  } catch (err) {
    // Výjimka = zápis se pokusil a rozbil se (I/O, práva).  Na disku po sobě
    // `commitFile` uklidí temp; tady zbývá zahodit zálohu, protože cíl se
    // nezměnil.
    revertFromBackup(patch.file);
    return { success: false, written: false, state: 'write_failed', errors: [`Write failed: ${err.message}`] };
  }

  if (!write.written) {
    // **Nezapsáno není totéž co selhalo.**  Zamčený soubor, zamítnutá otázka
    // a změněný předpoklad jsou tři různé věci a smyčka se podle nich chová
    // různě — proto se jméno stavu propouští dál, ne `false`.
    revertFromBackup(patch.file);
    logger.warn('PatchEngine', `Patch not written (${write.state})`, {
      file: patch.file, state: write.state, asked: write.asked === true, rule: write.rule || null,
    });
    return {
      success: false,
      written: false,
      state: write.state,
      errors: [`Not written (${write.state})${write.message ? `: ${write.message}` : ''}`],
    };
  }

  const metrics = computeMetrics(patch, result);

  logger.info('PatchEngine', 'Patch applied', {
    file: patch.file,
    applied: result.applied,
    skipped: result.skipped,
    // Jestli se někdo ptal, patří do záznamu: automatický zápis a schválený
    // zápis vypadají na disku stejně a v logu se pak nedají rozeznat.
    asked: write.asked === true,
    ...metrics.anchorsResolved,
  });

  return { success: true, written: true, state: write.state, asked: write.asked === true, metrics, content: result.content };
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
 * **Návrat je taky zápis** a jde toutéž cestou.  Znamená to, že u souboru
 * z citlivé kategorie se politika zeptá i na návrat — což je nepohodlné a je to
 * vědomá volba: druhé dveře, kterými se dá zapsat bez zámku a bez politiky, by
 * zrušily smysl těch prvních.  Návrat navíc nikdy nepíše nic nového, jen obsah,
 * který na disku před chvílí byl.
 *
 * `revertFromBackup` **zálohu zahodí** hned na začátku — i když se pak zápis
 * nepovede.  Je to schválně: druhý pokus o návrat ze stejné zálohy by psal
 * obsah, který už neplatí, a tichý rollback zpátky na starou verzi je horší než
 * hlášené selhání.
 *
 * @param {string} filePath - Relative file path
 * @param {string} projectRoot
 * @param {Object} [options]  stejné jako u `applyPatch`
 * @returns {Promise<{ success: boolean, state?: string, error?: string }>}
 */
export async function rollbackPatch(filePath, projectRoot, options = {}) {
  const { runId = null, signal = null, ownerLabel = 'patch-engine:rollback', timeoutMs = null } = options;
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new Error('rollbackPatch: runId required — návrat je zápis a musí mít vlastníka');
  }

  const original = revertFromBackup(filePath);
  if (original === null) {
    return { success: false, state: 'no_backup', error: 'No backup found for rollback' };
  }

  const absPath = path.resolve(projectRoot, filePath);
  const workspace = options.workspace || describeWorkspace(projectRoot);

  let write;
  try {
    write = await writeUserFile({
      filePath: absPath, content: original, runId, signal, workspace, ownerLabel,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  } catch (err) {
    return { success: false, state: 'write_failed', error: `Rollback write failed: ${err.message}` };
  }

  if (!write.written) {
    return {
      success: false,
      state: write.state,
      error: `Rollback not written (${write.state})${write.message ? `: ${write.message}` : ''}`,
    };
  }

  logger.info('PatchEngine', 'Patch rolled back', { file: filePath });
  return { success: true, state: write.state };
}

// ─── Apply Patch Set ────────────────────────────────────────────────────────

/**
 * Apply multiple patches with automatic rollback on failure.
 *
 * On any patch failure: rollback ALL previously applied patches in reverse.
 *
 * @param {Array<Object>} patches
 * @param {string} projectRoot
 * @param {Object} [options]  `runId` (povinné) a `signal`, stejně jako `applyPatch`
 * @returns {Promise<{ success: boolean, results: Array, errors?: string[] }>}
 */
export async function applyPatchSet(patches, projectRoot, options = {}) {
  if (!patches || patches.length === 0) {
    return { success: true, results: [] };
  }

  // Strom se popíše **jednou za sadu**.  `describeWorkspace` volá `git`, takže
  // per-patch by to byly tři procesy na každý soubor.
  const writeOptions = { ...options, workspace: options.workspace || describeWorkspace(projectRoot) };

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
    const result = await applyPatch(patch, projectRoot, writeOptions);
    results.push({ file: patch.file, ...result });

    if (!result.success) {
      // Rollback all previously applied patches in reverse
      logger.warn('PatchEngine', `PatchSet failed at ${patch.file}, rolling back ${appliedFiles.length} applied patches`);

      for (let i = appliedFiles.length - 1; i >= 0; i--) {
        const rb = await rollbackPatch(appliedFiles[i], projectRoot, writeOptions);
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
