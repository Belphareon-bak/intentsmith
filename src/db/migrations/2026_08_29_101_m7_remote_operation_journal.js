import { createHash } from 'node:crypto';

import { registerM7OperationJournalFunctions } from '../../remote/m7-operation-journal-validation.js';

export const version = '2026_08_29_101_m7_remote_operation_journal';
export const description = 'Add append-only M7 remote mutation operation journal';

export const EXPECTED_M7_REMOTE_OPERATION_JOURNAL_FINGERPRINT_V101 =
  '16e957aacb0a48b6ef6b412fb10dbe30674695c57fc00ca2391f9cbdc0f0086c';

const OBJECT_NAMES = Object.freeze([
  'm7_remote_operation_events',
  'idx_m7_remote_operation_identity',
  'trg_m7_remote_operation_event_exact',
  'trg_m7_remote_operation_event_causal',
  'trg_m7_remote_operation_event_no_update',
  'trg_m7_remote_operation_event_no_delete',
]);

export function computeM7RemoteOperationJournalFingerprintV101(db) {
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
    CREATE TABLE m7_remote_operation_events (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
      operation_type TEXT NOT NULL CHECK (length(operation_type) BETWEEN 1 AND 128),
      request_digest TEXT NOT NULL CHECK (
        length(request_digest) = 71
        AND substr(request_digest, 1, 7) = 'sha256:'
        AND substr(request_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      sequence INTEGER NOT NULL CHECK (sequence IN (0, 1)),
      state TEXT NOT NULL CHECK (
        state IN ('STARTED', 'CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN')
      ),
      result_digest TEXT CHECK (
        result_digest IS NULL OR (
          length(result_digest) = 71
          AND substr(result_digest, 1, 7) = 'sha256:'
          AND substr(result_digest, 8) NOT GLOB '*[^a-f0-9]*'
        )
      ),
      error_code TEXT CHECK (
        error_code IS NULL OR length(error_code) BETWEEN 1 AND 96
      ),
      recorded_at_ms INTEGER NOT NULL CHECK (
        typeof(recorded_at_ms) = 'integer' AND recorded_at_ms > 0
      ),
      record_json BLOB NOT NULL UNIQUE CHECK (
        typeof(record_json) = 'blob' AND length(record_json) BETWEEN 1 AND 1048576
      ),
      UNIQUE (device_id, subject_id, operation_id, sequence)
    );

    CREATE INDEX idx_m7_remote_operation_identity
      ON m7_remote_operation_events(
        device_id, subject_id, operation_id, sequence, revision
      );

    CREATE TRIGGER trg_m7_remote_operation_event_exact
    BEFORE INSERT ON m7_remote_operation_events
    WHEN m7_remote_operation_event_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.deviceId') IS NOT NEW.device_id
      OR json_extract(NEW.record_json, '$.subjectId') IS NOT NEW.subject_id
      OR json_extract(NEW.record_json, '$.operationId') IS NOT NEW.operation_id
      OR json_extract(NEW.record_json, '$.operationType') IS NOT NEW.operation_type
      OR json_extract(NEW.record_json, '$.requestDigest') IS NOT NEW.request_digest
      OR json_extract(NEW.record_json, '$.sequence') IS NOT NEW.sequence
      OR json_extract(NEW.record_json, '$.state') IS NOT NEW.state
      OR json_extract(NEW.record_json, '$.resultDigest') IS NOT NEW.result_digest
      OR json_extract(NEW.record_json, '$.errorCode') IS NOT NEW.error_code
      OR json_extract(NEW.record_json, '$.recordedAtMs') IS NOT NEW.recorded_at_ms
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_OPERATION_EVENT_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m7_remote_operation_event_causal
    BEFORE INSERT ON m7_remote_operation_events
    WHEN NOT (
      (
        NEW.sequence = 0
        AND NEW.state = 'STARTED'
        AND NOT EXISTS (
          SELECT 1 FROM m7_remote_operation_events current
          WHERE current.device_id = NEW.device_id
            AND current.subject_id = NEW.subject_id
            AND current.operation_id = NEW.operation_id
        )
      )
      OR (
        NEW.sequence = 1
        AND NEW.state IN ('CONFIRMED', 'REJECTED', 'PENDING', 'UNKNOWN')
        AND EXISTS (
          SELECT 1 FROM m7_remote_operation_events intent
          WHERE intent.device_id = NEW.device_id
            AND intent.subject_id = NEW.subject_id
            AND intent.operation_id = NEW.operation_id
            AND intent.sequence = 0
            AND intent.state = 'STARTED'
            AND intent.operation_type = NEW.operation_type
            AND intent.request_digest = NEW.request_digest
        )
        AND NOT EXISTS (
          SELECT 1 FROM m7_remote_operation_events outcome
          WHERE outcome.device_id = NEW.device_id
            AND outcome.subject_id = NEW.subject_id
            AND outcome.operation_id = NEW.operation_id
            AND outcome.sequence = 1
        )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M7_REMOTE_OPERATION_EVENT_CAUSAL_MISMATCH');
    END;

    CREATE TRIGGER trg_m7_remote_operation_event_no_update
    BEFORE UPDATE ON m7_remote_operation_events
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_operation_events is append-only');
    END;

    CREATE TRIGGER trg_m7_remote_operation_event_no_delete
    BEFORE DELETE ON m7_remote_operation_events
    BEGIN
      SELECT RAISE(ABORT, 'm7_remote_operation_events is append-only');
    END;
  `);
}

export function up(db) {
  registerM7OperationJournalFunctions(db);
  const current = computeM7RemoteOperationJournalFingerprintV101(db);
  if (current === EXPECTED_M7_REMOTE_OPERATION_JOURNAL_FINGERPRINT_V101) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_REMOTE_OPERATION_JOURNAL_101_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7RemoteOperationJournalFingerprintV101(db);
  if (installed !== EXPECTED_M7_REMOTE_OPERATION_JOURNAL_FINGERPRINT_V101) {
    throw new Error(`M7_REMOTE_OPERATION_JOURNAL_101_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
