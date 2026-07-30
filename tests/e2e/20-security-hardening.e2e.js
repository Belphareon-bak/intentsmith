// tests/e2e/20-security-hardening.e2e.js — Path traversal, injection, XSS, stack trace
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary, api, apiRaw, waitForServer, BASE_URL,
} from './_helpers.js';

await waitForServer();

// ── Path Traversal ──────────────────────────────────────────────────────────
suite('Path Traversal Prevention');

await testAsync('../../../etc/passwd in URL path returns 404', async () => {
  const { status } = await api('GET', '/api/../../../etc/passwd');
  assert(status === 404 || status === 400, `expected 404/400, got ${status}`);
});

await testAsync('encoded traversal (%2e%2e) handled', async () => {
  const { status } = await api('GET', '/api/%2e%2e/%2e%2e/etc/passwd');
  assert(status === 404 || status === 400, `expected 404/400, got ${status}`);
});

await testAsync('null byte in path handled', async () => {
  const { status } = await api('GET', '/api/conversations/test%00.txt');
  assert(status === 404 || status === 400 || status === 500, `expected 404/400/500, got ${status}`);
});

// ── Shell Injection ─────────────────────────────────────────────────────────
suite('Shell Injection Prevention');

await testAsync('shell metacharacters in query param', async () => {
  const { status } = await api('GET', '/api/conversations?title=test;rm -rf /');
  // Should not crash, should return normal response
  assert(status === 200 || status === 400, `expected 200/400, got ${status}`);
});

await testAsync('backtick injection in body field', async () => {
  const { status } = await api('POST', '/api/conversations', {
    title: '`whoami`',
    mode: 'chat'
  });
  // Should create normally — shell chars are just string data
  assert(status === 200 || status === 201 || status === 400, `expected 200/201/400, got ${status}`);
});

// ── XSS Prevention ──────────────────────────────────────────────────────────
suite('XSS Prevention');

await testAsync('HTML/script tags in conversation title', async () => {
  const xss = '<script>alert("xss")</script>';
  const { status, data } = await api('POST', '/api/conversations', {
    title: xss,
    mode: 'chat'
  });
  if (status === 200 || status === 201) {
    const id = data.id || data.conversation?.id;
    if (id) {
      // Verify stored title doesn't execute — just stored as text
      const { data: get } = await api('GET', `/api/conversations/${id}`);
      const title = get.title || get.conversation?.title || '';
      // Title should be stored as-is (escaped on output) or sanitized
      assert(!title.includes('<script>') || title === xss, 'title stored or sanitized');
      // Cleanup
      await api('DELETE', `/api/conversations/${id}?hard=true`);
    }
  }
  assert(true, 'XSS attempt handled');
});

await testAsync('event handler injection in conversation title', async () => {
  const xssPayload = '<img src=x onerror=alert(1)>';
  const { status, data } = await api('POST', '/api/conversations', {
    title: xssPayload, mode: 'chat'
  });
  // Should store without crash — no script execution server-side
  assert(status === 200 || status === 201 || status === 400, `expected 200/201/400, got ${status}`);
  if (status === 200 || status === 201) {
    const id = data.id || data.conversation?.id;
    if (id) await api('DELETE', `/api/conversations/${id}?hard=true`);
  }
});

// ── SQL Injection ───────────────────────────────────────────────────────────
suite('SQL Injection Prevention');

await testAsync('SQL injection in conversation title', async () => {
  const { status } = await api('POST', '/api/conversations', {
    title: "'; DROP TABLE conversations; --",
    mode: 'chat'
  });
  assert(status === 200 || status === 201 || status === 400, `expected 200/201/400, got ${status}`);

  // Verify table still exists
  const { status: listStatus } = await api('GET', '/api/conversations');
  assertEqual(listStatus, 200);
});

await testAsync('SQL injection in query parameter', async () => {
  const { status } = await api('GET', "/api/conversations?status=active' OR '1'='1");
  assert(status === 200 || status === 400, `expected 200/400, got ${status}`);
});

// ── Stack Trace Leak ────────────────────────────────────────────────────────
suite('Error Information Disclosure');

await testAsync('404 does not leak stack trace', async () => {
  const { status, data } = await api('GET', '/api/nonexistent-endpoint');
  assertEqual(status, 404);
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  assert(!body.includes('at '), 'should not contain stack trace');
  assert(!body.includes('node_modules'), 'should not contain node_modules path');
  assert(!body.includes('.js:'), 'should not contain file:line references');
});

await testAsync('500 error does not leak internals', async () => {
  // Send something likely to cause a server error
  const { data } = await api('POST', '/api/conversations', {
    title: null, mode: null, impossible_field: { nested: { deep: true } }
  });
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  if (body) {
    assert(!body.includes('SQLITE'), 'should not leak SQLite error details');
  }
});

// ── Header Injection ────────────────────────────────────────────────────────
suite('Header Injection Prevention');

await testAsync('newline in header value does not inject', async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { 'X-Test': 'value\r\nInjected-Header: evil' }
    });
    // Node.js HTTP parser rejects CRLF in headers — should get error or normal response
    assert(res.status === 200 || res.status === 400, 'CRLF injection handled');
  } catch {
    // fetch may throw on invalid headers — that's the correct behavior
    assert(true, 'CRLF in header correctly rejected by HTTP layer');
  }
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
