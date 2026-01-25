// CRE v40.2 Versioned Behavior
// ══════════════════════════════════════════════════════════════════════════════
//
// Behavior versioning for backwards compatibility.
//
// Purpose:
//   Starý projekt běží beze změny po upgradu CRE.
//
// Key Features:
//   - BehaviorProfile: Snapshot of CRE behavior at a version
//   - Profile selection per project/goal
//   - Automatic migration suggestions
//   - Behavior diff comparison
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// BEHAVIOR ASPECTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Aspects of behavior that can be versioned
 */
export const BehaviorAspect = {
  PLANNER_RULES: 'plannerRules',
  SAFETY_LIMITS: 'safetyLimits',
  CORRECTION_STRATEGY: 'correctionStrategy',
  TOOL_DEFAULTS: 'toolDefaults',
  MEMORY_POLICY: 'memoryPolicy',
  RESPONSE_FORMAT: 'responseFormat',
  ERROR_HANDLING: 'errorHandling',
};

// ════════════════════════════════════════════════════════════════════════════
// BUILT-IN PROFILES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Built-in behavior profiles
 */
export const BuiltInProfiles = {
  'v39.0': {
    version: 'v39.0',
    description: 'Initial autonomous mode',
    aspects: {
      plannerRules: {
        maxSteps: 20,
        parallelExecution: true,
        requireApproval: true,
      },
      safetyLimits: {
        maxTokensPerHour: 100000,
        maxGoalsPerHour: 10,
        maxToolCallsPerGoal: 100,
        maxDurationMs: 3600000,
      },
      correctionStrategy: {
        maxRetries: 3,
        maxReplanAttempts: 2,
        backoffMultiplier: 2,
      },
      toolDefaults: {
        timeoutMs: 30000,
        retryOnTimeout: true,
      },
      memoryPolicy: {
        autoSave: true,
        maxSessionHistory: 100,
      },
      responseFormat: {
        includeMetadata: false,
        verboseErrors: false,
      },
      errorHandling: {
        propagateInternalErrors: false,
        sanitizeMessages: true,
      },
    },
  },

  'v39.3': {
    version: 'v39.3',
    description: 'Local copilot mode with suggestions',
    inherits: 'v39.0',
    aspects: {
      plannerRules: {
        maxSteps: 30,
        suggestionsEnabled: true,
      },
      correctionStrategy: {
        maxRetries: 3,
        useFailureHistory: true,
        maxCorrectionFailures: 3,
      },
    },
  },

  'v40.0': {
    version: 'v40.0',
    description: 'Observability and hardening',
    inherits: 'v39.3',
    aspects: {
      safetyLimits: {
        maxTokensPerHour: 150000,
        maxGoalsPerHour: 15,
      },
      responseFormat: {
        includeMetadata: true,
        includeTraceId: true,
      },
      errorHandling: {
        includeTraceOnError: true,
      },
    },
  },

  'v41.0': {
    version: 'v41.0',
    description: 'Skill system and project memory',
    inherits: 'v40.0',
    aspects: {
      plannerRules: {
        preferSkills: true,
        useProjectContext: true,
      },
    },
  },

  // Latest version alias
  'latest': {
    version: 'latest',
    description: 'Always use the latest behavior',
    inherits: 'v41.0',
    aspects: {},
  },
};

// ════════════════════════════════════════════════════════════════════════════
// BEHAVIOR PROFILE
// ════════════════════════════════════════════════════════════════════════════

/**
 * BehaviorProfile — defines CRE behavior at a specific version
 */
export class BehaviorProfile {
  constructor(config) {
    this.version = config.version;
    this.description = config.description || '';
    this.inherits = config.inherits || null;
    this.aspects = config.aspects || {};
    this.createdAt = config.createdAt || Date.now();
    this.isBuiltIn = config.isBuiltIn || false;

    // Resolved aspects (with inheritance)
    this.resolvedAspects = null;
  }

  /**
   * Resolve aspects with inheritance
   */
  resolve(registry) {
    if (this.resolvedAspects) {
      return this.resolvedAspects;
    }

    // Start with empty aspects
    let resolved = {};

    // Apply inherited profile first
    if (this.inherits) {
      const parent = registry.get(this.inherits);
      if (parent) {
        const parentAspects = parent.resolve(registry);
        resolved = this.deepMerge(resolved, parentAspects);
      }
    }

    // Apply own aspects (override)
    resolved = this.deepMerge(resolved, this.aspects);

    this.resolvedAspects = resolved;
    return resolved;
  }

  /**
   * Deep merge objects
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deepMerge(result[key] || {}, value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Get a specific aspect
   */
  getAspect(aspect, registry) {
    const resolved = this.resolve(registry);
    return resolved[aspect] || {};
  }

  /**
   * Check if profile has a specific aspect setting
   */
  has(aspect, key, registry) {
    const aspectData = this.getAspect(aspect, registry);
    return key in aspectData;
  }

  /**
   * Get a specific setting
   */
  get(aspect, key, defaultValue, registry) {
    const aspectData = this.getAspect(aspect, registry);
    return key in aspectData ? aspectData[key] : defaultValue;
  }

  /**
   * Compare with another profile
   */
  diff(other, registry) {
    const thisResolved = this.resolve(registry);
    const otherResolved = other.resolve(registry);

    const differences = [];

    const compare = (path, obj1, obj2) => {
      const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

      for (const key of keys) {
        const fullPath = path ? `${path}.${key}` : key;
        const val1 = obj1?.[key];
        const val2 = obj2?.[key];

        if (typeof val1 === 'object' && typeof val2 === 'object' &&
            val1 !== null && val2 !== null && !Array.isArray(val1)) {
          compare(fullPath, val1, val2);
        } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          differences.push({
            path: fullPath,
            from: val1,
            to: val2,
          });
        }
      }
    };

    compare('', thisResolved, otherResolved);
    return differences;
  }

  /**
   * Validate profile
   */
  validate() {
    const errors = [];

    if (!this.version) {
      errors.push('Version is required');
    }

    // Validate aspects
    for (const [aspect, settings] of Object.entries(this.aspects)) {
      if (!Object.values(BehaviorAspect).includes(aspect)) {
        errors.push(`Unknown aspect: ${aspect}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      version: this.version,
      description: this.description,
      inherits: this.inherits,
      aspects: this.aspects,
      createdAt: this.createdAt,
      isBuiltIn: this.isBuiltIn,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BEHAVIOR REGISTRY
// ════════════════════════════════════════════════════════════════════════════

/**
 * BehaviorRegistry — manages behavior profiles
 */
export class BehaviorRegistry {
  constructor(options = {}) {
    this.profiles = new Map();
    this.defaultVersion = options.defaultVersion || 'latest';

    // Load built-in profiles
    this.loadBuiltIn();
  }

  /**
   * Load built-in profiles
   */
  loadBuiltIn() {
    for (const [version, config] of Object.entries(BuiltInProfiles)) {
      const profile = new BehaviorProfile({
        ...config,
        isBuiltIn: true,
      });
      this.profiles.set(version, profile);
    }
  }

  /**
   * Register a custom profile
   */
  register(config) {
    const profile = new BehaviorProfile(config);

    const validation = profile.validate();
    if (!validation.valid) {
      throw new Error(`Invalid profile: ${validation.errors.join(', ')}`);
    }

    this.profiles.set(profile.version, profile);
    logger.debug('BehaviorRegistry', `Registered profile: ${profile.version}`);

    return profile;
  }

  /**
   * Get a profile
   */
  get(version) {
    return this.profiles.get(version) || this.profiles.get(this.defaultVersion);
  }

  /**
   * Get resolved aspects for a version
   */
  getResolved(version) {
    const profile = this.get(version);
    return profile ? profile.resolve(this) : {};
  }

  /**
   * Get a specific setting
   */
  getSetting(version, aspect, key, defaultValue) {
    const profile = this.get(version);
    return profile ? profile.get(aspect, key, defaultValue, this) : defaultValue;
  }

  /**
   * Get all versions
   */
  getVersions() {
    return Array.from(this.profiles.keys());
  }

  /**
   * Get all profiles
   */
  getAll() {
    return Array.from(this.profiles.values());
  }

  /**
   * Compare two versions
   */
  compare(version1, version2) {
    const profile1 = this.get(version1);
    const profile2 = this.get(version2);

    if (!profile1 || !profile2) {
      throw new Error('Profile not found');
    }

    return profile1.diff(profile2, this);
  }

  /**
   * Get migration path between versions
   */
  getMigrationPath(fromVersion, toVersion) {
    const differences = this.compare(fromVersion, toVersion);

    const migrations = differences.map(diff => ({
      path: diff.path,
      action: diff.to === undefined ? 'remove' :
              diff.from === undefined ? 'add' : 'change',
      from: diff.from,
      to: diff.to,
      breaking: this.isBreakingChange(diff),
    }));

    return {
      from: fromVersion,
      to: toVersion,
      migrations,
      hasBreaking: migrations.some(m => m.breaking),
    };
  }

  /**
   * Check if a change is breaking
   */
  isBreakingChange(diff) {
    // Removing a feature is breaking
    if (diff.to === undefined) return true;

    // Reducing limits is breaking
    if (typeof diff.from === 'number' && typeof diff.to === 'number') {
      if (diff.path.includes('max') && diff.to < diff.from) return true;
    }

    // Disabling features is breaking
    if (diff.from === true && diff.to === false) return true;

    return false;
  }

  /**
   * Set default version
   */
  setDefault(version) {
    if (!this.profiles.has(version)) {
      throw new Error(`Unknown version: ${version}`);
    }
    this.defaultVersion = version;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BEHAVIOR CONTEXT
// ════════════════════════════════════════════════════════════════════════════

/**
 * BehaviorContext — provides behavior settings for a specific execution
 *
 * IMPORTANT: Behavior context MUST be frozen at execution start.
 *   - All resolved aspects are snapshotted at creation
 *   - Once frozen, behavior cannot be changed during execution
 *   - This ensures deterministic behavior during replay
 *
 * Usage:
 *   const ctx = createBehaviorContext('v40.0');
 *   // Apply any overrides BEFORE freezing
 *   ctx.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 5);
 *   ctx.freeze();  // Now immutable
 */
export class BehaviorContext {
  constructor(registry, version, options = {}) {
    this.registry = registry;
    this.version = version;
    this.profile = registry.get(version);
    this.overrides = {};

    // IMMUTABILITY STATE
    this._frozen = false;
    this._frozenAt = null;
    this._snapshot = null;

    // Auto-freeze option (recommended for execution)
    if (options.autoFreeze) {
      this.freeze();
    }
  }

  /**
   * Freeze the behavior context (makes it immutable)
   *
   * IMPORTANT: Call this at execution start.
   * After freezing:
   *   - override() will throw
   *   - get() returns from frozen snapshot
   */
  freeze() {
    if (this._frozen) {
      return this;  // Already frozen
    }

    // Take snapshot of all resolved aspects with overrides applied
    const resolved = this.profile.resolve(this.registry);
    this._snapshot = this._deepFreeze(this._applyOverrides(resolved));
    this._frozen = true;
    this._frozenAt = Date.now();

    logger.debug('BehaviorContext', `Frozen context: ${this.version}`, {
      frozenAt: this._frozenAt,
      overrides: Object.keys(this.overrides).length,
    });

    return this;
  }

  /**
   * Apply overrides to resolved aspects
   */
  _applyOverrides(resolved) {
    const result = JSON.parse(JSON.stringify(resolved));

    for (const [key, value] of Object.entries(this.overrides)) {
      const [aspect, setting] = key.split('.');
      if (!result[aspect]) {
        result[aspect] = {};
      }
      result[aspect][setting] = value;
    }

    return result;
  }

  /**
   * Deep freeze an object
   */
  _deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Freeze nested objects first
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value !== null && typeof value === 'object') {
        this._deepFreeze(value);
      }
    }

    return Object.freeze(obj);
  }

  /**
   * Check if frozen
   */
  isFrozen() {
    return this._frozen;
  }

  /**
   * Get when frozen
   */
  getFrozenAt() {
    return this._frozenAt;
  }

  /**
   * Get a setting
   */
  get(aspect, key, defaultValue) {
    // If frozen, use snapshot
    if (this._frozen && this._snapshot) {
      const aspectData = this._snapshot[aspect];
      return aspectData && key in aspectData ? aspectData[key] : defaultValue;
    }

    // Check overrides first
    const overrideKey = `${aspect}.${key}`;
    if (overrideKey in this.overrides) {
      return this.overrides[overrideKey];
    }

    return this.profile.get(aspect, key, defaultValue, this.registry);
  }

  /**
   * Get entire aspect
   */
  getAspect(aspect) {
    if (this._frozen && this._snapshot) {
      return this._snapshot[aspect] || {};
    }
    return this.profile.getAspect(aspect, this.registry);
  }

  /**
   * Override a setting for this context
   *
   * IMPORTANT: Cannot override after freeze()
   */
  override(aspect, key, value) {
    if (this._frozen) {
      throw new Error(`BehaviorContext is frozen. Cannot override ${aspect}.${key}`);
    }
    this.overrides[`${aspect}.${key}`] = value;
    return this;
  }

  /**
   * Get all overrides
   */
  getOverrides() {
    return { ...this.overrides };
  }

  /**
   * Get frozen snapshot (if frozen)
   */
  getSnapshot() {
    if (!this._frozen) {
      throw new Error('BehaviorContext is not frozen. Call freeze() first.');
    }
    return this._snapshot;
  }

  /**
   * Get version info
   */
  getVersion() {
    return {
      version: this.version,
      description: this.profile?.description,
      overrides: Object.keys(this.overrides).length,
      frozen: this._frozen,
      frozenAt: this._frozenAt,
    };
  }

  /**
   * Serialize for recording (replay support)
   */
  toJSON() {
    return {
      version: this.version,
      overrides: this.overrides,
      frozen: this._frozen,
      frozenAt: this._frozenAt,
      snapshot: this._snapshot,
    };
  }

  /**
   * Create from serialized data (replay support)
   */
  static fromJSON(data, registry) {
    const ctx = new BehaviorContext(registry, data.version);
    ctx.overrides = data.overrides || {};

    if (data.frozen && data.snapshot) {
      // Restore frozen state directly from snapshot
      ctx._snapshot = ctx._deepFreeze(data.snapshot);
      ctx._frozen = true;
      ctx._frozenAt = data.frozenAt;
    }

    return ctx;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a behavior context for a version
 *
 * @param {string} version - Behavior version (e.g., 'v40.0', 'latest')
 * @param {Object} options - Options
 * @param {boolean} options.autoFreeze - Freeze immediately (recommended for execution)
 * @returns {BehaviorContext}
 *
 * IMPORTANT: For execution, use autoFreeze: true
 *   const ctx = createBehaviorContext('v40.0', { autoFreeze: true });
 *
 * For configuration (with overrides), freeze manually:
 *   const ctx = createBehaviorContext('v40.0');
 *   ctx.override(BehaviorAspect.PLANNER_RULES, 'maxSteps', 5);
 *   ctx.freeze();
 */
export function createBehaviorContext(version = 'latest', options = {}) {
  return new BehaviorContext(behaviorRegistry, version, options);
}

/**
 * Create a frozen behavior context for execution
 *
 * This is the recommended way to create a context for execution.
 * The context is immediately frozen and cannot be modified.
 */
export function createFrozenBehaviorContext(version = 'latest') {
  return createBehaviorContext(version, { autoFreeze: true });
}

/**
 * Get a behavior setting
 */
export function getBehavior(aspect, key, defaultValue, version = 'latest') {
  return behaviorRegistry.getSetting(version, aspect, key, defaultValue);
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const behaviorRegistry = new BehaviorRegistry();

export default {
  BehaviorAspect,
  BehaviorProfile,
  BehaviorRegistry,
  BehaviorContext,
  BuiltInProfiles,
  behaviorRegistry,
  createBehaviorContext,
  createFrozenBehaviorContext,
  getBehavior,
};
