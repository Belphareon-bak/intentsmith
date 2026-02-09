/**
 * @c3/shell-bridge — ShellTool Service (Node.js backend)
 *
 * SECURITY: This is the most security-critical component in C3 IDE.
 * All shell execution passes through here. No exceptions.
 *
 * Defense layers:
 *   1. Command whitelist
 *   2. Arg blacklist (no -e, -c, --exec, --eval)
 *   3. argv-based spawn (shell: false) ← CRITICAL
 *   4. cwd sandbox (resolved path must be inside project dir)
 *   5. env sanitization (strip secrets)
 *   6. bubblewrap (Sprint 7)
 *   7. timeout + SIGTERM → SIGKILL
 *
 * Additional invariants enforced:
 *   - Capability matrix (intent → what's allowed)
 *   - npm/yarn --ignore-scripts (always)
 *   - Git dirty tree check (before any file write)
 *   - npm script commands require user confirmation
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  C3ShellBridge,
  ShellToolRequest,
  ShellToolResult,
  ShellPermission,
  CAPABILITY_MATRIX,
  READ_ONLY_COMMANDS,
  GIT_WRITE_SUBCOMMANDS,
  NPM_SCRIPT_SUBCOMMANDS,
  NPM_INSTALL_SUBCOMMANDS,
} from '../common/shell-bridge-protocol';

// Max output buffer size
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB default
const DEFAULT_TIMEOUT_MS = 30_000;
const SIGKILL_GRACE_MS = 5_000;

@injectable()
export class ShellToolService implements C3ShellBridge {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private projectRoot: string = '';
  private userConfirmationHandler?: (command: string, args: string[], reason: string) => Promise<boolean>;

  // ─── Whitelist ─────────────────────────────────────────

  private readonly ALLOWED_COMMANDS = new Set([
    // File inspection
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find',
    // File manipulation
    'mkdir', 'cp', 'mv', 'touch',
    // Version control
    'git',
    // Package managers
    'npm', 'npx', 'pnpm', 'yarn',
    // Runtimes (argv-only, no -e/-c)
    'node', 'python', 'python3',
    // Flutter/Dart
    'flutter', 'dart',
    // Build tools
    'tsc', 'eslint', 'prettier',
    // Test runners
    'pytest', 'jest', 'vitest',
    // Utilities
    'diff', 'sort', 'uniq', 'tr', 'sed',
  ]);

  // ─── Blocked arg patterns ──────────────────────────────

  private readonly BLOCKED_ARG_PATTERNS: RegExp[] = [
    /^-e$/,             // node -e, python -e → arbitrary code execution
    /^--eval$/,         // node --eval
    /^-c$/,             // python -c, sh -c
    /^--command$/,
    /^--exec$/,
    /^--exec-path$/,
    /^--upload-pack$/,  // git --upload-pack (RCE vector)
    /^--receive-pack$/, // git --receive-pack (RCE vector)
  ];

  // ─── Configuration ─────────────────────────────────────

  setProjectRoot(root: string): void {
    this.projectRoot = path.resolve(root);
  }

  setUserConfirmationHandler(
    handler: (command: string, args: string[], reason: string) => Promise<boolean>,
  ): void {
    this.userConfirmationHandler = handler;
  }

  // ─── Public API ────────────────────────────────────────

  async execute(req: ShellToolRequest): Promise<ShellToolResult> {
    const startTime = Date.now();

    // ── Layer 0: Capability matrix ─────────────────────
    this.validateCapability(req.command, req.args, req.intent);

    // ── Layer 1: Command whitelist ─────────────────────
    this.validateCommand(req.command);

    // ── Layer 2: Arg blacklist ─────────────────────────
    this.validateArgs(req.command, req.args);

    // ── npm invariant: force --ignore-scripts ──────────
    const sanitizedArgs = this.sanitizeNpmArgs(req.command, [...req.args]);

    // ── npm script commands: require user confirmation ─
    await this.checkNpmScriptConfirmation(req.command, sanitizedArgs);

    // ── Layer 4: cwd sandbox ───────────────────────────
    const safeCwd = this.validateCwd(req.cwd);

    // ── Git dirty tree check (before file writes) ──────
    const capability = CAPABILITY_MATRIX[req.intent];
    if (capability?.fsWrite) {
      await this.checkGitDirtyTree(safeCwd);
    }

    // ── Layer 5: env sanitization ──────────────────────
    const safeEnv = this.sanitizeEnv(req.env);

    // ── Layer 3 + 7: argv spawn with timeout ───────────
    const timeoutMs = req.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxOutput = (req.maxOutputKb || 64) * 1024;

    this.logger.info(`SHELL_EXEC: ${req.command} ${sanitizedArgs.join(' ')} (cwd: ${safeCwd}, intent: ${req.intent})`);

    const result = await this.spawnArgv(
      req.command,
      sanitizedArgs,
      safeCwd,
      safeEnv,
      timeoutMs,
      maxOutput,
    );

    result.durationMs = Date.now() - startTime;

    this.logger.info(`SHELL_DONE: exit=${result.exitCode} (${result.durationMs}ms, truncated=${result.truncated})`);

    return result;
  }

  async canExecute(command: string, intent: string): Promise<ShellPermission> {
    // Check capability matrix
    const capability = CAPABILITY_MATRIX[intent];
    if (!capability) {
      return { allowed: false, reason: `Unknown intent: ${intent}` };
    }
    if (!capability.shell) {
      return { allowed: false, reason: `Intent ${intent} does not allow shell execution` };
    }

    // Check whitelist
    if (!this.ALLOWED_COMMANDS.has(command)) {
      return { allowed: false, reason: `Command "${command}" not in whitelist` };
    }

    // Check read-only mode
    if (capability.shellMode === 'read-only' && !READ_ONLY_COMMANDS.has(command)) {
      return { allowed: false, reason: `Command "${command}" not allowed in read-only mode (REVIEW)` };
    }

    return {
      allowed: true,
      readOnly: capability.shellMode === 'read-only',
    };
  }

  async requestUserConfirmation(
    command: string,
    args: string[],
    reason: string,
  ): Promise<boolean> {
    if (!this.userConfirmationHandler) {
      // No handler registered → deny by default (safe)
      this.logger.warn(`SHELL_DENIED: No user confirmation handler for: ${command} ${args.join(' ')}`);
      return false;
    }
    return this.userConfirmationHandler(command, args, reason);
  }

  // ─── Validation (Layers 0-4) ───────────────────────────

  private validateCapability(command: string, args: string[], intent: string): void {
    const capability = CAPABILITY_MATRIX[intent];
    if (!capability) {
      throw new ShellSecurityError('CAPABILITY_UNKNOWN', `Unknown intent: ${intent}`);
    }
    if (!capability.shell) {
      throw new ShellSecurityError('CAPABILITY_DENIED',
        `Intent ${intent} does not allow shell execution. Capability matrix: shell=false`);
    }

    // Read-only mode check
    if (capability.shellMode === 'read-only') {
      if (!READ_ONLY_COMMANDS.has(command)) {
        throw new ShellSecurityError('READONLY_DENIED',
          `Command "${command}" not allowed in read-only mode (intent: ${intent})`);
      }
      // Git in read-only: block write subcommands
      if (command === 'git' && args.length > 0 && GIT_WRITE_SUBCOMMANDS.has(args[0])) {
        throw new ShellSecurityError('READONLY_DENIED',
          `Git subcommand "${args[0]}" is a write operation — blocked in read-only mode`);
      }
    }

    // Limited mode check (CODE intent)
    if (capability.shellMode === 'limited') {
      // CODE can write files but shouldn't run arbitrary network ops
      // This is mostly enforced by network=false in capability matrix
    }
  }

  private validateCommand(command: string): void {
    if (!this.ALLOWED_COMMANDS.has(command)) {
      throw new ShellSecurityError('COMMAND_BLOCKED',
        `"${command}" not in allowed commands whitelist`);
    }

    // Reject anything with path separators (prevent /bin/sh, ./exploit.sh)
    if (command.includes('/') || command.includes('\\')) {
      throw new ShellSecurityError('COMMAND_BLOCKED',
        `Command must be a bare name, not a path: "${command}"`);
    }
  }

  private validateArgs(command: string, args: string[]): void {
    for (const arg of args) {
      // Check blocked patterns
      for (const pattern of this.BLOCKED_ARG_PATTERNS) {
        if (pattern.test(arg)) {
          throw new ShellSecurityError('ARG_BLOCKED',
            `Argument "${arg}" is blocked for security (prevents arbitrary code execution)`);
        }
      }

      // Block shell metacharacters in args (extra safety even with shell:false)
      if (/[;&|`$(){}]/.test(arg) && !arg.startsWith('{') /* allow JSON-ish args */) {
        this.logger.warn(`SHELL_SUSPICIOUS_ARG: "${arg}" contains shell metacharacters`);
        // Not blocking — shell:false handles this — but logging for audit
      }
    }
  }

  private validateCwd(cwd: string): string {
    if (!this.projectRoot) {
      throw new ShellSecurityError('NO_PROJECT_ROOT',
        'Project root not set. Call setProjectRoot() first.');
    }

    const resolved = path.resolve(cwd);

    // Must be inside project root (prevents path traversal)
    if (!resolved.startsWith(this.projectRoot)) {
      throw new ShellSecurityError('CWD_ESCAPE',
        `Working directory "${cwd}" resolves to "${resolved}" which is outside project root "${this.projectRoot}"`);
    }

    // Check for symlink escape
    try {
      const real = fs.realpathSync(resolved);
      if (!real.startsWith(this.projectRoot)) {
        throw new ShellSecurityError('SYMLINK_ESCAPE',
          `Symlink resolves outside project root: "${resolved}" → "${real}"`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // Directory doesn't exist yet — that's ok (mkdir will create it)
        // But parent must be inside project root
        const parent = path.dirname(resolved);
        if (!parent.startsWith(this.projectRoot)) {
          throw new ShellSecurityError('CWD_ESCAPE',
            `Parent of cwd "${parent}" is outside project root`);
        }
      } else if (err instanceof ShellSecurityError) {
        throw err;
      }
    }

    return resolved;
  }

  // ─── npm/yarn Invariant ────────────────────────────────

  /**
   * npm/yarn Script Execution Invariant:
   * Agent NEVER runs npm/yarn without --ignore-scripts on install commands.
   * Script commands (npm test, npm run build) require user confirmation.
   */
  private sanitizeNpmArgs(command: string, args: string[]): string[] {
    if (command !== 'npm' && command !== 'yarn' && command !== 'pnpm') {
      return args;
    }

    const subcommand = args[0];

    // Install commands: always add --ignore-scripts
    if (subcommand && NPM_INSTALL_SUBCOMMANDS.has(subcommand)) {
      if (!args.includes('--ignore-scripts')) {
        args.push('--ignore-scripts');
        this.logger.info(`NPM_SANITIZE: Added --ignore-scripts to ${command} ${subcommand}`);
      }
    }

    return args;
  }

  /**
   * npm script commands (test, run, start) execute user-defined scripts
   * via shell. These REQUIRE explicit user confirmation.
   */
  private async checkNpmScriptConfirmation(command: string, args: string[]): Promise<void> {
    if (command !== 'npm' && command !== 'yarn' && command !== 'pnpm') return;

    const subcommand = args[0];
    if (!subcommand || !NPM_SCRIPT_SUBCOMMANDS.has(subcommand)) return;

    const fullCmd = `${command} ${args.join(' ')}`;
    const confirmed = await this.requestUserConfirmation(
      command,
      args,
      `"${fullCmd}" spouští uživatelské skripty přes shell. Povolit?`,
    );

    if (!confirmed) {
      throw new ShellSecurityError('USER_DENIED',
        `User denied execution of: ${fullCmd}`);
    }
  }

  // ─── Git Dirty Tree Invariant ──────────────────────────

  /**
   * Agent NEVER modifies a file that has local user modifications.
   * Before any write operation: git status must be clean.
   */
  private async checkGitDirtyTree(cwd: string): Promise<void> {
    try {
      const result = await this.spawnArgv(
        'git', ['status', '--porcelain'],
        cwd,
        this.sanitizeEnv(),
        5000,  // 5s timeout for git status
        MAX_OUTPUT_BYTES,
      );

      if (result.stdout.trim() !== '') {
        const dirtyFiles = result.stdout.trim().split('\n').length;
        throw new ShellSecurityError('GIT_DIRTY_TREE',
          `Repo has ${dirtyFiles} uncommitted change(s). ` +
          `Please commit or stash before agent can modify files.\n` +
          `Dirty files:\n${result.stdout.trim()}`);
      }
    } catch (err: any) {
      if (err instanceof ShellSecurityError) throw err;
      // Not a git repo or git not available — skip check
      this.logger.warn(`Git dirty tree check skipped: ${err.message}`);
    }
  }

  // ─── Environment Sanitization ──────────────────────────

  private sanitizeEnv(extra?: Record<string, string>): Record<string, string> {
    const safe: Record<string, string> = {};
    const source = { ...process.env, ...(extra || {}) };

    const STRIP_PATTERNS = [
      'SECRET', 'TOKEN', 'KEY', 'PASSWORD', 'CREDENTIAL', 'AUTH',
      'API_KEY', 'PRIVATE', 'SIGNING',
    ];

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const upper = key.toUpperCase();
      const isSecret = STRIP_PATTERNS.some(p => upper.includes(p));
      if (!isSecret) {
        safe[key] = value;
      }
    }

    return safe;
  }

  // ─── Spawn (Layer 3 + 7) ──────────────────────────────

  private spawnArgv(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number,
    maxOutput: number,
  ): Promise<ShellToolResult> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;

      try {
        child = spawn(command, args, {
          cwd,
          env,
          shell: false,  // ← CRITICAL: argv-based only, never shell
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 0,    // we handle timeout ourselves for clean SIGTERM→SIGKILL
        });
      } catch (err: any) {
        reject(new ShellSecurityError('SPAWN_FAILED', `Failed to spawn "${command}": ${err.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let killed = false;

      // Capture stdout
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length > maxOutput) {
          stdout += chunk.toString('utf-8', 0, maxOutput - stdout.length);
          truncated = true;
        } else {
          stdout += chunk.toString('utf-8');
        }
      });

      // Capture stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length + chunk.length > maxOutput) {
          stderr += chunk.toString('utf-8', 0, maxOutput - stderr.length);
          truncated = true;
        } else {
          stderr += chunk.toString('utf-8');
        }
      });

      // Timeout: SIGTERM → grace period → SIGKILL
      const timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, SIGKILL_GRACE_MS);
      }, timeoutMs);

      // Completion
      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);

        resolve({
          exitCode: code ?? (killed ? 124 : -1),
          stdout,
          stderr: killed ? stderr + '\n[TIMEOUT: killed after ' + timeoutMs + 'ms]' : stderr,
          durationMs: 0, // filled by caller
          truncated,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeoutHandle);
        reject(new ShellSecurityError('SPAWN_ERROR', `Process error: ${err.message}`));
      });
    });
  }
}

// ─── Security Error ──────────────────────────────────────

export class ShellSecurityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ShellSecurityError';
  }
}
