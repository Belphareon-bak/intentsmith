// Disconnected M7 request authority pipeline.
//
// This module deliberately owns no socket, listener, TLS private key or
// production credential. It consumes already observed raw transport metadata
// and body bytes, then composes the reviewed admission, durable rate-limit,
// session and in-process provider boundaries in their security order.

import { createHash, randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { createM7CoreComposition } from './m7-core-composition.js';
import { isGenuineM7DurableRateLimiter } from './m7-durable-rate-limiter.js';
import {
  isGenuineM7SessionAuthority,
} from './m7-session-authority.js';
import {
  canonicalizeM7SessionValue,
  digestM7SessionValue,
} from './m7-session-authority-validation.js';
import {
  isGenuineM7TransportAdmissionPolicy,
} from './m7-transport-admission-policy.js';

export const M7_DISCONNECTED_REQUEST_PIPELINE_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_DISCONNECTED_REQUEST_PIPELINE_ERROR = Object.freeze({
  BODY_INVALID: 'M7_DISCONNECTED_BODY_INVALID',
  CONFIG_INVALID: 'M7_DISCONNECTED_CONFIG_INVALID',
  IN_FLIGHT_LIMIT: 'M7_DISCONNECTED_IN_FLIGHT_LIMIT',
  INVOCATION_BINDING_INVALID: 'M7_DISCONNECTED_INVOCATION_BINDING_INVALID',
  RATE_LIMITED: 'M7_DISCONNECTED_RATE_LIMITED',
  ROUTE_INVALID: 'M7_DISCONNECTED_ROUTE_INVALID',
});

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const pipelines = new WeakSet();

export class M7DisconnectedRequestPipelineError extends Error {
  constructor(code, message, details = {}) {
    super(`m7-disconnected:${message}`);
    this.name = 'M7DisconnectedRequestPipelineError';
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new M7DisconnectedRequestPipelineError(code, message, details);
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

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function safeCanonical(value) {
  try {
    return canonicalizeM7SessionValue(value);
  } catch {
    fail(
      M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.INVOCATION_BINDING_INVALID,
      'canonical-binding-invalid',
    );
  }
}

function rawSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function textSha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function buildOperationMap() {
  const entries = [];
  for (const capability of MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities) {
    for (const operation of capability.operations) {
      entries.push([operation.operationId, deepFreeze({
        capabilityId: capability.capabilityId,
        capabilityVersion: capability.targetVersion,
        kind: operation.kind === 'read' ? 'read' : 'mutation',
        requiredScopes: [...operation.requiredScopes],
      })]);
    }
  }
  for (const operation of MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1
    .controlPlanePrerequisite.operations) {
    entries.push([operation.operationId, deepFreeze({
      capabilityId: 'm7-control-plane-prerequisite',
      capabilityVersion: 1,
      kind: operation.kind === 'read' ? 'read' : 'mutation',
      requiredScopes: [...operation.requiredScopes],
    })]);
  }
  if (new Set(entries.map(([operationId]) => operationId)).size !== entries.length) {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'operation-set-ambiguous');
  }
  return new Map(entries);
}

const OPERATIONS = buildOperationMap();

function decodeCanonicalBody(bytes) {
  let text;
  let value;
  try {
    text = utf8Decoder.decode(bytes);
    value = JSON.parse(text);
  } catch {
    return Object.freeze({ error: 'json-or-utf8-invalid', value: null });
  }
  if (!plain(value)) return Object.freeze({ error: 'body-object-required', value: null });
  try {
    if (canonicalizeM7SessionValue(value) !== text) {
      return Object.freeze({ error: 'canonical-json-required', value: null });
    }
  } catch {
    return Object.freeze({ error: 'canonical-json-invalid', value: null });
  }
  return Object.freeze({ error: null, value: deepFreeze(value) });
}

function validateCoreConfig(coreConfig) {
  if (!plain(coreConfig) || Object.hasOwn(coreConfig, 'authorityResolver')) {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'core-config-invalid');
  }
  return coreConfig;
}

function sanitizeProviderError(error, operation) {
  const unavailable = [
    'M7_PROVIDER_CAPABILITY_UNAVAILABLE',
    'M7_PROVIDER_OPERATION_UNAVAILABLE',
  ].includes(error?.code);
  const outcomeUnknown = error?.code === 'M7_PROVIDER_JOURNAL_PROTOCOL';
  const inFlight = error?.code === M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.IN_FLIGHT_LIMIT;
  return deepFreeze({
    code: inFlight
      ? 'REMOTE_SESSION_IN_FLIGHT_LIMIT'
      : unavailable
      ? 'REMOTE_CAPABILITY_UNAVAILABLE'
      : outcomeUnknown
        ? 'REMOTE_OPERATION_OUTCOME_UNKNOWN'
        : 'REMOTE_OPERATION_FAILED',
    message: inFlight
      ? 'Another request is already active for this session.'
      : unavailable
      ? 'The requested remote capability is unavailable.'
      : outcomeUnknown
        ? 'The remote mutation outcome is unknown; inspect the operation record.'
        : 'The remote operation failed.',
    retryable: inFlight || (!unavailable && operation.kind === 'read' && !outcomeUnknown),
  });
}

function responseEnvelope(envelope, payload, error, respondedAtMs) {
  if (!Number.isSafeInteger(respondedAtMs) || respondedAtMs < 1) {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'clock-invalid');
  }
  const status = error === null ? 'ok' : 'error';
  return deepFreeze({
    contract: 'RemoteResponseEnvelope',
    version: 1,
    requestId: envelope.requestId,
    sessionId: envelope.sessionId,
    deviceId: envelope.deviceId,
    subjectId: envelope.subjectId,
    sessionRevision: envelope.sessionRevision,
    acceptedCounter: envelope.clientCounter,
    respondedAt: new Date(respondedAtMs).toISOString(),
    status,
    payload: status === 'ok' ? payload : null,
    payloadDigest: status === 'ok' ? digestM7SessionValue(payload) : null,
    error,
  });
}

export function createM7DisconnectedRequestPipeline({
  admissionPolicy,
  coreConfig,
  rateLimiter,
  requireCompleteCapabilities = false,
  sessionAuthority,
} = {}) {
  if (!isGenuineM7TransportAdmissionPolicy(admissionPolicy)
    || !isGenuineM7DurableRateLimiter(rateLimiter)
    || !isGenuineM7SessionAuthority(sessionAuthority)) {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'genuine-authorities-required');
  }
  if (typeof requireCompleteCapabilities !== 'boolean') {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'completion-policy-invalid');
  }
  const trustedCoreConfig = validateCoreConfig(coreConfig);
  if (admissionPolicy.listener.serverOrigin !== sessionAuthority.serverOrigin
    || admissionPolicy.listener.serverIdentityPin !== sessionAuthority.serverIdentityPin) {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'server-binding-mismatch');
  }
  const clock = trustedCoreConfig.clock ?? Date.now;
  if (typeof clock !== 'function') {
    fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'clock-required');
  }
  const invocationStates = new Map();
  const activeSessionRevisions = new Set();

  const authorityResolver = async (input) => {
    if (!exactKeys(input?.context, ['pipelineInvocationId', 'invocationEnvelope'])) {
      fail(
        M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.INVOCATION_BINDING_INVALID,
        'provider-context-invalid',
      );
    }
    const state = invocationStates.get(input.context.pipelineInvocationId);
    const envelope = input.context.invocationEnvelope;
    if (!state || state.envelope !== safeCanonical(envelope)) {
      fail(
        M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.INVOCATION_BINDING_INVALID,
        'provider-context-not-issued',
      );
    }
    const operation = OPERATIONS.get(envelope.operationId);
    if (!operation
      || operation.capabilityId !== input.capabilityId
      || operation.capabilityVersion !== envelope.capabilityVersion
      || envelope.capabilityId !== input.capabilityId
      || envelope.operationId !== input.operationId
      || safeCanonical(envelope.payload) !== safeCanonical(input.request)
      || safeCanonical(operation.requiredScopes) !== safeCanonical(input.requiredScopes)) {
      fail(
        M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.INVOCATION_BINDING_INVALID,
        'signed-provider-binding-mismatch',
      );
    }
    const decision = sessionAuthority.authorizeInvocation(envelope);
    state.authorized = true;
    state.operation = operation;
    if (safeCanonical(decision.grantedScopes) !== safeCanonical(input.requiredScopes)) {
      fail(
        M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.INVOCATION_BINDING_INVALID,
        'scope-authority-mismatch',
      );
    }
    if (activeSessionRevisions.has(envelope.sessionRevision)) {
      fail(
        M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.IN_FLIGHT_LIMIT,
        'session-in-flight-limit',
      );
    }
    activeSessionRevisions.add(envelope.sessionRevision);
    state.sessionRevision = envelope.sessionRevision;
    return decision;
  };

  const composition = createM7CoreComposition({
    ...trustedCoreConfig,
    authorityResolver,
  });
  if (requireCompleteCapabilities) {
    const advertised = composition.provider.advertise();
    const required = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
      .map(capability => capability.capabilityId)
      .sort();
    const available = advertised
      .filter(capability => capability.status === 'available')
      .map(capability => capability.capabilityId)
      .sort();
    if (canonicalizeM7SessionValue(available) !== canonicalizeM7SessionValue(required)) {
      fail(
        M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID,
        'complete-capability-set-required',
      );
    }
  }

  const pipeline = {
    stage: M7_DISCONNECTED_REQUEST_PIPELINE_STAGE,
    describe() {
      return deepFreeze({
        contract: 'M7DisconnectedRequestPipeline',
        version: 1,
        stage: M7_DISCONNECTED_REQUEST_PIPELINE_STAGE,
        listener: 'absent',
        transport: 'disconnected',
        serverOrigin: admissionPolicy.listener.serverOrigin,
        serverIdentityPin: admissionPolicy.listener.serverIdentityPin,
      });
    },
    async dispatch(input) {
      if (!pipelines.has(this) || !exactKeys(input, ['bodyBytes', 'transport'])) {
        fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.CONFIG_INVALID, 'dispatch-input-invalid');
      }
      const bodyBytes = Buffer.isBuffer(input.bodyBytes) || input.bodyBytes instanceof Uint8Array
        ? Buffer.from(input.bodyBytes)
        : null;
      if (bodyBytes === null) {
        fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.BODY_INVALID, 'body-bytes-required');
      }
      const admission = admissionPolicy.admit(input.transport);
      if (bodyBytes.length !== admission.contentLength
        || bodyBytes.length > admission.bodyBytesMaximum) {
        fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.BODY_INVALID, 'content-length-mismatch');
      }

      let decoded = Object.freeze({ error: null, value: null });
      if (admission.access !== 'public_health') decoded = decodeCanonicalBody(bodyBytes);
      let rateContext = {};
      let operation = null;
      if (admission.access === 'pairing_claim') {
        const claimCode = decoded.value?.claimCode;
        rateContext = {
          claimCodeDigest: typeof claimCode === 'string'
            ? textSha256(claimCode)
            : rawSha256(bodyBytes),
        };
      } else if (admission.access === 'signed_invocation') {
        operation = OPERATIONS.get(decoded.value?.operationId) ?? null;
        rateContext = { operationKind: operation?.kind ?? 'mutation' };
      }
      const plan = admissionPolicy.createRateLimitPlan(admission, rateContext);
      const rateDecision = rateLimiter.consume(plan);
      if (rateDecision.allowed !== true) {
        fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.RATE_LIMITED, 'rate-limited', {
          limitedBuckets: [...rateDecision.limitedBuckets],
          retryAfterSeconds: rateDecision.retryAfterSeconds,
          routeId: rateDecision.routeId,
        });
      }
      if (admission.access === 'public_health') {
        return composition.adapters.health.readHealth(deepFreeze({
          contract: 'RemoteHealthQuery',
          version: 1,
          requestId: admission.requestId,
        }));
      }
      if (decoded.error !== null) {
        fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.BODY_INVALID, decoded.error);
      }
      const body = decoded.value;
      switch (admission.routeId) {
        case 'pairing-claim': return sessionAuthority.claimPairing(body);
        case 'session-challenge': return sessionAuthority.requestChallenge(body);
        case 'session-open': return sessionAuthority.openSession(body);
        case 'session-refresh': return sessionAuthority.refreshSession(body);
        case 'session-revoke': return sessionAuthority.revokeSession(body);
        case 'invoke': {
          if (operation === null
            || operation.capabilityId !== body.capabilityId
            || operation.capabilityVersion !== body.capabilityVersion) {
            fail(
              M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.INVOCATION_BINDING_INVALID,
              'operation-identity-invalid',
            );
          }
          const pipelineInvocationId = randomBytes(24).toString('base64url');
          const state = {
            authorized: false,
            envelope: safeCanonical(body),
            operation,
            sessionRevision: null,
          };
          invocationStates.set(pipelineInvocationId, state);
          try {
            const result = await composition.provider.invoke({
              capabilityId: body.capabilityId,
              capabilityVersion: body.capabilityVersion,
              operationId: body.operationId,
              request: body.payload,
            }, { invocationEnvelope: body, pipelineInvocationId });
            return responseEnvelope(body, result, null, clock());
          } catch (error) {
            if (!state.authorized) throw error;
            return responseEnvelope(body, null, sanitizeProviderError(error, state.operation), clock());
          } finally {
            invocationStates.delete(pipelineInvocationId);
            if (state.sessionRevision !== null) {
              activeSessionRevisions.delete(state.sessionRevision);
            }
          }
        }
        default: fail(M7_DISCONNECTED_REQUEST_PIPELINE_ERROR.ROUTE_INVALID, 'route-not-dispatched');
      }
    },
  };
  Object.freeze(pipeline);
  pipelines.add(pipeline);
  return pipeline;
}

export function isGenuineM7DisconnectedRequestPipeline(value) {
  return pipelines.has(value);
}

export default createM7DisconnectedRequestPipeline;
