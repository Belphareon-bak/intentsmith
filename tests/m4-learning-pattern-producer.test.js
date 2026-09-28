import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  M2_EXECUTION_CONTRACT_KIND,
  M2_EXECUTION_CONTRACT_VERSION,
} from '../contracts/m2/execution-v1.js';
import {
  LEARNING_EVIDENCE_KIND,
  LEARNING_OUTCOME_STATUS,
} from '../contracts/m4/learning-v1.js';
import { up as applyLearningAuthority } from '../src/db/migrations/2026_08_26_087_m4_learning_authority.js';
import {
  M4_LEARNING_PATTERN_PRODUCER,
  LearningPatternProducerError,
  createLearningPatternProducer,
} from '../src/code-intel/learning-pattern-producer.js';
import { LearningAuthorityRepository } from '../src/memory/learning-authority-repository.js';
import { suite, test, summary } from './harness.js';

const BASE_MS = Date.parse('2026-08-26T08:00:00.000Z');
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const HEAD = '3'.repeat(40);

function openRuntime() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY); INSERT INTO projects VALUES (17), (18);');
  applyLearningAuthority(db);
  let now = BASE_MS + 100_000;
  const repository = new LearningAuthorityRepository(db, { clock: () => now });
  return {
    db,
    repository,
    producer: createLearningPatternProducer(repository),
    setNow(value) { now = value; },
  };
}

function result(index, projectId = 17, overrides = {}) {
  const completedAt = new Date(BASE_MS + index * 1000).toISOString();
  const afterRevision = `wsr1:${index.toString(16).padStart(64, '0')}`;
  return {
    contract: M2_EXECUTION_CONTRACT_KIND.RESULT,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: `execution-${projectId}-${index}`,
    requestDigest: DIGEST_A,
    runId: `run-${projectId}-${index}`,
    projectId,
    terminalStatus: 'succeeded',
    fencingGeneration: 1,
    startedAt: new Date(BASE_MS + index * 1000 - 100).toISOString(),
    completedAt,
    changes: {
      paths: ['src/app.js'],
      beforeRevision: BEFORE_REVISION,
      afterRevision,
      diffDigest: DIGEST_B,
    },
    focusedTest: {
      effectId: `effect-test-${projectId}-${index}`,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: DIGEST_A,
      stderrDigest: DIGEST_B,
      outputTruncated: false,
    },
    git: {
      status: 'not_requested',
      beforeHead: HEAD,
      afterHead: HEAD,
      commitId: null,
      foreignDirtPreserved: true,
    },
    rollback: {
      required: false,
      status: 'not_required',
      paths: [],
      evidenceRef: null,
    },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    key: 'tests.require-review',
    title: 'Require review before merge',
    statement: 'Require independent review before merge.',
    confidenceBps: 8000,
    ...overrides,
  };
}

function expectProducerCode(operation, code) {
  assert.throws(operation, error => (
    error instanceof LearningPatternProducerError && error.code === code
  ));
}

suite('M4 Code Intelligence learning pattern producer');

test('only a valid succeeded ProjectChangeResult can produce an observation', () => {
  const runtime = openRuntime();
  const failed = result(1, 17, { terminalStatus: 'failed', errorCode: 'FOCUSED_TEST_FAILED' });
  expectProducerCode(
    () => runtime.producer.recordApprovedChangePattern({ result: failed, candidate: candidate() }),
    'LEARNING_PATTERN_RESULT_NOT_APPROVED_SUCCESS',
  );
  const invalid = { ...result(1), surprise: true };
  expectProducerCode(
    () => runtime.producer.recordApprovedChangePattern({ result: invalid, candidate: candidate() }),
    'LEARNING_PATTERN_RESULT_INVALID',
  );
  runtime.db.close();
});

test('observation pins exact result and Code Intelligence evidence', () => {
  const runtime = openRuntime();
  const observation = runtime.producer.recordApprovedChangePattern({
    result: result(1),
    candidate: candidate(),
  });
  assert.equal(observation.producer, M4_LEARNING_PATTERN_PRODUCER);
  assert.equal(observation.projectId, 17);
  assert.deepEqual(
    new Set(observation.evidence.map(entry => entry.kind)),
    new Set([
      LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
      LEARNING_EVIDENCE_KIND.CODE_INTELLIGENCE,
    ]),
  );
  assert(observation.evidence.every(entry => entry.workspaceRevision === result(1).changes.afterRevision));
  assert.deepEqual(
    runtime.producer.recordApprovedChangePattern({ result: result(1), candidate: candidate() }),
    observation,
  );
  runtime.db.close();
});

test('one approved change never creates a proposal', () => {
  const runtime = openRuntime();
  runtime.producer.recordApprovedChangePattern({ result: result(1), candidate: candidate() });
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(17).length, 0);
  assert.equal(runtime.repository.exportProjectLearning(17).proposals.length, 0);
  runtime.db.close();
});

test('two distinct approved changes create one pending proposal and no effect', () => {
  const runtime = openRuntime();
  runtime.producer.recordApprovedChangePattern({ result: result(1), candidate: candidate() });
  runtime.producer.recordApprovedChangePattern({ result: result(2), candidate: candidate() });
  const proposals = runtime.producer.proposeRepeatedProjectPatterns(17);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].gate.status, 'pending');
  assert.equal(proposals[0].observationIds.length, 2);
  assert.equal(proposals[0].adaptation.changesPermissions, false);
  assert.equal(proposals[0].adaptation.changesCode, false);
  assert.equal(proposals[0].adaptation.changesConfig, false);
  assert.equal(runtime.repository.getLearningSettlement(proposals[0].proposalId).state, 'pending');
  assert.equal(runtime.repository.exportProjectLearning(17).outcomes.length, 0);
  runtime.db.close();
});

test('two observations from one execution are not independent repetitions', () => {
  const runtime = openRuntime();
  runtime.producer.recordApprovedChangePattern({ result: result(1), candidate: candidate() });
  runtime.producer.recordApprovedChangePattern({
    result: result(1),
    candidate: candidate({ statement: 'Require review before production merge.' }),
  });
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(17).length, 0);
  runtime.db.close();
});

test('pending and active patterns suppress duplicate proposals', () => {
  const runtime = openRuntime();
  for (const index of [1, 2]) {
    runtime.producer.recordApprovedChangePattern({ result: result(index), candidate: candidate() });
  }
  const [pending] = runtime.producer.proposeRepeatedProjectPatterns(17);
  runtime.producer.recordApprovedChangePattern({ result: result(3), candidate: candidate() });
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(17).length, 0);
  runtime.repository.approveProposal({
    proposalId: pending.proposalId,
    actorId: 'user-17',
    reason: 'Approve the repeated pattern.',
  });
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(17).length, 0);
  runtime.db.close();
});

test('rejected proposal can be reconsidered only with new evidence', () => {
  const runtime = openRuntime();
  for (const index of [1, 2]) {
    runtime.producer.recordApprovedChangePattern({ result: result(index), candidate: candidate() });
  }
  const [first] = runtime.producer.proposeRepeatedProjectPatterns(17);
  runtime.repository.rejectProposal({
    proposalId: first.proposalId,
    actorId: 'user-17',
    reason: 'Need more evidence.',
  });
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(17).length, 0);
  runtime.producer.recordApprovedChangePattern({ result: result(3), candidate: candidate() });
  const [second] = runtime.producer.proposeRepeatedProjectPatterns(17);
  assert(second);
  assert.notEqual(second.proposalId, first.proposalId);
  assert.equal(second.observationIds.length, 3);
  runtime.db.close();
});

test('producer is strictly same-project and never mixes a foreign observation', () => {
  const runtime = openRuntime();
  runtime.producer.recordApprovedChangePattern({ result: result(1, 17), candidate: candidate() });
  runtime.producer.recordApprovedChangePattern({ result: result(2, 18), candidate: candidate() });
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(17).length, 0);
  assert.equal(runtime.producer.proposeRepeatedProjectPatterns(18).length, 0);
  runtime.db.close();
});

test('approved proposal becomes a provenance-bearing active learned item', () => {
  const runtime = openRuntime();
  for (const index of [1, 2]) {
    runtime.producer.recordApprovedChangePattern({ result: result(index), candidate: candidate() });
  }
  const [proposal] = runtime.producer.proposeRepeatedProjectPatterns(17);
  const approved = runtime.repository.approveProposal({
    proposalId: proposal.proposalId,
    actorId: 'user-17',
    reason: 'Evidence accepted.',
  });
  assert.equal(approved.status, LEARNING_OUTCOME_STATUS.APPROVED);
  const [item] = runtime.repository.listActiveLearnedItems(17);
  assert.equal(item.proposalId, proposal.proposalId);
  assert.deepEqual(item.observationIds, proposal.observationIds);
  assert.equal(item.adaptation.value.statement, candidate().statement);
  runtime.db.close();
});

test('proposal source set is bounded to the eight most recent observations', () => {
  const runtime = openRuntime();
  for (let index = 1; index <= 10; index += 1) {
    runtime.producer.recordApprovedChangePattern({ result: result(index), candidate: candidate() });
  }
  const [proposal] = runtime.producer.proposeRepeatedProjectPatterns(17);
  assert.equal(proposal.observationIds.length, 8);
  const included = new Set(proposal.observationIds);
  const exported = runtime.repository.exportProjectLearning(17).observations;
  const oldest = [...exported]
    .sort((left, right) => left.observedAtMs - right.observedAtMs)
    .slice(0, 2);
  assert(oldest.every(observation => !included.has(observation.observationId)));
  runtime.db.close();
});

test('candidate contract rejects unknown fields and noninteger confidence', () => {
  const runtime = openRuntime();
  expectProducerCode(
    () => runtime.producer.recordApprovedChangePattern({
      result: result(1),
      candidate: { ...candidate(), changesCode: true },
    }),
    'LEARNING_PATTERN_CANDIDATE_INVALID',
  );
  expectProducerCode(
    () => runtime.producer.recordApprovedChangePattern({
      result: result(1),
      candidate: candidate({ confidenceBps: 8000.5 }),
    }),
    'LEARNING_PATTERN_CANDIDATE_INVALID',
  );
  runtime.db.close();
});

summary();
