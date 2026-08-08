#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { suite, test, testAsync, summary } from './harness.js';

const WS_CLIENT = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js',
  import.meta.url,
);
const CHAT_PANEL = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
  import.meta.url,
);

function loadClient(sessions, options = {}) {
  const busEvents = [];
  const sockets = [];

  class FakeWebSocket {
    constructor(url, protocols) {
      if (typeof options.beforeWebSocketConstruct === 'function') {
        options.beforeWebSocketConstruct();
      }
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }

    send(encoded) {
      this.sent.push(JSON.parse(encoded));
    }

    close() {
      if (options.deferClose === true) {
        this.readyState = 2;
        return;
      }
      this.finishClose();
    }

    finishClose() {
      this.readyState = 3;
      if (typeof this.onclose === 'function') this.onclose();
    }
  }

  const context = vm.createContext({
    AbortSignal,
    C3Bus: {
      emit(name, payload) {
        busEvents.push({ name, payload });
      },
    },
    Date,
    JSON,
    Math,
    WebSocket: FakeWebSocket,
    _backendBase: 'http://127.0.0.1:3335',
    _sessionActive: 0,
    _sessions: sessions,
    clearInterval() {},
    clearTimeout: options.clearTimeout || (() => {}),
    console: options.console || console,
    crypto: {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    },
    fetch: options.fetch || (async () => ({
      ok: true,
      json: async () => ({ messages: [] }),
    })),
    fetchBackendData() {},
    module: { exports: {} },
    setInterval: () => Symbol('interval'),
    setTimeout: options.setTimeout || (() => Symbol('timeout')),
    window: {
      electronC3: {
        getBackendUrl: () => 'http://127.0.0.1:3335',
        getLocalCapability: () => 'A'.repeat(43),
      },
    },
  });
  context.window.window = context.window;

  vm.runInContext(fs.readFileSync(WS_CLIENT, 'utf8'), context, {
    filename: WS_CLIENT.pathname,
  });
  const client = context.module.exports;
  function handshake(socket) {
    socket.readyState = 1;
    socket.onopen();
    socket.onmessage({
      data: JSON.stringify({
        type: 'hello_ack',
        serverVersion: 'test',
        features: [],
      }),
    });
  }

  client.wsConnect();
  const socket = sockets[0];
  if (options.autoHandshake !== false) handshake(socket);
  return { busEvents, client, context, handshake, socket, sockets };
}

async function drainMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index++) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function sendServerMessage(socket, message) {
  socket.onmessage({ data: JSON.stringify(message) });
}

function controlledTimers() {
  const timers = [];
  return {
    timers,
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    setTimeout(callback, delay) {
      const timer = { callback, cleared: false, delay, ran: false };
      timers.push(timer);
      return timer;
    },
    active() {
      return timers.filter(timer => !timer.cleared && !timer.ran);
    },
    run(timer) {
      assert.ok(timer && !timer.cleared && !timer.ran, 'timer is not runnable');
      timer.ran = true;
      timer.callback();
    },
  };
}

/* Retained below as an explicit shape helper for each Studio pane. */
function session(conversationId = null) {
  return {
    _agentId: conversationId ? `agent-${conversationId}` : null,
    _convId: conversationId,
    _label: conversationId ? `Label ${conversationId}` : '',
    _projectId: null,
    chat: {
      editMode: 'ask',
      msgs: [{ role: 'system', text: 'stale' }],
      _pendingAttachments: null,
      _thinking: { text: 'pending' },
    },
  };
}

suite('M1 Studio client — conversation-scoped transport');

test('first send assigns and publishes one stable conversation identity', () => {
  const pane = session();
  const { busEvents, client, socket } = loadClient([pane]);

  assert.equal(client.wsSendChat('hello', pane, 0), true);
  assert.equal(
    pane._convId,
    'studio-11111111-2222-4333-8444-555555555555',
  );
  assert.deepEqual(socket.sent.at(-1), {
    channel: 'chat',
    data: {
      content: 'hello',
      conversationId: pane._convId,
      editMode: 'ask',
      agentId: null,
      projectId: null,
    },
  });
  const identityEvent = busEvents.find(event => event.name === 'session:identity');
  assert.equal(identityEvent.name, 'session:identity');
  assert.equal(identityEvent.payload.idx, 0);
  assert.equal(identityEvent.payload.conversationId, pane._convId);

  assert.equal(client.wsSendChat('again', pane, 0), true);
  assert.equal(socket.sent.at(-1).data.conversationId, pane._convId);
  assert.equal(
    busEvents.filter(event => event.name === 'session:identity').length,
    1,
  );
});

test('cancel always carries the selected pane conversationId', () => {
  const paneA = session('studio-conversation-A');
  const paneB = session('studio-conversation-B');
  const { client, socket } = loadClient([paneA, paneB]);

  assert.equal(client.wsSendChat('A', paneA, 0), true);
  assert.equal(client.wsSendChat('B', paneB, 1), true);
  assert.equal(client.wsSendCancel(paneA), true);
  assert.deepEqual(socket.sent.at(-1), {
    channel: 'control',
    data: { action: 'cancel', conversationId: 'studio-conversation-A' },
  });
  assert.equal(
    socket.sent.some(message => (
      message.channel === 'control'
      && message.data.action === 'cancel'
      && !message.data.conversationId
    )),
    false,
  );
});

test('missing or malformed target cannot fall back to cancel-all', () => {
  const { client, socket } = loadClient([session()]);
  const before = socket.sent.length;

  assert.equal(client.wsSendCancel(session()), false);
  assert.equal(client.wsSendCancel(session('not a valid id')), false);
  assert.equal(socket.sent.length, before);
});

test('authoritative panel passes the selected session into cancel', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const cancelStart = source.indexOf('function _cancelExecution(idx)');
  const cancelEnd = source.indexOf('/* split mode:', cancelStart);
  assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
  const cancelSource = source.slice(cancelStart, cancelEnd);
  assert.match(cancelSource, /C3WS\.sendCancel\(s\)/);
  assert.match(source, /C3WS\.sendCancel\(_sessions\[_sessionActive\]\)/);
  assert.doesNotMatch(source, /C3WS\.sendCancel\(\s*\)/);
});

suite('M1 Studio client — acknowledged race-safe rehydrate');

await testAsync('history waits for ACK, ambiguous empty history preserves data, and invalid pane is reset', async () => {
  const paneA = session('studio-rehydrate-A');
  const paneB = session('studio-rehydrate-B');
  paneB._projectId = 'project-kept';
  const fetchUrls = [];
  const { busEvents, socket } = loadClient([paneA, paneB], {
    fetch: async url => {
      fetchUrls.push(url);
      return { ok: true, json: async () => ({ messages: [] }) };
    },
  });

  assert.equal(fetchUrls.length, 0, 'history fetch started before durable ACK');
  assert.deepEqual(socket.sent.at(-1), {
    channel: 'control',
    data: {
      action: 'rehydrate',
      conversationIds: ['studio-rehydrate-A', 'studio-rehydrate-B'],
    },
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: ['studio-rehydrate-A'] },
  });
  await drainMicrotasks();

  assert.equal(fetchUrls.length, 1);
  assert.match(fetchUrls[0], /studio-rehydrate-A\/messages$/);
  assert.equal(paneA.chat.msgs[0].text, 'stale');
  assert.equal(paneA.chat._thinking.text, 'pending');
  assert.equal(paneB._convId, null);
  assert.equal(paneB._agentId, null);
  assert.equal(paneB._label, '');
  assert.equal(paneB.chat.msgs.length, 0);
  assert.equal(paneB.chat._thinking, null);
  assert.equal(paneB._projectId, 'project-kept');

  const completion = busEvents.filter(event => event.name === 'ws:reconnected');
  assert.equal(
    JSON.stringify(completion.at(-1).payload),
    JSON.stringify({
      status: 'degraded',
      restoredCount: 0,
      invalidCount: 1,
      failedCount: 1,
    }),
  );
  assert.equal(
    busEvents.filter(event => event.name === 'session:invalid').length,
    1,
  );
});

await testAsync('prototype-named conversation identity is restored without map-key confusion', async () => {
  const pane = session('constructor');
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ({
          messages: [{ role: 'assistant', content: 'restored', metadata: null }],
        }),
      };
    },
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: ['constructor'] },
  });
  await drainMicrotasks();

  assert.equal(fetchCount, 1);
  assert.equal(pane._convId, 'constructor');
  assert.equal(pane.chat.msgs[0].text, 'restored');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'ok', restoredCount: 1, invalidCount: 0, failedCount: 0 }),
  );
});

await testAsync('malformed or unsolicited ACK preserves every local snapshot', async () => {
  const pane = session('studio-rehydrate-safe');
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => {
      fetchCount++;
      return { ok: true, json: async () => ({ messages: [] }) };
    },
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: ['studio-unsolicited'] },
  });
  await drainMicrotasks();

  assert.equal(fetchCount, 0);
  assert.equal(pane._convId, 'studio-rehydrate-safe');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('non-2xx history preserves snapshot and reports degraded completion', async () => {
  const pane = session('studio-rehydrate-http-failure');
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ messages: [] }),
    }),
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [pane._convId] },
  });
  await drainMicrotasks();

  assert.equal(pane._convId, 'studio-rehydrate-http-failure');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('malformed success history preserves snapshot and reports degraded completion', async () => {
  const pane = session('studio-rehydrate-malformed-history');
  const { busEvents, socket } = loadClient([pane], {
    fetch: async () => ({
      ok: true,
      json: async () => ({ notMessages: [] }),
    }),
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [pane._convId] },
  });
  await drainMicrotasks();

  assert.equal(pane._convId, 'studio-rehydrate-malformed-history');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('new reconnect epoch wins and stale history cannot overwrite it', async () => {
  const pane = session('studio-rehydrate-race');
  const pendingFetches = [];
  const { busEvents, client, handshake, socket, sockets } = loadClient([pane], {
    fetch: () => {
      const request = deferred();
      pendingFetches.push(request);
      return request.promise;
    },
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [pane._convId] },
  });
  await drainMicrotasks();
  assert.equal(pendingFetches.length, 1);

  client.wsConnect();
  const newerSocket = sockets[1];
  handshake(newerSocket);
  sendServerMessage(newerSocket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [pane._convId] },
  });
  await drainMicrotasks();
  assert.equal(pendingFetches.length, 2);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').length,
    0,
    'completion was emitted before current history fetch settled',
  );

  pendingFetches[1].resolve({
    ok: true,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'new epoch', metadata: null }],
    }),
  });
  await drainMicrotasks();
  assert.equal(pane.chat.msgs[0].text, 'new epoch');

  pendingFetches[0].resolve({
    ok: true,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'stale epoch', metadata: null }],
    }),
  });
  await drainMicrotasks();
  assert.equal(pane.chat.msgs[0].text, 'new epoch');
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').length,
    1,
  );
});

test('stale socket cannot route events, disconnect the active client, or schedule reconnect', () => {
  const timers = [];
  const { busEvents, client, handshake, socket, sockets } = loadClient(
    [session('studio-stale-socket')],
    {
      clearTimeout(timer) {
        if (timer) timer.cleared = true;
      },
      setTimeout(callback, delay) {
        const timer = { callback, cleared: false, delay };
        timers.push(timer);
        return timer;
      },
    },
  );

  client.wsConnect();
  const activeSocket = sockets[1];
  handshake(activeSocket);
  const timerCount = timers.length;
  const socketCount = sockets.length;

  sendServerMessage(socket, {
    channel: 'chat',
    data: {
      type: 'assistant',
      content: 'stale socket response',
      conversationId: 'studio-stale-socket',
    },
  });
  socket.close();

  assert.equal(
    busEvents.some(event => event.name === 'chat:message' && event.payload.content === 'stale socket response'),
    false,
  );
  assert.equal(busEvents.some(event => event.name === 'ws:disconnected'), false);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
  assert.equal(client.wsIsReady(), true);
  assert.equal(timers.length, timerCount);
  assert.equal(sockets.length, socketCount);
});

await testAsync('history cannot overwrite activity added after ACK in the same epoch', async () => {
  const pane = session('studio-rehydrate-active');
  const pendingFetch = deferred();
  const { busEvents, socket } = loadClient([pane], {
    fetch: () => pendingFetch.promise,
  });

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [pane._convId] },
  });
  await drainMicrotasks();

  pane.chat.msgs.push({ role: 'user', text: 'newer local activity' });
  pane.chat._thinking = { text: 'new turn pending' };
  pendingFetch.resolve({
    ok: true,
    json: async () => ({
      messages: [{ role: 'assistant', content: 'older durable history', metadata: null }],
    }),
  });
  await drainMicrotasks();

  assert.equal(pane.chat.msgs.at(-1).text, 'newer local activity');
  assert.equal(pane.chat._thinking.text, 'new turn pending');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );
});

await testAsync('activity before ACK is neither overwritten nor cleared by the ACK result', async () => {
  const validPane = session('studio-rehydrate-pre-ack-valid');
  const invalidPane = session('studio-rehydrate-pre-ack-invalid');
  const { busEvents, socket } = loadClient([validPane, invalidPane], {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        messages: [{ role: 'assistant', content: 'older durable history', metadata: null }],
      }),
    }),
  });

  validPane.chat.msgs.push({ role: 'user', text: 'valid pane activity before ACK' });
  invalidPane.chat.msgs.push({ role: 'user', text: 'invalid pane activity before ACK' });
  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [validPane._convId] },
  });
  await drainMicrotasks();

  assert.equal(validPane.chat.msgs.at(-1).text, 'valid pane activity before ACK');
  assert.equal(invalidPane._convId, 'studio-rehydrate-pre-ack-invalid');
  assert.equal(invalidPane.chat.msgs.at(-1).text, 'invalid pane activity before ACK');
  assert.equal(
    busEvents.filter(event => event.name === 'session:invalid').length,
    0,
  );
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 2 }),
  );
});

await testAsync('missing ACK times out without clearing the local snapshot and ignores a late ACK', async () => {
  const pane = session('studio-rehydrate-timeout');
  const timers = [];
  let fetchCount = 0;
  const { busEvents, socket } = loadClient([pane], {
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    fetch: async () => {
      fetchCount++;
      return { ok: true, json: async () => ({ messages: [] }) };
    },
    setTimeout(callback, delay) {
      const timer = { callback, cleared: false, delay };
      timers.push(timer);
      return timer;
    },
  });

  const ackTimer = timers.find(timer => timer.delay === 5000 && !timer.cleared);
  assert.ok(ackTimer, 'rehydrate ACK timeout was not scheduled');
  assert.equal(fetchCount, 0);
  ackTimer.callback();
  await drainMicrotasks();

  assert.equal(pane._convId, 'studio-rehydrate-timeout');
  assert.equal(pane.chat.msgs[0].text, 'stale');
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnected').at(-1).payload),
    JSON.stringify({ status: 'degraded', restoredCount: 0, invalidCount: 0, failedCount: 1 }),
  );

  sendServerMessage(socket, {
    channel: 'control',
    data: { action: 'rehydrate_ack', validIds: [pane._convId] },
  });
  await drainMicrotasks();
  assert.equal(fetchCount, 0);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnected').length,
    1,
  );
});

test('panel persists the invalid-session reset applied by transport', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf("C3Bus.on('session:invalid'");
  const end = source.indexOf('\n  });', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /s\._convId=null;s\._agentId=null;s\._label=''/);
  assert.match(handler, /s\.chat\.msgs=\[\];s\.chat\._thinking=null/);
  assert.match(handler, /_persistSessionState\(\)/);
});

suite('M1 Studio client — bounded visible reconnect');

test('socket stuck in CONNECTING times out into the bounded scheduler', () => {
  const clock = controlledTimers();
  const { busEvents, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });

  assert.equal(socket.readyState, 0);
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 5000);
  clock.run(clock.active()[0]);

  assert.equal(socket.readyState, 3);
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 1000);
  assert.equal(sockets.length, 1);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
});

test('open without ACK times out, does not reset backoff, and hello ACK resets it', () => {
  const clock = controlledTimers();
  const { client, handshake, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });

  socket.readyState = 1;
  socket.onopen();
  const handshakeTimeout = clock.active().find(timer => timer.delay === 5000);
  clock.run(handshakeTimeout);
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 1000);

  clock.run(clock.active()[0]);
  const secondSocket = sockets[1];
  secondSocket.readyState = 1;
  secondSocket.onopen();
  secondSocket.close();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 2000);

  clock.run(clock.active()[0]);
  const acknowledgedSocket = sockets[2];
  handshake(acknowledgedSocket);
  assert.equal(client.wsIsReady(), true);
  acknowledgedSocket.close();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 1000);
});

test('late hello ACK after timeout cannot create false ready or reset backoff', () => {
  const clock = controlledTimers();
  const { busEvents, client, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    deferClose: true,
    setTimeout: clock.setTimeout,
  });

  socket.readyState = 1;
  socket.onopen();
  socket.close();
  socket.finishClose();
  assert.equal(clock.active()[0].delay, 1000);
  clock.run(clock.active()[0]);

  const timedOutSocket = sockets[1];
  const handshakeTimeout = clock.active().find(timer => timer.delay === 5000);
  clock.run(handshakeTimeout);
  assert.equal(timedOutSocket.readyState, 2);
  sendServerMessage(timedOutSocket, {
    type: 'hello_ack',
    serverVersion: 'late',
    features: [],
  });

  assert.equal(client.wsIsReady(), false);
  assert.equal(busEvents.some(event => event.name === 'ws:ready'), false);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnected'), false);
  timedOutSocket.finishClose();
  assert.equal(clock.active().length, 1);
  assert.equal(clock.active()[0].delay, 2000);
});

test('twelve failed reconnects stop at the exact cap and emit exhaustion once', () => {
  const clock = controlledTimers();
  const { busEvents, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  const retryDelays = [];

  socket.readyState = 1;
  socket.onopen();
  socket.close();
  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(clock.active().length, 1);
    const retryTimer = clock.active()[0];
    retryDelays.push(retryTimer.delay);
    clock.run(retryTimer);
    const currentSocket = sockets.at(-1);
    currentSocket.readyState = 1;
    currentSocket.onopen();
    currentSocket.close();
  }

  assert.deepEqual(
    retryDelays,
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000],
  );
  assert.equal(sockets.length, 13);
  assert.equal(clock.active().length, 0);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'ws:reconnect_exhausted')),
    JSON.stringify([{
      name: 'ws:reconnect_exhausted',
      payload: { attempts: 12, maxAttempts: 12 },
    }]),
  );

  sockets.at(-1).close();
  assert.equal(clock.active().length, 0);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    1,
  );
});

test('constructor failures use the same bounded scheduler without recursion', () => {
  const clock = controlledTimers();
  let constructCalls = 0;
  const { busEvents, sockets } = loadClient([session()], {
    autoHandshake: false,
    beforeWebSocketConstruct() {
      constructCalls++;
      throw new Error('synthetic constructor failure');
    },
    clearTimeout: clock.clearTimeout,
    console: { error() {}, log() {} },
    setTimeout: clock.setTimeout,
  });
  const retryDelays = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(clock.active().length, 1);
    const retryTimer = clock.active()[0];
    retryDelays.push(retryTimer.delay);
    clock.run(retryTimer);
  }

  assert.equal(constructCalls, 13);
  assert.equal(sockets.length, 0);
  assert.deepEqual(
    retryDelays,
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000],
  );
  assert.equal(clock.active().length, 0);
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    1,
  );
});

test('a successful handshake resets the exhaustion latch for a later outage', () => {
  const clock = controlledTimers();
  const { busEvents, client, handshake, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });

  socket.readyState = 1;
  socket.onopen();
  socket.close();
  for (let attempt = 0; attempt < 12; attempt++) {
    const retryTimer = clock.active()[0];
    clock.run(retryTimer);
    const currentSocket = sockets.at(-1);
    currentSocket.readyState = 1;
    currentSocket.onopen();
    currentSocket.close();
  }
  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    1,
  );

  assert.equal(client.wsConnect(), true);
  const recoveredSocket = sockets.at(-1);
  handshake(recoveredSocket);
  recoveredSocket.close();
  for (let attempt = 0; attempt < 12; attempt++) {
    const retryTimer = clock.active()[0];
    clock.run(retryTimer);
    const currentSocket = sockets.at(-1);
    currentSocket.readyState = 1;
    currentSocket.onopen();
    currentSocket.close();
  }

  assert.equal(
    busEvents.filter(event => event.name === 'ws:reconnect_exhausted').length,
    2,
  );
});

test('destroyed active client stays stopped without retry or exhaustion', () => {
  const clock = controlledTimers();
  const { busEvents, client, sockets } = loadClient([session()], {
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  assert.equal(client.wsIsReady(), true);
  client.trackEditRequest('edit-destroy', '/owned/file.js', null, 0);

  client.wsDestroy();

  assert.equal(client.wsIsReady(), false);
  assert.equal(clock.active().length, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
  assert.equal(
    JSON.stringify(busEvents.filter(event => event.name === 'edit:resolved').at(-1)),
    JSON.stringify({
      name: 'edit:resolved',
      payload: { reqId: 'edit-destroy', action: 'disconnect' },
    }),
  );
  assert.equal(client.wsConnect(), false);
  assert.equal(sockets.length, 1);
});

test('destroy cancels a pending retry and its queued callback cannot reconnect', () => {
  const clock = controlledTimers();
  const { busEvents, client, socket, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  socket.readyState = 1;
  socket.onopen();
  socket.close();
  const retryTimer = clock.active()[0];
  assert.equal(retryTimer.delay, 1000);

  client.wsDestroy();
  assert.equal(retryTimer.cleared, true);
  retryTimer.callback();

  assert.equal(sockets.length, 1);
  assert.equal(clock.active().length, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
});

test('destroy cancels a pending CONNECTING timeout and its callback is inert', () => {
  const clock = controlledTimers();
  const { busEvents, client, sockets } = loadClient([session()], {
    autoHandshake: false,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  });
  const handshakeTimer = clock.active()[0];
  assert.equal(handshakeTimer.delay, 5000);

  client.wsDestroy();
  assert.equal(handshakeTimer.cleared, true);
  handshakeTimer.callback();

  assert.equal(sockets.length, 1);
  assert.equal(clock.active().length, 0);
  assert.equal(busEvents.some(event => event.name === 'ws:reconnect_exhausted'), false);
});

test('panel makes reconnect exhaustion visible and keeps health offline', () => {
  const source = fs.readFileSync(CHAT_PANEL, 'utf8');
  const start = source.indexOf("C3Bus.on('ws:reconnect_exhausted'");
  const end = source.indexOf('\n  });', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /_serverHealth\.wsConnected = false/);
  assert.match(handler, /_serverHealth\.status = 'offline'/);
  assert.match(handler, /agentLog/);
  assert.match(handler, /renderSidebar\(\);_updateStatusIndicator\(\)/);
});

summary();
