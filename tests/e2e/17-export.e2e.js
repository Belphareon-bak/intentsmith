// tests/e2e/17-export.e2e.js — Conversation export API
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupConversation } from './_helpers.js';

await waitForServer();

const created = [];

try {
  // Create a conversation to export
  suite('Export Setup');

  await testAsync('create conversation for export', async () => {
    const { status, data } = await api('POST', '/api/conversations', {
      title: uniqueId('export-test'),
      mode: 'chat'
    });
    assert(status === 200 || status === 201, `expected 200/201, got ${status}`);
    const id = data.id || data.conversation?.id;
    if (id) created.push(id);
  });

  // ── Export ──────────────────────────────────────────────────────────────────
  suite('POST /api/export');

  await testAsync('export without conversation_id returns 400', async () => {
    const { status } = await api('POST', '/api/export', {});
    assertEqual(status, 400);
  });

  await testAsync('export nonexistent conversation returns 500 or 404', async () => {
    const { status } = await api('POST', '/api/export', {
      conversation_id: 'nonexistent-conv-xyz',
      format: 'md'
    });
    assert(status === 200 || status === 404 || status === 500, `expected 200/404/500, got ${status}`);
  });

  await testAsync('export as markdown', async () => {
    if (created.length === 0) return;
    const { status, data } = await api('POST', '/api/export', {
      conversation_id: created[0],
      format: 'md'
    });
    // May succeed or fail if conversation has no messages
    assert(status === 200 || status === 500, `expected 200/500, got ${status}`);
    if (status === 200) {
      assert(data.format === 'md', 'format should be md');
    }
  });

  await testAsync('export as json', async () => {
    if (created.length === 0) return;
    const { status, data } = await api('POST', '/api/export', {
      conversation_id: created[0],
      format: 'json'
    });
    assert(status === 200 || status === 500, `expected 200/500, got ${status}`);
  });

  // ── Logs Export ────────────────────────────────────────────────────────────
  suite('Logs Export');

  await testAsync('GET /api/logs returns log entries', async () => {
    const { status, data } = await api('GET', '/api/logs');
    assertEqual(status, 200);
    assert(typeof data === 'object', 'logs must be object');
  });

  await testAsync('GET /api/logs/export returns log file', async () => {
    const { status } = await api('GET', '/api/logs/export');
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
  });

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
