// Trust bar — UI-DESIGN §4, §4.1, §10, §14 · decision D-UI-2
// ==============================================================================
//
// §4 calls the trust bar "the component the whole design rests on".  The claim
// it makes is not that the bar looks a certain way — it is that three facts can
// never go missing: whether the app is talking to the server, how old what you
// are reading is, and whether part of the screen is closed to this device.
//
// The failure this suite exists to catch is therefore not a layout regression.
// It is the one §4 names outright: *"zapomněl jsem ukázat, že je to z cache"*
// must not be a reachable state of the code.  A convention where every `viewX()`
// remembers to call a helper is exactly that reachable state, one careless view
// later.  So the load-bearing test here is structural — it renders every route
// the router can reach and requires the bar from all of them, without any view
// having asked for it.  Delete the insertion in `render()` and every route in
// that test fails at once; make one view opt out and that route fails alone.
//
// The rest lock down the rules that make the bar honest rather than decorative:
//
//   * empty means something — fresh, online, unlocked renders no bar at all,
//     not an empty strip (§4.1, level "nenápadná": zero height)
//   * SS-03 and SS-08 keep separate wording in zone 1, as they did in the
//     banner this replaced — they lead to different user actions
//   * zone 2 speaks only about a surface that is genuinely cached; MS-13 is
//     never served from cache (MD-07), so it must never carry an age
//   * §14 — no confirmed server offset means words, never numbers, because a
//     time rendered from a clock known to be wrong is worse than "starší data"
//   * §10 — every zone carries an icon and a word, and the whole bar announces
//     itself as one sentence
//
// What this suite does *not* prove (same limit as tests/mobile-ms20-ui.test.js,
// F-043): there is no browser here.  Contrast, the real 32 dp band, focus order
// and what a screen reader actually says remain unverified; what is asserted is
// the contract in the markup and the stylesheet.
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

const nodes = { app: element(), scrim: element(), toasts: element() };
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
globalThis.fetch = async () => { throw new TypeError('this suite renders; it does not call'); };

// ── The client under test ───────────────────────────────────────────────────

const { __ms20 } = await import('../src/mobile/client/app.js');
const { state, store, K, render, trustBar, screenLocks } = __ms20;

const html = () => nodes.app.innerHTML;

const MINUTE = 60_000;
const ALL_SCOPES = ['read:chat', 'write:chat', 'read:notifications', 'read:approvals', 'write:approvals'];

/**
 * The trust bar is not a separate element in this DOM — it is part of the
 * screen `render()` produced, which is the whole point.  So it is read back out
 * of the rendered markup, exactly as a browser would lay it out.
 */
function bar(markup = html()) {
  const match = markup.match(/<div class="trust-bar"[\s\S]*?<\/div>\s*<\/div>/);
  return match ? match[0] : null;
}

function reset({ route = 'conversations', scopes = ALL_SCOPES, conn = 'ok' } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.route = route;
  state.conn = conn;
  state.drawer = false;
  state.conversationId = null;
  state.sending = false;
  state.data = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.serverOffsetMs = 0;
  state.unread = 0;
  state.opsLookup = {};
  state.opsNote = {};
  state.opsConfirm = null;
  state.opsAbandoning = null;
  state.approvalId = null;
  state.approvalVerifiedAt = null;
  body.children.length = 0;
  nodes.app.innerHTML = '';
}

console.log('\n=== Trust bar (UI-DESIGN §4, D-UI-2) ===');

// ── The structural guarantee ────────────────────────────────────────────────

/**
 * Every route the router can reach.  Kept as a literal list rather than derived
 * from the client, so adding a screen without teaching this suite about it is a
 * visible omission instead of an automatic pass.
 */
const ROUTES = ['conversations', 'chat', 'notifications', 'approvals', 'approval', 'operations', 'diagnostics'];

await test('§4 no view can opt out: every route inherits the bar from render(), not from itself', () => {
  const without = [];
  for (const route of ROUTES) {
    reset({ route, conn: 'offline' });
    render();
    if (!bar()) without.push(route);
  }
  assert.deepEqual(without, [],
    `these screens rendered without a trust bar: ${without.join(', ')} — §4 requires every screen to inherit it`);
});

await test('§4 rule 1 the bar sits under the header and pushes content, never over it', () => {
  reset({ route: 'conversations', conn: 'offline' });
  render();
  const markup = html();
  const header = markup.indexOf('</header>');
  const trust = markup.indexOf('<div class="trust-bar"');
  const scroll = markup.indexOf('<div class="scroll"');
  assert.ok(header >= 0, 'the screen under test has no header to sit under');
  assert.ok(trust > header, 'the trust bar rendered above the header');
  assert.ok(scroll > trust, 'the trust bar rendered after the content it must push down');
});

await test('§4 a screen without a header still gets the bar, at the top', () => {
  reset({ route: 'conversations', conn: 'offline' });
  state.session = 'unpaired';
  render();
  const markup = html();
  assert.ok(!markup.includes('</header>'), 'the pairing screen grew a header; pick another headerless screen');
  assert.ok(markup.trimStart().startsWith('<div class="trust-bar"'),
    'a headerless screen must still lead with the trust bar');
});

// ── §4.1 — the ordinary state is invisible ──────────────────────────────────

await test('§4.1 fresh, online and unlocked renders no bar at all — zero height, not an empty strip', () => {
  reset({ route: 'conversations' });
  state.cacheAge.conversations = 'FRESH';
  state.cacheAt.conversations = Date.now();
  render();
  assert.equal(bar(), null, 'an empty trust bar was rendered where §4.1 requires nothing');
  assert.equal(trustBar(), '', 'the component itself must produce nothing in the quiet state');
});

await test('§4.1 a stale copy alone is one quiet line; a lost connection is the expanded level', () => {
  reset({ route: 'conversations' });
  state.cacheAge.conversations = 'STALE';
  state.cacheAt.conversations = Date.now() - 8 * MINUTE;
  render();
  assert.match(bar(), /data-level="quiet"/, 'a stale copy must not escalate to the expanded level');
  assert.ok(!bar().includes('trust-detail'), 'the quiet level must not carry the expanded detail block');

  state.conn = 'offline';
  render();
  assert.match(bar(), /data-level="expanded"/, 'a lost connection must reach the expanded level');
  assert.match(bar(), /trust-detail/, 'the expanded level must state the cause');
});

// ── Zone 1 — connection (SS-03 vs SS-08) ────────────────────────────────────

await test('SS-03 and SS-08 keep separate wording in zone 1, as the banner they replaced did', () => {
  reset({ route: 'conversations', conn: 'offline' });
  render();
  const offline = bar();
  assert.match(offline, /data-zone="conn"/);
  assert.match(offline, /Bez sítě/);

  reset({ route: 'conversations', conn: 'server' });
  render();
  const server = bar();
  assert.match(server, /Server neodpovídá/);
  assert.ok(!server.includes('Bez sítě'), 'an unreachable server must not be reported as no network');
  assert.match(server, /data-act="diagnostics"/, 'SS-08 leads to diagnostics; SS-03 does not');
});

await test('§9 zone 1 never says "✓ online" — a healthy connection is silence', () => {
  reset({ route: 'conversations', conn: 'ok' });
  state.cacheAge.conversations = 'FRESH';
  render();
  assert.equal(bar(), null);
  assert.ok(!html().includes('online'), 'the healthy state must not be announced at all');
});

// ── Zone 2 — age ────────────────────────────────────────────────────────────

await test('§4 zone 2 names the time a stale copy was confirmed', () => {
  reset({ route: 'conversations' });
  const at = Date.now() - 9 * MINUTE;
  state.cacheAge.conversations = 'STALE';
  state.cacheAt.conversations = at;
  render();
  const stamp = new Date(at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  assert.match(bar(), /data-zone="age"/);
  assert.ok(bar().includes(`Data z ${stamp}`), `zone 2 did not name the time; got: ${bar()}`);
});

await test('§4 zone 2 is silent about fresh data — FRESH never produces an age', () => {
  reset({ route: 'conversations' });
  state.cacheAge.conversations = 'FRESH';
  state.cacheAt.conversations = Date.now();
  render();
  assert.equal(bar(), null, 'fresh data must produce no age and therefore no bar');
});

await test('MD-07 the approval queue is never cached, so zone 2 must never claim an age for it', () => {
  reset({ route: 'approvals' });
  // A stale conversations copy is present, and it belongs to another screen.
  state.cacheAge.conversations = 'EXPIRED';
  state.cacheAt.conversations = Date.now() - 40 * MINUTE;
  state.data.approvals = [];
  render();
  const rendered = bar();
  assert.ok(!rendered || !rendered.includes('data-zone="age"'),
    'MS-13 reported a data age; the queue has no cached surface to report');
});

await test('§14 without a confirmed server offset the age is words, never a number', () => {
  reset({ route: 'conversations' });
  state.cacheAge.conversations = 'STALE';
  state.cacheAt.conversations = Date.now() - 9 * MINUTE;
  state.serverOffsetMs = null;
  render();
  assert.match(bar(), /Starší data/);
  assert.ok(!/Data z \d/.test(bar()),
    'a time was rendered from a clock the client has not confirmed (§14)');
});

// ── Zone 3 — permission ─────────────────────────────────────────────────────

await test('§4 zone 3 locks only what the screen in front of the user actually needs', () => {
  reset({ route: 'approvals', scopes: ['read:chat', 'write:chat'] });
  state.data.approvals = [];
  render();
  assert.match(bar(), /data-zone="lock"/, 'a device without read:approvals must see the lock on MS-13');

  reset({ route: 'conversations', scopes: ['read:chat', 'write:chat'] });
  state.cacheAge.conversations = 'FRESH';
  render();
  assert.equal(bar(), null,
    'missing approval scopes locked the conversation list, which does not need them');
});

await test('§4 zone 3 names what is closed, so the lock is not a mystery', () => {
  reset({ route: 'chat', scopes: ['read:chat'] });
  state.conn = 'offline'; // force the expanded level so the detail is rendered
  render();
  assert.match(bar(), /psaní zpráv/, 'the lock must name what this device may not do');
  assert.deepEqual(screenLocks('chat'), ['psaní zpráv']);
  assert.deepEqual(screenLocks('operations'), [], 'MS-20 is not gated by a scope');
});

// ── §4 rule 3 — never two truths ────────────────────────────────────────────

await test('§4 rule 3 a revoked device renders the blocking plane and no bar arguing beside it', () => {
  reset({ route: 'conversations' });
  state.cacheAge.conversations = 'EXPIRED';
  state.cacheAt.conversations = Date.now() - 40 * MINUTE;
  state.session = 'revoked';
  render();
  assert.match(html(), /Zařízení bylo odvoláno/, 'the blocking plane must own the screen');
  assert.equal(bar(), null, 'zone 2 spoke while zone 1 reported revocation (§4 rule 3)');
});

// ── §10 — accessibility contract in the markup ──────────────────────────────

await test('§10 the bar announces itself as one sentence, in the order the zones are read', () => {
  reset({ route: 'chat', scopes: ['read:chat'], conn: 'offline' });
  state.cacheAge.thread = 'STALE';
  state.cacheAt.thread = Date.now() - 9 * MINUTE;
  render();
  const label = bar().match(/aria-label="([^"]+)"/);
  assert.ok(label, 'the trust bar carries no summary for a screen reader');
  const [, summary] = label;
  const order = ['Bez sítě', 'Data z', 'Část obrazovky uzamčena']
    .map(fragment => summary.indexOf(fragment));
  assert.ok(order.every(index => index >= 0), `the summary omitted a zone: ${summary}`);
  assert.deepEqual(order.slice().sort((a, b) => a - b), order,
    `the summary reads the zones out of order: ${summary}`);
  assert.match(bar(), /role="status"/);
});

await test('§10 every zone carries an icon and a word, so colour never carries meaning alone', () => {
  reset({ route: 'chat', scopes: ['read:chat'], conn: 'server' });
  state.cacheAge.thread = 'STALE';
  state.cacheAt.thread = Date.now() - 9 * MINUTE;
  render();
  const zones = bar().match(/<span class="trust-zone"[\s\S]*?<\/span><\/span>/g) || [];
  assert.equal(zones.length, 3, 'expected all three zones on this screen');
  for (const zone of zones) {
    assert.match(zone, /<svg/, `zone without an icon: ${zone}`);
    assert.match(zone, /<span>[^<]+<\/span>/, `zone without a word: ${zone}`);
  }
});

await test('§4 the stylesheet reserves the 32 dp band and never lets the bar overlay content', () => {
  const css = readFileSync(new URL('../src/mobile/client/app.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('.trust-bar'), css.indexOf('/* ── Header'));
  assert.match(block, /min-height:\s*32px/, 'the 32 dp band from §4 is not declared');
  assert.ok(!/\.trust-bar\s*{[^}]*position:\s*(absolute|fixed)/.test(css),
    'the trust bar is positioned out of flow, so it would cover content instead of pushing it');
});

await test('the retired connection banner leaves nothing behind that could show a second truth', () => {
  const markup = readFileSync(new URL('../src/mobile/client/index.html', import.meta.url), 'utf8');
  assert.ok(!markup.includes('id="conn-banner"'),
    'the standalone banner still exists; connection state would be told in two places');
  const client = readFileSync(new URL('../src/mobile/client/app.js', import.meta.url), 'utf8');
  assert.ok(!client.includes('paintBanner'), 'the banner painter survived the move into zone 1');
});

console.log(`\nTrust bar: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
