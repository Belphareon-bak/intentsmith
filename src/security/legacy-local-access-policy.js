import { randomBytes, timingSafeEqual } from 'node:crypto';

export const LEGACY_LOCAL_ACCESS_REQUIRED =
  'C3_LEGACY_LOCAL_ACCESS_REQUIRED';
export const LEGACY_LOCAL_CAPABILITY_HEADER =
  'X-IntentSmith-Local-Capability';
export const LEGACY_LOCAL_WS_PROTOCOL = 'c3-v1';
export const LEGACY_LOCAL_WS_CAPABILITY_PREFIX = 'c3-local-v1.';

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCAL_AUTHORITY_HOSTS = new Set(['127.0.0.1', 'localhost']);
const LOOPBACK_PEERS = new Set([
  '127.0.0.1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
]);

function decision(allowed, reasonCode) {
  return Object.freeze({ allowed, reasonCode });
}

function normalizeHostname(hostname) {
  return String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
}

function parseLocalHttpOrigin(rawOrigin) {
  if (
    typeof rawOrigin !== 'string'
    || rawOrigin.length === 0
    || rawOrigin !== rawOrigin.trim()
  ) {
    return null;
  }

  const match = /^http:\/\/(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})\/?$/.exec(
    rawOrigin,
  );
  if (!match) {
    return null;
  }

  const hostname = normalizeHostname(match[1]);
  const port = Number(match[2]);
  if (
    !LOCAL_AUTHORITY_HOSTS.has(hostname)
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
  ) {
    return null;
  }

  return `http://${hostname}${port === 80 ? '' : `:${port}`}`;
}

function parseRuntimeLocalHttpOrigin(rawOrigin) {
  if (
    typeof rawOrigin !== 'string'
    || rawOrigin.length === 0
    || rawOrigin !== rawOrigin.trim()
  ) {
    return null;
  }
  const explicitlyConfigured = parseLocalHttpOrigin(rawOrigin);
  if (explicitlyConfigured) return explicitlyConfigured;
  const defaultPortMatch = /^http:\/\/(127\.0\.0\.1|localhost)$/.exec(
    rawOrigin,
  );
  return defaultPortMatch
    ? `http://${normalizeHostname(defaultPortMatch[1])}`
    : null;
}

function parseTargetOrigin(rawHost, expectedPort) {
  if (
    typeof rawHost !== 'string'
    || rawHost.length === 0
    || rawHost !== rawHost.trim()
    || rawHost.includes(',')
    || !Number.isInteger(expectedPort)
    || expectedPort < 1
    || expectedPort > 65535
  ) {
    return null;
  }

  const match = /^(127\.0\.0\.1|localhost)(?::([1-9][0-9]{0,4}))?$/i.exec(
    rawHost,
  );
  if (!match) {
    return null;
  }

  const hostname = normalizeHostname(match[1]);
  const port = match[2] === undefined ? 80 : Number(match[2]);
  if (
    !LOCAL_AUTHORITY_HOSTS.has(hostname)
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || port !== expectedPort
  ) {
    return null;
  }
  return `http://${hostname}${port === 80 ? '' : `:${port}`}`;
}

export function createLegacyLocalCapability() {
  return randomBytes(32).toString('base64url');
}

export function isValidLegacyLocalCapability(value) {
  return typeof value === 'string' && CAPABILITY_PATTERN.test(value);
}

export function normalizeLegacyLocalOrigins(origins) {
  if (!Array.isArray(origins)) {
    throw new TypeError('legacy local origins must be an array');
  }

  const normalized = [];
  const seen = new Set();
  for (const origin of origins) {
    const parsed = parseLocalHttpOrigin(origin);
    if (!parsed) {
      const error = new Error(
        `Legacy CORS origin must be an explicit local HTTP origin: ${String(origin)}`,
      );
      error.code = LEGACY_LOCAL_ACCESS_REQUIRED;
      throw error;
    }
    if (!seen.has(parsed)) {
      seen.add(parsed);
      normalized.push(parsed);
    }
  }
  return normalized;
}

export function parseLegacyLocalWebSocketCapability(rawProtocols) {
  if (rawProtocols === undefined || rawProtocols === null || rawProtocols === '') {
    return Object.freeze({ state: 'absent', token: null });
  }
  if (typeof rawProtocols !== 'string') {
    return Object.freeze({ state: 'ambiguous', token: null });
  }

  const matches = rawProtocols
    .split(',')
    .map(value => value.trim())
    .filter(value => value.startsWith('c3-local-v1'));
  if (matches.length === 0) {
    return Object.freeze({ state: 'absent', token: null });
  }
  if (matches.length !== 1 || !matches[0].startsWith(LEGACY_LOCAL_WS_CAPABILITY_PREFIX)) {
    return Object.freeze({ state: 'ambiguous', token: null });
  }
  const token = matches[0].slice(LEGACY_LOCAL_WS_CAPABILITY_PREFIX.length);
  return isValidLegacyLocalCapability(token)
    ? Object.freeze({ state: 'valid', token })
    : Object.freeze({ state: 'ambiguous', token: null });
}

export function extractLegacyLocalWebSocketCapability(rawProtocols) {
  const parsed = parseLegacyLocalWebSocketCapability(rawProtocols);
  return parsed.state === 'valid' ? parsed.token : null;
}

export function legacyLocalCapabilitiesEqual(expected, presented) {
  if (
    !isValidLegacyLocalCapability(expected)
    || !isValidLegacyLocalCapability(presented)
  ) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return expectedBytes.length === presentedBytes.length
    && timingSafeEqual(expectedBytes, presentedBytes);
}

/**
 * Shared authorization decision for the trusted-local HTTP and WebSocket
 * surfaces. It deliberately returns only a reason code and never exposes a
 * capability value.
 */
export function evaluateLegacyLocalAccess({
  host,
  expectedPort,
  remoteAddress,
  origin,
  allowedOrigins = [],
  expectedCapability,
  presentedCapability,
  fetchSite,
  preflight = false,
  requestedHeaders,
}) {
  if (!LOOPBACK_PEERS.has(normalizeHostname(remoteAddress))) {
    return decision(false, 'PEER_NOT_LOOPBACK');
  }

  const targetOrigin = parseTargetOrigin(host, expectedPort);
  if (!targetOrigin) {
    return decision(false, 'INVALID_TARGET_HOST');
  }

  if (!Array.isArray(allowedOrigins)) {
    return decision(false, 'INVALID_ALLOWED_ORIGIN');
  }
  const normalizedAllowedOrigins = [];
  for (const allowedOrigin of allowedOrigins) {
    const parsedAllowedOrigin = parseRuntimeLocalHttpOrigin(allowedOrigin);
    if (!parsedAllowedOrigin) {
      return decision(false, 'INVALID_ALLOWED_ORIGIN');
    }
    normalizedAllowedOrigins.push(parsedAllowedOrigin);
  }

  if (origin === undefined) {
    if (
      typeof fetchSite === 'string'
      && !['none', 'same-origin'].includes(fetchSite.toLowerCase())
    ) {
      return decision(false, 'CROSS_SITE_WITHOUT_ORIGIN');
    }
    return decision(true, 'NATIVE_LOOPBACK_CLIENT');
  }

  if (typeof origin !== 'string' || origin !== origin.trim()) {
    return decision(false, 'MALFORMED_ORIGIN');
  }

  if (origin === 'null' || origin.startsWith('file:')) {
    if (
      preflight
      && typeof requestedHeaders === 'string'
      && requestedHeaders
        .toLowerCase()
        .split(',')
        .map(value => value.trim())
        .includes(LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase())
    ) {
      return decision(true, 'OPAQUE_CAPABILITY_PREFLIGHT');
    }
    return legacyLocalCapabilitiesEqual(
      expectedCapability,
      presentedCapability,
    )
      ? decision(true, 'OPAQUE_CAPABILITY_CLIENT')
      : decision(false, 'OPAQUE_ORIGIN_REQUIRES_CAPABILITY');
  }

  const parsedOrigin = parseRuntimeLocalHttpOrigin(origin);
  if (!parsedOrigin) {
    return decision(false, 'FOREIGN_OR_MALFORMED_ORIGIN');
  }
  if (
    parsedOrigin === targetOrigin
    || normalizedAllowedOrigins.includes(parsedOrigin)
  ) {
    return decision(true, 'AUTHORIZED_LOCAL_ORIGIN');
  }
  return decision(false, 'LOCAL_ORIGIN_AUTHORITY_MISMATCH');
}
