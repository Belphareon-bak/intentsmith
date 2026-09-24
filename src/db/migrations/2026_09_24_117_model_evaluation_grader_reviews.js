// Independent, append-only per-grader reviews of one immutable answer capture.
// A row here is evidence, never a COMPLETE model score or a role decision.
export const version = '2026_09_24_117_model_evaluation_grader_reviews';
export const description = 'Append-only independent grader review evidence for model answer collections';
export function up(db) {
  db.exec(`
    CREATE TABLE model_evaluation_grader_reviews (
      review_id TEXT PRIMARY KEY,
      source_run_id TEXT NOT NULL REFERENCES model_evaluation_runs(run_id),
      role TEXT NOT NULL CHECK(role IN ('D1','D2','R1','R2','CHAT')),
      contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256)=64 AND contract_sha256 NOT GLOB '*[^0-9a-f]*'),
      source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
      grader_acceptance_id TEXT NOT NULL REFERENCES model_evaluation_acceptances(acceptance_id),
      grader_acceptance_sha256 TEXT NOT NULL CHECK(length(grader_acceptance_sha256)=64 AND grader_acceptance_sha256 NOT GLOB '*[^0-9a-f]*'),
      summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
      summary_sha256 TEXT NOT NULL CHECK(length(summary_sha256)=64 AND summary_sha256 NOT GLOB '*[^0-9a-f]*'),
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) WITHOUT ROWID;
    CREATE INDEX idx_model_grader_reviews_source ON model_evaluation_grader_reviews(source_run_id, grader_acceptance_id);
    CREATE TRIGGER trg_model_grader_reviews_no_update BEFORE UPDATE ON model_evaluation_grader_reviews
      BEGIN SELECT RAISE(ABORT,'grader review is append-only'); END;
    CREATE TRIGGER trg_model_grader_reviews_no_delete BEFORE DELETE ON model_evaluation_grader_reviews
      BEGIN SELECT RAISE(ABORT,'grader review is append-only'); END;
  `);
}
export default { version, description, up };
