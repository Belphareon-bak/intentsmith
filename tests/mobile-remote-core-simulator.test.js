#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import {
  validateConversationCommand,
  validateConversationResult,
} from '../contracts/m1/index.js';
import {
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
} from '../docs/mobile/contracts/fixtures/remote-capability-golden-v1.js';
import {
  createRemoteSessionGoldenFixturesV1,
  MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1,
} from '../docs/mobile/contracts/fixtures/remote-session-golden-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  validateMobileRemoteCandidateAdvertisement,
} from '../docs/mobile/contracts/remote-capability-conformance-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  createMobileRemoteCandidateClientV1,
  MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_DIGEST_V1,
  MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_V1,
  MOBILE_REMOTE_CANDIDATE_CLIENT_STAGE_V1,
} from '../docs/mobile/contracts/remote-core-candidate-client-v1.js';
import {
  createMobileRemoteCoreSimulatorV1,
  MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_DIGEST_V1,
  MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1,
  MOBILE_REMOTE_CORE_SIMULATOR_STAGE_V1,
} from '../docs/mobile/contracts/remote-core-simulator-v1.js';
import {
  digestRemoteCoreValue,
} from '../src/mobile/client/remote-core-v1.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.stack || error.message}`);
  }
}

function projectContextSnapshotFixtureValidator(value) {
  const identity = value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.contract === 'ProjectContextSnapshot'
    && value.version === 1
    && Number.isSafeInteger(value.projectId)
    && typeof value.requestId === 'string';
  const errorVariant = identity && value.status === 'error' && value.error?.code?.startsWith('PROJECT_CONTEXT_');
  const successVariant = identity && value.status === 'ok'
    && value.outcome === 'empty'
    && /^pcs1:[0-9a-f]{64}$/.test(value.snapshotDigest)
    && /^wsr1:[0-9a-f]{64}$/.test(value.workspaceRevision)
    && Array.isArray(value.items) && value.items.length === 0;
  return {
    valid: Boolean(errorVariant || successVariant),
    errors: errorVariant || successVariant ? [] : ['project-context-fixture:invalid'],
  };
}

const externalValidators = {
  'ConversationCommand@1': validateConversationCommand,
  'ConversationResult@1': validateConversationResult,
  'ProjectContextSnapshot@1': projectContextSnapshotFixtureValidator,
};

const golden = await createRemoteSessionGoldenFixturesV1(webcrypto);
const nowMs = MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1.nowMs;
const allScopes = [...new Set([
  ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
    .flatMap(capability => capability.operations.flatMap(operation => operation.requiredScopes)),
  ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.controlPlanePrerequisite.operations
    .flatMap(operation => operation.requiredScopes),
])].sort();
const session = structuredClone(golden.session);
session.scopes = allScopes;

const fixtureFor = operationId => MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
  .find(fixture => fixture.operationId === operationId);

async function envelopeFor(fixture, counter, {
  payload = structuredClone(fixture.request),
  nonceId = counter,
} = {}) {
  return {
    contract: 'RemoteInvocationEnvelope',
    version: 1,
    requestId: payload.requestId,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    subjectId: session.subjectId,
    sessionRevision: session.sessionRevision,
    clientCounter: counter,
    nonce: `simulator_nonce_${String(nonceId).padStart(16, '0')}`,
    sentAt: golden.invocation.sentAt,
    capabilityId: fixture.capabilityId,
    capabilityVersion: fixture.capabilityVersion,
    operationId: fixture.operationId,
    payload,
    payloadDigest: await digestRemoteCoreValue(payload, webcrypto),
  };
}

const createSimulator = () => createMobileRemoteCoreSimulatorV1({
  session,
  previousCounter: MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1.previousCounter,
  now: () => nowMs,
  cryptoApi: webcrypto,
  externalValidators,
});
const createCandidateClient = transport => createMobileRemoteCandidateClientV1({
  session,
  initialCounter: MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1.previousCounter,
  transport,
  now: () => nowMs,
  nonce: ({ clientCounter }) => `candidate_nonce_${String(clientCounter).padStart(16, '0')}`,
  cryptoApi: webcrypto,
  externalValidators,
});

console.log('\n=== Mobile RemoteCore test-only simulator ===');

await test('descriptor is immutable, canonically pinned and explicitly has no runtime authority', async () => {
  assert.equal(MOBILE_REMOTE_CORE_SIMULATOR_STAGE_V1, 'TEST_ONLY_NOT_RUNTIME');
  assert.equal(MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1.authority, 'NONE');
  assert.equal(MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1.isolation.network, 'none');
  assert.equal(MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1.isolation.database, 'none');
  assert.equal(MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1.isolation.backendImports, 'forbidden');
  assert.equal(Object.isFrozen(MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1.faults), true);
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_V1, webcrypto),
    MOBILE_REMOTE_CORE_SIMULATOR_DESCRIPTOR_DIGEST_V1,
  );
  assert.equal(MOBILE_REMOTE_CANDIDATE_CLIENT_STAGE_V1, 'TEST_ONLY_NOT_RUNTIME');
  assert.equal(MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_V1.authority, 'NONE');
  assert.equal(MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_V1.transport.network, 'none');
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_V1, webcrypto),
    MOBILE_REMOTE_CANDIDATE_CLIENT_DESCRIPTOR_DIGEST_V1,
  );
});

await test('advertisement exposes the seven exact candidate capability versions and digests', () => {
  const simulator = createSimulator();
  const advertisement = simulator.advertise();
  assert.equal(advertisement.length, 7);
  assert.equal(validateMobileRemoteCandidateAdvertisement(advertisement).valid, true);
  assert.deepEqual(
    advertisement.map(item => item.capabilityId),
    Object.keys(MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1),
  );
});

await test('all 14 mobile capability operations run in-process through session envelopes', async () => {
  const simulator = createSimulator();
  const fixtures = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .filter(fixture => fixture.capabilityId !== 'm7-control-plane-prerequisite');
  assert.equal(fixtures.length, 14);
  let counter = 8;
  for (const fixture of fixtures) {
    const response = await simulator.invoke(await envelopeFor(fixture, counter));
    assert.equal(response.status, 'ok', fixture.operationId);
    assert.equal(response.payload.requestId, fixture.request.requestId, fixture.operationId);
    counter += 1;
  }
  assert.equal(simulator.inspect().acceptedCounter, 21);
  assert.equal(simulator.inspect().mutationCount, 4);
});

await test('candidate client drives all 14 capability operations without hand-built envelopes', async () => {
  const simulator = createSimulator();
  const client = createCandidateClient({ invoke: simulator.invoke });
  const fixtures = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .filter(fixture => fixture.capabilityId !== 'm7-control-plane-prerequisite');
  for (const fixture of fixtures) {
    const response = await client.invoke(fixture.operationId, structuredClone(fixture.request));
    assert.equal(response.status, 'ok', fixture.operationId);
    assert.equal(response.payload.requestId, fixture.request.requestId, fixture.operationId);
  }
  assert.equal(client.inspect().issuedCounter, 21);
  assert.equal(client.inspect().inFlight, 0);
  assert.equal(simulator.inspect().acceptedCounter, 21);
  assert.equal(simulator.inspect().mutationCount, 4);
});

await test('candidate client rejects local payload drift and substituted responses before publication', async () => {
  const simulator = createSimulator();
  let transportCalls = 0;
  const client = createCandidateClient({
    invoke: async envelope => {
      transportCalls += 1;
      const response = await simulator.invoke(envelope);
      const substituted = structuredClone(response);
      substituted.subjectId = 'subject:foreign';
      return substituted;
    },
  });
  const fixture = fixtureFor('project.list');
  const malformed = structuredClone(fixture.request);
  malformed.limit = 0;
  await assert.rejects(
    client.invoke(fixture.operationId, malformed),
    error => error.code === 'REMOTE_CLIENT_REQUEST_INVALID'
      && error.validationErrors.some(item => item.includes('limit')),
  );
  assert.equal(transportCalls, 0);
  assert.equal(client.inspect().issuedCounter, 7);
  await assert.rejects(
    client.invoke(fixture.operationId, structuredClone(fixture.request)),
    error => error.code === 'REMOTE_CLIENT_RESPONSE_INVALID'
      && error.validationErrors.some(item => item.includes('subjectId-mismatch')),
  );
  assert.equal(transportCalls, 1);
});

await test('ambiguous transport failure is never auto-retried and consumes its counter/nonce', async () => {
  const simulator = createSimulator();
  simulator.queueFault('timeout');
  let transportCalls = 0;
  const client = createCandidateClient({
    invoke: async envelope => {
      transportCalls += 1;
      return simulator.invoke(envelope);
    },
  });
  const fixture = fixtureFor('project.list');
  await assert.rejects(
    client.invoke(fixture.operationId, structuredClone(fixture.request)),
    error => error.code === 'REMOTE_TRANSPORT_TIMEOUT',
  );
  assert.equal(transportCalls, 1);
  assert.equal(client.inspect().issuedCounter, 8);
  assert.equal(simulator.inspect().acceptedCounter, 7);

  const explicitRead = await client.invoke(fixture.operationId, structuredClone(fixture.request));
  assert.equal(explicitRead.status, 'ok');
  assert.equal(transportCalls, 2);
  assert.equal(client.inspect().issuedCounter, 9);
  assert.equal(simulator.inspect().acceptedCounter, 9);
});

await test('counter high-water semantics serialize dispatch until a replay window is versioned', async () => {
  const simulator = createSimulator();
  let releaseTransport;
  let markEntered;
  const held = new Promise(resolve => { releaseTransport = resolve; });
  const entered = new Promise(resolve => { markEntered = resolve; });
  const client = createCandidateClient({
    invoke: async envelope => {
      markEntered();
      await held;
      return simulator.invoke(envelope);
    },
  });
  const fixture = fixtureFor('project.list');
  const first = client.invoke(fixture.operationId, structuredClone(fixture.request));
  await assert.rejects(
    client.invoke(fixture.operationId, structuredClone(fixture.request)),
    error => error.code === 'REMOTE_CLIENT_IN_FLIGHT_LIMIT',
  );
  await entered;
  assert.equal(client.inspect().inFlight, 1);
  assert.equal(client.inspect().issuedCounter, 8);
  releaseTransport();
  assert.equal((await first).status, 'ok');
  assert.equal(client.inspect().inFlight, 0);
});

await test('candidate client rejects a reused nonce before the second transport call', async () => {
  const simulator = createSimulator();
  let transportCalls = 0;
  const client = createMobileRemoteCandidateClientV1({
    session,
    initialCounter: MOBILE_REMOTE_SESSION_FIXTURE_CONSTANTS_V1.previousCounter,
    transport: {
      invoke: async envelope => {
        transportCalls += 1;
        return simulator.invoke(envelope);
      },
    },
    now: () => nowMs,
    nonce: () => 'candidate_nonce_reused_0001',
    cryptoApi: webcrypto,
    externalValidators,
  });
  const fixture = fixtureFor('project.list');
  assert.equal((await client.invoke(fixture.operationId, structuredClone(fixture.request))).status, 'ok');
  await assert.rejects(
    client.invoke(fixture.operationId, structuredClone(fixture.request)),
    error => error.code === 'REMOTE_CLIENT_NONCE_REUSED',
  );
  assert.equal(transportCalls, 1);
  assert.equal(client.inspect().issuedCounter, 9);
  assert.equal(client.inspect().inFlight, 0);
});

await test('expired or revoked response closes the candidate client before another transport call', async () => {
  const simulator = createSimulator();
  simulator.queueFault('session_revoked');
  let transportCalls = 0;
  const client = createCandidateClient({
    invoke: async envelope => {
      transportCalls += 1;
      return simulator.invoke(envelope);
    },
  });
  const fixture = fixtureFor('project.list');
  const revoked = await client.invoke(fixture.operationId, structuredClone(fixture.request));
  assert.equal(revoked.error.code, 'REMOTE_SESSION_REVOKED');
  assert.equal(client.inspect().lifecycle, 'REVOKED');
  await assert.rejects(
    client.invoke(fixture.operationId, structuredClone(fixture.request)),
    error => error.code === 'REMOTE_SESSION_REVOKED',
  );
  assert.equal(transportCalls, 1);
});

await test('opaque pagination completes and rejects query/limit cursor rebinding', async () => {
  const simulator = createSimulator();
  const fixture = fixtureFor('conversation.list');
  const first = await simulator.invoke(await envelopeFor(fixture, 8));
  assert.equal(first.payload.end, false);
  assert.equal(typeof first.payload.nextCursor, 'string');

  const nextPayload = structuredClone(fixture.request);
  nextPayload.cursor = first.payload.nextCursor;
  const second = await simulator.invoke(await envelopeFor(fixture, 9, {
    payload: nextPayload,
  }));
  assert.equal(second.status, 'ok');
  assert.deepEqual(second.payload.items, []);
  assert.equal(second.payload.end, true);

  const reboundPayload = structuredClone(nextPayload);
  reboundPayload.limit = 24;
  const rebound = await simulator.invoke(await envelopeFor(fixture, 10, {
    payload: reboundPayload,
  }));
  assert.equal(rebound.status, 'error');
  assert.equal(rebound.error.code, 'REMOTE_CURSOR_BINDING_MISMATCH');
});

await test('mutation replay is idempotent and operation-id payload drift is a conflict', async () => {
  const simulator = createSimulator();
  const fixture = fixtureFor('settings.update');
  const first = await simulator.invoke(await envelopeFor(fixture, 8));
  assert.equal(first.payload.replayed, false);
  const replay = await simulator.invoke(await envelopeFor(fixture, 9));
  assert.equal(replay.payload.replayed, true);

  const conflictingPayload = structuredClone(fixture.request);
  conflictingPayload.value = 'light';
  const conflict = await simulator.invoke(await envelopeFor(fixture, 10, {
    payload: conflictingPayload,
  }));
  assert.equal(conflict.status, 'error');
  assert.equal(conflict.error.code, 'REMOTE_OPERATION_CONFLICT');
  assert.equal(simulator.inspect().mutationCount, 1);
});

await test('nonce, counter and transport identity substitution fail before provider output', async () => {
  const fixture = fixtureFor('project.list');
  const simulator = createSimulator();
  await simulator.invoke(await envelopeFor(fixture, 8, { nonceId: 1 }));

  await assert.rejects(
    simulator.invoke(await envelopeFor(fixture, 9, { nonceId: 1 })),
    error => error.code === 'REMOTE_NONCE_REPLAY',
  );
  await assert.rejects(
    simulator.invoke(await envelopeFor(fixture, 8, { nonceId: 2 })),
    error => error.code === 'REMOTE_SECURITY_REJECTED'
      && error.validationErrors.some(item => item.includes('counter-replay')),
  );
  const substituted = await envelopeFor(fixture, 10, { nonceId: 3 });
  substituted.subjectId = 'subject:foreign';
  await assert.rejects(
    simulator.invoke(substituted),
    error => error.code === 'REMOTE_SECURITY_REJECTED'
      && error.validationErrors.some(item => item.includes('subjectId-mismatch')),
  );
});

await test('unknown mutation outcome is recovered only through lookup and explicit abandon', async () => {
  const simulator = createSimulator();
  const mutation = fixtureFor('settings.update');
  simulator.queueFault('unknown_outcome', { operationId: mutation.operationId });
  await assert.rejects(
    simulator.invoke(await envelopeFor(mutation, 8)),
    error => error.code === 'REMOTE_OUTCOME_UNKNOWN',
  );

  const lookupFixture = fixtureFor('operation.get');
  const lookupPayload = structuredClone(lookupFixture.request);
  lookupPayload.operationId = mutation.request.operationId;
  const lookup = await simulator.invoke(await envelopeFor(lookupFixture, 9, { payload: lookupPayload }));
  assert.equal(lookup.payload.operation.state, 'unknown');
  assert.equal(lookup.payload.operation.canAbandon, true);

  const abandonFixture = fixtureFor('operation.abandon');
  const abandonPayload = structuredClone(abandonFixture.request);
  abandonPayload.targetOperationId = mutation.request.operationId;
  abandonPayload.expectedRevision = lookup.payload.operation.revision;
  const abandoned = await simulator.invoke(await envelopeFor(abandonFixture, 10, {
    payload: abandonPayload,
  }));
  assert.equal(abandoned.payload.outcome, 'CONFIRMED');

  const after = await simulator.invoke(await envelopeFor(lookupFixture, 11, { payload: lookupPayload }));
  assert.equal(after.payload.operation.state, 'abandoned');
  assert.equal(after.payload.operation.canAbandon, false);
});

await test('offline, timeout, provider, event, version, expired and revoked states stay distinct', async () => {
  const fixture = fixtureFor('project.list');
  const eventFixture = fixtureFor('run-event.list');
  const simulator = createSimulator();

  simulator.queueFault('offline');
  await assert.rejects(simulator.invoke(await envelopeFor(fixture, 8)), { code: 'REMOTE_TRANSPORT_OFFLINE' });
  assert.equal(simulator.inspect().acceptedCounter, 7);
  simulator.queueFault('timeout');
  await assert.rejects(simulator.invoke(await envelopeFor(fixture, 8, { nonceId: 2 })), {
    code: 'REMOTE_TRANSPORT_TIMEOUT',
  });
  assert.equal(simulator.inspect().acceptedCounter, 7);

  simulator.queueFault('provider_unavailable');
  const unavailable = await simulator.invoke(await envelopeFor(fixture, 8, { nonceId: 3 }));
  assert.equal(unavailable.error.code, 'REMOTE_PROVIDER_UNAVAILABLE');
  simulator.queueFault('event_window_gone', { operationId: eventFixture.operationId });
  const gone = await simulator.invoke(await envelopeFor(eventFixture, 9, { nonceId: 4 }));
  assert.equal(gone.error.code, 'REMOTE_EVENT_WINDOW_GONE');
  simulator.queueFault('version_mismatch');
  const incompatible = await simulator.invoke(await envelopeFor(fixture, 10, { nonceId: 5 }));
  assert.equal(incompatible.error.code, 'REMOTE_CAPABILITY_VERSION_INCOMPATIBLE');

  const expired = createSimulator();
  expired.queueFault('session_expired');
  assert.equal((await expired.invoke(await envelopeFor(fixture, 8))).error.code, 'REMOTE_SESSION_EXPIRED');
  await assert.rejects(expired.invoke(await envelopeFor(fixture, 9)), { code: 'REMOTE_SESSION_EXPIRED' });

  const revoked = createSimulator();
  revoked.queueFault('session_revoked');
  assert.equal((await revoked.invoke(await envelopeFor(fixture, 8))).error.code, 'REMOTE_SESSION_REVOKED');
  await assert.rejects(revoked.invoke(await envelopeFor(fixture, 9)), { code: 'REMOTE_SESSION_REVOKED' });
});

await test('production mobile client imports no candidate, simulator or test-only driver', () => {
  const clientRoot = new URL('../src/mobile/client/', import.meta.url);
  for (const file of readdirSync(clientRoot).filter(name => name.endsWith('.js'))) {
    const runtime = readFileSync(new URL(file, clientRoot), 'utf8');
    assert.doesNotMatch(runtime, /docs\/mobile\/contracts|remote-core-simulator-v1|remote-core-candidate-client-v1/, file);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
