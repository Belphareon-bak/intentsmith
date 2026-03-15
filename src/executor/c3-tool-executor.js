// C.3 Tool Executor — Contract v1.0 Implementation
// ══════════════════════════════════════════════════════════════════════════════
//
// SINGLE-SHOT EXECUTOR for tool execution.
//
// Invariants (from EXECUTOR_CONTRACT.md):
//   ❗ Single-shot: One call = one execution = one result
//   ❗ Timeout-enforced: Every execution has a timeout
//   ❗ Stateless: Executor holds no state between calls
//   ❗ Audited: Every execution is logged
//   ❗ Sanitized: Environment is always sanitized
//   ❗ No retry: Executor never retries internally
//
// See: docs/tools/EXECUTOR_CONTRACT.md for full specification.
//
// ══════════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { logger } from '../core/logger.js';
import { parseCommand } from './shell-parser.js';
import { validateCommand, injectSafetyFlags } from './shell-security.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TIMEOUT_MS = 600000; // 10 minutes
const GRACEFUL_PERIOD_MS = 1000; // 1 second for cleanup on timeout

/**
 * Environment variables that are BLOCKED from tool execution.
 * These can be used for library injection, runtime modification, or shell hijacking.
 */
const BLOCKED_ENV_VARS = [
  // Library injection
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',

  // Runtime modification
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'PERL5OPT',

  // Shell initialization
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',
];

/**
 * Regex patterns for additional blocked env vars.
 */
const BLOCKED_ENV_PATTERNS = [
  /^LD_/,     // All LD_* variables
  /^DYLD_/,   // All DYLD_* variables
];

/**
 * Transient error codes that indicate retryable infrastructure errors.
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',    // Connection reset
  'ETIMEDOUT',     // Network timeout (not execution timeout)
  'ECONNREFUSED',  // Service temporarily unavailable
  'ENOTFOUND',     // DNS lookup failed (transient)
  'EAI_AGAIN',     // DNS temporary failure
]);

// ─────────────────────────────────────────────────────────────────────────────
// Types (JSDoc)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ToolExecutionRequest
 * @property {string} correlationId - Unique ID for tracing
 * @property {string} tool - Tool name from registry
 * @property {Record<string, unknown>} args - Tool arguments
 * @property {number} timeoutMs - Caller-controlled timeout (max 600000)
 * @property {Object} [sandbox] - Sandbox configuration
 * @property {'docker'|'none'} [sandbox.type] - Sandbox type
 * @property {string} [sandbox.image] - Docker image
 * @property {string} [sandbox.workdir] - Working directory
 * @property {AbortSignal} [signal] - External abort signal
 */

/**
 * @typedef {Object} ToolExecutionResult
 * @property {'ok'|'error'|'timeout'|'cancelled'} status
 * @property {boolean} retryable
 * @property {unknown} [output] - Tool output on success
 * @property {string} [error] - Error message on failure
 * @property {number} executionTimeMs - Actual execution time
 * @property {string} correlationId - Echo of input correlationId
 */

/**
 * @typedef {Object} AuditEntry
 * @property {string} timestamp - ISO 8601
 * @property {string} correlationId
 * @property {'BEFORE'|'AFTER'} phase
 * @property {string} tool
 * @property {Record<string, unknown>} [args] - BEFORE only
 * @property {ToolExecutionResult} [result] - AFTER only
 * @property {number} [durationMs] - AFTER only
 */

// ─────────────────────────────────────────────────────────────────────────────
// Audit Trail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory audit trail (append-only).
 * In production, this would be persisted to a database or log file.
 */
const auditTrail = [];

/**
 * Log an audit entry.
 * @param {AuditEntry} entry
 */
function logAudit(entry) {
  auditTrail.push(Object.freeze({ ...entry }));
  logger.debug('C3ToolExecutor', `Audit ${entry.phase}`, {
    correlationId: entry.correlationId,
    tool: entry.tool,
  });
}

/**
 * Get audit trail (read-only).
 * @returns {ReadonlyArray<AuditEntry>}
 */
export function getAuditTrail() {
  return Object.freeze([...auditTrail]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment Sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an environment variable is blocked.
 * @param {string} name
 * @returns {boolean}
 */
function isBlockedEnvVar(name) {
  if (BLOCKED_ENV_VARS.includes(name)) {
    return true;
  }
  for (const pattern of BLOCKED_ENV_PATTERNS) {
    if (pattern.test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Create a sanitized copy of environment variables.
 * Removes all blocked variables.
 * @param {Record<string, string>} env - Source environment
 * @returns {Record<string, string>} - Sanitized environment
 */
function sanitizeEnvironment(env) {
  const sanitized = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isBlockedEnvVar(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a tool execution request (defense in depth).
 * @param {ToolExecutionRequest} request
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRequest(request) {
  if (!request) {
    return { valid: false, error: 'Request is required' };
  }

  if (!request.correlationId || typeof request.correlationId !== 'string') {
    return { valid: false, error: 'correlationId is required and must be a non-empty string' };
  }

  if (!request.tool || typeof request.tool !== 'string') {
    return { valid: false, error: 'tool is required and must be a non-empty string' };
  }

  if (request.args === null || request.args === undefined || typeof request.args !== 'object') {
    return { valid: false, error: 'args is required and must be an object' };
  }

  if (typeof request.timeoutMs !== 'number' || request.timeoutMs <= 0) {
    return { valid: false, error: 'timeoutMs is required and must be a positive number' };
  }

  if (request.timeoutMs > MAX_TIMEOUT_MS) {
    return { valid: false, error: `timeoutMs must not exceed ${MAX_TIMEOUT_MS}ms (10 minutes)` };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine if an error is retryable (transient infrastructure error).
 * @param {Error} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  if (!error) return false;

  // Check error code
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }

  // Check for network-related messages
  const message = (error.message || '').toLowerCase();
  if (
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('connection reset')
  ) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Registry Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool registry for looking up tool implementations.
 * This is a simple registry; in production, this would be injected or configured.
 */
const toolRegistry = new Map();

/**
 * Register a tool implementation.
 * @param {string} name - Tool name
 * @param {Function} handler - Tool handler function (args, options) => Promise<unknown>
 */
export function registerTool(name, handler) {
  if (typeof handler !== 'function') {
    throw new Error(`Tool handler for "${name}" must be a function`);
  }
  toolRegistry.set(name, handler);
}

/**
 * Get a registered tool.
 * @param {string} name
 * @returns {Function|undefined}
 */
function getTool(name) {
  return toolRegistry.get(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a shell command with timeout, sanitized environment, and security validation.
 * Command is parsed into argv and validated against the whitelist BEFORE execution.
 * Uses spawn with shell:false — no shell interpretation.
 *
 * @param {string} command
 * @param {Object} options
 * @param {number} options.timeoutMs
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.cwd]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function executeShell(command, options) {
  // SECURITY: Parse command string into argv tokens (rejects pipes, chains, subshells)
  const argv = parseCommand(command);

  // SECURITY: Validate binary whitelist, arg blacklist, path sandbox
  const cwd = options.cwd || process.cwd();
  validateCommand(argv, cwd);

  // SECURITY: Inject safety flags (e.g. npm install --ignore-scripts)
  const safeArgv = injectSafetyFlags(argv);
  const [binary, ...args] = safeArgv;

  return new Promise((resolve, reject) => {
    const sanitizedEnv = sanitizeEnvironment(process.env);

    const child = spawn(binary, args, {
      env: sanitizedEnv,
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Handle external abort signal
    if (options.signal) {
      if (options.signal.aborted) {
        child.kill('SIGTERM');
        reject(new Error('Execution cancelled'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('Execution cancelled'));
      });
    }

    // Timeout handling
    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');

      // Graceful period, then force kill
      setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch (_) { child.kill(); }
        }
      }, GRACEFUL_PERIOD_MS);

      reject(new Error('Execution timeout'));
    }, options.timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (!killed) {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker Sandbox Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a command in a Docker container.
 * @param {string} command
 * @param {Object} options
 * @param {number} options.timeoutMs
 * @param {string} options.image
 * @param {string} [options.workdir]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function executeDocker(command, options) {
  const dockerArgs = [
    'run',
    '--rm',
    '--network=none',        // No network access by default
    '--memory=512m',         // Memory limit
    '--cpus=1',              // CPU limit
    '--pids-limit=100',      // Process limit
    '--read-only',           // Read-only filesystem
    '--security-opt=no-new-privileges',
  ];

  if (options.workdir) {
    dockerArgs.push('-w', options.workdir);
  }

  dockerArgs.push(options.image, 'sh', '-c', command);

  return new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs, {
      env: sanitizeEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    if (options.signal) {
      if (options.signal.aborted) {
        child.kill('SIGTERM');
        reject(new Error('Execution cancelled'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('Execution cancelled'));
      });
    }

    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch (_) { child.kill(); }
        }
      }, GRACEFUL_PERIOD_MS);
      reject(new Error('Execution timeout'));
    }, options.timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (!killed) {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// C3ToolExecutor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C3ToolExecutor — Single-shot tool executor.
 *
 * Implements the executor contract defined in EXECUTOR_CONTRACT.md.
 * This executor is stateless, single-shot, and never retries.
 *
 * @example
 *   const executor = new C3ToolExecutor();
 *   const result = await executor.execute({
 *     correlationId: 'abc-123',
 *     tool: 'shell',
 *     args: { command: 'ls -la' },
 *     timeoutMs: 30000,
 *   });
 */
export class C3ToolExecutor {
  /**
   * Execute a tool request.
   *
   * Execution order (invariant):
   *   1. Validate request (defense in depth)
   *   2. Log BEFORE_EXECUTION to audit trail
   *   3. Start timeout timer
   *   4. Sanitize environment
   *   5. Execute tool (sandbox or direct)
   *   6. Stop timeout timer
   *   7. Log AFTER_EXECUTION to audit trail
   *   8. Return result
   *
   * @param {ToolExecutionRequest} request
   * @returns {Promise<ToolExecutionResult>}
   */
  async execute(request) {
    const startTime = Date.now();

    // ─────────────────────────────────────────────────────────────────────
    // Step 1: Validate request (defense in depth)
    // ─────────────────────────────────────────────────────────────────────
    const validation = validateRequest(request);
    if (!validation.valid) {
      return {
        status: 'error',
        retryable: false,
        error: validation.error,
        executionTimeMs: Date.now() - startTime,
        correlationId: request?.correlationId || 'unknown',
      };
    }

    const { correlationId, tool, args, timeoutMs, sandbox, signal } = request;

    // Check if already cancelled
    if (signal?.aborted) {
      return {
        status: 'cancelled',
        retryable: false,
        executionTimeMs: Date.now() - startTime,
        correlationId,
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Step 2: Log BEFORE_EXECUTION
    // ─────────────────────────────────────────────────────────────────────
    logAudit({
      timestamp: new Date().toISOString(),
      correlationId,
      phase: 'BEFORE',
      tool,
      args,
    });

    // ─────────────────────────────────────────────────────────────────────
    // Steps 3-6: Execute with timeout
    // ─────────────────────────────────────────────────────────────────────
    let result;

    try {
      // Check for registered tool handler
      const handler = getTool(tool);

      if (handler) {
        // Execute registered tool
        const output = await this.#executeWithTimeout(
          () => handler(args, { signal, timeoutMs }),
          timeoutMs,
          signal
        );
        result = {
          status: 'ok',
          retryable: false,
          output,
          executionTimeMs: Date.now() - startTime,
          correlationId,
        };
      } else if (tool === 'shell' && args.command) {
        // Built-in shell execution
        const execOptions = {
          timeoutMs,
          signal,
          cwd: args.cwd,
        };

        let execResult;
        if (sandbox?.type === 'docker' && sandbox.image) {
          execResult = await executeDocker(args.command, {
            ...execOptions,
            image: sandbox.image,
            workdir: sandbox.workdir,
          });
        } else {
          execResult = await executeShell(args.command, execOptions);
        }

        result = {
          status: execResult.exitCode === 0 ? 'ok' : 'error',
          retryable: false,
          output: {
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            exitCode: execResult.exitCode,
          },
          error: execResult.exitCode !== 0 ? `Exit code: ${execResult.exitCode}` : undefined,
          executionTimeMs: Date.now() - startTime,
          correlationId,
        };
      } else {
        // Tool not found
        result = {
          status: 'error',
          retryable: false,
          error: `Tool not found: ${tool}`,
          executionTimeMs: Date.now() - startTime,
          correlationId,
        };
      }
    } catch (error) {
      if (error.message === 'Execution cancelled') {
        result = {
          status: 'cancelled',
          retryable: false,
          executionTimeMs: Date.now() - startTime,
          correlationId,
        };
      } else if (error.message === 'Execution timeout') {
        result = {
          status: 'timeout',
          retryable: false,
          error: `Execution exceeded ${timeoutMs}ms timeout`,
          executionTimeMs: Date.now() - startTime,
          correlationId,
        };
      } else {
        result = {
          status: 'error',
          retryable: isRetryableError(error),
          error: error.message,
          executionTimeMs: Date.now() - startTime,
          correlationId,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Step 7: Log AFTER_EXECUTION
    // ─────────────────────────────────────────────────────────────────────
    logAudit({
      timestamp: new Date().toISOString(),
      correlationId,
      phase: 'AFTER',
      tool,
      result,
      durationMs: result.executionTimeMs,
    });

    // ─────────────────────────────────────────────────────────────────────
    // Step 8: Return result
    // ─────────────────────────────────────────────────────────────────────
    return result;
  }

  /**
   * Execute a function with timeout.
   * @private
   * @param {Function} fn
   * @param {number} timeoutMs
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown>}
   */
  async #executeWithTimeout(fn, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;

      // Timeout
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Execution timeout'));
        }
      }, timeoutMs);

      // Abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            reject(new Error('Execution cancelled'));
          }
        });
      }

      // Execute
      Promise.resolve(fn())
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            reject(error);
          }
        });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default C3ToolExecutor;
