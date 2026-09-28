// tests/e2e/59-cross-feature.e2e.js — Cross-feature integration
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Tests combinations of features working together.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary, api, waitForServer,
  createConv, chatWithTimeout, cleanupConversation,
} from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;
const created = [];
let originalMemory;

try {
  // ── Expertise + Conversation ──────────────────────────────────────────────
  suite('Cross-Feature — Expertise + Conversation');

  await testAsync('chat in conversation with expertise context', async (signal) => {
    const convId = await createConv('cross-feature');
    created.push(convId);

    const expertiseList = await api('GET', '/api/expertises');
    assertEqual(expertiseList.status, 200);
    const developer = expertiseList.data.experts.find(item => item.id === 'developer');
    assert(developer, 'canonical developer expertise required');

    const { status, data } = await api('POST', '/api/chat', {
      message: 'Porovnej REST a GraphQL.',
      conversation_id: convId,
      expertise_id: developer.id,
    }, signal);
    assertEqual(status, 200);
    assert(typeof data.response === 'string' && data.response.trim().length > 0, 'expert response required');
    assertEqual(data.mode, 'expert');

    const session = await api('GET', `/api/chat/sessions/${convId}`);
    assertEqual(session.status, 200);
    assertEqual(session.data.state.expertise.id, developer.id);
  }, LLM_TIMEOUT);

  // ── Draft + Conversation ──────────────────────────────────────────────────
  suite('Cross-Feature — Draft + Conversation');

  await testAsync('save and load draft within conversation context', async () => {
    const convId = created[0];
    const content = 'Cross-feature draft test';

    const saved = await api('POST', '/api/drafts', {
      conversation_id: convId,
      content,
    });
    assertEqual(saved.status, 200);
    assertEqual(saved.data.success, true);

    const loaded = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(loaded.status, 200);
    assertEqual(loaded.data.draft.content, content);

    const deleted = await api('DELETE', '/api/drafts', { conversation_id: convId });
    assertEqual(deleted.status, 200);
    const empty = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(empty.status, 200);
    assertEqual(empty.data.draft, null);
  });

  // ── Memory + Chat ────────────────────────────────────────────────────────
  suite('Cross-Feature — Memory + Chat');

  await testAsync('memory persists across chat requests', async () => {
    const snapshot = await api('GET', '/api/memory');
    assertEqual(snapshot.status, 200);
    originalMemory = snapshot.data;

    const stored = await api('POST', '/api/memory', {
      preference: 'concise answers',
    });
    assertEqual(stored.status, 200);
    assertEqual(stored.data.success, true);

    const convId = await createConv('memory-chat');
    created.push(convId);
    await chatWithTimeout(convId, 'Co je to Docker?', LLM_TIMEOUT);

    const memory = await api('GET', '/api/memory');
    assertEqual(memory.status, 200);
    assertEqual(memory.data.preference, 'concise answers');
  }, LLM_TIMEOUT);

} finally {
  if (originalMemory !== undefined) {
    await api('POST', '/api/memory', originalMemory);
  }
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
