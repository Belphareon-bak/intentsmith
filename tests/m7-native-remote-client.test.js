import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';

import {
  M7_NATIVE_ADAPTER_MANIFEST_DIGEST,
  M7_NATIVE_OPERATION_CATALOG,
  createM7NativeRemoteClient,
} from '../src/mobile/client/m7-native-remote-client.js';
import {
  M7_RUNTIME_OPERATION_BINDINGS,
  M7_RUNTIME_OPERATION_DESCRIPTORS,
} from '../src/mobile/client/m7-runtime-contract-v1.js';
import { REMOTE_CORE_V1_PIN, digestRemoteCoreValue } from '../src/mobile/client/remote-core-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  MOBILE_REMOTE_OPERATION_BINDINGS_V1,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';

const SERVER_ORIGIN = 'https://100.64.0.10:7443';
const SERVER_PIN = `sha256:${'a'.repeat(64)}`;
const DESCRIPTOR = REMOTE_CORE_V1_PIN.descriptorDigest;
const runtime = Object.freeze({
  gatewayUrl: SERVER_ORIGIN,
  transportMode: 'remote-core-v1',
  remoteCore: Object.freeze({
    adapterManifestDigest: M7_NATIVE_ADAPTER_MANIFEST_DIGEST,
    descriptorDigest: DESCRIPTOR,
    serverIdentityPin: SERVER_PIN,
    serverOrigin: SERVER_ORIGIN,
  }),
});

function clone(value) { return value === null ? null : structuredClone(value); }

function stateStore(initial = null) {
  let value = clone(initial);
  const saves = [];
  return {
    async load() { return clone(value); },
    async save(next) { value = clone(next); saves.push(clone(next)); },
    async clear() { value = null; },
    current() { return clone(value); },
    saves,
  };
}

function nativeFixture({ failInvoke = false, failRefresh = false, origin = SERVER_ORIGIN } = {}) {
  const calls = [];
  let cleared = 0;
  return {
    calls,
    get cleared() { return cleared; },
    async describe() {
      return {
        available: true,
        origin,
        serverIdentityPin: SERVER_PIN,
        adapterManifestDigest: M7_NATIVE_ADAPTER_MANIFEST_DIGEST,
        clientBuild: 'android-test-source',
        minimumApi: 29,
        nativeHttps: true,
        tlsVersion: 'TLSv1.3',
        proxy: 'forbidden',
        redirect: 'forbidden',
      };
    },
    async identity() {
      return { deviceKeyId: 'device-key:test-001', devicePublicKey: 'A'.repeat(43) };
    },
    async sign({ schemaId, request }) {
      calls.push({ kind: 'sign', schemaId, request: clone(request) });
      assert.equal(request.deviceSignature, '');
      return { deviceKeyId: 'device-key:test-001', deviceSignature: 'A'.repeat(86) };
    },
    async post({ path, body }) {
      calls.push({ kind: 'post', path, body: clone(body) });
      if (path === '/remote/v1/pairing/claim') {
        return { status: 200, body: {
          contract: 'RemotePairingClaimResult', version: 1,
          requestId: body.requestId, status: 'paired', deviceId: 'device:test-001',
          subjectId: 'subject:test-001', pairingRevision: 'pairing:test-001',
          scopes: ['read:projects'], deviceKeyId: body.deviceKeyId,
          pairedAt: '2026-09-08T20:00:00.000Z', error: null,
        } };
      }
      if (path === '/remote/v1/session/challenge') {
        return { status: 200, body: {
          contract: 'RemoteSessionChallengeResult', version: 1,
          requestId: body.requestId, status: 'issued', deviceId: body.deviceId,
          pairingRevision: body.pairingRevision, purpose: body.purpose,
          sessionId: body.sessionId, sessionRevision: body.sessionRevision,
          challengeId: 'challenge:test-001', serverNonce: 'S'.repeat(32),
          issuedAt: '2026-09-08T20:00:00.000Z', expiresAt: '2026-09-08T20:00:30.000Z',
          serverIdentityPin: SERVER_PIN, error: null,
        } };
      }
      if (path === '/remote/v1/session/open') {
        return { status: 200, body: {
          contract: 'RemoteSessionOpenResult', version: 1,
          requestId: body.requestId, status: 'active', sessionId: 'session:test-001',
          deviceId: body.deviceId, subjectId: 'subject:test-001',
          pairingRevision: body.pairingRevision, sessionRevision: 'session-revision:test-001',
          scopes: ['read:projects'], issuedAt: '2026-09-08T20:00:00.000Z',
          expiresAt: '2026-09-08T20:15:00.000Z', serverOrigin: SERVER_ORIGIN,
          serverIdentityPin: SERVER_PIN,
          adapterManifestDigest: M7_NATIVE_ADAPTER_MANIFEST_DIGEST, error: null,
        } };
      }
      if (path === '/remote/v1/session/refresh') {
        if (failRefresh) throw Object.assign(new Error('ambiguous refresh failure'), { code: 'NETWORK' });
        return { status: 200, body: {
          contract: 'RemoteSessionRefreshResult', version: 1,
          requestId: body.requestId, status: 'active', sessionId: body.sessionId,
          deviceId: body.deviceId, subjectId: body.subjectId,
          pairingRevision: 'pairing:test-001', sessionRevision: 'session-revision:test-002',
          scopes: ['read:projects'], issuedAt: '2026-09-08T20:00:01.000Z',
          expiresAt: '2026-09-08T20:15:01.000Z', serverOrigin: SERVER_ORIGIN,
          serverIdentityPin: SERVER_PIN,
          adapterManifestDigest: M7_NATIVE_ADAPTER_MANIFEST_DIGEST, error: null,
        } };
      }
      if (path === '/remote/v1/session/revoke') {
        return { status: 200, body: {
          contract: 'RemoteSessionRevokeResult', version: 1,
          requestId: body.requestId, status: 'revoked', deviceId: body.deviceId,
          subjectId: body.subjectId, pairingRevision: 'pairing:test-001',
          sessionRevision: 'session-revision:test-003',
          revokedAt: '2026-09-08T20:00:02.000Z', error: null,
        } };
      }
      if (path === '/remote/v1/invoke') {
        if (failInvoke) throw Object.assign(new Error('ambiguous native failure'), { code: 'NETWORK' });
        const payload = {
          contract: 'ProjectPage', version: 1, requestId: body.requestId,
          status: 'ok', items: [], end: true, nextCursor: null,
          snapshotRevision: 'revision:test-001',
        };
        return { status: 200, body: {
          contract: 'RemoteResponseEnvelope', version: 1, requestId: body.requestId,
          sessionId: body.sessionId, deviceId: body.deviceId, subjectId: body.subjectId,
          sessionRevision: body.sessionRevision, acceptedCounter: body.clientCounter,
          respondedAt: '2026-09-08T20:00:01.000Z', status: 'ok', payload,
          payloadDigest: await digestRemoteCoreValue(payload), error: null,
        } };
      }
      throw new Error(`unexpected path ${path}`);
    },
    async health({ requestId }) {
      return { status: 200, body: {
        contract: 'RemoteHealthSnapshot', version: 1, requestId,
        status: 'ok', coreVersion: 'test', observedAt: '2026-09-08T20:00:00.000Z',
        components: [{ componentId: 'database', status: 'ok', code: 'READY' }],
      } };
    },
    async clear() { cleared += 1; },
  };
}

function activeState(overrides = {}) {
  return {
    clientBuild: 'android-test-source', clientInstanceId: 'client:test-001',
    deviceId: 'device:test-001', deviceKeyId: 'device-key:test-001',
    expiresAt: '2026-09-08T20:15:00.000Z', issuedAt: '2026-09-08T20:00:00.000Z',
    lastCounter: 0, pairingRevision: 'pairing:test-001', scopes: ['read:projects'],
    serverIdentityPin: SERVER_PIN, serverOrigin: SERVER_ORIGIN,
    sessionId: 'session:test-001', sessionRevision: 'session-revision:test-001',
    subjectId: 'subject:test-001', version: 1,
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
async function test(name, callback) {
  try { await callback(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (error) { failed += 1; console.error(`  ✗ ${name}: ${error.stack || error}`); }
}

console.log('\n=== M7 native mobile remote client ===');

await test('all reviewed operation identities are pinned in the production client', () => {
  assert.equal(Object.keys(M7_NATIVE_OPERATION_CATALOG).length, 17);
  assert.deepEqual(M7_NATIVE_OPERATION_CATALOG['conversation.execute'], ['conversations', 2]);
  assert.deepEqual(M7_NATIVE_OPERATION_CATALOG['project.list'], ['projects', 2]);
  assert.deepEqual(M7_NATIVE_OPERATION_CATALOG['operation.get'], ['m7-control-plane-prerequisite', 1]);

  const canonical = Object.fromEntries([
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities.flatMap(capability => (
      capability.operations.map(operation => [operation.operationId, {
        capabilityId: capability.capabilityId,
        capabilityVersion: capability.targetVersion,
        kind: operation.kind,
        requestContract: operation.requestContract,
        requestRequiredFields: operation.requestRequiredFields,
        requestOptionalFields: operation.requestOptionalFields,
        resultContract: operation.resultContract,
        successResultRequiredFields: operation.successResultRequiredFields,
        successResultOptionalFields: operation.successResultOptionalFields,
        errorResultRequiredFields: operation.errorResultRequiredFields,
        errorResultOptionalFields: operation.errorResultOptionalFields,
      }])
    )),
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.controlPlanePrerequisite.operations
      .map(operation => [operation.operationId, {
        capabilityId: 'm7-control-plane-prerequisite',
        capabilityVersion: 1,
        kind: operation.kind,
        requestContract: operation.requestContract,
        requestRequiredFields: operation.requestRequiredFields,
        requestOptionalFields: operation.requestOptionalFields,
        resultContract: operation.resultContract,
        successResultRequiredFields: operation.successResultRequiredFields,
        successResultOptionalFields: operation.successResultOptionalFields,
        errorResultRequiredFields: operation.errorResultRequiredFields,
        errorResultOptionalFields: operation.errorResultOptionalFields,
      }]),
  ]);
  delete canonical['remote-health.read'];
  assert.deepEqual(M7_RUNTIME_OPERATION_DESCRIPTORS, canonical);
  assert.deepEqual(M7_RUNTIME_OPERATION_BINDINGS, Object.fromEntries(
    Object.entries(MOBILE_REMOTE_OPERATION_BINDINGS_V1)
      .filter(([operationId]) => operationId !== 'remote-health.read'),
  ));
});

await test('single-use pairing is durably recorded before signed open and invocation', async () => {
  const native = nativeFixture();
  const storage = stateStore();
  const client = createM7NativeRemoteClient({
    nativePlugin: native,
    runtime,
    stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:00.000Z'),
  });
  const paired = await client.pair({ claimCode: 'pairingcode0123456789012' });
  assert.equal(paired.sessionId, 'session:test-001');
  assert.ok(storage.saves.some(item => item.sessionId === null), 'consumed pairing was not persisted');
  assert.equal(storage.current().lastCounter, 0);
  const response = await client.invoke('project.list', {
    contract: 'ProjectListQuery', version: 1,
    requestId: 'request:project:list:001', limit: 10,
  });
  assert.equal(response.status, 'ok');
  assert.equal(storage.current().lastCounter, 1);
  const invocation = native.calls.find(call => call.path === '/remote/v1/invoke').body;
  assert.equal(invocation.deviceSignature, 'A'.repeat(86));
  assert.equal(invocation.capabilityId, 'projects');
  assert.equal(invocation.capabilityVersion, 2);
});

await test('an ambiguous network failure burns its counter durably across restart', async () => {
  const native = nativeFixture({ failInvoke: true });
  const storage = stateStore(activeState());
  const first = createM7NativeRemoteClient({ nativePlugin: native, runtime, stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:00.000Z') });
  await assert.rejects(first.invoke('project.list', {
    contract: 'ProjectListQuery', version: 1, requestId: 'request:failed:001', limit: 10,
  }), /ambiguous native failure/);
  assert.equal(storage.current().lastCounter, 1);

  const replacementNative = nativeFixture();
  const restarted = createM7NativeRemoteClient({
    nativePlugin: replacementNative, runtime, stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:01.000Z'),
  });
  await restarted.invoke('project.list', {
    contract: 'ProjectListQuery', version: 1, requestId: 'request:after-restart:001', limit: 10,
  });
  assert.equal(storage.current().lastCounter, 2);
  assert.equal(
    replacementNative.calls.find(call => call.path === '/remote/v1/invoke').body.clientCounter,
    2,
  );
});

await test('refresh retires the old revision before I/O and revoke destroys local authority', async () => {
  const native = nativeFixture();
  const storage = stateStore(activeState());
  const client = createM7NativeRemoteClient({
    nativePlugin: native, runtime, stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:01.000Z'),
  });
  const refreshed = await client.refresh();
  assert.equal(refreshed.sessionRevision, 'session-revision:test-002');
  assert.ok(storage.saves.some(item => item.sessionId === null && item.lastCounter === 1));
  assert.equal(storage.current().sessionRevision, 'session-revision:test-002');
  assert.equal(storage.current().lastCounter, 1);

  const revoked = await client.revoke('logout');
  assert.equal(revoked.status, 'revoked');
  assert.equal(storage.current(), null);
  assert.equal(native.cleared, 1);
});

await test('ambiguous refresh leaves only resumable pairing state and burns its counter', async () => {
  const native = nativeFixture({ failRefresh: true });
  const storage = stateStore(activeState());
  const client = createM7NativeRemoteClient({
    nativePlugin: native, runtime, stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:01.000Z'),
  });
  await assert.rejects(client.refresh(), /ambiguous refresh failure/);
  assert.equal(storage.current().sessionId, null);
  assert.equal(storage.current().sessionRevision, null);
  assert.equal(storage.current().expiresAt, null);
  assert.equal(storage.current().lastCounter, 1);

  const replacement = nativeFixture();
  const restarted = createM7NativeRemoteClient({
    nativePlugin: replacement, runtime, stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:02.000Z'),
  });
  const resumed = await restarted.resume();
  assert.equal(resumed.sessionId, 'session:test-001');
  assert.equal(storage.current().lastCounter, 0);
});

await test('native origin substitution and unknown operations fail before network I/O', async () => {
  const storage = stateStore();
  const substituted = nativeFixture({ origin: 'https://100.64.0.11:7443' });
  const bad = createM7NativeRemoteClient({ nativePlugin: substituted, runtime, stateStore: storage });
  await assert.rejects(bad.resume(), { code: 'REMOTE_NATIVE_TRANSPORT_UNAVAILABLE' });
  assert.equal(substituted.calls.length, 0);

  const native = nativeFixture();
  const client = createM7NativeRemoteClient({ nativePlugin: native, runtime, stateStore: storage });
  await assert.rejects(client.invoke('legacy.shell.exec', {
    requestId: 'request:legacy:001',
  }), { code: 'REMOTE_OPERATION_UNAVAILABLE' });
  await assert.rejects(client.invoke('project.list', {
    contract: 'ProjectListQuery', version: 1,
    requestId: 'request:invalid:001', limit: 201,
  }), { code: 'REMOTE_CLIENT_REQUEST_INVALID' });
  assert.equal(native.calls.filter(call => call.kind === 'post').length, 0);

  assert.throws(
    () => createM7NativeRemoteClient({
      nativePlugin: native,
      runtime: {
        ...runtime,
        remoteCore: { ...runtime.remoteCore, descriptorDigest: `sha256:${'0'.repeat(64)}` },
      },
      stateStore: storage,
    }),
    { code: 'REMOTE_CLIENT_CONFIGURATION_INVALID' },
  );
});

await test('counter exhaustion fails before signing, persistence or network I/O', async () => {
  const native = nativeFixture();
  const storage = stateStore(activeState({ lastCounter: Number.MAX_SAFE_INTEGER }));
  const client = createM7NativeRemoteClient({ nativePlugin: native, runtime, stateStore: storage,
    now: () => Date.parse('2026-09-08T20:00:00.000Z') });
  await assert.rejects(client.invoke('project.list', {
    contract: 'ProjectListQuery', version: 1,
    requestId: 'request:counter:exhausted', limit: 10,
  }), { code: 'REMOTE_CLIENT_COUNTER_EXHAUSTED' });
  assert.equal(storage.saves.length, 0);
  assert.equal(native.calls.length, 0);
});

console.log(`\nM7 native mobile remote client: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
