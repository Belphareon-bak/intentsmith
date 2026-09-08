import {
  M7_RUNTIME_OPERATION_DESCRIPTORS,
  validateM7RuntimeOperationPair,
  validateM7RuntimeOperationRequest,
} from './m7-runtime-contract-v1.js';
import { REMOTE_CORE_V1_PIN, digestRemoteCoreValue } from './remote-core-v1.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ADAPTER_MANIFEST_DIGEST = REMOTE_CORE_V1_PIN.m7AdapterManifestDigest;

const OPERATIONS = Object.freeze(Object.fromEntries(
  Object.entries(M7_RUNTIME_OPERATION_DESCRIPTORS).map(([operationId, operation]) => (
    [operationId, Object.freeze([operation.capabilityId, operation.capabilityVersion])]
  )),
));

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
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

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function fail(code, message = code, details = {}) {
  const error = new Error(message);
  error.name = 'M7NativeRemoteClientError';
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function requireIdentifier(value, field) {
  if (!IDENTIFIER.test(value || '')) fail('REMOTE_CLIENT_STATE_INVALID', `invalid ${field}`);
  return value;
}

function requestId(cryptoApi) {
  return `request:mobile:${cryptoApi.randomUUID()}`;
}

function nonce(cryptoApi) {
  return cryptoApi.randomUUID().replaceAll('-', '') + cryptoApi.randomUUID().replaceAll('-', '');
}

function canonicalTimestamp(nowMs) {
  if (!Number.isFinite(nowMs)) fail('REMOTE_CLIENT_CLOCK_INVALID');
  return new Date(nowMs).toISOString();
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function runtimeBinding(runtime) {
  const remote = runtime?.remoteCore;
  if (!plain(remote)
    || runtime.transportMode !== 'remote-core-v1'
    || !exactKeys(remote, [
      'adapterManifestDigest', 'descriptorDigest', 'serverIdentityPin', 'serverOrigin',
    ])
    || remote.adapterManifestDigest !== ADAPTER_MANIFEST_DIGEST
    || remote.descriptorDigest !== REMOTE_CORE_V1_PIN.descriptorDigest
    || !SHA256.test(remote.serverIdentityPin || '')) {
    fail('REMOTE_CLIENT_CONFIGURATION_INVALID');
  }
  let origin;
  try { origin = new URL(remote.serverOrigin); } catch { fail('REMOTE_CLIENT_CONFIGURATION_INVALID'); }
  if (origin.protocol !== 'https:' || origin.port !== '7443'
    || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash || origin.origin !== remote.serverOrigin) {
    fail('REMOTE_CLIENT_CONFIGURATION_INVALID');
  }
  return deepFreeze({ ...remote });
}

function validateNativeDescription(value, binding) {
  if (!exactKeys(value, [
    'adapterManifestDigest', 'available', 'clientBuild', 'minimumApi', 'nativeHttps',
    'origin', 'proxy', 'redirect', 'serverIdentityPin', 'tlsVersion',
  ])
    || value.available !== true
    || value.nativeHttps !== true
    || value.tlsVersion !== 'TLSv1.3'
    || value.proxy !== 'forbidden'
    || value.origin !== binding.serverOrigin
    || value.serverIdentityPin !== binding.serverIdentityPin
    || value.adapterManifestDigest !== binding.adapterManifestDigest
    || value.minimumApi !== 29
    || value.redirect !== 'forbidden'
    || typeof value.clientBuild !== 'string'
    || !value.clientBuild.trim()) {
    fail('REMOTE_NATIVE_TRANSPORT_UNAVAILABLE');
  }
  return deepFreeze(clone(value));
}

function validatePairing(value, request, binding, nowMs) {
  const keys = [
    'contract', 'deviceId', 'deviceKeyId', 'error', 'pairedAt', 'pairingRevision',
    'requestId', 'scopes', 'status', 'subjectId', 'version',
  ];
  if (!exactKeys(value, keys)
    || value.contract !== 'RemotePairingClaimResult'
    || value.version !== 1
    || value.status !== 'paired'
    || value.requestId !== request.requestId
    || value.deviceKeyId !== request.deviceKeyId
    || value.error !== null
    || !Array.isArray(value.scopes)
    || value.scopes.some((scope, index) => typeof scope !== 'string'
      || (index > 0 && value.scopes[index - 1] >= scope))
    || !isCanonicalTimestamp(value.pairedAt)
    || Date.parse(value.pairedAt) > nowMs + 30_000) {
    fail('REMOTE_PAIRING_RESPONSE_INVALID');
  }
  for (const field of ['deviceId', 'pairingRevision', 'subjectId']) {
    requireIdentifier(value[field], field);
  }
  return value;
}

function validateChallenge(value, request, binding, nowMs, session = null) {
  const keys = [
    'challengeId', 'contract', 'deviceId', 'error', 'expiresAt', 'issuedAt',
    'pairingRevision', 'purpose', 'requestId', 'serverIdentityPin', 'serverNonce',
    'sessionId', 'sessionRevision', 'status', 'version',
  ];
  if (!exactKeys(value, keys)
    || value.contract !== 'RemoteSessionChallengeResult'
    || value.version !== 1
    || value.status !== 'issued'
    || value.error !== null
    || value.requestId !== request.requestId
    || value.deviceId !== request.deviceId
    || value.pairingRevision !== request.pairingRevision
    || value.purpose !== request.purpose
    || value.sessionId !== request.sessionId
    || value.sessionRevision !== request.sessionRevision
    || value.serverIdentityPin !== binding.serverIdentityPin
    || !NONCE.test(value.serverNonce || '')
    || !IDENTIFIER.test(value.challengeId || '')
    || !isCanonicalTimestamp(value.issuedAt)
    || !isCanonicalTimestamp(value.expiresAt)
    || Date.parse(value.issuedAt) > nowMs + 30_000
    || Date.parse(value.expiresAt) <= nowMs
    || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 60_000
    || (request.purpose === 'REFRESH' && (!session
      || request.sessionId !== session.sessionId
      || request.sessionRevision !== session.sessionRevision
      || request.deviceId !== session.deviceId))) {
    fail('REMOTE_CHALLENGE_RESPONSE_INVALID');
  }
  return value;
}

function validateSessionResult(value, request, binding, contract, nowMs, session = null) {
  const keys = [
    'adapterManifestDigest', 'contract', 'deviceId', 'error', 'expiresAt', 'issuedAt',
    'pairingRevision', 'requestId', 'scopes', 'serverIdentityPin', 'serverOrigin',
    'sessionId', 'sessionRevision', 'status', 'subjectId', 'version',
  ];
  if (!exactKeys(value, keys)
    || value.contract !== contract
    || value.version !== 1
    || value.status !== 'active'
    || value.error !== null
    || value.requestId !== request.requestId
    || value.deviceId !== request.deviceId
    || (contract === 'RemoteSessionOpenResult'
      && value.pairingRevision !== request.pairingRevision)
    || (contract === 'RemoteSessionRefreshResult' && (!session
      || value.sessionId !== session.sessionId
      || value.deviceId !== session.deviceId
      || value.subjectId !== session.subjectId
      || value.pairingRevision !== session.pairingRevision
      || value.sessionRevision === session.sessionRevision))
    || value.serverOrigin !== binding.serverOrigin
    || value.serverIdentityPin !== binding.serverIdentityPin
    || value.adapterManifestDigest !== binding.adapterManifestDigest
    || !Array.isArray(value.scopes)
    || value.scopes.some((scope, index) => typeof scope !== 'string'
      || (index > 0 && value.scopes[index - 1] >= scope))) {
    fail('REMOTE_SESSION_RESPONSE_INVALID');
  }
  for (const field of ['deviceId', 'pairingRevision', 'sessionId', 'sessionRevision', 'subjectId']) {
    requireIdentifier(value[field], field);
  }
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || new Date(issuedAt).toISOString() !== value.issuedAt
    || new Date(expiresAt).toISOString() !== value.expiresAt
    || issuedAt > nowMs + 30_000 || expiresAt <= nowMs
    || expiresAt <= issuedAt || expiresAt - issuedAt > 900_000) {
    fail('REMOTE_SESSION_RESPONSE_INVALID');
  }
  return value;
}

function validateState(value, binding) {
  if (value === null) return null;
  const keys = [
    'clientBuild', 'clientInstanceId', 'deviceId', 'deviceKeyId', 'expiresAt',
    'issuedAt', 'lastCounter', 'pairingRevision', 'scopes', 'serverIdentityPin',
    'serverOrigin', 'sessionId', 'sessionRevision', 'subjectId', 'version',
  ];
  if (!exactKeys(value, keys) || value.version !== 1
    || value.serverOrigin !== binding.serverOrigin
    || value.serverIdentityPin !== binding.serverIdentityPin
    || !Number.isSafeInteger(value.lastCounter) || value.lastCounter < 0
    || typeof value.clientBuild !== 'string' || !value.clientBuild.trim()
    || value.clientBuild.length > 256
    || !Array.isArray(value.scopes)
    || value.scopes.some(scope => typeof scope !== 'string')
    || new Set(value.scopes).size !== value.scopes.length
    || value.scopes.some((scope, index) => index > 0 && value.scopes[index - 1] >= scope)
    || !isCanonicalTimestamp(value.issuedAt)
    || (value.sessionId === null) !== (value.sessionRevision === null)
    || (value.sessionId === null) !== (value.expiresAt === null)
    || (value.expiresAt !== null && (!isCanonicalTimestamp(value.expiresAt)
      || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)))) {
    fail('REMOTE_CLIENT_STATE_INVALID');
  }
  for (const field of [
    'clientInstanceId', 'deviceId', 'deviceKeyId', 'pairingRevision', 'subjectId',
  ]) requireIdentifier(value[field], field);
  for (const field of ['sessionId', 'sessionRevision']) {
    if (value[field] !== null) requireIdentifier(value[field], field);
  }
  return clone(value);
}

function nextCounter(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    fail('REMOTE_CLIENT_COUNTER_EXHAUSTED');
  }
  return value + 1;
}

function validateOperationRequest(operationId, payload) {
  const validation = validateM7RuntimeOperationRequest(operationId, payload);
  if (!validation.valid) fail('REMOTE_CLIENT_REQUEST_INVALID', validation.errors.join('; '));
}

function validateOperationResponse(operationId, request, result) {
  const validation = validateM7RuntimeOperationPair(operationId, request, result);
  if (!validation.valid) fail('REMOTE_CLIENT_RESPONSE_INVALID', validation.errors.join('; '));
}

export const M7_NATIVE_REMOTE_CLIENT_STAGE = 'IMPLEMENTED_NOT_DEVICE_VERIFIED';
export const M7_NATIVE_OPERATION_CATALOG = OPERATIONS;
export const M7_NATIVE_ADAPTER_MANIFEST_DIGEST = ADAPTER_MANIFEST_DIGEST;

export function createM7NativeRemoteClient({
  nativePlugin,
  runtime,
  stateStore,
  cryptoApi = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  const binding = runtimeBinding(runtime);
  if (!nativePlugin
    || !['describe', 'identity', 'sign', 'post', 'health', 'clear']
      .every(method => typeof nativePlugin[method] === 'function')
    || !stateStore
    || !['load', 'save', 'clear'].every(method => typeof stateStore[method] === 'function')
    || !cryptoApi?.subtle
    || typeof cryptoApi.randomUUID !== 'function'
    || typeof now !== 'function') {
    fail('REMOTE_CLIENT_CONFIGURATION_INVALID');
  }
  let nativeDescription = null;
  let state = null;
  let initialized = false;
  let inFlight = false;
  let serial = Promise.resolve();

  function runSerial(action) {
    const result = serial.then(action, action);
    serial = result.catch(() => {});
    return result;
  }

  async function initialize() {
    if (initialized) return;
    nativeDescription = validateNativeDescription(await nativePlugin.describe(), binding);
    state = validateState(await stateStore.load(), binding);
    initialized = true;
  }

  async function sign(schemaId, unsigned) {
    const request = { ...unsigned, deviceSignature: '' };
    const result = await nativePlugin.sign({ schemaId, request: clone(request) });
    if (!SIGNATURE.test(result?.deviceSignature || '')
      || result.deviceKeyId !== state.deviceKeyId) {
      fail('REMOTE_DEVICE_SIGNATURE_INVALID');
    }
    return deepFreeze({ ...unsigned, deviceSignature: result.deviceSignature });
  }

  async function post(path, body) {
    const response = await nativePlugin.post({ path, body: clone(body) });
    if (!plain(response) || !Number.isSafeInteger(response.status) || !plain(response.body)) {
      fail('REMOTE_NATIVE_RESPONSE_INVALID');
    }
    if (response.status !== 200) {
      const code = response.body?.code;
      fail(typeof code === 'string' ? code : 'REMOTE_TRANSPORT_FAILED', 'Remote request failed.', {
        status: response.status,
        retryAfterSeconds: response.body?.retryAfterSeconds ?? null,
      });
    }
    return response.body;
  }

  async function openSession() {
    const challengeUnsigned = {
      clientNonce: nonce(cryptoApi),
      contract: 'RemoteSessionChallengeRequest',
      deviceId: state.deviceId,
      pairingRevision: state.pairingRevision,
      purpose: 'OPEN',
      requestId: requestId(cryptoApi),
      sentAt: canonicalTimestamp(now()),
      sessionId: null,
      sessionRevision: null,
      version: 1,
    };
    const challengeRequest = await sign('RemoteSessionChallengeRequest@1', challengeUnsigned);
    const challenge = validateChallenge(
      await post('/remote/v1/session/challenge', challengeRequest),
      challengeRequest,
      binding,
      now(),
    );
    const openUnsigned = {
      clientBuild: state.clientBuild,
      clientInstanceId: state.clientInstanceId,
      contract: 'RemoteSessionOpenRequest',
      deviceId: state.deviceId,
      deviceKeyId: state.deviceKeyId,
      pairingRevision: state.pairingRevision,
      requestId: requestId(cryptoApi),
      sentAt: canonicalTimestamp(now()),
      serverNonce: challenge.serverNonce,
      version: 1,
    };
    const openRequest = await sign('RemoteSessionOpenRequest@1', openUnsigned);
    const opened = validateSessionResult(
      await post('/remote/v1/session/open', openRequest),
      openRequest,
      binding,
      'RemoteSessionOpenResult',
      now(),
    );
    if (opened.deviceId !== state.deviceId
      || opened.pairingRevision !== state.pairingRevision
      || opened.subjectId !== state.subjectId) {
      fail('REMOTE_SESSION_RESPONSE_INVALID');
    }
    state = {
      ...state,
      expiresAt: opened.expiresAt,
      issuedAt: opened.issuedAt,
      lastCounter: 0,
      scopes: [...opened.scopes],
      sessionId: opened.sessionId,
      sessionRevision: opened.sessionRevision,
    };
    await stateStore.save(clone(state));
    return snapshot();
  }

  async function pair({ claimCode, clientInstanceId = null } = {}) {
    return runSerial(async () => {
      await initialize();
      if (state !== null) fail('REMOTE_PAIRING_REPLACEMENT_DENIED');
      if (!NONCE.test(claimCode || '')) fail('REMOTE_PAIRING_CODE_INVALID');
      const identity = await nativePlugin.identity();
      if (!IDENTIFIER.test(identity?.deviceKeyId || '')
        || typeof identity?.devicePublicKey !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/.test(identity.devicePublicKey)) {
        fail('REMOTE_DEVICE_IDENTITY_INVALID');
      }
      const instance = clientInstanceId ?? `client:mobile:${cryptoApi.randomUUID()}`;
      requireIdentifier(instance, 'clientInstanceId');
      const request = {
        claimCode,
        clientBuild: nativeDescription.clientBuild,
        clientInstanceId: instance,
        clientNonce: nonce(cryptoApi),
        contract: 'RemotePairingClaimRequest',
        deviceKeyId: identity.deviceKeyId,
        devicePublicKey: identity.devicePublicKey,
        requestId: requestId(cryptoApi),
        sentAt: canonicalTimestamp(now()),
        version: 1,
      };
      const paired = validatePairing(
        await post('/remote/v1/pairing/claim', request),
        request,
        binding,
        now(),
      );
      state = {
        clientBuild: request.clientBuild,
        clientInstanceId: request.clientInstanceId,
        deviceId: paired.deviceId,
        deviceKeyId: paired.deviceKeyId,
        expiresAt: null,
        issuedAt: paired.pairedAt,
        lastCounter: 0,
        pairingRevision: paired.pairingRevision,
        scopes: [...paired.scopes],
        serverIdentityPin: binding.serverIdentityPin,
        serverOrigin: binding.serverOrigin,
        sessionId: null,
        sessionRevision: null,
        subjectId: paired.subjectId,
        version: 1,
      };
      // The one-time claim is already consumed. Persist the pairing before the
      // next network step so a failed open can be resumed without a new code.
      await stateStore.save(clone(state));
      return openSession();
    });
  }

  async function refreshSession() {
    if (state === null || state.sessionId === null || state.sessionRevision === null) {
      fail('REMOTE_SESSION_REQUIRED');
    }
    const previous = clone(state);
    const challengeUnsigned = {
      clientNonce: nonce(cryptoApi),
      contract: 'RemoteSessionChallengeRequest',
      deviceId: previous.deviceId,
      pairingRevision: previous.pairingRevision,
      purpose: 'REFRESH',
      requestId: requestId(cryptoApi),
      sentAt: canonicalTimestamp(now()),
      sessionId: previous.sessionId,
      sessionRevision: previous.sessionRevision,
      version: 1,
    };
    const challengeRequest = await sign('RemoteSessionChallengeRequest@1', challengeUnsigned);
    const challenge = validateChallenge(
      await post('/remote/v1/session/challenge', challengeRequest),
      challengeRequest,
      binding,
      now(),
      previous,
    );
    const counter = nextCounter(previous.lastCounter);
    const refreshUnsigned = {
      clientCounter: counter,
      clientNonce: nonce(cryptoApi),
      contract: 'RemoteSessionRefreshRequest',
      deviceId: previous.deviceId,
      requestId: requestId(cryptoApi),
      sentAt: canonicalTimestamp(now()),
      serverNonce: challenge.serverNonce,
      sessionId: previous.sessionId,
      sessionRevision: previous.sessionRevision,
      subjectId: previous.subjectId,
      version: 1,
    };
    const refreshRequest = await sign('RemoteSessionRefreshRequest@1', refreshUnsigned);
    // Once the signed refresh can leave the device, the old revision is no
    // longer safe to reuse: the server may commit even if the response is
    // lost. Persist a resumable pairing-only state before transport I/O.
    state = {
      ...previous,
      expiresAt: null,
      lastCounter: counter,
      sessionId: null,
      sessionRevision: null,
    };
    await stateStore.save(clone(state));
    const refreshed = validateSessionResult(
      await post('/remote/v1/session/refresh', refreshRequest),
      refreshRequest,
      binding,
      'RemoteSessionRefreshResult',
      now(),
      previous,
    );
    if (refreshed.deviceId !== previous.deviceId
      || refreshed.subjectId !== previous.subjectId
      || refreshed.pairingRevision !== previous.pairingRevision
      || refreshed.sessionId !== previous.sessionId
      || refreshed.sessionRevision === previous.sessionRevision) {
      fail('REMOTE_SESSION_RESPONSE_INVALID');
    }
    state = {
      ...previous,
      expiresAt: refreshed.expiresAt,
      issuedAt: refreshed.issuedAt,
      lastCounter: counter,
      scopes: [...refreshed.scopes],
      sessionId: refreshed.sessionId,
      sessionRevision: refreshed.sessionRevision,
    };
    await stateStore.save(clone(state));
    return snapshot();
  }

  async function refresh() {
    return runSerial(async () => {
      await initialize();
      return refreshSession();
    });
  }

  async function resume() {
    return runSerial(async () => {
      await initialize();
      if (state === null) return null;
      if (state.sessionId === null || Date.parse(state.expiresAt || '') <= now()) {
        return openSession();
      }
      if (Date.parse(state.expiresAt) - now() <= 120_000) return refreshSession();
      return snapshot();
    });
  }

  async function invoke(operationId, payload) {
    return runSerial(async () => {
      await initialize();
      if (inFlight) fail('REMOTE_CLIENT_IN_FLIGHT_LIMIT');
      const operation = OPERATIONS[operationId];
      const descriptor = M7_RUNTIME_OPERATION_DESCRIPTORS[operationId];
      if (!operation || !descriptor) fail('REMOTE_OPERATION_UNAVAILABLE');
      validateOperationRequest(operationId, payload);
      if (state === null) fail('REMOTE_SESSION_REQUIRED');
      if (state.sessionId === null || Date.parse(state.expiresAt || '') <= now()) {
        await openSession();
      }
      inFlight = true;
      try {
        const counter = nextCounter(state.lastCounter);
        state = { ...state, lastCounter: counter };
        // Reserve durably before signing or I/O. An ambiguous failure must
        // never cause reuse after process death.
        await stateStore.save(clone(state));
        const unsigned = {
          capabilityId: operation[0],
          capabilityVersion: operation[1],
          clientCounter: counter,
          contract: 'RemoteInvocationEnvelope',
          deviceId: state.deviceId,
          nonce: nonce(cryptoApi),
          operationId,
          payload: clone(payload),
          payloadDigest: await digestRemoteCoreValue(payload, cryptoApi),
          requestId: payload.requestId,
          sentAt: canonicalTimestamp(now()),
          sessionId: state.sessionId,
          sessionRevision: state.sessionRevision,
          subjectId: state.subjectId,
          version: 1,
        };
        const envelope = await sign('RemoteInvocationEnvelope@1', unsigned);
        const response = await post('/remote/v1/invoke', envelope);
        const keys = [
          'acceptedCounter', 'contract', 'deviceId', 'error', 'payload', 'payloadDigest',
          'requestId', 'respondedAt', 'sessionId', 'sessionRevision', 'status',
          'subjectId', 'version',
        ];
        if (!exactKeys(response, keys)
          || response.contract !== 'RemoteResponseEnvelope'
          || response.version !== 1
          || response.requestId !== envelope.requestId
          || response.sessionId !== envelope.sessionId
          || response.sessionRevision !== envelope.sessionRevision
          || response.deviceId !== envelope.deviceId
          || response.subjectId !== envelope.subjectId
          || response.acceptedCounter !== counter
          || !['ok', 'error'].includes(response.status)) {
          fail('REMOTE_CLIENT_RESPONSE_INVALID');
        }
        if (response.status === 'ok') {
          if (response.error !== null
            || response.payloadDigest !== await digestRemoteCoreValue(response.payload, cryptoApi)) {
            fail('REMOTE_CLIENT_RESPONSE_INVALID');
          }
          validateOperationResponse(operationId, payload, response.payload);
        } else if (response.payload !== null || response.payloadDigest !== null
          || !plain(response.error) || typeof response.error.code !== 'string') {
          fail('REMOTE_CLIENT_RESPONSE_INVALID');
        }
        return deepFreeze(clone(response));
      } finally {
        inFlight = false;
      }
    });
  }

  async function health() {
    await initialize();
    const id = requestId(cryptoApi);
    const response = await nativePlugin.health({ requestId: id });
    if (!plain(response) || response.status !== 200 || !plain(response.body)) {
      fail('REMOTE_HEALTH_RESPONSE_INVALID');
    }
    const body = response.body;
    if (!exactKeys(body, [
      'components', 'contract', 'coreVersion', 'observedAt', 'requestId', 'status', 'version',
    ])
      || body.contract !== 'RemoteHealthSnapshot'
      || body.version !== 1
      || body.requestId !== id
      || body.status !== 'ok'
      || typeof body.coreVersion !== 'string' || !body.coreVersion
      || !isCanonicalTimestamp(body.observedAt)
      || !Array.isArray(body.components)
      || body.components.some(component => !exactKeys(component, ['code', 'componentId', 'status'])
        || !IDENTIFIER.test(component.componentId || '')
        || !IDENTIFIER.test(component.code || '')
        || !['degraded', 'ok', 'unavailable'].includes(component.status))) {
      fail('REMOTE_HEALTH_RESPONSE_INVALID');
    }
    return deepFreeze(clone(response.body));
  }

  async function revoke(reason = 'logout') {
    return runSerial(async () => {
      await initialize();
      if (!['device_lost', 'logout', 'operator_revoke', 'security_reset'].includes(reason)) {
        fail('REMOTE_CLIENT_REQUEST_INVALID');
      }
      if (state === null || state.sessionId === null || state.sessionRevision === null) {
        await stateStore.clear();
        await nativePlugin.clear();
        state = null;
        return null;
      }
      const previous = clone(state);
      const counter = nextCounter(previous.lastCounter);
      const revokeUnsigned = {
        clientCounter: counter,
        clientNonce: nonce(cryptoApi),
        contract: 'RemoteSessionRevokeRequest',
        deviceId: previous.deviceId,
        reason,
        requestId: requestId(cryptoApi),
        sentAt: canonicalTimestamp(now()),
        sessionId: previous.sessionId,
        sessionRevision: previous.sessionRevision,
        subjectId: previous.subjectId,
        version: 1,
      };
      const revokeRequest = await sign('RemoteSessionRevokeRequest@1', revokeUnsigned);
      try {
        const response = await post('/remote/v1/session/revoke', revokeRequest);
        const keys = [
          'contract', 'deviceId', 'error', 'pairingRevision', 'requestId',
          'revokedAt', 'sessionRevision', 'status', 'subjectId', 'version',
        ];
        if (!exactKeys(response, keys)
          || response.contract !== 'RemoteSessionRevokeResult'
          || response.version !== 1
          || response.status !== 'revoked'
          || response.error !== null
          || response.requestId !== revokeRequest.requestId
          || response.deviceId !== previous.deviceId
          || response.subjectId !== previous.subjectId
          || response.pairingRevision !== previous.pairingRevision
          || response.sessionRevision === previous.sessionRevision
          || new Date(Date.parse(response.revokedAt)).toISOString() !== response.revokedAt) {
          fail('REMOTE_SESSION_RESPONSE_INVALID');
        }
        return deepFreeze(clone(response));
      } finally {
        // A logout is local authority withdrawal even when the network result
        // is ambiguous. Destroying the wrapped signing seed prevents reuse;
        // the operator may separately revoke an unreachable server pairing.
        await stateStore.clear();
        await nativePlugin.clear();
        state = null;
        initialized = false;
      }
    });
  }

  async function clear() {
    return runSerial(async () => {
      await stateStore.clear();
      await nativePlugin.clear();
      state = null;
      initialized = false;
    });
  }

  function snapshot() {
    if (state === null) return null;
    return deepFreeze({
      deviceId: state.deviceId,
      expiresAt: state.expiresAt,
      scopes: [...state.scopes],
      sessionId: state.sessionId,
      sessionRevision: state.sessionRevision,
      subjectId: state.subjectId,
    });
  }

  return deepFreeze({ clear, health, invoke, pair, refresh, resume, revoke, snapshot });
}
