import assert from 'node:assert/strict';

import {
  LEARNING_ACTOR_KIND,
  LEARNING_ADAPTATION_KIND,
  LEARNING_CONTRACT_STAGE,
  LEARNING_CONTRACT_VERSION,
  LEARNING_DECAY_KIND,
  LEARNING_EVIDENCE_KIND,
  LEARNING_KIND,
  LEARNING_MEASUREMENT_METRIC,
  LEARNING_OBSERVATION_KIND,
  LEARNING_OUTCOME_STATUS,
  canonicalizeLearningValue,
  computeLearningItemId,
  computeLearningObservationId,
  computeLearningOutcomeId,
  computeLearningProposalId,
  createLearningEvidenceV1,
  createLearningObservationV1,
  createLearningOutcomeV1,
  createLearningProposalV1,
  validateLearningContractV1,
  validateLearningObservationV1,
  validateLearningOutcomeForProposal,
  validateLearningOutcomeTransitionV1,
  validateLearningProposalForObservations,
  validateLearningProposalV1,
} from '../contracts/m4/learning-v1.js';
import { suite, test, summary } from './harness.js';

const DAY_MS = 86_400_000;
const BASE_MS = 1_800_000_000_000;
const TTL_MS = 90 * DAY_MS;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const REVISION_A = `wsr1:${'1'.repeat(64)}`;
const REVISION_B = `wsr1:${'2'.repeat(64)}`;

function clone(value) {
  return structuredClone(value);
}

function evidence(suffix, overrides = {}) {
  return createLearningEvidenceV1({
    kind: LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
    sourceId: `project-change-${suffix}`,
    sourceVersion: 1,
    digest: suffix === 'a' ? DIGEST_A : DIGEST_B,
    workspaceRevision: suffix === 'a' ? REVISION_A : REVISION_B,
    occurredAtMs: BASE_MS + (suffix === 'a' ? 1 : 2),
    ...overrides,
  });
}

function observation(suffix, overrides = {}) {
  const entries = suffix === 'a' ? [evidence('a')] : [evidence('b')];
  return createLearningObservationV1({
    projectId: 17,
    kind: LEARNING_OBSERVATION_KIND.PROJECT_PATTERN,
    producer: 'code-intel.pattern-miner.v1',
    confidenceBps: suffix === 'a' ? 7600 : 8200,
    observedAtMs: BASE_MS + (suffix === 'a' ? 10 : 20),
    subject: {
      key: 'tests.require-review',
      title: 'Require review before merge',
      statement: `Approved change ${suffix} required an independent review.`,
    },
    evidence: entries,
    ...overrides,
  });
}

function observations() {
  return [observation('a'), observation('b')];
}

function proposal(sourceObservations = observations(), overrides = {}) {
  return createLearningProposalV1({
    projectId: 17,
    observationIds: sourceObservations.map(entry => entry.observationId),
    title: 'Add the review convention to project context',
    rationale: 'Two independently approved changes used the same review convention.',
    confidenceBps: 7900,
    createdAtMs: BASE_MS + 30,
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
      ttlMs: TTL_MS,
      decay: {
        kind: LEARNING_DECAY_KIND.EXPONENTIAL_HALF_LIFE,
        halfLifeMs: 30 * DAY_MS,
        floorConfidenceBps: 5000,
      },
    },
    ...overrides,
  });
}

function approved(sourceProposal = proposal(), overrides = {}) {
  const recordedAtMs = BASE_MS + 40;
  return createLearningOutcomeV1({
    proposalId: sourceProposal.proposalId,
    projectId: sourceProposal.projectId,
    status: LEARNING_OUTCOME_STATUS.APPROVED,
    recordedAtMs,
    actor: { kind: LEARNING_ACTOR_KIND.USER, actorId: 'user-17' },
    reason: 'The evidence supports this same-project convention.',
    previousOutcomeId: null,
    learnedItem: {
      itemId: computeLearningItemId(sourceProposal.proposalId),
      itemVersion: 1,
      active: true,
      confidenceBps: sourceProposal.confidenceBps,
      expiresAtMs: recordedAtMs + sourceProposal.retention.ttlMs,
      adaptation: clone(sourceProposal.adaptation),
    },
    measurement: null,
    ...overrides,
  });
}

function measured(sourceProposal, previous, overrides = {}) {
  return createLearningOutcomeV1({
    proposalId: sourceProposal.proposalId,
    projectId: sourceProposal.projectId,
    status: LEARNING_OUTCOME_STATUS.MEASURED,
    recordedAtMs: previous.recordedAtMs + 10,
    actor: { kind: LEARNING_ACTOR_KIND.SYSTEM, actorId: 'learning-outcome-evaluator.v1' },
    reason: 'The next approved plan conformed to the learned project pattern.',
    previousOutcomeId: previous.outcomeId,
    learnedItem: clone(previous.learnedItem),
    measurement: {
      metric: LEARNING_MEASUREMENT_METRIC.PLAN_CONFORMANCE,
      baselineScoreBps: 5000,
      observedScoreBps: 8000,
      deltaBps: 3000,
      sampleSize: 1,
    },
    ...overrides,
  });
}

suite('M4 LearningObservation/Proposal/Outcome V1 executable contract');

test('identity, stage and exact contract kinds are pinned', () => {
  assert.equal(LEARNING_CONTRACT_VERSION, 1);
  assert.equal(LEARNING_CONTRACT_STAGE, 'PINNED_V1');
  assert.deepEqual(Object.values(LEARNING_KIND), [
    'LearningObservation',
    'LearningProposal',
    'LearningOutcome',
  ]);
});

test('factories produce canonical content-addressed and deeply frozen records', () => {
  const source = observations();
  const value = proposal(source);
  assert.equal(validateLearningProposalForObservations(value, source).valid, true);
  assert(Object.isFrozen(value));
  assert(Object.isFrozen(value.adaptation));
  assert(Object.isFrozen(value.retention.decay));
  assert.match(value.proposalId, /^lpr1:[0-9a-f]{64}$/);
  assert.throws(() => { value.adaptation.changesCode = true; }, TypeError);
});

test('observation factory canonicalizes evidence order but wire validation rejects noncanonical order', () => {
  const first = evidence('a');
  const second = evidence('b');
  const canonical = observation('a', { evidence: [second, first] });
  assert(canonical.evidence[0].evidenceId < canonical.evidence[1].evidenceId);

  const noncanonical = clone(canonical);
  noncanonical.evidence.reverse();
  noncanonical.observationId = computeLearningObservationId(noncanonical);
  assert(validateLearningObservationV1(noncanonical).errors.includes(
    'learning-observation:evidence-not-canonical-order',
  ));
});

test('observation binds exact evidence digest, workspace revision and source identity', () => {
  const value = clone(observation('a'));
  value.evidence[0].digest = DIGEST_B;
  const result = validateLearningObservationV1(value);
  assert.equal(result.valid, false);
  assert(result.errors.includes('learning-observation.evidence[0]:evidenceId-mismatch'));
  assert(result.errors.includes('learning-observation:observationId-mismatch'));
});

test('unknown fields and tampered content IDs fail closed', () => {
  const value = clone(observation('a'));
  value.surprise = true;
  value.observationId = `lob1:${'f'.repeat(64)}`;
  const result = validateLearningObservationV1(value);
  assert(result.errors.includes('learning-observation:unknown-surprise'));
  assert(result.errors.includes('learning-observation:observationId-mismatch'));
});

test('proposal requires at least two exact same-project observations', () => {
  const source = observations();
  assert.equal(validateLearningProposalForObservations(proposal(source), source).valid, true);
  assert.throws(() => proposal([source[0]]), /invalid-list/);

  const foreign = observation('b', { projectId: 18 });
  const mixed = proposal([source[0], foreign]);
  assert(validateLearningProposalForObservations(mixed, [source[0], foreign]).errors.includes(
    'learning-chain:foreign-project',
  ));
  assert(validateLearningProposalForObservations(mixed, [source[0]]).errors.includes(
    'learning-chain:observation-set-mismatch',
  ));
});

test('proposal is a pending user gate and never a direct permission, code or config effect', () => {
  for (const field of ['changesPermissions', 'changesCode', 'changesConfig']) {
    const value = clone(proposal());
    value.adaptation[field] = true;
    value.proposalId = computeLearningProposalId(value);
    assert(validateLearningProposalV1(value).errors.includes(
      `learning-proposal.adaptation:${field}-forbidden`,
    ));
  }
  const direct = clone(proposal());
  direct.gate.status = 'approved';
  direct.adaptation.target = 'filesystem';
  direct.proposalId = computeLearningProposalId(direct);
  assert.equal(validateLearningProposalV1(direct).valid, false);
});

test('retention, TTL and integer-only decay policy are part of the approved proposal', () => {
  const tooLongHalfLife = clone(proposal());
  tooLongHalfLife.retention.decay.halfLifeMs = tooLongHalfLife.retention.ttlMs + 1;
  tooLongHalfLife.proposalId = computeLearningProposalId(tooLongHalfLife);
  assert(validateLearningProposalV1(tooLongHalfLife).errors.includes(
    'learning-proposal.retention.decay:invalid-halfLifeMs',
  ));

  const floating = clone(proposal());
  floating.confidenceBps = 7900.5;
  assert.equal(validateLearningProposalV1(floating).valid, false);
  assert.throws(() => canonicalizeLearningValue(floating), /non-integer-number/);
});

test('approval creates version one with a proposal-derived identity and exact expiry', () => {
  const sourceProposal = proposal();
  const outcome = approved(sourceProposal);
  assert.equal(validateLearningOutcomeForProposal(outcome, sourceProposal).valid, true);
  assert.equal(validateLearningOutcomeTransitionV1(outcome, sourceProposal).valid, true);

  const wrongExpiry = approved(sourceProposal, {
    learnedItem: { ...approved(sourceProposal).learnedItem, expiresAtMs: BASE_MS + TTL_MS },
  });
  assert(validateLearningOutcomeForProposal(wrongExpiry, sourceProposal).errors.includes(
    'learning-chain:expiresAtMs-mismatch',
  ));
});

test('rejection is a user terminal without a learned item', () => {
  const sourceProposal = proposal();
  const rejected = createLearningOutcomeV1({
    proposalId: sourceProposal.proposalId,
    projectId: sourceProposal.projectId,
    status: LEARNING_OUTCOME_STATUS.REJECTED,
    recordedAtMs: BASE_MS + 40,
    actor: { kind: LEARNING_ACTOR_KIND.USER, actorId: 'user-17' },
    reason: 'The evidence is insufficient.',
    previousOutcomeId: null,
    learnedItem: null,
    measurement: null,
  });
  assert.equal(validateLearningOutcomeTransitionV1(rejected, sourceProposal).valid, true);
});

test('measurement is system-authored, baseline-bound and preserves the item version', () => {
  const sourceProposal = proposal();
  const first = approved(sourceProposal);
  const next = measured(sourceProposal, first);
  assert.equal(validateLearningOutcomeTransitionV1(next, sourceProposal, first).valid, true);

  const badDelta = clone(next);
  badDelta.measurement.deltaBps = 2999;
  assert(validateLearningContractV1(badDelta).errors.includes(
    'learning-outcome.measurement:deltaBps-mismatch',
  ));
  assert(validateLearningOutcomeTransitionV1(next, sourceProposal).errors.includes(
    'learning-transition:previous-required',
  ));
});

test('weaken increments the version and rollback deactivates the exact item', () => {
  const sourceProposal = proposal();
  const first = approved(sourceProposal);
  const weakened = createLearningOutcomeV1({
    proposalId: sourceProposal.proposalId,
    projectId: sourceProposal.projectId,
    status: LEARNING_OUTCOME_STATUS.WEAKENED,
    recordedAtMs: first.recordedAtMs + 10,
    actor: { kind: LEARNING_ACTOR_KIND.USER, actorId: 'user-17' },
    reason: 'Use the convention only for production changes.',
    previousOutcomeId: first.outcomeId,
    learnedItem: {
      ...clone(first.learnedItem),
      itemVersion: 2,
      confidenceBps: 6500,
      adaptation: {
        ...clone(first.learnedItem.adaptation),
        value: { statement: 'Require review for production changes only.' },
      },
    },
    measurement: null,
  });
  assert.equal(validateLearningOutcomeTransitionV1(weakened, sourceProposal, first).valid, true);

  const rollback = createLearningOutcomeV1({
    proposalId: sourceProposal.proposalId,
    projectId: sourceProposal.projectId,
    status: LEARNING_OUTCOME_STATUS.ROLLED_BACK,
    recordedAtMs: weakened.recordedAtMs + 10,
    actor: { kind: LEARNING_ACTOR_KIND.USER, actorId: 'user-17' },
    reason: 'The measured outcome regressed.',
    previousOutcomeId: weakened.outcomeId,
    learnedItem: { ...clone(weakened.learnedItem), active: false },
    measurement: null,
  });
  assert.equal(validateLearningOutcomeTransitionV1(rollback, sourceProposal, weakened).valid, true);
});

test('delete is an append-only tombstone and deleted history is terminal', () => {
  const sourceProposal = proposal();
  const first = approved(sourceProposal);
  const deleted = createLearningOutcomeV1({
    proposalId: sourceProposal.proposalId,
    projectId: sourceProposal.projectId,
    status: LEARNING_OUTCOME_STATUS.DELETED,
    recordedAtMs: first.recordedAtMs + 10,
    actor: { kind: LEARNING_ACTOR_KIND.USER, actorId: 'user-17' },
    reason: 'Forget this learned convention.',
    previousOutcomeId: first.outcomeId,
    learnedItem: null,
    measurement: null,
  });
  assert.equal(validateLearningOutcomeTransitionV1(deleted, sourceProposal, first).valid, true);

  const afterDelete = measured(sourceProposal, deleted, {
    learnedItem: clone(first.learnedItem),
  });
  assert(validateLearningOutcomeTransitionV1(afterDelete, sourceProposal, deleted).errors.includes(
    'learning-transition:status-not-allowed',
  ));
});

test('actor authority is status-specific', () => {
  const sourceProposal = proposal();
  const first = approved(sourceProposal);
  const fakeUserMeasurement = clone(measured(sourceProposal, first));
  fakeUserMeasurement.actor = { kind: LEARNING_ACTOR_KIND.USER, actorId: 'user-17' };
  fakeUserMeasurement.outcomeId = computeLearningOutcomeId(fakeUserMeasurement);
  assert(validateLearningContractV1(fakeUserMeasurement).errors.includes(
    'learning-outcome:system-actor-required',
  ));

  const fakeSystemApproval = clone(approved(sourceProposal));
  fakeSystemApproval.actor = { kind: LEARNING_ACTOR_KIND.SYSTEM, actorId: 'learning-gate.v1' };
  fakeSystemApproval.outcomeId = computeLearningOutcomeId(fakeSystemApproval);
  assert(validateLearningContractV1(fakeSystemApproval).errors.includes(
    'learning-outcome:user-gate-required',
  ));
});

test('content addresses change with project, time or evidence bytes', () => {
  const first = observation('a');
  const later = observation('a', { observedAtMs: first.observedAtMs + 1 });
  const foreign = observation('a', { projectId: 18 });
  assert.notEqual(first.observationId, later.observationId);
  assert.notEqual(first.observationId, foreign.observationId);
  assert.notEqual(evidence('a').evidenceId, evidence('a', { digest: DIGEST_B }).evidenceId);
});

test('canonical serialization rejects cycles, NaN and unsupported objects', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeLearningValue(cyclic), /unsupported-value/);
  assert.throws(() => canonicalizeLearningValue({ value: Number.NaN }), /non-integer-number/);
  assert.throws(() => canonicalizeLearningValue({ value: new Date() }), /unsupported-object/);
});

summary();
