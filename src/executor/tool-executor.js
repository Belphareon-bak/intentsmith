// CRE v56.2 Sprint B — Tool Executor
// ══════════════════════════════════════════════════════════════════════════════
//
// ACTUAL TOOL EXECUTION for CRE Decisions
//
// This module EXECUTES tools, not describes them.
// When CRE decides TOOL_CALL, this executor RUNS the tools.
//
// CRITICAL INVARIANTS (v45.0):
// - TOOL_CALL decision → tool execution → result
// - Tools return STRUCTURED DATA only — NEVER formatted text!
// - LLM synthesizes response from tool data (not ToolExecutor)
// - web.scrape REQUIRES valid URL (v44.11) — NEVER accept query string!
//
// v56.2 Sprint B changes:
// - sanitizeSearchQuery(): strips instructions, deduplicates, truncates
// - Per-session circuit breaker (no global cascade)
// - failureThreshold 3→5, resetTimeout 60s→30s
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { ToolType, DecisionType, IntentType } from '../chat/cre-decision.js';
import { searchWeb, fetchPage, getProviderStatus } from '../llm/web-search.js';
import { CircuitBreaker, CircuitState } from './circuit-breaker.js';
import { canonicalizeQuery } from './query-canonicalizer.js';
// v121: Accountant expert tool imports removed — tools now registered dynamically
//       by specialist packages via registerToolHandler() during register(ctx).
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// v56.2 Sprint B: Search Query Sanitization
// ─────────────────────────────────────────────────────────────────────────────
// Raw user input should NEVER be sent directly to search providers.
// This function strips instructional phrases, deduplicates words, and truncates.
//
// Examples:
//   "Kdo byl Pythagoras? Odpověz stručně." → "Kdo byl Pythagoras?"
//   "Co je to gravitace? Jednou větou."    → "Co je to gravitace?"
//   "velmi velmi velmi... (500×) ...AI"     → "velmi AI" (deduped + truncated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize raw user input into a clean search query.
 *
 * @param {string} rawInput - Original user input
 * @returns {string} Cleaned search query (max 200 chars)
 */
function sanitizeSearchQuery(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';

  let q = rawInput.trim();

  // 1. Remove instructional/meta phrases (CZ + EN)
  //    These tell the LLM HOW to respond, not WHAT to search for.
  //    NOTE: Cannot use \b with Czech chars (č/ě/ř/ž are \W in JS regex).
  //    Use (?:^|\s) and (?:\s|[.?!,;]|$) instead.
  const INSTRUCTION_WORDS = [
    // Czech
    'odpověz', 'odpovez', 'řekni', 'rekni', 'napiš', 'napis',
    'vysvětli', 'vysvetli', 'jednou větou', 'jednou vetou',
    'stručně', 'strucne', 'podrobně', 'podrobne',
    'detailně', 'detailne', 'česky', 'cesky', 'anglicky',
    'krátce', 'kratce', 'prosím', 'prosim',
    'jednoduše', 'jednoduse', 'přesně', 'presne', 've zkratce',
    // Slovak
    'odpovedz', 'povedz', 'napíš', 'vysvetli', 'stručne', 'podrobne',
    'detailne', 'slovensky', 'prosím', 'v skratke', 'jednoducho',
    // German
    'antworte', 'erkläre', 'beschreibe', 'ausführlich',  // v62.2d: removed 'kurz' — CZ "kurz" = exchange rate
    'auf deutsch', 'auf englisch', 'bitte', 'zusammenfassung',
    'in einem satz', 'genau', 'einfach',
    // Polish
    'odpowiedz', 'powiedz', 'napisz', 'wyjaśnij', 'krótko',
    'szczegółowo', 'po polsku', 'po angielsku', 'proszę',
    'w skrócie', 'jednym zdaniem',
    // French
    'réponds', 'explique', 'décris', 'brièvement', 'en détail',
    'en français', 'en anglais', 'en une phrase', 'simplement',
    's\'il te plaît', 's\'il vous plaît',
    // Spanish
    'responde', 'explica', 'describe', 'brevemente', 'en detalle',
    'en español', 'en inglés', 'en una frase', 'por favor',
    // English
    'briefly', 'concisely', 'in detail', 'please', 'in one sentence',
    'in short', 'simply', 'in english',
  ];
  // Build regex: match instruction words surrounded by whitespace/punctuation/boundaries
  const instrPattern = new RegExp(
    '(?:^|\\s)(' + INSTRUCTION_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?:\\s|[.?!,;:]|$)',
    'gi'
  );
  // Apply twice — first pass may consume shared whitespace between consecutive instruction words
  q = q.replace(instrPattern, ' ').replace(instrPattern, ' ');

  // 2. Remove trailing instruction clauses after period/question mark
  //    "Kdo byl Pythagoras? Odpověz česky." → "Kdo byl Pythagoras?"
  //    But preserve multi-sentence queries: "Co je AI? A jak funguje?"
  q = q.replace(/([.?!])\s+(odpov[ěe][zž]|[řr]ekni|napi[šs]|vysv[ěe]tli|popi[šs]|uve[ďd]|bu[ďd]|pi[šs]|mluv|write|answer|explain|describe|be|keep)\b.*$/gi, '$1');

  // 2b. Clean trailing orphan punctuation ("? ." → "?")
  q = q.replace(/([.?!])\s*[.?!]+\s*$/, '$1');

  // 3. Deduplicate repeated words (handles spam like "velmi velmi velmi...")
  //    Keep max 2 occurrences of any word
  const words = q.split(/\s+/).filter(w => w.length > 0);
  const wordCounts = new Map();
  const deduped = [];
  for (const word of words) {
    const key = word.toLowerCase();
    const count = (wordCounts.get(key) || 0) + 1;
    wordCounts.set(key, count);
    if (count <= 2) {
      deduped.push(word);
    }
  }
  q = deduped.join(' ');

  // 4. Truncate to max 200 chars (search APIs don't handle long queries well)
  if (q.length > 200) {
    q = q.substring(0, 200).replace(/\s\S*$/, ''); // Cut at word boundary
  }

  // 5. Final cleanup
  q = q.replace(/\s+/g, ' ').trim();

  // Fallback: if sanitization removed everything, use first 100 chars of original
  if (q.length < 3) {
    q = rawInput.substring(0, 100).trim();
  }

  return q;
}

// Export for testing
export { sanitizeSearchQuery };

// ─────────────────────────────────────────────────────────────────────────────
// Execution Result Types
// ─────────────────────────────────────────────────────────────────────────────

export const ExecutionStatus = {
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',      // Some tools succeeded, some failed
  FAILED: 'FAILED',
  PENDING: 'PENDING',      // Async execution in progress
};

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 — ToolResult: Structured output from individual tool execution
// ─────────────────────────────────────────────────────────────────────────────
// Tools return DATA, not text. LLM synthesizes response from this data.
// ─────────────────────────────────────────────────────────────────────────────

export const ToolResultType = {
  SEARCH: 'search',
  SCRAPE: 'scrape',
  FILE_READ: 'file_read',
  FILE_WRITE: 'file_write',
  CODE: 'code',
  DATABASE: 'database',
  LOCAL: 'local',
};

/**
 * v45.0 — Structured result from a single tool execution
 *
 * Tools return DATA only — no formatted text!
 * LLM synthesizes human-readable response from this data.
 */
export class ToolResult {
  constructor({
    type,           // ToolResultType - what kind of data is this
    success,        // boolean - did the tool succeed
    data = null,    // any - the actual structured data
    error = null,   // string - error message if failed
    errorCode = null, // string - machine-readable error code
    meta = {},      // { source, latency, confidence, truncated, ... }
  }) {
    this.type = type;
    this.success = success;
    this.data = data;
    this.error = error;
    this.errorCode = errorCode;
    this.meta = {
      timestamp: Date.now(),
      ...meta,
    };
  }

  /**
   * Create a successful search result
   */
  static search({ results, count, source, latency, fallbackInfo = null }) {
    return new ToolResult({
      type: ToolResultType.SEARCH,
      success: true,
      data: {
        results,        // Array of { title, url, snippet }
        count,          // Total result count
        fallbackInfo,   // { hadFallback, providers } if applicable
      },
      meta: {
        source,         // Provider name (e.g., 'duckduckgo', 'searx')
        latency,
        resultCount: count,
      },
    });
  }

  /**
   * Create a successful scrape result
   */
  static scrape({ url, title, content, links = [], latency, quality = null }) {
    return new ToolResult({
      type: ToolResultType.SCRAPE,
      success: true,
      data: {
        url,
        title,
        content,
        links,
        contentLength: content?.length || 0,
        quality,  // v57.1 A1: scrape quality score
      },
      meta: {
        source: url,
        latency,
        truncated: content?.length > 10000,
        qualityGrade: quality?.grade || 'UNKNOWN',  // v57.1 A1
      },
    });
  }

  /**
   * Create a successful local computation result
   */
  static local({ subtype, data, latency = 0 }) {
    return new ToolResult({
      type: ToolResultType.LOCAL,
      success: true,
      data: {
        subtype,    // 'date' | 'calendar' | 'math'
        ...data,
      },
      meta: {
        source: 'local',
        latency,
        localComputation: true,
      },
    });
  }

  /**
   * Create a failed result
   */
  static failed({ type, error, errorCode, suggestion = null }) {
    return new ToolResult({
      type,
      success: false,
      error,
      errorCode,
      meta: {
        suggestion,
        retryable: ['SOURCE_BLOCKED', 'SOURCE_UNAVAILABLE', 'TIMEOUT'].includes(errorCode),
      },
    });
  }
}

// Error codes for tool failures
export const ToolErrorCode = {
  SOURCE_BLOCKED: 'SOURCE_BLOCKED',     // HTTP 403/401
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE', // HTTP 5xx
  TIMEOUT: 'TIMEOUT',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INVALID_PARAMS: 'INVALID_PARAMS',
  SANDBOX_VIOLATION: 'SANDBOX_VIOLATION', // v44.2 - path outside project
  READ_ONLY_PROJECT: 'READ_ONLY_PROJECT', // v44.5 - write in read-only mode
  UNKNOWN: 'UNKNOWN',
};

/**
 * Result of tool execution
 *
 * v45.0: No more summary field - tools return DATA only!
 * LLM synthesizes human-readable response from toolResults.
 */
export class ExecutionResult {
  constructor({
    status,
    toolResults = [],    // Array of ToolResult instances
    error = null,
    errorCode = null,
    retryable = false,
    suggestion = null,
    duration = 0,
    metadata = {},
  }) {
    this.status = status;
    this.toolResults = Array.isArray(toolResults) ? toolResults : [];  // v56.0 FIX: guarantee array
    this.error = error;              // Top-level error if FAILED
    this.errorCode = errorCode;      // Machine-readable error code
    this.retryable = retryable;      // Can be retried
    this.suggestion = suggestion;    // Suggested action for recovery
    this.duration = duration;
    this.metadata = metadata;
    this.timestamp = Date.now();
  }

  get succeeded() {
    return this.status === ExecutionStatus.SUCCESS;
  }

  get hasResults() {
    return this.toolResults.length > 0;
  }

  /**
   * v45.0: Get all successful results' data for LLM synthesis
   * @returns {Array<ToolResult>}
   */
  get successfulResults() {
    return this.toolResults.filter(r => r.success);
  }

  /**
   * v45.0: Get aggregated data from all successful tools
   * This is what gets passed to synthesizeWithLLM()
   */
  getDataForSynthesis() {
    return {
      results: this.successfulResults.map(r => ({
        type: r.type,
        data: r.data,
        meta: r.meta,
      })),
      hasFailures: this.toolResults.some(r => !r.success),
      failedTools: this.toolResults.filter(r => !r.success).map(r => ({
        type: r.type,
        error: r.error,
        errorCode: r.errorCode,
      })),
      totalDuration: this.duration,
    };
  }

  /**
   * Create a failed result with proper error structure
   */
  static failed({ error, errorCode, retryable = false, suggestion = null, duration = 0 }) {
    return new ExecutionResult({
      status: ExecutionStatus.FAILED,
      error,
      errorCode: errorCode || ToolErrorCode.UNKNOWN,
      retryable,
      suggestion,
      duration,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ToolExecutor - EXECUTES tools from CRE decisions
 *
 * This is the execution layer that was MISSING.
 * CRE decides WHAT to do, ToolExecutor DOES it.
 */
export class ToolExecutor {
  constructor(options = {}) {
    this.toolHandlers = new Map();
    this.timeout = options.timeout || 30000;
    this.maxConcurrent = options.maxConcurrent || 3;

    // v44.2 - Project sandbox
    this.projectRootPath = null;   // Set via setProjectContext()
    this.sandboxEnabled = true;    // Enforce path validation
    // v44.5 - Read-only mode (blocks all write operations)
    this.sandboxReadOnly = false;  // Set via setProjectContext({ readOnly: true })

    // v44.3 - Auto-retry configuration
    this.maxAutoRetries = options.maxAutoRetries ?? 1;  // First fail → auto-retry, second → give up
    this.retryDelayMs = options.retryDelayMs ?? 500;    // Brief pause between retries

    // Register built-in tool handlers
    this.registerBuiltinHandlers();

    // Circuit breakers per tool type (resilience layer)
    this.circuitBreakers = new Map();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v44.2 - Project Sandbox Enforcement
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set project context for sandbox enforcement
   * @param {Object} project - { id, name, path, scope, readOnly }
   */
  setProjectContext(project) {
    if (project && project.path) {
      this.projectRootPath = project.path;
      // v44.5 - Support read-only mode for browse-only projects
      this.sandboxReadOnly = project.readOnly === true;
      logger.info('ToolExecutor', `Project sandbox set: ${project.path}`, {
        projectId: project.id,
        projectName: project.name,
        readOnly: this.sandboxReadOnly,
      });
    } else {
      this.projectRootPath = null;
      this.sandboxReadOnly = false;
    }
  }

  /**
   * Clear project context
   */
  clearProjectContext() {
    this.projectRootPath = null;
    this.sandboxReadOnly = false;
    logger.info('ToolExecutor', 'Project sandbox cleared');
  }

  /**
   * Validate that a path is within the project sandbox
   *
   * @param {string} targetPath - Path to validate
   * @param {string} operation - 'read' | 'write' for logging
   * @throws {Error} If path is outside sandbox
   * @returns {string} - Resolved absolute path
   */
  async validateProjectPath(targetPath, operation = 'access') {
    const path = await import('path');

    // If no sandbox set, allow all paths (for system-level operations)
    if (!this.projectRootPath || !this.sandboxEnabled) {
      logger.debug('ToolExecutor', `Sandbox bypassed for ${operation}: ${targetPath}`);
      return path.resolve(targetPath);
    }

    // Resolve both paths to absolute
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(this.projectRootPath);

    // Check if target is within project root
    const relative = path.relative(resolvedRoot, resolvedTarget);

    // Path is outside if relative path starts with '..' or is absolute
    const isOutside = relative.startsWith('..') ||
                      path.isAbsolute(relative) ||
                      relative.includes('..') ||
                      resolvedTarget === resolvedRoot; // Don't allow exact root match for safety

    if (isOutside && resolvedTarget !== resolvedRoot) {
      // Allow exact root match for listing, but not subdir escapes
      const actuallyOutside = !resolvedTarget.startsWith(resolvedRoot + path.sep) &&
                               resolvedTarget !== resolvedRoot;

      if (actuallyOutside) {
        logger.error('ToolExecutor', `SANDBOX VIOLATION: ${operation} attempted outside project`, {
          targetPath,
          resolvedTarget,
          projectRoot: resolvedRoot,
          relative,
        });

        throw Object.assign(
          new Error(
            `SANDBOX_VIOLATION: Path "${targetPath}" is outside project directory. ` +
            `File operations are restricted to: ${this.projectRootPath}`
          ),
          { code: ToolErrorCode.SANDBOX_VIOLATION }
        );
      }
    }

    logger.debug('ToolExecutor', `Path validated for ${operation}: ${resolvedTarget}`, {
      projectRoot: resolvedRoot,
    });

    return resolvedTarget;
  }

  /**
   * Register built-in tool handlers
   */
  registerBuiltinHandlers() {
    // Web Search
    this.register(ToolType.WEB_SEARCH, async (params) => {
      return await this.executeWebSearch(params);
    });

    // Web Scrape
    this.register(ToolType.WEB_SCRAPE, async (params) => {
      return await this.executeWebScrape(params);
    });

    // File Read
    this.register(ToolType.FILE_READ, async (params) => {
      return await this.executeFileRead(params);
    });

    // File Write
    this.register(ToolType.FILE_WRITE, async (params) => {
      return await this.executeFileWrite(params);
    });

    // Code Execute
    this.register(ToolType.CODE_EXECUTE, async (params) => {
      return await this.executeCode(params);
    });

    // Database Query
    this.register(ToolType.DATABASE_QUERY, async (params) => {
      return await this.executeDatabaseQuery(params);
    });

    // v44.4 - Local tools (no external API needed)
    this.register(ToolType.LOCAL_DATE, async (params) => {
      return await this.executeLocalDate(params);
    });

    this.register(ToolType.LOCAL_CALENDAR, async (params) => {
      return await this.executeLocalCalendar(params);
    });

    this.register(ToolType.LOCAL_MATH, async (params) => {
      return await this.executeLocalMath(params);
    });

    // v121: Accountant expert tools removed — now registered dynamically
    //       by specialist packages via registerToolHandler() during register(ctx).
  }

  /**
   * Register a tool handler
   * @param {string} toolType - Tool type from ToolType enum or specialist tool ID
   * @param {Function} handler - Async function that executes the tool
   */
  register(toolType, handler) {
    this.toolHandlers.set(toolType, handler);
    logger.debug('ToolExecutor', `Registered handler for ${toolType}`);
  }

  /**
   * v121: Unregister a tool handler. Called during specialist unregister().
   * @param {string} toolType
   */
  unregister(toolType) {
    this.toolHandlers.delete(toolType);
    logger.debug('ToolExecutor', `Unregistered handler for ${toolType}`);
  }

  /**
   * Execute a CRE decision
   *
   * v44.3 - Now implements auto-retry strategy:
   * - First retryable failure → automatic retry with different provider
   * - Second failure → give up and return failure (triggers ASK_USER)
   *
   * @param {CREDecision} decision - The decision to execute
   * @param {Object} context - Execution context
   * @returns {Promise<ExecutionResult>}
   */
  async execute(decision, context = {}) {
    const startTime = Date.now();
    const retryCount = context.retryCount ?? 0;
    const telemetry = context.telemetry ?? null;

    // Validate decision type
    if (decision.type !== DecisionType.TOOL_CALL) {
      logger.error('ToolExecutor', `Invalid decision type for execution: ${decision.type}`);
      return new ExecutionResult({
        status: ExecutionStatus.FAILED,
        error: `Cannot execute decision type ${decision.type}. Only TOOL_CALL can be executed.`,
        duration: Date.now() - startTime,
      });
    }

    // Validate tools exist
    if (!decision.tools || decision.tools.length === 0) {
      logger.error('ToolExecutor', 'TOOL_CALL decision has no tools');
      return new ExecutionResult({
        status: ExecutionStatus.FAILED,
        error: 'TOOL_CALL decision has no tools to execute',
        duration: Date.now() - startTime,
      });
    }

    // v44.2 - Set project sandbox from context if provided
    // v56.2 Sprint C2: MUST clear when no project — otherwise leaks between sessions (#9)
    if (context.project && context.project.path) {
      this.setProjectContext(context.project);
    } else if (context.projectPath) {
      this.setProjectContext({ path: context.projectPath });
    } else {
      // No project context → explicitly clear to prevent sandbox leak
      this.clearProjectContext();
    }

    logger.info('ToolExecutor', `Executing ${decision.tools.length} tools`, {
      tools: decision.tools,
      intent: decision.intent,
      sandboxPath: this.projectRootPath,
      retryCount,
    });

    // Execute tools - v45.0: handlers return ToolResult objects
    const toolResults = [];
    let hasFailure = false;
    let hasSuccess = false;
    let retryableFailures = [];

    for (const toolType of decision.tools) {
      const handler = this.toolHandlers.get(toolType);

      if (!handler) {
        logger.warn('ToolExecutor', `No handler for tool: ${toolType}`);
        toolResults.push(ToolResult.failed({
          type: toolType,
          error: `No handler registered for ${toolType}`,
          errorCode: ToolErrorCode.NOT_CONFIGURED,
        }));
        hasFailure = true;
        continue;
      }

      try {
        // ════════════════════════════════════════════════════════════════════
        // v56.2 Sprint B: Per-session circuit breaker
        // ════════════════════════════════════════════════════════════════════
        // BEFORE: Global singleton → one bad query blocks ALL sessions
        // NOW: Per-session → cascade failure isolated to offending session
        // Key format: "toolType:sessionId" (e.g., "search:abc123")
        // Anonymous sessions use explicit "anonymous" key (not shared "default")
        // ════════════════════════════════════════════════════════════════════
        const breakerKey = context.sessionId
          ? `${toolType}:${context.sessionId}`
          : `${toolType}:anonymous`;

        if (!this.circuitBreakers.has(breakerKey)) {
          this.circuitBreakers.set(breakerKey, new CircuitBreaker({
            failureThreshold: 5,    // v56.2: raised from 3 (more tolerant)
            resetTimeout: 30000,    // v56.2: lowered from 60s (faster recovery)
          }));
        }
        const breaker = this.circuitBreakers.get(breakerKey);
        const cbStateBefore = breaker.state;

        if (breaker.state === CircuitState.OPEN) {
          logger.warn('ToolExecutor', `Circuit OPEN for ${toolType}, skipping`, {
            failures: breaker.failureCount,
          });
          toolResults.push(ToolResult.failed({
            type: toolType,
            error: `Tool ${toolType} temporarily disabled (circuit breaker open after repeated failures)`,
            errorCode: ToolErrorCode.CIRCUIT_OPEN || 'CIRCUIT_OPEN',
            retryable: false,
          }));
          hasFailure = true;
          continue;
        }

        // ════════════════════════════════════════════════════════════════════
        // v56.2 Sprint B: Sanitize search query
        // ════════════════════════════════════════════════════════════════════
        // Raw user input → cleaned search query (strips instructions, dedupes)
        // Only for search-type tools; scrape/file tools use original input.
        // ════════════════════════════════════════════════════════════════════
        const rawQuery = context.input || context.query;
        const isSearchTool = toolType === 'search' || toolType === 'web.search';

        let effectiveQuery = rawQuery;
        if (isSearchTool) {
          // Phase 1: Sanitize (strip instructions, dedupe, truncate)
          const sanitized = sanitizeSearchQuery(rawQuery);

          if (sanitized !== rawQuery) {
            logger.info('ToolExecutor', 'Search query sanitized', {
              original: rawQuery.substring(0, 80),
              sanitized: sanitized.substring(0, 80),
              trimmed: rawQuery.length - sanitized.length,
            });
          }

          // Phase 2: Canonicalize (strip connective noise left by sanitizer)
          const canonical = canonicalizeQuery(sanitized);
          effectiveQuery = canonical.query;

          if (canonical.changed) {
            logger.info('ToolExecutor', 'Search query canonicalized', {
              sanitized: sanitized.substring(0, 80),
              canonical: canonical.query.substring(0, 80),
              stripped: canonical.stripped.join(', '),
            });
          }
        }

        const result = await this.executeWithTimeout(
          handler({
            ...context,
            query: effectiveQuery,  // v56.2: MUST be AFTER ...context to override context.query
            intent: decision.intent,
            metadata: decision.metadata,
          }),
          this.timeout
        );

        // v45.0: Handler returns ToolResult directly
        if (result instanceof ToolResult) {
          toolResults.push(result);
          if (result.success) {
            hasSuccess = true;
            breaker.recordSuccess();
          } else {
            hasFailure = true;
            breaker.recordFailure();
            if (result.meta?.retryable) {
              retryableFailures.push({ toolType, result });
            }
          }

          // Telemetry: record tool invocation + circuit state
          telemetry?.recordToolInvocation({
            tool: toolType,
            durationMs: result.meta?.latency ?? 0,
            success: result.success,
            retryCount,
            errorType: result.success ? null : result.errorCode,
            errorCode: result.errorCode ?? null,
          });
          telemetry?.recordCircuitState({
            tool: toolType,
            stateBefore: cbStateBefore,
            stateAfter: breaker.state,
          });
        } else {
          // Legacy fallback: wrap raw result in ToolResult
          if (result && result.success === false) {
            toolResults.push(ToolResult.failed({
              type: toolType,
              error: result.error || 'Tool failed',
              errorCode: result.errorCode || 'UNKNOWN',
            }));
            hasFailure = true;
          } else {
            toolResults.push(new ToolResult({
              type: toolType,
              success: true,
              data: result,
              meta: { source: 'legacy' },
            }));
            hasSuccess = true;
          }
        }

        logger.debug('ToolExecutor', `Tool ${toolType} completed`, {
          success: toolResults[toolResults.length - 1].success,
        });

      } catch (err) {
        logger.error('ToolExecutor', `Tool ${toolType} failed: ${err.message}`, { retryCount });

        // Record failure in circuit breaker
        const breakerRef = this.circuitBreakers.get(toolType);
        if (breakerRef) breakerRef.recordFailure();

        const errorInfo = this.classifyError(err);

        toolResults.push(ToolResult.failed({
          type: toolType,
          error: err.message,
          errorCode: errorInfo.code,
          suggestion: errorInfo.suggestion,
        }));
        hasFailure = true;

        if (errorInfo.retryable) {
          retryableFailures.push({ toolType, errorInfo, err });
        }

        // Telemetry: record failed invocation + circuit state
        telemetry?.recordToolInvocation({
          tool: toolType,
          durationMs: 0,
          success: false,
          retryCount,
          errorType: errorInfo.code,
          errorCode: errorInfo.code,
        });
        const breakerForTelemetry = this.circuitBreakers.get(
          context.sessionId ? `${toolType}:${context.sessionId}` : `${toolType}:anonymous`
        );
        if (breakerForTelemetry) {
          telemetry?.recordCircuitState({
            tool: toolType,
            stateBefore: 'CLOSED', // was at least CLOSED to get here
            stateAfter: breakerForTelemetry.state,
          });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.3 — AUTO-RETRY STRATEGY
    // ════════════════════════════════════════════════════════════════════════
    // If we had retryable failures and haven't exceeded max retries, auto-retry
    if (hasFailure && !hasSuccess && retryableFailures.length > 0 && retryCount < this.maxAutoRetries) {
      logger.info('ToolExecutor', `Auto-retry triggered (attempt ${retryCount + 1}/${this.maxAutoRetries})`, {
        failedTools: retryableFailures.map(f => f.toolType),
      });

      // Brief delay before retry
      if (this.retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
      }

      // Recursive retry with incremented count
      return await this.execute(decision, {
        ...context,
        retryCount: retryCount + 1,
        previousFailures: toolResults,  // Pass failure info for logging
      });
    }
    // ════════════════════════════════════════════════════════════════════════

    // Determine overall status
    let status;
    if (hasSuccess && !hasFailure) {
      status = ExecutionStatus.SUCCESS;
    } else if (hasSuccess && hasFailure) {
      status = ExecutionStatus.PARTIAL;
    } else {
      status = ExecutionStatus.FAILED;
    }

    const duration = Date.now() - startTime;

    // Telemetry: record execution summary
    telemetry?.recordExecution({
      executionTimeMs: duration,
      status,
      partialFailure: status === ExecutionStatus.PARTIAL,
    });

    // v45.0: No summary - tools return DATA only
    // LLM synthesizes response via synthesizeWithLLM() in handlers
    return new ExecutionResult({
      status,
      toolResults,  // Array of ToolResult (structured data)
      duration,
      metadata: {
        intent: decision.intent,
        toolCount: decision.tools.length,
        retryCount,
        autoRetried: retryCount > 0,
      },
    });
  }

  /**
   * Execute with timeout
   */
  async executeWithTimeout(promise, timeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Classify error for proper handling
   * @param {Error} err - The error to classify
   * @returns {{ code: string, retryable: boolean, suggestion: string }}
   */
  classifyError(err) {
    const message = err.message?.toLowerCase() || '';

    // v44.2 - Sandbox violation (path outside project)
    if (err.code === ToolErrorCode.SANDBOX_VIOLATION || message.includes('sandbox_violation')) {
      return {
        code: ToolErrorCode.SANDBOX_VIOLATION,
        retryable: false,
        suggestion: 'Soubor je mimo projektový adresář. Operace se soubory jsou omezeny na aktuální projekt.',
      };
    }

    // v44.5 - Read-only project violation
    if (err.code === 'READ_ONLY_PROJECT' || message.includes('read_only_project') || message.includes('read-only mode')) {
      return {
        code: ToolErrorCode.READ_ONLY_PROJECT,
        retryable: false,
        suggestion: 'Projekt je v režimu pouze pro čtení. Pro zápis povolte editaci v nastavení projektu.',
      };
    }

    // HTTP 403 - Source blocked (common anti-bot protection)
    if (message.includes('403') || message.includes('forbidden')) {
      return {
        code: ToolErrorCode.SOURCE_BLOCKED,
        retryable: true,
        suggestion: 'Zdroj blokuje automatické požadavky. Zkuste jiný zdroj nebo přeformulujte dotaz.',
      };
    }

    // HTTP 401 - Unauthorized
    if (message.includes('401') || message.includes('unauthorized')) {
      return {
        code: ToolErrorCode.SOURCE_BLOCKED,
        retryable: false,
        suggestion: 'Zdroj vyžaduje autentizaci.',
      };
    }

    // HTTP 5xx - Server error
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return {
        code: ToolErrorCode.SOURCE_UNAVAILABLE,
        retryable: true,
        suggestion: 'Vzdálený server je dočasně nedostupný. Zkuste to znovu později.',
      };
    }

    // Timeout
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        code: ToolErrorCode.TIMEOUT,
        retryable: true,
        suggestion: 'Požadavek vypršel. Zkuste jednodušší dotaz nebo jiný zdroj.',
      };
    }

    // Not configured
    if (message.includes('not_configured') || message.includes('not connected')) {
      return {
        code: ToolErrorCode.NOT_CONFIGURED,
        retryable: false,
        suggestion: 'Služba není nakonfigurována. Kontaktujte administrátora.',
      };
    }

    // Default: unknown
    return {
      code: ToolErrorCode.UNKNOWN,
      retryable: false,
      suggestion: null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v45.0: TEXT FORMATTING REMOVED
  // ─────────────────────────────────────────────────────────────────────────────
  // buildSummary(), formatSearchResults(), formatScrapeResults() REMOVED
  // Tools return DATA only — LLM synthesizes response via synthesizeWithLLM()
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Implementation Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Execute web search
   * v57.1 A2 - Auto-retry with query simplification when results are sparse
   * v45.0 - Returns ToolResult with structured data (no formatted text)
   * v44.2 - Multi-provider search with automatic fallback
   */
  async executeWebSearch(params) {
    const { query } = params;
    const startTime = Date.now();

    logger.info('ToolExecutor', `Executing web search: "${query}"`);

    try {
      const searchResult = await searchWeb(query, 10);
      const { results, usedProvider, fallbackLog, allFailed } = searchResult;

      // ──────────────────────────────────────────────────────────────────────
      // v57.1 A2: Auto-retry with simplified query when results are sparse
      // Condition: not all failed (providers work) but < 3 results
      // Strategy: simplify query deterministically (no LLM call needed)
      // ──────────────────────────────────────────────────────────────────────
      if (!allFailed && results.length < 3 && results.length > 0) {
        const simplified = simplifySearchQuery(query);
        if (simplified && simplified !== query) {
          logger.info('ToolExecutor', `Sparse results (${results.length}), retrying with simplified: "${simplified}"`);
          
          const retryResult = await searchWeb(simplified, 10);
          if (!retryResult.allFailed && retryResult.results.length > 0) {
            // Merge and deduplicate
            const seen = new Set(results.map(r => r.url));
            for (const r of retryResult.results) {
              if (!seen.has(r.url)) {
                results.push(r);
                seen.add(r.url);
              }
            }
            logger.info('ToolExecutor', `Auto-retry added ${retryResult.results.length} results, total: ${results.length}`);
            fallbackLog.push({ provider: 'auto-retry', status: 'success', query: simplified, added: retryResult.results.length });
          }
        }
      }

      // v57.1 A2: Also retry on zero results with broadened query
      if (allFailed || results.length === 0) {
        const broadened = broadenSearchQuery(query);
        if (broadened && broadened !== query) {
          logger.info('ToolExecutor', `Zero results, retrying with broadened: "${broadened}"`);
          const retryResult = await searchWeb(broadened, 10);
          
          if (!retryResult.allFailed && retryResult.results.length > 0) {
            const latency = Date.now() - startTime;
            logger.info('ToolExecutor', `Broadened retry found ${retryResult.results.length} results`);
            
            return ToolResult.search({
              results: retryResult.results.map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
              })),
              count: retryResult.results.length,
              source: retryResult.usedProvider,
              latency,
              fallbackInfo: {
                hadFallback: true,
                retried: true,
                originalQuery: query,
                retriedQuery: broadened,
                providers: [...fallbackLog, { provider: 'auto-retry-broadened', status: 'success' }].map(l => l.provider),
              },
            });
          }
        }

        // Still nothing
        const status = getProviderStatus();
        logger.warn('ToolExecutor', 'Web search returned no results (after retry)', { status, fallbackLog });

        return ToolResult.failed({
          type: ToolResultType.SEARCH,
          error: 'No search results found. All search providers may be temporarily unavailable.',
          errorCode: 'NO_RESULTS',
          suggestion: 'Zkuste přeformulovat dotaz nebo to zkusit později.',
        });
      }

      const latency = Date.now() - startTime;
      logger.info('ToolExecutor', `Web search found ${results.length} results via ${usedProvider}`);

      // v45.0: Return structured success with DATA only
      return ToolResult.search({
        results: results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
        count: results.length,
        source: usedProvider,
        latency,
        fallbackInfo: fallbackLog?.length > 1 ? {
          hadFallback: true,
          providers: fallbackLog.map(l => l.provider),
        } : null,
      });

    } catch (err) {
      logger.error('ToolExecutor', `Web search failed: ${err.message}`);

      return ToolResult.failed({
        type: ToolResultType.SEARCH,
        error: `Search failed: ${err.message}`,
        errorCode: 'SEARCH_ERROR',
      });
    }
  }

  // v45.0: formatFallbackLog() REMOVED - no text formatting in ToolExecutor

  /**
   * Execute web scrape
   * v45.0 - Returns ToolResult with structured data (no formatted text)
   * v44.11 - CRITICAL: URL guard - NEVER accept non-URL input!
   */
  async executeWebScrape(params) {
    const { url, urls } = params;
    const startTime = Date.now();

    // v44.11 FIX 3: URL GUARD - scrape REQUIRES valid URLs
    let targetUrl = url;

    // Support array of URLs (from REPORT pipeline)
    if (!targetUrl && urls && Array.isArray(urls) && urls.length > 0) {
      targetUrl = urls[0];
    }

    // CRITICAL: Validate that targetUrl is actually a URL
    if (!targetUrl) {
      logger.error('ToolExecutor', 'SCRAPE_REQUIRES_URL: No URL provided');
      return ToolResult.failed({
        type: ToolResultType.SCRAPE,
        error: 'SCRAPE_REQUIRES_URL: web.scrape requires a valid URL, not a query string',
        errorCode: 'SCRAPE_REQUIRES_URL',
      });
    }

    // v44.11: Strict URL validation
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      logger.error('ToolExecutor', 'SCRAPE_INVALID_URL: Input is not a valid URL', {
        received: targetUrl.substring(0, 100),
      });
      return ToolResult.failed({
        type: ToolResultType.SCRAPE,
        error: `SCRAPE_INVALID_URL: "${targetUrl.substring(0, 50)}..." is not a valid URL. Expected http:// or https://`,
        errorCode: 'SCRAPE_INVALID_URL',
      });
    }

    logger.info('ToolExecutor', `Executing web scrape: ${targetUrl}`);

    try {
      // v57.1 A1: Pass query to fetchPage for relevance-based truncation
      const query = params.query || params.input || '';
      const maxLength = params.maxLength || 10000;
      const page = await fetchPage(targetUrl, maxLength, query);
      const latency = Date.now() - startTime;

      if (!page) {
        return ToolResult.failed({
          type: ToolResultType.SCRAPE,
          error: 'Failed to fetch page content',
          errorCode: 'FETCH_FAILED',
        });
      }

      // v57.1 A1: If content is blocked (login wall, captcha, etc.), return failure
      if (page.quality && !page.quality.usable) {
        logger.warn('ToolExecutor', `Scrape blocked: ${page.quality.reason}`, { url: targetUrl });
        return ToolResult.failed({
          type: ToolResultType.SCRAPE,
          error: `Page content blocked: ${page.quality.reason}`,
          errorCode: 'SCRAPE_BLOCKED',
          suggestion: page.quality.reason === 'LOGIN_WALL' 
            ? 'Stránka vyžaduje přihlášení.' 
            : 'Obsah stránky se nepodařilo extrahovat.',
        });
      }

      // v45.0: Return structured data only
      return ToolResult.scrape({
        url: targetUrl,
        title: page.title,
        content: page.content,
        links: page.links || [],
        latency,
        quality: page.quality,  // v57.1 A1
      });

    } catch (err) {
      logger.error('ToolExecutor', `Web scrape failed: ${err.message}`);

      return ToolResult.failed({
        type: ToolResultType.SCRAPE,
        error: `Scrape failed: ${err.message}`,
        errorCode: 'SCRAPE_ERROR',
      });
    }
  }

  /**
   * Execute file read
   * v44.2 - Now enforces project sandbox
   */
  async executeFileRead(params) {
    const { path, filePath } = params;
    const targetPath = path || filePath;

    logger.info('ToolExecutor', `Executing file read: ${targetPath}`);

    if (!targetPath) {
      throw new Error('FILE_READ: No file path specified');
    }

    // v44.2 - Validate path is within project sandbox
    const validatedPath = await this.validateProjectPath(targetPath, 'read');

    // Use Node.js fs
    const fs = await import('fs/promises');
    const content = await fs.readFile(validatedPath, 'utf-8');

    return {
      path: validatedPath,
      content,
      size: content.length,
    };
  }

  /**
   * Execute file write
   * v44.2 - Now enforces project sandbox
   * v44.5 - Checks for read-only mode
   * P0-2  - Zápis jde přes jednu řízenou cestu (`executor/effects.js`), ne
   *         přes `fs.writeFile`.  Sandbox a read-only zůstávají tam, kde byly:
   *         nejdřív se rozhodne, jestli **smí** vzniknout otázka, teprve pak se
   *         ptá.  Ptát se na zápis, který by stejně neprošel sandboxem, by
   *         znamenalo posílat lidem otázky, jejichž „ano" nic neudělá.
   */
  async executeFileWrite(params) {
    const { path, filePath, content } = params;
    const targetPath = path || filePath;

    logger.info('ToolExecutor', `Executing file write: ${targetPath}`);

    // v44.5 - Check read-only mode FIRST (before any validation)
    if (this.sandboxReadOnly) {
      logger.warn('ToolExecutor', 'WRITE BLOCKED: Project is in read-only mode', {
        targetPath,
        projectRoot: this.projectRootPath,
      });
      throw Object.assign(
        new Error(
          `READ_ONLY_PROJECT: Cannot write to "${targetPath}". ` +
          `Project is in read-only mode. Use project settings to enable writes.`
        ),
        { code: 'READ_ONLY_PROJECT' }
      );
    }

    if (!targetPath) {
      throw new Error('FILE_WRITE: No file path specified');
    }

    if (content === undefined) {
      throw new Error('FILE_WRITE: No content specified');
    }

    // v44.2 - Validate path is within project sandbox
    const validatedPath = await this.validateProjectPath(targetPath, 'write');

    const { writeUserFile } = await import('./effects.js');
    const result = await writeUserFile({
      filePath: validatedPath,
      content: String(content),
      // Vlastníkem zámku je běh (`027`).  `sessionId` proteče z `execute()`
      // spolu se zbytkem kontextu; bez něj se běh pojmenuje anonymně, ale
      // pořád je to jeden držitel, ne žádný.
      runId: `tool:${params.sessionId || params.requestId || 'anonymous'}`,
      ownerLabel: 'tool.file_write',
    });

    if (!result.written) {
      // Nezapsáno se **vyhodí**, ne vrátí jako `success: true` s nulou bajtů.
      // Volající tuhle hodnotu předává dál jako výsledek nástroje a „povedlo se,
      // jen nic nevzniklo" je přesně ta věta, kvůli které se pak hledá soubor,
      // který nikdy nebyl.
      throw Object.assign(
        new Error(`FILE_WRITE_NOT_PERFORMED: ${result.state}${result.message ? ` — ${result.message}` : ''}`),
        { code: 'FILE_WRITE_NOT_PERFORMED', state: result.state, guard: result.guard,
          approvalId: result.approvalId || null },
      );
    }

    return {
      path: result.target || validatedPath,
      bytesWritten: content.length,
      guard: result.guard,
      approvalId: result.approvalId || null,
      success: true,
    };
  }

  /**
   * Execute code
   * TODO: Integrate with code execution sandbox
   */
  async executeCode(params) {
    const { code, language } = params;

    logger.info('ToolExecutor', `Executing code (${language || 'unknown'})`);

    if (this.codeExecutor) {
      return await this.codeExecutor.execute(code, { language });
    }

    throw new Error(
      'CODE_EXECUTE_NOT_CONFIGURED: Code executor not connected. ' +
      'Wire ToolExecutor.codeExecutor to your sandbox provider.'
    );
  }

  /**
   * Execute database query
   * TODO: Integrate with database service
   */
  async executeDatabaseQuery(params) {
    const { query, database } = params;

    logger.info('ToolExecutor', `Executing database query on ${database || 'default'}`);

    if (this.databaseService) {
      return await this.databaseService.query(query, { database });
    }

    throw new Error(
      'DATABASE_QUERY_NOT_CONFIGURED: Database service not connected. ' +
      'Wire ToolExecutor.databaseService to your database provider.'
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v44.4 - Local Tool Implementations (no external API)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Execute local date/time query
   * v45.0 - Returns ToolResult with structured data
   */
  async executeLocalDate(params) {
    const now = new Date();

    const days = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    const months = ['ledna', 'února', 'března', 'dubna', 'května', 'června',
                    'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

    // v45.0: Return structured data via ToolResult.local()
    return ToolResult.local({
      subtype: 'date',
      data: {
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0],
        dayOfWeek: days[now.getDay()],
        dayOfMonth: now.getDate(),
        month: months[now.getMonth()],
        year: now.getFullYear(),
        timestamp: now.getTime(),
      },
    });
  }

  /**
   * Execute local calendar/astronomy calculation
   * v45.0 - Returns ToolResult with structured data
   */
  async executeLocalCalendar(params) {
    const now = new Date();

    // Moon phase calculation (approximation)
    const knownNewMoon = new Date('2000-01-06T18:14:00Z');
    const lunarCycle = 29.53058867;
    const daysSinceKnown = (now - knownNewMoon) / (1000 * 60 * 60 * 24);
    const currentCycleDay = daysSinceKnown % lunarCycle;

    // Phase names
    let phase, phaseEmoji;
    if (currentCycleDay < 1.85) { phase = 'nov'; phaseEmoji = '🌑'; }
    else if (currentCycleDay < 7.38) { phase = 'dorůstající srpek'; phaseEmoji = '🌒'; }
    else if (currentCycleDay < 9.23) { phase = 'první čtvrť'; phaseEmoji = '🌓'; }
    else if (currentCycleDay < 14.77) { phase = 'dorůstající měsíc'; phaseEmoji = '🌔'; }
    else if (currentCycleDay < 16.61) { phase = 'úplněk'; phaseEmoji = '🌕'; }
    else if (currentCycleDay < 22.15) { phase = 'couvající měsíc'; phaseEmoji = '🌖'; }
    else if (currentCycleDay < 23.99) { phase = 'poslední čtvrť'; phaseEmoji = '🌗'; }
    else { phase = 'couvající srpek'; phaseEmoji = '🌘'; }

    // Days until next full moon
    const daysUntilFull = currentCycleDay < 14.77
      ? 14.77 - currentCycleDay
      : lunarCycle - currentCycleDay + 14.77;

    // Days until next new moon
    const daysUntilNew = currentCycleDay < 1
      ? 1 - currentCycleDay
      : lunarCycle - currentCycleDay;

    // v45.0: Return structured data via ToolResult.local()
    return ToolResult.local({
      subtype: 'calendar',
      data: {
        currentPhase: phase,
        phaseEmoji,
        cycleDay: Math.round(currentCycleDay * 10) / 10,
        daysUntilFullMoon: Math.round(daysUntilFull),
        daysUntilNewMoon: Math.round(daysUntilNew),
        illumination: Math.round(Math.abs(Math.cos((currentCycleDay / lunarCycle) * 2 * Math.PI)) * 100),
      },
    });
  }

  /**
   * Execute local math calculation
   * v45.0 - Returns ToolResult with structured data
   */
  async executeLocalMath(params) {
    const { query } = params;

    // Extract math expression from query
    const mathMatch = query.match(/[\d\s+\-*/().]+/);
    if (!mathMatch) {
      return ToolResult.failed({
        type: ToolResultType.LOCAL,
        error: 'Nenalezen matematický výraz',
        errorCode: 'NO_EXPRESSION',
      });
    }

    const expression = mathMatch[0].trim();

    // Safe evaluation - only allow numbers and basic operators
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      return ToolResult.failed({
        type: ToolResultType.LOCAL,
        error: 'Neplatný matematický výraz',
        errorCode: 'INVALID_EXPRESSION',
      });
    }

    try {
      // Use Function constructor for safe eval (no access to global scope)
      const result = new Function(`return (${expression})`)();

      if (typeof result !== 'number' || !isFinite(result)) {
        return ToolResult.failed({
          type: ToolResultType.LOCAL,
          error: 'Výsledek není platné číslo',
          errorCode: 'INVALID_RESULT',
        });
      }

      // v45.0: Return structured data via ToolResult.local()
      return ToolResult.local({
        subtype: 'math',
        data: {
          expression,
          result,
        },
      });
    } catch (err) {
      return ToolResult.failed({
        type: ToolResultType.LOCAL,
        error: `Chyba výpočtu: ${err.message}`,
        errorCode: 'COMPUTE_ERROR',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Service Wiring
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Wire external services
   * Call this during initialization to connect actual tool implementations
   */
  wireServices({
    searchService,
    scrapeService,
    codeExecutor,
    databaseService,
  } = {}) {
    if (searchService) {
      this.searchService = searchService;
      logger.info('ToolExecutor', 'Search service wired');
    }
    if (scrapeService) {
      this.scrapeService = scrapeService;
      logger.info('ToolExecutor', 'Scrape service wired');
    }
    if (codeExecutor) {
      this.codeExecutor = codeExecutor;
      logger.info('ToolExecutor', 'Code executor wired');
    }
    if (databaseService) {
      this.databaseService = databaseService;
      logger.info('ToolExecutor', 'Database service wired');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v57.1 A2: Search Query Retry Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simplify a search query by removing filler words and keeping key terms.
 * Used when original query returns sparse results (< 3).
 * Deterministic — no LLM call needed.
 */
function simplifySearchQuery(query) {
  if (!query || query.length < 5) return null;

  // Remove question structures, keep subject
  let simplified = query
    // Czech question patterns → keep the noun
    .replace(/^(?:co je to|co je|co jsou|kdo je|kdo byl|jak funguje|jak se)\s+/i, '')
    .replace(/^(?:jaký je|jaká je|jaké je|jaké jsou|kolik je|kolik stojí)\s+/i, '')
    .replace(/^(?:kde je|kde najdu|kdy je|kdy byl|proč je)\s+/i, '')
    // English question patterns
    .replace(/^(?:what is|who is|how does|where is|when is|why is)\s+/i, '')
    // Trailing instructions
    .replace(/\s*(?:prosím|odpověz|stručně|podrobně|vysvětli|please|briefly)\s*$/i, '')
    .replace(/[?!.]+$/, '')
    .trim();

  // If simplified is too short or same, try just keeping longest words
  if (simplified.length < 3 || simplified === query) {
    const words = query
      .split(/\s+/)
      .filter(w => w.length > 3)
      .filter(w => !/^(jaký|jaká|jaké|který|která|které|prosím|odpověz|stručně|this|that|the|what|how)$/i.test(w));
    
    if (words.length >= 1) {
      simplified = words.slice(0, 4).join(' ');
    }
  }

  return simplified.length >= 3 ? simplified : null;
}

/**
 * Broaden a search query when zero results returned.
 * Strategy: reduce to just the core 1-2 keywords.
 */
function broadenSearchQuery(query) {
  if (!query || query.length < 5) return null;

  const words = query
    .replace(/[?!.,;:'"]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    // Remove very common words
    .filter(w => !/^(jaký|jaká|jaké|který|která|které|prosím|odpověz|stručně|aktuální|nejlepší|this|that|the|what|how|best|current|latest|about)$/i.test(w));

  if (words.length === 0) return null;
  if (words.length <= 2) return words.join(' ');

  // Keep only the 2 longest words (most likely to be meaningful nouns)
  const byLength = [...words].sort((a, b) => b.length - a.length);
  return byLength.slice(0, 2).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

export const toolExecutor = new ToolExecutor();

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  ToolExecutor,
  toolExecutor,
  ExecutionResult,
  ExecutionStatus,
  // v45.0: New structured result types
  ToolResult,
  ToolResultType,
};
