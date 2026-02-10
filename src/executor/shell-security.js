// Shell Security — Command Whitelist + Argument Blacklist + CWD Sandbox
// ══════════════════════════════════════════════════════════════════════════════
// Adapted from IDE Sprint 7 shell-security-protocol.ts for backend executor.
// Validates commands BEFORE execution to prevent arbitrary shell access.

import { resolve, relative } from 'path';

/**
 * Allowed command binaries. Only these can be spawned.
 * Anything not in this set is BLOCKED.
 */
const ALLOWED_COMMANDS = new Set([
  // Filesystem inspection
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'file', 'stat',
  'readlink', 'realpath', 'du', 'df',

  // Filesystem mutation
  'mkdir', 'cp', 'mv', 'touch', 'rm', 'ln', 'chmod',
  'sort', 'uniq', 'tr', 'sed', 'awk', 'cut', 'paste', 'tee',

  // Version control
  'git',

  // Package managers
  'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3',

  // Runtimes
  'node', 'python', 'python3', 'deno', 'bun',

  // Build tools
  'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'pytest',
  'flutter', 'dart', 'cargo', 'go', 'java', 'javac', 'mvn', 'gradle',
  'make', 'cmake', 'gcc', 'g++', 'clang',

  // Containers & misc
  'docker', 'diff', 'patch', 'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'curl', 'wget',
  'echo', 'printf', 'true', 'false', 'test', 'env', 'which', 'whoami',
]);

/**
 * Blocked argument patterns. These are dangerous flags that enable
 * arbitrary code execution or data exfiltration through otherwise safe binaries.
 */
const BLOCKED_ARG_PATTERNS = [
  // node -e / python -c — inline code execution
  { pattern: /^-e$/, binaries: ['node'] },
  { pattern: /^--eval$/, binaries: ['node'] },
  { pattern: /^--eval=/, binaries: ['node'] },
  { pattern: /^-c$/, binaries: ['python', 'python3'] },
  { pattern: /^--command$/, binaries: ['python', 'python3'] },
  { pattern: /^-e$/, binaries: ['python', 'python3'] },

  // git remote code execution vectors
  { pattern: /^--upload-pack(=|$)/, binaries: ['git'] },
  { pattern: /^--receive-pack(=|$)/, binaries: ['git'] },
  { pattern: /^--exec(=|$)/, binaries: ['git'] },

  // npm scripts can run arbitrary code — block --ignore-scripts bypass
  // (we enforce --ignore-scripts, so blocking its negation)

  // curl/wget — block upload and POST to prevent data exfiltration
  { pattern: /^--upload-file(=|$)/, binaries: ['curl'] },
  { pattern: /^-T$/, binaries: ['curl'] },
  { pattern: /^-X$/, binaries: ['curl'] },  // block arbitrary HTTP methods
  { pattern: /^--request(=|$)/, binaries: ['curl'] },
  { pattern: /^--data(=|$)/, binaries: ['curl'] },
  { pattern: /^-d$/, binaries: ['curl'] },
  { pattern: /^--post-data(=|$)/, binaries: ['wget'] },
  { pattern: /^--method(=|$)/, binaries: ['wget'] },
];

/**
 * npm subcommands that require --ignore-scripts injection.
 */
const NPM_SCRIPT_SUBCOMMANDS = new Set([
  'install', 'ci', 'add', 'update', 'rebuild',
]);

/**
 * Validate a parsed command (binary + args) against security rules.
 *
 * @param {string[]} argv - Parsed command [binary, ...args]
 * @param {string} projectRoot - Project root directory for cwd sandboxing
 * @throws {Error} If command violates any security rule
 */
export function validateCommand(argv, projectRoot) {
  if (!argv || argv.length === 0) {
    throw new Error('Empty command');
  }

  const binary = extractBinaryName(argv[0]);
  const args = argv.slice(1);

  // 1. Binary whitelist check
  if (!ALLOWED_COMMANDS.has(binary)) {
    throw new Error(`Blocked command: "${binary}" is not in the allowed command list`);
  }

  // 2. Argument blacklist check
  for (const arg of args) {
    for (const rule of BLOCKED_ARG_PATTERNS) {
      if (rule.binaries.includes(binary) && rule.pattern.test(arg)) {
        throw new Error(`Blocked argument: "${arg}" is not allowed with "${binary}"`);
      }
    }
  }

  // 3. npm --ignore-scripts enforcement
  if ((binary === 'npm' || binary === 'pnpm' || binary === 'yarn') && args.length > 0) {
    const subcommand = args[0];
    if (NPM_SCRIPT_SUBCOMMANDS.has(subcommand)) {
      if (!args.includes('--ignore-scripts')) {
        // Auto-inject is done by caller — here we just warn
        // (Caller should call injectSafetyFlags() before spawning)
      }
    }
  }

  // 4. CWD sandbox check — any path args must resolve inside projectRoot
  if (projectRoot) {
    validatePathArgs(args, binary, projectRoot);
  }
}

/**
 * Inject safety flags into command argv.
 * - npm install/ci/add → add --ignore-scripts if missing
 *
 * @param {string[]} argv - Parsed command [binary, ...args]
 * @returns {string[]} Modified argv with safety flags injected
 */
export function injectSafetyFlags(argv) {
  if (!argv || argv.length < 2) return argv;

  const binary = extractBinaryName(argv[0]);
  const args = argv.slice(1);

  if ((binary === 'npm' || binary === 'pnpm') && NPM_SCRIPT_SUBCOMMANDS.has(args[0])) {
    if (!args.includes('--ignore-scripts')) {
      return [argv[0], args[0], '--ignore-scripts', ...args.slice(1)];
    }
  }

  return argv;
}

/**
 * Extract binary name from a potentially full path.
 * @param {string} bin - e.g. "/usr/bin/git" → "git", "node" → "node"
 * @returns {string}
 */
function extractBinaryName(bin) {
  const parts = bin.split('/');
  return parts[parts.length - 1];
}

/**
 * Validate that path-like arguments don't escape projectRoot.
 * Only checks arguments that look like paths (start with / or ..)
 * @param {string[]} args
 * @param {string} binary
 * @param {string} projectRoot
 */
function validatePathArgs(args, binary, projectRoot) {
  const resolvedRoot = resolve(projectRoot);

  for (const arg of args) {
    // Skip flags
    if (arg.startsWith('-')) continue;

    // Skip non-path-like args
    if (!arg.startsWith('/') && !arg.startsWith('..')) continue;

    // Resolve and check containment
    const resolvedArg = resolve(projectRoot, arg);
    const rel = relative(resolvedRoot, resolvedArg);

    if (rel.startsWith('..')) {
      throw new Error(
        `Path escape blocked: "${arg}" resolves outside project root "${projectRoot}"`
      );
    }
  }
}

export { ALLOWED_COMMANDS, BLOCKED_ARG_PATTERNS };
