import {
  M1_TERMINAL_STATUS,
  TERMINAL_STATUSES,
  hasOwn,
  isIdentifier,
  isJsonValue,
  isNonEmptyString,
  isPlainRecord,
  validateError,
  validateExactKeys,
} from './shared.js';

function validateConversationResponse(value) {
  const errors = validateExactKeys(value, ['content'], ['metadata'], 'response');
  if (!isPlainRecord(value)) return errors;
  if (!isNonEmptyString(value.content)) errors.push('response:invalid-content');
  if (hasOwn(value, 'metadata') && !isJsonValue(value.metadata)) {
    errors.push('response:invalid-metadata');
  }
  return errors;
}

function validateModelResponse(value) {
  const errors = validateExactKeys(
    value,
    ['content', 'model'],
    ['usage'],
    'response',
  );
  if (!isPlainRecord(value)) return errors;
  if (!isNonEmptyString(value.content)) errors.push('response:invalid-content');
  if (!isNonEmptyString(value.model)) errors.push('response:invalid-model');
  if (hasOwn(value, 'usage') && !isJsonValue(value.usage)) {
    errors.push('response:invalid-usage');
  }
  return errors;
}

const RESPONSE_VALIDATORS = Object.freeze({
  conversation: validateConversationResponse,
  model: validateModelResponse,
});

function validateToolResult(value, index) {
  const context = `partial.toolResults[${index}]`;
  const errors = validateExactKeys(
    value,
    ['toolCallId', 'tool', 'status'],
    ['summary', 'error'],
    context,
  );
  if (!isPlainRecord(value)) return errors;

  if (!isIdentifier(value.toolCallId)) errors.push(`${context}:invalid-toolCallId`);
  if (!isNonEmptyString(value.tool)) errors.push(`${context}:invalid-tool`);
  if (!['ok', 'error'].includes(value.status)) errors.push(`${context}:invalid-status`);

  if (value.status === 'ok') {
    if (!isNonEmptyString(value.summary)) errors.push(`${context}:invalid-summary`);
    if (hasOwn(value, 'error')) errors.push(`${context}:error-on-ok`);
  } else if (value.status === 'error') {
    if (!hasOwn(value, 'error')) errors.push(`${context}:missing-error`);
    else errors.push(...validateError(value.error, `${context}.error`));
    if (hasOwn(value, 'summary')) errors.push(`${context}:summary-on-error`);
  }
  return errors;
}

function validatePartial(value) {
  const errors = validateExactKeys(value, ['toolResults'], [], 'partial');
  if (!isPlainRecord(value)) return errors;
  if (!Array.isArray(value.toolResults) || value.toolResults.length === 0) {
    errors.push('partial:invalid-toolResults');
    return errors;
  }
  value.toolResults.forEach((item, index) => {
    errors.push(...validateToolResult(item, index));
  });
  return errors;
}

/**
 * Central terminal seam for M1. Switching either D-1 or D-2 must happen here
 * and in the connector-specific response validator, never in a renderer.
 */
export function classifyTerminal(value, options = {}) {
  const {
    allowPartial = false,
    priorStatus = null,
    responseKind = null,
  } = options;
  const errors = [];
  if (!isPlainRecord(value)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['terminal:not-object']),
      status: null,
      renderAssistant: false,
      persistAssistant: false,
      persistPartialToolResults: false,
      acceptLateAssistant: false,
    });
  }

  const status = value.status;
  if (!TERMINAL_STATUSES.includes(status)) errors.push('terminal:invalid-status');
  if (priorStatus !== null) {
    if (!TERMINAL_STATUSES.includes(priorStatus)) {
      errors.push('terminal:invalid-prior-status');
    } else {
      errors.push('terminal:already-final');
      if (
        priorStatus === M1_TERMINAL_STATUS.CANCELLED
        && status === M1_TERMINAL_STATUS.OK
      ) errors.push('terminal:late-assistant-after-cancel');
    }
  }
  const hasResponse = hasOwn(value, 'response');
  const hasError = hasOwn(value, 'error');
  const hasPartial = hasOwn(value, 'partial');

  if (status === M1_TERMINAL_STATUS.OK) {
    if (!hasResponse) errors.push('terminal:missing-response');
    else if (!hasOwn(RESPONSE_VALIDATORS, responseKind)) {
      errors.push('terminal:invalid-response-kind');
    } else {
      errors.push(...RESPONSE_VALIDATORS[responseKind](value.response));
    }
    if (hasError) errors.push('terminal:error-on-ok');
    if (hasPartial) errors.push('terminal:partial-on-ok');
  } else if (TERMINAL_STATUSES.includes(status)) {
    if (hasResponse) errors.push('terminal:response-on-error');
    if (!hasError) errors.push('terminal:missing-error');
    else errors.push(...validateError(value.error, 'terminal.error'));
    if (hasPartial) {
      if (!allowPartial || status !== M1_TERMINAL_STATUS.ERROR) {
        errors.push('terminal:partial-not-allowed');
      } else {
        errors.push(...validatePartial(value.partial));
      }
    }
  }

  const valid = errors.length === 0;
  return Object.freeze({
    valid,
    errors: Object.freeze(errors),
    status: valid ? status : null,
    renderAssistant: valid && status === M1_TERMINAL_STATUS.OK,
    persistAssistant: valid && status === M1_TERMINAL_STATUS.OK,
    persistPartialToolResults: valid
      && status === M1_TERMINAL_STATUS.ERROR
      && hasPartial,
    acceptLateAssistant: false,
  });
}
