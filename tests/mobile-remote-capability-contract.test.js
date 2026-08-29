#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_DIGEST_V1,
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_STAGE_V1,
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  MOBILE_REMOTE_RELEASE_SURFACES,
  REMOTE_CORE_V1_CAPABILITY_IDS,
  REMOTE_CORE_V1_PIN,
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
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function bytewiseSortedUnique(values) {
  return values.every((value, index) => (
    index === 0 || Buffer.compare(Buffer.from(values[index - 1]), Buffer.from(value)) < 0
  ));
}

function allOperations() {
  return MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
    .flatMap(capability => capability.operations.map(operation => ({ capability, operation })));
}

function capability(capabilityId) {
  return MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
    .find(item => item.capabilityId === capabilityId);
}

console.log('\n=== Mobile Remote capability contract candidate ===');

await test('candidate is mobile-owned, immutable and pinned to exact accepted M2/M5 inputs', async () => {
  const candidate = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1;
  assert.equal(MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_STAGE_V1, 'CANDIDATE_NOT_ACCEPTED');
  assert.equal(candidate.stage, 'CANDIDATE_NOT_ACCEPTED');
  assert.equal(candidate.authority, 'MOBILE_CONSUMER_REQUIREMENTS_ONLY');
  assert.equal(candidate.boundary.backendImplementation, 'not_authorized_by_this_contract');
  assert.equal(candidate.sources.m2DescriptorDigest, REMOTE_CORE_V1_PIN.descriptorDigest);
  assert.equal(candidate.sources.m5AdapterManifestDigest, REMOTE_CORE_V1_PIN.m5AdapterManifestDigest);
  assert.equal(candidate.sources.m5ProductRevision, REMOTE_CORE_V1_PIN.source.m5ProductRevision);
  assert.equal(
    await digestRemoteCoreValue(candidate, webcrypto),
    MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_DIGEST_V1,
  );
  assert.equal(Object.isFrozen(candidate.capabilities[0].operations[0]), true);
});

await test('all seven M2 capability identities and minimum authority refs stay exact', () => {
  const candidate = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1;
  assert.deepEqual(candidate.capabilities.map(item => item.capabilityId), REMOTE_CORE_V1_CAPABILITY_IDS);
  assert.deepEqual(
    candidate.capabilities.map(item => item.minimumAuthorityContracts),
    [
      [
        'ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1',
        'LifecycleApprovalIntent@1', 'LifecyclePlanSnapshot@1',
        'LifecycleTerminalSnapshot@1',
      ],
      ['ConversationCommand@1', 'ConversationResult@1'],
      ['CoreEvent@1'],
      ['CoreEvent@1'],
      ['ProjectContextQuery@1', 'ProjectContextSnapshot@1'],
      ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'],
      ['ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1'],
    ],
  );
});

await test('target versions preserve M5 v1 and make incomplete/breaking expansion explicit', () => {
  assert.equal(capability('conversations').targetVersion, 2);
  assert.equal(capability('conversations').compatibility, 'additive_superset_of_m5_v1');
  assert.equal(capability('projects').targetVersion, 2);
  assert.equal(
    capability('projects').compatibility,
    'rootless_remote_query_replaces_m5_v1_request',
  );
  for (const capabilityId of [
    'approvals', 'events', 'notifications', 'settings', 'stored_information',
  ]) {
    assert.equal(capability(capabilityId).targetVersion, 1);
    assert.equal(capability(capabilityId).m5Status, 'unavailable');
  }
  assert.deepEqual(REMOTE_CORE_V1_PIN.capabilities.conversations.operations, ['conversation.execute']);
  assert.deepEqual(REMOTE_CORE_V1_PIN.capabilities.projects.operations, ['project-context.query']);
});

await test('the 14 capability operations cover every mobile release surface including list/history', () => {
  const expected = {
    approvals: ['approval.decide', 'approval.list'],
    conversations: ['conversation.execute', 'conversation.history', 'conversation.list'],
    events: ['run-event.list'],
    notifications: ['notification.ack', 'notification.list'],
    projects: ['project-context.query', 'project.list'],
    settings: ['settings.read', 'settings.update'],
    stored_information: ['stored-information.append', 'stored-information.list'],
  };
  for (const [capabilityId, operations] of Object.entries(expected)) {
    assert.deepEqual(capability(capabilityId).operations.map(item => item.operationId), operations);
  }
  assert.equal(allOperations().length, 14);
  assert.deepEqual(
    MOBILE_REMOTE_RELEASE_SURFACES.map(surface => surface.capabilityId),
    Object.keys(expected),
  );
});

await test('operation and field sets are canonical, disjoint and unknown-field ready', () => {
  for (const item of [
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities,
    MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.controlPlanePrerequisite,
  ]) {
    const operationIds = item.operations.map(operation => operation.operationId);
    assert.equal(bytewiseSortedUnique(operationIds), true, `${item.capabilityId ?? 'control'} order`);
    for (const operation of item.operations) {
      for (const key of [
        'requiredScopes', 'requestRequiredFields', 'requestOptionalFields',
        'successResultRequiredFields', 'successResultOptionalFields',
        'errorResultRequiredFields', 'errorResultOptionalFields', 'resultBinding',
      ]) {
        assert.equal(bytewiseSortedUnique(operation[key]), true, `${operation.operationId}:${key}`);
      }
      assert.deepEqual(
        operation.requestRequiredFields.filter(field => operation.requestOptionalFields.includes(field)),
        [],
      );
      assert.deepEqual(
        operation.successResultRequiredFields.filter(
          field => operation.successResultOptionalFields.includes(field),
        ),
        [],
      );
      assert.deepEqual(
        operation.errorResultRequiredFields.filter(
          field => operation.errorResultOptionalFields.includes(field),
        ),
        [],
      );
    }
  }
});

await test('no request can self-assert transport authority or select a host path', () => {
  const forbidden = new Set([
    'actor', 'actorId', 'authenticatedSubject', 'canonicalRoot', 'deviceId',
    'endpoint', 'grant', 'scope', 'scopes', 'token',
  ]);
  for (const { operation } of allOperations()) {
    for (const field of [...operation.requestRequiredFields, ...operation.requestOptionalFields]) {
      assert.equal(forbidden.has(field), false, `${operation.operationId}:${field}`);
    }
  }
  const projectQuery = capability('projects').operations
    .find(operation => operation.operationId === 'project-context.query');
  assert.equal(projectQuery.requestContract, 'RemoteProjectContextQuery@1');
  assert.equal(projectQuery.requestRequiredFields.includes('workspaceRevision'), true);
  assert.equal(projectQuery.requestRequiredFields.includes('canonicalRoot'), false);
  assert.equal(
    MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.boundary.projectRootSelection,
    'server_resolved_never_client_supplied',
  );
});

await test('pagination is explicit and cannot silently lose a page or event window', () => {
  for (const { operation } of allOperations()) {
    if (operation.pagination === 'opaque_cursor') {
      assert.equal(operation.successResultRequiredFields.includes('nextCursor'), true);
      assert.equal(operation.successResultRequiredFields.includes('end'), true);
      assert.equal(operation.successResultRequiredFields.includes('snapshotRevision'), true);
    }
    if (operation.pagination === 'sequence_cursor') {
      assert.equal(operation.successResultRequiredFields.includes('nextAfterSeq'), true);
      assert.equal(operation.successResultRequiredFields.includes('caughtUp'), true);
    }
    if (operation.kind === 'read') {
      assert.equal(operation.successResultRequiredFields.includes('status'), true);
      assert.deepEqual(
        operation.errorResultRequiredFields.filter(field => (
          ['contract', 'error', 'requestId', 'status', 'version'].includes(field)
        )),
        ['contract', 'error', 'requestId', 'status', 'version'],
      );
    }
  }
  const history = capability('conversations').operations
    .find(operation => operation.operationId === 'conversation.history');
  assert.deepEqual(history.requestOptionalFields, ['anchor', 'cursor']);
});

await test('mutations require a stable operation id and expose replay-safe outcomes', () => {
  const mutations = allOperations()
    .map(item => item.operation)
    .filter(operation => operation.kind === 'mutation');
  assert.deepEqual(mutations.map(operation => operation.operationId), [
    'approval.decide', 'notification.ack', 'settings.update', 'stored-information.append',
  ]);
  for (const mutation of mutations) {
    assert.equal(mutation.idempotency, 'operation_id_required');
    assert.equal(mutation.requestRequiredFields.includes('operationId'), true);
    assert.equal(mutation.successResultRequiredFields.includes('operationId'), true);
    assert.equal(mutation.successResultRequiredFields.includes('outcome'), true);
    assert.equal(mutation.successResultRequiredFields.includes('replayed'), true);
    assert.equal(mutation.resultSemantics, 'mutation_outcome');
  }
  for (const operationId of ['settings.update', 'stored-information.append']) {
    const mutation = mutations.find(item => item.operationId === operationId);
    assert.equal(mutation.successResultOptionalFields.includes('pendingApprovalId'), true);
  }
  assert.equal(MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.boundary.mutationQueue, 'forbidden');
});

await test('run events are a bounded projection rather than a false reuse of CoreEvent@1', () => {
  const events = capability('events');
  assert.deepEqual(events.minimumAuthorityContracts, ['CoreEvent@1']);
  assert.equal(events.operations[0].requestContract, 'RunEventQuery@1');
  assert.equal(events.operations[0].resultContract, 'RunEventPage@1');
  assert.equal(events.operations[0].dataClass, 'S2_MEMORY_ONLY');
  assert.equal(events.operations[0].successResultRequiredFields.includes('terminal'), true);
  assert.equal(events.operations[0].successResultRequiredFields.includes('windowStartSeq'), true);
});

await test('M7 health/operation recovery stays a separate explicit prerequisite', () => {
  const control = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.controlPlanePrerequisite;
  assert.equal(control.owner, 'M7_SESSION_TRANSPORT_CONTRACT');
  assert.equal(control.stage, 'REQUIRED_NOT_DEFINED');
  assert.equal(control.includedInCapabilityDigests, false);
  assert.deepEqual(control.operations.map(operation => operation.operationId), [
    'operation.abandon', 'operation.get', 'operation.list', 'remote-health.read',
  ]);
  const abandon = control.operations[0];
  assert.equal(abandon.requestRequiredFields.includes('targetOperationId'), true);
  assert.equal(abandon.requestRequiredFields.includes('operationId'), true);
  const health = control.operations[3];
  assert.deepEqual(health.requiredScopes, []);
  assert.equal(health.dataClass, 'S0_CACHE');
  assert.equal(
    MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.boundary.invocationIdentity,
    'm7_transport_subject_except_allowlisted_public_health',
  );
});

await test('candidate documentation keeps backend authority and runtime activation fail-closed', () => {
  const documentation = readFileSync(
    new URL('../docs/mobile/REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md', import.meta.url),
    'utf8',
  );
  assert.match(documentation, /CANDIDATE_NOT_ACCEPTED/);
  assert.match(documentation, /NO_BACKEND_AUTHORITY/);
  assert.equal(documentation.includes(MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_DIGEST_V1), true);
  assert.match(documentation, /M5 `8\/9`.*M6 `ACCEPTANCE_BLOCKED`/s);
  assert.match(documentation, /projects@2/);
  assert.match(documentation, /REMOTE_EVENT_WINDOW_GONE/);
  assert.match(documentation, /Legacy `\/api\/\*`, `\/m1\/\*` a\s+`\/c3\/ws`/);

  const runtimePin = readFileSync(
    new URL('../src/mobile/client/remote-core-v1.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(runtimePin, /from ['"]\.\/remote-capability-requirements-v1\.js['"]/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
