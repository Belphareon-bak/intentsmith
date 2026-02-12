// Lifecycle Handoff State — Per-session state management
// ══════════════════════════════════════════════════════════════════════════════
// Manages lifecycle handoff state via in-memory Map (per session).
// Split from lifecycle-handoff.js for modularity.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';

// ─── Lifecycle Handoff State (per session) ──────────────────────────────────

const lifecycleStates = new Map();

/**
 * @typedef {Object} LifecycleHandoffState
 * @property {'PROPOSED'|'SPEC'|'SPEC_REVIEW'|'PLANNING'|'PLAN_REVIEW'|'BUILD'|'BUILD_MILESTONE_REVIEW'|'REVIEW'|'CHANGE'|'PAUSED'|'DONE'} phase
 * @property {string|null} lifecycleId
 * @property {string|null} currentMilestoneId
 * @property {string} originalRequest
 * @property {number} projectId
 */

export function getLcState(sessionId) {
  return lifecycleStates.get(sessionId) || null;
}

export function setLcState(sessionId, state) {
  lifecycleStates.set(sessionId, { ...state, updatedAt: new Date().toISOString() });
}

export function clearLcState(sessionId) {
  lifecycleStates.delete(sessionId);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if session has active lifecycle handoff.
 * @param {string} sessionId
 * @returns {LifecycleHandoffState|null}
 */
export function getActiveLifecycleHandoff(sessionId) {
  return getLcState(sessionId);
}

/**
 * Cancel active lifecycle handoff.
 * @param {string} sessionId
 */
export function cancelLifecycleHandoff(sessionId) {
  clearLcState(sessionId);
  logger.info('LifecycleHandoff', 'Lifecycle handoff cancelled', { sessionId });
}
