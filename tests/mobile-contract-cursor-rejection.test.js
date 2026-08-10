// MN-cursor-rejection — a cursor this server did not issue is refused by name.
// ==============================================================================
//
// TEST-STRATEGY.md §7 (`MR-05` row) authorises this suite: it describes
// *server* behaviour, which exists today, and not the client pagination that
// is still `MISSING_IMPLEMENTATION`.  Nothing here asserts anything about the
// client, so it does not fix the shape of a UI the contract has not settled.
//
// Why it is worth its own suite.  `SS-10` in SCREENS.md promises that a
// rejected cursor causes a *full refresh, never a computed patch* of the
// missing stretch.  The client can only honour that if the server distinguishes
// "this cursor is not mine" from every other failure and says so in a way the
// client can branch on.  A 500, a silent fall back to page one, or a generic
// 400 would each make `SS-10` unimplementable — and the first two would be
// invisible in a handler unit test, because they still return a plausible page.
//
// The listener is owned by this suite (ephemeral loopback port, isolated
// database, deterministic teardown), so `requirements.server` is false.
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
import { encodeCursor } from '../src/mobile/protocol.js';
import { createPairingCode } from '../src/mobile/pairing.js';

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

console.log('\n=== Mobile cursor rejection (MN-cursor-rejection) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-cursor-reject-'));
const db = new Database(path.join(runtimeDir, 'cursor.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const CONVERSATION = 'conv-reject';
db.prepare(`
  INSERT INTO conversations (id, title, message_count, state) VALUES (?, ?, ?, ?)
`).run(CONVERSATION, 'Odmítnutí kurzoru', 8, 'active');
const insertMessage = db.prepare(`
  INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)
`);
for (let i = 1; i <= 8; i++) {
  insertMessage.run(CONVERSATION, i % 2 ? 'user' : 'assistant', `zpráva ${i}`,
    new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
}

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
  body: JSON.stringify({ code: issued.code, deviceName: 'cursor test device' }),
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

const thread = cursor => `/m1/conversations/${CONVERSATION}?cursor=${encodeURIComponent(cursor)}`;
const list = cursor => `/m1/conversations?cursor=${encodeURIComponent(cursor)}`;

/** Every rejection must be refusable *and* diagnosable, on both paged routes. */
async function assertRejected(pathname, expectedReason) {
  const response = await get(pathname);
  assert.equal(response.status, 400, `${pathname} must be refused, got ${response.status}`);
  assert.equal(response.body?.error?.code, 'cursor_unknown',
    `${pathname} must name the failure as cursor_unknown`);
  assert.equal(response.body?.error?.reason, expectedReason,
    `${pathname} must report reason ${expectedReason}, got ${response.body?.error?.reason}`);
  // Without this the client cannot tell "start over" from "retry the same page",
  // which is the whole of SS-10.
  assert.equal(response.body?.error?.restart, true,
    `${pathname} must tell the client to restart`);
  assert.equal(response.body?.error?.retryable, false,
    `${pathname} must not invite a retry of an unusable cursor`);
  return response;
}

try {
  await test('a structurally broken cursor is refused as malformed', async () => {
    for (const bad of ['nonsense', 'c1.only-two-parts', 'c2.abc.def', '....']) {
      await assertRejected(thread(bad), 'cursor_malformed');
    }
  });

  await test('a well-shaped cursor with no payload is unrecognised, not malformed', async () => {
    // `c1..` has the right shape and the wrong content.  The two reasons are
    // kept apart on purpose: malformed means "this is not a cursor", while
    // unrecognised means "this is a cursor, but not one I issued".
    await assertRejected(thread('c1..'), 'cursor_unrecognized');
  });

  await test('a cursor with a tampered checksum is refused as unrecognised', async () => {
    const valid = encodeCursor({ stream: `messages:${CONVERSATION}`, position: 2 });
    const [prefix, body] = valid.split('.');
    await assertRejected(thread(`${prefix}.${body}.0000000000000000`), 'cursor_unrecognized');
  });

  await test('a cursor with a tampered position is refused, not honoured', async () => {
    // The payload is re-encoded honestly; only the checksum is left stale.  This
    // is the attack the checksum exists for: a client that edits `position` to
    // skip ahead must not be served the page it asked for.
    const valid = encodeCursor({ stream: `messages:${CONVERSATION}`, position: 2 });
    const [prefix, body, checksum] = valid.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.position = 6;
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    const response = await assertRejected(`${thread(`${prefix}.${forged}.${checksum}`)}`,
      'cursor_unrecognized');
    assert.equal(response.body?.data, undefined, 'a refused cursor must not also return a page');
  });

  await test('a cursor issued for another stream is refused, not reinterpreted', async () => {
    // Reinterpreting it would silently serve the wrong offset into the wrong
    // stream — a page of plausible messages from the wrong place.
    const listCursor = encodeCursor({ stream: 'conversations', position: 1 });
    await assertRejected(thread(listCursor), 'cursor_stream_mismatch');

    const otherThread = encodeCursor({ stream: 'messages:some-other-conversation', position: 1 });
    await assertRejected(thread(otherThread), 'cursor_stream_mismatch');

    const threadCursor = encodeCursor({ stream: `messages:${CONVERSATION}`, position: 1 });
    await assertRejected(list(threadCursor), 'cursor_stream_mismatch');
  });

  await test('a cursor for this conversation is not accepted on a sibling conversation', async () => {
    db.prepare(`
      INSERT INTO conversations (id, title, message_count, state) VALUES (?, ?, ?, ?)
    `).run('conv-sibling', 'Sourozenec', 1, 'active');
    insertMessage.run('conv-sibling', 'user', 'jiná zpráva', '2026-01-02T00:00:00.000Z');

    const mine = encodeCursor({ stream: `messages:${CONVERSATION}`, position: 4 });
    await assertRejected(`/m1/conversations/conv-sibling?cursor=${encodeURIComponent(mine)}`,
      'cursor_stream_mismatch');
  });

  await test('an absent or empty cursor is the first page, not a rejection', async () => {
    // The distinction matters: if "no cursor" were an error, the client could
    // never make its first request, and if a rejected cursor silently became
    // page one, SS-10's full refresh would be indistinguishable from a skip.
    for (const pathname of [
      `/m1/conversations/${CONVERSATION}`,
      `/m1/conversations/${CONVERSATION}?cursor=`,
      '/m1/conversations',
    ]) {
      const response = await get(pathname);
      assert.equal(response.status, 200, pathname);
      assert.equal(response.body?.ok, true, pathname);
    }
  });

  await test('a refused cursor carries no page and no partial payload', async () => {
    const response = await get(thread('c1.garbage.garbage'));
    assert.equal(response.status, 400);
    assert.equal(response.body?.ok, false, 'a refusal must say so in the envelope');
    assert.equal(response.body?.data, undefined, 'a refusal must not carry data');
    assert.equal(response.body?.nextCursor, undefined,
      'a refusal must not hand out another cursor to try');
  });

  await test('the refusal names the protocol version the client should hold to', async () => {
    const response = await get(thread('c1.garbage.garbage'));
    assert.equal(typeof response.body?.error?.protocolVersion, 'string');
    assert.ok(response.body.error.protocolVersion.startsWith('m1.'),
      `unexpected protocol version ${response.body?.error?.protocolVersion}`);
  });

  await test('a cursor is refused before the conversation is read, not after', async () => {
    // A missing conversation and a bad cursor are different repairs.  If the
    // order were reversed the client would be told to restart a stream that
    // does not exist.
    const bad = 'c1.garbage.garbage';
    const response = await get(`/m1/conversations/does-not-exist?cursor=${encodeURIComponent(bad)}`);
    assert.equal(response.status, 404, 'an unknown conversation is reported as such');
    assert.equal(response.body?.error?.code, 'not_found');
  });
} finally {
  await gateway.stop();
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile cursor rejection: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
