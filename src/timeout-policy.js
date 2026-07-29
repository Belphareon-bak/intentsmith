// Bounded runtime timeout policy
// ══════════════════════════════════════════════════════════════════════════════

export const ROLE_TIMEOUT_BASE_MS = Object.freeze({
  D1: 120_000,
  D2: 60_000,
  CODE: 120_000,
  CODE_FIRST: 180_000,
  R1: 120_000,
  R2: 45_000,
  CHAT: 600_000,
  VISION: 60_000,
});

export const HTTP_TIMEOUT_DEFAULTS = Object.freeze({
  requestTimeoutMs: 300_000,
  headersTimeoutMs: 60_000,
  keepAliveTimeoutMs: 5_000,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boundedInteger(rawValue, fallback, min, max) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return fallback;
  return clamp(parsed, min, max);
}

/**
 * Resolve finite per-role LLM timeouts. Scale remains useful for deterministic
 * test environments, but invalid, non-positive, or extreme values cannot turn
 * timeouts off or create effectively unbounded waits.
 */
export function resolveRoleTimeouts(env = process.env) {
  const parsedScale = Number(env.C3_TIMEOUT_SCALE);
  const scale = Number.isFinite(parsedScale) && parsedScale > 0
    ? clamp(parsedScale, 0.001, 10)
    : 1;

  return Object.fromEntries(
    Object.entries(ROLE_TIMEOUT_BASE_MS).map(([role, timeoutMs]) => [
      role,
      Math.max(1, Math.round(timeoutMs * scale)),
    ]),
  );
}

/**
 * HTTP requestTimeout limits receipt of a request body; it does not limit how
 * long an LLM response may take to generate. Keep this protection finite.
 */
export function resolveHttpTimeoutPolicy(env = process.env) {
  const requestTimeoutMs = boundedInteger(
    env.C3_HTTP_REQUEST_TIMEOUT_MS,
    HTTP_TIMEOUT_DEFAULTS.requestTimeoutMs,
    30_000,
    900_000,
  );
  const headersTimeoutMs = boundedInteger(
    env.C3_HTTP_HEADERS_TIMEOUT_MS,
    HTTP_TIMEOUT_DEFAULTS.headersTimeoutMs,
    5_000,
    Math.min(120_000, requestTimeoutMs),
  );
  const keepAliveTimeoutMs = boundedInteger(
    env.C3_HTTP_KEEPALIVE_TIMEOUT_MS,
    HTTP_TIMEOUT_DEFAULTS.keepAliveTimeoutMs,
    1_000,
    60_000,
  );

  return { requestTimeoutMs, headersTimeoutMs, keepAliveTimeoutMs };
}

export function applyHttpTimeoutPolicy(server, policy) {
  if (!server || typeof server !== 'object') {
    throw new TypeError('HTTP server instance is required');
  }
  const resolved = policy || resolveHttpTimeoutPolicy();
  server.requestTimeout = resolved.requestTimeoutMs;
  server.headersTimeout = resolved.headersTimeoutMs;
  server.keepAliveTimeout = resolved.keepAliveTimeoutMs;
  return resolved;
}

export default {
  ROLE_TIMEOUT_BASE_MS,
  HTTP_TIMEOUT_DEFAULTS,
  resolveRoleTimeouts,
  resolveHttpTimeoutPolicy,
  applyHttpTimeoutPolicy,
};
