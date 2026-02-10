/**
 * @c3/shell-security — Protocol (common)
 *
 * 7-Layer Defense Model for ShellTool:
 *
 *   Layer 1: Command whitelist (ALLOWED_COMMANDS)
 *   Layer 2: Arg blacklist (BLOCKED_ARGS — no -e, -c, --exec)
 *   Layer 3: argv-based spawn (shell: false — no pipe, no chain)
 *   Layer 4: cwd sandbox (resolved path must be in project dir)
 *   Layer 5: env sanitization (strip secrets)
 *   Layer 6: bubblewrap (filesystem + network isolation) — if available
 *   Layer 7: timeout + SIGTERM/SIGKILL (30s default)
 *
 * Security test matrix:
 *   node -e "exec('rm -rf /')"             → BLOCKED (blocked arg -e)
 *   python -c "import os; os.system(...)"  → BLOCKED (blocked arg -c)
 *   git clone --upload-pack='rm -rf /'     → BLOCKED (blocked arg --upload-pack)
 *   flutter test; rm -rf /                  → BLOCKED (shell: false, ";" is literal arg)
 *   curl file:///etc/passwd                 → BLOCKED (--proto =http,https enforced)
 *   ls ../../etc/passwd                     → BLOCKED (cwd outside sandbox)
 *   npm run postinstall (malicious)         → MITIGATED (--ignore-scripts forced)
 */

export const C3ShellSecurityPath = '/services/c3-shell-security';
export const C3ShellSecurity = Symbol('C3ShellSecurity');

// ─── Layer 1: Command Whitelist ──────────────────────────

export const ALLOWED_COMMANDS = new Set([
  // Build tools
  'flutter', 'dart', 'npm', 'npx', 'yarn', 'pnpm',
  'node', 'python', 'python3', 'pip', 'pip3',
  'cargo', 'rustc', 'go',
  'make', 'cmake', 'gradle', 'mvn',

  // Version control
  'git',

  // File operations (read-only preferred)
  'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep',
  'diff', 'file', 'stat', 'tree', 'du',

  // Build/test utilities
  'echo', 'printf', 'test', 'true', 'false',
  'mkdir', 'cp', 'mv', 'touch', 'chmod',

  // Network (restricted)
  'curl', 'wget',

  // Archive
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',

  // Docker (project-scoped)
  'docker', 'docker-compose',
]);

// ─── Layer 2: Blocked Arguments ──────────────────────────

/** Arguments that enable arbitrary code execution */
export const BLOCKED_ARGS = new Set([
  // Node.js
  '-e', '--eval', '-p', '--print', '--input-type',

  // Python
  '-c', '--command',

  // Git dangerous
  '--upload-pack', '--receive-pack',
  '--exec', '--exec-path',

  // Curl dangerous
  '--output', '-o',          // write to arbitrary path

  // General
  '--shell', '--login',
]);

/**
 * Per-command blocked arg patterns.
 * Key: command name, Value: Set of blocked arg prefixes.
 */
export const COMMAND_BLOCKED_ARGS: Record<string, Set<string>> = {
  node: new Set(['-e', '--eval', '-p', '--print', '--input-type', '-r', '--require']),
  python: new Set(['-c', '--command', '-m']),
  python3: new Set(['-c', '--command', '-m']),
  git: new Set(['--upload-pack', '--receive-pack', '--exec']),
  curl: new Set(['--output', '-o', '-O', '--remote-name']),
  wget: new Set(['-O', '--output-document']),
};

// ─── Layer 2b: npm/yarn Safety ───────────────────────────

/** Safe npm subcommands (others are blocked) */
export const NPM_SAFE_SUBCOMMANDS = new Set([
  'install', 'ci', 'test', 'run', 'build',
  'list', 'ls', 'outdated', 'audit', 'info',
  'init', 'version', 'pack', 'dedupe',
  'run-script', 'start',
]);

/** npm subcommands that MUST have --ignore-scripts */
export const NPM_FORCE_IGNORE_SCRIPTS = new Set([
  'install', 'ci',
]);

// ─── Layer 5: Environment Sanitization ───────────────────

/** Environment variables to ALWAYS strip from child processes */
export const STRIPPED_ENV_VARS = new Set([
  // API keys
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'GITHUB_TOKEN', 'GITLAB_TOKEN',

  // Database
  'DATABASE_URL', 'DB_PASSWORD', 'REDIS_URL', 'MONGO_URI',

  // SSH/GPG
  'SSH_AUTH_SOCK', 'GPG_AGENT_INFO',

  // Session/auth
  'SESSION_SECRET', 'JWT_SECRET', 'COOKIE_SECRET',

  // Docker
  'DOCKER_HOST', 'DOCKER_TLS_VERIFY',

  // Generic patterns (checked with startsWith)
  // Handled in code: *_SECRET, *_TOKEN, *_KEY, *_PASSWORD
]);

/** Prefix patterns — any env var starting with these is stripped */
export const STRIPPED_ENV_PREFIXES = [
  'SECRET_', 'TOKEN_', 'KEY_', 'PASSWORD_',
];

/** Suffix patterns — any env var ending with these is stripped */
export const STRIPPED_ENV_SUFFIXES = [
  '_SECRET', '_TOKEN', '_KEY', '_PASSWORD', '_CREDENTIALS',
  '_API_KEY', '_AUTH', '_PRIVATE',
];

// ─── Layer 7: Timeouts ──────────────────────────────────

export interface TimeoutConfig {
  /** Default command timeout in ms (default: 30000) */
  defaultTimeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL in ms (default: 5000) */
  killGraceMs: number;
  /** Max output size in bytes before truncation (default: 65536) */
  maxOutputBytes: number;
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultTimeoutMs: 30000,
  killGraceMs: 5000,
  maxOutputBytes: 65536,
};

// ─── Validation Result ───────────────────────────────────

export type ValidationVerdict = 'allow' | 'block';

export interface ValidationResult {
  verdict: ValidationVerdict;
  /** Which layer blocked it (if blocked) */
  blockedByLayer?: number;
  /** Human-readable reason */
  reason?: string;
  /** The sanitized command + args (if allowed) */
  sanitizedCommand?: string;
  sanitizedArgs?: string[];
  /** Sanitized environment */
  sanitizedEnv?: Record<string, string>;
  /** Whether bubblewrap should be used */
  useBubblewrap?: boolean;
  /** Injected args (e.g. --ignore-scripts for npm install) */
  injectedArgs?: string[];
}

// ─── Service Interface ───────────────────────────────────

export interface C3ShellSecurity {
  /**
   * Validate a command before execution.
   * Returns allow/block with detailed reason.
   */
  validate(
    command: string,
    args: string[],
    cwd: string,
    projectRoot: string,
  ): ValidationResult;

  /**
   * Sanitize environment variables for child process.
   */
  sanitizeEnv(env: Record<string, string>): Record<string, string>;

  /**
   * Check if bubblewrap is available on this system.
   */
  hasBubblewrap(): Promise<boolean>;
}
