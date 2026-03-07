// Patch Validator v104 — Pre-Apply Checks + Anchor Resolution
// ══════════════════════════════════════════════════════════════════════════════
//
// Validates patches before application:
//   - File exists (or pure insert)
//   - Size guards (lines, regions, file size)
//   - Anchor resolution (3-tier: exact → normalized → AST)
//   - Old-lines match (stale patch detection)
//   - Overlap detection (conflicting regions)
//   - Post-apply syntax validation (AST, optional)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { normalizeNewlines } from './patch-parser.js';

// ─── Limits ─────────────────────────────────────────────────────────────────

export const PATCH_LIMITS = Object.freeze({
  MAX_LINES_CHANGED: 300,
  MAX_FILES: 5,
  MAX_REGIONS_PER_FILE: 20,
  MAX_FILE_SIZE: 50000,
});

// ─── Anchor Resolution ─────────────────────────────────────────────────────

/**
 * Resolve a semantic anchor to a line number in file content.
 * 3-tier fallback: exact → normalized → AST-assisted.
 *
 * @param {string} content - File content
 * @param {string} anchor - Anchor text to find
 * @param {string} anchorType - One of AnchorType values
 * @param {string|null} [contextBefore] - Preceding line for disambiguation
 * @param {Array|null} [symbols] - Pre-extracted AST symbols for tier 3
 * @returns {{ line: number, tier: string, matches: number }|null}
 */
export function findAnchor(content, anchor, anchorType, contextBefore = null, symbols = null) {
  if (!content || !anchor) return null;

  const lines = normalizeNewlines(content).split('\n');
  const trimmedAnchor = anchor.trim();

  // ─── Tier 1: Exact match ────────────────────────────────────────────────
  const exactMatches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(trimmedAnchor)) {
      exactMatches.push(i);
    }
  }

  if (exactMatches.length > 0) {
    // Disambiguate with contextBefore
    if (exactMatches.length > 1 && contextBefore) {
      const ctxTrimmed = contextBefore.trim();
      const disambiguated = exactMatches.filter(idx =>
        idx > 0 && lines[idx - 1].trim().includes(ctxTrimmed)
      );
      if (disambiguated.length > 0) {
        return { line: disambiguated[0], tier: 'exact', matches: disambiguated.length };
      }
    }
    return { line: exactMatches[0], tier: 'exact', matches: exactMatches.length };
  }

  // ─── Tier 2: Normalized match (collapse whitespace) ─────────────────────
  const normalizedAnchor = trimmedAnchor.replace(/\s+/g, ' ');
  const normalizedMatches = [];
  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = lines[i].replace(/\s+/g, ' ').trim();
    if (normalizedLine.includes(normalizedAnchor)) {
      normalizedMatches.push(i);
    }
  }

  if (normalizedMatches.length > 0) {
    if (normalizedMatches.length > 1 && contextBefore) {
      const ctxNorm = contextBefore.trim().replace(/\s+/g, ' ');
      const disambiguated = normalizedMatches.filter(idx =>
        idx > 0 && lines[idx - 1].replace(/\s+/g, ' ').trim().includes(ctxNorm)
      );
      if (disambiguated.length > 0) {
        return { line: disambiguated[0], tier: 'normalized', matches: disambiguated.length };
      }
    }
    return { line: normalizedMatches[0], tier: 'normalized', matches: normalizedMatches.length };
  }

  // ─── Tier 3: AST-assisted (lazy — only if symbols provided) ─────────────
  if (symbols && symbols.length > 0 && (anchorType === 'function' || anchorType === 'class' || anchorType === 'method')) {
    // Extract symbol name from anchor text
    const symbolName = _extractSymbolName(trimmedAnchor, anchorType);
    if (symbolName) {
      const matched = symbols.filter(s => s.name === symbolName);
      if (matched.length > 0) {
        return { line: matched[0].line - 1, tier: 'ast', matches: matched.length }; // symbols use 1-based lines
      }
    }
  }

  return null;
}

/**
 * Extract symbol name from anchor text.
 * "function login(user, password)" → "login"
 * "class UserService" → "UserService"
 * "async function processOrder(" → "processOrder"
 */
function _extractSymbolName(anchor, anchorType) {
  if (anchorType === 'function') {
    const match = anchor.match(/(?:async\s+)?function\s+(\w+)/);
    return match ? match[1] : null;
  }
  if (anchorType === 'class') {
    const match = anchor.match(/class\s+(\w+)/);
    return match ? match[1] : null;
  }
  if (anchorType === 'method') {
    const match = anchor.match(/\.(\w+)\s*\(/) || anchor.match(/(\w+)\s*\(/);
    return match ? match[1] : null;
  }
  return null;
}

// ─── Region Start Offset ────────────────────────────────────────────────────

/**
 * Get the content start offset relative to the anchor line.
 * For structural anchors (function/class/method), old/new starts AFTER the anchor.
 * For positional anchors (import/line/insert_after), old/new starts AT the anchor.
 *
 * @param {string} anchorType
 * @returns {number} 0 or 1
 */
export function getRegionOffset(anchorType) {
  if (anchorType === 'function' || anchorType === 'class' || anchorType === 'method') {
    return 1; // content starts AFTER the declaration line
  }
  return 0; // content IS the anchor line
}

// ─── Patch Validation ───────────────────────────────────────────────────────

/**
 * Validate a single patch before application.
 *
 * @param {Object} patch - Patch ADT
 * @param {Map<string, string>} fileContents - Map of relative path → content
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePatch(patch, fileContents) {
  const errors = [];
  const warnings = [];

  if (!patch || !patch.file) {
    errors.push('Patch missing file path');
    return { valid: false, errors, warnings };
  }

  const content = fileContents.get(patch.file);
  const regions = patch.regions || [];

  // File existence check
  const isPureInsert = regions.every(r => !r.old || r.old.length === 0);
  if (content === undefined && !isPureInsert) {
    errors.push(`File not found: ${patch.file} (and patch has non-empty old lines)`);
    return { valid: false, errors, warnings };
  }

  // File size guard
  if (content) {
    const lineCount = content.split('\n').length;
    if (lineCount > PATCH_LIMITS.MAX_FILE_SIZE) {
      warnings.push(`File ${patch.file} has ${lineCount} lines (>${PATCH_LIMITS.MAX_FILE_SIZE}) — LLM patches may be unreliable`);
    }
  }

  // Total changed lines
  const totalChanged = regions.reduce((s, r) => s + (r.old?.length || 0) + (r.new?.length || 0), 0);
  if (totalChanged > PATCH_LIMITS.MAX_LINES_CHANGED) {
    errors.push(`Patch changes ${totalChanged} lines (max ${PATCH_LIMITS.MAX_LINES_CHANGED})`);
  }

  // Region count
  if (regions.length > PATCH_LIMITS.MAX_REGIONS_PER_FILE) {
    errors.push(`Patch has ${regions.length} regions (max ${PATCH_LIMITS.MAX_REGIONS_PER_FILE})`);
  }

  // Per-region validation
  const resolvedLines = [];
  const normalizedContent = content ? normalizeNewlines(content) : '';
  const contentLines = normalizedContent ? normalizedContent.split('\n') : [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];

    if (!region.anchor) {
      errors.push(`Region ${i}: missing anchor`);
      continue;
    }

    // Skip anchor resolution for pure inserts on non-existent files
    if (!content && (!region.old || region.old.length === 0)) continue;

    const result = findAnchor(normalizedContent, region.anchor, region.anchorType, region.contextBefore || null);

    if (!result) {
      errors.push(`Region ${i}: anchor not found: "${region.anchor}"`);
      continue;
    }

    // Ambiguity guard: reject if multiple matches without contextBefore
    if (result.matches > 1 && !region.contextBefore) {
      errors.push(`Region ${i}: ambiguous anchor "${region.anchor}" (${result.matches} matches, no contextBefore for disambiguation)`);
      continue;
    }

    // Old-lines match check (stale patch detection)
    // For function/class/method: old/new starts AFTER anchor line
    // For import/line: old/new starts AT anchor line
    const offset = getRegionOffset(region.anchorType);
    if (region.old && region.old.length > 0) {
      const startLine = result.line + offset;
      for (let j = 0; j < region.old.length; j++) {
        const fileLine = contentLines[startLine + j];
        const patchLine = region.old[j];
        if (fileLine === undefined || fileLine.trim() !== patchLine.trim()) {
          errors.push(`Region ${i}: stale patch — old line ${j} mismatch at anchor "${region.anchor}" (expected "${patchLine?.trim()}", got "${fileLine?.trim()}")`);
          break;
        }
      }
    }

    const contentStart = result.line + offset;
    resolvedLines.push({ index: i, line: contentStart, endLine: contentStart + (region.old?.length || 0) });
  }

  // Overlap detection
  if (resolvedLines.length > 1) {
    resolvedLines.sort((a, b) => a.line - b.line);
    for (let i = 1; i < resolvedLines.length; i++) {
      if (resolvedLines[i].line < resolvedLines[i - 1].endLine) {
        errors.push(`Regions ${resolvedLines[i - 1].index} and ${resolvedLines[i].index} overlap at line ${resolvedLines[i].line}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Patch Set Validation ───────────────────────────────────────────────────

/**
 * Validate an array of patches.
 *
 * @param {Array<Object>} patches
 * @param {Map<string, string>} fileContents
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePatchSet(patches, fileContents) {
  const errors = [];
  const warnings = [];

  if (!patches || patches.length === 0) {
    return { valid: true, errors, warnings };
  }

  // File count
  const uniqueFiles = new Set(patches.map(p => p.file));
  if (uniqueFiles.size > PATCH_LIMITS.MAX_FILES) {
    errors.push(`Patch set touches ${uniqueFiles.size} files (max ${PATCH_LIMITS.MAX_FILES})`);
  }

  // Total lines across all patches
  const totalLines = patches.reduce((s, p) =>
    s + (p.regions || []).reduce((rs, r) => rs + (r.old?.length || 0) + (r.new?.length || 0), 0), 0);
  if (totalLines > PATCH_LIMITS.MAX_LINES_CHANGED) {
    errors.push(`Patch set changes ${totalLines} lines total (max ${PATCH_LIMITS.MAX_LINES_CHANGED})`);
  }

  // Validate each patch
  for (const patch of patches) {
    const result = validatePatch(patch, fileContents);
    errors.push(...result.errors.map(e => `[${patch.file}] ${e}`));
    warnings.push(...result.warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Post-Apply Syntax Validation ───────────────────────────────────────────

/**
 * Validate syntax of patched content using AST parsing.
 * Only for supported languages (JS/Python/Go/Java). Others skip.
 *
 * @param {string} newContent - Patched file content
 * @param {string} filePath - File path (for language detection)
 * @returns {Promise<{ valid: boolean, language: string, error?: string }>}
 */
export async function validateSyntaxPostApply(newContent, filePath) {
  let detectLang, parseAST;
  try {
    const analyzer = await import('../code-intel/code-analyzer.js');
    const astMod = await import('../code-intel/ast-analyzer.js');
    detectLang = analyzer.detectLanguage;
    parseAST = astMod.parseAST;
  } catch {
    return { valid: true, language: 'unknown' };
  }

  const lang = detectLang(filePath);
  if (!lang || lang === 'unknown') return { valid: true, language: lang || 'unknown' };

  try {
    const { tree, supported } = await parseAST(newContent, lang);
    if (!supported || !tree) return { valid: true, language: lang };
    if (tree.rootNode && tree.rootNode.hasError) {
      return { valid: false, language: lang, error: 'AST parse error detected after patch' };
    }
    return { valid: true, language: lang };
  } catch {
    return { valid: true, language: lang }; // graceful skip
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  PATCH_LIMITS,
  findAnchor,
  getRegionOffset,
  validatePatch,
  validatePatchSet,
  validateSyntaxPostApply,
};
