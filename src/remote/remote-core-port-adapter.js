import {
  M2_REMOTE_CORE_CAPABILITY_STATUS,
  M2_REMOTE_CORE_ERROR_CODE,
  M2_REMOTE_CORE_NEGOTIATION_STATUS,
  M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
  M2_REMOTE_CORE_PORT_DESCRIPTOR_V1,
  M2_REMOTE_CORE_PORT_KIND,
  M2_REMOTE_CORE_PORT_VERSION,
  computeM2RemoteCoreHelloDigest,
  selectM2RemoteCorePortVersion,
  validateM2RemoteCoreHello,
  validateM2RemoteCoreNegotiationForHello,
} from '../../contracts/m2/remote-core-port-v1.js';
import {
  M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
  M5_REMOTE_CORE_ADAPTER_MANIFEST_V1,
  M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1,
  M5_REMOTE_CORE_OPERATION,
} from '../../contracts/m5/remote-core-adapter-v1.js';
import {
  validateConversationCommand,
  validateConversationResult,
} from '../../contracts/m1/index.js';
import {
  normalizeProjectContextQuery,
  validateProjectContextQuery,
  validateProjectContextSnapshot,
} from '../../contracts/m2/project-context-v1.js';

export const M5_REMOTE_CORE_ADAPTER_ERROR = Object.freeze({
  CAPABILITY_NOT_NEGOTIATED: 'REMOTE_CORE_CAPABILITY_NOT_NEGOTIATED',
  IDENTITY_MISMATCH: 'REMOTE_CORE_RESULT_IDENTITY_MISMATCH',
  INVALID_INVOCATION: 'REMOTE_CORE_INVALID_INVOCATION',
  INVALID_REQUEST: 'REMOTE_CORE_INVALID_REQUEST',
  INVALID_RESULT: 'REMOTE_CORE_INVALID_RESULT',
  NEGOTIATION_MISMATCH: 'REMOTE_CORE_NEGOTIATION_MISMATCH',
  OPERATION_UNAVAILABLE: 'REMOTE_CORE_OPERATION_UNAVAILABLE',
});

const IMPLEMENTED_CAPABILITIES = Object.freeze(['conversations', 'projects']);
const INVOCATION_KEYS = Object.freeze([
  'capabilityId',
  'capabilityVersion',
  'hello',
  'negotiation',
  'operationId',
  'request',
]);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function canonicalNow(clock) {
  const value = clock();
  if (!Number.isFinite(value)) fail(
    M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_INVOCATION,
    'remote-core-adapter:clock-invalid',
  );
  return new Date(value).toISOString();
}

function capabilityError(code, capabilityId, message) {
  return {
    capabilityId,
    status: code === M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_VERSION_INCOMPATIBLE
      ? M2_REMOTE_CORE_CAPABILITY_STATUS.INCOMPATIBLE
      : M2_REMOTE_CORE_CAPABILITY_STATUS.UNAVAILABLE,
    selectedVersion: null,
    contractDigest: null,
    operationsDigest: null,
    error: { code, message, retryable: false },
  };
}

function requireHello(hello) {
  const validation = validateM2RemoteCoreHello(hello);
  if (!validation.valid) fail(
    M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_INVOCATION,
    validation.errors.join(','),
  );
  return hello;
}

function resolveHandler(handlers, capabilityId) {
  const handler = handlers[capabilityId];
  return typeof handler === 'function' ? handler : null;
}

function buildNegotiation(hello, negotiatedAt, handlers) {
  const selectedPortVersion = selectM2RemoteCorePortVersion(hello.supportedPortVersions);
  const common = {
    contract: M2_REMOTE_CORE_PORT_KIND.NEGOTIATION,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: hello.requestId,
    helloDigest: computeM2RemoteCoreHelloDigest(hello),
    descriptorDigest: M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
    negotiatedAt,
  };
  if (selectedPortVersion === null) {
    return deepFreeze({
      ...common,
      status: M2_REMOTE_CORE_NEGOTIATION_STATUS.INCOMPATIBLE,
      selectedPortVersion: null,
      capabilities: [],
      error: {
        code: M2_REMOTE_CORE_ERROR_CODE.PORT_VERSION_INCOMPATIBLE,
        message: 'No explicitly supported RemoteCorePort version is shared.',
        retryable: false,
      },
    });
  }

  const capabilities = hello.capabilities.map(requested => {
    const manifest = M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1[requested.capabilityId];
    if (!manifest || !resolveHandler(handlers, requested.capabilityId)) {
      return capabilityError(
        M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_UNAVAILABLE,
        requested.capabilityId,
        `Remote core capability ${requested.capabilityId} is unavailable.`,
      );
    }
    if (!requested.versions.includes(manifest.version)) {
      return capabilityError(
        M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_VERSION_INCOMPATIBLE,
        requested.capabilityId,
        `No supported version is shared for ${requested.capabilityId}.`,
      );
    }
    return {
      capabilityId: requested.capabilityId,
      status: M2_REMOTE_CORE_CAPABILITY_STATUS.AVAILABLE,
      selectedVersion: manifest.version,
      contractDigest: manifest.contractDigest,
      operationsDigest: manifest.operationsDigest,
      error: null,
    };
  });
  const available = capabilities.some(item => (
    item.status === M2_REMOTE_CORE_CAPABILITY_STATUS.AVAILABLE
  ));
  return deepFreeze({
    ...common,
    status: available
      ? M2_REMOTE_CORE_NEGOTIATION_STATUS.NEGOTIATED
      : M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE,
    selectedPortVersion,
    capabilities,
    error: available ? null : {
      code: M2_REMOTE_CORE_ERROR_CODE.NO_CAPABILITY_AVAILABLE,
      message: 'No requested remote core capability is currently available.',
      retryable: false,
    },
  });
}

function validateInvocationEnvelope(invocation) {
  if (!exactKeys(invocation, INVOCATION_KEYS)) fail(
    M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_INVOCATION,
    'remote-core-adapter:invalid-invocation-envelope',
  );
  const hello = requireHello(invocation.hello);
  const negotiationValidation = validateM2RemoteCoreNegotiationForHello(
    hello,
    invocation.negotiation,
  );
  if (!negotiationValidation.valid) fail(
    M5_REMOTE_CORE_ADAPTER_ERROR.NEGOTIATION_MISMATCH,
    negotiationValidation.errors.join(','),
  );
  if (invocation.negotiation.status !== M2_REMOTE_CORE_NEGOTIATION_STATUS.NEGOTIATED) {
    fail(
      M5_REMOTE_CORE_ADAPTER_ERROR.CAPABILITY_NOT_NEGOTIATED,
      'remote-core-adapter:negotiation-not-available',
    );
  }
  const manifest = M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1[invocation.capabilityId];
  const negotiated = invocation.negotiation.capabilities.find(item => (
    item.capabilityId === invocation.capabilityId
  ));
  if (
    !manifest
    || !negotiated
    || negotiated.status !== M2_REMOTE_CORE_CAPABILITY_STATUS.AVAILABLE
    || invocation.capabilityVersion !== manifest.version
    || negotiated.selectedVersion !== manifest.version
    || negotiated.contractDigest !== manifest.contractDigest
    || negotiated.operationsDigest !== manifest.operationsDigest
  ) fail(
    M5_REMOTE_CORE_ADAPTER_ERROR.CAPABILITY_NOT_NEGOTIATED,
    'remote-core-adapter:capability-not-exactly-negotiated',
  );
  const operation = manifest.operationManifest.operations.find(item => (
    item.operationId === invocation.operationId
  ));
  if (!operation) fail(
    M5_REMOTE_CORE_ADAPTER_ERROR.OPERATION_UNAVAILABLE,
    'remote-core-adapter:operation-unavailable',
  );
  return { hello, manifest };
}

function validatePayload(validation, errorCode) {
  if (!validation.valid) fail(errorCode, validation.errors.join(','));
}

function validateResultIdentity(capabilityId, request, result) {
  if (result.requestId !== request.requestId) return false;
  if (capabilityId === 'conversations') {
    return result.conversationId === request.conversationId && result.turnId === request.turnId;
  }
  if (result.projectId !== request.projectId) return false;
  if (result.status !== 'ok') return true;
  const normalized = normalizeProjectContextQuery(request.queryText);
  return result.workspaceRevision === request.workspaceRevision
    && result.normalizedQuery === normalized.normalizedQuery
    && result.budget.maxFiles === request.maxFiles
    && result.budget.maxBytes === request.maxBytes
    && result.budget.maxTokens === request.maxTokens;
}

/**
 * In-process core adapter only. Invocation context is supplied by the trusted
 * core caller and is deliberately not part of the wire hello. M7 owns the
 * listener, authentication, device authority, pairing and revocation layer.
 */
export function createM5RemoteCorePortAdapter({
  clock = Date.now,
  executeConversation = null,
  queryProjectContext = null,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('remote-core-adapter:clock-required');
  const handlers = Object.freeze({
    conversations: executeConversation,
    projects: queryProjectContext,
  });
  return Object.freeze({
    describe() {
      return M2_REMOTE_CORE_PORT_DESCRIPTOR_V1;
    },
    verification() {
      return Object.freeze({
        manifest: M5_REMOTE_CORE_ADAPTER_MANIFEST_V1,
        manifestDigest: M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
      });
    },
    negotiate(helloValue) {
      const hello = requireHello(helloValue);
      const result = buildNegotiation(hello, canonicalNow(clock), handlers);
      const validation = validateM2RemoteCoreNegotiationForHello(hello, result);
      if (!validation.valid) fail(
        M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_RESULT,
        validation.errors.join(','),
      );
      return result;
    },
    async invoke(invocation, invocationContext = Object.freeze({})) {
      validateInvocationEnvelope(invocation);
      const handler = resolveHandler(handlers, invocation.capabilityId);
      if (!handler) fail(
        M5_REMOTE_CORE_ADAPTER_ERROR.CAPABILITY_NOT_NEGOTIATED,
        'remote-core-adapter:handler-unavailable',
      );
      if (invocation.capabilityId === 'conversations') {
        if (invocation.operationId !== M5_REMOTE_CORE_OPERATION.CONVERSATION_EXECUTE) {
          fail(M5_REMOTE_CORE_ADAPTER_ERROR.OPERATION_UNAVAILABLE, 'remote-core-adapter:operation');
        }
        validatePayload(
          validateConversationCommand(invocation.request),
          M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_REQUEST,
        );
      } else if (invocation.capabilityId === 'projects') {
        if (invocation.operationId !== M5_REMOTE_CORE_OPERATION.PROJECT_CONTEXT_QUERY) {
          fail(M5_REMOTE_CORE_ADAPTER_ERROR.OPERATION_UNAVAILABLE, 'remote-core-adapter:operation');
        }
        validatePayload(
          validateProjectContextQuery(invocation.request),
          M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_REQUEST,
        );
      }
      const result = await handler(invocation.request, invocationContext);
      validatePayload(
        invocation.capabilityId === 'conversations'
          ? validateConversationResult(result)
          : validateProjectContextSnapshot(result),
        M5_REMOTE_CORE_ADAPTER_ERROR.INVALID_RESULT,
      );
      if (!validateResultIdentity(invocation.capabilityId, invocation.request, result)) fail(
        M5_REMOTE_CORE_ADAPTER_ERROR.IDENTITY_MISMATCH,
        'remote-core-adapter:result-identity-mismatch',
      );
      return deepFreeze(structuredClone(result));
    },
  });
}

export const M5_REMOTE_CORE_IMPLEMENTED_CAPABILITIES = IMPLEMENTED_CAPABILITIES;

export default createM5RemoteCorePortAdapter;
