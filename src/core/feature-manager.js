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

export const FEATURE_SETTINGS_INPUT_INVALID = 'FEATURE_SETTINGS_INPUT_INVALID';

// Exact WS setting key -> runtime feature flag authority.
export const FEATURE_SETTING_KEY_MAP = Object.freeze({
  'c3.features.skills': 'skills',
  'c3.features.agents': 'agents',
  'c3.features.lifecycle': 'lifecycle',
  'c3.features.expertises': 'expertises',
  'c3.features.telemetry': 'telemetry',
  'c3.features.specialistTelemetry': 'specialistTelemetry',
  'c3.features.autonomy': 'autonomy',
});

export const FEATURE_SETTING_KEYS = Object.freeze(
  Object.keys(FEATURE_SETTING_KEY_MAP),
);

export class FeatureSettingsInputError extends Error {
  constructor() {
    super(FEATURE_SETTINGS_INPUT_INVALID);
    this.name = 'FeatureSettingsInputError';
    this.code = FEATURE_SETTINGS_INPUT_INVALID;
  }
}

export function requireExactFeatureSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new FeatureSettingsInputError();
  }

  const prototype = Object.getPrototypeOf(settings);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FeatureSettingsInputError();
  }

  const keys = Reflect.ownKeys(settings);
  if (keys.length === 0 || keys.some(key => typeof key !== 'string')) {
    throw new FeatureSettingsInputError();
  }

  const entries = [];
  for (const settingKey of keys) {
    if (!Object.hasOwn(FEATURE_SETTING_KEY_MAP, settingKey)
      || typeof settings[settingKey] !== 'boolean') {
      throw new FeatureSettingsInputError();
    }
    entries.push(Object.freeze({
      settingKey,
      featureName: FEATURE_SETTING_KEY_MAP[settingKey],
      enabled: settings[settingKey],
    }));
  }

  return Object.freeze(entries);
}

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
   * Atomically validate and apply the exact WS feature-settings projection.
   * @param {Object} settings — e.g. { 'c3.features.skills': false }
   */
  applySettings(settings) {
    const entries = requireExactFeatureSettings(settings);

    let changed = 0;
    for (const { featureName, enabled } of entries) {
      const prev = this._features.get(featureName);
      if (prev !== enabled) {
        this.set(featureName, enabled);
        changed++;
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
