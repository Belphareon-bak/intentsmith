import { createHash } from 'node:crypto';
import { up as createCandidateEffectAuthoritySchema } from './2026_08_23_092_m2_effect_authority.js';

export const version = '2026_08_24_072_m2_effect_execution_claims';
export const description = 'Bind consumed M2 grants to durable execution owners and final schema';

// Filled from the canonical sqlite_master projection produced by this migration.
export const EXPECTED_M2_SCHEMA_FINGERPRINT = '8813935b17a36ff9cbb94bd10ccc29a3a5f1688b1eaa3d7d4f7766fc9760f275';

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function computeM2SchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND (
        name GLOB 'm2_*'
        OR name GLOB 'trg_m2_*'
        OR name GLOB 'idx_m2_*'
      )
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function m2Tables(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name GLOB 'm2_*'
    ORDER BY name
  `).all().map(row => row.name);
}

function storedRowCount(db, tables) {
  return tables.reduce(
    (total, table) => total
      + db.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(table)}`).get().count,
    0,
  );
}

function dropCandidateSchema(db) {
  const standalone = db.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE sql IS NOT NULL
      AND type IN ('trigger', 'index')
      AND (name GLOB 'trg_m2_*' OR name GLOB 'idx_m2_*')
    ORDER BY CASE type WHEN 'trigger' THEN 0 ELSE 1 END, name
  `).all();
  for (const object of standalone) {
    db.exec(`DROP ${object.type.toUpperCase()} IF EXISTS ${quoteIdentifier(object.name)}`);
  }
  const preferred = [
    'm2_effect_execution_claims',
    'm2_pending_effect_payloads',
    'm2_effect_authority_events',
    'm2_effect_results',
    'm2_approval_grants',
    'm2_effect_requests',
  ];
  const existing = new Set(m2Tables(db));
  for (const table of preferred) {
    if (!existing.delete(table)) continue;
    db.exec(`DROP TABLE ${quoteIdentifier(table)}`);
  }
  for (const table of [...existing].sort().reverse()) {
    db.exec(`DROP TABLE ${quoteIdentifier(table)}`);
  }
}

function installFinalAuthorityHardening(db) {
  db.exec(`
    CREATE TABLE m2_effect_execution_claims (
      effect_id TEXT PRIMARY KEY REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      grant_id TEXT NOT NULL UNIQUE REFERENCES m2_approval_grants(grant_id) ON DELETE RESTRICT,
      owner_id TEXT NOT NULL CHECK (length(trim(owner_id)) BETWEEN 1 AND 128),
      owner_pid INTEGER NOT NULL CHECK (typeof(owner_pid) = 'integer' AND owner_pid > 0),
      owner_boot_id TEXT NOT NULL CHECK (length(trim(owner_boot_id)) BETWEEN 1 AND 256),
      owner_start_identity TEXT NOT NULL CHECK (
        length(trim(owner_start_identity)) BETWEEN 1 AND 256
      ),
      claimed_at_ms INTEGER NOT NULL CHECK (
        typeof(claimed_at_ms) = 'integer' AND claimed_at_ms >= 0
      )
    );

    CREATE TRIGGER trg_m2_effect_execution_claims_exact_grant
    BEFORE INSERT ON m2_effect_execution_claims
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_approval_grants grant
      WHERE grant.grant_id = NEW.grant_id
        AND grant.effect_id = NEW.effect_id
        AND grant.consumed_at_ms IS NULL
        AND grant.revoked_at_ms IS NULL
        AND grant.issued_at_ms <= NEW.claimed_at_ms
        AND grant.expires_at_ms > NEW.claimed_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EXECUTION_CLAIM_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_effect_execution_claims_append_only_update
    BEFORE UPDATE ON m2_effect_execution_claims
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_execution_claims is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_execution_claims_append_only_delete
    BEFORE DELETE ON m2_effect_execution_claims
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_execution_claims is append-only');
    END;

    DROP TRIGGER trg_m2_approval_grants_exact_scope;
    CREATE TRIGGER trg_m2_approval_grants_exact_scope
    BEFORE INSERT ON m2_approval_grants
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND request.run_id = NEW.run_id
        AND request.project_id = NEW.project_id
        AND request.kind = NEW.kind
        AND request.payload_digest = NEW.payload_digest
        AND request.payload_bytes = NEW.payload_bytes
        AND request.workspace_revision = NEW.workspace_revision
        AND json_extract(request.request_json, '$.actor.type') = 'user'
        AND json_extract(request.request_json, '$.actor.id') = json_extract(NEW.grant_json, '$.subject.actorId')
        AND json_extract(NEW.grant_json, '$.subject.actorType') = 'user'
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_results result WHERE result.effect_id = request.effect_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_SCOPE_MISMATCH');
    END;

    DROP TRIGGER trg_m2_approval_grants_transition;
    CREATE TRIGGER trg_m2_approval_grants_transition
    BEFORE UPDATE ON m2_approval_grants
    WHEN OLD.consumed_at_ms IS NOT NULL
      OR OLD.revoked_at_ms IS NOT NULL
      OR NEW.grant_id IS NOT OLD.grant_id
      OR NEW.effect_id IS NOT OLD.effect_id
      OR NEW.run_id IS NOT OLD.run_id
      OR NEW.project_id IS NOT OLD.project_id
      OR NEW.kind IS NOT OLD.kind
      OR NEW.payload_digest IS NOT OLD.payload_digest
      OR NEW.payload_bytes IS NOT OLD.payload_bytes
      OR NEW.workspace_revision IS NOT OLD.workspace_revision
      OR NEW.nonce IS NOT OLD.nonce
      OR NEW.grant_json IS NOT OLD.grant_json
      OR NEW.issued_at_ms IS NOT OLD.issued_at_ms
      OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
      OR NOT (
        OLD.consumed_at_ms IS NULL
        AND OLD.revoked_at_ms IS NULL
        AND (
          (NEW.consumed_at_ms IS NOT NULL
            AND NEW.consumed_by_effect_id = OLD.effect_id
            AND NEW.revoked_at_ms IS NULL
            AND NEW.revocation_reason IS NULL
            AND EXISTS (
              SELECT 1 FROM m2_effect_execution_claims claim
              WHERE claim.effect_id = OLD.effect_id
                AND claim.grant_id = OLD.grant_id
                AND claim.claimed_at_ms = NEW.consumed_at_ms
            ))
          OR
          (NEW.consumed_at_ms IS NULL
            AND NEW.consumed_by_effect_id IS NULL
            AND NEW.revoked_at_ms IS NOT NULL
            AND NEW.revocation_reason IS NOT NULL)
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_INVALID_TRANSITION');
    END;

    DROP TRIGGER trg_m2_effect_results_success_authority;
    CREATE TRIGGER trg_m2_effect_results_authority
    BEFORE INSERT ON m2_effect_results
    WHEN NOT EXISTS (
      SELECT 1
      FROM m2_approval_grants grant
      JOIN m2_effect_execution_claims claim
        ON claim.effect_id = grant.effect_id AND claim.grant_id = grant.grant_id
      WHERE grant.grant_id = NEW.approval_grant_id
        AND grant.effect_id = NEW.effect_id
        AND grant.run_id = NEW.run_id
        AND grant.project_id = NEW.project_id
        AND grant.consumed_at_ms IS NOT NULL
        AND grant.consumed_by_effect_id = NEW.effect_id
        AND grant.revoked_at_ms IS NULL
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_AUTHORITY_MISSING');
    END;
  `);
}

export function up(db) {
  const currentFingerprint = computeM2SchemaFingerprint(db);
  if (currentFingerprint === EXPECTED_M2_SCHEMA_FINGERPRINT) return;

  const tables = m2Tables(db);
  if (storedRowCount(db, tables) !== 0) {
    throw new Error('M2_EFFECT_AUTHORITY_PRE_ACCEPTANCE_DATA_REQUIRES_EXPLICIT_MIGRATION');
  }

  dropCandidateSchema(db);
  createCandidateEffectAuthoritySchema(db);
  installFinalAuthorityHardening(db);
  const installedFingerprint = computeM2SchemaFingerprint(db);
  if (installedFingerprint !== EXPECTED_M2_SCHEMA_FINGERPRINT) {
    throw new Error('M2_EFFECT_AUTHORITY_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
  }
}

export default { version, description, up };
