// C3 Capability Mapping — Runtime Behavior Modifiers
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure function: capabilities (5D vector) → concrete prompt/enforcement modifiers
//
// This is NOT cosmetic. Capabilities directly affect:
//   - System prompt instructions (appended section)
//   - Temperature bias (+/- from derived value)
//   - minResponseLength modifier
//   - Token budget adjustment
//   - Planning depth hint
//
// All functions are pure, no side effects.
//
// v63.0 — Merge Engine v2, Phase 4 review
// ══════════════════════════════════════════════════════════════════════════════

// ─── Thresholds ──────────────────────────────────────────────────────────────

const LOW = 30;
const HIGH = 70;

// ─── Capability Effect Definitions ───────────────────────────────────────────

/**
 * Each dimension maps to effects at low (<30) and high (>70) ranges.
 * Middle range (30-70) has no special effect — neutral.
 */
const CAPABILITY_EFFECTS = Object.freeze({
  reasoning: {
    high: {
      instructions: [
        'Důkladně analyzuj problém krok po kroku.',
        'Strukturuj odpověď logicky — premisa → analýza → závěr.',
      ],
      planningDepthHint: 'deep',
    },
    low: {
      instructions: [
        'Odpovídej přímo bez rozsáhlé analýzy.',
      ],
      planningDepthHint: 'shallow',
    },
  },

  creativity: {
    high: {
      instructions: [
        'Nabízej alternativní pohledy a kreativní řešení.',
        'Neboj se originálních přístupů.',
      ],
      temperatureBias: +0.08,
    },
    low: {
      instructions: [
        'Drž se ověřených postupů a faktů.',
        'Minimalizuj spekulace.',
      ],
      temperatureBias: -0.08,
    },
  },

  determinism: {
    high: {
      instructions: [
        'Odpovídej konzistentně a předvídatelně.',
        'Preferuj ustálené vzory a standardní formáty.',
      ],
      temperatureBias: -0.12,
    },
    low: {
      temperatureBias: +0.05,
    },
  },

  riskTolerance: {
    high: {},
    low: {
      instructions: [
        'Buď opatrný u doporučení — zdůrazni rizika a omezení.',
        'V případě nejistoty explicitně uveď, že jde o odhad.',
      ],
      minResponseLengthModifier: +50,
    },
  },

  verbosity: {
    high: {
      instructions: [
        'Odpovídej podrobně a obsáhle.',
        'Vysvětluj kontext a souvislosti.',
      ],
      minResponseLengthModifier: +100,
      tokenBudgetModifier: +0.15,
    },
    low: {
      instructions: [
        'Odpovídej maximálně stručně — pouze podstatné informace.',
      ],
      minResponseLengthModifier: -50,
      tokenBudgetModifier: -0.10,
    },
  },
});

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Compute aggregate capability modifiers from a 5D vector.
 * Merges weighted capabilities from multiple expertises.
 *
 * @param {Array<{capabilities: Object, weight: number}>} resolved - Sorted expertises
 * @returns {Object} Aggregate modifiers
 */
export function computeCapabilityModifiers(resolved) {
  // Weighted average of all capability dimensions
  const avgCaps = _weightedAverageCapabilities(resolved);

  const instructions = [];
  let temperatureBias = 0;
  let minResponseLengthModifier = 0;
  let tokenBudgetModifier = 0;
  let planningDepthHint = 'normal';

  for (const [dim, value] of Object.entries(avgCaps)) {
    const effects = CAPABILITY_EFFECTS[dim];
    if (!effects) continue;

    if (value > HIGH && effects.high) {
      const e = effects.high;
      if (e.instructions) instructions.push(...e.instructions);
      if (e.temperatureBias) temperatureBias += e.temperatureBias;
      if (e.minResponseLengthModifier) minResponseLengthModifier += e.minResponseLengthModifier;
      if (e.tokenBudgetModifier) tokenBudgetModifier += e.tokenBudgetModifier;
      if (e.planningDepthHint) planningDepthHint = e.planningDepthHint;
    } else if (value < LOW && effects.low) {
      const e = effects.low;
      if (e.instructions) instructions.push(...e.instructions);
      if (e.temperatureBias) temperatureBias += e.temperatureBias;
      if (e.minResponseLengthModifier) minResponseLengthModifier += e.minResponseLengthModifier;
      if (e.tokenBudgetModifier) tokenBudgetModifier += e.tokenBudgetModifier;
      if (e.planningDepthHint) planningDepthHint = e.planningDepthHint;
    }
  }

  // Clamp temperature bias to ±0.2
  temperatureBias = Math.max(-0.2, Math.min(0.2, temperatureBias));

  return Object.freeze({
    instructions,
    temperatureBias,
    minResponseLengthModifier,
    tokenBudgetModifier,
    planningDepthHint,
    capabilityVector: avgCaps,
  });
}

/**
 * Apply capability modifiers to merge result components.
 * Called inside mergeExpertisePrompt() after Steps 7-8.
 *
 * @param {Object} modifiers - From computeCapabilityModifiers()
 * @param {string} prompt - Current built prompt
 * @param {Object} tempResult - { temperature, method }
 * @param {Object} enforcement - { forbiddenPhrases, minResponseLength, disclaimers }
 * @returns {{ prompt, tempResult, enforcement }} Modified copies
 */
export function applyCapabilityModifiers(modifiers, prompt, tempResult, enforcement) {
  let newPrompt = prompt;
  const newTemp = { ...tempResult };
  const newEnforcement = { ...enforcement };

  // 1. Append capability-driven instructions to prompt
  if (modifiers.instructions.length > 0) {
    newPrompt += '\n## Capability modifikátory\n';
    for (const instruction of modifiers.instructions) {
      newPrompt += `- ${instruction}\n`;
    }
  }

  // 2. Apply temperature bias (skip if specialist override — absolute precedence)
  if (modifiers.temperatureBias !== 0 && !newTemp.method.includes('specialist_override')) {
    const adjusted = Math.max(0, Math.min(1, newTemp.temperature + modifiers.temperatureBias));
    newTemp.temperature = Math.round(adjusted * 100) / 100;
    newTemp.method += '+capability_bias';
  }

  // 3. Apply minResponseLength modifier
  if (modifiers.minResponseLengthModifier !== 0) {
    newEnforcement.minResponseLength = Math.max(0,
      (newEnforcement.minResponseLength || 0) + modifiers.minResponseLengthModifier
    );
  }

  return { prompt: newPrompt, tempResult: newTemp, enforcement: newEnforcement };
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Max sum threshold for capability normalization.
 * Above this value, wizard shows a warning (soft, not hard block).
 */
export const CAPABILITY_SUM_WARN_THRESHOLD = 350;

/**
 * Check capability normalization.
 * Returns warnings (not errors) when sum is high.
 *
 * @param {Object} capabilities - { reasoning, creativity, ... }
 * @returns {{ warnings: string[], normalizedSum: number }}
 */
export function checkCapabilityNormalization(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') {
    return { warnings: [], normalizedSum: 0 };
  }

  const validDims = ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'];
  const sum = validDims.reduce((acc, dim) => acc + (capabilities[dim] ?? 50), 0);
  const warnings = [];

  if (sum > CAPABILITY_SUM_WARN_THRESHOLD) {
    warnings.push(
      `Capability sum ${sum} exceeds recommended threshold ${CAPABILITY_SUM_WARN_THRESHOLD}. ` +
      `High values across all dimensions may produce unfocused behavior.`
    );
  }

  // Check contradictory capabilities
  if (capabilities.creativity > HIGH && capabilities.determinism > HIGH) {
    warnings.push(
      'High creativity + high determinism is contradictory. ' +
      'Consider lowering one — creative responses cannot also be deterministic.'
    );
  }

  if (capabilities.verbosity < LOW && capabilities.reasoning > HIGH) {
    warnings.push(
      'High reasoning + low verbosity may conflict — ' +
      'deep analysis requires space to explain.'
    );
  }

  return { warnings, normalizedSum: sum };
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function _weightedAverageCapabilities(resolved) {
  const dims = ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'];
  const totalWeight = resolved.reduce((sum, e) => sum + (e.weight || 0.5), 0);
  if (totalWeight === 0) return Object.fromEntries(dims.map(d => [d, 50]));

  const avg = {};
  for (const dim of dims) {
    let weightedSum = 0;
    for (const e of resolved) {
      const val = e.capabilities?.[dim] ?? 50;
      weightedSum += val * (e.weight || 0.5);
    }
    avg[dim] = Math.round(weightedSum / totalWeight);
  }
  return avg;
}

export { CAPABILITY_EFFECTS, LOW, HIGH };
