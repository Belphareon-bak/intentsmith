export const M1_CONTRACT_VERSION = 1;
export const M1_CONTRACT_STAGE = 'PROVISIONAL_V1';

export const M1_CONTRACT_KIND = Object.freeze({
  CONVERSATION_COMMAND: 'ConversationCommand',
  CONVERSATION_RESULT: 'ConversationResult',
  MODEL_REQUEST: 'ModelRequest',
  MODEL_RESULT: 'ModelResult',
  CORE_EVENT: 'CoreEvent',
});

export const M1_TERMINAL_STATUS = Object.freeze({
  OK: 'ok',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
  ERROR: 'error',
});

export const M1_MODEL_PURPOSE = Object.freeze({
  CLASSIFY: 'classify',
  ANSWER: 'answer',
  SYNTHESIZE: 'synthesize',
  REFINE: 'refine',
});

export const TERMINAL_STATUSES = Object.freeze(
  Object.values(M1_TERMINAL_STATUS),
);

export const MODEL_PURPOSES = Object.freeze(
  Object.values(M1_MODEL_PURPOSE),
);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,63}$/;

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

export function validateExactKeys(value, required, optional, context) {
  if (!isPlainRecord(value)) return [`${context}:not-object`];

  const requiredSet = new Set(required);
  const allowed = new Set([...required, ...optional]);
  const errors = [];
  for (const key of requiredSet) {
    if (!hasOwn(value, key)) errors.push(`${context}:missing-${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${context}:unknown-${key}`);
  }
  return errors;
}

export function validateIdentity(value, expectedContract, context) {
  const errors = [];
  if (value.contract !== expectedContract) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M1_CONTRACT_VERSION) {
    errors.push(`${context}:invalid-version`);
  }
  for (const key of ['requestId', 'conversationId', 'turnId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  return errors;
}

export function validateError(value, context) {
  const errors = validateExactKeys(
    value,
    ['code', 'message'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (typeof value.code !== 'string' || !ERROR_CODE_PATTERN.test(value.code)) {
    errors.push(`${context}:invalid-code`);
  }
  if (!isNonEmptyString(value.message)) errors.push(`${context}:invalid-message`);
  return errors;
}

export function isJsonValue(value, seen = new Set(), depth = 0) {
  if (depth > 32) return false;
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;

  seen.add(value);
  let valid;
  if (Array.isArray(value)) {
    valid = value.every(item => isJsonValue(item, seen, depth + 1));
  } else if (isPlainRecord(value)) {
    valid = Object.entries(value).every(
      ([key, item]) => key.length > 0 && isJsonValue(item, seen, depth + 1),
    );
  } else {
    valid = false;
  }
  seen.delete(value);
  return valid;
}

export function validationResult(errors, value) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...errors]),
    value: errors.length === 0 ? value : null,
  });
}
