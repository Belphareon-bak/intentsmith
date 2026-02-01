// Sandboxed Tool Executor
// ══════════════════════════════════════════════════════════════════════════════
//
// Executes tools with:
// - Capability checking (does tool have permission?)
// - Scope validation (is path/URL allowed?)
// - Dry-run mode (simulate without side effects)
// - Approval gate integration
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  getToolCapabilities,
  requiresApproval,
  hasSideEffects,
  supportsDryRun,
  isPathAllowed,
  Capability,
  RiskLevel,
} from './capabilities.js';
import { toolExecutor } from '../tools/executor.js';
import { humanGate } from '../gates/human-gate.js';
import { auditTrail, AuditAction } from '../audit/trail.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX MODES
// ════════════════════════════════════════════════════════════════════════════

export const SandboxMode = {
  STRICT: 'strict',       // All dangerous ops need approval + dry-run first
  NORMAL: 'normal',       // Approval for dangerous ops
  PERMISSIVE: 'permissive', // Auto-approve most ops
  DRY_RUN: 'dry_run',     // Never execute, only simulate
};

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX EXECUTOR
// ════════════════════════════════════════════════════════════════════════════

class SandboxedExecutor {
  constructor(options = {}) {
    this.mode = options.mode || SandboxMode.NORMAL;
    this.grantedCapabilities = new Set(options.capabilities || [
      Capability.NET_HTTP_GET,
      Capability.MEM_READ,
      Capability.MEM_WRITE,
    ]);
    this.approvedTools = new Set();  // Tools that have been approved in this session
    this.dryRunResults = new Map();  // Cache of dry-run results
  }

  /**
   * Execute a tool with sandbox enforcement
   *
   * @param {Object} decision - Tool call decision
   * @param {string} decision.tool - Tool name
   * @param {Object} decision.params - Tool parameters
   * @param {Object} [options]
   * @param {string} [options.plan_id] - Plan ID for audit
   * @param {boolean} [options.forceDryRun] - Force dry-run mode
   * @param {boolean} [options.skipApproval] - Skip approval (use with caution)
   * @returns {Promise<SandboxResult>}
   */
  async execute(decision, options = {}) {
    const { tool, params = {} } = decision;
    const { plan_id, forceDryRun = false, skipApproval = false } = options;

    const caps = getToolCapabilities(tool);
    const startTime = Date.now();

    // ────────────────────────────────────────────────────────────────────────
    // 1. CHECK TOOL EXISTS
    // ────────────────────────────────────────────────────────────────────────

    if (!caps) {
      logger.warn('Sandbox', `Unknown tool: ${tool}`);
      return this.errorResult('UNKNOWN_TOOL', `Tool "${tool}" not in capability manifest`, startTime);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. CHECK CAPABILITIES
    // ────────────────────────────────────────────────────────────────────────

    const missingCaps = caps.requires.filter(c => !this.grantedCapabilities.has(c));
    if (missingCaps.length > 0) {
      logger.warn('Sandbox', `Missing capabilities for ${tool}: ${missingCaps.join(', ')}`);

      auditTrail.log({
        plan_id,
        actor: 'sandbox',
        action: AuditAction.TOOL_GATED,
        payload: { tool, reason: 'missing_capabilities', missing: missingCaps },
      });

      return this.errorResult('CAPABILITY_DENIED', `Missing capabilities: ${missingCaps.join(', ')}`, startTime);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. CHECK SCOPE (for FS tools)
    // ────────────────────────────────────────────────────────────────────────

    if (params.path && !isPathAllowed(tool, params.path)) {
      logger.warn('Sandbox', `Path outside scope for ${tool}: ${params.path}`);

      auditTrail.log({
        plan_id,
        actor: 'sandbox',
        action: AuditAction.TOOL_GATED,
        payload: { tool, reason: 'path_outside_scope', path: params.path },
      });

      return this.errorResult('SCOPE_DENIED', `Path "${params.path}" is outside allowed scope`, startTime);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. DETERMINE IF APPROVAL NEEDED
    // ────────────────────────────────────────────────────────────────────────

    const needsApproval = this.needsApproval(tool, caps, skipApproval);
    const dryRun = forceDryRun || this.mode === SandboxMode.DRY_RUN ||
                   (this.mode === SandboxMode.STRICT && hasSideEffects(tool));

    // ────────────────────────────────────────────────────────────────────────
    // 5. DRY-RUN MODE
    // ────────────────────────────────────────────────────────────────────────

    if (dryRun) {
      if (!supportsDryRun(tool)) {
        return this.errorResult('DRY_RUN_UNSUPPORTED', `Tool "${tool}" does not support dry-run`, startTime);
      }

      logger.info('Sandbox', `DRY-RUN: ${tool}`, { params: Object.keys(params) });

      auditTrail.log({
        plan_id,
        actor: 'sandbox',
        action: AuditAction.TOOL_CALLED,
        payload: { tool, params, dry_run: true },
      });

      const dryResult = this.simulateDryRun(tool, params);

      auditTrail.log({
        plan_id,
        actor: 'sandbox',
        action: AuditAction.TOOL_RESULT,
        payload: { tool, dry_run: true, simulated: true },
      });

      return {
        ok: true,
        dry_run: true,
        simulated: dryResult,
        tool,
        params,
        duration_ms: Date.now() - startTime,
      };
    }

    // ────────────────────────────────────────────────────────────────────────
    // 6. APPROVAL GATE
    // ────────────────────────────────────────────────────────────────────────

    if (needsApproval && !this.approvedTools.has(tool)) {
      const gateResult = humanGate.check(tool, params);

      if (!gateResult.allowed) {
        logger.info('Sandbox', `Tool gated: ${tool}`, { reason: gateResult.reason });

        auditTrail.log({
          plan_id,
          actor: 'sandbox',
          action: AuditAction.GATE_REQUESTED,
          payload: { tool, params },
        });

        return {
          ok: false,
          gated: true,
          tool,
          params,
          reason: gateResult.reason,
          duration_ms: Date.now() - startTime,
        };
      }

      // Mark as approved for this session
      this.approvedTools.add(tool);

      auditTrail.log({
        plan_id,
        actor: 'sandbox',
        action: AuditAction.GATE_APPROVED,
        payload: { tool },
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 7. EXECUTE
    // ────────────────────────────────────────────────────────────────────────

    auditTrail.log({
      plan_id,
      actor: 'sandbox',
      action: AuditAction.TOOL_CALLED,
      payload: { tool, params, dry_run: false },
    });

    const result = await toolExecutor.execute(decision, {
      skipGate: true, // We already handled the gate
    });

    auditTrail.log({
      plan_id,
      actor: 'sandbox',
      action: result.ok ? AuditAction.TOOL_RESULT : AuditAction.TOOL_ERROR,
      payload: { tool, ok: result.ok, error: result.error },
    });

    return {
      ...result,
      dry_run: false,
    };
  }

  /**
   * Check if tool needs approval
   */
  needsApproval(tool, caps, skipApproval) {
    if (skipApproval) return false;
    if (this.mode === SandboxMode.PERMISSIVE) return false;
    if (this.approvedTools.has(tool)) return false;

    return requiresApproval(tool) ||
           (this.mode === SandboxMode.STRICT && hasSideEffects(tool));
  }

  /**
   * Simulate dry-run result
   */
  simulateDryRun(tool, params) {
    switch (tool) {
      case 'fs.write':
        return {
          would_write: true,
          path: params.path,
          content_length: params.content?.length || 0,
        };

      case 'fs.read':
        return {
          would_read: true,
          path: params.path,
        };

      case 'web.search':
        return {
          would_search: true,
          query: params.query,
          max_results: params.maxResults || 5,
        };

      case 'web.fetch':
        return {
          would_fetch: true,
          url: params.url,
        };

      case 'memory.store':
        return {
          would_store: true,
          key: params.key,
          value_preview: JSON.stringify(params.value).substring(0, 50),
        };

      default:
        return {
          tool,
          params,
          message: 'Dry-run simulation - no actual execution',
        };
    }
  }

  /**
   * Create error result
   */
  errorResult(code, message, startTime) {
    return {
      ok: false,
      error: message,
      code,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Grant capability
   */
  grantCapability(capability) {
    this.grantedCapabilities.add(capability);
    logger.info('Sandbox', `Granted capability: ${capability}`);
  }

  /**
   * Revoke capability
   */
  revokeCapability(capability) {
    this.grantedCapabilities.delete(capability);
    logger.info('Sandbox', `Revoked capability: ${capability}`);
  }

  /**
   * Approve tool for session
   */
  approveTool(tool) {
    this.approvedTools.add(tool);
    logger.info('Sandbox', `Approved tool: ${tool}`);
  }

  /**
   * Reset approvals
   */
  resetApprovals() {
    this.approvedTools.clear();
    logger.info('Sandbox', 'Approvals reset');
  }

  /**
   * Set sandbox mode
   */
  setMode(mode) {
    this.mode = mode;
    logger.info('Sandbox', `Mode set to: ${mode}`);
  }

  /**
   * Get sandbox status
   */
  getStatus() {
    return {
      mode: this.mode,
      grantedCapabilities: Array.from(this.grantedCapabilities),
      approvedTools: Array.from(this.approvedTools),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

// Named exports
export { SandboxedExecutor };
export const sandboxedExecutor = new SandboxedExecutor();

export default {
  SandboxedExecutor,
  sandboxedExecutor,
  SandboxMode,
};
