import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { validateConversationResult } from '../../contracts/m1/index.js';
import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_:-]{0,95}$/u;
const EVENT_KEYS = Object.freeze([
  'contract',
  'deviceId',
  'errorCode',
  'operationId',
  'operationType',
  'recordedAtMs',
  'requestDigest',
  'result',
  'resultDigest',
  'sequence',
  'state',
  'subjectId',
  'version',
]);
const OUTCOME_STATE = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
});
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function resultState(value, event) {
  if (!plain(value)) return null;
  if (value.operationId === event.operationId
    && value.outcome === event.state
    && value.replayed === false) return value.outcome;
  // ConversationCommand@1 is the only accepted effectful contract without an
  // operationId/replayed pair. Its requestId is the journal identity and an
  // exact terminal ConversationResult is replayed byte-for-byte.
  if (event.operationType === 'conversation.execute'
    && value.contract === 'ConversationResult'
    && value.version === 1
    && value.requestId === event.operationId
    && !Object.hasOwn(value, 'operationId')
    && !Object.hasOwn(value, 'outcome')
    && !Object.hasOwn(value, 'replayed')
    && validateConversationResult(value).valid) {
    return value.status === 'ok' ? 'CONFIRMED' : 'REJECTED';
  }
  return null;
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function digestCanonical(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

function decodeRaw(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) return utf8Decoder.decode(raw);
  if (typeof raw === 'string') return raw;
  throw new TypeError('m7-operation-journal:raw-bytes-required');
}

export function computeM7OperationRequestDigest(request) {
  return digestCanonical(request);
}

export function validateM7OperationJournalEvent(value) {
  const errors = [];
  if (!exactKeys(value, EVENT_KEYS)) return { valid: false, errors: ['event:shape'] };
  if (value.contract !== 'M7RemoteOperationJournalEvent' || value.version !== 1) {
    errors.push('event:identity');
  }
  for (const field of ['deviceId', 'subjectId', 'operationId', 'operationType']) {
    if (!IDENTIFIER.test(value[field] || '')) errors.push(`event:${field}`);
  }
  if (!DIGEST.test(value.requestDigest || '')) errors.push('event:requestDigest');
  if (!Number.isSafeInteger(value.recordedAtMs) || value.recordedAtMs < 1) {
    errors.push('event:recordedAtMs');
  }

  if (value.sequence === 0) {
    if (value.state !== 'STARTED'
      || value.result !== null
      || value.resultDigest !== null
      || value.errorCode !== null) {
      errors.push('event:intent');
    }
  } else if (value.sequence === 1) {
    if (!Object.values(OUTCOME_STATE).includes(value.state)) errors.push('event:outcomeState');
    if (value.result === null) {
      if (value.state !== 'UNKNOWN'
        || value.resultDigest !== null
        || !ERROR_CODE.test(value.errorCode || '')) {
        errors.push('event:unknownWithoutResult');
      }
    } else if (resultState(value.result, value) !== value.state
      || value.resultDigest !== digestCanonical(value.result)
      || value.errorCode !== null) {
      errors.push('event:result');
    }
  } else {
    errors.push('event:sequence');
  }
  return { valid: errors.length === 0, errors };
}

export function canonicalizeM7OperationJournalEvent(value) {
  const validation = validateM7OperationJournalEvent(value);
  if (!validation.valid) {
    throw new TypeError(`m7-operation-journal:event-invalid:${validation.errors.join(',')}`);
  }
  return canonicalizeM2ExecutionValue(value);
}

export function encodeM7OperationJournalEvent(value) {
  return Buffer.from(canonicalizeM7OperationJournalEvent(value), 'utf8');
}

export function parseM7OperationJournalEvent(raw) {
  const text = decodeRaw(raw);
  const parsed = JSON.parse(text);
  const validation = validateM7OperationJournalEvent(parsed);
  if (!validation.valid || canonicalizeM2ExecutionValue(parsed) !== text) {
    throw new TypeError(
      `m7-operation-journal:stored-event-invalid:${validation.errors.join(',') || 'non-canonical'}`,
    );
  }
  return Object.freeze(structuredClone(parsed));
}

export function registerM7OperationJournalFunctions(db) {
  db.function('m7_remote_operation_event_valid_v1', {
    deterministic: true,
  }, raw => {
    try {
      parseM7OperationJournalEvent(raw);
      return 1;
    } catch {
      return 0;
    }
  });
}

export const M7_OPERATION_JOURNAL_OUTCOME_STATE = OUTCOME_STATE;
