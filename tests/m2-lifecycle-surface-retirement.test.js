#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { suite, test, summary } from './harness.js';
import {
  M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS,
  M2_LEGACY_LIFECYCLE_RETIRED_CODE,
  M2_LEGACY_LIFECYCLE_REPLACEMENT,
  M2_LEGACY_LIFECYCLE_RETIREMENT_RESPONSE,
  createM2LegacyLifecycleQuarantineRoutes,
} from '../src/lifecycle/m2-legacy-lifecycle-quarantine.js';

const EXPECTED_ROUTE_KEYS = Object.freeze([
  'POST /api/lifecycle/start',
  'POST /api/lifecycle/spec/answer',
  'POST /api/lifecycle/spec/approve',
  'POST /api/lifecycle/roadmap/approve',
  'POST /api/lifecycle/milestone/approve',
  'POST /api/lifecycle/milestone/next',
  'POST /api/lifecycle/milestone/blocked',
  'POST /api/lifecycle/review/acknowledge',
  'POST /api/lifecycle/change/propose',
  'POST /api/lifecycle/change/approve',
  'POST /api/lifecycle/change/reject',
  'POST /api/projects/lifecycle/start',
]);

const EXPECTED_RESPONSE = Object.freeze({
  error: 'Legacy lifecycle mutation endpoints are retired.',
  code: 'LEGACY_LIFECYCLE_RETIRED',
  replacement: '/api/m2/lifecycle/prepare',
});

function makeFactoryHarness() {
  const responses = [];
  let legacyDependencyReads = 0;
  const dependencies = new Proxy({
    sendJSON: (res, status, payload) => {
      responses.push({ res, status, payload });
      return Object.freeze({ status, payload });
    },
  }, {
    get(target, property, receiver) {
      if (property === 'sendJSON') return Reflect.get(target, property, receiver);
      legacyDependencyReads += 1;
      throw new Error(`quarantine accessed forbidden dependency: ${String(property)}`);
    },
  });
  return {
    dependencies,
    responses,
    get legacyDependencyReads() { return legacyDependencyReads; },
  };
}

suite('M2 lifecycle legacy mutation surface — exact quarantine membership');

test('route list is frozen, duplicate-free, and exactly covers the declared legacy mutators', () => {
  assert.equal(Object.isFrozen(M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS), true);
  assert.deepEqual(M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS, EXPECTED_ROUTE_KEYS);
  assert.equal(
    new Set(M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS).size,
    EXPECTED_ROUTE_KEYS.length,
  );
});

test('read-only status and project resume/bind surfaces are not misrepresented as M2 quarantine', () => {
  const excluded = [
    'GET /api/lifecycle/status',
    'GET /api/projects/:id/lifecycle',
    'POST /api/projects/:id/lifecycle/bind',
  ];
  for (const routeKey of excluded) {
    assert.equal(M2_LEGACY_LIFECYCLE_MUTATING_ROUTE_KEYS.includes(routeKey), false);
  }
});

test('exported typed response is immutable and names the sole M2 replacement', () => {
  assert.equal(M2_LEGACY_LIFECYCLE_RETIRED_CODE, EXPECTED_RESPONSE.code);
  assert.equal(M2_LEGACY_LIFECYCLE_REPLACEMENT, EXPECTED_RESPONSE.replacement);
  assert.equal(Object.isFrozen(M2_LEGACY_LIFECYCLE_RETIREMENT_RESPONSE), true);
  assert.deepEqual(M2_LEGACY_LIFECYCLE_RETIREMENT_RESPONSE, EXPECTED_RESPONSE);
});

suite('M2 lifecycle legacy mutation surface — fail-closed handlers');

test('every quarantined route returns the exact HTTP 410 response without reading request bodies', () => {
  const harness = makeFactoryHarness();
  const routes = createM2LegacyLifecycleQuarantineRoutes(harness.dependencies);
  assert.equal(Object.isFrozen(routes), true);
  assert.deepEqual(Object.keys(routes), EXPECTED_ROUTE_KEYS);

  for (const routeKey of EXPECTED_ROUTE_KEYS) {
    const request = new Proxy({}, {
      get(_target, property) {
        throw new Error(`${routeKey} read request property ${String(property)}`);
      },
    });
    const response = Object.freeze({ routeKey });
    const returned = routes[routeKey](request, response);
    assert.deepEqual(returned, { status: 410, payload: EXPECTED_RESPONSE });
  }

  assert.equal(harness.responses.length, EXPECTED_ROUTE_KEYS.length);
  for (const item of harness.responses) {
    assert.equal(item.status, 410);
    assert.deepEqual(item.payload, EXPECTED_RESPONSE);
  }
  assert.equal(harness.legacyDependencyReads, 0);
});

test('missing response writer fails during construction before any route can exist', () => {
  assert.throws(
    () => createM2LegacyLifecycleQuarantineRoutes(),
    /requires sendJSON/,
  );
});

suite('M2 lifecycle legacy mutation surface — static containment sentinel');

test('quarantine module imports no planner, workflow, Git, executor, or other module', () => {
  const source = readFileSync(
    new URL('../src/lifecycle/m2-legacy-lifecycle-quarantine.js', import.meta.url),
    'utf8',
  );
  const imports = [...source.matchAll(/^\s*import\s+[^;]+;?\s*$/gm)].map(match => match[0]);
  assert.deepEqual(imports, []);
});

summary();
