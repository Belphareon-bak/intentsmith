// C.3 v55.1 Error Handler
// ══════════════════════════════════════════════════════════════════════════════
//
// Centralizovaný error handling pro celou aplikaci.
// Všechny chyby musí projít tímto modulem pro konzistentní logování.
//
// Použití:
//   import { handleError, asyncHandler, AppError } from './error-handler.js';
//
//   // Wrap async funkce
//   const safeFunction = asyncHandler(riskyFunction, 'ModuleName', 'operation');
//
//   // Vlastní chyby
//   throw new AppError('Something failed', 'ERR_CODE', { context: 'data' });
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from './logger.js';

// ════════════════════════════════════════════════════════════════════════════
// ERROR CODES
// ════════════════════════════════════════════════════════════════════════════

export const ErrorCode = Object.freeze({
  // General
  UNKNOWN: 'ERR_UNKNOWN',
  VALIDATION: 'ERR_VALIDATION',
  NOT_FOUND: 'ERR_NOT_FOUND',
  TIMEOUT: 'ERR_TIMEOUT',
  
  // LLM
  LLM_CONNECTION: 'ERR_LLM_CONNECTION',
  LLM_PARSE: 'ERR_LLM_PARSE',
  LLM_RATE_LIMIT: 'ERR_LLM_RATE_LIMIT',
  LLM_INVALID_RESPONSE: 'ERR_LLM_INVALID_RESPONSE',
  
  // Session
  SESSION_EXPIRED: 'ERR_SESSION_EXPIRED',
  SESSION_INVALID: 'ERR_SESSION_INVALID',
  SESSION_LIMIT: 'ERR_SESSION_LIMIT',
  
  // Tools
  TOOL_NOT_FOUND: 'ERR_TOOL_NOT_FOUND',
  TOOL_EXECUTION: 'ERR_TOOL_EXECUTION',
  TOOL_TIMEOUT: 'ERR_TOOL_TIMEOUT',
  
  // Safety
  SAFETY_BLOCKED: 'ERR_SAFETY_BLOCKED',
  
  // IO
  FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND',
  FILE_READ: 'ERR_FILE_READ',
  FILE_WRITE: 'ERR_FILE_WRITE',
  
  // Database
  DB_CONNECTION: 'ERR_DB_CONNECTION',
  DB_QUERY: 'ERR_DB_QUERY',
});

// ════════════════════════════════════════════════════════════════════════════
// APP ERROR CLASS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Custom application error with code and context
 */
export class AppError extends Error {
  /**
   * @param {string} message - Human readable error message
   * @param {string} code - Error code from ErrorCode enum
   * @param {Object} context - Additional context for debugging
   */
  constructor(message, code = ErrorCode.UNKNOWN, context = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ERROR HANDLER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Handle and log an error
 * 
 * @param {Error} error - The error to handle
 * @param {string} module - Module name for logging
 * @param {string} operation - Operation that failed
 * @param {Object} additionalContext - Extra context to log
 * @returns {Object} Structured error info
 */
export function handleError(error, module, operation, additionalContext = {}) {
  const errorInfo = {
    module,
    operation,
    message: error.message,
    code: error.code || ErrorCode.UNKNOWN,
    name: error.name || 'Error',
    context: {
      ...additionalContext,
      ...(error.context || {}),
    },
    timestamp: new Date().toISOString(),
  };

  // Log based on error severity
  if (error.code === ErrorCode.SAFETY_BLOCKED) {
    logger.warn(module, `${operation}: ${error.message}`, errorInfo);
  } else {
    logger.error(module, `${operation} failed: ${error.message}`, errorInfo);
  }

  // Include stack in development
  if (process.env.NODE_ENV !== 'production') {
    errorInfo.stack = error.stack;
  }

  return errorInfo;
}

// ════════════════════════════════════════════════════════════════════════════
// ASYNC HANDLER WRAPPER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrap an async function with automatic error handling
 * 
 * @param {Function} fn - Async function to wrap
 * @param {string} module - Module name for logging
 * @param {string} operation - Operation name for logging
 * @param {Object} options - Options
 * @param {boolean} options.rethrow - Whether to rethrow after handling (default: true)
 * @param {*} options.fallback - Fallback value if rethrow is false
 * @returns {Function} Wrapped function
 * 
 * @example
 * const safeFetch = asyncHandler(fetchData, 'DataModule', 'fetchData');
 * const result = await safeFetch(url);
 */
export function asyncHandler(fn, module, operation, options = {}) {
  const { rethrow = true, fallback = null } = options;
  
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      handleError(error, module, operation);
      
      if (rethrow) {
        throw error;
      }
      return fallback;
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SAFE EXECUTE (for expected failures)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Execute a function that might fail, with graceful handling
 * Use for operations where failure is expected/acceptable
 * 
 * @param {Function} fn - Function to execute
 * @param {*} fallback - Value to return on failure
 * @param {string} module - Module name for debug logging
 * @param {string} operation - Operation name
 * @returns {*} Result or fallback
 * 
 * @example
 * const config = safeExecute(() => JSON.parse(data), {}, 'Config', 'parse');
 */
export function safeExecute(fn, fallback, module, operation) {
  try {
    return fn();
  } catch (error) {
    logger.debug(module, `${operation} failed (using fallback): ${error.message}`);
    return fallback;
  }
}

/**
 * Async version of safeExecute
 */
export async function safeExecuteAsync(fn, fallback, module, operation) {
  try {
    return await fn();
  } catch (error) {
    logger.debug(module, `${operation} failed (using fallback): ${error.message}`);
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ERROR TYPE CHECKS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check if error is a timeout
 */
export function isTimeoutError(error) {
  return error.code === 'ETIMEDOUT' || 
         error.code === 'ESOCKETTIMEDOUT' ||
         error.code === ErrorCode.TIMEOUT ||
         error.message?.includes('timeout');
}

/**
 * Check if error is a connection error
 */
export function isConnectionError(error) {
  return error.code === 'ECONNREFUSED' ||
         error.code === 'ECONNRESET' ||
         error.code === 'ENOTFOUND' ||
         error.code === ErrorCode.LLM_CONNECTION;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error) {
  return isTimeoutError(error) || 
         isConnectionError(error) ||
         error.code === ErrorCode.LLM_RATE_LIMIT;
}

// ════════════════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS (call once at startup)
// ════════════════════════════════════════════════════════════════════════════

let globalHandlersInstalled = false;

/**
 * Install global error handlers for uncaught exceptions and rejections
 * Call this once at application startup
 * 
 * @param {Object} options
 * @param {Function} options.onFatalError - Callback for fatal errors
 */
export function installGlobalHandlers(options = {}) {
  if (globalHandlersInstalled) {
    logger.warn('ErrorHandler', 'Global handlers already installed');
    return;
  }

  const { onFatalError } = options;

  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    handleError(error, 'Process', 'unhandledRejection', {
      promiseInfo: promise.toString?.() || 'Promise',
    });
  });

  process.on('uncaughtException', (error, origin) => {
    handleError(error, 'Process', 'uncaughtException', { origin });
    
    // Fatal - must exit
    logger.error('Process', 'Fatal error - shutting down', {
      message: error.message,
      origin,
    });

    if (onFatalError) {
      try {
        onFatalError(error);
      } catch (e) {
        // Ignore errors in cleanup
      }
    }

    // Give time for logs to flush
    setTimeout(() => process.exit(1), 100);
  });

  globalHandlersInstalled = true;
  logger.info('ErrorHandler', 'Global error handlers installed');
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  AppError,
  ErrorCode,
  handleError,
  asyncHandler,
  safeExecute,
  safeExecuteAsync,
  isTimeoutError,
  isConnectionError,
  isRetryableError,
  installGlobalHandlers,
};
