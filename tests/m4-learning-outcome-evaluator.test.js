import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  LEARNING_ADAPTATION_KIND,
  LEARNING_DECAY_KIND,
  LEARNING_EVIDENCE_KIND,
  LEARNING_OBSERVATION_KIND,
  createLearningEvidenceV1,
  createLearningObservationV1,
  createLearningProposalV1,
} from '../contracts/m4/learning-v1.js';
import {
  LEARNING_PLAN_CONFORMANCE_STATUS,
  LEARNING_PLAN_EVALUATION_STAGE,
  computeLearningPlanResponseDigest,
  createLearningPlanEvaluationArtifactV1,
  validateLearningPlanEvaluationArtifactV1,
} from '../contracts/m4/learning-plan-evaluation-v1.js';
import { up as applyLearningAuthority } from '../src/db/migrations/2026_08_26_087_m4_learning_authority.js';
import { up as applyPlanEvaluations } from '../src/db/migrations/2026_08_26_088_m4_learning_plan_evaluations.js';
import { buildProjectLearningContext } from '../src/code-intel/project-learning-context.js';
import { computeProjectLearningContextDigest } from '../contracts/m4/project-learning-context-v1.js';
import { LearningAuthorityRepository } from '../src/memory/learning-authority-repository.js';
import {
  LearningOutcomeEvaluationError,
  createLearningOutcomeEvaluator,
} from '../src/memory/learning-outcome-evaluator.js';
import { suite, test, summary } from './harness.js';

const BASE_MS = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const REVISION = `wsr1:${'7'.repeat(64)}`;

function runtime() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY); INSERT INTO projects VALUES (17);');
  applyLearningAuthority(db);
  applyPlanEvaluations(db);
  let now = BASE_MS + 100;
  const repository = new LearningAuthorityRepository(db, { clock: () => now });
  return {
    db,
    repository,
    evaluator: createLearningOutcomeEvaluator(repository),
    setNow(value) { now = value; },
    now() { return now; },
  };
}

function seedApproved(target) {
  const observations = [1, 2].map(index => createLearningObservationV1({
    projectId: 17,
    kind: LEARNING_OBSERVATION_KIND.PROJECT_PATTERN,
    producer: 'code-intel.approved-change-pattern.v1',
    confidenceBps: 8000,
    observedAtMs: BASE_MS + index,
    subject: {
      key: 'tests.require-review',
      title: 'Require review before merge',
      statement: 'Require independent review before merge.',
    },
    evidence: [createLearningEvidenceV1({
      kind: LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
      sourceId: `execution-17-${index}`,
      sourceVersion: 1,
      digest: `sha256:${index.toString(16).padStart(64, '0')}`,
      workspaceRevision: `wsr1:${index.toString(16).padStart(64, '0')}`,
      occurredAtMs: BASE_MS + index,
    })],
  }));
  observations.forEach(value => target.repository.recordObservation(value));
  const proposal = createLearningProposalV1({
    projectId: 17,
    observationIds: observations.map(value => value.observationId),
    title: 'Adopt project review convention',
    rationale: 'Two approved changes support the same convention.',
    confidenceBps: 8000,
    createdAtMs: BASE_MS + 10,
    adaptation: {
      kind: LEARNING_ADAPTATION_KIND.PROJECT_CONTEXT_PATTERN,
      key: 'tests.require-review',
      value: { statement: 'Require independent review before merge.' },
      target: 'project_context',
      changesPermissions: false,
      changesCode: false,
      changesConfig: false,
    },
    gate: { kind: 'user', status: 'pending' },
    retention: {
      ttlMs: 90 * DAY_MS,
      decay: {
        kind: LEARNING_DECAY_KIND.EXPONENTIAL_HALF_LIFE,
        halfLifeMs: 30 * DAY_MS,
        floorConfidenceBps: 1000,
      },
    },
  });
  target.repository.recordProposal(proposal);
  const approved = target.repository.approveProposal({
    proposalId: proposal.proposalId,
    actorId: 'local-operator',
    reason: 'Evidence accepted.',
  });
  const context = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  return { proposal, approved, context };
}

function artifact(seeded, {
  status,
  contextDigest,
  generatedAtMs,
  itemId = seeded.approved.learnedItem.itemId,
  itemVersion = seeded.approved.learnedItem.itemVersion,
  key = seeded.proposal.adaptation.key,
} = {}) {
  return createLearningPlanEvaluationArtifactV1({
    projectId: 17,
    proposalId: seeded.proposal.proposalId,
    itemId,
    itemVersion,
    learningContextDigest: contextDigest,
    generatedAtMs,
    responseDigest: computeLearningPlanResponseDigest({ status, key, generatedAtMs }),
    conformance: {
      key,
      status,
      explanation: status === LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT
        ? 'No approved learning context was supplied.'
        : 'The exact approved convention was applied.',
    },
  });
}

function expectCode(operation, code) {
  assert.throws(operation, error => (
    error instanceof LearningOutcomeEvaluationError && error.code === code
  ));
}

suite('M4 exact learning plan evaluation contract');

test('artifact identity, stage, response digest and deep immutability are pinned', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const value = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  assert.equal(LEARNING_PLAN_EVALUATION_STAGE, 'PINNED_V1');
  assert.equal(validateLearningPlanEvaluationArtifactV1(value).valid, true);
  assert.equal(Object.isFrozen(value), true);
  assert.match(value.responseDigest, /^sha256:/);
  target.db.close();
});

test('tamper, unknown fields, float versions and unsupported statuses fail closed', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const value = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 300,
  });
  assert.equal(validateLearningPlanEvaluationArtifactV1({ ...value, surprise: true }).valid, false);
  assert.equal(validateLearningPlanEvaluationArtifactV1({ ...value, itemVersion: 1.5 }).valid, false);
  assert.equal(validateLearningPlanEvaluationArtifactV1({
    ...value,
    conformance: { ...value.conformance, status: 'claimed_success' },
  }).valid, false);
  target.db.close();
});

suite('M4 measured learning outcome authority');

test('exact before/after plan evidence records a version-bound positive delta', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const baseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  const observed = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 300,
  });
  target.setNow(BASE_MS + 400);
  const measured = target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: observed,
    projectLearningContext: seeded.context,
  });
  assert.equal(measured.outcome.status, 'measured');
  assert.deepEqual(measured.outcome.measurement, {
    metric: 'plan_conformance',
    baselineScoreBps: 0,
    observedScoreBps: 10000,
    deltaBps: 10000,
    sampleSize: 1,
    baselineArtifactId: baseline.artifactId,
    observedArtifactId: observed.artifactId,
  });
  assert.equal(measured.outcome.learnedItem.itemVersion, 1);
  assert(measured.outcome.reason.includes(baseline.artifactId));
  assert(measured.outcome.reason.includes(observed.artifactId));
  assert(measured.outcome.reason.includes(seeded.context.contextDigest));
  assert.deepEqual(target.repository.getPlanEvaluationArtifact(baseline.artifactId), baseline);
  assert.deepEqual(target.repository.getPlanEvaluationArtifact(observed.artifactId), observed);
  target.db.close();
});

test('an explicit request conflict counts as respecting the approved pattern boundary', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const baseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  const observed = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFLICT_EXPLICIT,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 300,
  });
  target.setNow(BASE_MS + 400);
  assert.equal(target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: observed,
    projectLearningContext: seeded.context,
  }).outcome.measurement.observedScoreBps, 10000);
  target.db.close();
});

test('baseline with learned context and observed artifact without exact context both fail', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const invalidBaseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 200,
  });
  const observed = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: `plc1:${'8'.repeat(64)}`,
    generatedAtMs: BASE_MS + 300,
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: invalidBaseline,
    observedArtifact: observed,
    projectLearningContext: seeded.context,
  }), 'LEARNING_OUTCOME_BASELINE_INVALID');
  const dishonestBaseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: dishonestBaseline,
    observedArtifact: observed,
    projectLearningContext: seeded.context,
  }), 'LEARNING_OUTCOME_BASELINE_INVALID');
  const baseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: observed,
    projectLearningContext: seeded.context,
  }), 'LEARNING_OUTCOME_CONTEXT_MISMATCH');
  target.db.close();
});

test('self-consistent but authority-divergent learning context cannot support a measurement', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const baseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  const divergentContext = structuredClone(seeded.context);
  divergentContext.items[0].value.statement = 'Skip independent review.';
  divergentContext.contextDigest = computeProjectLearningContextDigest(divergentContext);
  const observed = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: divergentContext.contextDigest,
    generatedAtMs: BASE_MS + 300,
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: observed,
    projectLearningContext: divergentContext,
  }), 'LEARNING_OUTCOME_CONTEXT_MISMATCH');
  target.db.close();
});

test('item/version/key mismatch and reversed comparison time fail before authority write', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const baseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 300,
  });
  const wrongItem = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 400,
    itemId: `lit1:${'9'.repeat(64)}`,
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: wrongItem,
    projectLearningContext: seeded.context,
  }), 'LEARNING_OUTCOME_ITEM_MISMATCH');
  const observedTooEarly = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 200,
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: observedTooEarly,
    projectLearningContext: seeded.context,
  }), 'LEARNING_OUTCOME_TIME_INVALID');
  assert.equal(target.repository.exportProjectLearning(17).outcomes.length, 1);
  target.db.close();
});

test('rolled-back learning cannot be measured even with formerly valid artifacts', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const baseline = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.ABSENT,
    contextDigest: null,
    generatedAtMs: BASE_MS + 200,
  });
  const observed = artifact(seeded, {
    status: LEARNING_PLAN_CONFORMANCE_STATUS.CONFORMED,
    contextDigest: seeded.context.contextDigest,
    generatedAtMs: BASE_MS + 300,
  });
  target.setNow(BASE_MS + 350);
  target.repository.rollbackLearning({
    proposalId: seeded.proposal.proposalId,
    actorId: 'local-operator',
    reason: 'Disable before evaluation.',
  });
  expectCode(() => target.evaluator.measurePlanConformance({
    proposalId: seeded.proposal.proposalId,
    baselineArtifact: baseline,
    observedArtifact: observed,
    projectLearningContext: seeded.context,
  }), 'LEARNING_OUTCOME_ITEM_NOT_ACTIVE');
  target.db.close();
});

summary();
