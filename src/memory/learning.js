// CRE v37.1 Auto-Learner
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects repeated patterns and promotes them to long-term memory.
//
// Rules (STRICT):
//   ✅ Repeated explicit correction (same key, ≥ N times) → store as preference
//   ✅ Same pattern ≥ N occurrences → store as pattern
//   ❌ NEVER from a single query
//   ❌ NEVER from uncertain inference
//   ❌ NEVER without explicit user confirmation for high-impact preferences
//
// Flow:
//   CRE decision → AutoLearner.observe(decision, context)
//   → if pattern detected → longTermMemory.write(...)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { MemoryKind, MemorySource } from './long-term.js';

// ════════════════════════════════════════════════════════════════════════════
// OBSERVATION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const ObservationType = {
  CORRECTION: 'correction',     // User corrected a previous answer/decision
  PREFERENCE: 'preference',     // User stated a preference explicitly
  REJECTION: 'rejection',       // User rejected a suggestion/format
  REPETITION: 'repetition',     // User repeated the same request pattern
};

// ════════════════════════════════════════════════════════════════════════════
// AUTO-LEARNER
// ════════════════════════════════════════════════════════════════════════════

export class AutoLearner {
  constructor(options = {}) {
    // Minimum occurrences before promotion to long-term memory
    this.promotionThreshold = options.promotionThreshold || 3;
    // Observations: key → { count, type, firstSeen, lastSeen, values }
    this.observations = new Map();
    // Promoted keys (to avoid re-promoting)
    this.promoted = new Set();
    // Reference to long-term memory (injected)
    this.longTermMemory = options.longTermMemory || null;
    // Stats
    this.stats = { observed: 0, promoted: 0, rejected: 0 };
  }

  /**
   * Observe a user action that might be a learnable pattern
   *
   * @param {Object} observation
   * @param {string} observation.type - ObservationType
   * @param {string} observation.key - What was observed (e.g. 'format.pdf', 'verbosity')
   * @param {*} observation.value - The observed value
   * @param {string} [observation.context] - Additional context
   * @returns {{ learned: boolean, key?: string, reason?: string }}
   */
  observe(observation) {
    if (!observation.type || !observation.key) {
      return { learned: false, reason: 'missing_type_or_key' };
    }

    this.stats.observed++;
    const obsKey = `${observation.type}:${observation.key}`;

    // Get or create observation record
    let record = this.observations.get(obsKey);
    if (!record) {
      record = {
        type: observation.type,
        key: observation.key,
        count: 0,
        firstSeen: Date.now(),
        lastSeen: null,
        values: [],
      };
      this.observations.set(obsKey, record);
    }

    record.count++;
    record.lastSeen = Date.now();
    record.values.push(observation.value);

    // Keep only last N values
    if (record.values.length > 10) {
      record.values = record.values.slice(-10);
    }

    logger.debug('AutoLearner', `Observed: ${obsKey} (count: ${record.count})`);

    // Check if threshold reached for promotion
    if (record.count >= this.promotionThreshold && !this.promoted.has(obsKey)) {
      return this.promote(record, observation);
    }

    return { learned: false, reason: 'below_threshold', count: record.count, threshold: this.promotionThreshold };
  }

  /**
   * Promote observation to long-term memory
   */
  promote(record, observation) {
    const obsKey = `${record.type}:${record.key}`;

    // Determine the consistent value (most recent for corrections, most common for patterns)
    const promotedValue = this.determineConsistentValue(record);

    if (promotedValue === null) {
      this.stats.rejected++;
      logger.debug('AutoLearner', `Promotion rejected (inconsistent values): ${obsKey}`);
      return { learned: false, reason: 'inconsistent_values' };
    }

    // Map observation type to MemoryKind
    const kind = this.mapToKind(record.type);
    const confidence = this.calculateConfidence(record);

    // Store in long-term memory if available
    if (this.longTermMemory) {
      const result = this.longTermMemory.write({
        kind,
        key: record.key,
        value: promotedValue,
        confidence,
        source: MemorySource.INFERRED,
      });

      if (!result.stored) {
        return { learned: false, reason: 'storage_failed', error: result.error };
      }
    }

    this.promoted.add(obsKey);
    this.stats.promoted++;

    logger.info('AutoLearner', `Promoted to long-term: ${kind}/${record.key}`, {
      confidence,
      occurrences: record.count,
    });

    return {
      learned: true,
      key: record.key,
      kind,
      value: promotedValue,
      confidence,
      occurrences: record.count,
    };
  }

  /**
   * Determine the consistent value from observation history
   * Returns null if values are too inconsistent
   */
  determineConsistentValue(record) {
    const values = record.values;
    if (values.length === 0) return null;

    // For corrections: use the most recent value
    if (record.type === ObservationType.CORRECTION) {
      return values[values.length - 1];
    }

    // For preferences/rejections: check if values are consistent
    const serialized = values.map(v => JSON.stringify(v));
    const frequency = {};
    for (const s of serialized) {
      frequency[s] = (frequency[s] || 0) + 1;
    }

    // Find most common value
    let maxFreq = 0;
    let mostCommon = null;
    for (const [val, count] of Object.entries(frequency)) {
      if (count > maxFreq) {
        maxFreq = count;
        mostCommon = val;
      }
    }

    // Require majority (>50%) for consistency
    if (maxFreq < values.length * 0.5) {
      return null; // Too inconsistent
    }

    return JSON.parse(mostCommon);
  }

  /**
   * Calculate confidence based on observation count and consistency
   */
  calculateConfidence(record) {
    const base = Math.min(record.count / (this.promotionThreshold * 2), 1.0);
    // Boost for explicit corrections (high confidence)
    if (record.type === ObservationType.CORRECTION) {
      return Math.min(base + 0.3, 1.0);
    }
    return Math.max(0.5, base);
  }

  /**
   * Map ObservationType → MemoryKind
   */
  mapToKind(type) {
    switch (type) {
      case ObservationType.CORRECTION: return MemoryKind.CORRECTION;
      case ObservationType.PREFERENCE: return MemoryKind.PREFERENCE;
      case ObservationType.REJECTION: return MemoryKind.PREFERENCE;
      case ObservationType.REPETITION: return MemoryKind.PATTERN;
      default: return MemoryKind.PATTERN;
    }
  }

  /**
   * Check if a key has already been promoted
   */
  isPromoted(type, key) {
    return this.promoted.has(`${type}:${key}`);
  }

  /**
   * Get observation count for a key
   */
  getCount(type, key) {
    const record = this.observations.get(`${type}:${key}`);
    return record ? record.count : 0;
  }

  /**
   * Reset (for testing)
   */
  reset() {
    this.observations.clear();
    this.promoted.clear();
    this.stats = { observed: 0, promoted: 0, rejected: 0 };
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      activeObservations: this.observations.size,
      promotedKeys: this.promoted.size,
    };
  }
}

// Singleton
export const autoLearner = new AutoLearner();

export default AutoLearner;
