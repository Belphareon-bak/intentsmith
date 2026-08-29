#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  M2_REMOTE_CORE_CAPABILITY_IDS,
  M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
} from '../contracts/m2/remote-core-port-v1.js';
import {
  M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
  M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1,
} from '../contracts/m5/remote-core-adapter-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  MOBILE_REMOTE_RELEASE_SURFACES,
  REMOTE_CORE_V1_CAPABILITY_IDS,
  REMOTE_CORE_V1_PIN,
  assessMobileRemoteReadiness,
  createRemoteCoreHello,
  validateRemoteCoreNegotiation,
} from '../src/mobile/client/remote-core-v1.js';
import {
  createM5RemoteCorePortAdapter,
} from '../src/remote/remote-core-port-adapter.js';
import { suite, summary, test, testAsync } from './harness.js';

const SENT_AT = '2026-08-29T03:00:00.000Z';
const NEGOTIATED_AT_MS = Date.parse('2026-08-29T03:00:00.001Z');

suite('M7 mobile candidate pins the current M2/M5 core authority');

test('consumer identities equal the authoritative current core exports', () => {
  assert.equal(REMOTE_CORE_V1_PIN.descriptorDigest, M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1);
  assert.equal(
    REMOTE_CORE_V1_PIN.m5AdapterManifestDigest,
    M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
  );
  assert.deepEqual(REMOTE_CORE_V1_CAPABILITY_IDS, M2_REMOTE_CORE_CAPABILITY_IDS);
  assert.equal(
    MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.sources.m2DescriptorDigest,
    M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
  );
  assert.equal(
    MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1.sources.m5AdapterManifestDigest,
    M5_REMOTE_CORE_ADAPTER_MANIFEST_DIGEST_V1,
  );
});

test('both implemented capability pins equal the current M5 manifest bytes', () => {
  for (const capabilityId of ['conversations', 'projects']) {
    const pin = REMOTE_CORE_V1_PIN.capabilities[capabilityId];
    const manifest = M5_REMOTE_CORE_CAPABILITY_MANIFESTS_V1[capabilityId];
    assert.equal(pin.version, manifest.version, capabilityId);
    assert.equal(pin.contractDigest, manifest.contractDigest, capabilityId);
    assert.equal(pin.operationsDigest, manifest.operationsDigest, capabilityId);
    assert.deepEqual(
      pin.operations,
      manifest.operationManifest.operations.map(operation => operation.operationId),
      capabilityId,
    );
  }
});

await testAsync('the current production adapter negotiation validates in the mobile consumer', async () => {
  const hello = createRemoteCoreHello({
    requestId: 'm7-current-core-pin-001',
    clientId: 'm7-contract-integration',
    clientBuild: 'm7-contract-candidate',
    sentAt: SENT_AT,
  });
  const adapter = createM5RemoteCorePortAdapter({
    clock: () => NEGOTIATED_AT_MS,
    executeConversation: async () => {
      throw new Error('not invoked by negotiation');
    },
    queryProjectContext: async () => {
      throw new Error('not invoked by negotiation');
    },
  });
  const negotiation = adapter.negotiate(hello);
  assert.deepEqual(
    await validateRemoteCoreNegotiation(hello, negotiation),
    { valid: true, errors: [] },
  );
  const readiness = await assessMobileRemoteReadiness(hello, negotiation);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.code, 'REMOTE_CAPABILITY_SET_INCOMPLETE');
  assert.deepEqual(readiness.availableCapabilities, ['conversations', 'projects']);
  assert.deepEqual(
    readiness.missingSurfaces,
    MOBILE_REMOTE_RELEASE_SURFACES.map(surface => surface.id),
  );
});

test('candidate modules remain transport-free and do not import backend authorities', () => {
  const paths = [
    'src/mobile/client/remote-core-v1.js',
    'docs/mobile/contracts/remote-capability-conformance-v1.js',
    'docs/mobile/contracts/remote-capability-manifests-v1.js',
    'docs/mobile/contracts/remote-capability-payloads-v1.js',
    'docs/mobile/contracts/remote-capability-requirements-v1.js',
    'docs/mobile/contracts/remote-core-candidate-client-v1.js',
    'docs/mobile/contracts/remote-core-simulator-v1.js',
    'docs/mobile/contracts/remote-session-contract-v1.js',
  ];
  const forbidden = /(?:src\/(?:db|network|routes|server|ws)|src\/server\.js|node:(?:http|https|net|tls))/u;
  for (const path of paths) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, forbidden, path);
  }
});

summary();
