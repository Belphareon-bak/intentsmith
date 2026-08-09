// Mobile protocol primitives — DATA-MODEL.md §8.
// ==============================================================================
//
// Pure functions only.  No database, no network, no clock reads except where a
// caller passes one in.  Everything here is decided deterministically so it can
// be tested without any listener.
//
// Covers:
//   §8.1  version/fingerprint on every record
//   §8.2  opaque monotonic cursor with safe rejection
//   §8.3  distinguishable error states
//   §8.6  server-driven pagination with an explicit end
//   §8.7  responses state the scope that was actually in force
//
// ==============================================================================

import { createHash } from 'node:crypto';

export const PROTOCOL_VERSION = 'm1.2026-07-30';

// ── §8.3 Distinguishable error states ────────────────────────────────────────
//
// A single "401" for every failure makes the screen states in SCREENS.md
// unsatisfiable: the client cannot tell the user whether to retry, re-pair, or
// give up.  Each code below maps to exactly one user-visible outcome, and the
// mapping is one-way — nothing collapses two causes into one code.

export const MOBILE_ERRORS = Object.freeze({
  // Transport / availability
  SERVER_UNAVAILABLE:   { status: 503, code: 'server_unavailable',   retryable: true  },
  // Identity
  TOKEN_MISSING:        { status: 401, code: 'token_missing',        retryable: false },
  TOKEN_INVALID:        { status: 401, code: 'token_invalid',        retryable: false },
  TOKEN_EXPIRED:        { status: 401, code: 'token_expired',        retryable: false },
  TOKEN_REVOKED:        { status: 401, code: 'token_revoked',        retryable: false },
  // Authorization
  SCOPE_REQUIRED:       { status: 403, code: 'scope_required',       retryable: false },
  // State
  STATE_CONFLICT:       { status: 409, code: 'state_conflict',       retryable: false },
  OPERATION_CONFLICT:   { status: 409, code: 'operation_conflict',   retryable: false },
  APPROVAL_EXPIRED:     { status: 409, code: 'approval_expired',     retryable: false },
  APPROVAL_SUPERSEDED:  { status: 409, code: 'approval_superseded',  retryable: false },
  PAIRING_ALREADY_USED: { status: 409, code: 'pairing_already_used', retryable: false },
  PAIRING_EXPIRED:      { status: 409, code: 'pairing_expired',      retryable: false },
  PAIRING_DISABLED:     { status: 403, code: 'pairing_disabled',     retryable: false },
  // Protocol
  PROTOCOL_MISMATCH:    { status: 426, code: 'protocol_mismatch',    retryable: false },
  CURSOR_UNKNOWN:       { status: 400, code: 'cursor_unknown',       retryable: false },
  BAD_REQUEST:          { status: 400, code: 'bad_request',          retryable: false },
  ROUTE_NOT_ALLOWED:    { status: 404, code: 'route_not_allowed',    retryable: false },
  NOT_FOUND:            { status: 404, code: 'not_found',            retryable: false },
  // Limits (§8.11)
  OPERATION_LIMIT:      { status: 429, code: 'operation_limit',      retryable: false },
  RATE_LIMITED:         { status: 429, code: 'rate_limited',         retryable: true  },
});

/**
 * Build a wire error.  `details` is merged verbatim so callers can attach the
 * discriminating field (requiredScope, knownState, retryAfterMs, …) that makes
 * the code actionable rather than merely distinct.
 */
export function mobileError(descriptor, details = {}) {
  if (!descriptor?.code) throw new Error('mobileError requires a MOBILE_ERRORS descriptor');
  return {
    ok: false,
    error: {
      code: descriptor.code,
      retryable: descriptor.retryable,
      protocolVersion: PROTOCOL_VERSION,
      ...details,
    },
    status: descriptor.status,
  };
}

// ── Why an operation is UNKNOWN (§8.10, B-17) ────────────────────────────────
//
// "We do not know" with no cause gives the recovery screen nothing to show and
// the user nothing to decide on.  The cause is therefore a **code from a closed
// list**, never free text: free text cannot be asserted on in a test, cannot be
// translated, and would carry whatever the upstream error string happened to
// contain straight to the screen.
//
// The list is deliberately short.  Every entry has a producer in this codebase
// — a vocabulary with entries nothing can emit would be a promise the server
// does not keep.  `client_disconnected` is *absent* for that reason: the
// gateway cannot currently tell a client that hung up from one that is still
// waiting, so claiming it could would be a lie in a table.

export const UNKNOWN_REASONS = Object.freeze({
  /** The request went out and no answer came back in time. */
  UPSTREAM_TIMEOUT: 'upstream_timeout',
  /** No connection was ever established — the effect most likely never began. */
  UPSTREAM_UNREACHABLE: 'upstream_unreachable',
  /** The connection died after the request was dispatched: the worst case. */
  CONNECTION_LOST_AFTER_DISPATCH: 'connection_lost_after_dispatch',
  /** The upstream answered with a failure status; it may have acted first. */
  UPSTREAM_ERROR_STATUS: 'upstream_error_status',
  /** The gateway process died while the operation was still open. */
  PROCESS_TERMINATED: 'process_terminated',
  /** The effect happened but writing its outcome down did not. */
  RESULT_PERSISTENCE_FAILED: 'result_persistence_failed',
  /** The gateway threw where it should not have. */
  GATEWAY_EXCEPTION: 'gateway_exception',
  /** An honest gap: a cause this list does not yet name. */
  UNSPECIFIED: 'unspecified',
});

const UNKNOWN_REASON_CODES = new Set(Object.values(UNKNOWN_REASONS));

// Internal transport codes (upstream.js `classify()`) → the closed vocabulary.
// The distinction that matters to the user is whether the request was dispatched
// before the failure, because that is what decides whether an effect may exist.
const UPSTREAM_REASON_MAP = Object.freeze({
  upstream_timeout:         UNKNOWN_REASONS.UPSTREAM_TIMEOUT,
  upstream_refused:         UNKNOWN_REASONS.UPSTREAM_UNREACHABLE,
  upstream_dns:             UNKNOWN_REASONS.UPSTREAM_UNREACHABLE,
  upstream_disabled:        UNKNOWN_REASONS.UPSTREAM_UNREACHABLE,
  upstream_unreachable:     UNKNOWN_REASONS.UPSTREAM_UNREACHABLE,
  upstream_reset:           UNKNOWN_REASONS.CONNECTION_LOST_AFTER_DISPATCH,
  upstream_unreadable_body: UNKNOWN_REASONS.CONNECTION_LOST_AFTER_DISPATCH,
  gateway_exception:        UNKNOWN_REASONS.GATEWAY_EXCEPTION,
});

/**
 * Coerce any cause to a code from the closed list.
 *
 * Never throws.  This runs at the one moment that must not fail — the server
 * has just lost track of an operation — so an unrecognised cause degrades to
 * `unspecified` rather than taking the record down with it.
 */
export function normalizeUnknownReason(raw) {
  if (typeof raw !== 'string' || raw === '') return UNKNOWN_REASONS.UNSPECIFIED;
  if (UNKNOWN_REASON_CODES.has(raw)) return raw;
  if (UPSTREAM_REASON_MAP[raw]) return UPSTREAM_REASON_MAP[raw];
  // `upstream_status_502` and friends carry the status in the code itself; the
  // status belongs in the log, not in a vocabulary the client has to switch on.
  if (raw.startsWith('upstream_status_')) return UNKNOWN_REASONS.UPSTREAM_ERROR_STATUS;
  return UNKNOWN_REASONS.UNSPECIFIED;
}

// ── Canonical form and fingerprints (§8.1, MD-19 rule 5) ─────────────────────
//
// MD-19 rule 5: the fingerprint is computed from a *canonical* request, so
// reordering keys cannot be used to slip a different payload past the
// same-key/same-fingerprint check.  Object keys are sorted recursively; arrays
// keep their order because order is meaning in a list.

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      if (value[key] !== undefined) acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * One-way fingerprint of a canonical request.  MD-19 §4.1 rule 2 requires this
 * to be non-invertible: it exists to compare attempts, never to rebuild one.
 */
export function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * §8.1 — record version.  Without it the client cannot decide whether its
 * cached copy is stale, so the FRESH/STALE/EXPIRED lifecycle in §3 has nothing
 * to key on.  Derived from content, so it is stable across restarts and equal
 * for equal records.
 */
export function recordVersion(record) {
  return `v1:${fingerprint(record).slice(0, 32)}`;
}

/** Attach `version` to a record without mutating the input. */
export function versioned(record) {
  return { ...record, version: recordVersion(record) };
}

// ── §8.2 Opaque monotonic cursor ─────────────────────────────────────────────
//
// The client must never compute or increment a cursor: doing so silently
// invents positions the server never issued.  The cursor is therefore opaque
// (base64url of a signed-shape payload) and every field the server needs is
// inside it.  An unrecognised cursor is rejected with a specific code so the
// client can restart from the beginning rather than guess.

const CURSOR_PREFIX = 'c1';

export function encodeCursor({ stream, position, issuedAt = Date.now() }) {
  if (typeof stream !== 'string' || !stream) throw new Error('cursor requires a stream');
  if (!Number.isInteger(position) || position < 0) throw new Error('cursor position must be a non-negative integer');
  const body = canonicalJson({ stream, position, issuedAt });
  const checksum = createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `${CURSOR_PREFIX}.${Buffer.from(body, 'utf8').toString('base64url')}.${checksum}`;
}

/**
 * @returns {{valid: true, stream: string, position: number, issuedAt: number}
 *          |{valid: false, reason: string}}
 */
export function decodeCursor(cursor, { stream } = {}) {
  if (cursor === null || cursor === undefined || cursor === '') {
    return { valid: true, stream: stream ?? null, position: 0, issuedAt: null, initial: true };
  }
  if (typeof cursor !== 'string') return { valid: false, reason: 'cursor_not_a_string' };

  const parts = cursor.split('.');
  if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX) {
    return { valid: false, reason: 'cursor_malformed' };
  }

  let body;
  try {
    body = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return { valid: false, reason: 'cursor_malformed' };
  }

  const expected = createHash('sha256').update(body).digest('hex').slice(0, 16);
  // Not a security boundary — the cursor carries no authority.  This only
  // detects a cursor this server did not issue, which §8.2 requires us to
  // reject explicitly instead of interpreting.
  if (expected !== parts[2]) return { valid: false, reason: 'cursor_unrecognized' };

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { valid: false, reason: 'cursor_malformed' };
  }

  if (typeof parsed.stream !== 'string' || !Number.isInteger(parsed.position) || parsed.position < 0) {
    return { valid: false, reason: 'cursor_malformed' };
  }
  // A cursor from a different stream is meaningless here; interpreting its
  // position against this stream would silently skip or repeat records.
  if (stream && parsed.stream !== stream) {
    return { valid: false, reason: 'cursor_stream_mismatch' };
  }

  return { valid: true, stream: parsed.stream, position: parsed.position, issuedAt: parsed.issuedAt };
}

// ── §8.6 Server-driven pagination with an explicit end ───────────────────────
//
// `hasMore` is derived by over-fetching one row, never by comparing
// `items.length` to the requested limit — that comparison reports a full final
// page as "there is more" and an exhausted stream as unfinished.

export function paginate({ rows, limit, stream, position = 0 }) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    hasMore,
    // Only issue a next cursor when there is genuinely a next page, so the
    // client cannot page forever against an empty tail.
    nextCursor: hasMore ? encodeCursor({ stream, position: position + items.length }) : null,
    end: !hasMore,
  };
}

// ── §8.7 Responses state the scope actually in force ─────────────────────────

export function withEnvelope(payload, { principal = null, extra = {} } = {}) {
  return {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    // MD-12 must not drift from reality: report the scopes the request was
    // actually authorized under, not the scopes the client believes it has.
    scopes: principal?.scopes ?? [],
    principalId: principal?.id ?? null,
    serverTime: new Date().toISOString(),
    ...extra,
    data: payload,
  };
}

export default {
  PROTOCOL_VERSION,
  MOBILE_ERRORS,
  mobileError,
  canonicalize,
  canonicalJson,
  fingerprint,
  recordVersion,
  versioned,
  encodeCursor,
  decodeCursor,
  paginate,
  withEnvelope,
};
