// CRE v44.0 — Tool Executor
// ══════════════════════════════════════════════════════════════════════════════
//
// ACTUAL TOOL EXECUTION for CRE Decisions
//
// This module EXECUTES tools, not describes them.
// When CRE decides TOOL_CALL, this executor RUNS the tools.
//
// CRITICAL INVARIANT:
// - TOOL_CALL decision → tool execution → result
// - NO text response before execution
// - UI receives tool RESULTS, not "Spouštím vyhledávání..."
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { ToolType, DecisionType, IntentType } from './cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// Execution Result Types
// ─────────────────────────────────────────────────────────────────────────────

export const ExecutionStatus = {
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',      // Some tools succeeded, some failed
  FAILED: 'FAILED',
  PENDING: 'PENDING',      // Async execution in progress
};

/**
 * Result of tool execution
 */
export class ExecutionResult {
  constructor({
    status,
    toolResults = [],
    summary = '',
    error = null,
    duration = 0,
    metadata = {},
  }) {
    this.status = status;
    this.toolResults = toolResults;  // Array of { tool, success, data, error }
    this.summary = summary;          // Human-readable summary of results
    this.error = error;              // Top-level error if FAILED
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

    // Register built-in tool handlers
    this.registerBuiltinHandlers();
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
   * @param {CREDecision} decision - The decision to execute
   * @param {Object} context - Execution context
   * @returns {Promise<ExecutionResult>}
   */
  async execute(decision, context = {}) {
    const startTime = Date.now();

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

    logger.info('ToolExecutor', `Executing ${decision.tools.length} tools`, {
      tools: decision.tools,
      intent: decision.intent,
    });

    // Execute tools
    const toolResults = [];
    let hasFailure = false;
    let hasSuccess = false;

    for (const toolType of decision.tools) {
      const handler = this.toolHandlers.get(toolType);

      if (!handler) {
        logger.warn('ToolExecutor', `No handler for tool: ${toolType}`);
        toolResults.push({
          tool: toolType,
          success: false,
          error: `No handler registered for ${toolType}`,
        });
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

        toolResults.push({
          tool: toolType,
          success: true,
          data: result,
        });
        hasSuccess = true;

        logger.debug('ToolExecutor', `Tool ${toolType} succeeded`, {
          resultType: typeof result,
          hasData: !!result,
        });

      } catch (err) {
        logger.error('ToolExecutor', `Tool ${toolType} failed: ${err.message}`);
        toolResults.push({
          tool: toolType,
          success: false,
          error: err.message,
        });
        hasFailure = true;
      }
    }

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

    // Build summary from results
    const summary = this.buildSummary(toolResults, decision.intent);

    return new ExecutionResult({
      status,
      toolResults,
      summary,
      duration,
      metadata: {
        intent: decision.intent,
        toolCount: decision.tools.length,
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
   * Build human-readable summary from tool results
   */
  buildSummary(toolResults, intent) {
    const successful = toolResults.filter(r => r.success);
    const failed = toolResults.filter(r => !r.success);

    if (successful.length === 0) {
      return `Všechny nástroje selhaly: ${failed.map(r => r.error).join(', ')}`;
    }

    // Format results based on intent
    const parts = [];

    for (const result of successful) {
      if (result.tool === ToolType.WEB_SEARCH && result.data) {
        parts.push(this.formatSearchResults(result.data));
      } else if (result.tool === ToolType.WEB_SCRAPE && result.data) {
        parts.push(this.formatScrapeResults(result.data));
      } else if (result.data) {
        parts.push(JSON.stringify(result.data, null, 2));
      }
    }

    if (failed.length > 0) {
      parts.push(`\n⚠️ Některé nástroje selhaly: ${failed.map(r => r.tool).join(', ')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Format web search results
   */
  formatSearchResults(data) {
    if (!data || !data.results) {
      return 'Žádné výsledky vyhledávání.';
    }

    const results = data.results.slice(0, 5);
    const formatted = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet || ''}`
    ).join('\n\n');

    return `📊 **Výsledky vyhledávání:**\n\n${formatted}`;
  }

  /**
   * Format web scrape results
   */
  formatScrapeResults(data) {
    if (!data || !data.content) {
      return 'Nepodařilo se načíst obsah stránky.';
    }

    const content = data.content.substring(0, 2000);
    return `📄 **Obsah stránky:**\n\n${content}${data.content.length > 2000 ? '...' : ''}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Implementation Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Execute web search
   * TODO: Integrate with actual search provider (SearXNG, etc.)
   */
  async executeWebSearch(params) {
    const { query } = params;

    logger.info('ToolExecutor', `Executing web search: "${query}"`);

    // TODO: Replace with actual SearXNG/search integration
    // For now, throw to indicate not implemented
    // This should be wired to your actual search tool

    // Check if we have a search service registered
    if (this.searchService) {
      return await this.searchService.search(query);
    }

    // Fallback: indicate tool needs implementation
    throw new Error(
      'WEB_SEARCH_NOT_CONFIGURED: Search service not connected. ' +
      'Wire ToolExecutor.searchService to your SearXNG or search provider.'
    );
  }

  /**
   * Execute web scrape
   * TODO: Integrate with actual scraping service
   */
  async executeWebScrape(params) {
    const { url, query } = params;

    logger.info('ToolExecutor', `Executing web scrape: ${url || query}`);

    if (this.scrapeService) {
      return await this.scrapeService.scrape(url || query);
    }

    throw new Error(
      'WEB_SCRAPE_NOT_CONFIGURED: Scrape service not connected. ' +
      'Wire ToolExecutor.scrapeService to your scraping provider.'
    );
  }

  /**
   * Execute file read
   */
  async executeFileRead(params) {
    const { path, filePath } = params;
    const targetPath = path || filePath;

    logger.info('ToolExecutor', `Executing file read: ${targetPath}`);

    if (!targetPath) {
      throw new Error('FILE_READ: No file path specified');
    }

    // Use Node.js fs
    const fs = await import('fs/promises');
    const content = await fs.readFile(targetPath, 'utf-8');

    return {
      path: targetPath,
      content,
      size: content.length,
    };
  }

  /**
   * Execute file write
   */
  async executeFileWrite(params) {
    const { path, filePath, content } = params;
    const targetPath = path || filePath;

    logger.info('ToolExecutor', `Executing file write: ${targetPath}`);

    if (!targetPath) {
      throw new Error('FILE_WRITE: No file path specified');
    }

    if (content === undefined) {
      throw new Error('FILE_WRITE: No content specified');
    }

    const fs = await import('fs/promises');
    await fs.writeFile(targetPath, content, 'utf-8');

    return {
      path: targetPath,
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
};
