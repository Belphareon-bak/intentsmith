import { createHash } from 'node:crypto';

export const version = '2026_08_29_104_m7_operation_list_indexes';
export const description = 'Add bounded M7 operation-list snapshot and keyset indexes';

export const EXPECTED_M7_OPERATION_LIST_INDEX_FINGERPRINT_V104 =
  '5569ea6cc103d4dc9530cf501107e67ef7b98384607658d612af86cab865ee8a';

const OBJECT_NAMES = Object.freeze([
  'idx_m7_remote_operation_list',
  'idx_m7_remote_operation_abandonment_snapshot',
]);

export function computeM7OperationListIndexFingerprintV104(db) {
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
    CREATE INDEX idx_m7_remote_operation_list
      ON m7_remote_operation_events(device_id, subject_id, sequence, revision);

    CREATE INDEX idx_m7_remote_operation_abandonment_snapshot
      ON m7_remote_operation_abandonments(
        device_id, subject_id, abandonment_revision
      );
  `);
}

export function up(db) {
  const current = computeM7OperationListIndexFingerprintV104(db);
  if (current === EXPECTED_M7_OPERATION_LIST_INDEX_FINGERPRINT_V104) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_OPERATION_LIST_INDEX_104_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7OperationListIndexFingerprintV104(db);
  if (installed !== EXPECTED_M7_OPERATION_LIST_INDEX_FINGERPRINT_V104) {
    throw new Error(`M7_OPERATION_LIST_INDEX_104_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
