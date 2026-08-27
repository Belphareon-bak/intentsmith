// Audit the legacy v123 summary import after the source tables are gone.
//
// The briefly shipped 086 consolidation used a weaker collision preflight.
// Its archived payload is still sufficient to verify every deterministic
// field. Rows whose source timestamp was NULL cannot be proven byte-for-byte;
// they remain non-reusable BLOCKED history and are explicitly quarantined.

export const version = '2026_08_26_096_model_evaluation_import_audit';
export const description = 'Audit and quarantine unverifiable legacy evaluation imports';

const LEGACY_CONTRACT_SHA256 = '22d7e14cb2800a9e43ee4e5c8cf093dc738e45e7b750c148ca61e26eeb7292ee';
const LEGACY_ERROR_MESSAGE = 'Legacy score retained, but exact model digest and suite contract were not stored';

function requireTable(db, name) {
  const exists = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name);
  if (!exists) throw new Error(`required pre-096 table is missing: ${name}`);
}

function canonicalLegacyName(modelName) {
  const value = String(modelName || '').toLowerCase();
  return value.endsWith(':latest') ? value.slice(0, -7) : value;
}

// SQLite REAL and JSON both use IEEE-754 doubles, but JSON serialization can
// round the final decimal by a few ULPs. Accept only a bounded four-epsilon
// representation difference; larger changes remain quarantined.
function sameArchivedReal(left, right) {
  if (left === right) return true;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= 4 * Number.EPSILON * scale;
}

function legacyImportFieldsMatch(run, payload) {
  return run
    && run.run_id === `legacy_v123_${payload.id}`
    && run.model_name === payload.model
    && run.model_canonical_name === canonicalLegacyName(payload.model)
    && run.model_digest_sha256 === null
    && run.suite_name === payload.suite
    && run.suite_version === 'legacy-v123.1'
    && run.suite_contract_sha256 === LEGACY_CONTRACT_SHA256
    && run.role === null
    && run.status === 'BLOCKED'
    && sameArchivedReal(run.score, payload.score)
    && run.passed === payload.passed
    && run.total === payload.total
    && run.repeats === 1
    && run.duration_ms === (payload.duration_ms ?? 0)
    && run.tokens_per_second === null
    && run.vram_bytes === null
    && run.task_results_json === '[]'
    && run.hardware_json === '{}'
    && run.metadata_json === '{"source":"validation_suite_scores","reusable":false}'
    && run.error_code === 'LEGACY_EXACT_IDENTITY_UNKNOWN'
    && run.error_message === LEGACY_ERROR_MESSAGE
    && run.started_at === run.completed_at;
}

export function up(db) {
  requireTable(db, 'model_evaluation_runs');
  requireTable(db, 'model_evaluation_import_evidence');

  db.exec(`
    CREATE TABLE model_evaluation_import_audits (
      source_schema TEXT NOT NULL
        CHECK (source_schema IN ('validation_results', 'validation_suite_scores')),
      source_row_id INTEGER NOT NULL
        CHECK (typeof(source_row_id) = 'integer' AND source_row_id >= 1),
      model_evaluation_run_id TEXT,
      outcome TEXT NOT NULL
        CHECK (outcome IN ('ARCHIVED', 'VERIFIED', 'QUARANTINED')),
      reason_code TEXT NOT NULL
        CHECK (length(trim(reason_code)) BETWEEN 1 AND 128),
      audited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (source_schema, source_row_id)
    );

    CREATE INDEX idx_model_evaluation_import_audits_run
      ON model_evaluation_import_audits(model_evaluation_run_id, outcome);

    CREATE TRIGGER trg_model_evaluation_import_audits_no_update
    BEFORE UPDATE ON model_evaluation_import_audits
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_import_audits is append-only');
    END;

    CREATE TRIGGER trg_model_evaluation_import_audits_no_delete
    BEFORE DELETE ON model_evaluation_import_audits
    BEGIN
      SELECT RAISE(ABORT, 'model_evaluation_import_audits is append-only');
    END;

    INSERT INTO model_evaluation_import_audits (
      source_schema, source_row_id, model_evaluation_run_id, outcome, reason_code
    )
    SELECT source_schema, source_row_id, NULL, 'ARCHIVED', 'ARCHIVE_PAYLOAD_ONLY'
    FROM model_evaluation_import_evidence
    WHERE source_schema = 'validation_results'
    ORDER BY source_row_id;
  `);

  const evidenceRows = db.prepare(`
    SELECT source_row_id, payload_json
    FROM model_evaluation_import_evidence
    WHERE source_schema = 'validation_suite_scores'
    ORDER BY source_row_id
  `).all();
  const findRun = db.prepare(
    'SELECT * FROM model_evaluation_runs WHERE run_id = ?'
  );
  const recordAudit = db.prepare(`
    INSERT INTO model_evaluation_import_audits (
      source_schema, source_row_id, model_evaluation_run_id, outcome, reason_code
    ) VALUES ('validation_suite_scores', ?, ?, ?, ?)
  `);

  for (const evidence of evidenceRows) {
    const payload = JSON.parse(evidence.payload_json);
    const runId = `legacy_v123_${payload.id}`;
    const run = findRun.get(runId);
    let outcome = 'VERIFIED';
    let reasonCode = 'EXACT_ARCHIVE_MATCH';
    if (!run) {
      outcome = 'QUARANTINED';
      reasonCode = 'IMPORTED_RUN_MISSING';
    } else if (!legacyImportFieldsMatch(run, payload)) {
      outcome = 'QUARANTINED';
      reasonCode = 'IMPORTED_RUN_MISMATCH';
    } else if (payload.validated_at === null) {
      outcome = 'QUARANTINED';
      reasonCode = 'SOURCE_TIMESTAMP_UNKNOWN';
    } else if (run.started_at !== payload.validated_at) {
      outcome = 'QUARANTINED';
      reasonCode = 'IMPORTED_RUN_MISMATCH';
    }
    recordAudit.run(evidence.source_row_id, run ? runId : null, outcome, reasonCode);
  }
}

export default { version, description, up };
