/**
 * @c3/process-isolation — Bubblewrap Sandbox (node)
 *
 * Second defense layer (Layer 6) on top of argv-based spawn.
 * Uses bubblewrap (bwrap) on Linux for filesystem + PID isolation.
 *
 * Isolation features:
 *   - Read-only root filesystem (--ro-bind / /)
 *   - Read-write ONLY in project directory (--bind cwd cwd)
 *   - Isolated /tmp (--tmpfs /tmp)
 *   - PID namespace (--unshare-pid)
 *   - Optional network isolation (--unshare-net)
 *   - Die with parent (--die-with-parent)
 *
 * Fallback: If bwrap not available, falls back to plain argv spawn
 * (still safe due to Layers 1-5, but without filesystem isolation).
 *
 * Defense-in-depth layers:
 *   Layer 1: Command whitelist         ← shell-security
 *   Layer 2: Arg blacklist             ← shell-security
 *   Layer 3: argv spawn (shell:false)  ← shell-security
 *   Layer 4: cwd sandbox               ← shell-security
 *   Layer 5: env sanitization          ← shell-security
 *   Layer 6: bubblewrap isolation      ← THIS MODULE
 *   Layer 7: timeout SIGTERM/SIGKILL   ← shell-security
 */

import { execFile } from 'child_process';

// ─── Types ───────────────────────────────────────────────

export interface SandboxConfig {
  /** Allow network access (default: false for security) */
  allowNetwork: boolean;
  /** Additional read-only bind mounts */
  extraRoBinds: string[];
  /** Additional read-write bind mounts */
  extraRwBinds: string[];
  /** Custom tmpfs mounts */
  tmpfsMounts: string[];
  /** Unshare PID namespace (default: true) */
  unsharePid: boolean;
  /** Unshare user namespace (default: false, may require suid) */
  unshareUser: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  allowNetwork: false,
  extraRoBinds: [],
  extraRwBinds: [],
  tmpfsMounts: ['/tmp'],
  unsharePid: true,
  unshareUser: false,
};

export interface SandboxCapabilities {
  /** Whether bwrap is installed */
  bwrapAvailable: boolean;
  /** bwrap version string */
  bwrapVersion?: string;
  /** Whether user namespaces work */
  userNamespacesWork: boolean;
  /** OS platform */
  platform: string;
}

// ─── Sandbox Manager ─────────────────────────────────────

export class C3ProcessIsolation {

  private capabilities: SandboxCapabilities | null = null;

  /**
   * Probe system for sandbox capabilities.
   * Call once on startup, cache result.
   */
  async probeCapabilities(): Promise<SandboxCapabilities> {
    if (this.capabilities) return this.capabilities;

    const platform = process.platform;

    if (platform !== 'linux') {
      this.capabilities = {
        bwrapAvailable: false,
        userNamespacesWork: false,
        platform,
      };
      return this.capabilities;
    }

    // Check bwrap availability
    let bwrapAvailable = false;
    let bwrapVersion: string | undefined;

    try {
      const version = await execCommand('bwrap', ['--version']);
      bwrapAvailable = true;
      bwrapVersion = version.trim();
    } catch { /* not installed */ }

    // Check user namespace support
    let userNamespacesWork = false;
    if (bwrapAvailable) {
      try {
        await execCommand('bwrap', [
          '--unshare-user',
          '--ro-bind', '/', '/',
          '--', '/bin/true',
        ]);
        userNamespacesWork = true;
      } catch { /* user namespaces may be disabled */ }
    }

    this.capabilities = {
      bwrapAvailable,
      bwrapVersion,
      userNamespacesWork,
      platform,
    };

    return this.capabilities;
  }

  /**
   * Build bwrap arguments for sandboxed execution.
   *
   * @param command  The command to run (e.g. 'npm')
   * @param args     Arguments for the command
   * @param cwd      Working directory (will be writable)
   * @param config   Optional sandbox config overrides
   * @returns        Full argv array: ['bwrap', ...bwrapArgs, '--', command, ...args]
   */
  buildSandboxArgs(
    command: string,
    args: string[],
    cwd: string,
    config: Partial<SandboxConfig> = {},
  ): string[] {
    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const bwrapArgs: string[] = [];

    // Read-only root filesystem
    bwrapArgs.push('--ro-bind', '/', '/');

    // Read-write access ONLY to project directory
    bwrapArgs.push('--bind', cwd, cwd);

    // Extra read-only mounts
    for (const mount of cfg.extraRoBinds) {
      bwrapArgs.push('--ro-bind', mount, mount);
    }

    // Extra read-write mounts
    for (const mount of cfg.extraRwBinds) {
      bwrapArgs.push('--bind', mount, mount);
    }

    // tmpfs mounts
    for (const mount of cfg.tmpfsMounts) {
      bwrapArgs.push('--tmpfs', mount);
    }

    // /proc and /dev (needed by many tools)
    bwrapArgs.push('--proc', '/proc');
    bwrapArgs.push('--dev', '/dev');

    // Die with parent (prevents orphaned sandbox processes)
    bwrapArgs.push('--die-with-parent');

    // PID namespace isolation
    if (cfg.unsharePid) {
      bwrapArgs.push('--unshare-pid');
    }

    // User namespace
    if (cfg.unshareUser) {
      bwrapArgs.push('--unshare-user');
    }

    // Network isolation (default: no network for security)
    if (!cfg.allowNetwork) {
      bwrapArgs.push('--unshare-net');
    }

    // Separator + actual command
    bwrapArgs.push('--', command, ...args);

    return bwrapArgs;
  }

  /**
   * Determine the right execution strategy based on capabilities.
   *
   * Returns either:
   *   { sandboxed: true, command: 'bwrap', args: [...] }
   *   { sandboxed: false, command: originalCmd, args: originalArgs }
   */
  async resolveExecution(
    command: string,
    args: string[],
    cwd: string,
    config: Partial<SandboxConfig> = {},
  ): Promise<{
    sandboxed: boolean;
    command: string;
    args: string[];
  }> {
    const caps = await this.probeCapabilities();

    if (caps.bwrapAvailable) {
      // Determine if network is needed for this command
      const needsNetwork = this.commandNeedsNetwork(command, args);
      const sandboxConfig = {
        ...config,
        allowNetwork: config.allowNetwork ?? needsNetwork,
      };

      return {
        sandboxed: true,
        command: 'bwrap',
        args: this.buildSandboxArgs(command, args, cwd, sandboxConfig),
      };
    }

    // Fallback: no sandbox, rely on Layers 1-5
    return {
      sandboxed: false,
      command,
      args,
    };
  }

  /**
   * Heuristic: does this command need network access?
   * Conservative: only allow network for specific commands.
   */
  private commandNeedsNetwork(command: string, args: string[]): boolean {
    const networkCommands = new Set([
      'curl', 'wget', 'git', 'npm', 'yarn', 'pnpm', 'pip', 'pip3',
      'cargo', 'flutter',
    ]);

    if (!networkCommands.has(command)) return false;

    // For npm/yarn: only install/ci/audit need network
    if (command === 'npm' || command === 'yarn' || command === 'pnpm') {
      const sub = args[0];
      const needsNet = new Set(['install', 'ci', 'audit', 'outdated', 'info', 'pack']);
      return sub ? needsNet.has(sub) : false;
    }

    // For git: only clone/fetch/pull/push need network
    if (command === 'git') {
      const sub = args[0];
      const needsNet = new Set(['clone', 'fetch', 'pull', 'push', 'remote']);
      return sub ? needsNet.has(sub) : false;
    }

    return true;
  }

  /**
   * Generate a security report about sandbox capabilities.
   */
  async generateReport(): Promise<string> {
    const caps = await this.probeCapabilities();
    const lines: string[] = [
      '=== C3 Process Isolation Report ===',
      '',
      `Platform: ${caps.platform}`,
      `Bubblewrap: ${caps.bwrapAvailable ? '✅ ' + (caps.bwrapVersion || 'available') : '❌ not installed'}`,
      `User namespaces: ${caps.userNamespacesWork ? '✅ working' : '❌ not available'}`,
      '',
    ];

    if (caps.bwrapAvailable) {
      lines.push('Active isolation:');
      lines.push('  ✅ Read-only root filesystem');
      lines.push('  ✅ Project-dir-only write access');
      lines.push('  ✅ Isolated /tmp');
      lines.push('  ✅ PID namespace isolation');
      lines.push('  ✅ Die-with-parent');
      lines.push('  ✅ Network isolation (per-command heuristic)');
    } else {
      lines.push('⚠️  Bubblewrap not available. Relying on Layers 1-5 only.');
      if (caps.platform === 'linux') {
        lines.push('   Install: sudo apt install bubblewrap');
      } else {
        lines.push(`   Bubblewrap is Linux-only (current: ${caps.platform})`);
      }
    }

    lines.push('');
    lines.push('Defense layers active:');
    lines.push('  Layer 1: Command whitelist         ✅');
    lines.push('  Layer 2: Arg blacklist             ✅');
    lines.push('  Layer 3: argv spawn (shell:false)  ✅');
    lines.push('  Layer 4: cwd sandbox               ✅');
    lines.push('  Layer 5: env sanitization          ✅');
    lines.push(`  Layer 6: bubblewrap                ${caps.bwrapAvailable ? '✅' : '⚠️ (unavailable)'}`);
    lines.push('  Layer 7: timeout SIGTERM/SIGKILL   ✅');

    return lines.join('\n');
  }
}

// ─── Helper ──────────────────────────────────────────────

function execCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}
