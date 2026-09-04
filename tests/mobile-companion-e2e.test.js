// ★ The whole use case, end to end: a run asks, a phone answers, the machine acts.
// ==============================================================================
//
// Every other suite tests one seam.  This one tests the claim the companion
// exists to make — *a tap on a phone reaches the machine* — and it tests it the
// only way that can fail honestly: with the real gateway process, over HTTP,
// through pairing, with the producer running in a **different process** from
// the one that answers.
//
// The shape matters.  A single-process test would pass over an in-memory
// promise and prove nothing about the deployment, where the gateway and the
// core are separate processes sharing one SQLite file.  `F-100`'s producer half
// could not be built on the IDE's `edit_request` map for exactly that reason,
// so the test that closes it must not quietly reintroduce the assumption.
//
// Four things are asserted, in the order a sceptic would ask them:
//
//   1. an approval minted by the producer is **visible to the phone** through
//      `GET /m1/approvals`, with the fingerprint it will have to echo back;
//   2. the S1 mirror arrives in `GET /m1/notifications` and carries **no
//      content** — the same assertion as the unit suite, but over the wire,
//      where a serialisation could have widened it;
//   3. the phone's `POST /m1/approvals/:id/decide` **releases the waiting run**
//      in the other process, and the effect happens *after* the decision;
//   4. a rejection stops the effect, and a phone that never answers leaves the
//      run saying "expired" rather than proceeding.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withOwnedServer } from './helpers/server-supervisor.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPairingCode } from '../src/mobile/pairing.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { NotificationRouter } from '../src/notifications/service.js';
import { MobileChannel } from '../src/notifications/channels/mobile.js';

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

console.log('\n=== ★ Companion end to end (gateway process + phone + producer) ===');

const workdir = mkdtempSync(path.join(tmpdir(), 'is-e2e-effect-'));

/**
 * A phone: nothing but a token and `fetch`.  Deliberately not a helper class —
 * every call here is one the real client makes, spelled out, so a route change
 * breaks this suite instead of being absorbed by an abstraction.
 */
function phone(baseUrl, token) {
  const call = async (method, route, body) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    approvals: () => call('GET', '/m1/approvals'),
    notifications: () => call('GET', '/m1/notifications'),
    decide: (id, payload) => call('POST', `/m1/approvals/${id}/decide`, payload),
  };
}

/** Pair a device the way `scripts/mobile-pair.js` does, then claim it over HTTP. */
async function pair(server, scopes) {
  const db = new Database(server.dbPath);
  let code;
  try {
    code = createPairingCode(db, { scopes, label: 'e2e' });
  } finally {
    db.close();
  }
  const response = await fetch(`${server.baseUrl}/m1/pair/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.code, deviceName: 'E2E telefon' }),
  });
  // Read once: the failure message and the success path cannot both consume
  // the body, and an assertion whose message throws hides the assertion.
  const text = await response.text();
  assert.equal(response.status, 200, `pairing failed: ${text}`);
  const claimed = JSON.parse(text);
  return { token: claimed.data.token, deviceId: claimed.data.deviceId };
}

/**
 * The core side.  Opens its **own** handle to the same file — the deployment's
 * shape, and the only way the decision can be shown to cross a boundary.
 */
function coreSide(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const router = new NotificationRouter({ db });
  router.registerChannel(new MobileChannel({ db }));
  const producer = createCompanionProducer({
    rawDb: db,
    router,
  });
  return { db, producer, close: () => db.close() };
}

const SCOPES = ['read:approvals', 'write:approvals', 'read:notifications'];
const SERVER_OPTS = {
  entry: 'src/mobile-gateway.js',
  env: { C3_MOBILE_UI: 'off', C3_MOBILE_PAIRING: 'on' },
};

await test('★ approve on the phone → the run performs the effect it was holding', async () => {
  await withOwnedServer(SERVER_OPTS, async server => {
    const device = await pair(server, SCOPES);
    const app = phone(server.baseUrl, device.token);
    const core = coreSide(server.dbPath);
    const effect = path.join(workdir, 'approved.txt');

    try {
      // The run reaches an effect it will not perform unsupervised.
      const approval = await core.producer.requestApproval({
        origin: 'local',
        runId: 'run-e2e-1',
        operationRef: `fs.write:${effect}`,
        subjectType: 'effect.write',
        subjectId: effect,
        title: 'Zapsat soubor',
        detail: effect,
        payload: { path: effect, content: 'approved' },
      });

      // It waits on the row, not on a callback: the answer will be written by
      // the gateway process, which shares no memory with this one.
      let performed = false;
      const run = (async () => {
        const answer = await core.producer.awaitDecision(approval.id, {
          timeoutMs: 20_000, pollMs: 100,
        });
        if (answer.state === 'approve') {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(effect, 'approved', 'utf8');
          performed = true;
        }
        return answer;
      })();

      // 1. The phone can see it.
      const queue = await app.approvals();
      assert.equal(queue.status, 200);
      const item = queue.body.data.find(entry => entry.id === approval.id);
      assert.ok(item, 'the minted approval never reached the phone');
      assert.ok(item.payloadFingerprint, 'the phone was given nothing to echo back');

      // The effect must not have happened yet.  If it had, the approval would
      // be decoration over an action already taken.
      assert.equal(existsSync(effect), false, 'the run acted before it was allowed to');

      // 2. The phone answers, exactly as the client does.
      const decided = await app.decide(approval.id, {
        decision: 'approve',
        operationId: 'op-e2e-approve-0001',
        payloadFingerprint: item.payloadFingerprint,
      });
      assert.equal(decided.status, 200, JSON.stringify(decided.body));

      // 3. The other process wakes up and acts.
      const answer = await run;
      assert.equal(answer.state, 'approve');
      assert.equal(answer.decidedBy, device.deviceId);
      assert.equal(performed, true);
      assert.equal(readFileSync(effect, 'utf8'), 'approved');
    } finally {
      core.close();
    }
  });
});

await test('★ reject on the phone → the effect does not happen', async () => {
  await withOwnedServer(SERVER_OPTS, async server => {
    const device = await pair(server, SCOPES);
    const app = phone(server.baseUrl, device.token);
    const core = coreSide(server.dbPath);
    const effect = path.join(workdir, 'rejected.txt');

    try {
      const approval = await core.producer.requestApproval({
        origin: 'local', runId: 'run-e2e-2', operationRef: `fs.write:${effect}`,
        subjectType: 'effect.write', subjectId: effect,
        title: 'Zapsat soubor', payload: { path: effect, content: 'rejected' },
      });
      const run = core.producer.awaitDecision(approval.id, { timeoutMs: 20_000, pollMs: 100 });

      const item = (await app.approvals()).body.data.find(entry => entry.id === approval.id);
      const decided = await app.decide(approval.id, {
        decision: 'reject',
        operationId: 'op-e2e-reject-00001',
        payloadFingerprint: item.payloadFingerprint,
      });
      assert.equal(decided.status, 200, JSON.stringify(decided.body));

      assert.equal((await run).state, 'reject');
      assert.equal(existsSync(effect), false, 'a rejected effect happened anyway');
    } finally {
      core.close();
    }
  });
});

await test('DR-013 the notification the phone receives over the wire carries no content', async () => {
  await withOwnedServer(SERVER_OPTS, async server => {
    const device = await pair(server, SCOPES);
    const app = phone(server.baseUrl, device.token);
    const core = coreSide(server.dbPath);
    const secret = path.join(workdir, 'rozpocet-tajny.md');

    try {
      const approval = await core.producer.requestApproval({
        origin: 'remote', runId: 'run-e2e-3', operationRef: `fs.write:${secret}`,
        subjectType: 'effect.write', subjectId: secret,
        title: 'Zapsat rozpočet 2026 — heslo je 4417',
        detail: 'diff: + PIN 4417',
        payload: { path: secret, content: 'PIN 4417' },
      });

      const inbox = await app.notifications();
      assert.equal(inbox.status, 200);
      const wire = JSON.stringify(inbox.body);
      for (const leak of ['4417', 'rozpocet', 'PIN', 'heslo']) {
        assert.ok(!wire.includes(leak), `S2 content "${leak}" crossed the wire in the S1 inbox`);
      }
      const note = inbox.body.data.find(entry => entry.data?.approvalId === approval.id);
      assert.ok(note, 'the mirror never reached the phone, so the phone would look calm');
      assert.equal(note.kind, 'approval');
      assert.equal(note.priority, 'high');

      // And the S2 description *is* readable where the scope check is — the
      // pointer must point somewhere.
      const queue = await app.approvals();
      const item = queue.body.data.find(entry => entry.id === approval.id);
      assert.match(item.title, /4417/);
    } finally {
      core.close();
    }
  });
});

await test('a phone that never answers leaves the run expired, never approved', async () => {
  await withOwnedServer(SERVER_OPTS, async server => {
    const core = coreSide(server.dbPath);
    const effect = path.join(workdir, 'never-answered.txt');
    try {
      // A clock the test controls: the point is the branch, not five real
      // minutes of waiting.
      let clock = Date.now();
      const timedRouter = new NotificationRouter({ db: core.db });
      timedRouter.registerChannel(new MobileChannel({ db: core.db }));
      const timed = createCompanionProducer({
        rawDb: core.db,
        router: timedRouter,
        now: () => clock,
        sleep: async ms => { clock += ms; },
      });
      const approval = await timed.requestApproval({
        origin: 'local', runId: 'run-e2e-4', operationRef: `fs.write:${effect}`,
        subjectType: 'effect.write', subjectId: effect,
        title: 'Zapsat soubor', payload: { path: effect, content: 'x' },
      });
      const answer = await timed.awaitDecision(approval.id, { pollMs: 5_000 });
      assert.equal(answer.state, 'expired');
      assert.equal(existsSync(effect), false);

      // The row is still undecided — expiry is the window closing, not a
      // decision somebody made.
      const row = core.db.prepare('SELECT decided_at, decision FROM mobile_approvals WHERE id = ?')
        .get(approval.id);
      assert.equal(row.decided_at, null);
      assert.equal(row.decision, null);
    } finally {
      core.close();
    }
  });
});

await test('the demo script drives the same path the tests do', async () => {
  // The script is what an operator runs; if it drifts from the producer API it
  // becomes a second, untested implementation of the ★ use case.
  const source = readFileSync(new URL('../scripts/mobile-demo-run.js', import.meta.url), 'utf8');
  assert.match(source, /createCompanionProducer/);
  assert.match(source, /awaitDecision/);
  assert.match(source, /createNotificationRouter/);
  // No shortcut around the gateway: the script must not write approvals or
  // notifications itself.
  assert.ok(!/INSERT INTO mobile_(approvals|notifications)/i.test(source),
    'the demo writes rows directly, so it would demonstrate itself rather than the system');
});

rmSync(workdir, { recursive: true, force: true });

console.log(`\nCompanion end-to-end: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
