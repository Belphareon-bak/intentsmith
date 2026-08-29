// IntentSmith RemoteCore candidate client driver — TEST ONLY
// =============================================================================
//
// This driver exercises the mobile-owned session/capability candidate against
// an injected transport. It opens no socket, stores no credential and has no
// backend authority. Production code must not import it before the candidate is
// accepted and the M7 listener/security boundary has passed independent review.

import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from './remote-capability-requirements-v1.js';
import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from './remote-capability-manifests-v1.js';
import {
  validateMobileRemotePayload,
} from './remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1,
  MOBILE_REMOTE_SESSION_CONTRACT_V1,
  createRemoteInvocationProofBytesV1,
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

function findOperation(operationId) {
  for (const capability of MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities) {
    const operation = capability.operations.find(item => item.operationId === operationId);
    if (operation) {
      return {
        capabilityId: capability.capabilityId,
        capabilityVersion: capability.targetVersion,
        operation,
      };
    }
  }
  const operation = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1
    .controlPlanePrerequisite.operations.find(item => item.operationId === operationId);
  return operation ? {
    capabilityId: 'm7-control-plane-prerequisite',
    capabilityVersion: 1,
    operation,
  } : null;
}

function clientError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export const MOBILE_REMOTE_CANDIDATE_CLIENT_STAGE_V1 = 'TEST_ONLY_NOT_RUNTIME';

export const MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_V1 = deepFreeze({
  contract: 'MobileRemoteCoreCandidateClientDescriptor',
  version: 1,
  stage: MOBILE_REMOTE_CANDIDATE_CLIENT_STAGE_V1,
  authority: 'NONE',
  pins: {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    sessionContractDigest: MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1,
  },
  transport: {
    injectedOnly: true,
    network: 'none',
    backendImports: 'forbidden',
    automaticMutationRetry: 'forbidden',
  },
  guarantees: [
    'local_request_schema_validation',
    'strictly_monotonic_locally_issued_counter',
    'fresh_nonce_per_invocation',
    'ed25519_proof_over_every_invocation',
    'request_session_response_identity_binding',
    'bounded_in_flight_requests',
    'expired_or_revoked_session_stops_new_invocations',
  ],
});

export const MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_DIGEST_V1 =
  'sha256:e74b8c25ba2e92cd6ef05004fdf7cc2ab4dfd3ae43280681485d8cbf4a8fa45d';

export function createMobileRemoteCandidateClientV1({
  session,
  initialCounter = 0,
  transport,
  signInvocation,
  now = () => Date.now(),
  nonce = null,
  cryptoApi = globalThis.crypto,
  externalValidators = {},
} = {}) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new TypeError('mobile-remote-client:session-required');
  }
  if (!Number.isSafeInteger(initialCounter) || initialCounter < 0) {
    throw new TypeError('mobile-remote-client:invalid-initialCounter');
  }
  if (!transport || typeof transport.invoke !== 'function') {
    throw new TypeError('mobile-remote-client:transport-invoke-required');
  }
  if (typeof signInvocation !== 'function') {
    throw new TypeError('mobile-remote-client:signInvocation-required');
  }
  if (typeof now !== 'function') throw new TypeError('mobile-remote-client:now-required');
  if (!cryptoApi?.subtle || typeof cryptoApi.randomUUID !== 'function') {
    throw new TypeError('mobile-remote-client:crypto-required');
  }
  if (nonce !== null && typeof nonce !== 'function') {
    throw new TypeError('mobile-remote-client:nonce-must-be-function');
  }

  const boundSession = structuredClone(session);
  const nonceFactory = nonce || (() => cryptoApi.randomUUID());
  const maximumInFlight = MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.inFlightPerSessionMaximum;
  const issuedNonces = new Set();
  let issuedCounter = initialCounter;
  let inFlight = 0;
  let lifecycle = 'ACTIVE';

  async function invoke(operationId, payload) {
    if (lifecycle !== 'ACTIVE') {
      throw clientError(`REMOTE_SESSION_${lifecycle}`, `Remote session is ${lifecycle.toLowerCase()}.`);
    }
    if (inFlight >= maximumInFlight) {
      throw clientError('REMOTE_CLIENT_IN_FLIGHT_LIMIT', 'Remote client in-flight limit reached.');
    }
    const descriptor = findOperation(operationId);
    if (!descriptor) throw clientError('REMOTE_OPERATION_UNAVAILABLE', `Unknown operation ${operationId}.`);

    const payloadValidation = validateMobileRemotePayload(
      descriptor.operation.requestContract,
      payload,
      { externalValidators, context: `mobile-remote-client.${operationId}.payload` },
    );
    if (!payloadValidation.valid) {
      throw clientError(
        'REMOTE_CLIENT_REQUEST_INVALID',
        'Remote request failed local candidate validation.',
        { validationErrors: payloadValidation.errors },
      );
    }

    // Reserve before the first async boundary. Otherwise two calls can both
    // observe the old in-flight value while their payload digests are pending.
    inFlight += 1;
    try {
      // A counter and nonce are consumed by the conscious attempt even if the
      // transport later fails. Reusing either after an ambiguous failure would
      // turn recovery into replay; the next explicit read gets a new pair.
      issuedCounter += 1;
      const clientCounter = issuedCounter;
      const requestNonce = nonceFactory({ operationId, clientCounter });
      if (issuedNonces.has(requestNonce)) {
        throw clientError('REMOTE_CLIENT_NONCE_REUSED', 'Remote client nonce was already issued.');
      }
      issuedNonces.add(requestNonce);
      const sentAtMs = now();
      const unsignedEnvelope = {
        contract: 'RemoteInvocationEnvelope',
        version: 1,
        requestId: payload?.requestId,
        sessionId: boundSession.sessionId,
        deviceId: boundSession.deviceId,
        subjectId: boundSession.subjectId,
        sessionRevision: boundSession.sessionRevision,
        clientCounter,
        nonce: requestNonce,
        sentAt: new Date(sentAtMs).toISOString(),
        capabilityId: descriptor.capabilityId,
        capabilityVersion: descriptor.capabilityVersion,
        operationId,
        payload: structuredClone(payload),
        payloadDigest: await digestRemoteCoreValue(payload, cryptoApi),
        deviceSignature: '',
      };
      const deviceSignature = await signInvocation(
        createRemoteInvocationProofBytesV1(unsignedEnvelope),
        deepFreeze({ clientCounter, operationId, requestId: unsignedEnvelope.requestId }),
      );
      const envelope = { ...unsignedEnvelope, deviceSignature };
      const localValidation = await validateRemoteInvocationEnvelopeV1({
        envelope,
        session: boundSession,
        previousCounter: clientCounter - 1,
        nowMs: sentAtMs,
        cryptoApi,
        externalValidators,
      });
      if (!localValidation.valid) {
        throw clientError(
          'REMOTE_CLIENT_REQUEST_INVALID',
          'Remote request failed local candidate validation.',
          { validationErrors: localValidation.errors },
        );
      }

      const response = await transport.invoke(deepFreeze(envelope));

      const responseValidation = await validateRemoteResponseEnvelopeV1({
        requestEnvelope: envelope,
        responseEnvelope: response,
        session: boundSession,
        nowMs: now(),
        cryptoApi,
        externalValidators,
      });
      if (!responseValidation.valid) {
        throw clientError(
          'REMOTE_CLIENT_RESPONSE_INVALID',
          'Remote response failed candidate identity validation.',
          { validationErrors: responseValidation.errors },
        );
      }
      if (response.status === 'error') {
        if (response.error.code === 'REMOTE_SESSION_EXPIRED') lifecycle = 'EXPIRED';
        if (response.error.code === 'REMOTE_SESSION_REVOKED') lifecycle = 'REVOKED';
      }
      return response;
    } finally {
      inFlight -= 1;
    }
  }

  function inspect() {
    return deepFreeze({
      contract: 'MobileRemoteCoreCandidateClientSnapshot',
      version: 1,
      stage: MOBILE_REMOTE_CANDIDATE_CLIENT_STAGE_V1,
      lifecycle,
      issuedCounter,
      inFlight,
      maximumInFlight,
    });
  }

  return deepFreeze({ inspect, invoke });
}
