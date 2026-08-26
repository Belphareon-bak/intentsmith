import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  LEARNING_ADAPTATION_KIND,
  LEARNING_DECAY_KIND,
  LEARNING_EVIDENCE_KIND,
  LEARNING_OBSERVATION_KIND,
  LEARNING_OUTCOME_STATUS,
  canonicalizeLearningValue,
  createLearningEvidenceV1,
  createLearningObservationV1,
  createLearningProposalV1,
} from '../contracts/m4/learning-v1.js';
import {
  EXPECTED_M4_LEARNING_AUTHORITY_FINGERPRINT_V087,
  computeM4LearningAuthorityFingerprintV087,
  up as applyLearningAuthority,
} from '../src/db/migrations/2026_08_26_087_m4_learning_authority.js';
import {
  LearningAuthorityError,
  LearningAuthorityErrorCode,
  LearningAuthorityRepository,
} from '../src/memory/learning-authority-repository.js';
import { suite, test, summary } from './harness.js';

const DAY_MS = 86_400_000;
const BASE_MS = 1_800_000_000_000;
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const REVISION_A = `wsr1:${'1'.repeat(64)}`;
const REVISION_B = `wsr1:${'2'.repeat(64)}`;

function openDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    INSERT INTO projects (id) VALUES (17), (18);
  `);
  applyLearningAuthority(db);
  return db;
}

function clockedRepository(db, initial = BASE_MS + 100) {
  let now = initial;
  return {
    repository: new LearningAuthorityRepository(db, { clock: () => now }),
    setNow(value) { now = value; },
  };
}

function evidence(suffix) {
  return createLearningEvidenceV1({
    kind: LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
    sourceId: `project-change-${suffix}`,
    sourceVersion: 1,
    digest: suffix === 'a' ? DIGEST_A : DIGEST_B,
    workspaceRevision: suffix === 'a' ? REVISION_A : REVISION_B,
    occurredAtMs: BASE_MS + (suffix === 'a' ? 1 : 2),
  });
}

function observation(suffix, projectId = 17) {
  return createLearningObservationV1({
    projectId,
    kind: LEARNING_OBSERVATION_KIND.PROJECT_PATTERN,
    producer: 'code-intel.pattern-miner.v1',
    confidenceBps: suffix === 'a' ? 7600 : 8200,
    observedAtMs: BASE_MS + (suffix === 'a' ? 10 : 20),
    subject: {
      key: 'tests.require-review',
      title: 'Require review before merge',
      statement: `Approved change ${suffix} required an independent review.`,
    },
    evidence: [evidence(suffix)],
  });
}

function proposal(source = [observation('a'), observation('b')], projectId = 17) {
  return createLearningProposalV1({
    projectId,
    observationIds: source.map(entry => entry.observationId),
    title: 'Add review convention to project context',
    rationale: 'Two approved changes used the same review convention.',
    confidenceBps: 8000,
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
      ttlMs: 90 * DAY_MS,
      decay: {
        kind: LEARNING_DECAY_KIND.EXPONENTIAL_HALF_LIFE,
        halfLifeMs: 30 * DAY_MS,
        floorConfidenceBps: 1000,
      },
    },
  });
}

function seedProposal(repository, projectId = 17) {
  const sources = [observation('a', projectId), observation('b', projectId)];
  for (const source of sources) repository.recordObservation(source);
  const value = proposal(sources, projectId);
  repository.recordProposal(value);
  return { sources, proposal: value };
}

function expectCode(operation, code) {
  assert.throws(operation, error => (
    error instanceof LearningAuthorityError && error.code === code
  ));
}

suite('M4 append-only learning authority repository');

test('migration installs the exact fingerprint and is idempotent', () => {
  const db = openDb();
  assert.equal(
    computeM4LearningAuthorityFingerprintV087(db),
    EXPECTED_M4_LEARNING_AUTHORITY_FINGERPRINT_V087,
  );
  applyLearningAuthority(db);
  assert.equal(computeM4LearningAuthorityFingerprintV087(db), EXPECTED_M4_LEARNING_AUTHORITY_FINGERPRINT_V087);
  db.close();
});

test('observation and proposal writes are exact, idempotent and immutable', () => {
  const db = openDb();
  const { repository } = clockedRepository(db);
  const seeded = seedProposal(repository);
  assert.deepEqual(repository.recordObservation(seeded.sources[0]), seeded.sources[0]);
  assert.deepEqual(repository.recordProposal(seeded.proposal), seeded.proposal);
  assert(Object.isFrozen(repository.getProposal(seeded.proposal.proposalId)));
  assert.throws(
    () => db.prepare('UPDATE m4_learning_proposals SET confidence_bps = 1').run(),
    /append-only/,
  );
  assert.throws(
    () => db.prepare('DELETE FROM m4_learning_observations').run(),
    /append-only/,
  );
  db.close();
});

test('SQL bypass rejects noncanonical bytes and indexed-field mismatches', () => {
  const db = openDb();
  const value = observation('a');
  const encoded = canonicalizeLearningValue(value);
  assert.throws(() => db.prepare(`
    INSERT INTO m4_learning_observations (
      observation_id, project_id, producer, confidence_bps, observed_at_ms, record_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(value.observationId, 18, value.producer, value.confidenceBps, value.observedAtMs, encoded),
  /M4_LEARNING_OBSERVATION_AUTHORITY_MISMATCH/);
  assert.throws(() => db.prepare(`
    INSERT INTO m4_learning_observations (
      observation_id, project_id, producer, confidence_bps, observed_at_ms, record_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(value.observationId, 17, value.producer, value.confidenceBps, value.observedAtMs, JSON.stringify(value)),
  /M4_LEARNING_OBSERVATION_AUTHORITY_MISMATCH/);
  db.close();
});

test('proposal requires every exact source and rejects foreign-project evidence', () => {
  const db = openDb();
  const { repository } = clockedRepository(db);
  const local = observation('a', 17);
  const foreign = observation('b', 18);
  repository.recordObservation(local);
  repository.recordObservation(foreign);
  const mixed = proposal([local, foreign], 17);
  expectCode(
    () => repository.recordProposal(mixed),
    LearningAuthorityErrorCode.INPUT_INVALID,
  );
  const missing = proposal([local, observation('b', 17)], 17);
  expectCode(
    () => repository.recordProposal(missing),
    LearningAuthorityErrorCode.OBSERVATION_NOT_FOUND,
  );
  db.close();
});

test('approval is a race-safe user gate with derived item identity and expiry', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const seeded = seedProposal(clock.repository);
  const outcome = clock.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Evidence accepted.',
  });
  assert.equal(outcome.status, LEARNING_OUTCOME_STATUS.APPROVED);
  assert.equal(outcome.learnedItem.itemVersion, 1);
  assert.equal(outcome.learnedItem.expiresAtMs, BASE_MS + 100 + 90 * DAY_MS);
  assert.deepEqual(outcome.learnedItem.adaptation, seeded.proposal.adaptation);
  assert.equal(clock.repository.getLearningSettlement(seeded.proposal.proposalId).state, 'active');
  expectCode(
    () => clock.repository.approveProposal({
      proposalId: seeded.proposal.proposalId,
      actorId: 'user-17',
      reason: 'Replay.',
    }),
    LearningAuthorityErrorCode.PROPOSAL_ALREADY_DECIDED,
  );
  db.close();
});

test('rejection records no learned item and cannot later be approved', () => {
  const db = openDb();
  const { repository } = clockedRepository(db);
  const seeded = seedProposal(repository);
  const outcome = repository.rejectProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Evidence rejected.',
  });
  assert.equal(outcome.learnedItem, null);
  assert.equal(repository.listActiveLearnedItems(17).length, 0);
  expectCode(
    () => repository.approveProposal({
      proposalId: seeded.proposal.proposalId,
      actorId: 'user-17',
      reason: 'Changed mind.',
    }),
    LearningAuthorityErrorCode.PROPOSAL_ALREADY_DECIDED,
  );
  db.close();
});

test('measurement binds baseline, observed score and exact version', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const seeded = seedProposal(clock.repository);
  const approved = clock.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved.',
  });
  clock.setNow(approved.recordedAtMs + 10);
  const measured = clock.repository.recordMeasurement({
    proposalId: seeded.proposal.proposalId,
    reason: 'The next plan respected the pattern.',
    measurement: {
      metric: 'plan_conformance',
      baselineScoreBps: 4000,
      observedScoreBps: 8500,
      deltaBps: 4500,
      sampleSize: 1,
    },
  });
  assert.equal(measured.status, LEARNING_OUTCOME_STATUS.MEASURED);
  assert.equal(measured.learnedItem.itemVersion, approved.learnedItem.itemVersion);
  assert.equal(measured.previousOutcomeId, approved.outcomeId);
  db.close();
});

test('weaken changes only the gated value, lowers confidence and increments version', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const seeded = seedProposal(clock.repository);
  const approved = clock.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved.',
  });
  clock.setNow(approved.recordedAtMs + 10);
  const weakened = clock.repository.weakenLearning({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Apply only to production changes.',
    confidenceBps: 6000,
    value: { statement: 'Require review for production changes only.' },
  });
  assert.equal(weakened.learnedItem.itemVersion, 2);
  assert.equal(weakened.learnedItem.confidenceBps, 6000);
  assert.equal(weakened.learnedItem.adaptation.key, approved.learnedItem.adaptation.key);
  expectCode(
    () => clock.repository.weakenLearning({
      proposalId: seeded.proposal.proposalId,
      actorId: 'user-17',
      reason: 'Not weaker.',
      confidenceBps: 6000,
      value: { statement: 'Same confidence.' },
    }),
    LearningAuthorityErrorCode.TRANSITION_INVALID,
  );
  db.close();
});

test('rollback deactivates the current exact version and delete adds a terminal tombstone', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const seeded = seedProposal(clock.repository);
  const approved = clock.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved.',
  });
  clock.setNow(approved.recordedAtMs + 10);
  const rolledBack = clock.repository.rollbackLearning({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Observed regression.',
  });
  assert.equal(rolledBack.learnedItem.active, false);
  assert.equal(clock.repository.listActiveLearnedItems(17).length, 0);
  clock.setNow(rolledBack.recordedAtMs + 10);
  const deleted = clock.repository.deleteLearning({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Forget the inactive pattern.',
  });
  assert.equal(deleted.learnedItem, null);
  expectCode(
    () => clock.repository.deleteLearning({
      proposalId: seeded.proposal.proposalId,
      actorId: 'user-17',
      reason: 'Terminal replay.',
    }),
    LearningAuthorityErrorCode.TRANSITION_INVALID,
  );
  db.close();
});

test('active learned items expose same-project provenance and deterministic decay', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const seeded = seedProposal(clock.repository);
  const approved = clock.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved.',
  });
  const items = clock.repository.listActiveLearnedItems(17, {
    nowMs: approved.recordedAtMs + 30 * DAY_MS,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].effectiveConfidenceBps, 4000);
  assert.deepEqual(items[0].observationIds, seeded.proposal.observationIds);
  assert.equal(clock.repository.listActiveLearnedItems(18).length, 0);
  db.close();
});

test('TTL expiration is explicit and never returned as active before reconciliation', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const seeded = seedProposal(clock.repository);
  const approved = clock.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved.',
  });
  assert.equal(clock.repository.expireDue(17).length, 0);
  clock.setNow(approved.learnedItem.expiresAtMs);
  assert.equal(clock.repository.listActiveLearnedItems(17).length, 0);
  const expired = clock.repository.expireDue(17);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, LEARNING_OUTCOME_STATUS.EXPIRED);
  assert.equal(clock.repository.getLearningSettlement(seeded.proposal.proposalId).state, 'expired');
  db.close();
});

test('project export is exact, ordered and isolated', () => {
  const db = openDb();
  const clock = clockedRepository(db);
  const local = seedProposal(clock.repository, 17);
  clock.repository.approveProposal({
    proposalId: local.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved.',
  });
  const foreign = seedProposal(clock.repository, 18);
  clock.repository.rejectProposal({
    proposalId: foreign.proposal.proposalId,
    actorId: 'user-18',
    reason: 'Rejected.',
  });
  const exported = clock.repository.exportProjectLearning(17);
  assert.equal(exported.projectId, 17);
  assert.equal(exported.observations.length, 2);
  assert.equal(exported.proposals.length, 1);
  assert.equal(exported.outcomes.length, 1);
  assert(exported.observations.every(entry => entry.projectId === 17));
  db.close();
});

test('a second repository observes the committed user-gate decision', () => {
  const db = openDb();
  const first = clockedRepository(db);
  const second = clockedRepository(db);
  const seeded = seedProposal(first.repository);
  first.repository.approveProposal({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'Approved once.',
  });
  expectCode(
    () => second.repository.rejectProposal({
      proposalId: seeded.proposal.proposalId,
      actorId: 'user-17',
      reason: 'Competing decision.',
    }),
    LearningAuthorityErrorCode.PROPOSAL_ALREADY_DECIDED,
  );
  db.close();
});

test('invalid authority clock and invalid project scope fail closed', () => {
  const db = openDb();
  const repository = new LearningAuthorityRepository(db, { clock: () => Number.NaN });
  const seeded = seedProposal(repository);
  expectCode(
    () => repository.approveProposal({
      proposalId: seeded.proposal.proposalId,
      actorId: 'user-17',
      reason: 'Cannot timestamp.',
    }),
    LearningAuthorityErrorCode.INPUT_INVALID,
  );
  expectCode(() => repository.listActiveLearnedItems(0), LearningAuthorityErrorCode.INPUT_INVALID);
  db.close();
});

summary();
