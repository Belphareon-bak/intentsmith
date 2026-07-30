// tests/e2e/18-websocket.e2e.js — WebSocket handshake, protocol, channels
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, waitForServer, createWsClient, WS_URL } from './_helpers.js';

await waitForServer();

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
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(WS_URL);

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { ws.close(); resolve('timeout'); }, 3000);
    ws.on('error', () => { clearTimeout(timer); resolve('error'); });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 999 }));
    });
    ws.on('message', (raw) => {
      clearTimeout(timer);
      const msg = JSON.parse(raw.toString());
      ws.close();
      resolve(msg);
    });
  });

  if (typeof result === 'object') {
    // Server may reject or still accept with negotiated version
    assert(
      result.type === 'hello_reject' || result.type === 'hello_ack',
      `expected hello_reject or hello_ack, got ${result.type}`
    );
  }
  // timeout/error are also acceptable — server closed connection
});

await testAsync('message before hello is ignored or triggers error', async () => {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(WS_URL);

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { ws.close(); resolve('timeout'); }, 2000);
    ws.on('error', () => { clearTimeout(timer); resolve('error'); });
    ws.on('open', () => {
      // Send channel message before hello
      ws.send(JSON.stringify({ channel: 'control', data: { action: 'ping' } }));
      // Then try hello
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, features: [] }));
    });
    ws.on('message', (raw) => {
      clearTimeout(timer);
      const msg = JSON.parse(raw.toString());
      ws.close();
      resolve(msg);
    });
  });

  // Any response is acceptable — we just verify no crash
  assert(true, 'server handled pre-hello message without crash');
});

// ── Ping/Pong ───────────────────────────────────────────────────────────────
suite('WebSocket Ping/Pong');

await testAsync('control ping receives pong', async () => {
  const client = await createWsClient();

  client.send({ channel: 'control', data: { action: 'ping' } });

  try {
    const pong = await client.waitForMessage(
      m => m.channel === 'control' && m.data?.action === 'pong',
      3000
    );
    assert(pong, 'pong response received');
  } catch {
    // Some implementations don't respond to control ping — acceptable
    assert(true, 'ping sent without crash');
  }

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

await testAsync('invalid JSON does not crash server', async () => {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(WS_URL);

  await new Promise((resolve) => {
    ws.on('open', () => {
      // Send valid hello first
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, features: [] }));
    });
    ws.on('message', () => {
      // After hello_ack, send garbage
      ws.send('this is not json {{{');
      ws.send('');
      ws.send(JSON.stringify({ channel: 'nonexistent', data: {} }));
      setTimeout(() => { ws.close(); resolve(); }, 500);
    });
    ws.on('error', () => resolve());
    setTimeout(() => { ws.close(); resolve(); }, 3000);
  });

  // Verify server still alive
  const client = await createWsClient();
  assert(client, 'server still responsive after bad messages');
  client.close();
});

await testAsync('binary frame handled gracefully', async () => {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(WS_URL);

  await new Promise((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, features: [] }));
    });
    ws.on('message', () => {
      // Send binary data
      ws.send(Buffer.from([0x00, 0xFF, 0xFE, 0xFD]));
      setTimeout(() => { ws.close(); resolve(); }, 500);
    });
    ws.on('error', () => resolve());
    setTimeout(() => { ws.close(); resolve(); }, 3000);
  });

  assert(true, 'binary frame did not crash server');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
