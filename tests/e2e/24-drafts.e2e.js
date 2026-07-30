// tests/e2e/24-drafts.e2e.js — Drafts save/load/delete
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assertEqual, summary, api, waitForServer,
  createConv, cleanupConversation,
} from './_helpers.js';

await waitForServer();

const created = [];

try {
  // Create a conversation to scope drafts to
  const convId = await createConv('draft-test');
  created.push(convId);
  const draftContent = 'This is a draft message from E2E test';

  // ── Save Draft ──────────────────────────────────────────────────────────────
  suite('POST /api/drafts — save');

  await testAsync('saves draft for conversation', async () => {
    const { status, data } = await api('POST', '/api/drafts', {
      conversation_id: convId,
      content: draftContent
    });
    assertEqual(status, 200);
    assertEqual(data.success, true);
  });

  // ── Load Draft ──────────────────────────────────────────────────────────────
  suite('GET /api/drafts — load');

  await testAsync('loads draft for conversation', async () => {
    const { status, data } = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(status, 200);
    assertEqual(data.draft.conversation_id, convId);
    assertEqual(data.draft.content, draftContent);
  });

  await testAsync('loading draft for nonexistent conversation returns empty', async () => {
    const { status, data } = await api('GET', '/api/drafts?conversation_id=nonexistent-xyz');
    assertEqual(status, 200);
    assertEqual(data.draft, null);
  });

  // ── Delete Draft ────────────────────────────────────────────────────────────
  suite('DELETE /api/drafts — clear');

  await testAsync('deletes draft', async () => {
    const { status, data } = await api('DELETE', '/api/drafts', {
      conversation_id: convId,
    });
    assertEqual(status, 200);
    assertEqual(data.success, true);
  });

  await testAsync('draft is gone after delete', async () => {
    const { status, data } = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(status, 200);
    assertEqual(data.draft, null);
  });

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
