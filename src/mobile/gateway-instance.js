// Which gateway process is alive, and which one is merely recorded.
// ==============================================================================
//
// This module exists to answer one question honestly: **is the process that
// opened this operation still running?**
//
// It is the missing premise of `sweepInterrupted()`.  The sweep's justification
// is "at start-up nothing is legitimately in flight, so a PENDING row belongs to
// a process that died".  That is sound for a single process and false for two —
// and nothing in the original design made "single" true:
//
//   * The sweep runs **before** `listen()`.  A second gateway pointed at the
//     same database completes its sweep and only afterwards fails to bind the
//     port.  Port exclusivity arrives one step too late to prevent anything.
//   * `C3_MOBILE_PORT=0` (every supervised test, and any operator running a
//     second gateway deliberately) removes port collision altogether.
//   * The gateway and the legacy server already share one database file by
//     design (`src/mobile-gateway.js` sets `busy_timeout` for exactly that), so
//     "one writer" was never an invariant of the deployment.
//
// So liveness is recorded rather than assumed.  Two signals, and a row must
// satisfy both to be treated as live:
//
//   PID       exact, but only meaningful on the machine and boot that issued it
//             — hence `host_identity` carries the boot id.  A recycled PID from
//             a previous boot can never be mistaken for the original process.
//   heartbeat covers the cases a PID cannot: a foreign host, and a PID that was
//             reused *within* this boot after a crash (the dead instance stopped
//             refreshing, so its row goes stale regardless of who holds the PID
//             now).
//
// Requiring **both** makes every error land on the safe side.  The one case it
// gets wrong is a process that is alive but has not run its heartbeat timer for
// LEASE_TTL_MS — a gateway with a five-minute-blocked event loop, which is not
// serving requests either way.  That is stated here rather than hidden, because
// the whole point of this file is to stop the code claiming knowledge it lacks.
//
// ==============================================================================

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';

/**
 * How long an instance may go without a heartbeat before it is presumed gone.
 *
 * Generous on purpose.  Being late costs a delayed sweep; being early costs a
 * false `process_terminated` on a live operation, which is the failure this
 * module was written to remove.
 */
export const LEASE_TTL_MS = 5 * 60 * 1000;

/** Refresh interval — an order of magnitude under the TTL, so a single missed tick is harmless. */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

let cachedHostIdentity = null;

/**
 * Machine identity that changes across reboots.
 *
 * Without the boot id, a PID recorded before a reboot may match an unrelated
 * process after one, and the sweep would skip rows whose owner is long dead.
 * Linux exposes it directly; elsewhere the heartbeat is the only signal, which
 * the liveness rule already tolerates because it requires both.
 */
export function localHostIdentity() {
  if (cachedHostIdentity) return cachedHostIdentity;
  let boot = 'no-boot-id';
  try {
    boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || boot;
  } catch {
    // Not Linux, or /proc is not mounted.  Heartbeat freshness carries the
    // decision alone; see the header note on what that costs.
  }
  cachedHostIdentity = `${os.hostname()}:${boot}`;
  return cachedHostIdentity;
}

/**
 * Is this PID a running process?
 *
 * `EPERM` means it exists and belongs to another user — alive, and reported as
 * such: guessing "dead" there would be the unsafe direction.
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    return false;
  }
}

/** SQLite's CURRENT_TIMESTAMP format (UTC, second resolution). */
function sqlTimestamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The instance ids that are running right now.
 *
 * Returned as a Set for the caller to use in a NOT IN test.  Evaluated in JS
 * rather than SQL because `pidAlive()` is a syscall, not a column.
 *
 * @returns {Set<string>}
 */
export function liveInstanceIds(db, { now = Date.now(), hostIdentity = localHostIdentity() } = {}) {
  const cutoff = sqlTimestamp(now - LEASE_TTL_MS);
  const rows = db.prepare(`
    SELECT instance_id, pid, host_identity, heartbeat_at
      FROM mobile_gateway_instances
     WHERE released_at IS NULL
       AND heartbeat_at >= ?
  `).all(cutoff);

  const live = new Set();
  for (const row of rows) {
    // Same machine and same boot → the PID is authoritative and cheap to check.
    // A different host → this process cannot see its process table, so the
    // heartbeat that already passed the WHERE clause is all there is.
    if (row.host_identity === hostIdentity && !pidAlive(row.pid)) continue;
    live.add(row.instance_id);
  }
  return live;
}

/**
 * Mark instances that this host can prove are gone.
 *
 * Not required for correctness — `liveInstanceIds()` would exclude them anyway
 * — but it turns "crashed" into a recorded fact with a cause, so the diagnostic
 * journal can explain why a sweep happened instead of leaving an operator to
 * infer it from a count.  Never touches `selfId`.
 *
 * @returns {number} instances newly recorded as gone
 */
export function reapDeadInstances(db, { selfId = null, hostIdentity = localHostIdentity() } = {}) {
  const rows = db.prepare(`
    SELECT instance_id, pid FROM mobile_gateway_instances
     WHERE released_at IS NULL AND host_identity = ?
  `).all(hostIdentity);

  const stmt = db.prepare(`
    UPDATE mobile_gateway_instances
       SET released_at = CURRENT_TIMESTAMP, release_reason = 'process_gone'
     WHERE instance_id = ? AND released_at IS NULL
  `);

  let reaped = 0;
  for (const row of rows) {
    if (row.instance_id === selfId) continue;
    if (pidAlive(row.pid)) continue;
    reaped += stmt.run(row.instance_id).changes;
  }
  return reaped;
}

/**
 * Register this process and keep its lease fresh.
 *
 * Registration happens *before* the sweep and before the listener binds, so
 * from the first moment this instance could write a row it is already visible
 * as live to any other instance's sweep.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{instanceId: string, heartbeat: Function, release: Function, stopHeartbeat: Function}}
 */
export function registerGatewayInstance(db, {
  instanceId = `gw-${randomUUID()}`,
  pid = process.pid,
  hostIdentity = localHostIdentity(),
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  autoHeartbeat = true,
} = {}) {
  db.prepare(`
    INSERT INTO mobile_gateway_instances (instance_id, pid, host_identity)
    VALUES (?, ?, ?)
  `).run(instanceId, pid, hostIdentity);

  const heartbeatStmt = db.prepare(`
    UPDATE mobile_gateway_instances
       SET heartbeat_at = CURRENT_TIMESTAMP
     WHERE instance_id = ? AND released_at IS NULL
  `);

  let timer = null;
  const heartbeat = () => {
    try {
      heartbeatStmt.run(instanceId);
    } catch {
      // A failed heartbeat must not take the gateway down.  It degrades this
      // instance towards "presumed gone" after the TTL, which is the correct
      // direction for a process that can no longer write to its own database.
    }
  };

  if (autoHeartbeat) {
    timer = setInterval(heartbeat, heartbeatIntervalMs);
    // Never hold the process open for a liveness record.
    timer.unref?.();
  }

  const stopHeartbeat = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    instanceId,
    heartbeat,
    stopHeartbeat,
    /**
     * Clean shutdown.  Distinct from a crash in the record itself: `released_at`
     * with `clean_shutdown` says the process chose to stop, so a later sweep
     * can attribute the operations it releases correctly.
     */
    release(reason = 'clean_shutdown') {
      stopHeartbeat();
      try {
        db.prepare(`
          UPDATE mobile_gateway_instances
             SET released_at = CURRENT_TIMESTAMP, release_reason = ?
           WHERE instance_id = ? AND released_at IS NULL
        `).run(reason, instanceId);
      } catch {
        // Shutting down against a closed or unwritable database.  The heartbeat
        // has already stopped, so the row expires by TTL instead.
      }
    },
  };
}

export default {
  LEASE_TTL_MS,
  HEARTBEAT_INTERVAL_MS,
  localHostIdentity,
  pidAlive,
  liveInstanceIds,
  reapDeadInstances,
  registerGatewayInstance,
};
