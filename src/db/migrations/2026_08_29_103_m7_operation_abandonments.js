import { createHash } from 'node:crypto';

import { registerM7OperationJournalFunctions } from '../../remote/m7-operation-journal-validation.js';

export const version = '2026_08_29_103_m7_operation_abandonments';
export const description = 'Add append-only M7 operation abandonment receipts';

export const EXPECTED_M7_OPERATION_ABANDONMENT_FINGERPRINT_V103 =
  '814763741b2bca3350fd39312d406795f037da5228ba2c549e5835d24afedfc6';

const OBJECT_NAMES = Object.freeze([
  'm7_remote_operation_abandonments',
  'idx_m7_remote_operation_abandonment_source',
  'trg_m7_remote_operation_abandonment_exact',
  'trg_m7_remote_operation_abandonment_authority',
  'trg_m7_remote_operation_abandonment_no_update',
  'trg_m7_remote_operation_abandonment_no_delete',
]);

export function computeM7OperationAbandonmentFingerprintV103(db) {
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
    CREATE TABLE m7_remote_operation_abandonments (
      abandonment_revision INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      target_operation_id TEXT NOT NULL CHECK (
        length(target_operation_id) BETWEEN 1 AND 128
      ),
      source_operation_id TEXT NOT NULL CHECK (
        length(source_operation_id) BETWEEN 1 AND 128
        AND source_operation_id != target_operation_id
      ),
      source_request_digest TEXT NOT NULL CHECK (
        length(source_request_digest) = 71
        AND substr(source_request_digest, 1, 7) = 'sha256:'
        AND substr(source_request_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      target_event_revision INTEGER NOT NULL CHECK (
        typeof(target_event_revision) = 'integer' AND target_event_revision > 0
      ),
      target_request_digest TEXT NOT NULL CHECK (
        length(target_request_digest) = 71
        AND substr(target_request_digest, 1, 7) = 'sha256:'
        AND substr(target_request_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      recorded_at_ms INTEGER NOT NULL CHECK (
        typeof(recorded_at_ms) = 'integer' AND recorded_at_ms > 0
      ),
      record_json BLOB NOT NULL UNIQUE CHECK (
        typeof(record_json) = 'blob' AND length(record_json) BETWEEN 1 AND 65536
      ),
      UNIQUE(device_id, subject_id, target_operation_id),
      UNIQUE(device_id, subject_id, source_operation_id)
    );

    CREATE INDEX idx_m7_remote_operation_abandonment_source
      ON m7_remote_operation_abandonments(
        device_id, subject_id, source_operation_id, abandonment_revision
      );

    CREATE TRIGGER trg_m7_remote_operation_abandonment_exact
    BEFORE INSERT ON m7_remote_operation_abandonments
    WHEN m7_remote_operation_abandonment_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.deviceId') IS NOT NEW.device_id
      OR json_extract(NEW.record_json, '$.subjectId') IS NOT NEW.subject_id
      OR json_extract(NEW.record_json, '$.targetOperationId') IS NOT NEW.target_operation_id
      OR json_extract(NEW.record_json, '$.sourceOperationId') IS NOT NEW.source_operation_id
      OR json_extract(NEW.record_json, '$.sourceRequestDigest') IS NOT NEW.source_request_digest
      OR json_extract(NEW.record_json, '$.targetEventRevision') IS NOT NEW.target_event_revision
      OR json_extract(NEW.record_json, '$.targetRequestDigest') IS NOT NEW.target_request_digest
      OR json_extract(NEW.record_json, '$.recordedAtMs') IS NOT NEW.recorded_at_ms
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_OPERATION_ABANDONMENT_EXACT_MISMATCH');
    END;

    CREATE TRIGGER trg_m7_remote_operation_abandonment_authority
    BEFORE INSERT ON m7_remote_operation_abandonments
    WHEN NOT EXISTS (
      SELECT 1 FROM m7_remote_operation_events source
      WHERE source.device_id = NEW.device_id
        AND source.subject_id = NEW.subject_id
        AND source.operation_id = NEW.source_operation_id
        AND source.operation_type = 'operation.abandon'
        AND source.request_digest = NEW.source_request_digest
        AND source.sequence = 0
        AND source.state = 'STARTED'
    ) OR NOT EXISTS (
      SELECT 1 FROM m7_remote_operation_events target
      WHERE target.revision = NEW.target_event_revision
        AND target.device_id = NEW.device_id
        AND target.subject_id = NEW.subject_id
        AND target.operation_id = NEW.target_operation_id
        AND target.request_digest = NEW.target_request_digest
        AND target.state IN ('STARTED', 'PENDING', 'UNKNOWN')
        AND target.recorded_at_ms <= NEW.recorded_at_ms
        AND NOT EXISTS (
          SELECT 1 FROM m7_remote_operation_events later
          WHERE later.device_id = target.device_id
            AND later.subject_id = target.subject_id
            AND later.operation_id = target.operation_id
            AND later.revision > target.revision
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_OPERATION_ABANDONMENT_AUTHORITY_MISSING');
    END;

    CREATE TRIGGER trg_m7_remote_operation_abandonment_no_update
    BEFORE UPDATE ON m7_remote_operation_abandonments
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_operation_abandonments is append-only');
    END;

    CREATE TRIGGER trg_m7_remote_operation_abandonment_no_delete
    BEFORE DELETE ON m7_remote_operation_abandonments
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_operation_abandonments is append-only');
    END;
  `);
}

export function up(db) {
  registerM7OperationJournalFunctions(db);
  const current = computeM7OperationAbandonmentFingerprintV103(db);
  if (current === EXPECTED_M7_OPERATION_ABANDONMENT_FINGERPRINT_V103) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_OPERATION_ABANDONMENT_103_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7OperationAbandonmentFingerprintV103(db);
  if (installed !== EXPECTED_M7_OPERATION_ABANDONMENT_FINGERPRINT_V103) {
    throw new Error(`M7_OPERATION_ABANDONMENT_103_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
