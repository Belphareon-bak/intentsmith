// CRE v86.0 M2/M3 — Pattern Tracker
// ══════════════════════════════════════════════════════════════════════════════
//
// Tracks and persists recurring behavioral patterns across conversations.
//
// Pattern types:
//   intent_sequence — user's typical flow (e.g., SEARCH → CODE for same topic)
//   topic_affinity  — topics user frequently asks about
//   tool_success    — which tools succeed for which queries
//
// Cross-conversation learning:
//   Patterns are stored in LTM (kind: 'pattern') and survive restarts.
//   On each turn, the tracker:
//   1. Records the current intent + topic
//   2. Checks for emerging patterns (≥3 occurrences)
//   3. Reinforces existing patterns that match current context
//
// ══════════════════════════════════════════════════════════════════════════════

import { MemoryKind, MemorySource } from './long-term.js';
import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// PATTERN TYPES
// ════════════════════════════════════════════════════════════════════════════

export const PatternType = {
  INTENT_SEQUENCE: 'intent_sequence',
  TOPIC_AFFINITY: 'topic_affinity',
  TOOL_SUCCESS: 'tool_success',
};

// ════════════════════════════════════════════════════════════════════════════
// PATTERN TRACKER
// ════════════════════════════════════════════════════════════════════════════

export class PatternTracker {
  constructor() {
    this.ltm = null; // Set externally via wire()
    this.recentIntents = []; // Sliding window of last N intents (per session)
    this.maxWindow = 20;
  }

  /**
   * Wire LTM for persistence.
   * @param {LongTermMemory} ltm
   */
  wire(ltm) {
    this.ltm = ltm;
  }

  /**
   * Record a turn's intent and topic for pattern detection.
   *
   * @param {string} intent - CRE intent (SEARCH, CODE, etc.)
   * @param {string} input - User input (for topic extraction)
   * @param {Object} [opts]
   * @param {boolean} [opts.toolSuccess] - Whether tool execution succeeded
   * @param {string} [opts.tool] - Primary tool used
   */
  recordTurn(intent, input, opts = {}) {
    const topic = this._extractTopic(input);

    // Push to sliding window
    this.recentIntents.push({ intent, topic, timestamp: Date.now() });
    if (this.recentIntents.length > this.maxWindow) {
      this.recentIntents.shift();
    }

    // Check for intent sequence patterns
    this._detectIntentSequence(intent, topic);

    // Track topic affinity
    this._trackTopicAffinity(topic, intent);

    // Track tool success
    if (opts.tool && opts.toolSuccess !== undefined) {
      this._trackToolSuccess(opts.tool, topic, opts.toolSuccess);
    }
  }

  /**
   * Get patterns relevant to current context.
   *
   * @param {string} intent - Current intent
   * @param {string} input - Current input
   * @returns {Array<{type, key, value, confidence}>}
   */
  getRelevantPatterns(intent, input) {
    if (!this.ltm) return [];

    try {
      const patterns = this.ltm.queryByKind(MemoryKind.PATTERN, { minConfidence: 0.4 });
      const topic = this._extractTopic(input);

      return patterns.filter(p => {
        const val = p.value;
        if (!val) return false;
        // Match by intent or topic
        if (val.intent === intent) return true;
        if (val.topic && topic && val.topic === topic) return true;
        return false;
      });
    } catch (err) {
      logger.debug('PatternTracker', `getRelevantPatterns error: ${err.message}`);
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Intent Sequence Detection
  // ──────────────────────────────────────────────────────────────────────────

  _detectIntentSequence(currentIntent, topic) {
    if (this.recentIntents.length < 2) return;

    const prev = this.recentIntents[this.recentIntents.length - 2];
    const sequence = `${prev.intent}→${currentIntent}`;

    // Count this sequence in recent history
    let count = 0;
    for (let i = 1; i < this.recentIntents.length; i++) {
      const a = this.recentIntents[i - 1].intent;
      const b = this.recentIntents[i].intent;
      if (`${a}→${b}` === sequence) count++;
    }

    // Pattern threshold: ≥3 occurrences
    if (count >= 3 && this.ltm) {
      const key = `seq_${sequence}`;
      try {
        const existing = this.ltm.read({ kind: MemoryKind.PATTERN, key });
        if (existing.value) {
          // Reinforce
          this.ltm.reinforce(MemoryKind.PATTERN, key);
        } else {
          // Create new pattern
          this.ltm.write({
            kind: MemoryKind.PATTERN,
            key,
            value: {
              type: PatternType.INTENT_SEQUENCE,
              sequence,
              from: prev.intent,
              to: currentIntent,
              occurrences: count,
              intent: currentIntent,
            },
            confidence: 0.6,
            source: MemorySource.INFERRED,
          });
          logger.debug('PatternTracker', `New sequence pattern: ${sequence} (${count}x)`);
        }
      } catch (_) {}
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Topic Affinity
  // ──────────────────────────────────────────────────────────────────────────

  _trackTopicAffinity(topic, intent) {
    if (!topic || !this.ltm) return;

    const key = `topic_${topic}`;
    try {
      const existing = this.ltm.read({ kind: MemoryKind.PATTERN, key, minConfidence: 0 });
      if (existing.value) {
        // Reinforce existing topic affinity
        this.ltm.reinforce(MemoryKind.PATTERN, key);
      } else if (existing.code === 'NOT_FOUND') {
        // Count topic occurrences in recent window
        const count = this.recentIntents.filter(r => r.topic === topic).length;
        if (count >= 2) {
          this.ltm.write({
            kind: MemoryKind.PATTERN,
            key,
            value: {
              type: PatternType.TOPIC_AFFINITY,
              topic,
              primaryIntent: intent,
              occurrences: count,
            },
            confidence: 0.5,
            source: MemorySource.INFERRED,
          });
        }
      }
    } catch (_) {}
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Tool Success Tracking
  // ──────────────────────────────────────────────────────────────────────────

  _trackToolSuccess(tool, topic, success) {
    if (!this.ltm) return;

    const key = `tool_${tool}_${topic || 'general'}`;
    try {
      const existing = this.ltm.read({ kind: MemoryKind.PATTERN, key, minConfidence: 0 });
      if (existing.value) {
        if (success) {
          this.ltm.reinforce(MemoryKind.PATTERN, key);
        }
        // Don't reduce confidence on failure — decay handles natural obsolescence
      } else if (existing.code === 'NOT_FOUND' && success) {
        this.ltm.write({
          kind: MemoryKind.PATTERN,
          key,
          value: {
            type: PatternType.TOOL_SUCCESS,
            tool,
            topic: topic || 'general',
          },
          confidence: 0.6,
          source: MemorySource.INFERRED,
        });
      }
    } catch (_) {}
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Topic Extraction (simple, no NLP)
  // ──────────────────────────────────────────────────────────────────────────

  _extractTopic(input) {
    if (!input || typeof input !== 'string') return null;
    // Extract most significant tokens (>4 chars, not stop words)
    const tokens = input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 4);

    if (tokens.length === 0) return null;
    // Take first 3 significant tokens, sorted for consistency
    return tokens.slice(0, 3).sort().join('_');
  }
}

// Singleton
export const patternTracker = new PatternTracker();

export default { PatternTracker, patternTracker, PatternType };
