#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import { MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 } from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { createM7InProcessCapabilityProvider } from '../src/remote/m7-in-process-capability-provider.js';
import { createM7RemoteHealthAdapter } from '../src/remote/m7-remote-health-adapter.js';
import { suite, summary, test, testAsync } from './harness.js';

const REQUEST = Object.freeze({
  contract: 'RemoteHealthQuery',
  version: 1,
  requestId: 'request:health:001',
});

function adapter(overrides = {}) {
  return createM7RemoteHealthAdapter({
    clock: () => Date.parse('2026-08-29T05:00:00.000Z'),
    coreVersion: '136.1.0',
    components: [
      { componentId: 'operation-journal', observe: async () => ({ status: 'ok', code: 'READY' }) },
      { componentId: 'core', observe: async () => ({ status: 'ok', code: 'READY' }) },
    ],
    ...overrides,
  });
}

function provider(healthAdapter) {
  return createM7InProcessCapabilityProvider({
    authorityResolver: async () => ({
      decision: 'allow', deviceId: 'device:health:001', subjectId: 'user:health:001',
      grantedScopes: [],
    }),
    controlPlaneManifest: MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
    externalValidators: {},
    handlers: healthAdapter.handlers,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    mutationJournal: null,
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    validateOperationPair: validateMobileRemoteOperationPair,
    validatePayload: validateMobileRemotePayload,
  });
}

suite('M7 remote health adapter');

await testAsync('exact probes produce a sorted contract-valid health snapshot', async () => {
  const result = await provider(adapter()).invoke({
    capabilityId: 'm7-control-plane-prerequisite',
    capabilityVersion: 1,
    operationId: 'remote-health.read',
    request: REQUEST,
  });
  assert.equal(validateMobileRemotePayload('RemoteHealthSnapshot@1', result).valid, true);
  assert.equal(result.coreVersion, '136.1.0');
  assert.equal(result.observedAt, '2026-08-29T05:00:00.000Z');
  assert.deepEqual(result.components.map(item => item.componentId), ['core', 'operation-journal']);
  assert.equal(Object.isFrozen(result.components[0]), true);
});

await testAsync('probe throw and malformed observation become explicit unavailable components', async () => {
  const health = adapter({
    components: [
      { componentId: 'database', observe: async () => { throw new Error('private database detail'); } },
      { componentId: 'provider', observe: async () => ({ status: 'maybe', code: 'bad code' }) },
    ],
  });
  const result = await health.readHealth(REQUEST);
  assert.deepEqual(result.components, [
    { componentId: 'database', status: 'unavailable', code: 'PROBE_FAILED' },
    { componentId: 'provider', status: 'unavailable', code: 'PROBE_INVALID' },
  ]);
  assert.equal(JSON.stringify(result).includes('private database detail'), false);
  assert.equal(validateMobileRemotePayload('RemoteHealthSnapshot@1', result).valid, true);
});

await testAsync('invalid observation time is a typed error and releases no component claim', async () => {
  let calls = 0;
  for (const observedAtMs of [Number.NaN, Number.MAX_SAFE_INTEGER]) {
    const health = adapter({
      clock: () => observedAtMs,
      components: [{ componentId: 'core', observe: async () => { calls += 1; return { status: 'ok', code: 'READY' }; } }],
    });
    const result = await health.readHealth(REQUEST);
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'REMOTE_HEALTH_CLOCK_INVALID');
  }
  assert.equal(calls, 0);
});

test('configuration rejects duplicate, unknown-shape and unbounded components', () => {
  assert.throws(() => adapter({ components: [
    { componentId: 'core', observe: () => ({ status: 'ok', code: 'READY' }) },
    { componentId: 'core', observe: () => ({ status: 'ok', code: 'READY' }) },
  ] }), error => error.code === 'M7_REMOTE_HEALTH_CONFIG_INVALID');
  assert.throws(() => adapter({ components: [
    { componentId: 'core', observe: () => ({}), extra: true },
  ] }), error => error.code === 'M7_REMOTE_HEALTH_CONFIG_INVALID');
});

test('health adapter imports no transport, route, session, DB singleton or network authority', () => {
  const source = readFileSync(new URL('../src/remote/m7-remote-health-adapter.js', import.meta.url), 'utf8');
  for (const forbidden of ['server.js', 'routes/', 'ws-bridge', 'session', 'fetch(', 'node:http', 'node:net', 'database.js']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

summary();
