import { canonicalizeM2ExecutionValue } from '../../contracts/m2/execution-v1.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const decoder = new TextDecoder('utf-8', { fatal: true });

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
}

export function validateM7NotificationReceiptRecord(value) {
  const keys = [
    'contract', 'deviceId', 'notificationId', 'notificationSequence', 'observedThroughSeq',
    'operationId', 'recordedAtMs', 'requestDigest', 'sourceRevision', 'subjectId', 'version',
  ];
  if (!exactKeys(value, keys)
    || value.contract !== 'M7NotificationAckReceipt'
    || value.version !== 1
    || !IDENTIFIER.test(value.deviceId || '')
    || !IDENTIFIER.test(value.subjectId || '')
    || !IDENTIFIER.test(value.notificationId || '')
    || !IDENTIFIER.test(value.operationId || '')
    || !DIGEST.test(value.requestDigest || '')
    || !DIGEST.test(value.sourceRevision || '')
    || !Number.isSafeInteger(value.notificationSequence)
    || value.notificationSequence < 1
    || !Number.isSafeInteger(value.observedThroughSeq)
    || value.observedThroughSeq < value.notificationSequence
    || !Number.isSafeInteger(value.recordedAtMs)
    || value.recordedAtMs < 1) {
    return false;
  }
  return true;
}

export function encodeM7NotificationReceiptRecord(value) {
  if (!validateM7NotificationReceiptRecord(value)) {
    throw new TypeError('m7-notification-receipt:record-invalid');
  }
  return Buffer.from(canonicalizeM2ExecutionValue(value), 'utf8');
}

export function validateM7NotificationReceiptBytes(raw) {
  if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > 65_536) return false;
  let text;
  let value;
  try {
    text = decoder.decode(raw);
    value = JSON.parse(text);
  } catch {
    return false;
  }
  return validateM7NotificationReceiptRecord(value)
    && Buffer.from(canonicalizeM2ExecutionValue(value), 'utf8').equals(raw);
}

export function registerM7NotificationReceiptFunctions(db) {
  db.function('m7_remote_notification_ack_valid_v1', { deterministic: true }, raw => (
    validateM7NotificationReceiptBytes(raw) ? 1 : 0
  ));
}

