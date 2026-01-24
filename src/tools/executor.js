// CRE v36.9.2 Tool Executor
// ══════════════════════════════════════════════════════════════════════════════
//
// Executes tools from CREDecision(TOOL_CALL).
//
// Flow: CREDecision(TOOL_CALL) → ToolExecutor.execute() → data
//
// Features:
// - Param validation (required params check)
// - Permission check (stub - always allows for now)
// - Execution timeout
// - Normalized error codes: MISSING_PARAM, UNKNOWN_TOOL, PERMISSION_DENIED, BACKEND_UNAVAILABLE
//
// ══════════════════════════════════════════════════════════════════════════════

import { toolRegistry } from './registry.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// ERROR CODES
// ════════════════════════════════════════════════════════════════════════════

export const ToolError = {
  MISSING_PARAM: 'MISSING_PARAM',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
};

// ════════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR
// ════════════════════════════════════════════════════════════════════════════

class ToolExecutor {
  constructor(options = {}) {
    this.defaultTimeout = options.timeout || 30000;
    this.permissions = new Set(options.grantedPermissions || [
      // Default permissions (stub - grant all for now)
      'web.read', 'fs.read', 'fs.write',
    ]);
    this.executionLog = [];
    this.maxLogSize = 100;
  }

  /**
   * Execute a tool call from CREDecision
   *
   * @param {Object} decision - CREDecision with type: 'TOOL_CALL'
   * @param {string} decision.tool - Tool name
   * @param {Object} decision.params - Tool parameters
   * @param {Object} [context] - Execution context (API keys, etc.)
   * @returns {Promise<{ ok: boolean, data?: any, error?: string, code?: string, duration: number }>}
   */
  async execute(decision, context = {}) {
    const startTime = Date.now();
    const { tool: toolName, params = {} } = decision;

    logger.debug('ToolExecutor', `Executing: ${toolName}`, { params: Object.keys(params) });

    // ──────────────────────────────────────────────────────────────────────
    // 1. TOOL EXISTS?
    // ──────────────────────────────────────────────────────────────────────

    if (!toolRegistry.has(toolName)) {
      const result = this.errorResult(ToolError.UNKNOWN_TOOL, `Unknown tool: ${toolName}`, startTime);
      this.logExecution(toolName, params, result);
      return result;
    }

    const tool = toolRegistry.get(toolName);

    // ──────────────────────────────────────────────────────────────────────
    // 2. PARAM VALIDATION
    // ──────────────────────────────────────────────────────────────────────

    const missingParams = (tool.params.required || []).filter(p => !(p in params));
    if (missingParams.length > 0) {
      const result = this.errorResult(
        ToolError.MISSING_PARAM,
        `Missing required params: ${missingParams.join(', ')}`,
        startTime
      );
      this.logExecution(toolName, params, result);
      return result;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. PERMISSION CHECK (stub)
    // ──────────────────────────────────────────────────────────────────────

    const deniedPerms = (tool.permissions || []).filter(p => !this.permissions.has(p));
    if (deniedPerms.length > 0) {
      const result = this.errorResult(
        ToolError.PERMISSION_DENIED,
        `Missing permissions: ${deniedPerms.join(', ')}`,
        startTime
      );
      this.logExecution(toolName, params, result);
      return result;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 4. EXECUTE WITH TIMEOUT
    // ──────────────────────────────────────────────────────────────────────

    const timeout = context.timeout || this.defaultTimeout;

    try {
      const data = await this.withTimeout(
        tool.execute(params, context),
        timeout
      );

      const duration = Date.now() - startTime;

      // Check if tool returned an error object
      if (data && data.error && data.code) {
        const result = {
          ok: false,
          error: data.error,
          code: data.code,
          data,
          duration,
        };
        this.logExecution(toolName, params, result);
        return result;
      }

      const result = { ok: true, data, duration };
      this.logExecution(toolName, params, result);

      logger.debug('ToolExecutor', `Completed: ${toolName} in ${duration}ms`);
      return result;

    } catch (err) {
      if (err.message === 'TOOL_TIMEOUT') {
        const result = this.errorResult(ToolError.TIMEOUT, `Tool timed out after ${timeout}ms`, startTime);
        this.logExecution(toolName, params, result);
        return result;
      }

      // Network/backend errors
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        const result = this.errorResult(ToolError.BACKEND_UNAVAILABLE, err.message, startTime);
        this.logExecution(toolName, params, result);
        return result;
      }

      const result = this.errorResult(ToolError.EXECUTION_ERROR, err.message, startTime);
      this.logExecution(toolName, params, result);
      return result;
    }
  }

  /**
   * Execute a CREDecision directly (convenience)
   * Validates decision.type === 'TOOL_CALL'
   */
  async executeDecision(decision, context = {}) {
    if (!decision || decision.type !== 'TOOL_CALL') {
      return {
        ok: false,
        error: `Expected TOOL_CALL decision, got: ${decision?.type}`,
        code: 'INVALID_DECISION',
        duration: 0,
      };
    }
    return this.execute(decision, context);
  }

  /**
   * Wrap promise with timeout
   */
  withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TOOL_TIMEOUT')), ms);
      promise
        .then(result => { clearTimeout(timer); resolve(result); })
        .catch(err => { clearTimeout(timer); reject(err); });
    });
  }

  /**
   * Create normalized error result
   */
  errorResult(code, message, startTime) {
    return {
      ok: false,
      error: message,
      code,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Log execution for debugging
   */
  logExecution(tool, params, result) {
    this.executionLog.push({
      timestamp: Date.now(),
      tool,
      params: Object.keys(params),
      ok: result.ok,
      code: result.code,
      duration: result.duration,
    });

    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog = this.executionLog.slice(-this.maxLogSize);
    }
  }

  /**
   * Grant permission
   */
  grantPermission(permission) {
    this.permissions.add(permission);
  }

  /**
   * Revoke permission
   */
  revokePermission(permission) {
    this.permissions.delete(permission);
  }

  /**
   * Get execution stats
   */
  getStats() {
    const recent = this.executionLog.filter(l => l.timestamp > Date.now() - 300000);
    return {
      totalExecutions: this.executionLog.length,
      recentExecutions: recent.length,
      successRate: recent.length > 0
        ? recent.filter(l => l.ok).length / recent.length
        : 0,
      byTool: this.groupBy(recent, 'tool'),
    };
  }

  groupBy(arr, key) {
    const result = {};
    for (const item of arr) {
      result[item[key]] = (result[item[key]] || 0) + 1;
    }
    return result;
  }
}

// Singleton
export const toolExecutor = new ToolExecutor();

export default ToolExecutor;
