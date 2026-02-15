// Lifecycle Handoff State — Per-session state management (v62: DB-backed)
// ══════════════════════════════════════════════════════════════════════════════
// RAM Map + DB write-through for crash recovery (C1).
// On startup, preloadActiveLifecycles() restores RAM from DB.
// Multi-session (C4): bindSessionToLifecycle() tracks which session owns lifecycle.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';

// ─── RAM cache ──────────────────────────────────────────────────────────────
const lifecycleStates = new Map();

// ─── DB accessors (initialized from server.js at startup) ───────────────────
let _handoffDb = null;
let _lifecyclesDb = null;

/**
 * @typedef {Object} LifecycleHandoffState
 * @property {'PROPOSED'|'SPEC'|'SPEC_REVIEW'|'PLANNING'|'PLAN_REVIEW'|'BUILD'|'BUILD_MILESTONE_REVIEW'|'REVIEW'|'CHANGE'|'PAUSED'|'DONE'} phase
 * @property {string|null} lifecycleId
 * @property {string|null} currentMilestoneId
 * @property {string} originalRequest
 * @property {number} projectId
 * @property {string} projectPath
 */

/**
 * Initialize DB backing for lifecycle handoff state.
 * Called once from server.js at startup.
 * @param {object} handoffDb - lifecycleHandoffState prepared statements
 * @param {object} [lifecyclesDb] - lifecycles prepared statements (for C4 multi-session)
 */
export function initLifecycleStateDb(handoffDb, lifecyclesDb = null) {
  _handoffDb = handoffDb;
  _lifecyclesDb = lifecyclesDb;
}

export function getLcState(sessionId) {
  return lifecycleStates.get(sessionId) || null;
}

/**
 * Find lifecycle state by projectId (iterates RAM Map).
 * Used by project opener to detect active lifecycle for a project.
 * @param {number|string} projectId
 * @returns {{ sessionId: string, state: LifecycleHandoffState } | null}
 */
export function getLcStateByProject(projectId) {
  if (!projectId) return null;
  const pid = Number(projectId);
  for (const [sessionId, state] of lifecycleStates) {
    if (Number(state.projectId) === pid) {
      return { sessionId, state };
    }
  }
  return null;
}

export function setLcState(sessionId, state) {
  const enriched = { ...state, updatedAt: new Date().toISOString() };
  lifecycleStates.set(sessionId, enriched);

  // Write-through to DB (non-fatal if DB not initialized)
  if (_handoffDb) {
    try {
      _handoffDb.upsert.run(
        sessionId,
        state.phase,
        state.lifecycleId || null,
        state.currentMilestoneId || null,
        state.originalRequest || null,
        state.projectId || null,
        state.projectPath || null,
        state.changeRequestId || null
      );
    } catch (err) {
      logger.warn('LifecycleState', `DB write-through failed: ${err.message}`);
    }
  }
}

export function clearLcState(sessionId) {
  lifecycleStates.delete(sessionId);

  if (_handoffDb) {
    try { _handoffDb.delete.run(sessionId); } catch { /* non-fatal */ }
  }
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

// ─── C4: Multi-session — bind session to lifecycle ──────────────────────────

/**
 * Update active_session_id on a lifecycle record.
 * Called when a session claims/binds to a lifecycle.
 * @param {string} sessionId
 * @param {string} lifecycleId
 */
export function bindSessionToLifecycle(sessionId, lifecycleId) {
  if (_lifecyclesDb) {
    try {
      _lifecyclesDb.updateActiveSession.run(sessionId, lifecycleId);
    } catch (err) {
      logger.warn('LifecycleState', `Failed to bind session: ${err.message}`);
    }
  }
}

// ─── C1: Crash recovery — preload from DB on startup ────────────────────────

/**
 * Preload active lifecycle handoff states from DB into RAM cache.
 * Called on server startup for crash recovery.
 * @returns {number} Number of states preloaded
 */
export function preloadActiveLifecycles() {
  if (!_handoffDb) return 0;

  try {
    const rows = _handoffDb.findAllActive.all();
    let loaded = 0;

    for (const row of rows) {
      // Skip if lifecycle actually completed/failed (stale handoff entry)
      if (row.lc_phase === 'COMPLETED' || row.lc_phase === 'FAILED') {
        _handoffDb.delete.run(row.session_id);
        continue;
      }

      lifecycleStates.set(row.session_id, {
        phase: row.phase,
        lifecycleId: row.lifecycle_id,
        currentMilestoneId: row.current_milestone_id,
        originalRequest: row.original_request,
        projectId: row.project_id,
        projectPath: row.project_path,
        changeRequestId: row.change_request_id || null,
        updatedAt: row.updated_at,
        restored: true, // Flag: this state was restored after crash/restart
      });
      loaded++;
    }

    if (loaded > 0) {
      logger.info('LifecycleState', `Preloaded ${loaded} active lifecycle handoff states from DB`);
    }

    return loaded;
  } catch (err) {
    logger.warn('LifecycleState', `Preload failed: ${err.message}`);
    return 0;
  }
}
