import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { digestRemoteCoreValue } from '../src/mobile/client/remote-core-v1.js';

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
const invocations = [];
let failNextOperation = null;
let heldDomainWrite = null;

function holdNextDomainWrite() {
  let signalEntered;
  let release;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  heldDomainWrite = { gate, signalEntered };
  return { entered, release };
}

const vault = {
  async getState() {
    return {
      available: true, error: null, hasCredential: false, hasPin: false,
      locked: false, lockKind: 'system', maxFailures: 10,
    };
  },
  async readDomain() { return { data: domain }; },
  async writeDomain({ data }) {
    const held = heldDomainWrite;
    heldDomainWrite = null;
    if (held) {
      held.signalEntered();
      await held.gate;
    }
    domain = data;
    return { stored: true };
  },
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
  async sign({ request }) {
    return { deviceKeyId: remoteState.deviceKeyId, deviceSignature: 'A'.repeat(86), request };
  },
  async post({ path, body }) {
    nativePosts += 1;
    if (path !== '/remote/v1/invoke') throw new Error(`unexpected native path ${path}`);
    invocations.push(structuredClone(body));
    if (failNextOperation === body.operationId) {
      failNextOperation = null;
      throw Object.assign(new Error('ambiguous native failure'), { code: 'NETWORK' });
    }
    const request = body.payload;
    const now = '2026-09-10T20:00:00.000Z';
    const payload = {
      'project.list': {
        contract: 'ProjectPage', version: 1, requestId: request.requestId, status: 'ok',
        items: [{
          projectId: 7, name: 'IntentSmith', lifecycleStage: 'implementation', updatedAt: now,
          workspaceRevision: `wsr1:${'a'.repeat(64)}`,
          revision: `rev:project:${'b'.repeat(64)}`,
        }], end: true, nextCursor: null, snapshotRevision: `rev:projects:${'c'.repeat(64)}`,
      },
      'settings.read': {
        contract: 'MobileSettingsSnapshot', version: 1, requestId: request.requestId, status: 'ok',
        items: [{
          key: 'appearance.theme', category: 'appearance', valueType: 'enum', value: 'dark',
          writable: true, constraints: { enumValues: ['dark', 'light', 'system'] },
          revision: `rev:setting:${'d'.repeat(64)}`,
        }], revision: `rev:settings:${'e'.repeat(64)}`,
      },
      'settings.update': {
        contract: 'MobileSettingUpdateResult', version: 1, requestId: request.requestId,
        operationId: request.operationId, key: request.key, value: request.value,
        revision: `rev:settings:${'f'.repeat(64)}`, outcome: 'CONFIRMED', replayed: false,
      },
      'stored-information.list': {
        contract: 'StoredInformationPage', version: 1, requestId: request.requestId, status: 'ok',
        items: [{
          informationId: 'information:test-001', kind: 'manual_note', projectId: 7,
          summary: 'Dokončit mobilní obrazovky', content: 'Dokončit mobilní obrazovky.',
          tags: ['mobile'], createdAt: now, updatedAt: now,
          revision: `rev:information:${'1'.repeat(64)}`,
        }], end: true, nextCursor: null,
        snapshotRevision: `rev:information-snapshot:${'2'.repeat(64)}`,
      },
      'stored-information.append': {
        contract: 'StoredInformationAppendResult', version: 1, requestId: request.requestId,
        operationId: request.operationId, informationId: 'information:test-002',
        revision: `rev:information:${'3'.repeat(64)}`, outcome: 'CONFIRMED', replayed: false,
      },
    }[body.operationId];
    if (!payload) throw new Error(`unexpected operation ${body.operationId}`);
    return { status: 200, body: {
      contract: 'RemoteResponseEnvelope', version: 1, requestId: body.requestId,
      sessionId: body.sessionId, deviceId: body.deviceId, subjectId: body.subjectId,
      sessionRevision: body.sessionRevision, acceptedCounter: body.clientCounter,
      respondedAt: now, status: 'ok', payload,
      payloadDigest: await digestRemoteCoreValue(payload), error: null,
    } };
  },
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

// The remaining M7 DTOs now terminate in real screens. Legacy transport stays
// unchanged; these assertions run through native invoke and the UI adapter.
__ms20.replaceScopes([
  'read:projects', 'read:settings', 'read:stored_information',
  'write:settings', 'write:stored_information',
]);
await __ms20.loadProjects();
assert.match(__ms20.viewProjects(), /IntentSmith/);
assert.match(__ms20.viewProjects(), /Implementace/);
assert.equal(__ms20.navItems().find(item => item.id === 'projects').locked, false);

await __ms20.loadSettings();
const settingsRevision = __ms20.state.settingsRevision;
await __ms20.updateSetting('appearance.theme', 'light');
const settingMutation = invocations.find(call => call.operationId === 'settings.update');
assert.equal(settingMutation.payload.expectedRevision, settingsRevision);
assert.equal(settingMutation.payload.value, 'light');
assert.match(__ms20.viewDiagnostics(), /Serverová nastavení/);

// Hold the durable journal write open. A second UI activation during this
// window must observe the first journal entry even though settingsSaving has
// not been set yet, and therefore must not create or dispatch another attempt.
await __ms20.store.flush();
const beforeSettingRace = invocations.filter(call => call.operationId === 'settings.update').length;
const heldWrite = holdNextDomainWrite();
const firstSettingAttempt = __ms20.updateSetting('appearance.theme', 'system');
await heldWrite.entered;
await __ms20.updateSetting('appearance.theme', 'dark');
assert.equal(__ms20.openSettingAttempt()?.operationType, 'settings.update');
assert.equal(__ms20.journal.open().filter(entry => entry.operationType === 'settings.update').length, 1);
assert.equal(invocations.filter(call => call.operationId === 'settings.update').length,
  beforeSettingRace, 'a held journal flush must prevent both settings dispatches');
heldWrite.release();
await firstSettingAttempt;
assert.equal(invocations.filter(call => call.operationId === 'settings.update').length,
  beforeSettingRace + 1, 'only the durable first settings operation may dispatch');
assert.equal(__ms20.openSettingAttempt(), null);

await __ms20.loadMemory();
assert.match(__ms20.viewMemory(), /Dokončit mobilní obrazovky/);
await __ms20.addMemory({ content: 'Předat milník k review.', tags: 'review, mobile', projectId: 7 });
const informationMutation = invocations.find(call => call.operationId === 'stored-information.append');
assert.deepEqual(informationMutation.payload.tags, ['mobile', 'review']);
assert.equal(__ms20.openMemoryAttempt(), null);
assert.equal(__ms20.drafts.get('compose:stored-information.append'), null);
assert.equal(browserFetches, 0);

const guardedInvocations = invocations.length;
__ms20.state.cacheAge.settings = 'STALE';
await __ms20.updateSetting('appearance.theme', 'system');
assert.equal(invocations.length, guardedInvocations, 'stale settings must not dispatch');
__ms20.state.cacheAge.settings = 'FRESH';
__ms20.state.conn = 'offline';
await __ms20.addMemory({ content: 'Zůstane lokálně.', tags: 'offline', projectId: null });
assert.equal(invocations.length, guardedInvocations, 'offline information append must not dispatch');
assert.equal(__ms20.drafts.get('compose:stored-information.append').content, 'Zůstane lokálně.');

__ms20.state.conn = 'ok';
__ms20.drafts.drop('compose:stored-information.append');
failNextOperation = 'stored-information.append';
await __ms20.addMemory({ content: 'Nejasný výsledek.', tags: 'unknown', projectId: null });
const unresolved = __ms20.openMemoryAttempt();
assert.equal(unresolved.operationType, 'stored-information.append');
assert.equal(unresolved.lastKnownState, 'UNKNOWN');
assert.equal(__ms20.drafts.get(unresolved.operationId).content, 'Nejasný výsledek.');
assert.equal(__ms20.drafts.get('compose:stored-information.append'), null);
const afterAmbiguous = invocations.length;
__ms20.state.conn = 'ok';
await __ms20.addMemory({ content: 'Nesmí se odeslat.', tags: '', projectId: null });
assert.equal(invocations.length, afterAmbiguous, 'an unresolved append must block blind resubmission');
assert.match(__ms20.viewMemory(), /znovu neposílá/);

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

console.log('\nM7 mobile app runtime: 7 passed, 0 failed');
