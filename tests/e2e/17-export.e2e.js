// tests/e2e/17-export.e2e.js — Conversation export API
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary, api, apiRaw,
  waitForServer, uniqueId, cleanupConversation,
} from './_helpers.js';

await waitForServer();

const created = [];
let exportConversationId = null;
let emptyConversationId = null;
let markdownDownloadUrl = null;

try {
  // Create a conversation to export
  suite('Export Setup');

  await testAsync('create conversation for export', async () => {
    const { status, data } = await api('POST', '/api/conversations', {
      title: uniqueId('export-test'),
      mode: 'chat',
      welcomeMessage: 'Gate 0 deterministic export marker',
    });
    assertEqual(status, 201);
    exportConversationId = data.conversation?.id;
    assert(typeof exportConversationId === 'string', 'conversation id required');
    created.push(exportConversationId);
  });

  await testAsync('create empty conversation for error contract', async () => {
    const { status, data } = await api('POST', '/api/conversations', {
      title: uniqueId('empty-export-test'),
      mode: 'chat',
    });
    assertEqual(status, 201);
    emptyConversationId = data.conversation?.id;
    assert(typeof emptyConversationId === 'string', 'empty conversation id required');
    created.push(emptyConversationId);
  });

  // ── Export ──────────────────────────────────────────────────────────────────
  suite('POST /api/export');

  await testAsync('export without conversation_id returns 400', async () => {
    const { status } = await api('POST', '/api/export', {});
    assertEqual(status, 400);
  });

  await testAsync('export nonexistent conversation returns 404', async () => {
    const { status, data } = await api('POST', '/api/export', {
      conversation_id: 'nonexistent-conv-xyz',
      format: 'md'
    });
    assertEqual(status, 404);
    assert(data.error.includes('not found'), 'not-found error required');
  });

  await testAsync('export empty conversation returns 409', async () => {
    const { status, data } = await api('POST', '/api/export', {
      conversation_id: emptyConversationId,
      format: 'md',
    });
    assertEqual(status, 409);
    assert(data.error.includes('no messages'), 'no-messages error required');
  });

  await testAsync('export as markdown', async () => {
    const { status, data } = await api('POST', '/api/export', {
      conversation_id: exportConversationId,
      format: 'md'
    });
    assertEqual(status, 200);
    assertEqual(data.format, 'md');
    assertEqual(data.scope, 'conversation');
    assertEqual(data.turn_count, 1);
    assert(typeof data.size === 'number' && data.size > 0, 'export size required');
    assert(typeof data.filename === 'string' && data.filename.endsWith('.md'), 'markdown filename required');
    assertEqual(data.download_url, `/api/artifacts/${data.filename}`);
    markdownDownloadUrl = data.download_url;
  });

  await testAsync('download exported markdown from the same artifact root', async () => {
    const response = await apiRaw('GET', markdownDownloadUrl);
    assertEqual(response.status, 200);
    const content = await response.text();
    assert(content.includes('Gate 0 deterministic export marker'), 'exported marker required');
  });

  await testAsync('unsupported export format returns 400', async () => {
    const { status, data } = await api('POST', '/api/export', {
      conversation_id: exportConversationId,
      format: 'json'
    });
    assertEqual(status, 400);
    assert(data.error.includes('Unsupported export format'), 'unsupported-format error required');
  });

  // ── Logs Export ────────────────────────────────────────────────────────────
  suite('Logs Export');

  await testAsync('GET /api/logs returns log entries', async () => {
    const { status, data } = await api('GET', '/api/logs');
    assertEqual(status, 200);
    assert(Array.isArray(data.logs), 'logs must be array');
  });

  await testAsync('GET /api/logs/export returns log file', async () => {
    const response = await apiRaw('GET', '/api/logs/export');
    assertEqual(response.status, 200);
    assert(response.headers.get('content-type')?.startsWith('text/plain'), 'plain-text log export required');
  });

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
