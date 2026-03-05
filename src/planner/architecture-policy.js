// Architecture Policy Engine v100 — Unified Architecture Source of Truth
// ══════════════════════════════════════════════════════════════════════════════
//
// Single declarative policy replaces:
//   - drift-detector.js hardcoded DEFAULT_LAYERS + ALLOWED_IMPORTS
//   - architecture-check.js ARCHITECTURE.json (ACF)
//
// Load priority: .c3/architecture-policy.json > ARCHITECTURE.json > auto-detect
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

// ─── Policy Schema ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} PolicyRule
 * @property {string} from - Source layer name
 * @property {string[]} [canImport] - Whitelist of allowed target layers
 * @property {string[]} [cannotImport] - Blacklist of denied target layers
 */

/**
 * @typedef {Object} PolicyBoundary
 * @property {string} module - Module path (e.g. 'src/auth')
 * @property {string[]} canImportFrom - Allowed import sources
 * @property {boolean} [isPrivate] - If true, only listed modules can import from this
 */

/**
 * @typedef {Object} ArchitecturePolicy
 * @property {string[]} layers - Ordered layer names (top to bottom)
 * @property {PolicyRule[]} rules - Import dependency rules
 * @property {Object<string,string>} [patterns] - Expected patterns per layer
 * @property {PolicyBoundary[]} [boundaries] - Module isolation rules
 * @property {Object<string,string>} [fileStructure] - Layer → directory mapping
 */

const POLICY_FILENAME = 'architecture-policy.json';
const POLICY_DIR = '.c3';
const ACF_FILENAME = 'ARCHITECTURE.json';

// ─── Default Layer Mapping (for auto-detect → policy) ───────────────────────

const LAYER_DIR_MAP = {
  ui:         ['components', 'views', 'pages', 'ui', 'templates', 'frontend'],
  controller: ['controllers', 'handlers', 'routes', 'api', 'endpoints'],
  service:    ['services', 'service', 'usecases', 'use-cases', 'business'],
  repository: ['repositories', 'repository', 'repos', 'dao', 'data'],
  model:      ['models', 'model', 'entities', 'entity', 'domain', 'types'],
  infra:      ['infra', 'infrastructure', 'config', 'db', 'database', 'migrations'],
  util:       ['utils', 'util', 'helpers', 'lib', 'shared', 'common'],
};

const DEFAULT_RULES = [
  { from: 'ui',         canImport: ['controller', 'service', 'model', 'util'] },
  { from: 'controller', canImport: ['service', 'model', 'util'] },
  { from: 'service',    canImport: ['repository', 'model', 'util', 'infra'] },
  { from: 'repository', canImport: ['model', 'util', 'infra'] },
  { from: 'model',      canImport: ['util'] },
  { from: 'infra',      canImport: ['model', 'util'] },
  { from: 'util',       canImport: [] },
];

// ─── Load Policy ────────────────────────────────────────────────────────────

/**
 * Load architecture policy from project. Priority:
 *   1. .c3/architecture-policy.json (explicit policy)
 *   2. ARCHITECTURE.json (ACF — converted to policy format)
 *   3. Auto-detect via detectArchitecture() → generatePolicy()
 *
 * @param {string} projectPath
 * @param {Object} [opts]
 * @param {Function} [opts.detectArchitecture] - Injected for auto-detect
 * @param {Array} [opts.files] - Pre-scanned files for auto-detect
 * @returns {Promise<ArchitecturePolicy|null>}
 */
export async function loadPolicy(projectPath, opts = {}) {
  // 1. Explicit policy file
  const policyPath = path.join(projectPath, POLICY_DIR, POLICY_FILENAME);
  try {
    const raw = await readFile(policyPath, 'utf-8');
    const policy = JSON.parse(raw);
    const validation = validatePolicy(policy);
    if (validation.valid) {
      logger.info('ArchPolicy', `Loaded policy from ${POLICY_DIR}/${POLICY_FILENAME}`);
      return policy;
    }
    logger.warn('ArchPolicy', `Policy invalid: ${validation.errors.join(', ')}`);
  } catch { /* file doesn't exist — try next */ }

  // 2. ARCHITECTURE.json fallback
  const acfPath = path.join(projectPath, ACF_FILENAME);
  try {
    const raw = await readFile(acfPath, 'utf-8');
    const acf = JSON.parse(raw);
    if (acf.layers && acf.rules) {
      const policy = acfToPolicy(acf);
      logger.info('ArchPolicy', `Converted ${ACF_FILENAME} to policy`);
      return policy;
    }
  } catch { /* file doesn't exist — try auto-detect */ }

  // 3. Auto-detect
  if (opts.detectArchitecture && opts.files) {
    try {
      const archResult = opts.detectArchitecture(opts.files);
      if (archResult) {
        const policy = generatePolicy(archResult);
        logger.info('ArchPolicy', `Auto-generated policy from architecture detection`);
        return policy;
      }
    } catch (err) {
      logger.warn('ArchPolicy', `Auto-detect failed: ${err.message}`);
    }
  }

  return null;
}

// ─── Generate Policy ────────────────────────────────────────────────────────

/**
 * Generate architecture policy from detectArchitecture() output.
 *
 * @param {Object} archResult - From detectArchitecture()
 * @returns {ArchitecturePolicy}
 */
export function generatePolicy(archResult) {
  if (!archResult) return _defaultPolicy();

  const layers = [];
  const fileStructure = {};

  // Extract layers from detected structure
  if (archResult.layers && typeof archResult.layers === 'object') {
    for (const [layerName, layerFiles] of Object.entries(archResult.layers)) {
      if (layerFiles.length > 0) {
        layers.push(layerName);
        // Derive directory from first file
        const firstFile = layerFiles[0];
        const dir = path.dirname(firstFile);
        if (dir && dir !== '.') {
          fileStructure[layerName] = dir;
        }
      }
    }
  }

  // If no layers detected, use defaults
  if (layers.length === 0) return _defaultPolicy();

  // Generate rules based on detected layers (standard top-down)
  const rules = _generateRulesForLayers(layers);

  // Extract patterns
  const patterns = {};
  if (archResult.patterns) {
    for (const p of archResult.patterns) {
      if (typeof p === 'string') {
        const lower = p.toLowerCase();
        if (lower.includes('rest')) patterns.controller = 'REST';
        if (lower.includes('mvc')) patterns.architecture = 'MVC';
        if (lower.includes('middleware')) patterns.middleware = 'pipeline';
      }
    }
  }

  return {
    layers,
    rules,
    patterns: Object.keys(patterns).length > 0 ? patterns : undefined,
    fileStructure: Object.keys(fileStructure).length > 0 ? fileStructure : undefined,
  };
}

// ─── Validate Policy ────────────────────────────────────────────────────────

/**
 * Validate a policy object.
 *
 * @param {ArchitecturePolicy} policy
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePolicy(policy) {
  const errors = [];

  if (!policy || typeof policy !== 'object') {
    return { valid: false, errors: ['Policy must be an object'] };
  }

  // Layers
  if (!Array.isArray(policy.layers) || policy.layers.length === 0) {
    errors.push('layers must be a non-empty array');
  } else {
    for (const l of policy.layers) {
      if (typeof l !== 'string' || l.length === 0) {
        errors.push(`Invalid layer: ${l}`);
      }
    }
    // Check for duplicates
    const unique = new Set(policy.layers);
    if (unique.size !== policy.layers.length) {
      errors.push('Duplicate layer names');
    }
  }

  // Rules
  if (!Array.isArray(policy.rules)) {
    errors.push('rules must be an array');
  } else {
    const layerSet = new Set(policy.layers || []);
    for (const rule of policy.rules) {
      if (!rule.from || !layerSet.has(rule.from)) {
        errors.push(`Rule references unknown layer: ${rule.from}`);
      }
      if (rule.canImport) {
        for (const target of rule.canImport) {
          if (!layerSet.has(target)) {
            errors.push(`Rule canImport references unknown layer: ${target}`);
          }
        }
      }
      if (rule.cannotImport) {
        for (const target of rule.cannotImport) {
          if (!layerSet.has(target)) {
            errors.push(`Rule cannotImport references unknown layer: ${target}`);
          }
        }
      }
      // Check circular: canImport and cannotImport overlap
      if (rule.canImport && rule.cannotImport) {
        const overlap = rule.canImport.filter(t => rule.cannotImport.includes(t));
        if (overlap.length > 0) {
          errors.push(`Rule for ${rule.from}: canImport/cannotImport overlap on: ${overlap.join(', ')}`);
        }
      }
    }
  }

  // Boundaries (optional)
  if (policy.boundaries) {
    if (!Array.isArray(policy.boundaries)) {
      errors.push('boundaries must be an array');
    } else {
      for (const b of policy.boundaries) {
        if (!b.module) errors.push('Boundary missing module path');
        if (!Array.isArray(b.canImportFrom)) errors.push(`Boundary ${b.module}: canImportFrom must be array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Policy ↔ DriftDetector Conversion ──────────────────────────────────────

/**
 * Convert policy to drift-detector format (layers + allowed imports).
 *
 * @param {ArchitecturePolicy} policy
 * @returns {{ layers: Array, allowed: Object }}
 */
export function policyToLayers(policy) {
  if (!policy?.layers || !policy?.rules) {
    return { layers: [], allowed: {} };
  }

  // Build layer definitions with dirs
  const layers = policy.layers.map(name => {
    const dirs = [];
    // From fileStructure
    if (policy.fileStructure?.[name]) {
      const dir = path.basename(policy.fileStructure[name]);
      if (dir) dirs.push(dir);
    }
    // From known dir mappings
    if (LAYER_DIR_MAP[name]) {
      for (const d of LAYER_DIR_MAP[name]) {
        if (!dirs.includes(d)) dirs.push(d);
      }
    }
    // Fallback: use layer name itself
    if (dirs.length === 0) dirs.push(name);
    return { name, dirs };
  });

  // Build allowed imports map
  const allowed = {};
  for (const layer of policy.layers) {
    const rule = policy.rules.find(r => r.from === layer);
    if (rule?.canImport) {
      allowed[layer] = [...rule.canImport];
    } else {
      allowed[layer] = [];
    }
  }

  return { layers, allowed };
}

// ─── Policy ↔ ACF Conversion ────────────────────────────────────────────────

/**
 * Convert policy to ACF (ARCHITECTURE.json) format.
 *
 * @param {ArchitecturePolicy} policy
 * @returns {Object} ACF contract
 */
export function policyToACF(policy) {
  if (!policy) return null;

  return {
    layers: policy.layers || [],
    rules: (policy.rules || []).map(r => ({
      from: r.from,
      canImport: r.canImport || [],
      cannotImport: r.cannotImport || [],
    })),
    fileStructure: policy.fileStructure || {},
  };
}

/**
 * Convert ACF (ARCHITECTURE.json) to policy format.
 *
 * @param {Object} acf - ARCHITECTURE.json content
 * @returns {ArchitecturePolicy}
 */
export function acfToPolicy(acf) {
  return {
    layers: acf.layers || [],
    rules: (acf.rules || []).map(r => ({
      from: r.from,
      canImport: r.canImport,
      cannotImport: r.cannotImport,
    })),
    fileStructure: acf.fileStructure || {},
  };
}

// ─── Save Policy ────────────────────────────────────────────────────────────

/**
 * Save policy to .c3/architecture-policy.json.
 *
 * @param {string} projectPath
 * @param {ArchitecturePolicy} policy
 */
export async function savePolicy(projectPath, policy) {
  const dir = path.join(projectPath, POLICY_DIR);
  try { await mkdir(dir, { recursive: true }); } catch { /* exists */ }
  const filePath = path.join(dir, POLICY_FILENAME);
  await writeFile(filePath, JSON.stringify(policy, null, 2), 'utf-8');
  logger.info('ArchPolicy', `Policy saved to ${filePath}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _defaultPolicy() {
  return {
    layers: Object.keys(LAYER_DIR_MAP),
    rules: DEFAULT_RULES,
  };
}

function _generateRulesForLayers(layers) {
  // Standard top-down: each layer can import layers below it
  // Plus util/common is always allowed
  const rules = [];
  const hasUtil = layers.includes('util') || layers.includes('common') || layers.includes('shared');
  const utilLayers = layers.filter(l => ['util', 'common', 'shared', 'helpers', 'lib'].includes(l));

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (utilLayers.includes(layer)) {
      rules.push({ from: layer, canImport: [] });
      continue;
    }

    const canImport = [];
    // Can import layers below (higher index = lower layer)
    for (let j = i + 1; j < layers.length; j++) {
      canImport.push(layers[j]);
    }
    // Always allow util layers
    for (const u of utilLayers) {
      if (!canImport.includes(u)) canImport.push(u);
    }

    rules.push({ from: layer, canImport });
  }

  return rules;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  loadPolicy,
  generatePolicy,
  validatePolicy,
  policyToLayers,
  policyToACF,
  acfToPolicy,
  savePolicy,
};
