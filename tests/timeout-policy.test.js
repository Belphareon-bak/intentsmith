// tests/timeout-policy.test.js — bounded runtime timeout policy
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  applyHttpTimeoutPolicy,
  HTTP_TIMEOUT_DEFAULTS,
  resolveHttpTimeoutPolicy,
  resolveRoleTimeouts,
} from '../src/timeout-policy.js';

suite('Timeout Policy — LLM roles');

test('defaults include bounded long-running CHAT and first CODE call', () => {
  const timeouts = resolveRoleTimeouts({});
  assertEqual(timeouts.CHAT, 600_000);
  assertEqual(timeouts.CODE, 120_000);
  assertEqual(timeouts.CODE_FIRST, 180_000);
  for (const timeoutMs of Object.values(timeouts)) {
    assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'every role timeout must be finite and positive');
  }
});

test('positive timeout scale is applied consistently', () => {
  const timeouts = resolveRoleTimeouts({ C3_TIMEOUT_SCALE: '0.5' });
  assertEqual(timeouts.CHAT, 300_000);
  assertEqual(timeouts.CODE_FIRST, 90_000);
});

test('invalid and non-positive scales cannot disable timeouts', () => {
  assertEqual(resolveRoleTimeouts({ C3_TIMEOUT_SCALE: 'invalid' }).CHAT, 600_000);
  assertEqual(resolveRoleTimeouts({ C3_TIMEOUT_SCALE: '0' }).CHAT, 600_000);
  assertEqual(resolveRoleTimeouts({ C3_TIMEOUT_SCALE: '-2' }).CHAT, 600_000);
});

test('extreme timeout scale is capped', () => {
  assertEqual(resolveRoleTimeouts({ C3_TIMEOUT_SCALE: '1000' }).CHAT, 6_000_000);
});

suite('Timeout Policy — HTTP server');

test('HTTP defaults remain finite', () => {
  const policy = resolveHttpTimeoutPolicy({});
  assertEqual(policy.requestTimeoutMs, HTTP_TIMEOUT_DEFAULTS.requestTimeoutMs);
  assertEqual(policy.headersTimeoutMs, HTTP_TIMEOUT_DEFAULTS.headersTimeoutMs);
  assertEqual(policy.keepAliveTimeoutMs, HTTP_TIMEOUT_DEFAULTS.keepAliveTimeoutMs);
});

test('zero and malformed HTTP values fall back instead of disabling protection', () => {
  const policy = resolveHttpTimeoutPolicy({
    C3_HTTP_REQUEST_TIMEOUT_MS: '0',
    C3_HTTP_HEADERS_TIMEOUT_MS: 'forever',
    C3_HTTP_KEEPALIVE_TIMEOUT_MS: '-1',
  });
  assertEqual(policy.requestTimeoutMs, HTTP_TIMEOUT_DEFAULTS.requestTimeoutMs);
  assertEqual(policy.headersTimeoutMs, HTTP_TIMEOUT_DEFAULTS.headersTimeoutMs);
  assertEqual(policy.keepAliveTimeoutMs, HTTP_TIMEOUT_DEFAULTS.keepAliveTimeoutMs);
});

test('HTTP overrides are bounded and headers cannot exceed request timeout', () => {
  const policy = resolveHttpTimeoutPolicy({
    C3_HTTP_REQUEST_TIMEOUT_MS: '30000',
    C3_HTTP_HEADERS_TIMEOUT_MS: '120000',
    C3_HTTP_KEEPALIVE_TIMEOUT_MS: '999999',
  });
  assertEqual(policy.requestTimeoutMs, 30_000);
  assertEqual(policy.headersTimeoutMs, 30_000);
  assertEqual(policy.keepAliveTimeoutMs, 60_000);
});

test('policy is applied to an HTTP-server-shaped object', () => {
  const server = {};
  const policy = {
    requestTimeoutMs: 45_000,
    headersTimeoutMs: 15_000,
    keepAliveTimeoutMs: 2_000,
  };
  const applied = applyHttpTimeoutPolicy(server, policy);
  assertEqual(applied, policy);
  assertEqual(server.requestTimeout, 45_000);
  assertEqual(server.headersTimeout, 15_000);
  assertEqual(server.keepAliveTimeout, 2_000);
});

summary();
