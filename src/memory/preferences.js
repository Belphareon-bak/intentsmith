// CRE v37.2 Preference Engine
// ══════════════════════════════════════════════════════════════════════════════
//
// User preferences that influence CRE decision-making.
// Preferences change BEHAVIOR, not text.
//
// ❌ Wrong: "Protože preferuješ…" (text hack)
// ✅ Right: Different decision type, tool, or structure
//
// Preference axes:
//   verbosity       — minimal | normal | detailed
//   riskTolerance   — low | medium | high
//   technicalDepth  — basic | advanced
//   language        — cs | en | ...
//   autoExecute     — boolean (skip ASK_USER for confirmed patterns)
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

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT PREFERENCES
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_PREFERENCES = {
  verbosity: Verbosity.NORMAL,
  riskTolerance: RiskTolerance.MEDIUM,
  technicalDepth: TechnicalDepth.BASIC,
  language: 'cs',
  autoExecute: false,
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
    // Custom preferences (extensible)
    this.custom = initial.custom || {};
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
      custom: { ...this.custom },
    };
  }

  /**
   * Create from stored object
   */
  static fromJSON(data) {
    return new UserPreferences(data);
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
    };
  }
}

// Singleton
export const preferenceEngine = new PreferenceEngine();

export default PreferenceEngine;
