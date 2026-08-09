// Server-side operation journal — MD-19 and DATA-MODEL.md §8.5, §8.8–§8.11.
// ==============================================================================
//
// The client issues `operationId`; this module is the authority over the
// *outcome*.  It exists so that a retry after an ambiguous timeout cannot
// perform the operation twice, which is the one failure the client can never
// detect on its own.
//
// The rules it enforces, and why each is written the way it is:
//
//   §8.8  same key + same fingerprint → the original result, no new effect.
//         Implemented by an atomic INSERT that fails on the primary key rather
//         than a SELECT-then-INSERT, because the race being defended against is
//         exactly two concurrent retries of the same operation.
//
//   §8.8  same key + different fingerprint → fail-closed conflict.  A different
//         payload is a different operation; reusing the key is a client bug and
//         guessing the intent would be worse than refusing.
//
//   §8.9  the record survives a restart.  It is a table, not an in-process Map:
//         the moment the key matters most is right after a crash.
//
//   §8.10 state is readable by key alone, and "unknown key" is distinct from
//         "known, and here is how it went".  Collapsing those two makes the
//         client unable to tell a lost request from a completed one.
//
//   §8.11 open operations are capped and rate limited *by the server*.  A
//         client-side limit protects nothing — the record exists precisely for
//         the case where the client is unreliable.
//
// What this module deliberately does not do: delete an unresolved record to
// make room.  MD-19 §4.3 forbids it, because evicting the oldest PENDING is
// both a silent loss of the information the journal exists to hold and a way
// for an attacker to flush their own traces.
//
// ==============================================================================

import { randomUUID } from 'node:crypto';
import { liveInstanceIds } from './gateway-instance.js';
import { fingerprint, normalizeUnknownReason, UNKNOWN_REASONS } from './protocol.js';

export const OPERATION_STATES = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
});

const OPEN_STATES = Object.freeze(['PENDING', 'UNKNOWN']);

export const DEFAULT_LIMITS = Object.freeze({
  // Cap on simultaneously unresolved operations per device (§8.11).  Finite
  // and enforced — reaching it blocks further mutations until the user
  // resolves them, which is intentionally inconvenient.
  maxOpenOperations: 32,
  // Rate limit on *creating* new operations, so one fast loop cannot fill the
  // cap before a human can react.
  rateWindowMs: 60_000,
  maxNewOperationsPerWindow: 60,
  // Resolved records are retained long enough to cover the supported retry
  // interval (§8.9) — a retry arriving after a restart must still find them.
  resolvedRetentionMs: 24 * 60 * 60 * 1000,
});

const OPERATION_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

export class OperationJournal {
  /**
   * @param {import('better-sqlite3').Database} rawDb
   * @param {Object} [limits]
   * @param {string|null} [limits.instanceId]  gateway instance that owns rows this
   *   journal opens.  `null` means unowned — see `bindInstance()`.
   */
  constructor(rawDb, limits = {}) {
    const { instanceId = null, ...rest } = limits;
    this.db = rawDb;
    this.limits = { ...DEFAULT_LIMITS, ...rest };
    this.instanceId = instanceId;
  }

  /**
   * Attach this journal to a registered gateway instance.
   *
   * Exists because the journal is constructed before the gateway in
   * `src/mobile-gateway.js` and injected into it, so ownership has to be
   * applied at wiring time rather than at construction.  Rows opened by a
   * journal that was never bound carry `owner_instance = NULL`, and unowned
   * rows are sweepable by definition — which is right for rows written before
   * migration 048, and is why the gateway always binds.
   */
  bindInstance(instanceId) {
    this.instanceId = instanceId || null;
    return this;
  }

  // ── §8.10 read state by key, without a payload ──────────────────────────
  /**
   * Always safe to call: it is a read and carries no payload, which is what
   * makes it the correct way to resolve an `UNKNOWN` after a reconnect.
   *
   * @returns {{known: false} | {known: true, state, operationType, result, errorCode, createdAt, resolvedAt}}
   */
  lookup(deviceId, operationId) {
    const row = this.db.prepare(`
      SELECT operation_type, request_fingerprint, state, result_json, error_code,
             unknown_reason, unknown_at, last_checked_at, created_at, resolved_at
        FROM mobile_operations
       WHERE device_id = ? AND operation_id = ?
    `).get(deviceId, operationId);

    if (!row) return { known: false };

    // A read that writes, on purpose: "when was this last verified" is a fact
    // the recovery screen shows and the escalation ladder (UI-DESIGN §16)
    // depends on, and this is the only place that knows it.  Only open records
    // are stamped — a resolved one is not being verified any more.
    if (row.state === 'PENDING' || row.state === 'UNKNOWN') {
      this.db.prepare(`
        UPDATE mobile_operations SET last_checked_at = CURRENT_TIMESTAMP
         WHERE device_id = ? AND operation_id = ?
      `).run(deviceId, operationId);
    }

    return {
      known: true,
      state: row.state,
      operationType: row.operation_type,
      // The fingerprint is returned so a client can confirm the server is
      // talking about the same attempt.  It is one-way; it does not let the
      // client reconstruct the request (MD-19 §4.1 rule 2).
      requestFingerprint: row.request_fingerprint,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      errorCode: row.error_code || null,
      // Why it is UNKNOWN, when it became UNKNOWN, and when it was last
      // verified.  Without all three the recovery screen can only say "we do
      // not know", which is not something a user can act on (B-17).
      unknownReason: row.unknown_reason || null,
      unknownAt: row.unknown_at || null,
      lastCheckedAt: row.last_checked_at || null,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || null,
    };
  }

  /** §8.11 diagnostics — the user and the operator must be able to see what hangs. */
  openOperations(deviceId) {
    return this.db.prepare(`
      SELECT operation_id, operation_type, state, created_at,
             unknown_reason, unknown_at, last_checked_at
        FROM mobile_operations
       WHERE device_id = ? AND state IN ('PENDING','UNKNOWN')
       ORDER BY created_at ASC
    `).all(deviceId).map(row => ({
      operationId: row.operation_id,
      operationType: row.operation_type,
      state: row.state,
      createdAt: row.created_at,
      unknownReason: row.unknown_reason || null,
      unknownAt: row.unknown_at || null,
      lastCheckedAt: row.last_checked_at || null,
    }));
  }

  countOpen(deviceId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM mobile_operations
       WHERE device_id = ? AND state IN ('PENDING','UNKNOWN')
    `).get(deviceId);
    return row?.n || 0;
  }

  /**
   * Begin (or re-join) an operation.
   *
   * @returns {{outcome: 'replay',    record: Object}
   *          |{outcome: 'conflict',  reason: string, record?: Object}
   *          |{outcome: 'limited',   reason: string, open?: number, limit?: number, retryAfterMs?: number}
   *          |{outcome: 'begun',     operationId: string, requestFingerprint: string}}
   */
  begin({ deviceId, operationId, operationType, request, now = Date.now() }) {
    if (!deviceId) throw new Error('operation journal requires a deviceId');
    if (!OPERATION_ID_RE.test(String(operationId || ''))) {
      return { outcome: 'conflict', reason: 'operation_id_malformed' };
    }

    const requestFingerprint = fingerprint({ type: operationType, request });

    // Existing key → replay or conflict.  Checked before the limits so that a
    // retry of an already-recorded operation is never rejected for capacity:
    // the record already exists, so admitting it costs nothing and refusing it
    // would strand the client with an unresolvable UNKNOWN.
    const existing = this.db.prepare(`
      SELECT operation_type, request_fingerprint, state, result_json, error_code,
             created_at, resolved_at
        FROM mobile_operations
       WHERE device_id = ? AND operation_id = ?
    `).get(deviceId, operationId);

    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        // §8.8 fail-closed.  Same key, different payload is two operations
        // wearing one name; there is no safe interpretation.
        return {
          outcome: 'conflict',
          reason: 'fingerprint_mismatch',
          record: {
            state: existing.state,
            operationType: existing.operation_type,
            createdAt: existing.created_at,
          },
        };
      }
      return {
        outcome: 'replay',
        record: {
          state: existing.state,
          operationType: existing.operation_type,
          requestFingerprint: existing.request_fingerprint,
          result: existing.result_json ? JSON.parse(existing.result_json) : null,
          errorCode: existing.error_code || null,
          createdAt: existing.created_at,
          resolvedAt: existing.resolved_at || null,
        },
      };
    }

    // ── §8.11 limits, enforced before any effect ──────────────────────────
    const open = this.countOpen(deviceId);
    if (open >= this.limits.maxOpenOperations) {
      return {
        outcome: 'limited',
        reason: 'open_operation_cap',
        open,
        limit: this.limits.maxOpenOperations,
      };
    }

    const windowStart = new Date(now - this.limits.rateWindowMs).toISOString().replace('T', ' ').slice(0, 19);
    const recent = this.db.prepare(`
      SELECT COUNT(*) AS n FROM mobile_operations
       WHERE device_id = ? AND created_at >= ?
    `).get(deviceId, windowStart);
    if ((recent?.n || 0) >= this.limits.maxNewOperationsPerWindow) {
      return {
        outcome: 'limited',
        reason: 'operation_rate_limit',
        retryAfterMs: this.limits.rateWindowMs,
      };
    }

    // Atomic claim.  If a concurrent retry won the race, INSERT fails on the
    // primary key and we resolve it as a replay/conflict rather than creating
    // a second record.
    try {
      this.db.prepare(`
        INSERT INTO mobile_operations
          (device_id, operation_id, operation_type, request_fingerprint, state, owner_instance)
        VALUES (?, ?, ?, ?, 'PENDING', ?)
      `).run(deviceId, operationId, operationType, requestFingerprint, this.instanceId);
    } catch (error) {
      if (String(error?.code || '').includes('CONSTRAINT')) {
        return this.begin({ deviceId, operationId, operationType, request, now });
      }
      throw error;
    }

    return { outcome: 'begun', operationId, requestFingerprint };
  }

  /** Record a successful outcome.  Idempotent: resolving twice keeps the first result. */
  confirm(deviceId, operationId, result) {
    return this._resolve(deviceId, operationId, OPERATION_STATES.CONFIRMED, result, null);
  }

  /** Record a definitive failure — a *decided* negative, not a lost request. */
  reject(deviceId, operationId, errorCode, result = null) {
    return this._resolve(deviceId, operationId, OPERATION_STATES.REJECTED, result, errorCode);
  }

  _resolve(deviceId, operationId, state, result, errorCode) {
    // `state = 'PENDING'` in the WHERE clause is what makes this idempotent:
    // a second resolution finds nothing to update and the original outcome
    // stands, so a duplicated completion cannot rewrite history.
    const info = this.db.prepare(`
      UPDATE mobile_operations
         SET state = ?, result_json = ?, error_code = ?, resolved_at = CURRENT_TIMESTAMP
       WHERE device_id = ? AND operation_id = ? AND state = 'PENDING'
    `).run(state, result === null || result === undefined ? null : JSON.stringify(result),
           errorCode, deviceId, operationId);

    if (info.changes === 0) {
      const current = this.lookup(deviceId, operationId);
      return { resolved: false, reason: current.known ? 'already_resolved' : 'unknown_operation', current };
    }
    return { resolved: true, state };
  }

  /**
   * Mark a PENDING operation whose fate the server itself could not determine
   * (e.g. the process died mid-effect).  Distinct from REJECTED, which asserts
   * the operation did not happen.
   *
   * `reason` is stored because "unknown" with no cause gives the recovery
   * screen nothing to show and the user nothing to decide on.  It is coerced
   * to the closed vocabulary in `protocol.js`: a caller that passes an
   * unrecognised string gets `unspecified`, never free text on the wire.
   */
  markUnknown(deviceId, operationId, reason = null) {
    this.db.prepare(`
      UPDATE mobile_operations
         SET state = 'UNKNOWN', unknown_reason = ?, unknown_at = CURRENT_TIMESTAMP
       WHERE device_id = ? AND operation_id = ? AND state = 'PENDING'
    `).run(normalizeUnknownReason(reason), deviceId, operationId);
  }

  /**
   * Sweep operations left PENDING by a gateway process that is gone — call once
   * at start, before the listener accepts anything.
   *
   * A PENDING row whose owner died is an attempt whose outcome was never written
   * down.  Leaving it PENDING would be the wrong claim twice over: it says
   * "still running" about a run that ended, and it occupies the per-device cap
   * forever with no cause the user could act on.  `process_terminated` is the
   * honest state — the effect may well have happened.
   *
   * **Scoped by owner, not by clock.**  The earlier version swept every PENDING
   * row in the table on the theory that a starting process implies an empty
   * table.  Two gateways against one database break that theory, and the sweep
   * runs before `listen()`, so a port collision cannot stop the damage — it is
   * discovered afterwards.  A row is therefore swept only when nothing is alive
   * to own it:
   *
   *   * owned by a live instance  → left alone.  This is the guarantee: another
   *     gateway starting cannot relabel operations that are still in flight.
   *   * owned by this instance    → left alone.  At start-up there are none; the
   *     clause matters if the sweep is ever called again.
   *   * owned by a dead instance  → swept.  Crash recovery, unchanged.
   *   * `owner_instance IS NULL`  → swept.  Written before migration 048, or by
   *     a journal never bound to an instance; no live owner can be shown for it.
   *
   * Liveness comes from `gateway-instance.js`, which requires both a fresh
   * heartbeat and (on this machine and boot) a running PID.
   *
   * @returns {number} rows moved to UNKNOWN
   */
  sweepInterrupted() {
    // BEGIN IMMEDIATE takes SQLite's writer reservation before the liveness
    // read.  A registration/claim committed first is visible in this snapshot;
    // one started later cannot commit until the sweep decision is complete.
    const sweep = this.db.transaction(() => {
      const live = liveInstanceIds(this.db);
      if (this.instanceId) live.add(this.instanceId);

      // Built as literal placeholders rather than a correlated subquery because
      // liveness is decided in JS (a PID check is a syscall, not a column).
      const owners = [...live];
      const placeholders = owners.map(() => '?').join(', ');
      const notLive = owners.length > 0
        ? `AND (owner_instance IS NULL OR owner_instance NOT IN (${placeholders}))`
        : '';

      const info = this.db.prepare(`
        UPDATE mobile_operations
           SET state = 'UNKNOWN', unknown_reason = ?, unknown_at = CURRENT_TIMESTAMP
         WHERE state = 'PENDING'
         ${notLive}
      `).run(UNKNOWN_REASONS.PROCESS_TERMINATED, ...owners);
      return info.changes;
    });
    return sweep.immediate();
  }

  /**
   * Purge resolved records past the retention window.
   *
   * Only CONFIRMED and REJECTED are eligible.  PENDING and UNKNOWN are never
   * time-expired (MD-19 §4.3) — they are released by resolution, not by age.
   */
  purgeResolved(now = Date.now()) {
    const cutoff = new Date(now - this.limits.resolvedRetentionMs)
      .toISOString().replace('T', ' ').slice(0, 19);
    const info = this.db.prepare(`
      DELETE FROM mobile_operations
       WHERE state IN ('CONFIRMED','REJECTED')
         AND resolved_at IS NOT NULL
         AND resolved_at < ?
    `).run(cutoff);
    return info.changes;
  }

  /**
   * Explicit user-initiated discard of a hung attempt.  This is the *only*
   * way an unresolved record leaves the journal, and it is a deliberate act
   * with the consequence stated: the server-side effect stays unresolved.
   */
  discardOpen(deviceId, operationId) {
    const info = this.db.prepare(`
      DELETE FROM mobile_operations
       WHERE device_id = ? AND operation_id = ? AND state IN ('PENDING','UNKNOWN')
    `).run(deviceId, operationId);
    return info.changes > 0;
  }
}

export function newOperationId() {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
}

export default { OperationJournal, OPERATION_STATES, OPEN_STATES, DEFAULT_LIMITS, newOperationId };
