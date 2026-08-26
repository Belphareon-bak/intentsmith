// Consolidate model evaluation persistence around exact artifact contracts.
//
// Migration 070 already copied every v123 suite summary into append-only,
// non-reusable BLOCKED evidence. This migration verifies that copy, archives
// the remaining per-test payload verbatim as JSON, and only then removes the
// two obsolete runtime tables. It also adds the append-only role decision log
// and digest-binds future usage observations.

export const version = '2026_08_26_086_model_evaluation_consolidation';
export const description = 'Consolidate exact-contract evaluations, decisions and audit evidence';

function tableExists(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name));
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function requireTable(db, name) {
  if (!tableExists(db, name)) throw new Error(`required pre-086 table is missing: ${name}`);
}

export function up(db) {
  for (const table of [
    'model_evaluation_runs',
    'model_usage',
    'validation_results',
    'validation_suite_scores',
  ]) requireTable(db, table);

  // v123 remained live between migrations 070 and 086. Preserve summaries
  // written in that legitimate upgrade window with the same deliberately
  // non-reusable identity used by 070. INSERT OR IGNORE lets the integrity
  // preflight below distinguish an exact prior import from a colliding or
  // otherwise inconsistent run_id without overwriting append-only evidence.
  db.exec(`
    INSERT OR IGNORE INTO model_evaluation_runs (
      run_id, model_name, model_canonical_name, model_digest_sha256,
      suite_name, suite_version, suite_contract_sha256, role, status,
      score, passed, total, repeats, duration_ms, task_results_json,
      hardware_json, metadata_json, error_code, error_message,
      started_at, completed_at
    )
    SELECT
      'legacy_v123_' || id,
      model,
      lower(CASE WHEN model LIKE '%:latest'
        THEN substr(model, 1, length(model) - 7) ELSE model END),
      NULL,
      suite,
      'legacy-v123.1',
      '22d7e14cb2800a9e43ee4e5c8cf093dc738e45e7b750c148ca61e26eeb7292ee',
      NULL,
      'BLOCKED',
      score,
      passed,
      total,
      1,
      COALESCE(duration_ms, 0),
      '[]',
      '{}',
      '{"source":"validation_suite_scores","reusable":false}',
      'LEGACY_EXACT_IDENTITY_UNKNOWN',
      'Legacy score retained, but exact model digest and suite contract were not stored',
      COALESCE(validated_at, datetime('now')),
      COALESCE(validated_at, datetime('now'))
    FROM validation_suite_scores;
  `);

  const missingSummaryImports = db.prepare(`
    SELECT COUNT(*) AS count
    FROM validation_suite_scores legacy
    WHERE NOT EXISTS (
      SELECT 1
      FROM model_evaluation_runs current
      WHERE current.run_id = 'legacy_v123_' || legacy.id
        AND current.model_name = legacy.model
        AND current.suite_name = legacy.suite
        AND current.status = 'BLOCKED'
        AND current.model_digest_sha256 IS NULL
        AND current.score IS legacy.score
        AND current.passed = legacy.passed
        AND current.total = legacy.total
        AND current.duration_ms = COALESCE(legacy.duration_ms, 0)
        AND current.error_code = 'LEGACY_EXACT_IDENTITY_UNKNOWN'
    )
  `).get().count;
  if (missingSummaryImports !== 0) {
    throw new Error(`migration 070 summary import preflight failed for ${missingSummaryImports} row(s)`);
  }

  db.exec(`
    CREATE TABLE model_evaluation_import_evidence (
      evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_schema TEXT NOT NULL
        CHECK (source_schema IN ('validation_results', 'validation_suite_scores')),
      source_row_id INTEGER NOT NULL
        CHECK (typeof(source_row_id) = 'integer' AND source_row_id >= 1),
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(source_schema, source_row_id)
    );

    INSERT INTO model_evaluation_import_evidence(source_schema, source_row_id, payload_json)
    SELECT 'validation_results', id, json_object(
      'id', id,
      'model', model,
      'suite', suite,
      'test_name', test_name,
      'passed', passed,
      'score', score,
      'response_preview', response_preview,
      'duration_ms', duration_ms,
      'eval_tokens', eval_tokens,
      'created_at', created_at
    )
    FROM validation_results
    ORDER BY id;

    INSERT INTO model_evaluation_import_evidence(source_schema, source_row_id, payload_json)
    SELECT 'validation_suite_scores', id, json_object(
      'id', id,
      'model', model,
      'suite', suite,
      'score', score,
      'passed', passed,
      'total', total,
      'duration_ms', duration_ms,
      'validated_at', validated_at,
      'model_evaluation_run_id', 'legacy_v123_' || id
    )
    FROM validation_suite_scores
    ORDER BY id;

    CREATE TRIGGER trg_model_evaluation_import_evidence_no_update
    BEFORE UPDATE ON model_evaluation_import_evidence
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_import_evidence is append-only');
    END;

    CREATE TRIGGER trg_model_evaluation_import_evidence_no_delete
    BEFORE DELETE ON model_evaluation_import_evidence
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_import_evidence is append-only');
    END;
  `);

  const sourceEvidenceCount = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM validation_results)
      + (SELECT COUNT(*) FROM validation_suite_scores) AS count
  `).get().count;
  const archivedEvidenceCount = db.prepare(
    'SELECT COUNT(*) AS count FROM model_evaluation_import_evidence'
  ).get().count;
  if (sourceEvidenceCount !== archivedEvidenceCount) {
    throw new Error(`legacy evaluation archive preflight failed: ${sourceEvidenceCount} source, ${archivedEvidenceCount} archived`);
  }

  // v121-v132 discovery stored heuristic benchmark estimates next to factual
  // metadata. They are neither reusable evaluation evidence nor needed by the
  // current candidate inventory, so rebuild the table without those columns.
  if (tableExists(db, 'discovered_models')) {
    db.exec(`
      ALTER TABLE discovered_models RENAME TO discovered_models_pre_086;

      CREATE TABLE discovered_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        family TEXT NOT NULL,
        params REAL,
        category TEXT,
        base_vram_mb INTEGER,
        context_window INTEGER,
        capabilities_json TEXT,
        source TEXT DEFAULT 'L4',
        discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO discovered_models (
        id, name, family, params, category, base_vram_mb, context_window,
        capabilities_json, source, discovered_at, updated_at
      )
      SELECT id, name, family, params, category, base_vram_mb, context_window,
             capabilities_json, source, discovered_at, updated_at
      FROM discovered_models_pre_086
      ORDER BY id;

      DROP TABLE discovered_models_pre_086;
      CREATE INDEX idx_dm_family ON discovered_models(family);
      CREATE INDEX idx_dm_name ON discovered_models(name);
    `);
  }

  if (tableExists(db, 'model_universe_derived')) {
    db.exec(`
      ALTER TABLE model_universe_derived RENAME TO model_universe_derived_pre_086;

      CREATE TABLE model_universe_derived (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_name TEXT NOT NULL,
        tag TEXT NOT NULL DEFAULT '',
        confidence REAL,
        confidence_state TEXT DEFAULT 'LOW',
        capability_vector_json TEXT,
        recompute_at DATETIME,
        based_on_version TEXT,
        last_computed_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(model_name, tag)
      );

      INSERT INTO model_universe_derived (
        id, model_name, tag, confidence, confidence_state,
        capability_vector_json, recompute_at, based_on_version,
        last_computed_at, updated_at
      )
      SELECT id, model_name, tag, confidence, confidence_state,
             capability_vector_json, recompute_at, based_on_version,
             last_computed_at, updated_at
      FROM model_universe_derived_pre_086
      ORDER BY id;

      DROP TABLE model_universe_derived_pre_086;
      CREATE INDEX idx_ud_model ON model_universe_derived(model_name);
      CREATE INDEX idx_ud_recompute ON model_universe_derived(recompute_at);
      CREATE INDEX idx_ud_based_on_version ON model_universe_derived(based_on_version);
      CREATE INDEX idx_ud_last_computed ON model_universe_derived(last_computed_at);
    `);
  }

  db.exec(`
    DROP TABLE validation_results;
    DROP TABLE validation_suite_scores;
    DROP TABLE IF EXISTS upgrade_proposals;

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
        AND incumbent.suite_name = candidate.suite_name
        AND incumbent.suite_version = candidate.suite_version
        AND incumbent.suite_contract_sha256 = candidate.suite_contract_sha256
    )
    BEGIN
      SELECT RAISE(ABORT, 'model evaluation decision requires two exact COMPLETE runs for one suite contract');
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

  if (!hasColumn(db, 'model_usage', 'model_digest_sha256')) {
    db.exec(`
      ALTER TABLE model_usage ADD COLUMN model_digest_sha256 TEXT
        CHECK (
          model_digest_sha256 IS NULL OR (
            length(model_digest_sha256) = 64
            AND model_digest_sha256 = lower(model_digest_sha256)
            AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        );
      CREATE INDEX idx_mu_digest_used
        ON model_usage(model_digest_sha256, used_at DESC);
    `);
  }
}

export default { version, description, up };
