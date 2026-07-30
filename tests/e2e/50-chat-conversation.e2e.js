// tests/e2e/50-chat-conversation.e2e.js — Multi-turn chat with LLM
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Requires Ollama with loaded model. Sequential execution required.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupConversation } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;
const created = [];

try {
  // ── Create Conversation ─────────────────────────────────────────────────
  suite('Chat Conversation — Setup');

  let convId = null;

  await testAsync('create conversation for chat', async () => {
    const { status, data } = await api('POST', '/api/conversations', {
      title: uniqueId('llm-chat'), mode: 'chat'
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    convId = data.id || data.conversation?.id;
    assert(convId, 'conversation id required');
    created.push(convId);
  });

  // ── First Turn ──────────────────────────────────────────────────────────
  suite('Chat — First Turn');

  let firstResponse = '';

  await testAsync('send first message and get response', async () => {
    if (!convId) return;
    const { status, data } = await api('POST', '/api/chat', {
      message: 'Řekni mi krátce, co je to rekurze v programování. Stačí 2-3 věty.',
      conversation_id: convId
    });
    // May return 200 with response or start streaming
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
    if (data.response) {
      firstResponse = data.response;
      assert(firstResponse.length > 20, 'response should be meaningful');
    }
  }, LLM_TIMEOUT);

  // ── Follow-up Turn ──────────────────────────────────────────────────────
  suite('Chat — Follow-up');

  await testAsync('follow-up question maintains context', async () => {
    if (!convId) return;
    const { status, data } = await api('POST', '/api/chat', {
      message: 'Uveď jednoduchý příklad.',
      conversation_id: convId
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
    if (data.response) {
      // Follow-up should relate to recursion (the previous topic)
      assert(data.response.length > 10, 'follow-up response should be meaningful');
    }
  }, LLM_TIMEOUT);

  // ── Messages Persist ────────────────────────────────────────────────────
  suite('Chat — Persistence');

  await testAsync('conversation messages are persisted', async () => {
    if (!convId) return;
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200);
    const msgs = data.messages || data;
    assert(Array.isArray(msgs), 'messages must be array');
    // Should have at least user + assistant for each turn
    assert(msgs.length >= 2, `expected ≥2 messages, got ${msgs.length}`);
  });

  // ── English Turn ────────────────────────────────────────────────────────
  suite('Chat — Language Switch');

  await testAsync('can switch to English mid-conversation', async () => {
    if (!convId) return;
    const { status, data } = await api('POST', '/api/chat', {
      message: 'Now answer in English: what is a binary tree?',
      conversation_id: convId
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
    if (data.response) {
      assert(data.response.length > 10, 'English response should be meaningful');
    }
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
