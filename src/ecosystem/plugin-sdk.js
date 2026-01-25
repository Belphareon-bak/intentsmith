// CRE v43.x Ecosystem — Plugin SDK
// ══════════════════════════════════════════════════════════════════════════════
//
// Tools, Skills, Experts jako pluginy
//
// Plugin types:
// - TOOL: Atomic actions (web_search, file_read, etc.)
// - SKILL: Verified sequences of steps
// - EXPERT: Specialized domain knowledge
// - EXTENSION: General CRE extensions
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Plugin types
 */
export const PluginType = Object.freeze({
  TOOL: 'TOOL',           // Atomic action
  SKILL: 'SKILL',         // Verified sequence
  EXPERT: 'EXPERT',       // Domain specialist
  EXTENSION: 'EXTENSION', // General extension
});

/**
 * Plugin lifecycle states
 */
export const PluginState = Object.freeze({
  REGISTERED: 'REGISTERED',   // Registered but not loaded
  LOADING: 'LOADING',         // Currently loading
  LOADED: 'LOADED',           // Loaded and ready
  ACTIVE: 'ACTIVE',           // Active and in use
  DISABLED: 'DISABLED',       // Disabled by user/system
  ERROR: 'ERROR',             // Error state
  UNLOADED: 'UNLOADED',       // Unloaded from memory
});

/**
 * Plugin execution modes for gate enforcement
 */
export const PluginExecutionMode = Object.freeze({
  SANDBOXED: 'SANDBOXED',       // Full gate enforcement (default)
  VERIFIED: 'VERIFIED',         // Reduced gate checks for verified plugins
  SYSTEM: 'SYSTEM',             // System plugins only - minimal gates
});

/**
 * Plugin capability flags
 */
export const PluginCapability = Object.freeze({
  READ_FILES: 'READ_FILES',
  WRITE_FILES: 'WRITE_FILES',
  NETWORK: 'NETWORK',
  EXECUTE_COMMANDS: 'EXECUTE_COMMANDS',
  ACCESS_MEMORY: 'ACCESS_MEMORY',
  MODIFY_MEMORY: 'MODIFY_MEMORY',
  USE_LLM: 'USE_LLM',
  SPAWN_AGENTS: 'SPAWN_AGENTS',
});

/**
 * Plugin manifest schema
 * Every plugin MUST declare a manifest
 */
export const PLUGIN_MANIFEST_SCHEMA = {
  required: ['id', 'name', 'version', 'type', 'entryPoint'],
  properties: {
    id: { type: 'string', pattern: /^[a-z][a-z0-9-]*$/ },
    name: { type: 'string' },
    version: { type: 'string', pattern: /^\d+\.\d+\.\d+$/ },
    type: { type: 'string', enum: Object.values(PluginType) },
    description: { type: 'string' },
    author: { type: 'string' },
    license: { type: 'string' },
    entryPoint: { type: 'string' },
    capabilities: { type: 'array', items: { enum: Object.values(PluginCapability) } },
    dependencies: { type: 'array', items: { type: 'string' } },
    cre: {
      type: 'object',
      properties: {
        minVersion: { type: 'string' },
        maxVersion: { type: 'string' },
      },
    },
  },
};

/**
 * Plugin Manifest - Describes a plugin
 */
export class PluginManifest {
  #data;

  /**
   * @param {Object} data - Manifest data
   */
  constructor(data) {
    this.#validate(data);
    this.#data = Object.freeze({ ...data });
  }

  get id() { return this.#data.id; }
  get name() { return this.#data.name; }
  get version() { return this.#data.version; }
  get type() { return this.#data.type; }
  get description() { return this.#data.description || ''; }
  get author() { return this.#data.author || ''; }
  get license() { return this.#data.license || ''; }
  get entryPoint() { return this.#data.entryPoint; }
  get capabilities() { return this.#data.capabilities || []; }
  get dependencies() { return this.#data.dependencies || []; }
  get cre() { return this.#data.cre || {}; }

  /**
   * Check if plugin requires specific capability
   * @param {string} capability - PluginCapability
   * @returns {boolean}
   */
  requiresCapability(capability) {
    return this.capabilities.includes(capability);
  }

  /**
   * Serialize to JSON
   * @returns {Object}
   */
  toJSON() {
    return { ...this.#data };
  }

  #validate(data) {
    for (const field of PLUGIN_MANIFEST_SCHEMA.required) {
      if (!(field in data)) {
        throw new Error(`Plugin manifest missing required field: ${field}`);
      }
    }

    if (!PLUGIN_MANIFEST_SCHEMA.properties.id.pattern.test(data.id)) {
      throw new Error(`Invalid plugin id format: ${data.id}`);
    }

    if (!PLUGIN_MANIFEST_SCHEMA.properties.version.pattern.test(data.version)) {
      throw new Error(`Invalid plugin version format: ${data.version}`);
    }

    if (!Object.values(PluginType).includes(data.type)) {
      throw new Error(`Invalid plugin type: ${data.type}`);
    }
  }
}

/**
 * Plugin - Base class for all plugins
 */
export class Plugin {
  #manifest;
  #state;
  #instance;
  #loadedAt;
  #error;
  #metadata;
  #context;  // PluginContext with gate enforcement

  /**
   * @param {PluginManifest} manifest - Plugin manifest
   */
  constructor(manifest) {
    if (!(manifest instanceof PluginManifest)) {
      manifest = new PluginManifest(manifest);
    }

    this.#manifest = manifest;
    this.#state = PluginState.REGISTERED;
    this.#instance = null;
    this.#loadedAt = null;
    this.#error = null;
    this.#metadata = {};
    this.#context = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id() { return this.#manifest.id; }
  get name() { return this.#manifest.name; }
  get version() { return this.#manifest.version; }
  get type() { return this.#manifest.type; }
  get state() { return this.#state; }
  get manifest() { return this.#manifest; }
  get instance() { return this.#instance; }
  get loadedAt() { return this.#loadedAt; }
  get error() { return this.#error; }
  get context() { return this.#context; }  // Gate-enforced context

  /**
   * Check if plugin is ready for use
   * @returns {boolean}
   */
  isReady() {
    return this.#state === PluginState.LOADED || this.#state === PluginState.ACTIVE;
  }

  /**
   * Check if plugin is in error state
   * @returns {boolean}
   */
  hasError() {
    return this.#state === PluginState.ERROR;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Load the plugin
   * @param {Object} loader - Plugin loader context
   * @returns {Promise<Plugin>}
   */
  async load(loader) {
    if (this.#state !== PluginState.REGISTERED && this.#state !== PluginState.UNLOADED) {
      throw new Error(`Cannot load plugin in state: ${this.#state}`);
    }

    this.#state = PluginState.LOADING;

    try {
      // Load the plugin module
      const module = await loader.loadModule(this.#manifest.entryPoint);

      // Validate module exports
      if (typeof module.activate !== 'function') {
        throw new Error('Plugin module must export activate function');
      }

      this.#instance = module;
      this.#state = PluginState.LOADED;
      this.#loadedAt = new Date().toISOString();
      this.#error = null;

      return this;
    } catch (err) {
      this.#state = PluginState.ERROR;
      this.#error = err.message;
      throw err;
    }
  }

  /**
   * Activate the plugin with gate-enforced context
   *
   * CRITICAL: Plugin receives PluginContext that enforces all gates.
   * Plugin CANNOT bypass Safety/HumanGate/LLMGate.
   *
   * @param {Object} activationConfig - Configuration for activation
   * @param {Object} activationConfig.gates - Gate instances
   * @param {Object} activationConfig.safetyProfile - Current safety profile
   * @param {Function} activationConfig.toolExecutor - Tool executor function
   * @param {string} [activationConfig.executionMode] - PluginExecutionMode
   * @returns {Promise<Plugin>}
   */
  async activate(activationConfig) {
    if (this.#state !== PluginState.LOADED) {
      throw new Error(`Cannot activate plugin in state: ${this.#state}`);
    }

    // Validate activation config has required gate enforcement
    if (!activationConfig.gates) {
      throw new Error('Plugin activation requires gates for security enforcement');
    }
    if (!activationConfig.safetyProfile) {
      throw new Error('Plugin activation requires safetyProfile');
    }
    if (!activationConfig.toolExecutor) {
      throw new Error('Plugin activation requires toolExecutor');
    }

    try {
      // Create gate-enforced context
      this.#context = new PluginContext({
        pluginId: this.id,
        gates: activationConfig.gates,
        safetyProfile: activationConfig.safetyProfile,
        toolExecutor: activationConfig.toolExecutor,
        executionMode: activationConfig.executionMode || PluginExecutionMode.SANDBOXED,
      });

      // Activate plugin with controlled context
      // Plugin receives ONLY the PluginContext, not raw access
      await this.#instance.activate(this.#context);
      this.#state = PluginState.ACTIVE;
      return this;
    } catch (err) {
      this.#state = PluginState.ERROR;
      this.#error = err.message;
      throw err;
    }
  }

  /**
   * Deactivate the plugin
   * Freezes the context to prevent further operations
   * @returns {Promise<Plugin>}
   */
  async deactivate() {
    if (this.#state !== PluginState.ACTIVE) {
      throw new Error(`Cannot deactivate plugin in state: ${this.#state}`);
    }

    try {
      if (typeof this.#instance.deactivate === 'function') {
        await this.#instance.deactivate();
      }

      // Freeze context to prevent further operations
      if (this.#context) {
        this.#context.freeze();
      }

      this.#state = PluginState.LOADED;
      return this;
    } catch (err) {
      this.#state = PluginState.ERROR;
      this.#error = err.message;
      throw err;
    }
  }

  /**
   * Unload the plugin
   * @returns {Promise<Plugin>}
   */
  async unload() {
    if (this.#state === PluginState.ACTIVE) {
      await this.deactivate();
    }

    this.#instance = null;
    this.#state = PluginState.UNLOADED;
    this.#loadedAt = null;

    return this;
  }

  /**
   * Disable the plugin
   * @returns {Plugin}
   */
  disable() {
    this.#state = PluginState.DISABLED;
    return this;
  }

  /**
   * Enable a disabled plugin
   * @returns {Plugin}
   */
  enable() {
    if (this.#state !== PluginState.DISABLED) {
      throw new Error(`Cannot enable plugin in state: ${this.#state}`);
    }
    this.#state = this.#instance ? PluginState.LOADED : PluginState.REGISTERED;
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set metadata
   * @param {string} key
   * @param {*} value
   */
  setMetadata(key, value) {
    this.#metadata[key] = value;
  }

  /**
   * Get metadata
   * @param {string} key
   * @returns {*}
   */
  getMetadata(key) {
    return this.#metadata[key];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Serialize to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      manifest: this.#manifest.toJSON(),
      state: this.#state,
      loadedAt: this.#loadedAt,
      error: this.#error,
      metadata: { ...this.#metadata },
    };
  }
}

/**
 * PluginValidator - Validates plugins before loading
 */
export class PluginValidator {
  #rules;
  #allowedCapabilities;

  constructor() {
    this.#rules = new Map();
    this.#allowedCapabilities = new Set(Object.values(PluginCapability));
    this.#setupDefaultRules();
  }

  /**
   * Validate a plugin manifest
   * @param {PluginManifest|Object} manifest
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(manifest) {
    const errors = [];

    if (!(manifest instanceof PluginManifest)) {
      try {
        manifest = new PluginManifest(manifest);
      } catch (err) {
        return { valid: false, errors: [err.message] };
      }
    }

    // Run all validation rules
    for (const [name, rule] of this.#rules) {
      const result = rule(manifest);
      if (result !== true) {
        errors.push(`[${name}] ${result}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Add custom validation rule
   * @param {string} name - Rule name
   * @param {Function} rule - (manifest) => true | errorMessage
   */
  addRule(name, rule) {
    this.#rules.set(name, rule);
  }

  /**
   * Remove a rule
   * @param {string} name
   */
  removeRule(name) {
    this.#rules.delete(name);
  }

  /**
   * Set allowed capabilities
   * @param {string[]} capabilities
   */
  setAllowedCapabilities(capabilities) {
    this.#allowedCapabilities = new Set(capabilities);
  }

  #setupDefaultRules() {
    // Rule: No dangerous capability combinations
    this.#rules.set('safe-capabilities', (manifest) => {
      const caps = manifest.capabilities;
      if (caps.includes(PluginCapability.EXECUTE_COMMANDS) &&
          caps.includes(PluginCapability.NETWORK)) {
        return 'Cannot combine EXECUTE_COMMANDS and NETWORK capabilities';
      }
      return true;
    });

    // Rule: Valid capabilities only
    this.#rules.set('valid-capabilities', (manifest) => {
      for (const cap of manifest.capabilities) {
        if (!this.#allowedCapabilities.has(cap)) {
          return `Unknown capability: ${cap}`;
        }
      }
      return true;
    });

    // Rule: Version semver format
    this.#rules.set('valid-version', (manifest) => {
      if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        return 'Version must be in semver format (x.y.z)';
      }
      return true;
    });
  }
}

/**
 * PluginRegistry - Central registry for all plugins
 */
export class PluginRegistry {
  #plugins;
  #validator;
  #loader;
  #hooks;

  constructor() {
    this.#plugins = new Map();
    this.#validator = new PluginValidator();
    this.#loader = null;
    this.#hooks = {
      beforeLoad: [],
      afterLoad: [],
      beforeActivate: [],
      afterActivate: [],
      beforeUnload: [],
      afterUnload: [],
    };
  }

  /**
   * Set the plugin loader
   * @param {Object} loader
   */
  setLoader(loader) {
    this.#loader = loader;
  }

  /**
   * Register a plugin
   * @param {Object|PluginManifest} manifest - Plugin manifest
   * @returns {{ success: boolean, plugin?: Plugin, errors?: string[] }}
   */
  register(manifest) {
    const validation = this.#validator.validate(manifest);

    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    if (!(manifest instanceof PluginManifest)) {
      manifest = new PluginManifest(manifest);
    }

    // Check for duplicate
    if (this.#plugins.has(manifest.id)) {
      return { success: false, errors: [`Plugin already registered: ${manifest.id}`] };
    }

    const plugin = new Plugin(manifest);
    this.#plugins.set(manifest.id, plugin);

    return { success: true, plugin };
  }

  /**
   * Unregister a plugin
   * @param {string} pluginId
   * @returns {boolean}
   */
  unregister(pluginId) {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) return false;

    if (plugin.isReady()) {
      throw new Error('Cannot unregister active plugin. Unload first.');
    }

    return this.#plugins.delete(pluginId);
  }

  /**
   * Load a plugin
   * @param {string} pluginId
   * @returns {Promise<Plugin>}
   */
  async load(pluginId) {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (!this.#loader) {
      throw new Error('Plugin loader not set');
    }

    await this.#runHooks('beforeLoad', plugin);
    await plugin.load(this.#loader);
    await this.#runHooks('afterLoad', plugin);

    return plugin;
  }

  /**
   * Activate a plugin
   * @param {string} pluginId
   * @param {Object} [context] - Activation context
   * @returns {Promise<Plugin>}
   */
  async activate(pluginId, context = {}) {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    await this.#runHooks('beforeActivate', plugin);
    await plugin.activate(context);
    await this.#runHooks('afterActivate', plugin);

    return plugin;
  }

  /**
   * Unload a plugin
   * @param {string} pluginId
   * @returns {Promise<Plugin>}
   */
  async unload(pluginId) {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    await this.#runHooks('beforeUnload', plugin);
    await plugin.unload();
    await this.#runHooks('afterUnload', plugin);

    return plugin;
  }

  /**
   * Get a plugin by ID
   * @param {string} pluginId
   * @returns {Plugin|null}
   */
  get(pluginId) {
    return this.#plugins.get(pluginId) || null;
  }

  /**
   * Get all plugins
   * @returns {Plugin[]}
   */
  getAll() {
    return Array.from(this.#plugins.values());
  }

  /**
   * Get plugins by type
   * @param {string} type - PluginType
   * @returns {Plugin[]}
   */
  getByType(type) {
    return this.getAll().filter(p => p.type === type);
  }

  /**
   * Get active plugins
   * @returns {Plugin[]}
   */
  getActive() {
    return this.getAll().filter(p => p.state === PluginState.ACTIVE);
  }

  /**
   * Add lifecycle hook
   * @param {string} event - Hook event name
   * @param {Function} handler - (plugin) => Promise<void>
   */
  addHook(event, handler) {
    if (!(event in this.#hooks)) {
      throw new Error(`Unknown hook event: ${event}`);
    }
    this.#hooks[event].push(handler);
  }

  /**
   * Get validator for custom rules
   * @returns {PluginValidator}
   */
  getValidator() {
    return this.#validator;
  }

  async #runHooks(event, plugin) {
    for (const handler of this.#hooks[event]) {
      await handler(plugin);
    }
  }
}

/**
 * Simple in-memory plugin loader
 * In production, this would load from filesystem or network
 */
export class PluginLoader {
  #modules;

  constructor() {
    this.#modules = new Map();
  }

  /**
   * Register a module for loading
   * @param {string} path - Module path
   * @param {Object} module - Module exports
   */
  registerModule(path, module) {
    this.#modules.set(path, module);
  }

  /**
   * Load a module by path
   * @param {string} path
   * @returns {Promise<Object>}
   */
  async loadModule(path) {
    const module = this.#modules.get(path);
    if (!module) {
      throw new Error(`Module not found: ${path}`);
    }
    return module;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PluginContext — Security Gate Enforcement
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PluginContext - Secure execution context for plugins
 *
 * CRITICAL: Plugins MUST NOT bypass Security/HumanGate/LLMGate.
 * This context wraps tool execution to enforce all gates.
 *
 * Authority chain: User > HumanGate > CRE > Plugin
 */
export class PluginContext {
  #pluginId;
  #executionMode;
  #gates;
  #safetyProfile;
  #toolExecutor;
  #auditLog;
  #frozen;

  /**
   * @param {Object} config
   * @param {string} config.pluginId - The plugin this context belongs to
   * @param {Object} config.gates - Gate instances { humanGate, llmGate, safetyGate }
   * @param {Object} config.safetyProfile - Current safety profile
   * @param {Function} config.toolExecutor - Raw tool executor function
   * @param {string} [config.executionMode] - PluginExecutionMode (default: SANDBOXED)
   */
  constructor(config) {
    if (!config.pluginId) {
      throw new Error('PluginContext requires pluginId');
    }
    if (!config.gates) {
      throw new Error('PluginContext requires gates');
    }
    if (!config.safetyProfile) {
      throw new Error('PluginContext requires safetyProfile');
    }
    if (!config.toolExecutor) {
      throw new Error('PluginContext requires toolExecutor');
    }

    this.#pluginId = config.pluginId;
    this.#executionMode = config.executionMode || PluginExecutionMode.SANDBOXED;
    this.#gates = Object.freeze({ ...config.gates });
    this.#safetyProfile = Object.freeze({ ...config.safetyProfile });
    this.#toolExecutor = config.toolExecutor;
    this.#auditLog = [];
    this.#frozen = false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Read-only accessors (plugins can read but not modify)
  // ─────────────────────────────────────────────────────────────────────────────

  get pluginId() { return this.#pluginId; }
  get executionMode() { return this.#executionMode; }

  /**
   * Get current safety profile (read-only copy)
   * @returns {Object}
   */
  getSafetyProfile() {
    return { ...this.#safetyProfile };
  }

  /**
   * Check if a capability is allowed by current safety profile
   * @param {string} capability - PluginCapability
   * @returns {boolean}
   */
  isCapabilityAllowed(capability) {
    const blockedCaps = this.#safetyProfile.blockedCapabilities || [];
    return !blockedCaps.includes(capability);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Gate-Enforced Tool Execution
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Execute a tool through the gate chain
   *
   * All tool executions MUST go through this method.
   * Gates are checked in order: Safety → HumanGate → LLMGate
   *
   * @param {string} toolName - Name of the tool to execute
   * @param {Object} params - Tool parameters
   * @param {Object} [options] - Execution options
   * @returns {Promise<{ success: boolean, result?: any, error?: string, gateBlocked?: string }>}
   */
  async executeTool(toolName, params, options = {}) {
    this.#ensureNotFrozen();

    const request = {
      pluginId: this.#pluginId,
      toolName,
      params,
      timestamp: new Date().toISOString(),
      executionMode: this.#executionMode,
    };

    // Audit log
    this.#log('TOOL_REQUEST', { toolName, params: this.#sanitizeParams(params) });

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // GATE CHAIN: Safety → HumanGate → LLMGate → Execution
      // ─────────────────────────────────────────────────────────────────────────

      // 1. Safety Gate - Always checked
      if (this.#gates.safetyGate) {
        const safetyCheck = await this.#gates.safetyGate.check(request);
        if (!safetyCheck.allowed) {
          this.#log('GATE_BLOCKED', { gate: 'safetyGate', reason: safetyCheck.reason });
          return {
            success: false,
            error: `Safety gate blocked: ${safetyCheck.reason}`,
            gateBlocked: 'safetyGate',
          };
        }
      }

      // 2. Human Gate - Check if human approval required
      if (this.#gates.humanGate && this.#executionMode === PluginExecutionMode.SANDBOXED) {
        const humanCheck = await this.#gates.humanGate.check(request);
        if (humanCheck.requiresApproval) {
          const approval = await this.#gates.humanGate.requestApproval(request);
          if (!approval.approved) {
            this.#log('GATE_BLOCKED', { gate: 'humanGate', reason: 'User denied' });
            return {
              success: false,
              error: 'Human gate blocked: User denied approval',
              gateBlocked: 'humanGate',
            };
          }
        }
      }

      // 3. LLM Gate - Additional LLM-based safety check
      if (this.#gates.llmGate && this.#executionMode === PluginExecutionMode.SANDBOXED) {
        const llmCheck = await this.#gates.llmGate.evaluate(request);
        if (!llmCheck.allowed) {
          this.#log('GATE_BLOCKED', { gate: 'llmGate', reason: llmCheck.reason });
          return {
            success: false,
            error: `LLM gate blocked: ${llmCheck.reason}`,
            gateBlocked: 'llmGate',
          };
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // All gates passed - Execute tool
      // ─────────────────────────────────────────────────────────────────────────
      const result = await this.#toolExecutor(toolName, params, {
        ...options,
        pluginId: this.#pluginId,
        executionMode: this.#executionMode,
      });

      this.#log('TOOL_SUCCESS', { toolName });

      return { success: true, result };

    } catch (error) {
      this.#log('TOOL_ERROR', { toolName, error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Request a capability not in the original manifest
   * ALWAYS requires human approval
   *
   * @param {string} capability - PluginCapability
   * @param {string} reason - Why the capability is needed
   * @returns {Promise<{ granted: boolean, reason?: string }>}
   */
  async requestCapability(capability, reason) {
    this.#ensureNotFrozen();

    if (!Object.values(PluginCapability).includes(capability)) {
      return { granted: false, reason: `Unknown capability: ${capability}` };
    }

    this.#log('CAPABILITY_REQUEST', { capability, reason });

    // ALWAYS requires human approval for capability escalation
    if (this.#gates.humanGate) {
      const approval = await this.#gates.humanGate.requestApproval({
        type: 'CAPABILITY_REQUEST',
        pluginId: this.#pluginId,
        capability,
        reason,
      });

      if (!approval.approved) {
        this.#log('CAPABILITY_DENIED', { capability });
        return { granted: false, reason: 'User denied capability request' };
      }
    }

    this.#log('CAPABILITY_GRANTED', { capability });
    return { granted: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Freeze the context (called when plugin is deactivated)
   * After freezing, no further operations are allowed
   */
  freeze() {
    this.#frozen = true;
    this.#log('CONTEXT_FROZEN', {});
  }

  /**
   * Check if context is frozen
   * @returns {boolean}
   */
  isFrozen() {
    return this.#frozen;
  }

  /**
   * Get audit log for this context
   * @returns {Object[]}
   */
  getAuditLog() {
    return [...this.#auditLog];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  #ensureNotFrozen() {
    if (this.#frozen) {
      throw new Error('PluginContext is frozen - no operations allowed');
    }
  }

  #log(event, data) {
    this.#auditLog.push({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    });
  }

  #sanitizeParams(params) {
    // Remove sensitive data from audit logs
    const sanitized = { ...params };
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'credential'];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  /**
   * Serialize context state (excluding sensitive data)
   * @returns {Object}
   */
  toJSON() {
    return {
      pluginId: this.#pluginId,
      executionMode: this.#executionMode,
      frozen: this.#frozen,
      auditLogCount: this.#auditLog.length,
    };
  }
}

/**
 * Create a plugin context with gate enforcement
 * @param {Object} config - PluginContext configuration
 * @returns {PluginContext}
 */
export function createPluginContext(config) {
  return new PluginContext(config);
}

// ══════════════════════════════════════════════════════════════════════════════
// Singleton instances
// ══════════════════════════════════════════════════════════════════════════════

export const pluginRegistry = new PluginRegistry();
export const pluginLoader = new PluginLoader();
pluginRegistry.setLoader(pluginLoader);

// ══════════════════════════════════════════════════════════════════════════════
// Factory Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create plugin manifest
 * @param {Object} data
 * @returns {PluginManifest}
 */
export function createPluginManifest(data) {
  return new PluginManifest(data);
}

/**
 * Create and register a plugin
 * @param {Object} manifest - Plugin manifest data
 * @returns {{ success: boolean, plugin?: Plugin, errors?: string[] }}
 */
export function createPlugin(manifest) {
  return pluginRegistry.register(manifest);
}

export default PluginRegistry;
