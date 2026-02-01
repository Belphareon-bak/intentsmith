// Performance Profiler v47.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Timing and profiling for agent execution.
//
// Features:
// - Phase timing (planning, execution, tool calls)
// - Latency histograms
// - Bottleneck detection
// - Memory snapshots
//
// Usage:
//   const span = profiler.startSpan('planning');
//   await doPlanning();
//   span.end();
//
//   profiler.getReport();
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// SPAN (timing unit)
// ════════════════════════════════════════════════════════════════════════════

class Span {
  constructor(profiler, name, parent = null) {
    this.profiler = profiler;
    this.name = name;
    this.parent = parent;
    this.startTime = performance.now();
    this.startMemory = process.memoryUsage().heapUsed;
    this.endTime = null;
    this.children = [];
    this.metadata = {};
  }

  /**
   * End the span
   */
  end() {
    this.endTime = performance.now();
    this.endMemory = process.memoryUsage().heapUsed;
    this.duration = this.endTime - this.startTime;
    this.memoryDelta = this.endMemory - this.startMemory;

    this.profiler.recordSpan(this);
    return this;
  }

  /**
   * Create a child span
   */
  child(name) {
    const childSpan = new Span(this.profiler, name, this);
    this.children.push(childSpan);
    return childSpan;
  }

  /**
   * Add metadata to the span
   */
  addMetadata(key, value) {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Get span data
   */
  toJSON() {
    return {
      name: this.name,
      duration: this.duration,
      memoryDelta: this.memoryDelta,
      metadata: this.metadata,
      children: this.children.map(c => c.toJSON()),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROFILER
// ════════════════════════════════════════════════════════════════════════════

class Profiler {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.spans = [];
    this.histograms = new Map();  // name → [durations]
    this.counters = new Map();     // name → count

    // Aggregated stats
    this.stats = {
      totalSpans: 0,
      totalDuration: 0,
      byPhase: {},
    };

    // Memory tracking
    this.memorySnapshots = [];
    this.maxSnapshots = options.maxSnapshots || 100;
  }

  /**
   * Start a new span
   */
  startSpan(name) {
    if (!this.enabled) {
      return new NoOpSpan();
    }

    return new Span(this, name);
  }

  /**
   * Record a completed span
   */
  recordSpan(span) {
    this.spans.push(span);
    this.stats.totalSpans++;
    this.stats.totalDuration += span.duration;

    // Track by phase
    if (!this.stats.byPhase[span.name]) {
      this.stats.byPhase[span.name] = {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
      };
    }

    const phase = this.stats.byPhase[span.name];
    phase.count++;
    phase.totalDuration += span.duration;
    phase.minDuration = Math.min(phase.minDuration, span.duration);
    phase.maxDuration = Math.max(phase.maxDuration, span.duration);
    phase.avgDuration = phase.totalDuration / phase.count;

    // Add to histogram
    if (!this.histograms.has(span.name)) {
      this.histograms.set(span.name, []);
    }
    this.histograms.get(span.name).push(span.duration);

    // Trim old spans
    if (this.spans.length > 1000) {
      this.spans = this.spans.slice(-500);
    }
  }

  /**
   * Increment a counter
   */
  increment(name, delta = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + delta);
  }

  /**
   * Take a memory snapshot
   */
  snapshot(label = '') {
    const mem = process.memoryUsage();
    const snapshot = {
      label,
      timestamp: Date.now(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss,
    };

    this.memorySnapshots.push(snapshot);

    if (this.memorySnapshots.length > this.maxSnapshots) {
      this.memorySnapshots = this.memorySnapshots.slice(-this.maxSnapshots / 2);
    }

    return snapshot;
  }

  /**
   * Time a function
   */
  async time(name, fn) {
    const span = this.startSpan(name);
    try {
      return await fn();
    } finally {
      span.end();
    }
  }

  /**
   * Time a sync function
   */
  timeSync(name, fn) {
    const span = this.startSpan(name);
    try {
      return fn();
    } finally {
      span.end();
    }
  }

  /**
   * Get percentile from histogram
   */
  percentile(name, p) {
    const durations = this.histograms.get(name);
    if (!durations || durations.length === 0) return 0;

    const sorted = [...durations].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * (p / 100));
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  /**
   * Get performance report
   */
  getReport() {
    const report = {
      summary: {
        totalSpans: this.stats.totalSpans,
        totalDuration: this.stats.totalDuration,
        avgSpanDuration: this.stats.totalSpans > 0
          ? this.stats.totalDuration / this.stats.totalSpans
          : 0,
      },
      phases: {},
      bottlenecks: [],
      counters: Object.fromEntries(this.counters),
      memory: this.getMemoryReport(),
    };

    // Phase breakdown
    for (const [name, stats] of Object.entries(this.stats.byPhase)) {
      report.phases[name] = {
        ...stats,
        p50: this.percentile(name, 50),
        p95: this.percentile(name, 95),
        p99: this.percentile(name, 99),
        percentOfTotal: this.stats.totalDuration > 0
          ? (stats.totalDuration / this.stats.totalDuration * 100).toFixed(2)
          : 0,
      };
    }

    // Identify bottlenecks (phases that take >30% of total time)
    for (const [name, stats] of Object.entries(report.phases)) {
      if (parseFloat(stats.percentOfTotal) > 30) {
        report.bottlenecks.push({
          phase: name,
          percentOfTotal: stats.percentOfTotal,
          avgDuration: stats.avgDuration,
          recommendation: this.getRecommendation(name, stats),
        });
      }
    }

    return report;
  }

  /**
   * Get memory report
   */
  getMemoryReport() {
    if (this.memorySnapshots.length === 0) {
      return { current: process.memoryUsage() };
    }

    const first = this.memorySnapshots[0];
    const last = this.memorySnapshots[this.memorySnapshots.length - 1];
    const current = process.memoryUsage();

    return {
      current: {
        heapUsed: current.heapUsed,
        heapTotal: current.heapTotal,
        rss: current.rss,
      },
      growth: {
        heapUsed: last.heapUsed - first.heapUsed,
        duration: last.timestamp - first.timestamp,
      },
      snapshots: this.memorySnapshots.length,
    };
  }

  /**
   * Get optimization recommendation for a phase
   */
  getRecommendation(phase, stats) {
    const recommendations = {
      'llm_call': 'Consider caching LLM responses or batching requests',
      'planning': 'Cache plan templates for common goals',
      'tool_execution': 'Use async/parallel execution where possible',
      'network': 'Implement request deduplication and caching',
      'database': 'Add indexes or use prepared statements',
      'parsing': 'Pre-compile schemas and validators',
    };

    return recommendations[phase] || 'Profile deeper to identify specific issues';
  }

  /**
   * Reset profiler
   */
  reset() {
    this.spans = [];
    this.histograms.clear();
    this.counters.clear();
    this.memorySnapshots = [];
    this.stats = {
      totalSpans: 0,
      totalDuration: 0,
      byPhase: {},
    };
  }

  /**
   * Log current stats
   */
  log() {
    const report = this.getReport();
    logger.info('Profiler', 'Performance Report', {
      totalSpans: report.summary.totalSpans,
      totalDuration: `${report.summary.totalDuration.toFixed(2)}ms`,
      bottlenecks: report.bottlenecks.map(b => b.phase),
    });
    return report;
  }
}

// No-op span for when profiling is disabled
class NoOpSpan {
  end() { return this; }
  child() { return this; }
  addMetadata() { return this; }
  toJSON() { return {}; }
}

// ════════════════════════════════════════════════════════════════════════════
// DECORATORS / HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a profiled wrapper for a function
 */
export function profiled(name, fn) {
  return async function(...args) {
    return profiler.time(name, () => fn.apply(this, args));
  };
}

/**
 * Create a profiled wrapper for a sync function
 */
export function profiledSync(name, fn) {
  return function(...args) {
    return profiler.timeSync(name, () => fn.apply(this, args));
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export const profiler = new Profiler();
export { Profiler, Span };

export default {
  profiler,
  Profiler,
  Span,
  profiled,
  profiledSync,
};
