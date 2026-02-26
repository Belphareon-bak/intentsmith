// ══════════════════════════════════════════════════════════════════════════════
// Autonomy Drift Detector — baseline comparison + alert generation
// ══════════════════════════════════════════════════════════════════════════════
//
// Compares current window metrics against rolling baseline.
// Generates alerts when ASK_USER or break rates spike beyond thresholds.
//
// Hysteresis: drift must persist for 2 consecutive windows before reporting
// as actionable. Single spikes are logged as warnings but don't trigger.
//
// Never throws — returns safe defaults on error.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';

/**
 * Detect drift in current metrics vs baseline.
 *
 * @param {object} deps — { telemetryMetrics, telemetryAlerts, logger }
 * @param {object} currentMetrics — from aggregator
 * @returns {{ drifted: boolean, alerts: Array<{type: string, severity: string}> }}
 */
export function detectDrift(deps, currentMetrics) {
  const { telemetryMetrics, telemetryAlerts, logger } = deps;

  try {
    const guards = config.autonomy.rollbackGuards;
    const minTurns = config.autonomy.minTurnsPerWindow;
    const alerts = [];

    if (currentMetrics.totalTurns === 0) {
      return { drifted: false, alerts };
    }

    // Get baseline from last N qualifying windows
    const baseline = telemetryMetrics.baseline.get(minTurns, guards.baselineWindows);

    if (!baseline || baseline.avg_ask_user_rate == null) {
      // Not enough baseline data yet — no drift detection possible
      logger.debug('Autonomy', 'Drift detection skipped: insufficient baseline');
      return { drifted: false, alerts };
    }

    const currentAskUserRate = currentMetrics.askUserCount / currentMetrics.totalTurns;
    const currentBreakRate = currentMetrics.breakCount / currentMetrics.totalTurns;

    const askUserSpike = (currentAskUserRate - baseline.avg_ask_user_rate) * 100;
    const breakSpike = (currentBreakRate - baseline.avg_break_rate) * 100;

    let askUserDrifted = false;
    let breakDrifted = false;

    // Check ASK_USER spike
    if (askUserSpike > guards.askUserSpikePercent) {
      askUserDrifted = true;
      logger.debug('Autonomy', `ASK_USER spike: +${askUserSpike.toFixed(1)}% (threshold: +${guards.askUserSpikePercent}%)`);
    }

    // Check break spike
    if (breakSpike > guards.breakSpikePercent) {
      breakDrifted = true;
      logger.debug('Autonomy', `Break spike: +${breakSpike.toFixed(1)}% (threshold: +${guards.breakSpikePercent}%)`);
    }

    if (!askUserDrifted && !breakDrifted) {
      return { drifted: false, alerts };
    }

    // ── Hysteresis: check if drift persisted for 2 consecutive windows ──
    // Look at the most recent alert of each type
    const persistentDrift = checkHysteresis(deps, askUserDrifted, breakDrifted);

    if (askUserDrifted) {
      const severity = persistentDrift.askUser ? 'critical' : 'warning';
      telemetryAlerts.add.run(
        'ask_user_spike',
        severity,
        currentAskUserRate,
        baseline.avg_ask_user_rate,
        currentMetrics.thresholdAtTime,
        `ASK_USER spike: ${(currentAskUserRate * 100).toFixed(1)}% vs baseline ${(baseline.avg_ask_user_rate * 100).toFixed(1)}% (+${askUserSpike.toFixed(1)}pp)`,
      );
      alerts.push({ type: 'ask_user_spike', severity });
    }

    if (breakDrifted) {
      const severity = persistentDrift.break ? 'critical' : 'warning';
      telemetryAlerts.add.run(
        'break_spike',
        severity,
        currentBreakRate,
        baseline.avg_break_rate,
        currentMetrics.thresholdAtTime,
        `Break spike: ${(currentBreakRate * 100).toFixed(1)}% vs baseline ${(baseline.avg_break_rate * 100).toFixed(1)}% (+${breakSpike.toFixed(1)}pp)`,
      );
      alerts.push({ type: 'break_spike', severity });
    }

    // Only report as actionable drift if hysteresis confirms persistence
    const actionableDrift = persistentDrift.askUser || persistentDrift.break;

    return { drifted: actionableDrift, alerts };
  } catch (err) {
    logger.debug('Autonomy', `Drift detection error: ${err.message}`);
    return { drifted: false, alerts: [] };
  }
}

/**
 * Check if drift has persisted for 2 consecutive windows (hysteresis).
 * Looks at the most recent alert — if it's also a spike from the previous window,
 * the drift is confirmed as persistent.
 */
function checkHysteresis(deps, askUserDrifted, breakDrifted) {
  const { telemetryAlerts } = deps;
  const result = { askUser: false, break: false };

  try {
    if (askUserDrifted) {
      const recent = telemetryAlerts.recentByType.all('ask_user_spike', 1);
      if (recent.length > 0) {
        // If the last alert was within 2 windows, it's persistent
        const lastAlert = new Date(recent[0].created_at);
        const twoWindows = config.autonomy.intervalMs * 2;
        if (Date.now() - lastAlert.getTime() < twoWindows) {
          result.askUser = true;
        }
      }
    }

    if (breakDrifted) {
      const recent = telemetryAlerts.recentByType.all('break_spike', 1);
      if (recent.length > 0) {
        const lastAlert = new Date(recent[0].created_at);
        const twoWindows = config.autonomy.intervalMs * 2;
        if (Date.now() - lastAlert.getTime() < twoWindows) {
          result.break = true;
        }
      }
    }
  } catch {
    // Hysteresis check failure — default to no persistent drift
  }

  return result;
}
