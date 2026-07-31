// The legacy HTTP API and /c3/ws terminal do not have a complete remote
// authentication boundary. Keep their listener on an explicit loopback host;
// remote access belongs on a separate, scoped listener.

export const LEGACY_LISTENER_LOOPBACK_REQUIRED =
  'C3_LEGACY_LISTENER_LOOPBACK_REQUIRED';

const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'localhost',
]);

export const LEGACY_LISTENER_LOOPBACK_HOSTS = Object.freeze(
  [...LOOPBACK_HOSTS],
);

function normalizeHost(host) {
  return typeof host === 'string'
    ? host.trim().toLowerCase()
    : '';
}

export function isLegacyLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(normalizeHost(host));
}

export function requireLegacyLoopbackHost(host) {
  const normalizedHost = normalizeHost(host);
  if (LOOPBACK_HOSTS.has(normalizedHost)) {
    return normalizedHost;
  }

  const error = new Error(
    'Refusing to start the legacy IntentSmith listener outside loopback.',
  );
  error.code = LEGACY_LISTENER_LOOPBACK_REQUIRED;
  throw error;
}

/**
 * Validate and bind the same canonical host value. Keeping both operations in
 * one function prevents a future check/bind mismatch.
 */
export function listenOnLegacyLoopback(server, serverConfig, onListening) {
  if (!server || typeof server.listen !== 'function') {
    throw new TypeError('legacy listener requires a server.listen function');
  }
  if (!serverConfig || typeof serverConfig !== 'object') {
    throw new TypeError('legacy listener requires server configuration');
  }

  const bindHost = requireLegacyLoopbackHost(serverConfig.host);
  return server.listen(serverConfig.port, bindHost, onListening);
}
