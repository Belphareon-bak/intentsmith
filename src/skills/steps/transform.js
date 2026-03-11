// Transform Step — deterministic JSON transforms, no LLM call (v122)
// ══════════════════════════════════════════════════════════════════════════════
//
// Applies registered transforms to JSON content:
//   - capability alias normalization
//   - capability deduplication
//   - capability sorting (deterministic manifests)
//   - id slug sanitization
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import { substitute } from './substitute.js';

// ── Capability alias map ─────────────────────────────────────────────────────
// Canonical forms — keeps taxonomy consistent across generated specialists.

const CAPABILITY_ALIASES = {
  'tax.calculate': 'tax.compute',
  'vat.calculate': 'vat.compute',
  'salary.calculate': 'salary.compute',
  'deadline.lookup': 'deadline.check',
};

/**
 * Execute a transform step.
 *
 * @param {Object} stepDef - Step definition { id, type: 'transform', content, transforms? }
 * @param {Object} context - { params, stepsOutput }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeTransform(stepDef, context) {
  try {
    const raw = stepDef.content;
    if (!raw) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Transform step "${stepDef.id}": missing "content" field`,
      };
    }

    // Resolve substitutions
    let resolved = substitute(raw, context.params, context.stepsOutput);

    // Strip markdown code fences (LLM may wrap JSON)
    resolved = resolved
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    // Parse JSON
    let data;
    try {
      data = JSON.parse(resolved);
    } catch (parseErr) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Transform step "${stepDef.id}": invalid JSON — ${parseErr.message}`,
      };
    }

    // ── Apply transforms ───────────────────────────────────────────────────

    // 1. Capability alias normalization
    if (Array.isArray(data.capabilities)) {
      data.capabilities = data.capabilities.map(cap =>
        typeof cap === 'string' ? (CAPABILITY_ALIASES[cap] || cap) : cap
      );
    }

    // 2. Capability deduplication
    if (Array.isArray(data.capabilities)) {
      data.capabilities = [...new Set(data.capabilities)];
    }

    // 3. Capability sorting (deterministic)
    if (Array.isArray(data.capabilities)) {
      data.capabilities.sort();
    }

    // 4. Tools array sorting by id (deterministic)
    if (Array.isArray(data.tools)) {
      data.tools.sort((a, b) => {
        const idA = a?.id || '';
        const idB = b?.id || '';
        return idA.localeCompare(idB);
      });
    }

    // 5. ID slug sanitization
    if (typeof data.id === 'string') {
      data.id = data.id
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    return {
      status: 'success',
      output: JSON.stringify(data, null, 2),
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'validation',
      errorMessage: `Transform step "${stepDef.id}": ${err.message}`,
    };
  }
}

// ── Exports for testing ──────────────────────────────────────────────────────

export const _testTransformInternals = { CAPABILITY_ALIASES };
