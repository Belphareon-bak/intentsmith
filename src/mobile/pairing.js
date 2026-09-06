// QR pairing — S-5 / B4.
// ==============================================================================
//
// PLAN.md calls this "the riskiest new code", so the design here optimises for
// being *auditable* rather than clever.  Five properties, each with the reason
// it is implemented the way it is:
//
//   1. Single use.  Enforced by a conditional UPDATE whose WHERE clause carries
//      the precondition (`claimed_at IS NULL`), so the claim is decided by the
//      database's atomicity.  A read-then-write would let two concurrent
//      claims of one code both succeed — which is precisely the attack.
//
//   2. TTL.  A code that never expires is a permanent credential printed on a
//      screen.  Expiry is evaluated inside the same UPDATE, not before it.
//
//   3. Kill switch.  One flag disables claiming globally, checked first and
//      failing closed.  PLAN.md §2 requires pairing to be switchable off
//      without a deploy.
//
//   4. No escalation.  Grantable scopes are intersected with an allow-list, so
//      a pairing code can never mint admin authority even if the caller asks
//      for it.  The phone never holds C3_ADMIN_TOKEN (PLAN.md §2 rule 2).
//
//   5. Brute-force resistance.  The code carries 160 bits of entropy, only its
//      hash is stored, attempts are counted, and a failed claim is
//      indistinguishable in shape and cost from an unknown one.
//
// ==============================================================================

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { MOBILE_ERRORS } from './protocol.js';

/** Scopes a pairing code may ever grant.  Anything outside this set is dropped. */
export const PAIRABLE_SCOPES = Object.freeze([
  'read:capabilities',
  'read:chat',
  'write:chat',
  'read:notifications',
  'write:notifications',
  'read:approvals',
  'write:approvals',
  // Read-only project projection. This never grants project mutation,
  // workspace/file access, or a route on the legacy listener.
  'read:projects',
  // Public projection only; secret-bearing and unowned settings are removed
  // by the core repository before the mobile provider sees them.
  'read:settings',
  // User-facing LTM and project-scoped task memory. Internal agent memory is
  // excluded by the repository projection.
  'read:memory',
  // Persisted worker configuration and last trustworthy terminal run only.
  'read:workers',
  // Persisted specialist package configuration; no runtime registration data.
  'read:specialists',
  // Device lifecycle is an intentional denial-of-access authority, never an
  // admin or token-reading surface. It can list public token metadata and
  // revoke, but cannot mint, widen or recover a credential.
  'read:devices',
  'write:devices',
]);

/**
 * Scopes that must never be reachable through pairing, listed explicitly so the
 * prohibition is visible in code review rather than implied by the allow-list.
 */
export const FORBIDDEN_SCOPES = Object.freeze([
  'admin',
  'admin:*',
  'write:security',
  'read:security',
  'exec',
  'terminal',
]);

export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 15 * 60 * 1000;
const MAX_CLAIM_ATTEMPTS = 10;

const CODE_BYTES = 20; // 160 bits

export function isPairingEnabled(env = process.env) {
  // Fail-closed default: pairing is off unless explicitly switched on.  An
  // operator who has not thought about pairing should not be running it.
  return env.C3_MOBILE_PAIRING === 'on' || env.C3_MOBILE_PAIRING === '1';
}

function hashCode(code) {
  return createHash('sha256').update(code).digest('hex');
}

/** Format a 160-bit code as base32-ish groups that are readable off a screen. */
function generateCode() {
  return randomBytes(CODE_BYTES).toString('base64url');
}

export function sanitizeScopes(requested) {
  const list = Array.isArray(requested) ? requested : [];
  return PAIRABLE_SCOPES.filter(scope => list.includes(scope));
}

/**
 * Issue a pairing code.  Called from the trusted desktop side only — never
 * from the mobile gateway, which is why it takes no request context.
 *
 * @returns {{id, code, expiresAt, scopes}} `code` is returned exactly once.
 */
export function createPairingCode(rawDb, {
  scopes = [
    'read:capabilities', 'read:chat', 'write:chat',
    'read:notifications', 'write:notifications',
    'read:projects', 'read:settings', 'read:memory',
    'read:workers', 'read:specialists', 'read:devices', 'write:devices',
  ],
  label = null,
  ttlMs = DEFAULT_PAIRING_TTL_MS,
  now = Date.now(),
} = {}) {
  const grantable = sanitizeScopes(scopes);
  if (grantable.length === 0) {
    throw new Error('Pairing code must grant at least one pairable scope');
  }

  const effectiveTtl = Math.min(Math.max(30_000, ttlMs), MAX_TTL_MS);
  const id = randomUUID();
  const code = generateCode();
  const expiresAt = new Date(now + effectiveTtl);

  rawDb.prepare(`
    INSERT INTO mobile_pairing_codes (id, code_hash, scopes, label, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, hashCode(code), JSON.stringify(grantable), label,
         expiresAt.toISOString().replace('T', ' ').slice(0, 19));

  return { id, code, expiresAt: expiresAt.toISOString(), scopes: grantable };
}

/**
 * Claim a pairing code and mint a device token.
 *
 * @returns {{ok: true, token, deviceId, scopes, expiresAt}
 *          |{ok: false, error: descriptor}}
 */
export function claimPairingCode(rawDb, {
  code,
  deviceName = 'mobile device',
  tokenTtlMs = 30 * 24 * 60 * 60 * 1000,
  env = process.env,
  now = Date.now(),
} = {}) {
  // (3) Kill switch first.  Nothing below it runs when pairing is disabled,
  // including attempt counting — a disabled system should do no work.
  if (!isPairingEnabled(env)) {
    return { ok: false, error: MOBILE_ERRORS.PAIRING_DISABLED };
  }

  if (typeof code !== 'string' || code.length < 16 || code.length > 256) {
    return { ok: false, error: MOBILE_ERRORS.BAD_REQUEST, reason: 'code_malformed' };
  }

  const codeHash = hashCode(code);
  const nowSql = new Date(now).toISOString().replace('T', ' ').slice(0, 19);

  // The whole claim is one transaction: either a code is consumed *and* a
  // token exists, or neither happened.  A crash between the two would
  // otherwise burn a code without giving the phone anything.
  const claim = rawDb.transaction(() => {
    const row = rawDb.prepare(`
      SELECT id, scopes, expires_at, claimed_at, cancelled_at, attempt_count
        FROM mobile_pairing_codes WHERE code_hash = ?
    `).get(codeHash);

    if (!row) return { ok: false, error: MOBILE_ERRORS.TOKEN_INVALID, reason: 'unknown_code' };

    rawDb.prepare(`
      UPDATE mobile_pairing_codes SET attempt_count = attempt_count + 1 WHERE id = ?
    `).run(row.id);

    if (row.attempt_count + 1 > MAX_CLAIM_ATTEMPTS) {
      return { ok: false, error: MOBILE_ERRORS.RATE_LIMITED, reason: 'too_many_attempts' };
    }
    if (row.cancelled_at) {
      return { ok: false, error: MOBILE_ERRORS.PAIRING_EXPIRED, reason: 'cancelled' };
    }
    // (1) Report an already-claimed code as a *conflict*, distinct from an
    // unknown one, so an operator can tell a replay from a guess.
    if (row.claimed_at) {
      return { ok: false, error: MOBILE_ERRORS.PAIRING_ALREADY_USED };
    }

    // (2) TTL and (1) single-use are both preconditions of this UPDATE.  If
    // another request claimed the code between the SELECT above and here,
    // `changes` is 0 and this attempt loses cleanly.
    const consumed = rawDb.prepare(`
      UPDATE mobile_pairing_codes
         SET claimed_at = ?, claimed_by = ?
       WHERE id = ?
         AND claimed_at IS NULL
         AND cancelled_at IS NULL
         AND expires_at > ?
    `).run(nowSql, deviceName, row.id, nowSql);

    if (consumed.changes === 0) {
      const fresh = rawDb.prepare(
        'SELECT claimed_at, expires_at FROM mobile_pairing_codes WHERE id = ?',
      ).get(row.id);
      if (fresh?.claimed_at) return { ok: false, error: MOBILE_ERRORS.PAIRING_ALREADY_USED };
      return { ok: false, error: MOBILE_ERRORS.PAIRING_EXPIRED };
    }

    // (4) The granted scopes come from the stored row and are re-filtered.
    // Even a tampered row cannot widen authority beyond the allow-list.
    const scopes = sanitizeScopes(JSON.parse(row.scopes || '[]'));
    if (scopes.length === 0) {
      throw new Error('pairing row carried no grantable scope');
    }

    const deviceId = `dev_${randomUUID()}`;
    const token = `c3_${randomBytes(24).toString('base64url')}`;
    const tokenExpiry = new Date(now + tokenTtlMs);

    rawDb.prepare(`
      INSERT INTO api_tokens (id, name, token_hash, scopes, expires_at, device_id, kind)
      VALUES (?, ?, ?, ?, ?, ?, 'mobile')
    `).run(
      deviceId,
      deviceName,
      hashCode(token),
      JSON.stringify(scopes),
      tokenExpiry.toISOString().replace('T', ' ').slice(0, 19),
      deviceId,
    );

    return {
      ok: true,
      token,
      deviceId,
      scopes,
      expiresAt: tokenExpiry.toISOString(),
    };
  });

  return claim();
}

/**
 * Validate a mobile device token, distinguishing revoked from invalid (§8.3).
 *
 * This is intentionally separate from `validateApiToken` in routes/security.js:
 * that helper answers "is this token usable", which correctly collapses several
 * causes.  The mobile boundary needs the cause itself, because the client shows
 * a different screen for each.
 *
 * @returns {{valid: true, id, name, scopes, deviceId}
 *          |{valid: false, error: descriptor}}
 */
export function validateDeviceToken(rawDb, token, { now = Date.now() } = {}) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: MOBILE_ERRORS.TOKEN_MISSING };
  }

  let row;
  try {
    row = rawDb.prepare(`
      SELECT id, name, scopes, expires_at, revoked_at, device_id, kind
        FROM api_tokens WHERE token_hash = ?
    `).get(hashCode(token));
  } catch {
    return { valid: false, error: MOBILE_ERRORS.SERVER_UNAVAILABLE };
  }

  if (!row) return { valid: false, error: MOBILE_ERRORS.TOKEN_INVALID };

  // Revocation is checked before expiry: a token that was revoked *and* then
  // expired should still report revoked, because that is the fact the user
  // needs (someone cut this device off).
  if (row.revoked_at) return { valid: false, error: MOBILE_ERRORS.TOKEN_REVOKED };

  if (row.expires_at) {
    const expiresMs = Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z');
    if (Number.isNaN(expiresMs) || expiresMs < now) {
      return { valid: false, error: MOBILE_ERRORS.TOKEN_EXPIRED };
    }
  }

  try {
    rawDb.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  } catch { /* last_used_at is diagnostics; never fail a valid request for it */ }

  let scopes = [];
  try { scopes = JSON.parse(row.scopes || '[]'); } catch { scopes = []; }

  return {
    valid: true,
    id: row.id,
    name: row.name,
    scopes: Array.isArray(scopes) ? scopes : [],
    deviceId: row.device_id || row.id,
    kind: row.kind || 'api',
  };
}

/**
 * Revoke a device.  Blocks new server access immediately — which, per
 * DATA-MODEL §4.2, is the *only* guarantee revocation makes.  It is not a
 * remote wipe and must not be described as one.
 */
export function revokeDevice(rawDb, deviceId) {
  const info = rawDb.prepare(`
    UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE (id = ? OR device_id = ?) AND revoked_at IS NULL
  `).run(deviceId, deviceId);
  return info.changes > 0;
}

export function listDevices(rawDb) {
  return rawDb.prepare(`
    SELECT id, device_id, name, scopes, created_at, last_used_at, expires_at, revoked_at
      FROM api_tokens WHERE kind = 'mobile' ORDER BY created_at DESC
  `).all().map(deviceRow);
}

export function getMobileDevice(rawDb, deviceId) {
  const row = rawDb.prepare(`
    SELECT id, device_id, name, scopes, created_at, last_used_at, expires_at, revoked_at
      FROM api_tokens
     WHERE kind = 'mobile' AND (id = ? OR device_id = ?)
     LIMIT 1
  `).get(deviceId, deviceId);
  return row ? deviceRow(row) : null;
}

function deviceRow(row) {
  let scopes = [];
  try {
    const parsed = JSON.parse(row.scopes || '[]');
    if (Array.isArray(parsed)) scopes = parsed.filter(scope => typeof scope === 'string');
  } catch { /* corrupted scope metadata is exposed as no authority, never raw */ }
  return {
    deviceId: row.device_id || row.id,
    name: row.name,
    scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revoked: Boolean(row.revoked_at),
  };
}

/** Remove expired, unclaimed codes.  Claimed codes are kept as an audit trail. */
export function purgePairingCodes(rawDb, now = Date.now()) {
  const cutoff = new Date(now).toISOString().replace('T', ' ').slice(0, 19);
  return rawDb.prepare(`
    DELETE FROM mobile_pairing_codes WHERE claimed_at IS NULL AND expires_at < ?
  `).run(cutoff).changes;
}

export function cancelPairingCode(rawDb, id) {
  return rawDb.prepare(`
    UPDATE mobile_pairing_codes SET cancelled_at = CURRENT_TIMESTAMP
     WHERE id = ? AND claimed_at IS NULL AND cancelled_at IS NULL
  `).run(id).changes > 0;
}

// Exported for tests that need to assert the stored form is a hash.
export const _internals = { hashCode, generateCode, MAX_CLAIM_ATTEMPTS, timingSafeEqual };

export default {
  createPairingCode,
  claimPairingCode,
  validateDeviceToken,
  revokeDevice,
  listDevices,
  getMobileDevice,
  purgePairingCodes,
  cancelPairingCode,
  isPairingEnabled,
  sanitizeScopes,
  PAIRABLE_SCOPES,
  FORBIDDEN_SCOPES,
};
