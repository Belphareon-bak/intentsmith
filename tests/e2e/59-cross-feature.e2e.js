// tests/e2e/59-cross-feature.e2e.js — Cross-feature integration
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Tests combinations of features working together.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupConversation } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;
const created = [];

try {
  // ── Expertise + Conversation ──────────────────────────────────────────────
  suite('Cross-Feature — Expertise + Conversation');

  await testAsync('chat in conversation with expertise context', async () => {
    // Create conversation
    const { data: convData } = await api('POST', '/api/conversations', {
      title: uniqueId('cross-feat'), mode: 'chat'
    });
    const convId = convData?.id || convData?.conversation?.id;
    if (convId) created.push(convId);

    // Get first expertise
    const { data: expData } = await api('GET', '/api/expertises');
    const expertiseId = expData.experts?.[0]?.id;

    // Chat with both conversation and expertise
    const body = { message: 'Porovnej REST a GraphQL.', conversation_id: convId };
    if (expertiseId) body.expertise_id = expertiseId;

    const { status } = await api('POST', '/api/chat', body);
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);
  }, LLM_TIMEOUT);

  // ── Draft + Conversation ──────────────────────────────────────────────────
  suite('Cross-Feature — Draft + Conversation');

  await testAsync('save and load draft within conversation context', async () => {
    if (created.length === 0) return;
    const convId = created[0];

    // Save draft
    const { status: saveStatus } = await api('POST', '/api/drafts', {
      conversation_id: convId,
      content: 'Cross-feature draft test'
    });
    assert(saveStatus === 200 || saveStatus === 201 || saveStatus === 204, 'draft saved');

    // Load draft
    const { status: loadStatus, data } = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(loadStatus, 200);

    // Clean up draft
    await api('DELETE', `/api/drafts?conversation_id=${convId}`);
  });

  // ── Memory + Chat ────────────────────────────────────────────────────────
  suite('Cross-Feature — Memory + Chat');

  await testAsync('memory persists across chat requests', async () => {
    // Save memory
    await api('POST', '/api/memory', { preference: 'concise answers' });

    // Chat
    const { status } = await api('POST', '/chat', {
      message: 'Co je to Docker?'
    });
    assert(status === 200 || status === 202, `expected 200/202, got ${status}`);

    // Verify memory still there
    const { data: memData } = await api('GET', '/api/memory');
    assert(memData.preference === 'concise answers', 'memory should persist');
  }, LLM_TIMEOUT);

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
