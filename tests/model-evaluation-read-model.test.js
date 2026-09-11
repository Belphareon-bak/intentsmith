import Database from 'better-sqlite3';
import { suite, test, assert, assertEqual, summary } from './harness.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import {
  ModelEvaluationReadModel,
  ModelEvaluationReadError,
} from '../src/upgrade/model-evaluation-read-model.js';
import {
  inventoryFromModelEvaluationSnapshot,
  summarizeModelEvaluationReport,
} from '../src/upgrade/model-evaluation-snapshot.js';
import { renderEvaluationReport } from '../scripts/model-evaluation-report.js';
import { compareSnapshotReplay } from '../scripts/model-evaluation-snapshot-replay.js';

const DIGEST = 'a'.repeat(64);
const OLD_DIGEST = 'b'.repeat(64);

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_evaluation_runs (
      run_id TEXT PRIMARY KEY,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      model_name TEXT NOT NULL,
      model_canonical_name TEXT NOT NULL,
      model_digest_sha256 TEXT,
      suite_name TEXT NOT NULL,
      suite_version TEXT NOT NULL,
      suite_contract_sha256 TEXT NOT NULL,
      role TEXT,
      status TEXT NOT NULL,
      score REAL,
      passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      repeats INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE model_evaluation_decisions (
      decision_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      incumbent_run_id TEXT NOT NULL,
      candidate_run_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      policy_contract_sha256 TEXT NOT NULL,
      outcome TEXT NOT NULL,
      basis TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertDecision(db, values) {
  db.prepare(`
    INSERT INTO model_evaluation_decisions (
      decision_id, role, incumbent_run_id, candidate_run_id,
      policy_version, policy_contract_sha256, outcome, basis,
      details_json, created_at
    ) VALUES (?, ?, ?, ?, 'role-pairwise-v1', ?, ?, 'quality', ?, ?)
  `).run(
    values.decisionId,
    values.role,
    values.incumbentRunId,
    values.candidateRunId,
    'd'.repeat(64),
    values.outcome,
    JSON.stringify({ activationEligible: values.activationEligible === true }),
    values.createdAt || '2026-08-24T19:00:00.000Z',
  );
}

function insert(db, values) {
  db.prepare(`
    INSERT INTO model_evaluation_runs (
      run_id, model_name, model_canonical_name, model_digest_sha256,
      suite_name, suite_version, suite_contract_sha256, role, status,
      score, passed, total, repeats, duration_ms, error_code, error_message,
      started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.runId,
    'fixture:latest',
    'fixture',
    values.digest,
    values.plan.suiteName,
    values.suiteVersion || values.plan.suiteVersion,
    values.contract || values.plan.suiteContractSha256,
    values.role || values.plan.role,
    values.status || 'COMPLETE',
    values.score ?? null,
    values.passed ?? 0,
    values.total ?? values.plan.taskCount,
    values.plan.repeats,
    values.durationMs ?? 60_000,
    values.errorCode || null,
    values.errorMessage || null,
    values.startedAt || '2026-08-24T18:00:00.000Z',
    values.completedAt || '2026-08-24T18:01:00.000Z',
  );
}

suite('ModelEvaluationReadModel');

test('exact artifact and current contract expose score and timestamp', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'complete-chat', digest: DIGEST, plan: plans.CHAT,
    score: 0.75, passed: 30,
  });
  const result = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture:latest', digest: `sha256:${DIGEST}`, size: 42 }],
    bindings: { CHAT: 'fixture' },
    bindingAuthority: { status: 'DURABLE' },
  });
  const row = result.models[0].evaluations.CHAT;
  assertEqual(row.status, 'COMPLETE');
  assertEqual(row.score, 0.75);
  assertEqual(row.testedAt, '2026-08-24T18:01:00.000Z');
  assertEqual(row.startedAt, '2026-08-24T18:00:00.000Z');
  assertEqual(row.durationMs, 60_000);
  assertEqual(row.intervalIntegrity, 'VERIFIED');
  assertEqual(row.testedAtProvenance, 'VERIFIED_COMPLETION_BOUNDARY');
  assertEqual(row.isCurrentBinding, true);
  assertEqual(result.authority.legacyFallback, false);
  assertEqual(result.authority.tables.join(','), 'model_evaluation_runs,model_evaluation_decisions');
  assertEqual(result.bindingAuthority.status, 'DURABLE');
  db.close();
});

test('legacy inconsistent interval keeps only an explicitly unverified audit timestamp', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'legacy-chat', digest: DIGEST, plan: plans.CHAT,
    score: 0.75, durationMs: 12_345,
    startedAt: '2026-08-24T18:01:00.000Z',
    completedAt: '2026-08-24T18:01:00.000Z',
  });
  const result = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture:latest', digest: DIGEST }],
  });
  const row = result.models[0].evaluations.CHAT;
  assertEqual(row.testedAt, '2026-08-24T18:01:00.000Z');
  assertEqual(row.startedAt, null);
  assertEqual(row.durationMs, null);
  assertEqual(row.intervalIntegrity, 'LEGACY_UNVERIFIED');
  assertEqual(row.testedAtProvenance, 'LEGACY_RECORDED_AT_ONLY');
  assert(renderEvaluationReport(result).includes('LEGACY_UNVERIFIED'));
  db.close();
});

test('D1 evidence remains MISSING for D2 and R1 on the shared reasoning suite', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  assertEqual(plans.D1.suiteName, plans.D2.suiteName);
  assertEqual(plans.D1.suiteContractSha256, plans.D2.suiteContractSha256);
  assertEqual(plans.D1.suiteContractSha256, plans.R1.suiteContractSha256);
  insert(db, {
    runId: 'complete-d1-only', digest: DIGEST, plan: plans.D1,
    score: 0.8, passed: 7,
  });
  const evaluations = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture:latest', digest: DIGEST }],
  }).models[0].evaluations;
  assertEqual(evaluations.D1.status, 'COMPLETE');
  assertEqual(evaluations.D2.status, 'MISSING');
  assertEqual(evaluations.R1.status, 'MISSING');
  db.close();
});

test('coverage separates missing evidence from model-role applicability', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  const result = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [
      { name: 'qwen3.5:27b', digest: DIGEST },
      { name: 'llava:13b', digest: OLD_DIGEST },
    ],
  });
  assertEqual(result.models[0].evaluations.CHAT.applicable, true);
  assertEqual(result.models[0].evaluations.VISION.applicable, false);
  assertEqual(result.models[1].evaluations.VISION.applicable, true);
  assertEqual(result.models[1].evaluations.CHAT.applicable, true);
  assertEqual(result.statusCounts.MISSING, 14);
  assertEqual(result.coverage.applicableStatusCounts.MISSING, 11);
  assertEqual(result.coverage.notApplicable, 3);
  assertEqual(result.roles.CHAT.coverage.applicableMissing, 2);
  assertEqual(result.roles.VISION.coverage.applicableMissing, 1);
  db.close();
});

test('SHA-bound snapshot inventory reproduces vision applicability offline', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  const reader = new ModelEvaluationReadModel(db, { plans });
  const original = reader.read({
    inventory: [{
      name: 'qwen3.8:latest',
      digest: DIGEST,
      size: 17_741_872_154,
      modified_at: '2026-08-23T01:35:22.827575346+02:00',
      params: '27B',
      family: 'qwen',
      category: 'general',
      capabilities: ['completion', 'vision'],
    }],
  });
  const snapshotSummary = summarizeModelEvaluationReport(original);
  const replayInventory = inventoryFromModelEvaluationSnapshot({
    readModel: snapshotSummary,
  });
  const replay = reader.read({ inventory: replayInventory });
  const replaySummary = summarizeModelEvaluationReport(replay);

  assertEqual(snapshotSummary.inventoryProjection.artifacts[0].params, 27);
  assertEqual(snapshotSummary.inventoryProjection.artifacts[0].category, 'general');
  assertEqual(
    snapshotSummary.inventoryProjection.artifacts[0].capabilities.join(','),
    'completion,vision',
  );
  assertEqual(replay.models[0].evaluations.VISION.applicable, true);
  assertEqual(
    JSON.stringify(replaySummary.coverage),
    JSON.stringify(snapshotSummary.coverage),
  );
  assertEqual(
    replaySummary.inventoryProjection.sha256,
    snapshotSummary.inventoryProjection.sha256,
  );
  const comparison = compareSnapshotReplay(snapshotSummary, replaySummary, {
    complete: 0,
    blocked: 0,
    applicableMissing: 7,
    notApplicable: 0,
  });
  assertEqual(comparison.verdict, 'PASS');
  assertEqual(comparison.checks.summaryMatchesSnapshot, true);
  assertEqual(comparison.checks.expectedCountsMatch, true);

  const tampered = JSON.parse(JSON.stringify({ readModel: snapshotSummary }));
  tampered.readModel.inventoryProjection.artifacts[0].capabilities = [];
  let error = null;
  try { inventoryFromModelEvaluationSnapshot(tampered); } catch (caught) { error = caught; }
  assert(error instanceof TypeError);
  assertEqual(error.message, 'snapshot normalized inventory projection SHA-256 mismatch');
  db.close();
});

test('raw API and CLI metadata normalize qwen3-coder into the same technical scope', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  const result = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{
      name: 'qwen3-coder:latest',
      digest: DIGEST,
      params: '30B',
      family: 'qwen',
      category: 'general',
    }],
  });
  const evaluations = result.models[0].evaluations;
  assertEqual(evaluations.D1.applicable, true);
  assertEqual(evaluations.D2.applicable, true);
  assertEqual(evaluations.R1.applicable, true);
  assertEqual(evaluations.CHAT.applicable, true);
  assertEqual(evaluations.VISION.applicable, false);
  assertEqual(result.coverage.applicableStatusCounts.MISSING, 6);
  assertEqual(result.coverage.notApplicable, 1);
  db.close();
});

test('current decision is linked to exact runs and only actionable for the bound incumbent', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'incumbent-chat', digest: DIGEST, plan: plans.CHAT,
    score: 0.6, passed: 24,
  });
  db.prepare("UPDATE model_evaluation_runs SET model_name='incumbent:latest', model_canonical_name='incumbent' WHERE run_id='incumbent-chat'").run();
  insert(db, {
    runId: 'candidate-chat', digest: OLD_DIGEST, plan: plans.CHAT,
    score: 0.8, passed: 32,
  });
  db.prepare("UPDATE model_evaluation_runs SET model_name='candidate:latest', model_canonical_name='candidate' WHERE run_id='candidate-chat'").run();
  insertDecision(db, {
    decisionId: 'decision-chat', role: 'CHAT', incumbentRunId: 'incumbent-chat',
    candidateRunId: 'candidate-chat', outcome: 'CANDIDATE', activationEligible: true,
  });
  const reader = new ModelEvaluationReadModel(db, { plans });
  const input = {
    inventory: [
      { name: 'incumbent:latest', digest: DIGEST },
      { name: 'candidate:latest', digest: OLD_DIGEST },
    ],
    bindings: { CHAT: 'incumbent' },
  };
  const result = reader.read({
    ...input,
    bindingAuthority: { status: 'DURABLE', durableRoles: ['CHAT'], verifiedRoles: ['CHAT'] },
  });
  assertEqual(result.roles.CHAT.latestDecision.decisionId, 'decision-chat');
  assertEqual(result.roles.CHAT.latestDecision.actionable, true);
  assertEqual(result.roles.CHAT.latestDecision.actionability, 'READY_FOR_MANUAL_BINDING');
  assertEqual(result.decisions.length, 1);
  const rendered = renderEvaluationReport(result);
  assert(rendered.includes('DECISION CANDIDATE'));
  assert(rendered.includes('READY_FOR_MANUAL_BINDING'));

  const degraded = reader.read({
    ...input,
    bindingAuthority: {
      status: 'DEGRADED',
      durableRoles: ['CHAT'],
      verifiedRoles: [],
      reason: 'MODEL_BINDING_STARTUP_BASELINE_FAILED',
      failures: [{ role: 'CHAT', code: 'MODEL_BINDING_PROVIDER_UNAVAILABLE' }],
    },
  });
  assertEqual(degraded.roles.CHAT.latestDecision.actionable, false);
  assertEqual(
    degraded.roles.CHAT.latestDecision.actionability,
    'BINDING_AUTHORITY_DEGRADED',
  );
  db.close();
});

test('decision disappears when either linked run has a foreign suite version', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'foreign-incumbent-chat', digest: DIGEST, plan: plans.CHAT,
    suiteVersion: `${plans.CHAT.suiteVersion}-foreign`, score: 0.6,
  });
  insert(db, {
    runId: 'current-candidate-chat', digest: OLD_DIGEST, plan: plans.CHAT,
    score: 0.8,
  });
  insertDecision(db, {
    decisionId: 'foreign-linked-decision', role: 'CHAT',
    incumbentRunId: 'foreign-incumbent-chat', candidateRunId: 'current-candidate-chat',
    outcome: 'CANDIDATE', activationEligible: true,
  });
  const role = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [
      { name: 'fixture:latest', digest: DIGEST },
      { name: 'candidate:latest', digest: OLD_DIGEST },
    ],
  }).roles.CHAT;
  assertEqual(role.latestDecision, null);
  assertEqual(role.decisions.length, 0);
  db.close();
});

test('pairwise winner without final portfolio approval is not actionable', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'incumbent-r2', digest: DIGEST, plan: plans.R2,
    score: 0.6, passed: 4,
  });
  db.prepare("UPDATE model_evaluation_runs SET model_name='incumbent:latest', model_canonical_name='incumbent' WHERE run_id='incumbent-r2'").run();
  insert(db, {
    runId: 'candidate-r2', digest: OLD_DIGEST, plan: plans.R2,
    score: 0.8, passed: 6,
  });
  db.prepare("UPDATE model_evaluation_runs SET model_name='candidate:latest', model_canonical_name='candidate' WHERE run_id='candidate-r2'").run();
  insertDecision(db, {
    decisionId: 'decision-r2', role: 'R2', incumbentRunId: 'incumbent-r2',
    candidateRunId: 'candidate-r2', outcome: 'CANDIDATE', activationEligible: false,
  });
  const decision = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [
      { name: 'incumbent:latest', digest: DIGEST },
      { name: 'candidate:latest', digest: OLD_DIGEST },
    ],
    bindings: { R2: 'incumbent' },
    bindingAuthority: { status: 'DURABLE', durableRoles: ['R2'], verifiedRoles: ['R2'] },
  }).roles.R2.latestDecision;
  assertEqual(decision.actionable, false);
  assertEqual(decision.actionability, 'PORTFOLIO_NOT_APPROVED');
  db.close();
});

test('CLI report renders every current-contract decision for a role', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'incumbent-code', digest: DIGEST, plan: plans.CODE,
    score: 0.2, passed: 1,
  });
  db.prepare("UPDATE model_evaluation_runs SET model_name='incumbent:latest', model_canonical_name='incumbent' WHERE run_id='incumbent-code'").run();
  insert(db, {
    runId: 'candidate-code', digest: OLD_DIGEST, plan: plans.CODE,
    score: 1, passed: 7,
  });
  db.prepare("UPDATE model_evaluation_runs SET model_name='candidate:latest', model_canonical_name='candidate' WHERE run_id='candidate-code'").run();
  insertDecision(db, {
    decisionId: 'code-win', role: 'CODE', incumbentRunId: 'incumbent-code',
    candidateRunId: 'candidate-code', outcome: 'CANDIDATE', activationEligible: false,
    createdAt: '2026-08-24T19:00:00.743Z',
  });
  insertDecision(db, {
    decisionId: 'code-later-incumbent', role: 'CODE', incumbentRunId: 'incumbent-code',
    candidateRunId: 'candidate-code', outcome: 'INCUMBENT', activationEligible: false,
    createdAt: '2026-08-24T19:00:00.745Z',
  });
  const result = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [
      { name: 'incumbent:latest', digest: DIGEST },
      { name: 'candidate:latest', digest: OLD_DIGEST },
    ],
    bindings: { CODE: 'incumbent' },
  });
  const rendered = renderEvaluationReport(result);
  assertEqual(result.roles.CODE.decisions.length, 2);
  assert(rendered.includes('DECISION CANDIDATE'));
  assert(rendered.includes('DECISION INCUMBENT'));
  assertEqual((rendered.match(/^  DECISION /gm) || []).length, 2);
  db.close();
});

test('same name with another digest is MISSING', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, { runId: 'old-artifact', digest: OLD_DIGEST, plan: plans.CODE, score: 1 });
  const row = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture:latest', digest: DIGEST }],
  }).models[0].evaluations.CODE;
  assertEqual(row.status, 'MISSING');
  assertEqual(row.score, null);
  db.close();
});

test('old suite contract is MISSING even for the same artifact', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'old-contract', digest: DIGEST, plan: plans.R2,
    contract: 'c'.repeat(64), score: 0.9,
  });
  const row = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture', digest: DIGEST }],
  }).models[0].evaluations.R2;
  assertEqual(row.status, 'MISSING');
  db.close();
});

test('foreign suite version is MISSING even with the same artifact and contract SHA', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'foreign-version', digest: DIGEST, plan: plans.R2,
    suiteVersion: `${plans.R2.suiteVersion}-foreign`, score: 0.9,
  });
  const row = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture', digest: DIGEST }],
  }).models[0].evaluations.R2;
  assertEqual(row.status, 'MISSING');
  db.close();
});

test('FAILED and BLOCKED are preserved without invented scores', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, {
    runId: 'blocked', digest: DIGEST, plan: plans.VISION,
    status: 'BLOCKED', errorCode: 'CANDIDATE_VRAM_FIT_FAILED',
  });
  const row = new ModelEvaluationReadModel(db, { plans }).read({
    inventory: [{ name: 'fixture', digest: DIGEST }],
  }).models[0].evaluations.VISION;
  assertEqual(row.status, 'BLOCKED');
  assertEqual(row.score, null);
  assertEqual(row.errorCode, 'CANDIDATE_VRAM_FIT_FAILED');
  db.close();
});

test('missing provider digest is BLOCKED, not MISSING or PASS', () => {
  const db = database();
  const row = new ModelEvaluationReadModel(db).read({
    inventory: [{ name: 'fixture' }],
  }).models[0].evaluations.D1;
  assertEqual(row.status, 'BLOCKED');
  assertEqual(row.errorCode, 'ARTIFACT_DIGEST_MISSING');
  db.close();
});

test('schema absence fails closed with typed 503', () => {
  const db = new Database(':memory:');
  let error = null;
  try { new ModelEvaluationReadModel(db); } catch (err) { error = err; }
  assert(error instanceof ModelEvaluationReadError);
  assertEqual(error.code, 'MODEL_EVALUATION_SCHEMA_MISSING');
  assertEqual(error.httpStatus, 503);
  db.close();
});

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
