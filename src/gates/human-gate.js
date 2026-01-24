// CRE v36.9.3 HumanGate
// ══════════════════════════════════════════════════════════════════════════════
//
// Permission gate for tool execution.
// Decides whether a tool call can proceed automatically or needs user confirmation.
//
// Permission levels:
//   AUTO       - Execute immediately, no confirmation needed
//   CONFIRM_ONCE - Ask once per session, then auto for the rest
//   ALWAYS_ASK - Always ask before executing
//
// Stop-condition:
//   toolCall('fs.write', { path, content }) → HumanGate.check()
//   → { gated: true, reason: 'CONFIRM_REQUIRED', tool: 'fs.write' }
//   → Executor returns ASK_USER decision instead of executing
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// PERMISSION LEVELS
// ════════════════════════════════════════════════════════════════════════════

export const GateLevel = {
  AUTO: 'AUTO',             // No confirmation needed
  CONFIRM_ONCE: 'CONFIRM_ONCE', // Ask once, then auto
  ALWAYS_ASK: 'ALWAYS_ASK',     // Always ask
};

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT POLICY — which tools need what level of confirmation
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_POLICY = {
  // Web tools: read-only, safe
  'web.search': GateLevel.AUTO,
  'web.fetch': GateLevel.AUTO,
  'web.scrape': GateLevel.AUTO,

  // Data tools: in-memory, safe
  'data.parse': GateLevel.AUTO,
  'data.compare': GateLevel.AUTO,
  'data.merge': GateLevel.AUTO,
  'data.filter': GateLevel.AUTO,

  // Memory tools: safe
  'memory.recall': GateLevel.AUTO,
  'memory.store': GateLevel.AUTO,

  // FS read: safe
  'fs.read': GateLevel.AUTO,
  'fs.list': GateLevel.AUTO,

  // FS write: needs confirmation
  'fs.write': GateLevel.CONFIRM_ONCE,
  'fs.delete': GateLevel.ALWAYS_ASK,

  // Git: confirm destructive ops
  'git.status': GateLevel.AUTO,
  'git.diff': GateLevel.AUTO,
  'git.commit': GateLevel.CONFIRM_ONCE,
  'git.push': GateLevel.ALWAYS_ASK,

  // Shell: always dangerous
  'shell.exec': GateLevel.ALWAYS_ASK,

  // Artifacts: confirm generation
  'artifact.pdf': GateLevel.CONFIRM_ONCE,
  'artifact.docx': GateLevel.CONFIRM_ONCE,
  'artifact.xlsx': GateLevel.CONFIRM_ONCE,
  'artifact.html': GateLevel.CONFIRM_ONCE,

  // Cache: safe
  'cache.get': GateLevel.AUTO,
  'cache.set': GateLevel.AUTO,
};

// ════════════════════════════════════════════════════════════════════════════
// HUMAN GATE
// ════════════════════════════════════════════════════════════════════════════

export class HumanGate {
  constructor(options = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.confirmed = new Set(); // Tools confirmed this session (for CONFIRM_ONCE)
    this.denied = new Set();    // Tools explicitly denied this session
    this.auditLog = [];
  }

  /**
   * Check if a tool call can proceed
   *
   * @param {string} toolName
   * @param {Object} params - Tool params (for context in confirmation message)
   * @returns {{ allowed: boolean, gated?: boolean, reason?: string, tool?: string, params?: Object }}
   */
  check(toolName, params = {}) {
    const level = this.policy[toolName] || GateLevel.CONFIRM_ONCE; // Default: confirm unknown tools

    // Explicitly denied this session
    if (this.denied.has(toolName)) {
      this.log('DENIED', toolName, params);
      return { allowed: false, gated: true, reason: 'DENIED_THIS_SESSION', tool: toolName };
    }

    switch (level) {
      case GateLevel.AUTO:
        this.log('AUTO_ALLOWED', toolName, params);
        return { allowed: true };

      case GateLevel.CONFIRM_ONCE:
        if (this.confirmed.has(toolName)) {
          this.log('PREVIOUSLY_CONFIRMED', toolName, params);
          return { allowed: true };
        }
        this.log('CONFIRM_REQUIRED', toolName, params);
        return { allowed: false, gated: true, reason: 'CONFIRM_REQUIRED', tool: toolName, params };

      case GateLevel.ALWAYS_ASK:
        this.log('CONFIRM_REQUIRED', toolName, params);
        return { allowed: false, gated: true, reason: 'CONFIRM_REQUIRED', tool: toolName, params };

      default:
        this.log('UNKNOWN_LEVEL', toolName, params);
        return { allowed: false, gated: true, reason: 'CONFIRM_REQUIRED', tool: toolName, params };
    }
  }

  /**
   * Confirm a tool for this session
   * After confirmation, CONFIRM_ONCE tools won't ask again
   */
  confirm(toolName) {
    this.confirmed.add(toolName);
    this.denied.delete(toolName);
    this.log('CONFIRMED', toolName);
    logger.debug('HumanGate', `Confirmed: ${toolName}`);
  }

  /**
   * Deny a tool for this session
   */
  deny(toolName) {
    this.denied.add(toolName);
    this.confirmed.delete(toolName);
    this.log('DENIED_BY_USER', toolName);
    logger.debug('HumanGate', `Denied: ${toolName}`);
  }

  /**
   * Set gate level for a tool
   */
  setLevel(toolName, level) {
    if (!Object.values(GateLevel).includes(level)) {
      throw new Error(`Invalid gate level: ${level}`);
    }
    this.policy[toolName] = level;
  }

  /**
   * Get current policy for a tool
   */
  getLevel(toolName) {
    return this.policy[toolName] || GateLevel.CONFIRM_ONCE;
  }

  /**
   * Reset session state (confirmations/denials)
   */
  resetSession() {
    this.confirmed.clear();
    this.denied.clear();
    logger.debug('HumanGate', 'Session reset');
  }

  /**
   * Get gate stats
   */
  getStats() {
    return {
      confirmed: [...this.confirmed],
      denied: [...this.denied],
      policyEntries: Object.keys(this.policy).length,
      recentGates: this.auditLog.slice(-20),
    };
  }

  log(event, tool, params = {}) {
    this.auditLog.push({
      timestamp: Date.now(),
      event,
      tool,
      paramKeys: Object.keys(params),
    });
    if (this.auditLog.length > 200) {
      this.auditLog = this.auditLog.slice(-200);
    }
  }
}

// Singleton
export const humanGate = new HumanGate();

export default HumanGate;
