import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';

export const M7_REMOTE_SCOPE_IDS = Object.freeze([
  'read:approvals',
  'read:chat',
  'read:events',
  'read:notifications',
  'read:operations',
  'read:projects',
  'read:settings',
  'read:stored_information',
  'write:approvals',
  'write:chat',
  'write:notifications',
  'write:operations',
  'write:settings',
  'write:stored_information',
]);

export const M7_REMOTE_DEVICE_PROOF_SCHEMA_IDS = Object.freeze([
  'RemoteInvocationEnvelope@1',
  'RemoteSessionOpenRequest@1',
  'RemoteSessionRefreshRequest@1',
  'RemoteSessionRevokeRequest@1',
]);

const DEVICE_PROOF_KEYS = Object.freeze({
  'RemoteInvocationEnvelope@1': Object.freeze([
    'capabilityId', 'capabilityVersion', 'clientCounter', 'contract', 'deviceId',
    'deviceSignature', 'nonce', 'operationId', 'payload', 'payloadDigest',
    'requestId', 'sentAt', 'sessionId', 'sessionRevision', 'subjectId', 'version',
  ]),
  'RemoteSessionOpenRequest@1': Object.freeze([
    'clientBuild', 'clientInstanceId', 'contract', 'deviceId', 'deviceKeyId',
    'deviceSignature', 'pairingRevision', 'requestId', 'sentAt', 'serverNonce',
    'version',
  ]),
  'RemoteSessionRefreshRequest@1': Object.freeze([
    'clientCounter', 'clientNonce', 'contract', 'deviceId', 'deviceSignature',
    'requestId', 'sentAt', 'serverNonce', 'sessionId', 'sessionRevision',
    'subjectId', 'version',
  ]),
  'RemoteSessionRevokeRequest@1': Object.freeze([
    'clientCounter', 'clientNonce', 'contract', 'deviceId', 'deviceSignature',
    'reason', 'requestId', 'sentAt', 'sessionId', 'sessionRevision',
    'subjectId', 'version',
  ]),
});
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

export function canonicalizeM7SessionValue(value) {
  return canonicalizeM2ExecutionValue(value);
}

export function digestM7SessionValue(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM7SessionValue(value), 'utf8')
    .digest('hex')}`;
}

export function normalizeM7RemoteScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > M7_REMOTE_SCOPE_IDS.length) {
    throw new TypeError('m7-session:scopes-invalid');
  }
  const normalized = [...value].sort();
  if (new Set(normalized).size !== normalized.length
    || normalized.some(scope => !M7_REMOTE_SCOPE_IDS.includes(scope))) {
    throw new TypeError('m7-session:scopes-invalid');
  }
  return Object.freeze(normalized);
}

export function createM7RemoteDeviceProofBytes(schemaId, request) {
  const keys = DEVICE_PROOF_KEYS[schemaId];
  if (!keys || !exactKeys(request, keys)) {
    throw new TypeError('m7-session:device-proof-request-invalid');
  }
  const unsigned = {};
  for (const key of keys) {
    if (key !== 'deviceSignature') unsigned[key] = request[key];
  }
  const prefix = `IntentSmith/M7/${schemaId}/Ed25519DeviceProof/v1\n`;
  return Buffer.from(`${prefix}${canonicalizeM7SessionValue(unsigned)}`, 'utf8');
}

export function createM7SessionAuditRecord({
  action,
  actorId = null,
  deviceId = null,
  subjectId = null,
  pairingRevision = null,
  sessionId = null,
  sessionRevision = null,
  outcome,
  reasonCode = null,
  detailsDigest,
  recordedAtMs,
}) {
  const value = {
    contract: 'M7RemoteSessionAuditEvent',
    version: 1,
    action,
    actorId,
    deviceId,
    subjectId,
    pairingRevision,
    sessionId,
    sessionRevision,
    outcome,
    reasonCode,
    detailsDigest,
    recordedAtMs,
  };
  const validation = validateM7SessionAuditRecord(value);
  if (!validation.valid) {
    throw new TypeError(`m7-session:audit-invalid:${validation.errors.join(',')}`);
  }
  return Object.freeze(value);
}

export function validateM7SessionAuditRecord(value) {
  const keys = [
    'action', 'actorId', 'contract', 'detailsDigest', 'deviceId', 'outcome',
    'pairingRevision', 'reasonCode', 'recordedAtMs', 'sessionId',
    'sessionRevision', 'subjectId', 'version',
  ];
  const errors = [];
  if (!exactKeys(value, keys)) return { valid: false, errors: ['audit:shape'] };
  if (value.contract !== 'M7RemoteSessionAuditEvent' || value.version !== 1) {
    errors.push('audit:identity');
  }
  if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(value.action || '')) errors.push('audit:action');
  if (!['ALLOWED', 'DENIED'].includes(value.outcome)) errors.push('audit:outcome');
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.detailsDigest || '')) errors.push('audit:detailsDigest');
  if (!Number.isSafeInteger(value.recordedAtMs) || value.recordedAtMs < 1) {
    errors.push('audit:recordedAtMs');
  }
  for (const field of [
    'actorId', 'deviceId', 'pairingRevision', 'sessionId', 'sessionRevision', 'subjectId',
  ]) {
    if (value[field] !== null
      && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value[field])) {
      errors.push(`audit:${field}`);
    }
  }
  if (value.reasonCode !== null
    && !/^[A-Z][A-Z0-9_:-]{0,95}$/u.test(value.reasonCode)) errors.push('audit:reasonCode');
  return { valid: errors.length === 0, errors };
}

export function encodeM7SessionAuditRecord(value) {
  const validation = validateM7SessionAuditRecord(value);
  if (!validation.valid) throw new TypeError('m7-session:audit-invalid');
  return Buffer.from(canonicalizeM7SessionValue(value), 'utf8');
}

export function parseM7SessionAuditRecord(raw) {
  if (!Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) {
    throw new TypeError('m7-session:audit-bytes-required');
  }
  const text = utf8Decoder.decode(raw);
  const value = JSON.parse(text);
  const validation = validateM7SessionAuditRecord(value);
  if (!validation.valid || canonicalizeM7SessionValue(value) !== text) {
    throw new TypeError('m7-session:audit-invalid');
  }
  return Object.freeze(structuredClone(value));
}

export function registerM7SessionAuthorityFunctions(db) {
  db.function('m7_remote_session_audit_valid_v1', { deterministic: true }, raw => {
    try {
      parseM7SessionAuditRecord(raw);
      return 1;
    } catch {
      return 0;
    }
  });
}
