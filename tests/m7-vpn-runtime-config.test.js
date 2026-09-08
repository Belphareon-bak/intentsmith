#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  createHash, generateKeyPairSync, sign,
} from 'node:crypto';

import {
  M7_SYSTEMD_CREDENTIAL_NAMES,
  M7_VPN_RUNTIME_CONFIG_ERROR,
  M7_VPN_RUNTIME_CONFIG_STAGE,
  assertM7VpnRuntimeConfigurationCurrent,
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

function derLength(length) {
  if (length < 128) return Buffer.from([length]);
  const bytes = [];
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function ephemeralTestCertificate() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const algorithm = der(0x30, Buffer.from('06032b6570', 'hex'));
  const commonName = der(0x30,
    Buffer.from('0603550403', 'hex'),
    der(0x0c, Buffer.from('IntentSmith M7 TEST ONLY', 'utf8')),
  );
  const name = der(0x30, der(0x31, commonName));
  const validity = der(0x30,
    der(0x17, Buffer.from('260101000000Z', 'ascii')),
    der(0x17, Buffer.from('300101000000Z', 'ascii')),
  );
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const tbs = der(0x30,
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.from([1])),
    algorithm,
    name,
    validity,
    name,
    spki,
  );
  const certificateDer = der(0x30,
    tbs,
    algorithm,
    der(0x03, Buffer.from([0]), sign(null, tbs, privateKey)),
  );
  const pem = (label, bytes) => Buffer.from(
    `-----BEGIN ${label}-----\n${bytes.toString('base64').match(/.{1,64}/gu).join('\n')}\n`
      + `-----END ${label}-----\n`,
    'ascii',
  );
  return {
    certificate: pem('CERTIFICATE', certificateDer),
    pin: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
    privateKey: Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' })),
    rateLimitKey: Buffer.alloc(32, 0xa5),
  };
}

function credentialIo(material) {
  const bySuffix = new Map([
    [M7_SYSTEMD_CREDENTIAL_NAMES.certificate, material.certificate],
    [M7_SYSTEMD_CREDENTIAL_NAMES.privateKey, material.privateKey],
    [M7_SYSTEMD_CREDENTIAL_NAMES.rateLimitKey, material.rateLimitKey],
  ]);
  const bytesFor = path => [...bySuffix].find(([name]) => path.endsWith(`/${name}`))?.[1];
  return {
    lstatSync(path) {
      const bytes = bytesFor(path);
      if (!bytes) throw new Error('missing');
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100600,
        size: bytes.length,
        uid: UID,
      };
    },
    readFileSync(path) { return Buffer.from(bytesFor(path)); },
    realpathSync(path) { return path; },
  };
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

test('the interface binding is re-observed immediately before a future bind', () => {
  let current = interfaces();
  const value = config({}, () => current);
  assert.equal(assertM7VpnRuntimeConfigurationCurrent(value), true);
  current = { tailscale0: [] };
  expectCode(
    () => assertM7VpnRuntimeConfigurationCurrent(value),
    M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE,
  );
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

test('ephemeral TEST-only cert, private key and pin bind before one-shot material is zeroed', () => {
  const material = ephemeralTestCertificate();
  const value = config({ INTENTSMITH_M7_SERVER_SPKI_SHA256: material.pin });
  let observed;
  const result = withM7ServiceCredentialMaterial(value, bytes => {
    observed = bytes;
    assert.equal(bytes.certificate.includes(Buffer.from('BEGIN CERTIFICATE')), true);
    assert.equal(bytes.privateKey.includes(Buffer.from('BEGIN PRIVATE KEY')), true);
    assert.equal(bytes.rateLimitKey.equals(Buffer.alloc(32, 0xa5)), true);
    return 'consumed';
  }, {
    io: credentialIo(material),
    now: () => Date.parse('2026-09-08T12:00:00.000Z'),
  });
  assert.equal(result, 'consumed');
  assert.equal(observed.certificate.every(byte => byte === 0), true);
  assert.equal(observed.privateKey.every(byte => byte === 0), true);
  assert.equal(observed.rateLimitKey.every(byte => byte === 0), true);
});

test('certificate/key mismatch and non-32-byte rate key fail closed', () => {
  const material = ephemeralTestCertificate();
  const other = ephemeralTestCertificate();
  const value = config({ INTENTSMITH_M7_SERVER_SPKI_SHA256: material.pin });
  expectCode(() => withM7ServiceCredentialMaterial(value, () => true, {
    io: credentialIo({ ...material, privateKey: other.privateKey }),
    now: () => Date.parse('2026-09-08T12:00:00.000Z'),
  }), M7_VPN_RUNTIME_CONFIG_ERROR.CERTIFICATE_INVALID);
  expectCode(() => withM7ServiceCredentialMaterial(value, () => true, {
    io: credentialIo({ ...material, rateLimitKey: Buffer.alloc(31) }),
    now: () => Date.parse('2026-09-08T12:00:00.000Z'),
  }), M7_VPN_RUNTIME_CONFIG_ERROR.CREDENTIAL_INVALID);
});

summary();
