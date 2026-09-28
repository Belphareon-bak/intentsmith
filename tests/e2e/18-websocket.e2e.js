// tests/e2e/18-websocket.e2e.js — WebSocket handshake, protocol, channels
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, waitForServer, createWsClient, WS_URL } from './_helpers.js';

await waitForServer();

async function firstRawMessage(sendOnOpen, timeoutMs = 3000) {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(WS_URL);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`raw websocket response timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    ws.once('open', () => sendOnOpen(ws));
    ws.once('message', raw => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (error) {
        reject(error);
      } finally {
        ws.close();
      }
    });
  });
}

// ── Handshake ───────────────────────────────────────────────────────────────
suite('WebSocket Handshake');

await testAsync('successful hello handshake', async () => {
  const client = await createWsClient();
  assert(client, 'client should be created');
  assert(typeof client.send === 'function', 'send method required');
  assert(typeof client.close === 'function', 'close method required');
  client.close();
});

await testAsync('wrong protocol version gets rejected or handled', async () => {
  const result = await firstRawMessage(ws => {
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 999 }));
  });
  assertEqual(result.type, 'hello_reject');
  assertEqual(result.requiredProtocol, 1);
  assert(typeof result.reason === 'string' && result.reason.length > 0, 'rejection reason required');
});

await testAsync('message before hello is ignored and a later valid hello succeeds', async () => {
  const result = await firstRawMessage(ws => {
    ws.send(JSON.stringify({ channel: 'control', data: { action: 'ping' } }));
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, features: [] }));
  });
  assertEqual(result.type, 'hello_ack');
  assertEqual(result.protocolVersion, 1);
  assert(Array.isArray(result.features), 'negotiated features must be array');
});

// ── Ping/Pong ───────────────────────────────────────────────────────────────
suite('WebSocket Ping/Pong');

await testAsync('control ping receives an exact pong acknowledgement', async () => {
  const client = await createWsClient();

  client.send({ channel: 'control', data: { action: 'ping' } });
  const pong = await client.waitForMessage(
    m => m.channel === 'control' && m.data?.action === 'pong',
    3000
  );
  assertEqual(pong.data.success, true);

  client.close();
});

// ── Concurrent Clients ──────────────────────────────────────────────────────
suite('WebSocket Concurrent Clients');

await testAsync('two clients can connect simultaneously', async () => {
  const [client1, client2] = await Promise.all([
    createWsClient(),
    createWsClient()
  ]);

  assert(client1, 'client1 connected');
  assert(client2, 'client2 connected');

  client1.close();
  client2.close();
});

// ── Invalid JSON ────────────────────────────────────────────────────────────
suite('WebSocket Error Handling');

await testAsync('invalid JSON and an unknown channel preserve the connection', async () => {
  const client = await createWsClient();
  client.ws.send('this is not json {{{');
  client.ws.send('');
  client.send({ channel: 'nonexistent', data: {} });
  client.send({ channel: 'control', data: { action: 'ping' } });
  const pong = await client.waitForMessage(
    m => m.channel === 'control' && m.data?.action === 'pong',
    3000,
  );
  assertEqual(pong.data.success, true);
  client.close();
});

await testAsync('binary frame handled gracefully', async () => {
  const client = await createWsClient();
  client.ws.send(Buffer.from([0x00, 0xFF, 0xFE, 0xFD]));
  client.send({ channel: 'control', data: { action: 'ping' } });
  const pong = await client.waitForMessage(
    m => m.channel === 'control' && m.data?.action === 'pong',
    3000,
  );
  assertEqual(pong.data.success, true);
  client.close();
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
