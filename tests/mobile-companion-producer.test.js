// The producer half of `F-100` and the `DR-013 A` mirror — what a phone can see
// ==============================================================================
//
// The three findings this suite covers all failed the same way: the reading
// side worked perfectly and there was nothing to read.  So the tests are not
// "does the producer run" — they are the four properties that decide whether a
// non-empty screen is trustworthy:
//
//   1. every approval this producer writes carries `DR-011` authority, because
//      it cannot reach the table by any route other than the authority;
//   2. the mirror is **S1** — the caller's own strings cannot reach the phone's
//      notification text through any parameter, tested by handing the producer
//      the most content-bearing strings a real call would carry and then
//      asserting they appear nowhere in the row;
//   3. a decision crosses the process boundary, because it is a row and not a
//      promise — the half of `F-100` that could not be built on the IDE's
//      in-memory `edit_request` map;
//   4. silence is reported as silence.  `timeout` and `expired` are distinct
//      answers and neither is `approve`.
//
// Property 2 is the one worth the most: it is checked against the stored row,
// not against the call, so a future refactor that starts interpolating a title
// fails here rather than in a screenshot.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/mobile/protocol.js';
import { APPROVAL_TTL_MS } from '../src/approvals/authority.js';
import {
  createCompanionProducer, CompanionProducerError, S1_VOCABULARY, S1_EVENTS,
} from '../src/mobile/companion-producer.js';
import { APPROVAL_VALIDITY, PRECONDITION_CAP_MS } from '../src/approvals/authority.js';
import {
  MobileChannel, MOBILE_PROJECTOR_CAPABILITY, listMobileNotifications,
} from '../src/notifications/channels/mobile.js';
import { createNotificationRouter } from '../src/notifications/index.js';
import { handleApprovals, handleApprovalDecide } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';

// A wait that yields to the *macrotask* queue, not merely the microtask queue.
// A zero-delay `async () => {}` looks like the fastest possible poll and is in
// fact a livelock: the polling loop re-queues itself as a microtask, and the
// decide path's own I/O never gets a turn, so the answer the test is waiting
// for can never arrive.  Production polls with `setTimeout`, which has this
// property already.
const yieldTick = () => new Promise(resolve => setImmediate(resolve));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}\n    ${error.message}`);
  }
}

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-companion-'));
const db = new Database(path.join(runtimeDir, 'test.db'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const DEVICE = 'dev-companion-1';
const principal = {
  deviceId: DEVICE,
  scopes: ['read:approvals', 'write:approvals', 'read:notifications'],
};
const journal = new OperationJournal(db);

// The strings a real caller would pass.  Every one of them is content: a path
// is a diff's address, a title quotes the user, the payload is the change
// itself.  None of them may appear in a notification row.
const LEAKY = {
  title: 'Zapsat src/db/migrate.js — přidat sloupec secret_token',
  detail: 'Diff: - const KEY = "abc"; + const KEY = process.env.SECRET;',
  operationRef: 'fs.write:/home/user/projects/rozpocet-2026.md',
  payload: { path: '/home/user/projects/rozpocet-2026.md', content: 'PIN je 4417' },
};

function newRouter(broadcast) {
  const router = createNotificationRouter({ db });
  if (broadcast) {
    router.registerChannel(new MobileChannel({ db, broadcast }));
  }
  return router;
}

function notifications() {
  return listMobileNotifications(db, { deviceId: DEVICE, afterSeq: 0, limit: 200 });
}

function clearAll() {
  db.exec('DELETE FROM mobile_notifications; DELETE FROM mobile_notification_receipts; DELETE FROM mobile_approvals;');
}

try {
  console.log('\nCompanion producer — F-100 producer half, DR-013 A mirror\n');

  // ── 1. Authority ─────────────────────────────────────────────────────────

  await test('F-100 an approval the producer minted carries the DR-011 window, not a chosen one', async () => {
    clearAll();
    const producer = createCompanionProducer({ rawDb: db, router: newRouter(), now: () => 1_700_000_000_000 });
    const minted = await producer.requestApproval({
      origin: 'local', runId: 'run-1', operationRef: 'effect-1',
      subjectType: 'edit', subjectId: 'file-1', title: 'Zapsat soubor',
      payload: { a: 1 },
    });

    assert.equal(minted.ttlMs, APPROVAL_TTL_MS.local);
    const row = db.prepare('SELECT * FROM mobile_approvals WHERE id = ?').get(minted.id);
    assert.equal(row.origin, 'local');
    assert.equal(row.run_id, 'run-1');
    assert.equal(row.operation_ref, 'effect-1');
    // The digest is the authority's, over the payload — not anything a caller
    // could have pre-computed and handed in.
    assert.equal(row.payload_fingerprint, fingerprint({ a: 1 }));
  });

  await test('F-100 a producer without a binding produces nothing at all', async () => {
    clearAll();
    const producer = createCompanionProducer({ rawDb: db, router: newRouter() });
    await assert.rejects(
      () => producer.requestApproval({ origin: 'local', runId: 'run-1', title: 'Bez operace', payload: {} }),
      error => error.reason === 'binding_required',
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n, 0);
    // And no mirror either: a notification pointing at an approval that does
    // not exist would send the user to an empty queue.
    assert.equal(notifications().length, 0);
  });

  await test('the approval exists before the notification that points at it', async () => {
    clearAll();
    const seen = [];
    const router = newRouter();
    router.registerChannel(new (class extends MobileChannel {
      async send(notification) {
        // Observed at the moment of the mirror, not afterwards.
        seen.push(db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n);
        return super.send(notification);
      }
    })({ db }));

    const producer = createCompanionProducer({ rawDb: db, router });
    await producer.requestApproval({
      origin: 'remote', runId: 'run-2', operationRef: 'effect-2',
      subjectType: 'edit', subjectId: 'f', title: 'T', payload: {},
    });
    assert.deepEqual(seen, [1], 'the mirror ran before the row it advertises existed');
  });

  // ── 2. The mirror is S1 ──────────────────────────────────────────────────

  await test('DR-013 the mirror carries no content, however much content the caller passes', async () => {
    clearAll();
    const producer = createCompanionProducer({ rawDb: db, router: newRouter() });
    const minted = await producer.requestApproval({
      origin: 'local', runId: 'run-secret', operationRef: LEAKY.operationRef,
      subjectType: 'edit', subjectId: 'src/db/migrate.js',
      title: LEAKY.title, detail: LEAKY.detail, payload: LEAKY.payload,
      deviceId: DEVICE,
    });
    assert.equal(minted.mirrored, true, `mirror failed: ${minted.mirrorReason}`);

    const [note] = notifications();
    const wire = JSON.stringify(note);
    for (const leak of ['migrate.js', 'secret_token', 'PIN', 'rozpocet-2026', 'process.env', 'fs.write']) {
      assert.ok(!wire.includes(leak), `S2 content "${leak}" reached the S1 mirror: ${wire}`);
    }
    // What it does carry: the fixed vocabulary and a pointer back to the S2
    // surface, where the scope check is.
    assert.equal(note.title, S1_VOCABULARY['approval.requested'].title);
    assert.equal(note.body, S1_VOCABULARY['approval.requested'].body);
    assert.equal(note.data.approvalId, minted.id);
    assert.equal(note.data.runId, 'run-secret');
  });

  await test('DR-013 the S2 description is still readable where the scope check is', async () => {
    // The mirror being empty of content is only correct because the content is
    // reachable somewhere that checks a scope.  Otherwise the phone would be
    // told to look at something it cannot see.
    const listed = await handleApprovals({ rawDb: db, principal });
    const item = listed.body.data.find(entry => entry.title === LEAKY.title);
    assert.ok(item, 'the approval the mirror pointed at is not in the queue');
    assert.equal(item.detail, LEAKY.detail);
  });

  await test('DR-013 an event outside the vocabulary is refused, not improvised', async () => {
    const producer = createCompanionProducer({ rawDb: db, router: newRouter() });
    await assert.rejects(
      () => producer.project('approval.granted.with.details'),
      error => error instanceof CompanionProducerError && error.reason === 'unknown_s1_event',
    );
  });

  await test('DR-013 every vocabulary entry is content-free by construction', () => {
    // A table is only a guarantee while every row in it holds.  This is the
    // check that a later addition cannot quietly widen the mirror.
    for (const event of S1_EVENTS) {
      const entry = S1_VOCABULARY[event];
      assert.ok(entry.title.length <= 40, `${event}: title long enough to carry content`);
      assert.ok(entry.body.length <= 60, `${event}: body long enough to carry content`);
      assert.ok(['approval', 'run'].includes(entry.kind), `${event}: unexpected kind`);
      assert.ok(['low', 'normal', 'high'].includes(entry.priority), `${event}: unexpected priority`);
    }
  });

  await test('F-111 the capability is what admits the row — the producer holds it, a request body cannot', async () => {
    clearAll();
    const router = newRouter();
    // Exactly what an HTTP caller can express: `channel` from a JSON body.
    const spoofed = await router.send(JSON.parse(JSON.stringify({
      channel: 'mobile', title: 'Vypadám jako projektor', body: 'obsah',
    })));
    assert.equal(spoofed.delivered, false);
    assert.equal(notifications().length, 0);

    const producer = createCompanionProducer({ rawDb: db, router });
    const mirrored = await producer.project('run.started', { runId: 'run-3' });
    assert.equal(mirrored.mirrored, true);
    assert.equal(notifications().length, 1);
  });

  // ── 3. A decision crosses the process boundary ───────────────────────────

  await test('F-100 the phone\'s decision reaches a waiter that never shared memory with it', async () => {
    clearAll();
    // Two producers over one database is the deployment: the gateway process
    // writes the decision, the core process is waiting.  Nothing is shared but
    // the file.
    const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
    const minted = await core.requestApproval({
      origin: 'local', runId: 'run-4', operationRef: 'effect-4',
      subjectType: 'edit', subjectId: 'f', title: 'Zapsat', payload: { v: 1 },
    });

    const waiting = core.awaitDecision(minted.id, { pollMs: 1, timeoutMs: 10_000 });

    // The gateway side: the real handler, the real scope, the real fingerprint
    // rule — the same call the phone makes.
    const decided = await handleApprovalDecide({
      rawDb: db, journal, principal, params: { id: minted.id },
      body: {
        decision: 'approve',
        operationId: 'op-companion-0000001',
        payloadFingerprint: fingerprint({ v: 1 }),
      },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));

    const answer = await waiting;
    assert.equal(answer.state, 'approve');
    assert.equal(answer.decidedBy, DEVICE);
  });

  await test('F-100 a rejection is a decision, not a failure to answer', async () => {
    clearAll();
    const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
    const minted = await core.requestApproval({
      origin: 'local', runId: 'run-5', operationRef: 'effect-5',
      subjectType: 'edit', subjectId: 'f', title: 'Zapsat', payload: { v: 2 },
    });
    const waiting = core.awaitDecision(minted.id, { pollMs: 1, timeoutMs: 10_000 });
    await handleApprovalDecide({
      rawDb: db, journal, principal, params: { id: minted.id },
      body: {
        decision: 'reject', operationId: 'op-companion-0000002',
        payloadFingerprint: fingerprint({ v: 2 }),
      },
    });
    assert.equal((await waiting).state, 'reject');
  });

  // ── 4. Silence is silence ────────────────────────────────────────────────

  await test('silence is never approval — an unanswered wait times out', async () => {
    clearAll();
    let clock = 1_700_000_000_000;
    const core = createCompanionProducer({
      rawDb: db, router: newRouter(),
      now: () => clock,
      sleep: async ms => { clock += ms; },
    });
    const minted = await core.requestApproval({
      origin: 'local', runId: 'run-6', operationRef: 'effect-6',
      subjectType: 'edit', subjectId: 'f', title: 'Zapsat', payload: {},
    });
    const answer = await core.awaitDecision(minted.id, { timeoutMs: 30_000, pollMs: 1_000 });
    assert.equal(answer.state, 'timeout');
    assert.equal(db.prepare('SELECT decided_at FROM mobile_approvals WHERE id = ?').get(minted.id).decided_at, null);
  });

  await test('DR-011 a waiter cannot outlive the window it was given', async () => {
    clearAll();
    let clock = 1_700_000_000_000;
    const core = createCompanionProducer({
      rawDb: db, router: newRouter(),
      now: () => clock,
      sleep: async ms => { clock += ms; },
    });
    const minted = await core.requestApproval({
      origin: 'local', runId: 'run-7', operationRef: 'effect-7',
      subjectType: 'edit', subjectId: 'f', title: 'Zapsat', payload: {},
    });
    // Asking for an hour over a five-minute window: the answer must be the
    // window's, or waiting would be an extension by another name.
    const answer = await core.awaitDecision(minted.id, { timeoutMs: 60 * 60_000, pollMs: 1_000 });
    assert.equal(answer.state, 'expired');
    assert.ok(clock - 1_700_000_000_000 <= APPROVAL_TTL_MS.local + 1_000,
      'the waiter ran past expiry, which is an extension in everything but name');
  });

  await test('an approval that vanished is reported missing, not rejected', async () => {
    clearAll();
    const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
    assert.equal((await core.awaitDecision('ap-nonexistent')).state, 'missing');
  });

  // ── 5. Run progress, inside the frozen surface ───────────────────────────

  await test('MR-07 run progress rides the inbox the frozen routes already serve', async () => {
    clearAll();
    const core = createCompanionProducer({ rawDb: db, router: newRouter() });
    const base = {
      contract: 'm1.core-event', version: 1,
      requestId: 'run-8', conversationId: 'conv-1', turnId: 'turn-1',
    };
    await core.projectCoreEvent({ ...base, sequence: 1, phase: 'progress', eventType: 'started', payload: {} });
    await core.projectCoreEvent({ ...base, sequence: 2, phase: 'progress', eventType: 'tool_call', payload: { tool: 'fs.write', args: { path: '/tajne/heslo.txt' } } });
    await core.projectCoreEvent({ ...base, sequence: 3, phase: 'terminal', eventType: 'result', terminalStatus: 'ok', payload: {} });

    const rows = notifications();
    assert.deepEqual(rows.map(r => r.data.event), ['run.started', 'run.progress', 'run.ok']);
    assert.ok(!JSON.stringify(rows).includes('heslo'), 'a core event payload leaked into the S1 mirror');
    assert.ok(rows.every(r => r.data.runId === 'run-8'));
  });

  await test('an unrecognised terminal state is mirrored as unknown, never as success', async () => {
    clearAll();
    const core = createCompanionProducer({ rawDb: db, router: newRouter() });
    await core.projectCoreEvent({
      requestId: 'run-9', phase: 'terminal', eventType: 'result',
      terminalStatus: 'partially_maybe', sequence: 1, payload: {},
    });
    assert.equal(notifications()[0].data.event, 'run.unknown');
  });

  // ── 6. The mirror may fail; the durable row may not ──────────────────────

  await test('a failed mirror still leaves a real approval — the phone finds it on the next pull', async () => {
    clearAll();
    const brokenRouter = { send: async () => { throw new Error('router down'); } };
    const core = createCompanionProducer({ rawDb: db, router: brokenRouter });
    const minted = await core.requestApproval({
      origin: 'local', runId: 'run-10', operationRef: 'effect-10',
      subjectType: 'edit', subjectId: 'f', title: 'Zapsat', payload: {},
    });
    assert.equal(minted.mirrored, false);
    assert.equal(minted.mirrorReason, 'router down');

    const listed = await handleApprovals({ rawDb: db, principal });
    assert.ok(listed.body.data.some(item => item.id === minted.id),
      'the mirror failing removed the approval, which would make the queue lie');
  });

  await test('without a router the producer is honest rather than silent', async () => {
    clearAll();
    const core = createCompanionProducer({ rawDb: db });
    const minted = await core.requestApproval({
      origin: 'local', runId: 'run-11', operationRef: 'effect-11',
      subjectType: 'edit', subjectId: 'f', title: 'Zapsat', payload: {},
    });
    assert.equal(minted.mirrored, false);
    assert.equal(minted.mirrorReason, 'no_router');
  });
// ── 7. Approval vázaný na cíl, ne na hodiny (025) ────────────────────────
//
// Časový limit se nedal jen sundat: dokud tam byl, zakrýval, že approval o
// stavu světa nic neví.  Tyhle testy jsou o tom, co ho nahradilo — a hlavně o
// tom, že „nezjistitelné" se nepočítá jako „v pořádku".

await test('025 approval vázaný na cíl nepropadá časem', async () => {
  clearAll();
  let clock = 1_700_000_000_000;
  const core = createCompanionProducer({
    rawDb: db, router: newRouter(), now: () => clock, sleep: async ms => { clock += ms; },
  });
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-p1', operationRef: 'fs.write:/x/config.js',
    subjectType: 'effect.write', subjectId: '/x/config.js', title: 'Zapsat',
    payload: { v: 1 },
    precondition: { kind: 'file-digest', ref: '/x/config.js', content: 'původní obsah' },
  });

  assert.equal(minted.validity, APPROVAL_VALIDITY.PRECONDITION);
  // Hodinu po vzniku — pod starým `DR-011` dávno propadlý — pořád čeká.
  const answer = await core.awaitDecision(minted.id, {
    timeoutMs: 60 * 60_000, pollMs: 5_000,
    readTarget: async () => 'původní obsah',
  });
  assert.equal(answer.state, 'timeout', `čekání skončilo jako ${answer.state}`);
  assert.ok(clock - 1_700_000_000_000 >= 60 * 60_000, 'čekání se zkrátilo na staré okno');
});

await test('025 změna cíle během čekání ukončí čekání — nemá smysl ptát se na neaktuální', async () => {
  clearAll();
  const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-p2', operationRef: 'fs.write:/x/a.js',
    subjectType: 'effect.write', subjectId: '/x/a.js', title: 'Zapsat',
    payload: {},
    precondition: { kind: 'file-digest', ref: '/x/a.js', content: 'A' },
  });

  let content = 'A';
  const waiting = core.awaitDecision(minted.id, {
    timeoutMs: 10_000, pollMs: 1, readTarget: async () => content,
  });
  content = 'někdo jiný to přepsal';

  const answer = await waiting;
  assert.equal(answer.state, 'precondition_changed');
  assert.equal(answer.target, '/x/a.js');
});

await test('025 schválení propadne, když se cíl změní mezi odpovědí a provedením', async () => {
  clearAll();
  const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-p3', operationRef: 'fs.write:/x/b.js',
    subjectType: 'effect.write', subjectId: '/x/b.js', title: 'Zapsat',
    payload: { v: 3 },
    precondition: { kind: 'file-digest', ref: '/x/b.js', content: 'B' },
  });

  // Člověk odpoví „ano"…
  await handleApprovalDecide({
    rawDb: db, journal, principal, params: { id: minted.id },
    body: { decision: 'approve', operationId: 'op-precondition-001', payloadFingerprint: fingerprint({ v: 3 }) },
  });

  // …ale cíl se mezitím změnil.  Souhlas platil pro jiný svět.
  const answer = await core.awaitDecision(minted.id, {
    timeoutMs: 5_000, pollMs: 1, readTarget: async () => 'B se změnilo',
  });
  assert.equal(answer.state, 'precondition_changed',
    'schválení prošlo, přestože se cíl pod ním změnil');
  assert.equal(answer.decidedBy, DEVICE, 'ztratila se informace, kdo rozhodl');
});

await test('025 nezměněný cíl schválení propustí', async () => {
  clearAll();
  const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-p4', operationRef: 'fs.write:/x/c.js',
    subjectType: 'effect.write', subjectId: '/x/c.js', title: 'Zapsat',
    payload: { v: 4 },
    precondition: { kind: 'file-digest', ref: '/x/c.js', content: 'C' },
  });
  await handleApprovalDecide({
    rawDb: db, journal, principal, params: { id: minted.id },
    body: { decision: 'approve', operationId: 'op-precondition-002', payloadFingerprint: fingerprint({ v: 4 }) },
  });
  const answer = await core.awaitDecision(minted.id, {
    timeoutMs: 5_000, pollMs: 1, readTarget: async () => 'C',
  });
  assert.equal(answer.state, 'approve');
});

await test('025 cíl, který mezitím vznikl, je změna — ne „pořád nic"', async () => {
  clearAll();
  const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
  // Approval na vytvoření souboru, který v tu chvíli neexistoval.
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-p5', operationRef: 'fs.write:/x/novy.js',
    subjectType: 'effect.write', subjectId: '/x/novy.js', title: 'Vytvořit',
    payload: { v: 5 },
    precondition: { kind: 'file-digest', ref: '/x/novy.js', content: null },
  });
  await handleApprovalDecide({
    rawDb: db, journal, principal, params: { id: minted.id },
    body: { decision: 'approve', operationId: 'op-precondition-003', payloadFingerprint: fingerprint({ v: 5 }) },
  });
  const answer = await core.awaitDecision(minted.id, {
    timeoutMs: 5_000, pollMs: 1, readTarget: async () => 'někdo ho mezitím založil',
  });
  assert.equal(answer.state, 'precondition_changed',
    'zápis přes soubor, který mezitím někdo vytvořil, prošel jako schválený');
});

await test('025 bez čtečky cíle se approval neprohlásí za platný', async () => {
  clearAll();
  const core = createCompanionProducer({ rawDb: db, router: newRouter(), sleep: yieldTick });
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-p6', operationRef: 'fs.write:/x/d.js',
    subjectType: 'effect.write', subjectId: '/x/d.js', title: 'Zapsat',
    payload: { v: 6 },
    precondition: { kind: 'file-digest', ref: '/x/d.js', content: 'D' },
  });
  await handleApprovalDecide({
    rawDb: db, journal, principal, params: { id: minted.id },
    body: { decision: 'approve', operationId: 'op-precondition-004', payloadFingerprint: fingerprint({ v: 6 }) },
  });
  // Čtečka chybí — zapomenout ji nesmí být totéž co projít.
  const answer = await core.awaitDecision(minted.id, { timeoutMs: 5_000, pollMs: 1 });
  assert.equal(answer.state, 'precondition_changed');
  assert.equal(answer.reason, 'precondition_unverifiable');
});

await test('025 přiznaný předpoklad neznámého druhu se odmítne při ražbě', async () => {
  clearAll();
  const core = createCompanionProducer({ rawDb: db, router: newRouter() });
  await assert.rejects(
    () => core.requestApproval({
      origin: 'local', runId: 'run-p7', operationRef: 'x',
      subjectType: 'effect.write', subjectId: 'x', title: 'Zapsat', payload: {},
      precondition: { kind: 'vibe-check', ref: '/x', content: 'x' },
    }),
    error => error.reason === 'precondition_kind_unknown',
  );
});
} finally {
  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nCompanion producer: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
