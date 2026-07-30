// tests/e2e/19-rate-limit.e2e.js — Rate limiting, body size, CORS, security headers
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, apiRaw, waitForServer, BASE_URL } from './_helpers.js';

await waitForServer();

// ── Security Headers ────────────────────────────────────────────────────────
suite('Security Headers');

await testAsync('X-Content-Type-Options: nosniff present', async () => {
  const res = await apiRaw('GET', '/api/health');
  const val = res.headers.get('x-content-type-options');
  assertEqual(val, 'nosniff');
});

await testAsync('X-Frame-Options: SAMEORIGIN present', async () => {
  const res = await apiRaw('GET', '/api/health');
  const val = res.headers.get('x-frame-options');
  assertEqual(val, 'SAMEORIGIN');
});

await testAsync('Content-Security-Policy present', async () => {
  const res = await apiRaw('GET', '/api/health');
  const csp = res.headers.get('content-security-policy');
  assert(csp, 'CSP header must be present');
  assert(csp.includes("default-src"), 'CSP must include default-src');
});

await testAsync('Referrer-Policy present', async () => {
  const res = await apiRaw('GET', '/api/health');
  const val = res.headers.get('referrer-policy');
  assertEqual(val, 'strict-origin-when-cross-origin');
});

// ── CORS ────────────────────────────────────────────────────────────────────
suite('CORS Headers');

await testAsync('default OPTIONS preflight denies an unconfigured cross-origin caller', async () => {
  const res = await fetch(`${BASE_URL}/api/health`, {
    method: 'OPTIONS',
    headers: { 'Origin': 'http://localhost:3000' }
  });
  assertEqual(res.status, 204);
  assertEqual(res.headers.get('access-control-allow-origin'), null);
  const methods = res.headers.get('access-control-allow-methods');
  assert(methods?.includes('GET'), 'preflight method metadata must include GET');
  assert(methods?.includes('POST'), 'preflight method metadata must include POST');
});

// ── Body Size ───────────────────────────────────────────────────────────────
suite('Body Size Limits (6 MB)');

await testAsync('normal body accepted (not 413)', async () => {
  const { status, data } = await api('POST', '/api/memory', {
    key: 'e2e-body-test',
    value: 'test body size',
  });
  assertEqual(status, 200);
  assertEqual(data.success, true);
});

await testAsync('under-limit body accepted', async () => {
  const small = 'y'.repeat(1000);
  const { status, data } = await api('POST', '/api/memory', {
    key: 'e2e-body-test',
    value: small,
  });
  assertEqual(status, 200);
  assertEqual(data.success, true);
});

await testAsync('over-limit body returns 413 without dropping the response', async () => {
  const oversized = 'z'.repeat(6 * 1024 * 1024);
  const { status, data } = await api('POST', '/api/memory', { oversized });
  assertEqual(status, 413);
  assert(typeof data.error === 'string' && data.error.includes('too large'), 'size error required');
});

// ── Content Type ────────────────────────────────────────────────────────────
suite('Content-Type Enforcement');

await testAsync('response Content-Type is application/json', async () => {
  const res = await apiRaw('GET', '/api/health');
  const ct = res.headers.get('content-type');
  assert(ct && ct.includes('application/json'), `expected JSON content-type, got ${ct}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
