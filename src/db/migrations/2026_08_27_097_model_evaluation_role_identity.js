// Make role part of exact evaluation identity and quarantine decisions that
// were previously allowed to project one role's run onto another role.

export const version = '2026_08_27_097_model_evaluation_role_identity';
export const description = 'Enforce role-specific model evaluation and decision identity';

const EXACT_DECISION = `
  SELECT 1
  FROM model_evaluation_runs incumbent
  JOIN model_evaluation_runs candidate
    ON candidate.run_id = decision.candidate_run_id
  WHERE incumbent.run_id = decision.incumbent_run_id
    AND incumbent.status = 'COMPLETE'
    AND candidate.status = 'COMPLETE'
    AND incumbent.model_digest_sha256 IS NOT NULL
    AND candidate.model_digest_sha256 IS NOT NULL
    AND incumbent.model_digest_sha256 <> candidate.model_digest_sha256
    AND incumbent.role = decision.role
    AND candidate.role = decision.role
    AND incumbent.suite_name = candidate.suite_name
    AND incumbent.suite_version = candidate.suite_version
    AND incumbent.suite_contract_sha256 = candidate.suite_contract_sha256
`;

function requireTable(db, name) {
  const row = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name);
  if (!row) throw new Error(`required pre-097 table is missing: ${name}`);
}

export function up(db) {
  requireTable(db, 'model_evaluation_runs');
  requireTable(db, 'model_evaluation_decisions');

  const invalidRun = db.prepare(`
    SELECT run_id FROM model_evaluation_runs
    WHERE model_digest_sha256 IS NOT NULL
      AND (role IS NULL OR role NOT IN ('D1','D2','CODE','R1','R2','CHAT','VISION'))
    LIMIT 1
  `).get();
  if (invalidRun) {
    throw new Error(`pre-097 exact evaluation has invalid role: ${invalidRun.run_id}`);
  }

  db.exec(`
    DROP INDEX idx_model_eval_complete_artifact_contract;
    CREATE UNIQUE INDEX idx_model_eval_complete_artifact_role_contract
      ON model_evaluation_runs(
        model_digest_sha256,
        role,
        suite_name,
        suite_contract_sha256
      )
      WHERE status = 'COMPLETE';

    CREATE TRIGGER trg_model_evaluation_runs_exact_role
    BEFORE INSERT ON model_evaluation_runs
    WHEN NEW.model_digest_sha256 IS NOT NULL
      AND (NEW.role IS NULL OR NEW.role NOT IN ('D1','D2','CODE','R1','R2','CHAT','VISION'))
    BEGIN
      SELECT RAISE(ABORT, 'exact model evaluation requires a valid role');
    END;

    CREATE TABLE model_evaluation_decision_quarantine (
      decision_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      incumbent_run_id TEXT NOT NULL,
      candidate_run_id TEXT NOT NULL,
      reason_code TEXT NOT NULL
        CHECK (reason_code IN ('RUN_ROLE_MISMATCH_OR_INVALID_EXACT_RUNS')),
      decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
      quarantined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TRIGGER trg_model_evaluation_decision_quarantine_no_update
    BEFORE UPDATE ON model_evaluation_decision_quarantine
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_decision_quarantine is append-only');
    END;

    CREATE TRIGGER trg_model_evaluation_decision_quarantine_no_delete
    BEFORE DELETE ON model_evaluation_decision_quarantine
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_decision_quarantine is append-only');
    END;

    INSERT INTO model_evaluation_decision_quarantine (
      decision_id, role, incumbent_run_id, candidate_run_id,
      reason_code, decision_json, quarantined_at
    )
    SELECT
      decision.decision_id,
      decision.role,
      decision.incumbent_run_id,
      decision.candidate_run_id,
      'RUN_ROLE_MISMATCH_OR_INVALID_EXACT_RUNS',
      json_object(
        'decision_id', decision.decision_id,
        'role', decision.role,
        'incumbent_run_id', decision.incumbent_run_id,
        'candidate_run_id', decision.candidate_run_id,
        'policy_version', decision.policy_version,
        'policy_contract_sha256', decision.policy_contract_sha256,
        'outcome', decision.outcome,
        'basis', decision.basis,
        'details', json(decision.details_json),
        'created_at', decision.created_at
      ),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM model_evaluation_decisions decision
    WHERE NOT EXISTS (${EXACT_DECISION})
    ORDER BY decision.created_at, decision.decision_id;

    DROP TRIGGER trg_model_evaluation_decisions_exact_runs;
    DROP TRIGGER trg_model_evaluation_decisions_no_update;
    DROP TRIGGER trg_model_evaluation_decisions_no_delete;
    ALTER TABLE model_evaluation_decisions RENAME TO model_evaluation_decisions_pre_097;

    CREATE TABLE model_evaluation_decisions (
      decision_id TEXT PRIMARY KEY
        CHECK (length(trim(decision_id)) BETWEEN 1 AND 128),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      incumbent_run_id TEXT NOT NULL
        REFERENCES model_evaluation_runs(run_id) ON DELETE RESTRICT,
      candidate_run_id TEXT NOT NULL
        REFERENCES model_evaluation_runs(run_id) ON DELETE RESTRICT,
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 128),
      policy_contract_sha256 TEXT NOT NULL
        CHECK (
          length(policy_contract_sha256) = 64
          AND policy_contract_sha256 = lower(policy_contract_sha256)
          AND policy_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      outcome TEXT NOT NULL
        CHECK (outcome IN ('CANDIDATE','INCUMBENT','INCONCLUSIVE','BLOCKED')),
      basis TEXT NOT NULL
        CHECK (length(trim(basis)) BETWEEN 1 AND 128),
      details_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(details_json)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      CHECK (incumbent_run_id <> candidate_run_id)
    );

    INSERT INTO model_evaluation_decisions (
      decision_id, role, incumbent_run_id, candidate_run_id,
      policy_version, policy_contract_sha256, outcome, basis,
      details_json, created_at
    )
    SELECT
      decision.decision_id, decision.role, decision.incumbent_run_id,
      decision.candidate_run_id, decision.policy_version,
      decision.policy_contract_sha256, decision.outcome, decision.basis,
      decision.details_json, decision.created_at
    FROM model_evaluation_decisions_pre_097 decision
    WHERE EXISTS (${EXACT_DECISION})
    ORDER BY decision.created_at, decision.decision_id;

    DROP TABLE model_evaluation_decisions_pre_097;

    CREATE INDEX idx_model_evaluation_decisions_role_time
      ON model_evaluation_decisions(role, created_at DESC, decision_id DESC);

    CREATE TRIGGER trg_model_evaluation_decisions_exact_runs
    BEFORE INSERT ON model_evaluation_decisions
    WHEN NOT EXISTS (
      SELECT 1
      FROM model_evaluation_runs incumbent
      JOIN model_evaluation_runs candidate
        ON candidate.run_id = NEW.candidate_run_id
      WHERE incumbent.run_id = NEW.incumbent_run_id
        AND incumbent.status = 'COMPLETE'
        AND candidate.status = 'COMPLETE'
        AND incumbent.model_digest_sha256 IS NOT NULL
        AND candidate.model_digest_sha256 IS NOT NULL
        AND incumbent.model_digest_sha256 <> candidate.model_digest_sha256
        AND incumbent.role = NEW.role
        AND candidate.role = NEW.role
        AND incumbent.suite_name = candidate.suite_name
        AND incumbent.suite_version = candidate.suite_version
        AND incumbent.suite_contract_sha256 = candidate.suite_contract_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'model evaluation decision requires two role-specific exact COMPLETE runs for one suite contract');
    END;

    CREATE TRIGGER trg_model_evaluation_decisions_no_update
    BEFORE UPDATE ON model_evaluation_decisions
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_decisions is append-only');
    END;

    CREATE TRIGGER trg_model_evaluation_decisions_no_delete
    BEFORE DELETE ON model_evaluation_decisions
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_decisions is append-only');
    END;
  `);
}

export default { version, description, up };
