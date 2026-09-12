// Provider upgrades invalidate reuse without rewriting historical evidence.
export const version = '2026_09_11_111_model_hunt_provider_identity';
export const description = 'Provider-specific evaluation identity and durable bootstrap hunt ledger';
export function up(db) {
  db.exec(`
    DROP INDEX idx_model_eval_complete_artifact_role_contract;
    CREATE UNIQUE INDEX idx_model_eval_complete_artifact_role_contract
      ON model_evaluation_runs(model_digest_sha256, role, suite_name, suite_contract_sha256,
        COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED'))
      WHERE status = 'COMPLETE';
    CREATE TRIGGER trg_model_evaluation_decisions_same_provider
      BEFORE INSERT ON model_evaluation_decisions
      WHEN (SELECT COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED')
              FROM model_evaluation_runs WHERE run_id = NEW.incumbent_run_id)
        IS NOT (SELECT COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED')
              FROM model_evaluation_runs WHERE run_id = NEW.candidate_run_id)
      BEGIN SELECT RAISE(ABORT, 'evaluation decision requires the same provider version'); END;
    CREATE TABLE model_hunt_catalog (
      candidate_key TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      revision TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      cohort TEXT NOT NULL CHECK(cohort IN ('BOOTSTRAP', 'INCREMENTAL')),
      candidate_json TEXT NOT NULL CHECK(json_valid(candidate_json))
    );
    CREATE TABLE model_hunt_attempts (
      attempt_id TEXT PRIMARY KEY,
      candidate_key TEXT NOT NULL REFERENCES model_hunt_catalog(candidate_key),
      evaluation_key TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('COMPLETE', 'BLOCKED', 'RETRYABLE')),
      completed_at TEXT NOT NULL,
      result_json TEXT NOT NULL CHECK(json_valid(result_json))
    );
    CREATE INDEX idx_model_hunt_attempt_identity
      ON model_hunt_attempts(candidate_key, evaluation_key, completed_at);
    CREATE TABLE model_hunt_bootstrap (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      started_at TEXT NOT NULL
    );
  `);
  for (const table of ['model_hunt_catalog', 'model_hunt_attempts', 'model_hunt_bootstrap']) {
    for (const operation of ['UPDATE', 'DELETE']) db.exec(`
      CREATE TRIGGER trg_${table}_no_${operation.toLowerCase()}
      BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT, 'hunt evidence is append-only'); END;
    `);
  }
}
