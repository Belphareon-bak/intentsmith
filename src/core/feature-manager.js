// FeatureManager — runtime feature flag control (v91)
// ══════════════════════════════════════════════════════════════════════════════
//
// Singleton that manages feature flags with hot-toggle support.
//
// Initialization:
//   featureManager.init(config.features)  — loads env-based defaults
//
// Runtime update (from IDE settings or API):
//   featureManager.set('skills', false)   — disables skills at runtime
//
// Query:
//   featureManager.isEnabled('skills')    — returns boolean
//
// All features default to their env-based value from config.features.
// Runtime changes are IN-MEMORY ONLY — intentional design decision:
//   - set() toggles flags at runtime for immediate effect
//   - After restart, flags revert to env-based defaults (config.features)
//   - This prevents runtime toggles from permanently altering production config
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from './logger.js';

// IDE setting key → feature flag name mapping
const SETTING_KEY_MAP = {
  'c3.features.skills': 'skills',
  'c3.features.agents': 'agents',
  'c3.features.lifecycle': 'lifecycle',
  'c3.features.expertises': 'expertises',
  'c3.features.telemetry': 'telemetry',
  'c3.features.specialistTelemetry': 'specialistTelemetry',
  'c3.features.autonomy': 'autonomy',
};

class FeatureManager {
  constructor() {
    this._features = new Map();
    this._listeners = [];
  }

  /**
   * Initialize from config.features object (called once at startup).
   * @param {Object} configFeatures — e.g. { agents: true, skills: true, ... }
   */
  init(configFeatures) {
    for (const [key, value] of Object.entries(configFeatures)) {
      this._features.set(key, !!value);
    }
    logger.debug('FeatureManager', `Initialized with ${this._features.size} features`, Object.fromEntries(this._features));
  }

  /**
   * Check if a feature name is known (registered via init).
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._features.has(name);
  }

  /**
   * Check if a feature is enabled.
   * @param {string} name — feature name (e.g. 'skills', 'agents')
   * @returns {boolean}
   */
  isEnabled(name) {
    const val = this._features.get(name);
    // Unknown features default to true (don't block)
    return val !== false;
  }

  /**
   * Set a feature flag at runtime (hot-toggle).
   * @param {string} name — feature name
   * @param {boolean} enabled
   */
  set(name, enabled) {
    const prev = this._features.get(name);
    const next = !!enabled;

    if (prev === next) return; // no change

    this._features.set(name, next);
    logger.info('FeatureManager', `Feature "${name}" toggled: ${prev} → ${next}`);

    // Notify listeners
    for (const fn of this._listeners) {
      try { fn(name, next, prev); } catch (_) {}
    }
  }

  /**
   * Apply settings object from IDE (maps c3.features.X → feature name).
   * Only processes known feature keys.
   * @param {Object} settings — e.g. { 'c3.features.skills': false }
   */
  applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;

    let changed = 0;
    for (const [settingKey, featureName] of Object.entries(SETTING_KEY_MAP)) {
      if (settingKey in settings) {
        const prev = this._features.get(featureName);
        const next = !!settings[settingKey];
        if (prev !== next) {
          this.set(featureName, next);
          changed++;
        }
      }
    }
    return changed;
  }

  /**
   * Register a listener for feature changes.
   * @param {Function} fn — (name, newValue, oldValue) => void
   */
  onChange(fn) {
    this._listeners.push(fn);
  }

  /**
   * Reset all flags to env-based defaults from config.features.
   * Only calls set() for flags whose value actually differs from the default,
   * so onChange listeners fire only for genuinely changed flags.
   * @param {Object} configFeatures — e.g. config.features
   */
  resetToDefaults(configFeatures) {
    if (!configFeatures || typeof configFeatures !== 'object') return;
    let changed = 0;
    for (const [key, value] of Object.entries(configFeatures)) {
      const defaultVal = !!value;
      if (this._features.get(key) !== defaultVal) {
        this.set(key, defaultVal);
        changed++;
      }
    }
    if (changed > 0) {
      logger.info('FeatureManager', `Reset ${changed} flag(s) to defaults`);
    }
  }

  /**
   * Get all features as a plain object.
   * @returns {Object}
   */
  getAll() {
    return Object.fromEntries(this._features);
  }
}

export const featureManager = new FeatureManager();
