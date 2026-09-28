// Safety Integration v50.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Integrates A3 (Safety) with D1.5 (Epistemic) and downstream layers.
//
// Pipeline Position:
//   User Input
//     → D1.5 Epistemic Control Layer (gatekeeper)
//     → A3 Safety Layer (normative gate)
//     → D6 Conversation Strategy Layer
//     → D2 Decision Layer
//     → D5 Runtime Quality Injection
//     → Response
//
// Key Rules:
//   - A3 runs AFTER D1.5 (epistemic state is read-only)
//   - A3 runs BEFORE D2 (can block or restrict D2)
//   - If A3 returns REFUSE → D2 is bypassed entirely
//   - If A3 returns RESTRICT → D2 can only ASK / CHALLENGE
//   - A3 NEVER calls tools
//
// ══════════════════════════════════════════════════════════════════════════════

import { SafetyEngine, SafetyAction, SafetyDomain } from './engine.js';
import { GeneralPolicy } from './policies/general.js';
import { FinancePolicy } from './policies/finance.js';
import { LawPolicy } from './policies/law.js';
import { HealthPolicy } from './policies/health.js';

// ════════════════════════════════════════════════════════════════════════════
// SAFETY LAYER RUNTIME
// ════════════════════════════════════════════════════════════════════════════

/**
 * Combined runtime for Epistemic + Safety layers
 */
export class SafetyLayerRuntime {
  constructor(config = {}) {
    this.config = {
      strictMode: config.strictMode ?? true,
    };

    // Initialize safety engine with all policies
    this.safetyEngine = new SafetyEngine(config);
    this.registerPolicies();
  }

  /**
   * Register all domain policies
   */
  registerPolicies() {
    this.safetyEngine.registerPolicy(SafetyDomain.GENERAL, GeneralPolicy);
    this.safetyEngine.registerPolicy(SafetyDomain.FINANCE, FinancePolicy);
    this.safetyEngine.registerPolicy(SafetyDomain.LAW, LawPolicy);
    this.safetyEngine.registerPolicy(SafetyDomain.HEALTH, HealthPolicy);
  }

  /**
   * Process a query through the safety layer
   *
   * Called AFTER D1.5, BEFORE D6/D2
   *
   * @param {Object} params
   * @param {string} params.query - User query
   * @param {Object} params.context - Conversation context
   * @param {Object} params.epistemicDecision - D1.5 decision (read-only)
   * @returns {Object} Combined safety result
   */
  process({ query, context = {}, epistemicDecision = null }) {
    // Evaluate safety
    const safetyVerdict = this.safetyEngine.evaluate({
      query,
      context,
      epistemic: epistemicDecision,
    });

    // Determine D2 constraints
    const d2Constraints = this.buildD2Constraints(safetyVerdict);

    return {
      // Safety verdict
      safety: {
        action: safetyVerdict.action,
        domain: safetyVerdict.domain,
        reason_code: safetyVerdict.reason_code,
      },

      // D2 constraints
      d2: d2Constraints,

      // If REFUSE, include the response
      response: safetyVerdict.action === SafetyAction.REFUSE
        ? this.safetyEngine.formatRefusalResponse(safetyVerdict)
        : null,

      // Full verdict for audit
      verdict: safetyVerdict,
    };
  }

  /**
   * Build D2 constraints based on safety verdict
   */
  buildD2Constraints(verdict) {
    if (verdict.action === SafetyAction.ALLOW) {
      return {
        bypass: false,
        allowed_actions: null, // All actions allowed
        message: null,
      };
    }

    if (verdict.action === SafetyAction.REFUSE) {
      return {
        bypass: true, // D2 is bypassed entirely
        allowed_actions: [],
        message: 'Safety REFUSE - use provided response template',
      };
    }

    if (verdict.action === SafetyAction.RESTRICT) {
      return {
        bypass: false,
        allowed_actions: ['ASK', 'CHALLENGE'], // Only these allowed
        message: verdict.user_message_template,
      };
    }

    return {
      bypass: false,
      allowed_actions: null,
      message: null,
    };
  }

  /**
   * Validate a D2 action against safety constraints
   *
   * @param {string} action - D2 action
   * @param {Object} safetyResult - Result from process()
   * @returns {Object} { allowed, reason }
   */
  validateD2Action(action, safetyResult) {
    return this.safetyEngine.checkD2Action(action, safetyResult.verdict);
  }

  /**
   * Get the safety engine for direct access
   */
  getEngine() {
    return this.safetyEngine;
  }

  /**
   * Get verdict log for observability
   */
  getVerdictLog() {
    return this.safetyEngine.getVerdictLog();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Full pipeline runtime: D1.5 → A3 → D6 → D2 → D5
 *
 * This is the main entry point for processing user queries
 */
export class FullPipelineRuntime {
  constructor(config = {}) {
    this.config = config;

    // Safety layer
    this.safetyRuntime = new SafetyLayerRuntime(config);

    // Epistemic runtime (optional - can be injected)
    this.epistemicRuntime = config.epistemicRuntime || null;
  }

  /**
   * Set the epistemic runtime (for lazy initialization)
   */
  setEpistemicRuntime(runtime) {
    this.epistemicRuntime = runtime;
  }

  /**
   * Process a query through the full pipeline
   *
   * @param {string} query - User query
   * @param {Object} context - Conversation context
   * @returns {Object} Pipeline result
   */
  async process(query, context = {}) {
    const audit = {
      steps: [],
      started_at: new Date().toISOString(),
    };

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: D1.5 Epistemic Gate (if available)
    // ─────────────────────────────────────────────────────────────────────
    let epistemicResult = null;

    if (this.epistemicRuntime) {
      epistemicResult = await this.epistemicRuntime.process(query, context);
      audit.steps.push({
        layer: 'D1.5_EPISTEMIC',
        state: epistemicResult.epistemic?.state,
        confidence: epistemicResult.epistemic?.confidence,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: A3 Safety Gate
    // ─────────────────────────────────────────────────────────────────────
    const safetyResult = this.safetyRuntime.process({
      query,
      context,
      epistemicDecision: epistemicResult?.epistemic,
    });

    audit.steps.push({
      layer: 'A3_SAFETY',
      action: safetyResult.safety.action,
      domain: safetyResult.safety.domain,
      reason_code: safetyResult.safety.reason_code,
    });

    // If REFUSE, return immediately with the template response
    if (safetyResult.safety.action === SafetyAction.REFUSE) {
      return {
        blocked: true,
        layer: 'A3_SAFETY',
        response: safetyResult.response,
        safety: safetyResult.safety,
        epistemic: epistemicResult?.epistemic || null,
        audit,
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3+: Continue to D6, D2, D5 (implemented elsewhere)
    // ─────────────────────────────────────────────────────────────────────

    return {
      blocked: false,
      safety: safetyResult.safety,
      d2_constraints: safetyResult.d2,
      epistemic: epistemicResult?.epistemic || null,
      tools: epistemicResult?.tools || null,
      audit,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { SafetyAction, SafetyDomain };

export default {
  SafetyLayerRuntime,
  FullPipelineRuntime,
  SafetyAction,
  SafetyDomain,
};
