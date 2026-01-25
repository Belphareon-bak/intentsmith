// CRE v38.1 Plan Mutations
// ══════════════════════════════════════════════════════════════════════════════
//
// All plan changes go through PlanMutator.
// Every mutation is logged and auditable.
//
// Architectural invariants:
//   ❌ stepResult doesn't change plan directly
//   ❌ LLM doesn't change plan directly
//   ✅ Changes are mutations
//   ✅ Every mutation is auditable
//
// Mutation types:
//   SET_STEP_STATUS   — Change step status
//   SET_STEP_RESULT   — Record step result
//   SET_STEP_ERROR    — Record step error
//   ADD_STEP          — Add a new step (e.g., fallback)
//   REMOVE_STEP       — Remove a step
//   MODIFY_STEP       — Modify step params/config
//   SET_PLAN_STATUS   — Change plan status
//   RETRY_STEP        — Increment attempt counter, reset for retry
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { StepStatus, PlanStatus, createStep } from './types.js';

// ════════════════════════════════════════════════════════════════════════════
// MUTATION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const MutationType = {
  SET_STEP_STATUS: 'SET_STEP_STATUS',
  SET_STEP_RESULT: 'SET_STEP_RESULT',
  SET_STEP_ERROR: 'SET_STEP_ERROR',
  ADD_STEP: 'ADD_STEP',
  REMOVE_STEP: 'REMOVE_STEP',
  MODIFY_STEP: 'MODIFY_STEP',
  SET_PLAN_STATUS: 'SET_PLAN_STATUS',
  RETRY_STEP: 'RETRY_STEP',
  ENABLE_FALLBACK: 'ENABLE_FALLBACK',
};

// ════════════════════════════════════════════════════════════════════════════
// MUTATION RECORD
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MutationRecord
 * @property {string} id
 * @property {string} type - MutationType
 * @property {number} timestamp
 * @property {string} source - Who triggered: 'runner' | 'reflector' | 'user' | 'llm_advisory'
 * @property {Object} payload - Mutation-specific data
 * @property {Object} [previous] - Previous state (for rollback)
 */

let mutationCounter = 0;

function createMutationRecord(type, source, payload, previous = null) {
  return {
    id: `mut_${++mutationCounter}_${Date.now()}`,
    type,
    timestamp: Date.now(),
    source,
    payload,
    previous,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PLAN MUTATOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * PlanMutator — single point of plan modifications
 *
 * Usage:
 *   const mutator = new PlanMutator(plan);
 *   mutator.setStepStatus('s1', StepStatus.RUNNING, 'runner');
 *   mutator.setStepResult('s1', { data: [...] }, 'runner');
 */
export class PlanMutator {
  constructor(plan) {
    this.plan = plan;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP STATUS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set step status
   *
   * @param {string} stepId
   * @param {string} status - StepStatus
   * @param {string} source - Who triggered
   */
  setStepStatus(stepId, status, source = 'runner') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = { status: step.status };
    step.status = status;

    // Update timestamps
    if (status === StepStatus.RUNNING) {
      step.startedAt = Date.now();
    }
    if ([StepStatus.COMPLETED, StepStatus.FAILED, StepStatus.SKIPPED].includes(status)) {
      step.completedAt = Date.now();
    }

    this.log(MutationType.SET_STEP_STATUS, source, { stepId, status }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP RESULT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set step result (success)
   */
  setStepResult(stepId, result, source = 'runner') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = { result: step.result, status: step.status };
    step.result = result;
    step.status = StepStatus.COMPLETED;
    step.completedAt = Date.now();
    this.plan.results[stepId] = result;

    this.log(MutationType.SET_STEP_RESULT, source, { stepId, hasResult: result !== null }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP ERROR
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set step error (failure)
   */
  setStepError(stepId, error, errorCode, source = 'runner') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = { error: step.error, errorCode: step.errorCode, status: step.status };
    step.error = error;
    step.errorCode = errorCode;
    step.status = StepStatus.FAILED;
    step.completedAt = Date.now();

    this.log(MutationType.SET_STEP_ERROR, source, { stepId, error, errorCode }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RETRY (v38.1)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Mark step for retry
   */
  retryStep(stepId, source = 'runner') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = { status: step.status, attempts: step.attempts };
    step.attempts++;
    step.status = StepStatus.RETRYING;
    step.error = null;
    step.errorCode = null;
    step.startedAt = null;
    step.completedAt = null;

    this.log(MutationType.RETRY_STEP, source, { stepId, attempt: step.attempts }, previous);
    return { success: true, attempts: step.attempts };
  }

  /**
   * Reset retry step to PENDING (ready for next attempt)
   */
  resetForRetry(stepId, source = 'runner') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = { status: step.status };
    step.status = StepStatus.PENDING;

    this.log(MutationType.SET_STEP_STATUS, source, { stepId, status: StepStatus.PENDING, reason: 'retry_reset' }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADD/REMOVE STEPS (v38.1)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Add a new step (e.g., dynamically adding fallback)
   */
  addStep(stepConfig, source = 'reflector') {
    // Validate: no duplicate IDs
    if (this.plan.steps.some(s => s.id === stepConfig.id)) {
      return { success: false, error: `Step ID already exists: ${stepConfig.id}` };
    }

    const step = createStep(stepConfig);
    this.plan.steps.push(step);

    // Update graph metadata
    this.plan.graph.nodeCount = this.plan.steps.length;

    this.log(MutationType.ADD_STEP, source, { stepId: step.id, tool: step.tool }, null);
    return { success: true, step };
  }

  /**
   * Remove a step
   */
  removeStep(stepId, source = 'reflector') {
    const idx = this.plan.steps.findIndex(s => s.id === stepId);
    if (idx === -1) return { success: false, error: `Step not found: ${stepId}` };

    const [removed] = this.plan.steps.splice(idx, 1);

    // Remove from results
    delete this.plan.results[stepId];

    // Update graph metadata
    this.plan.graph.nodeCount = this.plan.steps.length;

    this.log(MutationType.REMOVE_STEP, source, { stepId }, { step: removed });
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODIFY STEP (v38.1)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Modify step params or config
   */
  modifyStep(stepId, modifications, source = 'reflector') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = {};
    for (const key of Object.keys(modifications)) {
      previous[key] = step[key];
      step[key] = modifications[key];
    }

    this.log(MutationType.MODIFY_STEP, source, { stepId, modifications: Object.keys(modifications) }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ENABLE FALLBACK (v38.1)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Enable a fallback step when primary fails
   */
  enableFallback(failedStepId, source = 'runner') {
    const step = this.findStep(failedStepId);
    if (!step) return { success: false, error: `Step not found: ${failedStepId}` };
    if (!step.fallbackStep) return { success: false, error: 'No fallback configured' };

    const fallback = this.findStep(step.fallbackStep);
    if (!fallback) return { success: false, error: `Fallback step not found: ${step.fallbackStep}` };

    // Enable fallback by setting it to PENDING (conditions will now allow it)
    const previous = { status: fallback.status };
    fallback.status = StepStatus.PENDING;

    this.log(MutationType.ENABLE_FALLBACK, source, {
      failedStepId,
      fallbackStepId: step.fallbackStep,
    }, previous);

    return { success: true, fallbackStep: fallback };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PLAN STATUS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Set plan status
   */
  setPlanStatus(status, source = 'runner') {
    const previous = { status: this.plan.status };
    this.plan.status = status;

    if ([PlanStatus.COMPLETED, PlanStatus.FAILED].includes(status)) {
      this.plan.completedAt = Date.now();
    }

    this.log(MutationType.SET_PLAN_STATUS, source, { status }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SKIP STEP
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Skip a step (due to dependency failure or condition)
   */
  skipStep(stepId, reason, source = 'runner') {
    const step = this.findStep(stepId);
    if (!step) return { success: false, error: `Step not found: ${stepId}` };

    const previous = { status: step.status, error: step.error };
    step.status = StepStatus.SKIPPED;
    step.error = reason;
    step.completedAt = Date.now();

    this.log(MutationType.SET_STEP_STATUS, source, { stepId, status: StepStatus.SKIPPED, reason }, previous);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  findStep(stepId) {
    return this.plan.steps.find(s => s.id === stepId);
  }

  log(type, source, payload, previous) {
    const record = createMutationRecord(type, source, payload, previous);
    this.plan.mutations.push(record);

    // Keep mutation log bounded
    if (this.plan.mutations.length > 100) {
      this.plan.mutations = this.plan.mutations.slice(-100);
    }

    logger.debug('PlanMutator', `${type}: ${JSON.stringify(payload)}`, { source });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUDIT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get mutation history
   */
  getMutations() {
    return [...this.plan.mutations];
  }

  /**
   * Get mutations by source
   */
  getMutationsBySource(source) {
    return this.plan.mutations.filter(m => m.source === source);
  }

  /**
   * Get mutations by type
   */
  getMutationsByType(type) {
    return this.plan.mutations.filter(m => m.type === type);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a mutator for a plan
 */
export function createMutator(plan) {
  return new PlanMutator(plan);
}

export default {
  MutationType,
  PlanMutator,
  createMutator,
};
