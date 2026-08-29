#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
} from '../docs/mobile/contracts/fixtures/remote-capability-golden-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  validateMobileRemotePayload,
} from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  runMobileRemoteProviderConformance,
  validateMobileRemoteCandidateAdvertisement,
} from '../docs/mobile/contracts/remote-capability-conformance-v1.js';
import {
  validateConversationCommand,
  validateConversationResult,
} from '../contracts/m1/index.js';
import {
  createM7InProcessCapabilityProvider,
  M7_IN_PROCESS_PROVIDER_ERROR,
} from '../src/remote/m7-in-process-capability-provider.js';
import { suite, summary, test, testAsync } from './harness.js';

function projectContextSnapshotFixtureValidator(value) {
  const valid = value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.contract === 'ProjectContextSnapshot'
    && value.version === 1
    && Number.isSafeInteger(value.projectId)
    && typeof value.requestId === 'string'
    && ((value.status === 'error' && value.error?.code?.startsWith('PROJECT_CONTEXT_'))
      || (value.status === 'ok'
        && /^wsr1:[0-9a-f]{64}$/u.test(value.workspaceRevision)
        && /^pcs1:[0-9a-f]{64}$/u.test(value.snapshotDigest)));
  return { valid, errors: valid ? [] : ['project-context-fixture:invalid'] };
}

const externalValidators = Object.freeze({
  'ConversationCommand@1': validateConversationCommand,
  'ConversationResult@1': validateConversationResult,
  'ProjectContextSnapshot@1': projectContextSnapshotFixtureValidator,
});

const capabilityFixtures = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1.filter(fixture => (
  fixture.capabilityId !== 'm7-control-plane-prerequisite'
));
const fixtureByOperation = new Map(capabilityFixtures.map(fixture => (
  [fixture.operationId, fixture]
)));
const operationById = new Map(MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
  .flatMap(capability => capability.operations.map(operation => [operation.operationId, operation])));

function completeProvider(overrides = {}) {
  const observations = overrides.observations ?? { authority: [], handler: [], journal: [] };
  const handlers = Object.fromEntries(capabilityFixtures.map(fixture => [
    fixture.operationId,
    async (request, context) => {
      observations.handler.push({ operationId: fixture.operationId, request, context });
      return structuredClone(fixture.success);
    },
  ]));
  return {
    observations,
    provider: createM7InProcessCapabilityProvider({
      requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
      manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
      validatePayload: validateMobileRemotePayload,
      validateOperationPair: validateMobileRemoteOperationPair,
      externalValidators,
      handlers: overrides.handlers ?? handlers,
      authorityResolver: overrides.authorityResolver ?? (async input => {
        observations.authority.push(input);
        return {
          decision: 'allow',
          deviceId: 'device:test-001',
          subjectId: 'device:test-001',
          grantedScopes: [...input.requiredScopes],
        };
      }),
      mutationJournal: overrides.mutationJournal === undefined ? {
        async run(input) {
          observations.journal.push(input);
          return input.execute();
        },
      } : overrides.mutationJournal,
    }),
  };
}

suite('M7 in-process capability provider');

await testAsync('all seven capabilities and 14 operations pass the existing conformance harness', async () => {
  const { provider, observations } = completeProvider();
  assert.deepEqual(provider.describe(), {
    contract: 'M7InProcessCapabilityProvider',
    version: 1,
    stage: 'IMPLEMENTED_NOT_ACTIVE',
    activation: 'not_active',
    listener: 'absent',
    transport: 'absent',
  });
  assert.equal(validateMobileRemoteCandidateAdvertisement(provider.advertise()).valid, true);
  const report = await runMobileRemoteProviderConformance({
    externalValidators,
    invoke: invocation => provider.invoke(invocation, { sessionProof: 'test-only' }),
  });
  assert.deepEqual(report.failures, []);
  assert.equal(report.passed, true);
  assert.equal(report.total, 14);
  assert.equal(observations.authority.length, 14);
  assert.equal(observations.handler.length, 14);
  assert.equal(observations.journal.length, 4);
  assert.equal(observations.handler.every(item => Object.isFrozen(item.request)), true);
  assert.equal(observations.handler.every(item => Object.isFrozen(item.context)), true);
});

test('a capability is unavailable unless its complete handler and mutation journal set exists', () => {
  const handlers = Object.fromEntries(capabilityFixtures
    .filter(fixture => fixture.operationId !== 'settings.update')
    .map(fixture => [fixture.operationId, async () => structuredClone(fixture.success)]));
  const { provider } = completeProvider({ handlers });
  const advertisement = provider.advertise();
  assert.equal(advertisement.find(item => item.capabilityId === 'settings').status, 'unavailable');
  assert.equal(advertisement.find(item => item.capabilityId === 'projects').status, 'available');
  assert.equal(Object.isFrozen(advertisement), true);
});

await testAsync('invalid request and missing scope fail before a core handler or journal runs', async () => {
  const observations = { authority: [], handler: [], journal: [] };
  const { provider } = completeProvider({ observations });
  const read = fixtureByOperation.get('approval.list');
  await assert.rejects(
    provider.invoke({
      capabilityId: read.capabilityId,
      capabilityVersion: read.capabilityVersion,
      operationId: read.operationId,
      request: { ...structuredClone(read.request), untrusted: true },
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.INVALID_REQUEST,
  );
  assert.equal(observations.authority.length, 0);
  assert.equal(observations.handler.length, 0);

  const denied = completeProvider({
    observations,
    authorityResolver: async () => ({
      decision: 'allow',
      deviceId: 'device:test-001',
      subjectId: 'device:test-001',
      grantedScopes: [],
    }),
  }).provider;
  await assert.rejects(
    denied.invoke({
      capabilityId: read.capabilityId,
      capabilityVersion: read.capabilityVersion,
      operationId: read.operationId,
      request: structuredClone(read.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.AUTHORITY_DENIED,
  );
  assert.equal(observations.handler.length, 0);
  assert.equal(observations.journal.length, 0);
});

await testAsync('handler context is attenuated to the exact operation scope', async () => {
  const observations = { authority: [], handler: [], journal: [] };
  const read = fixtureByOperation.get('project.list');
  const { provider } = completeProvider({
    observations,
    authorityResolver: async input => ({
      decision: 'allow',
      deviceId: 'device:test-001',
      subjectId: 'device:test-001',
      grantedScopes: [...input.requiredScopes, 'write:settings'],
    }),
  });
  await provider.invoke({
    capabilityId: read.capabilityId,
    capabilityVersion: read.capabilityVersion,
    operationId: read.operationId,
    request: structuredClone(read.request),
  });
  assert.deepEqual(observations.handler[0].context.grantedScopes, ['read:projects']);
  assert.equal(observations.handler[0].context.deviceId, 'device:test-001');
});

await testAsync('foreign result identity is rejected and returned results are immutable clones', async () => {
  const read = fixtureByOperation.get('conversation.list');
  const handlers = Object.fromEntries(capabilityFixtures.map(fixture => [
    fixture.operationId,
    async () => fixture.operationId === read.operationId
      ? { ...structuredClone(fixture.success), requestId: 'request:foreign' }
      : structuredClone(fixture.success),
  ]));
  const bad = completeProvider({ handlers }).provider;
  await assert.rejects(
    bad.invoke({
      capabilityId: read.capabilityId,
      capabilityVersion: read.capabilityVersion,
      operationId: read.operationId,
      request: structuredClone(read.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.INVALID_RESULT,
  );

  const good = completeProvider().provider;
  const result = await good.invoke({
    capabilityId: read.capabilityId,
    capabilityVersion: read.capabilityVersion,
    operationId: read.operationId,
    request: structuredClone(read.request),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items), true);
  assert.notEqual(result, read.success);
});

await testAsync('a mutation journal can persist only a provider-validated handler result', async () => {
  const mutation = fixtureByOperation.get('settings.update');
  let persisted = false;
  const handlers = Object.fromEntries(capabilityFixtures.map(fixture => [
    fixture.operationId,
    async () => fixture.operationId === mutation.operationId
      ? { ...structuredClone(fixture.success), operationId: 'operation:foreign' }
      : structuredClone(fixture.success),
  ]));
  const provider = completeProvider({
    handlers,
    mutationJournal: {
      async run(input) {
        const value = await input.execute();
        persisted = true;
        return value;
      },
    },
  }).provider;
  await assert.rejects(
    provider.invoke({
      capabilityId: mutation.capabilityId,
      capabilityVersion: mutation.capabilityVersion,
      operationId: mutation.operationId,
      request: structuredClone(mutation.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.INVALID_RESULT,
  );
  assert.equal(persisted, false);
});

await testAsync('every mutation crosses the journal and its callback is at-most-once', async () => {
  const mutation = fixtureByOperation.get('settings.update');
  let handlerCalls = 0;
  const handlers = Object.fromEntries(capabilityFixtures.map(fixture => [
    fixture.operationId,
    async () => {
      if (fixture.operationId === mutation.operationId) handlerCalls += 1;
      return structuredClone(fixture.success);
    },
  ]));
  const provider = completeProvider({
    handlers,
    mutationJournal: {
      async run(input) {
        await input.execute();
        return input.execute();
      },
    },
  }).provider;
  await assert.rejects(
    provider.invoke({
      capabilityId: mutation.capabilityId,
      capabilityVersion: mutation.capabilityVersion,
      operationId: mutation.operationId,
      request: structuredClone(mutation.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.JOURNAL_PROTOCOL,
  );
  assert.equal(handlerCalls, 1);
  assert.equal(provider.describe().stage, 'IMPLEMENTED_NOT_ACTIVE');
});

await testAsync('unknown operation, wrong version and malformed authority decision fail closed', async () => {
  const read = fixtureByOperation.get('project.list');
  const { provider } = completeProvider();
  await assert.rejects(
    provider.invoke({
      capabilityId: read.capabilityId,
      capabilityVersion: read.capabilityVersion,
      operationId: 'project.unknown',
      request: structuredClone(read.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.OPERATION_UNAVAILABLE,
  );
  await assert.rejects(
    provider.invoke({
      capabilityId: read.capabilityId,
      capabilityVersion: 999,
      operationId: read.operationId,
      request: structuredClone(read.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.INVALID_INVOCATION,
  );
  const malformed = completeProvider({
    authorityResolver: async () => ({ authorized: true, subjectId: 'self-asserted' }),
  }).provider;
  await assert.rejects(
    malformed.invoke({
      capabilityId: read.capabilityId,
      capabilityVersion: read.capabilityVersion,
      operationId: read.operationId,
      request: structuredClone(read.request),
    }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.AUTHORITY_INVALID,
  );
});

test('provider source cannot acquire server, DB, route, network or session authority', () => {
  const source = readFileSync(
    new URL('../src/remote/m7-in-process-capability-provider.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /(?:src\/(?:db|routes|server|network)|node:(?:http|https|net|tls))/u);
  assert.doesNotMatch(source, /CANDIDATE_NOT_ACCEPTED|remote-session-contract/u);
  assert.match(source, /activation: 'not_active'/u);
  assert.match(source, /listener: 'absent'/u);
  assert.match(source, /transport: 'absent'/u);
});

test('configuration rejects unknown handlers instead of silently exposing them', () => {
  assert.throws(
    () => completeProvider({ handlers: { 'forged.operation': async () => ({}) } }),
    error => error.code === M7_IN_PROCESS_PROVIDER_ERROR.CONFIG_INVALID,
  );
  assert.equal(operationById.size, 14);
});

summary();
