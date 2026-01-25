// CRE v38.2 Deterministic Reflection
// ══════════════════════════════════════════════════════════════════════════════
//
// Handles step failures WITHOUT LLM.
// Pure deterministic logic: retry → fallback → ask user.
//
// Flow:
//   Step fails → DeterministicReflector.reflect(step, plan)
//   → { action: RETRY | FALLBACK | ASK_USER | FAIL, ... }
//
// No LLM involved. LLM reflection is separate (v38.3) and optional.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { StepStatus, shouldRetry, getRetryDelay } from './types.js';
import { createMutator } from './mutations.js';

// ════════════════════════════════════════════════════════════════════════════
// REFLECTION ACTIONS
// ════════════════════════════════════════════════════════════════════════════

export const ReflectionAction = {
  RETRY: 'RETRY',             // Retry the step
  FALLBACK: 'FALLBACK',       // Use fallback step
  ASK_USER: 'ASK_USER',       // Ask user for guidance
  SKIP: 'SKIP',               // Skip and continue
  FAIL: 'FAIL',               // Propagate failure
  CONTINUE: 'CONTINUE',       // Continue execution (no action needed)
};

// ════════════════════════════════════════════════════════════════════════════
// REFLECTION RESULT
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ReflectionResult
 * @property {string} action - ReflectionAction
 * @property {string} reason - Why this action was chosen
 * @property {number} [delay] - For RETRY: delay in ms
 * @property {string} [fallbackStepId] - For FALLBACK: which step
 * @property {Object} [question] - For ASK_USER: what to ask
 */

// ════════════════════════════════════════════════════════════════════════════
// DETERMINISTIC REFLECTOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * DeterministicReflector — handles failures without LLM
 *
 * Decision tree:
 *   1. Check if step can retry → RETRY
 *   2. Check if fallback exists → FALLBACK
 *   3. Check if recoverable → ASK_USER
 *   4. Otherwise → FAIL
 */
export class DeterministicReflector {
  constructor(options = {}) {
    this.askUserEnabled = options.askUserEnabled ?? true;
    this.maxRetries = options.maxRetries ?? 3;

    // Error codes that can be recovered by asking user
    this.askableErrors = new Set([
      'MISSING_PARAM',
      'INVALID_INPUT',
      'PERMISSION_DENIED',
      'GATED',
    ]);

    // Error codes that are transient (retry-worthy)
    this.transientErrors = new Set([
      'TIMEOUT',
      'BACKEND_UNAVAILABLE',
      'RATE_LIMITED',
    ]);

    this.stats = { reflections: 0, retries: 0, fallbacks: 0, asks: 0, fails: 0 };
  }

  /**
   * Reflect on a failed step and decide what to do
   *
   * @param {Step} step - The failed step
   * @param {Plan} plan - The plan context
   * @returns {ReflectionResult}
   */
  reflect(step, plan) {
    this.stats.reflections++;

    // Already completed or not failed — no action
    if (step.status !== StepStatus.FAILED) {
      return { action: ReflectionAction.CONTINUE, reason: 'Step not failed' };
    }

    const errorCode = step.errorCode || 'UNKNOWN';

    // 1. Check RETRY
    if (this.canRetry(step)) {
      this.stats.retries++;
      const delay = getRetryDelay(step);
      logger.debug('DeterministicReflector', `RETRY: ${step.id}`, { attempt: step.attempts + 1, delay });
      return {
        action: ReflectionAction.RETRY,
        reason: `Transient error: ${errorCode}`,
        delay,
      };
    }

    // 2. Check FALLBACK
    if (step.fallbackStep) {
      const fallback = plan.steps.find(s => s.id === step.fallbackStep);
      if (fallback && fallback.status === StepStatus.PENDING) {
        this.stats.fallbacks++;
        logger.debug('DeterministicReflector', `FALLBACK: ${step.id} → ${step.fallbackStep}`);
        return {
          action: ReflectionAction.FALLBACK,
          reason: `Primary failed, using fallback`,
          fallbackStepId: step.fallbackStep,
        };
      }
    }

    // 3. Check ASK_USER
    if (this.askUserEnabled && this.askableErrors.has(errorCode)) {
      this.stats.asks++;
      logger.debug('DeterministicReflector', `ASK_USER: ${step.id}`, { error: errorCode });
      return {
        action: ReflectionAction.ASK_USER,
        reason: `Recoverable error: ${errorCode}`,
        question: this.buildQuestion(step, errorCode),
      };
    }

    // 4. FAIL — unrecoverable
    this.stats.fails++;
    logger.debug('DeterministicReflector', `FAIL: ${step.id}`, { error: errorCode });
    return {
      action: ReflectionAction.FAIL,
      reason: `Unrecoverable error: ${errorCode}`,
    };
  }

  /**
   * Check if step can retry
   */
  canRetry(step) {
    if (!step.retry || step.retry.maxRetries === 0) return false;
    if (step.attempts >= step.retry.maxRetries) return false;
    if (!step.errorCode) return false;

    // Check if error is in retry list or is transient
    return step.retry.retryOn.includes(step.errorCode) ||
           this.transientErrors.has(step.errorCode);
  }

  /**
   * Build a question for ASK_USER
   */
  buildQuestion(step, errorCode) {
    switch (errorCode) {
      case 'MISSING_PARAM':
        return {
          type: 'MISSING_PARAM',
          message: `Chybí parametr pro ${step.tool}. Co mám doplnit?`,
          stepId: step.id,
          tool: step.tool,
        };

      case 'INVALID_INPUT':
        return {
          type: 'INVALID_INPUT',
          message: `Neplatný vstup pro ${step.tool}. Jak to opravit?`,
          stepId: step.id,
          error: step.error,
        };

      case 'PERMISSION_DENIED':
        return {
          type: 'PERMISSION_DENIED',
          message: `Nemám oprávnění pro ${step.tool}. Chceš udělit?`,
          stepId: step.id,
          tool: step.tool,
        };

      case 'GATED':
        return {
          type: 'GATED',
          message: `Krok ${step.tool} čeká na potvrzení. Pokračovat?`,
          stepId: step.id,
          tool: step.tool,
        };

      default:
        return {
          type: 'GENERAL',
          message: `Krok ${step.id} selhal: ${step.error}. Jak postupovat?`,
          stepId: step.id,
          error: step.error,
        };
    }
  }

  /**
   * Apply reflection result to plan using mutator
   *
   * @param {ReflectionResult} result
   * @param {Step} step
   * @param {Plan} plan
   * @returns {{ applied: boolean, mutator: PlanMutator }}
   */
  applyReflection(result, step, plan) {
    const mutator = createMutator(plan);

    switch (result.action) {
      case ReflectionAction.RETRY:
        mutator.retryStep(step.id, 'reflector');
        mutator.resetForRetry(step.id, 'reflector');
        return { applied: true, mutator, action: 'retry' };

      case ReflectionAction.FALLBACK:
        mutator.enableFallback(step.id, 'reflector');
        return { applied: true, mutator, action: 'fallback' };

      case ReflectionAction.SKIP:
        mutator.skipStep(step.id, result.reason, 'reflector');
        return { applied: true, mutator, action: 'skip' };

      case ReflectionAction.ASK_USER:
        // Don't mutate — return the question for upstream handling
        return { applied: false, mutator, action: 'ask_user', question: result.question };

      case ReflectionAction.FAIL:
        // Keep as FAILED, propagate
        return { applied: false, mutator, action: 'fail' };

      default:
        return { applied: false, mutator, action: 'none' };
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset stats
   */
  reset() {
    this.stats = { reflections: 0, retries: 0, fallbacks: 0, asks: 0, fails: 0 };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const deterministicReflector = new DeterministicReflector();

export default DeterministicReflector;
