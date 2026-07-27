import { ProviderError } from './provider.js';

/**
 * Local-only endpoint policy.
 *
 * IntentSmith is local-first. Phase 2 permits exactly one shape of provider
 * endpoint: plain HTTP to a loopback address. Everything else is refused here,
 * before any socket is opened, so no configuration mistake and no hostile
 * config file can point the provider at a machine that is not this one.
 *
 * A future remote-LAN mode is deliberately out of scope and would need its own
 * ADR; this module is the single place that decision would be revisited.
 */

/** Hostnames that resolve to this machine and are safe to normalize. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** IPv4 loopback is the whole 127.0.0.0/8 block. */
const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

export type EndpointPolicyResult = {
  /** Normalized origin with no trailing slash, e.g. `http://127.0.0.1:11434`. */
  origin: string;
  hostname: string;
  port: number;
};

function reject(reason: string): never {
  throw new ProviderError('REQUEST_INVALID', `Endpoint rejected: ${reason}`);
}

function isLoopbackHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(lowered)) return true;
  const match = IPV4_LOOPBACK.exec(lowered);
  if (!match) return false;
  // Every octet must be a valid byte; `127.0.0.999` is not an address.
  return match.slice(1).every(octet => Number(octet) <= 255);
}

/**
 * Validates and normalizes a provider endpoint, or throws `REQUEST_INVALID`.
 *
 * Rejects non-HTTP protocols, userinfo, any non-loopback host (including
 * public addresses, private LAN ranges, arbitrary hostnames and ollama.com),
 * malformed ports, and any path, query or fragment.
 */
export function assertLocalEndpoint(rawEndpoint: string): EndpointPolicyResult {
  if (typeof rawEndpoint !== 'string' || rawEndpoint.trim().length === 0) {
    reject('endpoint must be a non-empty string');
  }
  const endpoint = rawEndpoint.trim();

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    reject(`"${endpoint}" is not a valid URL`);
  }

  // HTTPS is refused too: a loopback daemon needs no TLS, and allowing it
  // widens the surface for a proxy that terminates elsewhere.
  if (url.protocol !== 'http:') {
    reject(`protocol "${url.protocol}" is not permitted, only http: to loopback`);
  }
  if (url.username !== '' || url.password !== '') {
    reject('embedded credentials are not permitted');
  }
  if (!isLoopbackHost(url.hostname)) {
    reject(`host "${url.hostname}" is not a loopback address`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    reject('a path is not permitted on the endpoint');
  }
  if (url.search !== '' || url.hash !== '') {
    reject('query strings and fragments are not permitted on the endpoint');
  }

  const port = url.port === '' ? 80 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    reject(`port "${url.port}" is not a valid TCP port`);
  }

  // Normalize `localhost` and `::1` to an explicit loopback origin so every
  // later comparison and log line refers to the same literal address.
  const hostname = url.hostname.toLowerCase() === 'localhost' ? '127.0.0.1' : url.hostname.toLowerCase();
  const hostPart = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return { origin: `http://${hostPart}:${port}`, hostname, port };
}

/**
 * Header allowlist for provider requests.
 *
 * The process environment, cookies, `Authorization`, and `OLLAMA_API_KEY` are
 * never forwarded. Only these headers leave IntentSmith.
 */
export const ALLOWED_REQUEST_HEADERS = ['content-type', 'accept'] as const;

const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'ollama-api-key',
]);

/**
 * Filters a header bag down to the allowlist.
 *
 * Throws rather than silently dropping a credential header, so an attempt to
 * attach one is a loud configuration error instead of a quiet near-miss.
 */
export function buildRequestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  for (const [name, value] of Object.entries(extra)) {
    const lowered = name.toLowerCase();
    if (FORBIDDEN_HEADER_NAMES.has(lowered)) {
      reject(`header "${name}" may never be sent to a local provider`);
    }
    if (!(ALLOWED_REQUEST_HEADERS as readonly string[]).includes(lowered)) {
      reject(`header "${name}" is not in the provider header allowlist`);
    }
    headers[lowered] = value;
  }
  return headers;
}
