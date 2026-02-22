// D1: Specialist Runtime — Generalized Tool-Augmented Expert Framework
// ══════════════════════════════════════════════════════════════════════════════
//
// Generalizes the accountant pattern (detector → tool → enforce → persona wrap)
// into a reusable framework for any specialist domain.
//
// Architecture:
//   1. ToolRegistry    — maps specialist → tools (lazy-loaded modules)
//   2. IntentDetector  — pattern-based routing: user input → tool match
//   3. ToolExecutor    — runs deterministic tool, returns structured result
//   4. SpecialistRuntime — orchestrates detect → execute → wrap pipeline
//
// The accountant remains registered here (migration from expert.js hardcoding).
// New specialists register their tools via registerSpecialist().
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} ToolDefinition
 * @property {string} id            - Unique tool ID (e.g. "accountant.tax_calculator")
 * @property {string} name          - Human-readable name
 * @property {string} description   - What the tool does
 * @property {string} modulePath    - Path to the tool module (lazy-loaded)
 * @property {string} functionName  - Exported function name in the module
 * @property {Function} [adapter]   - Optional param adapter: (params) => toolFnArgs
 * @property {Array<PatternGroup>} patterns - Intent detection patterns
 * @property {Function} [extractParams] - Custom param extractor: (input) => params
 */

/**
 * @typedef {Object} PatternGroup
 * @property {RegExp[]} patterns    - Regex patterns to match
 * @property {number} [priority]    - Higher = checked first (default 0)
 */

/**
 * @typedef {Object} SpecialistConfig
 * @property {string} id            - Specialist expert ID (e.g. "accountant")
 * @property {string} domain        - Domain name (e.g. "finance")
 * @property {ToolDefinition[]} tools - Registered tools
 * @property {Function} [globalParamExtractor] - Shared param extractor for all tools
 */

// ─── Tool Registry ───────────────────────────────────────────────────────────

class ToolRegistry {
  constructor() {
    /** @type {Map<string, SpecialistConfig>} specialist ID → config */
    this._specialists = new Map();
    /** @type {Map<string, Function>} tool module cache (path → module) */
    this._moduleCache = new Map();
  }

  /**
   * Register a specialist with its tools.
   */
  registerSpecialist(config) {
    if (!config.id) throw new Error('Specialist config requires id');
    if (!config.tools?.length) throw new Error('Specialist config requires at least one tool');

    // Sort tools by highest priority pattern first
    const tools = config.tools.map(t => ({
      ...t,
      patterns: (t.patterns || []).sort((a, b) => (b.priority || 0) - (a.priority || 0)),
    }));

    this._specialists.set(config.id, { ...config, tools });
    logger.debug('SpecialistRuntime', `Registered specialist: ${config.id} (${tools.length} tools)`);
  }

  /**
   * Get specialist config by expert ID.
   */
  getSpecialist(expertiseId) {
    return this._specialists.get(expertiseId) || null;
  }

  /**
   * Check if an expert has specialist tools registered.
   */
  isSpecialist(expertiseId) {
    return this._specialists.has(expertiseId);
  }

  /**
   * Unregister a specialist and its tools.
   * @param {string} specialistId
   */
  unregisterSpecialist(specialistId) {
    if (!this._specialists.has(specialistId)) return;
    this._specialists.delete(specialistId);
    logger.debug('SpecialistRuntime', `Unregistered specialist: ${specialistId}`);
  }

  /**
   * Get all registered specialist IDs.
   */
  getSpecialistIds() {
    return [...this._specialists.keys()];
  }

  /**
   * Lazy-load a tool's module and return the function.
   */
  async loadToolFunction(tool) {
    const cacheKey = `${tool.modulePath}:${tool.functionName}`;
    if (this._moduleCache.has(cacheKey)) {
      return this._moduleCache.get(cacheKey);
    }

    const mod = await import(tool.modulePath);
    const fn = mod[tool.functionName];
    if (typeof fn !== 'function') {
      throw new Error(`Tool ${tool.id}: ${tool.functionName} is not a function in ${tool.modulePath}`);
    }

    this._moduleCache.set(cacheKey, fn);
    return fn;
  }
}

// ─── Intent Detector ─────────────────────────────────────────────────────────

class IntentDetector {
  /**
   * Detect which tool (if any) matches the user input for a given specialist.
   *
   * @param {string} input - User message
   * @param {SpecialistConfig} specialist - Specialist configuration
   * @returns {{ tool: ToolDefinition, params: Object } | null}
   */
  detect(input, specialist) {
    if (!input || input.length < 5) return null;

    for (const tool of specialist.tools) {
      for (const patternGroup of tool.patterns) {
        const patterns = patternGroup.patterns || [patternGroup];
        const matched = Array.isArray(patterns)
          ? patterns.some(p => p instanceof RegExp ? p.test(input) : false)
          : false;

        if (matched) {
          // Extract parameters
          let params = {};
          if (tool.extractParams) {
            params = tool.extractParams(input) || {};
          }
          if (specialist.globalParamExtractor) {
            params = { ...specialist.globalParamExtractor(input), ...params };
          }

          return { tool, params };
        }
      }
    }

    return null;
  }
}

// ─── Tool Executor ───────────────────────────────────────────────────────────

class ToolExecutor {
  constructor(registry) {
    this.registry = registry;
    /** @type {import('./knowledge-base.js').KnowledgeBase|null} */
    this._knowledgeBase = null;
  }

  /**
   * Set knowledge base reference for tool execution context.
   * @param {import('./knowledge-base.js').KnowledgeBase} kb
   */
  setKnowledgeBase(kb) {
    this._knowledgeBase = kb;
  }

  /**
   * Execute a matched tool with extracted parameters.
   *
   * @param {ToolDefinition} tool - The matched tool definition
   * @param {Object} params - Extracted parameters
   * @returns {Promise<{ success: boolean, result: any, toolType: string, params: Object }>}
   */
  async execute(tool, params) {
    const fn = await this.registry.loadToolFunction(tool);

    // Apply adapter if present (transforms params before calling tool function)
    const args = tool.adapter ? tool.adapter(params) : params;

    const startTime = Date.now();
    const result = fn(args);
    const duration = Date.now() - startTime;

    logger.debug('SpecialistRuntime', `Tool ${tool.id} executed in ${duration}ms`, {
      toolId: tool.id,
      paramsKeys: Object.keys(params),
      success: result?.success !== false,
    });

    return {
      success: result?.success !== false,
      result: result?.result || result,
      error: result?.error || null,
      toolType: tool.id,
      params,
      duration,
    };
  }
}

// ─── Specialist Runtime (orchestrator) ───────────────────────────────────────

class SpecialistRuntime {
  constructor() {
    this.registry = new ToolRegistry();
    this.detector = new IntentDetector();
    this.executor = new ToolExecutor(this.registry);
  }

  /**
   * Register a specialist with tools.
   */
  registerSpecialist(config) {
    this.registry.registerSpecialist(config);
  }

  /**
   * Unregister a specialist.
   */
  unregisterSpecialist(specialistId) {
    this.registry.unregisterSpecialist(specialistId);
  }

  /**
   * Set knowledge base for tool execution context.
   * @param {import('./knowledge-base.js').KnowledgeBase} kb
   */
  setKnowledgeBase(kb) {
    this.executor.setKnowledgeBase(kb);
  }

  /**
   * Check if an expert has specialist capabilities.
   */
  isSpecialist(expertiseId) {
    return this.registry.isSpecialist(expertiseId);
  }

  /**
   * Try to detect and execute a tool for the given expert + input.
   * Returns null if no tool matched (caller should fall back to LLM).
   *
   * @param {string} expertiseId - Expert ID
   * @param {string} input - User message
   * @returns {Promise<{ toolType: string, result: any, params: Object } | null>}
   */
  async tryToolExecution(expertiseId, input) {
    const specialist = this.registry.getSpecialist(expertiseId);
    if (!specialist) return null;

    const match = this.detector.detect(input, specialist);
    if (!match) return null;

    logger.info('SpecialistRuntime', `Tool match: ${match.tool.id} for specialist ${expertiseId}`, {
      toolId: match.tool.id,
      inputPreview: input.slice(0, 60),
    });

    const execResult = await this.executor.execute(match.tool, match.params);

    if (!execResult.success) {
      logger.warn('SpecialistRuntime', `Tool ${match.tool.id} failed: ${execResult.error}`);
      return null; // Fall back to LLM
    }

    return {
      toolType: execResult.toolType,
      result: execResult.result,
      params: execResult.params,
      duration: execResult.duration,
    };
  }

  /**
   * Get all registered specialist IDs.
   */
  getSpecialistIds() {
    return this.registry.getSpecialistIds();
  }

  /**
   * Get specialist config (for UI/API).
   */
  getSpecialistConfig(expertiseId) {
    const spec = this.registry.getSpecialist(expertiseId);
    if (!spec) return null;
    return {
      id: spec.id,
      domain: spec.domain,
      tools: spec.tools.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
      })),
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const specialistRuntime = new SpecialistRuntime();

// v74: Accountant registration moved to specialists/accountant-cz/index.js
// Loaded dynamically by specialist-loader.js on boot.

// ─── Exports ─────────────────────────────────────────────────────────────────

export { ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime };
export default specialistRuntime;
