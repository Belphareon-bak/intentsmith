#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { suite, test, summary } from './harness.js';

const WS_CLIENT = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js',
  import.meta.url,
);
const CHAT_PANEL = new URL(
  '../c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
  import.meta.url,
);

function loadClient(sessions) {
  const busEvents = [];
  const sockets = [];

  class FakeWebSocket {
    constructor(url, protocols) {
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
    clearTimeout() {},
    console,
    crypto: {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    },
    fetch: async () => ({
      json: async () => ({ messages: [] }),
    }),
    fetchBackendData() {},
    module: { exports: {} },
    setInterval: () => Symbol('interval'),
    setTimeout: () => Symbol('timeout'),
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
  client.wsConnect();
  const socket = sockets[0];
  socket.readyState = 1;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'hello_ack',
      serverVersion: 'test',
      features: [],
    }),
  });
  return { busEvents, client, socket };
}

function session(conversationId = null) {
  return {
    _agentId: null,
    _convId: conversationId,
    _projectId: null,
    chat: { editMode: 'ask', _pendingAttachments: null },
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

summary();
