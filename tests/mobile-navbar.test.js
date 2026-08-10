// Bottom bar — UI-DESIGN §3.1, §3.2, §3.3, §10 · decision D-UI-3
// ==============================================================================
//
// The drawer is gone.  What replaced it is a horizontally scrolling bar that
// carries **every** available item and always turns so the chosen one sits in
// the middle — §3.1's Stargate ring.  The user does not look up an item at a
// fixed coordinate; they read the centre.
//
// That trade is deliberate and is recorded as a loss: the bar stops being a map
// visible all at once.  Two things pay for it, and both are tested here —
// there is no "Více" to tip the overflow into, and the item set comes from
// `capabilities` rather than a constant, which no fixed map could ever match.
//
// The invariants, each of which is a bug the user could not name:
//
//   * exactly one item is highlighted, never zero and never two — including
//     when a scope is withdrawn *while its own section is open*, which is the
//     accident that would otherwise leave the highlight on nothing
//   * the bar is retracted on the root, and that is the "you are home" signal,
//     not a lost control.  No default centred item exists before the first
//     choice, because on the root there is nothing to centre
//   * an item whose scope never arrived is absent; an item whose screen does
//     not exist is present and locked, never a dead tap
//   * §10 — the highlight is text and shape, not colour; every item stays in
//     the accessibility tree even while scrolled out of sight
//
// And what the drawer used to guarantee has to survive its removal: the badge
// is live-only (D-S2) and MS-20 stays permanently reachable under Nastavení
// (§3.3).  Those are asserted in the MS-13 and MS-20 suites, against this bar.
//
// Same limit as the sibling UI suites (F-043): markup and stylesheet, not a
// browser.  Real scroll offsets and what centring looks like are not proven
// here — there is no layout in this DOM.
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

const nodes = { app: element(), toasts: element() };
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
const { state, store, K, render, navItems, currentSection, sectionRoute } = __ms20;

const clickHandler = (listeners.click || [])[0];
assert.ok(clickHandler, 'the client registered no click handler');

const ALL_SCOPES = ['read:chat', 'write:chat', 'read:notifications', 'read:approvals', 'write:approvals'];

function navBar() {
  return globalThis.document.querySelector('.navbar');
}
function navHtml() {
  const bar = navBar();
  return bar ? bar.innerHTML : '';
}
/** Every tab, in the order the bar lays them out. */
function tabs() {
  return navHtml().match(/<(?:button|span) class="nav-tab"[\s\S]*?<\/(?:button|span)>/g) || [];
}
function labels() {
  // The label span carries `data-label` so the bold width can be reserved
  // (§3.1), so match past any attributes rather than assuming the tag ends here.
  return tabs().map(tab => (tab.match(/nav-tab-label"[^>]*>([^<]+)</) || [])[1]);
}
function highlighted() {
  return tabs().filter(tab => tab.includes('aria-current="page"'));
}

function reset({ route = 'conversations', scopes = ALL_SCOPES } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.route = route;
  state.conn = 'ok';
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
  state.approvalsGone = {};
  state.approvalAttempts = {};
  body.children.length = 0;
  nodes.app.innerHTML = '';
}

function click(act, route = null) {
  const target = { dataset: { act, route: route ?? undefined } };
  target.closest = () => target;
  clickHandler({ target });
}

console.log('\n=== Bottom bar (UI-DESIGN §3.1, D-UI-3) ===');

// ── The drawer is gone ──────────────────────────────────────────────────────

await test('D-UI-3 the drawer, its scrim and the hamburger are gone, not merely hidden', () => {
  const client = readFileSync(new URL('../src/mobile/client/app.js', import.meta.url), 'utf8');
  const markup = readFileSync(new URL('../src/mobile/client/index.html', import.meta.url), 'utf8');
  assert.ok(!client.includes('renderDrawer'), 'the drawer renderer survived');
  assert.ok(!client.includes('data-act="drawer"'), 'a control still opens a drawer');
  assert.ok(!markup.includes('id="scrim"'), 'the drawer scrim is still in the document');
});

await test('§3.1 there is no "Více" — every available item is in the bar itself', () => {
  reset();
  render();
  assert.ok(!/Více|Více…|More/.test(navHtml()), 'the overflow drawer came back under another name');
  const ids = navItems().map(item => item.id);
  assert.equal(tabs().length, ids.length, 'the bar dropped or invented items');
});

// ── Exactly one highlighted ─────────────────────────────────────────────────

await test('§3.1 exactly one item is highlighted, on every route the router can reach', () => {
  const routes = ['overview', 'conversations', 'chat', 'notifications', 'approvals', 'approval', 'operations', 'diagnostics'];
  for (const route of routes) {
    reset({ route });
    state.data.approvals = [];
    state.data.conversations = [];
    render();
    assert.equal(highlighted().length, 1,
      `route ${route} highlighted ${highlighted().length} items; §3.1 allows exactly one`);
  }
});

await test('§3.1 a scope withdrawn while its own section is open leaves the highlight somewhere real', () => {
  reset({ route: 'approvals' });
  state.data.approvals = [];
  render();
  assert.equal(currentSection(), 'approvals', 'precondition: the approvals section is open');

  store.set(K.scopes, ['read:chat', 'write:chat']);
  render();
  assert.equal(highlighted().length, 1, 'the highlight was left on an item the bar no longer carries');
  assert.equal(currentSection(), 'overview');
});

await test('§3.3 a deep destination is highlighted under its section, not on its own', () => {
  reset({ route: 'chat' });
  render();
  assert.equal(currentSection(), 'conversations', 'a single chat is not its own section');

  reset({ route: 'operations' });
  render();
  assert.equal(currentSection(), 'settings', 'MS-20 lives under Nastavení (§3.3)');
  assert.equal(labels()[highlighted().length && tabs().indexOf(highlighted()[0])], 'Nastavení');
});

// ── Retraction on the root ──────────────────────────────────────────────────

await test('§3.2 the bar is retracted on the root and out in a section', () => {
  reset({ route: 'overview' });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.equal(navBar()?.dataset.retracted, 'true', 'the bar is out on the root');
  assert.ok(!body.classList.contains('has-navbar'), 'retracted, yet the content still reserves its height');

  navigateTo('conversations');
  assert.equal(navBar()?.dataset.retracted, 'false', 'entering a section did not slide the bar out');
  assert.ok(body.classList.contains('has-navbar'), 'the bar covers content instead of pushing it');

  navigateTo('overview');
  assert.equal(navBar()?.dataset.retracted, 'true', 'choosing Přehled did not slide the bar back');
});

function navigateTo(route) {
  state.data.approvals = [];
  state.data.conversations = [];
  click('go', route);
}

await test('§3.2 the retraction is a movement, not a removal — the element survives it', () => {
  reset({ route: 'conversations' });
  render();
  const before = navBar();
  assert.ok(before, 'precondition: the bar exists in a section');
  navigateTo('overview');
  assert.equal(navBar(), before, 'the bar was destroyed and rebuilt, so it cannot slide');
});

await test('§3.2 the centred item after sliding out is the one chosen on the root', () => {
  reset({ route: 'overview' });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.equal(highlighted().length, 1);
  assert.match(highlighted()[0], /data-nav="overview"/,
    'something other than the root was pre-selected before the first choice');

  navigateTo('approvals');
  assert.match(highlighted()[0], /data-nav="approvals"/,
    'the bar slid out centred on an item the user did not choose');
});

// ── Derived from capabilities ───────────────────────────────────────────────

await test('§3.1 the item set comes from capabilities, not from a constant', () => {
  reset({ scopes: ['read:chat', 'write:chat'] });
  render();
  assert.deepEqual(labels(), ['Přehled', 'Konverzace', 'Nastavení']);

  store.set(K.scopes, ALL_SCOPES);
  state.data.approvals = [];
  render();
  assert.deepEqual(labels(), ['Přehled', 'Konverzace', 'Approvaly', 'Nastavení']);
});

await test('§3.1 the documented order holds, with Nastavení last', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:projects'] });
  state.data.approvals = [];
  render();
  assert.deepEqual(labels(), ['Přehled', 'Konverzace', 'Projekty', 'Approvaly', 'Nastavení']);
});

await test('§3.1 an item whose screen does not exist is locked, never a dead tap', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:projects'] });
  state.data.approvals = [];
  render();
  const projects = tabs().find(tab => tab.includes('data-nav="projects"'));
  assert.ok(projects, 'a granted scope produced no item at all');
  assert.match(projects, /aria-disabled="true"/);
  assert.ok(!/data-act=/.test(projects), 'the Projekty item is tappable; MS-12 is not built');
});

await test('§3.1 a bar of only Přehled and Nastavení is worse than none, so there is none', () => {
  reset({ scopes: [] });
  render();
  assert.equal(navBar(), null,
    'a bar with nothing to switch between was rendered anyway');
  assert.ok(!body.classList.contains('has-navbar'));
});

await test('the bar belongs to a paired session and to no other', () => {
  reset({ route: 'conversations' });
  render();
  assert.ok(navBar(), 'precondition: a paired session has the bar');
  state.session = 'unpaired';
  render();
  assert.equal(navBar(), null, 'the bar outlived the credential it navigates with');
});

// ── D-S2 — a live badge only ────────────────────────────────────────────────

await test('D-S2 the badge counts a confirmed queue and nothing else', () => {
  reset({ route: 'conversations' });
  state.data.approvals = [{ id: 'a' }, { id: 'b' }];
  render();
  assert.match(navHtml(), /nav-count">2</);

  state.error.approvals = { kind: 'offline' };
  render();
  assert.ok(!/nav-count/.test(navHtml()), 'a remembered count outlived the read that confirmed it');
  assert.match(navHtml(), /data-route="approvals"/, 'the route itself must stay reachable');
});

await test('D-S2 a confirmed empty queue shows no badge rather than a zero', () => {
  reset({ route: 'conversations' });
  state.data.approvals = [];
  render();
  assert.ok(!/nav-count/.test(navHtml()));
});

// ── Back out of a deep destination ──────────────────────────────────────────

await test('§3.3 "back" leaves a deep destination for its own section, not for the chat list', () => {
  assert.equal(sectionRoute('conversations'), 'conversations');
  assert.equal(sectionRoute('settings'), 'diagnostics', 'MS-20 must return to Nastavení');
  assert.equal(sectionRoute('overview'), 'overview');

  reset({ route: 'operations' });
  render();
  click('back');
  assert.equal(state.route, 'diagnostics', 'leaving MS-20 dropped the user into another section');
});

// ── §10 — accessibility contract ────────────────────────────────────────────

await test('§10 the highlight is text and shape, not colour alone', () => {
  reset({ route: 'conversations' });
  render();
  assert.match(highlighted()[0], /aria-current="page"/);
  assert.match(highlighted()[0], /aria-selected="true"/);
  const css = readFileSync(new URL('../src/mobile/client/app.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.nav-tab[aria-current="page"]'));
  const block = rule.slice(0, rule.indexOf('}'));
  assert.match(block, /border-top-color/, 'the selected item is distinguished by colour alone');
  assert.match(block, /font-weight/, 'the selected label carries no weight difference');
});

await test('§10 every item stays in the accessibility tree, including off-screen ones', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:projects'] });
  state.data.approvals = [];
  render();
  for (const tab of tabs()) {
    // The decorative icon is hidden on purpose; the item itself never is.  A
    // bar that hides overflow from assistive technology to fit the viewport is
    // exactly the loss D-UI-3 recorded as *not* acceptable.
    const withoutIcons = tab.replace(/<svg[\s\S]*?<\/svg>/g, '');
    assert.ok(!/aria-hidden/.test(withoutIcons),
      `an item was hidden from assistive technology to fit the viewport: ${tab}`);
    assert.match(tab, /<svg[^>]*aria-hidden="true"/, `a decorative icon is announced as content: ${tab}`);
    assert.match(tab, /nav-tab-label"[^>]*>[^<]+</, `an item carries no readable label: ${tab}`);
    assert.match(tab, /role="tab"/);
  }
  assert.match(navHtml(), /role="tablist"/);
});

await test('§10 focus on an off-screen item scrolls it into view', () => {
  const client = readFileSync(new URL('../src/mobile/client/app.js', import.meta.url), 'utf8');
  assert.match(client, /addEventListener\('focusin'/,
    'nothing brings a focused off-screen item into view, which D-UI-3 requires');
  const focusin = (listeners.focusin || [])[0];
  assert.ok(focusin, 'the client registered no focusin handler');
  // A target that is not a tab must be left alone rather than moving the ring.
  assert.doesNotThrow(() => focusin({ target: { closest: () => null } }));
});

await test('§8 the bar declares a 48 dp touch target and pushes content instead of covering it', () => {
  const css = readFileSync(new URL('../src/mobile/client/app.css', import.meta.url), 'utf8');
  const tab = css.slice(css.indexOf('.nav-tab {'), css.indexOf('.nav-tab svg'));
  assert.match(tab, /min-height:\s*(4[89]|5\d|6\d)px/, 'the 48 dp minimum target is not declared');
  assert.match(css, /body\.has-navbar \.scroll \{[^}]*padding-bottom/,
    'the scroll region does not give back the height the fixed bar takes');
  const bar = css.slice(css.indexOf('.navbar {'), css.indexOf('.navbar[data-retracted'));
  // §8's ceiling is 200 ms; the bar's retraction is its one named exception
  // (operator, 2026-08-10), so what is checked here is that the exception stays
  // *narrow*: it is driven by a variable, only the transform uses it, and
  // someone who asked for less motion is put back under the ceiling.
  assert.match(bar, /transition:\s*transform var\(--navbar-slide\)/,
    'the retraction must be driven by the named variable, not a loose duration');
  assert.match(css, /--navbar-slide:\s*\d+ms/, 'the duration must be tunable in one place');
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*:root \{ --navbar-slide: 1\d\dms/,
    'reduced motion must bring the slide back under the §8 ceiling');
});

console.log(`\nBottom bar: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
