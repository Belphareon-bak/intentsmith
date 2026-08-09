// DATA-MODEL.md §8 — the eleven domain requirements, one section at a time.
// ==============================================================================
//
// Offline: no listener, no network.  Everything here is either a pure function
// or a database operation against a temporary file, so the suite proves the
// *rules* rather than the transport.  The transport is covered separately by
// mobile-gateway-boundary.test.js.
//
// Each block names the requirement it locks down, so a future change that
// weakens one of them fails against a stated rule rather than an opaque
// assertion.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import {
  MOBILE_ERRORS, PROTOCOL_VERSION, UNKNOWN_REASONS, canonicalJson, decodeCursor,
  encodeCursor, fingerprint, mobileError, normalizeUnknownReason, paginate,
  recordVersion, versioned, withEnvelope,
} from '../src/mobile/protocol.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import {
  claimPairingCode, createPairingCode, isPairingEnabled, revokeDevice,
  sanitizeScopes, validateDeviceToken, PAIRABLE_SCOPES, FORBIDDEN_SCOPES,
} from '../src/mobile/pairing.js';
import { MobileChannel, listMobileNotifications } from '../src/notifications/channels/mobile.js';

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

console.log('\n=== Mobile data model (DATA-MODEL §8) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-model-'));
const db = new Database(path.join(runtimeDir, 'model.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const PAIRING_ON = { C3_MOBILE_PAIRING: 'on' };

try {
  // ── §8.1 Version on every record ─────────────────────────────────────────
  await test('§8.1 every record carries a content-derived version', () => {
    const record = { id: 'c1', title: 'Ahoj' };
    const stamped = versioned(record);
    assert.ok(stamped.version.startsWith('v1:'));
    // Equal content → equal version, so a client can compare copies.
    assert.equal(recordVersion(record), recordVersion({ title: 'Ahoj', id: 'c1' }));
    // Different content → different version, or staleness is undetectable.
    assert.notEqual(recordVersion(record), recordVersion({ id: 'c1', title: 'Ahoj!' }));
    assert.equal(stamped.id, 'c1', 'versioning must not mutate the record');
  });

  // ── §8.2 Opaque monotonic cursor with safe rejection ─────────────────────
  await test('§8.2 a cursor round-trips and stays opaque', () => {
    const cursor = encodeCursor({ stream: 'conversations', position: 40 });
    // Opacity is a property of the *shape*, not of which characters happen to
    // land in the payload or the checksum.  The whole cursor is drawn from an
    // alphabet that cannot express JSON or a key=value rendering, so no field
    // is readable without performing the documented decode.
    assert.match(
      cursor, /^c1\.[A-Za-z0-9_-]+\.[0-9a-f]{16}$/,
      'a cursor must be prefix.base64url.checksum and nothing legible',
    );
    // ...and the encoded segment really carries the position, so the shape
    // assertion above cannot be satisfied by an empty or unrelated payload.
    const payload = JSON.parse(Buffer.from(cursor.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(payload.position, 40, 'the position must survive inside the encoded payload');
    const decoded = decodeCursor(cursor, { stream: 'conversations' });
    assert.equal(decoded.valid, true);
    assert.equal(decoded.position, 40);
  });

  // F-049.  The predecessor of this block asserted that a valid cursor must not
  // contain the literal characters of its position.  The checksum is hexadecimal
  // and changes with every payload, so that literal appears by chance — roughly
  // 5.8 % of cursors in the recorded samples (584 and, independently, 577 per
  // 10,000) — and the suite failed on correct builds.  The case is pinned here
  // with a fixed issuedAt so the coincidence is reproduced on demand and the
  // probabilistic assertion cannot come back unnoticed.
  await test('§8.2 a literal that lands in the checksum by chance does not invalidate a cursor', () => {
    const cursor = encodeCursor({ stream: 'conversations', position: 40, issuedAt: 8 });
    assert.ok(
      cursor.split('.')[2].includes('40'),
      'the pinned case must still reproduce the coincidence it exists to document',
    );
    const decoded = decodeCursor(cursor, { stream: 'conversations' });
    assert.equal(decoded.valid, true);
    assert.equal(decoded.position, 40);
  });

  // What "the position must not be readable" was reaching for: a client must
  // not nudge a cursor and have the server follow.  The claim locked down here
  // is exactly that narrow: a payload edited while the *original* checksum is
  // kept is refused rather than interpreted.  It is not a security claim and
  // not a statement about cursors in general — §8.2 and protocol.js both say
  // the checksum is not a boundary, and anyone holding the algorithm can
  // recompute one and have the new payload accepted.
  await test('§8.2 a payload edited under its original checksum is refused', () => {
    const [prefix, , checksum] = encodeCursor({
      stream: 'conversations', position: 40, issuedAt: 8,
    }).split('.');
    const forged = Buffer.from(
      canonicalJson({ stream: 'conversations', position: 999, issuedAt: 8 }), 'utf8',
    ).toString('base64url');
    const edited = decodeCursor(`${prefix}.${forged}.${checksum}`, { stream: 'conversations' });
    assert.equal(edited.valid, false, 'a payload edited under the original checksum must be refused');
    assert.equal(edited.reason, 'cursor_unrecognized');
  });

  await test('§8.2 an unrecognised cursor is refused, never interpreted', () => {
    for (const bad of ['c1.tampered.deadbeef', 'garbage', 'c9.x.y', 'c1..', '{}']) {
      const decoded = decodeCursor(bad, { stream: 'conversations' });
      assert.equal(decoded.valid, false, bad);
      assert.ok(decoded.reason, `${bad} must say why`);
    }
  });

  await test('§8.2 a cursor from another stream is refused', () => {
    const other = encodeCursor({ stream: 'messages:c9', position: 10 });
    const decoded = decodeCursor(other, { stream: 'conversations' });
    assert.equal(decoded.valid, false);
    assert.equal(decoded.reason, 'cursor_stream_mismatch');
  });

  await test('§8.2 an absent cursor means "start", not an error', () => {
    for (const empty of [null, undefined, '']) {
      const decoded = decodeCursor(empty, { stream: 'conversations' });
      assert.equal(decoded.valid, true, String(empty));
      assert.equal(decoded.position, 0);
      assert.equal(decoded.initial, true);
    }
  });

  // ── §8.3 Distinguishable error states ────────────────────────────────────
  await test('§8.3 the six named failure causes are distinct codes', () => {
    const required = [
      MOBILE_ERRORS.SERVER_UNAVAILABLE, MOBILE_ERRORS.TOKEN_EXPIRED,
      MOBILE_ERRORS.TOKEN_REVOKED, MOBILE_ERRORS.SCOPE_REQUIRED,
      MOBILE_ERRORS.STATE_CONFLICT, MOBILE_ERRORS.PROTOCOL_MISMATCH,
    ];
    const codes = required.map(descriptor => descriptor.code);
    assert.equal(new Set(codes).size, codes.length, 'no two causes may share a code');
    for (const descriptor of required) {
      const wire = mobileError(descriptor, {});
      assert.equal(wire.error.code, descriptor.code);
      assert.equal(wire.error.protocolVersion, PROTOCOL_VERSION);
      assert.equal(typeof wire.error.retryable, 'boolean');
    }
  });

  await test('§8.3 expired, revoked, and invalid are three answers, not one 401', () => {
    const codes = new Set([
      MOBILE_ERRORS.TOKEN_EXPIRED.code,
      MOBILE_ERRORS.TOKEN_REVOKED.code,
      MOBILE_ERRORS.TOKEN_INVALID.code,
      MOBILE_ERRORS.TOKEN_MISSING.code,
    ]);
    assert.equal(codes.size, 4);
  });

  // ── §8.6 Server-driven pagination with an explicit end ───────────────────
  await test('§8.6 a full final page reports the end, not "more"', () => {
    // The classic bug: rows.length === limit read as "there is another page".
    const page = paginate({ rows: [1, 2, 3], limit: 3, stream: 's', position: 0 });
    assert.equal(page.hasMore, false);
    assert.equal(page.end, true);
    assert.equal(page.nextCursor, null, 'no cursor may be issued past the end');
    assert.equal(page.items.length, 3);
  });

  await test('§8.6 an over-full page reports more and issues a cursor', () => {
    const page = paginate({ rows: [1, 2, 3, 4], limit: 3, stream: 's', position: 0 });
    assert.equal(page.hasMore, true);
    assert.equal(page.end, false);
    assert.equal(page.items.length, 3, 'the sentinel row must not be served');
    assert.equal(decodeCursor(page.nextCursor, { stream: 's' }).position, 3);
  });

  await test('§8.6 an empty stream ends immediately', () => {
    const page = paginate({ rows: [], limit: 10, stream: 's', position: 0 });
    assert.equal(page.end, true);
    assert.equal(page.nextCursor, null);
  });

  // ── §8.7 The response states the scope in force ──────────────────────────
  await test('§8.7 the envelope reports the authorized scopes', () => {
    const envelope = withEnvelope({ x: 1 }, { principal: { id: 'd1', scopes: ['read:chat'] } });
    assert.deepEqual(envelope.scopes, ['read:chat']);
    assert.equal(envelope.principalId, 'd1');
    assert.equal(envelope.protocolVersion, PROTOCOL_VERSION);
  });

  // ── MD-19 rule 5 — canonical fingerprints ────────────────────────────────
  await test('MD-19.5 field order cannot change a fingerprint', () => {
    assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
    assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
    // Array order is meaning, so it must change the fingerprint.
    assert.notEqual(fingerprint({ a: [1, 2] }), fingerprint({ a: [2, 1] }));
  });

  await test('MD-19.4.1 a fingerprint does not reveal the request', () => {
    const secret = 'převod 50000 Kč na účet 123';
    const print = fingerprint({ message: secret });
    assert.ok(!print.includes('50000'));
    assert.ok(!print.includes('převod'));
    assert.match(print, /^[a-f0-9]{64}$/);
  });

  // ── §8.8 / §8.9 dedup that survives a restart ────────────────────────────
  await test('§8.8 the same key with the same payload replays without a new effect', () => {
    const journal = new OperationJournal(db);
    const args = { deviceId: 'dev-a', operationId: 'k'.repeat(24), operationType: 'chat.send', request: { m: 'hi' } };

    assert.equal(journal.begin(args).outcome, 'begun');
    journal.confirm(args.deviceId, args.operationId, { response: 'ok' });

    const replay = journal.begin(args);
    assert.equal(replay.outcome, 'replay');
    assert.equal(replay.record.state, 'CONFIRMED');
    assert.deepEqual(replay.record.result, { response: 'ok' });
  });

  await test('§8.8 the same key with a different payload is a fail-closed conflict', () => {
    const journal = new OperationJournal(db);
    const key = 'm'.repeat(24);
    journal.begin({ deviceId: 'dev-b', operationId: key, operationType: 'chat.send', request: { m: 'first' } });

    const conflict = journal.begin({
      deviceId: 'dev-b', operationId: key, operationType: 'chat.send', request: { m: 'second' },
    });
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.reason, 'fingerprint_mismatch');
  });

  await test('§8.9 the dedup record survives reopening the database', () => {
    const dbPath = path.join(runtimeDir, 'restart.sqlite');
    const key = 'r'.repeat(24);

    const first = new Database(dbPath);
    first.pragma('journal_mode = WAL');
    // Migrations are synchronous enough here; the table is what matters.
    return runMigrations(first).then(() => {
      const journalA = new OperationJournal(first);
      journalA.begin({ deviceId: 'dev-c', operationId: key, operationType: 'chat.send', request: { m: 'x' } });
      journalA.confirm('dev-c', key, { response: 'done' });
      first.close();

      // A new process, exactly the case the key exists for.
      const second = new Database(dbPath);
      const journalB = new OperationJournal(second);
      const found = journalB.lookup('dev-c', key);
      assert.equal(found.known, true);
      assert.equal(found.state, 'CONFIRMED');
      assert.deepEqual(found.result, { response: 'done' });
      second.close();
    });
  });

  // ── §8.10 state by key, without a payload ────────────────────────────────
  await test('§8.10 "unknown key" is distinguishable from any outcome', () => {
    const journal = new OperationJournal(db);
    const absent = journal.lookup('dev-d', 'never-seen-key-000000');
    assert.equal(absent.known, false);
    assert.equal(absent.state, undefined);

    journal.begin({ deviceId: 'dev-d', operationId: 'p'.repeat(24), operationType: 'chat.send', request: { m: 'x' } });
    const pending = journal.lookup('dev-d', 'p'.repeat(24));
    assert.equal(pending.known, true);
    assert.equal(pending.state, 'PENDING');
  });

  await test('§8.10 UNKNOWN is a state distinct from REJECTED', () => {
    const journal = new OperationJournal(db);
    const unknownKey = 'u'.repeat(24);
    const rejectedKey = 'j'.repeat(24);

    journal.begin({ deviceId: 'dev-e', operationId: unknownKey, operationType: 'chat.send', request: { m: 'a' } });
    journal.markUnknown('dev-e', unknownKey);
    journal.begin({ deviceId: 'dev-e', operationId: rejectedKey, operationType: 'chat.send', request: { m: 'b' } });
    journal.reject('dev-e', rejectedKey, 'upstream_bad_request');

    assert.equal(journal.lookup('dev-e', unknownKey).state, 'UNKNOWN');
    assert.equal(journal.lookup('dev-e', rejectedKey).state, 'REJECTED');
    assert.equal(journal.lookup('dev-e', rejectedKey).errorCode, 'upstream_bad_request');
  });

  await test('resolving twice keeps the first outcome', () => {
    const journal = new OperationJournal(db);
    const key = 'i'.repeat(24);
    journal.begin({ deviceId: 'dev-f', operationId: key, operationType: 'chat.send', request: { m: 'x' } });
    assert.equal(journal.confirm('dev-f', key, { first: true }).resolved, true);

    const again = journal.confirm('dev-f', key, { second: true });
    assert.equal(again.resolved, false);
    assert.equal(again.reason, 'already_resolved');
    assert.deepEqual(journal.lookup('dev-f', key).result, { first: true });
  });

  // ── §8.11 cap and rate limit, enforced by the server ─────────────────────
  await test('§8.11 the open-operation cap is enforced and named', () => {
    const journal = new OperationJournal(db, { maxOpenOperations: 3, maxNewOperationsPerWindow: 1000 });
    for (let i = 0; i < 3; i++) {
      const result = journal.begin({
        deviceId: 'dev-cap', operationId: `cap${String(i).padStart(21, '0')}`,
        operationType: 'chat.send', request: { i },
      });
      assert.equal(result.outcome, 'begun', `attempt ${i}`);
    }
    const refused = journal.begin({
      deviceId: 'dev-cap', operationId: 'cap999999999999999999999',
      operationType: 'chat.send', request: { i: 99 },
    });
    assert.equal(refused.outcome, 'limited');
    assert.equal(refused.reason, 'open_operation_cap');
    assert.equal(refused.limit, 3);
  });

  await test('§8.11 the cap is released by resolution, not by eviction', () => {
    const journal = new OperationJournal(db, { maxOpenOperations: 3, maxNewOperationsPerWindow: 1000 });
    // Nothing was silently dropped to make room for the refused attempt above.
    assert.equal(journal.countOpen('dev-cap'), 3);
    assert.equal(journal.openOperations('dev-cap').length, 3);

    journal.confirm('dev-cap', 'cap000000000000000000000', { ok: true });
    assert.equal(journal.countOpen('dev-cap'), 2);

    const nowAccepted = journal.begin({
      deviceId: 'dev-cap', operationId: 'cap888888888888888888888',
      operationType: 'chat.send', request: { i: 88 },
    });
    assert.equal(nowAccepted.outcome, 'begun');
  });

  await test('§8.11 a rate limit blocks a burst before it fills the cap', () => {
    const journal = new OperationJournal(db, { maxOpenOperations: 100, maxNewOperationsPerWindow: 3 });
    let limited = 0;
    for (let i = 0; i < 8; i++) {
      const result = journal.begin({
        deviceId: 'dev-rate', operationId: `rate${String(i).padStart(20, '0')}`,
        operationType: 'chat.send', request: { i },
      });
      if (result.outcome === 'limited') { limited++; assert.equal(result.reason, 'operation_rate_limit'); }
    }
    assert.ok(limited > 0, 'a burst must eventually be refused');
  });

  await test('MD-19.4.3 purging never removes an unresolved record', () => {
    const journal = new OperationJournal(db, { resolvedRetentionMs: -1 });
    const openKey = 'o'.repeat(24);
    const doneKey = 'd'.repeat(24);
    journal.begin({ deviceId: 'dev-purge', operationId: openKey, operationType: 'chat.send', request: { m: 1 } });
    journal.begin({ deviceId: 'dev-purge', operationId: doneKey, operationType: 'chat.send', request: { m: 2 } });
    journal.confirm('dev-purge', doneKey, { ok: true });

    journal.purgeResolved(Date.now() + 60_000);

    assert.equal(journal.lookup('dev-purge', openKey).known, true, 'PENDING must never be time-expired');
    assert.equal(journal.lookup('dev-purge', doneKey).known, false, 'resolved records are eligible');
  });

  await test('§8.10 the reason an operation is UNKNOWN comes from a closed list', () => {
    // Free text cannot be asserted on, translated, or trusted — an upstream
    // error string would otherwise become user-facing copy (B-17).
    assert.equal(normalizeUnknownReason('upstream_timeout'), UNKNOWN_REASONS.UPSTREAM_TIMEOUT);
    assert.equal(normalizeUnknownReason('upstream_reset'), UNKNOWN_REASONS.CONNECTION_LOST_AFTER_DISPATCH);
    assert.equal(normalizeUnknownReason('upstream_status_502'), UNKNOWN_REASONS.UPSTREAM_ERROR_STATUS);
    for (const junk of [null, undefined, '', 42, {}, 'ECONNRESET at 10.0.0.4', 'process_terminated_maybe']) {
      assert.equal(normalizeUnknownReason(junk), UNKNOWN_REASONS.UNSPECIFIED, String(junk));
    }
    // Every code is a value of the enum: the client can switch on it exhaustively.
    for (const code of Object.values(UNKNOWN_REASONS)) {
      assert.equal(normalizeUnknownReason(code), code);
    }
  });

  await test('a crash sweep marks interrupted attempts UNKNOWN and leaves outcomes alone', () => {
    const journal = new OperationJournal(db);
    const hanging = 'sweep-pending' + 'a'.repeat(11);
    const done = 'sweep-done' + 'b'.repeat(14);
    const already = 'sweep-unknown' + 'c'.repeat(11);
    journal.begin({ deviceId: 'dev-sweep', operationId: hanging, operationType: 'chat.send', request: { m: 1 } });
    journal.begin({ deviceId: 'dev-sweep', operationId: done, operationType: 'chat.send', request: { m: 2 } });
    journal.begin({ deviceId: 'dev-sweep', operationId: already, operationType: 'chat.send', request: { m: 3 } });
    journal.confirm('dev-sweep', done, { ok: true });
    journal.markUnknown('dev-sweep', already, 'upstream_timeout');

    journal.sweepInterrupted();

    // PENDING after a restart means the process died before writing an outcome.
    assert.equal(journal.lookup('dev-sweep', hanging).state, 'UNKNOWN');
    assert.equal(journal.lookup('dev-sweep', hanging).unknownReason, UNKNOWN_REASONS.PROCESS_TERMINATED);
    // A recorded outcome is history and the sweep must not rewrite it — neither
    // the answer nor the earlier, more specific reason.
    assert.equal(journal.lookup('dev-sweep', done).state, 'CONFIRMED');
    assert.equal(journal.lookup('dev-sweep', already).unknownReason, UNKNOWN_REASONS.UPSTREAM_TIMEOUT);
  });

  await test('an unresolved record leaves only by deliberate discard', () => {
    const journal = new OperationJournal(db);
    const key = 'x'.repeat(24);
    journal.begin({ deviceId: 'dev-discard', operationId: key, operationType: 'chat.send', request: { m: 1 } });
    assert.equal(journal.discardOpen('dev-discard', key), true);
    assert.equal(journal.lookup('dev-discard', key).known, false);
  });

  await test('a malformed operation id is refused rather than normalised', () => {
    const journal = new OperationJournal(db);
    for (const bad of ['', 'short', 'has spaces in it here', null, undefined, 'a'.repeat(200)]) {
      const result = journal.begin({
        deviceId: 'dev-bad', operationId: bad, operationType: 'chat.send', request: {},
      });
      assert.equal(result.outcome, 'conflict', String(bad));
      assert.equal(result.reason, 'operation_id_malformed');
    }
  });

  await test('operation keys are scoped per device', () => {
    const journal = new OperationJournal(db);
    const key = 's'.repeat(24);
    journal.begin({ deviceId: 'dev-1', operationId: key, operationType: 'chat.send', request: { m: 'a' } });
    // The same key from another device is a different operation, not a clash.
    const other = journal.begin({ deviceId: 'dev-2', operationId: key, operationType: 'chat.send', request: { m: 'b' } });
    assert.equal(other.outcome, 'begun');
    assert.equal(journal.lookup('dev-1', key).known, true);
    assert.equal(journal.lookup('dev-2', key).known, true);
  });

  // ── Pairing and device identity ──────────────────────────────────────────
  await test('the pairing kill switch is fail-closed by default', () => {
    assert.equal(isPairingEnabled({}), false);
    assert.equal(isPairingEnabled({ C3_MOBILE_PAIRING: 'true' }), false);
    assert.equal(isPairingEnabled({ C3_MOBILE_PAIRING: 'yes' }), false);
    assert.equal(isPairingEnabled({ C3_MOBILE_PAIRING: 'on' }), true);
    assert.equal(isPairingEnabled({ C3_MOBILE_PAIRING: '1' }), true);
  });

  await test('forbidden scopes are never pairable', () => {
    for (const forbidden of FORBIDDEN_SCOPES) {
      assert.ok(!PAIRABLE_SCOPES.includes(forbidden), forbidden);
    }
    assert.deepEqual(sanitizeScopes(['admin', 'exec', 'read:chat']), ['read:chat']);
    assert.deepEqual(sanitizeScopes([]), []);
    assert.deepEqual(sanitizeScopes(null), []);
  });

  await test('the pairing code is stored only as a hash', () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    const row = db.prepare('SELECT code_hash FROM mobile_pairing_codes WHERE id = ?').get(issued.id);
    assert.notEqual(row.code_hash, issued.code, 'the raw code must never be stored');
    assert.match(row.code_hash, /^[a-f0-9]{64}$/);
    const anywhere = db.prepare('SELECT COUNT(*) n FROM mobile_pairing_codes WHERE code_hash = ?').get(issued.code);
    assert.equal(anywhere.n, 0);
  });

  await test('the device token is stored only as a hash', () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    const claimed = claimPairingCode(db, { code: issued.code, env: PAIRING_ON });
    assert.equal(claimed.ok, true);
    const row = db.prepare('SELECT token_hash FROM api_tokens WHERE id = ?').get(claimed.deviceId);
    assert.notEqual(row.token_hash, claimed.token);
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
  });

  await test('revocation is distinguishable from expiry and from an unknown token', () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    const claimed = claimPairingCode(db, { code: issued.code, env: PAIRING_ON });

    assert.equal(validateDeviceToken(db, claimed.token).valid, true);

    revokeDevice(db, claimed.deviceId);
    const revoked = validateDeviceToken(db, claimed.token);
    assert.equal(revoked.valid, false);
    assert.equal(revoked.error.code, 'token_revoked');

    const unknown = validateDeviceToken(db, 'c3_definitely_not_a_token');
    assert.equal(unknown.error.code, 'token_invalid');

    const missing = validateDeviceToken(db, null);
    assert.equal(missing.error.code, 'token_missing');
  });

  await test('revocation wins over expiry so the cause reported is the security event', () => {
    const issued = createPairingCode(db, { scopes: ['read:chat'], ttlMs: 60_000 });
    const claimed = claimPairingCode(db, { code: issued.code, env: PAIRING_ON });
    db.prepare("UPDATE api_tokens SET expires_at = '2000-01-01 00:00:00' WHERE id = ?").run(claimed.deviceId);
    revokeDevice(db, claimed.deviceId);
    assert.equal(validateDeviceToken(db, claimed.token).error.code, 'token_revoked');
  });

  await test('a claim is atomic: a refused claim leaves no token behind', () => {
    const before = db.prepare("SELECT COUNT(*) n FROM api_tokens WHERE kind = 'mobile'").get().n;
    const refused = claimPairingCode(db, { code: 'not-a-real-code-at-all', env: PAIRING_ON });
    assert.equal(refused.ok, false);
    const after = db.prepare("SELECT COUNT(*) n FROM api_tokens WHERE kind = 'mobile'").get().n;
    assert.equal(after, before);
  });

  // ── B6 notification channel ──────────────────────────────────────────────
  await test('B6 delivery is reported on the durable inbox write, not on broadcast', async () => {
    let broadcasts = 0;
    const channel = new MobileChannel({ db, broadcast: () => { broadcasts++; } });
    const result = await channel.send({ title: 'Hotovo', body: 'Milník prošel', kind: 'lifecycle' });
    assert.equal(result.delivered, true);
    assert.ok(result.messageId);
    assert.equal(broadcasts, 1);

    const inbox = listMobileNotifications(db, { deviceId: 'dev-x', afterSeq: 0, limit: 10 });
    assert.ok(inbox.some(item => item.id === result.messageId), 'the row must be readable back');
  });

  await test('B6 a failing broadcast does not fail a stored notification', async () => {
    const channel = new MobileChannel({
      db,
      broadcast: () => { throw new Error('no clients'); },
      logger: { warn: () => {} },
    });
    const result = await channel.send({ title: 'Stále doručeno' });
    assert.equal(result.delivered, true, 'the inbox row is the delivery');
  });

  await test('B6 a device sees broadcasts and its own rows, never another device\'s', async () => {
    const channel = new MobileChannel({ db, broadcast: () => {} });
    await channel.send({ title: 'pro dev-me', deviceId: 'dev-me' });
    await channel.send({ title: 'pro dev-other', deviceId: 'dev-other' });

    const mine = listMobileNotifications(db, { deviceId: 'dev-me', afterSeq: 0, limit: 100 });
    assert.ok(mine.some(item => item.title === 'pro dev-me'));
    assert.ok(!mine.some(item => item.title === 'pro dev-other'), 'cross-device leakage');
  });

  await test('B6 the sequence is monotonic so a reconnect can ask for "after N"', async () => {
    const channel = new MobileChannel({ db, broadcast: () => {} });
    const a = await channel.send({ title: 'first' });
    const b = await channel.send({ title: 'second' });
    assert.ok(b.seq > a.seq);
    const after = listMobileNotifications(db, { deviceId: null, afterSeq: a.seq, limit: 100 });
    assert.ok(!after.some(item => item.id === a.messageId));
    assert.ok(after.some(item => item.id === b.messageId));
  });
} finally {
  try { db.close(); } catch { /* already closed */ }
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile data model: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
