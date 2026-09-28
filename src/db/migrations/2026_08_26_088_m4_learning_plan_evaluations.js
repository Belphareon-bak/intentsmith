import { createHash } from 'node:crypto';

import { registerM4LearningAuthorityFunctions } from '../../memory/learning-authority-validation.js';

export const version = '2026_08_26_088_m4_learning_plan_evaluations';
export const description = 'Persist append-only M4 plan evaluation evidence';

export const EXPECTED_M4_LEARNING_PLAN_EVALUATION_FINGERPRINT_V088 =
  'fec66c09b673d3a8f2387bc6146c7ae454040b78185195559c812f1c13958d49';

const OBJECT_NAMES = Object.freeze([
  'm4_learning_plan_evaluations',
  'idx_m4_learning_plan_evaluations_proposal_time',
  'trg_m4_learning_plan_evaluations_exact',
  'trg_m4_learning_plan_evaluations_append_only_update',
  'trg_m4_learning_plan_evaluations_append_only_delete',
]);

export function computeM4LearningPlanEvaluationFingerprintV088(db) {
  const expected = new Set(OBJECT_NAMES);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
    ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function install(db) {
  db.exec(`
    CREATE TABLE m4_learning_plan_evaluations (
      artifact_id TEXT PRIMARY KEY CHECK (
        length(artifact_id) = 69 AND substr(artifact_id, 1, 5) = 'lpa1:'
      ),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      proposal_id TEXT NOT NULL
        REFERENCES m4_learning_proposals(proposal_id) ON DELETE RESTRICT,
      item_id TEXT NOT NULL CHECK (
        length(item_id) = 69 AND substr(item_id, 1, 5) = 'lit1:'
      ),
      item_version INTEGER NOT NULL CHECK (
        typeof(item_version) = 'integer' AND item_version > 0
      ),
      generated_at_ms INTEGER NOT NULL CHECK (
        typeof(generated_at_ms) = 'integer' AND generated_at_ms > 0
      ),
      learning_context_digest TEXT CHECK (
        learning_context_digest IS NULL OR (
          length(learning_context_digest) = 69
          AND substr(learning_context_digest, 1, 5) = 'plc1:'
        )
      ),
      record_json TEXT NOT NULL UNIQUE
    );

    CREATE INDEX idx_m4_learning_plan_evaluations_proposal_time
      ON m4_learning_plan_evaluations(proposal_id, generated_at_ms, artifact_id);

    CREATE TRIGGER trg_m4_learning_plan_evaluations_exact
    BEFORE INSERT ON m4_learning_plan_evaluations
    WHEN m4_learning_plan_evaluation_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.artifactId') IS NOT NEW.artifact_id
      OR json_extract(NEW.record_json, '$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.record_json, '$.proposalId') IS NOT NEW.proposal_id
      OR json_extract(NEW.record_json, '$.itemId') IS NOT NEW.item_id
      OR json_extract(NEW.record_json, '$.itemVersion') IS NOT NEW.item_version
      OR json_extract(NEW.record_json, '$.generatedAtMs') IS NOT NEW.generated_at_ms
      OR json_extract(NEW.record_json, '$.learningContextDigest')
        IS NOT NEW.learning_context_digest
      OR NOT EXISTS (
        SELECT 1 FROM m4_learning_proposals proposal
        WHERE proposal.proposal_id = NEW.proposal_id
          AND proposal.project_id = NEW.project_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'M4_LEARNING_PLAN_EVALUATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m4_learning_plan_evaluations_append_only_update
    BEFORE UPDATE ON m4_learning_plan_evaluations
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_plan_evaluations is append-only');
    END;
    CREATE TRIGGER trg_m4_learning_plan_evaluations_append_only_delete
    BEFORE DELETE ON m4_learning_plan_evaluations
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_plan_evaluations is append-only');
    END;
  `);
}

export function up(db) {
  registerM4LearningAuthorityFunctions(db);
  const current = computeM4LearningPlanEvaluationFingerprintV088(db);
  if (current === EXPECTED_M4_LEARNING_PLAN_EVALUATION_FINGERPRINT_V088) return;

  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name IN (
      'm4_learning_plan_evaluations',
      'idx_m4_learning_plan_evaluations_proposal_time',
      'trg_m4_learning_plan_evaluations_exact',
      'trg_m4_learning_plan_evaluations_append_only_update',
      'trg_m4_learning_plan_evaluations_append_only_delete'
    )
  `).get().count;
  if (existing !== 0) {
    throw new Error('M4_LEARNING_PLAN_EVALUATION_088_SOURCE_OBJECT_MISMATCH');
  }

  install(db);
  const installed = computeM4LearningPlanEvaluationFingerprintV088(db);
  if (installed !== EXPECTED_M4_LEARNING_PLAN_EVALUATION_FINGERPRINT_V088) {
    throw new Error(
      `M4_LEARNING_PLAN_EVALUATION_088_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`,
    );
  }
}

export default { version, description, up };
