// Contract Validation — Runtime Enforcement
// ══════════════════════════════════════════════════════════════════════════════
//
// Runtime validation of data against JSON Schema contracts.
//
// This is NOT test-time validation — this runs in production.
// Invalid data → throw error → fail fast.
//
// Contracts are loaded from JSON Schema files in this directory.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA CACHE
// ════════════════════════════════════════════════════════════════════════════

const schemaCache = new Map();

/**
 * Load a schema from file (cached)
 *
 * @param {string} schemaId - Schema identifier (e.g., 'planner-output')
 * @returns {Object} Parsed JSON Schema
 */
function loadSchema(schemaId) {
  if (schemaCache.has(schemaId)) {
    return schemaCache.get(schemaId);
  }

  const schemaPath = join(__dirname, `${schemaId}.schema.json`);

  try {
    const content = readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(content);
    schemaCache.set(schemaId, schema);
    return schema;
  } catch (err) {
    throw new ValidationError('SCHEMA_LOAD', `Failed to load schema "${schemaId}": ${err.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Custom error for validation failures
 */
export class ValidationError extends Error {
  constructor(source, message) {
    super(`[${source}] ${message}`);
    this.name = 'ValidationError';
    this.source = source;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate data against a contract schema
 *
 * @param {string} schemaId - Schema identifier (e.g., 'planner-output')
 * @param {any} data - Data to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(schemaId, data) {
  const schema = loadSchema(schemaId);
  const errors = [];

  // Pass rootSchema for $defs resolution
  validateObject(data, schema, '', errors, schema);

  if (errors.length > 0) {
    logger.warn('ContractValidation', `Validation failed for ${schemaId}`, { errors });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate and throw on failure (fail-fast)
 *
 * @param {string} schemaId - Schema identifier
 * @param {any} data - Data to validate
 * @throws {ValidationError} If validation fails
 */
export function validateOrThrow(schemaId, data) {
  const result = validate(schemaId, data);

  if (!result.valid) {
    throw new ValidationError(schemaId, result.errors.join('; '));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION (minimal JSON Schema validator)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate an object against a JSON Schema
 * Minimal implementation - supports core JSON Schema keywords
 *
 * @param {any} data - Data to validate
 * @param {Object} schema - Schema to validate against
 * @param {string} path - Current path for error messages
 * @param {string[]} errors - Accumulated errors
 * @param {Object} rootSchema - Root schema for $defs resolution
 */
function validateObject(data, schema, path, errors, rootSchema) {
  // Handle $ref references
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema);
    if (resolved) {
      validateObject(data, resolved, path, errors, rootSchema);
      return;
    }
  }

  // Type validation
  if (schema.type) {
    if (!validateType(data, schema.type, path, errors)) {
      return; // Stop validation if type is wrong
    }
  }

  // Enum validation
  if (schema.enum) {
    if (!schema.enum.includes(data)) {
      errors.push(`${path || 'root'}: must be one of [${schema.enum.join(', ')}], got "${data}"`);
    }
  }

  // String validations
  if (schema.type === 'string' && typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${path || 'root'}: string length must be >= ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`${path || 'root'}: string length must be <= ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(data)) {
        errors.push(`${path || 'root'}: must match pattern "${schema.pattern}"`);
      }
    }
  }

  // Number validations
  if (schema.type === 'number' && typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${path || 'root'}: must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${path || 'root'}: must be <= ${schema.maximum}`);
    }
  }

  // Array validations
  if (schema.type === 'array' && Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${path || 'root'}: array must have >= ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${path || 'root'}: array must have <= ${schema.maxItems} items`);
    }
    if (schema.items) {
      // Resolve $ref for item schema
      const itemSchema = schema.items.$ref
        ? resolveRef(schema.items.$ref, rootSchema)
        : schema.items;

      data.forEach((item, index) => {
        validateObject(item, itemSchema, `${path}[${index}]`, errors, rootSchema);
      });
    }
  }

  // Object validations
  if (schema.type === 'object' && typeof data === 'object' && data !== null) {
    // Required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (!(prop in data)) {
          errors.push(`${path || 'root'}: missing required property "${prop}"`);
        }
      }
    }

    // Property validation
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (prop in data) {
          // Resolve $ref for property schema
          const resolvedSchema = propSchema.$ref
            ? resolveRef(propSchema.$ref, rootSchema)
            : propSchema;

          validateObject(data[prop], resolvedSchema, `${path}.${prop}`, errors, rootSchema);
        }
      }
    }

    // Additional properties check
    if (schema.additionalProperties === false && schema.properties) {
      const allowedProps = new Set(Object.keys(schema.properties));
      for (const prop of Object.keys(data)) {
        if (!allowedProps.has(prop)) {
          errors.push(`${path || 'root'}: unexpected property "${prop}"`);
        }
      }
    }
  }
}

/**
 * Validate type
 */
function validateType(data, type, path, errors) {
  const actualType = getType(data);

  if (type !== actualType) {
    errors.push(`${path || 'root'}: expected ${type}, got ${actualType}`);
    return false;
  }

  return true;
}

/**
 * Get JSON Schema type of value
 */
function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Resolve $ref to schema from root schema's $defs
 *
 * @param {string} ref - Reference string (e.g., '#/$defs/PlannerStep')
 * @param {Object} rootSchema - Root schema containing $defs
 * @returns {Object|null} Resolved schema or null
 */
function resolveRef(ref, rootSchema) {
  if (ref.startsWith('#/$defs/')) {
    const defName = ref.replace('#/$defs/', '');
    return rootSchema?.$defs?.[defName] || null;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  validate,
  validateOrThrow,
  ValidationError,
};
