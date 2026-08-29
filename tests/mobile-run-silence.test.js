// RunSilence — UI-DESIGN §6.5, §9, §14 · decision D-UI-4
// ==============================================================================
//
// The operator's homescreen had `Aktivní běhy` with `72 %` and `41 %`.  D-UI-4
// replaced it with this strip, and the reason is not taste: a percentage is a
// stronger claim than "something is running" — it needs a known whole — and no
// agent-log stream exists to compute one from.  `MR-07` is BLOCKED_BY_CONTRACT
// and `/m1` is pull-only, with neither WebSocket nor SSE.
//
// So the strip says the two things the phone actually knows: it is running, and
// for how long.  Everything this suite checks follows from that:
//
//   * no percentage, no estimate, no ETA — not even temporarily while loading
//   * "Zjistit stav" performs exactly `GET /m1/operations/:id`, and may answer
//     `UNKNOWN` again.  It is a read: it never sends, never repeats, never
//     abandons (§9, C-6, MD-19)
//   * only genuinely running attempts appear.  `UNKNOWN` is not running — it
//     ended in a way nobody can name, and MS-20 is the screen for that
//   * §14 — a duration is measured against the clock that stamped its start,
//     so a server row is corrected by the offset and a journal entry is not
//   * nothing is rendered when nothing runs: a permanent empty "runs" panel
//     would imply the phone is watching, and it is not
//
// Same limit as the sibling UI suites (F-043): markup, not a browser.
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

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
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

let fetchQueue = [];
let fetchLog = [];

globalThis.fetch = async (url, options = {}) => {
  fetchLog.push({ url: String(url), method: options.method || 'GET' });
  const next = fetchQueue.shift();
  if (!next) throw new Error(`unexpected request: ${options.method || 'GET'} ${url}`);
  if (next.network) {
    const error = new TypeError('failed to fetch');
    error.name = 'TypeError';
    throw error;
  }
  return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body ?? null };
};

const ok = (data, extra = {}) => ({
  status: 200,
  body: { ok: true, protocolVersion: 'm1.2026-07-30', data, ...extra },
});

// ── The client under test ───────────────────────────────────────────────────

const { __ms20 } = await import('../src/mobile/client/app.js');
const { state, store, journal, K, render, runSilence, runSilenceEntries, overviewRunSilence } = __ms20;

const clickHandler = (listeners.click || [])[0];
assert.ok(clickHandler, 'the client registered no click handler');

const html = () => nodes.app.innerHTML;
const MINUTE = 60_000;
const OP = 'a'.repeat(32);

/** The whole strip: head, sentence, and the read it may offer. */
function strip(markup = html()) {
  const match = markup.match(/<div class="run-silence"[\s\S]*?<\/p>\s*(?:<button[\s\S]*?<\/button>)?\s*<\/div>/);
  return match ? match[0] : null;
}

/** What the user reads.  Inline geometry — skeleton widths — is not copy. */
function visible(markup = html()) {
  return markup.replace(/style="[^"]*"/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
}

function entry(overrides = {}) {
  return {
    operationId: OP,
    operationType: 'chat.send',
    displaySummary: 'Odeslání zprávy',
    createdAt: Date.now() - 72_000,
    lastKnownState: 'PENDING',
    lastCheckedAt: null,
    unknownReason: null,
    ...overrides,
  };
}

function reset({ route = 'overview', journalEntries = [] } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, ['read:chat', 'write:chat', 'read:approvals', 'write:approvals']);
  store.set(K.journal, journalEntries);
  state.session = 'active';
  state.route = route;
  state.conn = 'ok';
  state.conversationId = null;
  state.sending = false;
  state.sendingSince = null;
  state.sendingOperationId = null;
  state.data = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.serverOffsetMs = 0;
  state.opsLookup = {};
  state.opsNote = {};
  fetchQueue = [];
  fetchLog = [];
  body.children.length = 0;
  nodes.app.innerHTML = '';
}

console.log('\n=== RunSilence (UI-DESIGN §6.5, D-UI-4) ===');

// ── D-UI-4 — what replaced the percentages ──────────────────────────────────

await test('D-UI-4 the strip reports that it runs and for how long, and claims nothing else', () => {
  reset({ journalEntries: [entry()] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  const rendered = strip();
  assert.ok(rendered, 'a running attempt produced no RunSilence strip on the root');
  assert.match(rendered, /Běží · 1:12/, 'the elapsed time is not reported as a plain duration');
  assert.match(rendered, /Průběh běhu není z telefonu dostupný/);
  assert.match(rendered, /Ticho neznamená zamrznutí/);
});

await test('D-UI-4 no percentage, no estimate, no remaining time — not even temporarily', () => {
  reset({ journalEntries: [entry(), entry({ operationId: 'b'.repeat(32) })] });
  state.data.approvals = undefined;   // mid-load, the state that most tempts a placeholder
  state.data.conversations = undefined;
  state.loading.approvals = true;
  render();
  const markup = visible();
  assert.ok(!/\d+\s?%/.test(markup), `a percentage appeared: ${markup.match(/.{0,40}\d+\s?%.{0,40}/)}`);
  assert.ok(!/Aktivní běhy/.test(markup), 'the section D-UI-4 removed came back');
  assert.ok(!/zbývá|odhad|dokončeno z|hotovo z/i.test(markup),
    'the strip implied a whole it cannot know');
  assert.ok(!/<progress|role="progressbar"/.test(markup), 'a progress element was rendered');
});

await test('§6.5 nothing runs, nothing is shown — no permanent empty runs panel', () => {
  reset({ journalEntries: [] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.equal(strip(), null);
  assert.equal(overviewRunSilence(), '');
  assert.ok(!/Právě běží/.test(html()));
});

// ── What counts as running ──────────────────────────────────────────────────

await test('§6.5 an UNKNOWN attempt is not running — it belongs to MS-20, not here', () => {
  reset({ journalEntries: [entry({ lastKnownState: 'UNKNOWN', unknownReason: 'upstream_timeout' })] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.deepEqual(runSilenceEntries(), [], 'an attempt that ended ambiguously was reported as running');
  assert.equal(strip(), null);
});

await test("§6.5 the server's view of what is open wins over the phone's memory", () => {
  reset({ journalEntries: [entry()] });
  state.data.approvals = [];
  state.data.conversations = [];
  state.data.operations = [{ operationId: OP, operationType: 'chat.send', state: 'UNKNOWN', createdAt: Date.now() - MINUTE }];
  render();
  assert.equal(strip(), null,
    'the phone kept calling an attempt "running" after the server said it ended unknown');
});

// ── §9 / C-6 — the button reads and does nothing else ───────────────────────

await test('§9 "Zjistit stav" performs exactly GET /m1/operations/:id and sends nothing', async () => {
  reset({ journalEntries: [entry()] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.match(strip(), /data-act="resolve-op" data-op="a{32}"/, 'the strip offers no read at all');

  fetchQueue = [ok({ operationId: OP, state: 'UNKNOWN', unknownReason: 'upstream_timeout', known: true })];
  const target = { dataset: { act: 'resolve-op', op: OP } };
  target.closest = () => target;
  clickHandler({ target });
  await flush();

  assert.equal(fetchLog.length, 1, `expected exactly one request, got ${fetchLog.length}`);
  assert.equal(fetchLog[0].method, 'GET', 'the read dispatched a mutation');
  assert.match(fetchLog[0].url, new RegExp(`/m1/operations/${OP}$`));
});

await test('§6.5 the read may answer UNKNOWN again, and the strip then stops claiming it runs', async () => {
  reset({ journalEntries: [entry()] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();

  fetchQueue = [ok({ operationId: OP, state: 'UNKNOWN', unknownReason: 'upstream_timeout', known: true })];
  const target = { dataset: { act: 'resolve-op', op: OP } };
  target.closest = () => target;
  clickHandler({ target });
  await flush();

  assert.equal(journal.find(OP).lastKnownState, 'UNKNOWN');
  render();
  assert.equal(strip(), null, 'an attempt the server called UNKNOWN was still shown as running');
});

await test('§9 the strip carries no retry and no abandon — a read is the only act it offers', () => {
  reset({ journalEntries: [entry()] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  const rendered = strip();
  const acts = [...rendered.matchAll(/data-act="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(acts, ['resolve-op'], `the strip offers more than a read: ${acts.join(', ')}`);
  assert.ok(!/Zkusit znovu|Odeslat znovu|Opakovat/.test(rendered), '§9 forbids "Zkusit znovu" on a mutation');
});

// ── The chat strip ──────────────────────────────────────────────────────────

await test('§6.5 the in-flight send shows the same strip, naming its own attempt', () => {
  reset({ route: 'chat', journalEntries: [entry()] });
  state.conversationId = 'c-1';
  state.data.thread = { conversation: { id: 'c-1', title: 'T' }, messages: [{ id: 'm1', role: 'user', content: 'ahoj', createdAt: Date.now() }] };
  state.sending = true;
  state.sendingSince = Date.now() - 72_000;
  state.sendingOperationId = OP;
  render();
  const rendered = strip();
  assert.ok(rendered, 'a send in flight rendered no strip');
  assert.match(rendered, /Běží · 1:12/);
  assert.match(rendered, /data-act="resolve-op" data-op="a{32}"/,
    'the chat strip offers no read, so §6.5\'s "both buttons" is one button');
});

await test('B-2 the running mark is steady, never a pulsing typing indicator', () => {
  reset({ journalEntries: [entry()] });
  state.data.approvals = [];
  state.data.conversations = [];
  render();
  assert.match(strip(), /class="run-mark" aria-hidden="true"/);
  assert.match(strip(), /role="status"/, 'the strip is not announced as a live region');
});

// ── §14 — which clock a duration is measured against ────────────────────────

await test('§14 a server row is measured against the corrected clock, a journal entry against the phone', () => {
  reset();
  state.serverOffsetMs = 5 * MINUTE;  // the phone is five minutes behind the server
  const started = Date.now() - 60_000;

  const local = runSilence({ operationId: OP, createdAt: started, source: 'local' });
  assert.match(local, /Běží · 1:00/, 'a phone-stamped start was corrected by an offset that does not apply to it');

  const server = runSilence({ operationId: OP, createdAt: started, source: 'server' });
  assert.match(server, /Běží · 6:00/, 'a server-stamped start ignored the offset (§14)');
});

await test('§14 an unusable start time yields no number rather than a wrong one', () => {
  reset();
  const rendered = runSilence({ operationId: OP, createdAt: null });
  assert.match(rendered, /Běží/);
  assert.ok(!/Běží · /.test(rendered), 'a duration was invented from a start time the client does not have');
});

console.log(`\nRunSilence: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
