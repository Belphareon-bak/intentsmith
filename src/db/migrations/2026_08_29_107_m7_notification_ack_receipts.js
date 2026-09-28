import { createHash } from 'node:crypto';

import { registerM7NotificationReceiptFunctions } from '../../remote/m7-notification-receipt-validation.js';

export const version = '2026_08_29_107_m7_notification_ack_receipts';
export const description = 'Add append-only per-device M7 notification acknowledgement receipts';

export const EXPECTED_M7_NOTIFICATION_ACK_RECEIPT_FINGERPRINT_V107 =
  'cfff2121f2a0396d430d0414d084497a5c59c8bb74f78080cf8fbe32b6040db6';

const OBJECT_NAMES = Object.freeze([
  'm7_remote_notification_ack_receipts',
  'idx_m7_remote_notification_ack_list',
  'trg_m7_remote_notification_ack_exact',
  'trg_m7_remote_notification_ack_authority',
  'trg_m7_remote_notification_ack_no_update',
  'trg_m7_remote_notification_ack_no_delete',
]);

export function computeM7NotificationAckReceiptFingerprintV107(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/gu, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function install(db) {
  db.exec(`
    CREATE TABLE m7_remote_notification_ack_receipts (
      receipt_revision INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      notification_id TEXT NOT NULL CHECK (length(notification_id) BETWEEN 1 AND 128),
      notification_sequence INTEGER NOT NULL CHECK (
        typeof(notification_sequence) = 'integer' AND notification_sequence > 0
      ),
      source_revision TEXT NOT NULL CHECK (
        length(source_revision) = 71
        AND substr(source_revision, 1, 7) = 'sha256:'
        AND substr(source_revision, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
      source_operation_revision INTEGER NOT NULL CHECK (
        typeof(source_operation_revision) = 'integer' AND source_operation_revision > 0
      ),
      request_digest TEXT NOT NULL CHECK (
        length(request_digest) = 71
        AND substr(request_digest, 1, 7) = 'sha256:'
        AND substr(request_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      observed_through_seq INTEGER NOT NULL CHECK (
        typeof(observed_through_seq) = 'integer'
        AND observed_through_seq >= notification_sequence
      ),
      recorded_at_ms INTEGER NOT NULL CHECK (
        typeof(recorded_at_ms) = 'integer' AND recorded_at_ms > 0
      ),
      record_json BLOB NOT NULL UNIQUE CHECK (
        typeof(record_json) = 'blob' AND length(record_json) BETWEEN 1 AND 65536
      ),
      UNIQUE(device_id, subject_id, notification_id)
    );

    CREATE INDEX idx_m7_remote_notification_ack_list
      ON m7_remote_notification_ack_receipts(
        device_id, subject_id, notification_sequence, notification_id
      );

    CREATE TRIGGER trg_m7_remote_notification_ack_exact
    BEFORE INSERT ON m7_remote_notification_ack_receipts
    WHEN m7_remote_notification_ack_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.deviceId') IS NOT NEW.device_id
      OR json_extract(NEW.record_json, '$.subjectId') IS NOT NEW.subject_id
      OR json_extract(NEW.record_json, '$.notificationId') IS NOT NEW.notification_id
      OR json_extract(NEW.record_json, '$.notificationSequence') IS NOT NEW.notification_sequence
      OR json_extract(NEW.record_json, '$.sourceRevision') IS NOT NEW.source_revision
      OR json_extract(NEW.record_json, '$.operationId') IS NOT NEW.operation_id
      OR json_extract(NEW.record_json, '$.requestDigest') IS NOT NEW.request_digest
      OR json_extract(NEW.record_json, '$.observedThroughSeq') IS NOT NEW.observed_through_seq
      OR json_extract(NEW.record_json, '$.recordedAtMs') IS NOT NEW.recorded_at_ms
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_NOTIFICATION_ACK_EXACT_MISMATCH');
    END;

    CREATE TRIGGER trg_m7_remote_notification_ack_authority
    BEFORE INSERT ON m7_remote_notification_ack_receipts
    WHEN NOT EXISTS (
      SELECT 1 FROM m7_remote_operation_events source
      WHERE source.revision = NEW.source_operation_revision
        AND source.device_id = NEW.device_id
        AND source.subject_id = NEW.subject_id
        AND source.operation_id = NEW.operation_id
        AND source.operation_type = 'notification.ack'
        AND source.request_digest = NEW.request_digest
        AND source.sequence = 0
        AND source.state = 'STARTED'
        AND source.recorded_at_ms <= NEW.recorded_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_NOTIFICATION_ACK_AUTHORITY_MISSING');
    END;

    CREATE TRIGGER trg_m7_remote_notification_ack_no_update
    BEFORE UPDATE ON m7_remote_notification_ack_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_notification_ack_receipts is append-only');
    END;

    CREATE TRIGGER trg_m7_remote_notification_ack_no_delete
    BEFORE DELETE ON m7_remote_notification_ack_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_notification_ack_receipts is append-only');
    END;
  `);
}

export function up(db) {
  registerM7NotificationReceiptFunctions(db);
  const current = computeM7NotificationAckReceiptFingerprintV107(db);
  if (current === EXPECTED_M7_NOTIFICATION_ACK_RECEIPT_FINGERPRINT_V107) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_NOTIFICATION_ACK_RECEIPT_107_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7NotificationAckReceiptFingerprintV107(db);
  if (installed !== EXPECTED_M7_NOTIFICATION_ACK_RECEIPT_FINGERPRINT_V107) {
    throw new Error(`M7_NOTIFICATION_ACK_RECEIPT_107_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
