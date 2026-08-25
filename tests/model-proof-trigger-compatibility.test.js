import Database from 'better-sqlite3';
import { suite, test, assert, assertEqual, summary } from './harness.js';
import { up as up081Proof } from '../src/db/migrations/2026_08_24_081_model_proof_trigger_compatibility.js';

const PROOF_COLUMNS = [
  'proof_id', 'validation_run_id', 'role', 'suite', 'role_contract_sha256',
  'model_name', 'model_canonical_name', 'model_digest_sha256',
  'validation_version', 'policy_version', 'score', 'required_score',
  'passed_count', 'required_passed_count', 'total_count', 'duration_ms',
  'result', 'inventory_before_name', 'inventory_before_digest',
  'inventory_after_name', 'inventory_after_digest', 'started_at_ms',
  'completed_at_ms', 'expires_at_ms', 'created_at_ms',
  'measurement_artifact_sha256', 'acceptance_artifact_sha256', 'source_revision',
];

const ARTIFACT_COLUMNS = [
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
];

const PROTECTIVE_TRIGGERS = [
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
];

function createTable(db, name, columns) {
  db.exec(`CREATE TABLE ${name} (${columns.map(column => `${column} TEXT`).join(',')})`);
}

function installM1Fixture(db) {
  createTable(db, 'model_failover_proofs', PROOF_COLUMNS);
  createTable(db, 'model_failover_proof_artifacts', ARTIFACT_COLUMNS);
  for (const name of PROTECTIVE_TRIGGERS) {
    const table = name.startsWith('trg_model_failover_proof_artifacts_')
      ? 'model_failover_proof_artifacts'
      : 'model_failover_proofs';
    db.exec(`CREATE TRIGGER ${name} BEFORE UPDATE ON ${table} BEGIN SELECT 1; END`);
  }
  db.exec(`
    CREATE TRIGGER trg_model_failover_proofs_require_artifacts
    BEFORE INSERT ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'proof requires a durable measurement artifact')
      WHERE NEW.measurement_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.kind = 'MEASUREMENT'
        );
      SELECT RAISE(ABORT, 'proof requires a durable parent acceptance artifact')
      WHERE NEW.acceptance_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.kind = 'PARENT_ACCEPTANCE'
        );
      SELECT RAISE(ABORT, 'proof requires the source revision of both artifacts')
      WHERE NEW.source_revision IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        )
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        );
    END
  `);
}

function triggerNames(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND (
      tbl_name = 'model_failover_proofs'
      OR tbl_name = 'model_failover_proof_artifacts'
    ) ORDER BY name
  `).all().map(row => row.name);
}

suite('Model proof migration 081 trigger compatibility');

test('leaves native 067 artifact storage unchanged', () => {
  const db = new Database(':memory:');
  createTable(db, 'model_failover_proof_artifacts', [
    'artifact_sha256', 'kind', 'byte_length', 'source_revision', 'created_at_ms',
  ]);
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").get().sql;
  up081Proof(db);
  assertEqual(db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").get().sql, before);
  db.close();
});

test('removes only the exact 067 trigger from M1 proof storage', () => {
  const db = new Database(':memory:');
  installM1Fixture(db);
  const beforeProofColumns = db.prepare('PRAGMA table_info(model_failover_proofs)').all();
  const beforeArtifactColumns = db.prepare('PRAGMA table_info(model_failover_proof_artifacts)').all();
  up081Proof(db);
  const after = triggerNames(db);
  assert(!after.includes('trg_model_failover_proofs_require_artifacts'));
  assert(PROTECTIVE_TRIGGERS.every(name => after.includes(name)));
  assertEqual(
    JSON.stringify(db.prepare('PRAGMA table_info(model_failover_proofs)').all()),
    JSON.stringify(beforeProofColumns),
  );
  assertEqual(
    JSON.stringify(db.prepare('PRAGMA table_info(model_failover_proof_artifacts)').all()),
    JSON.stringify(beforeArtifactColumns),
  );
  db.exec('CREATE TABLE schema_reparse_probe (id INTEGER PRIMARY KEY)');
  up081Proof(db);
  assertEqual(JSON.stringify(triggerNames(db)), JSON.stringify(after));
  db.close();
});

test('fails closed before mutation when M1 protective triggers are incomplete', () => {
  const db = new Database(':memory:');
  installM1Fixture(db);
  db.exec(`DROP TRIGGER ${PROTECTIVE_TRIGGERS[0]}`);
  let error = null;
  try { up081Proof(db); } catch (caught) { error = caught; }
  assert(String(error?.message || '').includes('trigger set is incomplete'));
  assert(triggerNames(db).includes('trg_model_failover_proofs_require_artifacts'));
  db.close();
});

test('fails closed before mutation when the colliding trigger SQL drifted', () => {
  const db = new Database(':memory:');
  installM1Fixture(db);
  db.exec('DROP TRIGGER trg_model_failover_proofs_require_artifacts');
  db.exec(`
    CREATE TRIGGER trg_model_failover_proofs_require_artifacts
    BEFORE INSERT ON model_failover_proofs BEGIN SELECT RAISE(ABORT, 'drifted'); END
  `);
  let error = null;
  try { up081Proof(db); } catch (caught) { error = caught; }
  assert(String(error?.message || '').includes('trigger SQL drifted'));
  assert(triggerNames(db).includes('trg_model_failover_proofs_require_artifacts'));
  db.close();
});

summary();
