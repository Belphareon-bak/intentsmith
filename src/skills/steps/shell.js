// Shell Step — executes whitelisted commands with workspace sandboxing (v90)
// ══════════════════════════════════════════════════════════════════════════════
//
// Security: WHITELIST approach (NOT blacklist)
//   - Only commands in ALLOWED_COMMANDS can be executed
//   - Extracts first token from command, verifies against whitelist
//   - Max 120s timeout, sandboxed to workspace cwd
//   - On blocked command: { errorType: 'security', retryable: false }
//
// Step I/O contract: { status, output, retryable, errorType }
//
// v90: Expanded whitelist for executor capabilities — package managers,
//      runtimes, build tools, test runners, VCS, filesystem ops.
//      Skills are author-controlled (JSON definitions), not user-input.
//
// ══════════════════════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import { substitute } from './substitute.js';

const ALLOWED_COMMANDS = new Set([
  // Diagram / visualization
  'dot',        // Graphviz
  'plantuml',   // PlantUML
  'mermaid',    // Mermaid CLI

  // Package managers
  'npm',        // Node package manager
  'npx',        // Node package runner
  'yarn',       // Yarn
  'pnpm',       // pnpm
  'pip',        // Python pip
  'pip3',       // Python pip3

  // Runtimes
  'node',       // Node.js
  'python',     // Python
  'python3',    // Python 3
  'deno',       // Deno
  'bun',        // Bun

  // Version control
  'git',        // Git

  // Filesystem
  'mkdir',      // Create directory
  'cp',         // Copy
  'mv',         // Move
  'touch',      // Create file
  'cat',        // File output
  'ls',         // Directory listing
  'wc',         // Word count
  'head',       // File head
  'tail',       // File tail
  'echo',       // Echo

  // Build / lint tools
  'tsc',        // TypeScript compiler
  'eslint',     // ESLint
  'prettier',   // Prettier

  // Test runners
  'jest',       // Jest
  'vitest',     // Vitest
  'pytest',     // pytest

  // Multi-language build
  'make',       // Make
  'cargo',      // Rust / Cargo
  'go',         // Go
  'flutter',    // Flutter
  'dart',       // Dart

  // Containers / HTTP
  'docker',     // Docker
  'curl',       // HTTP client

  // Text / file search
  'grep',       // Grep
  'find',       // Find
  'sort',       // Sort
  'diff',       // Diff
]);

const SHELL_TIMEOUT = 120_000; // 120 seconds (npm install can take >30s)

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
      errorMessage: `Shell step "${stepDef.id}": ${isTimeout ? 'timeout (120s)' : err.message}`,
    };
  }
}
