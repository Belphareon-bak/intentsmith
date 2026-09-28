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
import { up as applyLearningAuthority } from '../src/db/migrations/2026_08_26_087_m4_learning_authority.js';
import {
  LEARNING_REVIEW_CONTRACT,
  LEARNING_REVIEW_LIST_CONTRACT,
  LearningApplicationService,
} from '../src/memory/learning-application-service.js';
import { LearningAuthorityRepository } from '../src/memory/learning-authority-repository.js';
import { createLearningRoutes } from '../src/routes/learning.js';
import { suite, test, testAsync, summary } from './harness.js';

const BASE_MS = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'local-operator' });

function runtime() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL
    );
    INSERT INTO projects VALUES (17, 'active'), (18, 'active'), (19, 'archived');
  `);
  applyLearningAuthority(db);
  let now = BASE_MS + 100;
  const repository = new LearningAuthorityRepository(db, { clock: () => { now += 10; return now; } });
  const projects = { findById: db.prepare('SELECT * FROM projects WHERE id = ?') };
  const service = new LearningApplicationService({ repository, projects });
  return { db, repository, service };
}

function seed(repository, projectId, offset = 0) {
  const observations = [1, 2].map(index => {
    const value = index + offset;
    return createLearningObservationV1({
      projectId,
      kind: LEARNING_OBSERVATION_KIND.PROJECT_PATTERN,
      producer: 'code-intel.approved-change-pattern.v1',
      confidenceBps: 8000,
      observedAtMs: BASE_MS + value,
      subject: {
        key: `tests.require-review-${offset}`,
        title: 'Require review before merge',
        statement: 'Require independent review before merge.',
      },
      evidence: [createLearningEvidenceV1({
        kind: LEARNING_EVIDENCE_KIND.PROJECT_CHANGE_RESULT,
        sourceId: `execution-${projectId}-${value}`,
        sourceVersion: 1,
        digest: `sha256:${value.toString(16).padStart(64, '0')}`,
        workspaceRevision: `wsr1:${value.toString(16).padStart(64, '0')}`,
        occurredAtMs: BASE_MS + value,
      })],
    });
  });
  observations.forEach(observation => repository.recordObservation(observation));
  const proposal = createLearningProposalV1({
    projectId,
    observationIds: observations.map(observation => observation.observationId),
    title: 'Adopt project review convention',
    rationale: 'Two approved changes used the same convention.',
    confidenceBps: 8000,
    createdAtMs: BASE_MS + 20 + offset,
    adaptation: {
      kind: LEARNING_ADAPTATION_KIND.PROJECT_CONTEXT_PATTERN,
      key: `tests.require-review-${offset}`,
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
  repository.recordProposal(proposal);
  return { observations, proposal };
}

function routeHarness(service) {
  const calls = { parseBody: 0, responses: [], safeErrors: [] };
  const routes = createLearningRoutes({
    learningService: service,
    parseBody: async req => { calls.parseBody += 1; return req.body; },
    sendJSON: (res, status, payload) => {
      const response = { res, status, payload };
      calls.responses.push(response);
      return response;
    },
    safeError: error => {
      calls.safeErrors.push(error);
      return { error: 'Internal server error' };
    },
  });
  return { routes, calls };
}

function request({ body, url = '/', authenticatedSubject = SUBJECT } = {}) {
  return { body, url, authenticatedSubject };
}

suite('M4 learning HTTP application — project and evidence scope');

test('bounded list and detail expose exact same-project evidence with typed views', () => {
  const target = runtime();
  const local = seed(target.repository, 17, 10);
  seed(target.repository, 18, 20);
  const list = target.service.listProposalReviews({
    authenticatedSubject: SUBJECT,
    projectId: 17,
    state: 'pending',
    limit: 10,
  });
  assert.equal(list.contract, LEARNING_REVIEW_LIST_CONTRACT);
  assert.equal(list.projectId, 17);
  assert.equal(list.reviews.length, 1);
  assert.equal(list.reviews[0].proposal.proposalId, local.proposal.proposalId);
  assert.deepEqual(
    list.reviews[0].observations.map(observation => observation.observationId),
    local.proposal.observationIds,
  );
  assert(list.reviews[0].observations.every(observation => observation.projectId === 17));
  assert.equal(list.reviews[0].observations.flatMap(observation => observation.evidence).length, 2);
  const detail = target.service.getProposalReview({
    authenticatedSubject: SUBJECT,
    projectId: 17,
    proposalId: local.proposal.proposalId,
  });
  assert.equal(detail.contract, LEARNING_REVIEW_CONTRACT);
  assert.equal(Object.isFrozen(detail), true);
  target.db.close();
});

test('foreign proposal, archived project and malformed project ID fail closed', () => {
  const target = runtime();
  const foreign = seed(target.repository, 18, 20);
  assert.throws(() => target.service.getProposalReview({
    authenticatedSubject: SUBJECT,
    projectId: 17,
    proposalId: foreign.proposal.proposalId,
  }), error => error.code === 'M4_LEARNING_PROPOSAL_PROJECT_MISMATCH');
  assert.throws(() => target.service.listProposalReviews({
    authenticatedSubject: SUBJECT,
    projectId: 19,
  }), error => error.code === 'M4_LEARNING_PROJECT_NOT_ACTIVE');
  assert.throws(() => target.service.listProposalReviews({
    authenticatedSubject: SUBJECT,
    projectId: '17x',
  }), error => error.code === 'M4_LEARNING_PROJECT_INVALID');
  target.db.close();
});

suite('M4 learning HTTP routes — user-gated transitions');

await testAsync('missing authentication fails before request-body parsing or authority dispatch', async () => {
  const target = runtime();
  const seeded = seed(target.repository, 17, 10);
  const { routes, calls } = routeHarness(target.service);
  const params = { projectId: '17', proposalId: seeded.proposal.proposalId };
  await routes['POST /api/projects/:projectId/learning/proposals/:proposalId/approve'](
    request({
      body: { reason: 'forged' },
      authenticatedSubject: { actorType: 'system', actorId: 'forged' },
    }),
    {},
    params,
  );
  assert.equal(calls.responses.at(-1).status, 403);
  assert.equal(calls.responses.at(-1).payload.code, 'M4_LEARNING_AUTH_REQUIRED');
  assert.equal(calls.parseBody, 0);
  assert.equal(target.repository.getLearningSettlement(seeded.proposal.proposalId).state, 'pending');
  target.db.close();
});

await testAsync('approval derives actor solely from transport and replay stays a typed conflict', async () => {
  const target = runtime();
  const seeded = seed(target.repository, 17, 10);
  const { routes, calls } = routeHarness(target.service);
  const route = routes['POST /api/projects/:projectId/learning/proposals/:proposalId/approve'];
  const params = { projectId: '17', proposalId: seeded.proposal.proposalId };
  await route(request({ body: { reason: 'Evidence accepted.', actorId: 'forged-user' } }), {}, params);
  assert.equal(calls.responses.at(-1).status, 200);
  assert.equal(calls.responses.at(-1).payload.state, 'active');
  assert.deepEqual(calls.responses.at(-1).payload.currentOutcome.actor, {
    kind: 'user',
    actorId: SUBJECT.actorId,
  });
  await route(request({ body: { reason: 'Replay.' } }), {}, params);
  assert.equal(calls.responses.at(-1).status, 409);
  assert.equal(calls.responses.at(-1).payload.code, 'LEARNING_PROPOSAL_ALREADY_DECIDED');
  target.db.close();
});

await testAsync('weaken, rollback and delete preserve the append-only versioned chain', async () => {
  const target = runtime();
  const seeded = seed(target.repository, 17, 10);
  const { routes, calls } = routeHarness(target.service);
  const params = { projectId: '17', proposalId: seeded.proposal.proposalId };
  await routes['POST /api/projects/:projectId/learning/proposals/:proposalId/approve'](
    request({ body: { reason: 'Approved.' } }), {}, params,
  );
  await routes['POST /api/projects/:projectId/learning/proposals/:proposalId/weaken'](
    request({ body: {
      reason: 'Limit the convention.',
      confidenceBps: 5000,
      value: { statement: 'Require review for production changes.' },
    } }), {}, params,
  );
  assert.equal(calls.responses.at(-1).payload.currentOutcome.status, 'weakened');
  assert.equal(calls.responses.at(-1).payload.currentOutcome.learnedItem.itemVersion, 2);
  await routes['POST /api/projects/:projectId/learning/proposals/:proposalId/rollback'](
    request({ body: { reason: 'Observed regression.' } }), {}, params,
  );
  assert.equal(calls.responses.at(-1).payload.state, 'rolled_back');
  await routes['DELETE /api/projects/:projectId/learning/proposals/:proposalId'](
    request({ body: { reason: 'Forget inactive learning.' } }), {}, params,
  );
  assert.equal(calls.responses.at(-1).payload.state, 'deleted');
  assert.equal(calls.responses.at(-1).payload.currentOutcome.learnedItem, null);
  assert.equal(target.repository.exportProjectLearning(17).outcomes.length, 4);
  target.db.close();
});

await testAsync('rejection creates no learned item and exact evidence remains reviewable', async () => {
  const target = runtime();
  const seeded = seed(target.repository, 17, 10);
  const { routes, calls } = routeHarness(target.service);
  const params = { projectId: '17', proposalId: seeded.proposal.proposalId };
  await routes['POST /api/projects/:projectId/learning/proposals/:proposalId/reject'](
    request({ body: { reason: 'The evidence is not representative.' } }), {}, params,
  );
  const response = calls.responses.at(-1);
  assert.equal(response.status, 200);
  assert.equal(response.payload.state, 'rejected');
  assert.equal(response.payload.currentOutcome.learnedItem, null);
  assert.equal(response.payload.observations.length, 2);
  assert.equal(target.repository.listActiveLearnedItems(17).length, 0);
  target.db.close();
});

await testAsync('invalid filters and unexpected failures retain truthful HTTP classes', async () => {
  const target = runtime();
  seed(target.repository, 17, 10);
  const { routes, calls } = routeHarness(target.service);
  await routes['GET /api/projects/:projectId/learning/proposals'](
    request({ url: '/api/projects/19/learning/proposals' }),
    {},
    { projectId: '19' },
  );
  assert.equal(calls.responses.at(-1).status, 409);
  assert.equal(calls.responses.at(-1).payload.code, 'M4_LEARNING_PROJECT_NOT_ACTIVE');
  await routes['GET /api/projects/:projectId/learning/proposals'](
    request({ url: '/api/projects/17/learning/proposals?state=unknown&limit=101' }),
    {},
    { projectId: '17' },
  );
  assert.equal(calls.responses.at(-1).status, 400);
  assert.equal(calls.responses.at(-1).payload.code, 'LEARNING_AUTHORITY_INPUT_INVALID');

  const broken = routeHarness({
    listProposalReviews() { throw new Error('private storage path'); },
    getProposalReview() {}, approveProposal() {}, rejectProposal() {},
    weakenLearning() {}, rollbackLearning() {}, deleteLearning() {},
  });
  await broken.routes['GET /api/projects/:projectId/learning/proposals'](
    request({ url: '/api/projects/17/learning/proposals' }), {}, { projectId: '17' },
  );
  assert.equal(broken.calls.responses.at(-1).status, 500);
  assert.deepEqual(broken.calls.responses.at(-1).payload, {
    error: 'Internal server error',
    code: 'M4_LEARNING_INTERNAL_ERROR',
  });
  assert.equal(broken.calls.safeErrors.length, 1);
  target.db.close();
});

summary();
