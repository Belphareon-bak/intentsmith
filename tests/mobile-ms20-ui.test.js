// MS-20 — recovery screen for unresolved attempts (UI-DESIGN §6.9, §16)
// ==============================================================================
//
// The screen under test is the way out of a one-way ratchet: the server refuses
// every mutation once 32 attempts are open, and PENDING/UNKNOWN never expire.
// So the tests are not about layout — each one locks down a rule that, if it
// quietly broke, would either trap the user or lie to them:
//
//   * a failed load never turns into "nothing hangs"        (SS-02 vs SS-03/SS-08)
//   * a row never claims the state is live                  (MR-25, B-18)
//   * the button that reads never sends                     (§9, C-6)
//   * abandoning takes a second, separate confirmation that
//     names the price, and happens one attempt at a time    (MD-19 §4.3)
//   * the cap warns before it is full and explains itself
//     once it is                                            (§16)
//
// The client is a browser module with no DOM library available offline, so the
// suite installs the smallest possible DOM — enough for the app to render into
// an innerHTML string — and then reads that string.  What is asserted is the
// markup the user's screen reader and eyes get, not internal state.
//
// What this suite therefore does *not* prove (F-043, open):  it is not a
// browser.  There is no layout, no cascade and no assistive technology here, so
// contrast ratios, real hit-target sizes at 200 % text, focus order and what a
// screen reader actually announces remain unverified.  The accessibility tests
// below assert the *contract in the markup and the stylesheet* — a declared
// 48 px minimum, a role, a label, a word next to every colour — which is a
// necessary condition, not evidence of the rendered result.  Browser and AT
// validation is still owed.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

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

// ── Minimal DOM ─────────────────────────────────────────────────────────────

const timers = new Set();
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
  const handle = realSetTimeout(fn, ms, ...rest);
  timers.add(handle);
  return handle;
};

const tick = () => new Promise(resolve => realSetTimeout(resolve, 0));
/** Let the click handler's discarded promises settle. */
async function flush(rounds = 8) {
  for (let index = 0; index < rounds; index++) await tick();
}

function makeStorage() {
  const data = {};
  const method = (name, value) => Object.defineProperty(data, name, { value, enumerable: false });
  method('getItem', key => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null));
  method('setItem', (key, value) => { data[key] = String(value); });
  method('removeItem', key => { delete data[key]; });
  method('clear', () => { for (const key of Object.keys(data)) delete data[key]; });
  return data;
}

const body = element('body');

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
    remove() {
      const index = body.children.indexOf(node);
      if (index >= 0) body.children.splice(index, 1);
    },
    addEventListener() {},
  };
  return node;
}

const nodes = {
  app: element(), scrim: element(), 'conn-banner': element(), toasts: element(),
};
const listeners = {};

globalThis.localStorage = makeStorage();
globalThis.document = {
  body,
  getElementById: id => nodes[id] || null,
  querySelector: selector => {
    const wanted = selector.replace(/^\./, '');
    const found = body.children.filter(child => String(child.className).split(/\s+/).includes(wanted));
    return found.length ? found[found.length - 1] : null;
  },
  createElement: tag => element(tag),
  addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
  visibilityState: 'visible',
};
globalThis.window = {
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
};
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState: () => {} };
globalThis.confirm = () => {
  throw new Error('MS-20 must not use a native confirm dialog — the price has to be on the screen');
};

let fetchQueue = [];
let fetchLog = [];

globalThis.fetch = async (url, options = {}) => {
  fetchLog.push({ url: String(url), method: options.method || 'GET' });
  const next = fetchQueue.shift();
  if (!next) throw new Error(`unexpected request: ${options.method || 'GET'} ${url}`);
  if (next.hold) await next.hold;
  if (next.network) {
    const error = new TypeError('failed to fetch');
    error.name = 'TypeError';
    throw error;
  }
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    json: async () => next.body ?? null,
  };
};

const ok = (data, extra = {}) => ({
  status: 200,
  body: { ok: true, protocolVersion: 'm1.2026-07-30', data, ...extra },
});
const fail = (status, error) => ({ status, body: { ok: false, error } });
const offline = () => ({ network: true });

// ── The client under test ───────────────────────────────────────────────────

const { __ms20 } = await import('../src/mobile/client/app.js');
const { state, store, journal, cache, K, render, navigate } = __ms20;

const clickHandler = (listeners.click || [])[0];
assert.ok(clickHandler, 'the client registered no click handler');

const html = () => nodes.app.innerHTML;

/**
 * D-UI-3 replaced the drawer with the bottom bar.  The properties these tests
 * lock down — a live-only badge, a permanently reachable route — belong to
 * navigation, not to the drawer, so they follow it to its replacement.
 */
function navHtml() {
  const bar = globalThis.document.querySelector('.navbar');
  return bar ? bar.innerHTML : '';
}

/**
 * Click by acting on the control the user would touch: the markup must contain
 * it, and a disabled control is never dispatched — otherwise a test could
 * "click" a button the screen refuses to offer.
 */
function click(act, operationId = null) {
  const markup = html() + navHtml();
  const pattern = operationId
    ? new RegExp(`data-act="${act}" data-op="${operationId}"([^>]*)>`)
    : new RegExp(`data-act="${act}"([^>]*)>`);
  const match = markup.match(pattern);
  assert.ok(match, `no control with data-act="${act}"${operationId ? ` for ${operationId}` : ''}`);
  assert.ok(!/\bdisabled\b/.test(match[1]), `control ${act} is disabled`);
  const target = { dataset: { act, op: operationId ?? undefined } };
  target.closest = () => target;
  clickHandler({ target });
}

function isDisabled(act, operationId) {
  const match = html().match(new RegExp(`data-act="${act}" data-op="${operationId}"([^>]*)>`));
  assert.ok(match, `no control with data-act="${act}" for ${operationId}`);
  return /\bdisabled\b/.test(match[1]);
}

const MINUTE = 60_000;

function entry(overrides = {}) {
  return {
    operationId: 'a'.repeat(32),
    operationType: 'chat.send',
    displaySummary: 'Odeslání zprávy',
    createdAt: Date.now() - 40 * MINUTE,
    lastKnownState: 'UNKNOWN',
    lastCheckedAt: Date.now() - 2 * MINUTE,
    unknownReason: 'upstream_timeout',
    ...overrides,
  };
}

/** A row as `GET /m1/operations` returns it (handlers.js:401). */
function serverRow(overrides = {}) {
  return {
    operationId: 'a'.repeat(32),
    operationType: 'chat.send',
    state: 'UNKNOWN',
    createdAt: Date.now() - 40 * MINUTE,
    unknownReason: 'upstream_timeout',
    unknownAt: Date.now() - 12 * MINUTE,
    lastCheckedAt: Date.now() - 2 * MINUTE,
    ...overrides,
  };
}

function reset({ journalEntries = [], route = 'operations' } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, ['read:chat', 'write:chat', 'read:notifications']);
  store.set(K.journal, journalEntries);
  state.session = 'active';
  state.route = route;
  state.conn = 'ok';
  state.conversationId = null;
  state.sending = false;
  state.data = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.opsLookup = {};
  state.opsNote = {};
  state.opsConfirm = null;
  state.opsAbandoning = null;
  fetchQueue = [];
  fetchLog = [];
  nodes.toasts.children.length = 0;
  body.children.length = 0;
}

console.log('\n=== MS-20 recovery screen (UI-DESIGN §6.9) ===');

await test('F-113 normalization persists exactly seven allowlisted fields for modern and legacy rows', () => {
  const modernId = '1'.repeat(32);
  const legacyId = '2'.repeat(32);
  const falsyCanonicalId = '3'.repeat(32);
  reset({
    journalEntries: [
      entry({
        operationId: modernId,
        type: 'legacy.must-not-win',
        state: 'REJECTED',
        payload: { secret: 'must-not-survive' },
        arbitraryExtra: 'drop-me',
      }),
      {
        operationId: legacyId,
        type: 'chat.send',
        state: 'UNKNOWN',
        displaySummary: 'Starší pokus',
        createdAt: Date.now() - MINUTE,
        lastCheckedAt: null,
        unknownReason: 'upstream_timeout',
        requestFingerprint: 'must-not-survive',
        nestedExtra: { content: 'drop-me' },
      },
      {
        operationId: falsyCanonicalId,
        operationType: '',
        type: 'legacy.must-not-win',
        displaySummary: null,
        createdAt: Date.now(),
        lastKnownState: '',
        state: 'UNKNOWN',
        lastCheckedAt: null,
        unknownReason: null,
      },
    ],
  });

  const allowed = [
    'createdAt', 'displaySummary', 'lastCheckedAt', 'lastKnownState',
    'operationId', 'operationType', 'unknownReason',
  ].sort();
  const normalized = journal.all();
  for (const row of normalized) assert.deepEqual(Object.keys(row).sort(), allowed);
  assert.equal(normalized[0].operationType, 'chat.send', 'legacy type overrode a canonical operationType');
  assert.equal(normalized[0].lastKnownState, 'UNKNOWN', 'legacy state overrode a canonical lastKnownState');
  assert.equal(normalized[1].operationType, 'chat.send', 'known legacy type alias was not migrated');
  assert.equal(normalized[1].lastKnownState, 'UNKNOWN', 'known legacy state alias was not migrated');
  assert.equal(normalized[2].operationType, '', 'a present falsy canonical type lost to a legacy alias');
  assert.equal(normalized[2].lastKnownState, '', 'a present falsy canonical state lost to a legacy alias');

  assert.equal(journal.setState(modernId, 'CONFIRMED'), true);
  const persisted = store.get(K.journal);
  for (const row of persisted) assert.deepEqual(Object.keys(row).sort(), allowed);
  assert.equal(persisted[0].payload, undefined);
  assert.equal(persisted[0].arbitraryExtra, undefined);
  assert.equal(persisted[0].type, undefined);
  assert.equal(persisted[0].state, undefined);
  assert.equal(persisted[1].requestFingerprint, undefined);
  assert.equal(persisted[1].nestedExtra, undefined);

  reset({ journalEntries: [{ type: 'chat.send', state: 'UNKNOWN', payload: 'drop-me' }] });
  journal.add({ operationId: '4'.repeat(32), operationType: 'chat.send' });
  const malformedPersisted = store.get(K.journal)[0];
  assert.ok(Object.keys(malformedPersisted).every(key => allowed.includes(key)),
    'a malformed legacy row persisted a key outside the seven-field allowlist');
  assert.ok(Object.keys(malformedPersisted).length <= allowed.length);
  assert.equal(malformedPersisted.operationId, undefined, 'a missing legacy identity was fabricated');
  assert.equal(malformedPersisted.createdAt, undefined, 'a missing legacy timestamp was fabricated');
  assert.equal(malformedPersisted.payload, undefined);
});

// ── 1. Route and a permanent way in ─────────────────────────────────────────

await test('§6.9 MS-20 is its own route with its own screen, not a section of MS-03', () => {
  reset({ journalEntries: [entry()] });
  render();
  assert.match(html(), /Nerozřešené pokusy/);
  assert.match(html(), /data-act="ms20-lookup"/);
});

await test('§3.3 the recovery screen is permanently reachable from Nastavení, even at zero open attempts', () => {
  // D-UI-3 moved MS-03, MS-04 and MS-20 under Nastavení and removed the drawer
  // they used to hang from.  "Permanently reachable" therefore now means two
  // steps that must both hold at zero open attempts: the bar always carries
  // Nastavení, and Nastavení always carries the way into MS-20.  A recovery
  // route you only find while stuck is a route you learn about while stuck.
  reset({ journalEntries: [], route: 'conversations' });
  state.data.conversations = [];
  render();
  assert.match(navHtml(), /data-route="diagnostics"/, 'the bar lost its permanent way into Nastavení');
  assert.match(navHtml(), /Nastavení/);

  state.route = 'diagnostics';
  render();
  assert.match(html(), /data-act="operations"/, 'Nastavení does not link to MS-20');
});

await test('§6.9 the temporary MS-03 journal substitute is gone once MS-20 is reachable', () => {
  reset({ journalEntries: [entry()], route: 'diagnostics' });
  render();
  assert.doesNotMatch(html(), /data-act="resolve-op"/, 'MS-03 still performs lookups');
  assert.doesNotMatch(html(), /data-act="abandon-op"/, 'MS-03 still abandons attempts');
  assert.match(html(), /data-act="operations"/, 'MS-03 lost the door to MS-20');
  assert.match(html(), /1 \/ 32/, 'MS-03 no longer reports what hangs');
});

// ── 2. OPERATION_LIMIT leads here ───────────────────────────────────────────

await test('§7 a refused mutation (OPERATION_LIMIT) offers MS-20 as its primary action', () => {
  reset({ route: 'conversations' });
  state.error.conversations = {
    kind: 'limit', code: 'operation_limit', detail: { open: 32, limit: 32 },
  };
  render();
  assert.match(html(), /data-act="operations"/);
  assert.match(html(), /Zobrazit nerozřešené pokusy/);
  assert.doesNotMatch(html(), /Zkusit znovu/, 'a refused-by-cap mutation must not offer a retry');
});

await test('§6.9 a send refused by the cap lands on MS-20 with the server\'s open list', async () => {
  reset({ route: 'chat' });
  state.conversationId = 'c-1';
  state.data.thread = { conversation: { id: 'c-1', title: 'Konverzace' }, messages: [] };
  state.cacheAge.thread = 'FRESH';
  nodes['composer-input'] = element('textarea');
  nodes['composer-input'].value = 'ahoj';
  render();

  fetchQueue.push(fail(429, {
    code: 'operation_limit', open: 32, limit: 32, openOperations: [serverRow()],
  }));
  fetchQueue.push(ok([serverRow()], { open: 32, limit: 32, atLimit: true }));

  click('send');
  await flush();
  delete nodes['composer-input'];

  assert.equal(state.route, 'operations', 'the refusal did not lead to MS-20');
  assert.match(html(), /Strop je vyčerpaný/);
  assert.match(html(), /32 \/ 32/);
  assert.equal(fetchLog.filter(request => request.method === 'POST').length, 1,
    'the refusal caused another mutation');
});

// ── 3. What a row has to say ────────────────────────────────────────────────

await test('§6.9 a row carries last-known state, the reason, its age and when it was last checked', async () => {
  reset({ journalEntries: [entry()] });
  fetchQueue.push(ok([serverRow()], { open: 1, limit: 32, atLimit: false }));
  await __ms20.loadOperations();

  assert.match(html(), /Odeslání zprávy/, 'no content-free label for the attempt');
  assert.match(html(), /výsledek neznám/, 'last known state missing');
  assert.match(html(), /Požadavek odešel, ale odpověď nepřišla včas/, 'unknown reason not spelled out');
  assert.match(html(), /neznámé před 12 min/, 'age is not counted from unknownAt (§16)');
  assert.match(html(), /ověřeno před 2 min/, 'last-checked age missing');
  assert.match(html(), /poslední zapsaný stav, ne živý/, 'the row implies a live state (MR-25)');
});

await test('§6.9 an attempt the server did not return is marked as such, not silently merged', async () => {
  reset({ journalEntries: [entry({ operationId: 'b'.repeat(32) })] });
  fetchQueue.push(ok([], { open: 0, limit: 32, atLimit: false }));
  await __ms20.loadOperations();

  assert.match(html(), /server tento klíč nevrátil/);
  assert.doesNotMatch(html(), /Nic nevisí/, 'a locally known attempt was reported as nothing hanging');
});

// ── 4. Loading, empty, offline, unavailable, stale ──────────────────────────

await test('SS-01 loading shows a skeleton, never an empty state', () => {
  reset();
  state.loading.operations = true;
  render();
  assert.match(html(), /skel/);
  assert.doesNotMatch(html(), /Nic nevisí/);
});

await test('SS-02 "nic nevisí" appears only after a successful, genuinely empty response', async () => {
  reset();
  fetchQueue.push(ok([], { open: 0, limit: 32, atLimit: false }));
  await __ms20.loadOperations();
  assert.match(html(), /Nic nevisí/);
  assert.match(html(), /Strop je volný/);
});

await test('SS-03 offline without known attempts says so, and never "nic nevisí"', async () => {
  reset();
  fetchQueue.push(offline());
  await __ms20.loadOperations();
  assert.match(html(), /Nejsi online/);
  assert.doesNotMatch(html(), /Nic nevisí/, 'a failed load was rendered as an empty cap');
  assert.equal(state.conn, 'offline');
});

await test('SS-08 an unreachable server keeps the last known rows and labels them as such', async () => {
  reset({ journalEntries: [entry()] });
  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  await __ms20.loadOperations();

  assert.match(html(), /Server seznam nevrátil/);
  assert.match(html(), /poslední známý stav z telefonu/);
  assert.match(html(), /data-act="ms20-lookup"/, 'the rows disappeared with the failed refresh');
  assert.match(html(), /data-act="load-operations"/, 'no way to ask again');
});

await test('§9 a stale list keeps its age visible while it refreshes', async () => {
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  state.data.operationsAt = Date.now() - 20 * MINUTE;
  state.cacheAge.operations = 'STALE';

  render();
  assert.match(html(), /Data z \d{1,2}:\d{2}\./, 'the age of a stale list is not shown');
  assert.match(html(), /data-act="load-operations"/);

  state.loading.operations = true;
  render();
  assert.match(html(), /Data z \d{1,2}:\d{2}, aktualizuji\./,
    'the age vanished during the refresh — §9 forbids a bare "Aktualizuji…"');
});

// ── 5. The cap ──────────────────────────────────────────────────────────────

await test('§16 the cap warns before it is exhausted', () => {
  reset();
  state.data.operations = Array.from({ length: 24 }, (_, index) =>
    serverRow({ operationId: String(index).padStart(32, '0') }));
  state.data.operationsMeta = { open: 24, limit: 32, atLimit: false };
  render();
  assert.match(html(), /Zbývá 8 míst do stropu 32/);
  assert.doesNotMatch(html(), /Strop je vyčerpaný/);
});

await test('§6.9 an exhausted cap says what it blocks, in the count and in words', () => {
  reset();
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 32, limit: 32, atLimit: true };
  render();
  assert.match(html(), /32 \/ 32/);
  assert.match(html(), /nejde nic odeslat ani schválit/);
});

// ── 6. The lookup: one attempt, read-only ───────────────────────────────────

await test('§6.9 "Zjistit stav" reads one attempt and sends nothing', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  fetchQueue.push(ok({ operationId, known: true, state: 'UNKNOWN', unknownReason: 'upstream_timeout' }));
  click('ms20-lookup', operationId);
  await flush();

  assert.deepEqual(fetchLog.map(request => request.method), ['GET'], 'the lookup was not read-only');
  assert.match(fetchLog[0].url, new RegExp(`/m1/operations/${operationId}$`));
  assert.match(html(), /Stav se nezměnil: výsledek je pořád neznámý/);
  assert.match(html(), /ne živé ověření u backendu/);
});

await test('§6.9 a second tap while the lookup runs does not start a second request', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  let release;
  const held = new Promise(resolve => { release = resolve; });
  fetchQueue.push({ ...ok({ operationId, known: true, state: 'UNKNOWN' }), hold: held });

  const first = __ms20.lookupOperation(operationId);
  assert.match(html(), /Zjišťuji…/, 'the running lookup is not visible');
  assert.equal(isDisabled('ms20-lookup', operationId), true, 'the button stays tappable while running');
  await __ms20.lookupOperation(operationId);   // ignored, not queued
  release();
  await first;

  assert.equal(fetchLog.length, 1, 'the attempt was looked up twice');
});

await test('§6.9 a resolved attempt is released locally and confirmed by re-reading the list', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  fetchQueue.push(ok({ operationId, known: true, state: 'CONFIRMED' }));
  fetchQueue.push(ok([], { open: 0, limit: 32, atLimit: false }));
  click('ms20-lookup', operationId);
  await flush();

  assert.deepEqual(fetchLog.map(request => request.method), ['GET', 'GET']);
  assert.match(html(), /Nic nevisí/);
  assert.equal(journal.find(operationId).lastKnownState, 'CONFIRMED');
});

await test('§6.9 a failed lookup leaves the attempt unresolved and says so on its row', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  click('ms20-lookup', operationId);
  await flush();

  assert.match(html(), /Stav se nepodařilo zjistit. Pokus zůstává nerozřešený/);
  assert.match(html(), /data-act="ms20-lookup"/, 'the row lost its lookup after one failure');
  assert.equal(journal.find(operationId).lastKnownState, 'UNKNOWN', 'a failed lookup changed the state');
});

await test('§4.1 a key the server does not know is reported, not resent and not abandoned', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  store.set(K.drafts, { [operationId]: { conversationId: 'c-1', message: 'ahoj' } });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push({ status: 404, body: { ok: true, data: { operationId, known: false, state: null } } });
  click('ms20-lookup', operationId);
  await flush();

  assert.deepEqual(fetchLog.map(request => request.method), ['GET'],
    'MS-20 repeated or abandoned an attempt on its own');
  assert.match(html(), /Server tenhle klíč nezná/);
  assert.match(html(), /můžeš opustit/, 'the user is left without the next step');
});

// ── 7. Abandoning: second confirmation, one at a time ───────────────────────

await test('MD-19 §4.3 abandoning takes a second confirmation that names the unresolved effect', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  click('ms20-abandon-ask', operationId);
  await flush(1);
  assert.equal(fetchLog.length, 0, 'the first tap already abandoned the attempt');
  assert.match(html(), /Efekt na serveru zůstane nerozřešený\./, 'the price is not stated');
  assert.match(html(), /operace se tím neruší/, 'the copy implies the effect was cancelled');
  assert.match(html(), /data-act="ms20-abandon-confirm"/);
  assert.match(html(), /data-act="ms20-abandon-cancel"/);

  click('ms20-abandon-cancel', operationId);
  await flush(1);
  assert.equal(fetchLog.length, 0);
  assert.doesNotMatch(html(), /data-act="ms20-abandon-confirm"/, 'the confirmation survived a cancel');

  fetchQueue.push(ok({ operationId, abandoned: true, effectStillUnknown: true, open: 0, limit: 32 }));
  fetchQueue.push(ok([], { open: 0, limit: 32, atLimit: false }));
  click('ms20-abandon-ask', operationId);
  await flush(1);
  click('ms20-abandon-confirm', operationId);
  await flush();

  assert.equal(fetchLog[0].method, 'POST');
  assert.match(fetchLog[0].url, /\/abandon$/);
  assert.equal(journal.find(operationId), null, 'the local record survived the abandon');
  assert.match(html(), /Nic nevisí/);
  const toastText = nodes.toasts.children.map(node => node.textContent).join(' ');
  assert.match(toastText, /Efekt na serveru zůstává nerozřešený/,
    'the confirmation toast implies the operation was cancelled');
});

await test('MD-19 §4.3 abandon without its own confirmation does nothing', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  await __ms20.confirmAbandon(operationId);
  assert.equal(fetchLog.length, 0, 'an unconfirmed abandon reached the server');
  assert.ok(journal.find(operationId), 'an unconfirmed abandon dropped the record');
});

await test('§6.9 only one attempt can be armed or abandoned at a time', async () => {
  const first = 'a'.repeat(32);
  const second = 'b'.repeat(32);
  reset({ journalEntries: [entry(), entry({ operationId: second, displaySummary: 'Rozhodnutí approvalu' })] });
  state.data.operations = [serverRow(), serverRow({ operationId: second })];
  state.data.operationsMeta = { open: 2, limit: 32, atLimit: false };
  render();

  click('ms20-abandon-ask', first);
  await flush(1);
  assert.equal((html().match(/data-act="ms20-abandon-confirm"/g) || []).length, 1,
    'more than one attempt is armed for abandoning');

  let release;
  const held = new Promise(resolve => { release = resolve; });
  fetchQueue.push({ ...ok({ operationId: first, abandoned: true, open: 1, limit: 32 }), hold: held });
  fetchQueue.push(ok([serverRow({ operationId: second })], { open: 1, limit: 32, atLimit: false }));

  const running = __ms20.confirmAbandon(first);
  assert.equal(isDisabled('ms20-abandon-ask', second), true,
    'a second attempt can be abandoned while the first one is in flight');
  assert.match(html(), /Opouští se po jednom/, 'the disabled control gives no reason');
  release();
  await running;
  await flush();

  assert.equal(fetchLog.filter(request => request.method === 'POST').length, 1);
});

await test('§6.9 an attempt that resolved underneath the abandon is read, not forced', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push(fail(409, { code: 'state_conflict', reason: 'already_resolved', state: 'CONFIRMED' }));
  fetchQueue.push(ok([], { open: 0, limit: 32, atLimit: false }));
  click('ms20-abandon-ask', operationId);
  await flush(1);
  click('ms20-abandon-confirm', operationId);
  await flush();

  assert.equal(fetchLog.filter(request => request.method === 'POST').length, 1,
    'the client insisted on abandoning a resolved attempt');
});

// ── 8. What the screen must never grow ──────────────────────────────────────

await test('C-6 the screen offers no retry, no bulk action and no automatic abandon', async () => {
  reset({ journalEntries: [entry(), entry({ operationId: 'b'.repeat(32) })] });
  fetchQueue.push(ok([serverRow(), serverRow({ operationId: 'b'.repeat(32) })],
    { open: 2, limit: 32, atLimit: false }));
  await __ms20.loadOperations();

  assert.doesNotMatch(html(), /Zkusit znovu/, 'a mutation retry appeared on the recovery screen');
  assert.doesNotMatch(html(), /Odeslat znovu|Opakovat|vše|Vše/, 'a bulk or repeat action appeared');
  assert.equal(fetchLog.filter(request => request.method === 'POST').length, 0,
    'rendering the screen mutated something');
  assert.equal((html().match(/data-act="ms20-abandon-ask"/g) || []).length, 2,
    'abandoning is not per attempt');
});

// ── 9. Accessibility (§10) ──────────────────────────────────────────────────

await test('§10 state is carried by text, not colour, and every control names its attempt', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  assert.match(html(), /<span class="op-chip" data-state="UNKNOWN">výsledek neznám<\/span>/,
    'the state chip relies on colour alone');
  assert.match(html(), /aria-label="Zjistit stav pokusu Odeslání zprávy"/);
  assert.match(html(), /aria-label="Opustit pokus Odeslání zprávy"/);

  click('ms20-abandon-ask', operationId);
  await flush(1);
  assert.match(html(), /class="ms20-confirm" role="alert"/, 'the price is not announced');
  assert.match(html(), /aria-label="Potvrdit opuštění pokusu Odeslání zprávy — efekt zůstane nerozřešený"/);
});

await test('§10 the cap is a live region and the list is a list', () => {
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  assert.match(html(), /role="status" aria-live="polite"/, 'the cap count is not announced when it changes');
  assert.match(html(), /<ul class="ms20-list card">/, 'the attempts are not a list');
  assert.match(html(), /<li class="op-row ms20-row"/);
});

await test('§10 a running lookup reports itself to a screen reader, not only visually', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  let release;
  const held = new Promise(resolve => { release = resolve; });
  fetchQueue.push({ ...ok({ operationId, known: true, state: 'UNKNOWN' }), hold: held });
  const running = __ms20.lookupOperation(operationId);

  assert.match(html(), /aria-busy="true"/);
  release();
  await running;
  assert.doesNotMatch(html(), /aria-busy="true"/, 'the busy flag outlived the request');
});

// ── 10. Review C findings ───────────────────────────────────────────────────
//
// Each of these reproduces a way the screen could go on describing a state the
// server has already contradicted, or act without being asked to.

await test('F-038 a lookup that resolves releases the row and the cap even if the refresh fails', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  state.data.operationsAt = Date.now();
  state.cacheAge.operations = 'FRESH';
  render();

  fetchQueue.push(ok({ operationId, known: true, state: 'CONFIRMED' }));
  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  click('ms20-lookup', operationId);
  await flush();

  assert.doesNotMatch(html(), /data-act="ms20-lookup"/, 'the resolved row survived the failed refresh');
  assert.match(html(), /0 \/ 32/, 'the cap still counts a slot the server said is free');
  assert.match(html(), /Server seznam nevrátil/, 'the failed refresh was hidden');
  assert.equal(journal.find(operationId).lastKnownState, 'CONFIRMED');
});

await test('F-038 a successful abandon releases the row and the cap even if the refresh fails', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 32, limit: 32, atLimit: true };
  render();

  fetchQueue.push(ok({ operationId, abandoned: true, effectStillUnknown: true, open: 31, limit: 32 }));
  fetchQueue.push(offline());
  click('ms20-abandon-ask', operationId);
  await flush(1);
  click('ms20-abandon-confirm', operationId);
  await flush();

  assert.doesNotMatch(html(), /data-act="ms20-abandon-ask"/, 'the abandoned row survived the failed refresh');
  assert.match(html(), /31 \/ 32/, 'the cap was not corrected from the abandon response');
  assert.doesNotMatch(html(), /Strop je vyčerpaný/, 'the screen still claims a full cap');
  assert.match(html(), /Nejsi online/, 'the failed refresh was hidden');
  assert.equal(journal.find(operationId), null);
});

await test('F-038 authoritative per-item releases survive restart plus offline refresh without making the list fresh', async () => {
  const operationId = 'a'.repeat(32);
  const cachedAt = Date.now() - 2 * MINUTE;
  reset({ journalEntries: [entry()] });
  cache.writeAt('operations',
    { list: [serverRow()], meta: { open: 1, limit: 32, atLimit: false } }, cachedAt);
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  state.data.operationsAt = cachedAt;
  state.cacheAge.operations = 'STALE';
  render();

  fetchQueue.push(ok({ operationId, known: true, state: 'CONFIRMED' }));
  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  click('ms20-lookup', operationId);
  await flush();

  state.data = {};
  state.cacheAge = {};
  state.error = {};
  fetchQueue.push(offline());
  await __ms20.loadOperations();

  assert.deepEqual(state.data.operations, [], 'restart restored the terminal row from stale cache');
  assert.equal(state.data.operationsMeta.open, 0, 'restart restored a released slot');
  assert.equal(state.data.operationsAt, cachedAt, 'per-item release refreshed the full-list timestamp');
  assert.equal(state.cacheAge.operations, 'STALE', 'per-item release marked the full list fresh');
});

await test('F-038 successful abandon persists its authoritative response through restart plus offline refresh', async () => {
  const operationId = 'a'.repeat(32);
  const cachedAt = Date.now() - 2 * MINUTE;
  reset({ journalEntries: [entry()] });
  cache.writeAt('operations',
    { list: [serverRow()], meta: { open: 32, limit: 32, atLimit: true } }, cachedAt);
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 32, limit: 32, atLimit: true };
  state.data.operationsAt = cachedAt;
  state.cacheAge.operations = 'STALE';
  render();

  fetchQueue.push(ok({ operationId, abandoned: true, effectStillUnknown: true, open: 31, limit: 32 }));
  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  click('ms20-abandon-ask', operationId);
  click('ms20-abandon-confirm', operationId);
  await flush();

  state.data = {};
  state.cacheAge = {};
  state.error = {};
  fetchQueue.push(offline());
  await __ms20.loadOperations();

  assert.deepEqual(state.data.operations, [], 'restart restored an abandoned row from stale cache');
  assert.deepEqual(state.data.operationsMeta, { open: 31, limit: 32, atLimit: false });
  assert.equal(state.data.operationsAt, cachedAt, 'abandon refreshed the full-list timestamp');
  assert.equal(state.cacheAge.operations, 'STALE');
});

await test('F-038 local-only A never releases server B or lowers its server cap', async () => {
  const first = 'a'.repeat(32);
  const second = 'b'.repeat(32);
  reset({ journalEntries: [entry(), entry({ operationId: second })] });
  state.data.operations = [serverRow({ operationId: second })];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  fetchQueue.push(ok({ operationId: first, known: true, state: 'CONFIRMED' }));
  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  await __ms20.lookupOperation(first);
  assert.deepEqual(state.data.operations.map(row => row.operationId), [second]);
  assert.equal(state.data.operationsMeta.open, 1, "terminal local-only A lowered B's server count");

  reset({ journalEntries: [entry(), entry({ operationId: second })] });
  state.data.operations = [serverRow({ operationId: second })];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();
  fetchQueue.push(fail(404, { code: 'not_found', resource: 'operation' }));
  fetchQueue.push(fail(503, { code: 'server_unavailable' }));
  click('ms20-abandon-ask', first);
  click('ms20-abandon-confirm', first);
  await flush();

  assert.deepEqual(state.data.operations.map(row => row.operationId), [second]);
  assert.equal(state.data.operationsMeta.open, 1, "not-found local-only A lowered B's server count");
});

await test('F-039 startup reconciliation only reads: no send, no silent abandon', async () => {
  const first = 'a'.repeat(32);
  const second = 'b'.repeat(32);
  reset({
    journalEntries: [
      entry(),
      entry({ operationId: second, lastKnownState: 'PENDING', unknownReason: null }),
    ],
  });
  // The exact case the old code re-sent on: an unknown key whose original
  // request the phone still holds.
  store.set(K.drafts, { [first]: { conversationId: 'c-1', message: 'ahoj' } });

  fetchQueue.push({ status: 404, body: { ok: true, data: { operationId: first, known: false, state: null } } });
  fetchQueue.push(ok({ operationId: second, known: true, state: 'PENDING' }));

  await __ms20.reconcileOpenOperations();

  assert.deepEqual(fetchLog.map(request => request.method), ['GET', 'GET'],
    'startup dispatched something other than reads');
  assert.ok(journal.find(first), 'startup abandoned an attempt nobody asked it to');
  assert.ok(journal.find(second), 'startup dropped an open attempt');
  assert.equal(state.sending, false, 'startup started a send');
});

await test('F-039 the status control on a chat message reads only, even holding the draft', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()], route: 'chat' });
  store.set(K.drafts, { [operationId]: { conversationId: 'c-1', message: 'ahoj' } });
  state.conversationId = 'c-1';
  state.data.thread = {
    conversation: { id: 'c-1', title: 'Konverzace' },
    messages: [{ id: 'local', role: 'user', content: 'ahoj', createdAt: Date.now(), operationId }],
  };
  state.cacheAge.thread = 'FRESH';
  render();
  assert.match(html(), /data-act="resolve-op"/, 'the message row lost its status control');

  fetchQueue.push({ status: 404, body: { ok: true, data: { operationId, known: false, state: null } } });
  fetchQueue.push(ok({ conversation: { id: 'c-1', title: 'Konverzace' }, messages: [] }));
  click('resolve-op', operationId);
  await flush();

  assert.equal(fetchLog.filter(request => request.method === 'POST').length, 0,
    'a control labelled "Zjistit stav" dispatched a mutation');
  assert.ok(journal.find(operationId), 'the status control abandoned the attempt silently');
  const toastText = nodes.toasts.children.map(node => node.textContent).join(' ');
  assert.match(toastText, /Server tenhle klíč nezná/, 'the outcome was not reported anywhere');
});

await test('F-040 only ok:true with data.known:false means the server does not hold the key', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  render();

  fetchQueue.push({ status: 404, body: { ok: true, protocolVersion: 'm1', data: { operationId, known: false, state: null } } });
  click('ms20-lookup', operationId);
  await flush();

  assert.match(html(), /Server tenhle klíč nezná/);
  assert.doesNotMatch(html(), /Stav se nepodařilo zjistit/);
  assert.equal(journal.find(operationId).lastKnownState, 'UNKNOWN', 'the attempt was resolved by a 404');
});

await test('F-040 a NOT_FOUND envelope stays a truthful failure, not "the server never saw it"', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push(fail(404, { code: 'not_found', resource: 'operation' }));
  click('ms20-lookup', operationId);
  await flush();

  assert.doesNotMatch(html(), /Server tenhle klíč nezná/,
    'an error envelope was read as a statement about the attempt');
  assert.match(html(), /Stav se nepodařilo zjistit\. Pokus zůstává nerozřešený/);
  assert.match(html(), /data-act="ms20-lookup"/, 'the row lost its lookup after a failure');
});

await test('F-040 a bodyless 404 (proxy, wrong route) stays a truthful failure', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push({ status: 404, body: null });
  click('ms20-lookup', operationId);
  await flush();

  assert.doesNotMatch(html(), /Server tenhle klíč nezná/);
  assert.match(html(), /Stav se nepodařilo zjistit/);
});

await test('F-040 a 404 answer about a different attempt is not applied to this one', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push({ status: 404, body: { ok: true, data: { operationId: 'c'.repeat(32), known: false, state: null } } });
  click('ms20-lookup', operationId);
  await flush();

  assert.doesNotMatch(html(), /Server tenhle klíč nezná/);
  assert.match(html(), /Stav se nepodařilo zjistit/);
});

await test('F-040 a 404 answer without the requested operationId is a failure', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push({ status: 404, body: { ok: true, data: { known: false, state: null } } });
  click('ms20-lookup', operationId);
  await flush();

  assert.doesNotMatch(html(), /Server tenhle klíč nezná/);
  assert.match(html(), /Stav se nepodařilo zjistit/);
});

await test('F-040 a 2xx known:false is a protocol failure, not an unknown-key answer', async () => {
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();

  fetchQueue.push(ok({ operationId, known: false, state: null }));
  click('ms20-lookup', operationId);
  await flush();

  assert.doesNotMatch(html(), /Server tenhle klíč nezná/);
  assert.match(html(), /Server poslal neplatnou odpověď/);
  assert.equal(state.conn, 'server');
});

await test('F-041 a lookup merges the new state, reason and check time into the row at once', async () => {
  const operationId = 'a'.repeat(32);
  const cachedAt = Date.now() - 2 * MINUTE;
  reset({ journalEntries: [entry({ lastKnownState: 'PENDING', unknownReason: null })] });
  state.data.operations = [serverRow({
    state: 'PENDING', unknownReason: null, unknownAt: null,
    lastCheckedAt: Date.now() - 2 * MINUTE,
  })];
  state.data.operationsMeta = { open: 1, limit: 32, atLimit: false };
  state.data.operationsAt = cachedAt;
  state.cacheAge.operations = 'STALE';
  cache.writeAt('operations', {
    list: [serverRow({ state: 'PENDING', unknownReason: null, unknownAt: null })],
    meta: state.data.operationsMeta,
  }, cachedAt);
  render();
  assert.match(html(), /čeká na výsledek/);
  assert.match(html(), /ověřeno před 2 min/);

  fetchQueue.push(ok({
    operationId, known: true, state: 'UNKNOWN',
    unknownReason: 'connection_lost_after_dispatch', unknownAt: Date.now() - 30_000,
  }));
  click('ms20-lookup', operationId);
  await flush();

  assert.equal(fetchLog.length, 1, 'the row waited for a list refresh to tell the truth');
  assert.match(html(), /výsledek neznám/, 'the transition to UNKNOWN was not applied');
  assert.match(html(), /Spojení spadlo až po odeslání/, 'the new reason was not applied');
  assert.match(html(), /ověřeno právě teď/, 'the check time did not advance');
  assert.doesNotMatch(html(), /ověřeno před 2 min/);
  assert.doesNotMatch(html(), /čeká na výsledek/);
  assert.doesNotMatch(html(), /Stav se nezměnil/, 'PENDING → UNKNOWN falsely claimed no change');
  assert.match(html(), /Výsledek je nyní neznámý/);

  state.data = {};
  state.cacheAge = {};
  state.error = {};
  fetchQueue.push(offline());
  await __ms20.loadOperations();
  assert.equal(state.data.operations[0].state, 'UNKNOWN', 'restart restored the old PENDING cache row');
  assert.equal(state.data.operations[0].unknownReason, 'connection_lost_after_dispatch');
  assert.ok(state.data.operations[0].lastCheckedAt > cachedAt, 'restart lost the new check time');
  assert.equal(state.data.operationsAt, cachedAt, 'per-item patch refreshed the full-list timestamp');
  assert.equal(state.cacheAge.operations, 'STALE');
});

await test('F-042 MS-20 actions declare the approved 48 × 48 dp minimum target', () => {
  const css = readFileSync(new URL('../src/mobile/client/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\.ms20-row \.op-actions \.btn \s*\{([^}]*)\}/);
  assert.ok(rule, 'no touch-target rule for the MS-20 actions');
  const height = rule[1].match(/min-height:\s*(\d+(?:\.\d+)?(?:px|rem))/);
  const width = rule[1].match(/min-width:\s*(\d+(?:\.\d+)?(?:px|rem))/);
  // 48 **dp**, whatever the unit: the sheet moved to `rem` for dynamic type, so
  // the value is normalised at the 16 px root rather than compared as a number.
  const dp = (value) => (String(value).endsWith('rem') ? parseFloat(value) * 16 : parseFloat(value));
  assert.ok(height && dp(height[1]) >= 48, `min-height is ${height?.[1] ?? 'unset'}, needs ≥ 48 dp`);
  assert.ok(width && dp(width[1]) >= 48, `min-width is ${width?.[1] ?? 'unset'}, needs ≥ 48 dp`);

  // The rule only reaches the buttons if both action groups keep their place in
  // the row — the resting pair and the confirmation pair.
  const operationId = 'a'.repeat(32);
  reset({ journalEntries: [entry()] });
  state.data.operations = [serverRow()];
  render();
  assert.match(html(), /<li class="op-row ms20-row"[\s\S]*<div class="op-actions">[\s\S]*data-act="ms20-lookup"/);

  __ms20.askAbandon(operationId);
  assert.match(html(), /<li class="op-row ms20-row"[\s\S]*<div class="op-actions">[\s\S]*data-act="ms20-abandon-confirm"/);
  // Not browser-verified: no layout engine here (F-043).
});

for (const handle of timers) clearTimeout(handle);

console.log(`\nMS-20 UI: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
