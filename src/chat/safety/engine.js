// Safety Engine v50.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Central Safety Engine for A3 (Safety & Refusal Policy)
//
// This is the SINGLE SOURCE OF TRUTH for all refusals.
// D2 and D5 MUST NOT generate REFUSE text - only A3.
//
// Pipeline Position:
//   Epistemic (D1.5) → Safety (A3) → Decision (D2) → Quality (D5)
//
// Rules:
//   - If A3 returns REFUSE → D2 is bypassed
//   - If A3 returns RESTRICT → D2 can only ASK / CHALLENGE
//   - A3 NEVER calls tools
//
// ══════════════════════════════════════════════════════════════════════════════

// NOTE: Policy imports are in #getInstance() to avoid circular dependency.
// Policies import SafetyDomain from this file, so top-level import would fail.

// ════════════════════════════════════════════════════════════════════════════
// SAFETY TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Safety action types
 */
export const SafetyAction = {
  ALLOW: 'ALLOW',       // Proceed normally
  RESTRICT: 'RESTRICT', // Limited actions (ASK/CHALLENGE only)
  REFUSE: 'REFUSE',     // Hard refusal with alternatives
};

/**
 * Safety domains
 */
export const SafetyDomain = {
  GENERAL: 'general',   // Violence, hacking, malware
  FINANCE: 'finance',   // Investment advice, guarantees
  LAW: 'law',           // Legal advice, compliance
  HEALTH: 'health',     // Diagnoses, treatment
};

/**
 * Create a SafetyVerdict
 *
 * @param {Object} params
 * @param {string} params.action - ALLOW | RESTRICT | REFUSE
 * @param {string} params.domain - general | finance | law | health
 * @param {string} params.reason_code - Machine-readable reason
 * @param {string} params.user_message_template - Template (no improvisation)
 * @param {string[]} params.alternatives - Required for REFUSE
 * @returns {Object} SafetyVerdict
 */
export function createSafetyVerdict({
  action,
  domain,
  reason_code,
  user_message_template = null,
  alternatives = [],
}) {
  // Validate: REFUSE must have alternatives
  if (action === SafetyAction.REFUSE && alternatives.length === 0) {
    throw new Error('REFUSE verdict MUST have alternatives');
  }

  return {
    action,
    domain,
    reason_code,
    user_message_template,
    alternatives,
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SAFETY ENGINE
// ════════════════════════════════════════════════════════════════════════════

export class SafetyEngine {
  constructor(config = {}) {
    this.config = {
      strictMode: config.strictMode ?? true,
      logVerdicts: config.logVerdicts ?? true,
    };

    // Policy registry
    this.policies = new Map();

    // Verdict log for observability
    this.verdictLog = [];
  }

  /**
   * Register a domain policy
   *
   * @param {string} domain - Domain name
   * @param {Object} policy - Policy implementation
   */
  registerPolicy(domain, policy) {
    if (!policy.evaluate || typeof policy.evaluate !== 'function') {
      throw new Error(`Policy for ${domain} must have evaluate() method`);
    }
    this.policies.set(domain, policy);
  }

  /**
   * Evaluate a query against all safety policies
   *
   * This is the main entry point - called AFTER D1.5, BEFORE D2
   *
   * @param {Object} params
   * @param {string} params.query - User query
   * @param {Object} params.context - Conversation context
   * @param {Object} params.epistemic - D1.5 decision (read-only)
   * @returns {Object} SafetyVerdict
   */
  evaluate({ query, context = {}, epistemic = null }) {
    // Check each policy in priority order
    const domainsToCheck = [
      SafetyDomain.GENERAL,  // Always check general first
      SafetyDomain.HEALTH,   // Then high-risk domains
      SafetyDomain.FINANCE,
      SafetyDomain.LAW,
    ];

    for (const domain of domainsToCheck) {
      const policy = this.policies.get(domain);
      if (!policy) continue;

      const verdict = policy.evaluate({ query, context, epistemic });

      if (verdict && verdict.action !== SafetyAction.ALLOW) {
        // Found a restriction or refusal
        this.logVerdict(verdict, query);
        return verdict;
      }
    }

    // Default: ALLOW
    const allowVerdict = createSafetyVerdict({
      action: SafetyAction.ALLOW,
      domain: SafetyDomain.GENERAL,
      reason_code: 'SAFE_CONTENT',
      user_message_template: null,
      alternatives: [],
    });

    this.logVerdict(allowVerdict, query);
    return allowVerdict;
  }

  /**
   * Log verdict for observability
   */
  logVerdict(verdict, query) {
    if (!this.config.logVerdicts) return;

    this.verdictLog.push({
      safety_action: verdict.action,
      safety_domain: verdict.domain,
      reason_code: verdict.reason_code,
      query_preview: query.substring(0, 100),
      timestamp: verdict.timestamp,
    });

    // Keep log bounded
    if (this.verdictLog.length > 1000) {
      this.verdictLog = this.verdictLog.slice(-500);
    }
  }

  /**
   * Get verdict log for debugging/audit
   */
  getVerdictLog() {
    return [...this.verdictLog];
  }

  /**
   * Clear verdict log
   */
  clearVerdictLog() {
    this.verdictLog = [];
  }

  /**
   * Check if a D2 action is allowed given safety verdict
   *
   * @param {string} d2Action - D2 action (ANSWER, ASK, CHALLENGE, etc.)
   * @param {Object} verdict - SafetyVerdict
   * @returns {Object} { allowed, reason }
   */
  checkD2Action(d2Action, verdict) {
    if (verdict.action === SafetyAction.ALLOW) {
      return { allowed: true, reason: 'Safety allows all actions' };
    }

    if (verdict.action === SafetyAction.REFUSE) {
      return {
        allowed: false,
        reason: 'Safety REFUSE - D2 bypassed',
        must_use_template: verdict.user_message_template,
      };
    }

    if (verdict.action === SafetyAction.RESTRICT) {
      // Only ASK and CHALLENGE allowed
      const allowedActions = ['ASK', 'CHALLENGE'];
      if (allowedActions.includes(d2Action)) {
        return { allowed: true, reason: 'Action allowed under RESTRICT' };
      }
      return {
        allowed: false,
        reason: `RESTRICT only allows: ${allowedActions.join(', ')}`,
      };
    }

    return { allowed: true, reason: 'Unknown action - defaulting to allow' };
  }

  /**
   * Format refusal response using template
   *
   * This is the ONLY place that generates refusal text.
   * D2 and D5 MUST NOT generate their own refusal messages.
   *
   * @param {Object} verdict - SafetyVerdict with REFUSE action
   * @returns {string} Formatted refusal message
   */
  formatRefusalResponse(verdict) {
    if (verdict.action !== SafetyAction.REFUSE) {
      throw new Error('formatRefusalResponse only for REFUSE verdicts');
    }

    // Template structure:
    // 1. Short reason (no paragraphs)
    // 2. What I CAN do instead
    // 3. Next safe step

    let response = verdict.user_message_template;

    // Append alternatives
    if (verdict.alternatives.length > 0) {
      response += '\n\nMohu ale:\n';
      for (const alt of verdict.alternatives) {
        response += `• ${alt}\n`;
      }
      response += '\nKterou variantu chceš?';
    }

    return response.trim();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATIC API — used by ChatController.process()
  // ══════════════════════════════════════════════════════════════════════════

  /** @type {SafetyEngine|null} */
  static #instance = null;

  /**
   * Get or create the singleton SafetyEngine with all policies registered.
   * @returns {SafetyEngine}
   */
  static #getInstance() {
    if (!SafetyEngine.#instance) {
      SafetyEngine.#instance = new SafetyEngine({ strictMode: true });
      // Policies are registered in initSingleton() called at bottom of file
    }
    return SafetyEngine.#instance;
  }

  /** @type {boolean} */
  static #policiesRegistered = false;

  /**
   * Ensure policies are loaded (called lazily on first check).
   * Uses dynamic import to break circular dependency:
   * engine.js ↔ policies/*.js both reference SafetyDomain/SafetyAction
   */
  static async ensurePolicies() {
    if (SafetyEngine.#policiesRegistered) return;
    SafetyEngine.#policiesRegistered = true;

    try {
      const [gen, fin, law, health] = await Promise.all([
        import('./policies/general.js'),
        import('./policies/finance.js'),
        import('./policies/law.js'),
        import('./policies/health.js'),
      ]);
      const engine = SafetyEngine.#getInstance();
      engine.registerPolicy(SafetyDomain.GENERAL, gen.GeneralPolicy);
      engine.registerPolicy(SafetyDomain.FINANCE, fin.FinancePolicy);
      engine.registerPolicy(SafetyDomain.LAW,     law.LawPolicy);
      engine.registerPolicy(SafetyDomain.HEALTH,  health.HealthPolicy);
    } catch (e) {
      // Policy load failure = engine works but all verdicts are ALLOW
    }
  }

  /**
   * Static check() — matches ChatController's expected API:
   *
   *   SafetyEngine.check(input, context)
   *   → { action: 'block', domain, reason, userMessage } if refused
   *   → null if allowed
   *
   * @param {string} input — User message
   * @param {Object} [context={}] — Conversation context
   * @returns {Object|null}
   */
  static check(input, context = {}) {
    // Trigger policy loading if not yet done (async, resolves before first real user message)
    SafetyEngine.ensurePolicies();

    const engine = SafetyEngine.#getInstance();

    const verdict = engine.evaluate({
      query: input,
      context,
      epistemic: null,
    });

    if (verdict.action === SafetyAction.REFUSE) {
      return {
        action: 'block',
        domain: verdict.domain,
        reason: verdict.reason_code,
        userMessage: verdict.user_message_template
          || engine.formatRefusalResponse(verdict),
      };
    }

    if (verdict.action === SafetyAction.RESTRICT) {
      return {
        action: 'restrict',
        domain: verdict.domain,
        reason: verdict.reason_code,
        userMessage: verdict.user_message_template,
      };
    }

    // ALLOW → null (controller checks truthiness)
    return null;
  }

  /**
   * Get registered policies info
   */
  getPoliciesInfo() {
    const info = {};
    for (const [domain, policy] of this.policies) {
      info[domain] = {
        name: policy.name || domain,
        scope: policy.scope || 'unknown',
      };
    }
    return info;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EAGER POLICY LOAD — fires at module import, resolves before first request
// ════════════════════════════════════════════════════════════════════════════

SafetyEngine.ensurePolicies().catch(() => {});

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  SafetyEngine,
  SafetyAction,
  SafetyDomain,
  createSafetyVerdict,
};
