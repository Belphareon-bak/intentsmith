#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  M7_SYSTEMD_CREDENTIAL_NAMES,
  M7_VPN_RUNTIME_CONFIG_ERROR,
  M7_VPN_RUNTIME_CONFIG_STAGE,
  createM7VpnRuntimeConfiguration,
  isGenuineM7VpnRuntimeConfiguration,
  withM7ServiceCredentialMaterial,
} from '../src/remote/m7-vpn-runtime-config.js';
import { suite, summary, test } from './harness.js';

const UID = 1234;
const BASE_ENV = Object.freeze({
  CREDENTIALS_DIRECTORY: `/run/user/${UID}/credentials/intentsmith-m7.service`,
  INTENTSMITH_M7_BIND_ADDRESS: '100.100.20.30',
  INTENTSMITH_M7_REMOTE_ENABLED: 'true',
  INTENTSMITH_M7_SERVER_ORIGIN: 'https://intentsmith.tailnet.example:7443',
  INTENTSMITH_M7_SERVER_SPKI_SHA256: `sha256:${'a'.repeat(64)}`,
  INTENTSMITH_M7_VPN_INTERFACE: 'tailscale0',
});

function interfaces() {
  return {
    tailscale0: [{ address: '100.100.20.30', family: 'IPv4', internal: false }],
    wlo1: [{ address: '192.168.50.33', family: 'IPv4', internal: false }],
  };
}

function config(overrides = {}, observed = interfaces) {
  return createM7VpnRuntimeConfiguration({
    effectiveUid: UID,
    env: { ...BASE_ENV, ...overrides },
    networkInterfaces: observed,
  });
}

function expectCode(callback, code) {
  assert.throws(callback, error => error?.code === code);
}

suite('M7 VPN-only runtime configuration and systemd credential custody');

test('exact VPN interface, port, origin, pin, retention and cap are immutable', () => {
  const value = config();
  assert.equal(value.stage, M7_VPN_RUNTIME_CONFIG_STAGE);
  assert.equal(isGenuineM7VpnRuntimeConfiguration(value), true);
  assert.deepEqual(value.listener, {
    bindAddress: '100.100.20.30',
    port: 7443,
    serverIdentityPin: BASE_ENV.INTENTSMITH_M7_SERVER_SPKI_SHA256,
    serverOrigin: BASE_ENV.INTENTSMITH_M7_SERVER_ORIGIN,
    tlsMaximumVersion: 'TLSv1.3',
    tlsMinimumVersion: 'TLSv1.3',
    trustProxy: false,
  });
  assert.deepEqual(value.rateLimit, { maximumRows: 50_000, retentionMs: 86_400_000 });
  assert.equal(value.credentialOwnerUid, UID);
  assert.deepEqual(Object.keys(value.credentialPaths).sort(), Object.keys(M7_SYSTEMD_CREDENTIAL_NAMES).sort());
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.listener), true);
});

test('activation is explicit and cannot use LAN, wildcard or symbolic interface', () => {
  for (const invalid of [
    { INTENTSMITH_M7_REMOTE_ENABLED: '1' },
    { INTENTSMITH_M7_VPN_INTERFACE: 'wlo1', INTENTSMITH_M7_BIND_ADDRESS: '192.168.50.33' },
    { INTENTSMITH_M7_VPN_INTERFACE: 'eth0' },
    { INTENTSMITH_M7_BIND_ADDRESS: '0.0.0.0' },
    { INTENTSMITH_M7_BIND_ADDRESS: '8.8.8.8' },
    { INTENTSMITH_M7_SERVER_ORIGIN: 'http://intentsmith.tailnet.example:7443' },
    { INTENTSMITH_M7_SERVER_ORIGIN: 'https://intentsmith.tailnet.example' },
    { INTENTSMITH_M7_SERVER_SPKI_SHA256: 'sha256:forged' },
  ]) expectCode(() => config(invalid), M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID);
});

test('configured VPN address must be observed on that exact active interface', () => {
  expectCode(() => config({}, () => ({
    tailscale0: [{ address: '100.100.20.31', family: 'IPv4', internal: false }],
  })), M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE);
  expectCode(() => config({}, () => {
    throw new Error('unreadable');
  }), M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE);
});

test('credential directory is pinned to the dedicated system or same-user systemd unit', () => {
  assert.equal(config({
    CREDENTIALS_DIRECTORY: '/run/credentials/intentsmith-m7.service',
  }).credentialPaths.privateKey, '/run/credentials/intentsmith-m7.service/intentsmith-m7-tls-private-key.pem');
  for (const path of [
    '/tmp/intentsmith-m7.service',
    '/home/user/.credentials',
    `/run/user/${UID + 1}/credentials/intentsmith-m7.service`,
    `/run/user/${UID}/credentials/other.service`,
  ]) expectCode(() => config({ CREDENTIALS_DIRECTORY: path }), M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID);
});

test('credential reads fail closed for missing material and reject structural clones', () => {
  const genuine = config();
  expectCode(
    () => withM7ServiceCredentialMaterial(genuine, () => true),
    M7_VPN_RUNTIME_CONFIG_ERROR.CREDENTIAL_UNAVAILABLE,
  );
  expectCode(
    () => withM7ServiceCredentialMaterial({ ...genuine }, () => true),
    M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID,
  );
});

summary();
