import {
  createHash,
  createPublicKey,
  randomBytes as systemRandomBytes,
  verify as verifySignature,
} from 'node:crypto';

import {
  createM7RemoteDeviceProofBytes,
  createM7SessionAuditRecord,
  digestM7SessionValue,
  encodeM7SessionAuditRecord,
  normalizeM7RemoteScopes,
  registerM7SessionAuthorityFunctions,
} from './m7-session-authority-validation.js';

export const M7_SESSION_AUTHORITY_STAGE = 'IMPLEMENTED_NOT_ACTIVE';
export const M7_SESSION_CHALLENGE_ROUTE = Object.freeze({
  method: 'POST',
  path: '/remote/v1/session/challenge',
  stage: 'TRANSPORT_FREE_NOT_REGISTERED',
});

export const M7_SESSION_AUTHORITY_ERROR = Object.freeze({
  AUTHORITY_DENIED: 'M7_SESSION_OPERATOR_AUTHORITY_DENIED',
  CHALLENGE_INVALID: 'M7_SESSION_CHALLENGE_INVALID',
  CONFIG_INVALID: 'M7_SESSION_CONFIG_INVALID',
  INPUT_INVALID: 'M7_SESSION_INPUT_INVALID',
  PAIRING_DISABLED: 'M7_SESSION_PAIRING_DISABLED',
  PAIRING_EXPIRED: 'M7_SESSION_PAIRING_EXPIRED',
  PAIRING_INVALID: 'M7_SESSION_PAIRING_INVALID',
  PAIRING_REVOKED: 'M7_SESSION_PAIRING_REVOKED',
  PAIRING_USED: 'M7_SESSION_PAIRING_USED',
  PROOF_INVALID: 'M7_SESSION_DEVICE_PROOF_INVALID',
  REPLAY: 'M7_SESSION_REPLAY_REJECTED',
  SCOPE_DENIED: 'M7_SESSION_SCOPE_DENIED',
  SESSION_EXPIRED: 'M7_SESSION_EXPIRED',
  SESSION_INVALID: 'M7_SESSION_INVALID',
  SESSION_REVOKED: 'M7_SESSION_REVOKED',
  STORAGE_FAILURE: 'M7_SESSION_STORAGE_FAILURE',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/u;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HTTPS_ORIGIN = /^https:\/\/[^/?#]+$/u;
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const sessionAuthorities = new WeakSet();
const PAIRING_CLAIM_REQUEST_KEYS = Object.freeze([
  'claimCode', 'clientBuild', 'clientInstanceId', 'clientNonce', 'contract',
  'deviceKeyId', 'devicePublicKey', 'requestId', 'sentAt', 'version',
]);
const CHALLENGE_REQUEST_KEYS = Object.freeze([
  'clientNonce', 'contract', 'deviceId', 'deviceSignature', 'pairingRevision',
  'purpose', 'requestId', 'sentAt', 'sessionId', 'sessionRevision', 'version',
]);
const INVOCATION_REQUEST_KEYS = Object.freeze([
  'capabilityId', 'capabilityVersion', 'clientCounter', 'contract', 'deviceId',
  'deviceSignature', 'nonce', 'operationId', 'payload', 'payloadDigest',
  'requestId', 'sentAt', 'sessionId', 'sessionRevision', 'subjectId', 'version',
]);

export class M7SessionAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'M7SessionAuthorityError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new M7SessionAuthorityError(code, message, details);
}

function requireDatabase(db) {
  if (!db
    || typeof db.prepare !== 'function'
    || typeof db.transaction !== 'function'
    || typeof db.function !== 'function') {
    fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:database-required');
  }
  return db;
}

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, `m7-session:${name}-required`);
  }
  return value;
}

function requireIdentifier(value, field) {
  if (!IDENTIFIER.test(value || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, `m7-session:${field}-invalid`);
  }
  return value;
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeAuditIdentifier(value) {
  return IDENTIFIER.test(value || '') ? value : null;
}

function hasExactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function exactHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.origin === value;
  } catch {
    return false;
  }
}

function requireTimestamp(value, nowMs, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)
    || new Date(parsed).toISOString() !== value
    || Math.abs(nowMs - parsed) > 60_000) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, `m7-session:${field}-invalid`);
  }
  return parsed;
}

function requireDuration(value, maximum, field) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, `m7-session:${field}-invalid`);
  }
  return value;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immediate(db, callback) {
  const transaction = db.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function decodeBase64Url(value, pattern, bytes, field) {
  if (!pattern.test(value || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, `m7-session:${field}-invalid`);
  }
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, `m7-session:${field}-invalid`);
  }
  if (decoded.length !== bytes || decoded.toString('base64url') !== value) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, `m7-session:${field}-invalid`);
  }
  return decoded;
}

function publicKeyFromRaw(raw) {
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

function parseScopes(raw) {
  try {
    return normalizeM7RemoteScopes(JSON.parse(Buffer.from(raw).toString('utf8')));
  } catch (error) {
    fail(M7_SESSION_AUTHORITY_ERROR.STORAGE_FAILURE, 'm7-session:stored-scopes-invalid', {
      cause: error?.message || String(error),
    });
  }
}

function requireScopes(value) {
  try {
    return normalizeM7RemoteScopes(value);
  } catch {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:scopes-invalid');
  }
}

function frozenScopesBytes(scopes) {
  return Buffer.from(JSON.stringify(normalizeM7RemoteScopes(scopes)), 'utf8');
}

function randomToken(randomSource, byteLength, prefix = '') {
  const bytes = randomSource(byteLength);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:random-source-invalid');
  }
  const buffer = Buffer.from(bytes);
  if (buffer.length !== byteLength) {
    fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:random-source-invalid');
  }
  return `${prefix}${buffer.toString('base64url')}`;
}

function normalizeOperatorDecision(value) {
  if (!value
    || value.decision !== 'allow'
    || value.actorType !== 'user'
    || !IDENTIFIER.test(value.actorId || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.AUTHORITY_DENIED, 'm7-session:user-authority-required');
  }
  return value.actorId;
}

function sessionStateError(row, nowMs) {
  if (!row) return M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID;
  if (row.pairingState !== 'PAIRED' || row.state === 'REVOKED') {
    return M7_SESSION_AUTHORITY_ERROR.SESSION_REVOKED;
  }
  if (row.state !== 'ACTIVE') return M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID;
  if (row.expiresAtMs <= nowMs) return M7_SESSION_AUTHORITY_ERROR.SESSION_EXPIRED;
  return null;
}

function verifyProof(schemaId, request, rawPublicKey) {
  const signature = decodeBase64Url(request?.deviceSignature, SIGNATURE, 64, 'deviceSignature');
  let valid = false;
  try {
    valid = verifySignature(
      null,
      createM7RemoteDeviceProofBytes(schemaId, request),
      publicKeyFromRaw(rawPublicKey),
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) fail(M7_SESSION_AUTHORITY_ERROR.PROOF_INVALID, 'm7-session:device-proof-invalid');
}

function requirePairingClaimRequest(request, nowMs) {
  if (!hasExactKeys(request, PAIRING_CLAIM_REQUEST_KEYS)
    || request.contract !== 'RemotePairingClaimRequest'
    || request.version !== 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:pairing-request-invalid');
  }
  for (const field of ['requestId', 'clientInstanceId']) requireIdentifier(request[field], field);
  if (!NONCE.test(request.claimCode || '') || !NONCE.test(request.clientNonce || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:pairing-nonce-invalid');
  }
  if (!KEY_ID.test(request.deviceKeyId || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:deviceKeyId-invalid');
  }
  const publicKey = decodeBase64Url(request.devicePublicKey, PUBLIC_KEY, 32, 'devicePublicKey');
  if (typeof request.clientBuild !== 'string'
    || !request.clientBuild.trim()
    || request.clientBuild.length > 256) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:clientBuild-invalid');
  }
  requireTimestamp(request.sentAt, nowMs, 'sentAt');
  return publicKey;
}

function requireChallengeRequest(request, nowMs) {
  if (!hasExactKeys(request, CHALLENGE_REQUEST_KEYS)
    || request.contract !== 'RemoteSessionChallengeRequest'
    || request.version !== 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:challenge-request-invalid');
  }
  for (const field of ['deviceId', 'pairingRevision', 'requestId']) {
    requireIdentifier(request[field], field);
  }
  if (!NONCE.test(request.clientNonce || '')
    || !SIGNATURE.test(request.deviceSignature || '')
    || !['OPEN', 'REFRESH'].includes(request.purpose)) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:challenge-proof-input-invalid');
  }
  if (request.purpose === 'OPEN') {
    if (request.sessionId !== null || request.sessionRevision !== null) {
      fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:open-challenge-session-forbidden');
    }
  } else {
    requireIdentifier(request.sessionId, 'sessionId');
    requireIdentifier(request.sessionRevision, 'sessionRevision');
  }
  requireTimestamp(request.sentAt, nowMs, 'sentAt');
}

function requireOpenRequest(request, nowMs) {
  if (!request || request.contract !== 'RemoteSessionOpenRequest' || request.version !== 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:open-request-invalid');
  }
  for (const field of ['requestId', 'clientInstanceId', 'deviceId', 'pairingRevision']) {
    requireIdentifier(request[field], field);
  }
  if (!KEY_ID.test(request.deviceKeyId || '') || !NONCE.test(request.serverNonce || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:open-proof-input-invalid');
  }
  if (typeof request.clientBuild !== 'string'
    || !request.clientBuild.trim()
    || request.clientBuild.length > 256) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:clientBuild-invalid');
  }
  requireTimestamp(request.sentAt, nowMs, 'sentAt');
}

function requireRefreshRequest(request, nowMs) {
  if (!request || request.contract !== 'RemoteSessionRefreshRequest' || request.version !== 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:refresh-request-invalid');
  }
  for (const field of [
    'requestId', 'deviceId', 'subjectId', 'sessionId', 'sessionRevision',
  ]) requireIdentifier(request[field], field);
  if (!NONCE.test(request.clientNonce || '') || !NONCE.test(request.serverNonce || '')) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:refresh-nonce-invalid');
  }
  if (!Number.isSafeInteger(request.clientCounter) || request.clientCounter < 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:clientCounter-invalid');
  }
  requireTimestamp(request.sentAt, nowMs, 'sentAt');
}

function requireRevokeRequest(request, nowMs) {
  if (!request || request.contract !== 'RemoteSessionRevokeRequest' || request.version !== 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:revoke-request-invalid');
  }
  for (const field of [
    'requestId', 'deviceId', 'subjectId', 'sessionId', 'sessionRevision',
  ]) requireIdentifier(request[field], field);
  if (!NONCE.test(request.clientNonce || '')
    || !Number.isSafeInteger(request.clientCounter)
    || request.clientCounter < 1
    || !['device_lost', 'logout', 'operator_revoke', 'security_reset'].includes(request.reason)) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:revoke-input-invalid');
  }
  requireTimestamp(request.sentAt, nowMs, 'sentAt');
}

function requireInvocationRequest(request, nowMs) {
  if (!hasExactKeys(request, INVOCATION_REQUEST_KEYS)
    || request.contract !== 'RemoteInvocationEnvelope'
    || request.version !== 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:invocation-request-invalid');
  }
  for (const field of [
    'capabilityId', 'deviceId', 'operationId', 'requestId', 'sessionId',
    'sessionRevision', 'subjectId',
  ]) requireIdentifier(request[field], field);
  if (!NONCE.test(request.nonce || '')
    || !SIGNATURE.test(request.deviceSignature || '')
    || !SHA256.test(request.payloadDigest || '')
    || !Number.isSafeInteger(request.capabilityVersion)
    || request.capabilityVersion < 1
    || !Number.isSafeInteger(request.clientCounter)
    || request.clientCounter < 1) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:invocation-proof-input-invalid');
  }
  let payloadDigest;
  try {
    payloadDigest = digestM7SessionValue(request.payload);
  } catch {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:invocation-payload-invalid');
  }
  if (payloadDigest !== request.payloadDigest) {
    fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:invocation-payload-digest-mismatch');
  }
  requireTimestamp(request.sentAt, nowMs, 'sentAt');
}

export class M7SessionAuthority {
  constructor(db, {
    adapterManifestDigest,
    authorizeOperator,
    challengeTtlMs = 60_000,
    claimTtlMs = 300_000,
    clock = Date.now,
    pairingEnabled = false,
    randomBytes = systemRandomBytes,
    resolveInvocationScopes = null,
    serverIdentityPin,
    serverOrigin,
    sessionTtlMs = 900_000,
  } = {}) {
    this.database = requireDatabase(db);
    this.clock = requireFunction(clock, 'clock');
    this.randomBytes = requireFunction(randomBytes, 'random-source');
    this.resolveInvocationScopes = resolveInvocationScopes;
    this.authorizeOperator = authorizeOperator;
    this.pairingEnabled = pairingEnabled;
    this.claimTtlMs = requireDuration(claimTtlMs, 300_000, 'claim-ttl');
    this.challengeTtlMs = requireDuration(challengeTtlMs, 60_000, 'challenge-ttl');
    this.sessionTtlMs = requireDuration(sessionTtlMs, 900_000, 'session-ttl');
    if (!HTTPS_ORIGIN.test(serverOrigin || '')
      || !exactHttpsOrigin(serverOrigin)
      || !SHA256.test(serverIdentityPin || '')
      || !SHA256.test(adapterManifestDigest || '')) {
      fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:server-binding-invalid');
    }
    this.serverOrigin = serverOrigin;
    this.serverIdentityPin = serverIdentityPin;
    this.adapterManifestDigest = adapterManifestDigest;
    registerM7SessionAuthorityFunctions(this.database);
    sessionAuthorities.add(this);
  }

  now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:clock-invalid');
    }
    return value;
  }

  isPairingEnabled() {
    return typeof this.pairingEnabled === 'function'
      ? this.pairingEnabled() === true
      : this.pairingEnabled === true;
  }

  audit(input) {
    const record = createM7SessionAuditRecord(input);
    const bytes = encodeM7SessionAuditRecord(record);
    this.database.prepare(`
      INSERT INTO m7_remote_session_audit_events (
        action, device_id, subject_id, session_id, outcome, recorded_at_ms, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS BLOB))
    `).run(
      record.action,
      record.deviceId,
      record.subjectId,
      record.sessionId,
      record.outcome,
      record.recordedAtMs,
      bytes,
    );
  }

  withDeniedAudit(action, context, callback) {
    try {
      return callback();
    } catch (error) {
      if (!(error instanceof M7SessionAuthorityError)) throw error;
      const input = plain(context) ? context : {};
      let recordedAtMs;
      try {
        recordedAtMs = this.now();
        immediate(this.database, () => {
          const attemptSequence = this.database.prepare(`
            SELECT coalesce(max(audit_revision), 0) + 1 AS value
            FROM m7_remote_session_audit_events
          `).get().value;
          this.audit({
            action,
            deviceId: safeAuditIdentifier(input.deviceId),
            subjectId: safeAuditIdentifier(input.subjectId),
            pairingRevision: safeAuditIdentifier(input.pairingRevision),
            sessionId: safeAuditIdentifier(input.sessionId),
            sessionRevision: safeAuditIdentifier(input.sessionRevision),
            outcome: 'DENIED',
            reasonCode: error.code,
            detailsDigest: digestM7SessionValue({
              action,
              attemptSequence,
              reasonCode: error.code,
              requestId: safeAuditIdentifier(input.requestId),
            }),
            recordedAtMs,
          });
        });
      } catch (auditError) {
        if (auditError instanceof M7SessionAuthorityError
          && auditError.code === M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID) {
          throw error;
        }
        fail(M7_SESSION_AUTHORITY_ERROR.STORAGE_FAILURE, 'm7-session:denial-audit-failed', {
          cause: auditError?.message || String(auditError),
          deniedReasonCode: error.code,
        });
      }
      throw error;
    }
  }

  issuePairingClaim(input) {
    return this.withDeniedAudit('PAIRING_CLAIM_ISSUE_ATTEMPT', input, () => {
      const {
        authenticatedSubject, credentialType, subjectId, scopes,
      } = plain(input) ? input : {};
      const nowMs = this.now();
      const normalizedScopes = requireScopes(scopes);
      requireIdentifier(subjectId, 'subjectId');
      if (typeof this.authorizeOperator !== 'function') {
        fail(M7_SESSION_AUTHORITY_ERROR.AUTHORITY_DENIED, 'm7-session:user-authority-required');
      }
      const actorId = normalizeOperatorDecision(this.authorizeOperator({
        action: 'm7.remote.pairing.issue',
        authenticatedSubject,
        credentialType,
        subjectId,
        scopes: normalizedScopes,
      }));
      if (!this.isPairingEnabled()) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_DISABLED, 'm7-session:pairing-disabled');
      }
      const claimCode = randomToken(this.randomBytes, 16);
      const claimId = randomToken(this.randomBytes, 18, 'pairing-claim:');
      const claimDigest = sha256Text(claimCode);
      const expiresAtMs = nowMs + this.claimTtlMs;
      immediate(this.database, () => {
        this.database.prepare(`
          INSERT INTO m7_remote_pairing_claims (
            claim_id, claim_digest, subject_id, scopes_json, issued_by,
            issued_at_ms, expires_at_ms, consumed_at_ms, revoked_at_ms
          ) VALUES (?, ?, ?, CAST(? AS BLOB), ?, ?, ?, NULL, NULL)
        `).run(
          claimId, claimDigest, subjectId, frozenScopesBytes(normalizedScopes), actorId,
          nowMs, expiresAtMs,
        );
        this.audit({
          action: 'PAIRING_CLAIM_ISSUED', actorId, subjectId, outcome: 'ALLOWED',
          detailsDigest: digestM7SessionValue({ claimId, expiresAtMs, scopes: normalizedScopes }),
          recordedAtMs: nowMs,
        });
      });
      return deepFreeze({
        claimCode,
        claimId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        scopes: [...normalizedScopes],
        subjectId,
      });
    });
  }

  claimPairing(request) {
    return this.withDeniedAudit('PAIRING_CLAIM_ATTEMPT', request, () => {
      const nowMs = this.now();
      const publicKey = requirePairingClaimRequest(request, nowMs);
      if (!this.isPairingEnabled()) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_DISABLED, 'm7-session:pairing-disabled');
      }
      const claimDigest = sha256Text(request.claimCode);
      return immediate(this.database, () => {
      const claim = this.database.prepare(`
        SELECT claim_id AS claimId, subject_id AS subjectId, scopes_json AS scopesBytes,
          issued_by AS issuedBy, expires_at_ms AS expiresAtMs,
          consumed_at_ms AS consumedAtMs, revoked_at_ms AS revokedAtMs
        FROM m7_remote_pairing_claims WHERE claim_digest = ?
      `).get(claimDigest);
      if (!claim) fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_INVALID, 'm7-session:pairing-invalid');
      if (claim.revokedAtMs !== null) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_REVOKED, 'm7-session:pairing-revoked');
      }
      if (claim.consumedAtMs !== null) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_USED, 'm7-session:pairing-used');
      }
      if (claim.expiresAtMs <= nowMs) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_EXPIRED, 'm7-session:pairing-expired');
      }
      const consumed = this.database.prepare(`
        UPDATE m7_remote_pairing_claims SET consumed_at_ms = ?
        WHERE claim_id = ? AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
          AND expires_at_ms > ?
      `).run(nowMs, claim.claimId, nowMs);
      if (consumed.changes !== 1) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_USED, 'm7-session:pairing-race-lost');
      }
      const scopes = parseScopes(claim.scopesBytes);
      const deviceId = randomToken(this.randomBytes, 18, 'device:');
      const pairingRevision = randomToken(this.randomBytes, 18, 'pairing-revision:');
      this.database.prepare(`
        INSERT INTO m7_remote_pairings (
          pairing_revision, device_id, subject_id, device_key_id, device_public_key,
          scopes_json, claim_id, paired_at_ms, state, revoked_at_ms
        ) VALUES (?, ?, ?, ?, CAST(? AS BLOB), CAST(? AS BLOB), ?, ?, 'PAIRED', NULL)
      `).run(
        pairingRevision, deviceId, claim.subjectId, request.deviceKeyId, publicKey,
        frozenScopesBytes(scopes), claim.claimId, nowMs,
      );
      this.audit({
        action: 'PAIRING_CLAIMED', actorId: claim.issuedBy, deviceId,
        subjectId: claim.subjectId, pairingRevision, outcome: 'ALLOWED',
        detailsDigest: digestM7SessionValue({
          clientBuild: request.clientBuild,
          clientInstanceId: request.clientInstanceId,
          deviceKeyId: request.deviceKeyId,
          requestId: request.requestId,
        }),
        recordedAtMs: nowMs,
      });
      return deepFreeze({
        contract: 'RemotePairingClaimResult',
        version: 1,
        requestId: request.requestId,
        status: 'paired',
        deviceId,
        subjectId: claim.subjectId,
        pairingRevision,
        scopes: [...scopes],
        deviceKeyId: request.deviceKeyId,
        pairedAt: new Date(nowMs).toISOString(),
        error: null,
      });
      });
    });
  }

  requestChallenge(input) {
    return this.withDeniedAudit('SESSION_CHALLENGE_ATTEMPT', input, () => {
      const nowMs = this.now();
      requireChallengeRequest(input, nowMs);
      return immediate(this.database, () => {
      const pairing = this.database.prepare(`
        SELECT pairing_revision AS pairingRevision, subject_id AS subjectId,
          device_public_key AS publicKey, state
        FROM m7_remote_pairings WHERE device_id = ?
      `).get(input.deviceId);
      if (!pairing || pairing.state !== 'PAIRED') {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_REVOKED, 'm7-session:active-pairing-required');
      }
      if (pairing.pairingRevision !== input.pairingRevision) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_INVALID, 'm7-session:pairing-binding-invalid');
      }
      verifyProof('RemoteSessionChallengeRequest@1', input, pairing.publicKey);
      if (input.purpose === 'REFRESH') {
        const session = this.currentSession(input.sessionId);
        if (!session
          || session.sessionRevision !== input.sessionRevision
          || session.deviceId !== input.deviceId
          || session.pairingRevision !== input.pairingRevision
          || session.state !== 'ACTIVE'
          || session.expiresAtMs <= nowMs) {
          fail(M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID, 'm7-session:active-session-required');
        }
      }
      const proofBytes = createM7RemoteDeviceProofBytes('RemoteSessionChallengeRequest@1', input);
      const challengeId = `challenge:${createHash('sha256').update(proofBytes).digest('base64url')}`;
      const serverNonce = randomToken(this.randomBytes, 24);
      const expiresAtMs = nowMs + this.challengeTtlMs;
      try {
        this.database.prepare(`
          INSERT INTO m7_remote_session_challenges (
            challenge_id, nonce_digest, purpose, device_id, pairing_revision,
            session_id, session_revision, issued_at_ms, expires_at_ms, consumed_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
          challengeId, sha256Text(serverNonce), input.purpose, input.deviceId,
          pairing.pairingRevision, input.sessionId, input.sessionRevision, nowMs, expiresAtMs,
        );
      } catch (error) {
        if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
          fail(M7_SESSION_AUTHORITY_ERROR.REPLAY, 'm7-session:challenge-request-replay');
        }
        throw error;
      }
      this.audit({
        action: 'SESSION_CHALLENGE_ISSUED', deviceId: input.deviceId,
        subjectId: pairing.subjectId, pairingRevision: pairing.pairingRevision,
        sessionId: input.sessionId, sessionRevision: input.sessionRevision,
        outcome: 'ALLOWED',
        detailsDigest: digestM7SessionValue({
          challengeId, expiresAtMs, purpose: input.purpose, requestId: input.requestId,
        }),
        recordedAtMs: nowMs,
      });
      return deepFreeze({
        contract: 'RemoteSessionChallengeResult',
        version: 1,
        requestId: input.requestId,
        status: 'issued',
        deviceId: input.deviceId,
        pairingRevision: pairing.pairingRevision,
        purpose: input.purpose,
        sessionId: input.sessionId,
        sessionRevision: input.sessionRevision,
        challengeId,
        serverNonce,
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        serverIdentityPin: this.serverIdentityPin,
        error: null,
      });
      });
    });
  }

  currentSession(sessionId) {
    return this.database.prepare(`
      SELECT
        session_revision AS sessionRevision, session_id AS sessionId, generation,
        device_id AS deviceId, subject_id AS subjectId,
        pairing_revision AS pairingRevision, device_key_id AS deviceKeyId,
        scopes_json AS scopesBytes, client_build AS clientBuild,
        server_origin AS serverOrigin, server_identity_pin AS serverIdentityPin,
        adapter_manifest_digest AS adapterManifestDigest,
        issued_at_ms AS issuedAtMs, expires_at_ms AS expiresAtMs,
        last_client_counter AS lastClientCounter, state,
        terminal_at_ms AS terminalAtMs,
        (SELECT state FROM m7_remote_pairings p
          WHERE p.pairing_revision = m7_remote_sessions.pairing_revision) AS pairingState,
        (SELECT device_public_key FROM m7_remote_pairings p
          WHERE p.pairing_revision = m7_remote_sessions.pairing_revision) AS publicKey
      FROM m7_remote_sessions
      WHERE session_id = ? ORDER BY generation DESC LIMIT 1
    `).get(sessionId) || null;
  }

  consumeChallenge({ nonce, purpose, deviceId, pairingRevision, sessionId, sessionRevision, nowMs }) {
    const row = this.database.prepare(`
      SELECT challenge_id AS challengeId, expires_at_ms AS expiresAtMs,
        consumed_at_ms AS consumedAtMs, session_id AS sessionId,
        session_revision AS sessionRevision
      FROM m7_remote_session_challenges
      WHERE nonce_digest = ? AND purpose = ? AND device_id = ? AND pairing_revision = ?
    `).get(sha256Text(nonce), purpose, deviceId, pairingRevision);
    if (!row
      || row.consumedAtMs !== null
      || row.expiresAtMs < nowMs
      || row.sessionId !== sessionId
      || row.sessionRevision !== sessionRevision) {
      fail(M7_SESSION_AUTHORITY_ERROR.CHALLENGE_INVALID, 'm7-session:challenge-invalid');
    }
    const consumed = this.database.prepare(`
      UPDATE m7_remote_session_challenges SET consumed_at_ms = ?
      WHERE challenge_id = ? AND consumed_at_ms IS NULL AND expires_at_ms >= ?
    `).run(nowMs, row.challengeId, nowMs);
    if (consumed.changes !== 1) {
      fail(M7_SESSION_AUTHORITY_ERROR.CHALLENGE_INVALID, 'm7-session:challenge-race-lost');
    }
  }

  openSession(request) {
    return this.withDeniedAudit('SESSION_OPEN_ATTEMPT', request, () => {
      const nowMs = this.now();
      requireOpenRequest(request, nowMs);
      return immediate(this.database, () => {
      const pairing = this.database.prepare(`
        SELECT device_id AS deviceId, subject_id AS subjectId,
          pairing_revision AS pairingRevision, device_key_id AS deviceKeyId,
          device_public_key AS publicKey, scopes_json AS scopesBytes, state
        FROM m7_remote_pairings WHERE device_id = ?
      `).get(request.deviceId);
      if (!pairing || pairing.state !== 'PAIRED') {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_REVOKED, 'm7-session:active-pairing-required');
      }
      if (pairing.pairingRevision !== request.pairingRevision
        || pairing.deviceKeyId !== request.deviceKeyId) {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_INVALID, 'm7-session:pairing-binding-invalid');
      }
      verifyProof('RemoteSessionOpenRequest@1', request, pairing.publicKey);
      this.consumeChallenge({
        nonce: request.serverNonce,
        purpose: 'OPEN',
        deviceId: pairing.deviceId,
        pairingRevision: pairing.pairingRevision,
        sessionId: null,
        sessionRevision: null,
        nowMs,
      });
      const sessionId = randomToken(this.randomBytes, 18, 'session:');
      const sessionRevision = randomToken(this.randomBytes, 18, 'session-revision:');
      const expiresAtMs = nowMs + this.sessionTtlMs;
      const scopes = parseScopes(pairing.scopesBytes);
      this.database.prepare(`
        INSERT INTO m7_remote_sessions (
          session_revision, session_id, generation, device_id, subject_id,
          pairing_revision, device_key_id, scopes_json, client_build,
          server_origin, server_identity_pin, adapter_manifest_digest,
          issued_at_ms, expires_at_ms, last_client_counter, state, terminal_at_ms
        ) VALUES (?, ?, 1, ?, ?, ?, ?, CAST(? AS BLOB), ?, ?, ?, ?, ?, ?, 0, 'ACTIVE', NULL)
      `).run(
        sessionRevision, sessionId, pairing.deviceId, pairing.subjectId,
        pairing.pairingRevision, pairing.deviceKeyId, frozenScopesBytes(scopes),
        request.clientBuild.normalize('NFC'), this.serverOrigin, this.serverIdentityPin,
        this.adapterManifestDigest, nowMs, expiresAtMs,
      );
      this.audit({
        action: 'SESSION_OPENED', deviceId: pairing.deviceId,
        subjectId: pairing.subjectId, pairingRevision: pairing.pairingRevision,
        sessionId, sessionRevision, outcome: 'ALLOWED',
        detailsDigest: digestM7SessionValue({ requestId: request.requestId }),
        recordedAtMs: nowMs,
      });
      return deepFreeze({
        contract: 'RemoteSessionOpenResult', version: 1, requestId: request.requestId,
        status: 'active', sessionId, deviceId: pairing.deviceId,
        subjectId: pairing.subjectId, pairingRevision: pairing.pairingRevision,
        sessionRevision, scopes: [...scopes], issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(), serverOrigin: this.serverOrigin,
        serverIdentityPin: this.serverIdentityPin,
        adapterManifestDigest: this.adapterManifestDigest, error: null,
      });
      });
    });
  }

  refreshSession(request) {
    return this.withDeniedAudit('SESSION_REFRESH_ATTEMPT', request, () => {
      const nowMs = this.now();
      requireRefreshRequest(request, nowMs);
      return immediate(this.database, () => {
      const current = this.currentSession(request.sessionId);
      const errorCode = sessionStateError(current, nowMs);
      if (errorCode) fail(errorCode, 'm7-session:active-session-required');
      for (const field of ['deviceId', 'subjectId', 'sessionRevision']) {
        if (current[field] !== request[field]) {
          fail(M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID, `m7-session:${field}-mismatch`);
        }
      }
      if (request.clientCounter <= current.lastClientCounter) {
        fail(M7_SESSION_AUTHORITY_ERROR.REPLAY, 'm7-session:counter-replay');
      }
      verifyProof('RemoteSessionRefreshRequest@1', request, current.publicKey);
      this.consumeChallenge({
        nonce: request.serverNonce,
        purpose: 'REFRESH',
        deviceId: current.deviceId,
        pairingRevision: current.pairingRevision,
        sessionId: current.sessionId,
        sessionRevision: current.sessionRevision,
        nowMs,
      });
      this.database.prepare(`
        UPDATE m7_remote_sessions
        SET state = 'REFRESHED', terminal_at_ms = ?, last_client_counter = ?
        WHERE session_revision = ? AND state = 'ACTIVE'
      `).run(nowMs, request.clientCounter, current.sessionRevision);
      const sessionRevision = randomToken(this.randomBytes, 18, 'session-revision:');
      const expiresAtMs = nowMs + this.sessionTtlMs;
      this.database.prepare(`
        INSERT INTO m7_remote_sessions (
          session_revision, session_id, generation, device_id, subject_id,
          pairing_revision, device_key_id, scopes_json, client_build,
          server_origin, server_identity_pin, adapter_manifest_digest,
          issued_at_ms, expires_at_ms, last_client_counter, state, terminal_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB), ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL)
      `).run(
        sessionRevision, current.sessionId, current.generation + 1, current.deviceId,
        current.subjectId, current.pairingRevision, current.deviceKeyId,
        current.scopesBytes, current.clientBuild, current.serverOrigin,
        current.serverIdentityPin, current.adapterManifestDigest, nowMs, expiresAtMs,
        request.clientCounter,
      );
      const scopes = parseScopes(current.scopesBytes);
      this.audit({
        action: 'SESSION_REFRESHED', deviceId: current.deviceId,
        subjectId: current.subjectId, pairingRevision: current.pairingRevision,
        sessionId: current.sessionId, sessionRevision, outcome: 'ALLOWED',
        detailsDigest: digestM7SessionValue({
          previousSessionRevision: current.sessionRevision,
          requestId: request.requestId,
        }),
        recordedAtMs: nowMs,
      });
      return deepFreeze({
        contract: 'RemoteSessionRefreshResult', version: 1, requestId: request.requestId,
        status: 'active', sessionId: current.sessionId, deviceId: current.deviceId,
        subjectId: current.subjectId, pairingRevision: current.pairingRevision,
        sessionRevision, scopes: [...scopes], issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(), serverOrigin: current.serverOrigin,
        serverIdentityPin: current.serverIdentityPin,
        adapterManifestDigest: current.adapterManifestDigest, error: null,
      });
      });
    });
  }

  revokeSession(request) {
    return this.withDeniedAudit('SESSION_REVOKE_ATTEMPT', request, () => {
      const nowMs = this.now();
      requireRevokeRequest(request, nowMs);
      return immediate(this.database, () => {
      const current = this.currentSession(request.sessionId);
      const errorCode = sessionStateError(current, nowMs);
      if (errorCode) fail(errorCode, 'm7-session:active-session-required');
      for (const field of ['deviceId', 'subjectId', 'sessionRevision']) {
        if (current[field] !== request[field]) {
          fail(M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID, `m7-session:${field}-mismatch`);
        }
      }
      if (request.clientCounter <= current.lastClientCounter) {
        fail(M7_SESSION_AUTHORITY_ERROR.REPLAY, 'm7-session:counter-replay');
      }
      verifyProof('RemoteSessionRevokeRequest@1', request, current.publicKey);
      const updated = this.database.prepare(`
        UPDATE m7_remote_sessions
        SET state = 'REVOKED', terminal_at_ms = ?, last_client_counter = ?
        WHERE session_revision = ? AND state = 'ACTIVE'
      `).run(nowMs, request.clientCounter, current.sessionRevision);
      if (updated.changes !== 1) {
        fail(M7_SESSION_AUTHORITY_ERROR.REPLAY, 'm7-session:revoke-race-lost');
      }
      const sessionRevision = randomToken(this.randomBytes, 18, 'session-revision:');
      this.database.prepare(`
        INSERT INTO m7_remote_sessions (
          session_revision, session_id, generation, device_id, subject_id,
          pairing_revision, device_key_id, scopes_json, client_build,
          server_origin, server_identity_pin, adapter_manifest_digest,
          issued_at_ms, expires_at_ms, last_client_counter, state, terminal_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB), ?, ?, ?, ?, ?, ?, ?, 'REVOKED', ?)
      `).run(
        sessionRevision, current.sessionId, current.generation + 1, current.deviceId,
        current.subjectId, current.pairingRevision, current.deviceKeyId,
        current.scopesBytes, current.clientBuild, current.serverOrigin,
        current.serverIdentityPin, current.adapterManifestDigest, nowMs,
        nowMs + this.sessionTtlMs, request.clientCounter, nowMs,
      );
      this.audit({
        action: 'SESSION_REVOKED', deviceId: current.deviceId,
        subjectId: current.subjectId, pairingRevision: current.pairingRevision,
        sessionId: current.sessionId, sessionRevision,
        outcome: 'ALLOWED',
        detailsDigest: digestM7SessionValue({ reason: request.reason, requestId: request.requestId }),
        recordedAtMs: nowMs,
      });
      return deepFreeze({
        contract: 'RemoteSessionRevokeResult', version: 1, requestId: request.requestId,
        status: 'revoked', deviceId: current.deviceId, subjectId: current.subjectId,
        pairingRevision: current.pairingRevision, sessionRevision,
        revokedAt: new Date(nowMs).toISOString(), error: null,
      });
      });
    });
  }

  revokePairing(input) {
    return this.withDeniedAudit('PAIRING_REVOKE_ATTEMPT', input, () => {
      const { deviceId, reason = 'operator_revoke' } = plain(input) ? input : {};
      const nowMs = this.now();
      requireIdentifier(deviceId, 'deviceId');
      if (typeof this.authorizeOperator !== 'function') {
        fail(M7_SESSION_AUTHORITY_ERROR.AUTHORITY_DENIED, 'm7-session:user-authority-required');
      }
      const actorId = normalizeOperatorDecision(this.authorizeOperator({
        action: 'm7.remote.pairing.revoke', deviceId, reason,
      }));
      return immediate(this.database, () => {
      const pairing = this.database.prepare(`
        SELECT pairing_revision AS pairingRevision, subject_id AS subjectId, state
        FROM m7_remote_pairings WHERE device_id = ?
      `).get(deviceId);
      if (!pairing || pairing.state !== 'PAIRED') {
        fail(M7_SESSION_AUTHORITY_ERROR.PAIRING_REVOKED, 'm7-session:pairing-not-active');
      }
      this.database.prepare(`
        UPDATE m7_remote_pairings SET state = 'REVOKED', revoked_at_ms = ?
        WHERE pairing_revision = ? AND state = 'PAIRED'
      `).run(nowMs, pairing.pairingRevision);
      this.database.prepare(`
        UPDATE m7_remote_sessions SET state = 'REVOKED', terminal_at_ms = ?
        WHERE pairing_revision = ? AND state = 'ACTIVE'
      `).run(nowMs, pairing.pairingRevision);
      this.audit({
        action: 'PAIRING_REVOKED', actorId, deviceId,
        subjectId: pairing.subjectId, pairingRevision: pairing.pairingRevision,
        outcome: 'ALLOWED', reasonCode: 'OPERATOR_REVOKE',
        detailsDigest: digestM7SessionValue({ reason }), recordedAtMs: nowMs,
      });
      return deepFreeze({
        deviceId,
        pairingRevision: pairing.pairingRevision,
        revokedAt: new Date(nowMs).toISOString(),
        subjectId: pairing.subjectId,
      });
      });
    });
  }

  authorizeInvocation(input) {
    return this.withDeniedAudit('INVOCATION_AUTHORIZATION_ATTEMPT', input, () => {
      const nowMs = this.now();
      requireInvocationRequest(input, nowMs);
      const {
        clientCounter, deviceId, nonce, sessionId, sessionRevision, subjectId,
      } = input;
      return immediate(this.database, () => {
      const current = this.currentSession(sessionId);
      const stateError = sessionStateError(current, nowMs);
      if (stateError) {
        if (stateError === M7_SESSION_AUTHORITY_ERROR.SESSION_EXPIRED
          && current?.state === 'ACTIVE') {
          this.database.prepare(`
            UPDATE m7_remote_sessions SET state = 'EXPIRED', terminal_at_ms = ?
            WHERE session_revision = ? AND state = 'ACTIVE'
          `).run(nowMs, current.sessionRevision);
        }
        fail(stateError, 'm7-session:invocation-session-invalid');
      }
      for (const [field, value] of Object.entries({
        deviceId, sessionRevision, subjectId,
      })) {
        if (current[field] !== value) {
          fail(M7_SESSION_AUTHORITY_ERROR.SESSION_INVALID, `m7-session:${field}-mismatch`);
        }
      }
      const granted = parseScopes(current.scopesBytes);
      verifyProof('RemoteInvocationEnvelope@1', input, current.publicKey);
      if (typeof this.resolveInvocationScopes !== 'function') {
        fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:invocation-scope-resolver-required');
      }
      let scopes;
      try {
        scopes = requireScopes(this.resolveInvocationScopes(deepFreeze({
          capabilityId: input.capabilityId,
          capabilityVersion: input.capabilityVersion,
          operationId: input.operationId,
        })));
      } catch (error) {
        if (error instanceof M7SessionAuthorityError) throw error;
        fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:invocation-operation-invalid');
      }
      if (scopes.some(scope => !granted.includes(scope))) {
        fail(M7_SESSION_AUTHORITY_ERROR.SCOPE_DENIED, 'm7-session:required-scope-denied');
      }
      if (clientCounter <= current.lastClientCounter) {
        fail(M7_SESSION_AUTHORITY_ERROR.REPLAY, 'm7-session:counter-replay');
      }
      try {
        this.database.prepare(`
          INSERT INTO m7_remote_invocation_nonces (
            session_id, session_revision, nonce_digest, client_counter, accepted_at_ms
          ) VALUES (?, ?, ?, ?, ?)
        `).run(sessionId, sessionRevision, sha256Text(nonce), clientCounter, nowMs);
        const update = this.database.prepare(`
          UPDATE m7_remote_sessions SET last_client_counter = ?
          WHERE session_revision = ? AND state = 'ACTIVE' AND last_client_counter < ?
        `).run(clientCounter, sessionRevision, clientCounter);
        if (update.changes !== 1) throw new Error('counter-race');
      } catch (error) {
        fail(M7_SESSION_AUTHORITY_ERROR.REPLAY, 'm7-session:nonce-or-counter-replay', {
          cause: error?.message || String(error),
        });
      }
      this.audit({
        action: 'INVOCATION_AUTHORIZED', deviceId, subjectId,
        pairingRevision: current.pairingRevision, sessionId, sessionRevision,
        outcome: 'ALLOWED',
        detailsDigest: digestM7SessionValue({
          clientCounter,
          nonceDigest: sha256Text(nonce),
          requestDigest: digestM7SessionValue(Object.fromEntries(
            Object.entries(input).filter(([key]) => key !== 'deviceSignature'),
          )),
        }),
        recordedAtMs: nowMs,
      });
      return deepFreeze({
        decision: 'allow',
        deviceId,
        subjectId,
        grantedScopes: [...scopes],
      });
      });
    });
  }
}

export function createM7SessionAuthority(db, config) {
  return new M7SessionAuthority(db, config);
}

export function isGenuineM7SessionAuthority(value) {
  return sessionAuthorities.has(value);
}

export function createM7SessionChallengeHandler(sessionAuthority) {
  if (!isGenuineM7SessionAuthority(sessionAuthority)) {
    fail(M7_SESSION_AUTHORITY_ERROR.CONFIG_INVALID, 'm7-session:challenge-authority-required');
  }
  return deepFreeze({
    route: { ...M7_SESSION_CHALLENGE_ROUTE },
    handle(input) {
      if (!hasExactKeys(input, ['body', 'method', 'path'])
        || input.method !== M7_SESSION_CHALLENGE_ROUTE.method
        || input.path !== M7_SESSION_CHALLENGE_ROUTE.path) {
        fail(M7_SESSION_AUTHORITY_ERROR.INPUT_INVALID, 'm7-session:challenge-route-invalid');
      }
      return sessionAuthority.requestChallenge(input.body);
    },
  });
}

export default createM7SessionAuthority;
