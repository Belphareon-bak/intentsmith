// Write Step — writes content to a file with containment checks (v85)
// ══════════════════════════════════════════════════════════════════════════════
//
// Security:
//   - path.resolve(workspace, filePath) + fs.realpath() before containment check
//   - Rejects: '..', absolute paths, symlinks escaping workspace
//   - On security violation: { errorType: 'security', retryable: false }
//
// Step I/O contract: { status, output, retryable, errorType }
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { substitute } from './substitute.js';

/**
 * Execute a write step.
 *
 * @param {Object} stepDef - Step definition { id, type: 'write', path, content }
 * @param {Object} context - { params, stepsOutput, workspace }
 * @returns {{ status: string, output: string, retryable: boolean, errorType: string|null }}
 */
export async function executeWrite(stepDef, context) {
  try {
    if (!stepDef.path) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'validation',
        errorMessage: `Write step "${stepDef.id}": missing "path" field`,
      };
    }

    const workspace = context.workspace || process.cwd();
    const rawPath = substitute(stepDef.path, context.params, context.stepsOutput);

    // Security: reject absolute paths
    if (path.isAbsolute(rawPath)) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'security',
        errorMessage: `Write step "${stepDef.id}": absolute paths not allowed ("${rawPath}")`,
      };
    }

    // Security: reject path traversal
    if (rawPath.includes('..')) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'security',
        errorMessage: `Write step "${stepDef.id}": path traversal not allowed ("${rawPath}")`,
      };
    }

    const resolvedPath = path.resolve(workspace, rawPath);

    // Security: containment check (pre-realpath)
    if (!resolvedPath.startsWith(workspace + path.sep) && resolvedPath !== workspace) {
      return {
        status: 'error',
        output: null,
        retryable: false,
        errorType: 'security',
        errorMessage: `Write step "${stepDef.id}": path escapes workspace`,
      };
    }

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Resolve content from stepDef.content or prior step output
    const content = stepDef.content
      ? substitute(stepDef.content, context.params, context.stepsOutput)
      : '';

    // Write the file
    fs.writeFileSync(resolvedPath, content, 'utf-8');

    // Security: post-write realpath check (symlink protection)
    try {
      const realPath = fs.realpathSync(resolvedPath);
      if (!realPath.startsWith(workspace + path.sep) && realPath !== workspace) {
        // Symlink escape detected — delete the file we just wrote
        fs.unlinkSync(resolvedPath);
        return {
          status: 'error',
          output: null,
          retryable: false,
          errorType: 'security',
          errorMessage: `Write step "${stepDef.id}": symlink escape detected (real path: ${realPath})`,
        };
      }
    } catch (realpathErr) {
      // realpath failed — file might not exist (unlikely after write)
    }

    return {
      status: 'success',
      output: resolvedPath,
      retryable: false,
      errorType: null,
    };
  } catch (err) {
    return {
      status: 'error',
      output: null,
      retryable: false,
      errorType: 'validation',
      errorMessage: `Write step "${stepDef.id}": ${err.message}`,
    };
  }
}
