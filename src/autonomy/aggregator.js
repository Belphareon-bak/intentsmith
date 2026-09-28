// ══════════════════════════════════════════════════════════════════════════════
// Autonomy Aggregator — 15-min metric windows from telemetry snapshots
// ══════════════════════════════════════════════════════════════════════════════
//
// Reads raw telemetry_snapshots, parses v2 diag data, and computes per-window
// aggregated metrics. Inserts into telemetry_metrics.
//
// Never throws — returns null on error.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';

export const TELEMETRY_AGGREGATION_VERSION = 2;

/**
 * Aggregate telemetry snapshots for a time window.
 *
 * @param {object} deps — { db, telemetryMetrics, telemetryAlerts, creEngine, logger }
 * @param {Date} [windowEnd] — end of window (default: now)
 * @returns {{ metrics: object, lowVolume: boolean } | null}
 */
export function aggregate(deps, windowEnd = new Date()) {
  const { db, telemetryMetrics, telemetryAlerts, creEngine, logger } = deps;

  try {
    const intervalMs = config.autonomy.intervalMs;
    const windowEndISO = windowEnd.toISOString();
    const windowStartISO = new Date(windowEnd.getTime() - intervalMs).toISOString();
    const windowEndSql = toSqliteTimestamp(windowEnd);
    const windowStartSql = toSqliteTimestamp(new Date(windowEnd.getTime() - intervalMs));

    // Query raw snapshots in this window
    const rows = db.prepare(`
      SELECT snapshot_json FROM telemetry_snapshots
      WHERE created_at >= ? AND created_at < ?
    `).all(windowStartSql, windowEndSql);

    const observedTurns = rows.length;
    let totalTurns = 0;
    let ambiguousCount = 0;
    let askUserCount = 0;
    let breakCount = 0;
    let overrideCount = 0;
    let confidenceSum = 0;
    let confidenceN = 0;
    const ruleCounts = {};

    for (const row of rows) {
      try {
        const snapshot = JSON.parse(row.snapshot_json);
        const diag = snapshot.classification?.diag;

        if (!Number.isInteger(snapshot.version) || snapshot.version < 2 || !isEligibleDiag(diag)) {
          continue;
        }
        totalTurns++;

        // M1: initial AMBIGUOUS
        if (diag.initialIntent === 'AMBIGUOUS') {
          ambiguousCount++;
        }

        // ASK_USER: finalIntent still AMBIGUOUS AND no override applied
        // (true unresolved AMBIGUOUS, not benign transient)
        if (diag.finalIntent === 'AMBIGUOUS' && (!diag.overrides || diag.overrides.length === 0)) {
          askUserCount++;
        }

        // Break count
        if (diag.isIntentBreak) {
          breakCount++;
        }

        // Override count
        if (diag.overrides && diag.overrides.length > 0) {
          overrideCount++;
        }

        // Confidence from follow-up
        if (diag.followUp?.confidence != null) {
          confidenceSum += diag.followUp.confidence;
          confidenceN++;
        }

        // Rule distribution
        if (diag.followUp?.rule) {
          const rule = diag.followUp.rule;
          ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
        }
      } catch {
        // Malformed snapshot — skip
      }
    }

    const avgConfidence = confidenceN > 0 ? confidenceSum / confidenceN : null;
    const thresholdAtTime = creEngine.getOverrideThreshold();

    // Insert metrics row
    telemetryMetrics.add.run(
      windowStartISO,
      windowEndISO,
      totalTurns,
      ambiguousCount,
      askUserCount,
      breakCount,
      overrideCount,
      avgConfidence,
      thresholdAtTime,
      JSON.stringify(ruleCounts),
      TELEMETRY_AGGREGATION_VERSION,
    );

    // Low volume check
    const minTurns = config.autonomy.minTurnsPerWindow;
    const lowVolume = totalTurns < minTurns;

    if (lowVolume) {
      telemetryAlerts.add.run(
        'low_volume',
        'warning',
        totalTurns,
        minTurns,
        thresholdAtTime,
        `Low volume: ${totalTurns} turns in window (min: ${minTurns})`,
      );
    }

    logger.debug(
      'Autonomy',
      `Aggregated window: ${totalTurns}/${observedTurns} eligible turns, ${ambiguousCount} ambiguous, ${askUserCount} ask_user, ${breakCount} breaks, threshold=${thresholdAtTime}`,
    );

    return {
      metrics: {
        windowStart: windowStartISO,
        windowEnd: windowEndISO,
        observedTurns,
        totalTurns,
        ambiguousCount,
        askUserCount,
        breakCount,
        overrideCount,
        avgConfidence,
        thresholdAtTime,
        ruleCounts,
      },
      lowVolume,
    };
  } catch (err) {
    logger.debug('Autonomy', `Aggregation error: ${err.message}`);
    return null;
  }
}

function isEligibleDiag(diag) {
  if (!diag || typeof diag !== 'object' || Array.isArray(diag)) return false;
  if (typeof diag.initialIntent !== 'string' || typeof diag.finalIntent !== 'string') return false;
  if (typeof diag.isIntentBreak !== 'boolean') return false;

  if (diag.overrides != null) {
    if (!Array.isArray(diag.overrides) || !diag.overrides.every(value => typeof value === 'string')) {
      return false;
    }
  }

  if (diag.followUp != null) {
    if (typeof diag.followUp !== 'object' || Array.isArray(diag.followUp)) return false;
    if (diag.followUp.rule != null && typeof diag.followUp.rule !== 'string') return false;
    if (diag.followUp.type != null && typeof diag.followUp.type !== 'string') return false;
    if (
      diag.followUp.confidence != null
      && (
        typeof diag.followUp.confidence !== 'number'
        || !Number.isFinite(diag.followUp.confidence)
        || diag.followUp.confidence < 0
        || diag.followUp.confidence > 1
      )
    ) {
      return false;
    }
  }

  return true;
}

function toSqliteTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
