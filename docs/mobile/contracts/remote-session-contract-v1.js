// IntentSmith Remote Companion session/security contract — mobile-owned candidate
// =============================================================================
//
// This module is an executable review candidate. It does not open a listener,
// mint a credential, perform pairing, import backend state, or authorize a
// production transport. M7 must accept and implement a separately reviewed
// security boundary before any runtime may consume it.

import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
  validateMobileRemoteOperationPair,
} from './remote-capability-manifests-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from './remote-capability-requirements-v1.js';
import {
  validateMobileRemotePayload,
} from './remote-capability-payloads-v1.js';
import {
  canonicalizeRemoteCoreValue,
  digestRemoteCoreValue,
  REMOTE_CORE_V1_PIN,
} from '../../../src/mobile/client/remote-core-v1.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_:-]{0,95}$/;
const PAIRING_CODE = /^[A-Za-z0-9_-]{22,64}$/;
const ED25519_PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const ED25519_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, context) {
  if (!plain(value)) return [`${context}:not-object`];
  const expected = new Set(keys);
  const errors = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${context}:missing-${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) errors.push(`${context}:unknown-${key}`);
  }
  return errors;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function sortedUnique(values) {
  return Array.isArray(values)
    && values.every(value => typeof value === 'string' && value.length > 0)
    && values.every((value, index) => index === 0 || values[index - 1] < value);
}

function exactHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.origin === value;
  } catch {
    return false;
  }
}

function validateError(value, context) {
  const errors = exactKeys(value, ['code', 'message', 'retryable'], context);
  if (!plain(value)) return errors;
  if (!ERROR_CODE.test(value.code || '')) errors.push(`${context}:invalid-code`);
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 512) {
    errors.push(`${context}:invalid-message`);
  }
  if (typeof value.retryable !== 'boolean') errors.push(`${context}:invalid-retryable`);
  return errors;
}

function findOperation(operationId) {
  for (const capability of MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities) {
    const operation = capability.operations.find(item => item.operationId === operationId);
    if (operation) return {
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.targetVersion,
      operation,
    };
  }
  const operation = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1
    .controlPlanePrerequisite.operations.find(item => item.operationId === operationId);
  return operation ? {
    capabilityId: 'm7-control-plane-prerequisite',
    capabilityVersion: 1,
    operation,
  } : null;
}

const PAIRING_TRANSITIONS = {
  UNPAIRED: { START_CLAIM: 'CLAIM_PENDING' },
  CLAIM_PENDING: { CLAIM_CONFIRMED: 'PAIRED', CLAIM_EXPIRED: 'UNPAIRED', CLAIM_REJECTED: 'UNPAIRED' },
  PAIRED: { EXPIRE: 'EXPIRED', REVOKE: 'REVOKED' },
  EXPIRED: { START_CLAIM: 'CLAIM_PENDING' },
  REVOKED: { START_CLAIM: 'CLAIM_PENDING' },
};

const SESSION_TRANSITIONS = {
  ABSENT: { OPEN_CONFIRMED: 'ACTIVE' },
  ACTIVE: { BEGIN_REFRESH: 'REFRESHING', EXPIRE: 'EXPIRED', REVOKE: 'REVOKED' },
  REFRESHING: { REFRESH_CONFIRMED: 'ACTIVE', REFRESH_FAILED: 'EXPIRED', REVOKE: 'REVOKED' },
  EXPIRED: { OPEN_CONFIRMED: 'ACTIVE' },
  REVOKED: {},
};

const CONTROL_EXCHANGES = {
  'RemotePairingClaimRequest@1': {
    resultSchemaId: 'RemotePairingClaimResult@1',
    requestResultBindings: ['requestId', 'deviceKeyId'],
    trustedContext: 'none',
  },
  'RemoteSessionOpenRequest@1': {
    resultSchemaId: 'RemoteSessionOpenResult@1',
    requestResultBindings: ['requestId', 'deviceId', 'pairingRevision'],
    trustedContext: 'validated_session_negotiation',
  },
  'RemoteSessionRefreshRequest@1': {
    resultSchemaId: 'RemoteSessionRefreshResult@1',
    requestResultBindings: ['requestId', 'sessionId', 'deviceId', 'subjectId'],
    trustedContext: 'active_session',
  },
  'RemoteSessionRevokeRequest@1': {
    resultSchemaId: 'RemoteSessionRevokeResult@1',
    requestResultBindings: ['requestId', 'deviceId', 'subjectId'],
    trustedContext: 'active_session',
  },
};

export const MOBILE_REMOTE_SESSION_CONTRACT_STAGE_V1 = 'CANDIDATE_NOT_ACCEPTED';

export const MOBILE_REMOTE_SESSION_CONTRACT_V1 = deepFreeze({
  contract: 'RemoteSessionContract',
  version: 1,
  stage: MOBILE_REMOTE_SESSION_CONTRACT_STAGE_V1,
  authority: 'MOBILE_CONSUMER_REQUIREMENTS_ONLY',
  sources: {
    remoteCoreDescriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
    candidateAdapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
  },
  activation: {
    backendImplementation: 'absent',
    productionImport: 'forbidden_until_operator_acceptance_and_m7_security_review',
    runtimeAuthority: 'none',
  },
  listenerBoundary: {
    topology: 'dedicated_remote_listener',
    minimumTlsVersion: 'TLSv1.3',
    serverIdentity: 'sha256_spki_pin',
    deviceProof: 'ed25519_signed_server_nonce',
    allowedPaths: [
      '/remote/v1/health',
      '/remote/v1/invoke',
      '/remote/v1/pairing/claim',
      '/remote/v1/session/open',
      '/remote/v1/session/refresh',
      '/remote/v1/session/revoke',
    ],
    forbiddenPathPrefixes: ['/api/', '/c3/ws', '/m1/'],
    redirects: 'forbidden',
    cookies: 'forbidden',
    queryCredentials: 'forbidden',
  },
  identityBinding: {
    immutableTransportFields: [
      'deviceId', 'pairingRevision', 'sessionId', 'sessionRevision', 'subjectId',
    ],
    requestMayAssertScopes: false,
    requestMayAssertSubject: false,
    requestMaySelectProjectRoot: false,
    sessionBoundTo: [
      'adapterManifestDigest', 'clientBuild', 'deviceKeyId', 'pairingRevision',
      'serverIdentityPin', 'serverOrigin', 'subjectId',
    ],
  },
  pairing: {
    states: Object.keys(PAIRING_TRANSITIONS),
    transitions: PAIRING_TRANSITIONS,
    claimCodeEntropyBitsMinimum: 128,
    claimTtlSecondsMaximum: 300,
    attemptsPerWindowMaximum: 5,
    attemptWindowSeconds: 600,
    serverIssuedFields: ['deviceId', 'pairingRevision', 'scopes', 'subjectId'],
    reactivationAfterRevoke: 'new_pairing_revision_and_new_device_proof_required',
  },
  session: {
    states: Object.keys(SESSION_TRANSITIONS),
    transitions: SESSION_TRANSITIONS,
    lifetimeSecondsMaximum: 900,
    refreshBeforeExpirySecondsMaximum: 300,
    clockSkewSecondsMaximum: 60,
    nonceUse: 'single_use_per_session',
    counterUse: 'strictly_monotonic_serialized_per_session',
    revokeEffect: 'session_and_device_cache_untrusted_immediately',
    scopeLossEffect: 'affected_cache_partition_untrusted_immediately',
  },
  deviceProof: {
    algorithm: 'Ed25519',
    signedControlRequests: [
      'RemoteSessionOpenRequest@1',
      'RemoteSessionRefreshRequest@1',
      'RemoteSessionRevokeRequest@1',
    ],
    signatureField: 'deviceSignature',
    canonicalForm: 'remote_core_canonical_json_without_signature_field',
    domainPrefix: 'IntentSmith/M7/<schemaId>/Ed25519DeviceProof/v1\\n',
  },
  cursorAuthority: {
    binding: [
      'capabilityId', 'capabilityVersion', 'deviceId', 'limit', 'operationId',
      'queryDigest', 'sessionRevision', 'snapshotRevision', 'subjectId',
    ],
    implicitRebind: 'reject',
    expiryRequired: true,
  },
  recoveryAuthority: {
    mutationIdentity: 'device_subject_operation_id_request_digest',
    sameIdentitySamePayload: 'idempotent_replay',
    sameIdentityDifferentPayload: 'REMOTE_OPERATION_CONFLICT',
    unknownOutcome: 'explicit_operation_lookup_no_automatic_retry',
    abandonMeaning: 'stop_device_recovery_not_rollback_or_effect_denial',
  },
  controlMessages: {
    'RemotePairingClaimRequest@1': {
      path: '/remote/v1/pairing/claim',
      requiredFields: [
        'claimCode', 'clientBuild', 'clientInstanceId', 'clientNonce', 'contract',
        'deviceKeyId', 'devicePublicKey', 'requestId', 'sentAt', 'version',
      ],
    },
    'RemotePairingClaimResult@1': {
      requiredFields: [
        'contract', 'deviceId', 'deviceKeyId', 'error', 'pairedAt',
        'pairingRevision', 'requestId', 'scopes', 'status', 'subjectId', 'version',
      ],
    },
    'RemoteSessionOpenRequest@1': {
      path: '/remote/v1/session/open',
      requiredFields: [
        'clientBuild', 'clientInstanceId', 'contract', 'deviceId', 'deviceKeyId',
        'deviceSignature', 'pairingRevision', 'requestId', 'sentAt', 'serverNonce',
        'version',
      ],
    },
    'RemoteSessionOpenResult@1': {
      requiredFields: [
        'adapterManifestDigest', 'contract', 'deviceId', 'error', 'expiresAt',
        'issuedAt', 'pairingRevision', 'requestId', 'scopes', 'serverIdentityPin',
        'serverOrigin', 'sessionId', 'sessionRevision', 'status', 'subjectId', 'version',
      ],
    },
    'RemoteSessionRefreshRequest@1': {
      path: '/remote/v1/session/refresh',
      requiredFields: [
        'clientCounter', 'clientNonce', 'contract', 'deviceId', 'deviceSignature',
        'requestId', 'sentAt', 'serverNonce', 'sessionId', 'sessionRevision',
        'subjectId', 'version',
      ],
    },
    'RemoteSessionRefreshResult@1': {
      requiredFields: [
        'adapterManifestDigest', 'contract', 'deviceId', 'error', 'expiresAt',
        'issuedAt', 'pairingRevision', 'requestId', 'scopes', 'serverIdentityPin',
        'serverOrigin', 'sessionId', 'sessionRevision', 'status', 'subjectId', 'version',
      ],
    },
    'RemoteSessionRevokeRequest@1': {
      path: '/remote/v1/session/revoke',
      requiredFields: [
        'clientCounter', 'clientNonce', 'contract', 'deviceId', 'deviceSignature',
        'reason', 'requestId', 'sentAt', 'sessionId', 'sessionRevision',
        'subjectId', 'version',
      ],
    },
    'RemoteSessionRevokeResult@1': {
      requiredFields: [
        'contract', 'deviceId', 'error', 'pairingRevision', 'requestId',
        'revokedAt', 'sessionRevision', 'status', 'subjectId', 'version',
      ],
    },
  },
  controlExchangeBindings: CONTROL_EXCHANGES,
  resourceLimits: {
    envelopeBytesMaximum: 1_048_576,
    payloadBytesMaximum: 262_144,
    inFlightPerSessionMaximum: 1,
    readRequestsPerMinuteMaximum: 60,
    mutationRequestsPerMinuteMaximum: 10,
    pageItemsMaximum: 100,
    longPollMillisecondsMaximum: 30_000,
  },
  threatModel: [
    { threat: 'credential_replay', control: 'signed_nonce_monotonic_counter_and_expiry' },
    { threat: 'subject_substitution', control: 'immutable_transport_subject_result_binding' },
    { threat: 'device_cloning', control: 'device_key_proof_and_pairing_revision' },
    { threat: 'stolen_session_token', control: 'short_lifetime_device_proof_and_revocation' },
    { threat: 'protocol_downgrade', control: 'exact_version_and_digest_negotiation_no_implicit_fallback' },
    { threat: 'cursor_rebinding', control: 'subject_device_query_snapshot_and_limit_binding' },
    { threat: 'cross_device_operation_access', control: 'device_subject_operation_partition' },
    { threat: 'legacy_route_bypass', control: 'dedicated_listener_path_allowlist_and_negative_reachability' },
    { threat: 'server_impersonation', control: 'tls13_and_expected_spki_pin' },
    { threat: 'resource_exhaustion', control: 'bounded_envelopes_pages_concurrency_and_rate' },
    { threat: 'sensitive_log_exfiltration', control: 'identifiers_and_digests_only_no_payload_logging' },
  ],
});

// Filled from the canonical JSON representation and guarded by the focused
// contract test. A change requires a new digest and re-review.
export const MOBILE_REMOTE_SESSION_CONTRACT_DIGEST_V1 =
  'sha256:a5156bbffa5649c550fe98516f1e2ce558edd44af3b1a355422429b280434248';

export function createRemoteDeviceProofBytesV1(schemaId, request) {
  const descriptor = MOBILE_REMOTE_SESSION_CONTRACT_V1.controlMessages[schemaId];
  if (!MOBILE_REMOTE_SESSION_CONTRACT_V1.deviceProof.signedControlRequests.includes(schemaId)
    || !descriptor
    || !plain(request)
    || exactKeys(request, descriptor.requiredFields, 'remote-device-proof').length > 0) {
    throw new TypeError('remote-device-proof:request-invalid');
  }
  const unsigned = {};
  for (const key of descriptor.requiredFields) {
    if (key !== 'deviceSignature') unsigned[key] = request[key];
  }
  const prefix = `IntentSmith/M7/${schemaId}/Ed25519DeviceProof/v1\n`;
  return new TextEncoder().encode(`${prefix}${canonicalizeRemoteCoreValue(unsigned)}`);
}

export function resolveRemoteSecurityTransitionV1(machine, state, event) {
  const transitions = machine === 'pairing'
    ? PAIRING_TRANSITIONS
    : machine === 'session'
      ? SESSION_TRANSITIONS
      : null;
  const next = transitions?.[state]?.[event];
  if (!next) throw new TypeError(`remote-security-transition:${machine}:${state}:${event}:forbidden`);
  return next;
}

export function createRemoteSessionHelloV1({
  requestId,
  clientInstanceId,
  clientBuild,
  deviceKeyId,
  nonce,
  sentAt,
}) {
  if (!IDENTIFIER.test(requestId || '')) throw new TypeError('remote-session-hello:invalid-requestId');
  if (!IDENTIFIER.test(clientInstanceId || '')) throw new TypeError('remote-session-hello:invalid-clientInstanceId');
  if (typeof clientBuild !== 'string' || !clientBuild.trim() || clientBuild.length > 256) {
    throw new TypeError('remote-session-hello:invalid-clientBuild');
  }
  if (!KEY_ID.test(deviceKeyId || '')) throw new TypeError('remote-session-hello:invalid-deviceKeyId');
  if (!NONCE.test(nonce || '')) throw new TypeError('remote-session-hello:invalid-nonce');
  if (!canonicalTimestamp(sentAt)) throw new TypeError('remote-session-hello:invalid-sentAt');
  return deepFreeze({
    contract: 'RemoteSessionHello',
    version: 1,
    requestId,
    clientInstanceId,
    clientBuild: clientBuild.normalize('NFC'),
    deviceKeyId,
    nonce,
    supportedSessionVersions: [1],
    remoteCoreDescriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    sentAt,
  });
}

export async function validateRemoteSessionNegotiationV1(
  hello,
  value,
  cryptoApi = globalThis.crypto,
) {
  const context = 'remote-session-negotiation';
  const errors = exactKeys(value, [
    'contract', 'version', 'requestId', 'helloDigest', 'status',
    'selectedSessionVersion', 'remoteCoreDescriptorDigest', 'adapterManifestDigest',
    'serverOrigin', 'serverIdentityPin', 'negotiatedAt', 'error',
  ], context);
  if (!plain(value)) return { valid: false, errors };
  if (value.contract !== 'RemoteSessionNegotiation') errors.push(`${context}:invalid-contract`);
  if (value.version !== 1) errors.push(`${context}:invalid-version`);
  if (value.requestId !== hello?.requestId) errors.push(`${context}:requestId-mismatch`);
  if (value.helloDigest !== await digestRemoteCoreValue(hello, cryptoApi)) {
    errors.push(`${context}:helloDigest-mismatch`);
  }
  if (!['negotiated', 'incompatible', 'unavailable'].includes(value.status)) {
    errors.push(`${context}:invalid-status`);
  }
  if (!canonicalTimestamp(value.negotiatedAt)) errors.push(`${context}:invalid-negotiatedAt`);
  if (canonicalTimestamp(value.negotiatedAt) && canonicalTimestamp(hello?.sentAt)
      && Date.parse(value.negotiatedAt) < Date.parse(hello.sentAt)) {
    errors.push(`${context}:negotiated-before-hello`);
  }
  if (value.status === 'negotiated') {
    if (value.selectedSessionVersion !== 1) errors.push(`${context}:session-version-mismatch`);
    if (value.remoteCoreDescriptorDigest !== REMOTE_CORE_V1_PIN.descriptorDigest) {
      errors.push(`${context}:descriptor-digest-mismatch`);
    }
    if (value.adapterManifestDigest !== MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1) {
      errors.push(`${context}:adapter-digest-mismatch`);
    }
    if (!exactHttpsOrigin(value.serverOrigin)) errors.push(`${context}:invalid-server-origin`);
    if (!SHA256.test(value.serverIdentityPin || '')) errors.push(`${context}:invalid-server-identity-pin`);
    if (value.error !== null) errors.push(`${context}:unexpected-error`);
  } else {
    for (const key of [
      'selectedSessionVersion', 'remoteCoreDescriptorDigest', 'adapterManifestDigest',
      'serverOrigin', 'serverIdentityPin',
    ]) {
      if (value[key] !== null) errors.push(`${context}:${key}-must-be-null`);
    }
    errors.push(...validateError(value.error, `${context}.error`));
  }
  return { valid: errors.length === 0, errors };
}

export function validateRemoteSessionControlMessageV1(schemaId, value, { nowMs } = {}) {
  const descriptor = MOBILE_REMOTE_SESSION_CONTRACT_V1.controlMessages[schemaId];
  const context = `remote-session-control.${schemaId}`;
  if (!descriptor) return { valid: false, errors: [`${context}:unknown-schema`] };
  const errors = exactKeys(value, descriptor.requiredFields, context);
  if (!plain(value)) return { valid: false, errors };
  const [expectedContract] = schemaId.split('@');
  if (value.contract !== expectedContract) errors.push(`${context}:invalid-contract`);
  if (value.version !== 1) errors.push(`${context}:invalid-version`);
  if (!IDENTIFIER.test(value.requestId || '')) errors.push(`${context}:invalid-requestId`);
  for (const key of [
    'clientInstanceId', 'deviceId', 'pairingRevision', 'sessionId',
    'sessionRevision', 'subjectId',
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)
        && value[key] !== null
        && !IDENTIFIER.test(value[key] || '')) errors.push(`${context}:invalid-${key}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'clientBuild')
      && (typeof value.clientBuild !== 'string' || !value.clientBuild.trim() || value.clientBuild.length > 256)) {
    errors.push(`${context}:invalid-clientBuild`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'deviceKeyId')
      && value.deviceKeyId !== null
      && !KEY_ID.test(value.deviceKeyId || '')) errors.push(`${context}:invalid-deviceKeyId`);
  if (Object.prototype.hasOwnProperty.call(value, 'claimCode')
      && !PAIRING_CODE.test(value.claimCode || '')) errors.push(`${context}:invalid-claimCode`);
  if (Object.prototype.hasOwnProperty.call(value, 'devicePublicKey')
      && !ED25519_PUBLIC_KEY.test(value.devicePublicKey || '')) errors.push(`${context}:invalid-devicePublicKey`);
  if (Object.prototype.hasOwnProperty.call(value, 'deviceSignature')
      && !ED25519_SIGNATURE.test(value.deviceSignature || '')) errors.push(`${context}:invalid-deviceSignature`);
  for (const key of ['clientNonce', 'serverNonce']) {
    if (Object.prototype.hasOwnProperty.call(value, key) && !NONCE.test(value[key] || '')) {
      errors.push(`${context}:invalid-${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'clientCounter')
      && (!Number.isSafeInteger(value.clientCounter) || value.clientCounter < 1)) {
    errors.push(`${context}:invalid-clientCounter`);
  }
  for (const key of ['sentAt', 'pairedAt', 'issuedAt', 'expiresAt', 'revokedAt']) {
    if (Object.prototype.hasOwnProperty.call(value, key)
        && value[key] !== null
        && !canonicalTimestamp(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (Number.isFinite(nowMs) && canonicalTimestamp(value.sentAt)) {
    const skew = Math.abs(nowMs - Date.parse(value.sentAt));
    if (skew > MOBILE_REMOTE_SESSION_CONTRACT_V1.session.clockSkewSecondsMaximum * 1000) {
      errors.push(`${context}:clock-skew-exceeded`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'scopes')
      && value.scopes !== null
      && !sortedUnique(value.scopes)) errors.push(`${context}:invalid-scopes`);
  if (Object.prototype.hasOwnProperty.call(value, 'serverOrigin')
      && value.serverOrigin !== null
      && !exactHttpsOrigin(value.serverOrigin)) errors.push(`${context}:invalid-serverOrigin`);
  if (Object.prototype.hasOwnProperty.call(value, 'serverIdentityPin')
      && value.serverIdentityPin !== null
      && !SHA256.test(value.serverIdentityPin || '')) errors.push(`${context}:invalid-serverIdentityPin`);
  if (Object.prototype.hasOwnProperty.call(value, 'adapterManifestDigest')
      && value.adapterManifestDigest !== null
      && value.adapterManifestDigest !== MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1) {
    errors.push(`${context}:adapterManifestDigest-mismatch`);
  }

  const isRequest = schemaId.endsWith('Request@1');
  if (!isRequest) {
    const successStatus = schemaId === 'RemotePairingClaimResult@1'
      ? 'paired'
      : schemaId === 'RemoteSessionRevokeResult@1'
        ? 'revoked'
        : 'active';
    if (![successStatus, 'error'].includes(value.status)) errors.push(`${context}:invalid-status`);
    if (value.status === 'error') {
      errors.push(...validateError(value.error, `${context}.error`));
      for (const key of descriptor.requiredFields.filter(key => ![
        'contract', 'error', 'requestId', 'status', 'version',
      ].includes(key))) {
        if (value[key] !== null) errors.push(`${context}:${key}-must-be-null-on-error`);
      }
    } else if (value.error !== null) {
      errors.push(`${context}:unexpected-error`);
    }
  }
  if (canonicalTimestamp(value.issuedAt) && canonicalTimestamp(value.expiresAt)) {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (lifetime <= 0 || lifetime > MOBILE_REMOTE_SESSION_CONTRACT_V1.session.lifetimeSecondsMaximum * 1000) {
      errors.push(`${context}:invalid-session-lifetime`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'reason')
      && !['device_lost', 'logout', 'operator_revoke', 'security_reset'].includes(value.reason)) {
    errors.push(`${context}:invalid-reason`);
  }
  return { valid: errors.length === 0, errors };
}

function compareBoundField(errors, left, right, field, context) {
  if (left?.[field] !== right?.[field]) errors.push(`${context}:${field}-mismatch`);
}

function validateTrustedSessionContext(errors, request, result, session, nowMs, context) {
  errors.push(...validateSessionRecord(session, nowMs, `${context}.session`));
  for (const field of ['sessionId', 'deviceId', 'subjectId', 'sessionRevision']) {
    compareBoundField(errors, request, session, field, `${context}.request-session`);
  }
  for (const field of ['deviceId', 'subjectId', 'pairingRevision']) {
    compareBoundField(errors, result, session, field, `${context}.result-session`);
  }
}

/**
 * Validate one complete control exchange rather than two independently
 * well-shaped messages. `negotiation` must already have passed
 * `validateRemoteSessionNegotiationV1`; `session` must be the currently trusted
 * active session. The cross-message checks below then reject a valid response
 * replayed from another request, device, subject, pairing revision or server.
 */
export function validateRemoteSessionControlExchangeV1({
  requestSchemaId,
  request,
  result,
  session = null,
  negotiation = null,
  nowMs,
}) {
  const context = `remote-session-exchange.${requestSchemaId}`;
  const exchange = CONTROL_EXCHANGES[requestSchemaId];
  if (!exchange) return { valid: false, errors: [`${context}:unknown-exchange`] };

  const errors = [
    ...validateRemoteSessionControlMessageV1(requestSchemaId, request, { nowMs }).errors,
    ...validateRemoteSessionControlMessageV1(exchange.resultSchemaId, result, { nowMs }).errors,
  ];
  if (!Number.isFinite(nowMs)) errors.push(`${context}:invalid-nowMs`);
  compareBoundField(errors, request, result, 'requestId', context);

  // Error results intentionally carry no server-issued identity. The exact
  // requestId binding above is the only cross-message claim they may make.
  if (result?.status === 'error') return { valid: errors.length === 0, errors };

  for (const field of exchange.requestResultBindings.filter(field => field !== 'requestId')) {
    compareBoundField(errors, request, result, field, context);
  }

  if (requestSchemaId === 'RemoteSessionOpenRequest@1') {
    if (!plain(negotiation) || negotiation.status !== 'negotiated') {
      errors.push(`${context}:validated-negotiation-required`);
    } else {
      for (const field of ['serverOrigin', 'serverIdentityPin']) {
        compareBoundField(errors, result, negotiation, field, `${context}.result-negotiation`);
      }
      if (result?.adapterManifestDigest !== negotiation.adapterManifestDigest) {
        errors.push(`${context}.result-negotiation:adapterManifestDigest-mismatch`);
      }
    }
  }

  if (requestSchemaId === 'RemoteSessionRefreshRequest@1'
      || requestSchemaId === 'RemoteSessionRevokeRequest@1') {
    validateTrustedSessionContext(errors, request, result, session, nowMs, context);
  }

  if (requestSchemaId === 'RemoteSessionRefreshRequest@1') {
    for (const field of ['serverOrigin', 'serverIdentityPin', 'adapterManifestDigest']) {
      compareBoundField(errors, result, session, field, `${context}.result-session`);
    }
    compareBoundField(errors, result, session, 'sessionId', `${context}.result-session`);
    if (result?.sessionRevision === request?.sessionRevision) {
      errors.push(`${context}:sessionRevision-not-advanced`);
    }
  }

  if (requestSchemaId === 'RemoteSessionRevokeRequest@1'
      && result?.sessionRevision === request?.sessionRevision) {
    errors.push(`${context}:sessionRevision-not-advanced`);
  }

  return { valid: errors.length === 0, errors };
}

function validateSessionRecord(session, nowMs, context) {
  const errors = exactKeys(session, [
    'contract', 'version', 'sessionId', 'deviceId', 'subjectId', 'pairingRevision',
    'sessionRevision', 'scopes', 'clientBuild', 'deviceKeyId', 'serverOrigin',
    'serverIdentityPin', 'adapterManifestDigest', 'issuedAt', 'expiresAt', 'state',
  ], context);
  if (!plain(session)) return errors;
  if (session.contract !== 'RemoteSession' || session.version !== 1) errors.push(`${context}:invalid-contract`);
  for (const key of ['sessionId', 'deviceId', 'subjectId', 'pairingRevision', 'sessionRevision']) {
    if (!IDENTIFIER.test(session[key] || '')) errors.push(`${context}:invalid-${key}`);
  }
  if (!sortedUnique(session.scopes)) errors.push(`${context}:invalid-scopes`);
  if (typeof session.clientBuild !== 'string' || !session.clientBuild.trim()) errors.push(`${context}:invalid-clientBuild`);
  if (!KEY_ID.test(session.deviceKeyId || '')) errors.push(`${context}:invalid-deviceKeyId`);
  if (!exactHttpsOrigin(session.serverOrigin)) errors.push(`${context}:invalid-serverOrigin`);
  if (!SHA256.test(session.serverIdentityPin || '')) errors.push(`${context}:invalid-serverIdentityPin`);
  if (session.adapterManifestDigest !== MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1) {
    errors.push(`${context}:adapterManifestDigest-mismatch`);
  }
  if (!canonicalTimestamp(session.issuedAt)) errors.push(`${context}:invalid-issuedAt`);
  if (!canonicalTimestamp(session.expiresAt)) errors.push(`${context}:invalid-expiresAt`);
  if (canonicalTimestamp(session.issuedAt) && canonicalTimestamp(session.expiresAt)) {
    const lifetime = Date.parse(session.expiresAt) - Date.parse(session.issuedAt);
    if (lifetime <= 0 || lifetime > MOBILE_REMOTE_SESSION_CONTRACT_V1.session.lifetimeSecondsMaximum * 1000) {
      errors.push(`${context}:invalid-lifetime`);
    }
  }
  if (session.state !== 'ACTIVE') errors.push(`${context}:session-not-active`);
  if (canonicalTimestamp(session.expiresAt) && Date.parse(session.expiresAt) <= nowMs) {
    errors.push(`${context}:session-expired`);
  }
  return errors;
}

function envelopeBytes(value) {
  return new TextEncoder().encode(canonicalizeRemoteCoreValue(value)).byteLength;
}

export async function validateRemoteInvocationEnvelopeV1({
  envelope,
  session,
  previousCounter,
  nowMs,
  cryptoApi = globalThis.crypto,
  externalValidators = {},
}) {
  const context = 'remote-invocation';
  const errors = exactKeys(envelope, [
    'contract', 'version', 'requestId', 'sessionId', 'deviceId', 'subjectId',
    'sessionRevision', 'clientCounter', 'nonce', 'sentAt', 'capabilityId',
    'capabilityVersion', 'operationId', 'payload', 'payloadDigest',
  ], context);
  if (!plain(envelope)) return { valid: false, errors };
  if (!Number.isSafeInteger(previousCounter) || previousCounter < 0) {
    errors.push(`${context}:invalid-previousCounter`);
  }
  if (!Number.isFinite(nowMs)) errors.push(`${context}:invalid-nowMs`);
  errors.push(...validateSessionRecord(session, nowMs, 'remote-session'));
  if (envelope.contract !== 'RemoteInvocationEnvelope' || envelope.version !== 1) {
    errors.push(`${context}:invalid-contract`);
  }
  if (!IDENTIFIER.test(envelope.requestId || '')) errors.push(`${context}:invalid-requestId`);
  for (const key of ['sessionId', 'deviceId', 'subjectId', 'sessionRevision']) {
    if (envelope[key] !== session?.[key]) errors.push(`${context}:${key}-mismatch`);
  }
  if (!Number.isSafeInteger(envelope.clientCounter) || envelope.clientCounter <= previousCounter) {
    errors.push(`${context}:counter-replay-or-non-monotonic`);
  }
  if (!NONCE.test(envelope.nonce || '')) errors.push(`${context}:invalid-nonce`);
  if (!canonicalTimestamp(envelope.sentAt)) errors.push(`${context}:invalid-sentAt`);
  if (canonicalTimestamp(envelope.sentAt)) {
    const skew = Math.abs(nowMs - Date.parse(envelope.sentAt));
    if (skew > MOBILE_REMOTE_SESSION_CONTRACT_V1.session.clockSkewSecondsMaximum * 1000) {
      errors.push(`${context}:clock-skew-exceeded`);
    }
  }
  const descriptor = findOperation(envelope.operationId);
  if (!descriptor) {
    errors.push(`${context}:unknown-operation`);
  } else {
    if (descriptor.capabilityId !== envelope.capabilityId) errors.push(`${context}:capability-mismatch`);
    if (descriptor.capabilityVersion !== envelope.capabilityVersion) errors.push(`${context}:capability-version-mismatch`);
    for (const scope of descriptor.operation.requiredScopes) {
      if (!session?.scopes?.includes(scope)) errors.push(`${context}:missing-scope-${scope}`);
    }
    const requestValidation = validateMobileRemotePayload(
      descriptor.operation.requestContract,
      envelope.payload,
      { externalValidators, context: `${context}.payload` },
    );
    errors.push(...requestValidation.errors);
  }
  let payloadDigest = null;
  try {
    payloadDigest = await digestRemoteCoreValue(envelope.payload, cryptoApi);
  } catch {
    errors.push(`${context}:payload-not-canonical`);
  }
  if (payloadDigest !== envelope.payloadDigest) errors.push(`${context}:payloadDigest-mismatch`);
  try {
    const payloadBytes = envelopeBytes(envelope.payload);
    const totalBytes = envelopeBytes(envelope);
    if (payloadBytes > MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.payloadBytesMaximum) {
      errors.push(`${context}:payload-too-large`);
    }
    if (totalBytes > MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.envelopeBytesMaximum) {
      errors.push(`${context}:envelope-too-large`);
    }
  } catch {
    if (!errors.includes(`${context}:payload-not-canonical`)) errors.push(`${context}:not-canonical`);
  }
  return { valid: errors.length === 0, errors, operation: descriptor };
}

export async function validateRemoteResponseEnvelopeV1({
  requestEnvelope,
  responseEnvelope,
  session,
  nowMs,
  cryptoApi = globalThis.crypto,
  externalValidators = {},
}) {
  const context = 'remote-response';
  const errors = exactKeys(responseEnvelope, [
    'contract', 'version', 'requestId', 'sessionId', 'deviceId', 'subjectId',
    'sessionRevision', 'acceptedCounter', 'respondedAt', 'status', 'payload',
    'payloadDigest', 'error',
  ], context);
  if (!plain(responseEnvelope)) return { valid: false, errors };
  errors.push(...validateSessionRecord(session, nowMs, 'remote-session'));
  if (responseEnvelope.contract !== 'RemoteResponseEnvelope' || responseEnvelope.version !== 1) {
    errors.push(`${context}:invalid-contract`);
  }
  for (const key of ['requestId', 'sessionId', 'deviceId', 'subjectId', 'sessionRevision']) {
    if (responseEnvelope[key] !== requestEnvelope?.[key]) errors.push(`${context}:${key}-mismatch`);
  }
  if (responseEnvelope.acceptedCounter !== requestEnvelope?.clientCounter) {
    errors.push(`${context}:counter-mismatch`);
  }
  if (!canonicalTimestamp(responseEnvelope.respondedAt)) errors.push(`${context}:invalid-respondedAt`);
  if (canonicalTimestamp(responseEnvelope.respondedAt)
      && Date.parse(responseEnvelope.respondedAt) < Date.parse(requestEnvelope?.sentAt || '')) {
    errors.push(`${context}:responded-before-request`);
  }
  if (!['ok', 'error'].includes(responseEnvelope.status)) errors.push(`${context}:invalid-status`);
  if (responseEnvelope.status === 'ok') {
    if (responseEnvelope.error !== null) errors.push(`${context}:unexpected-error`);
    let digest = null;
    try {
      digest = await digestRemoteCoreValue(responseEnvelope.payload, cryptoApi);
    } catch {
      errors.push(`${context}:payload-not-canonical`);
    }
    if (digest !== responseEnvelope.payloadDigest) errors.push(`${context}:payloadDigest-mismatch`);
    const pair = validateMobileRemoteOperationPair({
      capabilityId: requestEnvelope.capabilityId,
      capabilityVersion: requestEnvelope.capabilityVersion,
      operationId: requestEnvelope.operationId,
      request: requestEnvelope.payload,
      result: responseEnvelope.payload,
      externalValidators,
    });
    errors.push(...pair.errors.map(error => `${context}:${error}`));
  } else {
    if (responseEnvelope.payload !== null) errors.push(`${context}:error-payload-must-be-null`);
    if (responseEnvelope.payloadDigest !== null) errors.push(`${context}:error-payloadDigest-must-be-null`);
    errors.push(...validateError(responseEnvelope.error, `${context}.error`));
  }
  try {
    if (envelopeBytes(responseEnvelope) > MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.envelopeBytesMaximum) {
      errors.push(`${context}:envelope-too-large`);
    }
  } catch {
    errors.push(`${context}:not-canonical`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateRemoteCursorBindingV1({ binding, session, invocation, queryDigest, nowMs }) {
  const context = 'remote-cursor-binding';
  const errors = exactKeys(binding, [
    'contract', 'version', 'cursorDigest', 'deviceId', 'subjectId', 'sessionRevision',
    'capabilityId', 'capabilityVersion', 'operationId', 'queryDigest',
    'snapshotRevision', 'limit', 'issuedAt', 'expiresAt',
  ], context);
  if (!plain(binding)) return { valid: false, errors };
  if (binding.contract !== 'RemoteCursorBinding' || binding.version !== 1) errors.push(`${context}:invalid-contract`);
  if (!SHA256.test(binding.cursorDigest || '')) errors.push(`${context}:invalid-cursorDigest`);
  for (const key of ['deviceId', 'subjectId', 'sessionRevision']) {
    if (binding[key] !== session?.[key]) errors.push(`${context}:${key}-mismatch`);
  }
  for (const key of ['capabilityId', 'capabilityVersion', 'operationId']) {
    if (binding[key] !== invocation?.[key]) errors.push(`${context}:${key}-mismatch`);
  }
  if (!SHA256.test(queryDigest || '') || binding.queryDigest !== queryDigest) {
    errors.push(`${context}:queryDigest-mismatch`);
  }
  if (!IDENTIFIER.test(binding.snapshotRevision || '')) errors.push(`${context}:invalid-snapshotRevision`);
  if (!Number.isSafeInteger(binding.limit)
      || binding.limit < 1
      || binding.limit > MOBILE_REMOTE_SESSION_CONTRACT_V1.resourceLimits.pageItemsMaximum) {
    errors.push(`${context}:invalid-limit`);
  }
  if (!canonicalTimestamp(binding.issuedAt)) errors.push(`${context}:invalid-issuedAt`);
  if (!canonicalTimestamp(binding.expiresAt)) errors.push(`${context}:invalid-expiresAt`);
  if (canonicalTimestamp(binding.issuedAt) && canonicalTimestamp(binding.expiresAt)
      && Date.parse(binding.expiresAt) <= Date.parse(binding.issuedAt)) {
    errors.push(`${context}:invalid-lifetime`);
  }
  if (canonicalTimestamp(binding.expiresAt) && Date.parse(binding.expiresAt) <= nowMs) {
    errors.push(`${context}:expired`);
  }
  return { valid: errors.length === 0, errors };
}
