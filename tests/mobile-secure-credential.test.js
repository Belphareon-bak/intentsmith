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

globalThis.localStorage = makeStorage();
globalThis.document = {
  body: element('body'),
  getElementById: id => fields[id] || nodes[id] || null,
  querySelector: () => null,
  createElement: tag => element(tag),
  addEventListener: () => {},
  visibilityState: 'visible',
};
globalThis.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState: () => {} };
globalThis.fetch = async () => { throw new TypeError('this suite does not call the network'); };

// ── A vault that behaves like the Java one ──────────────────────────────────
//
// Modelled on `LockPolicy.java` rather than on the plugin's happy path: it can
// be locked, it can refuse to open, and `read()` rejects while locked.  A fake
// that always succeeded would only prove the client can call a function.
function fakeVault({ available = true, error = null, hasPin = false, locked = false, lockKind = null } = {}) {
  const held = { token: null, deviceId: null, scopes: '[]' };
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
    async save({ token, deviceId }) {
      vault.calls.push('save');
      if (!available) throw new Error('vault_unavailable');
      held.token = token;
      held.deviceId = deviceId;
      vault.state.locked = false;
      return { saved: true };
    },
    async clear() {
      vault.calls.push('clear');
      vaultCleared = true;
      held.token = null;
      held.deviceId = null;
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
        sessionEpoch, lockDownSession, unlockSession, api } = __ms20;

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

// ── 1. The shell ────────────────────────────────────────────────────────────

await test('MD-11 in the shell the token never reaches localStorage', async () => {
  resetAdapter();
  const vault = fakeVault();
  installShell(vault);
  await secure.hydrate();
  assert.equal(secure.native, true, `vault did not open: ${secure.reason}`);

  // The pairing path, exactly as `doPair` calls it.
  auth.save({ token: 'tok-secret-value', deviceId: 'dev-1', scopes: ['read:chat'] });

  assert.ok(!everythingStored().includes('tok-secret-value'),
    `the credential was mirrored into localStorage:\n${everythingStored()}`);
  assert.equal(auth.token, 'tok-secret-value', 'the session cannot read its own credential');
  assert.equal(vault.held.token, 'tok-secret-value', 'the credential never reached the vault');
  // MD-12: scopes are S1 / ST-DB, and stay where the data model puts them.
  assert.deepEqual(store.get(K.scopes), ['read:chat']);
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
  auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });

  auth.clear();
  await Promise.resolve();
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

  auth.save({ token: 'tok-browser', deviceId: 'dev-2', scopes: [] });
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
  installShell(fakeVault());
  await secure.hydrate();
  auth.save({ token: 'tok-in-memory', deviceId: 'dev-1', scopes: [] });
  assert.equal(auth.token, 'tok-in-memory');

  lockDownSession();

  assert.equal(auth.token, null, 'the page still holds the credential after locking');
  assert.equal(secure.cache.token, null);
  // The vault keeps it: locking is not logging out.  The distinction is the
  // whole reason `forget()` exists next to `clear()`.
  assert.ok(!vaultCleared, 'locking wiped the vault, which would make unlock impossible');
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
  auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });

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
  auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });

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
  auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });
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
  auth.save({ token: 'tok-1', deviceId: 'dev-1', scopes: [] });
  lockDownSession();
  unlockSession();

  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, data: [] }),
  });
  const result = await api('/conversations');
  assert.deepEqual(result.data, []);
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
