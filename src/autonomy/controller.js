// ══════════════════════════════════════════════════════════════════════════════
// Autonomy Controller — orchestrates aggregate → detect → propose → apply
// ══════════════════════════════════════════════════════════════════════════════
//
// Central loop for Guarded Autonomy MVP v1.
//
// Lifecycle per cycle:
//   1. Aggregate telemetry window → telemetry_metrics
//   2. Cooldown check (anti-oscillation)
//   3. Drift detection with hysteresis
//   4. Rollback if drift persists + latest improvement is 'applied'
//   5. Propose threshold adjustment if needed
//   6. Trust-gated auto-apply (10 consecutive approvals → auto mode)
//
// Exports:
//   - restoreThreshold(db, creEngine, logger) — call on startup
//   - runAutonomyCycle(db, creEngine, logger)  — call on interval
//
// Never throws — all errors logged, cycle continues.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { aggregate } from './aggregator.js';
import { detectDrift } from './drift-detector.js';
import {
  telemetryMetrics,
  telemetryAlerts,
  telemetryImprovements,
} from '../db/database.js';

// ─── Startup restoration ────────────────────────────────────────────────────

/**
 * Restore the last applied threshold from DB on server startup.
 * Source of truth is the DB, not in-memory state.
 */
export function restoreThreshold(db, creEngine, logger) {
  try {
    const latest = telemetryImprovements.latestApplied.get('overrideThreshold');
    if (latest) {
      creEngine.setOverrideThreshold(latest.new_value);
      logger.info('Autonomy', `Restored overrideThreshold=${latest.new_value} from improvement #${latest.id}`);
    } else {
      logger.debug('Autonomy', `No applied improvements found, using default threshold=${creEngine.getOverrideThreshold()}`);
    }
  } catch (err) {
    logger.debug('Autonomy', `Threshold restoration skipped: ${err.message}`);
  }
}

// ─── Main cycle ─────────────────────────────────────────────────────────────

/**
 * Run one autonomy cycle. Called every 15 minutes by setInterval.
 */
export function runAutonomyCycle(db, creEngine, logger) {
  try {
    const deps = { db: db.db ?? db, telemetryMetrics, telemetryAlerts, telemetryImprovements, creEngine, logger };

    // ── Step 1: Aggregate ──
    const result = aggregate(deps, new Date());
    if (!result) {
      logger.debug('Autonomy', 'Cycle: aggregation returned null, skipping');
      return;
    }

    if (result.lowVolume) {
      logger.debug('Autonomy', `Cycle: low volume (${result.metrics.totalTurns} turns), skipping tuning`);
      return;
    }

    // ── Step 2: Cooldown check ──
    if (isInCooldown(logger)) {
      logger.debug('Autonomy', 'Cycle: in cooldown, skipping tuning');
      return;
    }

    // ── Step 3: Drift detection ──
    const drift = detectDrift(deps, result.metrics);

    // ── Step 4: Rollback if drift persists ──
    if (drift.drifted) {
      handleRollback(deps, drift, logger);
      return; // Don't propose new changes during drift
    }

    // ── Step 5: Propose threshold adjustment ──
    const proposal = evaluateProposal(result.metrics, creEngine, logger);
    if (!proposal) {
      return; // No change needed
    }

    // ── Step 6: Trust-gated apply ──
    applyOrPropose(deps, proposal, creEngine, logger);

  } catch (err) {
    logger.debug('Autonomy', `Cycle error: ${err.message}`);
  }
}

// ─── Cooldown ───────────────────────────────────────────────────────────────

function isInCooldown(logger) {
  try {
    const latest = telemetryImprovements.latestByParam.get('overrideThreshold');
    if (!latest || latest.status === 'proposed' || latest.status === 'rejected') {
      return false;
    }

    // Check if applied/rolled_back within cooldown window
    const appliedAt = latest.applied_at ? new Date(latest.applied_at) : new Date(latest.created_at);
    const cooldownMs = config.autonomy.rollbackGuards.cooldownWindows * config.autonomy.intervalMs;
    const elapsed = Date.now() - appliedAt.getTime();

    if (elapsed < cooldownMs) {
      return true;
    }
  } catch {
    // Cooldown check failure — safe to proceed
  }
  return false;
}

// ─── Rollback ───────────────────────────────────────────────────────────────

function handleRollback(deps, drift, logger) {
  try {
    const latest = telemetryImprovements.latestByParam.get('overrideThreshold');

    // One-shot guard: only rollback 'applied' improvements
    if (!latest || latest.status !== 'applied') {
      logger.debug('Autonomy', 'Drift detected but no applied improvement to rollback');
      return;
    }

    const triggerType = drift.alerts.find(a => a.severity === 'critical')?.type || 'unknown';

    // Rollback: restore old value
    deps.creEngine.setOverrideThreshold(latest.old_value);
    telemetryImprovements.updateStatus.run('rolled_back', 'rolled_back', latest.id);

    logger.info('Autonomy', `ROLLBACK: overrideThreshold ${latest.new_value} → ${latest.old_value} (trigger: ${triggerType})`);

    // Record rollback alert
    telemetryAlerts.add.run(
      'rollback',
      'critical',
      latest.new_value,
      latest.old_value,
      deps.creEngine.getOverrideThreshold(),
      `Rolled back improvement #${latest.id}: ${latest.new_value} → ${latest.old_value} (${triggerType})`,
    );
  } catch (err) {
    logger.debug('Autonomy', `Rollback error: ${err.message}`);
  }
}

// ─── Proposal evaluation ────────────────────────────────────────────────────

function evaluateProposal(metrics, creEngine, logger) {
  try {
    const params = config.autonomy.parameters.overrideThreshold;
    const currentThreshold = creEngine.getOverrideThreshold();

    if (metrics.totalTurns === 0) return null;

    const askUserRate = metrics.askUserCount / metrics.totalTurns;
    const breakRate = metrics.breakCount / metrics.totalTurns;
    const overrideRate = metrics.overrideCount / metrics.totalTurns;

    // Strategy: lower threshold if too many ASK_USER, raise if overrides are working well

    // If ASK_USER rate > 10% and we can lower → propose lowering
    if (askUserRate > 0.10 && currentThreshold > params.min) {
      const step = Math.min(params.maxStep, currentThreshold - params.min);
      const newValue = Math.max(params.min, currentThreshold - step);
      if (newValue !== currentThreshold) {
        return {
          parameter: 'overrideThreshold',
          oldValue: currentThreshold,
          newValue: Math.round(newValue * 1000) / 1000, // round to 3 decimals
          reason: `ASK_USER rate ${(askUserRate * 100).toFixed(1)}% > 10%, lowering threshold to catch more follow-ups`,
        };
      }
    }

    // If override rate > 15% AND ask_user+break rates are low → system is confident, try raising
    if (overrideRate > 0.15 && askUserRate < 0.05 && breakRate < 0.03 && currentThreshold < params.max) {
      const step = Math.min(params.maxStep, params.max - currentThreshold);
      const newValue = Math.min(params.max, currentThreshold + step);
      if (newValue !== currentThreshold) {
        return {
          parameter: 'overrideThreshold',
          oldValue: currentThreshold,
          newValue: Math.round(newValue * 1000) / 1000,
          reason: `Override rate ${(overrideRate * 100).toFixed(1)}% with low ASK_USER ${(askUserRate * 100).toFixed(1)}%, raising threshold for precision`,
        };
      }
    }

    return null; // No change needed
  } catch (err) {
    logger.debug('Autonomy', `Proposal evaluation error: ${err.message}`);
    return null;
  }
}

// ─── Trust-gated apply ──────────────────────────────────────────────────────

function applyOrPropose(deps, proposal, creEngine, logger) {
  try {
    const trustThreshold = config.autonomy.trustThreshold;

    // Count consecutive applied improvements
    const trustResult = telemetryImprovements.consecutiveApplied.get(
      proposal.parameter,
      trustThreshold,
    );
    const trustLevel = trustResult?.count ?? 0;

    if (trustLevel >= trustThreshold) {
      // Auto-apply: trust has been established
      telemetryImprovements.add.run(
        proposal.parameter,
        proposal.oldValue,
        proposal.newValue,
        proposal.reason,
        'applied',
        trustLevel,
        1, // auto_applied = true
      );
      creEngine.setOverrideThreshold(proposal.newValue);

      logger.info('Autonomy', `AUTO-APPLY: overrideThreshold ${proposal.oldValue} → ${proposal.newValue} (trust: ${trustLevel}, reason: ${proposal.reason})`);
    } else {
      // Propose only — operator must approve
      telemetryImprovements.add.run(
        proposal.parameter,
        proposal.oldValue,
        proposal.newValue,
        proposal.reason,
        'proposed',
        trustLevel,
        0, // auto_applied = false
      );

      logger.info('Autonomy', `PROPOSED: overrideThreshold ${proposal.oldValue} → ${proposal.newValue} (trust: ${trustLevel}/${trustThreshold}, awaiting approval)`);
    }
  } catch (err) {
    logger.debug('Autonomy', `Apply/propose error: ${err.message}`);
  }
}
