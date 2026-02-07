// Tool Health Monitor v52.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Monitors health of tools and provides health scores.
//
// Tracks:
//   - Success rate
//   - Average latency
//   - Error patterns
//   - Availability
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// HEALTH STATUS
// ════════════════════════════════════════════════════════════════════════════

export const HealthStatus = {
  HEALTHY: 'healthy',         // All good
  DEGRADED: 'degraded',       // Some issues
  UNHEALTHY: 'unhealthy',     // Major issues
  UNKNOWN: 'unknown',         // Not enough data
};

// ════════════════════════════════════════════════════════════════════════════
// HEALTH MONITOR
// ════════════════════════════════════════════════════════════════════════════

export class ToolHealthMonitor {
  constructor(config = {}) {
    this.config = {
      // Window for calculating metrics (ms)
      metricsWindow: config.metricsWindow ?? 300000, // 5 minutes

      // Thresholds for health status
      thresholds: {
        healthy: {
          success_rate: 0.95,  // 95%+ success rate
          avg_latency_ms: 2000, // Under 2s average
        },
        degraded: {
          success_rate: 0.80,  // 80-95% success rate
          avg_latency_ms: 5000, // 2-5s average
        },
        // Below degraded = unhealthy
      },

      // Min samples for status determination
      minSamples: config.minSamples ?? 5,

      ...config,
    };

    // Per-tool metrics
    this.toolMetrics = new Map();

    // Health check results
    this.healthChecks = new Map();
  }

  /**
   * Record a tool call result
   *
   * @param {string} toolName - Tool identifier
   * @param {Object} result - Call result
   * @param {boolean} result.success - Whether call succeeded
   * @param {number} result.latency_ms - Call latency
   * @param {string} result.error - Error message if failed
   */
  recordCall(toolName, result) {
    if (!this.toolMetrics.has(toolName)) {
      this.toolMetrics.set(toolName, {
        calls: [],
        total_calls: 0,
        total_successes: 0,
        total_failures: 0,
        error_counts: new Map(),
      });
    }

    const metrics = this.toolMetrics.get(toolName);
    const now = Date.now();

    // Add call record
    metrics.calls.push({
      timestamp: now,
      success: result.success,
      latency_ms: result.latency_ms,
      error: result.error,
    });

    // Update totals
    metrics.total_calls++;
    if (result.success) {
      metrics.total_successes++;
    } else {
      metrics.total_failures++;
      // Track error patterns
      const errorKey = result.error || 'unknown';
      metrics.error_counts.set(
        errorKey,
        (metrics.error_counts.get(errorKey) || 0) + 1
      );
    }

    // Clean up old records
    this.cleanupOldRecords(toolName);
  }

  /**
   * Clean up records outside the metrics window
   */
  cleanupOldRecords(toolName) {
    const metrics = this.toolMetrics.get(toolName);
    if (!metrics) return;

    const cutoff = Date.now() - this.config.metricsWindow;
    metrics.calls = metrics.calls.filter(c => c.timestamp > cutoff);
  }

  /**
   * Get health status for a tool
   *
   * @param {string} toolName - Tool identifier
   * @returns {Object} Health status
   */
  getHealth(toolName) {
    this.cleanupOldRecords(toolName);

    const metrics = this.toolMetrics.get(toolName);

    if (!metrics || metrics.calls.length < this.config.minSamples) {
      return {
        status: HealthStatus.UNKNOWN,
        reason: 'Insufficient data',
        samples: metrics?.calls.length || 0,
        min_samples: this.config.minSamples,
      };
    }

    // Calculate metrics
    const recentCalls = metrics.calls;
    const successCount = recentCalls.filter(c => c.success).length;
    const successRate = successCount / recentCalls.length;

    const latencies = recentCalls.filter(c => c.latency_ms).map(c => c.latency_ms);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    // Determine status
    let status = HealthStatus.UNHEALTHY;
    let reason = '';

    const { healthy, degraded } = this.config.thresholds;

    if (successRate >= healthy.success_rate && avgLatency <= healthy.avg_latency_ms) {
      status = HealthStatus.HEALTHY;
      reason = 'All metrics within healthy thresholds';
    } else if (successRate >= degraded.success_rate && avgLatency <= degraded.avg_latency_ms) {
      status = HealthStatus.DEGRADED;
      reason = successRate < healthy.success_rate
        ? `Success rate ${(successRate * 100).toFixed(1)}% below healthy threshold`
        : `Average latency ${avgLatency.toFixed(0)}ms above healthy threshold`;
    } else {
      reason = successRate < degraded.success_rate
        ? `Success rate ${(successRate * 100).toFixed(1)}% below degraded threshold`
        : `Average latency ${avgLatency.toFixed(0)}ms above degraded threshold`;
    }

    return {
      status,
      reason,
      metrics: {
        success_rate: successRate,
        avg_latency_ms: avgLatency,
        samples: recentCalls.length,
        window_ms: this.config.metricsWindow,
      },
      thresholds: this.config.thresholds,
    };
  }

  /**
   * Get health for all monitored tools
   */
  getAllHealth() {
    const health = {};
    for (const toolName of this.toolMetrics.keys()) {
      health[toolName] = this.getHealth(toolName);
    }
    return health;
  }

  /**
   * Get unhealthy tools
   */
  getUnhealthyTools() {
    return Array.from(this.toolMetrics.keys())
      .filter(tool => {
        const health = this.getHealth(tool);
        return health.status === HealthStatus.UNHEALTHY;
      });
  }

  /**
   * Get degraded tools
   */
  getDegradedTools() {
    return Array.from(this.toolMetrics.keys())
      .filter(tool => {
        const health = this.getHealth(tool);
        return health.status === HealthStatus.DEGRADED;
      });
  }

  /**
   * Register a health check function for a tool
   *
   * @param {string} toolName - Tool identifier
   * @param {Function} checkFn - Async function that returns { healthy, message }
   */
  registerHealthCheck(toolName, checkFn) {
    this.healthChecks.set(toolName, checkFn);
  }

  /**
   * Run health check for a tool
   *
   * @param {string} toolName - Tool identifier
   * @returns {Object} Health check result
   */
  async runHealthCheck(toolName) {
    const checkFn = this.healthChecks.get(toolName);
    if (!checkFn) {
      return {
        checked: false,
        reason: 'No health check registered',
      };
    }

    try {
      const start = Date.now();
      const result = await checkFn();
      const latency = Date.now() - start;

      // Record the health check as a call
      this.recordCall(toolName, {
        success: result.healthy,
        latency_ms: latency,
        error: result.healthy ? null : result.message,
      });

      return {
        checked: true,
        healthy: result.healthy,
        message: result.message,
        latency_ms: latency,
      };
    } catch (error) {
      this.recordCall(toolName, {
        success: false,
        latency_ms: 0,
        error: error.message,
      });

      return {
        checked: true,
        healthy: false,
        message: error.message,
        error: true,
      };
    }
  }

  /**
   * Run health checks for all registered tools
   */
  async runAllHealthChecks() {
    const results = {};
    for (const toolName of this.healthChecks.keys()) {
      results[toolName] = await this.runHealthCheck(toolName);
    }
    return results;
  }

  /**
   * Get error statistics for a tool
   */
  getErrorStats(toolName) {
    const metrics = this.toolMetrics.get(toolName);
    if (!metrics) return null;

    return {
      total_errors: metrics.total_failures,
      error_rate: metrics.total_calls > 0
        ? metrics.total_failures / metrics.total_calls
        : 0,
      error_breakdown: Object.fromEntries(metrics.error_counts),
    };
  }

  /**
   * Get summary for all tools
   */
  getSummary() {
    const tools = Array.from(this.toolMetrics.keys());
    const health = this.getAllHealth();

    return {
      total_tools: tools.length,
      healthy: tools.filter(t => health[t].status === HealthStatus.HEALTHY).length,
      degraded: tools.filter(t => health[t].status === HealthStatus.DEGRADED).length,
      unhealthy: tools.filter(t => health[t].status === HealthStatus.UNHEALTHY).length,
      unknown: tools.filter(t => health[t].status === HealthStatus.UNKNOWN).length,
      tools: health,
    };
  }

  /**
   * Reset metrics for a tool
   */
  resetMetrics(toolName) {
    this.toolMetrics.delete(toolName);
  }

  /**
   * Reset all metrics
   */
  resetAllMetrics() {
    this.toolMetrics.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  ToolHealthMonitor,
  HealthStatus,
};
