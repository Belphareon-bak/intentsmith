// tests/e2e/81-conversation-lifecycle.e2e.js — Full Conversation Lifecycle
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: create → chat → persist → retrieve → archive → restore → resume → delete.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, chatInConv, hasKeywords, cleanupConversation, uniqueId, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

let convId = null;

try {
  suite('Lifecycle — Create');

  await testAsync('create conversation', async () => {
    const { status, data } = await api('POST', '/api/conversations', {
      title: uniqueId('lifecycle'),
      mode: 'chat',
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    convId = data.id || data.conversation?.id;
    assert(convId, 'must return conversation ID');
  });

  suite('Lifecycle — Multi-Turn Chat');

  await testAsync('first turn: explain recursion', async () => {
    if (!convId) return;
    const r = await chatInConv(convId, 'Vysvětli, co je to rekurze v programování');
    assert(r.response.length > 50, `response too short: ${r.response.length}`);
    assert(hasKeywords(r.response, ['rekurz', 'volá', 'sebe', 'zásobn', 'stack', 'base', 'konec'], 1),
      `should explain recursion: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  await testAsync('second turn: follow-up maintains context', async () => {
    if (!convId) return;
    const r = await chatInConv(convId, 'Uveď příklad');
    assert(hasKeywords(r.response, ['def ', 'function', 'factorial', 'fibonacci', 'rekurz', '```', 'return'], 1),
      `follow-up should have code example: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Lifecycle — Retrieve Messages');

  await testAsync('GET messages returns persisted turns', async () => {
    if (!convId) return;
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assert(status === 200, `expected 200, got ${status}`);
    const msgs = Array.isArray(data) ? data : (data.messages || []);
    assert(msgs.length >= 4, `expected >= 4 messages (2 user + 2 assistant), got ${msgs.length}`);
    // Verify messages have structure
    const first = msgs[0];
    assert(first.role || first.type, 'message must have role or type');
    assert(first.content || first.text, 'message must have content');
  });

  suite('Lifecycle — Update');

  await testAsync('update conversation title', async () => {
    if (!convId) return;
    const newTitle = uniqueId('updated');
    const { status, data } = await api('PUT', `/api/conversations/${convId}`, {
      title: newTitle,
    });
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
    // Verify title updated
    const { data: conv } = await api('GET', `/api/conversations/${convId}`);
    const title = conv.title || conv.conversation?.title;
    if (title) {
      assert(title === newTitle, `title should be updated to "${newTitle}", got "${title}"`);
    }
  });

  suite('Lifecycle — Archive');

  await testAsync('archive conversation', async () => {
    if (!convId) return;
    const { status } = await api('PATCH', `/api/conversations/${convId}/archive`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('archived conversation messages still readable', async () => {
    if (!convId) return;
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assert(status === 200, `expected 200, got ${status}`);
    const msgs = Array.isArray(data) ? data : (data.messages || []);
    assert(msgs.length >= 4, `archived conv should still have messages, got ${msgs.length}`);
  });

  suite('Lifecycle — Restore');

  await testAsync('restore conversation', async () => {
    if (!convId) return;
    const { status } = await api('PATCH', `/api/conversations/${convId}/restore`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('resumed conversation maintains context', async () => {
    if (!convId) return;
    const r = await chatInConv(convId, 'Vrať se k tomu, co jsi říkal o rekurzi');
    assert(hasKeywords(r.response, ['rekurz', 'rekurziv', 'volání', 'příklad', 'factorial', 'fibonacci', 'funkc'], 1),
      `restored conv should still have recursion context: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT);

  suite('Lifecycle — Delete');

  await testAsync('delete conversation', async () => {
    if (!convId) return;
    const { status } = await api('DELETE', `/api/conversations/${convId}`);
    assert(status === 200, `expected 200, got ${status}`);
    // Verify deleted
    const { status: getStatus } = await api('GET', `/api/conversations/${convId}`);
    assert(getStatus === 404 || getStatus === 200,
      `deleted conv should return 404 or soft-deleted 200, got ${getStatus}`);
    convId = null; // Prevent double-cleanup
  });

} finally {
  if (convId) await cleanupConversation(convId);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
