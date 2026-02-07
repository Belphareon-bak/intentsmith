// C3-Agent Error Handler Type Definitions
// Generated for v55.1

/**
 * Error codes used throughout the application
 */
export declare const ErrorCode: Readonly<{
  // General
  UNKNOWN: 'ERR_UNKNOWN';
  VALIDATION: 'ERR_VALIDATION';
  NOT_FOUND: 'ERR_NOT_FOUND';
  TIMEOUT: 'ERR_TIMEOUT';
  
  // LLM
  LLM_CONNECTION: 'ERR_LLM_CONNECTION';
  LLM_PARSE: 'ERR_LLM_PARSE';
  LLM_RATE_LIMIT: 'ERR_LLM_RATE_LIMIT';
  LLM_INVALID_RESPONSE: 'ERR_LLM_INVALID_RESPONSE';
  
  // Session
  SESSION_EXPIRED: 'ERR_SESSION_EXPIRED';
  SESSION_INVALID: 'ERR_SESSION_INVALID';
  SESSION_LIMIT: 'ERR_SESSION_LIMIT';
  
  // Tools
  TOOL_NOT_FOUND: 'ERR_TOOL_NOT_FOUND';
  TOOL_EXECUTION: 'ERR_TOOL_EXECUTION';
  TOOL_TIMEOUT: 'ERR_TOOL_TIMEOUT';
  
  // Safety
  SAFETY_BLOCKED: 'ERR_SAFETY_BLOCKED';
  
  // IO
  FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND';
  FILE_READ: 'ERR_FILE_READ';
  FILE_WRITE: 'ERR_FILE_WRITE';
  
  // Database
  DB_CONNECTION: 'ERR_DB_CONNECTION';
  DB_QUERY: 'ERR_DB_QUERY';
}>;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Custom application error with code and context
 */
export declare class AppError extends Error {
  readonly name: 'AppError';
  readonly code: ErrorCodeType;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;
  readonly isOperational: boolean;

  constructor(
    message: string,
    code?: ErrorCodeType,
    context?: Record<string, unknown>
  );

  toJSON(): {
    name: string;
    message: string;
    code: ErrorCodeType;
    context: Record<string, unknown>;
    timestamp: string;
    stack?: string;
  };
}

/**
 * Error handling result
 */
export interface ErrorResult {
  handled: boolean;
  response?: string;
  code?: ErrorCodeType;
  shouldExit?: boolean;
}

/**
 * Handle any error - logs and returns appropriate response
 */
export declare function handleError(
  error: Error | AppError | unknown,
  moduleName: string,
  operation: string
): ErrorResult;

/**
 * Wrap async function with error handling
 */
export declare function asyncHandler<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  moduleName: string,
  operation: string
): (...args: Parameters<T>) => Promise<ReturnType<T> | ErrorResult>;

/**
 * Create user-friendly error response
 */
export declare function createErrorResponse(
  code: ErrorCodeType,
  userMessage?: string
): string;

/**
 * Safe JSON parse with error handling
 */
export declare function tryParse<T = unknown>(
  jsonString: string,
  defaultValue?: T
): T;

/**
 * Check if error is operational (expected) vs programming error
 */
export declare function isOperationalError(error: unknown): boolean;

/**
 * Install global error handlers
 */
export declare function installGlobalHandlers(): void;
