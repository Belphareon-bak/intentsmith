// tests/e2e/02-chat-api.e2e.js — Chat HTTP API validation & error paths
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── POST /chat Validation ────────────────────────────────────────────────────
suite('POST /chat — validation');

await testAsync('missing message returns 400', async () => {
  const { status } = await api('POST', '/chat', {});
  assertEqual(status, 400, `expected 400, got ${status}`);
});

await testAsync('empty string message returns 400', async () => {
  const { status } = await api('POST', '/chat', { message: '' });
  assertEqual(status, 400, `expected 400, got ${status}`);
});

await testAsync('null message returns 400', async () => {
  const { status } = await api('POST', '/chat', { message: null });
  assertEqual(status, 400, `expected 400, got ${status}`);
});

// ── POST /api/chat Validation ────────────────────────────────────────────────
suite('POST /api/chat — validation');

await testAsync('missing conversation_id returns 400', async () => {
  const { status } = await api('POST', '/api/chat', { message: 'test' });
  assert(status === 400 || status === 404, `expected 400/404, got ${status}`);
});

await testAsync('missing message returns 400', async () => {
  const { status } = await api('POST', '/api/chat', { conversation_id: 'nonexistent' });
  assert(status === 400 || status === 404, `expected 400/404, got ${status}`);
});

// ── Session Management ───────────────────────────────────────────────────────
suite('Chat Session Management');

await testAsync('GET /api/chat/sessions/stats returns shape', async () => {
  const { status, data } = await api('GET', '/api/chat/sessions/stats');
  assertEqual(status, 200);
  assert(typeof data.totalSessions === 'number', 'totalSessions required');
  assert(typeof data.maxSessions === 'number', 'maxSessions required');
});

await testAsync('GET /api/chat/sessions returns array', async () => {
  const { status, data } = await api('GET', '/api/chat/sessions');
  assertEqual(status, 200);
  assert(Array.isArray(data.sessions), 'sessions must be array');
});

await testAsync('GET /api/chat/sessions/:id with nonexistent returns 404', async () => {
  const { status } = await api('GET', '/api/chat/sessions/nonexistent-xyz');
  assertEqual(status, 404);
});

await testAsync('DELETE /api/chat/sessions/:id with nonexistent returns 404', async () => {
  const { status } = await api('DELETE', '/api/chat/sessions/nonexistent-xyz');
  assertEqual(status, 404);
});

// ── Specialist Assignment ────────────────────────────────────────────────────
suite('Chat Specialist Assignment');

await testAsync('POST /api/chat/specialist without specialistId returns 400', async () => {
  const { status } = await api('POST', '/api/chat/specialist', {});
  assert(status === 400 || status === 404, `expected 400/404, got ${status}`);
});

await testAsync('DELETE /api/chat/specialist returns 200', async () => {
  const { status } = await api('DELETE', '/api/chat/specialist');
  assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
