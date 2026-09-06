import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function makeStorage() {
  const data = {};
  const method = (name, value) => Object.defineProperty(data, name, { value, enumerable: false });
  method('getItem', key => (Object.hasOwn(data, key) ? data[key] : null));
  method('setItem', (key, value) => { data[key] = String(value); });
  method('removeItem', key => { delete data[key]; });
  method('clear', () => { for (const key of Object.keys(data)) delete data[key]; });
  return data;
}

function element(tag = 'div') {
  const classes = new Set();
  const node = {
    tagName: tag.toUpperCase(),
    className: '', innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, children: [],
    scrollTop: 0, scrollHeight: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    appendChild(child) { node.children.push(child); return child; },
    remove() {},
    addEventListener() {},
  };
  return node;
}

const nodes = { app: element(), toasts: element() };
globalThis.localStorage = makeStorage();
globalThis.document = {
  body: element('body'),
  visibilityState: 'visible',
  getElementById: id => nodes[id] || null,
  querySelector: () => null,
  createElement: tag => element(tag),
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState() {} };
globalThis.fetch = async () => { throw new TypeError('network disabled'); };

const { __ms20 } = await import('../src/mobile/client/app.js');
const {
  state, store, secure, auth, cache, journal, K,
  viewDevices, viewDiagnostics, viewSession,
  loadDevices, askDeviceRevoke, cancelDeviceRevoke, confirmDeviceRevoke,
  handleAuthFailure, replaceScopes,
} = __ms20;

function device(overrides = {}) {
  return {
    deviceId: 'device-other-123',
    name: 'Druhý telefon',
    scopes: ['read:devices'],
    createdAt: '2026-09-01 10:00:00',
    lastUsedAt: '2026-09-06 10:00:00',
    expiresAt: '2027-09-06 10:00:00',
    revokedAt: null,
    revoked: false,
    expired: false,
    current: false,
    version: 'v1:device',
    ...overrides,
  };
}

function reset(scopes = ['read:devices', 'write:devices']) {
  localStorage.clear();
  secure.plugin = null;
  secure.mode = 'browser';
  secure.reason = null;
  secure.cache = { token: null, device: null };
  store.set(K.token, 'token');
  store.set(K.device, 'device-current-123');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.sessionWipeFailed = false;
  state.route = 'devices';
  state.conn = 'ok';
  state.data = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.pagination = {};
  state.deviceConfirm = null;
  state.deviceRevoking = null;
  state.deviceNote = null;
  nodes.app.innerHTML = '';
}

function response(data, { status = 200, extra = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return { ok: true, protocolVersion: 'm1.2026-07-30', data, ...extra }; },
  };
}

console.log('\n=== Mobile paired-device UI ===');

await test('settings exposes the device manager only with read authority', () => {
  reset(['read:devices']);
  assert.match(viewDiagnostics(), /data-route="devices"/);
  reset([]);
  assert.match(viewDiagnostics(), /scope read:devices chybí/);
  assert.ok(!viewDiagnostics().includes('data-route="devices"'));
});

await test('missing scope and stale cache cannot expose an active revoke control', () => {
  reset([]);
  state.data.devices = [device({ name: 'must-not-render' })];
  assert.match(viewDevices(), /read:devices/);
  assert.ok(!viewDevices().includes('must-not-render'));

  reset();
  state.data.devices = [device()];
  state.cacheAge.devices = 'STALE';
  const stale = viewDevices();
  assert.match(stale, /starší cache/);
  assert.match(stale, /data-act="device-revoke-ask"[^>]*disabled/);
});

await test('fresh rows are escaped, identify this phone and deny remote-wipe claims', () => {
  reset();
  state.data.devices = [
    device({ deviceId: 'device-current-123', name: '<script>current</script>', current: true }),
    device(),
  ];
  state.cacheAge.devices = 'FRESH';
  const html = viewDevices();
  assert.ok(!html.includes('<script>'));
  assert.match(html, /toto zařízení/);
  assert.match(html, /vzdáleně nesmaže/);
});

await test('revocation requires a fresh row and an explicit second step', () => {
  reset();
  state.data.devices = [device()];
  state.cacheAge.devices = 'FRESH';
  askDeviceRevoke('device-other-123');
  assert.equal(state.deviceConfirm, 'device-other-123');
  assert.match(viewDevices(), /Potvrdit odvolání/);
  cancelDeviceRevoke();
  assert.equal(state.deviceConfirm, null);

  replaceScopes(['read:devices']);
  assert.match(viewDevices(), /data-act="device-revoke-ask"[^>]*disabled/);
});

await test('self-revoke warning names unresolved attempts before dispatch', () => {
  reset();
  journal.add({ operationId: 'e'.repeat(32), operationType: 'chat.send', displaySummary: 'Odeslání zprávy' });
  state.data.devices = [device({ deviceId: 'device-current-123', current: true })];
  state.cacheAge.devices = 'FRESH';
  askDeviceRevoke('device-current-123');
  assert.match(viewDevices(), /1 nerozřešených operací/);
  assert.match(viewDevices(), /Odvoláváš tento telefon/);
});

await test('device list accepts only the versioned public DTO', async () => {
  reset(['read:devices']);
  globalThis.fetch = async () => response([device()]);
  await loadDevices();
  assert.equal(state.data.devices[0].deviceId, 'device-other-123');
  assert.equal(cache.read('devices').status, 'FRESH');

  globalThis.fetch = async () => response([{ deviceId: 'device-other-123', token_hash: 'secret' }]);
  await loadDevices();
  assert.equal(state.error.devices.kind, 'protocol');
  assert.equal(state.cacheAge.devices, 'FRESH');
});

await test('confirmed revoke sends one journalled mutation and refreshes with a read', async () => {
  reset();
  state.data.devices = [device()];
  state.cacheAge.devices = 'FRESH';
  askDeviceRevoke('device-other-123');
  const calls = [];
  let operationId;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      operationId = JSON.parse(options.body).operationId;
      return response({
        operationId,
        state: 'CONFIRMED',
        deviceId: 'device-other-123',
        revoked: true,
        alreadyRevoked: false,
        current: false,
        remoteWipe: false,
      });
    }
    return response([device({ revoked: true, revokedAt: '2026-09-06 11:00:00' })]);
  };
  await confirmDeviceRevoke('device-other-123');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/m1/devices/device-other-123/revoke');
  assert.equal(calls[1].url, '/m1/devices');
  assert.equal(journal.find(operationId).lastKnownState, 'CONFIRMED');
  assert.equal(state.data.devices[0].revoked, true);
  assert.match(state.deviceNote.text, /nejde o vzdálené smazání/);
});

await test('unreadable mutation response remains UNKNOWN and is never retried', async () => {
  reset();
  state.data.devices = [device()];
  state.cacheAge.devices = 'FRESH';
  askDeviceRevoke('device-other-123');
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response({ state: 'CONFIRMED', deviceId: 'different-device' });
  };
  await confirmDeviceRevoke('device-other-123');
  assert.equal(calls, 1);
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN');
  assert.match(state.deviceNote.text, /Nic se neopakuje/);
});

await test('self-revoke clears the credential and moves to the revoked session', async () => {
  reset();
  state.data.devices = [device({ deviceId: 'device-current-123', current: true })];
  state.cacheAge.devices = 'FRESH';
  askDeviceRevoke('device-current-123');
  globalThis.fetch = async (_url, options) => {
    const operationId = JSON.parse(options.body).operationId;
    return response({
      operationId,
      state: 'CONFIRMED',
      deviceId: 'device-current-123',
      revoked: true,
      alreadyRevoked: false,
      current: true,
      remoteWipe: false,
    });
  };
  await confirmDeviceRevoke('device-current-123');
  assert.equal(state.session, 'revoked');
  assert.equal(auth.token, null);
  assert.deepEqual(state.data, {});
});

await test('server revocation clears Android vault; failed deletion stays visible and fail-closed', async () => {
  reset();
  let clears = 0;
  secure.plugin = { async clear() { clears += 1; } };
  secure.mode = 'native';
  secure.cache = { token: 'native-token', device: 'device-current-123' };
  await handleAuthFailure({ code: 'token_revoked' });
  assert.equal(clears, 1);
  assert.equal(secure.cache.token, null);
  assert.equal(state.sessionWipeFailed, false);

  reset();
  secure.plugin = { async clear() { throw new Error('keystore unavailable'); } };
  secure.mode = 'native';
  secure.cache = { token: 'native-token', device: 'device-current-123' };
  await handleAuthFailure({ code: 'token_revoked' });
  assert.equal(secure.cache.token, null);
  assert.equal(state.session, 'revoked');
  assert.equal(state.sessionWipeFailed, true);
  assert.match(viewSession(), /trezor nepotvrdil smazání tokenu/);
});

await test('expiry clears the credential but preserves the content-free recovery journal', async () => {
  reset();
  journal.add({ operationId: 'f'.repeat(32), operationType: 'device.revoke', displaySummary: 'Odvolání zařízení' });
  await handleAuthFailure({ code: 'token_expired' });
  assert.equal(auth.token, null);
  assert.equal(state.session, 'expired');
  assert.equal(journal.open().length, 1);
});

console.log(`\nMobile devices UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
