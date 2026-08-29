#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';

import {
  DEFAULT_MOBILE_RUNTIME_CONFIG,
  MOBILE_REMOTE_RELEASE_SURFACES,
  MOBILE_TRANSPORT_MODE,
  REMOTE_CORE_V1_CAPABILITY_IDS,
  REMOTE_CORE_V1_PIN,
  assessMobileRemoteReadiness,
  createRemoteCoreHello,
  digestRemoteCoreValue,
  validateMobileRuntimeConfig,
  validateRemoteCoreNegotiation,
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const hello = createRemoteCoreHello({
  requestId: 'mobile-hello-001',
  clientId: 'intentsmith-android-test',
  clientBuild: 'android:1.0(1)',
  sentAt: '2026-08-27T12:00:00.000Z',
});

// Exact output of createM5RemoteCorePortAdapter() at product revision
// 122b5df5303e08a38cdd62a35e6577b118795c30 for the hello above.  Keeping the
// fixture here makes the mobile branch independently reproducible; the source
// revision and all content digests are also pinned by the production module.
const m5Negotiation = {
  contract: 'RemoteCoreNegotiation',
  version: 1,
  requestId: 'mobile-hello-001',
  helloDigest: 'sha256:66fa3618201da5298e1a18a7fc9c7e15ca98de00c3431e4f8c9e0a3046c84efb',
  descriptorDigest: 'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52',
  negotiatedAt: '2026-08-27T12:00:00.001Z',
  status: 'negotiated',
  selectedPortVersion: 1,
  capabilities: REMOTE_CORE_V1_CAPABILITY_IDS.map(capabilityId => {
    const pin = REMOTE_CORE_V1_PIN.capabilities[capabilityId];
    if (pin) {
      return {
        capabilityId,
        status: 'available',
        selectedVersion: 1,
        contractDigest: pin.contractDigest,
        operationsDigest: pin.operationsDigest,
        error: null,
      };
    }
    return {
      capabilityId,
      status: 'unavailable',
      selectedVersion: null,
      contractDigest: null,
      operationsDigest: null,
      error: {
        code: 'REMOTE_CORE_CAPABILITY_UNAVAILABLE',
        message: `Remote core capability ${capabilityId} is unavailable.`,
        retryable: false,
      },
    };
  }),
  error: null,
};

console.log('\n=== Mobile RemoteCorePort@1 compatibility boundary ===');

await test('consumer pin matches the reviewed M2 descriptor and M5 adapter identities', () => {
  assert.equal(
    REMOTE_CORE_V1_PIN.descriptorDigest,
    'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52',
  );
  assert.equal(
    REMOTE_CORE_V1_PIN.m5AdapterManifestDigest,
    'sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52',
  );
  assert.deepEqual(Object.keys(REMOTE_CORE_V1_PIN.capabilities), ['conversations', 'projects']);
  assert.equal(REMOTE_CORE_V1_PIN.source.m5ProductRevision.length, 40);
});

await test('hello is exact, sorted and byte-compatible with the authoritative digest', async () => {
  assert.deepEqual(
    hello.capabilities.map(capability => capability.capabilityId),
    REMOTE_CORE_V1_CAPABILITY_IDS,
  );
  assert.equal(
    await digestRemoteCoreValue(hello, webcrypto),
    'sha256:66fa3618201da5298e1a18a7fc9c7e15ca98de00c3431e4f8c9e0a3046c84efb',
  );
  assert.equal(Object.isFrozen(hello.capabilities[0]), true);
});

await test('the exact M5 negotiation validates but remains honestly release-incomplete', async () => {
  const validation = await validateRemoteCoreNegotiation(hello, m5Negotiation, webcrypto);
  assert.deepEqual(validation, { valid: true, errors: [] });
  const readiness = await assessMobileRemoteReadiness(hello, m5Negotiation, webcrypto);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, 'REMOTE_CAPABILITY_SET_INCOMPLETE');
  assert.deepEqual(readiness.availableCapabilities, ['conversations', 'projects']);
  assert.deepEqual(readiness.missingCapabilities, [
    'approvals', 'events', 'notifications', 'settings', 'stored_information',
  ]);
  assert.deepEqual(readiness.missingSurfaces, MOBILE_REMOTE_RELEASE_SURFACES.map(item => item.id));
});

await test('a forged descriptor or operation digest fails before readiness can be claimed', async () => {
  const descriptor = clone(m5Negotiation);
  descriptor.descriptorDigest = `sha256:${'f'.repeat(64)}`;
  const descriptorResult = await assessMobileRemoteReadiness(hello, descriptor, webcrypto);
  assert.equal(descriptorResult.code, 'REMOTE_NEGOTIATION_INVALID');
  assert.ok(descriptorResult.errors.includes('remote-core-negotiation:descriptorDigest-mismatch'));

  const operation = clone(m5Negotiation);
  operation.capabilities[1].operationsDigest = `sha256:${'e'.repeat(64)}`;
  const operationResult = await assessMobileRemoteReadiness(hello, operation, webcrypto);
  assert.equal(operationResult.code, 'REMOTE_NEGOTIATION_INVALID');
  assert.ok(operationResult.errors.some(error => error.endsWith(':operationsDigest-mismatch')));
});

await test('unknown fields and unpinned available capabilities fail closed', async () => {
  const unknown = clone(m5Negotiation);
  unknown.token = 'self-asserted';
  const unknownValidation = await validateRemoteCoreNegotiation(hello, unknown, webcrypto);
  assert.ok(unknownValidation.errors.includes('remote-core-negotiation:unknown-token'));

  const overclaim = clone(m5Negotiation);
  const approval = overclaim.capabilities[0];
  approval.status = 'available';
  approval.selectedVersion = 1;
  approval.contractDigest = `sha256:${'a'.repeat(64)}`;
  approval.operationsDigest = `sha256:${'b'.repeat(64)}`;
  approval.error = null;
  const overclaimValidation = await validateRemoteCoreNegotiation(hello, overclaim, webcrypto);
  assert.ok(overclaimValidation.errors.some(error => error.endsWith(':capability-not-client-pinned')));
});

await test('missing transport negotiation is BLOCKED, never an empty success', async () => {
  const readiness = await assessMobileRemoteReadiness(hello, null, webcrypto);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, 'REMOTE_TRANSPORT_NOT_NEGOTIATED');
  assert.deepEqual(readiness.missingCapabilities, REMOTE_CORE_V1_CAPABILITY_IDS);
});

await test('runtime config accepts exact pins and rejects mode or digest drift', () => {
  assert.equal(validateMobileRuntimeConfig(DEFAULT_MOBILE_RUNTIME_CONFIG).mode, 'legacy-m1-dev');
  const remote = {
    ...DEFAULT_MOBILE_RUNTIME_CONFIG,
    transportMode: MOBILE_TRANSPORT_MODE.REMOTE_CORE_V1,
  };
  assert.equal(validateMobileRuntimeConfig(remote).mode, 'remote-core-v1');
  assert.throws(
    () => validateMobileRuntimeConfig({ ...remote, transportMode: 'legacy-auto-fallback' }),
    /invalid_mobile_transport_mode/,
  );
  assert.throws(
    () => validateMobileRuntimeConfig({ ...remote, compatibilityOverride: true }),
    /invalid_mobile_runtime_config/,
  );
  const { transportMode: omitted, ...missingMode } = remote;
  assert.equal(omitted, MOBILE_TRANSPORT_MODE.REMOTE_CORE_V1);
  assert.throws(
    () => validateMobileRuntimeConfig(missingMode),
    /invalid_mobile_runtime_config/,
  );
  assert.throws(
    () => validateMobileRuntimeConfig({
      ...remote,
      remoteCore: { ...remote.remoteCore, descriptorDigest: `sha256:${'0'.repeat(64)}` },
    }),
    /invalid_mobile_remote_core_pin/,
  );
});

console.log(`\nMobile RemoteCorePort@1 compatibility: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
