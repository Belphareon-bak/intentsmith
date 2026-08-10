// MN-pagination-end — the end of a stream is stated, never inferred.
// ==============================================================================
//
// TEST-STRATEGY.md §7 (`MR-05` row) authorises this suite: it pins *server*
// behaviour that exists today.  It deliberately asserts nothing about how the
// client pages, because that is still `MISSING_IMPLEMENTATION` and its shape is
// the subject of WP-MOBILE-028.
//
// What is actually at stake.  `SS-03` forbids a silently truncated window: at
// the edge of what was downloaded the user must be told that older messages
// need a connection, and must never be shown a cut-off history that looks
// complete.  A client can only keep that promise if the server distinguishes
// "this is the last page" from "this page happens to be full".  §8.6 buys that
// distinction by over-fetching one row, and the exact-multiple case below is
// the one where a naive `items.length === limit` check gets it wrong.
//
// The last two tests record why the client cannot keep `SS-03` today.  They
// assert server behaviour only, so they stay true after WP-MOBILE-028 lands.
//
// The listener is owned by this suite, so `requirements.server` is false.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { OfflineUpstream } from '../src/mobile/upstream.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { createPairingCode } from '../src/mobile/pairing.js';

const MAX_PAGE_SIZE = 100;      // handlers.js — the ceiling a client may ask for
const CLIENT_THREAD_LIMIT = 100; // app.js `loadThread` — what the client asks for today

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

console.log('\n=== Mobile pagination end (MN-pagination-end) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-pagination-end-'));
const db = new Database(path.join(runtimeDir, 'pagination.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const insertConversation = db.prepare(`
  INSERT INTO conversations (id, title, message_count, state, updated_at) VALUES (?, ?, ?, ?, ?)
`);
const insertMessage = db.prepare(`
  INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)
`);

/**
 * A conversation whose messages are numbered 1..count in send order.
 *
 * `message_count` is seeded at 0 on purpose: the `messages_count_ai` trigger
 * from the baseline migration maintains the column, so setting it here too
 * would double it and quietly make `conversation.messageCount` untrustworthy
 * in exactly the test that relies on it.
 */
function seedConversation(id, count) {
  insertConversation.run(id, `Konverzace ${id}`, 0, 'active', '2026-01-01T00:00:00.000Z');
  for (let i = 1; i <= count; i++) {
    insertMessage.run(id, i % 2 ? 'user' : 'assistant', `zpráva ${i}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
  }
}

// 250 is deliberately more than MAX_PAGE_SIZE, so "ask for the maximum" is not
// a way to dodge paging.  200 is an exact multiple of a 50-row page.
seedConversation('conv-long', 250);
seedConversation('conv-exact', 200);
seedConversation('conv-empty', 0);
seedConversation('conv-single', 1);

const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream: new OfflineUpstream(),
  journal: new OperationJournal(db),
  env: { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' },
  logger: { error: () => {}, warn: () => {}, info: () => {} },
});

const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
const claimed = await fetch(`${gateway.url}/m1/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: issued.code, deviceName: 'pagination test device' }),
});
assert.equal(claimed.status, 200, 'pairing must succeed for this suite to mean anything');
const device = (await claimed.json()).data;

async function get(pathname) {
  const response = await fetch(gateway.url + pathname, {
    headers: { authorization: `Bearer ${device.token}` },
  });
  let body = null;
  try { body = await response.json(); } catch { /* some responses have no body */ }
  return { status: response.status, body };
}

/** One page of a thread, with the envelope fields SS-03 depends on. */
async function threadPage(id, { limit, cursor = null } = {}) {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  const suffix = query.toString() ? `?${query}` : '';
  const response = await get(`/m1/conversations/${encodeURIComponent(id)}${suffix}`);
  assert.equal(response.status, 200, `page request failed: ${JSON.stringify(response.body)}`);
  return {
    messages: response.body.data.messages,
    hasMore: response.body.hasMore,
    end: response.body.end,
    nextCursor: response.body.nextCursor,
    conversation: response.body.data.conversation,
  };
}

/** Walk a thread to exhaustion, following only cursors the server issued. */
async function walkThread(id, limit) {
  const seen = [];
  const pages = [];
  let cursor = null;
  // A stream this size must terminate well inside the bound; the bound only
  // stops a runaway from hanging the suite.
  for (let guard = 0; guard <= 64; guard++) {
    const page = await threadPage(id, { limit, cursor });
    pages.push(page);
    seen.push(...page.messages.map(message => message.content));
    if (!page.nextCursor) return { seen, pages };
    assert.equal(page.hasMore, true, 'a page that issues a cursor must admit there is more');
    cursor = page.nextCursor;
  }
  throw new Error('pagination did not terminate within 64 pages');
}

try {
  await test('a full page that is not the last says so, and hands out a cursor', async () => {
    const page = await threadPage('conv-long', { limit: 50 });
    assert.equal(page.messages.length, 50);
    assert.equal(page.hasMore, true);
    assert.equal(page.end, false);
    assert.ok(page.nextCursor, 'a continuing stream must issue a next cursor');
  });

  await test('the last page states the end and issues no further cursor', async () => {
    const { pages } = await walkThread('conv-long', 50);
    const last = pages.at(-1);
    assert.equal(last.hasMore, false);
    assert.equal(last.end, true);
    assert.equal(last.nextCursor, null,
      'a client handed a cursor at the end would page an empty tail forever');
  });

  await test('a stream whose length is an exact multiple of the page ends cleanly', async () => {
    // The case §8.6 exists for.  With `items.length === limit` as the test, the
    // 4th page of 200 rows looks unfinished and the client fetches an empty 5th.
    const { seen, pages } = await walkThread('conv-exact', 50);
    assert.equal(seen.length, 200);
    assert.equal(pages.length, 4, `expected exactly 4 pages, got ${pages.length}`);
    assert.equal(pages.at(-1).messages.length, 50, 'the final page is genuinely full');
    assert.equal(pages.at(-1).end, true, 'a full final page must still be reported as the end');
    assert.equal(pages.at(-1).nextCursor, null);
  });

  await test('walking the cursor reaches every message exactly once, in order', async () => {
    const { seen } = await walkThread('conv-long', 50);
    const expected = Array.from({ length: 250 }, (_, i) => `zpráva ${i + 1}`);
    assert.equal(seen.length, 250, 'no message may be skipped');
    assert.equal(new Set(seen).size, 250, 'no message may be served twice');
    assert.deepEqual(seen, expected, 'order must be stable across page boundaries');
  });

  await test('an empty conversation is an immediate, explicit end', async () => {
    // SS-02 vs SS-03: "no messages yet" must be a confirmed answer, not an
    // unfinished stream the client keeps trying to complete.
    const page = await threadPage('conv-empty', { limit: 50 });
    assert.deepEqual(page.messages, []);
    assert.equal(page.hasMore, false);
    assert.equal(page.end, true);
    assert.equal(page.nextCursor, null);
  });

  await test('a conversation shorter than one page ends on that page', async () => {
    const page = await threadPage('conv-single', { limit: 50 });
    assert.equal(page.messages.length, 1);
    assert.equal(page.end, true);
    assert.equal(page.nextCursor, null);
  });

  await test('a message appended mid-walk neither skips nor duplicates a row', async () => {
    // Offset paging is normally unsafe under concurrent writes.  It is safe
    // *here* only because this stream is append-only and ordered ascending, so
    // an insert lands beyond every offset already issued.  That is a property
    // of the query, not a general guarantee — if the order ever becomes
    // `DESC`, or deletion becomes possible, this test is where it breaks.
    const first = await threadPage('conv-long', { limit: 10 });
    insertMessage.run('conv-long', 'user', 'zpráva 251', '2026-01-01T01:00:00.000Z');
    try {
      const second = await threadPage('conv-long', { limit: 10, cursor: first.nextCursor });
      assert.equal(second.messages[0].content, 'zpráva 11',
        'the second page must continue where the first ended');
      assert.equal(new Set([...first.messages, ...second.messages].map(m => m.id)).size, 20,
        'no row may appear on both pages');
    } finally {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ? AND content = ?`)
        .run('conv-long', 'zpráva 251');
    }
  });

  await test('limit is clamped to the ceiling instead of being honoured or refused', async () => {
    for (const limit of [500, 10_000]) {
      const page = await threadPage('conv-long', { limit });
      assert.equal(page.messages.length, MAX_PAGE_SIZE,
        `limit=${limit} must be clamped to ${MAX_PAGE_SIZE}`);
      assert.equal(page.hasMore, true, 'clamping must not be mistaken for the end');
    }
  });

  await test('the conversation list paginates to an explicit end as well', async () => {
    const page = await get('/m1/conversations?limit=2');
    assert.equal(page.status, 200);
    assert.equal(page.body.data.length, 2);
    assert.equal(page.body.hasMore, true);

    let cursor = page.body.nextCursor;
    let total = page.body.data.length;
    let last = page.body;
    for (let guard = 0; cursor && guard <= 16; guard++) {
      const next = await get(`/m1/conversations?limit=2&cursor=${encodeURIComponent(cursor)}`);
      assert.equal(next.status, 200);
      total += next.body.data.length;
      cursor = next.body.nextCursor;
      last = next.body;
    }
    assert.equal(total, 4, 'all four seeded conversations must be reachable');
    assert.equal(last.end, true);
    assert.equal(last.nextCursor, null);
  });

  // ── Why the client cannot keep SS-03 today ────────────────────────────────
  //
  // Both tests below assert server behaviour, so they remain true once the
  // client learns to page.  They exist so the gap is recorded as a measured
  // fact rather than an assertion in a document.

  await test('one maximum-size request does not reach the newest message', async () => {
    // This is exactly the request `loadThread` issues today.
    const page = await threadPage('conv-long', { limit: CLIENT_THREAD_LIMIT });
    assert.equal(page.messages.length, MAX_PAGE_SIZE);
    assert.equal(page.messages.at(0).content, 'zpráva 1',
      'the first page is the oldest end of the stream');
    assert.equal(page.messages.at(-1).content, 'zpráva 100');
    assert.ok(!page.messages.some(message => message.content === 'zpráva 250'),
      'the newest message is not in the first page of a 250-message conversation');
    // The server does say so.  A client that ignores this renders a truncated
    // history with nothing on screen admitting it — the silent cut SS-03 forbids.
    assert.equal(page.hasMore, true);
    assert.ok(page.nextCursor, 'the server offers the means to continue');
    assert.equal(page.conversation.messageCount, 250,
      'and states the true length, so the shortfall is detectable');
  });

  await test('the newest page cannot be requested directly on this contract', async () => {
    // No anchor, offset or direction parameter reaches the tail of the stream:
    // unknown query parameters are ignored, so each of these silently returns
    // page one.  Reaching the newest message therefore costs a full forward
    // walk.  WP-MOBILE-028 §4 turns this into the decision it implies.
    for (const query of ['offset=150', 'order=desc', 'before=250', 'anchor=latest', 'direction=backward']) {
      const response = await get(`/m1/conversations/conv-long?limit=${CLIENT_THREAD_LIMIT}&${query}`);
      assert.equal(response.status, 200, `${query} is ignored, not refused`);
      assert.equal(response.body.data.messages.at(0).content, 'zpráva 1',
        `${query} must not be mistaken for a way to reach the newest page`);
    }
  });
} finally {
  await gateway.stop();
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile pagination end: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
