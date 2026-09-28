#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { suite, test, summary } from './harness.js';
import {
  M2_REMOTE_CORE_CAPABILITY_IDS,
  M2_REMOTE_CORE_CAPABILITY_STATUS,
  M2_REMOTE_CORE_ERROR_CODE,
  M2_REMOTE_CORE_NEGOTIATION_STATUS,
  M2_REMOTE_CORE_PORT_DESCRIPTOR_V1,
  M2_REMOTE_CORE_PORT_KIND,
  M2_REMOTE_CORE_PORT_VERSION,
  validateM2RemoteCoreNegotiationForHello,
} from '../contracts/m2/remote-core-port-v1.js';
import { createUnavailableRemoteCorePort } from '../src/remote/remote-core-port-unavailable.js';
import {
  LEGACY_LISTENER_LOOPBACK_HOSTS,
  LEGACY_LISTENER_LOOPBACK_REQUIRED,
  listenOnLegacyLoopback,
  requireLegacyLoopbackHost,
} from '../src/security/legacy-listener-policy.js';

const SENT_AT = '2026-08-24T09:00:00.000Z';
const CLOCK_MS = Date.parse('2026-08-24T09:00:00.001Z');

function hello(overrides = {}) {
  return {
    contract: M2_REMOTE_CORE_PORT_KIND.HELLO,
    version: M2_REMOTE_CORE_PORT_VERSION,
    requestId: 'remote-boundary-001',
    clientId: 'companion-boundary-fixture',
    clientBuild: 'design-only-0.1.0',
    supportedPortVersions: [1],
    capabilities: M2_REMOTE_CORE_CAPABILITY_IDS.map(capabilityId => ({
      capabilityId,
      versions: [1],
    })),
    sentAt: SENT_AT,
    ...overrides,
  };
}

function importSpecifiers(source) {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .sort();
}

suite('M2 RemoteCorePort v1 — unavailable provider truth');

test('provider is frozen and exposes only describe plus negotiate', () => {
  const provider = createUnavailableRemoteCorePort({ clock: () => CLOCK_MS });
  assert.equal(Object.isFrozen(provider), true);
  assert.deepEqual(Object.keys(provider), ['describe', 'negotiate']);
  for (const forbidden of ['listen', 'connect', 'pair', 'invoke', 'fetch', 'approve']) {
    assert.equal(forbidden in provider, false, forbidden);
  }
  assert.equal(provider.describe(), M2_REMOTE_CORE_PORT_DESCRIPTOR_V1);
});

test('compatible hello returns no empty success and one explicit denial per capability', () => {
  const provider = createUnavailableRemoteCorePort({ clock: () => CLOCK_MS });
  const request = hello();
  const result = provider.negotiate(request);
  const validation = validateM2RemoteCoreNegotiationForHello(request, result);
  assert.equal(validation.valid, true, validation.errors.join(', '));
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.UNAVAILABLE);
  assert.deepEqual(
    result.capabilities.map(capability => capability.capabilityId),
    M2_REMOTE_CORE_CAPABILITY_IDS,
  );
  assert.equal(result.capabilities.every(capability => (
    capability.status === M2_REMOTE_CORE_CAPABILITY_STATUS.UNAVAILABLE
    && capability.selectedVersion === null
    && capability.contractDigest === null
    && capability.operationsDigest === null
    && capability.error.code === M2_REMOTE_CORE_ERROR_CODE.PROVIDER_UNAVAILABLE
  )), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.capabilities), true);
  assert.equal(Object.isFrozen(result.capabilities[0].error), true);
});

test('unshared version is incompatible rather than provider-success or empty negotiated', () => {
  const provider = createUnavailableRemoteCorePort({ clock: () => CLOCK_MS });
  const request = hello({ supportedPortVersions: [2] });
  const result = provider.negotiate(request);
  assert.equal(result.status, M2_REMOTE_CORE_NEGOTIATION_STATUS.INCOMPATIBLE);
  assert.equal(result.selectedPortVersion, null);
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.error.code, M2_REMOTE_CORE_ERROR_CODE.PORT_VERSION_INCOMPATIBLE);
  assert.equal(validateM2RemoteCoreNegotiationForHello(request, result).valid, true);
});

test('invalid hello is rejected before even the provider clock is consulted', () => {
  let clockCalls = 0;
  const provider = createUnavailableRemoteCorePort({
    clock: () => {
      clockCalls += 1;
      return CLOCK_MS;
    },
  });
  assert.throws(
    () => provider.negotiate({ ...hello(), token: 'forged-secret' }),
    /unknown-token/,
  );
  assert.equal(clockCalls, 0);
});

test('invalid clock cannot produce a syntactically successful result', () => {
  const provider = createUnavailableRemoteCorePort({ clock: () => Number.NaN });
  assert.throws(() => provider.negotiate(hello()), /clock-invalid/);
});

suite('M2 RemoteCorePort v1 — physical legacy boundary');

test('contract and provider import graph cannot reach server, routes, DB or network modules', () => {
  const contractSource = readFileSync(
    new URL('../contracts/m2/remote-core-port-v1.js', import.meta.url),
    'utf8',
  );
  const providerSource = readFileSync(
    new URL('../src/remote/remote-core-port-unavailable.js', import.meta.url),
    'utf8',
  );
  assert.deepEqual(importSpecifiers(contractSource), [
    '../m1/shared.js',
    './execution-v1.js',
  ]);
  assert.deepEqual(importSpecifiers(providerSource), [
    '../../contracts/m2/remote-core-port-v1.js',
  ]);
  const forbidden = [
    'node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram',
    '/server', '/routes/', '/db/', '/ws-bridge/', 'better-sqlite3',
  ];
  for (const token of forbidden) {
    assert.equal(contractSource.includes(token), false, `contract: ${token}`);
    assert.equal(providerSource.includes(token), false, `provider: ${token}`);
  }
});

test('production server does not import or instantiate the RemoteCorePort placeholder', () => {
  const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  for (const token of [
    'remote-core-port-v1',
    'remote-core-port-unavailable',
    'createUnavailableRemoteCorePort',
  ]) assert.equal(serverSource.includes(token), false, token);
});

test('legacy listener remains exact numeric loopback and rejects remote-shaped hosts', () => {
  assert.deepEqual(LEGACY_LISTENER_LOOPBACK_HOSTS, ['127.0.0.1']);
  assert.equal(requireLegacyLoopbackHost(' 127.0.0.1 '), '127.0.0.1');
  for (const host of [
    '0.0.0.0', 'localhost', '::1', '::', '192.168.1.20', '10.0.0.5', '', null,
  ]) {
    assert.throws(
      () => requireLegacyLoopbackHost(host),
      error => error.code === LEGACY_LISTENER_LOOPBACK_REQUIRED,
      String(host),
    );
  }
});

test('legacy check and bind use the same canonical host and denial never calls listen', () => {
  const calls = [];
  const server = {
    listen(...args) {
      calls.push(args);
      return 'listener-handle';
    },
  };
  assert.equal(
    listenOnLegacyLoopback(server, { host: '127.0.0.1', port: 3131 }, 'ready'),
    'listener-handle',
  );
  assert.deepEqual(calls, [[3131, '127.0.0.1', 'ready']]);
  assert.throws(
    () => listenOnLegacyLoopback(server, { host: '0.0.0.0', port: 3131 }, 'forged'),
    error => error.code === LEGACY_LISTENER_LOOPBACK_REQUIRED,
  );
  assert.equal(calls.length, 1);
});

test('threat model explicitly defers listener, pairing and authentication to M7', () => {
  const threatModel = readFileSync(
    new URL('../docs/security/REMOTE-CORE-PORT-V1-THREAT-MODEL.md', import.meta.url),
    'utf8',
  );
  const normalizedThreatModel = threatModel.replace(/\s+/g, ' ');
  for (const phrase of [
    'not a listener, authentication protocol, pairing flow',
    'M7 must add a physically separate listener',
    'They are not a transport implementation for this connector',
    'negotiation does not instantiate or satisfy any of them',
  ]) assert.equal(normalizedThreatModel.includes(phrase), true, phrase);
});

summary();
