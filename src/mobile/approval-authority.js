// Approval authority — the only path that may create an approval (F-100)
// ==============================================================================
//
// `F-100` is that an approval could exist without authority behind it: any
// writer could insert a row with any expiry and any fingerprint, and the server
// would then let a user grant it.  `R-3`/`DR-011` name the target contract —
// **local 5 minutes, remote 15 minutes, single use, no extension** — and
// `UI-DESIGN.md` §6.6 says the missing TTL authority, the missing mandatory
// fingerprint and the missing binding to run, operation and normalised content
// are all part of that one finding.
//
// This module is where those become properties of the code rather than
// conventions:
//
//   * **The window is not an argument.**  A caller states where the approval
//     came from, and the TTL follows from `DR-011`.  There is no parameter that
//     shortens or lengthens it and no function that extends one afterwards —
//     `expires_at` is written once, by this module, and never updated.  The
//     10-minute value the operator's design showed matches neither side of
//     `DR-011`, which is exactly what happens when the number lives anywhere a
//     person can type it.
//
//   * **The fingerprint is computed, never accepted.**  A producer hands over
//     the payload; the digest is taken here, over the canonical form.  A
//     supplied fingerprint is precisely how an approval ends up not bound to
//     its own content — the client would then be shown one thing and be
//     deciding about another, and every check downstream would still pass.
//
//   * **The binding is required.**  An approval names the run it belongs to and
//     the operation it authorises.  Without both, the server cannot say what a
//     grant would permit, and `decideApproval` refuses it.
//
// ── What this module is not ────────────────────────────────────────────────
//
// It is **not** a production producer, and nothing in the running system calls
// it yet.  Wiring an emitter would put approvals on the production surface
// before M6, which is release authority and not this work package's to take —
// the same reason `MobileChannel` stays out of the notification router.  So the
// remaining part of `F-100` is the producer, and it stays open and named.
//
// ==============================================================================

import { randomUUID } from 'node:crypto';
import { fingerprint } from './protocol.js';

/**
 * `DR-011`, as the only place these numbers exist.  Frozen so a caller cannot
 * quietly widen a window by mutating the table it reads from.
 */
export const APPROVAL_TTL_MS = Object.freeze({
  local: 5 * 60_000,
  remote: 15 * 60_000,
});

export const APPROVAL_ORIGINS = Object.freeze(Object.keys(APPROVAL_TTL_MS));

export class ApprovalAuthorityError extends Error {
  constructor(reason, detail = {}) {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

/** SQLite's `DATETIME` text form, so stored times compare as the schema expects. */
function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The digest an approval is bound to.  Canonicalisation happens inside
 * `fingerprint()`, so two payloads that differ only in key order produce the
 * same binding and a payload that differs in substance never does.
 */
export function approvalFingerprint(payload) {
  return fingerprint(payload);
}

/**
 * Mint one approval.  The single writing path for `mobile_approvals`.
 *
 * @param {Object} rawDb
 * @param {Object} request
 * @param {'local'|'remote'} request.origin — decides the window (`DR-011`).
 *   There is no default: defaulting would silently pick a window nobody chose,
 *   and the wrong choice is the longer one.
 * @param {string} request.runId          the run this belongs to
 * @param {string} request.operationRef   the operation or effect it authorises
 * @param {string} request.subjectType
 * @param {string} request.subjectId
 * @param {string} request.title
 * @param {*}      request.payload        digested here; never supplied pre-hashed
 * @param {string} [request.detail]
 * @param {string} [request.id]
 * @param {number} [request.now]          injected clock, so a caller can mint at
 *   a stated instant; production passes nothing and gets `Date.now()`
 */
export function createMobileApproval(rawDb, {
  origin, runId, operationRef, subjectType, subjectId, title,
  payload, detail = null, id = randomUUID(), now = Date.now(),
} = {}) {
  if (!APPROVAL_ORIGINS.includes(origin)) {
    throw new ApprovalAuthorityError('origin_required', { allowed: APPROVAL_ORIGINS });
  }
  for (const [field, value] of Object.entries({ runId, operationRef, subjectType, subjectId, title })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ApprovalAuthorityError('binding_required', { field });
    }
  }
  if (payload === undefined) {
    throw new ApprovalAuthorityError('payload_required', {});
  }

  const expiresAt = now + APPROVAL_TTL_MS[origin];
  rawDb.prepare(`
    INSERT INTO mobile_approvals
      (id, subject_type, subject_id, title, detail, payload_fingerprint,
       created_at, expires_at, origin, run_id, operation_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, subjectType, subjectId, title, detail,
    approvalFingerprint(payload),
    sqlTime(now), sqlTime(expiresAt),
    origin, runId, operationRef,
  );

  return { id, origin, runId, operationRef, expiresAt, ttlMs: APPROVAL_TTL_MS[origin] };
}

/**
 * Is this row bound to something the server can name?  Used by the decide path,
 * which is where the answer has to be yes before anything is granted.
 */
export function approvalIsBound(row) {
  return Boolean(row
    && typeof row.origin === 'string' && APPROVAL_ORIGINS.includes(row.origin)
    && typeof row.run_id === 'string' && row.run_id.trim() !== ''
    && typeof row.operation_ref === 'string' && row.operation_ref.trim() !== '');
}

export default { createMobileApproval, approvalIsBound, approvalFingerprint, APPROVAL_TTL_MS, APPROVAL_ORIGINS };
