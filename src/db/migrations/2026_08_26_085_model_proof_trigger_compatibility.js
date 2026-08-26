// Remove one trigger installed by migration 067 over the incompatible M1
// proof-artifact authority from migration 062.
//
// Native 067 storage has one row per artifact (`artifact_sha256`, `kind`). M1
// storage has one immutable companion row per proof with separate measurement
// and acceptance digests. `CREATE TABLE IF NOT EXISTS` let 067 keep the M1
// table but add a trigger that queries its nonexistent legacy columns. SQLite
// consequently rejects later, unrelated DDL while reparsing the schema.
//
// Only the known 067 trigger, with its exact SQL digest, is removed and only
// when both M1 table shapes and their complete protective trigger set match.
// Native 067 databases are unchanged; every unknown state fails closed.

import { createHash } from 'node:crypto';

export const version = '2026_08_26_085_model_proof_trigger_compatibility';
export const description = 'Remove the legacy proof trigger from exact M1 artifact schemas';

const LEGACY_REQUIRE_TRIGGER = 'trg_model_failover_proofs_require_artifacts';
const LEGACY_REQUIRE_TRIGGER_SHA256 =
  'ca54ce8058b3da1e749f1ad12ce01f9417894c99682f540a2898841d4e1375d9';

const M1_PROOF_COLUMNS = Object.freeze([
  'proof_id', 'validation_run_id', 'role', 'suite', 'role_contract_sha256',
  'model_name', 'model_canonical_name', 'model_digest_sha256',
  'validation_version', 'policy_version', 'score', 'required_score',
  'passed_count', 'required_passed_count', 'total_count', 'duration_ms',
  'result', 'inventory_before_name', 'inventory_before_digest',
  'inventory_after_name', 'inventory_after_digest', 'started_at_ms',
  'completed_at_ms', 'expires_at_ms', 'created_at_ms',
]);

const LEGACY_067_ADDITIONS = Object.freeze([
  'measurement_artifact_sha256',
  'acceptance_artifact_sha256',
  'source_revision',
]);

const M1_ARTIFACT_COLUMNS = Object.freeze([
  'proof_id', 'validation_run_id', 'parent_run_id', 'source_revision',
  'measurement_artifact_sha256', 'measurement_artifact_byte_length',
  'acceptance_artifact_sha256', 'acceptance_artifact_byte_length', 'role',
  'suite', 'role_contract_sha256', 'model_name', 'model_canonical_name',
  'model_digest_sha256', 'validation_version', 'policy_version', 'score',
  'required_score', 'passed_count', 'required_passed_count', 'total_count',
  'duration_ms', 'result', 'inventory_before_name', 'inventory_before_digest',
  'inventory_after_name', 'inventory_after_digest', 'measurement_started_at_ms',
  'measurement_completed_at_ms', 'acceptance_completed_at_ms', 'proof_ttl_ms',
  'expires_at_ms', 'issued_at_ms',
]);

const LEGACY_ARTIFACT_COLUMNS = Object.freeze([
  'artifact_sha256', 'kind', 'byte_length', 'source_revision', 'created_at_ms',
]);

const M1_TRIGGER_NAMES = Object.freeze([
  'trg_model_failover_proof_artifacts_append_only_delete',
  'trg_model_failover_proof_artifacts_append_only_update',
  'trg_model_failover_proof_artifacts_historical_attach',
  'trg_model_failover_proof_artifacts_identity_conflict',
  'trg_model_failover_proofs_append_only_delete',
  'trg_model_failover_proofs_append_only_insert_conflict',
  'trg_model_failover_proofs_append_only_update',
  'trg_model_failover_proofs_artifact_companion',
  'trg_model_failover_proofs_identity_required',
  'trg_model_failover_proofs_rowid_authority',
  'trg_model_failover_proofs_rowid_positive',
]);

function exactColumns(db, table, expected) {
  const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function triggerRows(db) {
  return db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND (
      tbl_name = 'model_failover_proofs'
      OR tbl_name = 'model_failover_proof_artifacts'
    )
    ORDER BY name
  `).all();
}

export function up(db) {
  if (exactColumns(db, 'model_failover_proof_artifacts', LEGACY_ARTIFACT_COLUMNS)) return;

  const isM1Artifacts = exactColumns(
    db,
    'model_failover_proof_artifacts',
    M1_ARTIFACT_COLUMNS,
  );
  const isM1Proofs = exactColumns(db, 'model_failover_proofs', M1_PROOF_COLUMNS)
    || exactColumns(
      db,
      'model_failover_proofs',
      [...M1_PROOF_COLUMNS, ...LEGACY_067_ADDITIONS],
    );
  if (!isM1Artifacts || !isM1Proofs) {
    throw new Error('model failover proof storage is neither exact M1 nor native 067');
  }

  const triggers = triggerRows(db);
  const names = new Set(triggers.map(row => row.name));
  const missingM1 = M1_TRIGGER_NAMES.filter(name => !names.has(name));
  if (missingM1.length > 0) {
    throw new Error(`M1 model failover proof trigger set is incomplete: ${missingM1.join(',')}`);
  }

  const legacy = triggers.find(row => row.name === LEGACY_REQUIRE_TRIGGER);
  if (!legacy) return;
  const digest = createHash('sha256').update(legacy.sql || '').digest('hex');
  if (digest !== LEGACY_REQUIRE_TRIGGER_SHA256) {
    throw new Error(`legacy model failover proof trigger SQL drifted: ${digest}`);
  }
  db.exec(`DROP TRIGGER ${LEGACY_REQUIRE_TRIGGER}`);
}

export default { version, description, up };
