// CRE v41.0: Skill System
// ══════════════════════════════════════════════════════════════════════════════
//
// Skill ≠ Tool
// - Tool: atomic action (read file, execute command)
// - Skill: verified sequence of steps that achieves a goal
//
// Skills are reusable, composable, and can be shared across projects.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Skill categories
 */
export const SkillCategory = {
  CODE_GENERATION: 'code_generation',
  REFACTORING: 'refactoring',
  TESTING: 'testing',
  DEBUGGING: 'debugging',
  DOCUMENTATION: 'documentation',
  DEPLOYMENT: 'deployment',
  ANALYSIS: 'analysis',
  CUSTOM: 'custom',
};

/**
 * Skill verification status
 */
export const SkillStatus = {
  DRAFT: 'draft',           // Not yet verified
  VERIFIED: 'verified',     // Tested and working
  DEPRECATED: 'deprecated', // No longer recommended
  BROKEN: 'broken',         // Known issues
};

/**
 * Skill input/output types
 */
export const SkillIOType = {
  FILE: 'file',
  FILE_LIST: 'file_list',
  TEXT: 'text',
  CODE: 'code',
  JSON: 'json',
  BOOLEAN: 'boolean',
  NUMBER: 'number',
  ANY: 'any',
};

/**
 * Skill step types
 */
export const StepType = {
  TOOL: 'tool',           // Execute a tool
  SKILL: 'skill',         // Execute another skill (composition)
  CONDITION: 'condition', // Conditional branching
  LOOP: 'loop',           // Iteration
  TRANSFORM: 'transform', // Data transformation
  VALIDATE: 'validate',   // Validation checkpoint
};

// ════════════════════════════════════════════════════════════════════════════
// SAFETY PROFILE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Safety levels for skills
 */
export const SafetyLevel = {
  SAFE: 'safe',           // Read-only operations, no side effects
  NORMAL: 'normal',       // Standard operations, may modify files
  ELEVATED: 'elevated',   // Requires elevated permissions
  DANGEROUS: 'dangerous', // Can cause significant changes, requires approval
};

/**
 * SafetyProfile — defines safety constraints for skill execution
 *
 * IMPORTANT: Every skill MUST have a SafetyProfile.
 * This ensures bounded execution and predictable behavior.
 *
 * Fields:
 *   - level: SafetyLevel (safe, normal, elevated, dangerous)
 *   - maxSteps: Maximum number of steps allowed
 *   - maxDurationMs: Maximum execution time in milliseconds
 *   - allowedTools: List of tool IDs this skill can use (null = all)
 *   - blockedTools: List of tool IDs this skill cannot use
 *   - requiresApproval: Whether user approval is needed before execution
 *   - sandboxRequired: Whether execution must happen in sandbox
 *   - canModifyFiles: Whether skill can modify files
 *   - canExecuteCommands: Whether skill can execute shell commands
 *   - canAccessNetwork: Whether skill can make network requests
 */
export class SafetyProfile {
  constructor(config = {}) {
    // Safety level
    this.level = config.level || SafetyLevel.NORMAL;

    // Execution bounds
    this.maxSteps = config.maxSteps ?? 20;
    this.maxDurationMs = config.maxDurationMs ?? 300000;  // 5 minutes
    this.maxRetries = config.maxRetries ?? 3;
    this.maxLoopIterations = config.maxLoopIterations ?? 100;

    // Tool restrictions
    this.allowedTools = config.allowedTools || null;  // null = all tools allowed
    this.blockedTools = config.blockedTools || [];

    // Approval requirements
    this.requiresApproval = config.requiresApproval ?? false;
    this.approvalReason = config.approvalReason || null;

    // Sandbox requirements
    this.sandboxRequired = config.sandboxRequired ?? false;

    // Permission flags
    this.canModifyFiles = config.canModifyFiles ?? true;
    this.canExecuteCommands = config.canExecuteCommands ?? false;
    this.canAccessNetwork = config.canAccessNetwork ?? false;
    this.canAccessSecrets = config.canAccessSecrets ?? false;

    // Validate on construction
    Object.freeze(this);
  }

  /**
   * Check if a tool is allowed by this profile
   */
  isToolAllowed(toolId) {
    // Check blocked list first
    if (this.blockedTools.includes(toolId)) {
      return false;
    }

    // If allowedTools is null, all tools are allowed (except blocked)
    if (this.allowedTools === null) {
      return true;
    }

    // Check against allowed list
    return this.allowedTools.includes(toolId);
  }

  /**
   * Get list of disallowed tools for a given tool list
   */
  getDisallowedTools(toolIds) {
    return toolIds.filter(id => !this.isToolAllowed(id));
  }

  /**
   * Validate skill steps against this profile
   */
  validateSteps(steps) {
    const errors = [];

    // Check step count
    if (this._countSteps(steps) > this.maxSteps) {
      errors.push(`Skill exceeds maxSteps (${this.maxSteps})`);
    }

    // Check tool permissions
    const usedTools = this._collectToolIds(steps);
    const disallowed = this.getDisallowedTools(usedTools);
    if (disallowed.length > 0) {
      errors.push(`Skill uses disallowed tools: ${disallowed.join(', ')}`);
    }

    // Check loop limits
    for (const step of this._flattenSteps(steps)) {
      if (step.type === StepType.LOOP && step.maxIterations > this.maxLoopIterations) {
        errors.push(`Step ${step.id} exceeds maxLoopIterations (${this.maxLoopIterations})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Count total steps (including nested)
   */
  _countSteps(steps) {
    let count = 0;
    for (const step of steps) {
      count++;
      if (step.thenSteps) count += this._countSteps(step.thenSteps);
      if (step.elseSteps) count += this._countSteps(step.elseSteps);
      if (step.loopSteps) count += this._countSteps(step.loopSteps);
    }
    return count;
  }

  /**
   * Collect all tool IDs from steps
   */
  _collectToolIds(steps) {
    const toolIds = new Set();
    for (const step of this._flattenSteps(steps)) {
      if (step.type === StepType.TOOL && step.toolId) {
        toolIds.add(step.toolId);
      }
    }
    return Array.from(toolIds);
  }

  /**
   * Flatten nested steps
   */
  _flattenSteps(steps) {
    const result = [];
    for (const step of steps) {
      result.push(step);
      if (step.thenSteps) result.push(...this._flattenSteps(step.thenSteps));
      if (step.elseSteps) result.push(...this._flattenSteps(step.elseSteps));
      if (step.loopSteps) result.push(...this._flattenSteps(step.loopSteps));
    }
    return result;
  }

  /**
   * Merge with another profile (more restrictive wins)
   */
  merge(other) {
    return new SafetyProfile({
      level: this._moreRestrictiveLevel(this.level, other.level),
      maxSteps: Math.min(this.maxSteps, other.maxSteps),
      maxDurationMs: Math.min(this.maxDurationMs, other.maxDurationMs),
      maxRetries: Math.min(this.maxRetries, other.maxRetries),
      maxLoopIterations: Math.min(this.maxLoopIterations, other.maxLoopIterations),
      allowedTools: this._intersectLists(this.allowedTools, other.allowedTools),
      blockedTools: [...new Set([...this.blockedTools, ...other.blockedTools])],
      requiresApproval: this.requiresApproval || other.requiresApproval,
      sandboxRequired: this.sandboxRequired || other.sandboxRequired,
      canModifyFiles: this.canModifyFiles && other.canModifyFiles,
      canExecuteCommands: this.canExecuteCommands && other.canExecuteCommands,
      canAccessNetwork: this.canAccessNetwork && other.canAccessNetwork,
      canAccessSecrets: this.canAccessSecrets && other.canAccessSecrets,
    });
  }

  _moreRestrictiveLevel(a, b) {
    const order = [SafetyLevel.SAFE, SafetyLevel.NORMAL, SafetyLevel.ELEVATED, SafetyLevel.DANGEROUS];
    return order[Math.max(order.indexOf(a), order.indexOf(b))];
  }

  _intersectLists(a, b) {
    if (a === null && b === null) return null;
    if (a === null) return b;
    if (b === null) return a;
    return a.filter(x => b.includes(x));
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      level: this.level,
      maxSteps: this.maxSteps,
      maxDurationMs: this.maxDurationMs,
      maxRetries: this.maxRetries,
      maxLoopIterations: this.maxLoopIterations,
      allowedTools: this.allowedTools,
      blockedTools: this.blockedTools,
      requiresApproval: this.requiresApproval,
      approvalReason: this.approvalReason,
      sandboxRequired: this.sandboxRequired,
      canModifyFiles: this.canModifyFiles,
      canExecuteCommands: this.canExecuteCommands,
      canAccessNetwork: this.canAccessNetwork,
      canAccessSecrets: this.canAccessSecrets,
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(json) {
    return new SafetyProfile(json);
  }

  /**
   * Create a safe (read-only) profile
   */
  static safe(overrides = {}) {
    return new SafetyProfile({
      level: SafetyLevel.SAFE,
      maxSteps: 10,
      maxDurationMs: 60000,
      canModifyFiles: false,
      canExecuteCommands: false,
      canAccessNetwork: false,
      ...overrides,
    });
  }

  /**
   * Create a normal profile
   */
  static normal(overrides = {}) {
    return new SafetyProfile({
      level: SafetyLevel.NORMAL,
      maxSteps: 20,
      maxDurationMs: 300000,
      canModifyFiles: true,
      canExecuteCommands: false,
      ...overrides,
    });
  }

  /**
   * Create a dangerous profile (requires approval)
   */
  static dangerous(overrides = {}) {
    return new SafetyProfile({
      level: SafetyLevel.DANGEROUS,
      maxSteps: 50,
      maxDurationMs: 600000,
      requiresApproval: true,
      canModifyFiles: true,
      canExecuteCommands: true,
      canAccessNetwork: true,
      ...overrides,
    });
  }
}

/**
 * Represents a single step in a skill
 */
export class SkillStep {
  constructor(config) {
    this.id = config.id;
    this.type = config.type || StepType.TOOL;
    this.name = config.name;
    this.description = config.description || '';

    // For TOOL steps
    this.toolId = config.toolId;
    this.toolParams = config.toolParams || {};

    // For SKILL steps (composition)
    this.skillId = config.skillId;
    this.skillParams = config.skillParams || {};

    // For CONDITION steps
    this.condition = config.condition;     // Function or expression
    this.thenSteps = config.thenSteps || [];
    this.elseSteps = config.elseSteps || [];

    // For LOOP steps
    this.loopOver = config.loopOver;       // Input array or generator
    this.loopSteps = config.loopSteps || [];
    this.maxIterations = config.maxIterations || 100;

    // For TRANSFORM steps
    this.transform = config.transform;     // Transform function

    // For VALIDATE steps
    this.validator = config.validator;     // Validation function
    this.errorMessage = config.errorMessage;

    // Common
    this.optional = config.optional || false;
    this.timeout = config.timeout;
    this.retries = config.retries || 0;
    this.onError = config.onError || 'fail'; // 'fail', 'skip', 'retry'
  }

  /**
   * Resolve parameters with context variables
   */
  resolveParams(context) {
    const params = this.type === StepType.SKILL ? this.skillParams : this.toolParams;
    const resolved = {};

    for (const [key, value] of Object.entries(params)) {
      resolved[key] = this._resolveValue(value, context);
    }

    return resolved;
  }

  _resolveValue(value, context) {
    if (typeof value === 'string' && value.startsWith('$')) {
      const path = value.slice(1).split('.');
      let result = context;
      for (const key of path) {
        result = result?.[key];
      }
      return result;
    }

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(v => this._resolveValue(v, context));
      }
      const resolved = {};
      for (const [k, v] of Object.entries(value)) {
        resolved[k] = this._resolveValue(v, context);
      }
      return resolved;
    }

    return value;
  }
}

/**
 * Represents a complete skill definition
 */
export class Skill {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || '';
    this.category = config.category || SkillCategory.CUSTOM;
    this.version = config.version || '1.0.0';
    this.status = config.status || SkillStatus.DRAFT;

    // Author and provenance
    this.author = config.author;
    this.source = config.source;         // Where skill came from
    this.createdAt = config.createdAt || Date.now();
    this.updatedAt = config.updatedAt || Date.now();

    // Input/output specification
    this.inputs = config.inputs || [];   // Array of { name, type, required, description, default }
    this.outputs = config.outputs || []; // Array of { name, type, description }

    // The actual steps
    this.steps = (config.steps || []).map(s =>
      s instanceof SkillStep ? s : new SkillStep(s)
    );

    // Preconditions and postconditions
    this.preconditions = config.preconditions || [];  // Checks before execution
    this.postconditions = config.postconditions || []; // Checks after execution

    // Metadata
    this.tags = config.tags || [];
    this.examples = config.examples || [];
    this.requiredTools = config.requiredTools || [];
    this.requiredSkills = config.requiredSkills || []; // Nested skill dependencies

    // Execution hints
    this.estimatedDuration = config.estimatedDuration; // In ms

    // SAFETY PROFILE (REQUIRED)
    // Every skill must have a SafetyProfile that defines execution bounds
    this.safetyProfile = this._initSafetyProfile(config);

    // Legacy compatibility (deprecated, use safetyProfile instead)
    this.safetyLevel = this.safetyProfile.level;
    this.sandboxRequired = this.safetyProfile.sandboxRequired;
  }

  /**
   * Initialize safety profile from config
   */
  _initSafetyProfile(config) {
    // If explicit SafetyProfile provided
    if (config.safetyProfile instanceof SafetyProfile) {
      return config.safetyProfile;
    }

    // If safety profile config provided
    if (config.safetyProfile && typeof config.safetyProfile === 'object') {
      return new SafetyProfile(config.safetyProfile);
    }

    // Legacy: infer from safetyLevel
    const level = config.safetyLevel || SafetyLevel.NORMAL;
    const sandboxRequired = config.sandboxRequired || false;

    switch (level) {
      case 'safe':
      case SafetyLevel.SAFE:
        return SafetyProfile.safe({ sandboxRequired });

      case 'dangerous':
      case SafetyLevel.DANGEROUS:
        return SafetyProfile.dangerous({ sandboxRequired });

      case 'elevated':
      case SafetyLevel.ELEVATED:
        return new SafetyProfile({
          level: SafetyLevel.ELEVATED,
          maxSteps: 30,
          requiresApproval: true,
          sandboxRequired,
          canModifyFiles: true,
          canExecuteCommands: true,
        });

      case 'normal':
      case SafetyLevel.NORMAL:
      default:
        return SafetyProfile.normal({ sandboxRequired });
    }
  }

  /**
   * Validate skill inputs against specification
   */
  validateInputs(inputs) {
    const errors = [];

    for (const spec of this.inputs) {
      const value = inputs[spec.name];

      if (spec.required && value === undefined) {
        if (spec.default === undefined) {
          errors.push(`Missing required input: ${spec.name}`);
        }
      }

      if (value !== undefined && spec.type !== SkillIOType.ANY) {
        const valid = this._validateType(value, spec.type);
        if (!valid) {
          errors.push(`Invalid type for ${spec.name}: expected ${spec.type}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  _validateType(value, type) {
    switch (type) {
      case SkillIOType.FILE:
        return typeof value === 'string';
      case SkillIOType.FILE_LIST:
        return Array.isArray(value) && value.every(v => typeof v === 'string');
      case SkillIOType.TEXT:
      case SkillIOType.CODE:
        return typeof value === 'string';
      case SkillIOType.JSON:
        return typeof value === 'object';
      case SkillIOType.BOOLEAN:
        return typeof value === 'boolean';
      case SkillIOType.NUMBER:
        return typeof value === 'number';
      default:
        return true;
    }
  }

  /**
   * Get all tool IDs used by this skill
   */
  getRequiredToolIds() {
    const toolIds = new Set(this.requiredTools);

    const collectFromSteps = (steps) => {
      for (const step of steps) {
        if (step.type === StepType.TOOL && step.toolId) {
          toolIds.add(step.toolId);
        }
        if (step.thenSteps) collectFromSteps(step.thenSteps);
        if (step.elseSteps) collectFromSteps(step.elseSteps);
        if (step.loopSteps) collectFromSteps(step.loopSteps);
      }
    };

    collectFromSteps(this.steps);
    return Array.from(toolIds);
  }

  /**
   * Get all nested skill IDs used by this skill
   */
  getRequiredSkillIds() {
    const skillIds = new Set(this.requiredSkills);

    const collectFromSteps = (steps) => {
      for (const step of steps) {
        if (step.type === StepType.SKILL && step.skillId) {
          skillIds.add(step.skillId);
        }
        if (step.thenSteps) collectFromSteps(step.thenSteps);
        if (step.elseSteps) collectFromSteps(step.elseSteps);
        if (step.loopSteps) collectFromSteps(step.loopSteps);
      }
    };

    collectFromSteps(this.steps);
    return Array.from(skillIds);
  }

  /**
   * Validate skill against its safety profile
   */
  validateSafety() {
    return this.safetyProfile.validateSteps(this.steps);
  }

  /**
   * Check if skill requires approval
   */
  requiresApproval() {
    return this.safetyProfile.requiresApproval;
  }

  /**
   * Get maximum allowed steps
   */
  getMaxSteps() {
    return this.safetyProfile.maxSteps;
  }

  /**
   * Get allowed tools
   */
  getAllowedTools() {
    return this.safetyProfile.allowedTools;
  }

  /**
   * Check if a specific tool is allowed
   */
  isToolAllowed(toolId) {
    return this.safetyProfile.isToolAllowed(toolId);
  }

  /**
   * Serialize skill to JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      category: this.category,
      version: this.version,
      status: this.status,
      author: this.author,
      source: this.source,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      inputs: this.inputs,
      outputs: this.outputs,
      steps: this.steps,
      preconditions: this.preconditions,
      postconditions: this.postconditions,
      tags: this.tags,
      examples: this.examples,
      requiredTools: this.requiredTools,
      requiredSkills: this.requiredSkills,
      estimatedDuration: this.estimatedDuration,
      // Safety profile (new)
      safetyProfile: this.safetyProfile.toJSON(),
      // Legacy (deprecated, kept for compatibility)
      safetyLevel: this.safetyLevel,
      sandboxRequired: this.sandboxRequired,
    };
  }

  /**
   * Create skill from JSON
   */
  static fromJSON(json) {
    return new Skill(json);
  }
}

/**
 * Registry for managing skills
 */
export class SkillRegistry {
  constructor() {
    this.skills = new Map();          // id -> Skill
    this.byCategory = new Map();      // category -> Set<id>
    this.byTag = new Map();           // tag -> Set<id>
    this.aliases = new Map();         // alias -> id
    this.listeners = [];
  }

  /**
   * Register a skill
   */
  register(skill) {
    if (!(skill instanceof Skill)) {
      skill = new Skill(skill);
    }

    const existing = this.skills.get(skill.id);
    if (existing) {
      // Version check for updates
      if (skill.version <= existing.version) {
        throw new Error(
          `Skill ${skill.id} version ${skill.version} is not newer than ${existing.version}`
        );
      }
    }

    this.skills.set(skill.id, skill);

    // Index by category
    if (!this.byCategory.has(skill.category)) {
      this.byCategory.set(skill.category, new Set());
    }
    this.byCategory.get(skill.category).add(skill.id);

    // Index by tags
    for (const tag of skill.tags) {
      if (!this.byTag.has(tag)) {
        this.byTag.set(tag, new Set());
      }
      this.byTag.get(tag).add(skill.id);
    }

    this._emit('registered', skill);
    return skill;
  }

  /**
   * Unregister a skill
   */
  unregister(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    this.skills.delete(skillId);

    // Remove from category index
    const categorySet = this.byCategory.get(skill.category);
    if (categorySet) {
      categorySet.delete(skillId);
    }

    // Remove from tag indices
    for (const tag of skill.tags) {
      const tagSet = this.byTag.get(tag);
      if (tagSet) {
        tagSet.delete(skillId);
      }
    }

    // Remove aliases
    for (const [alias, id] of this.aliases) {
      if (id === skillId) {
        this.aliases.delete(alias);
      }
    }

    this._emit('unregistered', skill);
    return true;
  }

  /**
   * Get a skill by ID or alias
   */
  get(skillIdOrAlias) {
    const id = this.aliases.get(skillIdOrAlias) || skillIdOrAlias;
    return this.skills.get(id);
  }

  /**
   * Check if skill exists
   */
  has(skillIdOrAlias) {
    const id = this.aliases.get(skillIdOrAlias) || skillIdOrAlias;
    return this.skills.has(id);
  }

  /**
   * Add an alias for a skill
   */
  addAlias(alias, skillId) {
    if (!this.skills.has(skillId)) {
      throw new Error(`Skill ${skillId} not found`);
    }
    this.aliases.set(alias, skillId);
  }

  /**
   * Find skills by category
   */
  findByCategory(category) {
    const ids = this.byCategory.get(category) || new Set();
    return Array.from(ids).map(id => this.skills.get(id));
  }

  /**
   * Find skills by tag
   */
  findByTag(tag) {
    const ids = this.byTag.get(tag) || new Set();
    return Array.from(ids).map(id => this.skills.get(id));
  }

  /**
   * Find skills by multiple tags (AND)
   */
  findByTags(tags) {
    if (tags.length === 0) return [];

    let resultIds = null;
    for (const tag of tags) {
      const tagIds = this.byTag.get(tag) || new Set();
      if (resultIds === null) {
        resultIds = new Set(tagIds);
      } else {
        resultIds = new Set([...resultIds].filter(id => tagIds.has(id)));
      }
    }

    return Array.from(resultIds || []).map(id => this.skills.get(id));
  }

  /**
   * Search skills by text query
   */
  search(query, options = {}) {
    const {
      category = null,
      status = null,
      tags = [],
      limit = 20,
    } = options;

    const queryLower = query.toLowerCase();
    const results = [];

    for (const skill of this.skills.values()) {
      // Filter by category
      if (category && skill.category !== category) continue;

      // Filter by status
      if (status && skill.status !== status) continue;

      // Filter by tags
      if (tags.length > 0 && !tags.every(t => skill.tags.includes(t))) continue;

      // Score by relevance
      let score = 0;

      if (skill.name.toLowerCase().includes(queryLower)) {
        score += 10;
      }
      if (skill.id.toLowerCase().includes(queryLower)) {
        score += 8;
      }
      if (skill.description.toLowerCase().includes(queryLower)) {
        score += 5;
      }
      if (skill.tags.some(t => t.toLowerCase().includes(queryLower))) {
        score += 3;
      }

      if (score > 0) {
        results.push({ skill, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.skill);
  }

  /**
   * Get all skills
   */
  getAll() {
    return Array.from(this.skills.values());
  }

  /**
   * Get verified skills only
   */
  getVerified() {
    return this.getAll().filter(s => s.status === SkillStatus.VERIFIED);
  }

  /**
   * Validate skill dependencies
   */
  validateDependencies(skill) {
    const errors = [];

    // Check nested skill dependencies
    for (const depId of skill.getRequiredSkillIds()) {
      if (!this.has(depId)) {
        errors.push(`Missing skill dependency: ${depId}`);
      }
    }

    // Check for circular dependencies
    const visited = new Set();
    const checkCircular = (id, path) => {
      if (path.includes(id)) {
        errors.push(`Circular dependency: ${path.join(' -> ')} -> ${id}`);
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);

      const s = this.get(id);
      if (s) {
        for (const depId of s.getRequiredSkillIds()) {
          checkCircular(depId, [...path, id]);
        }
      }
    };

    checkCircular(skill.id, []);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Subscribe to registry events
   */
  on(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  _emit(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        console.error('SkillRegistry listener error:', e);
      }
    }
  }

  /**
   * Export all skills to JSON
   */
  export() {
    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      skills: this.getAll().map(s => s.toJSON()),
      aliases: Object.fromEntries(this.aliases),
    };
  }

  /**
   * Import skills from JSON
   */
  import(data, options = {}) {
    const { overwrite = false } = options;

    let imported = 0;
    let skipped = 0;

    for (const skillData of data.skills || []) {
      if (!overwrite && this.has(skillData.id)) {
        skipped++;
        continue;
      }

      this.register(Skill.fromJSON(skillData));
      imported++;
    }

    // Import aliases
    for (const [alias, id] of Object.entries(data.aliases || {})) {
      if (this.has(id)) {
        this.aliases.set(alias, id);
      }
    }

    return { imported, skipped };
  }

  /**
   * Clear all skills
   */
  clear() {
    this.skills.clear();
    this.byCategory.clear();
    this.byTag.clear();
    this.aliases.clear();
  }
}

// Singleton instance
export const skillRegistry = new SkillRegistry();

/**
 * Helper to create a skill
 */
export function createSkill(config) {
  const skill = new Skill(config);
  skillRegistry.register(skill);
  return skill;
}

// Register some built-in skills
const builtInSkills = [
  {
    id: 'skill:analyze-file',
    name: 'Analyze File',
    description: 'Read and analyze a file, extracting key information',
    category: SkillCategory.ANALYSIS,
    status: SkillStatus.VERIFIED,
    author: 'system',
    inputs: [
      { name: 'file', type: SkillIOType.FILE, required: true, description: 'File to analyze' },
      { name: 'focus', type: SkillIOType.TEXT, required: false, description: 'What to focus on' },
    ],
    outputs: [
      { name: 'analysis', type: SkillIOType.JSON, description: 'Analysis results' },
    ],
    steps: [
      { id: 'read', type: StepType.TOOL, name: 'Read file', toolId: 'read_file', toolParams: { path: '$input.file' } },
      { id: 'analyze', type: StepType.TOOL, name: 'Analyze content', toolId: 'llm_analyze', toolParams: { content: '$steps.read.content', focus: '$input.focus' } },
    ],
    tags: ['analysis', 'file', 'built-in'],
    // SAFETY PROFILE: Read-only analysis
    safetyProfile: {
      level: SafetyLevel.SAFE,
      maxSteps: 5,
      maxDurationMs: 60000,
      allowedTools: ['read_file', 'llm_analyze'],
      requiresApproval: false,
      canModifyFiles: false,
      canExecuteCommands: false,
      canAccessNetwork: false,
    },
  },
  {
    id: 'skill:refactor-function',
    name: 'Refactor Function',
    description: 'Refactor a function according to specified goals',
    category: SkillCategory.REFACTORING,
    status: SkillStatus.VERIFIED,
    author: 'system',
    inputs: [
      { name: 'file', type: SkillIOType.FILE, required: true, description: 'File containing the function' },
      { name: 'functionName', type: SkillIOType.TEXT, required: true, description: 'Name of function to refactor' },
      { name: 'goal', type: SkillIOType.TEXT, required: true, description: 'Refactoring goal' },
    ],
    outputs: [
      { name: 'changes', type: SkillIOType.JSON, description: 'Changes made' },
    ],
    steps: [
      { id: 'read', type: StepType.TOOL, name: 'Read file', toolId: 'read_file', toolParams: { path: '$input.file' } },
      { id: 'find', type: StepType.TOOL, name: 'Find function', toolId: 'find_function', toolParams: { content: '$steps.read.content', name: '$input.functionName' } },
      { id: 'plan', type: StepType.TOOL, name: 'Plan refactoring', toolId: 'llm_plan', toolParams: { function: '$steps.find.function', goal: '$input.goal' } },
      { id: 'apply', type: StepType.TOOL, name: 'Apply changes', toolId: 'edit_file', toolParams: { path: '$input.file', edits: '$steps.plan.edits' } },
      { id: 'validate', type: StepType.VALIDATE, name: 'Validate syntax', validator: 'syntax_check', errorMessage: 'Refactoring produced invalid syntax' },
    ],
    tags: ['refactoring', 'function', 'built-in'],
    // SAFETY PROFILE: File modification allowed
    safetyProfile: {
      level: SafetyLevel.NORMAL,
      maxSteps: 10,
      maxDurationMs: 120000,
      allowedTools: ['read_file', 'find_function', 'llm_plan', 'edit_file'],
      requiresApproval: false,
      canModifyFiles: true,
      canExecuteCommands: false,
      canAccessNetwork: false,
    },
  },
  {
    id: 'skill:add-tests',
    name: 'Add Tests',
    description: 'Generate and add tests for specified code',
    category: SkillCategory.TESTING,
    status: SkillStatus.VERIFIED,
    author: 'system',
    inputs: [
      { name: 'file', type: SkillIOType.FILE, required: true, description: 'File to test' },
      { name: 'testFile', type: SkillIOType.FILE, required: false, description: 'Where to write tests' },
      { name: 'framework', type: SkillIOType.TEXT, required: false, default: 'jest', description: 'Test framework' },
    ],
    outputs: [
      { name: 'testFile', type: SkillIOType.FILE, description: 'Created test file' },
      { name: 'testCount', type: SkillIOType.NUMBER, description: 'Number of tests added' },
    ],
    steps: [
      { id: 'read', type: StepType.TOOL, name: 'Read source', toolId: 'read_file', toolParams: { path: '$input.file' } },
      { id: 'analyze', type: StepType.TOOL, name: 'Analyze for testing', toolId: 'llm_analyze', toolParams: { content: '$steps.read.content', focus: 'testable units' } },
      { id: 'generate', type: StepType.TOOL, name: 'Generate tests', toolId: 'llm_generate', toolParams: { analysis: '$steps.analyze.result', framework: '$input.framework' } },
      { id: 'write', type: StepType.TOOL, name: 'Write tests', toolId: 'write_file', toolParams: { path: '$input.testFile', content: '$steps.generate.tests' } },
    ],
    tags: ['testing', 'generation', 'built-in'],
    // SAFETY PROFILE: File creation allowed
    safetyProfile: {
      level: SafetyLevel.NORMAL,
      maxSteps: 10,
      maxDurationMs: 180000,
      allowedTools: ['read_file', 'llm_analyze', 'llm_generate', 'write_file'],
      requiresApproval: false,
      canModifyFiles: true,
      canExecuteCommands: false,
      canAccessNetwork: false,
    },
  },
];

// Register built-in skills
for (const skillConfig of builtInSkills) {
  skillRegistry.register(new Skill(skillConfig));
}
