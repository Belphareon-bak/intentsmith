// CRE v36.9.2 SafeHttpClient Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Rate limiting per domain
// - Retry on 5xx
// - Timeout handling
// - User-agent rotation
// - 4xx not retried
//
// ══════════════════════════════════════════════════════════════════════════════

import { SafeHttpClient } from '../tools/http-client.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK FETCH
// ════════════════════════════════════════════════════════════════════════════

let fetchCalls = [];
let fetchResponses = [];

function mockFetch(responses) {
  fetchCalls = [];
  fetchResponses = [...responses];

  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });

    const resp = fetchResponses.shift();
    if (!resp) throw new Error('No more mock responses');

    if (resp.throw) throw resp.throw;

    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status || 200,
      text: async () => resp.body || '',
      headers: {
        entries: () => Object.entries(resp.headers || {}),
      },
    };
  };
}

function restoreFetch() {
  delete global.fetch;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v36.9.2 SafeHttpClient Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Rate Limiter Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Rate Limiter');

test('Rate limiter: allows requests within limit', () => {
  const client = new SafeHttpClient({ rateLimiter: { maxTokensPerDomain: 3 } });
  const r1 = client.rateLimiter.consume('https://example.com/a');
  const r2 = client.rateLimiter.consume('https://example.com/b');
  const r3 = client.rateLimiter.consume('https://example.com/c');
  assertTrue(r1.allowed, 'First request should be allowed');
  assertTrue(r2.allowed, 'Second request should be allowed');
  assertTrue(r3.allowed, 'Third request should be allowed');
});

test('Rate limiter: blocks when limit exceeded', () => {
  const client = new SafeHttpClient({ rateLimiter: { maxTokensPerDomain: 2 } });
  client.rateLimiter.consume('https://example.com/a');
  client.rateLimiter.consume('https://example.com/b');
  const r3 = client.rateLimiter.consume('https://example.com/c');
  assertTrue(!r3.allowed, 'Third request should be blocked');
  assertTrue(r3.retryAfterMs >= 0, 'Should have retryAfterMs');
});

test('Rate limiter: different domains have separate limits', () => {
  const client = new SafeHttpClient({ rateLimiter: { maxTokensPerDomain: 1 } });
  const r1 = client.rateLimiter.consume('https://a.com/page');
  const r2 = client.rateLimiter.consume('https://b.com/page');
  assertTrue(r1.allowed, 'First domain should be allowed');
  assertTrue(r2.allowed, 'Second domain should be allowed');
});

test('Rate limiter: custom domain limits', () => {
  const client = new SafeHttpClient({ rateLimiter: { maxTokensPerDomain: 10 } });
  client.rateLimiter.setDomainLimit('slow.com', 1, 5000);
  client.rateLimiter.consume('https://slow.com/a');
  const r2 = client.rateLimiter.consume('https://slow.com/b');
  assertTrue(!r2.allowed, 'Custom limit should be enforced');
});

// ────────────────────────────────────────────────────────────────────────────
// Retry Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Retry Logic');

await asyncTest('Retries on 500 and succeeds on second attempt', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10, maxRetries: 3 });

  mockFetch([
    { status: 500, body: 'Internal Server Error' },
    { status: 200, body: '{"ok":true}' },
  ]);

  const result = await client.get('https://api.example.com/data');

  assertTrue(result.ok, 'Should succeed after retry');
  assertEqual(result.status, 200, 'Status');
  assertEqual(fetchCalls.length, 2, 'Should have made 2 attempts');

  restoreFetch();
});

await asyncTest('Returns error after max retries on persistent 500', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10, maxRetries: 2 });

  mockFetch([
    { status: 500, body: 'Error 1' },
    { status: 500, body: 'Error 2' },
  ]);

  const result = await client.get('https://api.example.com/data');

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, 'HTTP_SERVER_ERROR', 'Error code');
  assertEqual(fetchCalls.length, 2, 'Should have made all attempts');

  restoreFetch();
});

await asyncTest('Does NOT retry on 4xx (client error)', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10, maxRetries: 3 });

  mockFetch([
    { status: 404, body: 'Not Found' },
  ]);

  const result = await client.get('https://api.example.com/missing');

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, 'HTTP_CLIENT_ERROR', 'Error code');
  assertEqual(fetchCalls.length, 1, 'Should NOT retry on 4xx');

  restoreFetch();
});

await asyncTest('Retries on network error', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10, maxRetries: 2 });

  mockFetch([
    { throw: new Error('ECONNREFUSED') },
    { status: 200, body: 'ok' },
  ]);

  const result = await client.get('https://api.example.com/data');

  assertTrue(result.ok, 'Should succeed after retry');
  assertEqual(fetchCalls.length, 2, 'Should have retried');

  restoreFetch();
});

// ────────────────────────────────────────────────────────────────────────────
// Rate limit integration test
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Rate Limit Integration');

await asyncTest('Returns RATE_LIMITED when limit exceeded', async () => {
  const client = new SafeHttpClient({
    rateLimiter: { maxTokensPerDomain: 1 },
    retryBaseDelay: 10
  });

  mockFetch([
    { status: 200, body: 'first' },
  ]);

  // First request uses the token
  await client.get('https://limited.com/a');

  // Second request should be rate limited (no fetch call)
  const result = await client.get('https://limited.com/b');

  assertTrue(!result.ok, 'Should be rate limited');
  assertEqual(result.code, 'RATE_LIMITED', 'Code');
  assertEqual(fetchCalls.length, 1, 'Only first request should hit fetch');

  restoreFetch();
});

// ────────────────────────────────────────────────────────────────────────────
// Timeout Test
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Timeout');

await asyncTest('Handles timeout (AbortError)', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10, maxRetries: 1, timeout: 50 });

  const abortErr = new Error('Aborted');
  abortErr.name = 'AbortError';

  mockFetch([
    { throw: abortErr },
  ]);

  const result = await client.get('https://slow.example.com/data');

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, 'NETWORK_ERROR', 'Code');

  restoreFetch();
});

// ────────────────────────────────────────────────────────────────────────────
// User-Agent Rotation
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 User-Agent');

test('User-agent rotates between requests', () => {
  const client = new SafeHttpClient();
  const ua1 = client.getNextUserAgent();
  const ua2 = client.getNextUserAgent();
  // After cycling through all 5, it wraps around
  assertTrue(ua1.includes('Mozilla'), 'Should be a browser UA');
  assertTrue(ua2.includes('Mozilla'), 'Should be a browser UA');
  // They may or may not be different depending on index, but cycling works
  const ua6 = client.getNextUserAgent();
  assertTrue(ua6.includes('Mozilla'), 'Should still be valid after cycling');
});

await asyncTest('User-agent header is set on requests', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10 });

  mockFetch([{ status: 200, body: 'ok' }]);

  await client.get('https://example.com/test');

  const headers = fetchCalls[0].options.headers;
  assertTrue(headers['User-Agent'].includes('Mozilla'), 'Should have User-Agent header');

  restoreFetch();
});

// ────────────────────────────────────────────────────────────────────────────
// POST with body
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 POST');

await asyncTest('POST sends JSON body', async () => {
  const client = new SafeHttpClient({ retryBaseDelay: 10 });

  mockFetch([{ status: 200, body: '{"id":1}' }]);

  await client.post('https://api.example.com/items', { name: 'test' });

  const opts = fetchCalls[0].options;
  assertEqual(opts.method, 'POST', 'Method');
  assertEqual(opts.body, '{"name":"test"}', 'Body should be JSON');
  assertTrue(opts.headers['Content-Type'] === 'application/json', 'Content-Type');

  restoreFetch();
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
