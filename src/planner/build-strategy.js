// Build Strategy v112 (F9) — Adaptive Build Strategy Selection
// ══════════════════════════════════════════════════════════════════════════════
//
// Selects optimal milestone ordering based on detected architecture:
//   - Multi-signal selection: framework (0.4) + layers (0.3) + pattern history (0.3)
//   - Confidence-gated prompt injection (>= 0.7 → recommended, 0.4-0.7 → hint, < 0.4 → omit)
//   - NestJS can be model-first OR controller-first depending on detected layers
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Strategy Types ─────────────────────────────────────────────────────────

export const BuildStrategy = Object.freeze({
  SCHEMA_FIRST:     'schema_first',
  COMPONENT_FIRST:  'component_first',
  COMMAND_FIRST:    'command_first',
  MODEL_FIRST:      'model_first',
  TEST_FIRST:       'test_first',
  DEFAULT:          'default',
});

// ─── Framework → Strategy Mapping ───────────────────────────────────────────

const FRAMEWORK_STRATEGY = {
  // REST / Backend
  express:   BuildStrategy.SCHEMA_FIRST,
  fastify:   BuildStrategy.SCHEMA_FIRST,
  koa:       BuildStrategy.SCHEMA_FIRST,
  flask:     BuildStrategy.SCHEMA_FIRST,
  fastapi:   BuildStrategy.SCHEMA_FIRST,
  gin:       BuildStrategy.SCHEMA_FIRST,
  echo:      BuildStrategy.SCHEMA_FIRST,
  fiber:     BuildStrategy.SCHEMA_FIRST,
  actix:     BuildStrategy.SCHEMA_FIRST,
  axum:      BuildStrategy.SCHEMA_FIRST,
  spring:    BuildStrategy.MODEL_FIRST,
  quarkus:   BuildStrategy.MODEL_FIRST,
  django:    BuildStrategy.MODEL_FIRST,
  // NestJS is ambiguous — resolved by layer signal
  nestjs:    null,
  // Frontend / UI
  react:     BuildStrategy.COMPONENT_FIRST,
  vue:       BuildStrategy.COMPONENT_FIRST,
  svelte:    BuildStrategy.COMPONENT_FIRST,
  angular:   BuildStrategy.COMPONENT_FIRST,
  'next.js': BuildStrategy.COMPONENT_FIRST,
  nuxt:      BuildStrategy.COMPONENT_FIRST,
  // CLI
  commander: BuildStrategy.COMMAND_FIRST,
  yargs:     BuildStrategy.COMMAND_FIRST,
  cobra:     BuildStrategy.COMMAND_FIRST,
  clap:      BuildStrategy.COMMAND_FIRST,
  click:     BuildStrategy.COMMAND_FIRST,
  // Electron — hybrid (component-first by default)
  electron:  BuildStrategy.COMPONENT_FIRST,
};

// ─── Layer Dominance → Strategy Override ────────────────────────────────────

const LAYER_DOMINANCE = {
  model:      BuildStrategy.MODEL_FIRST,
  repository: BuildStrategy.MODEL_FIRST,
  migration:  BuildStrategy.MODEL_FIRST,
  controller: BuildStrategy.SCHEMA_FIRST,
  middleware: BuildStrategy.SCHEMA_FIRST,
  view:       BuildStrategy.COMPONENT_FIRST,
  test:       BuildStrategy.TEST_FIRST,
};

// ─── Strategy Orderings ─────────────────────────────────────────────────────

const STRATEGY_ORDERINGS = {
  [BuildStrategy.SCHEMA_FIRST]:     ['routes/endpoints', 'handlers/controllers', 'middleware', 'services', 'models', 'tests'],
  [BuildStrategy.COMPONENT_FIRST]:  ['components', 'state management', 'routing', 'API integration', 'styling', 'tests'],
  [BuildStrategy.COMMAND_FIRST]:    ['commands/CLI', 'core logic', 'output formatting', 'configuration', 'tests'],
  [BuildStrategy.MODEL_FIRST]:      ['data models/schema', 'migrations', 'services/repositories', 'API/controllers', 'tests'],
  [BuildStrategy.TEST_FIRST]:       ['test setup', 'test cases', 'implementation', 'integration', 'documentation'],
  [BuildStrategy.DEFAULT]:          ['core logic', 'supporting modules', 'integration', 'tests'],
};

// ─── Signal Weights ─────────────────────────────────────────────────────────

const W_FRAMEWORK = 0.4;
const W_LAYERS    = 0.3;
const W_PATTERNS  = 0.3;

// ─── selectStrategy ─────────────────────────────────────────────────────────

/**
 * Select a build strategy based on architecture detection + pattern history.
 *
 * @param {Object} architecture - From detectArchitecture() — { framework: string[], layers: {}, patterns: [] }
 * @param {Array} [patternHistory] - From minePatterns() or task memory — past strategy outcomes
 * @returns {{ strategy: string, ordering: string[], confidence: number, rationale: string }}
 */
export function selectStrategy(architecture, patternHistory) {
  if (!architecture) {
    return { strategy: BuildStrategy.DEFAULT, ordering: STRATEGY_ORDERINGS[BuildStrategy.DEFAULT], confidence: 0, rationale: 'No architecture data' };
  }

  const signals = [];

  // Signal 1: Framework (weight 0.4)
  const fwSignal = _frameworkSignal(architecture.framework || []);
  if (fwSignal) signals.push({ ...fwSignal, weight: W_FRAMEWORK });

  // Signal 2: Layer dominance (weight 0.3)
  const layerSignal = _layerSignal(architecture.layers || {});
  if (layerSignal) signals.push({ ...layerSignal, weight: W_LAYERS });

  // Signal 3: Pattern history (weight 0.3)
  const patternSignal = _patternSignal(patternHistory || []);
  if (patternSignal) signals.push({ ...patternSignal, weight: W_PATTERNS });

  if (signals.length === 0) {
    return { strategy: BuildStrategy.DEFAULT, ordering: STRATEGY_ORDERINGS[BuildStrategy.DEFAULT], confidence: 0, rationale: 'No signals detected' };
  }

  // Weighted vote
  const votes = {};
  let totalWeight = 0;
  for (const s of signals) {
    votes[s.strategy] = (votes[s.strategy] || 0) + s.confidence * s.weight;
    totalWeight += s.weight;
  }

  // Find winner
  let best = BuildStrategy.DEFAULT;
  let bestScore = 0;
  for (const [strategy, score] of Object.entries(votes)) {
    if (score > bestScore) {
      bestScore = score;
      best = strategy;
    }
  }

  const confidence = totalWeight > 0 ? bestScore / totalWeight : 0;
  const rationale = signals.map(s => `${s.source}: ${s.strategy} (${Math.round(s.confidence * 100)}%)`).join(', ');

  return {
    strategy: best,
    ordering: STRATEGY_ORDERINGS[best] || STRATEGY_ORDERINGS[BuildStrategy.DEFAULT],
    confidence: Math.round(confidence * 100) / 100,
    rationale,
  };
}

// ─── inferStrategy ──────────────────────────────────────────────────────────

/**
 * Heuristic strategy inference from raw signals (exposed for testing).
 *
 * @param {string[]} frameworks - Detected framework names
 * @param {Object} layers - { layerName: files[] }
 * @param {Array} patterns - Pattern history entries
 * @returns {{ strategy: string, confidence: number, source: string }}
 */
export function inferStrategy(frameworks, layers, patterns) {
  const result = selectStrategy(
    { framework: frameworks || [], layers: layers || {}, patterns: [] },
    patterns || []
  );
  return { strategy: result.strategy, confidence: result.confidence, source: result.rationale };
}

// ─── formatStrategyForPrompt ────────────────────────────────────────────────

/**
 * Format build strategy for D1 prompt injection.
 * Confidence-gated: >= 0.7 → recommended, 0.4-0.7 → hint, < 0.4 → omit.
 *
 * @param {Object} strategyResult - From selectStrategy()
 * @returns {string} Prompt section (may be empty if confidence too low)
 */
export function formatStrategyForPrompt(strategyResult) {
  if (!strategyResult) return '';

  const { strategy, ordering, confidence, rationale } = strategyResult;

  if (confidence < 0.4 || strategy === BuildStrategy.DEFAULT) return '';

  const orderList = ordering.map((step, i) => `  ${i + 1}. ${step}`).join('\n');

  if (confidence >= 0.7) {
    return `## Build Strategy (Recommended)
Based on detected architecture (${rationale}), the recommended build order is:

**Strategy: ${_formatStrategyName(strategy)}**
${orderList}

Structure your milestones to follow this order. Earlier milestones should establish foundations that later ones build upon.`;
  }

  // 0.4 <= confidence < 0.7 → hint
  return `## Build Strategy Hint
Consider using a **${_formatStrategyName(strategy)}** approach:
${orderList}

This is a suggestion based on detected signals (${rationale}). Adjust if the project specifics warrant a different order.`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive strategy signal from detected frameworks.
 */
function _frameworkSignal(frameworks) {
  if (!frameworks || frameworks.length === 0) return null;

  for (const fw of frameworks) {
    const normalized = fw.toLowerCase().replace(/[.\s]/g, '');
    // Try exact match first
    for (const [key, strategy] of Object.entries(FRAMEWORK_STRATEGY)) {
      const normKey = key.toLowerCase().replace(/[.\s]/g, '');
      if (normalized === normKey || normalized.includes(normKey)) {
        if (strategy === null) continue; // ambiguous (NestJS) — skip, let layers decide
        return { strategy, confidence: 0.8, source: `framework:${fw}` };
      }
    }
  }

  return null;
}

/**
 * Derive strategy signal from detected layers.
 */
function _layerSignal(layers) {
  if (!layers || Object.keys(layers).length === 0) return null;

  // Count files per strategy implied by layer
  const stratCounts = {};
  for (const [layerName, files] of Object.entries(layers)) {
    const fileCount = Array.isArray(files) ? files.length : 0;
    if (fileCount === 0) continue;

    const normalizedLayer = layerName.toLowerCase();
    for (const [layerKey, strategy] of Object.entries(LAYER_DOMINANCE)) {
      if (normalizedLayer.includes(layerKey)) {
        stratCounts[strategy] = (stratCounts[strategy] || 0) + fileCount;
      }
    }
  }

  // Dominant layer strategy
  let best = null;
  let bestCount = 0;
  for (const [strategy, count] of Object.entries(stratCounts)) {
    if (count > bestCount) {
      bestCount = count;
      best = strategy;
    }
  }

  if (!best) return null;

  // Confidence based on dominance ratio
  const total = Object.values(stratCounts).reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? Math.min(bestCount / total, 0.9) : 0;

  return { strategy: best, confidence, source: `layers:${best}` };
}

/**
 * Derive strategy signal from pattern history (past strategy successes/failures).
 */
function _patternSignal(patterns) {
  if (!patterns || patterns.length === 0) return null;

  // Look for fix_archetype patterns or explicit strategy entries
  const strategyCounts = {};
  for (const p of patterns) {
    const data = typeof p.data === 'string' ? _tryParse(p.data) : p.data;
    if (!data) continue;

    // Pattern with explicit strategy field
    if (data.buildStrategy) {
      const success = data.success !== false;
      const key = data.buildStrategy;
      if (!strategyCounts[key]) strategyCounts[key] = { success: 0, fail: 0 };
      if (success) strategyCounts[key].success++;
      else strategyCounts[key].fail++;
    }
  }

  // Find best strategy from history
  let best = null;
  let bestRatio = 0;
  for (const [strategy, counts] of Object.entries(strategyCounts)) {
    const total = counts.success + counts.fail;
    if (total < 2) continue; // Need at least 2 data points
    const ratio = counts.success / total;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = strategy;
    }
  }

  if (!best) return null;
  return { strategy: best, confidence: bestRatio * 0.8, source: `history:${best}` };
}

/**
 * Format strategy name for display.
 */
function _formatStrategyName(strategy) {
  const names = {
    [BuildStrategy.SCHEMA_FIRST]:    'Schema-First (API routes → handlers → services)',
    [BuildStrategy.COMPONENT_FIRST]: 'Component-First (UI → state → routing)',
    [BuildStrategy.COMMAND_FIRST]:   'Command-First (CLI → logic → output)',
    [BuildStrategy.MODEL_FIRST]:     'Model-First (data models → services → API)',
    [BuildStrategy.TEST_FIRST]:      'Test-First (tests → implementation)',
    [BuildStrategy.DEFAULT]:         'Default',
  };
  return names[strategy] || strategy;
}

function _tryParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  BuildStrategy,
  selectStrategy,
  inferStrategy,
  formatStrategyForPrompt,
};
