// C.3 v57.0 — Expertise Store
// ══════════════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TRUTH for expert state and persistence.
//
// Architecture:
//   Expert definitions → experts table
//   Expertise-conversation bindings → conversation_experts table
//   Expert lifecycle: LOAD → LOCK → APPLY → ENFORCE
//
// Invariants:
//   ❗ Custom experts MUST be persisted before being used
//   ❗ Expert lock state MUST be persisted to survive restarts
//   ❗ Expert config MUST be validated before saving
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { MERGE_LIMITS, MODULE_SECTIONS } from './merge-types.js';
import { checkCapabilityNormalization } from './capability-mapping.js';

// ─────────────────────────────────────────────────────────────────────────────
// Expertise Lifecycle States
// ─────────────────────────────────────────────────────────────────────────────

export const ExpertiseLifecycle = Object.freeze({
  INACTIVE: 'inactive',   // No expert for this conversation
  LOADED: 'loaded',       // Expert loaded, not locked
  LOCKED: 'locked',       // Expert locked to conversation
  APPLIED: 'applied',     // Expert hints applied to synthesis
  ENFORCED: 'enforced',   // Post-synthesis enforcement done
});

// ─────────────────────────────────────────────────────────────────────────────
// Expertise Config Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validation constraints for expert config
 */
const VALIDATION_RULES = {
  name: {
    required: true,
    minLength: 2,
    maxLength: 64,
  },
  description: {
    maxLength: 500,
  },
  domain: {
    maxLength: 64,
    pattern: /^[a-z0-9_]+$/,
  },
  systemPrompt: {
    maxLength: 8000,
    forbiddenPatterns: [
      /ignore (all |previous |system )?instructions/i,
      /you are (now )?chatgpt/i,
      /forget (all |your )?rules/i,
      /bypass/i,
      /jailbreak/i,
    ],
  },
  temperature: {
    min: 0,
    max: 1,
  },
  forbiddenPhrases: {
    maxItems: 50,
    maxItemLength: 200,
  },
  // v63.0: Merge Engine v2 — modules, capabilities, inheritance
  modules: {
    validSections: MODULE_SECTIONS,
    maxItemLength: 500,
    sectionLimits: {
      domain_rules: MERGE_LIMITS.MAX_DOMAIN_RULES,
      emphasis: MERGE_LIMITS.MAX_EMPHASIS,
      constraints: MERGE_LIMITS.MAX_CONSTRAINTS,
      vocabulary: MERGE_LIMITS.MAX_VOCABULARY,
      antipatterns: MERGE_LIMITS.MAX_ANTIPATTERNS,
    },
  },
  capabilities: {
    validDimensions: ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'],
    min: 0,
    max: 100,
  },
  inheritance: {
    validModes: ['extend', 'replace'],
  },
};

/**
 * Validate expert configuration
 *
 * @param {Object} config - Expert config to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExpertiseConfig(config) {
  const errors = [];

  // Required fields
  if (!config.name || typeof config.name !== 'string') {
    errors.push('name is required and must be a string');
  } else {
    if (config.name.length < VALIDATION_RULES.name.minLength) {
      errors.push(`name must be at least ${VALIDATION_RULES.name.minLength} characters`);
    }
    if (config.name.length > VALIDATION_RULES.name.maxLength) {
      errors.push(`name must be at most ${VALIDATION_RULES.name.maxLength} characters`);
    }
  }

  // Description
  if (config.description && config.description.length > VALIDATION_RULES.description.maxLength) {
    errors.push(`description must be at most ${VALIDATION_RULES.description.maxLength} characters`);
  }

  // Domain
  if (config.domain) {
    if (config.domain.length > VALIDATION_RULES.domain.maxLength) {
      errors.push(`domain must be at most ${VALIDATION_RULES.domain.maxLength} characters`);
    }
    if (!VALIDATION_RULES.domain.pattern.test(config.domain)) {
      errors.push('domain must contain only lowercase letters, numbers, and underscores');
    }
  }

  // System prompt
  if (config.systemPrompt) {
    if (config.systemPrompt.length > VALIDATION_RULES.systemPrompt.maxLength) {
      errors.push(`systemPrompt must be at most ${VALIDATION_RULES.systemPrompt.maxLength} characters`);
    }
    for (const pattern of VALIDATION_RULES.systemPrompt.forbiddenPatterns) {
      if (pattern.test(config.systemPrompt)) {
        errors.push('systemPrompt contains forbidden pattern (potential prompt injection)');
        break;
      }
    }
  }

  // Temperature
  if (config.temperature !== undefined) {
    const temp = parseFloat(config.temperature);
    if (isNaN(temp) || temp < VALIDATION_RULES.temperature.min || temp > VALIDATION_RULES.temperature.max) {
      errors.push(`temperature must be between ${VALIDATION_RULES.temperature.min} and ${VALIDATION_RULES.temperature.max}`);
    }
  }

  // Forbidden phrases
  if (config.styleRules?.forbiddenPhrases) {
    const phrases = config.styleRules.forbiddenPhrases;
    if (!Array.isArray(phrases)) {
      errors.push('forbiddenPhrases must be an array');
    } else {
      if (phrases.length > VALIDATION_RULES.forbiddenPhrases.maxItems) {
        errors.push(`forbiddenPhrases must have at most ${VALIDATION_RULES.forbiddenPhrases.maxItems} items`);
      }
      for (let i = 0; i < phrases.length; i++) {
        const phrase = phrases[i];
        // Can be string or regex pattern string
        if (typeof phrase === 'string' && phrase.length > VALIDATION_RULES.forbiddenPhrases.maxItemLength) {
          errors.push(`forbiddenPhrases[${i}] exceeds max length`);
        }
      }
    }
  }

  // v63.0: Modules validation
  if (config.modules !== undefined && config.modules !== null) {
    if (typeof config.modules !== 'object' || Array.isArray(config.modules)) {
      errors.push('modules must be an object');
    } else {
      const validSections = VALIDATION_RULES.modules.validSections;
      const sectionLimits = VALIDATION_RULES.modules.sectionLimits;
      for (const key of Object.keys(config.modules)) {
        if (!validSections.includes(key)) {
          errors.push(`modules: unknown section '${key}', valid: ${validSections.join(', ')}`);
          continue;
        }
        if (key === 'disclaimer') {
          // disclaimer is string|null, not array
          if (config.modules[key] !== null && typeof config.modules[key] !== 'string') {
            errors.push('modules.disclaimer must be a string or null');
          }
        } else {
          if (!Array.isArray(config.modules[key])) {
            errors.push(`modules.${key} must be an array`);
          } else {
            const limit = sectionLimits[key];
            if (limit && config.modules[key].length > limit) {
              errors.push(`modules.${key} exceeds limit of ${limit} items (got ${config.modules[key].length})`);
            }
            for (let i = 0; i < config.modules[key].length; i++) {
              if (typeof config.modules[key][i] !== 'string') {
                errors.push(`modules.${key}[${i}] must be a string`);
              } else if (config.modules[key][i].length > VALIDATION_RULES.modules.maxItemLength) {
                errors.push(`modules.${key}[${i}] exceeds max length of ${VALIDATION_RULES.modules.maxItemLength}`);
              }
            }
          }
        }
      }
    }
  }

  // v63.0: Capabilities validation
  if (config.capabilities !== undefined && config.capabilities !== null) {
    if (typeof config.capabilities !== 'object' || Array.isArray(config.capabilities)) {
      errors.push('capabilities must be an object');
    } else {
      const validDims = VALIDATION_RULES.capabilities.validDimensions;
      for (const key of Object.keys(config.capabilities)) {
        if (!validDims.includes(key)) {
          errors.push(`capabilities: unknown dimension '${key}', valid: ${validDims.join(', ')}`);
          continue;
        }
        const val = config.capabilities[key];
        if (typeof val !== 'number' || isNaN(val) || val < VALIDATION_RULES.capabilities.min || val > VALIDATION_RULES.capabilities.max) {
          errors.push(`capabilities.${key} must be a number between ${VALIDATION_RULES.capabilities.min} and ${VALIDATION_RULES.capabilities.max}`);
        }
      }
    }
  }

  // v63.0: Inheritance validation
  if (config.inheritance !== undefined && config.inheritance !== null) {
    if (typeof config.inheritance !== 'object' || Array.isArray(config.inheritance)) {
      errors.push('inheritance must be an object');
    } else {
      const validModes = VALIDATION_RULES.inheritance.validModes;
      for (const [key, mode] of Object.entries(config.inheritance)) {
        if (!validModes.includes(mode)) {
          errors.push(`inheritance.${key}: invalid mode '${mode}', valid: ${validModes.join(', ')}`);
        }
      }
    }
  }

  // v63.0: Capability normalization warnings (soft, not blocking)
  const warnings = [];
  if (config.capabilities && typeof config.capabilities === 'object' && !Array.isArray(config.capabilities)) {
    const normalization = checkCapabilityNormalization(config.capabilities);
    warnings.push(...normalization.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expertise Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExpertiseStore — DB-backed expert state manager.
 *
 * Handles:
 * - Custom expert CRUD with validation
 * - Expertise-conversation binding with lock state
 * - Expert lifecycle management
 *
 * @example
 *   const store = new ExpertiseStore(db);
 *   store.saveCustomExpertise({ id: 'my_expert', name: 'My Expert', ... });
 *   store.setExpertiseForConversation('conv-123', 'my_expert', { locked: true });
 *   const binding = store.getExpertiseBinding('conv-123');
 */
export class ExpertiseStore {
  #db;

  /**
   * @param {Object} db — Database module with { expertises, expertiseBindings } exports
   */
  constructor(db = null) {
    this.#db = db;

    // In-memory fallback for tests
    if (!db) {
      this._memExpertises = new Map();
      this._memBindings = new Map();
      this._memExpertises = new Map(); // v63.0: multi-expertise bindings
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Custom Expertise CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save a custom expert to DB.
   * VALIDATES config before saving.
   *
   * @param {Object} config - Expert configuration
   * @returns {{ success: boolean, expert?: Object, errors?: string[] }}
   */
  saveCustomExpertise(config) {
    // Validate first
    const validation = validateExpertiseConfig(config);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Generate ID if not provided
    const id = config.id || this.#generateId(config.name);

    const expertData = {
      id,
      name: config.name,
      description: config.description || '',
      domain: config.domain || 'custom',
      systemPrompt: config.systemPrompt || '',
      temperature: config.temperature ?? 0.5,
      config: {
        icon: config.icon || '👤',
        primaryProblemTypes: config.primaryProblemTypes || ['procedural'],
        allowedRepresentations: config.allowedRepresentations || ['structured'],
        planningDepth: config.planningDepth || 'none',
        reviewPolicy: config.reviewPolicy || 'none',
        dataUsagePolicy: config.dataUsagePolicy || 'forbidden',
        outputBias: config.outputBias || 'analytical',
        preferredModels: config.preferredModels || ['qwen3.5:27b'],
        styleRules: config.styleRules || {},
        weights: config.weights || {},
        isCustom: true,
      },
    };

    if (this.#db) {
      try {
        this.#db.expertises.upsert(
          expertData.id,
          expertData.name,
          expertData.description,
          expertData.domain,
          expertData.systemPrompt,
          expertData.temperature,
          JSON.stringify(expertData.config)
        );
        logger.info('ExpertiseStore', `Saved custom expertise: ${id}`);
        return { success: true, expert: expertData };
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to save expertise: ${err.message}`);
        return { success: false, errors: [`Database error: ${err.message}`] };
      }
    }

    // In-memory mode
    this._memExpertises.set(id, expertData);
    return { success: true, expert: expertData };
  }

  /**
   * Get a custom expert by ID.
   *
   * @param {string} id - Expert ID
   * @returns {Object|null}
   */
  getCustomExpertise(id) {
    if (this.#db) {
      return this.#db.expertises.getConfig(id);
    }
    return this._memExpertises.get(id) || null;
  }

  /**
   * List all custom experts.
   *
   * @returns {Array<Object>}
   */
  listCustomExpertises() {
    if (this.#db) {
      try {
        const rows = this.#db.expertises.listCustom.all();
        return rows.map(row => ({
          ...row,
          config: this.#parseJSON(row.config),
        }));
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to list expertises: ${err.message}`);
        return [];
      }
    }
    return [...this._memExpertises.values()];
  }

  /**
   * Delete a custom expert.
   *
   * @param {string} id - Expert ID
   * @returns {boolean} - True if deleted
   */
  deleteCustomExpertise(id) {
    if (this.#db) {
      try {
        const result = this.#db.expertises.delete.run(id);
        return result.changes > 0;
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to delete expertise: ${err.message}`);
        return false;
      }
    }
    return this._memExpertises.delete(id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expertise-Conversation Bindings (Lock State)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set expert for a conversation.
   *
   * @param {string} conversationId
   * @param {string} expertId
   * @param {Object} [options]
   * @param {boolean} [options.locked] - Lock expert to conversation
   * @param {number} [options.strength] - Expert strength (0-100)
   */
  setExpertiseForConversation(conversationId, expertId, options = {}) {
    if (!conversationId || !expertId) {
      throw new Error('ExpertiseStore: conversationId and expertId are required');
    }

    if (this.#db) {
      try {
        this.#db.expertiseBindings.setExpertise(conversationId, expertId, options);
        logger.debug('ExpertiseStore', `Set expertise for conversation`, {
          conversationId: conversationId.substring(0, 12),
          expertId,
          locked: options.locked || false,
        });
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to set expertise: ${err.message}`);
        throw err;
      }
      return;
    }

    // In-memory mode
    this._memBindings.set(conversationId, {
      conversation_id: conversationId,
      expertise_id: expertId,
      locked: options.locked ? 1 : 0,
      strength: options.strength ?? 50,
      locked_at: options.locked ? new Date().toISOString() : null,
    });
  }

  /**
   * Get expert binding for a conversation.
   *
   * @param {string} conversationId
   * @returns {{ expert_id: string, locked: boolean, strength: number }|null}
   */
  getExpertiseBinding(conversationId) {
    if (!conversationId) return null;

    if (this.#db) {
      try {
        const binding = this.#db.expertiseBindings.getBinding(conversationId);
        if (!binding) return null;
        return {
          expertId: binding.expertise_id,
          locked: binding.locked === 1,
          strength: binding.strength,
          lockedAt: binding.locked_at,
        };
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to get binding: ${err.message}`);
        return null;
      }
    }

    const binding = this._memBindings.get(conversationId);
    if (!binding) return null;
    return {
      expertId: binding.expertise_id,
      locked: binding.locked === 1,
      strength: binding.strength,
      lockedAt: binding.locked_at,
    };
  }

  /**
   * Lock expert for a conversation.
   *
   * @param {string} conversationId
   */
  lockExpertise(conversationId) {
    if (this.#db) {
      this.#db.expertiseBindings.lock.run(conversationId);
      logger.debug('ExpertiseStore', `Locked expertise for conversation: ${conversationId.substring(0, 12)}`);
      return;
    }

    const binding = this._memBindings.get(conversationId);
    if (binding) {
      binding.locked = 1;
      binding.locked_at = new Date().toISOString();
    }
  }

  /**
   * Unlock expert for a conversation.
   *
   * @param {string} conversationId
   */
  unlockExpertise(conversationId) {
    if (this.#db) {
      this.#db.expertiseBindings.unlock.run(conversationId);
      logger.debug('ExpertiseStore', `Unlocked expertise for conversation: ${conversationId.substring(0, 12)}`);
      return;
    }

    const binding = this._memBindings.get(conversationId);
    if (binding) {
      binding.locked = 0;
      binding.locked_at = null;
    }
  }

  /**
   * Clear expert for a conversation.
   *
   * @param {string} conversationId
   */
  clearExpertise(conversationId) {
    if (this.#db) {
      this.#db.expertiseBindings.clearExpertise(conversationId);
      return;
    }
    this._memBindings.delete(conversationId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v63.0: Multi-Expertise Bindings (Merge Engine v2)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set multiple expertises for a conversation (max 3).
   * Replaces all existing expertise bindings.
   * Also clears legacy single-expert binding from conversation_experts (🟡4).
   *
   * @param {string} conversationId
   * @param {Array<{expertiseId: string, weight?: number, position?: number}>} expertises
   */
  setExpertisesForConversation(conversationId, expertises) {
    if (!conversationId) {
      throw new Error('ExpertiseStore: conversationId is required');
    }
    if (!Array.isArray(expertises) || expertises.length === 0) {
      throw new Error('ExpertiseStore: expertises must be a non-empty array');
    }
    if (expertises.length > MERGE_LIMITS.MAX_ACTIVE_EXPERTISES) {
      throw new Error(`ExpertiseStore: max ${MERGE_LIMITS.MAX_ACTIVE_EXPERTISES} expertises allowed, got ${expertises.length}`);
    }

    // Normalize entries
    const normalized = expertises.map((e, idx) => ({
      expertiseId: e.expertiseId,
      weight: Math.max(MERGE_LIMITS.MIN_WEIGHT, Math.min(MERGE_LIMITS.MAX_WEIGHT, e.weight ?? 0.5)),
      position: e.position ?? idx,
    }));

    if (this.#db) {
      try {
        // Use the setExpertises transaction from DB
        this.#db.conversationExpertises.setExpertises(conversationId, normalized);
        // 🟡4: Clear legacy single-expert binding
        try {
          this.#db.expertiseBindings.clearExpertise(conversationId);
        } catch {
          // Legacy table might not exist, ignore
        }
        logger.info('ExpertiseStore', `Set ${normalized.length} expertises for conversation`, {
          conversationId: conversationId.substring(0, 12),
          expertises: normalized.map(e => e.expertiseId),
        });
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to set expertises: ${err.message}`);
        throw err;
      }
      return;
    }

    // In-memory mode
    this._memExpertises.set(conversationId, normalized.map(e => ({
      conversation_id: conversationId,
      expertise_id: e.expertiseId,
      weight: e.weight,
      position: e.position,
      created_at: new Date().toISOString(),
    })));
    // 🟡4: Clear legacy
    this._memBindings.delete(conversationId);
  }

  /**
   * Get expertises for a conversation.
   * Returns sorted by weight desc, position as tie-breaker (🟡5).
   *
   * @param {string} conversationId
   * @returns {Array<{expertiseId: string, weight: number, position: number}>}
   */
  getExpertises(conversationId) {
    if (!conversationId) return [];

    if (this.#db) {
      try {
        return this.#db.conversationExpertises.getExpertises(conversationId);
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to get expertises: ${err.message}`);
        return [];
      }
    }

    // In-memory mode
    const entries = this._memExpertises.get(conversationId) || [];
    return entries
      .map(e => ({
        expertiseId: e.expertise_id,
        weight: e.weight,
        position: e.position,
      }))
      .sort((a, b) => b.weight - a.weight || a.position - b.position);
  }

  /**
   * Clear all expertises for a conversation.
   *
   * @param {string} conversationId
   */
  clearExpertises(conversationId) {
    if (this.#db) {
      try {
        this.#db.conversationExpertises.deleteAll(conversationId);
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to clear expertises: ${err.message}`);
      }
      return;
    }
    this._memExpertises.delete(conversationId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v57.1 A8: Expertise Cross-Session Memory
  // ─────────────────────────────────────────────────────────────────────────
  // Expert remembers facts/context across conversations.
  // Example: "accountant" remembers user's company type (s.r.o.),
  //          "lawyer" remembers jurisdiction preference (ČR vs EU).
  //
  // Memory is per-expert, not per-conversation.
  // Max 50 items per expert, max 2000 chars per value.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Store a memory item for an expert.
   *
   * @param {string} expertId
   * @param {string} key - Memory key (e.g. 'user_company_type', 'preferred_jurisdiction')
   * @param {string} value - Memory value
   * @returns {boolean}
   */
  setMemory(expertId, key, value) {
    if (!expertId || !key) return false;
    if (typeof value !== 'string') value = JSON.stringify(value);
    if (value.length > 2000) {
      logger.warn('ExpertiseStore', `Memory value too long for ${expertId}/${key}: ${value.length}`);
      value = value.substring(0, 2000);
    }

    // D-int4: Capture previous value before overwrite
    const previousValue = this.getMemory(expertId, key);

    if (this.#db) {
      try {
        this.#db.run(
          `INSERT OR REPLACE INTO expertise_memory (expertise_id, key, value, previous_value, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
          [expertId, key, value, previousValue]
        );
        if (previousValue !== null && previousValue !== value) {
          logger.info('ExpertiseStore', `Memory changed: ${expertId}/${key}`, {
            previous: previousValue.substring(0, 50),
            current: value.substring(0, 50),
          });
        } else {
          logger.debug('ExpertiseStore', `Memory set: ${expertId}/${key}`);
        }
        return true;
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to set memory: ${err.message}`);
        return false;
      }
    }

    // In-memory fallback
    if (!this._memMemory) this._memMemory = new Map();
    const memKey = `${expertId}:${key}`;
    this._memMemory.set(memKey, {
      expertId, key, value, previousValue,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * Get a specific memory item.
   *
   * @param {string} expertId
   * @param {string} key
   * @returns {string|null}
   */
  getMemory(expertId, key) {
    if (this.#db) {
      try {
        const row = this.#db.prepare(
          `SELECT value FROM expertise_memory WHERE expertise_id = ? AND key = ?`
        ).get(expertId, key);
        return row?.value || null;
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to get memory: ${err.message}`);
        return null;
      }
    }

    if (!this._memMemory) return null;
    return this._memMemory.get(`${expertId}:${key}`)?.value || null;
  }

  /**
   * Get ALL memory items for an expert.
   * Used to inject into synthesis context.
   *
   * @param {string} expertId
   * @returns {Array<{ key: string, value: string, updatedAt: string }>}
   */
  getAllMemory(expertId) {
    if (this.#db) {
      try {
        return this.#db.prepare(
          `SELECT key, value, updated_at as updatedAt
           FROM expertise_memory WHERE expertise_id = ?
           ORDER BY updated_at DESC LIMIT 50`
        ).all(expertId) || [];
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to get all memory: ${err.message}`);
        return [];
      }
    }

    if (!this._memMemory) return [];
    return [...this._memMemory.values()]
      .filter(m => m.expertId === expertId)
      .slice(0, 50);
  }

  /**
   * D-int4: Get ALL memory items with change history.
   * Returns previous_value for change-aware context injection.
   *
   * @param {string} expertId
   * @returns {Array<{ key: string, value: string, previousValue: string|null, updatedAt: string }>}
   */
  getMemoryWithHistory(expertId) {
    if (this.#db) {
      try {
        return this.#db.prepare(
          `SELECT key, value, previous_value as previousValue, updated_at as updatedAt
           FROM expertise_memory WHERE expertise_id = ?
           ORDER BY updated_at DESC LIMIT 50`
        ).all(expertId) || [];
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to get memory with history: ${err.message}`);
        return [];
      }
    }

    if (!this._memMemory) return [];
    return [...this._memMemory.values()]
      .filter(m => m.expertId === expertId)
      .map(m => ({
        key: m.key,
        value: m.value,
        previousValue: m.previousValue || null,
        updatedAt: m.updatedAt,
      }))
      .slice(0, 50);
  }

  /**
   * Delete a specific memory item.
   *
   * @param {string} expertId
   * @param {string} key
   * @returns {boolean}
   */
  deleteMemory(expertId, key) {
    if (this.#db) {
      try {
        const result = this.#db.prepare(
          `DELETE FROM expertise_memory WHERE expertise_id = ? AND key = ?`
        ).run(expertId, key);
        return result.changes > 0;
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to delete memory: ${err.message}`);
        return false;
      }
    }

    if (!this._memMemory) return false;
    return this._memMemory.delete(`${expertId}:${key}`);
  }

  /**
   * Clear ALL memory for an expert.
   *
   * @param {string} expertId
   * @returns {boolean}
   */
  clearMemory(expertId) {
    if (this.#db) {
      try {
        this.#db.prepare(`DELETE FROM expertise_memory WHERE expertise_id = ?`).run(expertId);
        return true;
      } catch (err) {
        logger.error('ExpertiseStore', `Failed to clear memory: ${err.message}`);
        return false;
      }
    }

    if (!this._memMemory) return false;
    const toDelete = [...this._memMemory.keys()].filter(k => k.startsWith(`${expertId}:`));
    toDelete.forEach(k => this._memMemory.delete(k));
    return toDelete.length > 0;
  }

  /**
   * Format expert memory as context string for synthesis prompt injection.
   *
   * @param {string} expertId
   * @returns {string|null} Formatted memory context, or null if empty
   */
  getMemoryContext(expertId) {
    // D-int4: Use history-aware query for change tracking
    const items = this.getMemoryWithHistory(expertId);
    if (items.length === 0) return null;

    const lines = items.map(m => {
      if (m.previousValue && m.previousValue !== m.value) {
        return `- ${m.key}: ${m.value} (předchozí: ${m.previousValue})`;
      }
      return `- ${m.key}: ${m.value}`;
    });
    return `Expert memory (facts from previous sessions):\n${lines.join('\n')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  #generateId(name) {
    return name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 32);
  }

  #parseJSON(str) {
    if (!str) return {};
    if (typeof str === 'object') return str;
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get the global ExpertiseStore instance.
 *
 * @param {Object} [db] — Pass DB on first call to initialize.
 * @returns {ExpertiseStore}
 */
export function getExpertiseStore(db = null) {
  if (!_instance) {
    _instance = new ExpertiseStore(db);
  }
  return _instance;
}

/**
 * Reset singleton (for tests).
 */
export function resetExpertiseStore() {
  _instance = null;
}

export default {
  ExpertiseStore,
  ExpertiseLifecycle,
  validateExpertiseConfig,
  getExpertiseStore,
  resetExpertiseStore,
};
