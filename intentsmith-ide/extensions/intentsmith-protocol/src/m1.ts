/**
 * IntentSmith M1 connector surface.
 *
 * This is the TypeScript consumer mirror of the canonical dependency-free
 * runtime validators in contracts/m1/. It is provisional until Review Gate 1.
 */

export const M1_CONTRACT_VERSION = 1 as const;
export const M1_CONTRACT_STAGE = 'PROVISIONAL_V1' as const;

export const M1_TERMINAL_STATUSES = [
  'ok',
  'cancelled',
  'timeout',
  'error',
] as const;

export const M1_MODEL_PURPOSES = [
  'classify',
  'answer',
  'synthesize',
  'refine',
] as const;

export type M1ContractVersion = typeof M1_CONTRACT_VERSION;
export type M1TerminalStatus = typeof M1_TERMINAL_STATUSES[number];
export type M1ModelPurpose = typeof M1_MODEL_PURPOSES[number];
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface M1Identity {
  version: M1ContractVersion;
  requestId: string;
  conversationId: string;
  turnId: string;
}

export interface M1Error {
  code: string;
  message: string;
}

export interface ConversationSendCommand extends M1Identity {
  contract: 'ConversationCommand';
  action: 'send';
  input: string;
}

export interface ConversationCancelCommand extends M1Identity {
  contract: 'ConversationCommand';
  action: 'cancel';
}

export type ConversationCommand =
  | ConversationSendCommand
  | ConversationCancelCommand;

export interface ConversationResponse {
  content: string;
  metadata?: JsonValue;
}

export interface PartialToolOkResult {
  toolCallId: string;
  tool: string;
  status: 'ok';
  summary: string;
}

export interface PartialToolErrorResult {
  toolCallId: string;
  tool: string;
  status: 'error';
  error: M1Error;
}

export type PartialToolResult = PartialToolOkResult | PartialToolErrorResult;

export interface PartialConversationResult {
  toolResults: PartialToolResult[];
}

export interface ConversationOkResult extends M1Identity {
  contract: 'ConversationResult';
  status: 'ok';
  response: ConversationResponse;
}

export interface ConversationCancelledOrTimeoutResult extends M1Identity {
  contract: 'ConversationResult';
  status: 'cancelled' | 'timeout';
  error: M1Error;
}

export interface ConversationErrorResult extends M1Identity {
  contract: 'ConversationResult';
  status: 'error';
  error: M1Error;
  partial?: PartialConversationResult;
}

export type ConversationResult =
  | ConversationOkResult
  | ConversationCancelledOrTimeoutResult
  | ConversationErrorResult;

export interface ModelRequest extends M1Identity {
  contract: 'ModelRequest';
  callerRole: string;
  modelRole: string;
  purpose: M1ModelPurpose;
  prompt: string;
  systemPrompt?: string;
  parameters?: JsonValue;
}

export interface ModelResponse {
  content: string;
  model: string;
  usage?: JsonValue;
}

export interface ModelOkResult extends M1Identity {
  contract: 'ModelResult';
  status: 'ok';
  response: ModelResponse;
}

export interface ModelFailureResult extends M1Identity {
  contract: 'ModelResult';
  status: 'cancelled' | 'timeout' | 'error';
  error: M1Error;
}

export type ModelResult = ModelOkResult | ModelFailureResult;

export interface CoreProgressEvent extends M1Identity {
  contract: 'CoreEvent';
  sequence: number;
  phase: 'progress';
  eventType: string;
  payload: { [key: string]: JsonValue };
}

export interface CoreTerminalEvent extends M1Identity {
  contract: 'CoreEvent';
  sequence: number;
  phase: 'terminal';
  eventType: 'result';
  terminalStatus: M1TerminalStatus;
  payload: {
    result: ConversationResult;
  };
}

export type CoreEvent = CoreProgressEvent | CoreTerminalEvent;

export type M1ContractEnvelope =
  | ConversationCommand
  | ConversationResult
  | ModelRequest
  | ModelResult
  | CoreEvent;

const M1_CONTRACT_NAMES = new Set<string>([
  'ConversationCommand',
  'ConversationResult',
  'ModelRequest',
  'ModelResult',
  'CoreEvent',
]);

const M1_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const M1_ERROR_CODE = /^[A-Z][A-Z0-9_:-]{0,63}$/;

export interface M1ValidationResult<T = M1ContractEnvelope> {
  valid: boolean;
  errors: readonly string[];
  value: T | null;
}

export interface M1TerminalClassification {
  valid: boolean;
  errors: readonly string[];
  status: M1TerminalStatus | null;
  renderAssistant: boolean;
  persistAssistant: boolean;
  persistPartialToolResults: boolean;
  acceptLateAssistant: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && M1_IDENTIFIER.test(value);
}

function exactKeys(
  value: unknown,
  required: string[],
  optional: string[],
  context: string,
): string[] {
  if (!isRecord(value)) return [`${context}:not-object`];
  const allowed = new Set([...required, ...optional]);
  const errors: string[] = [];
  for (const key of required) {
    if (!hasOwn(value, key)) errors.push(`${context}:missing-${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${context}:unknown-${key}`);
  }
  return errors;
}

function jsonValue(value: unknown, seen = new Set<unknown>(), depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  let valid = false;
  if (Array.isArray(value)) {
    valid = value.every(item => jsonValue(item, seen, depth + 1));
  } else if (isRecord(value)) {
    valid = Object.entries(value).every(
      ([key, item]) => key.length > 0 && jsonValue(item, seen, depth + 1),
    );
  }
  seen.delete(value);
  return valid;
}

function identityErrors(
  value: Record<string, unknown>,
  contract: string,
  context: string,
): string[] {
  const errors: string[] = [];
  if (value.contract !== contract) errors.push(`${context}:invalid-contract`);
  if (value.version !== M1_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  for (const key of ['requestId', 'conversationId', 'turnId']) {
    if (!identifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  return errors;
}

function errorErrors(value: unknown, context: string): string[] {
  const errors = exactKeys(value, ['code', 'message'], [], context);
  if (!isRecord(value)) return errors;
  if (typeof value.code !== 'string' || !M1_ERROR_CODE.test(value.code)) {
    errors.push(`${context}:invalid-code`);
  }
  if (!nonEmpty(value.message)) errors.push(`${context}:invalid-message`);
  return errors;
}

function partialErrors(value: unknown): string[] {
  const errors = exactKeys(value, ['toolResults'], [], 'partial');
  if (!isRecord(value)) return errors;
  if (!Array.isArray(value.toolResults) || value.toolResults.length === 0) {
    errors.push('partial:invalid-toolResults');
    return errors;
  }
  value.toolResults.forEach((item, index) => {
    const context = `partial.toolResults[${index}]`;
    errors.push(...exactKeys(item, ['toolCallId', 'tool', 'status'], ['summary', 'error'], context));
    if (!isRecord(item)) return;
    if (!identifier(item.toolCallId)) errors.push(`${context}:invalid-toolCallId`);
    if (!nonEmpty(item.tool)) errors.push(`${context}:invalid-tool`);
    if (!['ok', 'error'].includes(String(item.status))) errors.push(`${context}:invalid-status`);
    if (item.status === 'ok') {
      if (!nonEmpty(item.summary)) errors.push(`${context}:invalid-summary`);
      if (hasOwn(item, 'error')) errors.push(`${context}:error-on-ok`);
    } else if (item.status === 'error') {
      if (!hasOwn(item, 'error')) errors.push(`${context}:missing-error`);
      else errors.push(...errorErrors(item.error, `${context}.error`));
      if (hasOwn(item, 'summary')) errors.push(`${context}:summary-on-error`);
    }
  });
  return errors;
}

export function classifyTerminal(
  candidate: unknown,
  options: {
    allowPartial?: boolean;
    priorStatus?: M1TerminalStatus | null;
    responseKind?: 'conversation' | 'model';
  } = {},
): M1TerminalClassification {
  const errors: string[] = [];
  if (!isRecord(candidate)) {
    return {
      valid: false,
      errors: ['terminal:not-object'],
      status: null,
      renderAssistant: false,
      persistAssistant: false,
      persistPartialToolResults: false,
      acceptLateAssistant: false,
    };
  }
  const status = candidate.status;
  const terminalStatus = M1_TERMINAL_STATUSES.includes(status as M1TerminalStatus)
    ? status as M1TerminalStatus
    : null;
  if (terminalStatus === null) errors.push('terminal:invalid-status');
  const priorStatus = options.priorStatus ?? null;
  if (priorStatus !== null) {
    if (!M1_TERMINAL_STATUSES.includes(priorStatus)) {
      errors.push('terminal:invalid-prior-status');
    } else {
      errors.push('terminal:already-final');
      if (priorStatus === 'cancelled' && status === 'ok') {
        errors.push('terminal:late-assistant-after-cancel');
      }
    }
  }
  const hasResponse = hasOwn(candidate, 'response');
  const hasError = hasOwn(candidate, 'error');
  const hasPartial = hasOwn(candidate, 'partial');
  if (status === 'ok') {
    if (!hasResponse || !isRecord(candidate.response)) {
      errors.push('terminal:missing-response');
    } else if (options.responseKind === 'conversation') {
      errors.push(...exactKeys(candidate.response, ['content'], ['metadata'], 'response'));
      if (!nonEmpty(candidate.response.content)) errors.push('response:invalid-content');
      if (hasOwn(candidate.response, 'metadata') && !jsonValue(candidate.response.metadata)) {
        errors.push('response:invalid-metadata');
      }
    } else if (options.responseKind === 'model') {
      errors.push(...exactKeys(candidate.response, ['content', 'model'], ['usage'], 'response'));
      if (!nonEmpty(candidate.response.content)) errors.push('response:invalid-content');
      if (!nonEmpty(candidate.response.model)) errors.push('response:invalid-model');
      if (hasOwn(candidate.response, 'usage') && !jsonValue(candidate.response.usage)) {
        errors.push('response:invalid-usage');
      }
    } else {
      errors.push('terminal:invalid-response-kind');
    }
    if (hasError) errors.push('terminal:error-on-ok');
    if (hasPartial) errors.push('terminal:partial-on-ok');
  } else if (terminalStatus !== null) {
    if (hasResponse) errors.push('terminal:response-on-error');
    if (!hasError) errors.push('terminal:missing-error');
    else errors.push(...errorErrors(candidate.error, 'terminal.error'));
    if (hasPartial) {
      if (!options.allowPartial || status !== 'error') {
        errors.push('terminal:partial-not-allowed');
      } else {
        errors.push(...partialErrors(candidate.partial));
      }
    }
  }
  const valid = errors.length === 0;
  return {
    valid,
    errors,
    status: valid ? terminalStatus : null,
    renderAssistant: valid && status === 'ok',
    persistAssistant: valid && status === 'ok',
    persistPartialToolResults: valid && status === 'error' && hasPartial,
    acceptLateAssistant: false,
  };
}

function conversationCommandErrors(value: unknown): string[] {
  const action = isRecord(value) ? value.action : null;
  const required = ['contract', 'version', 'requestId', 'conversationId', 'turnId', 'action'];
  if (action === 'send') required.push('input');
  const errors = exactKeys(value, required, [], 'conversation-command');
  if (!isRecord(value)) return errors;
  errors.push(...identityErrors(value, 'ConversationCommand', 'conversation-command'));
  if (!['send', 'cancel'].includes(String(action))) errors.push('conversation-command:invalid-action');
  if (action === 'send' && !nonEmpty(value.input)) errors.push('conversation-command:invalid-input');
  return errors;
}

function conversationResultErrors(value: unknown): string[] {
  const errors = exactKeys(
    value,
    ['contract', 'version', 'requestId', 'conversationId', 'turnId', 'status'],
    ['response', 'error', 'partial'],
    'conversation-result',
  );
  if (!isRecord(value)) return errors;
  errors.push(...identityErrors(value, 'ConversationResult', 'conversation-result'));
  errors.push(...classifyTerminal(value, {
    allowPartial: true,
    responseKind: 'conversation',
  }).errors);
  return errors;
}

function modelRequestErrors(value: unknown): string[] {
  const errors = exactKeys(
    value,
    ['contract', 'version', 'requestId', 'conversationId', 'turnId', 'callerRole', 'modelRole', 'purpose', 'prompt'],
    ['systemPrompt', 'parameters'],
    'model-request',
  );
  if (!isRecord(value)) return errors;
  errors.push(...identityErrors(value, 'ModelRequest', 'model-request'));
  if (!nonEmpty(value.callerRole)) errors.push('model-request:invalid-callerRole');
  if (!nonEmpty(value.modelRole)) errors.push('model-request:invalid-modelRole');
  if (!M1_MODEL_PURPOSES.includes(value.purpose as M1ModelPurpose)) errors.push('model-request:invalid-purpose');
  if (!nonEmpty(value.prompt)) errors.push('model-request:invalid-prompt');
  if (hasOwn(value, 'systemPrompt') && typeof value.systemPrompt !== 'string') {
    errors.push('model-request:invalid-systemPrompt');
  }
  if (hasOwn(value, 'parameters') && !jsonValue(value.parameters)) {
    errors.push('model-request:invalid-parameters');
  }
  return errors;
}

function modelResultErrors(value: unknown): string[] {
  const errors = exactKeys(
    value,
    ['contract', 'version', 'requestId', 'conversationId', 'turnId', 'status'],
    ['response', 'error'],
    'model-result',
  );
  if (!isRecord(value)) return errors;
  errors.push(...identityErrors(value, 'ModelResult', 'model-result'));
  errors.push(...classifyTerminal(value, { responseKind: 'model' }).errors);
  return errors;
}

function coreEventErrors(value: unknown): string[] {
  const phase = isRecord(value) ? value.phase : null;
  const required = ['contract', 'version', 'requestId', 'conversationId', 'turnId', 'sequence', 'phase', 'eventType', 'payload'];
  if (phase === 'terminal') required.push('terminalStatus');
  const errors = exactKeys(value, required, [], 'core-event');
  if (!isRecord(value)) return errors;
  errors.push(...identityErrors(value, 'CoreEvent', 'core-event'));
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) errors.push('core-event:invalid-sequence');
  if (!['progress', 'terminal'].includes(String(phase))) errors.push('core-event:invalid-phase');
  if (!identifier(value.eventType)) errors.push('core-event:invalid-eventType');
  if (!isRecord(value.payload) || !jsonValue(value.payload)) errors.push('core-event:invalid-payload');
  if (phase === 'terminal') {
    if (value.eventType !== 'result') errors.push('core-event:terminal-eventType');
    if (!M1_TERMINAL_STATUSES.includes(value.terminalStatus as M1TerminalStatus)) {
      errors.push('core-event:invalid-terminalStatus');
    }
    errors.push(...exactKeys(value.payload, ['result'], [], 'core-event.payload'));
    if (isRecord(value.payload) && hasOwn(value.payload, 'result')) {
      const resultErrors = conversationResultErrors(value.payload.result);
      errors.push(...resultErrors.map(error => `core-event.payload.${error}`));
      if (resultErrors.length === 0 && isRecord(value.payload.result)) {
        for (const key of ['requestId', 'conversationId', 'turnId']) {
          if (value.payload.result[key] !== value[key]) errors.push(`core-event:foreign-${key}`);
        }
        if (value.payload.result.status !== value.terminalStatus) {
          errors.push('core-event:terminal-status-mismatch');
        }
      }
    }
  }
  return errors;
}

export function validateM1Contract(
  value: unknown,
  expectedContract: string | null = null,
): M1ValidationResult {
  if (!isRecord(value)) return { valid: false, errors: ['m1:not-object'], value: null };
  if (expectedContract !== null && value.contract !== expectedContract) {
    return { valid: false, errors: ['m1:unexpected-contract'], value: null };
  }
  const validators: Record<string, (candidate: unknown) => string[]> = {
    ConversationCommand: conversationCommandErrors,
    ConversationResult: conversationResultErrors,
    ModelRequest: modelRequestErrors,
    ModelResult: modelResultErrors,
    CoreEvent: coreEventErrors,
  };
  if (typeof value.contract !== 'string' || !M1_CONTRACT_NAMES.has(value.contract)) {
    return { valid: false, errors: ['m1:unknown-contract'], value: null };
  }
  const errors = validators[value.contract](value);
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? value as unknown as M1ContractEnvelope : null,
  };
}

export function validateCoreEventStream(events: unknown): M1ValidationResult<CoreEvent[]> {
  if (!Array.isArray(events) || events.length === 0) {
    return { valid: false, errors: ['core-event-stream:empty'], value: null };
  }
  const errors: string[] = [];
  const first = isRecord(events[0]) ? events[0] : null;
  let previousSequence = 0;
  let terminalCount = 0;
  events.forEach((event, index) => {
    const eventErrors = coreEventErrors(event);
    errors.push(...eventErrors.map(error => `core-event-stream[${index}]:${error}`));
    if (eventErrors.length > 0 || !isRecord(event)) return;
    if (index > 0 && first !== null) {
      for (const key of ['requestId', 'conversationId', 'turnId']) {
        if (event[key] !== first[key]) errors.push(`core-event-stream[${index}]:foreign-${key}`);
      }
    }
    const sequence = Number(event.sequence);
    if (sequence <= previousSequence) errors.push(`core-event-stream[${index}]:out-of-order-sequence`);
    previousSequence = sequence;
    if (event.phase === 'terminal') {
      terminalCount += 1;
      if (index !== events.length - 1) errors.push(`core-event-stream[${index}]:event-after-terminal`);
    }
  });
  if (terminalCount === 0) errors.push('core-event-stream:missing-terminal');
  if (terminalCount > 1) errors.push('core-event-stream:duplicate-terminal');
  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? events as CoreEvent[] : null,
  };
}

export function isM1ContractEnvelope(value: unknown): value is M1ContractEnvelope {
  return validateM1Contract(value).valid;
}

export function encodeM1Contract(value: M1ContractEnvelope): string {
  const result = validateM1Contract(value);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return JSON.stringify(value);
}

export function decodeM1Contract(encoded: string): M1ContractEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new TypeError('m1:invalid-json');
  }
  const result = validateM1Contract(value);
  if (!result.valid || result.value === null) throw new TypeError(result.errors.join(', '));
  return result.value as M1ContractEnvelope;
}

export function roundTripM1Contract(value: M1ContractEnvelope): M1ContractEnvelope {
  return decodeM1Contract(encodeM1Contract(value));
}
