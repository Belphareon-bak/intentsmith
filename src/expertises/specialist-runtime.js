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

// ─── Register Built-in: Accountant ───────────────────────────────────────────
// Migrates the hardcoded accountant tool routing from expert.js

// Shared extractors (reuse from accountant-detector.js on first use)
let _accountantDetector = null;
async function getAccountantDetector() {
  if (!_accountantDetector) {
    _accountantDetector = await import('./tools/accountant-detector.js');
  }
  return _accountantDetector;
}

specialistRuntime.registerSpecialist({
  id: 'accountant',
  domain: 'finance',
  globalParamExtractor: null, // Each tool has its own extractor
  tools: [
    {
      id: 'accountant.compare_tax_entities',
      name: 'Porovnání OSVČ vs s.r.o.',
      description: 'Compare tax burden between sole proprietor and limited company',
      modulePath: './tools/tax-calc.js',
      functionName: 'compareTaxEntities',
      adapter: (p) => [p.gross_income, p],
      patterns: [{
        priority: 10,
        patterns: [
          /(?:porovn|srovn|rozd[ií]l|lépe|lepe|v[ýy]hodn|porovnat|srovnat)/i,
        ],
      }],
      extractParams: (input) => {
        // Inline extraction (avoids async in detector)
        const amount = extractAmountInline(input);
        const year = extractYearInline(input);
        const params = {};
        if (amount) params.gross_income = amount;
        if (year) params.year = year;
        return params;
      },
    },
    {
      id: 'accountant.vat_calculator',
      name: 'Kalkulačka DPH',
      description: 'Calculate VAT (add/remove) at Czech rates',
      modulePath: './tools/vat-calc.js',
      functionName: 'calculateVAT',
      patterns: [{
        priority: 8,
        patterns: [
          /(?:DPH|dph)\s*.{0,30}(?:z\s|ze\s|p[řr]idat|ode[čc][ií]st|kolik|v[ýy][šs]e|sazba)/i,
          /(?:kolik|jak[áa]|jakou|v[ýy][šs]e)\s*.{0,20}(?:DPH|dph)/i,
          /(?:p[řr]id|ode[čc]|vypo[čc]).{0,15}(?:DPH|dph)/i,
        ],
      }],
      extractParams: (input) => {
        const amount = extractAmountInline(input);
        const year = extractYearInline(input);
        const params = {};
        if (amount) params.amount = amount;
        if (year) params.year = year;
        // Rate + direction
        const lower = input.toLowerCase();
        if (/12\s*%|sn[ií][žz]en|ni[žz][šs][ií]/i.test(lower)) params.rate = '12';
        else if (/0\s*%|osvobozen|export/i.test(lower)) params.rate = '0';
        else params.rate = '21';
        if (/bez\s+DPH|ode[čc][ií]st|remove|without/i.test(lower)) params.direction = 'remove';
        else params.direction = 'add';
        return params;
      },
    },
    {
      id: 'accountant.salary_calculator',
      name: 'Mzdová kalkulačka',
      description: 'Calculate net salary from gross (Czech social + health + tax)',
      modulePath: './tools/salary-calc.js',
      functionName: 'calculateSalary',
      patterns: [{
        priority: 6,
        patterns: [
          /(?:[čc]ist[áa]|hrub[áa])\s*.{0,15}(?:mzd|plat|v[ýy]plat)/i,
          /(?:mzd|plat|v[ýy]plat)\s*.{0,20}(?:[čc]ist|hrub|netto|brutto)/i,
          /(?:superhrub|n[áa]klad\s+zam[ěe]stnavatel)/i,
        ],
      }],
      extractParams: (input) => {
        const amount = extractAmountInline(input);
        const year = extractYearInline(input);
        const params = {};
        if (amount) params.gross_salary = amount;
        if (year) params.year = year;
        const childMatch = input.match(/(\d+)\s*(?:d[ěe][tí]|d[ií]t[ěe]|child)/i);
        if (childMatch) params.children = parseInt(childMatch[1]);
        return params;
      },
    },
    {
      id: 'accountant.deadline_checker',
      name: 'Daňové termíny',
      description: 'Check Czech tax filing deadlines',
      modulePath: './tools/deadline-checker.js',
      functionName: 'checkDeadlines',
      patterns: [{
        priority: 4,
        patterns: [
          /(?:kdy|do kdy|term[ií]n|lh[ůu]t|deadline)\s*.{0,30}(?:da[ňn]|p[řr]izn[áa]n[ií]|p[řr]ehled|hl[áa][šs]en[ií])/i,
          /(?:da[ňn]|p[řr]izn[áa]n[ií])\s*.{0,20}(?:kdy|do kdy|term[ií]n|lh[ůu]t)/i,
          /(?:do kdy)\s+(?:podat|odevzdat|odeslat)/i,
        ],
      }],
      extractParams: (input) => {
        const year = extractYearInline(input);
        const params = {};
        if (year) params.year = year;
        const lower = input.toLowerCase();
        if (/osv[čc]|[žz]ivnost/i.test(lower)) params.entity_type = 'osvc';
        else if (/s\.?\s?r\.?\s?o|sro/i.test(lower)) params.entity_type = 'sro';
        if (/poradce|advisor/i.test(lower)) params.has_advisor = true;
        if (/pl[áa]tce\s+DPH/i.test(lower)) params.is_vat_payer = true;
        return params;
      },
    },
    {
      id: 'accountant.tax_calculator',
      name: 'Daňová kalkulačka',
      description: 'Calculate income tax + social/health insurance for OSVČ/s.r.o.',
      modulePath: './tools/tax-calc.js',
      functionName: 'calculateTax',
      patterns: [{
        priority: 2,
        patterns: [
          /(?:kolik|jak[áa]|jakou|v[ýy][šs]e|celkov)\s*.{0,30}(?:da[ňn]|dan[ěe]|odvod|zaplat[ií]m)/i,
          /(?:da[ňn]|dan[ěe])\s*.{0,20}(?:z\s+p[řr][ií]jm|osv[čc]|s\.?\s?r\.?\s?o)/i,
          /(?:zdan[ěe]n[ií]|da[ňn]ov[áa]\s+povinnost)/i,
          /(?:odvody|dan[ěe])\s+(?:z|ze)\s+\d/i,
        ],
      }],
      extractParams: (input) => {
        const amount = extractAmountInline(input);
        const year = extractYearInline(input);
        const params = {};
        if (amount) params.gross_income = amount;
        if (year) params.year = year;
        const lower = input.toLowerCase();
        if (/osv[čc]|[žz]ivnost/i.test(lower)) params.entity_type = 'osvc';
        else if (/s\.?\s?r\.?\s?o|sro/i.test(lower)) params.entity_type = 'sro';
        // Expense type
        if (/pau[šs][áa]l.*80|80\s*%\s*pau[šs]/i.test(lower)) params.expense_type = 'flat_80';
        else if (/pau[šs][áa]l.*60|60\s*%/i.test(lower)) params.expense_type = 'flat_60';
        else if (/pau[šs][áa]l.*40|40\s*%/i.test(lower)) params.expense_type = 'flat_40';
        else if (/skute[čc]n|actual/i.test(lower)) params.expense_type = 'actual';
        return params;
      },
    },
  ],
});

// ─── Inline Extractors (synchronous, no import needed) ───────────────────────

function extractAmountInline(input) {
  let m = input.match(/(\d[\d\s,.]*\d)\s*[kK](?:[čc]|[Čč])?(?:\s|$|,|\.|;)/);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, '').replace(',', '.')) * 1000;

  m = input.match(/(\d[\d\s,.]*\d?)\s*[mM](?:il)?(?:\s|$|,|\.|;)/);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, '').replace(',', '.')) * 1000000;

  m = input.match(/(\d[\d\s,.]*\d?)\s*tis[ií]?c?(?:\s|$)/i);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, '').replace(',', '.')) * 1000;

  m = input.match(/(\d{1,3}(?:\s\d{3})+|\d{4,})/);
  if (m) return parseInt(m[1].replace(/\s/g, ''));

  m = input.match(/(?:z|ze|from)\s+(\d{3,})/);
  if (m) return parseInt(m[1]);

  return null;
}

function extractYearInline(input) {
  const m = input.match(/(?:za\s+rok\s*|rok(?:u)?\s*|v\s+roce\s*|year\s*)(202[3-9]|203[0-5])/);
  if (m) return parseInt(m[1]);
  const m2 = input.match(/\b(202[3-9])\b/);
  if (m2) return parseInt(m2[1]);
  return null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime };
export default specialistRuntime;
