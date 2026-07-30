// tests/e2e/60-ws-chat.e2e.js — WebSocket chat events
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies the actual WS envelope, event order, cancel, and ping.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  waitForServer,
  api,
  createWsClient,
  createConv,
  cleanupConversation,
} from './_helpers.js';

await waitForServer();

const WS_TIMEOUT = 180000;

// ── WS Agent Events ────────────────────────────────────────────────────────
suite('WS Chat — Agent Events');

await testAsync('chat envelope emits correlated turn_start, assistant, turn_end, and idle', async () => {
  const conversationId = await createConv('E2E WS chat');
  let client;
  try {
    client = await createWsClient();
    client.send({
      channel: 'chat',
      data: {
        content: 'Kolik je 2+2?',
        conversationId,
      },
    });

    const turnStart = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'turn_start'
        && m.data?.payload?.input === 'Kolik je 2+2?',
      WS_TIMEOUT,
    );
    const turnId = turnStart.data.turnId;
    assert(typeof turnId === 'string' && turnId.length > 0, 'turn_start must carry turnId');

    const assistant = await client.waitForMessage(
      m => m.channel === 'chat'
        && m.data?.type === 'assistant'
        && m.data?.conversationId === conversationId
        && m.data?.metadata?.turnId === turnId,
      WS_TIMEOUT,
    );
    assert(
      typeof assistant.data.content === 'string' && assistant.data.content.trim().length > 0,
      'assistant content must be non-empty',
    );
    assert(
      /2\s*\+\s*2\s*=\s*4/.test(assistant.data.content),
      'deterministic arithmetic response must contain the exact 2+2=4 result',
    );
    assert(
      !/chyba zpracování|provider is temporarily unavailable|LLM failed/i.test(
        assistant.data.content,
      ),
      'deterministic success must not accept an error banner as assistant content',
    );

    const turnEnd = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'turn_end'
        && m.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(turnEnd.data.payload?.status, 'ok');

    const endIndex = client.messages.indexOf(turnEnd);
    const idle = await client.waitForMessage(
      m => client.messages.indexOf(m) > endIndex
        && m.channel === 'status'
        && m.data?.agentStatus === 'idle',
      WS_TIMEOUT,
    );
    assertEqual(idle.data.agentStatus, 'idle');

    const startIndex = client.messages.indexOf(turnStart);
    const assistantIndex = client.messages.indexOf(assistant);
    assert(startIndex < assistantIndex, 'turn_start must precede assistant response');
    assert(assistantIndex < endIndex, 'assistant response must precede turn_end');

    const seq = client.messages
      .filter(m => m.channel === 'agent' && m.data?.turnId === turnId)
      .map(m => m.data.seq);
    assert(seq.length >= 2, 'turn must emit at least start and end agent events');
    for (let i = 1; i < seq.length; i++) {
      assert(seq[i] > seq[i - 1], 'agent event sequence must be strictly increasing');
    }
  } finally {
    client?.close();
    await cleanupConversation(conversationId);
  }
}, WS_TIMEOUT);

// ── Provider Outage ─────────────────────────────────────────────────────────
suite('WS Chat — Provider Outage');

await testAsync('provider outage is terminal across HTTP and WS with no assistant persistence', async () => {
  const httpConversationId = await createConv('E2E provider outage HTTP');
  const wsConversationId = await createConv('E2E provider outage WS');
  let client;
  try {
    const expectedHttpBody = {
      error: 'Model provider is temporarily unavailable.',
      code: 'LLM_PROVIDER_UNAVAILABLE',
      recoverable: true,
    };
    const publicChat = await api('POST', '/chat', {
      message: 'Napiš podrobnou dlouhou esej o vývoji operačních systémů.',
    });
    assertEqual(publicChat.status, 503);
    assertEqual(JSON.stringify(publicChat.data), JSON.stringify(expectedHttpBody));

    const apiChat = await api('POST', '/api/chat', {
      conversation_id: httpConversationId,
      message: 'Napiš podrobnou dlouhou esej o vývoji databází.',
    });
    assertEqual(apiChat.status, 503);
    assertEqual(JSON.stringify(apiChat.data), JSON.stringify(expectedHttpBody));

    const httpMessages = await api(
      'GET',
      `/api/conversations/${httpConversationId}/messages`,
    );
    assertEqual(httpMessages.status, 200);
    assertEqual(
      JSON.stringify(httpMessages.data.messages.map(message => message.role)),
      JSON.stringify(['user']),
    );

    client = await createWsClient();
    const wsPrompt = 'Napiš podrobnou dlouhou esej o historii počítačových sítí.';
    client.send({
      channel: 'chat',
      data: {
        content: wsPrompt,
        conversationId: wsConversationId,
      },
    });

    const turnStart = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'turn_start'
        && m.data?.payload?.input === wsPrompt,
      WS_TIMEOUT,
    );
    const turnId = turnStart.data.turnId;

    const turnEnd = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'turn_end'
        && m.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(turnEnd.data.payload?.status, 'error');
    assertEqual(
      turnEnd.data.payload?.error,
      'Model provider is temporarily unavailable.',
    );

    const errorEvent = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'error'
        && m.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(errorEvent.data.payload?.code, 'LLM_PROVIDER_UNAVAILABLE');
    assertEqual(
      errorEvent.data.payload?.message,
      'Model provider is temporarily unavailable.',
    );
    assertEqual(errorEvent.data.payload?.recoverable, true);

    const systemMessage = await client.waitForMessage(
      m => m.channel === 'chat'
        && m.data?.type === 'system'
        && m.data?.conversationId === wsConversationId,
      WS_TIMEOUT,
    );
    assertEqual(
      systemMessage.data.content,
      'Model provider is temporarily unavailable.',
    );
    assert(
      !client.messages.some(
        m => m.channel === 'chat'
          && m.data?.type === 'assistant'
          && m.data?.metadata?.turnId === turnId,
      ),
      'provider failure must not emit an assistant response',
    );

    const wsMessages = await api(
      'GET',
      `/api/conversations/${wsConversationId}/messages`,
    );
    assertEqual(wsMessages.status, 200);
    assertEqual(
      JSON.stringify(wsMessages.data.messages.map(message => message.role)),
      JSON.stringify(['user']),
    );
  } finally {
    client?.close();
    await cleanupConversation(httpConversationId);
    await cleanupConversation(wsConversationId);
  }
}, WS_TIMEOUT);

// ── WS Cancel ───────────────────────────────────────────────────────────────
suite('WS Chat — Cancel');

await testAsync('cancel emits acknowledgement and a cancelled terminal event without assistant output', async () => {
  const conversationId = await createConv('E2E WS cancel');
  let client;
  try {
    client = await createWsClient();
    client.send({
      channel: 'chat',
      data: {
        content: 'Napiš podrobnou dlouhou esej o historii počítačů.',
        conversationId,
      },
    });
    // WebSocket frames are ordered. Sending cancel immediately after chat makes
    // the test independent of model speed while still exercising an active turn.
    client.send({
      channel: 'control',
      data: { action: 'cancel', conversationId },
    });

    const turnStart = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'turn_start'
        && m.data?.payload?.input === 'Napiš podrobnou dlouhou esej o historii počítačů.',
      WS_TIMEOUT,
    );
    const turnId = turnStart.data.turnId;

    const acknowledgement = await client.waitForMessage(
      m => m.channel === 'control'
        && m.data?.action === 'cancel',
      WS_TIMEOUT,
    );
    assertEqual(acknowledgement.data.success, true);

    const turnEnd = await client.waitForMessage(
      m => m.channel === 'agent'
        && m.data?.type === 'turn_end'
        && m.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(turnEnd.data.payload?.status, 'cancelled_by_user');

    const cancellationMessage = await client.waitForMessage(
      m => m.channel === 'chat'
        && m.data?.type === 'system'
        && m.data?.conversationId === conversationId,
      WS_TIMEOUT,
    );
    assert(
      typeof cancellationMessage.data.content === 'string'
        && cancellationMessage.data.content.trim().length > 0,
      'cancel must emit a non-empty system message',
    );

    const endIndex = client.messages.indexOf(turnEnd);
    const idle = await client.waitForMessage(
      m => client.messages.indexOf(m) > endIndex
        && m.channel === 'status'
        && m.data?.agentStatus === 'idle',
      WS_TIMEOUT,
    );
    assertEqual(idle.data.agentStatus, 'idle');
    assert(
      !client.messages.some(
        m => m.channel === 'chat'
          && m.data?.type === 'assistant'
          && m.data?.metadata?.turnId === turnId,
      ),
      'cancelled turn must not emit an assistant response',
    );
  } finally {
    client?.close();
    await cleanupConversation(conversationId);
  }
}, WS_TIMEOUT);

// ── WS Ping ─────────────────────────────────────────────────────────────────
suite('WS Chat — Ping');

await testAsync('ping returns an exact pong acknowledgement', async () => {
  const client = await createWsClient();
  try {
    client.send({ channel: 'control', data: { action: 'ping' } });
    const pong = await client.waitForMessage(
      m => m.channel === 'control' && m.data?.action === 'pong',
      10000,
    );
    assertEqual(pong.data.success, true);
  } finally {
    client.close();
  }
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
