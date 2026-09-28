#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';

import {
  validateConversationCommand,
  validateConversationResult,
} from '../contracts/m1/index.js';
import {
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_DIGEST_V1,
  MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1,
  MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_DIGEST_V1,
  MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_V1,
} from '../docs/mobile/contracts/fixtures/remote-capability-golden-v1.js';
import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_V1,
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  MOBILE_REMOTE_PAYLOAD_SCHEMAS_DIGEST_V1,
  MOBILE_REMOTE_PAYLOAD_SCHEMAS_V1,
  validateMobileRemotePayload,
} from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  runMobileRemoteProviderConformance,
  validateMobileRemoteCandidateAdvertisement,
} from '../docs/mobile/contracts/remote-capability-conformance-v1.js';
import { digestRemoteCoreValue } from '../src/mobile/client/remote-core-v1.js';

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

function projectContextSnapshotFixtureValidator(value) {
  const identity = value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.contract === 'ProjectContextSnapshot'
    && value.version === 1
    && Number.isSafeInteger(value.projectId)
    && typeof value.requestId === 'string';
  const errorVariant = identity
    && Object.keys(value).sort().join(',') === 'contract,error,projectId,requestId,status,version'
    && value.status === 'error' && value.error !== null
    && typeof value.error === 'object'
    && Object.keys(value.error).sort().join(',') === 'code,message'
    && /^PROJECT_CONTEXT_[A-Z_]+$/.test(value.error.code)
    && typeof value.error.message === 'string';
  const successVariant = identity
    && Object.keys(value).sort().join(',') === [
      'budget', 'contract', 'items', 'normalizationVersion', 'normalizedQuery', 'outcome',
      'projectId', 'requestId', 'snapshotDigest', 'status', 'terms', 'truncation', 'version',
      'workspaceRevision',
    ].sort().join(',')
    && value.status === 'ok'
    && value.outcome === 'empty'
    && /^pcs1:[0-9a-f]{64}$/.test(value.snapshotDigest)
    && /^wsr1:[0-9a-f]{64}$/.test(value.workspaceRevision)
    && Array.isArray(value.items) && value.items.length === 0;
  const valid = errorVariant || successVariant;
  return { valid, errors: valid ? [] : ['project-context-fixture:invalid-error-snapshot'] };
}

const externalValidators = {
  'ConversationCommand@1': validateConversationCommand,
  'ConversationResult@1': validateConversationResult,
  // This local adapter covers only the sanitized error fixture. A real core
  // provider gate must inject validateProjectContextSnapshot from M2.
  'ProjectContextSnapshot@1': projectContextSnapshotFixtureValidator,
};

function requirementFor(capabilityId) {
  return MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities
    .find(capability => capability.capabilityId === capabilityId);
}

console.log('\n=== Mobile Remote provider contract candidate ===');

await test('schema registry and candidate adapter have reproducible canonical digests', async () => {
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_PAYLOAD_SCHEMAS_V1, webcrypto),
    MOBILE_REMOTE_PAYLOAD_SCHEMAS_DIGEST_V1,
  );
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_V1, webcrypto),
    MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
  );
  assert.equal(MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_V1.stage, 'CANDIDATE_NOT_ACCEPTED');
  assert.equal(MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_V1.boundary.backendImplementation, 'absent');
});

await test('all seven manifests pin exact contract and operation digests', async () => {
  assert.deepEqual(
    Object.keys(MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1),
    ['approvals', 'conversations', 'events', 'notifications', 'projects', 'settings', 'stored_information'],
  );
  for (const manifest of Object.values(MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1)) {
    const requirement = requirementFor(manifest.capabilityId);
    assert.equal(manifest.version, requirement.targetVersion);
    assert.equal(
      await digestRemoteCoreValue(manifest.contractManifest, webcrypto),
      manifest.contractDigest,
      `${manifest.capabilityId}:contractDigest`,
    );
    assert.equal(
      await digestRemoteCoreValue(manifest.operationManifest, webcrypto),
      manifest.operationsDigest,
      `${manifest.capabilityId}:operationsDigest`,
    );
    assert.equal(
      await digestRemoteCoreValue(manifest.payloadSchemaManifest, webcrypto),
      manifest.payloadSchemaDigest,
      `${manifest.capabilityId}:payloadSchemaDigest`,
    );
    assert.deepEqual(
      manifest.operationManifest.operations.map(operation => operation.operationId),
      requirement.operations.map(operation => operation.operationId),
    );
    assert.equal(Object.isFrozen(manifest.payloadSchemaManifest), true);
  }
});

await test('control plane is separately pinned and resolves the OperationRecord name collision', async () => {
  const control = MOBILE_REMOTE_CONTROL_PLANE_MANIFEST_V1;
  assert.equal(control.owner, 'M7_SESSION_TRANSPORT_CONTRACT');
  assert.equal(control.includedInM2CapabilityNegotiation, false);
  assert.equal(await digestRemoteCoreValue(control.contractManifest, webcrypto), control.contractDigest);
  assert.equal(await digestRemoteCoreValue(control.operationManifest, webcrypto), control.operationsDigest);
  assert.equal(await digestRemoteCoreValue(control.payloadSchemaManifest, webcrypto), control.payloadSchemaDigest);
  const lookup = control.operationManifest.operations.find(item => item.operationId === 'operation.get');
  assert.equal(lookup.resultContract, 'OperationLookupResult@1');
  assert.ok(control.contractManifest.contracts.includes('OperationLookupResult@1'));
  assert.ok(control.payloadSchemaManifest.schemas.some(item => item.schemaId === 'OperationRecord@1'));
});

await test('fixture inventory covers every capability and M7 prerequisite operation exactly once', () => {
  const required = [
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.capabilities.flatMap(capability => (
      capability.operations.map(operation => operation.operationId)
    )),
    ...MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.controlPlanePrerequisite.operations
      .map(operation => operation.operationId),
  ].sort();
  const fixtures = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .map(fixture => fixture.operationId).sort();
  assert.equal(fixtures.length, 18);
  assert.deepEqual(fixtures, required);
});

await test('golden and negative fixture corpora have reproducible canonical digests', async () => {
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1, webcrypto),
    MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_DIGEST_V1,
  );
  assert.equal(
    await digestRemoteCoreValue(MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_V1, webcrypto),
    MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_DIGEST_V1,
  );
});

await test('all golden success and typed failure pairs validate with exact identity bindings', () => {
  for (const fixture of MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1) {
    for (const resultKind of ['success', 'failure']) {
      const validation = validateMobileRemoteOperationPair({
        ...fixture,
        result: fixture[resultKind],
        externalValidators,
      });
      assert.deepEqual(validation.errors, [], `${fixture.operationId}:${resultKind}`);
      assert.equal(validation.valid, true);
    }
  }
});

await test('candidate-owned schemas reject all golden negative drift fixtures', () => {
  assert.equal(MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_V1.length >= 6, true);
  for (const fixture of MOBILE_REMOTE_NEGATIVE_PAYLOAD_FIXTURES_V1) {
    const validation = validateMobileRemotePayload(fixture.schemaId, fixture.value);
    assert.equal(validation.valid, false, fixture.id);
    assert.equal(validation.errors.length > 0, true, fixture.id);
  }
});

await test('external accepted contracts fail closed unless the owning validator is injected', () => {
  const fixture = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .find(item => item.operationId === 'conversation.execute');
  const validation = validateMobileRemotePayload('ConversationCommand@1', fixture.request);
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0], /external-validator-required/);
});

await test('settings decimals remain digest-safe canonical strings, never JSON floats', () => {
  const fixture = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .find(item => item.operationId === 'settings.read');
  const item = structuredClone(fixture.success.items[0]);
  item.valueType = 'number';
  item.value = '0.7';
  item.constraints = { minimum: '0', maximum: '2', step: '0.1' };
  assert.equal(validateMobileRemotePayload('MobileSettingItem@1', item).valid, true);
  item.value = 0.7;
  const rawFloat = validateMobileRemotePayload('MobileSettingItem@1', item);
  assert.equal(rawFloat.valid, false);
  assert.match(rawFloat.errors.join(','), /not-json-scalar|value-does-not-match/);
});

await test('wrong capability, version and result identity fail before integration', () => {
  const fixture = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .find(item => item.operationId === 'approval.decide');
  const foreign = structuredClone(fixture.success);
  foreign.approvalId = 'approval:foreign';
  assert.equal(validateMobileRemoteOperationPair({
    ...fixture,
    result: foreign,
    externalValidators,
  }).valid, false);
  assert.equal(validateMobileRemoteOperationPair({
    ...fixture,
    capabilityId: 'settings',
    result: fixture.success,
    externalValidators,
  }).valid, false);
  assert.equal(validateMobileRemoteOperationPair({
    ...fixture,
    capabilityVersion: 2,
    result: fixture.success,
    externalValidators,
  }).valid, false);
});

await test('candidate advertisement requires all seven exact versions and M2 digest fields', () => {
  const advertisement = Object.values(MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1).map(manifest => ({
    capabilityId: manifest.capabilityId,
    status: 'available',
    selectedVersion: manifest.version,
    contractDigest: manifest.contractDigest,
    operationsDigest: manifest.operationsDigest,
    error: null,
  }));
  assert.equal(validateMobileRemoteCandidateAdvertisement(advertisement).valid, true);
  const drift = structuredClone(advertisement);
  drift[4].selectedVersion = 1;
  assert.equal(validateMobileRemoteCandidateAdvertisement(drift).valid, false);
  drift[4].selectedVersion = 2;
  drift[0].payloadSchemaDigest = MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1.approvals.payloadSchemaDigest;
  assert.equal(validateMobileRemoteCandidateAdvertisement(drift).valid, false);
});

await test('in-process provider harness validates all 14 capability operations without a listener', async () => {
  const byOperation = new Map(MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1.map(fixture => (
    [fixture.operationId, fixture]
  )));
  const report = await runMobileRemoteProviderConformance({
    externalValidators,
    invoke: async invocation => structuredClone(byOperation.get(invocation.operationId).success),
  });
  assert.equal(report.passed, true);
  assert.equal(report.total, 14);
  assert.equal(report.passedCount, 14);
  assert.deepEqual(report.failures, []);
});

await test('the same harness can gate all four M7 recovery/health prerequisites explicitly', async () => {
  const byOperation = new Map(MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1.map(fixture => (
    [fixture.operationId, fixture]
  )));
  const report = await runMobileRemoteProviderConformance({
    externalValidators,
    includeControlPlane: true,
    invoke: async invocation => structuredClone(byOperation.get(invocation.operationId).success),
  });
  assert.equal(report.passed, true);
  assert.equal(report.total, 18);
  assert.equal(report.passedCount, 18);
});

await test('provider throws, request mutation and foreign responses remain visible failures', async () => {
  const listFixture = MOBILE_REMOTE_GOLDEN_OPERATION_FIXTURES_V1
    .find(item => item.operationId === 'approval.list');
  const mutated = await runMobileRemoteProviderConformance({
    externalValidators,
    fixtures: [listFixture],
    invoke: async invocation => {
      invocation.request.limit = 1;
      return structuredClone(listFixture.success);
    },
  });
  assert.equal(mutated.passed, false);
  assert.deepEqual(mutated.failures[0].errors, ['provider-mutated-request']);

  const foreign = await runMobileRemoteProviderConformance({
    externalValidators,
    fixtures: [listFixture],
    invoke: async () => ({ ...structuredClone(listFixture.success), requestId: 'request:foreign' }),
  });
  assert.equal(foreign.passed, false);
  assert.match(foreign.failures[0].errors.join(','), /binding-requestId/);

  const unavailable = await runMobileRemoteProviderConformance({
    externalValidators,
    fixtures: [listFixture],
    invoke: async () => structuredClone(listFixture.failure),
  });
  assert.equal(unavailable.passed, false);
  assert.deepEqual(
    unavailable.failures[0].errors,
    ['provider-did-not-produce-golden-success-variant'],
  );

  const thrown = await runMobileRemoteProviderConformance({
    externalValidators,
    fixtures: [listFixture],
    invoke: async () => { throw Object.assign(new Error('synthetic'), { code: 'SYNTHETIC' }); },
  });
  assert.equal(thrown.passed, false);
  assert.deepEqual(thrown.failures[0].errors, ['provider-threw:SYNTHETIC']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
