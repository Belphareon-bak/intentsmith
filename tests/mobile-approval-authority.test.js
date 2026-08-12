// F-100 — an approval carries authority, or it cannot be granted · R-3 / DR-011
// ==============================================================================
//
// `F-100` blocks production and has four named parts: no production producer,
// no TTL authority, no mandatory fingerprint, and no authoritative binding to
// the run, the operation and the normalised content.
//
// **Three of the four are closed here.  The producer is not.**  Wiring an
// emitter would put approvals on the production surface before M6, which is
// release authority and not this work package's to take — the same reason
// `MobileChannel` stays out of the notification router.  So `F-100` stays open
// on that part, and the last test in this file states it in the code rather
// than only in a commit message, so nobody reads the other three passing and
// concludes the finding is closed.
//
// What is closed, and why each was a hole rather than an omission:
//
//   * **TTL authority.**  `expires_at` was whatever the writer put there.
//     `DR-011` says local 5 minutes and remote 15; the operator's design showed
//     10, which matches neither — which is what happens when a window is a
//     number a person can type.  It is now derived from the origin and there is
//     no parameter, and no other function, that can change it.
//
//   * **The fingerprint.**  `decideApproval` compared it only `if` one was
//     sent, so a client could skip §8.4's binding entirely by omitting a field.
//     An optional guard is not a guard.
//
//   * **The binding.**  A row could describe a request in prose and name
//     nothing it would authorise.  A grant over such a row is a grant the
//     server cannot explain, so the decide path refuses it — before the
//     operation key is claimed, so a refusal costs the device nothing.
//
// The queue deliberately still lists an unbound row.  Hiding a pending request
// would trade one lie for another: `SS-02` says "nic nečeká" is permission to
// put the phone down, and it has to stay true.
//
// ==============================================================================

// Direct-run isolation bootstrap.  Must be the first import: it redirects
// HOME/TMPDIR/XDG_* into a private root, so the `mkdtemp` below lands inside
// the sandbox instead of the real system temp.
import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/mobile/protocol.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { handleApprovals, handleApprovalDecide } from '../src/mobile/handlers.js';
import {
  createMobileApproval, approvalIsBound, approvalFingerprint,
  APPROVAL_TTL_MS, APPROVAL_ORIGINS, ApprovalAuthorityError,
} from '../src/mobile/approval-authority.js';

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

console.log('\n=== Approval authority (F-100, R-3 / DR-011) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-appr-'));
const db = new Database(path.join(runtimeDir, 'appr.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const DEVICE = 'device-phone';
const MINUTE = 60_000;
const journal = new OperationJournal(db);

const principal = { deviceId: DEVICE, name: 'phone', scopes: ['read:approvals', 'write:approvals'] };

function clearApprovals() {
  db.prepare('DELETE FROM mobile_approvals').run();
  db.prepare('DELETE FROM mobile_operations').run();
}

const payload = { files: ['src/server.js'], mode: 'write' };

function mint(overrides = {}) {
  return createMobileApproval(db, {
    origin: 'remote',
    runId: 'run-9',
    operationRef: 'effect-write-1',
    subjectType: 'lifecycle.checkpoint',
    subjectId: 'run-9',
    title: 'Zapsat do src/server.js',
    payload,
    ...overrides,
  });
}

function row(id) {
  return db.prepare('SELECT * FROM mobile_approvals WHERE id = ?').get(id);
}

let operationCounter = 0;
const decide = (approvalId, body = {}) => handleApprovalDecide({
  rawDb: db, journal, principal,
  params: { id: approvalId },
  body: {
    decision: 'approve',
    operationId: `op-${++operationCounter}`.padEnd(16, '0'),
    payloadFingerprint: approvalFingerprint(payload),
    ...body,
  },
});

try {
  // ── TTL authority (DR-011) ───────────────────────────────────────────────

  await test('DR-011 the window follows the origin: local 5 minutes, remote 15', () => {
    clearApprovals();
    const now = Date.UTC(2026, 7, 9, 12, 0, 0);
    const local = mint({ id: 'ap-local', origin: 'local', now });
    const remote = mint({ id: 'ap-remote', origin: 'remote', now });

    assert.equal(local.ttlMs, 5 * MINUTE);
    assert.equal(remote.ttlMs, 15 * MINUTE);
    assert.equal(Date.parse(row('ap-local').expires_at.replace(' ', 'T') + 'Z'), now + 5 * MINUTE);
    assert.equal(Date.parse(row('ap-remote').expires_at.replace(' ', 'T') + 'Z'), now + 15 * MINUTE);
    assert.deepEqual(APPROVAL_TTL_MS, { local: 5 * MINUTE, remote: 15 * MINUTE });
  });

  await test('DR-011 the caller cannot choose, lengthen or default the window', () => {
    clearApprovals();
    // No origin at all: refused rather than defaulted.  The wrong default is
    // the longer window, and nobody would have chosen it.
    assert.throws(() => mint({ origin: undefined }), /origin_required/);
    assert.throws(() => mint({ origin: 'whenever' }), /origin_required/);

    // And an attempt to pass a window straight through is simply not a
    // parameter — the row's expiry still comes from the origin.
    const now = Date.UTC(2026, 7, 9, 12, 0, 0);
    mint({ id: 'ap-ttl', origin: 'local', now, ttlMs: 60 * MINUTE, expiresAt: 'never' });
    assert.equal(Date.parse(row('ap-ttl').expires_at.replace(' ', 'T') + 'Z'), now + 5 * MINUTE);
  });

  await test('R-3 the window is single-use and cannot be extended, because nothing records an extension', () => {
    const columns = db.prepare('PRAGMA table_info(mobile_approvals)').all().map(column => column.name);
    for (const forbidden of ['extended_at', 'renewed_at', 'renewed_by', 'extension_count']) {
      assert.ok(!columns.includes(forbidden), `the schema can record an extension via ${forbidden}`);
    }
    const source = readFileSync(new URL('../src/mobile/handlers.js', import.meta.url), 'utf8')
      + readFileSync(new URL('../src/mobile/approval-authority.js', import.meta.url), 'utf8');
    assert.ok(!/UPDATE\s+mobile_approvals[\s\S]{0,200}expires_at\s*=/i.test(source),
      'some path updates expires_at, so the window is extendable after all');
  });

  // ── The fingerprint is computed, never accepted ──────────────────────────

  await test('F-100 the fingerprint is taken from the payload, not from the producer', () => {
    clearApprovals();
    mint({ id: 'ap-fp', payloadFingerprint: 'a'.repeat(64) });
    assert.equal(row('ap-fp').payload_fingerprint, fingerprint(payload),
      'a supplied fingerprint was stored, so the approval is not bound to its own content');
  });

  await test('F-100 the binding is over normalised content, so key order is not a different payload', () => {
    assert.equal(
      approvalFingerprint({ mode: 'write', files: ['src/server.js'] }),
      approvalFingerprint({ files: ['src/server.js'], mode: 'write' }),
    );
    assert.notEqual(approvalFingerprint(payload), approvalFingerprint({ ...payload, mode: 'delete' }));
  });

  await test('F-100 an approval must name the run and the operation it authorises', () => {
    clearApprovals();
    for (const field of ['runId', 'operationRef', 'subjectType', 'subjectId', 'title']) {
      assert.throws(() => mint({ [field]: undefined }), /binding_required/, `${field} was optional`);
      assert.throws(() => mint({ [field]: '   ' }), /binding_required/, `${field} accepted whitespace`);
    }
    assert.throws(() => mint({ payload: undefined }), /payload_required/);
    assert.ok(ApprovalAuthorityError);
  });

  // ── The negatives on the decide path ─────────────────────────────────────

  await test('F-100 a decision without a fingerprint is refused, not silently unbound', async () => {
    clearApprovals();
    const minted = mint({ id: 'ap-nofp' });

    const missing = await decide(minted.id, { payloadFingerprint: undefined });
    assert.equal(missing.status, 400, 'a decision with no fingerprint was accepted');
    assert.equal(missing.body.error.code, 'bad_request');
    assert.equal(missing.body.error.field, 'payloadFingerprint');
    assert.equal(row(minted.id).decided_at, null, 'the approval was granted anyway');

    const empty = await decide(minted.id, { payloadFingerprint: '' });
    assert.equal(empty.status, 400, 'an empty fingerprint passed as "supplied"');
    assert.equal(row(minted.id).decided_at, null);

    // And the correct fingerprint still decides, so this is a boundary and not
    // a blanket refusal.
    const good = await decide(minted.id);
    assert.equal(good.status, 200);
    assert.equal(row(minted.id).decision, 'approve');
  });

  await test('F-100 a wrong fingerprint is superseded, as §8.4 already required', async () => {
    clearApprovals();
    const minted = mint({ id: 'ap-moved' });
    const response = await decide(minted.id, { payloadFingerprint: 'b'.repeat(64) });
    assert.equal(response.body.error.code, 'approval_superseded');
    assert.equal(row(minted.id).decided_at, null);
  });

  await test('F-100 an approval with no authoritative binding cannot be granted', async () => {
    clearApprovals();
    // Exactly what any writer could produce before this work: prose, an expiry
    // of its own choosing, and nothing it names.
    db.prepare(`
      INSERT INTO mobile_approvals (id, subject_type, subject_id, title, detail, payload_fingerprint, expires_at)
      VALUES ('ap-unbound', 'task', 'whatever', 'Nevázaný požadavek', NULL, ?, '2099-01-01 00:00:00')
    `).run(approvalFingerprint(payload));

    assert.equal(approvalIsBound(row('ap-unbound')), false);
    const response = await decide('ap-unbound');
    assert.equal(response.status, 409, 'an unbound approval was granted');
    assert.equal(response.body.error.code, 'state_conflict');
    assert.equal(response.body.error.reason, 'unbound_approval');
    assert.equal(row('ap-unbound').decided_at, null);

    // Refused before the operation key is claimed: a refusal must not leave the
    // device holding an attempt it now has to resolve (MD-19).
    const claimed = db.prepare('SELECT COUNT(*) AS n FROM mobile_operations WHERE device_id = ?').get(DEVICE).n;
    assert.equal(claimed, 0, 'the refusal claimed an operation key the device must now resolve');
  });

  await test('F-100 a partial binding is not a binding', async () => {
    clearApprovals();
    const cases = {
      'ap-no-origin': [null, 'run-9', 'effect-1'],
      'ap-no-run': ['remote', null, 'effect-1'],
      'ap-no-op': ['remote', 'run-9', null],
      'ap-bad-origin': ['sometimes', 'run-9', 'effect-1'],
      'ap-blank-run': ['remote', '  ', 'effect-1'],
    };
    for (const [id, [origin, runId, operationRef]] of Object.entries(cases)) {
      db.prepare(`
        INSERT INTO mobile_approvals
          (id, subject_type, subject_id, title, payload_fingerprint, expires_at, origin, run_id, operation_ref)
        VALUES (?, 'task', 'x', 'Částečná vazba', ?, '2099-01-01 00:00:00', ?, ?, ?)
      `).run(id, approvalFingerprint(payload), origin, runId, operationRef);

      const response = await decide(id);
      assert.equal(response.body.error?.reason, 'unbound_approval', `${id} was accepted as bound`);
      assert.equal(row(id).decided_at, null);
    }
  });

  await test('SS-02 the queue still lists an unbound approval — hiding it would be its own lie', async () => {
    clearApprovals();
    db.prepare(`
      INSERT INTO mobile_approvals (id, subject_type, subject_id, title, payload_fingerprint, expires_at)
      VALUES ('ap-listed', 'task', 'x', 'Čeká, rozhodnout nejde', ?, '2099-01-01 00:00:00')
    `).run(approvalFingerprint(payload));

    const listed = await handleApprovals({ rawDb: db, principal });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data.some(item => item.id === 'ap-listed'),
      'a pending request vanished from the queue, so "nic nečeká" could be false');
  });

  // ── What remains open ────────────────────────────────────────────────────

  await test('F-100 stays open: there is still no production producer, and nothing pretends otherwise', () => {
    // The mint exists and is correct; nothing in the running system calls it.
    // Wiring an emitter would put approvals on the production surface before M6
    // — release authority, not this work package's — so the finding keeps that
    // part open.  This test fails the day someone wires it *without* recording
    // the decision, which is the outcome worth catching.
    const roots = ['src/server.js', 'src/mobile/gateway.js', 'src/mobile/handlers.js'];
    for (const file of roots) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.ok(!/createMobileApproval/.test(source),
        `${file} now produces approvals; F-100's producer half was closed without recording it`);
    }
    assert.deepEqual(APPROVAL_ORIGINS, ['local', 'remote']);
  });
} finally {
  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nApproval authority: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
