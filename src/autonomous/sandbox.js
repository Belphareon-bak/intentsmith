// CRE v39.1 Sandbox
// ══════════════════════════════════════════════════════════════════════════════
//
// Isolated execution environment for autonomous goals.
//
// Sandbox Capabilities:
//   - Filesystem isolation (virtual FS or restricted paths)
//   - Network restrictions (allowlist-based)
//   - Process isolation (no shell exec)
//   - Resource limits enforcement
//
// Key Principle:
//   Sandboxed goals can only affect their isolated environment.
//   No side effects on real system unless explicitly allowed.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX MODES
// ════════════════════════════════════════════════════════════════════════════

export const SandboxMode = {
  DISABLED: 'disabled',       // No sandbox (full access)
  PERMISSIVE: 'permissive',   // Soft restrictions (logging only)
  RESTRICTED: 'restricted',   // Hard restrictions (blocked)
  ISOLATED: 'isolated',       // Full isolation (virtual FS)
};

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX RESTRICTIONS
// ════════════════════════════════════════════════════════════════════════════

export const DEFAULT_SANDBOX_RESTRICTIONS = {
  // Filesystem
  allowedPaths: ['/tmp', '/var/tmp'],   // Only allowed paths
  blockedPaths: ['/', '/etc', '/usr', '/home', '/root'],
  maxFileSize: 10 * 1024 * 1024,        // 10MB max file size
  allowWrite: true,
  allowDelete: false,

  // Network
  allowedDomains: ['*'],                // '*' = all allowed
  blockedDomains: [],
  allowedPorts: [80, 443],
  maxRequestsPerMinute: 30,

  // Process
  allowShellExec: false,
  allowedCommands: [],                  // Empty = none allowed
  blockedCommands: ['rm', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'su'],

  // Resources
  maxMemoryMB: 256,
  maxCpuPercent: 50,
  maxDurationMs: 300000,                // 5 minutes
};

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX VIOLATION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const SandboxViolation = {
  PATH_BLOCKED: 'PATH_BLOCKED',
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  PORT_BLOCKED: 'PORT_BLOCKED',
  COMMAND_BLOCKED: 'COMMAND_BLOCKED',
  SHELL_EXEC_BLOCKED: 'SHELL_EXEC_BLOCKED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  WRITE_BLOCKED: 'WRITE_BLOCKED',
  DELETE_BLOCKED: 'DELETE_BLOCKED',
  RATE_LIMIT: 'RATE_LIMIT',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
};

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX
// ════════════════════════════════════════════════════════════════════════════

export class Sandbox {
  constructor(options = {}) {
    this.mode = options.mode || SandboxMode.DISABLED;
    this.restrictions = { ...DEFAULT_SANDBOX_RESTRICTIONS, ...options.restrictions };

    // Usage tracking
    this.usage = {
      networkRequestsThisMinute: 0,
      minuteStart: Date.now(),
      filesWritten: [],
      bytesWritten: 0,
    };

    // Violation log
    this.violations = [];

    // Virtual filesystem (for ISOLATED mode)
    this.virtualFS = new Map();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FILESYSTEM CHECKS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if path access is allowed
   */
  checkPath(path, operation = 'read') {
    if (this.mode === SandboxMode.DISABLED) {
      return { allowed: true };
    }

    // Normalize path
    const normalizedPath = this.normalizePath(path);

    // Check blocked paths
    for (const blocked of this.restrictions.blockedPaths) {
      if (normalizedPath.startsWith(blocked)) {
        return this.deny(SandboxViolation.PATH_BLOCKED, `Path blocked: ${path}`);
      }
    }

    // Check allowed paths (if restrictive mode)
    if (this.mode === SandboxMode.RESTRICTED || this.mode === SandboxMode.ISOLATED) {
      const isAllowed = this.restrictions.allowedPaths.some(
        allowed => normalizedPath.startsWith(allowed)
      );
      if (!isAllowed) {
        return this.deny(SandboxViolation.PATH_BLOCKED, `Path not in allowlist: ${path}`);
      }
    }

    // Check write operation
    if (operation === 'write' && !this.restrictions.allowWrite) {
      return this.deny(SandboxViolation.WRITE_BLOCKED, 'Write operations blocked');
    }

    // Check delete operation
    if (operation === 'delete' && !this.restrictions.allowDelete) {
      return this.deny(SandboxViolation.DELETE_BLOCKED, 'Delete operations blocked');
    }

    return { allowed: true };
  }

  /**
   * Check file size
   */
  checkFileSize(size) {
    if (this.mode === SandboxMode.DISABLED) {
      return { allowed: true };
    }

    if (size > this.restrictions.maxFileSize) {
      return this.deny(SandboxViolation.FILE_TOO_LARGE, `File too large: ${size} > ${this.restrictions.maxFileSize}`);
    }

    return { allowed: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // NETWORK CHECKS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if URL is allowed
   */
  checkUrl(url) {
    if (this.mode === SandboxMode.DISABLED) {
      return { allowed: true };
    }

    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;
      const port = parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);

      // Check blocked domains
      for (const blocked of this.restrictions.blockedDomains) {
        if (this.matchDomain(domain, blocked)) {
          return this.deny(SandboxViolation.DOMAIN_BLOCKED, `Domain blocked: ${domain}`);
        }
      }

      // Check allowed domains (if not '*')
      if (!this.restrictions.allowedDomains.includes('*')) {
        const isAllowed = this.restrictions.allowedDomains.some(
          allowed => this.matchDomain(domain, allowed)
        );
        if (!isAllowed) {
          return this.deny(SandboxViolation.DOMAIN_BLOCKED, `Domain not in allowlist: ${domain}`);
        }
      }

      // Check allowed ports
      if (!this.restrictions.allowedPorts.includes(port)) {
        return this.deny(SandboxViolation.PORT_BLOCKED, `Port not allowed: ${port}`);
      }

      // Check rate limit
      this.resetMinuteCounterIfNeeded();
      if (this.usage.networkRequestsThisMinute >= this.restrictions.maxRequestsPerMinute) {
        return this.deny(SandboxViolation.RATE_LIMIT, 'Network rate limit exceeded');
      }

      return { allowed: true };
    } catch (e) {
      return this.deny(SandboxViolation.DOMAIN_BLOCKED, `Invalid URL: ${url}`);
    }
  }

  /**
   * Record network request
   */
  recordNetworkRequest() {
    this.usage.networkRequestsThisMinute++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COMMAND CHECKS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if command execution is allowed
   */
  checkCommand(command) {
    if (this.mode === SandboxMode.DISABLED) {
      return { allowed: true };
    }

    // Shell exec disabled?
    if (!this.restrictions.allowShellExec) {
      return this.deny(SandboxViolation.SHELL_EXEC_BLOCKED, 'Shell execution disabled');
    }

    // Extract base command
    const baseCommand = this.extractBaseCommand(command);

    // Check blocked commands
    if (this.restrictions.blockedCommands.includes(baseCommand)) {
      return this.deny(SandboxViolation.COMMAND_BLOCKED, `Command blocked: ${baseCommand}`);
    }

    // Check allowed commands (if specified)
    if (this.restrictions.allowedCommands.length > 0) {
      if (!this.restrictions.allowedCommands.includes(baseCommand)) {
        return this.deny(SandboxViolation.COMMAND_BLOCKED, `Command not in allowlist: ${baseCommand}`);
      }
    }

    return { allowed: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIRTUAL FILESYSTEM (for ISOLATED mode)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Read from virtual filesystem
   */
  virtualRead(path) {
    if (this.mode !== SandboxMode.ISOLATED) {
      return { success: false, error: 'Virtual FS only available in ISOLATED mode' };
    }

    const content = this.virtualFS.get(path);
    if (content === undefined) {
      return { success: false, error: 'File not found' };
    }

    return { success: true, content };
  }

  /**
   * Write to virtual filesystem
   */
  virtualWrite(path, content) {
    if (this.mode !== SandboxMode.ISOLATED) {
      return { success: false, error: 'Virtual FS only available in ISOLATED mode' };
    }

    const check = this.checkPath(path, 'write');
    if (!check.allowed) {
      return { success: false, error: check.reason };
    }

    const sizeCheck = this.checkFileSize(content.length);
    if (!sizeCheck.allowed) {
      return { success: false, error: sizeCheck.reason };
    }

    this.virtualFS.set(path, content);
    this.usage.filesWritten.push(path);
    this.usage.bytesWritten += content.length;

    return { success: true };
  }

  /**
   * Delete from virtual filesystem
   */
  virtualDelete(path) {
    if (this.mode !== SandboxMode.ISOLATED) {
      return { success: false, error: 'Virtual FS only available in ISOLATED mode' };
    }

    const check = this.checkPath(path, 'delete');
    if (!check.allowed) {
      return { success: false, error: check.reason };
    }

    this.virtualFS.delete(path);
    return { success: true };
  }

  /**
   * List virtual filesystem
   */
  virtualList(path = '/') {
    if (this.mode !== SandboxMode.ISOLATED) {
      return [];
    }

    return Array.from(this.virtualFS.keys()).filter(
      p => p.startsWith(path)
    );
  }

  /**
   * Clear virtual filesystem
   */
  virtualClear() {
    this.virtualFS.clear();
    this.usage.filesWritten = [];
    this.usage.bytesWritten = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Deny action and log violation
   */
  deny(violation, reason) {
    const entry = {
      type: violation,
      reason,
      timestamp: Date.now(),
      mode: this.mode,
    };

    this.violations.push(entry);

    // Trim violations log
    if (this.violations.length > 100) {
      this.violations = this.violations.slice(-100);
    }

    // In permissive mode, allow but warn
    if (this.mode === SandboxMode.PERMISSIVE) {
      logger.warn('Sandbox', `PERMISSIVE: ${violation}`, { reason });
      return { allowed: true, warning: reason };
    }

    logger.warn('Sandbox', `BLOCKED: ${violation}`, { reason });
    return { allowed: false, violation, reason };
  }

  /**
   * Normalize path
   */
  normalizePath(path) {
    // Remove .. and resolve
    return path.replace(/\.\./g, '').replace(/\/+/g, '/');
  }

  /**
   * Match domain pattern
   */
  matchDomain(domain, pattern) {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      return domain.endsWith(pattern.slice(1));
    }
    return domain === pattern;
  }

  /**
   * Extract base command from command string
   */
  extractBaseCommand(command) {
    const parts = command.trim().split(/\s+/);
    const base = parts[0];
    // Handle paths like /usr/bin/rm
    return base.split('/').pop();
  }

  /**
   * Reset minute counter if needed
   */
  resetMinuteCounterIfNeeded() {
    const now = Date.now();
    if (now - this.usage.minuteStart > 60000) {
      this.usage.networkRequestsThisMinute = 0;
      this.usage.minuteStart = now;
    }
  }

  /**
   * Set sandbox mode
   */
  setMode(mode) {
    if (!Object.values(SandboxMode).includes(mode)) {
      throw new Error(`Invalid sandbox mode: ${mode}`);
    }
    this.mode = mode;
    logger.debug('Sandbox', `Mode set to: ${mode}`);
  }

  /**
   * Get violations
   */
  getViolations(limit = 20) {
    return this.violations.slice(-limit);
  }

  /**
   * Get usage stats
   */
  getUsage() {
    return {
      mode: this.mode,
      networkRequestsThisMinute: this.usage.networkRequestsThisMinute,
      filesWritten: this.usage.filesWritten.length,
      bytesWritten: this.usage.bytesWritten,
      virtualFSSize: this.virtualFS.size,
    };
  }

  /**
   * Reset sandbox state
   */
  reset() {
    this.usage = {
      networkRequestsThisMinute: 0,
      minuteStart: Date.now(),
      filesWritten: [],
      bytesWritten: 0,
    };
    this.virtualClear();
    logger.debug('Sandbox', 'Sandbox reset');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const sandbox = new Sandbox();

export default Sandbox;
