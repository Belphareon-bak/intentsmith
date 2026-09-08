import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import { networkInterfaces as observeNetworkInterfaces } from 'node:os';
import { join } from 'node:path';

export const M7_VPN_RUNTIME_CONFIG_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_VPN_RUNTIME_CONFIG_ERROR = Object.freeze({
  CERTIFICATE_INVALID: 'M7_VPN_CERTIFICATE_INVALID',
  CONFIG_INVALID: 'M7_VPN_CONFIG_INVALID',
  CREDENTIAL_INVALID: 'M7_VPN_CREDENTIAL_INVALID',
  CREDENTIAL_UNAVAILABLE: 'M7_VPN_CREDENTIAL_UNAVAILABLE',
  VPN_INTERFACE_UNAVAILABLE: 'M7_VPN_INTERFACE_UNAVAILABLE',
});

export const M7_SYSTEMD_CREDENTIAL_NAMES = Object.freeze({
  certificate: 'intentsmith-m7-tls-certificate.pem',
  privateKey: 'intentsmith-m7-tls-private-key.pem',
  rateLimitKey: 'intentsmith-m7-rate-limit-hmac.bin',
});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const VPN_INTERFACE = /^(?:tailscale0|wg(?:[0-9]+|-[A-Za-z0-9_.-]+)|tun(?:[0-9]+|-[A-Za-z0-9_.-]+))$/u;
const configurations = new WeakSet();
const configurationObservers = new WeakMap();

export class M7VpnRuntimeConfigError extends Error {
  constructor(code, message) {
    super(`m7-vpn-runtime:${message}`);
    this.name = 'M7VpnRuntimeConfigError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7VpnRuntimeConfigError(code, message);
}

function exactCredentialDirectory(value, effectiveUid) {
  if (value === '/run/credentials/intentsmith-m7.service') return true;
  return value === `/run/user/${effectiveUid}/credentials/intentsmith-m7.service`;
}

function canonicalIp(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 128) return null;
  const zoneAt = value.indexOf('%');
  const address = zoneAt === -1 ? value : value.slice(0, zoneAt);
  return isIP(address) ? address.toLowerCase() : null;
}

function permittedVpnAddress(value) {
  const address = canonicalIp(value);
  const family = address === null ? 0 : isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (family === 6) {
    return /^(?:fc|fd)[0-9a-f]{2}:/u.test(address);
  }
  return false;
}

function exactOrigin(value, bindAddress) {
  try {
    const origin = new URL(value);
    return origin.protocol === 'https:'
      && origin.username === ''
      && origin.password === ''
      && origin.pathname === '/'
      && origin.search === ''
      && origin.hash === ''
      && origin.port === '7443'
      && origin.origin === value
      && origin.hostname !== ''
      && origin.hostname !== 'localhost'
      && canonicalIp(origin.hostname) !== '127.0.0.1'
      && permittedVpnAddress(bindAddress);
  } catch {
    return false;
  }
}

function interfaceHasAddress(interfaces, interfaceName, bindAddress) {
  const expected = canonicalIp(bindAddress);
  const observed = interfaces?.[interfaceName];
  return Array.isArray(observed) && observed.some(item => (
    item && item.internal === false && canonicalIp(item.address) === expected
  ));
}

export function createM7VpnRuntimeConfiguration({
  effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : process.getuid(),
  env = process.env,
  networkInterfaces = observeNetworkInterfaces,
} = {}) {
  if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0
    || !env || typeof env !== 'object'
    || typeof networkInterfaces !== 'function') {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'observer-config-invalid');
  }
  if (env.INTENTSMITH_M7_REMOTE_ENABLED !== 'true') {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'remote-not-explicitly-enabled');
  }
  const interfaceName = env.INTENTSMITH_M7_VPN_INTERFACE;
  const bindAddress = env.INTENTSMITH_M7_BIND_ADDRESS;
  const serverOrigin = env.INTENTSMITH_M7_SERVER_ORIGIN;
  const serverIdentityPin = env.INTENTSMITH_M7_SERVER_SPKI_SHA256;
  const credentialsDirectory = env.CREDENTIALS_DIRECTORY;
  if (!VPN_INTERFACE.test(interfaceName || '')) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'vpn-interface-name-invalid');
  }
  if (!exactCredentialDirectory(credentialsDirectory, effectiveUid)) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'systemd-credential-directory-invalid');
  }
  if (!SHA256.test(serverIdentityPin || '') || !exactOrigin(serverOrigin, bindAddress)) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'origin-or-pin-invalid');
  }
  let interfaces;
  try {
    interfaces = networkInterfaces();
  } catch {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE, 'interface-observation-failed');
  }
  if (!interfaceHasAddress(interfaces, interfaceName, bindAddress)) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE, 'vpn-interface-address-unavailable');
  }
  const config = Object.freeze({
    bindAddress,
    credentialOwnerUid: effectiveUid,
    credentialPaths: Object.freeze({
      certificate: join(credentialsDirectory, M7_SYSTEMD_CREDENTIAL_NAMES.certificate),
      privateKey: join(credentialsDirectory, M7_SYSTEMD_CREDENTIAL_NAMES.privateKey),
      rateLimitKey: join(credentialsDirectory, M7_SYSTEMD_CREDENTIAL_NAMES.rateLimitKey),
    }),
    interfaceName,
    listener: Object.freeze({
      bindAddress,
      port: 7443,
      serverIdentityPin,
      serverOrigin,
      tlsMaximumVersion: 'TLSv1.3',
      tlsMinimumVersion: 'TLSv1.3',
      trustProxy: false,
    }),
    rateLimit: Object.freeze({ maximumRows: 50_000, retentionMs: 86_400_000 }),
    serverIdentityPin,
    serverOrigin,
    stage: M7_VPN_RUNTIME_CONFIG_STAGE,
  });
  configurations.add(config);
  configurationObservers.set(config, networkInterfaces);
  return config;
}

export function assertM7VpnRuntimeConfigurationCurrent(config) {
  if (!configurations.has(config)) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'runtime-config-not-genuine');
  }
  let interfaces;
  try {
    interfaces = configurationObservers.get(config)();
  } catch {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE, 'interface-recheck-failed');
  }
  if (!interfaceHasAddress(interfaces, config.interfaceName, config.bindAddress)) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.VPN_INTERFACE_UNAVAILABLE, 'vpn-interface-address-changed');
  }
  return true;
}

function readCredential(path, maximumBytes, field, ownerUid, io) {
  try {
    const stat = io.lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== ownerUid || (stat.mode & 0o077) !== 0
      || stat.size < 1 || stat.size > maximumBytes
      || io.realpathSync(path) !== path) {
      fail(M7_VPN_RUNTIME_CONFIG_ERROR.CREDENTIAL_INVALID, `${field}-metadata-invalid`);
    }
    const bytes = io.readFileSync(path);
    if (!Buffer.isBuffer(bytes) || bytes.length !== stat.size) {
      fail(M7_VPN_RUNTIME_CONFIG_ERROR.CREDENTIAL_INVALID, `${field}-read-invalid`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof M7VpnRuntimeConfigError) throw error;
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CREDENTIAL_UNAVAILABLE, `${field}-unavailable`);
  }
}

function spkiDigest(keyObject) {
  return `sha256:${createHash('sha256').update(keyObject.export({
    format: 'der', type: 'spki',
  })).digest('hex')}`;
}

function validateCredentialMaterial(config, material, nowMs = Date.now()) {
  if (!configurations.has(config)
    || !Buffer.isBuffer(material.certificate)
    || !Buffer.isBuffer(material.privateKey)
    || !Buffer.isBuffer(material.rateLimitKey)
    || material.rateLimitKey.length !== 32
    || !Number.isSafeInteger(nowMs) || nowMs < 1) {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CREDENTIAL_INVALID, 'credential-shape-invalid');
  }
  try {
    const certificate = new X509Certificate(material.certificate);
    const privateKey = createPrivateKey(material.privateKey);
    const certificateSpki = certificate.publicKey.export({ format: 'der', type: 'spki' });
    const privateSpki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
    if (!certificateSpki.equals(privateSpki)
      || spkiDigest(certificate.publicKey) !== config.serverIdentityPin
      || Date.parse(certificate.validFrom) > nowMs
      || Date.parse(certificate.validTo) <= nowMs) {
      fail(M7_VPN_RUNTIME_CONFIG_ERROR.CERTIFICATE_INVALID, 'certificate-binding-invalid');
    }
  } catch (error) {
    if (error instanceof M7VpnRuntimeConfigError) throw error;
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CERTIFICATE_INVALID, 'certificate-parse-invalid');
  }
  return true;
}

export function withM7ServiceCredentialMaterial(config, callback, {
  io = { lstatSync, readFileSync, realpathSync },
  now = Date.now,
} = {}) {
  if (!configurations.has(config) || typeof callback !== 'function' || typeof now !== 'function') {
    fail(M7_VPN_RUNTIME_CONFIG_ERROR.CONFIG_INVALID, 'credential-consumer-invalid');
  }
  const material = {
    certificate: readCredential(
      config.credentialPaths.certificate, 65_536, 'certificate', config.credentialOwnerUid, io,
    ),
    privateKey: readCredential(
      config.credentialPaths.privateKey, 32_768, 'private-key', config.credentialOwnerUid, io,
    ),
    rateLimitKey: readCredential(
      config.credentialPaths.rateLimitKey, 32, 'rate-limit-key', config.credentialOwnerUid, io,
    ),
  };
  try {
    validateCredentialMaterial(config, material, now());
    return callback(material);
  } finally {
    material.certificate.fill(0);
    material.privateKey.fill(0);
    material.rateLimitKey.fill(0);
  }
}

export function isGenuineM7VpnRuntimeConfiguration(value) {
  return configurations.has(value);
}

export const _testInternals = Object.freeze({
  exactCredentialDirectory,
  interfaceHasAddress,
  validateCredentialMaterial,
});

export default createM7VpnRuntimeConfiguration;
