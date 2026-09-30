// Explicit, immutable human resolution of disagreements between two accepted
// grader reviews. The original reviews remain intact and independently readable.
export const version = '2026_09_25_119_model_evaluation_adjudications';
export const description = 'Append-only reviewed adjudication of paired semantic grader disputes';
export function up(db) {
  db.exec(`
    CREATE TABLE model_evaluation_grader_adjudications (
      adjudication_id TEXT PRIMARY KEY,
      source_run_id TEXT NOT NULL REFERENCES model_evaluation_runs(run_id),
      role TEXT NOT NULL CHECK(role IN ('D1','D2','R1','R2','CHAT')),
      contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256)=64 AND contract_sha256 NOT GLOB '*[^0-9a-f]*'),
      source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
      first_review_id TEXT NOT NULL REFERENCES model_evaluation_grader_reviews(review_id),
      second_review_id TEXT NOT NULL REFERENCES model_evaluation_grader_reviews(review_id),
      decision_json TEXT NOT NULL CHECK(json_valid(decision_json)),
      decision_sha256 TEXT NOT NULL CHECK(length(decision_sha256)=64 AND decision_sha256 NOT GLOB '*[^0-9a-f]*'),
      final_score REAL NOT NULL CHECK(final_score >= 0 AND final_score <= 1),
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK(first_review_id <> second_review_id),
      UNIQUE(source_run_id, first_review_id, second_review_id)
    ) WITHOUT ROWID;
    CREATE TRIGGER trg_model_grader_adjudications_no_update BEFORE UPDATE ON model_evaluation_grader_adjudications
      BEGIN SELECT RAISE(ABORT,'grader adjudication is append-only'); END;
    CREATE TRIGGER trg_model_grader_adjudications_no_delete BEFORE DELETE ON model_evaluation_grader_adjudications
      BEGIN SELECT RAISE(ABORT,'grader adjudication is append-only'); END;
  `);
}
export default { version, description, up };
