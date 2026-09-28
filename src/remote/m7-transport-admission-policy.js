import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const M7_TRANSPORT_ADMISSION_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

export const M7_TRANSPORT_ADMISSION_ERROR = Object.freeze({
  CONFIG_INVALID: 'M7_TRANSPORT_CONFIG_INVALID',
  HEADER_INVALID: 'M7_TRANSPORT_HEADER_INVALID',
  LIMIT_EXCEEDED: 'M7_TRANSPORT_LIMIT_EXCEEDED',
  PEER_DENIED: 'M7_TRANSPORT_PEER_DENIED',
  RATE_LIMIT_INPUT_INVALID: 'M7_TRANSPORT_RATE_LIMIT_INPUT_INVALID',
  REQUEST_DENIED: 'M7_TRANSPORT_REQUEST_DENIED',
  TLS_REQUIRED: 'M7_TRANSPORT_TLS_REQUIRED',
});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const HEADER_VALUE_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/u;
const admissions = new WeakSet();
const policies = new WeakSet();
const rateLimitPlans = new WeakSet();

const ROUTES = Object.freeze([
  Object.freeze({
    access: 'public_health', bodyBytesMaximum: 0, method: 'GET',
    path: '/remote/v1/health', routeId: 'remote-health',
  }),
  Object.freeze({
    access: 'pairing_claim', bodyBytesMaximum: 16_384, method: 'POST',
    path: '/remote/v1/pairing/claim', routeId: 'pairing-claim',
  }),
  Object.freeze({
    access: 'signed_session_control', bodyBytesMaximum: 16_384, method: 'POST',
    path: '/remote/v1/session/challenge', routeId: 'session-challenge',
  }),
  Object.freeze({
    access: 'signed_session_control', bodyBytesMaximum: 16_384, method: 'POST',
    path: '/remote/v1/session/open', routeId: 'session-open',
  }),
  Object.freeze({
    access: 'signed_session_control', bodyBytesMaximum: 16_384, method: 'POST',
    path: '/remote/v1/session/refresh', routeId: 'session-refresh',
  }),
  Object.freeze({
    access: 'signed_session_control', bodyBytesMaximum: 16_384, method: 'POST',
    path: '/remote/v1/session/revoke', routeId: 'session-revoke',
  }),
  Object.freeze({
    access: 'signed_invocation', bodyBytesMaximum: 1_048_576, method: 'POST',
    path: '/remote/v1/invoke', routeId: 'invoke',
  }),
]);

export const M7_TRANSPORT_ROUTES = ROUTES;

export class M7TransportAdmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'M7TransportAdmissionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M7TransportAdmissionError(code, `m7-transport:${message}`);
}

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  return plain(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function parseIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function parseIpv6(value) {
  const zoneIndex = value.indexOf('%');
  const address = zoneIndex === -1 ? value : value.slice(0, zoneIndex);
  const zone = zoneIndex === -1 ? null : value.slice(zoneIndex + 1);
  if (zone !== null && !/^[A-Za-z0-9_.-]{1,64}$/u.test(zone)) return null;
  if (isIP(address) !== 6) return null;

  let expanded = address.toLowerCase();
  const dottedIndex = expanded.lastIndexOf(':');
  if (expanded.includes('.')) {
    const ipv4 = parseIpv4(expanded.slice(dottedIndex + 1));
    if (!ipv4) return null;
    expanded = `${expanded.slice(0, dottedIndex)}:${ipv4.readUInt16BE(0).toString(16)}:${ipv4.readUInt16BE(2).toString(16)}`;
  }
  const halves = expanded.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  const bytes = Buffer.alloc(16);
  groups.forEach((group, index) => bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2));
  return { bytes, zone };
}

function classifyIpv4(bytes) {
  const [a, b] = bytes;
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return 'lan_private';
  }
  if (a === 100 && b >= 64 && b <= 127) return 'vpn_shared';
  if (a === 169 && b === 254) return 'link_local';
  return null;
}

function normalizePeerAddress(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 128) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED, 'peer-address-invalid');
  }
  const ipv4 = parseIpv4(value);
  if (ipv4) {
    const scope = classifyIpv4(ipv4);
    if (!scope) fail(M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED, 'public-peer-denied');
    return Object.freeze({ canonical: `ipv4:${ipv4.toString('hex')}`, scope });
  }
  const ipv6 = parseIpv6(value);
  if (!ipv6) fail(M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED, 'peer-address-invalid');
  const { bytes, zone } = ipv6;
  const mapped = bytes.subarray(0, 10).every(byte => byte === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) {
    const mappedBytes = bytes.subarray(12);
    const scope = classifyIpv4(mappedBytes);
    if (!scope) fail(M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED, 'public-peer-denied');
    return Object.freeze({ canonical: `ipv4:${mappedBytes.toString('hex')}`, scope });
  }
  const loopback = bytes.subarray(0, 15).every(byte => byte === 0) && bytes[15] === 1;
  let scope = null;
  if (loopback) scope = 'loopback';
  else if ((bytes[0] & 0xfe) === 0xfc) scope = 'vpn_or_lan_ula';
  else if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) scope = 'link_local';
  if (!scope) fail(M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED, 'public-peer-denied');
  if (scope === 'link_local' && zone === null) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.PEER_DENIED, 'link-local-zone-required');
  }
  return Object.freeze({
    canonical: `ipv6:${bytes.toString('hex')}${zone === null ? '' : `%${zone}`}`,
    scope,
  });
}

function requireListenerConfig(config) {
  const keys = [
    'bindAddress', 'port', 'serverIdentityPin', 'serverOrigin',
    'tlsMaximumVersion', 'tlsMinimumVersion', 'trustProxy',
  ];
  if (!exactKeys(config, keys)) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'listener-config-shape');
  }
  let binding;
  try {
    binding = normalizePeerAddress(config.bindAddress);
  } catch {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'bind-address-invalid');
  }
  if (!['lan_private', 'vpn_shared', 'vpn_or_lan_ula'].includes(binding.scope)) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'bind-address-not-lan-vpn');
  }
  if (!Number.isSafeInteger(config.port) || config.port < 1024 || config.port > 65_535) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'port-invalid');
  }
  if (config.tlsMinimumVersion !== 'TLSv1.3' || config.tlsMaximumVersion !== 'TLSv1.3') {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'tls-version-invalid');
  }
  if (config.trustProxy !== false || !SHA256.test(config.serverIdentityPin || '')) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'identity-policy-invalid');
  }
  let origin;
  try {
    origin = new URL(config.serverOrigin);
  } catch {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'server-origin-invalid');
  }
  const effectivePort = origin.port ? Number(origin.port) : 443;
  if (origin.protocol !== 'https:'
    || origin.username !== ''
    || origin.password !== ''
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
    || origin.origin !== config.serverOrigin
    || effectivePort !== config.port) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'server-origin-invalid');
  }
  return deepFreeze({
    ...config,
    expectedHost: origin.host.toLowerCase(),
  });
}

function normalizeHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders)
    || rawHeaders.length % 2 !== 0
    || rawHeaders.length > 128) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'raw-headers-invalid');
  }
  const headers = new Map();
  let bytes = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== 'string'
      || typeof value !== 'string'
      || !HEADER_NAME.test(name)
      || HEADER_VALUE_CONTROL.test(value)) {
      fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'header-invalid');
    }
    bytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (bytes > 8_192) fail(M7_TRANSPORT_ADMISSION_ERROR.LIMIT_EXCEEDED, 'headers-too-large');
    const normalizedName = name.toLowerCase();
    if (headers.has(normalizedName)) {
      fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'duplicate-header');
    }
    headers.set(normalizedName, value.trim());
  }
  for (const name of [
    'authorization', 'cookie', 'forwarded', 'proxy-authorization',
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
  ]) {
    if (headers.has(name)) fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'credential-or-proxy-header-denied');
  }
  if (headers.has('transfer-encoding')) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'transfer-encoding-denied');
  }
  return headers;
}

function parseContentLength(headers, route) {
  const raw = headers.get('content-length');
  if (route.method === 'GET') {
    if (raw !== undefined && raw !== '0') {
      fail(M7_TRANSPORT_ADMISSION_ERROR.REQUEST_DENIED, 'get-body-denied');
    }
    if (headers.has('content-type')) {
      fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'get-content-type-denied');
    }
    return 0;
  }
  if (raw === undefined || !/^(?:0|[1-9][0-9]{0,9})$/u.test(raw)) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'content-length-required');
  }
  const length = Number(raw);
  if (length < 2 || length > route.bodyBytesMaximum) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.LIMIT_EXCEEDED, 'body-size-invalid');
  }
  const contentType = headers.get('content-type')?.toLowerCase();
  if (!['application/json', 'application/json; charset=utf-8'].includes(contentType)) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'content-type-invalid');
  }
  return length;
}

function hmacDigest(key, domain, value) {
  return `sha256:${createHmac('sha256', key).update(`${domain}\n${value}`, 'utf8').digest('hex')}`;
}

function rateBucket(key, bucket, configurationId, identity, maximum, windowSeconds) {
  return Object.freeze({
    bucket,
    configurationId,
    identityDigest: hmacDigest(key, `IntentSmith/M7/RateLimit/${bucket}/v1`, identity),
    maximum,
    windowSeconds,
  });
}

export function createM7TransportAdmissionPolicy({ listener, peerIdentityKey } = {}) {
  const config = requireListenerConfig(listener);
  const key = Buffer.isBuffer(peerIdentityKey) || peerIdentityKey instanceof Uint8Array
    ? Buffer.from(peerIdentityKey)
    : null;
  if (key === null || key.length < 32) {
    fail(M7_TRANSPORT_ADMISSION_ERROR.CONFIG_INVALID, 'peer-identity-key-invalid');
  }

  const policy = {
    stage: M7_TRANSPORT_ADMISSION_STAGE,
    listener: config,
    admit(input) {
      if (!exactKeys(input, [
        'httpVersion', 'method', 'rawHeaders', 'remoteAddress', 'socketEncrypted',
        'target', 'tlsVersion',
      ])) {
        fail(M7_TRANSPORT_ADMISSION_ERROR.REQUEST_DENIED, 'request-shape');
      }
      if (input.socketEncrypted !== true
        || input.tlsVersion !== 'TLSv1.3'
        || input.httpVersion !== '1.1') {
        fail(M7_TRANSPORT_ADMISSION_ERROR.TLS_REQUIRED, 'tls13-http11-required');
      }
      if (typeof input.target !== 'string'
        || input.target.includes('?')
        || input.target.includes('#')) {
        fail(M7_TRANSPORT_ADMISSION_ERROR.REQUEST_DENIED, 'target-invalid');
      }
      const route = ROUTES.find(item => item.method === input.method && item.path === input.target);
      if (!route) fail(M7_TRANSPORT_ADMISSION_ERROR.REQUEST_DENIED, 'route-denied');
      const peer = normalizePeerAddress(input.remoteAddress);
      const headers = normalizeHeaders(input.rawHeaders);
      if (headers.get('host')?.toLowerCase() !== config.expectedHost) {
        fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'host-mismatch');
      }
      const contentLength = parseContentLength(headers, route);
      const healthRequestId = headers.get('x-intentsmith-request-id');
      if (route.access === 'public_health') {
        if (!IDENTIFIER.test(healthRequestId || '')) {
          fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'health-request-id-required');
        }
      } else if (healthRequestId !== undefined) {
        fail(M7_TRANSPORT_ADMISSION_ERROR.HEADER_INVALID, 'health-request-id-route-mismatch');
      }
      const admission = deepFreeze({
        access: route.access,
        bodyBytesMaximum: route.bodyBytesMaximum,
        contentLength,
        method: route.method,
        path: route.path,
        peerIdentityDigest: hmacDigest(
          key,
          'IntentSmith/M7/RemotePeerIdentity/v1',
          peer.canonical,
        ),
        peerScope: peer.scope,
        requestId: healthRequestId ?? null,
        routeId: route.routeId,
      });
      admissions.add(admission);
      return admission;
    },
    createRateLimitPlan(admission, context = {}) {
      if (!admissions.has(admission) || !plain(context)) {
        fail(M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID, 'admission-invalid');
      }
      const peer = admission.peerIdentityDigest;
      const buckets = [];
      if (admission.access === 'pairing_claim') {
        if (!exactKeys(context, ['claimCodeDigest']) || !SHA256.test(context.claimCodeDigest || '')) {
          fail(M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID, 'claim-digest-required');
        }
        buckets.push(
          rateBucket(key, 'pairing-global', 'pairing-claim', 'global', 30, 600),
          rateBucket(key, 'pairing-peer', 'pairing-claim', peer, 5, 600),
          rateBucket(
            key,
            'pairing-peer-claim',
            'pairing-claim',
            `${peer}\n${context.claimCodeDigest}`,
            5,
            600,
          ),
        );
      } else if (admission.access === 'signed_invocation') {
        if (!exactKeys(context, ['operationKind'])
          || !['mutation', 'read'].includes(context.operationKind)) {
          fail(M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID, 'operation-kind-required');
        }
        const mutation = context.operationKind === 'mutation';
        buckets.push(rateBucket(
          key,
          mutation ? 'invocation-mutation-peer' : 'invocation-read-peer',
          'invoke',
          peer,
          mutation ? 10 : 60,
          60,
        ));
      } else {
        if (!exactKeys(context, [])) {
          fail(M7_TRANSPORT_ADMISSION_ERROR.RATE_LIMIT_INPUT_INVALID, 'unexpected-context');
        }
        buckets.push(rateBucket(
          key,
          admission.access === 'public_health' ? 'health-peer' : 'session-control-peer',
          admission.access === 'public_health' ? 'remote-health' : 'session-control',
          peer,
          admission.access === 'public_health' ? 60 : 30,
          60,
        ));
      }
      const plan = deepFreeze({
        authority: 'DURABLE_RATE_LIMIT_CONSUMER_REQUIRED',
        buckets,
        routeId: admission.routeId,
      });
      rateLimitPlans.add(plan);
      return plan;
    },
  };
  deepFreeze(policy);
  policies.add(policy);
  return policy;
}

export function isGenuineM7TransportAdmissionPolicy(value) {
  return policies.has(value);
}

export function isGenuineM7TransportRateLimitPlan(value) {
  return rateLimitPlans.has(value);
}

export default createM7TransportAdmissionPolicy;
