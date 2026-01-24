// CRE v37.2 Preference Resolver
// ══════════════════════════════════════════════════════════════════════════════
//
// Integrates PreferenceEngine into CRE decision pipeline.
//
// Position in pipeline:
//   ReferenceResolver → intent → decision → PreferenceResolver → render
//
// This module:
//   1. Loads user preferences from LTM at session start
//   2. Applies preferences to each CRE decision
//   3. Observes user corrections for AutoLearner
//
// CRE remains sole authority. Preferences are advisory input.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { PreferenceEngine, UserPreferences } from '../memory/preferences.js';
import { AutoLearner, ObservationType } from '../memory/learning.js';
import { MemoryKind } from '../memory/long-term.js';

// ════════════════════════════════════════════════════════════════════════════
// PREFERENCE RESOLVER
// ════════════════════════════════════════════════════════════════════════════

export class PreferenceResolverService {
  constructor(options = {}) {
    this.engine = options.engine || new PreferenceEngine();
    this.learner = options.learner || new AutoLearner();
    this.longTermMemory = options.longTermMemory || null;
    this.initialized = false;
  }

  /**
   * Initialize: load preferences from LTM
   */
  init(longTermMemory) {
    if (longTermMemory) {
      this.longTermMemory = longTermMemory;
      this.engine.longTermMemory = longTermMemory;
      this.learner.longTermMemory = longTermMemory;
      this.engine.loadFromMemory(longTermMemory);
    }
    this.initialized = true;
    logger.debug('PreferenceResolver', 'Initialized');
  }

  /**
   * Apply preferences to a CRE decision
   *
   * @param {Object} decision - CREDecision from CRE.process()
   * @param {Object} context - Session context (slots, goals, etc.)
   * @returns {Object} Modified decision
   */
  applyToDecision(decision, context = {}) {
    if (!decision) return decision;
    return this.engine.apply(decision, context);
  }

  /**
   * Observe a user correction (feeds AutoLearner)
   *
   * Called when CRE detects CHALLENGE/CORRECTION intent.
   *
   * @param {string} key - What was corrected
   * @param {*} value - The corrected value
   */
  observeCorrection(key, value) {
    return this.learner.observe({
      type: ObservationType.CORRECTION,
      key,
      value,
    });
  }

  /**
   * Observe a preference statement
   *
   * Called when user explicitly states a preference.
   * e.g. "už mi nenabízej PDF" → key: 'avoid_formats', value: ['pdf']
   *
   * @param {string} key
   * @param {*} value
   */
  observePreference(key, value) {
    const result = this.learner.observe({
      type: ObservationType.PREFERENCE,
      key,
      value,
    });

    // Also directly update engine if explicit
    this.engine.updatePreference(key, value);

    // Store explicitly stated preferences immediately in LTM
    if (this.longTermMemory) {
      this.longTermMemory.write({
        kind: MemoryKind.PREFERENCE,
        key,
        value,
        confidence: 1.0,
        source: 'explicit',
      });
    }

    return result;
  }

  /**
   * Observe a rejection (user rejected a suggestion/format)
   *
   * @param {string} key - What was rejected
   * @param {*} value - The rejected value
   */
  observeRejection(key, value) {
    return this.learner.observe({
      type: ObservationType.REJECTION,
      key,
      value,
    });
  }

  /**
   * Get current preferences
   */
  getPreferences() {
    return this.engine.getPreferences();
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      engine: this.engine.getStats(),
      learner: this.learner.getStats(),
      initialized: this.initialized,
    };
  }
}

// Singleton
export const preferenceResolver = new PreferenceResolverService();

export default PreferenceResolverService;
