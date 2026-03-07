// Model Profiles v103 — Role-Based Model Requirements & Registry
// ══════════════════════════════════════════════════════════════════════════════
//
// Defines what C3 needs from each model slot:
//   - Role description and current binding
//   - Model family preferences (deepseek, qwen, llama, codestral…)
//   - Hardware/capability requirements
//   - Validation criteria
//
// This is the source of truth for the upgrade pipeline.
// Discovery and ranking use profiles to filter and score candidates.
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';

// ─── Model Families ────────────────────────────────────────────────────────

/**
 * Known model family signatures.
 * Used to parse Ollama model names into family + version + params.
 *
 * Pattern: family-version:params OR family:params
 * Examples:
 *   deepseek-r1-32b       → { family: 'deepseek-r1', version: null, params: 32 }
 *   qwen3.5:27b           → { family: 'qwen', version: '3.5', params: 27 }
 *   qwen3-30b-a3b         → { family: 'qwen', version: '3', params: 30 }
 *   llama3.1:70b          → { family: 'llama', version: '3.1', params: 70 }
 *   codestral:22b         → { family: 'codestral', version: null, params: 22 }
 *   llava:13b             → { family: 'llava', version: null, params: 13 }
 */
export const MODEL_FAMILIES = [
  { prefix: 'deepseek-r1',    family: 'deepseek-r1',  category: 'reasoning' },
  { prefix: 'deepseek-coder', family: 'deepseek-coder', category: 'code' },
  { prefix: 'deepseek-v',     family: 'deepseek',     category: 'general' },
  { prefix: 'qwen3',          family: 'qwen',         category: 'general' },
  { prefix: 'qwen2.5-coder',  family: 'qwen-coder',   category: 'code' },
  { prefix: 'qwen2.5',        family: 'qwen',         category: 'general' },
  { prefix: 'qwen',           family: 'qwen',         category: 'general' },
  { prefix: 'llama3',         family: 'llama',        category: 'general' },
  { prefix: 'llama',          family: 'llama',        category: 'general' },
  { prefix: 'codestral',      family: 'codestral',    category: 'code' },
  { prefix: 'mistral',        family: 'mistral',      category: 'general' },
  { prefix: 'mixtral',        family: 'mixtral',      category: 'general' },
  { prefix: 'phi',            family: 'phi',          category: 'general' },
  { prefix: 'gemma',          family: 'gemma',        category: 'general' },
  { prefix: 'starcoder',      family: 'starcoder',    category: 'code' },
  { prefix: 'llava',          family: 'llava',        category: 'vision' },
  { prefix: 'bakllava',       family: 'llava',        category: 'vision' },
];

// ─── Model Name Parser ─────────────────────────────────────────────────────

/**
 * Parse an Ollama model name into structured components.
 *
 * @param {string} modelName - e.g. 'qwen3.5:27b', 'deepseek-r1-32b'
 * @returns {{ name: string, family: string, category: string, version: string|null, params: number|null, quantization: string|null }}
 */
export function parseModelName(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    return { name: modelName, family: 'unknown', category: 'unknown', version: null, params: null, quantization: null };
  }

  const lower = modelName.toLowerCase().trim();
  const result = { name: modelName, family: 'unknown', category: 'unknown', version: null, params: null, quantization: null };

  // Match family
  for (const f of MODEL_FAMILIES) {
    if (lower.startsWith(f.prefix)) {
      result.family = f.family;
      result.category = f.category;
      break;
    }
  }

  // Extract params (e.g. :27b, -32b, :70b-q4_0)
  const paramsMatch = lower.match(/[:\-](\d+)b/);
  if (paramsMatch) {
    result.params = parseInt(paramsMatch[1], 10);
  }

  // Extract version (e.g. qwen3.5 → 3.5, llama3.1 → 3.1, qwen3 → 3)
  const versionMatch = lower.match(/(?:qwen|llama|deepseek-v|phi|gemma|mistral)(\d+(?:\.\d+)?)/);
  if (versionMatch) {
    result.version = versionMatch[1];
  }

  // Extract quantization (e.g. :27b-q4_0, :q5_K_M)
  const quantMatch = lower.match(/(q\d[_\w]*)/i);
  if (quantMatch) {
    result.quantization = quantMatch[1].toUpperCase();
  }

  return result;
}

// ─── Role Profiles ──────────────────────────────────────────────────────────

/**
 * Profile for each model role in C3.
 * Profiles define requirements and preferences for upgrade candidates.
 */
export const MODEL_PROFILES = {
  D1: {
    role: 'D1',
    description: 'Deep deliberation — analysis, planning, redesign',
    getCurrentModel: () => config.models.D1,
    requirements: {
      minParams: 14,
      maxParams: 72,
      capabilities: ['reasoning', 'instruction-following', 'json-output'],
      jsonRequired: true,
    },
    preferredFamilies: ['deepseek-r1', 'qwen', 'llama'],
    preferredCategories: ['reasoning', 'general'],
    validationSuite: 'reasoning',
  },

  D2: {
    role: 'D2',
    description: 'Fix deliberation — focused fix reasoning',
    getCurrentModel: () => config.models.D2,
    requirements: {
      minParams: 7,
      maxParams: 72,
      capabilities: ['instruction-following', 'json-output'],
      jsonRequired: true,
    },
    preferredFamilies: ['qwen', 'deepseek-r1', 'llama', 'mistral'],
    preferredCategories: ['general', 'reasoning'],
    validationSuite: 'reasoning',
  },

  CODE: {
    role: 'CODE',
    description: 'Implementation — code generation and fixes',
    getCurrentModel: () => config.models.CODE,
    requirements: {
      minParams: 7,
      maxParams: 72,
      capabilities: ['code-generation', 'instruction-following'],
      jsonRequired: false,
    },
    preferredFamilies: ['qwen', 'qwen-coder', 'codestral', 'deepseek-coder', 'starcoder'],
    preferredCategories: ['code', 'general'],
    validationSuite: 'code',
  },

  R1: {
    role: 'R1',
    description: 'Final deep review — same deep reasoning as D1',
    getCurrentModel: () => config.models.R1,
    requirements: {
      minParams: 14,
      maxParams: 72,
      capabilities: ['reasoning', 'code-review', 'json-output'],
      jsonRequired: true,
    },
    preferredFamilies: ['deepseek-r1', 'qwen', 'llama'],
    preferredCategories: ['reasoning', 'general'],
    validationSuite: 'reasoning',
  },

  R2: {
    role: 'R2',
    description: 'Quick review — fast structural/logic check',
    getCurrentModel: () => config.models.R2,
    requirements: {
      minParams: 7,
      maxParams: 72,
      capabilities: ['instruction-following', 'json-output'],
      jsonRequired: true,
    },
    preferredFamilies: ['qwen', 'llama', 'mistral', 'phi'],
    preferredCategories: ['general', 'code'],
    validationSuite: 'review',
  },

  CHAT: {
    role: 'CHAT',
    description: 'Chat — user-facing conversation, Czech language support',
    getCurrentModel: () => config.models.CHAT,
    requirements: {
      minParams: 7,
      maxParams: 72,
      capabilities: ['instruction-following', 'czech-language', 'conversational'],
      jsonRequired: false,
    },
    preferredFamilies: ['qwen', 'llama', 'mistral'],
    preferredCategories: ['general'],
    validationSuite: 'chat',
  },

  VISION: {
    role: 'VISION',
    description: 'Vision — image understanding',
    getCurrentModel: () => config.models.VISION,
    requirements: {
      minParams: 7,
      maxParams: 72,
      capabilities: ['vision', 'image-understanding'],
      jsonRequired: false,
    },
    preferredFamilies: ['llava'],
    preferredCategories: ['vision'],
    validationSuite: 'vision',
  },
};

// ─── Helper: Get All Profiles ──────────────────────────────────────────────

/**
 * Get all model profiles as array.
 * @returns {Array<Object>}
 */
export function getAllProfiles() {
  return Object.values(MODEL_PROFILES);
}

/**
 * Get profile for a specific role.
 * @param {string} role
 * @returns {Object|null}
 */
export function getProfile(role) {
  return MODEL_PROFILES[role] || null;
}

/**
 * Get current model bindings for all roles.
 * @returns {Object<string, string>}
 */
export function getCurrentBindings() {
  const bindings = {};
  for (const [role, profile] of Object.entries(MODEL_PROFILES)) {
    bindings[role] = profile.getCurrentModel();
  }
  return bindings;
}

/**
 * Check if two models share the same family.
 * @param {string} modelA
 * @param {string} modelB
 * @returns {boolean}
 */
export function isSameFamily(modelA, modelB) {
  const a = parseModelName(modelA);
  const b = parseModelName(modelB);
  return a.family === b.family && a.family !== 'unknown';
}

/**
 * Check if candidate model is a newer version of the current model.
 * @param {string} current
 * @param {string} candidate
 * @returns {boolean}
 */
export function isNewerVersion(current, candidate) {
  const c = parseModelName(current);
  const d = parseModelName(candidate);
  if (c.family !== d.family || c.family === 'unknown') return false;
  if (!c.version || !d.version) return false;
  return parseFloat(d.version) > parseFloat(c.version);
}

export default {
  MODEL_FAMILIES, MODEL_PROFILES, parseModelName,
  getAllProfiles, getProfile, getCurrentBindings,
  isSameFamily, isNewerVersion,
};
