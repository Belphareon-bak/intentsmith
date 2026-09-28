// Dummy Logger — Format Entry Tool
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure deterministic tool: takes event data → returns formatted log entry.
// No side effects, no DB, no external calls.
//
// ══════════════════════════════════════════════════════════════════════════════

const LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * Format a structured log entry.
 *
 * @param {Object} params
 * @param {string} params.message    - Log message
 * @param {string} [params.level]    - Log level (debug|info|warn|error)
 * @param {string} [params.source]   - Source component
 * @param {string} [params.timestamp] - ISO timestamp (default: now)
 * @returns {{ success: boolean, result: Object }}
 */
export function formatLogEntry(params) {
  const message = params?.message;
  if (!message || typeof message !== 'string') {
    return { success: false, error: 'message is required (string)' };
  }

  const level = LEVELS.includes(params.level) ? params.level : 'info';
  const source = params.source || 'system';
  const timestamp = params.timestamp || new Date().toISOString();

  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const formatted = `${prefix} [${source}] ${message}`;

  return {
    success: true,
    result: {
      formatted,
      level,
      source,
      message,
      timestamp,
      prefix,
    },
  };
}
