// Scope Limiter v119 — Pre-apply patch scope validation
// ══════════════════════════════════════════════════════════════════════════════
//
// Uses KnowledgeGraph to compute which files the LLM is allowed to modify
// (target files + 1-hop dependencies/dependents), then validates patches
// against this scope before applying them.
//
// Graceful degradation: if no graph is available, all files are allowed.
// Violation counter tracks repeated out-of-scope patches and auto-widens
// scope after threshold (3 → widen, 5 → disable).
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileNodeId } from '../code-intel/knowledge-graph.js';
import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ENGINE_MANAGED_FILES = new Set([
  'README.md', 'package.json', '.gitignore', 'tsconfig.json',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);

const DEFAULT_MAX_FILES = 15;
const VIOLATION_WIDEN_THRESHOLD = 3;
const VIOLATION_DISABLE_THRESHOLD = 5;

// ─── computePatchScope ──────────────────────────────────────────────────────

/**
 * Compute the set of files the LLM is allowed to modify.
 *
 * Scope = target files + 1-hop direct dependencies + 1-hop direct dependents,
 * capped at maxFiles. Engine-managed files (package.json, etc.) are always
 * allowed.
 *
 * @param {KnowledgeGraph|null} graph
 * @param {string[]} targetFiles - Seed files (e.g. from milestone scope)
 * @param {Object} [opts]
 * @param {number} [opts.maxFiles=15] - Max files in scope
 * @param {number} [opts.hops=1] - How many hops to expand (default 1)
 * @returns {{ allowedFiles: Set<string>, reasons: Map<string, string> }}
 */
export function computePatchScope(graph, targetFiles, opts = {}) {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const hops = opts.hops ?? 1;

  const allowedFiles = new Set();
  const reasons = new Map();

  // Always allow engine-managed files
  for (const f of ENGINE_MANAGED_FILES) {
    allowedFiles.add(f);
    reasons.set(f, 'engine-managed');
  }

  if (!targetFiles || targetFiles.length === 0) {
    return { allowedFiles, reasons };
  }

  // Add target files first (highest priority)
  for (const f of targetFiles) {
    allowedFiles.add(f);
    reasons.set(f, 'target');
  }

  // If no graph, allow all files (graceful degradation)
  if (!graph) {
    return { allowedFiles, reasons, noGraph: true };
  }

  // Expand by hops
  const toExpand = [...targetFiles];
  for (let hop = 0; hop < hops && allowedFiles.size < maxFiles; hop++) {
    const nextExpand = [];

    for (const file of toExpand) {
      if (allowedFiles.size >= maxFiles) break;

      // Direct dependencies (files this file imports)
      try {
        const deps = graph.getDependencies(file);
        if (deps) {
          for (const depNode of deps) {
            if (allowedFiles.size >= maxFiles) break;
            const depFile = _nodeToFile(depNode);
            if (depFile && !allowedFiles.has(depFile)) {
              allowedFiles.add(depFile);
              reasons.set(depFile, `dependency (hop ${hop + 1})`);
              nextExpand.push(depFile);
            }
          }
        }
      } catch (_) { /* graph method failed — skip */ }

      // Direct dependents (files that import this file)
      try {
        const dependents = graph.getDependents(file);
        if (dependents) {
          for (const depNode of dependents) {
            if (allowedFiles.size >= maxFiles) break;
            const depFile = _nodeToFile(depNode);
            if (depFile && !allowedFiles.has(depFile)) {
              allowedFiles.add(depFile);
              reasons.set(depFile, `dependent (hop ${hop + 1})`);
              nextExpand.push(depFile);
            }
          }
        }
      } catch (_) { /* graph method failed — skip */ }
    }

    toExpand.length = 0;
    toExpand.push(...nextExpand);
  }

  return { allowedFiles, reasons };
}

// ─── validatePatchScope ─────────────────────────────────────────────────────

/**
 * Validate that all patches target files within the allowed scope.
 *
 * @param {Array<{ file: string }>} patches - Patch objects with file paths
 * @param {{ allowedFiles: Set<string> }} scope - From computePatchScope()
 * @returns {{ valid: boolean, violations: Array<{ file: string, reason: string }> }}
 */
export function validatePatchScope(patches, scope) {
  if (!patches || patches.length === 0) return { valid: true, violations: [] };
  if (!scope || !scope.allowedFiles) return { valid: true, violations: [] };

  // If scope has noGraph flag, all files are implicitly allowed
  if (scope.noGraph) return { valid: true, violations: [] };

  const violations = [];
  for (const patch of patches) {
    if (!patch.file) continue;
    if (!scope.allowedFiles.has(patch.file)) {
      violations.push({
        file: patch.file,
        reason: 'File not in allowed scope',
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

// ─── formatScopeHint ────────────────────────────────────────────────────────

/**
 * Format scope as markdown for LLM prompt injection.
 *
 * @param {{ allowedFiles: Set<string>, reasons: Map<string, string> }} scope
 * @returns {string}
 */
export function formatScopeHint(scope) {
  if (!scope || !scope.allowedFiles || scope.allowedFiles.size === 0) return '';

  const parts = ['## Allowed Files (do NOT modify other files)'];

  // Sort: targets first, then dependencies, then engine-managed
  const entries = [...scope.reasons.entries()].sort((a, b) => {
    const order = { target: 0, 'engine-managed': 2 };
    const aOrder = order[a[1]] ?? 1;
    const bOrder = order[b[1]] ?? 1;
    return aOrder - bOrder || a[0].localeCompare(b[0]);
  });

  // Skip engine-managed files from display (they're implicit)
  for (const [file, reason] of entries) {
    if (reason === 'engine-managed') continue;
    parts.push(`- ${file} (${reason})`);
  }

  return parts.join('\n');
}

// ─── Violation Counter ──────────────────────────────────────────────────────

/**
 * Tracks consecutive scope violations and manages adaptive scope widening.
 */
export class ScopeViolationTracker {
  constructor() {
    this._count = 0;
    this._disabled = false;
    this._widened = false;
  }

  /** Record a violation. Returns the current state. */
  recordViolation() {
    this._count++;
    let action = 'logged';

    if (this._count >= VIOLATION_DISABLE_THRESHOLD) {
      this._disabled = true;
      action = 'disabled';
      logger.warn('[scope-limiter] Scope limiter disabled after %d violations', this._count);
    } else if (this._count >= VIOLATION_WIDEN_THRESHOLD && !this._widened) {
      this._widened = true;
      action = 'widened';
      logger.warn('[scope-limiter] Widening scope after %d violations', this._count);
    }

    return { count: this._count, action, disabled: this._disabled, widened: this._widened };
  }

  /** Reset counter (new iteration cycle). */
  reset() {
    this._count = 0;
    this._disabled = false;
    this._widened = false;
  }

  get count() { return this._count; }
  get disabled() { return this._disabled; }
  get widened() { return this._widened; }
}

// ─── Private Helpers ────────────────────────────────────────────────────────

function _nodeToFile(node) {
  if (!node) return null;
  return node.file || node.name || (node.id ? node.id.replace(/^file:/, '') : null);
}
