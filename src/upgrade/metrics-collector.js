/**
 * metrics-collector.js — v120 Phase 3
 *
 * Batch-buffered, fire-and-forget recording of model performance events.
 * Aggregation with task weighting, outlier filter, recency decay,
 * Bayesian smoothing, difficulty normalization, drift detection, blacklist.
 */

export const TASK_WEIGHTS = { patch: 1.0, checkpoint: 0.8, build: 0.6 };
export const PRIOR_SUCCESS = 0.5;
export const K = 5;

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 5;
const DISABLE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const OUTLIER_MULTIPLIER = 5;
const MAX_ITERATIONS_OUTLIER = 20;
const RECENCY_HALF_LIFE_DAYS = 60;
const DRIFT_RECENT_WINDOW = 20;
const DRIFT_THRESHOLD = 0.8;
const BLACKLIST_MIN_SAMPLES = 20;
const BLACKLIST_SUCCESS_THRESHOLD = 0.2;

export class MetricsCollector {
  constructor() {
    this._db = null;
    this._buffer = [];
    this._flushTimer = null;
    this._consecutiveFailures = 0;
    this._disabledUntil = 0;
    this._insertStmt = null;
  }

  setDb(db) {
    this._db = db;
    this._insertStmt = null;
  }

  /**
   * Buffer an event. Flushes on BATCH_SIZE events OR FLUSH_INTERVAL_MS.
   * Fire-and-forget — never throws.
   */
  recordEvent({ role, model, taskType, success, iterations, tokens, durationMs,
                errorsFixed, errorsRemaining, stopReason, lifecycleId, milestoneId, detail }) {
    try {
      if (!this._db) return;
      if (Date.now() < this._disabledUntil) return;

      this._buffer.push({
        role, model, taskType,
        success: success ? 1 : 0,
        iterations: iterations ?? 1,
        tokens: tokens ?? 0,
        durationMs: durationMs ?? 0,
        errorsFixed: errorsFixed ?? 0,
        errorsRemaining: errorsRemaining ?? 0,
        stopReason: stopReason ?? null,
        lifecycleId: lifecycleId ?? null,
        milestoneId: milestoneId ?? null,
        detailJson: detail ? JSON.stringify(detail) : null,
      });

      if (this._buffer.length >= BATCH_SIZE) {
        this._flush();
      } else if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => this._flush(), FLUSH_INTERVAL_MS);
      }
    } catch (_) { /* fire-and-forget */ }
  }

  /**
   * Batch INSERT OR IGNORE in a single transaction.
   */
  _flush() {
    try {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      if (!this._db || this._buffer.length === 0) return;

      if (!this._insertStmt) {
        this._insertStmt = this._db.prepare(`
          INSERT OR IGNORE INTO model_performance
            (role, model, task_type, success, iterations, tokens, duration_ms,
             errors_fixed, errors_remaining, stop_reason, lifecycle_id, milestone_id, detail_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
      }

      const batch = [...this._buffer];
      const tx = this._db.transaction((rows) => {
        for (const r of rows) {
          this._insertStmt.run(
            r.role, r.model, r.taskType, r.success, r.iterations, r.tokens, r.durationMs,
            r.errorsFixed, r.errorsRemaining, r.stopReason, r.lifecycleId, r.milestoneId, r.detailJson
          );
        }
      });
      tx(batch);
      this._buffer.splice(0, batch.length);
      this._consecutiveFailures = 0;
    } catch (_) {
      this._consecutiveFailures++;
      if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._disabledUntil = Date.now() + DISABLE_DURATION_MS;
      }
    }
  }

  /**
   * Force flush — used in tests and shutdown.
   */
  flush() {
    this._flush();
  }

  /**
   * Aggregate metrics for a specific role+model.
   * Applies: outlier filter, task weighting, recency decay, Bayesian smoothing,
   * difficulty normalization.
   */
  getAggregatedMetrics(role, model) {
    try {
      if (!this._db) return null;
      this._flush(); // ensure buffer is written

      const rows = this._db.prepare(
        `SELECT * FROM model_performance WHERE role = ? AND model = ? ORDER BY created_at DESC`
      ).all(role, model);

      if (!rows || rows.length === 0) return null;
      return this._aggregate(rows);
    } catch (_) {
      return null;
    }
  }

  /**
   * All models with data for a given role.
   */
  getAllMetricsForRole(role) {
    try {
      if (!this._db) return new Map();
      this._flush();

      const rows = this._db.prepare(
        `SELECT * FROM model_performance WHERE role = ? ORDER BY created_at DESC`
      ).all(role);

      if (!rows || rows.length === 0) return new Map();

      // Group by model
      const byModel = new Map();
      for (const row of rows) {
        if (!byModel.has(row.model)) byModel.set(row.model, []);
        byModel.get(row.model).push(row);
      }

      const result = new Map();
      for (const [m, mRows] of byModel) {
        const agg = this._aggregate(mRows);
        if (agg) result.set(m, agg);
      }
      return result;
    } catch (_) {
      return new Map();
    }
  }

  /**
   * Drift detection: compare recent DRIFT_RECENT_WINDOW samples vs all samples.
   */
  detectDrift(role, model) {
    try {
      if (!this._db) return { drifted: false, recentScore: 0, historicalScore: 0 };
      this._flush();

      const rows = this._db.prepare(
        `SELECT * FROM model_performance WHERE role = ? AND model = ? ORDER BY created_at DESC`
      ).all(role, model);

      if (!rows || rows.length < DRIFT_RECENT_WINDOW + 5) {
        return { drifted: false, recentScore: 0, historicalScore: 0 };
      }

      const recentRows = rows.slice(0, DRIFT_RECENT_WINDOW);
      const recentAgg = this._aggregate(recentRows);
      const historicalAgg = this._aggregate(rows);

      if (!recentAgg || !historicalAgg) {
        return { drifted: false, recentScore: 0, historicalScore: 0 };
      }

      const recentScore = (recentAgg.smoothedPatchSuccess ?? 0) * 0.6 +
                          (recentAgg.smoothedCheckpointPass ?? 0) * 0.4;
      const historicalScore = (historicalAgg.smoothedPatchSuccess ?? 0) * 0.6 +
                              (historicalAgg.smoothedCheckpointPass ?? 0) * 0.4;

      return {
        drifted: historicalScore > 0 && recentScore < historicalScore * DRIFT_THRESHOLD,
        recentScore,
        historicalScore,
      };
    } catch (_) {
      return { drifted: false, recentScore: 0, historicalScore: 0 };
    }
  }

  /**
   * Blacklist check: patchSuccessRate < BLACKLIST_SUCCESS_THRESHOLD after BLACKLIST_MIN_SAMPLES.
   */
  isBlacklisted(role, model) {
    try {
      if (!this._db) return false;
      this._flush();

      const row = this._db.prepare(
        `SELECT COUNT(*) as total, SUM(success) as successes
         FROM model_performance
         WHERE role = ? AND model = ? AND task_type = 'patch'`
      ).get(role, model);

      if (!row || row.total < BLACKLIST_MIN_SAMPLES) return false;
      return (row.successes / row.total) < BLACKLIST_SUCCESS_THRESHOLD;
    } catch (_) {
      return false;
    }
  }

  /**
   * Internal: aggregate rows with all Phase 3 amendments.
   */
  _aggregate(rows) {
    if (!rows || rows.length === 0) return null;

    // --- Pass 1: compute medians for outlier detection ---
    const tokenValues = rows.filter(r => r.tokens > 0).map(r => r.tokens).sort((a, b) => a - b);
    const durationValues = rows.filter(r => r.duration_ms > 0).map(r => r.duration_ms).sort((a, b) => a - b);
    const medianTokens = _median(tokenValues);
    const medianDurationMs = _median(durationValues);

    // --- Pass 2: filter outliers ---
    const filtered = rows.filter(r => {
      if (r.iterations > MAX_ITERATIONS_OUTLIER) return false;
      if (medianTokens > 0 && r.tokens > medianTokens * OUTLIER_MULTIPLIER) return false;
      if (medianDurationMs > 0 && r.duration_ms > medianDurationMs * OUTLIER_MULTIPLIER) return false;
      return true;
    });

    if (filtered.length === 0) return null;

    // --- Pass 3: weighted aggregation with recency decay + task weighting + difficulty ---
    const now = Date.now();
    let totalWeight = 0;
    let weightedSuccess = 0;
    let patchWeight = 0, patchWeightedSuccess = 0;
    let checkpointWeight = 0, checkpointWeightedSuccess = 0;
    let tokenSum = 0, tokenWeightSum = 0;
    let iterSum = 0, iterWeightSum = 0;
    let durationSum = 0, durationWeightSum = 0;
    let rawPatchTotal = 0, rawPatchSuccess = 0;
    let rawCheckpointTotal = 0, rawCheckpointSuccess = 0;

    for (const r of filtered) {
      const daysSince = (now - Date.parse(r.created_at)) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS);
      const taskWeight = TASK_WEIGHTS[r.task_type] ?? 0.5;

      // Difficulty normalization: harder tasks (more errors to fix) get bonus
      const difficultyFactor = Math.max(0.5, Math.min(1.5,
        (r.errors_fixed ?? 0) / ((r.errors_fixed ?? 0) + (r.errors_remaining ?? 0) + 1)
      ));

      const w = recencyWeight * taskWeight;
      totalWeight += w;
      weightedSuccess += r.success * w * difficultyFactor;

      if (r.task_type === 'patch') {
        patchWeight += w;
        patchWeightedSuccess += r.success * w * difficultyFactor;
        rawPatchTotal++;
        rawPatchSuccess += r.success;
      } else if (r.task_type === 'checkpoint') {
        checkpointWeight += w;
        checkpointWeightedSuccess += r.success * w;
        rawCheckpointTotal++;
        rawCheckpointSuccess += r.success;
      }

      if (r.tokens > 0) {
        tokenSum += r.tokens * w;
        tokenWeightSum += w;
      }
      if (r.iterations > 0) {
        iterSum += r.iterations * w;
        iterWeightSum += w;
      }
      if (r.duration_ms > 0) {
        durationSum += r.duration_ms * w;
        durationWeightSum += w;
      }
    }

    // Weighted rates
    const patchSuccessRate = patchWeight > 0 ? patchWeightedSuccess / patchWeight : 0;
    const checkpointPassRate = checkpointWeight > 0 ? checkpointWeightedSuccess / checkpointWeight : 0;

    // Bayesian smoothing
    const smoothedPatchSuccess = rawPatchTotal > 0
      ? (rawPatchSuccess + PRIOR_SUCCESS * K) / (rawPatchTotal + K)
      : PRIOR_SUCCESS;
    const smoothedCheckpointPass = rawCheckpointTotal > 0
      ? (rawCheckpointSuccess + PRIOR_SUCCESS * K) / (rawCheckpointTotal + K)
      : PRIOR_SUCCESS;

    // Difficulty-adjusted success (weighted overall)
    const difficultyAdjustedSuccess = totalWeight > 0 ? weightedSuccess / totalWeight : 0;

    // Averages
    const avgTokens = tokenWeightSum > 0 ? tokenSum / tokenWeightSum : 0;
    const avgIterations = iterWeightSum > 0 ? iterSum / iterWeightSum : 0;
    const avgDurationMs = durationWeightSum > 0 ? durationSum / durationWeightSum : 0;

    // Re-compute medians from filtered set
    const filteredTokens = filtered.filter(r => r.tokens > 0).map(r => r.tokens).sort((a, b) => a - b);
    const filteredDurations = filtered.filter(r => r.duration_ms > 0).map(r => r.duration_ms).sort((a, b) => a - b);

    return {
      sampleCount: filtered.length,
      patchSuccessRate,
      checkpointPassRate,
      smoothedPatchSuccess,
      smoothedCheckpointPass,
      difficultyAdjustedSuccess,
      avgIterations,
      avgTokens,
      medianTokens: _median(filteredTokens),
      avgDurationMs,
      medianDurationMs: _median(filteredDurations),
    };
  }
}

function _median(sorted) {
  if (!sorted || sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const metricsCollector = new MetricsCollector();
