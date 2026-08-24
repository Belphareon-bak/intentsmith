#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, testAsync, summary } from './harness.js';
import {
  M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS,
} from '../src/lifecycle/m2-legacy-lifecycle-quarantine.js';
import { createM2LifecycleRoutes } from '../src/routes/m2-lifecycle.js';

const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'local-operator' });
const SIGNAL = new AbortController().signal;
const NEW_ROUTE_KEYS = Object.freeze([
  'POST /api/m2/lifecycle/prepare',
  'POST /api/m2/lifecycle/approve',
  'POST /api/m2/lifecycle/cancel',
  'GET /api/m2/lifecycle/status',
]);

function makeHarness(overrides = {}) {
  const calls = {
    parseBody: [],
    responses: [],
    prepare: [],
    approve: [],
    cancel: [],
    status: [],
    safeError: [],
  };
  const service = {
    async prepareSmallProjectChange(input) {
      calls.prepare.push(input);
      return { state: 'awaiting_approval', lifecycleId: 'lifecycle-1' };
    },
    async approveSmallProjectChange(input) {
      calls.approve.push(input);
      return { state: 'succeeded', lifecycleId: input.lifecycleId };
    },
    async cancelSmallProjectChange(input) {
      calls.cancel.push(input);
      return { state: 'cancelled', lifecycleId: input.lifecycleId };
    },
    async getSmallProjectChangeStatus(input) {
      calls.status.push(input);
      return { state: 'awaiting_approval', lifecycleId: input.lifecycleId };
    },
    ...(overrides.service || {}),
  };
  const dependencies = {
    m2LifecycleService: service,
    parseBody: async req => {
      calls.parseBody.push(req);
      return req.body;
    },
    sendJSON: (res, status, payload) => {
      const response = { res, status, payload };
      calls.responses.push(response);
      return response;
    },
    safeError: error => {
      calls.safeError.push(error);
      return { ok: true, error: 'Internal server error', errorId: 'E-test' };
    },
    ...(overrides.dependencies || {}),
  };
  return {
    calls,
    routes: createM2LifecycleRoutes(dependencies),
  };
}

function request(body = undefined, extra = {}) {
  return {
    authenticatedSubject: SUBJECT,
    body,
    signal: SIGNAL,
    url: '/api/m2/lifecycle/status?id=lifecycle-1',
    ...extra,
  };
}

suite('M2 lifecycle HTTP routes — exact forwarding');

test('route map exposes four M2 operations before the complete legacy quarantine overlay', () => {
  const { routes } = makeHarness();
  assert.equal(Object.isFrozen(routes), true);
  assert.deepEqual(Object.keys(routes), [
    ...NEW_ROUTE_KEYS,
    ...M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS,
  ]);
});

await testAsync('prepare forwards only transport subject, bounded origin, proposal, project id, and signal', async () => {
  const { routes, calls } = makeHarness();
  const proposal = Object.freeze({ intent: 'exact change', changes: [], focusedTest: {} });
  const response = {};
  await routes['POST /api/m2/lifecycle/prepare'](request({
    projectId: 17,
    projectPath: '/forged/project',
    path: '/forged/path',
    actor: { type: 'user', id: 'forged-actor' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
      projectPath: '/forged/origin-project',
      path: '/forged/origin-path',
      actor: { type: 'user', id: 'forged-origin-actor' },
    },
    proposal,
  }), response);

  assert.equal(calls.prepare.length, 1);
  assert.deepEqual(calls.prepare[0], {
    authenticatedSubject: SUBJECT,
    projectId: 17,
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    proposal,
    signal: SIGNAL,
  });
  assert.deepEqual(Object.keys(calls.prepare[0]), [
    'authenticatedSubject', 'projectId', 'origin', 'proposal', 'signal',
  ]);
  assert.deepEqual(calls.responses.at(-1), {
    res: response,
    status: 200,
    payload: { state: 'awaiting_approval', lifecycleId: 'lifecycle-1' },
  });
});

await testAsync('approve, cancel, and status forward their exact operation identities and ownership subject', async () => {
  const { routes, calls } = makeHarness();

  await routes['POST /api/m2/lifecycle/approve'](request({
    lifecycleId: 'lifecycle-2',
    planDigest: 'sha256:plan',
    actor: { type: 'user', id: 'forged' },
    projectPath: '/forged',
    origin: {
      surface: 'studio', sessionId: 'session-2',
      conversationId: 'conversation-2', projectId: 17,
      actor: { type: 'user', id: 'forged-origin' }, path: '/forged',
    },
  }), {});
  await routes['POST /api/m2/lifecycle/cancel'](request({
    lifecycleId: 'lifecycle-3',
    reason: 'operator_cancelled',
    actor: { type: 'user', id: 'forged' },
    path: '/forged',
    origin: {
      surface: 'studio', sessionId: 'session-3',
      conversationId: 'conversation-3', projectId: 17,
      actor: { type: 'user', id: 'forged-origin' }, projectPath: '/forged',
    },
  }), {});
  await routes['GET /api/m2/lifecycle/status'](request(undefined, {
    url: '/api/m2/lifecycle/status?id=lifecycle-4&surface=studio&sessionId=session-4'
      + '&conversationId=conversation-4&projectId=17&actor=forged&path=%2Ftmp',
  }), {});

  assert.deepEqual(calls.approve, [{
    authenticatedSubject: SUBJECT,
    lifecycleId: 'lifecycle-2',
    planDigest: 'sha256:plan',
    origin: {
      surface: 'studio', sessionId: 'session-2',
      conversationId: 'conversation-2', projectId: 17,
    },
    signal: SIGNAL,
  }]);
  assert.deepEqual(calls.cancel, [{
    authenticatedSubject: SUBJECT,
    lifecycleId: 'lifecycle-3',
    reason: 'operator_cancelled',
    origin: {
      surface: 'studio', sessionId: 'session-3',
      conversationId: 'conversation-3', projectId: 17,
    },
    signal: SIGNAL,
  }]);
  assert.deepEqual(calls.status, [{
    authenticatedSubject: SUBJECT,
    lifecycleId: 'lifecycle-4',
    origin: {
      surface: 'studio', sessionId: 'session-4',
      conversationId: 'conversation-4', projectId: 17,
    },
  }]);
});

suite('M2 lifecycle HTTP routes — auth and error truth');

await testAsync('missing, malformed, or non-user authentication fails before body parsing and service dispatch', async () => {
  const { routes, calls } = makeHarness();
  const unauthenticated = [
    request({}, { authenticatedSubject: null }),
    request({}, { authenticatedSubject: { actorType: 'system', actorId: 'system-1' } }),
    request({}, { authenticatedSubject: { actorType: 'user', actorId: '   ' } }),
  ];

  for (const req of unauthenticated) {
    for (const routeKey of NEW_ROUTE_KEYS) {
      await routes[routeKey](req, {});
      const response = calls.responses.at(-1);
      assert.equal(response.status, 403);
      assert.equal(response.payload.code, 'M2_LIFECYCLE_AUTH_REQUIRED');
      assert.equal(response.payload.ok, undefined);
    }
  }

  assert.equal(calls.parseBody.length, 0);
  assert.equal(calls.prepare.length, 0);
  assert.equal(calls.approve.length, 0);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.status.length, 0);
});

await testAsync('typed service failures map to stable non-2xx classes and unknown failures stay sanitized 500', async () => {
  const cases = [
    ['M2_LIFECYCLE_CONTRACT_INVALID', 400],
    ['M2_LIFECYCLE_INPUT_INVALID', 400],
    ['M2_LIFECYCLE_AUTH_FORBIDDEN', 403],
    ['M2_LIFECYCLE_CONTEXT_STALE', 409],
    ['PROJECT_CHANGE_AUTHORITY_INCOMPLETE', 409],
    ['M2_LIFECYCLE_NOT_FOUND', 404],
    ['M2_LIFECYCLE_UNAVAILABLE', 503],
    ['M2_LIFECYCLE_UNEXPECTED_BUG', 500],
  ];

  for (const [code, expectedStatus] of cases) {
    const error = Object.assign(new Error(`failure ${code}`), { code });
    const { routes, calls } = makeHarness({
      service: {
        async prepareSmallProjectChange() { throw error; },
      },
    });
    await routes['POST /api/m2/lifecycle/prepare'](request({}), {});
    const response = calls.responses.at(-1);
    assert.equal(response.status, expectedStatus, code);
    assert.equal(response.payload.ok, undefined, code);
    assert.notEqual(response.status, 200, code);
    if (expectedStatus === 500) {
      assert.equal(response.payload.code, 'M2_LIFECYCLE_INTERNAL_ERROR');
      assert.equal(response.payload.error, 'Internal server error');
      assert.equal(calls.safeError.length, 1);
    } else {
      assert.equal(response.payload.code, code);
      assert.equal(calls.safeError.length, 0);
    }
  }
});

await testAsync('status without id is typed input 400 and never reaches ownership lookup', async () => {
  const { routes, calls } = makeHarness();
  await routes['GET /api/m2/lifecycle/status'](request(undefined, {
    url: '/api/m2/lifecycle/status',
  }), {});
  assert.equal(calls.status.length, 0);
  assert.equal(calls.responses.at(-1).status, 400);
  assert.equal(calls.responses.at(-1).payload.code, 'M2_LIFECYCLE_INPUT_INVALID');
});

suite('M2 lifecycle HTTP routes — legacy mutation quarantine');

await testAsync('every legacy mutating route returns exact 410 without body parsing or service calls', async () => {
  const { routes, calls } = makeHarness();
  for (const routeKey of M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS) {
    await routes[routeKey](new Proxy({}, {
      get(_target, property) {
        throw new Error(`${routeKey} read request property ${String(property)}`);
      },
    }), {});
    const response = calls.responses.at(-1);
    assert.equal(response.status, 410);
    assert.equal(response.payload.code, 'LEGACY_LIFECYCLE_RETIRED');
    assert.equal(response.payload.replacement, '/api/m2/lifecycle/prepare');
  }
  assert.equal(calls.parseBody.length, 0);
  assert.equal(calls.prepare.length, 0);
  assert.equal(calls.approve.length, 0);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.status.length, 0);
});

summary();
