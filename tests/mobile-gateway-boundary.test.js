// S-4 — mobile gateway boundary, exercised against a *running* listener.
// ==============================================================================
//
// The policy tests in legacy-listener-boundary.test.js prove the decision
// function refuses things.  They cannot prove the listener consults it.  This
// suite closes that gap by starting a real gateway and speaking HTTP to it, so
// a wiring mistake — a handler mounted before the guard, a stray catch-all, a
// static route that escapes the allow-list — fails here.
//
// The listener is owned by this suite (ephemeral loopback port, isolated
// database, deterministic teardown), so it declares `requirements.server:
// false`.  That flag means "needs a server I do not own"; here there is no such
// dependency, which is what makes the suite runnable rather than BLOCKED.
//
// The negative list is taken from PLAN.md §2.
//
// ==============================================================================

// Direct-run isolation bootstrap.  Must be the first import: it redirects
// HOME/TMPDIR/XDG_* into a private root, so the `mkdtemp` below lands inside
// the sandbox instead of the real system temp.
import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway, assertMobileGatewayBind, REMOTE_BIND_ACKNOWLEDGEMENT } from '../src/mobile/gateway.js';
import { OfflineUpstream } from '../src/mobile/upstream.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { UNKNOWN_REASONS } from '../src/mobile/protocol.js';
import { createPairingCode, revokeDevice } from '../src/mobile/pairing.js';

const UNKNOWN_REASON_CODES = Object.values(UNKNOWN_REASONS);

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

console.log('\n=== Mobile gateway boundary (running listener) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-gw-boundary-'));
const dbPath = path.join(runtimeDir, 'boundary.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
await runMigrations(db);

const env = { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' };

/**
 * An offline upstream that counts dispatch attempts.  "The same key produces no
 * second effect" is otherwise unprovable from the outside: a replayed response
 * and a genuinely repeated call look identical on the wire.
 */
class CountingUpstream extends OfflineUpstream {
  constructor() { super(); this.dispatches = 0; }
  async postChat(args) { this.dispatches++; return super.postChat(args); }
}

const upstream = new CountingUpstream();

const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream,
  journal: new OperationJournal(db),
  env,
  logger: { error: () => {}, warn: () => {}, info: () => {} },
});

const base = gateway.url;

async function call(pathname, { method = 'GET', token = null, body = null, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(base + pathname, {
    method, headers: requestHeaders, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* some responses have no body */ }
  return { status: response.status, body: json, headers: response.headers };
}

/** Send a raw HTTP request and return the response head; used for upgrades. */
function rawRequest(requestLine, headerLines) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(gateway.port, '127.0.0.1', () => {
      socket.write(`${requestLine}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    });
    let data = '';
    socket.setTimeout(5000, () => { socket.destroy(); resolve(data || 'TIMEOUT'); });
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('\r\n\r\n')) { socket.destroy(); resolve(data); }
    });
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
  });
}

/** Pair a device and return its token. */
async function pairDevice(scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const claimed = await call('/m1/pair/claim', {
    method: 'POST', body: { code: issued.code, deviceName: 'test device' },
  });
  assert.equal(claimed.status, 200, `pairing failed: ${JSON.stringify(claimed.body)}`);
  return claimed.body.data;
}

try {
  // ── PLAN.md §2: remote peer must not reach any legacy surface ────────────
  await test('legacy /api/* routes are unreachable through the gateway', async () => {
    for (const route of [
      '/api/projects', '/api/chat', '/api/conversations', '/api/agents',
      '/api/system/health', '/api/settings', '/api/skills',
    ]) {
      const response = await call(route);
      assert.equal(response.status, 404, `${route} must not exist on the gateway`);
      assert.equal(response.body?.error?.code, 'route_not_allowed', route);
    }
  });

  await test('device token cannot reach /api/security/*', async () => {
    const device = await pairDevice(['read:chat']);
    for (const route of ['/api/security/tokens', '/api/security/audit']) {
      const response = await call(route, { token: device.token });
      assert.equal(response.status, 404, route);
    }
  });

  await test('the WebSocket terminal is unreachable, with and without a token', async () => {
    const device = await pairDevice(['read:chat', 'write:chat']);
    for (const route of ['/c3/ws', '/ws', '/m1/ws']) {
      assert.equal((await call(route)).status, 404, `${route} anonymous`);
      assert.equal((await call(route, { token: device.token })).status, 404, `${route} with token`);

      // fetch() forbids Connection/Upgrade headers, so the handshake is sent
      // over a raw socket.  A gateway that answered 101 here would hand the
      // phone the terminal channel, which is the single worst outcome in
      // PLAN.md §2 — it has to be tested at the protocol level, not through a
      // client that cannot express the attack.
      const raw = await rawRequest(
        `GET ${route} HTTP/1.1`,
        [
          `Host: 127.0.0.1:${gateway.port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          `Authorization: Bearer ${device.token}`,
        ],
      );
      // Assert on the status line only — a body or a content-length can
      // contain "101" as a substring and would mask a real 101 or hide a pass.
      const statusLine = raw.split('\r\n')[0] || '';
      assert.ok(!/^HTTP\/1\.1 101/.test(statusLine), `${route} must never switch protocols: ${statusLine}`);
      assert.ok(/^HTTP\/1\.1 404/.test(statusLine), `${route} upgrade should 404, got: ${statusLine}`);
    }
  });

  await test('no exec/terminal channel exists on any allowed route', async () => {
    const device = await pairDevice(['write:chat']);
    const response = await call('/m1/chat', {
      method: 'POST', token: device.token,
      body: { type: 'exec', command: 'id', conversationId: 'c1', message: 'x', operationId: 'a'.repeat(24) },
    });
    // It may fail for upstream reasons, but it must never be an exec path.
    assert.notEqual(response.status, 200);
    assert.ok(!JSON.stringify(response.body || {}).includes('uid='), 'no command output may appear');
  });

  // ── Token lifecycle: expired and revoked are distinguishable ─────────────
  await test('revoked token is rejected and named as revoked, not merely invalid', async () => {
    const device = await pairDevice(['read:chat']);
    assert.equal((await call('/m1/conversations', { token: device.token })).status, 200);

    assert.equal(revokeDevice(db, device.deviceId), true);

    const after = await call('/m1/conversations', { token: device.token });
    assert.equal(after.status, 401);
    // DATA-MODEL §8.3: the client shows a different screen for revocation.
    assert.equal(after.body.error.code, 'token_revoked');
  });

  await test('expired token is rejected and named as expired', async () => {
    const device = await pairDevice(['read:chat']);
    db.prepare("UPDATE api_tokens SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(device.deviceId);
    const response = await call('/m1/conversations', { token: device.token });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'token_expired');
  });

  await test('unknown and malformed tokens are rejected as invalid', async () => {
    for (const token of ['c3_nonexistent', 'garbage', 'Bearer', '../../etc/passwd']) {
      const response = await call('/m1/conversations', { token });
      assert.equal(response.status, 401, token);
      assert.equal(response.body.error.code, 'token_invalid', token);
    }
  });

  await test('missing token is distinct from an invalid one and sets WWW-Authenticate', async () => {
    const response = await call('/m1/conversations');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'token_missing');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  });

  await test('admin-token headers and query parameters grant nothing', async () => {
    const attempts = [
      { headers: { 'x-admin-token': 'anything' } },
      { headers: { 'X-Admin-Token': 'anything' } },
    ];
    for (const attempt of attempts) {
      const response = await call('/m1/conversations', attempt);
      assert.equal(response.status, 401, JSON.stringify(attempt));
      assert.equal(response.body.error.code, 'token_missing');
    }
    const viaQuery = await call('/m1/conversations?token=c3_whatever&access_token=c3_whatever');
    assert.equal(viaQuery.status, 401);
    assert.equal(viaQuery.body.error.code, 'token_missing');
  });

  // ── Scope enforcement (B2, non-negotiable even for the spike) ────────────
  await test('a scoped token reaches only its own operations', async () => {
    const readOnly = await pairDevice(['read:chat']);

    assert.equal((await call('/m1/conversations', { token: readOnly.token })).status, 200);

    const write = await call('/m1/chat', {
      method: 'POST', token: readOnly.token,
      body: { conversationId: 'c1', message: 'hi', operationId: 'b'.repeat(24) },
    });
    assert.equal(write.status, 403);
    assert.equal(write.body.error.code, 'scope_required');
    assert.equal(write.body.error.requiredScope, 'write:chat');

    const caps = await call('/m1/capabilities', { token: readOnly.token });
    assert.equal(caps.status, 403, 'read:capabilities was not granted');
  });

  await test('pairing cannot escalate to admin or terminal scopes', async () => {
    const issued = createPairingCode(db, {
      scopes: ['read:chat', 'admin', 'write:security', 'exec', 'terminal', 'admin:*'],
      ttlMs: 60_000,
    });
    const claimed = await call('/m1/pair/claim', { method: 'POST', body: { code: issued.code } });
    assert.equal(claimed.status, 200);
    for (const forbidden of ['admin', 'write:security', 'exec', 'terminal', 'admin:*']) {
      assert.ok(!claimed.body.data.scopes.includes(forbidden), `${forbidden} must never be granted`);
    }
    assert.deepEqual(claimed.body.data.scopes, ['read:chat']);
  });

  // ── Pairing: single use, TTL, brute force, kill switch ───────────────────
  await test('a pairing code is single use — the second claim is a 409', async () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    const first = await call('/m1/pair/claim', { method: 'POST', body: { code: issued.code } });
    assert.equal(first.status, 200);

    const second = await call('/m1/pair/claim', { method: 'POST', body: { code: issued.code } });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'pairing_already_used');
  });

  await test('concurrent claims of one code yield exactly one token', async () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    // The race the conditional UPDATE exists to lose safely.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call('/m1/pair/claim', { method: 'POST', body: { code: issued.code } })),
    );
    const successes = results.filter(result => result.status === 200);
    assert.equal(successes.length, 1, `expected exactly one winner, got ${successes.length}`);
    for (const loser of results.filter(result => result.status !== 200)) {
      assert.equal(loser.status, 409, 'losers must see a conflict, not a server error');
    }
  });

  await test('an expired pairing code is refused', async () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 30_000 });
    db.prepare("UPDATE mobile_pairing_codes SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(issued.id);
    const response = await call('/m1/pair/claim', { method: 'POST', body: { code: issued.code } });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'pairing_expired');
  });

  await test('brute force against pairing does not yield a token', async () => {
    const guesses = Array.from({ length: 25 }, (_, i) => `guess-${i}-${'x'.repeat(20)}`);
    for (const guess of guesses) {
      const response = await call('/m1/pair/claim', { method: 'POST', body: { code: guess } });
      assert.notEqual(response.status, 200, 'a guessed code must never succeed');
      assert.equal(response.body.error.code, 'token_invalid');
    }
  });

  await test('the pairing kill switch disables claiming globally', async () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    const offGateway = await startMobileGateway({
      rawDb: db, host: '127.0.0.1', port: 0,
      upstream: new OfflineUpstream(), journal: new OperationJournal(db),
      env: { ...process.env, C3_MOBILE_PAIRING: 'off', C3_MOBILE_UI: 'off' },
      logger: { error: () => {}, warn: () => {}, info: () => {} },
    });
    try {
      const response = await fetch(`${offGateway.url}/m1/pair/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: issued.code }),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'pairing_disabled');
      // The code must survive a refused claim — a disabled switch must not
      // silently burn codes.
      const row = db.prepare('SELECT claimed_at FROM mobile_pairing_codes WHERE id = ?').get(issued.id);
      assert.equal(row.claimed_at, null);
    } finally {
      await offGateway.stop();
    }
  });

  // ── Recovery from the open-operation cap (UI-DESIGN §6.9) ────────────────
  //
  // The cap refuses every further mutation and unresolved records never expire,
  // so without a way out the app reaches a state it cannot leave.  These two
  // routes are that way out, and they must work for a device holding no scope
  // beyond what pairing gave it.
  await test('a device can list its own open operations', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'listme' + 'a'.repeat(18);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });

    const response = await call('/m1/operations', { token: device.token });
    assert.equal(response.status, 200);
    assert.ok(response.body.data.some(entry => entry.operationId === operationId));
    assert.equal(response.body.limit, 32);
  });

  await test('a device never sees another device\'s operations', async () => {
    const mine = await pairDevice(['write:chat']);
    const theirs = await pairDevice(['write:chat']);
    const secret = 'theirsecret' + 'b'.repeat(13);
    gateway.journal.begin({
      deviceId: theirs.deviceId, operationId: secret,
      operationType: 'chat.send', request: { m: 'private' },
    });

    const response = await call('/m1/operations', { token: mine.token });
    assert.equal(response.status, 200);
    assert.ok(!response.body.data.some(entry => entry.operationId === secret));
  });

  await test('abandoning an unresolved attempt releases the cap and says the effect is unknown', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'abandonme' + 'c'.repeat(15);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });
    gateway.journal.markUnknown(device.deviceId, operationId, 'upstream_timeout');

    const before = (await call('/m1/operations', { token: device.token })).body.open;

    const response = await call(`/m1/operations/${operationId}/abandon`, {
      method: 'POST', token: device.token,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.abandoned, true);
    // MD-19: closing the record does not close the operation, and the response
    // must not pretend otherwise.
    assert.equal(response.body.data.effectStillUnknown, true);
    assert.equal(response.body.data.open, before - 1);
  });

  await test('a resolved operation cannot be abandoned — that would destroy the answer', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'resolved' + 'd'.repeat(16);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });
    gateway.journal.confirm(device.deviceId, operationId, { ok: true });

    const response = await call(`/m1/operations/${operationId}/abandon`, {
      method: 'POST', token: device.token,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'state_conflict');
    assert.equal(response.body.error.reason, 'already_resolved');
    assert.equal(gateway.journal.lookup(device.deviceId, operationId).known, true);
  });

  await test('the UNKNOWN reason is a code from the closed list, never free text', async () => {
    const device = await pairDevice(['write:chat']);
    const listOf = async () => (await call('/m1/operations', { token: device.token })).body.data;

    // A transport code is narrowed to the vocabulary the client can switch on.
    const mapped = 'whyunknown' + 'e'.repeat(14);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId: mapped,
      operationType: 'chat.send', request: { m: 'x' },
    });
    gateway.journal.markUnknown(device.deviceId, mapped, 'upstream_refused');

    // Anything unrecognised degrades to `unspecified` rather than travelling to
    // the screen — an upstream error string must never become user-facing copy.
    const garbage = 'freetext' + 'g'.repeat(16);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId: garbage,
      operationType: 'chat.send', request: { m: 'x' },
    });
    gateway.journal.markUnknown(device.deviceId, garbage, 'ECONNRESET while talking to 10.0.0.4');

    const listed = await listOf();
    const mappedRow = listed.find(entry => entry.operationId === mapped);
    const garbageRow = listed.find(entry => entry.operationId === garbage);
    assert.equal(mappedRow.unknownReason, 'upstream_unreachable');
    assert.equal(garbageRow.unknownReason, 'unspecified');
    for (const row of [mappedRow, garbageRow]) {
      assert.ok(UNKNOWN_REASON_CODES.includes(row.unknownReason), row.unknownReason);
      // Age is measured from when it became UNKNOWN, not from when it started.
      assert.ok(row.unknownAt, 'unknown_at must be stamped');
    }
  });

  await test('a lookup records when the state was last verified', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'lastcheck' + 'h'.repeat(15);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });

    const before = (await call('/m1/operations', { token: device.token })).body.data
      .find(entry => entry.operationId === operationId);
    assert.equal(before.lastCheckedAt, null, 'nothing has verified it yet');

    assert.equal((await call(`/m1/operations/${operationId}`, { token: device.token })).status, 200);

    const after = (await call('/m1/operations', { token: device.token })).body.data
      .find(entry => entry.operationId === operationId);
    // The recovery screen says "checked N ago" instead of implying the state is
    // live; without this stamp there is nothing to say it with (UI-DESIGN §16).
    assert.ok(after.lastCheckedAt, 'the lookup must record that it happened');
  });

  await test('operations left PENDING by a dead process become UNKNOWN at start', async () => {
    // A crash leaves rows claiming to be running.  They would hold a slot in
    // the per-device cap that nothing could ever release, and the user would be
    // told "still sending" about a process that no longer exists.
    const crashedDir = mkdtempSync(path.join(tmpdir(), 'is-gw-crash-'));
    const crashedDb = new Database(path.join(crashedDir, 'crashed.sqlite'));
    crashedDb.pragma('journal_mode = WAL');
    await runMigrations(crashedDb);

    const journal = new OperationJournal(crashedDb);
    const operationId = 'survivor' + 'i'.repeat(16);
    journal.begin({
      deviceId: 'device-crashed', operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });
    assert.equal(journal.lookup('device-crashed', operationId).state, 'PENDING');

    const restarted = await startMobileGateway({
      rawDb: crashedDb, host: '127.0.0.1', port: 0,
      upstream: new OfflineUpstream(), journal, env,
      logger: { error: () => {}, warn: () => {}, info: () => {} },
    });
    try {
      const record = journal.lookup('device-crashed', operationId);
      assert.equal(record.state, 'UNKNOWN');
      assert.equal(record.unknownReason, 'process_terminated');
      assert.ok(record.unknownAt);
    } finally {
      await restarted.stop();
      crashedDb.close();
      rmSync(crashedDir, { recursive: true, force: true });
    }
  });

  await test('one device cannot abandon another device\'s operation', async () => {
    const mine = await pairDevice(['write:chat']);
    const theirs = await pairDevice(['write:chat']);
    const operationId = 'notyours' + 'f'.repeat(16);
    gateway.journal.begin({
      deviceId: theirs.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });

    const response = await call(`/m1/operations/${operationId}/abandon`, {
      method: 'POST', token: mine.token,
    });
    assert.equal(response.status, 404);
    assert.equal(gateway.journal.lookup(theirs.deviceId, operationId).known, true);
  });

  // ── The authorization contract for reading an operation ──────────────────
  //
  // `GET /m1/operations/:id` carries no scope on purpose (see the policy note in
  // gateway-policy.js).  What protects it instead is that the token decides the
  // deviceId and the lookup is filtered by it, so a key belonging to someone
  // else is simply not found.  That is a stronger guarantee than a scope check
  // — but only for as long as it is tested, which is what this block is for.
  // The names are deliberately literal: they are the contract.

  await test('a valid token cannot read another device operation', async () => {
    const mine = await pairDevice(['write:chat']);
    const theirs = await pairDevice(['write:chat']);
    const operationId = 'crossread' + 'j'.repeat(15);
    gateway.journal.begin({
      deviceId: theirs.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'private' },
    });

    const response = await call(`/m1/operations/${operationId}`, { token: mine.token });
    assert.equal(response.status, 404);
    assert.equal(response.body.data.known, false);
    assert.equal(response.body.data.state, null);
    // Nothing about the other device's attempt may leak through the refusal.
    assert.ok(!JSON.stringify(response.body).includes(theirs.deviceId));
    assert.ok(!JSON.stringify(response.body).includes('chat.send'));
  });

  await test('a revoked token cannot read its own operation', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'revokedread' + 'k'.repeat(13);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });
    assert.equal((await call(`/m1/operations/${operationId}`, { token: device.token })).status, 200);

    assert.equal(revokeDevice(db, device.deviceId), true);

    const after = await call(`/m1/operations/${operationId}`, { token: device.token });
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'token_revoked');
    // The record itself survives — revocation ends access, it does not resolve
    // an operation or erase the evidence that it happened.
    assert.equal(gateway.journal.lookup(device.deviceId, operationId).known, true);
  });

  await test('an expired token cannot read its own operation', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'expiredread' + 'l'.repeat(13);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });
    db.prepare("UPDATE api_tokens SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(device.deviceId);

    const response = await call(`/m1/operations/${operationId}`, { token: device.token });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'token_expired');
  });

  await test('a token that is both revoked and expired reports revoked, not expired', async () => {
    // Order matters to the user: "your access was withdrawn" and "your access
    // ran out" lead to different actions, and reporting the milder of the two
    // would hide a security event behind routine housekeeping.
    const device = await pairDevice(['write:chat']);
    const operationId = 'bothcauses' + 'm'.repeat(14);
    gateway.journal.begin({
      deviceId: device.deviceId, operationId,
      operationType: 'chat.send', request: { m: 'x' },
    });
    assert.equal(revokeDevice(db, device.deviceId), true);
    db.prepare("UPDATE api_tokens SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(device.deviceId);

    const response = await call(`/m1/operations/${operationId}`, { token: device.token });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'token_revoked');
  });

  await test('a guessed operationId cannot cross the device boundary', async () => {
    // The key is 128 bits of CSPRNG output on the client, but the server must
    // not depend on that: even a key handed over verbatim buys nothing, and a
    // refusal must look the same as for a key that never existed — otherwise
    // the 404 becomes an oracle for "this key exists somewhere".
    const mine = await pairDevice(['write:chat']);
    const theirs = await pairDevice(['write:chat']);
    const real = 'guessable' + 'n'.repeat(15);
    const invented = 'invented0' + 'o'.repeat(15);
    gateway.journal.begin({
      deviceId: theirs.deviceId, operationId: real,
      operationType: 'chat.send', request: { m: 'secret' },
    });

    const known = await call(`/m1/operations/${real}`, { token: mine.token });
    const unknown = await call(`/m1/operations/${invented}`, { token: mine.token });

    assert.equal(known.status, unknown.status);
    assert.deepEqual(
      { ...known.body.data, operationId: null },
      { ...unknown.body.data, operationId: null },
      'an existing key of another device must be indistinguishable from a made-up one',
    );

    // Guessing does not help on the write side either.
    const abandon = await call(`/m1/operations/${real}/abandon`, { method: 'POST', token: mine.token });
    assert.equal(abandon.status, 404);
    assert.equal(gateway.journal.lookup(theirs.deviceId, real).state, 'PENDING');
  });

  // ── Retry under the same key (MD-19 rules 1–3) ───────────────────────────

  await test('a retry with the same key produces no second effect', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'retrysame' + 'p'.repeat(15);
    const body = { conversationId: 'c-retry', message: 'jednou a dost', operationId };

    const before = upstream.dispatches;
    const first = await call('/m1/chat', { method: 'POST', token: device.token, body });
    // The upstream is offline, so the outcome is ambiguous — exactly the case
    // where a client is tempted to send again.
    assert.equal(first.status, 503);
    assert.equal(first.body.error.state, 'UNKNOWN');

    const second = await call('/m1/chat', { method: 'POST', token: device.token, body });
    assert.equal(second.status, 202, 'the same key is answered from the record');
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.data.state, 'UNKNOWN');

    assert.equal(upstream.dispatches - before, 1, 'the second request must not reach the upstream');
    assert.equal(
      gateway.journal.openOperations(device.deviceId).filter(e => e.operationId === operationId).length,
      1, 'one attempt, one record',
    );
  });

  await test('the same key with a different message is refused, not sent again', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'differing' + 'q'.repeat(15);
    const before = upstream.dispatches;

    await call('/m1/chat', {
      method: 'POST', token: device.token,
      body: { conversationId: 'c-diff', message: 'původní', operationId },
    });
    const conflicting = await call('/m1/chat', {
      method: 'POST', token: device.token,
      body: { conversationId: 'c-diff', message: 'jiná zpráva', operationId },
    });

    // Fail-closed: a different payload is a different operation, and guessing
    // which one the user meant would be worse than refusing (MD-19 rule 2).
    assert.equal(conflicting.status, 409);
    assert.equal(conflicting.body.error.code, 'operation_conflict');
    assert.equal(upstream.dispatches - before, 1);
  });

  // ── Static client surface ────────────────────────────────────────────────
  await test('with the UI disabled nothing but /m1 is served', async () => {
    for (const route of ['/', '/index.html', '/app.js', '/app.css', '/sw.js']) {
      assert.equal((await call(route)).status, 404, route);
    }
  });

  await test('path traversal and encoded separators are refused', async () => {
    for (const route of [
      '/m1/../package.json',
      '/m1/health/../../package.json',
      '/m1%2f..%2fpackage.json',
      '/m1/conversations/..%2f..%2fetc%2fpasswd',
      '/m1//health',
      '/m1/health\\..\\package.json',
    ]) {
      const response = await fetch(base + route);
      assert.ok(response.status === 404 || response.status === 400, `${route} → ${response.status}`);
      const text = await response.text();
      assert.ok(!text.includes('"dependencies"'), `${route} must not leak package.json`);
      assert.ok(!text.includes('root:x:'), `${route} must not leak /etc/passwd`);
    }
  });

  // ── Bind policy (PLAN.md §8.1) ───────────────────────────────────────────
  await test('non-loopback bind is refused fail-closed', () => {
    for (const host of ['0.0.0.0', '192.168.1.10', '10.8.0.2', '::', 'example.test']) {
      assert.throws(
        () => assertMobileGatewayBind(host, {}),
        error => error?.code === 'C3_MOBILE_GATEWAY_LOOPBACK_REQUIRED',
        host,
      );
    }
  });

  await test('loopback binds are permitted without any acknowledgement', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']) {
      assert.doesNotThrow(() => assertMobileGatewayBind(host, {}), host);
    }
  });

  await test('only the exact acknowledgement phrase overrides the bind guard', () => {
    for (const value of ['true', '1', 'yes', 'on', 'i-accept', '']) {
      assert.throws(
        () => assertMobileGatewayBind('0.0.0.0', { C3_MOBILE_ALLOW_REMOTE: value }),
        error => error?.code === 'C3_MOBILE_GATEWAY_LOOPBACK_REQUIRED',
        `"${value}" must not be accepted as consent`,
      );
    }
    assert.doesNotThrow(
      () => assertMobileGatewayBind('0.0.0.0', { C3_MOBILE_ALLOW_REMOTE: REMOTE_BIND_ACKNOWLEDGEMENT }),
    );
  });

  // ── Health stays public and carries nothing sensitive ────────────────────
  await test('health is public and leaks no device or configuration data', async () => {
    const response = await call('/m1/health');
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(response.body);
    for (const secret of ['token', 'c3_', 'device', 'C3_ADMIN', 'password', 'hash']) {
      assert.ok(!serialized.includes(secret), `health must not mention "${secret}"`);
    }
  });

  await test('methods outside the policy are refused on allowed paths', async () => {
    const device = await pairDevice(['read:chat', 'write:chat']);
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const response = await call('/m1/conversations', { method, token: device.token });
      assert.equal(response.status, 404, `${method} /m1/conversations`);
    }
  });
} finally {
  await gateway.stop();
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile gateway boundary: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
