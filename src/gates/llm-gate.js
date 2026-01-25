// CRE v38.3.1 LLM Gate
// ══════════════════════════════════════════════════════════════════════════════
//
// Authorization gate for LLM reflection.
// Controls when/if LLM can be used for plan reflection.
//
// Key principle:
//   LLM is a TOOL, not an authority.
//   LLM reflection is OPTIONAL and GATED.
//   LLM never changes plan directly — only returns recommendations.
//
// Authorization levels:
//   DISABLED    — LLM reflection completely off (v38.3.1: DEFAULT)
//   GATED       — LLM reflection requires explicit user approval per use
//   AUTO        — LLM reflection allowed automatically (trusted user)
//
// v38.3.1: DISABLED by default until v39.2+
//   - LLM reflection not useful without self-metrics
//   - Adds complexity, complicates debugging
//   - Enable manually when needed
//
// Rate limiting:
//   Prevents runaway LLM costs by limiting reflection calls per plan/session.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION LEVELS
// ════════════════════════════════════════════════════════════════════════════

export const LLMAuthLevel = {
  DISABLED: 'DISABLED',   // LLM reflection completely off
  GATED: 'GATED',         // Requires explicit approval per use
  AUTO: 'AUTO',           // Allowed automatically
};

// ════════════════════════════════════════════════════════════════════════════
// LLM GATE
// ════════════════════════════════════════════════════════════════════════════

export class LLMGate {
  constructor(options = {}) {
    // v38.3.1: DISABLED by default — enable explicitly when needed
    this.authLevel = options.authLevel || LLMAuthLevel.DISABLED;

    // Rate limiting
    this.maxCallsPerPlan = options.maxCallsPerPlan || 3;
    this.maxCallsPerSession = options.maxCallsPerSession || 20;

    // Usage tracking
    this.sessionCalls = 0;
    this.planCalls = new Map(); // planId → count

    // Pending approvals (for GATED mode)
    this.pendingApprovals = new Map(); // requestId → { resolve, reject, context }
    this.approvedForSession = false;

    // Audit log
    this.auditLog = [];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUTHORIZATION CHECK
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if LLM reflection is authorized
   *
   * @param {Object} context - Reflection context
   * @param {string} context.planId - Current plan ID
   * @param {string} context.stepId - Failed step ID
   * @param {string} context.reason - Why LLM reflection is requested
   * @returns {{ authorized: boolean, reason?: string, needsApproval?: boolean }}
   */
  check(context = {}) {
    const { planId, stepId, reason } = context;

    // 1. Check global authorization level
    if (this.authLevel === LLMAuthLevel.DISABLED) {
      this.log('BLOCKED', context, 'LLM reflection is disabled');
      return { authorized: false, reason: 'LLM reflection disabled' };
    }

    // 2. Check rate limits
    const sessionLimitCheck = this.checkSessionLimit();
    if (!sessionLimitCheck.ok) {
      this.log('RATE_LIMITED', context, 'Session limit exceeded');
      return { authorized: false, reason: sessionLimitCheck.reason };
    }

    if (planId) {
      const planLimitCheck = this.checkPlanLimit(planId);
      if (!planLimitCheck.ok) {
        this.log('RATE_LIMITED', context, 'Plan limit exceeded');
        return { authorized: false, reason: planLimitCheck.reason };
      }
    }

    // 3. Check authorization mode
    if (this.authLevel === LLMAuthLevel.AUTO) {
      this.log('AUTO_ALLOWED', context);
      return { authorized: true };
    }

    // 4. GATED mode — check if approved
    if (this.approvedForSession) {
      this.log('SESSION_APPROVED', context);
      return { authorized: true };
    }

    // Needs user approval
    this.log('APPROVAL_REQUIRED', context);
    return {
      authorized: false,
      needsApproval: true,
      reason: 'LLM reflection requires user approval',
      question: this.buildApprovalQuestion(context),
    };
  }

  /**
   * Build approval question for user
   */
  buildApprovalQuestion(context) {
    return {
      type: 'LLM_REFLECTION_APPROVAL',
      message: `Mohu použít LLM pro analýzu selhání kroku ${context.stepId}?`,
      context: {
        stepId: context.stepId,
        reason: context.reason,
        estimatedCost: 'nízká',
      },
      options: ['Ano, jednorázově', 'Ano, pro celou session', 'Ne'],
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // APPROVAL HANDLING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Approve LLM reflection
   *
   * @param {string} scope - 'once' | 'session'
   */
  approve(scope = 'once') {
    if (scope === 'session') {
      this.approvedForSession = true;
      this.log('APPROVED_SESSION', {});
      logger.debug('LLMGate', 'LLM reflection approved for session');
    } else {
      this.log('APPROVED_ONCE', {});
      logger.debug('LLMGate', 'LLM reflection approved (single use)');
    }
  }

  /**
   * Deny LLM reflection request
   */
  deny() {
    this.log('DENIED_BY_USER', {});
    logger.debug('LLMGate', 'LLM reflection denied by user');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RATE LIMITING
  // ──────────────────────────────────────────────────────────────────────────

  checkSessionLimit() {
    if (this.sessionCalls >= this.maxCallsPerSession) {
      return { ok: false, reason: `Session LLM limit reached (${this.maxCallsPerSession})` };
    }
    return { ok: true };
  }

  checkPlanLimit(planId) {
    const count = this.planCalls.get(planId) || 0;
    if (count >= this.maxCallsPerPlan) {
      return { ok: false, reason: `Plan LLM limit reached (${this.maxCallsPerPlan})` };
    }
    return { ok: true };
  }

  /**
   * Record an LLM call (for rate limiting)
   */
  recordCall(planId) {
    this.sessionCalls++;
    if (planId) {
      const count = this.planCalls.get(planId) || 0;
      this.planCalls.set(planId, count + 1);
    }
    logger.debug('LLMGate', `LLM call recorded`, {
      session: this.sessionCalls,
      plan: planId ? this.planCalls.get(planId) : 'n/a',
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set authorization level
   */
  setAuthLevel(level) {
    if (!Object.values(LLMAuthLevel).includes(level)) {
      throw new Error(`Invalid LLM auth level: ${level}`);
    }
    this.authLevel = level;
    logger.debug('LLMGate', `Auth level set to: ${level}`);
  }

  /**
   * Enable LLM reflection (shorthand for setAuthLevel(AUTO))
   */
  enable() {
    this.setAuthLevel(LLMAuthLevel.AUTO);
  }

  /**
   * Disable LLM reflection (shorthand for setAuthLevel(DISABLED))
   */
  disable() {
    this.setAuthLevel(LLMAuthLevel.DISABLED);
  }

  /**
   * Check if LLM reflection is globally enabled
   */
  isEnabled() {
    return this.authLevel !== LLMAuthLevel.DISABLED;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SESSION MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reset for new plan
   */
  resetPlan(planId) {
    if (planId) {
      this.planCalls.delete(planId);
    }
  }

  /**
   * Reset session state
   */
  resetSession() {
    this.sessionCalls = 0;
    this.planCalls.clear();
    this.pendingApprovals.clear();
    this.approvedForSession = false;
    logger.debug('LLMGate', 'Session reset');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS & AUDIT
  // ──────────────────────────────────────────────────────────────────────────

  getStats() {
    return {
      authLevel: this.authLevel,
      enabled: this.isEnabled(),
      sessionCalls: this.sessionCalls,
      maxCallsPerSession: this.maxCallsPerSession,
      maxCallsPerPlan: this.maxCallsPerPlan,
      approvedForSession: this.approvedForSession,
      recentAudit: this.auditLog.slice(-20),
    };
  }

  log(event, context, reason = null) {
    this.auditLog.push({
      timestamp: Date.now(),
      event,
      context: {
        planId: context.planId,
        stepId: context.stepId,
      },
      reason,
    });
    if (this.auditLog.length > 200) {
      this.auditLog = this.auditLog.slice(-200);
    }
  }
}

// Singleton
export const llmGate = new LLMGate();

export default LLMGate;
