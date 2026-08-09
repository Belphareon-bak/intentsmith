// F-015 — the inbox sequence cannot be duplicated by a race
// ==============================================================================
//
// `F-015` is an open root finding, separate from its ACK child `F-112`.  The
// channel minted its sequence as a read, a gap, and a write:
//
//   SELECT COALESCE(MAX(seq), 0) FROM mobile_notifications
//   INSERT ... VALUES (..., max + 1)
//
// with no `UNIQUE` and no transactional guarantee.  Two writers could both read
// before either wrote, and both then wrote the same number.
//
// The cost is precisely the guarantee the column exists for.  A reconnecting
// client asks for "everything after N" — the reason the inbox is sequence-based
// and not timestamp-based — and with two rows at N+1 one of them becomes
// unreachable by that documented recovery path.  PLAN.md §6 accepts a missed
// notification the user can still find later; it does not accept one that the
// recovery path itself steps over.
//
// The fix has two halves and this suite tests both, because either alone would
// leave a hole:
//
//   * the mint is one statement, so SQLite's write lock serialises the read
//     and the write and no other writer can observe the maximum between them;
//   * migration 059 adds a unique index, so any path that still computes a
//     sequence in application code fails loudly instead of losing a row.
//
// The load-bearing test is the third one: it reproduces the *old algorithm*
// against two real connections — read on A, read on B, write on A, write on B —
// and requires the second write to be rejected.  That is the race itself,
// performed deliberately, and it is what proves the constraint rather than the
// implementation's current politeness.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations, _testInternals } from '../src/db/migrate.js';
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

console.log('\n=== Inbox sequence uniqueness (F-015) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-seq-'));
const dbPath = path.join(runtimeDir, 'seq.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
await runMigrations(db);

function clearInbox() {
  db.prepare('DELETE FROM mobile_notification_receipts').run();
  db.prepare('DELETE FROM mobile_notifications').run();
}

const send = (handle, row) => new MobileChannel({ db: handle }).send(row);

try {
  await test('B6 the sequence is monotonic and gapless for one writer', async () => {
    clearInbox();
    const sent = [];
    for (let index = 0; index < 5; index++) {
      sent.push(await send(db, { deviceId: null, title: `n${index}` }));
    }
    assert.deepEqual(sent.map(row => row.seq), [1, 2, 3, 4, 5]);
    assert.ok(sent.every(row => row.delivered), 'a write reported itself undelivered');
  });

  await test('F-015 two writers on two connections never share a sequence', async () => {
    clearInbox();
    const second = new Database(dbPath);
    try {
      const seqs = [];
      // Alternating writers, which is what two gateway instances against one
      // database actually look like.
      for (let index = 0; index < 6; index++) {
        const handle = index % 2 === 0 ? db : second;
        seqs.push((await send(handle, { deviceId: null, title: `w${index}` })).seq);
      }
      assert.equal(new Set(seqs).size, seqs.length, `two writers shared a sequence: ${seqs.join(', ')}`);
      assert.deepEqual(seqs.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    } finally {
      second.close();
    }
  });

  await test('F-015 the race itself, performed deliberately, is now rejected', async () => {
    clearInbox();
    await send(db, { deviceId: null, title: 'základ' });

    const second = new Database(dbPath);
    try {
      // The pre-059 algorithm, interleaved exactly as two processes would:
      // both read the maximum, and only then does either write.
      const maxA = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM mobile_notifications').get().max;
      const maxB = second.prepare('SELECT COALESCE(MAX(seq), 0) AS max FROM mobile_notifications').get().max;
      assert.equal(maxA, maxB, 'precondition: both writers computed the same next sequence');

      const insert = handle => handle.prepare(`
        INSERT INTO mobile_notifications (id, device_id, kind, priority, title, body, seq)
        VALUES (?, NULL, 'agent', 'normal', ?, '', ?)
      `);
      insert(db).run('race-a', 'A', maxA + 1);

      assert.throws(
        () => insert(second).run('race-b', 'B', maxB + 1),
        /UNIQUE|constraint/i,
        'the second writer duplicated a sequence and nothing stopped it (F-015)',
      );

      // And the row that did land is intact and reachable.
      const rows = listMobileNotifications(db, { deviceId: 'anyone' });
      assert.equal(rows.filter(row => row.seq === maxA + 1).length, 1);
      assert.ok(!rows.some(row => row.id === 'race-b'), 'the rejected write left a row behind');
    } finally {
      second.close();
    }
  });

  await test('F-015 "after N" reaches every row, which is what the sequence is for', async () => {
    clearInbox();
    for (let index = 0; index < 8; index++) {
      await send(db, { deviceId: null, title: `n${index}` });
    }
    // Walk the inbox the way a reconnecting client does, and require every row
    // exactly once: a duplicated sequence is invisible in a single read and
    // shows up precisely here.
    const seen = [];
    let afterSeq = 0;
    for (let page = 0; page < 10; page++) {
      const rows = listMobileNotifications(db, { deviceId: 'phone', afterSeq, limit: 3 }).slice(0, 3);
      if (!rows.length) break;
      seen.push(...rows.map(row => row.id));
      afterSeq = rows[rows.length - 1].seq;
    }
    assert.equal(seen.length, 8, `the "after N" walk reached ${seen.length} of 8 rows`);
    assert.equal(new Set(seen).size, 8, 'the walk returned a row twice');
  });

  await test('F-015 the mint is one statement — no window exists between read and write', () => {
    // Read against the implementation rather than its behaviour: the two
    // preceding tests show the constraint holds, and this one shows the window
    // the constraint is a backstop for does not exist in the first place.
    const text = String(MobileChannel.prototype.send);
    assert.ok(!/SELECT COALESCE\(MAX\(seq\), 0\) AS max/.test(text),
      'the separate MAX(seq) read is back, which is the F-015 window itself');
    assert.match(text, /INSERT INTO mobile_notifications[\s\S]*SELECT[\s\S]*COALESCE\(MAX\(seq\), 0\) \+ 1/,
      'the sequence is no longer minted inside the insert statement');
  });

  // ── Migration 059 over a database the race already damaged ───────────────

  await test('059 repairs duplicates and missing sequences without renumbering good rows', async () => {
    const legacyDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-seq-legacy-'));
    const legacy = new Database(path.join(legacyDir, 'legacy.sqlite'));
    try {
      // The prerequisite is built, not assumed: on a fully migrated database
      // the unique index already exists and duplicates cannot be written, so
      // the case under test could never occur.
      const plan = await _testInternals.discoverMigrations();
      const cut = plan.findIndex(one => one.version === '2026_08_09_059_mobile_notification_seq_unique');
      assert.ok(cut > 0, 'migration 059 is not in the discovered plan');
      _testInternals.runMigrationPlan(legacy, plan.slice(0, cut));

      const write = legacy.prepare(`
        INSERT INTO mobile_notifications (id, device_id, kind, priority, title, body, created_at, seq)
        VALUES (?, NULL, 'agent', 'normal', ?, '', ?, ?)
      `);
      write.run('n-1', 'první', '2026-08-01 10:00:00', 1);
      write.run('n-2', 'druhá', '2026-08-01 10:00:01', 2);
      // What the race produced: a second row at the same sequence.
      write.run('n-3', 'závod', '2026-08-01 10:00:02', 2);
      // And what a pre-055 write could leave: no sequence at all.
      write.run('n-4', 'bez seq', '2026-08-01 10:00:03', null);

      await runMigrations(legacy);

      const rows = legacy.prepare('SELECT id, seq FROM mobile_notifications ORDER BY id').all();
      const bySeq = Object.fromEntries(rows.map(row => [row.id, row.seq]));
      assert.equal(bySeq['n-1'], 1, 'an already-unique sequence was renumbered, invalidating live cursors');
      assert.equal(bySeq['n-2'], 2, 'the first holder of a duplicated sequence must keep it');
      assert.equal(new Set(rows.map(row => row.seq)).size, 4, 'the repair left a duplicate behind');
      assert.ok(rows.every(row => row.seq !== null), 'a row still has no sequence');
      assert.ok(bySeq['n-3'] > 2 && bySeq['n-4'] > 2, 'repaired rows were not placed above the maximum');
      assert.ok(bySeq['n-3'] < bySeq['n-4'], 'repaired rows were not renumbered in creation order');

      assert.throws(
        () => write.run('n-5', 'po opravě', '2026-08-01 10:00:04', 1),
        /UNIQUE|constraint/i,
        'the unique index was not created after the repair',
      );
    } finally {
      legacy.close();
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
} finally {
  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nInbox sequence uniqueness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
