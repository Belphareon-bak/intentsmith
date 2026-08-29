// IntentSmith RemoteCore in-process simulator — TEST ONLY
// =============================================================================
//
// This module exists so the mobile client can exercise M7 integration states
// before the backend provider and listener exist. It never opens a socket,
// reads a database, issues a credential, or grants production authority.

import {
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
} from './fixtures/remote-capability-golden-v1.js';
import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from './remote-capability-manifests-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from './remote-capability-requirements-v1.js';
import {
  MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1,
  validateRemoteCursorBindingV1,
  validateRemoteInvocationEnvelopeV1,
  validateRemoteResponseEnvelopeV1,
} from './remote-session-contract-v1.js';
import {
  digestRemoteCoreValue,
} from '../../../src/mobile/client/remote-core-v1.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const SIMULATOR_FAULTS = [
  'event_window_gone',
  'offline',
  'provider_unavailable',
  'session_expired',
  'session_revoked',
  'timeout',
  'unknown_outcome',
  'version_mismatch',
];

export const MOBILE_REMOTE_CORE_SIMULATOR_STAGE_V1 = 'TEST_ONLY_NOT_RUNTIME';

export const MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1 = deepFreeze({
  contract: 'MobileRemoteCoreSimulatorDescriptor',
  version: 1,
  stage: MOBILE_REMOTE_CORE_SIMULATOR_STAGE_V1,
  authority: 'NONE',
  sources: {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    sessionContractDigest: MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1,
  },
  isolation: {
    backendImports: 'forbidden',
    credentialIssuance: 'absent',
    database: 'none',
    network: 'none',
    productionImport: 'forbidden',
    syntheticFixturesOnly: true,
  },
  enforced: [
    'capability_version_and_payload_validation',
    'cursor_session_query_snapshot_and_limit_binding',
    'device_subject_session_identity_binding',
    'explicit_fault_state_projection',
    'mutation_idempotency_and_conflict',
    'nonce_single_use_and_monotonic_counter',
    'operation_lookup_and_abandon_recovery',
  ],
  faults: SIMULATOR_FAULTS,
});

export const MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_DIGEST_V1 =
  'sha256:dc1053b076f45630192aa59cd525f8dbb395a73a12df7d62bff040db61b1ec3d';

const FIXTURES_BY_OPERATION = new Map(
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1.map(fixture => [fixture.operationId, fixture]),
);

const MUTATION_OPERATIONS = new Set(
  [
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities.flatMap(item => item.operations),
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.controlPlanePrerequisite.operations,
  ].filter(operation => ['command', 'mutation'].includes(operation.kind)
    || operation.idempotency !== 'not_applicable')
    .map(operation => operation.operationId),
);

function simulatorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalTimestamp(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function operationKey(session, operationId) {
  return `${session.deviceId}\u0000${session.subjectId}\u0000${operationId}`;
}

function queryPayload(request) {
  const value = clone(request);
  delete value.cursor;
  delete value.requestId;
  return value;
}

function bindFixtureResult(operationId, request, fixture) {
  const result = clone(fixture.success);
  if (Object.prototype.hasOwnProperty.call(result, 'requestId')) result.requestId = request.requestId;

  if (operationId === 'approval.decide') {
    result.operationId = request.operationId;
    result.approvalId = request.approvalId;
    result.decision = request.decision;
    result.payloadFingerprint = request.expectedPayloadFingerprint;
  } else if (operationId === 'conversation.execute') {
    result.conversationId = request.conversationId;
    result.turnId = request.turnId;
  } else if (operationId === 'conversation.history') {
    result.conversationId = request.conversationId;
  } else if (operationId === 'notification.ack') {
    result.operationId = request.operationId;
    result.acknowledgedIds = [...request.notificationIds];
    result.acknowledgedThroughSeq = request.observedThroughSeq;
  } else if (operationId === 'project-context.query') {
    result.projectId = request.projectId;
    result.workspaceRevision = request.workspaceRevision;
  } else if (operationId === 'settings.update') {
    result.operationId = request.operationId;
    result.key = request.key;
    result.value = request.value;
  } else if (operationId === 'stored-information.append') {
    result.operationId = request.operationId;
  } else if (operationId === 'operation.abandon') {
    result.operationId = request.operationId;
    result.targetOperationId = request.targetOperationId;
  }
  return result;
}

function createOperationRecord({ request, requestDigest, state, nowMs }) {
  const terminal = ['confirmed', 'rejected', 'abandoned'].includes(state);
  return {
    operationId: request.operationId,
    operationKind: request.contract.replace(/Command$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    requestDigest,
    state,
    createdAt: canonicalTimestamp(nowMs),
    updatedAt: canonicalTimestamp(nowMs),
    resultReference: terminal && state !== 'abandoned' ? `result:${request.operationId}` : null,
    canAbandon: ['pending', 'unknown'].includes(state),
    revision: `rev:simulator:${request.operationId}:${state}`,
  };
}

function isOpaqueCursorResult(result) {
  return result?.status === 'ok'
    && Object.prototype.hasOwnProperty.call(result, 'end')
    && Object.prototype.hasOwnProperty.call(result, 'nextCursor')
    && typeof result.snapshotRevision === 'string';
}

export function createMobileRemoteCoreSimulatorV1({
  session,
  previousCounter = 0,
  now = () => Date.now(),
  cryptoApi = globalThis.crypto,
  externalValidators = {},
} = {}) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('mobile-remote-simulator:session-required');
  }
  if (!Number.isSafeInteger(previousCounter) || previousCounter < 0) {
    throw new TypeError('mobile-remote-simulator:invalid-previousCounter');
  }
  if (typeof now !== 'function') throw new TypeError('mobile-remote-simulator:now-required');

  const boundSession = clone(session);
  let acceptedCounter = previousCounter;
  let lifecycle = 'ACTIVE';
  const usedNonces = new Set();
  const cursors = new Map();
  const mutations = new Map();
  const operations = new Map();
  const faultQueue = [];

  function advertise() {
    return deepFreeze(Object.values(MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1).map(manifest => ({
      capabilityId: manifest.capabilityId,
      status: 'available',
      selectedVersion: manifest.version,
      contractDigest: manifest.contractDigest,
      operationsDigest: manifest.operationsDigest,
      error: null,
    })));
  }

  function queueFault(fault, { operationId = null, count = 1 } = {}) {
    if (!SIMULATOR_FAULTS.includes(fault)) {
      throw new TypeError(`mobile-remote-simulator:unknown-fault-${fault}`);
    }
    if (operationId !== null && !FIXTURES_BY_OPERATION.has(operationId)) {
      throw new TypeError(`mobile-remote-simulator:unknown-operation-${operationId}`);
    }
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new TypeError('mobile-remote-simulator:invalid-fault-count');
    }
    faultQueue.push({ fault, operationId, remaining: count });
  }

  function takeFault(operationId) {
    const index = faultQueue.findIndex(item => item.operationId === null || item.operationId === operationId);
    if (index < 0) return null;
    const item = faultQueue[index];
    item.remaining -= 1;
    if (item.remaining === 0) faultQueue.splice(index, 1);
    return item.fault;
  }

  async function responseFor(envelope, { payload = null, error = null } = {}) {
    const status = error ? 'error' : 'ok';
    const response = {
      contract: 'RemoteResponseEnvelope',
      version: 1,
      requestId: envelope.requestId,
      sessionId: envelope.sessionId,
      deviceId: envelope.deviceId,
      subjectId: envelope.subjectId,
      sessionRevision: envelope.sessionRevision,
      acceptedCounter: envelope.clientCounter,
      respondedAt: canonicalTimestamp(now()),
      status,
      payload,
      payloadDigest: status === 'ok' ? await digestRemoteCoreValue(payload, cryptoApi) : null,
      error,
    };
    const validation = await validateRemoteResponseEnvelopeV1({
      requestEnvelope: envelope,
      responseEnvelope: response,
      session: boundSession,
      nowMs: now(),
      cryptoApi,
      externalValidators,
    });
    if (!validation.valid) {
      const caught = simulatorError('REMOTE_SIMULATOR_INVALID_RESPONSE', validation.errors.join(','));
      caught.validationErrors = validation.errors;
      throw caught;
    }
    return deepFreeze(response);
  }

  async function errorResponse(envelope, code, message, retryable) {
    return responseFor(envelope, { error: { code, message, retryable } });
  }

  async function validateCursor(envelope) {
    const token = envelope.payload.cursor;
    if (token === undefined) return { valid: true, binding: null };
    const binding = cursors.get(token);
    if (!binding) return { valid: false, binding: null };
    const queryDigest = await digestRemoteCoreValue(queryPayload(envelope.payload), cryptoApi);
    const validation = validateRemoteCursorBindingV1({
      binding,
      session: boundSession,
      invocation: envelope,
      queryDigest,
      nowMs: now(),
    });
    return { valid: validation.valid, binding };
  }

  async function bindNextCursor(envelope, result) {
    if (!isOpaqueCursorResult(result) || result.end || result.nextCursor === null) return;
    const queryDigest = await digestRemoteCoreValue(queryPayload(envelope.payload), cryptoApi);
    const issuedAt = now();
    cursors.set(result.nextCursor, deepFreeze({
      contract: 'RemoteCursorBinding',
      version: 1,
      cursorDigest: await digestRemoteCoreValue(result.nextCursor, cryptoApi),
      deviceId: boundSession.deviceId,
      subjectId: boundSession.subjectId,
      sessionRevision: boundSession.sessionRevision,
      capabilityId: envelope.capabilityId,
      capabilityVersion: envelope.capabilityVersion,
      operationId: envelope.operationId,
      queryDigest,
      snapshotRevision: result.snapshotRevision,
      limit: envelope.payload.limit,
      issuedAt: canonicalTimestamp(issuedAt),
      expiresAt: canonicalTimestamp(issuedAt + 60_000),
    }));
  }

  async function operationResult(envelope, fixture) {
    const request = envelope.payload;
    if (envelope.operationId === 'operation.get') {
      const record = operations.get(operationKey(boundSession, request.operationId));
      if (!record) return null;
      const result = bindFixtureResult(envelope.operationId, request, fixture);
      result.operation = clone(record);
      result.revision = `rev:simulator:operations:${acceptedCounter}`;
      return result;
    }
    if (envelope.operationId === 'operation.list') {
      const result = bindFixtureResult(envelope.operationId, request, fixture);
      result.items = [...operations.values()]
        .filter(record => !request.states || request.states.includes(record.state))
        .slice(0, request.limit)
        .map(clone);
      result.end = true;
      result.nextCursor = null;
      result.snapshotRevision = `rev:simulator:operations:${acceptedCounter}`;
      return result;
    }
    if (envelope.operationId === 'operation.abandon') {
      const targetKey = operationKey(boundSession, request.targetOperationId);
      const target = operations.get(targetKey);
      if (!target || !target.canAbandon || target.revision !== request.expectedRevision) return null;
      const result = bindFixtureResult(envelope.operationId, request, fixture);
      operations.set(targetKey, deepFreeze({
        ...clone(target),
        state: 'abandoned',
        updatedAt: canonicalTimestamp(now()),
        canAbandon: false,
        revision: result.revision,
      }));
      return result;
    }
    return bindFixtureResult(envelope.operationId, request, fixture);
  }

  async function invoke(envelope) {
    if (lifecycle === 'REVOKED') throw simulatorError('REMOTE_SESSION_REVOKED', 'Synthetic session is revoked.');
    if (lifecycle === 'EXPIRED') throw simulatorError('REMOTE_SESSION_EXPIRED', 'Synthetic session is expired.');

    const security = await validateRemoteInvocationEnvelopeV1({
      envelope,
      session: boundSession,
      previousCounter: acceptedCounter,
      nowMs: now(),
      cryptoApi,
      externalValidators,
    });
    if (!security.valid) {
      const caught = simulatorError('REMOTE_SECURITY_REJECTED', security.errors.join(','));
      caught.validationErrors = security.errors;
      throw caught;
    }
    if (usedNonces.has(envelope.nonce)) {
      throw simulatorError('REMOTE_NONCE_REPLAY', 'Synthetic nonce replay rejected.');
    }

    const fault = takeFault(envelope.operationId);
    if (fault === 'offline') throw simulatorError('REMOTE_TRANSPORT_OFFLINE', 'Synthetic transport is offline.');
    if (fault === 'timeout') throw simulatorError('REMOTE_TRANSPORT_TIMEOUT', 'Synthetic transport timed out.');

    usedNonces.add(envelope.nonce);
    acceptedCounter = envelope.clientCounter;

    if (fault === 'session_revoked') {
      lifecycle = 'REVOKED';
      return errorResponse(envelope, 'REMOTE_SESSION_REVOKED', 'Synthetic session revoked.', false);
    }
    if (fault === 'session_expired') {
      lifecycle = 'EXPIRED';
      return errorResponse(envelope, 'REMOTE_SESSION_EXPIRED', 'Synthetic session expired.', false);
    }
    if (fault === 'provider_unavailable') {
      return errorResponse(envelope, 'REMOTE_PROVIDER_UNAVAILABLE', 'Synthetic provider unavailable.', true);
    }
    if (fault === 'version_mismatch') {
      return errorResponse(
        envelope,
        'REMOTE_CAPABILITY_VERSION_INCOMPATIBLE',
        'Synthetic capability version mismatch.',
        false,
      );
    }
    if (fault === 'event_window_gone') {
      return errorResponse(envelope, 'REMOTE_EVENT_WINDOW_GONE', 'Synthetic event window expired.', false);
    }

    const fixture = FIXTURES_BY_OPERATION.get(envelope.operationId);
    if (!fixture) throw simulatorError('REMOTE_OPERATION_UNAVAILABLE', 'Synthetic operation unavailable.');

    const cursor = await validateCursor(envelope);
    if (!cursor.valid) {
      return errorResponse(
        envelope,
        'REMOTE_CURSOR_BINDING_MISMATCH',
        'Synthetic cursor binding rejected.',
        false,
      );
    }

    let requestDigest = null;
    let mutationKey = null;
    if (MUTATION_OPERATIONS.has(envelope.operationId) && envelope.payload.operationId) {
      requestDigest = await digestRemoteCoreValue(envelope.payload, cryptoApi);
      mutationKey = operationKey(boundSession, envelope.payload.operationId);
      const prior = mutations.get(mutationKey);
      if (prior && prior.requestDigest !== requestDigest) {
        return errorResponse(
          envelope,
          'REMOTE_OPERATION_CONFLICT',
          'Synthetic operation id was reused with a different request.',
          false,
        );
      }
      if (prior) {
        const replay = clone(prior.result);
        if (Object.prototype.hasOwnProperty.call(replay, 'replayed')) replay.replayed = true;
        return responseFor(envelope, { payload: replay });
      }
    }

    if (fault === 'unknown_outcome') {
      if (!mutationKey) {
        throw simulatorError('REMOTE_SIMULATOR_FAULT_INAPPLICABLE', 'Unknown outcome requires a mutation.');
      }
      operations.set(mutationKey, deepFreeze(createOperationRecord({
        request: envelope.payload,
        requestDigest,
        state: 'unknown',
        nowMs: now(),
      })));
      throw simulatorError('REMOTE_OUTCOME_UNKNOWN', 'Synthetic mutation outcome is unknown.');
    }

    let result = await operationResult(envelope, fixture);
    if (result === null) {
      return errorResponse(envelope, 'REMOTE_OPERATION_NOT_FOUND', 'Synthetic operation not found.', false);
    }
    if (cursor.binding && isOpaqueCursorResult(result)) {
      result.items = [];
      result.end = true;
      result.nextCursor = null;
      result.snapshotRevision = cursor.binding.snapshotRevision;
    }

    const pair = validateMobileRemoteOperationPair({
      capabilityId: envelope.capabilityId,
      capabilityVersion: envelope.capabilityVersion,
      operationId: envelope.operationId,
      request: envelope.payload,
      result,
      externalValidators,
    });
    if (!pair.valid) {
      const caught = simulatorError('REMOTE_SIMULATOR_FIXTURE_DRIFT', pair.errors.join(','));
      caught.validationErrors = pair.errors;
      throw caught;
    }

    await bindNextCursor(envelope, result);
    if (mutationKey) {
      mutations.set(mutationKey, deepFreeze({ requestDigest, result: clone(result) }));
      operations.set(mutationKey, deepFreeze(createOperationRecord({
        request: envelope.payload,
        requestDigest,
        state: 'confirmed',
        nowMs: now(),
      })));
    }
    return responseFor(envelope, { payload: result });
  }

  function inspect() {
    return deepFreeze({
      contract: 'MobileRemoteCoreSimulatorSnapshot',
      version: 1,
      stage: MOBILE_REMOTE_CORE_SIMULATOR_STAGE_V1,
      lifecycle,
      acceptedCounter,
      nonceCount: usedNonces.size,
      cursorCount: cursors.size,
      mutationCount: mutations.size,
      operationCount: operations.size,
      queuedFaultCount: faultQueue.reduce((total, item) => total + item.remaining, 0),
    });
  }

  return deepFreeze({ advertise, inspect, invoke, queueFault });
}
