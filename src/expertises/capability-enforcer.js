// C.3 v63.2 — Capability Post-Validation Enforcer
// ══════════════════════════════════════════════════════════════════════════════
//
// Score-based post-response validation against 5D capability profile.
// Deterministic, no LLM, side-effect free.
//
// Architecture:
//   capability-enforcer.js
//   ├── evaluateDeterminism(output, profile)
//   ├── evaluateRiskTolerance(output, profile)
//   ├── evaluateVerbosity(output, profile)
//   ├── evaluateStructure(output, profile)
//   └── computeCapabilityDrift(expected, observed)
//
// Each evaluator returns: { score: 0-100, violations: [], warnings: [] }
// Drift > threshold → violation
//
// ══════════════════════════════════════════════════════════════════════════════

// ─── Thresholds ──────────────────────────────────────────────────────────────

export const CAPABILITY_ENFORCEMENT_CONFIG = Object.freeze({
  // Drift threshold: if observed deviates from expected by more than this → violation
  DRIFT_VIOLATION_THRESHOLD: 40,
  // Drift warning threshold
  DRIFT_WARNING_THRESHOLD: 25,
  // Min response length for verbose profiles
  VERBOSE_MIN_LENGTH: 200,
  // Max hedging ratio for deterministic profiles
  DETERMINISM_MAX_HEDGING_RATIO: 0.03,
  // Min caveat count for low risk tolerance
  LOW_RISK_MIN_CAVEATS: 1,
});

// ─── Pattern Libraries ───────────────────────────────────────────────────────

// Hedging patterns — indicators of uncertainty (bad for high determinism)
const HEDGING_PATTERNS = [
  /\bmožná\b/gi,
  /\basi\b/gi,
  /\bpravděpodobně\b/gi,
  /\bnejspíš\b/gi,
  /\bpřípadně\b/gi,
  /\bperhaps\b/gi,
  /\bmaybe\b/gi,
  /\bprobably\b/gi,
  /\bmight\b/gi,
  /\bcould be\b/gi,
  /\bit depends\b/gi,
  /\bnení jisté\b/gi,
  /\bnelze říci\b/gi,
];

// Caveat/disclaimer patterns — indicators of caution (good for low risk tolerance)
const CAVEAT_PATTERNS = [
  /\bpozor\b/gi,
  /\bupozorn/gi,
  /\bvýhrad/gi,
  /\bomezen/gi,
  /\brizik/gi,
  /\bvarová/gi,
  /\bdisclaimer/gi,
  /\bkonzultuj/gi,
  /\bporaď(te)?\s+se/gi,
  /\bcaution\b/gi,
  /\bwarning\b/gi,
  /\bnote\s+that\b/gi,
  /\bimportant(ly)?\b/gi,
  /\bbezpečnost/gi,
];

// Structural markers — section headers, lists, tables
const STRUCTURE_PATTERNS = {
  headers: /^#{1,4}\s+/gm,
  bulletLists: /^[\s]*[-*•]\s+/gm,
  numberedLists: /^[\s]*\d+[.)]\s+/gm,
  tables: /\|.*\|/gm,
  codeBlocks: /```/g,
  boldEmphasis: /\*\*[^*]+\*\*/g,
};

// ─── Individual Evaluators ───────────────────────────────────────────────────

/**
 * Evaluate determinism compliance.
 * High determinism (>70) → response should minimize hedging.
 * Low determinism (<30) → hedging is acceptable/expected.
 *
 * @param {string} output - LLM response text
 * @param {Object} profile - { determinism: 0-100 }
 * @returns {{ score: number, violations: string[], warnings: string[] }}
 */
export function evaluateDeterminism(output, profile) {
  const violations = [];
  const warnings = [];

  if (!output || !profile || profile.determinism === undefined) {
    return { score: 50, violations, warnings };
  }

  const expected = profile.determinism;
  const words = output.split(/\s+/).length;
  if (words === 0) return { score: 50, violations, warnings };

  // Count hedging instances
  let hedgingCount = 0;
  for (const pattern of HEDGING_PATTERNS) {
    const matches = output.match(pattern);
    if (matches) hedgingCount += matches.length;
  }

  const hedgingRatio = hedgingCount / words;

  // Score: 100 = no hedging (fully deterministic), 0 = heavy hedging
  const observed = Math.max(0, Math.min(100, Math.round((1 - hedgingRatio * 20) * 100)));

  // High determinism expects low hedging
  if (expected > 70) {
    if (hedgingRatio > CAPABILITY_ENFORCEMENT_CONFIG.DETERMINISM_MAX_HEDGING_RATIO) {
      violations.push(
        `Determinism violation: hedging ratio ${(hedgingRatio * 100).toFixed(1)}% exceeds ${(CAPABILITY_ENFORCEMENT_CONFIG.DETERMINISM_MAX_HEDGING_RATIO * 100)}% limit (${hedgingCount} hedging phrases in ${words} words)`
      );
    }
  }

  // Low determinism — hedging is fine, but if there's zero hedging in a creative context, warn
  if (expected < 30 && hedgingCount === 0 && words > 50) {
    warnings.push('Low determinism profile but response uses no hedging — may appear overly assertive');
  }

  return { score: observed, violations, warnings };
}

/**
 * Evaluate risk tolerance compliance.
 * Low risk tolerance (<30) → response MUST contain caveats/disclaimers.
 * High risk tolerance (>70) → fewer caveats expected.
 *
 * @param {string} output
 * @param {Object} profile - { riskTolerance: 0-100 }
 * @returns {{ score: number, violations: string[], warnings: string[] }}
 */
export function evaluateRiskTolerance(output, profile) {
  const violations = [];
  const warnings = [];

  if (!output || !profile || profile.riskTolerance === undefined) {
    return { score: 50, violations, warnings };
  }

  const expected = profile.riskTolerance;

  // Count caveat/disclaimer instances
  let caveatCount = 0;
  for (const pattern of CAVEAT_PATTERNS) {
    const matches = output.match(pattern);
    if (matches) caveatCount += matches.length;
  }

  const words = output.split(/\s+/).length;
  const caveatDensity = words > 0 ? caveatCount / words : 0;

  // Score: 0 = very cautious (many caveats), 100 = no caveats (risky)
  const observed = Math.max(0, Math.min(100, Math.round((1 - caveatDensity * 15) * 100)));

  // Low risk tolerance MUST have caveats
  if (expected < 30) {
    if (caveatCount < CAPABILITY_ENFORCEMENT_CONFIG.LOW_RISK_MIN_CAVEATS && words > 30) {
      violations.push(
        `Risk tolerance violation: low risk profile (${expected}) but response contains no caveats or disclaimers`
      );
    }
  }

  return { score: observed, violations, warnings };
}

/**
 * Evaluate verbosity compliance.
 * High verbosity (>70) → response should be detailed (>200 chars).
 * Low verbosity (<30) → concise responses expected.
 *
 * @param {string} output
 * @param {Object} profile - { verbosity: 0-100 }
 * @returns {{ score: number, violations: string[], warnings: string[] }}
 */
export function evaluateVerbosity(output, profile) {
  const violations = [];
  const warnings = [];

  if (!output || !profile || profile.verbosity === undefined) {
    return { score: 50, violations, warnings };
  }

  const expected = profile.verbosity;
  const length = output.trim().length;
  const words = output.split(/\s+/).length;

  // Score: map response length to 0-100 verbosity scale
  // ~50 words → 20, ~150 words → 50, ~400 words → 80, ~600+ → 100
  let observed;
  if (words <= 20) observed = 5;
  else if (words <= 50) observed = 20;
  else if (words <= 100) observed = 35;
  else if (words <= 200) observed = 55;
  else if (words <= 400) observed = 75;
  else if (words <= 600) observed = 90;
  else observed = 100;

  // High verbosity expects detailed response
  if (expected > 70) {
    if (length < CAPABILITY_ENFORCEMENT_CONFIG.VERBOSE_MIN_LENGTH) {
      violations.push(
        `Verbosity violation: high verbosity profile (${expected}) but response is only ${length} chars (min ${CAPABILITY_ENFORCEMENT_CONFIG.VERBOSE_MIN_LENGTH})`
      );
    }
  }

  // Low verbosity — very long response is a warning
  if (expected < 30 && words > 300) {
    warnings.push(`Low verbosity profile (${expected}) but response is ${words} words — may be overly verbose`);
  }

  return { score: observed, violations, warnings };
}

/**
 * Evaluate structural quality.
 * Analyzes presence of headers, lists, tables, code blocks.
 * Not tied to a single capability dimension — cross-cutting quality indicator.
 *
 * @param {string} output
 * @param {Object} profile - full capability profile
 * @returns {{ score: number, violations: string[], warnings: string[], metrics: Object }}
 */
export function evaluateStructure(output, profile) {
  const violations = [];
  const warnings = [];

  if (!output) {
    return { score: 0, violations, warnings, metrics: {} };
  }

  const metrics = {};
  for (const [name, pattern] of Object.entries(STRUCTURE_PATTERNS)) {
    const matches = output.match(pattern);
    metrics[name] = matches ? matches.length : 0;
  }

  const totalStructure = Object.values(metrics).reduce((s, v) => s + v, 0);
  const words = output.split(/\s+/).length;

  // Structure score: presence of formatting elements
  // 0 elements → 10, 1-3 → 40, 4-8 → 70, 8+ → 90
  let score;
  if (totalStructure === 0) score = 10;
  else if (totalStructure <= 3) score = 40;
  else if (totalStructure <= 8) score = 70;
  else score = 90;

  // High reasoning + long response should have structure
  if (profile?.reasoning > 70 && words > 150 && totalStructure === 0) {
    warnings.push('High reasoning profile with long response but no structural formatting (headers, lists, etc.)');
  }

  return { score, violations, warnings, metrics };
}

// ─── Drift Computation ───────────────────────────────────────────────────────

/**
 * Compute capability drift between expected profile and observed scores.
 *
 * @param {Object} expectedProfile - { reasoning, creativity, determinism, riskTolerance, verbosity }
 * @param {Object} observedScores - Same shape, from evaluators
 * @returns {{
 *   driftScore: number,
 *   perDimension: Object,
 *   violations: string[],
 *   warnings: string[],
 *   hasCritical: boolean,
 * }}
 */
export function computeCapabilityDrift(expectedProfile, observedScores) {
  const dims = ['determinism', 'riskTolerance', 'verbosity'];
  const perDimension = {};
  let totalDrift = 0;
  let dimCount = 0;
  const violations = [];
  const warnings = [];

  for (const dim of dims) {
    const expected = expectedProfile?.[dim];
    const observed = observedScores?.[dim];

    if (expected === undefined || observed === undefined) continue;

    const delta = Math.abs(expected - observed);
    const direction = observed > expected ? 'higher' : 'lower';

    perDimension[dim] = { expected, observed, delta, direction };
    totalDrift += delta;
    dimCount++;

    if (delta > CAPABILITY_ENFORCEMENT_CONFIG.DRIFT_VIOLATION_THRESHOLD) {
      violations.push(
        `${dim} drift: expected ${expected}, observed ${observed} (delta ${delta} > ${CAPABILITY_ENFORCEMENT_CONFIG.DRIFT_VIOLATION_THRESHOLD} threshold)`
      );
    } else if (delta > CAPABILITY_ENFORCEMENT_CONFIG.DRIFT_WARNING_THRESHOLD) {
      warnings.push(
        `${dim} drift: expected ${expected}, observed ${observed} (delta ${delta})`
      );
    }
  }

  const driftScore = dimCount > 0 ? Math.round(totalDrift / dimCount) : 0;

  return {
    driftScore,
    perDimension,
    violations,
    warnings,
    hasCritical: violations.length > 0,
  };
}

// ─── Main Enforcement Entry Point ────────────────────────────────────────────

/**
 * Run full capability post-validation on a response.
 * Deterministic, no LLM, side-effect free.
 *
 * @param {string} output - LLM response text
 * @param {Object} capabilityProfile - { reasoning, creativity, determinism, riskTolerance, verbosity }
 * @returns {{
 *   passed: boolean,
 *   driftScore: number,
 *   violations: string[],
 *   warnings: string[],
 *   scores: Object,
 *   drift: Object,
 *   evaluations: Object,
 * }}
 */
export function enforceCapabilities(output, capabilityProfile) {
  if (!output || !capabilityProfile) {
    return {
      passed: true,
      driftScore: 0,
      violations: [],
      warnings: [],
      scores: {},
      drift: { driftScore: 0, perDimension: {}, violations: [], warnings: [], hasCritical: false },
      evaluations: {},
    };
  }

  // Run all evaluators
  const determinism = evaluateDeterminism(output, capabilityProfile);
  const riskTolerance = evaluateRiskTolerance(output, capabilityProfile);
  const verbosity = evaluateVerbosity(output, capabilityProfile);
  const structure = evaluateStructure(output, capabilityProfile);

  // Collect observed scores
  const observedScores = {
    determinism: determinism.score,
    riskTolerance: riskTolerance.score,
    verbosity: verbosity.score,
    structure: structure.score,
  };

  // Compute drift
  const drift = computeCapabilityDrift(capabilityProfile, observedScores);

  // Aggregate violations and warnings
  const allViolations = [
    ...determinism.violations,
    ...riskTolerance.violations,
    ...verbosity.violations,
    ...structure.violations,
    ...drift.violations,
  ];

  const allWarnings = [
    ...determinism.warnings,
    ...riskTolerance.warnings,
    ...verbosity.warnings,
    ...structure.warnings,
    ...drift.warnings,
  ];

  return {
    passed: allViolations.length === 0,
    driftScore: drift.driftScore,
    violations: allViolations,
    warnings: allWarnings,
    scores: observedScores,
    drift,
    evaluations: { determinism, riskTolerance, verbosity, structure },
  };
}

export default {
  enforceCapabilities,
  evaluateDeterminism,
  evaluateRiskTolerance,
  evaluateVerbosity,
  evaluateStructure,
  computeCapabilityDrift,
  CAPABILITY_ENFORCEMENT_CONFIG,
};
