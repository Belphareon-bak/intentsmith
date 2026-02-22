// C3 Merge Engine v2 — Compatibility Check
// ══════════════════════════════════════════════════════════════════════════════
//
// Pairwise 5D conflict detection for expertise combinations.
// Pure function, no side effects.
//
// 5D Capability Vector: reasoning, creativity, determinism, riskTolerance, verbosity
//
// Conflict Rules:
//   creativity >70 && other.determinism >70 → creativity↔determinism conflict
//   riskTolerance gap >60 → risk conflict
//   verbosity gap >50 → verbosity conflict (less critical)
//
// Severity:
//   maxGap >80 → HARD_BLOCK
//   maxGap >60 → SOFT_BLOCK
//   maxGap >50 → WARNING
//   else → OK
//
// v63.0 — Merge Engine v2
// ══════════════════════════════════════════════════════════════════════════════

import { MERGE_LIMITS, CompatibilitySeverity } from './merge-types.js';

/**
 * Default capability vector for expertises missing the field.
 * Neutral = no conflict with anything.
 */
const NEUTRAL_CAPABILITIES = Object.freeze({
  reasoning: 50,
  creativity: 50,
  determinism: 50,
  riskTolerance: 50,
  verbosity: 50,
});

/**
 * Check pairwise compatibility of N expertises using 5D capability vectors.
 * Operates on RAW capabilities (not resolved modules).
 *
 * @param {Array<{id: string, name?: string, capabilities?: Object, weight?: number}>} expertises
 * @returns {{
 *   severity: string,
 *   conflicts: Array<{severity: string, expertise1: string, expertise2: string, conflicts: Array}>,
 *   ok: boolean,
 *   requiresConfirmation: boolean,
 *   blocked: boolean,
 * }}
 */
export function checkCompatibility(expertises) {
  // Count check
  if (expertises.length > MERGE_LIMITS.MAX_ACTIVE_EXPERTISES) {
    return {
      severity: CompatibilitySeverity.HARD_BLOCK,
      conflicts: [{
        severity: CompatibilitySeverity.HARD_BLOCK,
        expertise1: null,
        expertise2: null,
        conflicts: [{
          dimension: 'count',
          gap: expertises.length - MERGE_LIMITS.MAX_ACTIVE_EXPERTISES,
          detail: `Maximum ${MERGE_LIMITS.MAX_ACTIVE_EXPERTISES} active expertises allowed, got ${expertises.length}`,
        }],
      }],
      ok: false,
      requiresConfirmation: false,
      blocked: true,
    };
  }

  // Single expertise is always OK
  if (expertises.length <= 1) {
    return {
      severity: CompatibilitySeverity.OK,
      conflicts: [],
      ok: true,
      requiresConfirmation: false,
      blocked: false,
    };
  }

  const results = [];

  // Pairwise check all combinations
  for (let i = 0; i < expertises.length; i++) {
    for (let j = i + 1; j < expertises.length; j++) {
      const pairResult = checkPair(expertises[i], expertises[j]);
      if (pairResult) {
        results.push(pairResult);
      }
    }
  }

  // Overall severity = worst case
  const severityOrder = [
    CompatibilitySeverity.OK,
    CompatibilitySeverity.WARNING,
    CompatibilitySeverity.SOFT_BLOCK,
    CompatibilitySeverity.HARD_BLOCK,
  ];

  const worstSeverity = results.length > 0
    ? results.reduce((worst, r) => {
        return severityOrder.indexOf(r.severity) > severityOrder.indexOf(worst)
          ? r.severity : worst;
      }, CompatibilitySeverity.OK)
    : CompatibilitySeverity.OK;

  return {
    severity: worstSeverity,
    conflicts: results,
    ok: worstSeverity === CompatibilitySeverity.OK
        || worstSeverity === CompatibilitySeverity.WARNING,
    requiresConfirmation: worstSeverity === CompatibilitySeverity.SOFT_BLOCK,
    blocked: worstSeverity === CompatibilitySeverity.HARD_BLOCK,
  };
}

/**
 * Check a single pair of expertises for 5D conflicts.
 *
 * @param {{id: string, name?: string, capabilities?: Object}} a
 * @param {{id: string, name?: string, capabilities?: Object}} b
 * @returns {{ severity: string, expertise1: string, expertise2: string, conflicts: Array } | null}
 */
function checkPair(a, b) {
  const capA = { ...NEUTRAL_CAPABILITIES, ...(a.capabilities || {}) };
  const capB = { ...NEUTRAL_CAPABILITIES, ...(b.capabilities || {}) };
  const nameA = a.name || a.id;
  const nameB = b.name || b.id;

  const conflicts = [];

  // Creativity vs Determinism cross-check (bidirectional)
  if (capA.creativity > 70 && capB.determinism > 70) {
    conflicts.push({
      dimension: 'creativity↔determinism',
      gap: capA.creativity + capB.determinism - 100,
      detail: `${nameA} is creative (${capA.creativity}), ${nameB} is deterministic (${capB.determinism})`,
    });
  }
  if (capB.creativity > 70 && capA.determinism > 70) {
    conflicts.push({
      dimension: 'creativity↔determinism',
      gap: capB.creativity + capA.determinism - 100,
      detail: `${nameB} is creative (${capB.creativity}), ${nameA} is deterministic (${capA.determinism})`,
    });
  }

  // Risk tolerance gap
  const riskGap = Math.abs(capA.riskTolerance - capB.riskTolerance);
  if (riskGap > 60) {
    conflicts.push({
      dimension: 'riskTolerance',
      gap: riskGap,
      detail: `Risk tolerance gap: ${riskGap} points (${nameA}: ${capA.riskTolerance}, ${nameB}: ${capB.riskTolerance})`,
    });
  }

  // Verbosity gap (less critical)
  const verbosityGap = Math.abs(capA.verbosity - capB.verbosity);
  if (verbosityGap > 50) {
    conflicts.push({
      dimension: 'verbosity',
      gap: verbosityGap,
      detail: `Verbosity gap: ${verbosityGap} points (${nameA}: ${capA.verbosity}, ${nameB}: ${capB.verbosity})`,
    });
  }

  if (conflicts.length === 0) return null;

  // Determine severity from worst conflict gap
  const maxGap = Math.max(...conflicts.map(c => c.gap));
  let severity;
  if (maxGap > 80) {
    severity = CompatibilitySeverity.HARD_BLOCK;
  } else if (maxGap > 60) {
    severity = CompatibilitySeverity.SOFT_BLOCK;
  } else {
    severity = CompatibilitySeverity.WARNING;
  }

  return {
    severity,
    expertise1: a.id,
    expertise2: b.id,
    conflicts,
  };
}
