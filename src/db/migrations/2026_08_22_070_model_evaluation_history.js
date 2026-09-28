import { createHash } from 'node:crypto';

// Append-only history for role-specific model evaluation.
//
// Legacy validation_suite_scores intentionally keeps its last-value contract.
// This table is the durable prototype authority: exact model artifact + exact
// suite contract. Old rows remain evidence when a suite changes.

export const version = '2026_08_22_070_model_evaluation_history';
export const description = 'Add append-only exact-artifact model evaluation history';

const REQUIRED_COLUMNS = [
  'run_id', 'model_name', 'model_canonical_name', 'model_digest_sha256',
  'suite_name', 'suite_version', 'suite_contract_sha256', 'role', 'status',
  'score', 'passed', 'total', 'repeats', 'duration_ms', 'tokens_per_second',
  'vram_bytes', 'task_results_json', 'hardware_json', 'metadata_json',
  'error_code', 'error_message', 'started_at', 'completed_at',
];

const PRE070_SCHEMA_SHA256 = new Map([
  ['table:model_evaluation_runs', 'acb494dd73ee0021d65f7b07295a45dc7cc3cdf86e03581dbdcd3bc2f7a7a357'],
  ['index:idx_model_eval_complete_artifact_contract', 'f7005e36e56ff575bb9cfd97b73cda4f75da1fa3a6c98f771dee654c56c6254d'],
  ['index:idx_model_eval_model_history', '32fd5c9430528413e33a8a594d97b4b20be123388e84033d07f62a8a898378ff'],
  ['index:idx_model_eval_suite_history', '1299902b2a01edaa7d773487bc89050fae15fc48b69603dc3bac0148b40d03cc'],
  ['trigger:trg_model_evaluation_runs_no_update', '421efb8a8934d347b850ed28bf45f89147fd3099320b604fe629565735858f89'],
  ['trigger:trg_model_evaluation_runs_no_delete', '76764d3b5ae5bed1e4eade360d3071c315755077aa92e21c3e02a2104d005319'],
]);

function schemaSha256(sql) {
  const normalized = String(sql || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * The evaluation table briefly shipped under migration identity 068 before a
 * cross-branch collision was found. A DB that already ran those exact bytes
 * must be adopted by 070; an unrelated or partial table must still fail closed.
 */
function adoptExactPre070Schema(db) {
  const table = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_evaluation_runs'
  `).get();
  if (!table) return false;

  const columns = new Set(db.prepare('PRAGMA table_info(model_evaluation_runs)').all().map(row => row.name));
  const missingColumns = REQUIRED_COLUMNS.filter(name => !columns.has(name));
  const extraColumns = [...columns].filter(name => !REQUIRED_COLUMNS.includes(name));
  const invalidObjects = [];
  for (const [key, expectedSha256] of PRE070_SCHEMA_SHA256) {
    const [type, name] = key.split(':');
    const row = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = ? AND name = ?
    `).get(type, name);
    if (!row || schemaSha256(row.sql) !== expectedSha256) invalidObjects.push(name);
  }
  if (missingColumns.length || extraColumns.length || invalidObjects.length) {
    throw new Error(`existing model_evaluation_runs is not the exact pre-070 schema; `
      + `missing columns: ${missingColumns.join(', ') || 'none'}; extra columns: `
      + `${extraColumns.join(', ') || 'none'}; invalid objects: `
      + `${invalidObjects.join(', ') || 'none'}`);
  }
  return true;
}

export function up(db) {
  if (adoptExactPre070Schema(db)) return;
  db.exec(`
    CREATE TABLE model_evaluation_runs (
      run_id TEXT PRIMARY KEY
        CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      model_canonical_name TEXT NOT NULL
        CHECK (length(trim(model_canonical_name)) BETWEEN 1 AND 512),
      model_digest_sha256 TEXT
        CHECK (
          model_digest_sha256 IS NULL OR (
            length(model_digest_sha256) = 64
            AND model_digest_sha256 = lower(model_digest_sha256)
            AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
      suite_name TEXT NOT NULL
        CHECK (length(trim(suite_name)) BETWEEN 1 AND 128),
      suite_version TEXT NOT NULL
        CHECK (length(trim(suite_version)) BETWEEN 1 AND 128),
      suite_contract_sha256 TEXT NOT NULL
        CHECK (
          length(suite_contract_sha256) = 64
          AND suite_contract_sha256 = lower(suite_contract_sha256)
          AND suite_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      role TEXT
        CHECK (role IS NULL OR length(trim(role)) BETWEEN 1 AND 16),
      status TEXT NOT NULL
        CHECK (status IN ('COMPLETE', 'FAILED', 'BLOCKED')),
      score REAL
        CHECK (score IS NULL OR (score >= 0.0 AND score <= 1.0)),
      passed INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(passed) = 'integer' AND passed >= 0),
      total INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(total) = 'integer' AND total >= 0),
      repeats INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(repeats) = 'integer' AND repeats >= 1),
      duration_ms INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
      tokens_per_second REAL
        CHECK (tokens_per_second IS NULL OR tokens_per_second >= 0),
      vram_bytes INTEGER
        CHECK (vram_bytes IS NULL OR (typeof(vram_bytes) = 'integer' AND vram_bytes >= 0)),
      task_results_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(task_results_json)),
      hardware_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(hardware_json)),
      metadata_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(metadata_json)),
      error_code TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      CHECK (status <> 'COMPLETE' OR (model_digest_sha256 IS NOT NULL AND score IS NOT NULL))
    );

    CREATE UNIQUE INDEX idx_model_eval_complete_artifact_contract
      ON model_evaluation_runs(
        model_digest_sha256,
        suite_name,
        suite_contract_sha256
      )
      WHERE status = 'COMPLETE';

    CREATE INDEX idx_model_eval_model_history
      ON model_evaluation_runs(model_canonical_name, completed_at DESC);

    CREATE INDEX idx_model_eval_suite_history
      ON model_evaluation_runs(suite_name, suite_contract_sha256, completed_at DESC);

    -- Preserve every legacy last-value row that still exists. Those tables did
    -- not store an artifact digest or suite source hash, so the import is
    -- intentionally non-reusable BLOCKED evidence rather than invented truth.
    INSERT INTO model_evaluation_runs (
      run_id, model_name, model_canonical_name, model_digest_sha256,
      suite_name, suite_version, suite_contract_sha256, role, status,
      score, passed, total, repeats, duration_ms, task_results_json,
      hardware_json, metadata_json, error_code, error_message,
      started_at, completed_at
    )
    SELECT
      'legacy_v123_' || id,
      model,
      lower(CASE WHEN model LIKE '%:latest' THEN substr(model, 1, length(model) - 7) ELSE model END),
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

    CREATE TRIGGER trg_model_evaluation_runs_no_update
    BEFORE UPDATE ON model_evaluation_runs
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_runs is append-only');
    END;

    CREATE TRIGGER trg_model_evaluation_runs_no_delete
    BEFORE DELETE ON model_evaluation_runs
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_runs is append-only');
    END;
  `);
}

export default { version, description, up };
