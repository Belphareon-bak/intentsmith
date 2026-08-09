// MS-13 — approval queue (SCREENS §4 MS-13, MD-07, MR-15)
// ==============================================================================
//
// This screen is almost entirely defined by what it must refuse to do, so the
// suite is written as a list of lies it must not tell:
//
//   * "Nic nečeká" while the server was never asked                 (SS-03)
//   * "Nic nečeká" while the server answered badly                  (SS-08)
//   * a queue rendered from memory after a failed refresh           (MD-07)
//   * an approval written to the device cache at all                (MD-07, SS-04)
//   * an empty screen where the real answer is "no permission"      (SS-07)
//   * a queue that silently shrinks when something is decided
//     elsewhere, or that invents who decided it                     (SS-09)
//   * a remembered count in the menu after the queue is gone        (D-S2)
//
// "Nic nečeká" is permission to put the phone down.  Every assertion below
// exists so that permission is only ever granted by a confirmed 200.
//
// Deciding (MS-14) is deliberately not tested here; this MS-13 screen reads.
// MS-14 is covered by mobile-ms14-decision.test.js.
// What this suite does not prove is the same as MS-20's F-043: there is no
// browser here, so contrast, real hit targets, focus order and what assistive
// technology announces remain unverified.
//
// ==============================================================================

import { strict as assert } from 'node:assert';

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

const realSetTimeout = globalThis.setTimeout;
const tick = () => new Promise(resolve => realSetTimeout(resolve, 0));
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
globalThis.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState: () => {} };

let fetchQueue = [];
let fetchLog = [];

globalThis.fetch = async (url, options = {}) => {
  fetchLog.push({
    url: String(url),
    method: options.method || 'GET',
    cache: options.cache,
  });
  const next = fetchQueue.shift();
  if (!next) throw new Error(`unexpected request: ${options.method || 'GET'} ${url}`);
  // A response may be held open, so a test can choose the order two in-flight
  // reads come back in.  Out-of-order is the normal case on a phone radio, and
  // it is the only way to check the ordering guard at all.
  if (next.gate) await next.gate;
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

const ok = (data, extra = {}) => ({ status: 200, body: { ok: true, data, ...extra } });
const fail = (status, error) => ({ status, body: { ok: false, error } });
const offline = () => ({ network: true });

// ── The client under test ───────────────────────────────────────────────────

const { __ms20 } = await import('../src/mobile/client/app.js');
const {
  state, store, K, api, render, navigate, loadApprovals, approvalsGone,
  handleWentOffline, handleCameOnline, replaceScopes,
} = __ms20;

const clickHandler = (listeners.click || [])[0];
assert.ok(clickHandler, 'the client registered no click handler');

/** Fire a control that is actually rendered, the way a finger would. */
function click(act) {
  const match = html().match(new RegExp(`data-act="${act}"([^>]*)>`));
  assert.ok(match, `no control with data-act="${act}"`);
  assert.ok(!/\bdisabled\b/.test(match[1]), `control ${act} is disabled`);
  const target = { dataset: { act } };
  target.closest = () => target;
  clickHandler({ target });
}

const html = () => nodes.app.innerHTML;

function drawerHtml() {
  const drawer = globalThis.document.querySelector('.drawer');
  return drawer ? drawer.innerHTML : '';
}

const MINUTE = 60_000;

/** A row exactly as `GET /m1/approvals` returns it (handlers.js:514-541). */
function approval(overrides = {}) {
  return {
    id: 'ap-1',
    subjectType: 'lifecycle.checkpoint',
    subjectId: 'run-9',
    title: 'Schválit zápis do src/server.js',
    detail: 'Milestone M3 chce zapsat 2 soubory.',
    payloadFingerprint: 'f'.repeat(64),
    createdAt: Date.now() - 3 * MINUTE,
    expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString(),
    expired: false,
    version: 'v1:abc',
    ...overrides,
  };
}

const APPROVAL_SCOPES = ['read:chat', 'write:chat', 'read:approvals'];

function reset({ scopes = APPROVAL_SCOPES, route = 'approvals' } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  store.set(K.journal, []);
  state.session = 'active';
  state.route = route;
  state.conn = 'ok';
  state.drawer = false;
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
  state.approvalsGone = {};
  state.approvalsDecidedHere = {};
  state.approvalAttempts = {};
  state.approvalId = null;
  state.approvalNote = null;
  state.approvalVerifiedAt = null;
  state.approvalSending = false;
  fetchQueue = [];
  fetchLog = [];
  nodes.toasts.children.length = 0;
  body.children.length = 0;
}

/** Every localStorage value, so a test can prove nothing was written. */
function storedBlob() {
  return Object.keys(localStorage)
    .map(key => `${key}=${localStorage.getItem(key)}`)
    .join('\n');
}

console.log('\n=== MS-13 approval queue (SCREENS §4) ===');

// ── 1. The screen exists and always asks the server ─────────────────────────

await test('MS-13 the queue is its own route with its own screen', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.match(html(), /Schválení/);
  assert.match(html(), /Schválit zápis do src\/server\.js/);
});

await test('MS-13 SS-01 entering the screen always re-reads from the server', async () => {
  reset({ route: 'conversations' });
  fetchQueue = [ok([approval()])];
  navigate('approvals');
  await flush();
  assert.equal(fetchLog.length, 1, 'the queue was not fetched on entry');
  assert.match(fetchLog[0].url, /\/m1\/approvals$/);
  assert.equal(fetchLog[0].method, 'GET');
});

await test('MS-13 SS-10 re-entering repeats the read and never mutates', async () => {
  reset();
  fetchQueue = [ok([approval()]), ok([approval()])];
  await loadApprovals();
  await loadApprovals();
  assert.equal(fetchLog.length, 2);
  assert.ok(fetchLog.every(entry => entry.method === 'GET'), 'the queue screen issued a non-GET request');
});

await test('MS-13 SS-05 a reconnect reloads the whole queue rather than patching it', async () => {
  reset();
  fetchQueue = [offline()];
  await loadApprovals();
  assert.equal(state.data.approvals, undefined);

  fetchQueue = [ok([approval({ id: 'ap-1' }), approval({ id: 'ap-2', title: 'Druhý' })])];
  await loadApprovals();
  assert.equal(state.data.approvals.length, 2);
  assert.match(html(), /Druhý/);
});

// ── 2. The lies about an empty queue ────────────────────────────────────────

await test('MS-13 SS-03 offline the queue is not shown at all — never as empty', async () => {
  reset();
  fetchQueue = [offline()];
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/, 'a failed request produced the walk-away message');
  assert.match(html(), /připojení|offline|spojení/i, 'offline was not named as the cause');
});

await test('MS-13 SS-08 a server failure shows the failure, never a count', async () => {
  reset();
  fetchQueue = [fail(503, { code: 'server_unavailable' })];
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/);
  assert.doesNotMatch(html(), /appr-row/, 'a failed load still rendered queue rows');
});

await test('MS-13 SS-02 "nic nečeká" appears only after a confirmed empty response', async () => {
  reset();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /Nic nečeká/);
  assert.match(html(), /potvrzená odpověď/i, 'the empty state does not say it is confirmed');
});

await test('MS-13 a load that fails after a successful one drops the queue instead of keeping it', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.match(html(), /appr-row/);

  fetchQueue = [offline()];
  await loadApprovals();
  assert.equal(state.data.approvals, undefined, 'the previous queue survived a failed refresh');
  assert.doesNotMatch(html(), /appr-row/, 'a stale queue is still on screen');
  assert.doesNotMatch(html(), /Nic nečeká/, 'and it degraded into the walk-away message');
});

await test('MS-13 an empty confirmed queue followed by a failure stops claiming emptiness', async () => {
  reset();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /Nic nečeká/);

  fetchQueue = [fail(500, { code: 'internal_error' })];
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/, 'emptiness outlived the answer that established it');
});

// ── 3. MD-07 — approvals are never cached ───────────────────────────────────

await test('MD-07 a loaded queue is never written to device storage', async () => {
  reset();
  fetchQueue = [ok([approval({ detail: 'CITLIVY-DETAIL-XYZ' })])];
  await loadApprovals();
  const stored = storedBlob();
  assert.doesNotMatch(stored, /CITLIVY-DETAIL-XYZ/, 'approval detail reached localStorage');
  assert.doesNotMatch(stored, /ap-1/, 'an approval id reached localStorage');
  assert.doesNotMatch(stored, /is\.cache\.approvals/, 'the queue was given a cache entry');
});

await test('MD-07 the fingerprint is never persisted either', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.doesNotMatch(storedBlob(), /f{64}/, 'the payload fingerprint was cached');
});

await test('SS-04 staleness cannot occur, because no cached queue exists to age', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.equal(state.cacheAge.approvals, undefined, 'the queue reported a cache age');
  assert.doesNotMatch(html(), /zastaral|neaktuáln/i, 'the queue rendered a staleness notice');
});

// ── 4. SS-07 — scope, fail-closed ───────────────────────────────────────────

await test('SS-07 without read:approvals the screen says why instead of showing nothing', () => {
  reset({ scopes: ['read:chat'] });
  render();
  assert.match(html(), /read:approvals/, 'the missing scope is not named');
  assert.doesNotMatch(html(), /Nic nečeká/, 'a missing scope was rendered as an empty queue');
});

await test('SS-07 a missing scope explicitly denies the empty reading', () => {
  reset({ scopes: ['read:chat'] });
  render();
  assert.match(html(), /Neznamená to, že je prázdná/i);
});

await test('SS-07 without the scope the client does not even ask', async () => {
  reset({ scopes: ['read:chat'] });
  await loadApprovals();
  assert.equal(fetchLog.length, 0, 'a device without the scope still queried the queue');
});

// ── 5. SS-09 — decided elsewhere ────────────────────────────────────────────

await test('SS-09 an approval that leaves the queue is reported, not silently dropped', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1', title: 'Zápis do serveru' }), approval({ id: 'ap-2', title: 'Druhý' })])];
  await loadApprovals();

  fetchQueue = [ok([approval({ id: 'ap-2', title: 'Druhý' })])];
  await loadApprovals();

  assert.equal(approvalsGone().length, 1);
  assert.match(html(), /Zápis do serveru/, 'the vanished approval was not named');
  assert.match(html(), /rozhodnut jinde/i);
});

await test('SS-09 the note refuses to invent who decided it or when', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();
  fetchQueue = [ok([])];
  await loadApprovals();

  // The list endpoint returns only undecided rows and carries no decided_by or
  // decided_at, so any name or timestamp here would be fabricated.
  assert.match(html(), /Kým a kdy, to tahle odpověď neříká/);
});

await test('SS-09 a vanished approval does not turn a real queue into an empty one', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /Nic nečeká/, 'a confirmed empty queue must still say so');
  assert.match(html(), /rozhodnut jinde/i, 'and still explain what left it');
});

await test('SS-09 a failed refresh never reports approvals as decided elsewhere', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();

  fetchQueue = [offline()];
  await loadApprovals();
  assert.equal(approvalsGone().length, 0, 'an unreachable server was read as a decision');
});

await test('SS-09 an id that comes back stops being reported as gone', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.equal(approvalsGone().length, 1);

  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();
  assert.equal(approvalsGone().length, 0, 'a returned approval stayed in the vanished note');
});

// ── 6. R-3 — the window is shown, never computed into permission ────────────

await test('R-3 a live approval shows the remaining window from the server expiry', async () => {
  reset();
  fetchQueue = [ok([approval({ expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString() })])];
  await loadApprovals();
  assert.match(html(), /zbývá 12 min/);
});

await test('R-3 an expired approval says so and offers no way to extend it', async () => {
  reset();
  fetchQueue = [ok([approval({ expired: true, expiresAt: new Date(Date.now() - MINUTE).toISOString() })])];
  await loadApprovals();
  assert.match(html(), /vypršelo/i);
  assert.doesNotMatch(html(), /prodlouž/i, 'the screen offered to extend an expired approval');
});

// F-065.  What stood here was `assert.doesNotMatch(html(), /zbývá -/)` on a row
// whose remaining minutes are already clamped by `Math.max(0, …)` two lines
// away — an assertion about the clamp, dressed up as an assertion about
// authority.  It could not fail while the property it names ("the server expiry
// is the authority") was broken in either direction, which is the definition of
// a tautology here.
//
// The property has a real negative form, and it is two-sided: the client must
// not *add* an expiry the server did not declare, and must not *withhold* one it
// did.  Both directions are dangerous and they fail in opposite ways — one
// blocks a decision the user is entitled to make, the other offers one the
// server will refuse.  So both are asserted, and the clamp keeps its own check.

await test('R-3 the client never invents an expiry the server did not declare', async () => {
  reset();
  // Past `expiresAt`, but the server says it is still open — clock skew between
  // a phone and a server is normal and is not a verdict.
  fetchQueue = [ok([approval({ expired: false, expiresAt: new Date(Date.now() - 5 * MINUTE).toISOString() })])];
  await loadApprovals();
  assert.doesNotMatch(html(), /vypršelo/i, 'the client overruled the server and expired the approval itself');
  assert.match(html(), /zbývá/, 'the row stopped showing a window it is still inside');
  assert.doesNotMatch(html(), /zbývá -/, 'a past expiry produced a negative remaining window');
});

await test('R-3 the client never withholds an expiry the server did declare', async () => {
  reset();
  // The mirror image: a future `expiresAt`, and the server says it is expired
  // anyway (withdrawn, superseded, or the server's clock is the real one).
  fetchQueue = [ok([approval({ expired: true, expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString() })])];
  await loadApprovals();
  assert.match(html(), /vypršelo — rozhodnout už nelze/, 'the client hid the server verdict behind its own arithmetic');
  assert.doesNotMatch(html(), /zbývá 12 min/, 'an expired approval still advertised a remaining window');
});

// ── 7. MS-14 is not here ────────────────────────────────────────────────────

// F-065 again.  The two assertions here used to look for `data-act="approve"`
// and `data-act="reject"` — action names that exist nowhere in the client, so
// they could not have matched even if the queue rendered a full decision panel.
// The real control names are asserted instead, and the test proves the patterns
// can match at all before trusting their absence.
await test('MS-13 the queue offers no decision control — deciding is MS-14', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.match(html(), /appr-row/, 'precondition: the queue really rendered rows');
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'the reading screen offers approve');
  assert.doesNotMatch(html(), /data-act="approval-reject"/, 'the reading screen offers reject');
  // The one control a row does carry is the one that leads to MS-14.
  assert.match(html(), /data-act="open-approval"/, 'the row no longer opens the decision screen');
});

await test('MS-13 the patterns the previous test trusts are patterns that can match', async () => {
  // The guard for the guard: `data-act="approval-approve"` has to be a string
  // this client can actually emit, or every absence assertion above is theatre.
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  state.route = 'approval';
  state.approvalId = 'ap-1';
  state.approvalVerifiedAt = Date.now();
  store.set(K.scopes, [...APPROVAL_SCOPES, 'write:approvals']);
  render();
  assert.match(html(), /data-act="approval-approve"/, 'the decision control name is wrong — the absence tests prove nothing');
  assert.match(html(), /data-act="approval-reject"/);
});

await test('I-4 nothing on this screen queues an action for later', async () => {
  reset();
  fetchQueue = [offline()];
  await loadApprovals();
  assert.doesNotMatch(html(), /odešle se pozděj|ve frontě|zkusíme to znovu/i);
});

// ── 8. D-S2 — the menu count is live or absent ──────────────────────────────

await test('D-S2 the menu shows a count only from a confirmed queue', async () => {
  reset({ route: 'conversations' });
  fetchQueue = [ok([approval({ id: 'ap-1' }), approval({ id: 'ap-2' })])];
  await loadApprovals();
  state.drawer = true;
  render();
  assert.match(drawerHtml(), /data-route="approvals"/);
  assert.match(drawerHtml(), /nav-count">2</);
});

await test('D-S2 the count disappears when the queue could not be confirmed', async () => {
  reset({ route: 'conversations' });
  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();
  fetchQueue = [offline()];
  await loadApprovals();
  state.drawer = true;
  render();
  assert.match(drawerHtml(), /data-route="approvals"/, 'the route itself must stay reachable');
  assert.doesNotMatch(drawerHtml(), /nav-count/, 'a remembered count outlived the queue');
});

await test('D-S2 a confirmed empty queue shows no count rather than a zero', async () => {
  reset({ route: 'conversations' });
  fetchQueue = [ok([])];
  await loadApprovals();
  state.drawer = true;
  render();
  assert.doesNotMatch(drawerHtml(), /nav-count/);
});

// ── 9. SS-06 — logout and revocation ────────────────────────────────────────

await test('SS-06 a revoked device loses the queue from memory, not just from storage', async () => {
  reset();
  fetchQueue = [ok([approval({ detail: 'CITLIVY-DETAIL-XYZ' })])];
  await loadApprovals();
  assert.ok(state.data.approvals.length === 1);

  fetchQueue = [fail(401, { code: 'token_revoked' })];
  await loadApprovals();
  assert.equal(state.data.approvals, undefined, 'the queue survived revocation in memory');
  assert.doesNotMatch(html(), /CITLIVY-DETAIL-XYZ/);
});

await test('SS-06 an expired token also clears the queue', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();

  fetchQueue = [fail(401, { code: 'token_expired' })];
  await loadApprovals();
  assert.equal(state.data.approvals, undefined);
  assert.equal(approvalsGone().length, 0);
});

// ── 10. Accessibility contract in the markup ────────────────────────────────

await test('§10 the vanished-approval note is announced, not only styled', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1' })])];
  await loadApprovals();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /class="appr-gone" role="status"/);
});

await test('§10 the queue is a list, and each row names its subject in text', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.match(html(), /<ul class="appr-list/);
  assert.match(html(), /<li class="appr-row/);
  assert.match(html(), /lifecycle\.checkpoint/, 'the row carries no textual subject');
});

await test('§10 expiry is carried by words, not only by a colour token', async () => {
  reset();
  fetchQueue = [ok([approval({ expired: true })])];
  await loadApprovals();
  assert.match(html(), /vypršelo — rozhodnout už nelze/);
});

// ── 11. F-057 — only the newest read may publish ────────────────────────────
//
// Two reads of this queue can be in flight at once — entering the screen while
// a boot read is still running, a reconnect on top of a manual refresh — and
// nothing orders their answers.  When the older one lands last it puts a queue
// on screen that the server has already contradicted, on the one screen whose
// whole promise is that what is shown was confirmed just now.

await test('F-057 an older queue read that lands last publishes nothing', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [
    { ...ok([approval({ id: 'ap-old', title: 'STARÝ' })]), gate },   // read A — held open
    ok([approval({ id: 'ap-new', title: 'NOVÝ' })]),                 // read B — answers first
  ];
  const first = loadApprovals();
  const second = loadApprovals();
  await second;
  assert.match(html(), /NOVÝ/, 'precondition: the newer read published');

  release();
  await first;
  assert.doesNotMatch(html(), /STARÝ/, 'a superseded read overwrote the newer answer');
  assert.match(html(), /NOVÝ/, 'the newest confirmed queue was lost');
  assert.equal(state.data.approvals.length, 1);
  assert.equal(state.data.approvals[0].id, 'ap-new');
});

await test('F-057 a superseded empty answer cannot claim the queue is empty', async () => {
  // The worst ordering: the stale answer is the one that says "nothing waiting",
  // which is permission to put the phone down.
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [
    { ...ok([]), gate },
    ok([approval({ id: 'ap-1', title: 'Čeká na tebe' })]),
  ];
  const first = loadApprovals();
  const second = loadApprovals();
  await second;
  release();
  await first;
  assert.doesNotMatch(html(), /Nic nečeká/, 'a stale empty answer granted permission to walk away');
  assert.match(html(), /Čeká na tebe/);
  // Also asserted on the state, not only on the pixels: a superseded answer
  // that is written but not painted is still a queue waiting to be rendered by
  // the next unrelated re-render.
  assert.equal(state.data.approvals.length, 1, 'a stale empty answer was written into the queue');
  assert.equal(state.data.approvals[0].id, 'ap-1');
});

await test('F-057 a superseded failure cannot erase a newer confirmed queue', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [
    { ...offline(), gate },
    ok([approval({ id: 'ap-1', title: 'Čeká na tebe' })]),
  ];
  const first = loadApprovals();
  const second = loadApprovals();
  await second;
  release();
  await first;
  assert.match(html(), /Čeká na tebe/, 'a superseded failure dropped a newer confirmed queue');
  assert.equal(state.error.approvals, null, 'a superseded failure was published as the screen state');
});

// ── 12. F-058 — offline and error transitions invalidate the whole screen ───
//
// A failed *load* already drops the queue.  The transitions themselves did not:
// the window listeners only repainted the connection banner, so the queue, the
// menu count and — on the decision screen — the right to decide all stayed
// exactly as they were while the phone stopped being able to confirm any of it.

await test('F-058 going offline drops the queue rather than leaving it on screen', async () => {
  reset();
  fetchQueue = [ok([approval({ detail: 'CITLIVY-DETAIL-XYZ' })])];
  await loadApprovals();
  assert.match(html(), /appr-row/, 'precondition: a queue is on screen');

  handleWentOffline();
  assert.equal(state.data.approvals, undefined, 'the queue survived the offline transition');
  assert.doesNotMatch(html(), /appr-row/, 'a queue nobody can confirm is still rendered');
  assert.doesNotMatch(html(), /Nic nečeká/, 'and it degraded into the walk-away message');
  assert.doesNotMatch(html(), /CITLIVY-DETAIL-XYZ/);
});

await test('F-058 going offline takes the menu count with it', async () => {
  reset({ route: 'conversations' });
  fetchQueue = [ok([approval({ id: 'ap-1' }), approval({ id: 'ap-2' })])];
  await loadApprovals();
  state.drawer = true;
  render();
  assert.match(drawerHtml(), /nav-count">2</, 'precondition: the count is shown');

  handleWentOffline();
  render();
  assert.doesNotMatch(drawerHtml(), /nav-count/, 'a remembered count outlived the connection');
  assert.match(drawerHtml(), /data-route="approvals"/, 'the route itself must stay reachable');
});

await test('F-058 a reconnect re-reads the queue instead of restoring the old one', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1', title: 'PŮVODNÍ' })])];
  await loadApprovals();
  handleWentOffline();

  fetchQueue = [ok([approval({ id: 'ap-2', title: 'AKTUÁLNÍ' })])];
  handleCameOnline();
  await flush();
  assert.match(html(), /AKTUÁLNÍ/, 'the reconnect did not re-read the queue');
  assert.doesNotMatch(html(), /PŮVODNÍ/, 'the pre-gap queue came back from memory');
});

await test('F-058 a read still in flight when the phone goes offline publishes nothing', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [{ ...ok([approval({ id: 'ap-1', title: 'DORAZILO POZDĚ' })]), gate }];
  const inFlight = loadApprovals();
  handleWentOffline();
  release();
  await inFlight;
  assert.equal(state.data.approvals, undefined, 'an answer from before the gap was published after it');
  assert.doesNotMatch(html(), /DORAZILO POZDĚ/);
});

// ── 13. F-059 — only an exact, valid, authoritative 200 ─────────────────────
//
// "Nic nečeká" is a statement about the world, and `response.ok` is not.  A 204,
// a 202, a body without the server's own envelope, a `data` that is not a list —
// every one of them reached the empty state or the queue, because the client
// asked whether the status was in the 2xx range and nothing else.

await test('F-059 a 204 is not a confirmed empty queue', async () => {
  reset();
  fetchQueue = [{ status: 204, body: null }];
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/, 'an empty 204 granted permission to walk away');
  assert.equal(state.data.approvals, undefined);
});

await test('F-059 a 201 is not an authoritative queue', async () => {
  reset();
  fetchQueue = [{ status: 201, body: { ok: true, data: [] } }];
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/, 'a 201 established the empty state');
  assert.equal(state.data.approvals, undefined);
});

await test('F-059 a 2xx without the server envelope is a protocol failure', async () => {
  reset();
  fetchQueue = [{ status: 200, body: { data: [] } }];   // no ok: true
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/, 'a body without the envelope established the empty state');
  assert.equal(state.data.approvals, undefined);
});

await test('F-059 a 200 whose data is not a list is a protocol failure', async () => {
  reset();
  fetchQueue = [ok({ nonsense: true })];
  await loadApprovals();
  assert.doesNotMatch(html(), /Nic nečeká/);
  assert.doesNotMatch(html(), /appr-row/);
  assert.equal(state.data.approvals, undefined, 'a malformed body became the queue');
});

await test('F-059 a protocol failure says the server answered badly, not that nothing waits', async () => {
  reset();
  fetchQueue = [{ status: 204, body: null }];
  await loadApprovals();
  assert.ok(state.error.approvals, 'a malformed 2xx left no error on the screen');
  assert.match(html(), /server|odpověď/i, 'the screen does not name what went wrong');
});

await test('F-059 a valid 200 still works — the check is exactness, not paranoia', async () => {
  // The positive control.  A rule that refuses everything is not a rule.
  reset();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /Nic nečeká/, 'a correct empty answer stopped being believed');
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.match(html(), /appr-row/, 'a correct queue stopped being believed');
});

// ── 14. F-060 — the authoritative refusal is still not an empty queue ───────
//
// The *local* scope check says "neznamená to, že je prázdná".  The server's own
// `scope_required` — the authoritative one, the one that arrives when the phone
// believed it had the scope — fell through to the generic error panel, which
// says only that permission is missing.  That is the same silence the local
// check was written to avoid.

await test('F-060 the server scope refusal explicitly denies the empty reading', async () => {
  reset();
  fetchQueue = [fail(403, { code: 'scope_required', requiredScope: 'read:approvals' })];
  await loadApprovals();
  assert.match(html(), /Neznamená to, že je prázdná/i, 'an authoritative refusal did not deny the empty reading');
  assert.doesNotMatch(html(), /Nic nečeká/);
});

await test('F-060 the server scope refusal names the scope that was refused', async () => {
  reset();
  fetchQueue = [fail(403, { code: 'scope_required', requiredScope: 'read:approvals' })];
  await loadApprovals();
  assert.match(html(), /read:approvals/, 'the refused scope is not named');
});

await test('F-060 a scope refusal drops the queue it can no longer confirm', async () => {
  reset();
  fetchQueue = [ok([approval({ detail: 'CITLIVY-DETAIL-XYZ' })])];
  await loadApprovals();
  fetchQueue = [fail(403, { code: 'scope_required', requiredScope: 'read:approvals' })];
  await loadApprovals();
  assert.equal(state.data.approvals, undefined, 'a queue outlived the permission to see it');
  assert.doesNotMatch(html(), /CITLIVY-DETAIL-XYZ/);
});

// ── 15. F-066 — the adversarial transitions ────────────────────────────────

await test('F-066 the retry control on the failed queue actually re-reads', async () => {
  // It was rendered and wired to nothing: `load-approvals` had no entry in the
  // action table, so the one way out of a failed queue did nothing at all.
  reset();
  fetchQueue = [offline()];
  await loadApprovals();
  assert.match(html(), /data-act="load-approvals"/, 'precondition: the control is offered');

  fetchLog = [];
  fetchQueue = [ok([approval()])];
  click('load-approvals');
  await flush();
  assert.equal(fetchLog.length, 1, 'the only way out of a failed queue is a dead control');
  assert.match(html(), /appr-row/);
});

await test('F-066 an auth failure cannot be undone by a queue answer that lands after it', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [
    { ...ok([approval({ detail: 'CITLIVY-DETAIL-XYZ' })]), gate },
    fail(401, { code: 'token_revoked' }),
  ];
  const first = loadApprovals();
  const second = loadApprovals();
  await second;
  assert.equal(state.session, 'revoked', 'precondition: the device was revoked');

  release();
  await first;
  assert.equal(state.data.approvals, undefined, 'a revoked device got its queue back from a late answer');
  assert.doesNotMatch(html(), /CITLIVY-DETAIL-XYZ/);
});

await test('F-066 a confirmed empty queue does not survive a later failed read', async () => {
  reset();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /Nic nečeká/);
  handleWentOffline();
  assert.doesNotMatch(html(), /Nic nečeká/, 'emptiness outlived the connection that confirmed it');
});

// ── 16. RV-023 lifecycle regressions (F-077..F-080) ────────────────────────

await test('F-077 revalidation withdraws prior rows and the drawer badge before the answer', async () => {
  reset();
  fetchQueue = [ok([approval({ title: 'STARÝ CITLIVÝ ŘÁDEK' })])];
  await loadApprovals();

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [{ ...ok([approval({ id: 'ap-2', title: 'NOVÝ ŘÁDEK' })]), gate }];
  const pending = loadApprovals();
  await flush();

  assert.equal(state.data.approvals, undefined, 'the published queue survived revalidation');
  assert.doesNotMatch(html(), /STARÝ CITLIVÝ ŘÁDEK/, 'a prior row stayed visible while the read was pending');
  state.drawer = true;
  render();
  assert.doesNotMatch(drawerHtml(), /nav-count/, 'a prior approval count stayed visible while the read was pending');

  release();
  await pending;
  assert.match(html(), /NOVÝ ŘÁDEK/);
});

await test('F-077 revalidation withdraws a prior confirmed-empty claim before the answer', async () => {
  reset();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.match(html(), /Nic nečeká/);

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [{ ...ok([]), gate }];
  const pending = loadApprovals();
  await flush();
  assert.doesNotMatch(html(), /Nic nečeká/, 'a previous empty answer looked current during revalidation');

  release();
  await pending;
});

await test('F-078 offline invalidation removes approval-derived notes as well as rows', async () => {
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1', title: 'ZMIZELÝ CITLIVÝ ŘÁDEK' })])];
  await loadApprovals();
  fetchQueue = [ok([])];
  await loadApprovals();
  state.approvalNote = { tone: 'ok', text: 'STARÝ VÝSLEDEK APPROVALU' };
  render();
  assert.match(html(), /ZMIZELÝ CITLIVÝ ŘÁDEK/);
  assert.match(html(), /STARÝ VÝSLEDEK APPROVALU/);

  handleWentOffline();
  assert.deepEqual(state.approvalsGone, {}, 'approval disappearance notes survived offline');
  assert.equal(state.approvalNote, null, 'an approval outcome note survived offline');
  assert.doesNotMatch(html(), /ZMIZELÝ CITLIVÝ ŘÁDEK|STARÝ VÝSLEDEK APPROVALU/);
});

await test('F-079 local read-scope loss clears the queue, notes and badge without asking the server', async () => {
  reset();
  fetchQueue = [ok([approval({ title: 'SCOPE-CITLIVÝ ŘÁDEK' })])];
  await loadApprovals();
  state.approvalsGone = { old: approval({ id: 'old', title: 'STARÁ POZNÁMKA' }) };
  state.approvalNote = { tone: 'ok', text: 'STARÝ VÝSLEDEK' };
  store.set(K.scopes, ['read:chat']);
  state.drawer = true;
  render();
  fetchLog = [];

  await loadApprovals();
  assert.equal(fetchLog.length, 0, 'the client asked for approvals without read:approvals');
  assert.equal(state.data.approvals, undefined, 'scope loss retained the unauthorized queue');
  assert.deepEqual(state.approvalsGone, {}, 'scope loss retained approval-derived notes');
  assert.equal(state.approvalNote, null, 'scope loss retained the approval outcome');
  assert.doesNotMatch(html() + drawerHtml(), /SCOPE-CITLIVÝ ŘÁDEK|STARÁ POZNÁMKA|STARÝ VÝSLEDEK/);
  assert.doesNotMatch(drawerHtml(), /nav-count/, 'scope loss retained the unauthorized badge');
});

await test('F-079 a server scope replacement withdraws the approval surface immediately', async () => {
  reset();
  fetchQueue = [ok([approval({ title: 'SERVER-SCOPE-CITLIVÝ ŘÁDEK' })])];
  await loadApprovals();
  state.drawer = true;
  render();
  assert.match(drawerHtml(), /nav-count/);

  replaceScopes(['read:chat']);
  render();
  assert.equal(state.data.approvals, undefined);
  assert.doesNotMatch(html() + drawerHtml(), /SERVER-SCOPE-CITLIVÝ ŘÁDEK/);
  assert.doesNotMatch(drawerHtml(), /nav-count/);
});

await test('F-080 approval reads explicitly bypass the browser HTTP cache', async () => {
  reset();
  fetchQueue = [ok([])];
  await loadApprovals();
  assert.equal(fetchLog[0]?.cache, 'no-store', 'GET /approvals used the browser default cache mode');
});

await test('F-080 an approval read with an MR-05 cursor still bypasses the browser HTTP cache', async () => {
  reset();
  fetchQueue = [ok([])];
  await api('/approvals?cursor=opaque-next-page', { strict: true });
  assert.match(fetchLog[0]?.url || '', /\/m1\/approvals\?cursor=opaque-next-page$/);
  assert.equal(fetchLog[0]?.cache, 'no-store', 'a query-bearing approval route used the default cache mode');
});

// ── Result ──────────────────────────────────────────────────────────────────

console.log(`\nMS-13 approvals: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
