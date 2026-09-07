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
  validDeviceRecord, validDeviceSnapshot, validDeviceListResponse, deviceMutationFresh,
  handleAuthFailure, handleWentOffline, handleCameOnline, replaceScopes,
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

function currentDevice(overrides = {}) {
  return device({
    deviceId: 'device-current-123',
    name: 'Tento telefon',
    current: true,
    ...overrides,
  });
}

function deviceList(...others) {
  return [currentDevice(), ...(others.length ? others : [device()])];
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
  state.devicesLive = false;
  nodes.app.innerHTML = '';
}

function response(data, { status = 200, extra = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return {
        ok: true,
        protocolVersion: 'm1.2026-07-30',
        scopes: [...auth.scopes],
        data,
        ...extra,
      };
    },
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
  state.devicesLive = true;
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
  state.devicesLive = true;
  askDeviceRevoke('device-current-123');
  assert.match(viewDevices(), /1 nerozřešených operací/);
  assert.match(viewDevices(), /Odvoláváš tento telefon/);
});

await test('device validators bind the exact public DTO to this credential', () => {
  reset(['read:devices']);
  const rows = deviceList();
  assert.equal(validDeviceRecord(rows[0]), true);
  assert.equal(validDeviceSnapshot(rows), true);
  assert.equal(validDeviceListResponse({ ok: true, scopes: ['read:devices'], data: rows }), true);
  assert.equal(validDeviceRecord({ ...rows[0], tokenHash: 'must-not-exist' }), false);
  assert.equal(validDeviceRecord({ ...rows[0], revoked: true, revokedAt: null }), false);
  assert.equal(validDeviceSnapshot([rows[0], { ...rows[0] }]), false);
  assert.equal(validDeviceSnapshot([device()]), false);
  assert.equal(validDeviceListResponse({
    ok: true, scopes: ['read:devices', 'read:devices'], data: rows,
  }), false);
});

await test('device list accepts only a strict versioned public snapshot', async () => {
  reset(['read:devices']);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return response(deviceList());
  };
  await loadDevices();
  assert.equal(state.data.devices.find(row => !row.current).deviceId, 'device-other-123');
  assert.equal(cache.read('devices').status, 'FRESH');
  assert.equal(state.devicesLive, true);
  assert.equal(calls[0].options.cache, 'no-store');

  globalThis.fetch = async () => response(deviceList(), { status: 201 });
  await loadDevices();
  assert.equal(state.error.devices.kind, 'protocol');
  assert.equal(state.devicesLive, false);

  globalThis.fetch = async () => response([{ deviceId: 'device-other-123', token_hash: 'secret' }]);
  await loadDevices();
  assert.equal(state.error.devices.kind, 'protocol');
  assert.equal(state.cacheAge.devices, 'FRESH');
  assert.equal(state.devicesLive, false);
  assert.equal(deviceMutationFresh(), false);
});

await test('valid cache remains read-only after failure and corrupt cache is deleted', async () => {
  reset();
  store.set(K.cache + 'devices', { at: Date.now(), data: deviceList() });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await loadDevices();
  assert.equal(state.data.devices.length, 2);
  assert.equal(state.devicesLive, false);
  assert.equal(deviceMutationFresh(), false);
  assert.match(viewDevices(), /disabled/);

  reset();
  store.set(K.cache + 'devices', {
    at: Date.now(), data: [{ ...currentDevice(), tokenHash: 'must-not-render' }],
  });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await loadDevices();
  assert.equal(state.data.devices, undefined);
  assert.equal(store.get(K.cache + 'devices'), null);
  assert.ok(!viewDevices().includes('must-not-render'));
});

await test('a late device response cannot replace the newest generation', async () => {
  reset(['read:devices']);
  const pending = [];
  globalThis.fetch = async () => new Promise(resolve => pending.push(resolve));
  const older = loadDevices();
  const newest = loadDevices();
  pending[1](response(deviceList(device({ name: 'Nejnovější' }))));
  await newest;
  pending[0](response(deviceList(device({ name: 'Starší' }))));
  await older;
  assert.equal(state.data.devices.find(row => !row.current).name, 'Nejnovější');
  assert.equal(cache.read('devices').data.find(row => !row.current).name, 'Nejnovější');
});

await test('offline and reconnect transitions withdraw all live mutation grants', () => {
  reset();
  state.data.devices = deviceList();
  state.cacheAge.devices = 'FRESH';
  state.devicesLive = true;
  state.memoryLive = true;
  state.workersLive = true;
  assert.equal(deviceMutationFresh(), true);
  handleWentOffline();
  assert.equal(state.devicesLive, false);
  assert.equal(state.memoryLive, false);
  assert.equal(state.workersLive, false);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  handleCameOnline();
  assert.equal(state.devicesLive, false);
});

await test('confirmed revoke sends one journalled mutation and refreshes with a read', async () => {
  reset();
  state.data.devices = [device()];
  state.cacheAge.devices = 'FRESH';
  state.devicesLive = true;
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
    return response(deviceList(device({ revoked: true, revokedAt: '2026-09-06 11:00:00' })));
  };
  await confirmDeviceRevoke('device-other-123');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/m1/devices/device-other-123/revoke');
  assert.equal(calls[1].url, '/m1/devices');
  assert.equal(journal.find(operationId).lastKnownState, 'CONFIRMED');
  assert.equal(state.data.devices.find(row => row.deviceId === 'device-other-123').revoked, true);
  assert.match(state.deviceNote.text, /nejde o vzdálené smazání/);
});

await test('unreadable mutation response remains UNKNOWN and is never retried', async () => {
  reset();
  state.data.devices = [device()];
  state.cacheAge.devices = 'FRESH';
  state.devicesLive = true;
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
  state.devicesLive = true;
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
