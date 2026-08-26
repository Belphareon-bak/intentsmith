import { createHash } from 'node:crypto';

export const version = '2026_08_26_089_m5_outbound_audit';
export const description = 'Add append-only M5 outbound policy audit';

export const EXPECTED_M5_OUTBOUND_AUDIT_FINGERPRINT_V089 =
  '847cbb0be77e0b17928e0e211b486950f1f3b60c158a7286933fe964b662dfc0';

const OBJECT_NAMES = Object.freeze([
  'm5_outbound_audit_events',
  'idx_m5_outbound_audit_request_time',
  'idx_m5_outbound_audit_surface_time',
  'trg_m5_outbound_audit_exact',
  'trg_m5_outbound_audit_append_only_update',
  'trg_m5_outbound_audit_append_only_delete',
]);

export function computeM5OutboundAuditFingerprintV089(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
    ORDER BY type, name
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
    CREATE TABLE m5_outbound_audit_events (
      event_id TEXT PRIMARY KEY CHECK (
        length(event_id) = 69 AND substr(event_id, 1, 5) = 'oba1:'
      ),
      request_id TEXT NOT NULL CHECK (
        length(request_id) = 69 AND substr(request_id, 1, 5) = 'obr1:'
      ),
      occurred_at_ms INTEGER NOT NULL CHECK (
        typeof(occurred_at_ms) = 'integer' AND occurred_at_ms > 0
      ),
      phase TEXT NOT NULL CHECK (phase IN ('decision', 'terminal')),
      surface TEXT NOT NULL CHECK (length(surface) BETWEEN 1 AND 64),
      scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 128),
      method TEXT NOT NULL CHECK (
        method GLOB '[A-Z]*' AND length(method) BETWEEN 1 AND 16
      ),
      target_origin TEXT NOT NULL CHECK (length(target_origin) BETWEEN 1 AND 512),
      target_digest TEXT NOT NULL CHECK (
        length(target_digest) = 71 AND substr(target_digest, 1, 7) = 'sha256:'
      ),
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'succeeded', 'failed')),
      reason_code TEXT NOT NULL CHECK (
        reason_code GLOB '[A-Z]*' AND length(reason_code) BETWEEN 1 AND 128
      ),
      http_status INTEGER CHECK (
        http_status IS NULL OR (typeof(http_status) = 'integer' AND http_status BETWEEN 100 AND 599)
      ),
      record_json TEXT NOT NULL UNIQUE CHECK (json_valid(record_json))
    );

    CREATE INDEX idx_m5_outbound_audit_request_time
      ON m5_outbound_audit_events(request_id, occurred_at_ms, event_id);
    CREATE INDEX idx_m5_outbound_audit_surface_time
      ON m5_outbound_audit_events(surface, occurred_at_ms, event_id);

    CREATE TRIGGER trg_m5_outbound_audit_exact
    BEFORE INSERT ON m5_outbound_audit_events
    WHEN json_extract(NEW.record_json, '$.eventId') IS NOT NEW.event_id
      OR json_extract(NEW.record_json, '$.requestId') IS NOT NEW.request_id
      OR json_extract(NEW.record_json, '$.occurredAtMs') IS NOT NEW.occurred_at_ms
      OR json_extract(NEW.record_json, '$.phase') IS NOT NEW.phase
      OR json_extract(NEW.record_json, '$.surface') IS NOT NEW.surface
      OR json_extract(NEW.record_json, '$.scope') IS NOT NEW.scope
      OR json_extract(NEW.record_json, '$.method') IS NOT NEW.method
      OR json_extract(NEW.record_json, '$.targetOrigin') IS NOT NEW.target_origin
      OR json_extract(NEW.record_json, '$.targetDigest') IS NOT NEW.target_digest
      OR json_extract(NEW.record_json, '$.decision') IS NOT NEW.decision
      OR json_extract(NEW.record_json, '$.reasonCode') IS NOT NEW.reason_code
      OR json_extract(NEW.record_json, '$.httpStatus') IS NOT NEW.http_status
    BEGIN
      SELECT RAISE(ABORT, 'M5_OUTBOUND_AUDIT_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m5_outbound_audit_append_only_update
    BEFORE UPDATE ON m5_outbound_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'm5_outbound_audit_events is append-only');
    END;
    CREATE TRIGGER trg_m5_outbound_audit_append_only_delete
    BEFORE DELETE ON m5_outbound_audit_events
    BEGIN
      SELECT RAISE(ABORT, 'm5_outbound_audit_events is append-only');
    END;
  `);
}

export function up(db) {
  const current = computeM5OutboundAuditFingerprintV089(db);
  if (current === EXPECTED_M5_OUTBOUND_AUDIT_FINGERPRINT_V089) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M5_OUTBOUND_AUDIT_089_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM5OutboundAuditFingerprintV089(db);
  if (installed !== EXPECTED_M5_OUTBOUND_AUDIT_FINGERPRINT_V089) {
    throw new Error(`M5_OUTBOUND_AUDIT_089_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
