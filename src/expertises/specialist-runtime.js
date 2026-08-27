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

import { pathToFileURL } from 'url';
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
    /** @type {Map<string, Function>} tool module cache (path:fn → function) */
    this._moduleCache = new Map();
    /** @type {Map<string, number>} cache-bust version per module path */
    this._importVersions = new Map();
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
   * Clear cached tool modules for a specialist.
   * Sets cache-bust version so next import() bypasses Node's ESM cache.
   * @param {string} specialistId
   * @returns {number} Number of cache entries cleared
   */
  clearModuleCache(specialistId) {
    const config = this._specialists.get(specialistId);
    if (!config) return 0;
    let cleared = 0;
    for (const tool of config.tools) {
      const key = `${tool.modulePath}:${tool.functionName}`;
      if (this._moduleCache.delete(key)) cleared++;
      const current = this._importVersions.get(tool.modulePath) || 0;
      this._importVersions.set(tool.modulePath, current + 1);
    }
    return cleared;
  }

  /**
   * Lazy-load a tool's module and return the function.
   * Uses cache-busted file URL when module was previously cleared.
   */
  async loadToolFunction(tool) {
    const cacheKey = `${tool.modulePath}:${tool.functionName}`;
    if (this._moduleCache.has(cacheKey)) {
      return this._moduleCache.get(cacheKey);
    }

    const bustVersion = this._importVersions.get(tool.modulePath);
    let mod;
    if (bustVersion) {
      // Cache bust: use file URL with query param to bypass Node's ESM cache
      const url = pathToFileURL(tool.modulePath);
      url.searchParams.set('v', String(bustVersion));
      mod = await import(url.href);
    } else {
      mod = await import(tool.modulePath);
    }

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
   * @param {Object} executionContext - Core-owned per-turn capability context
   * @returns {Promise<{ success: boolean, result: any, toolType: string, params: Object } | { status: 'clarify', missingParams: string[], toolType: string }>}
   */
  async execute(tool, params, executionContext = {}) {
    let effectiveParams = params;
    let evidence = null;
    if (typeof tool.prepareParams === 'function') {
      const prepared = await tool.prepareParams(params, executionContext);
      if (!prepared || typeof prepared !== 'object' || !prepared.params) {
        throw Object.assign(new Error(`Tool ${tool.id}: invalid prepared parameters`), {
          code: 'M3_SPECIALIST_TOOL_PREPARATION_INVALID',
        });
      }
      effectiveParams = prepared.params;
      evidence = prepared.evidence || null;
    }

    // v75: ToolAdapter path — validate → normalize → execute
    if (tool.toolAdapter) {
      const startTime = Date.now();
      const adapterResult = tool.toolAdapter.run(effectiveParams);
      const duration = Date.now() - startTime;

      if (adapterResult.status === 'clarify') {
        return { status: 'clarify', missingParams: adapterResult.missingParams, toolType: tool.id, params, duration };
      }

      if (adapterResult.status === 'error') {
        return { success: false, error: adapterResult.message, toolType: tool.id, params, duration, evidence };
      }

      // status === 'ok'
      logger.debug('SpecialistRuntime', `Tool ${tool.id} executed in ${duration}ms (adapter)`, {
        toolId: tool.id, paramsKeys: Object.keys(params), success: true,
      });

      const presentation = typeof tool.renderResult === 'function'
        ? tool.renderResult({ result: adapterResult.data, evidence, params })
        : null;
      return {
        success: true,
        result: adapterResult.data,
        toolType: tool.id,
        params,
        duration,
        evidence,
        presentation,
        expertiseEvidence: tool.expertiseEvidence || null,
      };
    }

    // Legacy path (tools without toolAdapter)
    const fn = await this.registry.loadToolFunction(tool);

    // Apply adapter if present (transforms params before calling tool function)
    const args = tool.adapter ? tool.adapter(effectiveParams) : effectiveParams;

    const startTime = Date.now();
    const result = await fn(args);
    const duration = Date.now() - startTime;

    const succeeded = result?.success !== false && result?.status !== 'error';

    logger.debug('SpecialistRuntime', `Tool ${tool.id} executed in ${duration}ms`, {
      toolId: tool.id,
      paramsKeys: Object.keys(params),
      success: succeeded,
    });

    const structuredResult = result?.result || result;
    const presentation = typeof tool.renderResult === 'function'
      ? tool.renderResult({ result: structuredResult, evidence, params })
      : null;
    return {
      success: succeeded,
      result: structuredResult,
      error: result?.error || null,
      toolType: tool.id,
      params,
      duration,
      evidence,
      presentation,
      expertiseEvidence: tool.expertiseEvidence || null,
    };
  }
}

// ─── Session Param Cache ────────────────────────────────────────────────────

/**
 * In-memory cache of last successful tool execution params per session+specialist.
 * Enables conversational follow-ups like:
 *   Turn 1: "Kolik zaplatím daní z 850k?" → cache {gross_income: 850000}
 *   Turn 2: "A co jako s.r.o.?" → merge cached + fresh → {gross_income: 850000, entity_type: 'sro'}
 *
 * Scoped: ${sessionId}:${expertiseId} — different specialists never bleed params.
 * Volatile: resets with process. No DB persistence.
 */
class SessionParamCache {
  /**
   * @param {number} [ttlMs=1800000] — 30 min TTL
   */
  constructor(ttlMs = 30 * 60 * 1000) {
    /** @type {Map<string, {toolId: string, params: Object, timestamp: number}>} */
    this._cache = new Map();
    this._ttl = ttlMs;
  }

  /**
   * Save params from a successful tool execution.
   */
  save(sessionId, expertiseId, toolId, params) {
    if (!sessionId) return;
    this._cache.set(`${sessionId}:${expertiseId}`, {
      toolId, params: { ...params }, timestamp: Date.now(),
    });
  }

  /**
   * Get cached params. Returns null if expired or missing.
   */
  get(sessionId, expertiseId) {
    if (!sessionId) return null;
    const key = `${sessionId}:${expertiseId}`;
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this._ttl) {
      this._cache.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * Clear cached params for a session+specialist.
   */
  clear(sessionId, expertiseId) {
    this._cache.delete(`${sessionId}:${expertiseId}`);
  }
}

// ─── Specialist Runtime (orchestrator) ───────────────────────────────────────

class SpecialistRuntime {
  constructor() {
    this.registry = new ToolRegistry();
    this.detector = new IntentDetector();
    this.executor = new ToolExecutor(this.registry);
    /** @type {Map<string, number>} execution counter per specialist */
    this._executingCount = new Map();
    /** @type {SessionParamCache} session context for conversational follow-ups */
    this._sessionCache = new SessionParamCache();
    /** @type {import('./specialist-memory.js').SpecialistMemory|null} D4: persistent context */
    this._memory = null;
    /** @type {import('../telemetry/specialist-telemetry.js').SpecialistTelemetry|null} v82: passive telemetry */
    this._telemetry = null;
    /** @type {{openInvocation: Function}|null} strict-injected ProjectContext host */
    this._projectContextHost = null;
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
   * Clear module caches for a specialist's tools.
   */
  clearModuleCache(specialistId) {
    return this.registry.clearModuleCache(specialistId);
  }

  /**
   * Check if a specialist has tools currently executing.
   */
  isSpecialistBusy(expertiseId) {
    return (this._executingCount.get(expertiseId) || 0) > 0;
  }

  /**
   * Set knowledge base for tool execution context.
   * @param {import('./knowledge-base.js').KnowledgeBase} kb
   */
  setKnowledgeBase(kb) {
    this.executor.setKnowledgeBase(kb);
  }

  /**
   * D4: Set persistent memory store for cross-session context.
   * @param {import('./specialist-memory.js').SpecialistMemory} memory
   */
  setMemory(memory) {
    this._memory = memory;
  }

  /**
   * v82: Set passive telemetry for execution observability.
   * @param {import('../telemetry/specialist-telemetry.js').SpecialistTelemetry} telemetry
   */
  setTelemetry(telemetry) {
    this._telemetry = telemetry;
  }

  setProjectContextHost(host) {
    if (!host || typeof host.openInvocation !== 'function') {
      throw new TypeError('Specialist ProjectContext host must implement openInvocation');
    }
    this._projectContextHost = host;
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
   * v76: Session context — merges cached params from previous turns.
   * Merge priority: extractParams(current) > sessionCache > adapter.defaults
   *
   * @param {string} expertiseId - Expert ID
   * @param {string} input - User message
   * @param {{ sessionId?: string, conversationId?: string, userMessageId?: number, project?: Object, signal?: AbortSignal }} [options={}] - Session context options
   * @returns {Promise<{ toolType: string, result: any, params: Object } | null>}
   */
  async tryToolExecution(
    expertiseId,
    input,
    { sessionId, conversationId, userMessageId, project, signal = null } = {},
  ) {
    const specialist = this.registry.getSpecialist(expertiseId);
    if (!specialist) return null;

    // Step 1: Try normal pattern matching
    let match = this.detector.detect(input, specialist);
    let isContextual = false;

    // Step 2: Merge session params (if normal match found)
    if (match && sessionId) {
      const cached = this._sessionCache.get(sessionId, expertiseId);
      if (cached && cached.toolId === match.tool.id) {
        // Cached params as fallback — fresh extraction overrides
        match.params = { ...cached.params, ...match.params };
        logger.debug('SpecialistRuntime', `Session context merged for ${match.tool.id}`, {
          cachedKeys: Object.keys(cached.params),
          freshKeys: Object.keys(match.params),
        });
      }
    }

    // Step 3: Contextual re-execution — no pattern match but cached tool exists
    if (!match && sessionId) {
      const cached = this._sessionCache.get(sessionId, expertiseId);
      if (cached) {
        const cachedTool = specialist.tools.find(t => t.id === cached.toolId);
        if (cachedTool && cachedTool.extractParams) {
          const freshParams = cachedTool.extractParams(input) || {};
          // Guard: only re-execute if fresh extraction found something meaningful
          if (Object.keys(freshParams).length > 0) {
            match = { tool: cachedTool, params: { ...cached.params, ...freshParams } };
            isContextual = true;
            logger.info('SpecialistRuntime', `Contextual re-execution: ${cachedTool.id}`, {
              freshParams: Object.keys(freshParams),
              cachedParams: Object.keys(cached.params),
            });
          }
        }
      }
    }

    if (!match) return null;

    logger.info('SpecialistRuntime', `Tool match: ${match.tool.id} for specialist ${expertiseId}${isContextual ? ' (contextual)' : ''}`, {
      toolId: match.tool.id,
      inputPreview: input.slice(0, 60),
      contextual: isContextual,
    });

    // v82: Telemetry — tool pattern matched
    this._telemetry?.record('tool.match', {
      specialistId: expertiseId,
      toolId: match.tool.id,
      metadata: { contextual: isContextual },
    });

    // Track execution for busy guard
    this._executingCount.set(expertiseId, (this._executingCount.get(expertiseId) || 0) + 1);
    let projectContext = null;
    try {
      if (match.tool.needsProjectContext === true) {
        if (!this._projectContextHost) {
          return {
            status: 'error',
            toolType: match.tool.id,
            error: 'Specialist ProjectContext host is unavailable',
            errorCode: 'M3_SPECIALIST_PROJECT_CONTEXT_UNAVAILABLE',
          };
        }
        try {
          projectContext = this._projectContextHost.openInvocation({
            extensionId: specialist.extensionId || expertiseId,
            toolId: match.tool.id,
            project,
            conversationId,
            userMessageId,
            signal,
          });
        } catch (error) {
          return {
            status: 'error',
            toolType: match.tool.id,
            error: error.message,
            errorCode: error.code || 'M3_SPECIALIST_PROJECT_CONTEXT_REQUIRED',
          };
        }
      }

      let execResult;
      try {
        execResult = await this.executor.execute(match.tool, match.params, {
          projectContext,
        });
      } catch (error) {
        logger.warn('SpecialistRuntime', `Tool ${match.tool.id} preparation failed: ${error.message}`);
        if (match.tool.failClosed === true) {
          return {
            status: 'error',
            toolType: match.tool.id,
            error: error.message,
            errorCode: error.code || 'M3_SPECIALIST_TOOL_PREPARATION_FAILED',
          };
        }
        throw error;
      }

      // v75: Clarification — tool matched but needs more params
      if (execResult.status === 'clarify') {
        logger.info('SpecialistRuntime', `Tool ${match.tool.id} needs clarification: ${execResult.missingParams.join(', ')}`);
        // v82: Telemetry — clarification needed
        this._telemetry?.record('tool.clarify', {
          specialistId: expertiseId,
          toolId: match.tool.id,
          metadata: { missingParams: execResult.missingParams },
        });
        return {
          status: 'clarify',
          toolType: execResult.toolType,
          missingParams: execResult.missingParams,
          params: execResult.params,
        };
      }

      if (!execResult.success) {
        logger.warn('SpecialistRuntime', `Tool ${match.tool.id} failed: ${execResult.error}`);
        // v82: Telemetry — tool execution failed
        this._telemetry?.record('tool.fail', {
          specialistId: expertiseId,
          toolId: match.tool.id,
          metadata: { error: execResult.error?.slice?.(0, 200) },
        });
        if (match.tool.failClosed === true) {
          return {
            status: 'error',
            toolType: match.tool.id,
            error: execResult.error || 'Specialist tool failed',
            errorCode: 'M3_SPECIALIST_TOOL_FAILED',
          };
        }
        return null; // Fall back to LLM
      }

      // v76: Cache params on success for next turn
      if (sessionId) {
        this._sessionCache.save(sessionId, expertiseId, match.tool.id, match.params);
      }

      // D4: Process explicit memoryWrites from tool result (opt-in)
      if (conversationId && this._memory && execResult.result?.memoryWrites) {
        try {
          this._memory.processWrites(expertiseId, conversationId, execResult.result.memoryWrites);
        } catch (err) {
          logger.warn('SpecialistRuntime', `Memory write failed: ${err.message}`);
        }
      }

      // v82: Telemetry — tool execution succeeded
      this._telemetry?.record('tool.success', {
        specialistId: expertiseId,
        toolId: match.tool.id,
        durationMs: execResult.duration,
      });

      return {
        toolType: execResult.toolType,
        result: execResult.result,
        params: execResult.params,
        duration: execResult.duration,
        evidence: execResult.evidence,
        presentation: execResult.presentation,
        expertiseEvidence: execResult.expertiseEvidence,
      };
    } finally {
      if (projectContext !== null) {
        this._projectContextHost?.closeInvocation?.(projectContext);
      }
      const count = (this._executingCount.get(expertiseId) || 1) - 1;
      if (count <= 0) this._executingCount.delete(expertiseId);
      else this._executingCount.set(expertiseId, count);
    }
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

export { ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime, SessionParamCache };
export default specialistRuntime;
