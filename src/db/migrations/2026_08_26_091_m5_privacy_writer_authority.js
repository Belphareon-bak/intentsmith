import { createHash } from 'node:crypto';

import {
  registerM5PrivacyAuthorityFunctions,
} from '../../security/privacy-authority-validation.js';
import {
  EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090,
  computeM5PrivacyAuthorityFingerprintV090,
} from './2026_08_26_090_m5_privacy_authority.js';

export const version = '2026_08_26_091_m5_privacy_writer_authority';
export const description = 'Require an opaque transport writer capability for M5 privacy receipts';

export const EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091 =
  'acf8783a81805e49e493f351e9fd6efc1a64ddb7423045202481335f3a664603';

const OBJECT_NAMES = Object.freeze([
  'm5_privacy_history_receipts',
  'm5_privacy_rotation_receipts',
  'idx_m5_privacy_rotation_incident_time',
  'trg_m5_privacy_history_append_only_delete',
  'trg_m5_privacy_history_append_only_update',
  'trg_m5_privacy_history_exact',
  'trg_m5_privacy_rotation_append_only_delete',
  'trg_m5_privacy_rotation_append_only_update',
  'trg_m5_privacy_rotation_exact',
  'trg_m5_user_settings_no_plaintext_credentials_insert',
  'trg_m5_user_settings_no_plaintext_credentials_update',
]);

export function computeM5PrivacyWriterAuthorityFingerprintV091(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function installWriterAuthority(db) {
  db.exec(`
    DROP TRIGGER trg_m5_privacy_rotation_exact;
    DROP TRIGGER trg_m5_privacy_history_exact;

    CREATE TRIGGER trg_m5_privacy_rotation_exact
    BEFORE INSERT ON m5_privacy_rotation_receipts
    WHEN m5_privacy_receipt_writer_authorized_v1(
        NEW.receipt_id, NEW.record_json
      ) != 1
      OR m5_privacy_rotation_receipt_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.receiptId') IS NOT NEW.receipt_id
      OR json_extract(NEW.record_json, '$.incidentId') IS NOT NEW.incident_id
      OR json_extract(NEW.record_json, '$.categoryId') IS NOT NEW.category_id
      OR json_extract(NEW.record_json, '$.completedAtMs') IS NOT NEW.completed_at_ms
      OR json_extract(NEW.record_json, '$.attestedAtMs') IS NOT NEW.attested_at_ms
      OR json_extract(NEW.record_json, '$.actor.actorId') IS NOT NEW.actor_id
      OR json_extract(NEW.record_json, '$.secretValuesRecorded') IS NOT 0
    BEGIN
      SELECT RAISE(ABORT, 'M5_PRIVACY_ROTATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m5_privacy_history_exact
    BEFORE INSERT ON m5_privacy_history_receipts
    WHEN m5_privacy_receipt_writer_authorized_v1(
        NEW.receipt_id, NEW.record_json
      ) != 1
      OR m5_privacy_history_receipt_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.receiptId') IS NOT NEW.receipt_id
      OR json_extract(NEW.record_json, '$.incidentId') IS NOT NEW.incident_id
      OR json_extract(NEW.record_json, '$.decision') IS NOT NEW.decision
      OR json_extract(NEW.record_json, '$.actionStatus') IS NOT NEW.action_status
      OR json_extract(NEW.record_json, '$.repositoryVisibility')
        IS NOT NEW.repository_visibility
      OR json_extract(NEW.record_json, '$.completedAtMs') IS NOT NEW.completed_at_ms
      OR json_extract(NEW.record_json, '$.attestedAtMs') IS NOT NEW.attested_at_ms
      OR json_extract(NEW.record_json, '$.actor.actorId') IS NOT NEW.actor_id
      OR json_extract(NEW.record_json, '$.operatorAuthorityConfirmed') IS NOT 1
      OR json_extract(NEW.record_json, '$.secretValuesRecorded') IS NOT 0
    BEGIN
      SELECT RAISE(ABORT, 'M5_PRIVACY_HISTORY_AUTHORITY_MISMATCH');
    END;
  `);
}

export function up(db) {
  registerM5PrivacyAuthorityFunctions(db);
  const current = computeM5PrivacyWriterAuthorityFingerprintV091(db);
  if (current === EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091) return;
  if (computeM5PrivacyAuthorityFingerprintV090(db)
      !== EXPECTED_M5_PRIVACY_AUTHORITY_FINGERPRINT_V090) {
    throw new Error('M5_PRIVACY_WRITER_AUTHORITY_091_SOURCE_OBJECT_MISMATCH');
  }
  installWriterAuthority(db);
  const installed = computeM5PrivacyWriterAuthorityFingerprintV091(db);
  if (installed !== EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091) {
    throw new Error(`M5_PRIVACY_WRITER_AUTHORITY_091_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
