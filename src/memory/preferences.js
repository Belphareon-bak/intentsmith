// CRE v45.0 Preference Engine
// ══════════════════════════════════════════════════════════════════════════════
//
// User preferences that influence CRE decision-making and LLM synthesis.
// Preferences change BEHAVIOR, not text.
//
// ❌ Wrong: "Protože preferuješ…" (text hack)
// ✅ Right: Different decision type, tool, structure, or synthesis style
//
// Preference axes:
//   verbosity       — minimal | normal | detailed
//   riskTolerance   — low | medium | high
//   technicalDepth  — basic | advanced
//   language        — cs | en | ...
//   autoExecute     — boolean (skip ASK_USER for confirmed patterns)
//   structure       — bullets | paragraphs | mixed (v45.0)
//   followUpStyle   — concise | comprehensive | adaptive (v45.0)
//
// v45.0: Preferences now influence synthesizeWithLLM() output style.
// Feedback learning: Preferences adapt based on user feedback signals.
//
// CRE remains sole authority. Preferences are INPUT to decisions, not overrides.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { MemoryKind } from './long-term.js';

// ════════════════════════════════════════════════════════════════════════════
// PREFERENCE AXES
// ════════════════════════════════════════════════════════════════════════════

export const PreferenceAxis = {
  VERBOSITY: 'verbosity',
  RISK_TOLERANCE: 'riskTolerance',
  TECHNICAL_DEPTH: 'technicalDepth',
  LANGUAGE: 'language',
  AUTO_EXECUTE: 'autoExecute',
  // v45.0 - Synthesis preferences
  STRUCTURE: 'structure',
  FOLLOW_UP_STYLE: 'followUpStyle',
};

export const Verbosity = {
  MINIMAL: 'minimal',
  NORMAL: 'normal',
  DETAILED: 'detailed',
};

export const RiskTolerance = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

export const TechnicalDepth = {
  BASIC: 'basic',
  ADVANCED: 'advanced',
};

// v45.0 - Structure preference for synthesis output format
export const Structure = {
  BULLETS: 'bullets',      // Prefer bullet points and lists
  PARAGRAPHS: 'paragraphs', // Prefer flowing text
  MIXED: 'mixed',           // Adaptive based on content
};

// v45.0 - Follow-up response style
export const FollowUpStyle = {
  CONCISE: 'concise',           // Brief, direct answers
  COMPREHENSIVE: 'comprehensive', // Detailed explanations
  ADAPTIVE: 'adaptive',          // Adapt to context
};

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT PREFERENCES
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_PREFERENCES = {
  verbosity: Verbosity.NORMAL,
  riskTolerance: RiskTolerance.MEDIUM,
  technicalDepth: TechnicalDepth.BASIC,
  language: 'cs',
  autoExecute: false,
  // v45.0 - Synthesis preferences
  structure: Structure.MIXED,
  followUpStyle: FollowUpStyle.ADAPTIVE,
};

// ════════════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ════════════════════════════════════════════════════════════════════════════

/**
 * UserPreferences — typed preference bag per user
 * Loaded from LongTermMemory on session start, updated during session.
 */
export class UserPreferences {
  constructor(initial = {}) {
    this.verbosity = initial.verbosity || DEFAULT_PREFERENCES.verbosity;
    this.riskTolerance = initial.riskTolerance || DEFAULT_PREFERENCES.riskTolerance;
    this.technicalDepth = initial.technicalDepth || DEFAULT_PREFERENCES.technicalDepth;
    this.language = initial.language || DEFAULT_PREFERENCES.language;
    this.autoExecute = initial.autoExecute ?? DEFAULT_PREFERENCES.autoExecute;
    // v45.0 - Synthesis preferences
    this.structure = initial.structure || DEFAULT_PREFERENCES.structure;
    this.followUpStyle = initial.followUpStyle || DEFAULT_PREFERENCES.followUpStyle;
    // Custom preferences (extensible)
    this.custom = initial.custom || {};
    // v45.0 - Feedback history for learning
    this.feedbackHistory = initial.feedbackHistory || [];
    this.feedbackStats = initial.feedbackStats || {
      positiveCount: 0,
      negativeCount: 0,
      lastUpdated: null,
    };
  }

  /**
   * Get a preference value
   */
  get(axis) {
    if (axis in this) return this[axis];
    return this.custom[axis] ?? null;
  }

  /**
   * Set a preference value
   */
  set(axis, value) {
    if (axis in DEFAULT_PREFERENCES) {
      this[axis] = value;
    } else {
      this.custom[axis] = value;
    }
  }

  /**
   * Serialize to plain object (for storage)
   */
  toJSON() {
    return {
      verbosity: this.verbosity,
      riskTolerance: this.riskTolerance,
      technicalDepth: this.technicalDepth,
      language: this.language,
      autoExecute: this.autoExecute,
      // v45.0 - Synthesis preferences
      structure: this.structure,
      followUpStyle: this.followUpStyle,
      custom: { ...this.custom },
      // v45.0 - Feedback data
      feedbackHistory: this.feedbackHistory.slice(-100), // Keep last 100
      feedbackStats: { ...this.feedbackStats },
    };
  }

  /**
   * Create from stored object
   */
  static fromJSON(data) {
    return new UserPreferences(data);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0 - Feedback Learning
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Record positive feedback signal
   * @param {Object} context - What the user liked
   * @param {string} context.responseType - Type of response (search, report, etc.)
   * @param {string} context.verbosity - Verbosity level used
   * @param {string} context.structure - Structure style used
   * @param {string} context.input - Original user input (for topicHash)
   */
  recordPositiveFeedback(context = {}) {
    const topicHash = context.input ? this._generateTopicHash(context.input) : null;
    this.feedbackHistory.push({
      type: 'positive',
      timestamp: Date.now(),
      topicHash,
      responseType: context.responseType,
      context,
    });
    this.feedbackStats.positiveCount++;
    this.feedbackStats.lastUpdated = Date.now();
    this._maybeAdjustPreferences(context, 'positive');
  }

  /**
   * Record negative feedback signal
   * @param {Object} context - What the user disliked
   * @param {string} context.responseType - Type of response
   * @param {string} context.verbosity - Verbosity level used
   * @param {string} context.structure - Structure style used
   * @param {string} context.reason - Optional reason for dissatisfaction
   * @param {string} context.input - Original user input (for topicHash)
   */
  recordNegativeFeedback(context = {}) {
    const topicHash = context.input ? this._generateTopicHash(context.input) : null;
    this.feedbackHistory.push({
      type: 'negative',
      timestamp: Date.now(),
      topicHash,
      responseType: context.responseType,
      context,
    });
    this.feedbackStats.negativeCount++;
    this.feedbackStats.lastUpdated = Date.now();
    this._maybeAdjustPreferences(context, 'negative');
  }

  /**
   * Generate topic hash from user input
   * Normalized: lowercase, no stopwords, max 5 key tokens
   * No NLP magic - just simple tokenization
   * @private
   */
  _generateTopicHash(input) {
    if (!input || typeof input !== 'string') return null;

    // Czech + English stopwords (common words to ignore)
    const stopwords = new Set([
      // Czech
      'a', 'aby', 'ale', 'ani', 'asi', 'az', 'bez', 'bude', 'budem', 'by', 'byl', 'byla',
      'byli', 'bylo', 'co', 'coz', 'ci', 'clanek', 'dalsi', 'dnes', 'do', 'ho', 'i',
      'ja', 'jak', 'jako', 'je', 'jeho', 'jej', 'jeji', 'jejich', 'jen', 'jeste', 'ji',
      'jine', 'jiz', 'jsem', 'jses', 'jsme', 'jsou', 'jste', 'k', 'kam', 'kde', 'kdo',
      'kdy', 'kdyz', 'ke', 'ktera', 'ktere', 'kteri', 'kterou', 'ktery', 'ma', 'mate',
      'me', 'mezi', 'mi', 'mne', 'mnou', 'muj', 'muze', 'my', 'na', 'nad', 'nam', 'napiste',
      'nas', 'nasi', 'ne', 'nebo', 'necht', 'nejsou', 'neni', 'nez', 'nic', 'nove', 'novy',
      'o', 'od', 'on', 'ona', 'oni', 'pak', 'po', 'pod', 'podle', 'pokud', 'pouze', 'prave',
      'pred', 'pres', 'pri', 'pro', 'proc', 'proto', 'protoze', 're', 's', 'se', 'si', 'sice',
      'strana', 'sve', 'svuj', 'ta', 'tak', 'take', 'takze', 'tato', 'te', 'tedy', 'ten',
      'tento', 'tim', 'to', 'tohle', 'toho', 'tom', 'toto', 'tu', 'tuto', 'ty', 'uz', 'v',
      've', 'vice', 'vsak', 'vse', 'vsech', 'vy', 'z', 'za', 'zda', 'zde', 'ze', 'zprava',
      // English
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'shall', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he',
      'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our',
      'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only',
      'same', 'so', 'than', 'too', 'very', 'just', 'about', 'into', 'over', 'after',
      // Common verbs/phrases
      'dej', 'dejmi', 'rekni', 'udelej', 'najdi', 'vyhledej', 'give', 'tell', 'find', 'get',
    ]);

    // Normalize: lowercase, remove punctuation, split
    const tokens = input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopwords.has(t));

    // Take max 5 most significant tokens (first ones, as they're usually most important)
    const keyTokens = tokens.slice(0, 5);

    // Sort for consistency and join
    return keyTokens.sort().join('_') || null;
  }

  /**
   * Maybe adjust preferences based on feedback patterns
   * Only adjusts after sufficient signal (3+ consistent feedback)
   *
   * v45.0 FIX: Maximum 1 axis change per feedback event!
   * Priority order: verbosity > structure > followUpStyle
   *
   * @private
   * @returns {Object|null} { axis, oldValue, newValue } if adjusted, null otherwise
   */
  _maybeAdjustPreferences(context, feedbackType) {
    // Get recent feedback for same response type
    // Check both top-level responseType (v45.0) and context.responseType (legacy)
    const recentSameType = this.feedbackHistory
      .slice(-20)
      .filter(f =>
        (f.responseType === context.responseType) ||
        (f.context?.responseType === context.responseType)
      );

    if (recentSameType.length < 3) return null; // Need more signal

    // Check for consistent pattern
    const recentTypes = recentSameType.slice(-3).map(f => f.type);
    const allPositive = recentTypes.every(t => t === 'positive');
    const allNegative = recentTypes.every(t => t === 'negative');

    if (!allPositive && !allNegative) return null; // Mixed signals

    // Collect potential adjustments (priority order: verbosity > structure > followUpStyle)
    const adjustments = [];

    // Check verbosity adjustment
    if (context.verbosity) {
      if (allPositive && this.verbosity !== context.verbosity) {
        adjustments.push({
          axis: 'verbosity',
          oldValue: this.verbosity,
          newValue: context.verbosity,
        });
      } else if (allNegative) {
        const newVerbosity = this._getShiftedVerbosity(
          context.verbosity === Verbosity.DETAILED ? 'less' : 'more'
        );
        if (newVerbosity && newVerbosity !== this.verbosity) {
          adjustments.push({
            axis: 'verbosity',
            oldValue: this.verbosity,
            newValue: newVerbosity,
          });
        }
      }
    }

    // Check structure adjustment
    if (context.structure) {
      if (allPositive && this.structure !== context.structure) {
        adjustments.push({
          axis: 'structure',
          oldValue: this.structure,
          newValue: context.structure,
        });
      } else if (allNegative && context.structure !== Structure.MIXED && this.structure !== Structure.MIXED) {
        adjustments.push({
          axis: 'structure',
          oldValue: this.structure,
          newValue: Structure.MIXED,
        });
      }
    }

    // Check followUpStyle adjustment
    if (context.followUpStyle) {
      if (allPositive && this.followUpStyle !== context.followUpStyle) {
        adjustments.push({
          axis: 'followUpStyle',
          oldValue: this.followUpStyle,
          newValue: context.followUpStyle,
        });
      } else if (allNegative && context.followUpStyle !== FollowUpStyle.ADAPTIVE && this.followUpStyle !== FollowUpStyle.ADAPTIVE) {
        adjustments.push({
          axis: 'followUpStyle',
          oldValue: this.followUpStyle,
          newValue: FollowUpStyle.ADAPTIVE,
        });
      }
    }

    // 🔒 CRITICAL: Apply only the FIRST adjustment (highest priority)
    if (adjustments.length === 0) return null;

    const adjustment = adjustments[0];
    this[adjustment.axis] = adjustment.newValue;

    logger.debug('UserPreferences', 'Adjusted preference', {
      axis: adjustment.axis,
      from: adjustment.oldValue,
      to: adjustment.newValue,
      responseType: context.responseType,
      feedbackType,
    });

    return adjustment;
  }

  /**
   * Get shifted verbosity without applying it
   * @private
   */
  _getShiftedVerbosity(direction) {
    const levels = [Verbosity.MINIMAL, Verbosity.NORMAL, Verbosity.DETAILED];
    const current = levels.indexOf(this.verbosity);
    if (direction === 'more' && current < levels.length - 1) {
      return levels[current + 1];
    } else if (direction === 'less' && current > 0) {
      return levels[current - 1];
    }
    return null;
  }

  /**
   * Get preferences optimized for a specific intent/response type
   * Uses feedback history to determine best settings
   * v45.0: Now uses top-level responseType field for faster filtering
   */
  getOptimizedFor(responseType) {
    // Find successful patterns for this response type
    // Check both top-level responseType (v45.0) and context.responseType (legacy)
    const relevantPositive = this.feedbackHistory
      .filter(f => f.type === 'positive' &&
        (f.responseType === responseType || f.context?.responseType === responseType))
      .slice(-10);

    if (relevantPositive.length === 0) {
      // No feedback yet - return defaults
      return {
        verbosity: this.verbosity,
        structure: this.structure,
        followUpStyle: this.followUpStyle,
      };
    }

    // Find most common successful settings
    const verbosityCounts = {};
    const structureCounts = {};

    for (const feedback of relevantPositive) {
      if (feedback.context?.verbosity) {
        verbosityCounts[feedback.context.verbosity] = (verbosityCounts[feedback.context.verbosity] || 0) + 1;
      }
      if (feedback.context?.structure) {
        structureCounts[feedback.context.structure] = (structureCounts[feedback.context.structure] || 0) + 1;
      }
    }

    return {
      verbosity: this._getMostCommon(verbosityCounts) || this.verbosity,
      structure: this._getMostCommon(structureCounts) || this.structure,
      followUpStyle: this.followUpStyle,
    };
  }

  /**
   * Get most common value from counts object
   * @private
   */
  _getMostCommon(counts) {
    let maxCount = 0;
    let maxKey = null;
    for (const [key, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        maxKey = key;
      }
    }
    return maxKey;
  }

  /**
   * Get feedback statistics
   */
  getFeedbackStats() {
    const total = this.feedbackStats.positiveCount + this.feedbackStats.negativeCount;
    return {
      ...this.feedbackStats,
      total,
      satisfactionRate: total > 0 ? this.feedbackStats.positiveCount / total : null,
      recentFeedback: this.feedbackHistory.slice(-10),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PREFERENCE ENGINE
// ════════════════════════════════════════════════════════════════════════════

/**
 * PreferenceEngine — applies user preferences to CRE decisions
 *
 * Rules:
 * 1. Preferences modify decision parameters (verbosity, tool choice), not decision type
 * 2. autoExecute can convert ASK_USER → direct execution ONLY for previously confirmed patterns
 * 3. riskTolerance influences gate thresholds
 * 4. CRE can override preferences for safety reasons
 */
export class PreferenceEngine {
  constructor(options = {}) {
    this.preferences = options.preferences || new UserPreferences();
    this.longTermMemory = options.longTermMemory || null;
    this.overrideLog = []; // Tracks when CRE overrode preferences
  }

  /**
   * Load preferences from long-term memory
   */
  loadFromMemory(ltm) {
    if (!ltm) return;

    const prefs = ltm.queryByKind(MemoryKind.PREFERENCE);
    for (const pref of prefs) {
      if (pref.key in DEFAULT_PREFERENCES) {
        this.preferences.set(pref.key, pref.value);
      } else {
        this.preferences.set(pref.key, pref.value);
      }
    }

    logger.debug('PreferenceEngine', 'Loaded preferences from LTM', {
      count: prefs.length,
    });
  }

  /**
   * Apply preferences to a CRE decision
   *
   * This is the CORE function. It modifies decision parameters
   * based on user preferences WITHOUT changing the decision type
   * (except for autoExecute edge case).
   *
   * @param {Object} decision - CREDecision
   * @param {Object} [context] - Additional context
   * @returns {Object} Modified decision (or same if no change)
   */
  apply(decision, context = {}) {
    if (!decision) return decision;

    let modified = { ...decision };
    let changes = [];

    // ── Verbosity ──────────────────────────────────────────────────────────
    if (modified.type === 'ANSWER' && modified.verbosity) {
      const userVerbosity = this.preferences.verbosity;
      if (userVerbosity !== Verbosity.NORMAL) {
        modified.verbosity = userVerbosity;
        changes.push(`verbosity → ${userVerbosity}`);
      }
    }

    // ── Auto-execute ───────────────────────────────────────────────────────
    // Convert ASK_USER to auto-resolved ONLY if:
    //   1. autoExecute is enabled
    //   2. The slot has a known default/previous value
    //   3. riskTolerance is not LOW
    if (modified.type === 'ASK_USER' && this.preferences.autoExecute) {
      if (this.preferences.riskTolerance !== RiskTolerance.LOW) {
        const resolved = this.tryAutoResolve(modified, context);
        if (resolved) {
          modified = resolved;
          changes.push('autoExecute: ASK_USER → resolved');
        }
      }
    }

    // ── Risk tolerance → gate relaxation ──────────────────────────────────
    // High risk tolerance: mark decision as allowing skip of certain gates
    if (this.preferences.riskTolerance === RiskTolerance.HIGH) {
      modified._preferenceHints = modified._preferenceHints || {};
      modified._preferenceHints.relaxGates = true;
    }

    // ── Technical depth ───────────────────────────────────────────────────
    if (modified.type === 'ANSWER' && this.preferences.technicalDepth === TechnicalDepth.ADVANCED) {
      modified._preferenceHints = modified._preferenceHints || {};
      modified._preferenceHints.technicalDetail = true;
      changes.push('technicalDepth → advanced');
    }

    // Log changes
    if (changes.length > 0) {
      logger.debug('PreferenceEngine', 'Applied preferences', { changes });
    }

    return modified;
  }

  /**
   * Try to auto-resolve an ASK_USER decision using known slot values
   */
  tryAutoResolve(decision, context) {
    if (!decision.slots || decision.slots.length === 0) return null;

    // Only auto-resolve if ALL slots have known values
    const resolvedSlots = {};
    for (const slot of decision.slots) {
      const known = this.findKnownValue(slot.name, context);
      if (known === null) return null; // Can't auto-resolve
      resolvedSlots[slot.name] = known;
    }

    // All slots resolved — return as ANSWER with resolved data
    return {
      type: 'ANSWER',
      template: decision.template || 'auto_resolved',
      data: { autoResolved: true, slots: resolvedSlots },
      verbosity: this.preferences.verbosity,
      _autoResolved: true,
    };
  }

  /**
   * Find a known value for a slot from context or long-term memory
   */
  findKnownValue(slotName, context) {
    // Check context first
    if (context.activeSlots && slotName in context.activeSlots) {
      return context.activeSlots[slotName];
    }

    // Check long-term memory
    if (this.longTermMemory) {
      const result = this.longTermMemory.read({
        kind: MemoryKind.PREFERENCE,
        key: slotName,
      });
      if (result.value !== undefined) {
        return result.value;
      }
    }

    return null;
  }

  /**
   * Record a preference override (when CRE overrules a preference for safety)
   */
  recordOverride(axis, reason) {
    this.overrideLog.push({
      axis,
      reason,
      timestamp: Date.now(),
    });
    logger.warn('PreferenceEngine', `Preference overridden: ${axis}`, { reason });
  }

  /**
   * Get current preferences
   */
  getPreferences() {
    return this.preferences.toJSON();
  }

  /**
   * Update a single preference
   */
  updatePreference(axis, value) {
    this.preferences.set(axis, value);
    logger.debug('PreferenceEngine', `Preference updated: ${axis} = ${JSON.stringify(value)}`);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      preferences: this.preferences.toJSON(),
      overrides: this.overrideLog.length,
      recentOverrides: this.overrideLog.slice(-10),
      feedbackStats: this.preferences.getFeedbackStats(),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0 - Feedback Learning Methods
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Record positive feedback signal (user liked the response)
   * @param {Object} context - What the user liked
   */
  recordPositiveFeedback(context = {}) {
    this.preferences.recordPositiveFeedback(context);
    logger.debug('PreferenceEngine', 'Recorded positive feedback', { context });
  }

  /**
   * Record negative feedback signal (user disliked the response)
   * @param {Object} context - What the user disliked
   */
  recordNegativeFeedback(context = {}) {
    this.preferences.recordNegativeFeedback(context);
    logger.debug('PreferenceEngine', 'Recorded negative feedback', { context });
  }

  /**
   * Get optimized preferences for a specific response type
   * Uses feedback history to determine best settings
   * @param {string} responseType - Type of response (search, report, etc.)
   */
  getOptimizedPreferences(responseType) {
    return this.preferences.getOptimizedFor(responseType);
  }

  /**
   * Get preferences for synthesis (v45.0)
   * Returns preferences suitable for synthesizeWithLLM()
   * @param {string} intent - The intent type
   */
  getPreferencesForSynthesis(intent) {
    // Get optimized preferences based on feedback history
    const optimized = this.preferences.getOptimizedFor(intent);

    return {
      verbosity: optimized.verbosity,
      structure: optimized.structure,
      followUpStyle: optimized.followUpStyle,
      technicalDepth: this.preferences.technicalDepth,
      language: this.preferences.language,
    };
  }
}

// Singleton
export const preferenceEngine = new PreferenceEngine();

export default PreferenceEngine;
