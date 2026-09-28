import { createHash } from 'node:crypto';

import { registerM4LearningAuthorityFunctions } from '../../memory/learning-authority-validation.js';

export const version = '2026_08_26_087_m4_learning_authority';
export const description = 'Add append-only M4 same-project learning authority';

// Filled from the canonical sqlite_master projection after installation.
export const EXPECTED_M4_LEARNING_AUTHORITY_FINGERPRINT_V087 = '322bbd740930a701bd0bb8e333abc63f65ff2601379b0f52344a9f1c6242f0e0';

const OBJECT_NAMES = Object.freeze([
  'm4_learning_observations',
  'm4_learning_proposals',
  'm4_learning_outcomes',
  'idx_m4_learning_observations_project_time',
  'idx_m4_learning_proposals_project_time',
  'idx_m4_learning_outcomes_project_time',
  'uq_m4_learning_outcomes_initial',
  'uq_m4_learning_outcomes_previous',
  'trg_m4_learning_observations_exact',
  'trg_m4_learning_proposals_exact',
  'trg_m4_learning_outcomes_exact',
  'trg_m4_learning_observations_append_only_update',
  'trg_m4_learning_observations_append_only_delete',
  'trg_m4_learning_proposals_append_only_update',
  'trg_m4_learning_proposals_append_only_delete',
  'trg_m4_learning_outcomes_append_only_update',
  'trg_m4_learning_outcomes_append_only_delete',
]);

function fingerprint(db, names) {
  const expected = new Set(names);
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

export function computeM4LearningAuthorityFingerprintV087(db) {
  return fingerprint(db, OBJECT_NAMES);
}

function installLearningAuthority(db) {
  db.exec(`
    CREATE TABLE m4_learning_observations (
      observation_id TEXT PRIMARY KEY CHECK (
        length(observation_id) = 69 AND substr(observation_id, 1, 5) = 'lob1:'
      ),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      producer TEXT NOT NULL,
      confidence_bps INTEGER NOT NULL CHECK (
        typeof(confidence_bps) = 'integer' AND confidence_bps BETWEEN 0 AND 10000
      ),
      observed_at_ms INTEGER NOT NULL CHECK (
        typeof(observed_at_ms) = 'integer' AND observed_at_ms > 0
      ),
      record_json TEXT NOT NULL UNIQUE
    );

    CREATE TABLE m4_learning_proposals (
      proposal_id TEXT PRIMARY KEY CHECK (
        length(proposal_id) = 69 AND substr(proposal_id, 1, 5) = 'lpr1:'
      ),
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      confidence_bps INTEGER NOT NULL CHECK (
        typeof(confidence_bps) = 'integer' AND confidence_bps BETWEEN 0 AND 10000
      ),
      created_at_ms INTEGER NOT NULL CHECK (
        typeof(created_at_ms) = 'integer' AND created_at_ms > 0
      ),
      record_json TEXT NOT NULL UNIQUE
    );

    CREATE TABLE m4_learning_outcomes (
      outcome_id TEXT PRIMARY KEY CHECK (
        length(outcome_id) = 69 AND substr(outcome_id, 1, 5) = 'lou1:'
      ),
      proposal_id TEXT NOT NULL
        REFERENCES m4_learning_proposals(proposal_id) ON DELETE RESTRICT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (
        status IN ('approved', 'rejected', 'measured', 'weakened', 'rolled_back', 'deleted', 'expired')
      ),
      recorded_at_ms INTEGER NOT NULL CHECK (
        typeof(recorded_at_ms) = 'integer' AND recorded_at_ms > 0
      ),
      previous_outcome_id TEXT
        REFERENCES m4_learning_outcomes(outcome_id) ON DELETE RESTRICT,
      record_json TEXT NOT NULL UNIQUE
    );

    CREATE INDEX idx_m4_learning_observations_project_time
      ON m4_learning_observations(project_id, observed_at_ms, observation_id);
    CREATE INDEX idx_m4_learning_proposals_project_time
      ON m4_learning_proposals(project_id, created_at_ms, proposal_id);
    CREATE INDEX idx_m4_learning_outcomes_project_time
      ON m4_learning_outcomes(project_id, recorded_at_ms, outcome_id);
    CREATE UNIQUE INDEX uq_m4_learning_outcomes_initial
      ON m4_learning_outcomes(proposal_id)
      WHERE previous_outcome_id IS NULL;
    CREATE UNIQUE INDEX uq_m4_learning_outcomes_previous
      ON m4_learning_outcomes(previous_outcome_id)
      WHERE previous_outcome_id IS NOT NULL;

    CREATE TRIGGER trg_m4_learning_observations_exact
    BEFORE INSERT ON m4_learning_observations
    WHEN m4_learning_observation_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.observationId') IS NOT NEW.observation_id
      OR json_extract(NEW.record_json, '$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.record_json, '$.producer') IS NOT NEW.producer
      OR json_extract(NEW.record_json, '$.confidenceBps') IS NOT NEW.confidence_bps
      OR json_extract(NEW.record_json, '$.observedAtMs') IS NOT NEW.observed_at_ms
    BEGIN
      SELECT RAISE(ABORT, 'M4_LEARNING_OBSERVATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m4_learning_proposals_exact
    BEFORE INSERT ON m4_learning_proposals
    WHEN m4_learning_proposal_valid_v1(NEW.record_json) != 1
      OR json_extract(NEW.record_json, '$.proposalId') IS NOT NEW.proposal_id
      OR json_extract(NEW.record_json, '$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.record_json, '$.confidenceBps') IS NOT NEW.confidence_bps
      OR json_extract(NEW.record_json, '$.createdAtMs') IS NOT NEW.created_at_ms
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.record_json, '$.observationIds') source
        LEFT JOIN m4_learning_observations observation
          ON observation.observation_id = source.value
        WHERE observation.observation_id IS NULL
           OR observation.project_id != NEW.project_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'M4_LEARNING_PROPOSAL_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m4_learning_outcomes_exact
    BEFORE INSERT ON m4_learning_outcomes
    WHEN json_extract(NEW.record_json, '$.outcomeId') IS NOT NEW.outcome_id
      OR json_extract(NEW.record_json, '$.proposalId') IS NOT NEW.proposal_id
      OR json_extract(NEW.record_json, '$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.record_json, '$.status') IS NOT NEW.status
      OR json_extract(NEW.record_json, '$.recordedAtMs') IS NOT NEW.recorded_at_ms
      OR json_extract(NEW.record_json, '$.previousOutcomeId') IS NOT NEW.previous_outcome_id
      OR NOT EXISTS (
        SELECT 1
        FROM m4_learning_proposals proposal
        LEFT JOIN m4_learning_outcomes previous
          ON previous.outcome_id = NEW.previous_outcome_id
        WHERE proposal.proposal_id = NEW.proposal_id
          AND proposal.project_id = NEW.project_id
          AND (NEW.previous_outcome_id IS NULL OR (
            previous.proposal_id = NEW.proposal_id
            AND previous.project_id = NEW.project_id
          ))
          AND m4_learning_outcome_transition_valid_v1(
            NEW.record_json,
            proposal.record_json,
            previous.record_json
          ) = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'M4_LEARNING_OUTCOME_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m4_learning_observations_append_only_update
    BEFORE UPDATE ON m4_learning_observations
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_observations is append-only');
    END;
    CREATE TRIGGER trg_m4_learning_observations_append_only_delete
    BEFORE DELETE ON m4_learning_observations
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_observations is append-only');
    END;
    CREATE TRIGGER trg_m4_learning_proposals_append_only_update
    BEFORE UPDATE ON m4_learning_proposals
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_proposals is append-only');
    END;
    CREATE TRIGGER trg_m4_learning_proposals_append_only_delete
    BEFORE DELETE ON m4_learning_proposals
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_proposals is append-only');
    END;
    CREATE TRIGGER trg_m4_learning_outcomes_append_only_update
    BEFORE UPDATE ON m4_learning_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_outcomes is append-only');
    END;
    CREATE TRIGGER trg_m4_learning_outcomes_append_only_delete
    BEFORE DELETE ON m4_learning_outcomes
    BEGIN
      SELECT RAISE(ABORT, 'm4_learning_outcomes is append-only');
    END;
  `);
}

export function up(db) {
  registerM4LearningAuthorityFunctions(db);
  const current = computeM4LearningAuthorityFingerprintV087(db);
  if (current === EXPECTED_M4_LEARNING_AUTHORITY_FINGERPRINT_V087) return;

  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name GLOB 'm4_learning_*'
       OR name GLOB 'trg_m4_learning_*'
       OR name GLOB 'idx_m4_learning_*'
       OR name GLOB 'uq_m4_learning_*'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M4_LEARNING_AUTHORITY_087_SOURCE_OBJECT_MISMATCH');
  }

  installLearningAuthority(db);
  const installed = computeM4LearningAuthorityFingerprintV087(db);
  if (installed !== EXPECTED_M4_LEARNING_AUTHORITY_FINGERPRINT_V087) {
    throw new Error(`M4_LEARNING_AUTHORITY_087_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
