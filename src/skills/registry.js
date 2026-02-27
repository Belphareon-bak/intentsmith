// Skill Registry — loads and validates skill definitions from JSON files
// ══════════════════════════════════════════════════════════════════════════════
//
// Singleton registry: load skill/*.json at startup, provide lookup by ID.
// Graceful empty load — missing directory = empty registry, no crash.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const VALID_STEP_TYPES = new Set(['llm', 'template', 'write', 'shell', 'ask', 'review', 'validate']);

class SkillRegistry {
  constructor() {
    this._skills = new Map();
    this._logger = null;
    this._basePath = null;
  }

  /**
   * Load all *.json skill definitions from the given directory.
   * Graceful: missing dir = empty registry + warning.
   */
  load(basePath, logger) {
    this._logger = logger || null;
    this._basePath = basePath;
    this._skills.clear();

    if (!fs.existsSync(basePath)) {
      this._log('warn', `Skills directory not found: ${basePath} (empty registry)`);
      return;
    }

    const stat = fs.statSync(basePath);
    if (!stat.isDirectory()) {
      this._log('warn', `Skills path is not a directory: ${basePath}`);
      return;
    }

    const files = fs.readdirSync(basePath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const fullPath = path.join(basePath, file);
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const def = JSON.parse(raw);

        const error = this._validate(def, file);
        if (error) {
          this._log('warn', `Skill ${file}: ${error} (skipped)`);
          continue;
        }

        if (this._skills.has(def.id)) {
          this._log('warn', `Skill ${file}: duplicate ID "${def.id}" (skipped)`);
          continue;
        }

        this._skills.set(def.id, def);
        this._log('debug', `Loaded skill: ${def.id} (v${def.version}, ${def.steps.length} steps)`);
      } catch (err) {
        this._log('warn', `Skill ${file}: parse error: ${err.message} (skipped)`);
      }
    }
  }

  /**
   * Reload all skill definitions from the last-used directory.
   * @returns {{ loaded: number, errors: string[] }}
   */
  reload() {
    if (!this._basePath) {
      return { loaded: 0, errors: ['No base path set — call load() first'] };
    }
    const prevCount = this._skills.size;
    this.load(this._basePath, this._logger);
    this._log('info', `Reloaded: ${prevCount} → ${this._skills.size} skills`);
    return { loaded: this._skills.size, errors: [] };
  }

  /** Get skill definition by ID */
  get(id) {
    return this._skills.get(id) || null;
  }

  /** List all skills (compact: id + description + version) */
  list() {
    return [...this._skills.values()].map(s => ({
      id: s.id,
      description: s.description,
      version: s.version,
      parameterCount: s.parameters ? Object.keys(s.parameters).length : 0,
      stepCount: s.steps.length,
    }));
  }

  /** Get the full skills Map */
  all() {
    return this._skills;
  }

  /** Get required parameter names for a skill */
  getRequiredParams(id) {
    const skill = this._skills.get(id);
    if (!skill || !skill.parameters) return [];
    return Object.entries(skill.parameters)
      .filter(([, v]) => v.required)
      .map(([k]) => k);
  }

  /** Get all parameter names for a skill */
  getParamNames(id) {
    const skill = this._skills.get(id);
    if (!skill || !skill.parameters) return [];
    return Object.keys(skill.parameters);
  }

  // ─── Validation ─────────────────────────────────────────────────────────

  _validate(def, filename) {
    if (!def.id || typeof def.id !== 'string') return 'missing or invalid "id"';
    if (!def.version || typeof def.version !== 'number') return 'missing or invalid "version"';
    if (!def.description || typeof def.description !== 'string') return 'missing "description"';
    if (!Array.isArray(def.steps) || def.steps.length === 0) return 'missing or empty "steps"';

    const stepIds = new Set();
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (!step.id || typeof step.id !== 'string') return `step[${i}]: missing "id"`;
      if (!step.type || !VALID_STEP_TYPES.has(step.type)) return `step[${i}]: invalid type "${step.type}"`;
      if (stepIds.has(step.id)) return `step[${i}]: duplicate step ID "${step.id}"`;
      stepIds.add(step.id);
    }

    return null; // valid
  }

  _log(level, msg) {
    if (this._logger && typeof this._logger[level] === 'function') {
      this._logger[level]('SkillRegistry', msg);
    }
  }
}

export const skillRegistry = new SkillRegistry();
