// C3 Expert Sandbox — Offline Simulation + Baseline Comparison
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure functions for measuring expert config characteristics without LLM calls.
// Used for:
//   - Comparing expert configs against a baseline
//   - Detecting drift (verbosity, tone, safety, temperature)
//   - Validating that wizard changes don't degrade behavior
//
// For LLM-based testing, use POST /api/expertise-wizard/test-prompt endpoint.
//
// v63.0 — Merge Engine v2
// ══════════════════════════════════════════════════════════════════════════════

import { mergeExpertisePrompt } from './merge-engine.js';
import { estimateTokens } from './merge-types.js';
import { checkCapabilityNormalization } from './capability-mapping.js';

// ─── Simulation ──────────────────────────────────────────────────────────────

/**
 * Run an offline simulation of an expert config.
 * Returns measurable characteristics of the merged output.
 *
 * @param {Object} expertConfig - Expert config (single expertise)
 * @param {Object} [options]
 * @param {string|null} [options.userContext] - Optional user context
 * @param {Object|null} [options.specialistOverride] - Optional specialist
 * @returns {Object} Simulation metrics
 */
export function runSimulation(expertConfig, options = {}) {
  const expertise = {
    id: expertConfig.id || '__sandbox',
    name: expertConfig.name || 'Sandbox Expert',
    modules: expertConfig.modules || null,
    capabilities: expertConfig.capabilities || null,
    systemPrompt: expertConfig.systemPrompt || '',
    temperature: expertConfig.temperature ?? 0.5,
    tone: expertConfig.tone || 'professional',
    styleRules: expertConfig.styleRules || {},
    weight: 1.0,
  };

  let mergeResult;
  try {
    mergeResult = mergeExpertisePrompt(
      [expertise],
      options.userContext || null,
      options.specialistOverride || null,
    );
  } catch (err) {
    return {
      success: false,
      error: err.message,
      metrics: null,
    };
  }

  const prompt = mergeResult.prompt;
  const enforcement = mergeResult.enforcement;
  const metadata = mergeResult.metadata;

  // Compute metrics
  const instructionCount = (prompt.match(/^- /gm) || []).length;
  const sectionCount = (prompt.match(/^## /gm) || []).length;
  const disclaimerCount = (enforcement.disclaimers || []).length;
  const forbiddenCount = enforcement.forbiddenPhrases?.length || 0;
  const capNorm = checkCapabilityNormalization(expertConfig.capabilities);

  return {
    success: true,
    error: null,
    metrics: {
      // Prompt characteristics
      tokenCount: metadata.tokenCount,
      promptLength: prompt.length,
      instructionCount,
      sectionCount,
      disclaimerCount,

      // Temperature & tone
      temperature: metadata.temperature,
      temperatureMethod: metadata.temperatureMethod,
      tone: metadata.tone,

      // Enforcement
      forbiddenPhrasesCount: forbiddenCount,
      minResponseLength: enforcement.minResponseLength || 0,

      // Capability
      capabilityVector: metadata.capabilityVector || null,
      capabilityWarnings: capNorm.warnings,
      capabilitySum: capNorm.normalizedSum,

      // Safety score (0-100, higher = stricter)
      safetyScore: _computeSafetyScore(enforcement, disclaimerCount),

      // Verbosity estimate (0-100, higher = more verbose)
      verbosityEstimate: _estimateVerbosity(metadata, enforcement),
    },
  };
}

/**
 * Run simulation with multiple expertises (merge scenario).
 *
 * @param {Array<Object>} expertConfigs - 1-3 expertise configs
 * @param {Object} [options]
 * @returns {Object} Simulation metrics
 */
export function runMultiSimulation(expertConfigs, options = {}) {
  const expertises = expertConfigs.map((cfg, idx) => ({
    id: cfg.id || `__sandbox_${idx}`,
    name: cfg.name || `Sandbox Expert ${idx}`,
    modules: cfg.modules || null,
    capabilities: cfg.capabilities || null,
    systemPrompt: cfg.systemPrompt || '',
    temperature: cfg.temperature ?? 0.5,
    tone: cfg.tone || 'professional',
    styleRules: cfg.styleRules || {},
    weight: cfg.weight ?? 0.5,
  }));

  try {
    const mergeResult = mergeExpertisePrompt(
      expertises,
      options.userContext || null,
      options.specialistOverride || null,
    );

    const prompt = mergeResult.prompt;
    const enforcement = mergeResult.enforcement;
    const metadata = mergeResult.metadata;
    const instructionCount = (prompt.match(/^- /gm) || []).length;
    const sectionCount = (prompt.match(/^## /gm) || []).length;
    const disclaimerCount = (enforcement.disclaimers || []).length;

    return {
      success: true,
      error: null,
      expertiseCount: expertises.length,
      metrics: {
        tokenCount: metadata.tokenCount,
        promptLength: prompt.length,
        instructionCount,
        sectionCount,
        disclaimerCount,
        temperature: metadata.temperature,
        temperatureMethod: metadata.temperatureMethod,
        tone: metadata.tone,
        forbiddenPhrasesCount: enforcement.forbiddenPhrases?.length || 0,
        minResponseLength: enforcement.minResponseLength || 0,
        capabilityVector: metadata.capabilityVector || null,
        compatibility: metadata.compatibility,
        safetyScore: _computeSafetyScore(enforcement, disclaimerCount),
        verbosityEstimate: _estimateVerbosity(metadata, enforcement),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      expertiseCount: expertises.length,
      metrics: null,
    };
  }
}

// ─── Baseline Comparison ─────────────────────────────────────────────────────

/**
 * Compare two simulation results and report drift.
 *
 * @param {Object} current - Current simulation metrics
 * @param {Object} baseline - Baseline simulation metrics
 * @returns {Object} Drift report
 */
export function compareBaseline(current, baseline) {
  if (!current.metrics || !baseline.metrics) {
    return {
      comparable: false,
      reason: current.error || baseline.error || 'Missing metrics',
    };
  }

  const c = current.metrics;
  const b = baseline.metrics;

  const drifts = [];

  // Temperature drift
  const tempDrift = Math.abs(c.temperature - b.temperature);
  if (tempDrift > 0.1) {
    drifts.push({
      dimension: 'temperature',
      baseline: b.temperature,
      current: c.temperature,
      delta: +(c.temperature - b.temperature).toFixed(3),
      severity: tempDrift > 0.2 ? 'high' : 'medium',
    });
  }

  // Token count drift
  const tokenDrift = Math.abs(c.tokenCount - b.tokenCount) / Math.max(b.tokenCount, 1);
  if (tokenDrift > 0.15) {
    drifts.push({
      dimension: 'tokenCount',
      baseline: b.tokenCount,
      current: c.tokenCount,
      delta: c.tokenCount - b.tokenCount,
      severity: tokenDrift > 0.3 ? 'high' : 'medium',
    });
  }

  // Safety score drift
  const safetyDrift = Math.abs(c.safetyScore - b.safetyScore);
  if (safetyDrift > 15) {
    drifts.push({
      dimension: 'safetyScore',
      baseline: b.safetyScore,
      current: c.safetyScore,
      delta: c.safetyScore - b.safetyScore,
      severity: safetyDrift > 30 ? 'high' : 'medium',
    });
  }

  // Verbosity drift
  const verbDrift = Math.abs(c.verbosityEstimate - b.verbosityEstimate);
  if (verbDrift > 15) {
    drifts.push({
      dimension: 'verbosityEstimate',
      baseline: b.verbosityEstimate,
      current: c.verbosityEstimate,
      delta: c.verbosityEstimate - b.verbosityEstimate,
      severity: verbDrift > 30 ? 'high' : 'medium',
    });
  }

  // Tone drift
  if (c.tone !== b.tone) {
    drifts.push({
      dimension: 'tone',
      baseline: b.tone,
      current: c.tone,
      delta: null,
      severity: 'medium',
    });
  }

  // Instruction count drift
  const instrDrift = Math.abs(c.instructionCount - b.instructionCount);
  if (instrDrift > 3) {
    drifts.push({
      dimension: 'instructionCount',
      baseline: b.instructionCount,
      current: c.instructionCount,
      delta: c.instructionCount - b.instructionCount,
      severity: instrDrift > 6 ? 'high' : 'medium',
    });
  }

  return {
    comparable: true,
    driftCount: drifts.length,
    hasCriticalDrift: drifts.some(d => d.severity === 'high'),
    drifts,
  };
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function _computeSafetyScore(enforcement, disclaimerCount) {
  let score = 0;
  // Forbidden phrases increase safety
  score += Math.min(30, (enforcement.forbiddenPhrases?.length || 0) * 3);
  // Disclaimers increase safety
  score += Math.min(20, disclaimerCount * 7);
  // minResponseLength > 0 indicates more careful responses
  score += Math.min(20, Math.floor((enforcement.minResponseLength || 0) / 10));
  // Base score
  score += 30;
  return Math.min(100, score);
}

function _estimateVerbosity(metadata, enforcement) {
  let score = 50; // neutral
  // Higher token count = more verbose prompt = likely more verbose responses
  if (metadata.tokenCount > 200) score += 10;
  if (metadata.tokenCount > 400) score += 10;
  // Higher minResponseLength = more verbose
  if (enforcement.minResponseLength > 100) score += 15;
  if (enforcement.minResponseLength > 200) score += 10;
  // Higher temperature = more diverse = potentially longer
  if (metadata.temperature > 0.7) score += 5;
  // Capability vector
  if (metadata.capabilityVector?.verbosity > 70) score += 15;
  if (metadata.capabilityVector?.verbosity < 30) score -= 15;
  return Math.max(0, Math.min(100, score));
}
