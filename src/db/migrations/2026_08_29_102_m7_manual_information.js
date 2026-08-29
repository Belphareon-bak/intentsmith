import { createHash } from 'node:crypto';

export const version = '2026_08_29_102_m7_manual_information';
export const description = 'Add append-only subject-scoped M7 manual information';

export const EXPECTED_M7_MANUAL_INFORMATION_FINGERPRINT_V102 =
  '592ea30b5f09e33fc96e68cbeeb9348cf88c782e4e3066876f17b1fe6607b1fd';

const OBJECT_NAMES = Object.freeze([
  'm7_manual_information',
  'idx_m7_manual_information_subject_order',
  'idx_m7_manual_information_project_order',
  'trg_m7_manual_information_no_update',
  'trg_m7_manual_information_no_delete',
]);

export function computeM7ManualInformationFingerprintV102(db) {
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
    CREATE TABLE m7_manual_information (
      revision INTEGER PRIMARY KEY AUTOINCREMENT,
      information_id TEXT NOT NULL UNIQUE CHECK (
        length(information_id) BETWEEN 1 AND 128
      ),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
      project_id INTEGER CHECK (
        project_id IS NULL OR (typeof(project_id) = 'integer' AND project_id > 0)
      ),
      operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
      content TEXT NOT NULL CHECK (
        typeof(content) = 'text' AND length(CAST(content AS BLOB)) BETWEEN 1 AND 16384
      ),
      summary TEXT NOT NULL CHECK (
        typeof(summary) = 'text' AND length(CAST(summary AS BLOB)) BETWEEN 1 AND 512
      ),
      tags_json TEXT NOT NULL CHECK (
        typeof(tags_json) = 'text'
        AND length(CAST(tags_json AS BLOB)) BETWEEN 2 AND 8192
        AND json_valid(tags_json) = 1
        AND json_type(tags_json) = 'array'
      ),
      created_at_ms INTEGER NOT NULL CHECK (
        typeof(created_at_ms) = 'integer' AND created_at_ms > 0
      ),
      UNIQUE(subject_id, operation_id)
    );

    CREATE INDEX idx_m7_manual_information_subject_order
      ON m7_manual_information(subject_id, created_at_ms DESC, information_id DESC);

    CREATE INDEX idx_m7_manual_information_project_order
      ON m7_manual_information(
        subject_id, project_id, created_at_ms DESC, information_id DESC
      );

    CREATE TRIGGER trg_m7_manual_information_no_update
    BEFORE UPDATE ON m7_manual_information
    BEGIN
      SELECT RAISE(ABORT, 'm7_manual_information is append-only');
    END;

    CREATE TRIGGER trg_m7_manual_information_no_delete
    BEFORE DELETE ON m7_manual_information
    BEGIN
      SELECT RAISE(ABORT, 'm7_manual_information is append-only');
    END;
  `);
}

export function up(db) {
  const current = computeM7ManualInformationFingerprintV102(db);
  if (current === EXPECTED_M7_MANUAL_INFORMATION_FINGERPRINT_V102) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_MANUAL_INFORMATION_102_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7ManualInformationFingerprintV102(db);
  if (installed !== EXPECTED_M7_MANUAL_INFORMATION_FINGERPRINT_V102) {
    throw new Error(`M7_MANUAL_INFORMATION_102_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
