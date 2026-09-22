import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import Database from 'better-sqlite3';
import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
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
// Read-model fixtures only; durable acceptance and revocation are exercised
// against the real store in evaluation-grading-acceptance.test.mjs.
function reviewedPlans(role) {
  const plans = createRoleEvaluationPlans({repeats:1});
  return {...plans,[role]:{...plans[role],acceptance:{graders:[{id:'fixture-grader',payloadSha256:DIGEST}]}}};
}
function markReviewed(db, id) {
  db.prepare('UPDATE model_evaluation_runs SET metadata_json=? WHERE run_id=?').run(JSON.stringify({
    grading:{graderAcceptanceId:'fixture-grader',graderAcceptanceSha256:DIGEST}}), id);
}

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
  const plans = reviewedPlans('CHAT');
  insert(db, {
    runId: 'complete-chat', digest: DIGEST, plan: plans.CHAT,
    score: 0.75, passed: 30,
  });
  markReviewed(db, 'complete-chat');
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

test('D1 evidence remains MISSING for D2 and R1 on distinct role suites', () => {
  const db = database();
  const plans = reviewedPlans('D1');
  assert(plans.D1.suiteName !== plans.D2.suiteName);
  assert(plans.D1.suiteContractSha256 !== plans.D2.suiteContractSha256);
  assert(plans.D1.suiteContractSha256 !== plans.R1.suiteContractSha256);
  insert(db, {
    runId: 'complete-d1-only', digest: DIGEST, plan: plans.D1,
    score: 0.8, passed: 7,
  });
  markReviewed(db, 'complete-d1-only');
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
  // Explicitly qualified synthetic plans exercise the remaining activation gates.
  const plans = Object.fromEntries(Object.entries(createRoleEvaluationPlans({ repeats: 1 })).map(([role,p]) => [role,{...p,decisionReady:true,qualificationForRuns:undefined,acceptance:null}]));
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
  const foreignRuntime=reader.read({...input,runtimeProviderVersion:'foreign-runtime',
    bindingAuthority:{status:'DURABLE',durableRoles:['CHAT'],verifiedRoles:['CHAT']}});
  assertEqual(foreignRuntime.roles.CHAT.latestDecision.actionability,'RUNTIME_PROVIDER_NOT_QUALIFIED');
  assertEqual(foreignRuntime.roles.CHAT.latestDecision.actionable,false);
  const unavailableRuntime=reader.read({...input,runtimeProviderVersion:null,
    bindingAuthority:{status:'DURABLE',durableRoles:['CHAT'],verifiedRoles:['CHAT']}});
  assertEqual(unavailableRuntime.roles.CHAT.latestDecision.actionability,'RUNTIME_PROVIDER_UNAVAILABLE');

  const exploratory = new ModelEvaluationReadModel(db, {plans:createRoleEvaluationPlans({repeats:1})}).read({
    ...input,bindingAuthority:{status:'DURABLE',durableRoles:['CHAT'],verifiedRoles:['CHAT']}});
  assertEqual(exploratory.roles.CHAT.latestDecision.actionable,false);
  assertEqual(exploratory.roles.CHAT.latestDecision.actionability,'EVALUATION_PROFILE_NOT_ACCEPTED');
  assertEqual(exploratory.roles.CHAT.measurementReady,true);
  assertEqual(exploratory.roles.CHAT.collectionOnly,true);

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
  insert(db,{runId:'candidate-remeasured',digest:OLD_DIGEST,plan:plans.CHAT,score:.2});
  const newer=reader.read({...input,bindingAuthority:{status:'DURABLE',durableRoles:['CHAT'],verifiedRoles:['CHAT']}});
  assertEqual(newer.roles.CHAT.latestDecision.actionability,'EVALUATION_REPLACED');
  assertEqual(newer.roles.CHAT.latestDecision.actionable,false);
  assert(newer.history.some(r=>r.runId==='candidate-chat'),'original evidence retained');
  assert(newer.history.some(r=>r.runId==='candidate-remeasured'&&r.current),'latest evidence selected');
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
  // Explicitly qualified synthetic plans exercise the remaining activation gates.
  const plans = Object.fromEntries(Object.entries(createRoleEvaluationPlans({ repeats: 1 })).map(([role,p]) => [role,{...p,decisionReady:true,qualificationForRuns:undefined,acceptance:null}]));
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

test('§4: history read preserves missing task scores and the reason/count of excluded attempts', () => {
  const db = database(); db.exec("ALTER TABLE model_evaluation_runs ADD COLUMN task_results_json TEXT NOT NULL DEFAULT '[]'");
  const plans = createRoleEvaluationPlans({ repeats: 3 });
  insert(db, { runId: 'invalid-task', digest: DIGEST, plan: plans.CODE, status: 'FAILED' });
  db.prepare('UPDATE model_evaluation_runs SET task_results_json=?, metadata_json=? WHERE run_id=?').run(
    JSON.stringify([{ name: 'patch', repeat: 2, mean: null, scores: [null], details: [
      { valid: false, outcome: 'ENVIRONMENT_INVALID', reason: 'fixture missing' },
    ] }]), JSON.stringify({ attemptCounts: { planned: 21, observed: 8, invalid: 1,
      operationalFailure: 0, notAttempted: 13 } }), 'invalid-task');
  const row = new ModelEvaluationReadModel(db, { plans }).readRun('invalid-task');
  assertEqual(row.score, null); assertEqual(row.tasks[0].mean, null);
  assertEqual(row.tasks[0].repeat, 2); assertEqual(row.tasks[0].details[0].valid, false);
  assertEqual(row.tasks[0].details[0].outcome, 'ENVIRONMENT_INVALID');
  assertEqual(row.attemptCounts.notAttempted, 13); db.close();
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

test('provider-filtered coverage replays offline and its filter cannot be tampered', () => {
  const db = database();
  const plans = createRoleEvaluationPlans({ repeats: 1 });
  insert(db, { runId: 'legacy-provider', digest: DIGEST, plan: plans.CODE, score: 0.9 });
  const reader = new ModelEvaluationReadModel(db, { plans });
  const inventory = [{ name: 'fixture:latest', digest: DIGEST, params: 14 }];
  const providerVersion = '0.34.0-intentsmith.1';
  const missing = reader.read({ inventory, providerVersion });
  assertEqual(missing.models[0].evaluations.CODE.status, 'MISSING');
  assertEqual(missing.models[0].evaluations.CODE.missingReason, 'PROVIDER_CHANGED');
  assert(renderEvaluationReport(missing).includes(`Provider filtr: ${providerVersion}`));
  insert(db, { runId: 'current-provider', digest: DIGEST, plan: plans.CODE, score: 0.4 });
  db.prepare('UPDATE model_evaluation_runs SET metadata_json = ? WHERE run_id = ?')
    .run(JSON.stringify({ provider: { version: providerVersion } }), 'current-provider');
  const result = reader.read({ inventory, providerVersion });
  assertEqual(result.models[0].evaluations.CODE.score, 0.4);
  const snapshot = { readModel: summarizeModelEvaluationReport(result) };
  const replayInventory = inventoryFromModelEvaluationSnapshot(snapshot);
  const replay = summarizeModelEvaluationReport(reader.read({
    inventory: replayInventory, providerVersion: snapshot.readModel.inventoryProjection.providerVersion,
  }));
  assertEqual(replay.inventoryProjection.sha256, snapshot.readModel.inventoryProjection.sha256);
  assertEqual(JSON.stringify(replay.coverage), JSON.stringify(snapshot.readModel.coverage));
  const tampered = JSON.parse(JSON.stringify(snapshot));
  tampered.readModel.inventoryProjection.providerVersion = '0.35.0';
  let denied = false;
  try { inventoryFromModelEvaluationSnapshot(tampered); } catch (error) { denied = /SHA-256 mismatch/.test(error.message); }
  assert(denied);
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

test('historical detail uses the exact requested run and preserves failed grading checks', () => {
  const db = database(), plans = createRoleEvaluationPlans();
  db.exec("ALTER TABLE model_evaluation_runs ADD COLUMN task_results_json TEXT DEFAULT '[]'");
  insert(db, { runId:'older', digest:DIGEST, plan:plans.CODE, score:.114 });
  insert(db, { runId:'newer', digest:DIGEST, plan:plans.CODE, score:.9 });
  const taskName=plans.CODE.suite.tests.find(t=>t.contractMaterial?.gradingInputs?.oracleCase==='75b5539f8cf5').name;
  const tasks=[{name:taskName,mean:.8,scores:[.8,.8,.8],details:[{targetedPassed:4,targeted:5,schema:true,testFiles:['tests/fixture.js'],targetNames:['target assertion'],regressionNames:['existing assertion'],testOutput:'❌ target assertion: expected stable identity',contractChecks:{passed:false,checks:[{name:'existing reader',passed:false}]},formatScore:0,contentScore:1,parts:[{id:'fails',ok:false}],penalties:[{id:'regression'}]}]}];
  db.prepare('UPDATE model_evaluation_runs SET task_results_json=? WHERE run_id=?').run(JSON.stringify(tasks),'older');
  const read=new ModelEvaluationReadModel(db,{plans});
  const old=read.readRun('older'); assertEqual(old.score,.114); assertEqual(old.tasks[0].details[0].targetedPassed,4);
  assertEqual(old.tasks[0].details[0].parts[0].ok,false);
  assertEqual(old.tasks[0].details[0].contractChecks.checks[0].passed,false);
  assertEqual(old.tasks[0].details[0].testOutput,'❌ target assertion: expected stable identity');
  assertEqual(old.tasks[0].details[0].targetNames[0],'target assertion');
  assertEqual(old.tasks[0].details[0].regressionNames[0],'existing assertion');
  assertEqual(old.tasks[0].details[0].testFiles[0],'tests/fixture.js');
  assertEqual(old.tasks[0].details[0].formatScore,0);assertEqual(old.tasks[0].details[0].contentScore,1); assertEqual(old.catalogMatchesContract,true);
  const task=old.taskCatalog.find(t=>t.name===taskName);
  assertEqual(task.label,'Typ chyby při ukládání odpovědi');
  assert(task.requirements.some(text=>text.includes('ChatPersistenceError')));
  db.prepare('UPDATE model_evaluation_runs SET suite_contract_sha256=? WHERE run_id=?').run('f'.repeat(64),'older');
  assertEqual(read.readRun('older').catalogMatchesContract,false);assertEqual(read.readRun('older').taskCatalog.length,0);
  let missing;try{read.readRun("older' OR 1=1 --");}catch(e){missing=e;}
  assertEqual(missing.httpStatus,404);db.close();
});

const studioSource = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/chat-panel-module.js', import.meta.url), 'utf8');
function studioFunction(name, endMarker) {
  const start = studioSource.indexOf('function ' + name + '(');
  const end = studioSource.indexOf(endMarker, start);
  assert(start >= 0 && end > start, 'literal shipped Studio function must exist');
  return studioSource.slice(start, end);
}

test('§4: shipped Studio detail renders an invalid attempt as missing, with its count and reason', () => {
  const render = studioSource.slice(studioSource.indexOf('var _evaluationRoleFilter='),studioSource.indexOf('/* ═',studioSource.indexOf('var _evaluationRoleFilter=')));
  const row = { model: 'candidate', status: 'FAILED', suiteName: 'code_patch', score: null,
    attemptCounts: { planned: 6, observed: 3, notAttempted: 3, invalid: 1, operationalFailure: 1 },
    tasks: [{ name: 'invalid', repeat: 2, mean: null, scores: [null], details: [
      { valid: false, outcome: 'ENVIRONMENT_INVALID', reason: 'fixture missing' },
    ] }] };
  const view = JSON.stringify(runInNewContext(render+';_qualityDetail(row,{})', {
    row, C:{}, _rgba:()=>'', _fs:n=>n, h:(tag,props,...children)=>({tag,props,children}),
  }));
  assert(view.includes('Celkové skóre chybí')); assert(view.includes('neplatné prostředí 1'));
  assert(view.includes('nezahájeno 3')); assert(view.includes('pokus 2'));
  assert(view.includes('fixture missing')); assert(view.includes('Opakování: —'));
  assert(!view.includes('0.0 %'), 'null must never be shown as a zero-quality repair');
});

test('quality tables separate role scores from chronological provider evidence', () => {
  const render = studioSource.slice(studioSource.indexOf('var _evaluationRoleFilter='),studioSource.indexOf('/* ═',studioSource.indexOf('var _evaluationRoleFilter=')));
  const context = {
    _evaluationLoading:false,_assigningRole:null,_evaluationModelFilter:'',_modelTestPending:false,_modelTestTarget:null,
    _huntDuration:()=> '2 min',_settingsVals:{},
    _evaluationData:{history:[{runId:'new',model:'measured:1',role:'R2',status:'COMPLETE',score:.75,providerVersion:'0.34.0-intentsmith.1'},
      {runId:'old',model:'historical:1',role:'R2',status:'BLOCKED',score:null}],roles:{R2:{suiteName:'review_v2',tasks:[{name:'alpha',label:'Review actual defect'}],
      artifacts:[{model:'measured:1',status:'COMPLETE',score:.75,tasks:[{name:'alpha',mean:.75,spread:0,scores:[.75,.75,.75]}]},
        {model:'historical:1',status:'BLOCKED',score:null}]}}},
    C:{},_rgba:()=>'',_fs:n=>n,h:(tag,props,...children)=>({tag,props,children}),
  };
  const helpers=studioSource.slice(studioSource.indexOf('function _modelButtonStyle('),studioSource.indexOf('var _huntData='));
  const quality=JSON.stringify(runInNewContext(helpers+render+';_renderEvaluationsTab()',context));
  assert(quality.includes('75.0 %'));assert(quality.includes('Blokováno'));assert(quality.includes('Review actual defect'));assert(quality.includes('measured:1')&&quality.includes('historical:1'));
  assert(!quality.includes('0.34.0-intentsmith.1'),'provider metadata belongs to History');
  const history=JSON.stringify(runInNewContext(helpers+render+';_renderEvaluationHistory()',context));
  assert(history.includes('0.34.0-intentsmith.1'));assert(history.includes('Nezaznamenána'));assert(history.includes('Blokováno'));
});

await testAsync('scoring refresh rejects HTTP errors and recovers on the next explicit read', async () => {
  const source = studioSource.slice(studioSource.indexOf('function _modelReadError('),studioSource.indexOf('function _resetModelReads(')) + studioFunction('_loadEvaluationData', '/* Installed models cache');
  let succeed = false; let calls = 0;
  const context = {
    _evaluationLoading: false, _evaluationData: null, _backendUrl: () => 'http://127.0.0.1:1234', _modelReadEpoch: 0,
    AbortSignal, renderCenter() {},
    fetch: async url => {
      assertEqual(url, 'http://127.0.0.1:1234/api/system/models/evaluations'); calls++;
      return { ok: succeed, status: succeed ? 200 : 503, json: async () => ({ providerVersion: 'exact', roles: {} }) };
    },
  };
  runInNewContext(source + ';_loadEvaluationData();_loadEvaluationData()', context);
  await new Promise(resolve => setImmediate(resolve));
  assertEqual(calls, 1);
  assertEqual(context._evaluationData.error, 'Načtení dat selhalo (HTTP 503).');
  succeed = true;
  runInNewContext('_loadEvaluationData()', context);
  await new Promise(resolve => setImmediate(resolve));
  assertEqual(calls, 2);
  assertEqual(context._evaluationData.providerVersion, 'exact');
  assertEqual(context._evaluationLoading, false);
});


test('shipped score detail exposes preservation failures and separates content from format', () => {
  const body=studioSource.slice(studioSource.indexOf('var _evaluationRoleFilter='),studioSource.indexOf('/* ═',studioSource.indexOf('var _evaluationRoleFilter=')));
  const t={details:[{targeted:8,targetedPassed:8,contentScore:1,formatScore:0,contractChecks:{passed:false,checks:[{name:'shared reader MODEL_VALIDATION',passed:false,reason:'owner rejected'}]},criteria:[{id:'count',score:0,expected:12,observed:8}]}]};
  const notes=runInNewContext(body+';_taskResultNotes(t)',{t});
  assert(notes.some(n=>n.includes('MODEL_VALIDATION')&&n.includes('owner rejected')));
  assert(notes.some(n=>n.includes('Obsah: 100.0 %')));
  assert(notes.some(n=>n.includes('formát nesplněn')));
  assert(notes.some(n=>n.includes('count: očekáváno 12, vráceno 8')));
});

test('Studio displays captured answers on demand without inventing a grade or rendering answer HTML', () => {
  const render=studioSource.slice(studioSource.indexOf('var _evaluationRoleFilter='),studioSource.indexOf('/* ═',studioSource.indexOf('var _evaluationRoleFilter=')));
  const helpers=studioSource.slice(studioSource.indexOf('function _modelButtonStyle('),studioSource.indexOf('var _huntData='));
  const label=studioFunction('_huntEvaluationText','function _huntDuration(');
  const row={runId:'raw',role:'D1',model:'fixture',status:'AWAITING_REVIEW',score:null,
    collection:{status:'AWAITING_REVIEW',observed:3,planned:3,budgetExhausted:1},tasks:[{name:'t',mean:null}]};
  const detail={...row,tasks:[{name:'t',input:{text:'Actual prompt'},rubric:['Required evidence'],
    responses:['<img src=x onerror=alert(1)>','answer two','unfinished'],details:[{captureStatus:'CAPTURED'},{captureStatus:'CAPTURED'},{captureStatus:'OUTPUT_BUDGET_EXHAUSTED'}]}]};
  let loaded=null;
  const context={row,C:{},_rgba:()=>'',_fs:n=>n,h:(tag,props,...children)=>({tag,props,children}),
    _modelTestPending:false,_historyExpanded:{},renderCenter(){},_readModelResource:(url,done)=>{loaded=url;done(detail);}};
  const tree=runInNewContext(helpers+label+render+';_qualityDetail(row,{})',context);
  const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.children)];
  const load=nodes(tree).find(n=>n.tag==='button'&&n.children.includes('Zobrazit uložené odpovědi'));assert(load);
  load.props.onClick();assertEqual(loaded,'/api/system/models/evaluations/raw');
  context.row=detail;
  const full=runInNewContext(helpers+label+render+';_qualityDetail(row,{})',context);
  const text=JSON.stringify(full);assert(text.includes('3/3 odpovědí'));assert(text.includes('čeká na posouzení'));
  assert(text.includes('Actual prompt'));assert(text.includes('Required evidence'));assert(text.includes('Vyčerpán limit výstupu'));
  assert(nodes(full).some(n=>n.tag==='pre'&&n.children.includes('<img src=x onerror=alert(1)>')));
  assert(!nodes(full).some(n=>n.tag==='img'||n.props?.dangerouslySetInnerHTML));
  assert(!text.includes('0.0 %'));assert(!text.includes('skóre 0 %'));
});

await testAsync('stored-answer grading shows missing acceptance in History and clears a cancelled preview', async () => {
  const handler = studioFunction('_gradeStoredAnswers', 'setInterval(');
  const toastStart = studioSource.indexOf("_modelTestMessage&&(_upgradeTab");
  const toast = studioSource.slice(toastStart, studioSource.indexOf('/* body */', toastStart)).trim().replace(/,$/, '');
  let accepted = false;
  const calls = [];
  const context = {
    _modelTestPending: false, _modelTestMessage: null, _modelTestFailed: false, _upgradeTab: 'history',
    _backendUrl: () => 'http://127.0.0.1:1234', renderCenter() {}, AbortSignal, confirm: () => false,
    C: {}, _fs: n => n, h: (tag, props, ...children) => ({tag, props, children}),
    fetch: async (url, options) => {
      calls.push({url, method: options.method || 'GET'});
      return {ok: true, json: async () => ({model: 'fixture', role: 'D1',
        graders: accepted ? [{id: 'accepted', judge: {modelName: 'judge'}}] : [],
        code: accepted ? null : 'EVALUATION_GRADER_ACCEPTANCE_MISSING'})};
    },
  };
  runInNewContext(handler + ';_gradeStoredAnswers("raw")', context);
  await new Promise(resolve => setImmediate(resolve));
  let rendered = runInNewContext(toast, context);
  assertEqual(rendered.props.role, 'alert');
  assert(rendered.children[0].includes('nový test není potřeba'));
  assertEqual(context._modelTestPending, false);
  accepted = true;
  runInNewContext('_gradeStoredAnswers("raw")', context);
  await new Promise(resolve => setImmediate(resolve));
  rendered = runInNewContext(toast, context);
  assertEqual(rendered.props.role, 'status');
  assertEqual(rendered.children[0], 'Hodnocení nebylo spuštěno.');
  assert(calls.every(c => c.method === 'GET'), 'neither refusal may launch GPU work');
});

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
