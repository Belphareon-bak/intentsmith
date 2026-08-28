import { createHash } from 'node:crypto';

import { registerSignedAuthorityStorageFunctions } from '../../security/signed-authority-storage-validation.js';
import {
  EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091,
  computeM5PrivacyWriterAuthorityFingerprintV091,
} from './2026_08_26_091_m5_privacy_writer_authority.js';

export const version = '2026_08_28_100_signed_privacy_receipts';
export const description = 'Store offline-signed M5 privacy receipts as untrusted raw envelopes';

export const EXPECTED_SIGNED_PRIVACY_RECEIPTS_FINGERPRINT_V100 =
  'd7ea671ef1c41074f2e4110493695b5c3cddb1f2f92d4f299fcd105dd54af8d7';

const OBJECT_NAMES = Object.freeze([
  'm5_signed_privacy_receipts',
  'idx_m5_signed_privacy_receipts_domain_time',
  'trg_m5_signed_privacy_receipts_append_only_delete',
  'trg_m5_signed_privacy_receipts_append_only_update',
  'trg_m5_signed_privacy_receipts_exact',
]);

export function computeSignedPrivacyReceiptsFingerprintV100(db) {
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

function install(db) {
  db.exec(`
    CREATE TABLE m5_signed_privacy_receipts (
      receipt_id TEXT PRIMARY KEY CHECK (
        length(receipt_id) = 69 AND substr(receipt_id, 1, 5) = 'sar1:'
      ),
      domain TEXT NOT NULL CHECK (domain IN (
        'intentsmith.m5.privacy.rotation.v1',
        'intentsmith.m5.privacy.history.v1'
      )),
      authority_id TEXT NOT NULL CHECK (authority_id = 'm5-privacy-operator'),
      issued_at_ms INTEGER NOT NULL CHECK (
        typeof(issued_at_ms) = 'integer' AND issued_at_ms > 0
      ),
      nonce TEXT NOT NULL CHECK (length(nonce) BETWEEN 22 AND 64),
      previous_receipt_id TEXT CHECK (
        previous_receipt_id IS NULL OR (
          length(previous_receipt_id) = 69
          AND substr(previous_receipt_id, 1, 5) = 'sar1:'
        )
      ),
      record_json TEXT NOT NULL UNIQUE CHECK (json_valid(record_json)),
      UNIQUE (authority_id, nonce)
    );

    CREATE INDEX idx_m5_signed_privacy_receipts_domain_time
      ON m5_signed_privacy_receipts(domain, issued_at_ms, receipt_id);

    CREATE TRIGGER trg_m5_signed_privacy_receipts_exact
    BEFORE INSERT ON m5_signed_privacy_receipts
    WHEN signed_authority_receipt_shape_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.receiptId') IS NOT NEW.receipt_id
      OR json_extract(NEW.record_json, '$.domain') IS NOT NEW.domain
      OR json_extract(NEW.record_json, '$.authorityId') IS NOT NEW.authority_id
      OR json_extract(NEW.record_json, '$.issuedAtMs') IS NOT NEW.issued_at_ms
      OR json_extract(NEW.record_json, '$.nonce') IS NOT NEW.nonce
      OR json_extract(NEW.record_json, '$.previousReceiptId') IS NOT NEW.previous_receipt_id
    BEGIN
      SELECT RAISE(ABORT, 'M5_SIGNED_PRIVACY_RECEIPT_SHAPE_MISMATCH');
    END;

    CREATE TRIGGER trg_m5_signed_privacy_receipts_append_only_update
    BEFORE UPDATE ON m5_signed_privacy_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm5_signed_privacy_receipts is append-only');
    END;

    CREATE TRIGGER trg_m5_signed_privacy_receipts_append_only_delete
    BEFORE DELETE ON m5_signed_privacy_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm5_signed_privacy_receipts is append-only');
    END;
  `);
}

export function up(db) {
  registerSignedAuthorityStorageFunctions(db);
  const current = computeSignedPrivacyReceiptsFingerprintV100(db);
  if (current === EXPECTED_SIGNED_PRIVACY_RECEIPTS_FINGERPRINT_V100) return;
  if (computeM5PrivacyWriterAuthorityFingerprintV091(db)
      !== EXPECTED_M5_PRIVACY_WRITER_AUTHORITY_FINGERPRINT_V091) {
    throw new Error('SIGNED_PRIVACY_RECEIPTS_100_SOURCE_OBJECT_MISMATCH');
  }
  install(db);
  const installed = computeSignedPrivacyReceiptsFingerprintV100(db);
  if (installed !== EXPECTED_SIGNED_PRIVACY_RECEIPTS_FINGERPRINT_V100) {
    throw new Error(`SIGNED_PRIVACY_RECEIPTS_100_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
