// API Contract Registry v98 — Track API Surface Across Milestones
// ══════════════════════════════════════════════════════════════════════════════
//
// Scans code for exported symbols (functions, classes, constants),
// extracts signatures, and tracks changes across milestones.
//
// Pipeline:
//   1. After milestone: scan changed files for exports
//   2. Extract signatures (params, return type hints)
//   3. Compare with existing registry entries
//   4. Flag: ADDED, MODIFIED, REMOVED, BREAKING_CHANGE
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { apiContracts } from '../db/database.js';
import { readFile } from 'fs/promises';
import path from 'path';

// ─── Export Extraction ───────────────────────────────────────────────────────

// JavaScript/TypeScript export patterns
const JS_EXPORT_PATTERNS = [
  // export function name(params)
  /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
  // export class Name
  /export\s+class\s+(\w+)/g,
  // export const name =
  /export\s+const\s+(\w+)\s*=/g,
  // export default function name(params)
  /export\s+default\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
  // export default class Name
  /export\s+default\s+class\s+(\w+)/g,
  // module.exports.name = ... or exports.name = ...
  /(?:module\.)?exports\.(\w+)\s*=/g,
];

// Python export patterns (public functions/classes at module level)
const PY_EXPORT_PATTERNS = [
  // def function_name(params):
  /^def\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*)?:/gm,
  // class ClassName:
  /^class\s+(\w+)/gm,
];

// Go export patterns (capitalized = exported)
const GO_EXPORT_PATTERNS = [
  // func Name(params)
  /^func\s+([A-Z]\w*)\s*\(([^)]*)\)/gm,
  // type Name struct/interface
  /^type\s+([A-Z]\w*)\s+(?:struct|interface)/gm,
];

/**
 * Extract exported symbols from source code.
 * @param {string} content - File contents
 * @param {string} ext - File extension
 * @returns {Array<{name: string, signature: string, kind: string}>}
 */
export function extractExports(content, ext) {
  const exports = [];

  let patterns;
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
    patterns = JS_EXPORT_PATTERNS;
  } else if (ext === '.py') {
    patterns = PY_EXPORT_PATTERNS;
  } else if (ext === '.go') {
    patterns = GO_EXPORT_PATTERNS;
  } else {
    return exports;
  }

  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const name = match[1];
      if (!name || name.startsWith('_')) continue; // Skip private

      const signature = match[2]?.trim() || '';
      const kind = _detectExportKind(match[0]);

      exports.push({ name, signature, kind });
    }
  }

  // Deduplicate by name (keep first match)
  const seen = new Set();
  return exports.filter(e => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

function _detectExportKind(matchText) {
  if (/\bclass\b/.test(matchText)) return 'class';
  if (/\bfunction\b/.test(matchText) || /^def\b/.test(matchText) || /^func\b/.test(matchText)) return 'function';
  if (/\bconst\b/.test(matchText)) return 'constant';
  if (/\btype\b/.test(matchText)) return 'type';
  if (/\bexports\./.test(matchText)) return 'function';
  return 'unknown';
}

// ─── API Surface Scan ────────────────────────────────────────────────────────

const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go']);

/**
 * Scan files for exported API surface.
 * @param {string} projectPath - Project root
 * @param {string[]} files - Relative file paths to scan
 * @returns {Promise<Array<{filePath: string, exportName: string, signature: string, kind: string}>>}
 */
export async function scanApiSurface(projectPath, files) {
  const contracts = [];

  for (const relPath of files) {
    const ext = path.extname(relPath);
    if (!CODE_EXTS.has(ext)) continue;

    let content;
    try {
      const absPath = path.join(projectPath, relPath);
      content = await readFile(absPath, 'utf8');
      if (content.length > 500_000) continue; // Skip huge files
    } catch { continue; }

    const exports = extractExports(content, ext);
    for (const exp of exports) {
      contracts.push({
        filePath: relPath,
        exportName: exp.name,
        signature: exp.signature,
        kind: exp.kind,
      });
    }
  }

  return contracts;
}

// ─── Contract Diff ──────────────────────────────────────────────────────────

/**
 * Diff current API surface against registered contracts.
 *
 * @param {string} lifecycleId
 * @param {string} milestoneId
 * @param {string} projectPath
 * @param {string[]} changedFiles - Files changed in this milestone
 * @returns {Promise<Object>} Diff result with added, modified, removed, breaking
 */
export async function scanAndDiff(lifecycleId, milestoneId, projectPath, changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    return { added: [], modified: [], removed: [], breaking: [], unchanged: 0 };
  }

  const currentSurface = await scanApiSurface(projectPath, changedFiles);
  const previousByFile = new Map();

  // Load previous contracts for changed files
  for (const file of changedFiles) {
    const prev = apiContracts.getByFile(lifecycleId, file);
    previousByFile.set(file, prev);
  }

  const added = [];
  const modified = [];
  const removed = [];
  const breaking = [];

  // Process current exports
  const currentByFileExport = new Set();
  for (const curr of currentSurface) {
    const key = `${curr.filePath}::${curr.exportName}`;
    currentByFileExport.add(key);

    const prev = (previousByFile.get(curr.filePath) || [])
      .find(p => p.export_name === curr.exportName);

    if (!prev) {
      // New export
      added.push(curr);
      apiContracts.addContract(lifecycleId, milestoneId, {
        filePath: curr.filePath,
        exportName: curr.exportName,
        signature: curr.signature,
        kind: curr.kind,
      });
    } else if (prev.signature !== curr.signature) {
      // Signature changed
      modified.push({
        ...curr,
        previousSignature: prev.signature,
        consumerCount: prev.consumer_count || 0,
      });

      // If has consumers → breaking change
      if ((prev.consumer_count || 0) > 0) {
        breaking.push({
          ...curr,
          previousSignature: prev.signature,
          consumerCount: prev.consumer_count,
          message: `Breaking: "${curr.exportName}" signature changed (${prev.consumer_count} consumer(s))`,
        });
      }

      // Remove old, add new
      apiContracts.removeContract(lifecycleId, curr.filePath, curr.exportName);
      apiContracts.addContract(lifecycleId, milestoneId, {
        filePath: curr.filePath,
        exportName: curr.exportName,
        signature: curr.signature,
        kind: curr.kind,
        consumerCount: prev.consumer_count || 0,
      });
    }
    // else: unchanged
  }

  // Detect removed exports
  for (const [file, prevContracts] of previousByFile) {
    for (const prev of prevContracts) {
      const key = `${file}::${prev.export_name}`;
      if (!currentByFileExport.has(key)) {
        removed.push({
          filePath: file,
          exportName: prev.export_name,
          signature: prev.signature,
          kind: prev.kind,
          consumerCount: prev.consumer_count || 0,
        });
        apiContracts.removeContract(lifecycleId, file, prev.export_name);

        if ((prev.consumer_count || 0) > 0) {
          breaking.push({
            filePath: file,
            exportName: prev.export_name,
            consumerCount: prev.consumer_count,
            message: `Breaking: "${prev.export_name}" removed (${prev.consumer_count} consumer(s))`,
          });
        }
      }
    }
  }

  // Count unchanged
  const allPrev = [...previousByFile.values()].flat();
  const unchanged = allPrev.length - modified.length - removed.length;

  logger.info('ApiRegistry', `Diff: +${added.length} ~${modified.length} -${removed.length} breaking=${breaking.length}`, {
    lifecycleId, milestoneId,
  });

  return { added, modified, removed, breaking, unchanged: Math.max(0, unchanged) };
}

/**
 * Update consumer counts by scanning import usage across the project.
 * Call this periodically (e.g., at project review) for accurate breaking change detection.
 *
 * @param {string} lifecycleId
 * @param {string} projectPath
 */
export async function updateConsumerCounts(lifecycleId, projectPath) {
  const activeApis = apiContracts.getActive(lifecycleId);
  if (activeApis.length === 0) return;

  // Build lookup: exportName → files
  const exportFiles = new Map();
  for (const api of activeApis) {
    if (!exportFiles.has(api.export_name)) exportFiles.set(api.export_name, new Set());
    exportFiles.get(api.export_name).add(api.file_path);
  }

  // Scan project for imports referencing these files
  const { readdir } = await import('fs/promises');
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor', '.venv', '.c3']);
  const consumers = new Map(); // "filePath::exportName" → count

  async function walk(dir, depth = 0) {
    if (depth > 8) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (CODE_EXTS.has(path.extname(e.name))) {
        try {
          const content = await readFile(full, 'utf8');
          if (content.length > 200_000) continue;
          // Check for imports of known exports
          for (const [name, sourceFiles] of exportFiles) {
            if (content.includes(name)) {
              const relPath = path.relative(projectPath, full);
              // Don't count self-references
              if (!sourceFiles.has(relPath)) {
                const key = `${[...sourceFiles][0]}::${name}`;
                consumers.set(key, (consumers.get(key) || 0) + 1);
              }
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  await walk(projectPath);

  // Update counts in DB
  for (const api of activeApis) {
    const key = `${api.file_path}::${api.export_name}`;
    const count = consumers.get(key) || 0;
    if (count !== api.consumer_count) {
      apiContracts.updateConsumerCount.run(count, lifecycleId, api.file_path, api.export_name);
    }
  }

  logger.info('ApiRegistry', `Consumer counts updated for ${activeApis.length} contracts`, { lifecycleId });
}

/**
 * Format API diff for checkpoint/display.
 * @param {Object} diff - From scanAndDiff()
 * @returns {string}
 */
export function formatApiDiff(diff) {
  if (!diff) return '';
  const total = diff.added.length + diff.modified.length + diff.removed.length;
  if (total === 0) return '';

  const parts = ['### API Surface Changes'];

  if (diff.added.length > 0) {
    parts.push(`**Added** (${diff.added.length}):`);
    for (const a of diff.added.slice(0, 10)) {
      parts.push(`- \`${a.filePath}\`: ${a.kind} \`${a.exportName}(${a.signature})\``);
    }
  }

  if (diff.modified.length > 0) {
    parts.push(`**Modified** (${diff.modified.length}):`);
    for (const m of diff.modified.slice(0, 10)) {
      parts.push(`- \`${m.filePath}\`: \`${m.exportName}\` signature: \`${m.previousSignature}\` → \`${m.signature}\``);
    }
  }

  if (diff.removed.length > 0) {
    parts.push(`**Removed** (${diff.removed.length}):`);
    for (const r of diff.removed.slice(0, 10)) {
      parts.push(`- \`${r.filePath}\`: \`${r.exportName}\``);
    }
  }

  if (diff.breaking.length > 0) {
    parts.push('', '**BREAKING CHANGES:**');
    for (const b of diff.breaking) {
      parts.push(`- ${b.message}`);
    }
  }

  return parts.join('\n');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  extractExports,
  scanApiSurface,
  scanAndDiff,
  updateConsumerCounts,
  formatApiDiff,
};
