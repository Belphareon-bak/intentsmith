// CRE v40.0 Latency Tracker
// ══════════════════════════════════════════════════════════════════════════════
//
// Real-time latency tracking per layer.
//
// Purpose:
//   Track latency distribution across system layers to identify bottlenecks.
//
// IMPORTANT: Percentiles use SLIDING WINDOW (not global)
//   - Prevents long sessions from corrupting statistics
//   - Default window: 100 samples per layer
//   - Configurable per use case
//
// Layers Tracked:
//   - CRE (decision making)
//   - Planner (plan generation)
//   - Executor (plan execution)
//   - LLM (language model calls)
//   - Tool (tool invocations)
//   - Memory (memory operations)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// LATENCY BUCKETS (for histogram)
// ════════════════════════════════════════════════════════════════════════════

export const LatencyBuckets = [
  10,     // 10ms
  50,     // 50ms
  100,    // 100ms
  250,    // 250ms
  500,    // 500ms
  1000,   // 1s
  2500,   // 2.5s
  5000,   // 5s
  10000,  // 10s
  30000,  // 30s
  Infinity,
];

// ════════════════════════════════════════════════════════════════════════════
// LATENCY RECORD
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} LatencyRecord
 * @property {string} layer - Layer name
 * @property {string} operation - Operation name
 * @property {number} latency - Latency in ms
 * @property {number} timestamp - When recorded
 * @property {Object} metadata - Additional metadata
 */

// ════════════════════════════════════════════════════════════════════════════
// LAYER STATS
// ════════════════════════════════════════════════════════════════════════════

/**
 * LayerStats — statistics for a single layer
 *
 * IMPORTANT: Uses SLIDING WINDOW for percentiles
 * - windowSize: max samples in window (default: 100)
 * - windowTimeMs: max age of samples (default: 5 minutes)
 * - Both conditions apply: samples must be recent AND within count limit
 */
export class LayerStats {
  constructor(layer, options = {}) {
    this.layer = layer;
    this.count = 0;
    this.totalLatency = 0;
    this.minLatency = Infinity;
    this.maxLatency = 0;
    this.histogram = new Array(LatencyBuckets.length).fill(0);

    // SLIDING WINDOW configuration
    this.windowSize = options.windowSize || 100;
    this.windowTimeMs = options.windowTimeMs || 5 * 60 * 1000; // 5 minutes
    this.recentLatencies = []; // Array of { latency, timestamp }

    // Percentile cache (invalidated on new data)
    this.percentileCache = null;
    this.percentileCacheCount = 0;
  }

  /**
   * Prune old entries from sliding window
   */
  _pruneWindow() {
    const cutoff = Date.now() - this.windowTimeMs;
    this.recentLatencies = this.recentLatencies.filter(r => r.timestamp >= cutoff);

    // Also limit by count
    while (this.recentLatencies.length > this.windowSize) {
      this.recentLatencies.shift();
    }
  }

  /**
   * Record a latency (with timestamp for sliding window)
   */
  record(latency) {
    const now = Date.now();

    // Global stats (all-time)
    this.count++;
    this.totalLatency += latency;
    this.minLatency = Math.min(this.minLatency, latency);
    this.maxLatency = Math.max(this.maxLatency, latency);

    // Update histogram
    for (let i = 0; i < LatencyBuckets.length; i++) {
      if (latency <= LatencyBuckets[i]) {
        this.histogram[i]++;
        break;
      }
    }

    // Add to SLIDING WINDOW with timestamp
    this.recentLatencies.push({ latency, timestamp: now });

    // Prune old entries
    this._pruneWindow();

    // Invalidate percentile cache
    this.percentileCache = null;
  }

  /**
   * Get average latency (all-time)
   */
  getAverage() {
    return this.count > 0 ? this.totalLatency / this.count : 0;
  }

  /**
   * Get recent average (SLIDING WINDOW only)
   */
  getRecentAverage() {
    this._pruneWindow();
    if (this.recentLatencies.length === 0) return 0;
    const sum = this.recentLatencies.reduce((a, b) => a + b.latency, 0);
    return sum / this.recentLatencies.length;
  }

  /**
   * Get percentile (p50, p90, p95, p99) from SLIDING WINDOW
   *
   * IMPORTANT: Only uses recent samples, not all-time data
   */
  getPercentile(p) {
    this._pruneWindow();
    if (this.recentLatencies.length === 0) return 0;

    // Use cached sorted array if available and valid
    if (!this.percentileCache || this.percentileCacheCount !== this.recentLatencies.length) {
      this.percentileCache = this.recentLatencies
        .map(r => r.latency)
        .sort((a, b) => a - b);
      this.percentileCacheCount = this.recentLatencies.length;
    }

    const index = Math.ceil((p / 100) * this.percentileCache.length) - 1;
    return this.percentileCache[Math.max(0, index)];
  }

  /**
   * Get window stats (how many samples, time span)
   */
  getWindowStats() {
    this._pruneWindow();
    if (this.recentLatencies.length === 0) {
      return { count: 0, oldestMs: null, newestMs: null, spanMs: 0 };
    }
    const oldest = this.recentLatencies[0].timestamp;
    const newest = this.recentLatencies[this.recentLatencies.length - 1].timestamp;
    return {
      count: this.recentLatencies.length,
      oldestMs: oldest,
      newestMs: newest,
      spanMs: newest - oldest,
    };
  }

  /**
   * Get histogram as percentages
   */
  getHistogramPercentages() {
    if (this.count === 0) return this.histogram.map(() => 0);
    return this.histogram.map(h => (h / this.count) * 100);
  }

  /**
   * Get summary (includes window stats)
   */
  getSummary() {
    this._pruneWindow();
    const windowStats = this.getWindowStats();

    return {
      layer: this.layer,
      // All-time stats
      count: this.count,
      average: this.getAverage(),
      min: this.minLatency === Infinity ? 0 : this.minLatency,
      max: this.maxLatency,
      // SLIDING WINDOW stats (these are what you should use for monitoring)
      recentAverage: this.getRecentAverage(),
      p50: this.getPercentile(50),
      p90: this.getPercentile(90),
      p95: this.getPercentile(95),
      p99: this.getPercentile(99),
      // Window info
      windowSamples: windowStats.count,
      windowSpanMs: windowStats.spanMs,
    };
  }

  /**
   * Reset stats (all-time AND window)
   */
  reset() {
    this.count = 0;
    this.totalLatency = 0;
    this.minLatency = Infinity;
    this.maxLatency = 0;
    this.histogram = new Array(LatencyBuckets.length).fill(0);
    this.recentLatencies = [];
    this.percentileCache = null;
  }

  /**
   * Reset only the sliding window (keeps all-time stats)
   */
  resetWindow() {
    this.recentLatencies = [];
    this.percentileCache = null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LATENCY TRACKER
// ════════════════════════════════════════════════════════════════════════════

/**
 * LatencyTracker — tracks latency across all layers
 */
export class LatencyTracker {
  constructor(options = {}) {
    this.layers = new Map();  // layer → LayerStats
    this.operations = new Map();  // operation → LayerStats

    // Recent records (for debugging)
    this.maxRecords = options.maxRecords || 1000;
    this.records = [];

    // Thresholds for alerts
    this.thresholds = {
      cre: options.creThreshold || 100,
      planner: options.plannerThreshold || 500,
      executor: options.executorThreshold || 1000,
      llm: options.llmThreshold || 5000,
      tool: options.toolThreshold || 2000,
      memory: options.memoryThreshold || 50,
    };

    // Alert callback
    this.onAlert = options.onAlert || null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RECORDING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record a latency measurement
   */
  record(layer, latency, options = {}) {
    const { operation = 'default', metadata = {} } = options;

    // Get or create layer stats
    if (!this.layers.has(layer)) {
      this.layers.set(layer, new LayerStats(layer));
    }
    this.layers.get(layer).record(latency);

    // Get or create operation stats
    const opKey = `${layer}:${operation}`;
    if (!this.operations.has(opKey)) {
      this.operations.set(opKey, new LayerStats(opKey));
    }
    this.operations.get(opKey).record(latency);

    // Store record
    const record = {
      layer,
      operation,
      latency,
      timestamp: Date.now(),
      metadata,
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    // Check threshold
    this.checkThreshold(layer, latency, record);

    return record;
  }

  /**
   * Start a timer (returns a function to stop and record)
   */
  startTimer(layer, options = {}) {
    const startTime = performance.now();
    return (extraMetadata = {}) => {
      const latency = performance.now() - startTime;
      return this.record(layer, latency, {
        ...options,
        metadata: { ...options.metadata, ...extraMetadata },
      });
    };
  }

  /**
   * Wrap an async function with latency tracking
   */
  wrap(layer, fn, options = {}) {
    return async (...args) => {
      const stop = this.startTimer(layer, options);
      try {
        const result = await fn(...args);
        stop({ success: true });
        return result;
      } catch (error) {
        stop({ success: false, error: error.message });
        throw error;
      }
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // THRESHOLD CHECKING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if latency exceeds threshold
   */
  checkThreshold(layer, latency, record) {
    const threshold = this.thresholds[layer];
    if (threshold && latency > threshold) {
      const alert = {
        type: 'latency_threshold',
        layer,
        latency,
        threshold,
        exceededBy: latency - threshold,
        record,
        timestamp: Date.now(),
      };

      logger.warn('LatencyTracker', `Threshold exceeded: ${layer}`, {
        latency: `${latency.toFixed(2)}ms`,
        threshold: `${threshold}ms`,
      });

      if (this.onAlert) {
        try {
          this.onAlert(alert);
        } catch (e) {
          logger.error('LatencyTracker', 'Alert callback error', { error: e.message });
        }
      }

      return alert;
    }
    return null;
  }

  /**
   * Set threshold for a layer
   */
  setThreshold(layer, threshold) {
    this.thresholds[layer] = threshold;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get stats for a layer
   */
  getLayerStats(layer) {
    return this.layers.get(layer)?.getSummary() || null;
  }

  /**
   * Get stats for an operation
   */
  getOperationStats(layer, operation) {
    return this.operations.get(`${layer}:${operation}`)?.getSummary() || null;
  }

  /**
   * Get all layer stats
   */
  getAllStats() {
    const stats = {};
    for (const [layer, layerStats] of this.layers) {
      stats[layer] = layerStats.getSummary();
    }
    return stats;
  }

  /**
   * Get recent records
   */
  getRecent(limit = 20) {
    return this.records.slice(-limit).reverse();
  }

  /**
   * Get slow operations
   */
  getSlow(threshold = 1000) {
    return this.records.filter(r => r.latency > threshold);
  }

  /**
   * Get records by layer
   */
  getByLayer(layer, limit = 100) {
    return this.records
      .filter(r => r.layer === layer)
      .slice(-limit)
      .reverse();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ANALYSIS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get latency breakdown (percentage of time per layer)
   */
  getBreakdown() {
    const stats = this.getAllStats();
    const total = Object.values(stats).reduce((sum, s) => sum + (s.average * s.count), 0);

    if (total === 0) return {};

    const breakdown = {};
    for (const [layer, layerStats] of Object.entries(stats)) {
      const layerTime = layerStats.average * layerStats.count;
      breakdown[layer] = {
        percentage: (layerTime / total) * 100,
        averageMs: layerStats.average,
        count: layerStats.count,
      };
    }

    return breakdown;
  }

  /**
   * Get bottleneck (slowest layer by average)
   */
  getBottleneck() {
    const stats = this.getAllStats();
    let bottleneck = null;
    let maxAvg = 0;

    for (const [layer, layerStats] of Object.entries(stats)) {
      if (layerStats.average > maxAvg) {
        maxAvg = layerStats.average;
        bottleneck = { layer, ...layerStats };
      }
    }

    return bottleneck;
  }

  /**
   * Get comparison report
   */
  getReport() {
    const stats = this.getAllStats();
    const breakdown = this.getBreakdown();
    const bottleneck = this.getBottleneck();

    return {
      layers: stats,
      breakdown,
      bottleneck,
      totalRecords: this.records.length,
      thresholds: this.thresholds,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reset all stats
   */
  reset() {
    for (const layerStats of this.layers.values()) {
      layerStats.reset();
    }
    for (const opStats of this.operations.values()) {
      opStats.reset();
    }
    this.records = [];
  }

  /**
   * Reset stats for a layer
   */
  resetLayer(layer) {
    if (this.layers.has(layer)) {
      this.layers.get(layer).reset();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const latencyTracker = new LatencyTracker();

export default LatencyTracker;
