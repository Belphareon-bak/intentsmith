// MS-07 — the conversation window says what it is (MR-05, SS-03, SS-10)
// ==============================================================================
//
// The rule this suite defends is I-2: a history that was cut off must never
// look complete.  Before WP-MOBILE-028 the client asked for `limit=100` — the
// server's ceiling — and rendered the answer as the whole conversation.  On a
// longer thread that showed the *oldest* hundred messages, left the newest
// exchange off screen, and said nothing about either.
//
// So the load-bearing tests here are not about a control existing.  They are:
//
//   * the window opens at the newest message, not the oldest
//   * the older edge is *always* labelled — as a control when more can be
//     fetched, as the SS-03 sentence when it cannot, and as the beginning of
//     the conversation when there is genuinely nothing older
//   * a rejected cursor reloads the thread instead of splicing (SS-10)
//   * nothing here computes a cursor (§8.2)
//
// The third boundary case is the one that would rot quietly: without it, "the
// top of what loaded" and "the start of the conversation" render identically.
//
// What this suite does *not* prove (same limit as tests/mobile-trust-bar.test.js
// and tests/mobile-ms20-ui.test.js, F-043): there is no browser here.  Scroll
// anchoring when an older page is prepended is a real requirement and is not
// verifiable from markup; it belongs to the browser suite.
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

globalThis.localStorage = makeStorage();
globalThis.document = {
  body,
  getElementById: id => nodes[id] || null,
  querySelector: () => null,
  createElement: tag => element(tag),
  addEventListener: () => {},
  visibilityState: 'visible',
};
globalThis.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState: () => {} };

/** Every request the client makes, and the answers it is given. */
const wire = { calls: [], reply: null };
globalThis.fetch = async (url, options = {}) => {
  wire.calls.push({ url: String(url), method: options.method || 'GET' });
  const answer = typeof wire.reply === 'function' ? wire.reply(String(url)) : wire.reply;
  if (!answer) throw new TypeError('no reply configured for ' + url);
  return {
    ok: answer.status < 400,
    status: answer.status,
    json: async () => answer.body,
    headers: { get: () => null },
  };
};

const { __ms20 } = await import('../src/mobile/client/app.js');
const {
  state, store, K, render, viewChat, threadBoundary,
  loadThread, loadOlderMessages, threadWindowOf, THREAD_PAGE_SIZE, cache,
} = __ms20;

console.log('\n=== MS-07 conversation history window (MR-05) ===');

const message = n => ({ id: String(n), role: n % 2 ? 'user' : 'assistant', content: `zpráva ${n}` });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => message(from + i));

/** A server answer in the shape `withEnvelope` produces. */
function page(messages, { nextCursor = null, end = true, direction = 'backward' } = {}) {
  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: 'm1.2026-07-30',
      scopes: ['read:chat', 'write:chat'],
      hasMore: !end,
      nextCursor,
      end,
      direction,
      data: { conversation: { id: 'c1', title: 'Dlouhá', messageCount: 250 }, messages },
    },
  };
}

function reset({ conn = 'ok' } = {}) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, ['read:chat', 'write:chat']);
  state.route = 'chat';
  state.session = 'active';
  state.conn = conn;
  state.conversationId = 'c1';
  state.data = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.thread = { cursor: null, end: false, loadingOlder: false };
  state.sending = false;
  wire.calls = [];
  wire.reply = null;
}

try {
  await test('the thread opens at the newest message, anchored not walked', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');

    assert.equal(wire.calls.length, 1, 'opening a thread is one request, not a walk');
    const url = wire.calls[0].url;
    assert.ok(url.includes('anchor=latest'), `opening request must anchor: ${url}`);
    assert.ok(url.includes(`limit=${THREAD_PAGE_SIZE}`), url);
    assert.ok(!url.includes('cursor='), 'the opening request carries no cursor');
    assert.equal(state.data.thread.messages.at(-1).content, 'zpráva 250');
  });

  await test('the client no longer asks for the ceiling as if it were the history', async () => {
    // The exact defect this replaced.  100 is the server maximum; asking for it
    // once and rendering the answer is what hid the newest hundred and fifty.
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');
    assert.ok(!wire.calls[0].url.includes('limit=100'), wire.calls[0].url);
  });

  await test('an incomplete window offers to load older messages', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');

    const markup = viewChat();
    assert.ok(markup.includes('data-act="load-older"'), 'the older edge must be reachable');
    assert.ok(markup.includes('Načíst starší zprávy'), markup.slice(0, 400));
    assert.ok(!markup.includes('Začátek konverzace'),
      'an incomplete window must not claim to be the start of the conversation');
  });

  await test('the boundary sits above the messages, not below them', async () => {
    // Older material is at the top of a chat; a control for it at the bottom
    // would point the user the wrong way.
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');

    const markup = viewChat();
    assert.ok(markup.indexOf('thread-edge') < markup.indexOf('zpráva 201'),
      'the window boundary must precede the oldest message on screen');
  });

  await test('a complete window says so instead of offering a page that does not exist', async () => {
    reset();
    wire.reply = page(range(1, 12), { nextCursor: null, end: true });
    await loadThread('c1');

    const markup = viewChat();
    assert.ok(markup.includes('Začátek konverzace'), 'the real start must be stated');
    assert.ok(!markup.includes('data-act="load-older"'),
      'there is nothing older to load');
    assert.ok(!markup.includes('vyžadují připojení'),
      'a complete window must not blame the connection');
  });

  await test('offline, an incomplete window names the connection, not a control', async () => {
    // SS-03 verbatim: the sentence is the boundary when paging is impossible.
    reset({ conn: 'offline' });
    state.data.thread = { conversation: { id: 'c1' }, messages: range(201, 250) };
    state.thread = { cursor: 'cur-200', end: false, loadingOlder: false };

    const markup = viewChat();
    assert.ok(markup.includes('Starší zprávy vyžadují připojení'), markup.slice(0, 400));
    assert.ok(!markup.includes('data-act="load-older"'),
      'a control that cannot work must not be offered');
  });

  await test('a cached window of unknown extent is treated as partial', async () => {
    // The fail-safe.  An entry written before the window was recorded knows
    // neither its cursor nor its end; rendering it bare would be the silent
    // truncation this whole suite exists to prevent.
    reset();
    const legacy = threadWindowOf({ conversation: { id: 'c1' }, messages: range(1, 40) });
    assert.equal(legacy.cursor, null, 'no cursor was recorded');
    assert.equal(legacy.end, false, 'and completeness must not be assumed');

    state.data.thread = { conversation: { id: 'c1' }, messages: range(1, 40) };
    state.thread = legacy;
    assert.ok(threadBoundary().includes('Starší zprávy vyžadují připojení'),
      'unknown extent must never render as a complete history');
  });

  await test('a cached window remembers how far it reached', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');

    const cached = cache.read('thread.c1');
    assert.equal(cached.data.window.cursor, 'cur-200');
    assert.equal(cached.data.window.end, false);
    const restored = threadWindowOf(cached.data);
    assert.equal(restored.cursor, 'cur-200');
    assert.equal(restored.end, false);
  });

  await test('loading older prepends the page and follows the server cursor', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');
    wire.calls = [];

    wire.reply = page(range(151, 200), { nextCursor: 'cur-150', end: false });
    await loadOlderMessages();

    assert.equal(wire.calls.length, 1);
    assert.ok(wire.calls[0].url.includes('cursor=cur-200'),
      `the request must carry the cursor the server issued: ${wire.calls[0].url}`);
    assert.ok(!wire.calls[0].url.includes('anchor='),
      'continuing a walk must not also anchor it');

    const contents = state.data.thread.messages.map(m => m.content);
    assert.equal(contents.length, 100);
    assert.equal(contents.at(0), 'zpráva 151', 'older messages go on the front');
    assert.equal(contents.at(-1), 'zpráva 250', 'the newest message stays at the end');
    assert.equal(new Set(contents).size, 100, 'no message may be duplicated');
    assert.equal(state.thread.cursor, 'cur-150');
  });

  await test('reaching the oldest page closes the window', async () => {
    reset();
    wire.reply = page(range(51, 100), { nextCursor: 'cur-50', end: false });
    await loadThread('c1');

    wire.reply = page(range(1, 50), { nextCursor: null, end: true });
    await loadOlderMessages();

    assert.equal(state.thread.end, true);
    assert.equal(state.thread.cursor, null);
    assert.ok(viewChat().includes('Začátek konverzace'));
  });

  await test('a rejected cursor reloads the thread instead of splicing (SS-10)', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'stale', end: false });
    await loadThread('c1');
    wire.calls = [];

    // The stream moved; the cursor is refused.  The only honest repair is a
    // full re-read — patching the gap would join two different histories.
    wire.reply = url => (url.includes('cursor=stale')
      ? { status: 400, body: { ok: false, error: { code: 'cursor_unknown', reason: 'cursor_unrecognized', restart: true } } }
      : page(range(211, 260), { nextCursor: 'cur-210', end: false }));
    await loadOlderMessages();

    const anchored = wire.calls.filter(call => call.url.includes('anchor=latest'));
    assert.equal(anchored.length, 1, 'a refused cursor must trigger exactly one full re-read');
    assert.equal(state.data.thread.messages.length, 50,
      'the window is replaced, not extended');
    assert.equal(state.data.thread.messages.at(0).content, 'zpráva 211');
    assert.equal(state.thread.cursor, 'cur-210');
  });

  await test('a failed load of older messages keeps the window already on screen', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');

    wire.reply = () => { throw new TypeError('network down'); };
    await loadOlderMessages();

    assert.equal(state.data.thread.messages.length, 50,
      'what was true when it loaded stays on screen');
    assert.equal(state.thread.cursor, 'cur-200', 'the cursor is not thrown away');
    assert.equal(state.thread.loadingOlder, false, 'the control is released');
  });

  await test('the older control cannot be fired twice at once', async () => {
    reset();
    wire.reply = page(range(201, 250), { nextCursor: 'cur-200', end: false });
    await loadThread('c1');
    wire.calls = [];

    wire.reply = page(range(151, 200), { nextCursor: 'cur-150', end: false });
    await Promise.all([loadOlderMessages(), loadOlderMessages()]);
    assert.equal(wire.calls.length, 1, 'a second tap while in flight must be ignored');
  });

  await test('a conversation started on this phone has no past to offer', async () => {
    reset();
    __ms20.newChat();
    state.data.thread.messages.push(message(1));
    assert.equal(state.thread.end, true);
    assert.ok(viewChat().includes('Začátek konverzace'),
      'a new conversation must not offer to load history that never existed');
  });

  await test('the client never mints a cursor of its own (§8.2)', async () => {
    // Structural: the rule is that positions come from the server only.  The
    // cursor is checksummed, so a computed one would be refused — but the client
    // must not be *trying*.
    const raw = await import('node:fs')
      .then(fs => fs.readFileSync(new URL('../src/mobile/client/app.js', import.meta.url), 'utf8'));
    // Prose explaining the rule must not be mistaken for breaking it, so the
    // scan runs over code with comments removed.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.ok(!code.includes('encodeCursor'), 'the client must not encode cursors');
    for (const forbidden of ['position', 'offset=']) {
      assert.ok(!code.includes(forbidden),
        `the client must not compute paging positions (${forbidden})`);
    }
    // Every cursor that reaches the wire came out of the server's own answer.
    const cursorUses = [...code.matchAll(/cursor=\$\{([^}]+)\}/g)].map(match => match[1]);
    assert.ok(cursorUses.length > 0, 'the client does page');
    for (const expression of cursorUses) {
      assert.ok(expression.includes('cursor'),
        `a cursor sent to the server must be one it issued, got ${expression}`);
    }
  });
} finally {
  render();
}

console.log(`\nMS-07 history window: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
