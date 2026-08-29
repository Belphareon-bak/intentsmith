import { validateConversationResult } from '../../contracts/m1/index.js';
import {
  M7_OPERATION_JOURNAL_OUTCOME_STATE,
  canonicalizeM7OperationJournalEvent,
  computeM7OperationRequestDigest,
  encodeM7OperationAbandonment,
  encodeM7OperationJournalEvent,
  parseM7OperationAbandonment,
  parseM7OperationJournalEvent,
  registerM7OperationJournalFunctions,
} from './m7-operation-journal-validation.js';

export const M7_OPERATION_JOURNAL_ERROR = Object.freeze({
  CONFLICT: 'M7_OPERATION_CONFLICT',
  INPUT_INVALID: 'M7_OPERATION_INPUT_INVALID',
  NOT_ABANDONABLE: 'M7_OPERATION_NOT_ABANDONABLE',
  NOT_FOUND: 'M7_OPERATION_NOT_FOUND',
  OUTCOME_UNKNOWN: 'M7_OPERATION_OUTCOME_UNKNOWN',
  REVISION_STALE: 'M7_OPERATION_REVISION_STALE',
  STORAGE_FAILURE: 'M7_OPERATION_STORAGE_FAILURE',
});

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LIST_STATES = new Set(['abandoned', 'confirmed', 'pending', 'rejected', 'unknown']);
const SNAPSHOT_PATTERN = /^ops:([0-9]+):([0-9]+)$/u;

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

function parseAbandonmentRow(row) {
  if (!row) return null;
  try {
    const receipt = parseM7OperationAbandonment(row.recordBytes);
    const exact = receipt.deviceId === row.deviceId
      && receipt.subjectId === row.subjectId
      && receipt.targetOperationId === row.targetOperationId
      && receipt.sourceOperationId === row.sourceOperationId
      && receipt.sourceRequestDigest === row.sourceRequestDigest
      && receipt.targetEventRevision === row.targetEventRevision
      && receipt.targetRequestDigest === row.targetRequestDigest
      && receipt.recordedAtMs === row.recordedAtMs;
    if (!exact) throw new Error('abandonment column-record mismatch');
    return deepFreeze({ revision: row.abandonmentRevision, receipt });
  } catch (error) {
    fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'stored m7 abandonment is invalid', {
      cause: error?.message || String(error),
    });
  }
}

function operationRevision(value) {
  return `rev:${computeM7OperationRequestDigest(value).slice(7)}`;
}

function resultReference(resultDigest) {
  return resultDigest === null ? null : `result:${resultDigest.slice(7)}`;
}

function isoTimestamp(value) {
  return new Date(value).toISOString();
}

function requireListLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 operation list limit is invalid');
  }
  return value;
}

function requireListStates(value) {
  if (!Array.isArray(value)
    || value.length > LIST_STATES.size
    || new Set(value).size !== value.length
    || value.some(state => !LIST_STATES.has(state))) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 operation list states are invalid');
  }
  return value;
}

function requireAfterRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 operation list cursor is invalid');
  }
  return value;
}

function encodeListSnapshot(eventRevision, abandonmentRevision) {
  return `ops:${eventRevision}:${abandonmentRevision}`;
}

function parseListSnapshot(value) {
  const match = typeof value === 'string' ? value.match(SNAPSHOT_PATTERN) : null;
  if (!match) fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 operation snapshot is invalid');
  const eventRevision = Number(match[1]);
  const abandonmentRevision = Number(match[2]);
  if (!Number.isSafeInteger(eventRevision)
    || !Number.isSafeInteger(abandonmentRevision)) {
    fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'm7 operation snapshot is invalid');
  }
  return { eventRevision, abandonmentRevision };
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
    this.selectListSnapshot = this.database.prepare(`
      SELECT
        COALESCE((
          SELECT max(revision) FROM m7_remote_operation_events
          WHERE device_id = ? AND subject_id = ?
        ), 0) AS eventRevision,
        COALESCE((
          SELECT max(abandonment_revision) FROM m7_remote_operation_abandonments
          WHERE device_id = ? AND subject_id = ?
        ), 0) AS abandonmentRevision
    `);
    this.selectOperationPage = this.database.prepare(`
      WITH projected AS (
        SELECT
          intent.revision AS intentRevision,
          intent.device_id AS intentDeviceId,
          intent.subject_id AS intentSubjectId,
          intent.operation_id AS intentOperationId,
          intent.operation_type AS intentOperationType,
          intent.request_digest AS intentRequestDigest,
          intent.sequence AS intentSequence,
          intent.state AS intentState,
          intent.result_digest AS intentResultDigest,
          intent.error_code AS intentErrorCode,
          intent.recorded_at_ms AS intentRecordedAtMs,
          CAST(intent.record_json AS BLOB) AS intentRecordBytes,
          outcome.revision AS outcomeRevision,
          outcome.device_id AS outcomeDeviceId,
          outcome.subject_id AS outcomeSubjectId,
          outcome.operation_id AS outcomeOperationId,
          outcome.operation_type AS outcomeOperationType,
          outcome.request_digest AS outcomeRequestDigest,
          outcome.sequence AS outcomeSequence,
          outcome.state AS outcomeState,
          outcome.result_digest AS outcomeResultDigest,
          outcome.error_code AS outcomeErrorCode,
          outcome.recorded_at_ms AS outcomeRecordedAtMs,
          CAST(outcome.record_json AS BLOB) AS outcomeRecordBytes,
          abandonment.abandonment_revision AS abandonmentRevision,
          abandonment.device_id AS abandonmentDeviceId,
          abandonment.subject_id AS abandonmentSubjectId,
          abandonment.target_operation_id AS abandonmentTargetOperationId,
          abandonment.source_operation_id AS abandonmentSourceOperationId,
          abandonment.source_request_digest AS abandonmentSourceRequestDigest,
          abandonment.target_event_revision AS abandonmentTargetEventRevision,
          abandonment.target_request_digest AS abandonmentTargetRequestDigest,
          abandonment.recorded_at_ms AS abandonmentRecordedAtMs,
          CAST(abandonment.record_json AS BLOB) AS abandonmentRecordBytes,
          CASE
            WHEN abandonment.abandonment_revision IS NOT NULL THEN 'abandoned'
            WHEN outcome.revision IS NULL OR outcome.state = 'UNKNOWN' THEN 'unknown'
            WHEN outcome.state = 'PENDING' THEN 'pending'
            WHEN outcome.state = 'CONFIRMED' THEN 'confirmed'
            ELSE 'rejected'
          END AS publicState
        FROM m7_remote_operation_events intent
        LEFT JOIN m7_remote_operation_events outcome
          ON outcome.device_id = intent.device_id
         AND outcome.subject_id = intent.subject_id
         AND outcome.operation_id = intent.operation_id
         AND outcome.sequence = 1
         AND outcome.revision <= @eventRevision
        LEFT JOIN m7_remote_operation_abandonments abandonment
          ON abandonment.device_id = intent.device_id
         AND abandonment.subject_id = intent.subject_id
         AND abandonment.target_operation_id = intent.operation_id
         AND abandonment.abandonment_revision <= @abandonmentRevision
        WHERE intent.device_id = @deviceId
          AND intent.subject_id = @subjectId
          AND intent.sequence = 0
          AND intent.revision > @afterRevision
          AND intent.revision <= @eventRevision
      )
      SELECT * FROM projected
      WHERE @statesJson = '[]'
         OR publicState IN (SELECT value FROM json_each(@statesJson))
      ORDER BY intentRevision
      LIMIT @rowLimit
    `);
    this.selectAbandonment = this.database.prepare(`
      SELECT abandonment_revision AS abandonmentRevision,
             device_id AS deviceId, subject_id AS subjectId,
             target_operation_id AS targetOperationId,
             source_operation_id AS sourceOperationId,
             source_request_digest AS sourceRequestDigest,
             target_event_revision AS targetEventRevision,
             target_request_digest AS targetRequestDigest,
             recorded_at_ms AS recordedAtMs,
             CAST(record_json AS BLOB) AS recordBytes
      FROM m7_remote_operation_abandonments
      WHERE device_id = ? AND subject_id = ? AND target_operation_id = ?
    `);
    this.insertAbandonment = this.database.prepare(`
      INSERT INTO m7_remote_operation_abandonments (
        device_id, subject_id, target_operation_id, source_operation_id,
        source_request_digest, target_event_revision, target_request_digest,
        recorded_at_ms, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB))
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

  #abandonment(key) {
    return parseAbandonmentRow(this.selectAbandonment.get(
      key.deviceId,
      key.subjectId,
      key.operationId,
    ));
  }

  #operationRecord(key) {
    const events = this.#load(key);
    if (events.length === 0) return null;
    if (events.length > 2
      || events[0].event.sequence !== 0
      || (events[1] && events[1].event.sequence !== 1)) {
      fail(M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE, 'm7 operation event sequence is invalid');
    }
    const intent = events[0];
    const outcome = events[1] ?? null;
    const abandonment = this.#abandonment(key);
    let state;
    if (abandonment) state = 'abandoned';
    else if (!outcome || outcome.event.state === 'UNKNOWN') state = 'unknown';
    else if (outcome.event.state === 'PENDING') state = 'pending';
    else if (outcome.event.state === 'CONFIRMED') state = 'confirmed';
    else state = 'rejected';
    const updatedAtMs = abandonment?.receipt.recordedAtMs
      ?? outcome?.event.recordedAtMs
      ?? intent.event.recordedAtMs;
    const revisionMaterial = {
      abandonmentRevision: abandonment?.revision ?? null,
      eventRevision: outcome?.revision ?? intent.revision,
      operationId: intent.event.operationId,
      requestDigest: intent.event.requestDigest,
      state,
      updatedAtMs,
    };
    return deepFreeze({
      operationId: intent.event.operationId,
      operationKind: intent.event.operationType,
      requestDigest: intent.event.requestDigest,
      state,
      createdAt: isoTimestamp(intent.event.recordedAtMs),
      updatedAt: isoTimestamp(updatedAtMs),
      resultReference: ['confirmed', 'rejected'].includes(state)
        ? resultReference(outcome.event.resultDigest)
        : null,
      canAbandon: ['pending', 'unknown'].includes(state),
      revision: operationRevision(revisionMaterial),
    });
  }

  #pageOperationRecord(row) {
    const intent = parseRow({
      revision: row.intentRevision,
      deviceId: row.intentDeviceId,
      subjectId: row.intentSubjectId,
      operationId: row.intentOperationId,
      operationType: row.intentOperationType,
      requestDigest: row.intentRequestDigest,
      sequence: row.intentSequence,
      state: row.intentState,
      resultDigest: row.intentResultDigest,
      errorCode: row.intentErrorCode,
      recordedAtMs: row.intentRecordedAtMs,
      recordBytes: row.intentRecordBytes,
    });
    const outcome = row.outcomeRevision === null ? null : parseRow({
      revision: row.outcomeRevision,
      deviceId: row.outcomeDeviceId,
      subjectId: row.outcomeSubjectId,
      operationId: row.outcomeOperationId,
      operationType: row.outcomeOperationType,
      requestDigest: row.outcomeRequestDigest,
      sequence: row.outcomeSequence,
      state: row.outcomeState,
      resultDigest: row.outcomeResultDigest,
      errorCode: row.outcomeErrorCode,
      recordedAtMs: row.outcomeRecordedAtMs,
      recordBytes: row.outcomeRecordBytes,
    });
    const abandonment = row.abandonmentRevision === null ? null : parseAbandonmentRow({
      abandonmentRevision: row.abandonmentRevision,
      deviceId: row.abandonmentDeviceId,
      subjectId: row.abandonmentSubjectId,
      targetOperationId: row.abandonmentTargetOperationId,
      sourceOperationId: row.abandonmentSourceOperationId,
      sourceRequestDigest: row.abandonmentSourceRequestDigest,
      targetEventRevision: row.abandonmentTargetEventRevision,
      targetRequestDigest: row.abandonmentTargetRequestDigest,
      recordedAtMs: row.abandonmentRecordedAtMs,
      recordBytes: row.abandonmentRecordBytes,
    });
    const updatedAtMs = abandonment?.receipt.recordedAtMs
      ?? outcome?.event.recordedAtMs
      ?? intent.event.recordedAtMs;
    const revisionMaterial = {
      abandonmentRevision: abandonment?.revision ?? null,
      eventRevision: outcome?.revision ?? intent.revision,
      operationId: intent.event.operationId,
      requestDigest: intent.event.requestDigest,
      state: row.publicState,
      updatedAtMs,
    };
    return deepFreeze({
      operationId: intent.event.operationId,
      operationKind: intent.event.operationType,
      requestDigest: intent.event.requestDigest,
      state: row.publicState,
      createdAt: isoTimestamp(intent.event.recordedAtMs),
      updatedAt: isoTimestamp(updatedAtMs),
      resultReference: ['confirmed', 'rejected'].includes(row.publicState)
        ? resultReference(outcome.event.resultDigest)
        : null,
      canAbandon: ['pending', 'unknown'].includes(row.publicState),
      revision: operationRevision(revisionMaterial),
    });
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

  getOperation({ deviceId, subjectId, operationId }) {
    const key = {
      deviceId: requireIdentifier(deviceId, 'deviceId'),
      subjectId: requireIdentifier(subjectId, 'subjectId'),
      operationId: requireIdentifier(operationId, 'operationId'),
      operationType: 'lookup-only',
    };
    return requireStored(
      () => this.database.transaction(() => this.#operationRecord(key))(),
      'm7 operation record could not be read',
    );
  }

  listOperationsPage({
    deviceId,
    subjectId,
    states = [],
    limit,
    afterRevision = 0,
    snapshotRevision = null,
  }) {
    const key = {
      deviceId: requireIdentifier(deviceId, 'deviceId'),
      subjectId: requireIdentifier(subjectId, 'subjectId'),
    };
    const pageLimit = requireListLimit(limit);
    const listStates = requireListStates(states);
    const cursorRevision = requireAfterRevision(afterRevision);
    return requireStored(
      () => this.database.transaction(() => {
        const snapshot = snapshotRevision === null
          ? this.selectListSnapshot.get(
            key.deviceId,
            key.subjectId,
            key.deviceId,
            key.subjectId,
          )
          : parseListSnapshot(snapshotRevision);
        const rows = this.selectOperationPage.all({
          deviceId: key.deviceId,
          subjectId: key.subjectId,
          eventRevision: snapshot.eventRevision,
          abandonmentRevision: snapshot.abandonmentRevision,
          afterRevision: cursorRevision,
          statesJson: JSON.stringify(listStates),
          rowLimit: pageLimit + 1,
        });
        const pageRows = rows.slice(0, pageLimit);
        return deepFreeze({
          items: pageRows.map(row => this.#pageOperationRecord(row)),
          end: rows.length <= pageLimit,
          nextAfterRevision: rows.length <= pageLimit
            ? null
            : pageRows.at(-1).intentRevision,
          snapshotRevision: encodeListSnapshot(
            snapshot.eventRevision,
            snapshot.abandonmentRevision,
          ),
        });
      })(),
      'm7 operation page could not be read',
    );
  }

  abandonOperation({
    deviceId,
    subjectId,
    sourceOperationId,
    sourceRequestDigest,
    targetOperationId,
    expectedRevision,
  }) {
    const sourceKey = {
      deviceId: requireIdentifier(deviceId, 'deviceId'),
      subjectId: requireIdentifier(subjectId, 'subjectId'),
      operationId: requireIdentifier(sourceOperationId, 'sourceOperationId'),
    };
    const targetKey = {
      deviceId: sourceKey.deviceId,
      subjectId: sourceKey.subjectId,
      operationId: requireIdentifier(targetOperationId, 'targetOperationId'),
    };
    if (sourceKey.operationId === targetKey.operationId) {
      fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'an abandon operation cannot target itself');
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(sourceRequestDigest || '')) {
      fail(M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID, 'sourceRequestDigest is invalid');
    }
    requireIdentifier(expectedRevision, 'expectedRevision');
    return requireStored(() => immediate(this.database, () => {
      const sourceEvents = this.#load(sourceKey);
      if (sourceEvents.length !== 1
        || sourceEvents[0].event.operationType !== 'operation.abandon'
        || sourceEvents[0].event.requestDigest !== sourceRequestDigest) {
        fail(
          M7_OPERATION_JOURNAL_ERROR.INPUT_INVALID,
          'abandonment requires its exact durable operation intent',
        );
      }
      const target = this.#operationRecord(targetKey);
      if (!target) fail(M7_OPERATION_JOURNAL_ERROR.NOT_FOUND, 'target operation was not found');
      if (target.revision !== expectedRevision) fail(
        M7_OPERATION_JOURNAL_ERROR.REVISION_STALE,
        'target operation revision changed before abandonment',
        { actualRevision: target.revision },
      );
      if (!target.canAbandon) fail(
        M7_OPERATION_JOURNAL_ERROR.NOT_ABANDONABLE,
        'target operation is already resolved or abandoned',
      );
      const targetEvents = this.#load(targetKey);
      const currentEvent = targetEvents[targetEvents.length - 1];
      const receipt = {
        contract: 'M7RemoteOperationAbandonment',
        version: 1,
        deviceId: targetKey.deviceId,
        subjectId: targetKey.subjectId,
        targetOperationId: targetKey.operationId,
        sourceOperationId: sourceKey.operationId,
        sourceRequestDigest,
        targetEventRevision: currentEvent.revision,
        targetRequestDigest: currentEvent.event.requestDigest,
        recordedAtMs: this.#now(),
      };
      const info = this.insertAbandonment.run(
        receipt.deviceId,
        receipt.subjectId,
        receipt.targetOperationId,
        receipt.sourceOperationId,
        receipt.sourceRequestDigest,
        receipt.targetEventRevision,
        receipt.targetRequestDigest,
        receipt.recordedAtMs,
        encodeM7OperationAbandonment(receipt),
      );
      if (info.changes !== 1) fail(
        M7_OPERATION_JOURNAL_ERROR.STORAGE_FAILURE,
        'm7 operation abandonment was not inserted',
      );
      return this.#operationRecord(targetKey);
    }), 'm7 operation could not be abandoned');
  }
}

export function createM7OperationJournal(db, options) {
  return new M7OperationJournal(db, options);
}

export default createM7OperationJournal;
