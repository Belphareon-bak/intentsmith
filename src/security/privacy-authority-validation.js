import {
  canonicalizeM5PrivacyValue,
  validateM5PrivacyHistoryReceipt,
  validateM5PrivacyRotationReceipt,
} from '../../contracts/m5/privacy-remediation-v1.js';
import { inspectM5UserSettingsPrivacy } from './user-settings-privacy.js';

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
}
