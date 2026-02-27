// Shell Step — executes whitelisted commands with workspace sandboxing (v85)
// ══════════════════════════════════════════════════════════════════════════════
//
// Security: WHITELIST approach (NOT blacklist)
//   - Only commands in ALLOWED_COMMANDS can be executed
//   - Extracts first token from command, verifies against whitelist
//   - Max 30s timeout, sandboxed to workspace cwd
//   - On blocked command: { errorType: 'security', retryable: false }
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { substitute } from './substitute.js';

const ALLOWED_COMMANDS = new Set([
  'dot',        // Graphviz
  'plantuml',   // PlantUML
  'mermaid',    // Mermaid CLI
  'npx',        // Node package runner
  'node',       // Node.js
  'cat',        // File output
  'ls',         // Directory listing
  'wc',         // Word count
  'head',       // File head
  'tail',       // File tail
  'echo',       // Echo
]);

const SHELL_TIMEOUT = 30000; // 30 seconds

/**
 * Execute a shell step.
 *
 * @param {Object} stepDef - Step definition { id, type: 'shell', command }
 * @param {Object} context - { params, stepsOutput, workspace }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeShell(stepDef, context) {
  try {
    if (!stepDef.command) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Shell step "${stepDef.id}": missing "command" field`,
      };
    }

    const command = substitute(stepDef.command, context.params, context.stepsOutput);

    // Security: extract first token and validate against whitelist
    const firstToken = command.trim().split(/\s+/)[0];
    if (!firstToken || !ALLOWED_COMMANDS.has(firstToken)) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'security',
        errorMessage: `Shell step "${stepDef.id}": command "${firstToken}" not in whitelist. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
      };
    }

    const workspace = context.workspace || process.cwd();

    const stdout = execSync(command, {
      cwd: workspace,
      timeout: SHELL_TIMEOUT,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1 MB
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      status: 'success',
      output: stdout || '',
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    // Timeout or execution failure
    const isTimeout = err.killed || (err.signal === 'SIGTERM');
    return {
      status: 'error',
      output: err.stderr || null,
      retryable: isTimeout, // timeout might be transient
      errorType: isTimeout ? 'transient' : 'validation',
      errorMessage: `Shell step "${stepDef.id}": ${isTimeout ? 'timeout (30s)' : err.message}`,
    };
  }
}
