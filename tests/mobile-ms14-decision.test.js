// MS-14 — deciding an approval ★ (SCREENS §4 MS-14, MD-07, MD-12, MD-19, R-3)
// ==============================================================================
//
// SCREENS calls this the most valuable and most dangerous flow in the app, and
// names three rules that make it what it should be:
//
//   1. one decides only about state just loaded from the server;
//   2. the decision is bound to the fingerprint of the payload that was shown —
//      if the payload moved, the agreement is void;
//   3. a second send is a recognisable conflict, not a second approval.
//
// Every test below is one way a single human "yes" could turn into two grants,
// into a grant for something the person never saw, or into a grant nobody
// actually gave.  The two that matter most:
//
//   * no control on this screen re-sends anything.  SS-10 forbids automatic
//     retry, and "zkusit znovu" next to an approval is exactly how one grant
//     becomes two.  What is offered after a failure is a read.
//   * an ambiguous outcome (offline, or a server that could not finish) is
//     never reported as failure and never as success — the operation key stays
//     alive as UNKNOWN and the way out is the recovery screen (MD-19).
//
// Not proven here, same as MS-13/MS-20 (F-043): there is no browser, so
// contrast, real hit targets, focus order and what assistive technology
// announces remain unverified.  The accessibility assertions check the contract
// in the markup, which is necessary and not sufficient.
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
async function flush(rounds = 10) {
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
globalThis.confirm = () => {
  throw new Error('MS-14 must not use a native confirm dialog');
};

let fetchQueue = [];
let fetchLog = [];

globalThis.fetch = async (url, options = {}) => {
  fetchLog.push({
    url: String(url),
    method: options.method || 'GET',
    body: options.body ? JSON.parse(options.body) : null,
    cache: options.cache,
  });
  const next = fetchQueue.shift();
  if (!next) throw new Error(`unexpected request: ${options.method || 'GET'} ${url}`);
  // A response may be held open, so a test can decide the order two in-flight
  // reads come back in — which is the only way to check the ordering guard.
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
  state, store, journal, K, render, navigate,
  loadApprovals, openApproval, decideApproval, approvalDecidable,
  lookupOperation, handleWentOffline, handleCameOnline, invalidateApprovalAuthority,
  newChat,
} = __ms20;

const clickHandler = (listeners.click || [])[0];
assert.ok(clickHandler, 'the client registered no click handler');
const visibilityHandler = (listeners.visibilitychange || [])[0];
assert.ok(visibilityHandler, 'the client registered no visibilitychange handler');

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

function click(act, approvalId = null) {
  const pattern = new RegExp(`data-act="${act}"([^>]*)>`);
  const match = (html() + navHtml()).match(pattern);
  assert.ok(match, `no control with data-act="${act}"`);
  assert.ok(!/\bdisabled\b/.test(match[1]), `control ${act} is disabled`);
  const target = { dataset: { act, approval: approvalId ?? undefined } };
  target.closest = () => target;
  clickHandler({ target });
}

const MINUTE = 60_000;
const FINGERPRINT = 'f'.repeat(64);

function approval(overrides = {}) {
  return {
    id: 'ap-1',
    subjectType: 'lifecycle.checkpoint',
    subjectId: 'run-9',
    title: 'Schválit zápis do src/server.js',
    detail: 'Milestone M3 chce zapsat 2 soubory.',
    payloadFingerprint: FINGERPRINT,
    createdAt: Date.now() - 3 * MINUTE,
    expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString(),
    expired: false,
    version: 'v1:abc',
    ...overrides,
  };
}

const FULL_SCOPES = ['read:chat', 'write:chat', 'read:approvals', 'write:approvals'];

function reset({ scopes = FULL_SCOPES } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  store.set(K.journal, []);
  state.session = 'active';
  state.route = 'approvals';
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
  document.visibilityState = 'visible';
}

/** Open the decision screen on a confirmed, decidable approval. */
async function openDecidable(overrides = {}) {
  fetchQueue = [ok([approval(overrides)])];
  openApproval('ap-1');
  await flush();
  fetchLog = [];
}

const decideCalls = () => fetchLog.filter(entry => /\/decide$/.test(entry.url));

console.log('\n=== MS-14 approval decision ★ (SCREENS §4) ===');

// ── 1. Rule 1 — only freshly loaded state is decidable ──────────────────────

await test('SS-01 opening the screen re-reads from the server before offering anything', async () => {
  reset();
  fetchQueue = [ok([approval()])];
  openApproval('ap-1');
  assert.equal(state.approvalVerifiedAt, null, 'the screen claimed verification before the load');
  await flush();
  assert.ok(state.approvalVerifiedAt, 'a confirmed load did not verify the approval');
  assert.match(html(), /data-act="approval-approve"/);
});

await test('SS-01 a list carried over from the queue is withdrawn and does not authorise deciding', async () => {
  // The dangerous case: the queue was loaded a moment ago, so the payload is
  // available when the decision screen opens.  Rule 1 says that list is still
  // not what one decides on — it is withdrawn while the screen re-verifies, and
  // neither the payload nor the controls are published until the answer lands.
  reset();
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.ok(Array.isArray(state.data.approvals), 'precondition: the queue is loaded');

  fetchQueue = [ok([approval()])];
  openApproval('ap-1');
  assert.doesNotMatch(html(), /Schválit zápis do src\/server\.js/, 'the prior payload stayed published during re-verification');
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'approve was offered before re-verification');
  await flush();
  assert.match(html(), /Schválit zápis do src\/server\.js/, 'the verified payload never came back');
  assert.match(html(), /data-act="approval-approve"/, 'the control never came back after verifying');
});

await test('SS-01 the remaining window is visible from the start, at the length the server set', async () => {
  reset();
  // §14 — the countdown needs a confirmed offset; F-100 — the *length* of the
  // window is read from the server's own two timestamps rather than typed into
  // the client.  DR-011 is 5 minutes local and 15 remote, and the design that
  // showed 10 matched neither: a number a person can type is a number that
  // drifts from the contract.
  state.serverOffsetMs = 0;
  await openDecidable({
    createdAt: Date.now() - 3 * MINUTE,
    expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString(),
  });
  assert.match(html(), /zbývá 12 min z 15minutového okna/);
});

await test('F-100 the client states the window the server set, never a constant', async () => {
  reset();
  state.serverOffsetMs = 0;
  // The same approval under the local half of DR-011: five minutes, not fifteen.
  await openDecidable({
    createdAt: Date.now() - MINUTE,
    expiresAt: new Date(Date.now() + 4 * MINUTE).toISOString(),
  });
  assert.match(html(), /zbývá 4 min z 5minutového okna/,
    'the client reported a window length the server never declared');
  assert.doesNotMatch(html(), /15minutového/, 'a hard-coded window survived');
});

await test('§14 without a confirmed server offset the countdown is words, not numbers', async () => {
  reset();
  state.serverOffsetMs = null;
  await openDecidable({ expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString() });
  assert.match(html(), /vyprší brzy/);
  assert.doesNotMatch(html(), /zbývá \d+ min/,
    'a countdown was computed from a phone clock the client has not confirmed');
  assert.match(html(), /data-act="approval-approve"/,
    '§14 says an unknown offset must not deactivate the decision');
});

await test('SS-05 a failed reload withdraws the decision control until re-verified', async () => {
  reset();
  await openDecidable();
  assert.match(html(), /data-act="approval-approve"/);

  fetchQueue = [offline()];
  await loadApprovals();
  assert.equal(state.approvalVerifiedAt, null, 'verification survived a failed load');
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'deciding stayed possible after a failed load');
});

await test('rule 1 deciding without a verified load is refused and sends nothing', async () => {
  reset();
  await openDecidable();
  state.approvalVerifiedAt = null;
  await decideApproval('approve');
  assert.equal(decideCalls().length, 0, 'an unverified decision was sent');
  assert.match(html(), /neověřil/i);
});

await test('SS-01 an approval missing its fingerprint is never decidable', async () => {
  reset();
  await openDecidable({ payloadFingerprint: null });
  assert.equal(approvalDecidable(state.data.approvals[0]).why, 'fingerprint');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
  assert.match(html(), /otisk/i);
});

// ── 2. Rule 2 — the decision is bound to the fingerprint ────────────────────

await test('rule 2 the decision carries the fingerprint that was on screen', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), ok([])];
  click('approval-approve');
  await flush();

  const call = decideCalls()[0];
  assert.ok(call, 'no decision was sent');
  assert.equal(call.method, 'POST');
  assert.equal(call.body.payloadFingerprint, FINGERPRINT);
  assert.equal(call.body.decision, 'approve');
  assert.ok(call.body.operationId, 'the decision carried no operation key');
});

await test('rule 2 a superseded payload voids the decision and says what happened', async () => {
  reset();
  await openDecidable();
  fetchQueue = [
    fail(409, { code: 'approval_superseded', expected: 'other', operationId: 'op' }),
    ok([approval({ payloadFingerprint: 'a'.repeat(64) })]),
  ];
  click('approval-approve');
  await flush();
  assert.match(html(), /propadlo/i);
  assert.match(html(), /než co jsi viděl/i, 'the screen did not say why the decision is void');
});

await test('rule 2 a voided decision is not re-sent under the new fingerprint', async () => {
  reset();
  await openDecidable();
  fetchQueue = [
    fail(409, { code: 'approval_superseded' }),
    ok([approval({ payloadFingerprint: 'a'.repeat(64) })]),
  ];
  click('approval-approve');
  await flush();
  assert.equal(decideCalls().length, 1, 'the client decided again on the new payload by itself');
});

// ── 3. Rule 3 — a second send is a conflict, not a second approval ──────────

await test('rule 3 an operation-key conflict is reported as a conflict', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(409, { code: 'operation_conflict', reason: 'payload_mismatch' })];
  click('approval-reject');
  await flush();
  assert.match(html(), /Konflikt klíče operace/);
  assert.match(html(), /není druhé schválení/);
});

await test('SS-10 a replayed decision is described as a repeat, never as a new grant', async () => {
  reset();
  await openDecidable();
  fetchQueue = [
    {
      status: 200,
      body: {
        ok: true,
        data: {
          approvalId: 'ap-1',
          state: 'CONFIRMED',
          result: { approvalId: 'ap-1', decision: 'approve' },
        },
        replayed: true,
      },
    },
    ok([]),
  ];
  click('approval-approve');
  await flush();
  assert.match(html(), /ze záznamu, ne druhé schválení/);
  assert.doesNotMatch(html(), /^Schváleno\.$/m, 'a replay was announced as a fresh approval');
});

await test('SS-10 every decision mints its own key — two decisions never share one', async () => {
  reset();
  await openDecidable();
  // A 500 is a *definite* refusal: the server answered and did not apply it, so
  // the key is closed and a second conscious decision is allowed to exist.  The
  // ambiguous case is the opposite and is covered by F-056 below.
  fetchQueue = [fail(500, { code: 'internal_error' })];
  click('approval-approve');
  await flush();
  const first = decideCalls()[0].body.operationId;

  // The failure withdrew the authority (F-063), so deciding again starts from a
  // conscious re-entry — not from a list that happened to refresh underneath.
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), ok([])];
  click('approval-approve');
  await flush();
  const second = decideCalls()[0].body.operationId;
  assert.notEqual(first, second, 'a second conscious decision reused the first key');
});

// ── 4. No retry, ever ───────────────────────────────────────────────────────

await test('SS-10 the screen offers no retry control after any failure', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(500, { code: 'internal_error' })];
  click('approval-approve');
  await flush();
  assert.doesNotMatch(html(), /data-act="approval-retry"/);
  assert.doesNotMatch(html(), /zkusit znovu|opakovat odeslání/i);
});

await test('SS-08 a failure does not hint that anything will be attempted again', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(500, { code: 'internal_error' })];
  click('approval-approve');
  await flush();
  assert.match(html(), /Znovu se nic neposílá/);
});

await test('a failed decision sends exactly once', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(500, { code: 'internal_error' })];
  click('approval-approve');
  await flush();
  assert.equal(decideCalls().length, 1);
});

// ── 5. I-4 / SS-03 — never queued ───────────────────────────────────────────

await test('SS-03 offline the decision is never queued for later', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  assert.doesNotMatch(html(), /odešle se pozděj|ve frontě|až budeš online/i);
});

await test('MD-19 an offline decision keeps its key alive as UNKNOWN', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();

  const open = journal.open();
  assert.equal(open.length, 1, 'the ambiguous decision left no recoverable key');
  assert.equal(open[0].lastKnownState, 'UNKNOWN');
  assert.equal(open[0].operationType, 'approval.decide');
});

await test('MD-19 an ambiguous decision is reported as unknown, not as failed', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  assert.match(html(), /není jisté, jestli rozhodnutí dorazilo/);
  assert.match(html(), /Nerozřešených pokusech/, 'the way out was not named');
});

await test('MD-19 a server that could not finish is also unknown, with its reason kept', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(503, {
    code: 'server_unavailable', state: 'UNKNOWN',
    reason: 'result_persistence_failed', operationId: 'x',
  })];
  click('approval-approve');
  await flush();

  const open = journal.open();
  assert.equal(open.length, 1);
  assert.equal(open[0].unknownReason, 'result_persistence_failed');
  assert.match(html(), /výsledek je neznámý/i);
});

await test('MD-19 the journal entry never carries the approval content', async () => {
  reset();
  await openDecidable({ detail: 'CITLIVY-DETAIL-XYZ' });
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  const blob = JSON.stringify(journal.all());
  assert.doesNotMatch(blob, /CITLIVY-DETAIL-XYZ/, 'the payload leaked into the journal');
  assert.doesNotMatch(blob, /f{64}/, 'the fingerprint was persisted in the journal');
});

// ── 6. SS-09 — expiry and decided-elsewhere ─────────────────────────────────

await test('R-3 an expired approval offers no decision and no extension', async () => {
  reset();
  await openDecidable({ expired: true });
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
  assert.match(html(), /Prodloužit ho nelze/);
  assert.match(html(), /nový požadavek/);
});

await test('SS-09 expiry racing the decision discards it and refuses to extend', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(409, { code: 'approval_expired', operationId: 'x' }), ok([])];
  click('approval-approve');
  await flush();
  assert.match(html(), /Okno vypršelo/);
  assert.match(html(), /Prodloužit ho nelze/);
});

await test('SS-09 an approval decided elsewhere discards this decision', async () => {
  reset();
  await openDecidable();
  fetchQueue = [
    fail(409, { code: 'state_conflict', reason: 'already_decided', decision: 'reject' }),
    ok([]),
  ];
  click('approval-approve');
  await flush();
  assert.match(html(), /rozhodnut jinde/i);
  assert.match(html(), /zahodilo/i);
});

await test('SS-09 an approval that vanished from the queue shows no decision control', async () => {
  reset();
  fetchQueue = [ok([])];
  openApproval('ap-1');
  await flush();
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
  assert.match(html(), /už není otevřený/i);
});

// ── 7. SS-07 — scope, fail-closed ───────────────────────────────────────────

await test('SS-07 read-only scope shows the request but never a decision control', async () => {
  reset({ scopes: ['read:chat', 'read:approvals'] });
  await openDecidable();
  assert.match(html(), /Schválit zápis do src\/server\.js/, 'the preview itself must remain');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
  assert.match(html(), /write:approvals/);
});

await test('SS-07 a device without write:approvals cannot decide even by calling in', async () => {
  reset({ scopes: ['read:chat', 'read:approvals'] });
  await openDecidable();
  await decideApproval('approve');
  assert.equal(decideCalls().length, 0, 'a scopeless device sent a decision');
});

await test('SS-07 without read:approvals the screen shows nothing of the request', async () => {
  reset({ scopes: ['read:chat'] });
  state.route = 'approval';
  state.approvalId = 'ap-1';
  render();
  assert.match(html(), /read:approvals/);
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

// ── 8. SS-06 — leaving discards the decision ────────────────────────────────

await test('SS-06 leaving the screen drops the decision in progress', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok([approval()])];
  navigate('approvals');
  await flush();
  assert.equal(state.approvalId, null);
  assert.equal(state.approvalVerifiedAt, null, 'verification followed the user off the screen');
});

await test('SS-06 revocation clears the request from memory too', async () => {
  reset();
  await openDecidable({ detail: 'CITLIVY-DETAIL-XYZ' });
  fetchQueue = [fail(401, { code: 'token_revoked' })];
  await loadApprovals();
  assert.equal(state.approvalId, null);
  assert.equal(state.data.approvals, undefined);
  assert.doesNotMatch(html(), /CITLIVY-DETAIL-XYZ/);
});

await test('MD-07 the request being decided is never written to device storage', async () => {
  reset();
  await openDecidable({ detail: 'CITLIVY-DETAIL-XYZ' });
  const stored = Object.keys(localStorage)
    .map(key => `${key}=${localStorage.getItem(key)}`).join('\n');
  assert.doesNotMatch(stored, /CITLIVY-DETAIL-XYZ/);
  assert.doesNotMatch(stored, /f{64}/);
});

// ── 9. Success path ─────────────────────────────────────────────────────────

await test('a confirmed decision records the state and returns to a re-read queue', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), ok([])];
  click('approval-approve');
  await flush();

  assert.equal(journal.open().length, 0, 'a confirmed decision left an open key');
  assert.equal(state.route, 'approvals');
  assert.match(html(), /Schváleno/);
  assert.equal(fetchLog.filter(entry => entry.method === 'GET').length, 1, 'the queue was not re-read');
});

await test('rejecting sends reject, not approve', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'reject', state: 'CONFIRMED' }), ok([])];
  click('approval-reject');
  await flush();
  assert.equal(decideCalls()[0].body.decision, 'reject');
  assert.match(html(), /Zamítnuto/);
});

// ── 10. Accessibility contract in the markup ────────────────────────────────

await test('§10 approve and reject are the same size — the layout holds no opinion', async () => {
  reset();
  await openDecidable();
  const css = (await import('node:fs')).readFileSync('src/mobile/client/app.css', 'utf8');
  assert.match(css, /\.appr-actions \.btn \{ flex: 1; min-height: 48px; \}/);
});

await test('§10 the outcome of a decision is announced, not only coloured', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(500, { code: 'internal_error' })];
  click('approval-approve');
  await flush();
  assert.match(html(), /class="appr-note" data-tone="danger" role="status"/);
});

await test('§10 why deciding is unavailable is stated in words, not by absence', async () => {
  reset();
  await openDecidable({ expired: true });
  assert.match(html(), /class="appr-blocked" role="status"/);
});

// ── 11. F-056 — an ambiguous outcome is not a licence for a second key ──────
//
// The reviewers' central objection: the first suite proved that an ambiguous
// decision *keeps* its key, and then never asked what happens when the user
// taps again.  Both halves of MD-19 rule 3 have to hold — the key survives, and
// nothing may mint a second one for the same conscious act.  A retry is not a
// retry if it carries a different key; it is a second grant.

await test('F-056 an ambiguous decision cannot be decided again at all', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN', 'precondition: the key is ambiguous');

  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'approve survived an ambiguous outcome');
  assert.doesNotMatch(html(), /data-act="approval-reject"/, 'reject survived an ambiguous outcome');

  await decideApproval('approve');
  assert.equal(decideCalls().length, 1, 'a second decision was sent after an ambiguous one');
  assert.equal(journal.all().length, 1, 'a second operation key was minted for one conscious decision');
});

await test('F-056 the ambiguous screen sends the user to the read, not to a resend', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  await decideApproval('reject');
  assert.match(html(), /Nerozřešených pokusech/, 'the recovery route is not named');
  assert.doesNotMatch(html(), /zkusit znovu|odeslat znovu|opakovat/i, 'a resend was offered');
});

await test('F-056 a fresh confirmed read does not unblock an ambiguous decision', async () => {
  // The isolating case, and the realistic one.  The two tests above are also
  // satisfied by the authority invalidation of F-063, so on their own they do
  // not prove that the *key* is what blocks.  Here the user does everything
  // right afterwards — reconnects, consciously re-reads, and the server still
  // lists the approval as undecided — so the authority is legitimately back.
  // The ambiguity is not, because it never was about the screen: the decision
  // may already be recorded on the server, and a second key would be a second
  // grant from one human "yes".
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN', 'precondition: ambiguous');

  fetchQueue = [ok([approval()])];
  click('approval-reread');
  await flush();
  assert.ok(Array.isArray(state.data.approvals), 'precondition: the re-read was confirmed');
  assert.ok(state.data.approvals.some(row => row.id === 'ap-1'), 'precondition: still undecided per the server');

  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'a fresh read re-armed an ambiguous decision');
  await decideApproval('approve');
  assert.equal(decideCalls().length, 1, 'a fresh read licensed a second decision');
  assert.equal(journal.all().length, 1, 'a second operation key was minted after a fresh read');
  assert.match(html(), /Nerozřešených pokusech/);
});

await test('F-056 the block is on the ambiguous key, not on the approval forever', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  const stuck = journal.open()[0].operationId;

  // MS-20's read is the authoritative way out: it resolves the key, and only
  // then does a conscious new decision become possible again.
  fetchQueue = [
    ok({ operationId: stuck, known: true, state: 'REJECTED' }),
    ok([], { open: 0, limit: 32, atLimit: false }),
  ];
  await lookupOperation(stuck);
  assert.equal(journal.find(stuck).lastKnownState, 'REJECTED', 'precondition: the key resolved');

  fetchQueue = [ok([approval()])];
  click('approval-reread');
  await flush();
  assert.match(html(), /data-act="approval-approve"/, 'a resolved key left the approval permanently blocked');

  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), ok([])];
  click('approval-approve');
  await flush();
  const keys = new Set(decideCalls().map(entry => entry.body.operationId));
  assert.equal(keys.size, 2, 'the new conscious decision did not mint its own key');
});

// ── 12. F-061 / F-063 — where the right to decide comes from and dies ───────
//
// The grant is not a property of the app.  It belongs to one confirmed read, of
// one approval, on one open screen, and it does not outlive anything.

await test('F-061 a background queue load does not authorise an open decision screen', async () => {
  reset();
  fetchQueue = [offline()];
  openApproval('ap-1');
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'precondition: nothing is authorised yet');

  // The kind of load nobody asked for on behalf of this screen: the drawer
  // count, the boot read, the refresh that follows some other action.
  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.equal(state.approvalVerifiedAt, null, 'a background load granted the decision authority');
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'a background load put the buttons on screen');
});

await test('F-061 a background load does not refresh an authority it did not grant', async () => {
  reset();
  await openDecidable();
  assert.ok(state.approvalVerifiedAt, 'precondition: the opening read granted');

  fetchQueue = [ok([approval()])];
  await loadApprovals();
  assert.equal(state.approvalVerifiedAt, null, 'a background load extended the grant');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-061 the reload after a voided decision never re-arms the buttons', async () => {
  reset();
  await openDecidable();
  // The payload moved.  The reload that follows shows the new one — and the new
  // one is exactly what the user has not read yet.
  fetchQueue = [
    fail(409, { code: 'approval_superseded' }),
    ok([approval({ payloadFingerprint: 'a'.repeat(64), detail: 'ÚPLNĚ JINÉ ZADÁNÍ' })]),
  ];
  click('approval-approve');
  await flush();
  assert.match(html(), /ÚPLNĚ JINÉ ZADÁNÍ/, 'the new payload is on screen');
  assert.equal(state.approvalVerifiedAt, null, 'the voided decision left the screen authorised');
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'approve was armed for a payload never read');
});

await test('F-061 an explicit read on the screen is what re-arms it', async () => {
  reset();
  await openDecidable();
  fetchQueue = [
    fail(409, { code: 'approval_superseded' }),
    ok([approval({ payloadFingerprint: 'a'.repeat(64) })]),
  ];
  click('approval-approve');
  await flush();

  fetchQueue = [ok([approval({ payloadFingerprint: 'a'.repeat(64) })])];
  click('approval-reread');
  await flush();
  assert.match(html(), /data-act="approval-approve"/, 'a conscious read did not restore the control');

  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), ok([])];
  click('approval-approve');
  await flush();
  const last = decideCalls().at(-1);
  assert.equal(last.body.payloadFingerprint, 'a'.repeat(64), 'the decision carried the old fingerprint');
});

await test('F-063 an ambiguous server outcome withdraws the decision authority', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(503, {
    code: 'server_unavailable', state: 'UNKNOWN', reason: 'result_persistence_failed',
  })];
  click('approval-approve');
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'an ambiguous outcome left the screen authorised');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-063 a definite failure also withdraws the decision authority', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(500, { code: 'internal_error' })];
  click('approval-approve');
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'a failed decision left the screen authorised');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-063 going offline invalidates the grant and the queue behind it', async () => {
  reset();
  await openDecidable();
  assert.ok(state.approvalVerifiedAt);
  handleWentOffline();
  assert.equal(state.approvalVerifiedAt, null, 'the grant survived going offline');
  assert.equal(state.data.approvals, undefined, 'the queue survived going offline');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-063 a reconnect does not carry a grant across the gap', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok([approval()])];
  handleCameOnline();
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'the grant survived a reconnect');
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'a reconnect re-armed the decision by itself');
});

await test('F-063 leaving the screen kills a grant that is still in flight', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [{ ...ok([approval()]), gate }];
  openApproval('ap-1');
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'precondition: the read has not landed');

  fetchQueue.push(ok([approval()]));
  navigate('approvals');
  release();
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'a read that landed after the exit granted anyway');
  assert.equal(state.approvalId, null);
});

await test('F-063 an invalidation during the read cancels the grant that read was for', async () => {
  // The case the ordering guard alone does not catch: nothing newer was
  // started, so the read is still the newest one and will publish — but the
  // authority it was going to establish was revoked while it was on the wire,
  // by something that happened elsewhere in the app (a failure on another
  // request flipping the connection, an auth event, a lifecycle transition).
  // The list may still be published; the grant may not.
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [{ ...ok([approval()]), gate }];
  openApproval('ap-1');
  await flush();
  assert.equal(state.approvalVerifiedAt, null, 'precondition: the read has not landed');

  invalidateApprovalAuthority();
  release();
  await flush();

  assert.ok(Array.isArray(state.data.approvals), 'the newest read was allowed to publish its list');
  assert.equal(state.approvalVerifiedAt, null, 'a revoked authority was re-established by an older read');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

// ── 13. F-064 — an ambiguous own attempt is not somebody else's decision ────

await test('F-064 an own unresolved attempt is never reported as decided elsewhere', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN', 'precondition: ambiguous');

  // The row is gone from the queue — most likely because our own attempt landed.
  fetchQueue = [ok([])];
  navigate('approvals');
  await flush();
  assert.doesNotMatch(html(), /rozhodnut jinde/i, 'our own ambiguous attempt was blamed on someone else');
});

await test('F-064 the note says what is actually known and where to resolve it', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  fetchQueue = [ok([])];
  navigate('approvals');
  await flush();
  assert.match(html(), /vlastní pokus/i, 'the note does not mention the attempt it could have been');
  assert.match(html(), /Nerozřešených pokusech/, 'the note does not point at the recovery screen');
});

await test('F-064 a genuine decision elsewhere is still reported as one', async () => {
  // The negative control for the two above: the suppression is tied to *having*
  // an unresolved attempt, not to being on this screen.
  reset();
  fetchQueue = [ok([approval({ id: 'ap-1' }), approval({ id: 'ap-2', title: 'Druhý' })])];
  await loadApprovals();
  fetchQueue = [ok([approval({ id: 'ap-2', title: 'Druhý' })])];
  await loadApprovals();
  assert.match(html(), /rozhodnut jinde/i, 'a real decision elsewhere stopped being reported');
});

// ── 14. F-059 / F-062 — only an exact, valid 200 decides anything ───────────

await test('F-062 a 200 with no decision envelope leaves the key open as UNKNOWN', async () => {
  reset();
  await openDecidable();
  fetchQueue = [{ status: 200, body: { ok: true } }];
  click('approval-approve');
  await flush();
  assert.equal(journal.open().length, 1, 'a malformed 200 closed the only recovery handle');
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN');
  assert.doesNotMatch(html(), /Schváleno/, 'a malformed 200 was announced as an approval');
  assert.match(html(), /Nerozřešených pokusech/);
});

await test('F-062 a 200 carrying an unrecognised state does not overwrite the record', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'DONE' })];
  click('approval-approve');
  await flush();
  assert.equal(journal.open().length, 1, 'an invented state resolved the attempt');
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN');
});

await test('F-062 a 200 about a different approval decides nothing here', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-99', decision: 'approve', state: 'CONFIRMED' })];
  click('approval-approve');
  await flush();
  assert.doesNotMatch(html(), /Schváleno/, 'an answer about another approval was taken as this one');
  assert.equal(journal.open().length, 1);
});

await test('F-059 a 202 is a protocol failure, not a decision', async () => {
  reset();
  await openDecidable();
  fetchQueue = [{ status: 202, body: { ok: true, data: { approvalId: 'ap-1', state: 'CONFIRMED' } } }];
  click('approval-approve');
  await flush();
  assert.doesNotMatch(html(), /Schváleno/, 'a 202 established a decision');
  assert.equal(journal.open().length, 1, 'a 202 closed the recovery handle');
});

await test('F-059 a 2xx without ok:true is not authoritative either', async () => {
  reset();
  await openDecidable();
  fetchQueue = [{ status: 200, body: { data: { approvalId: 'ap-1', state: 'CONFIRMED' } } }];
  click('approval-approve');
  await flush();
  assert.doesNotMatch(html(), /Schváleno/);
  assert.equal(journal.open().length, 1);
});

await test('F-059 a replay that is still unresolved is not announced as a grant', async () => {
  reset();
  await openDecidable();
  fetchQueue = [{
    status: 200,
    body: { ok: true, data: { approvalId: 'ap-1', state: 'UNKNOWN', result: null }, replayed: true },
  }];
  click('approval-approve');
  await flush();
  assert.doesNotMatch(html(), /Schváleno/, 'an unresolved replay was announced as approved');
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN');
});

// ── 15. F-066 — adversarial consent ────────────────────────────────────────

await test('F-066 a hand-fired approve click cannot bypass the gate', async () => {
  reset();
  await openDecidable();
  state.approvalVerifiedAt = null;
  const target = { dataset: { act: 'approval-approve' } };
  target.closest = () => target;
  clickHandler({ target });
  await flush();
  assert.equal(decideCalls().length, 0, 'the click handler decided without the gate');
});

await test('F-066 a decision cannot be aimed at an approval that is not on screen', async () => {
  reset();
  await openDecidable();
  state.approvalId = 'ap-99';
  await decideApproval('approve');
  assert.equal(decideCalls().length, 0, 'a decision was sent for an approval never shown');
});

await test('F-066 an expired approval refuses the decision even when called directly', async () => {
  reset();
  await openDecidable({ expired: true });
  await decideApproval('approve');
  assert.equal(decideCalls().length, 0, 'an expired approval was decided');
});

await test('F-066 a double tap sends one decision, not two', async () => {
  reset();
  await openDecidable();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [
    { ...ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), gate },
    ok([]),
  ];
  const first = decideApproval('approve');
  const second = decideApproval('approve');
  release();
  await first; await second; await flush();
  assert.equal(decideCalls().length, 1, 'a double tap produced two grants');
});

// ── 16. RV-024/RV-025 approval lifecycle regressions ───────────────────────

await test('F-089 new-chat exit revokes authority and direct submission stays fail-closed', async () => {
  reset();
  await openDecidable();
  assert.ok(state.approvalVerifiedAt, 'precondition: the approval is verified');

  // D-UI-3 removed the drawer, so "Nová konverzace" is no longer offered from
  // the approval screen itself.  The exit under test is unchanged and is
  // invoked where it happens — *while the approval route is still open* —
  // because pre-leaving the route first would let the route gate pass this
  // test without the authority ever being revoked.
  assert.equal(state.route, 'approval', 'precondition: the exit is taken from the approval route');
  newChat();
  assert.equal(state.route, 'chat');
  assert.equal(state.approvalVerifiedAt, null, 'new chat retained the verification grant');
  fetchLog = [];
  await decideApproval('approve');
  assert.equal(decideCalls().length, 0, 'a decision was emitted after leaving the approval route');
});

await test('F-090 cold restart blocks every new decision while an unassociated approval key is open', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  const original = journal.open()[0];
  assert.equal(original.operationType, 'approval.decide', 'precondition: an approval attempt is open');

  // A real cold process keeps localStorage (and therefore MD-19), while all
  // volatile approval state disappears.  Recreate exactly that boundary.
  state.approvalAttempts = {};
  state.approvalId = null;
  state.approvalVerifiedAt = null;
  state.approvalNote = null;
  state.route = 'approvals';
  state.data = {};
  state.error = {};
  state.loading = {};

  fetchQueue = [ok([approval()])];
  openApproval('ap-1');
  await flush();
  assert.doesNotMatch(html(), /data-act="approval-approve"/, 'a cold process re-armed approval authority');

  fetchLog = [];
  await decideApproval('approve');
  assert.equal(decideCalls().length, 0, 'a cold process emitted a second approval decision');
  assert.equal(journal.open().length, 1, 'a cold process minted a second operation key');
  assert.equal(journal.open()[0].operationId, original.operationId);
  assert.match(html(), /Nerozřešených pokusech/, 'the fail-closed state did not route to MS-20');
});

await test('F-091 a confirmed MS-20 lookup preserves own attribution after volatile state is gone', async () => {
  reset();
  await openDecidable();
  fetchQueue = [offline()];
  click('approval-approve');
  await flush();
  const operationId = journal.open()[0].operationId;

  // Force lookup attribution to come from the frozen operation result, not the
  // process-local approvalAttempts map.
  state.approvalAttempts = {};
  fetchQueue = [
    ok({
      operationId,
      known: true,
      state: 'CONFIRMED',
      operationType: 'approval.decide',
      result: { approvalId: 'ap-1', decision: 'approve' },
    }),
    ok([], { open: 0, limit: 32, atLimit: false }),
  ];
  await lookupOperation(operationId);

  fetchQueue = [ok([])];
  await loadApprovals();
  assert.equal(state.approvalsDecidedHere['ap-1'], true, 'the confirmed own result lost its attribution');
  assert.doesNotMatch(html(), /rozhodnut jinde/i, 'the client attributed its own confirmed decision elsewhere');
});

await test('F-092 a contradictory fresh decision envelope remains UNKNOWN', async () => {
  reset();
  await openDecidable();
  fetchQueue = [
    ok({ approvalId: 'ap-1', decision: 'reject', state: 'CONFIRMED' }),
    ok([]),
  ];
  click('approval-approve');
  await flush();

  assert.equal(journal.open().length, 1, 'a contradictory decision closed the recovery handle');
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN');
  assert.doesNotMatch(html(), /Schváleno\./, 'approve was announced from a reject response');
  assert.match(html(), /Nerozřešených pokusech/);
});

await test('F-092 a replay requires the original nested result and requested decision', async () => {
  reset();
  await openDecidable();
  let attemptedOperationId = null;
  fetchQueue = [{
    status: 200,
    body: {
      ok: true,
      replayed: true,
      data: {
        approvalId: 'ap-1',
        state: 'CONFIRMED',
        result: { approvalId: 'ap-1', decision: 'reject' },
      },
    },
  }];
  click('approval-approve');
  attemptedOperationId = decideCalls()[0]?.body.operationId;
  await flush();

  assert.equal(journal.find(attemptedOperationId)?.lastKnownState, 'UNKNOWN', 'a contradictory replay resolved the attempt');
  assert.doesNotMatch(html(), /ze záznamu, ne druhé schválení/);
});

await test('F-080 approval decisions explicitly bypass the browser HTTP cache', async () => {
  reset();
  await openDecidable();
  fetchQueue = [ok({ approvalId: 'ap-1', decision: 'approve', state: 'CONFIRMED' }), ok([])];
  click('approval-approve');
  await flush();
  assert.equal(decideCalls()[0]?.cache, 'no-store', 'POST /approvals/:id/decide used the default cache mode');
});

await test('F-093 background revokes the grant and withdraws the approval surface', async () => {
  reset();
  await openDecidable();
  document.visibilityState = 'hidden';
  await visibilityHandler();

  assert.equal(state.approvalVerifiedAt, null, 'the grant survived backgrounding');
  assert.equal(state.data.approvals, undefined, 'approval data survived backgrounding');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-093 a verification read landing in the background cannot publish or grant', async () => {
  reset();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  fetchQueue = [{ ...ok([approval()]), gate }];
  openApproval('ap-1');
  await flush();

  document.visibilityState = 'hidden';
  await visibilityHandler();
  release();
  await flush();

  assert.equal(state.data.approvals, undefined, 'a pre-background read published after the lifecycle exit');
  assert.equal(state.approvalVerifiedAt, null, 'a pre-background read granted after the lifecycle exit');
});

await test('F-093 foreground reconciles and refreshes without restoring decision authority', async () => {
  reset();
  await openDecidable();
  document.visibilityState = 'hidden';
  await visibilityHandler();

  fetchLog = [];
  fetchQueue = [
    ok({ status: 'ok' }),
    ok({ scopes: FULL_SCOPES, device: { id: 'device-1' } }),
    ok([approval()]),
  ];
  document.visibilityState = 'visible';
  await visibilityHandler();
  await flush();

  assert.ok(fetchLog.some(entry => /\/health$/.test(entry.url)), 'foreground skipped health reconciliation');
  assert.ok(fetchLog.some(entry => /\/capabilities$/.test(entry.url)), 'foreground skipped scope reconciliation');
  assert.ok(fetchLog.some(entry => /\/approvals$/.test(entry.url)), 'foreground skipped the fresh approval read');
  assert.equal(state.approvalVerifiedAt, null, 'foreground refresh silently restored decision authority');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-093 a foreground reconciliation superseded by background cannot start an approval read', async () => {
  reset();
  await openDecidable();
  document.visibilityState = 'hidden';
  await visibilityHandler();

  let releaseHealth;
  const healthGate = new Promise(resolve => { releaseHealth = resolve; });
  fetchLog = [];
  fetchQueue = [
    { ...ok({ status: 'ok' }), gate: healthGate },
    ok({ scopes: FULL_SCOPES, device: { id: 'device-1' } }),
  ];
  document.visibilityState = 'visible';
  const foreground = visibilityHandler();
  await flush();

  document.visibilityState = 'hidden';
  await visibilityHandler();
  releaseHealth();
  await foreground;

  assert.ok(fetchLog.some(entry => /\/health$/.test(entry.url)), 'precondition: foreground reconciliation did not start');
  assert.equal(fetchLog.filter(entry => /\/approvals$/.test(entry.url)).length, 0,
    'a superseded foreground flow started an approval read in the background');
  assert.equal(state.approvalVerifiedAt, null);
  assert.equal(state.data.approvals, undefined);
});

await test('F-094 operation-conflict cancellation depends on the direct decision guard', async () => {
  reset();
  await openDecidable();
  fetchQueue = [fail(409, { code: 'operation_conflict', reason: 'payload_mismatch' })];
  click('approval-approve');
  await flush();

  assert.equal(state.conn, 'ok', 'the scenario unexpectedly exercised the connection guard');
  assert.equal(state.approvalVerifiedAt, null, 'operation_conflict retained authority without direct invalidation');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

await test('F-094 an unrelated server failure depends on the connection guard', async () => {
  reset();
  await openDecidable();
  const operationId = 'a'.repeat(32);
  journal.add({ operationId, operationType: 'chat.send', displaySummary: 'Jiný pokus' });
  fetchQueue = [fail(503, { code: 'server_unavailable' })];
  await lookupOperation(operationId);

  assert.equal(state.approvalVerifiedAt, null, 'an unrelated server failure retained approval authority');
  assert.doesNotMatch(html(), /data-act="approval-approve"/);
});

// ── Result ──────────────────────────────────────────────────────────────────

console.log(`\nMS-14 decision: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
