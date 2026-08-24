import { createHash } from 'node:crypto';

import {
  isIdentifier,
  isJsonValue,
  isNonEmptyString,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M2_TOOL_CONTRACT_VERSION = 1;
export const M2_TOOL_CONTRACT_STAGE = 'CANDIDATE_V1';

export const M2_TOOL_CONTRACT_KIND = Object.freeze({
  REQUEST: 'ToolRequest',
  RESULT: 'ToolResult',
});

export const M2_TOOL_RISK_CLASS = Object.freeze({
  PURE: 'pure',
  READ: 'read',
  WRITE: 'write',
  NETWORK: 'network',
  EXEC: 'exec',
  DESTRUCTIVE: 'destructive',
});

export const M2_TOOL_AUTHORITY_MODE = Object.freeze({
  DIRECT: 'direct',
  EFFECT: 'effect',
  UNAVAILABLE: 'unavailable',
});

export const M2_TOOL_TERMINAL_STATUS = Object.freeze({
  OK: 'ok',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
  ORPHANED: 'orphaned',
});

export const M2_TOOL_ERROR_CODE = Object.freeze({
  CANCELLED: 'TOOL_CANCELLED',
  TIMEOUT: 'TOOL_TIMEOUT',
  INPUT_INVALID: 'TOOL_INPUT_INVALID',
  OUTPUT_INVALID: 'TOOL_OUTPUT_INVALID',
  UNKNOWN: 'TOOL_UNKNOWN',
  EFFECT_AUTHORITY_REQUIRED: 'TOOL_EFFECT_AUTHORITY_REQUIRED',
  EFFECT_AUTHORITY_UNAVAILABLE: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
  EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
});

const RISK_CLASSES = new Set(Object.values(M2_TOOL_RISK_CLASS));
const AUTHORITY_MODES = new Set(Object.values(M2_TOOL_AUTHORITY_MODE));
const TERMINAL_STATUSES = new Set(Object.values(M2_TOOL_TERMINAL_STATUS));
const EFFECT_KINDS = new Set([
  'fs.read',
  'fs.write',
  'fs.delete',
  'process.exec',
  'network.request',
  'git.commit',
  'git.push',
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SCHEMA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,63}$/;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value, seen, depth) {
  if (depth > 32) throw new TypeError('m2-tool-canonical:too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('m2-tool-canonical:invalid-number');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('m2-tool-canonical:unsupported-value');
  }

  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (isPlainRecord(value)) {
    const normalizedFields = Object.keys(value)
      .map(key => ({ original: key, normalized: key.normalize('NFC') }))
      .sort((left, right) => compareUtf8(left.normalized, right.normalized));
    for (let index = 1; index < normalizedFields.length; index += 1) {
      if (normalizedFields[index - 1].normalized === normalizedFields[index].normalized) {
        seen.delete(value);
        throw new TypeError('m2-tool-canonical:normalized-key-collision');
      }
    }
    const fields = normalizedFields
      .map(({ original, normalized }) => (
        `${JSON.stringify(normalized)}:${canonicalize(value[original], seen, depth + 1)}`
      ));
    serialized = `{${fields.join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('m2-tool-canonical:unsupported-object');
  }
  seen.delete(value);
  return serialized;
}

export function canonicalizeM2ToolValue(value) {
  if (!isJsonValue(value)) throw new TypeError('m2-tool-canonical:not-json');
  return canonicalize(value, new Set(), 0);
}

/**
 * Materialize the exact JSON value represented by the canonical wire bytes.
 * Callers use this before deriving identities, bindings, or invoking a tool so
 * persistence cannot silently change the bytes after authority was computed.
 */
export function normalizeM2ToolValue(value) {
  return JSON.parse(canonicalizeM2ToolValue(value));
}

export function computeM2ToolValueDigest(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM2ToolValue(value), 'utf8')
    .digest('hex')}`;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isProjectId(value) {
  return value === null || (Number.isSafeInteger(value) && value > 0);
}

function isSchemaId(value) {
  return typeof value === 'string' && SCHEMA_PATTERN.test(value);
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function validateActor(value) {
  const context = 'tool-request.actor';
  const errors = validateExactKeys(value, ['type', 'id'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!['user', 'system', 'model', 'specialist'].includes(value.type)) {
    errors.push(`${context}:invalid-type`);
  }
  if (!isIdentifier(value.id)) errors.push(`${context}:invalid-id`);
  return errors;
}

function validateOrigin(value) {
  const context = 'tool-request.origin';
  const errors = validateExactKeys(
    value,
    ['surface', 'sessionId', 'conversationId', 'projectId'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!['http', 'ws', 'studio', 'skill', 'lifecycle'].includes(value.surface)) {
    errors.push(`${context}:invalid-surface`);
  }
  for (const key of ['sessionId', 'conversationId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  return errors;
}

function validateErrorValue(value, context) {
  const errors = validateExactKeys(value, ['code', 'message', 'retryable'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (typeof value.code !== 'string' || !ERROR_CODE_PATTERN.test(value.code)) {
    errors.push(`${context}:invalid-code`);
  }
  if (!isNonEmptyString(value.message) || value.message.length > 4096) {
    errors.push(`${context}:invalid-message`);
  }
  if (typeof value.retryable !== 'boolean') errors.push(`${context}:invalid-retryable`);
  return errors;
}

function validateEffectBinding(value) {
  const context = 'tool-request.effectBinding';
  if (value === null) return [];
  const errors = validateExactKeys(value, [
    'kind', 'target', 'payloadDigest', 'payloadBytes', 'requiredCapability', 'riskClass',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!EFFECT_KINDS.has(value.kind)) errors.push(`${context}:invalid-kind`);
  if (!isPlainRecord(value.target) || !isJsonValue(value.target)) {
    errors.push(`${context}:invalid-target`);
  } else {
    try {
      if (Buffer.byteLength(canonicalizeM2ToolValue(value.target), 'utf8') > 65_536) {
        errors.push(`${context}:target-too-large`);
      }
    } catch {
      errors.push(`${context}:invalid-target-canonical-form`);
    }
  }
  if (!isDigest(value.payloadDigest)) errors.push(`${context}:invalid-payloadDigest`);
  if (!Number.isSafeInteger(value.payloadBytes) || value.payloadBytes < 0 || value.payloadBytes > 1_048_576) {
    errors.push(`${context}:invalid-payloadBytes`);
  }
  if (!isIdentifier(value.requiredCapability)) {
    errors.push(`${context}:invalid-requiredCapability`);
  }
  if (!RISK_CLASSES.has(value.riskClass) || value.riskClass === M2_TOOL_RISK_CLASS.PURE) {
    errors.push(`${context}:invalid-riskClass`);
  }
  return errors;
}

export function validateM2ToolRequest(value) {
  const context = 'tool-request';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'requestId', 'runId', 'actor', 'origin',
    'toolId', 'toolVersion', 'riskClass', 'authorityMode', 'inputSchema',
    'outputSchema', 'input', 'inputDigest', 'requiredEffectKind', 'effectBinding',
    'timeoutMs', 'idempotencyKey',
    'createdAt',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_TOOL_CONTRACT_KIND.REQUEST) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_TOOL_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['requestId', 'runId', 'toolId', 'idempotencyKey']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.toolVersion) || value.toolVersion < 1) {
    errors.push(`${context}:invalid-toolVersion`);
  }
  errors.push(...validateActor(value.actor));
  errors.push(...validateOrigin(value.origin));
  if (!RISK_CLASSES.has(value.riskClass)) errors.push(`${context}:invalid-riskClass`);
  if (!AUTHORITY_MODES.has(value.authorityMode)) errors.push(`${context}:invalid-authorityMode`);
  if (!isSchemaId(value.inputSchema)) errors.push(`${context}:invalid-inputSchema`);
  if (!isSchemaId(value.outputSchema)) errors.push(`${context}:invalid-outputSchema`);
  if (!isJsonValue(value.input)) {
    errors.push(`${context}:invalid-input`);
  } else {
    try {
      if (Buffer.byteLength(canonicalizeM2ToolValue(value.input), 'utf8') > 1_048_576) {
        errors.push(`${context}:input-too-large`);
      }
      if (computeM2ToolValueDigest(value.input) !== value.inputDigest) {
        errors.push(`${context}:input-digest-mismatch`);
      }
    } catch {
      errors.push(`${context}:invalid-input-canonical-form`);
    }
  }
  if (!isDigest(value.inputDigest)) errors.push(`${context}:invalid-inputDigest`);
  if (!(value.requiredEffectKind === null || EFFECT_KINDS.has(value.requiredEffectKind))) {
    errors.push(`${context}:invalid-requiredEffectKind`);
  }
  errors.push(...validateEffectBinding(value.effectBinding));
  if (value.authorityMode === M2_TOOL_AUTHORITY_MODE.DIRECT && (
    value.riskClass !== M2_TOOL_RISK_CLASS.PURE
    || value.requiredEffectKind !== null
    || value.effectBinding !== null
  )) errors.push(`${context}:invalid-direct-authority`);
  if (value.authorityMode === M2_TOOL_AUTHORITY_MODE.EFFECT && (
    value.riskClass === M2_TOOL_RISK_CLASS.PURE
    || value.requiredEffectKind === null
    || value.effectBinding === null
    || value.effectBinding?.kind !== value.requiredEffectKind
    || value.effectBinding?.riskClass !== value.riskClass
  )) errors.push(`${context}:invalid-effect-authority`);
  if (value.authorityMode === M2_TOOL_AUTHORITY_MODE.UNAVAILABLE && (
    value.riskClass === M2_TOOL_RISK_CLASS.PURE
    || value.requiredEffectKind === null
    || value.effectBinding !== null
  )) errors.push(`${context}:invalid-unavailable-authority`);
  if (value.authorityMode !== M2_TOOL_AUTHORITY_MODE.DIRECT && value.actor?.type !== 'user') {
    errors.push(`${context}:effectful-tool-requires-user`);
  }
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 300_000) {
    errors.push(`${context}:invalid-timeoutMs`);
  }
  if (!isCanonicalTimestamp(value.createdAt)) errors.push(`${context}:invalid-createdAt`);
  return validationResult(errors, value);
}

export function validateM2ToolResult(value) {
  const context = 'tool-result';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'requestId', 'requestDigest', 'runId', 'projectId', 'toolId',
    'toolVersion', 'status', 'outputSchema', 'output', 'outputDigest',
    'effectRequestId', 'error', 'startedAt', 'completedAt', 'evidenceRefs',
    'lateCompletionRejected',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_TOOL_CONTRACT_KIND.RESULT) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_TOOL_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['requestId', 'runId', 'toolId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!isDigest(value.requestDigest)) errors.push(`${context}:invalid-requestDigest`);
  if (!isProjectId(value.projectId)) errors.push(`${context}:invalid-projectId`);
  if (!Number.isSafeInteger(value.toolVersion) || value.toolVersion < 1) {
    errors.push(`${context}:invalid-toolVersion`);
  }
  if (!TERMINAL_STATUSES.has(value.status)) errors.push(`${context}:invalid-status`);
  if (!isSchemaId(value.outputSchema)) errors.push(`${context}:invalid-outputSchema`);
  if (!(value.effectRequestId === null || isIdentifier(value.effectRequestId))) {
    errors.push(`${context}:invalid-effectRequestId`);
  }
  if (!isCanonicalTimestamp(value.startedAt) || !isCanonicalTimestamp(value.completedAt)) {
    errors.push(`${context}:invalid-timestamp`);
  } else if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    errors.push(`${context}:completed-before-started`);
  }
  if (!Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length > 64
    || value.evidenceRefs.some(item => !isNonEmptyString(item) || item.length > 4096)) {
    errors.push(`${context}:invalid-evidenceRefs`);
  } else {
    for (let index = 1; index < value.evidenceRefs.length; index += 1) {
      if (compareUtf8(value.evidenceRefs[index - 1], value.evidenceRefs[index]) >= 0) {
        errors.push(`${context}:evidenceRefs-not-bytewise-sorted-unique`);
        break;
      }
    }
  }
  if (typeof value.lateCompletionRejected !== 'boolean') {
    errors.push(`${context}:invalid-lateCompletionRejected`);
  }

  if (value.status === M2_TOOL_TERMINAL_STATUS.OK) {
    if (!isJsonValue(value.output)) {
      errors.push(`${context}:invalid-output`);
    } else {
      try {
        const canonicalOutput = canonicalizeM2ToolValue(value.output);
        if (Buffer.byteLength(canonicalOutput, 'utf8') > 1_048_576) {
          errors.push(`${context}:output-too-large`);
        }
        if (computeM2ToolValueDigest(value.output) !== value.outputDigest) {
          errors.push(`${context}:output-digest-mismatch`);
        }
      } catch {
        errors.push(`${context}:invalid-output-canonical-form`);
      }
    }
    if (!isDigest(value.outputDigest)) errors.push(`${context}:invalid-outputDigest`);
    if (value.error !== null) errors.push(`${context}:success-with-error`);
  } else {
    if (value.output !== null || value.outputDigest !== null) {
      errors.push(`${context}:failure-with-output`);
    }
    errors.push(...validateErrorValue(value.error, `${context}.error`));
  }
  return validationResult(errors, value);
}

export function computeM2ToolRequestDigest(value) {
  const result = validateM2ToolRequest(value);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return computeM2ToolValueDigest(value);
}

export function validateM2ToolContract(value, expectedContract = null) {
  if (!isPlainRecord(value)) return validationResult(['m2-tool:not-object'], value);
  if (expectedContract && value.contract !== expectedContract) {
    return validationResult(['m2-tool:unexpected-contract'], value);
  }
  if (value.contract === M2_TOOL_CONTRACT_KIND.REQUEST) return validateM2ToolRequest(value);
  if (value.contract === M2_TOOL_CONTRACT_KIND.RESULT) return validateM2ToolResult(value);
  return validationResult(['m2-tool:unknown-contract'], value);
}

export function encodeM2ToolContract(value, expectedContract = null) {
  const result = validateM2ToolContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return Buffer.from(canonicalizeM2ToolValue(value), 'utf8');
}

export function decodeM2ToolContract(encoded, expectedContract = null) {
  if (!(typeof encoded === 'string' || Buffer.isBuffer(encoded) || encoded instanceof Uint8Array)) {
    throw new TypeError('m2-tool-decode:invalid-bytes');
  }
  const bytes = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
  if (bytes.length === 0 || bytes.length > 1_048_576) {
    throw new TypeError('m2-tool-decode:invalid-size');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('m2-tool-decode:invalid-utf8');
  const value = JSON.parse(text);
  const result = validateM2ToolContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return Object.freeze(value);
}

export const _testInternals = Object.freeze({
  isCanonicalTimestamp,
  isDigest,
  isSchemaId,
});
