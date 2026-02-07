// C3-Agent Logger Type Definitions
// Generated for v55.1

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  pretty: boolean;
  maxEntries: number;
}

/**
 * Logger instance
 */
export interface Logger {
  /**
   * Log debug message
   */
  debug(module: string, message: string, data?: Record<string, unknown>): void;

  /**
   * Log info message
   */
  info(module: string, message: string, data?: Record<string, unknown>): void;

  /**
   * Log warning message
   */
  warn(module: string, message: string, data?: Record<string, unknown>): void;

  /**
   * Log error message
   */
  error(module: string, message: string, data?: Record<string, unknown>): void;

  /**
   * Get recent log entries
   */
  getRecent(count?: number): LogEntry[];

  /**
   * Get entries by module
   */
  getByModule(module: string, count?: number): LogEntry[];

  /**
   * Get entries by level
   */
  getByLevel(level: LogLevel, count?: number): LogEntry[];

  /**
   * Clear all log entries
   */
  clear(): void;

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void;

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig;
}

/**
 * Global logger instance
 */
export declare const logger: Logger;

/**
 * Create a scoped logger for a specific module
 */
export declare function createScopedLogger(moduleName: string): {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};
