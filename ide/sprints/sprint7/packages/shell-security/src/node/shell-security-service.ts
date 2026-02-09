/**
 * @c3/shell-security — Hardened Shell Service (node)
 *
 * Implements all 7 defense layers:
 *
 * Layer 1: Command whitelist
 *   Only commands in ALLOWED_COMMANDS can execute.
 *
 * Layer 2: Arg blacklist
 *   Global BLOCKED_ARGS + per-command COMMAND_BLOCKED_ARGS.
 *   npm install/ci always get --ignore-scripts injected.
 *
 * Layer 3: argv-based spawn
 *   ALWAYS shell: false. Semicolons, pipes, backticks are literal args.
 *
 * Layer 4: cwd sandbox
 *   Resolved cwd must be inside project root (prevents ../../../etc/).
 *   Symlinks resolved before comparison.
 *
 * Layer 5: env sanitization
 *   Strips API keys, tokens, passwords, secrets from child env.
 *   Both exact matches and prefix/suffix patterns.
 *
 * Layer 6: bubblewrap (optional)
 *   If bwrap available: filesystem isolation + optional network isolation.
 *
 * Layer 7: timeout
 *   SIGTERM after defaultTimeoutMs, SIGKILL after killGraceMs.
 *   Output truncated at maxOutputBytes.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, execFile } from 'child_process';
import {
  C3ShellSecurity,
  ALLOWED_COMMANDS,
  BLOCKED_ARGS,
  COMMAND_BLOCKED_ARGS,
  NPM_SAFE_SUBCOMMANDS,
  NPM_FORCE_IGNORE_SCRIPTS,
  STRIPPED_ENV_VARS,
  STRIPPED_ENV_PREFIXES,
  STRIPPED_ENV_SUFFIXES,
  ValidationResult,
  TimeoutConfig,
  DEFAULT_TIMEOUT_CONFIG,
} from '../common/shell-security-protocol';

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  killed: boolean;
  truncated: boolean;
  durationMs: number;
}

export class C3ShellSecurityService implements C3ShellSecurity {

  private timeoutConfig: TimeoutConfig = { ...DEFAULT_TIMEOUT_CONFIG };
  private bwrapAvailable: boolean | null = null;

  configure(config: Partial<TimeoutConfig>): void {
    Object.assign(this.timeoutConfig, config);
  }

  // ─── Layer 1–6: Validation ─────────────────────────────

  validate(
    command: string,
    args: string[],
    cwd: string,
    projectRoot: string,
  ): ValidationResult {

    // ── Layer 1: Command whitelist ──
    const baseName = path.basename(command);
    if (!ALLOWED_COMMANDS.has(baseName)) {
      return {
        verdict: 'block',
        blockedByLayer: 1,
        reason: `Příkaz '${baseName}' není na whitelistu povolených příkazů`,
      };
    }

    // ── Layer 2: Arg blacklist ──
    const cmdBlocked = COMMAND_BLOCKED_ARGS[baseName];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      // Global blocked args
      if (BLOCKED_ARGS.has(arg)) {
        return {
          verdict: 'block',
          blockedByLayer: 2,
          reason: `Argument '${arg}' je blokován (bezpečnostní riziko)`,
        };
      }

      // Per-command blocked args
      if (cmdBlocked) {
        for (const blocked of cmdBlocked) {
          if (arg === blocked || arg.startsWith(blocked + '=')) {
            return {
              verdict: 'block',
              blockedByLayer: 2,
              reason: `Argument '${arg}' je blokován pro příkaz '${baseName}'`,
            };
          }
        }
      }
    }

    // ── Layer 2b: npm/yarn safety ──
    const injectedArgs: string[] = [];

    if (baseName === 'npm' || baseName === 'yarn' || baseName === 'pnpm') {
      const subcommand = args[0];

      if (subcommand && !NPM_SAFE_SUBCOMMANDS.has(subcommand)) {
        return {
          verdict: 'block',
          blockedByLayer: 2,
          reason: `npm subcommand '${subcommand}' není povolený`,
        };
      }

      // Force --ignore-scripts for install/ci
      if (subcommand && NPM_FORCE_IGNORE_SCRIPTS.has(subcommand)) {
        if (!args.includes('--ignore-scripts')) {
          injectedArgs.push('--ignore-scripts');
        }
      }
    }

    // ── Layer 3: argv-based spawn is enforced at execution ──
    // (shell: false is hardcoded in execute(), not configurable)

    // ── Layer 4: cwd sandbox ──
    try {
      const resolvedCwd = fs.realpathSync(cwd);
      const resolvedRoot = fs.realpathSync(projectRoot);

      if (!resolvedCwd.startsWith(resolvedRoot + path.sep) && resolvedCwd !== resolvedRoot) {
        return {
          verdict: 'block',
          blockedByLayer: 4,
          reason: `Pracovní adresář '${cwd}' je mimo projekt (sandbox: ${projectRoot})`,
        };
      }
    } catch {
      return {
        verdict: 'block',
        blockedByLayer: 4,
        reason: `Pracovní adresář '${cwd}' nelze ověřit (neexistuje nebo broken symlink)`,
      };
    }

    // ── Layer 4b: Check for path traversal in args ──
    for (const arg of args) {
      if (this.isPathTraversal(arg, projectRoot)) {
        return {
          verdict: 'block',
          blockedByLayer: 4,
          reason: `Argument '${arg}' obsahuje path traversal mimo sandbox`,
        };
      }
    }

    // ── Layer 5: env sanitization (computed at execution) ──
    // ── Layer 6: bubblewrap (checked at execution) ──

    const sanitizedArgs = [...args, ...injectedArgs];

    return {
      verdict: 'allow',
      sanitizedCommand: baseName,
      sanitizedArgs,
      injectedArgs: injectedArgs.length > 0 ? injectedArgs : undefined,
      sanitizedEnv: this.sanitizeEnv(process.env as Record<string, string>),
    };
  }

  // ─── Layer 4b: Path Traversal Detection ────────────────

  /**
   * Check if an argument looks like a path traversal attack.
   * Only checks args that look like file paths.
   */
  private isPathTraversal(arg: string, projectRoot: string): boolean {
    // Skip non-path-like args (flags, URLs, etc.)
    if (arg.startsWith('-') || arg.includes('://')) return false;

    // Check if it contains .. components
    if (!arg.includes('..')) return false;

    try {
      // Resolve relative to project root
      const resolved = path.resolve(projectRoot, arg);
      const resolvedRoot = fs.realpathSync(projectRoot);

      return !resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot;
    } catch {
      // If we can't resolve, block it to be safe
      return arg.includes('..');
    }
  }

  // ─── Layer 5: Environment Sanitization ─────────────────

  sanitizeEnv(env: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (this.isEnvVarSensitive(key)) continue;
      sanitized[key] = value;
    }

    return sanitized;
  }

  private isEnvVarSensitive(key: string): boolean {
    const upper = key.toUpperCase();

    // Exact matches
    if (STRIPPED_ENV_VARS.has(upper)) return true;

    // Prefix patterns
    for (const prefix of STRIPPED_ENV_PREFIXES) {
      if (upper.startsWith(prefix)) return true;
    }

    // Suffix patterns
    for (const suffix of STRIPPED_ENV_SUFFIXES) {
      if (upper.endsWith(suffix)) return true;
    }

    return false;
  }

  // ─── Layer 6: Bubblewrap ───────────────────────────────

  async hasBubblewrap(): Promise<boolean> {
    if (this.bwrapAvailable !== null) return this.bwrapAvailable;

    try {
      await new Promise<void>((resolve, reject) => {
        execFile('bwrap', ['--version'], { timeout: 5000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.bwrapAvailable = true;
    } catch {
      this.bwrapAvailable = false;
    }
    return this.bwrapAvailable;
  }

  /**
   * Build bubblewrap arguments for sandboxed execution.
   */
  buildBwrapArgs(command: string, args: string[], cwd: string): string[] {
    return [
      '--ro-bind', '/', '/',           // Read-only root filesystem
      '--bind', cwd, cwd,              // Read-write access to project dir only
      '--tmpfs', '/tmp',               // Isolated /tmp
      '--proc', '/proc',               // Required by many tools
      '--dev', '/dev',                 // Minimal /dev
      '--die-with-parent',             // Kill child if parent dies
      '--unshare-pid',                 // PID namespace isolation
      // '--unshare-net',              // Network isolation (optional, commented for build tools)
      '--', command, ...args,
    ];
  }

  // ─── Layer 7: Execution with Timeout ───────────────────

  /**
   * Execute a validated command with all security layers applied.
   *
   * ALWAYS uses shell: false (Layer 3).
   * Applies timeout + SIGTERM/SIGKILL (Layer 7).
   * Output truncation at maxOutputBytes.
   */
  async execute(
    command: string,
    args: string[],
    cwd: string,
    projectRoot: string,
    options?: { timeoutMs?: number; env?: Record<string, string> },
  ): Promise<ShellExecResult> {

    // Validate first
    const validation = this.validate(command, args, cwd, projectRoot);
    if (validation.verdict === 'block') {
      return {
        stdout: '',
        stderr: `BLOCKED [Layer ${validation.blockedByLayer}]: ${validation.reason}`,
        exitCode: -1,
        killed: false,
        truncated: false,
        durationMs: 0,
      };
    }

    const timeoutMs = options?.timeoutMs || this.timeoutConfig.defaultTimeoutMs;
    const env = validation.sanitizedEnv || this.sanitizeEnv(
      options?.env || process.env as Record<string, string>,
    );

    // Determine if bubblewrap should be used
    let execCommand = validation.sanitizedCommand!;
    let execArgs = validation.sanitizedArgs!;

    if (await this.hasBubblewrap()) {
      execArgs = this.buildBwrapArgs(execCommand, execArgs, cwd);
      execCommand = 'bwrap';
    }

    const startTime = Date.now();

    return new Promise<ShellExecResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let truncated = false;
      const maxBytes = this.timeoutConfig.maxOutputBytes;

      // ── Layer 3: shell: false (HARDCODED, never configurable) ──
      const child = spawn(execCommand, execArgs, {
        cwd,
        shell: false,         // CRITICAL: Never shell: true
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        timeout: 0,           // We handle timeout manually for SIGTERM→SIGKILL
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < maxBytes) {
          stdout += chunk.toString();
          if (stdout.length >= maxBytes) {
            stdout = stdout.slice(0, maxBytes);
            truncated = true;
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < maxBytes) {
          stderr += chunk.toString();
          if (stderr.length >= maxBytes) {
            stderr = stderr.slice(0, maxBytes);
            truncated = true;
          }
        }
      });

      // ── Layer 7: Timeout with SIGTERM → SIGKILL ──
      const termTimer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');

        // SIGKILL grace period
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, this.timeoutConfig.killGraceMs);
      }, timeoutMs);

      child.on('close', (code: number | null) => {
        clearTimeout(termTimer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1,
          killed,
          truncated,
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(termTimer);
        resolve({
          stdout,
          stderr: err.message,
          exitCode: -1,
          killed: false,
          truncated: false,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
