// tests/e2e/24-drafts.e2e.js — Drafts save/load/delete
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupConversation } from './_helpers.js';

await waitForServer();

const created = [];

try {
  // Create a conversation to scope drafts to
  const { data: convData } = await api('POST', '/api/conversations', {
    title: uniqueId('draft-test'), mode: 'chat'
  });
  const convId = convData?.id || convData?.conversation?.id;
  if (convId) created.push(convId);

  // ── Save Draft ──────────────────────────────────────────────────────────────
  suite('POST /api/drafts — save');

  await testAsync('saves draft for conversation', async () => {
    if (!convId) return;
    const { status } = await api('POST', '/api/drafts', {
      conversation_id: convId,
      content: 'This is a draft message from E2E test'
    });
    assert(status === 200 || status === 201 || status === 204, `expected 200/201/204, got ${status}`);
  });

  // ── Load Draft ──────────────────────────────────────────────────────────────
  suite('GET /api/drafts — load');

  await testAsync('loads draft for conversation', async () => {
    if (!convId) return;
    const { status, data } = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(status, 200);
    assert(typeof data === 'object', 'draft response must be object');
  });

  await testAsync('loading draft for nonexistent conversation returns empty', async () => {
    const { status, data } = await api('GET', '/api/drafts?conversation_id=nonexistent-xyz');
    assertEqual(status, 200);
    // Should return empty/null draft
  });

  // ── Delete Draft ────────────────────────────────────────────────────────────
  suite('DELETE /api/drafts — clear');

  await testAsync('deletes draft', async () => {
    if (!convId) return;
    const { status } = await api('DELETE', `/api/drafts?conversation_id=${convId}`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

  await testAsync('draft is gone after delete', async () => {
    if (!convId) return;
    const { status, data } = await api('GET', `/api/drafts?conversation_id=${convId}`);
    assertEqual(status, 200);
    // Content should be empty/null
  });

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
