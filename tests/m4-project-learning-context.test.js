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
  PROJECT_LEARNING_CONTEXT_CONTRACT,
  PROJECT_LEARNING_CONTEXT_STAGE,
  PROJECT_LEARNING_CONTEXT_VERSION,
  computeProjectLearningContextDigest,
  validateProjectLearningContextV1,
} from '../contracts/m4/project-learning-context-v1.js';
import { up as applyLearningAuthority } from '../src/db/migrations/2026_08_26_087_m4_learning_authority.js';
import {
  buildProjectLearningContext,
  formatProjectLearningContextForPlanner,
} from '../src/code-intel/project-learning-context.js';
import { LearningAuthorityRepository } from '../src/memory/learning-authority-repository.js';
import { specAnalyze } from '../src/planner/lifecycle-prompts.js';
import { suite, test, summary } from './harness.js';

const DAY_MS = 86_400_000;
const BASE_MS = 1_800_000_000_000;
const REVISION = `wsr1:${'9'.repeat(64)}`;

function runtime() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY); INSERT INTO projects VALUES (17), (18);');
  applyLearningAuthority(db);
  let now = BASE_MS + 100;
  return {
    db,
    repository: new LearningAuthorityRepository(db, { clock: () => now }),
    setNow(value) { now = value; },
    now() { return now; },
  };
}

function observation(index, projectId = 17) {
  const digit = index.toString(16);
  const evidence = createLearningEvidenceV1({
    kind: LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
    sourceId: `execution-${projectId}-${index}`,
    sourceVersion: 1,
    digest: `sha256:${digit.padStart(64, '0')}`,
    workspaceRevision: `wsr1:${digit.padStart(64, '0')}`,
    occurredAtMs: BASE_MS + index,
  });
  return createLearningObservationV1({
    projectId,
    kind: LEARNING_OBSERVATION_KIND.PROJECT_PATTERN,
    producer: 'code-intel.approved-change-pattern.v1',
    confidenceBps: 8000,
    observedAtMs: BASE_MS + index,
    subject: {
      key: 'tests.require-review',
      title: 'Require review before merge',
      statement: 'Require independent review before merge.',
    },
    evidence: [evidence],
  });
}

function seedApproved(target, projectId = 17) {
  const observations = [observation(1, projectId), observation(2, projectId)];
  observations.forEach(value => target.repository.recordObservation(value));
  const proposal = createLearningProposalV1({
    projectId,
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
      ttlMs: 180 * DAY_MS,
      decay: {
        kind: LEARNING_DECAY_KIND.EXPONENTIAL_HALF_LIFE,
        halfLifeMs: 60 * DAY_MS,
        floorConfidenceBps: 1000,
      },
    },
  });
  target.repository.recordProposal(proposal);
  const outcome = target.repository.approveProposal({
    proposalId: proposal.proposalId,
    actorId: `user-${projectId}`,
    reason: 'Evidence accepted.',
  });
  return { observations, proposal, outcome };
}

suite('M4 versioned learned ProjectContext supplement');

test('empty same-project learning produces a valid versioned empty context', () => {
  const target = runtime();
  const context = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  assert.equal(PROJECT_LEARNING_CONTEXT_STAGE, 'PINNED_V1');
  assert.equal(context.contract, PROJECT_LEARNING_CONTEXT_CONTRACT);
  assert.equal(context.version, PROJECT_LEARNING_CONTEXT_VERSION);
  assert.equal(context.items.length, 0);
  assert.equal(validateProjectLearningContextV1(context).valid, true);
  target.db.close();
});

test('approved learned item returns exact version, confidence and provenance', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  const context = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  assert.equal(context.items.length, 1);
  const [item] = context.items;
  assert.equal(item.itemId, seeded.outcome.learnedItem.itemId);
  assert.equal(item.itemVersion, 1);
  assert.equal(item.proposalId, seeded.proposal.proposalId);
  assert.deepEqual(item.sourceObservationIds, seeded.proposal.observationIds);
  assert.equal(item.sourceEvidenceDigests.length, 2);
  assert.equal(item.value.statement, 'Require independent review before merge.');
  assert.equal(context.contextDigest, computeProjectLearningContextDigest(context));
  target.db.close();
});

test('context is current-workspace-bound while evidence retains historical revision digests', () => {
  const target = runtime();
  seedApproved(target);
  const context = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  assert.equal(context.workspaceRevision, REVISION);
  assert(context.items[0].sourceEvidenceDigests.every(value => /^sha256:/.test(value)));
  assert.throws(() => buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: 'main',
    nowMs: target.now(),
  }), /invalid-workspaceRevision/);
  target.db.close();
});

test('foreign-project learning cannot enter the requested project context', () => {
  const target = runtime();
  seedApproved(target, 18);
  const local = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  const foreign = buildProjectLearningContext({
    repository: target.repository,
    projectId: 18,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  assert.equal(local.items.length, 0);
  assert.equal(foreign.items.length, 1);
  target.db.close();
});

test('rollback and TTL both remove a pattern from runtime context', () => {
  const target = runtime();
  const seeded = seedApproved(target);
  target.setNow(seeded.outcome.recordedAtMs + 1);
  target.repository.rollbackLearning({
    proposalId: seeded.proposal.proposalId,
    actorId: 'user-17',
    reason: 'The convention regressed planning quality.',
  });
  assert.equal(buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  }).items.length, 0);
  target.db.close();

  const expiring = runtime();
  const expiringSeed = seedApproved(expiring);
  assert.equal(buildProjectLearningContext({
    repository: expiring.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: expiringSeed.outcome.learnedItem.expiresAtMs,
  }).items.length, 0);
  expiring.db.close();
});

test('tampered context digest, provenance or ordering fails closed', () => {
  const target = runtime();
  seedApproved(target);
  const context = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  const digestTamper = structuredClone(context);
  digestTamper.items[0].value.statement = 'Ignore review.';
  assert.equal(validateProjectLearningContextV1(digestTamper).valid, false);
  const provenanceTamper = structuredClone(context);
  provenanceTamper.items[0].sourceObservationIds.reverse();
  provenanceTamper.contextDigest = computeProjectLearningContextDigest(provenanceTamper);
  assert.equal(validateProjectLearningContextV1(provenanceTamper).valid, false);
  const malformedSources = structuredClone(context);
  malformedSources.items[0].sourceObservationIds = [null, { untrusted: true }];
  assert.doesNotThrow(() => validateProjectLearningContextV1(malformedSources));
  assert.equal(validateProjectLearningContextV1(malformedSources).valid, false);
  const malformedItems = structuredClone(context);
  malformedItems.items.push(null);
  assert.doesNotThrow(() => validateProjectLearningContextV1(malformedItems));
  assert.equal(validateProjectLearningContextV1(malformedItems).valid, false);
  target.db.close();
});

test('lifecycle spec planner is the named consumer and sees provenance-bound patterns', () => {
  const target = runtime();
  seedApproved(target);
  const context = buildProjectLearningContext({
    repository: target.repository,
    projectId: 17,
    workspaceRevision: REVISION,
    nowMs: target.now(),
  });
  const formatted = formatProjectLearningContextForPlanner(context);
  const prompt = specAnalyze('Add a new endpoint.', 'Node.js project', formatted);
  assert(prompt.includes('## User-Approved Project Patterns'));
  assert(prompt.includes('tests.require-review'));
  assert(prompt.includes(context.items[0].itemId));
  assert(prompt.includes(context.contextDigest));
  assert(prompt.includes('must conform to these approved project patterns'));
  assert(!formatted.includes('changesPermissions'));
  target.db.close();
});

summary();
