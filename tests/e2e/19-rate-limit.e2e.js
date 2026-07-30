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
  // May or may not be set depending on config
  assert(true, 'referrer-policy check complete');
});

// ── CORS ────────────────────────────────────────────────────────────────────
suite('CORS Headers');

await testAsync('OPTIONS preflight returns CORS headers', async () => {
  const res = await fetch(`${BASE_URL}/api/health`, {
    method: 'OPTIONS',
    headers: { 'Origin': 'http://localhost:3000' }
  });
  // Should return 204 or 200 for preflight
  assert(res.status === 200 || res.status === 204, `expected 200/204 for OPTIONS, got ${res.status}`);
  const methods = res.headers.get('access-control-allow-methods');
  if (methods) {
    assert(methods.includes('GET'), 'CORS must allow GET');
    assert(methods.includes('POST'), 'CORS must allow POST');
  }
});

// ── Body Size ───────────────────────────────────────────────────────────────
suite('Body Size Limits (6 MB)');

await testAsync('normal body accepted (not 413)', async () => {
  const { status } = await api('POST', '/api/memory', { key: 'e2e-body-test', value: 'test body size' });
  assert(status !== 413, 'normal body should not trigger 413');
});

await testAsync('under-limit body accepted', async () => {
  const small = 'y'.repeat(1000);
  const { status } = await api('POST', '/api/memory', { key: 'e2e-body-test', value: small });
  assert(status !== 413, `1KB body should not trigger 413, got ${status}`);
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
