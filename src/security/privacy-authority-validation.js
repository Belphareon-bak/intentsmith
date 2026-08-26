import {
  canonicalizeM5PrivacyValue,
  validateM5PrivacyHistoryReceipt,
  validateM5PrivacyRotationReceipt,
} from '../../contracts/m5/privacy-remediation-v1.js';
import { inspectM5UserSettingsPrivacy } from './user-settings-privacy.js';
import { isAuthenticatedTransportSubject } from './global-auth-policy.js';

const DATABASE_WRITER_STATE = new WeakMap();

function databaseWriterState(database) {
  let state = DATABASE_WRITER_STATE.get(database);
  if (!state) {
    state = { active: null };
    DATABASE_WRITER_STATE.set(database, state);
  }
  return state;
}

export function withM5PrivacyReceiptWriterAuthority(
  database,
  authenticatedSubject,
  { receiptId, recordJson },
  operation,
) {
  if (!isAuthenticatedTransportSubject(authenticatedSubject)) {
    throw new TypeError('m5-privacy-authority:authenticated-transport-subject-required');
  }
  if (typeof receiptId !== 'string' || typeof recordJson !== 'string') {
    throw new TypeError('m5-privacy-authority:writer-identity-invalid');
  }
  let recordActorId;
  try {
    const record = JSON.parse(recordJson);
    recordActorId = record?.actor?.actorId;
  } catch {
    throw new TypeError('m5-privacy-authority:writer-identity-invalid');
  }
  if (recordActorId !== authenticatedSubject.actorId) {
    throw new TypeError('m5-privacy-authority:writer-subject-mismatch');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('m5-privacy-authority:writer-operation-required');
  }
  const state = databaseWriterState(database);
  if (state.active !== null) {
    throw new TypeError('m5-privacy-authority:writer-already-active');
  }
  const active = {
    receiptId,
    recordJson,
    actorId: authenticatedSubject.actorId,
    consumed: false,
  };
  state.active = active;
  try {
    const result = operation();
    if (active.consumed !== true) {
      throw new TypeError('m5-privacy-authority:writer-not-consumed');
    }
    return result;
  } finally {
    state.active = null;
  }
}

function validCanonical(raw, validator) {
  if (typeof raw !== 'string') return 0;
  try {
    const value = JSON.parse(raw);
    const result = validator(value);
    return result.valid && canonicalizeM5PrivacyValue(value) === raw ? 1 : 0;
  } catch {
    return 0;
  }
}

export function registerM5PrivacyAuthorityFunctions(database) {
  if (!database || typeof database.function !== 'function') {
    throw new TypeError('m5-privacy-authority:database-required');
  }
  database.function('m5_privacy_rotation_receipt_valid_v1', {
    deterministic: true,
  }, raw => validCanonical(raw, validateM5PrivacyRotationReceipt));
  database.function('m5_privacy_history_receipt_valid_v1', {
    deterministic: true,
  }, raw => validCanonical(raw, validateM5PrivacyHistoryReceipt));
  database.function('m5_privacy_user_settings_valid_v1', {
    deterministic: true,
  }, raw => {
    if (typeof raw !== 'string') return 0;
    try {
      return inspectM5UserSettingsPrivacy(JSON.parse(raw)).valid ? 1 : 0;
    } catch {
      return 0;
    }
  });
  const writerState = databaseWriterState(database);
  database.function('m5_privacy_receipt_writer_authorized_v1', (
    receiptId,
    recordJson,
  ) => {
    const active = writerState.active;
    if (
      active === null
      || active.consumed === true
      || receiptId !== active.receiptId
      || recordJson !== active.recordJson
    ) return 0;
    active.consumed = true;
    return 1;
  });
}
