import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';

export const M7_CORE_CURSOR_ERROR = Object.freeze({
  INVALID: 'M7_CORE_CURSOR_INVALID',
  STALE: 'M7_CORE_CURSOR_STALE',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CURSOR_PATTERN = /^m7c1:([A-Za-z0-9_-]+):([0-9a-f]{64})$/u;
const CURSOR_KEYS = Object.freeze([
  'capabilityId',
  'capabilityVersion',
  'contract',
  'deviceId',
  'filterDigest',
  'offset',
  'operationId',
  'snapshotRevision',
  'subjectId',
  'version',
]);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const DOMAIN = Buffer.from('IntentSmith:M7CoreCursor@1\0', 'utf8');

export class M7CoreCursorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'M7CoreCursorError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7CoreCursorError(code, message);
}

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

function requireKey(value) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.byteLength < 32) {
    throw new TypeError('m7-core-cursor:key-must-have-at-least-32-bytes');
  }
  return Buffer.from(value);
}

function requireIdentifier(value, field) {
  if (!IDENTIFIER.test(value || '')) fail(
    M7_CORE_CURSOR_ERROR.INVALID,
    `m7-core-cursor:invalid-${field}`,
  );
  return value;
}

function validatePayload(value) {
  if (!exactKeys(value, CURSOR_KEYS)
    || value.contract !== 'M7CoreCursor'
    || value.version !== 1
    || !Number.isSafeInteger(value.capabilityVersion)
    || value.capabilityVersion < 1
    || !Number.isSafeInteger(value.offset)
    || value.offset < 0
    || !DIGEST.test(value.filterDigest || '')) {
    fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:payload-invalid');
  }
  for (const field of [
    'capabilityId', 'deviceId', 'operationId', 'snapshotRevision', 'subjectId',
  ]) requireIdentifier(value[field], field);
  return value;
}

function mac(key, bytes) {
  return createHmac('sha256', key).update(DOMAIN).update(bytes).digest();
}

export function computeM7CoreCursorFilterDigest(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeM2ExecutionValue(value), 'utf8')
    .digest('hex')}`;
}

export function createM7CoreCursorCodec({ key } = {}) {
  const secret = requireKey(key);
  return Object.freeze({
    encode(input) {
      const payload = validatePayload({
        contract: 'M7CoreCursor',
        version: 1,
        capabilityId: input?.capabilityId,
        capabilityVersion: input?.capabilityVersion,
        operationId: input?.operationId,
        deviceId: input?.deviceId,
        subjectId: input?.subjectId,
        filterDigest: input?.filterDigest,
        snapshotRevision: input?.snapshotRevision,
        offset: input?.offset,
      });
      const bytes = Buffer.from(canonicalizeM2ExecutionValue(payload), 'utf8');
      const cursor = `m7c1:${bytes.toString('base64url')}:${mac(secret, bytes).toString('hex')}`;
      if (Buffer.byteLength(cursor, 'utf8') > 2048) {
        fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:encoded-value-too-large');
      }
      return cursor;
    },

    decode(cursor, expected = {}) {
      if (typeof cursor !== 'string' || Buffer.byteLength(cursor, 'utf8') > 2048) {
        fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:format-invalid');
      }
      const match = cursor.match(CURSOR_PATTERN);
      if (!match) fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:format-invalid');
      const bytes = Buffer.from(match[1], 'base64url');
      if (bytes.length === 0 || bytes.toString('base64url') !== match[1]) {
        fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:encoding-noncanonical');
      }
      const suppliedMac = Buffer.from(match[2], 'hex');
      const expectedMac = mac(secret, bytes);
      if (suppliedMac.length !== expectedMac.length || !timingSafeEqual(suppliedMac, expectedMac)) {
        fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:authentication-failed');
      }
      let text;
      let payload;
      try {
        text = utf8.decode(bytes);
        payload = JSON.parse(text);
      } catch {
        fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:payload-unreadable');
      }
      validatePayload(payload);
      if (canonicalizeM2ExecutionValue(payload) !== text) {
        fail(M7_CORE_CURSOR_ERROR.INVALID, 'm7-core-cursor:payload-noncanonical');
      }
      for (const field of [
        'capabilityId', 'capabilityVersion', 'operationId', 'deviceId', 'subjectId',
        'filterDigest',
      ]) {
        if (Object.hasOwn(expected, field) && payload[field] !== expected[field]) {
          fail(M7_CORE_CURSOR_ERROR.INVALID, `m7-core-cursor:boundary-${field}`);
        }
      }
      if (Object.hasOwn(expected, 'snapshotRevision')
        && payload.snapshotRevision !== expected.snapshotRevision) {
        fail(M7_CORE_CURSOR_ERROR.STALE, 'm7-core-cursor:snapshot-stale');
      }
      return Object.freeze(structuredClone(payload));
    },
  });
}

export default createM7CoreCursorCodec;
