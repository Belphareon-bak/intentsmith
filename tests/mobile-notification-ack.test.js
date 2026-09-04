// F-112 — the inbox ACK is isolated per device · DR-012 A
// ==============================================================================
//
// `F-112` is an open **HIGH** blocker and the narrow ACK child of `F-011` and
// `F-015`.  Reading the inbox was already scoped: a device sees broadcasts plus
// the rows addressed to it, and never another device's.  Acknowledging was not.
// The handler passed a list of ids and the SQL updated `read_at` by id alone, so
//
//   * a device could acknowledge a targeted row belonging to another device —
//     a row it is not even allowed to read; and
//   * a broadcast had one global `read_at`, so the first phone to open the
//     inbox marked it read on every other phone.
//
// `DR-012` A makes a per-device receipt the target contract, and this suite is
// the evidence for it.  Two of the tests are the negatives the work package
// asked for by name — a foreign ACK must **fail**, and one device's ACK of a
// broadcast must not silence another's.  Both were verified by mutation: with
// the device predicate removed from the write they fail, and with the read
// answered from the legacy `read_at` column the broadcast test fails.
//
// What this suite does not prove: it is not the HTTP surface.  It exercises the
// storage contract and the handler's use of the principal; the route, its auth
// and its envelope are covered by mobile-gateway-boundary.test.js.
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
import path from 'node:path';

import { runMigrations, _testInternals } from '../src/db/migrate.js';
import {
  MobileChannel, listMobileNotifications, ackMobileNotifications,
  MOBILE_PROJECTOR_CAPABILITY,
} from '../src/notifications/channels/mobile.js';
import { handleNotificationAck, handleNotifications } from '../src/mobile/handlers.js';

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

console.log('\n=== Inbox ACK isolation (F-112, DR-012 A) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-ack-'));
const db = new Database(path.join(runtimeDir, 'ack.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const PHONE = 'device-phone';
const TABLET = 'device-tablet';

function channel() {
  return new MobileChannel({ db });
}

/** Wipe the inbox between cases so sequence numbers stay readable. */
function clearInbox() {
  db.prepare('DELETE FROM mobile_notification_receipts').run();
  db.prepare('DELETE FROM mobile_notifications').run();
}

async function seed(rows) {
  const sent = [];
  // The inbox is fail-closed (DR-013): only a caller holding the capability may
  // write to it.  Seeding here stands in for the future projector, so it holds
  // the capability explicitly rather than the boundary being relaxed for tests.
  for (const row of rows) {
    sent.push(await channel().send({ ...row, [MOBILE_PROJECTOR_CAPABILITY]: true }));
  }
  return sent;
}

function inbox(deviceId) {
  return listMobileNotifications(db, { deviceId });
}

function readState(deviceId, id) {
  const row = inbox(deviceId).find(item => item.id === id);
  return row ? row.read : null;
}

const principal = deviceId => ({ deviceId, scopes: ['read:notifications'], name: 'phone' });
const query = (pairs = {}) => new URLSearchParams(pairs);

try {
  // ── The negative the work package asked for by name ───────────────────────

  await test('F-112 a device cannot acknowledge another device\'s targeted row', async () => {
    clearInbox();
    const [mine, theirs] = await seed([
      { deviceId: PHONE, kind: 'agent', title: 'pro telefon' },
      { deviceId: TABLET, kind: 'agent', title: 'pro tablet' },
    ]);

    // The phone guesses the tablet's id — the whole attack, and no more than
    // knowing a UUID.
    const changed = ackMobileNotifications(db, [theirs.messageId], { deviceId: PHONE });
    assert.equal(changed, 0, 'a foreign ACK was accepted');
    assert.equal(readState(TABLET, theirs.messageId), false,
      'the tablet\'s row was marked read by a device that may not even see it');

    // And the device's own row still works, so the predicate is a boundary and
    // not a blanket refusal.
    assert.equal(ackMobileNotifications(db, [mine.messageId], { deviceId: PHONE }), 1);
    assert.equal(readState(PHONE, mine.messageId), true);
  });

  await test('F-112 acknowledging a broadcast does not acknowledge it for anyone else', async () => {
    clearInbox();
    const [shout] = await seed([{ deviceId: null, kind: 'system', title: 'pro všechny' }]);

    assert.equal(ackMobileNotifications(db, [shout.messageId], { deviceId: PHONE }), 1);
    assert.equal(readState(PHONE, shout.messageId), true, 'the phone\'s own ACK did not register');
    assert.equal(readState(TABLET, shout.messageId), false,
      'one phone\'s ACK silenced the broadcast on every other device');

    // The tablet acknowledges the same broadcast on its own account.
    assert.equal(ackMobileNotifications(db, [shout.messageId], { deviceId: TABLET }), 1);
    assert.equal(readState(TABLET, shout.messageId), true);
    assert.equal(readState(PHONE, shout.messageId), true, 'the phone\'s receipt was overwritten');
  });

  await test('F-112 the ACK\'s reachable set is exactly the read\'s, never wider', async () => {
    clearInbox();
    const [mine, theirs, shout] = await seed([
      { deviceId: PHONE, title: 'moje' },
      { deviceId: TABLET, title: 'cizí' },
      { deviceId: null, title: 'všem' },
    ]);
    const visible = inbox(PHONE).map(row => row.id).sort();
    const acknowledgeable = [mine, theirs, shout]
      .map(row => row.messageId)
      .filter(id => ackMobileNotifications(db, [id], { deviceId: PHONE }) === 1)
      .sort();
    assert.deepEqual(acknowledgeable, visible,
      'a device can change rows it cannot read, or cannot change rows it can');
  });

  // ── Idempotence and counting ─────────────────────────────────────────────

  await test('DR-012 A a repeated ACK is idempotent and keeps the first read time', async () => {
    clearInbox();
    const [row] = await seed([{ deviceId: PHONE, title: 'jednou' }]);

    assert.equal(ackMobileNotifications(db, [row.messageId], { deviceId: PHONE }), 1);
    const first = db.prepare(
      'SELECT read_at FROM mobile_notification_receipts WHERE notification_id = ? AND device_id = ?',
    ).get(row.messageId, PHONE).read_at;

    assert.equal(ackMobileNotifications(db, [row.messageId], { deviceId: PHONE }), 0,
      'a repeat ACK claimed work it did not do');
    const second = db.prepare(
      'SELECT read_at FROM mobile_notification_receipts WHERE notification_id = ? AND device_id = ?',
    ).get(row.messageId, PHONE).read_at;
    assert.equal(second, first, 'the recorded read time moved to the second, later ACK');
    assert.equal(readState(PHONE, row.messageId), true);
  });

  await test('F-112 an ACK without a device acknowledges nothing at all', async () => {
    clearInbox();
    const [row] = await seed([{ deviceId: PHONE, title: 'bez identity' }]);
    assert.equal(ackMobileNotifications(db, [row.messageId], {}), 0,
      'a caller that forgot the device fell back to the pre-058 global behaviour');
    assert.equal(ackMobileNotifications(db, [row.messageId]), 0);
    assert.equal(readState(PHONE, row.messageId), false);
  });

  await test('an unknown id acknowledges nothing and is not an error', async () => {
    clearInbox();
    await seed([{ deviceId: PHONE, title: 'existuje' }]);
    assert.equal(ackMobileNotifications(db, ['no-such-id'], { deviceId: PHONE }), 0);
  });

  // ── The handler carries the principal into the write ─────────────────────

  await test('F-112 the route acknowledges as the caller, not as anybody', async () => {
    clearInbox();
    const [mine, theirs] = await seed([
      { deviceId: PHONE, title: 'moje' },
      { deviceId: TABLET, title: 'cizí' },
    ]);

    const foreign = await handleNotificationAck({
      rawDb: db, principal: principal(PHONE), body: { ids: [theirs.messageId] },
    });
    assert.equal(foreign.status, 200);
    assert.equal(foreign.body.data.acknowledged, 0, 'the route acknowledged a foreign row');

    const own = await handleNotificationAck({
      rawDb: db, principal: principal(PHONE), body: { ids: [mine.messageId] },
    });
    assert.equal(own.body.data.acknowledged, 1);

    const listed = await handleNotifications({ rawDb: db, principal: principal(PHONE), query: query() });
    assert.equal(listed.body.data.find(row => row.id === mine.messageId).read, true);

    const other = await handleNotifications({ rawDb: db, principal: principal(TABLET), query: query() });
    assert.equal(other.body.data.find(row => row.id === theirs.messageId).read, false);
  });

  // ── The legacy column is no longer authority ─────────────────────────────

  await test('F-112 a stale pre-058 read_at cannot resurrect a read state', async () => {
    clearInbox();
    const [shout] = await seed([{ deviceId: null, title: 'starý globální stav' }]);
    // Exactly what a pre-058 build would have written when *some* device read it.
    db.prepare('UPDATE mobile_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ?').run(shout.messageId);

    assert.equal(readState(PHONE, shout.messageId), false,
      'the legacy global column is still being read as this device\'s read state');
    assert.equal(readState(TABLET, shout.messageId), false);
  });

  await test('the channel no longer writes the legacy column at all', async () => {
    clearInbox();
    const [row] = await seed([{ deviceId: PHONE, title: 'nový zápis' }]);
    ackMobileNotifications(db, [row.messageId], { deviceId: PHONE });
    const stored = db.prepare('SELECT read_at FROM mobile_notifications WHERE id = ?').get(row.messageId);
    assert.equal(stored.read_at, null, 'the ACK still writes a column that cannot hold a per-device fact');
  });

  // ── Migration 058 backfill ───────────────────────────────────────────────

  await test('058 backfills a targeted row\'s read state and refuses to invent a broadcast\'s', async () => {
    const legacyDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-ack-legacy-'));
    const legacy = new Database(path.join(legacyDir, 'legacy.sqlite'));
    try {
      // Trap: the prerequisite has to be *built*, not assumed.  A database that
      // is already fully migrated has no pre-058 rows to backfill, so the case
      // under test would pass without ever occurring.  So the plan is stopped
      // one migration short, the legacy rows are written by hand exactly as a
      // pre-058 build would have left them, and only then does 058 run.
      const plan = await _testInternals.discoverMigrations();
      const cut = plan.findIndex(one => one.version === '2026_08_09_058_mobile_notification_receipts');
      assert.ok(cut > 0, 'migration 058 is not in the discovered plan');
      _testInternals.runMigrationPlan(legacy, plan.slice(0, cut));
      assert.equal(
        legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mobile_notification_receipts'").get(),
        undefined,
        'the receipt table already existed, so this is not a pre-058 database',
      );
      legacy.prepare(`
        INSERT INTO mobile_notifications (id, device_id, kind, priority, title, body, seq, read_at)
        VALUES (?, ?, 'agent', 'normal', ?, '', ?, CURRENT_TIMESTAMP)
      `).run('n-targeted', PHONE, 'cílený', 1);
      legacy.prepare(`
        INSERT INTO mobile_notifications (id, device_id, kind, priority, title, body, seq, read_at)
        VALUES (?, NULL, 'system', 'normal', ?, '', ?, CURRENT_TIMESTAMP)
      `).run('n-broadcast', 'broadcast', 2);

      await runMigrations(legacy);

      const receipts = legacy.prepare(
        'SELECT notification_id, device_id FROM mobile_notification_receipts ORDER BY notification_id',
      ).all();
      assert.deepEqual(receipts, [{ notification_id: 'n-targeted', device_id: PHONE }],
        'the backfill either lost an unambiguous read or invented an attribution for a broadcast');

      assert.equal(listMobileNotifications(legacy, { deviceId: PHONE })
        .find(row => row.id === 'n-targeted').read, true, 'a read row came back unread after 058');
      assert.equal(listMobileNotifications(legacy, { deviceId: PHONE })
        .find(row => row.id === 'n-broadcast').read, false,
        'a broadcast read by an unknown device was attributed to this one');
    } finally {
      legacy.close();
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
} finally {
  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nInbox ACK isolation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
