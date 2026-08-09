// `result_persistence_failed` — driven by real failing writes, not by mocks.
// ==============================================================================
//
// `result_persistence_failed` is the one UNKNOWN reason that means *the effect
// almost certainly happened*: the upstream answered, and the gateway could not
// write the answer down.  Every other reason leaves room for "maybe nothing
// happened"; this one does not.  A vocabulary entry that strong has to be shown
// being produced by an actual failure, or it is a claim about code nobody ran.
//
// So the failure is injected at the database, not in JavaScript.  A `BEFORE
// UPDATE ... RAISE(ABORT)` trigger makes exactly one statement fail:
//
//     UPDATE mobile_operations
//        SET state = 'CONFIRMED', result_json = ?, error_code = ?, resolved_at = CURRENT_TIMESTAMP
//      WHERE device_id = ? AND operation_id = ? AND state = 'PENDING'
//
// — `OperationJournal._resolve()`, reached from `journal.confirm()` at
// `src/mobile/handlers.js:309`.  Nothing else is stubbed: the same trigger
// leaves the `markUnknown()` write and the REJECTED write untouched, which the
// suite asserts rather than assumes, so the injection cannot be quietly
// over-broad and make the result meaningless.
//
// Three questions the review asked, one section each:
//
//   §1  which concrete write fails
//   §2  how the UNKNOWN reason is then stored, and that it survives the handle
//   §3  what happens when the database is gone entirely — including the part
//       that is *not* satisfying, stated plainly instead of papered over
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { startMobileGateway } from '../src/mobile/gateway.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { handleChat } from '../src/mobile/handlers.js';
import { UNKNOWN_REASONS } from '../src/mobile/protocol.js';
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

console.log('\n=== Mobile fault injection: result_persistence_failed ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-fault-'));
const dbPath = path.join(runtimeDir, 'fault.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
await runMigrations(db);

/** An upstream that succeeds, so the flow reaches the result write at all. */
class AnsweringUpstream {
  constructor() {
    this.dispatches = 0;
    this.nextResponse = null;
  }
  async probe() { return { reachable: true }; }
  async postChat() {
    this.dispatches++;
    if (this.nextResponse) {
      const response = this.nextResponse;
      this.nextResponse = null;
      await response.beforeReturn?.();
      return response.result;
    }
    return { ok: true, data: { response: 'odpověď z modelu', mode: 'chat', confidence: 0.91 } };
  }

  respondOnce({ beforeReturn, result }) {
    assert.equal(this.nextResponse, null, 'only one deterministic upstream response may be queued');
    this.nextResponse = { beforeReturn, result };
  }
}

const upstream = new AnsweringUpstream();

const gateway = await startMobileGateway({
  rawDb: db,
  host: '127.0.0.1',
  port: 0,
  upstream,
  journal: new OperationJournal(db),
  env: { ...process.env, C3_MOBILE_PAIRING: 'on', C3_MOBILE_UI: 'off' },
  logger: { error: () => {}, warn: () => {}, info: () => {} },
});

const base = gateway.url;

async function call(pathname, { method = 'GET', token = null, body = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(base + pathname, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* no body */ }
  return { status: response.status, body: json };
}

async function pairDevice(scopes) {
  const issued = createPairingCode(db, { scopes, ttlMs: 60_000 });
  const claimed = await call('/m1/pair/claim', {
    method: 'POST', body: { code: issued.code, deviceName: 'fault device' },
  });
  assert.equal(claimed.status, 200, `pairing failed: ${JSON.stringify(claimed.body)}`);
  return claimed.body.data;
}

/**
 * Make the CONFIRMED write — and only that write — fail, at the database.
 *
 * `RAISE(ABORT)` in a BEFORE UPDATE trigger is a genuine statement failure with
 * a genuine rollback, which a thrown stub is not: it also proves the row is
 * left untouched by the failed write rather than half-updated.
 *
 * `await fn()` and not `return fn()`: the fault has to still be installed when
 * the write actually happens.  A synchronous `finally` would drop the trigger
 * the moment the callback handed back its promise — the request would then
 * complete against a healthy database and the test would pass by testing
 * nothing, which is the failure mode worth guarding against here.
 */
async function withFailingResultWrite(fn) {
  db.exec(`
    CREATE TRIGGER inject_result_write_failure
    BEFORE UPDATE ON mobile_operations
    WHEN NEW.state = 'CONFIRMED'
    BEGIN
      SELECT RAISE(ABORT, 'injected disk failure on the result write');
    END
  `);
  try {
    return await fn();
  } finally {
    db.exec('DROP TRIGGER IF EXISTS inject_result_write_failure');
  }
}

function row(deviceId, operationId, handle = db) {
  return handle.prepare(`
    SELECT state, unknown_reason, unknown_at, result_json, resolved_at
      FROM mobile_operations WHERE device_id = ? AND operation_id = ?
  `).get(deviceId, operationId);
}

function insertApproval({
  id,
  payloadFingerprint = `fingerprint-${id}`,
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
  decidedAt = null,
  decision = null,
  decidedBy = null,
  decisionOperation = null,
}) {
  db.prepare(`
    INSERT INTO mobile_approvals (
      id, subject_type, subject_id, title, detail, payload_fingerprint,
      expires_at, decided_at, decision, decided_by, decision_operation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, 'task', `subject-${id}`, `Approval ${id}`, null, payloadFingerprint,
    expiresAt, decidedAt, decision, decidedBy, decisionOperation,
  );
  return { id, payloadFingerprint };
}

function approvalRow(approvalId) {
  return db.prepare(`
    SELECT decided_at, decision, decided_by, decision_operation
      FROM mobile_approvals
     WHERE id = ?
  `).get(approvalId);
}

db.exec(`
  CREATE TEMP TABLE approval_effect_audit (
    approval_id TEXT PRIMARY KEY,
    updates INTEGER NOT NULL DEFAULT 0
  );
  CREATE TEMP TRIGGER audit_mobile_approval_decision
  AFTER UPDATE OF decided_at, decision ON mobile_approvals
  WHEN OLD.decided_at IS NOT NEW.decided_at OR OLD.decision IS NOT NEW.decision
  BEGIN
    INSERT INTO approval_effect_audit (approval_id, updates)
    VALUES (NEW.id, 1)
    ON CONFLICT(approval_id) DO UPDATE SET updates = updates + 1;
  END;
`);

function approvalEffectCount(approvalId) {
  return db.prepare(`
    SELECT updates FROM approval_effect_audit WHERE approval_id = ?
  `).get(approvalId)?.updates ?? 0;
}

async function withFailingApprovalResolution(state, fn) {
  assert.ok(state === 'CONFIRMED' || state === 'REJECTED');
  db.exec(`
    CREATE TRIGGER inject_approval_resolution_failure
    BEFORE UPDATE ON mobile_operations
    WHEN NEW.state = '${state}'
    BEGIN
      SELECT RAISE(ABORT, 'injected approval result persistence failure');
    END
  `);
  try {
    return await fn();
  } finally {
    db.exec('DROP TRIGGER IF EXISTS inject_approval_resolution_failure');
  }
}

async function withIgnoredApprovalDecision(approvalId, fn) {
  const quotedId = String(approvalId).replaceAll("'", "''");
  db.exec(`
    CREATE TRIGGER inject_approval_race_lost
    BEFORE UPDATE ON mobile_approvals
    WHEN OLD.id = '${quotedId}'
    BEGIN
      SELECT RAISE(IGNORE);
    END
  `);
  try {
    return await fn();
  } finally {
    db.exec('DROP TRIGGER IF EXISTS inject_approval_race_lost');
  }
}

async function assertApprovalPersistenceRecovery({
  approval,
  operationId,
  decision = 'approve',
  payloadFingerprint = approval.payloadFingerprint,
  failedState,
  expectedApprovalDecision,
  expectedDecisionUpdates,
  raceLost = false,
}) {
  const device = await pairDevice(['write:approvals']);
  const request = {
    method: 'POST',
    token: device.token,
    body: { decision, operationId, payloadFingerprint },
  };
  const decide = () => call(`/m1/approvals/${approval.id}/decide`, request);
  const first = await withFailingApprovalResolution(
    failedState,
    () => raceLost ? withIgnoredApprovalDecision(approval.id, decide) : decide(),
  );

  assert.equal(first.status, 503);
  assert.equal(first.body.error.code, 'server_unavailable');
  assert.equal(first.body.error.reason, 'result_persistence_failed');
  assert.equal(first.body.error.state, 'UNKNOWN');
  assert.equal(first.body.error.resolveBy, `GET /m1/operations/${operationId}`);

  const durableOperation = row(device.deviceId, operationId);
  assert.equal(durableOperation.state, 'UNKNOWN');
  assert.equal(durableOperation.unknown_reason, 'result_persistence_failed');
  const durableApproval = approvalRow(approval.id);
  assert.equal(durableApproval.decision, expectedApprovalDecision);
  assert.equal(approvalEffectCount(approval.id), expectedDecisionUpdates);

  const beforeReplay = {
    decidedAt: durableApproval.decided_at,
    decidedBy: durableApproval.decided_by,
    decisionOperation: durableApproval.decision_operation,
    updates: approvalEffectCount(approval.id),
  };
  const replay = await call(`/m1/approvals/${approval.id}/decide`, request);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.state, 'UNKNOWN');
  assert.equal(replay.body.replayed, true);

  const afterReplay = approvalRow(approval.id);
  assert.deepEqual({
    decidedAt: afterReplay.decided_at,
    decidedBy: afterReplay.decided_by,
    decisionOperation: afterReplay.decision_operation,
    updates: approvalEffectCount(approval.id),
  }, beforeReplay, 'replay must not repeat or rewrite the approval decision effect');
}

try {
  // ── §1 Which concrete write fails ────────────────────────────────────────

  await test('§1 the failing statement is the CONFIRMED result write in _resolve()', async () => {
    const journal = new OperationJournal(db);
    const operationId = 'namedwri' + 'a'.repeat(16);
    journal.begin({
      deviceId: 'dev-named', operationId, operationType: 'chat.send', request: { m: 'x' },
    });

    await withFailingResultWrite(() => {
      assert.throws(
        () => journal.confirm('dev-named', operationId, { response: 'hi' }),
        /injected disk failure on the result write/,
        'confirm() must surface the failure rather than swallow it',
      );
      // The same table, the same row, a different target state: still writable.
      // This is what makes the injection targeted instead of "the database is
      // broken", and it is why markUnknown() can still record the cause.
      journal.markUnknown('dev-named', operationId, UNKNOWN_REASONS.RESULT_PERSISTENCE_FAILED);
    });

    const after = row('dev-named', operationId);
    assert.equal(after.state, 'UNKNOWN');
    assert.equal(after.unknown_reason, 'result_persistence_failed');
    assert.equal(after.result_json, null, 'the aborted write must leave no partial result');
    assert.equal(after.resolved_at, null, 'a lost result is not a resolution');
  });

  await test('§1 the injection is targeted: a REJECTED write still succeeds', async () => {
    const journal = new OperationJournal(db);
    const operationId = 'stillrej' + 'b'.repeat(16);
    journal.begin({
      deviceId: 'dev-rej', operationId, operationType: 'chat.send', request: { m: 'y' },
    });
    await withFailingResultWrite(() => {
      journal.reject('dev-rej', operationId, 'upstream_bad_request');
    });
    assert.equal(row('dev-rej', operationId).state, 'REJECTED',
      'if every write failed, §1 would prove nothing about this particular one');
  });

  // ── §2 How the UNKNOWN reason reaches the client, and that it is durable ──

  await test('§2 over HTTP: a failed result write answers 503 / result_persistence_failed', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'httpfail' + 'c'.repeat(16);
    const before = upstream.dispatches;

    const response = await withFailingResultWrite(() => call('/m1/chat', {
      method: 'POST',
      token: device.token,
      body: { conversationId: 'conv-fault-1', message: 'ahoj', operationId },
    }));

    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'server_unavailable');
    assert.equal(response.body.error.reason, 'result_persistence_failed');
    assert.equal(response.body.error.state, 'UNKNOWN');
    assert.equal(response.body.error.resolveBy, `GET /m1/operations/${operationId}`,
      'the client must be told to read the state, never to retry with a new key');
    assert.equal(upstream.dispatches, before + 1, 'the effect happened exactly once');

    // Not merely reported on the wire — written down.
    const stored = row(device.deviceId, operationId);
    assert.equal(stored.state, 'UNKNOWN');
    assert.equal(stored.unknown_reason, 'result_persistence_failed');
    assert.ok(stored.unknown_at, 'the recovery screen ages an UNKNOWN from unknown_at');
    assert.equal(stored.result_json, null);
  });

  await test('§2 the stored reason survives a different database handle', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'durablew' + 'd'.repeat(16);

    await withFailingResultWrite(() => call('/m1/chat', {
      method: 'POST',
      token: device.token,
      body: { conversationId: 'conv-fault-2', message: 'ahoj', operationId },
    }));

    // A second handle on the same file reads committed state only — the point
    // of §8.9: the record matters most after a restart, so it must be on disk,
    // not in the writer's own connection.
    const reader = new Database(dbPath, { readonly: true });
    try {
      const stored = row(device.deviceId, operationId, reader);
      assert.equal(stored.state, 'UNKNOWN');
      assert.equal(stored.unknown_reason, 'result_persistence_failed');
    } finally {
      reader.close();
    }
  });

  await test('§2 the client resolves it by reading, and gets the reason back', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'readback' + 'e'.repeat(16);

    await withFailingResultWrite(() => call('/m1/chat', {
      method: 'POST',
      token: device.token,
      body: { conversationId: 'conv-fault-3', message: 'ahoj', operationId },
    }));

    const lookup = await call(`/m1/operations/${operationId}`, { token: device.token });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.data.state, 'UNKNOWN');
    assert.equal(lookup.body.data.unknownReason, 'result_persistence_failed');
    assert.ok(lookup.body.data.unknownAt);
    assert.ok(lookup.body.serverTime, 'the read is itself the current check');

    // Deliberately absent here (handlers.js §"GET /m1/operations/:operationId"):
    // this response *is* the check, so repeating a stored "last checked" would
    // only restate `serverTime`.  The stamp is still written, and it is the
    // list route — where the age is about *other* attempts — that reports it.
    // Asserted so the split stays a decision instead of drifting into an
    // accident: MS-20 reads ages from the list, not from a single lookup.
    assert.equal(lookup.body.data.lastCheckedAt, undefined, 'a single lookup does not restate its own check');
    assert.ok(
      db.prepare('SELECT last_checked_at FROM mobile_operations WHERE device_id = ? AND operation_id = ?')
        .get(device.deviceId, operationId).last_checked_at,
      'the read must still record that it happened',
    );

    const listed = await call('/m1/operations', { token: device.token });
    const entry = listed.body.data.find(op => op.operationId === operationId);
    assert.ok(entry, 'an UNKNOWN attempt must appear in the recovery list');
    assert.equal(entry.unknownReason, 'result_persistence_failed');
    assert.ok(entry.lastCheckedAt, 'the list is where "ověřeno před N" comes from');
  });

  await test('§2 retrying the same key after the failure does not send a second time', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'noresend' + 'f'.repeat(16);
    const payload = { conversationId: 'conv-fault-4', message: 'ahoj', operationId };

    await withFailingResultWrite(() => call('/m1/chat', { method: 'POST', token: device.token, body: payload }));
    const afterFirst = upstream.dispatches;

    // The trigger is gone now: if the record were missing or reusable, this
    // would dispatch again and succeed — the duplicate send the journal exists
    // to prevent, in the exact state where it is most tempting.
    const retry = await call('/m1/chat', { method: 'POST', token: device.token, body: payload });

    assert.equal(upstream.dispatches, afterFirst, 'a lost result must not become a second effect');
    assert.equal(retry.status, 202);
    assert.equal(retry.body.data.state, 'UNKNOWN');
    assert.equal(retry.body.replayed, true);
  });

  await test('F-034 success race: wire follows durable UNKNOWN and replay does not dispatch', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'racesucc' + 's'.repeat(16);
    const payload = { conversationId: 'conv-race-success', message: 'ahoj', operationId };
    const before = upstream.dispatches;

    upstream.respondOnce({
      beforeReturn: () => new OperationJournal(db).markUnknown(
        device.deviceId, operationId, UNKNOWN_REASONS.PROCESS_TERMINATED,
      ),
      result: { ok: true, data: { response: 'hotovo', mode: 'chat', confidence: 0.99 } },
    });

    const response = await call('/m1/chat', { method: 'POST', token: device.token, body: payload });
    const stored = row(device.deviceId, operationId);

    assert.equal(upstream.dispatches, before + 1, 'the first request dispatches exactly once');
    assert.equal(response.status, 202);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.state, stored.state);
    assert.equal(response.body.data.state, 'UNKNOWN', 'zero-row confirm must not claim CONFIRMED');
    assert.equal(response.body.data.result, null);
    assert.equal(stored.unknown_reason, 'process_terminated');

    const afterFirst = upstream.dispatches;
    const replay = await call('/m1/chat', { method: 'POST', token: device.token, body: payload });
    assert.equal(upstream.dispatches, afterFirst, 'UNKNOWN replay must not dispatch the effect again');
    assert.equal(replay.status, 202);
    assert.equal(replay.body.data.state, stored.state);
    assert.equal(replay.body.replayed, true);
  });

  await test('F-034 reject race: wire follows durable UNKNOWN and replay does not dispatch', async () => {
    const device = await pairDevice(['write:chat']);
    const operationId = 'racereje' + 'r'.repeat(16);
    const payload = { conversationId: 'conv-race-reject', message: 'ahoj', operationId };
    const before = upstream.dispatches;

    upstream.respondOnce({
      beforeReturn: () => new OperationJournal(db).markUnknown(
        device.deviceId, operationId, UNKNOWN_REASONS.PROCESS_TERMINATED,
      ),
      result: { ok: false, decided: true, code: 'upstream_rejected' },
    });

    const response = await call('/m1/chat', { method: 'POST', token: device.token, body: payload });
    const stored = row(device.deviceId, operationId);

    assert.equal(upstream.dispatches, before + 1, 'the first request dispatches exactly once');
    assert.equal(response.status, 202);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.state, stored.state);
    assert.equal(response.body.data.state, 'UNKNOWN', 'zero-row reject must not claim REJECTED');
    assert.equal(response.body.data.result, null);
    assert.equal(stored.unknown_reason, 'process_terminated');

    const afterFirst = upstream.dispatches;
    const replay = await call('/m1/chat', { method: 'POST', token: device.token, body: payload });
    assert.equal(upstream.dispatches, afterFirst, 'UNKNOWN replay must not dispatch the effect again');
    assert.equal(replay.status, 202);
    assert.equal(replay.body.data.state, stored.state);
    assert.equal(replay.body.replayed, true);
  });


  // ── F-048 Approval result-persistence recovery ───────────────────────────

  await test('F-048 approval confirm fault records UNKNOWN after the decision effect', async () => {
    const approval = insertApproval({ id: 'approval-confirm-fault' });
    await assertApprovalPersistenceRecovery({
      approval,
      operationId: 'approvalconfirmfault001',
      failedState: 'CONFIRMED',
      expectedApprovalDecision: 'approve',
      expectedDecisionUpdates: 1,
    });
  });

  await test('F-048 superseded reject fault records UNKNOWN and does not decide approval', async () => {
    const approval = insertApproval({ id: 'approval-superseded-fault' });
    await assertApprovalPersistenceRecovery({
      approval,
      operationId: 'approvalsuperseded01',
      payloadFingerprint: 'different-fingerprint',
      failedState: 'REJECTED',
      expectedApprovalDecision: null,
      expectedDecisionUpdates: 0,
    });
  });

  await test('F-048 already-decided reject fault records UNKNOWN without another decision', async () => {
    const approval = insertApproval({
      id: 'approval-already-decided-fault',
      decidedAt: new Date().toISOString(),
      decision: 'reject',
      decidedBy: 'existing-device',
      decisionOperation: 'existingdecision0001',
    });
    await assertApprovalPersistenceRecovery({
      approval,
      operationId: 'approvalalreadydecided1',
      failedState: 'REJECTED',
      expectedApprovalDecision: 'reject',
      expectedDecisionUpdates: 0,
    });
  });

  await test('F-048 expired reject fault records UNKNOWN and leaves approval undecided', async () => {
    const approval = insertApproval({
      id: 'approval-expired-fault',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await assertApprovalPersistenceRecovery({
      approval,
      operationId: 'approvalexpiredfault01',
      failedState: 'REJECTED',
      expectedApprovalDecision: null,
      expectedDecisionUpdates: 0,
    });
  });

  await test('F-048 race-lost reject fault records UNKNOWN and does not repeat the update', async () => {
    const approval = insertApproval({ id: 'approval-race-lost-fault' });
    await assertApprovalPersistenceRecovery({
      approval,
      operationId: 'approvalracelostfault1',
      failedState: 'REJECTED',
      expectedApprovalDecision: null,
      expectedDecisionUpdates: 0,
      raceLost: true,
    });
  });

  // ── §3 The database is gone entirely ─────────────────────────────────────

  await test('§3 with no database at all, the answer is honest and nothing is written', async () => {
    // The handler's inner `catch {}` around markUnknown covers this case, and
    // the comment there claims "then nothing here can record anything".  That
    // claim is tested rather than trusted.
    const deadDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-dead-'));
    const deadPath = path.join(deadDir, 'dead.sqlite');
    const deadDb = new Database(deadPath);
    deadDb.pragma('journal_mode = WAL');
    await runMigrations(deadDb);

    const journal = new OperationJournal(deadDb);
    const operationId = 'nodbatal' + 'g'.repeat(16);

    // The database dies while the upstream call is in flight — the realistic
    // ordering: the operation is already claimed, the effect already happening.
    const dyingUpstream = {
      async probe() { return { reachable: true }; },
      async postChat() {
        deadDb.close();
        return { ok: true, data: { response: 'odpověď', mode: 'chat', confidence: 0.5 } };
      },
    };

    const result = await handleChat({
      rawDb: deadDb,
      journal,
      upstream: dyingUpstream,
      principal: { id: 'p1', deviceId: 'dev-dead', scopes: ['write:chat'] },
      body: { conversationId: 'conv-dead', message: 'ahoj', operationId },
    });

    assert.equal(result.status, 503);
    assert.equal(result.body.error.reason, 'result_persistence_failed',
      'the client is still told the effect may have happened');
    assert.equal(result.body.error.state, 'UNKNOWN');

    // And the honest part: with the database gone, the UNKNOWN could not be
    // recorded.  The row is still PENDING on disk from `begin()`.  This is a
    // real limit, not a bug to hide — nothing in the process can write when
    // there is nothing to write to.
    const reopened = new Database(deadPath);
    try {
      const stored = row('dev-dead', operationId, reopened);
      assert.equal(stored.state, 'PENDING',
        'the wire answer is all that exists when the database is unreachable');
      assert.equal(stored.unknown_reason, null);
    } finally {
      reopened.close();
    }
    rmSync(deadDir, { recursive: true, force: true });
  });

  await test('§3 the row a dead database left PENDING is recovered by the next start', async () => {
    // The gap above closes on restart rather than staying a lie forever: the
    // owner is gone, so the crash sweep reaches it.  This is the seam between
    // this suite and mobile-operation-isolation.test.js.
    const orphanDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-orphan-'));
    const orphanPath = path.join(orphanDir, 'orphan.sqlite');
    const orphanDb = new Database(orphanPath);
    orphanDb.pragma('journal_mode = WAL');
    await runMigrations(orphanDb);

    const operationId = 'strandedp' + 'h'.repeat(15);
    new OperationJournal(orphanDb).begin({
      deviceId: 'dev-orphan', operationId, operationType: 'chat.send', request: { m: 'x' },
    });
    assert.equal(row('dev-orphan', operationId, orphanDb).state, 'PENDING');

    const restarted = await startMobileGateway({
      rawDb: orphanDb, host: '127.0.0.1', port: 0,
      upstream: new AnsweringUpstream(), journal: new OperationJournal(orphanDb),
      env: { ...process.env, C3_MOBILE_UI: 'off' },
      logger: { error: () => {}, warn: () => {}, info: () => {} },
    });
    try {
      const stored = row('dev-orphan', operationId, orphanDb);
      assert.equal(stored.state, 'UNKNOWN');
      assert.equal(stored.unknown_reason, 'process_terminated',
        'an unrecorded outcome from a dead process is process_terminated, not a lost result');
    } finally {
      await restarted.stop();
      orphanDb.close();
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });
} finally {
  await gateway.stop();
  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile fault injection: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
