#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOBILE_REMOTE_SESSION_CONTRACT_V1,
} from '../docs/mobile/contracts/remote-session-contract-v1.js';
import {
  M7_TRANSPORT_ADMISSION_ERROR,
  M7_TRANSPORT_ADMISSION_STAGE,
  M7_TRANSPORT_ROUTES,
  createM7TransportAdmissionPolicy,
  isGenuineM7TransportAdmissionPolicy,
} from '../src/remote/m7-transport-admission-policy.js';
import { suite, summary, test } from './harness.js';

const SERVER_ORIGIN = 'https://intentsmith.home.arpa:7443';
const SERVER_PIN = `sha256:${'a'.repeat(64)}`;
const KEY = Buffer.from('11'.repeat(32), 'hex');

function createPolicy(overrides = {}) {
  return createM7TransportAdmissionPolicy({
    listener: {
      bindAddress: '192.168.50.10',
      port: 7443,
      serverIdentityPin: SERVER_PIN,
      serverOrigin: SERVER_ORIGIN,
      tlsMaximumVersion: 'TLSv1.3',
      tlsMinimumVersion: 'TLSv1.3',
      trustProxy: false,
      ...(overrides.listener || {}),
    },
    peerIdentityKey: overrides.peerIdentityKey || KEY,
  });
}

function request(overrides = {}) {
  const method = overrides.method || 'POST';
  const bodyHeaders = method === 'GET'
    ? ['X-IntentSmith-Request-Id', 'request:health:transport']
    : ['Content-Type', 'application/json', 'Content-Length', '128'];
  return {
    httpVersion: '1.1',
    method,
    rawHeaders: ['Host', 'intentsmith.home.arpa:7443', ...bodyHeaders],
    remoteAddress: '192.168.50.22',
    socketEncrypted: true,
    target: method === 'GET' ? '/remote/v1/health' : '/remote/v1/session/open',
    tlsVersion: 'TLSv1.3',
    ...overrides,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code);
}

suite('M7 LAN/VPN transport admission policy');

test('listener configuration is exact TLS 1.3 on a concrete LAN or VPN address', () => {
  for (const bindAddress of ['10.8.0.4', '100.100.20.30', 'fd7a:115c:a1e0::1']) {
    const policy = createPolicy({ listener: { bindAddress } });
    assert.equal(policy.stage, M7_TRANSPORT_ADMISSION_STAGE);
    assert.equal(policy.listener.trustProxy, false);
    assert.equal(policy.listener.tlsMinimumVersion, 'TLSv1.3');
    assert.equal(policy.listener.tlsMaximumVersion, 'TLSv1.3');
  }
  for (const bindAddress of ['0.0.0.0', '::', '127.0.0.1', '8.8.8.8', '2001:4860:4860::8888']) {
    expectCode(
      () => createPolicy({ listener: { bindAddress } }),
      M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID,
    );
  }
  expectCode(
    () => createPolicy({ listener: { tlsMinimumVersion: 'TLSv1.2' } }),
    M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID,
  );
  expectCode(
    () => createPolicy({ listener: { trustProxy: true } }),
    M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID,
  );
  expectCode(
    () => createPolicy({ listener: { serverOrigin: 'https://intentsmith.home.arpa' } }),
    M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID,
  );
});

test('only direct loopback, LAN, shared VPN, ULA and zoned link-local peers pass', () => {
  const policy = createPolicy();
  const peers = [
    ['127.0.0.1', 'loopback'],
    ['10.0.0.9', 'lan_private'],
    ['172.31.255.2', 'lan_private'],
    ['192.168.1.2', 'lan_private'],
    ['100.64.0.1', 'vpn_shared'],
    ['fd7a:115c:a1e0::9', 'vpn_or_lan_ula'],
    ['fe80::1%wlan0', 'link_local'],
  ];
  for (const [remoteAddress, scope] of peers) {
    assert.equal(policy.admit(request({ remoteAddress })).peerScope, scope);
  }
  for (const remoteAddress of [
    '8.8.8.8', '203.0.113.9', '2001:4860:4860::8888', 'fe80::1', 'not-an-ip',
  ]) {
    expectCode(
      () => policy.admit(request({ remoteAddress })),
      M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED,
    );
  }
});

test('exact route, method, TLS, HTTP version and Host are required', () => {
  const policy = createPolicy();
  assert.equal(policy.admit(request()).routeId, 'session-open');
  assert.equal(policy.admit(request({
    method: 'GET',
    rawHeaders: [
      'Host', 'intentsmith.home.arpa:7443',
      'X-IntentSmith-Request-Id', 'request:health:transport',
    ],
    target: '/remote/v1/health',
  })).requestId, 'request:health:transport');
  for (const invalid of [
    { socketEncrypted: false },
    { tlsVersion: 'TLSv1.2' },
    { httpVersion: '2.0' },
    { target: '/remote/v1/session/open?x=1' },
    { target: '/api/status' },
    { target: '/m1/chat' },
    { target: '/c3/ws' },
    { method: 'GET', target: '/remote/v1/session/open' },
    { rawHeaders: ['Host', 'evil.example', 'Content-Type', 'application/json', 'Content-Length', '128'] },
  ]) expectCode(() => policy.admit(request(invalid)), invalid.tlsVersion || invalid.socketEncrypted === false || invalid.httpVersion
    ? M7_TRANSPORT_ADMISSION_ERROR.TLS_REQUIRED
    : invalid.rawHeaders
      ? M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID
      : M7_TRANSPORT_ADMISSION_ERROR.REQUEST_DENIED);
});

test('public health owns one exact header request identity and POST routes reject it', () => {
  const policy = createPolicy();
  expectCode(() => policy.admit(request({
    method: 'GET',
    rawHeaders: ['Host', 'intentsmith.home.arpa:7443'],
    target: '/remote/v1/health',
  })), M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID);
  expectCode(() => policy.admit(request({
    rawHeaders: [
      'Host', 'intentsmith.home.arpa:7443',
      'Content-Type', 'application/json',
      'Content-Length', '128',
      'X-IntentSmith-Request-Id', 'request:ambiguous',
    ],
  })), M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID);
});

test('headers reject credentials, proxy identity, cookies, ambiguity and streaming bodies', () => {
  const policy = createPolicy();
  for (const extra of [
    ['Authorization', 'Bearer forged'],
    ['Cookie', 'sid=forged'],
    ['Forwarded', 'for=203.0.113.9'],
    ['X-Forwarded-For', '203.0.113.9'],
    ['X-Real-IP', '203.0.113.9'],
    ['Transfer-Encoding', 'chunked'],
    ['Host', 'intentsmith.home.arpa:7443'],
  ]) {
    expectCode(() => policy.admit(request({
      rawHeaders: [
        'Host', 'intentsmith.home.arpa:7443',
        'Content-Type', 'application/json',
        'Content-Length', '128',
        ...extra,
      ],
    })), M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID);
  }
  expectCode(() => policy.admit(request({
    rawHeaders: ['Host', 'intentsmith.home.arpa:7443', 'Content-Type', 'text/plain', 'Content-Length', '128'],
  })), M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID);
  expectCode(() => policy.admit(request({
    rawHeaders: ['Host', 'intentsmith.home.arpa:7443', 'Content-Type', 'application/json'],
  })), M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID);
});

test('body and header limits fail before any future authority or provider call', () => {
  const policy = createPolicy();
  expectCode(() => policy.admit(request({
    rawHeaders: [
      'Host', 'intentsmith.home.arpa:7443',
      'Content-Type', 'application/json',
      'Content-Length', '1048577',
    ],
    target: '/remote/v1/invoke',
  })), M7_TRANSPORT_ADMISSION_ERROR.LIMIT_EXCEEDED);
  expectCode(() => policy.admit(request({
    rawHeaders: ['Host', 'intentsmith.home.arpa:7443', 'X-Fill', 'x'.repeat(8_192)],
  })), M7_TRANSPORT_ADMISSION_ERROR.LIMIT_EXCEEDED);
  expectCode(() => policy.admit(request({
    method: 'GET',
    rawHeaders: ['Host', 'intentsmith.home.arpa:7443', 'Content-Length', '1'],
    target: '/remote/v1/health',
  })), M7_TRANSPORT_ADMISSION_ERROR.REQUEST_DENIED);
});

test('peer identity is HMAC opaque, canonical and key separated', () => {
  const policy = createPolicy();
  const ipv4 = policy.admit(request({ remoteAddress: '192.168.1.30' }));
  const mapped = policy.admit(request({ remoteAddress: '::ffff:192.168.1.30' }));
  assert.equal(ipv4.peerIdentityDigest, mapped.peerIdentityDigest);
  assert.match(ipv4.peerIdentityDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(ipv4).includes('192.168.1.30'), false);
  const otherKey = createPolicy({ peerIdentityKey: Buffer.from('22'.repeat(32), 'hex') });
  assert.notEqual(
    otherKey.admit(request({ remoteAddress: '192.168.1.30' })).peerIdentityDigest,
    ipv4.peerIdentityDigest,
  );
  assert.equal(JSON.stringify(policy).includes(KEY.toString('hex')), false);
});

test('rate-limit plans require post-parse claim digest or operation class', () => {
  const policy = createPolicy();
  const pairing = policy.admit(request({ target: '/remote/v1/pairing/claim' }));
  const pairingPlan = policy.createRateLimitPlan(pairing, {
    claimCodeDigest: `sha256:${'b'.repeat(64)}`,
  });
  assert.deepEqual(pairingPlan.buckets.map(item => [
    item.bucket, item.configurationId, item.maximum, item.windowSeconds,
  ]), [
    ['pairing-global', 'pairing-claim', 30, 600],
    ['pairing-peer', 'pairing-claim', 5, 600],
    ['pairing-peer-claim', 'pairing-claim', 5, 600],
  ]);
  assert.equal(JSON.stringify(pairingPlan).includes('b'.repeat(64)), false);
  expectCode(
    () => policy.createRateLimitPlan(pairing, {}),
    M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID,
  );

  const invocation = policy.admit(request({ target: '/remote/v1/invoke' }));
  assert.equal(policy.createRateLimitPlan(invocation, { operationKind: 'read' }).buckets[0].maximum, 60);
  assert.equal(policy.createRateLimitPlan(invocation, { operationKind: 'mutation' }).buckets[0].maximum, 10);
  expectCode(
    () => policy.createRateLimitPlan(invocation, {}),
    M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID,
  );
  expectCode(
    () => policy.createRateLimitPlan({ ...invocation }, { operationKind: 'read' }),
    M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID,
  );
});

test('route surface matches the mobile contract and policy remains disconnected', () => {
  assert.deepEqual(
    [...M7_TRANSPORT_ROUTES.map(route => route.path)].sort(),
    [...MOBILE_REMOTE_SESSION_CONTRACT_V1.listenerBoundary.allowedPaths].sort(),
  );
  const policy = createPolicy();
  assert.equal(isGenuineM7TransportAdmissionPolicy(policy), true);
  assert.equal(isGenuineM7TransportAdmissionPolicy({ ...policy }), false);
  assert.equal(policy.stage, 'IMPLEMENTED_NOT_ACTIVE');
  const source = readFileSync(
    new URL('../src/remote/m7-transport-admission-policy.js', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    'createServer', '.listen(', 'm7-session-authority', 'src/server.js',
    'ws-bridge', 'node:http', 'node:https', 'node:tls',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
  const composition = readFileSync(new URL('../src/remote/m7-core-composition.js', import.meta.url), 'utf8');
  assert.equal(composition.includes('m7-transport-admission-policy'), false);
});

summary();
