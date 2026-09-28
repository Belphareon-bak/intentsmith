// Each manual measurement has its own immutable run identity. Older decisions keep their FKs.
export const version = '2026_09_18_114_model_evaluation_remeasure';
export const description = 'Append-only repeated measurements of the same model contract';
export function up(db) {
  db.exec(`DROP INDEX idx_model_eval_complete_artifact_role_contract;
    CREATE INDEX idx_model_eval_complete_artifact_role_contract
      ON model_evaluation_runs(model_digest_sha256, role, suite_name, suite_contract_sha256,
        COALESCE(json_extract(metadata_json, '$.provider.version'), 'UNRECORDED'), completed_at DESC)
      WHERE status = 'COMPLETE';`);
}
