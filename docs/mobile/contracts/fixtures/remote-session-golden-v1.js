// Sanitized fixtures for RemoteSessionContract@1 candidate.

import {
  createRemoteSessionHelloV1,
} from '../remote-session-contract-v1.js';
import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from '../remote-capability-manifests-v1.js';
import {
  digestRemoteCoreValue,
  REMOTE_CORE_V1_PIN,
} from '../../../../src/mobile/client/remote-core-v1.js';

const T0 = '2026-08-27T12:00:00.000Z';
const T1 = '2026-08-27T12:00:05.000Z';
const T2 = '2026-08-27T12:15:00.000Z';
const PIN = `sha256:${'c'.repeat(64)}`;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export async function createRemoteSessionGoldenFixturesV1(cryptoApi = globalThis.crypto) {
  const hello = createRemoteSessionHelloV1({
    requestId: 'request:session:hello:001',
    clientInstanceId: 'client:fixture:001',
    clientBuild: 'android-fixture-1',
    deviceKeyId: 'device-key:fixture:001',
    nonce: 'fixture_nonce_0000000000000001',
    sentAt: T0,
  });
  const negotiation = {
    contract: 'RemoteSessionNegotiation',
    version: 1,
    requestId: hello.requestId,
    helloDigest: await digestRemoteCoreValue(hello, cryptoApi),
    status: 'negotiated',
    selectedSessionVersion: 1,
    remoteCoreDescriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    serverOrigin: 'https://companion.fixture.invalid',
    serverIdentityPin: PIN,
    negotiatedAt: T1,
    error: null,
  };
  const session = {
    contract: 'RemoteSession',
    version: 1,
    sessionId: 'session:fixture:001',
    deviceId: 'device:fixture:001',
    subjectId: 'subject:fixture:001',
    pairingRevision: 'pairing-revision:001',
    sessionRevision: 'session-revision:001',
    scopes: ['read:projects'],
    clientBuild: hello.clientBuild,
    deviceKeyId: hello.deviceKeyId,
    serverOrigin: negotiation.serverOrigin,
    serverIdentityPin: negotiation.serverIdentityPin,
    adapterManifestDigest: negotiation.adapterManifestDigest,
    issuedAt: T0,
    expiresAt: T2,
    state: 'ACTIVE',
  };
  const payload = {
    contract: 'ProjectListQuery',
    version: 1,
    requestId: 'request:project:list:session:001',
    limit: 25,
  };
  const invocation = {
    contract: 'RemoteInvocationEnvelope',
    version: 1,
    requestId: payload.requestId,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    subjectId: session.subjectId,
    sessionRevision: session.sessionRevision,
    clientCounter: 8,
    nonce: 'fixture_nonce_0000000000000008',
    sentAt: T1,
    capabilityId: 'projects',
    capabilityVersion: 2,
    operationId: 'project.list',
    payload,
    payloadDigest: await digestRemoteCoreValue(payload, cryptoApi),
    deviceSignature: 'B'.repeat(86),
  };
  const responsePayload = {
    contract: 'ProjectPage',
    version: 1,
    requestId: payload.requestId,
    status: 'ok',
    items: [],
    end: true,
    nextCursor: null,
    snapshotRevision: 'snapshot-revision:001',
  };
  const response = {
    contract: 'RemoteResponseEnvelope',
    version: 1,
    requestId: invocation.requestId,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    subjectId: session.subjectId,
    sessionRevision: session.sessionRevision,
    acceptedCounter: invocation.clientCounter,
    respondedAt: '2026-08-27T12:00:06.000Z',
    status: 'ok',
    payload: responsePayload,
    payloadDigest: await digestRemoteCoreValue(responsePayload, cryptoApi),
    error: null,
  };
  const queryBinding = { operationId: invocation.operationId, limit: payload.limit };
  const queryDigest = await digestRemoteCoreValue(queryBinding, cryptoApi);
  const cursor = {
    contract: 'RemoteCursorBinding',
    version: 1,
    cursorDigest: `sha256:${'d'.repeat(64)}`,
    deviceId: session.deviceId,
    subjectId: session.subjectId,
    sessionRevision: session.sessionRevision,
    capabilityId: invocation.capabilityId,
    capabilityVersion: invocation.capabilityVersion,
    operationId: invocation.operationId,
    queryDigest,
    snapshotRevision: responsePayload.snapshotRevision,
    limit: payload.limit,
    issuedAt: T1,
    expiresAt: '2026-08-27T12:05:00.000Z',
  };
  const controlMessages = {
    'RemotePairingClaimRequest@1': {
      contract: 'RemotePairingClaimRequest', version: 1,
      requestId: 'request:pairing:claim:001', claimCode: 'C'.repeat(22),
      clientInstanceId: hello.clientInstanceId, clientBuild: hello.clientBuild,
      deviceKeyId: hello.deviceKeyId, devicePublicKey: 'A'.repeat(43),
      clientNonce: 'pairing_nonce_0000000000000001', sentAt: T0,
    },
    'RemotePairingClaimResult@1': {
      contract: 'RemotePairingClaimResult', version: 1,
      requestId: 'request:pairing:claim:001', status: 'paired',
      deviceId: session.deviceId, subjectId: session.subjectId,
      pairingRevision: session.pairingRevision, scopes: session.scopes,
      deviceKeyId: session.deviceKeyId, pairedAt: T1, error: null,
    },
    'RemoteSessionOpenRequest@1': {
      contract: 'RemoteSessionOpenRequest', version: 1,
      requestId: 'request:session:open:001', clientInstanceId: hello.clientInstanceId,
      clientBuild: hello.clientBuild, deviceId: session.deviceId,
      pairingRevision: session.pairingRevision, deviceKeyId: session.deviceKeyId,
      serverNonce: 'server_nonce_00000000000000001',
      deviceSignature: 'B'.repeat(86), sentAt: T0,
    },
    'RemoteSessionOpenResult@1': {
      contract: 'RemoteSessionOpenResult', version: 1,
      requestId: 'request:session:open:001', status: 'active',
      sessionId: session.sessionId, deviceId: session.deviceId,
      subjectId: session.subjectId, pairingRevision: session.pairingRevision,
      sessionRevision: session.sessionRevision, scopes: session.scopes,
      issuedAt: session.issuedAt, expiresAt: session.expiresAt,
      serverOrigin: session.serverOrigin, serverIdentityPin: session.serverIdentityPin,
      adapterManifestDigest: session.adapterManifestDigest, error: null,
    },
    'RemoteSessionRefreshRequest@1': {
      contract: 'RemoteSessionRefreshRequest', version: 1,
      requestId: 'request:session:refresh:001', sessionId: session.sessionId,
      deviceId: session.deviceId, subjectId: session.subjectId,
      sessionRevision: session.sessionRevision, clientCounter: 9,
      clientNonce: 'refresh_nonce_0000000000000001',
      serverNonce: 'server_nonce_00000000000000002',
      deviceSignature: 'B'.repeat(86), sentAt: T1,
    },
    'RemoteSessionRefreshResult@1': {
      contract: 'RemoteSessionRefreshResult', version: 1,
      requestId: 'request:session:refresh:001', status: 'active',
      sessionId: session.sessionId, deviceId: session.deviceId,
      subjectId: session.subjectId, pairingRevision: session.pairingRevision,
      sessionRevision: 'session-revision:002', scopes: session.scopes,
      issuedAt: T1, expiresAt: '2026-08-27T12:15:05.000Z',
      serverOrigin: session.serverOrigin, serverIdentityPin: session.serverIdentityPin,
      adapterManifestDigest: session.adapterManifestDigest, error: null,
    },
    'RemoteSessionRevokeRequest@1': {
      contract: 'RemoteSessionRevokeRequest', version: 1,
      requestId: 'request:session:revoke:001', sessionId: session.sessionId,
      deviceId: session.deviceId, subjectId: session.subjectId,
      sessionRevision: session.sessionRevision, clientCounter: 10,
      clientNonce: 'revoke_nonce_00000000000000001',
      deviceSignature: 'B'.repeat(86), reason: 'logout', sentAt: T1,
    },
    'RemoteSessionRevokeResult@1': {
      contract: 'RemoteSessionRevokeResult', version: 1,
      requestId: 'request:session:revoke:001', status: 'revoked',
      deviceId: session.deviceId, subjectId: session.subjectId,
      pairingRevision: session.pairingRevision,
      sessionRevision: 'session-revision:002',
      revokedAt: '2026-08-27T12:00:07.000Z', error: null,
    },
  };
  return deepFreeze({
    hello, negotiation, session, invocation, response, queryBinding, queryDigest,
    cursor, controlMessages,
  });
}

export function createRemoteSessionNegativeFixturesV1(golden) {
  const fixtures = [];
  const add = (id, target, mutate) => {
    const value = structuredClone(golden[target]);
    mutate(value);
    fixtures.push({ id, target, value });
  };
  add('subject-substitution', 'invocation', value => { value.subjectId = 'subject:foreign'; });
  add('device-substitution', 'invocation', value => { value.deviceId = 'device:foreign'; });
  add('session-revision-replay', 'invocation', value => { value.sessionRevision = 'session-revision:old'; });
  add('protocol-downgrade', 'invocation', value => { value.version = 0; });
  add('payload-tamper', 'invocation', value => { value.payload.limit = 24; });
  add('legacy-route-injection', 'invocation', value => { value.path = '/m1/projects'; });
  add('response-subject-substitution', 'response', value => { value.subjectId = 'subject:foreign'; });
  add('response-payload-tamper', 'response', value => { value.payload.end = false; });
  add('cursor-device-rebind', 'cursor', value => { value.deviceId = 'device:foreign'; });
  add('cursor-query-rebind', 'cursor', value => { value.queryDigest = `sha256:${'e'.repeat(64)}`; });
  return deepFreeze(fixtures);
}

export const MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1 = deepFreeze({
  nowMs: Date.parse('2026-08-27T12:00:10.000Z'),
  previousCounter: 7,
});
