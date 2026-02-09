/**
 * C3 Backend — Sprint 2 Integration
 *
 * Extends Sprint 1 ws-server.js with:
 *   - ShellTool execution via agent events
 *   - AuditTrail logging for all events
 *   - ProjectStore rehydration on connect
 *   - Auto-save triggers
 *
 * Usage:
 *   const { createC3WebSocketServer } = require('./ws-server'); // Sprint 1
 *   const { createShellExecutor } = require('./shell-executor');
 *   const { AuditTrailService } = require('./audit-trail-service');
 *   const { ProjectStoreService } = require('./project-store-service');
 *
 *   const shellExecutor = createShellExecutor(projectRoot);
 *   const auditTrail = new AuditTrailService();
 *   await auditTrail.init(projectRoot);
 *
 *   // Pass to session hooks in ws-server
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

// ═══════════════════════════════════════════════════════════
// ShellTool Executor (for C3 backend — mirrors Theia ShellToolService)
// ═══════════════════════════════════════════════════════════

/**
 * Create a ShellTool executor bound to a project root.
 * This is the backend-side equivalent of ShellToolService.
 *
 * IMPORTANT: This uses the SAME security model as the Theia-side service:
 * whitelist, arg blacklist, argv-based spawn, cwd sandbox.
 */
function createShellExecutor(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);

  const ALLOWED_COMMANDS = new Set([
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find',
    'mkdir', 'cp', 'mv', 'touch',
    'git', 'npm', 'npx', 'pnpm', 'yarn',
    'node', 'python', 'python3',
    'flutter', 'dart',
    'tsc', 'eslint', 'prettier',
    'pytest', 'jest', 'vitest',
    'diff', 'sort', 'uniq',
  ]);

  const BLOCKED_ARGS = [
    /^-e$/,
    /^--eval$/,
    /^-c$/,
    /^--command$/,
    /^--exec$/,
    /^--upload-pack$/,
    /^--receive-pack$/,
  ];

  const NPM_INSTALL_CMDS = new Set(['install', 'ci', 'add', 'i']);

  const CAPABILITY_MATRIX = {
    DESIGN:         { shell: false },
    BUILD:          { shell: true,  mode: 'full' },
    CODE:           { shell: true,  mode: 'limited' },
    REVIEW:         { shell: true,  mode: 'read-only' },
    CONVERSATIONAL: { shell: false },
    SEARCH:         { shell: false },
    LOCAL:          { shell: false },
    FACTUAL:        { shell: false },
  };

  const READ_ONLY_COMMANDS = new Set([
    'cat', 'head', 'tail', 'wc', 'grep', 'find', 'ls',
    'diff', 'git', 'flutter', 'npm', 'jest', 'vitest', 'pytest',
  ]);

  const GIT_WRITE_SUBCMDS = new Set([
    'commit', 'push', 'merge', 'rebase', 'reset', 'checkout',
    'branch', 'tag', 'stash', 'cherry-pick', 'revert',
    'pull', 'fetch', 'clone', 'init', 'remote',
  ]);

  /**
   * Execute a command in the project sandbox.
   *
   * @param {string} command - Binary name
   * @param {string[]} args - argv array
   * @param {string} intent - CRE intent for capability check
   * @param {object} options
   * @param {number} options.timeoutMs - Timeout (default 30000)
   * @param {AbortSignal} options.signal - For cancellation
   * @returns {Promise<{exitCode, stdout, stderr, durationMs, truncated}>}
   */
  async function execute(command, args, intent, options = {}) {
    const { timeoutMs = 30000, signal } = options;
    const startTime = Date.now();

    // ── Capability matrix ──────────────────────────────
    const cap = CAPABILITY_MATRIX[intent];
    if (!cap || !cap.shell) {
      throw Object.assign(
        new Error(`CAPABILITY_DENIED: Intent ${intent} does not allow shell execution`),
        { code: 'CAPABILITY_DENIED' },
      );
    }

    if (cap.mode === 'read-only' && !READ_ONLY_COMMANDS.has(command)) {
      throw Object.assign(
        new Error(`READONLY_DENIED: "${command}" not allowed in read-only mode`),
        { code: 'READONLY_DENIED' },
      );
    }

    if (cap.mode === 'read-only' && command === 'git' && args[0] && GIT_WRITE_SUBCMDS.has(args[0])) {
      throw Object.assign(
        new Error(`READONLY_DENIED: git ${args[0]} is a write operation`),
        { code: 'READONLY_DENIED' },
      );
    }

    // ── Whitelist ──────────────────────────────────────
    if (!ALLOWED_COMMANDS.has(command)) {
      throw Object.assign(
        new Error(`COMMAND_BLOCKED: "${command}" not in whitelist`),
        { code: 'COMMAND_BLOCKED' },
      );
    }

    if (command.includes('/') || command.includes('\\')) {
      throw Object.assign(
        new Error(`COMMAND_BLOCKED: path in command name: "${command}"`),
        { code: 'COMMAND_BLOCKED' },
      );
    }

    // ── Arg blacklist ──────────────────────────────────
    for (const arg of args) {
      for (const pattern of BLOCKED_ARGS) {
        if (pattern.test(arg)) {
          throw Object.assign(
            new Error(`ARG_BLOCKED: "${arg}" is blocked`),
            { code: 'ARG_BLOCKED' },
          );
        }
      }
    }

    // ── npm --ignore-scripts invariant ─────────────────
    const sanitizedArgs = [...args];
    if ((command === 'npm' || command === 'yarn' || command === 'pnpm') &&
        sanitizedArgs[0] && NPM_INSTALL_CMDS.has(sanitizedArgs[0])) {
      if (!sanitizedArgs.includes('--ignore-scripts')) {
        sanitizedArgs.push('--ignore-scripts');
      }
    }

    // ── cwd sandbox ────────────────────────────────────
    const cwd = resolvedRoot;

    // ── Spawn (argv-based, shell: false) ───────────────
    return new Promise((resolve, reject) => {
      let killed = false;

      const child = spawn(command, sanitizedArgs, {
        cwd,
        shell: false,  // ← CRITICAL
        stdio: ['ignore', 'pipe', 'pipe'],
        env: sanitizeEnv(process.env),
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      const maxOutput = 64 * 1024;

      child.stdout.on('data', (chunk) => {
        if (stdout.length < maxOutput) {
          stdout += chunk.toString('utf-8').slice(0, maxOutput - stdout.length);
        } else {
          truncated = true;
        }
      });

      child.stderr.on('data', (chunk) => {
        if (stderr.length < maxOutput) {
          stderr += chunk.toString('utf-8').slice(0, maxOutput - stderr.length);
        } else {
          truncated = true;
        }
      });

      // Timeout
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
      }, timeoutMs);

      // Cancel via AbortSignal
      if (signal) {
        signal.addEventListener('abort', () => {
          killed = true;
          child.kill('SIGTERM');
          setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
        }, { once: true });
      }

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? (killed ? 124 : -1),
          stdout,
          stderr: killed ? stderr + '\n[KILLED]' : stderr,
          durationMs: Date.now() - startTime,
          truncated,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(Object.assign(
          new Error(`SPAWN_ERROR: ${err.message}`),
          { code: 'SPAWN_ERROR' },
        ));
      });
    });
  }

  /**
   * Check git dirty tree.
   * Returns null if clean, or string with dirty files if dirty.
   */
  async function checkGitDirty() {
    try {
      const result = await execute('git', ['status', '--porcelain'], 'BUILD', {
        timeoutMs: 5000,
      });
      return result.stdout.trim() || null;
    } catch {
      return null; // Not a git repo or error — skip check
    }
  }

  return { execute, checkGitDirty };
}

/**
 * Strip secret env vars.
 */
function sanitizeEnv(env) {
  const safe = { ...env };
  const patterns = ['SECRET', 'TOKEN', 'KEY', 'PASSWORD', 'CREDENTIAL', 'AUTH', 'PRIVATE'];
  for (const key of Object.keys(safe)) {
    if (patterns.some(p => key.toUpperCase().includes(p))) {
      delete safe[key];
    }
  }
  return safe;
}


// ═══════════════════════════════════════════════════════════
// Audit Trail (for C3 backend)
// ═══════════════════════════════════════════════════════════

class AuditTrail {
  constructor() {
    this.seq = 0;
    this.stream = null;
  }

  async init(projectPath) {
    const logDir = path.join(projectPath, 'agent-log');
    await fs.ensureDir(logDir);

    const filePath = path.join(logDir, 'events.jsonl');

    // Resume seq from existing events
    if (await fs.pathExists(filePath)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l);
        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1]);
          this.seq = last.seq || 0;
        }
      } catch { /* ignore */ }
    }

    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  log(turnId, type, payload = {}) {
    if (!this.stream) return;
    const event = {
      seq: ++this.seq,
      turnId,
      type,
      ts: new Date().toISOString(),
      payload,
    };
    this.stream.write(JSON.stringify(event) + '\n');
  }

  async close() {
    if (this.stream) {
      return new Promise((resolve) => this.stream.end(resolve));
    }
  }
}


// ═══════════════════════════════════════════════════════════
// Project Store (for C3 backend)
// ═══════════════════════════════════════════════════════════

class ProjectStore {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.filePath = path.join(workspacePath, 'project.json');
    this.project = null;
  }

  async load() {
    if (!await fs.pathExists(this.filePath)) return null;

    try {
      this.project = await fs.readJson(this.filePath);

      // Schema migration
      if (!this.project.schema_version || this.project.schema_version < 1) {
        this.project.schema_version = 1;
        if (!this.project.context) {
          this.project.context = { stack: {}, decisions: [], current_sprint: 0, total_sprints: 0, design_turns: 0 };
        }
        if (!this.project.files) {
          this.project.files = {};
        }
        await this.save();
      }

      this.project.path = this.workspacePath;
      return this.project;
    } catch (err) {
      console.error('Failed to load project.json:', err.message);
      return null;
    }
  }

  async save() {
    if (!this.project) return;
    this.project.updated_at = new Date().toISOString();
    await atomicWriteJson(this.filePath, this.project);
  }

  async updatePhase(phase) {
    if (!this.project) return;
    this.project.phase = phase;
    await this.save();
  }
}

/**
 * Atomic JSON write: tmp → fsync → rename.
 */
async function atomicWriteJson(filePath, data) {
  const tmp = filePath + '.tmp';
  const bak = filePath + '.bak';
  const content = JSON.stringify(data, null, 2) + '\n';

  // Backup
  if (await fs.pathExists(filePath)) {
    try { await fs.copy(filePath, bak, { overwrite: true }); } catch { /* ok */ }
  }

  // Write + fsync + rename
  const fd = await fs.open(tmp, 'w');
  try {
    await fs.writeFile(fd, content, 'utf-8');
    await fs.fsync(fd);
  } finally {
    await fs.close(fd);
  }
  await fs.rename(tmp, filePath);
}


// ═══════════════════════════════════════════════════════════
// Combined Integration Example
// ═══════════════════════════════════════════════════════════

/**
 * Example: wire everything together in your C3 backend.
 *
 * const http = require('http');
 * const { createC3WebSocketServer } = require('./ws-server');        // Sprint 1
 * const { createShellExecutor, AuditTrail, ProjectStore } = require('./sprint2-integration');
 *
 * const projectRoot = '/path/to/workspace';
 * const shell = createShellExecutor(projectRoot);
 * const audit = new AuditTrail();
 * const store = new ProjectStore(projectRoot);
 *
 * await audit.init(projectRoot);
 * const project = await store.load();
 *
 * // In your conversation handler, use shell and audit:
 * const handler = {
 *   async handle(input, options = {}) {
 *     const { turnId, onToolCall, onToolResult } = options;
 *
 *     // Log to audit trail
 *     audit.log(turnId, 'cre_decision', { intent: 'BUILD', confidence: 0.9 });
 *
 *     // Execute shell command
 *     if (needsShell) {
 *       onToolCall?.('flutter', { args: ['test'] });
 *       audit.log(turnId, 'tool_call', { tool: 'flutter', args: ['test'] });
 *
 *       const result = await shell.execute('flutter', ['test'], 'BUILD', {
 *         signal: options.signal,
 *       });
 *
 *       audit.log(turnId, 'shell_exec', {
 *         command: 'flutter', args: ['test'],
 *         exitCode: result.exitCode, durationMs: result.durationMs,
 *       });
 *
 *       onToolResult?.('flutter', {
 *         success: result.exitCode === 0,
 *         durationMs: result.durationMs,
 *         summary: result.exitCode === 0 ? 'Tests passed' : 'Tests failed',
 *       });
 *     }
 *
 *     // Save project after turn
 *     await store.save();
 *
 *     return { content: '...', intent: 'BUILD', confidence: 0.9 };
 *   }
 * };
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await store.save();
 *   await audit.close();
 *   process.exit(0);
 * });
 */

module.exports = {
  createShellExecutor,
  AuditTrail,
  ProjectStore,
  atomicWriteJson,
  sanitizeEnv,
};
