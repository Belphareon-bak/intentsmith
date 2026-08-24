import Database from 'better-sqlite3';
import { suite, test, assert, assertEqual, summary } from './harness.js';
import { up as up034 } from '../src/db/migrations/2026_03_12_034_v123_validation_results.js';
import { up as up033 } from '../src/db/migrations/2026_03_11_033_v121_discovered_models.js';
import { up as up038 } from '../src/db/migrations/2026_03_25_038_v132_benchmark_source.js';
import { up as up039 } from '../src/db/migrations/2026_03_26_039_v133_model_usage.js';
import { up as up041 } from '../src/db/migrations/2026_04_08_041_v136_model_universe.js';
import { up as up042 } from '../src/db/migrations/2026_04_08_042_v137_universe_reconciliation.js';
import { up as up070 } from '../src/db/migrations/2026_08_22_070_model_evaluation_history.js';
import { up as up082 } from '../src/db/migrations/2026_08_24_082_model_evaluation_consolidation.js';
import { ModelEvaluationDecisionStore } from '../src/upgrade/model-evaluation-decision-store.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CONTRACT = 'c'.repeat(64);

function consolidatedDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up033(db);
  up034(db);
  up038(db);
  up039(db);
  up041(db);
  up042(db);
  db.prepare(`
    INSERT INTO validation_results (
      model, suite, test_name, passed, score, response_preview, duration_ms, eval_tokens
    ) VALUES ('legacy:latest', 'chat', 'legacy_case', 1, 0.75, 'ok', 12, 3)
  `).run();
  db.prepare(`
    INSERT INTO validation_suite_scores (model, suite, score, passed, total, duration_ms)
    VALUES ('legacy:latest', 'chat', 0.75, 1, 1, 12)
  `).run();
  up070(db);
  up082(db);
  return db;
}

function insertRun(db, runId, digest, suite = 'chat_v3') {
  db.prepare(`
    INSERT INTO model_evaluation_runs (
      run_id, model_name, model_canonical_name, model_digest_sha256,
      suite_name, suite_version, suite_contract_sha256, role, status,
      score, passed, total, repeats, duration_ms, task_results_json,
      hardware_json, metadata_json, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, 'chat-quality-v3', ?, 'CHAT', 'COMPLETE',
      0.8, 7, 8, 3, 10, '[]', '{}', '{}',
      '2026-08-24T19:00:00.000Z', '2026-08-24T19:01:00.000Z')
  `).run(runId, `${runId}:latest`, runId, digest, suite, CONTRACT);
}

suite('Model evaluation consolidation migration and decision store');

test('082 archives all legacy payloads before removing runtime tables', () => {
  const db = consolidatedDatabase();
  const oldTables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('validation_results', 'validation_suite_scores')
  `).all();
  assertEqual(oldTables.length, 0);
  const evidence = db.prepare(`
    SELECT source_schema, payload_json
    FROM model_evaluation_import_evidence
    ORDER BY source_schema
  `).all();
  assertEqual(evidence.length, 2);
  assert(evidence.some(row => JSON.parse(row.payload_json).test_name === 'legacy_case'));
  const imported = db.prepare(
    "SELECT status, error_code FROM model_evaluation_runs WHERE run_id = 'legacy_v123_1'"
  ).get();
  assertEqual(imported.status, 'BLOCKED');
  assertEqual(imported.error_code, 'LEGACY_EXACT_IDENTITY_UNKNOWN');
  const columns = db.prepare('PRAGMA table_info(model_usage)').all().map(row => row.name);
  assert(columns.includes('model_digest_sha256'));
  const discoveryColumns = db.prepare('PRAGMA table_info(discovered_models)').all().map(row => row.name);
  assertEqual(discoveryColumns.includes('benchmarks_json'), false);
  assertEqual(discoveryColumns.includes('benchmark_confidence'), false);
  assertEqual(discoveryColumns.includes('benchmark_source'), false);
  const universeColumns = db.prepare('PRAGMA table_info(model_universe_derived)').all().map(row => row.name);
  assertEqual(universeColumns.includes('score_estimated'), false);
  assertEqual(universeColumns.includes('score_state'), false);
  db.close();
});

test('082 preflight refuses to drop an unimported legacy summary', () => {
  const db = new Database(':memory:');
  up034(db);
  up039(db);
  up070(db);
  db.prepare(`
    INSERT INTO validation_suite_scores (model, suite, score, passed, total)
    VALUES ('late:latest', 'chat', 0.5, 1, 2)
  `).run();
  let error = null;
  try { up082(db); } catch (caught) { error = caught; }
  assert(error);
  assert(String(error.message).includes('summary import preflight failed'));
  assert(db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='validation_suite_scores'"
  ).get());
  db.close();
});

test('decision store links two exact COMPLETE current-contract runs append-only', () => {
  const db = consolidatedDatabase();
  insertRun(db, 'incumbent-run', DIGEST_A);
  insertRun(db, 'candidate-run', DIGEST_B);
  const store = new ModelEvaluationDecisionStore(db);
  const row = store.recordTrial({
    role: 'CHAT',
    skipped: false,
    policy: {
      version: 'role-pairwise-v1', role: 'CHAT', suiteName: 'chat_v3',
      suiteVersion: 'chat-quality-v3', suiteContractSha256: CONTRACT,
      improvementThreshold: 0.05,
    },
    comparison: {
      incumbentRunId: 'incumbent-run', candidateRunId: 'candidate-run',
      candidateSuiteScore: 0.8, incumbentSuiteScore: 0.7, tasks: [],
    },
    decision: { winner: 'candidate', basis: 'kvalita', detail: 'fixture' },
  }, {
    candidateModel: 'candidate:latest',
    incumbentModel: 'incumbent:latest',
    activationEligible: true,
  });
  assertEqual(row.outcome, 'CANDIDATE');
  assertEqual(row.role, 'CHAT');
  assertEqual(row.incumbentRunId, 'incumbent-run');
  assertEqual(row.candidateRunId, 'candidate-run');
  assertEqual(row.policyContractSha256.length, 64);
  assertEqual(row.details.activationEligible, true);
  let updateError = null;
  try {
    db.prepare("UPDATE model_evaluation_decisions SET outcome='INCUMBENT'").run();
  } catch (caught) { updateError = caught; }
  assert(updateError);
  db.close();
});

test('decision schema rejects mismatched suite contracts', () => {
  const db = consolidatedDatabase();
  insertRun(db, 'incumbent-run', DIGEST_A, 'chat_v3');
  insertRun(db, 'candidate-run', DIGEST_B, 'reasoning_v2');
  const store = new ModelEvaluationDecisionStore(db);
  let error = null;
  try {
    store.recordTrial({
      role: 'CHAT', skipped: false,
      policy: {
        version: 'role-pairwise-v1', suiteName: 'chat_v3',
        suiteVersion: 'chat-quality-v3', suiteContractSha256: CONTRACT,
      },
      comparison: { incumbentRunId: 'incumbent-run', candidateRunId: 'candidate-run' },
      decision: { winner: 'candidate', basis: 'kvalita' },
    });
  } catch (caught) { error = caught; }
  assert(error);
  assert(String(error.message).includes('exact COMPLETE suite contract'));
  db.close();
});

test('decision store rejects a policy that does not identify the measured suite contract', () => {
  const db = consolidatedDatabase();
  insertRun(db, 'incumbent-run', DIGEST_A);
  insertRun(db, 'candidate-run', DIGEST_B);
  const store = new ModelEvaluationDecisionStore(db);
  let error = null;
  try {
    store.recordTrial({
      role: 'CHAT', skipped: false,
      policy: {
        version: 'role-pairwise-v1', suiteName: 'chat_v3',
        suiteVersion: 'chat-quality-v3', suiteContractSha256: 'd'.repeat(64),
      },
      comparison: { incumbentRunId: 'incumbent-run', candidateRunId: 'candidate-run' },
      decision: { winner: 'candidate', basis: 'kvalita' },
    });
  } catch (caught) { error = caught; }
  assert(error);
  assert(String(error.message).includes('exact COMPLETE suite contract'));
  db.close();
});

summary();
