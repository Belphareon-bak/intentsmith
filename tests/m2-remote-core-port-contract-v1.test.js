#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, summary } from './harness.js';
import {
  M2_REMOTE_CORE_CAPABILITY_IDS,
  M2_REMOTE_CORE_CAPABILITY_STATUS,
  M2_REMOTE_CORE_ERROR_CODE,
  M2_REMOTE_CORE_NEGOTIATION_STATUS,
  M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
  M2_REMOTE_CORE_PORT_DESCRIPTOR_V1,
  M2_REMOTE_CORE_PORT_KIND,
  M2_REMOTE_CORE_PORT_STAGE,
  M2_REMOTE_CORE_PORT_VERSION,
  canonicalizeM2RemoteCoreValue,
  computeM2RemoteCoreHelloDigest,
  computeM2RemoteCoreValueDigest,
  createM2RemoteCoreUnavailableNegotiation,
  selectM2RemoteCorePortVersion,
  validateM2RemoteCoreHello,
  validateM2RemoteCoreNegotiationForHello,
  validateM2RemoteCorePortDescriptor,
} from '../contracts/m2/remote-core-port-v1.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const SENT_AT = '2026-08-24T08:30:00.000Z';
const NEGOTIATED_AT = '2026-08-24T08:30:00.001Z';

function clone(value) {
  return structuredClone(value);
}

function hello(overrides = {}) {
  return {
    contract: M2_REMOTE_CORE_PORT_KIND.HELLO,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: 'remote-request-001',
    clientId: 'companion-contract-fixture',
    clientBuild: 'mobile-design-0.1.0',
    supportedPortVersions: [1],
    capabilities: M2_REMOTE_CORE_CAPABILITY_IDS.map(capabilityId => ({
      capabilityId,
      versions: [1],
    })),
    sentAt: SENT_AT,
    ...overrides,
  };
}

function capabilityUnavailable(capabilityId) {
  return {
    capabilityId,
    status: M2_REMOTE_CORE_CAPABILITY_STATUS.UNAVAILABLE,
    selectedVersion: null,
    contractDigest: null,
    operationsDigest: null,
    error: {
      code: M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_UNAVAILABLE,
      message: `${capabilityId} provider is unavailable.`,
      retryable: false,
    },
  };
}

function negotiated(value = hello()) {
  return {
    contract: M2_REMOTE_CORE_PORT_KIND.NEGOTIATION,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: value.requestId,
    helloDigest: computeM2RemoteCoreHelloDigest(value),
    descriptorDigest: M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
    status: M2_REMOTE_CORE_NEGOTIATION_STATUS.NEGOTIATED,
    selectedPortVersion: 1,
    capabilities: value.capabilities.map((capability, index) => (
      index === 0
        ? {
          capabilityId: capability.capabilityId,
          status: M2_REMOTE_CORE_CAPABILITY_STATUS.AVAILABLE,
          selectedVersion: 1,
          contractDigest: DIGEST_A,
          operationsDigest: DIGEST_B,
          error: null,
        }
        : capabilityUnavailable(capability.capabilityId)
    )),
    error: null,
    negotiatedAt: NEGOTIATED_AT,
  };
}

suite('M2 RemoteCorePort v1 — frozen descriptor and hello');

test('descriptor exactly freezes seven capabilities and the non-network boundary', () => {
  const validation = validateM2RemoteCorePortDescriptor(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(M2_REMOTE_CORE_PORT_STAGE, 'PINNED_V1');
  assert.equal(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.stage, M2_REMOTE_CORE_PORT_STAGE);
  assert.deepEqual(
    M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.capabilities.map(value => value.capabilityId),
    M2_REMOTE_CORE_CAPABILITY_IDS,
  );
  assert.deepEqual(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.securityBoundary, {
    authentication: 'not_implemented',
    legacyListener: 'forbidden',
    listener: 'not_implemented',
    negotiationAuthority: 'none',
    pairing: 'not_implemented',
    transport: 'not_defined',
  });
});

test('descriptor is deeply immutable and its canonical digest is deterministic', () => {
  assert.equal(Object.isFrozen(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1), true);
  assert.equal(Object.isFrozen(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.capabilities), true);
  assert.equal(Object.isFrozen(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.capabilities[0]), true);
  assert.equal(Object.isFrozen(
    M2_REMOTE_CORE_PORT_DESCRIPTOR_V1.capabilities[0].minimumAuthorityContracts,
  ), true);
  assert.equal(
    computeM2RemoteCoreValueDigest(M2_REMOTE_CORE_PORT_DESCRIPTOR_V1),
    M2_REMOTE_CORE_PORT_DESCRIPTOR_DIGEST_V1,
  );
  assert.equal(
    canonicalizeM2RemoteCoreValue({ z: 1, a: { y: 2, x: 3 } }),
    '{"a":{"x":3,"y":2},"z":1}',
  );
});

test('hello accepts the exact full catalog and an explicit sorted subset', () => {
  assert.equal(validateM2RemoteCoreHello(hello()).valid, true);
  const subset = hello({
    capabilities: [
      { capabilityId: 'conversations', versions: [1, 2] },
      { capabilityId: 'projects', versions: [1] },
    ],
    supportedPortVersions: [1, 2],
  });
  assert.equal(validateM2RemoteCoreHello(subset).valid, true);
});

test('hello cannot smuggle actor, token, payload, endpoint or unknown authority', () => {
  for (const [key, value] of Object.entries({
    actor: { type: 'user', id: 'forged' },
    token: 'secret',
    payload: { effect: 'write' },
    endpoint: 'http://127.0.0.1:3131/api',
    approvalGrantId: 'grant:forged',
  })) {
    const candidate = hello({ [key]: value });
    const validation = validateM2RemoteCoreHello(candidate);
    assert.equal(validation.valid, false, key);
    assert.equal(validation.errors.includes(`remote-core-hello:unknown-${key}`), true, key);
  }
});

test('unknown, duplicate, unsorted and empty capability sets fail closed', () => {
  const cases = [
    [],
    [{ capabilityId: 'unknown', versions: [1] }],
    [
      { capabilityId: 'projects', versions: [1] },
      { capabilityId: 'conversations', versions: [1] },
    ],
    [
      { capabilityId: 'projects', versions: [1] },
      { capabilityId: 'projects', versions: [1] },
    ],
    [{ capabilityId: 'projects', versions: [] }],
    [{ capabilityId: 'projects', versions: [2, 1] }],
    [{ capabilityId: 'projects', versions: [1, 1] }],
  ];
  for (const capabilities of cases) {
    assert.equal(validateM2RemoteCoreHello(hello({ capabilities })).valid, false);
  }
});

test('port version selection requires a sorted explicit offer and never downgrades implicitly', () => {
  assert.equal(selectM2RemoteCorePortVersion([1]), 1);
  assert.equal(selectM2RemoteCorePortVersion([1, 2]), 1);
  assert.equal(selectM2RemoteCorePortVersion([2]), null);
  assert.throws(() => selectM2RemoteCorePortVersion([2, 1]), /not-sorted-unique/);
  assert.throws(() => selectM2RemoteCorePortVersion([1, 1]), /not-sorted-unique/);
});

test('noncanonical timestamps and identifiers are rejected', () => {
  assert.equal(validateM2RemoteCoreHello(hello({ sentAt: '2026-08-24T08:30:00Z' })).valid, false);
  assert.equal(validateM2RemoteCoreHello(hello({ requestId: '../escape' })).valid, false);
  assert.equal(validateM2RemoteCoreHello(hello({ clientBuild: 'bad\0build' })).valid, false);
});

suite('M2 RemoteCorePort v1 — compatibility and false-success resistance');

test('unimplemented compatible provider yields seven explicit unavailable results', () => {
  const request = hello();
  const result = createM2RemoteCoreUnavailableNegotiation(request, NEGOTIATED_AT);
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE);
  assert.equal(result.capabilities.length, M2_REMOTE_CORE_CAPABILITY_IDS.length);
  assert.equal(result.capabilities.every(capability => (
    capability.status === M2_REMOTE_CORE_CAPABILITY_STATUS.UNAVAILABLE
    && capability.error.code === M2_REMOTE_CORE_ERROR_CODE.PROVIDER_UNAVAILABLE
  )), true);
});

test('unshared port version is explicit incompatibility with no capability projection', () => {
  const request = hello({ supportedPortVersions: [2] });
  const result = createM2RemoteCoreUnavailableNegotiation(request, NEGOTIATED_AT);
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.INCOMPATIBLE);
  assert.equal(result.selectedPortVersion, null);
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.error.code, M2_REMOTE_CORE_ERROR_CODE.PORT_VERSION_INCOMPATIBLE);
});

test('incompatible cannot be forged when the hello explicitly offers port v1', () => {
  const request = hello();
  const result = clone(createM2RemoteCoreUnavailableNegotiation(
    hello({ supportedPortVersions: [2] }),
    NEGOTIATED_AT,
  ));
  result.requestId = request.requestId;
  result.helloDigest = computeM2RemoteCoreHelloDigest(request);
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.includes(
      'remote-core-negotiation:incompatible-despite-shared-port-version',
    ),
    true,
  );
});

test('mixed negotiated result requires a shared version and evidence digests', () => {
  const request = hello();
  const result = negotiated(request);
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(result.capabilities[0].selectedVersion, 1);
  assert.equal(result.capabilities[0].contractDigest, DIGEST_A);
  assert.equal(result.capabilities[0].operationsDigest, DIGEST_B);
});

test('empty negotiated success is rejected even with an exact result set', () => {
  const request = hello();
  const result = negotiated(request);
  result.capabilities = request.capabilities.map(capability => (
    capabilityUnavailable(capability.capabilityId)
  ));
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.includes('remote-core-negotiation:negotiated-without-available-capability'),
    true,
  );
});

test('missing, reordered or foreign capability results cannot negotiate', () => {
  const request = hello();
  const missing = negotiated(request);
  missing.capabilities.pop();
  assert.equal(validateM2RemoteCoreNegotiationForHello(request, missing).valid, false);

  const reordered = negotiated(request);
  [reordered.capabilities[0], reordered.capabilities[1]] = [
    reordered.capabilities[1], reordered.capabilities[0],
  ];
  assert.equal(validateM2RemoteCoreNegotiationForHello(request, reordered).valid, false);

  const foreign = negotiated(request);
  foreign.capabilities[0].capabilityId = 'projects';
  assert.equal(validateM2RemoteCoreNegotiationForHello(request, foreign).valid, false);
});

test('available capability rejects unoffered version, missing digest and attached error', () => {
  const request = hello();
  const mutations = [
    result => { result.capabilities[0].selectedVersion = 2; },
    result => { result.capabilities[0].contractDigest = null; },
    result => { result.capabilities[0].operationsDigest = null; },
    result => {
      result.capabilities[0].error = {
        code: M2_REMOTE_CORE_ERROR_CODE.CAPABILITY_UNAVAILABLE,
        message: 'forged mixed state',
        retryable: false,
      };
    },
  ];
  for (const mutate of mutations) {
    const result = negotiated(request);
    mutate(result);
    assert.equal(validateM2RemoteCoreNegotiationForHello(request, result).valid, false);
  }
});

test('response identity, descriptor, hello digest and chronology are exact', () => {
  const request = hello();
  const mutations = [
    result => { result.requestId = 'remote-request-foreign'; },
    result => { result.helloDigest = DIGEST_A; },
    result => { result.descriptorDigest = DIGEST_B; },
    result => { result.negotiatedAt = '2026-08-24T08:29:59.999Z'; },
    result => { result.extra = true; },
  ];
  for (const mutate of mutations) {
    const result = negotiated(request);
    mutate(result);
    assert.equal(validateM2RemoteCoreNegotiationForHello(request, result).valid, false);
  }
});

test('unavailable result factory refuses a timestamp before the hello', () => {
  assert.throws(
    () => createM2RemoteCoreUnavailableNegotiation(
      hello(),
      '2026-08-24T08:29:59.999Z',
    ),
    /negotiated-before-hello/,
  );
});

test('unavailable is not valid when any capability is available', () => {
  const request = hello();
  const result = negotiated(request);
  result.status = M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE;
  result.error = {
    code: M2_REMOTE_CORE_ERROR_CODE.NO_CAPABILITY_AVAILABLE,
    message: 'false aggregate denial',
    retryable: false,
  };
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.includes('remote-core-negotiation:unavailable-with-available-capability'),
    true,
  );
});

summary();
