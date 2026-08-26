import { up as createCurrentEffectAuthoritySchema } from './2026_08_23_092_m2_effect_authority.js';

export const version = '2026_08_24_071_m2_effect_authority_hardening';
export const description = 'Harden pre-acceptance M2 effect authority schema';

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasColumn(db, table, column) {
  return tableExists(db, table)
    && db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function installGrantSubjectBinding(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_m2_approval_grants_exact_scope;
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
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_SCOPE_MISMATCH');
    END;
  `);
}

export function up(db) {
  // Fresh installs have the final 070 definition already. 071 exists because
  // the pre-acceptance 070 candidate was exercised locally before its authority
  // identity columns were complete, and migration versions are immutable once
  // stamped into a database.
  const currentSchema = (
    hasColumn(db, 'm2_effect_requests', 'payload_bytes')
    && hasColumn(db, 'm2_effect_requests', 'request_digest')
    && hasColumn(db, 'm2_effect_results', 'approval_grant_id')
    && tableExists(db, 'm2_pending_effect_payloads')
  );
  if (currentSchema) {
    installGrantSubjectBinding(db);
    return;
  }

  const candidateTables = [
    'm2_effect_requests',
    'm2_approval_grants',
    'm2_effect_results',
    'm2_effect_authority_events',
  ].filter(table => tableExists(db, table));
  const storedRows = candidateTables.reduce(
    (count, table) => count + db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
    0,
  );
  if (storedRows !== 0) {
    throw new Error(
      'M2_EFFECT_AUTHORITY_PRE_ACCEPTANCE_DATA_REQUIRES_EXPLICIT_MIGRATION',
    );
  }

  db.exec(`
    DROP TABLE IF EXISTS m2_pending_effect_payloads;
    DROP TABLE IF EXISTS m2_effect_authority_events;
    DROP TABLE IF EXISTS m2_effect_results;
    DROP TABLE IF EXISTS m2_approval_grants;
    DROP TABLE IF EXISTS m2_effect_requests;
  `);
  createCurrentEffectAuthoritySchema(db);
  installGrantSubjectBinding(db);
}

export default { version, description, up };
