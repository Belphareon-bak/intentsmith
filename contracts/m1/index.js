import {
  M1_CONTRACT_KIND,
  M1_CONTRACT_STAGE,
  M1_CONTRACT_VERSION,
  M1_MODEL_PURPOSE,
  M1_TERMINAL_STATUS,
  MODEL_PURPOSES,
  hasOwn,
  isIdentifier,
  isJsonValue,
  isNonEmptyString,
  isPlainRecord,
  validateExactKeys,
  validateIdentity,
  validationResult,
} from './shared.js';
import { classifyTerminal } from './terminal.js';

export {
  M1_CONTRACT_KIND,
  M1_CONTRACT_STAGE,
  M1_CONTRACT_VERSION,
  M1_MODEL_PURPOSE,
  M1_TERMINAL_STATUS,
  classifyTerminal,
};

export function validateConversationCommand(value) {
  const action = isPlainRecord(value) ? value.action : null;
  const required = [
    'contract',
    'version',
    'requestId',
    'conversationId',
    'turnId',
    'action',
  ];
  if (action === 'send') required.push('input');
  const errors = validateExactKeys(value, required, [], 'conversation-command');
  if (!isPlainRecord(value)) return validationResult(errors, value);
  errors.push(...validateIdentity(
    value,
    M1_CONTRACT_KIND.CONVERSATION_COMMAND,
    'conversation-command',
  ));
  if (!['send', 'cancel'].includes(action)) {
    errors.push('conversation-command:invalid-action');
  }
  if (action === 'send' && !isNonEmptyString(value.input)) {
    errors.push('conversation-command:invalid-input');
  }
  return validationResult(errors, value);
}

export function validateConversationResult(value) {
  const required = [
    'contract',
    'version',
    'requestId',
    'conversationId',
    'turnId',
    'status',
  ];
  const errors = validateExactKeys(
    value,
    required,
    ['response', 'error', 'partial'],
    'conversation-result',
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  errors.push(...validateIdentity(
    value,
    M1_CONTRACT_KIND.CONVERSATION_RESULT,
    'conversation-result',
  ));
  const terminal = classifyTerminal(value, {
    allowPartial: true,
    responseKind: 'conversation',
  });
  errors.push(...terminal.errors);
  return validationResult(errors, value);
}

export function validateModelRequest(value) {
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'requestId',
      'conversationId',
      'turnId',
      'callerRole',
      'modelRole',
      'purpose',
      'prompt',
    ],
    ['systemPrompt', 'parameters'],
    'model-request',
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  errors.push(...validateIdentity(
    value,
    M1_CONTRACT_KIND.MODEL_REQUEST,
    'model-request',
  ));
  if (!isNonEmptyString(value.callerRole)) errors.push('model-request:invalid-callerRole');
  if (!isNonEmptyString(value.modelRole)) errors.push('model-request:invalid-modelRole');
  if (!MODEL_PURPOSES.includes(value.purpose)) errors.push('model-request:invalid-purpose');
  if (!isNonEmptyString(value.prompt)) errors.push('model-request:invalid-prompt');
  if (hasOwn(value, 'systemPrompt') && typeof value.systemPrompt !== 'string') {
    errors.push('model-request:invalid-systemPrompt');
  }
  if (hasOwn(value, 'parameters') && !isJsonValue(value.parameters)) {
    errors.push('model-request:invalid-parameters');
  }
  return validationResult(errors, value);
}

export function validateModelResult(value) {
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'requestId',
      'conversationId',
      'turnId',
      'status',
    ],
    ['response', 'error'],
    'model-result',
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  errors.push(...validateIdentity(
    value,
    M1_CONTRACT_KIND.MODEL_RESULT,
    'model-result',
  ));
  const terminal = classifyTerminal(value, {
    responseKind: 'model',
  });
  errors.push(...terminal.errors);
  return validationResult(errors, value);
}

function validateCoreEventPayload(value, phase, event) {
  const errors = [];
  if (!isPlainRecord(value) || !isJsonValue(value)) {
    return ['core-event:invalid-payload'];
  }
  if (phase !== 'terminal') return errors;

  errors.push(...validateExactKeys(value, ['result'], [], 'core-event.payload'));
  if (!hasOwn(value, 'result')) return errors;
  const result = validateConversationResult(value.result);
  errors.push(...result.errors.map(error => `core-event.payload.${error}`));
  if (result.valid) {
    for (const key of ['requestId', 'conversationId', 'turnId']) {
      if (value.result[key] !== event[key]) {
        errors.push(`core-event:foreign-${key}`);
      }
    }
    if (value.result.status !== event.terminalStatus) {
      errors.push('core-event:terminal-status-mismatch');
    }
  }
  return errors;
}

export function validateCoreEvent(value) {
  const phase = isPlainRecord(value) ? value.phase : null;
  const required = [
    'contract',
    'version',
    'requestId',
    'conversationId',
    'turnId',
    'sequence',
    'phase',
    'eventType',
    'payload',
  ];
  if (phase === 'terminal') required.push('terminalStatus');
  const errors = validateExactKeys(value, required, [], 'core-event');
  if (!isPlainRecord(value)) return validationResult(errors, value);
  errors.push(...validateIdentity(
    value,
    M1_CONTRACT_KIND.CORE_EVENT,
    'core-event',
  ));
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    errors.push('core-event:invalid-sequence');
  }
  if (!['progress', 'terminal'].includes(phase)) {
    errors.push('core-event:invalid-phase');
  }
  if (!isIdentifier(value.eventType)) errors.push('core-event:invalid-eventType');
  if (phase === 'terminal') {
    if (value.eventType !== 'result') errors.push('core-event:terminal-eventType');
    if (!Object.values(M1_TERMINAL_STATUS).includes(value.terminalStatus)) {
      errors.push('core-event:invalid-terminalStatus');
    }
  }
  errors.push(...validateCoreEventPayload(value.payload, phase, value));
  return validationResult(errors, value);
}

export function validateCoreEventStream(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return validationResult(['core-event-stream:empty'], events);
  }
  const errors = [];
  const first = isPlainRecord(events[0]) ? events[0] : null;
  let previousSequence = 0;
  let terminalCount = 0;

  events.forEach((event, index) => {
    const result = validateCoreEvent(event);
    errors.push(...result.errors.map(error => `core-event-stream[${index}]:${error}`));
    if (!result.valid) return;

    if (index > 0 && first !== null) {
      for (const key of ['requestId', 'conversationId', 'turnId']) {
        if (event[key] !== first[key]) {
          errors.push(`core-event-stream[${index}]:foreign-${key}`);
        }
      }
    }
    if (event.sequence <= previousSequence) {
      errors.push(`core-event-stream[${index}]:out-of-order-sequence`);
    }
    previousSequence = event.sequence;
    if (event.phase === 'terminal') {
      terminalCount += 1;
      if (index !== events.length - 1) {
        errors.push(`core-event-stream[${index}]:event-after-terminal`);
      }
    }
  });

  if (terminalCount === 0) errors.push('core-event-stream:missing-terminal');
  if (terminalCount > 1) errors.push('core-event-stream:duplicate-terminal');
  return validationResult(errors, events);
}

const VALIDATORS = Object.freeze({
  [M1_CONTRACT_KIND.CONVERSATION_COMMAND]: validateConversationCommand,
  [M1_CONTRACT_KIND.CONVERSATION_RESULT]: validateConversationResult,
  [M1_CONTRACT_KIND.MODEL_REQUEST]: validateModelRequest,
  [M1_CONTRACT_KIND.MODEL_RESULT]: validateModelResult,
  [M1_CONTRACT_KIND.CORE_EVENT]: validateCoreEvent,
});

export function validateM1Contract(value, expectedContract = null) {
  if (!isPlainRecord(value)) return validationResult(['m1:not-object'], value);
  if (expectedContract !== null && value.contract !== expectedContract) {
    return validationResult(['m1:unexpected-contract'], value);
  }
  const validator = VALIDATORS[value.contract];
  if (!validator) return validationResult(['m1:unknown-contract'], value);
  return validator(value);
}

export function encodeM1Contract(value, expectedContract = null) {
  const result = validateM1Contract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return JSON.stringify(value);
}

export function decodeM1Contract(encoded, expectedContract = null) {
  if (typeof encoded !== 'string') throw new TypeError('m1:encoded-not-string');
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new TypeError('m1:invalid-json');
  }
  const result = validateM1Contract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return value;
}
