// Shell Step — preserves legacy parsing while failing closed at the effect boundary
// ══════════════════════════════════════════════════════════════════════════════
//
// Security:
//   - No child process API is imported or invoked from the skill runtime
//   - Legacy commands are parsed for compatible diagnostics only
//   - Every otherwise-allowed command fails until an M2 process effect exists
//
// Step I/O contract: { status, output, retryable, errorType }
//
// The command vocabulary remains data-only compatibility surface. It is not
// execution authority.
//
// ══════════════════════════════════════════════════════════════════════════════

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

    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'security',
      errorMessage: `Shell step "${stepDef.id}": process execution has no installed M2 effect translation`,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'validation',
      errorMessage: `Shell step "${stepDef.id}": ${err.message}`,
    };
  }
}
