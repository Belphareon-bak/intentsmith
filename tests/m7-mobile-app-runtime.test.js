import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';

const ORIGIN = 'https://100.64.0.10:7443';
const PIN = `sha256:${'ab'.repeat(32)}`;
const ADAPTER = 'sha256:abe99330702ea02ccdf7b644f4114df1b910a6e83cf3229a294a90e74c0822f4';
const DESCRIPTOR = 'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52';
const issuedAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

function storage() {
  const values = {};
  Object.defineProperties(values, {
    getItem: { enumerable: false, value: key => values[key] ?? null },
    setItem: { enumerable: false, value: (key, value) => { values[key] = String(value); } },
    removeItem: { enumerable: false, value: key => { delete values[key]; } },
    clear: { enumerable: false, value: () => Object.keys(values).forEach(key => delete values[key]) },
  });
  return values;
}

function element(tag = 'div') {
  const classes = new Set();
  const value = {
    tagName: tag.toUpperCase(), className: '', innerHTML: '', textContent: '', value: '',
    hidden: false, dataset: {}, style: {}, children: [], scrollTop: 0, scrollHeight: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    appendChild(child) { value.children.push(child); return child; },
    remove() {},
    addEventListener() {},
  };
  return value;
}

const roots = { app: element(), scrim: element(), toasts: element() };
globalThis.localStorage = storage();
globalThis.document = {
  body: element('body'),
  getElementById: id => roots[id] || null,
  querySelector: () => null,
  createElement: tag => element(tag),
  addEventListener() {},
  visibilityState: 'visible',
};
globalThis.window = {
  addEventListener() {},
  matchMedia: () => ({ matches: false }),
};
globalThis.location = { hash: '', pathname: '/', href: 'https://localhost/' };
globalThis.history = { replaceState() {} };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {},
});

const remoteState = {
  clientBuild: 'android-test-source', clientInstanceId: 'client:test-001',
  deviceId: 'device:test-001', deviceKeyId: 'device-key:test-001',
  expiresAt, issuedAt, lastCounter: 7, pairingRevision: 'pairing:test-001', scopes: [],
  serverIdentityPin: PIN, serverOrigin: ORIGIN,
  sessionId: 'session:test-001', sessionRevision: 'session-revision:test-001',
  subjectId: 'subject:test-001', version: 1,
};
let domain = JSON.stringify({ 'is.remote.v1': remoteState, 'is.auth.scopes': [] });
let nativePosts = 0;
let browserFetches = 0;

const vault = {
  async getState() {
    return {
      available: true, error: null, hasCredential: false, hasPin: false,
      locked: false, lockKind: 'system', maxFailures: 10,
    };
  },
  async readDomain() { return { data: domain }; },
  async writeDomain({ data }) { domain = data; return { stored: true }; },
  async clearDomain() { domain = '{}'; return { cleared: true }; },
  async consumePairingCode() { return {}; },
};

const remote = {
  async describe() {
    return {
      adapterManifestDigest: ADAPTER, available: true, clientBuild: 'android-test-source',
      minimumApi: 29, nativeHttps: true, origin: ORIGIN, proxy: 'forbidden',
      redirect: 'forbidden', serverIdentityPin: PIN, tlsVersion: 'TLSv1.3',
    };
  },
  async identity() { throw new Error('identity must not be minted during resume'); },
  async sign() { throw new Error('active resume must not sign'); },
  async post() { nativePosts += 1; throw new Error('active resume must not post'); },
  async health({ requestId }) {
    return { status: 200, body: {
      contract: 'RemoteHealthSnapshot', version: 1, requestId, status: 'ok',
      coreVersion: 'test', observedAt: new Date().toISOString(),
      components: [{ componentId: 'database', status: 'ok', code: 'READY' }],
    } };
  },
  async clear() { return { cleared: true }; },
};

globalThis.Capacitor = {
  isNativePlatform: () => true,
  Plugins: { IntentSmithRemote: remote, IntentSmithVault: vault },
};
globalThis.IntentSmithRuntimeConfig = Object.freeze({
  gatewayUrl: ORIGIN,
  transportMode: 'remote-core-v1',
  remoteCore: Object.freeze({
    adapterManifestDigest: ADAPTER,
    descriptorDigest: DESCRIPTOR,
    serverIdentityPin: PIN,
    serverOrigin: ORIGIN,
  }),
});
globalThis.fetch = async () => {
  browserFetches += 1;
  throw new Error('remote mode must not use browser fetch');
};

const { __ms20 } = await import('../src/mobile/client/app.js');
for (let attempt = 0; attempt < 50 && __ms20.state.session === 'unknown'; attempt += 1) {
  await new Promise(resolve => setImmediate(resolve));
}

assert.equal(__ms20.state.session, 'active');
assert.equal(__ms20.auth.token, null);
assert.equal(__ms20.auth.device, remoteState.deviceId);
const capabilities = await __ms20.api('/capabilities');
assert.equal(capabilities.data.device.id, remoteState.deviceId);
assert.deepEqual(capabilities.data.scopes, []);
const health = await __ms20.api('/health');
assert.equal(health.data.protocolVersion, 'remote-core-v1');
assert.equal(nativePosts, 0);
assert.equal(browserFetches, 0);
assert.match(__ms20.storageIdentity(), new RegExp(ADAPTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

// Losing the VPN while a validated pairing exists must not turn the device
// into the impossible state "has a durable key but UI says unpaired". The
// connection gate remains closed, and an online event must prove reachability
// through health before data refresh resumes.
await __ms20.applyM7ResumeFailure(Object.assign(new Error('offline'), {
  code: 'M7_REMOTE_FAILURE',
}));
assert.equal(__ms20.state.session, 'active');
assert.equal(__ms20.state.conn, 'offline');
assert.equal(__ms20.hasPairedIdentity(), true);
__ms20.state.route = 'diagnostics';
await __ms20.handleCameOnline();
assert.equal(__ms20.state.session, 'active');
assert.equal(__ms20.state.conn, 'ok');
assert.equal(__ms20.state.error.security, null);

__ms20.lockDownSession();
await assert.rejects(__ms20.api('/health'), error => error.code === 'locked');
assert.equal(browserFetches, 0);

await __ms20.applyM7ResumeFailure(Object.assign(new Error('bad proof'), {
  code: 'REMOTE_DEVICE_SIGNATURE_INVALID',
}));
assert.equal(__ms20.state.session, 'invalid');
assert.equal(__ms20.hasPairedIdentity(), true);
assert.deepEqual(__ms20.auth.scopes, []);

console.log('\nM7 mobile app runtime: 1 passed, 0 failed');
