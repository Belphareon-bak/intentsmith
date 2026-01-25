// CRE v40.0 Failure Heatmap
// ══════════════════════════════════════════════════════════════════════════════
//
// Visual failure pattern tracking.
//
// Purpose:
//   Identify failure hotspots: which layers/tools/patterns fail most often.
//
// IMPORTANT: Patterns are VERSIONED
//   - patternId = hash(errorType + layer + behaviorVersion)
//   - Prevents pattern fragmentation after upgrades
//   - Allows tracking pattern changes across versions
//
// Dimensions:
//   - Layer (CRE, Planner, Executor, LLM, Tool)
//   - Error category
//   - Time bucket (hourly, daily)
//   - Operation type
//   - Behavior version
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { createHash } from 'crypto';

/**
 * Generate versioned pattern ID
 * patternId = hash(errorType + layer + behaviorVersion)
 */
function generatePatternId(layer, category, error, behaviorVersion = 'unknown') {
  const normalizedError = (error || '').slice(0, 100).toLowerCase().trim();
  const input = `${layer}:${category}:${normalizedError}:${behaviorVersion}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ════════════════════════════════════════════════════════════════════════════
// FAILURE CATEGORY
// ════════════════════════════════════════════════════════════════════════════

export const FailureCategory = {
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  RATE_LIMIT: 'rate_limit',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  NOT_FOUND: 'not_found',
  INTERNAL: 'internal',
  USER_ERROR: 'user_error',
  DEPENDENCY: 'dependency',
  UNKNOWN: 'unknown',
};

// ════════════════════════════════════════════════════════════════════════════
// FAILURE RECORD
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} FailureRecord
 * @property {string} id
 * @property {string} layer
 * @property {string} operation
 * @property {string} category
 * @property {string} error
 * @property {number} timestamp
 * @property {Object} context
 */

// ════════════════════════════════════════════════════════════════════════════
// HEATMAP CELL
// ════════════════════════════════════════════════════════════════════════════

/**
 * HeatmapCell — aggregated failure data for a dimension pair
 */
export class HeatmapCell {
  constructor(dimension1, dimension2) {
    this.dimension1 = dimension1;
    this.dimension2 = dimension2;
    this.count = 0;
    this.lastSeen = null;
    this.recentErrors = [];
    this.maxRecentErrors = 5;
  }

  record(error, timestamp) {
    this.count++;
    this.lastSeen = timestamp;

    this.recentErrors.push({ error, timestamp });
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift();
    }
  }

  getIntensity(maxCount) {
    if (maxCount === 0) return 0;
    return this.count / maxCount;
  }

  toJSON() {
    return {
      dimension1: this.dimension1,
      dimension2: this.dimension2,
      count: this.count,
      lastSeen: this.lastSeen,
      recentErrors: this.recentErrors,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FAILURE HEATMAP
// ════════════════════════════════════════════════════════════════════════════

/**
 * FailureHeatmap — tracks failure patterns across dimensions
 *
 * VERSIONED PATTERNS: Patterns include behavior version to prevent
 * fragmentation after system upgrades.
 */
export class FailureHeatmap {
  constructor(options = {}) {
    // Current behavior version (for pattern versioning)
    this.behaviorVersion = options.behaviorVersion || 'unknown';

    // Heatmap matrices
    this.layerByCategory = new Map();      // layer:category → HeatmapCell
    this.layerByOperation = new Map();     // layer:operation → HeatmapCell
    this.categoryByOperation = new Map();  // category:operation → HeatmapCell
    this.layerByHour = new Map();          // layer:hour → HeatmapCell

    // VERSIONED PATTERNS: patternId → PatternInfo
    this.versionedPatterns = new Map();

    // All failures (for detailed analysis)
    this.maxFailures = options.maxFailures || 1000;
    this.failures = [];

    // Time series (hourly buckets)
    this.hourlyBuckets = new Map();  // hourKey → { total, byCategory }

    // Stats
    this.stats = {
      total: 0,
      byLayer: {},
      byCategory: {},
      byOperation: {},
      byVersion: {},
    };

    // Alert thresholds
    this.alertThreshold = options.alertThreshold || 10;  // failures per hour
    this.onAlert = options.onAlert || null;
  }

  /**
   * Set current behavior version
   */
  setBehaviorVersion(version) {
    this.behaviorVersion = version;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RECORDING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record a failure (with versioned pattern tracking)
   */
  record(failure) {
    const {
      layer,
      operation = 'unknown',
      category = FailureCategory.UNKNOWN,
      error = '',
      context = {},
      behaviorVersion = this.behaviorVersion,
    } = failure;

    const timestamp = Date.now();
    const id = `fail_${timestamp}_${Math.random().toString(36).substr(2, 6)}`;
    const errorStr = typeof error === 'string' ? error : error.message || String(error);

    // Generate VERSIONED pattern ID
    const patternId = generatePatternId(layer, category, errorStr, behaviorVersion);

    const record = {
      id,
      layer,
      operation,
      category,
      error: errorStr,
      timestamp,
      context,
      behaviorVersion,
      patternId,  // Include pattern ID in record
    };

    // Store failure
    this.failures.push(record);
    if (this.failures.length > this.maxFailures) {
      this.failures.shift();
    }

    // Update VERSIONED PATTERN tracking
    this.updateVersionedPattern(patternId, record);

    // Update heatmap cells
    this.updateCell(this.layerByCategory, `${layer}:${category}`, layer, category, error, timestamp);
    this.updateCell(this.layerByOperation, `${layer}:${operation}`, layer, operation, error, timestamp);
    this.updateCell(this.categoryByOperation, `${category}:${operation}`, category, operation, error, timestamp);

    // Update hourly heatmap
    const hourKey = this.getHourKey(timestamp);
    this.updateCell(this.layerByHour, `${layer}:${hourKey}`, layer, hourKey, error, timestamp);

    // Update hourly buckets
    this.updateHourlyBucket(hourKey, category);

    // Update stats
    this.stats.total++;
    this.stats.byLayer[layer] = (this.stats.byLayer[layer] || 0) + 1;
    this.stats.byCategory[category] = (this.stats.byCategory[category] || 0) + 1;
    this.stats.byOperation[operation] = (this.stats.byOperation[operation] || 0) + 1;
    this.stats.byVersion[behaviorVersion] = (this.stats.byVersion[behaviorVersion] || 0) + 1;

    // Check for alert
    this.checkAlert(layer, category, hourKey);

    logger.debug('FailureHeatmap', `Recorded: ${layer}/${category}`, { operation, patternId, error: record.error });

    return record;
  }

  /**
   * Update versioned pattern tracking
   */
  updateVersionedPattern(patternId, record) {
    if (!this.versionedPatterns.has(patternId)) {
      this.versionedPatterns.set(patternId, {
        patternId,
        layer: record.layer,
        category: record.category,
        errorSample: record.error.slice(0, 100),
        behaviorVersion: record.behaviorVersion,
        count: 0,
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
        operations: new Set(),
      });
    }

    const pattern = this.versionedPatterns.get(patternId);
    pattern.count++;
    pattern.lastSeen = record.timestamp;
    pattern.operations.add(record.operation);
  }

  /**
   * Update a heatmap cell
   */
  updateCell(map, key, dim1, dim2, error, timestamp) {
    if (!map.has(key)) {
      map.set(key, new HeatmapCell(dim1, dim2));
    }
    map.get(key).record(error, timestamp);
  }

  /**
   * Update hourly bucket
   */
  updateHourlyBucket(hourKey, category) {
    if (!this.hourlyBuckets.has(hourKey)) {
      this.hourlyBuckets.set(hourKey, {
        total: 0,
        byCategory: {},
        timestamp: Date.now(),
      });
    }

    const bucket = this.hourlyBuckets.get(hourKey);
    bucket.total++;
    bucket.byCategory[category] = (bucket.byCategory[category] || 0) + 1;
  }

  /**
   * Get hour key from timestamp
   */
  getHourKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ALERTS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if alert threshold exceeded
   */
  checkAlert(layer, category, hourKey) {
    const bucket = this.hourlyBuckets.get(hourKey);
    if (bucket && bucket.total >= this.alertThreshold) {
      const alert = {
        type: 'failure_spike',
        hourKey,
        total: bucket.total,
        threshold: this.alertThreshold,
        layer,
        category,
        byCategory: bucket.byCategory,
        timestamp: Date.now(),
      };

      // Only alert once per hour
      if (!bucket.alerted) {
        bucket.alerted = true;
        logger.warn('FailureHeatmap', `Alert: ${bucket.total} failures in hour ${hourKey}`);

        if (this.onAlert) {
          try {
            this.onAlert(alert);
          } catch (e) {
            logger.error('FailureHeatmap', 'Alert callback error', { error: e.message });
          }
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HEATMAP QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get layer-by-category heatmap
   */
  getLayerByCategoryHeatmap() {
    return this.buildHeatmap(this.layerByCategory, 'layer', 'category');
  }

  /**
   * Get layer-by-operation heatmap
   */
  getLayerByOperationHeatmap() {
    return this.buildHeatmap(this.layerByOperation, 'layer', 'operation');
  }

  /**
   * Get category-by-operation heatmap
   */
  getCategoryByOperationHeatmap() {
    return this.buildHeatmap(this.categoryByOperation, 'category', 'operation');
  }

  /**
   * Get time series heatmap (last 24 hours by layer)
   */
  getTimeSeriesHeatmap(hours = 24) {
    const now = Date.now();
    const cells = [];
    let maxCount = 0;

    for (const [key, cell] of this.layerByHour) {
      const [layer, hourKey] = key.split(':');
      const hourTimestamp = this.parseHourKey(hourKey);

      // Only include recent hours
      if (now - hourTimestamp <= hours * 60 * 60 * 1000) {
        cells.push(cell);
        maxCount = Math.max(maxCount, cell.count);
      }
    }

    return {
      cells: cells.map(c => ({
        ...c.toJSON(),
        intensity: c.getIntensity(maxCount),
      })),
      maxCount,
      dimension1: 'layer',
      dimension2: 'hour',
    };
  }

  /**
   * Parse hour key back to timestamp
   */
  parseHourKey(hourKey) {
    const [year, month, day, hour] = hourKey.split('-').map(Number);
    return new Date(year, month - 1, day, hour).getTime();
  }

  /**
   * Build heatmap from map
   */
  buildHeatmap(map, dim1Name, dim2Name) {
    const cells = Array.from(map.values());
    const maxCount = Math.max(...cells.map(c => c.count), 1);

    return {
      cells: cells.map(c => ({
        ...c.toJSON(),
        intensity: c.getIntensity(maxCount),
      })),
      maxCount,
      dimension1: dim1Name,
      dimension2: dim2Name,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HOTSPOT ANALYSIS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get top failure hotspots
   */
  getHotspots(limit = 10) {
    const allCells = [
      ...Array.from(this.layerByCategory.values()),
      ...Array.from(this.layerByOperation.values()),
    ];

    return allCells
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(c => ({
        dimensions: [c.dimension1, c.dimension2],
        count: c.count,
        lastSeen: c.lastSeen,
        recentErrors: c.recentErrors,
      }));
  }

  /**
   * Get failure patterns (recurring errors) - VERSIONED
   *
   * Returns patterns with their version info, allowing you to see
   * if patterns changed after an upgrade.
   */
  getPatterns(minOccurrences = 3) {
    return Array.from(this.versionedPatterns.values())
      .filter(p => p.count >= minOccurrences)
      .map(p => ({
        patternId: p.patternId,
        layer: p.layer,
        category: p.category,
        error: p.errorSample,
        behaviorVersion: p.behaviorVersion,
        count: p.count,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        operations: Array.from(p.operations),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get patterns grouped by behavior version
   */
  getPatternsByVersion() {
    const byVersion = {};

    for (const pattern of this.versionedPatterns.values()) {
      const version = pattern.behaviorVersion;
      if (!byVersion[version]) {
        byVersion[version] = [];
      }
      byVersion[version].push({
        patternId: pattern.patternId,
        layer: pattern.layer,
        category: pattern.category,
        error: pattern.errorSample,
        count: pattern.count,
      });
    }

    return byVersion;
  }

  /**
   * Compare patterns between two versions
   */
  compareVersionPatterns(version1, version2) {
    const v1Patterns = new Set();
    const v2Patterns = new Set();
    const sharedPatterns = [];

    for (const pattern of this.versionedPatterns.values()) {
      // Normalize pattern key (without version)
      const baseKey = `${pattern.layer}:${pattern.category}:${pattern.errorSample}`;

      if (pattern.behaviorVersion === version1) {
        v1Patterns.add(baseKey);
      }
      if (pattern.behaviorVersion === version2) {
        v2Patterns.add(baseKey);
      }
    }

    // Find shared patterns
    for (const key of v1Patterns) {
      if (v2Patterns.has(key)) {
        sharedPatterns.push(key);
      }
    }

    return {
      version1Only: [...v1Patterns].filter(k => !v2Patterns.has(k)),
      version2Only: [...v2Patterns].filter(k => !v1Patterns.has(k)),
      shared: sharedPatterns,
      analysis: {
        newInV2: [...v2Patterns].filter(k => !v1Patterns.has(k)).length,
        fixedInV2: [...v1Patterns].filter(k => !v2Patterns.has(k)).length,
        persistent: sharedPatterns.length,
      },
    };
  }

  /**
   * Get trend (is failure rate increasing?)
   */
  getTrend(hours = 6) {
    const now = Date.now();
    const halfwayPoint = now - (hours * 30 * 60 * 1000);  // halfway through period

    let firstHalfCount = 0;
    let secondHalfCount = 0;

    for (const failure of this.failures) {
      if (failure.timestamp >= now - (hours * 60 * 60 * 1000)) {
        if (failure.timestamp < halfwayPoint) {
          firstHalfCount++;
        } else {
          secondHalfCount++;
        }
      }
    }

    const changePercent = firstHalfCount > 0
      ? ((secondHalfCount - firstHalfCount) / firstHalfCount) * 100
      : (secondHalfCount > 0 ? 100 : 0);

    return {
      firstHalf: firstHalfCount,
      secondHalf: secondHalfCount,
      changePercent,
      trend: changePercent > 20 ? 'increasing' :
             changePercent < -20 ? 'decreasing' : 'stable',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get recent failures
   */
  getRecent(limit = 20) {
    return this.failures.slice(-limit).reverse();
  }

  /**
   * Get failures by layer
   */
  getByLayer(layer, limit = 50) {
    return this.failures
      .filter(f => f.layer === layer)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get failures by category
   */
  getByCategory(category, limit = 50) {
    return this.failures
      .filter(f => f.category === category)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get failures in time range
   */
  getInRange(startTime, endTime) {
    return this.failures.filter(f =>
      f.timestamp >= startTime && f.timestamp <= endTime
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get stats
   */
  getStats() {
    return {
      total: this.stats.total,
      byLayer: { ...this.stats.byLayer },
      byCategory: { ...this.stats.byCategory },
      byOperation: { ...this.stats.byOperation },
      hotspots: this.getHotspots(5),
      trend: this.getTrend(),
    };
  }

  /**
   * Get summary report
   */
  getReport() {
    return {
      stats: this.getStats(),
      layerByCategoryHeatmap: this.getLayerByCategoryHeatmap(),
      hotspots: this.getHotspots(10),
      patterns: this.getPatterns(),
      trend: this.getTrend(),
      hourlyBuckets: Object.fromEntries(
        Array.from(this.hourlyBuckets.entries())
          .slice(-24)
          .map(([k, v]) => [k, { total: v.total, byCategory: v.byCategory }])
      ),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Clear all data
   */
  clear() {
    this.layerByCategory.clear();
    this.layerByOperation.clear();
    this.categoryByOperation.clear();
    this.layerByHour.clear();
    this.versionedPatterns.clear();
    this.failures = [];
    this.hourlyBuckets.clear();
    this.stats = {
      total: 0,
      byLayer: {},
      byCategory: {},
      byOperation: {},
      byVersion: {},
    };
  }

  /**
   * Prune old data (keep last N hours)
   */
  prune(hours = 24) {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);

    // Prune failures
    this.failures = this.failures.filter(f => f.timestamp >= cutoff);

    // Prune hourly buckets
    for (const [key, bucket] of this.hourlyBuckets) {
      if (bucket.timestamp < cutoff) {
        this.hourlyBuckets.delete(key);
      }
    }

    // Note: Heatmap cells are not pruned to preserve historical patterns
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const failureHeatmap = new FailureHeatmap();

export default FailureHeatmap;
