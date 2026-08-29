// ST-SECURE in the shell, and the honesty of admitting when there is none.
// ==============================================================================
//
// `MD-11` says the device token is `S3` and belongs in `ST-SECURE`,
// "výhradně".  Until there was a native shell there was nowhere to put it, and
// `MR-22`/`MR-23` carried the note "pod úložištním limitem PWA" — an accurate
// note about a missing floor, not a missing feature.
//
// This suite is about the floor and, just as much, about the *three* states the
// client can now be in, because two of them look identical from the outside:
//
//   1. **shell, vault open** — the credential lives in the Keystore and never
//      touches `localStorage`;
//   2. **plain browser** — it lives in `localStorage`, as it always did, and
//      the settings screen says so;
//   3. **shell, vault broken** — the dangerous one.  It behaves like (2) while
//      looking like (1), so the client must *say* it is degraded rather than
//      fall back quietly.  A user who believes a protection they do not have is
//      worse off than one who knows they have none.
//
// The load-bearing assertion is negative: after pairing in the shell, the token
// must appear **nowhere** in `localStorage`.  It is checked over the whole
// store rather than the one key, because a helper that mirrors "for offline
// convenience" is exactly how a credential ends up in two places.
//
// ==============================================================================

import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;

/** Set by the fake vault, so a test can tell locking apart from logging out. */
let vaultCleared = false;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

// ── Minimal DOM (same shape as the other client suites) ─────────────────────

function makeStorage() {
  const data = {};
  const method = (name, value) => Object.defineProperty(data, name, { value, enumerable: false });
  method('getItem', key => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null));
  method('setItem', (key, value) => { data[key] = String(value); });
  method('removeItem', key => { delete data[key]; });
  method('clear', () => { for (const key of Object.keys(data)) delete data[key]; });
  return data;
}

function element(tag = 'div') {
  const classes = new Set();
  const node = {
    tagName: tag.toUpperCase(),
    className: '', innerHTML: '', textContent: '', value: '',
    hidden: false, dataset: {}, style: {}, children: [],
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

const nodes = { app: element(), scrim: element(), toasts: element() };
const fields = {};
const windowListeners = new Map();

globalThis.localStorage = makeStorage();
globalThis.document = {
  body: element('body'),
  getElementById: id => fields[id] || nodes[id] || null,
  querySelector: () => null,
  createElement: tag => element(tag),
  addEventListener: () => {},
  visibilityState: 'visible',
};
globalThis.window = {
  addEventListener(type, listener) {
    const listeners = windowListeners.get(type) || [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  },
  matchMedia: () => ({ matches: false }),
};
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState: () => {} };
globalThis.fetch = async () => { throw new TypeError('this suite does not call the network'); };

// ── A vault that behaves like the Java one ──────────────────────────────────
//
// Modelled on `LockPolicy.java` rather than on the plugin's happy path: it can
// be locked, it can refuse to open, and `read()` rejects while locked.  A fake
// that always succeeded would only prove the client can call a function.
function fakeVault({ available = true, error = null, hasPin = false, locked = false,
                     lockKind = null, saveFails = false, clearFails = false,
                     domainWriteFails = false, pairingCode = null } = {}) {
  const held = { token: null, deviceId: null, scopes: '[]' };
  let domain = '{}';
  const vault = {
    calls: [],
    state: {
      available, error, hasPin, locked, hasCredential: false, maxFailures: 10,
      lockKind: lockKind || (hasPin ? 'pin' : 'none'),
    },
    async getState() {
      vault.calls.push('getState');
      return { ...vault.state, hasCredential: Boolean(held.token) };
    },
    async read() {
      vault.calls.push('read');
      if (vault.state.locked) throw new Error('locked');
      if (!available) throw new Error('vault_unavailable');
      return { ...held };
    },
    async readDomain() {
      vault.calls.push('readDomain');
      if (vault.state.locked) throw new Error('locked');
      return { data: domain };
    },
    async writeDomain({ data }) {
      vault.calls.push('writeDomain');
      if (domainWriteFails) throw new Error('domain_write_failed');
      domain = data;
      return { stored: true };
    },
    async clearDomain() {
      vault.calls.push('clearDomain');
      domain = '{}';
      return { cleared: true };
    },
    async consumePairingCode() {
      vault.calls.push('consumePairingCode');
      const code = pairingCode;
      pairingCode = null;
      return code ? { code } : {};
    },
    setPairingCode(code) { pairingCode = code; },
    async save({ token, deviceId }) {
      vault.calls.push('save');
      if (!available || saveFails) throw new Error(saveFails ? 'storage_failed' : 'vault_unavailable');
      held.token = token;
      held.deviceId = deviceId;
      vault.state.locked = false;
      return { saved: true };
    },
    async clear() {
      vault.calls.push('clear');
      if (clearFails) throw new Error('clear_failed');
      vaultCleared = true;
      held.token = null;
      held.deviceId = null;
      domain = '{}';
      return { cleared: true };
    },
    async setPin({ pin }) {
      vault.calls.push('setPin');
      if (!pin || pin.length < 4) throw new Error('pin_too_short');
      vault.state.hasPin = true;
      return { set: true };
    },
    async clearPin({ pin }) {
      vault.calls.push('clearPin');
      if (pin !== '1234') throw new Error('pin_wrong');
      vault.state.hasPin = false;
      return { cleared: true };
    },
    held,
  };
  return vault;
}

function installShell(vault) {
  globalThis.Capacitor = { Plugins: { IntentSmithVault: vault } };
}

function removeShell() {
  delete globalThis.Capacitor;
}

const { __ms20 } = await import('../src/mobile/client/app.js');
const { state, secure, auth, store, K, render, setAppPin, clearAppPin,
        sessionEpoch, lockDownSession, unlockSession, api, cache, journal, drafts,
        replaceScopes, handleAuthFailure, MOBILE_PROTOCOL_VERSION,
        REMOTE_CORE_V1_PIN, MOBILE_TRANSPORT_MODE } = __ms20;
const { apiBaseFor } = __ms20;
const { RESOLVED_JOURNAL_RETENTION_MS, DRAFT_RETENTION_MS } = __ms20;

/** Reset the adapter to its pre-hydrate shape — it is a module singleton. */
function resetAdapter() {
  localStorage.clear();
  // The epoch and the lock are module state, not per-test state.  Without this
  // the first test that locks leaves every later `api()` call refusing before
  // it reaches `fetch` — which is correct behaviour, and would silently make
  // the rest of the suite prove nothing.
  unlockSession();
  vaultCleared = false;
  secure.plugin = null;
  secure.mode = 'browser';
  secure.reason = null;
  secure.lock = { hasPin: false, locked: false, maxFailures: 0 };
  secure.cache = { token: null, device: null };
  secure.pendingPairingCode = null;
  store.resetNative();
  state.error = {};
  state.data = {};
  state.loading = {};
}

/** Everything the browser store holds, as one string — for the negative test. */
function everythingStored() {
  return Object.keys(localStorage)
    .map(key => `${key}=${localStorage.getItem(key)}`)
    .join('\n');
}

console.log('\n=== ST-SECURE credential (MR-22, MD-11) ===');

await test('production shell uses bundled UI with an explicit absolute API origin', () => {
  const native = { isNativePlatform: () => true };
  const runtime = gatewayUrl => ({
    gatewayUrl,
    transportMode: MOBILE_TRANSPORT_MODE.LEGACY_M1_DEVELOPMENT,
    remoteCore: {
      descriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
      adapterManifestDigest: REMOTE_CORE_V1_PIN.m5AdapterManifestDigest,
    },
  });
  assert.equal(
    apiBaseFor(native, runtime('http://127.0.0.1:3336/')),
    'http://127.0.0.1:3336/m1',
  );
  assert.equal(apiBaseFor({}, runtime('https://ignored.example')), '/m1');
  assert.throws(
    () => apiBaseFor(native, runtime('https://user:secret@example.test/path')),
    /invalid_mobile_gateway_origin/,
  );
  assert.throws(
    () => apiBaseFor(native, {
      ...runtime('https://future.example.test'),
      transportMode: MOBILE_TRANSPORT_MODE.REMOTE_CORE_V1,
    }),
    /remote_core_transport_not_implemented/,
    'RemoteCore mode must not silently fall back to the legacy /m1 gateway',
  );
});

await test('QR deep link hands a one-time code to the unlocked bundled client', async () => {
  resetAdapter();
  const code = 'pairing_code_1234567890';
  const vault = fakeVault({ pairingCode: code });
  installShell(vault);
  await secure.hydrate();

  assert.equal(secure.pendingPairingCode, code);
  assert.equal((await vault.consumePairingCode()).code, undefined, 'pairing code was not consumed once');
});

await test('untrusted pairing link cannot wipe or replace an active identity', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  await auth.save({ token: 'tok-stays', deviceId: 'dev-stays', scopes: ['read:chat'] });
  state.session = 'active';
  vault.setPairingCode('replacement_code_1234567890');
  const clearsBeforeLink = vault.calls.filter(call => call === 'clear').length;

  for (const listener of windowListeners.get('intentsmithPairingLink') || []) {
    await listener();
  }

  assert.equal(auth.token, 'tok-stays');
  assert.equal(vault.held.token, 'tok-stays');
  assert.equal(
    vault.calls.filter(call => call === 'clear').length,
    clearsBeforeLink,
    'pairing URI cleared the current vault before claim',
  );
  assert.equal(state.session, 'active');
});

await test('pairing link prefills an unpaired shell without touching the vault', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  vault.setPairingCode('first_pair_code_1234567890');

  for (const listener of windowListeners.get('intentsmithPairingLink') || []) {
    await listener();
  }

  assert.equal(secure.pendingPairingCode, 'first_pair_code_1234567890');
  assert.equal(state.session, 'unpaired');
  assert.ok(!vault.calls.includes('clear'));
});

// ── 1. The shell ────────────────────────────────────────────────────────────

await test('MD-11 in the shell the token never reaches localStorage', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  assert.equal(secure.native, true, `vault did not open: ${secure.reason}`);

  // The pairing path, exactly as `doPair` calls it.
  await auth.save({ token: 'tok-secret-value', deviceId: 'dev-1', scopes: ['read:chat'] });

  assert.ok(!everythingStored().includes('tok-secret-value'),
    `the credential was mirrored into localStorage:\n${everythingStored()}`);
  assert.equal(auth.token, 'tok-secret-value', 'the session cannot read its own credential');
  assert.equal(vault.held.token, 'tok-secret-value', 'the credential never reached the vault');
  // MD-12: scopes are S1 / ST-DB, and stay where the data model puts them.
  assert.deepEqual(store.get(K.scopes), ['read:chat']);
});

await test('P1 native S1/S2 data is encrypted through the vault and survives hydration', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  await auth.save({ token: 'tok-domain-test', deviceId: 'dev-domain', scopes: ['read:chat'] });
  cache.write('conversations', [{ id: 'conv-secret' }]);
  journal.add({ operationId: 'op-domain', operationType: 'chat.send', displaySummary: 'Pokus' });
  await store.flush();

  assert.ok(!everythingStored().includes('conv-secret'), 'S2 cache leaked into WebView localStorage');
  assert.ok(!everythingStored().includes('op-domain'), 'operation journal leaked into WebView localStorage');

  resetAdapter();
  installShell(vault);
  await secure.hydrate();
  assert.deepEqual(auth.scopes, ['read:chat']);
  assert.equal(cache.read('conversations').data[0].id, 'conv-secret');
  assert.equal(journal.find('op-domain').operationId, 'op-domain');
});

await test('P1 a failed encrypted domain commit rolls pairing back fail-closed', async () => {
  resetAdapter();
  const vault = fakeVault({ domainWriteFails: true });
  installShell(vault);
  await secure.hydrate();

  await assert.rejects(
    auth.save({ token: 'tok-half-credential', deviceId: 'dev-half', scopes: ['read:chat'] }),
    /domain_write_failed/,
  );
  assert.equal(auth.token, null, 'token survived a failed durable scope commit');
  assert.equal(vault.held.token, null, 'vault retained a half-written credential');
});

await test('P1 retention removes expired drafts and resolved history, never open recovery keys', () => {
  resetAdapter();
  removeShell();
  const now = Date.now();
  store.set(K.journal, [
    {
      operationId: 'open-old', operationType: 'chat.send', displaySummary: 'Pokus',
      createdAt: now - 10 * RESOLVED_JOURNAL_RETENTION_MS,
      lastKnownState: 'UNKNOWN', lastCheckedAt: now - 10 * RESOLVED_JOURNAL_RETENTION_MS,
      unknownReason: null,
    },
    {
      operationId: 'done-old', operationType: 'chat.send', displaySummary: 'Pokus',
      createdAt: now - 2 * RESOLVED_JOURNAL_RETENTION_MS,
      lastKnownState: 'CONFIRMED', lastCheckedAt: now - 2 * RESOLVED_JOURNAL_RETENTION_MS,
      unknownReason: null,
    },
  ]);
  store.set(K.drafts, {
    old: { conversationId: 'c', message: 'expired', touchedAt: now - DRAFT_RETENTION_MS - 1 },
    current: { conversationId: 'c', message: 'keep', touchedAt: now },
  });

  assert.equal(journal.purgeResolved(now), 1);
  assert.equal(drafts.purgeExpired(now), 1);
  assert.ok(journal.find('open-old'), 'UNKNOWN recovery key was time-expired');
  assert.equal(journal.find('done-old'), null);
  assert.equal(drafts.get('old'), null);
  assert.equal(drafts.get('current').message, 'keep');
});

await test('MR-23 a locked vault yields no credential, and that is not "unpaired"', async () => {
  resetAdapter();
  const vault = fakeVault({ hasPin: true, locked: true });
  vault.held.token = 'tok-in-the-safe';
  installShell(vault);
  await secure.hydrate();

  assert.equal(secure.native, true);
  assert.equal(secure.lock.locked, true);
  assert.equal(secure.cache.token, null, 'a locked vault handed out the credential');
  // It was never read, rather than read and discarded.
  assert.ok(!vault.calls.includes('read'), 'the client tried to read a locked vault');
});

await test('E-LOGOUT clears the vault, not only the browser store', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  await auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });

  await auth.clear();
  assert.ok(vault.calls.includes('clear'),
    'logout left a working token in the Keystore of a device that just logged out');
  assert.equal(auth.token, null);
});

// ── 2. The plain browser ────────────────────────────────────────────────────

await test('without a shell nothing changes — the token is in localStorage, as before', async () => {
  resetAdapter();
  removeShell();
  await secure.hydrate();
  assert.equal(secure.native, false);
  assert.equal(secure.plugin, null);
  assert.equal(secure.reason, null, 'a plain browser is not a degraded shell and must not report one');

  await auth.save({ token: 'tok-browser', deviceId: 'dev-2', scopes: [] });
  assert.equal(store.get(K.token), 'tok-browser');
  assert.equal(auth.token, 'tok-browser');
});

// ── 3. The dangerous middle state ───────────────────────────────────────────

await test('a shell whose vault will not open is reported, never silently downgraded', async () => {
  resetAdapter();
  installShell(fakeVault({ available: false, error: 'KeyStoreException: no TEE' }));
  await secure.hydrate();

  assert.equal(secure.native, false, 'a broken vault was treated as working');
  assert.equal(secure.reason, 'KeyStoreException: no TEE');

  state.session = 'active';
  state.route = 'diagnostics';
  store.set(K.scopes, []);
  render();
  const markup = nodes.app.innerHTML;
  assert.ok(markup.includes('nepodařilo se ho otevřít'),
    'the settings screen did not say the vault is broken');
  assert.ok(markup.includes('KeyStoreException'),
    'the reason was swallowed, leaving the user with a mystery');
});

await test('a broken shell refuses pairing instead of writing the token to localStorage', async () => {
  resetAdapter();
  installShell(fakeVault({ available: false, error: 'KeyStore unavailable' }));
  await secure.hydrate();

  await assert.rejects(
    auth.save({ token: 'tok-must-not-fallback', deviceId: 'dev-broken', scopes: [] }),
    /KeyStore unavailable|vault_unavailable/,
  );
  assert.ok(!everythingStored().includes('tok-must-not-fallback'), everythingStored());
  assert.equal(auth.token, null);
});

await test('a vault write failure leaves no in-memory or browser credential', async () => {
  resetAdapter();
  installShell(fakeVault({ saveFails: true }));
  await secure.hydrate();

  await assert.rejects(
    auth.save({ token: 'tok-write-failed', deviceId: 'dev-failed', scopes: [] }),
    /storage_failed/,
  );
  assert.equal(auth.token, null);
  assert.ok(!everythingStored().includes('tok-write-failed'), everythingStored());
  assert.equal(secure.native, true, 'a failed write silently changed the shell into browser mode');
});

await test('the settings screen names the real store in each mode', async () => {
  const shown = async build => {
    resetAdapter();
    await build();
    state.session = 'active';
    state.route = 'diagnostics';
    store.set(K.scopes, []);
    render();
    return nodes.app.innerHTML;
  };

  const native = await shown(async () => { installShell(fakeVault()); await secure.hydrate(); });
  assert.ok(native.includes('Android Keystore'), 'the shell did not name the Keystore');

  const browser = await shown(async () => { removeShell(); await secure.hydrate(); });
  assert.ok(browser.includes('localStorage'), 'the browser build did not admit where the token is');
  assert.ok(browser.includes('ST-SECURE'), 'the browser build did not say what is missing');
});

// ── 4. The lock ─────────────────────────────────────────────────────────────

await test('MR-23 the PIN is set through the vault and never kept in client state', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();

  fields['pin-new'] = element('input');
  fields['pin-new'].value = '4417';
  await setAppPin();

  assert.equal(vault.state.hasPin, true);
  assert.equal(fields['pin-new'].value, '', 'the PIN was left in the field it was typed into');
  const serialised = JSON.stringify(state);
  assert.ok(!serialised.includes('4417'), 'the PIN ended up in client state');
  assert.ok(!everythingStored().includes('4417'), 'the PIN ended up in localStorage');
});

await test('a PIN shorter than four digits is refused before it reaches the vault', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();

  fields['pin-new'] = element('input');
  fields['pin-new'].value = '12';
  await setAppPin();

  assert.ok(!vault.calls.includes('setPin'), 'a too-short PIN was sent to the vault');
  assert.match(state.error.security || '', /4 až 12/);
});

await test('a wrong PIN does not remove the lock, and says so plainly', async () => {
  resetAdapter();
  const vault = fakeVault({ hasPin: true });
  installShell(vault);
  await secure.hydrate();

  fields['pin-old'] = element('input');
  fields['pin-old'].value = '9999';
  await clearAppPin();

  assert.equal(vault.state.hasPin, true, 'the lock came off without the PIN');
  assert.equal(state.error.security, 'PIN nesouhlasí.');
  assert.equal(fields['pin-old'].value, '');
});

await test('the browser build offers no lock it cannot enforce', async () => {
  resetAdapter();
  removeShell();
  await secure.hydrate();
  state.session = 'active';
  state.route = 'diagnostics';
  store.set(K.scopes, []);
  render();
  const markup = nodes.app.innerHTML;
  assert.ok(!markup.includes('pin-set'),
    'the browser build offered a PIN, which nothing in a browser can enforce');
});

// ── 5. The lock, in the layer a curtain cannot reach (MR-23) ────────────────
//
// The native overlay hides the screen.  These tests are about the half it
// cannot do: the page behind it keeps a credential in memory, keeps requests in
// flight, and will happily write an approval body into state when one lands.
// A lock that leaves that running is a screenshot of a lock.

await test('MR-23 locking drops the credential the page was holding', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  await auth.save({ token: 'tok-in-memory', deviceId: 'dev-1', scopes: [] });
  assert.equal(auth.token, 'tok-in-memory');
  const clearsBeforeLock = vault.calls.filter(call => call === 'clear').length;

  lockDownSession();

  assert.equal(auth.token, null, 'the page still holds the credential after locking');
  assert.equal(secure.cache.token, null);
  // The vault keeps it: locking is not logging out.  The distinction is the
  // whole reason `forget()` exists next to `clear()`.
  assert.equal(vault.calls.filter(call => call === 'clear').length, clearsBeforeLock,
    'locking wiped the vault, which would make unlock impossible');
});

await test('MR-23 locking drops S2 data that was already on screen', async () => {
  resetAdapter();
  installShell(fakeVault());
  await secure.hydrate();
  state.data = {
    conversations: [{ id: 'c1', title: 'Rozpočet 2026' }],
    approvals: [{ id: 'ap-1', detail: 'zapsat /tajne/heslo.txt' }],
  };

  lockDownSession();

  const left = JSON.stringify(state.data);
  assert.ok(!left.includes('Rozpočet'), `conversation content survived the lock: ${left}`);
  assert.ok(!left.includes('heslo'), `approval content survived the lock: ${left}`);
});

await test('MR-23 a request in flight when the lock falls is aborted', async () => {
  resetAdapter();
  installShell(fakeVault());
  await secure.hydrate();
  await auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });

  let aborted = false;
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  const pending = api('/approvals').catch(error => error);
  await Promise.resolve();
  lockDownSession();

  const error = await pending;
  assert.equal(aborted, true, 'the lock left a request running');
  assert.equal(error.kind, 'offline');
  assert.equal(error.code, 'locked', 'an aborted-by-lock request was reported as a timeout');
});

await test('MR-23 a response that lands after the lock is inert', async () => {
  resetAdapter();
  installShell(fakeVault());
  await secure.hydrate();
  await auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });

  // The realistic shape: the server already answered, the bytes are on their
  // way, and `fetch` resolves *after* the lock.  Nothing aborted it — so the
  // epoch is the only thing standing between that body and a locked session.
  let deliver;
  globalThis.fetch = () => new Promise(resolve => { deliver = resolve; });

  const pending = api('/approvals').catch(error => error);
  await Promise.resolve();
  lockDownSession();
  deliver({
    ok: true, status: 200,
    json: async () => ({ ok: true, data: [{ id: 'ap-late', detail: 'tajný diff' }] }),
  });

  const error = await pending;
  assert.equal(error.kind, 'offline');
  assert.equal(error.code, 'locked', 'a late response was handed to a locked session');
  assert.ok(!JSON.stringify(state.data).includes('ap-late'),
    'a late response repopulated a locked session');
});

await test('MR-23 a locked session issues nothing at all', async () => {
  resetAdapter();
  installShell(fakeVault());
  await secure.hydrate();
  await auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });
  lockDownSession();

  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not run'); };

  const error = await api('/conversations').catch(e => e);
  assert.equal(called, false, 'a locked session started a new request');
  assert.equal(error.code, 'locked');
});

await test('MR-23 unlocking lets the session work again', async () => {
  resetAdapter();
  installShell(fakeVault());
  await secure.hydrate();
  await auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });
  lockDownSession();
  unlockSession();

  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, protocolVersion: MOBILE_PROTOCOL_VERSION, data: [] }),
  });
  const result = await api('/conversations');
  assert.deepEqual(result.data, []);
});

// ── 6. Identity and cache lifecycle ─────────────────────────────────────────

await test('new pairing removes cache, journal and drafts from the old identity', async () => {
  resetAdapter();
  removeShell();
  await secure.hydrate();
  await auth.save({ token: 'tok-a', deviceId: 'dev-a', scopes: ['read:chat'] });
  cache.write('conversations', [{ id: 'private-a', title: 'A' }]);
  store.set(K.journal, [{ operationId: 'op-a', operationType: 'chat.send' }]);
  store.set(K.drafts, { 'op-a': { message: 'secret-a' } });

  await auth.save({ token: 'tok-b', deviceId: 'dev-b', scopes: ['read:chat'] });

  assert.equal(cache.read('conversations').data, null, 'old cache crossed a device identity');
  assert.deepEqual(store.get(K.journal, []), [], 'old operation keys crossed a device identity');
  assert.deepEqual(store.get(K.drafts, {}), {}, 'old drafts crossed a device identity');
});

await test('cache is partitioned by gateway origin as well as device', async () => {
  resetAdapter();
  removeShell();
  await secure.hydrate();
  await auth.save({ token: 'tok-a', deviceId: 'dev-a', scopes: ['read:chat'] });
  location.href = 'https://gateway-a.invalid/app';
  cache.write('conversations', [{ id: 'from-a' }]);

  location.href = 'https://gateway-b.invalid/app';
  assert.equal(cache.read('conversations').data, null,
    'content written for gateway A was visible under gateway B');
  location.href = 'http://localhost/';
});

await test('EXPIRED cache is deleted and never returned to a screen', async () => {
  resetAdapter();
  removeShell();
  await secure.hydrate();
  await auth.save({ token: 'tok-a', deviceId: 'dev-a', scopes: ['read:chat'] });
  const key = cache.key('conversations');
  store.set(key, { at: Date.now() - 16 * 60_000, data: [{ id: 'expired-secret' }] });

  const expired = cache.read('conversations');
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.data, null);
  assert.equal(store.get(key), null, 'expired bytes remained in persistent storage');
});

await test('scope loss removes already rendered and cached S2 content', async () => {
  resetAdapter();
  removeShell();
  await secure.hydrate();
  await auth.save({
    token: 'tok-a', deviceId: 'dev-a',
    scopes: ['read:chat', 'read:notifications'],
  });
  state.data.conversations = [{ id: 'c-secret' }];
  state.data.thread = { messages: [{ content: 'secret' }] };
  state.data.notifications = [{ id: 'n-secret' }];
  cache.write('conversations', state.data.conversations);
  cache.write('thread.c-secret', state.data.thread);
  cache.write('notifications', state.data.notifications);

  replaceScopes([]);

  assert.equal(state.data.conversations, undefined);
  assert.equal(state.data.thread, undefined);
  assert.equal(state.data.notifications, undefined);
  assert.equal(cache.read('conversations').data, null);
  assert.equal(cache.read('thread.c-secret').data, null);
  assert.equal(cache.read('notifications').data, null);
});

await test('revocation clears the native vault before showing the revoked state', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  await auth.save({ token: 'tok-revoked', deviceId: 'dev-r', scopes: ['read:chat'] });

  await handleAuthFailure({ code: 'token_revoked' });

  assert.equal(state.session, 'revoked');
  assert.equal(auth.token, null);
  assert.ok(vault.calls.filter(call => call === 'clear').length >= 2,
    'revocation did not durably clear the Keystore');
});

await test('the settings screen offers no app PIN when the phone has its own lock', async () => {
  resetAdapter();
  installShell(fakeVault({ lockKind: 'system' }));
  await secure.hydrate();
  state.session = 'active';
  state.route = 'diagnostics';
  store.set(K.scopes, []);
  render();
  const markup = nodes.app.innerHTML;
  assert.ok(markup.includes('zámek telefonu'), 'the system lock is not named');
  assert.ok(!markup.includes('pin-set'),
    'a second, weaker secret was offered on a phone that already has a lock');
});

console.log(`\nST-SECURE credential: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
