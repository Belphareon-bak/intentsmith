/**
 * @c3/shell-bridge — Protocol (common)
 *
 * Shared types for ShellTool execution.
 *
 * SECURITY MODEL (7 layers):
 *   1. Command whitelist (ALLOWED_COMMANDS)
 *   2. Arg blacklist (BLOCKED_ARGS — no -e, -c, --exec)
 *   3. argv-based spawn (shell: false)
 *   4. cwd sandbox (must resolve inside project dir)
 *   5. env sanitization (strip secrets)
 *   6. bubblewrap (Sprint 7 — filesystem + network isolation)
 *   7. timeout + SIGTERM/SIGKILL (default 30s)
 */

export const C3ShellBridgePath = '/services/c3-shell-bridge';
export const C3ShellBridge = Symbol('C3ShellBridge');

// ─── Request / Result ────────────────────────────────────

export interface ShellToolRequest {
  /** Binary name only — e.g. "flutter", "npm", "git". No paths, no shell. */
  command: string;
  /** argv array — e.g. ["test", "--reporter", "json"] */
  args: string[];
  /** Working directory — MUST resolve inside project sandbox */
  cwd: string;
  /** Additional env vars (secrets are stripped automatically) */
  env?: Record<string, string>;
  /** Timeout in ms (default 30_000) */
  timeoutMs?: number;
  /** Max output capture in KB (default 64) */
  maxOutputKb?: number;
  /** Intent that triggered this execution (for capability matrix validation) */
  intent: string;
  /** Turn ID for audit trail correlation */
  turnId: string;
}

export interface ShellToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  /** True if the command required user confirmation (npm run scripts) */
  userConfirmed?: boolean;
}

// ─── Service Interface ───────────────────────────────────

export interface C3ShellBridge {
  /**
   * Execute a shell command in the agent sandbox.
   * Validates: whitelist, blocked args, cwd sandbox, capability matrix, npm invariant.
   */
  execute(request: ShellToolRequest): Promise<ShellToolResult>;

  /**
   * Check if a command is allowed for a given intent WITHOUT executing.
   * Used by agent to decide if it CAN request shell execution.
   */
  canExecute(command: string, intent: string): Promise<ShellPermission>;

  /**
   * Request user confirmation for flagged commands (npm run, npm test).
   * Returns true if user approved, false if denied.
   */
  requestUserConfirmation(
    command: string,
    args: string[],
    reason: string,
  ): Promise<boolean>;
}

export interface ShellPermission {
  allowed: boolean;
  reason?: string;
  readOnly?: boolean;
}

// ─── Capability Matrix (compile-time source of truth) ────

export type IntentCapability = {
  shell: boolean;
  fsWrite: boolean;
  diff: boolean;
  git: boolean;
  network: boolean;
  /** If shell is allowed, which mode? */
  shellMode?: 'full' | 'limited' | 'read-only';
};

/**
 * Capability Matrix — defines what each intent MAY use.
 *
 * This is the reference document for:
 * - ShellTool validation (this sprint)
 * - Security audit (Sprint 7)
 * - Future extensions (new intent → add row)
 */
export const CAPABILITY_MATRIX: Record<string, IntentCapability> = {
  DESIGN:         { shell: false, fsWrite: false, diff: false, git: false, network: false },
  BUILD:          { shell: true,  fsWrite: true,  diff: true,  git: true,  network: true,  shellMode: 'full' },
  CODE:           { shell: true,  fsWrite: true,  diff: true,  git: true,  network: false, shellMode: 'limited' },
  REVIEW:         { shell: true,  fsWrite: false, diff: true,  git: false, network: false, shellMode: 'read-only' },
  CONVERSATIONAL: { shell: false, fsWrite: false, diff: false, git: false, network: false },
  SEARCH:         { shell: false, fsWrite: false, diff: false, git: false, network: true },
  LOCAL:          { shell: false, fsWrite: false, diff: false, git: false, network: false },
  FACTUAL:        { shell: false, fsWrite: false, diff: false, git: false, network: false },
};

/** Commands allowed in read-only mode (REVIEW intent) */
export const READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'wc', 'grep', 'find', 'ls',
  'diff', 'git',  // git log, git diff, git show — but NOT git commit/push
  'flutter',      // flutter test — read-only
  'npm',          // npm test — read-only
  'jest', 'vitest', 'pytest',
]);

/** Git subcommands that are WRITE operations → blocked in read-only mode */
export const GIT_WRITE_SUBCOMMANDS = new Set([
  'commit', 'push', 'merge', 'rebase', 'reset', 'checkout',
  'branch', 'tag', 'stash', 'cherry-pick', 'revert', 'am',
  'pull', 'fetch', 'clone', 'init', 'remote',
]);

/** npm/yarn subcommands that trigger shell scripts */
export const NPM_SCRIPT_SUBCOMMANDS = new Set([
  'run', 'run-script', 'start', 'test', 'build',
  'preinstall', 'postinstall', 'prepare',
]);

/** npm/yarn subcommands that install packages */
export const NPM_INSTALL_SUBCOMMANDS = new Set([
  'install', 'ci', 'add', 'i',
]);
