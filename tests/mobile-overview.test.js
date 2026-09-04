// Přehled — the root screen · UI-DESIGN §3.1, §3.2, §3.4 · decision D-UI-3
// ==============================================================================
//
// The homescreen is not a dashboard here.  §3.2 retracts the bottom bar on the
// root, and that one decision makes this screen **the only map of the app**:
// a section without a tile is a section the user cannot reach and — because the
// bar is hidden — cannot even learn exists.
//
// So the load-bearing test in this file is the completeness condition, and it
// is written the only way that keeps it true over time: it asks the client for
// its own bar items and requires a tile for every one of them.  Adding an item
// without adding a tile fails here automatically, which is what §3.2 means by
// "nová položka v liště a nová dlaždice na Přehledu vznikají zároveň".
//
// The rest hold the line the operator's design crossed:
//
//   * D-UI-4 — no `Aktivní běhy`, no percentage.  A percentage needs a known
//     whole, and no agent-log stream exists (MR-07 is BLOCKED_BY_CONTRACT)
//   * MD-07 / SS-02 / SS-03 — "Nic nečeká" is permission to put the phone
//     down, so it is rendered only from a confirmed empty answer, never from a
//     failed one and never from memory (D-S2)
//   * §3.4 — a capability this client version does not know produces no item
//     and is written to diagnostics instead of crashing or guessing
//   * §3.1 — an item whose scope never arrived is absent; an item whose screen
//     does not exist (Projekty, MR-14) is present and locked, not tappable
//
// Same limit as the sibling UI suites (F-043): this is markup, not a browser.
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
const { state, store, K, render, viewOverview, navItems, currentSection, unknownScopes } = __ms20;

// Captured before this suite touches anything: what the client starts on.
const BOOT_ROUTE = state.route;

const html = () => nodes.app.innerHTML;
const MINUTE = 60_000;
const ALL_SCOPES = ['read:chat', 'write:chat', 'read:notifications', 'read:approvals', 'write:approvals'];

function reset({ scopes = ALL_SCOPES } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.route = 'overview';
  state.conn = 'ok';
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
  state.approvalsGone = {};
  state.approvalAttempts = {};
  body.children.length = 0;
  nodes.app.innerHTML = '';
}

function approval(overrides = {}) {
  return {
    id: 'ap-1',
    title: 'Zapsat soubor do repozitáře',
    subjectType: 'file.write',
    subjectId: 'src/x.js',
    createdAt: Date.now() - 2 * MINUTE,
    expiresAt: new Date(Date.now() + 12 * MINUTE).toISOString(),
    expired: false,
    payloadFingerprint: 'f'.repeat(64),
    ...overrides,
  };
}

function conversation(overrides = {}) {
  return { id: 'c-1', title: 'Refaktor gateway', messageCount: 12, updatedAt: Date.now() - MINUTE, ...overrides };
}

console.log('\n=== Přehled — the root (UI-DESIGN §3.2, D-UI-3) ===');

// ── The root ────────────────────────────────────────────────────────────────

await test('§3.2 Přehled is the root the app starts on, not the conversation list', () => {
  assert.equal(BOOT_ROUTE, 'overview',
    'the client no longer starts on the root; §3.2 makes Přehled the root from phase 3');
});

await test('§3.2 an unrecognised route falls back to the root, not to a section', () => {
  reset();
  state.route = 'no-such-route';
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.match(html(), /Přehled/);
  assert.equal(currentSection(), 'overview');
});

// ── The completeness condition ──────────────────────────────────────────────

await test('§3.2 every bar item has a tile on the root — asked of the client, not hard-coded', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:projects'] });
  state.data.approvals = [];
  state.data.conversations = [];
  const markup = viewOverview();
  const missing = navItems()
    .filter(item => item.id !== 'overview')
    .filter(item => !markup.includes(`data-section="${item.id}"`))
    .map(item => item.id);
  assert.deepEqual(missing, [],
    `bar items with no tile on the root: ${missing.join(', ')} — §3.2 makes their sections unreachable`);
});

await test('§3.2 the root does not invent tiles for items the bar does not carry', () => {
  reset({ scopes: ['read:chat', 'write:chat'] });
  state.data.conversations = [];
  const markup = viewOverview();
  assert.ok(!markup.includes('data-section="approvals"'),
    'a device without read:approvals got an approvals tile that leads to a screen it may not see');
  assert.ok(!markup.includes('data-section="projects"'),
    'Projekty appeared without the server ever granting read:projects');
});

await test('§3.2 tiles lead deep, the section map switches section — different granularity', () => {
  reset();
  state.data.approvals = [approval()];
  state.data.conversations = [conversation()];
  const markup = viewOverview();
  assert.match(markup, /data-act="open-approval" data-approval="ap-1"/,
    'the approval tile must open that approval, not the queue');
  assert.match(markup, /data-act="open-chat" data-id="c-1"/,
    'the conversation row must open that conversation, not the list');
  assert.match(markup, /data-act="go" data-route="conversations"/,
    'the section map must switch section');
});

// ── D-UI-4 — no invented progress ───────────────────────────────────────────

await test('D-UI-4 the root carries no "Aktivní běhy" and no percentage', () => {
  reset();
  state.data.approvals = [approval()];
  state.data.conversations = [conversation()];
  const markup = viewOverview();
  assert.ok(!/Aktivní běhy/.test(markup), 'the section D-UI-4 removed came back');
  assert.ok(!/\d+\s?%/.test(markup), `a percentage appeared on the root: ${markup.match(/.{0,40}\d+\s?%.{0,40}/)}`);
});

// ── MS-13 on the root ───────────────────────────────────────────────────────

await test('SS-02 "Nic nečeká" appears only after a confirmed empty answer', () => {
  reset();
  state.data.conversations = [];
  state.data.approvals = [];
  assert.match(viewOverview(), /Nic nečeká/);
});

await test('SS-03 a failed queue read never becomes "Nic nečeká"', () => {
  reset();
  state.data.conversations = [];
  state.data.approvals = undefined;
  state.error.approvals = { kind: 'offline', code: 'network' };
  const markup = viewOverview();
  assert.ok(!/Nic nečeká/.test(markup),
    'an unreachable server was rendered as an empty queue — the most dangerous sentence on this screen');
  assert.match(markup, /Bez připojení nelze zobrazit, co čeká/);
});

await test('SS-08 an unreachable server is told apart from no network here too', () => {
  reset();
  state.data.conversations = [];
  state.data.approvals = undefined;
  state.error.approvals = { kind: 'server', code: 'upstream' };
  const markup = viewOverview();
  assert.ok(!/Nic nečeká/.test(markup));
  assert.match(markup, /Server frontu nevydal/);
});

await test('SS-01 an unloaded queue is a skeleton, never an empty state', () => {
  reset();
  state.data.conversations = [];
  state.data.approvals = undefined;
  const markup = viewOverview();
  assert.ok(!/Nic nečeká/.test(markup));
  assert.match(markup, /skel/);
});

await test('D-S2 a failed read shows no approval count at all, not a remembered one', () => {
  reset();
  state.data.conversations = [];
  state.data.approvals = [approval(), approval({ id: 'ap-2' })];
  assert.match(viewOverview(), /2 čeká/, 'a confirmed queue may show its size');

  state.error.approvals = { kind: 'offline', code: 'network' };
  assert.ok(!/2 čeká/.test(viewOverview()),
    'the count survived a failed read, which turns a memory into a claim about now');
});

// ── Recent conversations ────────────────────────────────────────────────────

await test('SS-02 vs SS-03 an unloaded conversation list is not an empty one', () => {
  reset();
  state.data.approvals = [];
  state.data.conversations = undefined;
  state.error.conversations = { kind: 'server', code: 'boom' };
  const markup = viewOverview();
  assert.ok(!/Zatím žádné konverzace/.test(markup), 'a failed load was rendered as "no conversations"');
  assert.match(markup, /nepodařilo načíst/);
});

await test('§3.2 the root shows a handful of recent conversations, not the whole list', () => {
  reset();
  state.data.approvals = [];
  state.data.conversations = Array.from({ length: 12 }, (_, index) =>
    conversation({ id: `c-${index}`, title: `Konverzace ${index}` }));
  const rows = viewOverview().match(/data-act="open-chat"/g) || [];
  assert.ok(rows.length > 0 && rows.length <= 3, `expected at most three deep links, got ${rows.length}`);
});

// ── §3.1 / §3.4 — the mapping layer ─────────────────────────────────────────

await test('MM3 the scoped Projects tile reaches the implemented screen', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:projects'] });
  state.data.approvals = [];
  state.data.conversations = [];
  const markup = viewOverview();
  const tile = markup.match(/<button class="ov-tile"[^>]*data-act="go"[^>]*data-route="projects"[^>]*data-section="projects"[\s\S]*?<\/button>/);
  assert.ok(tile, 'Projekty is granted by scope but has no tile on the root');
  assert.ok(!/Připravujeme/.test(tile[0]), 'the implemented screen is still presented as future work');
});

await test('§3.4 an unknown capability produces no item and is written to diagnostics', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:telepathy'] });
  state.data.approvals = [];
  state.data.conversations = [];
  assert.deepEqual(unknownScopes(), ['read:telepathy']);
  const ids = navItems().map(item => item.id);
  assert.ok(!ids.includes('read:telepathy'), 'an unknown capability reached the navigation');
  assert.deepEqual(ids, ['overview', 'conversations', 'approvals', 'settings']);

  state.route = 'diagnostics';
  state.data.health = { upstream: 'ok', protocolVersion: '1' };
  render();
  assert.match(html(), /read:telepathy/, '§3.4 requires the unknown capability to be recorded in MS-03');
});

await test('§3.3 MS-03, MS-20 and MS-05 are reachable, and only Nastavení is a section', () => {
  reset();
  state.data.approvals = [];
  state.data.conversations = [];
  const markup = viewOverview();
  assert.match(markup, /data-route="notifications"/, 'MS-05 is unreachable from the only map of the app');
  assert.equal(currentSection('diagnostics') && __ms20.ROUTE_SECTION.diagnostics, 'settings');
  assert.equal(__ms20.ROUTE_SECTION.operations, 'settings', 'MS-20 must live under Nastavení (§3.3)');
  assert.equal(__ms20.ROUTE_SECTION.notifications, 'overview',
    'MS-05 is not a bar item (UI-REVIEW §3.5), so it belongs to the root section');
});

await test('§3.2 the root has no menu control — it is the map, so nothing opens another one', () => {
  reset();
  state.data.approvals = [];
  state.data.conversations = [];
  const markup = viewOverview();
  assert.ok(!/data-act="drawer"/.test(markup), 'the root offered a second navigation surface');
  assert.ok(!/data-act="back"/.test(markup), 'the root offered a way back out of the root');
});

await test('§10 every tile carries a word, and a locked one carries the lock as well', () => {
  reset({ scopes: [...ALL_SCOPES, 'read:projects'] });
  state.data.approvals = [];
  state.data.conversations = [];
  const tiles = viewOverview().match(/class="ov-tile"[\s\S]*?<\/(?:button|li)>/g) || [];
  assert.ok(tiles.length >= 4, `expected the section map plus the upcoming tiles, got ${tiles.length}`);
  for (const tile of tiles) {
    assert.match(tile, /<span class="ov-tile-label">[^<]+<\/span>/, `tile without a label: ${tile}`);
  }
  for (const tile of tiles.filter(one => one.includes('data-locked="true"'))) {
    assert.match(tile, /Připravujeme/, `locked tile without a word for its state: ${tile}`);
  }
});

console.log(`\nPřehled: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
