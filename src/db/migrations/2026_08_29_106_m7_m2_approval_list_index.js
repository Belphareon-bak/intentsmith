import { createHash } from 'node:crypto';

export const version = '2026_08_29_106_m7_m2_approval_list_index';
export const description = 'Add bounded M7 M2-owned approval list index';

export const EXPECTED_M7_M2_APPROVAL_LIST_INDEX_FINGERPRINT_V106 =
  'b8a90ddbea96498232b79880ed5ba23d48214fd19bf54164a1cf853b63904e5c';

const OBJECT_NAMES = Object.freeze([
  'idx_m2_lifecycle_remote_approval_owner_list',
]);

export function computeM7M2ApprovalListIndexFingerprintV106(db) {
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
    CREATE INDEX idx_m2_lifecycle_remote_approval_owner_list
      ON m2_lifecycle_operations(
        json_extract(plan_json, '$.actor.id'), created_at_ms DESC, lifecycle_id DESC
      );
  `);
}

export function up(db) {
  const current = computeM7M2ApprovalListIndexFingerprintV106(db);
  if (current === EXPECTED_M7_M2_APPROVAL_LIST_INDEX_FINGERPRINT_V106) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M7_M2_APPROVAL_LIST_INDEX_106_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM7M2ApprovalListIndexFingerprintV106(db);
  if (installed !== EXPECTED_M7_M2_APPROVAL_LIST_INDEX_FINGERPRINT_V106) {
    throw new Error(`M7_M2_APPROVAL_LIST_INDEX_106_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
