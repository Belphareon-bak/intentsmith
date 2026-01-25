// CRE v39.1 Safety Limits
// ══════════════════════════════════════════════════════════════════════════════
//
// Global safety limits for autonomous operation.
//
// Safety Layers:
//   1. Token limits (cost control)
//   2. Time limits (runaway prevention)
//   3. Action limits (bounded execution)
//   4. Resource limits (memory, disk, network)
//
// Key Principle:
//   Safety limits are NON-NEGOTIABLE.
//   Agent cannot disable or circumvent them.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT LIMITS
// ════════════════════════════════════════════════════════════════════════════

export const DEFAULT_SAFETY_LIMITS = {
  // Token/Cost Limits
  maxTokensPerGoal: 100000,         // Max tokens per goal execution
  maxTokensPerSession: 500000,      // Max tokens per session
  maxTokensPerDay: 2000000,         // Daily token budget
  maxCostPerGoal: 1.0,              // Max $ cost per goal
  maxCostPerDay: 10.0,              // Daily $ budget

  // Time Limits
  maxGoalDuration: 3600000,         // 1 hour per goal
  maxSessionDuration: 28800000,     // 8 hours per session
  maxStepDuration: 120000,          // 2 minutes per step

  // Action Limits
  maxGoalsPerHour: 20,              // Goals per hour
  maxPlansPerGoal: 10,              // Plan attempts per goal
  maxStepsPerPlan: 50,              // Steps per plan
  maxRetriesPerStep: 3,             // Retries per step
  maxConcurrentGoals: 3,            // Parallel goals

  // Resource Limits
  maxMemoryMB: 512,                 // Memory usage
  maxDiskWriteMB: 100,              // Disk write per goal
  maxNetworkRequestsPerMinute: 60,  // Rate limiting

  // Tool Restrictions
  blockedTools: [],                 // Globally blocked tools
  requireApprovalTools: [           // Tools requiring approval
    'fs.write',
    'fs.delete',
    'shell.exec',
    'browser.navigate',
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// LIMIT VIOLATION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const LimitViolation = {
  TOKEN_LIMIT: 'TOKEN_LIMIT',
  COST_LIMIT: 'COST_LIMIT',
  TIME_LIMIT: 'TIME_LIMIT',
  ACTION_LIMIT: 'ACTION_LIMIT',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
  TOOL_BLOCKED: 'TOOL_BLOCKED',
};

// ════════════════════════════════════════════════════════════════════════════
// SAFETY LIMITS ENFORCER
// ════════════════════════════════════════════════════════════════════════════

export class SafetyLimits {
  constructor(options = {}) {
    // Merge with defaults — cannot relax below defaults
    this.limits = this.mergeWithDefaults(options.limits || {});

    // Usage tracking
    this.usage = {
      tokens: {
        currentGoal: 0,
        currentSession: 0,
        today: 0,
        lastReset: Date.now(),
      },
      cost: {
        currentGoal: 0,
        today: 0,
        lastReset: Date.now(),
      },
      time: {
        goalStart: null,
        sessionStart: Date.now(),
      },
      actions: {
        goalsThisHour: 0,
        hourStart: Date.now(),
        networkRequestsThisMinute: 0,
        minuteStart: Date.now(),
      },
      resources: {
        memoryPeakMB: 0,
        diskWrittenMB: 0,
      },
    };

    // Violation log
    this.violations = [];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LIMIT CHECKS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if action is allowed
   *
   * @param {string} action - Action type
   * @param {Object} context - Action context
   * @returns {{ allowed: boolean, violation?: string, reason?: string }}
   */
  check(action, context = {}) {
    // Reset counters if needed
    this.resetCountersIfNeeded();

    // Check by action type
    switch (action) {
      case 'START_GOAL':
        return this.checkStartGoal(context);

      case 'USE_TOKENS':
        return this.checkTokens(context.tokens || 0);

      case 'EXECUTE_STEP':
        return this.checkStep(context);

      case 'USE_TOOL':
        return this.checkTool(context.tool);

      case 'NETWORK_REQUEST':
        return this.checkNetworkRate();

      case 'WRITE_DISK':
        return this.checkDiskWrite(context.sizeMB || 0);

      default:
        return { allowed: true };
    }
  }

  /**
   * Check if can start a new goal
   */
  checkStartGoal(context = {}) {
    // Check goals per hour
    if (this.usage.actions.goalsThisHour >= this.limits.maxGoalsPerHour) {
      return this.deny(LimitViolation.ACTION_LIMIT, 'Max goals per hour exceeded');
    }

    // Check daily cost
    if (this.usage.cost.today >= this.limits.maxCostPerDay) {
      return this.deny(LimitViolation.COST_LIMIT, 'Daily cost limit exceeded');
    }

    // Check daily tokens
    if (this.usage.tokens.today >= this.limits.maxTokensPerDay) {
      return this.deny(LimitViolation.TOKEN_LIMIT, 'Daily token limit exceeded');
    }

    // Check concurrent goals
    if (context.currentConcurrent >= this.limits.maxConcurrentGoals) {
      return this.deny(LimitViolation.ACTION_LIMIT, 'Max concurrent goals exceeded');
    }

    return { allowed: true };
  }

  /**
   * Check token usage
   */
  checkTokens(tokens) {
    // Check per-goal limit
    if (this.usage.tokens.currentGoal + tokens > this.limits.maxTokensPerGoal) {
      return this.deny(LimitViolation.TOKEN_LIMIT, 'Goal token limit exceeded');
    }

    // Check session limit
    if (this.usage.tokens.currentSession + tokens > this.limits.maxTokensPerSession) {
      return this.deny(LimitViolation.TOKEN_LIMIT, 'Session token limit exceeded');
    }

    // Check daily limit
    if (this.usage.tokens.today + tokens > this.limits.maxTokensPerDay) {
      return this.deny(LimitViolation.TOKEN_LIMIT, 'Daily token limit exceeded');
    }

    return { allowed: true };
  }

  /**
   * Check if step execution is allowed
   */
  checkStep(context = {}) {
    // Check goal duration
    if (this.usage.time.goalStart) {
      const elapsed = Date.now() - this.usage.time.goalStart;
      if (elapsed > this.limits.maxGoalDuration) {
        return this.deny(LimitViolation.TIME_LIMIT, 'Goal duration limit exceeded');
      }
    }

    // Check session duration
    const sessionElapsed = Date.now() - this.usage.time.sessionStart;
    if (sessionElapsed > this.limits.maxSessionDuration) {
      return this.deny(LimitViolation.TIME_LIMIT, 'Session duration limit exceeded');
    }

    return { allowed: true };
  }

  /**
   * Check if tool is allowed
   */
  checkTool(tool) {
    if (!tool) return { allowed: true };

    // Check blocked tools
    if (this.limits.blockedTools.includes(tool)) {
      return this.deny(LimitViolation.TOOL_BLOCKED, `Tool blocked: ${tool}`);
    }

    // Check if requires approval
    const requiresApproval = this.limits.requireApprovalTools.includes(tool);

    return { allowed: true, requiresApproval };
  }

  /**
   * Check network rate limit
   */
  checkNetworkRate() {
    if (this.usage.actions.networkRequestsThisMinute >= this.limits.maxNetworkRequestsPerMinute) {
      return this.deny(LimitViolation.RESOURCE_LIMIT, 'Network rate limit exceeded');
    }
    return { allowed: true };
  }

  /**
   * Check disk write limit
   */
  checkDiskWrite(sizeMB) {
    if (this.usage.resources.diskWrittenMB + sizeMB > this.limits.maxDiskWriteMB) {
      return this.deny(LimitViolation.RESOURCE_LIMIT, 'Disk write limit exceeded');
    }
    return { allowed: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // USAGE RECORDING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record token usage
   */
  recordTokens(tokens) {
    this.usage.tokens.currentGoal += tokens;
    this.usage.tokens.currentSession += tokens;
    this.usage.tokens.today += tokens;
  }

  /**
   * Record cost
   */
  recordCost(cost) {
    this.usage.cost.currentGoal += cost;
    this.usage.cost.today += cost;
  }

  /**
   * Record goal start
   */
  recordGoalStart() {
    this.usage.time.goalStart = Date.now();
    this.usage.tokens.currentGoal = 0;
    this.usage.cost.currentGoal = 0;
    this.usage.resources.diskWrittenMB = 0;
    this.usage.actions.goalsThisHour++;
  }

  /**
   * Record goal end
   */
  recordGoalEnd() {
    this.usage.time.goalStart = null;
  }

  /**
   * Record network request
   */
  recordNetworkRequest() {
    this.usage.actions.networkRequestsThisMinute++;
  }

  /**
   * Record disk write
   */
  recordDiskWrite(sizeMB) {
    this.usage.resources.diskWrittenMB += sizeMB;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Deny action and log violation
   */
  deny(violation, reason) {
    this.violations.push({
      type: violation,
      reason,
      timestamp: Date.now(),
    });

    // Trim violations log
    if (this.violations.length > 100) {
      this.violations = this.violations.slice(-100);
    }

    logger.warn('SafetyLimits', `VIOLATION: ${violation}`, { reason });

    return { allowed: false, violation, reason };
  }

  /**
   * Reset counters if time windows have passed
   */
  resetCountersIfNeeded() {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.usage.actions.hourStart > 3600000) {
      this.usage.actions.goalsThisHour = 0;
      this.usage.actions.hourStart = now;
    }

    // Reset minute counter
    if (now - this.usage.actions.minuteStart > 60000) {
      this.usage.actions.networkRequestsThisMinute = 0;
      this.usage.actions.minuteStart = now;
    }

    // Reset daily counters (midnight check)
    const lastResetDate = new Date(this.usage.tokens.lastReset).toDateString();
    const todayDate = new Date(now).toDateString();
    if (lastResetDate !== todayDate) {
      this.usage.tokens.today = 0;
      this.usage.tokens.lastReset = now;
      this.usage.cost.today = 0;
      this.usage.cost.lastReset = now;
    }
  }

  /**
   * Merge limits with defaults (cannot relax below defaults)
   */
  mergeWithDefaults(custom) {
    const merged = { ...DEFAULT_SAFETY_LIMITS };

    for (const [key, value] of Object.entries(custom)) {
      if (key in merged) {
        // For limits, use the more restrictive value
        if (typeof value === 'number' && typeof merged[key] === 'number') {
          merged[key] = Math.min(value, merged[key]);
        } else if (Array.isArray(value)) {
          // For arrays (blocked tools), union the sets
          merged[key] = [...new Set([...merged[key], ...value])];
        }
      }
    }

    return merged;
  }

  /**
   * Get current usage stats
   */
  getUsage() {
    return {
      tokens: {
        goal: this.usage.tokens.currentGoal,
        goalLimit: this.limits.maxTokensPerGoal,
        session: this.usage.tokens.currentSession,
        sessionLimit: this.limits.maxTokensPerSession,
        today: this.usage.tokens.today,
        dayLimit: this.limits.maxTokensPerDay,
      },
      cost: {
        goal: this.usage.cost.currentGoal,
        goalLimit: this.limits.maxCostPerGoal,
        today: this.usage.cost.today,
        dayLimit: this.limits.maxCostPerDay,
      },
      time: {
        goalElapsed: this.usage.time.goalStart ? Date.now() - this.usage.time.goalStart : 0,
        goalLimit: this.limits.maxGoalDuration,
        sessionElapsed: Date.now() - this.usage.time.sessionStart,
        sessionLimit: this.limits.maxSessionDuration,
      },
      actions: {
        goalsThisHour: this.usage.actions.goalsThisHour,
        hourLimit: this.limits.maxGoalsPerHour,
      },
      resources: {
        diskWrittenMB: this.usage.resources.diskWrittenMB,
        diskLimit: this.limits.maxDiskWriteMB,
      },
    };
  }

  /**
   * Get recent violations
   */
  getViolations(limit = 20) {
    return this.violations.slice(-limit);
  }

  /**
   * Reset session (new session)
   */
  resetSession() {
    this.usage.tokens.currentSession = 0;
    this.usage.time.sessionStart = Date.now();
    logger.debug('SafetyLimits', 'Session reset');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const safetyLimits = new SafetyLimits();

export default SafetyLimits;
