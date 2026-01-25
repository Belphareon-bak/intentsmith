// CRE v41.1: Project Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// ProjectContext maintains knowledge about the current project:
// - Conventions, stack, coding style
// - Learned patterns and preferences
// - Historical context from past interactions
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Project stack categories
 */
export const StackCategory = {
  LANGUAGE: 'language',
  FRAMEWORK: 'framework',
  RUNTIME: 'runtime',
  DATABASE: 'database',
  TESTING: 'testing',
  BUILD: 'build',
  DEPLOYMENT: 'deployment',
  OTHER: 'other',
};

/**
 * Convention types
 */
export const ConventionType = {
  NAMING: 'naming',           // Naming conventions (camelCase, PascalCase, etc.)
  FILE_STRUCTURE: 'file_structure', // Directory organization
  CODE_STYLE: 'code_style',   // Formatting, indentation, etc.
  PATTERNS: 'patterns',       // Design patterns used
  TESTING: 'testing',         // Test naming, structure
  DOCUMENTATION: 'documentation', // Doc style, comments
  GIT: 'git',                 // Commit messages, branching
  CUSTOM: 'custom',
};

/**
 * Memory entry types
 */
export const MemoryType = {
  FACT: 'fact',               // Objective facts about the project
  PREFERENCE: 'preference',   // User preferences
  PATTERN: 'pattern',         // Observed patterns
  DECISION: 'decision',       // Past decisions and rationale
  WARNING: 'warning',         // Things to avoid
  TIP: 'tip',                 // Helpful hints
};

/**
 * Memory confidence levels
 */
export const Confidence = {
  CERTAIN: 1.0,      // Explicitly stated
  HIGH: 0.8,         // Strongly inferred
  MEDIUM: 0.5,       // Reasonably inferred
  LOW: 0.3,          // Weakly inferred
  GUESS: 0.1,        // Best guess
};

/**
 * Memory source types (REQUIRED for every entry)
 *
 * IMPORTANT: Every MemoryEntry MUST have a source.
 * This enables provenance tracking and trust evaluation.
 */
export const MemorySource = {
  USER: 'user',             // Explicitly stated by user
  INFERRED: 'inferred',     // Inferred from context/code
  DETECTED: 'detected',     // Auto-detected by analysis
  IMPORTED: 'imported',     // Imported from external source
  SYSTEM: 'system',         // System-generated
};

/**
 * Stack item representing a technology
 */
export class StackItem {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.category = config.category || StackCategory.OTHER;
    this.version = config.version;
    this.confidence = config.confidence || Confidence.HIGH;
    this.detectedFrom = config.detectedFrom; // How was this detected
    this.config = config.config || {};       // Associated configuration
    this.metadata = config.metadata || {};
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      version: this.version,
      confidence: this.confidence,
      detectedFrom: this.detectedFrom,
      config: this.config,
      metadata: this.metadata,
    };
  }
}

/**
 * Convention definition
 */
export class Convention {
  constructor(config) {
    this.id = config.id;
    this.type = config.type || ConventionType.CUSTOM;
    this.name = config.name;
    this.description = config.description || '';
    this.pattern = config.pattern;           // Regex or example
    this.examples = config.examples || [];   // Good examples
    this.antiExamples = config.antiExamples || []; // Bad examples
    this.confidence = config.confidence || Confidence.HIGH;
    this.source = config.source;             // Where learned from
    this.appliesTo = config.appliesTo || []; // File patterns this applies to
  }

  /**
   * Check if a value follows this convention
   */
  check(value) {
    if (this.pattern instanceof RegExp) {
      return this.pattern.test(value);
    }
    if (typeof this.pattern === 'function') {
      return this.pattern(value);
    }
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      description: this.description,
      pattern: this.pattern instanceof RegExp ? this.pattern.source : this.pattern,
      examples: this.examples,
      antiExamples: this.antiExamples,
      confidence: this.confidence,
      source: this.source,
      appliesTo: this.appliesTo,
    };
  }
}

/**
 * Memory entry
 *
 * IMPORTANT: Every entry MUST have:
 *   - type (MemoryType): What kind of memory (fact, decision, etc.)
 *   - confidence (Confidence): How sure we are (certain, high, medium, etc.)
 *   - source (MemorySource): Where it came from (user, inferred, detected, etc.)
 *
 * These fields are MANDATORY for provenance tracking and trust evaluation.
 */
export class MemoryEntry {
  constructor(config) {
    // REQUIRED FIELDS (must be provided)
    // type: What kind of memory this is
    if (!config.type) {
      throw new Error('MemoryEntry requires type (MemoryType.FACT, DECISION, etc.)');
    }
    if (!Object.values(MemoryType).includes(config.type)) {
      throw new Error(`Invalid MemoryEntry type: ${config.type}`);
    }
    this.type = config.type;

    // confidence: How sure we are about this memory
    if (config.confidence === undefined || config.confidence === null) {
      throw new Error('MemoryEntry requires confidence (Confidence.CERTAIN, HIGH, etc.)');
    }
    if (typeof config.confidence !== 'number' || config.confidence < 0 || config.confidence > 1) {
      throw new Error(`Invalid MemoryEntry confidence: ${config.confidence}`);
    }
    this.confidence = config.confidence;

    // source: Where this memory came from
    if (!config.source) {
      throw new Error('MemoryEntry requires source (MemorySource.USER, INFERRED, etc.)');
    }
    if (!Object.values(MemorySource).includes(config.source)) {
      throw new Error(`Invalid MemoryEntry source: ${config.source}`);
    }
    this.source = config.source;

    // content: The actual memory content (required)
    if (!config.content) {
      throw new Error('MemoryEntry requires content');
    }
    this.content = config.content;

    // Other fields
    this.id = config.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.context = config.context || '';     // Additional context
    this.tags = config.tags || [];
    this.createdAt = config.createdAt || Date.now();
    this.updatedAt = config.updatedAt || Date.now();
    this.accessCount = config.accessCount || 0;
    this.lastAccessedAt = config.lastAccessedAt || null;
    this.expiresAt = config.expiresAt || null;
    this.supersededBy = config.supersededBy || null;
  }

  /**
   * Validate entry (static method for pre-validation)
   */
  static validate(config) {
    const errors = [];

    if (!config.type) {
      errors.push('Missing required field: type');
    } else if (!Object.values(MemoryType).includes(config.type)) {
      errors.push(`Invalid type: ${config.type}`);
    }

    if (config.confidence === undefined || config.confidence === null) {
      errors.push('Missing required field: confidence');
    } else if (typeof config.confidence !== 'number' || config.confidence < 0 || config.confidence > 1) {
      errors.push(`Invalid confidence: ${config.confidence}`);
    }

    if (!config.source) {
      errors.push('Missing required field: source');
    } else if (!Object.values(MemorySource).includes(config.source)) {
      errors.push(`Invalid source: ${config.source}`);
    }

    if (!config.content) {
      errors.push('Missing required field: content');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Mark as accessed
   */
  markAccessed() {
    this.accessCount++;
    this.lastAccessedAt = Date.now();
  }

  /**
   * Check if expired
   */
  isExpired() {
    if (!this.expiresAt) return false;
    return Date.now() > this.expiresAt;
  }

  /**
   * Check if superseded
   */
  isSuperseded() {
    return this.supersededBy !== null;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      content: this.content,
      context: this.context,
      confidence: this.confidence,
      source: this.source,
      tags: this.tags,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      accessCount: this.accessCount,
      lastAccessedAt: this.lastAccessedAt,
      expiresAt: this.expiresAt,
      supersededBy: this.supersededBy,
    };
  }
}

/**
 * Project context - captures everything known about a project
 */
export class ProjectContext {
  constructor(config = {}) {
    this.projectId = config.projectId || 'default';
    this.projectRoot = config.projectRoot || process.cwd();
    this.name = config.name || '';
    this.description = config.description || '';

    // Stack detection
    this.stack = new Map();  // id -> StackItem

    // Conventions
    this.conventions = new Map();  // id -> Convention

    // Code style
    this.codeStyle = {
      indentation: config.codeStyle?.indentation || 'spaces',
      indentSize: config.codeStyle?.indentSize || 2,
      quotes: config.codeStyle?.quotes || 'single',
      semicolons: config.codeStyle?.semicolons || true,
      trailingComma: config.codeStyle?.trailingComma || 'es5',
      lineWidth: config.codeStyle?.lineWidth || 100,
      endOfLine: config.codeStyle?.endOfLine || 'lf',
    };

    // Paths
    this.paths = {
      source: config.paths?.source || ['src'],
      tests: config.paths?.tests || ['tests', 'test', '__tests__'],
      docs: config.paths?.docs || ['docs'],
      config: config.paths?.config || ['.'],
    };

    // Metadata
    this.createdAt = config.createdAt || Date.now();
    this.updatedAt = config.updatedAt || Date.now();
    this.version = config.version || 1;
  }

  /**
   * Add stack item
   */
  addStackItem(item) {
    if (!(item instanceof StackItem)) {
      item = new StackItem(item);
    }
    this.stack.set(item.id, item);
    this.updatedAt = Date.now();
  }

  /**
   * Get stack by category
   */
  getStackByCategory(category) {
    return Array.from(this.stack.values()).filter(s => s.category === category);
  }

  /**
   * Get full stack
   */
  getStack() {
    return Array.from(this.stack.values());
  }

  /**
   * Add convention
   */
  addConvention(convention) {
    if (!(convention instanceof Convention)) {
      convention = new Convention(convention);
    }
    this.conventions.set(convention.id, convention);
    this.updatedAt = Date.now();
  }

  /**
   * Get conventions by type
   */
  getConventionsByType(type) {
    return Array.from(this.conventions.values()).filter(c => c.type === type);
  }

  /**
   * Get all conventions
   */
  getConventions() {
    return Array.from(this.conventions.values());
  }

  /**
   * Check if project uses a technology
   */
  uses(technologyId) {
    return this.stack.has(technologyId);
  }

  /**
   * Get primary language
   */
  getPrimaryLanguage() {
    const languages = this.getStackByCategory(StackCategory.LANGUAGE);
    return languages.sort((a, b) => b.confidence - a.confidence)[0];
  }

  /**
   * Get primary framework
   */
  getPrimaryFramework() {
    const frameworks = this.getStackByCategory(StackCategory.FRAMEWORK);
    return frameworks.sort((a, b) => b.confidence - a.confidence)[0];
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      projectId: this.projectId,
      projectRoot: this.projectRoot,
      name: this.name,
      description: this.description,
      stack: Array.from(this.stack.values()).map(s => s.toJSON()),
      conventions: Array.from(this.conventions.values()).map(c => c.toJSON()),
      codeStyle: this.codeStyle,
      paths: this.paths,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      version: this.version,
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(json) {
    const context = new ProjectContext(json);

    for (const stackData of json.stack || []) {
      context.stack.set(stackData.id, new StackItem(stackData));
    }

    for (const convData of json.conventions || []) {
      context.conventions.set(convData.id, new Convention(convData));
    }

    return context;
  }
}

/**
 * Project memory - long-term storage and retrieval
 */
export class ProjectMemory {
  constructor(options = {}) {
    this.projectId = options.projectId || 'default';
    this.entries = new Map();  // id -> MemoryEntry
    this.byType = new Map();   // type -> Set<id>
    this.byTag = new Map();    // tag -> Set<id>
    this.context = options.context || new ProjectContext({ projectId: this.projectId });

    // Persistence
    this.store = options.store || null;
    this.autoSave = options.autoSave !== false;
    this.dirty = false;

    // Index for search
    this.searchIndex = new Map();  // word -> Set<id>

    // Initialize indices
    this._initIndices();
  }

  _initIndices() {
    for (const type of Object.values(MemoryType)) {
      this.byType.set(type, new Set());
    }
  }

  /**
   * Add a memory entry
   */
  add(entry) {
    if (!(entry instanceof MemoryEntry)) {
      entry = new MemoryEntry(entry);
    }

    this.entries.set(entry.id, entry);

    // Index by type
    this.byType.get(entry.type)?.add(entry.id);

    // Index by tags
    for (const tag of entry.tags) {
      if (!this.byTag.has(tag)) {
        this.byTag.set(tag, new Set());
      }
      this.byTag.get(tag).add(entry.id);
    }

    // Index for search
    this._indexForSearch(entry);

    this.dirty = true;
    if (this.autoSave && this.store) {
      this._scheduleSave();
    }

    return entry;
  }

  /**
   * Update a memory entry
   */
  update(id, updates) {
    const entry = this.entries.get(id);
    if (!entry) return null;

    // Remove old tags from index
    for (const tag of entry.tags) {
      this.byTag.get(tag)?.delete(id);
    }

    // Apply updates
    Object.assign(entry, updates, { updatedAt: Date.now() });

    // Re-index tags
    for (const tag of entry.tags) {
      if (!this.byTag.has(tag)) {
        this.byTag.set(tag, new Set());
      }
      this.byTag.get(tag).add(id);
    }

    // Re-index for search
    this._indexForSearch(entry);

    this.dirty = true;
    return entry;
  }

  /**
   * Remove a memory entry
   */
  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.delete(id);
    this.byType.get(entry.type)?.delete(id);

    for (const tag of entry.tags) {
      this.byTag.get(tag)?.delete(id);
    }

    this.dirty = true;
    return true;
  }

  /**
   * Get entry by ID
   */
  get(id, markAccessed = true) {
    const entry = this.entries.get(id);
    if (entry && markAccessed) {
      entry.markAccessed();
    }
    return entry;
  }

  /**
   * Get entries by type
   */
  getByType(type) {
    const ids = this.byType.get(type) || new Set();
    return Array.from(ids)
      .map(id => this.entries.get(id))
      .filter(e => e && !e.isExpired() && !e.isSuperseded());
  }

  /**
   * Get entries by tag
   */
  getByTag(tag) {
    const ids = this.byTag.get(tag) || new Set();
    return Array.from(ids)
      .map(id => this.entries.get(id))
      .filter(e => e && !e.isExpired() && !e.isSuperseded());
  }

  /**
   * Get entries by multiple tags (AND)
   */
  getByTags(tags) {
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

    return Array.from(resultIds || [])
      .map(id => this.entries.get(id))
      .filter(e => e && !e.isExpired() && !e.isSuperseded());
  }

  /**
   * Search memories
   */
  search(query, options = {}) {
    const {
      type = null,
      tags = [],
      minConfidence = 0,
      limit = 20,
      includeExpired = false,
      includeSuperseded = false,
    } = options;

    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scores = new Map();

    // Score by search index
    for (const word of words) {
      const ids = this.searchIndex.get(word) || new Set();
      for (const id of ids) {
        scores.set(id, (scores.get(id) || 0) + 1);
      }
    }

    // Filter and sort results
    let results = Array.from(scores.entries())
      .map(([id, score]) => ({ entry: this.entries.get(id), score }))
      .filter(({ entry }) => {
        if (!entry) return false;
        if (!includeExpired && entry.isExpired()) return false;
        if (!includeSuperseded && entry.isSuperseded()) return false;
        if (type && entry.type !== type) return false;
        if (entry.confidence < minConfidence) return false;
        if (tags.length > 0 && !tags.every(t => entry.tags.includes(t))) return false;
        return true;
      });

    // Boost by confidence and recency
    results = results.map(({ entry, score }) => ({
      entry,
      score: score * entry.confidence * this._recencyBoost(entry),
    }));

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit).map(r => r.entry);
  }

  _recencyBoost(entry) {
    const age = Date.now() - entry.updatedAt;
    const dayInMs = 24 * 60 * 60 * 1000;
    if (age < dayInMs) return 1.2;
    if (age < 7 * dayInMs) return 1.1;
    if (age < 30 * dayInMs) return 1.0;
    return 0.9;
  }

  _indexForSearch(entry) {
    const words = new Set();

    // Extract words from content
    const contentWords = entry.content.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    for (const word of contentWords) {
      words.add(word);
    }

    // Add tags
    for (const tag of entry.tags) {
      words.add(tag.toLowerCase());
    }

    // Index
    for (const word of words) {
      if (!this.searchIndex.has(word)) {
        this.searchIndex.set(word, new Set());
      }
      this.searchIndex.get(word).add(entry.id);
    }
  }

  /**
   * Remember a fact
   *
   * @param {string} content - The fact content
   * @param {Object} options - Options (source, confidence, tags, etc.)
   * @param {string} options.source - REQUIRED: Where this fact came from (MemorySource.*)
   * @param {number} [options.confidence=Confidence.HIGH] - How confident we are
   */
  rememberFact(content, options = {}) {
    if (!options.source) {
      throw new Error('rememberFact requires options.source (MemorySource.USER, INFERRED, etc.)');
    }
    return this.add({
      type: MemoryType.FACT,
      content,
      confidence: options.confidence ?? Confidence.HIGH,
      ...options,
    });
  }

  /**
   * Remember a preference
   *
   * @param {string} content - The preference content
   * @param {Object} options - Options (source, confidence, tags, etc.)
   * @param {string} options.source - REQUIRED: Where this preference came from
   */
  rememberPreference(content, options = {}) {
    if (!options.source) {
      throw new Error('rememberPreference requires options.source (MemorySource.USER, INFERRED, etc.)');
    }
    return this.add({
      type: MemoryType.PREFERENCE,
      content,
      confidence: options.confidence ?? Confidence.HIGH,
      ...options,
    });
  }

  /**
   * Remember a pattern
   *
   * @param {string} content - The pattern content
   * @param {Object} options - Options (source, confidence, tags, etc.)
   * @param {string} options.source - REQUIRED: Where this pattern came from
   */
  rememberPattern(content, options = {}) {
    if (!options.source) {
      throw new Error('rememberPattern requires options.source (MemorySource.USER, INFERRED, etc.)');
    }
    return this.add({
      type: MemoryType.PATTERN,
      content,
      confidence: options.confidence ?? Confidence.MEDIUM,
      ...options,
    });
  }

  /**
   * Remember a decision
   *
   * @param {string} content - The decision content
   * @param {Object} options - Options (source, confidence, tags, etc.)
   * @param {string} options.source - REQUIRED: Where this decision came from
   */
  rememberDecision(content, options = {}) {
    if (!options.source) {
      throw new Error('rememberDecision requires options.source (MemorySource.USER, INFERRED, etc.)');
    }
    return this.add({
      type: MemoryType.DECISION,
      content,
      confidence: options.confidence ?? Confidence.CERTAIN,
      ...options,
    });
  }

  /**
   * Remember a warning
   *
   * @param {string} content - The warning content
   * @param {Object} options - Options (source, confidence, tags, etc.)
   * @param {string} options.source - REQUIRED: Where this warning came from
   */
  rememberWarning(content, options = {}) {
    if (!options.source) {
      throw new Error('rememberWarning requires options.source (MemorySource.USER, INFERRED, etc.)');
    }
    return this.add({
      type: MemoryType.WARNING,
      content,
      confidence: options.confidence ?? Confidence.HIGH,
      ...options,
    });
  }

  /**
   * Get relevant memories for a context
   */
  getRelevant(context, options = {}) {
    const { limit = 10, types = null } = options;

    // Search with context
    let results = this.search(context, { limit: limit * 2 });

    // Filter by types if specified
    if (types) {
      results = results.filter(e => types.includes(e.type));
    }

    return results.slice(0, limit);
  }

  /**
   * Get warnings for a topic
   */
  getWarnings(topic) {
    return this.search(topic, { type: MemoryType.WARNING });
  }

  /**
   * Supersede an entry with a new one
   */
  supersede(oldId, newEntry) {
    const oldEntry = this.entries.get(oldId);
    if (oldEntry) {
      newEntry.supersededBy = null;
      const added = this.add(newEntry);
      oldEntry.supersededBy = added.id;
      return added;
    }
    return this.add(newEntry);
  }

  /**
   * Clean up expired and superseded entries
   */
  cleanup(options = {}) {
    const { removeExpired = true, removeSuperseded = false, olderThan = null } = options;

    let removed = 0;

    for (const [id, entry] of this.entries) {
      let shouldRemove = false;

      if (removeExpired && entry.isExpired()) {
        shouldRemove = true;
      }

      if (removeSuperseded && entry.isSuperseded()) {
        shouldRemove = true;
      }

      if (olderThan && entry.updatedAt < olderThan) {
        shouldRemove = true;
      }

      if (shouldRemove) {
        this.remove(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get memory statistics
   */
  getStats() {
    const stats = {
      total: this.entries.size,
      byType: {},
      expired: 0,
      superseded: 0,
      averageConfidence: 0,
      averageAge: 0,
    };

    let totalConfidence = 0;
    let totalAge = 0;
    const now = Date.now();

    for (const entry of this.entries.values()) {
      // By type
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;

      // Expired
      if (entry.isExpired()) stats.expired++;

      // Superseded
      if (entry.isSuperseded()) stats.superseded++;

      // Averages
      totalConfidence += entry.confidence;
      totalAge += now - entry.createdAt;
    }

    if (stats.total > 0) {
      stats.averageConfidence = totalConfidence / stats.total;
      stats.averageAge = totalAge / stats.total;
    }

    return stats;
  }

  /**
   * Export all data
   */
  export() {
    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      projectId: this.projectId,
      context: this.context.toJSON(),
      entries: Array.from(this.entries.values()).map(e => e.toJSON()),
    };
  }

  /**
   * Import data
   */
  import(data, options = {}) {
    const { merge = true, overwrite = false } = options;

    if (!merge) {
      this.entries.clear();
      this._initIndices();
    }

    // Import context
    if (data.context) {
      if (merge) {
        // Merge stack and conventions
        const importedContext = ProjectContext.fromJSON(data.context);
        for (const item of importedContext.getStack()) {
          this.context.addStackItem(item);
        }
        for (const conv of importedContext.getConventions()) {
          this.context.addConvention(conv);
        }
      } else {
        this.context = ProjectContext.fromJSON(data.context);
      }
    }

    // Import entries
    let imported = 0;
    let skipped = 0;

    for (const entryData of data.entries || []) {
      if (!overwrite && this.entries.has(entryData.id)) {
        skipped++;
        continue;
      }

      this.add(new MemoryEntry(entryData));
      imported++;
    }

    this.dirty = false;
    return { imported, skipped };
  }

  /**
   * Schedule auto-save
   */
  _scheduleSave() {
    if (this._saveTimeout) return;

    this._saveTimeout = setTimeout(async () => {
      this._saveTimeout = null;
      if (this.dirty && this.store) {
        await this.save();
      }
    }, 5000);
  }

  /**
   * Save to store
   */
  async save() {
    if (!this.store) return false;

    try {
      const data = this.export();
      await this.store.save(this.projectId, data);
      this.dirty = false;
      return true;
    } catch (error) {
      console.error('Failed to save project memory:', error);
      return false;
    }
  }

  /**
   * Load from store
   */
  async load() {
    if (!this.store) return false;

    try {
      const data = await this.store.load(this.projectId);
      if (data) {
        this.import(data, { merge: false });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to load project memory:', error);
      return false;
    }
  }
}

// Singleton instances
export const projectContext = new ProjectContext();
export const projectMemory = new ProjectMemory({ context: projectContext });

/**
 * Helper to detect stack from project files
 */
export async function detectStack(projectRoot, fileReader) {
  const context = new ProjectContext({ projectRoot });
  const detectors = [
    {
      files: ['package.json'],
      detect: async (content) => {
        const pkg = JSON.parse(content);
        const items = [];

        // Node.js
        items.push({
          id: 'nodejs',
          name: 'Node.js',
          category: StackCategory.RUNTIME,
          version: pkg.engines?.node,
          confidence: Confidence.CERTAIN,
          detectedFrom: 'package.json',
        });

        // Dependencies
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.react) {
          items.push({
            id: 'react',
            name: 'React',
            category: StackCategory.FRAMEWORK,
            version: deps.react,
            confidence: Confidence.CERTAIN,
            detectedFrom: 'package.json',
          });
        }

        if (deps.vue) {
          items.push({
            id: 'vue',
            name: 'Vue.js',
            category: StackCategory.FRAMEWORK,
            version: deps.vue,
            confidence: Confidence.CERTAIN,
            detectedFrom: 'package.json',
          });
        }

        if (deps.jest) {
          items.push({
            id: 'jest',
            name: 'Jest',
            category: StackCategory.TESTING,
            version: deps.jest,
            confidence: Confidence.CERTAIN,
            detectedFrom: 'package.json',
          });
        }

        if (deps.typescript) {
          items.push({
            id: 'typescript',
            name: 'TypeScript',
            category: StackCategory.LANGUAGE,
            version: deps.typescript,
            confidence: Confidence.CERTAIN,
            detectedFrom: 'package.json',
          });
        }

        return items;
      },
    },
    {
      files: ['requirements.txt', 'pyproject.toml', 'setup.py'],
      detect: async () => [{
        id: 'python',
        name: 'Python',
        category: StackCategory.LANGUAGE,
        confidence: Confidence.HIGH,
        detectedFrom: 'python files',
      }],
    },
    {
      files: ['go.mod'],
      detect: async (content) => {
        const match = content.match(/^module\s+(\S+)/m);
        return [{
          id: 'go',
          name: 'Go',
          category: StackCategory.LANGUAGE,
          confidence: Confidence.CERTAIN,
          detectedFrom: 'go.mod',
          metadata: { module: match?.[1] },
        }];
      },
    },
    {
      files: ['Cargo.toml'],
      detect: async () => [{
        id: 'rust',
        name: 'Rust',
        category: StackCategory.LANGUAGE,
        confidence: Confidence.CERTAIN,
        detectedFrom: 'Cargo.toml',
      }],
    },
  ];

  for (const detector of detectors) {
    for (const file of detector.files) {
      try {
        const content = await fileReader(`${projectRoot}/${file}`);
        if (content) {
          const items = await detector.detect(content);
          for (const item of items) {
            context.addStackItem(item);
          }
          break;
        }
      } catch {
        // File not found, continue
      }
    }
  }

  return context;
}
