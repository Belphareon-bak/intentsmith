import {
  M7CoreCursorError,
  M7_CORE_CURSOR_ERROR,
  computeM7CoreCursorFilterDigest,
  createM7CoreCursorCodec,
} from './m7-core-cursor.js';
import {
  M7OperationJournalError,
  M7_OPERATION_JOURNAL_ERROR,
} from './m7-operation-journal.js';
import { computeM7OperationRequestDigest } from './m7-operation-journal-validation.js';

export const M7_OPERATION_CONTROL_ERROR = Object.freeze({
  CONFIG_INVALID: 'M7_OPERATION_CONTROL_CONFIG_INVALID',
  READ_FAILED: 'M7_OPERATION_CONTROL_READ_FAILED',
});

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function requireJournal(value) {
  if (!value
    || typeof value.getOperation !== 'function'
    || typeof value.listOperationsPage !== 'function'
    || typeof value.abandonOperation !== 'function') {
    const error = new TypeError('m7-operation-control:journal-required');
    error.code = M7_OPERATION_CONTROL_ERROR.CONFIG_INVALID;
    throw error;
  }
  return value;
}

function readError(contract, requestId, code, message, retryable = false) {
  return deepFreeze({
    contract,
    version: 1,
    requestId,
    status: 'error',
    error: { code, message, retryable },
  });
}

function mutationError(request, code, message, revision, retryable = false) {
  return deepFreeze({
    contract: 'OperationAbandonResult',
    version: 1,
    requestId: request.requestId,
    operationId: request.operationId,
    targetOperationId: request.targetOperationId,
    revision,
    outcome: 'REJECTED',
    replayed: false,
    error: { code, message, retryable },
  });
}

function mapReadFailure(contract, requestId, error) {
  if (error instanceof M7CoreCursorError) {
    return readError(
      contract,
      requestId,
      error.code === M7_CORE_CURSOR_ERROR.STALE
        ? 'REMOTE_OPERATION_CURSOR_STALE'
        : 'REMOTE_OPERATION_CURSOR_INVALID',
      'The operation cursor is invalid or no longer describes the current snapshot.',
    );
  }
  if (error instanceof M7OperationJournalError
    && error.code === M7_OPERATION_JOURNAL_ERROR.NOT_FOUND) {
    return readError(contract, requestId, 'REMOTE_OPERATION_NOT_FOUND', 'Operation was not found.');
  }
  return readError(
    contract,
    requestId,
    'REMOTE_OPERATION_READ_FAILED',
    'Operation state could not be read safely.',
    true,
  );
}

function mapAbandonFailure(request, error) {
  const revision = error?.details?.actualRevision ?? request.expectedRevision;
  const mapping = {
    [M7_OPERATION_JOURNAL_ERROR.NOT_FOUND]: [
      'REMOTE_OPERATION_NOT_FOUND', 'Operation was not found.', false,
    ],
    [M7_OPERATION_JOURNAL_ERROR.NOT_ABANDONABLE]: [
      'REMOTE_OPERATION_NOT_ABANDONABLE', 'Operation is already resolved or abandoned.', false,
    ],
    [M7_OPERATION_JOURNAL_ERROR.REVISION_STALE]: [
      'REMOTE_OPERATION_STALE_REVISION', 'Operation changed before abandonment.', false,
    ],
  };
  const selected = mapping[error?.code] ?? [
    'REMOTE_OPERATION_ABANDON_FAILED', 'Operation record could not be abandoned safely.', true,
  ];
  return mutationError(request, selected[0], selected[1], revision, selected[2]);
}

export function createM7OperationControlAdapters({ cursorKey, journal } = {}) {
  const operationJournal = requireJournal(journal);
  const cursorCodec = createM7CoreCursorCodec({ key: cursorKey });

  async function listOperations(request, context) {
    try {
      const states = request.states ?? [];
      const filterDigest = computeM7CoreCursorFilterDigest({
        limit: request.limit,
        states,
      });
      const cursor = request.cursor === undefined ? null : cursorCodec.decode(request.cursor, {
        capabilityId: 'm7-control-plane-prerequisite',
        capabilityVersion: 1,
        operationId: 'operation.list',
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        filterDigest,
      });
      const page = operationJournal.listOperationsPage({
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        states,
        limit: request.limit,
        afterRevision: cursor?.offset ?? 0,
        snapshotRevision: cursor?.snapshotRevision ?? null,
      });
      return deepFreeze({
        contract: 'OperationPage',
        version: 1,
        requestId: request.requestId,
        status: 'ok',
        items: page.items,
        end: page.end,
        nextCursor: page.end ? null : cursorCodec.encode({
          capabilityId: 'm7-control-plane-prerequisite',
          capabilityVersion: 1,
          operationId: 'operation.list',
          deviceId: context.deviceId,
          subjectId: context.subjectId,
          filterDigest,
          snapshotRevision: page.snapshotRevision,
          offset: page.nextAfterRevision,
        }),
        snapshotRevision: page.snapshotRevision,
      });
    } catch (error) {
      return mapReadFailure('OperationPage', request.requestId, error);
    }
  }

  async function getOperation(request, context) {
    try {
      const operation = operationJournal.getOperation({
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        operationId: request.operationId,
      });
      if (!operation) throw new M7OperationJournalError(
        M7_OPERATION_JOURNAL_ERROR.NOT_FOUND,
        'operation not found',
      );
      return deepFreeze({
        contract: 'OperationLookupResult',
        version: 1,
        requestId: request.requestId,
        status: 'ok',
        operation,
        revision: operation.revision,
      });
    } catch (error) {
      return mapReadFailure('OperationLookupResult', request.requestId, error);
    }
  }

  async function abandonOperation(request, context) {
    try {
      const operation = operationJournal.abandonOperation({
        deviceId: context.deviceId,
        subjectId: context.subjectId,
        sourceOperationId: request.operationId,
        sourceRequestDigest: computeM7OperationRequestDigest(request),
        targetOperationId: request.targetOperationId,
        expectedRevision: request.expectedRevision,
      });
      return deepFreeze({
        contract: 'OperationAbandonResult',
        version: 1,
        requestId: request.requestId,
        operationId: request.operationId,
        targetOperationId: request.targetOperationId,
        revision: operation.revision,
        outcome: 'CONFIRMED',
        replayed: false,
      });
    } catch (error) {
      return mapAbandonFailure(request, error);
    }
  }

  const handlers = deepFreeze({
    'operation.abandon': abandonOperation,
    'operation.get': getOperation,
    'operation.list': listOperations,
  });
  return Object.freeze({ abandonOperation, getOperation, handlers, listOperations });
}

export default createM7OperationControlAdapters;
