// tests/e2e/03-conversations.e2e.js — Conversation CRUD lifecycle
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, assertIncludes, summary, api, waitForServer, uniqueId, cleanupConversation } from './_helpers.js';

await waitForServer();

const created = [];

try {
  // ── Create ───────────────────────────────────────────────────────────────
  suite('POST /api/conversations — create');

  await testAsync('creates conversation with title', async () => {
    const title = uniqueId('conv-test');
    const { status, data } = await api('POST', '/api/conversations', { title });
    assertEqual(status, 201, `expected 201, got ${status}`);
    assert(data.conversation, 'conversation object required');
    assert(data.conversation.id, 'id required');
    assertIncludes(data.conversation.id, 'conv-');
    created.push(data.conversation.id);
  });

  await testAsync('creates conversation without title (auto-generated)', async () => {
    const { status, data } = await api('POST', '/api/conversations', {});
    assertEqual(status, 201);
    assert(data.conversation.id, 'id required');
    created.push(data.conversation.id);
  });

  await testAsync('creates conversation with project_id', async () => {
    const { status, data } = await api('POST', '/api/conversations', { title: uniqueId('proj-conv'), project_id: null });
    assertEqual(status, 201);
    created.push(data.conversation.id);
  });

  // ── List ────────────────────────────────────────────────────────────────
  suite('GET /api/conversations — list');

  await testAsync('returns conversations array', async () => {
    const { status, data } = await api('GET', '/api/conversations');
    assertEqual(status, 200);
    assert(Array.isArray(data.conversations), 'conversations must be array');
    assert(data.conversations.length > 0, 'should have at least 1 conversation');
  });

  await testAsync('respects limit param', async () => {
    const { data } = await api('GET', '/api/conversations?limit=1');
    assert(data.conversations.length <= 1, 'should respect limit=1');
  });

  // ── Get Single ──────────────────────────────────────────────────────────
  suite('GET /api/conversations/:id');

  await testAsync('returns existing conversation', async () => {
    const id = created[0];
    const { status, data } = await api('GET', `/api/conversations/${id}`);
    assertEqual(status, 200);
    assert(data.id || data.conversation, 'conversation data required');
  });

  await testAsync('returns 404 for nonexistent', async () => {
    const { status } = await api('GET', '/api/conversations/conv-nonexistent-xyz');
    assertEqual(status, 404);
  });

  // ── Messages ────────────────────────────────────────────────────────────
  suite('GET /api/conversations/:id/messages');

  await testAsync('returns messages array for new conversation', async () => {
    const id = created[0];
    const { status, data } = await api('GET', `/api/conversations/${id}/messages`);
    assertEqual(status, 200);
    assert(Array.isArray(data.messages || data), 'messages must be array');
  });

  await testAsync('returns empty or 404 for nonexistent conversation messages', async () => {
    const { status, data } = await api('GET', '/api/conversations/conv-nonexistent-xyz/messages');
    // API may return 200 with empty array or 404
    if (status === 200) {
      const msgs = data.messages || data;
      assert(Array.isArray(msgs) && msgs.length === 0, 'should be empty array for nonexistent');
    } else {
      assertEqual(status, 404);
    }
  });

  // ── Update ──────────────────────────────────────────────────────────────
  suite('PUT /api/conversations/:id — update');

  await testAsync('updates title', async () => {
    const id = created[0];
    const newTitle = uniqueId('updated');
    const { status } = await api('PUT', `/api/conversations/${id}`, { title: newTitle });
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('returns 404 for nonexistent', async () => {
    const { status } = await api('PUT', '/api/conversations/conv-nonexistent-xyz', { title: 'x' });
    assertEqual(status, 404);
  });

  // ── Archive / Restore ──────────────────────────────────────────────────
  suite('Archive & Restore');

  await testAsync('archive conversation', async () => {
    const id = created[1];
    const { status } = await api('PATCH', `/api/conversations/${id}/archive`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('restore conversation', async () => {
    const id = created[1];
    const { status } = await api('PATCH', `/api/conversations/${id}/restore`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  // ── Delete ──────────────────────────────────────────────────────────────
  suite('DELETE /api/conversations/:id');

  await testAsync('soft-delete', async () => {
    const id = created[2];
    const { status } = await api('DELETE', `/api/conversations/${id}`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('hard-delete after soft-delete', async () => {
    const id = created[2];
    const { status } = await api('DELETE', `/api/conversations/${id}?hard=true`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('returns 404 for nonexistent delete', async () => {
    const { status } = await api('DELETE', '/api/conversations/conv-nonexistent-xyz');
    assertEqual(status, 404);
  });

} finally {
  // Cleanup
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
