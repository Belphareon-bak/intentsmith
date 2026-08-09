// Sweep isolation between gateway processes — the premise `sweepInterrupted()` relies on.
// ==============================================================================
//
// `sweepInterrupted()` relabels PENDING operations as `UNKNOWN /
// process_terminated`.  Its justification is "the process that opened this is
// gone".  This suite exists because that used to be an *assumption* — the sweep
// updated every PENDING row in the table — and the assumption is false whenever
// two gateways share a database.
//
// Nothing in the deployment made "one gateway" true:
//
//   * the sweep runs **before** `listen()`, so a port collision is discovered
//     one step too late to prevent anything (proven below, with real processes);
//   * `C3_MOBILE_PORT=0` removes port collision altogether;
//   * the gateway and the legacy server already share one database file.
//
// So the suite is in two halves.  The first pins the liveness predicate and the
// sweep's scoping in-process, where every branch can be driven exactly.  The
// second spawns **real gateway processes against one real database file**,
// because the claim under review is about processes, and two in-process objects
// cannot demonstrate it.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import {
  LEASE_TTL_MS, liveInstanceIds, localHostIdentity, pidAlive,
  reapDeadInstances, registerGatewayInstance,
} from '../src/mobile/gateway-instance.js';
import { startOwnedServer } from './helpers/server-supervisor.js';

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

console.log('\n=== Mobile sweep isolation between gateway processes ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-isolation-'));
const db = new Database(path.join(runtimeDir, 'isolation.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const ENTRY = 'src/mobile-gateway.js';
const CHILD_ENV = { C3_MOBILE_UI: 'off' };

/** A PENDING row attributed to a given owner, written without going through a listener. */
let seq = 0;
function seedPending(deviceId, owner) {
  const operationId = `seed${String(++seq).padStart(4, '0')}${'z'.repeat(12)}`;
  db.prepare(`
    INSERT INTO mobile_operations
      (device_id, operation_id, operation_type, request_fingerprint, state, owner_instance)
    VALUES (?, ?, 'chat.send', ?, 'PENDING', ?)
  `).run(deviceId, operationId, `fp-${operationId}`, owner);
  return operationId;
}

function stateOf(deviceId, operationId, handle = db) {
  return handle.prepare(
    'SELECT state, unknown_reason FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
  ).get(deviceId, operationId);
}

function sqlTimestamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Invoke `afterSnapshot` immediately after the liveness SELECT returns.
 *
 * The wrapper is test-only and leaves every other Database/Statement method
 * bound to its native receiver.  It gives this suite an exact interleaving
 * point without a timer or a production-only delay.
 */
function afterLiveSnapshot(handle, afterSnapshot) {
  let fired = false;
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'prepare') {
        return sql => {
          const statement = target.prepare(sql);
          const isLivenessRead = String(sql).includes('FROM mobile_gateway_instances')
            && String(sql).includes('heartbeat_at >= ?');
          if (!isLivenessRead) return statement;

          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty === 'all') {
                return (...args) => {
                  const rows = statementTarget.all(...args);
                  if (!fired) {
                    fired = true;
                    afterSnapshot();
                  }
                  return rows;
                };
              }
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

try {
  // ── Part 1: the liveness predicate and the sweep's scoping ────────────────

  await test('a bound journal stamps the instance that owns each operation', () => {
    const instance = registerGatewayInstance(db, { autoHeartbeat: false });
    const journal = new OperationJournal(db).bindInstance(instance.instanceId);
    const operationId = 'ownstamp' + 'a'.repeat(16);
    journal.begin({
      deviceId: 'dev-own', operationId, operationType: 'chat.send', request: { m: 'x' },
    });

    const row = db.prepare(
      'SELECT owner_instance FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
    ).get('dev-own', operationId);
    assert.equal(row.owner_instance, instance.instanceId,
      'without an owner the sweep has nothing to scope by');
    instance.release();
  });

  await test('an unbound journal writes an unowned row, and says so rather than guessing', () => {
    const journal = new OperationJournal(db);
    const operationId = 'noowner1' + 'b'.repeat(16);
    journal.begin({
      deviceId: 'dev-unowned', operationId, operationType: 'chat.send', request: { m: 'x' },
    });
    const row = db.prepare(
      'SELECT owner_instance FROM mobile_operations WHERE device_id = ? AND operation_id = ?',
    ).get('dev-unowned', operationId);
    assert.equal(row.owner_instance, null,
      'an unbound journal must not borrow some other instance\'s identity');
  });

  await test('THE GUARANTEE: a live instance\'s PENDING operation is not swept', () => {
    const alive = registerGatewayInstance(db, { autoHeartbeat: false });
    const starting = registerGatewayInstance(db, { autoHeartbeat: false });
    const protectedOp = seedPending('dev-live', alive.instanceId);

    // The starting instance sweeps exactly as it does at boot.
    const journal = new OperationJournal(db).bindInstance(starting.instanceId);
    journal.sweepInterrupted();

    const row = stateOf('dev-live', protectedOp);
    assert.equal(row.state, 'PENDING',
      'a second gateway starting must never relabel a live operation as terminated');
    assert.equal(row.unknown_reason, null);

    alive.release();
    starting.release();
  });

  await test('F-033: registration and claim cannot commit between liveness read and sweep write', async () => {
    const raceDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-snapshot-race-'));
    const racePath = path.join(raceDir, 'race.sqlite');
    const sweepDb = new Database(racePath);
    let contenderDb = null;
    let contenderInstance = null;
    try {
      sweepDb.pragma('journal_mode = WAL');
      await runMigrations(sweepDb);
      contenderDb = new Database(racePath);
      contenderDb.pragma('busy_timeout = 0');

      const starting = registerGatewayInstance(sweepDb, {
        instanceId: 'gw-race-sweeper', autoHeartbeat: false,
      });
      const orphanId = 'raceorphan' + 'o'.repeat(16);
      sweepDb.prepare(`
        INSERT INTO mobile_operations
          (device_id, operation_id, operation_type, request_fingerprint, state, owner_instance)
        VALUES ('dev-race-orphan', ?, 'chat.send', 'fp-orphan', 'PENDING', NULL)
      `).run(orphanId);

      const claimedId = 'raceclaim' + 'c'.repeat(16);
      const registerAndClaim = contenderDb.transaction(() => {
        const instance = registerGatewayInstance(contenderDb, {
          instanceId: 'gw-race-contender', autoHeartbeat: false,
        });
        const claim = new OperationJournal(contenderDb).bindInstance(instance.instanceId).begin({
          deviceId: 'dev-race-claim',
          operationId: claimedId,
          operationType: 'chat.send',
          request: { message: 'exact interleaving' },
        });
        assert.equal(claim.outcome, 'begun');
        return instance;
      });

      let hookCalls = 0;
      let inWriteTransaction = false;
      let contenderError = null;
      const instrumentedDb = afterLiveSnapshot(sweepDb, () => {
        hookCalls++;
        inWriteTransaction = sweepDb.inTransaction;
        try {
          contenderInstance = registerAndClaim();
        } catch (error) {
          contenderError = error;
        }
      });

      const swept = new OperationJournal(instrumentedDb)
        .bindInstance(starting.instanceId)
        .sweepInterrupted();

      assert.equal(hookCalls, 1, 'the contender must run at the exact SELECT-to-UPDATE seam');
      assert.equal(inWriteTransaction, true, 'the liveness read and sweep write must share a write transaction');
      assert.equal(contenderError?.code, 'SQLITE_BUSY',
        'a second connection must not commit registration/claim inside that transaction');
      assert.equal(contenderInstance, null, 'the blocked registration/claim must roll back as one unit');
      assert.equal(swept, 1, 'the existing unowned orphan must still be recovered');
      assert.deepEqual(stateOf('dev-race-orphan', orphanId, sweepDb), {
        state: 'UNKNOWN', unknown_reason: 'process_terminated',
      });

      // Once the sweep commits, the exact same registration + claim succeeds.
      // Its PENDING row therefore starts after, rather than inside, the stale
      // liveness decision and cannot be relabelled by that decision.
      contenderInstance = registerAndClaim();
      assert.deepEqual(stateOf('dev-race-claim', claimedId, contenderDb), {
        state: 'PENDING', unknown_reason: null,
      });

      contenderInstance.release();
      starting.release();
    } finally {
      contenderInstance?.stopHeartbeat();
      contenderDb?.close();
      sweepDb.close();
      rmSync(raceDir, { recursive: true, force: true });
    }
  });

  await test('a starting instance does not sweep its own PENDING rows', () => {
    const self = registerGatewayInstance(db, { autoHeartbeat: false });
    const own = seedPending('dev-self', self.instanceId);
    new OperationJournal(db).bindInstance(self.instanceId).sweepInterrupted();
    assert.equal(stateOf('dev-self', own).state, 'PENDING');
    self.release();
  });

  await test('an instance that stopped cleanly leaves its operations sweepable', () => {
    const stopped = registerGatewayInstance(db, { autoHeartbeat: false });
    const orphan = seedPending('dev-clean', stopped.instanceId);
    stopped.release('clean_shutdown');

    new OperationJournal(db).sweepInterrupted();

    const row = stateOf('dev-clean', orphan);
    assert.equal(row.state, 'UNKNOWN', 'crash recovery must still work after the scoping change');
    assert.equal(row.unknown_reason, 'process_terminated');
  });

  await test('an owner whose heartbeat went stale is presumed gone', () => {
    // A foreign host: this process cannot inspect its process table, so the
    // heartbeat is the only signal — which is exactly the branch under test.
    const foreign = registerGatewayInstance(db, {
      autoHeartbeat: false, hostIdentity: 'other-host:other-boot',
    });
    const orphan = seedPending('dev-stale', foreign.instanceId);

    db.prepare('UPDATE mobile_gateway_instances SET heartbeat_at = ? WHERE instance_id = ?')
      .run(sqlTimestamp(Date.now() - LEASE_TTL_MS - 60_000), foreign.instanceId);

    new OperationJournal(db).sweepInterrupted();
    assert.equal(stateOf('dev-stale', orphan).state, 'UNKNOWN');
  });

  await test('a fresh heartbeat from a foreign host is enough to protect its operations', () => {
    const foreign = registerGatewayInstance(db, {
      autoHeartbeat: false, hostIdentity: 'other-host:other-boot',
    });
    const remoteOp = seedPending('dev-foreign', foreign.instanceId);

    new OperationJournal(db).sweepInterrupted();
    assert.equal(stateOf('dev-foreign', remoteOp).state, 'PENDING',
      'a PID this host cannot check must not be read as a dead process');
    foreign.release();
  });

  await test('rows written before migration 048 are unowned, and unowned rows are swept', () => {
    const legacy = seedPending('dev-legacy', null);
    new OperationJournal(db).sweepInterrupted();
    const row = stateOf('dev-legacy', legacy);
    assert.equal(row.state, 'UNKNOWN', 'the pre-048 behaviour must survive for pre-048 rows');
    assert.equal(row.unknown_reason, 'process_terminated');
  });

  await test('the sweep still leaves decided outcomes alone', () => {
    const journal = new OperationJournal(db);
    const confirmed = 'decided1' + 'c'.repeat(16);
    const rejected = 'decided2' + 'd'.repeat(16);
    journal.begin({ deviceId: 'dev-decided', operationId: confirmed, operationType: 'chat.send', request: { m: 1 } });
    journal.begin({ deviceId: 'dev-decided', operationId: rejected, operationType: 'chat.send', request: { m: 2 } });
    journal.confirm('dev-decided', confirmed, { ok: true });
    journal.reject('dev-decided', rejected, 'upstream_error');

    journal.sweepInterrupted();

    assert.equal(stateOf('dev-decided', confirmed).state, 'CONFIRMED');
    assert.equal(stateOf('dev-decided', rejected).state, 'REJECTED');
  });

  await test('liveness requires both a fresh heartbeat and, on this host, a running PID', () => {
    const self = registerGatewayInstance(db, { autoHeartbeat: false });
    assert.ok(liveInstanceIds(db).has(self.instanceId), 'this very process must read as live');

    // Same host identity, a PID that is not running: dead regardless of heartbeat.
    const ghost = registerGatewayInstance(db, {
      autoHeartbeat: false, pid: 0x7ffffff, hostIdentity: localHostIdentity(),
    });
    assert.equal(pidAlive(0x7ffffff), false, 'the fixture PID must genuinely not exist');
    assert.equal(liveInstanceIds(db).has(ghost.instanceId), false);

    // And it is recorded as gone, with a cause, rather than merely filtered out.
    assert.ok(reapDeadInstances(db, { selfId: self.instanceId }) >= 1);
    const reaped = db.prepare('SELECT released_at, release_reason FROM mobile_gateway_instances WHERE instance_id = ?')
      .get(ghost.instanceId);
    assert.equal(reaped.release_reason, 'process_gone');
    assert.ok(reaped.released_at);

    // Reaping must never touch the instance doing the reaping.
    const stillSelf = db.prepare('SELECT released_at FROM mobile_gateway_instances WHERE instance_id = ?')
      .get(self.instanceId);
    assert.equal(stillSelf.released_at, null);
    self.release();
  });

  // ── Part 2: real processes, one real database file ────────────────────────
  //
  // Everything above runs in one process.  The review asked whether a *second
  // gateway process* can damage a first one, so these spawn both.

  await test('two gateway processes: a live one\'s PENDING survives the other\'s start', async () => {
    const sharedDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-shared-'));
    const sharedDb = path.join(sharedDir, 'shared.sqlite');
    let first = null;
    let second = null;
    let handle = null;
    try {
      first = await startOwnedServer({ entry: ENTRY, env: CHILD_ENV, dbPath: sharedDb });

      handle = new Database(sharedDb);
      handle.pragma('busy_timeout = 5000');

      const owner = handle.prepare(
        'SELECT instance_id, pid FROM mobile_gateway_instances WHERE released_at IS NULL',
      ).get();
      assert.ok(owner, 'the running gateway must have registered itself');
      assert.equal(owner.pid, first.pid, 'the registered PID must be the real child process');

      const inFlight = 'liveproc' + 'e'.repeat(16);
      handle.prepare(`
        INSERT INTO mobile_operations
          (device_id, operation_id, operation_type, request_fingerprint, state, owner_instance)
        VALUES ('dev-proc', ?, 'chat.send', 'fp-live', 'PENDING', ?)
      `).run(inFlight, owner.instance_id);

      // A genuinely second gateway process, same database, while the first runs.
      second = await startOwnedServer({ entry: ENTRY, env: CHILD_ENV, dbPath: sharedDb });

      const row = stateOf('dev-proc', inFlight, handle);
      assert.equal(row.state, 'PENDING',
        'starting a second gateway must not report the first gateway\'s live work as terminated');
      assert.equal(row.unknown_reason, null);
    } finally {
      if (second) await second.stop();
      if (first) await first.stop();
      if (handle) handle.close();
      rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  await test('two gateway processes: a killed one\'s PENDING is still swept on the next start', async () => {
    const sharedDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-crash-'));
    const sharedDb = path.join(sharedDir, 'shared.sqlite');
    let victim = null;
    let successor = null;
    let handle = null;
    try {
      victim = await startOwnedServer({ entry: ENTRY, env: CHILD_ENV, dbPath: sharedDb });

      handle = new Database(sharedDb);
      handle.pragma('busy_timeout = 5000');

      const owner = handle.prepare(
        'SELECT instance_id FROM mobile_gateway_instances WHERE released_at IS NULL',
      ).get();
      const abandoned = 'crashpro' + 'f'.repeat(16);
      handle.prepare(`
        INSERT INTO mobile_operations
          (device_id, operation_id, operation_type, request_fingerprint, state, owner_instance)
        VALUES ('dev-crash', ?, 'chat.send', 'fp-crash', 'PENDING', ?)
      `).run(abandoned, owner.instance_id);

      // SIGKILL cannot be trapped: no clean release, exactly like a crash.
      await victim.kill('SIGKILL');
      const stillClaimed = handle.prepare(
        'SELECT released_at FROM mobile_gateway_instances WHERE instance_id = ?',
      ).get(owner.instance_id);
      assert.equal(stillClaimed.released_at, null, 'a crash must leave the lease unreleased');

      successor = await startOwnedServer({ entry: ENTRY, env: CHILD_ENV, dbPath: sharedDb });

      const row = stateOf('dev-crash', abandoned, handle);
      assert.equal(row.state, 'UNKNOWN', 'the scoping must not have disabled crash recovery');
      assert.equal(row.unknown_reason, 'process_terminated');
    } finally {
      if (successor) await successor.stop();
      if (victim) await victim.stop();
      if (handle) handle.close();
      rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  await test('the port is not the protection: the collision is discovered after the sweep', async () => {
    // If binding the port were what kept two gateways apart, this test could not
    // exist — the loser exits, so the only question is what it did on the way.
    const sharedDir = mkdtempSync(path.join(tmpdir(), 'is-mobile-port-'));
    const sharedDb = path.join(sharedDir, 'shared.sqlite');
    let holder = null;
    let handle = null;
    try {
      holder = await startOwnedServer({ entry: ENTRY, env: CHILD_ENV, dbPath: sharedDb });

      handle = new Database(sharedDb);
      handle.pragma('busy_timeout = 5000');
      const owner = handle.prepare(
        'SELECT instance_id FROM mobile_gateway_instances WHERE released_at IS NULL',
      ).get();
      const inFlight = 'portloss' + 'g'.repeat(16);
      handle.prepare(`
        INSERT INTO mobile_operations
          (device_id, operation_id, operation_type, request_fingerprint, state, owner_instance)
        VALUES ('dev-port', ?, 'chat.send', 'fp-port', 'PENDING', ?)
      `).run(inFlight, owner.instance_id);

      // A second gateway aimed at the *same* port: it must fail to bind.
      await assert.rejects(
        () => startOwnedServer({
          entry: ENTRY, env: CHILD_ENV, dbPath: sharedDb, port: holder.port, readyTimeoutMs: 10_000,
        }),
        'the second process must lose the port',
      );

      // It lost the port — but it had already run its sweep by then.  Ownership,
      // not the bind, is what left this row intact.
      const row = stateOf('dev-port', inFlight, handle);
      assert.equal(row.state, 'PENDING',
        'the loser of the port race must still not have damaged the winner\'s journal');
    } finally {
      if (holder) await holder.stop();
      if (handle) handle.close();
      rmSync(sharedDir, { recursive: true, force: true });
    }
  });
} finally {
  db.close();
  rmSync(runtimeDir, { recursive: true, force: true });
}

console.log(`\nMobile sweep isolation: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
