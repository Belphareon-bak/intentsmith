// Skill Registry — loads and validates skill definitions from JSON files
// ══════════════════════════════════════════════════════════════════════════════
//
// Singleton registry: load skill/*.json at startup, provide lookup by ID.
// Graceful empty load — missing directory = empty registry, no crash.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import {
  EXTENSION_KIND,
  canonicalizeExtensionManifestV1,
} from '../../contracts/m3/extension-v1.js';

const VALID_STEP_TYPES = new Set(['llm', 'template', 'write', 'shell', 'ask', 'review', 'validate', 'transform']);
const GOVERNED_PARAMETER_TYPES = new Set(['string', 'number', 'boolean']);

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => allowed.has(key));
}

export function validateGovernedSkillDefinition(definition) {
  const errors = [];
  const required = [
    'version', 'description', 'purpose', 'trigger', 'parameters', 'stepModel',
    'toolSelection', 'steps', 'qualityCriteria', 'outputCriteria',
  ];
  if (!exactKeys(definition, required)) return ['skill-definition:invalid-keys'];
  if (!Number.isSafeInteger(definition.version) || definition.version <= 0) {
    errors.push('skill-definition:invalid-version');
  }
  for (const key of ['description', 'purpose']) {
    if (typeof definition[key] !== 'string' || definition[key].trim().length === 0) {
      errors.push(`skill-definition:invalid-${key}`);
    }
  }
  if (!exactKeys(definition.trigger, ['patterns', 'confidence'])
    || !Array.isArray(definition.trigger?.patterns)
    || definition.trigger.patterns.length === 0
    || definition.trigger.patterns.length > 8
    || typeof definition.trigger.confidence !== 'number'
    || definition.trigger.confidence < 0.6
    || definition.trigger.confidence > 1) {
    errors.push('skill-definition:invalid-trigger');
  } else {
    for (const source of definition.trigger.patterns) {
      try {
        if (typeof source !== 'string' || source.length > 1024) throw new Error('bounded string required');
        new RegExp(source, 'iu');
      } catch { errors.push('skill-definition:invalid-trigger-pattern'); }
    }
  }
  if (!definition.parameters || typeof definition.parameters !== 'object' || Array.isArray(definition.parameters)) {
    errors.push('skill-definition:invalid-parameters');
  } else {
    for (const [name, parameter] of Object.entries(definition.parameters)) {
      if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(name)
        || !exactKeys(parameter, ['type', 'required', 'description'], ['default', 'maxLength', 'pattern'])
        || !GOVERNED_PARAMETER_TYPES.has(parameter.type)
        || typeof parameter.required !== 'boolean'
        || typeof parameter.description !== 'string') {
        errors.push(`skill-definition:invalid-parameter:${name}`);
        continue;
      }
      if (parameter.maxLength !== undefined
        && (!Number.isSafeInteger(parameter.maxLength) || parameter.maxLength < 1 || parameter.maxLength > 1_048_576)) {
        errors.push(`skill-definition:invalid-parameter-maxLength:${name}`);
      }
      if (parameter.pattern !== undefined) {
        try { new RegExp(parameter.pattern, 'u'); } catch { errors.push(`skill-definition:invalid-parameter-pattern:${name}`); }
      }
      if (parameter.default !== undefined) {
        let defaultMatchesPattern = true;
        if (parameter.pattern !== undefined) {
          try { defaultMatchesPattern = new RegExp(parameter.pattern, 'u').test(parameter.default); }
          catch { defaultMatchesPattern = false; }
        }
        const correctType = parameter.type === 'number'
          ? typeof parameter.default === 'number' && Number.isFinite(parameter.default)
          : typeof parameter.default === parameter.type;
        if (!correctType
          || (parameter.maxLength !== undefined && parameter.default.length > parameter.maxLength)
          || !defaultMatchesPattern) {
          errors.push(`skill-definition:invalid-parameter-default:${name}`);
        }
      }
    }
  }
  if (!exactKeys(definition.stepModel, ['fixed', 'variable'])
    || !Array.isArray(definition.stepModel?.fixed)
    || !Array.isArray(definition.stepModel?.variable)) {
    errors.push('skill-definition:invalid-stepModel');
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    errors.push('skill-definition:invalid-steps');
  } else {
    const ids = definition.steps.map(step => step?.id);
    const declared = [...(definition.stepModel?.fixed || []), ...(definition.stepModel?.variable || [])];
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) {
      errors.push('skill-definition:invalid-step-ids');
    }
    if (new Set(declared).size !== declared.length
      || ids.length !== declared.length
      || ids.some(id => !declared.includes(id))) {
      errors.push('skill-definition:stepModel-mismatch');
    }
    for (const step of definition.steps) {
      if (!VALID_STEP_TYPES.has(step?.type)) errors.push(`skill-definition:invalid-step-type:${step?.id}`);
      if (step?.type === 'shell') errors.push(`skill-definition:unavailable-effect-step:${step.id}`);
      if (step?.type === 'write' && step.toolId !== 'file.write') {
        errors.push(`skill-definition:invalid-write-tool:${step.id}`);
      }
      if (step?.type === 'validate' && step.mode !== 'deterministic') {
        errors.push(`skill-definition:non-deterministic-validation:${step.id}`);
      }
    }
  }
  if (!Array.isArray(definition.toolSelection)) {
    errors.push('skill-definition:invalid-toolSelection');
  } else {
    const writeSteps = definition.steps?.filter(step => step.type === 'write') || [];
    for (const selection of definition.toolSelection) {
      if (!exactKeys(selection, ['stepId', 'toolId', 'reason'])
        || selection.toolId !== 'file.write'
        || typeof selection.reason !== 'string'
        || !writeSteps.some(step => step.id === selection.stepId && step.toolId === selection.toolId)) {
        errors.push('skill-definition:invalid-tool-selection');
      }
    }
    if (writeSteps.length !== definition.toolSelection.length) {
      errors.push('skill-definition:tool-selection-incomplete');
    }
  }
  for (const key of ['qualityCriteria', 'outputCriteria']) {
    if (!Array.isArray(definition[key]) || definition[key].length === 0
      || definition[key].some(value => typeof value !== 'string' || value.trim().length === 0)) {
      errors.push(`skill-definition:invalid-${key}`);
    }
  }
  return errors;
}

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
        const parsed = JSON.parse(raw);
        let def = parsed;
        if (parsed?.contract === 'ExtensionManifest') {
          const manifest = canonicalizeExtensionManifestV1(parsed, EXTENSION_KIND.SKILL);
          const exactCapabilities = manifest.requiredCapabilities.length === 2
            && manifest.requiredCapabilities[0] === 'core.tool-authority.v1'
            && manifest.requiredCapabilities[1] === 'skill.runtime.v1'
            && manifest.optionalCapabilities.length === 0;
          if (!exactCapabilities) {
            this._log('warn', `Skill ${file}: undeclared runtime authority (skipped)`);
            continue;
          }
          if (manifest.payload.enabledByDefault !== true) {
            this._log('debug', `Skill ${file}: disabled ExtensionManifest (skipped)`);
            continue;
          }
          const governedErrors = validateGovernedSkillDefinition(manifest.payload.definition);
          if (governedErrors.length > 0) {
            this._log('warn', `Skill ${file}: ${governedErrors.join(', ')} (skipped)`);
            continue;
          }
          def = {
            ...structuredClone(manifest.payload.definition),
            id: manifest.id,
            extensionManifest: manifest,
            governed: true,
          };
        }

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
      governed: s.governed === true,
      moduleVersion: s.extensionManifest?.moduleVersion || null,
    }));
  }

  /** Get the full skills Map */
  all() {
    return this._skills;
  }

  resolveDeterministic(input) {
    for (const skill of this._skills.values()) {
      if (!skill.governed) continue;
      for (const source of skill.trigger.patterns) {
        const match = String(input || '').match(new RegExp(source, 'iu'));
        if (!match) continue;
        const params = {};
        for (const name of Object.keys(skill.parameters || {})) {
          if (match.groups?.[name] !== undefined) params[name] = match.groups[name].trim();
          else if (skill.parameters[name].default !== undefined) params[name] = skill.parameters[name].default;
        }
        return Object.freeze({
          skillId: skill.id,
          params: Object.freeze(params),
          confidence: skill.trigger.confidence,
          source: 'extension-trigger-v1',
        });
      }
    }
    return null;
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
