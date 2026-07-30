// tests/e2e/80-ws-semantic-events.e2e.js — WebSocket semantic events
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Validates per-session WS envelopes, ordering, cancellation, isolation,
// and recovery without routing chat through the HTTP compatibility endpoint.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  api,
  waitForServer,
  createWsClient,
  createConv,
  cleanupConversation,
} from './_helpers.js';

const WS_TIMEOUT = 30_000;
const CLOSE_TIMEOUT = 5_000;

await waitForServer();

function assertChannelEnvelope(message, channel) {
  assertEqual(
    Object.keys(message).sort().join(','),
    'channel,data',
    `${channel} message must use the exact channel/data envelope`,
  );
  assertEqual(message.channel, channel);
  assert(
    message.data !== null && typeof message.data === 'object' && !Array.isArray(message.data),
    `${channel} data must be an object`,
  );
}

function assertAgentEventEnvelope(message, turnId) {
  assertChannelEnvelope(message, 'agent');
  assertEqual(
    Object.keys(message.data).sort().join(','),
    'id,payload,seq,timestamp,turnId,type',
    'agent event must expose the complete semantic envelope',
  );
  assertEqual(message.data.turnId, turnId);
  assert(
    typeof message.data.id === 'string' && message.data.id.startsWith('evt-'),
    'agent event id must use the evt- prefix',
  );
  assert(Number.isInteger(message.data.seq) && message.data.seq > 0, 'agent seq must be positive');
  assert(
    Number.isFinite(Date.parse(message.data.timestamp)),
    'agent timestamp must be an ISO-compatible timestamp',
  );
  assert(
    message.data.payload !== null
      && typeof message.data.payload === 'object'
      && !Array.isArray(message.data.payload),
    'agent payload must be an object',
  );
}

function assertExactControl(message, action) {
  assertEqual(
    JSON.stringify(message),
    JSON.stringify({
      channel: 'control',
      data: { action, success: true },
    }),
    `control ${action} must use the exact acknowledgement envelope`,
  );
}

async function awaitControlBarrier(client, token) {
  client.send({
    channel: 'control',
    data: {
      action: 'rehydrate',
      conversationIds: [token],
    },
  });
  const acknowledgement = await client.waitForMessage(
    message => message.channel === 'control'
      && message.data?.action === 'rehydrate_ack'
      && Array.isArray(message.data?.validIds)
      && message.data.validIds.length === 1
      && message.data.validIds[0] === token,
    10_000,
  );
  assertEqual(
    JSON.stringify(acknowledgement),
    JSON.stringify({
      channel: 'control',
      data: {
        action: 'rehydrate_ack',
        validIds: [token],
      },
    }),
    `control barrier ${token} must return an exact correlated acknowledgement`,
  );
}

function assertTurnSequence(client, turnId) {
  const events = client.messages.filter(
    message => message.channel === 'agent' && message.data?.turnId === turnId,
  );
  assert(events.length >= 2, 'turn must emit at least turn_start and turn_end');
  assertEqual(events[0].data.type, 'turn_start');
  assertEqual(events.at(-1).data.type, 'turn_end');

  for (let index = 0; index < events.length; index++) {
    assertAgentEventEnvelope(events[index], turnId);
    assertEqual(
      events[index].data.seq,
      index + 1,
      'a fresh session must emit contiguous per-session agent sequence numbers',
    );
  }
}

async function createReadyClient() {
  const client = await createWsClient(10_000);
  try {
    const initialIdle = await client.waitForMessage(
      message => message.channel === 'status' && message.data?.agentStatus === 'idle',
      10_000,
    );
    assertChannelEnvelope(initialIdle, 'status');
    assertEqual(
      JSON.stringify(initialIdle.data),
      JSON.stringify({ agentStatus: 'idle' }),
      'new session must report an exact idle state',
    );
    client.messages.length = 0;
    return client;
  } catch (error) {
    await closeClient(client);
    throw error;
  }
}

async function closeClient(client) {
  if (!client || client.ws.readyState === 3) return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`WebSocket did not close within ${CLOSE_TIMEOUT}ms`)),
      CLOSE_TIMEOUT,
    );
    client.ws.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    client.close();
  });
  assertEqual(client.ws.readyState, 3, 'WebSocket cleanup must reach CLOSED');
}

async function cleanupConversationExactly(conversationId) {
  if (!conversationId) return;
  await cleanupConversation(conversationId);
  const result = await api('GET', `/api/conversations/${conversationId}`);
  assertEqual(result.status, 404, 'conversation fixture must be hard-deleted');
}

async function cleanupResources(clients, conversationId = null) {
  const errors = [];
  const closeResults = await Promise.allSettled(
    clients.filter(Boolean).map(client => closeClient(client)),
  );
  for (const result of closeResults) {
    if (result.status === 'rejected') errors.push(result.reason);
  }

  try {
    await cleanupConversationExactly(conversationId);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'WebSocket and conversation cleanup failed');
  }
}

suite('WS Semantic Events — Deterministic LOCAL Turn');

await testAsync('LOCAL arithmetic has exact correlated event semantics and returns idle', async () => {
  const input = 'Kolik je 15 * 17?';
  const conversationId = await createConv('E2E WS semantic LOCAL');
  let client;

  try {
    client = await createReadyClient();
    client.send({
      channel: 'chat',
      data: { content: input, conversationId },
    });

    const turnStart = await client.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'turn_start'
        && message.data?.payload?.input === input,
      WS_TIMEOUT,
    );
    const turnId = turnStart.data.turnId;
    assert(/^t-\d{3}$/.test(turnId), `unexpected turn id: ${turnId}`);
    assertEqual(
      JSON.stringify(turnStart.data.payload),
      JSON.stringify({ input }),
      'turn_start payload must contain only the submitted input',
    );

    const creDecision = await client.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'cre_decision'
        && message.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(creDecision.data.payload?.input, input);
    assert(
      typeof creDecision.data.payload?.intent === 'string',
      'cre_decision must carry a string intent',
    );
    assert(
      typeof creDecision.data.payload?.confidence === 'number',
      'cre_decision must carry numeric confidence',
    );

    const assistant = await client.waitForMessage(
      message => message.channel === 'chat'
        && message.data?.type === 'assistant'
        && message.data?.conversationId === conversationId
        && message.data?.metadata?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertChannelEnvelope(assistant, 'chat');
    assert(
      typeof assistant.data.content === 'string' && assistant.data.content.includes('255'),
      `LOCAL arithmetic must return 255, got: ${assistant.data.content}`,
    );
    assertEqual(assistant.data.metadata.conversationId, conversationId);

    const turnEnd = await client.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'turn_end'
        && message.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(turnEnd.data.payload?.status, 'ok');
    assert(
      Number.isInteger(turnEnd.data.payload?.durationMs)
        && turnEnd.data.payload.durationMs >= 0,
      'turn_end must carry a non-negative integer duration',
    );

    const turnEndIndex = client.messages.indexOf(turnEnd);
    const idle = await client.waitForMessage(
      message => client.messages.indexOf(message) > turnEndIndex
        && message.channel === 'status'
        && message.data?.agentStatus === 'idle',
      WS_TIMEOUT,
    );
    assertChannelEnvelope(idle, 'status');
    assertEqual(JSON.stringify(idle.data), JSON.stringify({ agentStatus: 'idle' }));

    assertTurnSequence(client, turnId);
    assert(
      client.messages.indexOf(turnStart) < client.messages.indexOf(creDecision),
      'turn_start must precede cre_decision',
    );
    assert(
      client.messages.indexOf(creDecision) < client.messages.indexOf(assistant),
      'cre_decision must precede assistant',
    );
    assert(
      client.messages.indexOf(assistant) < client.messages.indexOf(turnEnd),
      'assistant must precede turn_end',
    );
    assert(
      !client.messages.some(
        message => message.channel === 'agent'
          && message.data?.turnId === turnId
          && ['llm_start', 'llm_token', 'llm_done', 'tool_call'].includes(message.data?.type),
      ),
      'deterministic LOCAL arithmetic must not emit model or tool execution events',
    );
  } finally {
    await cleanupResources([client], conversationId);
  }
}, WS_TIMEOUT + 15_000);

suite('WS Semantic Events — Cancellation');

await testAsync('cancel acknowledges, terminates as cancelled_by_user, and emits no assistant', async () => {
  const input = 'Napiš podrobnou dlouhou esej o historii počítačů.';
  const conversationId = await createConv('E2E WS semantic cancel');
  let client;

  try {
    client = await createReadyClient();
    client.send({
      channel: 'chat',
      data: { content: input, conversationId },
    });
    client.send({
      channel: 'control',
      data: { action: 'cancel', conversationId },
    });

    const turnStart = await client.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'turn_start'
        && message.data?.payload?.input === input,
      WS_TIMEOUT,
    );
    const turnId = turnStart.data.turnId;

    const acknowledgement = await client.waitForMessage(
      message => message.channel === 'control'
        && message.data?.action === 'cancel',
      WS_TIMEOUT,
    );
    assertExactControl(acknowledgement, 'cancel');

    const turnEnd = await client.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'turn_end'
        && message.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(turnEnd.data.payload?.status, 'cancelled_by_user');

    const cancellationMessage = await client.waitForMessage(
      message => message.channel === 'chat'
        && message.data?.type === 'system'
        && message.data?.conversationId === conversationId,
      WS_TIMEOUT,
    );
    assertChannelEnvelope(cancellationMessage, 'chat');
    assertEqual(cancellationMessage.data.content, 'Zpracování zrušeno.');

    const turnEndIndex = client.messages.indexOf(turnEnd);
    await client.waitForMessage(
      message => client.messages.indexOf(message) > turnEndIndex
        && message.channel === 'status'
        && message.data?.agentStatus === 'idle',
      WS_TIMEOUT,
    );

    assertTurnSequence(client, turnId);
    assert(
      client.messages.indexOf(turnStart) < client.messages.indexOf(acknowledgement),
      'turn_start must precede cancel acknowledgement',
    );
    assert(
      client.messages.indexOf(acknowledgement) < client.messages.indexOf(turnEnd),
      'cancel acknowledgement must precede cancelled turn_end',
    );
    assert(
      client.messages.indexOf(turnEnd) < client.messages.indexOf(cancellationMessage),
      'cancelled turn_end must precede its system message',
    );
    assert(
      !client.messages.some(
        message => message.channel === 'chat'
          && message.data?.type === 'assistant'
          && message.data?.conversationId === conversationId,
      ),
      'cancelled turn must not emit any assistant response',
    );
  } finally {
    await cleanupResources([client], conversationId);
  }
}, WS_TIMEOUT + 15_000);

suite('WS Semantic Events — Per-Session Isolation');

await testAsync('a passive client receives none of another session turn', async () => {
  const input = 'Kolik je 11 + 12?';
  const conversationId = await createConv('E2E WS passive isolation');
  let activeClient;
  let passiveClient;

  try {
    activeClient = await createReadyClient();
    passiveClient = await createReadyClient();

    activeClient.send({
      channel: 'chat',
      data: { content: input, conversationId },
    });

    const turnStart = await activeClient.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'turn_start'
        && message.data?.payload?.input === input,
      WS_TIMEOUT,
    );
    const turnId = turnStart.data.turnId;
    const turnEnd = await activeClient.waitForMessage(
      message => message.channel === 'agent'
        && message.data?.type === 'turn_end'
        && message.data?.turnId === turnId,
      WS_TIMEOUT,
    );
    assertEqual(turnEnd.data.payload?.status, 'ok');

    const turnEndIndex = activeClient.messages.indexOf(turnEnd);
    await activeClient.waitForMessage(
      message => activeClient.messages.indexOf(message) > turnEndIndex
        && message.channel === 'status'
        && message.data?.agentStatus === 'idle',
      WS_TIMEOUT,
    );

    const activeBarrierBeforePassive = 'e2e80-active-before-passive';
    const passiveBarrier = 'e2e80-passive-after-active-turn';
    const activeBarrierAfterPassive = 'e2e80-active-after-passive';

    // A rehydrate acknowledgement echoes a unique token and is ordered after
    // earlier frames on that session. The final active barrier is sent only
    // after the passive barrier, so leaked passive traffic must precede it.
    activeClient.send({ channel: 'control', data: { action: 'ping' } });
    await awaitControlBarrier(activeClient, activeBarrierBeforePassive);
    passiveClient.send({ channel: 'control', data: { action: 'ping' } });
    await awaitControlBarrier(passiveClient, passiveBarrier);
    await awaitControlBarrier(activeClient, activeBarrierAfterPassive);

    const activeControl = activeClient.messages.filter(
      message => message.channel === 'control',
    );
    const passiveControl = passiveClient.messages.filter(
      message => message.channel === 'control',
    );
    assertEqual(
      JSON.stringify(activeControl),
      JSON.stringify([
        { channel: 'control', data: { action: 'pong', success: true } },
        {
          channel: 'control',
          data: {
            action: 'rehydrate_ack',
            validIds: [activeBarrierBeforePassive],
          },
        },
        {
          channel: 'control',
          data: {
            action: 'rehydrate_ack',
            validIds: [activeBarrierAfterPassive],
          },
        },
      ]),
      'active session must receive only its own pong and correlated barriers',
    );
    assertEqual(
      JSON.stringify(passiveControl),
      JSON.stringify([
        { channel: 'control', data: { action: 'pong', success: true } },
        {
          channel: 'control',
          data: {
            action: 'rehydrate_ack',
            validIds: [passiveBarrier],
          },
        },
      ]),
      'passive session must receive only its own pong and correlated barrier',
    );
    assertEqual(
      passiveClient.messages.filter(message => message.channel !== 'control').length,
      0,
      'passive session must receive no chat, agent, or status event from active session',
    );
  } finally {
    await cleanupResources([activeClient, passiveClient], conversationId);
  }
}, WS_TIMEOUT + 20_000);

suite('WS Semantic Events — Malformed Frame Recovery');

await testAsync('malformed raw frame is ignored and exact ping/pong still works', async () => {
  let client;
  try {
    client = await createReadyClient();
    client.ws.send('{"channel":"control","data":');
    client.send({ channel: 'control', data: { action: 'ping' } });

    const pong = await client.waitForMessage(
      message => message.channel === 'control' && message.data?.action === 'pong',
      10_000,
    );
    assertExactControl(pong, 'pong');
    assertEqual(client.messages.length, 1, 'malformed frame must not produce a response');
    assertEqual(client.ws.readyState, 1, 'socket must remain OPEN after malformed frame');
  } finally {
    await cleanupResources([client]);
  }
}, 20_000);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
