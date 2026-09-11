import { suite, testAsync, assert, assertEqual, summary, waitForServer,
  api, createConv, cleanupConversation } from './e2e/_helpers.js';

await waitForServer();
suite('Conversation web through the authenticated HTTP controller');
await testAsync('natural web search without a project proposes one visible request and accepts cancellation', async () => {
  const conversationId = await createConv('Natural web search approval');
  try {
    const chat = message => api('POST', '/api/chat', { message, conversation_id: conversationId });
    const proposal = await chat('Vyhledej na webu dokumentaci SQLite.');
    assertEqual(proposal.status, 200);
    assert(proposal.data.response.includes('https://www.bing.com/search?format=rss&q='), 'search names its exact provider target');
    const id = proposal.data.response.match(/web:[a-f0-9]{64}/)?.[0];
    assert(id, 'natural search requires an explicit per-request approval');
    const cancelled = await chat(`zrušit web ${id}`);
    assertEqual(cancelled.status, 200);
    assert(cancelled.data.response.includes('WEB_USER_REVOKED'), 'proposal can be cancelled without external I/O');
  } finally { await cleanupConversation(conversationId); }
});
await testAsync('a projectless request needs exact approval and a private IP is denied before network I/O', async () => {
  const conversationId = await createConv('Web approval without a project');
  try {
    const chat = message => api('POST', '/api/chat', { message, conversation_id: conversationId });
    const proposal = await chat('načti web https://127.0.0.1/');
    assertEqual(proposal.status, 200);
    const id = proposal.data.response.match(/web:[a-f0-9]{64}/)?.[0];
    assert(id, 'pending response must contain the full request ID');
    assert(proposal.data.response.includes('https://127.0.0.1/'), 'exact target is visible');
    const approval = await chat(`schválit web ${id}`);
    assertEqual(approval.status, 200);
    assert(approval.data.response.includes('WEB_ADDRESS_DENIED'), 'SSRF must fail in the actual consumer');
    const replay = await chat(`schválit web ${id}`);
    assertEqual(replay.status, 200);
    assert(replay.data.response.includes('WEB_ADDRESS_DENIED'), 'replay retains the failed result');
    const history = await api('GET', `/api/conversations/${conversationId}/messages`);
    assertEqual(history.status, 200);
    assert(JSON.stringify(history.data).includes('WEB_ADDRESS_DENIED'), 'failure is represented honestly in durable history');
  } finally { await cleanupConversation(conversationId); }
});
summary();
