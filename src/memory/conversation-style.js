// CRE v45.0 KOLO 4 — Conversational Style Inference
// ══════════════════════════════════════════════════════════════════════════════
//
// Infers user preferences from conversational behavior, NOT just feedback.
//
// SIGNALS:
// - "jen číslo" → prefersMinimal + prefersNumbers
// - "ne odkazy" → toleratesLinks = false
// - "rozveď" → prefersExamples = true
// - "stručně" → prefersMinimal = true
//
// KEY DIFFERENCE from UserPreferences:
// - UserPreferences = explicit feedback (thumbs up/down)
// - ConversationStyle = implicit signals from dialog
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Style Signal Patterns
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_SIGNAL_PATTERNS = {
  // MINIMAL signals
  prefersMinimal: [
    /jen\s+(číslo|odpověď|fakt)/i,
    /stručně/i,
    /kratší/i,
    /zkrať/i,
    /žádné?\s+(výplně|povídání|kecy)/i,
    /just\s+(the\s+)?(number|answer|fact)/i,
    /shorter/i,
    /brief/i,
    /no\s+(fluff|filler|padding)/i,
  ],

  // NUMBER preference signals
  prefersNumbers: [
    /jen\s+číslo/i,
    /kolik\s+(přesně|je)/i,
    /dej\s+mi\s+číslo/i,
    /just\s+(the\s+)?number/i,
    /how\s+much\s+exactly/i,
    /give\s+me\s+(the\s+)?number/i,
  ],

  // EXAMPLE preference signals
  prefersExamples: [
    /rozveď/i,
    /příklad/i,
    /ukázk/i,
    /podrobněji/i,
    /detailněji/i,
    /explain\s+more/i,
    /example/i,
    /show\s+me/i,
    /elaborate/i,
  ],

  // LINK tolerance signals (negative = don't want links)
  toleratesLinks: {
    positive: [
      /odkaz/i,
      /zdroj/i,
      /link/i,
      /source/i,
      /kde\s+(najdu|přečtu)/i,
      /where\s+can\s+i\s+(find|read)/i,
    ],
    negative: [
      /ne\s+odkaz/i,
      /bez\s+odkaz/i,
      /žádné?\s+odkaz/i,
      /no\s+links?/i,
      /without\s+links?/i,
      /skip\s+the\s+links?/i,
    ],
  },

  // STRUCTURE preference signals
  prefersStructure: [
    /v\s+bodech/i,
    /odrážk/i,
    /seznam/i,
    /tabulk/i,
    /bullet/i,
    /list/i,
    /table/i,
    /structured/i,
  ],

  // NARRATIVE preference signals
  prefersNarrative: [
    /povídání/i,
    /vyprávěj/i,
    /příběh/i,
    /story/i,
    /tell\s+me/i,
    /explain\s+like/i,
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Decay Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DECAY_ON_TOPIC_CHANGE = 0.5;  // Halve confidence on topic change
export const DECAY_PER_TURN = 0.95;        // 5% decay per turn
export const SIGNAL_BOOST = 0.3;           // How much a signal boosts confidence
export const MAX_CONFIDENCE = 1.0;
export const MIN_CONFIDENCE = 0.0;

// ─────────────────────────────────────────────────────────────────────────────
// ConversationStyle Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks and infers conversational style preferences from behavior.
 *
 * Unlike UserPreferences (explicit feedback), this infers from dialog patterns.
 */
export class ConversationStyle {
  constructor() {
    // Style dimensions with confidence scores (0.0 - 1.0)
    this.dimensions = {
      prefersMinimal: { value: false, confidence: 0.0 },
      prefersNumbers: { value: false, confidence: 0.0 },
      prefersExamples: { value: false, confidence: 0.0 },
      toleratesLinks: { value: true, confidence: 0.0 },  // Default: links OK
      prefersStructure: { value: false, confidence: 0.0 },
      prefersNarrative: { value: false, confidence: 0.0 },
    };

    // Track current topic for decay
    this.currentTopicHash = null;
    this.turnCount = 0;

    // History for debugging
    this.signalHistory = [];
  }

  /**
   * Process user input and infer style signals
   * @param {string} input - User input
   * @param {string} topicHash - Current topic hash (for decay)
   */
  processInput(input, topicHash = null) {
    this.turnCount++;

    // Apply turn decay to all dimensions
    this._applyTurnDecay();

    // Check for topic change and apply decay
    if (topicHash && topicHash !== this.currentTopicHash) {
      this._applyTopicChangeDecay();
      this.currentTopicHash = topicHash;
    }

    // Detect signals from input
    const signals = this._detectSignals(input);

    // Apply signals
    for (const signal of signals) {
      this._applySignal(signal);
    }

    // Log if any signals detected
    if (signals.length > 0) {
      logger.info('ConversationStyle', 'Signals detected', {
        input: input.substring(0, 50),
        signals,
        currentStyle: this.toJSON(),
      });
    }

    return signals;
  }

  /**
   * Detect style signals from input
   * @private
   */
  _detectSignals(input) {
    const signals = [];
    const inputLower = input.toLowerCase();

    // Check each dimension
    for (const [dimension, patterns] of Object.entries(STYLE_SIGNAL_PATTERNS)) {
      if (dimension === 'toleratesLinks') {
        // Special handling for links (has positive and negative)
        if (patterns.negative.some(p => p.test(inputLower))) {
          signals.push({ dimension, value: false, type: 'negative' });
        } else if (patterns.positive.some(p => p.test(inputLower))) {
          signals.push({ dimension, value: true, type: 'positive' });
        }
      } else {
        // Standard dimension check
        if (patterns.some(p => p.test(inputLower))) {
          signals.push({ dimension, value: true, type: 'positive' });
        }
      }
    }

    return signals;
  }

  /**
   * Apply a detected signal to dimensions
   * @private
   */
  _applySignal(signal) {
    const dim = this.dimensions[signal.dimension];
    if (!dim) return;

    // Update value
    dim.value = signal.value;

    // Boost confidence
    dim.confidence = Math.min(MAX_CONFIDENCE, dim.confidence + SIGNAL_BOOST);

    // Record in history
    this.signalHistory.push({
      turn: this.turnCount,
      signal,
      timestamp: Date.now(),
    });

    // Keep history bounded
    if (this.signalHistory.length > 50) {
      this.signalHistory = this.signalHistory.slice(-50);
    }
  }

  /**
   * Apply per-turn decay
   * @private
   */
  _applyTurnDecay() {
    for (const dim of Object.values(this.dimensions)) {
      dim.confidence *= DECAY_PER_TURN;
      if (dim.confidence < 0.05) {
        dim.confidence = MIN_CONFIDENCE;
        // Reset to default when confidence is too low
        if (dim === this.dimensions.toleratesLinks) {
          dim.value = true; // Default: links OK
        } else {
          dim.value = false;
        }
      }
    }
  }

  /**
   * Apply decay on topic change
   * @private
   */
  _applyTopicChangeDecay() {
    for (const dim of Object.values(this.dimensions)) {
      dim.confidence *= DECAY_ON_TOPIC_CHANGE;
    }

    logger.debug('ConversationStyle', 'Topic change decay applied', {
      previousTopic: this.currentTopicHash,
    });
  }

  /**
   * Get effective style for synthesis
   * Only returns values with confidence > threshold
   * @param {number} threshold - Minimum confidence (default 0.2)
   */
  getEffectiveStyle(threshold = 0.2) {
    const style = {};

    for (const [key, dim] of Object.entries(this.dimensions)) {
      if (dim.confidence >= threshold) {
        style[key] = dim.value;
      }
    }

    return style;
  }

  /**
   * Check if a specific preference is active
   * @param {string} dimension - Dimension name
   * @param {number} threshold - Minimum confidence
   */
  prefers(dimension, threshold = 0.2) {
    const dim = this.dimensions[dimension];
    if (!dim) return false;
    return dim.confidence >= threshold && dim.value === true;
  }

  /**
   * Check if links are tolerated
   * @param {number} threshold - Minimum confidence
   */
  shouldIncludeLinks(threshold = 0.2) {
    const dim = this.dimensions.toleratesLinks;
    // Default to true if no signal
    if (dim.confidence < threshold) return true;
    return dim.value;
  }

  /**
   * Get synthesis hints based on inferred style
   * These merge with ResponseIntent and UserPreferences
   */
  getSynthesisHints() {
    const hints = [];
    const style = this.getEffectiveStyle();

    if (style.prefersMinimal) {
      hints.push('User prefers MINIMAL responses. Be extremely concise.');
    }

    if (style.prefersNumbers) {
      hints.push('User prefers NUMBERS. Lead with data, skip prose.');
    }

    if (style.prefersExamples) {
      hints.push('User wants EXAMPLES. Include concrete illustrations.');
    }

    if (style.toleratesLinks === false) {
      hints.push('User does NOT want links. Omit all URLs and "zdroje" sections.');
    }

    if (style.prefersStructure) {
      hints.push('User prefers STRUCTURED output. Use bullets or tables.');
    }

    if (style.prefersNarrative) {
      hints.push('User prefers NARRATIVE style. Tell a story, avoid bullets.');
    }

    return hints;
  }

  /**
   * Export state for debugging/testing
   */
  toJSON() {
    return {
      dimensions: { ...this.dimensions },
      turnCount: this.turnCount,
      currentTopicHash: this.currentTopicHash,
      effectiveStyle: this.getEffectiveStyle(),
    };
  }

  /**
   * Reset all dimensions
   */
  reset() {
    for (const dim of Object.values(this.dimensions)) {
      dim.value = dim === this.dimensions.toleratesLinks ? true : false;
      dim.confidence = 0.0;
    }
    this.currentTopicHash = null;
    this.turnCount = 0;
    this.signalHistory = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 KOLO 4.5 — Format Memory (ResponseIntent per topic)
// ─────────────────────────────────────────────────────────────────────────────
//
// CONTRACT:
// - Store preferredResponseIntent per topicHash
// - Don't return to paragraphs without reason
// - No TOOL_CALL on pure format change
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks ResponseIntent preferences per topic
 */
export class FormatMemory {
  constructor() {
    // Map: topicHash → { responseIntent, setAt, confidence }
    this.topicFormats = new Map();
    this.globalFormat = null;  // Fallback if no topic-specific format
  }

  /**
   * Store ResponseIntent for a topic
   * @param {string} topicHash - Topic identifier
   * @param {string} responseIntent - ResponseIntent value
   */
  setFormat(topicHash, responseIntent) {
    this.topicFormats.set(topicHash, {
      responseIntent,
      setAt: Date.now(),
      confidence: 1.0,
    });

    // Also update global as most recent
    this.globalFormat = responseIntent;

    logger.debug('FormatMemory', 'Format set for topic', {
      topicHash,
      responseIntent,
    });
  }

  /**
   * Get preferred ResponseIntent for a topic
   * @param {string} topicHash - Topic identifier
   * @returns {string | null} ResponseIntent or null if not set
   */
  getFormat(topicHash) {
    const entry = this.topicFormats.get(topicHash);
    if (entry) {
      return entry.responseIntent;
    }

    // Fallback to global (last used format)
    return this.globalFormat;
  }

  /**
   * Check if topic has a format preference
   * @param {string} topicHash - Topic identifier
   * @returns {boolean}
   */
  hasFormat(topicHash) {
    return this.topicFormats.has(topicHash) || this.globalFormat !== null;
  }

  /**
   * Clear format for a topic (e.g., on explicit reset)
   * @param {string} topicHash - Topic identifier
   */
  clearFormat(topicHash) {
    this.topicFormats.delete(topicHash);
  }

  /**
   * Clear all format memory
   */
  reset() {
    this.topicFormats.clear();
    this.globalFormat = null;
  }

  /**
   * Export state for debugging
   */
  toJSON() {
    const topics = {};
    for (const [hash, data] of this.topicFormats) {
      topics[hash] = data;
    }
    return {
      topics,
      globalFormat: this.globalFormat,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instances
// ─────────────────────────────────────────────────────────────────────────────

export const conversationStyle = new ConversationStyle();
export const formatMemory = new FormatMemory();

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  ConversationStyle,
  conversationStyle,
  STYLE_SIGNAL_PATTERNS,
  DECAY_ON_TOPIC_CHANGE,
  DECAY_PER_TURN,
  SIGNAL_BOOST,
  // v45.0 KOLO 4.5: Format Memory
  FormatMemory,
  formatMemory,
};
