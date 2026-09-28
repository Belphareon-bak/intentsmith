// tests/e2e/20-security-hardening.e2e.js — Path traversal, injection, XSS, stack trace
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary, api, apiRaw, waitForServer, BASE_URL,
  cleanupConversation,
} from './_helpers.js';

await waitForServer();
const createdConversations = [];

// ── Path Traversal ──────────────────────────────────────────────────────────
suite('Path Traversal Prevention');

await testAsync('../../../etc/passwd in URL path returns 404', async () => {
  const { status } = await api('GET', '/api/../../../etc/passwd');
  assertEqual(status, 404);
});

await testAsync('encoded traversal (%2e%2e) handled', async () => {
  const { status } = await api('GET', '/api/%2e%2e/%2e%2e/etc/passwd');
  assertEqual(status, 404);
});

await testAsync('null byte in path handled', async () => {
  const { status } = await api('GET', '/api/conversations/test%00.txt');
  assertEqual(status, 404);
});

// ── Shell Injection ─────────────────────────────────────────────────────────
suite('Shell Injection Prevention');

await testAsync('shell metacharacters in query param', async () => {
  const { status } = await api('GET', '/api/conversations?title=test;rm -rf /');
  assertEqual(status, 200);
});

await testAsync('backtick injection in body field', async () => {
  const { status, data } = await api('POST', '/api/conversations', {
    title: '`whoami`',
    mode: 'chat'
  });
  assertEqual(status, 201);
  const id = data.conversation?.id;
  assert(typeof id === 'string', 'conversation id required');
  createdConversations.push(id);
  const stored = await api('GET', `/api/conversations/${id}`);
  assertEqual(stored.status, 200);
  assertEqual(stored.data.conversation.title, '`whoami`');
});

// ── XSS Prevention ──────────────────────────────────────────────────────────
suite('XSS Prevention');

await testAsync('HTML/script tags in conversation title', async () => {
  const xss = '<script>alert("xss")</script>';
  const { status, data } = await api('POST', '/api/conversations', {
    title: xss,
    mode: 'chat'
  });
  assertEqual(status, 201);
  const id = data.conversation?.id;
  assert(typeof id === 'string', 'conversation id required');
  createdConversations.push(id);
  const stored = await api('GET', `/api/conversations/${id}`);
  assertEqual(stored.status, 200);
  assertEqual(stored.data.conversation.title, xss);
});

await testAsync('event handler injection in conversation title', async () => {
  const xssPayload = '<img src=x onerror=alert(1)>';
  const { status, data } = await api('POST', '/api/conversations', {
    title: xssPayload, mode: 'chat'
  });
  assertEqual(status, 201);
  const id = data.conversation?.id;
  assert(typeof id === 'string', 'conversation id required');
  createdConversations.push(id);
  const stored = await api('GET', `/api/conversations/${id}`);
  assertEqual(stored.status, 200);
  assertEqual(stored.data.conversation.title, xssPayload);
});

// ── SQL Injection ───────────────────────────────────────────────────────────
suite('SQL Injection Prevention');

await testAsync('SQL injection in conversation title', async () => {
  const injection = "'; DROP TABLE conversations; --";
  const { status, data } = await api('POST', '/api/conversations', {
    title: injection,
    mode: 'chat'
  });
  assertEqual(status, 201);
  const id = data.conversation?.id;
  assert(typeof id === 'string', 'conversation id required');
  createdConversations.push(id);

  // Verify table still exists
  const { status: listStatus, data: listData } = await api('GET', '/api/conversations');
  assertEqual(listStatus, 200);
  assert(listData.conversations.some(conversation => (
    conversation.id === id && conversation.title === injection
  )), 'injection text must remain inert data');
});

await testAsync('SQL injection in query parameter', async () => {
  const { status } = await api('GET', "/api/conversations?status=active' OR '1'='1");
  assertEqual(status, 200);
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

await testAsync('invalid JSON error does not leak internals', async () => {
  const response = await apiRaw('POST', '/api/conversations', '{"title":');
  assertEqual(response.status, 400);
  const data = await response.json();
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  assert(!body.includes('SQLITE'), 'should not leak SQLite error details');
  assert(!body.includes('node_modules'), 'should not leak module paths');
  assert(!body.includes('.js:'), 'should not leak file:line references');
});

// ── Header Injection ────────────────────────────────────────────────────────
suite('Header Injection Prevention');

await testAsync('Node HTTP client rejects a newline in a header value', async () => {
  let rejected = false;
  try {
    await fetch(`${BASE_URL}/api/health`, {
      headers: { 'X-Test': 'value\r\nInjected-Header: evil' }
    });
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true);
});

for (const id of createdConversations) {
  await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
