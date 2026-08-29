import { validateConversationResult } from '../../contracts/m1/index.js';
import {
  M7_OPERATION_JOURNAL_OUTCOME_STATE,
  canonicalizeM7OperationJournalEvent,
  computeM7OperationRequestDigest,
  encodeM7OperationJournalEvent,
  parseM7OperationJournalEvent,
  registerM7OperationJournalFunctions,
} from './m7-operation-journal-validation.js';

export const M7_OPERATION_JOURNAL_ERROR = Object.freeze({
  CONFLICT: 'M7_OPERATION_CONFLICT',
  INPUT_INVALID: 'M7_OPERATION_INPUT_INVALID',
  OUTCOME_UNKNOWN: 'M7_OPERATION_OUTCOME_UNKNOWN',
  STORAGE_FAILURE: 'M7_OPERATION_STORAGE_FAILURE',
});

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class M7OperationJournalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'M7OperationJournalError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new M7OperationJournalError(code, message, details);
}

function requireDatabase(db) {
  if (!db
    || typeof db.prepare !== 'function'
    || typeof db.transaction !== 'function'
    || typeof db.function !== 'function') {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal requires a SQLite database');
  }
  return db;
}

function requireClock(clock) {
  if (typeof clock !== 'function') {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal clock must be a function');
  }
  return clock;
}

function requireIdentifier(value, field) {
  if (!IDENTITY_PATTERN.test(value || '')) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, `m7 journal ${field} is invalid`);
  }
  return value;
}

function requireRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal request must be an object');
  }
  try {
    return {
      digest: computeM7OperationRequestDigest(value),
    };
  } catch (error) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal request is not canonical', {
      cause: error?.message || String(error),
    });
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immediate(db, callback) {
  const transaction = db.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function requireStored(operation, message) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof M7OperationJournalError) throw error;
    fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, message, {
      cause: error?.message || String(error),
    });
  }
}

function operationKey(input) {
  return {
    deviceId: requireIdentifier(input?.deviceId, 'deviceId'),
    subjectId: requireIdentifier(input?.subjectId, 'subjectId'),
    operationId: requireIdentifier(input?.operationId, 'operationId'),
    operationType: requireIdentifier(input?.operationType, 'operationType'),
  };
}

function canonicalErrorCode(error) {
  const value = typeof error?.code === 'string' ? error.code : 'M7_OPERATION_HANDLER_FAILED';
  return /^[A-Z][A-Z0-9_:-]{0,95}$/u.test(value)
    ? value
    : 'M7_OPERATION_HANDLER_FAILED';
}

function stateForResult(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal result must be an object');
  }
  const mutationState = M7_OPERATION_JOURNAL_OUTCOME_STATE[result.outcome];
  if (mutationState && result.replayed === false) return mutationState;
  if (result.contract === 'ConversationResult'
    && result.version === 1
    && !Object.hasOwn(result, 'operationId')
    && !Object.hasOwn(result, 'outcome')
    && !Object.hasOwn(result, 'replayed')
    && validateConversationResult(result).valid) {
    return result.status === 'ok' ? 'CONFIRMED' : 'REJECTED';
  }
  fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal result outcome is invalid');
}

function buildEvent({ key, requestDigest, sequence, state, result, errorCode, recordedAtMs }) {
  const resultDigest = result === null ? null : computeM7OperationRequestDigest(result);
  const event = {
    contract: 'M7RemoteOperationJournalEvent',
    version: 1,
    deviceId: key.deviceId,
    subjectId: key.subjectId,
    operationId: key.operationId,
    operationType: key.operationType,
    requestDigest,
    sequence,
    state,
    result,
    resultDigest,
    errorCode,
    recordedAtMs,
  };
  canonicalizeM7OperationJournalEvent(event);
  return event;
}

function rowMatchesEvent(row, event) {
  return row.deviceId === event.deviceId
    && row.subjectId === event.subjectId
    && row.operationId === event.operationId
    && row.operationType === event.operationType
    && row.requestDigest === event.requestDigest
    && row.sequence === event.sequence
    && row.state === event.state
    && row.resultDigest === event.resultDigest
    && row.errorCode === event.errorCode
    && row.recordedAtMs === event.recordedAtMs;
}

function parseRow(row) {
  try {
    const event = parseM7OperationJournalEvent(row.recordBytes);
    if (!rowMatchesEvent(row, event)) throw new Error('column-record mismatch');
    return deepFreeze({ revision: row.revision, event });
  } catch (error) {
    fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'stored m7 journal event is invalid', {
      cause: error?.message || String(error),
    });
  }
}

function replayResult(outcome) {
  if (outcome.event.result === null) {
    fail(M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN, 'm7 operation outcome is unknown', {
      operationId: outcome.event.operationId,
      revision: outcome.revision,
      errorCode: outcome.event.errorCode,
    });
  }
  if (Object.hasOwn(outcome.event.result, 'replayed')) {
    return deepFreeze({ ...structuredClone(outcome.event.result), replayed: true });
  }
  return deepFreeze(structuredClone(outcome.event.result));
}

export class M7OperationJournal {
  constructor(db, { clock = Date.now } = {}) {
    this.database = requireDatabase(db);
    this.clock = requireClock(clock);
    registerM7OperationJournalFunctions(this.database);
    this.selectEvents = this.database.prepare(`
      SELECT
        revision,
        device_id AS deviceId,
        subject_id AS subjectId,
        operation_id AS operationId,
        operation_type AS operationType,
        request_digest AS requestDigest,
        sequence,
        state,
        result_digest AS resultDigest,
        error_code AS errorCode,
        recorded_at_ms AS recordedAtMs,
        CAST(record_json AS BLOB) AS recordBytes
      FROM m7_remote_operation_events
      WHERE device_id = ? AND subject_id = ? AND operation_id = ?
      ORDER BY sequence, revision
    `);
    this.insertEvent = this.database.prepare(`
      INSERT INTO m7_remote_operation_events (
        device_id, subject_id, operation_id, operation_type, request_digest,
        sequence, state, result_digest, error_code, recorded_at_ms, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB))
    `);
  }

  #now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal clock returned invalid time');
    }
    return value;
  }

  #load(key) {
    return this.selectEvents
      .all(key.deviceId, key.subjectId, key.operationId)
      .map(parseRow);
  }

  #insert(event) {
    const info = this.insertEvent.run(
      event.deviceId,
      event.subjectId,
      event.operationId,
      event.operationType,
      event.requestDigest,
      event.sequence,
      event.state,
      event.resultDigest,
      event.errorCode,
      event.recordedAtMs,
      encodeM7OperationJournalEvent(event),
    );
    if (info.changes !== 1) {
      fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'm7 journal event was not inserted');
    }
    return Number(info.lastInsertRowid);
  }

  #claim(key, requestDigest) {
    return immediate(this.database, () => {
      const existing = this.#load(key);
      if (existing.length > 0) {
        const intent = existing[0];
        if (intent.event.sequence !== 0
          || intent.event.operationType !== key.operationType
          || intent.event.requestDigest !== requestDigest) {
          fail(M7_OPERATION_JOURNAL_ERROR.CONFLICT, 'm7 operation identity was reused', {
            operationId: key.operationId,
            revision: intent.revision,
          });
        }
        if (existing.length === 1) {
          fail(M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN, 'm7 operation is in flight or interrupted', {
            operationId: key.operationId,
            revision: intent.revision,
          });
        }
        return { claimed: false, result: replayResult(existing[1]) };
      }
      const intent = buildEvent({
        key,
        requestDigest,
        sequence: 0,
        state: 'STARTED',
        result: null,
        errorCode: null,
        recordedAtMs: this.#now(),
      });
      this.#insert(intent);
      return { claimed: true, result: null };
    });
  }

  #appendOutcome(key, requestDigest, { state, result, errorCode }) {
    return immediate(this.database, () => {
      const existing = this.#load(key);
      if (existing.length !== 1
        || existing[0].event.sequence !== 0
        || existing[0].event.operationType !== key.operationType
        || existing[0].event.requestDigest !== requestDigest) {
        fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'm7 journal outcome lost its intent');
      }
      const event = buildEvent({
        key,
        requestDigest,
        sequence: 1,
        state,
        result,
        errorCode,
        recordedAtMs: this.#now(),
      });
      return this.#insert(event);
    });
  }

  async run(input) {
    const key = operationKey(input);
    const request = requireRequest(input?.request);
    if (typeof input?.execute !== 'function') {
      fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 journal execute callback is required');
    }
    const claim = requireStored(
      () => this.#claim(key, request.digest),
      'm7 journal operation could not be claimed',
    );
    if (!claim.claimed) return claim.result;

    let result;
    try {
      result = await input.execute();
    } catch (error) {
      try {
        this.#appendOutcome(key, request.digest, {
          state: 'UNKNOWN',
          result: null,
          errorCode: canonicalErrorCode(error),
        });
      } catch (storageError) {
        if (storageError instanceof M7OperationJournalError) throw storageError;
        fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'm7 unknown outcome was not persisted', {
          cause: storageError?.message || String(storageError),
        });
      }
      fail(M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN, 'm7 operation handler outcome is unknown', {
        operationId: key.operationId,
        errorCode: canonicalErrorCode(error),
      });
    }

    const state = stateForResult(result);
    try {
      this.#appendOutcome(key, request.digest, {
        state,
        result: structuredClone(result),
        errorCode: null,
      });
    } catch (error) {
      if (error instanceof M7OperationJournalError) throw error;
      fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'm7 result outcome was not persisted', {
        cause: error?.message || String(error),
      });
    }
    return deepFreeze(structuredClone(result));
  }

  getSettlement({ deviceId, subjectId, operationId }) {
    const key = {
      deviceId: requireIdentifier(deviceId, 'deviceId'),
      subjectId: requireIdentifier(subjectId, 'subjectId'),
      operationId: requireIdentifier(operationId, 'operationId'),
      operationType: 'lookup-only',
    };
    const events = requireStored(
      () => this.#load(key),
      'm7 journal settlement could not be read',
    );
    if (events.length === 0) return Object.freeze({ known: false });
    const outcome = events[1] ?? null;
    return deepFreeze({
      known: true,
      operationId,
      operationType: events[0].event.operationType,
      requestDigest: events[0].event.requestDigest,
      state: outcome?.event.state ?? 'UNKNOWN',
      result: outcome?.event.result ?? null,
      errorCode: outcome?.event.errorCode ?? null,
      createdAtMs: events[0].event.recordedAtMs,
      updatedAtMs: outcome?.event.recordedAtMs ?? events[0].event.recordedAtMs,
      revision: outcome?.revision ?? events[0].revision,
    });
  }
}

export function createM7OperationJournal(db, options) {
  return new M7OperationJournal(db, options);
}

export default createM7OperationJournal;
