// CRE v45.0 — Tool Executor
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
// v45.0 ARCHITECTURE:
// - Tool nesmí "mluvit" — tools provide DATA, LLM generates RESPONSE
// - ToolResult contains: type, data, meta (source, latency, confidence)
// - No buildSummary, formatSearchResults, formatScrapeResults here
// - Handler layer calls synthesizeWithLLM() with tool data
//
// CHANGELOG:
// v45.0 - Tools return structured DATA only (no text formatting)
// v44.11 - URL guard for web.scrape (SCRAPE_REQUIRES_URL, SCRAPE_INVALID_URL)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { ToolType, DecisionType, IntentType } from './cre-decision.js';
import { searchWeb, fetchPage, getProviderStatus } from '../llm/web-search.js';

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
  static scrape({ url, title, content, links = [], latency }) {
    return new ToolResult({
      type: ToolResultType.SCRAPE,
      success: true,
      data: {
        url,
        title,
        content,
        links,
        contentLength: content?.length || 0,
      },
      meta: {
        source: url,
        latency,
        truncated: content?.length > 10000,
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
    this.toolResults = toolResults;  // v45.0: Array of ToolResult (structured data only)
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
  }

  /**
   * Register a tool handler
   * @param {string} toolType - Tool type from ToolType enum
   * @param {Function} handler - Async function that executes the tool
   */
  register(toolType, handler) {
    this.toolHandlers.set(toolType, handler);
    logger.debug('ToolExecutor', `Registered handler for ${toolType}`);
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
    if (context.project && context.project.path) {
      this.setProjectContext(context.project);
    } else if (context.projectPath) {
      this.setProjectContext({ path: context.projectPath });
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
        const result = await this.executeWithTimeout(
          handler({
            query: context.input || context.query,
            intent: decision.intent,
            metadata: decision.metadata,
            ...context,
          }),
          this.timeout
        );

        // v45.0: Handler returns ToolResult directly
        if (result instanceof ToolResult) {
          toolResults.push(result);
          if (result.success) {
            hasSuccess = true;
          } else {
            hasFailure = true;
            if (result.meta?.retryable) {
              retryableFailures.push({ toolType, result });
            }
          }
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
      const latency = Date.now() - startTime;

      if (allFailed || results.length === 0) {
        const status = getProviderStatus();
        logger.warn('ToolExecutor', 'Web search returned no results', { status, fallbackLog });

        // v45.0: Return structured failure
        return ToolResult.failed({
          type: ToolResultType.SEARCH,
          error: 'No search results found. All search providers may be temporarily unavailable.',
          errorCode: 'NO_RESULTS',
          suggestion: 'Zkuste přeformulovat dotaz nebo to zkusit později.',
        });
      }

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
      const page = await fetchPage(targetUrl, 10000);
      const latency = Date.now() - startTime;

      if (!page) {
        return ToolResult.failed({
          type: ToolResultType.SCRAPE,
          error: 'Failed to fetch page content',
          errorCode: 'FETCH_FAILED',
        });
      }

      // v45.0: Return structured data only
      return ToolResult.scrape({
        url: targetUrl,
        title: page.title,
        content: page.content,
        links: page.links || [],
        latency,
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

    const fs = await import('fs/promises');
    await fs.writeFile(validatedPath, content, 'utf-8');

    return {
      path: validatedPath,
      bytesWritten: content.length,
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
