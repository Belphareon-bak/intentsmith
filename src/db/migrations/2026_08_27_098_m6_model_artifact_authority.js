import { createHash } from 'node:crypto';

export const version = '2026_08_27_098_m6_model_artifact_authority';
export const description = 'Add durable cross-process model artifact claims and append-only effect audit';

export const EXPECTED_M6_MODEL_ARTIFACT_AUTHORITY_FINGERPRINT_V098 =
  'f69337deb8180dab3b8fd60689240236f006e6da029a98d9c6f2e0881edd3da5';

const OBJECT_NAMES = Object.freeze([
  'm6_model_artifact_claims',
  'm6_model_artifact_operations',
  'm6_model_artifact_events',
  'idx_m6_model_claims_active',
  'idx_m6_model_operations_identity',
  'idx_m6_model_events_operation',
  'trg_m6_model_claims_no_delete',
  'trg_m6_model_claims_release_only',
  'trg_m6_model_operations_no_delete',
  'trg_m6_model_operations_no_update',
  'trg_m6_model_operations_authority',
  'trg_m6_model_events_causal',
  'trg_m6_model_events_no_delete',
  'trg_m6_model_events_no_update',
]);

export function computeM6ModelArtifactAuthorityFingerprintV098(db) {
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
    CREATE TABLE m6_model_artifact_claims (
      claim_id TEXT PRIMARY KEY CHECK (length(claim_id) BETWEEN 16 AND 128),
      canonical_name TEXT NOT NULL CHECK (
        length(canonical_name) BETWEEN 1 AND 256
        AND canonical_name = lower(canonical_name)
        AND canonical_name NOT LIKE '%:latest'
      ),
      mode TEXT NOT NULL CHECK (mode IN ('SHARED', 'EXCLUSIVE')),
      owner TEXT NOT NULL CHECK (owner IN (
        'LLM_GATEWAY', 'MODEL_VALIDATION', 'BINDING_CUTOVER',
        'FAILOVER_CUTOVER', 'BINDING_VERIFICATION', 'VRAM_ARTIFACT_USE',
        'MODEL_PULL', 'MODEL_DELETE'
      )),
      owner_pid INTEGER NOT NULL CHECK (owner_pid > 0),
      owner_uid INTEGER NOT NULL CHECK (owner_uid >= 0),
      owner_boot_id TEXT NOT NULL CHECK (length(owner_boot_id) BETWEEN 16 AND 64),
      owner_start_ticks TEXT NOT NULL CHECK (
        length(owner_start_ticks) BETWEEN 1 AND 32
        AND owner_start_ticks NOT GLOB '*[^0-9]*'
      ),
      owner_instance_id TEXT NOT NULL CHECK (
        length(owner_instance_id) = 64
        AND owner_instance_id NOT GLOB '*[^a-f0-9]*'
      ),
      acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms > 0),
      released_at_ms INTEGER CHECK (
        released_at_ms IS NULL OR released_at_ms >= acquired_at_ms
      ),
      release_reason TEXT CHECK (
        (released_at_ms IS NULL AND release_reason IS NULL)
        OR (released_at_ms IS NOT NULL AND release_reason IN (
          'NORMAL', 'OWNER_GONE_RECOVERED'
        ))
      )
    );

    CREATE INDEX idx_m6_model_claims_active
      ON m6_model_artifact_claims(canonical_name, released_at_ms, mode, acquired_at_ms);

    CREATE TABLE m6_model_artifact_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 16 AND 128),
      claim_id TEXT NOT NULL REFERENCES m6_model_artifact_claims(claim_id),
      kind TEXT NOT NULL CHECK (kind IN ('PULL', 'DELETE')),
      exact_name TEXT NOT NULL CHECK (length(exact_name) BETWEEN 1 AND 256),
      canonical_name TEXT NOT NULL CHECK (
        length(canonical_name) BETWEEN 1 AND 256
        AND canonical_name = lower(canonical_name)
        AND canonical_name NOT LIKE '%:latest'
        AND canonical_name = CASE
          WHEN lower(trim(exact_name)) LIKE '%:latest'
          THEN rtrim(substr(
            lower(trim(exact_name)), 1, length(lower(trim(exact_name))) - 7
          ))
          ELSE lower(trim(exact_name))
        END
      ),
      digest_sha256 TEXT CHECK (
        (kind = 'PULL' AND digest_sha256 IS NULL)
        OR (kind = 'DELETE' AND length(digest_sha256) = 64
          AND digest_sha256 NOT GLOB '*[^a-f0-9]*')
      ),
      source TEXT NOT NULL CHECK (source IN (
        'USER_REQUEST', 'USER_HTTP', 'USER_CHAT', 'AUTO_CLEANUP',
        'BINDING_APPLICATION', 'RECOVERY'
      )),
      provider_origin TEXT NOT NULL CHECK (
        (
          provider_origin LIKE 'http://127.0.0.1:%'
          AND length(substr(provider_origin, 18)) BETWEEN 1 AND 5
          AND substr(provider_origin, 18) NOT GLOB '*[^0-9]*'
          AND CAST(substr(provider_origin, 18) AS INTEGER) BETWEEN 1 AND 65535
        ) OR (
          provider_origin LIKE 'http://localhost:%'
          AND length(substr(provider_origin, 18)) BETWEEN 1 AND 5
          AND substr(provider_origin, 18) NOT GLOB '*[^0-9]*'
          AND CAST(substr(provider_origin, 18) AS INTEGER) BETWEEN 1 AND 65535
        ) OR (
          provider_origin LIKE 'http://[::1]:%'
          AND length(substr(provider_origin, 14)) BETWEEN 1 AND 5
          AND substr(provider_origin, 14) NOT GLOB '*[^0-9]*'
          AND CAST(substr(provider_origin, 14) AS INTEGER) BETWEEN 1 AND 65535
        )
      ),
      created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0)
    );

    CREATE INDEX idx_m6_model_operations_identity
      ON m6_model_artifact_operations(canonical_name, created_at_ms, operation_id);

    CREATE TABLE m6_model_artifact_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL REFERENCES m6_model_artifact_operations(operation_id),
      sequence INTEGER NOT NULL CHECK (sequence IN (1, 2)),
      status TEXT NOT NULL CHECK (status IN (
        'SUCCEEDED', 'FAILED', 'ORPHANED', 'RECONCILED_SUCCEEDED'
      )),
      error_code TEXT CHECK (
        (status IN ('SUCCEEDED', 'RECONCILED_SUCCEEDED') AND error_code IS NULL)
        OR (status IN ('FAILED', 'ORPHANED')
          AND length(error_code) BETWEEN 1 AND 128)
      ),
      recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms > 0),
      UNIQUE (operation_id, sequence)
    );

    CREATE INDEX idx_m6_model_events_operation
      ON m6_model_artifact_events(operation_id, sequence, event_id);

    CREATE TRIGGER trg_m6_model_operations_authority
    BEFORE INSERT ON m6_model_artifact_operations
    WHEN NOT EXISTS (
      SELECT 1 FROM m6_model_artifact_claims claim
      WHERE claim.claim_id = NEW.claim_id
        AND claim.canonical_name = NEW.canonical_name
        AND claim.mode = 'EXCLUSIVE'
        AND claim.owner = CASE NEW.kind
          WHEN 'PULL' THEN 'MODEL_PULL'
          WHEN 'DELETE' THEN 'MODEL_DELETE'
        END
        AND claim.released_at_ms IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'M6_MODEL_ARTIFACT_OPERATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m6_model_claims_release_only
    BEFORE UPDATE ON m6_model_artifact_claims
    WHEN NOT (
      OLD.released_at_ms IS NULL
      AND NEW.released_at_ms IS NOT NULL
      AND NEW.release_reason IN ('NORMAL', 'OWNER_GONE_RECOVERED')
      AND NEW.claim_id IS OLD.claim_id
      AND NEW.canonical_name IS OLD.canonical_name
      AND NEW.mode IS OLD.mode
      AND NEW.owner IS OLD.owner
      AND NEW.owner_pid IS OLD.owner_pid
      AND NEW.owner_uid IS OLD.owner_uid
      AND NEW.owner_boot_id IS OLD.owner_boot_id
      AND NEW.owner_start_ticks IS OLD.owner_start_ticks
      AND NEW.owner_instance_id IS OLD.owner_instance_id
      AND NEW.acquired_at_ms IS OLD.acquired_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'M6_MODEL_ARTIFACT_CLAIM_MUTATION_FORBIDDEN');
    END;

    CREATE TRIGGER trg_m6_model_claims_no_delete
    BEFORE DELETE ON m6_model_artifact_claims
    BEGIN
      SELECT RAISE(ABORT, 'm6_model_artifact_claims history cannot be deleted');
    END;

    CREATE TRIGGER trg_m6_model_operations_no_update
    BEFORE UPDATE ON m6_model_artifact_operations
    BEGIN
      SELECT RAISE(ABORT, 'm6_model_artifact_operations is append-only');
    END;

    CREATE TRIGGER trg_m6_model_operations_no_delete
    BEFORE DELETE ON m6_model_artifact_operations
    BEGIN
      SELECT RAISE(ABORT, 'm6_model_artifact_operations is append-only');
    END;

    CREATE TRIGGER trg_m6_model_events_causal
    BEFORE INSERT ON m6_model_artifact_events
    WHEN NOT (
      (
        NEW.sequence = 1
        AND NEW.status IN ('SUCCEEDED', 'FAILED', 'ORPHANED')
        AND NOT EXISTS (
          SELECT 1 FROM m6_model_artifact_events
          WHERE operation_id = NEW.operation_id
        )
      )
      OR (
        NEW.sequence = 2
        AND NEW.status = 'RECONCILED_SUCCEEDED'
        AND EXISTS (
          SELECT 1 FROM m6_model_artifact_events
          WHERE operation_id = NEW.operation_id
            AND sequence = 1 AND status = 'ORPHANED'
        )
        AND NOT EXISTS (
          SELECT 1 FROM m6_model_artifact_events
          WHERE operation_id = NEW.operation_id AND sequence = 2
        )
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M6_MODEL_ARTIFACT_EVENT_CAUSAL_MISMATCH');
    END;

    CREATE TRIGGER trg_m6_model_events_no_update
    BEFORE UPDATE ON m6_model_artifact_events
    BEGIN
      SELECT RAISE(ABORT, 'm6_model_artifact_events is append-only');
    END;

    CREATE TRIGGER trg_m6_model_events_no_delete
    BEFORE DELETE ON m6_model_artifact_events
    BEGIN
      SELECT RAISE(ABORT, 'm6_model_artifact_events is append-only');
    END;
  `);
}

export function up(db) {
  const current = computeM6ModelArtifactAuthorityFingerprintV098(db);
  if (current === EXPECTED_M6_MODEL_ARTIFACT_AUTHORITY_FINGERPRINT_V098) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (${OBJECT_NAMES.map(() => '?').join(',')})
  `).get(...OBJECT_NAMES).count;
  if (existing !== 0) throw new Error('M6_MODEL_ARTIFACT_AUTHORITY_098_SOURCE_OBJECT_MISMATCH');
  install(db);
  const installed = computeM6ModelArtifactAuthorityFingerprintV098(db);
  if (installed !== EXPECTED_M6_MODEL_ARTIFACT_AUTHORITY_FINGERPRINT_V098) {
    throw new Error(`M6_MODEL_ARTIFACT_AUTHORITY_098_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
